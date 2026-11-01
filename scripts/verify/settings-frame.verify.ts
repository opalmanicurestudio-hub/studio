// scripts/verify/settings-frame.verify.ts — Settings is one list of eleven groups and their pages (lib/settings-registry),
// shown on the left on a computer and as groups then pages on a phone, with only the tools a business uses.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/settings-frame.verify.ts
import fs from 'fs';
import { SETTINGS_GROUPS, visibleGroups, settingsPageAt, isSettingsPath, searchPages } from '../../src/lib/settings-registry';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// The list itself
ok(SETTINGS_GROUPS.map((g) => g.title).join('|') === 'Your business|Bookings|Changes and exceptions|Check-in and visits|Client messages|Payments|Shop|Team and approvals|Rooms and cleaning|Automations|Your tools', 'eleven groups, named for the decisions an owner makes, in order');
const all = SETTINGS_GROUPS.flatMap((g) => g.pages.map((p) => ({ g, p })));
ok(new Set(all.map(({ g, p }) => g.id + '/' + p.id)).size === all.length, 'every page has its own id');
ok(new Set(all.map(({ p }) => p.href)).size === all.length, 'no two pages lead to the same place');
ok(all.every(({ p }) => p.title && p.meaning && !/[A-Z]{3,}/.test(p.title)), 'every page has a plain name and a line saying what it’s for');

