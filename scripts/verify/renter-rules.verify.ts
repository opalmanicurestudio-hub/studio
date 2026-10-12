// Checks Part 6 building rules: renters only get documents sent to renters (or to them by name), the team never gets
// renters' ones mixed in, and a renter's sign-off is the same sign-off the team's are (lib/renter-rules).
// Run: npx tsx scripts/verify/renter-rules.verify.ts
import { docIsFor } from '../../src/lib/my-work';
import { assignedPeople } from '../../src/lib/doc-collections';
import { rulesFor, signRule } from '../../src/lib/renter-rules';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const store: Record<string, any> = {};
const docRef = (p: string) => ({ get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? { ...(store[p] || {}), ...v } : v; } });
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
  const q = (f: (d: any) => boolean) => ({ get: async () => { const docs = rows().filter((d) => f(d.data())); return { docs, empty: !docs.length }; }, limit: () => q(f) });
  return { get: async () => ({ docs: rows() }), where: (f: string, _o: string, v: any) => q((d) => d[f] === v) }; };
const db: any = { doc: docRef, collection: coll };
(async () => {
  const team = { id: 'm', role: 'stylist' }, renter = { id: 'r', role: 'renter' };
  const everyone = { status: 'published', assignedRoles: ['all'] }, rules = { status: 'published', assignedRoles: ['renter'] }, named = { status: 'published', assignedRoles: [], assignedStaffIds: ['r'] };
  ok(docIsFor(everyone, team) && !docIsFor(everyone, renter), '“Everyone” is the team — not renters');
  ok(docIsFor(rules, renter) && !docIsFor(rules, team), 'sent to renters → renters only');
  ok(docIsFor(named, renter), 'a renter picked by name gets it');
  ok(!docIsFor({ ...rules, status: 'draft' }, renter), 'drafts are never sent');
  const staff = [{ id: 'm', role: 'stylist' }, { id: 'r', role: 'renter' }, { id: 'x', role: 'renter', archived: true }];
  ok(assignedPeople(everyone, staff).map((x: any) => x.id).join() === 'm' && assignedPeople(rules, staff).map((x: any) => x.id).join() === 'r', 'the studio’s signed-by list counts the right people');

  store['tenants/t/staff/r'] = { renterId: 'R1', name: 'Dani Ruiz', role: 'renter' };
  store['tenants/t/documents/d1'] = { ...rules, title: 'Shared spaces', version: 2, changeNote: 'Autoclave sheet', sections: [{ id: 's', type: 'step', body: 'Label your products' }] };
  store['tenants/t/documents/d2'] = { ...everyone, title: 'Team SOP', version: 1 };
  store['tenants/t/documents/d3'] = { ...rules, title: 'Hours & keys', version: 1, requireSignature: true };
  store['tenants/t/documents/d1/acks/r'] = { version: 1, acknowledgedAt: '2026-09-02' };
  let r: any = await rulesFor(db, 't', 'R1');
  ok(r.rules.length === 2 && !r.rules.some((x: any) => x.title === 'Team SOP'), 'the renter sees building rules, never the team’s SOPs');
  ok(r.rules[0].id === 'd1' && r.rules[0].state === 'resign' && r.rules[0].changeNote === 'Autoclave sheet', 'a new version asks them to sign again, with what changed, first in the list');
  ok(r.rules[1].state === 'sign', 'a new one to sign');
  ok(!(await signRule(db, 't', 'R1', 'd2', {})).ok, 'they can’t sign a document that isn’t for them');
  ok(!(await signRule(db, 't', 'R1', 'd3', {})).ok, 'a signature is needed when the studio asks for one');
  ok((await signRule(db, 't', 'R1', 'd1', {})).ok && store['tenants/t/documents/d1/acks/r'].version === 2 && store['tenants/t/documents/d1/acks/r'].via === 'renter_portal', 'signed → the same sign-off the studio’s page reads, at v2');
  r = await rulesFor(db, 't', 'R1'); ok(r.rules.find((x: any) => x.id === 'd1').state === 'signed', 'and now it shows as signed');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
