// src/lib/creator-campaigns.ts — CREATOR CAMPAIGNS, the rules only (design canvas RF24–RF29). (Marketing sends live in lib/campaigns.) A campaign is a brief (a moodboard
// of reference photos and post links marked do / don't, a shot list of musts and nice-to-haves, specs, the brand kit),
// the pieces each creator owes and when, what they're paid (a fee per approved piece, the per-result pay set on each
// creator, a free content visit) and guard rails on the creator's offer (which days it works, how many uses, and a top
// cost per new client, past which it pauses). The planner says before anything is sent what it costs, what a new client
// is worth, the break-even point and a forecast range from the business's own history; results judge each creator and
// each piece by paid first visits, whether those clients come back, and profit.

export type PieceKind = 'reel' | 'story' | 'post' | 'tiktok' | 'video' | 'other';
export interface Ref { id: string; url: string; kind: 'image' | 'link'; label: string; tag: 'do' | 'dont' | null }
export interface Shot { id: string; text: string; must: boolean; when: string }
export interface Piece { id: string; kind: PieceKind; label: string; due: string | null }
export interface Campaign {
  id: string; name: string; status: 'draft' | 'live' | 'done'; start: string | null; end: string | null;
  creators: string[];
  brief: { text: string; refs: Ref[]; shots: Shot[]; format: string; post: string; say: string; draft: boolean; brand: string };
  pieces: Piece[];
  pay: { feeCents: number; contentVisit: boolean; contentServiceId: string | null };
  guard: { days: number[]; maxUses: number | null; capCents: number | null; budgetCents: number | null };
  createdAt: string; paused?: { at: string; why: string } | null;
}
export interface Hand { status: 'submitted' | 'approved' | 'changes'; url: string; shot: string | null; clip: string | null; views: number | null; ad: boolean; rights: boolean; note: string | null; at: string; decidedAt?: string | null; decidedBy?: string | null; feeCents?: number; paidAt?: string | null; late?: boolean }

