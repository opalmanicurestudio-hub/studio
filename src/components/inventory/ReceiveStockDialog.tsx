'use client';
// src/components/inventory/ReceiveStockDialog.tsx — RECEIVING A DELIVERY. Each line of the purchase order with what came
// in: counted by scanning (the camera, or a USB or Bluetooth scanner, anytime the sheet is open) or typed in, with what
// arrived damaged, its lot and its expiry. One scan, any code (lib/code-lookup):
//   • a unit's code counts one; a case's or a pallet's asks first ("Counts as 12. Expected on this delivery: 24." Add
//     12, or just one);
//   • a listing's own code with two of its variants on the delivery asks which variant it is;
//   • a code no product has yet asks which product it is, and is saved to it, so every scanner knows it from then on.
// A line starts at what was ordered (a delivery that came complete is just confirmed); scanning a line counts it from
// zero, and a count typed in is kept. Once scanning starts, a line nobody counted says so, and nothing is added to stock
// until a count that doesn't match the order has been looked at.
import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { type InventoryItem, type Order } from '@/lib/data';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { learnProductCode } from '@/lib/codes-api';
import { askWhich, codeBook, lookupCode, notHereWords, pickFor } from '@/lib/code-lookup';
import { codeForm, codeKindLabel } from '@/lib/code-form';
import { UnknownCodePanel } from '@/components/inventory/UnknownCodePanel';
import { Btn, C, muted } from '@/components/orders/ui';
import { format } from 'date-fns';

export type ReceivedItem = {
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityDamaged: number;
  costPerUnit: number;
  expirationDate?: Date;
  lot?: string;
};

interface ReceiveStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onConfirm: (receivedItems: ReceivedItem[]) => void;
  inventory?: InventoryItem[];
}

/** What a scan is waiting on: a case to confirm, a variant to choose, a code to give a product. */
type Ask =
  | { kind: 'case'; productId: string; pack: number; label: string; raw: string }
  | { kind: 'which'; listing: string; productIds: string[] }
  | { kind: 'unknown'; code: string }
  | null;

