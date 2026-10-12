'use client';
// src/components/rent/MyDocuments.tsx — PART 6, a renter's own documents (design canvas row 26, "my own documents").
// Their SOPs and their clients' aftercare — private to them (the studio can't see these). Write them from a starter or
// from scratch with simple blocks (text, step, checklist, tip, warning); link aftercare to their services or make it the
// one for every other service; choose when it's sent and when to check in. /api/portal/renter-docs.
import * as React from 'react';
import { DocBlocks, Ico, IC } from '@/components/documents/DocBlocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318', PURPLE = '#7a4b8c', TEAL = '#2f6f6a';
const font = { color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' } as const;
const post = (body: any) => fetch('/api/portal/renter-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
const BLOCKS: Array<[string, string]> = [['text', 'Text'], ['step', 'Step'], ['checklist', 'Checklist'], ['tip', 'Tip'], ['warning', 'Warning']];
const rid = () => Math.random().toString(36).slice(2, 10);
const LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const DOC = '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>';

export function MyDocuments({ tenantId, token, booksHere }: { tenantId: string; token: string; booksHere: boolean }) {
  const [lib, setLib] = React.useState<any>(null); const [filter, setFilter] = React.useState<'all' | 'aftercare' | 'sop'>('all'); const [edit, setEdit] = React.useState<any>(null); const [picking, setPicking] = React.useState(false);
  const load = React.useCallback(() => post({ tenantId, token, action: 'list' }).then(setLib), [tenantId, token]);
  React.useEffect(() => { void load(); }, [load]);
  if (!lib) return null;
  if (!lib.ok) return <p className="text-[13.5px]" style={{ color: RED }}>{lib.error}</p>;
  if (edit) return <Editor tenantId={tenantId} token={token} start={edit} services={lib.services} booksHere={booksHere} onDone={() => { setEdit(null); void load(); }} />;
  const docs = (lib.docs as any[]).filter((d) => filter === 'all' || d.category === filter);
  const chip = (k: typeof filter, label: string) => <button type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={filter === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{label}</button>;
  const what = (d: any) => d.category === 'aftercare' ? `Aftercare · ${d.aftercareDefault ? 'every other service' : (d.serviceIds || []).map((id: string) => lib.services.find((x: any) => x.id === id)?.name).filter(Boolean).join(', ') || 'not linked yet'}` : `SOP · ${(d.sections || []).length} block${(d.sections || []).length === 1 ? '' : 's'}`;
  return (
    <section className="space-y-3" style={font} aria-label="My documents">
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>my business</p><h2 className="text-[24px] font-light tracking-[-0.02em]">My documents</h2></div>
      <p className="flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 text-[13px] leading-[1.45]" style={{ background: '#efe6f3', color: '#4d2d5a' }}><Ico d={LOCK} s={16} c={PURPLE} />These are yours. The studio can’t see them — only the building rules you sign.</p>
      <div className="flex flex-wrap gap-1.5">{chip('all', 'All')}{chip('aftercare', 'Aftercare')}{chip('sop', 'My SOPs')}</div>
      {docs.length > 0 && <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
        {docs.map((d, i) => <button key={d.id} type="button" onClick={() => setEdit(d.draft ? { ...d, ...d.draft } : d)} className="flex w-full items-center gap-3 px-4 py-3 text-left" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: d.category === 'aftercare' ? '#efe6f3' : '#e3efed' }}><Ico d={DOC} s={18} c={d.category === 'aftercare' ? PURPLE : TEAL} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{d.title}</span><span className="block truncate text-[12.5px]" style={{ color: MUTED }}>{what(d)}</span></span>
          {(d.status !== 'published' || d.draft) && <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: SOFT }}>{d.status === 'published' ? 'Unpublished changes' : 'Draft'}</span>}</button>)}
      </div>}
      {!docs.length && <p className="rounded-[18px] p-4 text-[14px]" style={{ background: SOFT, color: MUTED }}>{filter === 'aftercare' ? 'No aftercare yet — your clients get nothing after their visit until you add one.' : 'Nothing here yet. Start from one of ours and make it yours.'}</p>}
      {booksHere && <CareChoices tenantId={tenantId} token={token} care={lib.care} hasCare={(lib.docs as any[]).some((d) => d.category === 'aftercare' && d.status === 'published')} />}
      {!picking ? <button type="button" onClick={() => setPicking(true)} className="h-12 w-full rounded-full text-[15px] font-semibold text-white" style={{ background: INK }}>+ New document</button>
        : <div className="space-y-2 rounded-[18px] border bg-white p-3" style={{ borderColor: LINE }}>
          <p className="px-1 text-[13px]" style={{ color: MUTED }}>Start from</p>
          {(lib.starters as any[]).filter((t) => booksHere || t.category !== 'aftercare').map((t) => <button key={t.key} type="button" onClick={() => { setPicking(false); setEdit({ title: t.title, category: t.category, sections: t.sections.map((b: any) => ({ ...b, id: rid() })), serviceIds: [], aftercareDefault: t.category === 'aftercare' }); }} className="flex w-full items-center justify-between rounded-[12px] px-3 py-2.5 text-left text-[14.5px]" style={{ background: SOFT }}><span>{t.title}</span><span className="text-[12px]" style={{ color: MUTED }}>{t.category === 'aftercare' ? 'Aftercare' : 'SOP'}</span></button>)}
          <button type="button" onClick={() => { setPicking(false); setEdit({ title: '', category: 'sop', sections: [{ id: rid(), type: 'step', heading: '', body: '' }], serviceIds: [] }); }} className="w-full rounded-[12px] px-3 py-2.5 text-left text-[14.5px]" style={{ background: SOFT }}>A blank page</button>
          <button type="button" onClick={() => setPicking(false)} className="w-full py-1 text-[13px]" style={{ color: MUTED }}>Cancel</button></div>}
    </section>);
}

