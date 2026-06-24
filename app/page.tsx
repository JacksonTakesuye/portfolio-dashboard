'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const STATUS_META: Record<string,{label:string,color:string,bg:string,border:string}> = {
  'in-service':    {label:'In Service',    color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
  'out-of-service':{label:'Out of Service',color:'#dc2626', bg:'#fef2f2', border:'#fecaca'},
  'maintenance':   {label:'Maintenance',   color:'#d97706', bg:'#fffbeb', border:'#fde68a'},
}

const REASONS: Record<string,string[]> = {
  elevator: ['Mechanical failure','Electrical issue','Scheduled maintenance','Door malfunction','Emergency stop triggered','Software/controller fault','Other'],
  compactor:['Mechanical jam','Motor failure','Hydraulic issue','Overfill / blockage','Scheduled maintenance','Other'],
  pool:     ['Chemical imbalance','Equipment failure','Scheduled maintenance','Safety closure','Storm damage','Health department order','Other'],
  gate:     ['Power failure','Sensor malfunction','Physical damage','Scheduled maintenance','Other'],
}

const DOC_TYPES = ['Contract','Warranty','Invoice','General','Other']

// Human-friendly labels for PSR fields, used when building the change summary
const PSR_FIELD_LABELS: Record<string,string> = {
  work_orders_total:'Work Orders Total', work_orders_over_48h:'Work Orders Over 48h', work_orders_explanation:'Work Orders Explanation',
  make_readies_total:'Make Readies Total', make_readies_over_7d:'Make Readies Over 7 Days',
  oncall_staff:'On-Call Staff', vacation_pto:'Vacation / PTO', shop_steward:'Shop Steward', preventative_maintenance:'Preventative Maintenance', open_maintenance_position:'Open Maintenance Position',
  pool_operational:'Pool Status', spa_operational:'Spa Status', chemical_levels_checked:'Chemical Levels Checked', cya_tracking_updated:'CYA Tracking Updated', pool_furniture_condition:'Pool Furniture Condition', pool_gates_secured:'Pool Gates Secured', pool_area_cleanliness:'Pool Area Cleanliness', pool_spa_notes:'Pool / Spa Notes',
  fitness_equipment:'Equipment Condition', fitness_cleanliness:'Cleanliness', fitness_supplies_stocked:'Supplies Stocked', fitness_access_control:'Access Control', fitness_notes:'Fitness Notes',
  grill_condition:'Grill Condition', grill_area_cleanliness:'Grill Area Cleanliness', propane_full:'Propane Full', propane_needed:'Propane Needed', charcoal_full:'Charcoal Full', charcoal_needed:'Charcoal Needed', grill_notes:'Grill Notes',
  mailboxes_secured:'Mailboxes Secured', parcel_lockers_working:'Parcel Lockers Working', mailbox_area_cleanliness:'Mailbox Area Cleanliness', mailbox_lighting:'Lighting Operational', mailbox_notes:'Mailbox Notes',
  clubhouse_fireplace_operational:'Clubhouse Fireplace', outdoor_fireplace_operational:'Outdoor Fireplace', fireplace_notes:'Fireplace Notes',
  elevator_1:'Elevator 1', elevator_2:'Elevator 2', elevator_3:'Elevator 3', elevator_4:'Elevator 4', elevator_5:'Elevator 5', elevator_6:'Elevator 6', elevator_notes:'Elevator Notes',
  tv_clubhouse:'Clubhouse TVs', tv_pool:'Pool TVs', tv_fitness:'Fitness Center TVs', tv_lounge:'Lounge TVs', tv_notes:'TV Notes',
  gate_entry:'Entry Gate', gate_exit:'Exit Gate', gate_pedestrian:'Pedestrian Gate', gate_access_system:'Access System', gate_notes:'Gate Notes',
  common_clubhouse:'Clubhouse', common_hallways:'Hallways', common_breezeways:'Breezeways', common_parking:'Parking', common_landscaping:'Landscaping', common_sidewalks:'Sidewalks', common_trash:'Trash', common_area_notes:'Common Area Notes',
  dog_station_cleaned:'Stations Cleaned', dog_station_damaged:'Damage Present', dog_station_bags:'Bags Stocked', dog_station_notes:'Dog Station Notes',
}

// Fields we never count as "edits" when diffing (metadata / audit columns)
const PSR_IGNORE_FIELDS = ['id','property_id','report_date','created_at','edited_by','edited_at','edit_notes']

// Build a readable summary of what changed between an old report and the edited form
const buildPsrDiff = (oldReport:any, newForm:any) => {
  const changes:string[] = []
  const keys = new Set([...Object.keys(oldReport||{}), ...Object.keys(newForm||{})])
  keys.forEach((k)=>{
    if(PSR_IGNORE_FIELDS.includes(k)) return
    const before = oldReport?.[k]
    const after  = newForm?.[k]
    const normB = (before===null||before===undefined) ? '' : String(before)
    const normA = (after===null||after===undefined)  ? '' : String(after)
    if(normB !== normA){
      const label = PSR_FIELD_LABELS[k] || k
      changes.push(label + ': ' + (normB===''?'(blank)':normB) + ' → ' + (normA===''?'(blank)':normA))
    }
  })
  return changes
}

