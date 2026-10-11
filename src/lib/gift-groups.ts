// src/lib/gift-groups.ts — CHIP IN: several people give one gift card together.
//
//   The organizer starts it from the gift card shop ("Chip in with others"): the card (design, who it's for, a note), the
//   day it's sent, a hoped-for total if they like, and their own share — paid like any online gift card.
//   tenants/{t}/giftGroups/{id}: the card and its state — collecting → sent (or cancelled). Each share is an ordinary
//   gift card order (giftOrders, with groupId) paid through the same payment form and webhook, so a share is money the
//   business holds the moment it's paid (Gift Card Sales), exactly like a card bought outright.
//   Friends open the share link, add what they like and sign the card. Only the organizer sees who gave what.
//   On the day (the hourly run) — or when the organizer taps "Send it now" — ONE card is made for the total of every
//   paid share and sent with every name and note on it. Cancelled before then → every share is refunded to its card.
import { createHmac } from 'crypto';
import Stripe from 'stripe';
import { issueGiftCard, deliverGiftCard, giftPath } from '@/lib/gift-cards';
import { shopSettings, offered, okDesign, designsSync } from '@/lib/gift-designs';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MIN_SHARE = 500;   // $5

export function groupKey(tenantId: string, id: string, role: 'share' | 'org') {
  const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift';
  return createHmac('sha256', secret).update(`group-${role}:${tenantId}/${id}`).digest('base64url').slice(0, 22);
}
export const groupPath = (tenantId: string, id: string, role: 'share' | 'org') =>
  `/gift/${encodeURIComponent(tenantId)}/chip/${encodeURIComponent(id)}?${role === 'org' ? 'o' : 'k'}=${groupKey(tenantId, id, role)}`;
export function roleFor(tenantId: string, id: string, k?: string | null, o?: string | null): 'org' | 'share' | null {
  if (o && o === groupKey(tenantId, id, 'org')) return 'org';
  if (k && k === groupKey(tenantId, id, 'share')) return 'share';
  return null;
}
/** "Jess, Maya, Ana and 3 others" */
export function namesLine(names: string[]) {
  const n = names.map((x) => String(x).trim().split(' ')[0]).filter(Boolean);
  if (n.length <= 3) return n.length === 3 ? `${n[0]}, ${n[1]} and ${n[2]}` : n.join(' and ');
  return `${n.slice(0, 3).join(', ')} and ${n.length - 3} other${n.length - 3 === 1 ? '' : 's'}`;
}

type StartGroup = { amount: any; design: any; line?: any; buyerName: any; buyerEmail: any; recipientName: any; via: any; recipientEmail?: any; recipientPhone?: any; message?: any; sendAt: any; goal?: any; occasion?: any };

/** The organizer starts a chip-in and pays their own share. */
export async function startGroup(db: any, tenantId: string, b: StartGroup, origin: string) {
  const t: any = (await db.doc(T(tenantId)).get()).data(); if (!t) return { ok: false as const, error: 'This business wasn’t found.' };
  const s = shopSettings(t); if (!s.online || !t.stripeAccountId) return { ok: false as const, error: 'Gift cards aren’t sold online here right now.' };
  const design = okDesign(b.design); if (!design || !offered(designsSync(), s).some((d) => d.id === design)) return { ok: false as const, error: 'Choose a design.' };
  const organizerName = String(b.buyerName || '').trim().slice(0, 80); const organizerEmail = String(b.buyerEmail || '').trim().toLowerCase().slice(0, 120);
  if (!organizerName || !EMAIL.test(organizerEmail)) return { ok: false as const, error: 'Add your name and email — your link to manage it goes there.' };
  const recipientName = String(b.recipientName || '').trim().slice(0, 80); if (!recipientName) return { ok: false as const, error: 'Add who it’s for.' };
  const via = ['email', 'text', 'me'].includes(b.via) ? (b.via as 'email' | 'text' | 'me') : null; if (!via) return { ok: false as const, error: 'Choose how it gets to them.' };
  const recipientEmail = via === 'email' ? String(b.recipientEmail || '').trim().toLowerCase().slice(0, 120) : null;
  const recipientPhone = via === 'text' ? String(b.recipientPhone || '').replace(/[^\d+]/g, '').slice(0, 16) : null;
  if (via === 'email' && !EMAIL.test(recipientEmail || '')) return { ok: false as const, error: 'Add their email.' };
  if (via === 'text' && (recipientPhone || '').replace(/\D/g, '').length < 10) return { ok: false as const, error: 'Add their mobile number.' };
  const at = Date.parse(String(b.sendAt || ''));
  if (!Number.isFinite(at) || at < Date.now() + 30 * 60000 || at > Date.now() + 120 * 864e5) return { ok: false as const, error: 'Choose when it’s sent — at least an hour from now, within four months — so people have time to chip in.' };
  const goalCents = Math.round(Number(b.goal) * 100) || 0;
  const dz = designsSync().find((d) => d.id === design); const line = String(b.line ?? '').trim().slice(0, 30);
  const ref = db.collection(`${T(tenantId)}/giftGroups`).doc();
  const group = { id: ref.id, status: 'collecting', design, line: b.line === undefined ? dz?.line || null : line || null, organizerName, organizerEmail, recipientName, via, recipientEmail, recipientPhone,
    message: String(b.message || '').trim().slice(0, 400) || null, sendAt: new Date(at).toISOString(), goalCents: goalCents >= MIN_SHARE && goalCents <= s.max * 100 * 20 ? goalCents : null,
    totalCents: 0, count: 0, names: [] as string[], createdAt: now(), cardId: null };
  await ref.set(group);
  const r: any = await startChip(db, tenantId, ref.id, { name: organizerName, email: organizerEmail, message: null, amount: b.amount, organizer: true }, origin, t);
  if (!r.ok) { await ref.delete().catch(() => {}); return r; }
  return { ...r, groupId: ref.id };
}

