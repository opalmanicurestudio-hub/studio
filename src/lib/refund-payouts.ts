// src/lib/refund-payouts.ts — GETTING A REFUND BACK TO A CLIENT WHO PAID IN CASH (server).
// A card sale goes back to the card (lib/money-refund). A cash sale can't, so the business offers what it switched on in
// Settings → Making it right → Refunds on cash sales: pick up cash at the desk, store credit, or one of Venmo / Zelle /
// Cash App / Apple Cash (sent by staff from the business's own account — the app records it, it doesn't move the money).
// Staff either pick the way for the client or text them a link to choose (/refund/{tenant}/{id}?k=).
//
// Cash pickup: the client books a window inside studio hours and gets a 4-digit code. On the day the desk prints the
// envelope slip and note, takes the cash from the open till (a till payout, so the drawer still balances), a second person
// counts and seals it, and at handover the code must match and the client signs. Only then is the refund written to the
// books. The client can say they're on the way (and, if they choose, share how far away they are — distance and time only,
// never their coordinates). Not collected by close: the cash goes back in the till and they're asked to pick a new time;
// after the business's limit of missed pickups, pickup is no longer offered.
import { createHmac, randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { settingsOf, PAY_APPS, type PayApp } from '@/lib/making-it-right';
import { tenantTimeZone, wallToUtc, todayIn, addDays } from '@/lib/tenant-time';
import { brandAccent, brandLogo } from '@/lib/brand-accent';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const money = (c: number) => `$${(Math.round(c) / 100).toFixed(2)}`;
const SECRET = () => process.env.LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'clarityflow-links';
export const payoutKey = (tenantId: string, id: string) => createHmac('sha256', SECRET()).update(`refund:${tenantId}:${id}`).digest('base64url').slice(0, 16);
export const payoutPath = (tenantId: string, id: string) => `/refund/${tenantId}/${id}?k=${payoutKey(tenantId, id)}`;

export type Method = 'pickup' | 'credit' | PayApp;
export const METHOD_LABEL: Record<Method, string> = { pickup: 'Cash pickup', credit: 'Store credit', venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', applecash: 'Apple Cash' };
const isApp = (m: any): m is PayApp => ['venmo', 'zelle', 'cashapp', 'applecash'].includes(String(m));
const DESK = ['front_desk', 'manager', 'admin', 'owner'];
const MANAGERS = ['owner', 'admin', 'manager'];

/** The ways this business offers right now (pickup drops out once a client has missed too many). */
export function methodsFor(tenant: any, p?: any): Method[] {
  const C = settingsOf(tenant).cashRefund; const out: Method[] = [];
  if (C.pickup && !p?.pickupBlocked) out.push('pickup');
  (Object.keys(C.apps) as PayApp[]).forEach((k) => { if (C.apps[k].on) out.push(k); });
  if (C.credit) out.push('credit');
  return out;
}

/** Bills for an envelope, largest first — so the person preparing it isn't doing sums at the drawer. */
export function bills(cents: number): { label: string; count: number }[] {
  let left = Math.round(cents); const out: { label: string; count: number }[] = [];
  for (const [v, label] of [[10000, '$100'], [5000, '$50'], [2000, '$20'], [1000, '$10'], [500, '$5'], [100, '$1'], [25, '25¢'], [10, '10¢'], [5, '5¢'], [1, '1¢']] as [number, string][]) {
    const n = Math.floor(left / v); if (n > 0) { out.push({ label, count: n }); left -= n * v; }
  }
  return out;
}

const hhmm = (v: any): string | null => {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i); if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
};
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toT = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const timeLabel = (t: string) => { const h = Number(t.slice(0, 2)); const m = t.slice(3, 5); const h12 = h % 12 || 12; return `${h12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; };
export const windowLabel = (w: { start: string; end: string }) => `${timeLabel(w.start)}–${timeLabel(w.end)}`;

/** Pickup windows: two-hour blocks inside the studio's hours, for the next week, none starting within 30 minutes. */
export async function pickupWindows(db: any, tenantId: string, tenant: any, days = 7) {
  const tz = tenantTimeZone(tenant); const profs = (await db.collection(`${T(tenantId)}/scheduleProfiles`).get()).docs.map((d: any) => d.data() || {});
  const profile = profs.find((p: any) => p?.isActive) || profs[0] || null; const today = todayIn(tz); const soon = Date.now() + 30 * 60000;
  const out: { date: string; start: string; end: string; dayLabel: string }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i); const dayName = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
    const day = profile?.week?.[dayName]; let open: string | null = null, close: string | null = null;
    if (profile) { if (!day || !day.enabled) continue; open = hhmm(day.start); close = hhmm(day.end); } else { open = '10:00'; close = '18:00'; }
    if (!open || !close || mins(close) - mins(open) < 30) continue;
    const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    for (let s = mins(open); s < mins(close) - 15; s += 120) {
      const e = Math.min(s + 120, mins(close)); const start = toT(s), end = toT(e);
      if (wallToUtc(date, Number(end.slice(0, 2)), Number(end.slice(3, 5)), tz).getTime() < soon) continue;
      out.push({ date, start, end, dayLabel });
    }
  }
  return out;
}

/** The note that goes in the envelope — drafted from the case, edited by the desk before printing. */
export function noteDraft(p: any, tenant: any): string {
  const first = String(p.clientFirst || p.clientName || '').split(' ')[0] || 'there';
  const what = `letting us know your ${p.serviceName ? String(p.serviceName).toLowerCase() : 'visit'} wasn’t right`;
  const enclosed = p.method === 'pickup' ? `Your ${money(p.amountCents)} is enclosed.` : `Your ${money(p.amountCents)} is on its way to you.`;
  return `Dear ${first},\n\nThank you for ${what}. You deserved better from us, and we’re sorry. ${enclosed}\n\nWe’d love to see you again whenever you’re ready.`;
}

async function staffList(db: any, tenantId: string) { return (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true); }

/** Who hears about refunds: managers and the owner always; the front desk when they're clocked in (all of them if nobody is). */
async function deskIds(db: any, tenantId: string, tenant: any) {
  const staff = await staffList(db, tenantId); const mgr = staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id);
  const desk = staff.filter((s: any) => s.role === 'front_desk'); const on = desk.filter((s: any) => s.isClockedIn === true);
  return [...new Set([...(on.length ? on : desk).map((s: any) => s.id), ...mgr, tenant?.userId].filter(Boolean))] as string[];
}
async function tellDesk(db: any, tenantId: string, tenant: any, type: string, message: string, id: string, urgent = false) {
  const ids = await deskIds(db, tenantId, tenant); const b = db.batch();
  for (const u of ids) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type, message, link: `/refunds?id=${id}`, payoutId: id, createdAt: now(), read: false }); }
  await b.commit();
  if (urgent) { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId); }
}

/** "Hi Ana, " to open a client text. */
const hi = (p: any) => `Hi ${p?.clientFirst || 'there'}, `;

async function textClient(db: any, tenantId: string, tenant: any, p: any, body: string, withLink = true): Promise<boolean> {
  try {
    const { sendTenantSms, smsConfigured } = await import('@/lib/sms');
    let phone = p.phone || ''; let email = p.email || '';
    if ((!phone || !email) && p.clientId) { const cl: any = (await db.doc(`${T(tenantId)}/clients/${p.clientId}`).get()).data() || {}; phone = phone || cl.phone || cl.phoneNumber || ''; email = email || cl.email || ''; }
    if (!phone && !email) return false; if (!smsConfigured() && !email) return false;
    const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, '');
    const link = withLink && base ? ` ${base}${payoutPath(tenantId, p.id)}` : '';
    const r: any = await sendTenantSms(db, tenantId, phone, `${body}${link}`, { email, subject: 'An update about your refund' }, { kind: 'refund', recipientType: 'client', recipientId: p.clientId || null, recipientName: p.clientName || null, appointmentId: p.appointmentId || null } as any);
    return !!(r?.ok ?? r?.sent ?? true);
  } catch { return false; }
}

const line = (by: string, text: string) => ({ at: now(), by, text });
// The pickup code lives where only the server can read it — staff devices never see it, so only the client can collect.
const codeRef = (db: any, tenantId: string, id: string) => db.doc(`${T(tenantId)}/refundCodes/${id}`);
async function codeOf(db: any, tenantId: string, id: string): Promise<string | null> { const s = await codeRef(db, tenantId, id).get(); return s.exists ? String((s.data() || {}).code || '') || null : null; }

/** Write the refund to the books (when the money actually left) and close the refund on the case. */
async function settle(db: any, tenantId: string, tenant: any, p: any, via: string, by: string) {
  const T0 = T(tenantId); const at = now(); const cents = Math.round(p.amountCents);
  let sale: any = null;
  if (p.saleId) { const s = await db.doc(`${T0}/transactions/${p.saleId}`).get(); sale = s.exists ? { id: s.id, ...s.data() } : null; }
  // Loyalty: a refund takes back the points that money earned (lib/loyalty-server).
  if (sale?.checkoutSessionId) { try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: String(sale.checkoutSessionId), refundCents: cents, refundId: `p${p.id}`, by }); } catch { /* best effort */ } }
  if (via !== 'Store credit') {
    const rev = db.collection(`${T0}/transactions`).doc();
    await rev.set({ id: rev.id, date: at, description: `Refund for: ${sale?.description || p.serviceName || 'visit'}`, clientOrVendor: p.clientName || null, clientId: p.clientId || null, type: 'reversal', context: sale?.context || null, category: 'Refunds', amount: cents / 100, paymentMethod: via, reversalOf: sale?.id || null, appointmentId: p.appointmentId || null, hasReceipt: false, notes: `${p.number ? `Making it right ${p.number} · ` : ''}${via}${p.app?.ref ? ` · ref ${p.app.ref}` : ''}`, payoutId: p.id, caseId: p.caseId || null, by, ...(p.ledger || {}) });
    if (sale && !sale.refundedAt) await db.doc(`${T0}/transactions/${sale.id}`).set({ refundedAt: at, refundTransactionId: rev.id, refundPendingId: null }, { merge: true });
  } else if (sale) {
    await db.doc(`${T0}/transactions/${sale.id}`).set({ refundPendingId: null, refundedAsCreditAt: at }, { merge: true });
  }
  if (p.caseId) {
    await db.doc(`${T0}/cases/${p.caseId}`).set({ fix: { refundedAt: at, refundedCents: cents, refundVia: via, todo: null }, updatedAt: at, timeline: FieldValue.arrayUnion(line(by, `Refund of ${money(cents)} given — ${via}`)) }, { merge: true });
  }
}

async function issueCredit(db: any, tenantId: string, p: any, by: string) {
  if (!p.clientId) return { ok: false as const, error: 'This refund isn’t linked to a client account, so credit can’t be added.' };
  const ref = db.doc(`${T(tenantId)}/clients/${p.clientId}`); if (!(await ref.get()).exists) return { ok: false as const, error: 'Client not found.' };
  const { nanoid } = await import('nanoid'); const cents = Math.round(p.amountCents);
  // Earned credit: money they already paid, now usable on anything. No new expense line — the sale stays, the credit is spent later.
  await ref.update({ storeCredits: FieldValue.arrayUnion({ id: nanoid(), tenantId, clientId: p.clientId, appointmentId: p.appointmentId || null, amountCents: cents, amount: cents / 100, type: 'earned', source: 'refund_to_credit', reason: `Refund${p.number ? ` — ${p.number}` : ''}`, createdBy: by, expiresAt: null, createdAt: now(), usedAt: null, usedOnAppointmentId: null, status: 'available' }), totalStoreCredit: FieldValue.increment(cents / 100) });
  return { ok: true as const };
}

/** Start a refund for a client who paid cash. Staff pick the way (mode 'staff') or text the client to choose ('client'). */
export async function createPayout(db: any, tenantId: string, tenant: any, actor: any, b: any) {
  const T0 = T(tenantId); const cents = Math.round(Number(b.amountCents) || 0);
  let c: any = null; if (b.caseId) { const s = await db.doc(`${T0}/cases/${b.caseId}`).get(); c = s.exists ? { id: s.id, ...s.data() } : null; if (!c) return { ok: false as const, error: 'Case not found.' }; }
  const amount = cents > 0 ? cents : Math.round(Number(c?.fix?.amountCents) || 0); if (!(amount > 0)) return { ok: false as const, error: 'Enter the amount.' };
  if (c?.fix?.refundedAt) return { ok: false as const, error: 'This refund was already given.' };
  if (c?.renterCase) return { ok: false as const, error: 'This is a renter’s client — they refund from their own payments.' };
  const open = c ? await db.collection(`${T0}/refundPayouts`).where('caseId', '==', c.id).get() : null;
  if (open && open.docs.some((d: any) => !['cancelled'].includes(d.data().status))) return { ok: false as const, error: 'A refund is already set up for this case — see Refunds.' };
  const appointmentId = String(b.appointmentId || c?.visit?.appointmentId || c?.appointmentId || '');
  let sale: any = null; if (b.saleId) { const s = await db.doc(`${T0}/transactions/${b.saleId}`).get(); sale = s.exists ? { id: s.id, ...s.data() } : null; }
  else if (appointmentId) { const { saleForVisit } = await import('@/lib/money-refund'); sale = await saleForVisit(db, tenantId, appointmentId); }
  if (sale) {
    if (sale.refundedAt || sale.voided) return { ok: false as const, error: 'This sale was already refunded.' };
    const dup = await db.collection(`${T0}/refundPayouts`).where('saleId', '==', sale.id).get();
    if (dup.docs.some((d: any) => d.data().status !== 'cancelled')) return { ok: false as const, error: 'A refund is already set up for this sale — see Refunds to give.' };
  }
  let cl: any = {}; const clientId = String(b.clientId || c?.clientId || sale?.clientId || ''); if (clientId) cl = (await db.doc(`${T0}/clients/${clientId}`).get()).data() || {};
  const clientName = String(c?.clientName || cl.name || sale?.clientOrVendor || 'Client');
  const ref = db.collection(`${T0}/refundPayouts`).doc();
  const p: any = { id: ref.id, number: c?.number || null, caseId: c?.id || null, appointmentId: appointmentId || null, saleId: sale?.id || null, serviceName: c?.visit?.serviceName || null,
    clientId: clientId || null, clientName, clientFirst: clientName.split(' ')[0], phone: cl.phone || cl.phoneNumber || c?.phone || null, email: cl.email || null,
    amountCents: amount, reason: c?.reasonLabel || null, mode: b.mode === 'client' ? 'client' : 'staff', method: null, status: 'choose',
    missed: 0, createdAt: now(), createdBy: actor.name, ...(b.ledger && typeof b.ledger === 'object' ? { ledger: { ...(Array.isArray(b.ledger.payReversals) ? { payReversals: b.ledger.payReversals.slice(0, 10), staffId: String(b.ledger.staffId || '') || null } : {}), ...(b.ledger.tipReversal?.staffId ? { tipReversal: { staffId: String(b.ledger.tipReversal.staffId), amount: Number(b.ledger.tipReversal.amount) || 0 } } : {}) } } : {}), ...(b.reason && !c ? { note: String(b.reason).slice(0, 300) } : {}), updatedAt: now(), timeline: [line(actor.name, `Refund of ${money(amount)} set up`)] };
  p.noteText = noteDraft({ ...p, method: 'pickup' }, tenant);
  const allowed = methodsFor(tenant, p); if (!allowed.length) return { ok: false as const, error: 'Turn on a way to give cash refunds in Settings → Making it right.' };
  const markSale = async () => { if (sale) await db.doc(`${T0}/transactions/${sale.id}`).set({ refundPendingId: ref.id }, { merge: true }); };
  if (p.mode === 'client') {
    await ref.set(p); await markSale();
    const sent = await textClient(db, tenantId, tenant, p, `${hi(p)}we are refunding ${money(amount)} to you. Please choose how you would like to receive your refund here:`);
    await ref.set({ timeline: FieldValue.arrayUnion(line(actor.name, sent ? 'Texted the client to choose how' : 'Couldn’t text the client — share the link')) }, { merge: true });
    if (c) await db.doc(`${T0}/cases/${c.id}`).set({ payoutId: ref.id, updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, `Cash refund: client chooses how (${money(amount)})`)) }, { merge: true });
    return { ok: true as const, id: ref.id, sent, link: payoutPath(tenantId, ref.id) };
  }
  const m = String(b.method || '') as Method; if (!allowed.includes(m)) return { ok: false as const, error: 'Choose how they’ll get it back.' };
  p.method = m; p.noteText = noteDraft(p, tenant);
  await ref.set(p); await markSale();
  if (c) await db.doc(`${T0}/cases/${c.id}`).set({ payoutId: ref.id, updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, `Cash refund: ${METHOD_LABEL[m]} (${money(amount)})`)) }, { merge: true });
  const r = await applyChoice(db, tenantId, tenant, { ...p }, { method: m, pickup: b.pickup, handle: b.handle, accountName: b.accountName }, actor.name, false);
  return r.ok ? { ...r, id: ref.id, link: payoutPath(tenantId, ref.id) } : r;
}

/** Choosing (by staff or the client): pickup with or without a time, an app with their details, or credit. */
async function applyChoice(db: any, tenantId: string, tenant: any, p: any, b: any, by: string, byClient: boolean) {
  const ref = db.doc(`${T(tenantId)}/refundPayouts/${p.id}`); const m = String(b.method || '') as Method;
  if (!methodsFor(tenant, p).includes(m)) return { ok: false as const, error: 'That way isn’t available.' };
  if (m === 'credit') {
    const r = await issueCredit(db, tenantId, p, by); if (!r.ok) return r;
    await ref.set({ method: 'credit', status: 'credited', creditedAt: now(), updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `${money(p.amountCents)} added as store credit`)) }, { merge: true });
    await settle(db, tenantId, tenant, p, 'Store credit', by);
    await textClient(db, tenantId, tenant, p, `${hi(p)}${money(p.amountCents)} has been added as credit to your account for your next visit.`, false);
    if (byClient) await tellDesk(db, tenantId, tenant, 'refund_choice', `${p.clientFirst} has chosen to receive their ${money(p.amountCents)} refund as store credit. No further action is needed.`, p.id);
    return { ok: true as const, status: 'credited' };
  }
  if (isApp(m)) {
    const handle = String(b.handle || '').trim().slice(0, 80); const accountName = String(b.accountName || '').trim().slice(0, 80);
    if (!handle) { await ref.set({ method: m, status: 'choose', updatedAt: now() }, { merge: true }); return { ok: true as const, status: 'needs_details' }; }
    await ref.set({ method: m, status: 'to_send', app: { handle, accountName: accountName || null, confirmedAt: byClient ? now() : null }, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `${PAY_APPS[m].label}: ${handle}${accountName ? ` (${accountName})` : ''}${byClient ? ' — confirmed by the client' : ''}`)) }, { merge: true });
    await tellDesk(db, tenantId, tenant, 'refund_choice', `Action needed: Please send ${p.clientFirst}’s ${money(p.amountCents)} refund by ${PAY_APPS[m].label}.`, p.id);
    if (!byClient) await textClient(db, tenantId, tenant, p, `${hi(p)}we will send your ${money(p.amountCents)} refund by ${PAY_APPS[m].label} to ${handle}. If these details are not correct, please let us know here:`);
    return { ok: true as const, status: 'to_send' };
  }
  // pickup
  const w = b.pickup; if (!w?.date || !w?.start) {
    await ref.set({ method: 'pickup', status: 'pickup_time', updatedAt: now() }, { merge: true });
    if (!byClient) await textClient(db, tenantId, tenant, p, `${hi(p)}your ${money(p.amountCents)} refund will be ready to pick up at the front desk. Please choose a pickup time here:`);
    return { ok: true as const, status: 'pickup_time' };
  }
  return bookPickup(db, tenantId, tenant, { ...p, method: 'pickup' }, w, by, byClient);
}

async function bookPickup(db: any, tenantId: string, tenant: any, p: any, w: any, by: string, byClient: boolean) {
  const wins = await pickupWindows(db, tenantId, tenant); const hit = wins.find((x) => x.date === String(w.date) && x.start === String(w.start));
  if (!hit) return { ok: false as const, error: 'We are sorry, but that time is no longer available. Please choose another time.' };
  const tz = tenantTimeZone(tenant); const startAt = wallToUtc(hit.date, Number(hit.start.slice(0, 2)), Number(hit.start.slice(3, 5)), tz).toISOString(); const endAt = wallToUtc(hit.date, Number(hit.end.slice(0, 2)), Number(hit.end.slice(3, 5)), tz).toISOString();
  const code = (await codeOf(db, tenantId, p.id)) || String(randomInt(0, 10000)).padStart(4, '0'); await codeRef(db, tenantId, p.id).set({ code, at: now() }); const when = `${hit.dayLabel === 'Today' || hit.dayLabel === 'Tomorrow' ? hit.dayLabel.toLowerCase() : hit.dayLabel} ${windowLabel(hit)}`;
  await db.doc(`${T(tenantId)}/refundPayouts/${p.id}`).set({ method: 'pickup', status: 'scheduled', pickup: { date: hit.date, start: hit.start, end: hit.end, startAt, endAt }, trip: null, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Pickup booked: ${when}`)) }, { merge: true });
  await textClient(db, tenantId, tenant, p, `${hi(p)}your ${money(p.amountCents)} refund will be ready at the front desk ${when}. Your pickup code is ${code}. You can view the details here:`);
  if (byClient) await tellDesk(db, tenantId, tenant, 'refund_choice', `${p.clientFirst} will pick up their ${money(p.amountCents)} refund ${when}.`, p.id);
  return { ok: true as const, status: 'scheduled', code };
}

