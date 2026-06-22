'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const STATUS_META: Record<string,{label:string,color:string,bg:string,border:string}> = {'in-service':{label:'In Service',color:'#16a34a',bg:'#f0fdf4',border:'#bbf7d0'},'out-of-service':{label:'Out of Service',color:'#dc2626',bg:'#fef2f2',border:'#fecaca'},'maintenance':{label:'Maintenance',color:'#d97706',bg:'#fffbeb',border:'#fde68a'}}
const REASONS: Record<string,string[]> = {elevator:['Mechanical failure','Electrical issue','Scheduled maintenance','Door malfunction','Emergency stop triggered','Software/controller fault','Other'],compactor:['Mechanical jam','Motor failure','Hydraulic issue','Overfill / blockage','Scheduled maintenance','Other'],pool:['Chemical imbalance','Equipment failure','Scheduled maintenance','Safety closure','Storm damage','Health department order','Other'],gate:['Power failure','Sensor malfunction','Physical damage','Scheduled maintenance','Other']}
const SI = (label:string,f:string,form:any,setForm:any) => (<div style={{marginBottom:'6px'}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>{label}</div><input value={form[f]||''} onChange={e=>setForm((p:any)=>({...p,[f]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box' as any}}/></div>)
const CB = (label:string,f:string,form:any,setForm:any) => (<div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'6px'}}><input type='checkbox' checked={!!form[f]} onChange={e=>setForm((p:any)=>({...p,[f]:e.target.checked}))}/><span style={{fontSize:'12px',color:'#334155'}}>{label}</span></div>)
const SEC = (title:string,children:any) => (<div style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}><div style={{fontWeight:'700',fontSize:'12px',color:'#1e293b',marginBottom:'8px',borderBottom:'1px solid #e2e8f0',paddingBottom:'4px'}}>{title}</div>{children}</div>)
export default function Home() {
  const [properties,setProperties]=useState<any[]>([])
  const [systems,setSystems]=useState<any[]>([])
  const [statuses,setStatuses]=useState<Record<string,any>>({})
  const [systemInfos,setSystemInfos]=useState<Record<string,any>>({})
  const [allPsrReports,setAllPsrReports]=useState<any[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  const [selectedProp,setSelectedProp]=useState<string|null>(null)
  const [detailTab,setDetailTab]=useState('systems')
  const [psrMode,setPsrMode]=useState<'history'|'new'>('history')
  const [psrSearch,setPsrSearch]=useState('')
  const [psrSort,setPsrSort]=useState<'newest'|'oldest'>('newest')
  const [expandedPsr,setExpandedPsr]=useState<number|null>(null)
  const [tab,setTab]=useState('all')
  const [stateFilter,setStateFilter]=useState('all')
  const [modal,setModal]=useState<any>(null)
  const [form,setForm]=useState({status:'in-service',reason:'',notes:'',reportedBy:''})
  const [saving,setSaving]=useState(false)
  const [toast,setToast]=useState<string|null>(null)
  const [psrForm,setPsrForm]=useState<any>({})
  const [savingPsr,setSavingPsr]=useState(false)
  const [sysInfoForm,setSysInfoForm]=useState<Record<string,any>>({})
  const [savingSysInfo,setSavingSysInfo]=useState(false)
  useEffect(()=>{
    async function loadData(){
      const {data:props,error:e1}=await supabase.from('properties').select('*')
      const {data:sys,error:e2}=await supabase.from('systems').select('*')
      const {data:statUpd}=await supabase.from('status_updates').select('*').order('created_at',{ascending:false})
      const {data:sysInfo}=await supabase.from('system_info').select('*')
      const {data:psr}=await supabase.from('psr_reports').select('*').order('report_date',{ascending:false})
      if(e1)setError(e1.message)
      else if(e2)setError(e2.message)
      else{
        setProperties(props||[])
        setSystems(sys||[])
        const ls:Record<string,any>={};(statUpd||[]).forEach((s:any)=>{if(!ls[s.system_id])ls[s.system_id]=s});setStatuses(ls)
        const im:Record<string,any>={};(sysInfo||[]).forEach((s:any)=>{im[s.system_id]=s});setSystemInfos(im)
        setAllPsrReports(psr||[])
      }
      setLoading(false)
    }
    loadData()
  },[])
  useEffect(()=>{
    if('serviceWorker' in navigator&&'PushManager' in window){
      navigator.serviceWorker.register('/sw.js').then(async(reg)=>{
        const permission=await Notification.requestPermission()
        if(permission!=='granted')return
        const existing=await reg.pushManager.getSubscription()
        const sub=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY})
        await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})})
      }).catch(err=>console.log('SW error:',err))
    }
  },[])
  const showToast=(msg:string)=>{setToast(msg);setTimeout(()=>setToast(null),3000)}
  const openModal=(sys:any)=>{const current=statuses[sys.id];setForm({status:current?.status||'in-service',reason:current?.reason||'',notes:current?.notes||'',reportedBy:''});setModal(sys)}
  const saveStatus=async()=>{
    if(!modal)return;setSaving(true)
    const{error}=await supabase.from('status_updates').insert({system_id:modal.id,status:form.status,reason:form.reason||null,notes:form.notes||null,reported_by:form.reportedBy||'Staff'})
    if(error){showToast('Error: '+error.message)}else{
      setStatuses((prev:any)=>({...prev,[modal.id]:{system_id:modal.id,status:form.status,reason:form.reason,notes:form.notes}}))
      showToast('Status updated');setModal(null)
      if(form.status==='out-of-service')await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemName:modal.name,propertyName:detailProp?.name||'',status:form.status,reason:form.reason})})
    }
    setSaving(false)
  }
  const savePsr=async()=>{
    if(!detailProp)return;setSavingPsr(true)
    const{data,error}=await supabase.from('psr_reports').insert({...psrForm,property_id:detailProp.id,report_date:new Date().toISOString().split('T')[0]}).select()
    if(error)showToast('Error: '+error.message)
    else{showToast('PSR saved');setAllPsrReports((prev:any)=>[...(data||[]),...prev]);setPsrForm({});setPsrMode('history')}
    setSavingPsr(false)
  }
  const saveSysInfo=async(systemId:string)=>{
    setSavingSysInfo(true)
    const existing=systemInfos[systemId]
    const data={...sysInfoForm[systemId],system_id:systemId}
    const{error}=existing?await supabase.from('system_info').update(data).eq('system_id',systemId):await supabase.from('system_info').insert(data)
    if(error)showToast('Error: '+error.message)
    else{showToast('Saved');setSystemInfos((prev:any)=>({...prev,[systemId]:data}))}
    setSavingSysInfo(false)
  }
  const states=[...new Set(properties.map((p:any)=>p.state))].sort()
  const filtered=properties.filter((p:any)=>{const tabOk=tab==='all'||(tab==='elevators'&&p.has_elevator)||(tab==='compactors'&&p.has_compactor)||(tab==='pools'&&p.has_pool)||(tab==='gates'&&p.has_gate);const stOk=stateFilter==='all'||p.state===stateFilter;return tabOk&&stOk})
  const byState=states.map(s=>({state:s,props:filtered.filter((p:any)=>p.state===s)})).filter(g=>g.props.length>0)
  const detailProp=selectedProp?properties.find((p:any)=>p.id===selectedProp):null
  const propSystems=detailProp?systems.filter((s:any)=>s.property_id===detailProp.id):[]
  const getStatus=(sysId:string)=>statuses[sysId]?.status||'in-service'
  const propHasIssue=(prop:any)=>systems.filter((s:any)=>s.property_id===prop.id).some((s:any)=>getStatus(s.id)==='out-of-service')
  const TABS=[['all','All'],['elevators','Elevators'],['compactors','Compactors'],['pools','Pools'],['gates','Gates']]
  const DETAIL_TABS=[['systems','Systems'],['psr','PSR Report'],['sysinfo','System Info'],['documents','Documents']]
  const propPsrReports=detailProp?allPsrReports.filter((r:any)=>r.property_id===detailProp.id):[]
  const filteredPsr=propPsrReports.filter((r:any)=>!psrSearch||r.report_date?.includes(psrSearch)).sort((a:any,b:any)=>psrSort==='newest'?new Date(b.report_date).getTime()-new Date(a.report_date).getTime():new Date(a.report_date).getTime()-new Date(b.report_date).getTime())
  if(loading)return <div style={{padding:'40px',textAlign:'center'}}>Loading...</div>
  if(error)return <div style={{padding:'40px',color:'red'}}>Error: {error}</div>
  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh'}}>
      <div style={{background:'#0f172a',padding:'14px 24px',display:'flex',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>??</div>
          <div><div style={{color:'#f8fafc',fontWeight:'600',fontSize:'15px'}}>Professional Equity Management</div><div style={{color:'#64748b',fontSize:'11px'}}>Portfolio Systems Dashboard</div></div>
        </div>
      </div>
      <div style={{background:'#fff',borderBottom:'1px solid #e2e8f0',padding:'12px 24px',display:'flex',gap:'24px',flexWrap:'wrap'}}>
        {[{v:properties.length,l:'Communities',c:'#1e293b'},{v:properties.filter((p:any)=>p.has_pool).length,l:'Pools',c:'#0369a1'},{v:properties.filter((p:any)=>p.has_gate).length,l:'Gates',c:'#7c3aed'},{v:properties.filter((p:any)=>p.has_elevator).length,l:'Elevators',c:'#b45309'},{v:properties.filter((p:any)=>p.has_compactor).length,l:'Compactors',c:'#0f766e'},{v:systems.filter((s:any)=>getStatus(s.id)==='out-of-service').length,l:'Systems Out',c:'#dc2626'}].map(s=>(<div key={s.l}><div style={{fontSize:'22px',fontWeight:'700',color:s.c}}>{s.v}</div><div style={{fontSize:'11px',color:'#94a3b8'}}>{s.l}</div></div>))}
      </div>
      <div style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0',padding:'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
        <div style={{display:'flex',background:'#fff',borderRadius:'7px',border:'1px solid #e2e8f0',overflow:'hidden'}}>{TABS.map(([v,l])=>(<button key={v} onClick={()=>setTab(v)} style={{padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:'none',background:tab===v?'#3b82f6':'transparent',color:tab===v?'#fff':'#94a3b8'}}>{l}</button>))}</div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>{['all',...states].map(s=>(<button key={s} onClick={()=>setStateFilter(s)} style={{padding:'3px 9px',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:stateFilter===s?'1.5px solid #3b82f6':'1px solid #e2e8f0',background:stateFilter===s?'#eff6ff':'#fff',color:stateFilter===s?'#1d4ed8':'#64748b'}}>{s==='all'?'All States':s}</button>))}</div>
      </div>
      <div style={{display:'flex'}}>
        <div style={{flex:1,padding:'20px 24px'}}>
          {byState.map(group=>(<div key={group.state} style={{marginBottom:'28px'}}><div style={{fontWeight:'700',fontSize:'13px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'8px'}}><span style={{background:'#1e293b',color:'#fff',borderRadius:'4px',padding:'2px 8px',fontSize:'11px'}}>{group.state}</span><span style={{color:'#94a3b8',fontSize:'12px'}}>{group.props.length} {group.props.length===1?'community':'communities'}</span></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'12px'}}>{group.props.map((prop:any)=>(<div key={prop.id} onClick={()=>{setSelectedProp(selectedProp===prop.id?null:prop.id);setDetailTab('systems');setPsrMode('history')}} style={{background:'#fff',borderRadius:'10px',padding:'14px 16px',cursor:'pointer',border:selectedProp===prop.id?'2px solid #3b82f6':'1.5px solid #e2e8f0'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'2px'}}><div style={{fontWeight:'700',fontSize:'14px'}}>{prop.name}</div>{propHasIssue(prop)&&<span style={{background:'#fef2f2',color:'#dc2626',padding:'2px 7px',borderRadius:'10px',fontSize:'10px',fontWeight:'600'}}>? Issue</span>}</div><div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'8px'}}>{prop.city}</div><div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>{prop.has_pool&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Pool</span>}{prop.has_gate&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Gate</span>}{prop.has_elevator&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Elevator</span>}{prop.has_compactor&&<span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 7px',borderRadius:'10px',fontSize:'11px',fontWeight:'600'}}>Compactor</span>}</div></div>))}</div></div>))}
        </div>
        {detailProp&&(
          <div style={{width:'400px',background:'#fff',borderLeft:'1px solid #e2e8f0',display:'flex',flexDirection:'column',flexShrink:0,height:'calc(100vh - 140px)',position:'sticky',top:'0',overflowY:'auto'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}><div style={{fontWeight:'700',fontSize:'15px'}}>{detailProp.name}</div><button onClick={()=>setSelectedProp(null)} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'#94a3b8'}}>?</button></div>
              <div style={{color:'#64748b',fontSize:'12px',marginBottom:'12px'}}>{detailProp.city}</div>
              <div style={{display:'flex',background:'#f1f5f9',borderRadius:'7px',padding:'3px',gap:'2px'}}>{DETAIL_TABS.map(([v,l])=>(<button key={v} onClick={()=>setDetailTab(v)} style={{flex:1,padding:'5px 4px',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:'none',background:detailTab===v?'#fff':'transparent',color:detailTab===v?'#1e293b':'#94a3b8'}}>{l}</button>))}</div>
            </div>
            <div style={{padding:'16px 20px',flex:1,overflowY:'auto'}}>
              {detailTab==='systems'&&(<div>{propSystems.length===0?<div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>:propSystems.map((sys:any)=>{const st=statuses[sys.id];const statusKey=st?.status||'in-service';const meta=STATUS_META[statusKey];return(<div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'10px',background:'#fafafa'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}><div><div style={{fontWeight:'600',fontSize:'13px'}}>{sys.name}</div><div style={{fontSize:'11px',color:'#64748b',textTransform:'capitalize'}}>{sys.system_type}</div></div><span style={{background:meta.bg,color:meta.color,border:'1px solid '+meta.border,padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>{meta.label}</span></div>{st?.reason&&<div style={{fontSize:'11px',color:'#dc2626',marginBottom:'4px'}}>? {st.reason}</div>}{st?.notes&&<div style={{fontSize:'11px',color:'#64748b',fontStyle:'italic',marginBottom:'6px'}}>{st.notes}</div>}<button onClick={()=>openModal(sys)} style={{width:'100%',padding:'6px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Update Status</button></div>)})}</div>)}
              {detailTab==='psr'&&(
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
                    <div style={{fontWeight:'700',fontSize:'13px',color:'#1e293b'}}>PSR Reports</div>
                    <button onClick={()=>setPsrMode(psrMode==='history'?'new':'history')} style={{padding:'5px 10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>{psrMode==='history'?'+ New Report':'View History'}</button>
                  </div>
                  {psrMode==='history'&&(
                    <div>
                      <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
                        <input value={psrSearch} onChange={e=>setPsrSearch(e.target.value)} placeholder='Search by date (YYYY-MM-DD)...' style={{flex:1,padding:'6px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px'}}/>
                        <select value={psrSort} onChange={e=>setPsrSort(e.target.value as any)} style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px'}}><option value='newest'>Newest</option><option value='oldest'>Oldest</option></select>
                      </div>
                      {filteredPsr.length===0?<div style={{fontSize:'12px',color:'#94a3b8',textAlign:'center',padding:'20px'}}>No PSR reports found.</div>:filteredPsr.map((r:any)=>(<div key={r.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',marginBottom:'8px',overflow:'hidden'}}><div onClick={()=>setExpandedPsr(expandedPsr===r.id?null:r.id)} style={{padding:'10px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc'}}><div><div style={{fontWeight:'600',fontSize:'12px',color:'#1e293b'}}>{r.report_date}</div><div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>{r.oncall_staff?'On-call: '+r.oncall_staff:''}</div></div><span style={{fontSize:'12px',color:'#94a3b8'}}>{expandedPsr===r.id?'?':'?'}</span></div>{expandedPsr===r.id&&(<div style={{padding:'12px',borderTop:'1px solid #e2e8f0',fontSize:'12px'}}>{[['Work Orders Total',r.work_orders_total],['Work Orders Over 48h',r.work_orders_over_48h],['Work Orders Explanation',r.work_orders_explanation],['Make Readies Total',r.make_readies_total],['Make Readies Over 7 Days',r.make_readies_over_7d],['On-Call Staff',r.oncall_staff],['Vacation/PTO',r.vacation_pto],['Shop Steward',r.shop_steward],['Prev. Maintenance',r.preventative_maintenance],['Pool Status',r.pool_operational],['Spa Status',r.spa_operational],['Chemical Levels',r.chemical_levels_checked],['Pool Area Cleanliness',r.pool_area_cleanliness],['Fitness Equipment',r.fitness_equipment],['Fitness Cleanliness',r.fitness_cleanliness],['Grill Condition',r.grill_condition],['Entry Gate',r.gate_entry],['Exit Gate',r.gate_exit],['Elevator 1',r.elevator_1],['Elevator 2',r.elevator_2],['Common Areas',r.common_clubhouse],['Dog Station',r.dog_station_cleaned]].filter(([,v])=>v!=null&&v!=='').map(([l,v])=>(<div key={l as string} style={{display:'flex',justifyContent:'space-between',marginBottom:'4px',paddingBottom:'4px',borderBottom:'1px solid #f1f5f9'}}><span style={{color:'#64748b'}}>{l as string}</span><span style={{fontWeight:'500',color:'#1e293b'}}>{String(v)}</span></div>))}</div>))}</div>))}
                    </div>
                  )}
                  {psrMode==='new'&&(
                    <div>
                      {SEC('Work Orders & Make Readies',<div>{SI('Work Orders Total','work_orders_total',psrForm,setPsrForm)}{SI('Work Orders Over 48h','work_orders_over_48h',psrForm,setPsrForm)}{SI('Work Orders Explanation','work_orders_explanation',psrForm,setPsrForm)}{SI('Make Readies Total','make_readies_total',psrForm,setPsrForm)}{SI('Make Readies Over 7 Days','make_readies_over_7d',psrForm,setPsrForm)}</div>)}
                      {SEC('Staffing',<div>{SI('Who is On-Call','oncall_staff',psrForm,setPsrForm)}{SI('Vacation / PTO','vacation_pto',psrForm,setPsrForm)}{CB('Open Maintenance Position','open_maintenance_position',psrForm,setPsrForm)}{SI('Shop Steward','shop_steward',psrForm,setPsrForm)}{SI('Preventative Maintenance Notes','preventative_maintenance',psrForm,setPsrForm)}</div>)}
                      {SEC('Pool / Spa',<div>{SI('Pool Status','pool_operational',psrForm,setPsrForm)}{SI('Spa Status','spa_operational',psrForm,setPsrForm)}{SI('Chemical Levels','chemical_levels_checked',psrForm,setPsrForm)}{SI('CYA Tracking','cya_tracking_updated',psrForm,setPsrForm)}{SI('Pool Furniture Condition','pool_furniture_condition',psrForm,setPsrForm)}{SI('Pool Gates Secured','pool_gates_secured',psrForm,setPsrForm)}{SI('Pool Area Cleanliness','pool_area_cleanliness',psrForm,setPsrForm)}{SI('Pool/Spa Notes','pool_spa_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Fitness Center',<div>{SI('Equipment Status','fitness_equipment',psrForm,setPsrForm)}{SI('Cleanliness','fitness_cleanliness',psrForm,setPsrForm)}{SI('Sanitizing Supplies','fitness_supplies_stocked',psrForm,setPsrForm)}{SI('Access Control','fitness_access_control',psrForm,setPsrForm)}{SI('Fitness Notes','fitness_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Grills / Outdoor Cooking',<div>{SI('Grill Condition','grill_condition',psrForm,setPsrForm)}{SI('Grill Area Cleanliness','grill_area_cleanliness',psrForm,setPsrForm)}{CB('Propane Full','propane_full',psrForm,setPsrForm)}{CB('Propane Needed','propane_needed',psrForm,setPsrForm)}{CB('Charcoal Full','charcoal_full',psrForm,setPsrForm)}{CB('Charcoal Needed','charcoal_needed',psrForm,setPsrForm)}{SI('Grill Notes','grill_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Mailbox Center',<div>{SI('Mailboxes Secured','mailboxes_secured',psrForm,setPsrForm)}{SI('Parcel Lockers Working','parcel_lockers_working',psrForm,setPsrForm)}{SI('Area Cleanliness','mailbox_area_cleanliness',psrForm,setPsrForm)}{SI('Lighting Operational','mailbox_lighting',psrForm,setPsrForm)}{SI('Mailbox Notes','mailbox_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Fireplaces / Firepits',<div>{SI('Clubhouse Fireplace','clubhouse_fireplace_operational',psrForm,setPsrForm)}{SI('Outdoor Fireplace','outdoor_fireplace_operational',psrForm,setPsrForm)}{SI('Fireplace Notes','fireplace_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Elevators',<div>{['elevator_1','elevator_2','elevator_3','elevator_4','elevator_5','elevator_6'].map((f,i)=>(<div key={f}>{SI('Elevator '+(i+1)+' Status',f,psrForm,setPsrForm)}</div>))}{SI('Elevator Notes','elevator_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('TV / Media Equipment',<div>{SI('Clubhouse TVs','tv_clubhouse',psrForm,setPsrForm)}{SI('Pool TVs','tv_pool',psrForm,setPsrForm)}{SI('Fitness Center TVs','tv_fitness',psrForm,setPsrForm)}{SI('Lounge / Common Area TVs','tv_lounge',psrForm,setPsrForm)}{SI('TV Notes','tv_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Gates / Access Control',<div>{SI('Entry Gate','gate_entry',psrForm,setPsrForm)}{SI('Exit Gate','gate_exit',psrForm,setPsrForm)}{SI('Pedestrian Gates','gate_pedestrian',psrForm,setPsrForm)}{SI('Access System / Call Box','gate_access_system',psrForm,setPsrForm)}{SI('Gate Notes','gate_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Common Areas',<div>{[['common_clubhouse','Clubhouse'],['common_hallways','Hallways'],['common_breezeways','Breezeways'],['common_parking','Parking Areas'],['common_landscaping','Landscaping'],['common_sidewalks','Sidewalks'],['common_trash','Trash Areas']].map(([f,l])=>(<div key={f}>{SI(l,f,psrForm,setPsrForm)}</div>))}{SI('Common Area Notes','common_area_notes',psrForm,setPsrForm)}</div>)}
                      {SEC('Dog Stations',<div>{SI('Cleaned','dog_station_cleaned',psrForm,setPsrForm)}{SI('Damaged','dog_station_damaged',psrForm,setPsrForm)}{SI('Bags Stocked','dog_station_bags',psrForm,setPsrForm)}{SI('Dog Station Notes','dog_station_notes',psrForm,setPsrForm)}</div>)}
                      <button onClick={savePsr} disabled={savingPsr} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'8px'}}>{savingPsr?'Saving...':'Save PSR Report'}</button>
                    </div>
                  )}
                </div>
              )}
              {detailTab==='sysinfo'&&(<div><div style={{fontWeight:'700',fontSize:'13px',marginBottom:'12px',color:'#1e293b'}}>System Information</div>{propSystems.length===0?<div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>:propSystems.map((sys:any)=>(<div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'12px',background:'#fafafa'}}><div style={{fontWeight:'600',fontSize:'13px',marginBottom:'10px',color:'#1e293b'}}>{sys.name}</div>{[['model_number','Model Number'],['manufacturer','Manufacturer'],['year_installed','Year Installed'],['warranty_expiry','Warranty Expiry'],['last_inspection','Last Inspection'],['notes','Notes']].map(([f,l])=>(<div key={f} style={{marginBottom:'6px'}}><div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'3px'}}>{l}</div><input value={sysInfoForm[sys.id]?.[f]||systemInfos[sys.id]?.[f]||''} onChange={e=>setSysInfoForm((p:any)=>({...p,[sys.id]:{...p[sys.id],[f]:e.target.value}}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box'}}/></div>))}<button onClick={()=>saveSysInfo(sys.id)} disabled={savingSysInfo} style={{width:'100%',padding:'6px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>{savingSysInfo?'Saving...':'Save'}</button></div>))}</div>)}
              {detailTab==='documents'&&(<div><div style={{fontWeight:'700',fontSize:'13px',marginBottom:'12px',color:'#1e293b'}}>Documents</div><div style={{background:'#f8fafc',borderRadius:'8px',padding:'24px',textAlign:'center',border:'2px dashed #e2e8f0'}}><div style={{fontSize:'24px',marginBottom:'8px'}}>??</div><div style={{fontWeight:'600',fontSize:'13px',color:'#334155',marginBottom:'4px'}}>Document Storage</div><div style={{fontSize:'12px',color:'#94a3b8'}}>PDF upload coming soon.</div></div></div>)}
            </div>
          </div>
        )}
      </div>
      {modal&&(<div style={{position:'fixed',inset:0,background:'#0009',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={()=>setModal(null)}><div style={{background:'#fff',borderRadius:'12px',padding:'24px',width:'420px',maxWidth:'92vw'}} onClick={e=>e.stopPropagation()}><div style={{fontWeight:'700',fontSize:'16px',marginBottom:'4px'}}>Update Status</div><div style={{color:'#64748b',fontSize:'13px',marginBottom:'16px'}}>{modal.name}</div><div style={{marginBottom:'14px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Status</div><div style={{display:'flex',gap:'8px'}}>{['in-service','out-of-service','maintenance'].map(s=>(<button key={s} onClick={()=>setForm(f=>({...f,status:s}))} style={{flex:1,padding:'8px 4px',borderRadius:'7px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:form.status===s?'2px solid '+STATUS_META[s].color:'1px solid #e2e8f0',background:form.status===s?STATUS_META[s].bg:'#f8fafc',color:form.status===s?STATUS_META[s].color:'#64748b'}}>{STATUS_META[s].label}</button>))}</div></div>{form.status!=='in-service'&&(<div style={{marginBottom:'12px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reason</div><select value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px'}}><option value=''>Select reason...</option>{(REASONS[modal.system_type]||[]).map((r:string)=><option key={r}>{r}</option>)}</select></div>)}<div style={{marginBottom:'12px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Notes</div><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',minHeight:'68px',resize:'vertical',boxSizing:'border-box'}}/></div><div style={{marginBottom:'16px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reported By</div><input value={form.reportedBy} onChange={e=>setForm(f=>({...f,reportedBy:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box'}}/></div><div style={{display:'flex',gap:'10px'}}><button onClick={()=>setModal(null)} style={{flex:1,padding:'10px',background:'#f1f5f9',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#64748b'}}>Cancel</button><button onClick={saveStatus} disabled={saving} style={{flex:2,padding:'10px',background:'#3b82f6',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#fff'}}>{saving?'Saving...':'Save Status'}</button></div></div></div>)}
      {toast&&<div style={{position:'fixed',bottom:'20px',right:'20px',background:'#166534',color:'#fff',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',zIndex:300}}>{toast}</div>}
    </div>
  )
}

