// scripts/verify/digital-product.verify.ts — a download's settings (lib/digital-product): files with versions (and the
// older single-file shape), how it's delivered, the problems the product page shows, and that the file route, the
// buyer's library and the shop all read them. Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-product.verify.ts
import fs from 'fs';
import { publicDigital, digitalFaq, ownPath, filesOf, fileOf, deliveryOf, openMode, digitalProblems, downloadLimitOf, legacyFileFields, viewable, sizeWords, MAX_FILES } from '../../src/lib/digital-product';
import { storefrontBlockers, isStorefrontVisible } from '../../src/lib/retail-orders';
import { asSold } from '../../src/lib/variants';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };

const f = (id: string, name: string, version = 1) => ({ id, name, path: `p/${id}`, size: 1000, type: '', version, addedAt: '' });

// ── files
ok(filesOf({ digitalFilePath: 'p/old.pdf', digitalFileName: 'Guide.pdf' })[0]?.id === 'main' && filesOf({ digitalFilePath: 'p/old.pdf' })[0].name === 'old.pdf', 'a product saved with one file still has it, as "main"');
ok(filesOf({ digitalFiles: [f('a', 'A.pdf'), f('b', 'B.zip')], digitalFilePath: 'p/old.pdf' }).length === 2, 'files with versions win over the old single file');
ok(filesOf({ digitalFiles: Array.from({ length: 14 }, (_, i) => f(`x${i}`, `${i}.pdf`)) }).length === MAX_FILES, 'at most ten files');
ok(fileOf({ digitalFiles: [f('a', 'A.pdf'), f('b', 'B.zip')] }, 'b')?.name === 'B.zip' && fileOf({ digitalFiles: [f('a', 'A.pdf')] }, null)?.id === 'a', 'a file by id; nothing named is the first');
ok(fileOf({ digitalFiles: [f('a', 'A.pdf')] }, 'gone') === null, 'a removed file is not quietly swapped for another');
ok(fileOf({ digitalFilePath: 'p/old.pdf' }, 'main')?.path === 'p/old.pdf' && fileOf({ digitalFiles: [f('b', 'B.zip')] }, 'main') === null, '"main" means the old single file only while it is still there');
ok(ownPath('t1', 'tenants/t1/digital/p1/a.pdf') && !ownPath('t1', 'tenants/t2/digital/p1/a.pdf') && !ownPath('t1', 'tenants/t1/digital/../x') && !ownPath('t1', 'tenants/t1/photos/a.jpg'), 'only files in this shop’s private downloads folder are ever served');
ok(digitalProblems({ digital: true, digitalFiles: [f('a', 'A.pdf')], digitalDownloadLimit: NaN }).some((p) => p.includes('1 or more')), 'a blank or zero limit while the limit is on is flagged');
ok(legacyFileFields([f('a', 'A.pdf')]).digitalFilePath === 'p/a' && legacyFileFields([]).digitalFilePath === null, 'the first file is kept in the old fields for older readers');
ok(viewable('a.PDF') && viewable('b.jpg') && !viewable('c.zip') && !viewable('d.mp3'), 'PDFs and pictures open in the library; the rest is saved');
ok(sizeWords(3_400_000) === '3.2 MB' && sizeWords(900_000) === '879 KB' && sizeWords(0) === '', 'sizes in words');

// ── delivery
const pdf = f('a', 'A.pdf'), zip = f('b', 'B.zip');
ok(deliveryOf({}) === 'both' && deliveryOf({ digitalDelivery: 'view' }) === 'view', 'view and save is the default');
ok(openMode({}, pdf, 'view') === 'view' && openMode({}, pdf, 'download') === 'download' && openMode({}, zip, 'view') === 'download', 'both: a PDF opens as asked; a zip is always saved');
ok(openMode({ digitalDelivery: 'view' }, pdf, 'download') === 'view' && openMode({ digitalDelivery: 'view' }, zip, 'view') === null, 'view only never saves, and can’t serve a zip');
ok(openMode({ digitalDelivery: 'download' }, pdf, 'view') === 'download', 'save only always saves');