/** What the client's page shows. */
export async function publicView(db: any, tenantId: string, id: string, k: string) {
  if (!k || k !== payoutKey(tenantId, id)) return { ok: false as const, error: 'We are sorry, but this link is not valid.' };
  const [ts, ps] = await Promise.all([db.doc(T(tenantId)).get(), db.doc(`${T(tenantId)}/refundPayouts/${id}`).get()]);
  if (!ts.exists || !ps.exists) return { ok: false as const, error: 'We are sorry, but we could not find this refund.' };
  const tenant: any = ts.data(); const p: any = ps.data(); const C = settingsOf(tenant).cashRefund;
  const needsWindows = ['choose', 'pickup_time'].includes(p.status) || (p.status === 'scheduled' && !p.prep?.tillAt);
  return { ok: true as const, brand: { name: tenant.name || tenant.businessName || '', accent: brandAccent(tenant), logo: brandLogo(tenant), address: tenant.studioAddress || null },
    refund: { amountCents: p.amountCents, first: p.clientFirst, status: p.status, method: p.method, code: p.status === 'scheduled' || p.status === 'on_way' ? await codeOf(db, tenantId, id) : null,
      pickup: p.pickup ? { ...p.pickup, label: windowLabel(p.pickup) } : null, app: p.app ? { handle: p.app.handle, accountName: p.app.accountName, label: isApp(p.method) ? PAY_APPS[p.method as PayApp].label : '' } : null,
      from: isApp(p.method) ? C.apps[p.method as PayApp].from : null, trip: p.trip ? { etaMin: p.trip.etaMin ?? null, distanceMi: p.trip.distanceMi ?? null, live: !!p.trip.live } : null, cashReady: !!p.prep?.sealedAt },
    methods: methodsFor(tenant, p).map((m) => ({ id: m, label: METHOD_LABEL[m], ask: isApp(m) ? PAY_APPS[m].ask : null, placeholder: isApp(m) ? PAY_APPS[m].placeholder : null, from: isApp(m) ? C.apps[m].from : null })),
    windows: needsWindows ? await pickupWindows(db, tenantId, tenant) : [], onTheWay: C.onTheWay, liveLocation: C.liveLocation && !!tenant.studioLocation };
}

