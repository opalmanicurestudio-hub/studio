// src/lib/night-close.ts — CLOSING THE NIGHT, the rules (pure; the server half is lib/night-close-server, the screens
// are /close and the kitchen screen's Closing sheet, settings at /settings/closing).
// - A closing checklist the business sets: things to tick ("Floors and mats") and temperatures to log ("Walk-in fridge",
//   at most 41°F). A temperature outside its limit needs a few words on what was done about it, and is flagged on the
//   report. Each item belongs to an area (kitchen, bar, front, anyone), so the kitchen screen shows the kitchen's.
// - The drawer is counted in the till (the front desk's Close the till); the checklist only shows whether it's done.
// - A manager closes the night once the checklist is done (unless the business lets it close without) and no drawer is
//   left open. Closing keeps the night's report, approves the night's tip shares when tips are shared by the day (never
//   a night already inside an approved run), and emails the report to whoever the business picks (kept where only the
//   server reads it, never on the business's public record).
// - Until a business saves its own checklist, the usual one is offered but doesn't hold up closing: a café without a
//   freezer isn't stuck.
// Food-safety numbers here are the usual US ones (cold food at 41°F or below, frozen at 0°F or below, hot at 135°F or
// above); a business sets its own limits per item.

export type CloseArea = 'kitchen' | 'bar' | 'front' | 'anyone';
export type CloseItem = { id: string; label: string; kind: 'check' | 'temp'; area: CloseArea; maxF?: number | null; minF?: number | null };
export type CloseSettings = { items: CloseItem[]; requireChecklist: boolean; reportTo: string[]; approveTips: boolean };
export type CheckMark = { done: boolean; value?: number | null; note?: string | null; by: string; at: string; out?: boolean };

export const AREAS: { id: CloseArea; label: string }[] = [
  { id: 'kitchen', label: 'Kitchen' }, { id: 'bar', label: 'Bar' }, { id: 'front', label: 'Front' }, { id: 'anyone', label: 'Anyone' },
];
export const MAX_ITEMS = 30;
export const DEFAULT_ITEMS: CloseItem[] = [
  { id: 'walkin', label: 'Walk-in fridge', kind: 'temp', area: 'kitchen', maxF: 41, minF: null },
  { id: 'reachin', label: 'Reach-in fridge, line', kind: 'temp', area: 'kitchen', maxF: 41, minF: null },
  { id: 'freezer', label: 'Freezer', kind: 'temp', area: 'kitchen', maxF: 0, minF: null },
  { id: 'barfridge', label: 'Bar fridge', kind: 'temp', area: 'bar', maxF: 41, minF: null },
  { id: 'equipment', label: 'Grill and fryer off, hood filters in', kind: 'check', area: 'kitchen' },
  { id: 'floors', label: 'Floors and mats', kind: 'check', area: 'anyone' },
];

const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const temp = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= -60 && n <= 500 ? Math.round(n * 10) / 10 : null; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

/** The business's closing setup: its own list when it has one (cleaned: names, limits, no repeats), else the usual. */
export function closeSettingsOf(tenant: any): CloseSettings {
  const c = tenant?.closingSettings || {};
  let items: CloseItem[] = DEFAULT_ITEMS;
  if (Array.isArray(c.items)) {
    const seen = new Set<string>(); items = [];
    for (const x of c.items.slice(0, MAX_ITEMS)) {
      const label = words(x?.label, 60); if (!label) continue;
      let id = words(x?.id, 40).replace(/[^A-Za-z0-9_-]/g, '') || slug(label);
      while (seen.has(id)) id = `${id}-2`; seen.add(id);
      const kind = x?.kind === 'temp' ? 'temp' : 'check';
      const area: CloseArea = AREAS.some((a) => a.id === x?.area) ? x.area : 'anyone';
      items.push(kind === 'temp' ? { id, label, kind, area, maxF: temp(x?.maxF), minF: temp(x?.minF) } : { id, label, kind, area });
    }
  }
  return { items, requireChecklist: c.requireChecklist === undefined ? Array.isArray(c.items) : c.requireChecklist !== false, reportTo: cleanReportTo(c.reportTo), approveTips: c.approveTips !== false };
}
/** Who gets the report, cleaned: up to 10, no repeats. */
export const cleanReportTo = (v: unknown): string[] => (Array.isArray(v) ? (Array.from(new Set(v.map((s: unknown) => words(s, 120)).filter(Boolean))).slice(0, 10) as string[]) : []);

