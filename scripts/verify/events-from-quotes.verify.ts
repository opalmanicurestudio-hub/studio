// Checks events made from quotes, and events on the calendar (L17 part 2):
// - An event holds its day on the planner for the team on it (lib/event-block): its hours on the business's own clock,
//   the whole day with no start time, and only the team on it (everyone when nobody's named). The events page writes
//   it when an event is made or changed and lets it go when it's deleted; the event page moves it when the team changes,
//   and tells each person added or taken off.
// - Convert to Event carries everything from the quote (lib/quote-convert): the client and their address, the team, the
//   day and start time, how long, what was quoted and the deposit. Once; it replaces the hold made at acceptance, and
//   the team on it is told.
// - The travel on a new quote is measured by road on the map (api/quote/distance), never made up; when it can't be
//   measured, it says so. A quote keeps its day as the day, and its start time.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/events-from-quotes.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

let geo: Record<string, any> = {}; let pins: any[] = []; let route: any = { routes: [{ distance: 16093.44, duration: 1500 }] }; let routeOk = true;
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => ({ doc: () => ({ get: async () => ({ data: () => ({ address: { street: '1 Main St', city: 'Springfield', state: 'IL', zip: '62701' } }) }) }) }) };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor: { uid: 'm1' } }) };
  if (request === '@/lib/delivery-server') return { pinnedLocations: async () => pins };
  if (request === '@/lib/geocode-server') return {
    hasMapsKey: () => !!process.env.MAPBOX_TOKEN,
    geocode: async (q: string) => (q in geo ? geo[q] : null),
    preciseEnough: (g: any) => !!g && g !== 'down',
  };
  return load.call(this, request, ...rest);
};
(global as any).fetch = async () => ({ ok: routeOk, json: async () => route });
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const NY = 'America/New_York';
  console.log('the hold on the calendar');
  const B = await import('../../src/lib/event-block');
  const b1 = B.eventBlockFor({ id: 'e1', title: 'Spring team day', date: '2026-12-05', time: '19:00', durationHours: 2, assignedStaffIds: ['st1', 'st2'] }, NY)!;
  check('its hours on the business’s clock (7pm New York for 2 hours), for the team on it', b1.id === 'studio_event_e1' && b1.startTime === '2026-12-06T00:00:00.000Z' && b1.endTime === '2026-12-06T02:00:00.000Z' && b1.staffIds.join() === 'st1,st2' && b1.type === 'blocked' && b1.allDay === false, b1);
  const b2 = B.eventBlockFor({ id: 'e2', title: 'Market day', date: '2026-12-05', time: '' }, NY)!;
  check('no start time: the whole day, for everyone', b2.allDay === true && b2.startTime === '2026-12-05T05:00:00.000Z' && b2.staffIds.join() === 'all', b2);
  const b3 = B.eventBlockFor({ id: 'e3', title: 'Gala', date: '2026-12-05', time: '7:30 PM' }, NY)!;
  check('a time written “7:30 PM” is read too (three hours when no length is set)', b3.startTime === '2026-12-06T00:30:00.000Z' && b3.endTime === '2026-12-06T03:30:00.000Z', b3);
  const b4 = B.eventBlockFor({ id: 'e4', title: 'Old one', date: '2026-12-05T05:00:00.000Z', time: '10:00' }, NY)!;
  check('a day kept as a moment is read on the business’s clock (not a day early)', b4.startTime === '2026-12-05T15:00:00.000Z', b4);
  check('no day: no hold', B.eventBlockFor({ id: 'e5', date: '' }, NY) === null);
  const b6 = B.eventBlockFor({ id: 'e6', title: 'From a quote', date: '2026-12-05', time: '14:00', holdAllDay: true }, NY)!;
  check('an event from a quote with a start time but no hours holds the whole day, as accepting it did', b6.allDay === true && b6.startTime === '2026-12-05T05:00:00.000Z', b6);
  check('a change moves only its times, team and name (what the planner keeps on it stays)', Object.keys(B.blockTimes(b1)).sort().join() === 'allDay,endTime,isStudioEventBlock,linkedStudioEventId,staffIds,startTime,title,type');

  console.log('an event made from a quote');
  const C = await import('../../src/lib/quote-convert');
  const dayOf = (d: Date) => (require('../../src/lib/tenant-time') as any).dayKey(d, NY);
  const ev = C.eventFromQuote({ id: 'q1', eventName: 'Spring team day', clientId: 'c1', eventDate: '2026-12-05', startTime: '14:00', totalHours: 3, partySize: 12,
    eventLocation: { street: '12 Mill St', city: 'Springfield', state: 'IL', zip: '62701' }, lineItems: [{ id: 's1', name: 'Group class', price: 40, quantity: 10 }], travelExpenses: 50, projectFee: 10,
    depositAmount: 100, depositPaid: true, payments: [{ amount: 100 }], staffPayouts: [{ staffId: 'st1', name: 'Ana', amount: 200 }], notes: 'Bring aprons' },
    { id: 'c1', name: 'Sam Lee', email: 'sam@example.com', phone: '5550100' }, dayOf);
  check('the client and their address, the team, the day, start time and length', ev.clientId === 'c1' && ev.clientName === 'Sam Lee' && ev.clientPhone === '5550100' && ev.venue === '12 Mill St, Springfield, IL, 62701' && ev.address?.city === 'Springfield'
    && ev.assignedStaffIds.join() === 'st1' && ev.date === '2026-12-05' && ev.time === '14:00' && ev.durationHours === 3 && ev.capacity === 12, ev);
  check('…what was quoted, the total and the deposit (paid)', ev.quoteLines.length === 1 && ev.quoteLines[0].name === 'Group class' && ev.quoteTotal === 490 && ev.deposit.amount === 100 && ev.deposit.paid === true && ev.quoteId === 'q1', ev);
  const old = C.eventFromQuote({ id: 'q2', eventName: 'X', eventDate: '2026-12-05T05:00:00.000Z' }, null, dayOf);
  check('an older quote’s day (kept as a moment) comes out as the right day', old.date === '2026-12-05', old.date);

  console.log('travel, measured');
  const { POST: DIST } = await import('../../src/app/api/quote/distance/route');
  const to = { street: '12 Mill St', city: 'Springfield', state: 'IL', zip: '62701' };
  delete process.env.MAPBOX_TOKEN;
  let r: any = await DIST(req({ tenantId: 't1', to }));
  check('no map here: it says so, and the miles are typed', r.status === 503 && /Type the miles/.test(r.body.error), r.body);
  process.env.MAPBOX_TOKEN = 'pk.test';
  geo = { '1 Main St, Springfield, IL, 62701': { lat: 39.8, lng: -89.6, label: 'shop', confidence: 'exact' }, '12 Mill St, Springfield, IL, 62701': { lat: 39.9, lng: -89.7, label: '12 Mill St', confidence: 'exact' } };
  r = await DIST(req({ tenantId: 't1', to }));
  check('by road, there and back (10 miles each way: 20), with the drive time', r.body.ok && r.body.roundTripMiles === 20 && r.body.oneWayMinutes === 25, r.body);
  geo = { '1 Main St, Springfield, IL, 62701': geo['1 Main St, Springfield, IL, 62701'] };
  r = await DIST(req({ tenantId: 't1', to }));
  check('an address that can’t be found: said, never guessed', r.status === 422 && !r.body.roundTripMiles, r.body);
  r = await DIST(req({ tenantId: 't1', to: { city: 'X' } }));
  check('an address too short to look up: asked for first', r.status === 400);

  console.log('the pages');
  const qn = src('src/app/(app)/quotes/new/page.tsx');
  check('the new quote measures travel on the map (no made-up 124 miles), and keeps its day as the day, with a start time', !/setRoundTripDistance\(124\)/.test(qn) && /fetch\('\/api\/quote\/distance'/.test(qn) && /eventDate: eventStartDate \? format\(eventStartDate, 'yyyy-MM-dd'\) : null,/.test(qn) && /startTime: \/\^\\d\{2\}:\\d\{2\}\$\/\.test\(eventStartTime\)/.test(qn));
  const evp = src('src/app/(app)/events/page.tsx');
  check('the events page holds an event’s day when it’s made or changed, and lets go when it’s deleted', (evp.match(/await hold\(/g) || []).length === 2 && /deleteDoc\(doc\(firestore, `tenants\/\$\{tenantId\}\/events`, eventBlockId\(event\.id\)\)\)/.test(evp)
    && /setDoc\(ref, blockTimes\(b\), \{ merge: true \}\)/.test(evp));
  check('…older events get their hold once, only where there isn’t one', /getDoc\(ref\)\.then\(\(snap\) => \(snap\.exists\(\) \? undefined : setDoc\(ref, b\)\)\)/.test(evp));
  check('the planner doesn’t draw an event twice (its hold isn’t drawn in the business column), and the old unused hold writer is gone', /!\(e as any\)\.isStudioEventBlock/.test(src('src/app/(app)/planner/page.tsx')) && !require('fs').existsSync('src/hooks/useStudioEventBlocking.ts'));
  const man = src('src/app/(app)/events/[eventId]/manifest/page.tsx');
  check('the event page tells each person added or taken off, and moves the hold to the team', /type: 'event_assigned'/.test(man) && /type: 'event_unassigned'/.test(man) && /eventBlockFor\(\{ \.\.\.event, id: eventId, assignedStaffIds: ids \}/.test(man));
  check('…and shows the day without slipping a day early', /function dayText\(v: any, fmt: string\)/.test(man) && !/format\(new Date\(event\.date\)/.test(man));
  const qp = src('src/components/quotes/ConvertToEventDialog.tsx');
  check('Convert to Event: once, everything from the quote, its hold in place of the acceptance hold, the team told', /if \(cur\.convertedToEventId\) return \{ eventId: String\(cur\.convertedToEventId\), already: true \};/.test(qp) && /const ev = eventFromQuote\(/.test(qp)
    && /tx\.delete\(doc\(firestore, `tenants\/\$\{tenantId\}\/events`, `quote_\$\{quote\.id\}`\)\);/.test(qp) && /type: 'event_assigned'/.test(qp));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
