// src/lib/card-save.ts — A CLIENT SAVES A CARD FROM THEIR OWN PHONE (no visit attached): "add your card" for members who
// moved over from another app (card details can't be moved between apps), or anyone the business asks to keep a card on
// file. The link is private to that client (signed). The card is saved through the payment processor's own form in setup
// mode — nothing is charged — UNDER A CUSTOMER on the business's account, so it can be charged later (a card saved with no
// customer can't be: the charge route refuses it).
import { createHmac } from 'crypto';
import Stripe from 'stripe';

const T = (t: string) => `tenants/${t}`;
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });

export function cardKey(tenantId: string, clientId: string) {
  const secret = process.env.LINK_SECRET || process.env.GIFT_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'card';
  return createHmac('sha256', secret).update(`card:${tenantId}/${clientId}`).digest('base64url').slice(0, 22);
}
export const cardPath = (tenantId: string, clientId: string) => `/card/${encodeURIComponent(tenantId)}/${encodeURIComponent(clientId)}?k=${cardKey(tenantId, clientId)}`;

/** The client's customer on the business's account — the one already on their card, or a new one (remembered). */
export async function ensureStripeCustomer(db: any, tenantId: string, acct: string, clientId: string, c: any): Promise<string> {
  const have = c?.cardOnFile?.customerId || c?.cardOnFile?.stripeCustomerId || c?.stripeCustomerId;
  if (have) return String(have);
  const cu = await stripe().customers.create({ name: c?.name || undefined, email: c?.email || undefined, phone: c?.phone || undefined, metadata: { tenantId, clientId } }, { stripeAccount: acct });
  await db.doc(`${T(tenantId)}/clients/${clientId}`).set({ stripeCustomerId: cu.id }, { merge: true });
  return cu.id;
}

/** What the add-your-card page shows: who it's for, and their membership if they have one. Nothing else. */
export async function cardView(db: any, tenantId: string, clientId: string) {
  const [cs, ts] = await Promise.all([db.doc(`${T(tenantId)}/clients/${clientId}`).get(), db.doc(T(tenantId)).get()]);
  const c: any = cs.data(); const t: any = ts.data(); if (!c || !t) return null;
  const sub = c.subscription && ['active', 'past_due'].includes(c.subscription.status) ? c.subscription : null;
  const plan: any = sub?.membershipId ? (await db.doc(`${T(tenantId)}/memberships/${sub.membershipId}`).get()).data() : null;
  const { hasRealCard } = await import('@/lib/card-on-file');
  return { business: t.name || 'Your studio', firstName: String(c.name || '').split(' ')[0] || null, canSave: !!t.stripeAccountId,
    membership: plan ? { name: plan.name, price: Number(plan.price) || 0, interval: plan.interval || 'monthly', nextCharge: sub.nextBillingDate || null } : null,
    card: hasRealCard(c) && (c.cardOnFile?.customerId || c.stripeCustomerId) ? { brand: c.cardOnFile.brand || 'Card', last4: c.cardOnFile.last4 || '' } : null };
}

/** Open the card form (embedded, setup mode, under their customer). */
export async function startCardSave(db: any, tenantId: string, clientId: string) {
  const t: any = (await db.doc(T(tenantId)).get()).data(); const c: any = (await db.doc(`${T(tenantId)}/clients/${clientId}`).get()).data();
  if (!t?.stripeAccountId || !c) return { ok: false as const, error: 'Cards can’t be saved here right now.' };
  const customer = await ensureStripeCustomer(db, tenantId, t.stripeAccountId, clientId, c);
  const session = await stripe().checkout.sessions.create({ ui_mode: 'embedded', mode: 'setup', payment_method_types: ['card'], customer, client_reference_id: clientId,
    setup_intent_data: { metadata: { tenantId, clientId, type: 'card_save' } }, metadata: { tenantId, clientId, type: 'card_save' }, redirect_on_completion: 'never' } as any, { stripeAccount: t.stripeAccountId });
  return { ok: true as const, clientSecret: session.client_secret, sessionId: session.id, stripeAccountId: t.stripeAccountId, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '' };
}

/** Back from the form: save the card on their record now (the webhook does the same; both are safe to run). */
export async function confirmCardSave(db: any, tenantId: string, clientId: string, sessionId: string) {
  const t: any = (await db.doc(T(tenantId)).get()).data(); if (!t?.stripeAccountId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: false as const };
  const s = stripe(); const sess: any = await s.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: t.stripeAccountId });
  if (sess.client_reference_id !== clientId || sess.status !== 'complete' || !sess.setup_intent) return { ok: true as const, saved: false };
  const si: any = await s.setupIntents.retrieve(typeof sess.setup_intent === 'string' ? sess.setup_intent : sess.setup_intent.id, {}, { stripeAccount: t.stripeAccountId });
  const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id; if (!pmId) return { ok: true as const, saved: false };
  const pm: any = await s.paymentMethods.retrieve(pmId, {}, { stripeAccount: t.stripeAccountId });
  const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id || null;
  const now = new Date().toISOString();
  await db.doc(`${T(tenantId)}/clients/${clientId}`).set({ cardOnFile: { paymentMethodId: pmId, customerId, brand: pm.card?.brand || 'card', last4: pm.card?.last4 || '', expMonth: pm.card?.exp_month || null, expYear: pm.card?.exp_year || null, savedAt: now, source: 'card_link' },
    cardLink: { savedAt: now } }, { merge: true });
  return { ok: true as const, saved: true, brand: pm.card?.brand || 'card', last4: pm.card?.last4 || '' };
}

// ─────────────────────────── MEMBERS WHO NEED TO ADD A CARD ───────────────────────────
const fmtDay = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz || 'America/New_York' });

