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
  auto: { rewardReady: boolean; tierUp: boolean; unused: boolean; comeBack: boolean; monthlyTexts: number; holdoutPct: number };
  /** Phase 4: rewards for open time — bonus points on chosen services in quiet times (lib/loyalty quietBonus). */
  quiet: { on: boolean; windows: QuietWindow[] };
  /** What makes it feel special: a head start, keeping their rhythm, point boosts, surprises, referral points. */
  headStart: number; rhythm: Extras['rhythm']; boosts: Boost[]; surprises: Extras['surprises']; referralPoints: number;
}
export interface Tier { id: string; name: string; points: number; multiplier: number; perks: string[];
  /** Perks the app carries out: first pick of cancellations, booking N days early, and a free upgrade at checkout. */
  waitlistFirst?: boolean; earlyDays?: number; upgrade?: { fromServiceId: string; toServiceId: string } | null }
export interface Boost { id: string; label: string; from: string; to: string; multiplier: number; scope: 'products' | 'services' | 'all'; ids: string[] }
export type SurpriseWhen = 'anniversary' | 'made_right' | 'team';
export interface Surprise { id: string; name: string; when: SurpriseWhen; kind: RewardKind; cents?: number; serviceId?: string | null; costCents: number; on: boolean }
export interface Extras { headStart: number; rhythm: { on: boolean; points: number; graceDays: number; defaultWeeks: number }; boosts: Boost[]; surprises: { on: boolean; perMonth: number; items: Surprise[] }; referralPoints: number }
export interface Milestone { visits: number; points: number }
export interface QuietWindow { id: string; days: number[]; from: string; to: string; serviceIds: string[]; bonus: number; label?: string }
export const EARN_LABEL: Record<EarnMode, string> = { per_dollar: 'Points per dollar', per_visit: 'Points per visit', punch: 'Visit punch card' };
export const EXPIRY_CHOICES = [0, 6, 12, 18, 24] as const;
export const unitOf = (S: { earn: { mode: EarnMode } }) => (S.earn.mode === 'punch' ? 'punches' : 'points');
const num = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const ids = (a: any) => (Array.isArray(a) ? Array.from(new Set(a.map((x: any) => String(x || '').slice(0, 80)).filter(Boolean))).slice(0, 200) as string[] : []);
const rid = () => Math.random().toString(36).slice(2, 9);

