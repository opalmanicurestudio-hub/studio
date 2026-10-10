'use client';
// src/components/staff-portal/useMyRent.ts — loads the signed-in person's own rent picture (/api/portal/my-rent) and
// refreshes it every two minutes and whenever the phone comes back to the app.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

export function useMyRent(tenantId: string, staffId: string) {
  const [data, setData] = React.useState<any>(null);
  const load = React.useCallback(async () => {
    if (!tenantId || !staffId) return;
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
    const r = await fetch(`/api/portal/my-rent?tenantId=${encodeURIComponent(tenantId)}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setData(r);
  }, [tenantId, staffId]);
  React.useEffect(() => {
    load(); const t = setInterval(load, 120000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  return data;
}
