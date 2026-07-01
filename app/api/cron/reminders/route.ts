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

// Send email via Resend. No-op (returns 0) until RESEND_API_KEY is configured in Vercel.
async function sendEmail(to: (string | null)[], subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  const recipients = to.filter(Boolean) as string[]
  if (!key || recipients.length === 0) return 0
  const from = process.env.ALERT_EMAIL_FROM || 'PEM Dashboard <dashboard@alerts.proequitymgmt.com>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    })
    return res.ok ? recipients.length : 0
  } catch {
    return 0
  }
}

// Write an entry to the in-app Alerts feed.
async function logAlert(type: string, propertyId: string, propertyName: string, reason: string) {
  await supabase.from('alert_log').insert({ type, property_id: propertyId, property_name: propertyName, reason })
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

  const [{ data: props }, { data: subs }, { data: profs }] = await Promise.all([
    supabase.from('properties').select('id, name, rm, rsm'),
    supabase.from('push_subscriptions').select('subscription, role, assigned_property_ids'),
    supabase.from('user_profiles').select('full_name, email, role'),
  ])
  const properties: any[] = props || []
  const subscriptions: Sub[] = (subs || []) as Sub[]
  const profiles: any[] = profs || []
  const emailOf = (fullName: string) => profiles.find((u) => u.full_name === fullName)?.email || null
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name || id

  const summary = { psrReminders: 0, psrSent: 0, visitReminders: 0, visitSent: 0, health3: 0, health3Sent: 0, health5: 0, health5Sent: 0, health5Emails: 0, csr3: 0, csr7: 0, csr10: 0 }

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

  // ── 3. Systems Healthy reminders ──────────────────────────────────────────
  // 3+ days since a property's last "Systems Healthy" confirmation → nudge CM/SM (in-app + push).
  // 5+ days → escalate to the property's RM/RSM (in-app + push + email).
  const { data: confs } = await supabase
    .from('health_confirmations')
    .select('property_id, confirmed_at')

  const latestConf: Record<string, string> = {}
  for (const c of confs || []) {
    if (!latestConf[c.property_id] || c.confirmed_at > latestConf[c.property_id]) {
      latestConf[c.property_id] = c.confirmed_at
    }
  }

  for (const p of properties) {
    const last = latestConf[p.id]
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : 9999
    const dayLabel = daysSince === 9999 ? '3+' : String(daysSince)

    // 3-day nudge to the on-site CM/SM (at most once per day)
    if (daysSince >= 3 && !(await alreadyReminded(p.id, 'health-3day', 1))) {
      const targets = recipientsFor(subscriptions, p.id, ['cm', 'sm'])
      summary.health3++
      const title = 'Systems Healthy Check Due - ' + p.name
      const body = 'It has been ' + (daysSince === 9999 ? 'a while' : daysSince + ' days') +
        ' since systems were confirmed healthy at ' + p.name + '. Please review and tap "Systems Healthy".'
      if (targets.length) summary.health3Sent += await send(targets, title, body)
      await logAlert('health-3day', p.id, p.name, 'No systems-healthy confirmation in ' + dayLabel + ' days')
      await logReminder(p.id, 'health-3day')
    }

    // 5-day escalation to RM/RSM — push + email (at most once per 2 days)
    if (daysSince >= 5 && !(await alreadyReminded(p.id, 'health-5day', 2))) {
      const targets = recipientsFor(subscriptions, p.id, ['rm', 'rsm'])
      summary.health5++
      const title = 'Systems Healthy Overdue - ' + p.name
      const body = p.name + ' has had no systems-healthy confirmation in ' + (daysSince === 9999 ? '5+' : daysSince) +
        ' days. Please reach out to the on-site CM/SM.'
      if (targets.length) summary.health5Sent += await send(targets, title, body)
      const html =
        '<p>' + p.name + ' has not had a &quot;Systems Healthy&quot; confirmation in ' +
        (daysSince === 9999 ? '5 or more' : daysSince) + ' days.</p>' +
        '<p>Please reach out to the on-site Community Manager / Service Manager to confirm system health and resolve any open issues.</p>' +
        '<p>&mdash; PEM Portfolio Systems Dashboard</p>'
      summary.health5Emails += await sendEmail([emailOf(p.rm), emailOf(p.rsm)], 'Systems Healthy Overdue - ' + p.name, html)
      await logAlert('health-5day', p.id, p.name, 'No systems-healthy confirmation in ' + (daysSince === 9999 ? '5+' : daysSince) + ' days')
      await logReminder(p.id, 'health-5day')
    }
  }

  // ── 4. Critical Service Issue (CSR) escalation ───────────────────────────────
  // Clock = days a system has been *continuously* out-of-service. Any change away
  // from out-of-service (to maintenance or in-service) resets the clock, so a new
  // outage starts fresh. Each tier emails once per outage run:
  //   3+ days  → the property's RM and RSM
  //   7+ days  → Alicia Bush and Colson Franse
  //   10+ days → Paul Mashni (highest level)
  const [{ data: sysRows }, { data: suRows }] = await Promise.all([
    supabase.from('systems').select('id, property_id, name'),
    supabase.from('status_updates').select('system_id, status, reason, affected_units, created_at').order('created_at', { ascending: true }),
  ])
  const allSystems: any[] = sysRows || []

  // Group status history by system (ascending in time)
  const historyBySystem: Record<string, any[]> = {}
  for (const u of suRows || []) {
    ;(historyBySystem[u.system_id] = historyBySystem[u.system_id] || []).push(u)
  }

  for (const sys of allSystems) {
    const hist = historyBySystem[sys.id] || []
    if (hist.length === 0) continue
    const latest = hist[hist.length - 1]
    if (latest.status !== 'out-of-service') continue // only currently-open outages

    // Find the start of the current unbroken out-of-service run
    let i = hist.length - 1
    while (i - 1 >= 0 && hist[i - 1].status === 'out-of-service') i--
    const runStart = hist[i]
    const runStartMs = new Date(runStart.created_at).getTime()
    const daysOpen = Math.floor((Date.now() - runStartMs) / 86400000)
    if (daysOpen < 3) continue

    const prop = properties.find((p) => p.id === sys.property_id)
    if (!prop) continue
    const reason = runStart.reason || latest.reason || 'not specified'
    const affected = runStart.affected_units || latest.affected_units || ''
    const label = affected || sys.name // name specific elevators when applicable
    const tag = ':' + sys.id + ':' + runStartMs // unique per outage run + system

    const footer = '<p style="color:#64748b">&mdash; PEM Portfolio Systems Dashboard</p>'
    const line = '<p><strong>' + label + '</strong> at <strong>' + prop.name +
      '</strong> has been out of service for ' + daysOpen + ' day' + (daysOpen === 1 ? '' : 's') + '.</p>' +
      '<p>Reason: ' + reason + '</p>'

    // 10+ days → Paul Mashni
    if (daysOpen >= 10 && !(await alreadyReminded(prop.id, 'csr10' + tag, 100000))) {
      const html = line + '<p><strong>Highest-level escalation.</strong> This service issue has remained open for 10 or more days and requires immediate attention.</p>' + footer
      summary.csr10 += await sendEmail([emailOf('Paul Mashni')], 'URGENT: Service Issue Open ' + daysOpen + ' Days - ' + prop.name, html)
      await logAlert('csr-10day', prop.id, prop.name, label + ' out of service ' + daysOpen + ' days — escalated to Paul Mashni')
      await logReminder(prop.id, 'csr10' + tag)
    }

    // 7+ days → Alicia Bush and Colson Franse
    if (daysOpen >= 7 && !(await alreadyReminded(prop.id, 'csr7' + tag, 100000))) {
      const html = line + '<p>This service issue has been open for 7 or more days and requires escalation. Please review and ensure resolution is underway.</p>' + footer
      summary.csr7 += await sendEmail([emailOf('Alicia Bush'), emailOf('Colson Franse')], 'Escalation: Service Issue Open ' + daysOpen + ' Days - ' + prop.name, html)
      await logAlert('csr-7day', prop.id, prop.name, label + ' out of service ' + daysOpen + ' days — escalated to Alicia Bush & Colson Franse')
      await logReminder(prop.id, 'csr7' + tag)
    }

    // 3+ days → property RM and RSM
    if (daysOpen >= 3 && !(await alreadyReminded(prop.id, 'csr3' + tag, 100000))) {
      const html = line + '<p>Please coordinate resolution with the on-site team.</p>' + footer
      summary.csr3 += await sendEmail([emailOf(prop.rm), emailOf(prop.rsm)], 'Service Issue Open ' + daysOpen + ' Days - ' + prop.name, html)
      await logAlert('csr-3day', prop.id, prop.name, label + ' out of service ' + daysOpen + ' days — RM/RSM notified')
      await logReminder(prop.id, 'csr3' + tag)
    }
  }

  return NextResponse.json({ ran: true, azWeekday: dow, ...summary })
}