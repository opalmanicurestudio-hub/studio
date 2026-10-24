// Checks cost round 1: one rule for what a product costs each time it's used, everywhere.
//   - the rule: per use, per ml / g, or each; a product that can't be spread yet (no cost, or counted by uses or by
//     amount with no number set) has no cost per use, never the whole container's cost for each use;
//   - checkout never sets a product's shelf to zero because its size or uses aren't set;
//   - the restocking fund reads recipes as they're saved (`id`), counts what can be counted, and uses each product's
//     own markup, else the business's;
//   - service cost, the no-show fee, visit profit and pay impact all use the same rule;
//   - no screen keeps its own copy of the formula any more.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cost-per-use.verify.ts
import fs from 'fs';
import { execSync } from 'child_process';
import { makeDb, check, failures, strictTransactions } from './fake-db';

(async () => {
  const pc = await import('../../src/lib/product-cost');
  const gel = { id: 'g', costPerUnit: 40, costingMethod: 'uses', estimatedUses: 20, totalStock: 2, partialContainerUses: 5 };
  const polish = { id: 'p', costPerUnit: 30, costingMethod: 'size', size: 15, unit: 'ml', totalStock: 1, partialContainerSize: 6 };
  const file = { id: 'f', costPerUnit: 2, totalStock: 10 };
  const noUses = { id: 'n', costPerUnit: 40, costingMethod: 'uses' };
  const noCost = { id: 'z', costingMethod: 'uses', estimatedUses: 10 };

  check('per use: a $40 gel with 20 uses costs $2 a use', pc.unitCost(gel) === 2 && pc.unitLabel(gel) === 'uses');
  check('per amount: a $30, 15 ml polish costs $2 a ml', pc.unitCost(polish) === 2 && pc.unitLabel(polish) === 'ml');
  check('per item: a $2 file costs $2 each', pc.unitCost(file) === 2 && pc.unitLabel(file) === 'each');
  check('counted by uses with no number set: no cost per use (it used to be the whole $40 for each use)', pc.unitCost(noUses) === null && pc.costGap(noUses) === 'no number of uses' && pc.lineCost(noUses, 1) === null);
  check('no cost: no cost per use', pc.unitCost(noCost) === null);
  check('left to use counts the open container: 2 × 20 + 5 = 45 uses; 1 × 15 + 6 = 21 ml', pc.usesLeft(gel) === 45 && pc.usesLeft(polish) === 21 && pc.usesLeft(file) === 10 && pc.usesLeft(noUses) === null);
  check('the markup is the product’s own when it has one', pc.restockMarkupPct({ restockingMarkup: 25 }, { restocking: { markupPct: 40 } }) === 25);
  check('…else the business’s, else 40%', pc.restockMarkupPct({ restockingMarkup: 0 }, { restocking: { markupPct: 30 } }) === 30 && pc.restockMarkupPct({}, {}) === 40);
  check('a business that sets 0% means no markup (it used to become 40%)', pc.restockMarkupPct({}, { restocking: { markupPct: 0 } }) === 0 && pc.shopMarkupPct({ restocking: { markupPct: '' } }) === 40);
  check('recipes are read as saved (id), older ones by productId, and a line with no amount counts as one use',
    JSON.stringify(pc.recipeLines([{ id: 'g', quantityUsed: 2 }, { productId: 'p', quantityUsed: 0 }, { name: 'x' }])) === JSON.stringify([{ productId: 'g', qty: 2 }, { productId: 'p', qty: 1 }]));
  const rc = pc.recipeCost([{ id: 'g', quantityUsed: 2 }, { id: 'p', quantityUsed: 3 }, { id: 'n', quantityUsed: 1 }], [gel, polish, noUses]);
  check('a recipe’s cost adds what can be counted and names what can’t ($4 + $6, the gel with no uses left out)', rc.total === 10 && rc.gaps.length === 1 && rc.gaps[0].id === 'n', rc);

  // ── Everything that prices product use agrees ──
  const { computeServiceCost } = await import('../../src/lib/service-cost');
  const svc = { id: 's', price: 60, duration: 60, products: [{ id: 'g', quantityUsed: 2 }, { id: 'n', quantityUsed: 1 }] };
  check('service cost uses the rule (a gel with no uses set adds nothing, not $40)', computeServiceCost(svc, {}, null, [gel, polish, noUses], 0).materials === 4);
  const { costOf } = await import('../../src/lib/no-show-fee');
  check('the no-show fee uses the rule', Math.round(costOf([{ ...svc, price: 0 } as any], { tenant: { tmhr: 0.0001, employerTaxBurdenPct: 0 }, inventory: [gel, noUses], staff: null }) * 100) / 100 === 4);
  const { unitCost: visitUnitCost } = await import('../../src/lib/visit-cost');
  check('visit profit uses the rule (nothing for what can’t be counted)', visitUnitCost(gel) === 2 && visitUnitCost(noUses) === 0);

  // ── Checkout never wipes a shelf ──
  const { recordVisitUsage, expectedUsage } = await import('../../src/lib/usage');
  const db: any = strictTransactions(makeDb());
  await db.doc('tenants/t1/inventory/n').set({ ...noUses, name: 'Builder gel', totalStock: 6 });
  await db.doc('tenants/t1/inventory/g').set({ ...gel, name: 'Gel' });
  const lines = expectedUsage({ products: [{ id: 'n', quantityUsed: 1 }, { id: 'g', quantityUsed: 2 }] }, [], [noUses, gel]);
  const r: any = await recordVisitUsage(db, 't1', { id: 'v1', clientName: 'Sam' }, lines);
  const n6 = (await db.doc('tenants/t1/inventory/n').get()).data();
  check('a product counted by uses with no number set keeps its shelf at checkout (it used to be set to 0), and the visit says why',
    n6.totalStock === 6 && r.lines.find((l: any) => l.productId === 'n')?.notCounted === 'no number of uses', { n6, lines: r.lines });
  const g2 = (await db.doc('tenants/t1/inventory/g').get()).data();
  check('…while products that can be counted still come off (5 open uses − 2 = 3)', g2.partialContainerUses === 3 && g2.totalStock === 2, g2);
  check('a recipe line saved with no amount comes off as one use, as its cost counts it', expectedUsage({ products: [{ id: 'g' }] }, [], [gel])[0]?.expected === 1);

  // ── Changing the actual amount on a line that couldn't be taken off ──
  const { adjustVisitUsage, extraProductFor, moveStock } = await import('../../src/lib/usage');
  await db.doc('tenants/t1/inventory/n').set({ ...noUses, name: 'Builder gel', totalStock: 6, estimatedUses: 20, partialContainerUses: 10 });
  await adjustVisitUsage(db, 't1', 'v1', { n: 3 });
  const nAfter = (await db.doc('tenants/t1/inventory/n').get()).data(); const u1 = (await db.doc('tenants/t1/usage/v1').get()).data();
  check('an amount changed on a line that was never taken off counts from nothing (3 come off, not 1), and it’s counted from then on',
    nAfter.partialContainerUses === 7 && !u1.lines.find((l: any) => l.productId === 'n').notCounted && u1.lines.find((l: any) => l.productId === 'n').deducted === 3, { nAfter, lines: u1.lines });
  await db.doc('tenants/t1/inventory/x').set({ id: 'x', name: 'Polish', costPerUnit: 30, msrp: 30, costingMethod: 'size' });
  await db.doc('tenants/t1/usage/v2').set({ lines: [{ productId: 'x', name: 'Polish', unit: 'ml', expected: 2, actual: 12 }] });
  const ex = await extraProductFor(db, 't1', 'v2', { timingPolicy: { extraProduct: 'retail' } });
  check('extra product with no size set suggests nothing (it suggested $300 for 10 ml of a $30 bottle)', ex.items.length === 0 && ex.total === 0, ex);
  check('the shared stock move leaves a product with no uses set alone and says why', moveStock({ costingMethod: 'uses', costPerUnit: 10, totalStock: 4 }, 2).notCounted === 'no number of uses' && JSON.stringify(moveStock({ costingMethod: 'uses', costPerUnit: 10, totalStock: 4 }, 2).patch) === '{}');
  const handoff = fs.readFileSync('src/lib/visit-handoff.ts', 'utf8');
  check('the provider’s hand-off moves stock the same way as checkout (it took whole containers for products with no size or uses), and its entries are on the stock history',
    /const r = moveStock\(p, q\);/.test(handoff) && /if \(r\.notCounted\)/.test(handoff) && /type: 'used'/.test(handoff) && !/num\(p\.estimatedUses\) \|\| 1/.test(handoff));
  check('the hand-off adds up a product listed twice before moving its stock', /byProduct\.set\(id/.test(handoff) && /for \(const item of byProduct\.values\(\)\)/.test(handoff));
  const ledgerSrc = fs.readFileSync('src/lib/stock-ledger.ts', 'utf8');
  check('the stock history keeps fractions (0.4 ml stays 0.4)', /change: Math\.round\(m\.delta \* 1000\) \/ 1000/.test(ledgerSrc));
  const fundSrc = fs.readFileSync('src/lib/restocking-fund.ts', 'utf8');
  check('product used in a paid visit isn’t counted as used without a sale (the visit is read from refKind / refId)', /m\.refKind \|\| m\.ref\?\.kind/.test(fundSrc));
  const checkout = fs.readFileSync('src/app/api/checkout/complete/route.ts', 'utf8');
  check('a visit already taken off at hand-off still reports what couldn’t be', /r\?\.skipped === 'already recorded'/.test(checkout));
  check('checkout says which products weren’t taken off stock and how to fix it', /l\.notCounted\)\) warnings\.push/.test(checkout));

  // ── The restocking fund ──
  const { visitProductCostCents, fundItems } = await import('../../src/lib/restocking-fund');
  const db2: any = makeDb();
  await db2.doc('tenants/t1/inventory/g').set({ ...gel, name: 'Gel', type: 'professional', restockingMarkup: 50 });
  await db2.doc('tenants/t1/inventory/p').set({ ...polish, name: 'Polish', type: 'retail' });
  await db2.doc('tenants/t1/inventory/n').set({ ...noUses, name: 'Builder', type: 'professional' });
  await db2.doc('tenants/t1/services/s').set({ id: 's', name: 'Gel mani', products: [{ id: 'g', quantityUsed: 2 }, { id: 'p', quantityUsed: 1 }, { id: 'n', quantityUsed: 1 }] });
  const c = await visitProductCostCents(db2, 't1', 'v9', { products: [{ id: 'g', quantityUsed: 2 }, { id: 'p', quantityUsed: 1 }, { id: 'n', quantityUsed: 1 }] }, { restocking: { markupPct: 40 } });
  check('the fund reads recipes as they’re saved (it read productId and always came to $0)', c.cents === 600 && c.basis === 'recipe', c);
  check('…and sets aside each product’s own markup, else the business’s ($4 × 1.5 + $2 × 1.4)', c.setAsideCents === 880, c);
  const fi = await fundItems(db2, 't1');
  check('the fund covers retail products a recipe uses, and names the one it can’t count yet', fi.coveredIds.has('p') && fi.missingCost.some((m: any) => m.id === 'n'), fi.missingCost);

  // ── No screen keeps its own copy ──
  const copies = execSync(`grep -rnE "costingMethod === 'size' && \\w+\\.size\\)[^;]*/ ?\\w*\\.?size|/ ?\\(?\\w+\\.estimatedUses\\b" src --include=*.ts --include=*.tsx || true`).toString()
    .split('\n').filter(Boolean).filter((l) => !/src\/lib\/product-cost\.ts|inventory\/report\/page\.tsx|InventorySidebar\.tsx|EndCostPerUseTestDialog\.tsx/.test(l));
  check('no screen divides by size or uses itself any more (stock value on the report and the cost-per-use test aside)', copies.length === 0, copies.slice(0, 5));
  const menu = fs.readFileSync('src/app/(app)/services/page.tsx', 'utf8');
  check('the services menu board prices products by the rule (it read productId and never divided: always $0)', /recipeCost\(svc\.products/.test(menu) && !/pr\.productId/.test(menu));
  const floorSrc = fs.readFileSync('src/app/(app)/settings/page.tsx', 'utf8'); const cancelSrc = fs.readFileSync('src/components/planner/CancelAppointmentDialog.tsx', 'utf8'); const board = fs.readFileSync('src/components/services/ServiceMenuBoard.tsx', 'utf8');
  check('where a floor, a fee or a margin is set, the products it can’t include yet are named (not silently left at $0)', /floorGaps\.length > 0/.test(floorSrc) && /productGaps\?\.length/.test(cancelSrc) && /c\.incomplete\?\.length/.test(board));
  const card = fs.readFileSync('src/components/money/RestockingFundCard.tsx', 'utf8');
  check('the fund card shows the markup this month’s set-asides actually carried', /d\.blendedPct/.test(card));
  const page = fs.readFileSync('src/app/(app)/inventory/(detail)/product/[id]/page.tsx', 'utf8');
  check('the product page shows cost per use, what’s left to use, the markup the fund uses and the services that use it',
    /unitCost\(p\)/.test(page) && /usesLeft\(p\)/.test(page) && /restockMarkupPct\(p, selectedTenant\)/.test(page) && /Used in \{usedIn\.length\}/.test(page));
  check('running-cost items are counted, costed and editable like other stock', /const countable = kindOf !== 'equipment';/.test(page) && /\{ label: 'Edit details', run: \(\) => handleEditItem\(item\) \}/.test(fs.readFileSync('src/app/(app)/inventory/page.tsx', 'utf8')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
