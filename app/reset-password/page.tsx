'use client'
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // When the user arrives from the reset email, Supabase puts them in a temporary
  // "recovery" session. We confirm that session exists before showing the form.
  useEffect(()=>{
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event)=>{
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
      }
    })
    // Also check immediately in case the event already fired
    supabase.auth.getSession().then(({data})=>{
      if (data.session) setReady(true)
    })
    return ()=>{ subscription.unsubscribe() }
  },[])

  const handleReset = async () => {
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setDone(true)
      // Send them to login after a short pause
      setTimeout(()=>{ router.push('/login') }, 2500)
    }
  }

  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'32px',width:'380px',border:'1px solid #e2e8f0'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'24px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🏢</div>
          <div>
            <div style={{fontWeight:'700',fontSize:'15px'}}>PEM Dashboard</div>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>Set a new password</div>
          </div>
        </div>

        {done ? (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'7px',padding:'12px',fontSize:'13px',color:'#166534'}}>
            Your password has been updated. Redirecting you to sign in...
          </div>
        ) : !ready ? (
          <div style={{fontSize:'13px',color:'#64748b',textAlign:'center',padding:'12px'}}>
            Verifying your reset link... If this message persists, the link may have expired. Request a new one from the sign-in page.
          </div>
        ) : (
          <>
            <div style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>New Password</div>
              <input value={password} onChange={e=>setPassword(e.target.value)} placeholder='At least 8 characters' type='password' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}}/>
            </div>
            <div style={{marginBottom:'16px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Confirm New Password</div>
              <input value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder='Re-enter password' type='password' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}} onKeyDown={e=>e.key==='Enter'&&handleReset()}/>
            </div>
            {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',padding:'8px 12px',fontSize:'12px',color:'#dc2626',marginBottom:'12px'}}>{error}</div>}
            <button onClick={handleReset} disabled={loading} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              {loading?'Updating...':'Update Password'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
