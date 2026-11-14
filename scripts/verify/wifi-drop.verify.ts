// Checks a Wi-Fi drop on the floor (L20 round 11, design canvas "When the Wi-Fi drops"): lib/outbox (taps kept on the
// device, in order, sent when the connection's back; what the server turns down is listed), lib/last-seen (what a
// screen last had, with its time), the paper ticket (lib/printing paperDoc), opening a table's tab with no connection
// (lib/table-tab), the service worker (public/sw.js: the app's code and the floor screens' pages, never data), and the
// screens that use them.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/wifi-drop.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import vm from 'vm';
import { check, failures } from './fake-db';

// A browser, enough of one.
const store = new Map<string, string>();
const g: any = globalThis as any;
const sstore = new Map<string, string>();
g.sessionStorage = { getItem: (k: string) => (sstore.has(k) ? sstore.get(k)! : null), setItem: (k: string, v: string) => { sstore.set(k, String(v)); }, removeItem: (k: string) => { sstore.delete(k); } };
g.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); },
  get length() { return store.size; }, key: (i: number) => Array.from(store.keys())[i] ?? null };
const listeners: Record<string, Function[]> = {};
g.window = { addEventListener: (e: string, f: Function) => { (listeners[e] ||= []).push(f); }, removeEventListener: () => {} };
g.document = { addEventListener: () => {}, visibilityState: 'visible' };
Object.defineProperty(g, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
let net: 'up' | 'down' = 'up'; const sent: any[] = []; let answer: (body: any) => { status: number; d: any } = () => ({ status: 200, d: { ok: true } });
g.fetch = async (url: string, init: any) => {
  if (net === 'down') throw new TypeError('Failed to fetch');
  const body = JSON.parse(init.body); sent.push({ url, body, auth: init.headers?.Authorization || null });
  const a = answer(body); return { status: a.status, json: async () => a.d };
};
let uid: string | null = 'u1'; const order: string[] = []; let tokenFails = false; const authSubs: Function[] = [];
const M: any = Module as any; const load = M._load;
const fsCalls: any[] = []; let getDocMode: 'missing' | 'there' | 'offline' = 'missing';
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/auth') return { getAuth: () => ({ currentUser: uid ? { uid, getIdToken: async () => { if (tokenFails) throw new Error('auth/network-request-failed'); return `tok-${uid}`; } } : null }),
    onAuthStateChanged: (_a: any, f: Function) => { authSubs.push(f); f(uid ? { uid } : null); return () => {}; } };
  if (request === 'firebase/app') return { getApps: () => [{}] };
  if (request === 'firebase/firestore') return {
    getFirestore: () => ({}), waitForPendingWrites: async () => { order.push('synced'); },
    doc: (_fs: any, ...p: string[]) => ({ path: p.join('/'), id: p[p.length - 1] }), arrayUnion: (...x: any[]) => ({ union: x }),
    getDoc: async (ref: any) => { if (getDocMode === 'offline') throw new Error('Failed to get document because the client is offline.'); return { exists: () => getDocMode === 'there', data: () => g.__visitData || {} }; },
    setDoc: (ref: any, data: any, o?: any) => { fsCalls.push({ ref: ref.path, data, merge: !!o?.merge }); return new Promise(() => {}); },
    writeBatch: () => { const ops: any[] = []; return { set: (r: any, d: any, o?: any) => ops.push({ ref: r.path, d, o }), commit: async () => { fsCalls.push({ batch: ops }); } }; },
  };
  return load.call(this, request, ...rest);
};
const src = (p: string) => readFileSync(p, 'utf8');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const O = await import('../../src/lib/outbox');
  console.log('taps kept through a drop');
  let r = await O.send('/api/tab', { tenantId: 't1', action: 'fire', visitId: 'v4', course: 3 }, { label: 'Table 4: fire mains', auth: 'user', keep: true, tenantId: 't1' });
  check('with a connection it just goes, signed in as the person', !r.kept && r.d.ok && sent.length === 1 && sent[0].auth === 'Bearer tok-u1' && !O.connectionDown(), { r, sent, down: O.connectionDown() });
  net = 'down';
  r = await O.send('/api/tab', { tenantId: 't1', action: 'fire', visitId: 'v4', course: 4 }, { label: 'Table 4: fire dessert', auth: 'user', keep: true, tenantId: 't1', afterWrites: true });
  check('no connection: kept on the device, and the screen carries on', r.kept && r.d.ok && r.d.kept && O.keptNow().length === 1 && O.connectionDown() && O.outboxState('t1').waiting === 1 && O.outboxState('t2').waiting === 0);
  r = await O.send('/api/tab', { tenantId: 't1', action: 'nudge', partyId: 'p4', key: 'k', op: 'done' }, { label: 'Table 4: done', auth: 'user', keep: true, tenantId: 't1' });
  check('a tap while others wait goes behind them (never ahead)', r.kept && O.keptNow().length >= 1 && !sent.some((x) => x.body.action === 'nudge' && sent.indexOf(x) < sent.findIndex((y) => y.body.course === 4)));
  const r2 = await O.send('/api/tab', { tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v4' }, { label: 'x', auth: 'user', keep: false, tenantId: 't1' });
  check('what needs the connection says so, and isn’t kept', !r2.kept && r2.d.ok === false && r2.d.offline && /needs the connection/.test(r2.d.error) && O.keptNow().length === 2);
  net = 'up';
  await O.flush(); await O.flush();
  const fired = sent.filter((x) => x.body.action === 'fire' || x.body.action === 'nudge').map((x) => x.body.course || x.body.action);
  check('back: sent oldest first; a course fired after items waits for the items to reach the server first', fired.join() === '3,4,nudge' && order[0] === 'synced' && O.keptNow().length === 0 && O.outboxState('t1').sent === 2, fired);
  check('…and the connection is back', !O.connectionDown());

  console.log('when the server turns one down');
  net = 'down';
  await O.send('/api/kitchen', { tenantId: 't1', key: 'k', action: 'act', id: 'a', col: 'kdsTickets', step: 'ready' }, { label: 'Table 9: Half chicken, ready', auth: 'none', keep: true, tenantId: 't1' });
  await O.send('/api/kitchen', { tenantId: 't1', key: 'k', action: 'act', id: 'b', col: 'kdsTickets', step: 'ready' }, { label: 'Table 9: Fries, ready', auth: 'none', keep: true, tenantId: 't1' });
  net = 'up'; answer = (b) => (b.id === 'a' ? { status: 409, d: { ok: false, error: 'That ticket was already sent out.' } } : { status: 200, d: { ok: true } });
  await O.flush();
  const miss = O.outboxState('t1').missed;
  check('turned down when it arrived: listed for the person, and the rest still go', miss.length === 1 && miss[0].label === 'Table 9: Half chicken, ready' && /already sent out/.test(miss[0].error) && O.keptNow().length === 0 && sent.some((x) => x.body.id === 'b'));
  check('a tablet’s taps go with its own key, not a person’s sign-in', sent.filter((x) => x.url === '/api/kitchen').every((x) => x.auth === null && x.body.key === 'k'));
  O.dismissMissed('t1');
  check('…cleared once read', O.outboxState('t1').missed.length === 0);
  net = 'down'; await O.send('/api/kitchen', { tenantId: 't1', key: 'k', action: 'act', id: 'c', col: 'kdsTickets', step: 'ready' }, { label: 'c', auth: 'none', keep: true, tenantId: 't1' });
  net = 'up'; answer = () => ({ status: 503, d: { ok: false, error: 'Busy' } });
  for (let i = 0; i < 4; i++) await O.flush();
  check('the server failing: kept and tried again', O.keptNow().length === 1 && O.keptNow()[0].tries === 4);
  await O.flush();
  check('…a few times, then listed as not sent', O.keptNow().length === 0 && O.outboxState('t1').missed.length === 1);
  O.dismissMissed('t1'); answer = () => ({ status: 200, d: { ok: true } });

  console.log('kept too long, or someone else’s');
  store.set('cf.outbox.v1', JSON.stringify([{ id: 'old', url: '/api/tab', body: { tenantId: 't1' }, label: 'Table 2: fire mains', auth: 'user', who: 'u1', at: new Date(Date.now() - 13 * 3600000).toISOString(), tries: 0, tenantId: 't1', afterWrites: false },
    { id: 'theirs', url: '/api/tab', body: { tenantId: 't1', action: 'nudge' }, label: 'Theirs', auth: 'user', who: 'u2', at: new Date().toISOString(), tries: 0, tenantId: 't1', afterWrites: false }]));
  const before = sent.length; await O.flush();
  check('older than 12 hours: not sent, listed instead', O.outboxState('t1').missed.some((m) => m.label === 'Table 2: fire mains' && /too long/.test(m.error)));
  check('kept by someone else signed in on this device: waits for them, never sent as somebody else', sent.length === before && O.keptNow().some((k) => k.id === 'theirs'));
  uid = 'u2'; await O.flush();
  check('…sent once they’re signed in', O.keptNow().length === 0 && sent[sent.length - 1].auth === 'Bearer tok-u2', { kept: O.keptNow(), last: sent[sent.length - 1] });
  O.dismissMissed('t1'); uid = 'u1';

  console.log('kept with care');
  net = 'down'; tokenFails = true;
  await O.send('/api/tab', { tenantId: 't1', action: 'fire', visitId: 'v7', course: 3 }, { label: 'Table 7: fire mains', auth: 'user', keep: true, tenantId: 't1' });
  check('a sign-in that can’t be refreshed with no connection still knows whose tap it is', O.keptNow()[0]?.who === 'u1');
  net = 'up'; tokenFails = false; await O.flush(); await O.flush();
  check('…so it’s sent once it’s back', O.keptNow().length === 0 && sent[sent.length - 1].body.visitId === 'v7');
  net = 'down';
  await O.send('/api/kitchen', { tenantId: 't1', key: 'k', action: 'act', id: 'd', col: 'kdsTickets', step: 'claim', staffPass: 'secret-pass' }, { label: 'd', auth: 'none', keep: true, tenantId: 't1', hold: ['staffPass'] });
  check('a cook’s pass is held for the session only, never in the tablet’s lasting storage', !/secret-pass/.test(store.get('cf.outbox.v1') || '') && Array.from(sstore.values()).some((v) => /secret-pass/.test(v)));
  net = 'up'; await O.flush(); await O.flush();
  check('…and goes with the tap when it’s sent, then is gone', sent[sent.length - 1].body.staffPass === 'secret-pass' && !Array.from(sstore.values()).some((v) => /secret-pass/.test(v)));
  store.set('cf.outbox.v1', JSON.stringify([{ id: 'late', url: '/api/tab', body: { tenantId: 't1', action: 'fire' }, label: 'Table 3: fire dessert', auth: 'user', who: 'u1', at: new Date(Date.now() - 25 * 60000).toISOString(), tries: 0, tenantId: 't1', afterWrites: false, maxAgeMs: 20 * 60000 }]));
  const n1 = sent.length; await O.flush();
  check('a course fired more than 20 minutes ago isn’t sent (it would cook food nobody wants): listed instead', sent.length === n1 && O.outboxState('t1').missed.some((m) => m.label === 'Table 3: fire dessert'));
  O.dismissMissed('t1'); order.length = 0;
  await O.send('/api/tab', { tenantId: 't1', action: 'fire', visitId: 'v8', course: 3 }, { label: 'x', auth: 'user', keep: true, tenantId: 't1', afterWrites: true });
  check('firing a course with a connection still waits for its items to reach the server first', order[0] === 'synced' && sent[sent.length - 1].body.visitId === 'v8');

  net = 'down';
  await O.send('/api/tab', { tenantId: 't1', action: 'clear_done', unitId: 'u4' }, { label: 'Table 4: ready to seat', auth: 'user', keep: true, tenantId: 't1', stamp: 'at' });
  const stamped = O.keptNow().find((k) => k.body.action === 'clear_done');
  net = 'up'; await O.send('/api/tab', { tenantId: 't9', action: 'clear_done', unitId: 'u1' }, { label: 'x', auth: 'user', keep: true, tenantId: 't9', stamp: 'at' });
  check('a kept tap says when it was tapped; one sent straight away doesn’t need to', !!stamped && Number.isFinite(Date.parse(stamped.body.at)) && !('at' in sent[sent.length - 1].body));
  await O.flush(); await O.flush();

  console.log('a save straight to the database');
  const quick = await O.landed(Promise.resolve(7), 50); const slow = await O.landed(new Promise(() => {}), 30);
  let threw = false; try { await O.landed(Promise.reject(new Error('denied')), 50); } catch { threw = true; }
  check('waited for a moment at most; one turned down at once still says so', quick === 7 && slow === undefined && threw);
  let deny: Function = () => {}; const lateSave = new Promise((_, no) => { deny = no; });
  await O.landed(lateSave, 20, { label: 'Host stand: adding Diaz', tenantId: 't1' }); deny(Object.assign(new Error('x'), { code: 'permission-denied' })); await wait(5);
  check('…one turned down later is listed with what didn’t go through', O.outboxState('t1').missed.some((m) => m.label === 'Host stand: adding Diaz' && /not allowed/.test(m.error)));
  O.dismissMissed('t1');

  console.log('what a screen last had');
  const L = await import('../../src/lib/last-seen');
  L.keepLast('floor.t1', { a: 1 }); L.keepLast('floor.t1', { a: 2 });
  const got = L.lastOf<any>('floor.t1');
  check('kept with its time (at most every 15 seconds)', !!got && got.data.a === 1 && Math.abs(got.at - Date.now()) < 2000);
  store.set('cf.last.u1.floor.t2', JSON.stringify({ at: Date.now() - 13 * 3600000, data: { a: 3 } }));
  check('…not shown once it’s 12 hours old', L.lastOf('floor.t2') === null);
  uid = 'u2';
  check('…only to the person it was kept for (a shared tablet’s next person never sees it)', L.lastOf('floor.t1') === null);
  uid = 'u1'; for (const f of authSubs) f(null);
  check('…and cleared when they sign out', !Array.from(store.keys()).some((k) => k.startsWith('cf.last.u1.')));

  console.log('the paper ticket');
  const P = await import('../../src/lib/printing'); const K = await import('../../src/lib/kitchen');
  const tk = (o: any) => K.ticketFrom({ status: 'pending', tableNumber: 'Table 4', guestName: 'Okafor', quantity: 1, courseName: 'Mains', ...o }, 'kdsTickets');
  const doc = P.paperDoc([{ station: 'Kitchen', tickets: [tk({ id: 'tab_v4_a', itemName: 'Ribeye', seatNumber: '1', note: 'Medium rare' }), tk({ id: 'tab_v4_b', itemName: 'Bream', seatNumber: '2', allergies: [{ name: 'Tree nuts', severity: 'severe' }] })] },
    { station: 'Bar', tickets: [tk({ id: 'tab_v4_c', itemName: 'Negroni' })] }], { tz: 'America/New_York', at: new Date().toISOString(), by: 'Rae Kim' });
  const txt = P.renderText(doc, 42);
  check('what hasn’t reached the kitchen, each station’s part, the allergy set off, whose it is; no ticket number the kitchen can’t see', /^Paper ticket: not on the screens yet/m.test(txt.trim()) && /Mains\. For the Kitchen/.test(txt) && /For the Bar/.test(txt)
    && /^1  Ribeye$/m.test(txt) && /^>> Allergy, seat 2: tree nuts, severe <<$/m.test(txt) && /^Rae Kim$/m.test(txt) && !/#/.test(txt), txt);

  console.log('opening a table with no connection');
  const TT = await import('../../src/lib/table-tab');
  getDocMode = 'offline'; fsCalls.length = 0;
  const id = await Promise.race([TT.ensureTableVisit({} as any, 't1', { id: 'p9', name: 'Diaz', size: 2 }, 'Table 9', 'Rae Kim'), wait(6000).then(() => 'stuck')]);
  const open = fsCalls[0];
  check('a table this phone hasn’t seen opens anyway, by merging only what can’t be wrong: never its tab, status or start time', id !== 'stuck' && !!open && open.merge && !('tab' in open.data) && !('status' in open.data) && !('startTime' in open.data) && open.data.isTable && !!open.data.openedOffline, open);
  getDocMode = 'missing'; fsCalls.length = 0;
  await TT.ensureTableVisit({} as any, 't1', { id: 'p9', name: 'Diaz', size: 2 }, 'Table 9', 'Rae Kim');
  check('…a new one with a connection starts with an empty tab', !fsCalls[0].merge && Array.isArray(fsCalls[0].data.tab));
  getDocMode = 'there'; g.__visitData = { openedOffline: '2026-11-14T19:00:00.000Z', tab: [{ lineId: 'x' }] }; fsCalls.length = 0;
  await TT.ensureTableVisit({} as any, 't1', { id: 'p9', name: 'Diaz', size: 2 }, 'Table 9', 'Rae Kim');
  check('…one opened with no connection gets its status and start time the next time it’s opened with one (from when it was opened)', fsCalls[0].merge && fsCalls[0].data.status === 'servicing' && fsCalls[0].data.startTime === '2026-11-14T19:00:00.000Z' && !('tab' in fsCalls[0].data));
  g.__visitData = null;
  fsCalls.length = 0;
  const line = await TT.addToTab({} as any, 't1', 'v9', { tableName: 'Table 9', guestName: 'Diaz' }, { id: 'rib', type: 'product', name: 'Ribeye', price: 32, station: 'Kitchen' }, { by: 'Rae Kim', lineId: 'abc123xyz' });
  check('an item keeps the line the screen chose (so it can say "Not sent yet" before the save is confirmed)', line.lineId === 'abc123xyz' && fsCalls[0].batch.some((o: any) => o.ref.endsWith('tab_v9_abc123xyz')));

  console.log('the service worker');
  const sw = src('public/sw.js');
  const caches = new Map<string, Map<string, any>>();
  const cacheOf = (n: string) => { if (!caches.has(n)) caches.set(n, new Map()); const m = caches.get(n)!;
    return { match: async (q: any) => m.get(typeof q === 'string' ? q : q.url) || undefined, put: async (q: any, res: any) => { m.set(typeof q === 'string' ? q : q.url, res); }, keys: async () => Array.from(m.keys()).map((url) => ({ url })), delete: async (q: any) => m.delete(q.url || q), addAll: async () => {} }; };
  const handlers: Record<string, Function> = {}; let swNet: 'up' | 'down' = 'up'; let swFetches = 0;
  const html = (body: string) => ({ ok: true, type: 'basic', status: 200, body, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, clone() { return this; } });
  const ctx: any = {
    self: { addEventListener: (e: string, f: Function) => { handlers[e] = f; }, location: { origin: 'https://app.test' }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: { open: async (n: string) => cacheOf(n), keys: async () => Array.from(caches.keys()), delete: async (n: string) => caches.delete(n), match: async () => undefined },
    fetch: async (q: any) => { swFetches++; if (swNet === 'down') throw new TypeError('offline'); const url = typeof q === 'string' ? q : q.url; return url.endsWith('.js') ? { ok: true, type: 'basic', status: 200, body: 'code', headers: { get: () => 'text/javascript' }, clone() { return this; } } : html(`page ${url}`); },
    Request: class { url: string; constructor(u: string) { this.url = u; } }, URL, setTimeout, Promise, console,
  };
  ctx.self.caches = ctx.caches; vm.createContext(ctx); vm.runInContext(sw, ctx);
  const ev = (url: string, mode = 'no-cors', method = 'GET') => { let res: any = null; let used = false;
    handlers.fetch({ request: { url, mode, method }, respondWith: (p: any) => { used = true; res = p; } }); return { used, res: () => Promise.resolve(res) }; };
  const api = ev('https://app.test/api/tab', 'cors', 'POST'); const apiGet = ev('https://app.test/api/kitchen');
  check('never touches the app’s data (nothing under /api)', !api.used && !apiGet.used);
  const c1 = ev('https://app.test/_next/static/chunks/app.js'); await c1.res(); const n0 = swFetches;
  const c2 = ev('https://app.test/_next/static/chunks/app.js'); const code = await c2.res();
  check('the app’s code: kept on first use, then from the device', c1.used && c2.used && swFetches === n0 && code.body === 'code');
  const p1 = ev('https://app.test/host?x=1', 'navigate'); const page1 = await p1.res(); await wait(5);
  check('a floor screen’s page: from the network while it answers (and kept)', p1.used && /page/.test(page1.body) && caches.get('cf-pages-v1')?.has('https://app.test/host'));
  swNet = 'down';
  const p2 = ev('https://app.test/host', 'navigate'); const page2 = await p2.res();
  check('…the kept page when the network doesn’t answer', p2.used && /page/.test(page2.body));
  const other = ev('https://app.test/settings', 'navigate');
  check('other pages aren’t kept or served from the device', !other.used);
  swNet = 'up';
  let waited: Promise<any> | null = null;
  handlers.message({ data: { type: 'cf-keep', url: 'https://app.test/clear' }, waitUntil: (p: any) => { waited = p; } }); await waited;
  handlers.message({ data: { type: 'cf-keep', url: 'https://app.test/settings/billing' }, waitUntil: (p: any) => { waited = p; } });
  check('a floor screen opened inside the app asks for its page to be kept; others can’t', caches.get('cf-pages-v1')?.has('https://app.test/clear') && !caches.get('cf-pages-v1')?.has('https://app.test/settings/billing'));
  caches.set('cf-old', new Map()); let done: Promise<any> | null = null;
  handlers.activate({ waitUntil: (p: any) => { done = p; } }); await done;
  check('an old store of the worker’s is cleared out', !caches.has('cf-old') && caches.has('cf-pages-v1'));
  check('it says why it never keeps data', /never keeps the app's DATA/.test(sw));

  console.log('the screens');
  const kds = src('src/app/kds/[tenantId]/page.tsx'), host = src('src/app/(app)/host/page.tsx'), tables = src('src/app/(app)/tables/page.tsx'), clear = src('src/app/(app)/clear/page.tsx'), tab = src('src/components/host/TableTab.tsx'), bar = src('src/components/shared/ConnectionBar.tsx');
  check('every floor screen shows the connection and keeps its page', [kds, host, tables, clear].every((x) => /<ConnectionBar /.test(x) && /useKeepPage\(\)/.test(x)));
  check('…and what it last had when it opens with none', [kds, host, tables, clear].every((x) => /lastOf/.test(x) && /keepLast/.test(x)));
  check('the kitchen: Start, Ready, Served and Allergy noted kept; cancelling needs the connection', /s !== 'cancel'\)/.test(kds) && /'allergyNoted'[^\n]*true\)/.test(kds) && /Sends when it’s back/.test(kds) && /Cancelling needs the connection/.test(kds));
  check('the tab: "Not sent yet", the paper ticket, firing kept after the items; allergies never wait', /Not sent yet/.test(tab) && /Print a paper ticket/.test(tab) && /afterWrites: body\.action === 'fire'/.test(tab) && /No connection, so the allergy didn’t change/.test(tab) && /includeMetadataChanges: true/.test(tab));
  check('the host stand: saves don’t spin with no connection; what needs the server says so', /landed\(updateDoc/.test(host) && /keep: false/.test(host));
  check('the host stand: seating needs the connection (two stands could seat the same table)', /Seating needs the connection\./.test(host) && /if \(connectionDown\(\) \|\| asOf !== null\)/.test(host));
  check('the bar: since when, how old, how many wait, what didn’t go through', /No connection since/.test(bar) && /This is what the screen had then/.test(bar) && /waiting/.test(bar) && /didn’t go through/.test(bar) && /Back online/.test(bar));
  const fresh = [src('src/lib/outbox.ts'), src('src/lib/last-seen.ts'), bar, src('src/components/pwa/keep-page.ts')].join('\n');
  check('no emoji, all caps, niche words in what’s new', !/[\u{1F300}-\u{1FAFF}]/u.test(fresh) && !/\buppercase\b|font-black/.test(fresh) && !/\b(salon|stylist|booth|chair)\b/i.test(fresh));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
