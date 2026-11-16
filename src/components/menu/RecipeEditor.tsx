'use client';
// src/components/menu/RecipeEditor.tsx — WHAT GOES INTO ONE (or into a batch), as the cook measures it (design canvas
// "Food numbers"). Each line: an ingredient from the business's stock, an amount, and a kitchen measure (2 tbsp, 6 oz,
// 1 each) turned into what the ingredient is counted in (lib/kitchen-units); what that line costs, with what trimming
// and cooking lose; and a prep recipe made in batches marked as one. The total shows as it's typed: what one costs to
// make and its share of the price, worked out here by the same rules the server uses (lib/food-cost).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { linesCost } from '@/lib/food-cost';
import { canonUnit, convert, measureWords, sameUnit, toStockUnits } from '@/lib/kitchen-units';
import type { RecipeLine } from '@/lib/menu-stock';
import { money } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

/** An ingredient as api/menu 'ingredients' gives it: what's left, how it's measured, and what a cost is worked out from. */
export type Ingredient = { id: string; name: string; unit: string; left: number | null; menu: boolean; prep?: boolean; measures?: string[]; usable?: number | null; perEach?: { amount: number; unit: string } | null; unitCost?: number | null; part?: any };
export type EditLine = { id: string; name: string; unit: string; q: string; measure: string };

const amount = (n: number) => String(Math.round(n * 1000) / 1000);
/** A saved recipe line as the editor shows it: what was written (2 tbsp), else its amount in what it's counted in. */
export const toEditLine = (l: RecipeLine): EditLine => ({ id: l.id, name: l.name, unit: l.unit, q: amount(l.measure && Number(l.amount) > 0 ? Number(l.amount) : l.quantityUsed), measure: l.measure && Number(l.amount) > 0 ? l.measure : l.unit });
/** What the server is sent for a line: the amount as written and its measure (lib/prep-recipes-server recipeFromScreen). */
export const toSaveLine = (l: EditLine) => ({ id: l.id, name: l.name, amount: Number(l.q), measure: l.measure });
/** Ingredients by id, as lib/food-cost reads them (a prep recipe's own recipe included). */
export function partsOf(stock: Ingredient[] | null): Map<string, any> { return new Map((stock || []).map((x) => [x.id, { ...(x.part || {}), name: x.name }])); }
/** The edit lines as recipe lines, each in what its ingredient is counted in (unworkable amounts left as typed). */
export function asRecipe(lines: EditLine[], parts: Map<string, any>): RecipeLine[] {
  return lines.filter((l) => Number(l.q) > 0).map((l) => {
    const p = parts.get(l.id); const a = Number(l.q); const q = p ? toStockUnits(a, l.measure, p) : null;
    return { id: l.id, name: l.name, quantityUsed: q ?? a, unit: l.unit, ...(l.measure && !sameUnit(l.measure, l.unit) ? { amount: a, measure: l.measure } : {}) };
  });
}

