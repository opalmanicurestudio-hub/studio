// Checks Part 6, a renter's own documents (lib/renter-docs): only theirs, drafts kept aside on a live document,
// versions, and which aftercare a visit gets.
// Run: npx tsx scripts/verify/renter-docs.verify.ts
import { saveRenterDoc, removeRenterDoc, renterAftercareFor, cleanBlocks, renterLibrary, saveRenterCare } from '../../src/lib/renter-docs';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const store: Record<string, any> = {}; let n = 0;
const docRef = (p: string) => ({ id: p.split('/').pop(), get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? { ...(store[p] || {}), ...v } : v; }, delete: async () => { delete store[p]; } });
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
  const q = (f: (d: any) => boolean) => ({ get: async () => { const docs = rows().filter((d) => f(d.data())); return { docs, empty: !docs.length }; }, limit: () => q(f) });
  return { get: async () => ({ docs: rows() }), where: (f: string, _o: string, v: any) => q((d) => d[f] === v), doc: (id?: string) => docRef(`${p}/${id || `n${++n}`}`) }; };
const db: any = { doc: docRef, collection: coll };
(async () => {
  store['tenants/t/staff/s1'] = { renterId: 'R1', name: 'Dani', role: 'renter' }; store['tenants/t/staff/s2'] = { renterId: 'R2', name: 'Lee', role: 'renter' };
  store['tenants/t/renterServices/lam'] = { staffId: 's1', name: 'Brow lamination' }; store['tenants/t/renterServices/old'] = { staffId: 's1', name: 'Old', isActive: false };
  ok(cleanBlocks([{ type: 'evil', heading: 'x' }, { type: 'step' }, { type: 'checklist', body: 'a\nb' }]).map((b) => b.type).join() === 'text,checklist', 'blocks: unknown types become text, empty ones are dropped');
  ok(!(await saveRenterDoc(db, 't', 'R1', { title: '', sections: [{ body: 'x' }] })).ok, 'needs a title');
  let r: any = await saveRenterDoc(db, 't', 'R1', { title: 'Lamination aftercare', category: 'aftercare', sections: [{ type: 'step', body: 'No water for 24 h' }], serviceIds: ['lam'], publish: true });
  const id = r.id; ok(r.ok && store[`tenants/t/renterDocs/${id}`].status === 'published' && store[`tenants/t/renterDocs/${id}`].version === 1, 'published at version 1');
  r = await saveRenterDoc(db, 't', 'R1', { id, title: 'Lamination aftercare', category: 'aftercare', sections: [{ type: 'step', body: 'No water for 48 h' }], serviceIds: ['lam'] });
  ok(r.draft && store[`tenants/t/renterDocs/${id}`].sections[0].body === 'No water for 24 h' && store[`tenants/t/renterDocs/${id}`].draft.sections[0].body === 'No water for 48 h', 'saving a live one keeps the change aside — clients still get the live copy');
  r = await saveRenterDoc(db, 't', 'R1', { id, title: 'Lamination aftercare', category: 'aftercare', sections: [{ type: 'step', body: 'No water for 48 h' }], serviceIds: ['lam'], publish: true });
  ok(store[`tenants/t/renterDocs/${id}`].version === 2 && store[`tenants/t/renterDocs/${id}`].draft === null && store[`tenants/t/renterDocs/${id}`].sections[0].body === 'No water for 48 h', 'publishing the change → version 2');
  ok(!(await saveRenterDoc(db, 't', 'R2', { id, title: 'Mine now', sections: [{ body: 'x' }] })).ok && !(await removeRenterDoc(db, 't', 'R2', id)).ok, 'another renter can’t change or delete it');
  const lib: any = await renterLibrary(db, 't', 'R1'); ok(lib.docs.length === 1 && lib.services.map((x: any) => x.id).join() === 'lam', 'their library and their active services');
  ok((await renterLibrary(db, 't', 'R2') as any).docs.length === 0, 'another renter sees none of it');
  await saveRenterDoc(db, 't', 'R1', { title: 'Everything else', category: 'aftercare', sections: [{ body: 'Be gentle' }], aftercareDefault: true, publish: true });
  const docs = Object.values(store).filter((d: any) => d?.staffId === 's1' && d.category);
  ok(renterAftercareFor(docs, 'lam').title === 'Lamination aftercare' && renterAftercareFor(docs, 'tint').title === 'Everything else', 'a linked service gets its own; the rest get “every other service”');
  ok(renterAftercareFor(docs.filter((d: any) => !d.aftercareDefault), 'tint') === null, 'nothing linked and no default → no aftercare');
  r = await saveRenterCare(db, 't', 'R1', { on: true, when: 'next_day', checkInDays: 9 });
  ok(r.care.when === 'next_day' && r.care.checkInDays === 0 && store['tenants/t/renterSettings/s1'].aftercare.when === 'next_day', 'their aftercare choices are kept (bad check-in days fall back to none)');
  ok((await removeRenterDoc(db, 't', 'R1', id)).ok && !store[`tenants/t/renterDocs/${id}`], 'they can delete their own');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
