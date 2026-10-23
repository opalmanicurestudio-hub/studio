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

/** Loyalty: a refund takes back the points that money earned (lib/loyalty-server; named after this refund, so once). */
async function pointsBack(db: any, tenantId: string, sale: any, cents: number, payoutId: string, by: string) {
  if (sale?.checkoutSessionId) { try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: String(sale.checkoutSessionId), refundCents: cents, refundId: `p${payoutId}`, by }); } catch { /* best effort */ } }
}

const DONE = ['handed', 'sent', 'credited', 'cancelled'];
const idPart = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);

/** One step on a refund (handed over, sent, cancelled, cash out of the till…), in one transaction that reads the refund
 *  as it is now: `run` gets it (and the transaction, for anything else it reads first and then writes) and returns why
 *  the step can't happen, or nothing. Two taps, or the desk and the client at the same moment, do it once. */
async function onePayoutStep(db: any, ref: any, run: (cur: any, tx: any) => Promise<string | null | void> | string | null | void): Promise<{ ok: true; cur: any } | { ok: false; error: string }> {
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const cur: any = s.exists ? { ...(s.data() || {}), id: s.id } : null;
    if (!cur) return { ok: false as const, error: 'Refund not found.' };
    const why = await run(cur, tx); if (why) return { ok: false as const, error: why };
    return { ok: true as const, cur };
  });
}

/** Write the refund to the books (when the money actually left: cash handed over, or sent by an app) and close the
 *  refund on the case — once. The books line is named after this refund and written in one step that first checks it
 *  isn't there yet, together with the sale and the case. A refund taken as store credit is recorded by creditRefund. */
async function settle(db: any, tenantId: string, tenant: any, p: any, via: string, by: string) {
  const T0 = T(tenantId); const cents = Math.round(p.amountCents);
  const lineRef = db.doc(`${T0}/transactions/payout_refund_${idPart(p.id)}`);
  const saleRef = p.saleId ? db.doc(`${T0}/transactions/${p.saleId}`) : null;
  const caseRef = p.caseId ? db.doc(`${T0}/cases/${p.caseId}`) : null;
  const r: any = await db.runTransaction(async (tx: any) => {
    const ls = await tx.get(lineRef); const ss = saleRef ? await tx.get(saleRef) : null; const ks = caseRef ? await tx.get(caseRef) : null;
    const sale: any = ss?.exists ? { id: ss.id, ...(ss.data() || {}) } : null;
    if (ls.exists) return { sale, already: true };
    const at = now();
    tx.set(lineRef, { id: lineRef.id, date: at, description: `Refund for: ${sale?.description || p.serviceName || 'visit'}`, clientOrVendor: p.clientName || null, clientId: p.clientId || null, type: 'reversal', context: sale?.context || null, category: 'Refunds', amount: cents / 100, paymentMethod: via, reversalOf: sale?.id || null, appointmentId: p.appointmentId || null, hasReceipt: false, notes: `${p.number ? `Making it right ${p.number} · ` : ''}${via}${p.app?.ref ? ` · ref ${p.app.ref}` : ''}`, payoutId: p.id, caseId: p.caseId || null, by, ...(p.ledger || {}) });
    if (sale && !sale.refundedAt) tx.set(saleRef, { refundedAt: at, refundTransactionId: lineRef.id, refundPendingId: null }, { merge: true });
    if (ks?.exists) tx.set(caseRef, { fix: { refundedAt: at, refundedCents: cents, refundVia: via, todo: null }, updatedAt: at, timeline: FieldValue.arrayUnion(line(by, `Refund of ${money(cents)} given — ${via}`)) }, { merge: true });
    return { sale };
  });
  if (!r.already) await pointsBack(db, tenantId, r.sale, cents, p.id, by);
}