export const DEFAULT_REWARDS: Reward[] = [{ id: 'r10', name: '$10 off any service', points: 300, kind: 'amount_off', cents: 1000, costCents: 1000, on: true }];
function loyaltyBase(tenant: any): Omit<LoyaltySettings, keyof Extras> {
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
    auto: { rewardReady: l.auto?.rewardReady === true, tierUp: l.auto?.tierUp === true, unused: l.auto?.unused === true, comeBack: l.auto?.comeBack === true, monthlyTexts: Math.round(num(l.auto?.monthlyTexts, 0, 5000, 200)), holdoutPct: Math.round(num(l.auto?.holdoutPct, 0, 30, 10)) },
    quiet: { on: l.quiet?.on === true, windows: (Array.isArray(l.quiet?.windows) ? l.quiet.windows : []).slice(0, 6).map((w: any) => ({ id: String(w?.id || rid()).slice(0, 40), days: (Array.isArray(w?.days) ? w.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6), from: /^\d{2}:\d{2}$/.test(String(w?.from)) ? String(w.from) : '13:00', to: /^\d{2}:\d{2}$/.test(String(w?.to)) ? String(w.to) : '16:00', serviceIds: ids(w?.serviceIds), bonus: Math.round(num(w?.bonus, 1, 1000, 25)), label: w?.label ? String(w.label).slice(0, 40) : undefined })).filter((w: QuietWindow) => w.days.length) } };
}
const day = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
export function loyaltyOf(tenant: any): LoyaltySettings {
  const b = loyaltyBase(tenant); const l = tenant?.loyalty || {}; const rawTiers: any[] = Array.isArray(l.tiers) ? l.tiers : [];
  const tiers = b.tiers.map((t) => { const x = rawTiers.find((y: any) => String(y?.id || '') === t.id) || {}; const up = x.upgrade && x.upgrade.fromServiceId && x.upgrade.toServiceId && x.upgrade.fromServiceId !== x.upgrade.toServiceId ? { fromServiceId: String(x.upgrade.fromServiceId).slice(0, 80), toServiceId: String(x.upgrade.toServiceId).slice(0, 80) } : null;
    return { ...t, waitlistFirst: x.waitlistFirst === true, earlyDays: Math.round(num(x.earlyDays, 0, 60, 0)), upgrade: up }; });
  const r = l.rhythm || {}; const su = l.surprises || {};
  return { ...b, tiers,
    headStart: Math.round(num(l.headStart, 0, 1000, 0)),
    rhythm: { on: r.on === true, points: Math.round(num(r.points, 1, 1000, 25)), graceDays: Math.round(num(r.graceDays, 0, 21, 4)), defaultWeeks: Math.round(num(r.defaultWeeks, 1, 26, 4)) },
    boosts: (Array.isArray(l.boosts) ? l.boosts : []).slice(0, 12).map((x: any) => ({ id: String(x?.id || rid()).slice(0, 40), label: String(x?.label || '').trim().slice(0, 60) || 'Bonus points', from: day(x?.from), to: day(x?.to) || day(x?.from), multiplier: Math.round(num(x?.multiplier, 1.25, 5, 2) * 100) / 100,
      scope: (['products', 'services', 'all'].includes(x?.scope) ? x.scope : 'products') as Boost['scope'], ids: ids(x?.ids) })).filter((x: Boost) => x.from && x.to >= x.from),
    surprises: { on: su.on === true, perMonth: Math.round(num(su.perMonth, 0, 100, 4)), items: (Array.isArray(su.items) ? su.items : []).slice(0, 8).map((x: any) => { const rw = cleanReward({ ...x, points: 1 }); if (!rw) return null;
      return { id: rw.id, name: rw.name, when: (['anniversary', 'made_right', 'team'].includes(x?.when) ? x.when : 'team') as SurpriseWhen, kind: rw.kind, ...(rw.cents ? { cents: rw.cents } : {}), ...(rw.serviceId ? { serviceId: rw.serviceId } : {}), costCents: rw.costCents ?? 0, on: x?.on !== false }; }).filter(Boolean) as Surprise[] },
    referralPoints: Math.round(num(l.referralPoints, 0, 10000, 0)) };
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
  const sig = (s: LoyaltySettings) => JSON.stringify([s.earn, s.counts, s.leaveOut, s.rewards.map((r) => [r.id, r.points, r.kind, r.cents, r.serviceId, r.on]), s.expiryMonths, s.tiers, s.graceMonths, s.milestones, s.quiet, s.headStart, s.rhythm, s.boosts, s.referralPoints]);
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
export interface LedgerEntry { id?: string; type: 'earn' | 'bonus' | 'redeem' | 'reverse' | 'adjust' | 'expire' | 'surprise' | 'perk'; points: number; at: string }
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

// ── Phase 5: holdouts — a comparable few don't get a message, so the result shows what the message actually changed ──
/** Same client, same month, same answer: is this client in the left-alone group for this message? */
export function heldOut(clientId: string, kind: string, month: string, pct: number): boolean {
  if (!pct) return false; let h = 2166136261; for (const ch of `${clientId}|${kind}|${month}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100) < pct;
}
/** Came back within `days` of the message (or of when it would have gone): sent vs left alone, and the difference.
 *  Measured, not modelled; with fewer than 20 in either group it says so instead of claiming a result. */
export function liftOf(rows: { held: boolean; cameBack: boolean }[]): { sent: number; sentBack: number; held: number; heldBack: number; lift: number | null; enough: boolean } {
  const s = rows.filter((r) => !r.held), h = rows.filter((r) => r.held);
  const sb = s.filter((r) => r.cameBack).length, hb = h.filter((r) => r.cameBack).length; const enough = s.length >= 20 && h.length >= 20;
  return { sent: s.length, sentBack: sb, held: h.length, heldBack: hb, lift: enough ? Math.round(((sb / s.length) - (hb / h.length)) * 1000) / 10 : null, enough };
}

// ── Phase 6: the program builder — a few questions → a suggested program, with what each reward costs ──────────────
// Suggestions only: nothing is saved until the owner reviews it and presses Save. The maths, not a guess: points are set
// so the business gives back about the share it chose of what members spend.
export interface BuilderAnswers { encourage: ('return' | 'rebook' | 'retail' | 'quiet')[]; givebackPct: number; avgTicket: number; visitsPerYear: number; addOn?: { id: string; name: string; price: number } | null; quietDay?: number }
export function suggestProgram(a: BuilderAnswers): { settings: any; notes: string[] } {
  const pct = Math.max(1, Math.min(15, a.givebackPct || 5)); const ticket = Math.max(10, a.avgTicket || 60); const visits = Math.max(1, a.visitsPerYear || 6);
  const per10 = Math.max(50, Math.round((10 / (pct / 100)) / 25) * 25);   // points for $10 off at 1 point per $1
  const rewards: any[] = [{ id: 'off10', name: '$10 off any service', points: per10, kind: 'amount_off', cents: 1000, costCents: 1000, on: true }];
  if (a.addOn && a.addOn.price > 0) { const p = Math.max(25, Math.round((a.addOn.price / (pct / 100)) / 25) * 25); rewards.unshift({ id: 'addon', name: `Free ${a.addOn.name.toLowerCase()}`, points: p, kind: 'free_service', serviceId: a.addOn.id, costCents: Math.round(a.addOn.price * 100 * 0.3), on: true }); }
  const yearSpend = ticket * visits; const settings: any = { on: false, earn: { mode: 'per_dollar', perDollar: 1, rebookBonus: a.encourage.includes('rebook') ? Math.max(10, Math.round(ticket * (pct / 100) * 2 / 5) * 5) : 0 },
    counts: { services: true, products: true, giftCards: 'spent' }, leaveOut: { memberVisits: true, serviceIds: [], productIds: [] }, rewards, expiryMonths: 12, commission: 'full', join: 'everyone', oneRewardPerVisit: true,
    tiers: visits >= 5 ? [{ id: 'gold', name: 'Gold', points: Math.round((yearSpend * 0.6) / 50) * 50, multiplier: 1.25, perks: ['Priority booking', 'Early access to new services'] }] : [], graceMonths: 3,
    milestones: a.encourage.includes('return') ? [{ visits: 5, points: Math.round(per10 / 4 / 5) * 5 }, { visits: 10, points: Math.round(per10 / 2 / 5) * 5 }] : [],
    auto: { rewardReady: a.encourage.includes('return'), tierUp: false, unused: a.encourage.includes('return'), comeBack: false, monthlyTexts: 200, holdoutPct: 10 },
    quiet: { on: a.encourage.includes('quiet'), windows: a.encourage.includes('quiet') ? [{ id: 'q1', days: [a.quietDay ?? 2], from: '13:00', to: '16:00', serviceIds: [], bonus: Math.max(10, Math.round(per10 / 10 / 5) * 5) }] : [] } };
  const notes = [
    `About ${pct}% of what members spend comes back as rewards: $10 off every ${per10} points, so a client spending $${Math.round(yearSpend)} a year earns about $${Math.round(yearSpend * pct / 100)} back.`,
    ...(a.addOn ? [`${rewards[0].name} at ${rewards[0].points} points costs you roughly $${(rewards[0].costCents / 100).toFixed(2)} in product and time (an estimate; set your real cost).`] : []),
    ...(settings.earn.rebookBonus ? [`${settings.earn.rebookBonus} bonus points for booking the next visit before leaving.`] : []),
    ...(settings.tiers.length ? [`Gold at ${settings.tiers[0].points} points a year (about ${Math.round(visits * 0.6)} visits) earns 25% faster, with perks that aren’t discounts.`] : []),
    ...(settings.quiet.on ? ['Bonus points in a quiet afternoon instead of a discount. Change the day and hours to your own quiet times.'] : []),
    'Messages are only suggested: none is switched on until you choose. Nothing is saved until you press Save.',
  ];
  return { settings, notes };
}


// ── What makes it feel special ──────────────────────────────────────────────────────────────────────────────────────
const DAY_MS = 864e5;
/** Their usual gap between visits, in days: the middle of their last few gaps (two or more), else the business default. */
export function usualGapDays(visitIsos: string[], fallbackDays: number): number {
  const t = visitIsos.map((v) => Date.parse(v)).filter(Boolean).sort((a, b) => a - b); const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) { const g = (t[i] - t[i - 1]) / DAY_MS; if (g >= 3) gaps.push(g); }
  const last = gaps.slice(-5).sort((a, b) => a - b); if (last.length < 2) return fallbackDays;
  return Math.round(last.length % 2 ? last[(last.length - 1) / 2] : (last[last.length / 2 - 1] + last[last.length / 2]) / 2);
}
/** Kept their rhythm: back within their usual gap (plus the grace days) since their last visit. */
export function rhythmBonus(S: LoyaltySettings, priorVisitIsos: string[], atMs: number): { points: number; label: string; days: number } | null {
  if (!S.on || !S.rhythm.on || S.earn.mode === 'punch' || !priorVisitIsos.length) return null;
  const last = Math.max(...priorVisitIsos.map((v) => Date.parse(v) || 0)); if (!last || atMs <= last) return null;
  const days = Math.round((atMs - last) / DAY_MS); const usual = usualGapDays(priorVisitIsos, S.rhythm.defaultWeeks * 7);
  return days >= 3 && days <= usual + S.rhythm.graceDays ? { points: S.rhythm.points, label: `Kept their rhythm (back in ${days} days)`, days } : null;
}
/** Boosts running on a day (YYYY-MM-DD, the business's own calendar). */
export const activeBoosts = (S: LoyaltySettings, dayKey: string) => (S.on ? S.boosts.filter((b) => b.from <= dayKey && dayKey <= b.to) : []);
/** The extra points a boost adds to a sale: the best boost for each line, on top of what the line already earns. */
export function boostBonus(S: LoyaltySettings, sale: SaleForPoints, dayKey: string): { points: number; label: string } | null {
  const on = activeBoosts(S, dayKey); if (!on.length || S.earn.mode === 'punch' || sale.renter) return null;
  const fits = (b: Boost, kind: 'services' | 'products', id: string | null) => (b.scope === 'all' || b.scope === kind) && (!b.ids.length || (!!id && b.ids.includes(id)));
  let extra = 0; const used = new Set<string>();
  const each = (kind: 'services' | 'products', id: string | null, cents: number) => { const b = on.filter((x) => fits(x, kind, id)).sort((x, y) => y.multiplier - x.multiplier)[0]; if (!b || cents <= 0) return;
    used.add(b.label); extra += S.earn.mode === 'per_dollar' ? (cents / 100) * S.earn.perDollar * (b.multiplier - 1) : 0; };
  if (S.counts.services) for (const l of sale.services) if (!(l.serviceId && S.leaveOut.serviceIds.includes(l.serviceId)) && !(S.leaveOut.memberVisits && l.member)) each('services', l.serviceId, l.cents);
  if (S.counts.products) for (const l of sale.products) if (!(l.productId && S.leaveOut.productIds.includes(l.productId))) each('products', l.productId, l.cents);
  if (S.earn.mode === 'per_visit') { const b = on.filter((x) => x.scope !== 'products' && (!x.ids.length || sale.services.some((l) => l.serviceId && x.ids.includes(l.serviceId)))).sort((x, y) => y.multiplier - x.multiplier)[0];
    if (b && sale.services.length) { extra = Math.max(1, sale.visits) * S.earn.perVisit * (b.multiplier - 1); used.add(b.label); } }
  const points = Math.floor(extra); return points > 0 ? { points, label: [...used].join(', ') } : null;
}
/** A surprise the desk can give today, without being asked (never advertised). Budgeted per month. */
export function surpriseFor(S: LoyaltySettings, o: { firstVisitAt?: string | null; lastSurpriseAt?: string | null; madeRightAt?: string | null; usedThisMonth: number; now: number }): { item: Surprise; why: string } | null {
  if (!S.on || !S.surprises.on || o.usedThisMonth >= S.surprises.perMonth) return null;
  const last = Date.parse(String(o.lastSurpriseAt || '')) || 0;
  for (const item of S.surprises.items.filter((x) => x.on)) {
    if (item.when === 'made_right') { const mr = Date.parse(String(o.madeRightAt || '')) || 0; if (mr && o.now - mr <= 60 * DAY_MS && last < mr) return { item, why: 'After we put something right for them' }; }
    if (item.when === 'anniversary') { const f = Date.parse(String(o.firstVisitAt || '')); if (!f) continue; const fd = new Date(f); const years = new Date(o.now).getUTCFullYear() - fd.getUTCFullYear();
      for (const y of [years, years - 1]) { if (y < 1) continue; const ann = Date.UTC(fd.getUTCFullYear() + y, fd.getUTCMonth(), fd.getUTCDate());
        if (o.now >= ann - 7 * DAY_MS && o.now <= ann + 14 * DAY_MS && last < ann - 7 * DAY_MS) return { item, why: `${y} year${y === 1 ? '' : 's'} with us` }; } }
  }
  return null;
}
/** Surprises the team can choose to give anyone, while the month's budget lasts. */
export const teamSurprises = (S: LoyaltySettings, usedThisMonth: number) => (S.on && S.surprises.on && usedThisMonth < S.surprises.perMonth ? S.surprises.items.filter((x) => x.on && x.when === 'team') : []);
/** What a tier's free upgrade takes off this bill: the difference in price, on the upgraded service. */
export function upgradeCents(tier: Tier | null | undefined, lines: { serviceId: string | null; cents: number }[], priceCents: (serviceId: string) => number): number {
  const u = tier?.upgrade; if (!u) return 0; const line = lines.find((l) => l.serviceId === u.toServiceId); if (!line) return 0;
  return Math.max(0, Math.min(line.cents, priceCents(u.toServiceId) - priceCents(u.fromServiceId)));
}
/** The reward they're saving for (theirs, or the next one), and how far along they are. */
export function goalOf(S: LoyaltySettings, goalRewardId: string | null | undefined, balance: number): { reward: Reward; toGo: number; pct: number; chosen: boolean } | null {
  const on = S.rewards.filter((r) => r.on); const chosen = on.find((r) => r.id === goalRewardId) || null;
  const r = chosen || on.filter((x) => x.points > balance).sort((a, b) => a.points - b.points)[0] || null; if (!r) return null;
  return { reward: r, toGo: Math.max(0, r.points - balance), pct: Math.min(100, Math.round((balance / r.points) * 100)), chosen: !!chosen };
}
const NOTABLE = new Set([10, 25, 50, 75, 100, 150, 200, 250, 300]);
/** What the team says when the client sits down: a notable visit number, an anniversary, a birthday nearby. */
export function visitCues(o: { visitNumber: number; firstVisitAt?: string | null; birthday?: string | null; at: number; tz?: string }): string[] {
  const out: string[] = []; const n = o.visitNumber;
  if (n === 1) out.push('First visit'); else if (NOTABLE.has(n)) out.push(`Their ${n}th visit`);
  const f = Date.parse(String(o.firstVisitAt || ''));
  if (f && n > 1) { const fd = new Date(f); const y = new Date(o.at).getUTCFullYear() - fd.getUTCFullYear();
    for (const k of [y, y + 1]) { if (k < 1) continue; const ann = Date.UTC(fd.getUTCFullYear() + k, fd.getUTCMonth(), fd.getUTCDate()); const d = (ann - o.at) / DAY_MS;
      if (d >= -3 && d <= 4) { out.push(`${k} year${k === 1 ? '' : 's'} with us this week`); break; } } }
  const bm = String(o.birthday || '').match(/(\d{2})-(\d{2})$/);
  if (bm) { const y = new Date(o.at).getUTCFullYear(); for (const yy of [y - 1, y, y + 1]) { const b = Date.UTC(yy, Number(bm[1]) - 1, Number(bm[2])); const d = Math.round((b - Date.UTC(new Date(o.at).getUTCFullYear(), new Date(o.at).getUTCMonth(), new Date(o.at).getUTCDate())) / DAY_MS);
    if (d === 0) { out.push('Birthday today'); break; } if (d > 0 && d <= 7) { out.push(`Birthday ${new Date(b).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`); break; } if (d < 0 && d >= -3) { out.push('Birthday this week'); break; } } }
  return out;
}
/** A tier's perks in plain words: the ones the app carries out, then the business's own. */
export function perkWords(t: Tier | null | undefined, serviceName: (id: string) => string | null = () => null): string[] {
  if (!t) return []; const out: string[] = [];
  if (t.waitlistFirst) out.push('First pick of cancellations');
  if (t.earlyDays) out.push(`Book ${t.earlyDays} day${t.earlyDays === 1 ? '' : 's'} early`);
  if (t.upgrade) { const to = serviceName(t.upgrade.toServiceId), from = serviceName(t.upgrade.fromServiceId); out.push(to ? `Free upgrade${from ? ` from ${from.toLowerCase()}` : ''} to ${to.toLowerCase()}` : 'A free upgrade'); }
  return [...out, ...(t.perks || [])];
}
