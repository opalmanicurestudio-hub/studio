// src/lib/reviews.ts — REVIEWS, ONE SET OF RULES FOR THE SHOP AND FOR VISITS (mockups 9A to 9D). Shared by the Reviews
// screen, the server and the order page, so they always agree.
//
// A review is Shown or Hidden. A business that reads them first sees new ones as Waiting. Hiding asks for a reason and
// keeps it: hiding a review because it's low misleads shoppers, and the FTC's rule on consumer reviews treats that as
// review suppression, so the reasons are about what the review says (personal details, abuse, spam, not about it),
// never its rating.
//
// THE ASK (shop orders): one email, a set number of days after the order was picked up or delivered (a shipped order
// once the carrier says delivered). Off until the business turns it on. Everyone who received their order is asked, not
// only the ones expected to be happy (the FTC's guidance on asking for reviews); while a problem report or return is
// open, the ask waits until it's settled, however long that takes. Never for a canceled order, a backorder or
// replacement (the order it came from is asked), a wholesale or in-person sale, never twice for one order, never to
// someone who unsubscribed or whose record was archived, and only during the day where the business is (so not at all
// until its time zone is set). A send whose outcome isn't known is never tried again: asking twice is worse.
import { hourIn } from '@/lib/tenant-time';
import { privacyOf } from '@/lib/health-privacy';

export type ReviewKind = 'shop' | 'visit';
export type ReviewState = 'waiting' | 'shown' | 'hidden';
export type HideReason = 'personal' | 'abusive' | 'off_topic' | 'spam';

export const HIDE_REASONS: { id: HideReason; shop: string; visit: string; short: string }[] = [
  { id: 'personal', shop: 'It has personal details (a phone number, an address)', visit: 'It has personal details (a phone number, an address)', short: 'Personal details' },
  { id: 'abusive', shop: 'It’s abusive or hateful', visit: 'It’s abusive or hateful', short: 'Abusive or hateful' },
  { id: 'off_topic', shop: 'It isn’t about this product', visit: 'It isn’t about this visit', short: 'Not about it' },
  { id: 'spam', shop: 'It’s spam, or not from a real customer', visit: 'It’s spam, or not from a real client', short: 'Spam' },
];
export const isHideReason = (v: unknown): v is HideReason => HIDE_REASONS.some((r) => r.id === v);
export const hideReasonShort = (v: unknown) => HIDE_REASONS.find((r) => r.id === v)?.short || '';

/** A shop review's state: published is Shown, pending is Waiting. */
export function shopState(r: any): ReviewState {
  const s = String(r?.status || '');
  return s === 'published' ? 'shown' : s === 'hidden' ? 'hidden' : 'waiting';
}
/** A visit review's state: shown on the booking page, hidden (with its reason), or not decided yet. */
export function visitState(r: any): ReviewState {
  if (r?.isPublic === true) return 'shown';
  return r?.hidden === true ? 'hidden' : 'waiting';
}
export const stateOf = (kind: ReviewKind, r: any): ReviewState => (kind === 'shop' ? shopState(r) : visitState(r));

/* A review nobody decides on shows on its own after AUTO_SHOW_DAYS (from when it arrived, or was last edited), with a
 * heads-up AUTO_SHOW_WARN_DAYS before. Left waiting forever it would be kept off the page like a hidden one, with no
 * reason on record: the review suppression the FTC's rule on consumer reviews is about. Hiding with a reason still
 * works at any time. A rule, not a setting, so it can't be switched off. */
export const AUTO_SHOW_DAYS = 14;
export const AUTO_SHOW_WARN_DAYS = 3;
const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
/** When a review started waiting: when it arrived, or when it was last edited. */
export const waitingSince = (r: any): number => Math.max(ms(r?.createdAt), ms(r?.editedAt));
/** When the 14 days start counting for a business: the first night the rule ran there, so reviews already waiting
 *  when it began get their full 14 days and the heads-up, never shown all at once. The server keeps its own copy
 *  (counters/reviewAutoShow); this one, on the business, is for the screen's countdown. */
export const autoShowFrom = (tenant: any): number => ms(tenant?.reviewSettings?.autoShowFrom);
/** Which waiting reviews the rule shows. Shop reviews waiting to be shown (they're written on a product page, to be
 *  shown). Visit reviews only when the client was told, as they wrote it, that it may be shown (showNotice; earlier ones
 *  were sent as feedback to the business), and never at a health business, where showing a client's review is the
 *  business's own decision. The rest wait for the business, as before. */
