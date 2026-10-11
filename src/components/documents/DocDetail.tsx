'use client';
// src/components/documents/DocDetail.tsx — ONE DOCUMENT in the main app. The document itself (DocBlocks) with, beside it:
// who has signed this version (when, the quick-check score, their signature) and who still needs to, every version with
// what changed, and the latest checklist runs with their photos. Managers can edit (DocEditor), print, and mark a review
// done ("Still accurate"); anyone it's for can sign it here too (SignFlow).
import * as React from 'react';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collectionsOf, collectionFor, reviewDue, docStats, assignedPeople } from '@/lib/doc-collections';
import { checklistLines, itemKey } from '@/lib/doc-items';
import { Cover } from '@/components/documents/DocsLibrary';
import { DocBlocks, Ico, IC } from '@/components/documents/DocBlocks';
import { DocEditor } from '@/components/documents/DocEditor';
import { SignFlow } from '@/components/documents/SignFlow';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', BLUE = '#3d5a99';
const card = 'rounded-[18px] border bg-white';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function DocDetail({ d, tenantId, canManage, me, staff, onSave, onDelete, onPrint, onClose }: { d: any; tenantId: string; canManage: boolean; me: { id: string; name: string; role?: string }; staff: any[]; onSave: (id: string, data: any, publish: boolean) => void; onDelete: () => void; onPrint: () => void; onClose: () => void }) {
  const { firestore } = useFirebase() as any; const { selectedTenant } = useTenant() as any;
  const [editing, setEditing] = React.useState<boolean>(canManage && (d.status !== 'published' || !(d.sections || []).length));
  const [signing, setSigning] = React.useState(false); const [openRun, setOpenRun] = React.useState('');
  const aQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/documents/${d.id}/acks`) : null), [firestore, tenantId, d.id]);
  const { data: acks } = useCollection<any>(aQ);
  const hasLists = (d.sections || []).some((x: any) => x.type === 'checklist');
  const rQ = useMemoFirebase(() => (firestore && tenantId && canManage && hasLists ? collection(firestore, `tenants/${tenantId}/documents/${d.id}/runs`) : null), [firestore, tenantId, d.id, canManage, hasLists]);
  const { data: runs } = useCollection<any>(rQ);
  const col = collectionFor(d, collectionsOf(selectedTenant)); const st = docStats(d); const v = Number(d.version || 1);
  const people = assignedPeople(d, staff); const current = (acks || []).filter((a: any) => Number(a.version) === v);
  const signedIds = new Set(current.map((a: any) => a.id)); const missing = people.filter((p: any) => !signedIds.has(p.id));
  const mine = (acks || []).find((a: any) => a.id === me.id); const mineCurrent = !!mine && Number(mine.version) === v;
  const forMe = d.status === 'published' && (people.some((p: any) => p.id === me.id) || (d.assignedRoles || []).includes('all') || (!!me.role && (d.assignedRoles || []).includes(me.role)) || (d.assignedStaffIds || []).includes(me.id));
  const due = reviewDue(d); const today = new Date().toISOString().slice(0, 10);
  const recent = [...(runs || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8); const run = recent.find((r) => r.id === openRun);

  if (editing) return <DocEditor tenantId={tenantId} docItem={d} staff={staff} onSave={(x) => onSave(d.id, x, false)} onPublish={(x) => { onSave(d.id, x, true); setEditing(false); }} onDelete={onDelete} onClose={() => (d.status === 'published' ? setEditing(false) : onClose())} />;
  if (signing) return <div className={`${card} mx-auto max-w-[560px] p-5`} style={{ borderColor: LINE }}><SignFlow firestore={firestore} tenantId={tenantId} d={d} staff={{ id: me.id, name: me.name }} onBack={() => setSigning(false)} onDone={() => setSigning(false)} /></div>;

  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className={`${card} overflow-hidden`} style={{ borderColor: LINE }}>
        <Cover c={col} w="100%" h={120} r={0} label={false} />
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div className="min-w-0"><p className="text-[13px] font-semibold" style={{ color: col.color }}>{col.name}</p><h2 className="text-[28px] font-normal leading-tight tracking-[-0.03em]">{d.title || 'Untitled document'}</h2>
            <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{[`Version ${v}`, d.publishedAt ? `published ${when(d.publishedAt)}` : d.status !== 'published' ? 'draft' : '', st.steps ? `${st.steps} steps` : '', `${st.minutes} min read`].filter(Boolean).join(' · ')}</p></div>
          <div className="flex flex-wrap gap-2">
            {forMe && (mineCurrent ? <span className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold" style={{ background: '#e9f3ed', color: GREEN }}><Ico d={IC.check} s={15} c={GREEN} w={2.4} />You signed v{v}</span>
              : <button type="button" onClick={() => setSigning(true)} className="h-10 rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>{mine ? `Sign v${v}` : 'Read and sign'}</button>)}
            {d.status === 'published' && <button type="button" onClick={onPrint} className="h-10 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }}>Print</button>}
            {canManage && <button type="button" onClick={() => setEditing(true)} className="h-10 rounded-full border bg-white px-4 text-[14px] font-medium" style={{ borderColor: LINE }}>{d.draft ? 'Edit (changes waiting)' : 'Edit'}</button>}
          </div>
        </div>
      </div>
      {canManage && due && due <= today && <div className="flex flex-wrap items-center gap-3 rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}>
        <span className="flex-1"><b>Review due.</b> Read it through — if it’s still right, keep it; if not, edit and publish a new version.</span>
        <button type="button" onClick={() => updateDoc(doc(firestore, `tenants/${tenantId}/documents/${d.id}`), { reviewedAt: new Date().toISOString(), reviewedBy: me.name }).catch(() => {})} className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>Still accurate</button></div>}
      {v > 1 && d.changeNote && <div className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#e6ecf7', color: '#22365f' }}><b>What changed in v{v}</b> · {d.changeNote}</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className={`${card} p-5 md:p-7`} style={{ borderColor: LINE }}>{(d.sections || []).length ? <DocBlocks sections={d.sections} /> : <p className="text-[14px]" style={{ color: MUTED }}>Nothing written yet.</p>}</div>
        <div className="space-y-4">
          {canManage && d.status === 'published' && <div className={`${card} p-4`} style={{ borderColor: LINE }}>
            <div className="flex items-baseline justify-between"><p className="text-[15px] font-bold">Signed v{v}</p><p className="text-[14px] font-semibold">{people.filter((p: any) => signedIds.has(p.id)).length} of {people.length}</p></div>
            <div className="mt-2 h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full" style={{ width: `${people.length ? Math.round((people.filter((p: any) => signedIds.has(p.id)).length / people.length) * 100) : 0}%`, background: missing.length ? INK : GREEN }} /></div>
            <div className="mt-3 space-y-2">{current.map((a: any) => <div key={a.id} className="flex items-center gap-2.5 text-[13.5px]"><span className="min-w-0 flex-1"><b className="font-semibold">{a.staffName || 'Team member'}</b><span className="block text-[12px]" style={{ color: MUTED }}>{when(a.acknowledgedAt)}{a.quiz ? ` · check ${a.quiz.right}/${a.quiz.total}` : ''}</span></span>{a.signatureUrl && <img src={a.signatureUrl} alt={`${a.staffName || 'Their'} signature`} className="h-8 w-20 rounded-[6px] border object-contain" style={{ borderColor: LINE }} />}</div>)}</div>
            {missing.length > 0 && <div className="mt-3 border-t pt-3" style={{ borderColor: LINE }}><p className="text-[12.5px]" style={{ color: MUTED }}>Still to sign{d.signBy ? ` · by ${new Date(`${d.signBy}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{missing.map((m: any) => { const old = (acks || []).find((a: any) => a.id === m.id); return <span key={m.id} className="inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px]" style={old ? { background: '#e6ecf7', color: BLUE } : { background: SOFT }}>{m.name}{old ? ` · signed v${old.version}` : ''}</span>; })}</div></div>}
          </div>}
          {Array.isArray(d.history) && d.history.length > 0 && <div className={`${card} p-4`} style={{ borderColor: LINE }}><p className="pb-1 text-[15px] font-bold">Versions</p>
            {[...d.history].reverse().slice(0, 8).map((h: any) => <div key={`${h.version}-${h.at}`} className="grid grid-cols-[34px_1fr] gap-2 border-t py-2.5 text-[13.5px]" style={{ borderColor: LINE }}><b>v{h.version}</b><span><span style={{ color: MUTED }}>{when(h.at)} · {String(h.by || '').split(' ')[0]}</span>{h.note && <span className="block">{h.note}</span>}</span></div>)}</div>}
          {canManage && hasLists && d.status === 'published' && <div className={`${card} p-4`} style={{ borderColor: LINE }}><p className="pb-2 text-[15px] font-bold">Checklist runs</p>
            {!recent.length ? <p className="text-[13.5px]" style={{ color: MUTED }}>None yet — the team ticks these off in the staff app.</p> : <div className="flex flex-wrap gap-1.5">{recent.map((r) => { const full = r.totalItems > 0 && Number(r.checkedCount) >= Number(r.totalItems);
              return <button key={r.id} type="button" aria-pressed={openRun === r.id} onClick={() => setOpenRun(openRun === r.id ? '' : r.id)} className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px]" style={openRun === r.id ? { background: INK, color: '#fff' } : full ? { background: '#e9f3ed', color: GREEN } : { background: '#fdf3e6', color: AMBER }}>{String(r.staffName || '').split(' ')[0]} · {r.date ? new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''} · {r.checkedCount}/{r.totalItems}</button>; })}</div>}
            {run && <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: LINE }}>{(d.sections || []).filter((s: any) => s.type === 'checklist').map((s: any) => <div key={s.id}>{s.heading && <p className="text-[12.5px]" style={{ color: MUTED }}>{s.heading}</p>}
              {checklistLines(s).map((t, i) => { const k = itemKey(s, i); const on = !!(run.items || {})[k]; const ph = (run.photos || {})[k];
                return <div key={i} className="flex items-center gap-2 py-1 text-[13.5px]"><span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px]" style={on ? { background: GREEN } : { border: '2px solid #c9cacf' }}>{on && <Ico d={IC.check} s={11} c="#fff" w={3} />}</span><span className="min-w-0 flex-1" style={{ color: on ? INK : MUTED }}>{t}</span>{ph && <a href={ph} target="_blank" rel="noreferrer"><img src={ph} alt={`Photo: ${t}`} className="h-10 w-10 rounded-[8px] object-cover" /></a>}</div>; })}</div>)}</div>}
          </div>}
        </div>
      </div>
    </div>);
}
