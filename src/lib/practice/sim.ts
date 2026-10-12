// src/lib/practice/sim.ts — PRACTICE A SHIFT: THE GAME'S STATE AND RULES (no drawing, no database).
//
// You run the front of a full-service salon. Clients arrive (check them in), wait (seat them), get served, then pay at
// the desk (take payment, suggest aftercare, rebook). Moments come up (a drink, a late text, a provider calling out)
// as icons, never as pop-ups: you open them when you're ready, and time pauses while you think. Ignore one too long
// and the team handles it their way. Where ClarityFlow already has the rule, the game uses it: the callout choose-by
// time (lib/callout-timing), reading a client's text (lib/text-intent), the late-arrival courtesy (lib/grace).
// Nothing here touches real data. Everything is in one object, and the same shift always plays the same way.
import { chooseByFor } from '@/lib/callout-timing';
import { intentByWords } from '@/lib/text-intent';
import { graceRule, graceRemaining } from '@/lib/grace';

export type Mood = 'ok' | 'warn' | 'bad';
export type Pose = 'sit' | 'stand' | 'lie' | 'chair';
export type SpotKind = 'hair' | 'barber' | 'wash' | 'nail' | 'pedi' | 'facial' | 'lash' | 'lounge' | 'desk' | 'door' | 'office' | 'street';
export type Spot = { id: string; kind: SpotKind; role: 'client' | 'staff'; x: number; z: number; seat: number; ry: number; pose: Pose; label: string; tilt?: number; accessible?: boolean };
export type Look = { skin: string; hair?: string; hs: string; outfit: string; legs?: string; scarf?: string; male?: boolean; beard?: boolean; glasses?: boolean; build?: number; foils?: boolean; wheelchair?: boolean };
export type NeedKind = 'check_in' | 'seat' | 'pay' | 'drink' | 'decide';
export type Need = { kind: NeedKind; since: number; to?: string; decision?: string; item?: string; urgent?: boolean };
export type Person = {
  id: string; name: string; role: 'staff' | 'client'; look: Look; job?: string;
  at: string | null; x: number; z: number; path: { x: number; z: number }[]; to: string | null;
  state: 'idle' | 'service' | 'waiting' | 'walking' | 'busy' | 'away' | 'gone';
  patience: number; drain: number; need: Need | null; serviceUntil: number | null; price: number; paid: boolean;
  service?: string; bookedAt?: number; dur?: number; startedAt?: number | null; provider?: string | null;
  afterArrive?: string | null; returnTo?: string | null; checkedIn?: boolean; done?: boolean; blocked?: boolean;
};
export type Option = { id: string; label: string; what: string; tags: [string, 'green' | 'amber' | 'red'][] };
export type Decision = { id: string; title: string; body: string; who: string[]; options: Option[]; at: number; deadline: number; fallback: string; fallbackText: string };
export type Line = { t: number; text: string; tone?: 'ok' | 'warn' | 'bad' };
export type Text = { t: number; to: string; body: string };
export type Pop = { id: number; pid: string; text: string; tone: 'ok' | 'gold' | 'xp' | 'bad'; t: number };
export type Goal = { id: 'takings' | 'onTime' | 'happy' | 'rebooked'; label: string; target: number };
export type ShiftId = 'opening' | 'rush';
export type State = {
  shift: ShiftId; title: string; t: number; end: number; startMin: number; tz: string; dayStart: number;
  spots: Record<string, Spot>; people: Record<string, Person>; decisions: Record<string, Decision>;
  log: Line[]; texts: Text[]; coach: string[]; pops: Pop[]; sfx: string[]; popN: number;
  fired: Record<string, boolean>; flags: Record<string, any>; takings: number; tips: number; retail: number; rebooked: number; exactChange: number;
  onTime: { ok: number; late: number }; policy: number; xp: number; best: { text: string; score: number } | null;
  goals: Goal[]; tutorial: number; hold: boolean; ended: boolean;
};

