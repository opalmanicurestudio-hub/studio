// src/lib/records-reports.ts — RECORDS AS REPORTS (lib/report-kit; api/records 'report' and 'csv'; the page at
// /records/[kind]). Each of the month's records made into one report: what it is, the numbers that matter, a picture,
// what's worth a look, the table and how to read it. The spreadsheet is made from the same table (report-kit reportCsv),
// so its columns are the ones the accountant has always had.
//   nights       every night's sales, tax, tips, comps, voids and the drawers
//   tips         each person's card and cash tips, what they declared and their share after sharing
//   declared     each person's signed cash tip report, and who hasn't yet
//   stock        what's on the shelf, item by item, as kept for the month (or now)
//   purchases    orders received, by supplier, with the invoices
//   adjustments  comps and voids, by who gave them
import { cleanMonth, declareBy, monthDays, monthOfDay, monthWords, prevMonth, tipCheck, CASH_TIP_MIN_CENTS } from '@/lib/records';
import { monthAdjustments, monthBounds, monthNights, monthPurchases, monthSales, monthTips, stockNow, STOCK_LINES_KEPT, type NightRow } from '@/lib/records-server';
import { changeWords, dayWords, dollars, fileName, kpiDollars, listWords, longDay, pct, r2, RECORD_REPORTS, totalsOf, weekday, type Bar, type Cell, type Col, type Kpi, type Note, type Report } from '@/lib/report-kit';

const $ = (c: number) => Math.round(c) / 100;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const NOTHING: Note = { text: 'Nothing stands out this month.', tone: 'plain' };

export class ReportStop extends Error { constructor(public msg: string, public status = 400) { super(msg); } }

/** One of the month's records, as a report. */
/** A past month's sales, night by night (by day of the month), worked out once and kept with the nights
 *  (recordsNights/{YYYY-MM}: a month's id never looks like a day's); the month in progress is never kept. */
async function monthSalesByDay(db: any, tenantId: string, tenant: any, month: string, today: string, rows?: NightRow[]): Promise<number[]> {
  const ref = db.doc(`tenants/${tenantId}/recordsNights/${month}`); const past = month < monthOfDay(today);
  // Kept only once worked out two days after the month ended (a night closed late, or a refund in the first days after,
  // is then in it); an earlier one is worked out again.
  const [y, m] = month.split('-').map(Number); const settled = new Date(Date.UTC(y, m, 3)).toISOString();
  if (past) { const x: any = (await ref.get().catch(() => null))?.data?.() || null; if (Array.isArray(x?.byDay) && String(x.at || '') >= settled) return x.byDay.map((v: unknown) => Number(v) || 0); }
  const nights = rows || await monthNights(db, tenantId, tenant, month);
  const byDay = nights.map((n) => n.sales);
  if (past) await ref.set({ byDay, at: new Date().toISOString() }).catch(() => undefined);
  return byDay;
}

/** One of the month's records, as a report. With `csvOnly`, only its table (for the spreadsheet): none of the numbers
 *  that need more reading (last month's sales, the food and drink sales, the month's sales for comps and voids). */