export function autoShows(kind: ReviewKind, r: any, tenant: any): boolean {
  if (kind === 'shop') return r?.status === 'pending';
  if (r?.showNotice !== true) return false;
  try { return !privacyOf(tenant).healthMode; } catch { return false; }
}
/** When the heads-up for this review went out (0 if it hasn't, or it was edited since and needs another). */
export const autoShowWarned = (r: any): number => { const w = ms(r?.autoShowWarnedAt); return w && w >= waitingSince(r) ? w : 0; };
/** Whole days until a waiting review shows on its own (0 once it's due): 14 days, and never sooner than three days
 *  after its heads-up (lib/reviews-server sweepWaitingReviews). The nightly run can make it up to a day later than
 *  this says (and allows a few hours' slack on the three days), so the screen doesn't promise more time than there is. */
export function autoShowInDays(r: any, now: number, from = 0): number {
  const D = 864e5; const since = Math.max(waitingSince(r), from) || now;
  const warn = autoShowWarned(r) || Math.max(now, since + (AUTO_SHOW_DAYS - AUTO_SHOW_WARN_DAYS) * D);
  return Math.max(0, Math.ceil((Math.max(since + AUTO_SHOW_DAYS * D, warn + AUTO_SHOW_WARN_DAYS * D) - now) / D));
}