// ── Clock ────────────────────────────────────────────────────────────
export const clockAt = (startMin: number, t: number) => { const m = Math.round(startMin + t); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const clock = (s: State | number, t?: number) => (typeof s === 'number' ? clockAt(630, s) : clockAt(s.startMin, t ?? s.t));

// ── The salon ────────────────────────────────────────────────────────
const SP = (id: string, kind: SpotKind, role: 'client' | 'staff', x: number, z: number, o: Partial<Spot> = {}): Spot => ({ id, kind, role, x, z, seat: 0, ry: 0, pose: 'stand', label: id, ...o });
const PI = Math.PI;
export function makeSpots(): Record<string, Spot> {
  const L: Spot[] = [];
  [2.0, 5.4, 8.8, 12.2].forEach((x, i) => {
    const b = i === 3 ? 'barber' : `hair${i + 1}`; const kind: SpotKind = i === 3 ? 'barber' : 'hair';
    L.push(SP(b, kind, 'client', x + 1.4, 1.9, { seat: 0.68, ry: PI, pose: 'sit', label: i === 3 ? 'Barber chair' : `Hair chair ${i + 1}` }));
    L.push(SP(`${b}-pro`, kind, 'staff', x + 1.4, 3.0, { ry: PI, label: i === 3 ? 'Barber' : `Stylist ${i + 1}` }));
  });
  [5.4, 7.4, 9.4].forEach((z, i) => {
    L.push(SP(`wash${i + 1}`, 'wash', 'client', 2.75, z + 0.65, { seat: 0.62, ry: PI / 2, pose: 'lie', tilt: -1.15, label: `Wash bowl ${i + 1}` }));
    L.push(SP(`wash${i + 1}-pro`, 'wash', 'staff', 1.6, z + 1.5, { ry: -PI / 2, label: `Wash ${i + 1}` }));
  });
  [16.6, 20.8, 25.0].forEach((x, i) => {
    L.push(SP(`nail${i + 1}`, 'nail', 'client', x + 0.9, 4.65, { seat: 0.7, ry: PI, pose: 'sit', label: `Nail table ${i + 1}` }));
    L.push(SP(`nail${i + 1}-pro`, 'nail', 'staff', x + 1.3, 2.0, { seat: 0.65, pose: 'sit', label: `Nail tech ${i + 1}` }));
  });
  [1.0, 4.2, 7.4].forEach((x, i) => {
    L.push(SP(`pedi${i + 1}`, 'pedi', 'client', x + 0.95, 13.95, { seat: 1.0, pose: 'sit', label: `Pedicure chair ${i + 1}` }));
    L.push(SP(`pedi${i + 1}-pro`, 'pedi', 'staff', x + 0.95, 16.35, { seat: 0.4, ry: PI, pose: 'sit', label: `Pedicure tech ${i + 1}` }));
  });
  L.push(SP('facial', 'facial', 'client', 24.35, 9.75, { seat: 0.78, pose: 'lie', label: 'Facial bed' }), SP('facial-pro', 'facial', 'staff', 24.35, 7.05, { seat: 0.55, pose: 'sit', label: 'Esthetician' }));
  L.push(SP('lash', 'lash', 'client', 28.05, 9.75, { seat: 0.78, pose: 'lie', label: 'Lash bed' }), SP('lash-pro', 'lash', 'staff', 28.05, 7.05, { seat: 0.55, pose: 'sit', label: 'Lash artist' }));
  [[14.3, 9.05], [15.6, 9.05], [16.9, 9.05]].forEach(([x, z], i) => L.push(SP(`sofa${i + 1}`, 'lounge', 'client', x, z, { seat: 0.6, pose: 'sit', label: 'Lounge sofa' })));
  L.push(SP('armchair', 'lounge', 'client', 19.3, 9.2, { seat: 0.6, pose: 'sit', label: 'Lounge armchair' }));
  L.push(SP('lounge-open', 'lounge', 'client', 18.0, 11.0, { pose: 'chair', label: 'Lounge (step-free)', accessible: true }));
  L.push(SP('desk', 'desk', 'staff', 16.0, 13.4, { ry: PI, label: 'Front desk' }));
  L.push(SP('desk-front1', 'desk', 'client', 15.0, 16.2, { ry: PI, label: 'At the desk' }), SP('desk-front2', 'desk', 'client', 16.8, 16.3, { ry: PI, label: 'At the desk' }), SP('desk-front3', 'desk', 'client', 13.4, 16.1, { ry: PI, label: 'At the desk' }));
  L.push(SP('door', 'door', 'client', 21.0, 17.4, { ry: PI, label: 'Entrance' }), SP('door2', 'door', 'client', 22.3, 17.4, { ry: PI, label: 'Entrance' }), SP('door3', 'door', 'client', 19.7, 17.4, { ry: PI, label: 'Entrance' }));
  L.push(SP('street', 'street', 'client', 21.0, 22.0, { label: 'Outside' }));
  L.push(SP('office', 'office', 'staff', 28.6, 16.4, { ry: PI, label: 'Back office' }));
  return Object.fromEntries(L.map((s) => [s.id, s]));
}

// ── People ───────────────────────────────────────────────────────────
const SK = { deep: '#5a3825', brown: '#8d5a3b', tan: '#b07a52', olive: '#c69472', light: '#f0c9a6', fair: '#f6dcc6', golden: '#d9a679' };
const TOP = { a: '#f2ede6', b: '#e8c9c3', c: '#cfdccf', d: '#d9d3ea' };
function P(id: string, name: string, role: 'staff' | 'client', at: string | null, look: Look, o: Partial<Person> = {}): Person {
  return { id, name, role, look, at, x: 0, z: 0, path: [], to: null, state: role === 'staff' ? 'idle' : 'waiting', patience: 1, drain: 0.008, need: null, serviceUntil: null, price: 0, paid: false, ...o };
}
const TEAM = (): Person[] => [
  P('andre', 'Andre', 'staff', 'hair2-pro', { skin: SK.deep, hair: '#0f0c0a', hs: 'fade', outfit: TOP.a, male: true }, { job: 'Stylist' }),
  P('mei', 'Mei', 'staff', 'hair3-pro', { skin: SK.light, hair: '#121010', hs: 'bob', outfit: TOP.d }, { job: 'Stylist' }),
  P('diego', 'Diego', 'staff', 'barber-pro', { skin: SK.golden, hair: '#1a120c', hs: 'fade', outfit: TOP.c, male: true, beard: true }, { job: 'Barber' }),
  P('jordan', 'Jordan', 'staff', 'wash1-pro', { skin: SK.fair, hair: '#3b2a1a', hs: 'curly', outfit: TOP.b }, { job: 'Assistant (wash)' }),
  P('ana', 'Ana', 'staff', 'nail1-pro', { skin: SK.deep, hair: '#141010', hs: 'braids', outfit: TOP.b }, { job: 'Nail tech' }),
  P('jess', 'Jess', 'staff', 'nail2-pro', { skin: SK.light, hair: '#1a1410', hs: 'bob', outfit: TOP.a }, { job: 'Nail tech' }),
  P('tia', 'Tia', 'staff', 'nail3-pro', { skin: SK.golden, hair: '#3b2414', hs: 'long', outfit: TOP.c }, { job: 'Nail tech' }),
  P('amira', 'Amira', 'staff', 'pedi1-pro', { skin: SK.olive, hs: 'hijab', scarf: '#6b4f7a', outfit: TOP.b }, { job: 'Pedicurist' }),
  P('hana', 'Hana', 'staff', 'facial-pro', { skin: SK.brown, hair: '#120d0a', hs: 'bun', outfit: TOP.a }, { job: 'Esthetician' }),
  P('leah', 'Leah', 'staff', 'lash-pro', { skin: SK.tan, hair: '#1a1410', hs: 'long', outfit: TOP.d }, { job: 'Lash and brow artist' }),
  P('zoe', 'Zoe', 'staff', 'desk', { skin: SK.fair, hair: '#a4482a', hs: 'bun', outfit: TOP.c }, { job: 'Front desk' }),
];
// Clients: the look, the service, the price, and who they see.
const C: Record<string, () => Person> = {
  priya: () => P('priya', 'Priya', 'client', null, { skin: SK.light, hair: '#5a3a22', hs: 'long', outfit: '#e9d9c8', legs: '#3b4a63', foils: true }, { service: 'Color and cut', price: 185, provider: 'andre', dur: 40 }),
  grace: () => P('grace', 'Grace', 'client', null, { skin: SK.brown, hair: '#bdb8b2', hs: 'gray', outfit: '#7aa6c2', legs: '#4a4a52', glasses: true }, { service: 'Silk press', price: 95, provider: 'mei', dur: 30 }),
  sam: () => P('sam', 'Sam', 'client', null, { skin: SK.fair, hair: '#6b4a2b', hs: 'fade', outfit: '#5d7d5a', legs: '#2f3340', male: true, beard: true }, { service: 'Fade and beard', price: 45, provider: 'diego', dur: 25 }),
  lena: () => P('lena', 'Lena', 'client', null, { skin: SK.tan, hair: '#2b1a10', hs: 'long', outfit: '#e2a63c', legs: '#3a3f4a' }, { service: 'Treatment wash', price: 55, provider: 'jordan', dur: 25 }),
  rosa: () => P('rosa', 'Rosa', 'client', null, { skin: SK.fair, hair: '#cfcac4', hs: 'gray', outfit: '#8fb0d2', legs: '#3b4a63', glasses: true }, { service: 'Gel manicure', price: 60, provider: 'ana', dur: 35 }),
  kim: () => P('kim', 'Kim', 'client', null, { skin: SK.brown, hair: '#120d0a', hs: 'puff', outfit: '#e07a5f', legs: '#4a3b30' }, { service: 'Full set', price: 70, provider: 'jess', dur: 40 }),
  sofia: () => P('sofia', 'Sofia', 'client', null, { skin: SK.olive, hs: 'hijab', scarf: '#d9b8a0', outfit: '#4f8a7a', legs: '#4f8a7a' }, { service: 'Spa pedicure', price: 75, provider: 'amira', dur: 40 }),
  dana: () => P('dana', 'Dana', 'client', null, { skin: SK.light, hair: '#0d0b0a', hs: 'long', outfit: '#9a6fb0', legs: '#2f2f3a' }, { service: 'Facial', price: 120, provider: 'hana', dur: 45 }),
  elle: () => P('elle', 'Elle', 'client', null, { skin: SK.fair, hair: '#d8b56a', hs: 'bun', outfit: '#ead2a6', legs: '#5b6b7b' }, { service: 'Lash lift', price: 140, provider: 'leah', dur: 45 }),
  carmen: () => P('carmen', 'Carmen', 'client', null, { skin: SK.tan, hair: '#2b1a10', hs: 'curly', outfit: '#d9826b', legs: '#e8d9c8', build: 1.25 }, { service: 'Blowout', price: 65, provider: 'mei', dur: 20 }),
  theo: () => P('theo', 'Theo', 'client', null, { skin: SK.light, hair: '#111', hs: 'fade', outfit: '#5b7ea8', legs: '#2f3340', male: true }, { service: 'Haircut', price: 45, provider: 'diego', dur: 25 }),
  gia: () => P('gia', 'Gia', 'client', null, { skin: SK.deep, hair: '#0e0a08', hs: 'locs', outfit: '#3d6fb0' }, { service: 'Loc retwist', price: 160, provider: 'andre', dur: 40 }),
  nina: () => P('nina', 'Nina', 'client', null, { skin: SK.golden, hair: '#2a1a12', hs: 'long', outfit: '#c97a92' }, { service: 'Gel manicure', price: 65, provider: 'tia', dur: 35 }),
  marcus: () => P('marcus', 'Marcus', 'client', null, { skin: SK.brown, hair: '#111', hs: 'fade', outfit: '#6d9a7e', legs: '#3a3f4a', male: true, beard: true, wheelchair: true }, { service: 'Haircut', price: 45, provider: 'diego', dur: 25 }),
  olivia: () => P('olivia', 'Olivia', 'client', null, { skin: SK.deep, hair: '#120d0a', hs: 'afro', outfit: '#b5838d', legs: '#2f2f3a' }, { service: 'Blowout', price: 65, provider: 'mei', dur: 30 }),
  ben: () => P('ben', 'Ben', 'client', null, { skin: SK.tan, hair: '#1a120c', hs: 'fade', outfit: '#c9a24a', legs: '#2f3340', male: true }, { service: 'Fade', price: 40, provider: 'diego', dur: 25 }),
};
export const PRODUCTS: Record<string, { name: string; price: number }> = {
  nail: { name: 'Cuticle oil', price: 18 }, pedi: { name: 'Foot cream', price: 22 }, hair: { name: 'Bond shampoo', price: 28 }, barber: { name: 'Beard oil', price: 22 },
  wash: { name: 'Scalp serum', price: 32 }, facial: { name: 'Vitamin C serum', price: 45 }, lash: { name: 'Lash cleanser', price: 16 },
};

// ── Shifts ───────────────────────────────────────────────────────────
type Arrival = { t: number; id: string; bookedAt: number; drain?: number; provider?: string };
type ShiftDef = {
  title: string; startMin: number; end: number; goals: Goal[];
  inService: { id: string; spot: string; until: number }[]; waiting: { id: string; spot: string; bookedAt: number }[];
  arrivals: Arrival[]; events: { t: number; id: string; run: (s: State) => void }[]; seed: number;
};
export const SHIFTS: Record<ShiftId, ShiftDef> = {
  opening: {
    title: 'Saturday opening', startMin: 9 * 60, end: 60, seed: 11,
    goals: [{ id: 'takings', label: 'Takings', target: 350 }, { id: 'onTime', label: 'On time', target: 85 }, { id: 'happy', label: 'Happy', target: 85 }, { id: 'rebooked', label: 'Rebooked', target: 3 }],
    inService: [{ id: 'grace', spot: 'hair3', until: 7 }, { id: 'sam', spot: 'barber', until: 16 }, { id: 'kim', spot: 'nail2', until: 26 }],
    waiting: [],
    arrivals: [{ t: 1, id: 'rosa', bookedAt: 6 }, { t: 9, id: 'carmen', bookedAt: 15 }, { t: 14, id: 'theo', bookedAt: 22 }, { t: 22, id: 'nina', bookedAt: 28 }, { t: 30, id: 'marcus', bookedAt: 45 }, { t: 36, id: 'elle', bookedAt: 42 }],
    events: [{ t: 19, id: 'coffee', run: (s) => { const p = s.people.theo; if (p && p.state !== 'gone' && !p.need) { setNeed(s, p, { kind: 'drink', item: 'a coffee' }); s.sfx.push('ping'); say(s, 'Theo would love a coffee while he waits.'); } } }],
  },
  rush: {
    title: 'Saturday rush', startMin: 10 * 60 + 30, end: 90, seed: 23,
    goals: [{ id: 'takings', label: 'Takings', target: 700 }, { id: 'onTime', label: 'On time', target: 80 }, { id: 'happy', label: 'Happy', target: 80 }, { id: 'rebooked', label: 'Rebooked', target: 4 }],
    inService: [{ id: 'priya', spot: 'hair2', until: 22 }, { id: 'grace', spot: 'hair3', until: 18 }, { id: 'sam', spot: 'barber', until: 26 }, { id: 'lena', spot: 'wash1', until: 34 }, { id: 'rosa', spot: 'nail1', until: 24 },
      { id: 'kim', spot: 'nail2', until: 38 }, { id: 'sofia', spot: 'pedi1', until: 44 }, { id: 'dana', spot: 'facial', until: 50 }, { id: 'elle', spot: 'lash', until: 56 }],
    waiting: [{ id: 'carmen', spot: 'sofa1', bookedAt: 18 }, { id: 'theo', spot: 'sofa3', bookedAt: 26 }, { id: 'gia', spot: 'armchair', bookedAt: 60 }],
    arrivals: [{ t: 3, id: 'nina', bookedAt: 30, drain: 0.01, provider: 'maya' }, { t: 18, id: 'marcus', bookedAt: 70 }],
    events: [
      { t: 2, id: 'water', run: (s) => { const g = s.people.gia; if (g) { setNeed(s, g, { kind: 'drink', item: 'sparkling water' }); g.drain = 0.02; s.sfx.push('ping'); say(s, 'Gia asked for sparkling water.', 'warn'); } } },
      { t: 7, id: 'callout', run: (s) => openDecision(s, CALLOUT(s)) },
      { t: 15, id: 'late', run: (s) => openDecision(s, LATE(s)) },
      { t: 26, id: 'walkin', run: (s) => { const b = enter(s, 'ben', null, 'door2'); b.drain = 0.012; b.state = 'waiting'; openDecision(s, WALKIN()); } },
      { t: 22.5, id: 'wash', run: (s) => { const pr = s.people.priya; if (pr?.state === 'service') { pr.state = 'waiting'; pr.serviceUntil = null; pr.blocked = true; s.people.andre.state = 'idle'; s.flags.priyaRinse = true; openDecision(s, WASH()); } } },
      { t: 40, id: 'olivia', run: (s) => { if (s.flags.late === 'hold' || s.flags.late === 'shorten') { const o = enter(s, 'olivia', 40, 'street'); o.dur = s.flags.late === 'shorten' ? 20 : 30; walkIn(s, o); } } },
    ],
  },
};

// ── Setup ────────────────────────────────────────────────────────────
export const PRACTICE_TENANT = { name: 'Opal Salon', bookingPolicies: { grace: { late_arrival: { enabled: true, allowance: 1, periodMonths: 6, permits: 'extend_window', extendMinutes: 10 } } } };
let rngState = 1;
const rnd = () => (rngState = (rngState * 16807) % 2147483647) / 2147483647;
const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100000; return h / 100000; };
export function newShift(shift: ShiftId = 'opening'): State {
  const def = SHIFTS[shift]; rngState = def.seed;
  const spots = makeSpots(); const people: Record<string, Person> = {};
  for (const t of TEAM()) people[t.id] = t;
  const s: State = { shift, title: def.title, t: 0, end: def.end, startMin: def.startMin, tz: 'America/New_York', dayStart: Date.parse('2026-10-17T13:00:00Z') + (def.startMin - 9 * 60) * 60000,
    spots, people, decisions: {}, log: [], texts: [], coach: [], pops: [], sfx: [], popN: 0, fired: {}, flags: {}, takings: 0, tips: 0, retail: 0, rebooked: 0, exactChange: 0,
    onTime: { ok: 0, late: 0 }, policy: 0, xp: 0, best: null, goals: def.goals, tutorial: shift === 'opening' ? 1 : 0, hold: false, ended: false };
  for (const p of Object.values(people)) place(s, p, p.at!);
  for (const x of def.inService) { const c = enter(s, x.id, null, x.spot); c.state = 'service'; c.checkedIn = true; c.serviceUntil = x.until; s.flags[`kind:${x.id}`] = s.spots[x.spot].kind; const pro = s.people[c.provider!]; if (pro) pro.state = 'busy'; c.drain = 0.004; }
  for (const x of def.waiting) { const c = enter(s, x.id, x.bookedAt, x.spot); c.checkedIn = true; }
  say(s, `${def.title}, ${clockAt(def.startMin, 0)}. ${shift === 'opening' ? 'Doors are open.' : 'The salon is full and the lounge is busy.'}`);
  return s;
}
function place(s: State, p: Person, spotId: string) { const sp = s.spots[spotId]; p.at = spotId; p.x = sp.x; p.z = sp.z; }
function enter(s: State, id: string, bookedAt: number | null, spotId: string) {
  const c = C[id](); if (bookedAt != null) c.bookedAt = bookedAt; s.people[id] = c; place(s, c, spotId); return c;
}
/** A client walks in from the street to the door, where they need checking in. */
function walkIn(s: State, c: Person) {
  const door = ['door', 'door2', 'door3'].find((d) => !occupant(s, d)) || 'door';
  c.path = route(c.x, c.z, s.spots[door].x, s.spots[door].z); c.to = door; c.at = null; c.state = 'walking'; c.afterArrive = 'arrived';
}

