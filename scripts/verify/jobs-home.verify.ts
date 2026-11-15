// Checks jobs and home screens (rounds 24 and 25, design canvas "Jobs and home screens"): lib/jobs (each job's home,
// its short menu, the station it asks for), the briefing counting people by their job, the dish and barback screens in
// the menu and in the hospitality tool, the food business's team step, a table's tab selling only the menu, the kitchen
// screen worked as yourself on your own phone (api/kitchen: its counts and Allergy noted only for the kitchen side),
// the add and edit dialogs asking for a job, the sidebar's groups, and the dashboard opening someone's own screen.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/jobs-home.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'c1', name: 'Lee Park', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

(async () => {
  const J = await import('../../src/lib/jobs');
  const B = await import('../../src/lib/briefing');
  const Mo = await import('../../src/lib/modules');
  const G = await import('../../src/lib/setup-guide');

  console.log('jobs');
  check('fourteen jobs, each with a name, how the briefing counts it and a line on what it means', J.JOBS.length === 14 && J.JOBS.every((j) => j.name && j.counts && j.line && j.line.length < 140));
  check('a job that isn’t ours is none', J.jobDef('chef') === null && J.jobDef(undefined) === null && J.cleanJob('cook') === 'cook' && J.cleanJob('boss') === null);
  const stations = ['Grill', 'Fry', 'Bar'];
  check('a cook works the first station that isn’t the bar; a bartender the bar’s; a server none', J.stationFor(J.jobDef('cook'), stations) === 'Grill' && J.stationFor(J.jobDef('bartender'), stations) === 'Bar' && J.stationFor(J.jobDef('server'), stations) === null);
  check('…a business with no bar station leaves a bartender’s station for them to pick', J.stationFor(J.jobDef('bartender'), ['Kitchen']) === null && J.stationFor(J.jobDef('cook'), ['Bar']) === 'Bar');
  check('a station kept on someone’s record counts only while the business still has it', J.keptStation('grill', stations) === 'Grill' && J.keptStation('Pizza', stations) === null);
  const home = (id: string, st?: string) => J.homeOf(J.jobDef(id), 't1', st || null);
  check('a server opens on My tables, a host on the host stand, a busser on Clear tables, the counter on the front desk', home('server') === '/tables' && home('host') === '/host' && home('busser') === '/clear' && home('counter') === '/pos');
  check('a cook opens on the kitchen screen at their station, as themselves', home('cook', 'Grill') === '/kds/t1?station=Grill&me=1', home('cook', 'Grill'));
  check('…a bartender at the bar, expo on the expo view', home('bartender', 'Bar') === '/kds/t1?station=Bar&me=1' && home('expo') === '/kds/t1?view=expo&me=1', [home('bartender', 'Bar'), home('expo')]);
  check('a dishwasher opens on the dish screen, a barback on the barback’s, the drive-thru on its lane', home('dishwasher') === '/dish/t1' && home('barback') === '/barback/t1' && home('drive_thru') === '/drive-thru/t1');
  check('a manager and a shift lead open on the pre-shift briefing; something else on the dashboard', home('manager') === '/briefing' && home('shift_lead') === '/briefing' && home('other') === null);
  check('everyone’s short menu has their messages and schedule; something else has none of its own', J.JOBS.filter((j) => j.id !== 'other').every((j) => j.menu.includes('/messages') && j.menu.includes('/my-schedule') && (!j.home || j.menu.includes(j.home))) && J.jobDef('other')!.menu.length === 0);
  check('managers and shift lead run the night: briefing, host stand, menu, prep and close, then every station screen', J.runsTheNight(J.jobDef('manager')) && J.runsTheNight(J.jobDef('shift_lead')) && !J.runsTheNight(J.jobDef('cook'))
    && J.TONIGHT.join() === '/briefing,/host,/menu,/prep,/close' && J.STATION_SCREENS.join() === '/kds,/dish,/barback,/floor,/drive-thru');
  check('a page in a menu that isn’t a station screen is opened as it is', J.pageHref('/tables', 't1', { job: J.jobDef('server') }) === '/tables' && J.pageHref('/kds', 't1') === '/kds/t1');
  check('the kitchen side: cook, bartender, expo, shift lead, manager', J.KITCHEN_SIDE.join() === 'cook,bartender,expo,shift_lead,manager');

  console.log('the briefing counts people by their job');
  check('a job set on the record wins over the title', B.jobOf({ job: 'cook', jobTitle: 'Server' }) === 'kitchen' && B.jobOf({ job: 'bartender' }) === 'bar' && B.jobOf({ job: 'host' }) === 'host' && B.jobOf({ job: 'dishwasher' }) === 'support' && B.jobOf({ job: 'manager', role: 'staff' }) === 'manager');
  check('…with none set (or one that isn’t ours), the title still decides as before', B.jobOf({ jobTitle: 'Line cook' }) === 'kitchen' && B.jobOf({ job: 'wizard', jobTitle: 'Server' }) === 'server' && B.jobOf({}) === 'other');

  console.log('the menu and the tools');
  check('the dish and barback screens belong to Lounge & hospitality: off with it, on with it', !Mo.pageVisible({ modules: { hospitality: false } }, '/dish') && !Mo.pageVisible({ modules: { hospitality: false } }, '/barback') && Mo.pageVisible({}, '/dish') && Mo.pageVisible({}, '/barback'));
  const foodTeam = G.FOOD_GUIDE_STEPS.find((s) => s.id === 'team')!;
  const plainTeam = G.GUIDE_STEPS.find((s) => s.id === 'team')!;
  check('a food business’s team step talks about jobs, not people clients book', /each with their job/.test(foodTeam.meaning) && !/book/.test(foodTeam.meaning) && /clients book/.test(plainTeam.meaning) && foodTeam.href === plainTeam.href);

  console.log('the kitchen screen, as yourself');
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York', businessType: 'hospitality', userId: 'own' });
  await db.doc(`${T}/staff/c1`).set({ name: 'Lee Park', role: 'staff', job: 'server' });
  await db.doc(`${T}/inventory/bream`).set({ name: 'Grilled bream', type: 'refreshment', price: 31 });
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', source: 'tab', menuItemId: 'bream', menuItemName: 'Grilled bream', status: 'pending', createdAt: at(5), allergies: [{ name: 'Tree nuts', severity: 'severe' }], contains: ['Tree nuts'] });
  const Kitchen = await import('../../src/app/api/kitchen/route');
  let r: any = await Kitchen.POST(req({ action: 'tickets', tenantId: 't1' }));
  check('signed in on their own phone, a team member reads the tickets with no screen key', r.body.ok && (r.body.tickets || []).some((t: any) => t.id === 'k1'), r.body);
  const seen = (await import('../../src/lib/allergens')).allergySig(await get(`${T}/kdsTickets/k1`));
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', col: 'kdsTickets', id: 'k1', seen }));
  check('a server can’t say an allergy was seen: that’s the kitchen’s', r.status === 403 && /kitchen/.test(r.body.error) && !(await get(`${T}/kdsTickets/k1`)).allergyNotedAt, r.body);
  r = await Kitchen.POST(req({ action: 'count', tenantId: 't1', itemId: 'bream', value: 6 }));
  check('…nor set tonight’s counts', r.status === 403);
  r = await Kitchen.POST(req({ action: 'closing', tenantId: 't1' }));
  check('anyone on the team reads the kitchen’s closing items as themselves', r.body.ok && Array.isArray(r.body.items), r.body);
  await db.doc(T).set({ closingSettings: { items: [{ id: 'fr', label: 'Walk-in fridge', area: 'kitchen', kind: 'temp', min: 33, max: 41 }, { id: 'dm', label: 'Dish machine drained', area: 'dish', kind: 'check' }, { id: 'any', label: 'Trash out', area: 'anyone', kind: 'check' }] } }, { merge: true });
  const items = (await Kitchen.POST(req({ action: 'closing', tenantId: 't1' }))).body.items || [];
  const fr = items.find((i: any) => i.area === 'kitchen'); const dm = items.find((i: any) => i.area === 'dish'); const any = items.find((i: any) => i.area === 'anyone');
  r = fr ? await Kitchen.POST(req({ action: 'closingCheck', tenantId: 't1', itemId: fr.id, done: true, value: 38 })) : { status: 0, body: {} };
  check('…but a server can’t log the kitchen’s fridge temperature from their phone', !!fr && r.status === 403 && /kitchen/.test(r.body.error), { items, r: r.body });
  r = any ? await Kitchen.POST(req({ action: 'closingCheck', tenantId: 't1', itemId: any.id, done: true })) : { status: 0, body: {} };
  check('…what’s for anyone, anyone can tick', !!any && r.body.ok, r.body);
  await db.doc(`${T}/staff/c1`).set({ job: 'dishwasher' }, { merge: true });
  r = dm ? await Kitchen.POST(req({ action: 'closingCheck', tenantId: 't1', itemId: dm.id, done: true })) : { status: 0, body: {} };
  const r2 = fr ? await Kitchen.POST(req({ action: 'closingCheck', tenantId: 't1', itemId: fr.id, done: true, value: 38 })) : { status: 0, body: {} };
  check('…the dishwasher ticks the dish pit’s, not the kitchen’s', !!dm && r.body.ok && r2.status === 403, [r.body, r2.body]);
  await db.doc(`${T}/staff/c1`).set({ job: null, jobTitle: 'Line cook' }, { merge: true });
  r = fr ? await Kitchen.POST(req({ action: 'closingCheck', tenantId: 't1', itemId: fr.id, done: true, value: 38 })) : { status: 0, body: {} };
  check('…someone with no job set whose title says cook counts as the kitchen (set up before jobs)', r.body.ok, r.body);
  await db.doc(`${T}/staff/c1`).set({ job: 'server', jobTitle: null }, { merge: true });
  await db.doc(`${T}/staff/c1`).set({ job: 'cook', station: 'Kitchen' }, { merge: true });
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', col: 'kdsTickets', id: 'k1', seen }));
  check('a cook on their own phone notes it, under their own name', r.body.ok && (await get(`${T}/kdsTickets/k1`)).allergyNotedBy === 'Lee Park', r.body);
  r = await Kitchen.POST(req({ action: 'count', tenantId: 't1', itemId: 'bream', value: 6 }));
  check('…and sets tonight’s count', r.body.ok, r.body);
  await db.doc(`${T}/staff/c1`).set({ job: 'server' }, { merge: true }); actor.isManager = true; actor.role = 'manager';
  r = await Kitchen.POST(req({ action: 'count', tenantId: 't1', itemId: 'bream', value: 7 }));
  check('a manager can, whatever their job', r.body.ok, r.body);
  actor.isManager = false; actor.role = 'staff';
  r = await Kitchen.POST(req({ action: 'pair', tenantId: 't1', name: 'Line' }));
  check('setting up a shared screen stays a manager’s', r.status === 403);
  r = await Kitchen.POST(req({ action: 'pin', tenantId: 't1', pin: '1234' }));
  check('a PIN is only for a shared screen (no key: not set up)', r.status === 401);

  console.log('the screens');
  const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('the kitchen screen opens at the station or expo it was given, and as yourself with no key here', /q\.get\('station'\)/.test(kds) && /q\.get\('view'\) === 'expo'/.test(kds) && /q\.get\('me'\) === '1'/.test(kds) && /!read\(keyName\(tenantId\)\)/.test(kds));
  check('…its set-up page offers "Just use it as me", and as yourself there’s no PIN, no key, and no stopping a screen', /Just use it as me, on this device/.test(kds) && /As you, on this device/.test(kds) && /Stop using it here/.test(kds) && /\.\.\.\(key \? \{ key \} : \{\}\)/.test(kds) && /staff && key \? \{ staffPass/.test(kds));
  check('…it waits for the sign-in to come back before reading, and tries once more before asking to sign in again (each time it starts)', /!me \|\| isUserLoading/.test(kds) && /retried\.current = true/.test(kds) && /setMe\(false\); retried\.current = false/.test(kds) && /setStaff\(null\); retried\.current = false; setMe\(true\)/.test(kds));
  const side = src('src/components/shared/AppSidebar.tsx');
  check('the menu: Dish and Barback next to the kitchen screen; a job holder’s own group; Tonight and Station screens for whoever runs the night', /'\/kds',\s+icon: ChefHat[\s\S]{0,260}'\/dish',\s+icon[\s\S]{0,80}'\/barback'/.test(side)
    && /label="Your work"/.test(side) && /label="Tonight"/.test(side) && /label="Station screens"/.test(side) && /'Everything else'/.test(side) && /useNoteMoves\(pathname\)/.test(side));
  check('…a manager or admin at a food business runs the night too; the owner keeps the whole menu', /runsTheNight\(myJob\?\.job \|\| null\) \|\| \(\(role === 'admin' \|\| role === 'manager'\) && isFoodBusiness\(selectedTenant\)\)/.test(side) && /!isOwner && !!tenantId/.test(side));
  const dash = src('src/app/(app)/dashboard/page.tsx'); const hook = src('src/hooks/use-my-job.ts');
  check('the dashboard opens someone’s own screen once a visit, never when they went to it themselves', /useOpenJobHome\(\);/.test(dash) && /ss\.get\(k\) \|\| ss\.get\(MOVED\)/.test(hook) && /router\.replace\(home\)/.test(hook) && /role !== 'owner' && isFoodBusiness/.test(hook));
  const add = src('src/components/staff/AddStaffDialog.tsx'); const edit = src('src/components/staff/EditStaffDialog.tsx'); const pick = src('src/components/staff/JobPicker.tsx');
  check('adding someone asks their job; a job nobody books skips services and booking hours (both ways)', /<JobPicker adding roleIds=/.test(add) && /prev === 1 && skipsBooking/.test(add) && /prev === 3 && skipsBooking/.test(add) && /job: z\.string\(\)\.optional\(\)/.test(add) && /step === 3 && skipped/.test(add));
  check('…the role list follows what’s picked (a controlled list), and their card asks the job too', /<Select onValueChange=\{field\.onChange\} value=\{field\.value\}>/.test(add) && /<JobPicker \/>/.test(edit) && /job: z\.string\(\)\.optional\(\)/.test(edit) && /job: \(staffMember as any\)\.job \|\| ''/.test(edit));
  check('…a food business only; the role offered goes with the job until one’s picked by hand; off the booking page, paid by the hour', /if \(!isFoodBusiness\(selectedTenant\)\) return null/.test(pick) && /!getFieldState\('role'\)\.isDirty/.test(pick) && /setValue\('showOnPublicPage', false\)/.test(pick) && /setValue\('payStructure', 'hourly'\)/.test(pick));
  check('…new screens keep the house style: 44px taps, no capitals or heavy type', !/uppercase|font-black| · /.test(pick) && /min-h-\[44px\]/.test(pick) && !/\{\/\*/.test(pick));
  const tab = src('src/components/host/TableTab.tsx');
  check('a food business’s table tab sells the menu only when there is one (not the shop’s stock or services); any other business keeps everything', /const menu = isFoodBusiness\(tenant\) \? sellable\.filter\(\(x: any\) => x\.type === 'refreshment'/.test(tab) && /const prods = menu\.length \? menu : sellable/.test(tab) && /const svcs = menu\.length \? \[\]/.test(tab));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
