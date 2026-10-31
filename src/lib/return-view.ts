// src/lib/return-view.ts — A RETURN, AS THE CUSTOMER SEES IT (mockup 10C, "Your report and your return"). Where it is, in
// three steps: on its way back to the shop (or to be brought in), the shop has it and is checking it, and how it was put
// right (refunded, store credit, or another sent); or closed, with the shop's note. Only what's theirs to see: never
// who on the team did what. Pure, so the order page and the server that sends it agree.

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const money = (c: any) => `$${(Math.max(0, Number(c) || 0) / 100).toFixed(2)}`;

/** What a return the customer can see carries (api/retail/order-status). The label, and the shop's note on a closed
 *  return, only with their pass. `refundWaiting`: the order still has a refund to send (an approved refund not sent yet). */
export function publicReturn(r: any, withLabel: boolean, o: { refundWaiting?: boolean } = {}) {
  const lines = (Array.isArray(r?.lines) ? r.lines : []).slice(0, 20).map((l: any) => ({ name: String(l?.name || 'Item').slice(0, 120), qty: Math.max(1, Math.floor(Number(l?.qty) || 1)) }));
  return {
    id: String(r?.id || ''), status: String(r?.status || 'open'), resolution: String(r?.resolution || 'refund'), lines,
    openedAt: r?.openedAt || null, resolvedAt: r?.resolvedAt || null, closedAt: r?.closedAt || null,
    closedNote: withLabel && r?.status === 'cancelled' && r?.closedNote ? String(r.closedNote).slice(0, 300) : null,
    refundCents: Number(r?.refundNetCents ?? r?.refundCents) || 0, creditCents: Number(r?.creditNetCents ?? r?.storeCreditCents) || 0,
    feeCents: Number(r?.restockingFeeCents) || 0, labelDeductCents: Number(r?.labelDeductCents) || 0, creditCappedCents: Number(r?.creditCappedCents) || 0,
    refundWaiting: r?.status === 'resolved' && (r?.resolution || 'refund') === 'refund' && o.refundWaiting === true && (Number(r?.refundNetCents ?? r?.refundCents) || 0) > 0,
    hasLabel: !!r?.labelUrl, labelFailed: !r?.labelUrl && !!r?.labelError,
    // A label was asked for: one they started themselves by post (the page asks for it), or one the shop emailed.
    labelExpected: !!r?.labelUrl || !!r?.labelError || !!r?.labelPurchasedAt || String(r?.openedBy || '').startsWith('Customer'),
    labelUrl: withLabel && r?.labelUrl ? String(r.labelUrl) : null, labelCarrier: withLabel && r?.labelCarrier ? String(r.labelCarrier).slice(0, 40) : null,
  };
}

export type ReturnStep = { label: string; done: boolean; now: boolean };
export type CustomerReturn = { title: string; label: string; line: string; tone: 'wait' | 'ok' | 'no'; steps: ReturnStep[]; sub: string };