export const ReceiveStockDialog: React.FC<ReceiveStockDialogProps> = ({ open, onOpenChange, order, onConfirm, inventory = [] }) => {
  const isMobile = useIsMobile();
  const ctx = useInventory() as any;
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  // Every item's codes, tools and supplies included: a delivery can hold anything in inventory.
  const items: any[] = (inventory && inventory.length ? inventory : ctx?.inventory) || [];
  const book = React.useMemo(() => codeBook(items, { equipment: true }), [items]);
  const byId = React.useMemo(() => new Map(items.map((i: any) => [String(i.id), i])), [items]);
  const [receivedItems, setReceived] = useState<ReceivedItem[]>([]);
  const [counted, setCountedState] = useState<Set<string>>(new Set());
  // The latest counts, for scans that arrive faster than the screen redraws (a scanner reads one after another).
  const itemsRef = React.useRef<ReceivedItem[]>([]); const countedRef = React.useRef<Set<string>>(new Set());
  const setReceivedItems = (next: ReceivedItem[]) => { itemsRef.current = next; setReceived(next); };
  const markCounted = (ids: string[]) => { const n = new Set(countedRef.current); ids.forEach((id) => n.add(id)); countedRef.current = n; setCountedState(n); };
  const [camera, setCamera] = useState(false);
  const [ask, setAskState] = useState<Ask>(null);
  // Read by the next scan straight away, so two scans in a row can't pass a question still open.
  const askRef = React.useRef<Ask>(null);
  const setAsk = (a: Ask) => { askRef.current = a; setAskState(a); };
  const [note, setNote] = useState<{ text: string; ok?: boolean } | null>(null);
  const [review, setReview] = useState(false);
  const [openLot, setOpenLot] = useState<string | null>(null);

  useEffect(() => {
    countedRef.current = new Set(); setCountedState(new Set()); setAsk(null); setNote(null); setReview(false); setCamera(false); setOpenLot(null);
    if (order) {
      setReceivedItems(order.items.map((item) => ({
        productId: item.productId, productName: item.productName, quantityOrdered: item.quantity,
        quantityReceived: item.quantity, quantityDamaged: 0, costPerUnit: item.costPerUnit, expirationDate: undefined,
      })));
    }
  }, [order]);   // eslint-disable-line react-hooks/exhaustive-deps

  const lineOf = (id: string) => itemsRef.current.find((ri) => ri.productId === id) || null;
  /** Count units of a line: the first count of a line starts it from zero, then adds. */
  const countIn = (productId: string, units: number) => {
    const ri = lineOf(productId); if (!ri) return;
    const now = (countedRef.current.has(productId) ? ri.quantityReceived : 0) + units;
    markCounted([productId]);
    setReceivedItems(itemsRef.current.map((x) => (x.productId === productId ? { ...x, quantityReceived: now } : x)));
    scanFeedback(true); setAsk(null); setReview(false);
    setNote({ ok: true, text: `${ri.productName}: ${now} of ${ri.quantityOrdered}` });
  };

  const onReceiveScan = (value: string) => {
    undoScanTyping();
    const raw = String(value || '').trim(); if (!raw) return;
    // A question still open (a case to confirm, a variant or a product to choose) is answered first, so a case is never
    // left uncounted by the next scan.
    if (askRef.current) { scanFeedback(false); setNote({ text: 'Finish this one first, then scan again.' }); return; }
    // The product the scan is: any code it carries, as every scanner reads it (lib/code-lookup).
    const found = lookupCode(book, raw);
    const lines = itemsRef.current;
    const picked = pickFor(found, lines, (ri) => ri.productId);
    const which = askWhich(found, picked, (ri) => ri.productId, (ri) => ri.productName, 'this delivery');
    if (which) {
      scanFeedback(false); setNote(null);
      setAsk({ kind: 'which', listing: found.kind === 'choose' ? String(found.listing.name || 'This product') : 'That code', productIds: [...new Set(picked.many.map((ri) => ri.productId))] });
      return;
    }
    // Typed in, a product's name or its id finds its line too.
    const lower = raw.toLowerCase(); const name = codeForm(raw);
    const hit = picked.pick || lines.find((ri) => ri.productId === raw || ri.productId.toLowerCase() === lower)
      || (name ? lines.find((ri) => codeForm(ri.productName) === name) : undefined) || null;
    if (!hit) {
      scanFeedback(false);
      if (found.kind === 'none' && !found.owner && !raw.includes('://')) { setNote(null); setAsk({ kind: 'unknown', code: raw }); return; }
      setAsk(null);
      setNote({ text: found.kind === 'product' ? `That’s ${found.item.name || 'another product'}, which isn’t on this delivery.`
        : notHereWords(found, 'isn’t on this delivery', 'receive') || 'Nothing on this delivery has that code. Count it in the list below.' });
      return;
    }
    const pack = found.kind === 'product' ? found.pack : 1;
    if (pack > 1 && found.kind === 'product') {
      scanFeedback(true); setNote(null);
      setAsk({ kind: 'case', productId: hit.productId, pack, label: codeKindLabel(found.via === 'pallet' ? 'pallet' : 'case', pack), raw });
      return;
    }
    countIn(hit.productId, 1);
  };
  // A USB or Bluetooth scanner counts too, whenever this is open (the camera box hears it first while it's showing).
  useWedgeScanner(onReceiveScan, open && !!order);

  const teach = async (productId: string, name: string) => {
    if (ask?.kind !== 'unknown') return { ok: false, message: 'Scan the code again.' };
    const r: any = await learnProductCode(tenantId, productId, ask.code);
    if (!r.ok) return { ok: false, message: r.error };
    if (lineOf(productId)) countIn(productId, 1);
    else { setAsk(null); setNote({ ok: true, text: `Saved to ${name}. It isn’t on this delivery, so nothing was counted.` }); }
    return { ok: true, message: '' };
  };

  // A scanner used while a count box has the cursor types the code into it before the scan arrives: what the line
  // was before that burst of keys is kept, and put back when the scan comes (lib/use-wedge-scanner, data-scan-field).
  const typed = React.useRef<{ id: string; base: ReceivedItem; wasCounted: boolean; at: number } | null>(null);
  const typeCount = (productId: string, field: 'quantityReceived' | 'quantityDamaged', raw: string) => {
    const now = performance.now(); const t = typed.current;
    if (!t || t.id !== productId || now - t.at > 80) { const base = lineOf(productId); if (base) typed.current = { id: productId, base, wasCounted: countedRef.current.has(productId), at: now }; }
    else t.at = now;
    handleItemChange(productId, field, Math.max(0, Math.min(99999, parseInt(raw) || 0)));
  };
  const undoScanTyping = () => {
    const t = typed.current; typed.current = null;
    const el = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    if (!t || !el || el.dataset?.countOf !== t.id || performance.now() - t.at > 400) return;
    setReceivedItems(itemsRef.current.map((x) => (x.productId === t.id ? t.base : x)));
    if (!t.wasCounted) { const n = new Set(countedRef.current); n.delete(t.id); countedRef.current = n; setCountedState(n); }
    el.blur();
  };

  const handleItemChange = (productId: string, field: 'quantityReceived' | 'quantityDamaged' | 'expirationDate' | 'lot', value: number | Date | string | undefined) => {
    // A received count typed in is a count: a scan after it adds to it (only a line no one has counted yet starts from
    // zero). A damaged count alone isn't: the received box still holds what was ordered.
    if (field === 'quantityReceived') markCounted([productId]);
    setReview(false);
    setReceivedItems(itemsRef.current.map((item) => {
      if (item.productId !== productId) return item;
      const updated = { ...item, [field]: value } as ReceivedItem;
      if (field === 'quantityReceived' || field === 'quantityDamaged') {
        const received = field === 'quantityReceived' ? (value as number) : updated.quantityReceived;
        const damaged = field === 'quantityDamaged' ? (value as number) : updated.quantityDamaged;
        if (received + damaged > item.quantityOrdered) {
          if (field === 'quantityReceived') updated.quantityDamaged = Math.max(0, item.quantityOrdered - received);
          else updated.quantityReceived = Math.max(0, item.quantityOrdered - damaged);
        }
      }
      return updated;
    }));
  };

  // A short delivery is the supplier's problem, but only if someone notices it at the door.
  const scanning = counted.size > 0;
  const uncounted = scanning ? receivedItems.filter((ri) => !counted.has(ri.productId)) : [];
  const offLines = receivedItems.filter((ri) => counted.has(ri.productId) || !scanning).filter((ri) => ri.quantityReceived + ri.quantityDamaged !== ri.quantityOrdered);
  const countedLines = receivedItems.filter((ri) => counted.has(ri.productId)).length;
  const confirm = () => {
    if (!review && (offLines.length || uncounted.length)) { setReview(true); return; }
    onConfirm(receivedItems);
    onOpenChange(false);
  };
  const zeroUncounted = () => {
    const ids = new Set(uncounted.map((ri) => ri.productId));
    setReceivedItems(itemsRef.current.map((ri) => (ids.has(ri.productId) ? { ...ri, quantityReceived: 0 } : ri)));
    markCounted([...ids]);
  };

  if (!order) return null;
  const stockOf = (id: string) => Math.max(0, Math.floor(Number(byId.get(id)?.totalStock) || 0));
  const field = 'h-11 w-full rounded-xl border bg-transparent px-3 text-[15px] tabular-nums outline-none';

  const askCard = ask && (
    <div className="flex flex-col gap-2.5 rounded-[18px] border p-3.5" style={{ borderColor: C.line, background: ask.kind === 'which' ? C.soft : C.paper }}>
      {ask.kind === 'case' && (() => { const ri = lineOf(ask.productId); return (<>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[26px] items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: C.soft }}>{ask.label}</span>
          <span className="break-all text-[12.5px] tabular-nums" style={muted}>{ask.raw}</span>
        </div>
        <p className="m-0 text-[19px] font-semibold tracking-[-0.01em]">{ri?.productName || 'This product'}</p>
        <p className="m-0 -mt-1 text-[13.5px]" style={muted}>Counts as {ask.pack}. Expected on this delivery: {ri?.quantityOrdered ?? 0}.</p>
        <div className="flex gap-2">
          <Btn kind="primary" className="h-12 flex-1 text-[14.5px]" onClick={() => countIn(ask.productId, ask.pack)}>Add {ask.pack}</Btn>
          <Btn kind="soft" className="h-12 text-[14.5px]" style={{ border: `1px solid ${C.line}`, background: C.paper }} onClick={() => countIn(ask.productId, 1)}>Just one</Btn>
        </div>
        <button type="button" onClick={() => { setAsk(null); setNote(null); }} className="h-10 self-start px-1 text-[14px] font-semibold" style={muted}>Not now</button>
      </>); })()}
      {ask.kind === 'which' && (<>
        <p className="m-0 text-[13px] font-semibold" style={muted}>{ask.listing}’s own code</p>
        <p className="m-0 text-[16px] font-semibold">Which variant is it?</p>
        {ask.productIds.map((id) => (
          <button key={id} type="button" onClick={() => countIn(id, 1)} className="cf-press flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[14px] border px-3.5 text-left text-[14.5px] font-semibold" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>
            <span className="min-w-0 truncate">{lineOf(id)?.productName || byId.get(id)?.name || 'Variant'}</span>
            <span className="shrink-0 text-[13px] font-medium" style={muted}>{stockOf(id)} in stock</span>
          </button>))}
        <button type="button" onClick={() => { setAsk(null); setNote(null); }} className="h-10 self-start px-1 text-[14px] font-semibold" style={muted}>Not now</button>
      </>)}
      {ask.kind === 'unknown' && (
        <UnknownCodePanel code={ask.code} where="On this delivery" inventory={items}
          options={receivedItems.map((ri) => ({ productId: ri.productId, name: ri.productName }))}
          onSave={teach} onCancel={() => { setAsk(null); setNote(null); }} />)}
    </div>);

  const body = (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: C.paper, color: C.ink }}>
      <div className="shrink-0 border-b px-5 pb-4 pt-5" style={{ borderColor: C.line }}>
        <div className="flex items-start justify-between gap-3 pr-9">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold" style={muted}>Receiving{order.id ? ` · delivery ${String(order.id).slice(-6).toUpperCase()}` : ''}</p>
            {isMobile ? <SheetTitle className="m-0 mt-0.5 text-[24px] font-light leading-tight tracking-[-0.02em]">{order.supplier || 'Delivery'}</SheetTitle>
              : <DialogTitle className="m-0 mt-0.5 text-[24px] font-light leading-tight tracking-[-0.02em]">{order.supplier || 'Delivery'}</DialogTitle>}
            {isMobile ? <SheetDescription className="m-0 mt-0.5 text-[14px]" style={muted}>{scanning ? `${countedLines} of ${receivedItems.length} counted` : `${receivedItems.length} ${receivedItems.length === 1 ? 'item' : 'items'} ordered`}</SheetDescription>
              : <DialogDescription className="m-0 mt-0.5 text-[14px]" style={muted}>{scanning ? `${countedLines} of ${receivedItems.length} counted` : `${receivedItems.length} ${receivedItems.length === 1 ? 'item' : 'items'} ordered`}</DialogDescription>}
          </div>
          <Btn kind={camera ? 'primary' : 'soft'} className="h-11 shrink-0 px-4 text-[14px]" onClick={() => setCamera((c) => !c)} aria-pressed={camera}>{camera ? 'Hide camera' : 'Scan'}</Btn>
        </div>
        {camera && <div className="mt-3 overflow-hidden rounded-[20px]"><ScanGate cameraFirst onScan={onReceiveScan} label="Reads barcodes and QR codes. A case’s code counts the case." /></div>}
        {!camera && !ask && !note && <p className="m-0 mt-2 text-[13px]" style={muted}>Scan each unit as you unbox, with the camera or a USB or Bluetooth scanner, or type the counts below.</p>}
        {note && <p role="status" className="m-0 mt-3 text-[14px]" style={note.ok ? { color: C.ink } : { color: C.warn, fontWeight: 600 }}>{note.text}</p>}
        {askCard && <div className="mt-3">{askCard}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {receivedItems.map((item, i) => {
          const gap = item.quantityReceived + item.quantityDamaged - item.quantityOrdered;
          const notYet = scanning && !counted.has(item.productId);
          const inv: any = byId.get(item.productId);
          const casePack = Math.max(0, Math.floor(Number(inv?.casePack) || 0));
          return (
            <div key={item.productId} className="py-4" style={{ borderBottom: i < receivedItems.length - 1 ? `1px solid ${C.line}` : 0 }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="m-0 min-w-0 text-[16px] font-semibold tracking-[-0.01em]">{item.productName}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px]" style={muted}>Ordered {item.quantityOrdered}</span>
                  {notYet ? <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>Not counted yet</span>
                    : gap !== 0 && <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold" style={gap < 0 ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.ink }}>{gap < 0 ? `${Math.abs(gap)} short` : `${gap} extra`}</span>}
                  {casePack > 1 && inv?.caseBarcode && <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: C.soft }}>Case of {casePack}</span>}
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div><label htmlFor={`qty-ok-${item.productId}`} className="mb-1 block text-[13px] font-semibold">Received</label>
                  <input id={`qty-ok-${item.productId}`} type="number" inputMode="numeric" min={0} value={item.quantityReceived} data-scan-field="" data-count-of={item.productId} onChange={(e) => typeCount(item.productId, 'quantityReceived', e.target.value)} className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                <div><label htmlFor={`qty-dmg-${item.productId}`} className="mb-1 block text-[13px] font-semibold">Damaged</label>
                  <input id={`qty-dmg-${item.productId}`} type="number" inputMode="numeric" min={0} value={item.quantityDamaged} data-scan-field="" data-count-of={item.productId} onChange={(e) => typeCount(item.productId, 'quantityDamaged', e.target.value)} className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
              </div>
              {openLot === item.productId || item.lot || item.expirationDate ? (
                <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                  <div><label htmlFor={`lot-${item.productId}`} className="mb-1 block text-[13px] font-semibold">Lot or batch</label>
                    <input id={`lot-${item.productId}`} value={item.lot || ''} onChange={(e) => handleItemChange(item.productId, 'lot', e.target.value.slice(0, 40))} placeholder="As printed" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                  <div><label htmlFor={`exp-${item.productId}`} className="mb-1 block text-[13px] font-semibold">Expires</label>
                    <input id={`exp-${item.productId}`} type="date" value={item.expirationDate ? format(item.expirationDate, 'yyyy-MM-dd') : ''} onChange={(e) => handleItemChange(item.productId, 'expirationDate', e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)} className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                </div>
              ) : <button type="button" onClick={() => setOpenLot(item.productId)} className="mt-1.5 h-10 px-0 text-[13.5px] font-semibold" style={muted}>Add a lot or expiry</button>}
            </div>);
        })}
      </div>

      <div className="shrink-0 border-t px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3" style={{ borderColor: C.line }}>
        {review && (offLines.length > 0 || uncounted.length > 0) && (
          <div className="mb-3 rounded-[14px] px-3.5 py-3" style={{ background: C.warnSoft }}>
            <p className="m-0 text-[14px] font-semibold" style={{ color: C.warn }}>The count doesn’t match the order</p>
            <ul className="m-0 mt-1.5 list-none p-0 text-[13.5px] leading-relaxed">
              {uncounted.map((ri) => <li key={ri.productId}>{ri.productName}: not scanned or counted (ordered {ri.quantityOrdered})</li>)}
              {offLines.map((ri) => <li key={ri.productId}>{ri.productName}: ordered {ri.quantityOrdered}, counted {ri.quantityReceived}{ri.quantityDamaged ? ` (and ${ri.quantityDamaged} damaged)` : ''}</li>)}
            </ul>
            <p className="m-0 mt-1.5 text-[12.5px]" style={muted}>Only what’s counted goes into stock. {uncounted.length ? 'A line nobody counted goes in as ordered, unless it’s set to 0. ' : ''}Raise the difference with the supplier.</p>
            {uncounted.length > 0 && <button type="button" onClick={zeroUncounted} className="mt-1 h-10 px-0 text-[14px] font-semibold underline underline-offset-4" style={{ color: C.ink }}>Set the ones not counted to 0</button>}
          </div>)}
        <div className="flex gap-2">
          <Btn kind="soft" className="h-12 shrink-0 text-[15px]" onClick={() => onOpenChange(false)}>Cancel</Btn>
          <Btn kind="primary" className="h-12 flex-1 text-[15px]" onClick={confirm}>{review && (offLines.length || uncounted.length) ? 'Add to stock anyway' : 'Add to stock'}</Btn>
        </div>
      </div>
    </div>);

  return isMobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[95dvh] flex-col overflow-hidden rounded-t-[28px] border-none p-0">{body}</SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[28px] border-none p-0 sm:max-w-xl">{body}</DialogContent>
    </Dialog>);
};
