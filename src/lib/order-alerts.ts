// src/lib/order-alerts.ts — ALERTS AT THE RIGHT MOMENT. Checked every ten minutes (api/cron/order-alerts) for each shop
// that has a shipping schedule, on the days it ships; each kind goes out at most once a day:
//   · A big day: from 8 AM until the cutoff, more orders due today than the shop usually ships in a day.
//   · Orders coming in fast: from 9 AM until half an hour before the cutoff, twice the usual number of orders by this
//     time of day (and at least eight).
//   · Cutoff in 1 hour: orders due today that aren't packed yet, about an hour before the cutoff.
//   · Missed the pickup: after today's last pickup (or the end of the shipping day), orders due today still without a
//     label, and whether their customers are told the new date by themselves (lib/late-notices, an hour later) or need
//     telling (the Late list). A labeled box may have gone with the pickup, so it isn't counted.
// Orders waiting on stock their customer chose to wait for, and pre-orders still waiting, aren't counted: their dates
// move with the stock.
// "Usually" is worked out once a day: the middle number of orders shipped on the days the shop shipped over the last
// four weeks (at least five such days), and the middle number paid by this time of day over its last ten ship days.
// Too little history and the busy-day alerts stay quiet rather than guess.
// Each person picks which alerts they get (Orders → Setup → Alerts, saved on their own staff record). Until they do,
// whoever packed online orders in the last two weeks gets the cutoff, managers get a big day, coming in fast and
// missed the pickup, and the one person packing, when only one is, gets all four. They're the app's own
// notifications, so they show in the app and buzz phones the way every alert does (lib/push, with each person's
// quiet hours and away days).
import { addDays, dayKey, formatTime, startOfDay, tenantTimeZone, wallParts } from './tenant-time';
import { cutoffInfo, isShipDay, LATE_GRACE_MS, MAX_AUTO_NOTICES, missedAt, nextShipDay, promiseCarrier, promisedDay, scheduleFrom, type ShipSchedule } from './ship-promise';
import { dueBy, hasLabel, shipsItself, teamDue, whenWord } from './ship-day';
import { permissionsFor } from './fulfilment-access';
import { firstName } from './orders-view';

export type OrderAlertKind = 'big_day' | 'fast' | 'cutoff' | 'missed';
export const ORDER_ALERTS: { kind: OrderAlertKind; type: string; label: string; hint: string }[] = [
  { kind: 'big_day', type: 'orders_big_day', label: 'A big day', hint: 'In the morning, when more orders are due today than you usually ship.' },
  { kind: 'fast', type: 'orders_fast', label: 'Orders coming in fast', hint: 'When today’s orders are twice your usual by this time of day.' },
  { kind: 'cutoff', type: 'orders_cutoff', label: 'Cutoff in 1 hour', hint: 'An hour before the cutoff, when orders due today aren’t packed yet.' },
  { kind: 'missed', type: 'orders_missed', label: 'Missed the pickup', hint: 'After the last pickup, when orders due today still have no label.' },
];

/** How far back "who packs" looks. */
export const PACKERS_DAYS = 14;

/**
 * Who packs online orders: anyone who packed one in the last two weeks (the sign-in that started it, matched to their
 * staff record by its id or its login), and anyone a manager made a picker, packer or shipper. Staff record ids. In a
 * salon or spa most of the team never touches the shop, so having the app at all isn't enough.
 */
export function packersOf(staff: any[], packedBy: string[]): Set<string> {
  const by = new Set(packedBy.filter(Boolean).map(String));
  const out = new Set<string>();
  for (const m of staff) {
    if (!m?.id || m.archived === true) continue;
    const made = ['picker', 'packer', 'shipper'].includes(String(m.fulfilmentRole || '').toLowerCase());
    if (made || by.has(String(m.id)) || (m.authUid && by.has(String(m.authUid)))) out.add(String(m.id));
  }
  return out;
}

/**
 * Who gets an alert when they haven't chosen. The cutoff: whoever packs (managers, while nobody has packed yet). A big
 * day, coming in fast, missed the pickup: managers, and the one person who packs when only one does. Never someone
 * with no access to orders.
 */
export function alertDefault(kind: OrderAlertKind, staff: any, packers: Set<string>): boolean {
  const perms = permissionsFor(staff);
  if (!perms.canPick && !perms.canManage) return false;
  const packs = packers.has(String(staff?.id || ''));
  if (kind === 'cutoff') return packs || (packers.size === 0 && perms.canManage);
  return perms.canManage || (packs && packers.size === 1);
}

