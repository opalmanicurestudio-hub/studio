// Checks every screen in the menu (design board "Screens in the menu"): lib/screens, the menu's Guest pages and Screens
// groups (components/shared/AppSidebar), the search at the top, and the Screens page.
// - Screens are sorted by where they go; only the tools that are on show, and an area with nothing in it is left out.
// - A pickup-only drive-thru has no speaker and no order board; the rest of the lane's screens still show.
// - Each opens at its own address with the business's id (the client screen pairs with a code instead).
// - Guest pages (the business's own pages for guests' phones) are apart from the screens; order ahead and the rewards
//   page show only while they're on.
// - Managers and shift leads get the same Screens group, with their station screens; the search finds each screen and
//   opens the Screens page on it.
// - The Screens page: Open (new tab), On a tablet (a code and the link), the speaker's voice assistant note, and the
//   tablets set up (a manager's), with Stop asked first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/screens-menu.verify.ts
import * as fs from 'fs';
import { check, failures } from './fake-db';
import { SCREEN_AREAS, shownAreas, screenPath, screenById, setUpBy, screenShown } from '@/lib/screens';
import { STATION_SCREENS } from '@/lib/jobs';

const src = (p: string) => fs.readFileSync(p, 'utf8');
const ids = (areas: any[]) => areas.flatMap((a) => a.screens.map((s: any) => s.id));
const areaIds = (areas: any[]) => areas.map((a) => a.id);

