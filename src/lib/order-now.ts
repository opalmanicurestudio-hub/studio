// src/lib/order-now.ts — WHAT TO DO NOW, FOR THE CUSTOMER. The top of their order page answers one question: what's
// happening and what, if anything, they need to do. One headline, one line of detail, at most one action. A question
// waiting for them (a swap) always comes first. Held orders read like any other paid order. Pure.
export type NowAction = { label: string; kind: 'scroll' | 'link' | 'swap'; target?: string };
export interface Now { title: string; body: string; tone: 'calm' | 'act' | 'done'; action?: NowAction; extra?: string }

const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const firstOf = (n: string) => String(n || '').trim().split(/\s+/)[0] || '';

export function orderNow(o: any, help: any = {}): Now | null {
  if (!o || o.stage === 'cancelled') return null;
  const hi = firstOf(o.customerName);
  const refund = help?.refundState === 'pending' && (Number(o.pendingRefundCents) || 0) > 0 ? `A refund of ${money(o.pendingRefundCents)} is on its way to your card.` : '';
  if (o.swapOffer) {
    const s = o.swapOffer; const diff = Math.max(0, (Number(s.origUnitCents) || 0) - (Number(s.sub?.unitPriceCents) || 0)) * (Number(s.qty) || 1);
    return { tone: 'act', title: `We’re out of ${s.lineName}`, body: `We can send ${s.sub?.name} instead${diff ? `, and refund the ${money(diff)} difference` : ', at no extra cost'}. If we don’t hear from you, we’ll refund it so your order isn’t held up.`, action: { label: 'Choose', kind: 'swap' } };
  }
  if (o.stage === 'placed') return { tone: 'calm', title: 'Confirming your payment', body: 'This takes a few seconds and updates by itself.' };
  if (o.idCheckStatus === 'sent' || o.idCheckStatus === 'processing') return { tone: 'act', title: 'One quick step', body: 'We’ve emailed you a secure link to confirm it was you who placed this order. It takes about two minutes, then we send it.' };
  const ship = o.method === 'ship'; const curb = o.method === 'curbside';
  if (['paid', 'picking'].includes(o.stage)) return { tone: 'calm', title: ship ? 'We’re packing your order' : 'We’re getting it ready', body: ship ? 'We’ll email you tracking as soon as it ships.' : `We’ll ${o.hasPhone ? 'text and ' : ''}email you the moment it’s ready.${curb ? ' Then just tell us when you’re here.' : ''}`, extra: refund };
  if (o.stage === 'packed') return { tone: 'calm', title: ship ? 'Packed and ready to ship' : 'Almost ready', body: ship ? 'It goes out with the next carrier pickup. Tracking comes by email.' : 'Just finishing up.', extra: refund };
  if (o.stage === 'ready') return curb
    ? { tone: 'act', title: `Ready when you are${hi ? `, ${hi}` : ''}`, body: 'When you pull up, tap I’m here and we’ll bring it out to you.', action: { label: 'I’m here', kind: 'scroll', target: 'curbside' }, extra: refund }
    : { tone: 'act', title: 'Ready for pickup', body: `Show the code below at the counter${o.shelfSlot ? `. It’s on shelf ${o.shelfSlot}` : ''}.`, action: { label: 'Show my code', kind: 'scroll', target: 'pickup-code' }, extra: refund };
  if (o.stage === 'arrived') return o.curbside?.bringingOutAt
    ? { tone: 'calm', title: 'On the way out to you', body: 'Someone is bringing your order out now.' }
    : { tone: 'calm', title: 'We know you’re here', body: 'Someone will bring it out in a moment.' };
  if (o.stage === 'shipped') return { tone: 'calm', title: 'On its way', body: o.carrier ? `Shipped with ${o.carrier}.` : 'It’s with the carrier.', action: o.trackingUrl ? { label: 'Track it', kind: 'link', target: o.trackingUrl } : undefined, extra: refund };
  if (['handed_off', 'completed'].includes(o.stage)) return { tone: 'done', title: `Enjoy${hi ? `, ${hi}` : ''}`, body: 'Something not right? You can report a problem or start a return below.', action: help?.canReport ? { label: 'Get help with this order', kind: 'scroll', target: 'order-help' } : undefined, extra: refund };
  return null;
}