/** One share: saved as a gift card order (groupId) and paid through the same embedded payment form. */
export async function startChip(db: any, tenantId: string, groupId: string, b: { name: any; email: any; message?: any; amount: any; organizer?: boolean }, origin: string, tIn?: any) {
  const t: any = tIn || (await db.doc(T(tenantId)).get()).data(); if (!t?.stripeAccountId) return { ok: false as const, error: 'Gift cards aren’t sold online here right now.' };
  const g: any = (await db.doc(`${T(tenantId)}/giftGroups/${groupId}`).get()).data(); if (!g) return { ok: false as const, error: 'That gift wasn’t found.' };
  if (g.status !== 'collecting' || Date.parse(g.sendAt) <= Date.now()) return { ok: false as const, error: g.status === 'cancelled' ? 'This gift was cancelled.' : 'This gift has already been sent — thank you!' };
  const s = shopSettings(t); const cents = Math.round(Number(b.amount) * 100);
  if (!(cents >= MIN_SHARE && cents <= s.max * 100)) return { ok: false as const, error: `Choose an amount from ${money(MIN_SHARE)} to ${money(s.max * 100)}.` };
  const name = String(b.name || '').trim().slice(0, 60); const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!name) return { ok: false as const, error: 'Add your name — it goes on the card.' };
  if (!EMAIL.test(email)) return { ok: false as const, error: 'Add your email for the receipt.' };
  const ref = db.collection(`${T(tenantId)}/giftOrders`).doc();
  await ref.set({ id: ref.id, status: 'pending', kind: 'chip', groupId, organizer: b.organizer === true, amountCents: cents, design: g.design, buyerName: name, buyerEmail: email,
    message: String(b.message || '').trim().slice(0, 300) || null, recipientName: g.recipientName, via: 'me', createdAt: now(), cardId: null, stripeAccountId: t.stripeAccountId });
  const session = await stripe().checkout.sessions.create({
    ui_mode: 'embedded', mode: 'payment', customer_email: email, redirect_on_completion: 'never',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `${money(cents)} toward a gift card for ${g.recipientName} — ${t.name || 'Gift card'}`, description: `Collected by ${g.organizerName}` } } }],
    payment_intent_data: { metadata: { tenantId, type: 'gift_card', giftOrderId: ref.id, giftGroupId: groupId }, description: `Gift card share ${money(cents)}` },
    metadata: { tenantId, type: 'gift_card', giftOrderId: ref.id, giftGroupId: groupId },
  } as any, { stripeAccount: t.stripeAccountId });
  await ref.set({ checkoutSessionId: session.id }, { merge: true }); void origin;
  return { ok: true as const, orderId: ref.id, clientSecret: session.client_secret, stripeAccountId: t.stripeAccountId, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '' };
}

