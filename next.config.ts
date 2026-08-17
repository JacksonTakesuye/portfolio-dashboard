import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// BUILD STAMP
//
// Every build gets a unique identifier. It is baked into the copy of the app
// that runs in people's browsers AND into /api/version on the server. When
// somebody's phone is still running an older copy, those two values no longer
// match, and the app knows to refresh itself.
//
// See app/lib/VersionWatcher.tsx for what happens when they differ.
//
// On Vercel this is the git commit that produced the build. Running locally
// there is no commit, so we fall back to the time the build started.
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: this must be a stable value, not something like Date.now().
// Next.js can load this config in more than one process during a build. A value
// that changes each time it is read would give the browser copy and the server
// copy different stamps, so they would never match and the app would try to
// refresh itself forever. When there is no commit (running locally) we return a
// fixed word, and VersionWatcher switches itself off when it sees it.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "development";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

export default nextConfig;