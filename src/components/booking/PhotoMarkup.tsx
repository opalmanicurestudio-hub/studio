'use client';
// src/components/booking/PhotoMarkup.tsx — inspiration photos, marked up (board 17A).
//
// Clients add up to 4 photos (camera or library) and mark each one up in the one markup tool (components/markup/
// MarkupEditor): every tool the booking photos had (move, pen, highlight, arrow, circle, text, stamps, nail-shape
// guides, pick a color into Colors I love and the note, resize and delete, undo and redo, zoom, hold to see the
// original) and the team's (dashed lines, warning, target and arrow stamps, numbers that never renumber, turning a
// mark, a close-up lens), plus shapes, nail length, pins with notes, blur, an eraser and crop. On Done the photo is
// flattened to a JPEG and saved through the server (/api/booking/photo), with the photo before its marks and the marks
// themselves, so they can be changed later (and the team can see them on their own layer).
// Around the tool (board 17B): each photo as a card (its marks in a few words, its note, Edit, Crop, Remove), a photo
// of how it looks now to compare with (slider, side by side or see through), and every photo written out in plain
// words, as the provider will see it, before it's sent.

import { useRef, useState } from 'react';
import { MarkupEditor, type MarkupResult, type Tool } from '@/components/markup/MarkupEditor';
import { PhotoCompare } from '@/components/markup/PhotoCompare';
import { altText, countChip, photoLine } from '@/lib/markup/describe';
import { X } from 'lucide-react';
import { cleanDoc, packDoc, type MarkupDoc } from '@/lib/markup/model';
import type { Niche } from '@/lib/niche';

export interface InspoPhoto {
  url: string; note: string; local?: string; colors?: string[];
  /** The photo before its marks (saved), this phone's copy of it, and the marks (lib/markup, packed). */
  original?: string; base?: string; markup?: string;
}

/** A photo from the camera or library, made no larger than 2000 pixels on its longer side (a JPEG). */
async function shrink(file: File, max = 2000): Promise<string> {
  const raw: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read')); r.readAsDataURL(file); });
  const i: HTMLImageElement = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = raw; });
  const k = Math.min(1, max / Math.max(i.naturalWidth, i.naturalHeight));
  if (k === 1 && /^data:image\/jpeg/.test(raw) && raw.length < 2_400_000) return raw;
  const c = document.createElement('canvas'); c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
  c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}
