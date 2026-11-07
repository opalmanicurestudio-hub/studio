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

import { useRef, useState } from 'react';
import { MarkupEditor, type MarkupResult } from '@/components/markup/MarkupEditor';
import { cleanDoc, packDoc, type MarkupDoc } from '@/lib/markup/model';

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

// ── The photo list on the booking sheet ─────────────────────────────────
export function PhotoMarkup({ tenantId, value, onChange, accent = '#16171a', max = 4 }: { tenantId: string; value: InspoPhoto[]; onChange: (v: InspoPhoto[]) => void; accent?: string; max?: number }) {
  const [editing, setEditing] = useState<{ src: string; index: number | null; note: string; colors: string[]; doc: MarkupDoc | null; base: string | null; original: string | null } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  // The editor opens at the top of the page, outside the area that defines
  // --accent — so resolve the business's real color here and hand it over.
  const root = useRef<HTMLDivElement>(null);
  const realAccent = () => { if (!accent.startsWith('var(')) return accent; const v = root.current ? getComputedStyle(root.current).getPropertyValue('--accent').trim() : ''; return v || (accent.match(/,\s*([^)]+)\)/)?.[1] || '#16171a'); };
  const pick = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return; setErr('');
    if (!/^image\//.test(f.type)) { setErr('That file isn’t a photo.'); return; }
    try { const base = await shrink(f); setEditing({ src: base, index: null, note: '', colors: [], doc: null, base, original: null }); }
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
      const next = [...value]; if (idx === null) next.push(item); else next[idx] = item;
      onChange(next.slice(0, max)); setEditing(null); return null;
    } catch { return 'Your photo didn’t save. Check your connection and try again.'; } finally { setBusy(false); }
  };
  /** Open a photo again: its marks stay changeable when the photo before them was kept. */
  const reopen = (p: InspoPhoto, i: number) => {
    let doc: MarkupDoc | null = null; try { doc = p.markup && p.base ? cleanDoc(JSON.parse(p.markup)) : null; } catch { doc = null; }
    const base = doc ? p.base! : null; const src = doc ? p.base! : (p.local || p.url);
    setEditing({ src, index: i, note: doc ? doc.note : (p.note || '').replace(/\n?Colou?rs I picked:[\s\S]*$/, ''), colors: p.colors || [], doc, base, original: doc ? p.original || null : null });
  };
  return (
    <div ref={root} className="space-y-2">
      {value.length > 0 && <div className="grid grid-cols-2 gap-2">{value.map((p, i) => (
        <figure key={p.url} className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #ececee' }}>
          <img src={p.local || p.url} alt={`Inspiration photo ${i + 1}`} className="aspect-square w-full object-cover" />
          <figcaption className="space-y-1 p-2 text-[12px]">
            {(p.colors || []).length > 0 && <div className="flex gap-1">{p.colors!.map((c) => <span key={c} className="h-4 w-4 rounded-full" style={{ background: c, boxShadow: 'inset 0 0 0 1px #ececee' }} title={c} />)}</div>}
            {p.note && <p className="line-clamp-2" style={{ color: '#6d7075' }}>{p.note}</p>}
            <div className="flex gap-3"><button type="button" onClick={() => reopen(p, i)} className="inline-flex min-h-11 items-center px-2 underline underline-offset-2">Mark up</button><button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="inline-flex min-h-11 items-center px-2 underline underline-offset-2" style={{ color: '#6d7075' }}>Remove</button></div>
          </figcaption>
        </figure>
      ))}</div>}
      {value.length < max && <div className="grid grid-cols-2 gap-2">
        <label className="flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-dashed bg-white text-[14px] transition active:scale-[.98]">Take a photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} aria-label="Take an inspiration photo" /></label>
        <label className="flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-dashed bg-white text-[14px] transition active:scale-[.98]">Choose a photo<input type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} aria-label="Choose an inspiration photo" /></label>
      </div>}
      <p className="text-[12px]" style={{ color: '#6d7075' }}>{busy ? 'Saving your photo…' : `Up to ${max} photos. Draw on them, add a shape, or pick an exact color from the photo.`}</p>
      {err && <p className="cf-note cf-warn text-[13px]" role="alert">{err}</p>}
      {editing && <MarkupEditor src={editing.src} doc={editing.doc} layer="client" title={`Photo ${(editing.index ?? value.length) + 1} of ${Math.max(value.length + (editing.index === null ? 1 : 0), 1)}`} accent={realAccent()} initialNote={editing.note} initialColors={editing.colors} onCancel={() => setEditing(null)} onDone={save} />}
    </div>
  );
}
