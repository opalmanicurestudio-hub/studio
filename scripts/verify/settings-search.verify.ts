// scripts/verify/settings-search.verify.ts — Settings search finds a single setting on any page and opens that page on
// the row. The list of rows (lib/settings-rows) is read from the pages themselves (scripts/settings-rows-lib). The
// part that picks the row on screen is tried in a real browser on a small page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/settings-search.verify.ts
import fs from 'fs';
import { createRequire } from 'module';
import { buildSettingsRows, renderSettingsRows, labelsIn, conditionalBlocks, hiddenParts, type Printers } from '../settings-rows-lib';
import { SETTINGS_ROWS } from '../../src/lib/settings-rows';
import { SETTINGS_GROUPS, withParam } from '../../src/lib/settings-registry';
import { searchRows, rowNeedsOtherAt, norm } from '../../src/lib/settings-search';
import { findRow, rowOf, shown, boxOf, seekRow, ROW_MAX } from '../../src/components/settings/RowFinder';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const find = (q: string, tenant: any = {}) => searchRows(tenant, q, 30).map((r) => `${r.group.id}/${r.page.id}:${r.label}`);
const label = (r: any) => (typeof r === 'string' ? r : r.l);
const rowsOf = (k: string) => (SETTINGS_ROWS[k] || []).map(label);
const entry = (k: string, l: string): any => (SETTINGS_ROWS[k] || []).map((r) => (typeof r === 'string' ? { l: r } : r)).find((r) => r.l === l);