/** The refund as store credit, once. In one step: the refund is read as it is now (not already given another way, its
 *  cash not taken out of the till), the credit goes on the client's account named after this refund, and the refund,
 *  its sale and its case are marked done. A second tap, or the client and the desk choosing at the same moment, find
 *  it credited and add nothing. Earned credit: money they already paid, now usable on anything — no new expense line
 *  (the sale stays; the credit is spent later). */
async function creditRefund(db: any, tenantId: string, id: string, by: string): Promise<{ ok: false; error: string } | { ok: true; already?: boolean; p: any; sale: any }> {
  const T0 = T(tenantId); const ref = db.doc(`${T0}/refundPayouts/${id}`);
  return db.runTransaction(async (tx: any) => {
    const ps = await tx.get(ref);
    const p: any = ps.exists ? { ...(ps.data() || {}), id } : null;
    if (!p) return { ok: false as const, error: 'Refund not found.' };
    const cRef = p.clientId ? db.doc(`${T0}/clients/${p.clientId}`) : null;
    const saleRef = p.saleId ? db.doc(`${T0}/transactions/${p.saleId}`) : null;
    const caseRef = p.caseId ? db.doc(`${T0}/cases/${p.caseId}`) : null;
    const cs = cRef ? await tx.get(cRef) : null; const ss = saleRef ? await tx.get(saleRef) : null; const ks = caseRef ? await tx.get(caseRef) : null;
    if (p.status === 'credited') return { ok: true as const, already: true, p, sale: null };
    if (['handed', 'sent', 'cancelled'].includes(p.status)) return { ok: false as const, error: 'This refund has already been completed.' };
    if (p.prep?.tillAt) return { ok: false as const, error: 'The cash for this refund is already out of the till.' };
    if (!p.clientId) return { ok: false as const, error: 'This refund isn’t linked to a client account, so credit can’t be added.' };
    if (!cs?.exists) return { ok: false as const, error: 'Client not found.' };
    const cents = Math.round(p.amountCents); const at = now(); const creditId = `refund_${id}`;
    const has = (Array.isArray((cs.data() || {}).storeCredits) ? cs.data().storeCredits : []).some((x: any) => x?.id === creditId);
    if (!has) tx.update(cRef, { storeCredits: FieldValue.arrayUnion({ id: creditId, tenantId, clientId: p.clientId, appointmentId: p.appointmentId || null, amountCents: cents, amount: cents / 100, type: 'earned', source: 'refund_to_credit', reason: `Refund${p.number ? ` — ${p.number}` : ''}`, createdBy: by, expiresAt: null, createdAt: at, usedAt: null, usedOnAppointmentId: null, status: 'available', payoutId: id }), totalStoreCredit: FieldValue.increment(cents / 100) });
    tx.set(ref, { method: 'credit', status: 'credited', creditedAt: at, creditId, updatedAt: at, timeline: FieldValue.arrayUnion(line(by, `${money(cents)} added as store credit`)) }, { merge: true });
    if (ss?.exists) tx.set(saleRef, { refundPendingId: null, refundedAsCreditAt: at }, { merge: true });
    if (ks?.exists) tx.set(caseRef, { fix: { refundedAt: at, refundedCents: cents, refundVia: 'Store credit', todo: null }, updatedAt: at, timeline: FieldValue.arrayUnion(line(by, `Refund of ${money(cents)} given — Store credit`)) }, { merge: true });
    return { ok: true as const, p, sale: ss?.exists ? { id: ss.id, ...(ss.data() || {}) } : null };
  });
}

/** Any other choice of how the refund is given, written in one step only while the refund is still open — so a choice
 *  made at the same moment as store credit can't reopen a refund that was just credited (and then be paid out too). */