// ── Helpers ──────────────────────────────────────────────────────────
export const they = (p: Person, cap = false) => { const w = p.look.male ? 'he' : 'she'; return cap ? w[0].toUpperCase() + w.slice(1) : w; };
export const their = (p: Person) => (p.look.male ? 'his' : 'her');
export const moodOf = (p: Person): Mood => (p.patience > 0.6 ? 'ok' : p.patience > 0.3 ? 'warn' : 'bad');
const occupant = (s: State, spotId: string) => Object.values(s.people).find((p) => (p.at === spotId || p.to === spotId) && p.state !== 'gone');
export const freeSpots = (s: State, role: 'client' | 'staff', kinds?: SpotKind[]) => Object.values(s.spots).filter((sp) => sp.role === role && (!kinds || kinds.includes(sp.kind)) && !occupant(s, sp.id) && sp.kind !== 'street');
const say = (s: State, text: string, tone?: Line['tone']) => s.log.push({ t: s.t, text, tone });
const text = (s: State, to: string, body: string) => s.texts.push({ t: s.t, to, body });
const ms = (s: State, t: number) => s.dayStart + t * 60000;
export const deskStaffed = (s: State) => Object.values(s.people).some((p) => p.at === 'desk' && p.role === 'staff' && (p.state === 'idle'));
function pop(s: State, pid: string, text: string, tone: Pop['tone'] = 'ok') { s.pops.push({ id: ++s.popN, pid, text, tone, t: s.t }); if (s.pops.length > 30) s.pops.shift(); }
function xp(s: State, pid: string, n: number, why?: string) { s.xp += n; if (why) pop(s, pid, `${why} +${n}`, 'xp'); }
function setNeed(s: State, p: Person, n: Omit<Need, 'since'>) { p.need = { ...n, since: s.t }; }
/** Resolving a need while someone is upset is a save. */
function resolved(s: State, p: Person, what: string) {
  if (moodOf(p) === 'bad') { xp(s, p.id, 20, 'Nice save'); const score = 1 - p.patience; if (!s.best || score > s.best.score) s.best = { text: `${what} just in time.`, score }; s.sfx.push('chime'); }
  p.need = null;
}

