// src/lib/kiosk.ts — THE KIOSK (server; api/kiosk, and the payments sweep in cron/retail-payments; design canvas
// "Self-order kiosk"): a tablet by the door with a card reader beside it, where guests order and pay themselves and get a
// number to watch for. The same menu as the counter, priced here from the menu itself (never the page): what's on at
// this time of day, happy hour, sold out as it happens, members-only items not shown, and the same offers once
// something's added. Tapping Pay sends it to the kitchen as a kiosk order ("K14") with its stock held, so nothing runs
// out while the guest pays, but its tickets wait as 'unpaid' and no kitchen screen, printer or board shows them
// (lib/counter-server sendOrder). Paid on the kiosk's own reader (lib/counter-card), the kitchen gets it at once
// (payOrder), and it waits at the counter to be handed over like a counter order. Not paid (Cancel, a card turned down
// and not tried again, a guest who walks away, or the next guest starting): it's voided and everything goes back on the
// shelf (voidOrder). Nothing is ever made for an order that isn't paid.
//   tenants/{t}/counterOrders/{id}.kiosk = { screen, state: 'awaiting_pay' | 'paid' | 'let_go' }
//   kitchenScreens/{hash}.readerId, .kioskOrder   (its reader, picked by a manager; the order it's being paid for now)
import { hereFor, zonedHere } from '@/lib/here-server';
import { dayKey } from '@/lib/business-locations';
import { cleanLineNote, cleanOrderAllergy } from '@/lib/order-allergy';
import { createHash } from 'crypto';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { lineFor, totalsOf, orderNumber, type OrderLine } from '@/lib/counter-orders';
import { readMenu, type MenuItem } from '@/lib/menu-server';
import { sendOrder, voidOrder, cleanName } from '@/lib/counter-server';
import { startCard, checkCard, stopCard } from '@/lib/counter-card';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { priceNow, servedNow } from '@/lib/menu-time';
import { offerOf } from '@/lib/menu-upgrades';
import { cleanPicks } from '@/lib/menu-choices';
import { extrasOf } from '@/lib/plate-extras';
import { beginPinAttempt, endPinAttempt, findStaffByPin, validPin } from '@/lib/pin';
import { posTaxOf } from '@/lib/pos-tax';
import { pageAccent } from '@/lib/studio-page';
import { askReadyText, readyTextsOn } from '@/lib/ready-text';
import type { Screen } from '@/lib/screen-keys';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_LINES = 30;
/** An order left waiting to be paid this long is let go by the sweep (the kiosk itself lets one go much sooner). */
export const KIOSK_UNPAID_MIN = 10;
const MANAGER_ROLES = ['owner', 'admin', 'manager'];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nowIso = () => new Date().toISOString();
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const money2 = (n: number) => Math.round(n * 100) / 100;

/** What a guest sees of one item at this moment: its price now (happy hour), sold out, and what's offered once it's
 *  added (only items on this same menu, `shown`). Nothing about cost or stock counts. */
function kioskItem(m: MenuItem, tenant: any, at: Date, shown: Set<string>) {
  const p = priceNow(m, tenant, at);
  return { id: m.id, name: m.name, section: m.section, words: m.words, price: p.price, happy: p.happy, from: m.from, startPrice: Math.max(0, money2(m.startPrice - m.price + p.price)),
    imageUrl: m.imageUrl, choices: m.choices, soldOut: m.soldOut || !m.inStock, calories: m.calories, featured: m.featured, badge: m.badge,
    upgrades: { size: m.upgrades?.size === true, items: (m.upgrades?.items || []).filter((id) => shown.has(id)) },
    // What it contains of the major allergens, when the business has said (null: nobody has, never "none").
    allergens: m.allergensSet ? m.allergens : null };
}

/** The kiosk's menu: everything on the menu for everyone that's served at this time of day, by section. The menu itself
 *  is read at most every 15 seconds per business, however many kiosks there are. */
