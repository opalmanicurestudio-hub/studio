// Checks the one Money page (design board "One Money page", option A; components/money/MoneyTabs, BooksScreen,
// BankScreen in Books, app/(app)/money/page):
//   The Bank tab is gone: the bank's lines to sort lead Books, under From your bank (the first three, the rest a tap
//   away), with checking, adding an account and signing in again beside them; sorted and matched lines open from one
//   button and are only read then. An address or a link asking for Bank opens Books there. How many wait is counted on
//   the Books tab. The tabs are a real tab list (the open one reached by Tab, the arrow keys, Home and End move between
//   them, each with its panel), with an icon and a word each, sliding sideways on a phone with the open one kept in view.
//   On a phone a bank line shows Book (and It's the same), the rest behind More, and Books' filters fold under one
//   button that says how many are on.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/one-money.verify.tsx
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as F from './fake-db';
import { MoneyTabs, panelId, tabId } from '../../src/components/money/MoneyTabs';
const { check } = F;
const src = (f: string) => fs.readFileSync(f, 'utf8');

console.log('The tabs');
const html = renderToStaticMarkup(<MoneyTabs active="ledger" onChange={() => {}} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'ledger', label: 'Books', count: 6 }, { key: 'payday', label: 'Payday' }, { key: 'activity', label: 'Activity', dot: true, dotLabel: 'New activity' }]} />);
check('a tab list in a labelled nav, one tab per place', /<nav aria-label="Money"/.test(html) && /role="tablist" aria-label="Money"/.test(html) && (html.match(/role="tab"/g) || []).length === 4);
check('the open tab selected and the only one Tab reaches', /id="money-tab-ledger" type="button" role="tab" aria-selected="true" aria-controls="money-panel-ledger" tabindex="0"/.test(html)
  && /id="money-tab-payday" type="button" role="tab" aria-selected="false" aria-controls="money-panel-payday" tabindex="-1"/.test(html));
check('what needs you counted on its tab, said for a screen reader too; a dot said in words', />6<span class="sr-only"> to do<\/span>/.test(html) && /<span class="sr-only">New activity<\/span>/.test(html));
check('an icon beside each word, hidden from screen readers', (html.match(/<svg[^>]*aria-hidden="true"/g) || []).length === 4);
check('44px each', (html.match(/min-h-\[44px\]/g) || []).length === 4);
check('the ids the panels use', tabId('bills') === 'money-tab-bills' && panelId('bills') === 'money-panel-bills');
const tabsSrc = src('src/components/money/MoneyTabs.tsx');
check('the arrow keys, Home and End move between tabs, and the focus goes with them; Enter or Space opens one (passing over never opens it)', /e\.key === 'ArrowRight'/.test(tabsSrc) && /e\.key === 'ArrowLeft'/.test(tabsSrc) && /e\.key === 'Home'/.test(tabsSrc) && /e\.key === 'End'/.test(tabsSrc)
  && /e\.preventDefault\(\); setFocusKey\(to\);\n    requestAnimationFrame\(\(\) => document\.getElementById\(tabId\(to\)\)\?\.focus\(\)\);/.test(tabsSrc) && !/e\.preventDefault\(\); onChange\(to\)/.test(tabsSrc) && /tabIndex=\{t\.key === focusKey \? 0 : -1\}/.test(tabsSrc));
