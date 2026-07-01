import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  webpush.setVapidDetails(
    'mailto:jacksont@proequitymgmt.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const { type, systemName, propertyName, propertyId, reason, reportDate, noteAuthor, noteText, editedBy, changeSummary, affectedUnits } = await request.json()

  // For elevators with specific units affected, name them instead of the generic system.
  const subj = affectedUnits ? affectedUnits : systemName

  let title = ''
  let body  = ''

  if (type === 'out-of-service') {
    title = 'System Alert - ' + propertyName
    body  = subj + ' is Out of Service' + (reason ? ': ' + reason : '')
  } else if (type === 'maintenance') {
    title = 'Maintenance Alert - ' + propertyName
    body  = subj + ' has been marked Under Maintenance' + (reason ? ': ' + reason : '')
  } else if (type === 'in-service') {
    title = 'Back In Service - ' + propertyName
    body  = subj + ' is back In Service'
  } else if (type === 'psr-submitted') {
    title = 'New PSR Report - ' + propertyName
    body  = 'A new PSR report was submitted for ' + propertyName + (reportDate ? ' on ' + reportDate : '')
  } else if (type === 'note-added') {
    title = 'New Note - ' + propertyName
    body  = (noteAuthor || 'Staff') + ' added a note on ' + systemName + ': ' + (noteText || '')
  } else if (type === 'psr-edited') {
    title = 'PSR Report Edited - ' + propertyName
    body  = (editedBy || 'Someone') + ' edited the ' + (reportDate ? reportDate + ' ' : '') + 'report'
          + (changeSummary ? ': ' + changeSummary : '')
  }

  if (!title) return NextResponse.json({ message: 'Unknown notification type' })

  // Log to alert_log — fire and forget, don't block push delivery
  await supabase.from('alert_log').insert({
    type,
    property_id:   propertyId   || null,
    property_name: propertyName || null,
    system_name:   systemName   || null,
    reason:        reason       || changeSummary || null,
    report_date:   reportDate   || null,
  })

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('subscription, role, assigned_property_ids')

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ message: 'No subscribers' })
  }

  // ── Property-based routing ──
  // Admins receive every alert. Everyone else receives an alert only if the
  // affected property is in their assigned_property_ids (this covers RMs/RSMs,
  // whose managed properties live in that same list). If an event somehow has
  // no propertyId, fall back to notifying everyone so nothing is silently dropped.
  const recipients = subscriptions.filter((row: any) => {
    if (row.role === 'admin') return true
    if (!propertyId) return true
    const assigned = Array.isArray(row.assigned_property_ids) ? row.assigned_property_ids : []
    return assigned.includes(propertyId)
  })

  if (recipients.length === 0) {
    return NextResponse.json({ message: 'No matching subscribers for this property' })
  }

  const payload = JSON.stringify({ title, body })
  const results = await Promise.allSettled(
    recipients.map((row: any) => webpush.sendNotification(row.subscription, payload))
  )

  return NextResponse.json({ sent: results.length, matched: recipients.length, total: subscriptions.length })
}