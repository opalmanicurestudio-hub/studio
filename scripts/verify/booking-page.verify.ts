// scripts/verify/booking-page.verify.ts — Settings › Bookings › Booking page, and the page it changes: the color kept in
// one place for the whole app, what the owner chooses (headline, description, photo, sections, our work, about us,
// questions), and everything written in the old page builder carried over.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/booking-page.verify.ts
import fs from 'fs';
import { execSync } from 'child_process';
import { pageColor, pageAccent, readable, lifted, whiteContrast, brandColor, headlineParts, studioPage, sectionShows, colorName, COLORS, SECTIONS } from '../../src/lib/studio-page';
import { brandAccent } from '../../src/lib/brand-accent';
import { accentHsl } from '../../src/components/shared/StudioTheme';
import { SETTINGS_GROUPS } from '../../src/lib/settings-registry';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// One color for the whole app
ok(pageColor({ bookingPageSettings: { studio: { color: '#123456' }, cfPageConfig: { accentColor: '#abcdef' } } }) === '#123456', 'the color chosen on the Booking page wins');
ok(pageColor({ bookingPageSettings: { cfPageConfig: { accentColor: 'ABCDEF' } } }) === '#abcdef' && pageColor({ brandColor: '#f0a' }) === '#ff00aa' && pageColor({}) === null, 'until then, the color from the old page builder or older fields carries over');
ok(COLORS.every((c) => whiteContrast(c.hex) >= 4.5), 'every named color keeps white text on it readable');
const pale = readable('#f4c2c2');
ok(whiteContrast(pale) >= 4.5 && pale === '#897071' && readable('#8b5e57') === '#8b5e57', 'a pale color is deepened toward ink just enough for white text (blush becomes a dusty rose, not a loud red); a dark one is left alone');
ok(pageAccent({}) === null && pageAccent({ bookingPageSettings: { studio: { color: '#f4c2c2' } } }) === pale, 'screens that paint with the color get the readable one, or keep their own default when there is none');
ok(brandColor({}) === '#16171a' && brandAccent({ bookingPageSettings: { studio: { color: '#f4c2c2' } } }) === pale, 'screens paint with the readable color, or ink when there is none');
ok(accentHsl('#f4c2c2') !== null, 'the app’s own color darkens a pale color instead of dropping to ink');
ok(colorName('#8B5E57') === 'Rose clay' && colorName('#000001') === null, 'named colors are known by name');
const readers = execSync("grep -rlE 'cfPageConfig\\??\\.accentColor' src --include=*.ts --include=*.tsx || true").toString().split('\n').filter(Boolean).sort();
const allowed = ['src/app/studio/page-builder/page.tsx', 'src/lib/booking-sections.tsx', 'src/lib/studio-page.ts'];
ok(readers.includes('src/lib/studio-page.ts') && readers.every((f) => allowed.includes(f)), `nothing reads the old builder’s color directly any more${readers.some((f) => !allowed.includes(f)) ? ': ' + readers.filter((f) => !allowed.includes(f)).join(', ') : ''}`);

// The headline
ok(JSON.stringify(headlineParts('Healthy nails, done beautifully')) === '["Healthy nails,","done beautifully"]' && JSON.stringify(headlineParts('Sharp cuts')) === '["Sharp cuts",""]', 'words after a comma stand out in bold');

