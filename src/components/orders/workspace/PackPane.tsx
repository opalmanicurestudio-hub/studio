'use client';
// src/components/orders/workspace/PackPane.tsx — PACKING, INSIDE THE ORDER. A checklist: tap an item when it's in the
// box, or scan it (a scanner that types, the camera, or the code typed in). Every count can be undone for a few seconds.
// Missing items open refund, swap or send-later. For a ship order the packer picks the box (or boxes) from the shop's
// sizes, and each box gets its photos (open, sealed, label, damage), saved by the server with the order and the box
// (lib/pack-photo). The main button says what's left until everything is in, then finishes: pickup orders go to the
// shelf with a spot and the customer is told; ship orders wait for a label on the Ship tab.
//   active  — being packed: scan, tap, boxes, photos, finish
//   preview — not started yet: what's on the order and where it is
//   review  — packed: what went in, the boxes, and the photos (more can be added until it ships)
// A scan here is a scan at the box: the unit counts as picked and as in the box (lib/retail-fulfill recordBoxScan). With
// "Second scan at packing" on, every unit must be in the box before the order can be finished, and an item picked at the
// shelf (by the staff portal's walk) is scanned again as it goes in. The counts are saved on the order, so it holds on
// any screen and device, and the engine checks it as the order is marked packed. A scan of something another order
// still needs says which order, and its tote.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { doc, updateDoc } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { INSURED_PACK_RULES, PACK_PHOTO_KIND_LABEL, boxesMissingPhoto, insuredPackCheck, packPhotoLimit, packPhotoPolicy, packPhotoRequired, packPhotosOf, type PackPhotoKind } from '@/lib/pack-photo';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { finishPacking, scanInto, stopPacking, tapInto, undoTick } from '@/lib/orders-flow';
import { reopenShortedLine, type Actor } from '@/lib/retail-fulfill';
import { lineMatchesScan } from '@/lib/retail-orders';
import { toteOf } from '@/lib/totes';
import { firstName, money, packProgress } from '@/lib/orders-view';
import { compareBins } from '@/lib/bins';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { MAX_PACK_BOXES, boxFrom, packBoxesOf, presetsOf, type PackBox } from '@/lib/ship-run';
import { learnCode } from '@/lib/scan-resolve';
import { lineProductId } from '@/lib/product-codes';
import { BottomBar, Btn, C, Thumb, UndoBar, feel, muted, Ic } from '../ui';

export type PackMode = 'active' | 'preview' | 'review';

