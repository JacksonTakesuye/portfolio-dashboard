'use client'
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// SET A NEW PASSWORD
//
// People arrive here from /auth/confirm, which has already validated the link
// from their reset email and signed them into a temporary "recovery" session.
//
// Three things can be on screen:
//   1. The new-password form  — the link was good.
//   2. An explanation + "Send me a new link" — the link was bad, expired or
//      already used. The reason is passed in as ?error=...
//   3. A success message      — the password was changed. We then sign them
//      out and send them to /login so they immediately confirm the new
//      password works, rather than finding out tomorrow morning.
// ─────────────────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {background:'#fff',borderRadius:'12px',padding:'32px',width:'380px',maxWidth:'100%',border:'1px solid #e2e8f0'}
const LABEL: React.CSSProperties = {fontSize:'12px',fontWeight:600,color:'#334155',marginBottom:'6px'}
const INPUT: React.CSSProperties = {width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}
const BUTTON: React.CSSProperties = {width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:600,cursor:'pointer'}
const ERRBOX: React.CSSProperties = {background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',padding:'10px 12px',fontSize:'12px',color:'#dc2626',marginBottom:'12px',lineHeight:1.5}
const OKBOX: React.CSSProperties = {background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'7px',padding:'12px',fontSize:'13px',color:'#166534',lineHeight:1.5}

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // 'checking' → still verifying | 'ready' → show the form | 'blocked' → bad link
  const [stage, setStage] = useState<'checking'|'ready'|'blocked'>('checking')
  const [linkProblem, setLinkProblem] = useState<string|null>(null)

  // "Send me a new link" state
  const [resendEmail, setResendEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSent, setResendSent] = useState(false)

  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    // Did /auth/confirm hand us a reason the link failed?
    const params = new URLSearchParams(window.location.search)
    const passedError = params.get('error')
    if (passedError) {
      setLinkProblem(passedError)
      setStage('blocked')
      // Clean the address bar so a refresh doesn't re-show a stale message.
      window.history.replaceState({}, '', window.location.pathname)
      return
    }

    let settled = false

    // Older links (sent before this fix) still establish the session in the
    // browser, so keep listening for that too.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        settled = true
        setStage('ready')
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true
        setStage('ready')
      }
    })

    // If nothing has established a session after a few seconds, stop spinning
    // and tell the person what to do instead of leaving them stuck.
    const timer = setTimeout(() => {
      if (!settled) {
        setLinkProblem('We could not verify your reset link. It may have expired, already been used, or been opened without going through the email. Request a new one below.')
        setStage('blocked')
      }
    }, 4000)

    return () => { subscription.unsubscribe(); clearTimeout(timer) }
  }, [])

  const handleReset = async () => {
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setLoading(false)
      const m = error.message.toLowerCase()
      if (m.includes('session') || m.includes('jwt')) {
        setLinkProblem('Your reset link timed out before the password was saved. Request a new one below — the whole process needs to be finished in one sitting.')
        setStage('blocked')
      } else if (m.includes('different from the old')) {
        setError('That is the same as your current password. Choose a different one.')
      } else {
        setError(error.message)
      }
      return
    }
    setDone(true)
    // Sign the recovery session out so they log in fresh and confirm it worked.
    await supabase.auth.signOut()
    setLoading(false)
    setTimeout(() => { router.push('/login') }, 2500)
  }

  const handleResend = async () => {
    if (!resendEmail) { setError('Enter your email address first.'); return }
    setResendLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: window.location.origin + '/reset-password',
    })
    setResendLoading(false)
    if (error) { setError(error.message); return }
    setResendSent(true)
  }

  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
      <div style={CARD}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'24px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🏢</div>
          <div>
            <div style={{fontWeight:700,fontSize:'15px'}}>PEM Dashboard</div>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>Set a new password</div>
          </div>
        </div>

        {done ? (
          <div style={OKBOX}>
            Your password has been updated. Taking you to the sign-in screen so you can log in with it now.
          </div>
        ) : stage === 'checking' ? (
          <div style={{fontSize:'13px',color:'#64748b',textAlign:'center',padding:'12px'}}>
            Verifying your reset link...
          </div>
        ) : stage === 'blocked' ? (
          <>
            <div style={ERRBOX}>{linkProblem}</div>
            {resendSent ? (
              <div style={{...OKBOX,fontSize:'12px'}}>
                If an account exists for <strong>{resendEmail}</strong>, a new reset link is on its way. Open it on this device and finish setting your password in one sitting.
              </div>
            ) : (
              <>
                <div style={{marginBottom:'12px'}}>
                  <div style={LABEL}>Email</div>
                  <input value={resendEmail} onChange={e=>setResendEmail(e.target.value)} placeholder='you@proequitymgmt.com' type='email' style={INPUT} onKeyDown={e=>e.key==='Enter'&&handleResend()}/>
                </div>
                {error && <div style={ERRBOX}>{error}</div>}
                <button onClick={handleResend} disabled={resendLoading} style={BUTTON}>
                  {resendLoading ? 'Sending...' : 'Send me a new link'}
                </button>
              </>
            )}
            <button
              onClick={()=>router.push('/login')}
              style={{width:'100%',background:'none',border:'none',color:'#64748b',fontSize:'12px',fontWeight:600,cursor:'pointer',padding:'10px 4px 0'}}
            >
              ← Back to sign in
            </button>
          </>
        ) : (
          <>
            <div style={{marginBottom:'12px'}}>
              <div style={LABEL}>New Password</div>
              <input value={password} onChange={e=>setPassword(e.target.value)} placeholder='At least 8 characters' type='password' style={INPUT}/>
            </div>
            <div style={{marginBottom:'16px'}}>
              <div style={LABEL}>Confirm New Password</div>
              <input value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder='Re-enter password' type='password' style={INPUT} onKeyDown={e=>e.key==='Enter'&&handleReset()}/>
            </div>
            {error && <div style={ERRBOX}>{error}</div>}
            <button onClick={handleReset} disabled={loading} style={BUTTON}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