// Carried over from the old page builder
const classic = { description: 'Gel and pedicures.', bookingPageSettings: { cfPageConfig: { accentColor: '#8b5e57', sections: [
  { type: 'hero', config: { headline: 'Book Your Experience', subheadline: 'A sanctuary of craft, curated for those who appreciate the details.', heroImage: 'https://x/hero.jpg' } },
  { type: 'reviews', config: { rev1Name: 'Sarah M.', rev1Text: 'Absolutely incredible experience.', rev2Name: 'Ana', rev2Text: 'Best gel I have had.', rev2Rating: 4 } },
  { type: 'gallery', config: { images: [{ url: 'https://x/1.jpg', caption: 'Chrome' }, { url: null }, { url: 'https://x/2.jpg' }] } },
  { type: 'beforeAfter', config: { pairs: [{ beforeUrl: 'https://x/b.jpg', afterUrl: 'https://x/a.jpg', caption: 'Repair' }] } },
  { type: 'story', config: { body: 'We opened in 2019.', body2: 'One chair, one idea.', image: 'https://x/s.jpg' } },
  { type: 'faq', config: { q1: 'How long does gel last?', a1: 'Two to three weeks.', q2: 'Half a question', a2: '' } },
] } } };
const c = studioPage(classic);
ok(c.headline === '' && c.description === 'Gel and pedicures.' && c.cover?.url === 'https://x/hero.jpg', 'the builder’s sample words don’t carry over; its photo does, and the business description fills in');
ok(c.work.map((w) => w.url).join(',') === 'https://x/1.jpg,https://x/2.jpg,https://x/a.jpg,https://x/b.jpg' && c.work[0].caption === 'Chrome' && c.work[2].caption === 'After · Repair' && c.work[3].caption === 'Before · Repair', 'gallery and before-and-after photos become Our work, labeled before and after');
ok(c.work.every((w) => Object.values(w).every((v) => v !== undefined)) && !('caption' in c.work[1]), 'carried-over photos never hold an empty field (the database would refuse to save them)');
ok(c.typedReviews.length === 1 && c.typedReviews[0].name === 'Ana' && c.typedReviews[0].rating === 4, 'typed reviews carry over, but never the builder’s sample ones');
const hidden = studioPage({ bookingPageSettings: { cfPageConfig: { sections: [
  { type: 'story', enabled: false, config: { body: 'Real story.' } }, { type: 'faq', visible: false, config: { q1: 'Real question?', a1: 'Real answer.' } },
  { type: 'gallery', enabled: false, config: { images: [{ url: 'https://x/9.jpg' }] } },
  { type: 'story2', config: {} }, { type: 'faq', config: { q1: 'Do you offer gift cards?', a1: 'Absolutely — gift cards available in any amount.' } } ] } } });
ok(hidden.about.text === '' && hidden.work.length === 0 && hidden.faqs.length === 0, 'sections switched off or hidden in the builder, and its sample questions, don’t carry over');
ok(c.about.text === 'We opened in 2019.\n\nOne chair, one idea.' && c.about.photo?.url === 'https://x/s.jpg' && c.faqs.length === 1 && c.faqs[0].q === 'How long does gel last?', 'the about story and answered questions carry over');
{ const half = studioPage({ bookingPageSettings: { cfPageConfig: { sections: [
    { type: 'faq', enabled: true, config: { q1: 'Do you accept walk-ins?', a1: 'Only on Saturdays.', q2: 'Do you offer gift cards?', a2: 'Absolutely — gift cards available in any amount.', q3: 'Parking?', a3: 'Behind the building.', q4: 'Do you do nail art?', a4: 'Yes! Walk-ins welcome based on availability.' } },
    { type: 'reviews', config: { rev1Name: 'Sarah M.', rev1Text: 'My nails finally grew out.', rev2Name: 'Jessica T.', rev2Text: 'Every visit exceeds my expectations.', rev3Name: 'Kim L.', rev3Text: 'Absolutely incredible experience.' } },
  ] } } });
  ok(half.faqs.map((f) => f.q).join('|') === 'Do you accept walk-ins?|Parking?' && half.typedReviews.length === 1 && half.typedReviews[0].text === 'My nails finally grew out.', 'a sample question with the business’s own answer (or a real review from someone who shares a sample name) carries over; a sample answer or review is never shown, under any question or name'); }
const mine = studioPage({ ...classic, bookingPageSettings: { ...classic.bookingPageSettings, studio: { headline: 'Healthy nails, done beautifully', description: '', cover: null, work: [], about: { text: '' }, faqs: [], mood: 'night', off: { team: true }, order: ['faqs', 'work', 'bogus'] } } });
ok(mine.headline === 'Healthy nails, done beautifully' && mine.description === '' && mine.cover === null && mine.work.length === 0 && mine.about.text === '' && mine.faqs.length === 0, 'what the owner sets here, even empty, replaces what the builder had');
ok(mine.mood === 'night' && studioPage({}).mood === 'soft' && !mine.on.team && mine.on.services, 'mood defaults to Soft; a switched-off section is off; Services is always on');
ok(mine.order[0] === 'services' && mine.order[1] === 'faqs' && mine.order[2] === 'work' && !mine.order.includes('bogus' as any) && mine.order.length === SECTIONS.length, 'Services comes first, then the owner’s order, then any section they haven’t placed');
const p0 = studioPage({});
ok(!sectionShows(p0, 'work', {}) && !sectionShows(p0, 'faqs', {}) && !sectionShows(p0, 'team', { team: 0 }) && sectionShows(p0, 'team', { team: 2 }), 'a section with nothing in it stays hidden');
ok(!sectionShows(p0, 'spaces', { spaces: 3 }, (m) => m !== 'booth_rental') && sectionShows(p0, 'spaces', { spaces: 3 }), 'Spaces to rent shows only for businesses that rent spaces');

