import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// This route is invoked on a schedule by Vercel Cron (a daily GET request).
// It sends two kinds of reminders:
//   1. PSR reminders — the day after a property's PSR is due, to that property's Service Manager, if still unsubmitted.
//   2. Site-visit reminders — to a property's RM and RSM when it has gone 30+ days without a visit.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Arizona never observes daylight saving, so it is a fixed UTC-7 the whole year.
const AZ_OFFSET_MS = 7 * 60 * 60 * 1000
function azDate() {
  return new Date(Date.now() - AZ_OFFSET_MS)
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}
// Monday of the current week, in Arizona time, as a YYYY-MM-DD string
function azWeekMonday(az: Date) {
  const dow = az.getUTCDay()               // 0=Sun .. 6=Sat
  const daysSinceMonday = (dow + 6) % 7
  const monday = new Date(az.getTime() - daysSinceMonday * 86400000)
  return ymd(monday)
}

type Sub = { subscription: any; role: string | null; assigned_property_ids: any }

function recipientsFor(subs: Sub[], propertyId: string, roles: string[]) {
  return subs.filter((s) => {
    if (!s.role || !roles.includes(s.role)) return false
    const assigned = Array.isArray(s.assigned_property_ids) ? s.assigned_property_ids : []
    return assigned.includes(propertyId)
  })
}

async function send(subs: Sub[], title: string, body: string) {
  const payload = JSON.stringify({ title, body })
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, payload))
  )
  return results.filter((r) => r.status === 'fulfilled').length
}

async function alreadyReminded(propertyId: string, type: string, withinDays: number) {
  const cutoff = new Date(Date.now() - withinDays * 86400000).toISOString()
  const { data } = await supabase
    .from('reminder_log')
    .select('id')
    .eq('property_id', propertyId)
    .eq('reminder_type', type)
    .gte('sent_at', cutoff)
    .limit(1)
  return !!(data && data.length)
}

async function logReminder(propertyId: string, type: string) {
  await supabase.from('reminder_log').insert({ property_id: propertyId, reminder_type: type })
}

export async function GET(request: Request) {
  // Simple protection: if a CRON_SECRET is configured, require it. Vercel Cron
  // automatically sends it as a Bearer token. If not set, we allow the call.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  webpush.setVapidDetails(
    'mailto:jacksont@proequitymgmt.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const az = azDate()
  const dow = az.getUTCDay() // 0=Sun..6=Sat in Arizona time
  const weekMonday = azWeekMonday(az)

  const [{ data: props }, { data: subs }] = await Promise.all([
    supabase.from('properties').select('id, name'),
    supabase.from('push_subscriptions').select('subscription, role, assigned_property_ids'),
  ])
  const properties: any[] = props || []
  const subscriptions: Sub[] = (subs || []) as Sub[]
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name || id

  const summary = { psrReminders: 0, psrSent: 0, visitReminders: 0, visitSent: 0 }

  // ── 1. PSR reminders ──────────────────────────────────────────────────────
  // Tuesday (dow 2) → chase Monday-due reports. Wednesday (dow 3) → chase Tuesday-due.
  let dueGroup: string | null = null
  if (dow === 2) dueGroup = 'monday'
  else if (dow === 3) dueGroup = 'tuesday'

  if (dueGroup) {
    const { data: schedule } = await supabase
      .from('psr_schedule')
      .select('property_id, due_day')
      .eq('due_day', dueGroup)

    for (const row of schedule || []) {
      const pid = row.property_id

      // Did a PSR report already come in for this property this week?
      const { data: reports } = await supabase
        .from('psr_reports')
        .select('id')
        .eq('property_id', pid)
        .gte('report_date', weekMonday)
        .limit(1)
      if (reports && reports.length) continue // submitted — no reminder

      if (await alreadyReminded(pid, 'psr', 1)) continue // already nudged today

      const targets = recipientsFor(subscriptions, pid, ['sm'])
      summary.psrReminders++
      if (targets.length) {
        const title = 'PSR Reminder - ' + nameOf(pid)
        const body =
          'The PSR report for ' + nameOf(pid) + ' was due ' +
          (dueGroup === 'monday' ? 'Monday' : 'Tuesday') +
          ' and has not been submitted yet. Please submit it as soon as possible.'
        summary.psrSent += await send(targets, title, body)
      }
      await logReminder(pid, 'psr')
    }
  }

  // ── 2. Site-visit reminders (every day, max once per property per 7 days) ──
  const { data: visits } = await supabase
    .from('site_visits')
    .select('property_id, visit_date')

  const latestVisit: Record<string, string> = {}
  for (const v of visits || []) {
    if (!latestVisit[v.property_id] || v.visit_date > latestVisit[v.property_id]) {
      latestVisit[v.property_id] = v.visit_date
    }
  }

  for (const p of properties) {
    const last = latestVisit[p.id]
    let daysSince: number
    if (!last) daysSince = 9999
    else daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000)
    if (daysSince <= 30) continue

    if (await alreadyReminded(p.id, 'site-visit', 7)) continue // nudged within the last week

    const targets = recipientsFor(subscriptions, p.id, ['rm', 'rsm'])
    summary.visitReminders++
    if (targets.length) {
      const title = 'Site Visit Overdue - ' + p.name
      const body =
        p.name + ' has not had a logged site visit in ' +
        (daysSince === 9999 ? 'over 30' : daysSince) +
        ' days. Please schedule one.'
      summary.visitSent += await send(targets, title, body)
    }
    await logReminder(p.id, 'site-visit')
  }

  return NextResponse.json({ ran: true, azWeekday: dow, ...summary })
}