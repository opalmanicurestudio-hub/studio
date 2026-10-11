'use client';
// src/components/documents/TrainingRecord.tsx — DOCUMENTS → TRAINING RECORD (approved design, canvas row 22): who has
// signed what. A grid of published documents × the team: signed this version, signed an older one, due soon, overdue,
// not theirs. Tap a square for when they signed, their quick-check score and signature. From here: a proof-of-training
// page for any document (print or save as PDF), and read-only links for an inspector that expire (lib/training-proof).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { collectionsOf, collectionFor, reviewDue, assignedPeople } from '@/lib/doc-collections';
import { Acks } from '@/components/documents/DocsLibrary';
import { Ico, IC } from '@/components/documents/DocBlocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#3d5a99';
const card = 'rounded-[18px] border bg-white';
type Cell = 'signed' | 'older' | 'soon' | 'overdue' | 'todo' | 'none';
const CELL: Record<Cell, { bg: string; fg: string; label: string }> = { signed: { bg: '#e9f3ed', fg: GREEN, label: 'Signed this version' }, older: { bg: '#e6ecf7', fg: BLUE, label: 'Signed an older version' }, soon: { bg: '#fdf3e6', fg: AMBER, label: 'Due soon' }, overdue: { bg: '#fdecec', fg: RED, label: 'Overdue' }, todo: { bg: '#fff', fg: MUTED, label: 'Not signed yet' }, none: { bg: SOFT, fg: MUTED, label: 'Not theirs' } };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function Square({ s, older }: { s: Cell; older?: number }) {
  const c = CELL[s];
  return <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px]" style={{ background: c.bg, border: s === 'todo' ? `1.5px dashed #c9cacf` : undefined }}>
    {s === 'signed' ? <Ico d={IC.check} s={13} c={GREEN} w={2.6} /> : s === 'older' ? <span className="text-[10px] font-extrabold" style={{ color: BLUE }}>v{older}</span> : s === 'soon' ? <span className="h-[7px] w-[7px] rounded-full" style={{ background: AMBER }} /> : s === 'overdue' ? <span className="text-[12px] font-extrabold" style={{ color: RED }}>!</span> : null}</span>;
}

