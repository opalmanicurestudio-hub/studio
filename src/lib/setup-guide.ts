// src/lib/setup-guide.ts — SET UP YOUR BUSINESS: the steps a new owner goes through, chosen from the tools the business
// uses. Each step opens the real page (with ?setup=<step> so a Skip / Next bar sits at the bottom). A step is done when
// what it asks for is really there (a logo and phone, a priced service, payments, someone on the team), or, for the
// steps that come with good choices already made (hours, how clients book, cancellations, messages, the shop's ways
// and returns), when the owner has looked and pressed Next. The guide is finished when every step is done or put off;
// it leaves Settings once every step is really done, or when the owner hides it (and it's always under Your business).
// Progress is kept on the business (tenant.setupGuide). A food business (lib/food-setup) has its own steps: its menu and
// prices instead of services, how guests order, its tables, its kitchen screens and printers, and closing the night. A
// business that sells and doesn't take bookings (lib/business-shape takesBookings: a shop, a maker) has its products and
// prices in place of services and the booking steps, then how customers get their orders and opening its online shop
// (design canvas: Seller setup); a business that books and chose the shop at sign-up gets those shop steps too.
// Pure.
import { moduleEnabled, type ModuleId } from '@/lib/modules';
import { foodAnswersOf, isFoodBusiness } from '@/lib/food-setup';
import { takesBookings } from '@/lib/business-shape';

export interface GuideStepDef { id: string; title: string; meaning: string; href: string; module?: ModuleId; checked?: true }
export interface GuideFacts { livePriced: number; teamCount: number; toPrice?: number; menuLive?: number; menuToPrice?: number; productsPriced?: number; productsToPrice?: number; productsOnline?: number }
export interface GuideStep extends GuideStepDef { done: boolean; skipped: boolean; note?: string }

export const GUIDE_STEPS: GuideStepDef[] = [
  { id: 'details', title: 'Your business details', meaning: 'Name, phone and address clients see, and your logo if you have one', href: '/settings?tab=profile', checked: true },
  { id: 'hours', title: 'Hours and locations', meaning: 'When you’re open, and where', href: '/settings?tab=hours' },
  { id: 'services', title: 'Services and prices', meaning: 'What clients can book, how long it takes and what it costs', href: '/services', checked: true },
  { id: 'payments', title: 'Take payments', meaning: 'Connect your bank so you can take cards and get paid', href: '/settings?tab=payments', checked: true },
  { id: 'booking', title: 'How clients book', meaning: 'Book right away, ask you first, or pay a deposit', href: '/settings/booking#rules' },
  { id: 'changes', title: 'Cancellations and no-shows', meaning: 'What happens when plans change', href: '/settings/policies' },
  { id: 'messages', title: 'Messages clients get', meaning: 'Confirmations and reminders, already written for you', href: '/settings/messages' },
  { id: 'shop', title: 'Your shop', meaning: 'Pickup, delivery or shipping, and your return policy', href: '/retail-orders/policies/delivery', module: 'retail' },
  // Shown to a business that said it's a team (whatever tools it uses), not to one that said "just me" (lib/setup-guide teamStepShown).
  { id: 'team', title: 'Your team', meaning: 'Add the people clients book with. If you see clients yourself too, turn on your own hours on your card.', href: '/staff', checked: true },
];

/** A food business's steps (lib/food-setup): the same details, hours, payments and team, with its menu in place of
 *  services and the steps that run service. "ordering" shows when it takes orders ahead or at a drive-thru, "tables"
 *  when it has table service. */
