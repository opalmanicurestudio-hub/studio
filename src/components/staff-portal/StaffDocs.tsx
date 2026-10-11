'use client';
// src/components/staff-portal/StaffDocs.tsx — STAFF APP → HANDBOOK AND SOPs (approved designs, canvas rows 22–23).
//   List: what's yours, by collection — "To sign" first, with the sign-by date.
//   Reading (option A): a cover, how long it takes, what changed since you last signed, the blocks, and two buttons:
//     Do it with me (one step at a time, with timers) and Read it — sign (quick check, then a drawn signature).
//   Checklists (option C): a document that's mostly a checklist opens checklist-first — big rows to tick, photos where
//     needed, progress saved as you go (today's run), with "How to" for the rest of the document.
import * as React from 'react';
import { collection, doc, query, setDoc, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { uploadImage } from '@/lib/upload-image';
import { bizKey } from '@/lib/biz-clock';
import { docIsFor } from '@/lib/my-work';
import { collectionsOf, collectionFor, docStats } from '@/lib/doc-collections';
import { checklistLines, itemKey, needsPhoto, liveKeys } from '@/lib/doc-items';
import { checklistFirst, walkthrough } from '@/lib/doc-blocks';
import { docsForStation } from '@/lib/doc-links';
import { Cover } from '@/components/documents/DocsLibrary';
import { DocBlocks, Images, Callout, StepNum, Ico, IC } from '@/components/documents/DocBlocks';
import { SignFlow } from '@/components/documents/SignFlow';
import { CertifiedFor } from '@/components/documents/CertifiedFor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', BLUE = '#3d5a99', RED = '#b42318';
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function StaffDocs({ firestore, tenantId, tenant, staffMember, accent = INK, openId, onOpened, stationId, onClearStation }: { firestore: any; tenantId: string; tenant: any; staffMember: any; accent?: string; openId?: string | null; onOpened?: () => void; stationId?: string | null; onClearStation?: () => void }) {
  const me = { id: staffMember.id, role: staffMember.role };
  const dQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/documents`) : null), [firestore, tenantId]);
  const { data: docs, isLoading } = useCollection<any>(dQ);
  const mine = React.useMemo(() => (docs || []).filter((d: any) => docIsFor(d, me)), [docs, me.id, me.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = React.useState<string>('');
  React.useEffect(() => { if (openId) { setOpen(openId); onOpened?.(); } }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [acks, setAcks] = React.useState<Record<string, any>>({});
  React.useEffect(() => {
    if (!firestore || !tenantId) return; let stop = false;
    (async () => { const { getDoc } = await import('firebase/firestore'); const out: Record<string, any> = {};
      await Promise.all(mine.map(async (d: any) => { try { const s = await getDoc(doc(firestore, `tenants/${tenantId}/documents/${d.id}/acks/${staffMember.id}`)); out[d.id] = s.exists() ? s.data() : null; } catch { out[d.id] = null; } }));
      if (!stop) setAcks(out); })();
    return () => { stop = true; };
  }, [firestore, tenantId, staffMember.id, mine.map((d: any) => `${d.id}:${d.version}`).join('|'), open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = collectionsOf(tenant);
  // Yours, or any published one opened from a visit or a station (it's for reading during the work, even if not assigned).
  const d = mine.find((x: any) => x.id === open) || (docs || []).find((x: any) => x.id === open && x.status === 'published');
  if (d) return <DocReader firestore={firestore} tenantId={tenantId} d={d} col={collectionFor(d, cols)} staffMember={staffMember} ack={acks[d.id]} accent={accent} onBack={() => setOpen('')} />;

  const rows = mine.map((x: any) => { const a = acks[x.id]; const signed = !!a && Number(a.version) === Number(x.version || 1); return { x, c: collectionFor(x, cols), signed, again: !!a && !signed }; })
    .sort((p, q) => Number(p.signed) - Number(q.signed) || String(p.x.signBy || '9').localeCompare(String(q.x.signBy || '9')) || String(p.x.title).localeCompare(String(q.x.title)));
  const today = bizKey();
  return (
    <div className="space-y-3.5" style={{ color: INK }}>
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>{String(tenant?.name || '').toLowerCase()}</p><h2 className="text-[28px] font-normal tracking-[-0.03em]">Handbook and SOPs</h2></div>
      {stationId && <AtStation docs={docs || []} stationId={stationId} cols={cols} onOpen={setOpen} onClear={onClearStation} />}
      {staffMember.role !== 'renter' && <CertifiedFor tenantId={tenantId} onOpenDoc={setOpen} title="Your certifications" />}
      {isLoading ? <p className="text-[14px]" style={{ color: MUTED }}>Loading…</p> : !rows.length ? <p className="rounded-[18px] p-5 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>When a manager publishes a handbook page or SOP for you, it shows here to read and sign.</p> :
        <div className="overflow-hidden rounded-[20px] border bg-white" style={{ borderColor: LINE }}>{rows.map((r, i) => { const s = docStats(r.x); const late = r.x.signBy && r.x.signBy < today;
          return <button key={r.x.id} type="button" onClick={() => setOpen(r.x.id)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <Cover c={r.c} w={48} h={48} r={12} label={false} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[15.5px] font-semibold">{r.x.title || 'Document'}</span><span className="block truncate text-[12.5px]" style={{ color: MUTED }}>{r.c.name} · {s.minutes} min{r.x.signBy && !r.signed ? ` · sign by ${nice(r.x.signBy)}` : ''}</span></span>
            {r.signed ? <span className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold" style={{ background: '#e9f3ed', color: GREEN }}><Ico d={IC.check} s={12} c={GREEN} w={2.6} />Signed</span>
              : <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={late ? { background: '#fdecec', color: RED } : r.again ? { background: '#e6ecf7', color: BLUE } : { background: '#fdf3e6', color: AMBER }}>{r.again ? 'Updated' : late ? 'Overdue' : 'To sign'}</span>}
          </button>; })}</div>}
    </div>);
}

function DocReader({ firestore, tenantId, d, col, staffMember, ack, accent, onBack }: { firestore: any; tenantId: string; d: any; col: any; staffMember: any; ack: any; accent: string; onBack: () => void }) {
  const [mode, setMode] = React.useState<'read' | 'walk' | 'sign' | 'howto'>('read');
  const [signedNow, setSignedNow] = React.useState(false);
  const v = Number(d.version || 1); const signed = signedNow || (!!ack && Number(ack.version) === v); const st = docStats(d);
  const listFirst = checklistFirst(d.sections || []); const steps = walkthrough(d.sections || []);
  if (mode === 'sign') return <div className="pb-6"><SignFlow firestore={firestore} tenantId={tenantId} d={d} staff={{ id: staffMember.id, name: staffMember.name || 'Team member' }} accent={accent} onBack={() => setMode('read')} onDone={() => { setSignedNow(true); setMode('read'); }} /></div>;
  if (mode === 'walk') return <Walk d={d} steps={steps} onClose={() => setMode('read')} accent={accent} />;
  const today = bizKey();
  return (
    <div className="-mx-4 -mt-2 pb-28" style={{ color: INK }}>
      <div className="relative"><Cover c={col} w="100%" h={listFirst ? 120 : 170} r={0} label={false} />
        <button type="button" onClick={mode === 'howto' ? () => setMode('read') : onBack} aria-label="Back" className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90"><Ico d={IC.back} s={18} /></button>
        <div className="absolute bottom-3.5 left-5 right-5"><p className="text-[12.5px] font-bold" style={{ color: col.color }}>{col.name}{listFirst && mode !== 'howto' ? ' · today' : ''}</p><p className="text-[25px] font-normal leading-tight tracking-[-0.03em]">{d.title}</p></div></div>
      <div className="space-y-4 px-5 pt-3.5">
        <div className="flex flex-wrap gap-1.5"><Tag>{st.minutes} min read</Tag><Tag>v{v}{d.publishedAt ? ` · ${new Date(d.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</Tag>{!signed && d.signBy && <Tag tone={d.signBy < today ? 'red' : 'amber'}>Sign by {nice(d.signBy)}</Tag>}{signed && <Tag tone="green">Signed v{v}</Tag>}</div>
        {!signed && ack && d.changeNote && <div className="rounded-[16px] px-3.5 py-3 text-[14px] leading-relaxed" style={{ background: '#e6ecf7', color: '#22365f' }}><b>What changed</b> · {d.changeNote}</div>}
        {listFirst && mode !== 'howto' ? <ChecklistRun firestore={firestore} tenantId={tenantId} d={d} staffMember={staffMember} accent={accent} big />
          : <DocBlocks sections={d.sections || []} renderChecklist={(sec) => <ChecklistRun firestore={firestore} tenantId={tenantId} d={{ ...d, sections: [sec] }} staffMember={staffMember} accent={accent} runDoc={d} />} />}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg gap-2 border-t bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3" style={{ borderColor: LINE, gridTemplateColumns: listFirst || steps.length >= 2 ? '1fr 1.3fr' : '1fr' }}>
        {listFirst ? <button type="button" onClick={() => setMode(mode === 'howto' ? 'read' : 'howto')} className="h-12 rounded-full border bg-white text-[14.5px] font-semibold" style={{ borderColor: LINE }}>{mode === 'howto' ? 'Back to the list' : 'How to'}</button>
          : steps.length >= 2 ? <button type="button" onClick={() => setMode('walk')} className="flex h-12 items-center justify-center gap-1.5 rounded-full border bg-white text-[14.5px] font-semibold" style={{ borderColor: LINE }}><Ico d={IC.play} s={14} />Do it with me</button> : null}
        {signed ? <span className="flex h-12 items-center justify-center gap-1.5 rounded-full text-[14.5px] font-semibold" style={{ background: '#e9f3ed', color: GREEN }}><Ico d={IC.check} s={16} c={GREEN} w={2.4} />Signed version {v}</span>
          : <button type="button" onClick={() => setMode('sign')} className="h-12 rounded-full text-[14.5px] font-semibold text-white" style={{ background: INK }}>{ack ? `Read it — sign v${v}` : 'I’ve read it — sign'}</button>}
      </div>
    </div>);
}

/** Opened from a station's QR sign: that station's documents first. */
function AtStation({ docs, stationId, cols, onOpen, onClear }: { docs: any[]; stationId: string; cols: any; onOpen: (id: string) => void; onClear?: () => void }) {
  const list = docsForStation(docs, stationId);
  const name = (list[0]?.links || []).find((l: any) => l?.kind === 'station' && l.id === stationId)?.name || 'this station';
  return (
    <div className="space-y-2 rounded-[20px] p-3.5" style={{ background: '#e3efed' }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-bold">At {name}</p>{onClear && <button type="button" onClick={onClear} className="text-[13px] underline underline-offset-2" style={{ color: MUTED }}>Show everything</button>}</div>
      {!list.length ? <p className="text-[13.5px]" style={{ color: MUTED }}>Nothing is linked to this station yet.</p>
        : list.map((x: any) => <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="flex w-full items-center gap-2.5 rounded-[14px] bg-white p-2.5 text-left">
          <Cover c={collectionFor(x, cols)} w={40} h={40} r={11} label={false} /><span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{x.title || 'Document'}</span><span className="text-[13px] font-semibold">Open</span></button>)}
    </div>);
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'amber' | 'red' | 'green' }) {
  const s = tone === 'amber' ? { background: '#fdf3e6', color: AMBER } : tone === 'red' ? { background: '#fdecec', color: RED } : tone === 'green' ? { background: '#e9f3ed', color: GREEN } : { background: SOFT, color: INK };
  return <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-semibold" style={s}>{children}</span>;
}

/** Today's run of a document's checklists: tick as you go, a photo where one's needed (documents/{id}/runs/{staffId}_{day}). */
function ChecklistRun({ firestore, tenantId, d, staffMember, accent, big = false, runDoc }: { firestore: any; tenantId: string; d: any; staffMember: any; accent: string; big?: boolean; runDoc?: any }) {
  const full = runDoc || d; const today = bizKey(); const runId = `${staffMember.id}_${today}`;
  const rQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/documents/${full.id}/runs`), where('date', '==', today)) : null), [firestore, tenantId, full.id, today]);
  const { data } = useCollection<any>(rQ); const run = (data || []).find((r: any) => r.id === runId) || null;
  const items: Record<string, boolean> = run?.items || {}; const photos: Record<string, string> = run?.photos || {};
  const keys = liveKeys(full.sections || []); const done = keys.filter((k) => items[k]).length;
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const fileRef = React.useRef<HTMLInputElement>(null); const pending = React.useRef('');
  const write = (ni: Record<string, boolean>, np: Record<string, string>) => {
    const n = keys.filter((k) => ni[k]).length;
    return setDoc(doc(firestore, `tenants/${tenantId}/documents/${full.id}/runs/${runId}`), { id: runId, staffId: staffMember.id, staffName: staffMember.name || 'Team member', date: today, docVersion: Number(full.version || 1),
      items: ni, photos: np, checkedCount: n, totalItems: keys.length, startedAt: run?.startedAt || new Date().toISOString(), completedAt: keys.length && n >= keys.length ? (run?.completedAt || new Date().toISOString()) : null }, { merge: true }).catch(() => setErr('That didn’t save — check your connection.'));
  };
  const tap = (k: string, photo: boolean) => { const on = !!items[k]; if (!on && photo && !photos[k]) { pending.current = k; fileRef.current?.click(); return; } const np = { ...photos }; if (on) delete np[k]; write({ ...items, [k]: !on }, np); };
  const picked = async (f?: File | null) => { const k = pending.current; pending.current = ''; if (!f || !k) return; setBusy(k); setErr('');
    try { const url = await uploadImage(`tenants/${tenantId}/evidence/${full.id}/${today}/${staffMember.id}_${k.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`, f, 1400); await write({ ...items, [k]: true }, { ...photos, [k]: url }); }
    catch { setErr('The photo didn’t upload. Try again, or tell a manager if it keeps happening.'); }
    setBusy(''); if (fileRef.current) fileRef.current.value = ''; };
  const pct = keys.length ? Math.round((done / keys.length) * 100) : 0;
  return (
    <div className="space-y-2.5">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => picked(e.target.files?.[0])} />
      {(big || !runDoc) && <div className="flex items-center gap-3.5"><div className="h-2.5 flex-1 rounded-full" style={{ background: SOFT }}><div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, background: GREEN }} /></div><span className="text-[14px] font-semibold">{done} of {keys.length}</span></div>}
      {err && <p className="text-[13px]" style={{ color: RED }}>{err}</p>}
      {(d.sections || []).filter((s: any) => s.type === 'checklist').map((s: any) => <div key={s.id} className="space-y-2">
        {s.heading && <p className={big ? 'pt-1 text-[13px]' : 'text-[15px] font-semibold'} style={big ? { color: MUTED } : undefined}>{s.heading}</p>}
        {checklistLines(s).map((t, i) => { const k = itemKey(s, i); const on = !!items[k]; const ph = needsPhoto(s, i); const url = photos[k];
          return <button key={k} type="button" aria-pressed={on} disabled={busy === k} onClick={() => tap(k, ph)} className="flex w-full items-center gap-3 rounded-[18px] text-left" style={{ padding: big ? 14 : 12, background: on ? '#e9f3ed' : SOFT }}>
            <span className="flex shrink-0 items-center justify-center rounded-[10px]" style={{ width: big ? 30 : 24, height: big ? 30 : 24, ...(on ? { background: GREEN } : { background: '#fff', border: '2px solid #c9cacf' }) }}>{on && <Ico d={IC.check} s={big ? 16 : 13} c="#fff" w={2.8} />}</span>
            <span className="min-w-0 flex-1" style={{ fontSize: big ? 15.5 : 14.5, color: on ? '#2c5a40' : INK }}>{t}{ph && !url && <span className="block text-[12.5px]" style={{ color: BLUE }}>{busy === k ? 'Uploading the photo…' : 'Photo needed — tap to take it'}</span>}</span>
            {url && <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-[10px] object-cover" />}
          </button>; })}
      </div>)}
      {keys.length > 0 && done >= keys.length && <p className="flex items-center gap-2 rounded-[14px] px-3.5 py-3 text-[14px] font-medium" style={{ background: '#e9f3ed', color: GREEN }}><Ico d={IC.check} s={16} c={GREEN} w={2.4} />All done for today.</p>}
    </div>);
}

/** Do it with me: one step per screen, its photos big, and a timer that buzzes when it's up. */
function Walk({ d, steps, onClose, accent }: { d: any; steps: any[]; onClose: () => void; accent: string }) {
  const [i, setI] = React.useState(0); const s = steps[i] || {}; const isStep = s.type === 'step';
  const stepNo = steps.slice(0, i + 1).filter((x) => x.type === 'step').length;
  const [left, setLeft] = React.useState<number | null>(null); const [running, setRunning] = React.useState(false);
  React.useEffect(() => { setLeft(s.timerMin ? s.timerMin * 60 : null); setRunning(false); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!running || left === null) return; if (left <= 0) { setRunning(false); try { navigator.vibrate?.([300, 150, 300]); } catch { /* fine */ } return; } const t = setTimeout(() => setLeft((x) => (x === null ? x : x - 1)), 1000); return () => clearTimeout(t); }, [running, left]);
  const total = s.timerMin ? s.timerMin * 60 : 0; const mm = left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="-mx-4 -mt-2 flex min-h-[calc(100dvh-140px)] flex-col px-5 pb-28" style={{ color: INK }}>
      <div className="flex items-center gap-3 py-3"><button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: SOFT }}><Ico d={IC.back} s={18} /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-[12.5px]" style={{ color: MUTED }}>{d.title}</p><div className="mt-1.5 flex gap-1">{steps.map((_, k) => <span key={k} className="h-[5px] flex-1 rounded-full" style={{ background: k <= i ? INK : LINE }} />)}</div></div>
        <span className="text-[13px] font-semibold">{i + 1} of {steps.length}</span></div>
      <div className="flex flex-1 flex-col gap-4 pt-2">
        {isStep ? <><Images urls={s.images} big />
          <div className="flex items-start gap-3"><StepNum n={stepNo} size={32} /><p className="text-[27px] font-normal leading-tight tracking-[-0.03em]">{s.heading || `Step ${stepNo}`}</p></div>
          {s.body && <p className="whitespace-pre-wrap text-[16.5px] leading-relaxed" style={{ color: '#3c3e42' }}>{s.body}</p>}
          {total > 0 && <div className="flex items-center gap-4 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
            <div className="flex h-[84px] w-[84px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${accent} 0 ${left === null ? 0 : Math.round(((total - left) / total) * 100)}%, ${SOFT} 0)` }}><div className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-white text-[18px] font-bold tabular-nums">{left === 0 ? 'Done' : mm}</div></div>
            <div className="flex-1"><p className="text-[15px] font-semibold">{left === 0 ? 'Time’s up' : running ? 'Timing…' : `${s.timerMin} minute timer`}</p><p className="text-[13px]" style={{ color: MUTED }}>{left === 0 ? 'On to the next step.' : 'Your phone buzzes when it’s done.'}</p>
              {left !== 0 && <button type="button" onClick={() => setRunning((r) => !r)} className="mt-2 h-9 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>{running ? 'Pause' : left === total ? 'Start' : 'Resume'}</button>}</div></div>}
        </> : s.type === 'warning' || s.type === 'tip' ? <div className="pt-6"><Callout kind={s.type} heading={s.heading} body={s.body} /></div> : <DocBlocks sections={[s]} />}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg grid-cols-[1fr_1.6fr] gap-2 border-t bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3" style={{ borderColor: LINE }}>
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="h-14 rounded-full border bg-white text-[15px] disabled:opacity-40" style={{ borderColor: LINE }}>Back</button>
        <button type="button" onClick={() => (i < steps.length - 1 ? setI(i + 1) : onClose())} className="h-14 rounded-full text-[16px] font-semibold text-white" style={{ background: INK }}>{i < steps.length - 1 ? 'Next step' : 'Finished'}</button>
      </div>
    </div>);
}
