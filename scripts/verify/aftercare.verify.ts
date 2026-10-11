// Checks lib/aftercare: which aftercare a visit gets, renters' own, and what a client may see.
// Run: npx tsx scripts/verify/aftercare.verify.ts
import { aftercareDocFor, clientView, aftercareSettingsOf, checkInDaysFor, productsUsed, providerNoteOf, rebookWeeksOf } from '../../src/lib/aftercare';
import { blocksFor, lines, cleanBlock } from '../../src/lib/doc-blocks';
import { finishedAt } from '../../src/lib/aftercare-send';
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
const S0 = aftercareSettingsOf({}); ok(S0.on && S0.when === 'checkout' && S0.checkInDays === 0 && S0.showProducts && S0.providerNote, 'defaults: on, at checkout, no check-in');
const S1 = aftercareSettingsOf({ aftercare: { on: false, when: 'next_day', checkInDays: 5 } }); ok(!S1.on && S1.when === 'next_day' && S1.checkInDays === 0, 'off, next day; odd check-in day ignored');
const S3 = aftercareSettingsOf({ aftercare: { checkInDays: 3 } });
ok(checkInDaysFor(S3, {}) === 3 && checkInDaysFor(S3, { checkInDays: 7 }) === 7 && checkInDaysFor(S3, { checkInDays: 0 }) === 0 && checkInDaysFor(S3, { checkInDays: null }) === 3, 'a document can choose its own check-in day, or none');
ok(productsUsed({ checkoutState: { formula: [{ name: 'Builder gel', shade: 'Clear' }, { name: 'Top coat', lot: 'A12' }, { name: '' }] } }).join('|') === 'Builder gel · Clear|Top coat · batch A12', 'what we used, from checkout');
ok(providerNoteOf({ aftercareNote: { text: '  go easy  ' } }) === 'go easy' && providerNoteOf({}) === null, 'provider’s note');
ok(rebookWeeksOf({ rebookWeeks: 3 }) === 3 && rebookWeeksOf({ rebookWeeks: 0 }) === 0 && rebookWeeksOf(null) === 0, 'book again in the service’s weeks');
ok(blocksFor('aftercare').some((b) => b.type === 'callus') && !blocksFor('aftercare').some((b) => b.type === 'checklist') && !blocksFor('sop').some((b) => b.type === 'normal'), 'client blocks only in aftercare; no checklists there');
ok(cleanBlock({ type: 'callus', body: 'a\n\nb' }).type === 'callus' && lines({ body: ' a \n\n b ' }).join() === 'a,b', 'call-us block kept, one per line');
ok(finishedAt({ completedAt: '2026-10-11T15:00:00Z' }) === Date.parse('2026-10-11T15:00:00Z') && finishedAt({ startTime: '2026-10-11T14:00:00Z', duration: 30 }) === Date.parse('2026-10-11T14:30:00Z'), 'when a visit was finished');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
