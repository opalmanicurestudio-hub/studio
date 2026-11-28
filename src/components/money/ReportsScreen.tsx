'use client';
// src/components/money/ReportsScreen.tsx — REPORTS, IN ONE PLACE (the Money page's Reports tab; design board "A. A Reports
// tab"). Every report for the dates picked, grouped by what it's for, each to print or to download as a spreadsheet
// (lib/report-builders, lib/csv): profit and loss (and month by month), the tax summary and the sales tax return, the
// payroll register, every line and the audit trail; and each closed month's statement. Nothing is read until a report
// is asked for, so opening the tab costs nothing.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { booksSummary, normalizeLine } from '@/lib/books-summary';
import { readDatedRange } from '@/hooks/use-transactions';
import {
  auditCsv, buildAuditTrailHtml, buildLedgerHtml, buildMonthStatementHtml, buildPayrollRegisterHtml, buildPnlHtml, buildSalesTaxHtml, buildTaxSummaryHtml,
  ledgerCsv, payrollCsv, pnlRows, rowsCsv, salesTaxCsv, statementCsv, taxSummaryRows, periodLabel,
} from '@/lib/report-builders';
import { csvName, downloadCsv, type Cell } from '@/lib/csv';
import { YearEndPacket } from '@/components/money/YearEndPacket';
import { calendarZone, dayKey, wallToUtc } from '@/lib/tenant-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'custom';
const PRESETS: [Preset, string][] = [['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisQuarter', 'This quarter'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['custom', 'Pick dates']];
/** The dates a choice means: the first day to the last (as this device's Dates, so they print as those days). Which
 *  month and year it is now is the business's (`tz`, lib/tenant-time calendarZone), or this device's without one. */
export function rangeOf(p: Preset, now = new Date(), from = '', to = '', tz?: string | null): { from: Date; to: Date } | null {
  const today = tz ? dayKey(now, tz) : '';
  const y = today ? Number(today.slice(0, 4)) : now.getFullYear(), m = today ? Number(today.slice(5, 7)) - 1 : now.getMonth();
  const span = (a: Date, b: Date) => ({ from: a, to: new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999) });
  if (p === 'thisMonth') return span(new Date(y, m, 1), new Date(y, m + 1, 0));
  if (p === 'lastMonth') return span(new Date(y, m - 1, 1), new Date(y, m, 0));
  if (p === 'thisQuarter') { const q = Math.floor(m / 3) * 3; return span(new Date(y, q, 1), new Date(y, q + 3, 0)); }
  if (p === 'thisYear') return span(new Date(y, 0, 1), new Date(y, 11, 31));
  if (p === 'lastYear') return span(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  return span(new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`));
}

/** What those days are to read: from the first day's midnight where the business is, up to the midnight after the last. */
export function readSpan(range: { from: Date; to: Date }, tz: string): { from: Date; to: Date } {
  const after = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1);
  return { from: wallToUtc(ymd(range.from), 0, 0, tz), to: wallToUtc(ymd(after), 0, 0, tz) };
}

export function ReportsScreen({ tenantId, firestore, tenant, staff, payroll, canManage = true, isOwner = false }: {
  tenantId: string; firestore: Firestore; tenant: any; staff: any[]; payroll: { profile: { code: string; employerPayrollTaxPct: number }; hasState: boolean };
  /** A manager or the owner: the sales tax return, the audit trail and the closed months' statements are theirs. */
  canManage?: boolean;
  /** The owner: closing the year includes their own estimated tax payments and the often-missed write-offs they answer. */
  isOwner?: boolean;
}) {
  const [preset, setPreset] = React.useState<Preset>('lastMonth');
  const [from, setFrom] = React.useState(''); const [to, setTo] = React.useState('');
  const [busy, setBusy] = React.useState(''); const [error, setError] = React.useState(''); const [note, setNote] = React.useState('');
  const [tax, setTax] = React.useState<any | null | undefined>(undefined);
  const [months, setMonths] = React.useState<any[] | null>(null); const [allMonths, setAllMonths] = React.useState(false);
  const tz = React.useMemo(() => calendarZone(tenant), [tenant]);
  const range = rangeOf(preset, new Date(), from, to, tz);
  const shop = String(tenant?.name || tenant?.businessName || '');
  const words = range ? periodLabel(range) : 'Pick the first and last day';
  const fileDates = range ? (preset === 'lastMonth' || preset === 'thisMonth' ? ymd(range.from).slice(0, 7) : `${ymd(range.from)} to ${ymd(range.to)}`) : '';

  const post = React.useCallback((url: string, body: any) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }).then((r) => r.json()).catch(() => null), [tenantId]);
  // What's due for sales tax (kept a few hours on the server, never the report itself), and the closed months: two small
  // calls when the tab opens, for a manager.
  React.useEffect(() => {
    if (!tenantId || !canManage) return;
    post('/api/money/sales-tax', { action: 'status' }).then((d) => setTax(d?.ok ? d : null));
    post('/api/money/close', { action: 'closed' }).then((d) => setMonths(d?.ok ? d.months || [] : []));
  }, [tenantId, post, canManage]);
  const taxReport = async () => { const d = await post('/api/money/sales-tax', { action: 'view', period: tax?.last?.period }); if (!d?.ok || !d.report) throw new Error('x'); return d; };

  const lines = async () => {
    if (!range) throw new Error('dates');
    const span = readSpan(range, tz);
    return (await readDatedRange(firestore, tenantId, 'transactions', 'date', span.from, span.to, tz)).map((t: any) => normalizeLine(t));
  };
  // (The lines, and what the ones that take something back take back when that's from before these dates (a meal
  // reversed in January, made in December), so each is taken back as it was counted: lib/books-summary, lib/write-offs.)
  const withOriginals = async (ls: any[]) => {
    const have = new Map<string, any>(ls.map((t) => [String(t.id), t])); let next = ls;
    for (let round = 0; round < 3; round++) {
      const want = Array.from(new Set(next.flatMap((t) => [t?.reversalOf, t?.voidOf]).map((v) => String(v || '')).filter((v) => /^[A-Za-z0-9_-]{1,160}$/.test(v) && !have.has(v)))).slice(0, 300);
      if (!want.length) break;
      const got = (await Promise.all(want.map((id) => getDoc(doc(firestore, 'tenants', tenantId, 'transactions', id)).then((d) => (d.exists() ? normalizeLine({ id: d.id, ...(d.data() as any) }) : null)).catch(() => null)))).filter(Boolean) as any[];
      for (const t of got) have.set(String(t.id), t);
      next = got;
    }
    return Array.from(have.values());
  };
  // (Who was paid what on each payday recorded in these dates, for the payroll register: lib/payday-record. Only the
  // owner and anyone who runs payroll can read them; anyone else sees the team's pay as one line.)
  const runs = async () => {
    if (!range) throw new Error('dates');
    const q = await getDocs(query(collection(firestore, `tenants/${tenantId}/payrollRuns`), where('to', '>=', ymd(new Date(range.from.getTime() - 62 * 86400000))), limit(200))).catch(() => null);
    return (q?.docs || []).map((d) => d.data() as any).filter((r) => r?.kind === 'payday');
  };
  // (The period's own actions, newest first; a period with more than a thousand says so.)
  const AUDIT_MAX = 1000;
  const audit = async () => {
    if (!range) throw new Error('dates');
    const span = readSpan(range, tz);
    const q = await getDocs(query(collection(firestore, `tenants/${tenantId}/auditLogs`), where('at', '>=', span.from.toISOString()), where('at', '<', span.to.toISOString()), orderBy('at', 'desc'), limit(AUDIT_MAX)));
    const list = q.docs.map((d) => d.data() as any);
    if (list.length >= AUDIT_MAX) setNote(`These dates have more than ${AUDIT_MAX.toLocaleString('en-US')} actions, so the audit trail shows the latest ${AUDIT_MAX.toLocaleString('en-US')}. Pick fewer days to see the rest.`);
    return { list, capped: list.length >= AUDIT_MAX };
  };

  /** Prints a report: a window opened at the tap (so it isn't blocked), filled once the report is ready. */
  const print = async (key: string, make: () => Promise<string>, dated = true) => {
    if (busy) return; setError(''); setNote('');
    if (dated && !range) { setError('Pick the first and last day first.'); return; }
    const w = window.open('', '_blank');
    if (!w) { setError('Your browser blocked the report’s window. Allow pop-ups for this site, then try again.'); return; }
    w.document.write('<p style="font-family:sans-serif;color:#6d7075;padding:24px">Getting your report ready</p>');
    setBusy(key);
    try { const html = await make(); w.document.open(); w.document.write(html); w.document.close(); w.focus(); }
    catch (e: any) { w.close(); setError(e?.message === 'dates' ? 'Pick the first and last day first.' : 'That report couldn’t be made just now. Try again.'); }
    finally { setBusy(''); }
  };
  const download = async (key: string, name: string, make: () => Promise<Cell[][]>, dated = true) => {
    if (busy) return; setError(''); setNote('');
    if (dated && !range) { setError('Pick the first and last day first.'); return; }
    setBusy(key);
    try { downloadCsv(csvName(shop, name, dated ? fileDates : ''), await make()); }
    catch (e: any) { setError(e?.message === 'dates' ? 'Pick the first and last day first.' : 'That download couldn’t be made just now. Try again.'); }
    finally { setBusy(''); }
  };
  const statement = async (m: string) => { const d = await post('/api/money/close', { action: 'statement', month: m }); if (!d?.ok) throw new Error(d?.error || 'x'); return d; };

  const Row = ({ id, name, what, extra, csv, onPrint, onCsv, open }: { id: string; name: string; what: string; extra?: React.ReactNode; csv?: boolean; onPrint?: () => void; onCsv?: () => void; open?: string }) => (
    <div className="flex flex-wrap items-center gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="min-w-[200px] flex-1"><p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{name}{extra}</p><p className="text-[14px]" style={{ color: MUTED }}>{what}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {open ? <Link href={open} className={btn} style={solid}>Open</Link> : <>
          <button type="button" onClick={onPrint} disabled={!!busy} className={btn} style={solid}>{busy === `p:${id}` ? 'Getting it ready' : 'Print'}</button>
          {csv !== false && <button type="button" onClick={onCsv} disabled={!!busy} className={btn} style={plain}>{busy === `d:${id}` ? 'Getting it ready' : 'Download'}</button>}
        </>}
      </div>
    </div>
  );
  const Group = ({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) => (
    <section aria-label={title} className="rounded-3xl bg-[#fff] px-5 pb-2 pt-4" style={{ border: `1px solid ${LINE}` }}>
      <h3 className="text-[17px] font-semibold">{title}</h3>{intro && <p className="text-[14px]" style={{ color: MUTED }}>{intro}</p>}<div className="pt-1">{children}</div>
    </section>
  );
  const summaryOf = async () => { const ls = await lines(); const lookup = await withOriginals(ls); return { ls, lookup, s: booksSummary(ls, { lookup, businessOnly: true }) }; };
  const pill = (t: string, good: boolean) => <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={good ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }}>{t}</span>;
  const taxPill = tax?.last ? (tax.last.paid ? pill('Paid', true) : tax.owed ? pill(`Due ${tax.owed.due}, ${usd(tax.owed.cents / 100)}`, false) : pill(`Nothing owed, file by ${tax.last.due}`, true)) : null;
  const shownMonths = (months || []).slice(0, allMonths ? 12 : 3);

  return (
    <div style={{ color: INK }}>
      <h2 className="text-[24px] font-semibold leading-tight">Reports</h2>
      <p className="mb-4 text-[14px]" style={{ color: MUTED }}>Print one, or download it as a spreadsheet for Excel or Google Sheets. Every figure is the same reading of your books as the Money page.</p>
      {canManage && <YearEndPacket tenantId={tenantId} firestore={firestore} tenant={tenant} owner={isOwner} shop={shop} />}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Dates">
        {PRESETS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPreset(k)} aria-pressed={preset === k} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`}
            style={preset === k ? { background: INK, color: '#fff', fontWeight: 600 } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{l}</button>))}
        {preset === 'custom' && <>
          <input type="date" aria-label="First day" value={from} onChange={(e) => setFrom(e.target.value)} className={`h-11 rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}` }} />
          <input type="date" aria-label="Last day" value={to} onChange={(e) => setTo(e.target.value)} className={`h-11 rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}` }} />
        </>}
        <span className="text-[14px]" style={{ color: MUTED }}>{words}</span>
      </div>
      {error && <p role="alert" className="mb-4 rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{error}</p>}
      {note && !error && <p role="status" className="mb-4 text-[14px]" style={{ color: MUTED }}>{note}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Group title="How the business did">
            <Row id="pnl" name="Profit and loss" what="Sales, what came off them, costs and what’s left. The same reading as the Money page."
              onPrint={() => print('p:pnl', async () => { const ls = await lines(); return buildPnlHtml(ls, range!, 'USD', { lookup: await withOriginals(ls), shopName: shop }); })}
              onCsv={() => download('d:pnl', 'profit and loss', async () => rowsCsv(pnlRows((await summaryOf()).s)))} />
            <Row id="pnlm" name="Profit and loss, month by month" what="Each month of the year side by side, to see the trend." open="/records/pnl" />
          </Group>
          <Group title="Taxes">
            <Row id="tax" name="Tax summary" what="Income and costs by Schedule C line, to hand your accountant."
              onPrint={() => print('p:tax', async () => { const ls = await lines(); return buildTaxSummaryHtml(ls, range!, 'USD', { lookup: await withOriginals(ls), shopName: shop }); })}
              onCsv={() => download('d:tax', 'tax summary', async () => { const ls = await lines(); return rowsCsv(taxSummaryRows(ls, { lookup: await withOriginals(ls) })); })} />
            {!canManage ? null : tax === null || tax?.unset ? (
              <div className="py-3" style={{ borderTop: `1px solid ${LINE}` }}><p className="text-[15px] font-semibold">Sales tax return</p>
                <p className="text-[14px]" style={{ color: MUTED }}>{tax?.unset ? 'Sales tax isn’t set up yet. ' : 'It couldn’t be read just now. '}<Link href="/settings?tab=payments#sales-tax" className="underline underline-offset-2" style={{ color: INK }}>Sales tax settings</Link></p></div>
            ) : (
              <Row id="st" name={tax?.last ? `Sales tax return, ${tax.last.label}` : 'Sales tax return'} extra={taxPill}
                what={tax?.last ? 'What you collected and owe, by location. Other periods are in your sales tax settings.' : 'Reading your sales tax'}
                onPrint={() => print('p:st', async () => { const d = await taxReport(); return buildSalesTaxHtml(d.report, { shopName: shop, paid: d.paid }); }, false)}
                onCsv={() => download('d:st', `sales tax ${tax?.last?.label || ''}`, async () => salesTaxCsv((await taxReport()).report), false)} />
            )}
          </Group>
          <Group title="Your team">
            <Row id="pay" name="Payroll register" what="Pay by person, with the employer tax estimate."
              onPrint={() => print('p:pay', async () => buildPayrollRegisterHtml(await lines(), staff, payroll.profile, range!, payroll.hasState, 'USD', { shopName: shop, payrollRuns: await runs() }))}
              onCsv={() => download('d:pay', 'payroll register', async () => payrollCsv(await lines(), staff, payroll.profile, await runs()))} />
          </Group>
        </div>
        <div className="space-y-4">
          <Group title="Records">
            <Row id="all" name="Every line, in full detail" what="Each checkout and order with its lines, and the receipt pictures at the back."
              onPrint={() => print('p:all', async () => { const { ls, s, lookup } = await summaryOf(); return buildLedgerHtml(ls, staff, s, range!, { lookup, shopName: shop }); })}
              onCsv={() => download('d:all', 'every line', async () => { const ls = await lines(); return ledgerCsv(ls, staff, { lookup: await withOriginals(ls) }); })} />
            {canManage && <Row id="audit" name="Audit trail" what="Who did what with the money, and when, in plain words."
              onPrint={() => print('p:audit', async () => { const a = await audit(); return buildAuditTrailHtml(a.list, range!, 'USD', { shopName: shop, capped: a.capped }); })}
              onCsv={() => download('d:audit', 'audit trail', async () => auditCsv((await audit()).list))} />}
          </Group>
          {canManage && <Group title="Closed months" intro="Each prints on one page: its profit, its sales tax, the bank, and anything corrected after it closed.">
            {months === null ? <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Looking for closed months</p>
              : months.length === 0 ? <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>No month is closed yet. Close one from the Overview, and its one-page statement is here to print.</p>
              : shownMonths.map((mo) => (
                <Row key={mo.month} id={`m-${mo.month}`} name={mo.label}
                  what={mo.at ? `Closed ${new Date(mo.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${mo.by ? ` by ${mo.by}` : ''}.` : 'Closed.'}
                  onPrint={() => print(`p:m-${mo.month}`, async () => buildMonthStatementHtml(await statement(mo.month), { shopName: shop }), false)}
                  onCsv={() => download(`d:m-${mo.month}`, `statement ${mo.month}`, async () => statementCsv(await statement(mo.month)), false)} />
              ))}
            {(months || []).length > 3 && <button type="button" onClick={() => setAllMonths(!allMonths)} className={`my-2 ${btn}`} style={plain}>{allMonths ? 'Show fewer' : 'Show more months'}</button>}
          </Group>}
        </div>
      </div>
    </div>
  );
}