const SI = (label:string, f:string, form:any, setForm:any) => (
  <div style={{marginBottom:'6px'}}>
    <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>{label}</div>
    <input value={form[f]||''} onChange={e=>setForm((p:any)=>({...p,[f]:e.target.value}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box' as any}}/>
  </div>
)

const CB = (label:string, f:string, form:any, setForm:any) => (
  <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'6px'}}>
    <input type='checkbox' checked={!!form[f]} onChange={e=>setForm((p:any)=>({...p,[f]:e.target.checked}))}/>
    <span style={{fontSize:'12px',color:'#334155'}}>{label}</span>
  </div>
)

const SEC = (title:string, children:any) => (
  <div style={{marginBottom:'14px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
    <div style={{fontWeight:'700',fontSize:'12px',color:'#1e293b',marginBottom:'8px',borderBottom:'1px solid #e2e8f0',paddingBottom:'4px'}}>{title}</div>
    {children}
  </div>
)

const FILE_ICON: Record<string,string> = {pdf:'PDF',xlsx:'XLS',xls:'XLS',jpg:'IMG',jpeg:'IMG',png:'IMG',doc:'DOC',docx:'DOC',csv:'CSV'}
const getIcon = (name:string) => { const ext = name.split('.').pop()?.toLowerCase()||''; return FILE_ICON[ext]||'FILE' }

const DOC_TYPE_COLORS: Record<string,{bg:string,color:string}> = {
  Contract:{bg:'#eff6ff',color:'#2563eb'},
  Warranty:{bg:'#f0fdf4',color:'#16a34a'},
  Invoice: {bg:'#fff7ed',color:'#ea580c'},
  General: {bg:'#f8fafc',color:'#64748b'},
  Other:   {bg:'#f5f3ff',color:'#7c3aed'},
}

export default function Home() {
  const [properties,    setProperties]    = useState<any[]>([])
  const [systems,       setSystems]        = useState<any[]>([])
  const [statuses,      setStatuses]       = useState<Record<string,any>>({})
  const [systemInfos,   setSystemInfos]    = useState<Record<string,any>>({})
  const [allPsrReports, setAllPsrReports]  = useState<any[]>([])
  const [documents,     setDocuments]      = useState<any[]>([])
  const [alertLog,      setAlertLog]       = useState<any[]>([])
  const [loading,       setLoading]        = useState(true)
  const [error,         setError]          = useState<string|null>(null)
  const [selectedProp,  setSelectedProp]   = useState<string|null>(null)
  const [detailTab,     setDetailTab]      = useState('systems')
  const [psrMode,       setPsrMode]        = useState<'history'|'new'|'edit'>('history')
  const [editingPsr,    setEditingPsr]     = useState<any>(null)
  const [editPsrForm,   setEditPsrForm]    = useState<any>({})
  const [editedBy,      setEditedBy]       = useState('')
  const [editNotes,     setEditNotes]      = useState('')
  const [savingEdit,    setSavingEdit]     = useState(false)
  const [psrSearch,     setPsrSearch]      = useState('')
  const [psrSort,       setPsrSort]        = useState<'newest'|'oldest'>('newest')
  const [expandedPsr,   setExpandedPsr]    = useState<number|null>(null)
  const [versionsFor,   setVersionsFor]    = useState<any>(null)   // report whose prior versions are open
  const [versionList,   setVersionList]    = useState<any[]>([])
  const [loadingVersions,setLoadingVersions]=useState(false)
  const [expandedVersion,setExpandedVersion]=useState<number|null>(null)
  const [tab,           setTab]            = useState('all')
  const [stateFilter,   setStateFilter]    = useState('all')
  const [modal,         setModal]          = useState<any>(null)
  const [form,          setForm]           = useState({status:'in-service',reason:'',notes:'',reportedBy:''})
  const [saving,        setSaving]         = useState(false)
  const [toast,         setToast]          = useState<string|null>(null)
  const [psrForm,       setPsrForm]        = useState<any>({})
  const [savingPsr,     setSavingPsr]      = useState(false)
  const [sysInfoForm,   setSysInfoForm]    = useState<Record<string,any>>({})
  const [savingSysInfo, setSavingSysInfo]  = useState(false)
  const [dragOver,      setDragOver]       = useState<string|null>(null)  // which bucket is being dragged over
  const [uploading,     setUploading]      = useState<string|null>(null)  // which bucket is uploading
  const [docFilter,     setDocFilter]      = useState('all')              // doc type filter
  const [pendingType,   setPendingType]    = useState<Record<string,string>>({}) // chosen type per bucket before upload
  const [isMobile,      setIsMobile]       = useState(false)
  const [mobileTab,     setMobileTab]      = useState<'portfolio'|'alerts'|'settings'>('portfolio')
  const fileInputRefs = useRef<Record<string,HTMLInputElement|null>>({})

  // ─── Detect mobile ───────────────────────────────────────────────────────────
  useEffect(()=>{
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  },[])

  // ─── Load data ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    async function loadData(){
      const {data:props,  error:e1} = await supabase.from('properties').select('*')
      const {data:sys,    error:e2} = await supabase.from('systems').select('*')
      const {data:statUpd}          = await supabase.from('status_updates').select('*').order('created_at',{ascending:false})
      const {data:sysInfo}          = await supabase.from('system_info').select('*')
      const {data:psr}              = await supabase.from('psr_reports').select('*').order('report_date',{ascending:false})
      const {data:docs}             = await supabase.from('documents').select('*').order('created_at',{ascending:false})
      const {data:alerts}           = await supabase.from('alert_log').select('*').order('created_at',{ascending:false}).limit(50)
      if(e1) setError(e1.message)
      else if(e2) setError(e2.message)
      else {
        setProperties(props||[])
        setSystems(sys||[])
        const ls:Record<string,any>={}
        ;(statUpd||[]).forEach((s:any)=>{ if(!ls[s.system_id]) ls[s.system_id]=s })
        setStatuses(ls)
        const im:Record<string,any>={}
        ;(sysInfo||[]).forEach((s:any)=>{ im[s.system_id]=s })
        setSystemInfos(im)
        setAllPsrReports(psr||[])
        setDocuments(docs||[])
        setAlertLog(alerts||[])
      }
      setLoading(false)
    }
    loadData()
  },[])

  // ─── Service worker / push ────────────────────────────────────────────────────
  useEffect(()=>{
    if('serviceWorker' in navigator && 'PushManager' in window){
      navigator.serviceWorker.register('/sw.js').then(async(reg)=>{
        const permission = await Notification.requestPermission()
        if(permission !== 'granted') return
        const existing = await reg.pushManager.getSubscription()
        const sub = existing || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY})
        await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})})
      }).catch(err=>console.log('SW error:',err))
    }
  },[])

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const showToast = (msg:string) => { setToast(msg); setTimeout(()=>setToast(null),3000) }
  const getStatus = (sysId:string) => statuses[sysId]?.status||'in-service'
  const propHasIssue = (prop:any) => systems.filter((s:any)=>s.property_id===prop.id).some((s:any)=>getStatus(s.id)==='out-of-service')

  const openModal = (sys:any) => {
    const current = statuses[sys.id]
    setForm({status:current?.status||'in-service', reason:current?.reason||'', notes:current?.notes||'', reportedBy:''})
    setModal(sys)
  }

  const saveStatus = async () => {
    if(!modal) return
    setSaving(true)
    const {error} = await supabase.from('status_updates').insert({system_id:modal.id, status:form.status, reason:form.reason||null, notes:form.notes||null, reported_by:form.reportedBy||'Staff'})
    if(error){ showToast('Error: '+error.message) }
    else {
      setStatuses((prev:any)=>({...prev,[modal.id]:{system_id:modal.id,status:form.status,reason:form.reason,notes:form.notes}}))
      showToast('Status updated')
      setModal(null)
      if(form.status==='out-of-service'||form.status==='maintenance'){
        const newAlert = {type:form.status, property_name:detailProp?.name||'', system_name:modal.name, reason:form.reason||null, created_at:new Date().toISOString()}
        setAlertLog((prev:any)=>[newAlert,...prev])
        await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:form.status, systemName:modal.name, propertyName:detailProp?.name||'', propertyId:detailProp?.id||'', reason:form.reason})})
      }
    }
    setSaving(false)
  }

  const savePsr = async () => {
    if(!detailProp) return
    setSavingPsr(true)
    const {data, error} = await supabase.from('psr_reports').insert({...psrForm, property_id:detailProp.id, report_date:new Date().toISOString().split('T')[0]}).select()
    if(error) showToast('Error: '+error.message)
    else {
      showToast('PSR saved')
      setAllPsrReports((prev:any)=>[...(data||[]),...prev])
      setPsrForm({})
      setPsrMode('history')
      const newAlert = {type:'psr-submitted', property_name:detailProp.name, report_date:new Date().toISOString().split('T')[0], created_at:new Date().toISOString()}
      setAlertLog((prev:any)=>[newAlert,...prev])
      await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'psr-submitted', propertyName:detailProp.name, propertyId:detailProp.id, reportDate:new Date().toISOString().split('T')[0]})})
    }
    setSavingPsr(false)
  }

  const openEditPsr = (r:any) => {
    setEditingPsr(r)
    setEditPsrForm({...r})
    setEditedBy('')
    setEditNotes('')
    setPsrMode('edit')
  }

  const saveEditPsr = async () => {
    if(!editingPsr) return
    setSavingEdit(true)

    // 1. Auto-detect what changed between the original report and the edited form
    const diffArr = buildPsrDiff(editingPsr, editPsrForm)
    const changeSummary = diffArr.length ? diffArr.join(' | ') : 'No field changes'

    // 2. Save a full snapshot of the report AS IT WAS before this edit
    const {error:verErr} = await supabase.from('psr_report_versions').insert({
      psr_report_id: editingPsr.id,
      property_id:   editingPsr.property_id,
      snapshot:      editingPsr,
      change_summary: changeSummary,
      edit_note:     editNotes||null,
      edited_by:     editedBy||'Staff',
      edited_at:     new Date().toISOString(),
    })
    if(verErr){ showToast('Version save error: '+verErr.message); setSavingEdit(false); return }

    // 3. Update the live report. We keep edit_notes as a combined human-readable record.
    const combinedNote = changeSummary + (editNotes ? ' || Note: '+editNotes : '')
    const updateData = {...editPsrForm, edited_by:editedBy||'Staff', edited_at:new Date().toISOString(), edit_notes:combinedNote}
    const {error} = await supabase.from('psr_reports').update(updateData).eq('id',editingPsr.id)
    if(error){ showToast('Error: '+error.message); setSavingEdit(false); return }

    showToast('PSR report updated')
    setAllPsrReports((prev:any)=>prev.map((r:any)=>r.id===editingPsr.id?{...r,...updateData}:r))

    // 4. Notify all subscribers about the edit
    const newAlert = {type:'psr-edited', property_name:detailProp?.name||'', report_date:editingPsr.report_date, reason:changeSummary, created_at:new Date().toISOString()}
    setAlertLog((prev:any)=>[newAlert,...prev])
    await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      type:'psr-edited',
      propertyName: detailProp?.name||'',
      propertyId:   detailProp?.id||'',
      reportDate:   editingPsr.report_date,
      editedBy:     editedBy||'Staff',
      changeSummary,
    })})

    setEditingPsr(null)
    setEditPsrForm({})
    setPsrMode('history')
    setSavingEdit(false)
  }

  // Load prior versions for a given report
  const openVersions = async (report:any) => {
    setVersionsFor(report)
    setVersionList([])
    setExpandedVersion(null)
    setLoadingVersions(true)
    const {data, error} = await supabase.from('psr_report_versions').select('*').eq('psr_report_id', report.id).order('edited_at',{ascending:false})
    if(error) showToast('Error loading versions: '+error.message)
    else setVersionList(data||[])
    setLoadingVersions(false)
  }

  const saveSysInfo = async (systemId:string) => {
    setSavingSysInfo(true)
    const existing = systemInfos[systemId]
    const data = {...sysInfoForm[systemId], system_id:systemId}
    const {error} = existing
      ? await supabase.from('system_info').update(data).eq('system_id',systemId)
      : await supabase.from('system_info').insert(data)
    if(error) showToast('Error: '+error.message)
    else { showToast('Saved'); setSystemInfos((prev:any)=>({...prev,[systemId]:data})) }
    setSavingSysInfo(false)
  }

  // bucketKey is the system id, or 'property' for property-wide docs
  const uploadDocument = async (file:File, bucketKey:string) => {
    if(!detailProp) return
    const docType = pendingType[bucketKey] || 'General'
    const systemId = bucketKey==='property' ? null : bucketKey
    setUploading(bucketKey)
    const path = detailProp.id+'/'+bucketKey+'/'+Date.now()+'-'+file.name
    const {error:upErr} = await supabase.storage.from('documents').upload(path,file)
    if(upErr){ showToast('Upload error: '+upErr.message); setUploading(null); return }
    const row = {property_id:detailProp.id, system_id:systemId, doc_type:docType, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:'Staff'}
    const {error:dbErr} = await supabase.from('documents').insert(row)
    if(dbErr){ showToast('DB error: '+dbErr.message); setUploading(null); return }
    showToast('Document uploaded')
    setDocuments((prev:any)=>[...prev,{...row,created_at:new Date().toISOString()}])
    setUploading(null)
  }

  const viewDocument = async (path:string) => {
    const {data} = await supabase.storage.from('documents').createSignedUrl(path,60)
    if(data?.signedUrl) window.open(data.signedUrl,'_blank')
  }

  const handleDrop = (e:React.DragEvent, bucketKey:string) => {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files?.[0]
    if(file) uploadDocument(file, bucketKey)
  }

  // ─── Derived state ────────────────────────────────────────────────────────────
  const states = [...new Set(properties.map((p:any)=>p.state))].sort()
  const filtered = properties.filter((p:any)=>{
    const tabOk = tab==='all'||(tab==='elevators'&&p.has_elevator)||(tab==='compactors'&&p.has_compactor)||(tab==='pools'&&p.has_pool)||(tab==='gates'&&p.has_gate)
    const stOk  = stateFilter==='all'||p.state===stateFilter
    return tabOk && stOk
  })
  const byState = states.map(s=>({state:s, props:filtered.filter((p:any)=>p.state===s)})).filter(g=>g.props.length>0)
  const detailProp    = selectedProp ? properties.find((p:any)=>p.id===selectedProp) : null
  const propSystems   = detailProp ? systems.filter((s:any)=>s.property_id===detailProp.id) : []
  const propDocuments = detailProp ? documents.filter((d:any)=>d.property_id===detailProp.id) : []
  const propPsrReports = detailProp ? allPsrReports.filter((r:any)=>r.property_id===detailProp.id) : []
  const filteredPsr = propPsrReports
    .filter((r:any)=>!psrSearch||r.report_date?.includes(psrSearch))
    .sort((a:any,b:any)=>psrSort==='newest'
      ? new Date(b.report_date).getTime()-new Date(a.report_date).getTime()
      : new Date(a.report_date).getTime()-new Date(b.report_date).getTime())

  const TABS        = [['all','All'],['elevators','Elevators'],['compactors','Compactors'],['pools','Pools'],['gates','Gates']]
  const DETAIL_TABS = [['systems','Systems'],['psr','PSR Report'],['sysinfo','System Info'],['documents','Documents']]

  if(loading) return <div style={{padding:'40px',textAlign:'center'}}>Loading...</div>
  if(error)   return <div style={{padding:'40px',color:'red'}}>Error: {error}</div>

  // ─── A single document upload bucket (reused per system + property-wide) ───────
  const renderDocBucket = (bucketKey:string, title:string, subtitle:string) => {
    const docsInBucket = propDocuments
      .filter((d:any)=> bucketKey==='property' ? (d.system_id===null||d.system_id===undefined) : d.system_id===bucketKey)
      .filter((d:any)=> docFilter==='all' || (d.doc_type||'General')===docFilter)
    const chosenType = pendingType[bucketKey] || ''
    const isOver = dragOver===bucketKey
    const isUp   = uploading===bucketKey
    return (
      <div key={bucketKey} style={{marginBottom:'18px',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'12px',background:'#fff'}}>
        <div style={{marginBottom:'10px'}}>
          <div style={{fontWeight:'700',fontSize:'13px',color:'#1e293b'}}>{title}</div>
          {subtitle && <div style={{fontSize:'10px',color:'#94a3b8'}}>{subtitle}</div>}
        </div>

        {/* Required document type selector */}
        <div style={{marginBottom:'8px'}}>
          <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'4px'}}>Document Type (required before upload)</div>
          <select value={chosenType} onChange={e=>setPendingType((p:any)=>({...p,[bucketKey]:e.target.value}))} style={{width:'100%',padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px'}}>
            <option value=''>Select type...</option>
            {DOC_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Upload zone — disabled until a type is chosen */}
        <div
          onDragOver={e=>{ if(chosenType){ e.preventDefault(); setDragOver(bucketKey) } }}
          onDragLeave={()=>setDragOver(null)}
          onDrop={e=> chosenType ? handleDrop(e,bucketKey) : e.preventDefault()}
          onClick={()=>{ if(!chosenType){ showToast('Please choose a document type first'); return } fileInputRefs.current[bucketKey]?.click() }}
          style={{border:'2px dashed '+(isOver?'#3b82f6':'#e2e8f0'),borderRadius:'8px',padding:'16px',textAlign:'center',cursor:chosenType?'pointer':'not-allowed',marginBottom:'10px',background:isOver?'#eff6ff':(chosenType?'#fafafa':'#f1f5f9'),opacity:chosenType?1:0.6}}
        >
          <div style={{fontSize:'20px',marginBottom:'4px'}}>📎</div>
          <div style={{fontSize:'11px',color:'#64748b'}}>{isUp?'Uploading...':(chosenType?'Drop file here or tap to browse':'Choose a type above to enable upload')}</div>
          <input ref={el=>{ fileInputRefs.current[bucketKey]=el }} type='file' style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0]; if(f) uploadDocument(f,bucketKey); e.target.value=''}}/>
        </div>

        {/* Files in this bucket */}
        {docsInBucket.length===0
          ? <div style={{fontSize:'11px',color:'#94a3b8',textAlign:'center',padding:'6px'}}>No documents{docFilter!=='all'?' of this type':''}.</div>
          : docsInBucket.map((doc:any,i:number)=>{
              const icon = getIcon(doc.file_name)
              const iconColors:Record<string,{bg:string,color:string}> = {PDF:{bg:'#fef2f2',color:'#dc2626'},XLS:{bg:'#f0fdf4',color:'#16a34a'},IMG:{bg:'#eff6ff',color:'#2563eb'},DOC:{bg:'#f5f3ff',color:'#7c3aed'},CSV:{bg:'#fff7ed',color:'#ea580c'},FILE:{bg:'#f8fafc',color:'#64748b'}}
              const ic = iconColors[icon]||iconColors.FILE
              const dt = doc.doc_type||'General'
              const dtc = DOC_TYPE_COLORS[dt]||DOC_TYPE_COLORS.General
              return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px',background:'#fafafa',borderRadius:'8px',border:'1px solid #e2e8f0',marginBottom:'6px'}}>
                  <div style={{width:'34px',height:'34px',borderRadius:'6px',background:ic.bg,color:ic.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',flexShrink:0}}>{icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:'12px',fontWeight:'600',color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{doc.file_name}</div>
                    <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'2px'}}>
                      <span style={{fontSize:'9px',fontWeight:'700',padding:'1px 6px',borderRadius:'8px',background:dtc.bg,color:dtc.color}}>{dt}</span>
                      <span style={{fontSize:'10px',color:'#94a3b8'}}>{doc.uploaded_by} · {doc.created_at?new Date(doc.created_at).toLocaleDateString():''}</span>
                    </div>
                  </div>
                  <button onClick={()=>viewDocument(doc.file_path)} style={{padding:'5px 10px',background:'#eff6ff',color:'#2563eb',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',flexShrink:0}}>View</button>
                </div>
              )
            })
        }
      </div>
    )
  }

  // ─── Detail panel content (shared desktop + mobile) ───────────────────────────
  const renderDetailContent = () => (
    <>
      {/* Systems tab */}
      {detailTab==='systems' && (
        <div>
          {propSystems.length===0
            ? <div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>
            : propSystems.map((sys:any)=>{
                const st = statuses[sys.id]
                const statusKey = st?.status||'in-service'
                const meta = STATUS_META[statusKey]
                return (
                  <div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'10px',background:'#fafafa'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
                      <div>
                        <div style={{fontWeight:'600',fontSize:'13px'}}>{sys.name}</div>
                        <div style={{fontSize:'11px',color:'#64748b',textTransform:'capitalize'}}>{sys.system_type}</div>
                      </div>
                      <span style={{background:meta.bg,color:meta.color,border:'1px solid '+meta.border,padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>{meta.label}</span>
                    </div>
                    {st?.reason && <div style={{fontSize:'11px',color:'#dc2626',marginBottom:'4px'}}>{st.reason}</div>}
                    {st?.notes  && <div style={{fontSize:'11px',color:'#64748b',fontStyle:'italic',marginBottom:'6px'}}>{st.notes}</div>}
                    <button onClick={()=>openModal(sys)} style={{width:'100%',padding:'8px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Update Status</button>
                  </div>
                )
              })
          }
        </div>
      )}

      {/* PSR tab */}
      {detailTab==='psr' && (
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
            <div style={{fontWeight:'700',fontSize:'13px',color:'#1e293b'}}>PSR Reports</div>
            <div style={{display:'flex',gap:'6px'}}>
              {psrMode!=='history' && <button onClick={()=>setPsrMode('history')} style={{padding:'5px 10px',background:'#f1f5f9',color:'#64748b',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>}
              {psrMode==='history'  && <button onClick={()=>setPsrMode('new')}     style={{padding:'5px 10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>+ New</button>}
            </div>
          </div>
          {psrMode==='history' && (
            <div>
              <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
                <input value={psrSearch} onChange={e=>setPsrSearch(e.target.value)} placeholder='Search by date...' style={{flex:1,padding:'6px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px'}}/>
                <select value={psrSort} onChange={e=>setPsrSort(e.target.value as any)} style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px'}}>
                  <option value='newest'>Newest</option>
                  <option value='oldest'>Oldest</option>
                </select>
              </div>
              {filteredPsr.length===0
                ? <div style={{fontSize:'12px',color:'#94a3b8',textAlign:'center',padding:'20px'}}>No PSR reports found.</div>
                : filteredPsr.map((r:any)=>(
                    <div key={r.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',marginBottom:'8px',overflow:'hidden'}}>
                      <div onClick={()=>setExpandedPsr(expandedPsr===r.id?null:r.id)} style={{padding:'10px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc'}}>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'12px',color:'#1e293b'}}>{r.report_date}</div>
                          <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>
                            {r.oncall_staff?'On-call: '+r.oncall_staff:''}
                            {r.edited_at?' | Edited: '+r.edited_at.split('T')[0]+' by '+(r.edited_by||'Staff'):''}
                          </div>
                        </div>
                        <span style={{fontSize:'12px',color:'#94a3b8'}}>{expandedPsr===r.id?'▲':'▼'}</span>
                      </div>
                      {expandedPsr===r.id && (
                        <div style={{padding:'10px 12px',borderTop:'1px solid #e2e8f0'}}>
                          {[['Work Orders Total','work_orders_total'],['Work Orders Over 48h','work_orders_over_48h'],['Make Readies Total','make_readies_total'],['On-Call Staff','oncall_staff'],['Pool Status','pool_operational'],['Gate Entry','gate_entry'],['Elevator 1','elevator_1'],['Common Areas','common_clubhouse']].map(([label,field])=>r[field]!=null&&r[field]!==''&&(
                            <div key={field} style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'3px'}}>
                              <span style={{color:'#64748b'}}>{label}</span>
                              <span style={{color:'#1e293b',fontWeight:'600'}}>{String(r[field])}</span>
                            </div>
                          ))}
                          {r.edited_at && (
                            <div style={{marginTop:'6px',padding:'6px',background:'#eff6ff',borderRadius:'5px',fontSize:'10px',color:'#1e40af'}}>
                              Last edited {r.edited_at.split('T')[0]} by {r.edited_by||'Staff'}
                            </div>
                          )}
                          {r.edit_notes && <div style={{marginTop:'6px',padding:'6px',background:'#fef9c3',borderRadius:'5px',fontSize:'10px',color:'#92400e'}}>Changes: {r.edit_notes}</div>}
                          <div style={{display:'flex',gap:'6px',marginTop:'8px'}}>
                            <button onClick={()=>openEditPsr(r)} style={{flex:1,padding:'6px',background:'#f1f5f9',color:'#334155',border:'1px solid #e2e8f0',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Edit This Report</button>
                            <button onClick={()=>openVersions(r)} style={{flex:1,padding:'6px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>See Prior Versions</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
              }
            </div>
          )}
          {psrMode==='new' && (
            <div>
              {SEC('Work Orders & Make Readies',<div>
                {SI('Work Orders Total','work_orders_total',psrForm,setPsrForm)}
                {SI('Work Orders Over 48h','work_orders_over_48h',psrForm,setPsrForm)}
                {SI('Work Orders Explanation','work_orders_explanation',psrForm,setPsrForm)}
                {SI('Make Readies Total','make_readies_total',psrForm,setPsrForm)}
                {SI('Make Readies Over 7 Days','make_readies_over_7d',psrForm,setPsrForm)}
              </div>)}
              {SEC('Staffing',<div>
                {SI('On-Call Staff','oncall_staff',psrForm,setPsrForm)}
                {SI('Vacation / PTO','vacation_pto',psrForm,setPsrForm)}
                {SI('Shop Steward','shop_steward',psrForm,setPsrForm)}
                {SI('Preventative Maintenance','preventative_maintenance',psrForm,setPsrForm)}
                {CB('Open Maintenance Position','open_maintenance_position',psrForm,setPsrForm)}
              </div>)}
              {SEC('Pool / Spa',<div>
                {SI('Pool Status','pool_operational',psrForm,setPsrForm)}
                {SI('Spa Status','spa_operational',psrForm,setPsrForm)}
                {SI('Chemical Levels Checked','chemical_levels_checked',psrForm,setPsrForm)}
                {SI('CYA Tracking Updated','cya_tracking_updated',psrForm,setPsrForm)}
                {SI('Pool Furniture Condition','pool_furniture_condition',psrForm,setPsrForm)}
                {SI('Pool Gates Secured','pool_gates_secured',psrForm,setPsrForm)}
                {SI('Pool Area Cleanliness','pool_area_cleanliness',psrForm,setPsrForm)}
                {SI('Pool / Spa Notes','pool_spa_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Fitness Center',<div>
                {SI('Equipment Condition','fitness_equipment',psrForm,setPsrForm)}
                {SI('Cleanliness','fitness_cleanliness',psrForm,setPsrForm)}
                {SI('Supplies Stocked','fitness_supplies_stocked',psrForm,setPsrForm)}
                {SI('Access Control','fitness_access_control',psrForm,setPsrForm)}
                {SI('Fitness Notes','fitness_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Grills / Outdoor Cooking',<div>
                {SI('Grill Condition','grill_condition',psrForm,setPsrForm)}
                {SI('Grill Area Cleanliness','grill_area_cleanliness',psrForm,setPsrForm)}
                {CB('Propane Full','propane_full',psrForm,setPsrForm)}
                {CB('Propane Needed','propane_needed',psrForm,setPsrForm)}
                {CB('Charcoal Full','charcoal_full',psrForm,setPsrForm)}
                {CB('Charcoal Needed','charcoal_needed',psrForm,setPsrForm)}
                {SI('Grill Notes','grill_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Mailbox Center',<div>
                {SI('Mailboxes Secured','mailboxes_secured',psrForm,setPsrForm)}
                {SI('Parcel Lockers Working','parcel_lockers_working',psrForm,setPsrForm)}
                {SI('Area Cleanliness','mailbox_area_cleanliness',psrForm,setPsrForm)}
                {SI('Lighting Operational','mailbox_lighting',psrForm,setPsrForm)}
                {SI('Mailbox Notes','mailbox_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Fireplaces / Firepits',<div>
                {SI('Clubhouse Fireplace','clubhouse_fireplace_operational',psrForm,setPsrForm)}
                {SI('Outdoor Fireplace','outdoor_fireplace_operational',psrForm,setPsrForm)}
                {SI('Fireplace Notes','fireplace_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Elevators',<div>
                {['elevator_1','elevator_2','elevator_3','elevator_4','elevator_5','elevator_6'].map((f,i)=>(
                  <div key={f}>{SI('Elevator '+(i+1)+' Status',f,psrForm,setPsrForm)}</div>
                ))}
                {SI('Elevator Notes','elevator_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('TV / Media Equipment',<div>
                {SI('Clubhouse TVs','tv_clubhouse',psrForm,setPsrForm)}
                {SI('Pool TVs','tv_pool',psrForm,setPsrForm)}
                {SI('Fitness Center TVs','tv_fitness',psrForm,setPsrForm)}
                {SI('Lounge TVs','tv_lounge',psrForm,setPsrForm)}
                {SI('TV Notes','tv_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Gates / Access Control',<div>
                {SI('Entry Gate','gate_entry',psrForm,setPsrForm)}
                {SI('Exit Gate','gate_exit',psrForm,setPsrForm)}
                {SI('Pedestrian Gate','gate_pedestrian',psrForm,setPsrForm)}
                {SI('Access System','gate_access_system',psrForm,setPsrForm)}
                {SI('Gate Notes','gate_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Common Areas',<div>
                {SI('Clubhouse','common_clubhouse',psrForm,setPsrForm)}
                {SI('Hallways','common_hallways',psrForm,setPsrForm)}
                {SI('Breezeways','common_breezeways',psrForm,setPsrForm)}
                {SI('Parking','common_parking',psrForm,setPsrForm)}
                {SI('Landscaping','common_landscaping',psrForm,setPsrForm)}
                {SI('Sidewalks','common_sidewalks',psrForm,setPsrForm)}
                {SI('Trash','common_trash',psrForm,setPsrForm)}
                {SI('Common Area Notes','common_area_notes',psrForm,setPsrForm)}
              </div>)}
              {SEC('Dog Stations',<div>
                {SI('Stations Cleaned','dog_station_cleaned',psrForm,setPsrForm)}
                {SI('Damage Present','dog_station_damaged',psrForm,setPsrForm)}
                {SI('Bags Stocked','dog_station_bags',psrForm,setPsrForm)}
                {SI('Dog Station Notes','dog_station_notes',psrForm,setPsrForm)}
              </div>)}
              <button onClick={savePsr} disabled={savingPsr} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'8px'}}>
                {savingPsr?'Saving...':'Save PSR Report'}
              </button>
            </div>
          )}
          {psrMode==='edit' && editingPsr && (
            <div>
              <div style={{fontWeight:'600',fontSize:'12px',color:'#1e293b',marginBottom:'10px'}}>Editing: {editingPsr.report_date}</div>
              {SEC('Work Orders & Make Readies',<div>
                {SI('Work Orders Total','work_orders_total',editPsrForm,setEditPsrForm)}
                {SI('Work Orders Over 48h','work_orders_over_48h',editPsrForm,setEditPsrForm)}
                {SI('Work Orders Explanation','work_orders_explanation',editPsrForm,setEditPsrForm)}
                {SI('Make Readies Total','make_readies_total',editPsrForm,setEditPsrForm)}
                {SI('Make Readies Over 7 Days','make_readies_over_7d',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Staffing',<div>
                {SI('On-Call Staff','oncall_staff',editPsrForm,setEditPsrForm)}
                {SI('Vacation / PTO','vacation_pto',editPsrForm,setEditPsrForm)}
                {SI('Shop Steward','shop_steward',editPsrForm,setEditPsrForm)}
                {SI('Preventative Maintenance','preventative_maintenance',editPsrForm,setEditPsrForm)}
                {CB('Open Maintenance Position','open_maintenance_position',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Pool / Spa',<div>
                {SI('Pool Status','pool_operational',editPsrForm,setEditPsrForm)}
                {SI('Spa Status','spa_operational',editPsrForm,setEditPsrForm)}
                {SI('Chemical Levels Checked','chemical_levels_checked',editPsrForm,setEditPsrForm)}
                {SI('CYA Tracking Updated','cya_tracking_updated',editPsrForm,setEditPsrForm)}
                {SI('Pool Furniture Condition','pool_furniture_condition',editPsrForm,setEditPsrForm)}
                {SI('Pool Gates Secured','pool_gates_secured',editPsrForm,setEditPsrForm)}
                {SI('Pool Area Cleanliness','pool_area_cleanliness',editPsrForm,setEditPsrForm)}
                {SI('Pool / Spa Notes','pool_spa_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Fitness Center',<div>
                {SI('Equipment Condition','fitness_equipment',editPsrForm,setEditPsrForm)}
                {SI('Cleanliness','fitness_cleanliness',editPsrForm,setEditPsrForm)}
                {SI('Supplies Stocked','fitness_supplies_stocked',editPsrForm,setEditPsrForm)}
                {SI('Access Control','fitness_access_control',editPsrForm,setEditPsrForm)}
                {SI('Fitness Notes','fitness_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Grills / Outdoor Cooking',<div>
                {SI('Grill Condition','grill_condition',editPsrForm,setEditPsrForm)}
                {SI('Grill Area Cleanliness','grill_area_cleanliness',editPsrForm,setEditPsrForm)}
                {CB('Propane Full','propane_full',editPsrForm,setEditPsrForm)}
                {CB('Propane Needed','propane_needed',editPsrForm,setEditPsrForm)}
                {CB('Charcoal Full','charcoal_full',editPsrForm,setEditPsrForm)}
                {CB('Charcoal Needed','charcoal_needed',editPsrForm,setEditPsrForm)}
                {SI('Grill Notes','grill_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Mailbox Center',<div>
                {SI('Mailboxes Secured','mailboxes_secured',editPsrForm,setEditPsrForm)}
                {SI('Parcel Lockers Working','parcel_lockers_working',editPsrForm,setEditPsrForm)}
                {SI('Area Cleanliness','mailbox_area_cleanliness',editPsrForm,setEditPsrForm)}
                {SI('Lighting Operational','mailbox_lighting',editPsrForm,setEditPsrForm)}
                {SI('Mailbox Notes','mailbox_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Fireplaces / Firepits',<div>
                {SI('Clubhouse Fireplace','clubhouse_fireplace_operational',editPsrForm,setEditPsrForm)}
                {SI('Outdoor Fireplace','outdoor_fireplace_operational',editPsrForm,setEditPsrForm)}
                {SI('Fireplace Notes','fireplace_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Elevators',<div>
                {['elevator_1','elevator_2','elevator_3','elevator_4','elevator_5','elevator_6'].map((f,i)=>(
                  <div key={f}>{SI('Elevator '+(i+1)+' Status',f,editPsrForm,setEditPsrForm)}</div>
                ))}
                {SI('Elevator Notes','elevator_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('TV / Media Equipment',<div>
                {SI('Clubhouse TVs','tv_clubhouse',editPsrForm,setEditPsrForm)}
                {SI('Pool TVs','tv_pool',editPsrForm,setEditPsrForm)}
                {SI('Fitness Center TVs','tv_fitness',editPsrForm,setEditPsrForm)}
                {SI('Lounge TVs','tv_lounge',editPsrForm,setEditPsrForm)}
                {SI('TV Notes','tv_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Gates / Access Control',<div>
                {SI('Entry Gate','gate_entry',editPsrForm,setEditPsrForm)}
                {SI('Exit Gate','gate_exit',editPsrForm,setEditPsrForm)}
                {SI('Pedestrian Gate','gate_pedestrian',editPsrForm,setEditPsrForm)}
                {SI('Access System','gate_access_system',editPsrForm,setEditPsrForm)}
                {SI('Gate Notes','gate_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Common Areas',<div>
                {SI('Clubhouse','common_clubhouse',editPsrForm,setEditPsrForm)}
                {SI('Hallways','common_hallways',editPsrForm,setEditPsrForm)}
                {SI('Breezeways','common_breezeways',editPsrForm,setEditPsrForm)}
                {SI('Parking','common_parking',editPsrForm,setEditPsrForm)}
                {SI('Landscaping','common_landscaping',editPsrForm,setEditPsrForm)}
                {SI('Sidewalks','common_sidewalks',editPsrForm,setEditPsrForm)}
                {SI('Trash','common_trash',editPsrForm,setEditPsrForm)}
                {SI('Common Area Notes','common_area_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              {SEC('Dog Stations',<div>
                {SI('Stations Cleaned','dog_station_cleaned',editPsrForm,setEditPsrForm)}
                {SI('Damage Present','dog_station_damaged',editPsrForm,setEditPsrForm)}
                {SI('Bags Stocked','dog_station_bags',editPsrForm,setEditPsrForm)}
                {SI('Dog Station Notes','dog_station_notes',editPsrForm,setEditPsrForm)}
              </div>)}
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>Edited By (required)</div>
                <input value={editedBy} onChange={e=>setEditedBy(e.target.value)} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',boxSizing:'border-box' as any}}/>
              </div>
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>Note about this edit (optional)</div>
                <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder='e.g. Corrected pool status after re-inspection' style={{width:'100%',padding:'6px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',minHeight:'52px',resize:'vertical' as any,boxSizing:'border-box' as any}}/>
              </div>
              <div style={{padding:'8px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',fontSize:'10px',color:'#166534',marginBottom:'8px'}}>
                A snapshot of the current report will be saved to version history before your changes are applied.
              </div>
              <button onClick={saveEditPsr} disabled={savingEdit||!editedBy.trim()} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>
                {savingEdit?'Saving...':'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* System Info tab */}
      {detailTab==='sysinfo' && (
        <div>
          {propSystems.length===0
            ? <div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>
            : propSystems.map((sys:any)=>{
                const info = systemInfos[sys.id]||{}
                const localForm = sysInfoForm[sys.id]||info
                const setLocalForm = (updater:any) => setSysInfoForm((prev:any)=>({...prev,[sys.id]:typeof updater==='function'?updater(prev[sys.id]||info):updater}))
                return (
                  <div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'12px',background:'#fafafa'}}>
                    <div style={{fontWeight:'600',fontSize:'13px',marginBottom:'8px'}}>{sys.name}</div>
                    {SI('Model Number','model_number',localForm,setLocalForm)}
                    {SI('Manufacturer','manufacturer',localForm,setLocalForm)}
                    {SI('Year Installed','year_installed',localForm,setLocalForm)}
                    {SI('Warranty Expiry','warranty_expiry',localForm,setLocalForm)}
                    {SI('Last Inspection','last_inspection',localForm,setLocalForm)}
                    {SI('Notes','notes',localForm,setLocalForm)}
                    <button onClick={()=>saveSysInfo(sys.id)} disabled={savingSysInfo} style={{width:'100%',padding:'7px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>
                      {savingSysInfo?'Saving...':'Save'}
                    </button>
                  </div>
                )
              })
          }
        </div>
      )}

      {/* Documents tab — per-system buckets + property-wide, with type filter */}
      {detailTab==='documents' && (
        <div>
          {/* Filter by document type */}
          <div style={{marginBottom:'14px'}}>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Filter by type</div>
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              {['all',...DOC_TYPES].map(t=>(
                <button key={t} onClick={()=>setDocFilter(t)} style={{padding:'4px 10px',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:docFilter===t?'1.5px solid #3b82f6':'1px solid #e2e8f0',background:docFilter===t?'#eff6ff':'#fff',color:docFilter===t?'#1d4ed8':'#64748b'}}>
                  {t==='all'?'All':t}
                </button>
              ))}
            </div>
          </div>

          {/* One bucket per system */}
          {propSystems.map((sys:any)=> renderDocBucket(sys.id, sys.name, sys.system_type ? sys.system_type.charAt(0).toUpperCase()+sys.system_type.slice(1) : ''))}

          {/* Property-wide bucket */}
          {renderDocBucket('property','Property-Wide Documents','Not tied to a specific system')}
        </div>
      )}
    </>
  )

  // ─── Alerts screen (mobile only) ─────────────────────────────────────────────
  const renderAlerts = () => (
    <div style={{flex:1,overflowY:'auto',padding:'12px',paddingBottom:'80px'}}>
      <div style={{fontWeight:'700',fontSize:'15px',color:'#1e293b',marginBottom:'4px'}}>Alerts</div>
      <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'14px'}}>Last 50 events across all properties</div>
      {alertLog.length===0
        ? <div style={{textAlign:'center',color:'#94a3b8',fontSize:'13px',padding:'40px 0'}}>No alerts yet.</div>
        : alertLog.map((a:any, i:number)=>{
            const isOut   = a.type==='out-of-service'
            const isMaint = a.type==='maintenance'
            const isPsr   = a.type==='psr-submitted'
            const isEdit  = a.type==='psr-edited'
            const color  = isOut?'#dc2626':isMaint?'#d97706':isEdit?'#7c3aed':'#0369a1'
            const bg     = isOut?'#fef2f2':isMaint?'#fffbeb':isEdit?'#f5f3ff':'#eff6ff'
            const label  = isOut?'Out of Service':isMaint?'Maintenance':isEdit?'PSR Edited':'PSR Submitted'
            const dateStr = a.created_at
              ? new Date(a.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
              : ''
            return (
              <div key={i} style={{background:'#fff',borderRadius:'10px',padding:'12px 14px',marginBottom:'8px',border:'1px solid #e2e8f0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'5px'}}>
                  <span style={{background:bg,color:color,fontSize:'10px',fontWeight:'600',padding:'2px 8px',borderRadius:'10px'}}>{label}</span>
                  <span style={{fontSize:'10px',color:'#94a3b8'}}>{dateStr}</span>
                </div>
                <div style={{fontWeight:'600',fontSize:'13px',color:'#1e293b',marginBottom:'2px'}}>{a.property_name||'—'}</div>
                {a.system_name && <div style={{fontSize:'12px',color:'#64748b'}}>{a.system_name}{a.reason?': '+a.reason:''}</div>}
                {isEdit && a.reason && <div style={{fontSize:'12px',color:'#64748b'}}>{a.reason}</div>}
                {(isPsr||isEdit) && a.report_date && <div style={{fontSize:'12px',color:'#64748b'}}>Report date: {a.report_date}</div>}
              </div>
            )
          })
      }
    </div>
  )

  // ─── Property card system badges ─────────────────────────────────────────────
  const renderSystemBadges = (prop:any) => {
    const propSys = systems.filter((s:any)=>s.property_id===prop.id)
    if(propSys.length===0) return null
    return (
      <div style={{display:'flex',gap:'4px',flexWrap:'wrap',marginTop:'6px'}}>
        {propSys.map((s:any)=>{
          const st = getStatus(s.id)
          const meta = STATUS_META[st]
          return (
            <span key={s.id} style={{fontSize:'10px',padding:'2px 7px',borderRadius:'10px',fontWeight:'500',background:meta.bg,color:meta.color,border:'1px solid '+meta.border}}>
              {s.name}
            </span>
          )
        })}
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:'system-ui',background:'#f1f5f9',minHeight:'100vh'}}>

      {/* ── Header ── */}
      <div style={{background:'#0f172a',padding:isMobile?'12px 16px':'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'36px',height:'36px',background:'#3b82f6',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🏢</div>
          <div>
            <div style={{color:'#f8fafc',fontWeight:'600',fontSize:isMobile?'14px':'15px'}}>Professional Equity Management</div>
            <div style={{color:'#64748b',fontSize:'11px'}}>Portfolio Systems Dashboard</div>
          </div>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div style={{background:'#fff',borderBottom:'1px solid #e2e8f0',padding:isMobile?'10px 12px':'12px 24px',display:'flex',gap:isMobile?'16px':'24px',overflowX:'auto',flexWrap:isMobile?'nowrap':'wrap',WebkitOverflowScrolling:'touch' as any}}>
        {[
          {v:properties.length,                                                           l:'Communities', c:'#1e293b'},
          {v:properties.filter((p:any)=>p.has_pool).length,                               l:'Pools',        c:'#0369a1'},
          {v:properties.filter((p:any)=>p.has_gate).length,                               l:'Gates',        c:'#7c3aed'},
          {v:properties.filter((p:any)=>p.has_elevator).length,                           l:'Elevators',    c:'#b45309'},
          {v:properties.filter((p:any)=>p.has_compactor).length,                          l:'Compactors',   c:'#0f766e'},
          {v:systems.filter((s:any)=>getStatus(s.id)==='out-of-service').length,           l:'Systems Out',  c:'#dc2626'},
        ].map(s=>(
          <div key={s.l} style={{flexShrink:0}}>
            <div style={{fontSize:isMobile?'20px':'22px',fontWeight:'700',color:s.c}}>{s.v}</div>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Filter bar (portfolio tab only on mobile) ── */}
      {(!isMobile || mobileTab==='portfolio') && (
        <div style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0',padding:isMobile?'8px 12px':'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',background:'#fff',borderRadius:'7px',border:'1px solid #e2e8f0',overflow:'hidden',overflowX:'auto'}}>
            {TABS.map(([v,l])=>(
              <button key={v} onClick={()=>setTab(v)} style={{padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:'none',background:tab===v?'#3b82f6':'transparent',color:tab===v?'#fff':'#94a3b8',whiteSpace:'nowrap' as any}}>
                {l}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {['all',...states].map(s=>(
              <button key={s} onClick={()=>setStateFilter(s)} style={{padding:'3px 9px',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:stateFilter===s?'1.5px solid #3b82f6':'1px solid #e2e8f0',background:stateFilter===s?'#eff6ff':'#fff',color:stateFilter===s?'#1d4ed8':'#64748b'}}>
                {s==='all'?'All States':s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div style={{display:'flex',paddingBottom:isMobile?'68px':undefined}}>

        {/* ── Portfolio list ── */}
        {(!isMobile || mobileTab==='portfolio') && (
          <div style={{flex:1,padding:isMobile?'12px':'20px 24px'}}>
            {byState.map(group=>(
              <div key={group.state} style={{marginBottom:'28px'}}>
                <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{background:'#1e293b',color:'#fff',borderRadius:'4px',padding:'2px 8px',fontSize:'11px'}}>{group.state.toUpperCase()}</span>
                  <span style={{color:'#94a3b8',fontSize:'12px'}}>{group.props.length} {group.props.length===1?'community':'communities'}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(260px,1fr))',gap:'12px'}}>
                  {group.props.map((prop:any)=>(
                    <div
                      key={prop.id}
                      onClick={()=>{setSelectedProp(selectedProp===prop.id?null:prop.id);setDetailTab('systems');setPsrMode('history')}}
                      style={{background:'#fff',borderRadius:'10px',padding:'14px 16px',cursor:'pointer',border:selectedProp===prop.id?'2px solid #3b82f6':'1px solid #e2e8f0',transition:'border-color 0.15s'}}
                    >
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:'600',fontSize:'13px',color:'#1e293b',marginBottom:'2px'}}>{prop.name}</div>
                          <div style={{fontSize:'11px',color:'#64748b'}}>{prop.city}, {prop.state.toUpperCase()}</div>
                        </div>
                        {propHasIssue(prop) && (
                          <span style={{background:'#fef2f2',color:'#dc2626',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'10px',flexShrink:0,marginLeft:'8px'}}>Issue</span>
                        )}
                      </div>
                      {renderSystemBadges(prop)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Alerts screen (mobile only) ── */}
        {isMobile && mobileTab==='alerts' && renderAlerts()}

        {/* ── Settings placeholder (mobile only) ── */}
        {isMobile && mobileTab==='settings' && (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'40px',paddingBottom:'80px'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'12px'}}>⚙️</div>
              <div style={{fontWeight:'600',fontSize:'14px',color:'#1e293b',marginBottom:'6px'}}>Settings</div>
              <div style={{fontSize:'12px',color:'#94a3b8'}}>Coming soon</div>
            </div>
          </div>
        )}

        {/* ── Desktop detail panel ── */}
        {!isMobile && detailProp && (
          <div style={{width:'400px',borderLeft:'1px solid #e2e8f0',background:'#fff',position:'sticky',top:0,height:'100vh',overflowY:'auto',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'4px'}}>
                <div style={{fontWeight:'700',fontSize:'14px',color:'#1e293b'}}>{detailProp.name}</div>
                <button onClick={()=>setSelectedProp(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#94a3b8',lineHeight:1}}>×</button>
              </div>
              <div style={{fontSize:'12px',color:'#64748b'}}>{detailProp.city}, {detailProp.state.toUpperCase()}</div>
            </div>
            <div style={{display:'flex',borderBottom:'1px solid #e2e8f0'}}>
              {DETAIL_TABS.map(([v,l])=>(
                <button key={v} onClick={()=>setDetailTab(v)} style={{flex:1,padding:'8px 4px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:'none',borderBottom:detailTab===v?'2px solid #3b82f6':'2px solid transparent',background:'transparent',color:detailTab===v?'#1e293b':'#94a3b8'}}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{padding:'16px 20px',flex:1,overflowY:'auto'}}>
              {renderDetailContent()}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile detail overlay ── */}
      {isMobile && detailProp && mobileTab==='portfolio' && (
        <div style={{position:'fixed',inset:0,background:'#f1f5f9',zIndex:100,display:'flex',flexDirection:'column'}}>
          <div style={{background:'#0f172a',padding:'12px 16px',display:'flex',alignItems:'center',gap:'10px'}}>
            <button
              onClick={()=>setSelectedProp(null)}
              style={{display:'flex',alignItems:'center',gap:'4px',background:'rgba(255,255,255,0.1)',border:'none',borderRadius:'20px',padding:'5px 12px',color:'#94a3b8',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}
            >
              ← Back
            </button>
            <div>
              <div style={{color:'#f8fafc',fontSize:'13px',fontWeight:'600'}}>{detailProp.name}</div>
              <div style={{color:'#64748b',fontSize:'10px'}}>{detailProp.city}, {detailProp.state.toUpperCase()}</div>
            </div>
          </div>
          <div style={{display:'flex',background:'#fff',borderBottom:'1px solid #e2e8f0'}}>
            {DETAIL_TABS.map(([v,l])=>(
              <button key={v} onClick={()=>setDetailTab(v)} style={{flex:1,padding:'10px 4px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:'none',borderBottom:detailTab===v?'2px solid #3b82f6':'2px solid transparent',background:'transparent',color:detailTab===v?'#1e293b':'#94a3b8'}}>
                {l}
              </button>
            ))}
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'12px',paddingBottom:'80px'}}>
            {renderDetailContent()}
          </div>
        </div>
      )}

      {/* ── Bottom nav (mobile only) ── */}
      {isMobile && (
        <div style={{position:'fixed',bottom:0,left:0,right:0,height:'68px',paddingBottom:'env(safe-area-inset-bottom)',background:'#fff',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-around',zIndex:200}}>
          {([
            {id:'portfolio', icon:'🏢', label:'Portfolio'},
            {id:'alerts',    icon:'🔔', label:'Alerts'},
            {id:'settings',  icon:'⚙️', label:'Settings'},
          ] as const).map(t=>(
            <div
              key={t.id}
              onClick={()=>{ setMobileTab(t.id); if(t.id!=='portfolio') setSelectedProp(null) }}
              style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'3px',cursor:'pointer',padding:'4px 20px'}}
            >
              <span style={{fontSize:'22px'}}>{t.icon}</span>
              <span style={{fontSize:'10px',fontWeight:'600',color:mobileTab===t.id?'#3b82f6':'#94a3b8'}}>{t.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Status update modal ── */}
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'16px'}}>
          <div style={{background:'#fff',borderRadius:'12px',padding:'20px',width:'100%',maxWidth:'400px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
              <div style={{fontWeight:'700',fontSize:'14px',color:'#1e293b'}}>Update Status</div>
              <button onClick={()=>setModal(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'#94a3b8'}}>×</button>
            </div>
            <div style={{fontSize:'12px',color:'#64748b',marginBottom:'14px'}}>{modal.name}</div>
            <div style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Status</div>
              <div style={{display:'flex',gap:'6px'}}>
                {(['in-service','out-of-service','maintenance'] as const).map(s=>(
                  <button key={s} onClick={()=>setForm(f=>({...f,status:s,reason:''}))} style={{flex:1,padding:'7px 4px',borderRadius:'7px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:form.status===s?'2px solid '+STATUS_META[s].color:'1px solid #e2e8f0',background:form.status===s?STATUS_META[s].bg:'#f8fafc',color:form.status===s?STATUS_META[s].color:'#64748b'}}>
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>
            {form.status!=='in-service' && (
              <div style={{marginBottom:'12px'}}>
                <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reason</div>
                <select value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px'}}>
                  <option value=''>Select reason...</option>
                  {(REASONS[modal.system_type]||[]).map((r:string)=><option key={r}>{r}</option>)}
                </select>
              </div>
            )}
            <div style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Notes</div>
              <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',minHeight:'68px',resize:'vertical' as any,boxSizing:'border-box' as any}}/>
            </div>
            <div style={{marginBottom:'16px'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#334155',marginBottom:'6px'}}>Reported By</div>
              <input value={form.reportedBy} onChange={e=>setForm(f=>({...f,reportedBy:e.target.value}))} style={{width:'100%',padding:'8px 10px',borderRadius:'7px',border:'1px solid #e2e8f0',fontSize:'13px',boxSizing:'border-box' as any}}/>
            </div>
            <div style={{display:'flex',gap:'10px'}}>
              <button onClick={()=>setModal(null)} style={{flex:1,padding:'10px',background:'#f1f5f9',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#64748b'}}>Cancel</button>
              <button onClick={saveStatus} disabled={saving} style={{flex:2,padding:'10px',background:'#3b82f6',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',color:'#fff'}}>{saving?'Saving...':'Save Status'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Prior Versions modal ── */}
      {versionsFor && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'16px'}}>
          <div style={{background:'#fff',borderRadius:'12px',padding:'20px',width:'100%',maxWidth:'460px',maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
              <div style={{fontWeight:'700',fontSize:'14px',color:'#1e293b'}}>Prior Versions</div>
              <button onClick={()=>{setVersionsFor(null);setVersionList([]);setExpandedVersion(null)}} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'#94a3b8'}}>×</button>
            </div>
            <div style={{fontSize:'12px',color:'#64748b',marginBottom:'14px'}}>Report dated {versionsFor.report_date}</div>
            <div style={{overflowY:'auto',flex:1}}>
              {loadingVersions
                ? <div style={{textAlign:'center',color:'#94a3b8',fontSize:'13px',padding:'30px 0'}}>Loading versions...</div>
                : versionList.length===0
                  ? <div style={{textAlign:'center',color:'#94a3b8',fontSize:'13px',padding:'30px 0'}}>No prior versions yet. Versions are saved each time this report is edited from now on.</div>
                  : versionList.map((v:any)=>{
                      const snap = v.snapshot||{}
                      const isOpen = expandedVersion===v.id
                      return (
                        <div key={v.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',marginBottom:'8px',overflow:'hidden'}}>
                          <div onClick={()=>setExpandedVersion(isOpen?null:v.id)} style={{padding:'10px 12px',cursor:'pointer',background:'#f8fafc'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                              <div style={{fontWeight:'600',fontSize:'12px',color:'#1e293b'}}>Edited by {v.edited_by||'Staff'}</div>
                              <span style={{fontSize:'12px',color:'#94a3b8'}}>{isOpen?'▲':'▼'}</span>
                            </div>
                            <div style={{fontSize:'10px',color:'#94a3b8',marginTop:'2px'}}>{v.edited_at?new Date(v.edited_at).toLocaleString():''}</div>
                            {v.change_summary && <div style={{fontSize:'10px',color:'#92400e',marginTop:'4px'}}>Changed: {v.change_summary}</div>}
                            {v.edit_note && <div style={{fontSize:'10px',color:'#1e40af',marginTop:'2px'}}>Note: {v.edit_note}</div>}
                          </div>
                          {isOpen && (
                            <div style={{padding:'10px 12px',borderTop:'1px solid #e2e8f0'}}>
                              <div style={{fontSize:'10px',color:'#64748b',marginBottom:'6px',fontStyle:'italic'}}>Snapshot of the report before this edit:</div>
                              {Object.keys(snap).filter(k=>!PSR_IGNORE_FIELDS.includes(k) && snap[k]!=null && snap[k]!=='').map((k:string)=>(
                                <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'3px',gap:'8px'}}>
                                  <span style={{color:'#64748b'}}>{PSR_FIELD_LABELS[k]||k}</span>
                                  <span style={{color:'#1e293b',fontWeight:'600',textAlign:'right'}}>{String(snap[k])}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{position:'fixed',bottom:isMobile?'80px':'20px',right:'20px',background:'#166534',color:'#fff',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',zIndex:400}}>
          {toast}
        </div>
      )}
    </div>
  )
}
