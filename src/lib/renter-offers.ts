// src/lib/renter-offers.ts — WHAT RENTERS GET: each tool off, included with the space, or an add-on at a monthly price.
//
// The owner sets it in one place ("What renters get" on the rent page, components/renters/WhatRentersGet, saved
// through api/renters/offers). Renters see the same list in their portal (Space, then "What comes with your space",
// components/rent/RenterTools), and the agreement summary they're sent lists it too (lib/renter-documents).
//
// Whether each tool is on is still kept where it always was, so every older check keeps working and nothing changes for
// a business that never opens this:
//   swaps           tenant.renterSwapsEnabled (on unless false)
//   salonGiftCards  tenant.giftCardSettings.renters.salonCards (on unless false)
//   ownGiftCards    tenant.giftCardSettings.renters.ownCards (off unless true)
//   campaigns       tenant.renterCampaigns.mode (on when 'business_covers' or 'renter_pays', who pays for the texts)
//   packages        tenant.renterOffers.packagesOff (on unless true)
// What this adds is the add-on: tenant.renterOffers.addons[key] says a tool that's on is an add-on, at
// renterOffers.prices[key] cents a month. A renter adds it, and can stop it any time, in their portal; theirs is kept on
// their record (renter.addOns[key]) with the price it was added at, which a later price change doesn't touch. Billing it
// each month is lib/renter-addon-billing. Calendar, booking and client reminders always come with the space.
// Pure.

export type OfferMode = 'off' | 'included' | 'addon';
export type OfferKey = 'packages' | 'ownGiftCards' | 'salonGiftCards' | 'campaigns' | 'swaps';
export const OFFER_KEYS: OfferKey[] = ['packages', 'ownGiftCards', 'salonGiftCards', 'campaigns', 'swaps'];

