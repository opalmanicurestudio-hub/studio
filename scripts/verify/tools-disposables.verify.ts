// Checks single tools and disposables on a service blueprint: tool care groups, disposables coming off stock, and cost.
// Run: npx tsx scripts/verify/tools-disposables.verify.ts
import { cleanBlueprintParts, toolCare, disposablesUsed } from '../../src/lib/blueprint';
import { actualVisitCost } from '../../src/lib/visit-cost';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const reqs: any[] = [
  { kind: 'tool', name: 'Cuticle nipper', qty: 1, mode: 'required', care: 'sterilise' },
  { kind: 'tool', name: 'Pusher', qty: 2, mode: 'required' },
  { kind: 'tool', name: 'Spare buffer', qty: 1, mode: 'optional', care: 'soak' },
  { kind: 'disposable', name: 'Nail file', qty: 1, mode: 'required', inventoryItemId: 'file' },
  { kind: 'disposable', name: 'Toe separators', qty: 2, mode: 'required' },
];
const clean = cleanBlueprintParts([], reqs as any).requirements as any[];
ok(clean[1].care === 'wipe', 'a tool with no care set is wiped down');
ok(clean[0].care === 'sterilise' && clean[3].inventoryItemId === 'file', 'care and stock link are kept when saved');
ok(!('care' in clean[3]) && !('inventoryItemId' in clean[0]), 'care belongs to tools, stock links to disposables');
const svc = { id: 's', price: 50, blueprint: { requirements: clean } }; const addOn = { blueprint: { requirements: [{ kind: 'disposable', name: 'Nail file', qty: 1, mode: 'required', inventoryItemId: 'file' }] } };
const care = toolCare([svc]);
ok(care.map((g) => g.care).join() === 'wipe,sterilise', 'tool care grouped wipe → soak → sterilise, optional tools left out');
ok(care[0].tools[0].qty === 2, 'quantities carried through');
const d = disposablesUsed([svc, addOn]);
ok(d.find((x) => x.inventoryItemId === 'file')?.qty === 2, 'the same disposable on the service and an add-on adds up');
ok(d.some((x) => x.name === 'Toe separators' && x.inventoryItemId === null), 'unlinked disposables are listed but not linked');
const inv = [{ id: 'file', name: 'Nail file', costPerUnit: 0.5, totalStock: 100 }];
const c = actualVisitCost({ visit: { price: 50 }, service: svc, addOns: [addOn], inventory: inv });
ok(Math.abs(c.materials - 1) < 0.001, 'two files at $0.50 cost the visit $1 of materials');
const c2 = actualVisitCost({ visit: { price: 50 }, service: svc, inventory: inv, usage: { lines: [{ productId: 'file', expected: 1 }] } });
ok(Math.abs(c2.materials - 0.5) < 0.001, 'recorded usage isn’t counted twice');
console.log(bad ? `\n${bad} failed` : '\nAll passed'); process.exit(bad ? 1 : 0);
