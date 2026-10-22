// src/lib/delay-notice.ts — TELLING A CUSTOMER THEIR ORDER IS RUNNING LATE. The shop's half of the FTC Mail, Internet,
// or Telephone Order Rule: when an order can't ship by the date it was promised, the customer is told the new date and
// that they can cancel for a full refund. Sent by a person (the delay notice on an order) or by the hourly check of
// orders that missed their ship-by day (lib/late-notices), through the same function, so both say the same thing:
//   · The new date replaces the promise on the order (the end of that day on the shop's clock), and the team's due time
//     moves with it (the last pickup that day).
//   · One notice per new date (notifiedForPromiseAt): a double tap or a second run sends nothing; a new date sends one.
//   · The notice lives on the order page in full; the customer's phone gets one line with the new date and the link,
//     by text when we have their number, by email otherwise (lib/order-inbox).
//   · Every notice is on the order's timeline with both dates, for any dispute later.
import { brandedEmail, emailButton, getEmailBrand } from './email-shell';
import { dayLabel, isCalendarDay, longDayLabel, missedAt, promiseCarrier, promisedDay, scheduleFrom } from './ship-promise';
import { endOfDay, tenantTimeZone, todayIn } from './tenant-time';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type DelayInput = {
  tenantId: string;
  orderId: string;
  /** The new ship-by day, 'YYYY-MM-DD' on the shop's clock. */
  revisedDate: string;
  note?: string;
  actor: { id: string; name: string };
  /** Sent by the hourly check rather than a person: counted, so it stops after a few and hands over to the team. */
  auto?: boolean;
  /** Only send while the order is still exactly as the check saw it (its promise and stage). */
  expect?: { shipPromiseAt: string | null; autoNotices: number };
  origin?: string;
  tenant?: any;
  now?: Date;
};

export type DelayResult = { sent: boolean; why?: string; promiseAt?: string };

/** "a day behind" when the date moved one day, "behind" otherwise. */
export function behindWords(from: string | null, to: string): string {
  if (!from) return 'behind';
  const gap = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return gap === 1 ? 'a day behind' : 'behind';
}

export const PAST_DATE = 'The new date has to be today or later.';
export const TODAY_GONE = 'Today’s last pickup has gone. Choose tomorrow or later.';

