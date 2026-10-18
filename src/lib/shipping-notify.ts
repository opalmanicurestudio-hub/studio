// ─── src/lib/shipping-notify.ts ───────────────────────────────────────────────
// Carrier-driven shipping emails, and the evidence trail that comes with them.
//
// TWO JOBS, ON PURPOSE. The obvious one is that customers were being told
// nothing between "order confirmed" and a box appearing — every silence in
// that window becomes a "where is my order" email, and the short-notify copy
// already promises a tracking email that did not exist.
//
// The second job matters more when something goes wrong. A claim that a parcel
// never arrived is won or lost on evidence gathered BEFORE the claim, not on
// argument after it. Every send here stamps the order with what the carrier
// said and when, so the record is built while it is cheap. By the time a
// chargeback arrives, the facts have to already be on the order.
//
// FIRES FROM CARRIER SCANS, not from staff actions. "Label bought" is not
// "carrier has it" — a label can sit on a bench overnight, and telling someone
// their order shipped when it has not is the fastest route to losing their
// trust. The carrier's own first scan is the honest trigger, and it is also
// the timestamp a card network will accept.
//
// IDEMPOTENT per (order, status) via a deterministic event doc id. Carriers
// re-send the same status repeatedly — one parcel can emit a dozen TRANSIT
// webhooks — and a customer who gets four "out for delivery" emails learns to
// ignore all of them.

import { brandedEmail, brandFromTenant, emailButton } from '@/lib/email-shell';

export type CarrierStatus =
  | 'PRE_TRANSIT' | 'TRANSIT' | 'OUT_FOR_DELIVERY'
  | 'DELIVERED' | 'RETURNED' | 'FAILURE'
  /** Synthetic — never comes from readShippoStatus. The webhook raises it
   *  when the carrier's own ETA slips past what it first promised, so the
   *  customer hears about the delay from the shop before they notice it. */
  | 'DELAYED';

/** Statuses worth an email. PRE_TRANSIT is deliberately silent — the label
 *  existing is not news to anyone. */