const saveOne = async (tenantId: string, dataUrl: string, original = false): Promise<{ url?: string; error?: string }> => {
  const res = await fetch('/api/booking/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, dataUrl, ...(original ? { private: true, kind: 'original' } : {}) }) });
  const d = await res.json().catch(() => ({})); return d?.ok && d.url ? { url: d.url } : { error: d?.error };
};
/** The photo before its marks is kept (privately: only the team opens it) so the marks can be changed later, but never
 *  when something was blurred or cropped out: then the photo is only ever kept as it was sent. */
const keepsOriginal = (d: MarkupDoc) => !d.view.crop && !d.marks.some((m) => m.kind === 'blur');

// ── The photo list on the booking sheet (board 17B) ─────────────────────
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
type Slot = 'goal' | 'now';
type Editing = { slot: Slot; src: string; index: number | null; note: string; colors: string[]; doc: MarkupDoc | null; base: string | null; original: string | null; tool?: Tool };
const docOf = (p: InspoPhoto | null | undefined): MarkupDoc | null => { if (!p?.markup) return null; try { return cleanDoc(JSON.parse(p.markup)); } catch { return null; } };

export function PhotoMarkup({ tenantId, value, onChange, accent = '#16171a', max = 4, now, onNow, who, niche }: {
  tenantId: string; value: InspoPhoto[]; onChange: (v: InspoPhoto[]) => void; accent?: string; max?: number;
  /** The kind of business (lib/niche), so the markup tools fit it. */
  niche?: Niche | null;
  /** How it looks now (for comparing), when the page asks for one. */
  now?: InspoPhoto | null; onNow?: (p: InspoPhoto | null) => void;
  /** Who sees the photos (the provider's first name, or the business). */
  who?: string;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [comparing, setComparing] = useState(false);
  const them = who || 'the team';   // (mid-sentence)
  // The editor opens at the top of the page, outside the area that defines
  // --accent — so resolve the business's real color here and hand it over.
  const root = useRef<HTMLDivElement>(null);
  const realAccent = () => { if (!accent.startsWith('var(')) return accent; const v = root.current ? getComputedStyle(root.current).getPropertyValue('--accent').trim() : ''; return v || (accent.match(/,\s*([^)]+)\)/)?.[1] || '#16171a'); };
  const pick = async (files: FileList | null, slot: Slot = 'goal') => {
    const f = files?.[0]; if (!f) return; setErr('');
    if (!/^image\//.test(f.type)) { setErr('That file isn’t a photo.'); return; }
    try { const base = await shrink(f); setEditing({ slot, src: base, index: null, note: '', colors: [], doc: null, base, original: null }); }
    catch { setErr('That photo couldn’t be opened. Please try another.'); }
  };
  /** Saves it while the editor stays open: it closes once saved, or says why not (nothing is lost). */
  const save = async (r: MarkupResult): Promise<string | null> => {
    const ed = editing; const idx = ed?.index ?? null; setBusy(true); setErr('');
    try {
      // The marked-up copy, and (once, tried twice) the photo before its marks.
      const keep = !!ed?.base && keepsOriginal(r.doc);
      const origOnce = async () => { if (!keep) return { url: undefined }; if (ed?.original) return { url: ed.original }; const a = await saveOne(tenantId, ed!.base!, true).catch(() => ({ url: undefined })); return a.url ? a : saveOne(tenantId, ed!.base!, true).catch(() => ({ url: undefined })); };
      const [flat, orig] = await Promise.all([saveOne(tenantId, r.dataUrl), origOnce()]);
      if (!flat.url) return flat.error || 'Your photo didn’t save. Please try again.';
      const extra = r.colors.length ? `${r.note ? '\n' : ''}Colors I picked: ${r.colors.join(', ')}` : '';
      // The marks stay with the photo on this phone either way, so they can be changed until the booking is made.
      const markup = ed?.base ? packDoc(r.doc) : null;
      const item: InspoPhoto = { url: flat.url, note: (r.note + extra).slice(0, 400), local: r.dataUrl, colors: r.colors, ...(ed?.base ? { base: ed.base } : {}), ...(orig.url ? { original: orig.url } : {}), ...(markup ? { markup } : {}) };
      if (ed?.slot === 'now') onNow?.(item);
      else { const next = [...value]; if (idx !== null && idx < next.length) next[idx] = item; else next.push(item); onChange(next.slice(0, max)); }
      setEditing(null); return null;
    } catch { return 'Your photo didn’t save. Check your connection and try again.'; } finally { setBusy(false); }
  };
  /** Open a photo again: its marks stay changeable while this phone still has the photo before them. */
  const reopen = (p: InspoPhoto, i: number | null, slot: Slot, tool?: Tool) => {
    const doc = p.base ? docOf(p) : null;
    const base = doc ? p.base! : null; const src = doc ? p.base! : (p.local || p.url);
    setEditing({ slot, src, index: i, note: doc ? doc.note : (p.note || '').replace(/\n?Colou?rs I picked:[\s\S]*$/, ''), colors: p.colors || [], doc, base, original: doc ? p.original || null : null, tool });
  };
  const pill = 'inline-flex min-h-11 items-center justify-center rounded-full px-3 text-[13.5px] font-semibold';
  const pillStyle = { background: SOFT, color: INK };
  const addLabel = (text: string, slot: Slot, camera: boolean) => (
    <label className={`${pill} cursor-pointer`} style={{ background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{text}
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : {})} className="hidden" onChange={(e) => { void pick(e.target.files, slot); e.target.value = ''; }} aria-label={slot === 'now' ? 'Add a photo of how it looks now' : camera ? 'Take an inspiration photo' : 'Choose an inspiration photo from your photos'} /></label>);
  const allColors = [...new Set(value.flatMap((p) => p.colors || []))].slice(0, 8);
  return (
    <div ref={root} className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {value.map((p, i) => (
          <figure key={p.url} className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: `0 0 0 1px ${LINE}` }}>
            <div className="relative">
              <img src={p.local || p.url} alt={altText(docOf(p), p.note)} className="aspect-[4/3] w-full object-cover" />
              <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: 'rgba(22,23,26,.72)', color: '#fff' }}>{countChip(docOf(p), p.colors)}</span>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="absolute right-0 top-0 grid h-11 w-11 place-items-center" aria-label={`Remove photo ${i + 1}`}>
                <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'rgba(22,23,26,.72)', color: '#fff' }}><X size={14} /></span></button>
            </div>
            <figcaption className="space-y-1.5 p-2.5">
              {p.note && <p className="line-clamp-2 text-[13px] leading-snug" style={{ color: INK }}>{p.note.replace(/\n?Colou?rs I picked:[\s\S]*$/, '')}</p>}
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => reopen(p, i, 'goal')} className={pill} style={pillStyle} aria-label={`Edit photo ${i + 1}`}>Edit</button>
                <button type="button" onClick={() => reopen(p, i, 'goal', 'crop')} className={pill} style={pillStyle} aria-label={`Crop photo ${i + 1}`}>Crop</button>
              </div>
            </figcaption>
          </figure>))}
         {value.length < max && <div className={`flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl p-3 ${value.length ? '' : 'col-span-2'}`} style={{ border: `1.5px dashed ${LINE}`, background: '#fff' }}>
          {addLabel('Take a photo', 'goal', true)}{addLabel('From your photos', 'goal', false)}
          <p className="text-[12.5px]" style={{ color: MUTED }}>{value.length} of {max}</p></div>}
      </div>
      {onNow && <div className="flex items-center gap-3 rounded-2xl bg-white p-3" style={{ boxShadow: `0 0 0 1px ${LINE}` }}>
        {now ? <img src={now.local || now.url} alt="How it looks now" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span aria-hidden className="h-12 w-12 shrink-0 rounded-xl" style={{ background: SOFT }} />}
        <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">How it looks now</p><p className="text-[13px] leading-snug" style={{ color: MUTED }}>So {them} can compare where you are with where you want to be.</p></div>
        {now ? <div className="flex shrink-0 flex-col items-end gap-1">
            <button type="button" onClick={() => reopen(now, null, 'now')} className={pill} style={pillStyle}>Change</button>
            <button type="button" onClick={() => onNow(null)} className="min-h-11 px-2 text-[13px] font-semibold" style={{ color: MUTED }} aria-label="Remove how it looks now">Remove</button></div>
          : <span className="flex shrink-0 flex-col gap-1">{addLabel('Add', 'now', true)}</span>}
      </div>}
      {now && value.length > 0 && <button type="button" onClick={() => setComparing(true)} className={`${pill} w-full`} style={{ background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>Compare now with {value.length === 1 ? 'the photo' : 'the photos'}</button>}
      {busy ? <p className="text-[12.5px]" style={{ color: MUTED }} role="status">Saving your photo…</p> : value.length === 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>Up to {max} photos. Draw on them, add a shape, or pick an exact color from the photo.</p>}
      {err && <p className="cf-note cf-warn text-[13px]" role="alert">{err}</p>}
      {value.length > 0 && <section aria-label={`What ${them} will see`} className="space-y-2">
        <p className="text-[13px] font-semibold" style={{ color: MUTED }}>What {them} will see</p>
        <div className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: `0 0 0 1px ${LINE}` }}>
          {value.map((p, i) => <div key={p.url} className="px-3.5 py-2.5" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}><p className="text-[14.5px] font-semibold">Photo {i + 1}</p><p className="text-[13px] leading-snug" style={{ color: MUTED }}>{photoLine(docOf(p), p.note)}</p></div>)}
          {now && <div className="px-3.5 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}><p className="text-[14.5px] font-semibold">How it looks now</p><p className="text-[13px]" style={{ color: MUTED }}>Added for comparing</p></div>}
        </div>
        {allColors.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-[13px]" style={{ color: MUTED }}>Colors I love</span>{allColors.map((c) => <span key={c} className="h-7 w-7 rounded-lg" style={{ background: c, boxShadow: `inset 0 0 0 1px ${LINE}` }} title={c.toUpperCase()} aria-label={c.toUpperCase()} role="img" />)}</div>}
      </section>}
      {comparing && now && <PhotoCompare now={{ src: now.local || now.url, label: 'Now' }} goals={value.map((p, i) => ({ src: p.local || p.url, label: value.length > 1 ? `Photo ${i + 1}` : 'Goal' }))} accent={realAccent()} viewer="client" who={who ? who : 'The team'} onClose={() => setComparing(false)} />}
      {editing && <MarkupEditor niche={niche} src={editing.src} doc={editing.doc} layer="client" startTool={editing.tool}
        title={editing.slot === 'now' ? 'How it looks now' : `Photo ${(editing.index ?? value.length) + 1} of ${Math.max(value.length + (editing.index === null ? 1 : 0), 1)}`}
        accent={realAccent()} initialNote={editing.note} initialColors={editing.colors} onCancel={() => setEditing(null)} onDone={save} />}
    </div>
  );
}
