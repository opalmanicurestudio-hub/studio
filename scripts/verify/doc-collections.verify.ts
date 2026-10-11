// Checks lib/doc-collections: collections by type, review dates, stats, search, who it's for.
// Run: npx tsx scripts/verify/doc-collections.verify.ts
import { collectionsOf, collectionFor, reviewDue, docStats, docMatches, assignedPeople, DEFAULT_COLLECTIONS } from '../../src/lib/doc-collections';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const cols = collectionsOf({});
ok(cols === DEFAULT_COLLECTIONS, 'default collections');
ok(collectionFor({ category: 'handbook' }, cols).id === 'handbook' && collectionFor({ category: 'policy' }, cols).id === 'policies', 'handbook / policy by type');
ok(collectionFor({ category: 'sop', sections: [{ type: 'checklist' }] }, cols).id === 'open-close', 'checklists → opening & closing');
ok(collectionFor({ collectionId: 'services' }, cols).id === 'services', 'own choice wins');
ok(collectionsOf({ docCollections: [{ id: 'x', name: 'Mine', color: '#000', soft: '#fff' }] })[0].id === 'x', 'business’s own collections');
ok(reviewDue({ status: 'published', reviewEveryMonths: 6, publishedAt: '2026-04-09T12:00:00Z' }) === '2026-10-09', 'review 6 months after publishing');
ok(reviewDue({ status: 'published', reviewEveryMonths: 6, publishedAt: '2026-04-09T12:00:00Z', reviewedAt: '2026-10-10T12:00:00Z' }) === '2027-04-10', '“still accurate” restarts the clock');
ok(reviewDue({ status: 'draft', reviewEveryMonths: 6, publishedAt: '2026-04-09' }) === null && reviewDue({ status: 'published' }) === null, 'no review for drafts or without a cycle');
const st = docStats({ sections: [{ type: 'step', body: 'one two three' }, { type: 'checklist', body: 'a\nb\n\nc' }] });
ok(st.steps === 1 && st.items === 3 && st.minutes === 1, 'steps, items, minutes');
ok(docMatches({ title: 'Closing', sections: [{ body: 'Autoclave strip' }] }, 'autoclave') && !docMatches({ title: 'Closing' }, 'autoclave'), 'search looks inside');
ok(assignedPeople({ assignedRoles: ['staff'], assignedStaffIds: ['m2'] }, [{ id: 'm1', role: 'staff' }, { id: 'm2', role: 'admin' }, { id: 'm3', role: 'staff', archived: true }]).length === 2, 'who it’s for (no archived)');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
