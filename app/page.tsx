'use client'
import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

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
  fire_life_safety: ['Fire alarm fault','Fire panel trouble signal','Sprinkler / standpipe issue','Property on fire watch','Emergency lighting failure','Smoke/heat detector failure','Monitoring/communication loss','Scheduled inspection / testing','Other'],
}

const DOC_TYPES = ['Contract','Warranty','Invoice','General','Other']

const DOC_TYPE_COLORS: Record<string,{bg:string,color:string}> = {
  Contract:{bg:'#eff6ff',color:'#2563eb'},
  Warranty:{bg:'#f0fdf4',color:'#16a34a'},
  Invoice: {bg:'#fff7ed',color:'#ea580c'},
  General: {bg:'#f8fafc',color:'#64748b'},
  Other:   {bg:'#f5f3ff',color:'#7c3aed'},
}

// Map full state names (as stored in the DB) to clean two-letter abbreviations for display
const STATE_ABBR: Record<string,string> = {
  'Alabama':'AL','Florida':'FL','Georgia':'GA','North Carolina':'NC',
  'South Carolina':'SC','Tennessee':'TN','Texas':'TX',
}
const abbr = (state:string) => STATE_ABBR[state] || state

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

const fmtDateTime = (ts:string) => ts
  ? new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
  : ''

// Friendly role labels for display
const ROLE_LABELS: Record<string,string> = {
  admin:'Administrator', rm:'Regional Manager', rsm:'Regional Service Manager',
  cm:'Community Manager', sm:'Service Manager', team_member:'Team Member',
}

