import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// WHICH VERSION IS CURRENTLY LIVE?
//
// Answers with the build stamp of whatever is deployed right now. The app
// running on someone's phone compares this against the stamp it was built with.
// If they differ, that phone is out of date. See app/lib/VersionWatcher.tsx.
//
// force-dynamic keeps Vercel from caching the answer, which would defeat the
// entire point.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_BUILD_ID || 'unknown' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}