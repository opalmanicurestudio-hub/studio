// Checks Rental policies, in one place (app/(app)/rental-policies, components/renters/RentalPolicies, api/renters/policies):
// - Lease terms save as the lease builder reads them (lib/lease-builder leasePolicyPatch): only what changed, out-of-range
//   values ignored, the settings version up by one when anything changed, the attorney review recorded or removed, and
//   insurance and license requirements mirrored to what renters' papers are checked against.
// - Late rent, time away and charges to a renter's card save through the same route, read back as their resolvers read
//   them; charges need a most-it-can-be each and no repeats.
// - The page has a door (the sidebar, the rental module, the Rent page) and the old places point to it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/rental-policies.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const audits: any[] = [];
let role = 'owner';
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (is(request, 'route-guard')) return fake(request, { requireCan: async () => (role === 'none' ? { deny: { status: 403, body: { ok: false } } } : { actor: { uid: 'u1', name: 'Dana', role } }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || {};

(async () => {
  const L = await import('../../src/lib/lease-builder');
  const tenant = { name: 'Northside', address: { state: 'PA' }, leasePolicy: { noticeDays: 30, version: 3 } };
  const r1 = L.leasePolicyPatch({ noticeDays: 45, depositReturnDays: 500, insurance: { perClaimCents: 50000000 }, governingState: 'PA' }, tenant);
  check('lease terms: only what changed, out-of-range ignored, version up one', r1.changed.join() === 'noticeDays,insurance' && r1.patch['leasePolicy.noticeDays'] === 45 && r1.patch['leasePolicy.version'] === 4 && !('leasePolicy.depositReturnDays' in r1.patch)
    && r1.patch['leasePolicy.insurance'].perClaimCents === 50000000 && r1.patch['leasePolicy.insurance'].perYearCents === 200000000, r1);
  check('…nothing changed: no new version', L.leasePolicyPatch({ noticeDays: 30 }, tenant).changed.length === 0 && Object.keys(L.leasePolicyPatch({ noticeDays: 30 }, tenant).patch).length === 0);
  const rv = L.leasePolicyPatch({ attorneyReview: { at: '2026-11-01', by: 'Lee & Park', note: '' } }, tenant);
  const rc = L.leasePolicyPatch({ attorneyReview: null }, { ...tenant, leasePolicy: { ...tenant.leasePolicy, attorneyReview: { at: '2026-11-01', by: 'Lee & Park' } } });
  const bad = L.leasePolicyPatch({ noticeDays: 999, depositReturnDays: 'abc', insurance: { perClaimCents: -5 }, earlyEndFee: 'weird' }, { ...tenant, leasePolicy: { noticeDays: 45, version: 3 } });
  check('…a value out of range or not valid keeps what’s there, never the default', bad.changed.length === 0, bad);
  const keep = L.leasePolicyPatch({ attorneyReview: { at: '', by: 'Lee & Park' } }, { ...tenant, leasePolicy: { ...tenant.leasePolicy, attorneyReview: { at: '2026-11-01', by: 'Lee & Park' } } });
  check('…a review left without a date keeps the one there; a state code is kept in capitals', keep.changed.length === 0 && L.leasePolicyPatch({ governingState: 'tx' }, tenant).patch['leasePolicy.governingState'] === 'TX');
  check('…an attorney review recorded, or removed', rv.changed.includes('attorneyReview') && rv.patch['leasePolicy.attorneyReview'].by === 'Lee & Park' && rc.changed.includes('attorneyReview') && rc.patch['leasePolicy.attorneyReview'] === null);

  await db.doc(T).set({ name: 'Northside', address: { state: 'PA' }, leasePolicy: { version: 3 }, bookingPageSettings: { automationRules: { requireInsurance: false } } });
  await db.doc(`${T}/documents/h1`).set({ status: 'published', title: 'House rules', version: 2, assignedRoles: ['renter'] });
  await db.doc(`${T}/documents/h2`).set({ status: 'published', title: 'Staff handbook', version: 1, assignedRoles: ['staff'] });
  const route = await import('../../src/app/api/renters/policies/route');
  const req = (b: any) => ({ json: async () => b, headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams('tenantId=t1') } }) as any;
  const g: any = await route.GET(req({}));
  check('reads every section, house rules for renters only, and repair promises', g.status === 200 && g.body.lease.version === 3 && g.body.leave.offered.length === 0 && g.body.collections.autoBarAfterDaysLate === null && g.body.charges.length === 5 && g.body.chargesSaved === false
    && g.body.houseRules.join() === 'House rules, version 2' && g.body.repairs.length > 0, g.body);
  const s1: any = await route.POST(req({ tenantId: 't1', section: 'lease', values: { ...g.body.lease, noticeDays: 60, insurance: { ...g.body.lease.insurance, required: true }, licenseRequired: true } }));
  const t1 = await get(T);
  check('saving lease terms: the new version, and insurance and license required where papers are checked', s1.status === 200 && t1.leasePolicy.noticeDays === 60 && t1.leasePolicy.version === 4 && t1.bookingPageSettings.automationRules.requireInsurance === true && t1.bookingPageSettings.automationRules.requireLicense === true && s1.body.lease.version === 4);
  check('…with a note in the audit log of what changed', audits.some((a) => a.action === 'renters.policies_lease' && /noticeDays, insurance, licenseRequired/.test(a.summary) && /version 4/.test(a.summary)));
  const s0: any = await route.POST(req({ tenantId: 't1', section: 'lease', values: s1.body.lease }));
  await route.POST(req({ tenantId: 't1', section: 'lease', values: { ...s1.body.lease, insurance: { ...s1.body.lease.insurance, perClaimCents: 3000000 } } }));
  await db.doc(T).set({ bookingPageSettings: { automationRules: { requireInsurance: false } } }, { merge: true });
  await route.POST(req({ tenantId: 't1', section: 'lease', values: { ...(await route.GET(req({})) as any).body.lease, insurance: { ...s1.body.lease.insurance, perClaimCents: 4000000 } } }));
  check('…changing an amount never turns a papers check set elsewhere back on or off', (await get(T)).bookingPageSettings.automationRules.requireInsurance === false);
  check('…saving the same again changes nothing', s0.body.unchanged === true && s0.body.lease.version === 4);
  const s2: any = await route.POST(req({ tenantId: 't1', section: 'collections', values: { dunningDays: [14, 7, 7, 400], autoBarAfterDaysLate: 30, notifyOnBar: true, wallMessage: '  Please pay first  ' } }));
  check('late rent: read back as the nightly job reads it', s2.status === 200 && (await get(T)).collectionsPolicy.dunningDays.join() === '7,14' && (await get(T)).collectionsPolicy.autoBarAfterDaysLate === 30 && (await get(T)).collectionsPolicy.wallMessage === 'Please pay first');
  const s3: any = await route.POST(req({ tenantId: 't1', section: 'leave', values: { offered: ['pause', 'reduced', 'nope'], reducedPercent: 40, maxWeeks: 12, noticeDays: 21, autoEnd: false } }));
  check('time away: only real options, saved as the portal reads them; none at all is allowed', s3.status === 200 && (await get(T)).leavePolicy.offered.join() === 'pause,reduced' && (await get(T)).leavePolicy.reducedPercent === 40 && (await get(T)).leavePolicy.autoEnd === false
    && (await route.POST(req({ tenantId: 't1', section: 'leave', values: { offered: [] } })) as any).status === 200);
  const dup: any = await route.POST(req({ tenantId: 't1', section: 'charges', values: { charges: [{ label: 'Cleaning', capCents: 5000 }, { label: 'cleaning', capCents: 7000 }] } }));
  const nocap: any = await route.POST(req({ tenantId: 't1', section: 'charges', values: { charges: [{ label: 'Cleaning', capCents: 0 }] } }));
  const none: any = await route.POST(req({ tenantId: 't1', section: 'charges', values: { charges: [{ label: '  ', capCents: 100 }] } }));
  const okc: any = await route.POST(req({ tenantId: 't1', section: 'charges', values: { charges: [{ label: ' Cleaning ', capCents: 5000 }, { label: 'Damage', capCents: 40000 }] } }));
  check('charges: each needs the most it can be, no repeats, at least one', dup.status === 400 && /listed twice/.test(dup.body.error) && nocap.status === 400 && none.status === 400
    && okc.status === 200 && JSON.stringify((await get(T)).incidentalCategories) === JSON.stringify([{ label: 'Cleaning', capCents: 5000 }, { label: 'Damage', capCents: 40000 }]) && okc.body.chargesSaved === true);
  check('an unknown section is refused', (await route.POST(req({ tenantId: 't1', section: 'x', values: {} })) as any).status === 400);
  role = 'none';
  check('only someone who can change settings', (await route.GET(req({})) as any).status === 403 && (await route.POST(req({ tenantId: 't1', section: 'charges', values: {} })) as any).status === 403);

  // The page and its doors.
  check('the page exists, with the hub', existsSync('src/app/(app)/rental-policies/page.tsx') && /<RentalPolicies tenantId=\{tenantId\} \/>/.test(readFileSync('src/app/(app)/rental-policies/page.tsx', 'utf8')));
  check('a door in the sidebar, and part of the rental module', /\{ href: '\/rental-policies', icon: ScrollText, label: 'Rental policies' \}/.test(readFileSync('src/components/shared/AppSidebar.tsx', 'utf8')) && /'\/rent', '\/rental-policies'/.test(readFileSync('src/lib/modules.ts', 'utf8')));
  const rent = readFileSync('src/app/(app)/rent/page.tsx', 'utf8');
  check('the Rent page points there; its old settings cards are gone', /href="\/rental-policies" className="flex min-h-\[44px\]/.test(rent) && !/<CollectionsCard /.test(rent) && !/<WhatRentersGet /.test(rent) && !/Save leave policy/.test(rent) && /<Link href="\/rental-policies#away" className="inline-flex min-h-\[44px\]/.test(rent) && !/function CollectionsCard/.test(rent));
  const hub = readFileSync('src/components/renters/RentalPolicies.tsx', 'utf8');
  check('the hub holds every section, What comes with the space included', ['id="lease"', 'id="late"', 'id="away"', 'id="charges"', 'id="repairs"', 'id="rules"'].every((x) => hub.includes(x)) && /<WhatRentersGet tenantId=\{tenantId\} \/>/.test(hub));
  check('links to What comes with the space point there', !['src/components/gift/GiftShopSettings.tsx', 'src/components/settings/WinBackSettings.tsx', 'src/components/renters/LeaseBuilder.tsx', 'src/app/api/portal/renter/route.ts', 'src/lib/renter-addon-billing.ts'].some((f) => readFileSync(f, 'utf8').includes('/rent#what-renters-get')));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no tool names; no all-caps labels', !AI.test(hub) && !AI.test(readFileSync('src/app/api/renters/policies/route.ts', 'utf8')) && !/uppercase/.test(hub));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
