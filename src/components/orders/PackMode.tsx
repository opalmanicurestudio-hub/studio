'use client';
// src/components/orders/PackMode.tsx — PACKING ONE ORDER. A checklist: tap an item when it's in the box, or scan it (a
// scanner that types, or the camera). Every count can be undone for a few seconds. Missing items go to the Missing
// sheet. The main button says what's left until everything is in, then finishes the order: pickup orders go to the
// shelf with a spot and the customer is told; ship orders wait for a label. For a ship order the packer picks the box
// (or boxes) from the shop's saved sizes, and the labels are bought for those boxes (lib/ship-run). An insured order
// shows the insurer's packing rules and needs a photo of the open box before it's done (lib/pack-photo).
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { doc, updateDoc } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { INSURED_PACK_RULES, PACK_PHOTO_KIND_LABEL, boxesMissingPhoto, insuredPackCheck, packPhotoLimit, packPhotoPolicy, packPhotoRequired, packPhotosOf, type PackPhotoKind } from '@/lib/pack-photo';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { finishPacking, scanInto, stopPacking, tapInto, undoTick } from '@/lib/orders-flow';
import { dueLine, firstName, methodLabel, packProgress } from '@/lib/orders-view';
import { useTenant } from '@/context/TenantContext';
import { tenantTimeZone } from '@/lib/tenant-time';
import type { Actor } from '@/lib/retail-fulfill';
import { BottomBar, Btn, C, Thumb, UndoBar, feel, muted, Ic } from './ui';
import { compareBins } from '@/lib/bins';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { MAX_PACK_BOXES, boxFrom, packBoxesOf, presetsOf, type PackBox } from '@/lib/ship-run';
import { learnCode } from '@/lib/scan-resolve';
import { lineProductId } from '@/lib/product-codes';

