// src/lib/order-inbox.ts — THE ORDER PAGE IS WHERE WE TALK TO CUSTOMERS. Every message about a shop order lands on
// that order's page (tenants/{t}/retailOrders/{id}/inbox), in full. What reaches the customer's phone or inbox is
// only a nudge: one line and the link, by text when we have their number, by email otherwise. Replies happen on the
// order page, where they land in the shop's message inbox as a case.
//
// Runs inside lib/notify, so no route can forget it. Exceptions that still go out in full:
//   - the order confirmation (a receipt people expect, and how they find the order page later)
//   - messages to someone other than the buyer (a gift's recipient has no order page; they get email as before)
//   - the swap question by text, which the customer answers by replying YES or NO
// Several routes send the same news by text and by email; only the first becomes a nudge (one per kind per 10
// minutes per order), the rest only fill in the order page.

const NUDGE_WINDOW_MS = 10 * 60 * 1000;

export const ORDER_PAGE_KINDS = new Set([
  'order_confirmation', 'order_ready', 'order_shipped', 'order_delayed', 'delay_notice', 'carrier_delivered', 'order_short',
  'order_swap', 'order_id_check', 'preorder_eta', 'preorder_cancelled', 'refund_issued', 'return_label', 'return_received',
  'claim_info_request', 'support_reply', 'support_received', 'order_uncollected', 'address_confirm', 'address_reply',
  'shop_message',
]);
/** Sent in full as well as posted: the receipt. */
const FULL_TOO = new Set(['order_confirmation']);
/** Already on the order page as a conversation: no separate update card. */
const THREAD_KINDS = new Set(['support_reply', 'support_received']);
/** The customer is on the order page when this happens: no nudge at all. */
const NO_NUDGE = new Set(['support_received']);
/** A text that asks for a reply keeps its own words. */
const KEEP_SMS = new Set(['order_swap']);

export function nudgeLine(kind: string, num: string, shop: string, subject?: string): string {
  switch (kind) {
    case 'order_ready': return `Your order ${num} is ready for pickup.`;
    case 'order_shipped': return `Your order ${num} is on its way.`;
    case 'order_delayed': case 'delay_notice': return `There’s a new delivery date for your order ${num}.`;
    case 'carrier_delivered': return `Your order ${num} was delivered.`;
    case 'order_short': return `One item in your order ${num} isn’t available. See what happens next.`;
    case 'order_swap': return `Quick question about your order ${num}: one item sold out.`;
    case 'order_id_check': return `Please confirm your ID so we can send your order ${num}.`;
    case 'preorder_eta': return `There’s a new date for the pre-order in your order ${num}.`;
    case 'preorder_cancelled': return `The pre-order in your order ${num} was cancelled and refunded.`;
    case 'refund_issued': return `A refund for your order ${num} is on its way.`;
    case 'return_label': return `Your return label for order ${num} is ready.`;
    case 'return_received': return `We received your return for order ${num}.`;
    case 'claim_info_request': return `We need a little more from you about your report on order ${num}.`;
    case 'support_reply': return `${shop} replied about your order ${num}.`;
    case 'order_uncollected': return `Your order ${num} is still waiting for pickup.`;
    case 'address_confirm': return `Please check the address for your order ${num} before it ships.`;
    case 'address_reply': return `${shop} answered about the address on your order ${num}.`;
    case 'shop_message': return `${shop} sent you a message about your order ${num}.`;
    default: return subject ? String(subject) : `There’s an update on your order ${num}.`;
  }
}

// Email sign-offs and "reply to this email" make no sense once the message lives on the order page.
const EMAIL_ONLY = /reply to (this|your order) email|just reply|forward them this email|^kind regards|^thank you,?$|^hi [^,]{1,40},$|you are receiving this because|unsubscribe/i;

export function cardText(html: string): string {
  return plainText(html).split('\n').map((l) => l.trim()).filter((l) => l && !EMAIL_ONLY.test(l)).join('\n');
}

export function plainText(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&times;|&#215;|\\u00d7/g, '×')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

export function linksIn(html: string, skip: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || ''))) && out.length < 3) {
    const url = m[1].replace(/&amp;/g, '&'); const label = plainText(m[2]).slice(0, 60);
    if (!/^https:\/\//.test(url) || (skip && url.startsWith(skip)) || !label || out.some((x) => x.url === url)) continue;
    out.push({ label, url });
  }
  return out;
}

async function logPosted(db: any, tenantId: string, input: any, orderId: string, note: string) {
  try {
    const r = db.collection(`tenants/${tenantId}/messageLog`).doc();
    await r.set({ id: r.id, channel: 'order_page', kind: String(input.kind || ''), to: String(input.to || ''), subject: input.subject || null, preview: note, body: note, status: 'sent', error: null, recipientType: 'client', recipientId: orderId, sentAt: new Date().toISOString() });
  } catch { /* the order page card is the record */ }
}

const d10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

