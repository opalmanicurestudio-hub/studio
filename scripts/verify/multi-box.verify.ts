// Checks orders shipped in several boxes: every box's label is recognised and ticked off, and the order counts as
// checked only once every box has been scanned.
// Run: npx tsx scripts/verify/multi-box.verify.ts
import { labelBoxes, boxForLabel, labelProgress, labelMatchesOrder } from '../../src/lib/totes';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const o: any = { trackingNumber: '9400111899223344556677', extraTrackingNumbers: ['9400111899223344556688', '1Z999AA10123456784'] };
ok(labelBoxes(o).length === 3, 'three boxes, three labels');
ok(boxForLabel('420100019400111899223344556688', o) === '9400111899223344556688', 'a scanned USPS label (with its ZIP prefix) is matched to its own box');
ok(boxForLabel('1Z999AA10123456784', o) === '1Z999AA10123456784' && labelMatchesOrder('1Z999AA10123456784', o), 'a UPS box label matches');
ok(boxForLabel('9999999999999999999999', o) === null, 'someone else’s label matches no box');
ok(JSON.stringify(labelProgress({ ...o, labelsChecked: ['9400111899223344556677'] })) === JSON.stringify({ checked: 1, total: 3 }), 'one of three checked');
ok(labelProgress({ ...o, labelsChecked: labelBoxes(o) }).checked === 3, 'all three checked');
ok(JSON.stringify(labelProgress({ trackingNumber: '9400111899223344556677', labelCheckedAt: '2026-10-01' })) === JSON.stringify({ checked: 1, total: 1 }), 'orders checked before boxes were counted still read as checked');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
