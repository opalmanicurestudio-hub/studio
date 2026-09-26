'use client';
// src/components/academy/SchoolIdentity.tsx
//
// SCHOOL IDENTITY (Settings → School identity)
//   Details    school name, legal name, state licence # and board, address,
//              phone, email, website — prefilled from the business record
//   Logo       everywhere: documents, portal, catalog, certificates
//   Seal       official documents only (certificates, hours letters, student
//              file, letters, signed enrolment agreements)
//   Signature  upload a photo (white paper is removed and it's cropped tight)
//              or draw it; signer name + title. Official documents only.
//   Preview    how the top and the signature/seal block of a document look.
// Saving is owners/managers only and is recorded in the audit log.

import { useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';
import type { DocBrand } from '@/lib/doc-theme';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const MAX_CHARS = 580_000;

/** Resize; optionally make white paper transparent and crop to the ink. Returns a PNG data URL. */
export function prepareImage(src: HTMLImageElement | HTMLCanvasElement, o: { max: number; removeWhite?: boolean; trim?: boolean }): string {
  let scale = Math.min(1, o.max / Math.max(src.width, src.height)); let out = '';
  for (let tries = 0; tries < 5; tries++) {
    const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    let c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(src, 0, 0, w, h);
    if (o.removeWhite || o.trim) {
      const d = x.getImageData(0, 0, w, h); const p = d.data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < p.length; i += 4) {
        if (o.removeWhite) { const m = Math.min(p[i], p[i + 1], p[i + 2]); if (m > 225) p[i + 3] = 0; else if (m > 180) p[i + 3] = Math.round(p[i + 3] * (225 - m) / 45); }
        if (p[i + 3] > 24) { const px = (i / 4) % w, py = Math.floor(i / 4 / w); if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      }
      x.putImageData(d, 0, 0);
      if (o.trim && x1 >= 0) {
        const pad = 6; const cx = Math.max(0, x0 - pad), cy = Math.max(0, y0 - pad), cw = Math.min(w, x1 + pad) - cx, ch = Math.min(h, y1 + pad) - cy;
        const t = document.createElement('canvas'); t.width = cw; t.height = ch; t.getContext('2d')!.drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch); c = t;
      }
    }
    out = c.toDataURL('image/png'); if (out.length <= MAX_CHARS) return out; scale *= 0.75;
  }
  return out;
}
const loadFile = (f: File) => new Promise<HTMLImageElement>((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('That file isn’t an image we can read.')); img.src = URL.createObjectURL(f); });

type Kind = 'logo' | 'seal' | 'signature';
const SLOTS: { k: Kind; title: string; where: string; tip: string; max: number; white: boolean }[] = [
  { k: 'logo', title: 'Logo', where: 'Everywhere — documents, the student portal, course catalog and certificates.', tip: 'PNG with a transparent background looks best.', max: 600, white: false },
  { k: 'seal', title: 'Official seal', where: 'Official documents only.', tip: 'A transparent PNG is best. Scanned on white paper? Keep “remove white background” on.', max: 600, white: true },
  { k: 'signature', title: 'Director’s signature', where: 'Official documents only.', tip: 'Sign in dark ink on plain white paper and take a photo — the paper is removed and it’s cropped tight. Or draw it.', max: 900, white: true },
];