// ── problems and limits
ok(digitalProblems({ digital: true })[0]?.includes('file or a link'), 'a download needs a file or a link');
ok(digitalProblems({ digital: true, digitalUrl: 'http://x.com' }).some((p) => p.includes('https')), 'a link must be https');
ok(digitalProblems({ digital: true, digitalDelivery: 'view', digitalFiles: [zip] }).some((p) => p.includes('PDFs and pictures')), 'view only with a zip is flagged');
ok(digitalProblems({ digital: true, digitalFiles: [pdf], license: { id: 'custom', terms: ' ' } }).some((p) => p.includes('license terms')), 'custom license terms are required');
ok(digitalProblems({ digital: true, digitalFiles: [pdf] }).length === 0 && digitalProblems({}).length === 0, 'a ready download, and a product that isn’t one, have no problems');
ok(downloadLimitOf({}) === 5 && downloadLimitOf({ digitalDownloadLimit: 0 }) === null && downloadLimitOf({ digitalDownloadLimit: 3 }) === 3, 'the limit: 5 by default, 0 means none');

// ── the shop won't sell an empty download
const base = { type: 'retail', showOnline: true, msrp: 10 };
ok(!isStorefrontVisible({ ...base, digital: true } as any) && storefrontBlockers({ ...base, digital: true } as any).includes('A download with no file or link yet'), 'a download with nothing to give isn’t sold');
ok(isStorefrontVisible({ ...base, digital: true, digitalUrl: 'https://x.com' } as any) && isStorefrontVisible({ ...base } as any), 'one with a link sells; ordinary products are unaffected');

// ── a variant takes its listing's download
const sold = asSold({ id: 'L', name: 'Guide', digital: true, digitalFiles: [pdf], digitalDelivery: 'view', digitalDownloadLimit: 2, license: { id: 'custom', name: 'Pro', terms: 'x' } }, { id: 'v', parentId: 'L' });
ok(sold.digital === true && filesOf(sold).length === 1 && sold.digitalDelivery === 'view' && sold.digitalDownloadLimit === 2 && sold.license?.name === 'Pro', 'a variant sold inside its listing gets its files, delivery, limit and license');