export function PackMode({ fs, tenantId, order, all, actor, rs, photoFor, shelfFor, batch, onClose, onDetails, onMissing, onFinished }: {
  fs: Firestore; tenantId: string; order: any; all: any[]; actor: Actor; rs: any; photoFor: Map<string, string>; shelfFor: Map<string, string>; batch: any | null;
  onClose: () => void; onDetails: () => void; onMissing: (line: any) => void; onFinished: (message: string) => void;
}) {
  const [undo, setUndo] = React.useState<{ text: string; lineId: string } | null>(null);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  // A code no product has yet: the packer can say which item it is, and it's added to that product.
  const [learn, setLearn] = React.useState<string | null>(null);
  const [learnBusy, setLearnBusy] = React.useState('');
  const [photoBusy, setPhotoBusy] = React.useState<number | null>(null);
  // What the next photo of each box shows (open with its contents first, then sealed).
  const [photoKind, setPhotoKind] = React.useState<Record<number, PackPhotoKind>>({});
  const [done, setDone] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Tapping an item in is allowed unless the shop wants every unit scanned: "scan every item" or "second scan at
  // packing" (here, at the box, is where that scan happens).
  const canTap = rs?.requireScan !== true && rs?.requirePackScan !== true;
  const prog = packProgress(order);
  const left = Math.max(0, prog.total - prog.done);
  const policy = React.useMemo(() => packPhotoPolicy(rs), [rs]);
  // Photos box by box (lib/pack-photo): which box, what it shows, who took it.
  const photos = packPhotosOf(order);
  // An insured box is packed to the insurer's rules and photographed open before it's sealed (lib/pack-photo), so a
  // damage claim holds up.
  const insured = insuredPackCheck(order, rs);
  const photoNeeded = packPhotoRequired(order, policy) || insured;
  const { selectedTenant } = useTenant() as any;
  const due = dueLine(order, rs, Date.now(), tenantTimeZone(selectedTenant));
  const lines = (order.lines || []).filter((l: any) => l.digital !== true).map((l: any, i: number) => ({ l, i })).sort((a: any, b: any) => compareBins(shelfFor.get(lineProductId(a.l)) || '', shelfFor.get(lineProductId(b.l)) || '') || a.i - b.i).map((x: any) => x.l);
  // THE BOX. A ship order goes out in the box (or boxes) chosen here; until one is picked, the shop's first saved size.
  const presets = React.useMemo(() => presetsOf(rs), [rs]);
  const chosen = packBoxesOf(order);
  const boxes: PackBox[] = chosen.length ? chosen : presets.length ? [boxFrom(presets[0])] : [];
  const showBoxes = order.method === 'ship' && presets.length > 0;
  // A photo of each box open, when one is needed: every box going out has its own.
  const boxCount = Math.max(1, order.method === 'ship' ? boxes.length : 1);
  const photoMissing = photoNeeded ? boxesMissingPhoto(order, boxCount) : [];
  const needPhoto = photoMissing.length > 0;
  const photoCap = packPhotoLimit({ ...order, packBoxes: Array.from({ length: boxCount }) }, policy);
  const saveBoxes = async (list: PackBox[]) => {
    try { await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { packBoxes: list.slice(0, MAX_PACK_BOXES) }); setErr(''); }
    catch { setErr('The box didn’t save. Try again.'); }
  };

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
    const r = await scanInto(fs, tenantId, order.id, v, actor);
    if (!r.ok) { feel(false); setErr(r.message); setLearn(r.miss === 'unknown' && !v.includes('://') ? v : null); return; }
    setLearn(null);
    after(r, r.name || 'Item', r.lineId || '', 'scanned');
  };
  // The items a new code can be added to: still waiting, and a real product (a test item stands for one).
  const teachable = lines.filter((l: any) => !['shorted', 'refunded', 'backordered'].includes(l.status) && l.qtyScanned < l.qtyOrdered && !lineProductId(l).startsWith('test-'));
  // "It's this one": the code is added to that item's product, then counted.
  const teach = async (l: any) => {
    if (!learn) return;
    setLearnBusy(l.lineId);
    const r = await learnCode(fs, tenantId, lineProductId(l), learn);
    setLearnBusy('');
    if (!r.ok) { feel(false); setErr(r.message); return; }
    const code = learn; setLearn(null); setErr('');
    await scan(code);
  };
  // The photo is made a small JPEG here (an iPhone's HEIC included) and saved by the server with the order and its box.
  const addPhoto = async (box: number, file?: File | null) => {
    if (!file) return; setPhotoBusy(box); setErr('');
    try {
      const dataUrl = await downscaleImageToDataUrl(file, { maxDim: policy.maxDimension });
      const kind: PackPhotoKind = photoKind[box] || (photos.some((p) => p.box === box && p.kind === 'contents') ? 'sealed' : 'contents');
      const r = await fetch('/api/retail/pack-photo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify({ tenantId, orderId: order.id, dataUrl, box, kind }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || 'The photo didn’t save. Try again.');
      feel(true);
      setPhotoKind((k) => ({ ...k, [box]: kind === 'contents' ? 'sealed' : kind }));
    } catch (e: any) { feel(false); setErr(e?.message || 'The photo didn’t save. Try again.'); }
    setPhotoBusy(null);
  };
  const removePhoto = async (url: string) => {
    setErr('');
    const r = await fetch('/api/retail/pack-photo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
      body: JSON.stringify({ tenantId, orderId: order.id, action: 'remove', url }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) setErr(d.error || 'That photo couldn’t be taken off. Try again.');
  };
  const finish = async () => {
    setBusy(true);
    // The box it's in is kept with the order, so its label is bought for that size.
    if (showBoxes && !chosen.length) await saveBoxes(boxes);
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

  const mainLabel = left > 0 ? `${left} more to go` : needPhoto ? (boxCount > 1 ? `Add a photo of box ${photoMissing[0]} first` : 'Add a photo of the box first') : order.method === 'ship' ? 'Done, packed for shipping' : `Done, it’s ready for ${firstName(order.customerName)}`;

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
        {learn && teachable.length > 0 && (
          <div className="mt-2.5 rounded-2xl px-4 py-3" style={{ background: C.soft }}>
            <p className="m-0 text-[14px] font-semibold">Which item has the code {learn.slice(0, 40)}?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {teachable.map((l: any) => (
                <button key={l.lineId} type="button" onClick={() => void teach(l)} disabled={!!learnBusy} className="cf-press h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                  {learnBusy === l.lineId ? 'Adding…' : `Add to ${l.name}`}
                </button>))}
              <button type="button" onClick={() => setLearn(null)} className="h-10 px-2 text-[14px] font-semibold" style={muted}>Not now</button>
            </div>
            <p className="m-0 mt-2 text-[13px]" style={muted}>It’s added to that product, so it scans here, at the register and when stock comes in.</p>
          </div>)}

        <div className="mt-2">
          {lines.map((l: any) => {
            const closed = ['shorted', 'refunded', 'backordered'].includes(l.status);
            const full = !closed && l.qtyScanned >= l.qtyOrdered;
            const shelf = shelfFor.get(lineProductId(l));
            return (
              <div key={l.lineId} className="flex min-h-[72px] items-center gap-3.5 border-b py-3" style={{ borderColor: C.line }}>
                <button type="button" onClick={() => void tap(l)} disabled={!canTap || full || closed} aria-label={`${l.name}${full ? ', all in' : canTap ? ', tap when it’s in the box' : ''}`} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
                  <Thumb src={photoFor.get(lineProductId(l))} />
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

        {showBoxes && (
          <div className="mt-5">
            <p className="m-0 text-[13px] font-semibold" style={muted}>{boxes.length > 1 ? 'Boxes' : 'Box'}</p>
            {boxes.map((b, i) => (
              <div key={i} role="group" aria-label={boxes.length > 1 ? `Box ${i + 1} size` : 'Box size'} className="mt-2 flex flex-wrap items-center gap-2">
                {boxes.length > 1 && <span aria-hidden="true" className="w-full text-[14px] font-semibold">Box {i + 1}</span>}
                {presets.map((p) => {
                  const on = b.presetId === p.id;
                  return <button key={p.id} type="button" aria-pressed={on} onClick={() => void saveBoxes(boxes.map((x, j) => (j === i ? boxFrom(p) : x)))}
                    className="cf-press h-11 rounded-full px-4 text-[15px] font-semibold" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink }}>{p.name}</button>;
                })}
                {boxes.length > 1 && <button type="button" aria-label={`Remove box ${i + 1}`} onClick={() => void saveBoxes(boxes.filter((_, j) => j !== i))} className="h-11 px-2 text-[15px] font-semibold" style={muted}>Remove</button>}
              </div>))}
            <div className="mt-2 flex flex-wrap items-center gap-x-3">
              {boxes.length < MAX_PACK_BOXES && <button type="button" onClick={() => void saveBoxes([...boxes, boxFrom(presets[0])])} className="h-11 text-[15px] font-semibold">Add a box</button>}
              <span className="text-[13px]" style={muted}>{boxes.length > 1 ? 'A label is bought for each box.' : 'The label is bought for this size.'}</span>
            </div>
          </div>)}

        {insured && (
          <div className="mt-5 rounded-2xl px-4 py-3.5" style={{ background: C.soft }}>
            <p className="m-0 text-[15px] font-semibold">Insured: pack it so a claim holds up</p>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
              {INSURED_PACK_RULES.map((r) => <li key={r} className="flex items-start gap-2.5 text-[14px] leading-snug"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.ink }} />{r}</li>)}
            </ul>
          </div>)}
        {(policy.enabled || insured || photos.length > 0) && (
          <div className="mt-5">
            <p className="m-0 text-[13px] font-semibold" style={muted}>{boxCount > 1 ? 'Photos of each box' : 'Photos of the box'}</p>
            {Array.from({ length: boxCount }, (_, i) => i + 1).map((box) => {
              const mine = photos.filter((p) => p.box === box || (box === boxCount && p.box > boxCount));
              const missing = photoMissing.includes(box);
              const kind: PackPhotoKind = photoKind[box] || (mine.some((p) => p.kind === 'contents') ? 'sealed' : 'contents');
              return (
                <div key={box} className="mt-2.5 rounded-2xl border px-3.5 py-3" style={{ borderColor: missing ? C.warn : C.line }}>
                  {boxCount > 1 && <p className="m-0 text-[14px] font-semibold">Box {box}</p>}
                  {mine.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {mine.map((p) => (
                        <figure key={p.url} className="relative m-0">
                          <img src={p.url} alt={`Box ${box}: ${PACK_PHOTO_KIND_LABEL[p.kind]}`} className="h-16 w-16 rounded-xl object-cover" />
                          <figcaption className="mt-0.5 w-16 truncate text-[11px]" style={muted}>{p.kind === 'contents' ? 'Open' : PACK_PHOTO_KIND_LABEL[p.kind]}</figcaption>
                          <button type="button" aria-label={`Take this photo of box ${box} off the order`} onClick={() => void removePhoto(p.url)}
                            className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-[13px] font-semibold" style={{ background: C.paper, border: `1px solid ${C.line}` }}>×</button>
                        </figure>))}
                    </div>)}
                  {photos.length < photoCap && (
                    <>
                      <div role="group" aria-label={`What the next photo of box ${box} shows`} className="mt-2 flex flex-wrap gap-1.5">
                        {(['contents', 'sealed', 'label', 'damage'] as PackPhotoKind[]).map((k) => (
                          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setPhotoKind((x) => ({ ...x, [box]: k }))}
                            className="h-8 rounded-full px-3 text-[13px] font-semibold" style={kind === k ? { background: C.ink, color: C.paper } : { background: C.soft }}>
                            {k === 'contents' ? 'Open' : PACK_PHOTO_KIND_LABEL[k]}
                          </button>))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <label className="inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-[15px] font-semibold" style={{ borderColor: missing ? C.warn : C.line, color: missing ? C.warn : C.ink }}>
                          {photoBusy === box ? 'Saving…' : missing ? 'Take a photo (needed)' : 'Take a photo'}
                          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoBusy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addPhoto(box, f); }} />
                        </label>
                        <label className="cursor-pointer text-[14px] font-semibold" style={muted}>
                          or choose one
                          <input type="file" accept="image/*" className="sr-only" disabled={photoBusy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addPhoto(box, f); }} />
                        </label>
                      </div>
                    </>)}
                </div>);
            })}
            <p className="m-0 mt-2 text-[13px]" style={muted}>Kept with the order{boxCount > 1 ? ' and each box’s label' : ''}, for a claim or a question about what was inside.</p>
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
