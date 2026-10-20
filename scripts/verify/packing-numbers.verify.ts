// Checks the packing numbers: packing credited to the packer, timed-out claims to the holder, wave picks counted.
// Run: npx tsx scripts/verify/packing-numbers.verify.ts
import { staffKpis, teamKpis } from '../../src/lib/fulfilment-access';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const ev = (type: string, actorId: string, actorName: string, at: string, meta: any = {}) => ({ type, actorId, actorName, at, meta });
const orders = [
  { id: 'a', events: [ev('batch_claimed', 'rina', 'Rina', '2026-10-19T10:00:00Z'), ev('item_scanned', 'rina', 'Rina', '2026-10-19T10:05:00Z'), ev('packed', 'maya', 'Maya', '2026-10-19T10:20:00Z'), ev('label_scan_verified', 'theo', 'Theo', '2026-10-19T11:00:00Z')] },
  { id: 'b', events: [ev('batch_claimed', 'rina', 'Rina', '2026-10-19T09:00:00Z'), ev('batch_auto_released', 'system', 'Automatic', '2026-10-19T09:45:00Z')] },
  { id: 'c', events: [ev('note', 'maya', 'Maya', '2026-10-19T12:00:00Z', { kind: 'wave_to_packing' }), ev('marked_ready', 'maya', 'Maya', '2026-10-19T12:30:00Z')] },
];
const rows = staffKpis(orders as any, Date.now(), { rina: { name: 'Rina', items: 7 } });
const by = (id: string) => rows.find((r) => r.actorId === id)!;
ok(by('rina').ordersPicked === 1 && by('rina').itemsPicked === 8, 'picker credited for the pick, plus 7 items scanned on a wave walk');
ok(by('maya').ordersPacked === 2 && by('rina').ordersPacked === 0, 'packing credited to whoever boxed or shelved it');
ok(by('rina').abandonedClaims === 1 && !rows.some((r) => r.actorId === 'system'), 'a timed-out claim counts against the person who held it');
ok(by('maya').ordersPicked === 1, 'a wave order counts for the person who finished the walk');
ok(by('theo').labelsChecked === 1, 'label checks credited');
ok(teamKpis(rows).packed === 2, 'shop total of orders packed');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