/**
 * Called by lib/notify before anything is sent. Returns a result when it handled the message (posted to the order
 * page and nudged, or posted only), or null to let notify send it as usual.
 */
export async function routeThroughOrderPage(db: any, input: any, send: (i: any) => Promise<any>): Promise<any | null> {
  const kind = String(input?.kind || '');
  if (!ORDER_PAGE_KINDS.has(kind) || input?.viaOrderPage) return null;
  const tenantId = String(input.tenantId || '');
  const orderId = String(input.orderId || input.recipientId || '');
  if (!tenantId || !orderId || orderId.includes('/')) return null;
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  let order: any = null;
  try { const s = await ref.get(); if (s.exists) order = s.data(); } catch { return null; }
  if (!order) return null;

  // Only the buyer has this order page; anyone else (a gift's recipient) is written to as before.
  const to = String(input.to || '');
  const isBuyer = input.channel === 'sms' ? !!d10(to) && d10(to) === d10(order.customerPhone) : !!to && to.trim().toLowerCase() === String(order.customerEmail || '').trim().toLowerCase();
  if (!isBuyer) return null;

  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const link = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  let shop = 'the shop';
  try { const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; shop = String(t.businessName || t.name || shop); } catch { /* cosmetic */ }
  const now = Date.now();
  // A caller can give the nudge more than the kind's own words (the new ship-by date on a delay notice). Different
  // words are different news: a second new date is its own card and its own nudge, even minutes after the first.
  const custom = String(input.nudgeLine || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const lineFor = () => custom || nudgeLine(kind, num, shop, input.subject);
  // A caller can also say what makes it its own news (a message from the shop: its whole text), so two messages with
  // the same opening line are two cards and two nudges.
  const distinct = input.cardKey ? `${custom}|${String(input.cardKey)}` : custom;
  let h = 0; for (let i = 0; i < distinct.length; i++) h = (h * 31 + distinct.charCodeAt(i)) | 0;
  const newsKey = custom || input.cardKey ? `${kind}-${(h >>> 0).toString(36)}` : kind;

  // 1. The full message, on the order page. Text and email versions of the same news fill one card.
  if (!THREAD_KINDS.has(kind)) {
    try {
      const body = input.html ? cardText(input.html) : String(input.text || '');
      const bucket = Math.floor(now / NUDGE_WINDOW_MS);
      const card = db.doc(`tenants/${tenantId}/retailOrders/${orderId}/inbox/${newsKey}-${bucket}`);
      const prev = await card.get();
      const keepLonger = prev.exists && String(prev.data()?.body || '').length >= body.length;
      if (!keepLonger) {
        await card.set({
          id: card.id, kind, at: new Date(now).toISOString(),
          title: lineFor(), body: body.slice(0, 4000),
          links: input.html ? linksIn(input.html, link) : [],
        }, { merge: true });
      }
    } catch { /* the nudge still goes */ }
  }

  if (FULL_TOO.has(kind)) return null;
  if (NO_NUDGE.has(kind)) { await logPosted(db, tenantId, input, orderId, 'Posted on the order page'); return { ok: true, status: 'sent', error: 'posted to the order page' }; }

  // 2. One nudge per kind per window, by text when we have their number, by email otherwise.
  let first = false;
  try {
    first = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(ref); const at = Date.parse(String(s.data()?.nudges?.[newsKey] || ''));
      if (Number.isFinite(at) && now - at < NUDGE_WINDOW_MS) return false;
      tx.set(ref, { nudges: { [newsKey]: new Date(now).toISOString() } }, { merge: true });
      return true;
    });
  } catch { first = true; }
  if (!first) { await logPosted(db, tenantId, input, orderId, 'Posted on the order page; the customer was already nudged'); return { ok: true, status: 'sent', error: 'posted to the order page' }; }

  const { smsConfigured } = await import('./sms');
  const viaText = !!d10(order.customerPhone) && smsConfigured();
  const line = lineFor();
  if (viaText) {
    const text = KEEP_SMS.has(kind) && input.channel === 'sms' && input.text ? String(input.text) : `${shop}: ${line}${link ? ` ${link}` : ''}`;
    return send({ ...input, viaOrderPage: true, channel: 'sms', to: String(order.customerPhone), text, html: undefined, subject: undefined });
  }
  if (!order.customerEmail) { await logPosted(db, tenantId, input, orderId, 'Posted on the order page; no phone or email to nudge'); return { ok: true, status: 'sent', error: 'posted to the order page' }; }
  const { brandedEmailHtml } = await import('./email-template');
  const html = brandedEmailHtml({ studioName: shop, title: line, bodyLines: ['The details are on your order page. Questions? Message us from there.'], cta: link ? { label: 'Open your order', url: link } : null } as any);
  return send({ ...input, viaOrderPage: true, channel: 'email', to: String(order.customerEmail), subject: line, text: `${line} ${link}`.trim(), html });
}