export function SchoolIdentity({ tenantId, onSaved }: { tenantId: string; onSaved?: (brand: DocBrand) => void }) {
  const [d, setD] = useState<any>(null); const [form, setForm] = useState<any>(null);
  const [imgs, setImgs] = useState<Record<string, string | null | undefined>>({}); // data URL = new, null = remove, undefined = unchanged
  const [white, setWhite] = useState<Record<string, boolean>>({ logo: false, seal: true, signature: true });
  const [draw, setDraw] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api({ action: 'identity-get', tenantId }).then((r) => { if (r.ok) { setD(r); setForm(r.identity); } }); }, [tenantId]);
  if (!d || !form) return null;
  const can = !!d.canEdit;
  const shown = (k: Kind) => (imgs[k] !== undefined ? imgs[k] : form[`${k}Url`]) || null;
  const dirty = JSON.stringify(form) !== JSON.stringify(d.identity) || Object.values(imgs).some((v) => v !== undefined);
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const pick = async (k: Kind, f?: File | null) => {
    if (!f) return; setErr('');
    try { const img = await loadFile(f); const s = SLOTS.find((x) => x.k === k)!; const url = prepareImage(img, { max: s.max, removeWhite: white[k], trim: k !== 'logo' }); setImgs((cur) => ({ ...cur, [k]: url })); }
    catch (e: any) { setErr(e?.message || 'Couldn’t read that image.'); }
  };
  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    const payload: any = {}; ['displayName', 'legalName', 'licenseNumber', 'licensingBoard', 'address', 'phone', 'email', 'website', 'signerName', 'signerTitle', 'sealOnCertificates', 'signatureOnCertificates'].forEach((k) => { payload[k] = form[k]; });
    payload.images = Object.fromEntries(Object.entries(imgs).filter(([, v]) => v !== undefined));
    const r = await api({ action: 'identity-save', tenantId, identity: payload }); setBusy(false);
    if (!r.ok) { setErr(r.error || 'Couldn’t save.'); return; }
    setD({ ...d, identity: r.identity }); setForm(r.identity); setImgs({}); setMsg('Saved. New documents and certificates use it straight away.'); onSaved?.(r.brand);
  };
  const who = [form.signerName, form.signerTitle].filter(Boolean).join(', ');
  return (
    <section className="space-y-4 rounded-2xl bg-muted/40 p-4">
      <div><p className="font-black">🏛 School identity</p><p className="text-[12px] text-muted-foreground">Your logo goes everywhere. The seal and signature go only on <b>official documents</b> — certificates, hours letters, the student file, letters and signed enrolment agreements.{!can && ' Only owners and managers can change these.'}</p></div>

      <fieldset disabled={!can} className="grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] font-bold">School name <span className="font-normal text-muted-foreground">(on documents and pages)</span><input className={field} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} /></label>
        <label className="text-[12px] font-bold">Legal name <span className="font-normal text-muted-foreground">(if different)</span><input className={field} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="e.g. Opal Nail Academy LLC" /></label>
        <label className="text-[12px] font-bold">State school licence #<input className={field} value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} placeholder="As shown on your school licence" /></label>
        <label className="text-[12px] font-bold">Licensing board<input className={field} value={form.licensingBoard} onChange={(e) => set('licensingBoard', e.target.value)} placeholder="e.g. North Carolina Board of Cosmetic Art Examiners" /></label>
        <label className="text-[12px] font-bold sm:col-span-2">Address<input className={field} value={form.address} onChange={(e) => set('address', e.target.value)} /></label>
        <label className="text-[12px] font-bold">Phone<input className={field} value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" /></label>
        <label className="text-[12px] font-bold">Email<input className={field} value={form.email} onChange={(e) => set('email', e.target.value)} inputMode="email" /></label>
        <label className="text-[12px] font-bold sm:col-span-2">Website <span className="font-normal text-muted-foreground">(optional)</span><input className={field} value={form.website} onChange={(e) => set('website', e.target.value)} inputMode="url" /></label>
      </fieldset>

      <div className="grid gap-3 lg:grid-cols-3">
        {SLOTS.map((s) => { const img = shown(s.k); return (
          <div key={s.k} className="space-y-2 rounded-2xl bg-background p-3">
            <p className="text-sm font-black">{s.title}</p><p className="text-[11px] text-muted-foreground">{s.where}</p>
            <div className="flex h-28 items-center justify-center rounded-xl bg-[linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%),linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]">
              {img ? <img src={img} alt={s.title} className="max-h-24 max-w-[90%] object-contain" /> : <span className="text-[12px] text-muted-foreground">None yet</span>}
            </div>
            {can && <>
              <div className="flex flex-wrap gap-1.5">
                <label className="inline-flex h-9 cursor-pointer items-center rounded-full bg-foreground px-3 text-[12px] font-bold text-background">{img ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pick(s.k, e.target.files?.[0]); e.target.value = ''; }} /></label>
                {s.k === 'signature' && <button type="button" onClick={() => setDraw(true)} className="h-9 rounded-full bg-muted px-3 text-[12px] font-bold">✍️ Draw</button>}
                {img && <button type="button" onClick={() => setImgs((cur) => ({ ...cur, [s.k]: null }))} className="h-9 rounded-full px-3 text-[12px] font-bold text-red-700">Remove</button>}
              </div>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={!!white[s.k]} onChange={(e) => setWhite({ ...white, [s.k]: e.target.checked })} /> Remove white background</label>
              <p className="text-[11px] text-muted-foreground">{s.tip}</p>
            </>}
            {s.k === 'signature' && <div className="grid grid-cols-2 gap-1.5"><input className={field} disabled={!can} value={form.signerName} onChange={(e) => set('signerName', e.target.value)} placeholder="Signer’s name" aria-label="Signer’s name" /><input className={field} disabled={!can} value={form.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} placeholder="Title" aria-label="Signer’s title" /></div>}
          </div>
        ); })}
      </div>

      <div className="space-y-1.5 rounded-2xl bg-background p-3 text-sm">
        <p className="font-black">On certificates</p>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!can} checked={form.sealOnCertificates !== false} onChange={(e) => set('sealOnCertificates', e.target.checked)} /> Show the seal</label>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!can} checked={form.signatureOnCertificates !== false} onChange={(e) => set('signatureOnCertificates', e.target.checked)} /> Show the signature</label>
        <p className="text-[11px] text-muted-foreground">Certificates can be opened by anyone with their verification link (like a printed certificate), so whatever is on them can be seen. Other official documents are printed by your team.</p>
      </div>

      {/* Preview */}
      <div className="space-y-1"><p className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Preview — an official document</p>
        <div className="rounded-2xl bg-white p-5 text-stone-900 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 pb-3">
            <div className="flex items-center gap-2.5">{shown('logo') && <img src={shown('logo')!} alt="" className="h-10 max-w-[130px] object-contain" />}<div><p className="text-base font-semibold leading-tight">{form.displayName || 'Your school'}</p>{form.legalName && form.legalName !== form.displayName && <p className="text-[10px] text-stone-500">{form.legalName}</p>}</div></div>
            <p className="text-right text-[10px] leading-snug text-stone-500">{form.address}<br />{[form.phone, form.email].filter(Boolean).join(' · ')}{form.licenseNumber && <><br />{form.licensingBoard ? `${form.licensingBoard} · ` : ''}School licence #{form.licenseNumber}</>}</p>
          </div>
          <p className="py-4 text-[12px] text-stone-400">… the letter or record …</p>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">{shown('signature') ? <img src={shown('signature')!} alt="" className="-mb-1 h-12 max-w-[200px] object-contain" /> : <div className="h-12" />}<p className="border-t border-stone-800 pt-1 text-[11px]">Authorised school official{who && <> — <b>{who}</b></>}</p></div>
            {shown('seal') ? <img src={shown('seal')!} alt="" className="h-20 w-20 -rotate-6 object-contain" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-stone-300 text-[9px] text-stone-400">School seal</div>}
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-red-700">{err}</p>}{msg && <p className="text-sm text-emerald-800">{msg}</p>}
      {can && <button type="button" disabled={busy || !dirty} onClick={save} className="h-11 rounded-full bg-foreground px-6 text-sm font-bold text-background disabled:opacity-40">{busy ? 'Saving…' : 'Save school identity'}</button>}
      {draw && <SignaturePad onCancel={() => setDraw(false)} onUse={(url) => { setImgs((cur) => ({ ...cur, signature: url })); setDraw(false); }} />}
    </section>
  );
}