const notYet = renderToStaticMarkup(<MoneyTabs active="ledger" onChange={() => {}} mounted={['ledger']} tabs={[{ key: 'ledger', label: 'Books' }, { key: 'payday', label: 'Payday' }]} />);
check('leaving the tabs without opening one, the way back in is the open tab', /onBlur=\{\(e\) => \{ if \(!e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)\) setFocusKey\(active\); \}\}/.test(tabsSrc));
check('closing a month: lines still pending at the bank said, never counted against it', /const bank = waiting\.filter\(\(b: any\) => !b\.pending\)/.test(src('src/lib/books-close-server.ts')));
check('a panel named only once it’s been opened (they’re drawn on first visit)', /aria-controls="money-panel-ledger"/.test(notYet) && !/aria-controls="money-panel-payday"/.test(notYet) && /mounted=\{\[\.\.\.visitedTabs\]\}/.test(src('src/app/(app)/money/page.tsx')));
check('the row measured from itself when centring the open tab', /className="relative flex snap-x gap-1 overflow-x-auto/.test(tabsSrc));
check('on a phone: slides sideways, the open tab kept in view without the page jumping, a soft edge where there’s more', /overflow-x-auto/.test(tabsSrc) && /el\.scrollTo\(\{ left: Math\.max\(0, left\), behavior: 'smooth' \}\)/.test(tabsSrc) && !/scrollIntoView/.test(tabsSrc)
  && /edge\.right && <span aria-hidden="true"/.test(tabsSrc) && /\[scrollbar-width:none\]/.test(tabsSrc));

console.log('The page');
const page = src('src/app/(app)/money/page.tsx');
check('no Bank tab; Books counts the bank’s lines to sort; Activity’s dot said', !/\{ key: 'bank',/.test(page) && /t\.key === 'ledger' \? \{ count: bankWaiting \}/.test(page) && /dot: true, dotLabel: 'New activity'/.test(page));
check('an address or a link asking for Bank opens Books at the bank', /const tabOf = \(t: HubTab \| null\): HubTab \| null => \(t === 'bank' \? 'ledger' : t\);/.test(page)
  && /const el = document\.getElementById\('from-your-bank'\); if \(el\) el\.scrollIntoView/.test(page) && /urlTab !== activeTab \|\| urlTab === 'bank'/.test(page));
check('every panel is the tab’s own panel', (page.match(/role="tabpanel" id=\{panelId\('[a-z]+'\)\} aria-labelledby=\{tabId\('[a-z]+'\)\}/g) || []).length === 8 && !/visitedTabs\.has\('bank'\)/.test(page) && !/const BankTab/.test(page));
check('Books has the bank in it for the owner, who alone reads the bank (never a false Nothing to sort for anyone else)', /bank=\{tenantId && firestore && ledgerRole === 'owner' \? <BankScreen tenantId=\{tenantId\} firestore=\{firestore\} actor=\{auditActor\} inBooks \/> : null\}/.test(page));
check('the count on Books leaves out lines still pending at the bank; a link that opens Books keeps trying to reach the bank as Books draws', /where\('pending', '==', true\)/.test(page) && /else if \(tries\+\+ < 25\) window\.setTimeout\(go, 200\)/.test(page));

console.log('Books');
const books = src('src/components/money/BooksScreen.tsx');
check('From your bank leads, a place the links land on', /\{p\.bank && <div id="from-your-bank" className="mb-4 scroll-mt-20">\{p\.bank\}<\/div>\}/.test(books) && books.indexOf('from-your-bank') < books.indexOf('Find a name or a note'));
check('on a phone: Snap a receipt and New entry side by side, the filters under one button saying how many are on', /flex-1 sm:flex-none/.test(books) && /aria-controls="books-filters"/.test(books) && /Filters\{filtersOn \? `, \$\{filtersOn\}` : ''\}/.test(books)
  && /\$\{filtersOpen \? 'flex' : 'hidden'\} w-full flex-col gap-2 md:flex/.test(books));
check('a line booked from the bank says where to change it now', /Change it under From your bank, Sorted and matched, at the top of Books/.test(books) && !/Bank page/.test(books));

console.log('The bank, in Books');
const bank = src('src/components/money/BankScreen.tsx');
check('called From your bank, how many to sort', /`From your bank\$\{ready \? `, \$\{ready\} to sort` : ''\}`/.test(bank));
check('the first three (pending ones last), the rest a tap away; Book all and the count say what can be booked (not what’s still pending)', /\.slice\(0, allShown \? undefined : FIRST\)/.test(bank) && /Number\(!!a\.pending\) - Number\(!!b\.pending\)/.test(bank) && /const FIRST = 3/.test(bank) && /Show the other \{n - FIRST\}/.test(bank) && /`Book all \$\{ready\} as picked`/.test(bank)
  && /const ready = \(inbox \|\| \[\]\)\.filter\(\(b\) => !b\.pending\)\.length/.test(bank) && /still pending at your bank/.test(bank));
check('a read that failed is said, never Nothing to sort; no bank connected is one quiet line', /\(\) => \{ setInbox\(\[\]\); setReadFailed\(true\); \}/.test(bank) && /couldn’t be read just now/.test(bank) && /if \(inBooks && none && n === 0\) return \(/.test(bank));
check('More moves the focus to what it shows', /document\.getElementById\(`more-\$\{bt\.id\}`\)\?\.focus\(\)/.test(bank) && /id=\{`more-\$\{bt\.id\}`\}/.test(bank));
check('sorted and matched read only once opened', /React\.useEffect\(\(\) => \{\n    if \(!more\) return;\n    loadRecent\(\);/.test(bank) && /aria-controls="bank-more"/.test(bank) && /\{more && <div id="bank-more"/.test(bank));
check('checking, adding an account and signing in again beside the lines', /inBooks && !none && <div className="-ml-3 flex flex-wrap items-center pb-1">/.test(bank) && /needsLogin/.test(bank));
check('on a phone: Book (and It’s the same) shown, the rest behind More', /const phoneMore = \(id: string\) => \(rowMore\[id\] \? '' : 'hidden md:inline-flex'\);/.test(bank) && (bank.match(/\$\{phoneMore\(bt\.id\)\}/g) || []).length === 3
  && /aria-label=\{`More for \$\{bt\.merchant \|\| bt\.name\}`\} className=\{`\$\{btn\(\)\} md:hidden`\}/.test(bank));
check('the house style', ![tabsSrc, bank.replace("replace(/ · /g, ', ')", ''), books].some((s) => /\buppercase\b|font-black|\{\/\*| · /.test(s)) && ![...tabsSrc.matchAll(/>([^<>{}\n]*)</g), ...bank.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")));

console.log(F.failures ? `\n${F.failures} failed` : '\nAll passed');
process.exit(F.failures ? 1 : 0);