export async function buildRecordReport(db: any, tenantId: string, tenant: any, kind: string, monthIn: unknown, today: string, opts: { csvOnly?: boolean } = {}): Promise<Report> {
  const csvOnly = !!opts.csvOnly;
  const T = `tenants/${tenantId}`; const def = RECORD_REPORTS.find((x) => x.kind === kind); if (!def) throw new ReportStop('Which record?');
  const month = cleanMonth(monthIn) || monthOfDay(today); if (month > monthOfDay(today)) throw new ReportStop('That month hasn’t started yet.');
  const mw = monthWords(month); const business = words(tenant.name, 80); const current = month === monthOfDay(today);
  const days = monthDays(month, today); const bnd = monthBounds(tenant, days);
  const base = { kind, title: `${def.title}, ${mw}`, group: def.group, month, monthWords: mw, business, madeAt: new Date().toISOString() };
  const lastMonth = monthWords(prevMonth(month)).split(' ')[0];

  if (kind === 'nights') {
    const nights = await monthNights(db, tenantId, tenant, month);
    const sold = nights.filter((n) => n.sales > 0);
    const sales = r2(nights.reduce((s, n) => s + n.sales, 0)); const tax = r2(nights.reduce((s, n) => s + n.tax, 0));
    const comps = r2(nights.reduce((s, n) => s + n.comps, 0)); const voids = r2(nights.reduce((s, n) => s + n.voids, 0));
    const drawers = nights.filter((n) => n.overShort !== null); const drawer = r2(drawers.reduce((s, n) => s + (n.overShort || 0), 0));
    const short = drawers.filter((n) => (n.overShort || 0) < 0);
    const best = sold.reduce<NightRow | null>((b, n) => (!b || n.sales > b.sales ? n : b), null);
    const open = nights.filter((n) => !n.closed && n.sales > 0 && n.day < today);
    // Last month's sales, for the comparison (its closed nights are kept, so this is quick).
    // Against last month: the whole month for a past one; the same days of it for the month in progress (the 10th
    // against last month's first ten days), so a month half done doesn't read as down by half.
    if (month < monthOfDay(today) && !csvOnly) await monthSalesByDay(db, tenantId, tenant, month, today, nights).catch(() => null);
    const prevDays = csvOnly ? [] : await monthSalesByDay(db, tenantId, tenant, prevMonth(month), today).catch(() => [] as number[]);
    // (This month: the days already done, today being only part sold.)
    const done = current ? days.length - 1 : prevDays.length;
    const before = r2(prevDays.slice(0, done).reduce((s, v) => s + v, 0));
    const soFar = current ? r2(nights.slice(0, done).reduce((s, n) => s + n.sales, 0)) : sales;
    const ch = csvOnly || done < 1 ? null : changeWords(soFar, before, current ? `the first ${done} ${done === 1 ? 'day' : 'days'} of ${lastMonth}` : lastMonth);
    const weekend = sold.filter((n) => [5, 6, 0].includes(weekday(n.day))); const weekendSales = r2(weekend.reduce((s, n) => s + n.sales, 0));
    const avg = sold.length ? r2(sales / sold.length) : 0;
    const kpis: Kpi[] = [
      { label: 'Sales', value: kpiDollars(sales), note: `${ch ? `${ch.text} ` : ''}Before tax, after discounts.`, tone: ch?.tone },
      { label: 'Average night', value: kpiDollars(avg), note: sold.length ? `Over ${sold.length} ${sold.length === 1 ? 'night' : 'nights'} with sales.${weekend.length && weekend.length < sold.length ? ` Fridays to Sundays average ${kpiDollars(weekendSales / weekend.length)}.` : ''}` : 'No sales yet.' },
      { label: 'Best night', value: best ? kpiDollars(best.sales) : '—', note: best ? `${longDay(best.day)}${best.count ? `, ${best.count} ${best.count === 1 ? 'sale' : 'sales'}` : ''}.` : 'No sales yet.' },
      { label: 'Sales tax collected', value: kpiDollars(tax), note: `What you owe the state for ${mw.split(' ')[0]}.` },
      { label: 'Cash drawers', value: drawers.length ? `${drawer < 0 ? '−' : drawer > 0 ? '+' : ''}${dollars(Math.abs(drawer))}` : '—', tone: drawer <= -50 ? 'warn' : undefined,
        note: !drawers.length ? 'No drawer was counted.' : drawer < 0 ? `Short over the month${short.length ? `, on ${short.length} ${short.length === 1 ? 'night' : 'nights'}` : ''}.${drawer > -50 ? ' Under $50 is usual.' : ''}` : drawer > 0 ? 'Over across the month.' : 'Every drawer counted right.' },
    ];
    const notes: Note[] = [];
    if (open.length) notes.push({ tone: 'warn', text: `${listWords(open.slice(0, 4).map((n) => dayWords(n.day)))}${open.length > 4 ? ` and ${open.length - 4} more` : ''} ${open.length === 1 ? 'wasn’t' : 'weren’t'} closed. ${open.length === 1 ? 'Its' : 'Their'} sales are counted, but the drawers weren’t.`, href: '/close', link: 'Close them' });
    if (short.length) { const w = short.reduce((a, n) => ((n.overShort || 0) < (a.overShort || 0) ? n : a)); if ((w.overShort || 0) <= -10) notes.push({ tone: 'warn', text: `The drawer was ${dollars(-(w.overShort || 0))} short on ${dayWords(w.day)}, the most this month.` }); }
    if (sold.length >= 8 && weekend.length && sales > 0) notes.push({ tone: 'plain', text: `Fridays to Sundays brought in ${pct(weekendSales / sales, 0)} of the month on ${weekend.length} of its ${sold.length} nights.` });
    if (sales > 0 && comps > 0) notes.push({ tone: 'plain', text: `Comps were ${dollars(comps)}, ${pct(comps / sales)} of sales.` });
    const bars: Bar[] = nights.map((n) => ({ label: dayWords(n.day), value: n.sales, tone: !n.closed && n.sales > 0 && n.day < today ? 'warn' : [5, 6, 0].includes(weekday(n.day)) ? 'main' : 'soft',
      tip: `${longDay(n.day)}: ${dollars(n.sales)}${n.closed ? '' : n.sales > 0 && n.day < today ? ', not closed' : ''}` }));
    const columns: Col[] = [{ label: 'Day', kind: 'date' }, { label: 'Closed', kind: 'text' }, { label: 'Closed by', kind: 'text' }, { label: 'Sales', kind: 'money', total: true }, { label: 'Sales tax', kind: 'money', total: true }, { label: 'Tips', kind: 'money', total: true },
      { label: 'Taken', kind: 'money', total: true }, { label: 'Refunds', kind: 'money', total: true }, { label: 'Comps', kind: 'money', total: true }, { label: 'Voids', kind: 'money', total: true }, { label: 'Drawers over or short', kind: 'money', total: true }];
    const rows: Cell[][] = nights.map((n) => [n.day, n.closed ? 'Yes' : 'No', n.closedBy || '', n.sales, n.tax, n.tips, n.taken, n.refunds, n.comps, n.voids, n.overShort ?? '']);
    return { ...base, what: 'Every night’s sales, tax, tips, comps and voids, and how the cash drawers counted, from each night’s close. Your accountant uses it for the books and the sales tax return.',
      kpis, notes: notes.length ? notes : [NOTHING], columns, rows, totals: totalsOf(columns, rows, mw.split(' ')[0]),
      chart: sold.length ? { title: 'Sales by night', money: true, bars, days: true, avg: avg > 0 ? { value: avg, label: 'Average night' } : null,
        legend: [{ tone: 'main', label: 'Friday to Sunday' }, { tone: 'soft', label: 'Monday to Thursday' }, ...(open.length ? [{ tone: 'warn' as const, label: 'Not closed' }] : [])] } : null,
      glossary: [['Sales', 'what was sold, before tax and after any discount. Refunds come off the night they’re given.'], ['Taken', 'what came in: sales, tax and tips together.'],
        ['Comps', 'given free, with a manager’s OK. Voids were rung in, then taken off before they were made.'], ['Drawers', 'the cash counted at close against what the till expected. A minus is short.']],
      file: fileName(business, 'nightly-closes', month), empty: 'No sales this month yet.' };
  }

  if (kind === 'tips' || kind === 'declared') {
    const t = bnd ? await monthTips(db, tenantId, tenant, month, bnd.start, bnd.end) : { people: [] as any[], chargedCents: 0, cashCents: 0, declaredCashCents: 0, mode: 'direct' };
    const due = declareBy(month); const pastDue = today > due;
    if (kind === 'tips') {
      const sales = days.length && !csvOnly ? await monthSales(db, tenantId, tenant, days).then((m) => m.foodDrink).catch(() => 0) : 0;
      const check = tipCheck(sales, $(t.chargedCents), $(t.declaredCashCents));
      const total = $(t.chargedCents + t.cashCents);
      const notYet = t.people.filter((p: any) => p.due && !p.declared);
      const kpis: Kpi[] = [
        { label: 'Tips', value: kpiDollars(total), note: `${dollars($(t.chargedCents))} on cards, ${dollars($(t.cashCents))} in cash as the till has it.` },
        { label: 'On cards', value: total > 0 ? pct($(t.chargedCents) / total, 0) : '—', note: 'Card tips are paid through payroll.' },
        { label: 'Against food and drink sales', value: check.pct === null ? '—' : pct(check.pct), tone: check.under ? 'warn' : check.pct !== null ? 'ok' : undefined,
          note: check.pct === null ? 'No food or drink sales yet.' : check.under ? `${dollars(check.shortfall)} short of 8%, with cash counted as declared.` : 'Over 8%, so there’s nothing to allocate.' },
        { label: 'People tipped', value: String(t.people.filter((p: any) => p.due).length), note: t.mode === 'direct' ? 'Each keeps their own.' : 'Shared, as the tip share sets.' },
      ];
      const notes: Note[] = [];
      if (notYet.length && (!current || pastDue)) notes.push({ tone: 'warn', text: `${listWords(notYet.slice(0, 4).map((p: any) => p.name))}${notYet.length > 4 ? ` and ${notYet.length - 4} more` : ''} ${notYet.length === 1 ? 'hasn’t' : 'haven’t'} declared their cash tips. Each declares on their phone, under Pay.` });
      if (check.under) notes.push({ tone: 'warn', text: `Tips come to ${pct(check.pct || 0)} of food and drink sales. If you file Form 8027, your accountant allocates the ${dollars(check.shortfall)} among those tipped directly.` });
      const columns: Col[] = [{ label: 'Person', kind: 'text' }, { label: 'Tips on cards', kind: 'money', total: true }, { label: 'Cash tips recorded', kind: 'money', total: true }, { label: 'Cash tips declared', kind: 'money', total: true },
        { label: 'Tips paid out', kind: 'money', total: true }, { label: 'Share after sharing', kind: 'money', total: true }, { label: 'Declared on', kind: 'text' }];
      const rows: Cell[][] = t.people.map((p: any) => [p.name, $(p.chargedCents), $(p.cashCents), p.declared ? $(p.declared.cashCents) : '', p.declared ? $(p.declared.paidOutCents) : '', $(p.shareCents), p.declared ? `${p.declared.signedAt.slice(0, 10)}${p.declared.changed ? ' (changed)' : ''}` : 'Not yet']);
      return { ...base, what: 'Each person’s tips: on cards, in cash as the till has it, what they declared, and their share after any tip sharing. For payroll and the IRS’s tip reporting.',
        kpis, notes: notes.length ? notes : [NOTHING], columns, rows, totals: totalsOf(columns, rows, 'Everyone'),
        chart: t.people.length > 1 ? { title: 'Each person’s share', money: true, bars: [...t.people].sort((a: any, b: any) => b.shareCents - a.shareCents).slice(0, 12).map((p: any) => ({ label: p.name.split(' ')[0], value: $(p.shareCents), tone: 'main' as const, tip: `${p.name}: ${dollars($(p.shareCents))}` })) } : null,
        glossary: [['Cash tips recorded', 'the cash tips the till has, as each sale was rung up.'], ['Cash tips declared', 'what each person reported to you in writing, by the 10th of the next month.'],
          ['Share after sharing', 'what each person keeps once the tip share is worked out.'], ['Against sales', 'tips on cards plus cash as declared, against food and drink sales: the IRS’s 8% line.']],
        file: fileName(business, 'tips', month), empty: 'Nobody was tipped this month yet.' };
    }
    // Cash tips declared: the signed copies, and who still hasn't.
    const snap = await db.collection(`${T}/tipDeclarations`).where('month', '==', month).limit(500).get().catch(() => ({ docs: [] as any[] }));
    const decs = snap.docs.map((d: any) => d.data() || {}).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    const have = new Set(decs.map((x: any) => x.staffId));
    const notYet = t.people.filter((p: any) => p.due && !have.has(p.staffId));
    const under = decs.filter((x: any) => (Number(x.cashCents) || 0) + (Number(x.paidOutCents) || 0) < (Number(x.recordedCashCents) || 0) - 100);
    const changed = decs.filter((x: any) => Array.isArray(x.earlier) && x.earlier.length);
    const owed = decs.length + notYet.length;
    const kpis: Kpi[] = [
      { label: 'Declared', value: `${decs.length} of ${owed}`, tone: notYet.length ? 'warn' : owed ? 'ok' : undefined, note: notYet.length ? `${notYet.length} still to declare.` : owed ? 'Everyone who had cash tips has declared.' : 'Nobody had $20 or more in cash tips.' },
      { label: 'Cash tips declared', value: kpiDollars($(decs.reduce((s: number, x: any) => s + (Number(x.cashCents) || 0), 0))), note: `The till recorded ${dollars($(decs.reduce((s: number, x: any) => s + (Number(x.recordedCashCents) || 0), 0)))} for the same people.` },
      { label: 'Due by', value: dayWords(due), tone: pastDue && notYet.length ? 'warn' : undefined, note: pastDue ? 'The 10th has passed.' : 'The 10th of the next month.' },
      { label: 'Under the till', value: String(under.length), tone: under.length ? 'warn' : undefined, note: under.length ? 'Declared less than the till recorded.' : 'Nobody declared less than the till.' },
    ];
    const notes: Note[] = [];
    if (notYet.length) notes.push({ tone: 'warn', text: `${listWords(notYet.slice(0, 4).map((p: any) => p.name))}${notYet.length > 4 ? ` and ${notYet.length - 4} more` : ''} ${notYet.length === 1 ? 'hasn’t' : 'haven’t'} declared yet. Everyone tipped declares their cash tips, even none: anyone with $${CASH_TIP_MIN_CENTS / 100} or more in cash tips must report them to you in writing.` });
    for (const x of under.slice(0, 3)) notes.push({ tone: 'warn', text: `${x.name} declared ${dollars($((Number(x.recordedCashCents) || 0) - (Number(x.cashCents) || 0) - (Number(x.paidOutCents) || 0)))} less than the till recorded. Worth a word.` });
    if (changed.length) notes.push({ tone: 'plain', text: `${listWords(changed.slice(0, 4).map((x: any) => x.name))} changed ${changed.length === 1 ? 'their declaration' : 'their declarations'} after signing; the earlier copies are kept.` });
    const columns: Col[] = [{ label: 'Person', kind: 'text' }, { label: 'Month', kind: 'month' }, { label: 'Cash tips received', kind: 'money', total: true }, { label: 'Tips paid out', kind: 'money', total: true },
      { label: 'Recorded by the till', kind: 'money', total: true }, { label: 'Signed as', kind: 'text' }, { label: 'Signed on', kind: 'date' }];
    const rows: Cell[][] = [...decs.map((x: any) => [x.name, x.month, $(Number(x.cashCents) || 0), $(Number(x.paidOutCents) || 0), $(Number(x.recordedCashCents) || 0), x.signedName, String(x.signedAt || '').slice(0, 10)]),
      ...notYet.map((p: any) => [p.name, month, '', '', $(p.cashCents), '', 'Not yet'])];
    return { ...base, what: 'Each person’s signed report of the cash tips they received, as the IRS asks: kept here as they signed it on their phone, with anyone who hasn’t yet.',
      kpis, notes: notes.length ? notes : [NOTHING], columns, rows, totals: totalsOf(columns, rows, 'Everyone'), chart: null,
      glossary: [['Cash tips received', 'what the person declared, in their own words and signed.'], ['Tips paid out', 'cash tips they passed on to others (a busser, the bar).'],
        ['Recorded by the till', 'the cash tips the till has for them, to check against.'], ['Signed on', 'when they signed. A changed one keeps the copy it replaced.']],
      file: fileName(business, 'cash-tips-declared', month), empty: 'Nobody had cash tips to declare this month.' };
  }

  if (kind === 'stock') {
    const kept: any = (await db.doc(`${T}/stockValues/${month}`).get()).data() || null;
    const now = kept ? null : stockNow((await db.collection(`${T}/inventory`).limit(5000).get()).docs.map((d: any) => [d.id, d.data() || {}]));
    const lines: any[] = kept?.lines || now!.lines; const total = r2(kept ? Number(kept.total) || 0 : now!.total);
    const typical = r2(kept ? Number(kept.typical) || 0 : now!.typical); const count = kept ? Number(kept.count) || lines.length : lines.length;
    const asOf = kept?.at ? String(kept.at).slice(0, 10) : `${today} (now)`;
    const before: any = (await db.doc(`${T}/stockValues/${prevMonth(month)}`).get()).data() || null;
    const top = [...lines].sort((a, b) => b.value - a.value);
    const topFive = r2(top.slice(0, 5).reduce((s, l) => s + l.value, 0));
    const kpis: Kpi[] = [
      { label: current && !kept ? 'On the shelf now' : 'On the shelf', value: kpiDollars(total), tone: !current && !kept ? 'warn' : undefined, note: kept ? `Kept ${dayWords(String(kept.at).slice(0, 10))}${kept.auto ? ', automatically' : kept.by ? ` by ${words(kept.by, 40)}` : ''}, at what you pay.` : current ? 'Today, at what you pay.' : 'Nothing was kept for this month: this is today’s shelf.' },
      { label: `Since ${lastMonth}`, value: before ? `${total - Number(before.total) < 0 ? '−' : '+'}${kpiDollars(Math.abs(r2(total - Number(before.total))))}` : '—', note: before ? `${lastMonth} was kept at ${kpiDollars(Number(before.total) || 0)}.` : `No value was kept for ${lastMonth}.` },
      { label: 'Items with stock', value: count.toLocaleString('en-US'), note: top.length ? `The top five are ${pct(total > 0 ? topFive / total : 0, 0)} of the value.` : 'Nothing counted yet.' },
      { label: 'At typical prices', value: total > 0 ? pct(typical / total, 0) : '—', tone: total > 0 && typical / total > 0.1 ? 'warn' : undefined, note: 'Valued at a usual price, not what you paid.' },
    ];
    const notes: Note[] = [];
    if (!current && !kept) notes.push({ tone: 'warn', text: `No stock value was kept for ${mw}. This is today’s shelf, which your accountant may not be able to use for the month.`, href: '/records', link: 'Records' });
    if (total > 0 && typical / total > 0.1) notes.push({ tone: 'warn', text: `${pct(typical / total, 0)} of the value is at typical prices. Put the price on each delivery as it’s received, so it’s what you paid.`, href: '/inventory/ordering', link: 'Ordering' });
    if (top.length) notes.push({ tone: 'plain', text: `${listWords(top.slice(0, 3).map((l) => l.name))} hold the most value on the shelf.` });
    if (kept && Number(kept.count) > lines.length) notes.push({ tone: 'plain', text: `The ${STOCK_LINES_KEPT.toLocaleString('en-US')} most valuable items are listed; the total counts all ${Number(kept.count).toLocaleString('en-US')}.` });
    const columns: Col[] = [{ label: 'As of', kind: 'text' }, { label: 'Item', kind: 'text' }, { label: 'On hand', kind: 'num' }, { label: 'Measured in', kind: 'text' }, { label: 'Cost of one', kind: 'price' }, { label: 'Value', kind: 'money', total: true }, { label: 'At a typical price', kind: 'text' }];
    const rows: Cell[][] = lines.map((l: any) => [asOf, l.name, l.left, l.unit, l.unitCost, l.value, l.typical ? 'Yes' : '']);
    if (kept && Number(kept.count) > lines.length) rows.push([asOf, `The ${STOCK_LINES_KEPT} most valuable items are listed; the total, ${kept.total}, counts all ${kept.count}.`, '', '', '', '', '']);
    return { ...base, what: 'What’s on the shelf at the month’s end, item by item, at what you pay. Your accountant needs it for the cost of goods sold.',
      kpis, notes: notes.length ? notes : [NOTHING], columns, rows, totals: totalsOf(columns, rows.filter((r) => typeof r[5] === 'number'), 'Everything listed'),
      chart: top.length > 2 ? { title: 'Where the value is', money: true, bars: top.slice(0, 10).map((l) => ({ label: l.name.length > 14 ? `${l.name.slice(0, 13)}…` : l.name, value: l.value, tone: 'main' as const, tip: `${l.name}: ${dollars(l.value)}` })) } : null,
      glossary: [['On hand', 'how much is left, in what it’s counted in (a part case counts as part).'], ['Cost of one', 'what you paid for one, on its latest delivery.'],
        ['At a typical price', 'valued at a usual price because no delivery price was put in.'], ['As of', 'when the value was kept: on the 1st automatically, or by a manager after the count.']],
      file: fileName(business, 'stock-value', month), empty: 'Nothing with a cost is on the shelf.' };
  }

  if (kind === 'purchases') {
    const p = bnd ? await monthPurchases(db, tenantId, bnd.start, bnd.end) : { list: [] as any[], bySupplier: [] as any[], total: 0 };
    const missing = p.list.filter((x: any) => !x.invoice); const top = p.bySupplier[0];
    const kpis: Kpi[] = [
      { label: 'Spent', value: kpiDollars(p.total), note: `On ${p.list.length} ${p.list.length === 1 ? 'order' : 'orders'} received.` },
      { label: 'Suppliers', value: String(p.bySupplier.length), note: top ? `${top.supplier} the most, ${pct(p.total > 0 ? top.total / p.total : 0, 0)} of it.` : 'None this month.' },
      { label: 'Invoices attached', value: p.list.length ? `${p.list.length - missing.length} of ${p.list.length}` : '—', tone: missing.length ? 'warn' : p.list.length ? 'ok' : undefined, note: missing.length ? 'Attach them on each order for your accountant.' : p.list.length ? 'Every order has its invoice.' : 'No orders received.' },
      { label: 'Average order', value: p.list.length ? kpiDollars(p.total / p.list.length) : '—', note: 'What one order received comes to.' },
    ];
    const notes: Note[] = [];
    if (missing.length) notes.push({ tone: 'warn', text: `${missing.length} ${missing.length === 1 ? 'order has' : 'orders have'} no invoice attached: ${listWords(missing.slice(0, 3).map((x: any) => `${x.supplier} on ${dayWords(x.at.slice(0, 10))}`))}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`, href: '/inventory/ordering', link: 'Ordering' });
    if (top && p.bySupplier.length > 1) notes.push({ tone: 'plain', text: `${top.supplier} is ${pct(top.total / p.total, 0)} of what you spent, on ${top.count} ${top.count === 1 ? 'order' : 'orders'}.` });
    notes.push({ tone: 'plain', text: 'Stock received without an order is on each item’s history, not here.' });
    const columns: Col[] = [{ label: 'Received', kind: 'date' }, { label: 'Supplier', kind: 'text' }, { label: 'Order', kind: 'text' }, { label: 'Lines', kind: 'count', total: true }, { label: 'Total', kind: 'money', total: true }, { label: 'Invoice attached', kind: 'text' }];
    const rows: Cell[][] = p.list.map((x: any) => [x.at.slice(0, 10), x.supplier, x.number, x.lines, x.total, x.invoice ? 'Yes' : 'No']);
    return { ...base, what: 'Every order received this month, from whom, what it came to, and whether its invoice is attached. For your accountant’s purchases and the cost of goods sold.',
      kpis, notes, columns, rows, totals: totalsOf(columns, rows, mw.split(' ')[0]),
      chart: p.bySupplier.length > 1 ? { title: 'By supplier', money: true, bars: p.bySupplier.slice(0, 10).map((s: any) => ({ label: s.supplier.length > 14 ? `${s.supplier.slice(0, 13)}…` : s.supplier, value: s.total, tone: 'main' as const, tip: `${s.supplier}: ${dollars(s.total)} on ${s.count} ${s.count === 1 ? 'order' : 'orders'}` })) } : null,
      glossary: [['Received', 'the day the order was put away.'], ['Lines', 'how many different things came on it.'], ['Total', 'what the order came to, at the prices put in when it was received.'], ['Invoice attached', 'whether the supplier’s invoice is kept with the order.']],
      file: fileName(business, 'orders-received', month), empty: 'No orders were received this month. Orders put away on the Ordering page show here.' };
  }

  // Comps and voids, by who gave them.
  const a = days.length ? await monthAdjustments(db, tenantId, days[0], days[days.length - 1]) : [];
  // The month's sales, for "Of sales" (kept once worked out, for a past month).
  const sales = csvOnly ? 0 : await monthSalesByDay(db, tenantId, tenant, month, today).then((xs) => r2(xs.reduce((s, v) => s + v, 0))).catch(() => 0);
  const comps = r2(a.reduce((s, x) => s + x.comps, 0)), voids = r2(a.reduce((s, x) => s + x.voids, 0));
  const ranked = [...a].sort((x, y) => (y.comps + y.voids) - (x.comps + x.voids)); const topP = ranked[0];
  const avgOthers = ranked.length > 2 ? (comps + voids - (topP.comps + topP.voids)) / (ranked.length - 1) : 0;
  const kpis: Kpi[] = [
    { label: 'Comped', value: kpiDollars(comps), note: `${a.reduce((s, x) => s + x.compCount, 0)} given free, with a manager’s OK.` },
    { label: 'Voided', value: kpiDollars(voids), note: `${a.reduce((s, x) => s + x.voidCount, 0)} taken off before they were made.` },
    { label: 'Of sales', value: sales > 0 ? pct((comps + voids) / sales) : '—', tone: sales > 0 && (comps + voids) / sales > 0.03 ? 'warn' : undefined, note: 'Comps and voids together. Under 2% is usual.' },
    { label: 'Most', value: topP ? topP.name.split(' ')[0] : '—', note: topP ? `${dollars(r2(topP.comps + topP.voids))} comped and voided.` : 'None this month.' },
  ];
  const notes: Note[] = [];
  if (topP && avgOthers > 0 && topP.comps + topP.voids > 2 * avgOthers) notes.push({ tone: 'warn', text: `${topP.name}’s comps and voids are ${Math.round((topP.comps + topP.voids) / avgOthers * 10) / 10} times the average of everyone else’s. Worth a look at what they were for.` });
  const remakes = a.reduce((s, x) => s + x.remakes, 0); if (remakes) notes.push({ tone: 'plain', text: `${remakes} ${remakes === 1 ? 'dish was' : 'dishes were'} made again this month.` });
  const columns: Col[] = [{ label: 'Person', kind: 'text' }, { label: 'Comps (how many)', kind: 'count', total: true }, { label: 'Comped (dollars)', kind: 'money', total: true }, { label: 'Voids (how many)', kind: 'count', total: true }, { label: 'Voided (dollars)', kind: 'money', total: true }, { label: 'Remakes', kind: 'count', total: true }];
  const rows: Cell[][] = a.map((x) => [x.name, x.compCount, x.comps, x.voidCount, x.voids, x.remakes]);
  return { ...base, what: 'What was given free (comps) or taken off before it was made (voids) this month, and by whom. A quick way to see where money walks out.',
    kpis, notes: notes.length ? notes : [NOTHING], columns, rows, totals: totalsOf(columns, rows, 'Everyone'),
    chart: ranked.length > 1 ? { title: 'Comped and voided, by person', money: true, bars: ranked.slice(0, 12).map((x) => ({ label: x.name.split(' ')[0], value: r2(x.comps + x.voids), tone: 'main' as const, tip: `${x.name}: ${dollars(x.comps)} comped, ${dollars(x.voids)} voided` })) } : null,
    glossary: [['Comps', 'given free, with a manager’s OK (a dish sent back, a regular’s coffee).'], ['Voids', 'rung in, then taken off before the kitchen made it.'], ['Remakes', 'made again, on the kitchen screen.'], ['Of sales', 'comps and voids together, against the month’s sales.']],
    file: fileName(business, 'comps-and-voids', month), empty: 'No comps or voids this month.' };
}
