// Checks choosing seats when buying event tickets (L20 round 20b, design canvas "Event night"): lib/event-seats (the map,
// what's taken or held, checking the seats asked for, a whole table), lib/event-tickets (seats held with the order, the
// guests seated when paid, the seats on the confirmation), api/public/event (the map on the event's page), api/event-night
// (a manager's switch), the seat picker and the page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-seats.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
// A stand-in for Stripe: checkouts, refunds, and what each was asked.
const calls: { what: string; params: any; opts: any }[] = [];
const sessions = new Map<string, any>(); let n = 0;
const fakeStripe: any = {
  checkout: { sessions: {
    create: async (params: any, opts: any) => { calls.push({ what: 'checkout', params, opts }); const id = `cs_test_${String(++n).padStart(6, '0')}`;
      const qty = params.line_items[0].quantity, unit = params.line_items[0].price_data.unit_amount;
      const s = { id, url: `https://checkout.stripe.test/${id}`, metadata: params.metadata, payment_status: 'unpaid', status: 'open', amount_total: qty * unit, payment_intent: null, created: Math.floor(Date.now() / 1000), account: opts?.stripeAccount };
      sessions.set(id, s); return s; },
    retrieve: async (id: string) => { const s = sessions.get(id); if (!s) throw Object.assign(new Error('No such checkout'), { statusCode: 404, code: 'resource_missing' }); return { ...s }; },
    expire: async (id: string, _p: any, opts: any) => { calls.push({ what: 'expire', params: { id }, opts }); const s = sessions.get(id); if (!s || s.status === 'complete') throw Object.assign(new Error('cannot expire'), { type: 'StripeInvalidRequestError' }); s.status = 'expired'; return s; },
  } },
  refunds: { create: async (params: any, opts: any) => { calls.push({ what: 'refund', params, opts }); if (refundAlready.has(params.payment_intent)) throw Object.assign(new Error('already refunded'), { code: 'charge_already_refunded', type: 'StripeInvalidRequestError' });
    const s = [...sessions.values()].find((x) => x.payment_intent === params.payment_intent); return { id: `re_${++n}`, amount: s?.amount_total || 0 }; } },
};
const refundAlready = new Set<string>(); let failCheckouts = 0;
const realCreate = fakeStripe.checkout.sessions.create;
fakeStripe.checkout.sessions.create = async (params: any, opts: any) => { if (failCheckouts > 0) { failCheckouts--; calls.push({ what: 'checkout-failed', params, opts }); throw Object.assign(new Error('timeout'), { type: 'StripeConnectionError' }); } return realCreate(params, opts); };
const pay = (id: string) => { const s = sessions.get(id)!; s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = `pi_${id.slice(-6)}`; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'stripe') return { __esModule: true, default: function Stripe() { return fakeStripe; } };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor: { name: 'Jess Manager' } }), staffOrServer: async () => true });
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const list = async (c: string, k: string, v: any) => (await db.collection(c).where(k, '==', v).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const mails: any[] = [];
let mailDown = 0;
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) { if (mailDown > 0) { mailDown--; return { ok: false, status: 503, json: async () => ({ message: 'down' }), text: async () => 'down' }; } mails.push(JSON.parse(init.body)); } return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; };