function SignaturePad({ onUse, onCancel }: { onUse: (dataUrl: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const last = useRef<{ x: number; y: number } | null>(null); const [inked, setInked] = useState(false);
  const pt = (e: React.PointerEvent) => { const c = ref.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => { const x = ref.current!.getContext('2d')!; x.strokeStyle = '#111827'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onCancel}>
      <div className="w-full max-w-xl space-y-3 rounded-t-3xl bg-background p-4 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="font-black">✍️ Sign here</p>
        <canvas ref={ref} width={900} height={300} className="h-44 w-full touch-none rounded-2xl border-2 border-dashed bg-white" aria-label="Signature pad"
          onPointerDown={(e) => { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); last.current = pt(e); }}
          onPointerMove={(e) => { if (!last.current) return; const p = pt(e); line(last.current, p); last.current = p; setInked(true); }}
          onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
        <div className="flex gap-2">
          <button type="button" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setInked(false); }} className="h-11 rounded-full bg-muted px-4 text-sm font-bold">Clear</button>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className="h-11 rounded-full px-4 text-sm font-bold">Cancel</button>
          <button type="button" disabled={!inked} onClick={() => onUse(prepareImage(ref.current!, { max: 900, trim: true }))} className="h-11 rounded-full bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">Use this signature</button>
        </div>
      </div>
    </div>
  );
}
