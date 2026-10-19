// Checks bins (walk order, matching), label formats, and scanner burst detection.
// Run: npx tsx scripts/verify/warehouse-tools.verify.ts
import { binMatches, binOf, compareBins, normalizeBin, overflowOf } from '../../src/lib/bins';
import { isPngLabel, isZplLabel, labelFormatOf, shippoFileType } from '../../src/lib/label-format';
import { isWedgeBurst } from '../../src/lib/use-wedge-scanner';
import { labelMatchesOrder, looksLikeTracking, needsTote, orderForLabel, parseTote, toteBusy, toteCode } from '../../src/lib/totes';
import { slipAfterLabel, withOrderRef } from '../../src/lib/label-format';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

const bins = ['B-01-4', '', 'A-10-1', 'A-2-1', 'a-02-3', 'A-01-2'];
ok(JSON.stringify([...bins].sort(compareBins)) === JSON.stringify(['A-01-2', 'A-2-1', 'a-02-3', 'A-10-1', 'B-01-4', '']), 'bins walk in aisle order, numbers as numbers, blanks last');
ok(binOf({ shelf: 'C2' }) === 'C2' && binOf({ storageLocation: ' A1 ', shelf: 'C2' }) === 'A1', 'older shelf field still counts; the bin wins');
ok(overflowOf({ overflowLocation: ' Back room ' }) === 'Back room', 'overflow trimmed');
ok(normalizeBin(' a-02  3 ') === 'A-02 3', 'bin typed in lower case is stored upper case');
ok(binMatches('A-02-3', 'a 02 3') && !binMatches('A-02-3', 'A-02-4') && !binMatches('', ''), 'a scanned shelf label matches its bin, never an empty one');

ok(labelFormatOf({}) === 'thermal' && labelFormatOf({ labelFormat: 'paper' }) === 'paper' && labelFormatOf({ labelFormat: 'nope' }) === 'thermal', 'label format defaults to the 4x6 printer');
ok(shippoFileType('thermal') === 'PDF_4x6' && shippoFileType('paper') === 'PDF' && shippoFileType('zpl') === 'ZPLII', 'single labels: 4x6 PDF, letter PDF, raw code');
ok(shippoFileType('thermal', { stack: true }) === 'PNG_4x6' && shippoFileType('paper', { stack: true }) === 'PNG_4x6' && shippoFileType('zpl', { stack: true }) === 'ZPLII', 'the stack buys images so labels lay out as pages, except raw code');
ok(isZplLabel('https://x/label.zpl') && !isZplLabel('https://x/l.pdf') && isPngLabel('https://x/l.png?a=1'), 'label file kinds told apart');

ok(isWedgeBurst(12, 0, 12 * 10), 'a 12-character burst at 10 ms per key is a scanner');
ok(!isWedgeBurst(12, 0, 12 * 120), 'typing at 120 ms per key is a person');
ok(!isWedgeBurst(2, 0, 5), 'two characters is not a scan');

ok(toteCode(3) === 'TOTE-03' && parseTote('TOTE-03') === 3 && parseTote('tote 12') === 12 && parseTote('T7') === 7, 'tote tags print and scan back');
ok(parseTote('TOTE-00') === null && parseTote('A-02-3') === null && parseTote('1042') === null, 'bins and order numbers are never read as totes');
const live = [{ id: 'a', stage: 'picking', toteNo: 3, orderNumber: 1042 }, { id: 'b', stage: 'packed', toteNo: 5 }, { id: 'c', stage: 'picking' }];
ok(toteBusy(live, 3)?.id === 'a' && !toteBusy(live, 5) && !toteBusy(live, 3, 'a'), 'a tote is busy only while its order is being picked');
ok(needsTote(live[2]) && !needsTote(live[0]) && !needsTote({ stage: 'picking', toteSkipped: true }), 'orders without a tote are asked for one, unless skipped');
const shipped = [{ id: 'x', trackingNumber: '9400111899223344556677' }, { id: 'y', trackingNumber: '1Z999AA10123456784', extraTrackingNumbers: ['1Z999AA10123456791'] }];
ok(labelMatchesOrder('420787049400111899223344556677', shipped[0]), 'a USPS label barcode (420 + ZIP prefix) matches its tracking number');
ok(orderForLabel('1Z999AA10123456791', shipped)?.id === 'y' && !orderForLabel('9400111899000000000000', shipped), 'second-box labels match; other labels do not');
ok(looksLikeTracking('9400111899223344556677') && looksLikeTracking('1Z999AA10123456784') && !looksLikeTracking('TOTE-03') && !looksLikeTracking('012345678905'), 'tracking numbers told apart from product barcodes');
ok(withOrderRef({ signature_confirmation: 'STANDARD' }, {}, { orderNumber: 42 })?.reference_1 === 'Order #0042' && withOrderRef(undefined, { labelOrderRef: false }, { orderNumber: 42 }) === null, 'order number goes on the label unless turned off');
ok(!slipAfterLabel({}) && slipAfterLabel({ labelPackingSlip: true }), 'slip after label is off until turned on');

if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
