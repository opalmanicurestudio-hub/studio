// src/lib/loyalty.ts — THE LOYALTY ENGINE (design canvas "Loyalty engine"). Pure rules; the server half is
// lib/loyalty-server. One engine every business configures for itself (Marketing → Loyalty):
//   how clients earn  — points per dollar, points per visit, or a visit punch card; a bonus for booking the next visit
//   what counts       — services and shop products (never tips or tax); gift card money earns once, when it's bought OR
//                       when it's spent (the business picks), never both; membership visits and renters' clients can be
//                       left out; chosen services and products can be left out
//   rewards           — money off, or a free add-on / service, each with what it costs the business
//   expiry, commission ("paid on the full price" by default, so a reward never quietly cuts someone's pay), who's in
// Points are their own kind of value: kept apart from gift card money, store credit and membership benefits. Every rule
// change is a new version; past sales keep the version they earned under (the ledger records it). A deterministic rules
// engine decides who earns and redeems — nothing here guesses.
export type EarnMode = 'per_dollar' | 'per_visit' | 'punch';
export type RewardKind = 'amount_off' | 'free_service';
export interface Reward { id: string; name: string; points: number; kind: RewardKind; cents?: number; serviceId?: string | null; costCents?: number; on: boolean }
export interface LoyaltySettings {
  on: boolean; version: number; updatedAt: string | null;
  earn: { mode: EarnMode; perDollar: number; perVisit: number; punchVisits: number; rebookBonus: number };
  counts: { services: boolean; products: boolean; giftCards: 'spent' | 'bought' };
  leaveOut: { memberVisits: boolean; serviceIds: string[]; productIds: string[] };
  rewards: Reward[]; expiryMonths: number; commission: 'full' | 'paid'; join: 'everyone' | 'opt_in'; oneRewardPerVisit: boolean;
}
export const EARN_LABEL: Record<EarnMode, string> = { per_dollar: 'Points per dollar', per_visit: 'Points per visit', punch: 'Visit punch card' };
export const EXPIRY_CHOICES = [0, 6, 12, 18, 24] as const;
export const unitOf = (S: { earn: { mode: EarnMode } }) => (S.earn.mode === 'punch' ? 'punches' : 'points');
const num = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const ids = (a: any) => (Array.isArray(a) ? Array.from(new Set(a.map((x: any) => String(x || '').slice(0, 80)).filter(Boolean))).slice(0, 200) as string[] : []);
const rid = () => Math.random().toString(36).slice(2, 9);

