import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  const { subscription } = await request.json()
  const endpoint = subscription.endpoint

  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('subscription->>endpoint', endpoint)
    .single()

  if (existing) {
    return NextResponse.json({ success: true, duplicate: true })
  }

  const { error } = await supabase.from('push_subscriptions').insert({
    subscription,
    user_id: null
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
