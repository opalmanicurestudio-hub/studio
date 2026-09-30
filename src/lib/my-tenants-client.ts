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
    (async () => { try { const tk = await user.getIdToken(); const r = await fetch('/api/my-tenants', { headers: { Authorization: `Bearer ${tk}` }, cache: 'no-store' }); const d = await r.json();
        if (!stop) { setIds(d?.ok ? d.owned || [] : []); setStaff(d?.ok ? d.staff || null : null); } } catch { if (!stop) { setIds([]); setStaff(null); } } })();
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
