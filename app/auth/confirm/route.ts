import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET LINK HANDLER
//
// This is where the link in a "Reset your password" email lands. Nobody opens
// it by hand.
//
// THE IMPORTANT PART — WHY THERE IS A BUTTON
//
// A reset token can be spent exactly once. Corporate mail security (Microsoft
// Defender Safe Links on our tenant), spam filters and phone mail apps all
// quietly open every link in an incoming email to check it is safe. If simply
// opening the link redeemed the token, the scanner would spend it seconds
// after the email arrives, and the real person would be told their link had
// expired — which is exactly what was happening.
//
// So this route does NOT redeem anything when it is merely opened:
//
//   GET  → returns a small page with a "Set my password" button. Nothing is
//          spent. A scanner sees this page, finds nothing dangerous, and moves
//          on. The token is still good.
//   POST → only happens when a human actually taps the button. This is where
//          the token is redeemed and the session created.
//   HEAD → answered with 200 and nothing else, for scanners that only probe.
//
// Automated scanners issue GET and HEAD. They do not fill in and submit forms.
// That difference is what protects the token.
//
// This page is rendered fresh by the server on every visit, so it cannot be
// affected by an out-of-date copy of the app cached on someone's phone.
// ─────────────────────────────────────────────────────────────────────────────

// Only ever redirect to a path inside this app — never to an outside URL.
function safeNext(raw: string | null) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/reset-password'
}

// Turn Supabase's technical wording into something a Service Manager can act on.
// Supabase returns ONE string — "Token has expired or is invalid" — for both a
// genuinely old link and one already used, so we must not claim to know which.
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The interstitial. Plain HTML and a real form — deliberately no JavaScript, so
// nothing can auto-submit it. A person has to tap.
function confirmPage(token_hash: string, type: string, next: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>PEM Dashboard — Reset your password</title>
</head>
<body style="margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;">
  <div style="background:#fff;border-radius:12px;padding:32px;width:380px;max-width:100%;border:1px solid #e2e8f0;box-sizing:border-box;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
      <div style="width:36px;height:36px;background:#3b82f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">&#127970;</div>
      <div>
        <div style="font-weight:700;font-size:15px;">PEM Dashboard</div>
        <div style="font-size:11px;color:#94a3b8;">Reset your password</div>
      </div>
    </div>

    <p style="font-size:13px;color:#334155;line-height:1.6;margin:0 0 20px;">
      Tap below to continue. This confirms it is really you opening this link and
      not an automatic email scanner.
    </p>

    <form method="POST" action="/auth/confirm">
      <input type="hidden" name="token_hash" value="${escapeHtml(token_hash)}">
      <input type="hidden" name="type" value="${escapeHtml(type)}">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <button type="submit" style="width:100%;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">
        Set my password
      </button>
    </form>

    <p style="font-size:11px;color:#94a3b8;line-height:1.6;margin:16px 0 0;">
      If you did not ask to reset your password, close this page. Nothing will change.
    </p>
  </div>
</body>
</html>`
}

// ─── HEAD: probes get a bare 200. Nothing is read, nothing is spent. ─────────
export async function HEAD() {
  return new NextResponse(null, { status: 200 })
}

// ─── GET: show the button. Never redeems the token. ─────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next'))

  const failTo = (message: string) =>
    NextResponse.redirect(
      new URL('/reset-password?error=' + encodeURIComponent(message), request.url)
    )

  if (!token_hash || !type) {
    return failTo('That link is incomplete. Some mail apps shorten links — request a new one below.')
  }

  // A token stamped "pkce_" was created by a browser connection in PKCE mode and
  // can only be redeemed by that one browser. Any email still carrying one was
  // sent before the reset request was moved to a non-PKCE connection.
  if (token_hash.startsWith('pkce_')) {
    return failTo('This link came from an older reset email that is no longer supported. Request a new one below — the new email will work.')
  }

  return new NextResponse(confirmPage(token_hash, type, next), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never let this page be cached — it is single-use by nature.
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

// ─── POST: a human tapped the button. Redeem the token now. ─────────────────
export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.redirect(
      new URL('/reset-password?error=' + encodeURIComponent('Something went wrong reading that link. Request a new one below.'), request.url),
      303
    )
  }

  const token_hash = String(form.get('token_hash') || '')
  const type = String(form.get('type') || '') as EmailOtpType
  const next = safeNext(String(form.get('next') || ''))

  const failTo = (message: string) =>
    NextResponse.redirect(
      new URL('/reset-password?error=' + encodeURIComponent(message), request.url),
      303
    )

  if (!token_hash || !type) {
    return failTo('That link is incomplete. Request a new one below.')
  }

  // 303 so the browser switches from POST to a normal GET on the next page.
  const response = NextResponse.redirect(new URL(next, request.url), 303)

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