/** What the client can do from their page. */
export async function clientAct(db: any, tenantId: string, id: string, k: string, b: any) {
  if (!k || k !== payoutKey(tenantId, id)) return { ok: false as const, error: 'We are sorry, but this link is not valid.' };
  const ref = db.doc(`${T(tenantId)}/refundPayouts/${id}`); const [ts, ps] = await Promise.all([db.doc(T(tenantId)).get(), ref.get()]);
  if (!ps.exists) return { ok: false as const, error: 'We are sorry, but we could not find this refund.' };
  const tenant: any = ts.data() || {}; const p: any = { id, ...ps.data() }; const C = settingsOf(tenant).cashRefund; const who = p.clientFirst || 'Client';
  if (['handed', 'sent', 'credited', 'cancelled'].includes(p.status)) return { ok: false as const, error: 'This refund has already been completed.' };
  switch (String(b.action)) {
    case 'choose': {
      if (p.prep?.tillAt) return { ok: false as const, error: 'Your refund is already being prepared. To make a change, please reply to our text message.' };
      return applyChoice(db, tenantId, tenant, p, { method: b.method, handle: b.handle, accountName: b.accountName, pickup: b.pickup }, who, true);
    }
    case 'book': {
      if (p.method !== 'pickup') return { ok: false as const, error: 'Please choose cash pickup first.' };
      if (p.prep?.tillAt) return { ok: false as const, error: 'Your refund is already being prepared. To change the time, please reply to our text message.' };
      return bookPickup(db, tenantId, tenant, p, b.pickup || {}, who, true);
    }
    case 'change': {
      if (p.prep?.tillAt) return { ok: false as const, error: 'Your refund is already being prepared. To make a change, please reply to our text message.' };
      await ref.set({ status: 'choose', method: null, pickup: null, trip: null, updatedAt: now(), timeline: FieldValue.arrayUnion(line(who, 'Wants to change how they get it')) }, { merge: true }); return { ok: true as const };
    }
    case 'on_way': {
      if (!C.onTheWay || !['scheduled', 'on_way'].includes(p.status)) return { ok: false as const, error: 'Not available.' };
      const eta = Math.min(120, Math.max(1, Math.round(Number(b.etaMin) || 15))); const live = C.liveLocation && b.live === true;
      await ref.set({ status: 'on_way', trip: { at: now(), etaMin: eta, live, distanceMi: null, updatedAt: now(), nearAt: null, until: new Date(Date.now() + 60 * 60000).toISOString() }, updatedAt: now(), timeline: FieldValue.arrayUnion(line(who, `On the way — about ${eta} min${live ? ' (sharing distance)' : ''}`)) }, { merge: true });
      await tellDesk(db, tenantId, tenant, 'refund_on_way', `${who} is on the way to collect their ${money(p.amountCents)} refund and will arrive in about ${eta} minutes.${p.prep?.sealedAt ? ' The envelope is ready.' : ' Action needed: The envelope is not ready yet.'}`, id, true);
      return { ok: true as const };
    }
    case 'trip': {
      if (p.status !== 'on_way' || !p.trip?.live) return { ok: true as const, sharing: false };
      if (p.trip.until && Date.now() > Date.parse(p.trip.until)) { await ref.set({ trip: { ...p.trip, live: false } }, { merge: true }); return { ok: true as const, sharing: false }; }
      if (p.trip.updatedAt && Date.now() - Date.parse(p.trip.updatedAt) < 15000) return { ok: true as const, sharing: true, throttled: true, etaMin: p.trip.etaMin, distanceMi: p.trip.distanceMi };
      const lat = Number(b.lat), lng = Number(b.lng); const home = tenant.studioLocation;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !home) return { ok: false as const, error: 'We are unable to access your location at the moment.' };
      // Only how far and how long are kept — never where they are.
      const R = 3958.8, toR = (d: number) => d * Math.PI / 180, dLat = toR(lat - home.lat), dLng = toR(lng - home.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(home.lat)) * Math.cos(toR(lat)) * Math.sin(dLng / 2) ** 2;
      const mi = Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10; const eta = mi < 0.1 ? 0 : Math.max(1, Math.round(mi * 1.3 / 0.42));   // road ≈ 1.3× straight, ~25 mph in town
      const near = eta <= 2 && !p.trip.nearAt; const here = mi < 0.1;
      await ref.set({ trip: { ...p.trip, distanceMi: mi, etaMin: eta, updatedAt: now(), ...(near ? { nearAt: now() } : {}), ...(here ? { live: false, arrivedAt: now() } : {}) }, updatedAt: now() }, { merge: true });
      if (near) await tellDesk(db, tenantId, tenant, 'refund_near', here ? `${who} has arrived to collect their refund.` : `${who} is about 2 minutes away to collect their refund.`, id, true);
      return { ok: true as const, sharing: !here, etaMin: eta, distanceMi: mi };
    }
    case 'stop_trip': await ref.set({ trip: { ...(p.trip || {}), live: false } }, { merge: true }); return { ok: true as const };
  }
  return { ok: false as const, error: 'Unknown request.' };
}