async function setChoice(db: any, ref: any, patch: any) {
  return onePayoutStep(db, ref, (cur, tx) => { if (DONE.includes(cur.status)) return 'This refund has already been completed.'; tx.set(ref, patch, { merge: true }); });
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
  const m = p.mode === 'client' ? null : (String(b.method || '') as Method);
  if (m !== null && !allowed.includes(m)) return { ok: false as const, error: 'Choose how they’ll get it back.' };
  if (m) { p.method = m; p.noteText = noteDraft(p, tenant); }
  // Made in one step that takes the case and the sale for this refund (they point at it), after checking neither is
  // taken by a refund still open or already given: two set-ups at the same moment make one refund, and the other is
  // told one is set up. A cancelled refund lets go of both.
  const made: any = await db.runTransaction(async (tx: any) => {
    const caseRef = c ? db.doc(`${T0}/cases/${c.id}`) : null; const saleRef = sale ? db.doc(`${T0}/transactions/${sale.id}`) : null;
    const ks = caseRef ? await tx.get(caseRef) : null; const ss = saleRef ? await tx.get(saleRef) : null;
    const k: any = ks?.exists ? ks.data() || {} : {}; const s: any = ss?.exists ? ss.data() || {} : {};
    const kp = k.payoutId ? await tx.get(db.doc(`${T0}/refundPayouts/${idPart(k.payoutId)}`)) : null;
    const sp = s.refundPendingId ? await tx.get(db.doc(`${T0}/refundPayouts/${idPart(s.refundPendingId)}`)) : null;
    const open = (x: any) => !!x?.exists && (x.data() || {}).status !== 'cancelled';
    if (k.fix?.refundedAt) return { ok: false as const, error: 'This refund was already given.' };
    if (open(kp)) return { ok: false as const, error: 'A refund is already set up for this case — see Refunds.' };
    if (s.refundedAt || s.voided || s.refundedAsCreditAt) return { ok: false as const, error: 'This sale was already refunded.' };
    if (open(sp)) return { ok: false as const, error: 'A refund is already set up for this sale — see Refunds to give.' };
    tx.set(ref, p);
    if (ss?.exists) tx.set(saleRef, { refundPendingId: ref.id }, { merge: true });
    if (ks?.exists) tx.set(caseRef, { payoutId: ref.id, updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, m ? `Cash refund: ${METHOD_LABEL[m]} (${money(amount)})` : `Cash refund: client chooses how (${money(amount)})`)) }, { merge: true });
    return { ok: true as const };
  });
  if (!made.ok) return made;
  if (!m) {
    const sent = await textClient(db, tenantId, tenant, p, `${hi(p)}we are refunding ${money(amount)} to you. Please choose how you would like to receive your refund here:`);
    await ref.set({ timeline: FieldValue.arrayUnion(line(actor.name, sent ? 'Texted the client to choose how' : 'Couldn’t text the client — share the link')) }, { merge: true });
    return { ok: true as const, id: ref.id, sent, link: payoutPath(tenantId, ref.id) };
  }
  const r = await applyChoice(db, tenantId, tenant, { ...p }, { method: m, pickup: b.pickup, handle: b.handle, accountName: b.accountName }, actor.name, false);
  return r.ok ? { ...r, id: ref.id, link: payoutPath(tenantId, ref.id) } : r;
}