async function main() {
  // The list of rows
  ok(src('src/lib/settings-rows.ts') === renderSettingsRows(buildSettingsRows()), 'the list of every setting row matches the pages as they are now (after changing a page, run scripts/settings-rows.ts)');
  const inShell = SETTINGS_GROUPS.flatMap((g) => g.pages.filter((p) => p.inShell !== false).map((p) => `${g.id}/${p.id}`));
  // Pages that are mostly a list of the business's own things (locations, roles, readers) or one picker, so they have few
  // settings of their own: named here so a page losing its rows by accident still fails.
  const FEW_ON_PURPOSE = ['payments/reader', 'bookings/page', 'business/locations', 'business/setup', 'shop/alerts', 'shop/offers', 'rooms/cleaning', 'team/roles', 'checkin/closing'];
  const thin = inShell.filter((k) => !FEW_ON_PURPOSE.includes(k) && rowsOf(k).length < 5);
  ok(thin.length === 0, `every page lists its settings (pages with only a few rows are named on purpose)${thin.length ? ': too few on ' + thin.join(', ') : ''}`);
  ok(Object.values(SETTINGS_ROWS).reduce((a, r) => a + r.length, 0) > 650, 'hundreds of single settings are searchable, not just page names');
  const P = (o: Record<string, ('label' | 'title')[]>): Printers => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
  const got = (s: string, p?: Printers) => [...new Set(labelsIn(s, p).map((f) => f.l))].join('|');
  ok(got('<Row label="Tips at checkout" inline><Toggle label="Tips at checkout" aria-label="Tips at checkout" /></Row><Label className="x">Cart hold (minutes)</Label><Section title="Get paid">') === 'Tips at checkout|Cart hold (minutes)|Get paid', 'rows are read from row labels, switches, field labels and section titles');
  ok(got('<Choice label="Early cancel" options={o} /><Num label="Hold time" />') === '' && got('<Field label="Delivery days" />', P({ Row: ['label'], Field: ['label'] })) === 'Delivery days' && got('<WayRow title="Local delivery" label="Offer local delivery" />', P({ WayRow: ['label', 'title'] })).split('|').sort().join('|') === 'Local delivery|Offer local delivery', 'a label or title is listed only when its component puts it on screen');
  ok(got('<Input aria-label="Street address" /><Textarea aria-label="Your story" />') === 'Street address|Your story', 'fields written with capitalized components are read too');
  ok(got('<Row label="No-show fee" /><Row label="New guests booked together count as referrals" /><Row label="No changes by the client inside" />') === 'No-show fee|New guests booked together count as referrals|No changes by the client inside', 'settings that start with “No” or “New” are kept');
  ok(got('<Row label="Save" /><Row label="Add a carrier" /><Row label="No busy periods" /><Row label="No offers yet" /><Row label="Title (e.g. Holiday drop)" /><Row label="Untick the one you want first." /><Row label="1 hour before" /><Row label="ONE IPAD FOR EVERYTHING" /><p className="font-semibold">Arrived damaged?</p>') === '', 'buttons, empty states, examples, sentences, timing choices, shouting and slip questions are never listed as settings');
  ok(!rowsOf('changes/cancellations').some((l) => ['Early cancel', 'Studio cancel', 'Hold time', 'Release day', 'Booking window'].includes(l)), 'names used only inside the code (never shown) aren’t listed, even when another file has a component of the same name that prints its label');
  ok(['No-show', 'No changes by the client inside'].every((l) => rowsOf('changes/cancellations').includes(l)) && rowsOf('tools/referrals').includes('New guests booked together count as referrals'), 'the no-show and change rows are back');
  ok(['Shop latitude', 'Shop longitude', 'Tax %', 'Tips at checkout'].every((l) => rowsOf('shop/basics').includes(l)), 'shop settings inside its sections, map fields included, are found');
  ok(['Offer pickup in the shop', 'Offer local delivery', 'Offer shipping'].every((l) => rowsOf('shop/ways').includes(l)), 'switches handed a label by their row (Offer local delivery) are found');
  ok(!Object.values(SETTINGS_ROWS).flat().map(label).some((l) => /^\d+ (hour|hours|week) before$/.test(l) || l === 'Right now' || l === l.toUpperCase() && /[A-Z]{4}/.test(l)), 'no timing choices or shouting text in the list');
  ok(!rowsOf('business/hours').includes('Your daily goal') && rowsOf('business/hours').includes('Daily goal'), 'one setting written two ways is listed once');
  ok(!rowsOf('business/privacy').some((l) => rowsOf('changes/cancellations').includes(l)), 'Privacy and Cancellations share an address but not their rows');
  const blocks = conditionalBlocks(`const [openGroup, setOpenGroup] = useState('open'); const [editing, setEditing] = useState(null);\nconst renters = moduleEnabled(t, 'booth_rental');\n<div>${'x'.repeat(600)}</div>{renters && <Row label="Renters" />}{s.tips && <Row label="Rate" />}{openGroup === 'get' && <Row label="Pickup" />}{editing && <Row label="Zone name" />}`);
  ok(blocks.length === 2 && blocks.some((b) => b.m === 'booth_rental') && blocks.some((b) => !b.m), 'rows shown only for a tool, or only once another setting is on, are told apart from a section that’s just closed or a form being edited');
  ok(entry('checkin/comforts', 'Offer drinks and refreshments')?.m === 'hospitality' && entry('checkin/comforts', 'Free items per visit')?.c === 1, 'drinks need the hosting tool; free items need drinks turned on first');
  ok(!entry('shop/basics', 'Tax %')?.c && !entry('shop/shipping', 'Orders a day')?.c, 'a setting inside a closed section isn’t said to need another setting');
  ok(!/cancelled|cancelling|colour|programme|licence/i.test(src('src/lib/settings-rows.ts')), 'every listed setting is spelled the US way');
  // Only rows a search can open to
  const hid = (code: string, word: string) => hiddenParts(code).some((h) => code.indexOf(word) >= h.from && code.indexOf(word) < h.to);
  const fixture = `const [editing, setEditing] = useState(null); const [phone, setPhone] = useState(tenant?.x !== false); const [openGroup, setOpenGroup] = useState('a');\n<Row label="Seen" /><Sheet title="Edit"><Row label="In a sheet" /></Sheet><Dialog><Row label="In a dialog" /></Dialog>{editing && <Row label="Being edited" />}{selected.type === 'hero' && <Row label="Picked" />}{phone && <Row label="Phone rule" />}<button data-settings-more="" onClick={() => setOpenGroup(openGroup === 'b' ? null : 'b')} />{openGroup === 'b' && <Row label="In a section" />}{loaded && <Row label="After loading" />}{editing && <Editor />}\nfunction Editor() { return <Row label="Only in an editor" /> }\n`;
  ok(['In a sheet', 'In a dialog', 'Being edited', 'Picked', 'Only in an editor'].every((w) => hid(fixture, w)) && !['Seen', 'Phone rule', 'In a section', 'After loading'].some((w) => hid(fixture, w)), 'sheets, dialogs, things being edited or picked, and editors shown only for them are left out; a setting’s own switch, a section opened by a More button and a page waiting to load are kept');
  ok(!['Pickup days', 'Orders a day', 'First day closed', 'Banner on your shop'].some((l) => rowsOf('shop/shipping').includes(l)) && !['Street address', 'ZIP code', 'Pause this location'].some((l) => rowsOf('business/locations').includes(l)) && !['Headline', 'Banner text', 'Google Maps link'].some((l) => rowsOf('shop/design').includes(l)), 'rows that only exist in a sheet, a dialog or a picked section aren’t offered');
  ok(conditionalBlocks(`<div>${'x'.repeat(400)}</div>{responseHours > 0 && <Row label="Nudge them first" />}`).length === 1 && entry('bookings/how', 'Nudge them first')?.c === 1, 'a row shown once a number is above zero is known to depend on that setting');
  ok(['Appointment reminders', 'Draft payroll', 'Rent due reminder', 'License and insurance reminders'].every((l) => rowsOf('auto/all').includes(l)) && entry('auto/all', 'Draft payroll')?.m === 'money' && entry('auto/all', 'Rent due reminder')?.m === 'booth_rental', 'every automation switch is searchable, each needing its tool');
  ok(rowsOf('payments/payouts').includes('Offer pay-later'), 'Pay later is found');
  ok(rowsOf('checkin/hosting').includes('Hold before (min)') && !entry('checkin/hosting', 'Hold before (min)')?.c, 'rows shown once the business has loaded aren’t said to need another setting');
  ok(!['Block service', 'Immediately (at booking)'].some((l) => rowsOf('auto/all').includes(l)), 'choices inside a dropdown aren’t listed as settings');
  ok(!Object.values(SETTINGS_ROWS).flat().map(label).some((l) => ['Kind', 'Hint', 'Moments', 'Classic', 'Studio', 'Free', 'Approve', 'No ceiling', 'Warn only', 'Always on'].includes(l) || /&amp;/.test(l)), 'single words and choices aren’t listed as settings');
  ok(rowsOf('business/details').includes('Email') && !['messages/wording', 'payments/payouts', 'auto/all'].some((k) => ['Email', 'Text', 'Cost'].some((l) => rowsOf(k).includes(l))), 'Email is found where it’s a setting (your business email), not where it’s only a caption on a card');
  ok(!['Extra minutes', 'Safety message', 'Good to know — what clients read'].some((l) => rowsOf('checkin/before').includes(l)), 'an editor from another file, opened only for one service, isn’t read as part of the page');
  ok(['Tell a manager', 'Put it in the issue queue', 'Accept it for them'].every((l) => entry('bookings/how', l)?.c === 1), 'choices from a list shown only once a setting is on are known to depend on it');
  ok(!(rowsOf('changes/right').includes('Providers can offer a redo') && rowsOf('changes/right').includes('Providers can offer a redo themselves')) && !rowsOf('shop/pickup').includes('Show times for the next, in days'), 'a switch named like its own row isn’t listed twice');

  // Finding one setting
  ok(find('tips shared').includes('changes/fees:How tips are shared') && find('shared tips').includes('changes/fees:How tips are shared'), '“tips shared” and “shared tips” both find How tips are shared');
  ok(find('no-show').some((x) => x.startsWith('changes/cancellations:')), '“no-show” finds the cancellations page');
  ok(find('health information')[0]?.startsWith('business/privacy:'), '“health information” finds Privacy first');
  ok(find('same-day orders').some((x) => /Same-day orders close at/.test(x)), '“same-day orders” finds the delivery cutoff');
  ok(find('wifi').some((x) => x.startsWith('checkin/comforts:')) && !find('wi-fi').some((x) => /finish/i.test(x)), '“wifi” finds Wi-Fi for guests, and nothing that only happens to have “wi” and “fi” in it');
  ok(find('cancelling').length > 0 && find('canceling').join() === find('cancelling').join() && ['cancelli', 'cancellin', 'cancelle'].every((q) => find(q).length > 0), 'both spellings of canceling find the same settings, while still typing too');
  ok(find('sales tax').some((x) => x.startsWith('payments/payouts:')), 'settings on cards inside a page are found (sales tax under Payments)');
  ok(find('they just book').some((x) => x.startsWith('bookings/how:')), 'choices written as a list are found (They just book)');
  ok(searchRows({ modules: { hospitality: false } }, 'drinks').length === 0 && searchRows({}, 'drinks').some((r) => r.label === 'Offer drinks and refreshments'), 'a setting for a tool the business doesn’t use is never offered');
  ok(searchRows({ modules: { retail: false } }, 'cart recovery').length === 0, 'nor are settings on pages for tools it doesn’t use');
  ok(searchRows({}, 'x').length === 0 && searchRows({}, 'tips', 3).length <= 3, 'one letter isn’t a search, and the number of results is capped');
  const msg = searchRows({}, 'canceled studio is closed', 5).find((r) => r.page.id === 'wording');
  ok(msg && msg.href.includes('group=Booking') && msg.href.includes('find='), 'a message is opened in its own group on the messages page');
  ok(rowNeedsOtherAt('Free items per visit', '/settings', 'experience') && !rowNeedsOtherAt('Free items per visit', '/settings/policies', null) && !rowNeedsOtherAt('Logo', '/settings', 'profile'), 'whether a setting needs another one first is judged on the page it’s on');
  ok(withParam('/settings/booking#rules', 'find', 'Book back to back') === '/settings/booking?find=Book%20back%20to%20back#rules' && withParam('/settings?tab=hours', 'find', 'x') === '/settings?tab=hours&find=x' && withParam('/x?find=a', 'find', 'b') === '/x?find=b', 'a found setting’s address keeps its tab and #part, and replaces an older find');
  ok(searchRows({}, 'deposit', 30).every((r) => r.href.includes('find=') && (!r.page.href.includes('#') || r.href.endsWith('#' + r.page.href.split('#')[1]))), 'every found setting opens its own page, pointing at the row');
  ok(norm('Cancelled colour Programme') === 'canceled color program', 'searching matches US and UK spellings alike');

  // Picking the row on screen, in a real browser
  let pw: any = null; try { pw = createRequire(__filename)('playwright'); } catch { console.log('  SKIPPED: no browser installed here, so the row picker and section opener weren’t tried'); }
  if (pw) {
    const browser = await pw.chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(`<!doctype html><body style="margin:0;font:16px sans-serif"><div id="settings-page" style="width:1168px"><main style="max-width:768px;padding:20px">
      <div id="card" style="padding:16px;border:1px solid #ccc">${['Deposits', 'Late cancellation', 'Running late', 'No-show', 'Rescheduling fee'].map((l, i) => `<div id="r${i}" style="display:flex;height:70px"><div><p style="margin:0">${l}</p><p style="margin:0">How this works.</p></div><button role="switch" aria-label="${l} switch"></button></div>`).join('')}</div>
      <section id="sec" style="margin-top:20px"><h3 id="h">What does the client owe?</h3><p>Help text.</p></section>
      <div id="marked" data-setting-row="Tips at checkout" style="height:60px"><span>Tips at checkout</span></div>
      <div id="tall" style="height:600px"><span id="lonely">Lonely words</span></div>
      <div id="field" style="height:56px"><input aria-label="Cart hold"></div>
      <div hidden><p>Hidden thing</p></div>
      <div id="m2" data-setting-row="Hold a card on file" style="display:none">Hold a card on file</div>
    </main></div></body>`);
    await page.addScriptTag({ content: `var __name = function (f) { return f; }; var ROW_MAX = ${ROW_MAX};\n${shown.toString()}\n${rowOf.toString()}\n${findRow.toString()}\nwindow.__pick = function (l) { var h = findRow(document.getElementById('settings-page'), l); return h ? { id: h.el.id || h.el.tagName, heading: h.heading, height: Math.round(h.el.getBoundingClientRect().height) } : null; };` });
    const pick = (l: string) => page.evaluate((x: string) => (window as any).__pick(x), l);
    const late = await pick('Late cancellation');
    ok(late?.id === 'r1' && late.height <= ROW_MAX, 'a row without a marker is picked by its own block, not the card or the page around it');
    ok((await pick('Tips at checkout'))?.id === 'marked', 'a marked settings row is picked directly');
    const head = await pick('What does the client owe?');
    ok(head?.heading === true && head.id === 'sec', 'a section title picks its heading block');
    ok((await pick('Lonely words'))?.id === 'lonely', 'words inside something taller than a row mark only themselves');
    ok((await pick('Cart hold'))?.id === 'field', 'a field found by its name marks the row it sits in');
    ok((await pick('Hidden thing')) === null && (await pick('Hold a card on file')) === null, 'nothing hidden is picked');
    await page.addScriptTag({ content: `var boxOf = ${boxOf.toString()};\n${seekRow.toString()}\n
      window.__seek = function (setup) { return new Promise(function (done) {
        var root = document.createElement('div'); root.id = 'seek-root'; document.body.appendChild(root); var open = setup.open || null; var started = Date.now();
        var secs = setup.groups.map(function (g) {
          var sec = document.createElement('section'); var b = document.createElement('button'); b.setAttribute('data-settings-more', ''); b.textContent = g.title; sec.appendChild(b);
          var box = document.createElement('div'); g.rows.forEach(function (l) { var r = document.createElement('div'); r.style.height = '60px'; r.textContent = l; box.appendChild(r); });
          if (g.late) setTimeout(function () { var r = document.createElement('div'); r.style.height = '60px'; r.textContent = g.late; box.appendChild(r); }, setup.lateMs);
          root.appendChild(sec); return { id: g.id, b: b, sec: sec, box: box };
        });
        var draw = function () { secs.forEach(function (x) { var on = setup.single ? open === x.id : x.on; x.b.setAttribute('aria-expanded', String(!!on)); if (on && !x.box.isConnected) x.sec.appendChild(x.box); if (!on && x.box.isConnected) x.box.remove(); }); };
        secs.forEach(function (x) { x.on = open === x.id; x.b.onclick = function () { if (setup.single) open = open === x.id ? null : x.id; else x.on = !x.on; draw(); }; });
        draw();
        var stop = false; var end = function (what) { stop = true; var r = { what: what, ms: Date.now() - started, open: secs.map(function (x) { return x.b.getAttribute('aria-expanded') === 'true' ? 'o' : '-'; }).join('') }; root.remove(); done(r); };
        seekRow({ root: function () { return root; }, label: setup.find, every: setup.every, later: function (fn, ms) { setTimeout(fn, ms); }, stopped: function () { return stop; },
          found: function (h) { end('found:' + h.el.textContent); }, gaveUp: function () { end('gave up'); } });
      }); };` });
    const seek = (setup: any) => page.evaluate((x: any) => (window as any).__seek(x), setup);
    const acc = [{ id: 'a', title: 'Open', rows: ['Store status'] }, { id: 'b', title: 'Get', rows: ['Offer curbside'] }, { id: 'c', title: 'Money', rows: ['Tips at checkout', 'Tax %'] }];
    const r1 = await seek({ groups: acc, single: true, open: 'a', find: 'Tax %', every: 50 });
    ok(/^found:.*Tax %/.test(r1.what) && r1.open === '--o', 'in a one-open-at-a-time list of sections, the setting is found in its section and the others are left closed');
    const r2 = await seek({ groups: acc, single: true, open: 'a', find: 'Nowhere', every: 50 });
    ok(r2.what === 'gave up' && r2.open === 'o--', 'when the setting isn’t anywhere, the section the owner had open is open again');
    const r3 = await seek({ groups: [{ id: 'm1', title: 'More', rows: ['Hold a card'] }, { id: 'm2', title: 'More', rows: ['Charge the card'], late: 'Late setting' }], single: false, find: 'Late setting', every: 150, lateMs: 1000 });
    ok(/^found:.*Late setting/.test(r3.what) && r3.open === '-o', 'a setting that loads a second late inside a closed section is still found, on the second time round');
    const r4 = await page.evaluate(() => new Promise((done) => {
      const root = document.createElement('div'); document.body.appendChild(root); let open = 'a';
      const btns = ['a', 'b', 'c'].map((id) => { const sec = document.createElement('section'); const b = document.createElement('button'); b.setAttribute('data-settings-more', ''); b.textContent = id; sec.appendChild(b); root.appendChild(sec); b.onclick = () => { open = open === id ? '' : id; btns.forEach((x, i) => x.setAttribute('aria-expanded', String(open === ['a', 'b', 'c'][i]))); }; return b; });
      btns.forEach((x, i) => x.setAttribute('aria-expanded', String(open === ['a', 'b', 'c'][i])));
      let stop = false; const s = (window as any).seekRow({ root: () => root, label: 'Nowhere', every: 40, later: (fn: () => void, ms: number) => setTimeout(fn, ms), stopped: () => stop, found: () => {}, gaveUp: () => {} });
      setTimeout(() => { stop = true; s.cancel(); done(btns.map((x) => (x.getAttribute('aria-expanded') === 'true' ? 'o' : '-')).join('')); root.remove(); }, 200);
    }));
    ok(r4 === 'o--', 'leaving in the middle of a search puts the sections back as the owner had them');
    await browser.close();
  }

  // Opening on the row
  const finder = src('src/components/settings/RowFinder.tsx');
  ok(finder.includes(`'[data-settings-more][aria-expanded="false"]'`) && finder.includes('!tried.has(b) && shown(b)') && finder.includes("if (current.getAttribute('aria-expanded') === 'true') current.click();"), 'closed sections are opened one at a time, and closed again when the setting isn’t in them');
  ok(src('src/components/settings/settings-ui.tsx').includes('data-settings-more=""') && (src('src/app/(app)/retail-orders/settings/page.tsx').match(/data-settings-more="" onClick=\{\(\) => setOpenGroup/g) || []).length >= 5, 'both “More” sections and the shop settings sections can be opened to a setting');
  ok(!finder.includes('opened = true'), 'sections that appear only once the page has loaded are still opened');
  ok(!finder.includes("getElementById('settings-page')?.scrollIntoView") && finder.includes('setNote(text); setSaid(\'\'); later(() => setSaid(text), 60);') && finder.includes('<div aria-hidden="true" className="fixed left-1/2 top-20'), 'giving up leaves the page where the owner scrolled it, and the note is read out by the status line that’s always there');
  ok(finder.includes('shows once the setting it depends on is turned on') && finder.includes('Couldn’t point to') && finder.includes('rowNeedsOtherAt(find, pathname'), 'when a setting can’t be shown, a note says why, judged for this page');
  ok(finder.includes("el.style.scrollMarginTop = '96px'") && finder.includes('marked.style.scrollMarginTop = margin'), 'the row lands clear of the header at the top, and the page is left as it was');
  ok(finder.includes("stopped = true; timers.forEach(clearTimeout); setNote('');") && finder.includes("classList.remove('cf-found', 'cf-found-out')"), 'leaving clears the mark and the note');
  ok(finder.includes('[find, pathname, address, again]') && finder.includes("addEventListener('cf-find'"), 'moving to another tab, or picking the same result again, points again');
  ok(finder.includes('el.focus({ preventScroll: true })') && finder.includes('aria-live="polite"') && finder.includes("setSaid(''); later(() => setSaid(`Showing ${find}`), 60);") && finder.includes("addEventListener('blur', () => { el.removeAttribute('tabindex');"), 'focus moves to the setting, screen readers hear it each time, and the row stops taking focus once left');
  ok(src('src/components/settings/settings-ui.tsx').includes('data-setting-row={label}') && src('src/components/orders/ui.tsx').includes("data-setting-row={typeof label === 'string' ? label : undefined}") && src('src/app/(app)/settings/policies/page.tsx').includes('<div data-setting-row={label}') && src('src/app/(app)/settings/messages/page.tsx').includes('data-setting-row={k.label}') && src('src/components/orders/ShippingScheduleScreen.tsx').includes('data-setting-row={label}'), 'settings rows, policy rows, message cards and shipping rows say which setting they are');
  const style = src('src/components/settings/settings-style.tsx');
  ok(style.includes('.cf-found{') && style.includes('box-shadow:inset 0 0 0 2px var(--line);box-shadow:inset') && style.includes('.cf-found-out{') && style.includes('@media (prefers-reduced-motion: reduce){.cf-found-out{transition:none}}'), 'the mark sits inside the row (never clipped), fades out, has a fallback color, and doesn’t move for reduced motion');
  ok(style.includes('.cf-settings .cf-found:focus-visible,') && style.includes('[data-cf-pointed]:focus-visible') && finder.includes("el.setAttribute('data-cf-pointed', '')"), 'the row pointed at isn’t also drawn with a focus ring that its card would cut off');

  // Where it's searched, and what it costs
  const shell = src('src/components/settings/SettingsShell.tsx'); const home = src('src/components/settings/SettingsHome.tsx'); const top = src('src/components/shared/AppSearch.tsx');
  ok(style.includes('.cf-settings .cf-search:focus-within{') && shell.includes('<label className="cf-search ') && home.includes('<label className="cf-search '), 'the search box’s focus ring goes round the whole box, icon included');
  ok(shell.includes('useRowSearch(selectedTenant, q, 8)') && home.includes('useRowSearch(tenant, q, 10)') && top.includes('useRowSearch(selectedTenant, q, 6)'), 'the Settings list, Settings on a phone and the search at the top all find single settings');
  ok(!src('src/lib/settings-registry.ts').includes('settings-rows') && src('src/components/settings/use-row-search.ts').includes("import('@/lib/settings-search')") && ![shell, home, top].some((s) => s.includes("from '@/lib/settings-search'")), 'the list of every setting loads only when someone types in a search');
  ok(src('src/components/settings/use-row-search.ts').includes('.catch((e) => { loading = null; throw e; })'), 'a list that failed to load is tried again, not given up on');
  ok(shell.includes('!first && !rowsLoading') && shell.includes("rowsLoading ? '' : `Nothing matches") && home.includes('(rowsLoading ? null :') && top.includes("settingsLoading ? 'Looking…'"), 'no search says “nothing matches” while the list is still loading');
  ok(shell.includes('prefetch={false} onClick={guard(() => { setQ(\'\'); setHash(hashOfHref(r.page.href)); announceFind(r.label); })}') && home.includes('prefetch={false} onClick={() => announceFind(r.label)}'), 'single-setting results aren’t prefetched one by one, on a computer or a phone');
  ok(shell.includes("p.delete('find')") && shell.includes('samePage(first.href) || mayLeave()'), 'pointing at a setting on the page already open never asks about unsaved edits');
  const msgs = src('src/app/(app)/settings/messages/page.tsx');
  ok(msgs.includes("const group = params?.get('group') || ''") && msgs.includes('<React.Suspense fallback={null}><FollowGroup onGroup={pickGroup} /></React.Suspense>') && !msgs.includes('setTimeout(read'), 'the messages page follows the address to a message’s group, even for a search made on that page');

  // From the review before
  ok(shell.includes('e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0'), 'opening a link in a new tab never asks about unsaved edits');
  ok(src('src/components/settings/settings-place.ts').includes('if (leaveGuard === fn) leaveGuard = null;'), 'leaving a page only clears that page’s own unsaved-edits check');
  ok(style.includes('.cf-settings .bg-accent,'), 'menus and pickers inside Settings keep their highlight');
  const spelled = ['src/app/(app)/settings/page.tsx', 'src/components/orders/PoliciesScreen.tsx', 'src/app/(app)/settings/policies/page.tsx', 'src/components/settings/ClientScreenCard.tsx', 'src/components/maintenance/InterruptionsCard.tsx'];
  ok(spelled.every((f) => !/colour|cancelling|licence|(?<!['_])cancelled(?![\w'])/i.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ''))), 'US spelling on the settings pages that were changed (stored status values stay as they are)');
  ok(!/title: '[^']*[Ll]icence|does: '[^']*licence/.test(src('src/lib/automation-switches.ts')), 'automation names say license');
  ok(!/(when|mandatoryNote|defaultSubject|defaultBody): '[^']*cancelled/.test(src('src/lib/message-policy.ts')), 'message descriptions and default wording say canceled');
  const files = ['scripts/settings-rows-lib.ts', 'src/lib/settings-rows.ts', 'src/lib/settings-search.ts', 'src/components/settings/use-row-search.ts', 'src/components/settings/RowFinder.tsx', 'src/components/settings/SettingsShell.tsx', 'src/components/settings/SettingsHome.tsx', 'src/components/shared/AppSearch.tsx', 'src/components/settings/settings-ui.tsx', 'src/components/orders/ui.tsx', 'src/components/orders/DeliveryScreen.tsx', 'src/components/orders/PickupTimesScreen.tsx', 'src/app/(app)/settings/messages/page.tsx', 'src/components/settings/settings-place.ts', 'src/app/(app)/settings/policies/page.tsx', 'src/components/orders/ShippingScheduleScreen.tsx', 'src/app/(app)/retail-orders/settings/page.tsx'];
  ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no JSX comments in any file this touches');

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
}
void main();
