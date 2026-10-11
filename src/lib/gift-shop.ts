// src/lib/gift-shop.ts — BUYING A GIFT CARD ONLINE (the business's gift card page, /gift/{tenant}).
//   The buyer picks an amount and a design, writes who it's for and a note, chooses how and when it's sent, and pays.
//   tenants/{t}/giftOrders/{id}: everything they chose, status pending → paid (or expired), and the card it made.
//   The card is made only once the payment has gone through — by the payment webhook or by the page confirming it,
//   whichever comes first; both are safe to run twice. Then it's sent (now, or on the day chosen — the hourly run sends
//   those), the buyer gets a receipt with a private link to see it and change the send time, and the money is recorded
//   as Gift Card Sales (held for clients — it counts as a sale when the card is used).
import { createHmac } from 'crypto';
import Stripe from 'stripe';
import { issueGiftCard, deliverGiftCard, giftPath } from '@/lib/gift-cards';
import { shopSettings, offered, okDesign, designsSync } from '@/lib/gift-designs';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function orderKey(tenantId: string, id: string) {
  const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift';
  return createHmac('sha256', secret).update(`order:${tenantId}/${id}`).digest('base64url').slice(0, 22);
}
export const orderPath = (tenantId: string, id: string) => `/gift/${encodeURIComponent(tenantId)}/order/${encodeURIComponent(id)}?k=${orderKey(tenantId, id)}`;

/** A renter selling their own gift cards (when the studio allows it, they've switched it on and take cards). */
async function renterSeller(db: any, tenantId: string, t: any, providerId?: string | null) {
  if (!providerId) return null;
  const st: any = (await db.doc(`${T(tenantId)}/staff/${String(providerId).slice(0, 80)}`).get()).data(); if (!st?.isRenter || !st.renterId) return { error: 'This provider wasn’t found.' } as any;
  const r: any = (await db.doc(`${T(tenantId)}/renters/${st.renterId}`).get()).data() || {};
  const ok = t?.giftCardSettings?.renters?.ownCards === true && r.giftCardsOnline === true && !!r.stripeAccountId && r.stripeChargesEnabled === true;
  return { ok, renterId: st.renterId, staffId: providerId, name: r.businessName || st.name || r.name || 'Provider', accent: st.brand?.accent || null, stripeAccountId: r.stripeAccountId || null };
}

/** What the shop page needs: the business (or the renter selling their own), its designs, amounts and rules. Nothing private. */
export async function shopInfo(db: any, tenantId: string, providerId?: string | null) {
  const t: any = (await db.doc(T(tenantId)).get()).data(); if (!t) return null;
  const s = shopSettings(t); const { brandAccent } = await import('@/lib/brand-accent');
  const seller: any = await renterSeller(db, tenantId, t, providerId);
  if (seller) return { open: !!seller.ok, brand: { name: seller.name, accent: seller.accent || brandAccent(t), logo: null, phone: null, at: t.name || null }, provider: seller.staffId,
    designs: offered(designsSync(), s).map((d) => d.id), amounts: s.amounts, custom: s.custom, min: s.min, max: s.max, rules: `${s.rules} Use it with ${seller.name}.`, timeZone: t.timezone || 'America/New_York' };
  return { open: s.online && !!t.stripeAccountId, brand: { name: t.name || t.businessName || 'Gift card', accent: brandAccent(t), logo: t.logoUrl || t.logo || null, phone: t.phone || null },
    designs: offered(designsSync(), s).map((d) => d.id), amounts: s.amounts, custom: s.custom, min: s.min, max: s.max, rules: s.rules, timeZone: t.timezone || 'America/New_York' };
}

type Start = { provider?: any; amount: any; design: any; line?: any; buyerName: any; buyerEmail: any; buyerPhone?: any; recipientName?: any; forSelf?: any;
  via: any; recipientEmail?: any; recipientPhone?: any; message?: any; sendAt?: any };

