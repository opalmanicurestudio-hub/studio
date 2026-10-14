// src/lib/circle.ts — THE CIRCLE (design canvas RF16–RF20): the referral program's levels, the rules only. Clients earn
// a tier by bringing friends who had a paid first visit in the last 12 months — Insider (3), Ambassador (6), Icon (12) by
// default — and each tier pays more per friend and gives the friend more. Creators (influencers) join by invitation with
// their own code, offer and reward. Boosts multiply rewards for a short window. Each business names its program
// ("Circle" by default). Every number shown anywhere is real; the business can hide the small ones.
import type { ReferralSettings } from '@/lib/referrals';

export type TierId = 'insider' | 'ambassador' | 'icon';
export interface Tier { id: TierId; name: string; friends: number; rewardCents: number; friendCents: number; perks: string[] }
export interface Boost { id: string; name: string; start: string; end: string; multiplier: number; tiers: TierId[] | null }
export interface CircleSettings {
  on: boolean; name: string; tiers: Tier[];
  season: { name: string; end: string | null; places: number | null; soft: boolean };
  show: { count: boolean; members: boolean; totals: boolean };
  boosts: Boost[];
}
export interface Creator { code: string; handle: string | null; displayName: string | null; line: string | null; friendCents: number; rewardCents: number; pay: 'credit' | 'cash'; cashCents: number; picks: string[]; looks: string[]; since: string }

export const TIER_IDS: TierId[] = ['insider', 'ambassador', 'icon'];
export const DEFAULT_TIERS: Tier[] = [
  { id: 'insider', name: 'Insider', friends: 3, rewardCents: 1500, friendCents: 1500, perks: ['Credit for every friend', 'Early access to new services', 'A birthday treat'] },
  { id: 'ambassador', name: 'Ambassador', friends: 6, rewardCents: 2000, friendCents: 2000, perks: ['More credit for every friend', 'Priority booking: see new times first', 'A free add-on every visit'] },
  { id: 'icon', name: 'Icon', friends: 12, rewardCents: 2500, friendCents: 2500, perks: ['The most credit for every friend', 'Your own page and code', 'A seasonal gift and first look at everything'] },
];
export const CIRCLE_DEFAULTS: CircleSettings = { on: false, name: 'Circle', tiers: DEFAULT_TIERS, season: { name: '', end: null, places: null, soft: true }, show: { count: true, members: true, totals: true }, boosts: [] };

const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
const str = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
const isoOrNull = (v: any) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export function circleOf(tenant: any): CircleSettings {
  const c = tenant?.referrals?.circle || {};
  const raw = Array.isArray(c.tiers) ? c.tiers : [];
  const tiers = DEFAULT_TIERS.map((d) => { const t = raw.find((x: any) => x?.id === d.id) || {};
    return { id: d.id, name: str(t.name, 24) || d.name, friends: n(t.friends, 1, 200, d.friends), rewardCents: n(t.rewardCents, 0, 50000, d.rewardCents), friendCents: n(t.friendCents, 0, 50000, d.friendCents),
      perks: (Array.isArray(t.perks) ? t.perks : d.perks).map((p: any) => str(p, 80)).filter(Boolean).slice(0, 5) }; });
  // Higher tiers always need more friends than lower ones.
  for (let i = 1; i < tiers.length; i++) if (tiers[i].friends <= tiers[i - 1].friends) tiers[i].friends = tiers[i - 1].friends + 1;
  const boosts: Boost[] = (Array.isArray(c.boosts) ? c.boosts : []).map((b: any) => ({ id: str(b.id, 40) || `b${Math.random().toString(36).slice(2, 8)}`, name: str(b.name, 60) || 'Double credit',
    start: isoOrNull(b.start) || '', end: isoOrNull(b.end) || '', multiplier: Math.max(1, Math.min(5, Number(b.multiplier) || 2)), tiers: Array.isArray(b.tiers) ? b.tiers.filter((x: any) => TIER_IDS.includes(x)) : null }))
    .filter((b: Boost) => b.start && b.end && Date.parse(b.end) > Date.parse(b.start)).slice(-12);
  return { on: c.on === true, name: str(c.name, 30) || 'Circle', tiers, boosts,
    season: { name: str(c.season?.name, 30), end: isoOrNull(c.season?.end), places: c.season?.places == null || c.season?.places === '' ? null : n(c.season.places, 1, 10000, 50), soft: c.season?.soft !== false },
    show: { count: c.show?.count !== false, members: c.show?.members !== false, totals: c.show?.totals !== false } };
}

/** "The Opal Circle". */
export const programName = (C: CircleSettings, business: string) => `${business} ${C.name}`.trim();

