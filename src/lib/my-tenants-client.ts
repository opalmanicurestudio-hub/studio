'use client';
// src/lib/my-tenants-client.ts — the businesses the signed-in user OWNS, kept live. Asks /api/my-tenants which ones
// (the rules forbid listing businesses from a browser), then watches each owned business document (reading your own
// business is allowed), so settings changes still show up instantly everywhere.
import { useEffect, useState } from 'react';
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';

export function useMyTenants(user: any, firestore: Firestore | null) {
  const [ids, setIds] = useState<string[] | null>(null); const [staff, setStaff] = useState<{ tenantId: string; role: string } | null>(null);
  const [docs, setDocs] = useState<Record<string, any>>({}); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stop = false; if (!user) { setIds(null); setStaff(null); setDocs({}); setLoading(!!user); return; }
    setLoading(true);
    // If the server can't be reached (or errors), fall back to the business this browser last used — a hiccup must never
    // leave the app with no business. A clear answer of "none" is respected.
    const stored = () => { try { const id = localStorage.getItem('selectedTenantId'); return id ? [id] : []; } catch { return []; } };
    (async () => { for (let attempt = 0; attempt < 2; attempt++) {
        try { const tk = await user.getIdToken(attempt > 0); const r = await fetch('/api/my-tenants', { headers: { Authorization: `Bearer ${tk}` }, cache: 'no-store' }); const d = await r.json().catch(() => null);
          if (d?.ok) { if (!stop) { setIds(d.owned || []); setStaff(d.staff || null); } return; }
          if (r.status < 500 && attempt > 0) break;
        } catch { /* try again, then fall back */ } }
      if (!stop) { setIds(stored()); setStaff(null); } })();
    return () => { stop = true; };
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!firestore || ids === null) return;
    if (!ids.length) { setDocs({}); setLoading(false); return; }
    let first = new Set(ids); const uns = ids.map((id) => onSnapshot(doc(firestore, 'tenants', id), (s) => { setDocs((m) => ({ ...m, [id]: s.exists() ? { ...(s.data() as any), id } : null })); first.delete(id); if (!first.size) setLoading(false); }, () => { first.delete(id); if (!first.size) setLoading(false); }));
    return () => uns.forEach((u) => u());
  }, [firestore, (ids || []).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const tenants = (ids || []).map((id) => docs[id]).filter(Boolean);
  return { tenants, staff, loading: loading || ids === null };
}
