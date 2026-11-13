// Checks THE WEIGHT CHECK AT PACKING (lib/weight-check, components/orders/ShipSheet):
//   - what a box's items weigh comes from each product's saved weight, and is only checked when every item has one;
//   - a box off by more than 2 oz, or a tenth of what it should weigh, is held: its label can't be bought until someone
//     opens it and says it's right, and that goes on the order's history;
//   - a shop can ask for every box to be weighed before its label (Setup).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/weight-check.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const W = await import('../../src/lib/weight-check');
  const inv = [{ id: 'gel', weightOz: 2 }, { id: 'oil', weightOz: 5 }, { id: 'tips' }];
  const lines = [{ productId: 'gel', name: 'Gel', qtyOrdered: 3, qtyShorted: 1 }, { productId: 'oil', name: 'Oil', qtyOrdered: 1 }, { productId: 'guide', name: 'Guide', qtyOrdered: 1, digital: true }];
  const w = W.itemsWeight(lines, inv);
  check('the items’ weight comes from each product’s saved weight (shorted units and downloads left out)', w.oz === 9 && w.known && w.missing.length === 0, w);
  const w2 = W.itemsWeight([...lines, { productId: 'tips', name: 'Nail tips', qtyOrdered: 1 }], inv);
  check('…and isn’t checked when an item has no weight saved, naming it', !w2.known && JSON.stringify(w2.missing) === JSON.stringify(['Nail tips']), w2);
  const w3 = W.itemsWeight([{ productId: 'gel', name: 'Gel', qtyOrdered: 1 }, { productId: 'oil', name: 'Oil', qtyOrdered: 1, status: 'backordered' }, { productId: 'tips', name: 'Nail tips', qtyOrdered: 1, status: 'refunded' }], inv);
  check('items sent later or refunded aren’t in the box', w3.oz === 2 && w3.known, w3);
  const w4 = W.itemsWeight([{ productId: 'red', name: 'Polish, Red', qtyOrdered: 2 }], [{ id: 'kit', weightOz: 3 }, { id: 'red', parentId: 'kit' }]);
  check('a color with no weight of its own weighs what its listing does', w4.oz === 6 && w4.known, w4);
  check('a box may be 2 oz off, or a tenth of what it should weigh when that’s more', W.weightTolerance(10) === 2 && W.weightTolerance(64) === 6 && W.weightTolerance(0) === 2);
  check('within that, it’s right; past it, how much heavy or light', W.weightOff(12, 11) === null && W.weightOff(14, 11) === 3 && W.weightOff(5, 11) === -6 && W.weightOff(70, 64) === null && W.weightOff(72, 64) === 8);
  check('nothing weighed, nothing to check', W.weightOff(0, 11) === null && W.weightOff(11, 0) === null);
  check('weights in words', W.ozWords(12) === '12 oz' && W.ozWords(16) === '1 lb' && W.ozWords(18) === '1 lb 2 oz');
  check('every box weighed only when the shop asks', !W.weighEveryBox({}) && W.weighEveryBox({ weighEveryBox: true }));

  const sheet = src('src/components/orders/ShipSheet.tsx');
  check('a box that’s off holds its label until someone opens it and says it’s right', /const weightHold = offBy !== null && lookedAt !== weightKey;/.test(sheet) && /disabled=\{loading \|\| !chosen \|\| !!asked \|\| mustWeigh \|\| weightHold\} onClick=\{\(\) => void buy\(\)\}/.test(sheet) && /I opened it: it’s right/.test(sheet));
  check('…checked only when every box was weighed and every item’s weight is known; changing a weight asks again', /const offBy = realItems\.known && weighedAll \? weightOff\(weighedOz, expectOz\) : null;/.test(sheet) && /const weightKey = JSON\.stringify\(boxes\.map\(\(b\) => \[b\.oz, b\.presetId\]\)\);/.test(sheet));
  check('…and the look goes on the order’s history', /addDoc\(collection\(fs, `tenants\/\$\{tenantId\}\/retailOrders\/\$\{order\.id\}\/events`\), \{ type: 'note'/.test(sheet) && /opened and checked by \$\{actor\.name\}/.test(sheet));
  check('a new label for one box starts from an estimate, which isn’t a weighing', /typed: true, est: true \}\]\)\);/.test(sheet) && /b\.typed && !b\.fromOld && !b\.est/.test(sheet));
  check('a shop that weighs every box buys each label on its order, not in a batch', /if \(rs\?\.weighEveryBox === true\) return 'Weigh the box first: buy its label on the order';/.test(src('src/app/api/retail/shipping-labels-bulk/route.ts')));
  check('Setup: weigh every box', /'retailSettings\.weighEveryBox': !weigh/.test(src('src/components/orders/SetupScreen.tsx')));
  const text = src('src/lib/weight-check.ts');
  check('the weight rules have the real apostrophe', !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