const menuCache = new Map<string, { at: number; menu: MenuItem[] }>();
export async function kioskMenu(db: any, tenantId: string, tenant: any, screen: Screen, o: { stripe?: any; at?: Date } = {}) {
  const at = o.at || new Date();
  // (Its own location's: sold out there or everywhere, lib/menu-choices outWhere.)
  const here = await hereFor(db, tenantId, { screen });
  const key = `${tenantId}|${here || ''}`;
  const c = menuCache.get(key); let all: MenuItem[];
  if (c && Date.now() - c.at < 15000) all = c.menu;
  else { all = await readMenu(db, tenantId, here); menuCache.set(key, { at: Date.now(), menu: all }); if (menuCache.size > 500) menuCache.delete(menuCache.keys().next().value as string); }
  const menu = all.filter((m) => m.onMenu && !m.membersOnly && servedNow(m, tenant, at).ok);
  const shown = new Set(menu.map((m) => m.id));
  const sections: { name: string; items: ReturnType<typeof kioskItem>[] }[] = [];
  for (const m of menu) { let s = sections.find((x) => x.name === m.section); if (!s) sections.push((s = { name: m.section, items: [] })); s.items.push(kioskItem(m, tenant, at, shown)); }
  return { ok: true as const, business: String(tenant?.name || tenant?.businessName || '').slice(0, 80) || 'Order here', screen: screen.name,
    // The business's own color (readable with white type on it), carried through the kiosk as on its menu board.
    accent: pageAccent(tenant),
    // Paying needs the business's card payments and this kiosk's reader; until then the kiosk says so to the team.
    payments: !!accountOf(tenant) && !!(o.stripe || readerStripe()), reader: !!screen.readerId,
    // For here or to go, when what goes out with an order depends on it (lib/plate-extras), as the counter asks.
    askToGo: extrasOf(tenant).some((e: any) => e.per !== 'guest' && e.when !== 'any'),
    // The sales tax rate, so the total shows before paying (the server works it out again when the order is placed).
    taxPct: posTaxOf(tenant).productsPct, sections, now: at.toISOString(),
    // "Text me when it's ready" on the paid screen, where the business can text (lib/ready-text).
    texts: readyTextsOn(tenant) };
}

/** The order the guest tapped Pay on: priced from the menu, numbered ("K14") and sent to the kitchen as unpaid (its stock
 *  held). The same key and the same order again (a second tap, a lost answer) is the same order; one this kiosk left
 *  waiting to be paid (the guest before walked away) is let go first, so a kiosk only ever holds one. */