/** A share was paid (called from completeGiftOrder, once per order). Adds it to the gift, records the money, says thanks. */
export async function completeChip(db: any, tenantId: string, orderId: string, o: any, p: { sessionId: string; paymentIntent?: string | null; amountTotal?: number | null; chargeId?: string | null; origin?: string | null }) {
  const oref = db.doc(`${T(tenantId)}/giftOrders/${orderId}`); const gref = db.doc(`${T(tenantId)}/giftGroups/${o.groupId}`);
  const cents = Number(p.amountTotal) > 0 ? Number(p.amountTotal) : o.amountCents;
  const added = await db.runTransaction(async (tx: any) => { const g = (await tx.get(gref)).data(); if (!g || g.status !== 'collecting') return null;
    tx.update(gref, { totalCents: (Number(g.totalCents) || 0) + cents, count: (Number(g.count) || 0) + 1, names: [...(g.names || []), o.buyerName].slice(0, 200), updatedAt: now() }); return g; });
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  if (!added) {   // paid after the gift was sent or cancelled — give it straight back
    const { refundPaymentIntent } = await import('@/lib/stripe-refund'); const back = p.paymentIntent ? await refundPaymentIntent(o.stripeAccountId || t.stripeAccountId, p.paymentIntent) : false;
    await oref.set({ status: back ? 'refunded' : 'paid', late: true, refundedAt: back ? now() : null }, { merge: true }); return { ok: true as const, late: true };
  }
  const txRef = db.collection(`${T(tenantId)}/transactions`).doc();
  await txRef.set({ id: txRef.id, date: now(), description: `Gift card share: ${money(cents)} toward ${o.recipientName}’s gift (from ${o.buyerName})`, clientOrVendor: o.buyerName, type: 'income', context: 'Business',
    category: 'Gift Card Sales', taxBucket: 'transfer', amount: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: true, checkoutSessionId: p.sessionId, stripeChargeId: p.chargeId || null, giftGroupId: o.groupId, giftOrderId: orderId, tenantId });
  await oref.set({ status: 'paid', amountCents: cents, transactionId: txRef.id }, { merge: true });
  await chipReceipt(db, tenantId, t, o, added, cents, p.origin).catch(() => {});
  return { ok: true as const };
}