(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';
  const S = await import('../../src/lib/event-seats');
  const chart = [{ id: 't5', name: '5', x: 20, y: 30, seats: [1, 2, 3, 4].map((n) => ({ id: `t5s${n}`, label: String(n) })) }, { id: 't6', name: '6', x: 60, y: 30, seats: [1, 2].map((n) => ({ id: `t6s${n}`, label: String(n) })) }, { id: 'tb', name: 'Bar', seats: [] }];
  const ev = { seatingTables: chart, seatPicking: { on: true, wholeTables: true } };
  console.log('the map');
  check('seat choice only with a seating chart that has seats', S.seatPickingOf(ev).on && S.seatPickingOf(ev).wholeTables && !S.seatPickingOf({ seatPicking: { on: true } }).on && !S.seatPickingOf({ seatingTables: chart }).on);
  const now = Date.now();
  const use = S.seatsInUse([{ tableNumber: '5', seatNumber: '1' }, { tableNumber: '5', seatNumber: '2', status: 'cancelled' }, { name: 'Unseated' }],
    [{ id: 'o1', status: 'pending', holdUntil: new Date(now + 60000).toISOString(), seats: [{ table: '5', seat: '3' }] }, { id: 'o2', status: 'pending', holdUntil: new Date(now - 60000).toISOString(), seats: [{ table: '6', seat: '1' }] }, { id: 'o3', status: 'paid', seats: [{ table: '6', seat: '2' }] }], now);
  check('taken by a guest on the list, held by a checkout still open; not a cancelled guest, a hold run out, or a paid order (its guests are on the list)', use.taken.has('5#1') && !use.taken.has('5#2') && use.held.has('5#3') && !use.held.has('6#1') && !use.held.has('6#2') && use.taken.size === 1 && use.held.size === 1);
  const map = S.seatMap(ev, use);
  check('the map: each table with seats open, taken or held, never who; a table with no seats left off', map.length === 2 && map[0].seats.map((s) => s.state).join() === 'taken,open,held,open' && map[0].x === 20 && !map[0].wholeOpen && map[1].wholeOpen && !JSON.stringify(map).includes('Unseated'), map);
  console.log('choosing');
  const ok1 = S.pickSeats(ev, use, { picks: [{ tableId: 't5', seatId: 't5s2' }, { tableId: 't5', seatId: 't5s4' }], max: 8 });
  check('open seats chosen', ok1.ok && ok1.seats.map((s) => `${s.table}/${s.seat}`).join() === '5/2,5/4' && ok1.whole === null);
  const bad = (o: any) => { const r = S.pickSeats(ev, use, { max: 2, ...o }); return r.ok ? '' : r.error; };
  check('not a seat taken or being paid for, one twice, too many, or one not on the map', /just been taken/.test(bad({ picks: [{ tableId: 't5', seatId: 't5s1' }] })) && /just been taken/.test(bad({ picks: [{ tableId: 't5', seatId: 't5s3' }] }))
    && /once/.test(bad({ picks: [{ tableId: 't5', seatId: 't5s2' }, { tableId: 't5', seatId: 't5s2' }] })) && /up to 2/.test(bad({ picks: [{ tableId: 't5', seatId: 't5s2' }, { tableId: 't5', seatId: 't5s4' }, { tableId: 't6', seatId: 't6s1' }] }))
    && /isn’t on the map/.test(bad({ picks: [{ tableId: 't9', seatId: 'x' }] })) && /Choose your seats/.test(bad({ picks: [] })));
  const wh = S.pickSeats(ev, use, { wholeTable: 't6', max: 8 });
  check('a whole table: every seat at it, when all are open', wh.ok && wh.seats.length === 2 && wh.whole === 't6' && /taken a seat/.test(bad({ wholeTable: 't5' })) && /aren’t sold online/.test((S.pickSeats({ ...ev, seatPicking: { on: true } }, use, { wholeTable: 't6', max: 8 }) as any).error || ''));
  const typed = S.seatsInUse([{ tableNumber: 'Table 5 ', seatNumber: 'Seat 2' }, { tableNumber: 'x', seatNumber: 'y', tableId: 't6', seatId: 't6s1' }], []);
  check('a seat the team typed another way (“Table 5”, “Seat 2”), or gave by the chart’s ids, is taken', S.seatMap(ev, typed)[0].seats[1].state === 'taken' && S.seatMap(ev, typed)[1].seats[0].state === 'taken'
    && !S.pickSeats(ev, typed, { picks: [{ tableId: 't5', seatId: 't5s2' }], max: 8 }).ok && !S.pickSeats(ev, typed, { picks: [{ tableId: 't6', seatId: 't6s1' }], max: 8 }).ok);
  check('in words', S.seatWords([{ table: '5', seat: '6' }, { table: '5', seat: '7' }]) === 'Table 5, seats 6 and 7' && S.seatWords([{ table: 'Patio', seat: 'A' }]) === 'Patio, seat A');

  console.log('what kind of table it is');
  const K2 = await import('../../src/lib/table-kinds');
  const sane = (shape: any, n: number) => { const d = K2.drawTable(shape, n); const inTop = (p: any) => p.x > d.top.x + 2 && p.x < d.top.x + d.top.w - 2 && p.y > d.top.y + 2 && p.y < d.top.y + d.top.h - 2;
    let close = Infinity; for (let i = 0; i < d.seats.length; i++) for (let j = i + 1; j < d.seats.length; j++) close = Math.min(close, Math.hypot(d.seats[i].x - d.seats[j].x, d.seats[i].y - d.seats[j].y));
    return d.seats.length === n && close >= 14 && d.seats.every((p) => !inTop(p) && p.x >= 0 && p.y >= 0 && p.x <= d.w && p.y <= d.h); };
  check('every shape draws each seat once, apart, off the table and inside its box (1 to 20 seats)', ['round', 'square', 'long', 'counter'].every((sh) => [1, 2, 4, 5, 6, 8, 10, 12, 20].every((n) => sane(sh, n))));
  const longT = K2.drawTable('long', 10);
  check('a long table: down both sides, and one at each end from six seats', longT.seats.filter((p) => p.y === 10).length === 4 && longT.seats.filter((p) => p.y === longT.h - 10).length === 4 && longT.seats.filter((p) => p.y === longT.h / 2).length === 2 && K2.drawTable('long', 4).seats.every((p) => p.y !== 38));
  check('a counter: seats in a row on one side', new Set(K2.drawTable('counter', 6).seats.map((p) => p.y)).size === 1);
  check('in words', K2.tableKindWords({}) === 'A round table' && K2.tableKindWords({ shape: 'round', features: ['high_top'] }) === 'A round high-top' && K2.tableKindWords({ shape: 'long', features: ['window', 'quiet'] }) === 'A long table, by the window and in a quieter spot'
    && K2.tableKindWords({ shape: 'counter', features: ['outside'] }) === 'A counter, outside' && K2.tableKindWords({ shape: 'oval', features: ['nonsense'] }) === 'A round table');
  const kinded = { seatingTables: [{ ...chart[0], shape: 'long', features: ['window', 'step_free', 'x'], note: '  Next to   the stage  ' }, chart[1]], seatPicking: { on: true } };
  const km = S.seatMap(kinded, S.seatsInUse([], []));
  check('the map carries each table’s shape and kind (an older table is round)', km[0].shape === 'long' && km[0].kind === 'A long table, by the window and with step-free access' && km[0].features.join() === 'By the window,Step-free access' && km[0].note === 'Next to the stage' && km[1].shape === 'round' && km[1].note === null, km);

  console.log('buying seats');
  const { POST } = await import('../../src/app/api/public/event/route');
  const K = await import('../../src/lib/event-tickets');
  const SP = await import('../../src/lib/studio-page'); const { addDays } = await import('../../src/lib/tenant-time');
  const call = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? `10.2.0.${Math.floor(Math.random() * 200)}` : null) }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  const tenant = { name: 'Linden', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', stripeAccountId: 'acct_biz', stripeChargesEnabled: true };
  await db.doc(T).set(tenant);
  const soon = addDays(SP.eventToday(tenant), 5);
  const big = { id: 'tb10', name: '10', x: 50, y: 70, seats: Array.from({ length: 10 }, (_, i) => ({ id: `b${i + 1}`, label: String(i + 1) })) };
  await db.doc(`${T}/studioEvents/ev1`).set({ title: 'Wine dinner', date: soon, time: '18:30', capacity: 40, status: 'upcoming', ticketingConfig: { type: 'paid', price: 95 }, seatingTables: [...chart, big], seatPicking: { on: true, wholeTables: true } });
  await db.doc(`${T}/eventGuests/g1`).set({ id: 'g1', eventId: 'ev1', name: 'Seated already', tableNumber: '5', seatNumber: '1' });
  const l1 = await call({ action: 'load', tenantId: 't1', eventId: 'ev1' });
  check('the event’s page gets the map (only open, taken or held) and whether whole tables sell', l1.ok && l1.tickets.seats.wholeTables === true && l1.tickets.seats.tables.length === 3 && l1.tickets.seats.tables[0].seats[0].state === 'taken' && !JSON.stringify(l1.tickets.seats).includes('Seated already'), l1.tickets);
  const b1 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Ana Ruiz', email: 'ana@x.test', qty: 1, seats: [{ tableId: 't5', seatId: 't5s2' }, { tableId: 't5', seatId: 't5s3' }] });
  const c1 = calls.filter((c) => c.what === 'checkout').pop()!;
  const o1 = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev1'))[0];
  check('the tickets are the seats chosen (not the number sent), held with the order, and named on the checkout', b1.ok && o1.qty === 2 && o1.totalCents === 19000 && o1.seats.map((s: any) => s.seat).join() === '2,3' && c1.params.line_items[0].quantity === 2 && /Table 5, seats 2 and 3/.test(c1.params.line_items[0].price_data.product_data.description), { o1, d: c1.params.line_items[0] });
  const b2 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Bo Chen', email: 'bo@x.test', seats: [{ tableId: 't5', seatId: 't5s3' }] });
  check('someone else can’t take a seat held while the first pays', b2.status === 409 && /just been taken/.test(b2.error), b2);
  const l2 = await call({ action: 'load', tenantId: 't1', eventId: 'ev1' });
  check('…and the map shows it as being paid for', l2.tickets.seats.tables[0].seats.map((s: any) => s.state).join() === 'taken,held,held,open', l2.tickets.seats.tables[0]);
  const b3 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Okafor', email: 'ok@x.test', wholeTable: 'tb10' });
  const o3 = (await list(`${T}/eventTicketOrders`, 'email', 'ok@x.test'))[0];
  check('a whole table of 10: every seat, more than the 8 tickets a guest can buy one by one', b3.ok && o3.qty === 10 && o3.wholeTable === 'tb10' && o3.totalCents === 95000, o3);
  const s1 = sessions.get(o1.sessionId); pay(o1.sessionId);
  const f1 = await K.finishTicketOrder(db, fakeStripe, 't1', o1.sessionId, sessions.get(o1.sessionId));
  const gs = (await list(`${T}/eventGuests`, 'ticketOrderId', o1.id)).sort((a: any, b: any) => a.id.localeCompare(b.id));
  check('paid: the guests go on the list in their seats, and the buyer is told which', f1.ok && (f1 as any).seats === 'Table 5, seats 2 and 3' && gs.map((g: any) => `${g.tableNumber}/${g.seatNumber}/${g.tableId}`).join() === '5/2/t5,5/3/t5' && !!s1, { f1, gs });
  pay(o3.sessionId); await K.finishTicketOrder(db, fakeStripe, 't1', o3.sessionId, sessions.get(o3.sessionId));
  check('…a whole table’s ten guests too', (await list(`${T}/eventGuests`, 'ticketOrderId', o3.id)).length === 10);
  const mail = mails.find((m) => /Your tickets for Wine dinner/.test(m.subject) && m.to?.[0] === 'ana@x.test' || (/Wine dinner/.test(m.subject) && JSON.stringify(m).includes('ana@x.test')));
  check('the confirmation email names the seats', !!mail && /Your seats: Table 5, seats 2 and 3/.test(mail.text || mail.html || ''), mails.map((m) => m.subject));
  await db.doc(`${T}/studioEvents/ev2`).set({ title: 'No map', date: soon, capacity: 10, status: 'upcoming', ticketingConfig: { type: 'paid', price: 20 }, seatPicking: { on: true } });
  const b4 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev2', name: 'Cy', email: 'cy@x.test', qty: 2 });
  const o4 = (await list(`${T}/eventTicketOrders`, 'email', 'cy@x.test'))[0];
  check('no seating chart: tickets as before, by number', b4.ok && o4.qty === 2 && !o4.seats && !(await call({ action: 'load', tenantId: 't1', eventId: 'ev2' })).tickets.seats);

  // The team seats someone by hand at a seat being paid for: the money goes back rather than two guests in one seat.
  const b5 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Dee', email: 'dee@x.test', seats: [{ tableId: 't6', seatId: 't6s1' }] });
  const o5 = (await list(`${T}/eventTicketOrders`, 'email', 'dee@x.test'))[0];
  await db.doc(`${T}/eventGuests/hand1`).set({ id: 'hand1', eventId: 'ev1', name: 'Walk-in VIP', tableNumber: 'Table 6', seatNumber: '1' });
  pay(o5.sessionId); const f5: any = await K.finishTicketOrder(db, fakeStripe, 't1', o5.sessionId, sessions.get(o5.sessionId));
  const r5 = await get(`${T}/eventTicketOrders/${o5.id}`);
  check('a seat given by hand while it was being paid for: refunded, and told which happened', b5.ok && f5.status === 'sold_out' && f5.seatTaken === true && (await K.finishTicketOrder(db, fakeStripe, 't1', o5.sessionId) as any).seatTaken === true && read('src/app/event/[tenantId]/[eventId]/page.tsx').includes('r.seatTaken ?') && r5.status === 'refunded' && r5.seatTaken === true && (await list(`${T}/eventGuests`, 'ticketOrderId', o5.id)).length === 0
    && mails.some((m) => JSON.stringify(m).includes('were given to someone else while you were paying')), r5);
  const eight = (id: string) => ({ id, name: id.toUpperCase(), seats: Array.from({ length: 8 }, (_, i) => ({ id: `${id}${i + 1}`, label: String(i + 1) })) });
  await db.doc(`${T}/studioEvents/ev3`).set({ title: 'Gala', date: soon, capacity: 60, status: 'upcoming', ticketingConfig: { type: 'paid', price: 50 }, seatingTables: [eight('ta'), eight('tc'), eight('td')], seatPicking: { on: true, wholeTables: true } });
  const from = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? '10.9.9.9' : null) }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  const h1 = await from({ action: 'buy', tenantId: 't1', eventId: 'ev3', name: 'Hog', email: 'h1@x.test', wholeTable: 'ta' });
  const h2 = await from({ action: 'buy', tenantId: 't1', eventId: 'ev3', name: 'Hog', email: 'h2@x.test', wholeTable: 'tc' });
  const h3 = await from({ action: 'buy', tenantId: 't1', eventId: 'ev3', name: 'Hog', email: 'h3@x.test', wholeTable: 'td' });
  check('one connection holds no more than a table’s worth (20 seats) while paying', h1.ok && h2.ok && h3.status === 409 && /Finish paying/.test(h3.error), h3);
  console.log('the manager’s switch');
  const N = await import('../../src/app/api/event-night/route');
  const night = async (body: any) => { const r: any = await N.POST({ json: async () => body, headers: { get: () => 'Bearer x' } } as any); return { status: r.status, ...r.body }; };
  let v = await night({ tenantId: 't1', eventId: 'ev1', action: 'view' });
  check('the event night shows seats taken of the chart', v.ok && v.night.seats.paid && v.night.seats.chart && v.night.seats.total === 16 && v.night.seats.taken === 14 && v.night.seats.on, v.night?.seats);
  const off = await night({ tenantId: 't1', eventId: 'ev1', action: 'seats', on: false, wholeTables: true });
  check('a manager turns seat choice off (whole tables with it)', off.ok && (await get(`${T}/studioEvents/ev1`)).seatPicking.on === false && (await get(`${T}/studioEvents/ev1`)).seatPicking.wholeTables === false);
  const noChart = await night({ tenantId: 't1', eventId: 'ev2', action: 'seats', on: true, wholeTables: false });
  check('…and can’t turn it on without a seating chart', noChart.status === 409);

  console.log('the page');
  const page = read('src/app/event/[tenantId]/[eventId]/page.tsx'); const picker = read('src/components/events/SeatPicker.tsx'); const panel = read('src/components/events/EventNightPanel.tsx');
  check('the event’s page: choose your seats on the map, a whole table, the seats on the confirmation', page.includes('<SeatPicker') && page.includes('Choose your seats') && page.includes('wholeTable: whole') && page.includes('done.seats') && picker.includes('Buy the whole table') && picker.includes('Someone paying now'));
  check('the manager’s switches on the event night', panel.includes('Seats online') && panel.includes('Let guests choose seats') && panel.includes('Sell whole tables too'));
  check('the seating chart sets each table’s shape, what guests should know and a note; the picker draws the shape and says what kind it is', read('src/components/events/SeatingChartTab.tsx').includes('<TableKindFields table={table}') && read('src/components/events/TableKindFields.tsx').includes('What guests should know')
    && picker.includes('drawTable(t.shape') && picker.includes('cur.kind') && picker.includes('cur.note') && /replace\(\/\^table\\s\+\/i, ''\)/.test(picker));
  const mine = picker + read('src/lib/event-seats.ts') + read('src/lib/table-kinds.ts') + read('src/components/events/TableKindFields.tsx');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(picker + read('src/components/events/TableKindFields.tsx')) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(picker + read('src/components/events/TableKindFields.tsx')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
