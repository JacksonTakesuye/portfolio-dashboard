'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const STATUS_META: Record<string, {label:string,color:string,bg:string,border:string}> = {
  'in-service':     {label:'In Service',     color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
  'out-of-service': {label:'Out of Service', color:'#dc2626', bg:'#fef2f2', border:'#fecaca'},
  'maintenance':    {label:'Maintenance',    color:'#d97706', bg:'#fffbeb', border:'#fde68a'},
}

const REASONS: Record<string, string[]> = {
  elevator: ['Mechanical failure','Electrical issue','Scheduled maintenance','Door malfunction','Emergency stop triggered','Software/controller fault','Other'],
  compactor: ['Mechanical jam','Motor failure','Hydraulic issue','Overfill / blockage','Scheduled maintenance','Other'],
  pool: ['Chemical imbalance','Equipment failure','Scheduled maintenance','Safety closure','Storm damage','Health department order','Other'],
  gate: ['Power failure','Sensor malfunction','Physical damage','Scheduled maintenance','Other'],
}

export default function Home() {
  const [properties, setProperties] = useState<any[]>([])
  const [systems, setSystems] = useState<any[]>([])
  const [statuses, setStatuses] = useState<Record<string,any>>({})
  const [systemInfos, setSystemInfos] = useState<Record<string,any>>({})
  const [psrReports, setPsrReports] = useState<Record<string,any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [selectedProp, setSelectedProp] = useState<string|null>(null)
  const [detailTab, setDetailTab] = useState('systems')
  const [tab, setTab] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [modal, setModal] = useState<any>(null)
  const [form, setForm] = useState({status:'in-service',reason:'',notes:'',reportedBy:''})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string|null>(null)
  const [psrForm, setPsrForm] = useState<any>({})
  const [savingPsr, setSavingPsr] = useState(false)
  const [sysInfoForm, setSysInfoForm] = useState<Record<string,any>>({})
  const [savingSysInfo, setSavingSysInfo] = useState(false)

  useEffect(() => {
    async function loadData() {
      const { data: props, error: e1 } = await supabase.from('properties').select('*')
      const { data: sys, error: e2 } = await supabase.from('systems').select('*')
      const { data: statUpd } = await supabase.from('status_updates').select('*').order('created_at', {ascending: false})
      const { data: sysInfo } = await supabase.from('system_info').select('*')
      const { data: psr } = await supabase.from('psr_reports').select('*').order('report_date', {ascending: false})
      if (e1) setError(e1.message)
      else if (e2) setError(e2.message)
      else {
        setProperties(props || [])
        setSystems(sys || [])
        const latestStatuses: Record<string,any> = {}
        ;(statUpd || []).forEach((s:any) => { if (!latestStatuses[s.system_id]) latestStatuses[s.system_id] = s })
        setStatuses(latestStatuses)
        const infoMap: Record<string,any> = {}
        ;(sysInfo || []).forEach((s:any) => { infoMap[s.system_id] = s })
        setSystemInfos(infoMap)
        const psrMap: Record<string,any> = {}
        ;(psr || []).forEach((p:any) => { if (!psrMap[p.property_id]) psrMap[p.property_id] = p })
        setPsrReports(psrMap)
      }
      setLoading(false)
    }
    loadData()
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(async (reg) => {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return
        const existing = await reg.pushManager.getSubscription()
        const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY })
        await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) })
      }).catch(err => console.log('SW error:', err))
    }
  }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const openModal = (sys: any) => {
    const current = statuses[sys.id]
    setForm({ status: current?.status || 'in-service', reason: current?.reason || '', notes: current?.notes || '', reportedBy: '' })
    setModal(sys)
  }

  const saveStatus = async () => {
    if (!modal) return
    setSaving(true)
    const { error } = await supabase.from('status_updates').insert({ system_id: modal.id, status: form.status, reason: form.reason || null, notes: form.notes || null, reported_by: form.reportedBy || 'Staff' })
    if (error) { showToast('Error saving: ' + error.message) }
    else {
      setStatuses((prev:any) => ({ ...prev, [modal.id]: { system_id: modal.id, status: form.status, reason: form.reason, notes: form.notes, reported_by: form.reportedBy } }))
      showToast('Status updated successfully')
      setModal(null)
      if (form.status === 'out-of-service') {
        await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemName: modal.name, propertyName: detailProp?.name || '', status: form.status, reason: form.reason }) })
      }
    }
    setSaving(false)
  }

  const savePsr = async () => {
    if (!detailProp) return
    setSavingPsr(true)
    const { error } = await supabase.from('psr_reports').insert({ ...psrForm, property_id: detailProp.id, report_date: new Date().toISOString().split('T')[0] })
    if (error) showToast('Error saving PSR: ' + error.message)
    else { showToast('PSR Report saved'); setPsrReports((prev:any) => ({ ...prev, [detailProp.id]: { ...psrForm, property_id: detailProp.id } })) }
    setSavingPsr(false)
  }

  const saveSysInfo = async (systemId: string) => {
    setSavingSysInfo(true)
    const existing = systemInfos[systemId]
    const data = { ...sysInfoForm[systemId], system_id: systemId }
    const { error } = existing
      ? await supabase.from('system_info').update(data).eq('system_id', systemId)
      : await supabase.from('system_info').insert(data)
    if (error) showToast('Error saving: ' + error.message)
    else { showToast('System info saved'); setSystemInfos((prev:any) => ({ ...prev, [systemId]: data })) }
    setSavingSysInfo(false)
  }

  const states = [...new Set(properties.map((p:any) => p.state))].sort()
  const filtered = properties.filter((p:any) => {
    const tabOk = tab==='all'||(tab==='elevators'&&p.has_elevator)||(tab==='compactors'&&p.has_compactor)||(tab==='pools'&&p.has_pool)||(tab==='gates'&&p.has_gate)
    const stOk = stateFilter==='all'||p.state===stateFilter
    return tabOk&&stOk
  })
  const byState = states.map(s=>({state:s,props:filtered.filter((p:any)=>p.state===s)})).filter(g=>g.props.length>0)
  const detailProp = selectedProp ? properties.find((p:any)=>p.id===selectedProp) : null
  const propSystems = detailProp ? systems.filter((s:any)=>s.property_id===detailProp.id) : []
  const getStatus = (sysId: string) => statuses[sysId]?.status || 'in-service'
  const propHasIssue = (prop: any) => systems.filter((s:any)=>s.property_id===prop.id).some((s:any)=>getStatus(s.id)==='out-of-service')
  const TABS = [['all','All'],['elevators','Elevators'],['compactors','Compactors'],['pools','Pools'],['gates','Gates']]
  const DETAIL_TABS = [['systems','Systems'],['psr','PSR Report'],['sysinfo','System Info'],['documents','Documents']]

  if (loading) return <div style={{padding:'40px',fontFamily:'system-ui',textAlign:'center'}}>Loading portfolio...</div>
  if (error) return <div style={{padding:'40px',fontFamily:'system-ui',color:'red'}}>Error: {error}</div>

  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh'}}>
      <div style={{background:'#0f172a',padding:'14px 24px',display:'flex',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>??</div>
          <div>
            <div style={{color:'#f8fafc',fontWeight:'600',fontSize:'15px'}}>Professional Equity Management</div>
            <div style={{color:'#64748b',fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.5px'}}>Portfolio Systems Dashboard</div>
          </div>
        </div>
      </div>
      <div style={{background:'#fff',borderBottom:'1px solid #e2e8f0',padding:'12px 24px',display:'flex',gap:'24px',flexWrap:'wrap'}}>
        {[{v:properties.length,l:'Communities',c:'#1e293b'},{v:properties.filter((p:any)=>p.has_pool).length,l:'Pools',c:'#0369a1'},{v:properties.filter((p:any)=>p.has_gate).length,l:'Gates',c:'#7c3aed'},{v:properties.filter((p:any)=>p.has_elevator).length,l:'Elevators',c:'#b45309'},{v:properties.filter((p:any)=>p.has_compactor).length,l:'Compactors',c:'#0f766e'},{v:systems.filter((s:any)=>getStatus(s.id)==='out-of-service').length,l:'Systems Out',c:'#dc2626'}].map(s=>(
          <div key={s.l}><div style={{fontSize:'22px',fontWeight:'700',color:s.c,lineHeight:'1.1'}}>{s.v}</div><div style={{fontSize:'11px',color:'#94a3b8'}}>{s.l}</div></div>
        ))}
      </div>
      <div style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0',padding:'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
        <div style={{display:'flex',background:'#fff',borderRadius:'7px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
          {TABS.map(([v,l])=>(<button key={v} onClick={()=>setTab(v)} style={{padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:'none',background:tab===v?'#3b82f6':'transparent',color:tab===v?'#fff':'#94a3b8'}}>{l}</button>))}
        </div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
          {['all',...states].map(s=>(<button key={s} onClick={()=>setStateFilter(s)} style={{padding:'3px 9px',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:stateFilter===s?'1.5px solid #3b82f6':'1px solid #e2e8f0',background:stateFilter===s?'#eff6ff':'#fff',color:stateFilter===s?'#1d4ed8':'#64748b'}}>{s==='all'?'All States':s}</button>))}
        </div>
      </div>
      <div style={{display:'flex'}}>
        <div style={{flex:1,padding:'20px 24px'}}>
          {byState.map(group=>(
            <div key={group.state} style={{marginBottom:'28px'}}>
              <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{background:'#1e293b',color:'#fff',borderRadius:'4px',padding:'2px 8px',fontSize:'11px'}}>{group.state}</span>
                <span style={{color:'#94a3b8',fontSize:'12px'}}>{group.props.length} {group.props.length===1?'community':'communities'}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'12px'}}>
                {group.props.map((prop:any)=>(
                  <div key={prop.id} onClick={()=>{setSelectedProp(selectedProp===prop.id?null:prop.id);setDetailTab('systems')}} style={{background:'#fff',borderRadius:'10px',padding:'14px 16px',cursor:'pointer',border:selectedProp===prop.id?'2px solid #3b82f6':'1.5px solid #e2e8f0'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'2px'}}>
                      <div style={{fontWeight:'700',fontSize:'14px'}}>{prop.name}</div>
                      {propHasIssue(prop)&&<span style={{background:'#fef2f2',color:'#dc2626',padding:'2px 7px',borderRadius:'10px',fontSize:'10px',fontWeight:'600'}}>? Issue</span>}
                    </div>
                    <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'8px'}}>{prop.city}</div>
                    <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                      {prop.has_pool&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Pool</span>}
                      {prop.has_gate&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Gate</span>}
                      {prop.has_elevator&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Elevator</span>}
                      {prop.has_compactor&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Compactor</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {detailProp&&(
          <div style={{width:'380px',background:'#fff',borderLeft:'1px solid #e2e8f0',display:'flex',flexDirection:'column',flexShrink:0,height:'calc(100vh - 140px)',position:'sticky',top:'0',overflowY:'auto'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                <div style={{fontWeight:'700',fontSize:'15px'}}>{detailProp.name}</div>
                <button onClick={()=>setSelectedProp(null)} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'#94a3b8'}}>?</button>
              </div>
              <div style={{color:'#64748b',fontSize:'12px',marginBottom:'12px'}}>{detailProp.city}</div>
              <div style={{display:'flex',background:'#f1f5f9',borderRadius:'7px',padding:'3px',gap:'2px'}}>
                {DETAIL_TABS.map(([v,l])=>(<button key={v} onClick={()=>setDetailTab(v)} style={{flex:1,padding:'5px 4px',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:'none',background:detailTab===v?'#fff':'transparent',color:detailTab===v?'#1e293b':'#94a3b8',boxShadow:detailTab===v?'0 1px 3px #0001':''}}>{l}</button>))}
              </div>
            </div>
            <div style={{padding:'16px 20px',flex:1,overflowY:'auto'}}>
              {detailTab==='systems'&&(
                <div>
                  {propSystems.length===0?<div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>:propSystems.map((sys:any)=>{
                    const st=statuses[sys.id]; const statusKey=st?.status||'in-service'; const meta=STATUS_META[statusKey]
                    return (<div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'10px',background:'#fafafa'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
                        <div><div style={{fontWeight:'600',fontSize:'13px'}}>{sys.name}</div><div style={{fontSize:'11px',color:'#64748b',textTransform:'capitalize'}}>{sys.system_type}</div></div>
                        <span style={{background:meta.bg,color:meta.color,border:'1px solid '+meta.border,padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>{meta.label}</span>
                      </div>
                      {st?.reason&&<div style={{fontSize:'11px',color:'#dc2626',marginBottom:'4px'}}>? {st.reason}</div>}
                      {st?.notes&&<div style={{fontSize:'11px',color:'#64748b',fontStyle:'italic',marginBottom:'6px'}}>'{st.notes}'</div>}
                      <button onClick={()=>openModal(sys)} style={{width:'100%',padding:'6px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>Update Status</button>
                    </div>)
                  })}
                </div>
              )}
              {detailTab==='psr'&&(
                <div>
                  <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'12px',color:'#1e293b'}}>Property Status Report</div>
                  {[['Work Orders','work_orders_total','work_orders_over_48h','work_orders_explanation','Total','Over 48 Hours'],['Make Readies','make_readies_total','make_readies_over_7d',null,'Total','Over 7 Days']].map(([label,f1,f2,f3,l1,l2]:any)=>(
                    <div key={label} style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                      <div style={{fontWeight:'600',fontSize:'12px',color:'#334155',marginBottom:'8px'}}>{label}</div>
                      <div style={{display:'flex',gap:'8px',marginBottom:'6px'}}>
                        <div style={{flex:1}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>{l1}</div><input type='number' value={psrForm[f1]||''} onChange={e=>setPsrForm((p:any)=>({...p,[f1]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>
                        <div style={{flex:1}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>{l2}</div><input type='number' value={psrForm[f2]||''} onChange={e=>setPsrForm((p:any)=>({...p,[f2]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>
                      </div>
                      {f3&&<div><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>Explanation</div><input value={psrForm[f3]||''} onChange={e=>setPsrForm((p:any)=>({...p,[f3]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>}
                    </div>
                  ))}
                  <div style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                    <div style={{fontWeight:'600',fontSize:'12px',color:'#334155',marginBottom:'8px'}}>Staffing</div>
                    {[['oncall_staff','Who is On-Call'],['vacation_pto','Vacation / PTO']].map(([f,l])=>(<div key={f} style={{marginBottom:'6px'}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>{l}</div><input value={psrForm[f]||''} onChange={e=>setPsrForm((p:any)=>({...p,[f]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>))}
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'4px'}}><input type='checkbox' checked={psrForm.open_maintenance_position||false} onChange={e=>setPsrForm((p:any)=>({...p,open_maintenance_position:e.target.checked}))}/><span style={{fontSize:'12px',color:'#334155'}}>Open Maintenance Position</span></div>
                  </div>
                  <div style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                    <div style={{fontWeight:'600',fontSize:'12px',color:'#334155',marginBottom:'8px'}}>Amenities</div>
                    {[['pool_status','Pool Status','text'],['elevators_working','Elevators Working','bool'],['tvs_working','TVs Working','bool'],['fitness_center_ok','Fitness Center OK','bool'],['grill_ok','Grill OK','bool'],['mailbox_ok','Mailbox OK','bool']].map(([f,l,type])=>(
                      <div key={f as string} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}>
                        <span style={{fontSize:'12px',color:'#334155'}}>{l as string}</span>
                        {type==='bool'?(<input type='checkbox' checked={psrForm[f as string]!==false} onChange={e=>setPsrForm((p:any)=>({...p,[f as string]:e.target.checked}))}/>):(<input value={psrForm[f as string]||''} onChange={e=>setPsrForm((p:any)=>({...p,[f as string]:e.target.value}))} style={{width:'120px',padding:'4px 6px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px'}}/>)}
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                    <div style={{fontWeight:'600',fontSize:'12px',color:'#334155',marginBottom:'8px'}}>Preventative Maintenance</div>
                    <input value={psrForm.preventative_maintenance||''} onChange={e=>setPsrForm((p:any)=>({...p,preventative_maintenance:e.target.value}))} placeholder='Schedule or notes...' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/>
                    <div style={{marginTop:'8px'}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>Shop Steward</div><input value={psrForm.shop_steward||''} onChange={e=>setPsrForm((p:any)=>({...p,shop_steward:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>
                  </div>
                  <button onClick={savePsr} disabled={savingPsr} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{savingPsr?'Saving...':'Save PSR Report'}</button>
                </div>
              )}
              {detailTab==='sysinfo'&&(
                <div>
                  <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'12px',color:'#1e293b'}}>System Information</div>
                  {propSystems.length===0?<div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>:propSystems.map((sys:any)=>(
                    <div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'12px',background:'#fafafa'}}>
                      <div style={{fontWeight:'600',fontSize:'13px',marginBottom:'10px',color:'#1e293b'}}>{sys.name}</div>
                      {[['model_number','Model Number'],['manufacturer','Manufacturer'],['year_installed','Year Installed'],['warranty_expiry','Warranty Expiry'],['last_inspection','Last Inspection'],['notes','Notes']].map(([f,l])=>(
                        <div key={f} style={{marginBottom:'6px'}}>
                          <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>{l}</div>
                          <input value={sysInfoForm[sys.id]?.[f]||systemInfos[sys.id]?.[f]||''} onChange={e=>setSysInfoForm((p:any)=>({...p,[sys.id]:{...p[sys.id],[f]:e.target.value}}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/>
                        </div>
                      ))}
                      <button onClick={()=>saveSysInfo(sys.id)} disabled={savingSysInfo} style={{width:'100%',padding:'6px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>{savingSysInfo?'Saving...':'Save'}</button>
                    </div>
                  ))}
                </div>
              )}
              {detailTab==='documents'&&(
                <div>
                  <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'12px',color:'#1e293b'}}>Documents</div>
                  <div style={{background:'#f8fafc',borderRadius:'8px',padding:'24px',textAlign:'center',border:'2px dashed #e2e8f0'}}>
                    <div style={{fontSize:'24px',marginBottom:'8px'}}>??</div>
                    <div style={{fontWeight:'600',fontSize:'13px',color:'#334155',marginBottom:'4px'}}>Document Storage</div>
                    <div style={{fontSize:'12px',color:'#94a3b8'}}>PDF upload coming soon. Requires cloud storage setup.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {modal&&(
        <div style={{position:'fixed',inset:0,background:'#0009',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={()=>setModal(null)}>
          <div style={{background:'#fff',borderRadius:'12px',padding:'24px',width:'420px',maxWidth:'92vw'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:'700',fontSize:'16px',marginBottom:'4px'}}>Update Status</div>
            <div style={{color:'#64748b',fontSize:'13px',marginBottom:'16px'}}>{modal.name}</div>
            <div style={{marginBottom:'14px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Status</div>
              <div style={{display:'flex',gap:'8px'}}>
                {['in-service','out-of-service','maintenance'].map(s=>(<button key={s} onClick={()=>setForm(f=>({...f,status:s}))} style={{flex:1,padding:'8px 4px',borderRadius:'7px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:form.status===s?'2px solid '+STATUS_META[s].color:'1px solid #e2e8f0',background:form.status===s?STATUS_META[s].bg:'#f8fafc',color:form.status===s?STATUS_META[s].color:'#64748b'}}>{STATUS_META[s].label}</button>))}
              </div>
            </div>
            {form.status!=='in-service'&&(<div style={{marginBottom:'12px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reason</div><select value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px'}}><option value=''>Select reason...</option>{(REASONS[modal.system_type]||[]).map((r:string)=><option key={r}>{r}</option>)}</select></div>)}
            <div style={{marginBottom:'12px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Notes</div><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder='Context, ETA, vendor info...' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',minHeight:'68px',resize:'vertical',boxSizing:'border-box'}}/></div>
            <div style={{marginBottom:'16px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reported By</div><input value={form.reportedBy} onChange={e=>setForm(f=>({...f,reportedBy:e.target.value}))} placeholder='Your name or role' style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}}/></div>
            <div style={{display:'flex',gap:'10px'}}>
              <button onClick={()=>setModal(null)} style={{flex:1,padding:'10px',background:'#f1f5f9',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#64748b'}}>Cancel</button>
              <button onClick={saveStatus} disabled={saving} style={{flex:2,padding:'10px',background:'#3b82f6',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#fff'}}>{saving?'Saving...':'Save Status'}</button>
            </div>
          </div>
        </div>
      )}
      {toast&&<div style={{position:'fixed',bottom:'20px',right:'20px',background:'#166534',color:'#fff',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',zIndex:300}}>{toast}</div>}
    </div>
  )
}