// ── Paths: people walk along the aisles, not through furniture ─────────
const AISLE_X = [11.0, 21.4];
export function route(ax: number, az: number, bx: number, bz: number) {
  const near = (z: number) => (z < 5.6 ? 5.6 : z > 12 ? 12 : Math.abs(z - 5.6) < Math.abs(z - 12) ? 5.6 : 12);
  const za = az > 17 ? 12 : near(az), zb = bz > 17 ? 12 : near(bz);
  const pts: { x: number; z: number }[] = [{ x: ax, z: za }];
  if (za !== zb) { const mid = (ax + bx) / 2; const cx = AISLE_X.reduce((b, x) => (Math.abs(x - mid) < Math.abs(b - mid) ? x : b)); pts.push({ x: cx, z: za }, { x: cx, z: zb }); }
  pts.push({ x: bx, z: zb }, { x: bx, z: bz });
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
}
const SPEED = 4.5;   // aisle units per game minute

// ── What the player can do ───────────────────────────────────────────
export function canGo(s: State, p: Person, sp: Spot): string | null {
  if (p.state === 'gone') return `${p.name} has left.`;
  if (p.state === 'service') return `${p.name} is in the middle of a service.`;
  if (sp.kind === 'street') return 'That’s outside.';
  if (sp.role !== p.role && !(p.role === 'staff' && sp.kind === 'lounge')) return p.role === 'client' ? 'That’s a place for the team.' : 'That’s a place for clients.';
  if (p.role === 'client' && (sp.kind === 'door' || sp.kind === 'office')) return 'Choose a seat or a chair.';
  if (p.look.wheelchair && sp.pose !== 'stand' && !sp.accessible && !['hair', 'barber', 'desk'].includes(sp.kind)) return `${sp.label} isn’t step-free. Try the step-free spot in the lounge.`;
  if (p.role === 'client' && p.need?.kind === 'check_in' && sp.kind !== 'desk') return `Check ${p.name} in first.`;
  const o = occupant(s, sp.id); if (o && o.id !== p.id) return `${o.name} is there.`;
  if (p.role === 'client' && !['lounge', 'desk', 'wash'].includes(sp.kind) && p.provider && sp.id !== providerChair(s, p)) {
    const pro = s.people[p.provider]; return pro ? `${p.name} is booked with ${pro.name}. Their chair is ${s.spots[providerChair(s, p) || '']?.label.toLowerCase() || 'busy'}.` : 'That isn’t their chair.';
  }
  return null;
}
const providerChair = (s: State, p: Person) => { const pro = p.provider ? s.people[p.provider] : null; return pro?.at?.endsWith('-pro') ? pro.at.replace(/-pro$/, '') : null; };
/** Send someone to a spot (they walk there along the aisles). */
export function moveTo(s: State, id: string, spotId: string): { ok: boolean; error?: string } {
  const p = s.people[id], sp = s.spots[spotId]; if (!p || !sp) return { ok: false, error: 'Not found.' };
  const why = canGo(s, p, sp); if (why) return { ok: false, error: why };
  p.path = route(p.x, p.z, sp.x, sp.z); p.to = spotId; p.at = null; p.state = 'walking';
  if (p.need?.kind === 'seat') resolved(s, p, `${p.name} was seated`);
  if (s.tutorial === 2 && id === 'rosa') s.tutorial = 3;
  return { ok: true };
}
export function freeTeam(s: State, near?: { x: number; z: number }) {
  return Object.values(s.people).filter((p) => p.role === 'staff' && p.state === 'idle').sort((a, b) => (near ? Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z) : 0));
}
/** A team member brings a drink to a client, then goes back. */
export function serve(s: State, staffId: string, clientId: string) {
  const st = s.people[staffId], c = s.people[clientId]; if (!st || !c || st.state !== 'idle') return { ok: false, error: 'They’re busy right now.' };
  st.returnTo = st.at; st.path = route(st.x, st.z, c.x + 0.8, c.z + 0.9); st.to = null; st.at = null; st.state = 'walking'; st.afterArrive = `serve:${clientId}`;
  say(s, `${st.name} is bringing ${c.name} ${c.need?.item || 'a drink'}.`); c.need = c.need ? { ...c.need, urgent: false } : null; s.flags[`serving:${clientId}`] = staffId;
  return { ok: true };
}
/** Check a client in at the desk (someone must be at the desk). */
export function checkIn(s: State, id: string) {
  const c = s.people[id]; if (!c || c.need?.kind !== 'check_in') return { ok: false, error: 'Nothing to check in.' };
  if (!deskStaffed(s)) return { ok: false, error: 'Nobody is at the front desk. Send someone there first.' };
  c.checkedIn = true; resolved(s, c, `${c.name} was checked in`); c.patience = Math.min(1, c.patience + 0.1);
  xp(s, id, 10, 'Checked in'); s.sfx.push('bell'); say(s, `${c.name} is checked in.`, 'ok');
  seatNeed(s, c);
  if (s.tutorial === 1 && id === 'rosa') s.tutorial = 2;
  return { ok: true };
}
/** A client moves to another provider (a callout). If they're checked in and waiting, they get seated with them. */
function reassign(s: State, c: Person, to: string) { c.provider = to; if (c.checkedIn && c.state === 'waiting' && (!c.need || c.need.kind === 'seat')) seatNeed(s, c); }
/** After check-in: their chair if it's free, otherwise the lounge. */
function seatNeed(s: State, c: Person) {
  const chair = providerChair(s, c); const pro = c.provider ? s.people[c.provider] : null;
  const ready = chair && pro?.state === 'idle' && !occupant(s, chair);
  if (!ready && s.spots[c.at || '']?.kind === 'lounge') { c.need = null; return; }   // already waiting in the lounge
  const lounge = c.look.wheelchair ? 'lounge-open' : freeSpots(s, 'client', ['lounge']).find((x) => !x.accessible)?.id;
  setNeed(s, c, { kind: 'seat', to: ready ? chair! : lounge });
}