// ── what a shopper sees before buying
const pd: any = publicDigital({ digital: true, digitalFormat: 'guide', digitalFiles: [f('a', 'Guide.pdf'), f('b', 'Cards.zip')], digitalUrl: 'https://secret.example/abc', digitalAccessDays: 30, digitalDownloadLimit: 3 }, { name: 'Professional use', terms: 'Use with clients.' });
ok(pd.formatLabel === 'Guide or ebook' && pd.files.length === 2 && pd.files[0].type === 'PDF' && pd.hasLink === true && pd.accessDays === 30 && pd.downloadLimit === 3, 'format, files, link, access and limit');
ok(!JSON.stringify(pd).includes('p/a') && !JSON.stringify(pd).includes('secret.example'), 'no file paths and no link address before buying');
ok(publicDigital({ digital: true, digitalDelivery: 'view', digitalFiles: [f('a', 'A.pdf')] }, { name: 'x', terms: 'y' })!.downloadLimit === 0 && publicDigital({}, { name: 'x', terms: 'y' }) === null, 'view only has no downloads; not a download, nothing');
const fq = digitalFaq(pd);
ok(fq.length === 4 && /3 copies/.test(fq[1].a) && /30 days/.test(fq[2].a) && fq[3].a === 'Use with clients. (Professional use)', 'questions answered from its own settings', fq);
const linkOnly: any = publicDigital({ digital: true, digitalUrl: 'https://x.example', digitalDelivery: 'download' }, { name: 'P', terms: 'T.' });
ok(linkOnly.downloadLimit === 0 && linkOnly.how === 'Opened from your library' && digitalFaq(linkOnly).length === 3, 'online content only: no downloads, no download question');
const saveOnly: any = publicDigital({ digital: true, digitalDelivery: 'download', digitalFiles: [f('a', 'A.pdf')], digitalDownloadLimit: 1, digitalAccessDays: 1 }, { name: 'P', terms: 'T.' });
ok(saveOnly.how === 'Saved to your device' && /counts as one of your 1 download\./.test(digitalFaq(saveOnly)[1].a) && /For 1 day /.test(digitalFaq(saveOnly)[2].a), 'save only: every open saves; one day, one download in the singular');
const zipOnly: any = publicDigital({ digital: true, digitalFiles: [f('a', 'A.zip')], digitalDownloadLimit: 0 }, { name: 'P', terms: 'T.' });
ok(zipOnly.how === 'Saved to your device' && zipOnly.downloadLimit === null && /no limit/.test(digitalFaq(zipOnly)[1].a), 'a zip can’t be read online; no limit says so');
ok(publicDigital({ digital: true, digitalFiles: [f('a', 'README')] }, { name: 'P', terms: 'T.' })!.files[0].type === '', 'a file with no extension has no type');
const pr = fs.readFileSync('src/app/api/retail/product/route.ts', 'utf8');
ok(pr.includes('digitalInfo: item.digital === true ? publicDigital(item, licenseFor(tenant, item), { deviceLimit: deviceCap(tenant, item) }) : null,'), 'the product route sends what’s inside, never where it is');
const lay = fs.readFileSync('src/components/shop/product/ProductLayouts.tsx', 'utf8');
ok(lay.includes("id: 'inside', title: 'What’s inside'") && (lay.match(/<DigitalBlock d=\{p\.digitalInfo\} v=\{v\} \/>/g) || []).length === 2, 'every layout shows what’s inside and the license');

// ── wiring
const route = fs.readFileSync('src/app/api/retail/digital-access/route.ts', 'utf8');
ok(route.includes('const file = fileOf(auth.item, fid || null);') && route.includes("streamKey(productId, lineId, fid)"), 'the file route serves the file the link was signed for');
ok(route.includes('if (openMode(auth.item, file, streamTokenMode(sig)) !== streamTokenMode(sig))'), 'a link made before the shop changed delivery stops working');
ok(route.includes('const mode = file ? openMode(item, file, asked) : null;') && route.includes('canSave: openMode(item, file, \'download\') === \'download\''), 'opening follows how the shop delivers it, and says whether a copy can be saved');
ok(route.includes("if (item.parentId && item.digital !== true)"), 'a variant opens its listing’s download');
ok((route.match(/ownPath\(tenantId, /g) || []).length === 2, 'both doors refuse a stored path outside the shop’s downloads folder');
const st = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
ok(st.includes('contents: passOk ? contentsOf(l) : null,'), 'the library learns the files only with proof it’s the buyer');
const lib = fs.readFileSync('src/app/shop/[tenantId]/library/[orderId]/page.tsx', 'utf8');
ok(lib.includes('parts.length > 1') && lib.includes('{viewing.canSave && ('), 'the library lists each file, and offers saving only when the shop allows it');
const tab = fs.readFileSync('src/components/inventory/OnlineListingTab.tsx', 'utf8');
ok(tab.includes('<DigitalSection product={product} onSave={onSave} />'), 'downloads are set on the product page');
const settings = fs.readFileSync('src/app/(app)/retail-orders/settings/page.tsx', 'utf8');
ok(!settings.includes('digitalFilePath: d.digital') && !settings.includes('uploadPrivateFile') && /Link href="\/inventory"/.test(settings) && !/digitalUrl/.test(settings), 'Shop settings no longer edits downloads (no second editor writing old values back)');
const ent = fs.readFileSync('src/lib/entitlements.ts', 'utf8');
ok(ent.includes("item = asSold({ id: String(item.parentId), ...ls.data() }, { id: line.productId, ...item });"), 'a variant’s buyer gets the listing’s limit and license on their record');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
