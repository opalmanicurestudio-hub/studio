'use client';
// src/components/orders/PackMode.tsx — PACKING ONE ORDER. A checklist: tap an item when it's in the box, or scan it (a
// scanner that types, or the camera). Every count can be undone for a few seconds. Missing items go to the Missing
// sheet. The main button says what's left until everything is in, then finishes the order: pickup orders go to the
// shelf with a spot and the customer is told; ship orders wait for a label.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { doc, updateDoc } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { packPhotoPolicy, packPhotoRequired, packPhotoPath } from '@/lib/pack-photo';
import { uploadImage } from '@/lib/upload-image';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { finishPacking, scanInto, stopPacking, tapInto, undoTick } from '@/lib/orders-flow';
import { dueLine, firstName, methodLabel, packProgress } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { BottomBar, Btn, C, Thumb, UndoBar, feel, muted, Ic } from './ui';
import { compareBins } from '@/lib/bins';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';

export function PackMode({ fs, tenantId, order, all, actor, rs, photoFor, shelfFor, batch, onClose, onDetails, onMissing, onFinished }: {
  fs: Firestore; tenantId: string; order: any; all: any[]; actor: Actor; rs: any; photoFor: Map<string, string>; shelfFor: Map<string, string>; batch: any | null;
  onClose: () => void; onDetails: () => void; onMissing: (line: any) => void; onFinished: (message: string) => void;
}) {
  const [undo, setUndo] = React.useState<{ text: string; lineId: string } | null>(null);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const canTap = rs?.requireScan !== true;
  const prog = packProgress(order);
  const left = Math.max(0, prog.total - prog.done);
  const policy = React.useMemo(() => packPhotoPolicy(rs), [rs]);
  const photos: string[] = Array.isArray(order.packPhotoUrls) ? order.packPhotoUrls : [];
  const needPhoto = packPhotoRequired(order, policy) && photos.length === 0;
  const due = dueLine(order, rs);
  const lines = (order.lines || []).filter((l: any) => l.digital !== true).map((l: any, i: number) => ({ l, i })).sort((a: any, b: any) => compareBins(shelfFor.get(a.l.productId) || '', shelfFor.get(b.l.productId) || '') || a.i - b.i).map((x: any) => x.l);

  React.useEffect(() => { if (!camera) inputRef.current?.focus(); }, [camera]);

  const after = (r: { ok: boolean; message: string }, name: string, lineId: string, verb: string) => {
    feel(r.ok);
    if (r.ok) { setErr(''); setUndo({ text: `${name} ${verb}`, lineId }); } else setErr(r.message);
  };
  const tap = async (l: any) => {
    if (!canTap || l.qtyScanned >= l.qtyOrdered || ['shorted', 'refunded', 'backordered'].includes(l.status)) return;
    after(await tapInto(fs, tenantId, order.id, l.lineId, actor), l.name, l.lineId, 'ticked');
  };
  const scan = async (value: string) => {
    const v = value.trim(); if (!v) return;
    const before = (order.lines || []).map((l: any) => [l.lineId, l.qtyScanned]);
    const r = await scanInto(fs, tenantId, order.id, v, actor);
    if (!r.ok) { feel(false); setErr(r.message); return; }
    const hit = (order.lines || []).find((l: any) => before.some(([id, q]: any) => id === l.lineId && q < l.qtyOrdered && (l.barcode === v || l.sku === v || v.includes(l.productId)))) || null;
    after(r, hit?.name || 'Item', hit?.lineId || '', 'scanned');
  };
  const addPhoto = async (file?: File | null) => {
    if (!file) return; setPhotoBusy(true);
    try {
      const url = await uploadImage(packPhotoPath(tenantId, order.id, photos.length), file, policy.maxDimension);
      await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { packPhotoUrls: [...photos, url].slice(0, policy.maxPhotos), packPhotoAt: new Date().toISOString(), packPhotoBy: actor.name });
    } catch (e: any) { setErr(e?.message || 'The photo didn’t upload. Try again.'); }
    setPhotoBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    const r = await finishPacking(fs, tenantId, order, all, actor, rs);
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    feel(true);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { onFinished(r.message); return; }
    setDone(r.message); setTimeout(() => onFinished(r.message), 1100);
  };
  const refundNow = async (l: any) => {
    setErr('');
    const r = await fetch('/api/retail/swap', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ action: 'refund', tenantId, orderId: order.id, lineId: l.lineId, reason: 'No answer about a swap' }) });
    const d = await r.json().catch(() => ({})); feel(r.ok);
    if (r.ok) setUndo({ text: `${l.name} refunded`, lineId: '' }); else setErr(d.message || d.error || 'That didn’t go through.');
  };
  const putDown = async () => { await stopPacking(fs, tenantId, order, batch, actor); onClose(); };

  const mainLabel = left > 0 ? `${left} more to go` : needPhoto ? 'Add a photo of the box first' : order.method === 'ship' ? 'Done, packed for shipping' : `Done, it’s ready for ${firstName(order.customerName)}`;

  useWedgeScanner((v) => void scan(v));
  return (
    <div className="cf-anim-push fixed inset-0 z-40 overflow-y-auto" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-xl px-4 pb-40 pt-3">
        <div className="flex h-11 items-center justify-between">
          <button type="button" onClick={() => void putDown()} className="h-11 text-[17px]">Put down</button>
          <span className="text-[15px] font-semibold">Packing</span>
          <button type="button" onClick={onDetails} className="h-11 text-[17px]" style={muted}>Details</button>
        </div>
        <p className="m-0 mt-2.5 text-[28px] font-light tracking-[-0.02em]">{order.customerName || 'Customer'}</p>
        <p className="m-0 mt-0.5 text-[15px]" style={muted}>{methodLabel(order.method)} · <span style={due.late ? { color: C.warn, fontWeight: 600 } : undefined}>{due.text}</span></p>
        <div className="mt-3.5 flex items-center gap-2.5">
          <div className="h-1.5 flex-1 rounded-full" style={{ background: C.soft }}><div className="cf-glide h-1.5 rounded-full" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 100}%`, background: C.mint }} /></div>
          <span className="text-[14px] font-semibold">{prog.done} of {prog.total}</span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border-2 px-3.5" style={{ borderColor: C.ink }}>
            <span style={muted}>{Ic.scan}</span>
            <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void scan(typed); setTyped(''); } }} aria-label="Scan or type a barcode" placeholder={canTap ? 'Scan an item, or tap it below' : 'Scan each item'} className="min-w-0 flex-1 border-0 bg-transparent text-[15px] shadow-none outline-none ring-0 focus:outline-none focus:ring-0" />
          </label>
          <Btn kind="soft" onClick={() => setCamera((c) => !c)} aria-pressed={camera}>{camera ? 'Hide camera' : 'Camera'}</Btn>
        </div>
        {camera && <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void scan(v)} label="Point at the item’s barcode" /></div>}
        {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}

        <div className="mt-2">
          {lines.map((l: any) => {
            const closed = ['shorted', 'refunded', 'backordered'].includes(l.status);
            const full = !closed && l.qtyScanned >= l.qtyOrdered;
            const shelf = shelfFor.get(l.productId);
            return (
              <div key={l.lineId} className="flex min-h-[72px] items-center gap-3.5 border-b py-3" style={{ borderColor: C.line }}>
                <button type="button" onClick={() => void tap(l)} disabled={!canTap || full || closed} aria-label={`${l.name}${full ? ', all in' : canTap ? ', tap when it’s in the box' : ''}`} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
                  <Thumb src={photoFor.get(l.productId)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-semibold tracking-[-0.01em]" style={closed ? { color: C.muted, textDecoration: 'line-through' } : undefined}>{l.name}</span>
                    <span className="block truncate text-[14px]" style={muted}>{[l.swapForName ? `Swap for ${l.swapForName}` : '', order.swapOffer?.status === 'waiting' && order.swapOffer.lineId === l.lineId ? `Asked about ${order.swapOffer.sub?.name}` : '', l.swappedToName ? `Swapped for ${l.swappedToName}` : '', l.optionsLabel, shelf ? `Shelf ${shelf}` : '', closed ? (l.status === 'backordered' ? 'Sending later' : 'Refunded') : `${l.qtyScanned} of ${l.qtyOrdered}`].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                {!closed && !full && (order.swapOffer?.status === 'waiting' && order.swapOffer.lineId === l.lineId
                  ? <button type="button" onClick={() => void refundNow(l)} className="h-9 shrink-0 rounded-full px-3 text-[13.5px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>{Date.parse(order.swapOffer.expiresAt) < Date.now() ? 'No answer, refund' : 'Waiting · refund now'}</button>
                  : <button type="button" onClick={() => onMissing(l)} className="h-9 shrink-0 rounded-full px-3 text-[13.5px] font-semibold" style={{ background: C.soft }}>Missing</button>)}
                {!closed && <span key={full ? 'in' : 'out'} className={`${full ? 'cf-anim-pop ' : ''}grid h-8 w-8 shrink-0 place-items-center rounded-full border-2`} style={full ? { background: C.ok, borderColor: C.ok } : { borderColor: '#d2d3d7' }}>{full ? Ic.check : null}</span>}
              </div>);
          })}
        </div>
        {canTap && left > 0 && <p className="m-0 mt-2 text-[14px]" style={muted}>Tap an item when it’s in the box, or scan it.</p>}

        {(policy.enabled || photos.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {photos.map((u) => <img key={u} src={u} alt="Box photo" className="h-16 w-16 rounded-xl object-cover" />)}
            {photos.length < policy.maxPhotos && (
              <label className="inline-flex h-12 cursor-pointer items-center rounded-full border px-5 text-[15px] font-semibold" style={{ borderColor: needPhoto ? C.warn : C.line, color: needPhoto ? C.warn : C.ink }}>
                {photoBusy ? 'Uploading…' : photos.length ? 'Add another photo' : needPhoto ? 'Add a photo of the box (needed)' : 'Add a photo of the box'}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void addPhoto(e.target.files?.[0])} />
              </label>)}
          </div>)}
      </div>

      {done !== null && (
        <div role="status" aria-live="polite" className="cf-anim-backdrop fixed inset-0 z-50 grid place-items-center px-8 text-center" style={{ background: C.paper, color: C.ink }}>
          <div>
            <span className="cf-anim-pop mx-auto grid h-24 w-24 place-items-center rounded-full" style={{ background: C.ok }}>
              <svg className="cf-anim-draw" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <p className="cf-anim-rise m-0 mt-6 text-[28px] font-light tracking-[-0.02em]">{order.method === 'ship' ? 'Packed' : `Ready for ${firstName(order.customerName)}`}</p>
            {done ? <p className="cf-anim-rise m-0 mt-1 text-[15px]" style={muted}>{done}</p> : null}
          </div>
        </div>)}
      {undo && <UndoBar text={undo.text} onUndo={undo.lineId ? () => void undoTick(fs, tenantId, order.id, undo.lineId, actor) : undefined} onDone={() => setUndo(null)} />}
      <BottomBar>
        <div className="mx-auto max-w-xl"><Btn kind={left > 0 || needPhoto ? 'soft' : 'primary'} className="w-full text-[17px]" style={left > 0 || needPhoto ? { color: C.muted } : undefined} disabled={left > 0 || needPhoto || busy} onClick={() => void finish()}>{busy ? 'Finishing…' : mainLabel}</Btn></div>
      </BottomBar>
    </div>);
}
