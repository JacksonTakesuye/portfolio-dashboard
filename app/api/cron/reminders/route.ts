import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// This route is invoked on a schedule by Vercel Cron (a daily GET request).
// It sends four kinds of reminders:
//   1. PSR reminders — the day after a property's PSR is due, to that property's Service Manager, if still unsubmitted.
//   2. Site-visit reminders — day 24 heads-up to RM/RSM, day 31 escalation to Alicia Bush and Colson Franse (RM/RSM copied).
//   3. Systems Healthy reminders — day 3 to on-site CM/SM, day 5 escalation to RM/RSM.
//   4. Critical service issue escalation — day 3 RM/RSM, day 5 Alicia Bush and Colson Franse, day 7 Paul Mashni.
//
// Every day-count above is capped at the number of days the property has been
// live (see daysLive). A property only starts accruing days on its
// alerts_start_date, so newly rolled-out properties begin at day 0 rather than
// firing a backlog of escalations on their first live day.

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

type Sub = { subscription: any; role: string | null; assigned_property_ids: any; user_id: string | null }

function recipientsFor(subs: Sub[], propertyId: string, roles: string[]) {
  return subs.filter((s) => {
    if (!s.role || !roles.includes(s.role)) return false
    const assigned = Array.isArray(s.assigned_property_ids) ? s.assigned_property_ids : []
    return assigned.includes(propertyId)
  })
}

