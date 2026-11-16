// Checks choice sets (round 38, design canvas "Food numbers": Choice sets):
// - lib/choice-sets: a set as typed (three kinds: pick one, add-ons, leave out), its words, a set as one of an item's
//   choices, the same choice on two items told apart from a different one
// - lib/choice-sets-server through api/menu: a set made, put on items (a whole section, or picked), changed once and
//   changed on every item with it; recipe changes kept on each item only where they fit its recipe; sold out once, on
//   every item; one item taken off it or keeping it as its own; a set stopped (items keep their copy); a choice the same
//   on several items offered as a set and made one in a tap; an item saved with a set's choice takes the set's own
//   options whatever the form sent; managers only, sold out anyone on the team
// - the Menu page: Items, Choice sets and Settings; an item's editor turns sets on and opens one; the rules
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/choice-sets.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const grp = (x: any, setId: string) => (x?.choices || []).find((g: any) => g.setId === setId);

(async () => {
  const CS = await import('../../src/lib/choice-sets');
  let n = 0; const nid = () => `x${n++}`;
  console.log('a set as typed');
  check('a name and at least one named option', 'error' in CS.cleanSet({ name: '', options: [{ name: 'Oat' }] }, nid) && 'error' in CS.cleanSet({ name: 'Milk', options: [{ name: ' ' }] }, nid));
  const milkIn: any = CS.cleanSet({ name: 'Milk', kind: 'one', options: [{ id: 'whole', name: 'Whole', price: '0' }, { id: 'oat', name: 'Oat', price: '0.75' }, { name: 'Almond', price: 0.75 }] }, nid);
  check('pick one: must pick one unless said, one at a time, ids kept and made', milkIn.kind === 'one' && milkIn.required === true && milkIn.max === 1 && milkIn.options[0].id === 'whole' && milkIn.options[2].id === 'x0' && milkIn.options[1].price === 0.75, milkIn);
  const syr: any = CS.cleanSet({ name: 'Syrups', kind: 'addons', max: 9, options: [{ name: 'Vanilla', price: 0.75 }, { name: 'Caramel', price: 0.75 }] }, nid);
  const lo: any = CS.cleanSet({ name: 'Leave out', kind: 'leaveout', options: [{ name: 'No onions', price: 2 }, { name: 'No cheese' }] }, nid);
  check('add-ons: up to as many as there are, never required; leave out: always free, any of them', syr.max === 2 && syr.required === false && lo.options.every((o: any) => o.price === 0) && lo.max === 2);
  check('a price that isn’t one is said', 'error' in CS.cleanSet({ name: 'Milk', options: [{ name: 'Oat', price: 'lots' }] }, nid));
  check('in words: the rule and the options with their prices', CS.setRule(milkIn) === 'Pick one' && CS.setRule(syr) === 'Add-ons' && CS.setRule({ ...syr, max: 1 }) === 'Add-ons, up to 1' && CS.setRule(lo) === 'Leave out, free' && CS.optionsLine(milkIn) === 'Whole, Oat +$0.75, Almond +$0.75');
  const g: any = CS.groupOfSet({ id: 'milkset', ...milkIn }, 'g1');
  check('as one of an item’s choices: the item’s own id, the set’s id, its options and how they’re picked', g.id === 'g1' && g.setId === 'milkset' && g.pick === 'one' && g.required && g.options.length === 3 && g.options[1].id === 'oat');
  check('the same choice on two items is told apart from a different one (a price, an option, the name)', CS.groupKey({ name: 'Milk', pick: 'one', required: true, options: [{ name: 'Whole', price: 0 }, { name: 'Oat', price: 0.75 }] }) === CS.groupKey({ name: 'milk ', pick: 'one', options: [{ name: 'whole', price: 0 }, { name: 'OAT', price: 0.75 }] })
    && CS.groupKey({ name: 'Milk', pick: 'one', options: [{ name: 'Oat', price: 0.75 }] }) !== CS.groupKey({ name: 'Milk', pick: 'one', options: [{ name: 'Oat', price: 0.85 }] }));
  check('a free “No onions” choice reads as leave out; extras as add-ons', CS.kindOfGroup({ name: 'Leave out', pick: 'any', options: [{ price: 0 }] }) === 'leaveout' && CS.kindOfGroup({ name: 'Extras', pick: 'any', options: [{ price: 1 }] }) === 'addons' && CS.kindOfGroup({ name: 'Size', pick: 'one', options: [] }) === 'one');

  console.log('sets on the menu');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', modules: { hospitality: true } });
  const ing = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, status: 'active', isActive: true, type: 'professional', countStock: true, ...x });
  await ing('milk', { name: 'Whole milk', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4.6, totalStock: 4 });
  await ing('oatmilk', { name: 'Oat milk', costingMethod: 'size', size: 946, unit: 'ml', costPerUnit: 4.03, totalStock: 3 });
  await ing('vanilla', { name: 'Vanilla syrup', costingMethod: 'size', size: 750, unit: 'ml', costPerUnit: 9, totalStock: 2 });
  await ing('beans', { name: 'Espresso beans', costingMethod: 'size', size: 2268, unit: 'g', costPerUnit: 65, totalStock: 2 });
  const item = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ id, type: 'refreshment', status: 'active', isActive: true, showInConcierge: true, price: 4.5, ...x });
  const ownMilk = (gid: string) => ({ id: gid, name: 'Milk', pick: 'one', required: true, max: 1, options: [{ id: `${gid}w`, name: 'Whole', price: 0 }, { id: `${gid}o`, name: 'Oat', price: 0.75, changes: [{ kind: 'swap', from: 'milk', fromName: 'Whole milk', to: 'oatmilk', toName: 'Oat milk' }] }] });
  await item('latte', { name: 'Latte', category: 'Coffee', formula: [{ id: 'beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', quantityUsed: 240, unit: 'ml' }], choices: [ownMilk('lm')] });
  await item('cap', { name: 'Cappuccino', category: 'Coffee', formula: [{ id: 'beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', quantityUsed: 150, unit: 'ml' }], choices: [ownMilk('cm')] });
  await item('americano', { name: 'Americano', category: 'Coffee', formula: [{ id: 'beans', quantityUsed: 18, unit: 'g' }], choices: [] });
  await item('chai', { name: 'Chai', category: 'Tea', choices: [{ id: 'chm', name: 'Milk', pick: 'one', required: true, max: 1, options: [{ id: 'a', name: 'Whole', price: 0 }, { id: 'b', name: 'Oat', price: 0.85 }] }] });
  await item('toast', { name: 'Avocado toast', category: 'Food', choices: [] });
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const Mn = async (b: any) => { const r: any = await menuApi(req({ tenantId: 't1', ...b })); return { status: r.status, ...r.body }; };

  let r = await Mn({ action: 'sets' });
  check('Milk is on two coffees the same way: offered as a set (the chai’s oat costs more, so it isn’t the same)', r.ok && r.sets.length === 0 && r.suggestions.length === 1 && r.suggestions[0].name === 'Milk' && r.suggestions[0].count === 2 && r.suggestions[0].rule === 'Pick one' && r.items.length === 5, r.suggestions);
  await Mn({ action: 'soldout', itemId: 'cap', groupId: 'cm', optionId: 'cmo', out: true });
  r = await Mn({ action: 'setFrom', itemId: 'latte', groupId: 'lm' });
  const milkId = r.set?.id; let lat: any = await get(`${T}/inventory/latte`); let cap: any = await get(`${T}/inventory/cap`);
  check('made a set in a tap: both coffees now carry it, each keeping its own choice id, the set’s options and the oat swap', r.ok && r.items === 2 && grp(lat, milkId)?.id === 'lm' && grp(cap, milkId)?.id === 'cm' && grp(cap, milkId).options[1].changes?.[0]?.to === 'oatmilk' && !grp(await get(`${T}/inventory/chai`), milkId), [lat.choices, cap.choices]);
  check('…each option keeps the id it had on each coffee (so orders open now and past sales still read the same), saying which of the set’s it is', grp(lat, milkId).options[1].id === 'lmo' && !grp(lat, milkId).options[1].setOption && grp(cap, milkId).options[1].id === 'cmo' && grp(cap, milkId).options[1].setOption === 'lmo' && grp(cap, milkId).options[0].id === 'cmw', grp(cap, milkId));
  const MC = await import('../../src/lib/menu-choices');
  check('…oat was sold out on the cappuccino when the latte’s milk became a set: sold out on the set and both coffees, never brought back', (await get(`${T}/choiceSets/${milkId}`)).options[1].soldOut === true && grp(cap, milkId).options[1].soldOut === true);
  check('…each item says which sets it has, so they’re found at once', JSON.stringify(lat.choiceSetIds) === JSON.stringify([milkId]) && JSON.stringify(cap.choiceSetIds) === JSON.stringify([milkId]));
  check('…a guest’s menu doesn’t carry which set a choice comes from', !('setId' in MC.choiceGroups(cap)[0]) && !('setOption' in MC.choiceGroups(cap)[0].options[1]) && MC.choiceGroups(cap, true)[0].setId === milkId);
  await Mn({ action: 'setSoldOut', setId: milkId, optionId: 'lmo', out: false });
  const priced: any = MC.priceChoices(await get(`${T}/inventory/cap`), { cm: ['cmo'] });
  check('…an oat cappuccino picked before it was a set is still priced (and costed) as oat', priced.ok && priced.extra === 0.75 && priced.lines[0].optionId === 'cmo', priced);
  r = await Mn({ action: 'setSave', set: { id: milkId, name: 'Milk', kind: 'one', options: [{ id: 'lmw', name: 'Whole', price: 0 }, { id: 'lmo', name: 'Oat', price: 0.85, changes: [{ kind: 'swap', from: 'milk', fromName: 'Whole milk', to: 'oatmilk', toName: 'Oat milk' }] }, { name: 'Almond', price: 0.85 }] } });
  lat = await get(`${T}/inventory/latte`); cap = await get(`${T}/inventory/cap`);
  check('oat milk’s price changed once: changed on both coffees, the new option on both', r.ok && r.items === 2 && grp(lat, milkId).options[1].price === 0.85 && grp(cap, milkId).options[1].price === 0.85 && grp(cap, milkId).options.length === 3, grp(cap, milkId));
  r = await Mn({ action: 'setApply', setId: milkId, itemIds: ['americano', 'chai', 'latte'] });
  const am: any = await get(`${T}/inventory/americano`); const ch: any = await get(`${T}/inventory/chai`);
  check('put on more items: the americano gets it at the end; the oat swap does nothing there (no milk in it), so it isn’t kept', r.ok && r.added === 2 && grp(am, milkId) && !grp(am, milkId).options[1].changes && grp(ch, milkId) && ch.choices.length === 2, [am.choices, r]);
  r = await Mn({ action: 'setSoldOut', setId: milkId, optionId: 'lmo', out: true });
  check('oat sold out once: sold out on all four, back in the morning', r.ok && r.items === 4 && grp(await get(`${T}/inventory/cap`), milkId).options[1].soldOut === true && !!grp(await get(`${T}/inventory/americano`), milkId).options[1].soldOutUntil && (await get(`${T}/choiceSets/${milkId}`)).options[1].soldOut === true);
  r = await Mn({ action: 'soldout', itemId: 'latte', groupId: 'lm', optionId: 'lmo', out: false });
  check('…back from one item’s sold-out switch (the kitchen’s), back on every item with the set', r.ok && grp(await get(`${T}/inventory/cap`), milkId).options[1].soldOut === false && (await get(`${T}/choiceSets/${milkId}`)).options[1].soldOut === false);
  r = await Mn({ action: 'soldout', itemId: 'cap', groupId: 'cm', optionId: 'cmo', out: true });
  check('…the kitchen’s switch on the cappuccino (its own id for oat) sells oat out on the set and every item with it', r.ok && (await get(`${T}/choiceSets/${milkId}`)).options[1].soldOut === true && grp(await get(`${T}/inventory/latte`), milkId).options[1].soldOut === true && grp(await get(`${T}/inventory/americano`), milkId).options[1].soldOut === true);
  await Mn({ action: 'soldout', itemId: 'cap', groupId: 'cm', optionId: 'cmo', out: false });
  r = await Mn({ action: 'setSave', set: { id: milkId, name: 'Milk', kind: 'one', options: [{ id: 'lmw', name: 'Whole', price: 0 }, { id: 'lmo', name: 'Oat', price: 0.85 }, { name: 'Almond', price: 0.85 }] } });
  r = await Mn({ action: 'setSoldOut', setId: milkId, optionId: 'lmw', out: true });
  await Mn({ action: 'setSave', set: { id: milkId, name: 'Milk', kind: 'one', options: [{ id: 'lmw', name: 'Whole', price: 0 }, { id: 'lmo', name: 'Oat', price: 0.9 }] } });
  check('a set saved keeps what the kitchen has sold out', (await get(`${T}/choiceSets/${milkId}`)).options[0].soldOut === true && grp(await get(`${T}/inventory/latte`), milkId).options[0].soldOut === true);
  await Mn({ action: 'setSoldOut', setId: milkId, optionId: 'lmw', out: false });

  console.log('an item saved with a set’s choice');
  const latNow: any = await get(`${T}/inventory/latte`);
  r = await Mn({ action: 'save', itemId: 'latte', item: { name: 'Latte', section: 'Coffee', price: 4.5, choices: [{ ...grp(latNow, milkId), options: [{ id: 'lmw', name: 'Whole', price: 0 }, { id: 'lmo', name: 'Oat', price: 0.01 }, { id: 'zzz', name: 'Free gold', price: -4 }] }] } });
  lat = await get(`${T}/inventory/latte`);
  check('the set’s own options and prices, whatever the form sent', r.ok && grp(lat, milkId).options.length === 2 && grp(lat, milkId).options[1].price === 0.9 && !JSON.stringify(lat.choices).includes('Free gold'), grp(lat, milkId));
  const capNow: any = await get(`${T}/inventory/cap`);
  r = await Mn({ action: 'save', itemId: 'cap', item: { name: 'Cappuccino', section: 'Coffee', price: 4.25, choices: [{ ...grp(capNow, milkId), options: [{ id: 'q1', name: 'Whole', price: 0 }] }] } });
  cap = await get(`${T}/inventory/cap`);
  check('…and the cappuccino saved keeps its own ids for the set’s options', r.ok && grp(cap, milkId).options[1].id === 'cmo' && grp(cap, milkId).options[1].setOption === 'lmo' && grp(cap, milkId).options.length === 2 && JSON.stringify(cap.choiceSetIds) === JSON.stringify([milkId]), grp(cap, milkId));
  r = await Mn({ action: 'save', itemId: 'latte', item: { name: 'Latte', section: 'Coffee', price: 4.5, choices: [{ id: 'lm', name: 'Milk', pick: 'one', required: true, options: [{ id: 'lmw', name: 'Whole', price: 0 }, { id: 'lmo', name: 'Oat', price: 0.5 }] }] } });
  lat = await get(`${T}/inventory/latte`);
  check('made its own (no set): changed on the latte alone', r.ok && !lat.choices[0].setId && lat.choices[0].options[1].price === 0.5 && grp(await get(`${T}/inventory/cap`), milkId).options[1].price === 0.9);
  r = await Mn({ action: 'sets' });
  const ms = r.sets.find((x: any) => x.id === milkId);
  check('the set lists the items it’s on (three now)', ms.on.length === 3 && ms.on.every((i: any) => i.id !== 'latte') && ms.rule === 'Pick one' && /Oat \+\$0\.90/.test(ms.line), ms);
  r = await Mn({ action: 'setOff', setId: milkId, itemId: 'chai' });
  check('taken off the chai', r.ok && !(await get(`${T}/inventory/chai`)).choices.some((g: any) => g.setId === milkId) && (await get(`${T}/inventory/chai`)).choices.length === 1);
  r = await Mn({ action: 'setOff', setId: milkId, itemId: 'cap', keep: true });
  const capOwn: any = (await get(`${T}/inventory/cap`)).choices[0];
  check('…the cappuccino keeps it as its own, with its own ids', r.ok && !capOwn.setId && capOwn.name === 'Milk' && capOwn.options.length === 2 && capOwn.options[1].id === 'cmo' && !('setOption' in capOwn.options[1]) && (await get(`${T}/inventory/cap`)).choiceSetIds.length === 0);
  const syrSet = (await Mn({ action: 'setSave', set: { name: 'Syrups', kind: 'addons', max: 2, options: [{ name: 'Vanilla', price: 0.75, changes: [{ kind: 'add', id: 'vanilla', name: 'Vanilla syrup', amount: 15, measure: 'ml' }] }] } })).set;
  r = await Mn({ action: 'setApply', setId: syrSet.id, itemIds: ['latte', 'cap', 'americano', 'toast'] });
  check('syrups on four: what it adds is kept on each (vanilla is in stock)', r.ok && r.added === 4 && grp(await get(`${T}/inventory/americano`), syrSet.id).options[0].changes?.[0]?.id === 'vanilla');
  r = await Mn({ action: 'setRemove', setId: milkId });
  check('Milk stopped as a set: the americano keeps it as its own, the set is gone', r.ok && r.items === 1 && !(await get(`${T}/choiceSets/${milkId}`)) && (await get(`${T}/inventory/americano`)).choices.some((g: any) => g.name === 'Milk' && !g.setId));
  check('bad input is said', (await Mn({ action: 'setSave', set: { name: '' } })).status === 400 && (await Mn({ action: 'setApply', setId: 'nope', itemIds: ['latte'] })).status === 404 && (await Mn({ action: 'setFrom', itemId: 'latte', groupId: 'nope' })).status === 404);
  manager = false;
  check('sets are a manager’s; sold out, anyone on the team', (await Mn({ action: 'sets' })).status === 403 && (await Mn({ action: 'setSave', set: { name: 'X', options: [{ name: 'Y' }] } })).status === 403
    && (await Mn({ action: 'setSoldOut', setId: syrSet.id, optionId: syrSet.options[0].id, out: true })).ok === true);
  manager = true;
  r = await Mn({ action: 'list' });
  check('the Menu list carries the sets for an item’s editor, with each item’s choice still linked', r.ok && r.sets.some((x: any) => x.id === syrSet.id && x.options.length === 1) && r.menu.find((m: any) => m.id === 'toast').choices.some((g: any) => g.setId === syrSet.id));

  const sv = src('src/lib/choice-sets-server.ts');
  check('a set saved reads and writes in one step, and each item takes what’s sold out from the set in the same step as its own write', /const s: ChoiceSet = await db\.runTransaction/.test(sv) && /tx\.get\(ref\), tx\.get\(sref\)/.test(sv) && /createdAt: cur\?\.createdAt \|\| at/.test(sv));
  check('a sold-out tap finds the items with the set at once (not the whole menu)', /where\('choiceSetIds', 'array-contains', setId\)/.test(sv) && /for \(const \[id\] of await itemsWith\(db, tenantId, setId\)\)/.test(sv));

  console.log('the screens');
  const page = (src('src/app/(app)/menu/page.tsx') + src('src/components/menu/ItemBuilder.tsx')); const panel = src('src/components/menu/ChoiceSetsPanel.tsx'); const ed = src('src/components/menu/ChoicesEditor.tsx');
  check('the Menu page: Items first, then Choice sets and Settings; a link to a setting opens Settings', /\['items', 'Items'\], \['sets', 'Choice sets'\], \['settings', 'Settings'\]/.test(page) && /role="tablist"/.test(page) && /SETTINGS_IDS = \['order-ahead', 'menu-times', 'table-service', 'service-times', 'prep-recipes'\]/.test(page) && /<ChoiceSetsPanel call=\{call\}/.test(page));
  check('…an item’s builder turns a set on or off, changes it for every item, or makes it the item’s own', /onToggle=\{\(\) => setGroups\(\(gs\) => \[\.\.\.gs, groupFromSet\(s\)\]\)\}/.test(page) && /Change \{g\.name\} for every item/.test(page) && /Only for this \{noun\}/.test(page) && /onOpenSet=\{\(id\) => \{ setEditing\(null\); setFresh\(false\); setTab\('sets'\); setOpenSet\(id\); \}\}/.test(page) && /export const groupFromSet/.test(ed));
  check('…the sets: offered from choices already the same, three kinds, put on a section or picked items, sold out once', /Make \$\{x\.name\} a set/.test(panel) && /SET_KINDS\.map/.test(panel) && /Add to every item in it/.test(panel) && /Pick items/.test(panel) && /Mark sold out/.test(panel) && /Stop using it as a set/.test(panel));
  check('…in the app’s own words and look', !/uppercase|font-black|\{\/\*| · /.test(panel + ed + page) && !/\b(salon|stylist|booth|chair)s?\b/i.test(panel) && /min-h-\[44px\]/.test(panel) && /bg-\[#fff\]/.test(panel));
  const rules = src('firestore.rules'); const closed = rules.slice(rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}'), rules.indexOf('match /tenants/{tenantId}/jobListings'));
  check('the database: choice sets only through the server', closed.includes(`'choiceSets'`));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