export const DEFAULT_REWARDS: Reward[] = [{ id: 'r10', name: '$10 off any service', points: 300, kind: 'amount_off', cents: 1000, costCents: 1000, on: true }];
export function loyaltyOf(tenant: any): LoyaltySettings {
  const l = tenant?.loyalty || {}; const e = l.earn || {}; const c = l.counts || {}; const o = l.leaveOut || {};
  const rewards: Reward[] = (Array.isArray(l.rewards) ? l.rewards : DEFAULT_REWARDS).slice(0, 12).map((r: any) => cleanReward(r)).filter(Boolean) as Reward[];
  return { on: l.on === true, version: Math.max(1, Math.round(Number(l.version) || 1)), updatedAt: l.updatedAt || null,
    earn: { mode: (['per_dollar', 'per_visit', 'punch'] as EarnMode[]).includes(e.mode) ? e.mode : 'per_dollar', perDollar: num(e.perDollar, 0, 20, 1), perVisit: Math.round(num(e.perVisit, 0, 1000, 10)), punchVisits: Math.round(num(e.punchVisits, 2, 30, 10)), rebookBonus: Math.round(num(e.rebookBonus, 0, 500, 0)) },
    counts: { services: c.services !== false, products: c.products !== false, giftCards: c.giftCards === 'bought' ? 'bought' : 'spent' },
    leaveOut: { memberVisits: o.memberVisits === true, serviceIds: ids(o.serviceIds), productIds: ids(o.productIds) },
    rewards, expiryMonths: (EXPIRY_CHOICES as readonly number[]).includes(Number(l.expiryMonths)) ? Number(l.expiryMonths) : 12,
    commission: l.commission === 'paid' ? 'paid' : 'full', join: l.join === 'opt_in' ? 'opt_in' : 'everyone', oneRewardPerVisit: l.oneRewardPerVisit !== false };
}
export function cleanReward(r: any): Reward | null {
  const points = Math.round(num(r?.points, 1, 100000, 0)); const name = String(r?.name || '').trim().slice(0, 60); if (!points || !name) return null;
  const kind: RewardKind = r?.kind === 'free_service' ? 'free_service' : 'amount_off';
  const cents = kind === 'amount_off' ? Math.round(num(r?.cents, 1, 100000, 0)) : undefined; if (kind === 'amount_off' && !cents) return null;
  const serviceId = kind === 'free_service' ? String(r?.serviceId || '').slice(0, 80) || null : null; if (kind === 'free_service' && !serviceId) return null;
  return { id: String(r?.id || rid()).slice(0, 40), name, points, kind, ...(cents ? { cents } : {}), ...(serviceId ? { serviceId } : {}), costCents: Math.round(num(r?.costCents, 0, 100000, cents || 0)), on: r?.on !== false };
}
/** What gets saved when the owner changes the program: a new version whenever the earning or reward rules change. */
export function nextLoyalty(prev: LoyaltySettings, raw: any, at = new Date().toISOString()): LoyaltySettings {
  const n = loyaltyOf({ loyalty: { ...raw, version: prev.version } });
  const sig = (s: LoyaltySettings) => JSON.stringify([s.earn, s.counts, s.leaveOut, s.rewards.map((r) => [r.id, r.points, r.kind, r.cents, r.serviceId, r.on]), s.expiryMonths]);
  return { ...n, version: sig(n) !== sig(prev) ? prev.version + 1 : prev.version, updatedAt: at };
}

// ── Earning ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SaleForPoints {
  services: { serviceId: string | null; cents: number; member?: boolean }[];   // what was PAID for each service line (after discounts)
  products: { productId: string | null; cents: number }[];
  giftSpentCents: number; giftBoughtCents: number; visits: number; rebooked: boolean; renter: boolean;
}
/** Points one paid sale earns, with the reason in plain words. Tips and tax are never part of the sale given here. */
export function pointsFor(S: LoyaltySettings, sale: SaleForPoints): { points: number; why: string; punches: number } {
  if (!S.on || sale.renter) return { points: 0, why: '', punches: 0 };
  const svc = S.counts.services ? sale.services.filter((s) => !(s.serviceId && S.leaveOut.serviceIds.includes(s.serviceId)) && !(S.leaveOut.memberVisits && s.member)) : [];
  const prod = S.counts.products ? sale.products.filter((p) => !(p.productId && S.leaveOut.productIds.includes(p.productId))) : [];
  let cents = svc.reduce((t, s) => t + Math.max(0, s.cents), 0) + prod.reduce((t, p) => t + Math.max(0, p.cents), 0);
  // Gift card money earns once: paying with a card earns only when the business chose "when it's spent"; buying one earns
  // only when it chose "when it's bought".
  if (S.counts.giftCards === 'bought') cents = Math.max(0, cents - Math.max(0, sale.giftSpentCents)) + Math.max(0, sale.giftBoughtCents);
  const bonus = sale.rebooked && sale.visits > 0 && S.earn.mode !== 'punch' ? S.earn.rebookBonus : 0;
  if (S.earn.mode === 'per_dollar') { const p = Math.floor((cents / 100) * S.earn.perDollar); return { points: p + bonus, why: `${p} for $${(cents / 100).toFixed(2)} spent${bonus ? `, ${bonus} for booking the next visit` : ''}`, punches: 0 }; }
  const visits = svc.length ? Math.max(1, sale.visits) : 0;
  if (S.earn.mode === 'per_visit') { const p = visits * S.earn.perVisit; return { points: p + bonus, why: `${p} for ${visits} visit${visits === 1 ? '' : 's'}${bonus ? `, ${bonus} for booking the next visit` : ''}`, punches: 0 }; }
  // Punch card: one punch per visit (a reward's "points" are punches, e.g. 10 for a free service).
  return { points: visits, why: visits ? `${visits} punch${visits === 1 ? '' : 'es'} on the card` : '', punches: visits };
}
/** Points to take back for a refund of `refundCents` out of a sale that earned `earned` on `basisCents`. */
export const pointsBack = (earned: number, basisCents: number, refundCents: number) => (basisCents > 0 ? Math.min(earned, Math.round(earned * Math.min(1, refundCents / basisCents))) : earned);

