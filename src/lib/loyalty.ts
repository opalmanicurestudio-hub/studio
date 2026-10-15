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
  /** Phase 4: tiers earned over a qualifying year, with a grace period before stepping down; milestones by visit count. */
  tiers: Tier[]; graceMonths: number; milestones: Milestone[];
  /** Phase 4: automatic messages — each off until switched on, with a monthly budget and one loyalty text a month at most. */
  auto: { rewardReady: boolean; tierUp: boolean; unused: boolean; comeBack: boolean; monthlyTexts: number };
  /** Phase 4: rewards for open time — bonus points on chosen services in quiet times (lib/loyalty quietBonus). */
  quiet: { on: boolean; windows: QuietWindow[] };
}
export interface Tier { id: string; name: string; points: number; multiplier: number; perks: string[] }
export interface Milestone { visits: number; points: number }
export interface QuietWindow { id: string; days: number[]; from: string; to: string; serviceIds: string[]; bonus: number; label?: string }
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
    commission: l.commission === 'paid' ? 'paid' : 'full', join: l.join === 'opt_in' ? 'opt_in' : 'everyone', oneRewardPerVisit: l.oneRewardPerVisit !== false,
    tiers: (Array.isArray(l.tiers) ? l.tiers : []).slice(0, 5).map((x: any) => ({ id: String(x?.id || rid()).slice(0, 40), name: String(x?.name || '').trim().slice(0, 30), points: Math.round(num(x?.points, 1, 1000000, 0)), multiplier: Math.round(num(x?.multiplier, 1, 3, 1) * 100) / 100, perks: (Array.isArray(x?.perks) ? x.perks : []).map((p: any) => String(p || '').trim().slice(0, 80)).filter(Boolean).slice(0, 5) })).filter((x: Tier) => x.name && x.points > 0).sort((a: Tier, b: Tier) => a.points - b.points),
    graceMonths: [0, 1, 2, 3, 6].includes(Number(l.graceMonths)) ? Number(l.graceMonths) : 3,
    milestones: (Array.isArray(l.milestones) ? l.milestones : []).slice(0, 8).map((m: any) => ({ visits: Math.round(num(m?.visits, 2, 500, 0)), points: Math.round(num(m?.points, 1, 10000, 0)) })).filter((m: Milestone) => m.visits && m.points).sort((a: Milestone, b: Milestone) => a.visits - b.visits),
    auto: { rewardReady: l.auto?.rewardReady === true, tierUp: l.auto?.tierUp === true, unused: l.auto?.unused === true, comeBack: l.auto?.comeBack === true, monthlyTexts: Math.round(num(l.auto?.monthlyTexts, 0, 5000, 200)) },
    quiet: { on: l.quiet?.on === true, windows: (Array.isArray(l.quiet?.windows) ? l.quiet.windows : []).slice(0, 6).map((w: any) => ({ id: String(w?.id || rid()).slice(0, 40), days: (Array.isArray(w?.days) ? w.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6), from: /^\d{2}:\d{2}$/.test(String(w?.from)) ? String(w.from) : '13:00', to: /^\d{2}:\d{2}$/.test(String(w?.to)) ? String(w.to) : '16:00', serviceIds: ids(w?.serviceIds), bonus: Math.round(num(w?.bonus, 1, 1000, 25)), label: w?.label ? String(w.label).slice(0, 40) : undefined })).filter((w: QuietWindow) => w.days.length) } };
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
  const sig = (s: LoyaltySettings) => JSON.stringify([s.earn, s.counts, s.leaveOut, s.rewards.map((r) => [r.id, r.points, r.kind, r.cents, r.serviceId, r.on]), s.expiryMonths, s.tiers, s.graceMonths, s.milestones, s.quiet]);
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
export interface LedgerEntry { id?: string; type: 'earn' | 'bonus' | 'redeem' | 'reverse' | 'adjust' | 'expire'; points: number; at: string }
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

// ── Phase 4: tiers, milestones, quiet-time bonuses ─────────────────────────────────────────────────────────────────
/** Their tier: from points EARNED (not spent) in the last 12 months. Stepping down waits for the grace period: someone
 *  who held a tier keeps it until `graceMonths` after they last qualified. */
export function tierFor(S: LoyaltySettings, earnedLast12: number, held?: { id: string; until?: string | null } | null, now = Date.now()): { tier: Tier | null; next: { tier: Tier; toGo: number } | null; grace: boolean } {
  if (!S.tiers.length) return { tier: null, next: null, grace: false };
  const qualifies = [...S.tiers].reverse().find((t) => earnedLast12 >= t.points) || null;
  const heldTier = held?.id ? S.tiers.find((t) => t.id === held.id) || null : null;
  const graceOk = !!heldTier && !!held?.until && Date.parse(String(held.until)) > now && (!qualifies || heldTier.points > qualifies.points);
  const tier = graceOk ? heldTier : qualifies; const after = S.tiers.find((t) => t.points > (tier?.points ?? -1) && t.points > earnedLast12);
  return { tier, next: after ? { tier: after, toGo: after.points - earnedLast12 } : null, grace: graceOk };
}
/** Milestone bonus earned by reaching visit number `visitNumber` (exactly), if the program has one there. */
export const milestoneAt = (S: LoyaltySettings, visitNumber: number) => S.milestones.find((m) => m.visits === visitNumber) || null;
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** Quiet-time bonus for a visit that starts at local weekday `day` (0 = Sunday) and minute-of-day `min`, for a service. */
export function quietBonus(S: LoyaltySettings, day: number, min: number, serviceId: string | null): { points: number; label: string } | null {
  if (!S.on || !S.quiet.on || !serviceId) return null;
  const w = S.quiet.windows.find((x) => x.days.includes(day) && min >= hm(x.from) && min < hm(x.to) && (!x.serviceIds.length || x.serviceIds.includes(serviceId)));
  return w ? { points: w.bonus, label: w.label || 'Quiet-time bonus' } : null;
}
const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (s: string) => { const [h, m] = s.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
export const windowWords = (w: QuietWindow) => `${w.days.map((d) => DAY_NAME[d]).join(', ')} ${clock(w.from)}–${clock(w.to)}`;
/** The automatic messages, word for word, so the business previews them before switching any on. */
export const AUTO_TEXTS = {
  rewardReady: (o: { first: string; reward: string; business: string }) => `Hi ${o.first}, this is ${o.business}. You have enough points for ${o.reward}. Just mention it at your next visit.`,
  tierUp: (o: { first: string; tier: string; business: string; perks: string }) => `Hi ${o.first}, this is ${o.business}. You are now ${o.tier}${o.perks ? `: ${o.perks}` : ''}. Thank you for coming to see us.`,
  unused: (o: { first: string; points: number; unit: string; business: string; reward?: string }) => `Hi ${o.first}, this is ${o.business}. A friendly note that you have ${o.points} ${o.unit} waiting${o.reward ? `, enough for ${o.reward}` : ''}. We would love to see you soon.`,
  comeBack: (o: { first: string; business: string; points: number; unit: string }) => `Hi ${o.first}, this is ${o.business}. It has been a while, and we hope you are well. Your ${o.points} ${o.unit} are still here whenever you would like to come in.`,
};
