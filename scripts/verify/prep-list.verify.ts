// Checks tomorrow's prep list (L20 round 7): lib/prep-list (the working out), lib/prep-list-server, api/prep, the page.
// - A usual night is the same day of the week, the last six weeks (the last week's nights when there aren't two).
// - Guests: a usual night's, plus however many more are booked than usual, never fewer than booked.
// - Each dish: a usual night's, scaled to the guests, rounded up, with the range; a dish new to the menu is listed new.
// - What the recipes take, against what's in stock; ticked off as prepped; always said to be an estimate.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/prep-list.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'c1', name: 'Cam Lo', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }) };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const PL = await import('../../src/lib/prep-list');
  console.log('the working out');
  // Saturday 2026-11-21; the six Saturdays before it, and a Friday.
  const sat = (w: number) => { const d = new Date(Date.UTC(2026, 10, 21 - 7 * w)); return d.toISOString().slice(0, 10); };
  const nights: import('../../src/lib/prep-list').Night[] = [
    { day: sat(1), guests: 100, booked: 30, used: { steak: 20, tart: 10 } },
    { day: sat(2), guests: 90, booked: 30, used: { steak: 18, tart: 12 } },
    { day: sat(3), guests: 110, booked: 30, used: { steak: 25, tart: 14 } },
    { day: '2026-11-20', guests: 60, booked: 10, used: { steak: 99 } },
  ];
  const items = [{ id: 'steak', name: 'Ribeye', station: 'Grill', x: { formula: [{ id: 'beef', name: 'Ribeye cut', quantityUsed: 1, unit: 'each' }] } },
    { id: 'tart', name: 'Tart', station: 'Pastry', x: {} }, { id: 'lamb', name: 'Lamb special', station: 'Grill', x: { createdAt: new Date(Date.now() - 3 * 864e5).toISOString() } },
    { id: 'old', name: 'Old soup', station: 'Grill', x: { createdAt: '2025-01-01T00:00:00Z' } }];
  const parts = new Map<string, any>([['beef', { name: 'Ribeye cut', totalStock: 18, unit: 'each' }]]);
  let p = PL.planPrep({ day: '2026-11-21', nights, items, booked: 50, bookings: 9, stations: ['Grill', 'Pastry'], parts });
  check('a usual Saturday from the Saturdays only (not Friday)', p.basis === 'weekday' && p.nights.length === 3 && p.nights.every((n) => n.day !== '2026-11-20'), p.nights);
  check('guests: a usual Saturday (100) plus the 20 more booked than usual', p.usualGuests === 100 && p.guests === 120 && p.walkIns === 70, p);
  const steak = p.rows.find((r) => r.id === 'steak')!; const tart = p.rows.find((r) => r.id === 'tart')!;
  check('each dish scaled to the guests and rounded up, with a usual night’s range', steak.make === Math.ceil(21 * 1.2) && steak.low === 18 && steak.high === 25 && tart.make === Math.ceil(12 * 1.2) && tart.low === 10 && tart.high === 14, p.rows);
  check('a dish new to the menu is listed new; an old one not sold isn’t listed', p.rows.some((r) => r.id === 'lamb' && r.isNew && r.make === null) && !p.rows.some((r) => r.id === 'old'));
  check('by station, in the business’s order', p.rows.map((r) => r.station).join() === 'Grill,Grill,Pastry', p.rows.map((r) => r.id));
  check('what the recipes take, against what’s in stock', p.needs.length === 1 && p.needs[0].need === steak.make && p.needs[0].have === 18, p.needs);
  p = PL.planPrep({ day: '2026-11-21', nights, items, booked: 10, bookings: 2, stations: ['Grill', 'Pastry'], parts });
  check('fewer booked than usual: a usual night, not less', p.guests === 100);
  p = PL.planPrep({ day: '2026-11-21', nights: nights.map((n) => ({ ...n, booked: 0 })), items, booked: 30, bookings: 6, stations: ['Grill', 'Pastry'], parts });
  check('new to online bookings (no bookings on the usual nights): the booked guests are part of a usual night, not on top', p.guests === 100 && p.walkIns === 70, p);
  p = PL.planPrep({ day: '2026-11-21', nights: [...nights, { day: sat(4), guests: null, booked: 0, used: { steak: 90 } }], items, booked: 50, bookings: 9, stations: ['Grill', 'Pastry'], parts });
  check('sales and guests from the same nights (a night with no guests counted is left out of both)', p.rows.find((r) => r.id === 'steak')!.make === Math.ceil(21 * 1.2) && p.sameDay === 4, p.rows);
  p = PL.planPrep({ day: '2026-11-21', nights: [nights[0], nights[3]], items, booked: 0, bookings: 0, stations: ['Grill'], parts });
  check('fewer than two Saturdays: the last week’s nights instead', p.basis === 'recent' && p.nights.length === 2 && p.sameDay === 1);
  p = PL.planPrep({ day: '2026-11-21', nights: [nights[3]], items, booked: 0, bookings: 0, stations: ['Grill'], parts });
  check('…none on Saturdays at all: the page can say they may be closed', p.basis === 'recent' && p.sameDay === 0 && /closed/.test(src('src/app/(app)/prep/page.tsx')));
  p = PL.planPrep({ day: '2026-11-21', nights: nights.map((n) => ({ ...n, guests: null })), items, booked: 30, bookings: 5, stations: ['Grill'], parts });
  check('no guests counted (a counter café): a usual night as it was', p.guests === null && p.rows.find((r) => r.id === 'steak')!.make === 21);
  p = PL.planPrep({ day: '2026-11-21', nights: [], items, booked: 0, bookings: 0, stations: ['Grill'], parts });
  check('no nights yet: says so', p.basis === 'none' && p.rows.every((r) => r.isNew));

  console.log('on the server');
  const tenant: any = { name: 'Linden', timezone: 'America/New_York', kitchenSettings: { stations: ['Grill', 'Pastry'] } };
  await db.doc(T).set(tenant);
  const PS = await import('../../src/lib/prep-list-server');
  const days = PS.prepDays(tenant);
  const tomorrow = days[1];
  for (const [id, x] of [['steak', { name: 'Ribeye', type: 'refreshment', station: 'Grill', formula: [{ id: 'beef', name: 'Ribeye cut', quantityUsed: 1 }] }], ['tart', { name: 'Tart', type: 'refreshment', section: 'Desserts', station: 'Pastry' }], ['beef', { name: 'Ribeye cut', type: 'product', totalStock: 5 }]] as [string, any][])
    await db.doc(`${T}/inventory/${id}`).set(x);
  const { nightBounds } = await import('../../src/lib/night-close-server');
  const addD = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let k = 0;
  for (const w of [1, 2]) {
    const d = addD(tomorrow, -7 * w); const b = nightBounds(tenant, d); const at = new Date(Date.parse(b.start) + 5 * 3600000).toISOString();
    for (let i = 0; i < 10 + w; i++) await db.doc(`${T}/kdsTickets/k${++k}`).set({ itemId: 'steak', quantity: 1, status: 'delivered', createdAt: at });
    await db.doc(`${T}/kdsTickets/k${++k}`).set({ itemId: 'steak', quantity: 1, status: 'cancelled', createdAt: at });
    await db.doc(`${T}/serviceSessions/s${w}`).set({ businessDay: d, status: 'closed' });
    for (let i = 0; i < 5; i++) await db.doc(`${T}/parties/p${w}_${i}`).set({ sessionId: `s${w}`, status: 'finished', size: 4, seatedAt: at });
  }
  await db.doc(`${T}/tableBookings/tb1`).set({ day: tomorrow, status: 'booked', size: 30 });
  await db.doc(`${T}/tableBookings/tb2`).set({ day: tomorrow, status: 'cancelled', size: 8 });
  const Prep = await import('../../src/app/api/prep/route');
  let r: any = await Prep.POST(req({ tenantId: 't1', action: 'plan' }));
  const plan = r.body.plan; const row = plan.rows.find((x: any) => x.id === 'steak');
  check('tomorrow by default: two usual nights read (cancelled tickets not counted), 20 guests each, 30 booked (more than a usual night)', r.body.ok && plan.day === tomorrow && plan.basis === 'weekday' && plan.nights.length === 2 && plan.usualGuests === 20 && plan.booked === 30 && plan.bookings === 1 && plan.guests === 30, plan);
  check('…the steaks: 11.5 a usual night, for 30 guests not 20', row.make === Math.ceil(11.5 * 30 / 20) && row.low === 11 && row.high === 12, row);
  check('…and the beef it takes, short of what’s in stock', plan.needs[0].name === 'Ribeye cut' && plan.needs[0].have === 5 && plan.needs[0].need === row.make, plan.needs);
  r = await Prep.POST(req({ tenantId: 't1', action: 'done', day: tomorrow, itemId: 'steak', done: true, make: row.make }));
  check('ticked off as prepped, by whom, and how many it said then', r.body.ok && (await get(`${T}/prepLists/${tomorrow}`)).done.steak.by === 'Cam Lo' && (await get(`${T}/prepLists/${tomorrow}`)).done.steak.make === row.make);
  r = await Prep.POST(req({ tenantId: 't1', action: 'done', day: tomorrow, itemId: 'beef', done: true }));
  check('only dishes on the menu can be ticked', r.status === 400);
  check('a dish ticked at fewer than it says now shows as not done', /It’s \{r\.make\} now/.test(src('src/app/(app)/prep/page.tsx')));
  r = await Prep.POST(req({ tenantId: 't1', action: 'plan' }));
  check('…the list says so', !!r.body.plan.done.steak);
  r = await Prep.POST(req({ tenantId: 't1', action: 'done', day: '2020-01-01', itemId: 'steak', done: true }));
  check('only this coming week’s lists can be ticked', r.status === 400);
  r = await Prep.POST(req({ tenantId: 't1', action: 'plan', day: days[3] }));
  check('another day this week can be picked', r.body.plan.day === days[3]);

  console.log('the page');
  const page = src('src/app/(app)/prep/page.tsx');
  check('said to be an estimate, with the bookings and a usual night; ticks; prints; recipes against stock', /An estimate/.test(page) && /booked and/.test(page) && /role="checkbox"/.test(page) && /window\.print/.test(page) && /against what’s in stock right now/.test(page));
  check('in the sidebar and the hospitality pages', /'\/prep'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/prep'/.test(src('src/lib/modules.ts')));
  check('no emoji, all caps or niche words', !/[\u{1F300}-\u{1FAFF}]/u.test(page) && !/\buppercase\b|font-black/.test(page) && !/\b(salon|stylist|booth|chair)\b/i.test(page));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