export function TrainingRecord({ tenantId, tenant, docs, staff, today, onOpenDoc }: { tenantId: string; tenant: any; docs: any[]; staff: any[]; today: string; onOpenDoc: (id: string) => void }) {
  const live = docs.filter((d) => d.status === 'published');
  const people = (staff || []).filter((m: any) => !m.archived && m.role !== 'renter' && !m.isRenter).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const [acks, setAcks] = React.useState<Record<string, any[]>>({});
  const onAcks = React.useCallback((id: string, a: any[]) => setAcks((p) => (p[id] === a ? p : { ...p, [id]: a })), []);
  const [pick, setPick] = React.useState<{ doc: string; person: string } | null>(null);
  const [proofDoc, setProofDoc] = React.useState(''); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [inspOpen, setInspOpen] = React.useState(false);
  const cols = collectionsOf(tenant);
  const cell = (d: any, p: any): { s: Cell; a: any } => {
    const forThem = assignedPeople(d, [p]).length > 0; const a = (acks[d.id] || []).find((x) => x.id === p.id) || null; const v = Number(d.version || 1);
    if (!forThem) return { s: 'none', a };
    if (a && Number(a.version) === v) return { s: 'signed', a };
    if (d.signBy && d.signBy < today) return { s: 'overdue', a };
    if (d.signBy && d.signBy <= addDays(today, 3)) return { s: 'soon', a };
    return { s: a ? 'older' : 'todo', a };
  };
  const all = live.flatMap((d) => people.map((p) => cell(d, p).s)).filter((s) => s !== 'none');
  const upToDate = all.length ? Math.round((all.filter((s) => s === 'signed').length / all.length) * 100) : 100;
  const reviews = live.filter((d) => { const r = reviewDue(d); return r && r.slice(0, 7) <= today.slice(0, 7); }).length;
  const proof = async () => { if (!proofDoc) return; setBusy('proof'); setMsg(''); const r = await payPost('/api/documents/links', { tenantId, action: 'proof', documentId: proofDoc }); setBusy('');
    if (r.ok) window.open(r.path, '_blank', 'noopener'); else setMsg(r.error || 'That didn’t work.'); };
  const sel = pick ? { d: live.find((x) => x.id === pick.doc), p: people.find((x: any) => x.id === pick.person) } : null; const selCell = sel?.d && sel.p ? cell(sel.d, sel.p) : null;

  return (
    <div className="space-y-4" style={{ color: INK }}>
      {live.map((d) => <Acks key={d.id} tenantId={tenantId} id={d.id} onAcks={onAcks} />)}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>training record</p><h2 className="text-[26px] font-normal tracking-[-0.03em]">Who has signed what</h2></div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={proofDoc} onChange={(e) => setProofDoc(e.target.value)} aria-label="Document for the proof of training" className="h-11 max-w-[240px] rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }}><option value="">Proof of training for…</option>{live.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
          <button type="button" disabled={!proofDoc || busy === 'proof'} onClick={proof} className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}><Ico d='<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>' s={16} c="#fff" />{busy === 'proof' ? 'Making it…' : 'Open the PDF page'}</button>
          <button type="button" onClick={() => setInspOpen((v) => !v)} aria-expanded={inspOpen} className="h-11 rounded-full border bg-white px-5 text-[14px] font-medium" style={{ borderColor: LINE }}>Share with an inspector</button>
        </div>
      </div>
      {msg && <p className="text-[13.5px]" style={{ color: RED }}>{msg}</p>}
      {inspOpen && <InspectorLinks tenantId={tenantId} cols={cols} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Signed and up to date', `${upToDate}%`, INK], ['Overdue', all.filter((s) => s === 'overdue').length, RED], ['Signed an older version', all.filter((s) => s === 'older').length, BLUE], ['Reviews due this month', reviews, AMBER]].map(([a, b, c]) =>
          <div key={String(a)} className={`${card} p-4`} style={{ borderColor: LINE }}><p className="text-[13px]" style={{ color: MUTED }}>{a}</p><p className="text-[28px] font-normal tracking-[-0.03em]" style={{ color: Number(b) || String(b).includes('%') ? String(c) : INK }}>{b}</p></div>)}
      </div>
      {!live.length || !people.length ? <p className={`${card} p-6 text-[14.5px]`} style={{ borderColor: LINE, color: MUTED }}>Publish a document and it shows here with everyone it’s for.</p> :
        <div className={`${card} overflow-x-auto`} style={{ borderColor: LINE }}>
          <table className="w-full border-collapse text-[14px]">
            <thead><tr><th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[12.5px] font-normal" style={{ color: MUTED }}>Document</th>{people.map((p: any) => <th key={p.id} className="min-w-[72px] px-1 py-3 text-center text-[12px] font-normal" style={{ color: MUTED }}>{String(p.name || '').split(' ')[0]}{String(p.name || '').split(' ')[1] ? ` ${String(p.name).split(' ')[1][0]}.` : ''}</th>)}</tr></thead>
            <tbody>{live.map((d) => { const c = collectionFor(d, cols);
              return <tr key={d.id} className="border-t" style={{ borderColor: LINE }}>
                <th scope="row" className="sticky left-0 z-10 max-w-[260px] bg-white px-4 py-2.5 text-left font-normal"><button type="button" onClick={() => onOpenDoc(d.id)} className="text-left"><span className="block truncate text-[14px] font-semibold">{d.title}</span><span className="block text-[12px]" style={{ color: c.color }}>{c.name} · v{d.version || 1}</span></button></th>
                {people.map((p: any) => { const x = cell(d, p); const on = pick?.doc === d.id && pick?.person === p.id;
                  return <td key={p.id} className="px-1 py-2 text-center"><button type="button" disabled={x.s === 'none'} aria-label={`${p.name}: ${CELL[x.s].label}`} onClick={() => setPick(on ? null : { doc: d.id, person: p.id })} className="rounded-[10px] p-0.5" style={{ outline: on ? `2px solid ${INK}` : undefined }}><Square s={x.s} older={x.a?.version} /></button></td>; })}
              </tr>; })}</tbody>
          </table>
        </div>}
      {sel?.d && sel.p && selCell && <div className={`${card} flex flex-wrap items-center gap-4 p-4`} style={{ borderColor: LINE }}>
        <Square s={selCell.s} older={selCell.a?.version} />
        <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{sel.p.name} · {sel.d.title}</p>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{CELL[selCell.s].label}{selCell.a ? ` · signed v${selCell.a.version} on ${new Date(selCell.a.acknowledgedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}{selCell.a?.quiz ? ` · quick check ${selCell.a.quiz.right}/${selCell.a.quiz.total}` : ''}{!selCell.a && sel.d.signBy ? ` · due ${new Date(`${sel.d.signBy}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}</p></div>
        {selCell.a?.signatureUrl && <img src={selCell.a.signatureUrl} alt={`${sel.p.name} signature`} className="h-12 w-36 rounded-[8px] border object-contain" style={{ borderColor: LINE }} />}
      </div>}
      <div className="flex flex-wrap gap-x-4 gap-y-2">{(['signed', 'older', 'soon', 'overdue', 'todo', 'none'] as Cell[]).map((s) => <span key={s} className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: MUTED }}><Square s={s} older={2} />{CELL[s].label}</span>)}</div>
    </div>);
}

function InspectorLinks({ tenantId, cols }: { tenantId: string; cols: Array<{ id: string; name: string }> }) {
  const [chosen, setChosen] = React.useState<string[]>(cols.filter((c) => c.id === 'safety').map((c) => c.id));
  const [hours, setHours] = React.useState(8); const [note, setNote] = React.useState(''); const [links, setLinks] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [copied, setCopied] = React.useState('');
  const load = React.useCallback(async () => { const r = await payPost('/api/documents/links', { tenantId, action: 'inspector-list' }); if (r.ok) setLinks(r.links || []); }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  const make = async () => { setBusy(true); setErr(''); const r = await payPost('/api/documents/links', { tenantId, action: 'inspector-create', hours, collections: chosen, note }); setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t work.'); return; } const url = `${window.location.origin}${r.link.path}`; try { await navigator.clipboard.writeText(url); setCopied(r.link.id); } catch { /* shown below */ } setNote(''); void load(); };
  const off = async (id: string) => { await payPost('/api/documents/links', { tenantId, action: 'inspector-revoke', id }); void load(); };
  const now = Date.now();
  return (
    <div className={`${card} space-y-3 p-4`} style={{ borderColor: LINE }}>
      <div><p className="text-[15px] font-bold">A read-only link for an inspector</p><p className="text-[13.5px]" style={{ color: MUTED }}>They see your current procedures in the collections you pick, how many of the team are trained on each, and this month’s sterilization log. Nothing else, and only until it expires.</p></div>
      <div className="flex flex-wrap gap-1.5">{cols.map((c) => { const on = chosen.includes(c.id); return <button key={c.id} type="button" aria-pressed={on} onClick={() => setChosen((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))} className="h-9 rounded-full px-3.5 text-[13.5px] font-medium" style={on ? { background: INK, color: '#fff' } : { background: SOFT }}>{c.name}</button>; })}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="How long the link works" className="h-11 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }}>{[[4, 'Works for 4 hours'], [8, 'Works for 8 hours'], [24, 'Works for a day'], [72, 'Works for 3 days'], [168, 'Works for a week']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Who it’s for (optional) — e.g. State board, Oct visit" aria-label="Who it’s for" className="h-11 min-w-[220px] flex-1 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }} />
        <button type="button" disabled={busy || !chosen.length} onClick={make} className="h-11 rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Making it…' : 'Make the link'}</button>
      </div>
      {err && <p className="text-[13.5px]" style={{ color: RED }}>{err}</p>}
      {links && links.length > 0 && <div className="border-t pt-2" style={{ borderColor: LINE }}>{links.map((l) => { const expired = Date.parse(l.expiresAt) < now; const state = l.revokedAt ? 'Turned off' : expired ? 'Expired' : `Open until ${new Date(l.expiresAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
        return <div key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-[13.5px]">
          <span className="min-w-0 flex-1"><b className="font-semibold">{l.note || 'Inspector link'}</b><span className="block text-[12.5px]" style={{ color: MUTED }}>{state} · opened {l.views?.length || 0} time{(l.views?.length || 0) === 1 ? '' : 's'} · by {String(l.createdBy || '').split(' ')[0]}</span></span>
          {!l.revokedAt && !expired && <><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${l.path}`); setCopied(l.id); } catch { window.prompt('Copy this link', `${window.location.origin}${l.path}`); } }} className="h-9 rounded-full px-3.5" style={{ background: SOFT }}>{copied === l.id ? 'Copied' : 'Copy link'}</button>
            <a href={l.path} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full px-3.5" style={{ background: SOFT }}>Open</a>
            <button type="button" onClick={() => off(l.id)} className="h-9 rounded-full px-3.5" style={{ background: SOFT, color: RED }}>Turn off</button></>}
        </div>; })}</div>}
    </div>);
}
