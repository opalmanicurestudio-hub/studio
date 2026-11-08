import { NextRequest, NextResponse } from 'next/server';

// ─── middleware.ts ─────────────────────────────────────────────────────────────
// Keeps everyone on the LIVE app. Locking a business (paused, cancelled, past its grace period) is not done here:
// the app's own screens close for a locked business (components/auth/AccessGate), and every route that starts a
// booking or takes money checks the business first (lib/tenant-open-server). Both read the business itself, so neither
// depends on anything a browser keeps.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Every Vercel deployment also lives forever at its own address (studio-<hash>-<team>.vercel.app), frozen at its
  // code. Anyone who opens one (an old email link, a bookmark) would be stuck on old code. So a PRODUCTION deployment
  // opened at any address other than the live one forwards to the same page on the live app. Preview builds
  // (branches) are left alone so they can still be tested. Pages only: webhooks and API calls are addressed to the
  // live app already.
  const prodHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').toLowerCase();
  const host = String(req.headers.get('host') || '').toLowerCase();
  if (process.env.VERCEL_ENV === 'production' && prodHost && host && host !== prodHost
      && host.endsWith('.vercel.app') && !host.includes('-git-')
      && req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
    const live = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${prodHost}`);
    return NextResponse.redirect(live, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
