// Checks the menu, by what a business has (design board "Only what your plan includes, in the same order everywhere",
// A: sections by the work, nothing you don't have; lib/nav, components/shared/AppSidebar, the header search).
// - A page shows only when the plan includes it and it fits how the business works: no booking pages for a business
//   that doesn't take bookings, no food pages for one that doesn't serve food.
// - Sections in one order; a section with nothing in it isn't shown; "Add a tool" opens Your ClarityFlow.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/nav.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const N = await import('../../src/lib/nav');
  const { toTenantModules } = await import('../../src/lib/module-catalog');
  // A café: food and drink, a small team, no bookings, no shop.
  const cafe = { niche: 'hospitality', shape: { books: false }, modules: toTenantModules(['lounge', 'team', 'books']), orderAhead: { on: true } };
  // A salon: bookings, renters, marketing; no food.
  const salon = { niche: 'salon', modules: toTenantModules(['booking', 'guest', 'marketing', 'books', 'renters', 'team']) };
  // A shop: sells, doesn't take bookings, no food.
  const shop = { niche: 'retail', shape: { books: false }, modules: toTenantModules(['inventory', 'marketing']) };
  // From before tools were chosen: nothing switched off, nothing said about food.
  const legacy = { niche: 'salon' };
  const pages = (t: any, id: any) => N.sectionPages(t, id);

  console.log('what each business sees');
  check('a café: Today, food and drink, no appointments, no rentals, no shop', pages(cafe, 'appointments').length === 0 && pages(cafe, 'food').includes('/counter') && pages(cafe, 'food').includes('/drive-live') && pages(cafe, 'rentals').length === 0 && pages(cafe, 'shop').length === 0, [pages(cafe, 'food'), pages(cafe, 'shop')]);
  check('…its own menu and stock, never Services; no booking page', pages(cafe, 'stock').includes('/menu') && !pages(cafe, 'stock').includes('/services') && !N.navShown(cafe, '/book') && N.stockLabel(cafe) === 'Menu and stock');
  check('a salon: appointments with the front desk, rentals, clients; no food pages at all', pages(salon, 'appointments').join() === '/planner,/pos,/before-the-visit,/waitlist,/appointments/requests,/tidy' && pages(salon, 'food').length === 0 && pages(salon, 'rentals').includes('/renters') && !pages(salon, 'stock').includes('/menu') && N.stockLabel(salon) === 'Services and stock', pages(salon, 'appointments'));
  check('a shop: orders and the front desk under Shop, no appointments, no food, products and stock', pages(shop, 'appointments').length === 0 && pages(shop, 'shop').includes('/retail-orders') && pages(shop, 'shop').includes('/pos') && pages(shop, 'food').length === 0 && N.stockLabel(shop) === 'Products and stock' && !pages(shop, 'stock').includes('/services'), pages(shop, 'shop'));
  check('…a café with no shop rings up at the Counter, so no front desk', !N.navShown(cafe, '/pos'));
  check('a business from before tools were chosen keeps every page of its plan, but never the food pages unless it serves food', pages(legacy, 'appointments').includes('/planner') && pages(legacy, 'food').length === 0 && pages(legacy, 'rentals').length > 0 && !N.navShown(legacy, '/menu'));
  check('…one that chose lounge and hospitality gets them', pages({ ...legacy, modules: { hospitality: true } }, 'food').includes('/host'));
  check('curbside: with food and drink where food is served, with the shop elsewhere', pages({ ...cafe, orderAhead: { on: true, curbside: true } }, 'food').includes('/curbside') && !pages({ ...cafe, orderAhead: { on: true, curbside: true } }, 'shop').includes('/curbside')
    && pages({ ...shop, modules: { ...shop.modules, retail: true }, retailSettings: {} }, 'shop').includes('/curbside'));
  check('the sections come in one order', N.NAV_SECTIONS.map((s) => s.id).join() === 'today,appointments,food,shop,customers,stock,rentals,events,team,money');
  check('every page of a section is one the sidebar knows', N.NAV_SECTIONS.every((s) => s.pages.every((h) => new RegExp(`href: '${h.replace(/\//g, '\\/')}',`).test(src('src/components/shared/AppSidebar.tsx')))));

  console.log('the sidebar and the search');
  const side = src('src/components/shared/AppSidebar.tsx'), search = src('src/components/shared/AppSearch.tsx');
  check('the sidebar builds its sections from lib/nav, each only with something in it', /const sec = \(id: NavSectionId\) => sectionPages\(selectedTenant, id\)/.test(side) && /if \(!items\.some\(\(item: any\) => isPortal \|\| pageVisible\(selectedTenant, item\.href\)\)\) return null;/.test(side)
    && /label="Appointments" items=\{daily\('appointments'\)\}/.test(side) && /label="Food and drink" items=\{daily\('food'\)\}/.test(side) && /<NavSection label=\{stockLabel\(selectedTenant\)\} items=\{sec\('stock'\)\} \/>/.test(side) && /label=\{books \? 'Clients' : 'Customers'\}/.test(side));
  check('…team members still get only their job’s pages first, never listed twice', /const daily = \(id: NavSectionId\) => sec\(id\)\.filter\(\(i\) => !ownHrefs\.has\(i\.href\)\);/.test(side) && /label="Your work"/.test(side));
  check('…guest pages follow the same rules (no booking page without bookings)', /navShown\(selectedTenant, p\.href\)/.test(side));
  check('"Add a tool" at the bottom, to Your ClarityFlow', /<NavItem href=\{ADD_TOOL_HREF\} icon=\{CirclePlus\} label="Add a tool" \/>/.test(side) && N.ADD_TOOL_HREF === '/subscriptions');
  check('the search finds what the plan includes (one the menu leaves out on how the business works still found by name), beside the section the menu shows it in', /planShown\(selectedTenant, i\.href\)/.test(search) && /sectionLabelOf\(selectedTenant, i\.href\)/.test(search) && /NAV_SECTIONS\.map\(\(s\) => \(\{ area: s\.label/.test(side)
    && N.planShown(salon, '/menu') === N.navShown({ ...salon, niche: 'hospitality' }, '/menu') && !N.planShown(cafe, '/booths') && N.sectionLabelOf(shop, '/pos') === 'Shop' && N.sectionLabelOf(salon, '/pos') === 'Appointments' && N.sectionLabelOf(salon, '/clients') === 'Clients' && N.sectionLabelOf(cafe, '/clients') === 'Customers' && N.sectionLabelOf(cafe, '/menu') === 'Menu and stock');
  check('…the team at a business without bookings keeps the front desk and curbside with Today; sections open by how it works once it’s known', /const teamShop = !isOwner \? daily\('shop'\)\.filter/.test(side) && /items=\{\[\.\.\.daily\('today'\), \.\.\.teamShop\]\}/.test(side) && /key=\{`shop-\$\{books\}-\$\{servesFood\(selectedTenant\)\}`\}/.test(side));
  for (const f of ['src/lib/nav.ts', 'src/components/shared/AppSidebar.tsx']) check(`${f}: no comments in markup, no new " · "`, !/\{\/\*/.test(src(f)) && !/ · /.test(src('src/lib/nav.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
