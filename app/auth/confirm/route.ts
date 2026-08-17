import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET LINK HANDLER
//
// This is the page the link in a "Reset your password" email points at. It is
// never opened by hand.
//
// Why it exists: the previous flow (PKCE) kept half of a secret in the browser
// that requested the reset. That only works if the person opens the email in
// that exact same browser. On-site staff request a reset in the PEM home-screen
// app and then tap the link inside Outlook — a different browser — so the
// handshake failed and they were stuck on "Verifying your reset link...".
//
// This route uses the token_hash flow instead. The whole credential travels in
// the link and is verified here, on the server. Nothing is stored in the
// browser beforehand, so the link works on any device, in any mail app.
//
// On success we set the session cookies and send the person to
// /reset-password, where they type their new password.
// On failure we send them to /reset-password?error=... so they see a plain
// explanation and a button to request a fresh link.
// ─────────────────────────────────────────────────────────────────────────────

// Turn Supabase's technical wording into something a Service Manager can act on.
//
// Note: Supabase returns ONE string — "Token has expired or is invalid" — for
// both a genuinely old link and one that has already been used. We must not
// claim to know which, or we send people chasing the wrong problem.
function friendlyMessage(raw: string) {
  const m = (raw || '').toLowerCase()
  if (m.includes('rate') || m.includes('too many')) {
    return 'Too many attempts in a short time. Wait a few minutes, then request a new link below.'
  }
  if (m.includes('expired') || m.includes('invalid') || m.includes('not found')) {
    return 'This reset link is no longer usable — it has either been used already or is too old. Request a new one below and open it within the hour.'
  }
  return raw || 'We could not verify that reset link. Request a new one below.'
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Only ever redirect to a path inside this app — never to an outside URL.
  const requestedNext = searchParams.get('next')
  const next =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/reset-password'

  const failTo = (message: string) =>
    NextResponse.redirect(
      new URL('/reset-password?error=' + encodeURIComponent(message), request.url)
    )

  if (!token_hash || !type) {
    return failTo('That link is incomplete. Some mail apps shorten links — request a new one below.')
  }

  // A token stamped "pkce_" was created by a browser connection running in PKCE
  // mode. Those can only be redeemed by the one browser that asked for them, so
  // verifying here on the server always fails — and Supabase reports that as
  // "expired", which sends people hunting for the wrong problem.
  //
  // Any email still carrying one of these was sent before the reset request was
  // switched to a non-PKCE connection (see app/login/page.tsx). Say so plainly
  // instead of letting it fail with a misleading message.
  if (token_hash.startsWith('pkce_')) {
    return failTo('This link came from an older reset email that is no longer supported. Request a new one below — the new email will work.')
  }

  // Build the success response FIRST so Supabase can write the session cookies
  // onto it while verifying.
  const response = NextResponse.redirect(new URL(next, request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { error } = await supabase.auth.verifyOtp({ type, token_hash })

  if (error) {
    return failTo(friendlyMessage(error.message))
  }

  return response
}