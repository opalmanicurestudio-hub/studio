// Checks the floor's phones (round 27, design canvas "The floor's phones"): a PIN sign-in from the team app reaching My
// tables, Clear tables and the host stand (the app's tenant context, the scope that keeps it to those pages, the menu,
// the team app's links, the database rules for the floor's records); the host stand's tablet set up once (api/kitchen
// 'pair' kind host and 'hostToken', lib/staff-auth signing it in as the host stand while it's set up, stopping it ends
// its sign-in, its key good for nothing else); and the table's server buzzed (lib/floor-buzz: a guest's ask, a course
// ready at the pass, a new table), each once, with a buzz that opens the floor page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/floor-phones.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const minted: any[] = []; const revoked: string[] = []; let tokenFor: any = null;
const users = new Set<string>(); const disabled = new Set<string>();
const fakeAuth = {
  createCustomToken: async (uid: string, claims: any) => { minted.push({ uid, claims }); users.add(uid); return `tok_${minted.length}`; },
  revokeRefreshTokens: async (uid: string) => { if (!users.has(uid)) { const e: any = new Error('none'); e.code = 'auth/user-not-found'; throw e; } revoked.push(uid); },
  updateUser: async (uid: string, p: any) => { if (!users.has(uid)) { const e: any = new Error('none'); e.code = 'auth/user-not-found'; throw e; } if (p.disabled) disabled.add(uid); },
  createUser: async (p: any) => { users.add(p.uid); if (p.disabled) disabled.add(p.uid); return p; },
  verifyIdToken: async () => { if (!tokenFor) throw new Error('bad'); return tokenFor; },
};
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let realGuard = false;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => fakeAuth, getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (!realGuard && (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request))) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const notes = async (type: string) => (await all(`${T}/notifications`)).filter((n: any) => n.type === type);

