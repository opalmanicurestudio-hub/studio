// src/lib/practice/sim.ts — PRACTICE A SHIFT: THE GAME'S STATE AND RULES (no drawing, no database).
//
// A Saturday morning at a full-service salon, 10:30 to 12:00. People arrive, wait, get served, pay and leave. Moments
// come up (a provider calls out, a client texts that she's late, a wash backlog, a walk-in) and the player decides.
// Where ClarityFlow already has the rule, the game uses it: the callout choose-by time (lib/callout-choices),
// reading a client's text (lib/text-assist), the late-arrival courtesy (lib/grace). Nothing here touches real data:
// no database, no texts, no payments. Everything is in this one object, so the same shift always plays the same way.
import { chooseByFor } from '@/lib/callout-timing';
import { intentByWords } from '@/lib/text-intent';
import { graceRule, graceRemaining } from '@/lib/grace';

export type Mood = 'ok' | 'warn' | 'bad';
export type Pose = 'sit' | 'stand' | 'lie' | 'chair';
export type SpotKind = 'hair' | 'barber' | 'wash' | 'nail' | 'pedi' | 'facial' | 'lash' | 'lounge' | 'desk' | 'door' | 'office';
export type Spot = { id: string; kind: SpotKind; role: 'client' | 'staff'; x: number; z: number; seat: number; ry: number; pose: Pose; label: string; tilt?: number; accessible?: boolean };
export type Look = { skin: string; hair?: string; hs: string; outfit: string; legs?: string; scarf?: string; male?: boolean; beard?: boolean; glasses?: boolean; build?: number; foils?: boolean; wheelchair?: boolean };
export type Person = {
  id: string; name: string; role: 'staff' | 'client'; look: Look; job?: string;
  at: string | null; x: number; z: number; path: { x: number; z: number }[]; to: string | null;
  state: 'idle' | 'service' | 'waiting' | 'walking' | 'busy' | 'away' | 'gone' | 'paying';
  patience: number; drain: number; need: string | null; serviceUntil: number | null; price: number; paid: boolean;
  bookedAt?: number; dur?: number; startedAt?: number | null; provider?: string | null; afterArrive?: string | null; busyUntil?: number | null; returnTo?: string | null;
};
export type Option = { id: string; label: string; what: string; tags: [string, 'green' | 'amber' | 'red'][] };
export type Decision = { id: string; title: string; body: string; who: string[]; options: Option[]; at: number; pause: boolean };
export type Prompt = { personId: string; text: string; to?: string };
export type Line = { t: number; text: string; tone?: 'ok' | 'warn' | 'bad' };
export type Text = { t: number; to: string; body: string };
export type State = {
  t: number; end: number; tz: string; dayStart: number; spots: Record<string, Spot>; people: Record<string, Person>;
  open: Decision[]; prompts: Prompt[]; log: Line[]; texts: Text[]; coach: string[];
  fired: Record<string, boolean>; flags: Record<string, any>; takings: number; onTime: { ok: number; late: number }; overload: number; policy: number; ended: boolean;
};