/** Choosing (by staff or the client): pickup with or without a time, an app with their details, or credit. */
async function applyChoice(db: any, tenantId: string, tenant: any, p: any, b: any, by: string, byClient: boolean) {
  const ref = db.doc(`${T(tenantId)}/refundPayouts/${p.id}`); const m = String(b.method || '') as Method;
  if (!methodsFor(tenant, p).includes(m)) return { ok: false as const, error: 'That way isn’t available.' };
  if (m === 'credit') {
    const r = await creditRefund(db, tenantId, p.id, by); if (!r.ok) return r;
    if (r.already) return { ok: true as const, status: 'credited', already: true };
    // Only the step that added the credit goes on to tell people.
    const q = r.p; await pointsBack(db, tenantId, r.sale, Math.round(q.amountCents), q.id, by);
    await textClient(db, tenantId, tenant, q, `${hi(q)}${money(q.amountCents)} has been added as credit to your account for your next visit.`, false);
    if (byClient) await tellDesk(db, tenantId, tenant, 'refund_choice', `${q.clientFirst} has chosen to receive their ${money(q.amountCents)} refund as store credit. No further action is needed.`, q.id);
    return { ok: true as const, status: 'credited' };
  }
  if (isApp(m)) {
    const handle = String(b.handle || '').trim().slice(0, 80); const accountName = String(b.accountName || '').trim().slice(0, 80);
    if (!handle) { const c = await setChoice(db, ref, { method: m, status: 'choose', updatedAt: now() }); if (!c.ok) return c; return { ok: true as const, status: 'needs_details' }; }
    const c = await setChoice(db, ref, { method: m, status: 'to_send', app: { handle, accountName: accountName || null, confirmedAt: byClient ? now() : null }, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `${PAY_APPS[m].label}: ${handle}${accountName ? ` (${accountName})` : ''}${byClient ? ' — confirmed by the client' : ''}`)) });
    if (!c.ok) return c;
    await tellDesk(db, tenantId, tenant, 'refund_choice', `Action needed: Please send ${p.clientFirst}’s ${money(p.amountCents)} refund by ${PAY_APPS[m].label}.`, p.id);
    if (!byClient) await textClient(db, tenantId, tenant, p, `${hi(p)}we will send your ${money(p.amountCents)} refund by ${PAY_APPS[m].label} to ${handle}. If these details are not correct, please let us know here:`);
    return { ok: true as const, status: 'to_send' };
  }
  // pickup
  const w = b.pickup; if (!w?.date || !w?.start) {
    const c = await setChoice(db, ref, { method: 'pickup', status: 'pickup_time', updatedAt: now() }); if (!c.ok) return c;
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
  const chosen = await setChoice(db, db.doc(`${T(tenantId)}/refundPayouts/${p.id}`), { method: 'pickup', status: 'scheduled', pickup: { date: hit.date, start: hit.start, end: hit.end, startAt, endAt }, trip: null, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Pickup booked: ${when}`)) });
  if (!chosen.ok) return chosen;
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
      const c = await setChoice(db, ref, { status: 'choose', method: null, pickup: null, trip: null, updatedAt: now(), timeline: FieldValue.arrayUnion(line(who, 'Wants to change how they get it')) }); if (!c.ok) return c; return { ok: true as const };
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
    // Only the field it changes (merged into the rest), so it can't put back cash details another step just changed.
    case 'printed': await push({ prep: { printedAt: now() } }, 'Printed the envelope slip and note'); return { ok: true as const };
    case 'resend': { const sent = await textClient(db, tenantId, tenant, p, p.status === 'scheduled' || p.status === 'on_way' ? `${hi(p)}this is a reminder that your ${money(p.amountCents)} refund is ready at the front desk ${windowLabel(p.pickup)}. Your pickup code is ${await codeOf(db, tenantId, p.id)}.` : `${hi(p)}here is the link for your ${money(p.amountCents)} refund:`);
      await push({}, sent ? 'Texted the client the link again' : 'Couldn’t text the client'); return { ok: true as const, sent, link: payoutPath(tenantId, p.id) }; }
    case 'till': {
      if (p.method !== 'pickup' || !['scheduled', 'on_way'].includes(p.status)) return { ok: false as const, error: 'Book a pickup time first.' };
      if (p.prep?.tillAt) return { ok: false as const, error: 'The cash is already out of the till.' };
      const tills = (await db.collection(`${T0}/tillSessions`).where('status', '==', 'open').get()).docs; const till = tills[0];
      if (!till && b.fromSafe !== true) return { ok: false as const, error: 'No till is open. Open the till, or take it from the safe.', code: 'no_till' };
      // Out of the till in one step that first checks it isn't out already: two taps take it out once.
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (cur.method !== 'pickup' || !['scheduled', 'on_way'].includes(cur.status)) return 'Book a pickup time first.';
        if (cur.prep?.tillAt) return 'The cash is already out of the till.';
        const amt = cur.amountCents / 100; const at = now();
        if (till) tx.set(till.ref, { expectedCash: FieldValue.increment(-amt), totalCashRefunds: FieldValue.increment(amt), refundPayouts: FieldValue.arrayUnion({ id: cur.id, amount: amt, at, by }) }, { merge: true });
        tx.set(ref, { prep: { ...(cur.prep || {}), tillAt: at, tillSessionId: till ? till.id : null, fromSafe: !till, preparedBy: by, preparedById: actor.staffId || null }, updatedAt: at,
          timeline: FieldValue.arrayUnion(line(by, till ? `Took ${money(cur.amountCents)} from the till` : `Took ${money(cur.amountCents)} from the safe`)) }, { merge: true });
      });
      return out.ok ? { ok: true as const } : out;
    }
    case 'counted': {
      if (!p.prep?.tillAt) return { ok: false as const, error: 'Take the cash out first.' };
      const counter = String(b.countedBy || by).trim();
      if (C.twoPerson && counter && p.prep?.preparedBy && counter.toLowerCase() === String(p.prep.preparedBy).toLowerCase()) return { ok: false as const, error: 'A second person counts it — not the one who prepared it.' };
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (!cur.prep?.tillAt) return 'Take the cash out first.';
        tx.set(ref, { prep: { countedBy: counter, countedAt: now(), sealedAt: now() }, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Counted by ${counter} and sealed`)) }, { merge: true });
      });
      return out.ok ? { ok: true as const } : out;
    }
    case 'return_till': {
      if (!p.prep?.tillAt || done) return { ok: false as const, error: 'There’s no cash out for this refund.' };
      // Back in the till in one step that first checks it's still out: two taps put it back once.
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (!cur.prep?.tillAt || DONE.includes(cur.status)) return 'There’s no cash out for this refund.';
        if (cur.prep.tillSessionId) tx.set(db.doc(`${T0}/tillSessions/${cur.prep.tillSessionId}`), { expectedCash: FieldValue.increment(cur.amountCents / 100), totalCashRefunds: FieldValue.increment(-cur.amountCents / 100) }, { merge: true });
        tx.set(ref, { prep: { ...cur.prep, tillAt: null, countedBy: null, countedAt: null, sealedAt: null, returnedAt: now() }, updatedAt: now(),
          timeline: FieldValue.arrayUnion(line(by, `Put ${money(cur.amountCents)} back ${cur.prep.tillSessionId ? 'in the till' : 'in the safe'}`)) }, { merge: true });
      });
      return out.ok ? { ok: true as const } : out;
    }
    case 'missed': return missedPickup(db, tenantId, tenant, p, by);
    case 'returned_later': {   // cash that came out of a drawer that had already closed, now back in today's
      if (!p.needsReturn || p.returnedLaterAt) return { ok: false as const, error: 'Nothing to put back.' };
      const till = (await db.collection(`${T0}/tillSessions`).where('status', '==', 'open').get()).docs[0];
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (!cur.needsReturn || cur.returnedLaterAt) return 'Nothing to put back.';
        if (till) tx.set(till.ref, { expectedCash: FieldValue.increment(cur.amountCents / 100), cashAdjustments: FieldValue.arrayUnion({ amount: cur.amountCents / 100, reason: `Refund envelope returned (${cur.clientName})`, at: now(), by }) }, { merge: true });
        tx.set(ref, { needsReturn: false, returnedLaterAt: now(), updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Put ${money(cur.amountCents)} back ${till ? 'in today’s till' : 'in the safe'}`)) }, { merge: true });
      });
      return out.ok ? { ok: true as const } : out;
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
      // Handed over in one step that first checks it still can be; then in the books once (named after this refund).
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (cur.status === 'handed') return 'This refund has already been handed over.';
        if (cur.method !== 'pickup' || !['scheduled', 'on_way'].includes(cur.status)) return 'This refund isn’t a pickup that’s ready.';
        if (!cur.prep?.tillAt) return 'Take the cash out and count it first.';
        if (C.twoPerson && !cur.prep?.countedBy) return 'A second person counts it before it’s handed over.';
        tx.set(ref, { status: 'handed', handedAt: now(), handedBy: by, signatureUrl, trip: cur.trip ? { ...cur.trip, live: false } : null, updatedAt: now(),
          timeline: FieldValue.arrayUnion(line(by, `Handed ${money(cur.amountCents)} to ${cur.clientFirst} — code matched, signed`)) }, { merge: true });
      });
      if (!out.ok) return out;
      await settle(db, tenantId, tenant, out.cur, 'Cash', by);
      await textClient(db, tenantId, tenant, out.cur, `${hi(out.cur)}thank you for coming in. This confirms that your ${money(out.cur.amountCents)} refund was given to you today.`, false);
      return { ok: true as const };
    }
    case 'sent': {
      if (!isApp(p.method) || p.status !== 'to_send') return { ok: false as const, error: 'Nothing to send.' };
      if (C.sendRole === 'manager' && !actor.isManager && !actor.isOwner) return { ok: false as const, error: 'A manager sends app refunds.' };
      let proofUrl: string | null = null;
      if (typeof b.proof === 'string' && b.proof.startsWith('data:image/')) { const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload'); const u = await uploadClaimPhotoFromDataUrl(tenantId, `refund-${p.id}`, b.proof, 'cases'); proofUrl = u.url; }
      const refNo = String(b.ref || '').trim().slice(0, 60) || null; const label = (x: any) => PAY_APPS[x.method as PayApp].label;
      // Marked sent in one step that first checks it's still waiting to be sent; then in the books once.
      const out = await onePayoutStep(db, ref, (cur, tx) => {
        if (cur.status === 'sent') return 'This refund has already been sent.';
        if (!isApp(cur.method) || cur.status !== 'to_send') return 'Nothing to send.';
        tx.set(ref, { status: 'sent', app: { ...(cur.app || {}), sentAt: now(), sentBy: by, ref: refNo, proofUrl }, updatedAt: now(),
          timeline: FieldValue.arrayUnion(line(by, `Sent ${money(cur.amountCents)} by ${label(cur)}${refNo ? ` (ref ${refNo})` : ''}`)) }, { merge: true });
      });
      if (!out.ok) return out;
      const q = out.cur;
      await settle(db, tenantId, tenant, { ...q, app: { ...(q.app || {}), ref: refNo } }, label(q), by);
      await textClient(db, tenantId, tenant, q, `${hi(q)}we have sent your ${money(q.amountCents)} refund by ${label(q)} to ${q.app?.handle}. Thank you for your patience.`, false);
      return { ok: true as const };
    }
    case 'cancel': {
      if (done) return { ok: false as const, error: 'Already finished.' }; if (p.prep?.tillAt) return { ok: false as const, error: 'Put the cash back in the till first.' };
      // Cancelled in one step that first checks it hasn't been given (a refund credited or handed over at the same
      // moment stays given), and lets go of the sale and the case only where they still point at this refund.
      const out = await onePayoutStep(db, ref, async (cur, tx) => {
        const saleRef = cur.saleId ? db.doc(`${T0}/transactions/${cur.saleId}`) : null; const caseRef = cur.caseId ? db.doc(`${T0}/cases/${cur.caseId}`) : null;
        const ss = saleRef ? await tx.get(saleRef) : null; const ks = caseRef ? await tx.get(caseRef) : null;
        if (DONE.includes(cur.status)) return 'Already finished.';
        if (cur.prep?.tillAt) return 'Put the cash back in the till first.';
        tx.set(ref, { status: 'cancelled', cancelledAt: now(), updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Cancelled${b.reason ? `: ${String(b.reason).slice(0, 200)}` : ''}`)) }, { merge: true });
        if (ss?.exists && (ss.data() || {}).refundPendingId === cur.id) tx.set(saleRef, { refundPendingId: null }, { merge: true });
        if (ks?.exists) tx.set(caseRef, { ...((ks.data() || {}).payoutId === cur.id ? { payoutId: null } : {}), updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, 'Cash refund set-up cancelled')) }, { merge: true });
      });
      return out.ok ? { ok: true as const } : out;
    }
  }
  return { ok: false as const, error: 'Unknown request.' };
}