// ── Checkout ─────────────────────────────────────────────────────────
export type Bill = { total: number; service: number; tip: number; method: 'card' | 'cash'; given: number; product: { name: string; price: number } | null };
export function billFor(s: State, id: string): Bill | null {
  const c = s.people[id]; if (!c || c.need?.kind !== 'pay') return null;
  const tipPct = c.patience > 0.8 ? 0.2 + hash(id + 'tip') * 0.05 : c.patience > 0.5 ? 0.15 : c.patience > 0.3 ? 0.1 : 0;
  const tip = Math.round(c.price * tipPct);
  const kind = (s.flags[`kind:${id}`] as SpotKind) || 'nail'; const product = PRODUCTS[kind] || null;
  const method: 'card' | 'cash' = hash(id + 'cash') < 0.35 ? 'cash' : 'card';
  const total = c.price + tip; const given = method === 'cash' ? (total <= 50 ? 60 : total <= 100 ? 100 : Math.ceil(total / 20) * 20 + 20) : total;
  return { total, service: c.price, tip, method, given, product };
}
export const DENOMS = [20, 10, 5, 1];
/** Take payment. Product and rebook are offers: whether the client says yes depends on how their visit went. */
export function checkout(s: State, id: string, o: { offerProduct: boolean; offerRebook: boolean; change?: number }) {
  const c = s.people[id]; const bill = billFor(s, id); if (!c || !bill) return { ok: false as const, error: 'Nothing to pay.' };
  if (!deskStaffed(s)) return { ok: false as const, error: 'Nobody is at the front desk. Send someone there first.' };
  const wantProduct = o.offerProduct && bill.product && c.patience > 0.5 && hash(id + 'prod') < (c.patience > 0.8 ? 0.75 : 0.4);
  const wantRebook = o.offerRebook && hash(id + 'rebook') < (c.patience > 0.6 ? 0.9 : 0.4);
  let exact = false;
  if (bill.method === 'cash') { const due = bill.given - bill.total; exact = o.change === due; if (o.change != null && !exact) return { ok: false as const, error: `That’s $${o.change}. She should get $${due} back.`, due }; }
  const total = bill.total + (wantProduct ? bill.product!.price : 0);
  s.takings += c.price + (wantProduct ? bill.product!.price : 0); s.tips += bill.tip; if (wantProduct) s.retail += bill.product!.price;
  c.paid = true; resolved(s, c, `${c.name} paid`);
  pop(s, id, `+$${total}${bill.tip ? ` · tip $${bill.tip}` : ''}`, 'gold'); s.sfx.push('coin');
  xp(s, id, 10 + Math.round(c.price / 20)); if (exact) { s.exactChange++; xp(s, id, 10, 'Exact change'); }
  if (wantProduct) { xp(s, id, 10); say(s, `${c.name} took the ${bill.product!.name.toLowerCase()}.`, 'ok'); }
  if (o.offerRebook) { if (wantRebook) { s.rebooked++; xp(s, id, 15, 'Rebooked'); s.sfx.push('chime'); } else say(s, `${c.name} will book online later.`); }
  if (s.tutorial === 3 && o.offerRebook) s.tutorial = 4;
  say(s, `${c.name} paid $${total}${bill.tip ? ` with a $${bill.tip} tip` : ''}.`, 'ok');
  leave(s, c);
  return { ok: true as const, product: !!wantProduct, rebooked: !!(o.offerRebook && wantRebook), exact, total };
}
function leave(s: State, c: Person) { const st = s.spots.street; c.path = route(c.x, c.z, st.x, st.z); c.to = null; c.at = null; c.state = 'walking'; c.afterArrive = 'leave'; }

