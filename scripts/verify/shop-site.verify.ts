// scripts/verify/shop-site.verify.ts — the shop's whole-site look (lib/shop-site): five layouts, twelve presets that
// each fill in a readable theme, the logo and how it shows (and its light version on dark backgrounds), the logo on
// order emails, packing slips and invoices, and every shop page using the one shared header and footer.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shop-site.verify.ts
import fs from 'fs';
import { SITE_LAYOUTS, SITE_PRESETS, presetById, brandOf, sanitizeBrandSettings, logoFor, siteTypeCss, SITE_TYPE } from '../../src/lib/shop-site';
import { sanitizeTheme, themeToCss, contrastRatio, DEFAULT_THEME } from '../../src/lib/shop-theme';
import { brandFromTenant, brandedEmail } from '../../src/lib/email-shell';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } else console.log('  ✓', m); };

// ── layouts and presets
ok(SITE_LAYOUTS.map((l) => l.id).join(',') === 'atelier,maison,index,spotlight,bento', 'five layouts');
ok(SITE_PRESETS.length === 12 && new Set(SITE_PRESETS.map((p) => p.id)).size === 12, 'twelve presets, each its own');
for (const l of SITE_LAYOUTS) ok(SITE_PRESETS.filter((p) => p.layout === l.id).length >= 2, `${l.name} has at least two presets`);
const allReadable = SITE_PRESETS.every((p) => { const t = sanitizeTheme({ ...DEFAULT_THEME, ...p.theme }); return t.site === p.layout && t.preset === p.id && contrastRatio(t.ink, t.surface) >= 4.5 && t.font === 'jakarta' && t.headingFont === 'jakarta'; });
ok(allReadable, 'every preset sanitizes to its layout, keeps its id, reads clearly and uses Plus Jakarta Sans');
ok(!/serif|mono|rounded|display/.test(JSON.stringify(SITE_PRESETS.map((p) => [p.theme.font, p.theme.headingFont]))), 'no other typefaces in the presets');
const noir = sanitizeTheme({ ...DEFAULT_THEME, ...presetById('maison-noir')!.theme });
ok(noir.surface === '#0e0e0e' && noir.corners === 'sharp' && noir.site === 'maison', 'a dark preset fills in dark colors and its corners');

// ── the theme carries the layout
ok(sanitizeTheme({}).site === 'atelier' && sanitizeTheme({ site: 'nope' }).site === 'atelier' && sanitizeTheme({ site: 'bento' }).site === 'bento', 'a shop without a layout gets Atelier; unknown ones are ignored');
ok(sanitizeTheme({ preset: 'Bad Value!' }).preset === '' && sanitizeTheme({ preset: 'index-clean' }).preset === 'index-clean', 'preset ids are checked');
const css = themeToCss(sanitizeTheme({ site: 'maison' }));
ok(css.includes('--shop-head-weight:200') && css.includes('--shop-logo-track:.32em') && css.includes('--shop-nav-case:uppercase'), 'the layout’s type goes into the shop’s CSS variables', css.slice(-300));
ok(siteTypeCss('spotlight').includes('--shop-head-weight:700') && SITE_TYPE.index.navCase === 'none', 'each layout sets its own type');

// ── the logo
const b0 = brandOf({ logoUrl: 'https://cdn/logo.png' });
ok(b0.logoUrl === 'https://cdn/logo.png' && b0.show === 'mark+name' && b0.place === 'left' && b0.size === 'medium', 'a logo saved before these settings shows with the name, on the left');
ok(brandOf({}).show === 'name' && brandOf({ retailSettings: { shopBrand: { show: 'mark' } } }).show === 'name', 'no logo: the name shows, whatever was chosen');
ok(brandOf({ retailSettings: { logoUrl: 'https://cdn/shop.png' } }).logoUrl === 'https://cdn/shop.png', 'an older shop-only logo is still found');
ok(brandOf({ logoUrl: 'http://insecure/x.png' }).logoUrl === '' && brandOf({ logoUrl: 'javascript:alert(1)' }).logoUrl === '', 'only https images');
const b1 = brandOf({ logoUrl: 'https://cdn/l.png', retailSettings: { shopBrand: { darkLogoUrl: 'https://cdn/light.png', iconUrl: 'https://cdn/i.png', show: 'mark', place: 'center', size: 'large' } } });
ok(b1.show === 'mark' && b1.place === 'center' && b1.size === 'large' && b1.iconUrl === 'https://cdn/i.png', 'settings are read');
ok(logoFor(b1, true) === 'https://cdn/light.png' && logoFor(b1, false) === 'https://cdn/l.png' && logoFor(b0, true) === 'https://cdn/logo.png', 'the light logo on dark backgrounds, when there is one');
const sb = sanitizeBrandSettings({ show: 'weird', place: 'top', size: 'huge', darkLogoUrl: 'http://x', iconUrl: 'https://ok/i.png', extra: 1 });
ok(sb.show === 'mark+name' && sb.place === 'left' && sb.size === 'medium' && sb.darkLogoUrl === '' && sb.iconUrl === 'https://ok/i.png' && !('extra' in sb) && !('logoUrl' in sb), 'what the designer saves is checked, and never the logo itself', sb);

