'use client';
// src/components/orders/MissingSheet.tsx — SOMETHING ISN'T ON THE SHELF. The customer's own choice from checkout sits at
// the top (refund, swap for something similar, or ask first) and is the option already picked. Swap shows close matches
// that are in stock; for someone who chose swaps it happens now, for everyone else they're asked by text and email.
// A refund within the shop's automatic amount goes back straight away; a bigger one waits for someone allowed to send
// money. Stock is corrected either way so nobody else buys one.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { markMissing } from '@/lib/orders-flow';
import { firstName, money } from '@/lib/orders-view';
import { IF_UNAVAILABLE, effectiveUnitCents, normaliseIfUnavailable, similarItems, SWAP_ANSWER_HOURS } from '@/lib/retail-swap';
import { taxShareCents } from '@/lib/restocking';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { soldAs } from '@/lib/variants';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, Thumb, muted } from './ui';

type How = 'swap' | 'refund' | 'backorder' | 'look';

export function MissingSheet({ fs, tenantId, order, line, shelf, inventory = [], actor, autoBelow = 0, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; line: any; shelf?: string; inventory?: any[]; actor: Actor; autoBelow?: number; onClose: () => void; onDone: (msg: string) => void }) {
  const owed = Math.max(0, (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0));
  const pref = normaliseIfUnavailable(order.ifUnavailable);
  // As the shop sells them: another variant of the same listing is often the best swap (lib/variants).
  const options = React.useMemo(() => similarItems(soldAs(inventory), line), [inventory, line]);
  const [how, setHow] = React.useState<How>(pref !== 'refund' && options.length ? 'swap' : 'refund');
  const [pick, setPick] = React.useState<string>(options[0]?.productId || '');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const who = firstName(order.customerName);
  // What each unit was paid, after any promo code, and the tax on it: what a refund or a cheaper swap gives back.
  const paid = effectiveUnitCents(line);
  const back = (cents: number) => cents + taxShareCents(order, cents);
  const amount = back(owed * paid);
  const askFirst = pref !== 'similar';
  const chosen = options.find((o) => o.productId === pick);

  const go = async () => {
    if (how === 'look') { onClose(); return; }
    setBusy(true); setErr('');
    try {
      if (how === 'swap') {
        if (!chosen) { setErr('Pick a replacement first.'); return; }
        const r = await fetch('/api/retail/swap', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ action: 'offer', tenantId, orderId: order.id, lineId: line.lineId, productId: chosen.productId, ask: askFirst }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(d.message || d.error || 'That didn’t go through.'); return; }
        onDone(d.asked ? `Asked ${who} about ${chosen.name}. Keep packing the rest.` : `Swapped for ${chosen.name}. Scan it in when you have it.`);
        return;
      }
      const r = await markMissing(fs, tenantId, order.id, line.lineId, how, shelf ? `Not on shelf ${shelf}` : 'Not on the shelf', actor);
      if (!r.ok) { setErr(r.message); return; }
      if (how !== 'refund') { onDone(`${line.name} will ship on its own when it’s back.`); return; }
      // Within the shop's automatic amount (the order's whole queued refund) it goes back now; the server checks again.
      const total = amount + Math.max(0, Number(order.pendingRefundCents) || 0);
      if (autoBelow > 0 && total <= autoBelow && order.replacementFor !== 'lost_in_transit') {
        try {
          const s = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', reason: 'policy' }) });
          const d = await s.json().catch(() => ({}));
          if (s.ok) { onDone(`${money(Number(d.amountCents) || amount)} sent back to ${who}. Keep packing the rest.`); return; }
        } catch { /* it waits on Problems */ }
      }
      onDone(`${who} will get ${money(amount)} back. It’s waiting for someone to send it.`);
    } finally { setBusy(false); }
  };
  const opt = (id: How, title: string, sub: string, extra?: React.ReactNode) => (
    <div className="rounded-[18px]" style={{ border: how === id ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: how === id ? 13 : 14 }}>
      <button type="button" onClick={() => setHow(id)} className="flex w-full items-start gap-3 text-left">
        <span className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full" style={{ border: how === id ? `7px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
        <span><span className="block text-[17px] font-semibold">{title}</span><span className="mt-0.5 block text-[14px]" style={muted}>{sub}</span></span>
      </button>
      {how === id && extra}
    </div>);
  const prefLabel = IF_UNAVAILABLE.find((o) => o.id === pref)?.label || 'Refund it';

  return (
    <Sheet title={`${line.name}${owed > 1 ? ` (${owed})` : ''} isn’t ${shelf ? `on shelf ${shelf}` : 'there'}`} sub={`${who} chose: ${prefLabel}`} onClose={onClose}>
      <div className="mt-2 flex flex-col gap-2">
        {options.length > 0 && opt('swap', askFirst ? `Ask ${who} about a swap` : 'Swap it', askFirst ? `They get a text and an email. No answer in ${SWAP_ANSWER_HOURS} hours means a refund.` : 'They asked for a close match. Never more than they paid.', (
          <div className="mt-3 flex flex-col gap-1.5 pl-[34px]">
            {options.map((o) => (
              <button key={o.productId} type="button" onClick={() => setPick(o.productId)} className="cf-press flex items-center gap-3 rounded-2xl p-2 text-left" style={{ background: pick === o.productId ? C.soft : 'transparent' }}>
                <Thumb src={o.imageUrl} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{o.name}</span><span className="block text-[13px]" style={muted}>{money(o.unitPriceCents)}{o.unitPriceCents < paid ? `, refunds ${money(back((paid - o.unitPriceCents) * owed))}` : o.unitPriceCents > paid ? ', shop covers the difference' : ''}</span></span>
                {pick === o.productId && <span className="text-[13px] font-semibold">Chosen</span>}
              </button>))}
          </div>))}
        {opt('refund', `Refund ${money(amount)}`, autoBelow > 0 && amount + Math.max(0, Number(order.pendingRefundCents) || 0) <= autoBelow ? `${who} gets an email saying why, and the money goes back now.` : `${who} gets an email saying why. The refund waits for someone allowed to send money.`)}
        {opt('backorder', 'Send it when it’s back', 'The rest goes out now. This ships on its own at no cost to them.')}
        {opt('look', 'Keep looking', 'Nothing changes yet.')}
      </div>
      {how !== 'look' && <p className="m-0 mt-3 text-[14px]" style={muted}>Stock for this item is set to what’s really there, so nobody else buys one.</p>}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || (how === 'swap' && !chosen)} onClick={() => void go()}>
        {busy ? 'Saving…' : how === 'swap' ? (askFirst ? `Ask ${who}` : `Swap for ${chosen?.name || 'this'}`) : how === 'refund' ? `Refund ${money(amount)} and keep packing` : how === 'backorder' ? 'Send it later and keep packing' : 'Keep looking'}
      </Btn>
    </Sheet>);
}