const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const int = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
const iso = (v: any) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const rid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
export const KINDS: PieceKind[] = ['reel', 'story', 'post', 'tiktok', 'video', 'other'];
export const KIND_LABEL: Record<PieceKind, string> = { reel: 'Reel', story: 'Story', post: 'Post', tiktok: 'TikTok', video: 'Video', other: 'Piece' };
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function campaignOf(raw: any, id?: string): Campaign {
  const r = raw || {}; const b = r.brief || {}; const g = r.guard || {}; const p = r.pay || {};
  return {
    id: str(id || r.id, 60) || rid('c'), name: str(r.name, 60) || 'New campaign', status: ['draft', 'live', 'done'].includes(r.status) ? r.status : 'draft', start: iso(r.start), end: iso(r.end),
    creators: (Array.isArray(r.creators) ? r.creators : []).map((x: any) => str(x, 120)).filter(Boolean).slice(0, 30),
    brief: { text: str(b.text, 2000), format: str(b.format, 80), post: str(b.post, 80), say: str(b.say, 120), draft: b.draft === true, brand: str(b.brand, 600),
      refs: (Array.isArray(b.refs) ? b.refs : []).filter((x: any) => x && /^https:\/\//.test(String(x.url || ''))).slice(0, 24)
        .map((x: any) => ({ id: str(x.id, 30) || rid('r'), url: str(x.url, 600), kind: x.kind === 'link' ? 'link' : 'image', label: str(x.label, 60), tag: x.tag === 'do' || x.tag === 'dont' ? x.tag : null })),
      shots: (Array.isArray(b.shots) ? b.shots : []).filter((x: any) => str(x?.text, 200)).slice(0, 20).map((x: any) => ({ id: str(x.id, 30) || rid('s'), text: str(x.text, 200), must: x.must !== false, when: str(x.when, 20) })) },
    pieces: (Array.isArray(r.pieces) ? r.pieces : []).slice(0, 12).map((x: any) => ({ id: str(x.id, 30) || rid('p'), kind: KINDS.includes(x.kind) ? x.kind : 'other', label: str(x.label, 40), due: iso(x.due) })),
    pay: { feeCents: int(p.feeCents, 0, 1000000, 0), contentVisit: p.contentVisit === true, contentServiceId: str(p.contentServiceId, 120) || null },
    guard: { days: (Array.isArray(g.days) ? g.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6).slice(0, 7), maxUses: g.maxUses == null || g.maxUses === '' ? null : int(g.maxUses, 1, 10000, 20),
      capCents: g.capCents == null || g.capCents === '' ? null : int(g.capCents, 100, 1000000, 4500), budgetCents: g.budgetCents == null || g.budgetCents === '' ? null : int(g.budgetCents, 100, 10000000, 50000) },
    createdAt: iso(r.createdAt) || new Date().toISOString(), paused: r.paused && r.paused.at ? { at: str(r.paused.at, 40), why: str(r.paused.why, 200) } : null,
  };
}
export const pieceLabel = (p: Piece, i?: number) => p.label || `${KIND_LABEL[p.kind]}${i != null ? ` ${i + 1}` : ''}`;
export const handKey = (creatorId: string, pieceId: string) => `${creatorId}__${pieceId}`;
/** "Tue–Thu" / "Tue, Thu, Sat" / "" (every day). */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].sort(); if (!d.length || d.length === 7) return '';
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1); return run && d.length > 2 ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}` : d.map((x) => DAY_NAMES[x]).join(', ');
}

// ── The planner ─────────────────────────────────────────────────────────────────────
export interface PlanIn {
  creators: number; pieces: number; feeCents: number; contentVisits: number; contentCostCents: number;
  offerCents: number; creditCents: number; cashCents: number;
  expectedPerCreator: number;             // paid first visits each creator brings (from history, or a safe guess)
  firstVisitCents: number; yearValueCents: number; margin: number;   // 0..1
  rebook: number;                          // 0..1, shown only
  historyKnown: boolean;
}
export interface PlanOut {
  expected: number; low: number; high: number;
  cost: { fees: number; content: number; offers: number; credit: number; cash: number; total: number };
  profitPerClient: number; breakEven: number | null; profit12: number; profitLow: number; profitHigh: number; returnX: number | null;
  verdict: 'good' | 'thin' | 'loses';
}
/** What a campaign costs, what it's likely worth, and where it breaks even. Credit costs what the service costs you, not its price. */
export function plan(i: PlanIn): PlanOut {
  const m = Math.max(0, Math.min(0.95, i.margin));
  const expected = Math.round(Math.max(0, i.creators * i.expectedPerCreator) * 10) / 10; const low = Math.floor(expected * 0.5); const high = Math.ceil(expected * 1.5);
  const variable = (n: number) => n * (i.offerCents + i.creditCents * (1 - m) + i.cashCents);
  const fixed = i.creators * i.pieces * i.feeCents + i.contentVisits * i.contentCostCents;
  const cost = { fees: i.creators * i.pieces * i.feeCents, content: i.contentVisits * i.contentCostCents, offers: Math.round(expected * i.offerCents), credit: Math.round(expected * i.creditCents * (1 - m)), cash: Math.round(expected * i.cashCents), total: Math.round(fixed + variable(expected)) };
  // Profit from one new client over 12 months: what they spend, at your margin, less what it took to win them.
  const perClient = Math.round(i.yearValueCents * m - (i.offerCents + i.creditCents * (1 - m) + i.cashCents));
  const breakEven = perClient > 0 ? Math.max(1, Math.ceil(fixed / perClient)) : null;
  const at = (n: number) => Math.round(n * i.yearValueCents * m - fixed - variable(n));
  const profit12 = at(expected);
  const returnX = cost.total > 0 ? Math.round(((expected * i.yearValueCents * m) / cost.total) * 10) / 10 : null;
  return { expected, low, high, cost, profitPerClient: perClient, breakEven, profit12, profitLow: at(low), profitHigh: at(high), returnX,
    verdict: perClient <= 0 || at(low) < -fixed * 0.5 ? 'loses' : at(low) >= 0 ? 'good' : 'thin' };
}

// ── Judging creators ────────────────────────────────────────────────────────────────
export interface Score { paidFirst: number; costCents: number; comeBack: number | null; spendCents: number; onTime: number | null }
export function scoreTag(s: Score): { tag: 'hire' | 'more' | 'hunters' | 'watch' | 'new'; label: string } {
  if (s.paidFirst < 2) return { tag: 'new', label: 'Too early to tell' };
  const ret = s.costCents > 0 ? s.spendCents / s.costCents : null; const back = s.comeBack ?? 0;
  if (s.paidFirst >= 3 && back < 0.35) return { tag: 'hunters', label: 'Discount hunters' };
  if (ret != null && ret >= 5 && back >= 0.6) return { tag: 'more', label: 'Give them more' };
  if (ret != null && ret >= 2 && back >= 0.45) return { tag: 'hire', label: 'Hire again' };
  return { tag: 'watch', label: 'Watch' };
}