/** The tier a client has earned with this many friends (paid first visits, last 12 months), or null. */
export function tierFor(friends: number, C: CircleSettings): Tier | null {
  let got: Tier | null = null; for (const t of C.tiers) if (friends >= t.friends) got = t; return got;
}
export function tierById(C: CircleSettings, id: any): Tier | null { return C.tiers.find((t) => t.id === id) || null; }
/** The higher of two tiers (tiers only move up; they're rechecked after a quiet stretch). */
export function higher(C: CircleSettings, a: TierId | null | undefined, b: TierId | null | undefined): TierId | null {
  const ia = a ? TIER_IDS.indexOf(a) : -1, ib = b ? TIER_IDS.indexOf(b) : -1; const i = Math.max(ia, ib); return i >= 0 ? TIER_IDS[i] : null;
}
/** One level below (null below the first). */
export function below(id: TierId | null | undefined): TierId | null { const i = id ? TIER_IDS.indexOf(id) : -1; return i > 0 ? TIER_IDS[i - 1] : null; }
/** The level a member starts a new season at: what they've earned, and with a soft landing never more than one below where they were. */
export function seasonTier(C: CircleSettings, stored: TierId | null, earned: TierId | null, granted: boolean): TierId | null {
  if (granted) return stored;
  return C.season.soft ? higher(C, earned, below(stored)) : earned;
}
/** What's next, and how many more friends it takes. */
export function nextTier(friends: number, C: CircleSettings, current: TierId | null): { tier: Tier; need: number } | null {
  const idx = current ? TIER_IDS.indexOf(current) : -1; const t = C.tiers[idx + 1]; if (!t) return null;
  return { tier: t, need: Math.max(1, t.friends - friends) };
}

/** A boost running right now for this tier (or everyone), if any. */
export function activeBoost(C: CircleSettings, now: number, tier: TierId | null): Boost | null {
  return C.boosts.find((b) => Date.parse(b.start) <= now && now < Date.parse(b.end) && (!b.tiers || !b.tiers.length || (!!tier && b.tiers.includes(tier)))) || null;
}

/** What the person who referred earns for one friend: a creator's own amount, else their tier's, else the program's — times a boost. */
export function rewardFor(S: ReferralSettings, C: CircleSettings, tier: TierId | null, now: number, creator?: Creator | null): { cents: number; boost: Boost | null; cashCents: number } {
  const base = creator ? creator.rewardCents : (C.on && tier ? (tierById(C, tier)?.rewardCents ?? S.rewardCents) : S.rewardCents);
  const boost = C.on ? activeBoost(C, now, tier) : null;
  return { cents: Math.round(base * (boost?.multiplier || 1)), boost, cashCents: creator && creator.pay === 'cash' ? creator.cashCents : 0 };
}
/** What the friend gets off their first visit. */
export function friendOfferFor(S: ReferralSettings, C: CircleSettings, tier: TierId | null, creator?: Creator | null): number {
  if (creator) return creator.friendCents;
  return C.on && tier ? (tierById(C, tier)?.friendCents ?? S.friendCents) : S.friendCents;
}

/** Codes people type: letters and digits, upper case ("hannah 15" → HANNAH15). */
export const normalizeCode = (v: any) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
/** A client's own code: their first name and the friend's dollars ("HANNAH15"); a suffix keeps it unique. */
export function typedCodeFor(name: any, friendCents: number, taken: (c: string) => boolean): string {
  const first = String(name || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10) || 'FRIEND';
  const d = Math.round((Number(friendCents) || 0) / 100); const base = `${first}${d || ''}`;
  if (!taken(base)) return base;
  for (let i = 2; i < 100; i++) { const c = `${first}${i}${d ? `X${d}` : ''}`.slice(0, 16); if (!taken(c)) return c; }
  return `${first}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** The welcome discount's id and code for an amount (each amount is its own approved discount). */
export const welcomeIdFor = (cents: number, base: number) => (cents === base ? 'referral_welcome' : `referral_welcome_${cents}`);
export const welcomeCodeFor = (cents: number, base: number) => (cents === base ? 'FRIEND-WELCOME' : `FRIEND-WELCOME-${Math.round(cents / 100)}`);

/** A creator, as the business set them up (code, offer, reward, how they're paid, their picks and looks). */
export function creatorOf(raw: any): Creator | null {
  if (!raw || typeof raw !== 'object' || !normalizeCode(raw.code)) return null;
  return { code: normalizeCode(raw.code), handle: str(raw.handle, 40).replace(/^@?/, '@').replace(/^@$/, '') || null, displayName: str(raw.displayName, 60) || null, line: str(raw.line, 200) || null,
    friendCents: n(raw.friendCents, 0, 50000, 2000), rewardCents: n(raw.rewardCents, 0, 50000, 1500), pay: raw.pay === 'cash' ? 'cash' : 'credit', cashCents: n(raw.cashCents, 0, 100000, 0),
    picks: (Array.isArray(raw.picks) ? raw.picks : []).map((x: any) => str(x, 80)).filter(Boolean).slice(0, 4),
    looks: (Array.isArray(raw.looks) ? raw.looks : []).filter((u: any) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 6), since: str(raw.since, 30) };
}
