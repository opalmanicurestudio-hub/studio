'use client';
// src/components/academy/SchoolDocs.tsx
//
// SCHOOL DOCUMENTS (Set up → School documents)
//   Documents   ＋ New: handbook / policies (✨ AI draft from the school's facts),
//               syllabus (built from a course — no AI), blank. Editor with live
//               preview; [[fill in]] markers highlighted and required before
//               publishing; Publish (versioned) · Print · Signatures.
//   Printables  name tags (QR to the student portal) · product & dilution labels ·
//               station labels · signs (editable wording — check it against your
//               own procedures before printing).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import QRCode from 'qrcode';
import { deviceId } from '@/lib/device';
import { printDocument, heading, esc, mdLite } from '@/lib/doc-theme';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const holes = (t: string) => (String(t || '').match(/\[\[[^\]]*\]\]/g) || []).length;

export function SchoolDocs({ tenantId, brand, courses }: { tenantId: string; brand: any; courses: any[] }) {
  const [tab, setTab] = useState<'docs' | 'print'>('docs');
  return (
    <div className="space-y-4">
      <div className="flex gap-1">{([['docs', 'Documents'], ['print', 'Printables']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
      {tab === 'docs' ? <Docs tenantId={tenantId} brand={brand} courses={courses} /> : <Printables tenantId={tenantId} brand={brand} courses={courses} />}
    </div>
  );
}

function Docs({ tenantId, brand, courses }: any) {
  const [d, setD] = useState<any>(null); const [pick, setPick] = useState(false); const [edit, setEdit] = useState<any>(null);
  const load = useCallback(async () => { const r = await api({ action: 'docs-list', tenantId }); if (r.ok) setD(r); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (edit) return <Editor tenantId={tenantId} brand={brand} value={edit} onClose={async () => { setEdit(null); await load(); }} />;
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setPick(true)} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">＋ New document</button>
      {d.docs.length === 0 ? <p className="rounded-3xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Create your student handbook, policies and syllabi here. Publish them and students read and sign in their portal — signatures go straight into each student’s file.</p> :
        d.docs.map((x: any) => (
          <button key={x.id} type="button" onClick={async () => { const r = await api({ action: 'doc-get', tenantId, id: x.id }); if (r.ok) setEdit(r.doc); }} className="flex w-full items-center gap-3 rounded-2xl border-2 border-border/60 p-3 text-left hover:bg-muted/30">
            <span className="text-2xl">{x.kind === 'handbook' ? '📘' : x.kind === 'syllabus' ? '🗒' : x.kind === 'catalogue' ? '📗' : '📄'}</span>
            <span className="min-w-0 flex-1"><b className="block truncate">{x.title}</b><span className="text-[12px] text-muted-foreground">{x.requireAck ? 'Students sign · ' : ''}updated {new Date(x.updatedAt).toLocaleDateString()}</span></span>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${x.status !== 'published' ? 'bg-muted' : x.changed ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{x.status !== 'published' ? 'Draft' : x.changed ? 'Unpublished changes' : `Published v${x.version}`}</span>
          </button>
        ))}
      {pick && <NewDoc tenantId={tenantId} kinds={d.kinds} courses={courses} onClose={() => setPick(false)} onReady={(doc: any) => { setPick(false); setEdit(doc); }} />}
    </div>
  );
}

function NewDoc({ tenantId, kinds, courses, onClose, onReady }: any) {
  const [kind, setKind] = useState<string | null>(null); const [notes, setNotes] = useState(''); const [courseId, setCourseId] = useState(courses[0]?.id || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const k = kinds.find((x: any) => x.key === kind);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl">
        <p className="text-xl font-black">New document</p>
        {!kind ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setKind('syllabus')} className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3 text-left"><span className="text-2xl">🗒</span><b className="block">Syllabus</b><span className="text-[12px] text-muted-foreground">Built from a course — free</span></button>
            {kinds.filter((x: any) => x.key !== 'custom').map((x: any) => <button key={x.key} type="button" onClick={() => setKind(x.key)} className="rounded-2xl border-2 border-border/60 p-3 text-left"><span className="text-2xl">{x.key === 'handbook' ? '📘' : x.key === 'catalogue' ? '📗' : '📄'}</span><b className="block">{x.title}</b><span className="text-[12px] text-muted-foreground">✨ AI draft{x.ack ? ' · students sign' : ''}</span></button>)}
            <button type="button" onClick={() => onReady({ kind: 'custom', title: '', body: '', requireAck: false })} className="rounded-2xl border-2 border-dashed p-3 text-left"><span className="text-2xl">✦</span><b className="block">Blank document</b><span className="text-[12px] text-muted-foreground">Write your own</span></button>
          </div>
        ) : kind === 'syllabus' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Built straight from the course — modules, lessons, time, objectives from your lesson plans, graded work and the grading scale.</p>
            <select className={field} value={courseId} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
            {err && <p className="text-sm text-red-700">{err}</p>}
            <button type="button" disabled={busy || !courseId} onClick={async () => { setBusy(true); const r = await api({ action: 'doc-syllabus', tenantId, courseId }); setBusy(false); if (r.ok) onReady({ kind: 'syllabus', courseId, title: r.title, body: r.body, requireAck: false }); else setErr(r.error); }} className="h-12 w-full rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-50">{busy ? 'Building…' : 'Build the syllabus'}</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Claude drafts your <b>{k?.title.toLowerCase()}</b> from your school’s details (name, programs, hours, grading). Anything it doesn’t know is marked <mark className="rounded bg-amber-100 px-1">[fill in]</mark> for you.</p>
            <textarea rows={4} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to include? (optional) — e.g. We’re closed Mondays. Students must wear black scrubs. Late = more than 10 minutes." />
            {err && <p className="text-sm text-red-700">{err}</p>}
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'doc-ai', tenantId, kind, notes }); setBusy(false); if (r.ok) onReady({ kind, title: r.title, body: r.body, requireAck: !!k?.ack }); else setErr(r.error); }} className="h-12 w-full rounded-xl bg-violet-700 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Drafting… (up to a minute)' : '✨ Draft it'}</button>
            <p className="text-[11px] text-muted-foreground">About 4 AI credits. A draft to start from, not legal advice — check it against your state board’s requirements before publishing.</p>
          </div>
        )}
        <button type="button" onClick={kind ? () => setKind(null) : onClose} className="w-full text-sm font-bold text-muted-foreground">{kind ? '‹ Back' : 'Cancel'}</button>
      </div>
    </div>
  );
}

