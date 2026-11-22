'use client';
// src/components/products/CountSheet.tsx — COUNT IT. The number on the shelf (for a product used by the dose: the sealed
// ones, and what's left in the open one), typed by whoever counted. The difference is
// recorded on the product's history with their name (lib/stock-count), so a count never quietly rewrites the number.
// With more than one location, a product already counted at a store is counted at a store (design board "One count, one
// total"): which store, starting on the one this screen is set to, and that store's number (lib/store-stock-server).
import * as React from 'react';
import { countAtStoreOf, countStock } from '@/lib/count-client';
import { storeView } from '@/lib/store-stock';
import { useInventory } from '@/context/InventoryContext';
import { CameTo, storesFrom, useCameTo } from '@/components/inventory/ReceiveAtStore';
import { perContainer, unitLabel } from '@/lib/product-cost';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';

export function CountSheet({ tenantId, product, onClose, onCounted }: { tenantId: string; product: any; onClose: () => void; onCounted?: (delta: number, changed: boolean, note?: string) => void }) {
  const was = Math.max(0, Number(product?.totalStock) || 0);
  const held = Math.max(0, Number(product?.stockReserved) || 0);
  const [n, setN] = React.useState(String(was));
  // Used by the dose (counted by uses or by amount): sealed containers, plus what's left in the open one.
  const dose = product?.costingMethod === 'uses' || product?.costingMethod === 'size';
  const per = dose ? perContainer(product) : null;
  const unit = dose ? unitLabel(product) : '';
  const openWas = product?.costingMethod === 'uses' ? Math.max(0, Number(product?.partialContainerUses) || 0) : Math.max(0, Number(product?.partialContainerSize) || 0);
  const [open, setOpen] = React.useState(String(openWas));
  const openN = open === '' || !/^\d+(\.\d+)?$/.test(open) ? NaN : Number(open);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  // Counted at a store already (more than one location): counted at a store.
  const { locations } = useInventory();
  const stores = React.useMemo(() => storesFrom(locations as any[]), [locations]);
  const view = stores.length > 1 && !dose ? storeView(product, stores) : null;
  const perStore = !!view?.tracked;
  const [at, setAt] = useCameTo(perStore ? stores : []);
  const here = view?.stores.find((x) => x.id === at) || null;
  // (Starts on what the record says for the store picked, as a count of the whole shelf does.)
  React.useEffect(() => { if (perStore) setN(here && here.count !== null ? String(here.count) : ''); }, [perStore, at]); // eslint-disable-line react-hooks/exhaustive-deps
  const counted = n === '' ? NaN : Math.floor(Number(n));
  const base = perStore ? (here?.count ?? 0) : was;
  const diff = Number.isFinite(counted) ? counted - base : 0;
  const save = async () => {
    if (!Number.isFinite(counted) || busy) return;
    if (perStore) {
      if (!here) { setErr('Pick the store you counted at.'); return; }
      setBusy(true); setErr('');
      const r = await countAtStoreOf(tenantId, String(product.id), here.id, counted);
      setBusy(false);
      if (!r.ok) { setErr(r.error); return; }
      onCounted?.(diff, here.count === null || diff !== 0, here.count === null ? `Counted at ${here.name} for the first time. It’s on the history.` : diff !== 0 ? `${diff < 0 ? `${-diff} fewer` : `${diff} more`} than the record at ${here.name}. It’s on the history.` : undefined); onClose(); return;
    }
    if (counted < held) { setErr(`${held} ${held === 1 ? 'is' : 'are'} held for paid orders, so the shelf can’t be fewer than that. Mark the missing ones on those orders first.`); return; }
    if (dose && open !== '' && !Number.isFinite(openN)) { setErr('Type what’s left in the open one as a number, like 12 or 7.5.'); return; }
    if (dose && per && Number.isFinite(openN) && (openN < 0 || openN > per)) { setErr(`What’s left in the open one has to be between 0 and ${per} ${unit}.`); return; }
    setBusy(true); setErr('');
    const r = await countStock(tenantId, String(product.id), counted, dose && Number.isFinite(openN) ? openN : undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCounted?.(r.delta, r.changed); onClose();
  };
  return (
    <Sheet title="Count it" sub={String(product?.name || '')} onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {perStore && <CameTo stores={stores} at={at} onPick={setAt} id="count-at" label="Counted at" hint="Pick the store you counted at." />}
        <div>
          <label htmlFor="count-n" className="mb-1.5 block text-[13px] font-semibold" style={muted}>{dose ? 'Sealed ones on the shelf' : 'How many are on the shelf'}</label>
          <input id="count-n" inputMode="numeric" autoFocus value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 7))}
            className="h-14 w-full rounded-xl px-4 text-[24px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
        </div>
        {dose && (
          <div>
            <label htmlFor="count-open" className="mb-1.5 block text-[13px] font-semibold" style={muted}>Left in the open one ({unit}{per ? `, of ${per}` : ''})</label>
            <input id="count-open" inputMode="decimal" value={open} onChange={(e) => setOpen(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))}
              className="h-14 w-full rounded-xl px-4 text-[24px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
          </div>
        )}
        {perStore ? (
        <p className="m-0 text-[14px]" style={muted}>
          {!here ? 'Pick the store first.' : here.count === null ? `Not counted at ${here.name} yet: what you count comes from “Not at a store yet” (${view?.unplaced ?? 0}), and anything past that adds to the total.` : `The record says ${here.count} at ${here.name}.`}
          {here && here.count !== null && Number.isFinite(counted) && diff !== 0 ? <span style={{ color: diff < 0 ? C.warn : C.ok }}> {diff < 0 ? `${-diff} fewer` : `${diff} more`} than recorded.</span> : null}
        </p>) : (
        <p className="m-0 text-[14px]" style={muted}>
          The record says {was}{dose ? ` sealed and ${openWas} ${unit} in the open one` : ''}.{held ? ` ${held} of those ${held === 1 ? 'is' : 'are'} held for paid orders.` : ''}
          {Number.isFinite(counted) && diff !== 0 ? <span style={{ color: diff < 0 ? C.warn : C.ok }}> {diff < 0 ? `${-diff} fewer` : `${diff} more`} than recorded.</span> : null}
        </p>)}
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={!Number.isFinite(counted) || busy || (perStore && !here)}>{busy ? 'Saving…' : diff === 0 && (!dose || openN === openWas) && (!perStore || here?.count !== null) ? 'It matches' : 'Save the count'}</Btn>
      </form>
    </Sheet>
  );
}