export function RecipeEditor({ lines, onChange, stock, ownId, price, batch, canMake, short, title = 'Recipe', intro }: {
  lines: EditLine[]; onChange: (l: EditLine[]) => void; stock: Ingredient[] | null; ownId: string; price?: number | null;
  /** A prep recipe's batch: what it makes, in what (the total then reads as a batch, and per portion). */
  batch?: { makes: number; unit: string } | null;
  canMake?: number | null; short?: string | null; title?: string; intro?: string;
}) {
  const [find, setFind] = useState('');
  const byId = useMemo(() => new Map((stock || []).map((x) => [x.id, x])), [stock]);
  const parts = useMemo(() => partsOf(stock), [stock]);
  const matches = useMemo(() => {
    const t = find.trim().toLowerCase(); if (!t || !stock) return [];
    return stock.filter((x) => x.id !== ownId && !lines.some((l) => l.id === x.id) && x.name.toLowerCase().includes(t)).slice(0, 6);
  }, [find, stock, lines, ownId]);
  const cost = useMemo(() => (stock ? linesCost(asRecipe(lines, parts), parts) : null), [lines, parts, stock]);
  const leftWords = (x: Ingredient | undefined) => (!x ? 'Not in your stock any more' : x.left === null ? 'Not counted' : `${amount(x.left)}${x.unit === 'each' ? '' : ` ${x.unit}`} in stock`);
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((y, k) => (k === i ? { ...y, ...patch } : y)));
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>{intro || 'What goes into one, as you measure it. With a recipe, this item is available while its ingredients are in stock, and each one sold takes them off. Without one, it uses its own count in Inventory.'}</p>
      </div>
      {lines.length > 0 && (
        <ul className="space-y-2" aria-label="Ingredients">
          {lines.map((l, i) => {
            const x = byId.get(l.id); const unit = x?.unit || l.unit;
            const measures = Array.from(new Set([...(x?.measures || [unit]), l.measure].filter(Boolean)));
            const a = Number(l.q); const works = !x || !(a > 0) || toStockUnits(a, l.measure, parts.get(l.id)) !== null;
            const c = cost?.lines.find((y) => y.id === l.id);
            // What it says under the name: a measure that no longer works, a prep recipe, what trimming loses, or what's left.
            // What it takes off stock with its yield, in the measure it's written in (6 oz takes 9.2 oz), else what it's counted in.
            const off = x?.usable ? (toStockUnits(a, l.measure, parts.get(l.id)) || 0) / x.usable : 0; const inWritten = x?.usable ? convert(off, unit, l.measure) : null;
            const note = !works ? `Counted in ${unit} now: pick another measure` : x?.usable ? `${Math.round(x.usable * 100)}% usable: takes ${inWritten !== null ? measureWords(Math.round(inWritten * 10) / 10, l.measure) : measureWords(off, unit)} off stock` : leftWords(x);
            return (
              <li key={l.id} className="rounded-xl py-1.5 pl-3 pr-1" style={{ background: SOFT }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[120px] flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate text-[15px] font-medium">{l.name}</span>{x?.prep && <span className="shrink-0 rounded-full bg-[#fff] px-2 py-0.5 text-[11.5px] font-semibold">Prep</span>}</span>
                    {stock && <span className="block text-[12.5px]" style={{ color: !works || (x && x.left !== null && x.left <= 0) ? AMBER : MUTED }}>{note}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <label><span className="sr-only">How much {l.name}</span>
                      <input inputMode="decimal" value={l.q} onChange={(e) => set(i, { q: e.target.value.replace(/[^0-9.]/g, '').slice(0, 8) })}
                        className="min-h-[44px] w-[72px] rounded-xl border bg-[#fff] px-2.5 text-right text-[16px] tabular-nums outline-none focus:border-[#16171a]" style={{ borderColor: works ? LINE : AMBER }} /></label>
                    {measures.length > 1 ? (
                      <label><span className="sr-only">Measured in</span>
                        <select value={l.measure} onChange={(e) => set(i, { measure: e.target.value })} className="min-h-[44px] w-[78px] rounded-xl border bg-[#fff] px-2 text-[15px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }}>
                          {measures.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select></label>
                    ) : <span className="w-[78px] truncate text-[13.5px]" style={{ color: MUTED }}>{unit}</span>}
                    <span className="w-14 text-right text-[13.5px] tabular-nums" style={{ color: c?.cost === null || c?.cost === undefined ? MUTED : INK }}>{c?.cost === null || c?.cost === undefined ? '–' : money(c.cost)}</span>
                    <button type="button" onClick={() => onChange(lines.filter((_, k) => k !== i))} aria-label={`Take ${l.name} out of the recipe`} className={`h-11 w-11 shrink-0 rounded-full text-[20px] ${RING}`} style={{ color: MUTED }}>×</button>
                  </span>
                </div>
              </li>);
          })}
        </ul>
      )}
      {lines.length < 20 && (
        <div className="relative">
          <label className="block"><span className="sr-only">Add an ingredient</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value.slice(0, 60))} placeholder={stock ? 'Add an ingredient: buns, milk, house aioli' : 'Loading your stock…'} disabled={!stock}
              className="w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
          {find.trim() && stock && (
            <ul className="mt-1.5 overflow-hidden rounded-2xl border bg-[#fff]" style={{ borderColor: LINE }}>
              {matches.length === 0 ? <li className="px-4 py-3 text-[14px]" style={{ color: MUTED }}>Nothing in your stock is called that. Add it in <Link href="/inventory" className="underline">Inventory</Link> first.</li>
                : matches.map((x) => (
                  <li key={x.id}><button type="button" onClick={() => { onChange([...lines, { id: x.id, name: x.name, unit: x.unit, q: canonUnit(x.unit) ? '' : '1', measure: (x.measures || [x.unit])[0] }]); setFind(''); }}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left ${RING}`}>
                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[15px] font-medium">{x.name}</span>{x.prep && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: SOFT }}>Prep</span>}</span>
                    <span className="shrink-0 text-[13px]" style={{ color: MUTED }}>{leftWords(x)}</span>
                  </button></li>))}
            </ul>
          )}
        </div>
      )}
      {cost && lines.length > 0 && (
        <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: SOFT }}>{cost.cost === null
          ? <span style={{ color: AMBER }}>Cost not known yet: {cost.gaps.slice(0, 2).map((g) => (/^no /.test(g.why) ? `${g.name} has ${g.why}` : `${g.name}, ${g.why}`)).join('; ')}. Put it in Inventory, and the cost shows.</span>
          : batch ? <><b className="font-semibold">A batch costs {money(cost.cost)}</b>{batch.makes > 0 ? <span style={{ color: MUTED }}>, {perPortion(cost.cost / batch.makes, batch.unit)}</span> : null}{cost.typical ? <span style={{ color: MUTED }}> (some at typical prices)</span> : null}</>
          : <><b className="font-semibold">Costs {money(cost.cost)} to make</b>{price && price > 0 ? <span style={{ color: MUTED }}>, {Math.round((cost.cost / price) * 100)}% of its {money(price)} price</span> : null}{cost.typical ? <span style={{ color: MUTED }}> (some at typical prices)</span> : null}</>}</p>
      )}
      {canMake !== null && canMake !== undefined && (
        <p className="text-[13.5px]" style={{ color: canMake > 0 ? GREEN : AMBER }}>{canMake > 0 ? `Enough in stock for ${canMake} right now.` : `Can’t be made right now: ${short || 'an ingredient'} has run out.`}</p>
      )}
    </div>
  );
}

/** What a portion of a batch costs, in the measure it reads best in: per 100 ml or g, per L, per portion. */
export function perPortion(each: number, unit: string): string {
  const c = canonUnit(unit);
  if (c === 'ml' || c === 'g') return `${money(each * 100)} per 100 ${c}`;
  if (c) return `${money(each)} per ${c}`;
  return `${money(each)} per ${unit.replace(/s$/, '')}`;
}
