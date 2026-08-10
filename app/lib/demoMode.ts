'use client'

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (admin only)
//
// Purpose: let an admin walk someone through the dashboard — logging site
// visits, submitting PSRs, marking systems out of service, adding notes and
// uploading files — without any of it reaching Supabase.
//
// How it works: the dashboard opens ONE Supabase connection at the top of
// app/page.tsx. withDemoMode() wraps that connection. Reads (.select) always
// pass straight through to the real database, so the app still shows the real
// portfolio. Writes (.insert / .update / .delete / .upsert / storage uploads)
// are intercepted while demo mode is on and answered with a fabricated
// "success" that never leaves the browser.
//
// Because the fake row is handed back in the same shape the real database
// returns, the app puts it straight into on-screen state and displays it like
// any other record. Refreshing the page reloads real data, so everything
// simulated disappears on its own. There is nothing to clean up afterwards.
//
// Safety notes:
//   • Demo mode is OFF on every page load. It cannot persist between sessions.
//   • Simulated rows get NEGATIVE ids. Real rows always have positive ids, so a
//     demo record can never collide with — or be mistaken for — a real one.
//   • /api/notify, /api/send-email and /api/subscribe are blocked too, so no
//     push notifications, alert_log entries, or emails can fire during a demo.
//   • createSignedUrl is deliberately NOT blocked, so real documents already in
//     storage can still be opened and shown during a walkthrough. A file
//     uploaded during the demo will appear in the list but cannot be opened,
//     because it was never actually stored.
// ─────────────────────────────────────────────────────────────────────────────

// Whether demo mode is currently active. Read at the moment of every call, so
// flipping the switch takes effect immediately without rebuilding anything.
let demoOn = false

// Running tally of what the demo blocked, shown to the admin on exit as
// reassurance that nothing was written.
export const demoStats = {
  writes: 0,   // database inserts / updates / deletes
  uploads: 0,  // file uploads
  requests: 0, // notification + email API calls
}

function resetStats() {
  demoStats.writes = 0
  demoStats.uploads = 0
  demoStats.requests = 0
}

// Fake ids count DOWN from -1 so they can never overlap a real serial id.
let nextId = 0
function fakeId() {
  nextId -= 1
  return nextId
}

export function isDemoOn() {
  return demoOn
}

// ─── Fake query result ───────────────────────────────────────────────────────
// Stands in for a Supabase query builder. Any method called on it (.select(),
// .eq(), .order(), .limit() …) returns another one of these, and awaiting it
// resolves to a normal-looking { data, error } result. This is what lets an
// intercepted write behave exactly like a successful real one.
function fakeQuery(rows: any[] | null, single = false): any {
  const settle = () => ({
    data: single ? (rows && rows.length ? rows[0] : null) : rows,
    error: null,
    count: null,
    status: 200,
    statusText: 'OK',
  })

  const base: any = {
    then: (onDone: any, onFail: any) => Promise.resolve(settle()).then(onDone, onFail),
  }

  return new Proxy(base, {
    get(target, prop) {
      // Anything non-textual (internal JavaScript symbols) is left alone.
      if (typeof prop !== 'string') return undefined
      if (prop === 'then') return target.then
      // .single() / .maybeSingle() return one object instead of a list.
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => fakeQuery(rows, true)
      }
      // Every other builder method is a no-op that keeps the chain going.
      return () => fakeQuery(rows, single)
    },
  })
}

// Turn whatever was being saved into a plausible saved row: give it a fake id
// and a timestamp, then layer the real submitted values on top.
function fakeRows(payload: any) {
  const list = Array.isArray(payload) ? payload : [payload]
  const now = new Date().toISOString()
  return list.map((row) => ({
    id: fakeId(),
    created_at: now,
    ...(row || {}),
  }))
}

// ─── Database write interception ─────────────────────────────────────────────
const WRITE_METHODS = ['insert', 'update', 'delete', 'upsert']