const stepOf = (id: string) => GUIDE_STEPS.find((s) => s.id === id)!;
export const FOOD_GUIDE_STEPS: GuideStepDef[] = [
  stepOf('details'), stepOf('hours'),
  { id: 'menu', title: 'Your menu and prices', meaning: 'What you sell, what goes into each, and its price', href: '/menu', checked: true },
  stepOf('payments'),
  { id: 'ordering', title: 'Ordering ahead', meaning: 'Guests order and pay on their phone, then pick up', href: '/menu#order-ahead', module: 'hospitality' },
  { id: 'tables', title: 'Your tables', meaning: 'The floor plan the host stand seats from', href: '/settings/hosting', module: 'hospitality' },
  { id: 'kitchen', title: 'Kitchen screens and printers', meaning: 'A screen or a printer at each station, so orders reach them', href: '/settings/printers', module: 'hospitality' },
  { id: 'closing', title: 'Closing the night', meaning: 'Your closing checklist and fridge temperatures', href: '/settings/closing', module: 'hospitality' },
  // A food business's team isn't booked: each person's job decides the screen they open on (lib/jobs).
  { ...stepOf('team'), meaning: 'Add the people who work with you, each with their job. Their job decides the screen they open on.' },
];
/** The shop's own steps (lib/shop-setup has the shop's finer list): what it sells, and opening it to customers. */
const PRODUCTS_STEP: GuideStepDef = { id: 'products', title: 'Your products and prices', meaning: 'What you sell, each with its price', href: '/inventory', module: 'retail', checked: true };
const OPEN_STEP: GuideStepDef = { id: 'open', title: 'Open your online shop', meaning: 'A test order first, then customers can buy', href: '/retail-orders/setup', module: 'retail', checked: true };

/** A business that sells and doesn't take bookings: the same details, hours, payments and team, with its products in
 *  place of services, and no booking steps. Its products and shop steps show while the shop's tools are on (they're what
 *  prices products; sign-up switches them on for a business that sells). */
export const SELL_GUIDE_STEPS: GuideStepDef[] = [
  { ...stepOf('details'), meaning: 'Name, phone and address customers see, and your logo if you have one' },
  stepOf('hours'), PRODUCTS_STEP, stepOf('payments'),
  { ...stepOf('shop'), title: 'How customers get their orders' }, OPEN_STEP,
  { ...stepOf('team'), meaning: 'Add the people who work with you.' },
];

/** A business that books and chose the shop at sign-up (the shop's tools switched on, not just never switched off):
 *  its products after its services, and opening its shop after the shop's ways. */
const withShop = (steps: GuideStepDef[]): GuideStepDef[] => steps.flatMap((s) => (s.id === 'services' ? [s, PRODUCTS_STEP] : s.id === 'shop' ? [s, OPEN_STEP] : [s]));

export const ALL_GUIDE_STEP_IDS = new Set([...GUIDE_STEPS, ...FOOD_GUIDE_STEPS, ...SELL_GUIDE_STEPS].map((s) => s.id));

/** Which list a business goes through. */
export function guideKind(t: any): 'food' | 'sell' | 'book' { return isFoodBusiness(t) ? 'food' : takesBookings(t) ? 'book' : 'sell'; }

/** What a checked step needs to be done, read from the business and a few counts. */
function isReallyDone(id: string, t: any, f: GuideFacts): boolean {
  switch (id) {
    case 'details': return !!(t?.name && t?.phone && t?.address);   // a logo is welcome, not required
    case 'services': return f.livePriced > 0;
    case 'payments': return !!(t?.stripeAccountId && t?.stripeChargesEnabled !== false);
    case 'team': return f.teamCount > 1;
    case 'menu': return (f.menuLive || 0) > 0;
    case 'products': return (f.productsPriced || 0) > 0;
    // Opened from Shop setup, or already selling (products online and payments connected), as Shop setup counts it
    // (lib/shop-setup showGuided); never while paused.
    case 'open': return t?.retailSettings?.storePaused !== true && (!!t?.retailSettings?.shopOpenedAt || ((f.productsOnline || 0) > 0 && !!(t?.stripeAccountId || t?.stripeConnectAccountId)));
    default: return false;
  }
}

function noteFor(id: string, t: any, f: GuideFacts): string | undefined {
  if (id === 'details') { const miss = [!t?.phone && 'phone', !t?.address && 'address'].filter(Boolean) as string[]; return miss.length ? `Add your ${miss.join(' and ')}` : !t?.logoUrl ? 'Add a logo if you have one' : undefined; }
  if (id === 'services') { const toPrice = f.toPrice || 0; if (f.livePriced) return `${f.livePriced} on your booking page${toPrice ? ` · ${toPrice} still need a price` : ''}`; if (toPrice) return `${toPrice} ready for your prices`; }
  if (id === 'team' && f.teamCount > 1) return `${f.teamCount} people`;
  if (id === 'menu') { const live = f.menuLive || 0, toPrice = f.menuToPrice || 0; if (live) return `${live} on your menu${toPrice ? `, ${toPrice} still need a price` : ''}`; if (toPrice) return `${toPrice} ready for your prices`; }
  if (id === 'products') { const live = f.productsPriced || 0, toPrice = f.productsToPrice || 0; if (live) return `${live} for sale${toPrice ? `, ${toPrice} still need a price` : ''}`; if (toPrice) return `${toPrice} ready for your prices`; }
  if (id === 'open' && t?.retailSettings?.shopOpenedAt && t?.retailSettings?.storePaused === true) return 'Paused: customers can’t buy right now';
  return undefined;
}