(async () => {
  await db.doc(T).set({ name: 'North Loft', userId: 'own', businessType: 'hospitality' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Lee Park', role: 'staff', job: 'server' });
  await db.doc(`${T}/staff/s2`).set({ name: 'Kai Moss', role: 'staff', job: 'server' });

  console.log('the host stand’s tablet');
  const K = await import('../../src/app/api/kitchen/route');
  let r: any = await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: '' }));
  const key = r.body.key;
  const { screenHash } = await import('../../src/lib/screen-keys');
  const h = screenHash(key); const sc: any = await get(`kitchenScreens/${h}`);
  check('a manager sets it up once: a key of its own kind, named the host stand', r.body.ok && sc?.kind === 'host' && sc.name === 'Host stand' && r.body.name === 'Host stand', sc);
  actor.isManager = false; actor.role = 'staff';
  r = await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host' }));
  check('…only a manager can', r.status === 403);
  actor.isManager = true; actor.role = 'manager';
  r = await K.POST(req({ tenantId: 't1', action: 'hostToken', key }));
  check('its key signs it in as the host stand: a team app sign-in that names the screen, front desk, never a renter', r.body.ok && r.body.token === 'tok_1' && minted[0].uid === `portal:t1:screen_${h}`
    && minted[0].claims.portal === true && minted[0].claims.tenantId === 't1' && minted[0].claims.staffId === `screen_${h}` && minted[0].claims.role === 'front_desk' && minted[0].claims.screen === true && minted[0].claims.isRenter === false
    && (await get(`kitchenScreens/${h}`)).authUid === `portal:t1:screen_${h}`, { b: r.body, m: minted[0] });
  r = await K.POST(req({ tenantId: 't1', action: 'hostToken', key: 'x'.repeat(64) }));
  check('…a key that isn’t one is refused', r.status === 401);
  r = await K.POST(req({ tenantId: 't1', action: 'tickets', key }));
  check('…and its key is good for nothing on the kitchen screen', r.status === 401);
  const kitchenKey = (await K.POST(req({ tenantId: 't1', action: 'pair', name: 'Line' }))).body.key;
  r = await K.POST(req({ tenantId: 't1', action: 'hostToken', key: kitchenKey }));
  check('…nor can a kitchen screen’s key sign in as the host stand', r.status === 401);

  console.log('signed in as the host stand');
  realGuard = true;
  const SA = await import('../../src/lib/staff-auth');
  tokenFor = { uid: `portal:t1:screen_${h}`, portal: true, tenantId: 't1' };
  let a: any = await SA.verifyStaffActor(req({}), 't1');
  check('while it’s set up: the host stand, front desk steps, under the tablet’s name, not a person', a.ok && a.actor.screen === true && a.actor.role === 'front_desk' && a.actor.name === 'Host stand' && !a.actor.isManager && a.actor.uid === `screen_${h}` && Array.isArray(a.actor.caps) && a.actor.caps.includes('checkout.take'), a);
  a = await SA.verifyStaffActor(req({}), 't2');
  check('…for its own business only', !a.ok);
  tokenFor = { uid: `portal:t1:screen_${screenHash(kitchenKey)}`, portal: true, tenantId: 't1' };
  a = await SA.verifyStaffActor(req({}), 't1');
  check('…a sign-in naming a screen that isn’t the host stand is refused', !a.ok && a.status === 401);
  realGuard = false;
  const realRevoke = fakeAuth.revokeRefreshTokens; fakeAuth.revokeRefreshTokens = async () => { throw new Error('down'); };
  r = await K.POST(req({ tenantId: 't1', action: 'revoke', id: h }));
  check('stopping it when its sign-in can’t be ended right then says so (it isn’t passed off as done)', r.body.ok && /couldn’t be ended/.test(r.body.warning || ''), r.body);
  fakeAuth.revokeRefreshTokens = realRevoke;
  r = await K.POST(req({ tenantId: 't1', action: 'revoke', id: h }));
  check('stopping it ends its sign-in too, and switches the tablet’s sign-in off for good', r.body.ok && !r.body.warning && revoked.includes(`portal:t1:screen_${h}`) && disabled.has(`portal:t1:screen_${h}`));
  realGuard = true; tokenFor = { uid: `portal:t1:screen_${h}`, portal: true, tenantId: 't1' };
  a = await SA.verifyStaffActor(req({}), 't1');
  check('…the server refuses it at once', !a.ok && a.status === 401 && /stopped/.test(a.error));
  realGuard = false;
  r = await K.POST(req({ tenantId: 't1', action: 'hostToken', key }));
  check('…and it can’t sign in again', r.status === 401);
  const key2 = (await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: 'Patio stand' }))).body.key;
  await K.POST(req({ tenantId: 't1', action: 'hostToken', key: key2 })); revoked.length = 0;
  r = await K.POST(req({ tenantId: 't1', action: 'forget', key: key2 }));
  check('a tablet stopping itself ends its own sign-in too', r.body.ok && revoked.includes(`portal:t1:screen_${screenHash(key2)}`) && !!(await get(`kitchenScreens/${screenHash(key2)}`)).revokedAt, { b: r.body, revoked });
  const key3 = (await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: 'Bar stand' }))).body.key;
  await K.POST(req({ tenantId: 't1', action: 'hostToken', key: key3 }));
  fakeAuth.revokeRefreshTokens = async () => { throw new Error('down'); };
  r = await K.POST(req({ tenantId: 't1', action: 'forget', key: key3 }));
  fakeAuth.revokeRefreshTokens = realRevoke;
  check('…and when its sign-in can’t be ended right then, it says so', r.body.ok && /couldn’t be ended/.test(r.body.warning || ''), r.body);
  const key4 = (await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: 'Side stand' }))).body.key; revoked.length = 0;
  const realMint = fakeAuth.createCustomToken;
  fakeAuth.createCustomToken = async (uid: string, claims: any) => { await db.doc(`kitchenScreens/${screenHash(key4)}`).set({ revokedAt: new Date().toISOString() }, { merge: true }); return realMint(uid, claims); };
  r = await K.POST(req({ tenantId: 't1', action: 'hostToken', key: key4 }));
  fakeAuth.createCustomToken = realMint;
  check('stopped while it was signing in: the new sign-in is ended at once and not handed over', r.status === 401 && !r.body.token && revoked.includes(`portal:t1:screen_${screenHash(key4)}`), { b: r.body, revoked });
  const key5 = (await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: 'Front stand' }))).body.key;
  const h5 = screenHash(key5); await K.POST(req({ tenantId: 't1', action: 'hostToken', key: key5 })); users.delete(`portal:t1:screen_${h5}`);
  r = await K.POST(req({ tenantId: 't1', action: 'revoke', id: h5 }));
  check('stopped before it ever used its sign-in: that sign-in can’t be used later, and it isn’t reported as a failure', r.body.ok && !r.body.warning && disabled.has(`portal:t1:screen_${h5}`), r.body);
  const key6 = (await K.POST(req({ tenantId: 't1', action: 'pair', kind: 'host', name: 'Rooftop stand' }))).body.key; const h6 = screenHash(key6);
  r = await K.POST(req({ tenantId: 't1', action: 'revoke', id: h6 }));
  check('…stopped before it had asked to sign in at all: a sign-in being made at that moment can’t be used either', r.body.ok && disabled.has(`portal:t1:screen_${h6}`), r.body);
  tokenFor = { uid: 's1', portal: false };

  console.log('buzzing the table’s server');
  const FB = await import('../../src/lib/floor-buzz');
  await db.doc(`${T}/serviceSessions/ss1`).set({ status: 'open', units: [{ id: 'u12', name: '12', staffIds: ['s1'] }, { id: 'u7', name: '7', staffIds: [] }] });
  await db.doc(`${T}/parties/p1`).set({ name: 'Marsh', size: 4, status: 'seated', seatedAt: new Date(Date.now() - 2 * 60000).toISOString(), unitIds: ['u12'], sessionId: 'ss1', needs: ['high chair'] });
  await db.doc(`${T}/parties/p2`).set({ name: 'Okafor', size: 2, status: 'seated', seatedAt: new Date(Date.now() - 60000).toISOString(), unitIds: ['u7'], sessionId: 'ss1' });
  const sec = await FB.sectionOf(db, T, 'p1');
  check('a seated party’s table and its people, from tonight’s service', sec?.table === 'Table 12' && sec?.staffIds.join() === 's1');
  let n = await FB.tellSeated(db, 't1', 'p1');
  let seated = await notes('table_seated');
  check('a new table: its server hears, with the party and what they asked for', n === 1 && seated.length === 1 && seated[0].userId === 's1' && /New table: Table 12, party of 4 \(Marsh\)\. Asked for: high chair\./.test(seated[0].message) && seated[0].link === '/tables', seated);
  n = await FB.tellSeated(db, 't1', 'p1');
  check('…once for that seating', n === 0 && (await notes('table_seated')).length === 1);
  n = await FB.tellSeated(db, 't1', 'p2');
  check('…a table nobody has: nobody is buzzed for a new table', n === 0 && (await notes('table_seated')).length === 1);
  await db.doc(`${T}/parties/p3`).set({ name: 'Old', size: 2, status: 'seated', seatedAt: new Date(Date.now() - 40 * 60000).toISOString(), unitIds: ['u12'], sessionId: 'ss1' });
  n = await FB.tellSeated(db, 't1', 'p3');
  check('…a seating from long ago rung again isn’t news', n === 0 && (await notes('table_seated')).length === 1);
  await db.doc(`${T}/appointments/v1`).set({ partyId: 'p1', tableName: '12' });
  await db.doc(`${T}/appointments/v2`).set({ partyId: 'p2', tableName: '7' });
  n = await FB.tellTableAsk(db, 't1', await get(T), await get(`${T}/appointments/v1`), { what: 'water' });
  let asks = await notes('table_ask');
  check('a guest asks: their server hears what they asked for', n === 1 && asks.length === 1 && asks[0].userId === 's1' && asks[0].message === 'Table 12 would like water.', asks);
  n = await FB.tellTableAsk(db, 't1', await get(T), await get(`${T}/appointments/v2`), { what: 'check' });
  asks = await notes('table_ask');
  check('…a table nobody has: the managers hear it', n === 2 && asks.filter((x: any) => /Table 7 would like the check/.test(x.message)).map((x: any) => x.userId).sort().join() === 'm1,own', asks);
  const K2 = (id: string, o: any) => db.doc(`${T}/kdsTickets/${id}`).set({ id, source: 'tab', visitId: 'v1', status: 'pending', createdAt: '2026-11-15T20:10:00Z', ...o });
  await K2('a', { menuItemName: 'Burger', course: 3 }); await K2('b', { menuItemName: 'Steak frites', course: 3 }); await K2('c', { menuItemName: 'Tart', course: 4, status: 'unfired' }); await K2('d', { menuItemName: 'Fries', course: 3, status: 'cancelled' });
  await db.doc(`${T}/kdsTickets/a`).set({ status: 'ready' }, { merge: true });
  n = await FB.tellPassReady(db, 't1', 'a');
  check('a plate ready while the rest of its course is still cooking: nobody buzzed yet', n === 0 && (await notes('food_ready')).length === 0);
  await db.doc(`${T}/kdsTickets/b`).set({ status: 'ready' }, { merge: true });
  n = await FB.tellPassReady(db, 't1', 'b');
  let food = await notes('food_ready');
  check('the whole course ready (a cancelled plate and a later course aside): the server hears, once, with what’s waiting', n === 1 && food.length === 1 && food[0].userId === 's1' && food[0].message === 'Food at the pass, Table 12: Burger, Steak frites.', food);
  n = await FB.tellPassReady(db, 't1', 'a');
  check('…tapping ready again changes nothing', n === 0 && (await notes('food_ready')).length === 1);
  for (const id of ['f', 'g', 'h']) await K2(id, { menuItemName: `Tart ${id}`, course: 5, status: 'ready' });
  n = await FB.tellPassReadyMany(db, 't1', ['f', 'g', 'h']);
  food = await notes('food_ready');
  check('a bump of a whole course: one buzz for the table’s course, not one a plate', n === 1 && food.length === 2 && /Tart f, Tart g, Tart h/.test(food[1].message), food);
  await K2('i', { menuItemName: 'Salad', course: 6, status: 'delivered' }); await K2('j', { menuItemName: 'Soup', course: 6, status: 'ready' });
  n = await FB.tellPassReadyMany(db, 't1', ['i', 'j']);
  food = await notes('food_ready');
  check('…a bump whose first plate already went out still tells the table about the rest', n === 1 && food.length === 3 && /Soup/.test(food[2].message) && !/Salad/.test(food[2].message), food);
  await db.doc(`${T}/staff/s1`).set({ archived: true }, { merge: true }); await db.doc(`${T}/kdsTickets/e`).set({ id: 'e', source: 'tab', visitId: 'v1', status: 'ready', menuItemName: 'Soda', course: null });
  n = await FB.tellPassReady(db, 't1', 'e');
  check('…someone no longer on the team isn’t buzzed', n === 0);
  await db.doc(`${T}/staff/s1`).set({ archived: false }, { merge: true });

  console.log('the buzz');
  const PT = await import('../../src/lib/push-tier'); const P = await import('../../src/lib/push'); const NP = src('src/lib/notify-prefs.ts');
  check('each buzzes at once, and can be turned off with the floor’s other kinds', PT.PUSH_TIER.table_ask === 'now' && PT.PUSH_TIER.food_ready === 'now' && PT.PUSH_TIER.table_seated === 'now' && /table_ask food_ready table_seated/.test(NP));
  check('a buzz about the floor opens the floor page, for a team member too (not their team app’s Today)', P.pushLink('https://app.test', 't1', '/tables', { role: 'staff', type: 'food_ready' }) === 'https://app.test/tables'
    && P.pushLink('https://app.test', 't1', '/host', { role: 'staff' }) === 'https://app.test/host' && P.pushLink('https://app.test', 't1', '/money', { role: 'staff' }) === 'https://app.test/staff-portal/t1?tab=today');
  const kr = src('src/app/api/kitchen/route.ts'), tp = src('src/app/api/table-pay/route.ts'), hf = src('src/app/api/host/floor/route.ts');
  check('wired where it happens: marking ready (one, a bump, from a held batch), a guest’s ask, the host stand seating someone', (kr.match(/tellPassReady\(db, tenantId, /g) || []).length === 2 && /await tellPassReadyMany\(db, tenantId, readied\)/.test(kr) && /if \(!r\.already\) await tellTableAsk\(db, tenantId, tenant, found\.v, r\.ask\)/.test(tp) && /await tellSeated\(db, tenantId, partyId\)/.test(hf));

  console.log('the team app reaches the floor');
  const tc = src('src/context/TenantContext.tsx'), scope = src('src/components/shared/PortalScope.tsx'), side = src('src/components/shared/AppSidebar.tsx'), lay = src('src/app/(app)/layout.tsx'), portal = src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx'), links = src('src/components/portal/FloorLinks.tsx');
  check('a PIN sign-in is recognized by its own claims (business, team record, never a renter), with its role', /getIdTokenResult\(\)/.test(tc) && /c\.portal === true && typeof c\.tenantId === 'string'/.test(tc) && /c\.isRenter !== true/.test(tc) && /viaPortal \? portal!\.staffId/.test(tc) && /screen: viaPortal && !!portal\?\.screen/.test(tc));
  check('…kept to My tables, Clear tables, the host stand and the bar’s tabs; anywhere else goes back to the team app (a tablet, to the host stand)', /FLOOR_PAGES = \['\/tables', '\/clear', '\/host', '\/bar-tabs'\]/.test(scope) && /router\.replace\(screen \? '\/host' : `\/staff-portal\/\$\{selectedTenant\.id\}`\)/.test(scope) && /<PortalScope>\n          <SidebarProvider>/.test(lay));
  check('…the menu shows only the floor, with the way back to the team app', /label="The floor" items=\{floorItems\}/.test(side) && /Back to the team app/.test(side) && /!viaPortal && <NavSection key=/.test(side) && /isAdmin && !isOwner && !viaPortal/.test(side));
  check('the team app’s Today has the floor at a food business, their job’s page first', /isFoodBusiness\(portalTenant\) && <FloorLinks job=/.test(portal) && /a\.href === first \? -1/.test(links) && /href=\{p\.href\}/.test(links) && !/uppercase|font-black/.test(links) && /min-h-\[64px\]/.test(links));
  const hf2 = () => src('src/app/api/host/floor/route.ts');
  const rules = src('firestore.rules');
  check('the database: the team (PIN sign-ins included, never a renter) runs tonight’s service and its parties; the host stand’s tablet is not the team', /request\.auth\.token\.get\('isRenter', false\) != true && request\.auth\.token\.get\('screen', false\) != true\);/.test(rules)
    && /serviceSessions\/\{sessionId\} \{\n      allow read, write: if isFloorTeam\(tenantId\);/.test(rules) && /parties\/\{partyId\} \{\n      allow read, write: if isFloorTeam\(tenantId\);/.test(rules) && /floorPlans\/\{planId\} \{\n      allow read: if isFloorTeam\(tenantId\);\n      allow write: if isManager\(tenantId\);/.test(rules));
  check('…the tablet reaches only what the floor’s pages use: table visits, the menu, kitchen tickets, tonight’s counts, lounge orders to carry, walk-ins and event guests; and its comps', (rules.match(/isFloorTeam\(tenantId\)/g) || []).length === 14
    && /allow read, create: if isFloorTeam\(tenantId\);\n      allow delete: if isTeam\(tenantId\);/.test(rules) && /allow read: if isFloorTeam\(tenantId\) && collection in \['walkIns', 'eventGuests'\];/.test(rules) && /allow write: if isFloorTeam\(tenantId\) && collection in \['walkIns', 'eventGuests'\];/.test(rules));
  check('…a table’s comps, voids and remakes only, never an approval that can be spent, for anyone who isn’t on the team record', /allow read: if isStaff\(tenantId\) \|\| \(isFloorTeam\(tenantId\) && resource\.data\.get\('kind', ''\) in \['comp', 'void_item', 'remake'\]\);/.test(rules)
    && /where\('kind', 'in', \['comp', 'void_item', 'remake'\]\)/.test(src('src/components/host/TableTab.tsx')));
  const hp = src('src/app/(app)/host/page.tsx');
  check('tonight’s event on the tablet comes through the server, only its name and table plan', /if \(action === 'event'\)/.test(hf2()) && /event: \{ id: q\.docs\[0\]\.id, name: .*seatingTables: tables \}/.test(hf2()) && /if \(screen\) \{[\s\S]{0,200}action: 'event'/.test(hp));
  check('a new sign-in is read afresh; the tablet isn’t signed out for being left alone; a page it can’t open says so', /setPortal\(undefined\);/.test(tc) && /pv\.healthMode && !screen/.test(src('src/components/shared/IdleSignOut.tsx')) && /Opening the floor…/.test(scope));
  const hs = src('src/app/host-stand/[tenantId]/page.tsx');
  check('the host stand’s set-up page: a manager sets it up, the tablet signs itself in as the host stand and opens it, and signs back in by itself later', /action: 'pair', name, kind: 'host'/.test(hs) && /action: 'hostToken', key/.test(hs) && /signInWithCustomToken\(auth, String\(d\.token\)\)/.test(hs) && /window\.location\.replace\('\/host'\)/.test(hs) && /if \(k\) void signInAs\(k\)/.test(hs) && /Setting it up signs your account out of this tablet/.test(hs));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
