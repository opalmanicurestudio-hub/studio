// Checks the renter portal as one app (app/rent/[tenantId]/page.tsx with components/rent/portal-map):
// - Five places at the bottom: Today, Calendar, Clients, Money, Space (three without bookings here). Older links that
//   say book, rent or studio still land in the right place.
// - For each kind of renter (books here or not, linked to a renter record or not, with a lease or not, swaps on or
//   off), every screen they can use has a row that opens it, and no row opens a screen they can't use. A link to one
//   they can't use shows the place instead, never the screen.
// - "Needs you" on Today opens the thing itself: building rules to sign open House rules, a document opens the lease.
// - Opening a screen is a step in the browser's history: Back and the phone's back gesture retrace it, forward and
//   jumps keep count, a quick second tap never walks out of the portal, and the router's own state is kept.
// - Space bookings are there for everyone (Calendar for those who book here, Space for everyone else).
// - The portal names the business instead of calling it "the studio", on the page and in what the server says.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/portal-one-app.verify.ts
import { readFileSync, readdirSync } from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => readFileSync(p, 'utf8');
const PAGE = 'src/app/rent/[tenantId]/page.tsx';
const page = src(PAGE);

(async () => {
  const M = await import('../../src/components/rent/portal-map');

  check('five places, in order', JSON.stringify(Object.values(M.TAB_LABEL)) === JSON.stringify(['Today', 'Calendar', 'Clients', 'Money', 'Space']));
  check('older links: book → Calendar, rent → Money, studio → Space', M.tabFor('book') === 'calendar' && M.tabFor('rent') === 'money' && M.tabFor('studio') === 'space');
  check('the new names land as themselves', ['today', 'calendar', 'clients', 'money', 'space'].every((t) => M.tabFor(t) === t));
  check('anything else lands on Today', M.tabFor('nonsense') === 'today' && M.tabFor('') === 'today' && M.tabFor(undefined) === 'today');

  // Every screen the page can open is drawn by it, and has words for its row.
  const screens = page.slice(page.indexOf('const screen = (v: string)'), page.indexOf('const renderCreds'));
  const titled = Object.keys(M.VIEW_TITLES);
  check('every screen with a title is drawn', titled.every((v) => screens.includes(`case '${v}': return`)), titled.filter((v) => !screens.includes(`case '${v}': return`)).join(', '));
  check('every screen has words for its row', titled.filter((v) => v !== 'setup').every((v) => page.includes(`case '${v}': return { title:`)), titled.filter((v) => v !== 'setup' && !page.includes(`case '${v}': return { title:`)).join(', '));
  check('each screen outside setup belongs to a place', titled.filter((v) => v !== 'setup' && !v.startsWith('setup:')).every((v) => M.VIEW_PARENT[v]));
  check('setup screens go back to Business setup when there’s no step to retrace', titled.filter((v) => v.startsWith('setup:')).every((v) => M.VIEW_BACK[v] === 'setup') && !M.VIEW_BACK.notices);

  // Reachability, renter by renter.
  const kinds = [true, false].flatMap((booksHere) => [true, false].flatMap((hasRenter) => [true, false].flatMap((hasLease) => [true, false].map((swaps) => ({ booksHere, hasRenter, hasLease, swapsOn: booksHere && swaps })))));
  for (const w of kinds) {
    const label = `${w.booksHere ? 'books here' : 'own bookings'}, ${w.hasRenter ? 'linked' : 'not linked'}, ${w.hasLease ? 'lease' : 'no lease'}${w.swapsOn ? ', swaps' : ''}`;
    const places = M.placesFor(w);
    const listed = new Set<string>();
    for (const p of places) for (const g of M.placeRows(p, w)) for (const v of g.views) listed.add(v);
    for (const g of M.setupRows(w)) for (const v of g.views) listed.add(v);
    const usable = titled.filter((v) => v !== 'setup' && M.viewAllowed(v, w));
    check(`${label}: every screen they can use has a row`, usable.every((v) => listed.has(v)), usable.filter((v) => !listed.has(v)).join(', '));
    check(`${label}: no row opens a screen they can’t use`, [...listed].every((v) => M.viewAllowed(v, w)));
    check(`${label}: a link to a screen they can’t use shows its place instead`, titled.every((v) => M.shownView(v, w) === (M.viewAllowed(v, w) ? v : null)));
    check(`${label}: a link to a place they don’t have shows Today`, (['calendar', 'clients'] as const).every((t) => M.shownPlace(t, w) === (w.booksHere ? t : 'today')));
    check(`${label}: every Today row goes somewhere they have`, ['rent', 'notice', 'message', 'document', 'rules', 'ticket', 'concern', 'leave', 'request', 'prep', 'appointment', 'alert'].every((k) => {
      const t = M.needsTarget(k, 'book', w); return places.includes(t.tab) && (t.view === null || M.viewAllowed(t.view, w));
    }));
  }
  const full = { booksHere: true, hasRenter: true, hasLease: true, swapsOn: true };
  const own = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('books here: five places; own bookings: three', M.placesFor(full).length === 5 && JSON.stringify(M.placesFor(own)) === JSON.stringify(['today', 'money', 'space']));
  check('own bookings keep everything about the space', ['notices', 'repairs', 'concerns', 'lease', 'rules', 'insurance', 'away', 'closures', 'history'].every((v) => M.viewAllowed(v, own)));
  check('…and none of the business screens', ['books', 'payouts', 'followups', 'campaigns', 'reconnect', 'giftcards', 'clientdocs', 'setup:services', 'setup:payments'].every((v) => !M.viewAllowed(v, own)));
  check('time away needs a lease; swap days need swaps on', !M.viewAllowed('away', { ...full, hasLease: false }) && !M.viewAllowed('swaps', { ...full, swapsOn: false }));
  check('an account not linked to a renter record sees no screens that need one', ['notices', 'repairs', 'lease', 'rules', 'insurance', 'closures', 'followups', 'clientdocs'].every((v) => !M.viewAllowed(v, { ...full, hasRenter: false })));

  // "Needs you": the specific ones open the thing itself.
  const route = src('src/app/api/portal/renter/route.ts');
  const today = route.slice(route.indexOf("type Item = { kind: string; tab: 'book' | 'rent' | 'studio'"));
  const serverKinds = new Set([...today.slice(0, 9000).matchAll(/items\.push\(\{ kind: '([a-z_]+)'/g)].map((m) => m[1]));
  check('the server’s Today kinds were found', serverKinds.size >= 9, [...serverKinds].join(', '));
  check('every Today kind has its own place to open', [...serverKinds].every((k) => M.NEEDS_TARGET[k]), [...serverKinds].filter((k) => !M.NEEDS_TARGET[k]).join(', '));
  check('building rules to sign come as their own kind, and open House rules', /items\.push\(\{ kind: 'rules', tab: 'studio', title: x\.state === 'resign'/.test(route) && M.needsTarget('rules', 'studio', full).view === 'rules');
  check('a document opens the lease; a notice or a reply opens Messages and notices', M.needsTarget('document', 'studio', full).view === 'lease' && M.needsTarget('notice', 'studio', full).view === 'notices' && M.needsTarget('message', 'studio', full).view === 'notices');
  check('time away lives on Space, and its dot is Space’s', M.needsTarget('leave', 'studio', full).tab === 'space' && !/kind: 'leave', tab: 'rent'/.test(route));
  check('rent opens Money; a request opens Calendar, or Today for someone who doesn’t book here', M.needsTarget('rent', 'rent', full).tab === 'money' && M.needsTarget('request', 'book', full).tab === 'calendar' && M.needsTarget('request', 'book', own).tab === 'today');
  check('an unknown kind goes to the place it names', JSON.stringify(M.needsTarget('alert', 'studio', full)) === JSON.stringify({ tab: 'space', view: null }));

  // History steps, against a stand-in for the browser's history (entries and a cursor).
  const fake = () => {
    const entries: any[] = [{ __NA: true, tree: 'T' }]; let at = 0;
    return {
      get state() { return entries[at]; },
      pushState(d: any) { entries.splice(at + 1); entries.push(d); at++; },
      replaceState(d: any) { entries[at] = d; },
      go(n: number) { at = Math.max(0, Math.min(entries.length - 1, at + n)); },
      back() { this.go(-1); },
      get at() { return at; }, entries,
    };
  };
  {
    const h = fake();
    const n1 = M.pushSpot(h, { tab: 'space', view: null }, { tab: 'space', view: 'notices' });
    check('opening a screen adds one step and remembers where they were', n1 === 1 && h.entries.length === 2 && h.entries[0].portalTab === 'space' && h.entries[0].portalView === null && h.entries[1].portalView === 'notices');
    check('the router’s own state is kept on both entries', h.entries[0].__NA === true && h.entries[0].tree === 'T' && h.entries[1].__NA === true && h.entries[1].tree === 'T');
    const n2 = M.pushSpot(h, { tab: 'space', view: 'notices' }, { tab: 'space', view: 'lease' });
    check('a screen from a screen is a second step', n2 === 2 && M.stepOf(h.state) === 2);
    check('Back retraces while there are steps', M.backMove(h.state, false) === 'history');
    check('…but waits while a step back is already on its way (a quick second tap)', M.backMove(h.state, true) === 'wait');
    h.back(); check('back lands on the screen before, one step shallower', M.stepOf(h.state) === 1 && JSON.stringify(M.spotFromState(h.state)) === JSON.stringify({ tab: 'space', view: 'notices' }));
    h.go(1); check('forward counts back up', M.stepOf(h.state) === 2 && M.spotFromState(h.state)?.view === 'lease');
    h.go(-2); check('a jump of two lands at the place with no steps left', M.stepOf(h.state) === 0 && JSON.stringify(M.spotFromState(h.state)) === JSON.stringify({ tab: 'space', view: null }));
    check('with no steps left, Back closes the screen here instead of leaving the portal', M.backMove(h.state, false) === 'here');
    M.markSpot(h, { tab: 'money', view: null });
    check('switching places marks where they are without adding a step', h.entries.length === 3 && h.at === 0 && h.state.portalTab === 'money' && M.stepOf(h.state) === 0 && h.state.__NA === true);
    check('an entry from before the portal remembers nothing', M.spotFromState({ __NA: true }) === null && M.spotFromState(null) === null && M.stepOf(undefined) === 0);
    check('a remembered screen that no longer exists opens its place', JSON.stringify(M.spotFromState({ portalTab: 'studio', portalView: 'gone' })) === JSON.stringify({ tab: 'space', view: null }));
    check('a nonsense step count reads as none', M.stepOf({ portalStep: -3 }) === 0 && M.stepOf({ portalStep: 'x' }) === 0 && M.stepOf({ portalStep: 2.7 }) === 2);
  }

  // The page uses all of it.
  check('the page takes its places and rows from portal-map', /from '@\/components\/rent\/portal-map'/.test(page) && /groupsOf\(placeRows\('space', who\)\)/.test(page) && /groupsOf\(placeRows\('clients', who\)\)/.test(page) && /groupsOf\(placeRows\('money', who\)\)/.test(page) && /groupsOf\(setupRows\(who\)\)/.test(page) && /placesFor\(who\)\.map/.test(page));
  check('…and shows only what this renter has, from the first frame (no screen at all before their portal loads)', /const tab: PortalTab = data \? shownPlace\(tabAsked, who\) : tabAsked === 'money' \|\| tabAsked === 'space' \? tabAsked : 'today';/.test(page) && /const view = data \? shownView\(viewAsked, who\) : null;/.test(page));
  check('what was asked for follows what’s shown, so a hidden screen can’t reappear on its own', /if \(tabAsked !== tab\) setTabRaw\(tab\);/.test(page) && /if \(viewAsked !== view\) setView\(view\);/.test(page));
  check('moving somewhere goes only where this renter can; a row on Today that leads to another place is a step back, a tab tap isn’t', /const toView = data \? shownView\(v, who\) : v;/.test(page) && /const mode = how === 'step' && \(toView \|\| toTab !== tab\) \? 'step' : 'here';/.test(page) && /go\(target\.tab, target\.view, 'step'\)/.test(page));
  check('no rows written by hand on the places', !/onClick=\{\(\) => open\('(notices|repairs|followups|history|books|setup:services)'\)\}/.test(page));
  check('Back: retrace, wait, or close here', /move = backMove\(window\.history\.state, backing\.current\)/.test(page) && /if \(move === 'wait'\) return;/.test(page) && /onClick=\{back\} aria-label="Back"/.test(page));
  check('the phone’s back gesture shows what the entry remembers', /addEventListener\('popstate', onPop\)/.test(page) && /const spot = spotFromState\(e\.state\)/.test(page));
  check('a link to a screen lights its place, and the screen is taken off the address', /linkTo\.current = \{ tab: VIEW_PARENT\[v\] \|\|/.test(page) && /q\.delete\('view'\)/.test(page));
  check('…read once, and kept until their portal loads, so it still applies after signing in', /if \(linkRead\.current\) return;/.test(page) && /if \(!data \|\| !linkTo\.current\) return;/.test(page));
  check('a personal sign-in link keeps the place and screen it points to', /for \(const k of \['tab', 'view'\]\)/.test(page));
  check('signing out forgets the place, screen, dots and the business’s name', /if \(!s\) \{ setTabRaw\('today'\); setView\(null\); setBadges\(\{\}\);[^\n]*setBusinessName\(''\); \}/.test(page));
  check('…but signing in doesn’t throw away where a link points', (page.match(/setTabRaw\('today'\); setView\(null\)/g) || []).length === 1);
  check('opening or closing a screen puts the focus on its heading; a tab tap leaves it on the bar', /<h1 ref=\{headingRef\} tabIndex=\{-1\}/.test(page) && /headingRef\.current\?\.focus\(\{ preventScroll: true \}\); \} catch \{ \/\* fine \*\/ \}\n  \}, \[view\]\);/.test(page) && /if \(toView !== view && !keepFocus\) moved\.current = true;/.test(page));
  check('coming back from a screen that changes the portal reloads it, setup screens too (they close through Business setup)', /\['lease', 'rules', 'insurance', 'away', 'swaps'\]\.includes\(view\) \|\| view\.startsWith\('setup'\)\)\) dirty\.current = true;/.test(page) && /if \(dirty\.current\) \{ dirty\.current = false; void refresh\(\); \}/.test(page));
  check('a tap on the bar keeps the focus on the bar, even from inside a screen', /const setTab = \(t: string\) => go\(tabFor\(t\), null, 'here', true\);/.test(page) && /if \(toView !== view && !keepFocus\) moved\.current = true;/.test(page));
  check('the bottom bar stays while the portal reloads', /\{\(!loading \|\| !!data\) && \(\n        <nav/.test(page));
  check('a dot is spoken, not only seen', /<span className="sr-only">, something waiting<\/span>/.test(page));
  check('space bookings: Calendar for those who book here, Space for everyone else', /\{spaceBookings\}/.test(page) && /\{!booksHere && \(later\.length > 0 \|\| !!data\?\.rebookUrl\) && spaceBookings\}/.test(page) && /onRequestReschedule=\{requestReschedule\}/.test(page));
  const studio = src('src/components/rent/studio.tsx');
  check('coming back from a screen refreshes Today', /refreshKey=\{freshen\}/.test(page) && /refreshKey, retry\]/.test(studio));
  check('a Today that couldn’t load says so, with a way to try again, even when rent is showing', /Couldn’t check what needs you\./.test(studio) && /Couldn’t check everything just now\./.test(studio));

  // Naming the business.
  const B = await import('../../src/components/rent/biz');
  B.setBusinessName('');
  check('with no name yet: the business', B.biz() === 'the business' && B.biz(true) === 'The business' && B.bizs() === 'the business’s');
  B.setBusinessName('  Northside Studio ');
  check('with a name: the name', B.biz() === 'Northside Studio' && B.biz(true) === 'Northside Studio' && B.bizs() === 'Northside Studio’s');
  B.setBusinessName(null);
  check('a missing name falls back', B.biz() === 'the business');
  check('the page sets the name each time it draws', /setBusinessName\(business\);/.test(page));
  check('the server sends no made-up name when the business has none', /studioName: tenant\.name \|\| '',/.test(route));

  const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const portalFiles = [PAGE, ...readdirSync('src/components/rent').filter((f) => f.endsWith('.tsx') || f.endsWith('.ts')).map((f) => `src/components/rent/${f}`)];
  const studioWords = /\b(?:[Tt]he|[Tt]his|a|our) studio\b|Studio Credit|[Ss]tudio (?:booking|review|system|gift card)|'Studio'/;
  const sayStudio = portalFiles.filter((f) => studioWords.test(code(src(f))));
  check('nothing in the portal calls the business “the studio”', sayStudio.length === 0, sayStudio.join(', '));
  check('nor does the portal’s server', !studioWords.test(code(route)), (code(route).match(studioWords) || [])[0]);
  check('no old place names in messages (Rent tab, under Rent, tap Studio)', ![src('src/app/api/comms/dispatch/route.ts'), src('src/app/api/booths/setup-card/route.ts'), src('src/components/rent/setup.tsx')].some((t) => /Rent tab|under Rent\b|<strong>Studio<\/strong>/.test(t)));
  check('links to a document or the rules open those screens', /\?view=lease/.test(src('src/components/shared/RenterDocumentsTab.tsx')) && /\?view=rules/.test(src('src/app/api/comms/dispatch/route.ts')));
  check('US spelling on the portal (canceled, color)', !portalFiles.some((f) => /'Cancelled'|Cancelled —|· cancelled|[Cc]olour|Cancelling/.test(code(src(f)))));

  // The page's own screens in the one look: amber for anything to sort out, no tiny spaced capitals.
  const ownScreens = page.slice(page.indexOf("case 'history': return"), page.indexOf('const rowFor = '));
  check('history and insurance screens: no red, no spaced capitals', ownScreens.length > 2000 && !/red-|uppercase|tracking-widest|font-black/.test(ownScreens));
  check('the page has no red at all outside destructive actions', !/(text|bg|border)-red-/.test(page));

  // One look across every portal screen: no tiny spaced capitals, no heavy weights, no old grays or thick borders,
  // amber for problems (red only on destructive buttons), no emoji or check marks, 44px buttons.
  const rentFiles = readdirSync('src/components/rent').filter((f) => f.endsWith('.tsx')).map((f) => `src/components/rent/${f}`);
  const oldLook = /tracking-widest|tracking-\[0\.1em\]|font-light|font-black|font-bold|text-xs\b|border-2(?![\d])|rounded-3xl|text-\[(?:8|9|10|11)(?:\.5)?px\]|text-slate-|bg-slate-|border-slate-|(?<![\w:-])uppercase(?![\w-])|violet-|emerald-|(?:text|bg|border)-red-/;
  // (the brand preview in setup shows the renter's own chosen type, so its lines are left out)
  const stillOld = rentFiles.filter((f) => oldLook.test(code(src(f)).split('\n').filter((l) => !/RENTER_FONT_STACK/.test(l)).join('\n')));
  check('every portal screen is in the one look', stillOld.length === 0, stillOld.join(', '));
  const redUse = rentFiles.flatMap((f) => (code(src(f)).match(/.{0,120}#b42318.{0,160}/g) || []).filter((l) => !/RED = '#b42318'/.test(l)).map((l) => ({ f: f.split('/').pop(), l })));
  const destructive = /cancel|Cancel|remove|Remove|stop|Stop|Decline|archive|Archive|delete|Delete|RED|danger/;
  check('red only where something is canceled, removed or stopped', redUse.every((r) => destructive.test(r.l)), redUse.filter((r) => !destructive.test(r.l)).map((r) => `${r.f}: ${r.l.trim().slice(0, 90)}`));
  const symbols = rentFiles.filter((f) => /[\u{1F300}-\u{1FAFF}\u2600-\u2604\u2607-\u27BF]/u.test(src(f)));   // review stars (★ ☆) are allowed
  check('no emoji or check marks on the portal', symbols.length === 0, symbols.join(', '));
  // Every class list with a 32 to 40px height, other than pictures, icon tiles and the autopay switch (inside a 44px button).
  const decorative = /object-cover|items-center justify-center rounded-\[12px\]|grid h-10 w-10|relative block h-8 w-14|w-8 h-8 text-/;
  const small = rentFiles.filter((f) => !f.endsWith('DeskOwedCard.tsx')).flatMap((f) => (code(src(f)).match(/(["'`])[^"'`\n]*(?<![\w-])h-(?:8|9|10)(?![\w\]])[^"'`\n]*\1/g) || []).filter((l) => !decorative.test(l)).map((l) => `${f.split('/').pop()}: ${l.slice(0, 70)}`));
  check('buttons and fields are at least 44px tall', small.length === 0, small.slice(0, 5));
  const shared = src('src/components/rent/shared.tsx');
  check('inside a screen, a section’s own title is for screen readers only (the header names it)', /export const ScreenContext = React\.createContext\(false\)/.test(shared) && /inScreen \? 'sr-only'/.test(shared) && /<ScreenContext\.Provider value>/.test(page));
  check('a second section inside a screen keeps its own visible title (their own documents under the lease)', /<ScreenContext\.Provider value=\{false\}><MyDocuments/.test(page));
  check('a status word starts with a capital, in the one look', /children\.charAt\(0\)\.toUpperCase\(\)/.test(shared) && !/first-letter:uppercase/.test(shared));
  check('old place names are gone from the portal’s words (My Book, Setup →)', !rentFiles.some((f) => /My Book\b|Setup →/.test(code(src(f)))));
  check('Closures and Time away say so when there’s nothing, instead of a blank screen', /No closures so far\./.test(studio) && /doesn’t offer time away through the portal yet/.test(studio));

  // The messages screen: one title (the header's), and the conversation in the new look.
  const inbox = src('src/components/rent/RenterInbox.tsx');
  check('the notices list leaves its title to the header', /<h2 id="renter-inbox-title" className="sr-only">/.test(inbox));
  const thread = studio.slice(studio.indexOf('export function RenterThread'), studio.indexOf('export function resolvedStorageBucket'));
  check('the conversation names the business and has a real Send button', /Your conversation with \{studioName\}/.test(thread) && /h-11[^"]*rounded-full bg-\[#16171a\][^"]*text-\[15px\]/.test(thread) && !/uppercase/.test(thread));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
