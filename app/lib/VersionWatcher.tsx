'use client'
import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// TELLS PEOPLE WHEN THE APP IS OUT OF DATE
//
// THE PROBLEM
// The dashboard is installed on people's home screens. Tapping the icon usually
// resumes the app where it was rather than loading it fresh, so a phone can keep
// running a copy from weeks ago. When a fix is deployed the server updates
// instantly but phones do not.
//
// The case that matters most: database changes always go out before the code
// that uses them. That leaves a window where the new database is live and an old
// phone is still writing to it, which fails quietly rather than loudly.
//
// WHAT THIS DOES — AND DELIBERATELY DOES NOT DO
// Every build is stamped with an id (see next.config.ts). This asks the server
// what is live and compares. If this device is behind, it shows a bar offering
// to refresh.
//
// It NEVER refreshes on its own. That is on purpose. An automatic refresh could
// interrupt a half-written PSR, cut off an admin mid-demo, or — if a stale page
// were ever served — loop forever. The worst thing that can happen here is that
// somebody ignores the bar, which leaves them no worse off than before.
//
// HOW OFTEN IT CHECKS
// On open, on returning to the foreground, and every 15 minutes while in use —
// but never more than once every 5 minutes however many times those fire. Phones
// raise the foreground event constantly (app switching, screen lock, pulling
// down notifications), and without the throttle 75 users would generate tens of
// thousands of pointless requests a day.
//
// The check costs nothing at the database: /api/version reads one setting and
// returns it. It never touches Supabase.
// ─────────────────────────────────────────────────────────────────────────────

const MY_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || 'development'
const CHECK_EVERY_MS = 15 * 60 * 1000   // routine poll while the app is open
const MIN_GAP_MS = 5 * 60 * 1000        // never check more often than this

// Local development has no deployment to compare against — stay out of the way.
const DISABLED = MY_VERSION === 'development' || MY_VERSION.startsWith('local')

export default function VersionWatcher() {
  // The live version, once we know this device is behind. null = we are current.
  const [liveVersion, setLiveVersion] = useState<string | null>(null)
  // Which version the person has waved away, so we stop nagging about that one.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const lastCheck = useRef<number>(0)

  useEffect(() => {
    if (DISABLED) return
    let cancelled = false

    const check = async (force = false) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

      const now = Date.now()
      if (!force && now - lastCheck.current < MIN_GAP_MS) return
      lastCheck.current = now

      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = await res.json()
        const live = data && typeof data.version === 'string' ? data.version : null
        if (!live || live === 'unknown' || live === MY_VERSION) return
        setLiveVersion(live)
      } catch {
        // Offline or a blip. Nothing to do — the next pass will try again.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    const onOnline = () => check()

    check(true) // first look on open, ignoring the throttle
    const timer = setInterval(() => check(), CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  // Nothing to say, or they already dismissed this particular update.
  if (!liveVersion || liveVersion === dismissedVersion) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#1e293b',
        color: '#fff',
        // Keeps the bar clear of the notch / status bar on an installed iPhone app.
        padding: 'calc(10px + env(safe-area-inset-top)) 14px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        flexWrap: 'wrap',
      }}
    >
      <span>A newer version of the dashboard is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '6px 14px',
          background: '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Update now
      </button>
      <button
        onClick={() => setDismissedVersion(liveVersion)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          fontSize: '16px',
          cursor: 'pointer',
          lineHeight: 1,
          padding: '0 4px',
        }}
      >
        ✕
      </button>
    </div>
  )
}