function wrapTable(builder: any, table: string): any {
  return new Proxy(builder, {
    get(target, prop) {
      const value = (target as any)[prop]
      if (demoOn && typeof prop === 'string' && WRITE_METHODS.includes(prop)) {
        return (payload?: any) => {
          demoStats.writes += 1
          console.log('[demo mode] blocked ' + prop + ' on "' + table + '" — nothing was saved', payload)
          // A delete has nothing to hand back; everything else echoes the row.
          return fakeQuery(prop === 'delete' ? [] : fakeRows(payload))
        }
      }
      if (typeof value === 'function') return value.bind(target)
      return value
    },
  })
}

// ─── Storage write interception ──────────────────────────────────────────────
const STORAGE_WRITE_METHODS = ['upload', 'uploadToSignedUrl', 'remove', 'move', 'copy']

function wrapBucket(bucket: any, name: string): any {
  return new Proxy(bucket, {
    get(target, prop) {
      const value = (target as any)[prop]
      if (demoOn && typeof prop === 'string' && STORAGE_WRITE_METHODS.includes(prop)) {
        return async (path: any) => {
          demoStats.uploads += 1
          const shown = Array.isArray(path) ? path[0] : path
          console.log('[demo mode] blocked storage.' + prop + ' on "' + name + '" — nothing was uploaded', shown)
          return { data: { path: shown, Key: name + '/' + shown, id: String(fakeId()) }, error: null }
        }
      }
      if (typeof value === 'function') return value.bind(target)
      return value
    },
  })
}

function wrapStorage(storage: any): any {
  return new Proxy(storage, {
    get(target, prop) {
      const value = (target as any)[prop]
      if (prop === 'from') {
        return (bucket: string) => wrapBucket((target as any).from(bucket), bucket)
      }
      if (typeof value === 'function') return value.bind(target)
      return value
    },
  })
}

// ─── The public wrapper ──────────────────────────────────────────────────────
// Wrap the real Supabase client once, at the top of app/page.tsx. When demo
// mode is off this is a pass-through and the app behaves exactly as it does
// today.
export function withDemoMode(real: any): any {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => wrapTable((target as any).from(table), table)
      }
      if (prop === 'storage') {
        return wrapStorage((target as any).storage)
      }
      const value = (target as any)[prop]
      if (typeof value === 'function') return value.bind(target)
      return value
    },
  })
}

// ─── Notification / email interception ───────────────────────────────────────
// Push notifications and the admin master email go out through the app's own
// /api routes rather than through Supabase, so they are blocked separately.
const BLOCKED_ROUTES = ['/api/notify', '/api/send-email', '/api/subscribe', '/api/cron']

let realFetch: typeof window.fetch | null = null

function urlOf(input: any): string {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString()
  if (input && typeof input.url === 'string') return input.url
  return ''
}

function blockRoutes() {
  if (typeof window === 'undefined' || realFetch) return
  realFetch = window.fetch.bind(window)
  window.fetch = async (input: any, init?: any) => {
    const url = urlOf(input)
    if (demoOn && BLOCKED_ROUTES.some((route) => url.includes(route))) {
      demoStats.requests += 1
      console.log('[demo mode] blocked request to ' + url + ' — nothing was sent')
      return new Response(
        JSON.stringify({ ok: true, demo: true, sent: 0, message: 'Demo mode — nothing was sent.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return realFetch!(input, init)
  }
}

function unblockRoutes() {
  if (typeof window === 'undefined' || !realFetch) return
  window.fetch = realFetch
  realFetch = null
}

// ─── Switching demo mode on and off ──────────────────────────────────────────
// enableDemoMode() returns true only once the block is genuinely in place. The
// on-screen banner is driven by that return value, so if the banner is
// showing, the protection is definitely active.
export function enableDemoMode(): boolean {
  if (typeof window === 'undefined') return false
  resetStats()
  demoOn = true
  blockRoutes()
  console.log('[demo mode] ON — database writes, uploads, notifications and emails are blocked')
  return demoOn
}

export function disableDemoMode() {
  demoOn = false
  unblockRoutes()
  console.log('[demo mode] OFF')
}