/** Whether this person gets this alert: their own choice, else the default for what they do. */
export function wantsAlert(kind: OrderAlertKind, staff: any, packers: Set<string>): boolean {
  const own = staff?.notificationPrefs?.orderAlerts?.[kind];
  if (typeof own === 'boolean') return own;
  return alertDefault(kind, staff, packers);
}

// ── Usual ────────────────────────────────────────────────────────────────────

/** `daily`: orders usually shipped on a day the shop ships. `paidByDay`: for each of its last ship days, the minutes
 *  after midnight (shop's clock) each order was paid, so "usual by now" can be read at any time of day. */
export type Usual = { daily: number | null; paidByDay: number[][] };

const middle = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const minuteOfDay = (t: number, tz: string) => { const p = wallParts(new Date(t), tz); return p.hour * 60 + p.minute; };

export function usualFrom(shipped: any[], paid: any[], today: string, tz: string, schedule: ShipSchedule): Usual {
  const perDay = new Map<string, number>();
  for (const o of shipped) {
    if (!shipsItself(o)) continue;
    const t = Date.parse(String(o?.completedAt || ''));
    if (!Number.isFinite(t)) continue;
    const d = dayKey(new Date(t), tz);
    if (d >= today || d < addDays(today, -28)) continue;
    perDay.set(d, (perDay.get(d) || 0) + 1);
  }
  const days: string[] = [];
  for (let i = 1; i <= 28 && days.length < 10; i++) { const d = addDays(today, -i); if (isShipDay(d, schedule)) days.push(d); }
  const byDay = new Map<string, number[]>(days.map((d) => [d, []]));
  for (const o of paid) {
    if (o?.method !== 'ship' || o.digitalOnly === true) continue;
    const t = Date.parse(String(o?.paidAt || ''));
    if (!Number.isFinite(t)) continue;
    const list = byDay.get(dayKey(new Date(t), tz));
    if (list) list.push(minuteOfDay(t, tz));
  }
  const shippedDays = [...perDay.values()];
  return { daily: shippedDays.length >= 5 ? middle(shippedDays) : null, paidByDay: days.length >= 5 ? [...byDay.values()].map((l) => l.sort((a, b) => a - b)) : [] };
}

/** The usual number of orders paid by this minute of the day; null without enough history. */
export function usualBy(usual: Usual, minute: number): number | null {
  if (usual.paidByDay.length < 5) return null;
  return middle(usual.paidByDay.map((l) => l.filter((m) => m <= minute).length));
}

// ── What's due ───────────────────────────────────────────────────────────────

export type AlertNow = {
  /** Open ship orders due out today (late ones included; lib/ship-day dueBy), and how many of those aren't packed yet. */
  due: any[]; unpacked: number;
  /** Of those, the ones due today itself, not late from an earlier day: what "missed the pickup" is about. */
  dueToday: any[];
  /** Orders paid today so far. */
  paidToday: number;
  usual: Usual;
};