/** Check what the buyer chose, save the order, and open the payment form for it (embedded — they never leave the page). */
export async function startGiftOrder(db: any, tenantId: string, b: Start, origin: string) {
  const t: any = (await db.doc(T(tenantId)).get()).data(); if (!t) return { ok: false as const, error: 'This business wasn’t found.' };
  const s = shopSettings(t); const seller: any = await renterSeller(db, tenantId, t, b.provider ? String(b.provider) : null);
  if (seller ? !seller.ok : !s.online || !t.stripeAccountId) return { ok: false as const, error: 'Gift cards aren’t sold online here right now.' };
  const acct = seller ? seller.stripeAccountId : t.stripeAccountId; const sellerName = seller ? seller.name : t.name || 'Gift card';
  const dollars = Math.round(Number(b.amount) * 100) / 100;
  if (!(dollars >= s.min && dollars <= s.max) || (!s.custom && !s.amounts.includes(dollars))) return { ok: false as const, error: `Choose an amount from ${money(s.min * 100)} to ${money(s.max * 100)}.` };
  const design = okDesign(b.design); if (!design || !offered(designsSync(), s).some((d) => d.id === design)) return { ok: false as const, error: 'Choose a design.' };
  const buyerName = String(b.buyerName || '').trim().slice(0, 80); const buyerEmail = String(b.buyerEmail || '').trim().toLowerCase().slice(0, 120);
  if (!buyerName || !EMAIL.test(buyerEmail)) return { ok: false as const, error: 'Add your name and email for the receipt.' };
  const forSelf = b.forSelf === true; const recipientName = forSelf ? buyerName : String(b.recipientName || '').trim().slice(0, 80);
  if (!recipientName) return { ok: false as const, error: 'Add who it’s for.' };
  const via = ['email', 'text', 'me'].includes(b.via) ? (b.via as 'email' | 'text' | 'me') : null; if (!via) return { ok: false as const, error: 'Choose how it gets to them.' };
  const recipientEmail = via === 'email' ? String(forSelf ? buyerEmail : b.recipientEmail || '').trim().toLowerCase().slice(0, 120) : null;
  const recipientPhone = via === 'text' ? String(b.recipientPhone || '').replace(/[^\d+]/g, '').slice(0, 16) : null;
  if (via === 'email' && !EMAIL.test(recipientEmail || '')) return { ok: false as const, error: 'Add their email.' };
  if (via === 'text' && (recipientPhone || '').replace(/\D/g, '').length < 10) return { ok: false as const, error: 'Add their mobile number.' };
  let sendAt: string | null = null;
  if (via !== 'me' && b.sendAt) { const at = Date.parse(String(b.sendAt)); if (!Number.isFinite(at) || at > Date.now() + 366 * 864e5) return { ok: false as const, error: 'Choose a send date within the next year.' }; if (at > Date.now() + 5 * 60000) sendAt = new Date(at).toISOString(); }
  const message = String(b.message || '').trim().slice(0, 400) || null; const line = String(b.line ?? '').trim().slice(0, 30);
  const dz = designsSync().find((d) => d.id === design);
  const ref = db.collection(`${T(tenantId)}/giftOrders`).doc(); const cents = Math.round(dollars * 100);
  const order = { id: ref.id, status: 'pending', amountCents: cents, design, line: b.line === undefined ? dz?.line || null : line || null, buyerName, buyerEmail, buyerPhone: String(b.buyerPhone || '').slice(0, 30) || null,
    recipientName, forSelf, via, recipientEmail, recipientPhone, message, sendAt, createdAt: now(), cardId: null,
    ownerRenterId: seller ? seller.renterId : null, ownerName: seller ? seller.name : null, stripeAccountId: acct };
  await ref.set(order);
  const session = await stripe().checkout.sessions.create({
    ui_mode: 'embedded', mode: 'payment', customer_email: buyerEmail, redirect_on_completion: 'never',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `${money(cents)} gift card — ${sellerName}`, description: forSelf ? 'For you' : `For ${recipientName}` } } }],
    payment_intent_data: { metadata: { tenantId, type: 'gift_card', giftOrderId: ref.id }, description: `Gift card ${money(cents)}` },
    metadata: { tenantId, type: 'gift_card', giftOrderId: ref.id },
  } as any, { stripeAccount: acct });
  await ref.set({ checkoutSessionId: session.id }, { merge: true });
  void origin;
  return { ok: true as const, orderId: ref.id, clientSecret: session.client_secret, stripeAccountId: acct, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '' };
}

