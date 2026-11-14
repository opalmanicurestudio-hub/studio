// Checks clear and reset (L20 round 9): lib/table-stage (the business's way of saying a table is ready again, and its
// reset steps), lib/seat-next (who's clearing a table), lib/table-reset (the lists), lib/table-reset-server through
// api/tab (clearing, left, clear_on, clear_done), and the screens.
// - A table guests have left is being cleared: until its time passes, or, when the business waits to be told, until
//   someone says "Ready to seat" (past its usual time it's "Not ready yet").
// - Whoever clears sees the table the host needs next first, says "On it" so nobody doubles up, and "Ready to seat"
//   frees it on the host stand at once. A table that's paid can be marked as gone; one that hasn't paid can't.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/table-reset.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/sms') return { sendTenantSms: async () => ({ ok: true }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const iso = (t: number) => new Date(t).toISOString();

(async () => {
  const ST = await import('../../src/lib/table-stage');
  const SN = await import('../../src/lib/seat-next');
  const R = await import('../../src/lib/table-reset');
  const now = Date.now(); const ago = (m: number) => iso(now - m * 60000);
  console.log('the business’s way');
  const D = ST.floorSettingsOf({});
  check('ready again after the time, by default, with no steps', D.clearUntil === 'time' && D.resetSteps.length === 0);
  const C = ST.cleanFloor({ clearUntil: 'ready', resetSteps: ['  Wipe   it ', '', 'x'.repeat(90), 'a', 'b', 'c', 'd', 'e'] });
  check('…or when someone says so; steps cleaned, short, six at most', C.clearUntil === 'ready' && C.resetSteps[0] === 'Wipe it' && C.resetSteps[1].length === 60 && C.resetSteps.length === 6 && ST.cleanFloor({ clearUntil: 'soon' }).clearUntil === 'time');
  const timed = { ...D, clearMin: 3 }; const wait = { ...D, clearMin: 3, clearUntil: 'ready' as const };
  check('after the time: being cleared, then free on its own', ST.clearingStage(ago(1), timed, now)?.words === 'Being cleared' && ST.clearingStage(ago(4), timed, now) === null);
  const late = ST.clearingStage(ago(9), wait, now);
  check('when someone says so: still being cleared past the time, “Not ready yet”, minutes past it', !!late && late.words === 'Not ready yet' && late.over === 6 && ST.clearingStage(ago(1), wait, now)?.over === 0
    && !!ST.clearingStage(ago(1), { ...wait, clearMin: 0 }, now));
  check('…and nobody is told “any minute” for a table nobody has cleared: a guess that grows', late!.freeIn === 8 && ST.clearingStage(ago(40), wait, now)!.freeIn === 10 && ST.clearingStage(ago(1), wait, now)!.freeIn === 2);

  console.log('the floor');
  const units = [{ id: 'u4', name: '4', seatCount: 4 }, { id: 'u9', name: '9', seatCount: 2 }, { id: 'u6', name: '6', seatCount: 6 }, { id: 'u2', name: '2', seatCount: 2 }];
  const parties = [
    { id: 'a', status: 'finished', unitIds: ['u4'], finishedAt: ago(4), name: 'Okafor', size: 2, clearOn: { by: 'Rae', at: ago(1) } },
    { id: 'b', status: 'finished', unitIds: ['u9'], finishedAt: ago(9), name: 'Moss', size: 2 },
    { id: 'c', status: 'finished', unitIds: ['u6'], finishedAt: ago(2), name: 'Ward', size: 5 },
    { id: 'd', status: 'finished', unitIds: ['u2'], finishedAt: ago(30), name: 'Old', size: 2, clearedAt: ago(25) },
    { id: 'w1', status: 'waiting', name: 'Lee', size: 4, joinedAt: ago(20) },
    { id: 'bk', status: 'expected', name: 'Priya', size: 6, arrivesAt: iso(now + 10 * 60000), unitIds: ['u6'] },
  ];
  const tables = SN.floorTables(units, parties, {}, wait, now, { holdBeforeMinutes: 30, holdGraceMinutes: 15 });
  const t4 = tables.find((t) => t.id === 'u4')!; const t9 = tables.find((t) => t.id === 'u9')!; const t2 = tables.find((t) => t.id === 'u2')!;
  check('the floor says who’s on it and how far past its time a table is', t4.clearing && t4.clearBy === 'Rae' && t4.clearOver === 1 && t9.clearOver === 6 && !t2.clearing, { t4, t9 });
  const held: Record<string, any> = Object.fromEntries(parties.map((p: any) => [p.id, { name: p.name, at: p.arrivesAt || null }]));
  const list = R.clearList({ tables, parties, waiting: [{ name: 'Lee', size: 4, joinedAt: ago(20) }], held, now, label: (n) => `Table ${n}`, timeWords: () => '7:30 pm' });
  check('to clear: held for a booking first, then the one someone waiting fits, then the longest left', list.map((i) => i.unitId).join() === 'u6,u4,u9' && list[0].needed === 'Held for Priya at 7:30 pm' && list[1].needed === 'Lee, 4 is waiting for it'
    && list[2].needed === null && list[1].by === 'Rae' && list[2].minutes === 9 && list[2].over === 6, list);
  const units2 = [...units, { id: 'u8', name: '8', seatCount: 4, tags: [] }];
  const tables2 = SN.floorTables(units2, parties, {}, wait, now, { holdBeforeMinutes: 30, holdGraceMinutes: 15 });
  const list2 = R.clearList({ tables: tables2, parties, waiting: [{ name: 'Lee', size: 4, joinedAt: ago(20) }], held, now, label: (n) => `Table ${n}`, timeWords: () => '7:30 pm' });
  check('…not “waiting for it” when a free table could take them now', list2.every((i) => !/Lee/.test(i.needed || '')), list2);
  const units3 = units.map((u) => (u.id === 'u4' ? { ...u, tags: [] } : u.id === 'u9' ? { ...u, seatCount: 4, tags: ['step_free'] } : u));
  const tables3 = SN.floorTables(units3, parties, {}, wait, now, { holdBeforeMinutes: 30, holdGraceMinutes: 15 });
  const list3 = R.clearList({ tables: tables3, parties, waiting: [{ name: 'Patel', size: 3, joinedAt: ago(10), needs: ['step_free'] }], held, now, label: (n) => `Table ${n}`, timeWords: () => '7:30 pm' });
  check('…and only a table with what they asked for (step-free access)', list3.find((i) => i.unitId === 'u9')?.needed === 'Patel, 3 is waiting for it' && !list3.find((i) => i.unitId === 'u4')?.needed, list3);
  const leaving = R.leavingList([
    { visitId: 'v1', table: 'Table 7', party: { id: 'p7', name: 'Chen', size: 4 }, stage: { key: 'check' }, checkAt: ago(6) },
    { visitId: 'v2', table: 'Table 3', party: { id: 'p3', name: 'Ito', size: 2 }, stage: { key: 'paid' }, paidAt: ago(5), closed: true },
    { visitId: 'v4', table: 'Table 1', party: { id: 'p1', name: 'Ng', size: 2 }, stage: { key: 'paid' }, paidAt: ago(2), closed: false },
    { visitId: 'v3', table: 'Table 5', party: { id: 'p5', name: 'Fox', size: 2 }, stage: { key: 'eating' } },
  ], now);
  check('leaving soon: paid first, then asked for the check; paid on their phones but not closed waits for their server', leaving.map((l) => l.partyId).join() === 'p3,p1,p7' && leaving[0].closed && !leaving[1].closed
    && R.leavingWords(leaving[0]) === 'Paid 5 min ago' && R.leavingWords(leaving[1]) === 'Paid at the table 2 min ago. Their server closes the check first' && R.leavingWords(leaving[2]) === 'Asked for the check 6 min ago', leaving);

  console.log('on a phone');
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York', hostingSettings: { floor: { clearMin: 3, clearUntil: 'ready', resetSteps: ['Clear and wipe the table', 'Reset cutlery and glasses'] } } });
  const Tab = await import('../../src/app/api/tab/route');
  const F = await import('../../src/lib/floor-server');
  let r: any = await Tab.POST(req({ tenantId: 't1', action: 'clearing' }));
  check('no floor open: says so, nothing to clear', r.body.ok && r.body.session === null && r.body.toClear.length === 0 && r.body.steps.length === 2 && r.body.waitForReady);
  const apiUnits = [{ id: 'u4', name: '4', seatCount: 4 }, { id: 'u9', name: '9', seatCount: 2 }, { id: 'u2', name: '2', seatCount: 4 }, { id: 'u6', name: '6', seatCount: 2 }, { id: 'u8', name: '8', seatCount: 2 }];
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open', opensAt: ago(120), units: apiUnits, businessDay: '2026-11-14' });
  const party = (id: string, o: any) => db.doc(`${T}/parties/${id}`).set({ sessionId: 's1', name: id, size: 2, needs: [], unitIds: [], guestIds: [], ...o });
  await party('okafor', { status: 'finished', unitIds: ['u4'], finishedAt: ago(4), name: 'Okafor' });
  await party('lee', { status: 'waiting', name: 'Lee', size: 4, joinedAt: ago(15) });
  await party('ito', { status: 'seated', unitIds: ['u2'], seatedAt: ago(60), name: 'Ito', guestIds: ['walkin:wk1'] });
  await db.doc(`${T}/appointments/apt-walkin-wk1`).set({ isTable: true, status: 'completed', completedAt: ago(5), tab: [{ lineId: 'l1', itemId: 'x', name: 'Soup', price: 9, quantity: 1 }] });
  await party('fox', { status: 'seated', unitIds: ['u9'], seatedAt: ago(40), name: 'Fox', checkAt: ago(3) });
  await db.doc(`${T}/appointments/apt-party-fox`).set({ isTable: true, status: 'servicing', tab: [{ lineId: 'l2', itemId: 'y', name: 'Tea', price: 3, quantity: 1 }] });
  F.forgetFloor('t1');
  r = await Tab.POST(req({ tenantId: 't1', action: 'clearing' }));
  check('tables to clear and leaving soon, with the business’s steps and who’s asking', r.body.ok && r.body.toClear.length === 1 && r.body.toClear[0].table === 'Table 4' && r.body.toClear[0].needed === 'Lee, 4 is waiting for it' && r.body.toClear[0].over === 1
    && r.body.leaving.map((l: any) => `${l.partyId}:${l.kind}`).join() === 'ito:paid,fox:check' && r.body.meName === 'Sam Lee', r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_on', unitId: 'u4' }));
  F.forgetFloor('t1');
  const host1 = F.tablesOf(await F.readFloor(db, T, await get(T)), await get(T), Date.now()).find((t) => t.id === 'u4');
  check('“On it”: the host stand sees who', r.body.ok && (await get(`${T}/parties/okafor`)).clearOn.by === 'Sam Lee' && host1?.clearBy === 'Sam Lee');
  actor.name = 'Rae Kim';
  const take: any = await Tab.POST(req({ tenantId: 't1', action: 'clear_on', unitId: 'u4' })); const drop: any = await Tab.POST(req({ tenantId: 't1', action: 'clear_on', unitId: 'u4', on: false }));
  actor.name = 'Sam Lee';
  check('…someone else can’t take it over while it’s fresh, or let it go for them', take.status === 409 && /Sam Lee is on it/.test(take.body.error) && drop.status === 409 && (await get(`${T}/parties/okafor`)).clearOn.by === 'Sam Lee');
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_on', unitId: 'u4', on: false }));
  check('…and “Not me”', r.body.ok && (await get(`${T}/parties/okafor`)).clearOn === null);
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u4' }));
  F.forgetFloor('t1');
  const host2 = F.tablesOf(await F.readFloor(db, T, await get(T)), await get(T), Date.now()).find((t) => t.id === 'u4');
  check('“Ready to seat”: free on the host stand at once, with who said so', r.body.ok && r.body.cleared === 1 && !!(await get(`${T}/parties/okafor`)).clearedAt && (await get(`${T}/parties/okafor`)).clearedBy === 'Sam Lee' && host2 && !host2.clearing && host2.freeIn === 0);
  await party('joined', { status: 'finished', unitIds: ['u6', 'u8'], finishedAt: ago(2), name: 'Big' });
  F.forgetFloor('t1');
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u6' }));
  F.forgetFloor('t1');
  let fl = F.tablesOf(await F.readFloor(db, T, await get(T)), await get(T), Date.now());
  check('joined tables are each said ready: one done, the other still being cleared', r.body.ok && !fl.find((t) => t.id === 'u6')!.clearing && fl.find((t) => t.id === 'u8')!.clearing && !(await get(`${T}/parties/joined`)).clearedAt);
  await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u8' })); F.forgetFloor('t1');
  fl = F.tablesOf(await F.readFloor(db, T, await get(T)), await get(T), Date.now());
  check('…and once both are, the party is done with', !fl.find((t) => t.id === 'u8')!.clearing && !!(await get(`${T}/parties/joined`)).clearedAt);
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u4' }));
  check('…twice: it’s ready already', r.status === 409);
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u4', at: new Date().toISOString() }));
  check('…sent again from a phone whose answer was lost (it says when it was tapped): fine, nothing to do', r.body.ok && r.body.already === true);
  await party('later', { status: 'finished', unitIds: ['u5'], finishedAt: ago(1), name: 'Later' }); F.forgetFloor('t1');
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_done', unitId: 'u5', at: ago(10) }));
  check('a “Ready to seat” kept on a phone through a Wi-Fi drop never clears guests who sat down and left after it', r.body.ok && r.body.cleared === 0 && !(await get(`${T}/parties/later`)).clearedAt);
  r = await Tab.POST(req({ tenantId: 't1', action: 'clear_on', unitId: 'u5', at: ago(10) }));
  check('…nor “On it”', r.body.ok && !(await get(`${T}/parties/later`)).clearOn);

  console.log('they’ve left');
  r = await Tab.POST(req({ tenantId: 't1', action: 'left', partyId: 'fox' }));
  check('not a table that hasn’t paid: that stays with its server', r.status === 409 && /haven’t paid/.test(r.body.error) && (await get(`${T}/parties/fox`)).status === 'seated');
  r = await Tab.POST(req({ tenantId: 't1', action: 'left', partyId: 'ito' }));
  const ito = await get(`${T}/parties/ito`);
  check('a table that’s paid: gone, being cleared from now, and its walk-in line row to close', r.body.ok && ito.status === 'finished' && !!ito.finishedAt && ito.leftBy === 'Sam Lee' && r.body.walkInId === 'wk1');
  F.forgetFloor('t1');
  r = await Tab.POST(req({ tenantId: 't1', action: 'clearing' }));
  check('…and it’s on the list to clear', r.body.toClear.some((i: any) => i.unitId === 'u2' && i.minutes === 0));
  await db.doc(`${T}/appointments/apt-party-fox`).set({ payPaidAt: ago(1), payPaidTab: (await import('../../src/lib/table-bill')).tabSig([{ lineId: 'l2', itemId: 'y', name: 'Tea', price: 3, quantity: 1 }]) }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'left', partyId: 'fox' }));
  check('paid in full on their phones but the check not closed: stays with their server, so the sale is recorded', r.status === 409 && /isn’t closed yet/.test(r.body.error) && (await get(`${T}/parties/fox`)).status === 'seated');
  await party('booked', { status: 'seated', unitIds: ['u6'], seatedAt: ago(30), name: 'Booked', guestIds: ['appt:a1'] });
  r = await Tab.POST(req({ tenantId: 't1', action: 'left', partyId: 'booked' }));
  check('…nor a booked visit that hasn’t been checked out', r.status === 409);
  F.forgetFloor('t1');
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges' }));
  check('My tables knows how many are waiting to be cleared', r.body.ok && r.body.toClear === 1, r.body.toClear);

  console.log('the screens');
  const page = src('src/app/(app)/clear/page.tsx'); const host = src('src/app/(app)/host/page.tsx'); const mine = src('src/app/(app)/tables/page.tsx'); const set = src('src/components/settings/HostStandSettings.tsx');
  check('Clear and reset: needed next, on it, ready to seat, the steps, leaving soon, they’ve left', /Clear and reset/.test(page) && /Needed next/.test(page) && /On it/.test(page) && /Ready to seat/.test(page) && /role="checkbox"/.test(page) && /Leaving soon/.test(page) && /They’ve left/.test(page) && /api\/walkins/.test(page));
  check('the host stand: who’s on it, and not ready yet in amber', /is on it/.test(host) && /Not ready yet/.test(host) && /notReady/.test(host));
  check('My tables links to it, and so does the menu', /href="\/clear"/.test(mine) && /'\/clear'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/clear', '\/tables'\]/.test(src('src/lib/modules.ts')) && /'clear'/.test(src('src/lib/app-theme.ts')));
  check('the settings: ready again after the time or when someone says so, reset steps', /When someone says so/.test(set) && /Reset steps/.test(set) && /Start from the usual steps/.test(set) && /Reset steps/.test(src('src/lib/settings-rows.ts')));
  const fresh = page + src('src/lib/table-reset.ts') + src('src/lib/table-reset-server.ts');
  check('no emoji, all caps, red or niche words in what’s new', !/[\u{1F300}-\u{1FAFF}]/u.test(fresh) && !/\buppercase\b|font-black|#b42318/.test(fresh) && !/\b(salon|stylist|booth|chair)\b/i.test(fresh));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
