// src/lib/app-origin.ts
//
// WHERE LINKS POINT.
//
// Vercel keeps every deployment at its own permanent address
// (studio-<hash>-<team>.vercel.app). Those addresses NEVER get new code.
// If a link in an email or text points at one, whoever taps it is using an
// old copy of the app forever — fixes "don't work", counts "don't update".
//
// Links used to be built from: a saved override (tenant.publicOrigin) →
// Vercel's production address → the address the request came from. The last
// one let a single frozen link breed more frozen links (a booking made on an
// old copy emailed links to that old copy). linkOrigin() never returns a
// frozen deployment address when anything better is known.

const PROD = () => (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** A Vercel deployment-specific address (frozen) — not the production one, not a branch alias. */
export function isFrozenHost(hostOrUrl: string | null | undefined, productionHost: string = PROD()): boolean {
  const host = String(hostOrUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!host.endsWith('.vercel.app')) return false;                 // custom domains are never frozen
  if (productionHost && host === productionHost.toLowerCase()) return false;
  if (host.includes('-git-')) return false;                          // branch aliases follow the branch
  return !!productionHost;                                           // any other *.vercel.app, when we know the real one
}

/** The base URL for links we send people. */
export function linkOrigin(tenant?: any, requestOrigin?: string | null): string {
  const prod = PROD();
  const candidates = [
    tenant?.publicOrigin,
    prod ? `https://${prod}` : '',
    process.env.NEXT_PUBLIC_APP_URL,
    requestOrigin,
  ];
  for (const c of candidates) {
    const v = String(c || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(v)) continue;
    if (isFrozenHost(v, prod)) continue;
    return v;
  }
  // Nothing better known: the request's own address is all we have.
  return String(requestOrigin || '').replace(/\/+$/, '');
}