export type Alert = { kind: OrderAlertKind; title: string; message: string; link: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** 'Twice', '2.5 times', 'Three times', to the nearest half. */
const times = (r: number) => { const x = Math.round(r * 2) / 2; return x <= 2 ? 'Twice' : x === 3 ? 'Three times' : x === 4 ? 'Four times' : `${x} times`; };
const names = (list: any[]) => {
  const n = [...new Set(list.map((o) => firstName(o.customerName)))];
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} other${n.length - 2 === 1 ? '' : 's'}`;
};

/** The alerts due right now, before checking which already went out today. Pure. */
export function alertsDue(s: AlertNow, now: number, tz: string, schedule: ShipSchedule): Alert[] {
  const today = dayKey(new Date(now), tz);
  const ci = cutoffInfo(new Date(now), tz, schedule);
  if (!ci.shipDay) return [];
  const minute = minuteOfDay(now, tz);
  const left = ci.minutesLeft;   // null once the cutoff has passed
  const out: Alert[] = [];
  const dueCount = s.due.length;
  if (s.usual.daily && minute >= 8 * 60 && left !== null && dueCount >= Math.max(Math.ceil(s.usual.daily * 1.25), s.usual.daily + 5)) {
    out.push({ kind: 'big_day', title: 'A big day', message: `${plural(dueCount, 'order')} ${dueCount === 1 ? 'is' : 'are'} due today. You usually ship ${s.usual.daily}.`, link: '/retail-orders' });
  }
  const by = usualBy(s.usual, minute);
  if (by !== null && by >= 2 && minute >= 9 * 60 && left !== null && left >= 30 && s.paidToday >= 8 && s.paidToday >= 2 * by) {
    out.push({ kind: 'fast', title: 'Orders are coming in fast', message: `${times(s.paidToday / by)} your usual pace today: ${s.paidToday} so far, against ${by} by now on a usual day.`, link: '/retail-orders' });
  }
  if (left !== null && left <= 65 && left >= 40 && s.unpacked > 0) {
    out.push({ kind: 'cutoff', title: 'Cutoff in 1 hour', message: `${plural(s.unpacked, 'order')} due today ${s.unpacked === 1 ? 'isn’t' : 'aren’t'} packed yet.`, link: '/retail-orders' });
  }
  // Missed: today's last pickup has gone (each order by its own carrier's, with a few minutes' grace for the hand-over)
  // and it still has no label. A labeled box may have gone with the pickup; the Late list asks about those.
  const missed = s.dueToday.filter((o) => !hasLabel(o) && now >= Date.parse(missedAt(today, tz, schedule, promiseCarrier(o))) + 5 * 60_000);
  if (missed.length) {
    const next = whenWord(nextShipDay(addDays(today, 1), schedule), today, tz);
    const on = next === 'tomorrow' ? next : `on ${next}`;
    // Who hears the new date by themselves an hour after the pickup (lib/late-notices), and who needs a person.
    const toldAt = (o: any) => Date.parse(missedAt(today, tz, schedule, promiseCarrier(o))) + LATE_GRACE_MS;
    const given = missed.filter((o) => !!o.promise && (o.promise.shown === true || !!o.notifiedForPromiseAt) && promisedDay(o, tz) === today);
    const auto = given.filter((o) => o.holdForReview !== true && (Number(o.autoDelayNotices) || 0) < MAX_AUTO_NOTICES);
    const hand = given.filter((o) => !auto.includes(o));
    const after = auto.length ? formatTime(new Date(Math.max(...auto.map(toldAt))), tz) : '';
    const one = (n: number, a: string, b: string) => (n === 1 ? a : b);
    const message = hand.length
      ? `Tell ${names(hand)} ${one(hand.length, 'it ships', 'they ship')} ${on}?${auto.length ? ` ${names(auto)} ${one(auto.length, 'hears', 'hear')} the new date after ${after}.` : ''}`
      : auto.length
        ? `${names(auto)} ${one(auto.length, 'hears', 'hear')} after ${after} that ${one(auto.length, 'the order ships', 'their orders ship')} ${on}, unless ${one(auto.length, 'it’s', 'they’re')} labeled first.`
        : `${one(missed.length, 'It goes', 'They go')} out ${on}. No date was given to ${one(missed.length, 'its customer', 'their customers')}, so nobody needs telling.`;
    out.push({ kind: 'missed', title: `${plural(missed.length, 'order')} missed the pickup`, message, link: '/retail-orders?view=late' });
  }
  return out;
}

// ── The check ────────────────────────────────────────────────────────────────

export type AlertRun = { sent: number; people: number };
/** How long after the last pickup "missed the pickup" can still go out (a later check would be old news). */
const MISSED_WINDOW_MS = 3 * 3_600_000;

/**
 * One shop's check: works out what's due, sends each alert once today to the people who get it. Each alert is claimed
 * on the day's record before anyone is told, so two runs at once can't send one twice. The usual numbers are worked out
 * on the first check of the day and kept on that record.
 */
export async function checkOrderAlerts(db: any, tenantId: string, tenant: any, opts: { now?: number } = {}): Promise<AlertRun> {
  const out: AlertRun = { sent: 0, people: 0 };
  const rs = tenant?.retailSettings || {};
  const schedule = scheduleFrom(rs);
  if (!schedule.savedAt) return out;
  const tz = tenantTimeZone(tenant);
  const now = opts.now ?? Date.now();
  const today = dayKey(new Date(now), tz);
  if (!isShipDay(today, schedule)) return out;
  // No reads before the first alert's window opens, or once the cutoff and the last pickup are well past.
  const ci = cutoffInfo(new Date(now), tz, schedule);
  const cutoffMinute = ci.cutoffAt ? minuteOfDay(Date.parse(ci.cutoffAt), tz) : 24 * 60;
  if (minuteOfDay(now, tz) < Math.min(8 * 60, cutoffMinute - 65)) return out;
  const lastGone = Date.parse(missedAt(today, tz, schedule, null));
  if (ci.minutesLeft === null && Number.isFinite(lastGone) && now > lastGone + MISSED_WINDOW_MS) return out;
  const T = `tenants/${tenantId}`;
  const dayRef = db.doc(`${T}/private/order-alerts-${today}`);
  const day: any = (await dayRef.get()).data() || {};
  const sent: Record<string, string> = day.sent || {};
  if (ORDER_ALERTS.every((a) => sent[a.kind])) return out;

  let usual: Usual | null = day.usual && Array.isArray(day.usual.paidByDay) ? { daily: day.usual.daily ?? null, paidByDay: (day.usual.paidByDay as any[]).map((x: any) => (Array.isArray(x?.m) ? x.m.map(Number) : [])) } : null;
  if (!usual) {
    const since28 = startOfDay(addDays(today, -28), tz).toISOString();
    const [shippedSnap, paidSnap] = await Promise.all([
      db.collection(`${T}/retailOrders`).where('completedAt', '>=', since28).limit(3000).get(),
      db.collection(`${T}/retailOrders`).where('paidAt', '>=', since28).limit(3000).get(),
    ]);
    usual = usualFrom(shippedSnap.docs.map((d: any) => d.data() || {}), paidSnap.docs.map((d: any) => d.data() || {}), today, tz, schedule);
    // Kept as {m: [...]} per day: the database doesn't store a list inside a list.
    await dayRef.set({ usual: { daily: usual.daily, paidByDay: usual.paidByDay.map((m) => ({ m })) }, usualAt: new Date(now).toISOString() }, { merge: true }).catch(() => {});
  }

  const start = startOfDay(today, tz).toISOString();
  const [openSnap, paidTodaySnap] = await Promise.all([
    db.collection(`${T}/retailOrders`).where('stage', 'in', ['paid', 'picking', 'packed']).limit(1000).get(),
    db.collection(`${T}/retailOrders`).where('paidAt', '>=', start).limit(1000).get(),
  ]);
  const open = openSnap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }));
  const due = dueBy(open, today, rs, tz);
  const dueToday = due.filter((o: any) => dayKey(new Date(teamDue(o, rs, tz)), tz) === today);
  const paidToday = paidTodaySnap.docs.map((d: any) => d.data() || {}).filter((o: any) => o.method === 'ship' && o.digitalOnly !== true && o.stage !== 'placed').length;
  const todo = alertsDue({ due, dueToday, unpacked: due.filter((o: any) => o.stage !== 'packed').length, paidToday, usual }, now, tz, schedule).filter((a) => !sent[a.kind]);
  if (!todo.length) return out;

  const [staffSnap, packedSnap] = await Promise.all([
    db.collection(`${T}/staff`).get(),
    db.collection(`${T}/retailOrders`).where('packedAt', '>=', new Date(now - PACKERS_DAYS * 86_400_000).toISOString()).orderBy('packedAt', 'desc').limit(1000).get(),
  ]);
  const staff = staffSnap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })).filter((m: any) => m.archived !== true);
  const packers = packersOf(staff, packedSnap.docs.map((d: any) => String(d.data()?.claimedBy || '')));
  const at = new Date(now).toISOString();
  for (const a of todo) {
    // Claimed first: whichever run gets here first sends it; any other finds it taken.
    const mine = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(dayRef)).data() || {};
      if (cur.sent?.[a.kind]) return false;
      tx.set(dayRef, { sent: { [a.kind]: at } }, { merge: true });
      return true;
    }).catch(() => false);
    if (!mine) continue;
    const type = ORDER_ALERTS.find((x) => x.kind === a.kind)!.type;
    const people = staff.filter((m: any) => wantsAlert(a.kind, m, packers));
    if (!people.length) continue;
    const b = db.batch();
    for (const m of people) {
      const r = db.collection(`${T}/notifications`).doc();
      b.set(r, { id: r.id, userId: m.id, type, title: a.title, message: a.message, link: a.link, createdAt: at, read: false, ...(a.kind === 'missed' || a.kind === 'cutoff' ? { priority: 'high' } : {}) });
    }
    // Not written: the claim is let go, so the next check (ten minutes on) sends it while it's still due.
    try { await b.commit(); } catch { await dayRef.set({ sent: { [a.kind]: null } }, { merge: true }).catch(() => {}); continue; }
    out.sent++; out.people += people.length;
  }
  return out;
}