// ── the logo on order emails
const eLight = brandFromTenant({ businessName: 'Opal', logoUrl: 'https://cdn/l.png', retailSettings: { shopTheme: { brand: '#f5e9d8' } } });
ok(eLight.logoUrl === 'https://cdn/l.png', 'a light brand color: the logo goes on the email header');
const eDarkNoLight = brandFromTenant({ businessName: 'Opal', logoUrl: 'https://cdn/l.png', retailSettings: { shopTheme: { brand: '#16171a' } } });
ok(!eDarkNoLight.logoUrl, 'a dark header with no light logo: the name alone (a dark logo would vanish)');
const eDark = brandFromTenant({ businessName: 'Opal', logoUrl: 'https://cdn/l.png', retailSettings: { shopTheme: { brand: '#16171a' }, shopBrand: { darkLogoUrl: 'https://cdn/light.png', show: 'mark' } } });
ok(eDark.logoUrl === 'https://cdn/light.png' && eDark.show === 'mark', 'a dark header with a light logo: the light logo');
const html = brandedEmail(eDark, '<p>Hi</p>');
ok(html.includes('src="https://cdn/light.png"') && html.includes('alt="Opal"') && !/>Opal<\/span>/.test(html), 'logo only: the image, named for screen readers, without the name repeated');
const html2 = brandedEmail(eLight, '<p>Hi</p>');
ok(html2.includes('src="https://cdn/l.png"') && /OPAL|Opal<\/span>/.test(html2), 'logo and name: both');
ok(!brandedEmail({ shopName: 'Opal', brandColor: '#16171a' }, '<p>x</p>').includes('<img'), 'no logo: as before');

