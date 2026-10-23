// Checks the shop's box sizes, set from an order (api/retail/box-sizes, lib/box-sizes): managers only; each needs a
// name, three sides and the empty box's weight within sensible limits; names are unique; at most eight; a change keeps
// the box's id and a removal takes only that one. A box already chosen on an order keeps its own size.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/box-sizes.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
let actor: any = {};
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor }) };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
const presets = async () => ((await db.doc(T).get()).data()?.retailSettings?.packagingPresets || []) as any[];
const ana = { uid: 'u1', name: 'Ana Ruiz', isManager: true };

(async () => {
  const { POST } = await import('../../src/app/api/retail/box-sizes/route');
  const { cleanPreset, MAX_BOX_SIZES } = await import('../../src/lib/box-sizes');
  const run = (body: any) => POST(req(body)) as any;

  check('a size needs a name, three sides and the empty weight', !!cleanPreset({ name: '', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 6 }).error && !!cleanPreset({ name: 'Small', lengthIn: 0, widthIn: 6, heightIn: 4, weightOz: 6 }).error
    && !!cleanPreset({ name: 'Small', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: -1 }).error && !cleanPreset({ name: 'Small', lengthIn: '8', widthIn: '6.5', heightIn: 4, weightOz: '6' }).error);
  check('…within what a carrier takes', !!cleanPreset({ name: 'Huge', lengthIn: 500, widthIn: 6, heightIn: 4, weightOz: 6 }).error);

  await db.doc(T).set({ name: 'Opal', retailSettings: { shippoConnected: true, packagingPresets: [{ id: 'small', name: 'Small', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 6 }] } });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'picking', packBoxes: [{ presetId: 'small', name: 'Small', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 6 }] });

  actor = { uid: 'k1', name: 'Kai Park', isManager: false };
  let r = await run({ action: 'save', preset: { name: 'Medium', lengthIn: 12, widthIn: 10, heightIn: 6, weightOz: 10 } });
  check('someone who isn’t a manager can’t change the sizes', r.status === 403 && (await presets()).length === 1, r.body);

  actor = ana;
  r = await run({ action: 'save', preset: { name: 'Medium', lengthIn: 12, widthIn: 10, heightIn: 6, weightOz: 10 } });
  let list = await presets();
  check('a manager adds a size: it gets its own id and the list comes back', r.status === 200 && r.body.ok && list.length === 2 && list[1].name === 'Medium' && /^box_/.test(list[1].id) && r.body.presets.length === 2, r.body);
  check('the shop’s other settings are untouched', (await db.doc(T).get()).data()?.retailSettings?.shippoConnected === true);

  r = await run({ action: 'save', preset: { name: 'medium', lengthIn: 14, widthIn: 10, heightIn: 6, weightOz: 10 } });
  check('two boxes can’t share a name', r.status === 409 && (await presets()).length === 2, r.body);

  r = await run({ action: 'save', preset: { id: 'small', name: 'Small mailer', lengthIn: 9, widthIn: 6, heightIn: 3, weightOz: 5 } });
  list = await presets();
  check('changing a size keeps its id and its place', r.body.ok && list[0].id === 'small' && list[0].name === 'Small mailer' && list[0].lengthIn === 9 && list.length === 2, list);
  check('…and an order that already chose it keeps the size it chose', ((await db.doc(`${T}/retailOrders/o1`).get()).data()?.packBoxes?.[0]?.lengthIn) === 8);

  for (let i = list.length; i < MAX_BOX_SIZES; i++) await run({ action: 'save', preset: { name: `Box ${i}`, lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 8 } });
  check(`up to ${MAX_BOX_SIZES} sizes`, (await presets()).length === MAX_BOX_SIZES);
  r = await run({ action: 'save', preset: { name: 'One more', lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 8 } });
  check('…and one more is refused with what to do', r.status === 409 && /Remove one first/.test(r.body.error) && (await presets()).length === MAX_BOX_SIZES, r.body);

  r = await run({ action: 'remove', id: 'small' });
  list = await presets();
  check('removing takes only that size', r.body.ok && !list.some((p) => p.id === 'small') && list.length === MAX_BOX_SIZES - 1);
  r = await run({ action: 'remove', id: 'nope' });
  check('a size that isn’t there says so', r.status === 404);
  r = await run({ action: 'rename' });
  check('an unknown action changes nothing', r.status === 400 && (await presets()).length === MAX_BOX_SIZES - 1);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
