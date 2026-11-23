// Checks the bump bar on the kitchen screen (design board "A bump bar at each station", A: pick an order, then bump;
// lib/bump-bar, components/kitchen/BumpBar, app/kds, api/kitchen 'recall'):
// - keys: the usual ones with no setup, a bar's own keys learned one press each (a key used once), modifiers kept
// - picking: a number picks its card, the same number twice quickly moves it along; next and previous stop at the ends;
//   the card picked stays picked, or the one in its place does
// - what a key moves: made, then out; an allergy nobody noted is never moved by a key
// - Recall: what this screen moved (kitchen tickets only), for 10 minutes; on the server, back a step, never once the
//   order was handed over or the table's check closed; a bump says which tickets it moved
// - the screen: numbers on every card in every view, keys ignored in a box or under a sheet, a Tab user's Enter left to
//   the button, the strip and the setup in Spanish too
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bump-bar.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

(async () => {
  const B = await import('../../src/lib/bump-bar');
  const L = await import('../../src/lib/screen-lang');

  console.log('the keys');
  const k = (key: string, code = '', more: any = {}) => ({ key, code, ...more });
  check('the usual keys with no setup: numbers (top row or the number pad), Enter, Backspace, the arrows', B.actionOf(k('3', 'Digit3'), {}) === 'pick3' && B.actionOf(k('7', 'Numpad7'), {}) === 'pick7' && B.actionOf(k('Enter', 'Enter'), {}) === 'bump'
    && B.actionOf(k('Backspace', 'Backspace'), {}) === 'recall' && B.actionOf(k('ArrowRight', 'ArrowRight'), {}) === 'next' && B.actionOf(k('ArrowUp', 'ArrowUp'), {}) === 'prev' && B.actionOf(k('0', 'Digit0'), {}) === null && B.actionOf(k('a', 'KeyA'), {}) === null);
  check('…Page Up and Page Down still scroll the screen', B.actionOf(k('PageDown', 'PageDown'), {}) === null && B.actionOf(k('PageUp', 'PageUp'), {}) === null);
  check('…not with Ctrl or Alt held (the browser’s own shortcuts)', B.actionOf(k('1', 'Digit1', { ctrlKey: true }), {}) === null);
  check('a key is known by the key itself, with what was held: the same each press', B.keySig(k('F2', 'F2')) === 'F2' && B.keySig(k('b', 'KeyB', { ctrlKey: true })) === 'Ctrl+KeyB' && B.keySig(k('x', '')) === 'x' && B.keySig(k('Unidentified', '')) === ''
    && B.keyWords('Ctrl+KeyB') === 'Ctrl+B' && B.keyWords('Numpad4') === 'Numpad 4' && B.keyWords('Digit5') === '5' && B.keyWords('ArrowDown') === 'Down arrow');
  let learned = B.learn({}, 'bump', 'F1'); learned = B.learn(learned, 'recall', 'Enter'); learned = B.learn(learned, 'pick1', 'F1');
  check('a bar’s own keys, learned one press each; a key learned again moves to its new use', learned.pick1 === 'F1' && !learned.bump && learned.recall === 'Enter');
  check('…learned keys first: the bar’s Recall on Enter never bumps, and the usual keys still work for the rest', B.actionOf(k('Enter', 'Enter'), learned) === 'recall' && B.actionOf(k('F1', 'F1'), learned) === 'pick1' && B.actionOf(k('ArrowDown', 'ArrowDown'), learned) === 'next');
  check('kept clean on the tablet: only known actions, each key once', JSON.stringify(B.cleanLearned({ bump: 'F1', recall: 'F1', nonsense: 'F3', next: 5 })) === JSON.stringify({ recall: 'F1' }) && JSON.stringify(B.cleanLearned('junk')) === '{}');
  check('a modifier pressed on its own is never a bar’s key', B.isModifierOnly(k('Control')) && B.isModifierOnly(k('Shift')) && !B.isModifierOnly(k('a')));

  console.log('picking and moving');
  const keys = ['a', 'b', 'c'];
  let p = B.pressNumber(keys, 2, null, 1000);
  check('a number picks its card', p.focus === 'b' && !p.bumpNow);
  p = B.pressNumber(keys, 2, { n: 2, at: 1000 }, 1000 + B.DOUBLE_MS);
  check('…the same number twice quickly moves it along', p.focus === 'b' && p.bumpNow);
  check('…slower, or another number, only picks', !B.pressNumber(keys, 2, { n: 2, at: 1000 }, 1001 + B.DOUBLE_MS).bumpNow && !B.pressNumber(keys, 3, { n: 2, at: 1000 }, 1100).bumpNow);
  check('…a number with no card picks nothing', B.pressNumber(keys, 7, null, 0).focus === null);
  check('numbers 1 to 9, in reading order', B.numberOf(0) === 1 && B.numberOf(8) === 9 && B.numberOf(9) === null && B.numberOf(-1) === null);
  check('next and previous, stopping at the ends; with nothing picked, the first', B.moveFocus(keys, 'a', 'next') === 'b' && B.moveFocus(keys, 'c', 'next') === 'c' && B.moveFocus(keys, 'a', 'prev') === 'a' && B.moveFocus(keys, null, 'prev') === 'a' && B.moveFocus([], null, 'next') === null);
  check('the card picked stays picked while it’s up; moved on, the one in its place is; the last gone, the one before', B.keepFocus(keys, ['x', 'a', 'b', 'c'], 'b') === 'b' && B.keepFocus(keys, ['a', 'c'], 'b') === 'c'
    && B.keepFocus(keys, ['a', 'b'], 'c') === 'b' && B.keepFocus(keys, [], 'b') === null && B.keepFocus(keys, keys, null) === null);
  check('a key moves a ticket along: made, then out; one with an allergy nobody noted, never', B.bumpStep({ status: 'pending', needsNote: false }) === 'ready' && B.bumpStep({ status: 'in_progress', needsNote: false }) === 'ready'
    && B.bumpStep({ status: 'ready', needsNote: false }) === 'deliver' && B.bumpStep({ status: 'ready', needsNote: true }) === 'note' && B.bumpStep({ status: 'delivered', needsNote: false }) === null);

  console.log('Recall');
  let moved = B.remember([], { tickets: [{ col: 'kdsTickets', id: 'k1' }, { col: 'refreshmentRequests', id: 'r1' }], from: 'ready', at: 1000, label: 'D15' });
  moved = B.remember(moved, { tickets: [{ col: 'refreshmentRequests', id: 'r2' }], from: 'deliver', at: 2000, label: 'Lounge' });
  check('what this screen moved, kitchen tickets only (a lounge order’s stock and money move as it’s handed over)', moved.length === 1 && moved[0].tickets.length === 1 && moved[0].tickets[0].id === 'k1');
  moved = B.remember(moved, { tickets: [{ col: 'kdsTickets', id: 'k2' }], from: 'deliver', at: 5000, label: 'A16' });
  const last = B.lastMoved(moved, 6000);
  check('…the newest first, for 10 minutes', last?.m.label === 'A16' && last.rest.length === 1 && B.lastMoved(moved, 5000 + B.RECALL_MS + 1)?.m.label === undefined);
  check('…the last 20 kept', Array.from({ length: 30 }, (_, i) => i).reduce((l: any[], i) => B.remember(l, { tickets: [{ col: 'kdsTickets', id: `k${i}` }], from: 'ready', at: i, label: String(i) }), []).length === B.MAX_MOVED);
  const n = Date.now();
  check('on the server: ready goes back to being made, out goes back to ready, within 10 minutes', (B.canRecall({ status: 'ready', readyAt: ago(2) }, 'ready', n) as any).to === 'in_progress'
    && (B.canRecall({ status: 'delivered', deliveredAt: ago(9) }, 'deliver', n) as any).to === 'ready' && (B.canRecall({ status: 'delivered', deliveredAt: ago(11) }, 'deliver', n) as any).no === 'late' && (B.canRecall({ status: 'in_progress' }, 'ready', n) as any).no === 'moved'
    && (B.canRecall({ status: 'ready' }, 'ready', n) as any).no === 'late');
  check('…only what this screen did: one it readied that someone else has since served is left served', (B.canRecall({ status: 'delivered', deliveredAt: ago(1) }, 'ready', n) as any).no === 'moved' && (B.canRecall({ status: 'ready', readyAt: ago(1) }, 'deliver', n) as any).no === 'moved');

  console.log('the kitchen API');
  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', modules: { hospitality: true }, kitchenSettings: { screenOn: true } });
  const K = await import('../../src/app/api/kitchen/route');
  let r: any = await K.POST(req({ action: 'pair', tenantId: 't1', name: 'Grill' }));
  const key = r.body.key;
  check('a screen is set up', !!key, r.body);
  await db.doc(`${T}/counterOrders/o1`).set({ id: 'o1', number: 'D15', status: 'sent', channel: 'drive-thru' });
  await db.doc(`${T}/counterOrders/o2`).set({ id: 'o2', number: 'C16', status: 'done', channel: 'counter' });
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, status: 'completed' });
  await db.doc(`${T}/appointments/v2`).set({ id: 'v2', isTable: true, status: 'servicing' });
  await db.doc(`${T}/kdsTickets/a1`).set({ id: 'a1', orderId: 'o1', channel: 'drive-thru', menuItemName: 'Egg biscuit', status: 'pending', createdAt: ago(3), partsUsed: true });
  await db.doc(`${T}/kdsTickets/a2`).set({ id: 'a2', orderId: 'o1', channel: 'drive-thru', menuItemName: 'Hash browns', status: 'pending', createdAt: ago(3), partsUsed: true });
  r = await K.POST(req({ action: 'bump', tenantId: 't1', key, step: 'ready', tickets: [{ col: 'kdsTickets', id: 'a1' }, { col: 'kdsTickets', id: 'a2' }, { col: 'kdsTickets', id: 'gone1' }] }));
  check('a bump says which tickets it moved, so the screen can bring them back', r.body.ok && r.body.moved === 2 && JSON.stringify([...r.body.movedIds].sort()) === JSON.stringify(['a1', 'a2']), r.body);
  await db.doc(`${T}/kdsTickets/a1`).set({ carriedBy: 'Rosa', carriedAt: ago(0.2) }, { merge: true });
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, tickets: [{ col: 'kdsTickets', id: 'a1' }, { col: 'kdsTickets', id: 'a2' }] }));
  check('Recall says what the screen did', r.status === 400 && (await get(`${T}/kdsTickets/a1`)).status === 'ready');
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'ready', tickets: [{ col: 'kdsTickets', id: 'a1' }, { col: 'kdsTickets', id: 'a2' }] }));
  let a1: any = await get(`${T}/kdsTickets/a1`);
  check('Recall: both back to being made, with who and when, no ready time left behind, and nobody carrying it', r.body.ok && r.body.back === 2 && a1.status === 'in_progress' && a1.readyAt === null && a1.carriedBy === null && a1.recalledBy?.name === 'Grill' && !!a1.recalledAt && (await get(`${T}/kdsTickets/a2`)).status === 'in_progress', { body: r.body, a1 });
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'ready', tickets: [{ col: 'kdsTickets', id: 'a1' }] }));
  check('…brought back twice changes nothing', r.body.ok && r.body.back === 0 && r.body.gone === 1 && (await get(`${T}/kdsTickets/a1`)).status === 'in_progress');
  await db.doc(`${T}/kdsTickets/a1`).set({ status: 'delivered', deliveredAt: ago(1), deliveredBy: { name: 'Pass' } }, { merge: true });
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'ready', tickets: [{ col: 'kdsTickets', id: 'a1' }] }));
  check('…readied here and served since on another screen: left served (Recall never undoes someone else’s move)', r.body.ok && r.body.back === 0 && r.body.gone === 1 && (await get(`${T}/kdsTickets/a1`)).status === 'delivered', r.body);
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'deliver', tickets: [{ col: 'kdsTickets', id: 'a1' }] }));
  a1 = await get(`${T}/kdsTickets/a1`);
  check('…one bagged and out goes back to ready, while its order is still with the kitchen', r.body.back === 1 && a1.status === 'ready' && a1.deliveredAt === null && a1.deliveredBy === null, a1);
  await db.doc(`${T}/kdsTickets/b1`).set({ id: 'b1', orderId: 'o2', channel: 'counter', menuItemName: 'Latte', status: 'delivered', deliveredAt: ago(1), createdAt: ago(5) });
  await db.doc(`${T}/kdsTickets/b2`).set({ id: 'b2', source: 'tab', visitId: 'v1', menuItemName: 'Soup', status: 'delivered', deliveredAt: ago(1), createdAt: ago(5) });
  await db.doc(`${T}/kdsTickets/b3`).set({ id: 'b3', source: 'tab', visitId: 'v2', menuItemName: 'Salad', status: 'delivered', deliveredAt: ago(1), createdAt: ago(5) });
  await db.doc(`${T}/kdsTickets/b4`).set({ id: 'b4', orderId: 'o1', channel: 'drive-thru', menuItemName: 'Muffin', status: 'ready', readyAt: ago(11), createdAt: ago(15) });
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'deliver', tickets: ['b1', 'b2', 'b3'].map((id) => ({ col: 'kdsTickets', id })) }));
  const r4: any = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'ready', tickets: [{ col: 'kdsTickets', id: 'b4' }] }));
  check('…never once its order was handed over, or its table’s check closed; never after 10 minutes', r.body.back === 1 && r.body.handed === 2 && r4.body.late === 1
    && (await get(`${T}/kdsTickets/b1`)).status === 'delivered' && (await get(`${T}/kdsTickets/b2`)).status === 'delivered' && (await get(`${T}/kdsTickets/b3`)).status === 'ready' && (await get(`${T}/kdsTickets/b4`)).status === 'ready', r.body);
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key, from: 'ready', tickets: [{ col: 'refreshmentRequests', id: 'r1' }, { col: 'kdsTickets', id: 'bad id!' }] }));
  check('…kitchen tickets only', r.status === 400);
  r = await K.POST(req({ action: 'recall', tenantId: 't1', key: 'nope', from: 'ready', tickets: [{ col: 'kdsTickets', id: 'a1' }] }));
  check('…and only from a screen that’s set up', r.status === 401);

  console.log('the screen');
  const page = src('src/app/kds/[tenantId]/page.tsx'), bar = src('src/components/kitchen/BumpBar.tsx'), expo = src('src/components/kitchen/ExpoView.tsx'), api = src('src/app/api/kitchen/route.ts');
  check('every card has its number and shows when it’s picked: tickets in Lanes, orders, courses and dishes, and expo’s runs', /num=\{numOf\(`t:\$\{t\.col\}\/\$\{t\.id\}`\)\} picked=\{picked === `t:/.test(page) && /num=\{numOf\(`g:\$\{g\.key\}`\)\} picked=\{picked === `g:/.test(page)
    && /<BumpNo n=\{numberOf\(gi\)\} on=\{on\} \/>/.test(expo) && /picked=\{picked\} \/>/.test(page) && (page.match(/<BumpNo n=\{num\} on=\{picked\} \/>/g) || []).length === 2);
  check('…numbered in the order they’re shown (expo by the same grouping as its own)', /\[\.\.\.lanes\.waiting, \.\.\.lanes\.making, \.\.\.lanes\.ready\]/.test(page) && /expoGroups\(tickets as unknown as ExpoTicket\[\]\)/.test(page) && /expoGroups\(tickets as unknown as ExpoTicket\[\]\)/.test(expo));
  check('keys are ignored while typing in a box or with a sheet open, and repeats of a held key', /if \(document\.querySelector\('\[aria-modal="true"\]'\)\) return;/.test(page) && /\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(el\.tagName\)/.test(page) && /if \(e\.repeat \|\| e\.isComposing \|\| isModifierOnly\(e\)\) return;/.test(page));
  check('…someone moving around with Tab keeps Enter and the arrows for the button they’re on; after a tap, the bar’s Enter is the screen’s', /if \(e\.key === 'Tab'\) \{ tabbing\.current = true; return; \}/.test(page) && /const onPointer = \(\) => \{ tabbing\.current = false; \};/.test(page) && /if \(tabbing\.current && !keysRef\.current\[a\]/.test(page) && /e\.preventDefault\(\);\s*onKeyRef\.current\(a\);/.test(page));
  check('a key bump picks the next card, so the cook carries on down the line; after the last, none', /setPicked\(i >= 0 && cardKeys\[i \+ 1\] \? cardKeys\[i \+ 1\] : null\);/.test(page));
  check('…the card picked is announced too, not only ringed', (page.match(/aria-current=\{picked \? 'true' : undefined\}/g) || []).length === 2 && /aria-current=\{on \? 'true' : undefined\}/.test(expo) && /aria-live="polite">\{picked \? say\('Picked/.test(bar));
  check('Bump with nothing picked only picks the first; an allergy to note stops it with a word', /if \(!pickedCard\) \{ setPicked\(cardKeys\[0\] \|\| null\); return; \}/.test(page) && /if \(st === 'note'\) return \{ stop: allergyFirst\(c\.label\)/.test(page));
  check('what moved is remembered, by the tickets the server moved; Recall says what it did and needs the connection (never kept for later)', /setMoved\(\(m\) => remember\(m, \{ tickets: went\.map/.test(page) && /tap\(\{ action: 'recall', from: hit\.m\.from, tickets: hit\.m\.tickets \}, `Bring back \$\{hit\.m\.label\}`, false\)/.test(page) && /return ok\(\{ moved, failed, allergy, of: list\.length, movedIds, staffOk \}\);/.test(api));
  check('a tap can be brought back too, from the screen (Bring back, for 10 minutes)', /\{recallable && <button type="button" onClick=\{\(\) => void recall\(\)\}/.test(page));
  check('the strip and the setup: from the Screen menu, the strip comes on the first time a key is used unless it was turned off, and the learned keys are kept on this tablet', /setBumpSetup\(true\); \}\} className="w-full text-left min-h-\[44px\]/.test(page) && /if \(strip === null\) \{ setStrip\('on'\); write\(STRIP_STORE, 'on'\); \}/.test(page) && /write\(KEYS_STORE, Object\.keys\(c\)\.length \? JSON\.stringify\(c\) : null\)/.test(page));
  check('the setup listens only while it asks, leaves Tab and Escape alone, and stops the key reaching the screen', /if \(atRef\.current < 0 \|\| e\.key === 'Tab' \|\| isModifierOnly\(e\) \|\| e\.repeat\) return;/.test(bar) && /e\.preventDefault\(\); e\.stopPropagation\(\);/.test(bar) && /role="dialog" aria-modal="true" aria-labelledby="bump-title"/.test(bar));
  const pageWords = ['{what} has an allergy to note. Read it, then tap Allergy noted on the screen.', 'allergy to note first', 'ready', 'bagged and out', 'served', '{what} isn’t all ready yet.', 'not all ready yet', 'run it',
    'Nothing to bring back. Recall works for 10 minutes after something is moved.', 'No connection. Try again.', 'That didn’t go through. Try again.', 'Brought back: {what}', '{what} was already handed over, so it stays done.', '{what} was moved more than 10 minutes ago, so it stays where it is.',
    '{what} had already moved on.', 'Bring back {what}', 'bring back {what}', 'Set up a bump bar'];
  const words = [...[...bar.matchAll(/say\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]), ...pageWords, ...Object.values(B.ACTION_WORDS).filter((w) => !/^\d$/.test(w)), 'Up arrow', 'Down arrow', 'Left arrow', 'Right arrow', 'Backspace'];
  check('every word of it in Spanish', words.length > 40 && words.every((w) => L.hasSpanish(w)), words.filter((w) => !L.hasSpanish(w)));
  check('…and every one of those words is on the screen', pageWords.every((w) => page.includes(`'${w}'`)));
  for (const f of ['src/app/kds/[tenantId]/page.tsx', 'src/components/kitchen/BumpBar.tsx', 'src/components/kitchen/ExpoView.tsx', 'src/lib/bump-bar.ts']) check(`${f}: no comments in markup, no uppercase, no new " · "`, !/\{\/\*/.test(src(f)) && !/\buppercase\b/.test(src(f)) && !(f.includes('bump') && / · /.test(src(f))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