// ── Decisions (icons and tray rows; they never open by themselves) ──────
function openDecision(s: State, d: Omit<Decision, 'at' | 'deadline'> & { minutes?: number }) {
  s.decisions[d.id] = { ...d, at: s.t, deadline: s.t + (d.minutes ?? 10) }; s.sfx.push('alert');
  say(s, d.title, 'warn');
}
export function decide(s: State, id: string, optionId: string, auto = false) {
  const d = s.decisions[id]; if (!d) return { ok: false };
  delete s.decisions[id];
  if (auto) { s.coach.push(d.fallbackText); say(s, d.fallbackText, 'bad'); }
  RESOLVE[id]?.(s, optionId, auto);
  s.hold = false;
  return { ok: true };
}
const CALLOUT = (s: State) => ({ id: 'callout', who: ['nina', 'tia'], fallback: 'move_all', fallbackText: 'Nobody decided about Maya’s clients, so Zoe moved them all to Tia.',
  title: 'Maya called out sick. 4 of her clients are booked today.', body: 'Nina is first, at 11:00, and she’s at the desk. Tia is free until 11:00.',
  options: [
    { id: 'choose', label: 'Let clients choose (the app’s way)', what: 'Each client gets their choices by text. Visits too soon to wait go on the call list.', tags: [['Calm', 'green'], ['Nina picks Tia', 'green']] },
    { id: 'move_all', label: 'Move everyone to Tia', what: 'Fast, but nobody was asked. Tia is already booked from 1:00.', tags: [['Runs late after 1 PM', 'amber'], ['Some unhappy', 'red']] },
    { id: 'call', label: 'Call each client yourself', what: 'Personal, but Zoe is away from the desk for about 25 minutes.', tags: [['Desk empty', 'red'], ['Feels personal', 'green']] }] } as any);
const LATE = (s: State) => { const read = intentByWords('running 15 minutes late, so sorry!!'); s.flags.lateIntent = read.intent; return { id: 'late', who: ['zoe'], fallback: 'hold', fallbackText: 'Olivia’s text wasn’t answered, so she arrived hoping for the best and Mei ran behind.',
  title: 'Olivia texted: “running 15 minutes late, so sorry!!”', body: `Read as: ${read.intent === 'late' ? 'running late' : read.intent}. Her 11:10 blowout is with Mei. She has one late-arrival courtesy left (${graceRule(PRACTICE_TENANT, 'late_arrival').extendMinutes} extra minutes).`,
  options: [
    { id: 'hold', label: 'Use her courtesy and hold the spot', what: 'She keeps her full service. Mei runs a little behind.', tags: [['Olivia happy', 'green'], ['Mei behind', 'amber']] },
    { id: 'shorten', label: 'Offer a quicker style', what: 'She keeps the visit; Mei stays on time.', tags: [['On time', 'green'], ['Her choice', 'green']] },
    { id: 'move', label: 'Offer a later time', what: 'Mei has 1:00 PM free.', tags: [['On time', 'green'], ['Empty slot', 'amber']] }] } as any; };
const WALKIN = () => ({ id: 'walkin', who: ['ben'], minutes: 6, fallback: 'away', fallbackText: 'Ben waited at the door with no answer and left.',
  title: 'A walk-in wants a fade: Ben.', body: 'Diego has Theo next, then Marcus at 11:40. Nobody else does fades.',
  options: [
    { id: 'queue', label: 'Fit him in after Theo', what: 'About a 20 minute wait in the lounge. Marcus is early anyway.', tags: [['Keeps the visit', 'green'], ['A wait', 'amber']] },
    { id: 'book', label: 'Book him for later today', what: 'He comes back at 2:30.', tags: [['Calm', 'green'], ['Rebooked', 'green']] },
    { id: 'away', label: 'Say you’re fully booked', what: 'He leaves.', tags: [['Lost visit', 'red']] }] } as any);
const WASH = () => ({ id: 'wash', who: ['priya', 'andre'], minutes: 6, fallback: 'wait', fallbackText: 'Priya’s color sat too long waiting for the wash bar.',
  title: 'Priya’s color is ready to rinse, but the wash bar is busy.', body: 'Jordan is with Lena until about 11:05. Andre has Gia at 11:30.',
  options: [
    { id: 'andre', label: 'Andre rinses her himself', what: 'Her color comes off on time and Andre stays on schedule.', tags: [['Color safe', 'green'], ['On time', 'green']] },
    { id: 'wait', label: 'Wait for Jordan', what: 'About 10 minutes. Color can over-process; Andre falls behind.', tags: [['Risk to color', 'red'], ['Gia waits', 'amber']] }] } as any);

const RESOLVE: Record<string, (s: State, o: string, auto: boolean) => void> = {
  callout(s, o) {
    s.flags.callout = o; const nina = s.people.nina; const nowMs = ms(s, s.t);
    const later = [{ name: 'Ms. Patel', at: ms(s, 150) }, { name: 'Jada', at: ms(s, 210) }, { name: 'Robin', at: ms(s, 270) }];
    if (o === 'choose') {
      const call: string[] = [];
      for (const c of later) { const by = chooseByFor(c.at, nowMs, s.tz, 3); if (by) text(s, c.name, `Hi ${c.name.replace('Ms. ', '')}, we’re so sorry: Maya is unwell today. You can pick one of her next times, see someone else today, or join the waitlist here: [link]. Please choose by ${clock(s, (by - s.dayStart) / 60000)}.`); else call.push(c.name); }
      text(s, 'Nina', 'Hi Nina, we’re so sorry: Maya is unwell today. Tia can see you at 11:00 instead, or you can pick one of Maya’s next times here: [link]');
      if (call.length) say(s, `Too soon to wait for a reply, so they go on the desk’s call list: ${call.join(' and ')}.`, 'warn');
      s.flags.callList = call; s.policy += 2; xp(s, 'nina', 20, 'The app’s way');
      s.coach.push(`You let Maya’s clients choose. Visits too soon to wait (${call.join(', ') || 'none'}) went on the call list, the same rule the app uses.`);
      if (nina) { nina.patience = Math.min(1, nina.patience + 0.2); reassign(s, nina, 'tia'); }
    } else if (o === 'move_all') {
      s.flags.tiaOverbooked = true; text(s, 'Nina', 'Hi Nina, Maya is unwell today, so we’ve moved you to Tia at 11:00.');
      for (const c of later) text(s, c.name, `Hi ${c.name.replace('Ms. ', '')}, Maya is unwell today, so we’ve moved your appointment to Tia.`);
      if (nina) reassign(s, nina, 'tia');
      s.coach.push('Moving everyone to Tia was quick, but nobody was asked and Tia’s afternoon is now double-booked.');
    } else {
      s.flags.zoeBack = s.t + 25; moveTo(s, 'zoe', 'office'); s.people.zoe.afterArrive = 'away'; s.policy += 1;
      if (nina) reassign(s, nina, 'tia');
      s.coach.push('Calling each client is personal, but the desk was empty for 25 minutes. Texting choices first keeps the desk covered.');
    }
  },
  late(s, o) {
    s.flags.late = o; const g = graceRemaining(PRACTICE_TENANT, 'late_arrival', [], { clientId: 'olivia' }, new Date(ms(s, s.t)));
    if (o === 'hold') { s.policy += g.remaining > 0 ? 1 : 0; text(s, 'Olivia', `Thank you for letting us know, Olivia. We’ll hold your spot until ${clock(s, 50)}. Drive safely.`); s.coach.push('You used Olivia’s late courtesy and held her spot; Mei ran a little behind.'); }
    else if (o === 'shorten') { s.policy += 2; text(s, 'Olivia', 'Thank you for letting us know, Olivia. We can still see you; Mei will do a quicker style so the next client isn’t kept waiting. Is that okay?'); s.coach.push('A quicker style kept Mei on time and still looked after Olivia: the app’s late-arrival choice.'); xp(s, 'zoe', 10, 'Kind and firm'); }
    else { s.policy += 1; s.rebooked++; text(s, 'Olivia', 'Thank you for letting us know, Olivia. Mei has 1:00 PM free. Would you like it? Reply YES and it’s yours.'); s.coach.push('Moving Olivia kept Mei on time; the 11:10 slot sat empty. A waitlist offer could fill it.'); }
  },
  walkin(s, o) {
    const b = s.people.ben; if (!b) return;
    if (o === 'queue') { b.bookedAt = s.t + 22; b.checkedIn = true; text(s, 'Ben', 'You’re on the list for Diego, about 20 minutes. Have a seat in the lounge.'); seatNeed(s, b); s.policy += 1; xp(s, 'ben', 10, 'Walk-in kept'); s.coach.push('You fitted the walk-in in after Theo instead of squeezing him in.'); }
    else if (o === 'book') { s.rebooked++; xp(s, 'ben', 15, 'Booked'); leave(s, b); s.coach.push('Booking Ben for later kept the morning calm.'); }
    else { b.patience = 0.2; leave(s, b); s.coach.push('Turning a walk-in away loses the visit. Offering the next free time keeps him.'); }
  },
  wash(s, o) {
    const pr = s.people.priya; if (!pr) return;
    if (o === 'andre') { s.flags.andreWashes = true; pr.blocked = false; moveTo(s, 'andre', 'wash2-pro'); moveTo(s, 'priya', 'wash2'); s.coach.push('Andre rinsed Priya himself, so her color came off on time.'); xp(s, 'priya', 10, 'Color safe'); }
    else { pr.patience -= 0.25; s.flags.priyaWaits = true; s.coach.push('Priya waited for the wash bar; color left on too long can over-process. The stylist can rinse.'); }
  },
};