/** Where a return is, for the customer's order page. `method` is the order's (ship, pickup, delivery). */
export function customerReturnStatus(r: ReturnType<typeof publicReturn> | any, method: string, day: (iso: string) => string = (s) => s.slice(0, 10)): CustomerReturn {
  const names = (r?.lines || []).map((l: any) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`);
  const title = `Return: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`;
  const how = r?.resolution === 'store_credit' ? 'store credit' : r?.resolution === 'replacement' ? 'a replacement' : 'a refund to how you paid';
  const sub = `Started ${r?.openedAt ? day(String(r.openedAt)) : ''}${r?.openedAt ? ' · ' : ''}${how}`;
  const byPost = method === 'ship';
  const back = byPost && r?.labelExpected !== false ? 'On its way back to us' : 'Bring it to the shop';
  const doneLabel = r?.resolution === 'store_credit' ? 'Store credit issued' : r?.resolution === 'replacement' ? 'Another on its way' : 'Refunded';
  const st = String(r?.status || 'open');
  const at = st === 'resolved' ? 3 : st === 'received' ? 2 : 1;
  const steps: ReturnStep[] = [back, 'We have it and check it', doneLabel].map((label, i) => ({ label, done: at > i + 1 || (st === 'resolved' && i === 2), now: at === i + 1 && st !== 'resolved' }));
  if (st === 'cancelled' || st === 'canceled' || st === 'rejected') {
    return { title, label: 'Closed', tone: 'no', sub, steps: [], line: r?.closedNote ? String(r.closedNote) : 'This return was closed. You can start another one if you still need to.' };
  }
  if (st === 'resolved') {
    const fee = Number(r?.feeCents) > 0 ? ` A ${money(r.feeCents)} restocking fee was taken off.` : '';
    const ship = Number(r?.labelDeductCents) > 0 ? ` Return shipping of ${money(r.labelDeductCents)} was taken off.` : '';
    // A refund approved but not sent yet: said so, never "Refunded" before the money moves.
    if ((r?.resolution || 'refund') === 'refund' && r?.refundWaiting) {
      const waitSteps = steps.map((s, i) => (i === 2 ? { ...s, label: 'Refund on its way', done: false, now: true } : s));
      return { title, label: 'Refund approved', tone: 'wait', sub, steps: waitSteps, line: `We’re sending your ${money(r?.refundCents)} refund to how you paid. You’ll get an email when it goes.${fee}${ship}` };
    }
    const capped = Number(r?.creditCappedCents) > 0;
    const line = r?.resolution === 'store_credit'
      ? (Number(r?.creditCents) > 0 ? `${money(r?.creditCents)} store credit, ready to use at checkout.${capped ? ` The other ${money(r.creditCappedCents)} couldn’t be added: it was more than was left of what you paid.` : ''}${ship}` : 'No store credit was added: everything paid on this order has already gone back to you.')
      : r?.resolution === 'replacement' ? (method === 'ship' ? 'We’re sending another, at no charge.' : 'We’re getting another ready for you, at no charge.')
      : `${money(r?.refundCents)} back to how you paid. Card refunds usually show in 5 to 10 days.${fee}${ship}`;
    return { title, label: doneLabel, tone: 'ok', sub, steps, line };
  }
  if (st === 'received') return { title, label: 'We have it and are checking it', tone: 'wait', sub, steps, line: `Once it’s checked, ${r?.resolution === 'store_credit' ? 'your store credit is added' : r?.resolution === 'replacement' ? 'another goes out to you' : 'your refund is sent'}, and you’ll hear from us.` };
  // Open: still to come back.
  const deduct = Number(r?.labelDeductCents) > 0 ? ` Return shipping of ${money(r.labelDeductCents)} comes off your ${r?.resolution === 'store_credit' ? 'store credit' : 'refund'}.` : '';
  const line = !byPost || !r?.labelExpected ? 'Bring the items to the shop. We check them in while you’re there.'
    : r?.hasLabel ? (r?.labelUrl ? `Your prepaid label is ready. Tape it over the old label on any box and drop it off.${deduct}` : `Your prepaid label was emailed to you. Tape it over the old label on any box and drop it off.${deduct}`)
    : r?.labelFailed ? 'We couldn’t make your return label just now. The shop has been told and will email it to you.'
    : 'Your return label is on its way to your email.';
  return { title, label: byPost && r?.labelExpected !== false ? 'Send it back' : 'Bring it by', tone: 'wait', sub, steps, line };
}

/** Newest first; closed ones after the rest. */
export const sortReturns = (rs: any[]) => [...(rs || [])].sort((a, b) => Number(['cancelled', 'canceled', 'rejected'].includes(a?.status)) - Number(['cancelled', 'canceled', 'rejected'].includes(b?.status)) || ms(b?.openedAt) - ms(a?.openedAt));