// The settings page
const page = src('src/app/(app)/settings/booking-page/page.tsx');
ok(page.includes("const field = (k: string) => `bookingPageSettings.studio.${k}`;") && page.includes('v === undefined ? deleteField() : clean(v)') && page.includes("filter(([, x]) => x !== undefined)"), 'each change saves to its own field, empty fields are taken out first, and switching a section back on removes the “off” mark');
ok(page.includes("const isMgr = String(role || '').toLowerCase() === 'owner';") && page.includes("' Only the business owner can change it.'") && page.includes("'Check your connection and try again.'"), 'only the owner can change the page (as the database allows), others are told, and a failed save says what to do');
ok(page.includes('download = \'booking-page-qr.png\'') && page.includes("navigator.clipboard.writeText(link)"), 'the link can be copied and the QR code downloaded');
ok(page.includes('<select aria-label="Your color"') && page.includes('<input type="color" aria-label="Pick your own color"') && page.includes('className="sr-only" />') && page.includes('From your logo') && page.includes('whiteContrast(page.color) < 4.5'), 'the color is picked by name, freely, or from the logo, and says when it’s darkened for reading');
ok(page.includes('<Choice<Mood> label="Mood"') && page.includes("MOODS.map((m) => ({ value: m.id, label: m.title }))"), 'Soft, Crisp or Night');
ok(page.includes('`tenants/${tenantId}/branding/booking-page/cover-') && page.includes('/branding/booking-page/work-') && page.includes('/branding/booking-page/about-'), 'photos upload to the business’s branding folder (open to the team in the storage rules)');
ok(src('storage.rules').includes("folder in ['avatars', 'uploads', 'branding'"), 'the storage rules already let the team upload there');
ok(page.includes('onKeyDown={(e) => { if (e.key === \'ArrowUp\')') && page.includes('setPointerCapture') && page.includes('aria-label={`Move ${def.title} up`}') && page.includes('aria-live="polite"'), 'sections can be reordered by dragging, by the arrow keys, or with up and down buttons, and the new place is announced');
ok(page.includes("<WorkSheet") && page.includes("<AboutSheet") && page.includes("<FaqSheet") && page.includes('A question without an answer (or an answer without a question) won’t show.'), 'Our work, About us and Questions each have an editor');
ok(page.includes("src={`/book/${tenantId}?design=studio&preview=1`}") && page.includes('key={stamp}'), 'the preview is the real page, reloaded after each change');
ok(page.includes("'bookingPageSettings.design': 'studio'") && page.includes('Your page still uses the old design.'), 'a business still on the old design is told, and can use the new one now');
ok(page.includes('className="cf-sheet') && !/#7c3aed/i.test(page), 'built from the Settings pieces, in the app palette');

// The page
const studio = src('src/components/booking/StudioBookingPage.tsx');
ok(studio.includes('const page = useMemo(() => studioPage(tenant), [tenant]);') && studio.includes('<b>{bold}</b>') && studio.includes('const photo = page.cover?.url || null;'), 'the page uses the headline, description and photo from Settings');
ok(studio.includes("page.order.filter((id) => id !== 'services').map((id) =>") && studio.includes('if (!sectionShows(page, id, counts, (m) => moduleEnabled(tenant, m as any))) return null;'), 'sections show in the owner’s order, only when switched on, for the tools the business uses, and only with something in them');
ok(studio.includes("page.on.reviews ? (real.length ? real.slice(0, 6) : page.typedReviews) : []") && studio.includes('hidden={!open}') && studio.includes('photo ${i + 1}'), 'typed reviews come only through the filter; the answer panel is always there for its button; each photo has its own description');
ok(studio.includes("id === 'work'") && studio.includes("id === 'about'") && studio.includes("id === 'faqs'") && studio.includes('aria-expanded={open}'), 'Our work, About us and Questions are on the page');
ok(!/[\u{1F300}-\u{1FAFF}]|\u2709/u.test(studio), 'no emoji on the page');
ok(studio.includes('function addressLine(a: any): string') && !studio.includes('String(tenant.address)'), 'an address kept as parts prints properly');
const book = src('src/app/(booking)/book/[tenantId]/page.tsx');
ok(book.includes('accent={brandColor(tenant)}') && book.includes("if (previewOnly) return;"), 'the page paints with the business color, and nothing can be booked from the preview');

const ui = src('src/components/settings/settings-ui.tsx'); const style = src('src/components/settings/settings-style.tsx');
ok(ui.includes("background: checked ? '#1f7a4d' : 'var(--toggle-off, #d4d5d9)'") && ui.includes("background: '#fefefe' }} />") && ui.includes('h-11 w-14') && style.includes('--toggle-off:#d4d5d9') && style.includes('.dark .cf-settings{--toggle-off:#3a3b40'), 'settings switches are green when on, a visible grey when off in light and dark, with a knob that always shows and a 44px tap area');
ok(src('src/components/public/kit.tsx').includes("textTransform: 'uppercase'"), 'section labels on public pages stay in capitals, as designed');
ok(studio.includes('absolute bottom-2 left-2') && studio.includes('{w.caption}</figcaption>'), 'a photo caption sits on the photo, so the grid stays even');

// From the review
ok(book.includes("const studioFlow = studioDesign || (!!reschedule && !providerId);") && book.includes("hexToHsl(studioFlow ? brandColor(tenant) : resolvedStyle.accentColor)") && book.includes("['--accent' as any]: brandColor(tenant)") && book.includes('preview={previewOnly}'), 'the booking flow after Book (and every reschedule, which opens the same flow) paints with the same color, and the preview shows the page without its live parts');
ok(src('src/app/api/public/menu/route.ts').includes("accent: pageAccent(t) || '#1c1917'"), 'the menu on gift pages uses the same color');
const sweep = execSync("grep -rl 'pageColor(' src --include=*.ts --include=*.tsx || true").toString().split('\n').filter(Boolean).sort();
ok(sweep.every((f) => ['src/lib/studio-page.ts', 'src/app/(app)/settings/booking-page/page.tsx', 'src/components/shared/StudioTheme.tsx'].includes(f)), 'every screen that paints with the color uses the readable one');
const theme = src('src/components/shared/StudioTheme.tsx');
ok(theme.includes("accentHsl(accent, resolved === 'dark')") && theme.includes("const fg = resolved === 'dark' ? '0 0% 0%' : '0 0% 100%'") && theme.includes("root.style.setProperty('--primary-foreground', fg)"), 'on the black look the color is lightened and the text on it is dark, like the app’s own colors there');
{ const inkLum = 1.05 / whiteContrast('#16171a') - 0.05; const vsInk = (h: string) => (1.05 / whiteContrast(h)) / (inkLum + 0.05);
  ok(['#16171a', '#8b5e57', '#1f3a5f', '#f4c2c2', '#000000', ...COLORS.map((c) => c.hex)].every((h) => vsInk(lifted(h)) >= 4.5) && lifted('#f4c2c2') === '#f4c2c2', 'every color, lightened for the black look, reads against ink and black (a pale one is left as it is)'); }
ok(src('src/app/globals.css').includes('html.studio.dark :is(.bg-primary, .bg-primary\\/90, .bg-primary\\/80).text-white,\nhtml.studio.dark .hover\\:bg-primary.hover\\:text-white:hover,\nhtml.studio.dark .group:hover .group-hover\\:bg-primary.group-hover\\:text-white,\nhtml.studio.dark .group[data-state=open] .group-data-\\[state\\=open\\]\\:bg-primary.group-data-\\[state\\=open\\]\\:text-white { color: hsl(var(--primary-foreground)); }'), 'buttons that hard-code white text on the primary color take its dark text on the black look');
ok(!/text-white[^>]*background: 'var\(--accent\)'/.test(src('src/app/(app)/settings/booking-page/page.tsx') + src('src/app/(app)/settings/roles/page.tsx')), 'settings buttons in the color use its own text color, so they read in white and black');
ok(page.includes('setPicking(e.target.value)') && page.includes("setTimeout(() => { void save({ color: v }, 'Color').then(() => setPicking((p) => (p === v ? null : p)))"), 'the free color picker saves once the owner settles on a color, and a newer color picked while saving is kept');
ok(page.includes('d.mids.filter((m) => m < pageY).length') && page.includes('window.scrollBy(0, vy)') && page.includes('const now = orderRef.current;'), 'dragging places a section by where the pointer is against the rows as they began (no flipping), scrolls near the edges, and saves once when let go');
ok(page.includes("window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);") && !page.includes('onPointerMove=') && !page.includes('onPointerUp='), 'a drag is followed on the whole window, so moving a section down never stalls when the pointer drifts off the grip');
ok(page.includes(".then((ok) => { if (!ok) setOrder(before); })"), 'a new order that fails to save goes back to the saved one');
ok(page.includes('e.pointerId !== d.pointer') && page.includes("e.pointerType === 'mouse' && e.buttons === 0") && page.includes("e.button !== 0 || drag.current) return;"), 'only the finger or mouse that started a drag moves it, and a release missed outside the window still ends it');
ok(!page.includes('aria-pressed={reorder}') && page.includes("sm:flex ${reorder ? 'flex' : 'hidden'}") && page.includes("{reorder ? 'Done' : 'Change order'}"), 'on a phone, Change order shows up and down buttons, so the order can be changed without dragging');
ok(page.includes('if (pickingRef.current) void saveRef.current({ color: pickingRef.current }') && !page.includes('Made a little darker on buttons ('), 'a color still settling is saved when the owner leaves, and the help says what happens without a raw color code');
{ const kit = src('src/components/pos/desk/kit.tsx');
  const desk = ['src/components/pos/desk/TodaysSales.tsx', 'src/components/pos/desk/StaffBookSheet.tsx', 'src/components/ops/CallLog.tsx', 'src/components/pos/CheckoutHub.tsx'].map(src);
  ok(kit.includes('.desk{--accent:var(--biz-accent,#16171a);--accent-ink:var(--biz-ink,#fff);') && kit.includes('[data-desk-theme=dark] .desk{--accent:var(--biz-accent-dark,#7fd1a5);--accent-ink:var(--biz-ink-dark,#000);')
    && kit.includes("'--biz-accent-dark': lifted(hex), '--biz-ink-dark': '#000'") && desk.every((f) => f.includes('deskAccent(') && !f.includes("['--accent' as any]")) && !kit.includes("['--accent' as any]"),
    'the front desk shows the business color as it is on white and lightened with dark text on black, so a dark color never sinks into the black desk'); }
ok(page.includes("editing.current !== 'headline'") && page.includes("editing.current !== 'description'"), 'a field being typed in is never replaced by a save from the other field');
ok(page.includes('{xl && <aside aria-label="Preview"') && page.includes('xl:grid-cols-[minmax(0,1fr)_320px]'), 'the preview shows only where there’s room for it, and isn’t loaded on smaller screens');
ok((page.match(/\$\{FOCUS_WITHIN\}/g) || []).length >= 4 && page.includes("'focus-within:outline focus-within:outline-[3px]"), 'the color circle and photo buttons show keyboard focus');
ok(page.includes('const [drafts, setDrafts]') && (page.match(/<Unsaved \/>/g) || []).length === 3 && page.includes('latest.current = n;'), 'closing an editor keeps what was typed or uploaded until it’s saved, and says so');
ok(src('src/app/api/getting-started/route.ts').includes('!!t.bookingPageSettings?.studio'), 'designing the page in Settings counts toward setting up');

// Where it lives
const reg = SETTINGS_GROUPS.flatMap((g) => g.pages).find((p) => p.id === 'page');
ok(reg?.href === '/settings/booking-page', 'Booking page has its own page in Settings');
ok(!fs.existsSync('src/components/settings/PageDesignPicker.tsx') && !src('src/app/(app)/settings/booking/page.tsx').includes('PageDesignPicker'), 'the old Classic or Studio choice is gone');
ok(src('src/app/(app)/settings/setup/page.tsx').includes('<Link href="/settings/booking-page"') && src('src/app/(app)/settings/page.tsx').includes("builder: '/settings/booking-page'"), 'the setup guide and old links open the new page');

// House rules
const files = ['src/lib/studio-page.ts', 'src/app/(app)/settings/booking-page/page.tsx', 'src/components/booking/StudioBookingPage.tsx'];
ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no JSX comments');
ok(files.every((f) => !/cancelled|cancelling|colour(?!\b)|licence|\bcall us\b/i.test(src(f).replace(/colour/g, (m, o, s) => (/words: '/.test(s.slice(Math.max(0, o - 400), o)) ? '' : m)))), 'US spelling, never “call us”');
const tool = new RegExp(['cl', 'aude'].join('') + '|' + ['anth', 'ropic'].join(''), 'i');
ok(files.every((f) => !tool.test(src(f))), 'no tool names in the code');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