// Find push subscriptions belonging to specific people, by their auth user id.
// Used for escalations that go to named individuals (e.g. Alicia, Colson) rather
// than to whoever happens to be assigned to the property.
function subsForUserIds(subs: Sub[], userIds: (string | null)[]) {
  const ids = userIds.filter(Boolean) as string[]
  if (ids.length === 0) return []
  return subs.filter((s) => s.user_id && ids.includes(s.user_id))
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
  const recipients = Array.from(new Set(to.filter(Boolean) as string[]))
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
    supabase.from('properties').select('id, name, rm, rsm, alerts_start_date'),
    supabase.from('push_subscriptions').select('subscription, role, assigned_property_ids, user_id'),
    supabase.from('user_profiles').select('id, full_name, email, role, alerts_start_date'),
  ])
  const properties: any[] = props || []
  const subscriptions: Sub[] = (subs || []) as Sub[]
  const profiles: any[] = profs || []
  // Today's date in Arizona as YYYY-MM-DD, for comparing against alerts_start_date.
  const todayAz = ymd(az)

  // Look up a person's email by full name, for alert routing.
  // If their alerts_start_date is still in the future they are inside their
  // onboarding window, so return null and no automated email reaches them yet.
  // Returning null is safe: sendEmail() drops empty recipient lists and no-ops.
  const emailOf = (fullName: string) => {
    const u = profiles.find((p) => p.full_name === fullName)
    if (!u || !u.email) return null
    if (u.alerts_start_date && u.alerts_start_date > todayAz) return null
    return u.email
  }
  // Look up a person's auth user id by full name, for targeted push notifications.
  // Respects the same onboarding window as emailOf — nobody is pushed to before
  // their alerts_start_date.
  const userIdOf = (fullName: string) => {
    const u = profiles.find((p) => p.full_name === fullName)
    if (!u || !u.id) return null
    if (u.alerts_start_date && u.alerts_start_date > todayAz) return null
    return u.id as string
  }
  // Is a property live for automated alert emails yet?
  // A property with an alerts_start_date still in the future has not been rolled
  // out to its staff, so no automated email should go out about it. Blank = live.
  const propertyAlertsLive = (prop: any) =>
    !prop?.alerts_start_date || prop.alerts_start_date <= todayAz

  // How many days a property has been live for automated alerts.
  // Days that elapsed BEFORE a property's alerts_start_date predate its rollout —
  // nobody was being reminded then, so those days must not count toward any
  // reminder clock. Every elapsed-day figure below is capped at this number.
  // A property with no alerts_start_date has always been live, so it is uncapped.
  const daysLive = (prop: any) => {
    if (!prop?.alerts_start_date) return Infinity
    const startMs = new Date(prop.alerts_start_date + 'T00:00:00Z').getTime()
    const todayMs = new Date(todayAz + 'T00:00:00Z').getTime()
    return Math.max(0, Math.floor((todayMs - startMs) / 86400000))
  }

  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name || id

  const summary = { psrReminders: 0, psrSent: 0, visit24: 0, visit24Sent: 0, visit24Emails: 0, visit31: 0, visit31Sent: 0, visit31Emails: 0, health3: 0, health3Sent: 0, health5: 0, health5Sent: 0, health5Emails: 0, csr3: 0, csr5: 0, csr7: 0 }

  // ── 1. PSR reminders ──────────────────────────────────────────────────────
  // Tuesday (dow 2) → chase Monday-due reports. Wednesday (dow 3) → chase Tuesday-due.
  let dueGroup: string | null = null
  if (dow === 2) dueGroup = 'monday'
  else if (dow === 3) dueGroup = 'tuesday'

  // The calendar date the report being chased was actually due.
  const dueDate = dueGroup === 'monday'
    ? weekMonday
    : ymd(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() + 86400000))

  if (dueGroup) {
    const { data: schedule } = await supabase
      .from('psr_schedule')
      .select('property_id, due_day')
      .eq('due_day', dueGroup)

    for (const row of schedule || []) {
      const pid = row.property_id

      // Rollout grace period. A PSR that came due before a property's
      // alerts_start_date predates its rollout, so no one should be chased for it.
      // The first reminder a property ever receives is for the first due date
      // falling on or after the day it went live.
      const prop = properties.find((p) => p.id === pid)
      if (!prop) continue
      if (prop.alerts_start_date && prop.alerts_start_date > dueDate) continue

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

  // ── 2. Site-visit reminders ───────────────────────────────────────────────
  // Day 24+ → heads-up to the property's RM and RSM that a visit is due within the
  //           coming week (push + email).
  // Day 31+ → overdue escalation to Alicia Bush and Colson Franse
  //           (push + email + in-app alert).
  // A property receives at most one of the two per run, and each repeats no more
  // than once per 7 days.
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
    if (!propertyAlertsLive(p)) continue // property not rolled out yet — stay silent
    const last = latestVisit[p.id]
    const rawDays = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : 9999
    // Days before this property went live do not count — see daysLive().
    const daysSince = Math.min(rawDays, daysLive(p))
    const dayLabel = daysSince === 9999 ? 'over 30' : String(daysSince)

    if (daysSince >= 31) {
      // Overdue — escalate to Alicia Bush and Colson Franse
      if (await alreadyReminded(p.id, 'visit-31day', 7)) continue
      summary.visit31++
      const title = 'Site Visit Overdue - ' + p.name
      const body = p.name + ' has had no logged site visit in ' + dayLabel + ' days.'
      // Alicia and Colson, plus the property's own RM and RSM. De-duplicated in
      // case someone would otherwise be reached twice.
      const targets = Array.from(new Set([
        ...subsForUserIds(subscriptions, [userIdOf('Alicia Bush'), userIdOf('Colson Franse')]),
        ...recipientsFor(subscriptions, p.id, ['rm', 'rsm']),
      ]))
      if (targets.length) summary.visit31Sent += await send(targets, title, body)
      const html =
        '<p><strong>' + p.name + '</strong> has had no logged site visit in ' + dayLabel + ' days.</p>' +
        '<p>Regional Manager: ' + (p.rm || 'unassigned') + ' &middot; Regional Service Manager: ' +
        (p.rsm || 'unassigned') + '</p>' +
        '<p>A reminder was sent on day 24. This visit is now past due and has been escalated to Alicia Bush and Colson Franse.</p>' +
        '<p style="color:#64748b">&mdash; PEM Portfolio Systems Dashboard</p>'
      summary.visit31Emails += await sendEmail(
        [emailOf('Alicia Bush'), emailOf('Colson Franse'), emailOf(p.rm), emailOf(p.rsm)],
        'Site Visit Overdue - ' + p.name, html)
      await logAlert('visit-31day', p.id, p.name, 'No site visit logged in ' + dayLabel + ' days — escalated to Alicia Bush & Colson Franse')
      await logReminder(p.id, 'visit-31day')
    } else if (daysSince >= 24) {
      // Due soon — heads-up to the property's RM and RSM
      if (await alreadyReminded(p.id, 'visit-24day', 7)) continue
      summary.visit24++
      const title = 'Site Visit Due Soon - ' + p.name
      const body = p.name + ' was last visited ' + dayLabel + ' days ago. A site visit is due within the coming week.'
      const targets = recipientsFor(subscriptions, p.id, ['rm', 'rsm'])
      if (targets.length) summary.visit24Sent += await send(targets, title, body)
      const html =
        '<p><strong>' + p.name + '</strong> was last visited ' + dayLabel + ' days ago.</p>' +
        '<p>A site visit is due within the coming week. Please schedule one and upload the SiteAuditPro report when you log the visit in the dashboard.</p>' +
        '<p style="color:#64748b">&mdash; PEM Portfolio Systems Dashboard</p>'
      summary.visit24Emails += await sendEmail([emailOf(p.rm), emailOf(p.rsm)], 'Site Visit Due Soon - ' + p.name, html)
      await logAlert('visit-24day', p.id, p.name, 'No site visit logged in ' + dayLabel + ' days — RM/RSM reminded')
      await logReminder(p.id, 'visit-24day')
    }
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
    if (!propertyAlertsLive(p)) continue // property not rolled out yet — stay silent
    const last = latestConf[p.id]
    const rawConfDays = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : 9999
    // Days before this property went live do not count — see daysLive().
    const daysSince = Math.min(rawConfDays, daysLive(p))
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
  //   3+ days → the property's RM and RSM
  //   5+ days → Alicia Bush and Colson Franse
  //   7+ days → Paul Mashni (highest level)
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

    const prop = properties.find((p) => p.id === sys.property_id)
    if (!prop) continue
    if (!propertyAlertsLive(prop)) continue // property not rolled out yet — stay silent

    // Days before this property went live do not count — see daysLive().
    const daysOpen = Math.min(
      Math.floor((Date.now() - runStartMs) / 86400000),
      daysLive(prop)
    )
    if (daysOpen < 3) continue

    const reason = runStart.reason || latest.reason || 'not specified'
    const affected = runStart.affected_units || latest.affected_units || ''
    const label = affected || sys.name // name specific elevators when applicable
    const tag = ':' + sys.id + ':' + runStartMs // unique per outage run + system

    const footer = '<p style="color:#64748b">&mdash; PEM Portfolio Systems Dashboard</p>'
    const line = '<p><strong>' + label + '</strong> at <strong>' + prop.name +
      '</strong> has been out of service for ' + daysOpen + ' day' + (daysOpen === 1 ? '' : 's') + '.</p>' +
      '<p>Reason: ' + reason + '</p>'

    // 7+ days → Paul Mashni (highest level)
    // The legacy 'csr10' check suppresses a duplicate on any outage that already
    // escalated under the previous 10-day rule.
    if (daysOpen >= 7 &&
        !(await alreadyReminded(prop.id, 'csrexec' + tag, 100000)) &&
        !(await alreadyReminded(prop.id, 'csr10' + tag, 100000))) {
      const html = line + '<p><strong>Highest-level escalation.</strong> This service issue has remained open for 7 or more days and requires immediate attention.</p>' + footer
      summary.csr7 += await sendEmail([emailOf('Paul Mashni')], 'URGENT: Service Issue Open ' + daysOpen + ' Days - ' + prop.name, html)
      await logAlert('csr-exec', prop.id, prop.name, label + ' out of service ' + daysOpen + ' days — escalated to Paul Mashni')
      await logReminder(prop.id, 'csrexec' + tag)
    }

    // 5+ days → Alicia Bush and Colson Franse
    // The legacy 'csr7' check suppresses a duplicate on any outage that already
    // escalated under the previous 7-day rule.
    if (daysOpen >= 5 &&
        !(await alreadyReminded(prop.id, 'csrsenior' + tag, 100000)) &&
        !(await alreadyReminded(prop.id, 'csr7' + tag, 100000))) {
      const html = line + '<p>This service issue has been open for 5 or more days and requires escalation. Please review and ensure resolution is underway.</p>' + footer
      summary.csr5 += await sendEmail([emailOf('Alicia Bush'), emailOf('Colson Franse')], 'Escalation: Service Issue Open ' + daysOpen + ' Days - ' + prop.name, html)
      await logAlert('csr-senior', prop.id, prop.name, label + ' out of service ' + daysOpen + ' days — escalated to Alicia Bush & Colson Franse')
      await logReminder(prop.id, 'csrsenior' + tag)
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