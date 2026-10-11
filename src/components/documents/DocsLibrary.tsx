'use client';
// src/components/documents/DocsLibrary.tsx — DOCUMENTS → LIBRARY (approved option A, design canvas row 22): collections as
// covered tiles with their counts, a search that looks inside documents, quick filters (needs review, not signed by
// everyone, drafts), and one row per document — its cover, what's in it, how many have signed this version, its owner
// and review date, and where it stands (live, draft, changes waiting, review due). Tapping a row opens it.
import * as React from 'react';
import { collection } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collectionsOf, collectionFor, reviewDue, docStats, assignedPeople, docMatches, type DocCollection } from '@/lib/doc-collections';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', BLUE = '#3d5a99';
const card = 'rounded-[18px] border bg-white';
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function Cover({ c, w, h, r = 16, label = true }: { c: DocCollection; w: number | string; h: number; r?: number; label?: boolean }) {
  return <div aria-hidden={!label} className="relative shrink-0 overflow-hidden" style={{ width: w, height: h, borderRadius: r, background: c.soft }}>
    <svg aria-hidden="true" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full"><circle cx="170" cy="20" r="60" fill={c.color} opacity=".14" /><circle cx="150" cy="110" r="38" fill={c.color} opacity=".18" /><path d="M0 95 C 50 80, 90 110, 200 85 V120 H0z" fill={c.color} opacity=".12" /></svg>
    {label && <span className="absolute bottom-3 left-3.5 text-[13px] font-bold" style={{ color: c.color }}>{c.name}</span>}
  </div>;
}
function Pill({ t, tone }: { t: string; tone: 'ok' | 'warn' | 'blue' | 'grey' }) {
  const s = { ok: ['#e9f3ed', GREEN], warn: ['#fdf3e6', AMBER], blue: ['#e6ecf7', BLUE], grey: [SOFT, INK] }[tone];
  return <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold" style={{ background: s[0], color: s[1] }}>{t}</span>;
}
function Acks({ tenantId, id, onAcks }: { tenantId: string; id: string; onAcks: (id: string, a: any[]) => void }) {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/documents/${id}/acks`) : null), [firestore, tenantId, id]);
  const { data } = useCollection<any>(q); React.useEffect(() => { onAcks(id, data || []); }, [data, id, onAcks]); return null;
}

type Filter = 'all' | 'review' | 'unsigned' | 'drafts';
export function DocsLibrary({ tenantId, tenant, docs, staff, canManage, myStaffId, onOpen, today }: { tenantId: string; tenant: any; docs: any[]; staff: any[]; canManage: boolean; myStaffId: string; onOpen: (id: string) => void; today: string }) {
  const cols = collectionsOf(tenant);
  const [q, setQ] = React.useState(''); const [f, setF] = React.useState<Filter>('all'); const [col, setCol] = React.useState<string>('');
  const [acks, setAcks] = React.useState<Record<string, any[]>>({});
  const onAcks = React.useCallback((id: string, a: any[]) => setAcks((p) => (p[id] === a ? p : { ...p, [id]: a })), []);
  const rows = React.useMemo(() => docs.map((d) => {
    const c = collectionFor(d, cols); const v = Number(d.version || 1);
    const people = assignedPeople(d, staff); const signedIds = new Set((acks[d.id] || []).filter((a) => Number(a.version) === v).map((a) => a.id));
    const signed = people.filter((p: any) => signedIds.has(p.id)).length; const due = reviewDue(d);
    const status: 'draft' | 'changes' | 'review' | 'live' = d.status !== 'published' ? 'draft' : d.draft ? 'changes' : due && due <= today ? 'review' : 'live';
    return { d, c, signed, total: people.length, due, status, mine: signedIds.has(myStaffId) };
  }), [docs, cols, staff, acks, today, myStaffId]);
  const shown = rows.filter((r) => (!col || r.c.id === col) && docMatches(r.d, q) && (f === 'all' || (f === 'review' && (r.status === 'review' || (r.due && r.due <= today))) || (f === 'unsigned' && r.d.status === 'published' && r.signed < r.total) || (f === 'drafts' && (r.status === 'draft' || r.status === 'changes'))))
    .sort((a, b) => ({ review: 0, changes: 1, draft: 2, live: 3 }[a.status] - { review: 0, changes: 1, draft: 2, live: 3 }[b.status]) || String(a.d.title || '').localeCompare(String(b.d.title || '')));
  const tiles = cols.map((c) => { const mine = rows.filter((r) => r.c.id === c.id); const rev = mine.filter((r) => r.status === 'review').length;
    return { c, n: mine.length, sub: `${mine.length} document${mine.length === 1 ? '' : 's'}${rev ? ` · ${rev} review due` : ''}` }; }).filter((t) => t.n > 0 || canManage);
  const ownerName = (id?: string) => (staff || []).find((m: any) => m.id === id)?.name || '';
  const chip = (k: Filter, label: string) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className="h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium" style={f === k ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{label}</button>;

  return (
    <div className="space-y-4" style={{ color: INK }}>
      {docs.filter((d) => d.status === 'published').map((d) => <Acks key={d.id} tenantId={tenantId} id={d.id} onAcks={onAcks} />)}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-3 md:overflow-visible lg:grid-cols-6">
        {tiles.map((t) => <button key={t.c.id} type="button" aria-pressed={col === t.c.id} onClick={() => setCol(col === t.c.id ? '' : t.c.id)} className={`${card} w-[168px] shrink-0 overflow-hidden text-left md:w-auto`} style={{ borderColor: col === t.c.id ? INK : LINE, boxShadow: col === t.c.id ? `0 0 0 1px ${INK}` : undefined }}>
          <Cover c={t.c} w="100%" h={84} r={0} label={false} /><div className="px-3 py-2.5"><p className="truncate text-[14px] font-semibold">{t.c.name}</p><p className="truncate text-[12px]" style={{ color: MUTED }}>{t.sub}</p></div></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-full border bg-white px-4" style={{ borderColor: LINE }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" placeholder="Search titles and what’s inside" className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] outline-none" /></label>
        {canManage && <div className="flex gap-1.5 overflow-x-auto">{chip('all', 'All')}{chip('review', 'Needs review')}{chip('unsigned', 'Not signed by everyone')}{chip('drafts', 'Drafts')}</div>}
      </div>
      {col && <p className="text-[13.5px]" style={{ color: MUTED }}>Showing {cols.find((c) => c.id === col)?.name}. <button type="button" onClick={() => setCol('')} className="underline underline-offset-2">Show everything</button></p>}
      {!shown.length ? <div className={`${card} p-8 text-center`} style={{ borderColor: LINE }}><p className="text-[15px] font-medium">{docs.length ? 'Nothing matches.' : canManage ? 'No documents yet.' : 'Nothing given to you yet.'}</p><p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{docs.length ? 'Try another search or filter.' : canManage ? 'Start from a template — the opening checklist or the sanitation SOP are good first ones.' : 'When a manager publishes something for you, it shows here.'}</p></div> :
        <div className={`${card} overflow-hidden`} style={{ borderColor: LINE }}>
          {shown.map((r, i) => { const s = docStats(r.d); const pct = r.total ? Math.round((r.signed / r.total) * 100) : 0;
            const meta = [`v${r.d.version || 1}`, s.steps ? `${s.steps} step${s.steps === 1 ? '' : 's'}` : '', s.items ? `${s.items} item${s.items === 1 ? '' : 's'}` : '', `${s.minutes} min`].filter(Boolean).join(' · ');
            const owner = ownerName(r.d.ownerId);
            return <button key={r.d.id} type="button" onClick={() => onOpen(r.d.id)} className="grid w-full grid-cols-[48px_1fr_auto] items-center gap-3.5 px-4 py-3 text-left hover:bg-[#fafafa] md:grid-cols-[56px_1.6fr_1fr_160px_130px] md:gap-4 md:px-[18px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
              <Cover c={r.c} w={56} h={42} r={10} label={false} />
              <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{r.d.title || 'Untitled document'}</span><span className="block truncate text-[12.5px]" style={{ color: MUTED }}>{r.c.name} · {meta}</span></span>
              {canManage && r.d.status === 'published' ? <span className="hidden flex-col gap-1.5 md:flex"><span className="flex justify-between text-[12.5px]"><span style={{ color: MUTED }}>Signed</span><b className="font-semibold">{r.signed} of {r.total}</b></span><span className="h-1.5 rounded-full" style={{ background: SOFT }}><span className="block h-1.5 rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? GREEN : INK }} /></span></span> : <span className="hidden md:block" />}
              <span className="hidden text-[12.5px] md:block" style={{ color: MUTED }}>{owner ? `Owner: ${owner.split(' ')[0]}` : r.d.updatedBy ? `By ${String(r.d.updatedBy).split(' ')[0]}` : ''}{r.due && <span className="block" style={{ color: r.due <= today ? AMBER : MUTED }}>{r.due <= today ? `Review was due ${nice(r.due)}` : `Review ${nice(r.due)}`}</span>}</span>
              <span className="justify-self-end">{!canManage ? (r.mine ? <Pill t="Signed" tone="ok" /> : <Pill t="To sign" tone="warn" />) : r.status === 'live' ? <Pill t="Live" tone="ok" /> : r.status === 'draft' ? <Pill t="Draft" tone="grey" /> : r.status === 'changes' ? <Pill t="Changes waiting" tone="blue" /> : <Pill t="Review due" tone="warn" />}</span>
            </button>; })}
        </div>}
    </div>);
}
