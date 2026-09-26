'use client';
// src/components/academy/Portfolio.tsx
//
// PORTFOLIO
//   PortfolioCard / PortfolioHub  (student, portal → Learn) — add before/after work
//     with the client's consent (tick + initials), see each piece's status
//     (waiting for approval / approved / hidden), switch sharing on/off, copy the
//     link or show its QR code.
//   PortfolioPublic  (/learn/{t}/portfolio/{token}) — the student's name, school,
//     and APPROVED work only, with a before/after slider. Nothing else.

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, getToken, Loading } from '@/components/academy/Learn';

/** Shrink a photo on the phone before upload (max 1600px, JPEG). */
async function shrink(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.82, 0.7, 0.58, 0.46]) { const d = c.toDataURL('image/jpeg', q); if (d.length * 0.75 < 850_000) return d; }
  return c.toDataURL('image/jpeg', 0.4);
}
const STATUS: Record<string, [string, string]> = { pending: ['Waiting for approval', 'bg-amber-100 text-amber-900'], approved: ['Approved ✓', 'bg-emerald-100 text-emerald-800'], hidden: ['Hidden by instructor', 'bg-stone-200 text-stone-700'] };

export function PortfolioCard({ tenantId, color }: { tenantId: string; color: string }) {
  const [open, setOpen] = useState(false); const [n, setN] = useState<number | null>(null);
  useEffect(() => { api({ action: 'pf-list', tenantId, token: getToken(tenantId) }).then((r) => setN(r.ok ? r.items.length : 0)); }, [tenantId, open]);
  return (<>
    <button type="button" onClick={() => setOpen(true)} className="glass flex w-full items-center gap-4 rounded-[1.5rem] border border-white/70 p-4 text-left">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ background: `${color}1a` }}>💅</span>
      <span className="min-w-0 flex-1"><span className="block text-lg font-semibold">My portfolio</span><span className="text-sm text-stone-600">{n ? `${n} piece${n === 1 ? '' : 's'} of work` : 'Show your best before-and-afters'}</span></span><span className="text-stone-400">›</span>
    </button>
    {open && <PortfolioHub tenantId={tenantId} color={color} onClose={() => setOpen(false)} />}
  </>);
}

