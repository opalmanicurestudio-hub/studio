// Checks a renter's own mileage log in their portal (Money, Your business, Mileage; included in rent;
// api/portal/renter-mileage, lib/mileage-actions, lib/trip-log-server, components/rent/RenterMileage):
//   Signed in with the portal's session (a session for another business, or one run out, gets nothing). The same log the
//   business keeps (drives, trips added after, home and commuting, the year, the spreadsheet), kept apart in
//   tenants/{t}/private/renter_{id}/mileage: the business's log never shows it, and theirs never shows the business's.
//   Drives start from where they rent their space. Nothing in the business's activity. No suggested drives, and none
//   of the business's card purchases or events can be logged into it. Reached by anyone with a renter record, whether
//   or not they take bookings here.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-mileage.verify.ts
import fs from 'fs';
import Module from 'module';
import { createHash } from 'crypto';
import { makeDb, check, failures } from './fake-db';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb(); const actor: any = { id: 'u1', uid: 'u1', name: 'Jess', isTenantOwner: true, role: 'owner' };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor, tenant: { name: 'North Loft', timezone: 'America/New_York' } }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async (_d: any, _t: any, e: any) => { audits.push(e); } };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [{ id: 'main', name: 'North Loft', address: '201 Elm St, Raleigh, NC 27601', coordinates: { lat: 35.78, lng: -78.64 } }] };
  if (request === '@/lib/geocode-server') return {
    geocode: async (a: string) => (/oak st/i.test(a) ? { lat: 35.79, lng: -78.66, label: '12 Oak St, Raleigh, NC 27605', postal: '27605', confidence: 'exact' } : /pine/i.test(a) ? { lat: 35.81, lng: -78.69, label: '9 Pine St, Raleigh, NC 27603', postal: '', confidence: 'exact' } : { lat: 35.72, lng: -78.70, label: `${a} (found)`, postal: '', confidence: 'high' }),
    reverseGeocode: async () => ({ lat: 35.8, lng: -78.6, label: '88 Main St, Raleigh, NC 27601', postal: '', confidence: 'exact' }),
    preciseEnough: (g: any) => !!g && g !== 'down' };
  if (request === '@/lib/route-server') return { roadLegs: async (pts: any[]) => ({ road: true, min: pts.map(() => pts.map(() => 5)), miles: pts.map((a: any, i: number) => pts.map((b: any, k: number) => (i === k ? 0 : Math.round((Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng)) * 1000) / 10))) }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ownerReq = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
const renterReq = (body: any, token = 'tok-ana', tenantId = 't1') => ({ json: async () => ({ tenantId, token, ...body }), headers: { get: () => null } }) as any;
const docsIn = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const ANA = 'tenants/t1/private/renter_r1/mileage';

(async () => {
  await db.doc('tenants/t1').set({ name: 'North Loft', timezone: 'America/New_York' });
  await db.doc('tenants/t2').set({ name: 'Elsewhere', timezone: 'America/New_York' });
  await db.doc('tenants/t1/private/renterSessions').set({ [sha('tok-ana')]: { renterId: 'r1', name: 'Ana Ruiz', expiresAt: Date.now() + 3600e3 }, [sha('tok-old')]: { renterId: 'r1', name: 'Ana Ruiz', expiresAt: Date.now() - 1 }, [sha('tok-bo')]: { renterId: 'r2', name: 'Bo', expiresAt: Date.now() + 3600e3 } });
  const RENTER: (r: any) => Promise<any> = (await import('../../src/app/api/portal/renter-mileage/route')).POST as any;
  const OWNER: (r: any) => Promise<any> = (await import('../../src/app/api/mileage/route')).POST as any;

  console.log('Who gets in');
  let r: any = await RENTER(renterReq({ action: 'list' }, ''));
  check('no session: asked to sign in again', r.status === 401);
  r = await RENTER(renterReq({ action: 'list' }, 'tok-old'));
  check('a session run out: asked to sign in again', r.status === 401);
  r = await RENTER(renterReq({ action: 'list' }, 'tok-ana', 't2'));
  check('a session for another business: nothing', r.status === 401);
  r = await RENTER(renterReq({ action: 'list' }, 'tok-ana', '../t1'));
  check('a made-up business id: refused', r.status === 400);
  r = await RENTER(renterReq({ action: 'list' }));
  check('signed in: their log, theirs to keep, no suggestions, drives start from where they rent their space', r.status === 200 && r.body.owner === true && r.body.suggestions.length === 0 && r.body.origin?.ref === 'biz:main' && r.body.trips.length === 0, r.body);

  console.log('A drive, kept apart');
  await OWNER(ownerReq({ action: 'start', lat: 35.7801, lng: -78.6401 }));
  r = await RENTER(renterReq({ action: 'list' }));
  check('the owner’s drive under way isn’t theirs', r.body.drive === null);
  r = await RENTER(renterReq({ action: 'start', lat: 35.7801, lng: -78.6401 }));
  check('started at the space: named as the business they rent from', r.status === 200 && r.body.from.ref === 'biz:main', r.body);
  r = await RENTER(renterReq({ action: 'end', lat: 35.8, lng: -78.6 }));
  check('ended: the street address and the miles by road', r.status === 200 && r.body.to.label === '88 Main St, Raleigh, NC 27601' && r.body.oneWayTenths > 0, r.body);
  r = await RENTER(renterReq({ action: 'save', purpose: 'supplies', note: 'Gel polish', roundTrip: true }));
  const t1 = r.body.trip;
  check('saved as theirs: by them, why, both ways', r.status === 200 && t1.by.name === 'Ana Ruiz' && t1.by.id === 'renter_r1' && t1.purpose === 'supplies' && t1.roundTrip && t1.use === 'business', t1);
  const anaDocs = await docsIn(ANA); const bizDocs = await docsIn('tenants/t1/private');
  check('kept under their own place, not the business’s', anaDocs.some((d: any) => d.kind === 'trip' && d.id.endsWith(t1.id)) && !bizDocs.some((d: any) => d.kind === 'trip'), anaDocs.map((d: any) => d.id));
  check('nothing kept holds their session', !JSON.stringify(anaDocs).includes('tok-ana'));
  r = await OWNER(ownerReq({ action: 'list' }));
  check('the business’s log doesn’t show it, and its drive is still its own', r.status === 200 && r.body.trips.length === 0 && !!r.body.drive && !r.body.drive.ended, r.body.trips);
  await OWNER(ownerReq({ action: 'end', lat: 35.9, lng: -78.9 })); await OWNER(ownerReq({ action: 'save', purpose: 'bank' }));
  r = await RENTER(renterReq({ action: 'list' }));
  check('their log doesn’t show the business’s trip', r.body.trips.length === 1 && r.body.trips[0].id === t1.id);
  r = await RENTER(renterReq({ action: 'list' }, 'tok-bo'));
  check('another renter’s log is their own: empty', r.status === 200 && r.body.trips.length === 0);
  r = await RENTER(renterReq({ action: 'remove', id: t1.id }, 'tok-bo'));
  check('another renter can’t take a trip out of theirs', r.status === 404);
  check('nothing in the business’s activity from the renter', audits.every((e) => !/renter/.test(String(e.actor?.id || ''))) && audits.filter((e) => /mile trip|Downloaded/.test(e.summary)).length === 0);

  console.log('Home, commuting, trips added after');
  r = await RENTER(renterReq({ action: 'setup', home: { label: '12 Oak St, Raleigh' } }));
  check('home kept in their log', r.status === 200 && (await db.doc(`${ANA}/tripSetup`).get()).data()?.home?.ref === 'home');
  r = await OWNER(ownerReq({ action: 'list' }));
  check('the business’s log has no home from the renter', r.body.setup.home === null && !r.body.places.some((p: any) => p.ref === 'home'));
  r = await RENTER(renterReq({ action: 'add', from: { ref: 'home' }, to: { ref: 'biz:main' }, day: '2026-11-20', purpose: 'supplies' }));
  check('home to the space they rent: commuting', r.status === 200 && r.body.trip.use === 'commute');
  r = await RENTER(renterReq({ action: 'add', from: { ref: 'biz:main' }, to: { label: '9 Pine St' }, day: '2026-11-21', purpose: 'class', roundTrip: true }));
  check('a trip added after, from the map', r.status === 200 && r.body.trip.how === 'map' && r.body.trip.tenths > 0);
  r = await RENTER(renterReq({ action: 'list' }));
  check('the year: their business miles and commuting kept apart', r.body.summary.trips === 2 && r.body.summary.businessTenths > 0 && r.body.summary.commuteTenths > 0, r.body.summary);
  r = await RENTER(renterReq({ action: 'export', year: 2026 }));
  check('their log as a spreadsheet', r.status === 200 && /9 Pine St/.test(r.body.csv) && !/88 Main St.*bank/i.test(r.body.csv));

  console.log('Nothing of the business’s');
  await db.doc('tenants/t1/bankTransactions/b1').set({ direction: 'out', context: 'Business', date: '2026-11-24', merchant: 'Beauty Supply', amountCents: 6420, place: { address: '50 Market St, Raleigh', lat: 35.82, lng: -78.61 } });
  await db.doc('tenants/t1/studioEvents/e1').set({ title: 'Bridal party', date: '2026-11-22', venue: 'The Glass House', address: { street: '400 Hill Rd', city: 'Cary', state: 'NC', zip: '27511' }, status: 'upcoming' });
  r = await RENTER(renterReq({ action: 'list' }));
  check('the business’s card purchases and events aren’t suggested to them', r.body.suggestions.length === 0);
  r = await RENTER(renterReq({ action: 'suggested', id: 'card_b1' }));
  const r2: any = await RENTER(renterReq({ action: 'suggested', id: 'event_e1' }));
  check('and can’t be logged into their log by asking', r.status === 400 && r2.status === 400 && !(await docsIn(ANA)).some((d: any) => /^trip_s_/.test(d.id)));
  r = await RENTER(renterReq({ action: 'dismiss', id: 'card_b1' }));
  check('or passed over', r.status === 400);
  r = await OWNER(ownerReq({ action: 'list' }));
  check('the owner still has them', r.body.suggestions.some((s: any) => s.id === 'card_b1'));
  const lst: any = (await RENTER(renterReq({ action: 'list' }))).body.trips;
  check('no business purchase is taken as proof on their trips', lst.every((t: any) => !t.proof));

  console.log('Their own log’s limits');
  r = await RENTER(renterReq({ action: 'setup', homeIsMain: true }));
  check('“run from home” isn’t theirs to set: their space is where they work', r.status === 200 && (await db.doc(`${ANA}/tripSetup`).get()).data()?.homeIsMain !== true);
  let last: any = null; for (let i = 0; i < 125; i++) last = await RENTER(renterReq({ action: 'miles', from: { ref: 'biz:main' }, to: { label: '9 Pine St' } }));
  check('map lookups have a ceiling per renter an hour, and it says to try later or type the miles', last.status === 429 && /this hour\. Try again later, or type the miles/.test(last.body.error));
  r = await RENTER(renterReq({ action: 'list' }));
  check('and seeing their log never does', r.status === 200);
  r = await RENTER(renterReq({ action: 'miles', from: { ref: 'biz:main' }, to: { label: '9 Pine St' } }, 'tok-bo'));
  check('another renter’s ceiling is their own', r.status === 200);

  console.log('Where it is');
  const PM = await import('../../src/components/rent/portal-map');
  const base = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('Money, Your business, Mileage: for anyone with a renter record, booking here or not', PM.viewAllowed('mileage', base) && PM.viewAllowed('mileage', { ...base, booksHere: true }) && !PM.viewAllowed('mileage', { ...base, hasRenter: false })
    && PM.VIEW_PARENT.mileage === 'money' && PM.placeRows('money', base).some((g: any) => g.id === 'business' && g.views.includes('mileage')));
  const page = src('src/app/rent/[tenantId]/page.tsx'); const wrap = src('src/components/rent/RenterMileage.tsx'); const screen = src('src/components/money/MileageScreen.tsx');
  check('the portal opens it with their session, and the print names their business', /case 'mileage': return <RenterMileage tenantId=\{tenantId\} token=\{token\} business=\{renterBrand \|\|/.test(page) && /'\/api\/portal\/renter-mileage'/.test(wrap) && /JSON\.stringify\(\{ \.\.\.body, tenantId, token \}\)/.test(wrap));
  check('their screen says home is seen only by them, and has no “run the business from home”', /seen only by \{renter \? 'you: never by the business you rent from'/.test(screen) && /\{!renter && <label/.test(screen));
  check('and says to download the log before the lease ends', /\{p\.renter && <p[^>]*>Your log is yours: download it from The year’s log any time, and before your lease ends/.test(screen));
  const route = src('src/app/api/portal/renter-mileage/route.ts');
  check('the renter’s route: no suggestions, nothing in the business’s activity, the session left out of what’s passed on', /suggest: false/.test(route) && /audit: async \(\) => \{\}/.test(route) && /const \{ token: _t, homeIsMain: _h, \.\.\.body \} = b;/.test(route));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
