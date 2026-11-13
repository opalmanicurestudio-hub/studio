'use client';
// src/components/orders/PutAwaySheet.tsx — PUT IT AWAY. While the shop scans bags onto the shelf (lib/bag-tag), each
// order finished in bags goes on the ready shelf by scanning its bags, then the label on the spot it's put on, so the
// shelf says where every bag is and one put on the wrong spot is caught as it's put there. One after another, the way a
// pickup shelf is stocked: scan a bag (that's the order), the rest of its bags, then the spot. The spot the order was
// given is suggested; another one scanned is where it's kept. The server checks the bags' signed codes and saves it
// (api/retail/fulfil putAway). Shelf labels print from here.
import * as React from 'react';
import { ScanGate } from '@/components/retail/ScanGate';
import { putAway } from '@/lib/fulfil-client';
import { allSpots, bagReply, bagWords, bagsToShelve, needsPutAway, parseBagCode, parseSpot } from '@/lib/bag-tag';
import { printPickupSpots } from '@/lib/shelf-labels-client';
import { Btn, C, Sheet, feel, muted } from './ui';

const numOf = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

export function PutAwaySheet({ tenantId, orders, rs, onClose, onToast }: { tenantId: string; orders: any[]; rs: any; onClose: () => void; onToast?: (m: string) => void }) {
  const [cur, setCur] = React.useState<string | null>(null);
  const [bags, setBags] = React.useState<Map<number, string>>(new Map());
  const [say, setSay] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const byId = React.useMemo(() => new Map((orders || []).map((o: any) => [String(o.id), o])), [orders]);
  const order = cur ? byId.get(cur) || null : null;
  const need = order ? bagsToShelve(order, rs) : 0;
  const waiting = (orders || []).filter((o: any) => needsPutAway(o, rs));
  const bagsDone = !!order && need > 0 && bags.size >= need;

  const reset = () => { setCur(null); setBags(new Map()); };
  const onScan = async (v: string) => {
    if (busy) return;
    const tag = parseBagCode(v);
    if (tag) {
      if (!order) {
        const o = byId.get(tag.orderId);
        const n = o ? bagsToShelve(o, rs) : 0;
        if (!o || !n || !['ready', 'arrived'].includes(String(o.stage))) { feel(false); setSay({ text: o ? `${numOf(o)} isn’t waiting on the ready shelf.` : 'That bag isn’t waiting on the ready shelf.', bad: true }); return; }
        const r = bagReply(v, o, n, new Map());
        if (!r.ok) { feel(false); setSay({ text: r.message, bad: true }); return; }
        feel(true); setCur(String(o.id)); setBags(new Map([[r.n, r.code]]));
        setSay({ text: n > 1 ? `${bagWords(r.n, n)} for ${o.customerName || 'them'}. Scan the other ${n - 1 === 1 ? 'bag' : `${n - 1} bags`}.` : `${o.customerName ? `${o.customerName}’s` : 'Their'} bag. Now scan the shelf spot.` });
        return;
      }
      const r = bagReply(v, order, need, bags, (id) => byId.get(id));
      if (!r.ok) { feel(false); setSay({ text: tag.orderId !== order.id ? `${r.message} Finish ${numOf(order)} first, or start over.` : r.message, bad: true }); return; }
      feel(true); const m = new Map(bags).set(r.n, r.code); setBags(m);
      setSay({ text: m.size >= need ? 'Every bag scanned. Now scan the shelf spot.' : `${bagWords(r.n, need)}. ${need - m.size} to go.` });
      return;
    }
    const spot = parseSpot(v);
    if (!spot) { feel(false); setSay({ text: 'That isn’t a bag tag or a shelf label. Shelf labels print below, A1 to F12 and Overflow.', bad: true }); return; }
    if (!order) { feel(false); setSay({ text: 'Scan a bag first, then the shelf spot it goes on.', bad: true }); return; }
    if (!bagsDone) { feel(false); setSay({ text: `Scan every bag first: ${need - bags.size} still to scan.`, bad: true }); return; }
    setBusy(true);
    const r: any = await putAway(tenantId, order.id, [...bags.values()], spot);
    setBusy(false); feel(!!r.ok);
    if (!r.ok) { setSay({ text: r.message, bad: true }); if (r.needBags) setBags(new Map()); return; }
    const at = String(r.spot || spot);
    const moved = order.shelfSlot && String(order.shelfSlot).toUpperCase() !== at.toUpperCase();
    // Another order already on that spot: said, so both are found (a spot can hold more than one).
    const beside = (orders || []).filter((x: any) => x.id !== order.id && ['ready', 'arrived'].includes(String(x.stage)) && String(x.shelfSlot || '').toUpperCase() === at.toUpperCase());
    const text = `${numOf(order)} for ${order.customerName || 'them'} is on shelf ${at}.${moved ? ` It was meant for ${order.shelfSlot}, so the order now says ${at}.` : ''}${beside.length ? ` ${beside.map(numOf).join(' and ')} ${beside.length === 1 ? 'is' : 'are'} on that spot too.` : ''}`;
    setSay({ text }); onToast?.(text); reset();
  };

  return (
    <Sheet title="Put orders away" sub={waiting.length ? `${waiting.length} on the ready shelf to scan` : 'Every bag on the shelf is scanned'} onClose={onClose} closeLabel="Done">
      {order ? (
        <div className="mt-2 rounded-2xl border-2 px-4 py-3" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>{numOf(order)}</p>
          <p className="m-0 text-[20px] font-light">{order.customerName || 'Customer'}</p>
          <ul aria-label="Bags" className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
            {Array.from({ length: need }, (_, i) => i + 1).map((n) => (
              <li key={n} className="flex h-10 items-center rounded-full px-3.5 text-[14px] font-semibold" style={bags.has(n) ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.muted }}>{bagWords(n, need)}{bags.has(n) ? <span className="sr-only">, scanned</span> : null}</li>))}
            <li className="flex h-10 items-center rounded-full px-3.5 text-[14px] font-semibold" style={bagsDone ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.muted }}>{order.shelfSlot ? `Shelf ${order.shelfSlot}` : 'A shelf spot'}</li>
          </ul>
        </div>
      ) : <p className="m-0 mt-2 text-[15px]" style={muted}>Scan a bag, then the rest of its bags, then the label on the spot you put it on.</p>}
      {say && <p role={say.bad ? 'alert' : 'status'} className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={say.bad ? { background: C.warnSoft, color: C.warn } : { background: C.okSoft, color: C.ok }}>{say.text}</p>}
      <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy} label={!order ? 'Point at the tag on a bag' : bagsDone ? `Point at the label on ${order.shelfSlot ? `shelf ${order.shelfSlot}` : 'the shelf spot'}` : 'Point at the tag on the next bag'} /></div>
      {order && <Btn kind="soft" className="mt-2 w-full" disabled={busy} onClick={() => { reset(); setSay(null); }}>Start over</Btn>}
      {!order && waiting.length > 0 && (
        <div className="mt-4">
          <p className="m-0 text-[13px] font-semibold" style={muted}>To put away</p>
          <ul className="m-0 mt-1 list-none p-0">
            {waiting.slice(0, 12).map((o: any) => (
              <li key={o.id} className="flex min-h-11 items-center justify-between gap-3 border-b py-2 text-[15px] last:border-b-0" style={{ borderColor: C.line }}>
                <span className="min-w-0 truncate">{o.customerName || 'Customer'} <span style={muted}>· {numOf(o)} · {bagsToShelve(o, rs)} {bagsToShelve(o, rs) === 1 ? 'bag' : 'bags'}</span></span>
                <span className="shrink-0 text-[14px] font-semibold">{o.shelfSlot ? `Shelf ${o.shelfSlot}` : ''}</span>
              </li>))}
          </ul>
        </div>)}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: C.line }}>
        <p className="m-0 min-w-[200px] flex-1 text-[14.5px] leading-snug">No label on a shelf spot yet? Print one for each spot, A1 to F12 and Overflow.</p>
        <Btn kind="soft" className="shrink-0" onClick={() => { if (!printPickupSpots(allSpots())) setSay({ text: 'Allow pop-ups for this site to print the labels.', bad: true }); }}>Print shelf labels</Btn>
      </div>
    </Sheet>);
}