const NOTIFY: CarrierStatus[] = ['TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'FAILURE'];

export interface CarrierUpdate {
  status: CarrierStatus;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  /** Carrier's own timestamp — not ours. This is the one a dispute cares about. */
  statusAt?: string;
  /** New estimated delivery (ISO date) — only meaningful on DELAYED. */
  eta?: string;
  /** Free-text city/state the carrier reported, when it gives one. */
  location?: string;
  /** Carrier's own words, e.g. "Left at front door". */
  detail?: string;
}

/**
 * Normalise Shippo's shape into ours. Shippo reports OUT_FOR_DELIVERY as a
 * TRANSIT status carrying a substatus, so the interesting case is easy to miss.
 */
export function readShippoStatus(data: any): CarrierStatus | null {
  const raw = String(data?.tracking_status?.status || '').toUpperCase();
  const sub = String(data?.tracking_status?.substatus?.code || '').toLowerCase();
  if (raw === 'TRANSIT' && sub === 'out_for_delivery') return 'OUT_FOR_DELIVERY';
  if (['PRE_TRANSIT', 'TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'].includes(raw)) {
    return raw as CarrierStatus;
  }
  return null;
}

export function shouldNotify(status: CarrierStatus | null): boolean {
  return !!status && NOTIFY.includes(status);
}

function copyFor(u: CarrierUpdate, shopName: string, firstName: string) {
  const hi = `Hi ${firstName || 'there'},`;
  const bye = `Kind regards, ${shopName}`;
  const carrier = u.carrier || 'the carrier';
  const help = 'If you have any questions, please reply to this email.';

  switch (u.status) {
    case 'TRANSIT':
      return {
        title: 'Your order is on its way',
        subject: 'Your order has shipped',
        lines: [
          hi,
          `Thank you for your order. Your order has shipped and is now with ${carrier}.`,
          `Your tracking number is ${u.trackingNumber}. The tracking page will update as your parcel moves.`,
          help,
          bye,
        ],
      };
    case 'OUT_FOR_DELIVERY':
      return {
        title: 'Out for delivery today',
        subject: 'Your order is out for delivery today',
        lines: [
          hi,
          'Your order is out for delivery and is expected to arrive today.',
          u.location ? `Most recent scan: ${u.location}.` : '',
          'If no one will be available to receive it, you may wish to contact the carrier to redirect your parcel.',
          help,
          bye,
        ].filter(Boolean),
      };
    case 'DELIVERED':
      return {
        title: 'Your order has been delivered',
        subject: 'Your order has been delivered',
        lines: [
          hi,
          `${carrier.charAt(0).toUpperCase()}${carrier.slice(1)} has marked your order as delivered${u.location ? ` in ${u.location}` : ''}.`,
          u.detail ? `Carrier note: ${u.detail}` : '',
          'If your parcel is not where you expected, please check with anyone else at the address and any safe place the carrier may use. Parcels are often left a short distance from where they were scanned.',
          'If you still cannot find it, please let us know within 7 days and we will open a claim with the carrier on your behalf. The sooner we hear from you, the more the carrier is able to do.',
          bye,
        ].filter(Boolean),
      };
    case 'RETURNED':
      return {
        title: 'Your order is being returned to us',
        subject: 'Your order is being returned to us',
        lines: [
          hi,
          `${carrier.charAt(0).toUpperCase()}${carrier.slice(1)} is returning your parcel to us. This usually happens because of an address issue or because no one was available to receive it.`,
          'Please reply to this email, or open your order and send us a message, with the correct address and we will send your order back out to you.',
          'We apologize for the inconvenience.',
          bye,
        ],
      };
    case 'FAILURE':
      return {
        title: 'An issue with your delivery',
        subject: 'An issue with the delivery of your order',
        lines: [
          hi,
          `${carrier.charAt(0).toUpperCase()}${carrier.slice(1)} has reported an issue delivering your order.`,
          u.detail ? `Carrier note: ${u.detail}` : '',
          'We are already looking into this, and there is nothing you need to do at this time. We apologize for the inconvenience.',
          help,
          bye,
        ].filter(Boolean),
      };
    case 'DELAYED': {
      const etaDate = u.eta
        ? new Date(u.eta).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : '';
      return {
        title: 'An update on your delivery',
        subject: 'Your delivery estimate has changed',
        lines: [
          hi,
          `${carrier.charAt(0).toUpperCase()}${carrier.slice(1)} has let us know that your parcel is taking longer than first expected. It is still on its way.`,
          etaDate ? `Your new estimated delivery date is ${etaDate}.` : 'The carrier has not yet confirmed a new delivery date. The tracking page will update as your parcel moves.',
          'There is nothing you need to do. If your parcel stops moving, we will follow up with the carrier on your behalf.',
          'We apologize for the delay and appreciate your patience.',
          bye,
        ].filter(Boolean),
      };
    }
    default:
      return null;
  }
}

/**
 * The record a dispute is won with.
 *
 * Card networks and carriers both ask the same three questions: was it sent,
 * where did it land, and when was the customer told. Writing this at scan time
 * means the answer is already sitting on the order months later, when the
 * chargeback notice gives you seven days to respond.
 */
export function deliveryEvidence(u: CarrierUpdate, notifiedTo: string) {
  return {
    carrier: u.carrier || '',
    trackingNumber: u.trackingNumber || '',
    carrierStatus: u.status,
    carrierStatusAt: u.statusAt || '',
    carrierLocation: u.location || '',
    carrierDetail: u.detail || '',
    customerNotifiedAt: new Date().toISOString(),
    customerNotifiedTo: notifiedTo || '',
  };
}

export interface NotifyResult {
  ok: boolean;
  reason?: string;
  sent?: boolean;
}

/**
 * Send one carrier-status email. Never throws — a mail failure must not make a
 * webhook look broken to Shippo, which would trigger a retry storm.
 *
 * `markerRef` is a Firestore doc reference at a deterministic path; its
 * existence is the "already told them this" flag. Pass the ref, not a query:
 * one point read, no composite index, and it cannot miss on a chatty order.
 */
export async function sendCarrierUpdate(opts: {
  markerRef: any;
  order: any;
  tenant: any;
  update: CarrierUpdate;
  origin: string;
  tenantId: string;
  orderId: string;
  /** Admin Firestore, for the delivery log. Falls back to the marker's own db. */
  db?: any;
}): Promise<NotifyResult> {
  const { markerRef, order, tenant, update, origin, tenantId, orderId } = opts;
  // markerRef is a DocumentReference; its .firestore is the same Admin db
  // every caller already holds, so nobody has to thread a new argument.
  const db = opts.db || (markerRef as any)?.firestore;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  // The address itself is resolved centrally now (either env name works);
  // this only decides whether email is configured at all.
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  const to = String(order?.customerEmail || '').trim();
  if (!to) return { ok: false, reason: 'no_customer_email' };
  if (!RESEND_API_KEY || !RESEND_FROM) return { ok: false, reason: 'email_not_configured' };

  // Claim the marker BEFORE sending: two carrier webhooks for the same status arriving together can't both email.
  // create() fails if the marker exists, so exactly one caller wins. A failed send removes the claim so the next
  // webhook can try again.
  try {
    await markerRef.create({ id: markerRef.id, type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: 'Carrier update', meta: { kind: 'carrier_notifying' } });
  } catch (e: any) {
    const exists = /already exists|ALREADY_EXISTS|code.?6\b/i.test(String(e?.message || e?.code || '')) || e?.code === 6;
    if (exists) return { ok: true, sent: false, reason: 'already_sent' };
    // Any other failure to claim: fall back to checking, so a first real send isn't lost.
    try { const prior = await markerRef.get(); if (prior.exists) return { ok: true, sent: false, reason: 'already_sent' }; } catch { /* send anyway */ }
  }
  const release = async () => { try { await markerRef.delete(); } catch { /* stays claimed; the order page still shows tracking */ } };

  const shopName = String(tenant?.businessName || tenant?.name || 'Our team');
  const first = String(order?.customerName || '').split(' ')[0];
  const copy = copyFor(update, shopName, first);
  if (!copy) { await release(); return { ok: false, reason: 'no_copy_for_status' }; }

  const num = typeof order?.orderNumber === 'number' && order.orderNumber > 0
    ? `#${String(order.orderNumber).padStart(4, '0')}`
    : '';
  const orderUrl = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
  const contact = [tenant?.phone, tenant?.email].filter(Boolean).map(String).join(' · ');

  const esc = (s: any) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = copy.lines
    .map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#334155;">${esc(l)}</p>`)
    .join('');
  const cta = update.trackingUrl || orderUrl;
  const ctaLabel = update.trackingUrl ? 'Track my parcel' : 'View my order';

  /* SAME CLOTHES AS EVERY OTHER EMAIL. Carrier updates are the most frequent
   * mail a customer gets from the shop — they were the last still wearing a
   * hardcoded slate header instead of the shop's own color. The shell's
   * headline band carries the news ("Out for delivery today") in the brand
   * color, over the same white card the receipt and every reply use. */
  /* Policy gate — carrier mail is the highest-volume message a shop sends, so
   * it is also the one an owner is most likely to want quieter. Delay notices
   * and shipped/delivered notices are governed separately. */
  try {
    const { resolveMessagePolicy } = await import('@/lib/message-policy');
    const kind = update.status === 'DELAYED' ? 'order_delayed' : 'order_shipped';
    if (!resolveMessagePolicy(tenant, kind, 'email').enabled) {
      await release();
      return { ok: false, sent: false, reason: `${kind} is switched off in message settings` };
    }
  } catch { /* fail open — never lose a carrier update over a settings lookup */ }

  const emailBrand = brandFromTenant(tenant);
  const html = brandedEmail(emailBrand, `
    ${paragraphs}
    ${cta ? emailButton(esc(cta), ctaLabel, emailBrand) : ''}
    ${contact ? `<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center">${esc(contact)}</p>` : ''}`,
    { preheader: copy.subject, title: esc(copy.title), tag: num ? esc(num) : undefined });

  // Through the mailroom: logged, tracked to delivered/opened, and under the
  // same from-address as everything else. The policy check above stays as a
  // fast pre-check; sendNotification re-applies it and records a skip.
  let sent = false;
  try {
    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(db, {
      tenantId, channel: 'email', to,
      subject: num ? `${copy.subject} (order ${num})` : copy.subject,
      html,
      kind: update.status === 'DELAYED' ? 'order_delayed' : 'order_shipped',
      recipientType: 'client',
      recipientId: orderId,
      recipientName: order?.customerName || null,
    });
    sent = r.ok;
    if (!r.ok) console.error('[shipping-notify] not sent:', r.status, r.error);
  } catch (e: any) {
    console.error('[shipping-notify] send failed:', e?.message || e);
  }

  if (!sent) { await release(); return { ok: false, reason: 'send_failed' }; }

  // Only mark it told once it actually went. A failed send stays retryable on
  // the carrier's next webhook for the same status.
  try {
    await markerRef.set({
      id: markerRef.id,
      type: 'note',
      at: new Date().toISOString(),
      actorId: 'system',
      actorName: 'Carrier update',
      meta: {
        kind: 'carrier_notified',
        ...deliveryEvidence(update, to),
        text: `Emailed the customer: ${copy.title.toLowerCase()}`,
      },
    });
  } catch {
    // The email is out; a missing timeline row is cosmetic.
  }

  return { ok: true, sent: true };
}
