// src/lib/settings-registry.ts — EVERY SETTINGS PAGE, IN ONE LIST.
// Settings is eleven groups named for the decisions an owner makes, each holding its pages. The Settings list on the
// left (components/settings/SettingsShell), the groups on a phone (settings/group/[group]), Settings home and the
// header search all read this list, so a page has one name and one place everywhere. A page only shows when the
// business uses its tool (lib/modules). `href` is where the page lives today; `inShell` says whether that page opens
// inside Settings (with this list beside it) or leaves Settings for a page of the app.
import { moduleEnabled, settingVisible, type ModuleId } from '@/lib/modules';

export type SettingsPageEntry = {
  id: string;
  title: string;
  meaning: string;        // one plain line: what it's for
  href: string;
  words?: string;         // other words people use, for search
  module?: ModuleId;      // shown only when the business uses this tool
  inShell?: boolean;      // false: opens a page of the app, outside Settings
};

export type SettingsGroup = { id: string; title: string; meaning: string; pages: SettingsPageEntry[] };

const T = (tab: string) => `/settings?tab=${tab}`;

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'business', title: 'Your business', meaning: 'Details, hours, locations, your plan and privacy', pages: [
    { id: 'details', title: 'Business details', meaning: 'Name, logo, phone, email and address clients see', href: T('profile'), words: 'name logo phone email address brand time zone import clients' },
    { id: 'setup', title: 'Set up your business', meaning: 'The steps to get going, and your booking link', href: '/settings/setup', words: 'getting started set up setup onboarding checklist steps booking link qr code starter menu' },
    { id: 'hours', title: 'Opening hours', meaning: 'When the business is open', href: T('hours'), words: 'hours open close holiday schedule closed days' },
    { id: 'locations', title: 'Locations', meaning: 'Your address and any other locations', href: T('locations'), words: 'address location map pin clock in radius geofence time zone' },
    { id: 'privacy', title: 'Privacy', meaning: 'Health details, discreet messages, signing out and how long records are kept', href: '/settings/policies#privacy', words: 'privacy health discreet hipaa retention sign out records' },
    { id: 'plan', title: 'Your plan and add-ons', meaning: 'The tools you use and what you pay', href: '/subscriptions', words: 'plan billing subscription invoice add-ons tools upgrade locations', inShell: false },
  ] },
  { id: 'bookings', title: 'Bookings', meaning: 'How bookings come in and your booking page', pages: [
    { id: 'how', title: 'How clients book', meaning: 'Right away, with your approval, or with a deposit first', href: '/settings/booking#rules', words: 'instant approve approval request deposit card on file how far ahead notice blocked time group bookings' },
    { id: 'page', title: 'Booking page', meaning: 'Your color, photo, headline and sections, with a preview', href: '/settings/booking-page', words: 'booking page design website preview photo cover headline color colour mood sections gallery our work about us questions faq qr code link' },
  ] },
  { id: 'changes', title: 'Changes and exceptions', meaning: 'Canceling, no-shows, running late, fees and making it right', pages: [
    { id: 'cancellations', title: 'Cancellations and no-shows', meaning: 'Notice, fees, running late, rescheduling and the policy clients read', href: '/settings/policies', words: 'cancel canceling cancelling cancellation no-show noshow late grace reschedule deposit refund policy fee lead time release' },
    { id: 'fees', title: 'Fees and store credit', meaning: 'Fees owed, store credit, charging a saved card', href: T('policies'), words: 'fees store credit owed charge saved card recovery tip sharing commission pay rules' },
    { id: 'right', title: 'Making it right', meaning: 'Complaints, redos and refunds after a visit', href: '/settings/making-it-right', words: 'complaint redo refund apology goodwill making it right' },
  ] },
  { id: 'checkin', title: 'Check-in and visits', meaning: 'Before the visit, checking in, the visit itself and aftercare', pages: [
    { id: 'before', title: 'Before the visit', meaning: 'Questions for each service and what clients see beforehand', href: '/settings/before-the-visit', words: 'before the visit questions intake prep readiness top up' },
    { id: 'forms', title: 'Forms and documents', meaning: 'What each service needs before the visit, your forms, and how long a signature lasts', href: '/settings/forms', words: 'forms consent waiver release intake health questions signature signed documents photo id guardian under 18 due' },
    { id: 'stages', title: 'Visit stages', meaning: 'The steps of a visit and what clients see on their visit link', href: T('visits'), words: 'stages timeline arrived waiting in service visit link' },
    { id: 'kiosk', title: 'Check-in screen', meaning: 'The screen clients use to check themselves in', href: T('kiosk'), words: 'kiosk check in front door qr walk in', module: 'kiosk' },
    { id: 'comforts', title: 'Guest comforts', meaning: 'Wi-Fi, drinks and little extras', href: T('experience'), words: 'wifi drinks refreshments hospitality concierge' },
    { id: 'aftercare', title: 'Aftercare', meaning: 'What’s sent after a visit, and when', href: '/settings/aftercare', words: 'aftercare after visit follow up check in care instructions' },
    { id: 'hosting', title: 'Hosting and floor', meaning: 'Tables, seating and the host screen', href: '/settings/hosting', words: 'hosting host tables seating floor plan parties', module: 'hospitality' },
    { id: 'tableservice', title: 'Tables, kitchen and bar', meaning: 'Stations, courses and what a server can comp', href: '/menu#table-service', words: 'courses fire stations bar kitchen expo comp void allowance reasons', module: 'hospitality', inShell: false },
    { id: 'closing', title: 'Closing the night', meaning: 'The closing checklist, temperatures and who gets the night’s report', href: '/settings/closing', words: 'closing checklist temperature fridge freezer report end of night tips close', module: 'hospitality' },
  ] },
  { id: 'messages', title: 'Client messages', meaning: 'The words clients get, replies, links and what was sent', pages: [
    { id: 'wording', title: 'Messages clients get', meaning: 'Confirmations, reminders and receipts, and quiet hours', href: '/settings/messages', words: 'message wording text sms email template confirmation reminder quiet hours' },
    { id: 'replies', title: 'Ready replies', meaning: 'Wording your team picks when answering shop customers', href: '/settings/replies', words: 'replies canned responses templates wording answers', module: 'retail' },
    { id: 'embeds', title: 'Links and embeds', meaning: 'A Book button and live menu for your own website, and links to share', href: '/settings/embeds', words: 'links embed website book button menu share qr assistant' },
    { id: 'voice', title: 'Phone assistant', meaning: 'What it knows and how it sounds', href: '/voice', words: 'voice phone calls assistant receptionist', module: 'voice', inShell: false },
    { id: 'sent', title: 'Sent messages', meaning: 'Every email and text, and whether it arrived', href: '/message-log', words: 'sent delivered failed history message log', inShell: false },
  ] },
  { id: 'payments', title: 'Payments', meaning: 'Payouts, the card reader, sales tax and checkout', pages: [
    { id: 'payouts', title: 'Payments and payouts', meaning: 'Taking cards, sales tax, tips, paying later and checkout', href: T('payments'), words: 'stripe bank payout card connect sales tax tips pay later voids client screen checkout' },
    { id: 'reader', title: 'Card reader', meaning: 'Taking cards in person', href: T('terminal'), words: 'terminal tap to pay reader pos' },
  ] },
  { id: 'shop', title: 'Shop', meaning: 'Your online shop, from getting orders to packing them', pages: [
    { id: 'basics', title: 'Shop basics', meaning: 'Open or paused, checkout, labels and packing', href: '/retail-orders/settings', words: 'shop open paused cart hold tax tips shipping labels packing', module: 'retail' },
    { id: 'ways', title: 'Ways to get an order', meaning: 'Pickup, curbside, local delivery and shipping, and delivery zones', href: '/retail-orders/policies/delivery', words: 'delivery local delivery zones fees drivers curbside pickup shipping ways second try proof photo', module: 'retail' },
    { id: 'pickup', title: 'Pickup times', meaning: 'Pickup hours, windows and same-day cutoffs', href: '/retail-orders/policies/pickup', words: 'pickup times windows hours cutoff pause order ahead', module: 'retail' },
    { id: 'shipping', title: 'Shipping', meaning: 'Shipping days, cutoffs and holidays', href: '/retail-orders/policies/shipping', words: 'shipping ship days cutoff carrier holidays transit', module: 'retail' },
    { id: 'returns', title: 'Returns and refunds', meaning: 'Returns, fees, claims and refunds the shop gives on its own', href: '/retail-orders/policies', words: 'returns refunds restocking claims insurance signature fraud policies', module: 'retail' },
    { id: 'digital', title: 'Digital products', meaning: 'Downloads, licenses and who bought', href: '/inventory/digital', words: 'digital download license files library', module: 'retail', inShell: false },
    { id: 'wholesale', title: 'Wholesale', meaning: 'Buyers, tax exemption, applications and the house code', href: '/retail-orders/wholesale', words: 'wholesale buyers resale certificate tax exempt house code applications', module: 'retail', inShell: false },
    { id: 'offers', title: 'Bundles and kits', meaning: 'Products sold together', href: '/retail-orders/offers', words: 'bundles kits offers sets', module: 'retail' },
    { id: 'discovery', title: 'Search and assistants', meaning: 'How search engines and assistants read your shop', href: '/retail-orders/discovery', words: 'google feed search assistants discovery', module: 'retail' },
    { id: 'capacity', title: 'Busy days', meaning: 'How many orders a day can take', href: '/retail-orders/capacity', words: 'capacity busy days orders per day', module: 'retail' },
    { id: 'alerts', title: 'Order alerts', meaning: 'Who hears about new orders, and how', href: '/retail-orders/alerts', words: 'alerts notifications new orders', module: 'retail' },
    { id: 'design', title: 'Shop design', meaning: 'Colors, layout and the product page', href: '/retail-orders/designer', words: 'design theme colors layout product page designer look', module: 'retail' },
  ] },
  { id: 'team', title: 'Team and approvals', meaning: 'Roles, what each can do, the time clock and pay', pages: [
    { id: 'roles', title: 'Roles and access', meaning: 'Roles and what each one can see and do', href: '/settings/roles', words: 'roles permissions access who sees what staff privacy' },
    { id: 'clock', title: 'Time clock and pay', meaning: 'Clocking in, pay periods, breaks and overtime', href: T('timeclock'), words: 'clock in out timesheet pin geofence overtime breaks pay period', module: 'team' },
  ] },
  { id: 'rooms', title: 'Rooms and cleaning', meaning: 'Stations, rooms and cleaning between visits', pages: [
    { id: 'cleaning', title: 'Cleaning', meaning: 'Cleaning steps between visits', href: T('operations'), words: 'cleaning protocol sanitize disinfect turnover checklist' },
    { id: 'stations', title: 'Stations and rooms', meaning: 'Rooms, chairs and equipment your services need', href: '/resources', words: 'stations rooms equipment resources chairs', inShell: false },
  ] },
  { id: 'auto', title: 'Automations', meaning: 'Everything the app does on its own, one switch each', pages: [
    { id: 'all', title: 'Automations', meaning: 'Reminders, follow-ups and other things the app does on its own', href: '/settings/automations', words: 'automation automatic reminders follow up thank you win back rent digest switch on off' },
  ] },
  { id: 'tools', title: 'Your tools', meaning: 'Reviews, referrals, loyalty, gift cards and more', pages: [
    { id: 'referrals', title: 'Referrals', meaning: 'Your referral program and its welcome page', href: '/referrals/settings', words: 'referrals refer a friend program rewards', module: 'marketing' },
    { id: 'reviews', title: 'Reviews', meaning: 'Showing reviews and asking for them', href: '/reviews', words: 'reviews ratings ask for review show hide', inShell: false },
    { id: 'loyalty', title: 'Loyalty', meaning: 'Points and rewards for regulars', href: '/loyalty', words: 'loyalty points rewards regulars', inShell: false },
    { id: 'giftcards', title: 'Gift cards', meaning: 'Selling gift cards online, amounts and designs', href: '/gift-cards', words: 'gift cards online designs amounts', inShell: false },
    { id: 'booths', title: 'Booth rentals', meaning: 'Booking rules for booths and suites', href: '/booths?settings=1', words: 'booth chair suite rent renter lease tour no-show fee', module: 'booth_rental', inShell: false },
    { id: 'academy', title: 'Academy', meaning: 'Courses, students and your school website', href: '/academy', words: 'school courses students admissions website', module: 'academy', inShell: false },
  ] },
];