/** Is a reading inside the item's limits? (No limits: always.) */
export function tempOk(item: Pick<CloseItem, 'maxF' | 'minF'>, value: number): boolean {
  if (item.maxF !== null && item.maxF !== undefined && value > item.maxF) return false;
  if (item.minF !== null && item.minF !== undefined && value < item.minF) return false;
  return true;
}
/** The limit in words: "at most 41°F", "at least 135°F", "between 33°F and 41°F". */
export function limitWords(item: Pick<CloseItem, 'maxF' | 'minF'>): string {
  const hi = item.maxF ?? null, lo = item.minF ?? null;
  if (hi !== null && lo !== null) return `between ${lo}°F and ${hi}°F`;
  if (hi !== null) return `at most ${hi}°F`;
  if (lo !== null) return `at least ${lo}°F`;
  return 'no limit set';
}

/** Check a mark before it's kept: a temperature needs a reading, and one outside its limit needs a few words. */
export function checkMark(item: CloseItem, input: { done?: unknown; value?: unknown; note?: unknown }): { ok: true; mark: Omit<CheckMark, 'by' | 'at'> } | { ok: false; error: string } {
  const note = words(input.note, 160) || null;
  if (item.kind === 'temp') {
    const v = temp(input.value);
    if (v === null) return { ok: false, error: `Enter the reading for ${item.label}.` };
    const out = !tempOk(item, v);
    if (out && !note) return { ok: false, error: `${v}°F is outside ${limitWords(item)}. Say what was done about it.` };
    return { ok: true, mark: { done: true, value: v, note, out } };
  }
  return { ok: true, mark: { done: input.done !== false, value: null, note, out: false } };
}

/** What's left on the checklist (the items not done). */
export function leftToDo(items: CloseItem[], checks: Record<string, CheckMark | undefined>): CloseItem[] {
  return items.filter((i) => !checks[i.id]?.done);
}

/** Can the night be closed? Not with a drawer still open; not with the checklist undone, unless the business allows it. */
export function canClose(s: CloseSettings, checks: Record<string, CheckMark | undefined>, openTills: number): { ok: boolean; why: string | null } {
  if (openTills > 0) return { ok: false, why: openTills === 1 ? 'A drawer is still open. Count it and close it at the front desk first.' : `${openTills} drawers are still open. Count and close them at the front desk first.` };
  const left = leftToDo(s.items, checks);
  if (s.requireChecklist && left.length) return { ok: false, why: `${left.length} ${left.length === 1 ? 'item is' : 'items are'} left on the checklist.` };
  return { ok: true, why: null };
}

// ── The report ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** One sale: what was sold (net: before tax and tips, after discounts), what was refunded on it, and what was taken (total,
 *  tax and tips in, as paid). */
