// scripts/verify/item-builder.verify.tsx — BUILDING A MENU ITEM, STEP BY STEP (round 39, board "Food numbers": Menu
// builder). Five steps instead of one long form (the basics, sizes, choices and add-ons, what goes in it, where and
// when), each with a line on the left saying what's set; the choice sets switched on or off for the item; beside it all,
// what the guest sees (their own picker, priced the way the server prices it) and what one keeps as picked there.
// Leaving with changes asks first; a problem on save opens the step it's on. The rest of the team still gets the
// sold-out switches only.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/item-builder.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
let failures = 0; const check = (m: string, c: any, x?: any) => { if (!c) { failures++; console.error('  ✗', m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/upload-image') return { uploadImage: async () => 'https://img/x.jpg' };
  if (request === 'next/link') return { __esModule: true, default: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a> };
  return load.call(this, request, ...rest);
};
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

(async () => {
  const { ItemBuilder } = await import('../../src/components/menu/ItemBuilder');
  const FC = await import('../../src/lib/food-cost');
  const RE = await import('../../src/components/menu/RecipeEditor');
  const MC = await import('../../src/lib/menu-choices');

  const milk = { id: 'milk', name: 'Milk', kind: 'one' as const, required: true, max: 1, options: [{ id: 'w', name: 'Whole', price: 0, soldOut: false }, { id: 'o', name: 'Oat', price: 0.75, soldOut: false, changes: [{ kind: 'swap' as const, from: 'wm', fromName: 'Whole milk', to: 'oat', toName: 'Oat milk' }] }] };
  const syr = { id: 'syr', name: 'Syrups', kind: 'addons' as const, required: false, max: 3, options: [{ id: 'v', name: 'Vanilla', price: 0.75, soldOut: false }, { id: 'c', name: 'Caramel', price: 0.75, soldOut: false }] };
  const sizes = { id: 'sz', name: 'Sizes', kind: 'one' as const, required: true, max: 1, options: [{ id: 'sm', name: 'Small', price: 0, soldOut: false }, { id: 'lg', name: 'Large', price: 0.5, soldOut: false }] };
  const sets = [milk, syr, sizes];
  const linked = (s: any, gid: string) => ({ id: gid, setId: s.id, name: s.name, pick: s.kind === 'one' ? 'one' : 'any', required: s.required, max: s.max, options: s.options.map(({ changes: _c, ...o }: any) => o) });
  const item = (id: string, name: string, section: string, price: number, choices: any[], extra: any = {}): any => ({ id, name, section, price, from: false, startPrice: price, onMenu: true, membersOnly: false, inStock: true, soldOut: false, choices, words: 'Double espresso and steamed milk.',
    makeSeconds: 120, holdMinutes: 0, batchSize: 6, allergens: ['milk'], allergensSet: true, allergensLikely: [], recipeGaps: [], dayparts: [], station: null, course: null, alsoAt: [], imageUrl: null, featured: false, badge: null, calories: null, byRecipe: true, canMake: 40, short: null, ...extra });
  const size = { id: 'g0', name: 'Size', pick: 'one', required: true, max: 1, options: [{ id: 's12', name: '12 oz', price: 0, soldOut: false }, { id: 's16', name: '16 oz', price: 0.75, soldOut: false }] };
  const own = { id: 'g9', name: 'Temperature', pick: 'one', required: false, max: 1, options: [{ id: 't1', name: 'Extra hot', price: 0, soldOut: false }] };
  const latte = item('latte', 'Latte', 'Coffee', 4.5, [size, linked(milk, 'g1'), own]);
  const all = [latte, item('cap', 'Cappuccino', 'Coffee', 4.25, [linked(milk, 'g1')]), item('toast', 'Avocado toast', 'Food', 11, [linked(syr, 'g1')], { words: '' })];
  const noop = () => undefined;
  const render = (step: any, it: any = latte, more: any = {}) => renderToStaticMarkup(<ItemBuilder item={it} recipe={[]} changes={{}} tenantId="t1" service={null} dayparts={[]} allItems={all} sets={sets as any} aim={0.3} startStep={step} busy={null}
    onClose={noop} onSave={async () => null} onSoldOut={noop} onOpenSet={noop} call={async () => ({ ok: false })} {...more} />);

  console.log('the steps');
  const h1 = render(1); const t1 = text(h1);
  check('five steps, in order, each a button that says where it is', ['The basics', 'Sizes', 'Choices and add-ons', 'What goes in it', 'Where and when'].every((x, k, xs) => t1.indexOf(x) >= 0 && (k === 0 || t1.indexOf(x) > t1.indexOf(xs[k - 1])))
    && (h1.match(/aria-current="step"/g) || []).length === 2, t1.slice(0, 600));
  check('…each with a line saying what’s set: the basics, the sizes, the choices, the recipe, where and when', t1.includes('Latte, $4.50, Coffee. A line guests read.') && t1.includes('12 oz and 16 oz (+$0.75).') && t1.includes('Milk and temperature.')
    && t1.includes('Nothing yet. With it, stock and cost follow each one sold.') && t1.includes('Made where its section goes, 2 minutes, all day. Contains milk.'), t1.slice(0, 900));
  check('…the basics: name, section, price, what it is, on the menu and members only; next is the sizes', /Name<\/span><input [^>]*value="Latte"/.test(h1) && /Section<\/span><input [^>]*value="Coffee"/.test(h1) && /value="4.50"/.test(h1) && t1.includes('On the menu guests see') && t1.includes('Members only') && /Next<span[^>]*>: sizes/.test(h1));
  check('…only the basics are needed to sell it', t1.includes('Only the basics are needed to sell it. Every other step can wait, and each one says what it adds.'));

  const h2 = render(2); const t2 = text(h2);
  check('sizes: one size or in sizes, each size with what it adds (its own, or a sizes set)', /role="radio" aria-checked="false"[^>]*>One size/.test(h2) && /role="radio" aria-checked="true"[^>]*>In sizes/.test(h2) && /value="12 oz"/.test(h2) && /value="0.75"/.test(h2) && t2.includes('Add a size') && t2.includes('It starts on the first.'), t2.slice(0, 900));
  const plain = item('tea', 'Tea', 'Tea', 3, []); const h2b = text(render(2, plain));
  check('…an item in one size says so', /One size\./.test(h2b) && h2b.includes('One size In sizes'), h2b.slice(0, 400));

  const h3 = render(3); const t3 = text(h3);
  check('choices: each set switched on or off for it, with what it is and how many have it', /role="switch" aria-checked="true" aria-label="Milk on this drink"/.test(h3) && /role="switch" aria-checked="false" aria-label="Syrups on this drink"/.test(h3) && t3.includes('On 2 drinks') && t3.includes('On 1 item') && t3.includes('Whole, Oat +$0.75'), t3.slice(0, 1200));
  check('…a sizes set is offered in Sizes, not here; a choice only it has is its own', !/aria-label="Sizes on this drink"/.test(h3) && t3.includes('Only this drink has') && /value="Temperature"/.test(h3));
  check('…a new set, or a choice only this one has; and tonight’s sold-out switches folded away', t3.includes('New set') && t3.includes('A choice only this drink has') && /aria-expanded="false"[^>]*><span><span class="block text-\[16px\] font-semibold">Sold out tonight/.test(h3) && t3.includes('Nothing sold out'));
  const h4 = render(4); const t4 = text(h4); const h5 = render(5); const t5 = text(h5);
  check('what goes in it: the recipe, or a combo', t4.includes('The recipe') && t4.includes('A combo') && /Next<span[^>]*>: where and when/.test(h4));
  check('where and when: contains, where it’s made, when it’s sold, the menu board; the last step saves', t5.includes('Contains') && t5.includes('Where it’s made') && t5.includes('When it’s sold') && t5.includes('On the menu board') && !/>Next<span/.test(h5) && /Next<span/.test(h4) && t5.includes('Save and close'));

  console.log('what the guest sees');
  check('the guest’s own picker beside every step, starting where theirs starts, with the price to add it', ['The basics', 'Sizes', 'What goes in it'].length === 3 && [h1, h2, h3].every((h) => /type="radio"[^>]*name="[^"]+-g0" checked=""/.test(h) && text(h).includes('Add to order, $4.50')) && t1.includes('Double espresso and steamed milk. Contains milk.'), t1.slice(-900));
  const outNow = render(3, latte, {}); const later = renderToStaticMarkup(<ItemBuilder item={{ ...latte, choices: latte.choices.map((g: any) => (g.id !== 'g1' ? g : { ...g, options: g.options.map((o: any) => ({ ...o, soldOut: o.id === 'w' })) })) }} recipe={[]} changes={{}} tenantId="t1" service={null} dayparts={[]} allItems={all} sets={sets as any} aim={0.3} startStep={3} busy={null} onClose={noop} onSave={async () => null} onSoldOut={noop} onOpenSet={noop} call={async () => ({ ok: false })} />);
  check('…what’s sold out tonight is the item’s as it is now: the guest can’t pick it, and the milk starts on the next', /type="radio"[^>]*name="[^"]+-g1" checked=""/.test(outNow) && /-g1-w" type="radio"[^>]*disabled=""/.test(later) && /-g1-o" type="radio"[^>]*checked=""/.test(later) && /soldOut: liveOut\.get/.test(src('src/components/menu/ItemBuilder.tsx')), text(later).slice(-700));
  const off = text(render(1, { ...latte, onMenu: false }));
  check('…and says when guests can’t see it yet', off.includes('Not on the menu yet: guests don’t see it'));
  check('…what one keeps waits for the recipe (and the stock to cost it)', t1.includes('What you keep on this one') && t1.includes('Working out what it costs…'));

  // What one keeps, as the builder works it out: the recipe as typed, with the choices' changes, priced by the server's rules.
  const part = (unit: string, sz: number, cost: number) => ({ costingMethod: 'size', size: sz, unit, costPerUnit: cost });
  const stock: any[] = [{ id: 'beans', name: 'Espresso beans', unit: 'g', part: part('g', 1000, 22) }, { id: 'wm', name: 'Whole milk', unit: 'ml', part: part('ml', 3785, 4.5) }, { id: 'oat', name: 'Oat milk', unit: 'ml', part: part('ml', 1890, 4.99) }, { id: 'cup', name: 'Cup', unit: 'each', part: { costPerUnit: 0.12 } }];
  const parts = RE.partsOf(stock); const formula = RE.asRecipe([{ id: 'beans', name: 'Espresso beans', unit: 'g', q: '18', measure: 'g' }, { id: 'wm', name: 'Whole milk', unit: 'ml', q: '240', measure: 'ml' }, { id: 'cup', name: 'Cup', unit: 'each', q: '1', measure: 'each' }], parts);
  const draft = { id: 'latte', price: 4.5, formula, choices: [{ ...size, options: [size.options[0], { ...size.options[1], changes: [{ kind: 'add', id: 'wm', name: 'Whole milk', amount: 120, measure: 'ml' }] }] }, { ...linked(milk, 'g1'), options: [milk.options[0], milk.options[1]] }] };
  const plainCost = FC.costWith('latte', draft, parts, MC.defaultPicks(draft)); const bigOat = FC.costWith('latte', draft, parts, { g0: ['s16'], g1: ['o'] });
  const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  check('what one costs as picked: a 12 oz with whole milk, and a 16 oz with oat (more milk, and oat instead)', r2(plainCost) === 0.8 && r2(bigOat) === 1.47, [plainCost, bigOat]);
  const priced = MC.priceChoices(draft, { g0: ['s16'], g1: ['o'] });
  check('…and what it charges for it, as the server would', priced.ok && priced.extra === 1.5, priced);

  const two = item('fries', 'Fries', 'Food', 4, [{ id: 'q1', name: 'Size up your fries', pick: 'one', required: false, max: 1, options: [{ id: 'q1a', name: 'Large', price: 1, soldOut: false }] }, { id: 'q2', name: 'Size', pick: 'one', required: true, max: 1, options: [{ id: 'q2a', name: 'Small', price: 0, soldOut: false }, { id: 'q2b', name: 'Big', price: 1, soldOut: false }] }]);
  const f2 = text(render(2, two)), f3 = text(render(3, two));
  check('its sizes are the choice called Size (not one that only starts with the word), and every other choice stays in Choices', f2.includes('Small and Big (+$1.00).') && /value="Big"/.test(render(2, two)) && /value="Size up your fries"/.test(render(3, two)) && !/value="Size"/.test(render(3, two)) && f3.includes('Size up your fries.'), f2.slice(0, 500));

  console.log('the page');
  const b = src('src/components/menu/ItemBuilder.tsx'); const page = src('src/app/(app)/menu/page.tsx'); const panel = src('src/components/menu/ChoiceSetsPanel.tsx'); const ed = src('src/components/menu/ChoicesEditor.tsx');
  check('a manager builds the item step by step; the rest of the team gets the sold-out switches', /\? <ItemBuilder key=\{editing\.id\}/.test(page) && /: <SoldOutSheet item=\{editing\}/.test(page) && !/function EditSheet/.test(page));
  check('…an item just made opens on its sizes', /setFresh\(true\); setEditing\(d\.item\)/.test(page) && /startStep=\{fresh \? 2 : 1\}/.test(page));
  check('the guest’s view is the guests’ own picker, priced with the server’s rules; what one keeps is costed the same way', /<ChoicePicker item=\{draft\} picks=\{shown\} onChange=\{setPicks\} \/>/.test(b) && /priceChoices\(draft, shown\)/.test(b) && /costWith\(item\.id, draft, stockParts, shown\)/.test(b) && /optionCosts\(item\.id, draft, stockParts, baseCost\.cost\)/.test(b));
  check('leaving with changes asks first (and so does opening a set to change it for every item)', /if \(saving\) return; if \(dirty\) setLeaving\(\{ to: 'close' \}\); else onClose\(\);/.test(b) && /dirty \? setLeaving\(\{ to: 'set', id \}\) : onOpenSet\(id\)/.test(b) && b.includes('Leave without saving') && b.includes('Save, then open the set'));
  check('a problem on save opens the step it’s on', /return stop\(1, 'What does it cost\?/.test(b) && /return stop\(g\.id === sizeId \? 2 : 3,/.test(b) && /return stop\(4, `How much/.test(b) && /return stop\(5, 'How many in a batch\?/.test(b));
  check('a size or a choice can change the recipe from step 4 (one draft)', /recipe=\{formula\} stock=\{stock\} costs=\{optCosts\} recipeHint="Add what goes in it \(step 4\) first/.test(b) && /recipeHint=\{`Add what goes in it \(step 4\) first, then a size can use something instead\.`\}/.test(b));
  check('a set turned on brings its recipe changes for what the builder shows it costing; New set opens a new one', /\.\.\.\(o\.changes\?\.length \? \{ changes: o\.changes \} : \{\}\)/.test(ed) && /openId === 'new'/.test(panel) && /toSet\('new'\)/.test(b));
  check('in the app’s own words and look', !/uppercase|font-black|\{\/\*| · |call us|contact us|[\u{1F300}-\u{1FAFF}]/u.test(b + page + ed) && !/\b(salon|stylist|booth|chair)s?\b/i.test(b) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(b) && /bg-\[#fff\]/.test(b));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