/** Whether the team step is shown: to a business that said it's a team (at signup, or later in How your business
 *  works), whatever tools it uses, and never to one that said "just me". A business that never said either way sees it
 *  when it uses the Team tool, or already has more than one person. */
export function teamStepShown(t: any, f?: GuideFacts): boolean {
  const solo = typeof t?.shape?.solo === 'boolean' ? t.shape.solo : t?.teamSize === 'solo' ? true : t?.teamSize === 'team' ? false : null;
  if (solo !== null) return !solo;
  return moduleEnabled(t, 'team') || (f?.teamCount || 0) > 1;
}

/** The steps this business sees, in order, each done, skipped or still to do. */
export function guideSteps(t: any, f: GuideFacts): GuideStep[] {
  const g = t?.setupGuide || {}; const done = g.done || {}; const skipped = g.skipped || {};
  // How guests order, when the business has said (food setup); before that, ordering ahead and tables both show.
  const food = isFoodBusiness(t); const ways = foodAnswersOf(t)?.ways || null;
  const shown = (s: GuideStepDef) => s.id === 'team' ? teamStepShown(t, f)
    : s.module && !moduleEnabled(t, s.module) ? false
    : s.id === 'ordering' ? !ways || ways.includes('ahead') || ways.includes('drivethru')
    : s.id === 'tables' ? !ways || ways.includes('table')
    : true;
  const kind = food ? 'food' : guideKind(t);
  const list = kind === 'food' ? FOOD_GUIDE_STEPS : kind === 'sell' ? SELL_GUIDE_STEPS : t?.modules?.retail === true ? withShop(GUIDE_STEPS) : GUIDE_STEPS;
  return list.filter(shown).map((s) => {
    const really = s.checked ? isReallyDone(s.id, t, f) : !!done[s.id];
    return { ...s, done: really, skipped: !really && !!skipped[s.id], note: noteFor(s.id, t, f) };
  });
}

/** Where the owner is: how many are done, the next one to do (skipped ones come back last), whether it's finished
 *  (every step done or put off for later: a business that takes cash only can skip payments) and whether every step is
 *  really done. */
export function guideProgress(steps: GuideStep[]) {
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.skipped) || steps.find((s) => !s.done) || null;
  return { doneCount, total: steps.length, next, finished: steps.length > 0 && steps.every((s) => s.done || s.skipped), allDone: steps.length > 0 && doneCount === steps.length };
}

/** Whether the guide shows in Settings: not once every step is really done (kept on the business when it happens), nor
 *  when the owner hid it. Steps put off for later keep it there, quietly, until then. */
export function guideOnShow(t: any): boolean {
  const g = t?.setupGuide || {}; return !g.finishedAt && !g.hidden;
}

/** A step's page with the setup bar on it, keeping the page's own tab and #part. */
export function stepHref(step: GuideStepDef): string {
  const [base, hash] = step.href.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}setup=${step.id}${hash ? '#' + hash : ''}`;
}

/** The next step still to do (not done, not put off) after this one, or null at the end of the list. */
export function stepAfter(steps: GuideStep[], id: string): GuideStep | null {
  const i = steps.findIndex((s) => s.id === id); if (i < 0) return null;
  return steps.slice(i + 1).find((s) => !s.done && !s.skipped) || null;
}

/** Whether anything other than this step is still to do (so the end of the list isn't the end of setting up). */
export function othersLeft(steps: GuideStep[], id: string): boolean {
  return steps.some((s) => s.id !== id && !s.done && !s.skipped);
}
