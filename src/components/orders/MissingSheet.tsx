'use client';
// src/components/orders/MissingSheet.tsx — SOMETHING ISN'T ON THE SHELF. What the customer chose at checkout for this item
// (lib/retail-swap) sits at the top and is the option already picked: their own backup first, or the best match (the
// same product's other colors first, never dearer than what they paid), or a refund. A swap goes in now and is scanned
// in like any item; nobody is asked while packing (only an order placed when customers could ask to be asked still is).
// Refunds don't go back one by one: everything owed comes back in one refund when packing is done, and the customer
// hears once, then, what changed (lib/pack-changes). Stock is corrected either way so nobody else buys one.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { markMissing } from '@/lib/orders-flow';
import { firstName, money } from '@/lib/orders-view';
import { effectiveUnitCents, ifOutWords, lineIfOut, similarItems, swapCapCents, SWAP_ANSWER_HOURS, type SwapItem } from '@/lib/retail-swap';
import { taxShareCents } from '@/lib/restocking';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { soldAs } from '@/lib/variants';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, Thumb, muted } from './ui';

type How = 'swap' | 'refund' | 'backorder' | 'look';

export function MissingSheet({ fs, tenantId, order, line, shelf, inventory = [], actor, autoBelow = 0, rs, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; line: any; shelf?: string; inventory?: any[]; actor: Actor; autoBelow?: number; rs?: any; onClose: () => void; onDone: (msg: string) => void }) {
  const owed = Math.max(0, (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0));
  const pref = lineIfOut(order, line);
  const asking = pref.how === 'ask';
  const free = (id: string) => { const i = (inventory || []).find((x: any) => x.id === id); return i ? (Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0) : null; };
  // What can go in its place: their own backup (out too if the shelf says none are free), or the best matches as the
  // shop sells them (another variant of the same listing first), never dearer than what they paid. None for a refund.
  const options: SwapItem[] = React.useMemo(() => {
    if (pref.how === 'refund') return [];
    if (pref.how === 'backup') return pref.backup && free(pref.backup.productId) !== 0 && pref.backup.unitPriceCents <= swapCapCents(Number(line.unitPriceCents) || 0, rs) ? [pref.backup] : [];
    return similarItems(soldAs(inventory), line, 6, rs);
  }, [inventory, line, order, rs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [how, setHow] = React.useState<How>(options.length ? 'swap' : 'refund');
  const [pick, setPick] = React.useState<string>(options[0]?.productId || '');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const who = firstName(order.customerName);
  // What each unit was paid, after any promo code, and the tax on it: what a refund or a cheaper swap gives back.
  const paid = effectiveUnitCents(line);
  const back = (cents: number) => cents + taxShareCents(order, cents);
  const amount = back(owed * paid);
  const chosen = options.find((o) => o.productId === pick);
  // Within the shop's automatic amount, the one refund goes back by itself when packing is done; a bigger one waits for
  // someone allowed to send money.
  const inAuto = autoBelow > 0 && amount + Math.max(0, Number(order.pendingRefundCents) || 0) <= autoBelow && order.replacementFor !== 'lost_in_transit';

  const go = async () => {
    if (how === 'look') { onClose(); return; }
    setBusy(true); setErr('');
    try {
      if (how === 'swap') {
        if (!chosen) { setErr('Pick a replacement first.'); return; }
        const r = await fetch('/api/retail/swap', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ action: 'offer', tenantId, orderId: order.id, lineId: line.lineId, productId: chosen.productId }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(d.message || d.error || 'That didn’t go through.'); return; }
        onDone(d.asked ? `Asked ${who} about ${chosen.name}. Keep packing the rest.` : `Swapped for ${chosen.name}. Scan it in when you have it.`);
        return;
      }
      const r = await markMissing(fs, tenantId, order.id, line.lineId, how, shelf ? `Not on shelf ${shelf}` : 'Not on the shelf', actor);
      if (!r.ok) { setErr(r.message); return; }
      if (how !== 'refund') { onDone(`${line.name} will ship on its own when it’s back.`); return; }
      onDone(inAuto ? `${money(amount)} goes back to ${who} in one refund when packing is done. Keep packing the rest.` : `${who} gets ${money(amount)} back once someone allowed to send money sends it. Keep packing the rest.`);
    } finally { setBusy(false); }
  };
  const opt = (id: How, title: string, sub: string, extra?: React.ReactNode) => (
    <div className="rounded-[18px]" style={{ border: how === id ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: how === id ? 13 : 14 }}>
      <button type="button" onClick={() => setHow(id)} className="flex min-h-[44px] w-full items-start gap-3 text-left">
        <span className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full" style={{ border: how === id ? `7px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
        <span><span className="block text-[17px] font-semibold">{title}</span><span className="mt-0.5 block text-[14px]" style={muted}>{sub}</span></span>
      </button>
      {how === id && extra}
    </div>);
  const swapTitle = asking ? `Ask ${who} about a swap` : pref.how === 'backup' ? `Swap for ${who}’s backup` : 'Swap for the best match';
  const swapSub = asking ? `They get a text and an email. No answer in ${SWAP_ANSWER_HOURS} hours means a refund.` : pref.how === 'backup' ? 'They picked it at checkout. Scan it in like any item.' : 'They asked for a close match. Never more than they paid.';
  const refundSub = pref.how === 'refund' ? `${who} asked for a refund if it’s out.` : options.length ? 'Nothing goes in its place.' : pref.how === 'backup' ? `${who}’s backup is out too, so it’s refunded, as they chose.` : 'Nothing close enough at the same price or less, so it’s refunded.';

  return (
    <Sheet title={`${line.name}${owed > 1 ? ` (${owed})` : ''} isn’t ${shelf ? `on shelf ${shelf}` : 'there'}`} sub={`${who} chose: ${ifOutWords(pref)}`} onClose={onClose}>
      <div className="mt-2 flex flex-col gap-2">
        {options.length > 0 && opt('swap', swapTitle, swapSub, (
          <div className="mt-3 flex flex-col gap-1.5 pl-[34px]">
            {options.map((o) => (
              <button key={o.productId} type="button" onClick={() => setPick(o.productId)} className="cf-press flex min-h-[48px] items-center gap-3 rounded-2xl p-2 text-left" style={{ background: pick === o.productId ? C.soft : 'transparent' }}>
                <Thumb src={o.imageUrl} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{o.name}</span><span className="block text-[13px]" style={muted}>{money(o.unitPriceCents)}{o.unitPriceCents < paid ? `, ${money(back((paid - o.unitPriceCents) * owed))} back in their refund` : o.unitPriceCents > paid ? ', you cover the difference' : ', same price'}</span></span>
                {pick === o.productId && <span className="text-[13px] font-semibold">Chosen</span>}
              </button>))}
          </div>))}
        {opt('refund', `Refund ${money(amount)}`, `${refundSub} ${inAuto ? 'It goes back in one refund when packing is done.' : 'It waits for someone allowed to send money.'}`)}
        {opt('backorder', 'Send it when it’s back', 'The rest goes out now. This ships on its own at no cost to them.')}
        {opt('look', 'Keep looking', 'Nothing changes yet.')}
      </div>
      {how !== 'look' && <p className="m-0 mt-3 text-[14px]" style={muted}>Stock for this item is set to what’s really there, so nobody else buys one. {who} hears what changed once, when packing is done.</p>}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || (how === 'swap' && !chosen)} onClick={() => void go()}>
        {busy ? 'Saving…' : how === 'swap' ? (asking ? `Ask ${who}` : `Swap for ${chosen?.name || 'this'}`) : how === 'refund' ? `Refund ${money(amount)} and keep packing` : how === 'backorder' ? 'Send it later and keep packing' : 'Keep looking'}
      </Btn>
    </Sheet>);
}
