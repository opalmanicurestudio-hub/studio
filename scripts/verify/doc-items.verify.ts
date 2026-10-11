// Checks lib/doc-items: checklist ticks and photo lines keep pointing at the same line after edits.
// Run: npx tsx scripts/verify/doc-items.verify.ts
import { withItemIds, itemKey, needsPhoto, liveKeys } from '../../src/lib/doc-items';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const v1 = withItemIds([{ id: 's1', type: 'checklist', body: 'Lights off\nAutoclave ran\nLog signed', photoLines: [1] }, { id: 's2', type: 'step', body: 'x' }]);
const k = (secs: any[], i: number) => itemKey(secs[0], i);
const autoclave = k(v1, 1);
ok(needsPhoto(v1[0], 1) && !needsPhoto(v1[0], 0), 'photo line by id');
ok(!('itemIds' in v1[1]), 'non-checklists get no ids');
// edit: a new line at the top, and the photo marker follows the line (editor index moves to 2)
const v2 = withItemIds([{ id: 's1', type: 'checklist', body: 'Wipe stations\nLights off\nAutoclave ran\nLog signed', photoLines: [2] }], v1);
ok(k(v2, 2) === autoclave, 'same line keeps its key after a line is added above');
ok(needsPhoto(v2[0], 2), 'photo requirement stays on the same line');
ok(new Set(v2[0].itemIds).size === 4, 'every line has its own id');
// reword one line → new id; duplicates get separate ids
const v3 = withItemIds([{ id: 's1', type: 'checklist', body: 'Wipe stations\nLights off\nAutoclave cycle ran\nLog signed\nLog signed' }], v2);
ok(k(v3, 2) !== autoclave, 'a reworded line is a new item');
ok(v3[0].itemIds[3] !== v3[0].itemIds[4], 'duplicate lines get separate ids');
ok(liveKeys(v3).length === 5 && !liveKeys(v3).includes(autoclave), 'removed lines don’t count');
// older checklists without ids still read by position
ok(itemKey({ id: 'old', type: 'checklist', body: 'a\nb' }, 1) === 'old:1' && needsPhoto({ id: 'old', body: 'a', photoLines: [0] }, 0), 'old checklists fall back to position');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