// Every page leads somewhere that exists
const route = (href: string) => {
  const path = href.split(/[?#]/)[0];
  const dirs = ['src/app/(app)' + path, 'src/app' + path];
  return dirs.some((d) => fs.existsSync(d + '/page.tsx'));
};
const missing = all.filter(({ p }) => !route(p.href)).map(({ p }) => p.href);
ok(missing.length === 0, `every page’s address exists${missing.length ? ': missing ' + missing.join(', ') : ''}`);
const tabs = all.map(({ p }) => p.href.match(/[?&]tab=([a-z]+)/)?.[1]).filter(Boolean) as string[];
const settingsPage = src('src/app/(app)/settings/page.tsx');
ok(tabs.every((t) => settingsPage.includes(`value="${t}"`)), 'every Settings tab a page points to is a real tab');
const bySettings = all.filter(({ p }) => p.href.startsWith('/settings/') && !p.href.startsWith('/settings?'));
ok(bySettings.every(({ p }) => fs.existsSync('src/app/(app)' + p.href.split(/[?#]/)[0] + '/page.tsx')), 'every /settings page exists');

// Only the tools a business uses
const everyTool = visibleGroups({});
ok(everyTool.length === 11, 'a business with every tool sees all eleven groups');
const noShop = visibleGroups({ modules: { retail: false } });
ok(!noShop.some((g) => g.id === 'shop') && !noShop.flatMap((g) => g.pages).some((p) => p.id === 'replies'), 'without the shop, the Shop group and ready replies never show');
const few = visibleGroups({ modules: { booth_rental: false, academy: false, hospitality: false, voice: false, kiosk: false, team: false, marketing: false } });
ok(!few.flatMap((g) => g.pages).some((p) => ['booths', 'academy', 'hosting', 'voice', 'kiosk', 'clock', 'referrals'].includes(p.id)), 'pages for tools a business doesn’t use never show');
ok(few.every((g) => g.pages.length > 0), 'an empty group never shows');

// Where am I
const at = (p: string, t: string | null = null) => { const r = settingsPageAt(p, t); return r ? `${r.group.id}/${r.page.id}` : null; };
ok(at('/settings', 'payments') === 'payments/payouts' && at('/settings', 'profile') === 'business/details', 'a Settings tab is found as its page');
ok(at('/settings') === null, 'Settings home is no page in particular');
ok(at('/retail-orders/policies/delivery') === 'shop/ways' && at('/retail-orders/policies') === 'shop/returns' && at('/retail-orders/policies/pickup') === 'shop/pickup', 'shop pages are found by their own address, the longest match winning');
ok(at('/settings/booking') === 'bookings/how', 'a page with two parts on one address opens on its first');
ok(at('/settings/policies') === 'changes/cancellations' && settingsPageAt('/settings/policies', null, '#privacy')?.page.id === 'privacy', 'Cancellations and Privacy share an address: the #part decides, and without one it’s Cancellations');
ok(settingsPageAt('/settings/booking', null, '#design')?.page.id === 'page', '“Booking page” is marked when its #part is open');
const self = all.filter(({ p }) => p.inShell !== false).filter(({ p }) => { const tab = p.href.match(/[?&]tab=([a-z]+)/)?.[1] || null; const hash = p.href.includes('#') ? '#' + p.href.split('#')[1] : ''; return settingsPageAt(p.href.split(/[?#]/)[0], tab, hash)?.page.id !== p.id; }).map(({ p }) => p.id);
ok(self.length === 0, `every page in Settings is marked as itself when it’s open${self.length ? ': not ' + self.join(', ') : ''}`);
const hashMiss = all.filter(({ p }) => p.href.includes('#')).filter(({ p }) => { const [path, h] = p.href.split('#'); const f = 'src/app/(app)' + path + '/page.tsx'; return !fs.existsSync(f) || !src(f).includes(`id="${h}"`); }).map(({ p }) => p.href);
ok(hashMiss.length === 0, `every #part a page points to exists on its page${hashMiss.length ? ': missing ' + hashMiss.join(', ') : ''}`);
ok(at('/settings/automations') === 'auto/all' && at('/settings/roles') === 'team/roles', 'other settings pages are found');
ok(isSettingsPath('/settings') && isSettingsPath('/settings/group/shop') && isSettingsPath('/retail-orders/policies/delivery') && isSettingsPath('/referrals/settings'), 'Settings opens with its list on settings pages, including shop settings that live elsewhere');
ok(!isSettingsPath('/retail-orders') && !isSettingsPath('/retail-orders/wholesale') && !isSettingsPath('/reviews') && !isSettingsPath('/dashboard') && !isSettingsPath('/settingsx'), 'and never on the app’s working pages');

// Search
ok(searchPages({}, 'delivery')[0]?.page.id === 'ways', 'searching “delivery” finds Ways to get an order first');
ok(searchPages({}, 'digital').some((h) => h.page.id === 'digital') && searchPages({}, 'pickup').some((h) => h.page.id === 'pickup'), '“digital” and “pickup” find their pages');
ok(searchPages({}, 'who sees what').some((h) => h.page.id === 'roles'), 'everyday words work: “who sees what” finds Roles and access');
ok(searchPages({ modules: { retail: false } }, 'delivery').length === 0, 'search never shows a tool the business doesn’t use');
ok(searchPages({}, 'd').length === 0, 'one letter isn’t a search');

// Wiring
const layout = src('src/app/(app)/layout.tsx');
ok(layout.includes('const inSettings = useInSettings();') && layout.includes("<div className={inSettings ? 'contents lg:hidden' : 'contents'}><AppSidebar /></div>") && layout.includes('{onSettingsPath ? <SettingsShell nav={inSettings}>{children}</SettingsShell> : children}') && layout.includes('<Framed>{children}</Framed>'), 'on a computer, Settings takes the app sidebar’s place with its own list; on a settings address the page keeps one wrapper while the role loads, so it never remounts');
const place = src('src/components/settings/settings-place.ts');
ok(/if \(pathname === '\/settings' \|\| pathname\.startsWith\('\/settings\/'\)\) return true;\s*return role == null \|\| role === 'owner' \|\| role === 'admin' \|\| role === 'manager';/.test(place), 'shop settings that live outside /settings open inside Settings for an owner, admin or manager; other staff see the app as usual');
ok(src('src/components/shared/AppHeader.tsx').includes("inSettings && 'lg:hidden'") && src('src/components/ui/sidebar.tsx').includes('if (!isMobile && document.querySelector("[data-settings-nav]")) return'), 'beside the Settings list, the sidebar toggle isn’t shown and its shortcut does nothing');
ok(src('src/app/(app)/settings/page.tsx').includes("React.useEffect(() => { setActiveTab(tabParam || 'profile'); }, [tabParam]);"), 'moving between two Settings tabs from the list shows the tab you picked');
ok(src('src/components/settings/settings-ui.tsx').includes('const back = useSettingsBack();') && src('src/app/(app)/settings/page.tsx').includes('useSettingsBack(undefined, activeTab)') && place.includes('`/settings/group/${g.id}`'), 'on a phone, a page’s way back goes to its group');
ok(['Alerts', 'Capacity', 'Discovery', 'Offers', 'Policies', 'Delivery', 'PickupTimes', 'ShippingSchedule'].every((n) => { const f = src(`src/components/orders/${n}Screen.tsx`); return (f.includes('<ShopBack look=') || f.includes('<ShopBackRow />')) && !/<Link href="\/retail-orders\/(setup|settings|policies)"/.test(f); }) && src('src/components/orders/shell.tsx').includes('if (inSettings) return null;') && ['Alerts', 'Capacity'].every((n) => src(`src/components/orders/${n}Screen.tsx`).includes('<ShopBackRow />')) && src('src/components/orders/shell.tsx').includes("'flex items-center justify-between gap-2' + (back.inSettings ? ' lg:hidden' : '')"), 'shop settings inside Settings go back to the Shop group (hidden beside the list) and drop the shop’s tab bar');
ok(['src/app/(app)/retail-orders/settings/page.tsx', 'src/app/(app)/retail-orders/designer/page.tsx'].every((f) => src(f).includes("useSettingsBack({ href: '/retail-orders', label: 'Online orders' })") && src(f).includes('href={back.href}')) && src('src/components/settings/RepliesScreen.tsx').includes('<AppHeader title="Settings" />') && src('src/components/settings/RepliesScreen.tsx').includes('href={back.href}'), 'Shop basics, Shop design and Ready replies have the same way back');
ok(src('src/app/(app)/referrals/settings/page.tsx').includes("useSettingsBack({ href: '/referrals', label: 'Referrals' })") && src('src/app/(app)/referrals/settings/page.tsx').includes('href={back.href}'), 'Referral settings has a way back to Your tools on a phone');
ok(place.includes('export function mayLeave()') && ['DeliveryScreen', 'PickupTimesScreen'].every((n) => src(`src/components/orders/${n}.tsx`).includes('setLeaveGuard(() => !dirtyRef.current || window.confirm(') && src(`src/components/orders/${n}.tsx`).includes('setLeaveGuard(null)')) && (src('src/components/settings/SettingsShell.tsx').match(/onClick=\{guard\(/g) || []).length === 5 && src('src/components/settings/SettingsShell.tsx').includes("if (e.key === 'Enter' && hits[0] && mayLeave())"), 'unsaved edits on Delivery or Pickup times are asked about before any link in the Settings list leaves the page');
ok((src('src/components/settings/SettingsShell.tsx').match(/\[@media\(pointer:coarse\)\]:min-h-11/g) || []).length === 4, 'on a touch screen wide enough for the list (an iPad), every link in it is 44px tall');
ok(settingsPageAt('/settings/roles', 'profile')?.page.id === 'roles' && settingsPageAt('/settings/booking', 'payments')?.page.id === 'how', 'a ?tab= on another settings page never turns it into a tab page');
ok(src('src/app/(app)/settings/page.tsx').includes("['payments', 'terminal'], ['policies']") && src('src/app/(app)/settings/page.tsx').includes('className="flex flex-wrap gap-2 lg:hidden"'), 'the related-settings chips on a phone match the list’s groups (and step aside for the list on a computer)');
ok(src('src/components/settings/settings-style.tsx').includes('.cf-settings :focus-visible:not(.rounded-full){border-radius:12px}') && src('src/components/settings/settings-style.tsx').includes('hover\\\\:bg-accent:hover') && !src('src/components/referrals/ReferralsSettings.tsx').includes('hsl(var(--card))'), 'inside Settings, round controls keep a round focus ring, ghost buttons keep their hover, and the referral menu keeps its selected background');
ok(place.includes("window.addEventListener('popstate', f)") && place.includes('settingsPageAt(pathname, tab, hash)'), 'the way back from Privacy goes to Your business, not to the page it shares an address with');
ok(src('src/components/shared/AppSearch.tsx').includes('(selectedTenant ? visibleGroups(selectedTenant) : [])'), 'the header search waits for the business before listing groups');
ok(src('src/app/(app)/settings/map/page.tsx').includes("redirect('/settings')"), 'Quick settings is Settings now: old links land there');
const shell = src('src/components/settings/SettingsShell.tsx');
ok(shell.includes('Back to the app') && shell.includes('aria-current') && /<React\.Suspense fallback=\{<div [^}]*\/>\}><SettingsNav \/><\/React\.Suspense>/.test(shell) && (shell.match(/useSearchParams\(\)/g) || []).length === 2 && /function useHash[\s\S]*useSearchParams\(\)[\s\S]*function SettingsNav[\s\S]*useSearchParams\(\)[\s\S]*useHash\(\)/.test(shell), 'the list has Back to the app, marks where you are, and reads the address inside Suspense');
ok(shell.includes('className="cf-settings sticky') && shell.includes('className="cf-settings min-w-0 flex-1 outline-none"') && shell.includes('<SettingsStyle />') && src('src/components/settings/SettingsHome.tsx').includes('className="cf-settings min-h-full"') && src('src/app/(app)/settings/group/[group]/page.tsx').includes('className="cf-settings min-h-full"'), 'the list, Settings home and a group page use the Settings colors, so dark mode and hover work');
ok(shell.includes('Skip to the page') && shell.includes("onClick={(e) => { e.preventDefault(); const el = document.getElementById('settings-page'); el?.focus();") && shell.includes('id="settings-page"') && shell.includes('role="img" aria-label="Opens a page of the app"') && shell.includes('aria-live="polite"'), 'keyboard and screen reader: a skip link past the list, arrows read out, search results announced');
ok(shell.includes('selectedTenant ? visibleGroups(selectedTenant) : []') && src('src/components/settings/SettingsHome.tsx').includes('tenant ? visibleGroups(tenant) : []'), 'no flash of every group before the business loads');
const home = src('src/components/settings/SettingsHome.tsx');
ok(home.includes('visibleGroups(tenant)') && !home.includes('SETTINGS_INDEX') && !home.includes('Pick your booking page design'), 'Settings home lists the eleven groups (and no longer asks to pick a page design)');
ok(src('src/components/shared/AppSearch.tsx').includes('visibleGroups(selectedTenant)'), 'the header search reads the same list');
ok(fs.existsSync('src/app/(app)/settings/group/[group]/page.tsx'), 'a group opens its pages (the phone’s step between Settings and a page)');
const files = ['src/lib/settings-registry.ts', 'src/components/settings/SettingsShell.tsx', 'src/components/settings/SettingsHome.tsx', 'src/app/(app)/settings/group/[group]/page.tsx', 'src/components/settings/settings-place.ts'];
ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no JSX comments');
const shown = (f: string) => src(f).replace(/words: '[^']*'/g, '');
ok(files.every((f) => !/colour|organis|favourite|\bgrey\b|cancell(?!ation)|travell|labell|modell|behaviour|centre\b|licence/i.test(shown(f))), 'US spelling (search words may include other spellings so they still find the page)');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
