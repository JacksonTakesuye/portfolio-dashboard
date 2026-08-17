'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// A SECOND, SEPARATE SUPABASE CONNECTION — USED ONLY TO REQUEST A RESET EMAIL
//
// The main connection below (createBrowserClient) runs in "PKCE" mode, which it
// must, because that is what keeps you signed in across pages. But PKCE also
// changes the kind of reset token Supabase puts in the email: it comes out
// stamped "pkce_" and can only be redeemed by the exact browser that asked for
// it. Our /auth/confirm route redeems tokens on the server, so a pkce_ token is
// rejected there and the person is told their link expired.
//
// This second connection is deliberately NOT in PKCE mode, so the reset email
// carries a plain token that /auth/confirm can verify from anywhere. It never
// touches the login session: persistSession is off, so it cannot overwrite or
// interfere with the real connection.
// ─────────────────────────────────────────────────────────────────────────────
const resetRequestClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
)

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
  // ─── Forgot-password state ───
  const [mode, setMode] = useState<'login'|'forgot'>('login')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleLogin = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  // Send the password-reset email. Supabase emails a link that lands on
  // /auth/confirm, which verifies it and forwards to /reset-password.
  // Note this uses resetRequestClient (non-PKCE) — see the comment at the top.
  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email address first.'); return }
    setResetLoading(true)
    setError(null)
    const { error } = await resetRequestClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    setResetLoading(false)
    if (error) {
      setError(error.message)
    } else {
      // Always show success regardless, so we don't reveal which emails are registered.
      setResetSent(true)
    }
  }

  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'32px',width:'380px',border:'1px solid #e2e8f0'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'24px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🏢</div>
          <div>
            <div style={{fontWeight:'700',fontSize:'15px'}}>PEM Dashboard</div>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>{mode==='login'?'Sign in to your account':'Reset your password'}</div>
          </div>
        </div>

        {/* ─── LOGIN MODE ─── */}
        {mode==='login' && (
          <>
            <div style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Email</div>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder='you@example.com' type='email' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}}/>
            </div>
            <div style={{marginBottom:'8px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Password</div>
              <input value={password} onChange={e=>setPassword(e.target.value)} placeholder='••••••••' type='password' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
            </div>
            {/* Forgot password link */}
            <div style={{textAlign:'right',marginBottom:'16px'}}>
              <button
                onClick={()=>{ setMode('forgot'); setError(null); setResetSent(false) }}
                style={{background:'none',border:'none',color:'#3b82f6',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:0}}
              >
                Forgot password?
              </button>
            </div>
            {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',padding:'8px 12px',fontSize:'12px',color:'#dc2626',marginBottom:'12px'}}>{error}</div>}
            <button onClick={handleLogin} disabled={loading} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              {loading?'Signing in...':'Sign In'}
            </button>
          </>
        )}

        {/* ─── FORGOT-PASSWORD MODE ─── */}
        {mode==='forgot' && (
          <>
            {resetSent ? (
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'7px',padding:'12px',fontSize:'12px',color:'#166534',marginBottom:'16px'}}>
                If an account exists for <strong>{email}</strong>, a password reset link has been sent. Check your inbox (and spam folder), then follow the link to set a new password.
              </div>
            ) : (
              <>
                <div style={{fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>
                  Enter the email associated with your account and we'll send you a link to reset your password.
                </div>
                <div style={{marginBottom:'16px'}}>
                  <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Email</div>
                  <input value={email} onChange={e=>setEmail(e.target.value)} placeholder='you@example.com' type='email' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}} onKeyDown={e=>e.key==='Enter'&&handleForgotPassword()}/>
                </div>
                {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',padding:'8px 12px',fontSize:'12px',color:'#dc2626',marginBottom:'12px'}}>{error}</div>}
                <button onClick={handleForgotPassword} disabled={resetLoading} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginBottom:'10px'}}>
                  {resetLoading?'Sending...':'Send Reset Link'}
                </button>
              </>
            )}
            <button
              onClick={()=>{ setMode('login'); setError(null); setResetSent(false) }}
              style={{width:'100%',background:'none',border:'none',color:'#64748b',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:'4px'}}
            >
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  )
}