// ── Time ─────────────────────────────────────────────────────────────
/** In the first shift, time waits for you while you learn each step. */
export function tutorialHold(s: State) {
  if (s.shift !== 'opening') return false; const r = s.people.rosa, g = s.people.grace;
  return (s.tutorial === 1 && r?.need?.kind === 'check_in') || (s.tutorial === 2 && r?.need?.kind === 'seat') || (s.tutorial === 3 && g?.need?.kind === 'pay');
}
export function paused(s: State) { return s.ended || s.hold || tutorialHold(s); }
export function advance(s: State, dt: number) {
  if (paused(s) || dt <= 0) return;
  const def = SHIFTS[s.shift]; const t1 = Math.min(s.end, s.t + dt);
  for (const a of def.arrivals) if (!s.fired[`a:${a.id}`] && a.t <= t1) { s.fired[`a:${a.id}`] = true; const c = enter(s, a.id, a.bookedAt, 'street'); if (a.drain) c.drain = a.drain; if (a.provider) c.provider = a.provider; walkIn(s, c); }
  for (const e of def.events) if (!s.fired[e.id] && e.t <= t1) { s.fired[e.id] = true; e.run(s); }
  const step = t1 - s.t; s.t = t1;
  for (const d of Object.values(s.decisions)) if (s.t >= d.deadline) decide(s, d.id, d.fallback, true);
  if (s.flags.zoeBack && s.t >= s.flags.zoeBack) { s.flags.zoeBack = null; s.people.zoe.state = 'idle'; moveTo(s, 'zoe', 'desk'); say(s, 'Zoe finished the calls and is heading back to the desk.'); }
  if (s.flags.priyaWaits && s.t >= 36 && !s.flags.priyaWashSet) { s.flags.priyaWashSet = true; const pr = s.people.priya; if (pr) { pr.blocked = false; setNeed(s, pr, { kind: 'seat', to: 'wash1' }); } }
  for (const p of Object.values(s.people)) tickPerson(s, p, step);
  if (!deskStaffed(s)) s.flags.deskEmptyMin = (s.flags.deskEmptyMin || 0) + step;
  if (s.t >= s.end) finish(s);
}
function arrive(s: State, p: Person) {
  const sp = p.to ? s.spots[p.to] : null; p.path = [];
  if (sp) { p.at = sp.id; p.x = sp.x; p.z = sp.z; p.to = null; }
  const after = p.afterArrive; p.afterArrive = null;
  if (after?.startsWith('serve:')) {
    const c = s.people[after.slice(6)]; if (c && c.need?.kind === 'drink') { resolved(s, c, `${c.name} got ${their(c)} drink`); c.drain = 0.005; c.patience = Math.min(1, c.patience + 0.35); pop(s, c.id, 'Thank you!', 'ok'); xp(s, c.id, 10); s.sfx.push('chime'); say(s, `${c.name} has ${their(c)} ${c.need?.item ? '' : 'drink'}${c.need?.item || ''}. Thank you, ${p.name}.`.replace('  ', ' '), 'ok'); }
    const back = p.returnTo && s.spots[p.returnTo] ? p.returnTo : 'desk'; p.returnTo = null; p.state = 'walking'; p.path = route(p.x, p.z, s.spots[back].x, s.spots[back].z); p.to = back; return;
  }
  if (after === 'leave') { p.state = 'gone'; p.at = null; return; }
  if (after === 'arrived') { p.state = 'waiting'; setNeed(s, p, { kind: 'check_in' }); s.sfx.push('bell'); say(s, `${p.name} arrived for ${p.bookedAt != null ? `her ${clock(s, p.bookedAt)}` : 'a visit'}${p.provider ? ` with ${s.people[p.provider]?.name}` : ''}.`.replace('her', p.look.male ? 'his' : 'her')); return; }
  if (after === 'away') { p.state = 'away'; return; }
  if (after === 'to-pay') { p.state = 'waiting'; setNeed(s, p, { kind: 'pay' }); s.sfx.push('ping'); return; }
  if (p.role === 'staff') { p.state = 'idle'; tryStart(s); if (p.state === 'idle') for (const w of Object.values(s.people)) if (w.provider === p.id && w.state === 'waiting') nextSeat(s, w); return; }
  p.state = 'waiting'; tryStart(s); if (p.state === 'waiting') nextSeat(s, p);
}
function nextSeat(s: State, c: Person) {
  if (c.role !== 'client' || !c.checkedIn || (c.need && c.need.kind !== 'drink') || c.paid || c.blocked) return;
  const chair = providerChair(s, c); const pro = c.provider ? s.people[c.provider] : null;
  if (chair && pro?.state === 'idle' && !occupant(s, chair) && s.spots[c.at || '']?.kind === 'lounge') setNeed(s, c, { kind: 'seat', to: chair });
}
/** Start any service whose client and provider are both in place. */
function tryStart(s: State) {
  for (const c of Object.values(s.people)) {
    if (c.role !== 'client' || c.state !== 'waiting' || !c.at || !c.checkedIn || c.blocked || (c.need && c.need.kind !== 'drink')) continue;
    const sp = s.spots[c.at]; if (!sp || ['lounge', 'desk', 'door', 'street'].includes(sp.kind)) continue;
    const pro = Object.values(s.people).find((p) => p.role === 'staff' && p.at === `${sp.id}-pro` && p.state === 'idle'); if (!pro) continue;
    pro.state = 'busy'; c.state = 'service'; c.startedAt = s.t; c.provider = pro.id; c.need = null; s.flags[`kind:${c.id}`] = sp.kind;
    const dur = sp.kind === 'wash' ? 8 : (c.dur ?? 30) + (sp.kind === 'nail' && s.flags.tiaOverbooked && pro.id === 'tia' ? 10 : 0) + (pro.id === 'mei' && s.flags.late === 'hold' && c.id !== 'olivia' ? 5 : 0);
    c.serviceUntil = s.t + dur;
    if (c.bookedAt != null && sp.kind !== 'wash') { const late = s.t - c.bookedAt > 10; if (late) s.onTime.late++; else { s.onTime.ok++; pop(s, c.id, 'On time ✓', 'ok'); xp(s, c.id, 5); } c.bookedAt = undefined; }
    say(s, `${pro.name} started ${c.name}’s ${sp.kind === 'wash' ? 'rinse' : (c.service || 'service').toLowerCase()}.`, 'ok');
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
  if (p.role !== 'client') return;
  if (p.state === 'service' && p.serviceUntil != null && s.t >= p.serviceUntil) return finishService(s, p);
  if (p.state === 'waiting') {
    let drain = p.drain;
    if (p.need?.kind === 'check_in' && !deskStaffed(s)) drain *= 1.8;
    if (p.need?.kind === 'pay') drain *= 1.4;
    if (p.bookedAt != null && s.t > p.bookedAt) drain *= 1.6;
    p.patience = Math.max(0, p.patience - drain * dt);
    if (p.need) p.need.urgent = moodOf(p) === 'bad';
  } else if (p.state === 'service') p.patience = Math.min(1, p.patience + 0.002 * dt);
}
function finishService(s: State, c: Person) {
  const pro = c.provider ? s.people[c.provider] : null; if (pro) pro.state = 'idle';
  c.serviceUntil = null;
  if (c.id === 'priya' && c.at?.startsWith('wash')) {   // rinsed: back to Andre's chair to finish
    c.state = 'waiting'; c.provider = 'andre'; c.dur = 18; setNeed(s, c, { kind: 'seat', to: 'hair2' });
    if (s.flags.andreWashes) moveTo(s, 'andre', 'hair2-pro');
    say(s, 'Priya’s color is rinsed. Back to Andre’s chair.', 'ok'); return;
  }
  c.done = true; say(s, `${c.name}’s ${(c.service || 'service').toLowerCase()} is done${pro ? `. ${pro.name} is free` : ''}.`, 'ok');
  // Off to the desk to pay
  const spot = ['desk-front1', 'desk-front2', 'desk-front3'].find((d) => !occupant(s, d)) || 'desk-front3';
  c.path = route(c.x, c.z, s.spots[spot].x, s.spots[spot].z); c.to = spot; c.at = null; c.state = 'walking'; c.afterArrive = 'to-pay';
  if (pro) for (const w of Object.values(s.people)) if (w.provider === pro.id && w.state === 'waiting') nextSeat(s, w);
}
function finish(s: State) {
  s.ended = true;
  if ((s.flags.deskEmptyMin || 0) > 10) s.coach.push(`The front desk was empty for ${Math.round(s.flags.deskEmptyMin)} minutes. Arrivals and payments waited.`);
  const left = Object.values(s.people).filter((p) => p.role === 'client' && p.need?.kind === 'pay');
  if (left.length) s.coach.push(`${left.map((p) => p.name).join(' and ')} ${left.length > 1 ? 'were' : 'was'} still waiting to pay at close.`);
}

// ── Needs (what the tray and the icons show) ────────────────────────────
export function needs(s: State) {
  const out: { pid: string; kind: NeedKind; label: string; wait: number; urgent: boolean; to?: string; decision?: string }[] = [];
  for (const p of Object.values(s.people)) {
    if (!p.need || p.state === 'gone' || p.state === 'walking' || p.need.kind === 'decide') continue;
    const label = p.need.kind === 'check_in' ? 'Check in at the desk' : p.need.kind === 'pay' ? 'Ready to pay' : p.need.kind === 'drink' ? `Wants ${p.need.item || 'a drink'}` :
      p.need.kind === 'seat' ? (p.need.to && !['lounge'].includes(s.spots[p.need.to]?.kind) ? `Seat at ${s.spots[p.need.to]?.label.toLowerCase()}` : 'Seat in the lounge') : 'Needs you';
    out.push({ pid: p.id, kind: p.need.kind, label, wait: Math.max(0, s.t - p.need.since), urgent: !!p.need.urgent, to: p.need.to, decision: p.need.decision });
  }
  for (const d of Object.values(s.decisions)) out.push({ pid: d.who[0], kind: 'decide', label: d.title, wait: Math.max(0, s.t - d.at), urgent: true, decision: d.id });
  const rank = (n: (typeof out)[0]) => (n.kind === 'decide' ? 0 : n.urgent ? 1 : 2) * 1000 - n.wait;
  return out.sort((a, b) => rank(a) - rank(b));
}

// ── Goals and the report ────────────────────────────────────────────────
export function goalValue(s: State, g: Goal) {
  const clients = Object.values(s.people).filter((p) => p.role === 'client');
  if (g.id === 'takings') return s.takings;
  if (g.id === 'onTime') return s.onTime.ok + s.onTime.late ? Math.round((s.onTime.ok / (s.onTime.ok + s.onTime.late)) * 100) : 100;
  if (g.id === 'happy') return clients.length ? Math.round((clients.reduce((a, c) => a + c.patience, 0) / clients.length) * 100) : 100;
  return s.rebooked;
}
export const LEVELS = [{ at: 0, name: 'Front desk' }, { at: 150, name: 'Front desk lead' }, { at: 400, name: 'Floor manager' }, { at: 800, name: 'Salon manager' }, { at: 1400, name: 'Owner' }];
export function levelOf(totalXp: number) {
  let i = 0; for (let k = 0; k < LEVELS.length; k++) if (totalXp >= LEVELS[k].at) i = k;
  const next = LEVELS[i + 1]; return { n: i + 1, name: LEVELS[i].name, pct: next ? (totalXp - LEVELS[i].at) / (next.at - LEVELS[i].at) : 1, next: next?.name || null };
}
export function report(s: State) {
  const hit = s.goals.map((g) => ({ ...g, value: goalValue(s, g), met: goalValue(s, g) >= g.target }));
  const stars = Math.max(1, Math.min(3, hit.filter((g) => g.met).length - 1));
  const unhappy = Object.values(s.people).filter((p) => p.role === 'client' && moodOf(p) === 'bad').map((p) => p.name);
  const badges: string[] = [];
  if (s.rebooked >= 5) badges.push('Rebook pro'); if (s.onTime.late === 0 && s.onTime.ok >= 3) badges.push('Like clockwork'); if (!unhappy.length) badges.push('Nobody left unhappy'); if (s.exactChange >= 2) badges.push('Exact change'); if (s.policy >= 4) badges.push('Kind and firm');
  return { goals: hit, stars, takings: s.takings, tips: s.tips, retail: s.retail, rebooked: s.rebooked, xp: s.xp, unhappy, badges, best: s.best?.text || null, coach: s.coach.slice(-4) };
}
