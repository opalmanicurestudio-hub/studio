// Checks a way home from every page (components/shared/WayHome, app/(app)/layout): on a phone or a tablet (below
// 1024px, where the app's menu is folded away), a page with no header of its own gets the menu button and Home in the
// header's place; a page whose header carries the menu button (AppHeader) never shows it, not even for a moment; on a
// computer the menu is always showing, so it never shows there. The pages the app's frame doesn't hold each have their
// own way back. A page outside the app reached from it in the same tab (the pay calculator) offers the way back, and
// someone who came any other way never sees it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/way-home.verify.tsx
import fs from 'fs';
import path from 'path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as F from './fake-db';
import { BackToApp, WayHomeBar, WayHomeProvider } from '../../src/components/shared/WayHome';

const { check } = F;
const src = (f: string) => fs.readFileSync(f, 'utf8');
const way = src('src/components/shared/WayHome.tsx');
const layout = src('src/app/(app)/layout.tsx');

console.log('The bar');
check('drawn only once the page is on screen, so the server never sends it (nothing flashes before the page’s own header)', renderToString(<WayHomeProvider><WayHomeBar /></WayHomeProvider>) === '');
check('the menu button and Home, on a phone or a tablet only, never printed', /<SidebarTrigger aria-label="Open the menu" className="h-11 w-11/.test(way) && /<Link href=\{home\}/.test(way) && />\s*Home\s*<\/Link>/.test(way.replace(/<Home [^>]*\/>/, '')) && /lg:hidden print:hidden/.test(way));
const ok = /^\/(?![\\/])/;
check('the way back only to a page of this site: never //elsewhere or /\\elsewhere', ok.test('/retail-orders/waves?x=1') && !ok.test('//evil.example') && !ok.test('/\\evil.example') && !ok.test('https://evil.example'));
check('Home: the dashboard; the team app for a team-app sign-in; none on the host stand’s tablet', way.includes("const home = screen ? null : viaPortal ? (selectedTenant?.id ? `/staff-portal/${encodeURIComponent(String(selectedTenant.id))}` : null) : '/dashboard';") && /\{home && path !== home && \(\n\s*<Link href=\{home\}/.test(way));
const bar = way.slice(way.indexOf('export function WayHomeBar'), way.indexOf('export function BackToApp'));
check('drawn before the page is first shown, so nothing jumps down to make room', bar.includes('useBeforePaint(() => { setReady(true); }, []);') && !bar.includes('React.useEffect(() => { setReady(true); }, []);'));
check('the header’s height on a tablet too, so one swaps for the other without a shift', /flex h-14 items-center md:h-\[60px\]/.test(way) && /md:h-\[60px\]/.test(src('src/components/shared/AppHeader.tsx')));
check('44px to tap', /min-h-\[44px\]/.test(way) && /h-11 w-11/.test(way));
check('shaped like the header, where the header goes, and scrolling with the page (pages keep their own bar at the top)', /mx-3 mt-3 flex h-14 items-center md:h-\[60px\] gap-1 rounded-\[22px\] bg-card\/95/.test(way) && !/sticky/.test(way.match(/<nav [^>]*>/)![0]));
check('steps aside for a header that carries the menu button, decided before the page is first shown', /if \(!ready \|\| count > 0\) return null;/.test(way) && /React\.useLayoutEffect/.test(way) && /useBeforePaint\(\(\) => \(on && add \? add\(\) : undefined\), \[on, add\]\);/.test(way));

console.log('Where it goes');
check('every page the app’s frame holds gets it, ahead of the page', /<main id="main"><StaleCopyBanner \/><WayHomeBar \/><ToolGate>/.test(layout) && /<WayHomeProvider><Framed>\{children\}<\/Framed><\/WayHomeProvider>/.test(layout));
const header = src('src/components/shared/AppHeader.tsx');
check('the app’s header says it has the menu button, except where it isn’t drawn (inside a hub)', /useWayHome\(!inHub\);\n  if \(inHub\) return null;/.test(header));
check('so do the other headers with the button', /useWayHome\(\);/.test(src('src/components/shared/AppHeaderClient.tsx')) && /export function MobileSidebarTrigger\(\{ className \}: \{ className\?: string \}\) \{\n  useWayHome\(\);/.test(src('src/components/shared/AppSidebar.tsx')));
// (Every other menu button in the app is one of those: a new one has to say so too.)
const triggers: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name) && /<SidebarTrigger\b/.test(src(p))) triggers.push(p.replace(/\\/g, '/')); } };
walk('src');
check('every menu button is in a header that says so, or the bar itself (or the menu’s own, inside it)', triggers.every((f) => /useWayHome\(/.test(src(f)) || /WayHome\.tsx$/.test(f) || /ui\/sidebar\.tsx$/.test(f) || /AppSidebar\.tsx$/.test(f)), triggers);

console.log('The pages the frame doesn’t hold');
check('only HQ, choosing tools, a booking page and a printed slip are outside the frame', (layout.match(/pathname\.startsWith\('[^']+'\)/g) || []).sort().join() === ["pathname.startsWith('/admin')", "pathname.startsWith('/book')", "pathname.startsWith('/refunds/print/')", "pathname.startsWith('/subscriptions')"].sort().join());
check('HQ has its way back to the business', /href="\/dashboard"[^>]*>← My studio<\/Link>/.test(src('src/components/hq/hq.tsx')));
check('choosing tools has Back to the app (or Open the app)', /href="\/dashboard" className="text-sm text-foreground\/80">Back to the app<\/Link>/.test(src('src/app/(app)/subscriptions/page.tsx')));

console.log('Outside the app');
check('the way back is shown only to a tab that came from the app (so never to a client), and only to a page of the app', renderToString(<BackToApp />) === '' && /sessionStorage\.getItem\(LAST_PAGE\)/.test(way) && way.includes('if (v && /^\\/(?![\\\\/])/.test(v)) setTo(v);') && /sessionStorage\.setItem\(LAST_PAGE, `\$\{path\}\$\{window\.location\.search\}`\)/.test(way));
check('the pay calculator (opened from the menu in the same tab) offers it, not printed', /<BackToApp className="pc-noprint"/.test(src('src/components/paycalc/PayCalculator.tsx')));
check('the house style', !/\buppercase\b|font-black|\{\/\*| · /.test(way) && ![...way.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")));

console.log(F.failures ? `\n${F.failures} failed` : '\nAll passed');
process.exit(F.failures ? 1 : 0);