export type OfferDef = {
  key: OfferKey;
  ownerTitle: string; ownerSub: string;
  /** What the renter calls it (the business's name filled in). */
  renterTitle: (biz: string) => string;
  /** The same, inside a sentence ("… is an add-on here"), and whether it reads as plural. */
  noun: (biz: string) => string; plural: boolean;
  renterSub: (biz: string) => string;
  /** Where the renter uses it in their portal (components/rent/portal-map), or null. */
  view: string | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const bizOf = (b?: string) => String(b || '').trim() || 'the business';

export const OFFER_DEFS: OfferDef[] = [
  { key: 'packages', ownerTitle: 'Packages and memberships', ownerSub: 'Prepaid bundles and monthly plans they sell to their own clients, paid into their own account.',
    renterTitle: () => 'Packages and memberships', noun: () => 'packages and memberships', plural: true,
    renterSub: (b) => `Sell bundles and monthly plans. Paid into your own account, not ${b}’s.`, view: 'setup:packages' },
  { key: 'ownGiftCards', ownerTitle: 'Their own gift cards', ownerSub: 'Gift cards in their own name, paid into their own account.',
    renterTitle: () => 'Your own gift cards', noun: () => 'selling your own gift cards', plural: false,
    renterSub: () => 'Sell gift cards in your own name, at the chair or on your booking page.', view: 'giftcards' },
  { key: 'salonGiftCards', ownerTitle: 'Your gift cards', ownerSub: 'Clients can pay them with your gift cards. You credit the amount against their rent.',
    renterTitle: (b) => `${cap(b)} gift cards`, noun: (b) => `taking ${b} gift cards`, plural: false,
    renterSub: (b) => `Clients can pay you with a ${b} gift card. The amount comes off your rent.`, view: 'giftcards' },
  { key: 'campaigns', ownerTitle: 'Win-back campaigns', ownerSub: 'One email or text to a group of their own past clients, in their own name.',
    renterTitle: () => 'Win-back campaigns', noun: () => 'win-back campaigns', plural: true,
    renterSub: () => 'One message to a group of your past clients.', view: 'campaigns' },
  { key: 'swaps', ownerTitle: 'Swap days', ownerSub: 'Renters trade time with each other directly. Rent never moves, so there’s nothing for you to approve.',
    renterTitle: () => 'Swap days', noun: () => 'swap days', plural: true,
    renterSub: () => 'Trade time in the space with another renter.', view: 'swaps' },
];
export const offerDef = (k: OfferKey) => OFFER_DEFS.find((d) => d.key === k)!;
export const isOfferKey = (k: unknown): k is OfferKey => (OFFER_KEYS as string[]).includes(String(k));

export type CampaignPayer = 'renter_pays' | 'business_covers';
export type Offers = {
  modes: Record<OfferKey, OfferMode>;
  /** Monthly price of each add-on, in cents. Kept while a tool isn't an add-on, so switching back brings it back. */
  prices: Record<OfferKey, number>;
  /** Campaign texts: who pays, how many a month the business covers for each renter, and the price of each one after. */
  campaignPayer: CampaignPayer; monthlyTexts: number; perTextCents: number;
  /** Bumped on every save; a renter's add-on remembers the version it was added under. */
  version: number;
};

const clampInt = (v: any, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const PRICE_MIN_CENTS = 100, PRICE_MAX_CENTS = 100000;

/** What renters get at this business. A business that never saved it gets exactly what it had: each tool on or off as
 *  before, and none of them an add-on. */
export function resolveOffers(tenant: any): Offers {
  const o = tenant?.renterOffers || {};
  const rc = tenant?.renterCampaigns || {};
  const gc = tenant?.giftCardSettings?.renters || {};
  const on: Record<OfferKey, boolean> = {
    packages: o.packagesOff !== true,
    ownGiftCards: gc.ownCards === true,
    salonGiftCards: gc.salonCards !== false,
    campaigns: rc.mode === 'business_covers' || rc.mode === 'renter_pays',
    swaps: tenant?.renterSwapsEnabled !== false,
  };
  const modes = {} as Record<OfferKey, OfferMode>; const prices = {} as Record<OfferKey, number>;
  for (const k of OFFER_KEYS) {
    prices[k] = clampInt(o.prices?.[k], 0, PRICE_MAX_CENTS, 0);
    // An add-on with no price saved can't be charged, so it counts as included.
    modes[k] = !on[k] ? 'off' : o.addons?.[k] === true && prices[k] >= PRICE_MIN_CENTS ? 'addon' : 'included';
  }
  return {
    modes, prices,
    campaignPayer: rc.mode === 'business_covers' ? 'business_covers' : 'renter_pays',
    monthlyTexts: clampInt(rc.monthlyTexts ?? 100, 0, 5000, 100),
    perTextCents: clampInt(rc.priceCentsPerText ?? 2, 1, 50, 2),
    version: clampInt(o.version, 0, 1_000_000, 0),
  };
}

export type AddOn = {
  status: 'active' | 'stopped' | 'paused';
  priceCents: number; startedAt: string; version: number;
  /** The next day it's charged (the day it was added, then a month on each time), and the day of the month it falls on. */
  nextBillOn?: string | null; billDay?: number;
  /** Paid through this day (exclusive): a stopped or paused add-on keeps working until then. */
  paidThrough?: string | null;
  stoppedAt?: string | null; stoppedWhy?: 'renter' | 'included' | 'off' | 'lease_ended' | 'declined' | 'no_card' | 'not_through' | null;
  /** A month's charge didn't go through (lib/renter-addon-billing). */
  pausedAt?: string | null; pausedWhy?: 'declined' | 'no_card' | 'not_through' | null;
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** This renter's add-on for a tool while it works: running, or stopped with time already paid for. */
export function activeAddOn(renter: any, key: OfferKey, today: string = todayUtc()): AddOn | null {
  const a = renter?.addOns?.[key];
  if (!a || typeof a !== 'object') return null;
  if (a.status === 'active') return a as AddOn;
  if ((a.status === 'stopped' || a.status === 'paused') && typeof a.paidThrough === 'string' && a.paidThrough > today) return a as AddOn;
  return null;
}
/** Running and still to be charged (not stopped). */
export const runningAddOn = (renter: any, key: OfferKey): AddOn | null => (renter?.addOns?.[key]?.status === 'active' ? renter.addOns[key] as AddOn : null);

/** What a renter's signed lease says comes with their space (lease builder leases, kept on the renter as they sign):
 *  each tool's mode and add-on price, held until `until` (the end of the lease's term, or the end of the notice given
 *  after a change for a lease with no end date; null: no change announced yet). A signed amendment or a renewal
 *  replaces it with the terms then. */
export type SignedOffers = { modes: Partial<Record<OfferKey, OfferMode>>; prices?: Partial<Record<OfferKey, number>>; until: string | null; leaseId?: string | null; at?: string; from?: 'lease' | 'amendment' | 'renewal' };
const RANK: Record<OfferMode, number> = { off: 0, addon: 1, included: 2 };

/** The day a hold is checked against when the caller doesn't say: yesterday in UTC, never later than the business's own
 *  day anywhere, so a hold is never dropped before billing (which uses the business's day) drops it. Without the
 *  business's day a renter can keep their terms up to about a day longer, never shorter; callers that have it pass it. */
const holdDay = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** The signed terms a renter still holds today, or null. */
export function heldOffers(renter: any, today: string = holdDay()): SignedOffers | null {
  const s = renter?.signedOffers;
  if (!s || typeof s !== 'object' || !s.modes || typeof s.modes !== 'object') return null;
  if (typeof s.until === 'string' && s.until && today > s.until) return null;
  return s as SignedOffers;
}

/** What this renter gets today: the business's settings, or, while their signed lease's terms hold, the better of the
 *  two for each tool (included beats an add-on beats off; of two add-on prices, the lower). A change never takes away
 *  what a renter signed for before their lease says it can. */
export function offersFor(offers: Offers, renter: any, today: string = holdDay()): Offers {
  const s = heldOffers(renter, today);
  if (!s) return offers;
  const modes = { ...offers.modes }, prices = { ...offers.prices };
  for (const k of OFFER_KEYS) {
    const sm = s.modes[k]; if (!sm || !(sm in RANK)) continue;
    const sp = Number(s.prices?.[k]) || 0;
    if (RANK[sm] > RANK[modes[k]]) { modes[k] = sm; if (sm === 'addon' && sp >= PRICE_MIN_CENTS) prices[k] = sp; }
    else if (sm === 'addon' && modes[k] === 'addon' && sp >= PRICE_MIN_CENTS) prices[k] = Math.min(prices[k], sp);
  }
  return { ...offers, modes, prices };
}

/** The tools a renter's signed terms keep better than today's settings, and until when. */
export function heldBetter(offers: Offers, renter: any, today: string = holdDay()): { key: OfferKey; until: string | null }[] {
  const s = heldOffers(renter, today); if (!s) return [];
  const eff = offersFor(offers, renter, today);
  return OFFER_KEYS.filter((k) => RANK[eff.modes[k]] > RANK[offers.modes[k]] || (eff.modes[k] === 'addon' && eff.prices[k] < offers.prices[k])).map((key) => ({ key, until: s.until }));
}

/** The signed terms to keep for a renter from what their lease (or amendment) says, held until `until`. */
export function signedOffersFrom(modes: any, prices: any, until: string | null, meta: { leaseId?: string | null; at: string; from: SignedOffers['from'] }): SignedOffers | null {
  if (!modes || typeof modes !== 'object') return null;
  const m: Partial<Record<OfferKey, OfferMode>> = {}, p: Partial<Record<OfferKey, number>> = {};
  for (const k of OFFER_KEYS) {
    if (modes[k] in RANK) m[k] = modes[k];
    const c = Math.round(Number(prices?.[k]) || 0); if (c > 0) p[k] = c;
  }
  return { modes: m, prices: p, until: until || null, leaseId: meta.leaseId || null, at: meta.at, from: meta.from };
}

/** Do two settings differ for any tool (its mode, or an add-on's price)? */
export const offersDiffer = (a: { modes: any; prices?: any }, b: { modes: any; prices?: any }): boolean =>
  OFFER_KEYS.some((k) => a.modes?.[k] !== b.modes?.[k] || (a.modes?.[k] === 'addon' && Number(a.prices?.[k]) !== Number(b.prices?.[k])));

/** Can this renter use the tool now: it comes with the space, or it's an add-on they have (by today's settings, or
 *  their signed lease's while it holds: offersFor). */
export function offerAllows(offers0: Offers, key: OfferKey, renter: any, today?: string): boolean {
  const offers = offersFor(offers0, renter, today);
  const m = offers.modes[key];
  if (m === 'off') return false;
  if (m === 'included') return true;
  return !!activeAddOn(renter, key, today);
}

/** Why a renter can't use a tool, in plain words, or null when they can. */
export function offerBlocked(offers0: Offers, key: OfferKey, renter: any, businessName?: string, today?: string): string | null {
  if (offerAllows(offers0, key, renter, today)) return null;
  const offers = offersFor(offers0, renter, today);
  const d = offerDef(key); const b = bizOf(businessName);
  if (offers.modes[key] === 'off') return `${cap(b)} doesn’t offer ${d.noun(b)} right now.`;
  return `${cap(d.noun(b))} ${d.plural ? 'are' : 'is'} an add-on here. You can add ${d.plural ? 'them' : 'it'} in Space, under What comes with your space.`;
}

export const money = (c: number) => `$${(Math.round(c) / 100).toFixed(c % 100 ? 2 : 0)}`;

export type RenterOfferLine = {
  key: OfferKey; title: string; sub: string; view: string | null;
  /** included: comes with the space · addon: can be added · added: they have it · off: not offered here */
  state: 'included' | 'addon' | 'added' | 'off';
  /** The monthly price: theirs if they have it, else today's. */
  priceCents: number;
  /** Theirs: added on, and (stopped) working until. */
  startedAt?: string | null; endsOn?: string | null; stopped?: boolean;
  /** Paused: a month's charge didn't go through (lib/renter-addon-billing); adding it again starts it. */
  paused?: boolean;
  /** Kept from their signed lease, better than today's settings: until this day (null: until the business announces a
   *  change, then the notice their lease gives). */
  held?: boolean; heldUntil?: string | null;
};

/** The list a renter sees. Every one of these needs bookings, so someone who doesn't book here sees only add-ons they
 *  still have (to stop them). */
export function renterOfferLines(offers0: Offers, renter: any, o: { businessName?: string; booksHere: boolean; today?: string }): RenterOfferLine[] {
  const b = bizOf(o.businessName);
  const offers = offersFor(offers0, renter, o.today);
  const held = new Map(heldBetter(offers0, renter, o.today).map((h) => [h.key, h.until] as const));
  const all = OFFER_DEFS.map((d) => {
    const m = offers.modes[d.key];
    const mine = m === 'addon' ? activeAddOn(renter, d.key, o.today) : null;
    const state: RenterOfferLine['state'] = m === 'off' ? 'off' : m === 'included' ? 'included' : mine ? 'added' : 'addon';
    const stopped = !!mine && mine.status !== 'active';
    return {
      key: d.key, title: d.renterTitle(b), sub: d.renterSub(b), view: d.view, state,
      // Theirs while it runs; stopped (still working until it runs out), adding it again is at today's price.
      priceCents: mine && !stopped ? Number(mine.priceCents) || 0 : offers.prices[d.key],
      startedAt: mine?.startedAt || null, endsOn: stopped ? mine?.paidThrough || null : null, stopped,
      paused: renter?.addOns?.[d.key]?.status === 'paused',
      ...(held.has(d.key) ? { held: true, heldUntil: held.get(d.key) ?? null } : {}),
    };
  });
  return o.booksHere ? all : all.filter((l) => l.state === 'added' && !l.stopped);
}
/** Has an add-on still being charged (so they can always reach it to stop it). */
export const hasRunningAddOn = (renter: any): boolean => OFFER_KEYS.some((k) => !!runningAddOn(renter, k));

/** What changed between two settings, in plain words, for the notice renters get. */
export function offerChanges(before: Offers, after: Offers, businessName?: string): string[] {
  const b = bizOf(businessName);
  const word = (m: OfferMode, cents: number) => (m === 'off' ? 'not offered' : m === 'included' ? 'included with your space' : `an add-on at ${money(cents)} a month`);
  const lines: string[] = [];
  for (const d of OFFER_DEFS) {
    const x = before.modes[d.key], y = after.modes[d.key];
    const priced = x === 'addon' && y === 'addon' && before.prices[d.key] !== after.prices[d.key];
    if (x === y && !priced) continue;
    let line = `${d.renterTitle(b)}: now ${word(y, after.prices[d.key])}, was ${word(x, before.prices[d.key])}.`;
    if (priced) line += ' If you already have it, your price stays the same.';
    if (x === 'addon' && y === 'included') line += ' If you added it, it’s no longer charged.';
    if (x === 'addon' && y === 'off') line += ' If you added it, it’s stopped and no longer charged.';
    if (d.key === 'campaigns' && x === 'off' && y !== 'off') line += ` ${campaignTextsLine(after, b)}`;
    lines.push(line);
  }
  if (after.modes.campaigns !== 'off' && before.modes.campaigns !== 'off'
    && (before.campaignPayer !== after.campaignPayer || before.perTextCents !== after.perTextCents || (after.campaignPayer === 'business_covers' && before.monthlyTexts !== after.monthlyTexts))) {
    lines.push(`Campaign texts have changed. ${campaignTextsLine(after, b)}`);
  }
  return lines;
}

export function campaignTextsLine(o: Offers, businessName?: string): string {
  const b = bizOf(businessName);
  return o.campaignPayer === 'business_covers'
    ? `${cap(b)} covers ${o.monthlyTexts} campaign texts a month for you, then each one is ${o.perTextCents}¢ to your card. Emails are free.`
    : `Each campaign text is ${o.perTextCents}¢ to your card. Emails are free.`;
}

export type OffersInput = {
  modes?: Partial<Record<OfferKey, unknown>>; prices?: Partial<Record<OfferKey, unknown>>;
  campaignPayer?: unknown; monthlyTexts?: unknown; perTextCents?: unknown;
};

/** Check what the owner sent. Returns the settings to save, or what's wrong in plain words. */
export function readOffersInput(input: OffersInput, before: Offers): { ok: true; after: Offers } | { ok: false; error: string } {
  const modes = { ...before.modes }; const prices = { ...before.prices };
  for (const d of OFFER_DEFS) {
    const m = input.modes?.[d.key];
    if (m !== undefined) {
      if (m !== 'off' && m !== 'included' && m !== 'addon') return { ok: false, error: 'Choose off, included or add-on for each one.' };
      modes[d.key] = m;
    }
    const p = input.prices?.[d.key];
    if (p !== undefined && p !== null && p !== '') {
      const c = Math.round(Number(p));
      if (!Number.isFinite(c)) return { ok: false, error: `Enter a monthly price for ${d.ownerTitle.toLowerCase()}.` };
      prices[d.key] = Math.min(PRICE_MAX_CENTS, Math.max(0, c));
    }
    if (modes[d.key] === 'addon' && !(prices[d.key] >= PRICE_MIN_CENTS)) return { ok: false, error: `${d.ownerTitle} needs a monthly price of at least ${money(PRICE_MIN_CENTS)}.` };
  }
  const payer = input.campaignPayer === undefined ? before.campaignPayer : input.campaignPayer;
  if (payer !== 'renter_pays' && payer !== 'business_covers') return { ok: false, error: 'Choose who pays for campaign texts.' };
  return {
    ok: true,
    after: {
      modes, prices, campaignPayer: payer,
      monthlyTexts: input.monthlyTexts === undefined ? before.monthlyTexts : clampInt(input.monthlyTexts, 0, 5000, before.monthlyTexts),
      perTextCents: input.perTextCents === undefined ? before.perTextCents : clampInt(input.perTextCents, 1, 50, before.perTextCents),
      version: before.version + 1,
    },
  };
}

/** The business document's fields for a saved setting: each tool on or off where it's always been kept, and the add-ons. */
export function offersPatch(after: Offers, meta: { at: string; by: string | null }): Record<string, any> {
  const addons = {} as Record<OfferKey, boolean>;
  for (const k of OFFER_KEYS) addons[k] = after.modes[k] === 'addon';
  return {
    renterSwapsEnabled: after.modes.swaps !== 'off',
    giftCardSettings: { renters: { salonCards: after.modes.salonGiftCards !== 'off', ownCards: after.modes.ownGiftCards !== 'off' } },
    renterCampaigns: { mode: after.modes.campaigns === 'off' ? 'off' : after.campaignPayer, monthlyTexts: after.monthlyTexts, priceCentsPerText: after.perTextCents },
    renterOffers: { addons, prices: { ...after.prices }, packagesOff: after.modes.packages === 'off', version: after.version, updatedAt: meta.at, updatedBy: meta.by },
  };
}

/** Each renter's add-ons a new setting ends: a tool now included is no longer charged, and one now off is stopped. */
export function addOnsEnded(before: Offers, after: Offers): { key: OfferKey; why: 'included' | 'off' }[] {
  return OFFER_KEYS.filter((k) => before.modes[k] === 'addon' && after.modes[k] !== 'addon')
    .map((k) => ({ key: k, why: after.modes[k] === 'off' ? 'off' as const : 'included' as const }));
}

/** For the agreement summary: what comes with the space, what can be added, and what isn't offered. */
export function offersForLease(offers: Offers, businessName?: string): string {
  const b = bizOf(businessName);
  const t = (k: OfferKey) => offerDef(k).renterTitle(b);
  const lower = (s: string) => (s.startsWith(cap(b)) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const inc = OFFER_KEYS.filter((k) => offers.modes[k] === 'included').map((k) => lower(t(k)));
  const add = OFFER_KEYS.filter((k) => offers.modes[k] === 'addon').map((k) => `${lower(t(k))} at ${money(offers.prices[k])} a month`);
  const off = OFFER_KEYS.filter((k) => offers.modes[k] === 'off').map((k) => lower(t(k)));
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const parts = [`Your calendar, online booking and client reminders${inc.length ? `, along with ${list(inc)},` : ''} come with the space.`];
  if (add.length) parts.push(`You can add ${list(add)}. An add-on is charged to your saved card each month, with a receipt, and you can stop it any time.`);
  if (off.length) parts.push(`Not offered: ${list(off)}.`);
  return parts.join(' ');
}