function PortfolioHub({ tenantId, color, onClose }: any) {
  const [d, setD] = useState<any>(null); const [adding, setAdding] = useState(false); const [qr, setQr] = useState<string | null>(null); const [copied, setCopied] = useState(false); const [name, setName] = useState('');
  const load = useCallback(async () => { const r = await api({ action: 'pf-list', tenantId, token: getToken(tenantId) }); if (r.ok) { setD(r); setName(r.share.displayName); } }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const link = d?.share?.token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/learn/${tenantId}/portfolio/${d.share.token}` : '';
  const setShare = async (on: boolean) => { const r = await api({ action: 'pf-share', tenantId, token: getToken(tenantId), on, displayName: name }); if (r.ok) { setD({ ...d, share: r.share }); setQr(null); } };
  const approved = (d?.items || []).filter((x: any) => x.status === 'approved').length;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f5f2]">
      <div className="mx-auto max-w-xl space-y-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between"><p className="text-2xl font-light">💅 My portfolio</p><button type="button" onClick={onClose} className="rounded-full bg-white px-4 py-2 text-sm">Close</button></div>
        {!d ? <Loading /> : <>
          <section className="space-y-3 rounded-3xl bg-white p-4">
            <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Share my portfolio</p><p className="text-[13px] text-stone-500">{d.share.on ? `On — ${approved} approved piece${approved === 1 ? '' : 's'} showing` : 'Off — no one can see it'}</p></div>
              <button type="button" role="switch" aria-checked={d.share.on} onClick={() => setShare(!d.share.on)} className="relative h-8 w-14 shrink-0 rounded-full transition-colors" style={{ background: d.share.on ? color : '#d6d3d1' }}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${d.share.on ? 'left-7' : 'left-1'}`} /></button></div>
            {d.share.on && <>
              <label className="block text-[12px] font-semibold text-stone-500">Name shown<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setShare(true)} className="mt-1 h-11 w-full rounded-2xl border px-3 text-[16px] text-stone-900" /></label>
              <div className="flex gap-2"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* */ } }} className="h-11 flex-1 rounded-full text-sm font-medium text-white" style={{ background: color }}>{copied ? '✓ Link copied' : 'Copy link'}</button>
                <button type="button" onClick={async () => setQr(qr ? null : await QRCode.toDataURL(link, { margin: 1, width: 260 }))} className="h-11 rounded-full bg-stone-100 px-4 text-sm">QR</button>
                <a href={link} target="_blank" rel="noreferrer" className="flex h-11 items-center rounded-full bg-stone-100 px-4 text-sm">View</a></div>
              {qr && <img src={qr} alt="Portfolio QR code" className="mx-auto w-52" />}
              <p className="text-[12px] text-stone-500">Only work your instructor approves is shown. Switch sharing off any time and the link stops working.</p>
            </>}
          </section>
          <button type="button" onClick={() => setAdding(true)} className="h-14 w-full rounded-3xl border-2 border-dashed border-stone-300 bg-white text-sm font-semibold">＋ Add work</button>
          {d.items.length === 0 && <p className="text-center text-sm text-stone-500">Add before-and-after photos of services you’re proud of.</p>}
          <div className="grid gap-3">{d.items.map((x: any) => (
            <div key={x.id} className="space-y-2 rounded-3xl bg-white p-3">
              <div className="grid grid-cols-2 gap-2">{[['Before', x.before], ['After', x.after]].map(([l, u]: any) => <div key={l} className="relative aspect-square overflow-hidden rounded-2xl bg-stone-100">{u ? <img src={u} alt={l} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[12px] text-stone-400">No {String(l).toLowerCase()} photo</span>}<span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">{l}</span></div>)}</div>
              <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{x.service}</p>{x.note && <p className="text-[13px] text-stone-600">{x.note}</p>}{x.reviewNote && <p className="text-[12px] text-stone-500">Instructor: {x.reviewNote}</p>}</div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS[x.status]?.[1] || ''}`}>{STATUS[x.status]?.[0]}</span></div>
              <button type="button" onClick={async () => { if (!window.confirm('Remove this from your portfolio?')) return; await api({ action: 'pf-delete', tenantId, token: getToken(tenantId), id: x.id }); await load(); }} className="text-[12px] text-stone-400 underline">Remove</button>
            </div>
          ))}</div>
        </>}
      </div>
      {adding && <AddWork tenantId={tenantId} color={color} onClose={async (saved: boolean) => { setAdding(false); if (saved) await load(); }} />}
    </div>
  );
}

function PhotoPick({ label, value, onPick }: { label: string; value: string | null; onPick: (d: string) => void }) {
  return (
    <label className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500">
      {value ? <img src={value} alt={label} className="h-full w-full object-cover" /> : <span className="text-center">📷<br />{label}</span>}
      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onPick(await shrink(f)); }} />
    </label>
  );
}
function AddWork({ tenantId, color, onClose }: any) {
  const [before, setBefore] = useState<string | null>(null); const [after, setAfter] = useState<string | null>(null); const [service, setService] = useState(''); const [note, setNote] = useState(''); const [consent, setConsent] = useState(false); const [initials, setInitials] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ready = !!after && service.trim() && consent && initials.trim();
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose(false)}>
      <div onClick={(e) => e.stopPropagation()} className="cf-land max-h-[94dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <p className="text-xl font-semibold">Add work</p>
        <p className="rounded-2xl bg-amber-50 p-3 text-[13px] text-amber-900">📸 Photograph <b>hands and nails only</b> — no faces, no jewellery that identifies your client, nothing in the background with their details.</p>
        <div className="grid grid-cols-2 gap-2"><PhotoPick label="Before (optional)" value={before} onPick={setBefore} /><PhotoPick label="After" value={after} onPick={setAfter} /></div>
        <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Service — e.g. Gel manicure, nude ombré" className="h-12 w-full rounded-2xl border px-4 text-[16px]" />
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (optional) — what you did, what you’re proud of" className="w-full rounded-2xl border p-3 text-[16px]" />
        <label className="flex items-start gap-3 rounded-2xl bg-stone-50 p-3 text-[14px]"><input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>My client agreed to these photos being shown in my portfolio.</span></label>
        {consent && <input value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase())} maxLength={6} placeholder="Client’s initials" className="h-12 w-full rounded-2xl border px-4 text-[16px] uppercase" />}
        {err && <p className="text-sm text-red-700">{err}</p>}
        <button type="button" disabled={!ready || busy} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'pf-add', tenantId, token: getToken(tenantId), before, after, service, note, consent, initials }); setBusy(false); if (r.ok) onClose(true); else setErr(r.error); }} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{busy ? 'Uploading…' : 'Send for approval'}</button>
        <p className="text-center text-[12px] text-stone-500">Your instructor approves each piece before it can be shared.</p>
      </div>
    </div>
  );
}

// ── The public page ─────────────────────────────────────────────────────────
function Compare({ before, after }: { before: string | null; after: string | null }) {
  const [x, setX] = useState(50);
  if (!before) return <img src={after || ''} alt="After" className="aspect-square w-full rounded-3xl object-cover" />;
  return (
    <div className="relative aspect-square w-full select-none overflow-hidden rounded-3xl">
      <img src={after || ''} alt="After" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}><img src={before} alt="Before" className="h-full w-full object-cover" /></div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${x}%` }} />
      <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">Before</span><span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">After</span>
      <input type="range" min={0} max={100} value={x} onChange={(e) => setX(Number(e.target.value))} aria-label="Compare before and after" className="absolute inset-x-4 bottom-3 accent-white" />
    </div>
  );
}
export function PortfolioPublic({ tenantId, token }: { tenantId: string; token: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api({ action: 'portfolio-public', tenantId, token }).then(setD); }, [tenantId, token]);
  if (!d) return <div className="min-h-dvh bg-[#f7f5f2] p-10"><Loading /></div>;
  if (!d.ok) return <div className="flex min-h-dvh items-center justify-center bg-[#f7f5f2] p-6 text-center text-stone-600">{d.error}</div>;
  const c = d.color || '#7c3aed';
  return (
    <div className="min-h-dvh bg-[#f7f5f2] text-stone-900">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <header className="cf-land space-y-2 text-center">{d.logoUrl && <img src={d.logoUrl} alt="" className="mx-auto h-12 w-auto" />}<p className="text-[11px] uppercase tracking-[0.3em] text-stone-500">Portfolio</p><h1 className="text-4xl font-light tracking-tight">{d.name}</h1><p className="text-stone-600">Student at <b style={{ color: c }}>{d.school}</b></p></header>
        {d.items.length === 0 ? <p className="text-center text-stone-500">No work to show yet.</p> :
          <div className="grid gap-5 sm:grid-cols-2">{d.items.map((x: any) => <figure key={x.id} className="space-y-2"><Compare before={x.before} after={x.after} /><figcaption><p className="font-semibold">{x.service}</p>{x.note && <p className="text-[14px] text-stone-600">{x.note}</p>}</figcaption></figure>)}</div>}
        <p className="pt-6 text-center text-[11px] text-stone-400">Shared by the student · Powered by ClarityFlow</p>
      </div>
    </div>
  );
}
