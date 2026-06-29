import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  const { subscription, userId, role, assignedPropertyIds } = await request.json()
  const endpoint = subscription.endpoint

  // Routing info we store alongside the subscription so /api/notify can target it
  const routing = {
    user_id: userId ?? null,
    role: role ?? null,
    assigned_property_ids: Array.isArray(assignedPropertyIds) ? assignedPropertyIds : [],
  }

  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('subscription->>endpoint', endpoint)
    .single()

  if (existing) {
    // Device already known — refresh its routing info in case role/assignments changed
    const { error: upErr } = await supabase
      .from('push_subscriptions')
      .update(routing)
      .eq('id', existing.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    return NextResponse.json({ success: true, updated: true })
  }

  const { error } = await supabase.from('push_subscriptions').insert({
    subscription,
    ...routing,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}