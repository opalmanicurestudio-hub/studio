// src/lib/order-now.ts — WHAT TO DO NOW, FOR THE CUSTOMER. The top of their order page answers one question: what's
// happening and what, if anything, they need to do. One headline, one line of detail, at most one action. A question
// waiting for them (a swap) always comes first. Held orders read like any other paid order. Pure.
export type NowAction = { label: string; kind: 'scroll' | 'link' | 'swap'; target?: string };
export interface Now { title: string; body: string; tone: 'calm' | 'act' | 'done'; action?: NowAction; extra?: string }

import { arrivalLabel, dayLabel, longDayLabel, type CustomerDates } from './ship-promise';

const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const firstOf = (n: string) => String(n || '').trim().split(/\s+/)[0] || '';

/** The ship-by and arrival words for a shipped order's page, from the dates the customer was shown. */
function shipWords(d: CustomerDates | null | undefined) {
  if (!d) return null;
  const by = longDayLabel(d.shipBy, d.timeZone);
  const arrive = arrivalLabel(d, d.timeZone);
  const gap = d.originalShipBy ? Math.round((Date.parse(`${d.shipBy}T12:00:00Z`) - Date.parse(`${d.originalShipBy}T12:00:00Z`)) / 86_400_000) : 0;
  return { by, arrive, moved: !!d.originalShipBy, behind: gap === 1 ? 'a day behind' : 'behind', eta: d.carrierEta ? dayLabel(d.carrierEta, d.timeZone) : '' };
}

export function orderNow(o: any, help: any = {}): Now | null {
  if (!o || o.stage === 'cancelled') return null;
  const hi = firstOf(o.customerName);
  // A refund waiting to be sent is approved, not yet on its way: the refund email says when it goes.
  const refund = (Number(o.pendingRefundCents) || 0) > 0 ? `A refund of ${money(o.pendingRefundCents)} is approved. We’ll let you know when it’s on its way.` : '';
  if (o.swapOffer) {
    // The refund the swap would really give (worked out on the server, with tax), or the price gap when that's missing.
    const s = o.swapOffer; const diff = s.refundCents != null ? Math.max(0, Number(s.refundCents) || 0) : Math.max(0, (Number(s.origUnitCents) || 0) - (Number(s.sub?.unitPriceCents) || 0)) * (Number(s.qty) || 1);
    return { tone: 'act', title: `We’re out of ${s.lineName}`, body: `We can send ${s.sub?.name} instead${diff ? `, and refund the ${money(diff)} difference` : ', at no extra cost'}. If we don’t hear from you, we’ll refund it so your order isn’t held up.`, action: { label: 'Choose', kind: 'swap' } };
  }
  if (o.stage === 'placed') return { tone: 'calm', title: 'Confirming your payment', body: 'This takes a few seconds and updates by itself.' };
  if (o.idCheckStatus === 'sent' || o.idCheckStatus === 'processing') return { tone: 'act', title: 'One quick step', body: 'We’ve emailed you a secure link to confirm it was you who placed this order. It takes about two minutes, then we send it.' };
  const ship = o.method === 'ship'; const curb = o.method === 'curbside';
  const w = ship ? shipWords(o.dates) : null;
  // A date moved by a notice: said plainly, with the new date and their right to cancel, before anything else.
  if (w?.moved && ['paid', 'picking', 'packed'].includes(o.stage)) return { tone: 'calm', title: `Running ${w.behind}`, body: `It now ships by ${w.by}${w.arrive ? ` and should arrive ${w.arrive}` : ''}. Sorry about that. You can still cancel for a full refund until it ships.`, extra: refund };
  // A local delivery: when it comes, then on its way, delivered, or brought back.
  if (o.method === 'delivery' && o.delivery && ['paid', 'picking', 'packed', 'ready'].includes(o.stage)) {
    const d = o.delivery; const when = d.when ? ` ${/^within/.test(d.when) ? d.when : `on ${d.when}`}` : ' soon';
    if (d.status === 'out') return { tone: 'calm', title: 'On its way', body: `${d.driver ? `${d.driver} is` : 'We’re'} bringing it to you now.`, extra: refund };
    // They choose what happens next on the page (lib/delivery-retry): another try, picking it up, or cancelling.
    if (d.status === 'failed') return d.choices
      ? { tone: 'act', title: 'We couldn’t deliver it', body: 'It’s back at the shop, safe. Choose another time, pick it up, or cancel.', action: { label: 'Choose', kind: 'scroll', target: 'delivery-choice' }, extra: refund }
      : { tone: 'act', title: 'We couldn’t deliver it', body: 'It’s back at the shop, safe. The shop will be in touch to arrange another time.', extra: refund };
    return { tone: 'calm', title: o.stage === 'ready' || o.stage === 'packed' ? 'Packed and ready to go out' : 'We’re getting it ready', body: `We’ll deliver it${when}. This page shows when it’s on its way.`, extra: refund };
  }
  if (['paid', 'picking'].includes(o.stage)) return { tone: 'calm', title: ship ? 'We’re packing your order' : 'We’re getting it ready', body: ship ? (w ? `It ships by ${w.by}${w.arrive ? ` and should arrive ${w.arrive}` : ''}. We’ll email you tracking as soon as it does.` : 'We’ll email you tracking as soon as it ships.') : `We’ll ${o.hasPhone ? 'text and ' : ''}email you the moment it’s ready.${curb ? ' Then just tell us when you’re here.' : ''}`, extra: refund };
  if (o.stage === 'packed') return { tone: 'calm', title: ship ? 'Packed and ready to ship' : 'Almost ready', body: ship ? (w ? `It goes out with the carrier by ${w.by}. Tracking comes by email.` : 'It goes out with the next carrier pickup. Tracking comes by email.') : 'Just finishing up.', extra: refund };
  if (o.stage === 'ready') return curb
    ? { tone: 'act', title: `Ready when you are${hi ? `, ${hi}` : ''}`, body: 'When you pull up, tap I’m here and we’ll bring it out to you.', action: { label: 'I’m here', kind: 'scroll', target: 'curbside' }, extra: refund }
    : { tone: 'act', title: 'Ready for pickup', body: `Show the code below at the counter${o.shelfSlot ? `. It’s on shelf ${o.shelfSlot}` : ''}.`, action: { label: 'Show my code', kind: 'scroll', target: 'pickup-code' }, extra: refund };
  if (o.stage === 'arrived') return o.curbside?.bringingOutAt
    ? { tone: 'calm', title: 'On the way out to you', body: 'Someone is bringing your order out now.' }
    : { tone: 'calm', title: 'We know you’re here', body: 'Someone will bring it out in a moment.' };
  if (o.stage === 'shipped') return { tone: 'calm', title: 'On its way', body: `${o.carrier ? `Shipped with ${o.carrier}.` : 'It’s with the carrier.'}${w?.eta ? ` ${o.carrier || 'The carrier'} expects it ${w.eta}.` : w?.arrive ? ` It should arrive ${w.arrive}.` : ''}`, action: o.trackingUrl ? { label: 'Track it', kind: 'link', target: o.trackingUrl } : undefined, extra: refund };
  if (['completed'].includes(o.stage)) return { tone: 'done', title: `Enjoy${hi ? `, ${hi}` : ''}`, body: 'Something not right? You can report a problem or start a return below.', action: help?.canReport ? { label: 'Get help with this order', kind: 'scroll', target: 'order-help' } : undefined, extra: refund };
  return null;
}