export async function kioskPlace(db: any, tenantId: string, tenant: any, screen: Screen, b: { key?: unknown; lines?: unknown; name?: unknown; toGo?: unknown; allergy?: unknown }, o: { stripe?: any; now?: number } = {}): Promise<any> {
  if (!accountOf(tenant) || !(o.stripe || readerStripe())) return fail('Paying by card isn’t set up here yet. Please order at the counter.', 409, 'no_payments');
  if (!screen.readerId) return fail('This kiosk’s card reader isn’t picked yet. Please order at the counter.', 409, 'no_reader');
  const key = String(b.key || ''); if (!KEY.test(key)) return fail('Something went wrong. Try again.', 400);
  const name = cleanName(b.name) || null; const toGo = b.toGo === true;
  const raw = Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES + 1) : [];
  if (!raw.length) return fail('Add something first.', 400, 'empty');
  if (raw.length > MAX_LINES) return fail(`Up to ${MAX_LINES} lines in one order.`, 400);
  const now = o.now ?? Date.now(); const at = new Date(now);
  const T = `tenants/${tenantId}`;
  const ids = Array.from(new Set(raw.map((l: any) => String(l?.itemId || '')).filter((x) => ID.test(x))));
  const snaps = await Promise.all(ids.map((id) => db.doc(`${T}/inventory/${id}`).get()));
  const item = new Map<string, any>(); snaps.forEach((s: any, k: number) => { const d = s.data(); if (d) item.set(ids[k], d); });
  // (At the kiosk's location, while it's still one of the business's, on its own clock when it keeps one: lib/here-server.)
  const here = await hereFor(db, tenantId, { screen });
  const menu = new Map((await readMenu(db, tenantId, here)).map((m) => [m.id, m]));
  const lines: OrderLine[] = []; const want = new Map<string, number>();
  for (const [k, l] of raw.entries()) {
    const id = String((l as any)?.itemId || ''); const m = menu.get(id); const it = item.get(id);
    if (!m || !it || !m.onMenu || m.membersOnly) return fail('Something in your order isn’t on the menu any more. Take it off and try again.', 409, 'gone');
    // Priced now (happy hour), and only what's served now (lib/menu-time), as at the counter.
    const r = lineFor(it, id, (l as any)?.quantity, (l as any)?.choices, `l${k + 1}`, { tenant, at, here });
    if (!r.ok) return fail(`${m.name}: ${r.error}`, 409, 'line');
    // (A note for the kitchen about this dish: lib/order-allergy.)
    const note = cleanLineNote((l as any)?.note); if (note) r.line.note = note;
    want.set(id, (want.get(id) || 0) + r.line.quantity);
    lines.push(r.line);
  }
  // Taken as an offer once something else was added (lib/menu-upgrades): kept on the line only when the menu offered it.
  raw.forEach((l: any, k: number) => {
    const kind = offerOf(l?.offer, menu.get(lines[k].itemId)!, cleanPicks(l?.choices), lines.filter((_, j) => j !== k).map((x) => menu.get(x.itemId)!));
    if (kind) lines[k].offer = kind;
  });
  for (const [id, q] of want) {
    const m = menu.get(id)!;
    if (m.soldOut || !m.inStock) return fail(`${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
    if (m.canMake !== null && m.canMake < q) return fail(m.canMake > 0 ? `Only ${m.canMake} ${m.name} left. Change your order and try again.` : `${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
  }
  const money = totalsOf(tenant, lines);
  if (Math.round(money.total * 100) < 50) return fail('Card payments start at $0.50. Add something, or order at the counter.', 400, 'too_small');
  // The same order only for the same key AND the same details: changed after going back, it's a new order.
  // The guest's allergies (lib/order-allergy): on every ticket.
  const allergy = cleanOrderAllergy(b.allergy);
  const what = JSON.stringify({ lines: lines.map((l) => [l.itemId, l.quantity, l.choicesText || '', l.unitPrice, l.note || '']), name, toGo, ...(allergy ? { allergy } : {}) });
  const orderRef = db.doc(`${T}/counterOrders/kiosk_${createHash('sha256').update(`${tenantId}/${screen.ref.id}/${key}/${what}`).digest('hex').slice(0, 32)}`);
  const orderId = orderRef.id;
  // (Asked again: as it stands. One made but not sent yet, its answer lost partway, is sent now.)
  const had: any = (await orderRef.get()).data();
  if (had && !(had.status === 'building' && had.kiosk?.state === 'awaiting_pay')) return placed(had, orderId);
  // One order at a time: the one this kiosk was being paid for, if it's still waiting, is let go first.
  // While its card is still being taken (or payments can't be reached), the new order waits: the reader can only do one.
  if (!had && screen.kioskOrder && screen.kioskOrder !== orderId) {
    const prev = await letGo(db, tenantId, tenant, screen.kioskOrder, screen.name, o);
    if (prev?.state === 'busy') return prev.code === 'processing' ? fail('The card reader is finishing another payment. Try again in a moment.', 409, 'processing') : fail(prev.error, prev.status, prev.code);
  }
  const day = todayIn(tenantTimeZone(await zonedHere(db, tenantId, tenant, here)), at);
  const made: any = had ? { number: had.number } : await db.runTransaction(async (tx: any) => {
    const again: any = (await tx.get(orderRef)).data(); if (again) return { had: again };
    // (At the kiosk's location, with more than one: stamped and numbered there. lib/here-server)
    const counterRef = db.doc(`${T}/orderCounters/${dayKey(day, here)}`);
    const c: any = (await tx.get(counterRef)).data() || {};
    const n = Math.floor(num(c.kiosk)) + 1; const number = orderNumber('kiosk', n);
    tx.set(counterRef, { kiosk: n, day }, { merge: true });
    tx.set(orderRef, { id: orderId, number, channel: 'kiosk', status: 'building', lines, ...money, guestName: name, toGo, createdAt: at.toISOString(), createdBy: screen.name, day, ...(here ? { locationId: here } : {}),
      ...(allergy ? { allergy: { ...allergy, by: 'The guest', at: at.toISOString() } } : {}),
      kiosk: { screen: screen.ref.id, state: 'awaiting_pay' } });
    return { number };
  });
  if (made.had && !(made.had.status === 'building' && made.had.kiosk?.state === 'awaiting_pay')) return placed(made.had, orderId);
  if (made.had) made.number = made.had.number;
  await screen.ref.set({ kioskOrder: orderId }, { merge: true });
  // To the kitchen, unpaid: stock held, tickets out of sight until it's paid.
  const sent: any = await sendOrder(db, tenantId, tenant, orderId, { id: null, name: screen.name }, { toGo, unpaid: true });
  if (!sent.ok) {
    await orderRef.set({ status: 'cancelled', cancelledAt: nowIso(), cancelReason: String(sent.error || '').slice(0, 200), kiosk: { state: 'let_go' } }, { merge: true });
    return sent.status === 409 ? fail('Something in your order just ran out. Change your order and try again.', 409, 'sold_out') : fail('That didn’t go through. Try again.', sent.status || 500);
  }
  return placed((await orderRef.get()).data() || {}, orderId);
}

/** The answer for an order placed already (asked again): as it stands. */
function placed(or: any, orderId: string) {
  if (or.paidAt) return { ok: true, orderId, number: or.number, paid: true };
  if (or.status !== 'sent' || or.kiosk?.state !== 'awaiting_pay') return fail('That order was let go. Please start again.', 409, 'closed');
  return { ok: true, orderId, number: or.number, subtotal: num(or.subtotal), tax: num(or.tax), taxLabel: or.taxLabel, total: num(or.total),
    lines: (Array.isArray(or.lines) ? or.lines : []).map((l: any) => ({ name: l.name, quantity: l.quantity, choicesText: l.choicesText || null, price: money2(num(l.unitPrice) * num(l.quantity)) })) };
}

/** This kiosk's own order (a kiosk never sees or pays another's), or null. */
async function ownOrder(db: any, tenantId: string, screen: Screen, orderId: unknown): Promise<any | null> {
  const id = String(orderId || ''); if (!ID.test(id)) return null;
  const or: any = (await db.doc(`tenants/${tenantId}/counterOrders/${id}`).get()).data();
  return or && or.channel === 'kiosk' && or.kiosk?.screen === screen.ref.id ? { ...or, id } : null;
}

/** To this kiosk's reader: the order's total (lib/counter-card startCard; asked again, the same payment). */
export async function kioskPay(db: any, tenantId: string, tenant: any, screen: Screen, orderId: unknown, o: { stripe?: any } = {}): Promise<any> {
  const or = await ownOrder(db, tenantId, screen, orderId); if (!or) return fail('That order isn’t this kiosk’s.', 404);
  if (or.paidAt) return { ok: true, state: 'paid', number: or.number };
  if (or.status !== 'sent' || or.kiosk?.state !== 'awaiting_pay') return fail('That order was let go. Please start again.', 409, 'closed');
  if (!screen.readerId) return fail('This kiosk’s card reader isn’t picked yet. Please order at the counter.', 409, 'no_reader');
  const r: any = await startCard(db, tenantId, tenant, or.id, screen.readerId, screen.name, o);
  return r.ok ? { ...r, number: or.number } : r;
}

/** How paying is going (lib/counter-card checkCard): approved → paid, and the kitchen has it. */
export async function kioskCheck(db: any, tenantId: string, tenant: any, screen: Screen, orderId: unknown, o: { stripe?: any } = {}): Promise<any> {
  const or = await ownOrder(db, tenantId, screen, orderId); if (!or) return fail('That order isn’t this kiosk’s.', 404);
  if (!or.paidAt && or.kiosk?.state === 'let_go') return { ok: true, state: 'let_go', number: or.number };
  const r: any = await checkCard(db, tenantId, tenant, or.id, screen.name, o);
  return r.ok ? { ...r, number: or.number } : r;
}

/** "Text me when it's ready", from the paid screen: this kiosk's own order, paid in the last half hour (lib/ready-text). */
export async function kioskTextMe(db: any, tenantId: string, tenant: any, screen: Screen, orderId: unknown, phone: unknown): Promise<any> {
  const or = await ownOrder(db, tenantId, screen, orderId); if (!or) return fail('That order isn’t this kiosk’s.', 404);
  if (!or.paidAt || Date.now() - (Date.parse(String(or.paidAt)) || 0) > 30 * 60000) return fail('That order is done here. Ask at the counter.', 409, 'closed');
  return askReadyText(db, tenantId, tenant, or.id, phone, 'kiosk');
}

/** "Get a receipt" for the order just paid here (design board "Receipts at the counter"): its private link, texted or
 *  emailed to what the guest types in (lib/receipt-actions-server). Only this kiosk's order, within half an hour of
 *  paying; the link itself is never shown on the kiosk. */
export async function kioskReceipt(db: any, tenantId: string, screen: Screen, orderId: unknown, channel: unknown, to: unknown, origin: string): Promise<any> {
  const or = await ownOrder(db, tenantId, screen, orderId); if (!or) return fail('That order isn’t this kiosk’s.', 404);
  if (!or.paidAt || Date.now() - (Date.parse(String(or.paidAt)) || 0) > 30 * 60000) return fail('That order is done here. Ask at the counter.', 409, 'closed');
  // (A few at most for one order: a guest who mistyped tries again; nobody sends a stranger a stream of them.)
  if ((Array.isArray(or.receiptSends) ? or.receiptSends : []).length >= 3) return fail('Your receipt was already sent. Ask at the counter if you need another.', 429, 'enough');
  const ch = channel === 'email' ? 'email' : 'sms'; const t = String(to ?? '').trim().slice(0, 120);
  if (ch === 'sms' && t.replace(/\D/g, '').length !== 10) return fail('Ten digits, please.', 400);
  if (ch === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return fail('That email doesn’t look right. Check it and try again.', 400);
  const { receiptAct } = await import('@/lib/receipt-actions-server');
  const x = await receiptAct(db, tenantId, `co_${or.id}`, 'send', { channel: ch, to: t }, { name: screen.name, guest: true }, origin);
  return x.body?.ok ? { ok: true } : fail(x.body?.error || 'It didn’t send. Try again.', x.status || 502);
}

/** The guest canceled (or walked away, or the next guest started): the reader stops asking and the order is let go. A
 *  card approved at that very moment is kept: it pays for the order, and the guest is told it's paid. */
export async function kioskCancel(db: any, tenantId: string, tenant: any, screen: Screen, orderId: unknown, o: { stripe?: any } = {}): Promise<any> {
  const or = await ownOrder(db, tenantId, screen, orderId); if (!or) return fail('That order isn’t this kiosk’s.', 404);
  const r = await letGo(db, tenantId, tenant, or.id, screen.name, o);
  if (r?.state === 'paid') return { ok: true, state: 'paid', number: or.number };
  if (r?.state === 'busy') return fail(r.error, r.status, r.code);
  return { ok: true, state: 'let_go' };
}

type LetGo = { state: 'paid' | 'let_go' } | { state: 'busy'; error: string; status: number; code: string } | null;
const STILL_PROCESSING = 'The card is still being processed. Check again in a moment.';

/** Let an unpaid kiosk order go: its card payment called off, then voided (what it held goes back on the shelf). */
/** Let an unpaid kiosk order go: its card payment called off, then voided (what it held goes back on the shelf). Busy:
 *  the card is still being processed, or payments couldn't be reached (asked again next time), with words to show. */
async function letGo(db: any, tenantId: string, tenant: any, orderId: string, by: string, o: { stripe?: any } = {}): Promise<LetGo> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const or: any = (await ref.get()).data(); if (!or || or.channel !== 'kiosk') return null;
  if (or.paidAt) return { state: 'paid' };
  const done = async () => { await ref.set({ kiosk: { state: 'let_go', letGoAt: nowIso() } }, { merge: true }); return { state: 'let_go' as const }; };
  const busy = (error: string, status: number, code: string) => ({ state: 'busy' as const, error, status, code });
  if (or.status === 'voided' || or.status === 'cancelled') return done();
  // Never sent (it stopped partway): nothing was held, so it's just closed.
  if (or.status === 'building') { await ref.set({ status: 'cancelled', cancelledAt: nowIso(), cancelReason: 'Not paid at the kiosk' }, { merge: true }); return done(); }
  if (or.card) {
    const s: any = await stopCard(db, tenantId, tenant, orderId, by, o);
    if (s.ok && s.state === 'paid') return { state: 'paid' };
    // Card payments no longer set up for the business: nothing can be taken for it, so its card is marked stopped and
    // the order is let go all the same (never held forever).
    if (!s.ok && s.code === 'no_payments') await ref.set({ card: { state: 'stopped', updatedAt: nowIso() }, cardOpen: false }, { merge: true });
    else if (!s.ok) return s.code === 'processing' ? busy(STILL_PROCESSING, 409, 'processing') : busy('Card payments couldn’t be reached just now. Try again in a moment.', 503, 'unknown');
  }
  const v: any = await voidOrder(db, tenantId, orderId, 'Not paid at the kiosk', { id: null, name: by });
  if (v.error) { const cur: any = (await ref.get()).data() || {}; return cur.paidAt ? { state: 'paid' } : busy(STILL_PROCESSING, 409, 'processing'); }
  return done();
}

/** EVERY FEW MINUTES (cron/retail-payments): kiosk orders still waiting to be paid KIOSK_UNPAID_MIN minutes after they
 *  were placed (the kiosk lost its connection, or was switched off mid-order) are let go, so what they held goes back. */
export async function sweepKiosk(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ letGo: number; paid: number }> {
  const out = { letGo: 0, paid: 0 }; const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('kiosk.state', '==', 'awaiting_pay').limit(40).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const or: any = d.data() || {};
    if (now - (Date.parse(String(or.createdAt || '')) || now) < KIOSK_UNPAID_MIN * 60000) continue;
    const r = await letGo(db, tenantId, tenant, d.id, String(or.createdBy || 'Kiosk'), o).catch(() => null);
    if (r?.state === 'let_go') out.letGo++; else if (r?.state === 'paid') out.paid++;
  }
  return out;
}

/** A manager, from their PIN typed on the kiosk (the same lockout as any PIN, lib/pin), or null and why not. */
export async function managerByPin(db: any, tenantId: string, tenant: any, pin: unknown): Promise<{ id: string; name: string } | { error: string; status: number }> {
  const p = String(pin ?? ''); if (!validPin(p)) return { error: 'Enter a 4-digit PIN.', status: 400 };
  const ticket = await beginPinAttempt(db, tenantId); if (ticket === null) return { error: 'Too many wrong PINs. Wait 15 minutes.', status: 423 };
  const hit = await findStaffByPin(db, tenantId, p); await endPinAttempt(db, tenantId, ticket, !!hit);
  if (!hit) return { error: 'That PIN isn’t right.', status: 403 };
  const s: any = hit.data || {};
  const manager = MANAGER_ROLES.includes(String(s.role || '')) || s.isManager === true || (!!tenant?.ownerId && tenant.ownerId === hit.id);
  return manager ? { id: hit.id, name: String(hit.name || 'A manager').slice(0, 60) } : { error: 'That isn’t a manager’s PIN.', status: 403 };
}
