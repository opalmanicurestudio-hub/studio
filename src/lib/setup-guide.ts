// src/lib/setup-guide.ts — SET UP YOUR BUSINESS: the steps a new owner goes through, chosen from the tools the business
// uses. Each step opens the real page (with ?setup=<step> so a Skip / Next bar sits at the bottom). A step is done when
// what it asks for is really there (a logo and phone, a priced service, payments, someone on the team), or, for the
// steps that come with good choices already made (hours, how clients book, cancellations, messages, the shop's ways
// and returns), when the owner has looked and pressed Next. The guide is finished when every step is done or put off;
// it leaves Settings once every step is really done, or when the owner hides it (and it's always under Your business).
// Progress is kept on the business (tenant.setupGuide). Pure.
import { moduleEnabled, type ModuleId } from '@/lib/modules';

export interface GuideStepDef { id: string; title: string; meaning: string; href: string; module?: ModuleId; checked?: true }
export interface GuideFacts { livePriced: number; teamCount: number; toPrice?: number }
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

/** What a checked step needs to be done, read from the business and a few counts. */
function isReallyDone(id: string, t: any, f: GuideFacts): boolean {
  switch (id) {
    case 'details': return !!(t?.name && t?.phone && t?.address);   // a logo is welcome, not required
    case 'services': return f.livePriced > 0;
    case 'payments': return !!(t?.stripeAccountId && t?.stripeChargesEnabled !== false);
    case 'team': return f.teamCount > 1;
    default: return false;
  }
}

function noteFor(id: string, t: any, f: GuideFacts): string | undefined {
  if (id === 'details') { const miss = [!t?.phone && 'phone', !t?.address && 'address'].filter(Boolean) as string[]; return miss.length ? `Add your ${miss.join(' and ')}` : !t?.logoUrl ? 'Add a logo if you have one' : undefined; }
  if (id === 'services') { const toPrice = f.toPrice || 0; if (f.livePriced) return `${f.livePriced} on your booking page${toPrice ? ` · ${toPrice} still need a price` : ''}`; if (toPrice) return `${toPrice} ready for your prices`; }
  if (id === 'team' && f.teamCount > 1) return `${f.teamCount} people`;
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
  return GUIDE_STEPS.filter((s) => (s.id === 'team' ? teamStepShown(t, f) : !s.module || moduleEnabled(t, s.module))).map((s) => {
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