/** A pickup window passed with no pickup: cash back in the till, ask for a new time; past the limit, pickup is no longer
 *  offered. In one step that reads the refund as it is now, so the desk and the every-few-minutes job at the same moment
 *  count it once (and put its cash back once), and a pickup moved to a new time meanwhile is left alone. */
export async function missedPickup(db: any, tenantId: string, tenant: any, p: any, by: string) {
  const T0 = T(tenantId); const ref = db.doc(`${T0}/refundPayouts/${p.id}`); const C = settingsOf(tenant).cashRefund;
  let missed = 0; let blocked = false;
  const out = await onePayoutStep(db, ref, async (cur, tx) => {
    const tillRef = cur.prep?.tillAt && cur.prep.tillSessionId ? db.doc(`${T0}/tillSessions/${cur.prep.tillSessionId}`) : null;
    const ts = tillRef ? await tx.get(tillRef) : null;
    if (cur.method !== 'pickup' || !['scheduled', 'on_way'].includes(cur.status)) return 'This pickup has already been dealt with.';
    if (p.pickup?.startAt && cur.pickup?.startAt !== p.pickup.startAt) return 'The pickup time has just changed. Check it again.';
    missed = (Number(cur.missed) || 0) + 1; blocked = missed >= C.missedLimit;
    // Cash out for it goes back in its till; if that drawer has already closed, the desk puts it back next shift.
    const back = !!tillRef && (ts?.data() || {}).status === 'open';
    if (back) tx.set(tillRef, { expectedCash: FieldValue.increment(cur.amountCents / 100), totalCashRefunds: FieldValue.increment(-cur.amountCents / 100) }, { merge: true });
    tx.set(ref, { missed, status: blocked ? 'choose' : 'pickup_time', method: blocked ? null : 'pickup', pickupBlocked: blocked || !!cur.pickupBlocked, pickup: null, trip: null,
      ...(tillRef && !back ? { needsReturn: true, returnedLaterAt: null } : {}),
      prep: cur.prep ? { ...cur.prep, tillAt: null, countedBy: null, countedAt: null, sealedAt: null, returnedAt: cur.prep.tillAt ? now() : (cur.prep.returnedAt || null) } : null,
      updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Missed pickup (${missed})${cur.prep?.tillAt ? ' — cash back in the till' : ''}${blocked ? ' — pickup no longer offered' : ''}`)) }, { merge: true });
  });
  if (!out.ok) return out;
  const q = out.cur;
  await textClient(db, tenantId, tenant, q, blocked ? `${hi(q)}we were not able to see you for your ${money(q.amountCents)} refund pickup. Please choose another way to receive it here:` : `${hi(q)}we were not able to see you for your ${money(q.amountCents)} refund pickup. Please choose a new time here:`);
  return { ok: true as const, missed, blocked };
}

/** Run by the every-few-minutes job: pickups whose window ended at least an hour ago with no handover. */
export async function missedPickupSweep(db: any, tenantId: string, tenant: any) {
  const qs = await db.collection(`${T(tenantId)}/refundPayouts`).where('status', 'in', ['scheduled', 'on_way']).get(); let n = 0;
  for (const d of qs.docs) { const p: any = { id: d.id, ...d.data() }; const end = p.pickup?.endAt ? Date.parse(p.pickup.endAt) : 0;
    if (end && Date.now() > end + 60 * 60000) { const r: any = await missedPickup(db, tenantId, tenant, p, 'System'); if (r.ok) n++; } }
  return n;
}

