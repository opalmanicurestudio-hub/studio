// Checks the pre-shift briefing (L20 round 19, design canvas "Pre-shift briefing and staffing"): lib/briefing (guests
// hour by hour, staffing against the schedule, the bookings worth knowing), lib/prep-list (a usual night's shape by the
// hour), lib/briefing-server and api/briefing (put together for today or tomorrow, the manager's note, "Got it", the
// staffing numbers), and the page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/briefing.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
let deny: any = null;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (deny ? { deny } : level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor, tenant: {} }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const B = await import('../../src/lib/briefing');
  console.log('the numbers staffing goes by');
  check('16 guests a server, 30 an hour a cook, 40 a bartender, a host from 20 arriving an hour; the business’s own within range', JSON.stringify(B.staffingOf({})) === JSON.stringify({ perServer: 16, perCook: 30, perBartender: 40, hostAt: 20 })
    && B.staffingOf({ kitchenSettings: { staffing: { perServer: 12, perCook: 999 } } }).perServer === 12 && B.staffingOf({ kitchenSettings: { staffing: { perCook: 999 } } }).perCook === 30);
  check('…saved only when sensible', B.cleanStaffing({ perServer: 20 })?.perServer === 20 && B.cleanStaffing({ perServer: 2 }) === null && B.cleanStaffing({ perCook: 12.5 }) === null && B.cleanStaffing(null) === null);
  check('jobs from job titles', B.jobOf({ jobTitle: 'Server' }) === 'server' && B.jobOf({ title: 'Head waiter' }) === 'server' && B.jobOf({ title: 'Line cook' }) === 'kitchen' && B.jobOf({ title: 'Sous chef' }) === 'kitchen'
    && B.jobOf({ title: 'Bartender' }) === 'bar' && B.jobOf({ title: 'Barista' }) === 'bar' && B.jobOf({ title: 'Host' }) === 'host' && B.jobOf({ title: 'Busser' }) === 'support' && B.jobOf({ title: 'Dishwasher' }) === 'support'
    && B.jobOf({ role: 'manager' }) === 'manager' && B.jobOf({ title: '' }) === 'other' && B.jobOf({ title: 'Barback' }) === 'support' && B.jobOf({ title: 'Bar back' }) === 'support');

  console.log('guests hour by hour');
  const a = B.arrivals({ bookings: [{ time: '19:00', size: 4 }, { time: '19:30', size: 2 }, { time: '20:15', size: 8 }], events: [{ startHour: 18, endHour: 21, guests: 20 }], hours: [...Array(18).fill(0), 2, 6, 2, 0, 0, 0], walkIns: 30 });
  check('booked at their times, the event at its start, walk-ins the way a usual night came in', a.booked[19] === 6 && a.booked[20] === 8 && a.event[18] === 20 && Math.round(a.walkIn[19]) === 18 && Math.round(a.walkIn[18]) === 6 && Math.round(a.all[19]) === 24, a.all.slice(17, 22));
  const nb = B.arrivals({ bookings: [{ time: '19:00', size: 2 }], events: [], hours: null, walkIns: 40 });
  check('…no usual night’s hours to go by: walk-ins around the bookings, an hour either side', nb.placed && nb.walkIn[19] === 20 && nb.walkIn[18] === 10 && nb.walkIn[20] === 10, nb.walkIn.slice(17, 22));
  const none = B.arrivals({ bookings: [], events: [], hours: null, walkIns: 40 });
  check('…nothing to go by at all: not placed by the hour, and said so', !none.placed && none.walkIn.every((x) => x === 0));
  const arr = Array(24).fill(0); arr[19] = 30; arr[20] = 20;
  const h65 = B.inHouse(arr, 65); const h90 = B.inHouse(arr, 90);
  check('guests in the house: those arriving, and those still at the table from the hour before (a usual stay)', Math.round(h65[19]) === 30 && Math.round(h65[20] * 10) === Math.round((20 + 30 * 5 / 60) * 10) && Math.round(h90[20]) === 35 && Math.round(h90[21]) === 10);
  check('…an event’s guests for every hour it runs', B.inHouse(Array(24).fill(0), 65, [{ startHour: 18, endHour: 21, guests: 20 }]).slice(17, 22).join() === '0,20,20,20,0');

  console.log('staffing against the schedule');
  const dayStart = Date.parse('2026-11-20T00:00:00Z'); const at = (h: number) => dayStart + h * 3600000;
  const shift = (name: string, job: any, from: number, to: number) => ({ staffId: name, name, job, start: at(from), end: at(to) });
  const house = Array(24).fill(0); house[17] = 12; house[18] = 31; house[19] = 58; house[20] = 71; house[21] = 40;
  const arrive = Array(24).fill(0); arrive[17] = 12; arrive[18] = 25; arrive[19] = 40; arrive[20] = 30; arrive[21] = 5;
  const shifts = [shift('Ana', 'server', 16, 23), shift('Jo', 'server', 17, 23), shift('Sam', 'server', 18, 23), shift('Kai', 'kitchen', 15, 23), shift('Lu', 'kitchen', 18, 22), shift('Rae', 'bar', 17, 24), shift('Dee', 'host', 17.5, 21.5), shift('Max', 'other', 17, 22)];
  const rows = B.staffingRows({ arrive, house, kitchenLoad: arrive, shifts, s: B.DEFAULT_STAFFING, dayStart, hasJob: new Set(['server', 'kitchen', 'bar', 'host', 'other']) });
  const r19 = rows.find((r) => r.hour === 19)!; const r20 = rows.find((r) => r.hour === 20)!;
  check('each hour: guests, and what the night needs (by the numbers) against who’s on half the hour or more', r19.guests === 58 && r19.need.server === 4 && r19.have.server === 3 && r19.need.kitchen === 2 && r19.have.kitchen === 2 && r19.need.bar === 2 && r19.have.bar === 1 && r19.need.host === 1 && r19.have.host === 1 && r19.others === 1
    && r20.need.server === 5 && r20.need.bar === 2, { r19, r20 });
  check('…a bar and a host are only counted where someone does that job; prep time before the doors is listed, not “needed”', B.staffingRows({ arrive, house, kitchenLoad: arrive, shifts: [], s: B.DEFAULT_STAFFING, dayStart, hasJob: new Set(['server', 'kitchen']) }).every((r) => r.need.bar === 0 && r.need.host === 0)
    && rows.find((r) => r.hour === 15)!.need.kitchen === 0 && rows.find((r) => r.hour === 15)!.have.kitchen === 1);
  const gaps = B.staffingGaps(rows);
  check('where it’s short, said plainly', gaps.short.includes('a server 7 pm to 9 pm (two at 8 pm)') && gaps.short.includes('a bartender 7 pm to 9 pm') && gaps.shortHours === 2, gaps);
  check('…and where there are more servers or bartenders than the guests need', gaps.over.includes('a server 5 pm to 7 pm') && !gaps.over.some((x) => /cook/.test(x)), gaps.over);
  check('the hour, in words', B.hourWords(19) === '7 pm' && B.hourWords(12) === 'noon' && B.hourWords(0) === 'midnight' && B.hourWords(9) === '9 am' && B.hourWords(24) === 'midnight');

  console.log('bookings worth knowing');
  const k = B.bookingsToKnow([{ time: '19:00', name: 'Okafor', size: 8, asks: ['Birthday'] }, { time: '19:30', name: 'Rivera', size: 4, visits: 12, usual: ['Grilled bream', 'Oat latte'], teamNote: 'Window table if we can.' },
    { time: '20:00', name: 'Chen', size: 2, allergy: 'severe shellfish allergy' }, { time: '18:00', name: 'Nobody special', size: 2 }, { time: '20:15', name: 'Patel', size: 3, note: 'Bringing a stroller' }]);
  check('a big party, a birthday, a regular and their usual, an allergy, what they told us; nothing for an everyday booking', k.length === 4 && k[0].name === 'Okafor' && k[0].tags.some((t) => t.text === 'Birthday' && t.warn) && k[0].tags.some((t) => t.text === 'Party of 8')
    && k[1].tags.some((t) => t.text === 'Regular, 12 visits') && k[1].detail === 'Usually grilled bream and oat latte. Window table if we can.' && k[2].tags[0].text === 'severe shellfish allergy' && k[2].tags[0].warn && k[3].detail === 'They said: Bringing a stroller', k);

  console.log('a usual night’s shape');
  const PL = await import('../../src/lib/prep-list');
  const night = (day: string, byHour: number[]) => ({ day, guests: byHour.reduce((x, y) => x + y, 0), booked: 0, used: { burger: 5 }, byHour });
  const hrs = (h19: number, h20: number) => { const x = Array(24).fill(0); x[19] = h19; x[20] = h20; return x; };
  const plan = PL.planPrep({ day: '2026-11-20', nights: [night('2026-11-13', hrs(20, 10)), night('2026-11-06', hrs(30, 20))], items: [], booked: 0, bookings: 0, stations: [], parts: new Map() });
  check('guests seated each hour, averaged over the usual nights', plan.hours?.[19] === 25 && plan.hours?.[20] === 15 && plan.usualGuests === 40, plan.hours?.slice(18, 22));

  console.log('put together');
  const NC = await import('../../src/lib/night-close-server');
  await db.doc(T).set({ id: 't1', name: 'Linden', timezone: 'UTC', hostingSettings: { memory: { on: true } } });
  const today = NC.tonight(await get(T)); const PS = await import('../../src/lib/prep-list-server');
  const add = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const tomorrow = add(today, 1);
  for (const w of [7, 14]) {
    const d = add(today, -w);
    await db.doc(`${T}/serviceSessions/s${w}`).set({ id: `s${w}`, businessDay: d, status: 'closed', opensAt: `${d}T16:00:00Z` });
    for (let i = 0; i < 6; i++) await db.doc(`${T}/parties/p${w}_${i}`).set({ id: `p${w}_${i}`, sessionId: `s${w}`, status: 'finished', size: 4, seatedAt: `${d}T${i < 4 ? 19 : 20}:10:00.000Z` });
    await db.doc(`${T}/kdsTickets/k${w}`).set({ id: `k${w}`, menuItemId: 'burger', quantity: 5, status: 'delivered', createdAt: `${d}T19:20:00.000Z` });
  }
  await db.doc(`${T}/inventory/burger`).set({ id: 'burger', name: 'Burger', type: 'refreshment', msrp: 18, price: 18, totalStock: 50 });
  await db.doc(`${T}/inventory/squid`).set({ id: 'squid', name: 'Squid', type: 'refreshment', msrp: 14, price: 14, soldOut: true });
  for (const [id, name, title, role] of [['m1', 'Sam Lee', 'General manager', 'manager'], ['a1', 'Ana Ruiz', 'Server', 'staff'], ['j1', 'Jo Park', 'Server', 'staff'], ['c1', 'Kai Moss', 'Line cook', 'staff'], ['r1', 'Rae Kim', 'Bartender', 'staff'], ['x1', 'Max Bell', '', 'staff'], ['rn', 'Rena', 'Server', 'renter']])
    await db.doc(`${T}/staff/${id}`).set({ name, title, role, ...(role === 'renter' ? { isRenter: true } : {}) });
  const sh = (id: string, staffId: string, from: string, to: string, o: any = {}) => db.doc(`${T}/shifts/${id}`).set({ id, staffId, date: today, startTime: from, endTime: to, breakMinutes: 0, status: 'published', ...o });
  await sh('s1', 'a1', '16:00', '23:00'); await sh('s2', 'j1', '18:00', '23:00'); await sh('s3', 'c1', '15:00', '23:00'); await sh('s4', 'r1', '17:00', '23:30'); await sh('s5', 'x1', '17:00', '22:00');
  await sh('s6', 'j1', '09:00', '10:00', { kind: 'meeting' }); await sh('s7', 'a1', '11:00', '12:00', { status: 'draft' }); await sh('s8', 'rn', '17:00', '22:00');
  await db.doc(`${T}/clients/cli1`).set({ id: 'cli1', name: 'Mia Rivera', phone: '5550001234', searchKeys: ['5550001234'], intel: { allergies: { flags: ['Shellfish'] } } });
  await db.doc(`${T}/clients/cli2`).set({ id: 'cli2', name: 'Dana Fox', phone: '5550009999', searchKeys: ['5550009999'], intel: { allergies: { flags: ['Peanuts'] } } });
  await db.doc(`${T}/clients/cli3`).set({ id: 'cli3', name: 'Tom Rivera', phone: '5550007777', searchKeys: ['5550007777'], intel: { allergies: { flags: ['Sesame'] } } });
  const bk = (id: string, time: string, size: number, o: any = {}) => db.doc(`${T}/tableBookings/${id}`).set({ id, day: today, time, size, name: o.name || id, status: 'booked', asks: [], ...o });
  await bk('b1', '19:00', 8, { name: 'Okafor', asks: ['Birthday'] }); await bk('b2', '19:30', 4, { name: 'Mia Rivera', phone: '(555) 000-1234' }); await bk('b3', '20:00', 2, { name: 'Lee', phone: '555-000-9999' }); await bk('b6', '20:30', 2, { name: 'Rivera party', phone: '5550007777' });
  await bk('b4', '20:00', 2, { name: 'Gone', status: 'cancelled' }); await bk('b5', '19:00', 4, { name: 'Tomorrow person', day: tomorrow });
  await db.doc(`${T}/studioEvents/e1`).set({ id: 'e1', title: 'Wine dinner', date: today, time: '18:30', durationHours: 2.5, rsvpCount: 24, status: 'upcoming' });
  await db.doc(`${T}/studioEvents/e2`).set({ id: 'e2', title: 'Called off', date: today, time: '19:00', rsvpCount: 30, status: 'cancelled' });
  await db.doc(`${T}/studioEvents/e3`).set({ id: 'e3', title: 'Catering at the Lins’', date: today, time: '17:00', capacity: 80, quoteId: 'q1', status: 'upcoming' });
  await db.doc(`${T}/studioEvents/e4`).set({ id: 'e4', title: 'Wine dinner next week', date: add(today, 7), time: '18:30', rsvpCount: 20, status: 'upcoming' });
  const R = await import('../../src/app/api/briefing/route');
  let r: any = await R.POST(req({ tenantId: 't1', action: 'view' }));
  const b = r.body.briefing;
  check('today’s, by default; today and tomorrow to pick from', r.body.ok && b.day === today && b.tonight && b.days.join() === `${today},${tomorrow}`, r.body);
  check('guests: the booked (cancelled and other days left out), walk-ins like a usual night, the event’s', b.guests.booked === 16 && b.guests.bookings === 4 && b.guests.walkInsByHour === true && b.guests.eventGuests === 24 && b.guests.expected !== null && b.guests.walkIns !== null && b.guests.peak !== null, b.guests);
  check('…hour by hour, busiest marked; the event’s guests in from the hour it starts', b.guests.byHour.length > 0 && b.guests.byHour.some((x: any) => x.hour === 19) && b.guests.byHour.find((x: any) => x.hour === 18)?.guests >= 24, b.guests.byHour);
  check('who’s working: published work shifts only (not a meeting, a draft or a renter), with their jobs', b.working.map((w: any) => `${w.name}/${w.job}`).join() === 'Kai/cook,Ana/server,Max/team,Rae/bartender,Jo/server', b.working);
  check('staffing: hour by hour against the schedule, someone without a job title named as not counted', b.staffing.rows.length > 0 && b.staffing.unknown.join() === 'Max' && b.staffing.settings.perServer === 16 && b.staffing.rows.some((x: any) => x.hour === 19 && x.have.server === 2), b.staffing);
  const okafor = b.toKnow.find((x: any) => x.name === 'Okafor'); const rivera = b.toKnow.find((x: any) => x.name === 'Mia Rivera');
  check('bookings worth knowing: the birthday party of 8, and a regular’s allergy found from their number', okafor?.tags.some((t: any) => t.text === 'Birthday') && rivera?.tags.some((t: any) => /shellfish/.test(t.text) && t.warn) && rivera?.detail === null, b.toKnow);
  const party = b.toKnow.find((x: any) => x.name === 'Rivera party');
  check('…someone else on file under that number (another name altogether) shows nothing; the same family name shows who’s on file', !b.toKnow.some((x: any) => x.name === 'Lee') && party?.tags.some((t: any) => /sesame/.test(t.text)) && party?.detail === 'On file as Tom Rivera.', b.toKnow);
  check('the event on the day, by its own clock (not one called off, a private party from a quote, or next week’s)', b.events.length === 1 && b.events[0].title === 'Wine dinner' && b.events[0].guests === 24 && b.events[0].time === '18:30', b.events);
  check('staffing: a host only counted on a night a host is scheduled', b.staffing.rows.every((x: any) => x.need.host === 0), b.staffing.rows);
  await bk('b7', '21:00', 6, { name: 'Late add' });
  const again: any = await R.POST(req({ tenantId: 't1', action: 'view' }));
  const BS = await import('../../src/lib/briefing-server'); BS.forgetBriefing(T);
  const fresh: any = await R.POST(req({ tenantId: 't1', action: 'view' }));
  check('kept for a minute, so the whole team opening it reads the business once; let go when the numbers change', !again.body.briefing.toKnow.some((x: any) => x.name === 'Late add') && fresh.body.briefing.toKnow.some((x: any) => x.name === 'Late add'), [again.body.briefing.toKnow, fresh.body.briefing.toKnow]);
  check('the kitchen tonight: sold out', b.kitchen.soldOut.join() === 'Squid' && typeof b.kitchen.prepTotal === 'number', b.kitchen);
  r = await R.POST(req({ tenantId: 't1', action: 'view', day: tomorrow }));
  check('tomorrow’s: its own bookings, no sold-out list (that’s tonight’s)', r.body.briefing.day === tomorrow && !r.body.briefing.tonight && r.body.briefing.guests.booked === 4 && r.body.briefing.kitchen.soldOut.length === 0, r.body.briefing.guests);

  console.log('the note and “Got it”');
  r = await R.POST(req({ tenantId: 't1', action: 'note', day: today, text: '  New dessert tonight.   Patio is closed. ' }));
  let note = await get(`${T}/briefings/${today}`);
  check('the manager’s note for the day', r.body.ok && note.text === 'New dessert tonight. Patio is closed.' && note.by === 'Sam Lee', note);
  actor = { uid: 'a1', name: 'Ana Ruiz', role: 'staff', isManager: false, caps: [] };
  const rn: any = await R.POST(req({ tenantId: 't1', action: 'note', day: today, text: 'mine' }));
  r = await R.POST(req({ tenantId: 't1', action: 'read', day: today }));
  const v: any = await R.POST(req({ tenantId: 't1', action: 'view' }));
  check('only a manager writes it; anyone on the team says “Got it”, and sees who has', rn.status === 403 && r.body.ok && v.body.briefing.read.mine && v.body.briefing.read.names.join() === 'Ana' && v.body.briefing.read.notYet.join() === 'Kai,Max,Rae,Jo' && v.body.briefing.note.text === 'New dessert tonight. Patio is closed.' && v.body.manager === false, v.body.briefing.read);
  r = await R.POST(req({ tenantId: 't1', action: 'read', day: '2020-01-01' }));
  check('…only today or tomorrow', r.status === 400);
  actor = { uid: 'rn', name: 'Rena', role: 'renter', isRenter: true, isManager: false, caps: [] };
  r = await R.POST(req({ tenantId: 't1', action: 'view' }));
  check('a renter doesn’t get the business’s briefing', r.status === 403);
  actor = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
  r = await R.POST(req({ tenantId: 't1', action: 'staffing', staffing: { perServer: 12, perCook: 25, perBartender: 30, hostAt: 15 } }));
  const bad: any = await R.POST(req({ tenantId: 't1', action: 'staffing', staffing: { perServer: 1 } }));
  check('the staffing numbers: a manager’s, saved, and nonsense refused', r.body.ok && (await get(T)).kitchenSettings.staffing.perServer === 12 && bad.status === 400);
  await db.doc(T).set({ modules: { hospitality: false } }, { merge: true });
  r = await R.POST(req({ tenantId: 't1', action: 'view' }));
  check('…not where tables are off', r.status === 403);

  console.log('the page');
  const page = src('src/app/(app)/briefing/page.tsx');
  check('today or tomorrow, print, the guests as an estimate, staffing “scheduled of needed” and short, who’s working, the kitchen, the note and “Got it”', page.includes('Tonight’s briefing') && page.includes('window.print()') && page.includes('An estimate') && page.includes('Scheduled of needed') && page.includes('Short:') && page.includes('Who’s working') && page.includes('Prep still to do') && page.includes('Got it') && page.includes('From the manager'));
  check('in the sidebar and with the hospitality pages', /href: '\/briefing'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/briefing', '\/clear', '\/tables'/.test(src('src/lib/modules.ts')) && /'briefing'/.test(src('src/lib/app-theme.ts')));
  const mine = src('src/lib/briefing.ts') + src('src/lib/briefing-server.ts') + page;
  check('the briefing is the server’s: the team can’t write the note or who has read it from the browser', /'proLicenses', 'popups', 'briefings'/.test(src('firestore.rules')));
  check('says where the allergies come from, and to ask', page.includes('Always ask at the table') && page.includes('Could spare:') && !page.includes('More than needed'));
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(page));

  const pb = src('src/components/staff-portal/PortalBriefing.tsx'); const sp = src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx');
  check('the team’s phones: on a day with something to act on, a line at the top of Today opens the briefing, and Got it there counts as read', /action: 'view', tenantId/.test(pb) && /action: 'read', tenantId, day: b\.day/.test(pb) && /staffAuthHeader/.test(pb)
    && /\{!isRenter && isFoodBusiness\(portalTenant\) && <PortalBriefing tenantId=\{tenantId\} \/>\}/.test(sp) && sp.indexOf('<PortalBriefing') > sp.indexOf("{activeTab==='today' && !viewingWalkIns && (")
    && /if \(!b \|\| !\(b\.note \|\| b\.toKnow\.length \|\| b\.kitchen\?\.soldOut\?\.length \|\| b\.kitchen\?\.low\?\.length\)\) return null;/.test(pb) && />Open<\/span>/.test(pb)
    && !/font-black|\buppercase\b|salon|stylist|booth|studio/i.test(pb.replace(/^\/\/.*$/gm, '')));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
