'use client';
// src/app/(app)/food-cost/page.tsx — FOOD COST (design canvas "Food cost"; lib/food-cost, api/food-cost). For managers:
// what the food and drink sold this week (last week, or the last 30 days) cost to make, as a share of what it sold for, in
// all and day by day, against the business's own aim; what each menu item costs to make from its recipe, and the price that
// would bring one that's over back to the aim, and what a plate really costs at a table and to go (with what goes out with
// it and the card fee: components/food/PlateExtras); the ingredients still at typical prices, with what the business pays
// put in right here; what the counts found against what was sold; what was thrown away; and the staff meals.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { amountWords, countWords, PERIODS, type CountRow, type ItemCost, type Period, type PeriodCost, type PlateCost, type Waste } from '@/lib/food-cost';
import { PlateExtras, type ExtraRow } from '@/components/food/PlateExtras';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Item = ItemCost & { sold: number; section: string };
type Typical = { id: string; name: string; container: string; cost: number; per: number | null; unit: string };
type StaffMeals = { count: number; cost: number; unknown: number; by: { for: string; count: number; cost: number; unknown: number }[] };
type Report = { period: Period; days: string[]; today: string; target: number; report: PeriodCost; items: Item[]; typical: Typical[]; counts: CountRow[]; waste: Waste; partial?: boolean;
  extras: ExtraRow[]; cardPct: number; cardShare: number; extrasUsed: { cost: number; unknown: number }; staffMeals: StaffMeals };

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const wk = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const md = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
const periodWords = (p: Period) => (p === 'last' ? 'last week' : p === '30' ? 'in the last 30 days' : 'this week');

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/food-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

/** The days of the stretch as rows: each day for a week, each week for 30 days. */
function dayRows(r: Report): { label: string; sold: number; cost: number; share: number | null }[] {
  const days = r.report.days;
  if (days.length <= 7) return days.filter((d) => d.sold > 0 || d.day <= r.today).map((d) => ({ label: wk(d.day), sold: d.sold, cost: d.cost, share: d.share }));
  const out: { label: string; sold: number; cost: number; share: number | null }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7); const sold = chunk.reduce((s, d) => s + d.sold, 0), cost = chunk.reduce((s, d) => s + d.cost, 0);
    out.push({ label: `${md(chunk[0].day)}`, sold, cost, share: sold > 0 ? cost / sold : null });
  }
  return out;
}

/** What a plate really costs at a table and to go, side by side: the recipe, each thing that goes out with it (a dash
 *  where it doesn't), the card fee, and what that leaves. One column when nothing goes out differently. */
function plateTable(here: PlateCost, togo: PlateCost) {
  type Row = { key: string; label: string; here: number | null | undefined; togo: number | null | undefined };
  const rows: Row[] = [];
  const add = (p: PlateCost, side: 'here' | 'togo') => {
    for (const l of [...p.extras.map((x) => ({ ...x, per: 'item' as const })), ...p.once]) {
      const key = `${l.per}:${l.id}`; let r = rows.find((x) => x.key === key);
      if (!r) { r = { key, label: l.per === 'item' ? l.name : `${l.name}, once ${l.per === 'guest' ? 'a guest' : 'an order'}`, here: undefined, togo: undefined }; rows.push(r); }
      r[side] = l.cost;
    }
  };
  add(here, 'here'); add(togo, 'togo'); rows.sort((a, b) => Number(!a.key.startsWith('item:')) - Number(!b.key.startsWith('item:')));
  const one = here.total === togo.total && rows.every((r) => r.here === r.togo);
  const cell = (v: number | null | undefined, tone?: string) => <td className="py-1 pl-2 text-right tabular-nums" style={{ color: v === null ? AMBER : v === undefined ? MUTED : tone || INK }}>{v === undefined ? '–' : v === null ? 'no cost' : money(v)}</td>;
  const fee = `Card fee, ${Math.round(here.cardPct * 100) / 100}%${here.cardShare < 1 ? ` on the ${Math.round(here.cardShare * 100)}% paid by card` : ''}`;
  return (
    <table className="w-full text-[13.5px]">
      <thead><tr><th className="py-1 text-left font-normal" style={{ color: MUTED }}><span className="sr-only">What</span></th>
        {one ? <th className="whitespace-nowrap py-1 pl-2 text-right font-semibold">At a table or to go</th> : <><th className="whitespace-nowrap py-1 pl-2 text-right font-semibold">At a table</th><th className="whitespace-nowrap py-1 pl-2 text-right font-semibold">To go</th></>}</tr></thead>
      <tbody>
        <tr><td className="py-1" style={{ color: MUTED }}>From the recipe</td>{cell(here.recipe)}{!one && cell(togo.recipe)}</tr>
        {rows.map((r) => <tr key={r.key}><td className="py-1" style={{ color: MUTED }}>{r.label}</td>{cell(r.here)}{!one && cell(r.togo)}</tr>)}
        <tr><td className="py-1" style={{ color: MUTED }}>{fee}</td>{cell(here.cardFee)}{!one && cell(togo.cardFee)}</tr>
        <tr className="border-t font-semibold" style={{ borderColor: LINE }}><td className="py-1">Costs you</td>{cell(here.total)}{!one && cell(togo.total)}</tr>
        <tr><td className="py-1" style={{ color: MUTED }}>Share of the price</td><td className="py-1 pl-2 text-right tabular-nums">{pct(here.share)}</td>{!one && <td className="py-1 pl-2 text-right tabular-nums">{pct(togo.share)}</td>}</tr>
        <tr><td className="py-1" style={{ color: MUTED }}>Keeps</td>{cell(here.keeps, here.keeps !== null && here.keeps < 0 ? AMBER : undefined)}{!one && cell(togo.keeps, togo.keeps !== null && togo.keeps < 0 ? AMBER : undefined)}</tr>
      </tbody>
    </table>
  );
}