function CareChoices({ tenantId, token, care, hasCare }: { tenantId: string; token: string; care: any; hasCare: boolean }) {
  const [c, setC] = React.useState<any>(care); const [saved, setSaved] = React.useState('');
  const save = async (next: any) => { setC(next); setSaved(''); const r = await post({ tenantId, token, action: 'care', care: next }); setSaved(r.ok ? 'Saved' : r.error || 'That didn’t save.'); };
  const sel = 'h-10 rounded-[10px] border bg-white px-2 text-[14px]';
  return (<div className="space-y-2.5 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
    <div className="flex items-center justify-between"><p className="text-[15px] font-semibold">Sending aftercare to your clients</p><label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={c.on} onChange={(e) => save({ ...c, on: e.target.checked })} className="h-5 w-5" />On</label></div>
    {!hasCare && <p className="text-[13px]" style={{ color: MUTED }}>Publish an aftercare document first — then it goes out after each visit.</p>}
    <label className="flex items-center justify-between gap-2 text-[14px]"><span>Send it</span><select value={c.when} onChange={(e) => save({ ...c, when: e.target.value })} className={sel} style={{ borderColor: LINE }}><option value="checkout">About 10 minutes after checkout</option><option value="next_day">The next morning</option></select></label>
    <label className="flex items-center justify-between gap-2 text-[14px]"><span>Check in after</span><select value={String(c.checkInDays)} onChange={(e) => save({ ...c, checkInDays: Number(e.target.value) })} className={sel} style={{ borderColor: LINE }}><option value="0">No check-in</option><option value="2">2 days</option><option value="3">3 days</option><option value="7">7 days</option></select></label>
    <label className="flex items-center justify-between gap-2 text-[14px]"><span>Show what I used</span><input type="checkbox" checked={c.showProducts} onChange={(e) => save({ ...c, showProducts: e.target.checked })} className="h-5 w-5" /></label>
    <label className="flex items-center justify-between gap-2 text-[14px]"><span>Include my note for the client</span><input type="checkbox" checked={c.providerNote} onChange={(e) => save({ ...c, providerNote: e.target.checked })} className="h-5 w-5" /></label>
    {saved && <p className="text-[12.5px]" style={{ color: saved === 'Saved' ? GREEN : RED }}>{saved}</p>}
  </div>);
}

