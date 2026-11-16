// src/lib/food-cost-report.ts — FOOD COST, AS A REPORT ANYONE CAN READ (lib/report-kit; the page /food-cost/report,
// api/food-cost 'view' and 'csv'). The same numbers as the Food cost page (api/food-cost 'report'), in the six parts
// every report has: what it is; the numbers that matter (the share against the aim, what was sold, what it cost to make,
// what was thrown away, the items over the aim); sales by day, each day marked over or under the aim; what's worth a
// look; every item sold, with what it cost; and how to read it. The spreadsheet is the same table. Pure.
import { dayWords, dollars, fileName, kpiDollars, listWords, longDay, pct, r2, type Cell, type Col, type Kpi, type Note, type Report } from '@/lib/report-kit';
import type { ItemCost, Period, PeriodCost, Waste } from '@/lib/food-cost';

/** What api/food-cost 'report' works out for a stretch (the parts this report reads). */
export type FoodCostData = {
  period: Period; days: string[]; today: string; target: number; report: PeriodCost;
  items: (ItemCost & { sold: number; soldAmount: number; section: string })[];
  waste: Waste; typical: { id: string; name: string }[]; partial: boolean;
  staffMeals?: { count: number; cost: number; unknown: number };
};

const STRETCH: Record<Period, string> = { week: 'This week so far', last: 'Last week', '30': 'The last 30 days' };
/** "Nov 9 to Nov 15". */
export const stretchWords = (days: string[]) => (days.length ? (days.length === 1 ? dayWords(days[0]) : `${dayWords(days[0])} to ${dayWords(days[days.length - 1])}`) : '');

