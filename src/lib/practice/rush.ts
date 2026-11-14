// src/lib/practice/rush.ts — PRACTICE A RUSH (design canvas PracticeRush). A Friday night at the host stand, made up,
// played on the same rules the real host stand uses: where each table is in its meal and when it's likely free
// (lib/table-stage), who to seat next and why (lib/seat-next), the wait a guest is told (lib/wait-line), and what a
// table needs next (lib/nudges). Nothing here is real: no guests, texts, tickets or payments.
// - Guests walk in and bookings arrive. You seat them; the coach says when a better table was free, and why.
// - The kitchen makes what's fired; servers take orders and fire mains on their own, but late, unless you step in from
//   "Needs you" (food at the pass, a table that hasn't ordered, mains to fire, a table asking for the check).
// - Guests get less happy waiting past the time they were told, with food at the pass, or waiting to pay; a walk-in
//   kept far past their time leaves. A booking that doesn't come is a choice to make, with no wrong answer.
// Pure and deterministic: the same choices make the same night.
import { DEFAULT_FLOOR, tableStage, type FloorSettings, type Stage } from '@/lib/table-stage';
import { floorTables, seatNext, staffLoads, type SeatTable, type Suggestion } from '@/lib/seat-next';
import { linePlace } from '@/lib/wait-line';
import { DEFAULT_NUDGES, nudgesFor, type Nudge, type NudgeTable } from '@/lib/nudges';
import { DEFAULT_COURSES } from '@/lib/table-service';

export const RUSH_MIN = 40;
export const START_MIN = 19 * 60;
const BASE = Date.parse('2026-11-14T00:00:00Z');   // a made-up Friday; only differences in time matter
const FS: FloorSettings = { ...DEFAULT_FLOOR };
// (Servers check back on their own here: the practice is about the door, the pass, mains and checks.)
const NS = { ...DEFAULT_NUDGES, checkBackMin: 0 };

export type RushTable = { id: string; name: string; seatCount: number; tags: string[]; staffIds: string[] };
type Line = { lineId: string; name: string; course: number; courseName: string; firedAt: string | null; kdsId: string; at: string; makeSeconds: number };
type Ticket = { status: string; readyAt: string | null; deliveredAt: string | null; make: number; firedAt: string | null };
export type RushParty = {
  id: string; name: string; size: number; kind: 'walkin' | 'booking'; arrive: number; bookedFor: number | null; needs: string[]; asks: string[];
  status: 'coming' | 'waiting' | 'seated' | 'finished' | 'left' | 'no_show'; joinedAt: string | null; quotedMinutes: number | null;
  seatedAt: string | null; finishedAt: string | null; clearedAt?: string | null; unitIds: string[]; mood: number; waited: number | null;
  tab: Line[]; tickets: Record<string, Ticket>; checkAt: string | null; paidAt: string | null; done: Record<string, { at: string }>;
  // The party's own pace (minutes): when its server would order and fire mains unasked, how long it eats, dessert or not.
  pace: { order: number; fire: number; eat: number; dessert: boolean; pay: number; noShow?: boolean };
  orderedAt: number | null; lastServedAt: number | null; leaveAt: number | null;
};
export type Need = { key: string; partyId: string; table: string; kind: Nudge['kind'] | 'check' | 'no_show'; text: string; action: string; urgent: boolean };
export type RushLog = { t: number; text: string; tone: 'ok' | 'warn' | 'bad' | 'coach' };
export type RushState = {
  t: number; tables: RushTable[]; parties: Record<string, RushParty>; log: RushLog[]; coach: string | null; coachAt: number;
  turned: number; seated: number; walkedOut: number; ended: boolean; tips: { size: number; pass: number; check: number; order: number; late: number };
};