function Editor({ tenantId, brand, value, onClose }: any) {
  const [x, setX] = useState<any>(value); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [view, setView] = useState<'write' | 'preview'>('write'); const [acks, setAcks] = useState<any>(null);
  const n = holes(x.body); const html = useMemo(() => mdLite(x.body || ''), [x.body]);
  const save = async () => { setBusy('save'); const r = await api({ action: 'doc-save', tenantId, doc: x }); setBusy(''); if (r.ok) { setX({ ...x, id: r.id }); setMsg('Saved.'); return r.id; } setMsg(r.error); return null; };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:px-4">
        <button type="button" onClick={onClose} className="h-10 rounded-xl px-2 text-sm font-bold text-muted-foreground">‹ Back</button>
        <p className="min-w-0 flex-1 truncate font-black">{x.title || 'Untitled'}</p>
        <button type="button" onClick={() => printDocument({ title: x.title, brand, body: `${heading('', x.title)}${mdLite(x.body)}` })} className="h-10 rounded-xl border-2 px-3 text-sm font-bold">Print</button>
        <button type="button" disabled={!!busy} onClick={save} className="h-10 rounded-xl border-2 px-3 text-sm font-bold disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={!!busy || n > 0} onClick={async () => { const id = await save(); if (!id) return; setBusy('pub'); const r = await api({ action: 'doc-publish', tenantId, id }); setBusy(''); setMsg(r.ok ? `Published as version ${r.version}${x.requireAck ? ' — students will be asked to read and sign it in their portal.' : '.'}` : r.error); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-40" title={n ? 'Fill in the highlighted parts first' : ''}>{busy === 'pub' ? 'Publishing…' : 'Publish'}</button>
      </div>
      <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input className={field} value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} placeholder="Title" />
          <label className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 text-sm font-bold"><input type="checkbox" checked={!!x.requireAck} onChange={(e) => setX({ ...x, requireAck: e.target.checked })} />Students must read and sign</label></div>
        {msg && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900" onClick={() => setMsg('')}>{msg}</p>}
        {n > 0 && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><b>{n} part{n === 1 ? '' : 's'} to fill in</b> — replace each <mark className="rounded bg-amber-100 px-1">[[fill in: …]]</mark> with your school’s details. Publishing unlocks when they’re all done.</p>}
        <div className="flex gap-1 lg:hidden">{([['write', 'Write'], ['preview', 'Preview']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`h-9 rounded-full px-4 text-sm font-bold ${view === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={view === 'preview' ? 'hidden lg:block' : ''}><textarea value={x.body} onChange={(e) => setX({ ...x, body: e.target.value })} className="h-[70vh] w-full rounded-2xl border-2 border-border/60 bg-background p-4 text-[14px] leading-relaxed" placeholder={'# Section heading\nWrite in plain sentences.\n- A bullet point\n**Bold** for emphasis'} /><p className="mt-1 text-[11px] text-muted-foreground"># heading · ## sub-heading · - bullet · **bold** · [[fill in: …]] marks something to complete</p></div>
          <div className={`h-[70vh] overflow-y-auto rounded-2xl border-2 border-border/60 bg-white p-5 text-[14px] leading-relaxed [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-black [&_h3]:mt-3 [&_h3]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:my-1.5 ${view === 'write' ? 'hidden lg:block' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        {x.id && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={async () => { const r = await api({ action: 'doc-acks', tenantId, id: x.id }); if (r.ok) setAcks(r); }} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Signatures</button>
          <button type="button" onClick={async () => { if (!window.confirm(`Delete “${x.title}”? Signatures already given stay in students’ files.`)) return; await api({ action: 'doc-delete', tenantId, id: x.id }); onClose(); }} className="h-10 rounded-xl px-4 text-sm font-bold text-red-700">Delete</button></div>}
        {acks && <div className="space-y-1 rounded-2xl bg-muted/40 p-3"><p className="text-sm font-black">Version {acks.version} · {acks.rows.filter((r: any) => r.signedAt).length} of {acks.rows.length} signed</p>
          <div className="max-h-64 space-y-1 overflow-y-auto">{acks.rows.map((r: any) => <p key={r.studentId} className="flex justify-between text-sm"><span>{r.signedAt ? '✓' : '○'} {r.name}</span><span className="text-[12px] text-muted-foreground">{r.signedAt ? `“${r.signedName}” · ${new Date(r.signedAt).toLocaleDateString()}` : 'not yet'}</span></p>)}</div></div>}
      </div>
    </div>
  );
}

// ── Printables ─────────────────────────────────────────────────────────────
const SIGNS: Record<string, { title: string; text: string }> = {
  hands: { title: 'Wash your hands', text: '1. Wet hands with clean running water\n2. Apply soap\n3. Lather all surfaces — backs of hands, between fingers, under nails\n4. Scrub for at least 20 seconds\n5. Rinse well\n6. Dry with a single-use towel' },
  station: { title: 'Infection control station', text: 'Clean, then disinfect, every implement between clients.\nFollow the disinfectant label for mixing and contact time.\nStore disinfected implements in a clean, covered container.\nSingle-use items: use once, then discard.' },
  bins: { title: 'Implements', text: 'DIRTY — used, waiting to be cleaned\nCLEAN — washed, ready to disinfect\nDISINFECTED — ready for the next client' },
  blood: { title: 'Blood exposure', text: 'Stop the service.\nPut on gloves.\nFollow the school’s blood exposure procedure posted at this station.\nDispose of contaminated items as directed.\nTell your instructor.' },
};
function Printables({ tenantId, brand, courses }: any) {
  const [kind, setKind] = useState<'tags' | 'labels' | 'stations' | 'signs'>('tags');
  const [people, setPeople] = useState<{ name: string; sub: string }[]>([]); const [picked, setPicked] = useState<Set<number>>(new Set());
  const [stations, setStations] = useState('Station 1\nStation 2\nDispensary\nPedicure station'); const [sign, setSign] = useState('hands'); const [signText, setSignText] = useState(SIGNS.hands.text); const [signTitle, setSignTitle] = useState(SIGNS.hands.title);
  useEffect(() => { (async () => { const all = new Map<string, any>(); for (const c of courses) { const r = await api({ action: 'assign-options', tenantId, courseId: c.id }); for (const s of r.students || []) if (!all.has(s.id)) all.set(s.id, { name: s.name, sub: c.title }); } const list = [...all.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))); setPeople(list); setPicked(new Set(list.map((_, i) => i))); })(); }, [tenantId, courses]);
  useEffect(() => { setSignText(SIGNS[sign].text); setSignTitle(SIGNS[sign].title); }, [sign]);
  const color = brand?.color || '#1c1917';
  const printTags = async () => {
    const portal = `${window.location.origin}/learn/${tenantId}/my`; const qr = await QRCode.toDataURL(portal, { margin: 0, width: 160 });
    const who = people.filter((_, i) => picked.has(i));
    const cards = who.map((p) => `<div style="border:2px solid ${esc(color)};border-radius:14px;padding:12px;display:flex;gap:10px;align-items:center;break-inside:avoid;height:170px"><div style="flex:1;min-width:0"><div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#78716c">${esc(brand?.name || '')}</div><div style="font-size:24px;font-weight:600;line-height:1.1;margin:4px 0">${esc(String(p.name).split(' ')[0])}</div><div style="font-size:13px">${esc(p.name)}</div><div style="font-size:11px;color:#78716c;margin-top:4px">Student · ${esc(p.sub)}</div></div><img src="${qr}" style="width:74px;height:74px"></div>`).join('');
    printDocument({ title: 'Name tags', brand, body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${cards}</div>`, footerNote: 'The QR code opens the student portal.' });
  };
  const printLabels = () => printDocument({ title: 'Product labels', brand, body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${Array.from({ length: 10 }, () => `<div style="border:1.5px solid #1c1917;border-radius:10px;padding:10px;font-size:12px;break-inside:avoid">${['Product', 'Dilution', 'Date mixed', 'Discard by', 'Initials'].map((l) => `<div style="display:flex;gap:6px;margin:6px 0"><b style="width:80px">${l}</b><span style="flex:1;border-bottom:1px solid #a8a29e"></span></div>`).join('')}</div>`).join('')}</div>`, footerNote: 'Mix and discard according to the product label.' });
  const printStations = () => printDocument({ title: 'Station labels', brand, body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${stations.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => `<div style="border:3px solid ${esc(color)};border-radius:18px;padding:26px 14px;text-align:center;font-size:30px;font-weight:600;break-inside:avoid">${esc(s)}</div>`).join('')}</div>` });
  const printSign = () => printDocument({ title: signTitle, brand, body: `<div style="border:4px solid ${esc(color)};border-radius:28px;padding:36px 30px;min-height:80vh"><h1 style="font-size:48px;margin:0 0 20px">${esc(signTitle)}</h1>${signText.split('\n').map((l) => `<p style="font-size:24px;line-height:1.45;margin:10px 0">${esc(l)}</p>`).join('')}</div>` });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([['tags', '🏷', 'Name tags'], ['labels', '🧴', 'Product labels'], ['stations', '🪧', 'Station labels'], ['signs', '🧼', 'Signs']] as const).map(([k, i, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-2xl p-3 text-left ${kind === k ? 'bg-foreground text-background' : 'bg-muted/40'}`}><span className="text-2xl">{i}</span><b className="block text-sm">{l}</b></button>)}</div>
      {kind === 'tags' && <div className="space-y-2"><p className="text-sm text-muted-foreground">8 per page — first name large, full name, course, and a QR code to the student portal.</p>
        {people.length === 0 ? <p className="text-sm text-muted-foreground">No enrolled students yet.</p> : <div className="max-h-60 space-y-1 overflow-y-auto rounded-2xl bg-muted/30 p-2">{people.map((p, i) => <label key={i} className="flex items-center gap-2 rounded-xl px-2 py-1 text-sm"><input type="checkbox" checked={picked.has(i)} onChange={() => { const s = new Set(picked); if (s.has(i)) s.delete(i); else s.add(i); setPicked(s); }} />{p.name}</label>)}</div>}
        <button type="button" disabled={!picked.size} onClick={printTags} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">Print {picked.size} name tag{picked.size === 1 ? '' : 's'}</button></div>}
      {kind === 'labels' && <div className="space-y-2"><p className="text-sm text-muted-foreground">10 fill-in labels per page: product, dilution, date mixed, discard by, initials.</p><button type="button" onClick={printLabels} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Print labels</button></div>}
      {kind === 'stations' && <div className="space-y-2"><textarea rows={5} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={stations} onChange={(e) => setStations(e.target.value)} /><p className="text-[11px] text-muted-foreground">One station per line.</p><button type="button" onClick={printStations} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Print station labels</button></div>}
      {kind === 'signs' && <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">{Object.entries(SIGNS).map(([k, v]) => <button key={k} type="button" onClick={() => setSign(k)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${sign === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{v.title}</button>)}</div>
        <input className={field} value={signTitle} onChange={(e) => setSignTitle(e.target.value)} /><textarea rows={7} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={signText} onChange={(e) => setSignText(e.target.value)} />
        <p className="rounded-xl bg-amber-50 p-2 text-[12px] text-amber-900">General wording to start from — check it matches your school’s procedures and product instructions before printing.</p>
        <button type="button" onClick={printSign} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Print sign</button></div>}
    </div>
  );
}