// ── wiring
const src = (p: string) => fs.readFileSync(p, 'utf8');
const pages = ['src/app/shop/[tenantId]/page.tsx', 'src/app/shop/[tenantId]/catalog/page.tsx', 'src/app/shop/[tenantId]/product/[productId]/page.tsx', 'src/app/shop/[tenantId]/account/page.tsx', 'src/app/shop/[tenantId]/offer/[offerId]/page.tsx'];
ok(pages.every((p) => /<ShopHeader\b/.test(src(p)) && !/<header className="sticky top-0/.test(src(p))), 'every shop page uses the shared header, none its own', pages.filter((p) => !/<ShopHeader\b/.test(src(p))));
const layout = src('src/app/shop/[tenantId]/layout.tsx');
ok(/<ShopSiteProvider value=\{site\}>/.test(layout) && /<ShopFooter \/>/.test(layout) && /icons: \{ icon, apple: icon \}/.test(layout), 'the layout gives every page the shop, the footer and the tab icon');
const designer = src('src/app/(app)/retail-orders/designer/page.tsx');
ok(/<SiteLook /.test(designer) && /shopBrand: sanitizeBrandSettings\(brand\)/.test(designer) && /logoUrl: brand\.logoUrl/.test(designer) && !/THEME_PRESETS/.test(designer) && !/colour/i.test(designer), 'the designer picks the look, saves the logo and its settings, US spelling');
ok(/dispatchEvent\(new Event\('cf-cart'\)\)/.test(src('src/lib/shop-cart.ts')) && /addEventListener\('cf-cart'/.test(src('src/components/shop/ShopChrome.tsx')), 'the header’s bag count follows the cart');
ok(/logoUrl: brandOf\(tenant\)\.logoUrl/.test(src('src/lib/order-slip-server.ts')) && /logoUrl=\{smart\.logoUrl\}/.test(src('src/app/print/packing-slip/[tenantId]/[orderId]/page.tsx')) && /logoUrl=\{x\.logoUrl\}/.test(src('src/app/print/labels/[tenantId]/page.tsx')), 'packing slips carry the logo');
ok(/shopLogoUrl: brandOf/.test(src('src/app/api/retail/order-status/route.ts')) && /data\.shopLogoUrl/.test(src('src/app/shop/[tenantId]/invoice/[orderId]/page.tsx')), 'invoices carry the logo');
ok(/brandFromTenant\(t\)/.test(src('src/lib/retail-webhook.ts')), 'order emails use the shared brand (with the logo)');
const chrome = src('src/components/shop/ShopChrome.tsx') + src('src/components/shop/designer/SiteLook.tsx');
ok(!/\{\/\*/.test(chrome) && !/call us/i.test(chrome) && !/colour/i.test(chrome) && !/Claude|Anthropic/.test(chrome), 'no JSX comments, no "call us", US spelling, nothing about tools');

// ── the independent review's findings
const chromeSrc = src('src/components/shop/ShopChrome.tsx');
ok(/const onPhone = minimal \? 'hidden' : '';/.test(chromeSrc), 'the menu (wholesale access, categories, printable catalog) is there at every width');
ok(!brandFromTenant({ businessName: 'Opal', logoUrl: 'https://cdn/l.png', retailSettings: { shopTheme: { brand: '#f5e9d8' }, shopBrand: { show: 'name' } } }).logoUrl, '"Name" in the designer means no logo in emails either');
const quoted = brandedEmail({ shopName: 'The "Nail" Bar', brandColor: '#f5e9d8', logoUrl: 'https://cdn/l.png', show: 'mark' }, '<p>x</p>');
ok(quoted.includes('alt="The &quot;Nail&quot; Bar"'), 'the shop name is escaped in the email');
ok(brandOf({ logoUrl: 'https://cdn/a.png" onerror="x' }).logoUrl === '' && brandOf({ logoUrl: 'https://cdn/a b.png' }).logoUrl === '', 'a logo address that could break out of its tag is refused');
ok(/\.cf-shop \.bg-muted\\\/5 \{ background-color: var\(--shop-surface, #fff\); \}/.test(src('src/app/globals.css')) && !/text-neutral-900/.test(src('src/app/shop/[tenantId]/offer/[offerId]/page.tsx')), 'dark presets: pages take the shop’s background, not white');
ok(/hideAnnouncement=\{wholesale\}/.test(src('src/app/shop/[tenantId]/page.tsx')) && !/shop\.announcement && !wholesale/.test(src('src/app/shop/[tenantId]/page.tsx')) && /site\.announcement && !hideAnnouncement/.test(chromeSrc), 'one announcement rule for every layout and page, hidden from wholesale buyers');
ok(/active === 'home' \? <h1/.test(chromeSrc), 'the home page’s main heading is the shop’s name');
ok(/React\.useId\(\)/.test(src('src/components/shop/designer/SiteLook.tsx')) && / inert>/.test(src('src/components/shop/designer/SiteLook.tsx')), 'designer controls are named; the preview can’t be tabbed into');
ok(/document\.images/.test(src('src/app/print/packing-slip/[tenantId]/[orderId]/page.tsx')), 'the slip prints once its logo has loaded');
ok(/lg:top-32/.test(src('src/components/shop/offers.tsx')), 'the offer side panel clears the taller headers');
ok(/<ShopHeader minimal \/>/.test(src('src/app/shop/[tenantId]/page.tsx')), 'a paused shop shows just its logo');
ok(/brand\.logoUrl !== startLogo/.test(src('src/app/(app)/retail-orders/designer/page.tsx')), 'saving the designer never copies an older shop-only logo over the business logo');
ok(/activeCategory=\{activeCategory\}/.test(chromeSrc) && /active !== 'catalog'/.test(chromeSrc), 'the menu highlights the category; the catalog has one search box');
ok(/min-h-\[44px\]/.test(chromeSrc) && /<nav aria-label=\{title\}/.test(chromeSrc) && /h-11 w-11 rounded-xl shrink-0/.test(src('src/components/shop/ShopMenu.tsx')), 'footer links and the menu button are 44 px, in named navs');

ok(/flex min-w-0 items-center lg:shrink-0/.test(src('src/components/shop/ShopChrome.tsx')), 'long shop names truncate on phones instead of pushing the bag off the screen (second review)');
ok(/\[data-shop-theme\] \.bg-neutral-50 \{/.test(src('src/app/globals.css')) && /\[data-shop-theme\] :is\(\.text-neutral-500, \.text-neutral-600\)/.test(src('src/app/globals.css')), 'the box panel and its small print follow dark presets (second review)');
ok(/setTrade\(!!readWholesaleCode/.test(src('src/components/shop/ShopChrome.tsx')) && /<span className="line-clamp-2">\{site\.announcement\}/.test(src('src/components/shop/ShopChrome.tsx')), 'wholesale buyers never see the announcement; it takes at most two lines (second review)');
ok(/<h1[^>]*>Restocking in progress<\/h1>/.test(src('src/app/shop/[tenantId]/page.tsx')) && /Sent by \$\{esc\(brand\.shopName\)\}/.test(src('src/lib/email-shell.ts')), 'the paused page has its heading; the email escapes the name everywhere (second review)');

console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