function Editor({ tenantId, token, start, services, booksHere, onDone }: { tenantId: string; token: string; start: any; services: any[]; booksHere: boolean; onDone: () => void }) {
  const [d, setD] = React.useState<any>({ ...start, sections: start.sections?.length ? start.sections : [{ id: rid(), type: 'step', heading: '', body: '' }] });
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [preview, setPreview] = React.useState(false); const [sure, setSure] = React.useState(false);
  const set = (patch: any) => setD((x: any) => ({ ...x, ...patch }));
  const setBlock = (i: number, patch: any) => setD((x: any) => ({ ...x, sections: x.sections.map((b: any, j: number) => (j === i ? { ...b, ...patch } : b)) }));
  const move = (i: number, by: number) => setD((x: any) => { const s = [...x.sections]; const j = i + by; if (j < 0 || j >= s.length) return x; [s[i], s[j]] = [s[j], s[i]]; return { ...x, sections: s }; });
  const save = async (publish: boolean) => { setBusy(publish ? 'pub' : 'save'); setErr(''); const r = await post({ tenantId, token, action: 'save', doc: d, publish }); setBusy(''); if (r.ok) onDone(); else setErr(r.error || 'That didn’t save.'); };
  const remove = async () => { setBusy('del'); const r = await post({ tenantId, token, action: 'remove', id: d.id }); setBusy(''); if (r.ok) onDone(); else setErr(r.error || 'That didn’t work.'); };
  const input = 'w-full rounded-[12px] border bg-white px-3 text-[14.5px]';
  const care = d.category === 'aftercare';
  return (
    <section className="space-y-4" style={font} aria-label="Edit document">
      <button type="button" onClick={onDone} className="flex items-center gap-1 text-[14px]" style={{ color: MUTED }}><Ico d={IC.back} s={16} />My documents</button>
      <div className="flex items-center justify-between"><h2 className="text-[24px] font-light tracking-[-0.02em]">{d.id ? 'Edit' : 'New'} {care ? 'aftercare' : 'SOP'}</h2>
        <button type="button" onClick={() => setPreview((p) => !p)} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT }}>{preview ? 'Edit' : 'Preview'}</button></div>
      {preview ? <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="pb-3 text-[20px] font-light">{d.title || 'Untitled'}</p><DocBlocks sections={d.sections.filter((b: any) => b.heading || b.body)} /></div> : <>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" aria-label="Title" className={`${input} h-12 text-[16px]`} style={{ borderColor: LINE }} />
        {booksHere && <div className="flex gap-1.5">{[['sop', 'SOP — for me'], ['aftercare', 'Aftercare — for clients']].map(([k, l]) => <button key={k} type="button" aria-pressed={d.category === k} onClick={() => set({ category: k })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={d.category === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div>}
        {d.sections.map((b: any, i: number) => (
          <div key={b.id || `b${i}`} className="space-y-2 rounded-[18px] border bg-white p-3" style={{ borderColor: LINE }}>
            <div className="flex items-center gap-1.5"><select value={b.type} onChange={(e) => setBlock(i, { type: e.target.value })} aria-label="Block type" className="h-9 rounded-[10px] border bg-white px-2 text-[13px]" style={{ borderColor: LINE }}>{BLOCKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <span className="flex-1" /><button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="h-9 w-9 rounded-full" style={{ background: SOFT }}>↑</button><button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="h-9 w-9 rounded-full" style={{ background: SOFT }}>↓</button>
              <button type="button" aria-label="Remove block" onClick={() => setD((x: any) => ({ ...x, sections: x.sections.filter((_: any, j: number) => j !== i) }))} className="h-9 w-9 rounded-full" style={{ background: SOFT, color: RED }}>×</button></div>
            <input value={b.heading} onChange={(e) => setBlock(i, { heading: e.target.value })} placeholder="Heading" aria-label="Heading" className={`${input} h-11`} style={{ borderColor: LINE }} />
            <textarea value={b.body} onChange={(e) => setBlock(i, { body: e.target.value })} rows={b.type === 'checklist' ? 4 : 3} placeholder={b.type === 'checklist' ? 'One item per line' : 'What to do, in plain words'} aria-label="Text" className={`${input} py-2.5`} style={{ borderColor: LINE }} />
          </div>))}
        <button type="button" onClick={() => setD((x: any) => ({ ...x, sections: [...x.sections, { id: rid(), type: 'step', heading: '', body: '' }] }))} className="h-11 w-full rounded-full border text-[14px]" style={{ borderColor: LINE }}>+ Add a block</button>
        {care && <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
          <p className="text-[15px] font-semibold">Which visits get it</p>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={!!d.aftercareDefault} onChange={(e) => set({ aftercareDefault: e.target.checked })} className="h-5 w-5" />Every service without its own aftercare</label>
          <div className="flex flex-wrap gap-1.5">{services.map((s: any) => { const on = (d.serviceIds || []).includes(s.id); return <button key={s.id} type="button" aria-pressed={on} onClick={() => set({ serviceIds: on ? d.serviceIds.filter((x: string) => x !== s.id) : [...(d.serviceIds || []), s.id] })} className="h-9 rounded-full px-3 text-[13px]" style={on ? { background: INK, color: '#fff' } : { background: SOFT }}>{s.name}</button>; })}</div>
          {!services.length && <p className="text-[13px]" style={{ color: MUTED }}>Add your services first to link aftercare to one.</p>}
          <label className="flex items-center justify-between gap-2 text-[14px]"><span>Check in after</span><select value={d.checkInDays === null || d.checkInDays === undefined ? '' : String(d.checkInDays)} onChange={(e) => set({ checkInDays: e.target.value === '' ? null : Number(e.target.value) })} className="h-10 rounded-[10px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }}><option value="">My usual choice</option><option value="0">No check-in</option><option value="2">2 days</option><option value="3">3 days</option><option value="7">7 days</option></select></label>
        </div>}
      </>}
      {err && <p className="text-[13.5px]" style={{ color: RED }}>{err}</p>}
      <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!!busy} onClick={() => save(false)} className="h-12 rounded-full border text-[15px]" style={{ borderColor: LINE }}>{busy === 'save' ? 'Saving…' : d.status === 'published' ? 'Save' : 'Save draft'}</button>
        <button type="button" disabled={!!busy} onClick={() => save(true)} className="h-12 rounded-full text-[15px] font-semibold text-white" style={{ background: INK }}>{busy === 'pub' ? 'Publishing…' : d.status === 'published' ? 'Publish changes' : 'Publish'}</button></div>
      {d.status === 'published' && <p className="text-[12.5px]" style={{ color: MUTED }}>Version {d.version || 1}. “Save” keeps your changes aside — clients get the live version until you publish them.</p>}
      {d.id && (!sure ? <button type="button" onClick={() => setSure(true)} className="w-full py-2 text-[13.5px]" style={{ color: RED }}>Delete this document</button>
        : <button type="button" disabled={!!busy} onClick={remove} className="h-11 w-full rounded-full text-[14px] font-semibold text-white" style={{ background: RED }}>{busy === 'del' ? 'Deleting…' : 'Yes, delete it'}</button>)}
    </section>);
}