// ── The salon ────────────────────────────────────────────────────────
export const START_HOUR = 10.5;            // 10:30 AM
export const clock = (t: number) => { const m = Math.round(START_HOUR * 60 + t); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const S = (id: string, kind: SpotKind, role: 'client' | 'staff', x: number, z: number, o: Partial<Spot> = {}): Spot =>
  ({ id, kind, role, x, z, seat: 0, ry: 0, pose: 'stand', label: id, ...o });
const PI = Math.PI;
export function makeSpots(): Record<string, Spot> {
  const list: Spot[] = [];
  [2.0, 5.4, 8.8, 12.2].forEach((x, i) => {
    const kind: SpotKind = i === 3 ? 'barber' : 'hair';
    list.push(S(`${kind === 'barber' ? 'barber' : 'hair' + (i + 1)}`, kind, 'client', x + 1.4, 1.9, { seat: 0.68, ry: PI, pose: 'sit', label: kind === 'barber' ? 'Barber chair' : `Hair chair ${i + 1}` }));
    list.push(S(`${kind === 'barber' ? 'barber' : 'hair' + (i + 1)}-pro`, kind, 'staff', x + 1.4, 3.0, { ry: PI, label: kind === 'barber' ? 'Barber' : `Stylist ${i + 1}` }));
  });
  [5.4, 7.4, 9.4].forEach((z, i) => {
    list.push(S(`wash${i + 1}`, 'wash', 'client', 2.75, z + 0.65, { seat: 0.62, ry: PI / 2, pose: 'lie', tilt: -1.15, label: `Wash bowl ${i + 1}` }));
    list.push(S(`wash${i + 1}-pro`, 'wash', 'staff', 1.6, z + 1.5, { ry: -PI / 2, label: `Wash ${i + 1}` }));
  });
  [16.6, 20.8, 25.0].forEach((x, i) => {
    list.push(S(`nail${i + 1}`, 'nail', 'client', x + 0.9, 4.65, { seat: 0.7, ry: PI, pose: 'sit', label: `Nail table ${i + 1}` }));
    list.push(S(`nail${i + 1}-pro`, 'nail', 'staff', x + 1.3, 2.0, { seat: 0.65, pose: 'sit', label: `Nail tech ${i + 1}` }));
  });
  [1.0, 4.2, 7.4].forEach((x, i) => {
    list.push(S(`pedi${i + 1}`, 'pedi', 'client', x + 0.95, 13.95, { seat: 1.0, pose: 'sit', label: `Pedicure chair ${i + 1}` }));
    list.push(S(`pedi${i + 1}-pro`, 'pedi', 'staff', x + 0.95, 16.35, { seat: 0.4, ry: PI, pose: 'sit', label: `Pedicure tech ${i + 1}` }));
  });
  list.push(S('facial', 'facial', 'client', 24.35, 9.75, { seat: 0.78, pose: 'lie', label: 'Facial bed' }), S('facial-pro', 'facial', 'staff', 24.35, 7.05, { seat: 0.55, pose: 'sit', label: 'Esthetician' }));
  list.push(S('lash', 'lash', 'client', 28.05, 9.75, { seat: 0.78, pose: 'lie', label: 'Lash bed' }), S('lash-pro', 'lash', 'staff', 28.05, 7.05, { seat: 0.55, pose: 'sit', label: 'Lash artist' }));
  [[14.3, 9.05], [15.6, 9.05], [16.9, 9.05]].forEach(([x, z], i) => list.push(S(`sofa${i + 1}`, 'lounge', 'client', x, z, { seat: 0.6, pose: 'sit', label: 'Lounge sofa' })));
  list.push(S('armchair', 'lounge', 'client', 19.3, 9.2, { seat: 0.6, pose: 'sit', label: 'Lounge armchair' }));
  list.push(S('lounge-open', 'lounge', 'client', 18.0, 11.0, { pose: 'chair', label: 'Lounge (step-free)', accessible: true }));
  list.push(S('desk', 'desk', 'staff', 16.0, 13.4, { ry: PI, label: 'Front desk' }));
  list.push(S('desk-front1', 'desk', 'client', 15.0, 16.2, { ry: PI, label: 'At the desk' }), S('desk-front2', 'desk', 'client', 16.8, 16.3, { ry: PI, label: 'At the desk' }));
  list.push(S('door', 'door', 'client', 21.0, 17.6, { ry: PI, label: 'Entrance' }), S('door2', 'door', 'client', 22.2, 17.6, { ry: PI, label: 'Entrance' }));
  list.push(S('office', 'office', 'staff', 28.6, 16.4, { ry: PI, label: 'Back office' }));
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

const SK = { deep: '#5a3825', brown: '#8d5a3b', tan: '#b07a52', olive: '#c69472', light: '#f0c9a6', fair: '#f6dcc6', golden: '#d9a679' };
const TOP = { a: '#f2ede6', b: '#e8c9c3', c: '#cfdccf', d: '#d9d3ea' };
function P(id: string, name: string, role: 'staff' | 'client', at: string | null, look: Look, o: Partial<Person> = {}): Person {
  return { id, name, role, look, at, x: 0, z: 0, path: [], to: null, state: role === 'staff' ? 'idle' : 'waiting', patience: 1, drain: 0.01, need: null, serviceUntil: null, price: 0, paid: false, ...o };
}
export function makePeople(): Record<string, Person> {
  const L: Person[] = [
    // The team
    P('andre', 'Andre', 'staff', 'hair2-pro', { skin: SK.deep, hair: '#0f0c0a', hs: 'fade', outfit: TOP.a, male: true }, { job: 'Stylist', state: 'busy' }),
    P('mei', 'Mei', 'staff', 'hair3-pro', { skin: SK.light, hair: '#121010', hs: 'bob', outfit: TOP.d }, { job: 'Stylist', state: 'busy' }),
    P('diego', 'Diego', 'staff', 'barber-pro', { skin: SK.golden, hair: '#1a120c', hs: 'fade', outfit: TOP.c, male: true, beard: true }, { job: 'Barber', state: 'busy' }),
    P('jordan', 'Jordan', 'staff', 'wash1-pro', { skin: SK.fair, hair: '#3b2a1a', hs: 'curly', outfit: TOP.b }, { job: 'Assistant (wash)', state: 'busy' }),
    P('ana', 'Ana', 'staff', 'nail1-pro', { skin: SK.deep, hair: '#141010', hs: 'braids', outfit: TOP.b }, { job: 'Nail tech', state: 'busy' }),
    P('jess', 'Jess', 'staff', 'nail2-pro', { skin: SK.light, hair: '#1a1410', hs: 'bob', outfit: TOP.a }, { job: 'Nail tech', state: 'busy' }),
    P('tia', 'Tia', 'staff', 'nail3-pro', { skin: SK.golden, hair: '#3b2414', hs: 'long', outfit: TOP.c }, { job: 'Nail tech (free until 11:00)' }),
    P('amira', 'Amira', 'staff', 'pedi1-pro', { skin: SK.olive, hs: 'hijab', scarf: '#6b4f7a', outfit: TOP.b }, { job: 'Pedicurist', state: 'busy' }),
    P('hana', 'Hana', 'staff', 'facial-pro', { skin: SK.brown, hair: '#120d0a', hs: 'bun', outfit: TOP.a }, { job: 'Esthetician', state: 'busy' }),
    P('leah', 'Leah', 'staff', 'lash-pro', { skin: SK.tan, hair: '#1a1410', hs: 'long', outfit: TOP.d }, { job: 'Lash and brow artist', state: 'busy' }),
    P('zoe', 'Zoe', 'staff', 'desk', { skin: SK.fair, hair: '#a4482a', hs: 'bun', outfit: TOP.c }, { job: 'Front desk' }),
    // Clients in services
    P('priya', 'Priya', 'client', 'hair2', { skin: SK.light, hair: '#5a3a22', hs: 'long', outfit: '#e9d9c8', legs: '#3b4a63', foils: true }, { state: 'service', serviceUntil: 28, price: 185, provider: 'andre', drain: 0.004 }),
    P('grace', 'Grace', 'client', 'hair3', { skin: SK.brown, hair: '#bdb8b2', hs: 'gray', outfit: '#7aa6c2', legs: '#4a4a52', glasses: true }, { state: 'service', serviceUntil: 22, price: 95, provider: 'mei', drain: 0.004 }),
    P('sam', 'Sam', 'client', 'barber', { skin: SK.fair, hair: '#6b4a2b', hs: 'fade', outfit: '#5d7d5a', legs: '#2f3340', male: true, beard: true }, { state: 'service', serviceUntil: 30, price: 45, provider: 'diego', drain: 0.004 }),
    P('lena', 'Lena', 'client', 'wash1', { skin: SK.tan, hair: '#2b1a10', hs: 'long', outfit: '#e2a63c', legs: '#3a3f4a' }, { state: 'service', serviceUntil: 34, price: 55, provider: 'jordan', drain: 0.004 }),
    P('rosa', 'Rosa', 'client', 'nail1', { skin: SK.fair, hair: '#cfcac4', hs: 'gray', outfit: '#8fb0d2', legs: '#3b4a63', glasses: true }, { state: 'service', serviceUntil: 26, price: 60, provider: 'ana', drain: 0.004 }),
    P('kim', 'Kim', 'client', 'nail2', { skin: SK.brown, hair: '#120d0a', hs: 'puff', outfit: '#e07a5f', legs: '#4a3b30' }, { state: 'service', serviceUntil: 40, price: 70, provider: 'jess', drain: 0.004 }),
    P('sofia', 'Sofia', 'client', 'pedi1', { skin: SK.olive, hs: 'hijab', scarf: '#d9b8a0', outfit: '#4f8a7a', legs: '#4f8a7a' }, { state: 'service', serviceUntil: 45, price: 75, provider: 'amira', drain: 0.004 }),
    P('dana', 'Dana', 'client', 'facial', { skin: SK.light, hair: '#0d0b0a', hs: 'long', outfit: '#9a6fb0', legs: '#2f2f3a' }, { state: 'service', serviceUntil: 50, price: 120, provider: 'hana', drain: 0.003 }),
    P('elle', 'Elle', 'client', 'lash', { skin: SK.fair, hair: '#d8b56a', hs: 'bun', outfit: '#ead2a6', legs: '#5b6b7b' }, { state: 'service', serviceUntil: 55, price: 140, provider: 'leah', drain: 0.003 }),
    // Waiting in the lounge
    P('carmen', 'Carmen', 'client', 'sofa1', { skin: SK.tan, hair: '#2b1a10', hs: 'curly', outfit: '#d9826b', legs: '#e8d9c8', build: 1.25 }, { bookedAt: 22, dur: 20, provider: 'mei', price: 65, patience: 0.8, drain: 0.008 }),
    P('theo', 'Theo', 'client', 'sofa3', { skin: SK.light, hair: '#111', hs: 'fade', outfit: '#5b7ea8', legs: '#2f3340', male: true }, { bookedAt: 30, dur: 25, provider: 'diego', price: 45, drain: 0.006 }),
    P('gia', 'Gia', 'client', 'armchair', { skin: SK.deep, hair: '#0e0a08', hs: 'locs', outfit: '#3d6fb0' }, { bookedAt: 62, dur: 40, provider: 'andre', price: 160, patience: 0.8, drain: 0.004 }),
    // Maya's first client, at the desk already
    P('nina', 'Nina', 'client', 'desk-front1', { skin: SK.golden, hair: '#2a1a12', hs: 'long', outfit: '#c97a92' }, { bookedAt: 30, dur: 45, provider: 'maya', price: 65, patience: 0.85, drain: 0.01 }),
  ];
  return Object.fromEntries(L.map((p) => [p.id, p]));
}
// Arrivals later in the shift
const LATER: Record<string, () => Person> = {
  marcus: () => P('marcus', 'Marcus', 'client', 'door', { skin: SK.brown, hair: '#111', hs: 'fade', outfit: '#6d9a7e', legs: '#3a3f4a', male: true, beard: true, wheelchair: true }, { bookedAt: 90, provider: 'diego', price: 45, drain: 0.008, need: 'check_in' }),
  ben: () => P('ben', 'Ben', 'client', 'door2', { skin: SK.tan, hair: '#1a120c', hs: 'fade', outfit: '#c9a24a', legs: '#2f3340', male: true }, { price: 40, drain: 0.012, need: 'walk_in' }),
  olivia: () => P('olivia', 'Olivia', 'client', 'door', { skin: SK.deep, hair: '#120d0a', hs: 'afro', outfit: '#b5838d', legs: '#2f2f3a' }, { bookedAt: 45, dur: 35, provider: 'mei', price: 90, drain: 0.012, need: 'check_in' }),
};

// ── Paths: people walk along the aisles, not through furniture ─────────
const AISLE_Z = [5.6, 12.0], AISLE_X = [11.0, 21.4];
export function route(ax: number, az: number, bx: number, bz: number) {
  const near = (z: number) => (z < 5.6 ? 5.6 : z > 12 ? 12 : Math.abs(z - 5.6) < Math.abs(z - 12) ? 5.6 : 12);
  const za = near(az), zb = near(bz), pts: { x: number; z: number }[] = [{ x: ax, z: za }];
  if (za !== zb) { const cx = AISLE_X.reduce((b, x) => (Math.abs(x - (ax + bx) / 2) < Math.abs(b - (ax + bx) / 2) ? x : b)); pts.push({ x: cx, z: za }, { x: cx, z: zb }); }
  pts.push({ x: bx, z: zb }, { x: bx, z: bz });
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
}
const SPEED = 4.5;   // aisle units per game minute

// ── Setup ────────────────────────────────────────────────────────────
export const PRACTICE_TENANT = { name: 'Opal Salon', bookingPolicies: { grace: { late_arrival: { enabled: true, allowance: 1, periodMonths: 6, permits: 'extend_window', extendMinutes: 10 } } } };
export function newShift(): State {
  const spots = makeSpots(), people = makePeople();
  for (const p of Object.values(people)) { const s = p.at ? spots[p.at] : null; if (s) { p.x = s.x; p.z = s.z; } }
  const dayStart = Date.parse('2026-10-17T14:30:00Z');   // Saturday 10:30 AM in New York
  return { t: 0, end: 90, tz: 'America/New_York', dayStart, spots, people, open: [], prompts: [], log: [{ t: 0, text: 'Saturday, 10:30 AM. The salon is busy and the lounge is filling up.' }],
    texts: [], coach: [], fired: {}, flags: {}, takings: 0, onTime: { ok: 0, late: 0 }, overload: 0, policy: 0, ended: false };
}

// ── Helpers ──────────────────────────────────────────────────────────
export const moodOf = (p: Person): Mood => (p.patience > 0.6 ? 'ok' : p.patience > 0.3 ? 'warn' : 'bad');
const occupant = (s: State, spotId: string) => Object.values(s.people).find((p) => (p.at === spotId || p.to === spotId) && p.state !== 'gone');
export const freeSpots = (s: State, role: 'client' | 'staff', kinds?: SpotKind[]) => Object.values(s.spots).filter((sp) => sp.role === role && (!kinds || kinds.includes(sp.kind)) && !occupant(s, sp.id));
const say = (s: State, text: string, tone?: Line['tone']) => s.log.push({ t: s.t, text, tone });
const text = (s: State, to: string, body: string) => s.texts.push({ t: s.t, to, body });
const ms = (s: State, t: number) => s.dayStart + t * 60000;

/** Send someone to a spot (they walk there along the aisles). */
export function moveTo(s: State, id: string, spotId: string): { ok: boolean; error?: string } {
  const p = s.people[id], sp = s.spots[spotId];
  if (!p || !sp) return { ok: false, error: 'Not found.' };
  if (p.state === 'gone') return { ok: false, error: `${p.name} has left.` };
  if (sp.role !== p.role && !(p.role === 'staff' && sp.role === 'client' && sp.kind === 'lounge')) return { ok: false, error: p.role === 'client' ? 'That’s a place for the team.' : 'That’s a place for clients.' };
  if (p.look.wheelchair && sp.pose !== 'stand' && !sp.accessible && !['hair', 'barber', 'desk', 'door'].includes(sp.kind)) return { ok: false, error: `${sp.label} isn’t step-free. Try the step-free spot in the lounge.` };
  const o = occupant(s, spotId); if (o && o.id !== id) return { ok: false, error: `${o.name} is there.` };
  if (p.state === 'service') return { ok: false, error: `${p.name} is in the middle of a service.` };
  p.path = route(p.x, p.z, sp.x, sp.z); p.to = spotId; p.at = null;
  if (p.role === 'staff' && p.state !== 'away') p.state = 'walking'; else if (p.role === 'client') p.state = 'walking';
  s.prompts = s.prompts.filter((q) => q.personId !== id);
  return { ok: true };
}

/** What can be done with this person right now (shown next to them when tapped). */
export function actionsFor(s: State, id: string): { id: string; label: string; primary?: boolean }[] {
  const p = s.people[id]; if (!p || p.state === 'gone') return [];
  const out: { id: string; label: string; primary?: boolean }[] = [];
  if (p.need === 'water') out.push({ id: 'serve', label: 'Bring her water', primary: true });
  if (p.need === 'check_in') out.push({ id: 'check_in', label: 'Check in', primary: true });
  if (p.need === 'walk_in') out.push({ id: 'walk_in', label: 'Help this walk-in', primary: true });
  if (p.state !== 'service' && p.state !== 'paying') out.push({ id: 'move', label: p.role === 'staff' ? 'Send somewhere…' : 'Seat them somewhere…' });
  if (p.role === 'staff' && p.state === 'idle' && p.at !== 'desk') out.push({ id: 'cover_desk', label: 'Cover the front desk' });
  return out;
}

/** Who on the team is free to help (closest first). */
export function freeTeam(s: State, near?: { x: number; z: number }) {
  return Object.values(s.people).filter((p) => p.role === 'staff' && p.state === 'idle').sort((a, b) => (near ? Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z) : 0));
}

/** A team member brings a lounge order to a client, then goes back. */
export function serve(s: State, staffId: string, clientId: string) {
  const st = s.people[staffId], c = s.people[clientId]; if (!st || !c || st.state !== 'idle') return { ok: false, error: 'They’re busy right now.' };
  st.returnTo = st.at; st.path = route(st.x, st.z, c.x + 0.8, c.z + 0.9); st.to = null; st.at = null; st.state = 'walking'; st.afterArrive = `serve:${clientId}`;
  if (st.returnTo === 'desk') s.flags.deskEmptyFrom = s.t;
  say(s, `${st.name} is bringing ${c.name} her water.`);
  return { ok: true };
}

/** The front desk checks someone in (the desk must be staffed). */
export function checkIn(s: State, id: string) {
  const c = s.people[id]; const desk = Object.values(s.people).find((p) => p.at === 'desk' && p.state === 'idle');
  if (!desk) return { ok: false, error: 'Nobody is at the front desk. Send someone there first.' };
  c.need = null; c.patience = Math.min(1, c.patience + 0.15); say(s, `${desk.name} checked in ${c.name}.`, 'ok');
  s.prompts.push({ personId: id, text: c.look.wheelchair ? 'Seat Marcus in the step-free lounge spot' : `Seat ${c.name} in the lounge`, to: c.look.wheelchair ? 'lounge-open' : undefined });
  return { ok: true };
}

// ── Decisions ────────────────────────────────────────────────────────
function openDecision(s: State, d: Omit<Decision, 'at'>) { s.open.push({ ...d, at: s.t }); }
export function decide(s: State, decisionId: string, optionId: string) {
  const d = s.open.find((x) => x.id === decisionId); if (!d) return { ok: false };
  s.open = s.open.filter((x) => x.id !== decisionId);
  const R = RESOLVE[decisionId]; if (R) R(s, optionId);
  return { ok: true };
}
const RESOLVE: Record<string, (s: State, o: string) => void> = {
  callout(s, o) {
    s.flags.callout = o;
    const start = ms(s, 30);   // Nina's 11:00
    const later = [{ name: 'Ms. Patel', at: ms(s, 150) }, { name: 'Jada', at: ms(s, 210) }, { name: 'Robin', at: ms(s, 270) }];
    if (o === 'choose') {
      // The app's way: today's clients choose; anyone due within 3 hours goes straight to the desk (chooseByFor = 0).
      const nowMs = ms(s, s.t); const call: string[] = [];
      for (const c of later) { const by = chooseByFor(c.at, nowMs, s.tz, 3); const first = c.name.replace('Ms. ', '');
        if (by) text(s, c.name, `Hi ${first}, we’re so sorry: Maya is unwell today. You can pick one of her next times, see someone else today, or join the waitlist here: [link]. Please choose by ${clock((by - s.dayStart) / 60000)}.`);
        else call.push(c.name); }
      text(s, 'Nina', 'Hi Nina, we’re so sorry: Maya is unwell today. Tia can see you at 11:00 instead, or you can pick one of Maya’s next times here: [link]');
      if (call.length) say(s, `Too soon to wait for a reply, so they go on the desk’s call list: ${call.join(' and ')}.`, 'warn');
      s.flags.callList = call;
      s.prompts.push({ personId: 'nina', text: 'Nina chose Tia at 11:00. Walk her to Tia’s nail table.', to: 'nail3' });
      s.people.nina.provider = 'tia'; s.people.nina.patience = Math.min(1, s.people.nina.patience + 0.2);
      s.coach.push(`You let Maya’s clients choose. Nobody was moved without being asked; visits too soon to wait (${call.join(', ') || 'none'}) went to the call list, the same rule the app uses.`); s.policy += 2;
    } else if (o === 'move_all') {
      s.people.nina.provider = 'tia'; s.flags.tiaOverbooked = true;
      text(s, 'Nina', 'Hi Nina, Maya is unwell today, so we’ve moved you to Tia at 11:00.');
      for (const c of later) text(s, c.name, `Hi ${c.name.replace('Ms. ', '')}, Maya is unwell today, so we’ve moved your appointment to Tia.`);
      s.prompts.push({ personId: 'nina', text: 'Walk Nina to Tia’s nail table.', to: 'nail3' });
      s.coach.push('Moving everyone to Tia was quick, but nobody was asked, and Tia’s afternoon is now double-booked. Letting clients choose avoids both.');
    } else {
      s.flags.calling = true; const z = s.people.zoe; s.flags.zoeBack = s.t + 25;
      moveTo(s, 'zoe', 'office'); z.state = 'walking'; z.afterArrive = 'away';
      s.people.nina.provider = 'tia'; s.prompts.push({ personId: 'nina', text: 'Zoe will call the others. Walk Nina to Tia’s nail table.', to: 'nail3' });
      s.coach.push('Calling each client is personal, but the front desk was empty for 25 minutes. Texting choices first, then calling only those who don’t answer, keeps the desk covered.');
      s.policy += 1;
    }
  },
  late(s, o) {
    const g = graceRemaining(PRACTICE_TENANT, 'late_arrival', [], { clientId: 'olivia' }, new Date(ms(s, s.t)));
    if (o === 'hold') {
      s.flags.oliviaLate = 15; s.flags.meiBehind = (s.flags.meiBehind || 0) + 5; s.policy += g.remaining > 0 ? 1 : 0;
      text(s, 'Olivia', `Thank you for letting us know, Olivia. We’ll hold your spot until ${clock(25 + 15)}. Drive safely.`);
      s.coach.push(`You used Olivia’s courtesy (${graceRule(PRACTICE_TENANT, 'late_arrival').extendMinutes} extra minutes, ${g.remaining} left this period) and held her spot. Mei runs about 5 minutes behind.`);
    } else if (o === 'shorten') {
      s.flags.oliviaLate = 15; s.flags.oliviaShort = true; s.policy += 2; s.flags.oliviaDur = 20;
      text(s, 'Olivia', 'Thank you for letting us know, Olivia. We can still see you; Mei will do a quicker style so the next client isn’t kept waiting. Is that okay?');
      s.coach.push('Offering a shorter service kept Mei on time and still looked after Olivia. That’s the app’s late arrival choice.');
    } else {
      s.flags.oliviaMoved = true; s.policy += 1; s.takings -= 0;
      text(s, 'Olivia', 'Thank you for letting us know, Olivia. Mei is fully booked this morning, but she has 1:00 PM free. Would you like it? Reply YES and it’s yours.');
      s.coach.push('Moving Olivia kept everyone on time, but the 11:15 slot now sits empty. A waitlist offer could fill it.');
    }
  },
  walkin(s, o) {
    const b = s.people.ben;
    if (o === 'queue') { b.need = null; s.prompts.push({ personId: 'ben', text: 'Seat Ben in the lounge. Diego is free after Theo.' }); b.provider = 'diego'; b.bookedAt = 55; b.dur = 25; text(s, 'Ben', 'You’re on the list for Diego, about 25 minutes. Have a seat in the lounge.'); s.coach.push('You fitted the walk-in after Theo instead of squeezing him in. Diego stays on time.'); s.policy += 1; }
    else if (o === 'book') { b.need = null; b.state = 'walking'; b.path = route(b.x, b.z, 21.6, 18.6); b.afterArrive = 'leave'; s.takings += 0; s.flags.benBooked = true; s.coach.push('Booking Ben for later kept the morning calm; the visit happens another day.'); }
    else { b.need = null; b.patience = 0.2; b.state = 'walking'; b.path = route(b.x, b.z, 21.6, 18.6); b.afterArrive = 'leave'; s.coach.push('Turning a walk-in away loses the visit. Offering the next free time keeps him.'); }
  },
  wash(s, o) {
    const pr = s.people.priya;
    if (o === 'andre') { s.flags.andreWashes = true; pr.state = 'waiting'; moveTo(s, 'priya', 'wash2'); moveTo(s, 'andre', 'wash2-pro'); pr.afterArrive = 'wash'; s.flags.andreDelay = 8;
      s.coach.push('Andre rinsed Priya himself, so her color came off on time and he stayed on schedule.'); }
    else { s.flags.priyaWait = true; pr.patience -= 0.2; s.prompts.push({ personId: 'priya', text: 'When Lena leaves, walk Priya to Jordan’s wash bowl.', to: 'wash1' }); pr.state = 'waiting'; pr.serviceUntil = null;
      s.coach.push('Priya waited for Jordan. Color left on too long can over-process; when the wash bar is busy, the stylist can rinse.'); }
  },
};

// ── The shift's moments (minutes after 10:30) ─────────────────────────
const SCRIPT: { t: number; id: string; run: (s: State) => void }[] = [
  { t: 2, id: 'water', run: (s) => { const g = s.people.gia; g.need = 'water'; g.drain = 0.02; say(s, 'Gia asked for sparkling water. Nobody has it yet.', 'warn'); } },
  { t: 6, id: 'callout', run: (s) => openDecision(s, { id: 'callout', pause: true, who: ['nina', 'tia'], title: 'Maya just called out sick. 4 clients are booked with her today.',
    body: 'Nina is first, at 11:00, and she’s already at the desk asking Zoe. Tia is free until 11:00.',
    options: [
      { id: 'choose', label: 'Let clients choose (the app’s way)', what: 'Each client gets a text with Maya’s next free times, a switch to someone free today, or the waitlist. Visits too soon to wait go to the call list.', tags: [['Calm', 'green'], ['Nina still needs you now', 'amber']] },
      { id: 'move_all', label: 'Move everyone to Tia', what: 'Fast, but nobody was asked. Tia is already booked from 1:00.', tags: [['Runs late after 1 PM', 'amber'], ['Some clients unhappy', 'red']] },
      { id: 'call', label: 'Call each client yourself', what: 'Personal, but Zoe is away from the desk for about 25 minutes.', tags: [['Desk unattended', 'red'], ['Clients feel cared for', 'green']] }] }) },
  { t: 14, id: 'late', run: (s) => {
    const body = 'running 15 minutes late, so sorry!!';
    const read = intentByWords(body); s.flags.lateIntent = read.intent;
    openDecision(s, { id: 'late', pause: true, who: ['mei'], title: 'Olivia texted: “running 15 minutes late, so sorry!!”',
      body: `Read as: ${read.intent === 'late' ? 'running late' : read.intent}. Her 11:15 blowout is with Mei, who has Carmen next. Olivia has one late arrival courtesy left (${graceRule(PRACTICE_TENANT, 'late_arrival').extendMinutes} extra minutes).`,
      options: [
        { id: 'hold', label: 'Use her courtesy and hold the spot', what: 'She keeps her full service. Mei runs a little behind.', tags: [['Olivia happy', 'green'], ['Mei 5 min behind', 'amber']] },
        { id: 'shorten', label: 'Offer a quicker style', what: 'She keeps the visit; Mei stays on time.', tags: [['On time', 'green'], ['Her choice', 'green']] },
        { id: 'move', label: 'Offer a later time', what: 'Mei has 1:00 PM free.', tags: [['On time', 'green'], ['Empty 11:15 slot', 'amber']] }] }); } },
  { t: 40, id: 'olivia', run: (s) => { if (s.flags.oliviaMoved || !s.fired.late) return; s.people.olivia = LATER.olivia(); const o = s.people.olivia; const d = s.spots.door; o.x = d.x + 0.6; o.z = d.z; say(s, 'Olivia arrived for her blowout with Mei.'); s.prompts.push({ personId: 'olivia', text: 'Check Olivia in at the desk' }); } },
  { t: 18, id: 'marcus', run: (s) => { s.people.marcus = LATER.marcus(); const m = s.people.marcus; const d = s.spots.door; m.x = d.x; m.z = d.z; say(s, 'Marcus arrived early for his 12:00 haircut with Diego.'); s.prompts.push({ personId: 'marcus', text: 'Check Marcus in at the desk' }); } },
  { t: 26, id: 'walkin', run: (s) => { s.people.ben = LATER.ben(); const b = s.people.ben; const d = s.spots.door2; b.x = d.x; b.z = d.z;
    openDecision(s, { id: 'walkin', pause: false, who: ['ben', 'diego'], title: 'A walk-in wants a fade: Ben.', body: 'Diego finishes Sam at 11:00, then has Theo until about 11:25. Nobody else does fades.',
      options: [
        { id: 'queue', label: 'Fit him in after Theo', what: 'About a 25 minute wait in the lounge.', tags: [['Keeps the visit', 'green'], ['A wait', 'amber']] },
        { id: 'book', label: 'Book him for later today', what: 'He comes back at 2:30.', tags: [['Calm', 'green']] },
        { id: 'away', label: 'Say you’re fully booked', what: 'He leaves.', tags: [['Lost visit', 'red']] }] }); } },
  { t: 28, id: 'wash', run: (s) => { const pr = s.people.priya; if (pr.state !== 'service') return; pr.state = 'waiting'; pr.serviceUntil = null;
    openDecision(s, { id: 'wash', pause: true, who: ['priya', 'andre', 'jordan'], title: 'Priya’s color is ready to rinse, but the wash bar is busy.', body: 'Jordan is busy with Lena’s treatment wash until about 11:05. Andre has Gia at 11:30.',
      options: [
        { id: 'andre', label: 'Andre rinses her himself', what: 'Her color comes off on time and Andre stays on schedule for Gia.', tags: [['Color safe', 'green'], ['On time', 'green']] },
        { id: 'wait', label: 'Wait for Jordan', what: 'About 6 minutes. Color can over-process, and Andre falls behind for Gia.', tags: [['Risk to her color', 'red'], ['Gia waits', 'amber']] }] }); } },
];

// ── Time ─────────────────────────────────────────────────────────────
export function paused(s: State) { return s.ended || s.open.some((d) => d.pause); }
/** Move time forward by `dt` game minutes. */
export function advance(s: State, dt: number) {
  if (paused(s) || dt <= 0) return;
  const t1 = Math.min(s.end, s.t + dt);
  for (const e of SCRIPT) if (!s.fired[e.id] && e.t <= t1) { s.fired[e.id] = true; s.t = e.t; e.run(s); if (paused(s)) return; }
  const step = t1 - s.t; s.t = t1;
  if (s.flags.zoeBack && s.t >= s.flags.zoeBack && s.people.zoe.at === 'office') { s.flags.zoeBack = null; moveTo(s, 'zoe', 'desk'); say(s, 'Zoe finished the calls and is heading back to the desk.'); }
  for (const p of Object.values(s.people)) tickPerson(s, p, step);
  if (!Object.values(s.people).some((p) => p.at === 'desk' && p.state === 'idle')) s.flags.deskEmptyMin = (s.flags.deskEmptyMin || 0) + step;
  if (s.t >= s.end) finish(s);
}
function arrive(s: State, p: Person) {
  const sp = p.to ? s.spots[p.to] : null; p.path = [];
  if (sp) { p.at = sp.id; p.x = sp.x; p.z = sp.z; p.to = null; }
  const after = p.afterArrive; p.afterArrive = null;
  if (after?.startsWith('serve:')) {
    const c = s.people[after.slice(6)]; c.need = null; c.drain = 0.006; c.patience = Math.min(1, c.patience + 0.35); say(s, `${c.name} has her water. Thank you, ${p.name}.`, 'ok');
    p.state = 'walking'; const back = p.returnTo && s.spots[p.returnTo] ? p.returnTo : 'desk'; p.returnTo = null; p.path = route(p.x, p.z, s.spots[back].x, s.spots[back].z); p.to = back; return;
  }
  if (after === 'leave' || after === 'pay-leave') { p.state = 'gone'; p.at = null; return; }
  if (after === 'away') { p.state = 'away'; return; }
  if (p.role === 'staff') { p.state = p.at === 'desk' || !isWorkSpot(p.at) ? 'idle' : 'idle'; if (p.at === 'desk' && s.flags.deskEmptyFrom != null) s.flags.deskEmptyFrom = null; tryStart(s); return; }
  if (sp?.kind === 'desk' && p.paid) return;
  p.state = 'waiting'; tryStart(s);
  if (p.state === 'waiting' && p.provider && s.people[p.provider]?.state === 'idle' && sp && ['lounge', 'desk'].includes(sp.kind)) nextFor(s, s.people[p.provider]);
}
const isWorkSpot = (id: string | null) => !!id && id.endsWith('-pro');
/** Start any service whose client and provider are both in place. */
function tryStart(s: State) {
  for (const c of Object.values(s.people)) {
    if (c.role !== 'client' || c.state !== 'waiting' || !c.at) continue;
    const sp = s.spots[c.at]; if (!sp || ['lounge', 'desk', 'door'].includes(sp.kind)) continue;
    const pro = Object.values(s.people).find((p) => p.role === 'staff' && p.at === `${sp.id}-pro` && p.state === 'idle'); if (!pro) continue;
    pro.state = 'busy'; c.state = 'service'; c.startedAt = s.t; c.provider = pro.id;
    const dur = sp.kind === 'wash' ? 8 : c.id === 'olivia' && s.flags.oliviaDur ? s.flags.oliviaDur : c.id === 'priya' ? 25 : c.dur ?? (sp.kind === 'nail' ? 45 : 30);
    c.serviceUntil = s.t + dur + (sp.kind === 'nail' && s.flags.tiaOverbooked ? 10 : 0);
    if (c.bookedAt != null) { if (s.t - c.bookedAt <= 10) s.onTime.ok++; else s.onTime.late++; }
    say(s, `${pro.name} started with ${c.name}.`, 'ok');
  }
}
function tickPerson(s: State, p: Person, dt: number) {
  if (p.state === 'gone') return;
  if (p.path.length) {
    let go = SPEED * dt;
    while (go > 0 && p.path.length) { const n = p.path[0], d = Math.hypot(n.x - p.x, n.z - p.z); if (d <= go) { p.x = n.x; p.z = n.z; go -= d; p.path.shift(); } else { p.x += ((n.x - p.x) / d) * go; p.z += ((n.z - p.z) / d) * go; go = 0; } }
    if (!p.path.length) arrive(s, p);
    return;
  }
  if (p.role === 'client') {
    if (p.state === 'service' && p.serviceUntil != null && s.t >= p.serviceUntil) finishService(s, p);
    else if (p.state === 'waiting') {
      let drain = p.drain; if (p.need === 'check_in' && !Object.values(s.people).some((x) => x.at === 'desk' && x.state === 'idle')) drain *= 1.8;
      if (p.bookedAt != null && s.t > p.bookedAt) drain *= 1.6;
      p.patience = Math.max(0, p.patience - drain * dt);
    } else if (p.state === 'service') p.patience = Math.min(1, p.patience + 0.002 * dt);
  }
}
function finishService(s: State, c: Person) {
  const pro = c.provider ? s.people[c.provider] : null; if (pro) pro.state = 'idle';
  c.serviceUntil = null; c.at && (c.at = c.at);
  if (c.id === 'priya' && c.at?.startsWith('wash')) {   // rinsed: back to Andre's chair to finish
    const from = c.at; c.at = null; c.to = 'hair2'; c.path = route(c.x, c.z, s.spots.hair2.x, s.spots.hair2.z); c.state = 'walking'; c.provider = 'andre'; c.bookedAt = undefined;
    if (s.flags.andreWashes) moveTo(s, 'andre', 'hair2-pro'); else if (pro) nextFor(s, pro);
    say(s, `Priya’s color is rinsed (${from === 'wash1' ? 'Jordan' : 'Andre'}).`, 'ok'); return;
  }
  s.takings += c.price; c.paid = true; say(s, `${c.name} is done${c.price ? `: $${c.price}` : ''}. ${pro ? `${pro.name} is free.` : ''}`, 'ok');
  c.state = 'walking'; c.path = route(c.x, c.z, s.spots.door.x, s.spots.door.z + 1); c.at = null; c.to = null; c.afterArrive = 'pay-leave';
  if (pro) nextFor(s, pro);
}
/** A provider is free: prompt the player to bring their next client over. */
function nextFor(s: State, pro: Person) {
  const base = pro.at?.replace(/-pro$/, ''); if (!base || !s.spots[base]) return;
  const next = Object.values(s.people).filter((c) => c.role === 'client' && c.provider === pro.id && c.state === 'waiting' && !c.need && c.at && ['lounge', 'desk', 'door'].includes(s.spots[c.at].kind))
    .sort((a, b) => (a.bookedAt ?? 999) - (b.bookedAt ?? 999))[0];
  if (next && !s.prompts.some((q) => q.personId === next.id)) s.prompts.push({ personId: next.id, text: `${pro.name} is free. Walk ${next.name} to ${s.spots[base].label.toLowerCase()}.`, to: base });
}
function finish(s: State) {
  s.ended = true;
  s.overload = (s.flags.tiaOverbooked ? 1 : 0) + (s.flags.andreDelay ? 0 : 0);
  if (s.flags.deskEmptyMin > 10) s.coach.push(`The front desk was empty for ${Math.round(s.flags.deskEmptyMin)} minutes. Arrivals waited at the door.`);
  if (s.people.gia?.need === 'water') s.coach.push('Gia never got her water. In the app, lounge orders alert whoever is free between clients.');
}

// ── The end-of-shift report ───────────────────────────────────────────
export function report(s: State) {
  const clients = Object.values(s.people).filter((p) => p.role === 'client');
  const happy = Math.round((clients.reduce((a, c) => a + Math.max(0, Math.min(1, c.patience)), 0) / Math.max(1, clients.length)) * 100);
  const onTime = Math.round((s.onTime.ok / Math.max(1, s.onTime.ok + s.onTime.late)) * 100);
  const unhappy = clients.filter((c) => moodOf(c) === 'bad').map((c) => c.name);
  const fair = s.flags.tiaOverbooked ? 'Stretched' : s.flags.andreWashes ? 'Good' : 'Good';
  const policy = s.policy >= 4 ? 'Great' : s.policy >= 2 ? 'Good' : 'Needs work';
  const stars = (happy >= 85 ? 1 : 0) + (onTime >= 80 ? 1 : 0) + (policy === 'Great' ? 1 : 0) + (fair === 'Good' ? 0 : -0) ;
  return { happy, onTime, takings: s.takings, unhappy, fair, policy, stars: Math.max(1, stars), coach: s.coach.slice(-4) };
}
