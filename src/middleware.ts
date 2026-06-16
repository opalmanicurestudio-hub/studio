import { NextRequest, NextResponse } from 'next/server';

// ─── middleware.ts ─────────────────────────────────────────────────────────────
// Checks tenant subscription status on every protected app route.
// Must be at the project root: src/middleware.ts  OR  middleware.ts
//
// Flow:
//   1. Request hits an (app) route
//   2. Middleware reads tenantId from cookie (set at login by TenantContext)
//   3. Fetches tenant doc from Firestore via Admin REST API (edge-compatible)
//   4. Checks subscriptionStatus and gracePeriodEndsAt
//   5. If locked → redirects to /suspended with reason
//   6. If grace period expired → locks in Firestore, redirects to /suspended
//   7. If past_due but within grace → allows through with warning header
//
// Routes that are always accessible (no subscription check):
//   - /login, /signup, /onboarding
//   - /suspended (the lockout page itself)
//   - /settings/billing (so they can fix their card)
//   - /api/* (API routes handle their own auth)
//   - /_next/*, /favicon.ico, /public/*

// ─── Edge-compatible Firestore read via REST ──────────────────────────────────
async function getTenantData(tenantId: string): Promise<Record<string, any> | null> {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (!projectId || !tenantId) return null;

  // Use the Firestore REST API — works in Edge Runtime
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tenants/${tenantId}`;

  try {
    const res = await fetch(url, {
      headers: {
        // In Edge middleware we use the service account key from env
        // via a lightweight JWT — or just use the Admin SDK in a Route Handler.
        // Simplest approach: store a server-side API key for this read.
        'Authorization': `Bearer ${process.env.FIREBASE_ADMIN_REST_TOKEN || ''}`,
      },
      // Short cache — we want near-real-time status
      next: { revalidate: 30 },
    });

    if (!res.ok) return null;

    const doc  = await res.json();
    const fields = doc.fields || {};

    // Convert Firestore field format to plain object
    const parse = (field: any): any => {
      if (!field) return null;
      if ('stringValue'    in field) return field.stringValue;
      if ('booleanValue'   in field) return field.booleanValue;
      if ('integerValue'   in field) return Number(field.integerValue);
      if ('doubleValue'    in field) return field.doubleValue;
      if ('timestampValue' in field) return field.timestampValue;
      if ('nullValue'      in field) return null;
      if ('mapValue'       in field) {
        const map: Record<string, any> = {};
        for (const [k, v] of Object.entries(field.mapValue.fields || {})) map[k] = parse(v);
        return map;
      }
      return null;
    };

    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) result[k] = parse(v as any);
    return result;
  } catch {
    return null;
  }
}

// ─── Routes that bypass subscription check ────────────────────────────────────
const ALWAYS_ALLOWED = [
  '/login',
  '/signup',
  '/onboarding',
  '/suspended',
  '/settings/billing',
  '/api/',
  '/_next/',
  '/favicon.ico',
  '/public/',
  '/inquiry/',
  '/quote/',
  '/booking/',
];

const isAlwaysAllowed = (pathname: string) =>
  ALWAYS_ALLOWED.some(prefix => pathname.startsWith(prefix));

// ─── Middleware ───────────────────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through non-protected routes immediately
  if (isAlwaysAllowed(pathname)) {
    return NextResponse.next();
  }

  // Read tenantId from cookie (set by TenantContext on login)
  const tenantId = req.cookies.get('clarityflow_tenant_id')?.value;

  if (!tenantId) {
    // No tenant cookie — let the app handle auth redirect
    return NextResponse.next();
  }

  const tenant = await getTenantData(tenantId);

  if (!tenant) {
    // Couldn't read tenant — fail open (don't block on infrastructure issues)
    return NextResponse.next();
  }

  const status          = tenant.subscriptionStatus as string | undefined;
  const accessLocked    = tenant.accessLocked === true;
  const gracePeriodEnds = tenant.gracePeriodEndsAt as string | null;

  // ── Hard locked (cancelled or manually locked) ────────────────────────────
  if (accessLocked || status === 'cancelled') {
    const url = req.nextUrl.clone();
    url.pathname = '/suspended';
    url.searchParams.set('reason', status === 'cancelled' ? 'cancelled' : 'locked');
    return NextResponse.redirect(url);
  }

  // ── Past due — check grace period ─────────────────────────────────────────
  if (status === 'past_due') {
    if (gracePeriodEnds) {
      const graceEnd = new Date(gracePeriodEnds);

      if (Date.now() > graceEnd.getTime()) {
        // Grace period expired — lock the tenant via API route and redirect
        // (We can't write to Firestore directly from Edge middleware,
        //  so we call a lightweight internal API to do the write)
        try {
          await fetch(`${req.nextUrl.origin}/api/internal/lock-tenant`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-middleware-secret': process.env.MIDDLEWARE_SECRET || '' },
            body:    JSON.stringify({ tenantId }),
          });
        } catch { /* ignore — redirect happens regardless */ }

        const url = req.nextUrl.clone();
        url.pathname = '/suspended';
        url.searchParams.set('reason', 'grace_expired');
        return NextResponse.redirect(url);
      }

      // Within grace period — allow through but add warning header
      const daysLeft = Math.ceil((graceEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const response = NextResponse.next();
      response.headers.set('x-subscription-warning', `past_due:${daysLeft}`);
      return response;
    }

    // past_due but no grace period set — allow through (webhook may not have fired yet)
    return NextResponse.next();
  }

  // ── Trial ending soon — pass warning header ───────────────────────────────
  if (status === 'trialing' && tenant.trialEnd) {
    const trialEnd  = new Date(tenant.trialEnd);
    const daysLeft  = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 5) {
      const response = NextResponse.next();
      response.headers.set('x-subscription-warning', `trial_ending:${daysLeft}`);
      return response;
    }
  }

  // ── Active / trialing / no subscription yet — allow through ───────────────
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all (app) routes — excludes static files automatically
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