const iso = (t: number) => new Date(BASE + (START_MIN + t) * 60000).toISOString();
const nowMs = (s: RushState) => BASE + (START_MIN + s.t) * 60000;
/** The minute of the rush a moment is at (0 is the start). */
export const minuteOf = (v: string | null) => (v ? (Date.parse(v) - BASE) / 60000 - START_MIN : 0);
export const clockOf = (t: number) => { const m = Math.floor(START_MIN + t); const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
const say = (s: RushState, text: string, tone: RushLog['tone'] = 'ok') => { s.log.unshift({ t: s.t, text, tone }); s.log.length = Math.min(s.log.length, 60); };
const cname = (n: number) => DEFAULT_COURSES.find((c) => c.n === n)?.name || 'Order';

const TABLES: RushTable[] = [
  [2, 'jo', ['window']], [2, 'jo', ['window']], [6, 'sam', []], [2, 'jo', []], [4, 'sam', []], [4, 'rae', ['step-free']],
  [2, 'sam', []], [4, 'rae', []], [2, 'jo', []], [6, 'rae', ['step-free']], [4, 'rae', []], [4, 'sam', []],
].map(([n, st, tags], i) => ({ id: `u${i + 1}`, name: String(i + 1), seatCount: n as number, tags: tags as string[], staffIds: [st as string] }));
export const SERVERS: Record<string, string> = { jo: 'Jo', sam: 'Sam', rae: 'Rae' };

type PartyInput = Omit<Partial<RushParty>, 'pace'> & { pace?: Partial<RushParty['pace']> };
function party(id: string, name: string, size: number, o: PartyInput = {}): RushParty {
  const { pace, ...rest } = o;
  return { id, name, size, kind: 'walkin', arrive: 0, bookedFor: null, needs: [], asks: [], status: 'coming', joinedAt: null, quotedMinutes: null, seatedAt: null, finishedAt: null,
    unitIds: [], mood: 1, waited: null, tab: [], tickets: {}, checkAt: null, paidAt: null, done: {}, orderedAt: null, lastServedAt: null, leaveAt: null,
    pace: { order: 5, fire: 14, eat: 12, dessert: false, pay: 6, ...(pace || {}) }, ...rest };
}

/** The night as it starts: eight tables already in their meal, two parties waiting, and who's coming. */
export function newRush(): RushState {
  const s: RushState = { t: 0, tables: TABLES.map((x) => ({ ...x })), parties: {}, log: [], coach: null, coachAt: 0, turned: 0, seated: 0, walkedOut: 0, ended: false, tips: { size: 0, pass: 0, check: 0, order: 0, late: 0 } };
  const add = (p: RushParty) => { s.parties[p.id] = p; };
  // Already seated, a minute count back from now, and how far along.
  const sat = (id: string, name: string, size: number, table: string, ago: number, stage: 'starters' | 'mains_cooking' | 'mains_pass' | 'eating' | 'none', pace: Partial<RushParty['pace']> = {}) => {
    const p = party(id, name, size, { status: 'seated', unitIds: [table], seatedAt: iso(-ago), joinedAt: iso(-ago - 5), pace });
    if (stage !== 'none') order(s, p, -ago + 3);
    if (stage === 'starters') serveCourse(p, 1, -1);
    if (stage === 'mains_cooking') { serveCourse(p, 2, -12); fire(p, 3, -5); }
    if (stage === 'mains_pass') { serveCourse(p, 2, -18); fire(p, 3, -16); const k = p.tickets[`${p.id}_3`]; k.status = 'ready'; k.readyAt = iso(-2); }
    if (stage === 'eating') { serveCourse(p, 2, -24); fire(p, 3, -20); serveCourse(p, 3, -6); }
    add(p);
  };
  sat('rivera', 'Rivera', 2, 'u1', 38, 'eating', { eat: 10, dessert: true });
  sat('okafor', 'Okafor', 6, 'u10', 52, 'eating', { eat: 4, pay: 5 });
  sat('hart', 'Hart', 2, 'u4', 9, 'starters');
  sat('kim', 'Kim', 4, 'u5', 30, 'mains_pass');
  sat('long', 'Long', 4, 'u8', 34, 'mains_cooking');
  sat('fox', 'Fox', 2, 'u9', 46, 'eating', { eat: 2, pay: 4 });
  sat('moss', 'Moss', 6, 'u3', 9, 'none', { order: 14 });
  sat('ng', 'Ng', 4, 'u12', 36, 'mains_cooking');
  // Waiting now.
  for (const [id, name, size, ago, quote] of [['lee', 'Lee', 2, 6, 10], ['chris', 'Chris', 4, 12, 10]] as [string, string, number, number, number][])
    add(party(id, name, size, { status: 'waiting', joinedAt: iso(-ago), quotedMinutes: quote }));
  // Coming: walk-ins, and bookings (one with step-free access, one with an allergy, one that doesn't come).
  const come: [string, string, number, number, PartyInput][] = [
    ['ana', 'Ana', 2, 3, {}], ['dee', 'Dee', 3, 6, {}], ['patel', 'Patel', 5, 10, { kind: 'booking', bookedFor: 10, needs: ['step-free'], asks: ['Step-free access'] }],
    ['nguyen', 'Nguyen', 3, 13, { kind: 'booking', bookedFor: 15, asks: ['Allergy: tree nuts'] }], ['eli', 'Eli', 2, 16, {}], ['ward', 'Ward', 7, 99, { kind: 'booking', bookedFor: 15, pace: { order: 5, fire: 14, eat: 12, dessert: false, pay: 6, noShow: true } }],
    ['bo', 'Bo', 4, 20, {}], ['reyes', 'Reyes', 4, 24, { kind: 'booking', bookedFor: 25, asks: ['Birthday'] }], ['ivy', 'Ivy', 2, 27, {}], ['max', 'Max', 6, 30, {}], ['sol', 'Sol', 2, 34, {}],
  ];
  for (const [id, name, size, at, o] of come) add(party(id, name, size, { arrive: at, ...o }));
  say(s, `Friday, ${clockOf(0)}. The room’s nearly full, and two parties are waiting.`);
  return s;
}

// ── The meal ─────────────────────────────────────────────────────────────────────────────────────────────────────
const MAKE: Record<number, number> = { 1: 3, 2: 9, 3: 12, 4: 6 };
function addCourse(p: RushParty, n: number, at: number, fired: boolean) {
  const lineId = `${p.id}_${n}`; const make = MAKE[n] + ((p.size * 7 + n) % 3);
  p.tab.push({ lineId, name: cname(n), course: n, courseName: cname(n), firedAt: fired ? iso(at) : null, kdsId: lineId, at: iso(at), makeSeconds: make * 60 });
  p.tickets[lineId] = { status: fired ? 'pending' : 'unfired', readyAt: null, deliveredAt: null, make, firedAt: fired ? iso(at) : null };
}
function order(s: RushState, p: RushParty, at: number) {
  if (p.orderedAt !== null) return;
  p.orderedAt = at; addCourse(p, 1, at, true); addCourse(p, 2, at, true); addCourse(p, 3, at, false); if (p.pace.dessert) addCourse(p, 4, at, false);
  void s;
}
function fire(p: RushParty, n: number, at: number) {
  const l = p.tab.find((x) => x.course === n); const k = l ? p.tickets[l.kdsId] : null;
  if (!l || !k || l.firedAt) return false;
  l.firedAt = iso(at); k.status = 'pending'; k.firedAt = iso(at); return true;
}
function serveCourse(p: RushParty, n: number, at: number) {
  for (const l of p.tab.filter((x) => x.course <= n)) { const k = p.tickets[l.kdsId]; if (!l.firedAt) { l.firedAt = iso(at - 10); k.firedAt = l.firedAt; }
    if (k.status !== 'delivered') { k.status = 'delivered'; k.readyAt = k.readyAt || iso(at); k.deliveredAt = iso(at); } }
  p.lastServedAt = at;
}

// ── What the host stand sees ──────────────────────────────────────────────────────────────────────────────────────
const asHosted = (p: RushParty) => ({ id: p.id, name: p.name, size: p.size, needs: p.needs, status: p.status === 'no_show' ? 'no_show' : p.status === 'coming' ? 'expected' : p.status,
  arrivesAt: p.kind === 'booking' && p.bookedFor !== null ? iso(p.bookedFor) : null, joinedAt: p.joinedAt, seatedAt: p.seatedAt, finishedAt: p.finishedAt, clearedAt: p.clearedAt || null,
  unitIds: p.unitIds, guestIds: [], quotedMinutes: p.quotedMinutes, notifiedAt: null, source: p.kind === 'booking' ? 'booking' : 'walk_in' });
export function stagesOf(s: RushState): Record<string, Stage> {
  const out: Record<string, Stage> = {}; const now = nowMs(s);
  for (const p of Object.values(s.parties)) if (p.status === 'seated' && p.unitIds[0])
    out[p.unitIds[0]] = tableStage({ seatedAt: p.seatedAt, size: p.size, tab: p.tab, tickets: p.tickets, courses: DEFAULT_COURSES, checkAt: p.checkAt, paidAt: p.paidAt }, FS, now);
  return out;
}
export function floorOf(s: RushState): SeatTable[] {
  // Bookings due soon hold nothing here: a booking is held only once it's arrived, as a waiting party.
  return floorTables(s.tables, Object.values(s.parties).filter((p) => p.status !== 'coming').map(asHosted), stagesOf(s), FS, nowMs(s), { holdBeforeMinutes: 0, holdGraceMinutes: 15 });
}
const waitingOf = (s: RushState) => Object.values(s.parties).filter((p) => p.status === 'waiting');
const asSeat = (p: RushParty) => ({ id: p.id, name: p.name, size: p.size, needs: p.needs, status: 'waiting', joinedAt: p.joinedAt, quotedMinutes: p.quotedMinutes, notifiedAt: null });
/** Who to seat next, and why: the real host stand's suggestions. */
export function suggestions(s: RushState): Suggestion[] {
  const tables = floorOf(s); const loads = staffLoads(s.tables, Object.values(s.parties).map(asHosted), SERVERS);
  return seatNext(tables, waitingOf(s).map(asSeat), loads, FS, nowMs(s)).now;
}

/** What needs the host now: the real nudges for each table, a table asking for the check, a booking that hasn't come. */
export function needsOf(s: RushState): Need[] {
  const now = nowMs(s); const out: Need[] = [];
  for (const p of Object.values(s.parties)) {
    if (p.status === 'seated') {
      const table = `Table ${s.tables.find((t) => t.id === p.unitIds[0])?.name || ''}`;
      if (p.checkAt && !p.paidAt) { out.push({ key: `check:${p.id}`, partyId: p.id, table, kind: 'check', text: `${table} asked for the check`, action: 'Take payment', urgent: now - Date.parse(p.checkAt) > 4 * 60000 }); continue; }
      const nt: NudgeTable = { visitId: p.id, partyId: p.id, table, seatedAt: p.seatedAt, tab: p.tab, tickets: p.tickets, allergies: [], done: p.done, courses: DEFAULT_COURSES };
      for (const n of nudgesFor(nt, NS, now)) {
        const action = n.kind === 'at_pass' ? 'Run it' : n.kind === 'fire' ? `Fire ${n.course?.name.toLowerCase() || 'it'}` : n.kind === 'no_order' ? 'Send their server' : n.kind === 'late' ? 'Tell the table' : 'Done';
        out.push({ key: `${n.key}:${p.id}`, partyId: p.id, table, kind: n.kind, text: `${table}: ${n.text}`, action, urgent: n.urgent });
      }
    }
    if (p.kind === 'booking' && p.status === 'coming' && p.bookedFor !== null && p.pace.noShow && s.t >= p.bookedFor + 15)
      out.push({ key: `noshow:${p.id}`, partyId: p.id, table: '', kind: 'no_show', text: `${p.name}, ${p.size}, booked for ${clockOf(p.bookedFor)}, hasn’t come. Their card is on file for $20 a guest.`, action: `Charge $${p.size * 20}`, urgent: false });
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

// ── Your moves ────────────────────────────────────────────────────────────────────────────────────────────────────
export function seat(s: RushState, partyId: string, tableId: string): { ok: boolean; error?: string } {
  const p = s.parties[partyId]; const t = s.tables.find((x) => x.id === tableId);
  if (!p || p.status !== 'waiting') return { ok: false, error: 'They aren’t waiting.' };
  if (!t) return { ok: false, error: 'Pick a table.' };
  const floor = floorOf(s); const ft = floor.find((x) => x.id === tableId)!;
  if (ft.occupied) return { ok: false, error: ft.clearing ? `Table ${t.name} is being cleared.` : `Table ${t.name} has guests at it.` };
  if (t.seatCount < p.size) return { ok: false, error: `Table ${t.name} seats ${t.seatCount}, and ${p.name} are ${p.size}.` };
  if (p.needs.some((n) => !t.tags.includes(n))) return { ok: false, error: `${p.name} need step-free access, and Table ${t.name} doesn’t have it.` };
  // The coach: what the host stand would have suggested, and why.
  const best = suggestions(s).find((x) => x.partyId === partyId && x.action === 'seat'); s.coach = null;
  const wasted = t.seatCount - p.size;
  if (best && best.tableId !== tableId && wasted > 0) {
    const bt = s.tables.find((x) => x.id === best.tableId)!;
    if (bt.seatCount - p.size < wasted) { s.coach = `Table ${bt.name} fit ${p.name} better: ${best.reasons[0] || `it seats ${bt.seatCount}`}. At Table ${t.name}, ${wasted} ${wasted === 1 ? 'seat sits' : 'seats sit'} empty.`; s.tips.size++; }
  } else if (best && best.tableId === tableId) s.coach = `Good call. ${best.reasons.slice(0, 2).join('. ')}.`;
  if (s.coach) s.coachAt = s.t;
  const waited = p.joinedAt ? Math.max(0, Math.round((nowMs(s) - Date.parse(p.joinedAt)) / 60000)) : 0;
  p.status = 'seated'; p.unitIds = [tableId]; p.seatedAt = iso(s.t); p.waited = waited; s.seated++;
  if (p.asks.some((a) => a.startsWith('Allergy'))) say(s, `${p.name}’s allergy goes on every ticket for Table ${t.name}.`, 'ok');
  say(s, `${p.name}, ${p.size} seated at Table ${t.name}${waited ? ` after ${waited} min` : ''}.`);
  return { ok: true };
}

export function act(s: RushState, key: string): { ok: boolean; error?: string } {
  const n = needsOf(s).find((x) => x.key === key); if (!n) return { ok: false, error: 'That’s been taken care of.' };
  const p = s.parties[n.partyId];
  if (n.kind === 'check') { p.paidAt = iso(s.t); p.leaveAt = s.t + 2; say(s, `${n.table} paid.`); return { ok: true }; }
  if (n.kind === 'no_show') { p.status = 'no_show'; say(s, `${p.name} charged $${p.size * 20} for not coming, as they agreed when they booked.`, 'ok'); return { ok: true }; }
  if (n.kind === 'at_pass') { const l = p.tab.filter((x) => p.tickets[x.kdsId].status === 'ready').sort((a, b) => a.course - b.course)[0]; if (l) { serveCourse(p, l.course, s.t); s.tips.pass++; say(s, `${n.table}: ${l.courseName.toLowerCase()} taken out.`); } return { ok: true }; }
  if (n.kind === 'fire') { const l = p.tab.find((x) => !x.firedAt); if (l) { fire(p, l.course, s.t); say(s, `${n.table}: ${l.courseName.toLowerCase()} fired.`); } return { ok: true }; }
  if (n.kind === 'no_order') { order(s, p, s.t); s.tips.order++; say(s, `${n.table}: their server took the order.`); return { ok: true }; }
  p.done[n.key.split(':').slice(0, -1).join(':')] = { at: iso(s.t) };
  return { ok: true };
}
/** A booking that didn't come, let go: nothing charged. */
export function letGoNoShow(s: RushState, partyId: string) { const p = s.parties[partyId]; if (p && p.status === 'coming') { p.status = 'no_show'; say(s, `${p.name} let go. Nothing charged.`); } }

// ── Time ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The night moves on by `dt` minutes (in small steps, so nothing is skipped). */
export function tick(s: RushState, dt: number) {
  if (s.ended) return;
  const end = Math.min(RUSH_MIN, s.t + dt);
  while (s.t < end - 1e-9) { s.t = Math.min(end, s.t + 0.25); step(s); }
  if (s.t >= RUSH_MIN) { s.ended = true; say(s, 'That’s the rush. Here’s how it went.', 'ok'); }
}
function step(s: RushState) {
  const now = nowMs(s); const t = s.t;
  for (const p of Object.values(s.parties)) {
    if (p.status === 'coming' && t >= p.arrive && !p.pace.noShow) {
      p.status = 'waiting'; p.joinedAt = iso(t);
      if (p.kind === 'walkin') { const lp = linePlace(asSeat(p), floorOf(s), waitingOf(s).filter((x) => x.id !== p.id).map(asSeat), FS, now); p.quotedMinutes = Math.max(5, Math.ceil(((lp.minutes ?? 15)) / 5) * 5); }
      else p.quotedMinutes = 5;
      say(s, p.kind === 'booking' ? `${p.name}, ${p.size}, here for their ${clockOf(p.bookedFor ?? t)} booking${p.asks.length ? ` (${p.asks.join(', ')})` : ''}.` : `${p.name}, ${p.size}, walked in. Told about ${p.quotedMinutes} min.`);
    }
    if (p.status === 'waiting' && p.joinedAt) {
      const waited = (now - Date.parse(p.joinedAt)) / 60000; const over = waited - (p.quotedMinutes || 10);
      if (over > 0) p.mood = Math.max(0, p.mood - 0.0075);
      if (p.kind === 'walkin' && over > 12) { p.status = 'left'; p.mood = 0; p.waited = Math.round(waited); s.walkedOut++; say(s, `${p.name} left after ${Math.round(waited)} min. They were told ${p.quotedMinutes}.`, 'bad'); }
    }
    if (p.status !== 'seated') {
      if (p.status === 'finished' && !p.clearedAt && p.finishedAt && now - Date.parse(p.finishedAt) >= FS.clearMin * 60000) p.clearedAt = iso(t);
      continue;
    }
    const sat = (Date.parse(p.seatedAt!) - BASE) / 60000 - START_MIN;
    // Their server takes the order on their own pace (a nudge to send them sooner).
    if (p.orderedAt === null) { if (t - sat >= p.pace.order) order(s, p, t); else if (t - sat > NS.noOrderMin) p.mood = Math.max(0, p.mood - 0.005); }
    // The kitchen makes what's fired.
    for (const l of p.tab) { const k = p.tickets[l.kdsId]; if (k.status === 'pending' && k.firedAt && now - Date.parse(k.firedAt) >= k.make * 60000) { k.status = 'ready'; k.readyAt = iso(t); } }
    // Food at the pass: someone runs it after a while anyway, but the table notices.
    for (const l of p.tab) { const k = p.tickets[l.kdsId]; if (k.status === 'ready' && k.readyAt) { const w = (now - Date.parse(k.readyAt)) / 60000; if (w > NS.passWaitMin) p.mood = Math.max(0, p.mood - 0.0075); if (w > NS.passWaitMin + 4) { serveCourse(p, l.course, t); s.tips.late++; say(s, `Someone ran Table ${s.tables.find((x) => x.id === p.unitIds[0])?.name}’s ${l.courseName.toLowerCase()} after ${Math.round(w)} min at the pass.`, 'warn'); } } }
    // Mains fired by the server a while after starters, if nobody's done it sooner.
    const next = p.tab.find((x) => !x.firedAt);
    if (next && p.lastServedAt !== null && t - p.lastServedAt >= p.pace.fire) fire(p, next.course, t);
    // Eaten: they ask for the check; paid, they leave.
    const allOut = p.tab.length > 0 && p.tab.every((l) => p.tickets[l.kdsId].status === 'delivered');
    if (allOut && !p.checkAt && p.lastServedAt !== null && t - p.lastServedAt >= p.pace.eat) { p.checkAt = iso(t); }
    if (p.checkAt && !p.paidAt) { const w = (now - Date.parse(p.checkAt)) / 60000; if (w > 4) p.mood = Math.max(0, p.mood - 0.0075); if (w >= p.pace.pay + 4) { p.paidAt = iso(t); p.leaveAt = t + 2; say(s, `Table ${s.tables.find((x) => x.id === p.unitIds[0])?.name} waited ${Math.round(w)} min to pay.`, 'warn'); s.tips.check++; } }
    if (p.paidAt && p.leaveAt !== null && t >= p.leaveAt) { p.status = 'finished'; p.finishedAt = iso(t); s.turned++; say(s, `${p.name} left. Table ${s.tables.find((x) => x.id === p.unitIds[0])?.name} is being cleared.`); }
  }
}

// ── How it went ───────────────────────────────────────────────────────────────────────────────────────────────────
export function scoreOf(s: RushState) {
  const came = Object.values(s.parties).filter((p) => p.status !== 'coming' && p.status !== 'no_show');
  const now = nowMs(s);
  const waits = came.map((p) => (p.status === 'waiting' && p.joinedAt ? (now - Date.parse(p.joinedAt)) / 60000 : p.waited ?? 0));
  const happy = came.length ? Math.round((came.filter((p) => p.mood >= 0.7).length / came.length) * 100) : 100;
  return { seated: s.seated, turned: s.turned, longestWait: Math.round(Math.max(0, ...waits)), happy, walkedOut: s.walkedOut };
}
/** What to take from the night, in a few lines, from what actually happened. */
export function lessons(s: RushState): string[] {
  const sc = scoreOf(s); const out: string[] = [];
  // Still waiting at the end, and past the time they were told (someone who just walked in isn't a miss).
  const now = nowMs(s);
  const overdue = Object.values(s.parties).filter((p) => p.status === 'waiting' && p.joinedAt && (now - Date.parse(p.joinedAt)) / 60000 > (p.quotedMinutes || 10));
  if (sc.walkedOut) out.push(`${sc.walkedOut} ${sc.walkedOut === 1 ? 'party' : 'parties'} left after waiting well past the time they were told. Look at the waiting list often, seat whoever is furthest past their time first, and when a table is a long way off, say so.`);
  const names = (xs: RushParty[]) => (xs.length > 3 ? `${xs.length} parties` : xs.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' and $1'));
  if (overdue.length) out.push(`${names(overdue)} ${overdue.length === 1 ? 'was' : 'were'} still waiting past the time they were told${overdue.some((p) => p.needs.length) ? `. ${overdue.find((p) => p.needs.length)!.name} needed step-free access: keep a table that has it in mind for them` : ''}.`);
  if (!sc.walkedOut && !overdue.length) out.push(sc.longestWait <= 15 ? 'Nobody waited past the time they were told. Good pacing at the door.' : `Nobody left, though the longest wait was ${sc.longestWait} min.`);
  if (s.tips.size) out.push(`${s.tips.size} time${s.tips.size === 1 ? '' : 's'} a better-sized table was free. “Seat next” on the host stand shows it, with why.`);
  if (s.tips.check) out.push(`${s.tips.check} ${s.tips.check === 1 ? 'table' : 'tables'} waited to pay. Paying at the table lets guests do it themselves.`);
  out.push(s.tips.late ? `Food sat at the pass long enough for someone else to run it ${s.tips.late} time${s.tips.late === 1 ? '' : 's'}. “Needs you” shows it the moment it’s ready.`
    : s.tips.pass ? `You ran food from the pass ${s.tips.pass} time${s.tips.pass === 1 ? '' : 's'}, and none of it waited too long.` : 'Food never waited at the pass for long.');
  return out;
}