export type Sale = { at: string; net: number; refunded?: number; total: number; tip: number; tax: number; method: string; payments?: { method: string; amount: number; tip?: number }[] | null };
export type Adjustment = { kind: 'comp' | 'void_item' | 'remake'; amount: number; reason: string; askedBy: string; approverName: string; started?: boolean; wasteCost?: number | null; itemName: string };
export type Till = { openedBy: string; openingFloat: number; expectedCash: number; actualCash: number | null; status: 'open' | 'closed' };
export type TipRow = { name: string; role: string; earned: number; shared: number; takesHome: number };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const METHOD: Record<string, string> = { card: 'Card', card_reader: 'Card', client_screen: 'Card', terminal: 'Card', cash: 'Cash', gift_card: 'Gift card', store_credit: 'Store credit', split: 'Split', other: 'Other' };
export const methodLabel = (m: unknown) => METHOD[String(m || '')] || (String(m || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Other');
const sumBy = <T,>(list: T[], key: (x: T) => string, val: (x: T) => number) => {
  const m = new Map<string, { label: string; count: number; amount: number }>();
  for (const x of list) { const k = key(x) || 'Other'; const g = m.get(k) || { label: k, count: 0, amount: 0 }; g.count += 1; g.amount = r2(g.amount + val(x)); m.set(k, g); }
  return Array.from(m.values()).sort((a, b) => b.amount - a.amount || b.count - a.count);
};

/** An hour label in the business's time zone: "11a", "12p", "7p". */
export function hourLabel(iso: string, timeZone: string): string {
  try { const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(iso))); return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`; } catch { return '?'; }
}

export type NightReport = ReturnType<typeof nightReport>;
/** The night's report, from what it took: sales (with tips, by hour and by how they paid), guests at tables, comps,
 *  voids and remakes (by reason and person), waste, tips as shared, the drawers, and the checklist. */
export function nightReport(x: { day: string; timeZone: string; sales: Sale[]; tables: { covers: number }[]; adjustments: Adjustment[]; tills: Till[]; tips: { mode: string; rows: TipRow[] };
  items: CloseItem[]; checks: Record<string, CheckMark | undefined>; usualComps?: number | null }) {
  const sales = x.sales;
  const refunds = r2(sales.reduce((s, v) => s + (Number(v.refunded) || 0), 0));
  const total = r2(sales.reduce((s, v) => s + v.net, 0) - refunds);
  const taken = r2(sales.reduce((s, v) => s + v.total, 0));
  const tips = r2(sales.reduce((s, v) => s + v.tip, 0));
  const tax = r2(sales.reduce((s, v) => s + v.tax, 0));
  const pays = sales.flatMap((v) => (v.payments && v.payments.length ? v.payments.map((p) => ({ method: methodLabel(p.method), amount: r2(Number(p.amount) + (Number(p.tip) || 0)) })) : [{ method: methodLabel(v.method), amount: v.total }]));
  const byHour: { hour: string; amount: number }[] = [];
  for (const v of [...sales].sort((a, b) => a.at.localeCompare(b.at))) { const h = hourLabel(v.at, x.timeZone); const last = byHour[byHour.length - 1]; if (last && last.hour === h) last.amount = r2(last.amount + v.net); else byHour.push({ hour: h, amount: r2(v.net) }); }
  const covers = x.tables.reduce((s, t) => s + Math.max(0, Number(t.covers) || 0), 0);
  const comps = x.adjustments.filter((a) => a.kind === 'comp');
  const voids = x.adjustments.filter((a) => a.kind === 'void_item');
  const remakes = x.adjustments.filter((a) => a.kind === 'remake');
  const waste = r2(x.adjustments.reduce((s, a) => s + (Number(a.wasteCost) || 0), 0));
  const compTotal = r2(comps.reduce((s, a) => s + a.amount, 0));
  const before = voids.filter((v) => !v.started), after = voids.filter((v) => v.started);
  const checklist = x.items.map((i) => { const m = x.checks[i.id]; return { id: i.id, label: i.label, kind: i.kind, done: !!m?.done, value: m?.value ?? null, out: !!m?.out, note: m?.note || null, by: m?.by || null, at: m?.at || null, limit: i.kind === 'temp' ? limitWords(i) : null }; });
  const cash = x.tills.map((t) => ({ ...t, overShort: t.actualCash === null ? null : r2(t.actualCash - t.expectedCash) }));
  return {
    day: x.day,
    sales: { total, taken, refunds, tips, tax, count: sales.length, byHour, byMethod: sumBy(pays, (p) => p.method, (p) => p.amount).map((g) => ({ method: g.label, amount: g.amount })) },
    guests: { tables: x.tables.length, covers, perGuest: covers > 0 ? r2(total / covers) : null },
    comps: { total: compTotal, count: comps.length, usual: x.usualComps ?? null, byReason: sumBy(comps, (a) => a.reason, (a) => a.amount), byPerson: sumBy(comps, (a) => a.askedBy, (a) => a.amount) },
    voids: { total: r2(voids.reduce((s, a) => s + a.amount, 0)), count: voids.length, before: { count: before.length, amount: r2(before.reduce((s, a) => s + a.amount, 0)) }, after: { count: after.length, amount: r2(after.reduce((s, a) => s + a.amount, 0)) },
      byReason: sumBy(voids, (a) => a.reason, (a) => a.amount) },
    remakes: { count: remakes.length, byReason: sumBy(remakes, (a) => a.reason, () => 0) },
    waste,
    tips: { total: tips, mode: x.tips.mode, rows: x.tips.rows },
    drawers: cash,
    checklist,
    flags: [
      ...checklist.filter((c) => c.out).map((c) => `${c.label} read ${c.value}°F, ${c.limit}. ${c.note || ''}`.trim()),
      ...cash.filter((t) => t.overShort !== null && Math.abs(t.overShort) >= 0.01).map((t) => `${t.openedBy}’s drawer was ${t.overShort! < 0 ? 'short' : 'over'} $${Math.abs(t.overShort!).toFixed(2)}.`),
      ...(x.usualComps && x.usualComps > 0 && compTotal >= x.usualComps * 1.75 && compTotal - x.usualComps >= 20 ? [`Comps were $${compTotal.toFixed(2)}, about ${Math.round(compTotal / x.usualComps)} times a usual ${weekdayOf(x.day)}.`] : []),
    ],
  };
}
export const weekdayOf = (day: string) => { const d = new Date(`${day}T12:00:00Z`); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] || 'night'; };

/** The report as a plain email (and the text version of the HTML one). */
export function reportText(name: string, rep: NightReport): string {
  const $ = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
  const L: string[] = [];
  L.push(`${name}, ${weekdayOf(rep.day)} ${rep.day}`);
  L.push('');
  L.push(`Sales ${$(rep.sales.total)} from ${rep.sales.count} ${rep.sales.count === 1 ? 'sale' : 'sales'}, after discounts${rep.sales.refunds ? ` and ${$(rep.sales.refunds)} refunded` : ''}. Taken ${$(rep.sales.taken)} with tax ${$(rep.sales.tax)} and tips ${$(rep.sales.tips)}.`);
  if (rep.guests.covers) L.push(`${rep.guests.covers} guests at ${rep.guests.tables} tables${rep.guests.perGuest !== null ? `, ${$(rep.guests.perGuest)} a guest` : ''}.`);
  if (rep.sales.byMethod.length) L.push(`Paid by ${rep.sales.byMethod.map((m) => `${m.method.toLowerCase()} ${$(m.amount)}`).join(', ')}.`);
  L.push('');
  L.push(`Comps ${$(rep.comps.total)} (${rep.comps.count}). ${rep.comps.byReason.map((r) => `${r.label}: ${$(r.amount)}`).join('; ')}`.trim());
  L.push(`Voids ${$(rep.voids.total)} (${rep.voids.count}): ${rep.voids.before.count} before the kitchen started, ${rep.voids.after.count} after.`);
  if (rep.remakes.count) L.push(`Made again: ${rep.remakes.count}.`);
  L.push(`Waste, cost to make: ${$(rep.waste)}.`);
  if (rep.tips.rows.length) { L.push(''); L.push('Tips'); for (const t of rep.tips.rows) L.push(`  ${t.name}: ${$(t.takesHome)}${t.shared ? ` (${t.shared > 0 ? '+' : '−'}${$(Math.abs(t.shared))})` : ''}`); }
  if (rep.drawers.length) { L.push(''); for (const d of rep.drawers) L.push(`Drawer (${d.openedBy}): should have ${$(d.expectedCash)}, counted ${d.actualCash === null ? 'not yet' : $(d.actualCash)}.`); }
  if (rep.flags.length) { L.push(''); L.push('Worth a look'); for (const f of rep.flags) L.push(`  ${f}`); }
  return L.join('\n');
}
