// Checks that a tool that isn't part of a business's plan is locked, not just left out of the menu (L19): lib/modules
// lockedModule, lib/tool-lock, components/shared/ToolGate, and the routes that belong to a tool.
// - A business that never chose keeps everything (a tool never mentioned is on). A page two tools share is open while
//   either is on.
// - Off, the team's screens show what the tool does, what it costs and where the owner adds it; the tool's own routes
//   refuse new use (the team is told what's missing and where; a guest is only told it isn't available).
// - What's already owed or already someone's is never locked: refunds, clocking out, a guest's place, renewals, a
//   request already made, the desk's own "Add a walk-in".
// - With neither tool that brings the kitchen screen on, lounge orders go to the desk and desk sales don't go to a
//   screen that's locked.
// - The plan's own words promise only what's built (no class schedules; the lounge menu under Guest experience, where
//   it works for everyone; reviews aren't sold as part of Marketing, they're in every plan).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/tool-lock.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'owner', isManager: true, isTenantOwner: true, caps: [] };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const tenantOf = async (tid: string) => (await db.doc(`tenants/${tid}`).get()).data() || {};
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { try { Promise.resolve(typeof fn === 'function' ? fn() : fn).catch(() => {}); } catch { /* */ } } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async (_r: any, tid: string) => ({ ok: true, actor, tenant: await tenantOf(tid) }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, tid: string) => ({ actor, tenant: await tenantOf(tid) }),
    requireCan: async (_r: any, tid: string) => ({ actor, tenant: await tenantOf(tid) }),
    staffOrServer: async () => true,
  };
  if (request === '@/lib/request-actor') return { requestActor: async () => ({ ok: true, actor: { staffId: 's1', name: 'Kai Park', role: 'staff', isManager: false, isOwner: false, portal: false } }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/sms') return { sendTenantSms: async () => ({ ok: true }) };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, url = 'https://app.test/api/x') => ({ json: async () => body, clone() { return this; }, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: new URL(url) }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const plan = async (modules: Record<string, boolean> | undefined) => { const t = await get(T); delete t.modules; await db.doc(T).set(modules ? { ...t, modules } : t); };
const locked = (r: any) => r?.status === 403 && r?.body?.locked === true;

(async () => {
  console.log('which pages are locked');
  const Mods = await import('../../src/lib/modules');
  check('a business that never chose keeps every page', ['/campaigns', '/host', '/money', '/events', '/academy', '/booths'].every((p) => Mods.lockedModule({}, p) === null && Mods.lockedModule({ modules: {} }, p) === null && Mods.lockedModule({ modules: null }, p) === null));
  const off = { marketing: false, hospitality: false, classes_events: true, retail: false, money: false };
  check('a tool switched off locks its pages, and the pages under them', Mods.lockedModule({ modules: off }, '/campaigns') === 'marketing' && Mods.lockedModule({ modules: off }, '/campaigns/new') === 'marketing'
    && Mods.lockedModule({ modules: off }, '/retail-orders/kpis') === 'retail' && Mods.lockedModule({ modules: off }, '/host') === 'hospitality' && Mods.lockedModule({ modules: off }, '/settings/hosting') === 'hospitality');
  check('…a page two tools share stays open while either is on', Mods.lockedModule({ modules: off }, '/kds') === null && Mods.lockedModule({ modules: { ...off, classes_events: false } }, '/kds') === 'hospitality' && Mods.lockedModule({ modules: { ...off, classes_events: false } }, '/floor') === 'hospitality');
  check('…and pages that are part of every plan never lock', ['/clients', '/dashboard', '/reviews', '/inventory', '/services', '/subscriptions', '/documents', '/month', '/reports'].every((p) => Mods.lockedModule({ modules: { marketing: false, retail: false, hospitality: false, classes_events: false, money: false, team: false, kiosk: false, booth_rental: false, maintenance: false, memberships: false, voice: false, academy: false } }, p) === null));

  console.log('what’s billed is what’s open');
  const Cat = await import('../../src/lib/module-catalog');
  const all = Cat.TOOLS.map((x) => x.id);
  const round = (ids: any[]) => Cat.fromTenantModules(Cat.toTenantModules(ids)).filter((x) => x !== 'booking' && x !== 'guest').sort().join();
  check('each tool chosen alone is the only one billed (a switch two tools share never bills the other)', all.filter((id) => !['booking', 'guest'].includes(id)).every((id) => round(['booking', id]) === id),
    all.map((id) => `${id}→${round(['booking', id])}`).filter((x) => x.split('→')[0] !== x.split('→')[1]));
  check('…and any mix reads back as itself', round(['booking', 'team', 'renters']) === 'renters,team' && round(['booking', 'renters', 'marketing']) === 'marketing,renters' && round(all) === all.filter((x) => !['booking', 'guest'].includes(x)).sort().join());
  const billedOn = (ids: any[]) => Cat.fromTenantModules(Cat.toTenantModules(ids));
  check('…and what’s billed is never locked: every billed tool’s pages open', all.every((id) => billedOn(['booking', id]).every((tid) => Cat.TOOL_BY_ID[tid].gates.every((g) => Mods.MODULES[g].pages.every((pg) => Mods.lockedModule({ modules: Cat.toTenantModules(['booking', id]) }, pg) === null || !Cat.TOOL_BY_ID[tid].gates.includes(Mods.lockedModule({ modules: Cat.toTenantModules(['booking', id]) }, pg) as any))))));

  console.log('the refusal');
  const L = await import('../../src/lib/tool-lock');
  check('a tool that’s on isn’t refused', L.toolLocked({}, ['hospitality']) === null && L.toolLocked({ modules: { hospitality: true } }, ['hospitality']) === null);
  let r: any = L.toolLocked({ modules: { marketing: false } }, ['marketing']);
  check('off, the team is told what’s missing and where the owner adds it', locked(r) && /Marketing & reputation/.test(r.body.error) && /Your ClarityFlow/.test(r.body.error) && r.body.tool === 'marketing', r?.body);
  r = L.toolLocked({ modules: { hospitality: false } }, ['hospitality'], 'guest');
  const r2: any = L.toolLocked({ modules: { classes_events: false } }, ['classes_events'], 'guest', 'This event isn’t taking sign-ups right now.');
  check('…a guest only that it isn’t available (never about plans or prices)', locked(r) && r.body.error === 'This isn’t available right now.' && r2.body.error === 'This event isn’t taking sign-ups right now.' && !/plan|ClarityFlow/.test(r.body.error + r2.body.error));
  check('…and a screen two tools share is open while either is on', L.toolLocked({ modules: { hospitality: false, classes_events: true } }, ['hospitality', 'classes_events']) === null && locked(L.toolLocked({ modules: { hospitality: false, classes_events: false } }, ['hospitality', 'classes_events'])));

  console.log('the kitchen screen and floor board');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC' });
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: floor } = await import('../../src/app/api/floor/route');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Floor', kind: 'floor' }))).body.key;
  await plan({ hospitality: false, classes_events: false });
  r = await floor(req({ action: 'board', tenantId: 't1', key }));
  const k: any = await kitchen(req({ action: 'tickets', tenantId: 't1', key }));
  const p2: any = await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Bar' }));
  check('with neither Lounge nor Events, both screens are closed and a new one can’t be set up', locked(r) && r.body.closed === true && locked(k) && locked(p2), [r.body, k.body, p2.body]);
  await plan({ hospitality: false, classes_events: true });
  r = await floor(req({ action: 'board', tenantId: 't1', key }));
  check('…with Events alone they open (an event’s meals need them)', r.status === 200 && r.body.ok, r.body);
  await plan({ hospitality: false, classes_events: false });
  await db.doc(`${T}/refreshmentRequests/r1`).set({ id: 'r1', clientName: 'Maya', itemName: 'Latte', quantity: 1, status: 'ready', requestedAt: new Date().toISOString(), stockMoved: true });
  r = await kitchen(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'r1', step: 'deliver' }));
  check('…and while closed, an order already taken can still be handed over (the desk’s “Delivered” is the same step)', r.body.ok && (await get(`${T}/refreshmentRequests/r1`)).status === 'delivered', r.body);
  await plan({ hospitality: false, classes_events: true });
  const K = await import('../../src/lib/kitchen');
  check('lounge orders go to the desk while the kitchen screen isn’t part of the plan (never to a locked screen)', K.loungeMaker({ kitchenSettings: { loungeOrdersMadeBy: 'kitchen' } }) === 'kitchen'
    && K.loungeMaker({ kitchenSettings: { loungeOrdersMadeBy: 'kitchen' }, modules: { hospitality: false, classes_events: false } }) === 'desk'
    && K.loungeMaker({ kitchenSettings: { loungeOrdersMadeBy: 'kitchen' }, modules: { hospitality: false, classes_events: true } }) === 'kitchen');
  check('…and food sold at the desk is only sent to a kitchen screen that’s part of the plan', /sendToKitchen !== false && toMake > 0 && kitchenScreenOn\(tenant\)/.test(src('src/app/api/checkout/complete/route.ts')));

  console.log('station tablets (Lounge & hospitality)');
  await plan({ hospitality: false });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', price: 5, totalStock: 10, showOnMenu: true });
  const C = await import('../../src/app/api/concierge/requests/route');
  r = await C.GET(req({}, 'https://app.test/api/concierge/requests?tenantId=t1&menu=1'));
  const order: any = await C.POST(req({ tenantId: 't1', itemId: 'latte', quantity: 1, orderKey: 'k1', boothId: 'b1' }));
  check('off, the station menu shows nothing and takes no order (a guest is told it isn’t available)', locked(r) && locked(order) && r.body.error === 'This isn’t available right now.', [r.body, order.body]);
  await plan(undefined);
  r = await C.GET(req({}, 'https://app.test/api/concierge/requests?tenantId=t1&menu=1'));
  check('…on, the menu is there', r.status === 200 && r.body.ok, r.body);

  console.log('event sign-ups (Classes & events)');
  await db.doc(`${T}/studioEvents/e1`).set({ title: 'Spring dinner', date: '2030-05-01', time: '19:00', status: 'scheduled', capacity: 20 });
  const E = await import('../../src/app/api/public/event/route');
  await plan({ classes_events: false });
  r = await E.POST(req({ action: 'load', tenantId: 't1', eventId: 'e1' }));
  const reserve: any = await E.POST(req({ action: 'reserve', tenantId: 't1', eventId: 'e1', name: 'June Park', email: 'june@mail.test' }));
  const cancel: any = await E.POST(req({ action: 'cancel', tenantId: 't1', eventId: 'e1', guestId: 'g1', key: 'x'.repeat(40) }));
  check('off, the event page says it isn’t taking sign-ups, and none is taken', r.body.closed === true && r.body.message === 'This event isn’t taking sign-ups right now.' && locked(reserve) && !(await db.collection(`${T}/eventGuests`).get()).docs.length, [r.body, reserve.body]);
  check('…while a guest can still cancel the place they have', !cancel.body?.locked, cancel.body);
  await plan(undefined);
  r = await E.POST(req({ action: 'load', tenantId: 't1', eventId: 'e1' }));
  check('…on, the page is open', r.body.ok && !r.body.closed, r.body);
  check('ticket refunds are never locked (what’s owed is always paid back)', !/toolLocked/.test(src('src/app/api/events/tickets/route.ts')));

  console.log('the time clock and shift requests (Team & onboarding)');
  await plan({ team: false });
  const P = await import('../../src/app/api/timeclock/punch/route');
  r = await P.POST(req({ tenantId: 't1', action: 'clock_in' }));
  const out: any = await P.POST(req({ tenantId: 't1', action: 'clock_out' }));
  check('off, nobody starts a shift on the clock; anyone clocked in can still clock out', locked(r) && !out.body?.locked, [r.body, out.body]);
  const S = await import('../../src/app/api/shifts/request/route');
  r = await S.POST(req({ tenantId: 't1', action: 'submit', type: 'off', date: '2030-01-01', reason: 'Trip' }));
  const decide: any = await S.POST(req({ tenantId: 't1', action: 'decide', requestId: 'nope', approve: true }));
  check('…no new shift request, while one already made can still be answered', locked(r) && !decide.body?.locked, [r.body, decide.body]);

  console.log('the rest');
  await plan({ marketing: false, money: false, hospitality: false, kiosk: false, academy: false, voice: false });
  await db.doc(`${T}/campaigns/c1`).set({ name: 'Spring', status: 'draft' });
  const Cs = await import('../../src/app/api/campaigns/send/route');
  r = await Cs.POST(req({ tenantId: 't1', campaignId: 'c1', mode: 'send' }));
  check('Marketing off: no campaign goes out', locked(r) && (await get(`${T}/campaigns/c1`)).status === 'draft', r.body);
  await db.doc(`${T}/campaigns/c2`).set({ name: 'Win-back', status: 'automation', type: 'email' });
  r = await Cs.POST(req({ tenantId: 't1', campaignId: 'c2', mode: 'pause' }));
  check('…but one already set to go can still be paused or taken off the schedule', !r.body?.locked, r.body);
  check('…and the daily job sends none of the business’s own campaigns or automations while it’s off (renters’ own follow their offer)', /const marketingOn = moduleEnabled\(t\.data\(\), 'marketing'\)/.test(src('src/app/api/cron/campaigns/route.ts')) && /if \(!marketingOn && !\(a\.data\(\) as any\)\?\.ownerRenterId\) continue;/.test(src('src/app/api/cron/campaigns/route.ts')) && /\.filter\(\(c: any\) => marketingOn \|\| !!c\.ownerRenterId\)/.test(src('src/app/api/cron/campaigns/route.ts')));
  check('…while unsubscribing always works', !/toolLocked/.test(src('src/app/api/campaigns/unsubscribe/route.ts')));
  process.env.PLAID_CLIENT_ID = 'x'; process.env.PLAID_SECRET = 'y';
  const Pl = await import('../../src/app/api/plaid/route');
  r = await Pl.POST(req({ tenantId: 't1', action: 'link-token' }));
  check('Bookkeeping off: no new bank is connected', locked(r), r.body);
  const Mr = await import('../../src/app/api/month-review/route');
  r = await Mr.POST(req({ tenantId: 't1' }));
  check('…nothing new is pulled from a bank overnight', src('src/app/api/cron/nightly/route.ts').includes("'money')) { results[tenantId] = { skipped: 'Automated bookkeeping is off' }; continue; }"));
  check('…while the month in review (part of every plan) still opens', !locked(r) && !/toolLocked/.test(src('src/app/api/month-review/route.ts')), r.body);
  await db.doc(`${T}/parties/p1`).set({ name: 'Lee', phone: '+15550002222', status: 'waiting' });
  const H = await import('../../src/app/api/host/notify/route');
  r = await H.POST(req({ tenantId: 't1', partyId: 'p1' }));
  check('Lounge off: the host stand texts nobody', locked(r), r.body);
  await db.doc(T).set({ walkInKiosk: { enabled: true } }, { merge: true });
  const W = await import('../../src/app/api/walkins/route');
  r = await W.POST(req({ tenantId: 't1', action: 'join', name: 'Pat', phone: '5550003333' }));
  check('Front desk off: the walk-in kiosk takes nobody into the line, even switched on', r.body.closed === true && /Walk-ins aren’t being taken/.test(r.body.error) && !(await db.collection(`${T}/walkins`).get()).docs.length, r.body);
  const ci: any = await W.POST(req({ tenantId: 't1', action: 'code', code: '000000' }));
  check('…while checking in for a booking there still works (it’s part of every plan)', !ci.body?.closed, ci.body);
  await plan({ booth_rental: false, kiosk: true });
  const ba: any = await W.POST(req({ tenantId: 't1', action: 'booth-arrived', reservationId: 'x' }));
  check('…a renter’s day check-in follows Booth & suite rental', ba.body?.closed === true, ba.body);
  check('…and the desk’s own “Add a walk-in” isn’t part of any of it', /action === 'join' && !deskStaff && !moduleEnabled\(tenant, 'kiosk'\)/.test(src('src/app/api/walkins/route.ts')));
  await plan({ marketing: false, money: false, hospitality: false, kiosk: false, academy: false, voice: false });
  check('AI receptionist off: no number is bought and no call is placed', ['provision-number', 'outbound-call'].every((f) => /toolLocked\(tenant, \['voice'\]\)/.test(src(`src/app/api/voice/${f}/route.ts`)))
    && /if \(!moduleEnabled\(tenant, 'voice'\)\) return NextResponse\.json\(\{ placed: 0, skipped: 'voice_off' \}\)/.test(src('src/app/api/voice/send-reminders/route.ts')));
  check('…a call to its number is answered with a short “nobody can take your call”, with no business named to the booking tools', /if \(!moduleEnabled\(tenant, 'voice'\)\) \{[\s\S]{0,600}metadata: \{ tenantId: '' \}/.test(src('src/app/api/voice/inbound-webhook/route.ts'))
    && /tenant_id: ''/.test(src('src/app/api/voice/inbound-webhook/route.ts')));
  check('Memberships off: nothing is sold by phone either', ['sell-membership', 'sell-package'].every((f) => /if \(!moduleEnabled\(tenant, 'memberships'\)\)/.test(src(`src/app/api/voice/${f}/route.ts`))));
  check('Retail off: the online shop takes no new order; Booth rental off: no new day booking of a space', /toolLockedFor\(db, tenantId, \['retail'\], 'guest'/.test(src('src/app/api/retail/checkout/route.ts')) && (src('src/app/api/booths/reserve/route.ts').match(/'booth_rental'\], 'guest'/g) || []).length === 2);
  check('Online academy off: no AI drafting (and no credits used)', /toolLocked\(auth\.tenant, \['academy'\]\)[\s\S]{0,80}takeCredits/.test(src('src/app/api/academy/admin/route.ts')));
  check('memberships already sold keep renewing and a paid sale still enrolls (never locked)', !/toolLocked/.test(src('src/app/api/memberships/enroll/route.ts') + src('src/app/api/memberships/charge-renewals/route.ts')));

  console.log('the page a locked tool shows');
  const gate = src('src/components/shared/ToolGate.tsx'); const layout = src('src/app/(app)/layout.tsx');
  check('every app page goes through it, inside the sidebar', /<ToolGate>\{onSettingsPath \?/.test(layout));
  check('it says what the tool does and costs (the real price), and only the owner gets the button to add it', gate.includes('lockedModule(t, pathname)') && gate.includes('TOOL_PRICES[tool.id]') && gate.includes("ctx?.role === 'owner'") && gate.includes('href="/subscriptions"') && gate.includes('Only the owner can add it'));
  check('…and that nothing made with it is lost', /Anything already made with it is kept/.test(gate));
  check('where customers are owed something (tickets, members, shop orders, renters), the owner or a manager can still open it to finish that, under a banner saying nothing new can start',
    /classes_events: 'refunds for tickets/.test(gate) && /memberships: 'members who already joined/.test(gate) && /retail: 'shop orders already paid for/.test(gate) && /booth_rental: 'renters, leases/.test(gate)
    && gate.includes('Open it to finish what’s there') && gate.includes('new sign-ups, sales and bookings are off') && /const lead = owner \|\| ctx\?\.role === 'admin' \|\| ctx\?\.role === 'manager'/.test(gate));
  check('…and while the business is still loading, a tool’s page waits rather than flash', /if \(!t && hrefModule\(pathname\)\) return/.test(gate));

  console.log('the plan’s own words');
  const { TOOLS } = await import('../../src/lib/module-catalog');
  const by = (id: string) => TOOLS.find((t) => t.id === id)!;
  check('no class schedules are promised (they aren’t built)', !/schedul/i.test(JSON.stringify(by('classes'))), by('classes').includes);
  check('event waitlists are, now that they move people up on their own', by('classes').includes.some((x) => /Waitlists that move people up/.test(x)));
  check('the lounge menu is listed under Guest experience, where it works for everyone', by('guest').includes.some((x) => /Drinks and extras/.test(x)) && !/menu/i.test(by('lounge').includes.join(' ')));
  check('reviews aren’t sold as part of Marketing (every plan has them)', !/review/i.test(by('marketing').includes.join(' ')));
  const prices = src('src/lib/billing-plans.ts');
  check('prices are unchanged', /amount: 29, description: 'Events, workshops, sign-ups, quotes'/.test(prices) && /amount: 39, description: 'Seat-side ordering, host stand, kitchen display'/.test(prices) && /amount: 29, description: 'Campaigns, automations, offers, referrals'/.test(prices) && /cf_tool_classes_v2/.test(prices) && /cf_tool_lounge_v2/.test(prices));

  console.log('writing');
  const words = [gate, src('src/lib/tool-lock.ts')].join('\n');
  const strs = (words.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g) || []).filter((x) => !/^['"`]@\//.test(x)).join('\n');
  const bad = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('no emoji or check marks, no “call us”, no all-caps or JSX comments, no business-type words, no tool names', !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(words) && !/call us|contact us/i.test(strs) && !/\buppercase\b|font-black/.test(words)
    && !/\{\/\*/.test(gate) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strs) && !new RegExp(bad.join('|'), 'i').test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