/** What the desk and managers do. */
export async function staffAct(db: any, tenantId: string, actor: any, b: any) {
  const T0 = T(tenantId); const tenant: any = (await db.doc(T0).get()).data() || {}; const C = settingsOf(tenant).cashRefund;
  if (b.action === 'create') return createPayout(db, tenantId, tenant, actor, b);
  if (b.action === 'sale_kind') {   // how the visit behind a case was paid — decides card refund vs. cash refund options
    const cs = await db.doc(`${T0}/cases/${String(b.caseId || '')}`).get(); const c: any = cs.data() || {};
    const { saleForVisit } = await import('@/lib/money-refund'); const sale: any = await saleForVisit(db, tenantId, String(c.visit?.appointmentId || c.appointmentId || ''));
    const m = String(sale?.paymentMethod || '').toLowerCase();
    return { ok: true as const, kind: !sale ? 'none' : m === 'cash' ? 'cash' : 'card', method: sale?.paymentMethod || null, methods: methodsFor(tenant).map((x) => ({ id: x, label: METHOD_LABEL[x], ask: isApp(x) ? PAY_APPS[x].ask : null, placeholder: isApp(x) ? PAY_APPS[x].placeholder : null })) };
  }
  if (b.action === 'windows') return { ok: true as const, windows: await pickupWindows(db, tenantId, tenant), methods: methodsFor(tenant).map((m) => ({ id: m, label: METHOD_LABEL[m], ask: isApp(m) ? PAY_APPS[m].ask : null, placeholder: isApp(m) ? PAY_APPS[m].placeholder : null })) };
  const ref = db.doc(`${T0}/refundPayouts/${String(b.id || '')}`); const s = await ref.get(); if (!s.exists) return { ok: false as const, error: 'Refund not found.' };
  const p: any = { id: s.id, ...s.data() }; const by = actor.name || 'Staff'; const push = (patch: any, msg: string) => ref.set({ ...patch, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, msg)) }, { merge: true });
  const done = ['handed', 'sent', 'credited', 'cancelled'].includes(p.status);
  switch (String(b.action)) {
    case 'choose': if (done) return { ok: false as const, error: 'Already finished.' }; if (p.prep?.tillAt) return { ok: false as const, error: 'Put the cash back in the till first.' };
      return applyChoice(db, tenantId, tenant, p, { method: b.method, handle: b.handle, accountName: b.accountName, pickup: b.pickup }, by, false);
    case 'note': await ref.set({ noteText: String(b.text || '').slice(0, 1200), updatedAt: now() }, { merge: true }); return { ok: true as const };
    case 'printed': await push({ prep: { ...(p.prep || {}), printedAt: now() } }, 'Printed the envelope slip and note'); return { ok: true as const };
    case 'resend': { const sent = await textClient(db, tenantId, tenant, p, p.status === 'scheduled' || p.status === 'on_way' ? `${hi(p)}this is a reminder that your ${money(p.amountCents)} refund is ready at the front desk ${windowLabel(p.pickup)}. Your pickup code is ${await codeOf(db, tenantId, p.id)}.` : `${hi(p)}here is the link for your ${money(p.amountCents)} refund:`);
      await push({}, sent ? 'Texted the client the link again' : 'Couldn’t text the client'); return { ok: true as const, sent, link: payoutPath(tenantId, p.id) }; }
    case 'till': {
      if (p.method !== 'pickup' || !['scheduled', 'on_way'].includes(p.status)) return { ok: false as const, error: 'Book a pickup time first.' };
      if (p.prep?.tillAt) return { ok: false as const, error: 'The cash is already out of the till.' };
      const tills = (await db.collection(`${T0}/tillSessions`).where('status', '==', 'open').get()).docs; const till = tills[0];
      if (!till && b.fromSafe !== true) return { ok: false as const, error: 'No till is open. Open the till, or take it from the safe.', code: 'no_till' };
      if (till) await till.ref.set({ expectedCash: FieldValue.increment(-p.amountCents / 100), totalCashRefunds: FieldValue.increment(p.amountCents / 100), refundPayouts: FieldValue.arrayUnion({ id: p.id, amount: p.amountCents / 100, at: now(), by }) }, { merge: true });
      await push({ prep: { ...(p.prep || {}), tillAt: now(), tillSessionId: till ? till.id : null, fromSafe: !till, preparedBy: by, preparedById: actor.staffId || null } }, till ? `Took ${money(p.amountCents)} from the till` : `Took ${money(p.amountCents)} from the safe`);
      return { ok: true as const };
    }
    case 'counted': {
      if (!p.prep?.tillAt) return { ok: false as const, error: 'Take the cash out first.' };
      const counter = String(b.countedBy || by).trim();
      if (C.twoPerson && counter && p.prep?.preparedBy && counter.toLowerCase() === String(p.prep.preparedBy).toLowerCase()) return { ok: false as const, error: 'A second person counts it — not the one who prepared it.' };
      await push({ prep: { ...p.prep, countedBy: counter, countedAt: now(), sealedAt: now() } }, `Counted by ${counter} and sealed`); return { ok: true as const };
    }
    case 'return_till': {
      if (!p.prep?.tillAt || done) return { ok: false as const, error: 'There’s no cash out for this refund.' };
      if (p.prep.tillSessionId) await db.doc(`${T0}/tillSessions/${p.prep.tillSessionId}`).set({ expectedCash: FieldValue.increment(p.amountCents / 100), totalCashRefunds: FieldValue.increment(-p.amountCents / 100) }, { merge: true });
      await push({ prep: { ...p.prep, tillAt: null, countedBy: null, countedAt: null, sealedAt: null, returnedAt: now() } }, `Put ${money(p.amountCents)} back ${p.prep.tillSessionId ? 'in the till' : 'in the safe'}`); return { ok: true as const };
    }
    case 'missed': return missedPickup(db, tenantId, tenant, p, by);
    case 'returned_later': {   // cash that came out of a drawer that had already closed, now back in today's
      if (!p.needsReturn || p.returnedLaterAt) return { ok: false as const, error: 'Nothing to put back.' };
      const till = (await db.collection(`${T0}/tillSessions`).where('status', '==', 'open').get()).docs[0];
      if (till) await till.ref.set({ expectedCash: FieldValue.increment(p.amountCents / 100), cashAdjustments: FieldValue.arrayUnion({ amount: p.amountCents / 100, reason: `Refund envelope returned (${p.clientName})`, at: now(), by }) }, { merge: true });
      await push({ needsReturn: false, returnedLaterAt: now() }, `Put ${money(p.amountCents)} back ${till ? 'in today’s till' : 'in the safe'}`); return { ok: true as const };
    }
    case 'handover': {
      if (p.method !== 'pickup' || !['scheduled', 'on_way'].includes(p.status)) return { ok: false as const, error: 'This refund isn’t a pickup that’s ready.' };
      if (!p.prep?.tillAt) return { ok: false as const, error: 'Take the cash out and count it first.' };
      if (C.twoPerson && !p.prep?.countedBy) return { ok: false as const, error: 'A second person counts it before it’s handed over.' };
      if ((Number(p.codeTries) || 0) >= 5 && !actor.isManager && !actor.isOwner) return { ok: false as const, error: 'Too many wrong codes — a manager needs to hand this one over.' };
      const code = await codeOf(db, tenantId, p.id);
      if (!code || String(b.code || '').trim() !== code) { await ref.set({ codeTries: FieldValue.increment(1), timeline: FieldValue.arrayUnion(line(by, 'Wrong pickup code entered')) }, { merge: true }); return { ok: false as const, error: 'That code doesn’t match. Ask them to check their text.' }; }
      let signatureUrl: string | null = null;
      if (typeof b.signature === 'string' && b.signature.startsWith('data:image/')) { const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload'); const u = await uploadClaimPhotoFromDataUrl(tenantId, `refund-${p.id}`, b.signature, 'cases'); signatureUrl = u.url; }
      if (!signatureUrl) return { ok: false as const, error: 'Ask them to sign first.' };
      await push({ status: 'handed', handedAt: now(), handedBy: by, signatureUrl, trip: p.trip ? { ...p.trip, live: false } : null }, `Handed ${money(p.amountCents)} to ${p.clientFirst} — code matched, signed`);
      await settle(db, tenantId, tenant, p, 'Cash', by);
      await textClient(db, tenantId, tenant, p, `${hi(p)}thank you for coming in. This confirms that your ${money(p.amountCents)} refund was given to you today.`, false);
      return { ok: true as const };
    }
    case 'sent': {
      if (!isApp(p.method) || p.status !== 'to_send') return { ok: false as const, error: 'Nothing to send.' };
      if (C.sendRole === 'manager' && !actor.isManager && !actor.isOwner) return { ok: false as const, error: 'A manager sends app refunds.' };
      let proofUrl: string | null = null;
      if (typeof b.proof === 'string' && b.proof.startsWith('data:image/')) { const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload'); const u = await uploadClaimPhotoFromDataUrl(tenantId, `refund-${p.id}`, b.proof, 'cases'); proofUrl = u.url; }
      const refNo = String(b.ref || '').trim().slice(0, 60) || null; const label = PAY_APPS[p.method as PayApp].label;
      await push({ status: 'sent', app: { ...(p.app || {}), sentAt: now(), sentBy: by, ref: refNo, proofUrl } }, `Sent ${money(p.amountCents)} by ${label}${refNo ? ` (ref ${refNo})` : ''}`);
      await settle(db, tenantId, tenant, { ...p, app: { ...(p.app || {}), ref: refNo } }, label, by);
      await textClient(db, tenantId, tenant, p, `${hi(p)}we have sent your ${money(p.amountCents)} refund by ${label} to ${p.app?.handle}. Thank you for your patience.`, false);
      return { ok: true as const };
    }
    case 'cancel': {
      if (done) return { ok: false as const, error: 'Already finished.' }; if (p.prep?.tillAt) return { ok: false as const, error: 'Put the cash back in the till first.' };
      await push({ status: 'cancelled', cancelledAt: now() }, `Cancelled${b.reason ? `: ${String(b.reason).slice(0, 200)}` : ''}`);
      if (p.saleId) await db.doc(`${T0}/transactions/${p.saleId}`).set({ refundPendingId: null }, { merge: true });
      if (p.caseId) await db.doc(`${T0}/cases/${p.caseId}`).set({ payoutId: null, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, 'Cash refund set-up cancelled')) }, { merge: true });
      return { ok: true as const };
    }
  }
  return { ok: false as const, error: 'Unknown request.' };
}

