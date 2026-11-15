// Checks tonight's sections (round 28, design canvas "Tonight's sections"): who looks after which tables tonight
// (lib/sections, pure), and on the server (lib/sections-server, api/host/floor 'sections', 'section_tap', 'call_out',
// 'hand', 'usual'): the floor's people with who's on tonight, a tap giving a table (or back to nobody), a call-out
// moving a whole section to one person or shared out, a server handing over their own table, whoever's given a seated
// table buzzed with where its meal is, a manager keeping tonight's as the usual sections; and the host stand's chart and
// My tables' "Hand to someone".
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/sections.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
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
const given = async () => (await all(`${T}/notifications`)).filter((n: any) => n.type === 'table_given');
const as = (o: any) => { for (const k of Object.keys(actor)) delete actor[k]; Object.assign(actor, { caps: [] }, o); };
const unitsNow = async () => Object.fromEntries(((await get(`${T}/serviceSessions/ss1`))?.units || []).map((u: any) => [u.id, (u.staffIds || []).join(',')]));

(async () => {
  console.log('the chart, worked out');
  const S = await import('../../src/lib/sections');
  const U = [{ id: 'u1', name: '1', staffIds: ['a'] }, { id: 'u2', name: '2', staffIds: ['a'] }, { id: 'u3', name: '3', staffIds: ['b'] }, { id: 'u4', name: '4', staffIds: ['b', 'c'] }, { id: 'u5', name: '5', staffIds: [] }];
  const P = [{ id: 'a', name: 'Lee Park' }, { id: 'b', name: 'Kai Moss' }, { id: 'c', name: 'Sam Ortiz' }];
  check('a tap gives the table to whoever is picked, from whoever had it', JSON.stringify(S.tapTable(U, 'u3', 'c')) === JSON.stringify({ unitId: 'u3', from: ['b'], to: ['c'] }));
  check('…tapping one that’s theirs alone gives it back to nobody', JSON.stringify(S.tapTable(U, 'u1', 'a')?.to) === '[]');
  check('handing tables over: theirs alone, and one already theirs isn’t a move', S.handOver(U, ['u1', 'u3'], 'a').map((m) => m.unitId).join() === 'u3');
  const out = S.callOut(U, 'b', P.filter((p) => p.id !== 'b'), 'share', ['u1']);
  check('a call-out shared out: a table they shared just loses them; the rest go to whoever has the fewest (a seated table counts double)', out.length === 2
    && JSON.stringify(out.find((m) => m.unitId === 'u4')?.to) === '["c"]' && JSON.stringify(out.find((m) => m.unitId === 'u3')?.to) === '["c"]', out);
  const words = S.movesWords(S.callOut(U, 'a', P, 'c'), U, P);
  check('…all to one person, said the way the host stand says it', words === 'Sam 1 and 2', words);
  check('sections by person, and the tables nobody has', S.sectionsOf(U, P).people.find((p) => p.id === 'b')?.unitIds.join() === 'u3,u4' && S.sectionsOf(U, P).nobody.join() === 'u5');

  console.log('tonight’s sections on the server');
  await db.doc(T).set({ name: 'North Loft', userId: 'own', businessType: 'hospitality' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Lee Park', role: 'staff', job: 'server' });
  await db.doc(`${T}/staff/s2`).set({ name: 'Kai Moss', role: 'staff', job: 'server' });
  await db.doc(`${T}/staff/s3`).set({ name: 'Sam Ortiz', role: 'staff', job: 'server' });
  await db.doc(`${T}/staff/c1`).set({ name: 'Rio Cook', role: 'assistant', job: 'cook' });
  await db.doc(`${T}/staff/r1`).set({ name: 'Renter Person', role: 'renter', isRenter: true });
  await db.doc(`${T}/staff/x1`).set({ name: 'Gone Server', role: 'staff', job: 'server', archived: true });
  await db.doc(`${T}/shifts/sh1`).set({ staffId: 's1', date: '2026-11-15', startTime: '16:00', endTime: '23:00', status: 'published', kind: 'work' });
  await db.doc(`${T}/shifts/sh3`).set({ staffId: 's3', date: '2026-11-15', startTime: '17:00', endTime: '23:00', status: 'published', kind: 'work' });
  await db.doc(`${T}/floorPlans/default`).set({ id: 'default', units: [1, 2, 3, 4, 5].map((n) => ({ id: `u${n}`, name: String(n), seatCount: 4, staffIds: [], tags: [], x: n * 10, y: 5 })), updatedAt: '2026-11-01T00:00:00Z' });
  await db.doc(`${T}/serviceSessions/ss1`).set({ status: 'open', businessDay: '2026-11-15', opensAt: '2026-11-15T16:00:00Z', units: [
    { id: 'u1', name: '1', seatCount: 4, staffIds: ['s1'], tags: [], x: 10, y: 5 }, { id: 'u2', name: '2', seatCount: 4, staffIds: ['s1'], tags: [], x: 20, y: 5 },
    { id: 'u3', name: '3', seatCount: 4, staffIds: ['s2'], tags: [], x: 30, y: 5 }, { id: 'u4', name: '4', seatCount: 4, staffIds: ['s2'], tags: [], x: 40, y: 5 },
    { id: 'u5', name: '5', seatCount: 4, staffIds: [], tags: [], x: 50, y: 5 }] });
  await db.doc(`${T}/appointments/v1`).set({ partyId: 'p1', tableName: '3', status: 'in_progress', tab: [{ id: 'l1', name: 'Burger', price: 18, quantity: 1 }] });
  await db.doc(`${T}/parties/p1`).set({ name: 'Marsh', size: 4, status: 'seated', seatedAt: new Date(Date.now() - 20 * 60000).toISOString(), unitIds: ['u3'], sessionId: 'ss1', guestIds: ['appt:v1'] });

  const F = await import('../../src/app/api/host/floor/route');
  let r: any = await F.POST(req({ tenantId: 't1', action: 'sections' }));
  const people = r.body.people || [];
  check('the chart: each table with its people and whether it’s seated, where the floor plan puts it', r.body.ok && r.body.units.length === 5 && r.body.units.find((u: any) => u.id === 'u3')?.seated === true
    && r.body.units.find((u: any) => u.id === 'u1')?.seated === false && r.body.units[0].x === 10 && r.body.units.find((u: any) => u.id === 'u3')?.staffIds.join() === 's2', r.body);
  check('the floor’s people: those who take tables, whoever’s on tonight first, servers before others; never a cook, a renter or someone no longer on the team', people.map((p: any) => p.id).join() === 's1,s3,s2,m1'
    && people.find((p: any) => p.id === 's1')?.on === true && people.find((p: any) => p.id === 's2')?.on === false, people);
  check('…a manager can change them and keep them as the usual ones', r.body.canEdit === true && r.body.canUsual === true);

  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  r = await F.POST(req({ tenantId: 't1', action: 'sections' }));
  check('a server sees tonight’s sections, and can’t change them', r.body.ok && r.body.canEdit === false && r.body.canUsual === false && r.body.me === 's1');
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u5', staffId: 's1' }));
  check('…a server tapping the chart is refused', r.status === 403 && (await unitsNow()).u5 === '');
  r = await F.POST(req({ tenantId: 't1', action: 'call_out', staffId: 's2', to: 'share' }));
  check('…and so is moving someone’s section', r.status === 403 && (await unitsNow()).u3 === 's2');
  r = await F.POST(req({ tenantId: 't1', action: 'usual' }));
  check('…and keeping them as the usual ones (a manager’s)', r.status === 403);

  as({ uid: 'screen_abc', name: 'Host stand', role: 'front_desk', screen: true });
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u5', staffId: 's3' }));
  check('the host stand’s tablet taps a table to someone: theirs tonight', r.body.ok && r.body.staffIds.join() === 's3' && (await unitsNow()).u5 === 's3', r.body);
  check('…an empty table changing hands buzzes nobody', (await given()).length === 0);
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u5', staffId: 's3' }));
  check('…tapped again, back to nobody', r.body.ok && r.body.staffIds.length === 0 && (await unitsNow()).u5 === '');
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u5', staffId: 'c1' }));
  check('…never to someone who isn’t on the floor’s team', r.status === 404 && (await unitsNow()).u5 === '');
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'nope', staffId: 's3' }));
  check('…nor a table that isn’t on tonight’s floor', r.status === 404);
  const plan0 = JSON.stringify((await get(`${T}/floorPlans/default`)).units);

  as({ uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await F.POST(req({ tenantId: 't1', action: 'call_out', staffId: 's2', to: 'share' }));
  let g = await given();
  check('Kai called out, shared out: the seated table to Sam (who had none), the next to whoever has the fewest then', r.body.ok && r.body.words === 'Sam 3, Lee 4' && (await unitsNow()).u3 === 's3' && (await unitsNow()).u4 === 's1', { b: r.body, u: await unitsNow() });
  check('…Sam’s phone buzzes for the seated table: the table, who it came from and the party; nobody for an empty one', g.length === 1 && g[0].userId === 's3' && /^Table 3 is yours now, from Kai\. Party of 4/.test(g[0].message) && g[0].link === '/tables', g);
  check('…Kai, who called out, isn’t sent notes about his own tables', (await all(`${T}/notifications`)).filter((n: any) => n.type === 'table_moved').length === 0);
  check('…only tonight: the floor plan’s usual sections stay as they are', JSON.stringify((await get(`${T}/floorPlans/default`)).units) === plan0);
  r = await F.POST(req({ tenantId: 't1', action: 'call_out', staffId: 's1', to: 's3' }));
  const un = await unitsNow();
  check('…someone who called out isn’t sent notes about their own tables', (await all(`${T}/notifications`)).filter((n: any) => n.type === 'table_moved' && n.userId === 's1').length === 0);
  check('Lee called out, all to Sam', r.body.ok && r.body.words === 'Sam 1, 2 and 4' && ['u1', 'u2', 'u4'].every((u) => un[u] === 's3'), { b: r.body, un });
  r = await F.POST(req({ tenantId: 't1', action: 'call_out', staffId: 's3', to: 'c1' }));
  check('…never to someone who isn’t on the floor’s team', r.status === 404);
  r = await F.POST(req({ tenantId: 't1', action: 'call_out', staffId: 's3', to: 's3' }));
  check('…nor to the person who called out', r.status === 400);

  console.log('handing a table over');
  as({ uid: 's2', name: 'Kai Moss', role: 'staff' });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p1', to: 's1' }));
  check('a server can’t hand over someone else’s table', r.status === 403 && (await unitsNow()).u3 === 's3');
  as({ uid: 's3', name: 'Sam Ortiz', role: 'staff' });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p1', to: 'c1' }));
  check('…nor hand one to someone who isn’t on the floor’s team', r.status === 404);
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p1', to: 's1' }));
  g = await given();
  check('Sam hands Table 3 to Lee: Lee’s alone now, and Lee’s phone buzzes, from Sam', r.body.ok && r.body.moved === 1 && r.body.told === 1 && (await unitsNow()).u3 === 's1'
    && g.length === 2 && g[1].userId === 's1' && /^Table 3 is yours now, from Sam\. Party of 4/.test(g[1].message), { b: r.body, g });
  check('…Sam isn’t told about a table Sam handed over', (await all(`${T}/notifications`)).filter((n: any) => n.type === 'table_moved' && n.userId === 's3').length === 0);
  await db.doc(`${T}/parties/p4`).set({ name: 'Big party', size: 10, status: 'seated', seatedAt: new Date(Date.now() - 5 * 60000).toISOString(), unitIds: ['u2', 'u3'], sessionId: 'ss1', guestIds: [] });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p4', to: 's2' }));
  let un2 = await unitsNow();
  check('a party across two tables: Sam hands over only the table Sam has, not Lee’s', r.body.ok && un2.u2 === 's2' && un2.u3 === 's1', { b: r.body, un2 });
  await db.doc(`${T}/parties/p5`).set({ name: 'Walk-in', size: 2, status: 'seated', seatedAt: new Date().toISOString(), unitIds: ['u5'], sessionId: 'ss1', guestIds: [] });
  as({ uid: 'c1', name: 'Rio Cook', role: 'assistant' });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p5', to: 's1' }));
  check('…a table nobody has can’t be handed over by someone off the floor’s team (a cook)', r.status === 403 && (await unitsNow()).u5 === '');
  as({ uid: 's2', name: 'Kai Moss', role: 'staff' });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p5', to: 's1' }));
  check('…but a server can take charge of it and hand it on', r.body.ok && (await unitsNow()).u5 === 's1');
  await db.doc(`${T}/parties/p5`).set({ status: 'finished' }, { merge: true });
  await db.doc(`${T}/serviceSessions/ss1`).set({ units: ((await get(`${T}/serviceSessions/ss1`)).units || []).map((u: any) => (u.id === 'u5' ? { ...u, staffIds: [] } : u)) }, { merge: true });
  as({ uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u3', staffId: 's2' }));
  const moved = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'table_moved');
  check('the host moves a seated table: whoever had it is told quietly where it went', r.body.ok && moved.length === 1 && moved[0].userId === 's1' && moved[0].message === 'Table 3 went to Kai.' && moved[0].priority === 'normal', moved);
  as({ uid: 's3', name: 'Sam Ortiz', role: 'staff' });
  await db.doc(`${T}/parties/p2`).set({ name: 'Left', size: 2, status: 'finished', unitIds: ['u5'], sessionId: 'ss1' });
  r = await F.POST(req({ tenantId: 't1', action: 'hand', partyId: 'p2', to: 's1' }));
  check('…a table that isn’t seated any more can’t be handed over', r.status === 404);

  console.log('the usual sections');
  as({ uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await F.POST(req({ tenantId: 't1', action: 'usual' }));
  const plan = (await get(`${T}/floorPlans/default`)).units;
  check('a manager keeps tonight’s as the usual sections: each table’s people on the floor plan, everything else about it as it was', r.body.ok && r.body.tables === 5 && r.body.nobody === 1
    && plan.find((u: any) => u.id === 'u3').staffIds.join() === 's2' && plan.find((u: any) => u.id === 'u2').staffIds.join() === 's2' && plan.find((u: any) => u.id === 'u1').staffIds.join() === 's3' && plan.find((u: any) => u.id === 'u5').staffIds.length === 0
    && plan.every((u: any) => u.seatCount === 4 && typeof u.x === 'number'), plan);
  await db.doc(`${T}/serviceSessions/ss1`).set({ status: 'closed' }, { merge: true });
  r = await F.POST(req({ tenantId: 't1', action: 'section_tap', unitId: 'u5', staffId: 's1' }));
  check('with tonight’s floor closed, nothing moves', r.status === 409);
  r = await F.POST(req({ tenantId: 't1', action: 'sections' }));
  check('…and the chart says so', r.body.ok && r.body.session === null && r.body.units.length === 0);

  console.log('the screens');
  const sheet = src('src/components/host/SectionsSheet.tsx'), host = src('src/app/(app)/host/page.tsx'), tables = src('src/app/(app)/tables/page.tsx');
  check('the host stand opens tonight’s sections, and its floor follows a change at once', /setSections\(true\)/.test(host) && /<SectionsSheet api=\{api\}/.test(host) && /onSnapshot\(doc\(firestore, `tenants\/\$\{tenantId\}\/serviceSessions`, session\.id\)/.test(host));
  check('the chart: pick someone, tap their tables; someone called out; keep as usual for a manager; read-only for a server', /action: 'section_tap', unitId: u\.id, staffId: pick/.test(sheet) && /action: 'call_out', staffId: out, to/.test(sheet)
    && /d\.canUsual && /.test(sheet) && /action: 'usual'/.test(sheet) && /disabled=\{!d\.canEdit\}/.test(sheet) && /d\.canEdit && <div/.test(sheet));
  check('My tables: hand the open table to someone, tonight’s team first, and the floor’s words for sections', /action: 'hand', partyId: row\.party\.id, to: handTo/.test(tables) && /Hand \{open\.table\} to someone/.test(tables)
    && /The host sets tonight’s sections at the host stand\./.test(tables) && /not on tonight/.test(tables));
  const PT = await import('../../src/lib/push-tier');
  check('the buzz for a table given is at once, with the floor’s other kinds; one that went elsewhere is quiet', PT.PUSH_TIER.table_given === 'now' && !PT.PUSH_TIER.table_moved && /table_seated table_given table_moved/.test(src('src/lib/notify-prefs.ts')));
  check('keeping tonight’s as usual with a table for nobody asks first', /if \(!sure && nobody\.length\) \{ setSure\(true\); return; \}/.test(sheet));
  check('the chart keeps focus inside while it’s open, and gives it back', /title\.current\?\.focus\(\)/.test(sheet) && /document\.body\.style\.overflow = 'hidden'/.test(sheet) && /back\?\.focus\?\.\(\)/.test(sheet));
  check('the host stand opens the newest open night, as the server does', /openSnap\.docs\.slice\(\)\.sort\(/.test(host));
  check('new screens keep the house style', ![sheet, tables].some((x) => /uppercase|font-black| · /.test(x)) && !/\{\/\*/.test(sheet));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