/** Every member and whether they have a card the renewal can charge (Moving in → Cards on file). */
export async function membersCards(db: any, tenantId: string) {
  const [snap, plans] = await Promise.all([db.collection(`${T(tenantId)}/clients`).where('subscription.status', 'in', ['active', 'past_due']).get(), db.collection(`${T(tenantId)}/memberships`).get()]);
  const planOf = new Map(plans.docs.map((d: any) => [d.id, d.data()]));
  const { hasRealCard } = await import('@/lib/card-on-file');
  return snap.docs.map((d: any) => { const c: any = d.data(); const p: any = planOf.get(c.subscription?.membershipId) || {};
    const ok = hasRealCard(c) && !!(c.cardOnFile?.customerId || c.cardOnFile?.stripeCustomerId || c.stripeCustomerId);
    return { clientId: d.id, name: c.name || 'Member', plan: p.name || 'Membership', price: Number(p.price) || 0, interval: p.interval || 'monthly', nextCharge: c.subscription?.nextBillingDate || null,
      status: c.subscription?.status, card: ok ? { brand: c.cardOnFile.brand || 'Card', last4: c.cardOnFile.last4 || '', savedAt: c.cardOnFile.savedAt || null } : null,
      link: c.cardLink ? { sentAt: c.cardLink.sentAt || null, count: c.cardLink.count || 0, savedAt: c.cardLink.savedAt || null } : null,
      waiting: c.subscription?.waitingForCardSince || null, canText: !!c.phone, canEmail: !!c.email };
  }).sort((a: any, b: any) => Number(!!a.card) - Number(!!b.card) || String(a.nextCharge || '9').localeCompare(String(b.nextCharge || '9')));
}

/** Send one member their private add-your-card link (text if we can, otherwise email). */
export async function sendCardLink(db: any, tenantId: string, clientId: string, origin: string, why: 'manual' | 'reminder' | 'renewal' = 'manual') {
  const ref = db.doc(`${T(tenantId)}/clients/${clientId}`); const [cs, ts] = await Promise.all([ref.get(), db.doc(T(tenantId)).get()]);
  const c: any = cs.data(); const t: any = ts.data() || {}; if (!c) return { ok: false as const, error: 'That client wasn’t found.' };
  const { linkOrigin } = await import('@/lib/app-origin'); const link = `${linkOrigin(t, origin)}${cardPath(tenantId, clientId)}`;
  const plan: any = c.subscription?.membershipId ? (await db.doc(`${T(tenantId)}/memberships/${c.subscription.membershipId}`).get()).data() : null;
  const biz = t.name || 'Your studio'; const first = String(c.name || '').split(' ')[0];
  const when = c.subscription?.nextBillingDate ? fmtDay(c.subscription.nextBillingDate, t.timezone) : null;
  const text = plan
    ? `${biz}: Hi ${first}! To keep your ${plan.name} membership going${when ? ` (next charge ${when})` : ''}, please add your card here — it takes a minute: ${link}`
    : `${biz}: Hi ${first}! Please add a card to keep on file with us: ${link}`;
  const { sendNotification } = await import('@/lib/notify'); let sent = false; let via: 'text' | 'email' | null = null;
  if (c.phone) { const r: any = await sendNotification(db, { tenantId, channel: 'sms', to: c.phone, text, kind: 'card_on_file', clientId, clientName: c.name || null, recipientType: 'client' } as any).catch(() => null); sent = ['sent', 'queued', 'delivered'].includes(String(r?.status)); if (sent) via = 'text'; }
  if (!sent && c.email) { const r: any = await sendNotification(db, { tenantId, channel: 'email', to: c.email, subject: plan ? `Keep your ${plan.name} membership going` : `Add your card — ${biz}`, text,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px"><p style="font-size:13px;color:#6d7075;margin:0 0 6px">${biz}</p><h1 style="font-weight:400;font-size:26px;letter-spacing:-.02em;margin:0 0 12px">${plan ? `Keep your ${plan.name} membership going` : 'Add your card'}</h1><p style="font-size:15px;line-height:1.55;margin:0 0 18px">We’ve moved to a new booking system. Add your card here so ${plan ? `your membership carries on${when ? ` — your next charge is ${when}` : ''}` : 'it’s on file for your visits'}. Nothing else changes.</p><p><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">Add my card</a></p></div>`,
    kind: 'card_on_file', clientId, clientName: c.name || null, recipientType: 'client' } as any).catch(() => null); sent = ['sent', 'queued', 'delivered'].includes(String(r?.status)); if (sent) via = 'email'; }
  if (!sent) return { ok: false as const, error: c.phone || c.email ? 'It didn’t send — check their number and email.' : 'They have no phone or email on file.' };
  await ref.set({ cardLink: { ...(c.cardLink || {}), sentAt: new Date().toISOString(), count: (Number(c.cardLink?.count) || 0) + 1, lastWhy: why, lastVia: via } }, { merge: true });
  return { ok: true as const, via };
}

/** Daily: a member without a chargeable card, whose link went out, is reminded 3 days and 1 day before their next charge. */
export async function cardReminderSweep(db: any, tenantId: string) {
  const list = await membersCards(db, tenantId); let sent = 0;
  for (const m of list) { if (m.card || !m.link?.sentAt || !m.nextCharge) continue;
    const days = Math.ceil((Date.parse(m.nextCharge) - Date.now()) / 864e5); if (days !== 3 && days !== 1) continue;
    if (Date.now() - Date.parse(m.link.sentAt) < 20 * 3600e3) continue;   // never twice in a day
    const r = await sendCardLink(db, tenantId, m.clientId, '', 'reminder').catch(() => null); if (r?.ok) sent++; }
  return sent;
}
