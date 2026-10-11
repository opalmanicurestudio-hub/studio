// Checks lib/aftercare: which aftercare a visit gets, renters' own, and what a client may see.
// Run: npx tsx scripts/verify/aftercare.verify.ts
import { aftercareDocFor, clientView } from '../../src/lib/aftercare';
import { docIsFor } from '../../src/lib/my-work';
import { assignedPeople, collectionFor, collectionsOf } from '../../src/lib/doc-collections';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const docs = [
  { id: 'gel', category: 'aftercare', status: 'published', publishedAt: '2026-10-01', links: [{ kind: 'service', id: 's-gel' }], sections: [{ id: 'a', type: 'checklist', body: 'x', photoLines: [0], itemIds: ['i'] }] },
  { id: 'all', category: 'aftercare', status: 'published', publishedAt: '2026-09-01', aftercareDefault: true, sections: [] },
  { id: 'old', category: 'aftercare', status: 'published', publishedAt: '2026-01-01', aftercareDefault: true, sections: [] },
  { id: 'draft', category: 'aftercare', status: 'draft', links: [{ kind: 'service', id: 's-pedi' }] },
  { id: 'sop', category: 'sop', status: 'published', links: [{ kind: 'service', id: 's-pedi' }] },
  { id: 'r1', category: 'aftercare', status: 'published', renterId: 'rent1', aftercareDefault: true },
];
ok(aftercareDocFor(docs, 's-gel')?.id === 'gel', 'the service’s own aftercare first');
ok(aftercareDocFor(docs, 's-pedi')?.id === 'all', 'else the newest one for every service (not drafts, not SOPs)');
ok(aftercareDocFor(docs, null)?.id === 'all', 'no service: the one for every service');
ok(aftercareDocFor(docs, 's-gel', 'rent1')?.id === 'r1' && aftercareDocFor(docs, 's-gel', 'rent2') === null, 'a renter’s visit: only their own');
ok(aftercareDocFor(docs.filter((d) => !d.aftercareDefault), 's-x') === null, 'nothing when nothing fits');
const v = clientView(docs[0])!; ok(!('photoLines' in v.sections[0]) && !('itemIds' in v.sections[0]) && v.title === 'Aftercare', 'client view drops the team’s details');
ok(!docIsFor({ category: 'aftercare', status: 'published', assignedRoles: ['all'] }, { id: 'm', role: 'staff' }), 'the team never has aftercare to sign');
ok(assignedPeople({ category: 'aftercare', assignedRoles: ['all'] }, [{ id: 'm' }]).length === 0, 'nobody assigned');
ok(collectionFor({ category: 'aftercare', collectionId: 'safety' }, collectionsOf({ docCollections: [{ id: 'x', name: 'Mine', color: '#000', soft: '#fff' }] })).id === 'aftercare', 'its own collection, even with a business’s own collections');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
