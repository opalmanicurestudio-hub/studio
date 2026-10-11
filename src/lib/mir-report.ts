// src/lib/mir-report.ts — THE MONTHLY MAKING IT RIGHT REPORT, worked out from the cases themselves (no extra records).
// For a month (in the business's time zone): how many cases and why, what caused them, who they were about — counted
// fairly (every case about a provider's visit is listed, but only those a manager marked "the work itself" count against
// them) — which fixes were given, what making it right cost, and how fast the team replied and closed.
// Renter cases are the renter's business and are left out; incidents are counted on their own.
import { CAUSES, FIX_LABEL } from '@/lib/making-it-right';

export const monthOf = (iso: string | undefined | null, tz?: string) => {
  if (!iso) return ''; const d = new Date(iso); if (isNaN(+d)) return '';
  try { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit' }).formatToParts(d); return `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}`; } catch { return d.toISOString().slice(0, 7); }
};
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 15)); return d.toISOString().slice(0, 7); };

const hours = (a?: string, b?: string) => (a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 3600000) : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
type Count = { key: string; label: string; n: number };
const tally = (rows: any[], key: (c: any) => string, label: (k: string, c: any) => string): Count[] => {
  const m = new Map<string, Count>(); for (const c of rows) { const k = key(c); const e = m.get(k) || { key: k, label: label(k, c), n: 0 }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};

/** What one case cost to put right, in cents. A free redo counts the service given again at what they paid. */
export function caseCost(c: any) {
  const f = c.fix; if (!f) return { refund: 0, credit: 0, redo: 0 };
  const refund = f.kind === 'refund' ? Math.round(Number(f.refundedCents ?? f.amountCents) || 0) : 0;
  const credit = f.kind === 'credit' ? Math.round(Number(f.amountCents) || 0) : 0;
  const redo = f.kind === 'redo' && !(Number(f.redo?.plan?.priceCents) > 0) ? Math.round((Number(c.visit?.paid) || 0) * 100) : 0;
  return { refund, credit, redo };
}

export type MirReport = ReturnType<typeof monthReport>;
export function monthReport(allCases: any[], ym: string, tz?: string, payAdjustments: any[] = []) {
  const inMonth = (allCases || []).filter((c) => !c.renterCase && monthOf(c.createdAt, tz) === ym);
  const cases = inMonth.filter((c) => c.kind !== 'incident'); const incidents = inMonth.filter((c) => c.kind === 'incident');
  const byReason = tally(cases, (c) => c.reasonId || 'other', (_k, c) => c.reasonLabel || 'Something else');
  const byCause = tally(cases, (c) => c.cause || 'unmarked', (k) => (k === 'unmarked' ? 'Not marked yet' : (CAUSES as any)[k]?.label || k));
  const byFix = tally(cases, (c) => (c.fix ? c.fix.kind : c.locked ? 'none' : 'open'), (k) => (k === 'open' ? 'Still open' : k === 'none' ? 'Closed without a fix' : (FIX_LABEL as any)[k] || k));
  const prov = new Map<string, { id: string; name: string; total: number; counted: number; unmarked: number; incidents: number }>();
  for (const c of inMonth) { const id = c.visit?.providerId; if (!id) continue; const e = prov.get(id) || { id, name: c.visit?.providerName || 'Someone', total: 0, counted: 0, unmarked: 0, incidents: 0 };
    if (c.kind === 'incident') e.incidents++; else { e.total++; if (!c.cause) e.unmarked++; else if ((CAUSES as any)[c.cause]?.counts) e.counted++; } prov.set(id, e); }
  const byProvider = [...prov.values()].sort((a, b) => b.counted - a.counted || b.total - a.total || a.name.localeCompare(b.name));
  const cost = cases.reduce((s, c) => { const x = caseCost(c); return { refund: s.refund + x.refund, credit: s.credit + x.credit, redo: s.redo + x.redo }; }, { refund: 0, credit: 0, redo: 0 });
  const ids = new Set(inMonth.map((c) => c.id));
  const payCents = (payAdjustments || []).filter((a) => a.by === 'making_it_right' && ids.has(a.caseId)).reduce((s, a) => s + (Number(a.amountCents) || 0), 0);
  const reply = cases.map((c) => hours(c.createdAt, c.firstReplyAt)).filter((x): x is number => x !== null);
  const close = cases.filter((c) => c.locked).map((c) => hours(c.createdAt, c.closedAt)).filter((x): x is number => x !== null);
  const lateReplies = cases.filter((c) => c.replyDueAt && (c.firstReplyAt ? c.firstReplyAt > c.replyDueAt : Date.now() > Date.parse(c.replyDueAt))).length;
  const closed = cases.filter((c) => c.locked).length; const confirmed = cases.filter((c) => c.clientConfirmed || c.checkedBackAt).length;
  const reopened = cases.filter((c) => c.reopenedAt).length;
  return {
    month: ym, total: cases.length, incidents: incidents.length, safety: inMonth.filter((c) => c.safety).length, open: cases.length - closed, closed,
    madeRight: confirmed, reopened, byReason, byCause, byFix, byProvider,
    cost: { ...cost, total: cost.refund + cost.credit + cost.redo, pay: payCents },
    replyMedianH: median(reply), closeMedianH: median(close), lateReplies,
    counted: cases.filter((c) => (CAUSES as any)[c.cause]?.counts).length, unmarked: cases.filter((c) => !c.cause).length,
  };
}

export const fmtHours = (h: number | null) => (h === null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
export const fmtMoney = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The report as CSV rows (for a spreadsheet). */
export function reportCsv(r: MirReport) {
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`; const L: string[] = [];
  L.push(['Making it right', monthLabel(r.month)].map(q).join(','));
  L.push(['Cases', r.total].map(q).join(',')); L.push(['Incidents', r.incidents].map(q).join(',')); L.push(['Closed', r.closed].map(q).join(',')); L.push(['Client said it was made right', r.madeRight].map(q).join(','));
  L.push(['Typical first reply', fmtHours(r.replyMedianH)].map(q).join(',')); L.push(['Typical time to close', fmtHours(r.closeMedianH)].map(q).join(','));
  L.push(['Refunds', (r.cost.refund / 100).toFixed(2)].map(q).join(',')); L.push(['Credit', (r.cost.credit / 100).toFixed(2)].map(q).join(',')); L.push(['Free redos (service value)', (r.cost.redo / 100).toFixed(2)].map(q).join(',')); L.push(['Pay corrections', (r.cost.pay / 100).toFixed(2)].map(q).join(','));
  L.push(''); L.push(['Reason', 'Cases'].map(q).join(',')); for (const x of r.byReason) L.push([x.label, x.n].map(q).join(','));
  L.push(''); L.push(['Cause', 'Cases'].map(q).join(',')); for (const x of r.byCause) L.push([x.label, x.n].map(q).join(','));
  L.push(''); L.push(['Fix', 'Cases'].map(q).join(',')); for (const x of r.byFix) L.push([x.label, x.n].map(q).join(','));
  L.push(''); L.push(['Provider', 'About their visits', 'The work itself', 'Not marked yet', 'Incidents'].map(q).join(',')); for (const p of r.byProvider) L.push([p.name, p.total, p.counted, p.unmarked, p.incidents].map(q).join(','));
  return L.join('\n');
}
