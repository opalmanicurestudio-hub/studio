// src/lib/referrals.ts — REFERRALS, the rules (design canvas RF1–RF4; decided Oct 13). Pure: shared by the server
// (lib/referrals-server) and the pages.
//
// How it works: a client shares their own link, or gifts a friend (first name + mobile, sent from their own phone), or a
// new client says who recommended them (first name + that person's mobile, both must match one client — no list is ever
// shown). The friend gets a welcome offer on their first visit, applied like any manager-approved discount (prices on
// a line never change). The person who referred gets store credit once the friend's first visit is paid and past a day
// (or when the friend books, if the business chose that). Checks: the friend must be new; the same phone or email as
// the person who referred is refused; the same saved card waits for a manager; households (same address) are fine.
// Reviews are never rewarded.
export type RefStatus = 'invited' | 'booked' | 'held' | 'rewarded' | 'declined' | 'unmatched' | 'lapsed';
export interface ReferralSettings { on: boolean; rewardCents: number; friendCents: number; unlock: 'paid' | 'booked'; months: number; cap: number; photos: string[]; arrival: string }
export const REF_DEFAULTS: ReferralSettings = { on: false, rewardCents: 1500, friendCents: 1500, unlock: 'paid', months: 6, cap: 5, photos: [], arrival: '' };
export const WELCOME_ID = 'referral_welcome';
export const WELCOME_CODE = 'FRIEND-WELCOME';

export function referralSettingsOf(tenant: any): ReferralSettings {
  const r = tenant?.referrals || {}; const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  return { on: r.on === true, rewardCents: n(r.rewardCents, 0, 50000, REF_DEFAULTS.rewardCents), friendCents: n(r.friendCents, 0, 50000, REF_DEFAULTS.friendCents),
    unlock: r.unlock === 'booked' ? 'booked' : 'paid', months: n(r.months, 1, 24, REF_DEFAULTS.months), cap: n(r.cap, 1, 50, REF_DEFAULTS.cap),
    // The welcome page: up to 3 of the business's own photos, and a line about arriving (parking, which door…).
    photos: (Array.isArray(r.photos) ? r.photos : []).filter((u: any) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 3), arrival: String(r.arrival || '').trim().slice(0, 200) };
}

export const last10 = (v: any) => String(v || '').replace(/\D+/g, '').slice(-10);
export const firstOf = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
export const sameFirst = (a: any, b: any) => { const x = firstOf(a).toLowerCase().replace(/[^a-z]/g, ''); const y = firstOf(b).toLowerCase().replace(/[^a-z]/g, ''); return !!x && x === y; };
export const dollars = (cents: number) => { const d = (Number(cents) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };

/** A short, friendly link name: "hannah-k4m2". */
export function slugFor(name: any, rand: string): string {
  const f = firstOf(name).toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || 'friend';
  return `${f}-${String(rand).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)}`;
}

/** Two saved cards that are the same card (by id, or by brand + last four + expiry). */
export function sameCard(a: any, b: any): boolean {
  const x = a?.cardOnFile || {}; const y = b?.cardOnFile || {};
  if (x.paymentMethodId && x.paymentMethodId === y.paymentMethodId) return true;
  return !!(x.last4 && x.last4 === y.last4 && String(x.brand || '').toLowerCase() === String(y.brand || '').toLowerCase() && x.expMonth && x.expMonth === y.expMonth && x.expYear === y.expYear);
}

/** Why a friend can't be credited to this person at all (refused outright), or null. */
export function refusal(referrer: any, friend: any): string | null {
  if (!referrer || !friend) return 'no_match';
  if (String(referrer.id) === String(friend.id)) return 'self';
  if (last10(referrer.phone) && last10(referrer.phone) === last10(friend.phone)) return 'same_phone';
  const e = (v: any) => String(v || '').trim().toLowerCase();
  if (e(referrer.email) && e(referrer.email) === e(friend.email)) return 'same_email';
  return null;
}

export const STATUS_LABEL: Record<string, string> = { invited: 'Not booked yet', booked: 'Booked', held: 'Waiting for a manager', rewarded: 'Credit given', declined: 'No reward', unmatched: 'To confirm', lapsed: 'Didn’t come in' };
export const HOLD_LABEL: Record<string, string> = { same_card: 'Same saved card as the person who referred', cap: 'Monthly limit reached (given next month)', refunded: 'The visit was refunded' };
export const DECLINE_LABEL: Record<string, string> = { self: 'Referred themselves', same_phone: 'Same phone number', same_email: 'Same email', existing: 'Already a client', refunded: 'The visit was refunded', manager: 'A manager chose no reward' };

/** Plain-words program terms, made from the settings (the terms page). */
export function termsLines(S: ReferralSettings, business: string): string[] {
  return [
    `Share ${business} with a friend. Your friend gets ${dollars(S.friendCents)} off their first visit, and you get ${dollars(S.rewardCents)} in credit${S.unlock === 'paid' ? ' once their first visit is paid' : ' when they book'}.`,
    'Your friend must be new to us. One welcome offer per person.',
    `Credit lasts ${S.months} month${S.months === 1 ? '' : 's'} from the day it is given and is used at your next visits. It has no cash value.`,
    `Up to ${S.cap} rewards a month per person. Referring yourself, or using the same phone, email or card as your friend, isn’t eligible.`,
    'If a friend’s visit is refunded, credit that hasn’t been used is taken back.',
    'Reviews are never rewarded.',
    `${business} may change or end this program at any time. Credit already given stays valid until it ends.`,
  ];
}