/** The page asks after paying: if the payment has gone through, make the card (the webhook may already have). */
export async function confirmGiftOrder(db: any, tenantId: string, orderId: string, origin?: string | null) {
  const ref = db.doc(`${T(tenantId)}/giftOrders/${orderId}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false as const, error: 'That order wasn’t found.' };
  if (o.status === 'paid' && o.cardId) return { ok: true as const, paid: true, manage: orderPath(tenantId, orderId) };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  const acct = o.stripeAccountId || t.stripeAccountId; if (!o.checkoutSessionId || !acct) return { ok: true as const, paid: false };
  const sess: any = await stripe().checkout.sessions.retrieve(o.checkoutSessionId, {}, { stripeAccount: acct });
  if (sess.payment_status !== 'paid') return { ok: true as const, paid: false };
  await completeGiftOrder(db, tenantId, orderId, { sessionId: sess.id, paymentIntent: typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id || null, amountTotal: sess.amount_total, origin });
  return { ok: true as const, paid: true, manage: orderPath(tenantId, orderId) };
}

/** Paid → make the card, record the money, send it (or schedule it), and send the buyer their receipt. Runs once per order. */
export async function completeGiftOrder(db: any, tenantId: string, orderId: string, p: { sessionId: string; paymentIntent?: string | null; amountTotal?: number | null; chargeId?: string | null; origin?: string | null }) {
  const ref = db.doc(`${T(tenantId)}/giftOrders/${orderId}`);
  const claimed = await db.runTransaction(async (tx: any) => { const o = (await tx.get(ref)).data(); if (!o || o.status !== 'pending') return null; tx.update(ref, { status: 'issuing', paidAt: now(), paymentIntentId: p.paymentIntent || null }); return o; });
  if (!claimed) return { ok: true as const, already: true };
  const o: any = claimed; const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  const cents = Number(p.amountTotal) > 0 ? Number(p.amountTotal) : o.amountCents;
  // The buyer may already be a client here (matched by email) — the card then shows on their profile.
  const buyer = await db.collection(`${T(tenantId)}/clients`).where('email', '==', o.buyerEmail).limit(1).get().then((s: any) => (s.empty ? null : s.docs[0].id)).catch(() => null);
  const r: any = await issueGiftCard(db, tenantId, { amountCents: cents, by: 'Online', source: 'online', purchaser: { id: buyer, name: o.buyerName }, purchaserEmail: o.buyerEmail,
    recipient: { id: o.forSelf ? buyer : null, name: o.recipientName, phone: o.recipientPhone, email: o.recipientEmail }, message: o.message, design: o.design, line: o.line,
    sendVia: o.via === 'me' ? 'code' : o.via, sendAt: o.sendAt, transactionId: p.sessionId, orderId, ownerRenterId: o.ownerRenterId || null, ownerName: o.ownerName || null });
  if (!r.ok) { await ref.set({ status: 'pending', issueError: r.error }, { merge: true }); return { ok: false as const, error: r.error }; }
  // A renter's own card was paid to their account — it's their money, not the studio's, so the studio's books skip it.
  const txRef = db.collection(`${T(tenantId)}/transactions`).doc();
  if (!o.ownerRenterId) await txRef.set({ id: txRef.id, date: now(), description: `Gift card sold online: ${money(cents)} for ${o.recipientName}`, clientOrVendor: o.buyerName, clientId: buyer, type: 'income', context: 'Business',
    category: 'Gift Card Sales', taxBucket: 'transfer', amount: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: true, checkoutSessionId: p.sessionId, stripeChargeId: p.chargeId || null, giftCardId: r.card.id, giftOrderId: orderId, tenantId });
  await ref.set({ status: 'paid', cardId: r.card.id, transactionId: o.ownerRenterId ? null : txRef.id }, { merge: true });
  let sent = false; if (!o.sendAt && (o.via === 'email' || o.via === 'text')) sent = (await deliverGiftCard(db, tenantId, t, r.card).catch(() => ({ sent: false }))).sent;
  await sendBuyerReceipt(db, tenantId, t, { ...o, amountCents: cents }, r.card, sent, p.origin).catch(() => {});
  return { ok: true as const, cardId: r.card.id };
}

async function sendBuyerReceipt(db: any, tenantId: string, t: any, o: any, card: any, sentNow: boolean, reqOrigin?: string | null) {
  const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(t, reqOrigin || ''); if (!origin) return;
  const { brandAccent } = await import('@/lib/brand-accent'); const A = brandAccent(t); const biz = o.ownerName ? `${o.ownerName}${t.name ? ` at ${t.name}` : ''}` : t.name || 'us';
  const manage = `${origin}${orderPath(tenantId, o.id)}`; const cardLink = `${origin}${giftPath(tenantId, card.id)}`;
  const when = o.via === 'me' ? 'It’s yours to give — open it, print it or forward the link.' : sentNow ? `We’ve ${o.via === 'text' ? 'texted' : 'emailed'} it to ${esc(o.recipientName)}.`
    : o.sendAt ? `It will be ${o.via === 'text' ? 'texted' : 'emailed'} to ${esc(o.recipientName)} on ${new Date(o.sendAt).toLocaleString('en-US', { timeZone: t.timezone || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'We’ll send it shortly.';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 16px">Thank you, ${esc(String(o.buyerName).split(' ')[0])}</h1>
<div style="border-radius:18px;background:${A};color:#fff;padding:22px 24px;margin:0 0 18px"><div style="font-size:12px;letter-spacing:.16em;opacity:.8">GIFT CARD${o.line ? ` · ${esc(o.line)}` : ''}</div><div style="font-size:40px;letter-spacing:-.03em;margin:10px 0 6px">${money(o.amountCents)}</div><div style="font-size:14px;opacity:.9">For ${esc(o.recipientName)}</div></div>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">${when}</p>
<p style="margin:0 0 10px"><a href="${manage}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:600;font-size:15px">See or change your gift</a></p>
${o.via === 'me' ? `<p style="margin:0 0 18px"><a href="${cardLink}" style="color:#16171a;font-weight:600">Open the gift card</a></p>` : ''}
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:18px 0 0">Paid ${money(o.amountCents)} by card. Code ${esc(card.code)}. ${esc(shopSettings(t).rules)}</p></div>`;
  const { sendNotification } = await import('@/lib/notify');
  await sendNotification(db, { tenantId, channel: 'email', to: o.buyerEmail, subject: `Your gift card for ${biz}`, text: `Thank you! Your ${money(o.amountCents)} gift card for ${o.recipientName}. ${when.replace(/<[^>]+>/g, '')} See or change it: ${manage}`, html, kind: 'gift_card_receipt', recipientType: 'client', recipientName: o.buyerName } as any);
}

/** The buyer's private page: what they bought, whether it's been sent, and changes while it hasn't. */
export async function orderView(db: any, tenantId: string, id: string) {
  const o: any = (await db.doc(`${T(tenantId)}/giftOrders/${id}`).get()).data(); if (!o) return null;
  const c: any = o.cardId ? (await db.doc(`${T(tenantId)}/giftCards/${o.cardId}`).get()).data() : null;
  return { ownerName: o.ownerName || null, status: o.status, amountCents: o.amountCents, design: o.design, line: o.line, buyerName: o.buyerName, recipientName: o.recipientName, via: o.via, message: o.message,
    recipientEmail: c?.recipientEmail || o.recipientEmail, recipientPhone: (c?.recipientPhone || o.recipientPhone) ? `•••${String(c?.recipientPhone || o.recipientPhone).slice(-4)}` : null,
    sendAt: c ? c.sendAt || null : o.sendAt, sentAt: c?.sentAt || null, scheduledFor: c?.scheduledFor || null, sendStatus: c?.sendStatus || null,
    code: c?.code || null, balanceCents: c?.balanceCents ?? null, used: c ? c.balanceCents < c.initialCents : false, cardPath: c ? giftPath(tenantId, o.cardId) : null };
}

/** While it hasn't gone out: change the day, fix their email or number, or send it now. */
export async function changeOrder(db: any, tenantId: string, id: string, b: { sendAt?: any; now?: any; recipientEmail?: any; recipientPhone?: any }) {
  const o: any = (await db.doc(`${T(tenantId)}/giftOrders/${id}`).get()).data(); if (!o?.cardId) return { ok: false as const, error: 'This gift isn’t ready yet.' };
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.cardId}`); const c: any = (await ref.get()).data(); if (!c) return { ok: false as const, error: 'That gift card wasn’t found.' };
  if (c.sentAt && !b.now) return { ok: false as const, error: 'It’s already been sent.' };
  if (!['text', 'email'].includes(c.sendVia)) return { ok: false as const, error: 'This one is yours to give — there’s nothing to schedule.' };
  const patch: any = {};
  if (b.recipientEmail !== undefined) { const e = String(b.recipientEmail).trim().toLowerCase(); if (c.sendVia !== 'email' || !EMAIL.test(e)) return { ok: false as const, error: 'Check the email.' }; patch.recipientEmail = e; }
  if (b.recipientPhone !== undefined) { const ph = String(b.recipientPhone).replace(/[^\d+]/g, ''); if (c.sendVia !== 'text' || ph.replace(/\D/g, '').length < 10) return { ok: false as const, error: 'Check the number.' }; patch.recipientPhone = ph; }
  if (b.sendAt !== undefined && !b.now) { const at = Date.parse(String(b.sendAt)); if (!Number.isFinite(at) || at < Date.now() + 5 * 60000 || at > Date.now() + 366 * 864e5) return { ok: false as const, error: 'Choose a time later than now, within the next year.' }; patch.sendAt = new Date(at).toISOString(); patch.sendStatus = null; }
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  if (b.now) { const t: any = (await db.doc(T(tenantId)).get()).data() || {}; const r = await deliverGiftCard(db, tenantId, t, { ...c, ...patch, id: o.cardId }); if (!r.sent) return { ok: false as const, error: 'It didn’t send — check the email or number.' }; }
  return { ok: true as const };
}

// ── FIND MY GIFT CARD + THE CLIENT'S WALLET ──────────────────────────────────────────────────────────────────────
// "Lost the email?" — they type their phone or email; if any cards here are theirs, ONE message goes to that same phone
// or email with a private link to all of them (never shown on screen, so nobody can look up someone else's cards).
const contactKey = (c: string) => { const s = String(c || '').trim().toLowerCase(); if (EMAIL.test(s)) return `e:${s}`; const d = s.replace(/\D/g, ''); return d.length >= 10 ? `p:${d.slice(-10)}` : null; };
const walletKey = (tenantId: string, ck: string) => { const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift'; return createHmac('sha256', secret).update(`wallet:${tenantId}/${ck}`).digest('base64url').slice(0, 22); };
export const walletPath = (tenantId: string, ck: string) => `/gift/${encodeURIComponent(tenantId)}/wallet?c=${Buffer.from(ck).toString('base64url')}&k=${walletKey(tenantId, ck)}`;

async function cardsFor(db: any, tenantId: string, ck: string) {
  const isEmail = ck.startsWith('e:'); const v = ck.slice(2); const col = db.collection(`${T(tenantId)}/giftCards`);
  const found = new Map<string, any>();
  const add = (s: any) => s.docs.forEach((d: any) => found.set(d.id, { id: d.id, ...d.data() }));
  if (isEmail) { add(await col.where('recipientEmail', '==', v).get()); add(await col.where('purchaserEmail', '==', v).get()); }
  const cl = await db.collection(`${T(tenantId)}/clients`).where(isEmail ? 'email' : 'phone', isEmail ? '==' : '!=', isEmail ? v : '').limit(isEmail ? 5 : 2000).get();
  const ids = cl.docs.filter((d: any) => isEmail || String((d.data() as any).phone || '').replace(/\D/g, '').slice(-10) === v).map((d: any) => d.id).slice(0, 10);
  for (const id of ids) add(await col.where('recipientId', '==', id).get());
  if (!isEmail) { const act = await col.where('status', '==', 'active').get(); act.docs.forEach((d: any) => { if (String((d.data() as any).recipientPhone || '').replace(/\D/g, '').slice(-10) === v) found.set(d.id, { id: d.id, ...d.data() }); }); }
  return [...found.values()].filter((g) => g.status !== 'void');
}

export async function findMyCards(db: any, tenantId: string, contact: string, reqOrigin?: string | null) {
  const ck = contactKey(contact); if (!ck) return { ok: false as const, error: 'Enter the mobile number or email the card was sent to.' };
  const t: any = (await db.doc(T(tenantId)).get()).data(); if (!t) return { ok: false as const, error: 'This business wasn’t found.' };
  const cards = (await cardsFor(db, tenantId, ck)).filter((g) => g.balanceCents > 0);
  if (cards.length) {
    const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(t, reqOrigin || ''); const link = origin ? `${origin}${walletPath(tenantId, ck)}` : '';
    const total = cards.reduce((s, g) => s + g.balanceCents, 0);
    const text = `Your gift card${cards.length > 1 ? 's' : ''} at ${t.name || 'us'}: ${money(total)} to spend.${link ? ` See ${cards.length > 1 ? 'them' : 'it'}: ${link}` : ''}`;
    const { sendNotification } = await import('@/lib/notify');
    if (ck.startsWith('e:')) await sendNotification(db, { tenantId, channel: 'email', to: ck.slice(2), subject: `Your gift card${cards.length > 1 ? 's' : ''} at ${t.name || 'us'}`, text, html: `<p style="font-size:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(text).replace(esc(link), `<a href="${link}">${esc(link)}</a>`)}</p>`, kind: 'gift_card_find', recipientType: 'client' } as any).catch(() => {});
    else await sendNotification(db, { tenantId, channel: 'sms', to: ck.slice(2), text, kind: 'gift_card_find', recipientType: 'client' } as any).catch(() => {});
  }
  return { ok: true as const };   // the same answer whether or not anything was found
}

export async function walletView(db: any, tenantId: string, c64: string, k: string) {
  let ck = ''; try { ck = Buffer.from(String(c64 || ''), 'base64url').toString('utf8'); } catch { return null; }
  if (!/^[ep]:/.test(ck) || k !== walletKey(tenantId, ck)) return null;
  const cards = (await cardsFor(db, tenantId, ck)).sort((a, b) => Number(b.balanceCents > 0) - Number(a.balanceCents > 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return cards.map((g) => ({ id: g.id, code: g.code, initialCents: g.initialCents, balanceCents: g.balanceCents, design: g.design || null, line: g.line || null, recipientName: g.recipientName || null, purchaserName: g.purchaserName || null, ownerName: g.ownerName || null, expiresAt: g.expiresAt || null, path: giftPath(tenantId, g.id) }));
}