export function PackPane({ fs, tenantId, order, all, actor, rs, photoFor, shelfFor, batch, mode, wide, canManage, onMissing, onFinished, onPutDown, onBoxSizes, onToast }: {
  fs: Firestore; tenantId: string; order: any; all: any[]; actor: Actor; rs: any; photoFor: Map<string, string>; shelfFor: Map<string, string>; batch: any | null;
  mode: PackMode; wide: boolean; canManage: boolean;
  onMissing: (line: any) => void; onFinished: (message: string) => void; onPutDown: () => void; onBoxSizes?: () => void; onToast: (m: string) => void;
}) {
  const active = mode === 'active';
  const [undo, setUndo] = React.useState<{ text: string; lineId: string; what?: 'scan' | 'box' | 'check' } | null>(null);
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
  const [view, setView] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setErr(''); setLearn(null); setUndo(null); setCamera(false); setTyped(''); }, [order.id]);
  // Tapping an item in is allowed unless the shop wants every unit scanned: "scan every item" or "second scan at
  // packing" (here, at the box, is where that scan happens).
  const canTap = rs?.requireScan !== true && rs?.requirePackScan !== true;
  const prog = packProgress(order);
  // THE SECOND SCAN: the shop wants every unit counted into the box (never for a wave order, whose one scan is at the
  // box). What's in the box is saved on the order (qtyPacked); what was picked at the shelf and isn't in yet is scanned
  // again here.
  const boxMode = rs?.requirePackScan === true && !order.waveId;
  const owedOf = (l: any) => Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
  const inBox = (order.lines || []).reduce((a: { done: number; total: number; shelf: number }, l: any) => {
    if (l.digital === true) return a;
    // Units going out: a line partly refunded or sent later still ships what was picked before the rest went missing.
    const owed = owedOf(l); const packed = Math.min(l.qtyPacked || 0, owed);
    return { done: a.done + packed, total: a.total + owed, shelf: a.shelf + Math.max(0, Math.min(l.qtyScanned || 0, owed) - packed) };
  }, { done: 0, total: 0, shelf: 0 });
  const left = boxMode ? Math.max(0, inBox.total - inBox.done) : Math.max(0, prog.total - prog.done);
  // The bar counts what finishing needs: units in the box (second scan) or units counted.
  const shown = boxMode ? inBox : prog;
  // Picked at the shelf, waiting to be scanned into the box.
  const shelfWaiting = active && boxMode ? inBox.shelf : 0;
  const policy = React.useMemo(() => packPhotoPolicy(rs), [rs]);
  // Photos box by box (lib/pack-photo): which box, what it shows, who took it.
  const photos = packPhotosOf(order);
  // An insured box is packed to the insurer's rules and photographed open before it's sealed (lib/pack-photo), so a
  // damage claim holds up.
  const insured = insuredPackCheck(order, rs);
  const photoNeeded = packPhotoRequired(order, policy) || insured;
  const lines = (order.lines || []).filter((l: any) => l.digital !== true).map((l: any, i: number) => ({ l, i })).sort((a: any, b: any) => compareBins(shelfFor.get(lineProductId(a.l)) || '', shelfFor.get(lineProductId(b.l)) || '') || a.i - b.i).map((x: any) => x.l);
  const digital = (order.lines || []).filter((l: any) => l.digital === true);
  // THE BOX. A ship order goes out in the box (or boxes) chosen here; until one is picked, the shop's first saved size.
  const presets = React.useMemo(() => presetsOf(rs), [rs]);
  const chosen = packBoxesOf(order);
  const boxes: PackBox[] = chosen.length ? chosen : presets.length ? [boxFrom(presets[0])] : [];
  const labelled = !!(order.shippoTransactionId || order.labelUrl);
  const showBoxes = order.method === 'ship' && (presets.length > 0 || chosen.length > 0);
  const boxesEditable = active || (mode === 'review' && order.stage === 'packed' && !labelled);
  // A photo of each box open, when one is needed: every box going out has its own.
  const boxCount = Math.max(1, order.method === 'ship' ? boxes.length : 1);
  const photoMissing = photoNeeded ? boxesMissingPhoto(order, boxCount) : [];
  const needPhoto = photoMissing.length > 0;
  const photoCap = packPhotoLimit({ ...order, packBoxes: Array.from({ length: boxCount }) }, policy);
  // Photos are added while packing, and after (until it ships); someone else's order in packing is theirs to photograph.
  const photosOpen = mode !== 'preview' && !(mode === 'review' && order.stage === 'picking') && !['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(String(order.stage));
  const saveBoxes = async (list: PackBox[]) => {
    try { await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { packBoxes: list.slice(0, MAX_PACK_BOXES) }); setErr(''); }
    catch { setErr('The box didn’t save. Try again.'); }
  };

  React.useEffect(() => { if (active && !camera && wide) inputRef.current?.focus(); }, [active, camera, wide, order.id]);

  const after = (r: { ok: boolean; message: string }, name: string, lineId: string, verb: string) => {
    feel(r.ok);
    if (r.ok) { setErr(''); setUndo({ text: `${name} ${verb}`, lineId }); } else setErr(r.message);
  };
  const tap = async (l: any) => {
    if (!active || !canTap || l.qtyScanned >= l.qtyOrdered || ['shorted', 'refunded', 'backordered'].includes(l.status)) return;
    after(await tapInto(fs, tenantId, order.id, l.lineId, actor), l.name, l.lineId, 'ticked');
  };
  // Something that isn't on this order but another order waiting to be packed still needs: which one, and its tote.
  const whoseIs = (v: string) => {
    const o = (all || []).find((x: any) => x.id !== order.id && ['paid', 'picking'].includes(String(x.stage)) && (x.lines || []).some((l: any) => !['shorted', 'refunded', 'backordered'].includes(l.status) && (l.qtyScanned || 0) < (l.qtyOrdered || 0) && lineMatchesScan(l, v)));
    if (!o) return '';
    const tote = toteOf(o);
    return ` It’s on #${String(o.orderNumber ?? '').padStart(4, '0')} for ${firstName(o.customerName)}${tote ? `, tote ${tote}` : ''}: put it with that order.`;
  };
  const scan = async (value: string) => {
    const v = value.trim(); if (!v || !active) return;
    const r = await scanInto(fs, tenantId, order.id, v, actor, rs);
    if (!r.ok) { feel(false); setErr(`${r.message}${r.miss === 'elsewhere' ? whoseIs(v) : ''}`); setLearn(r.miss === 'unknown' && !v.includes('://') ? v : null); return; }
    setLearn(null); feel(true); setErr('');
    // Undone exactly: a scan at the box takes the unit back out; a second scan takes back only its check.
    setUndo({ text: `${r.name || 'Item'} ${r.kind === 'checked' ? 'checked into the box' : 'scanned'}`, lineId: r.lineId || '', what: r.kind === 'checked' ? 'check' : 'box' });
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
    if (showBoxes && !chosen.length && boxes.length) await saveBoxes(boxes);
    const r = await finishPacking(fs, tenantId, order, all, actor, rs);
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    feel(true);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { onFinished(r.message); return; }
    setDone(r.message); setTimeout(() => { setDone(null); onFinished(r.message); }, 1100);
  };
  const refundNow = async (l: any) => {
    setErr('');
    const r = await fetch('/api/retail/swap', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ action: 'refund', tenantId, orderId: order.id, lineId: l.lineId, reason: 'No answer about a swap' }) });
    const d = await r.json().catch(() => ({})); feel(r.ok);
    if (r.ok) setUndo({ text: `${l.name} refunded`, lineId: '' }); else setErr(d.message || d.error || 'That didn’t go through.');
  };
  // A line marked missing that turned up after all: it goes back on the order and the refund it queued comes off,
  // while that refund hasn't been sent (lib/retail-fulfill reopenShortedLine).
  const putBack = async (l: any) => {
    setErr('');
    const r = await reopenShortedLine(fs, tenantId, order.id, l.lineId, actor);
    feel(r.ok); if (r.ok) onToast(`${l.name} is back on the order.`); else setErr(r.message);
  };
  const putDown = async () => { await stopPacking(fs, tenantId, order, batch, actor); onPutDown(); };

  const mainLabel = left > 0 ? `${left} more to go` : needPhoto ? (boxCount > 1 ? `Add a photo of box ${photoMissing[0]} first` : 'Add a photo of the box first') : order.method === 'ship' ? 'Done, packed for shipping' : `Done, it’s ready for ${firstName(order.customerName)}`;

  const pending = Number(order.pendingRefundCents) || 0;

  const itemsList = (
    <div>
      {(mode !== 'preview' || order.stage !== 'paid') && (
        <div className="flex items-center gap-2.5">
          <p className="m-0 shrink-0 text-[13px] font-semibold" style={muted}>In the box</p>
          <div className="h-1.5 flex-1 rounded-full" style={{ background: C.soft }}><div className="cf-glide h-1.5 rounded-full" style={{ width: `${shown.total ? (shown.done / shown.total) * 100 : 100}%`, background: C.mint }} /></div>
          <span className="text-[14px] font-semibold">{shown.done} of {shown.total}</span>
        </div>)}
      {mode === 'preview' && order.stage === 'paid' && <p className="m-0 text-[13px] font-semibold" style={muted}>{lines.length} {lines.length === 1 ? 'item' : 'items'} to pack{shelfFor.size ? ', in shelf order' : ''}</p>}
      <div className="mt-1">
        {lines.map((l: any) => {
          const resolved = ['shorted', 'refunded', 'backordered'].includes(l.status);
          // Struck through only when nothing of it goes out; part of it missing still ships the rest.
          const closed = resolved && owedOf(l) <= 0;
          const part = resolved && !closed;
          const picked = (l.qtyScanned || 0) >= owedOf(l);
          const full = !closed && (boxMode ? (l.qtyPacked || 0) >= owedOf(l) : picked);
          const shelf = shelfFor.get(lineProductId(l));
          const reopen = active && closed && l.status !== 'backordered' && (Number(l.qtyShorted) || 0) > 0 && pending > 0 && order.stage === 'picking';
          const detail = [l.swapForName ? `Swap for ${l.swapForName}` : '', order.swapOffer?.status === 'waiting' && order.swapOffer.lineId === l.lineId ? `Asked about ${order.swapOffer.sub?.name}` : '', l.swappedToName ? `Swapped for ${l.swappedToName}` : '', l.optionsLabel, shelf ? `Shelf ${shelf}` : '',
            closed ? (l.status === 'backordered' ? 'Sending later' : 'Refunded') : mode === 'preview' && order.stage === 'paid' ? `${l.qtyOrdered} to pack` : boxMode ? `${Math.min(l.qtyPacked || 0, owedOf(l))} of ${owedOf(l)} in the box` : `${Math.min(l.qtyScanned || 0, owedOf(l))} of ${owedOf(l)}`,
            part ? `${l.qtyShorted} ${l.status === 'backordered' ? 'sending later' : 'refunded'}` : ''].filter(Boolean).join(' · ');
          return (
            <div key={l.lineId} className={`flex items-center gap-3.5 border-b py-3 ${active ? 'min-h-[72px]' : 'min-h-[60px]'}`} style={{ borderColor: C.line }}>
              <button type="button" onClick={() => void tap(l)} disabled={!active || !canTap || full || closed} aria-label={`${l.name}${full ? ', all in' : active && canTap ? ', tap when it’s in the box' : ''}`} className="flex min-w-0 flex-1 items-center gap-3.5 text-left disabled:cursor-default">
                <Thumb src={photoFor.get(lineProductId(l))} size={active ? 52 : 44} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold tracking-[-0.01em] ${active ? 'text-[17px]' : 'text-[15.5px]'}`} style={closed ? { color: C.muted, textDecoration: 'line-through' } : undefined}>{l.name}{!active && l.qtyOrdered > 1 ? ` × ${l.qtyOrdered}` : ''}</span>
                  <span className="block truncate text-[14px]" style={muted}>{detail}</span>
                </span>
              </button>
              {active && !closed && !picked && (order.swapOffer?.status === 'waiting' && order.swapOffer.lineId === l.lineId
                ? <button type="button" onClick={() => void refundNow(l)} className="h-9 shrink-0 rounded-full px-3 text-[13.5px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>{Date.parse(order.swapOffer.expiresAt) < Date.now() ? 'No answer, refund' : 'Waiting · refund now'}</button>
                : <button type="button" onClick={() => onMissing(l)} className="h-9 shrink-0 rounded-full px-3 text-[13.5px] font-semibold" style={{ background: C.soft }}>Missing</button>)}
              {reopen && <button type="button" onClick={() => void putBack(l)} className="h-9 shrink-0 rounded-full px-3 text-[13.5px] font-semibold" style={{ background: C.soft }}>Found it</button>}
              {!closed && mode !== 'preview' && <span key={full ? 'in' : 'out'} className={`${full ? 'cf-anim-pop ' : ''}grid h-8 w-8 shrink-0 place-items-center rounded-full border-2`} style={full ? { background: C.ok, borderColor: C.ok } : { borderColor: '#d2d3d7' }}>{full ? Ic.check : null}</span>}
            </div>);
        })}
        {digital.map((l: any) => (
          <div key={l.lineId} className="flex min-h-[52px] items-center gap-3.5 border-b py-2.5" style={{ borderColor: C.line }}>
            <Thumb src={photoFor.get(lineProductId(l))} size={40} />
            <span className="min-w-0 flex-1 truncate text-[15px]">{l.name}</span>
            <span className="shrink-0 text-[13.5px]" style={muted}>Download, nothing to pack</span>
          </div>))}
      </div>
      {active && canTap && left > 0 && <p className="m-0 mt-2 text-[14px]" style={muted}>Tap an item when it’s in the box, or scan it. A phone camera, a Bluetooth scanner or typing the code all work.</p>}
    </div>);

  const boxesBlock = showBoxes && (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold" style={muted}>{boxes.length > 1 ? 'Boxes' : 'Box'}</p>
        {onBoxSizes && canManage && <button type="button" onClick={onBoxSizes} className="h-9 text-[13.5px] font-semibold underline underline-offset-4">Box sizes</button>}
      </div>
      {boxes.map((b, i) => (
        <div key={i} role="group" aria-label={boxes.length > 1 ? `Box ${i + 1} size` : 'Box size'} className="mt-2 flex flex-wrap items-center gap-2">
          {boxes.length > 1 && <span aria-hidden="true" className="w-full text-[14px] font-semibold">Box {i + 1}</span>}
          {boxesEditable ? presets.map((p) => {
            const on = b.presetId === p.id;
            return <button key={p.id} type="button" aria-pressed={on} onClick={() => void saveBoxes(boxes.map((x, j) => (j === i ? boxFrom(p) : x)))}
              className="cf-press h-11 rounded-full px-4 text-[15px] font-semibold" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink }}>{p.name}</button>;
          }) : <span className="inline-flex h-10 items-center rounded-full px-4 text-[14.5px] font-semibold" style={{ background: C.soft }}>{b.name} · {+b.lengthIn.toFixed(1)} × {+b.widthIn.toFixed(1)} × {+b.heightIn.toFixed(1)} in</span>}
          {boxesEditable && boxes.length > 1 && <button type="button" aria-label={`Remove box ${i + 1}`} onClick={() => void saveBoxes(boxes.filter((_, j) => j !== i))} className="h-11 px-2 text-[15px] font-semibold" style={muted}>Remove</button>}
        </div>))}
      {boxesEditable && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3">
          {boxes.length < MAX_PACK_BOXES && presets.length > 0 && <button type="button" onClick={() => void saveBoxes([...boxes, boxFrom(presets[0])])} className="h-11 text-[15px] font-semibold">Add a box</button>}
          <span className="text-[13px]" style={muted}>{boxes.length > 1 ? 'A label is bought for each box.' : 'The label is bought for this size.'}</span>
        </div>)}
    </div>);

  const photosBlock = (policy.enabled || insured || photos.length > 0) && mode !== 'preview' && (
    <div>
      {insured && (
        <div className="mb-3 rounded-2xl px-4 py-3.5" style={{ background: C.soft }}>
          <p className="m-0 text-[15px] font-semibold">Insured: pack it so a claim holds up</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {INSURED_PACK_RULES.map((r) => <li key={r} className="flex items-start gap-2.5 text-[14px] leading-snug"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.ink }} />{r}</li>)}
          </ul>
        </div>)}
      <p className="m-0 text-[13px] font-semibold" style={muted}>{boxCount > 1 ? 'Photos of each box' : 'Photos of the box'}</p>
      {Array.from({ length: boxCount }, (_, i) => i + 1).map((box) => {
        const mine = photos.filter((p) => p.box === box || (box === boxCount && p.box > boxCount));
        const missing = photoMissing.includes(box);
        const kind: PackPhotoKind = photoKind[box] || (mine.some((p) => p.kind === 'contents') ? 'sealed' : 'contents');
        return (
          <div key={box} className="mt-2.5 rounded-2xl border px-3.5 py-3" style={{ borderColor: missing && photosOpen ? C.warn : C.line }}>
            {boxCount > 1 && <p className="m-0 text-[14px] font-semibold">Box {box}{missing && photosOpen ? <span className="font-normal" style={{ color: C.warn }}> · needs a photo of it open</span> : null}</p>}
            {mine.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {mine.map((p) => (
                  <figure key={p.url} className="relative m-0">
                    <button type="button" onClick={() => setView(p.url)} aria-label={`See the photo of box ${box}: ${PACK_PHOTO_KIND_LABEL[p.kind]}`} className="block"><img src={p.url} alt="" className="h-16 w-16 rounded-xl object-cover" /></button>
                    <figcaption className="mt-0.5 w-16 truncate text-[11px]" style={muted}>{p.kind === 'contents' ? 'Open' : PACK_PHOTO_KIND_LABEL[p.kind]}{p.by ? ` · ${firstName(p.by)}` : ''}</figcaption>
                    {photosOpen && <button type="button" aria-label={`Take this photo of box ${box} off the order`} onClick={() => void removePhoto(p.url)}
                      className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-[13px] font-semibold" style={{ background: C.paper, border: `1px solid ${C.line}` }}>×</button>}
                  </figure>))}
              </div>)}
            {photosOpen && photos.length < photoCap && (
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
                    <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={`Take a photo of box ${box}`} disabled={photoBusy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addPhoto(box, f); }} />
                  </label>
                  <label className="cursor-pointer text-[14px] font-semibold" style={muted}>
                    or choose one
                    <input type="file" accept="image/*" className="sr-only" aria-label={`Choose a photo of box ${box}`} disabled={photoBusy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addPhoto(box, f); }} />
                  </label>
                </div>
              </>)}
            {!photosOpen && mine.length === 0 && <p className="m-0 mt-1 text-[14px]" style={muted}>No photos of this box.</p>}
          </div>);
      })}
      <p className="m-0 mt-2 text-[13px]" style={muted}>Kept with the order{boxCount > 1 ? ' and each box’s label' : ''}, for a claim or a question about what was inside.</p>
    </div>);

  // Two columns once there's room: what goes in on the left, the boxes and their photos on the right.
  const bar = (
    <div className={`flex gap-2 ${wide ? '' : 'mx-auto max-w-xl'}`}>
      <Btn kind="soft" className="shrink-0" onClick={() => void putDown()}>Put down</Btn>
      <Btn kind={left > 0 || needPhoto ? 'soft' : 'primary'} className="min-w-0 flex-1 text-[17px]" style={left > 0 || needPhoto ? { color: C.muted } : undefined} disabled={left > 0 || needPhoto || busy} onClick={() => void finish()}>{busy ? 'Finishing…' : mainLabel}</Btn>
    </div>);

  return (
    <div>
      {active && <PackScanner onScan={(v) => void scan(v)} />}
      {active && (
        <div className="flex items-center gap-2">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border-2 px-3.5" style={{ borderColor: C.ink }}>
            <span style={muted}>{Ic.scan}</span>
            <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void scan(typed); setTyped(''); } }} aria-label="Scan or type a code" placeholder={boxMode ? 'Scan each item into the box' : canTap ? 'Scan an item, or tap it below' : 'Scan each item'} autoComplete="off" autoCapitalize="off" spellCheck={false} className="min-w-0 flex-1 border-0 bg-transparent text-[15px] shadow-none outline-none ring-0 focus:outline-none focus:ring-0" />
          </label>
          <Btn kind="soft" onClick={() => setCamera((c) => !c)} aria-pressed={camera}>{camera ? 'Hide camera' : 'Camera'}</Btn>
        </div>)}
      {shelfWaiting > 0 && <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}><b className="font-semibold">{shelfWaiting === 1 ? '1 item was' : `${shelfWaiting} items were`} picked at the shelf. </b>Scan {shelfWaiting === 1 ? 'it' : 'each one'} again as it goes into the box.</p>}
      {mode === 'review' && order.stage === 'picking' && order.claimedByName && <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}><b className="font-semibold">{firstName(order.claimedByName)} is packing this order. </b>Take it over to scan and finish it here.</p>}
      {active && camera && <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void scan(v)} label="Point at the item’s barcode" /></div>}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      {active && learn && teachable.length > 0 && (
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

      <div className={`mt-4 ${wide && (showBoxes || photosBlock) ? 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6' : ''}`}>
        {itemsList}
        {(showBoxes || photosBlock) && (
          <div className={wide ? '' : 'mt-5'}>
            {boxesBlock}
            {photosBlock && <div className={showBoxes ? 'mt-5' : ''}>{photosBlock}</div>}
          </div>)}
      </div>
      {pending > 0 && active && <p className="m-0 mt-4 text-[14px]" style={muted}>{money(pending)} is waiting to be refunded for what’s missing. Send it from the order’s refund card.</p>}

      {view && (
        <div role="dialog" aria-modal="true" aria-label="Box photo" className="cf-anim-backdrop fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(22,23,26,.82)' }} onClick={() => setView(null)}>
          <img src={view} alt="Box photo" className="max-h-[86dvh] max-w-full rounded-2xl object-contain" />
          <button type="button" onClick={() => setView(null)} className="fixed right-4 top-4 h-11 rounded-full px-4 text-[15px] font-semibold" style={{ background: C.paper, color: C.ink }}>Close</button>
        </div>)}
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
      {undo && <UndoBar text={undo.text} onUndo={undo.lineId ? () => void undoTick(fs, tenantId, order.id, undo.lineId, actor, undo.what || 'scan') : undefined} onDone={() => setUndo(null)} bottom={wide ? 92 : 104} />}
      {active && (wide
        ? <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t px-6 pb-4 pt-3" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 92%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}>{bar}</div>
        : <BottomBar>{bar}</BottomBar>)}
    </div>);
}

/** The handheld scanner, listening only while the order is being packed (otherwise the order screen hears it: a tote,
 *  a slip or a label). */
function PackScanner({ onScan }: { onScan: (v: string) => void }) {
  useWedgeScanner(onScan);
  return null;
}
