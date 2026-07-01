import { NextResponse } from 'next/server'

// Sends an email to one or more recipients via Resend.
// The API key stays server-side; the browser never sees it.
export async function POST(request: Request) {
  const { recipients, subject, body } = await request.json()

  const key = process.env.RESEND_API_KEY
  if (!key) {
    return NextResponse.json(
      { ok: false, error: 'Email is not configured yet (RESEND_API_KEY missing in Vercel).' },
      { status: 400 }
    )
  }

  const list: string[] = Array.isArray(recipients) ? recipients.filter(Boolean) : []
  if (list.length === 0) {
    return NextResponse.json({ ok: false, error: 'No recipients.' }, { status: 400 })
  }
  if (!subject || !body) {
    return NextResponse.json({ ok: false, error: 'Subject and message are required.' }, { status: 400 })
  }
  // Safety cap to avoid accidental mass sends
  if (list.length > 200) {
    return NextResponse.json({ ok: false, error: 'Too many recipients (max 200).' }, { status: 400 })
  }

  const from = process.env.ALERT_EMAIL_FROM || 'PEM Dashboard <dashboard@alerts.proequitymgmt.com>'
  const safeBody = String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5;white-space:pre-wrap">' +
    safeBody +
    '</div>'

  let sent = 0
  const failed: string[] = []

  // Send individually so each person gets their own email (no shared To/CC).
  for (const to of list) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html }),
      })
      if (res.ok) sent++
      else failed.push(to)
    } catch {
      failed.push(to)
    }
  }

  return NextResponse.json({ ok: sent > 0, sent, failed })
}