'use client';
// src/components/staff-portal/VisitDocs.tsx — "FOR THIS VISIT" on the staff app's Now card (approved design, canvas row
// 22 "The SOP comes to the visit"). The published documents linked to this visit's service (or the step under way),
// its station, or a kit the service needs (lib/doc-links) — so nobody has to go looking for them mid-visit.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { docsForVisit } from '@/lib/doc-links';
import { visitSteps, liveTiming } from '@/lib/phase-timeline';
import { collectionsOf, collectionFor } from '@/lib/doc-collections';
import { Cover } from '@/components/documents/DocsLibrary';

const INK = '#16171a', MUTED = '#6d7075', SOFT = '#f3f3f5';

/** Published documents for the whole business (read once per screen; the Now card and the station view share it). */
export function usePublishedDocs(tenantId: string) {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'documents'), where('status', '==', 'published')) : null), [firestore, tenantId]);
  return useCollection<any>(q).data || [];
}

export function VisitDocs({ tenantId, tenant, visit, service, live, onOpenDoc }: { tenantId: string; tenant?: any; visit: any; service: any; live: boolean; onOpenDoc: (id: string) => void }) {
  const docs = usePublishedDocs(tenantId);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, [live]);
  const step = React.useMemo(() => { if (!live || !service) return null; const steps = visitSteps(service, Number(visit?.clientExtraMinutes) || 0); const lt = liveTiming(steps, visit, now);
    const s = lt && lt.index >= 0 ? steps[lt.index] : null; return s ? { id: s.id || null, label: s.label } : null; }, [live, service, visit, now]);
  const list = docsForVisit(docs, visit, service, step);
  if (!list.length) return null;
  const cols = collectionsOf(tenant);
  return (
    <div className="space-y-1.5" style={{ color: INK }}>
      <p className="text-[12.5px] font-semibold" style={{ color: MUTED }}>For this visit</p>
      {list.slice(0, 4).map(({ doc: d, why, now: isNow }) => <button key={d.id} type="button" onClick={() => onOpenDoc(d.id)} className="flex w-full items-center gap-2.5 rounded-[14px] p-2.5 text-left" style={{ background: isNow ? '#e3efed' : SOFT }}>
        <Cover c={collectionFor(d, cols)} w={40} h={40} r={11} label={false} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{d.title || 'Document'}</span><span className="block truncate text-[12.5px]" style={{ color: isNow ? '#2f6f6a' : MUTED }}>{isNow ? `Now · ${why.replace(/^Step · /, '')}` : why}</span></span>
        <span className="text-[13px] font-semibold" style={{ color: isNow ? '#2f6f6a' : INK }}>Open</span></button>)}
      {list.length > 4 && <button type="button" onClick={() => onOpenDoc('')} className="text-[12.5px] underline underline-offset-2" style={{ color: MUTED }}>{list.length - 4} more in Handbook and SOPs</button>}
    </div>);
}
