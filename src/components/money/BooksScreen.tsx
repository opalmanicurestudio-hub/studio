'use client';
// src/components/money/BooksScreen.tsx — THE BOOKS, on the Money page (design boards "Money, the books" and "A line in a
// closed month"). Every line for the dates picked, by day, newest first, each day with what came in and went out; a line
// opens beside the list (over it, on a phone) with what it is: its category, where it goes on your taxes, how it was
// paid, what it came from, and whether the bank has it. From there: change its category, add a receipt, refund a sale or
// undo the line. A line in a closed month can't change: a correction goes in today, saying which line it corrects
// (lib/books-close). The page (app/(app)/money/page.tsx, the Books tab) reads the lines and does the writing.
import * as React from 'react';
import Link from 'next/link';
import { categoriesFor, scheduleCFor } from '@/lib/categories';
import { effectOf } from '@/lib/books-summary';
import { isMeal, isTakeBack, mealKindOf, originalOf } from '@/lib/write-offs';
import { closeOf, inClosedMonth, monthName } from '@/lib/books-close';
import { ImageUpload } from '@/components/shared/ImageUpload';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ' + RING;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const quiet = `min-h-[44px] rounded-full px-3 text-[14px] ${RING}`;
const field = `h-11 rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`;
const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE = 300;

const asDate = (v: any): Date => { if (v?.toDate) return v.toDate(); if (v && typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000); return new Date(v); };
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const dayName = (key: string) => {
  const t = new Date(); if (key === ymd(t)) return 'Today';
  if (key === ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1))) return 'Yesterday';
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(key.slice(0, 4) !== String(t.getFullYear()) ? { year: 'numeric' } : {}) });
};
const shortDay = (v: any) => asDate(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const timeOf = (v: any) => asDate(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Money in or out, the way the bank would see it: a line that undoes a sale is money out, one that undoes a cost is
 *  money in. */
export function wayOf(t: any, byId?: Map<string, any>): 'in' | 'out' {
  const type = String(t?.type || 'income');
  if (type === 'income') return 'in';
  if (type === 'reversal') return String(t?.reversedType || byId?.get(String(t?.reversalOf))?.type || 'income') === 'income' ? 'out' : 'in';
  return 'out';
}

/** Where a line goes on the business's taxes (US Schedule C; a planning aid, not tax advice). */
export function taxLineOf(t: any, byId?: Map<string, any>): string {
  if ((t?.context || 'Business') === 'Personal') return 'Personal: not on your business taxes';
  const e = effectOf(t, byId); const side = e.side;
  switch (side) {
    case 'sales': return 'Line 1, gross receipts';
    case 'returns': case 'discounts': return 'Line 2, returns and allowances';
    case 'other': return 'Line 6, other income';
    case 'tips': return 'Tips for your team: paid out with their pay, not your income';
    case 'tax': return 'Sales tax held for the state: not your income';
    case 'taxpaid': return 'Sales tax paid to the state: not a cost';
    case 'held': return 'Held for someone else: not your income';
    case 'transfer': return 'Money moved: not income or a cost';
    case 'skip': return '';
    default: {
      // (A meal's line by its kind, said on the Write-offs tab: lib/write-offs.)
      if (isMeal({ category: e.category || t?.category })) {
        const o = originalOf(t, byId);
        if (isTakeBack(o)) return 'Line 24b, deductible meals (the same share as the meal it takes back)';
        const k = mealKindOf(o);
        return k === 'entertainment' ? 'Entertainment: not deductible' : k === 'personal' ? 'A personal meal: not deductible' : `Line 24b, deductible meals (${k === 'team' ? 'all' : 'half'} counts)`;
      }
      return scheduleCFor(String(t?.category || '')).replace(' — ', ', ');
    }
  }
}

/** A correction to line `t`, dated today by whoever writes it: the category it should have been (taken off one, put on
 *  the other), the amount it should have been (the difference: more, or taken back), or not in the books at all (taken
 *  back). Each line says the line it corrects. null: nothing to correct yet. */
export function correctionFor(t: any, what: 'category' | 'amount' | 'remove', category = '', rightCents = NaN): { lines: any[]; summary: string } | null {
  const cents = Math.round((Number(t?.amount) || 0) * 100);
  const desc = String(t?.description || t?.category || 'the line'); const on = shortDay(t?.date);
  // (Where it was sold and how it was taxed go with it, so the sales tax report reads the correction the same way.)
  const keep = Object.fromEntries(['staffId', 'clientId', 'taxFree', 'appKey', 'appTaxCents', 'retailOrderId', 'locationId', 'taxLocationId'].filter((k) => t?.[k] !== undefined && t?.[k] !== null).map((k) => [k, t[k]]));
  const base = { context: t?.context || 'Business', clientOrVendor: t?.clientOrVendor || '', paymentMethod: 'Correction', hasReceipt: false, correctionOf: t?.id, ...keep };
  // (A line that takes another back, or a void: only taken out, or taken back by less.)
  if (takesBack(t) && (what === 'category' || (what === 'amount' && rightCents > cents))) return null;
  // (Taking back a refund puts back the tax and the tip that came back with it, in proportion, so what's owed the state
  // and the team's tips are right even when the refund's own sale isn't read.)
  const share = (k: string, cs: number) => (Number(t?.[k]) > 0 && cents > 0 ? { [k]: Math.round(Number(t[k]) * (cs / cents) * 100) / 100 } : {});
  const back = (cs: number, d: string) => ({ ...base, type: 'reversal', reversalOf: t?.id, reversedType: t?.type, category: t?.category, ...(t?.taxBucket ? { taxBucket: t.taxBucket } : {}), amount: cs / 100, description: d,
    ...share('taxRefunded', cs), ...share('tipRefunded', cs), ...(t?.tipBooked ? { tipBooked: true } : {}) });
  if (what === 'remove') return { lines: [back(cents, `Correction: ${desc} (${on}) taken out`)], summary: `${desc} (${on}) taken out of the books` };
  if (what === 'category') {
    if (!category || category === t?.category) return null;
    return { lines: [back(cents, `Correction: ${desc} (${on}) moved off ${t?.category}`), { ...base, type: t?.type, category, amount: cents / 100, description: `Correction: ${desc} (${on}) moved to ${category}` }], summary: `${desc} (${on}) moved from ${t?.category} to ${category}` };
  }
  if (!Number.isFinite(rightCents) || rightCents < 0 || rightCents === cents) return null;
  const diff = rightCents - cents;
  return { lines: [diff > 0 ? { ...base, type: t?.type, category: t?.category, ...(t?.taxBucket ? { taxBucket: t.taxBucket } : {}), amount: diff / 100, description: `Correction: ${desc} (${on}), ${usd(diff / 100)} more` } : back(-diff, `Correction: ${desc} (${on}), ${usd(diff / 100)} less`)],
    summary: `${desc} (${on}) corrected from ${usd(cents / 100)} to ${usd(rightCents / 100)}` };
}

/** A line that takes another back (an undo, a refund) or a void. */
export const takesBack = (t: any) => String(t?.type) === 'reversal' || /^void$/i.test(String(t?.category || '')) || !!t?.voidOf;
/** The lines whose whole amount an Undo took back (lines from Undo, and from the older "Reversal of" before it), never
 *  a refund. */
export function undoneIn(byId: Map<string, any>): Set<string> {
  const s = new Set<string>();
  for (const u of byId.values()) {
    if (u?.type !== 'reversal' || !u.reversalOf || u.correctionOf || !(u.undo || /^reversal of:/i.test(String(u.description || '')))) continue;
    const o = byId.get(String(u.reversalOf)); if (!o || Math.round((Number(u.amount) || 0) * 100) >= Math.round((Number(o.amount) || 0) * 100)) s.add(String(u.reversalOf));
  }
  return s;
}

type Mark = { label: string; warn?: boolean };
function markOf(t: any, byId: Map<string, any>, undone: Set<string>): Mark | null {
  if (/^uncategori[sz]ed$/i.test(String(t.category || ''))) return { label: 'Needs a category', warn: true };
  if (t.voided) return { label: 'Voided' };
  if (t.refundedAt) return { label: 'Refunded' };
  if (undone.has(String(t.id))) return { label: 'Undone' };
  if (t.autoCategorized || t.sortedBy === 'bank') return { label: 'Sorted for you' };
  if (t.reconciled || t.bankTransactionId) return { label: 'Matched' };
  const side = effectOf(t, byId).side; if (side === 'tax' || side === 'held') return { label: 'Held' };
  if (t.hasReceipt || t.receiptUrl || t.receiptId) return { label: 'Receipt' };
  return null;
}
const pill = (m: Mark) => ({ background: m.warn ? AMBER_TINT : SOFT, color: m.warn ? AMBER : MUTED });

export type BooksFilters = {
  preset: string; setPreset: (p: string) => void; from?: Date; to?: Date; setRange: (from?: Date, to?: Date) => void;
  search: string; setSearch: (s: string) => void; way: 'all' | 'in' | 'out'; setWay: (w: 'all' | 'in' | 'out') => void;
  books: 'all' | 'Business' | 'Personal'; setBooks: (b: 'all' | 'Business' | 'Personal') => void; hasPersonal: boolean;
  category: string; setCategory: (c: string) => void; categories: string[];
};

export function BooksScreen(p: {
  lines: any[]; byId: Map<string, any>; loading: boolean; biz: any; staff: any[]; tenantId: string;
  filters: BooksFilters; reports: React.ReactNode; onNew: () => void;
  /** Snap a receipt: Add a line with the photo first, filled in from it. */
  onSnap?: () => void;
  onChangeCategory: (t: any, category: string) => Promise<boolean>; onReceipt: (t: any, url: string) => Promise<boolean>;
  onPreviewReceipt: (t: any) => void; onRefund: (t: any) => void; onUndo: (t: any) => Promise<boolean | string>;
  onCorrect: (t: any, lines: any[], summary: string) => Promise<boolean>; onDisputePack?: (t: any) => void;
  /** What the dates come to (the books' own reading, as on the Overview). */
  summary?: { netSales: number; returns: number; tips: number; net: number } | null;
  /** Whether a line was undone already (its Undo may be on another day than these). */
  isUndone?: (t: any) => Promise<boolean>;
}) {
  const { lines, byId, filters: f } = p;
  const [openId, setOpenId] = React.useState(''); const [shown, setShown] = React.useState(PAGE);
  // (Back to the first lines when the filters change, never when a new line comes in.)
  React.useEffect(() => setShown(PAGE), [f.preset, f.search, f.way, f.books, f.category, f.from?.getTime(), f.to?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const undone = React.useMemo(() => undoneIn(byId), [byId]);
  const open = lines.find((t) => t.id === openId) || (openId ? byId.get(openId) : null) || null;

  const days = React.useMemo(() => {
    const out: { key: string; rows: any[]; inn: number; out: number }[] = [];
    for (const t of lines.slice(0, shown)) {
      const key = ymd(asDate(t.date)); let d = out[out.length - 1];
      if (!d || d.key !== key) { d = { key, rows: [], inn: 0, out: 0 }; out.push(d); }
      d.rows.push(t); if (wayOf(t, byId) === 'in') d.inn += Number(t.amount) || 0; else d.out += Number(t.amount) || 0;
    }
    return out;
  }, [lines, shown, byId]);
  const totals = React.useMemo(() => lines.reduce((a, t) => { if (wayOf(t, byId) === 'in') a.inn += Number(t.amount) || 0; else a.out += Number(t.amount) || 0; return a; }, { inn: 0, out: 0 }), [lines, byId]);

  return (
    <div style={{ color: INK }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><h1 className="text-[24px] font-semibold leading-tight">Books</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>Every sale, cost and move of money, kept for you</p></div>
        <div className="flex flex-wrap gap-2">{p.reports}{p.onSnap && <button type="button" onClick={p.onSnap} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${INK}` }}>Snap a receipt</button>}<button type="button" onClick={p.onNew} className={btn} style={solid}>New entry</button></div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-3xl bg-[#fff] p-3" style={{ border: `1px solid ${LINE}` }}>
        <input value={f.search} onChange={(e) => f.setSearch(e.target.value)} placeholder="Find a name or a note" aria-label="Find" className={`${field} min-w-[180px] flex-1`} style={{ border: `1px solid ${LINE}` }} />
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Dates
          <select value={f.preset} onChange={(e) => f.setPreset(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }}>
            {[['today', 'Today'], ['7days', 'Last 7 days'], ['30days', 'Last 30 days'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['custom', 'Pick dates']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        {f.preset === 'custom' && <>
          <input type="date" aria-label="From" value={f.from ? ymd(f.from) : ''} onChange={(e) => f.setRange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined, f.to)} className={field} style={{ border: `1px solid ${LINE}` }} />
          <input type="date" aria-label="To" value={f.to ? ymd(f.to) : ''} onChange={(e) => f.setRange(f.from, e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)} className={field} style={{ border: `1px solid ${LINE}` }} />
        </>}
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Show
          <select value={f.way} onChange={(e) => f.setWay(e.target.value as any)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }}>
            <option value="all">Money in and out</option><option value="in">Money in</option><option value="out">Money out</option></select></label>
        {f.hasPersonal && <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Books
          <select value={f.books} onChange={(e) => f.setBooks(e.target.value as any)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }}>
            <option value="all">Business and personal</option><option value="Business">Business</option><option value="Personal">Personal</option></select></label>}
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Category
          <select value={f.category} onChange={(e) => f.setCategory(e.target.value)} className={`${field} max-w-[200px]`} style={{ border: `1px solid ${LINE}`, color: INK }}>
            <option value="all">All categories</option>{f.categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      <div className={open ? 'md:grid md:grid-cols-[minmax(0,1fr)_360px] md:items-start md:gap-5' : ''}>
        <section aria-label="Lines in your books" className="min-w-0 rounded-3xl bg-[#fff] px-5 pb-3 pt-4" style={{ border: `1px solid ${LINE}` }}>
          <p className="text-[14px]" style={{ color: MUTED }}>{p.loading ? 'Reading your books' : lines.length ? `${lines.length.toLocaleString('en-US')} line${lines.length === 1 ? '' : 's'}: ${usd(totals.inn)} came in and ${usd(totals.out)} went out.` : 'Nothing in your books for these dates.'}</p>
          {!p.loading && lines.length > 0 && p.summary && <p className="pb-2 text-[14px]" style={{ color: MUTED }}>
            Net sales <span className="tabular-nums" style={{ color: INK }}>{usd(p.summary.netSales)}</span>{p.summary.returns > 0 ? `, after ${usd(p.summary.returns)} of refunds` : ''}. Profit <span className="tabular-nums" style={{ color: p.summary.net < 0 ? AMBER : INK }}>{p.summary.net < 0 ? '−' : ''}{usd(p.summary.net)}</span>{p.summary.tips > 0 ? `. Tips for the team ${usd(p.summary.tips)}` : ''}. Money in and out isn’t profit: sales tax, tips and moves between your accounts go through it too.</p>}
          {days.map((d) => (
            <div key={d.key} className="pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-1">
                <h2 className="text-[15px] font-semibold">{dayName(d.key)}</h2>
                <span className="text-[13px] tabular-nums" style={{ color: MUTED }}>+{usd(d.inn)} in, {usd(d.out)} out</span>
              </div>
              {d.rows.map((t) => {
                const m = markOf(t, byId, undone); const inn = wayOf(t, byId) === 'in'; const who = String(t.clientOrVendor || t.description || t.category || '?').trim();
                return (
                  <button key={t.id} type="button" onClick={() => setOpenId(openId === t.id ? '' : t.id)} aria-expanded={openId === t.id}
                    className={`flex min-h-[62px] w-full items-center gap-3 rounded-2xl px-2 text-left ${RING}`} style={{ borderTop: `1px solid ${LINE}`, background: openId === t.id ? SOFT : 'transparent' }}>
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: SOFT, color: MUTED }}>{/^uncategori/i.test(String(t.category)) ? '?' : who.charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{t.description || t.clientOrVendor || t.category}</span>
                      <span className="block truncate text-[13px]" style={{ color: MUTED }}>{/^uncategori/i.test(String(t.category)) ? 'No category yet' : t.category}{t.paymentMethod ? `, ${t.paymentMethod}` : ''}</span></span>
                    {m && <span className="hidden shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold sm:inline" style={pill(m)}>{m.label}</span>}
                    <span className="min-w-[84px] shrink-0 text-right text-[15px] font-semibold tabular-nums" style={{ color: inn ? GREEN : INK }}>{inn ? '+' : '−'}{usd(Number(t.amount) || 0)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {lines.length > shown && <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`mt-3 ${btn}`} style={plain}>Show more</button>}
        </section>

        {open && <>
          <aside className="sticky top-4 hidden md:block" aria-label="The line"><LineDetail {...p} t={open} undone={undone} onClose={() => setOpenId('')} /></aside>
          <div className="fixed inset-0 z-50 flex items-end bg-[rgba(22,23,26,0.35)] md:hidden" onClick={() => setOpenId('')}>
            <div role="dialog" aria-modal="true" aria-label="The line" className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl" onClick={(e) => e.stopPropagation()}>
              <LineDetail {...p} t={open} undone={undone} onClose={() => setOpenId('')} />
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}

/** One line, with what it is and what can be done with it. */
function LineDetail(p: React.ComponentProps<typeof BooksScreen> & { t: any; undone: Set<string>; onClose: () => void }) {
  const { t, byId, biz } = p;
  const [mode, setMode] = React.useState<'' | 'category' | 'receipt' | 'undo' | 'correct'>('');
  const [cat, setCat] = React.useState(''); const [what, setWhat] = React.useState<'category' | 'amount' | 'remove'>('category'); const [amt, setAmt] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState(''); const [err, setErr] = React.useState('');
  React.useEffect(() => { setMode(''); setNote(''); setErr(''); setCat(''); setAmt(''); setWhat(takesBack(t) ? 'amount' : 'category'); }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const inn = wayOf(t, byId) === 'in'; const closed = inClosedMonth(biz, t.date); const c = closeOf(biz);
  const month = closed ? monthName(ymd(asDate(t.date)).slice(0, 7), false) : '';
  const isUndo = takesBack(t);
  const [undoneThere, setUndoneThere] = React.useState(false);
  React.useEffect(() => { let on = true; setUndoneThere(false); if (!isUndo && p.isUndone) p.isUndone(t).then((x) => { if (on) setUndoneThere(!!x); }).catch(() => {}); return () => { on = false; }; }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const undone = p.undone.has(String(t.id)) || undoneThere;
  const type: 'income' | 'expense' = String(t.type) === 'income' ? 'income' : 'expense';
  const staff = (p.staff || []).find((s: any) => s.id === t.staffId);
  const taxLine = taxLineOf(t, byId);
  const go = async (fn: () => Promise<boolean | string>, done: string) => { setBusy(true); setErr(''); try { const r = await fn(); if (r === true) { setNote(done); setMode(''); } else setErr(typeof r === 'string' ? r : 'That didn’t save. Try again.'); } catch { setErr('That didn’t save. Try again.'); } finally { setBusy(false); } };
  const row = (k: string, v: React.ReactNode) => v ? <div className="flex gap-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}><span className="w-[104px] shrink-0 text-[14px]" style={{ color: MUTED }}>{k}</span><span className="min-w-0 flex-1 text-[14px]">{v}</span></div> : null;
  const links: React.ReactNode[] = []; const lk = `inline-flex min-h-[44px] items-center underline underline-offset-2 ${RING}`;
  if (t.appointmentId) links.push(<Link key="v" href="/planner" className={lk}>The visit</Link>);
  if (t.retailOrderId) links.push(<Link key="o" href={`/retail-orders?order=${encodeURIComponent(String(t.retailOrderId))}`} className={lk}>The online order</Link>);
  if (t.relatedOrderId) links.push(<Link key="p" href="/inventory" className={lk}>The supplier order</Link>);
  if (t.relatedBillInstanceId) links.push(<Link key="b" href="/bills" className={lk}>The bill</Link>);
  if (t.reversalOf && byId.get(String(t.reversalOf))) { const o = byId.get(String(t.reversalOf)); links.push(<span key="r">It takes back {o.description || o.category}, {shortDay(o.date)}</span>); }
  const cents = Math.round((Number(t.amount) || 0) * 100);
  const right = Math.round((Number(amt) || 0) * 100);

  const fix = correctionFor(t, what, cat, amt.trim() === '' ? NaN : right);

  return (
    <div className="rounded-3xl bg-[#fff] px-5 pb-4 pt-4" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px]" style={{ color: MUTED }}>{dayName(ymd(asDate(t.date)))}, {timeOf(t.date)}</p>
        <button type="button" onClick={p.onClose} className={quiet} style={{ color: MUTED }}>Done</button>
      </div>
      <h2 className="text-[18px] font-semibold leading-snug">{t.description || t.clientOrVendor || t.category}</h2>
      {t.clientOrVendor && t.clientOrVendor !== t.description && <p className="text-[14px]" style={{ color: MUTED }}>{t.clientOrVendor}</p>}
      <p className="mb-2 mt-1 text-[24px] font-semibold tabular-nums" style={{ color: inn ? GREEN : INK }}>{inn ? '+' : '−'}{usd(Number(t.amount) || 0)}</p>
      {row('Category', /^uncategori/i.test(String(t.category)) ? <span style={{ color: AMBER }}>No category yet</span> : t.category)}
      {row('On your taxes', taxLine)}
      {row('Paid with', t.paymentMethod)}
      {row('Books', t.context === 'Personal' ? 'Personal' : 'Business')}
      {row('Who', staff?.name)}
      {row('Entered by', t.enteredBy && t.enteredBy !== staff?.name ? String(t.enteredBy) : '')}
      {row('From', links.length ? <span className="flex flex-col gap-1">{links}</span> : null)}

      {(t.reconciled || t.bankTransactionId) && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>{t.sortedBy === 'bank' || t.autoCategorized ? 'Booked from your bank and sorted for you. Change it on the Bank page and lines from that payee follow.' : `Matched to your bank${t.reconciledAt ? ` on ${shortDay(t.reconciledAt)}` : ''}, so it’s counted once.`}</p>}
      {t.refundedAt && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Refunded on {shortDay(t.refundedAt)}.</p>}
      {undone && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Undone: a line taking it back is in your books.</p>}
      {note && <p role="status" className="mt-2 text-[14px] font-medium" style={{ color: GREEN }}>{note}</p>}
      {err && <p role="alert" className="mt-2 rounded-2xl px-3 py-2 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}

      {closed && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: AMBER_TINT }}>
          <p className="text-[14px] font-semibold" style={{ color: AMBER }}>{month} is closed</p>
          <p className="mt-0.5 text-[14px]" style={{ color: INK }}>This line can’t change. If something on it was wrong, add a correction: it goes in today, and {month} stays as you closed it.</p>
        </div>
      )}

      {mode === 'category' && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <label className="block text-[14px] font-medium">What is it?
            <select value={cat || t.category} onChange={(e) => setCat(e.target.value)} className={`${field} mt-1 w-full`} style={{ border: `1px solid ${LINE}`, color: INK }}>
              {[...new Set([String(t.category), ...categoriesFor(type).map((x) => x.name)])].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !cat || cat === t.category} onClick={() => go(() => p.onChangeCategory(t, cat), `It’s ${cat} now.`)} className={btn} style={solid}>{busy ? 'Saving' : 'Save'}</button>
            <button type="button" onClick={() => setMode('')} className={quiet} style={{ color: MUTED }}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'receipt' && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <p className="mb-2 text-[13px]" style={{ color: MUTED }}>It’s kept with the line{closed ? `, even in ${month}` : ''}.</p>
          <ImageUpload onImageUploaded={(url: string) => go(() => p.onReceipt(t, url), 'The receipt is kept with it.')} />
        </div>
      )}
      {mode === 'undo' && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <p className="text-[14px] font-medium">Undo this line?</p>
          <p className="text-[13px]" style={{ color: MUTED }}>A line taking it back goes in today. This one stays, so your books show both.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => go(() => p.onUndo(t), 'It’s undone: a line taking it back went in today.')} className={btn} style={{ background: RED, color: '#fff' }}>{busy ? 'Saving' : 'Undo it'}</button>
            <button type="button" onClick={() => setMode('')} className={quiet} style={{ color: MUTED }}>Keep it</button>
          </div>
        </div>
      )}
      {mode === 'correct' && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <p className="text-[14px] font-medium">What was wrong?</p>
          <div className="mt-1 flex flex-col" role="radiogroup" aria-label="What was wrong">
            {([['category', 'The category'], ['amount', isUndo ? 'It took back too much' : 'The amount'], ['remove', 'It shouldn’t be in the books']] as const).filter(([v]) => !(isUndo && v === 'category')).map(([v, l]) => (
              <label key={v} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]"><input type="radio" name={`fix-${t.id}`} checked={what === v} onChange={() => setWhat(v)} className="h-5 w-5" style={{ accentColor: INK }} />{l}</label>))}
          </div>
          {what === 'category' && <select value={cat || t.category} onChange={(e) => setCat(e.target.value)} aria-label="The category it should be" className={`${field} mt-1 w-full`} style={{ border: `1px solid ${LINE}`, color: INK }}>
            {[...new Set([String(t.category), ...categoriesFor(type).map((x) => x.name)])].map((x) => <option key={x} value={x}>{x}</option>)}</select>}
          {what === 'amount' && <label className="mt-1 block text-[14px]" style={{ color: MUTED }}>What it should have been
            <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, '').slice(0, 12))} placeholder={(cents / 100).toFixed(2)} className={`${field} mt-1 w-full`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>}
          <p className="mt-2 text-[13px]" style={{ color: MUTED }}>{fix ? `It goes in today, saying it corrects this line${month ? `. ${month} stays as you closed it` : ''}.` : what === 'category' ? 'Pick the category it should have been.' : isUndo ? `Type what it should have taken back: less than ${usd(cents / 100)}. To take back more, refund or undo the line it takes back.` : 'Type what it should have been.'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !fix} onClick={() => fix && go(() => p.onCorrect(t, fix.lines, fix.summary), 'The correction is in today’s books.')} className={btn} style={solid}>{busy ? 'Saving' : 'Add the correction'}</button>
            <button type="button" onClick={() => setMode('')} className={quiet} style={{ color: MUTED }}>Cancel</button>
          </div>
        </div>
      )}

      {!mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          {closed ? <button type="button" onClick={() => setMode('correct')} className={btn} style={solid}>Add a correction</button>
            : !isUndo && !undone && <button type="button" onClick={() => setMode('category')} className={btn} style={plain}>Change the category</button>}
          {(t.receiptId || t.receiptUrl) ? <button type="button" onClick={() => (t.receiptId ? p.onPreviewReceipt(t) : window.open(String(t.receiptUrl), '_blank', 'noopener'))} className={btn} style={plain}>See the receipt</button>
            : <button type="button" onClick={() => setMode('receipt')} className={btn} style={plain}>Add a receipt</button>}
          {String(t.type) === 'income' && !t.refundedAt && !t.voided && !undone && effectOf(t, byId).side === 'sales'
            && (t.retailOrderId ? <Link href={`/retail-orders?order=${encodeURIComponent(String(t.retailOrderId))}`} className={btn} style={plain}>Refund on the order</Link>
              : <button type="button" onClick={() => p.onRefund(t)} className={btn} style={plain}>Refund</button>)}
          {!closed && !isUndo && !undone && <button type="button" onClick={() => setMode('undo')} className={quiet} style={{ color: RED }}>Undo this line</button>}
          {t.appointmentId && !isUndo && p.onDisputePack && <button type="button" onClick={() => p.onDisputePack!(t)} className={quiet} style={{ color: MUTED }}>Card dispute pack</button>}
        </div>
      )}
      {closed && c && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>The owner can reopen {month} from Close a month. Reopening is kept on the record, with the reason.</p>}
    </div>
  );
}