export const pageVisibleFor = (tenant: any, p: SettingsPageEntry) => (!p.module || moduleEnabled(tenant, p.module)) && settingVisible(tenant, p.href);

/** The groups and pages this business sees: tools it doesn't use never show, and an empty group never shows. */
export function visibleGroups(tenant: any): SettingsGroup[] {
  return SETTINGS_GROUPS.map((g) => ({ ...g, pages: g.pages.filter((p) => pageVisibleFor(tenant, p)) })).filter((g) => g.pages.length);
}

const pathOf = (href: string) => href.split(/[?#]/)[0];
const tabOf = (href: string) => href.match(/[?&]tab=([a-z]+)/)?.[1] || null;
const hashOf = (href: string) => href.split('#')[1] || '';

/** Which settings page a location is: its path, and the ?tab= the tabbed Settings page uses. */
export function settingsPageAt(pathname: string, tab: string | null, hash = ''): { group: SettingsGroup; page: SettingsPageEntry } | null {
  const want = hash.replace(/^#/, '');
  let best: { group: SettingsGroup; page: SettingsPageEntry; score: number } | null = null;
  for (const group of SETTINGS_GROUPS) for (const page of group.pages) {
    if (page.inShell === false) continue;
    const p = pathOf(page.href); const t = tabOf(page.href);
    if (p === '/settings' && !t) continue;
    const pathHit = pathname === p || (p !== '/settings' && pathname.startsWith(p + '/'));
    if (!pathHit) continue;
    if (t && t !== tab) continue;
    if (!t && p === '/settings' && tab) continue;
    // Two pages on one address (Privacy and Cancellations, Booking page and How clients book): the one the address's
    // #part names wins; with no #part, a page without one wins, then the first listed.
    const h = hashOf(page.href);
    const score = p.length + (t ? 100 : 0) + (pathname === p ? 1 : 0) + (h ? (h === want ? 200 : -50) : 0);
    if (!best || score > best.score) best = { group, page, score };
  }
  return best ? { group: best.group, page: best.page } : null;
}

/** Shop pages that open inside Settings, outside the /settings address (until they move there). */
const SHELL_PATHS = SETTINGS_GROUPS.flatMap((g) => g.pages).filter((p) => p.inShell !== false).map((p) => pathOf(p.href)).filter((p) => !p.startsWith('/settings'));

/** True on any page that opens inside Settings: every /settings address, and the settings pages that still live elsewhere. */
export function isSettingsPath(pathname: string): boolean {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return true;
  return SHELL_PATHS.includes(pathname);
}

export function groupById(id: string): SettingsGroup | null {
  return SETTINGS_GROUPS.find((g) => g.id === id) || null;
}

/** A page's address with a value set in its query, before any #part (an existing value of the same name is replaced). */
export function withParam(href: string, key: string, value: string): string {
  const u = new URL(href, 'http://x');
  u.searchParams.set(key, value);
  return u.pathname + u.search.replace(/\+/g, '%20') + u.hash;
}

/** Pages for search: every visible page with its group, title, meaning and other words. */
export function searchPages(tenant: any, q: string) {
  const n = q.trim().toLowerCase(); if (n.length < 2) return [];
  const words = n.split(/\s+/);
  return visibleGroups(tenant).flatMap((g) => g.pages.map((p) => ({ group: g, page: p, hay: `${p.title} ${p.meaning} ${p.words || ''} ${g.title}`.toLowerCase() })))
    .filter((h) => words.every((w) => h.hay.includes(w)))
    .sort((a, b) => Number(!a.page.title.toLowerCase().startsWith(n)) - Number(!b.page.title.toLowerCase().startsWith(n)));
}
