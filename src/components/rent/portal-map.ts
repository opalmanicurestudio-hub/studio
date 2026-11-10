// src/components/rent/portal-map.ts — THE RENTER PORTAL'S PLACES, and which screens each renter can reach.
//
// Five places at the bottom (app/rent/[tenantId]/page.tsx): Today, Calendar, Clients, Money, Space. Someone who
// doesn't take bookings here has three (Today, Money, Space). Each place lists rows; a row opens one screen. Business
// setup sits behind the header's gear. What a renter can reach depends on four things about them (Who), and this file
// is the one place that decides it, so the page and its checks agree.
//
// Opening a screen is a step in the browser's history (portalStep counts them), so the phone's own back gesture
// closes the screen instead of leaving the portal, and Back never walks past the portal's own first step.

export type PortalTab = 'today' | 'calendar' | 'clients' | 'money' | 'space';
export const TAB_LABEL: Record<PortalTab, string> = { today: 'Today', calendar: 'Calendar', clients: 'Clients', money: 'Money', space: 'Space' };
const TABS: PortalTab[] = ['today', 'calendar', 'clients', 'money', 'space'];

/** Older links and Today's rows still say book, rent and studio. */
export function tabFor(t: unknown): PortalTab {
  const x = String(t || '');
  if (x === 'book') return 'calendar';
  if (x === 'rent') return 'money';
  if (x === 'studio') return 'space';
  return (TABS as string[]).includes(x) ? (x as PortalTab) : 'today';
}

export const VIEW_TITLES: Record<string, string> = {
  notices: 'Messages and notices', repairs: 'Something broken?', concerns: 'Raise a concern', lease: 'Lease and documents',
  rules: 'House rules', insurance: 'Insurance and license', away: 'Time away', closures: 'Closures', swaps: 'Swap days',
  history: 'Payments and past bookings', books: 'Earnings and expenses', payouts: 'Payouts',
  followups: 'Follow-ups', campaigns: 'Campaigns', reconnect: 'Win back', giftcards: 'Gift cards', clientdocs: 'Client documents',
  setup: 'Business setup', 'setup:page': 'Your booking page', 'setup:services': 'Services', 'setup:hours': 'Hours',
  'setup:packages': 'Packages and memberships', 'setup:profile': 'Your profile', 'setup:number': 'Your number',
  'setup:messages': 'Client messages', 'setup:alerts': 'Your own alerts', 'setup:payments': 'Card payments',
};
export const VIEW_PARENT: Record<string, PortalTab> = {
  notices: 'space', repairs: 'space', concerns: 'space', lease: 'space', rules: 'space', insurance: 'space', away: 'space', closures: 'space', swaps: 'space',
  history: 'money', books: 'money', payouts: 'money', followups: 'clients', campaigns: 'clients', reconnect: 'clients', giftcards: 'clients', clientdocs: 'clients',
};
/** Where Back goes with no step to retrace (opened from a link): a setup screen to Business setup, anything else to its place. */
export const VIEW_BACK: Record<string, string> = Object.fromEntries(Object.keys(VIEW_TITLES).filter((k) => k.startsWith('setup:')).map((k) => [k, 'setup']));

/** Screens that only make sense for someone who takes bookings here. */
export const BOOKS_ONLY = new Set(['books', 'payouts', 'followups', 'campaigns', 'reconnect', 'giftcards', 'clientdocs', ...Object.keys(VIEW_TITLES).filter((k) => k.startsWith('setup:'))]);
/** Screens that read or write the renter's own record (an account not yet linked to one has none). */
export const RENTER_ONLY = new Set(['notices', 'repairs', 'concerns', 'lease', 'rules', 'insurance', 'closures', 'away', 'swaps', 'followups', 'clientdocs']);

/** What decides what a renter can reach. */
export type Who = { booksHere: boolean; hasRenter: boolean; hasLease: boolean; swapsOn: boolean };

export function placesFor(w: Who): PortalTab[] {
  return w.booksHere ? TABS : ['today', 'money', 'space'];
}
/** The place to show: the one asked for if this renter has it, otherwise Today. */
export function shownPlace(tab: PortalTab, w: Who): PortalTab {
  return placesFor(w).includes(tab) ? tab : 'today';
}
export function viewAllowed(v: string | null | undefined, w: Who): boolean {
  if (!v || !VIEW_TITLES[v]) return false;
  if (BOOKS_ONLY.has(v) && !w.booksHere) return false;
  if (RENTER_ONLY.has(v) && !w.hasRenter) return false;
  if (v === 'away' && !w.hasLease) return false;
  if (v === 'swaps' && !w.swapsOn) return false;
  return true;
}
/** The screen to show: the one asked for if this renter can open it, otherwise none (the place itself). */
export function shownView(v: string | null | undefined, w: Who): string | null {
  return viewAllowed(v, w) ? (v as string) : null;
}

