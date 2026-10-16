'use client';
// src/components/documents/DocEditor.tsx — WRITING A DOCUMENT (approved design, canvas row 22 "Editor"). Blocks on the
// left — steps with photos and a timer, checklists with photo lines, warnings, tips, photos and videos — added from one
// bar and moved or removed in place. Details on the right: collection, owner, review cycle, who it's for, sign-by and
// reminder, the quick check before signing, whether to draw a signature, where it shows up during work (services, steps,
// stations, kits — DocLinksEditor) and (for a live document) what changed.
// A live document's edits are saved as its draft; Publish sends them out as the next version (documents page handleSave).
import * as React from 'react';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';
import { uploadImage } from '@/lib/upload-image';
import { BLOCKS, blocksFor, MAX_BLOCKS, MAX_IMAGES, cleanBlock, blockHasContent, blockLabel, cleanQuiz, type BlockType } from '@/lib/doc-blocks';
import { withItemIds, checklistLines } from '@/lib/doc-items';
import { collectionsOf, collectionFor } from '@/lib/doc-collections';
import { rolesFor } from '@/lib/permissions';
import { Cover } from '@/components/documents/DocsLibrary';
import { DocBlocks, Ico, IC } from '@/components/documents/DocBlocks';
import { DocLinksEditor } from '@/components/documents/DocLinksEditor';
import { cleanLinks } from '@/lib/doc-links';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', BLUE = '#3d5a99', RED = '#b42318';
const input = 'h-11 w-full rounded-[12px] border bg-card px-3 text-[14.5px] outline-none focus:border-[#16171a]';
const area = 'w-full rounded-[12px] border bg-card px-3 py-2.5 text-[14.5px] leading-relaxed outline-none focus:border-[#16171a]';
const PH: Record<string, [string, string]> = {
  text: ['Heading', 'Write it the way you’d explain it to a new person.'], step: ['What to do', 'How to do it, in a sentence or two.'],
  checklist: ['Checklist name', 'One item per line\nLights off\nAutoclave ran'], warning: ['What must not happen', 'Why, and what to do instead.'],
  tip: ['A helpful extra', 'The trick that makes it easier.'], normal: ['What’s normal', 'One per line\nA little warmth for a few hours\nCuticles a bit dry the next day'], callus: ['Let us know if', 'One per line\nRedness or swelling past tomorrow\nLifting before day 7'], photo: ['Title (optional)', 'Caption'], video: ['Title (optional)', 'What it shows'],
};
const ADD_ICON: Record<string, string> = { normal: IC.check, callus: IC.warn,  step: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', checklist: IC.check, warning: IC.warn, tip: IC.tip, photo: IC.cam, video: IC.play, text: '<path d="M5 6h14M5 12h14M5 18h9"/>' };

function Side({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2 border-t py-3.5" style={{ borderColor: LINE }}><p className="text-[12.5px]" style={{ color: MUTED }}>{title}</p>{children}</div>;
}
function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className="h-9 rounded-full px-3.5 text-[13.5px] font-medium" style={on ? { background: INK, color: 'hsl(var(--background))' } : { background: SOFT, color: INK }}>{children}</button>;
}

export function DocEditor({ tenantId, docItem: liveItem, staff, onSave, onPublish, onDelete, onClose }: { tenantId: string; docItem: any; staff: any[]; onSave: (d: any) => void; onPublish: (d: any) => void; onDelete: () => void; onClose: () => void }) {
  const docItem = liveItem.draft ? { ...liveItem, ...liveItem.draft } : liveItem;
  const isLive = liveItem.status === 'published';
  const { selectedTenant } = useTenant() as any;
  const cols = collectionsOf(selectedTenant);
  const roles = Object.entries(rolesFor(selectedTenant)).filter(([id]) => id !== 'owner' && id !== 'renter');
  const [title, setTitle] = React.useState<string>(docItem.title || '');
  const [category, setCategory] = React.useState<string>(docItem.category || 'sop');
  const [blocks, setBlocks] = React.useState<any[]>(docItem.sections?.length ? docItem.sections : [{ id: nanoid(), type: 'step', heading: '', body: '' }]);
  const [collectionId, setCollectionId] = React.useState<string>(collectionFor(docItem, cols).id);
  const [ownerId, setOwnerId] = React.useState<string>(docItem.ownerId || '');
  const [reviewEvery, setReviewEvery] = React.useState<number>(Number(docItem.reviewEveryMonths) || 0);
  const [assignedRoles, setAssignedRoles] = React.useState<string[]>(docItem.assignedRoles || ['all']);
  const [assignedStaffIds, setAssignedStaffIds] = React.useState<string[]>(docItem.assignedStaffIds || []);
  const [signBy, setSignBy] = React.useState<string>(/^\d{4}-\d{2}-\d{2}$/.test(String(docItem.signBy || '')) ? docItem.signBy : '');
  const [remindBefore, setRemindBefore] = React.useState<boolean>(docItem.remindBefore !== false);
  const [quiz, setQuiz] = React.useState<any[]>(Array.isArray(docItem.quiz) ? docItem.quiz : []);
  const [requireSignature, setRequireSignature] = React.useState<boolean>(docItem.requireSignature === true);
  const [links, setLinks] = React.useState<any[]>(cleanLinks(docItem.links));
  const [careDefault, setCareDefault] = React.useState<boolean>(docItem.aftercareDefault === true);
  const [checkIn, setCheckIn] = React.useState<string>(docItem.checkInDays === null || docItem.checkInDays === undefined ? '' : String(docItem.checkInDays));
  const isCare = category === 'aftercare';
  const [changeNote, setChangeNote] = React.useState<string>(String(liveItem.draft?.changeNote || ''));
  const [selected, setSelected] = React.useState<string>(''); const [preview, setPreview] = React.useState(false);
  const [uploading, setUploading] = React.useState<string>(''); const [err, setErr] = React.useState(''); const [confirmDelete, setConfirmDelete] = React.useState(false);
  const col = cols.find((c) => c.id === collectionId) || cols[0];

  const patch = (id: string, p: any) => setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const move = (i: number, dir: -1 | 1) => setBlocks((prev) => { const j = i + dir; if (j < 0 || j >= prev.length) return prev; const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = (type: BlockType) => { if (blocks.length >= MAX_BLOCKS) { setErr(`Up to ${MAX_BLOCKS} blocks.`); return; } const id = nanoid(); setBlocks((p) => [...p, { id, type, heading: '', body: '' }]); setSelected(id); };
  const addPhoto = async (b: any, file?: File | null) => {
    if (!file) return; const max = b.type === 'photo' ? 1 : MAX_IMAGES; if ((b.images || []).length >= max && b.type !== 'photo') { setErr(`Up to ${MAX_IMAGES} photos on a step.`); return; }
    setUploading(b.id); setErr('');
    try { const url = await uploadImage(`tenants/${tenantId}/evidence/docs/${liveItem.id}/${nanoid(8)}.jpg`, file, 1600); patch(b.id, { images: b.type === 'photo' ? [url] : [...(b.images || []), url] }); }
    catch { setErr('The photo didn’t upload. Try again.'); }
    setUploading('');
  };
  const toggleRole = (r: string) => { if (r === 'all') { setAssignedRoles(['all']); return; } setAssignedRoles((p) => { const base = p.filter((x) => x !== 'all'); return base.includes(r) ? base.filter((x) => x !== r) : [...base, r]; }); };

  const collect = () => {
    const t = title.trim().slice(0, 140); if (!t) { setErr('Give it a title.'); return null; }
    const clean = blocks.map(cleanBlock).filter(blockHasContent); if (!clean.length) { setErr('Add at least one block with something in it.'); return null; }
    const q = cleanQuiz(quiz); if (quiz.length && q.length !== quiz.length) { setErr('Each quick-check question needs the question and at least two answers.'); return null; }
    setErr('');
    const base = { title: t, category, sections: withItemIds(clean, liveItem.sections || []), assignedRoles, assignedStaffIds, signBy: /^\d{4}-\d{2}-\d{2}$/.test(signBy) ? signBy : null, remindBefore,
      changeNote: changeNote.trim().slice(0, 400), collectionId, ownerId: ownerId || null, reviewEveryMonths: reviewEvery || null, quiz: q, requireSignature, links: cleanLinks(links) };
    // Aftercare is for clients: nobody on the team is assigned, signs or is quizzed; only service links count.
    return { ...base, ...(isCare ? { assignedRoles: [], assignedStaffIds: [], signBy: null, quiz: [], requireSignature: false, collectionId: 'aftercare', aftercareDefault: careDefault, checkInDays: checkIn === '' ? null : Number(checkIn), links: cleanLinks(links).filter((l) => l.kind === 'service').map((l: any) => ({ ...l, stepId: null, stepLabel: null })) } : { aftercareDefault: false }) };
  };

  const people = staff.filter((m: any) => !m.archived && m.role !== 'renter' && !m.isRenter);
  const renters = staff.filter((m: any) => !m.archived && m.isActive !== false && (m.role === 'renter' || m.isRenter));
  return (
    <div className="overflow-hidden rounded-[18px] border bg-card" style={{ borderColor: LINE, color: INK }}>
      <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3 md:px-5" style={{ borderColor: LINE, background: 'rgba(255,255,255,.8)' }}>
        <button type="button" onClick={onClose} aria-label="Close the editor" className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: SOFT }}><Ico d={IC.back} s={16} /></button>
        <span className="text-[13.5px]" style={{ color: MUTED }}>{col.name}</span>
        <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={isLive ? { background: 'color-mix(in srgb, #3d5a99 12%, transparent)', color: BLUE } : { background: SOFT }}>{isLive ? `v${(Number(liveItem.version) || 1) + 1} draft · the team sees v${liveItem.version || 1}` : 'Draft'}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setPreview((v) => !v)} className="h-10 rounded-full border bg-card px-4 text-[14px]" style={{ borderColor: LINE }}>{preview ? 'Back to editing' : 'Preview'}</button>
        <button type="button" onClick={() => { const d = collect(); if (d) onSave(d); }} className="h-10 rounded-full border bg-card px-4 text-[14px]" style={{ borderColor: LINE }}>Save draft</button>
        <button type="button" onClick={() => { const d = collect(); if (d) onPublish(d); }} className="h-10 rounded-full px-5 text-[14px] font-semibold text-background" style={{ background: INK }}>{isLive ? `Publish v${(Number(liveItem.version) || 1) + 1}` : 'Publish'}</button>
      </div>
      {err && <p className="px-5 pt-3 text-[13.5px] font-medium" style={{ color: RED }}>{err}</p>}
      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-3 p-4 md:p-6">
          <div className="flex items-center gap-4"><span className="hidden sm:block"><Cover c={col} w={130} h={74} label={false} /></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} aria-label="Title" placeholder="Title — e.g. Opening the studio" className="min-w-0 flex-1 bg-transparent text-[26px] font-normal tracking-[-0.03em] outline-none md:text-[30px]" /></div>
          {preview ? <div className="mx-auto max-w-[560px] py-2"><DocBlocks sections={blocks.map(cleanBlock).filter(blockHasContent)} /></div> : <>
            {blocks.map((b, i) => { const on = selected === b.id; const ph = PH[b.type] || PH.text; const lines = checklistLines(b);
              return <div key={b.id} onClick={() => setSelected(b.id)} className="rounded-[16px] border bg-card p-3.5" style={{ borderColor: on ? INK : LINE, boxShadow: on ? '0 0 0 3px rgba(22,23,26,.07)' : undefined }}>
                <div className="mb-2 flex items-center gap-1.5">
                  <select value={b.type} onChange={(e) => patch(b.id, { type: e.target.value })} aria-label="Block type" className="h-8 rounded-full px-2.5 text-[12px] font-semibold tracking-[0.04em]" style={{ background: SOFT }}>{(blocksFor(category).some((x) => x.type === b.type) ? blocksFor(category) : BLOCKS).map((x) => <option key={x.type} value={x.type}>{x.label.toUpperCase()}</option>)}</select>
                  <span className="flex-1" />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="h-9 w-9 rounded-full text-[15px] disabled:opacity-25" style={{ background: SOFT }}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down" className="h-9 w-9 rounded-full text-[15px] disabled:opacity-25" style={{ background: SOFT }}>↓</button>
                  <button type="button" onClick={() => setBlocks((p) => p.filter((x) => x.id !== b.id))} aria-label={`Remove this ${blockLabel(b.type).toLowerCase()}`} className="h-9 rounded-full px-3 text-[12.5px]" style={{ background: SOFT, color: RED }}>Remove</button>
                </div>
                <div className="space-y-2">
                  <input value={b.heading || ''} onChange={(e) => patch(b.id, { heading: e.target.value })} placeholder={ph[0]} aria-label={`${blockLabel(b.type)} heading`} className={input} style={{ borderColor: LINE }} />
                  {b.type === 'video' && <input value={b.url || ''} onChange={(e) => patch(b.id, { url: e.target.value.trim() })} placeholder="Paste a YouTube, Vimeo or video link (https://…)" aria-label="Video link" className={input} style={{ borderColor: LINE }} />}
                  <textarea value={b.body || ''} onChange={(e) => patch(b.id, { body: e.target.value })} placeholder={ph[1]} aria-label={`${blockLabel(b.type)} text`} rows={b.type === 'checklist' ? Math.max(4, lines.length + 1) : b.type === 'photo' || b.type === 'video' ? 2 : 3} className={area} style={{ borderColor: LINE }} />
                  {(b.type === 'step' || b.type === 'photo') && <div className="flex flex-wrap items-center gap-2">
                    {(b.images || []).map((u: string) => <span key={u} className="relative"><img src={u} alt="" className="h-16 w-20 rounded-[10px] object-cover" /><button type="button" onClick={() => patch(b.id, { images: (b.images || []).filter((x: string) => x !== u) })} aria-label="Remove this photo" className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-card text-[12px] shadow">✕</button></span>)}
                    {(b.type === 'step' ? (b.images || []).length < MAX_IMAGES : !(b.images || []).length) && <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}><Ico d={IC.cam} s={15} />{uploading === b.id ? 'Uploading…' : 'Add a photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => { addPhoto(b, e.target.files?.[0]); e.target.value = ''; }} /></label>}
                    {b.type === 'step' && <label className="inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}><Ico d={IC.clock} s={15} />Timer<input type="number" min={0} max={240} value={b.timerMin || ''} onChange={(e) => patch(b.id, { timerMin: Number(e.target.value) || undefined })} placeholder="0" aria-label="Timer in minutes" className="w-12 bg-transparent text-center outline-none" />min</label>}
                  </div>}
                  {b.type === 'checklist' && lines.length > 0 && <div className="space-y-1"><p className="text-[12px]" style={{ color: MUTED }}>Lines that need a photo when they’re ticked:</p><div className="flex flex-wrap gap-1.5">{lines.map((t, li) => { const p = Array.isArray(b.photoLines) && b.photoLines.includes(li);
                    return <button key={li} type="button" aria-pressed={p} onClick={() => patch(b.id, { photoLines: p ? (b.photoLines || []).filter((x: number) => x !== li) : [...(b.photoLines || []), li] })} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full px-3 text-[12.5px]" style={p ? { background: 'color-mix(in srgb, #3d5a99 12%, transparent)', color: BLUE, fontWeight: 600 } : { background: SOFT }}>{p && <Ico d={IC.cam} s={12} c={BLUE} />}<span className="truncate">{t}</span></button>; })}</div></div>}
                </div>
              </div>; })}
            <div className="flex flex-wrap gap-2 pt-1">{blocksFor(category).map((x) => <button key={x.type} type="button" onClick={() => add(x.type)} title={x.hint} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}><Ico d={ADD_ICON[x.type]} s={14} />{x.label}</button>)}</div>
          </>}
        </div>
        <div className="border-t p-4 md:border-l md:border-t-0 md:p-5" style={{ borderColor: LINE, background: 'rgba(250,250,251,.7)' }}>
          <p className="pb-1 text-[15px] font-bold">Details</p>
          <Side title="Collection and type"><select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="Collection" className={input} style={{ borderColor: LINE }}>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="flex flex-wrap gap-1.5">{[['sop', 'SOP'], ['handbook', 'Handbook'], ['policy', 'Policy'], ['other', 'Other'], ['aftercare', 'Client aftercare']].map(([v, l]) => <Chip key={v} on={category === v} onClick={() => setCategory(v)}>{l}</Chip>)}</div>
            {isCare && <p className="text-[12.5px]" style={{ color: MUTED }}>Clients get it after their visit. The team doesn’t sign it.</p>}</Side>
          <Side title="Owner and review"><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner" className={input} style={{ borderColor: LINE }}><option value="">No owner yet</option>{people.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <select value={reviewEvery} onChange={(e) => setReviewEvery(Number(e.target.value))} aria-label="Review" className={input} style={{ borderColor: LINE }}>{[[0, 'No review date'], [3, 'Review every 3 months'], [6, 'Review every 6 months'], [12, 'Review every year']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Side>
          {isCare ? <Side title="Which services it’s for"><DocLinksEditor tenantId={tenantId} value={links} onChange={setLinks} kinds={['service']} steps={false} />
            <label className="flex items-center justify-between gap-2 text-[14px]"><span>Use it for every other service too</span><input type="checkbox" checked={careDefault} onChange={(e) => setCareDefault(e.target.checked)} className="h-5 w-5" style={{ accentColor: INK }} /></label>
            <p className="text-[12px]" style={{ color: MUTED }}>Sent after the visit (Settings → Aftercare says when) and shown on the visit’s page. A service’s own aftercare wins over the one for every service.</p>
            <label className="flex items-center justify-between gap-2 text-[14px]"><span>Check in after</span><select value={checkIn} onChange={(e) => setCheckIn(e.target.value)} aria-label="Check in after" className="h-10 rounded-[10px] border bg-card px-2 text-[14px]" style={{ borderColor: LINE }}>
              <option value="">The business’s choice</option><option value="0">No check-in</option><option value="2">2 days</option><option value="3">3 days</option><option value="7">7 days</option></select></label></Side> : <>
          <Side title="Shows up during work"><DocLinksEditor tenantId={tenantId} value={links} onChange={setLinks} />
            {isLive && <p className="text-[12px]" style={{ color: MUTED }}>Changes here apply when you save the draft. Nobody has to sign again.</p>}</Side>
          <Side title="Who it’s for"><div className="flex flex-wrap gap-1.5"><Chip on={assignedRoles.includes('all')} onClick={() => toggleRole('all')}>Everyone</Chip>{roles.map(([id, r]) => <Chip key={id} on={assignedRoles.includes(id)} onClick={() => toggleRole(id)}>{r.name}</Chip>)}{renters.length > 0 && <Chip on={assignedRoles.includes('renter')} onClick={() => toggleRole('renter')}>Renters</Chip>}</div>
            {renters.length > 0 && <p className="text-[12px]" style={{ color: MUTED }}>“Everyone” is your team. Renters only get documents sent to renters — they read and sign them in their portal.</p>}
            <details><summary className="cursor-pointer text-[13px] underline underline-offset-2" style={{ color: MUTED }}>Or pick people{assignedStaffIds.length ? ` (${assignedStaffIds.length})` : ''}</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">{[...people, ...renters].map((m: any) => <Chip key={m.id} on={assignedStaffIds.includes(m.id)} onClick={() => setAssignedStaffIds((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}>{m.name}{m.role === 'renter' || m.isRenter ? ' (renter)' : ''}</Chip>)}</div></details></Side>
          <Side title="Signing">
            <label className="flex items-center justify-between gap-2 text-[14px]"><span>Sign by</span><input type="date" value={signBy} onChange={(e) => setSignBy(e.target.value)} className="h-10 rounded-[10px] border bg-card px-2 text-[14px]" style={{ borderColor: LINE }} /></label>
            {signBy && <label className="flex items-center justify-between gap-2 text-[14px]"><span>Remind them the day before</span><input type="checkbox" checked={remindBefore} onChange={(e) => setRemindBefore(e.target.checked)} className="h-5 w-5" /></label>}
            <label className="flex items-center justify-between gap-2 text-[14px]"><span>Draw a signature</span><input type="checkbox" checked={requireSignature} onChange={(e) => setRequireSignature(e.target.checked)} className="h-5 w-5" /></label>
          </Side>
          <Side title={`Quick check before signing${quiz.length ? ` · ${quiz.length}` : ''}`}>
            {quiz.map((q, qi) => <div key={q.id || qi} className="space-y-1.5 rounded-[12px] border bg-card p-2.5" style={{ borderColor: LINE }}>
              <div className="flex gap-1.5"><input value={q.q || ''} onChange={(e) => setQuiz((p) => p.map((x, j) => (j === qi ? { ...x, q: e.target.value } : x)))} placeholder="Question" aria-label="Question" className="h-9 min-w-0 flex-1 rounded-[10px] border px-2.5 text-[13.5px]" style={{ borderColor: LINE }} /><button type="button" onClick={() => setQuiz((p) => p.filter((_, j) => j !== qi))} aria-label="Remove question" className="h-9 w-9 rounded-full text-[12px]" style={{ background: SOFT }}>✕</button></div>
              {[0, 1, 2, 3].map((oi) => <label key={oi} className="flex items-center gap-1.5"><input type="radio" name={`ans-${qi}`} checked={(q.answer || 0) === oi} onChange={() => setQuiz((p) => p.map((x, j) => (j === qi ? { ...x, answer: oi } : x)))} aria-label={`Answer ${oi + 1} is right`} />
                <input value={(q.options || [])[oi] || ''} onChange={(e) => setQuiz((p) => p.map((x, j) => { if (j !== qi) return x; const o = [...(x.options || ['', '', '', ''])]; o[oi] = e.target.value; return { ...x, options: o }; }))} placeholder={oi < 2 ? `Answer ${oi + 1}` : `Answer ${oi + 1} (optional)`} className="h-9 min-w-0 flex-1 rounded-[10px] border px-2.5 text-[13.5px]" style={{ borderColor: LINE }} /></label>)}
              <p className="text-[11.5px]" style={{ color: MUTED }}>Pick the right answer with the circle.</p></div>)}
            {quiz.length < 6 && <button type="button" onClick={() => setQuiz((p) => [...p, { id: nanoid(6), q: '', options: ['', '', '', ''], answer: 0 }])} className="h-9 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}>+ Add a question</button>}
          </Side></>}
          {isLive && !isCare && <Side title="What changed (shown when they sign again)"><textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} rows={3} maxLength={400} placeholder="e.g. Soak time is now 10 minutes (was 5)." className={area} style={{ borderColor: LINE }} />
            {liveItem.draft?.savedAt && <p className="text-[12px]" style={{ color: MUTED }}>Draft saved {new Date(liveItem.draft.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. The team still reads v{liveItem.version || 1}.</p>}</Side>}
          <div className="border-t pt-3.5" style={{ borderColor: LINE }}>{confirmDelete
            ? <div className="flex flex-wrap items-center gap-2 text-[13.5px]"><span>Delete it for good?</span><button type="button" onClick={onDelete} className="h-9 rounded-full px-3.5 font-semibold text-white" style={{ background: RED }}>Delete</button><button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-full px-3.5" style={{ background: SOFT }}>Keep it</button></div>
            : <button type="button" onClick={() => setConfirmDelete(true)} className="text-[13px] underline underline-offset-2" style={{ color: RED }}>Delete this document</button>}</div>
        </div>
      </div>
    </div>);
}
