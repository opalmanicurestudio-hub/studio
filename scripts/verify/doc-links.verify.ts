// Checks lib/doc-links: cleaning links, which documents belong to a visit, and a station's documents.
// Run: npx tsx scripts/verify/doc-links.verify.ts
import { cleanLinks, docsForVisit, docsForStation, visitStationIds, linkLabel } from '../../src/lib/doc-links';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const L = cleanLinks([{ kind: 'service', id: 'gel', name: 'Gel manicure', stepId: 'p2', stepLabel: 'Prep' }, { kind: 'service', id: 'gel', name: 'Gel manicure', stepId: 'p2', stepLabel: 'Prep' },
  { kind: 'station', id: 'chair2', name: 'Chair 2', stepId: 'x' }, { kind: 'bogus', id: 'z' }, { kind: 'kit', id: 'k1', name: 'Metal implements' }, { kind: 'kit', id: '' }]);
ok(L.length === 3, 'duplicates, unknown kinds and empty ids dropped');
ok((L[1] as any).stepId === undefined, 'a station link keeps no step');
ok(linkLabel(L[0]) === 'Gel manicure · Prep' && linkLabel(L[1]) === 'Station · Chair 2', 'labels');
const docs = [
  { id: 'a', title: 'Prep the nail', status: 'published', links: [{ kind: 'service', id: 'gel', name: 'Gel', stepId: 'p2', stepLabel: 'Prep' }] },
  { id: 'b', title: 'Chair cleaning', status: 'published', links: [{ kind: 'station', id: 'chair2', name: 'Chair 2' }] },
  { id: 'c', title: 'Implements', status: 'published', links: [{ kind: 'kit', id: 'k1', name: 'Metal implements' }] },
  { id: 'd', title: 'Draft one', status: 'draft', links: [{ kind: 'service', id: 'gel', name: 'Gel' }] },
  { id: 'e', title: 'Pedicure only', status: 'published', links: [{ kind: 'service', id: 'pedi', name: 'Pedicure' }] },
];
const visit = { serviceId: 'gel', requiredResourceIds: ['chair2'] }; const svc = { id: 'gel', blueprint: { requirements: [{ kind: 'kit', name: 'metal implements ' }] } };
const v = docsForVisit(docs, visit, svc);
ok(v.map((x) => x.doc.id).sort().join() === 'a,b,c', 'service step, station and kit documents; not drafts or other services');
ok(v.find((x) => x.doc.id === 'c')!.why === 'Kit · Metal implements', 'kit matched by name, any case');
const n = docsForVisit(docs, visit, svc, { id: 'p2' });
ok(n[0].doc.id === 'a' && n[0].now, 'the step under way comes first');
ok(docsForVisit(docs, visit, svc, { label: 'prep' })[0].now, 'or by the step’s label for older services');
ok(!docsForVisit(docs, visit, svc, { id: 'p9' }).some((x) => x.now), 'nothing marked for another step');
ok(docsForVisit(docs, null, svc).length === 0, 'no visit, nothing');
ok(visitStationIds({ requiredResourceIds: ['a'], resourceId: 'a', stationId: 'b' }).join() === 'a,b', 'a visit’s stations');
ok(docsForStation(docs, 'chair2').map((d) => d.id).join() === 'b', 'a station’s documents');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