export function foodCostReport(d: FoodCostData, business: string, madeAt: string): Report {
  const r = d.report; const aim = d.target; const first = d.days[0] || d.today, last = d.days[d.days.length - 1] || d.today;
  const byId = new Map(d.items.map((x) => [x.id, x]));
  const over = d.items.filter((x) => x.over && !x.needsPrice);
  const soldOver = over.filter((x) => x.sold > 0).sort((a, b) => b.soldAmount - a.soldAmount);
  const share = r.share;

  const kpis: Kpi[] = [
    { label: 'Food cost', value: share === null ? 'Not known' : pct(share), tone: share === null ? undefined : share > aim + 0.0005 ? 'warn' : 'ok',
      note: share === null ? 'Nothing sold yet has a cost to make.' : `${share > aim + 0.0005 ? 'Over' : share >= aim - 0.005 ? 'At' : 'Under'} your ${pct(aim, 0)} aim, of ${kpiDollars(r.covered)} sold with a known cost.` },
    { label: 'Sold', value: kpiDollars(r.sold), note: r.uncovered > 0 ? `Food and drink. ${dollars(r.uncovered)} of it has no cost to make yet.` : 'Food and drink, before tax.' },
    { label: 'Cost to make it', value: kpiDollars(r.cost), note: 'What went into what was sold, at today’s ingredient costs.' },
    { label: 'Thrown away', value: kpiDollars(d.waste.total), tone: r.sold > 0 && d.waste.total / r.sold > 0.02 ? 'warn' : undefined,
      note: d.waste.total > 0 ? `${[d.waste.remakes ? `remakes ${dollars(d.waste.remakes)}` : '', d.waste.voids ? `voids ${dollars(d.waste.voids)}` : '', d.waste.batches ? `held batches ${dollars(d.waste.batches)}` : ''].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}, at what each costs to make.` : 'No remakes, voids after they were made, or batches past their time.' },
    { label: 'Over the aim', value: String(over.length), tone: over.length ? 'warn' : 'ok', note: over.length ? `${over.length === 1 ? 'Item' : 'Items'} on the menu costing more than ${pct(aim, 0)} of ${over.length === 1 ? 'its' : 'their'} price${soldOver.length ? `, ${soldOver.length} sold in this stretch` : ''}.` : `Every priced item costs ${pct(aim, 0)} of its price or less.` },
  ];

  // Sales by day, each marked over or under the aim (a day with nothing sold is shown pale).
  // Everything sold each day (as the Sold above has it); each day's share is of what sold with a cost known.
  const sellingDays = r.days.filter((x) => x.all > 0);
  const chart = r.days.length > 1 && sellingDays.length ? {
    title: 'Sales by day', money: true, days: r.days.length > 10,
    bars: r.days.map((x) => ({ label: dayWords(x.day), value: x.all, tone: (x.all <= 0 ? 'soft' : x.share !== null && x.share > aim + 0.0005 ? 'warn' : 'main') as 'soft' | 'warn' | 'main',
      tip: `${longDay(x.day)}: ${dollars(x.all)} sold${x.share !== null ? `, food cost ${pct(x.share)}` : x.all > 0 ? ', none of it with a cost to make yet' : ''}` })),
    avg: { value: r2(sellingDays.reduce((s, x) => s + x.all, 0) / sellingDays.length), label: 'Average day' },
    legend: [{ tone: 'main' as const, label: `At or under ${pct(aim, 0)}` }, { tone: 'warn' as const, label: `Over ${pct(aim, 0)}` }],
  } : null;

  const notes: Note[] = [];
  if (d.partial) notes.push({ tone: 'warn', text: 'More sales than can be read at once: these numbers are from the first 5,000 of each kind.' });
  if (r.uncovered > 0) notes.push({ tone: 'warn', text: `${dollars(r.uncovered)} was sold with no cost to make: ${listWords(r.uncoveredItems.slice(0, 4))}${r.uncoveredItems.length > 4 ? ' and more' : ''}. Give each a recipe, or what one costs you, and it counts.`, href: '/menu', link: 'Open the Menu' });
  const worst = soldOver[0];
  if (worst && worst.share !== null) notes.push({ tone: 'warn', text: `${worst.name} costs ${pct(worst.share)} of its price${worst.fix ? `. At ${dollars(worst.fix)} it’s back to ${pct(aim, 0)} or less` : ''}.`, href: `/menu?item=${encodeURIComponent(worst.id)}`, link: 'Look at the recipe' });
  if (d.typical.length) notes.push({ tone: 'plain', text: `${d.typical.length} ${d.typical.length === 1 ? 'ingredient is' : 'ingredients are'} still at a typical price, not what you pay: ${listWords(d.typical.slice(0, 3).map((x) => x.name))}${d.typical.length > 3 ? ' and more' : ''}.`, href: '/food-cost', link: 'Put in what you pay' });
  const top = r.items[0];
  if (top && r.sold > 0) notes.push({ tone: 'plain', text: `${top.name} sold the most: ${dollars(top.sold)}, ${pct(top.sold / r.sold, 0)} of everything sold.` });
  if (d.staffMeals && d.staffMeals.count > 0) notes.push({ tone: 'plain', text: `Staff meals: ${d.staffMeals.count}, costing ${dollars(d.staffMeals.cost)} to make${d.staffMeals.unknown > 0 ? `, and ${d.staffMeals.unknown} ${d.staffMeals.unknown === 1 ? 'thing' : 'things'} in them with no cost yet` : ''}. They’re not counted as sales.` });

  const columns: Col[] = [
    { label: 'Item', kind: 'text' }, { label: 'Section', kind: 'text' }, { label: 'Quantity', kind: 'count', total: true }, { label: 'Sales', kind: 'money', total: true },
    { label: 'Cost to make', kind: 'money', total: true }, { label: 'Food cost', kind: 'pct' }, { label: 'Price now', kind: 'money' }, { label: 'One costs now', kind: 'price' }, { label: 'Against the aim', kind: 'text' },
  ];
  const rows: Cell[][] = r.items.map((s) => {
    const c = byId.get(s.id);
    const against = !c ? 'Not on the menu now' : c.needsPrice ? 'Needs a price' : c.cost === null ? 'No cost yet' : c.over ? 'Over' : 'Under';
    return [s.name, c?.section || '', s.qty, r2(s.sold), s.cost === null ? null : r2(s.cost), s.cost !== null && s.covered > 0 ? Math.round((s.cost / s.covered) * 10000) / 10000 : null, c ? r2(c.price) : null, c && c.cost !== null ? Math.round(c.cost * 10000) / 10000 : null, against];
  });
  const totals: Cell[] | null = rows.length ? ['Everything sold', null, rows.reduce((n, x) => n + Number(x[2] || 0), 0), r.sold, r.cost, share === null ? null : Math.round(share * 10000) / 10000, null, null, null] : null;

  const stretch = stretchWords(d.days);
  return {
    kind: 'food-cost', title: `Food cost, ${stretch}`, group: 'Food numbers', month: `${first}-to-${last}`, monthWords: `${STRETCH[d.period]}, ${stretch}`, business, madeAt,
    what: `What the food and drink sold ${d.period === 'week' ? 'this week so far' : d.period === 'last' ? 'last week' : 'over the last 30 days'} cost to make, at today’s ingredient costs, against your aim of ${pct(aim, 0)}. Use it to see which dishes to reprice or make differently.`,
    kpis, chart, notes: notes.slice(0, 4), columns, rows, totals,
    glossary: [
      ['Food cost', `what went into what was sold, as a share of what it sold for. Only sales with a cost to make count: anything sold with no cost yet is left out of the share (it’s named above), though it’s in Sales.`],
      ['Cost to make', 'the recipe at what you pay for each ingredient now (a typical price until you put in yours), with each choice as it was picked: an oat latte costs more than a plain one.'],
      ['Thrown away', 'remakes, orders voided after they were made, and held batches past their time, each at what it costs to make.'],
    ],
    file: fileName(business, 'food-cost', `${first}-to-${last}`),
    empty: 'Nothing was sold in this stretch yet.',
  };
}