// ── Rewards ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The money a reward takes off this bill (never more than the service it frees or what's left to discount). */
export function rewardCents(r: Reward, bill: { lines: { serviceId: string | null; cents: number }[]; discountableCents: number }): number {
  if (r.kind === 'amount_off') return Math.max(0, Math.min(Number(r.cents) || 0, bill.discountableCents));
  const line = bill.lines.filter((l) => l.serviceId && l.serviceId === r.serviceId).sort((a, b) => b.cents - a.cents)[0];
  return line ? Math.max(0, Math.min(line.cents, bill.discountableCents)) : 0;
}
/** Rewards they can have now, and the next one to work toward. */
export function rewardsFor(S: LoyaltySettings, balance: number): { ready: Reward[]; next: { reward: Reward; toGo: number } | null } {
  const on = S.rewards.filter((r) => r.on).sort((a, b) => a.points - b.points);
  const ready = on.filter((r) => r.points <= balance); const n = on.find((r) => r.points > balance);
  return { ready, next: n ? { reward: n, toGo: n.points - balance } : null };
}
/** Roughly what a balance is worth, from the best money-off reward (for "worth about $21"). */
export function worthCents(S: LoyaltySettings, balance: number): number {
  const best = S.rewards.filter((r) => r.on && r.kind === 'amount_off' && r.cents).map((r) => (r.cents || 0) / r.points).sort((a, b) => b - a)[0] || 0;
  return Math.floor(balance * best);
}

// ── Balance and expiry ──────────────────────────────────────────────────────────────────────────────────────────────
export interface LedgerEntry { id?: string; type: 'earn' | 'redeem' | 'reverse' | 'adjust' | 'expire'; points: number; at: string }
/** The ledger's sum. It can dip below zero when a refund takes back points that were already used; nothing more can be
 *  redeemed until it's back above. */
export const balanceOf = (ledger: LedgerEntry[]) => ledger.reduce((t, e) => t + (Number(e.points) || 0), 0);
/** When an unused balance expires: `months` after their last visit (0 = never). */
export function expiresAt(S: LoyaltySettings, lastVisitIso: string | null | undefined): string | null {
  if (!S.expiryMonths || !lastVisitIso) return null; const d = new Date(lastVisitIso); if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + S.expiryMonths); return d.toISOString();
}

// ── In plain words, for clients ─────────────────────────────────────────────────────────────────────────────────────
export function termsOf(S: LoyaltySettings): string {
  const what = [S.counts.services && 'services', S.counts.products && 'products'].filter(Boolean).join(' and ') || 'visits';
  const earn = S.earn.mode === 'per_dollar' ? `Earn ${S.earn.perDollar === 1 ? '1 point' : `${S.earn.perDollar} points`} for every $1 you spend on ${what}.`
    : S.earn.mode === 'per_visit' ? `Earn ${S.earn.perVisit} points every visit.` : `Every visit gets a punch on your card.`;
  const unit = S.earn.mode === 'punch' ? 'punches' : 'points';
  const first = S.rewards.filter((r) => r.on).sort((a, b) => a.points - b.points)[0];
  const reward = first ? ` ${first.points} ${unit} gets you ${first.name.charAt(0).toLowerCase()}${first.name.slice(1)}.` : '';
  const bonus = S.earn.rebookBonus && S.earn.mode !== 'punch' ? ` Book your next visit before you leave for ${S.earn.rebookBonus} extra points.` : '';
  const expiry = S.expiryMonths ? ` ${unit === 'punches' ? 'Punches' : 'Points'} last ${S.expiryMonths} months from your last visit.` : ` ${unit === 'punches' ? 'Punches' : 'Points'} never expire.`;
  return `${earn}${reward}${bonus}${expiry}${S.earn.mode === 'per_dollar' ? ' Tips and tax don’t earn points.' : ''} Rewards can’t be exchanged for cash.`;
}
