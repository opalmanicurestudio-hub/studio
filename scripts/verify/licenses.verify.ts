// scripts/verify/licenses.verify.ts — licenses a shop reuses across its downloads (lib/licenses): the ready-made three,
// words written from plain choices, the shop's own and changed ones, what a product sells with, and that the words are
// copied onto each sale. Run: npx tsx --tsconfig tsconfig.json scripts/verify/licenses.verify.ts
import fs from 'fs';
import { BUILT_IN_LICENSES, termsOf, licensesOf, licenseFor, cleanUses, copyOf } from '../../src/lib/licenses';
import { buildEntitlement } from '../../src/lib/entitlements';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };

ok(BUILT_IN_LICENSES.map((l) => l.id).join() === 'personal,professional,commercial', 'three ready-made licenses');
const personal = termsOf(BUILT_IN_LICENSES[0]);
ok(/^You may use it yourself and change it for your own use\./.test(personal) && /Please don’t resell, share or repost the files, or use it in paid work for others\./.test(personal), 'personal use reads plainly', personal);
const pro = termsOf(BUILT_IN_LICENSES[1]);
ok(/use it in your work with clients/.test(pro) && /sell things made from it/.test(pro) && !/paid work/.test(pro), 'professional: clients yes, selling what you make no', pro);
const com = termsOf(BUILT_IN_LICENSES[2]);
ok(/sell things you make with it/.test(com) && !/sell things made from it/.test(com), 'commercial: selling what you make is allowed', com);
ok(/Up to 3 people in your business may use it\./.test(termsOf({ uses: { ...BUILT_IN_LICENSES[0].uses, seats: 3 }, note: '' })), 'seats in their own sentence');
ok(/resell or share the files\./.test(termsOf({ uses: { ...BUILT_IN_LICENSES[0].uses, resale: true }, note: '' })) && /or change it\./.test(termsOf({ uses: { ...BUILT_IN_LICENSES[0].uses, modify: false }, note: '' })), 'allowing resale says so; not allowing changes says so');
ok(termsOf({ uses: { ...BUILT_IN_LICENSES[0].uses, resale: true }, note: 'Credit the shop.' }).endsWith('Credit the shop.') && !/don’t resell/.test(termsOf({ uses: { ...BUILT_IN_LICENSES[0].uses, resale: true, clients: true, commercial: true }, note: '' })), 'the shop’s note is added; allowing resale drops the line against it');
ok(cleanUses({ seats: 0 }).seats === 1 && cleanUses({ seats: 5000 }).seats === 999 && cleanUses({}).modify === true, 'choices are cleaned');

const tenant = { digitalLicenses: [{ id: 'professional', name: 'Professional use', uses: { clients: true, modify: true, seats: 4 }, note: '' }, { id: 'lic1', name: 'Salon license', uses: { clients: true, seats: 3 }, note: 'Credit Opal.' }, { id: '', name: 'broken' }] };
const all = licensesOf(tenant);
ok(all.length === 4 && all[1].builtIn && all[1].uses.seats === 4 && all[3].name === 'Salon license', 'the shop’s changed ready-made license and its own; broken entries skipped');

ok(licenseFor(tenant, { licenseId: 'lic1' }).name === 'Salon license' && /Credit Opal\./.test(licenseFor(tenant, { licenseId: 'lic1' }).terms), 'a product sells with the shop’s license, as it reads now');
ok(licenseFor({}, { licenseId: 'gone', license: { id: 'gone', name: 'Old', terms: 'Old words.' } }).terms === 'Old words.', 'a removed license keeps the words saved on the product');
ok(licenseFor({}, { license: { id: 'custom', name: 'One-off', terms: 'Just this.' } }).name === 'One-off', 'words for one product only');
ok(licenseFor({}, {}).id === 'personal', 'nothing picked is personal use');

const order = { id: 'o1', paidAt: '2026-10-01T12:00:00Z', lines: [] };
const e = buildEntitlement('t1', order, { lineId: 'l1', productId: 'p1', digital: true }, { licenseId: 'lic1' }, '2026-10-01T12:00:05Z', tenant);
ok(e.license.name === 'Salon license' && e.license.terms === copyOf(all[3]).terms, 'the sale copies the license’s words onto the buyer’s record');

const sec = fs.readFileSync('src/components/inventory/DigitalSection.tsx', 'utf8');
ok(sec.includes('policies.map((l) =>') && sec.includes('licenseId: license.id,') && sec.includes('<LicenseManager'), 'the product page picks from the shop’s licenses and saves which one');
const ent = fs.readFileSync('src/lib/entitlements.ts', 'utf8');
ok(ent.includes('licenseFor(tenant, item)') && (ent.match(/db\.doc\(`tenants\/\$\{tenantId\}`\)\.get\(\);/g) || []).length === 2 && !ent.includes('get().catch(() => null)'), 'payment and first open read the shop’s licenses');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