export default function Home() {
  const [properties,    setProperties]    = useState<any[]>([])
  const [systems,       setSystems]        = useState<any[]>([])
  const [statuses,      setStatuses]       = useState<Record<string,any>>({})
  const [statusHistory, setStatusHistory]  = useState<Record<string,any[]>>({})
  const [systemNotes,   setSystemNotes]     = useState<Record<string,any[]>>({})
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
  const [editNotes,     setEditNotes]      = useState('')
  const [savingEdit,    setSavingEdit]     = useState(false)
  const [psrSearch,     setPsrSearch]      = useState('')
  const [psrSort,       setPsrSort]        = useState<'newest'|'oldest'>('newest')
  const [expandedPsr,   setExpandedPsr]    = useState<number|null>(null)
  const [versionsFor,   setVersionsFor]    = useState<any>(null)
  const [versionList,   setVersionList]    = useState<any[]>([])
  const [loadingVersions,setLoadingVersions]=useState(false)
  const [expandedVersion,setExpandedVersion]=useState<number|null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Record<string,boolean>>({})
  const [noteDrafts,    setNoteDrafts]     = useState<Record<string,{text:string,author:string}>>({})
  const [savingNote,    setSavingNote]     = useState<string|null>(null)
  const [systemVendors, setSystemVendors]  = useState<Record<string,any[]>>({})
  const [eventCosts,    setEventCosts]     = useState<Record<number,any>>({})
  const [costLogs,      setCostLogs]       = useState<Record<number,any[]>>({})
  const [eventDocs,     setEventDocs]      = useState<Record<number,any[]>>({})
  const [expandedCosts,   setExpandedCosts]   = useState<Record<number,boolean>>({})
  const [vendorDrafts,  setVendorDrafts]   = useState<Record<string,{vendor_name:string,phone:string,email:string}>>({})
  const [savingVendor,  setSavingVendor]   = useState<string|null>(null)
  const [editingVendor, setEditingVendor]  = useState<number|null>(null)
  const [vendorEditForm,setVendorEditForm] = useState<any>({})
  const [costDrafts,    setCostDrafts]     = useState<Record<number,{estimated_cost:string,estimated_completion:string,editor:string}>>({})
  const [savingCost,    setSavingCost]     = useState<number|null>(null)
  const [uploadingEventDoc, setUploadingEventDoc] = useState<number|null>(null)
  // ─── Per-event vendors (keyed by status_update_id) ───
  const [eventVendors,  setEventVendors]   = useState<Record<number,any[]>>({})
  const [expandedEventVendors, setExpandedEventVendors] = useState<Record<number,boolean>>({})
  const [eventVendorDrafts, setEventVendorDrafts] = useState<Record<number,{vendor_name:string,phone:string,email:string,work_description:string}>>({})
  const [savingEventVendor, setSavingEventVendor] = useState<number|null>(null)
  // ─── PSR section photos ───
  // Saved photos for the report currently open in history/edit, grouped by section
  const [psrPhotos,     setPsrPhotos]      = useState<Record<string,any[]>>({})
  // Photos held in New mode before the report has an id (grouped by section). Each item: {file, url}
  const [pendingPsrPhotos, setPendingPsrPhotos] = useState<Record<string,{file:File,url:string}[]>>({})
  const [uploadingPsrPhoto, setUploadingPsrPhoto] = useState<string|null>(null)
  const [photoViewer,   setPhotoViewer]    = useState<string|null>(null)
  const [tab,           setTab]            = useState('all')
  // ─── Filter state (Filter Type → State or RM Region) ───
  const [filterType,    setFilterType]     = useState<'state'|'rm'>('state')
  const [stateFilter,   setStateFilter]    = useState('all')
  const [rmFilter,      setRmFilter]       = useState('all')
  const [modal,         setModal]          = useState<any>(null)
  const [form,          setForm]           = useState({status:'in-service',reason:'',notes:'',reportedBy:''})
  const [saving,        setSaving]         = useState(false)
  const [toast,         setToast]          = useState<string|null>(null)
  const [psrForm,       setPsrForm]        = useState<any>({})
  const [savingPsr,     setSavingPsr]      = useState(false)
  const [sysInfoForm,   setSysInfoForm]    = useState<Record<string,any>>({})
  const [savingSysInfo, setSavingSysInfo]  = useState(false)
  const [dragOver,      setDragOver]       = useState<string|null>(null)
  const [uploading,     setUploading]      = useState<string|null>(null)
  const [docFilter,     setDocFilter]      = useState('all')
  const [pendingType,   setPendingType]    = useState<Record<string,string>>({})
  const [isMobile,      setIsMobile]       = useState(false)
  const [mobileTab,     setMobileTab]      = useState<'portfolio'|'alerts'|'settings'>('portfolio')
  // ─── Systems Out portfolio-wide view ───
  const [systemsOutOpen, setSystemsOutOpen] = useState(false)
  const [systemsOutSort, setSystemsOutSort] = useState<'recent'|'state'|'rm'|'property'>('recent')
  const [expandedOutRow, setExpandedOutRow] = useState<string|null>(null)
  // ─── Admin delete: holds the entry pending confirmation ───
  // shape: {kind, label, run:()=>Promise<void>}
  const [pendingDelete, setPendingDelete] = useState<any>(null)
  const [deleting,      setDeleting]      = useState(false)
  // ─── Site Visits ───
  const [siteVisits,    setSiteVisits]    = useState<Record<string,any[]>>({})
  const [siteVisitDocs, setSiteVisitDocs] = useState<Record<number,any[]>>({})
  const [visitNote,     setVisitNote]     = useState('')
  const [savingVisit,   setSavingVisit]   = useState(false)
  const [pendingVisitFiles, setPendingVisitFiles] = useState<File[]>([])
  const [uploadingVisitDoc, setUploadingVisitDoc] = useState<number|null>(null)
  const [expandedVisit, setExpandedVisit] = useState<number|null>(null)
  // ─── Role / access state (Phase C) ───
  const [userRole,      setUserRole]       = useState<string|null>(null)
  const [myProps,       setMyProps]        = useState<string[]>([])
  const [userName,      setUserName]       = useState<string>('')
  const [signingOut,    setSigningOut]     = useState(false)
  const fileInputRefs = useRef<Record<string,HTMLInputElement|null>>({})

  // ─── Detect mobile ───────────────────────────────────────────────────────────
  useEffect(()=>{
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  },[])

  // ─── Load the logged-in user's role + assigned properties (Phase C) ───────────
  useEffect(()=>{
    async function loadAccess(){
      const {data:{user}} = await supabase.auth.getUser()
      if(!user) return
      const {data} = await supabase.from('user_access').select('*').eq('user_id', user.id).single()
      if(data){
        setUserRole(data.role || null)
        setMyProps(Array.isArray(data.assigned_property_ids) ? data.assigned_property_ids : [])
        setUserName(data.full_name || '')
      }
    }
    loadAccess()
  },[])

  // ─── Sign out ─────────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    setSigningOut(true)
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // ─── Load data ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    async function loadData(){
      const {data:props,  error:e1} = await supabase.from('properties').select('*')
      const {data:sys,    error:e2} = await supabase.from('systems').select('*')
      const {data:statUpd}          = await supabase.from('status_updates').select('*').order('created_at',{ascending:false})
      const {data:notes}            = await supabase.from('system_notes').select('*').order('created_at',{ascending:false})
      const {data:sysInfo}          = await supabase.from('system_info').select('*')
      const {data:psr}              = await supabase.from('psr_reports').select('*').order('report_date',{ascending:false})
      const {data:docs}             = await supabase.from('documents').select('*').order('created_at',{ascending:false})
      const {data:alerts}           = await supabase.from('alert_log').select('*').order('created_at',{ascending:false}).limit(50)
      const {data:vendors}          = await supabase.from('system_vendors').select('*').order('created_at',{ascending:true})
      const {data:ecosts}           = await supabase.from('event_costs').select('*')
      const {data:eclogs}           = await supabase.from('event_cost_log').select('*').order('created_at',{ascending:false})
      const {data:edocs}            = await supabase.from('event_documents').select('*').order('created_at',{ascending:false})
      const {data:evendors}         = await supabase.from('event_vendors').select('*').order('created_at',{ascending:true})
      const {data:svisits}          = await supabase.from('site_visits').select('*').order('visit_date',{ascending:false})
      const {data:svdocs}           = await supabase.from('site_visit_documents').select('*').order('created_at',{ascending:false})
      if(e1) setError(e1.message)
      else if(e2) setError(e2.message)
      else {
        setProperties(props||[])
        setSystems(sys||[])
        // Latest status per system (for badges) + full history per system (for traceability)
        const ls:Record<string,any>={}
        const hist:Record<string,any[]>={}
        ;(statUpd||[]).forEach((s:any)=>{
          if(!ls[s.system_id]) ls[s.system_id]=s
          ;(hist[s.system_id] = hist[s.system_id]||[]).push(s)
        })
        setStatuses(ls)
        setStatusHistory(hist)
        // Notes grouped by system, newest first
        const nm:Record<string,any[]>={}
        ;(notes||[]).forEach((n:any)=>{ (nm[n.system_id] = nm[n.system_id]||[]).push(n) })
        setSystemNotes(nm)
        const im:Record<string,any>={}
        ;(sysInfo||[]).forEach((s:any)=>{ im[s.system_id]=s })
        setSystemInfos(im)
        setAllPsrReports(psr||[])
        setDocuments(docs||[])
        setAlertLog(alerts||[])
        // Vendors grouped by system
        const vm:Record<string,any[]>={}
        ;(vendors||[]).forEach((v:any)=>{ (vm[v.system_id] = vm[v.system_id]||[]).push(v) })
        setSystemVendors(vm)
        // Event costs keyed by status_update_id
        const cm:Record<number,any>={}
        ;(ecosts||[]).forEach((c:any)=>{ cm[c.status_update_id]=c })
        setEventCosts(cm)
        // Cost edit logs keyed by event_cost_id
        const clm:Record<number,any[]>={}
        ;(eclogs||[]).forEach((l:any)=>{ (clm[l.event_cost_id] = clm[l.event_cost_id]||[]).push(l) })
        setCostLogs(clm)
        // Event documents keyed by status_update_id
        const edm:Record<number,any[]>={}
        ;(edocs||[]).forEach((d:any)=>{ (edm[d.status_update_id] = edm[d.status_update_id]||[]).push(d) })
        setEventDocs(edm)
        // Event vendors keyed by status_update_id
        const evm:Record<number,any[]>={}
        ;(evendors||[]).forEach((v:any)=>{ (evm[v.status_update_id] = evm[v.status_update_id]||[]).push(v) })
        setEventVendors(evm)
        // Site visits grouped by property (newest first); docs grouped by visit
        const svm:Record<string,any[]>={}
        ;(svisits||[]).forEach((v:any)=>{ (svm[v.property_id] = svm[v.property_id]||[]).push(v) })
        setSiteVisits(svm)
        const svdm:Record<number,any[]>={}
        ;(svdocs||[]).forEach((d:any)=>{ (svdm[d.site_visit_id] = svdm[d.site_visit_id]||[]).push(d) })
        setSiteVisitDocs(svdm)
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
  // Attribution always comes from the logged-in account, never manual entry.
  // Falls back to a visible placeholder so missing accounts are obvious, not disguised as "Staff".
  const actor = () => userName || 'Unknown user'
  const getStatus = (sysId:string) => statuses[sysId]?.status||'in-service'
  const propHasIssue = (prop:any) => systems.filter((s:any)=>s.property_id===prop.id).some((s:any)=>getStatus(s.id)==='out-of-service')

  // ─── Access helpers (Phase C) ───
  // canEdit: admin edits anything; everyone else edits only assigned properties.
  const canEdit = (propId:string|undefined|null) => {
    if(!propId) return false
    if(userRole==='admin') return true
    return myProps.includes(propId)
  }
  const isTeamMember = userRole==='team_member'
  // Only RM, RSM, and admin may log site visits
  const canEditVisits = userRole==='rm' || userRole==='rsm' || userRole==='admin'

  // Days since the most recent visit to a property (null if never visited)
  const daysSinceVisit = (propId:string) => {
    const visits = siteVisits[propId]||[]
    if(visits.length===0) return null
    const latest = visits.reduce((a:any,b:any)=> new Date(a.visit_date)>new Date(b.visit_date)?a:b)
    return Math.floor((Date.now()-new Date(latest.visit_date).getTime())/86400000)
  }

  const saveSiteVisit = async () => {
    if(!detailProp || !canEditVisits) return
    setSavingVisit(true)
    const today = new Date().toISOString().split('T')[0]
    const {data, error} = await supabase.from('site_visits')
      .insert({property_id:detailProp.id, visitor:actor(), visit_date:today, notes:visitNote||null})
      .select()
    if(error){ showToast('Error: '+error.message); setSavingVisit(false); return }
    const inserted = (data&&data[0]) || {id:Date.now(), property_id:detailProp.id, visitor:actor(), visit_date:today, notes:visitNote||null, created_at:new Date().toISOString()}
    setSiteVisits((prev:any)=>({...prev,[detailProp.id]:[inserted,...(prev[detailProp.id]||[])]}))

    // Upload any files attached during creation, now that the visit has an id.
    if(inserted?.id && pendingVisitFiles.length>0){
      const failed:string[] = []
      const uploadedDocs:any[] = []
      for(const file of pendingVisitFiles){
        const path = 'site-visit-'+inserted.id+'/'+Date.now()+'-'+file.name
        const {error:upErr} = await supabase.storage.from('documents').upload(path,file)
        if(upErr){ failed.push(file.name); continue }
        const {data:docData} = await supabase.from('site_visit_documents')
          .insert({site_visit_id:inserted.id, property_id:detailProp.id, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:actor()})
          .select()
        uploadedDocs.push((docData&&docData[0]) || {site_visit_id:inserted.id, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:actor(), created_at:new Date().toISOString()})
      }
      if(uploadedDocs.length) setSiteVisitDocs((prev:any)=>({...prev,[inserted.id]:[...uploadedDocs,...(prev[inserted.id]||[])]}))
      if(failed.length) showToast('Visit saved, but these files failed: '+failed.join(', '))
      else showToast('Site visit logged')
    } else {
      showToast('Site visit logged')
    }

    setVisitNote('')
    setPendingVisitFiles([])
    setSavingVisit(false)
  }

  const uploadVisitDoc = async (visit:any, file:File) => {
    if(!detailProp) return
    setUploadingVisitDoc(visit.id)
    const path = 'site-visit-'+visit.id+'/'+Date.now()+'-'+file.name
    const {error:upErr} = await supabase.storage.from('documents').upload(path,file)
    if(upErr){ showToast('Upload error: '+upErr.message); setUploadingVisitDoc(null); return }
    const {data, error:dbErr} = await supabase.from('site_visit_documents')
      .insert({site_visit_id:visit.id, property_id:detailProp.id, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:actor()})
      .select()
    if(dbErr){ showToast('DB error: '+dbErr.message); setUploadingVisitDoc(null); return }
    const inserted = (data&&data[0]) || {site_visit_id:visit.id, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:actor(), created_at:new Date().toISOString()}
    setSiteVisitDocs((prev:any)=>({...prev,[visit.id]:[inserted,...(prev[visit.id]||[])]}))
    showToast('File uploaded')
    setUploadingVisitDoc(null)
  }

  const deleteSiteVisit = async (visit:any) => {
    const docs = siteVisitDocs[visit.id]||[]
    for(const d of docs){ if(d.file_path) await supabase.storage.from('documents').remove([d.file_path]) }
    await supabase.from('site_visit_documents').delete().eq('site_visit_id',visit.id)
    const {error} = await supabase.from('site_visits').delete().eq('id',visit.id)
    if(error) throw error
    setSiteVisits((prev:any)=>({...prev,[visit.property_id]:(prev[visit.property_id]||[]).filter((v:any)=>v.id!==visit.id)}))
    showToast('Site visit deleted')
  }

  const openModal = (sys:any) => {
    const current = statuses[sys.id]
    setForm({status:current?.status||'in-service', reason:current?.reason||'', notes:current?.notes||'', reportedBy:''})
    setModal(sys)
  }

  const saveStatus = async () => {
    if(!modal) return
    setSaving(true)
    const createdAt = new Date().toISOString()
    const {data, error} = await supabase.from('status_updates')
      .insert({system_id:modal.id, status:form.status, reason:form.reason||null, notes:form.notes||null, reported_by:actor()})
      .select()
    if(error){ showToast('Error: '+error.message) }
    else {
      const inserted = (data&&data[0]) || {system_id:modal.id,status:form.status,reason:form.reason||null,notes:form.notes||null,reported_by:actor(),created_at:createdAt}
      setStatuses((prev:any)=>({...prev,[modal.id]:inserted}))
      // Prepend to history so the timeline reflects the change without a reload
      setStatusHistory((prev:any)=>({...prev,[modal.id]:[inserted,...(prev[modal.id]||[])]}))
      showToast('Status updated')
      setModal(null)
      if(form.status==='out-of-service'||form.status==='maintenance'){
        const newAlert = {type:form.status, property_id:detailProp?.id||'', property_name:detailProp?.name||'', system_name:modal.name, reason:form.reason||null, created_at:createdAt}
        setAlertLog((prev:any)=>[newAlert,...prev])
        await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:form.status, systemName:modal.name, propertyName:detailProp?.name||'', propertyId:detailProp?.id||'', reason:form.reason})})
      }
    }
    setSaving(false)
  }

  const saveNote = async (systemId:string) => {
    const draft = noteDrafts[systemId]
    if(!draft || !draft.text.trim()) return
    setSavingNote(systemId)
    const createdAt = new Date().toISOString()
    const {data, error} = await supabase.from('system_notes')
      .insert({system_id:systemId, note:draft.text.trim(), author:actor()})
      .select()
    if(error){ showToast('Error: '+error.message) }
    else {
      const inserted = (data&&data[0]) || {system_id:systemId, note:draft.text.trim(), author:actor(), created_at:createdAt}
      setSystemNotes((prev:any)=>({...prev,[systemId]:[inserted,...(prev[systemId]||[])]}))
      setNoteDrafts((prev:any)=>({...prev,[systemId]:{text:'',author:''}}))
      showToast('Note added')
      const sys = systems.find((s:any)=>s.id===systemId)
      const newAlert = {type:'note-added', property_id:detailProp?.id||'', property_name:detailProp?.name||'', system_name:sys?.name||'', reason:draft.text.trim(), created_at:createdAt}
      setAlertLog((prev:any)=>[newAlert,...prev])
      await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'note-added', systemName:sys?.name||'', propertyName:detailProp?.name||'', propertyId:detailProp?.id||'', noteAuthor:actor(), noteText:draft.text.trim()})})
    }
    setSavingNote(null)
  }

  // ─── Vendors ──────────────────────────────────────────────────────────────────
  const saveVendor = async (systemId:string) => {
    const draft = vendorDrafts[systemId]
    if(!draft || !draft.vendor_name.trim()) return
    setSavingVendor(systemId)
    const createdAt = new Date().toISOString()
    const {data, error} = await supabase.from('system_vendors')
      .insert({system_id:systemId, vendor_name:draft.vendor_name.trim(), phone:draft.phone||null, email:draft.email||null})
      .select()
    if(error){ showToast('Error: '+error.message) }
    else {
      const inserted = (data&&data[0]) || {system_id:systemId, vendor_name:draft.vendor_name.trim(), phone:draft.phone, email:draft.email, created_at:createdAt}
      setSystemVendors((prev:any)=>({...prev,[systemId]:[...(prev[systemId]||[]),inserted]}))
      setVendorDrafts((prev:any)=>({...prev,[systemId]:{vendor_name:'',phone:'',email:''}}))
      showToast('Vendor added')
    }
    setSavingVendor(null)
  }

  const saveVendorEdit = async (vendorId:number, systemId:string) => {
    const {error} = await supabase.from('system_vendors')
      .update({vendor_name:vendorEditForm.vendor_name, phone:vendorEditForm.phone||null, email:vendorEditForm.email||null})
      .eq('id',vendorId)
    if(error){ showToast('Error: '+error.message); return }
    setSystemVendors((prev:any)=>({...prev,[systemId]:(prev[systemId]||[]).map((v:any)=>v.id===vendorId?{...v,...vendorEditForm}:v)}))
    setEditingVendor(null)
    setVendorEditForm({})
    showToast('Vendor updated')
  }

  // ─── Event costs (per status event, edits logged) ─────────────────────────────
  const saveCost = async (statusEvent:any, systemId:string) => {
    const draft = costDrafts[statusEvent.id]
    if(!draft){ return }
    setSavingCost(statusEvent.id)
    const now = new Date().toISOString()
    const existing = eventCosts[statusEvent.id]
    const newCost = draft.estimated_cost===''?null:Number(draft.estimated_cost)
    const newEta  = draft.estimated_completion||null

    // Build a human-readable diff of what changed
    const diffs:string[] = []
    const oldCost = existing?.estimated_cost ?? null
    const oldEta  = existing?.estimated_completion ?? null
    if(String(oldCost??'')!==String(newCost??'')) diffs.push('Estimated Cost: '+(oldCost!=null?'$'+oldCost:'—')+' -> '+(newCost!=null?'$'+newCost:'—'))
    if(String(oldEta??'')!==String(newEta??''))   diffs.push('Est. Completion: '+(oldEta||'—')+' -> '+(newEta||'—'))
    const changeStr = diffs.length?diffs.join(' | '):'No field changes'

    if(existing){
      const {error} = await supabase.from('event_costs')
        .update({estimated_cost:newCost, estimated_completion:newEta, last_edited_by:actor(), last_edited_at:now})
        .eq('id',existing.id)
      if(error){ showToast('Error: '+error.message); setSavingCost(null); return }
      await supabase.from('event_cost_log').insert({event_cost_id:existing.id, edited_by:actor(), changes:changeStr})
      const updated = {...existing, estimated_cost:newCost, estimated_completion:newEta, last_edited_by:actor(), last_edited_at:now}
      setEventCosts((prev:any)=>({...prev,[statusEvent.id]:updated}))
      setCostLogs((prev:any)=>({...prev,[existing.id]:[{edited_by:actor(),changes:changeStr,created_at:now},...(prev[existing.id]||[])]}))
    } else {
      const {data, error} = await supabase.from('event_costs')
        .insert({status_update_id:statusEvent.id, system_id:systemId, estimated_cost:newCost, estimated_completion:newEta, last_edited_by:actor(), last_edited_at:now})
        .select()
      if(error){ showToast('Error: '+error.message); setSavingCost(null); return }
      const inserted = (data&&data[0]) || {id:Date.now(), status_update_id:statusEvent.id, system_id:systemId, estimated_cost:newCost, estimated_completion:newEta, last_edited_by:actor(), last_edited_at:now}
      await supabase.from('event_cost_log').insert({event_cost_id:inserted.id, edited_by:actor(), changes:'Initial entry — '+changeStr})
      setEventCosts((prev:any)=>({...prev,[statusEvent.id]:inserted}))
      setCostLogs((prev:any)=>({...prev,[inserted.id]:[{edited_by:actor(),changes:'Initial entry — '+changeStr,created_at:now}]}))
    }
    showToast('Cost / ETA saved')
    setSavingCost(null)
  }

  const uploadEventDoc = async (statusEvent:any, systemId:string, file:File) => {
    setUploadingEventDoc(statusEvent.id)
    const path = systemId+'/event-'+statusEvent.id+'/'+Date.now()+'-'+file.name
    const {error:upErr} = await supabase.storage.from('documents').upload(path,file)
    if(upErr){ showToast('Upload error: '+upErr.message); setUploadingEventDoc(null); return }
    const {data, error:dbErr} = await supabase.from('event_documents')
      .insert({status_update_id:statusEvent.id, system_id:systemId, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:'Staff'})
      .select()
    if(dbErr){ showToast('DB error: '+dbErr.message); setUploadingEventDoc(null); return }
    const inserted = (data&&data[0]) || {status_update_id:statusEvent.id, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:'Staff', created_at:new Date().toISOString()}
    setEventDocs((prev:any)=>({...prev,[statusEvent.id]:[inserted,...(prev[statusEvent.id]||[])]}))
    showToast('File uploaded')
    setUploadingEventDoc(null)
  }

  // Add a vendor used on a specific status event
  const saveEventVendor = async (statusEvent:any, systemId:string) => {
    const draft = eventVendorDrafts[statusEvent.id]
    if(!draft || !draft.vendor_name.trim()) return
    setSavingEventVendor(statusEvent.id)
    const createdAt = new Date().toISOString()
    const {data, error} = await supabase.from('event_vendors')
      .insert({status_update_id:statusEvent.id, system_id:systemId, vendor_name:draft.vendor_name.trim(), phone:draft.phone||null, email:draft.email||null, work_description:draft.work_description||null})
      .select()
    if(error){ showToast('Error: '+error.message); setSavingEventVendor(null); return }
    const inserted = (data&&data[0]) || {status_update_id:statusEvent.id, system_id:systemId, vendor_name:draft.vendor_name.trim(), phone:draft.phone, email:draft.email, work_description:draft.work_description, created_at:createdAt}
    setEventVendors((prev:any)=>({...prev,[statusEvent.id]:[...(prev[statusEvent.id]||[]),inserted]}))
    setEventVendorDrafts((prev:any)=>({...prev,[statusEvent.id]:{vendor_name:'',phone:'',email:'',work_description:''}}))
    showToast('Vendor added')
    setSavingEventVendor(null)
  }

  // ─── PSR section photos ────────────────────────────────────────────────────
  // PSR sections that support photos, mapped to a storage-safe key
  const PSR_PHOTO_SECTIONS: Record<string,string> = {
    'Pool / Spa':'pool_spa', 'Fitness Center':'fitness', 'Grills / Outdoor Cooking':'grills',
    'Mailbox Center':'mailbox', 'Fireplaces / Firepits':'fireplaces', 'Elevators':'elevators',
    'TV / Media Equipment':'tv_media', 'Gates / Access Control':'gates', 'Common Areas':'common_areas',
    'Dog Stations':'dog_stations',
  }

  // Load saved photos for a given report, grouped by section
  const loadPsrPhotos = async (reportId:number) => {
    const {data} = await supabase.from('psr_photos').select('*').eq('psr_report_id', reportId).order('created_at',{ascending:true})
    const grouped:Record<string,any[]> = {}
    ;(data||[]).forEach((p:any)=>{ (grouped[p.section] = grouped[p.section]||[]).push(p) })
    setPsrPhotos(grouped)
  }

  // Upload one photo to an existing (saved) report + section
  const uploadPsrPhoto = async (reportId:number, propertyId:string, section:string, file:File) => {
    setUploadingPsrPhoto(section)
    const path = 'psr-'+reportId+'/'+section+'/'+Date.now()+'-'+file.name
    const {error:upErr} = await supabase.storage.from('documents').upload(path,file)
    if(upErr){ showToast('Upload error: '+upErr.message); setUploadingPsrPhoto(null); return }
    const {data, error:dbErr} = await supabase.from('psr_photos')
      .insert({psr_report_id:reportId, property_id:propertyId, section, file_name:file.name, file_path:path, file_size:file.size, uploaded_by:userName||'Staff'})
      .select()
    if(dbErr){ showToast('DB error: '+dbErr.message); setUploadingPsrPhoto(null); return }
    const inserted = (data&&data[0]) || {psr_report_id:reportId, section, file_name:file.name, file_path:path, file_size:file.size, created_at:new Date().toISOString()}
    setPsrPhotos((prev:any)=>({...prev,[section]:[...(prev[section]||[]),inserted]}))
    showToast('Photo added')
    setUploadingPsrPhoto(null)
  }

  const deletePsrPhoto = async (photo:any, section:string) => {
    const {error} = await supabase.from('psr_photos').delete().eq('id',photo.id)
    if(error){ showToast('Error: '+error.message); return }
    await supabase.storage.from('documents').remove([photo.file_path])
    setPsrPhotos((prev:any)=>({...prev,[section]:(prev[section]||[]).filter((p:any)=>p.id!==photo.id)}))
    showToast('Photo removed')
  }

  // In New mode (no report id yet): hold photos in memory, with a preview URL
  const holdPendingPhoto = (section:string, file:File) => {
    const url = URL.createObjectURL(file)
    setPendingPsrPhotos((prev:any)=>({...prev,[section]:[...(prev[section]||[]),{file,url}]}))
  }
  const removePendingPhoto = (section:string, idx:number) => {
    setPendingPsrPhotos((prev:any)=>{
      const arr=[...(prev[section]||[])]
      const [removed]=arr.splice(idx,1)
      if(removed) URL.revokeObjectURL(removed.url)
      return {...prev,[section]:arr}
    })
  }

  const savePsr = async () => {
    if(!detailProp) return
    setSavingPsr(true)
    const {data, error} = await supabase.from('psr_reports').insert({...psrForm, property_id:detailProp.id, report_date:new Date().toISOString().split('T')[0]}).select()
    if(error){ showToast('Error: '+error.message); setSavingPsr(false); return }
    const saved = data&&data[0]
    showToast('PSR saved')
    setAllPsrReports((prev:any)=>[...(data||[]),...prev])

    // Upload any held photos now that the report has an id. Report stays saved even if a photo fails.
    if(saved?.id){
      const failed:string[] = []
      for(const section of Object.keys(pendingPsrPhotos)){
        for(const item of (pendingPsrPhotos[section]||[])){
          const path = 'psr-'+saved.id+'/'+section+'/'+Date.now()+'-'+item.file.name
          const {error:upErr} = await supabase.storage.from('documents').upload(path,item.file)
          if(upErr){ failed.push(item.file.name); continue }
          await supabase.from('psr_photos').insert({psr_report_id:saved.id, property_id:detailProp.id, section, file_name:item.file.name, file_path:path, file_size:item.file.size, uploaded_by:userName||'Staff'})
          URL.revokeObjectURL(item.url)
        }
      }
      if(failed.length) showToast('Report saved, but these photos failed: '+failed.join(', '))
    }

    setPsrForm({})
    setPendingPsrPhotos({})
    setPsrMode('history')
    const newAlert = {type:'psr-submitted', property_id:detailProp.id, property_name:detailProp.name, report_date:new Date().toISOString().split('T')[0], created_at:new Date().toISOString()}
    setAlertLog((prev:any)=>[newAlert,...prev])
    await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'psr-submitted', propertyName:detailProp.name, propertyId:detailProp.id, reportDate:new Date().toISOString().split('T')[0]})})
    setSavingPsr(false)
  }

  const openEditPsr = (r:any) => {
    setEditingPsr(r)
    setEditPsrForm({...r})
    setEditNotes('')
    setPsrMode('edit')
    loadPsrPhotos(r.id)
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
      edited_by:     actor(),
      edited_at:     new Date().toISOString(),
    })
    if(verErr){ showToast('Version save error: '+verErr.message); setSavingEdit(false); return }

    // 3. Update the live report. We keep edit_notes as a combined human-readable record.
    const combinedNote = changeSummary + (editNotes ? ' || Note: '+editNotes : '')
    const updateData = {...editPsrForm, edited_by:actor(), edited_at:new Date().toISOString(), edit_notes:combinedNote}
    const {error} = await supabase.from('psr_reports').update(updateData).eq('id',editingPsr.id)
    if(error){ showToast('Error: '+error.message); setSavingEdit(false); return }

    showToast('PSR report updated')
    setAllPsrReports((prev:any)=>prev.map((r:any)=>r.id===editingPsr.id?{...r,...updateData}:r))

    // 4. Notify all subscribers about the edit
    const newAlert = {type:'psr-edited', property_id:detailProp?.id||'', property_name:detailProp?.name||'', report_date:editingPsr.report_date, reason:changeSummary, created_at:new Date().toISOString()}
    setAlertLog((prev:any)=>[newAlert,...prev])
    await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      type:'psr-edited',
      propertyName: detailProp?.name||'',
      propertyId:   detailProp?.id||'',
      reportDate:   editingPsr.report_date,
      editedBy:     actor(),
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

  // ─── Admin delete helpers ───────────────────────────────────────────────────
  // Opens the confirmation modal with a description and the actual delete to run.
  const askDelete = (label:string, run:()=>Promise<void>) => setPendingDelete({label, run})

  const runPendingDelete = async () => {
    if(!pendingDelete) return
    setDeleting(true)
    try { await pendingDelete.run() }
    catch(e:any){ showToast('Delete error: '+(e?.message||'unknown')) }
    setDeleting(false)
    setPendingDelete(null)
  }

  // Delete a status event AND its dependent cost/vendor/document records + their files.
  const deleteStatusEvent = async (eventId:number, systemId:string) => {
    // remove dependent event files from storage first
    const edocs = eventDocs[eventId]||[]
    for(const d of edocs){ if(d.file_path) await supabase.storage.from('documents').remove([d.file_path]) }
    const cost = eventCosts[eventId]
    if(cost?.id) await supabase.from('event_cost_log').delete().eq('event_cost_id',cost.id)
    await supabase.from('event_costs').delete().eq('status_update_id',eventId)
    await supabase.from('event_vendors').delete().eq('status_update_id',eventId)
    await supabase.from('event_documents').delete().eq('status_update_id',eventId)
    const {error} = await supabase.from('status_updates').delete().eq('id',eventId)
    if(error) throw error
    // update local state
    setStatusHistory((prev:any)=>({...prev,[systemId]:(prev[systemId]||[]).filter((h:any)=>h.id!==eventId)}))
    setEventCosts((prev:any)=>{ const n={...prev}; delete n[eventId]; return n })
    setEventVendors((prev:any)=>{ const n={...prev}; delete n[eventId]; return n })
    setEventDocs((prev:any)=>{ const n={...prev}; delete n[eventId]; return n })
    // recompute latest status for the badge from remaining history
    setStatuses((prev:any)=>{
      const remaining = (statusHistory[systemId]||[]).filter((h:any)=>h.id!==eventId)
      const latest = remaining[0]
      const n={...prev}
      if(latest) n[systemId]=latest; else delete n[systemId]
      return n
    })
    showToast('Status event deleted')
  }

  const deletePsrReport = async (report:any) => {
    // remove this report's photos (records + files)
    const {data:photos} = await supabase.from('psr_photos').select('*').eq('psr_report_id',report.id)
    for(const p of (photos||[])){ if(p.file_path) await supabase.storage.from('documents').remove([p.file_path]) }
    await supabase.from('psr_photos').delete().eq('psr_report_id',report.id)
    await supabase.from('psr_report_versions').delete().eq('psr_report_id',report.id)
    const {error} = await supabase.from('psr_reports').delete().eq('id',report.id)
    if(error) throw error
    setAllPsrReports((prev:any)=>prev.filter((r:any)=>r.id!==report.id))
    showToast('PSR report deleted')
  }

  const deleteNote = async (noteId:number, systemId:string) => {
    const {error} = await supabase.from('system_notes').delete().eq('id',noteId)
    if(error) throw error
    setSystemNotes((prev:any)=>({...prev,[systemId]:(prev[systemId]||[]).filter((n:any)=>n.id!==noteId)}))
    showToast('Note deleted')
  }

  const deleteServicingVendor = async (vendorId:number, systemId:string) => {
    const {error} = await supabase.from('system_vendors').delete().eq('id',vendorId)
    if(error) throw error
    setSystemVendors((prev:any)=>({...prev,[systemId]:(prev[systemId]||[]).filter((v:any)=>v.id!==vendorId)}))
    showToast('Vendor deleted')
  }

  const deleteEventVendor = async (vendorId:number, eventId:number) => {
    const {error} = await supabase.from('event_vendors').delete().eq('id',vendorId)
    if(error) throw error
    setEventVendors((prev:any)=>({...prev,[eventId]:(prev[eventId]||[]).filter((v:any)=>v.id!==vendorId)}))
    showToast('Vendor deleted')
  }

  const deleteEventCost = async (cost:any, eventId:number) => {
    if(cost?.id) await supabase.from('event_cost_log').delete().eq('event_cost_id',cost.id)
    const {error} = await supabase.from('event_costs').delete().eq('status_update_id',eventId)
    if(error) throw error
    setEventCosts((prev:any)=>{ const n={...prev}; delete n[eventId]; return n })
    if(cost?.id) setCostLogs((prev:any)=>{ const n={...prev}; delete n[cost.id]; return n })
    showToast('Cost entry deleted')
  }

  const deleteDocument = async (doc:any) => {
    if(doc.file_path) await supabase.storage.from('documents').remove([doc.file_path])
    const {error} = await supabase.from('documents').delete().eq('id',doc.id)
    if(error) throw error
    setDocuments((prev:any)=>prev.filter((d:any)=>d.id!==doc.id))
    showToast('Document deleted')
  }

  const deleteEventDoc = async (docItem:any, eventId:number) => {
    if(docItem.file_path) await supabase.storage.from('documents').remove([docItem.file_path])
    const {error} = await supabase.from('event_documents').delete().eq('id',docItem.id)
    if(error) throw error
    setEventDocs((prev:any)=>({...prev,[eventId]:(prev[eventId]||[]).filter((d:any)=>d.id!==docItem.id)}))
    showToast('File deleted')
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
  // Unique RMs present in the portfolio (skip blanks), sorted alphabetically
  const rms = [...new Set(properties.map((p:any)=>p.rm).filter(Boolean))].sort()
  // Team Members see only their assigned properties; everyone else sees all.
  const visibleProperties = isTeamMember ? properties.filter((p:any)=>myProps.includes(p.id)) : properties
  const filtered = visibleProperties.filter((p:any)=>{
    const tabOk = tab==='all'||(tab==='elevators'&&p.has_elevator)||(tab==='compactors'&&p.has_compactor)||(tab==='pools'&&p.has_pool)||(tab==='gates'&&p.has_gate)
    // State and RM filters are independent — whichever filter type is active is the one applied.
    const filterOk = filterType==='state'
      ? (stateFilter==='all' || p.state===stateFilter)
      : (rmFilter==='all'    || p.rm===rmFilter)
    return tabOk && filterOk
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
  // Alerts the current user is allowed to see (admin: all; others: only assigned properties)
  const visibleAlerts = userRole==='admin'
    ? alertLog
    : alertLog.filter((a:any)=> a.property_id ? myProps.includes(a.property_id) : false)

  const TABS        = [['all','All'],['elevators','Elevators'],['compactors','Compactors'],['pools','Pools'],['gates','Gates']]
  const DETAIL_TABS = [['systems','Systems'],['psr','PSR Report'],['sysinfo','System Info'],['documents','Documents'],['visits','Site Visits']]

  if(loading) return <div style={{padding:'40px',textAlign:'center'}}>Loading...</div>
  if(error)   return <div style={{padding:'40px',color:'red'}}>Error: {error}</div>

  // ─── Reusable PSR section photo block ──────────────────────────────────────
  // mode: 'new' uses pending (in-memory) photos; 'saved' uses uploaded photos tied to a report id
  const renderPsrPhotos = (sectionLabel:string, mode:'new'|'saved', reportId?:number, propertyId?:string, canEditPhotos:boolean=true) => {
    const section = PSR_PHOTO_SECTIONS[sectionLabel]
    if(!section) return null
    const pending = pendingPsrPhotos[section]||[]
    const saved   = psrPhotos[section]||[]
    const thumb = {width:'56px',height:'56px',objectFit:'cover' as any,borderRadius:'6px',border:'1px solid #e2e8f0',cursor:'pointer'}
    return (
      <div style={{marginTop:'8px',borderTop:'1px dashed #e2e8f0',paddingTop:'8px'}}>
        <div style={{fontSize:'10px',fontWeight:'700',color:'#64748b',marginBottom:'6px'}}>📷 Photos</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:canEditPhotos?'6px':'0'}}>
          {mode==='new'
            ? pending.map((p:any,i:number)=>(
                <div key={i} style={{position:'relative' as any}}>
                  <img src={p.url} style={thumb} onClick={()=>setPhotoViewer(p.url)} alt=''/>
                  {canEditPhotos && <button onClick={()=>removePendingPhoto(section,i)} style={{position:'absolute' as any,top:'-6px',right:'-6px',background:'#dc2626',color:'#fff',border:'none',borderRadius:'50%',width:'16px',height:'16px',fontSize:'10px',lineHeight:1,cursor:'pointer'}}>×</button>}
                </div>
              ))
            : saved.map((p:any,i:number)=>(
                <div key={p.id||i} style={{position:'relative' as any}}>
                  <img src={'#'} data-path={p.file_path} style={thumb} onClick={()=>openPsrPhoto(p.file_path)} alt={p.file_name} title={p.file_name}
                       ref={el=>{ if(el) hydratePsrThumb(el,p.file_path) }}/>
                  {canEditPhotos && <button onClick={()=>deletePsrPhoto(p,section)} style={{position:'absolute' as any,top:'-6px',right:'-6px',background:'#dc2626',color:'#fff',border:'none',borderRadius:'50%',width:'16px',height:'16px',fontSize:'10px',lineHeight:1,cursor:'pointer'}}>×</button>}
                </div>
              ))
          }
          {((mode==='new'&&pending.length===0)||(mode==='saved'&&saved.length===0)) && (
            <div style={{fontSize:'10px',color:'#94a3b8',alignSelf:'center'}}>No photos yet.</div>
          )}
        </div>
        {canEditPhotos && (
          <label style={{display:'inline-block',padding:'5px 10px',background:'#eff6ff',color:'#2563eb',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>
            {uploadingPsrPhoto===section?'Uploading...':'+ Add Photo'}
            <input type='file' accept='image/*' style={{display:'none'}} onChange={e=>{
              const f=e.target.files?.[0]
              if(!f) return
              if(mode==='new') holdPendingPhoto(section,f)
              else if(reportId&&propertyId) uploadPsrPhoto(reportId,propertyId,section,f)
              e.target.value=''
            }}/>
          </label>
        )}
      </div>
    )
  }

  // Saved-photo thumbnails need a signed URL; we fetch and set it on the <img> once.
  const hydratePsrThumb = async (el:HTMLImageElement, path:string) => {
    if(el.dataset.loaded==='1') return
    el.dataset.loaded='1'
    const {data} = await supabase.storage.from('documents').createSignedUrl(path,3600)
    if(data?.signedUrl) el.src = data.signedUrl
  }
  // Open a saved photo full-size in the viewer
  const openPsrPhoto = async (path:string) => {
    const {data} = await supabase.storage.from('documents').createSignedUrl(path,3600)
    if(data?.signedUrl) setPhotoViewer(data.signedUrl)
  }

  // ─── A single document upload bucket (reused per system + property-wide) ───────
  const renderDocBucket = (bucketKey:string, title:string, subtitle:string, editable:boolean) => {
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

        {/* Upload controls only render if the user can edit this property */}
        {editable && (
          <>
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
          </>
        )}

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
                  {doc.id && TrashBtn('Delete document "'+doc.file_name+'"? This removes the file permanently. This cannot be undone.', ()=>deleteDocument(doc), 13)}
                </div>
              )
            })
        }
      </div>
    )
  }

  // Small admin-only trash icon. Shows only for admins; opens the confirm modal.
  const TrashBtn = (label:string, run:()=>Promise<void>, size:number=14) => {
    if(userRole!=='admin') return null
    return (
      <button
        onClick={(e)=>{ e.stopPropagation(); askDelete(label, run) }}
        title='Delete (admin)'
        style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:size+'px',lineHeight:1,padding:'2px',flexShrink:0}}
      >🗑️</button>
    )
  }

  // ─── Detail panel content (shared desktop + mobile) ───────────────────────────
  const renderDetailContent = () => {
  // editable = may the current user edit the property that's open?
  const editable = detailProp ? canEdit(detailProp.id) : false
  return (
    <>
      {/* View-only banner when the user can't edit this property */}
      {detailProp && !editable && (
        <div style={{marginBottom:'12px',padding:'8px 10px',background:'#fef9c3',border:'1px solid #fde68a',borderRadius:'7px',fontSize:'11px',color:'#92400e',fontWeight:'600'}}>
          View only — you are not assigned to this property, so editing is disabled.
        </div>
      )}
      {/* Systems tab */}
      {detailTab==='systems' && (
        <div>
          {propSystems.length===0
            ? <div style={{fontSize:'12px',color:'#94a3b8'}}>No systems tracked.</div>
            : propSystems.map((sys:any)=>{
                const st = statuses[sys.id]
                const statusKey = st?.status||'in-service'
                const meta = STATUS_META[statusKey]
                const history = statusHistory[sys.id]||[]
                const notes   = systemNotes[sys.id]||[]
                const historyOpen = !!expandedHistory[sys.id]
                const draft = noteDrafts[sys.id]||{text:'',author:''}
                return (
                  <div key={sys.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'12px',marginBottom:'10px',background:'#fafafa'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
                      <div>
                        <div style={{fontWeight:'600',fontSize:'13px'}}>{sys.name}</div>
                        <div style={{fontSize:'11px',color:'#64748b',textTransform:'capitalize'}}>{sys.system_type}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'3px',flexShrink:0}}>
                        <span style={{background:meta.bg,color:meta.color,border:'1px solid '+meta.border,padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>{meta.label}</span>
                        {(statusKey==='out-of-service'||statusKey==='maintenance') && (()=>{
                          // Staleness of the current outage: most recent of status event, its cost edit, or latest note.
                          const candidates:number[] = []
                          if(st?.created_at) candidates.push(new Date(st.created_at).getTime())
                          const cost = st?.id?eventCosts[st.id]:null
                          if(cost?.last_edited_at) candidates.push(new Date(cost.last_edited_at).getTime())
                          const ns = systemNotes[sys.id]||[]
                          if(ns[0]?.created_at) candidates.push(new Date(ns[0].created_at).getTime())
                          const latest = candidates.length?Math.max(...candidates):null
                          const daysAgo = latest!==null?Math.floor((Date.now()-latest)/86400000):null
                          const stale = daysAgo!==null && daysAgo>7
                          return (
                            <span style={{fontSize:'9px',color:stale?'#dc2626':'#94a3b8',fontWeight:stale?'700':'400',textAlign:'right'}}>
                              Updated {daysAgo===null?'—':(daysAgo===0?'today':daysAgo+'d ago')}{stale?' · stale':''}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    {st?.reason && <div style={{fontSize:'11px',color:'#dc2626',marginBottom:'4px'}}>{st.reason}</div>}
                    {st?.notes  && <div style={{fontSize:'11px',color:'#64748b',fontStyle:'italic',marginBottom:'6px'}}>{st.notes}</div>}
                    {editable && <button onClick={()=>openModal(sys)} style={{width:'100%',padding:'8px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Update Status</button>}

                    {/* ── Status history (traceability) ── */}
                    <div style={{marginTop:'10px',borderTop:'1px solid #e2e8f0',paddingTop:'8px'}}>
                      <div
                        onClick={()=>setExpandedHistory(prev=>({...prev,[sys.id]:!historyOpen}))}
                        style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}
                      >
                        <span style={{fontSize:'11px',fontWeight:'700',color:'#475569'}}>Status History {history.length>0?'('+history.length+')':''}</span>
                        <span style={{fontSize:'11px',color:'#94a3b8'}}>{historyOpen?'▲':'▼'}</span>
                      </div>
                      {historyOpen && (
                        <div style={{marginTop:'8px'}}>
                          {history.length===0
                            ? <div style={{fontSize:'11px',color:'#94a3b8'}}>No status changes recorded.</div>
                            : history.map((h:any,i:number)=>{
                                const hm = STATUS_META[h.status]||STATUS_META['in-service']
                                return (
                                  <div key={h.id||i} style={{borderLeft:'2px solid '+hm.border,paddingLeft:'10px',marginBottom:'8px'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'2px'}}>
                                      <span style={{background:hm.bg,color:hm.color,border:'1px solid '+hm.border,padding:'1px 7px',borderRadius:'10px',fontSize:'10px',fontWeight:'600'}}>{hm.label}</span>
                                      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                                        <span style={{fontSize:'10px',color:'#94a3b8'}}>{fmtDateTime(h.created_at)}</span>
                                        {h.id && TrashBtn('Delete this status event ('+(hm.label)+', '+fmtDateTime(h.created_at)+')? This also removes its cost, vendor, and file records. This cannot be undone.', ()=>deleteStatusEvent(h.id, sys.id), 12)}
                                      </div>
                                    </div>
                                    {h.reason && <div style={{fontSize:'10px',color:'#dc2626'}}>{h.reason}</div>}
                                    {h.notes  && <div style={{fontSize:'10px',color:'#64748b',fontStyle:'italic'}}>{h.notes}</div>}
                                    <div style={{fontSize:'10px',color:'#94a3b8',marginTop:'1px'}}>by {h.reported_by||'Staff'}</div>

                                    {/* Cost / ETA / files — only meaningful for non-in-service events with a saved id */}
                                    {h.id && h.status!=='in-service' && (()=>{
                                      const cost = eventCosts[h.id]
                                      const logs = cost?costLogs[cost.id]||[]:[]
                                      const edocs = eventDocs[h.id]||[]
                                      const costOpen = !!expandedCosts[h.id]
                                      const cd = costDrafts[h.id]||{estimated_cost:cost?.estimated_cost??'',estimated_completion:cost?.estimated_completion??'',editor:''}
                                      const evendors = eventVendors[h.id]||[]
                                      const evOpen = !!expandedEventVendors[h.id]
                                      const evd = eventVendorDrafts[h.id]||{vendor_name:'',phone:'',email:'',work_description:''}
                                      return (
                                        <>
                                        <div style={{marginTop:'6px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'8px'}}>
                                          <div onClick={()=>setExpandedCosts(prev=>({...prev,[h.id]:!costOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                                            <span style={{fontSize:'10px',fontWeight:'700',color:'#475569'}}>
                                              Cost / ETA / Files
                                              {cost?.estimated_cost!=null && <span style={{marginLeft:'6px',color:'#0f766e'}}>${cost.estimated_cost}</span>}
                                              {cost?.estimated_completion && <span style={{marginLeft:'6px',color:'#64748b'}}>ETA {cost.estimated_completion}</span>}
                                            </span>
                                            <span style={{fontSize:'10px',color:'#94a3b8'}}>{costOpen?'▲':'▼'}</span>
                                          </div>
                                          {costOpen && (
                                            <div style={{marginTop:'8px'}}>
                                              {userRole==='admin' && cost?.id && (
                                                <button onClick={()=>askDelete('Delete the cost/ETA entry for this event? This also clears its edit history. This cannot be undone.', ()=>deleteEventCost(cost, h.id))} style={{width:'100%',padding:'5px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:'pointer',marginBottom:'6px'}}>🗑️ Delete Cost / ETA Entry</button>
                                              )}
                                              {editable && (
                                                <>
                                                  <div style={{fontSize:'9px',color:'#94a3b8',marginBottom:'2px'}}>Estimated Cost ($)</div>
                                                  <input value={cd.estimated_cost} onChange={e=>setCostDrafts(prev=>({...prev,[h.id]:{...cd,estimated_cost:e.target.value}}))} placeholder='0.00' inputMode='decimal' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'5px'}}/>
                                                  <div style={{fontSize:'9px',color:'#94a3b8',marginBottom:'2px'}}>Estimated Completion Date</div>
                                                  <input type='date' value={cd.estimated_completion} onChange={e=>setCostDrafts(prev=>({...prev,[h.id]:{...cd,estimated_completion:e.target.value}}))} style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'5px'}}/>
                                                  <div style={{fontSize:'9px',color:'#94a3b8',marginBottom:'2px'}}>Saving as</div>
                                                  <div style={{padding:'5px 8px',borderRadius:'5px',background:'#f1f5f9',border:'1px solid #e2e8f0',fontSize:'11px',color:'#334155',fontWeight:'600',marginBottom:'5px'}}>{userName||'Unknown user'}</div>
                                                  <button onClick={()=>saveCost(h,sys.id)} disabled={savingCost===h.id} style={{width:'100%',padding:'6px',background:'#0f766e',color:'#fff',border:'none',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:'pointer',marginBottom:'6px'}}>
                                                    {savingCost===h.id?'Saving...':(cost?'Update Cost / ETA':'Save Cost / ETA')}
                                                  </button>

                                                  {/* Files / photos for this event */}
                                                  <label style={{display:'block',width:'100%',padding:'6px',background:'#eff6ff',color:'#2563eb',borderRadius:'6px',fontSize:'10px',fontWeight:'600',textAlign:'center',cursor:'pointer',marginBottom:'6px'}}>
                                                    {uploadingEventDoc===h.id?'Uploading...':'+ Add Photo / Invoice / Quote'}
                                                    <input type='file' style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0]; if(f) uploadEventDoc(h,sys.id,f)}}/>
                                                  </label>
                                                </>
                                              )}
                                              {edocs.map((d:any,di:number)=>(
                                                <div key={di} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 6px',background:'#f8fafc',borderRadius:'5px',marginBottom:'4px'}}>
                                                  <span style={{fontSize:'10px',color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'150px'}}>{d.file_name}</span>
                                                  <button onClick={()=>viewDocument(d.file_path)} style={{padding:'2px 8px',background:'#eff6ff',color:'#2563eb',border:'none',borderRadius:'5px',fontSize:'9px',fontWeight:'600',cursor:'pointer'}}>View</button>
                                                  {d.id && TrashBtn('Delete file "'+d.file_name+'" from this event? This cannot be undone.', ()=>deleteEventDoc(d, h.id), 11)}
                                                </div>
                                              ))}

                                              {/* Edit log */}
                                              {logs.length>0 && (
                                                <div style={{marginTop:'6px',borderTop:'1px solid #f1f5f9',paddingTop:'6px'}}>
                                                  <div style={{fontSize:'9px',fontWeight:'700',color:'#94a3b8',marginBottom:'3px'}}>Edit History</div>
                                                  {logs.map((l:any,li:number)=>(
                                                    <div key={li} style={{fontSize:'9px',color:'#64748b',marginBottom:'2px'}}>
                                                      <span style={{fontWeight:'600',color:'#334155'}}>{l.edited_by}</span> · {fmtDateTime(l.created_at)}<br/>
                                                      <span style={{color:'#92400e'}}>{l.changes}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        {/* Vendor used on THIS event (collapsible, multiple allowed) */}
                                        <div style={{marginTop:'6px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'8px'}}>
                                          <div onClick={()=>setExpandedEventVendors(prev=>({...prev,[h.id]:!evOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                                            <span style={{fontSize:'10px',fontWeight:'700',color:'#475569'}}>
                                              Vendor (this event){evendors.length>0?' ('+evendors.length+')':''}
                                            </span>
                                            <span style={{fontSize:'10px',color:'#94a3b8'}}>{evOpen?'▲':'▼'}</span>
                                          </div>
                                          {evOpen && (
                                            <div style={{marginTop:'8px'}}>
                                              {/* Existing vendors for this event */}
                                              {evendors.map((v:any,vi:number)=>(
                                                <div key={v.id||vi} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'5px',padding:'6px 8px',marginBottom:'5px'}}>
                                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                                                    <div style={{fontSize:'10px',fontWeight:'700',color:'#1e293b'}}>{v.vendor_name}</div>
                                                    {v.id && TrashBtn('Delete vendor "'+v.vendor_name+'" from this event? This cannot be undone.', ()=>deleteEventVendor(v.id, h.id), 11)}
                                                  </div>
                                                  {v.phone && <div style={{fontSize:'9px',color:'#64748b'}}>{v.phone}</div>}
                                                  {v.email && <div style={{fontSize:'9px',color:'#2563eb'}}>{v.email}</div>}
                                                  {v.work_description && <div style={{fontSize:'9px',color:'#475569',marginTop:'2px',whiteSpace:'pre-wrap'}}>{v.work_description}</div>}
                                                </div>
                                              ))}
                                              {evendors.length===0 && <div style={{fontSize:'9px',color:'#94a3b8',marginBottom:'5px'}}>No vendor recorded for this event.</div>}

                                              {/* Add-vendor form (editable only) */}
                                              {editable && (
                                                <div style={{background:'#f8fafc',borderRadius:'5px',padding:'8px'}}>
                                                  <input value={evd.vendor_name} onChange={e=>setEventVendorDrafts(prev=>({...prev,[h.id]:{...evd,vendor_name:e.target.value}}))} placeholder='Vendor name' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                                  <input value={evd.phone} onChange={e=>setEventVendorDrafts(prev=>({...prev,[h.id]:{...evd,phone:e.target.value}}))} placeholder='Phone' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                                  <input value={evd.email} onChange={e=>setEventVendorDrafts(prev=>({...prev,[h.id]:{...evd,email:e.target.value}}))} placeholder='Email' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                                  <textarea value={evd.work_description} onChange={e=>setEventVendorDrafts(prev=>({...prev,[h.id]:{...evd,work_description:e.target.value}}))} placeholder='Work performed / scope...' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',minHeight:'40px',resize:'vertical' as any,boxSizing:'border-box' as any,marginBottom:'5px'}}/>
                                                  <button onClick={()=>saveEventVendor(h,sys.id)} disabled={savingEventVendor===h.id||!evd.vendor_name.trim()} style={{width:'100%',padding:'6px',background:!evd.vendor_name.trim()?'#cbd5e1':'#0f766e',color:'#fff',border:'none',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:!evd.vendor_name.trim()?'default':'pointer'}}>
                                                    {savingEventVendor===h.id?'Adding...':'+ Add Vendor'}
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        </>
                                      )
                                    })()}
                                  </div>
                                )
                              })
                          }
                        </div>
                      )}
                    </div>

                    {/* ── System notes (append-only) ── */}
                    <div style={{marginTop:'8px',borderTop:'1px solid #e2e8f0',paddingTop:'8px'}}>
                      <div style={{fontSize:'11px',fontWeight:'700',color:'#475569',marginBottom:'6px'}}>Notes {notes.length>0?'('+notes.length+')':''}</div>
                      {editable && (
                        <>
                          <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'5px'}}>Posting as <span style={{fontWeight:'700',color:'#475569'}}>{userName||'Unknown user'}</span></div>
                          <textarea
                            value={draft.text}
                            onChange={e=>setNoteDrafts(prev=>({...prev,[sys.id]:{...draft,text:e.target.value}}))}
                            placeholder='Add a note...'
                            style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',minHeight:'48px',resize:'vertical' as any,boxSizing:'border-box' as any,marginBottom:'5px'}}
                          />
                          <button
                            onClick={()=>saveNote(sys.id)}
                            disabled={savingNote===sys.id||!draft.text.trim()}
                            style={{width:'100%',padding:'6px',background:(!draft.text.trim())?'#cbd5e1':'#0f766e',color:'#fff',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:(!draft.text.trim())?'default':'pointer'}}
                          >
                            {savingNote===sys.id?'Adding...':'Add Note'}
                          </button>
                        </>
                      )}
                      <div style={{marginTop:'8px'}}>
                        {notes.length===0
                          ? <div style={{fontSize:'11px',color:'#94a3b8'}}>No notes yet.</div>
                          : notes.map((n:any,i:number)=>{
                              const isLatest = i===0
                              return (
                                <div key={n.id||i} style={{
                                  background:isLatest?'#fffbeb':'#fff',
                                  border:'1px solid '+(isLatest?'#fde68a':'#e2e8f0'),
                                  borderRadius:'6px',padding:'8px',marginBottom:'6px'
                                }}>
                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'3px'}}>
                                    <span style={{fontSize:'10px',fontWeight:'700',color:'#334155'}}>
                                      {n.author||'Staff'}{isLatest && <span style={{marginLeft:'6px',background:'#fde68a',color:'#92400e',padding:'0 6px',borderRadius:'8px',fontSize:'9px'}}>Latest</span>}
                                    </span>
                                    <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                                      <span style={{fontSize:'9px',color:'#94a3b8'}}>{fmtDateTime(n.created_at)}</span>
                                      {n.id && TrashBtn('Delete this note? This cannot be undone.', ()=>deleteNote(n.id, sys.id), 11)}
                                    </div>
                                  </div>
                                  <div style={{fontSize:'11px',color:'#1e293b',whiteSpace:'pre-wrap'}}>{n.note}</div>
                                </div>
                              )
                            })
                        }
                      </div>
                    </div>
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
              {editable && psrMode!=='history' && <button onClick={()=>setPsrMode('history')} style={{padding:'5px 10px',background:'#f1f5f9',color:'#64748b',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>}
              {editable && psrMode==='history'  && <button onClick={()=>setPsrMode('new')}     style={{padding:'5px 10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>+ New</button>}
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
                      <div onClick={()=>{ const nx = expandedPsr===r.id?null:r.id; setExpandedPsr(nx); if(nx) loadPsrPhotos(r.id) }} style={{padding:'10px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc'}}>
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
                          {/* Section photos (view here; full add/manage in Edit) */}
                          {expandedPsr===r.id && (()=>{
                            const sectionsWithPhotos = Object.keys(PSR_PHOTO_SECTIONS).filter(lbl=>(psrPhotos[PSR_PHOTO_SECTIONS[lbl]]||[]).length>0)
                            if(sectionsWithPhotos.length===0) return <div style={{marginTop:'8px',fontSize:'10px',color:'#94a3b8'}}>No photos attached. Use “Edit This Report” to add some.</div>
                            return (
                              <div style={{marginTop:'8px'}}>
                                {sectionsWithPhotos.map(lbl=>(
                                  <div key={lbl} style={{marginBottom:'8px'}}>
                                    <div style={{fontSize:'10px',fontWeight:'700',color:'#475569',marginBottom:'4px'}}>{lbl}</div>
                                    <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                                      {(psrPhotos[PSR_PHOTO_SECTIONS[lbl]]||[]).map((p:any,i:number)=>(
                                        <img key={p.id||i} src={'#'} alt={p.file_name} title={p.file_name}
                                             style={{width:'56px',height:'56px',objectFit:'cover' as any,borderRadius:'6px',border:'1px solid #e2e8f0',cursor:'pointer'}}
                                             onClick={()=>openPsrPhoto(p.file_path)}
                                             ref={el=>{ if(el) hydratePsrThumb(el,p.file_path) }}/>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}
                          <div style={{display:'flex',gap:'6px',marginTop:'8px',alignItems:'center'}}>
                            {editable && <button onClick={()=>openEditPsr(r)} style={{flex:1,padding:'6px',background:'#f1f5f9',color:'#334155',border:'1px solid #e2e8f0',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Edit This Report</button>}
                            <button onClick={()=>openVersions(r)} style={{flex:1,padding:'6px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>See Prior Versions</button>
                            {userRole==='admin' && <button onClick={()=>askDelete('Delete the PSR report dated '+r.report_date+'? This also removes its photos and version history. This cannot be undone.', ()=>deletePsrReport(r))} title='Delete (admin)' style={{padding:'6px 10px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>🗑️</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
              }
            </div>
          )}
          {editable && psrMode==='new' && (
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
                {renderPsrPhotos('Pool / Spa','new')}
              </div>)}
              {SEC('Fitness Center',<div>
                {SI('Equipment Condition','fitness_equipment',psrForm,setPsrForm)}
                {SI('Cleanliness','fitness_cleanliness',psrForm,setPsrForm)}
                {SI('Supplies Stocked','fitness_supplies_stocked',psrForm,setPsrForm)}
                {SI('Access Control','fitness_access_control',psrForm,setPsrForm)}
                {SI('Fitness Notes','fitness_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Fitness Center','new')}
              </div>)}
              {SEC('Grills / Outdoor Cooking',<div>
                {SI('Grill Condition','grill_condition',psrForm,setPsrForm)}
                {SI('Grill Area Cleanliness','grill_area_cleanliness',psrForm,setPsrForm)}
                {CB('Propane Full','propane_full',psrForm,setPsrForm)}
                {CB('Propane Needed','propane_needed',psrForm,setPsrForm)}
                {CB('Charcoal Full','charcoal_full',psrForm,setPsrForm)}
                {CB('Charcoal Needed','charcoal_needed',psrForm,setPsrForm)}
                {SI('Grill Notes','grill_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Grills / Outdoor Cooking','new')}
              </div>)}
              {SEC('Mailbox Center',<div>
                {SI('Mailboxes Secured','mailboxes_secured',psrForm,setPsrForm)}
                {SI('Parcel Lockers Working','parcel_lockers_working',psrForm,setPsrForm)}
                {SI('Area Cleanliness','mailbox_area_cleanliness',psrForm,setPsrForm)}
                {SI('Lighting Operational','mailbox_lighting',psrForm,setPsrForm)}
                {SI('Mailbox Notes','mailbox_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Mailbox Center','new')}
              </div>)}
              {SEC('Fireplaces / Firepits',<div>
                {SI('Clubhouse Fireplace','clubhouse_fireplace_operational',psrForm,setPsrForm)}
                {SI('Outdoor Fireplace','outdoor_fireplace_operational',psrForm,setPsrForm)}
                {SI('Fireplace Notes','fireplace_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Fireplaces / Firepits','new')}
              </div>)}
              {SEC('Elevators',<div>
                {['elevator_1','elevator_2','elevator_3','elevator_4','elevator_5','elevator_6'].map((f,i)=>(
                  <div key={f}>{SI('Elevator '+(i+1)+' Status',f,psrForm,setPsrForm)}</div>
                ))}
                {SI('Elevator Notes','elevator_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Elevators','new')}
              </div>)}
              {SEC('TV / Media Equipment',<div>
                {SI('Clubhouse TVs','tv_clubhouse',psrForm,setPsrForm)}
                {SI('Pool TVs','tv_pool',psrForm,setPsrForm)}
                {SI('Fitness Center TVs','tv_fitness',psrForm,setPsrForm)}
                {SI('Lounge TVs','tv_lounge',psrForm,setPsrForm)}
                {SI('TV Notes','tv_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('TV / Media Equipment','new')}
              </div>)}
              {SEC('Gates / Access Control',<div>
                {SI('Entry Gate','gate_entry',psrForm,setPsrForm)}
                {SI('Exit Gate','gate_exit',psrForm,setPsrForm)}
                {SI('Pedestrian Gate','gate_pedestrian',psrForm,setPsrForm)}
                {SI('Access System','gate_access_system',psrForm,setPsrForm)}
                {SI('Gate Notes','gate_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Gates / Access Control','new')}
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
                {renderPsrPhotos('Common Areas','new')}
              </div>)}
              {SEC('Dog Stations',<div>
                {SI('Stations Cleaned','dog_station_cleaned',psrForm,setPsrForm)}
                {SI('Damage Present','dog_station_damaged',psrForm,setPsrForm)}
                {SI('Bags Stocked','dog_station_bags',psrForm,setPsrForm)}
                {SI('Dog Station Notes','dog_station_notes',psrForm,setPsrForm)}
                {renderPsrPhotos('Dog Stations','new')}
              </div>)}
              <button onClick={savePsr} disabled={savingPsr} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'8px'}}>
                {savingPsr?'Saving...':'Save PSR Report'}
              </button>
            </div>
          )}
          {editable && psrMode==='edit' && editingPsr && (
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
                {renderPsrPhotos('Pool / Spa','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Fitness Center',<div>
                {SI('Equipment Condition','fitness_equipment',editPsrForm,setEditPsrForm)}
                {SI('Cleanliness','fitness_cleanliness',editPsrForm,setEditPsrForm)}
                {SI('Supplies Stocked','fitness_supplies_stocked',editPsrForm,setEditPsrForm)}
                {SI('Access Control','fitness_access_control',editPsrForm,setEditPsrForm)}
                {SI('Fitness Notes','fitness_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Fitness Center','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Grills / Outdoor Cooking',<div>
                {SI('Grill Condition','grill_condition',editPsrForm,setEditPsrForm)}
                {SI('Grill Area Cleanliness','grill_area_cleanliness',editPsrForm,setEditPsrForm)}
                {CB('Propane Full','propane_full',editPsrForm,setEditPsrForm)}
                {CB('Propane Needed','propane_needed',editPsrForm,setEditPsrForm)}
                {CB('Charcoal Full','charcoal_full',editPsrForm,setEditPsrForm)}
                {CB('Charcoal Needed','charcoal_needed',editPsrForm,setEditPsrForm)}
                {SI('Grill Notes','grill_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Grills / Outdoor Cooking','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Mailbox Center',<div>
                {SI('Mailboxes Secured','mailboxes_secured',editPsrForm,setEditPsrForm)}
                {SI('Parcel Lockers Working','parcel_lockers_working',editPsrForm,setEditPsrForm)}
                {SI('Area Cleanliness','mailbox_area_cleanliness',editPsrForm,setEditPsrForm)}
                {SI('Lighting Operational','mailbox_lighting',editPsrForm,setEditPsrForm)}
                {SI('Mailbox Notes','mailbox_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Mailbox Center','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Fireplaces / Firepits',<div>
                {SI('Clubhouse Fireplace','clubhouse_fireplace_operational',editPsrForm,setEditPsrForm)}
                {SI('Outdoor Fireplace','outdoor_fireplace_operational',editPsrForm,setEditPsrForm)}
                {SI('Fireplace Notes','fireplace_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Fireplaces / Firepits','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Elevators',<div>
                {['elevator_1','elevator_2','elevator_3','elevator_4','elevator_5','elevator_6'].map((f,i)=>(
                  <div key={f}>{SI('Elevator '+(i+1)+' Status',f,editPsrForm,setEditPsrForm)}</div>
                ))}
                {SI('Elevator Notes','elevator_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Elevators','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('TV / Media Equipment',<div>
                {SI('Clubhouse TVs','tv_clubhouse',editPsrForm,setEditPsrForm)}
                {SI('Pool TVs','tv_pool',editPsrForm,setEditPsrForm)}
                {SI('Fitness Center TVs','tv_fitness',editPsrForm,setEditPsrForm)}
                {SI('Lounge TVs','tv_lounge',editPsrForm,setEditPsrForm)}
                {SI('TV Notes','tv_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('TV / Media Equipment','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Gates / Access Control',<div>
                {SI('Entry Gate','gate_entry',editPsrForm,setEditPsrForm)}
                {SI('Exit Gate','gate_exit',editPsrForm,setEditPsrForm)}
                {SI('Pedestrian Gate','gate_pedestrian',editPsrForm,setEditPsrForm)}
                {SI('Access System','gate_access_system',editPsrForm,setEditPsrForm)}
                {SI('Gate Notes','gate_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Gates / Access Control','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
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
                {renderPsrPhotos('Common Areas','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              {SEC('Dog Stations',<div>
                {SI('Stations Cleaned','dog_station_cleaned',editPsrForm,setEditPsrForm)}
                {SI('Damage Present','dog_station_damaged',editPsrForm,setEditPsrForm)}
                {SI('Bags Stocked','dog_station_bags',editPsrForm,setEditPsrForm)}
                {SI('Dog Station Notes','dog_station_notes',editPsrForm,setEditPsrForm)}
                {renderPsrPhotos('Dog Stations','saved',editingPsr?.id,editingPsr?.property_id,!!editable)}
              </div>)}
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>Edited By</div>
                <div style={{padding:'6px 8px',borderRadius:'5px',background:'#f1f5f9',border:'1px solid #e2e8f0',fontSize:'12px',color:'#334155',fontWeight:'600'}}>
                  {userName || 'Not signed in — attribution unavailable'}
                </div>
              </div>
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'2px'}}>Note about this edit (optional)</div>
                <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder='e.g. Corrected pool status after re-inspection' style={{width:'100%',padding:'6px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'12px',minHeight:'52px',resize:'vertical' as any,boxSizing:'border-box' as any}}/>
              </div>
              <div style={{padding:'8px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',fontSize:'10px',color:'#166534',marginBottom:'8px'}}>
                A snapshot of the current report will be saved to version history before your changes are applied.
              </div>
              <button onClick={saveEditPsr} disabled={savingEdit} style={{width:'100%',padding:'10px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>
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
                    {editable && <button onClick={()=>saveSysInfo(sys.id)} disabled={savingSysInfo} style={{width:'100%',padding:'7px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',marginTop:'4px'}}>
                      {savingSysInfo?'Saving...':'Save'}
                    </button>}

                    {/* ── Servicing Vendors (permanent vendors for this system) ── */}
                    <div style={{marginTop:'12px',borderTop:'1px solid #e2e8f0',paddingTop:'10px'}}>
                      <div style={{fontSize:'12px',fontWeight:'700',color:'#475569',marginBottom:'8px'}}>
                        Servicing Vendors {(systemVendors[sys.id]||[]).length>0?'('+(systemVendors[sys.id]||[]).length+')':''}
                      </div>
                      {(()=>{
                        const vendors = systemVendors[sys.id]||[]
                        const vd = vendorDrafts[sys.id]||{vendor_name:'',phone:'',email:''}
                        return (
                          <div>
                            {vendors.length===0 && <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'8px'}}>No servicing vendors on file.</div>}
                            {vendors.map((v:any,vi:number)=>(
                              <div key={v.id||vi} style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'8px',marginBottom:'6px'}}>
                                {editable && editingVendor===v.id ? (
                                  <div>
                                    <input value={vendorEditForm.vendor_name||''} onChange={e=>setVendorEditForm((p:any)=>({...p,vendor_name:e.target.value}))} placeholder='Vendor name' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                    <input value={vendorEditForm.phone||''} onChange={e=>setVendorEditForm((p:any)=>({...p,phone:e.target.value}))} placeholder='Phone' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                    <input value={vendorEditForm.email||''} onChange={e=>setVendorEditForm((p:any)=>({...p,email:e.target.value}))} placeholder='Email' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                    <div style={{display:'flex',gap:'4px'}}>
                                      <button onClick={()=>{setEditingVendor(null);setVendorEditForm({})}} style={{flex:1,padding:'5px',background:'#f1f5f9',color:'#64748b',border:'none',borderRadius:'5px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
                                      <button onClick={()=>saveVendorEdit(v.id,sys.id)} style={{flex:1,padding:'5px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'5px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>Save</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                                      <span style={{fontSize:'11px',fontWeight:'600',color:'#1e293b'}}>{v.vendor_name}</span>
                                      {editable && <button onClick={()=>{setEditingVendor(v.id);setVendorEditForm({vendor_name:v.vendor_name,phone:v.phone,email:v.email})}} style={{padding:'1px 6px',background:'#f1f5f9',color:'#475569',border:'none',borderRadius:'5px',fontSize:'9px',fontWeight:'600',cursor:'pointer'}}>Edit</button>}
                                      {v.id && TrashBtn('Delete servicing vendor "'+v.vendor_name+'"? This cannot be undone.', ()=>deleteServicingVendor(v.id, sys.id), 11)}
                                    </div>
                                    {v.phone && <div style={{fontSize:'10px',color:'#64748b'}}>{v.phone}</div>}
                                    {v.email && <div style={{fontSize:'10px',color:'#2563eb'}}>{v.email}</div>}
                                  </div>
                                )}
                              </div>
                            ))}
                            {editable && (
                              <div style={{background:'#f8fafc',borderRadius:'6px',padding:'8px'}}>
                                <input value={vd.vendor_name} onChange={e=>setVendorDrafts(prev=>({...prev,[sys.id]:{...vd,vendor_name:e.target.value}}))} placeholder='Vendor name' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                <input value={vd.phone} onChange={e=>setVendorDrafts(prev=>({...prev,[sys.id]:{...vd,phone:e.target.value}}))} placeholder='Phone' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'4px'}}/>
                                <input value={vd.email} onChange={e=>setVendorDrafts(prev=>({...prev,[sys.id]:{...vd,email:e.target.value}}))} placeholder='Email' style={{width:'100%',padding:'5px 8px',borderRadius:'5px',border:'1px solid #e2e8f0',fontSize:'11px',boxSizing:'border-box' as any,marginBottom:'5px'}}/>
                                <button onClick={()=>saveVendor(sys.id)} disabled={savingVendor===sys.id||!vd.vendor_name.trim()} style={{width:'100%',padding:'6px',background:!vd.vendor_name.trim()?'#cbd5e1':'#0f766e',color:'#fff',border:'none',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:!vd.vendor_name.trim()?'default':'pointer'}}>
                                  {savingVendor===sys.id?'Adding...':'+ Add Servicing Vendor'}
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
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
          {propSystems.map((sys:any)=> renderDocBucket(sys.id, sys.name, sys.system_type ? sys.system_type.charAt(0).toUpperCase()+sys.system_type.slice(1) : '', editable))}

          {/* Property-wide bucket */}
          {renderDocBucket('property','Property-Wide Documents','Not tied to a specific system', editable)}
        </div>
      )}

      {/* Site Visits tab */}
      {detailTab==='visits' && (()=>{
        const visits = detailProp ? (siteVisits[detailProp.id]||[]) : []
        const days = detailProp ? daysSinceVisit(detailProp.id) : null
        const overdue = days!==null && days>30
        return (
          <div>
            {/* Days since last visit banner */}
            <div style={{marginBottom:'14px',padding:'12px',borderRadius:'10px',textAlign:'center',
              background: days===null?'#f1f5f9':(overdue?'#fef2f2':'#f0fdf4'),
              border:'1px solid '+(days===null?'#e2e8f0':(overdue?'#fecaca':'#bbf7d0'))}}>
              <div style={{fontSize:'24px',fontWeight:'700',color:days===null?'#64748b':(overdue?'#dc2626':'#16a34a')}}>
                {days===null?'—':days}
              </div>
              <div style={{fontSize:'11px',color:'#64748b',marginTop:'2px'}}>
                {days===null?'No visits logged yet':'day'+(days===1?'':'s')+' since last visit'}
                {overdue && <span style={{color:'#dc2626',fontWeight:'600'}}> · overdue (30+ days)</span>}
              </div>
            </div>

            {/* Add a visit — RM / RSM / admin only */}
            {canEditVisits ? (
              <div style={{background:'#f8fafc',borderRadius:'8px',padding:'12px',marginBottom:'14px'}}>
                <div style={{fontSize:'11px',fontWeight:'700',color:'#475569',marginBottom:'8px'}}>Log a Site Visit</div>
                <div style={{fontSize:'10px',color:'#94a3b8',marginBottom:'6px'}}>
                  Visiting as <span style={{fontWeight:'700',color:'#475569'}}>{userName||'Unknown user'}</span> · {new Date().toLocaleDateString()}
                </div>
                <textarea value={visitNote} onChange={e=>setVisitNote(e.target.value)} placeholder='Visit notes (optional)...' style={{width:'100%',padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px',minHeight:'56px',resize:'vertical' as any,boxSizing:'border-box' as any,marginBottom:'6px'}}/>
                {/* Attach files/reports as part of the visit entry */}
                <label style={{display:'block',padding:'7px',background:'#eff6ff',color:'#2563eb',borderRadius:'6px',fontSize:'11px',fontWeight:'600',textAlign:'center',cursor:'pointer',marginBottom:'6px'}}>
                  + Attach Report / Document / Photo
                  <input type='file' multiple style={{display:'none'}} onChange={e=>{
                    const files = Array.from(e.target.files||[])
                    if(files.length) setPendingVisitFiles(prev=>[...prev,...files])
                    e.target.value=''
                  }}/>
                </label>
                {pendingVisitFiles.length>0 && (
                  <div style={{marginBottom:'6px'}}>
                    {pendingVisitFiles.map((f,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 8px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:'5px',marginBottom:'3px'}}>
                        <span style={{fontSize:'10px',color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'200px'}}>{f.name}</span>
                        <button onClick={()=>setPendingVisitFiles(prev=>prev.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:'12px',lineHeight:1}}>×</button>
                      </div>
                    ))}
                    <div style={{fontSize:'9px',color:'#94a3b8'}}>{pendingVisitFiles.length} file{pendingVisitFiles.length===1?'':'s'} will upload when you log the visit.</div>
                  </div>
                )}
                <button onClick={saveSiteVisit} disabled={savingVisit} style={{width:'100%',padding:'8px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                  {savingVisit?'Saving...':'Log Visit'}
                </button>
              </div>
            ) : (
              <div style={{marginBottom:'14px',padding:'8px 10px',background:'#fef9c3',border:'1px solid #fde68a',borderRadius:'7px',fontSize:'11px',color:'#92400e',fontWeight:'600'}}>
                View only — site visits can be logged by Regional Managers and Regional Service Managers.
              </div>
            )}

            {/* Visit history */}
            <div style={{fontSize:'11px',fontWeight:'700',color:'#475569',marginBottom:'8px'}}>Visit History {visits.length>0?'('+visits.length+')':''}</div>
            {visits.length===0
              ? <div style={{fontSize:'12px',color:'#94a3b8',textAlign:'center',padding:'16px'}}>No site visits logged yet.</div>
              : visits.map((v:any)=>{
                  const vdocs = siteVisitDocs[v.id]||[]
                  const open = expandedVisit===v.id
                  return (
                    <div key={v.id} style={{border:'1px solid #e2e8f0',borderRadius:'8px',marginBottom:'8px',overflow:'hidden',background:'#fff'}}>
                      <div onClick={()=>setExpandedVisit(open?null:v.id)} style={{padding:'10px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc'}}>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'12px',color:'#1e293b'}}>{v.visit_date}</div>
                          <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>by {v.visitor||'—'}</div>
                        </div>
                        <span style={{fontSize:'12px',color:'#94a3b8'}}>{open?'▲':'▼'}</span>
                      </div>
                      {open && (
                        <div style={{padding:'10px 12px',borderTop:'1px solid #e2e8f0'}}>
                          {v.notes && <div style={{fontSize:'12px',color:'#1e293b',whiteSpace:'pre-wrap',marginBottom:'8px'}}>{v.notes}</div>}
                          {!v.notes && <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'8px',fontStyle:'italic'}}>No notes.</div>}

                          {/* Visit documents */}
                          {vdocs.map((d:any,di:number)=>(
                            <div key={d.id||di} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',background:'#f8fafc',borderRadius:'5px',marginBottom:'4px'}}>
                              <span style={{fontSize:'11px',color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'180px'}}>{d.file_name}</span>
                              <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                                <button onClick={()=>viewDocument(d.file_path)} style={{padding:'3px 8px',background:'#eff6ff',color:'#2563eb',border:'none',borderRadius:'5px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>View</button>
                              </div>
                            </div>
                          ))}

                          {/* Upload + delete (editors only) */}
                          {canEditVisits && (
                            <div style={{display:'flex',gap:'6px',marginTop:'6px',alignItems:'center'}}>
                              <label style={{flex:1,display:'block',padding:'6px',background:'#eff6ff',color:'#2563eb',borderRadius:'6px',fontSize:'10px',fontWeight:'600',textAlign:'center',cursor:'pointer'}}>
                                {uploadingVisitDoc===v.id?'Uploading...':'+ Add Document / Photo'}
                                <input type='file' style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0]; if(f) uploadVisitDoc(v,f); e.target.value=''}}/>
                              </label>
                              {userRole==='admin' && <button onClick={()=>askDelete('Delete the site visit from '+v.visit_date+' by '+(v.visitor||'—')+'? This also removes its documents. This cannot be undone.', ()=>deleteSiteVisit(v))} title='Delete (admin)' style={{padding:'6px 10px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>🗑️</button>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
            }
          </div>
        )
      })()}
    </>
  )
  }

  // ─── Alerts screen (mobile only) ─────────────────────────────────────────────
  const renderAlerts = () => (
    <div style={{flex:1,overflowY:'auto',padding:'12px',paddingBottom:'80px'}}>
      <div style={{fontWeight:'700',fontSize:'15px',color:'#1e293b',marginBottom:'4px'}}>Alerts</div>
      <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'14px'}}>{userRole==='admin'?'Last 50 events across all properties':'Recent events for your properties'}</div>
      {visibleAlerts.length===0
        ? <div style={{textAlign:'center',color:'#94a3b8',fontSize:'13px',padding:'40px 0'}}>No alerts yet.</div>
        : visibleAlerts.map((a:any, i:number)=>{
            const isOut   = a.type==='out-of-service'
            const isMaint = a.type==='maintenance'
            const isPsr   = a.type==='psr-submitted'
            const isNote  = a.type==='note-added'
            const isEdit  = a.type==='psr-edited'
            const color  = isOut?'#dc2626':isMaint?'#d97706':isNote?'#0f766e':isEdit?'#7c3aed':'#0369a1'
            const bg     = isOut?'#fef2f2':isMaint?'#fffbeb':isNote?'#f0fdfa':isEdit?'#f5f3ff':'#eff6ff'
            const label  = isOut?'Out of Service':isMaint?'Maintenance':isNote?'Note Added':isEdit?'PSR Edited':'PSR Submitted'
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

  // ─── Systems Out portfolio-wide view ─────────────────────────────────────────
  const renderSystemsOut = () => {
    // Build outage rows for systems currently out-of-service or maintenance,
    // respecting role visibility (admin sees all; others only assigned properties).
    const rows = systems
      .map((s:any)=>{
        const st = statuses[s.id]
        const status = st?.status || 'in-service'
        if(status!=='out-of-service' && status!=='maintenance') return null
        const prop = properties.find((p:any)=>p.id===s.property_id)
        if(!prop) return null
        if(isTeamMember && !myProps.includes(prop.id)) return null
        return {sys:s, prop, st, status, since:st?.created_at||null}
      })
      .filter(Boolean) as any[]

    // Non-admins (other than team members who are already filtered) see only assigned props' outages
    const visibleRows = userRole==='admin' ? rows : rows.filter((r:any)=> myProps.includes(r.prop.id))

    const sortRows = (arr:any[]) => {
      const a = [...arr]
      if(systemsOutSort==='recent') a.sort((x,y)=> new Date(y.since||0).getTime()-new Date(x.since||0).getTime())
      else if(systemsOutSort==='state') a.sort((x,y)=> (x.prop.state||'').localeCompare(y.prop.state||'') || (x.prop.name||'').localeCompare(y.prop.name||''))
      else if(systemsOutSort==='rm') a.sort((x,y)=> (x.prop.rm||'').localeCompare(y.prop.rm||'') || (x.prop.name||'').localeCompare(y.prop.name||''))
      else if(systemsOutSort==='property') a.sort((x,y)=> (x.prop.name||'').localeCompare(y.prop.name||''))
      return a
    }

    const outRows   = sortRows(visibleRows.filter((r:any)=>r.status==='out-of-service'))
    const maintRows = sortRows(visibleRows.filter((r:any)=>r.status==='maintenance'))

    const daysSince = (ts:string|null) => {
      if(!ts) return ''
      const d = Math.floor((Date.now()-new Date(ts).getTime())/86400000)
      return d<=0 ? 'today' : d===1 ? '1 day' : d+' days'
    }

    const renderGroup = (title:string, list:any[], statusKey:string) => {
      const meta = STATUS_META[statusKey]
      return (
        <div style={{marginBottom:'24px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
            <span style={{background:meta.bg,color:meta.color,border:'1px solid '+meta.border,padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'700'}}>{meta.label}</span>
            <span style={{color:'#94a3b8',fontSize:'12px'}}>{list.length} {list.length===1?'system':'systems'}</span>
          </div>
          {list.length===0
            ? <div style={{fontSize:'12px',color:'#94a3b8',padding:'8px 0'}}>None.</div>
            : list.map((r:any)=>{
                const rowKey = r.sys.id
                const open = expandedOutRow===rowKey
                const cost = eventCosts[r.st?.id]
                const edocs = eventDocs[r.st?.id]||[]
                const evendors = eventVendors[r.st?.id]||[]
                return (
                  <div key={rowKey} style={{border:'1px solid #e2e8f0',borderRadius:'8px',marginBottom:'8px',overflow:'hidden',background:'#fff'}}>
                    <div onClick={()=>setExpandedOutRow(open?null:rowKey)} style={{padding:'10px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontWeight:'600',fontSize:'13px',color:'#1e293b'}}>{r.sys.name} <span style={{color:'#94a3b8',fontWeight:'400'}}>· {r.prop.name}</span></div>
                        <div style={{fontSize:'11px',color:'#64748b',marginTop:'2px'}}>
                          {abbr(r.prop.state)}{r.prop.rm?' · '+r.prop.rm:''}{r.st?.reason?' · '+r.st.reason:''} · down {daysSince(r.since)}
                        </div>
                      </div>
                      <span style={{fontSize:'12px',color:'#94a3b8',marginLeft:'8px'}}>{open?'▲':'▼'}</span>
                    </div>
                    {open && (
                      <div style={{padding:'10px 12px',borderTop:'1px solid #e2e8f0',background:'#fafafa'}}>
                        {/* Summary detail */}
                        {r.st?.reason && <div style={{fontSize:'11px',color:'#dc2626',marginBottom:'3px'}}>Reason: {r.st.reason}</div>}
                        {r.st?.notes && <div style={{fontSize:'11px',color:'#64748b',fontStyle:'italic',marginBottom:'3px'}}>{r.st.notes}</div>}
                        <div style={{fontSize:'11px',color:'#475569',marginBottom:'3px'}}>Reported by {r.st?.reported_by||'—'} · {fmtDateTime(r.since)}</div>
                        {cost?.estimated_cost!=null && <div style={{fontSize:'11px',color:'#0f766e',marginBottom:'3px'}}>Est. cost: ${cost.estimated_cost}{cost.estimated_completion?' · ETA '+cost.estimated_completion:''}</div>}
                        {evendors.length>0 && <div style={{fontSize:'11px',color:'#475569',marginBottom:'3px'}}>Vendor: {evendors.map((v:any)=>v.vendor_name).join(', ')}</div>}
                        {edocs.length>0 && (
                          <div style={{display:'flex',flexWrap:'wrap',gap:'6px',margin:'6px 0'}}>
                            {edocs.map((d:any,di:number)=>(
                              <button key={di} onClick={()=>viewDocument(d.file_path)} style={{padding:'3px 8px',background:'#eff6ff',color:'#2563eb',border:'none',borderRadius:'5px',fontSize:'10px',fontWeight:'600',cursor:'pointer'}}>{d.file_name.length>18?d.file_name.slice(0,15)+'...':d.file_name}</button>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={()=>{ setSystemsOutOpen(false); setSelectedProp(r.prop.id); setDetailTab('systems'); setMobileTab('portfolio') }}
                          style={{marginTop:'6px',padding:'7px 12px',background:'#3b82f6',color:'#fff',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}
                        >
                          Open in {r.prop.name} →
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
          }
        </div>
      )
    }

    return (
      <div style={{position:'fixed',inset:0,background:'#f1f5f9',zIndex:150,display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div style={{background:'#0f172a',padding:isMobile?'12px 16px':'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <button onClick={()=>setSystemsOutOpen(false)} style={{display:'flex',alignItems:'center',gap:'4px',background:'rgba(255,255,255,0.1)',border:'none',borderRadius:'20px',padding:'6px 14px',color:'#cbd5e1',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>← Back</button>
            <div>
              <div style={{color:'#f8fafc',fontSize:isMobile?'14px':'15px',fontWeight:'700'}}>Systems Out</div>
              <div style={{color:'#64748b',fontSize:'11px'}}>{userRole==='admin'?'All properties':'Your assigned properties'}</div>
            </div>
          </div>
        </div>
        {/* Sort control */}
        <div style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0',padding:isMobile?'8px 12px':'8px 24px',display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'11px',fontWeight:'600',color:'#64748b'}}>Sort by</span>
          <select value={systemsOutSort} onChange={e=>setSystemsOutSort(e.target.value as any)} style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px',fontWeight:'600',color:'#334155',background:'#fff',cursor:'pointer'}}>
            <option value='recent'>Most Recent</option>
            <option value='state'>State</option>
            <option value='rm'>RM Region</option>
            <option value='property'>Property</option>
          </select>
        </div>
        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:isMobile?'12px':'20px 24px'}}>
          {outRows.length===0 && maintRows.length===0
            ? <div style={{textAlign:'center',color:'#94a3b8',fontSize:'14px',padding:'60px 0'}}>🎉 No systems are currently out of service or under maintenance.</div>
            : <>
                {renderGroup('Out of Service', outRows, 'out-of-service')}
                {renderGroup('Maintenance', maintRows, 'maintenance')}
              </>
          }
        </div>
      </div>
    )
  }

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
        {/* Right side: user name/role + Sign Out */}
        <div style={{display:'flex',alignItems:'center',gap:isMobile?'10px':'14px'}}>
          {userRole && (
            <div style={{textAlign:'right'}}>
              {userName && <div style={{color:'#f8fafc',fontSize:'12px',fontWeight:'600'}}>{userName}</div>}
              <div style={{color:'#64748b',fontSize:'10px'}}>{ROLE_LABELS[userRole]||userRole}</div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            style={{background:'rgba(255,255,255,0.1)',color:'#f8fafc',border:'1px solid rgba(255,255,255,0.2)',borderRadius:'7px',padding:isMobile?'6px 10px':'7px 14px',fontSize:'12px',fontWeight:'600',cursor:signingOut?'default':'pointer',whiteSpace:'nowrap' as any}}
          >
            {signingOut?'Signing out...':'Sign Out'}
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div style={{background:'#fff',borderBottom:'1px solid #e2e8f0',padding:isMobile?'10px 12px':'12px 24px',display:'flex',gap:isMobile?'16px':'24px',overflowX:'auto',flexWrap:isMobile?'nowrap':'wrap',WebkitOverflowScrolling:'touch' as any}}>
        {[
          {v:visibleProperties.length,                                                    l:'Communities', c:'#1e293b'},
          {v:visibleProperties.filter((p:any)=>p.has_pool).length,                        l:'Pools',        c:'#0369a1'},
          {v:visibleProperties.filter((p:any)=>p.has_gate).length,                        l:'Gates',        c:'#7c3aed'},
          {v:visibleProperties.filter((p:any)=>p.has_elevator).length,                    l:'Elevators',    c:'#b45309'},
          {v:visibleProperties.filter((p:any)=>p.has_compactor).length,                   l:'Compactors',   c:'#0f766e'},
          {v:systems.filter((s:any)=>{ const sp=properties.find((p:any)=>p.id===s.property_id); const vis=!isTeamMember||(sp&&myProps.includes(sp.id)); return vis&&getStatus(s.id)==='out-of-service' }).length, l:'Systems Out',  c:'#dc2626', click:true},
        ].map(s=>(
          <div key={s.l} onClick={()=>{ if((s as any).click) setSystemsOutOpen(true) }} style={{flexShrink:0,cursor:(s as any).click?'pointer':'default'}} title={(s as any).click?'View all systems out of service or under maintenance':undefined}>
            <div style={{fontSize:isMobile?'20px':'22px',fontWeight:'700',color:s.c}}>{s.v}</div>
            <div style={{fontSize:'11px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'3px'}}>{s.l}{(s as any).click && <span style={{fontSize:'9px',color:'#dc2626'}}>↗</span>}</div>
          </div>
        ))}
      </div>

      {/* ── Filter bar (portfolio tab only on mobile) ── */}
      {(!isMobile || mobileTab==='portfolio') && (
        <div style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0',padding:isMobile?'8px 12px':'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          {/* System type tabs (All / Elevators / ...) */}
          <div style={{display:'flex',background:'#fff',borderRadius:'7px',border:'1px solid #e2e8f0',overflow:'hidden',overflowX:'auto'}}>
            {TABS.map(([v,l])=>(
              <button key={v} onClick={()=>setTab(v)} style={{padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:'none',background:tab===v?'#3b82f6':'transparent',color:tab===v?'#fff':'#94a3b8',whiteSpace:'nowrap' as any}}>
                {l}
              </button>
            ))}
          </div>

          {/* Filter Type dropdown + dependent value dropdown */}
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'11px',fontWeight:'600',color:'#64748b'}}>Filter by</span>
              <select
                value={filterType}
                onChange={e=>{
                  const v = e.target.value as 'state'|'rm'
                  setFilterType(v)
                  // Reset the value selection so a stale filter from the other type isn't applied
                  setStateFilter('all')
                  setRmFilter('all')
                }}
                style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px',fontWeight:'600',color:'#334155',background:'#fff',cursor:'pointer'}}
              >
                <option value='state'>State</option>
                <option value='rm'>RM Region</option>
              </select>
            </div>

            {/* The actual filter values — content depends on the chosen Filter Type */}
            {filterType==='state' ? (
              <select
                value={stateFilter}
                onChange={e=>setStateFilter(e.target.value)}
                style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px',fontWeight:'600',color:'#334155',background:'#fff',cursor:'pointer',minWidth:'140px'}}
              >
                <option value='all'>All States</option>
                {states.map(s=><option key={s} value={s}>{abbr(s)} — {s}</option>)}
              </select>
            ) : (
              <select
                value={rmFilter}
                onChange={e=>setRmFilter(e.target.value)}
                style={{padding:'6px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',fontSize:'12px',fontWeight:'600',color:'#334155',background:'#fff',cursor:'pointer',minWidth:'160px'}}
              >
                <option value='all'>All RM Regions</option>
                {rms.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            )}
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
                  <span style={{background:'#1e293b',color:'#fff',borderRadius:'4px',padding:'2px 8px',fontSize:'11px'}}>{abbr(group.state)}</span>
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
                          <div style={{fontSize:'11px',color:'#64748b'}}>{prop.city}, {abbr(prop.state)}{prop.rm?' · '+prop.rm:''}</div>
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
              <div style={{fontSize:'12px',color:'#64748b'}}>{detailProp.city}, {abbr(detailProp.state)}{detailProp.rm?' · '+detailProp.rm:''}</div>
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
              <div style={{color:'#64748b',fontSize:'10px'}}>{detailProp.city}, {abbr(detailProp.state)}{detailProp.rm?' · '+detailProp.rm:''}</div>
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
              <div style={{padding:'8px 10px',borderRadius:'7px',background:'#f1f5f9',border:'1px solid #e2e8f0',fontSize:'13px',color:'#334155',fontWeight:'600'}}>{userName || 'Not signed in — attribution unavailable'}</div>
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
      {/* ── Admin delete confirmation ── */}
      {pendingDelete && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:'16px'}}>
          <div style={{background:'#fff',borderRadius:'12px',padding:'20px',width:'100%',maxWidth:'380px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
              <span style={{fontSize:'20px'}}>⚠️</span>
              <div style={{fontWeight:'700',fontSize:'14px',color:'#1e293b'}}>Confirm Delete</div>
            </div>
            <div style={{fontSize:'13px',color:'#475569',marginBottom:'18px',lineHeight:1.5}}>{pendingDelete.label}</div>
            <div style={{display:'flex',gap:'10px'}}>
              <button onClick={()=>setPendingDelete(null)} disabled={deleting} style={{flex:1,padding:'10px',background:'#f1f5f9',color:'#334155',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
              <button onClick={runPendingDelete} disabled={deleting} style={{flex:1,padding:'10px',background:'#dc2626',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{deleting?'Deleting...':'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Systems Out full view ── */}
      {systemsOutOpen && renderSystemsOut()}

      {/* ── Photo viewer (full size) ── */}
      {photoViewer && (
        <div onClick={()=>setPhotoViewer(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:500,padding:'20px'}}>
          <img src={photoViewer} alt='' style={{maxWidth:'100%',maxHeight:'100%',borderRadius:'8px',objectFit:'contain' as any}}/>
          <button onClick={()=>setPhotoViewer(null)} style={{position:'fixed',top:'16px',right:'16px',background:'rgba(255,255,255,0.15)',color:'#fff',border:'none',borderRadius:'50%',width:'36px',height:'36px',fontSize:'20px',cursor:'pointer'}}>×</button>
        </div>
      )}

      {toast && (
        <div style={{position:'fixed',bottom:isMobile?'80px':'20px',right:'20px',background:'#166534',color:'#fff',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'500',zIndex:400}}>
          {toast}
        </div>
      )}
    </div>
  )
}
