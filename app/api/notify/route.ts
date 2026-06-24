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

  const { type, systemName, propertyName, propertyId, reason, reportDate, noteAuthor, noteText, editedBy, changeSummary } = await request.json()

  let title = ''
  let body  = ''

  if (type === 'out-of-service') {
    title = 'System Alert - ' + propertyName
    body  = systemName + ' is Out of Service' + (reason ? ': ' + reason : '')
  } else if (type === 'maintenance') {
    title = 'Maintenance Alert - ' + propertyName
    body  = systemName + ' has been marked Under Maintenance' + (reason ? ': ' + reason : '')
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

  const { data: subscriptions } = await supabase.from('push_subscriptions').select('subscription')

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ message: 'No subscribers' })
  }

  const payload = JSON.stringify({ title, body })
  const results = await Promise.allSettled(
    subscriptions.map((row: any) => webpush.sendNotification(row.subscription, payload))
  )

  return NextResponse.json({ sent: results.length })
}