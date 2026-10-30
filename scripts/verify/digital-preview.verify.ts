// scripts/verify/digital-preview.verify.ts — free previews of a download (lib/digital-product MAX_PREVIEWS): which files
// can be previews, what the product page is told, the shop's checks, and that the public route opens only a preview
// on a product sold online.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-preview.verify.ts
import fs from 'fs';
import { filesOf, digitalProblems, publicDigital, MAX_PREVIEWS } from '../../src/lib/digital-product';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const f = (id: string, name: string, preview = false) => ({ id, name, path: `tenants/t1/digital/p1/${id}`, size: 1000, version: 1, ...(preview ? { preview: true } : {}) });
const lic = { name: 'Personal use', terms: 'For you.' };

// ── which files
const item = { digital: true, digitalFiles: [f('s', 'Sample.pdf', true), f('a', 'Guide.pdf'), f('z', 'Cards.zip', true)] };
const files = filesOf(item);
ok(files[0].preview === true && !files[1].preview, 'a PDF marked as a preview is one');
ok(!files[2].preview, 'a zip can never be a preview: the page can’t show it');

// ── what the product page is told
const pub = publicDigital(item, lic)!;
ok((pub.files[0] as any).preview === true && (pub.files[0] as any).id === 's', 'a preview is given with its id, so it can be opened');
ok(!('id' in pub.files[1]) && !('preview' in pub.files[1]), 'a locked file is named only');
ok(!JSON.stringify(pub).includes('tenants/t1/digital'), 'no file’s stored place is ever sent');

// ── the shop's checks
ok(digitalProblems(item).length === 0, 'a sample plus locked files is fine');
const many = { digital: true, digitalFiles: [1, 2, 3, 4, 5].map((n) => f(`p${n}`, `Part ${n}.pdf`, n <= MAX_PREVIEWS + 1)) };
ok(digitalProblems(many).some((p) => /Up to 3 files/.test(p)), `no more than ${MAX_PREVIEWS} previews`);
ok(digitalProblems({ digital: true, digitalFiles: [f('s', 'Sample.pdf', true)] }).some((p) => /nothing left to buy/.test(p)), 'every file free leaves nothing to buy');
ok(digitalProblems({ digital: true, digitalFiles: [f('s', 'Sample.pdf', true)], digitalUrl: 'https://x.co/course' }).length === 0, 'unless there’s a link to buy');

// ── the public route
const r = read('src/app/api/retail/digital-preview/route.ts');
ok(/f\.preview === true/.test(r) && /isStorefrontVisible\(item\)/.test(r) && /item\.digital === true/.test(r), 'opens only a preview, on a download sold online');
ok(/ownPath\(tenantId, file\.path\)/.test(r) && /viewable\(file\.name\)/.test(r), 'only from the shop’s own downloads folder, and only what the page can show');
ok(/watermarkPdf\(bytes, `Free preview/.test(r) && /'Content-Disposition': `inline/.test(r), 'PDFs stamped as a preview, shown in the page');
ok(/tooMany\(req, tenantId\)/.test(r) && /429/.test(r), 'opens are limited per visitor');
ok(!/export async function POST/.test(r), 'it only reads');
ok(/const variant = !!item && !!item\.parentId/.test(r) && /!variant &&/.test(r), 'never a variant’s own file: variants are sold inside their listing');
const access = read('src/app/api/retail/digital-access/route.ts');
ok(/from '@\/lib\/digital-storage'/.test(access) && !/async function downloadFile/.test(access), 'buyers and previews fetch files the same way');

// ── the pages
const page = read('src/components/shop/product/ProductLayouts.tsx');
ok(/Unlocks when you buy/.test(page) && /api\/retail\/digital-preview/.test(page) && /aria-modal="true"/.test(page) && /Escape/.test(page), 'product page: preview or locked on each file, a window that closes with Escape');
ok(/createPortal\(/.test(page), 'the window is drawn over the whole page, never under the header');
ok(/setAttribute\('inert'/.test(page) && /e\.key !== 'Tab'/.test(page) && /file\.from\?\.focus/.test(page) && /\}, \[\]\);/.test(page), 'focus stays in the window, the page behind is out of reach, and focus goes back to Preview');
ok(/aria-label=\{`Preview \$\{f\.name\}`\}/.test(page) && /Open in a new tab/.test(page), 'each Preview button names its file; a PDF can open in its own tab (phones show one page in a frame)');
const owner = read('src/components/inventory/DigitalSection.tsx');
ok(/Free preview on the product page/.test(owner) && /previewCount >= MAX_PREVIEWS/.test(owner) && /free previews used/.test(owner), 'the shop turns previews on per file, up to the limit, and is told when it’s reached');
ok(!/replace\?\.preview && viewable/.test(owner) && /isn’t a free preview anymore/.test(owner), 'a new version is never public until the shop ticks it again');

console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