export async function sendDelayNotice(db: any, input: DelayInput): Promise<DelayResult> {
  const { tenantId, orderId, revisedDate } = input;
  if (!isCalendarDay(revisedDate)) return { sent: false, why: 'Choose a new ship-by date.' };
  const tenant = input.tenant || (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const tz = tenantTimeZone(tenant);
  const now = input.now || new Date();
  const today = todayIn(tz, now);
  if (revisedDate < today) return { sent: false, why: PAST_DATE };
  const promiseIso = endOfDay(revisedDate, tz).toISOString();
  const schedule = scheduleFrom(tenant.retailSettings);
  const note = String(input.note || '').trim().slice(0, 400);
  const orderRef = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);

  // Claim the send inside the transaction, then send after it commits: a crash loses one message, never sends two.
  const claimed = await db.runTransaction(async (txn: any) => {
    const snap = await txn.get(orderRef);
    if (!snap.exists) return null;
    const o = snap.data() as any;
    if (['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(String(o.stage))) return null;
    if (o.notifiedForPromiseAt === promiseIso) return null;
    if (input.expect && (String(o.shipPromiseAt || '') !== String(input.expect.shipPromiseAt || '')
      || (Number(o.autoDelayNotices) || 0) !== input.expect.autoNotices || o.trackingNumber || o.shippoTransactionId)) return null;
    const carrier = promiseCarrier(o);
    // Today only while today's last pickup is still ahead: a date already missed would just be missed again.
    if (revisedDate === today && now.getTime() >= Date.parse(missedAt(revisedDate, tz, schedule, carrier))) return { refused: TODAY_GONE };
    // The date they were going by, but only one they were actually told: at checkout, by an earlier notice, or in a
    // pre-order's terms. Never the team's own date, which a customer who wasn't shown dates has never seen.
    const knew = o.promise ? (o.promise.shown === true || !!o.notifiedForPromiseAt) : (!!o.notifiedForPromiseAt || o.hasPreorder === true);
    const was = knew ? promisedDay(o, tz) : null;
    txn.update(orderRef, {
      shipPromiseAt: promiseIso, notifiedForPromiseAt: promiseIso, promiseRevisions: (Number(o.promiseRevisions) || 0) + 1,
      // When they were told, for the team's late list ("told Tue: ships by Fri").
      delayNoticeAt: now.toISOString(),
      // The team now works to the new day: its last pickup, or the end of the shop's shipping day.
      promiseAt: missedAt(revisedDate, tz, schedule, carrier),
      // Whoever was asked to look at it has their answer.
      lateNeedsStaff: null,
      // They've been told a date now, so the hourly check watches it (lib/late-notices).
      ...(o.promise ? { lateWatch: true } : {}),
      ...(input.auto ? { autoDelayNotices: (Number(o.autoDelayNotices) || 0) + 1 } : {}),
    });
    const ev = orderRef.collection('events').doc();
    txn.set(ev, {
      id: ev.id, type: 'note', at: now.toISOString(), actorId: input.actor.id, actorName: input.actor.name,
      meta: {
        kind: 'delay_notice', auto: input.auto === true, revisedDate, wasDate: was || null,
        text: `${input.auto ? 'Running late, told automatically' : 'Delay notice sent'}: now ships by ${dayLabel(revisedDate, tz)}${was ? ` (was ${dayLabel(was, tz)})` : ''}${note ? ` · ${note}` : ''}`,
      },
    });
    return { ...o, was };
  });
  if (claimed?.refused) return { sent: false, why: claimed.refused };
  if (!claimed) return { sent: false, why: 'Already told, or the order has moved on.' };

  const to = String(claimed.customerEmail || '').trim();
  if (!to) return { sent: false, why: 'No email on this order.', promiseAt: promiseIso };
  const brand = await getEmailBrand(db, tenantId);
  const firstName = esc(String(claimed.customerName || '').trim().split(/\s+/)[0] || 'there');
  const origin = String(input.origin || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const orderLink = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
  const pretty = longDayLabel(revisedDate, tz);
  const num = `#${String(claimed.orderNumber ?? '').padStart(4, '0')}`;
  const was: string | null = claimed.was || null;
  // Later than the date they had (or no date they knew of): a delay, with their right to cancel. Sooner: just the date.
  const delay = !was || revisedDate > was;
  const lead = was && revisedDate > was
    ? `Your order ${num} is running ${behindWords(was, revisedDate)}. It now ships by <strong>${pretty}</strong>, instead of ${longDayLabel(was, tz)}.`
    : was ? `Your order ${num} now ships by <strong>${pretty}</strong>.`
    : `Your order ${num} is taking longer than we expected. It now ships by <strong>${pretty}</strong>.`;
  const html = brandedEmail(brand, `
    <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${firstName},</p>
    <p style="font-size:14px;color:#334155;line-height:1.6">${lead}</p>
    ${note ? `<p style="font-size:14px;color:#334155;line-height:1.6;background:#f5f5f7;border-radius:12px;padding:12px 14px;margin:14px 0">${esc(note)}</p>` : ''}
    ${delay ? '<p style="font-size:14px;color:#334155;line-height:1.6">If the new date doesn’t work for you, you can cancel from your order page until it ships, and we’ll refund you in full. No reason needed.</p>' : ''}
    ${orderLink ? emailButton(orderLink, delay ? 'Wait or cancel' : 'See your order', brand) : ''}
    ${delay ? '<p style="font-size:13px;color:#6d7075;line-height:1.6">We’re sorry for the wait.</p>' : ''}`,
    { title: delay ? 'Your order is running late' : 'A new ship-by date', tag: `Order ${num}`, preheader: `It now ships by ${pretty}.${delay ? ' You can wait, or cancel for a full refund.' : ''}` });
  // The one line their phone gets carries the new date and, for a delay, their right to cancel; the link follows it.
  const day = dayLabel(revisedDate, tz);
  const nudge = was && revisedDate > was
    ? `Your order ${num} is running ${behindWords(was, revisedDate)} and now ships by ${day}. You can wait, or cancel for a full refund:`
    : delay ? `Your order ${num} now ships by ${day}. You can wait, or cancel for a full refund:` : `Your order ${num} now ships by ${day}.`;
  const { sendNotification } = await import('./notify');
  await sendNotification(db, {
    tenantId, channel: 'email', to, subject: delay ? `Your order ${num} is running late` : `A new ship-by date for your order ${num}`, html, kind: 'order_delayed',
    recipientType: 'client', recipientId: orderId, recipientName: claimed.customerName || null, orderId, nudgeLine: nudge,
  } as any);
  return { sent: true, promiseAt: promiseIso };
}
