// Checks the event sheet (L20 round 22a, design canvas "Event sheet and final invoice"): lib/event-sheet (when in words,
// the seating, the money as quoted, what's included), lib/event-sheet-server and api/event-sheet (the sheet put together
// from the event, its quote and its night; the money for managers only), and the page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-sheet.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
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
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const E = await import('../../src/lib/event-sheet');
  console.log('in words');
  check('when: the day, and the time with its end from its length', E.whenWords({ date: '2026-11-20', time: '18:30', durationHours: 3.5 }) === 'Friday, November 20, 6:30 to 10 pm' && E.whenWords({ date: '2026-11-20', time: '11:00', durationMinutes: 180 }) === 'Friday, November 20, 11 am to 2 pm'
    && E.whenWords({ date: '2026-11-20', time: '19:00' }) === 'Friday, November 20, 7 pm' && E.whenWords({ date: '2026-11-20' }) === 'Friday, November 20' && E.whenWords({ date: '2026-11-20', time: '22:00', durationHours: 3 }) === 'Friday, November 20, 10 pm to 1 am'
    && E.whenWords({ date: '2026-11-20', time: '18:00', durationHours: 23 }) === 'Friday, November 20, 6 pm to 5 pm the next day' && E.whenWords({ date: '2026-11-20', time: '08:00', durationHours: 24 }) === 'Friday, November 20, 8 am to 8 am the next day'
    && E.whenWords({ date: '2026-11-20', time: '08:00', durationHours: 11 }) === 'Friday, November 20, 8 am to 7 pm' && E.whenWords({ date: '2026-11-20', time: '18:00', durationHours: 48 }) === 'Friday, November 20, 6 pm to 6 pm, 2 days later', E.whenWords({ date: '2026-11-20', time: '18:00', durationHours: 23 }));
  const tables = (shape: string, n: number, seats: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${shape}${from + i}`, name: String(from + i + 1), shape, seats: Array.from({ length: seats }, (_, j) => ({ id: `${shape}${from + i}s${j}`, label: String(j + 1) })) }));
  check('the seating: tables by shape and size', E.seatingWords({ seatingTables: [...tables('long', 5, 8), ...tables('round', 2, 6, 5)] }) === '5 long tables of 8 and 2 round tables of 6' && E.seatingWords({ seatingTables: tables('counter', 1, 6) }) === 'A counter of 6' && E.seatingWords({}) === '');
  const mo = E.sheetMoney({ quoteTotal: 4200, deposit: { amount: 1000, paid: true } });
  check('the money as quoted: total, deposit paid, what’s left before extras', mo.quotedCents === 420000 && mo.depositCents === 100000 && mo.depositPaid && mo.paidCents === 100000 && mo.balanceCents === 320000
    && E.sheetMoney({ quoteTotal: 4200, deposit: { amount: 1000, paid: false } }).balanceCents === 420000 && E.money(438250) === '$4,382.50');
  check('what’s included, from the quote, without prices', E.includedWords({ quoteLines: [{ name: 'Dinner, three courses', quantity: 40, price: 95 }, { name: 'Room hire', quantity: 1, price: 400 }] }).join('|') === 'Dinner, three courses (40)|Room hire');

  console.log('put together');
  const today = new Date().toISOString().slice(0, 10);
  await db.doc(T).set({ id: 't1', name: 'Linden', timezone: 'UTC' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Ana Ruiz', jobTitle: 'Server' }); await db.doc(`${T}/staff/s2`).set({ name: 'Kai Park', title: 'Line cook' });
  await db.doc(`${T}/studioEvents/e1`).set({ id: 'e1', title: 'Okafor rehearsal dinner', date: today, time: '18:30', durationHours: 3.5, venue: 'The back room', capacity: 40, clientName: 'Ada Okafor', clientPhone: '555 210 4471', clientEmail: 'ada@x.test',
    quoteId: 'q1', quoteLines: [{ name: 'Dinner, three courses', quantity: 40, price: 95 }, { name: 'Room hire', quantity: 1, price: 400 }], quoteTotal: 4200, deposit: { amount: 1000, paid: true, payments: [] },
    assignedStaffIds: ['s1', 's2', 'gone'], notes: 'Cake arrives at 5.', seatingTables: tables('long', 5, 8), seatPicking: { on: true } });
  await db.doc(`${T}/eventMenuItems/rib`).set({ id: 'rib', eventId: 'e1', name: 'Short rib', courseNumber: 2 });
  for (let i = 0; i < 3; i++) await db.doc(`${T}/eventGuests/g${i}`).set({ id: `g${i}`, eventId: 'e1', name: `Guest ${i}`, courseSelections: { 2: 'rib' }, allergies: i === 0 ? ['shellfish'] : [] });
  const R = await import('../../src/app/api/event-sheet/route');
  let r: any = await R.POST(req({ tenantId: 't1', eventId: 'e1' }));
  const s = r.body.sheet;
  check('the sheet: when, where, guests, the client, what’s included', r.body.ok && s.title === 'Okafor rehearsal dinner' && s.when.endsWith('6:30 to 10 pm') && s.where === 'The back room' && s.guests.guaranteed === 40 && s.guests.onList === 3 && s.client.name === 'Ada Okafor' && s.included.length === 2 && s.fromQuote, s);
  check('…the run of show, the menu from the guests’ choices with the allergies, the team by job, the seating, the notes', s.show.length >= 3 && s.menu.dishes[0].portions === 3 && s.menu.allergies[0].name === 'shellfish'
    && s.team.map((t: any) => `${t.name}/${t.job}`).join() === 'Ana/server,Kai/cook' && s.seating === '5 long tables of 8, guests choose their seats online' && s.notes === 'Cake arrives at 5.', s);
  check('…and for a manager, the money', s.money.quotedCents === 420000 && s.money.balanceCents === 320000);
  actor = { uid: 'a1', name: 'Ana', role: 'staff', isManager: false };
  r = await R.POST(req({ tenantId: 't1', eventId: 'e1' }));
  check('the team’s copy has no money on it, and not the notes from the quote', r.body.ok && r.body.sheet.money === null && r.body.manager === false && r.body.sheet.notes === null);
  check('…the client’s name, but their number and email only for the team on the event', r.body.sheet.client.name === 'Ada Okafor' && r.body.sheet.client.phone === null && r.body.sheet.client.email === null);
  actor = { uid: 'u9', staffId: 's1', name: 'Ana', role: 'staff', isManager: false };
  r = await R.POST(req({ tenantId: 't1', eventId: 'e1' }));
  check('…someone on the event gets them', r.body.sheet.client.phone === '555 210 4471' && r.body.sheet.client.email === 'ada@x.test');
  actor = { uid: 'rn', name: 'Rena', role: 'renter', isRenter: true };
  check('not for a renter; an event that isn’t there', (await R.POST(req({ tenantId: 't1', eventId: 'e1' }))).status === 403);
  actor = { uid: 'm1', name: 'Sam', role: 'manager', isManager: true };
  check('…', (await R.POST(req({ tenantId: 't1', eventId: 'nope' }))).status === 404 && (await R.POST(req({ tenantId: 't1', eventId: 'a/b' }))).status === 400);

  console.log('the page');
  const page = src('src/app/(app)/events/[eventId]/sheet/page.tsx'); const panel = src('src/components/events/EventNightPanel.tsx');
  check('the page prints on one page, and the event night links to it', page.includes('window.print()') && page.includes('print:hidden') && page.includes('Balance before extras') && panel.includes('/events/${eventId}/sheet'));
  check('the money prints only when a manager asks', page.includes("withMoney ? '' : 'print:hidden'") && page.includes('Print with money') && page.includes('Planned for') && page.includes("addEventListener('afterprint'"));
  const mine = page + src('src/lib/event-sheet.ts') + src('src/lib/event-sheet-server.ts') + src('src/app/api/event-sheet/route.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(page) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
