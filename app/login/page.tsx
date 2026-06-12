'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
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

  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'32px',width:'380px',border:'1px solid #e2e8f0'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'24px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🏢</div>
          <div>
            <div style={{fontWeight:'700',fontSize:'15px'}}>PEM Dashboard</div>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>Sign in to your account</div>
          </div>
        </div>
        <div style={{marginBottom:'12px'}}>
          <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Email</div>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder='you@example.com' type='email' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}}/>
        </div>
        <div style={{marginBottom:'16px'}}>
          <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Password</div>
          <input value={password} onChange={e=>setPassword(e.target.value)} placeholder='••••••••' type='password' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
        </div>
        {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',padding:'8px 12px',fontSize:'12px',color:'#dc2626',marginBottom:'12px'}}>{error}</div>}
        <button onClick={handleLogin} disabled={loading} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          {loading?'Signing in...':'Sign In'}
        </button>
      </div>
    </div>
  )
}