(async () => {
  console.log('Sorted by where they go');
  const food = { id: 'north-pier', businessType: 'hospitality', orderAhead: { on: true } };
  const all = shownAreas(food);
  check('four areas, in order: drive-thru and counter, kitchen and floor, front desk and waiting, team', JSON.stringify(areaIds(all)) === JSON.stringify(['drive', 'kitchen', 'front', 'team']), areaIds(all));
  check('the drive-thru and counter has the lane, menu board, speaker, order board, window screen, kiosk and ready board',
    JSON.stringify(all[0].screens.map((s) => s.id)) === JSON.stringify(['lane', 'menu-board', 'speaker', 'order-board', 'window', 'kiosk', 'ready']), all[0].screens.map((s) => s.id));
  check('every screen has a name and a line saying what it is and where it goes', SCREEN_AREAS.every((a) => a.screens.every((s) => s.label && s.line.length > 20)));
  check('no screen is listed twice', new Set(ids(SCREEN_AREAS)).size === ids(SCREEN_AREAS).length);

  console.log('Only what is on');
  const pickupOnly = { ...food, driveThru: { pickupOnly: true } };
  const p = ids(shownAreas(pickupOnly));
  check('a pickup-only drive-thru: no speaker and no order board', !p.includes('speaker') && !p.includes('order-board'), p);
  check('…but the lane, menu board, window screen, kiosk and ready board stay', ['lane', 'menu-board', 'window', 'kiosk', 'ready'].every((x) => p.includes(x)), p);
  const pickupNoAhead = { ...food, orderAhead: { on: false }, driveThru: { pickupOnly: true } };
  check('pickup-only without ordering ahead isn’t pickup-only (cars still order at the speaker)', ids(shownAreas(pickupNoAhead)).includes('speaker'));
  const noFood = { id: 'opal', modules: { hospitality: false, classes_events: false } };
  const n = shownAreas(noFood);
  check('with the food tools off, no drive-thru and no kitchen area', !areaIds(n).includes('drive') && !areaIds(n).includes('kitchen'), areaIds(n));
  check('…and an area left with nothing in it isn’t shown', n.every((a) => a.screens.length > 0));
  check('the kitchen screen and floor still show with events on (they share it)', ids(shownAreas({ modules: { hospitality: false, classes_events: true } })).includes('kds'));
  const noKiosk = { modules: { kiosk: false } };
  check('the walk-in kiosk and lobby board go with their tool', !ids(shownAreas(noKiosk)).includes('walk-in') && !ids(shownAreas(noKiosk)).includes('lobby'));
  check('screenShown agrees with the lists', screenShown(pickupOnly, screenById('speaker')!) === false && screenShown(food, screenById('speaker')!) === true);

  console.log('Where each opens');
  check('the lane: /drive-thru/{id}', screenPath(screenById('lane')!, 'north-pier') === '/drive-thru/north-pier');
  check('the kiosk: /drive-thru/{id}/kiosk', screenPath(screenById('kiosk')!, 'north-pier') === '/drive-thru/north-pier/kiosk');
  check('the speaker, the order board, the window, the menu and ready boards under the drive-thru',
    ['speaker', 'board', 'window', 'menu', 'ready'].every((sub) => SCREEN_AREAS[0].screens.some((s) => screenPath(s, 't1') === `/drive-thru/t1/${sub}`)));
  check('the kitchen screen: /kds/{id}', screenPath(screenById('kds')!, 't1') === '/kds/t1');
  check('the client screen pairs with a code, so it has no id in it', screenPath(screenById('client-screen')!, 't1') === '/screen' && setUpBy(screenById('client-screen')!) === 'code');
  check('the business’s id is made safe in the address', screenPath(screenById('lane')!, 'a b') === '/drive-thru/a%20b');
  check('a manager sets up the drive-thru’s and the kitchen’s screens; the time clock just opens',
    setUpBy(screenById('ready')!) === 'manager' && setUpBy(screenById('dish')!) === 'manager' && setUpBy(screenById('host-stand')!) === 'manager' && setUpBy(screenById('timeclock')!) === null);
  check('every route a screen opens at exists', SCREEN_AREAS.every((a) => a.screens.every((s) => {
    const dir = s.noTenant ? `src/app${s.page}` : s.page === '/kiosk' ? 'src/app/(booking)/kiosk/[tenantId]' : `src/app${s.page}/[tenantId]${s.sub ? `/${s.sub}` : ''}`;
    return fs.existsSync(`${dir}/page.tsx`);
  })));

  console.log('Managers’ station screens');
  const m = shownAreas(food, { only: STATION_SCREENS });
  check('a manager or shift lead gets the drive-thru’s screens and the kitchen’s, sorted the same way', JSON.stringify(areaIds(m)) === JSON.stringify(['drive', 'kitchen']) && ids(m).includes('kiosk') && ids(m).includes('speaker'), areaIds(m));
  check('…not the front desk or team ones', !ids(m).includes('walk-in') && !ids(m).includes('timeclock'));
  check('a screen not in the menu yet is unknown', screenById('nope') === null && screenById(undefined) === null);

  console.log('The menu');
  const side = src('src/components/shared/AppSidebar.tsx');
  check('Public pages is now Guest pages and Screens', !/PUBLIC_PORTALS|"Public pages"/.test(side) && /label="Guest pages"/.test(side) && /<ScreensSection areas=\{shownAreas\(selectedTenant\)\} tenantId=\{tenantId\} \/>/.test(side));
  check('guest pages: booking page, online shop, order ahead (while on), rewards page (while on), gift card page',
    /href: '\/order',[^\n]*when: \(t\) => t\?\.orderAhead\?\.on === true/.test(side) && /href: '\/rewards',[^\n]*when: \(t\) => t\?\.loyalty\?\.on === true/.test(side) && /GUEST_PAGES\.filter\(\(p\) => \(!p\.when \|\| p\.when\(selectedTenant\)\) && navShown\(selectedTenant, p\.href\)\)/.test(side));
  check('the Screens group: All screens first, then each area under its own name, each screen in a new tab',
    /<NavItem href="\/screens" icon=\{MonitorSmartphone\} label="All screens" \/>/.test(side) && /aria-labelledby=\{isCollapsed \? undefined : `side-screens-\$\{a\.id\}`\}/.test(side) && /href=\{screenPath\(s, tenantId\)\}[^\n]*newTab/.test(side));
  check('a new-tab link says so to a screen reader, and opens with noopener', /\(opens in a new tab\)/.test(side) && /rel=\{outside \? 'noopener' : undefined\}/.test(side));
  check('managers and shift leads get the same Screens group, with their station screens, open', /runsNight && tenantId && <ScreensSection areas=\{shownAreas\(selectedTenant, \{ only: STATION_SCREENS \}\)\} tenantId=\{tenantId\} defaultOpen \/>/.test(side));
  check('a job’s own menu still names its screens (/kds, /dish)', /const SCREEN_INFO = SCREEN_AREAS\.flatMap/.test(side) && /\.\.\.SCREEN_INFO\]/.test(side));
  const search = src('src/components/shared/AppSearch.tsx');
  check('the search finds each screen by name, by its own tool and how the business runs, and opens the Screens page on it',
    /\{ area: 'Screens', items: SCREEN_FINDS \}/.test(side) && /href: `\/screens\?show=\$\{s\.id\}`, label: s\.label, gate: s\.page, when: \(t: any\) => screenShown\(t, s\)/.test(side)
    && /\(i\.gate \? pageVisible\(selectedTenant, i\.gate\) : planShown\(selectedTenant, i\.href\)\) && \(!i\.when \|\| i\.when\(selectedTenant\)\)/.test(search));

  console.log('The Screens page');
  const page = src('src/app/(app)/screens/page.tsx');
  check('every area shown, each screen with Open (a new tab) and On a tablet', /areas\.map\(\(a\) =>/.test(page) && /target="_blank" rel="noopener"/.test(page) && />On a tablet</.test(page) && /aria-expanded=\{open\}/.test(page));
  check('On a tablet: a code to scan, the link, Copy link and Done (back on On a tablet)', /import\('qrcode'\)/.test(page) && /Scan this with the tablet’s camera/.test(page) && /Copy link/.test(page) && /toggle\.current\?\.focus\(\)/.test(page));
  check('it says how each gets going there: a manager, the front desk’s code, or it just opens', /how === 'code'/.test(page) && /how === 'manager'/.test(page));
  check('the speaker says when the voice assistant isn’t on, and where to turn it on', /action: 'config'/.test(page) && /The voice assistant is off\./.test(page) && /under Drive-thru/.test(page));
  check('from the search: that screen outlined and its Open ready, once for each search', /q\.get\('show'\)/.test(page) && /getElementById\(`open-\$\{foundId\}`\)/.test(page) && /\}, \[want, foundId\]\);/.test(page) && /useSearchParams/.test(page) && /React\.Suspense/.test(page));
  check('a code panel closes on Escape too, a failed copy says so, and On a tablet points at its panel only while it’s open',
    /e\.key === 'Escape'\) \{ e\.stopPropagation\(\); done\(\)/.test(page) && /Couldn’t copy\. Select the link above and copy it\./.test(page) && /aria-controls=\{open \? `code-\$\{s\.id\}` : undefined\}/.test(page)
    && /aria-controls=\{open \? 'side-screens' : undefined\}/.test(side));
  check('the tablets set up, for a manager (hidden for others), when each was last used', /action: 'screens'/.test(page) && /status === 401 \|\| status === 403\) setHidden\(true\)/.test(page) && /function lastUsed/.test(page));
  check('Stop asks first (Keep it is where you land), then stops it', /Stop this tablet\?/.test(page) && /action: 'revoke'/.test(page) && /`keep-\$\{id\}`/.test(page) && /background: RED, color: '#fff'/.test(page));
  check('red only for stopping', (page.match(/\bRED\b/g) || []).length === 2 && /background: RED, color: '#fff'/.test(page) && (page.match(/var\(--bad-ink\)/g) || []).length === 1);
  check('it reads in the app’s black look too: cards set inline (which it takes over), warnings and Stop in the ink that changes with it, the code to scan white',
    !/rounded-2xl bg-\[#fff\]/.test(page) && /style=\{\{ background: '#fff', color: INK, border/.test(page) && /WARN = 'var\(--warn-ink\)'/.test(page) && /className="h-32 w-32 shrink-0 rounded-xl bg-\[#fff\] p-1\.5"/.test(page) && /'screens'\]/.test(fs.readFileSync('src/lib/app-theme.ts', 'utf8')));

  console.log('Wording');
  const ours = (page + src('src/lib/screens.ts') + src('src/components/screens/screen-icons.ts')).replace(/^import .*$/gm, '');
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us|salon|stylist|booth|chair|studio/i.test(ours) && !/ · /.test(ours));
  check('the menu’s new words too', !/salon|stylist|booth|chair|studio/i.test([...side.matchAll(/label: '([^']+)'/g)].map((x) => x[1]).join(' ') + ' Guest pages Screens All screens'));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
