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
  const { systemName, propertyName, status, reason } = await request.json()
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('subscription')
  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ message: 'No subscribers' })
  }
  const payload = JSON.stringify({
    title: 'System Alert - ' + propertyName,
    body: systemName + ' is now ' + status + (reason ? ': ' + reason : ''),
  })
  const results = await Promise.allSettled(
    subscriptions.map((row: any) =>
      webpush.sendNotification(row.subscription, payload)
    )
  )
  return NextResponse.json({ sent: results.length })
}