/** A pickup window passed with no pickup: cash back in the till, ask for a new time; past the limit, pickup is no longer offered. */
export async function missedPickup(db: any, tenantId: string, tenant: any, p: any, by: string) {
  const T0 = T(tenantId); const ref = db.doc(`${T0}/refundPayouts/${p.id}`); const C = settingsOf(tenant).cashRefund; const missed = (Number(p.missed) || 0) + 1;
  if (p.prep?.tillAt && p.prep.tillSessionId) {
    const till: any = (await db.doc(`${T0}/tillSessions/${p.prep.tillSessionId}`).get()).data() || {};
    if (till.status === 'open') await db.doc(`${T0}/tillSessions/${p.prep.tillSessionId}`).set({ expectedCash: FieldValue.increment(p.amountCents / 100), totalCashRefunds: FieldValue.increment(-p.amountCents / 100) }, { merge: true });
    else await ref.set({ needsReturn: true }, { merge: true });   // the drawer was already closed — the desk puts it back next shift
  }
  const blocked = missed >= C.missedLimit;
  await ref.set({ missed, status: blocked ? 'choose' : 'pickup_time', method: blocked ? null : 'pickup', pickupBlocked: blocked || !!p.pickupBlocked, pickup: null, trip: null,
    prep: p.prep ? { ...p.prep, tillAt: null, countedBy: null, countedAt: null, sealedAt: null, returnedAt: p.prep.tillAt ? now() : (p.prep.returnedAt || null) } : null,
    updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Missed pickup (${missed})${p.prep?.tillAt ? ' — cash back in the till' : ''}${blocked ? ' — pickup no longer offered' : ''}`)) }, { merge: true });
  await textClient(db, tenantId, tenant, { ...p, id: p.id }, blocked ? `${hi(p)}we were not able to see you for your ${money(p.amountCents)} refund pickup. Please choose another way to receive it here:` : `${hi(p)}we were not able to see you for your ${money(p.amountCents)} refund pickup. Please choose a new time here:`);
  return { ok: true as const, missed, blocked };
}

/** Run by the every-few-minutes job: pickups whose window ended at least an hour ago with no handover. */
export async function missedPickupSweep(db: any, tenantId: string, tenant: any) {
  const qs = await db.collection(`${T(tenantId)}/refundPayouts`).where('status', 'in', ['scheduled', 'on_way']).get(); let n = 0;
  for (const d of qs.docs) { const p: any = { id: d.id, ...d.data() }; const end = p.pickup?.endAt ? Date.parse(p.pickup.endAt) : 0;
    if (end && Date.now() > end + 60 * 60000) { await missedPickup(db, tenantId, tenant, p, 'System'); n++; } }
  return n;
}