async function chipReceipt(db: any, tenantId: string, t: any, o: any, g: any, cents: number, reqOrigin?: string | null) {
  const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(t, reqOrigin || ''); if (!origin) return;
  const first = String(o.buyerName).split(' ')[0]; const biz = t.name || 'us'; const sendDay = new Date(g.sendAt).toLocaleString('en-US', { timeZone: t.timezone || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  const manage = o.organizer ? `${origin}${groupPath(tenantId, o.groupId, 'org')}` : `${origin}${groupPath(tenantId, o.groupId, 'share')}`;
  const share = `${origin}${groupPath(tenantId, o.groupId, 'share')}`;
  const lines = o.organizer
    ? [`You’ve started a gift for ${esc(g.recipientName)} with your ${money(cents)}. Share this link so others can chip in and sign the card:`, `<a href="${share}">${share}</a>`, `It’s sent on ${esc(sendDay)} with everyone’s name on it. You can change the day, send it early, or cancel (everyone is refunded) here:`]
    : [`Thank you for chipping in ${money(cents)} toward ${esc(g.recipientName)}’s gift. ${esc(String(g.organizerName).split(' ')[0])} is collecting, and it’s sent on ${esc(sendDay)} with your name on it.`];
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 16px">Thank you, ${esc(first)}</h1>
${lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${l}</p>`).join('')}
<p style="margin:6px 0 18px"><a href="${manage}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">${o.organizer ? 'Manage the gift' : 'See the gift'}</a></p>
<p style="font-size:13px;color:#6d7075;margin:0">Receipt: ${money(cents)} toward a gift card from ${esc(biz)}.</p></div>`;
  const { sendNotification } = await import('@/lib/notify');
  await sendNotification(db, { tenantId, channel: 'email', to: o.buyerEmail, subject: o.organizer ? `Your gift for ${g.recipientName} — share the link` : `Thank you for chipping in for ${g.recipientName}`, html, text: `${lines.join(' ').replace(/<[^>]+>/g, '')} ${manage}`, kind: 'gift_card', recipientType: 'client', recipientName: o.buyerName } as any);
}

/** What the share page shows. The organizer also sees each share; everyone else sees names, not amounts. */
export async function groupView(db: any, tenantId: string, id: string, role: 'org' | 'share') {
  const g: any = (await db.doc(`${T(tenantId)}/giftGroups/${id}`).get()).data(); if (!g) return null;
  const base = { id, role, status: g.status, design: g.design, line: g.line, recipientName: g.recipientName, organizerName: g.organizerName, via: g.via, sendAt: g.sendAt, totalCents: g.totalCents || 0,
    goalCents: g.goalCents || null, count: g.count || 0, names: (g.names || []).map((n: string) => String(n).split(' ')[0]), sentAt: g.sentAt || null };
  if (role !== 'org') return base;
  const chips = (await db.collection(`${T(tenantId)}/giftOrders`).where('groupId', '==', id).get()).docs.map((d: any) => d.data()).filter((c: any) => c.status === 'paid' || c.status === 'refunded')
    .map((c: any) => ({ name: c.buyerName, cents: c.amountCents, message: c.message || null, status: c.status, organizer: !!c.organizer }));
  return { ...base, chips, message: g.message, recipientEmail: g.recipientEmail, recipientPhone: g.recipientPhone ? `•••${String(g.recipientPhone).slice(-4)}` : null,
    sharePath: groupPath(tenantId, id, 'share'), cardPath: g.cardId ? giftPath(tenantId, g.cardId) : null };
}

/** Make the one card for every paid share and send it (the day comes, or the organizer sends it early). Runs once. */
export async function finishGroup(db: any, tenantId: string, id: string, by = 'Online') {
  const gref = db.doc(`${T(tenantId)}/giftGroups/${id}`);
  const g: any = await db.runTransaction(async (tx: any) => { const x = (await tx.get(gref)).data(); if (!x || x.status !== 'collecting') return null; tx.update(gref, { status: 'issuing', issuingAt: now() }); return x; });
  if (!g) return { ok: false as const, error: 'This gift has already been sent or cancelled.' };
  const chips = (await db.collection(`${T(tenantId)}/giftOrders`).where('groupId', '==', id).get()).docs.map((d: any) => d.data()).filter((c: any) => c.status === 'paid')
    .sort((a: any, b: any) => Number(!!b.organizer) - Number(!!a.organizer) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const total = chips.reduce((s: number, c: any) => s + (Number(c.amountCents) || 0), 0);
  if (total <= 0) { await gref.set({ status: 'cancelled', cancelledAt: now(), cancelReason: 'Nobody chipped in' }, { merge: true }); return { ok: false as const, error: 'Nothing was paid toward it.' }; }
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  const notes = chips.map((c: any) => ({ name: String(c.buyerName).split(' ')[0], message: c.message || null })).filter((n: any) => n.message);
  const r: any = await issueGiftCard(db, tenantId, { amountCents: total, by, source: 'online', purchaser: { id: null, name: namesLine(chips.map((c: any) => c.buyerName)) }, purchaserEmail: g.organizerEmail,
    recipient: { id: null, name: g.recipientName, phone: g.recipientPhone, email: g.recipientEmail }, message: g.message, design: g.design, line: g.line, sendVia: g.via === 'me' ? 'code' : g.via, transactionId: `group:${id}` });
  if (!r.ok) { await gref.set({ status: 'collecting', issueError: r.error }, { merge: true }); return { ok: false as const, error: r.error }; }
  await db.doc(`${T(tenantId)}/giftCards/${r.card.id}`).set({ groupId: id, notes, givers: chips.length }, { merge: true });
  let sent = false; if (g.via === 'email' || g.via === 'text') sent = (await deliverGiftCard(db, tenantId, t, { ...r.card, purchaserName: namesLine(chips.map((c: any) => c.buyerName)), givers: chips.length, notes }).catch(() => ({ sent: false }))).sent;
  await gref.set({ status: 'sent', sentAt: now(), cardId: r.card.id, totalCents: total, count: chips.length, sendStatus: sent ? 'sent' : g.via === 'me' ? 'organizer' : 'failed' }, { merge: true });
  // Tell the organizer: it went, how much, from how many — and the card itself when it's theirs to hand over.
  try { const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(t, ''); const { sendNotification } = await import('@/lib/notify');
    const card = origin ? `${origin}${giftPath(tenantId, r.card.id)}` : '';
    const text = g.via === 'me' ? `Your gift for ${g.recipientName} is ready: ${money(total)} from ${chips.length} ${chips.length === 1 ? 'person' : 'people'}. Give them this link or print it: ${card}`
      : sent ? `Sent! ${g.recipientName} has their ${money(total)} gift card from ${chips.length} ${chips.length === 1 ? 'person' : 'people'}.` : `We couldn’t send ${g.recipientName}’s gift card — check their ${g.via === 'text' ? 'number' : 'email'}. The card: ${card}`;
    await sendNotification(db, { tenantId, channel: 'email', to: g.organizerEmail, subject: g.via === 'me' ? `${g.recipientName}’s gift card is ready` : sent ? `${g.recipientName}’s gift was sent` : `${g.recipientName}’s gift didn’t send`, text,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px"><p style="font-size:15px;line-height:1.55">${esc(text).replace(esc(card), card ? `<a href="${card}">${card}</a>` : '')}</p></div>`, kind: 'gift_card', recipientType: 'client', recipientName: g.organizerName } as any); } catch { /* the card is made; the note is a courtesy */ }
  return { ok: true as const, cardId: r.card.id, totalCents: total, sent };
}

/** The organizer cancels before it's sent: every share goes back to the card it came from. */
export async function cancelGroup(db: any, tenantId: string, id: string) {
  const gref = db.doc(`${T(tenantId)}/giftGroups/${id}`);
  const ok = await db.runTransaction(async (tx: any) => { const x = (await tx.get(gref)).data(); if (!x || x.status !== 'collecting') return false; tx.update(gref, { status: 'cancelling' }); return true; });
  if (!ok) return { ok: false as const, error: 'It can’t be cancelled now — it’s been sent or already cancelled.' };
  const t: any = (await db.doc(T(tenantId)).get()).data() || {}; const { refundAmount } = await import('@/lib/stripe-refund');
  const snap = await db.collection(`${T(tenantId)}/giftOrders`).where('groupId', '==', id).get(); let back = 0, stuck = 0;
  for (const d of snap.docs) { const c: any = d.data(); if (c.status !== 'paid') { if (c.status === 'pending') await d.ref.set({ status: 'cancelled' }, { merge: true }); continue; }
    const pi = c.paymentIntentId || null; const r = pi ? await refundAmount(c.stripeAccountId || t.stripeAccountId, pi, c.amountCents, `group-refund-${d.id}`) : { ok: false };
    if (r.ok) { back += c.amountCents; await d.ref.set({ status: 'refunded', refundedAt: now() }, { merge: true });
      const txRef = db.collection(`${T(tenantId)}/transactions`).doc();
      await txRef.set({ id: txRef.id, date: now(), description: `Gift card share refunded: ${money(c.amountCents)} to ${c.buyerName} (the gift was cancelled)`, clientOrVendor: c.buyerName, type: 'income', context: 'Business', category: 'Gift Card Sales', taxBucket: 'transfer', amount: -(c.amountCents / 100), paymentMethod: 'Online Checkout', hasReceipt: true, giftGroupId: id, giftOrderId: d.id, tenantId });
    } else stuck++; }
  await gref.set({ status: stuck ? 'collecting' : 'cancelled', cancelledAt: stuck ? null : now(), refundedCents: back, refundStuck: stuck || null }, { merge: true });
  if (stuck) return { ok: false as const, error: `${stuck} share${stuck === 1 ? '' : 's'} couldn’t be refunded automatically — the business will sort it out. Nothing else changed.` };
  return { ok: true as const, refundedCents: back };
}

/** Change the day it's sent (organizer). */
export async function moveGroup(db: any, tenantId: string, id: string, sendAt: any) {
  const at = Date.parse(String(sendAt || '')); if (!Number.isFinite(at) || at < Date.now() + 10 * 60000 || at > Date.now() + 120 * 864e5) return { ok: false as const, error: 'Choose a time from later today to four months out.' };
  const gref = db.doc(`${T(tenantId)}/giftGroups/${id}`); const g: any = (await gref.get()).data(); if (!g || g.status !== 'collecting') return { ok: false as const, error: 'It’s already been sent or cancelled.' };
  await gref.set({ sendAt: new Date(at).toISOString() }, { merge: true }); return { ok: true as const };
}

/** The hourly run: gifts whose day has come are made and sent. */
export async function giftGroupSweep(db: any, tenantId: string) {
  const snap = await db.collection(`${T(tenantId)}/giftGroups`).where('status', '==', 'collecting').get();
  for (const d of snap.docs) { const g: any = d.data(); if (Date.parse(g.sendAt) <= Date.now()) await finishGroup(db, tenantId, d.id).catch((e: any) => console.error('[gift groups] finish', e?.message)); }
}