export default function FoodCostPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [period, setPeriod] = useState<Period>('week');
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({}); const [saving, setSaving] = useState<string | null>(null);
  const [aimOpen, setAimOpen] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return; setLoading(true);
    const d = await post({ tenantId, action: 'report', period }); setLoading(false);
    if (d.ok) { setR(d); setErr(''); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, period]);
  useEffect(() => { void load(); }, [load]);

  const saveCost = async (t: Typical) => {
    if (!tenantId) return; setSaving(t.id); setErr('');
    const d = await post({ tenantId, action: 'cost', itemId: t.id, cost: Number(String(typed[t.id] || '').replace(/[$,\s]/g, '')) }); setSaving(null);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    setTyped((m) => { const n = { ...m }; delete n[t.id]; return n; }); void load();
  };
  const setAim = async (v: number) => {
    if (!tenantId) return; setSaving('aim'); setErr('');
    const d = await post({ tenantId, action: 'target', target: v }); setSaving(null);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    setAimOpen(false); void load();
  };

  const rep = r?.report; const rows = r ? dayRows(r) : [];
  const barMax = Math.max(0.5, ...rows.map((x) => x.share || 0));
  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Food cost</h1>
            <p className="text-[15px]" style={{ color: MUTED }}>What your menu costs to make, against what it sells for.</p>
          </div>
          <div role="radiogroup" aria-label="Which stretch" className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button key={p.value} type="button" role="radio" aria-checked={period === p.value} onClick={() => setPeriod(p.value)}
                className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={period === p.value ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{p.label}</button>
            ))}
          </div>
        </header>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {!r ? <div className="h-48 rounded-3xl bg-[#fff]" aria-busy="true" /> : (
          <div className="grid items-start gap-4 lg:grid-cols-3" aria-busy={loading}>
            <div className="space-y-4">
              <section aria-labelledby="share-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                <p id="share-title" className="text-[13.5px]" style={{ color: MUTED }}>{PERIODS.find((p) => p.value === r.period)?.label}</p>
                <p className="text-[40px] font-medium leading-tight tabular-nums" style={{ color: rep!.share !== null && rep!.share > r.target + 0.0005 ? AMBER : INK }}>{pct(rep!.share)}</p>
                <p className="text-[14px]" style={{ color: MUTED }}>
                  {rep!.sold > 0 ? <>{whole(rep!.sold)} in food and drink sold {periodWords(r.period)}.{rep!.covered > 0 ? <> {whole(rep!.cost)} of {rep!.uncovered > 0 ? `the ${whole(rep!.covered)} with a known cost` : 'it'} was what it cost to make.</> : null}</>
                    : `Nothing sold ${periodWords(r.period)} yet. Sales at the counter, at tables and at the front desk show here.`}
                </p>
                {r.partial && <p className="mt-1 text-[13.5px]" style={{ color: AMBER }}>This stretch has more than is read at once, so some sales or counts may be left out. Pick a shorter stretch for all of it.</p>}
                {rep!.uncovered > 0 && <p className="mt-1 text-[13.5px]" style={{ color: AMBER }}>{money(rep!.uncovered)} sold has no cost to make yet, so it’s left out: {rep!.uncoveredItems.join(', ')}.</p>}
                {rows.some((x) => x.sold > 0) && (
                  <ul className="mt-3 space-y-1.5" aria-label="By day">
                    {rows.map((x) => { const over = x.share !== null && x.share > r.target + 0.0005; return (
                      <li key={x.label} className="flex items-center gap-3 text-[13.5px]">
                        <span className="w-14 shrink-0">{x.label}</span>
                        <span className="h-2 rounded" aria-hidden style={{ width: `${x.share === null ? 0 : Math.max(3, Math.round((x.share / barMax) * 100))}%`, maxWidth: '60%', background: over ? AMBER : INK }} />
                        <span className="tabular-nums" style={{ color: over ? AMBER : x.share === null ? MUTED : INK }}>{x.share === null ? 'Nothing sold' : pct(x.share)}</span>
                      </li>); })}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2" style={{ borderColor: LINE }}>
                  <span className="text-[13.5px]" style={{ color: MUTED }}>Aiming for {pct(r.target)} or less</span>
                  {aimOpen
                    ? <select autoFocus aria-label="Aim for this share or less" value={Math.round(r.target * 100)} disabled={saving === 'aim'} onChange={(e) => void setAim(Number(e.target.value) / 100)} className="min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15px]" style={{ borderColor: LINE }}>
                        {Array.from(new Set([...Array.from({ length: 31 }, (_, i) => 15 + i), Math.round(r.target * 100)])).sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}%</option>)}
                      </select>
                    : <button type="button" onClick={() => setAimOpen(true)} className={`min-h-[44px] rounded-xl px-3 text-[14px] font-semibold ${RING}`}>Change</button>}
                </div>
              </section>
              {r.typical.length > 0 && (
                <section aria-labelledby="typical-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                  <p id="typical-title" className="text-[14px]" style={{ color: AMBER }}>{r.typical.length === 1 ? '1 ingredient is' : `${r.typical.length} ingredients are`} still at typical prices. Put in what you pay for a true number.</p>
                  <button type="button" onClick={() => setPricesOpen((v) => !v)} aria-expanded={pricesOpen} className={`mt-2 min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>{pricesOpen ? 'Done' : 'Put in what you pay'}</button>
                  {pricesOpen && (
                    <ul className="mt-3 divide-y" style={{ borderColor: LINE }}>
                      {r.typical.map((t) => (
                        <li key={t.id} className="py-3" style={{ borderColor: LINE }}>
                          <label htmlFor={`cost-${t.id}`} className="block text-[14.5px] font-medium">{t.name}</label>
                          <span className="block text-[13px]" style={{ color: MUTED }}>Typical: {money(t.cost)}{t.container ? ` a ${t.container}` : ''}</span>
                          <span className="mt-1.5 flex gap-2">
                            <span className="flex min-h-[44px] flex-1 items-center rounded-xl border bg-[#fff] px-3 focus-within:border-[#16171a]" style={{ borderColor: LINE }}>
                              <span aria-hidden style={{ color: MUTED }}>$</span>
                              <input id={`cost-${t.id}`} inputMode="decimal" value={typed[t.id] || ''} onChange={(e) => setTyped((m) => ({ ...m, [t.id]: e.target.value }))} placeholder={t.cost.toFixed(2)}
                                aria-label={`What you pay for ${t.container ? `a ${t.container} of ` : ''}${t.name}`} className="min-w-0 flex-1 bg-transparent pl-1 text-[16px] outline-none" />
                            </span>
                            <button type="button" onClick={() => void saveCost(t)} disabled={!String(typed[t.id] || '').trim() || saving === t.id} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{saving === t.id ? 'Saving…' : 'Save'}</button>
                          </span>
                        </li>))}
                    </ul>
                  )}
                </section>
              )}
              <PlateExtras tenantId={tenantId!} extras={r.extras || []} cardPct={r.cardPct} cardShare={r.cardShare} used={r.extrasUsed || { cost: 0, unknown: 0 }} periodText={periodWords(r.period)}
                sections={Array.from(new Set(r.items.map((m) => m.section).filter(Boolean)))} onSaved={() => void load()} />
            </div>

            <section aria-labelledby="items-title" className="rounded-3xl bg-[#fff] px-5 py-4">
              <h2 id="items-title" className="text-[15px] font-semibold">Each item</h2>
              <p className="text-[13.5px]" style={{ color: MUTED }}>Cost to make from its recipe, as a share of its price. Tap one to see what goes into it.</p>
              {r.items.length === 0 ? <p className="mt-3 text-[14px]" style={{ color: MUTED }}>Nothing on the menu yet. <Link href="/settings/setup/food" className="underline">Set up for food and drink</Link> to start from a menu with recipes.</p> : (
                <ul className="mt-2">
                  {r.items.map((m) => { const isOpen = open === m.id; return (
                    <li key={m.id} className="border-t" style={{ borderColor: LINE }}>
                      <button type="button" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen} className={`flex min-h-[46px] w-full items-center gap-2 py-2 text-left text-[14px] ${RING}`}>
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          <span>{m.name}</span>
                          {m.over && <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Over {pct(m.target)}</span>}
                          {m.typical && <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: SOFT, color: MUTED }}>Typical prices</span>}
                          {(m.options || []).some((o) => o.thin) && <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>A choice keeps little</span>}
                        </span>
                        {m.needsPrice ? <span className="text-[13.5px]" style={{ color: MUTED }}>Needs a price</span> : <span className="w-16 text-right tabular-nums" style={{ color: MUTED }}>{money(m.price)}</span>}
                        <span className="w-14 text-right tabular-nums">{m.cost === null ? '–' : money(m.cost)}</span>
                        <span className="w-10 text-right tabular-nums" style={{ color: m.over ? AMBER : INK }}>{pct(m.share)}</span>
                      </button>
                      {m.over && m.fix !== null && !isOpen && <p className="-mt-1 pb-2 text-[13px]" style={{ color: MUTED }}>{money(m.fix)} would bring it to {pct(m.target)}.{m.biggest ? ` Or check the recipe: ${m.biggest.name.toLowerCase()} is the biggest part.` : ''}</p>}
                      {isOpen && (
                        <div className="space-y-1.5 pb-3 text-[13.5px]">
                          {m.byRecipe ? m.lines.map((l, i) => (
                            <p key={`${l.id}-${i}`} className="flex justify-between gap-3"><span style={{ color: MUTED }}>{l.name}{l.prep ? ' (prep recipe)' : ''}, {amountWords(l.amount, l.unit)}{l.usable ? `, ${Math.round(l.usable * 100)}% usable` : ''}{l.typical ? ' (typical price)' : ''}</span><span className="tabular-nums">{l.cost === null ? 'no cost yet' : money(l.cost)}</span></p>))
                            : <p style={{ color: MUTED }}>Sold as it comes, at what one costs.</p>}
                          {(m.options || []).length > 0 && (
                            <div className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: LINE }}>
                              <p className="font-semibold">What each choice keeps</p>
                              {m.options.map((o) => (
                                <p key={`${o.groupId}/${o.optionId}`} className="flex justify-between gap-3"><span style={{ color: o.thin ? AMBER : MUTED, fontWeight: o.thin ? 600 : 400 }}>{o.option}: charges {o.price < 0 ? `−${money(-o.price)}` : money(o.price)}, costs {o.cost === null ? 'not known yet' : o.cost < 0 ? `${money(-o.cost)} less` : money(o.cost)}</span>
                                  <span className="tabular-nums" style={{ color: o.thin ? AMBER : INK, fontWeight: o.thin ? 600 : 400 }}>{o.keeps === null ? '–' : `keeps ${o.keeps < 0 ? `−${money(-o.keeps)}` : money(o.keeps)}`}</span></p>))}
                              {m.options.some((o) => o.thin) && <p style={{ color: MUTED }}>A choice that barely pays for itself: raise what it charges, or check what it uses.</p>}
                            </div>
                          )}
                          {m.plates && m.cost !== null && m.price > 0 && (
                            <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: LINE }}>
                              <p className="font-semibold">What a plate really costs</p>
                              {plateTable(m.plates.here, m.plates.togo)}
                              {[...m.plates.here.once, ...m.plates.togo.once].length > 0 && <p style={{ color: MUTED }}>What goes out once an order or once a guest is counted as if this were all that was ordered. Shared over more, it’s less.</p>}
                              {r.extras.length === 0 && <p style={{ color: MUTED }}>Add what goes out with it, like a box to go or bread for the table, under Set once, counted everywhere.</p>}
                            </div>
                          )}
                          {m.gaps.length > 0 && <p style={{ color: AMBER }}>{m.gaps.map((x) => `${x.name}: ${x.why}`).join('. ')}. Put its cost in Inventory, and this item’s cost shows.</p>}
                          {m.missing.length > 0 && <p style={{ color: AMBER }}>Add {m.missing.join(', ')} to its recipe: yours {m.missing.length === 1 ? 'is' : 'are'} measured differently from the starter recipe.</p>}
                          {m.over && m.fix !== null && <p>{money(m.fix)} would bring it to {pct(m.target)}.{m.biggest ? ` Or check the recipe: ${m.biggest.name.toLowerCase()} is the biggest part, ${money(m.biggest.cost || 0)} of it.` : ''}</p>}
                          {m.sold > 0 && <p style={{ color: MUTED }}>{m.sold} sold {periodWords(r.period)}.</p>}
                          <Link href="/menu" className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">Change its price or recipe on the Menu</Link>
                        </div>
                      )}
                    </li>); })}
                </ul>
              )}
            </section>

            <div className="space-y-4">
              <section aria-labelledby="counted-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                <h2 id="counted-title" className="text-[15px] font-semibold">Used against counted</h2>
                <p className="text-[13.5px]" style={{ color: MUTED }}>What your counts found, against what sales say you used, since each one was last counted.</p>
                {r.counts.length === 0 ? <p className="mt-3 text-[14px]" style={{ color: MUTED }}>No ingredients counted {periodWords(r.period)}. Count them in <Link href="/inventory" className="underline">Inventory</Link>, and what each count finds shows here.</p> : (
                  <ul className="mt-2">
                    {r.counts.map((c) => (
                      <li key={c.id} className="border-t py-2.5" style={{ borderColor: LINE }}>
                        <p className="flex justify-between gap-3 text-[14px]"><span>{c.name}</span>
                          {!c.first && c.value !== null && <span className="font-semibold tabular-nums" style={{ color: c.value > 0.005 ? AMBER : c.value < -0.005 ? MUTED : INK }}>{money(Math.abs(c.value))}</span>}</p>
                        <p className="text-[13px]" style={{ color: MUTED }}>{c.first ? `First count, ${md(c.last)}. The next one is compared with it.` : `${countWords(c)}, counted ${md(c.last)}${c.typical && Math.abs(c.change) > 0 ? ', at a typical price' : ''}`}</p>
                      </li>))}
                  </ul>
                )}
                {r.counts.some((c) => !c.first && c.change < 0) && <p className="mt-2 text-[13.5px]" style={{ color: MUTED }}>More gone than sold usually means portions bigger than the recipe, waste nobody logged (a held batch past its time that wasn’t thrown out on the kitchen screen), or something in the recipe that isn’t written down.</p>}
              </section>
              <section aria-labelledby="waste-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                <h2 id="waste-title" className="text-[15px] font-semibold">Thrown away</h2>
                <p className="text-[13.5px]" style={{ color: MUTED }}>{money(r.waste.total)} {periodWords(r.period)}: remakes, voids after the kitchen started, and batches past their time.</p>
                {r.waste.total > 0 && <p className="mt-1 text-[13.5px] tabular-nums">{[r.waste.remakes > 0 ? `Remakes ${money(r.waste.remakes)}` : '', r.waste.voids > 0 ? `voids ${money(r.waste.voids)}` : '', r.waste.batches > 0 ? `batches ${money(r.waste.batches)}` : ''].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}.</p>}
              </section>
              <section aria-labelledby="staff-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                <h2 id="staff-title" className="text-[15px] font-semibold">Staff meals</h2>
                {!r.staffMeals || r.staffMeals.count === 0
                  ? <p className="text-[13.5px]" style={{ color: MUTED }}>None {periodWords(r.period)}. At the counter, send the order, then pick Staff meal instead of a payment: it comes off stock at what it cost to make, on the books and not a mystery.</p>
                  : <>
                    <p className="text-[13.5px]" style={{ color: MUTED }}>{r.staffMeals.count} {periodWords(r.period)}, {money(r.staffMeals.cost)} at what they cost to make. Not counted as sales.</p>
                    <ul className="mt-2">
                      {r.staffMeals.by.map((x) => (
                        <li key={x.for} className="flex justify-between gap-3 border-t py-2 text-[14px]" style={{ borderColor: LINE }}><span>{x.for}<span style={{ color: MUTED }}>, {x.count}</span></span><span className="tabular-nums">{money(x.cost)}</span></li>))}
                    </ul>
                    {r.staffMeals.unknown > 0 && <p className="mt-1 text-[13px]" style={{ color: AMBER }}>Some items have no cost yet, so they’re left out.</p>}
                  </>}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
