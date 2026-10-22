// Checks how the shipping webhook raises and clears a carrier problem (lib/carrier-issue): once per carrier event, never
// brought back by a retry or a re-read (even after someone marked it sorted, or another box had a problem since), raised
// again for a second failed delivery, cleared by delivery or by a newer scan of a quiet parcel, and written whole so
// nothing from an earlier problem carries over.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/carrier-issue.verify.ts
import { check, failures } from './fake-db';
import { carrierIssueUpdate } from '../../src/lib/carrier-issue';

const NOW = Date.parse('2026-10-22T18:00:00Z');
const apply = (o: any, u: any) => ({ ...o, ...u });

(async () => {
  let o: any = { id: 'o1', carrier: 'USPS', trackingNumber: 'A' };
  const r1 = carrierIssueUpdate(o, 'A', 'RETURNED', { statusAt: '2026-10-21T15:00:00Z', detail: 'Address not found', carrier: 'usps' }, NOW);
  check('a parcel going back to the sender is raised, with the carrier named as people write it', r1.carrierIssue?.open === true && r1.carrierIssue.status === 'RETURNED' && r1.carrierIssue.carrier === 'USPS' && r1.carrierIssue.detail === 'Address not found'
    && r1.carrierIssue.key === 'A|RETURNED|2026-10-21T15:00:00.000Z' && r1.carrierIssueKeys.join() === 'A|RETURNED|2026-10-21T15:00:00.000Z', r1);
  o = apply(o, r1);
  check('the same event again (a retry) changes nothing', Object.keys(carrierIssueUpdate(o, 'A', 'RETURNED', { statusAt: '2026-10-21T15:00:00Z' }, NOW)).length === 0);
  o = apply(o, { carrierIssue: { ...o.carrierIssue, open: false, seenAt: '2026-10-22T13:00:00Z', seenBy: 'Maya' } });
  check('marked sorted, a re-read of the same event doesn’t bring it back', Object.keys(carrierIssueUpdate({ ...o, carrierIssueKeys: undefined }, 'A', 'RETURNED', { statusAt: '2026-10-21T15:00:00Z' }, NOW)).length === 0);

  let f: any = { id: 'o2', carrier: '', trackingNumber: 'B' };
  const f1 = carrierIssueUpdate(f, 'B', 'FAILURE', { statusAt: '2026-10-20T15:00:00Z', detail: 'Business closed', carrier: 'dhl_express' }, NOW);
  f = apply(f, f1); f = apply(f, { carrierIssue: { ...f.carrierIssue, open: false, seenAt: 'x', seenBy: 'Maya' } });
  const f2 = carrierIssueUpdate(f, 'B', 'FAILURE', { statusAt: '2026-10-21T15:00:00Z', detail: 'No one home' }, NOW);
  check('a second failed delivery is raised again, written whole (nothing from the first carries over)', f1.carrierIssue.carrier === 'DHL Express' && f2.carrierIssue?.open === true && f2.carrierIssue.detail === 'No one home' && f2.carrierIssue.seenAt === null && f2.carrierIssue.seenBy === null && f2.carrierIssueKeys.length === 2, f2);

  let m: any = { id: 'o3', carrier: 'UPS', trackingNumber: 'A1', extraTrackingNumbers: ['B1'] };
  m = apply(m, carrierIssueUpdate(m, 'A1', 'RETURNED', { statusAt: '2026-10-20T10:00:00Z' }, NOW));
  m = apply(m, { carrierIssue: { ...m.carrierIssue, open: false, seenAt: 'x' } });
  m = apply(m, carrierIssueUpdate(m, 'B1', 'FAILURE', { statusAt: '2026-10-21T10:00:00Z' }, NOW));
  check('on an order of several boxes, a repeat for the first box after the second had a problem doesn’t reopen the first', m.carrierIssue.tracking === 'B1' && Object.keys(carrierIssueUpdate(m, 'A1', 'RETURNED', { statusAt: '2026-10-20T10:00:00Z' }, NOW)).length === 0);

  const quiet: any = { id: 'o4', carrier: 'USPS', trackingNumber: 'Q', carrierIssue: { open: true, status: 'STALLED', tracking: 'Q', at: '2026-10-17T15:00:00Z', quietDays: 5 } };
  check('a quiet parcel isn’t cleared by a re-read of its old scan', Object.keys(carrierIssueUpdate(quiet, 'Q', 'TRANSIT', { statusAt: '2026-10-17T15:00:00Z' }, NOW)).length === 0
    && Object.keys(carrierIssueUpdate(quiet, 'Q', 'TRANSIT', {}, NOW)).length === 0);
  const moved = carrierIssueUpdate(quiet, 'Q', 'TRANSIT', { statusAt: '2026-10-22T09:00:00Z' }, NOW);
  check('…and is cleared by a newer scan', moved.carrierIssue?.open === false && moved.carrierIssue.closedBy === 'carrier' && moved.carrierIssue.closedAt === new Date(NOW).toISOString());
  const done = carrierIssueUpdate(apply(o, { carrierIssue: { ...o.carrierIssue, open: true } }), 'A', 'DELIVERED', { statusAt: '2026-10-23T10:00:00Z' }, NOW);
  check('delivered clears it; a scan of another box doesn’t', done.carrierIssue?.open === false && Object.keys(carrierIssueUpdate(apply(o, { carrierIssue: { ...o.carrierIssue, open: true } }), 'Z', 'DELIVERED', {}, NOW)).length === 0);
  check('an ordinary scan with nothing open changes nothing', Object.keys(carrierIssueUpdate({ id: 'o5' }, 'X', 'TRANSIT', { statusAt: '2026-10-22T09:00:00Z' }, NOW)).length === 0);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
