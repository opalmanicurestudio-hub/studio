'use client';
// src/lib/portal-business-client.ts — THE BUSINESS ON THE TEAM PORTAL'S SCREENS (design board "Renters off the full
// record"). The team and the business's own screens read the full record live from the database. Renters can't (it holds
// the team's pay rules, margins, limits and roles), so their screens get the renter view from the server
// (api/portal/business: the public view plus their own role's permissions, the document folders, the visit-readiness
// rules and whether there's a front desk). If the server can't be reached, the public view keeps the name, look and clock.
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useDoc, useMemoFirebase } from '@/firebase';
import { loadPublicBusiness } from '@/lib/public-business-client';

const asked = new Map<string, Promise<any>>();

async function signIn(): Promise<{ token: string; renter: boolean }> {
  try {
    const { getAuth } = await import('firebase/auth'); const auth: any = getAuth();
    try { await auth.authStateReady?.(); } catch { /* fine */ }
    const u = auth.currentUser; if (!u) return { token: '', renter: false };
    const r = await u.getIdTokenResult();
    return { token: r.token, renter: r.claims?.isRenter === true };
  } catch { return { token: '', renter: false }; }
}

/** The renter view of this business: one request per business for 15 seconds (the portal and its screens share it). */
export function loadRenterBusiness(tenantId: string): Promise<any> {
  if (!tenantId) return Promise.resolve(null);
  const had = asked.get(tenantId); if (had) return had;
  const p = (async () => {
    const { token } = await signIn();
    for (let i = 0; token && i < 2; i++) {
      try {
        const r = await fetch(`/api/portal/business?tenantId=${encodeURIComponent(tenantId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const d = await r.json().catch(() => null);
        if (d?.ok && d.business) return d.business;
        if (r.status < 500) break;
      } catch { /* tried again below */ }
      if (i === 0) await new Promise((res) => setTimeout(res, 800));
    }
    return loadPublicBusiness(tenantId).catch(() => null);
  })();
  asked.set(tenantId, p);
  p.finally(() => setTimeout(() => { if (asked.get(tenantId) === p) asked.delete(tenantId); }, 15000));
  return p;
}

/** The business for whoever is signed in: the full record for the team and the business's screens, the renter view for
 *  a renter. Resolves to {} when it can't be read. */
export async function loadBusinessForMe(firestore: any, tenantId: string): Promise<any> {
  if (!firestore || !tenantId) return {};
  const { renter } = await signIn();
  if (renter) return (await loadRenterBusiness(tenantId)) || {};
  return getDoc(doc(firestore, 'tenants', tenantId)).then((s) => s.data() || {}).catch(() => ({}));   // team only: a renter got the server's view above
}

/** The same, for the portal page itself, which knows whether this is a renter: live for the team, loaded once for a renter. */
export function usePortalBusiness(firestore: any, tenantId: string | null | undefined, renter: boolean): any {
  const ref = useMemoFirebase(() => (!firestore || !tenantId || renter) ? null : doc(firestore, 'tenants', tenantId), [firestore, tenantId, renter]);   // team only: renters get the server's view
  const { data } = useDoc<any>(ref);
  const [view, setView] = useState<any>(null);
  useEffect(() => {
    if (!renter || !tenantId) { setView(null); return; }
    let live = true; loadRenterBusiness(tenantId).then((b) => { if (live) setView(b); });
    return () => { live = false; };
  }, [renter, tenantId]);
  return renter ? view : data;
}