export type RowGroupSpec = { id: string; title: string; views: string[] };
/** The rows each place lists for this renter, in order. Groups left empty aren't shown. */
export function placeRows(tab: PortalTab, w: Who): RowGroupSpec[] {
  const groups: RowGroupSpec[] =
    tab === 'space' ? [
      { id: 'talk', title: '', views: ['notices', 'repairs', 'concerns'] },
      { id: 'papers', title: 'Your lease and papers', views: ['lease', 'rules', 'insurance'] },
      { id: 'time', title: 'Time in the space', views: ['away', 'swaps', 'closures'] },
    ]
    : tab === 'clients' ? [
      { id: 'grow', title: 'Grow', views: ['followups', 'campaigns', 'reconnect'] },
      { id: 'selling', title: 'Selling and records', views: ['giftcards', 'clientdocs', 'setup:packages'] },
    ]
    : tab === 'money' ? [
      { id: 'with', title: 'With the business', views: ['history'] },
      { id: 'business', title: 'Your business', views: ['books', 'payouts'] },
    ]
    : [];
  return groups.map((g) => ({ ...g, views: g.views.filter((v) => viewAllowed(v, w)) })).filter((g) => g.views.length > 0);
}
/** Business setup's rows (the header's gear): everything about running the business here, for those who book here. */
export function setupRows(w: Who): RowGroupSpec[] {
  const groups: RowGroupSpec[] = [
    { id: 'find', title: 'How clients find and book you', views: ['setup:page', 'setup:services', 'setup:hours', 'setup:profile'] },
    { id: 'paid', title: 'Getting paid', views: ['setup:payments', 'setup:packages'] },
    { id: 'touch', title: 'Keeping in touch', views: ['setup:messages', 'setup:number', 'setup:alerts'] },
  ];
  return groups.map((g) => ({ ...g, views: g.views.filter((v) => viewAllowed(v, w)) })).filter((g) => g.views.length > 0);
}

/** "Needs you" rows open the thing itself: [place, screen or null for the place]. */
export const NEEDS_TARGET: Record<string, [PortalTab, string | null]> = {
  rent: ['money', null], notice: ['space', 'notices'], message: ['space', 'notices'], document: ['space', 'lease'], rules: ['space', 'rules'],
  ticket: ['space', 'repairs'], concern: ['space', 'concerns'], leave: ['space', 'away'], request: ['calendar', null], prep: ['calendar', null], appointment: ['calendar', null],
};
/** Where a Today row goes for this renter: its own screen when they can open it, else its place, else Today. */
export function needsTarget(kind: string | undefined, tab: string | undefined, w: Who): { tab: PortalTab; view: string | null } {
  const t = kind ? NEEDS_TARGET[kind] : undefined;
  if (t) return { tab: shownPlace(t[0], w), view: shownPlace(t[0], w) === t[0] ? shownView(t[1], w) : null };
  return { tab: shownPlace(tabFor(tab), w), view: null };
}

// ── History steps ────────────────────────────────────────────────────────────
type Hist = { state: any; pushState(data: any, unused: string): void; replaceState(data: any, unused: string): void };
export type Spot = { tab: PortalTab; view: string | null };

/** How many portal steps deep this history entry is (0: the portal as it was opened). */
export function stepOf(state: any): number {
  const n = state && typeof state.portalStep === 'number' ? state.portalStep : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
/** Open a screen: the entry they leave remembers exactly where they were, and a new entry, one step deeper, is where
 *  they are now. The router's own state on the entry is kept. Returns the new step. */
export function pushSpot(h: Hist, from: Spot, to: Spot): number {
  const n = stepOf(h.state);
  h.replaceState({ ...(h.state || {}), portalTab: from.tab, portalView: from.view, portalStep: n }, '');
  h.pushState({ ...(h.state || {}), portalTab: to.tab, portalView: to.view, portalStep: n + 1 }, '');
  return n + 1;
}
/** Where they are now, written on this entry without adding a step (switching places). */
export function markSpot(h: Hist, at: Spot): void {
  h.replaceState({ ...(h.state || {}), portalTab: at.tab, portalView: at.view, portalStep: stepOf(h.state) }, '');
}
/** The place and screen an entry remembers (from the phone's back or forward), or null when it remembers none. */
export function spotFromState(state: any): Spot | null {
  if (!state || typeof state.portalTab !== 'string') return null;
  const v = typeof state.portalView === 'string' && VIEW_TITLES[state.portalView] ? state.portalView : null;
  return { tab: tabFor(state.portalTab), view: v };
}
/** What the header's Back does: retrace a portal step, close the screen here (nothing to retrace), or nothing while a
 *  step back is already on its way (a second tap would leave the portal). */
export function backMove(state: any, pending: boolean): 'history' | 'here' | 'wait' {
  if (pending) return 'wait';
  return stepOf(state) > 0 ? 'history' : 'here';
}