/** "Jessica Marshall" → "Jessica M.": a real person, not their whole name. */
export function reviewerName(raw: unknown, fallback = 'Verified buyer'): string {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 20);
  return `${parts[0].slice(0, 20)} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export const ASK_DAYS = [1, 3, 7] as const;
export type AskSettings = { on: boolean; days: number; onAt: string | null };
export type ReviewSettings = { shopAutoShow: boolean; visitAutoShow: boolean; ask: AskSettings };

/** The business's review settings, with their defaults: shop reviews show right away (as before), visit reviews wait,
 *  and the ask is off. */
export function reviewSettings(tenant: any): ReviewSettings {
  const rs = tenant?.retailSettings || {};
  const a = rs.reviewAsk || {};
  const days = Math.round(Number(a.days));
  return {
    shopAutoShow: rs.reviewsAutoPublish !== false,
    visitAutoShow: tenant?.reviewSettings?.visitsAutoShow === true,
    ask: { on: a.on === true, days: (ASK_DAYS as readonly number[]).includes(days) ? days : 3, onAt: typeof a.onAt === 'string' && a.onAt ? a.onAt : null },
  };
}

export const askWhenWords = (days: number) => (days === 1 ? 'The next day' : days === 7 ? 'A week after' : `${days} days after`);

/** The products on an order a customer can review: physical ones, once each. */
export function reviewableLines(order: any): { productId: string; name: string; variant: string }[] {
  const seen = new Set<string>(); const out: { productId: string; name: string; variant: string }[] = [];
  for (const l of Array.isArray(order?.lines) ? order.lines : []) {
    const pid = String(l?.productId || '').trim();
    if (!pid || l?.digital === true || seen.has(pid)) continue;
    if (Math.max(0, Number(l?.qtyOrdered ?? l?.qty ?? 1) - Number(l?.qtyShorted || 0)) <= 0) continue;
    seen.add(pid);
    out.push({ productId: pid, name: String(l?.name || 'Your item').slice(0, 120), variant: String(l?.optionsLabel || '').slice(0, 80) });
  }
  return out;
}

/** When the customer had the order in hand: picked up or delivered by the team, or delivered by the carrier. */
export function receivedAt(order: any): number {
  const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
  if (String(order?.stage || '') !== 'completed') return 0;
  if (order?.deliveredAt) return ms(order.deliveredAt);
  // A shipped order is completed by the carrier's delivered scan, which sets deliveredAt; its completedAt is when it shipped.
  if (order?.method === 'ship') return 0;
  return ms(order?.completedAt || order?.handoff?.at);
}

const DAY = 864e5;
/** The ask is never sent this long after the order arrived, so turning it on (or a long-open problem) doesn't email
 *  people about orders they've forgotten. */
export const ASK_STALE_DAYS = 30;
/** Daytime where the business is. */
export const ASK_HOURS = { from: 9, to: 19 };

export type AskVerdict = { send: true; due: number } | { wait: 'not_yet' | 'open_problem' | 'night' | 'retry'; due?: number } | { never: string };

/** Is it daytime where the business is (and do we know where that is)? Without a time zone set, never: "9 am" in UTC
 *  is the middle of the night across the US. */
export function askHours(now: number, timeZone: string | null | undefined): boolean {
  if (!timeZone || timeZone === 'UTC') return false;
  const h = hourIn(new Date(now), timeZone);
  return h >= ASK_HOURS.from && h < ASK_HOURS.to;
}

/** Should this order's review email go now? Everything here is about the order and the business; who the customer is
 *  (unsubscribed or archived, already reviewed everything, a problem still open) comes in ctx. */
export function askVerdict(order: any, ctx: { ask: AskSettings; now: number; timeZone?: string | null; openProblem?: boolean; reviewed?: Set<string>; optedOut?: boolean; archived?: boolean; followUp?: boolean; originalArrived?: boolean }): AskVerdict {
  const { ask, now } = ctx;
  if (!ask.on) return { never: 'off' };
  if (order?.isTest) return { never: 'test' };
  const st = order?.reviewAsk?.state;
  if (st === 'sent' || st === 'skipped') return { never: 'done' };
  // Claimed and never finished: the email may well have gone (the run stopped, or the last write didn't land). Asking
  // twice is worse than not asking, so it isn't tried again.
  if (st === 'sending') return Date.parse(String(order.reviewAsk.at || '')) > now - 15 * 60e3 ? { wait: 'retry' } : { never: 'unknown' };
  if (st === 'failed') {
    if (Number(order.reviewAsk.tries || 0) >= 3) return { never: 'failed' };
    if (now - Date.parse(String(order.reviewAsk.at || '')) < 45 * 60e3) return { wait: 'retry' };
  }
  // Backorders, preorders sent later and replacements are part of the order they came from: that one is asked. Except
  // a replacement for a parcel that never arrived: the order it came from can't be asked, so this one is.
  if (ctx.followUp && (order?.replacementFor !== 'lost_in_transit' || ctx.originalArrived)) return { never: 'follow_up' };
  // Bought for a business at wholesale, or rung up in person (no online checkout makes an in-store order): not an online
  // order picked up or delivered.
  if (order?.wholesaleAccountId || order?.priceTier === 'wholesale') return { never: 'wholesale' };
  if (order?.method === 'in_store') return { never: 'in_store' };
  if (!String(order?.customerEmail || '').includes('@')) return { never: 'no_email' };
  if (!order?.clientId) return { never: 'no_client' };
  if (ctx.optedOut) return { never: 'unsubscribed' };
  // A client the business archived: not now, but not for good (restored, they can be asked).
  if (ctx.archived) return { wait: 'retry' };
  const got = receivedAt(order);
  if (!got) return { never: 'not_received' };
  const onAt = Date.parse(String(ask.onAt || ''));
  if (!Number.isFinite(onAt) || got < onAt) return { never: 'before_on' };
  // A problem that kept the ask waiting moves the cutoff on: someone whose report took weeks is still asked once it's
  // settled (lib/reviews-server marks the order "held" while it waits).
  const heldAt = st === 'held' ? Date.parse(String(order.reviewAsk.at || '')) : NaN;
  if (now - Math.max(got, Number.isFinite(heldAt) ? heldAt : 0) > ASK_STALE_DAYS * DAY) return { never: 'too_late' };
  const lines = reviewableLines(order);
  if (!lines.length) return { never: 'nothing_to_review' };
  if (ctx.reviewed && lines.every((l) => ctx.reviewed!.has(l.productId))) return { never: 'reviewed' };
  const due = got + ask.days * DAY;
  if (now < due) return { wait: 'not_yet', due };
  if (ctx.openProblem) return { wait: 'open_problem', due };
  if (!askHours(now, ctx.timeZone)) return { wait: 'night', due };
  return { send: true, due };
}

/** The ask's words: one email, in full (it's not an order update, so it isn't routed through the order page). */
export function askWords(o: { first: string; shop: string; orderNumber: string; how: 'picked up' | 'delivered'; on: string; items: string[] }) {
  const one = o.items.length === 1 ? o.items[0] : '';
  return {
    subject: one ? `How’s your ${one}?` : `How did your order from ${o.shop} go?`,
    title: 'How did it go?',
    intro: `Hi ${o.first || 'there'}, thanks again for order ${o.orderNumber}, ${o.how} on ${o.on}. If you have a minute, tell other shoppers what you think.`,
    how: 'It takes about a minute. Only people who bought from us can leave a review, and it shows with your first name and last initial.',
    once: 'This is the only time we’ll ask about this order.',
    unsub: `to stop offers and review requests from ${o.shop}. Order updates still arrive.`,
    cta: 'Review your order',
  };
}
