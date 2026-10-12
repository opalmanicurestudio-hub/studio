'use client';
// src/components/team/useMyWork.ts — loads one person's tasks, SOPs (with their own sign-off on each) and checklist turns
// for lib/my-work. Used by the staff app (Me → My work) and the main app's staff profile (Training & tasks). Live for
// tasks, documents and rotations; sign-offs and this month's checklist runs are read once per change of documents.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { myWork, docIsFor, type MyWork } from '@/lib/my-work';

export function useMyWork(firestore: any, tenantId: string, staff: { id: string; role?: string } | null, today: string): { work: MyWork | null; loading: boolean; reload: () => void } {
  const sid = staff?.id || '';
  const tQ = useMemoFirebase(() => (firestore && tenantId && sid ? query(collection(firestore, `tenants/${tenantId}/tasks`), where('assignedStaffIds', 'array-contains', sid)) : null), [firestore, tenantId, sid]);
  // A renter only asks for what's theirs — documents sent to renters, or to them by name (the database allows no more).
  const renter = staff?.role === 'renter' || (staff as any)?.isRenter === true;
  const dQ = useMemoFirebase(() => (firestore && tenantId && sid ? (renter ? query(collection(firestore, `tenants/${tenantId}/documents`), where('assignedRoles', 'array-contains', 'renter')) : collection(firestore, `tenants/${tenantId}/documents`)) : null), [firestore, tenantId, sid, renter]);
  const nQ = useMemoFirebase(() => (firestore && tenantId && sid && renter ? query(collection(firestore, `tenants/${tenantId}/documents`), where('assignedStaffIds', 'array-contains', sid)) : null), [firestore, tenantId, sid, renter]);
  const rQ = useMemoFirebase(() => (firestore && tenantId && sid ? query(collection(firestore, `tenants/${tenantId}/rotations`), where('memberIds', 'array-contains', sid)) : null), [firestore, tenantId, sid]);
  const { data: tasks, isLoading: tl } = useCollection<any>(tQ); const { data: docsA, isLoading: dl } = useCollection<any>(dQ); const { data: docsB } = useCollection<any>(nQ);
  const docs = React.useMemo(() => { const m = new Map<string, any>(); for (const x of [...(docsA || []), ...(docsB || [])]) m.set(x.id, x); return [...m.values()]; }, [docsA, docsB]); const { data: rotations } = useCollection<any>(rQ);
  const [acks, setAcks] = React.useState<Record<string, any | null>>({}); const [runs, setRuns] = React.useState<any[]>([]); const [tick, setTick] = React.useState(0);
  const mine = React.useMemo(() => (staff ? (docs || []).filter((d: any) => docIsFor(d, staff)) : []), [docs, staff]);
  const sig = mine.map((d: any) => `${d.id}:${d.version || 1}`).join('|');
  React.useEffect(() => {
    if (!firestore || !tenantId || !sid) return; let stop = false;
    (async () => {
      const a: Record<string, any | null> = {}; const r: any[] = []; const monthStart = `${today.slice(0, 8)}01`;
      await Promise.all(mine.map(async (d: any) => {
        try { const s = await getDoc(doc(firestore, `tenants/${tenantId}/documents/${d.id}/acks/${sid}`)); a[d.id] = s.exists() ? s.data() : null; } catch { a[d.id] = null; }
        if ((d.sections || []).some((x: any) => x?.type === 'checklist')) {
          try { const rs = await getDocs(query(collection(firestore, `tenants/${tenantId}/documents/${d.id}/runs`), where('staffId', '==', sid))); rs.docs.forEach((x) => { const v: any = x.data(); if (String(v.date || '') >= monthStart) r.push(v); }); } catch { /* none readable */ }
        }
      }));
      if (!stop) { setAcks(a); setRuns(r); }
    })();
    return () => { stop = true; };
  }, [firestore, tenantId, sid, sig, today, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = React.useMemo(() => (staff ? myWork({ staff, today, tasks: tasks || [], docs: docs || [], acks, rotations: rotations || [], runs }) : null), [staff, today, tasks, docs, acks, rotations, runs]);
  return { work, loading: tl || dl, reload: () => setTick((n) => n + 1) };
}
