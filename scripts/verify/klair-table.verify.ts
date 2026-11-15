// Checks Klair at the table (L20 round 18, design canvas "Klair at the table"): lib/klair-menu (guests' menu questions,
// answered only from recipes and allergen marks), lib/klair-menu-server, api/table-pay and api/counter/ahead
// 'menu_ask', lib/klair (reading floor questions), lib/klair-floor and api/klair (answering them), the setting and the
// screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/klair-table.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
let tenantForAuth: any = {};
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: tenantForAuth }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/wallet-domains') return { ensureWalletDomainsSoon: async () => {} };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, ip = '10.4.4.4') => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'x-real-ip' ? ip : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const TOK = 'abcdefghijklmnopqrstuv';

(async () => {
  const KM = await import('../../src/lib/klair-menu');
  const F = (name: string, allergens: any[] | null, recipe: string[] = [], soldOut = false): any => ({ id: name.toLowerCase().replace(/ /g, '-'), name, allergens: allergens || [], allergensSet: allergens !== null, recipe, soldOut });
  const facts = [F('Tomato soup', ['milk'], ['Tomatoes', 'Cream', 'Onion']), F('Onion soup', null), F('Crudo', ['fish'], ['Sea bream', 'Lemon', 'Olive oil']), F('Burger', ['wheat', 'gluten', 'milk', 'sesame'], ['Beef patty', 'Bun', 'Cheddar', 'Dijon mustard']),
    F('Fries', []), F('Hot chocolate', ['milk'], ['Milk', 'Cocoa']), F('Nut brittle', ['peanuts']), F('Short rib', [], [], true),
    F('Chicken', []), F('Chicken wings', ['soy']), F('Grilled chicken salad', []), F('Fish tacos', ['fish', 'wheat', 'gluten'])];
  const A = (q: string) => KM.menuAnswer(q, facts);
  console.log('guests’ menu questions');
  check('“Is the tomato soup gluten-free?”: from its allergen marks, gluten before wheat, and says to tell the server', A('Is the tomato soup gluten free?').text === 'Tomato soup lists no gluten or wheat among its allergens.' && A('Is the tomato soup gluten free?').tell);
  check('…“the soup”: only part of a dish’s name, so no verdict, just which dishes they may mean', A('Is there gluten in the soup?').text === 'I couldn’t find that exact dish. Did you mean Onion soup or Tomato soup? Ask again with its full name.' && A('Is there gluten in the soup?').tell);
  check('…a dish without marks is “please ask your server”, never a guess', A('Is the onion soup gluten free?').text === 'We haven’t marked the allergens in Onion soup here, so I can’t say. Please ask your server.');
  check('…“the chicken sandwich” when the menu has Chicken: not answered about Chicken; “fish and chips” isn’t Fish tacos', A('Is the chicken sandwich gluten-free?').text === 'I couldn’t find that exact dish. Did you mean Chicken, Chicken wings or Grilled chicken salad? Ask again with its full name.'
    && A('Is the fish and chips gluten free?').text.startsWith('I couldn’t find that exact dish. Did you mean Fish tacos?') && A('what’s in the chicken sandwich').kind === 'cant' && A('is the chicken gluten free').text === 'Chicken lists no gluten or wheat among its allergens.');
  check('an allergen the marks don’t cover (mustard, garlic, sulfites): what the recipe lists, then plainly that it can’t say, never the other allergens', A('Does the burger have mustard?').text === 'Burger’s recipe lists dijon mustard. Our allergen marks cover only milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, gluten, soy and sesame, so I can’t say about mustard. Please ask your server.'
    && A('I am allergic to garlic can I have the burger').text === 'Our allergen marks cover only milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, gluten, soy and sesame, so I can’t say about garlic. Please ask your server.' && A('does the burger have sulfites').tell && !/contains/.test(A('does the burger have sulfites').text)
    && /can’t say which dishes have garlic/.test(A('what has no garlic').text));
  check('…“celiacs” is gluten', A('is the burger safe for celiacs').text === 'Burger contains gluten and wheat.');
  const F2 = [F('Bread', ['wheat']), F('Burger', ['gluten', 'wheat', 'eggs'])];
  check('two allergens asked: what it has, and plainly what it doesn’t (wheat and gluten go together)', KM.menuAnswer('does the burger contain gluten or milk', F2).text === 'Burger contains gluten and wheat. It lists no milk.'
    && KM.menuAnswer('is the bread gluten free', F2).text === 'Bread contains wheat.' && KM.menuAnswer('is the burger ok for someone allergic to lupin', F2).text.endsWith('so I can’t say about lupin. Please ask your server.'));
  check('“Does the burger have sesame?”', A('does the burger have sesame').text === 'Burger contains sesame.');
  check('“What’s in the crudo?”: its recipe, and what it contains', A('What’s in the crudo?').text === 'Crudo is made with sea bream, lemon and olive oil. It contains fish.');
  check('…a dish with no recipe written down says so', A('what’s in the onion soup').text === 'I don’t have the recipe for Onion soup here. Please ask your server.');
  check('…“hot” in “hot chocolate” is the dish, not a question about spice', A('whats in the hot chocolate').text === 'Hot chocolate is made with milk and cocoa. It contains milk.');
  check('“What can I have without nuts?”: only dishes whose allergens are marked, not sold out, and says what’s left out', A('What can I have without nuts?').text === 'These list no tree nuts or peanuts: Tomato soup, Crudo, Burger, Fries, Hot chocolate, Chicken, Chicken wings, Grilled chicken salad, Fish tacos. Dishes without allergens marked aren’t included.', A('What can I have without nuts?').text);
  check('…which list no shellfish (fish isn’t shellfish)', /Crudo/.test(A('which dishes have no shellfish').text) && A('What can I have without nuts?').kind === 'list');
  check('vegan, spicy, how it’s cooked: “I can’t tell that from our recipes”', A('Is the burger vegan?').kind === 'cant' && A('is the crudo spicy').kind === 'cant' && A('Is the burger vegan?').text === 'I can’t tell that from our recipes. Your server can check with the kitchen.');
  check('anything else: what she can answer', A('hello').kind === 'help' && A('').kind === 'help');
  const likely = KM.menuFacts([{ id: 'x', name: 'Pesto pasta', onMenu: true, membersOnly: false, soldOut: false, inStock: true, allergens: [], allergensSet: false, recipe: ['Basil', 'Pine nuts'], allergensLikely: ['treenuts'] } as any]);
  check('likely allergens from a starter menu are never used: unmarked is unmarked', KM.menuAnswer('does the pesto pasta have nuts', likely).text === 'We haven’t marked the allergens in Pesto pasta here, so I can’t say. Please ask your server.');
  const mf = KM.menuFacts([{ id: 'a', name: 'A', onMenu: true, membersOnly: false, soldOut: false, inStock: false, allergens: ['milk'], allergensSet: true }, { id: 'b', name: 'B', onMenu: false, membersOnly: false, soldOut: false, inStock: true, allergens: [], allergensSet: true }, { id: 'c', name: 'C', onMenu: true, membersOnly: true, soldOut: false, inStock: true, allergens: [], allergensSet: true }] as any);
  check('only what’s on the menu for everyone; out of stock counts as sold out', mf.length === 1 && mf[0].id === 'a' && mf[0].soldOut);
  check('on only with the assistant on and the business’s say-so', KM.menuAnswersOn({ klair: { menuAnswers: true } }, true) && !KM.menuAnswersOn({ klair: { menuAnswers: true } }, false) && !KM.menuAnswersOn({ klair: {} }, true));

  console.log('on the table’s page and ordering ahead');
  const on = { id: 't1', name: 'Linden', timezone: 'UTC', addons: { assistant: true }, klair: { name: 'Mae', menuAnswers: true }, kitchenSettings: { tablePay: { on: true } }, orderAhead: { on: true } };
  await db.doc(T).set({ ...on, klair: { name: 'Mae' } });
  const inv = (id: string, name: string, x: any = {}) => db.doc(`${T}/inventory/${id}`).set({ id, name, type: 'refreshment', msrp: 10, price: 10, category: 'Mains', ...x });
  await inv('soup', 'Tomato soup', { allergens: ['milk'], formula: [{ id: 'tom', name: 'Tomatoes', quantityUsed: 1 }, { id: 'cr', name: 'Cream', quantityUsed: 1 }] });
  await inv('burger', 'Burger', { allergens: ['wheat', 'gluten', 'milk', 'sesame'] });
  await inv('secret', 'Chef’s table', { isMembersOnly: true, allergens: [] });
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: '5', status: 'servicing', payToken: TOK, tab: [] });
  const P = await import('../../src/app/api/table-pay/route');
  let r: any = await P.POST(req({ tenantId: 't1', token: TOK, action: 'view' }));
  const off: any = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: 'is the soup gluten free' }));
  check('off until the business turns it on: not on the page, and not answered', r.body.ok && r.body.pass.klair === null && off.status === 403, [r.body.pass?.klair, off.body]);
  await db.doc(T).set(on);
  const KMS = await import('../../src/lib/klair-menu-server'); KMS.forgetMenuFacts('t1');
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'view' }));
  check('on: the page offers to ask her, by the business’s name for her', r.body.pass.klair?.name === 'Mae');
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: '  is the   tomato soup gluten free? ' }));
  check('…answered from the menu, recipes and marks', r.body.ok && r.body.answer.text === 'Tomato soup lists no gluten or wheat among its allergens.' && r.body.answer.tell && r.body.name === 'Mae', r.body);
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: 'what’s in the tomato soup' }));
  check('…its recipe as the menu has it', r.body.answer.text === 'Tomato soup is made with tomatoes and cream. It contains milk.', r.body.answer);
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: 'what’s in the chef’s table' }));
  check('…members-only dishes aren’t talked about', !/Chef/.test(r.body.answer.text), r.body.answer);
  const Menu = await import('../../src/app/api/menu/route');
  await db.doc(`${T}/inventory/soup`).set({ allergens: ['milk', 'gluten'] }, { merge: true });
  await Menu.POST(req({ tenantId: 't1', action: 'soldout', id: 'nothing' })).catch(() => null);
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: 'is the tomato soup gluten free' }));
  check('…an allergen just marked counts at once after a menu change here (and within seconds otherwise)', r.body.answer.text === 'Tomato soup contains gluten.' && /const MS = 5000/.test(src('src/lib/klair-menu-server.ts')), r.body.answer);
  r = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: '   ' }));
  let many = 0; for (let i = 0; i < 14; i++) { const x: any = await P.POST(req({ tenantId: 't1', token: TOK, action: 'menu_ask', question: 'burger?' }, '10.4.4.5')); if (x.status === 429) many++; }
  check('…a question is needed, and a few a minute from one table', r.status === 400 && many > 0, many);
  const AH = await import('../../src/app/api/counter/ahead/route');
  r = await AH.POST(req({ tenantId: 't1', action: 'menu' }));
  const ra: any = await AH.POST(req({ tenantId: 't1', action: 'menu_ask', question: 'does the burger have sesame' }));
  check('ordering ahead: offered, and answered the same way', r.body.klair?.name === 'Mae' && ra.body.ok && ra.body.answer.text === 'Burger contains sesame.', [r.body.klair, ra.body]);
  const rv: any = await AH.POST(req({ tenantId: 't1', action: 'menu_ask', question: 'is the burger vegan' }));
  check('…with no server there, “the team”', rv.body.answer.text === 'I can’t tell that from our recipes. The team can check with the kitchen.' && KM.menuAnswer('hello', facts, 'team').text.endsWith('please ask the team.') && /tell=\{TELL_TEAM\}/.test(src('src/app/order/[tenantId]/page.tsx')), rv.body.answer);
  await db.doc(T).set({ addons: { assistant: false } }, { merge: true });
  const ro: any = await AH.POST(req({ tenantId: 't1', action: 'menu_ask', question: 'does the burger have sesame' }));
  check('…without the assistant add-on: not answered', ro.status === 403);
  await db.doc(T).set({ addons: { assistant: true } }, { merge: true });

  console.log('the team asks about the floor');
  const K = await import('../../src/lib/klair');
  const pp = (x: string) => K.plainPlan(x);
  check('read plainly: a table, the wait (with a party size), the kitchen, what’s sold out', pp('What’s left for table 4?').intent === 'table' && pp('What’s left for table 4?').table === '4' && pp('where’s the food for table patio 2').table === 'patio 2'
    && pp('How long is the wait for 4?').intent === 'wait' && pp('How long is the wait for 4?').size === 4 && pp('who’s waiting').size === null
    && pp('Is the kitchen behind?').intent === 'kitchen' && pp('What’s 86’d?').intent === 'soldout' && pp('are we running out of salmon').intent === 'soldout');
  check('…and the old ones still read the same, “wait” and “out of” in them included', pp('who hasn’t confirmed tomorrow').intent === 'unconfirmed' && pp('I’m running 10 minutes late').intent === 'late' && pp('what’s next').intent === 'next'
    && pp('Tell my next clients I’m running 10 minutes late, they might have to wait').intent === 'late' && pp('send Maya a quote').intent === 'unknown' && pp('is anyone in the waiting room?').intent === 'unknown' && pp('who’s waiting').intent === 'wait' && pp('I’m out of town Friday').intent === 'unknown' && pp('I’m running out of time').intent === 'unknown' && pp('book her for 86 dollars').intent === 'unknown' && pp('the kitchen is 10 minutes behind').intent === 'kitchen');
  const cp = K.cleanPlan({ intent: 'table', table: '12', size: 99, spans: ['table 12'] }, 'what’s left for table 12');
  check('read by the model: the table only as said, a sensible party size', cp.intent === 'table' && cp.table === '12' && cp.size === null && K.cleanPlan({ intent: 'table', table: '9' }, 'table 12').table === null
    && K.planPrompt({ today: '2026-11-15', weekday: 'Sunday', tz: 'UTC', name: 'Mae' }).includes('soldout = what'));
  const KF = await import('../../src/lib/klair-floor');
  check('the kitchen, said plainly', KF.paceAnswer({ behindMin: 9, level: 'busy', making: 7, samples: 8 }) === 'About 9 minutes behind, 7 dishes being made. The host stand’s waits and pickup times already count it.'
    && KF.paceAnswer({ behindMin: 0, level: 'calm', making: 2, samples: 4 }) === 'The kitchen is keeping up: 2 dishes being made.');
  const menu: any[] = [{ name: 'Short rib', onMenu: true, soldOut: true, inStock: true, canMake: null }, { name: 'Squid', onMenu: true, soldOut: false, inStock: false, canMake: 0 }, { name: 'Bream', onMenu: true, soldOut: false, inStock: true, canMake: 3 }, { name: 'Steak', onMenu: true, soldOut: false, inStock: true, canMake: 20 }, { name: 'Old', onMenu: false, soldOut: true, inStock: true, canMake: null }];
  check('what’s sold out and running low', KF.soldOutAnswer(menu) === 'Sold out: Short rib, Squid. Running low: Bream (3 left).' && KF.soldOutAnswer([menu[3]]) === 'Nothing is sold out.');

  const RN = Date.now(); const ago = (m: number) => new Date(RN - m * 60000).toISOString();
  await db.doc(`${T}/serviceSessions/s1`).set({ id: 's1', status: 'open', opensAt: ago(200), units: [{ id: 'u4', name: '4', seatCount: 4, staffIds: [] }, { id: 'u6', name: '6', seatCount: 2, staffIds: [] }] });
  await db.doc(`${T}/parties/riv`).set({ id: 'riv', sessionId: 's1', status: 'seated', name: 'Rivera Lopez', size: 4, unitIds: ['u4'], seatedAt: ago(50), guestIds: [] });
  const L = (id: string, name: string, course: number, fired: number | null, o: any = {}) => ({ lineId: id, itemId: id, itemType: 'product', name, price: 20, quantity: 1, seat: 1, course, kdsId: `k_${id}`, firedAt: fired === null ? null : ago(fired), makeSeconds: 600, ...o });
  await db.doc(`${T}/appointments/apt-party-riv`).set({ tableName: '4', partyId: 'riv', tab: [L('a', 'Burrata', 2, 40), L('b', 'Steak frites', 3, 16), L('c', 'Grilled bream', 3, 16), L('d', 'Tart', 4, null)] });
  for (const [k, st] of [['k_a', 'delivered'], ['k_b', 'in_progress'], ['k_c', 'pending'], ['k_d', 'unfired']]) await db.doc(`${T}/kdsTickets/${k}`).set({ id: k, visitId: 'apt-party-riv', status: st });
  await db.doc(`${T}/parties/chen`).set({ id: 'chen', sessionId: 's1', status: 'waiting', name: 'Chen Wu', size: 2, joinedAt: ago(12), needs: [], unitIds: [], guestIds: [] });
  tenantForAuth = await get(T);
  const KR = await import('../../src/app/api/klair/route');
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'What’s left for table 4?' }));
  check('“What’s left for table 4?”: each course not out, the one running late, the tab so far', r.body.ok && r.body.kind === 'answer'
    && r.body.text === 'Table 4, Rivera, 4. Mains being made: Steak frites, Grilled bream, 6 min past their usual time. Dessert held: Tart. $80.00 so far, not paid.', r.body);
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'what’s left for table 9' }));
  check('…a table that isn’t seated says so', r.body.text === 'Table 9 isn’t seated right now.', r.body.text);
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'How long is the wait for 2?' }));
  check('“How long is the wait for 2?”: how many, a quote, who’s next', /^1 party waiting\. A party of 2 now: .+\. Next up: Chen, 2, waited 12 min\.$/.test(r.body.text), r.body.text);
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'is the kitchen behind?' }));
  check('“Is the kitchen behind?”', /^The kitchen is keeping up/.test(r.body.text) || /minutes behind/.test(r.body.text), r.body.text);
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'what’s 86’d' }));
  check('“What’s 86’d?”', r.body.kind === 'answer' && /sold out/i.test(r.body.text), r.body.text);
  actor = { ...actor, role: 'renter', isRenter: true, isManager: false };
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'What’s left for table 4?' }));
  check('a renter can’t ask about the business’s tables', r.body.text === 'Tables and tabs are the business’s own.', r.body.text);
  actor = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
  tenantForAuth = { ...(await get(T)), modules: { hospitality: false } };
  r = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'who’s waiting' }));
  const rq: any = await KR.POST(req({ tenantId: 't1', action: 'ask', text: 'send Maya a quote' }));
  check('where tables are off: a floor question says so, and nothing else is taken for one', r.body.text === 'Tables aren’t on for this business right now.' && rq.body.intent !== 'wait' && !/Tables aren’t on/.test(String(rq.body.text || '')), [r.body, rq.body]);
  tenantForAuth = await get(T);
  actor = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
  const pend = (await db.collection(`${T}/klairActions`).get()).docs.length;
  check('questions only: nothing waiting to be confirmed, nothing changed', pend === 0 && (await get(`${T}/appointments/apt-party-riv`)).tab.length === 4);

  console.log('the screens');
  const bill = src('src/app/bill/[tenantId]/[token]/page.tsx'); const order = src('src/app/order/[tenantId]/page.tsx'); const ask = src('src/components/klair/MenuAsk.tsx'); const set = src('src/app/(app)/settings/embeds/page.tsx');
  check('the table’s page and ordering ahead: “Ask Mae about the menu”', /pass\.klair && <VisitCard><MenuAsk/.test(bill) && /menu\.klair && <section/.test(order) && ask.includes('Ask {name} about the menu') && /TELL_SERVER/.test(ask));
  check('the setting: off until the business turns it on, saying how she answers', set.includes('Answer guests’ menu questions') && set.includes('Off until you turn it on.') && /'klair\.menuAnswers'/.test(set));
  const mine = src('src/lib/klair-menu.ts') + src('src/lib/klair-floor.ts') + src('src/lib/klair-menu-server.ts') + ask;
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
