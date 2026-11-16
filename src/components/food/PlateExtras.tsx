'use client';
// src/components/food/PlateExtras.tsx — SET ONCE, COUNTED EVERYWHERE (design canvas "Food numbers": What a plate really
// costs). On the Food cost page: what goes out with food and drink but isn't in any one recipe (a box for a main to go, a
// bag for an order to go, bread and butter for each guest at a table), each with what it costs; what card payments cost;
// and what all of it came to in the stretch. "Change" opens a sheet to set them: each picked from the business's own stock,
// in a measure it's counted in, for each item (in some menu sections, or all), each order, or each guest at a table, to go,
// for here, or both (lib/plate-extras). Saved through api/food-cost 'extras' and 'cardFee'.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { linesCost } from '@/lib/food-cost';
import { toStockUnits } from '@/lib/kitchen-units';
import { extraWords, MAX_EXTRAS, MAX_SECTIONS, type Extra, type Per, type When } from '@/lib/plate-extras';
import { partsOf, type Ingredient } from '@/components/menu/RecipeEditor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const feeWords = (n: number) => `${Math.round(n * 100) / 100}%`;

export type ExtraRow = Extra & { words: string; cost: number | null };
type EditRow = { key: string; id: string; itemId: string; name: string; amount: string; measure: string; per: Per; when: When; sections: string[] };

const PERS: { v: Per; label: string }[] = [{ v: 'item', label: 'Each item' }, { v: 'order', label: 'Each order' }, { v: 'guest', label: 'Each guest at a table' }];
const WHENS: { v: When; label: string }[] = [{ v: 'togo', label: 'To go' }, { v: 'here', label: 'For here' }, { v: 'any', label: 'Both' }];

async function post(path: string, body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
let seq = 0; const nextKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const asExtra = (r: EditRow): Extra => ({ id: r.id, itemId: r.itemId, name: r.name, amount: Number(r.amount), measure: r.measure, per: r.per, when: r.per === 'guest' ? 'here' : r.when, sections: r.per === 'item' ? r.sections : [] });

/** The card on the page. */
export function PlateExtras({ tenantId, extras, cardPct, cardShare, used, periodText, sections, onSaved }: {
  tenantId: string; extras: ExtraRow[]; cardPct: number; cardShare: number; used: { cost: number; unknown: number };
  /** "this week", "last week", "in the last 30 days" */
  periodText: string; sections: string[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="extras-title" className="rounded-3xl bg-[#fff] px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="extras-title" className="text-[15px] font-semibold">Set once, counted everywhere</h2>
          <p className="text-[13.5px]" style={{ color: MUTED }}>Not in any one recipe, but on every bill. Each comes off stock as it goes out.</p>
        </div>
        {extras.length > 0 && <button type="button" onClick={() => setOpen(true)} className={`min-h-[44px] shrink-0 rounded-xl px-3 text-[14px] font-semibold ${RING}`}>Change</button>}
      </div>
      <ul className="mt-2">
        {extras.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 border-t py-2.5" style={{ borderColor: LINE }}>
            <span className="min-w-0"><span className="block text-[14px]">{e.name}</span><span className="block text-[13px]" style={{ color: MUTED }}>{e.words.replace(/^./, (c) => c.toUpperCase())}</span></span>
            <span className="shrink-0 text-[14px] tabular-nums" style={{ color: e.cost === null ? AMBER : INK }}>{e.cost === null ? 'No cost yet' : money(e.cost)}</span>
          </li>))}
        <li className="flex items-start justify-between gap-3 border-t py-2.5" style={{ borderColor: LINE }}>
          <span className="min-w-0"><span className="block text-[14px]">Card fees</span><span className="block text-[13px]" style={{ color: MUTED }}>Of what’s paid by card{cardShare < 1 ? `, ${Math.round(cardShare * 100)}% of sales ${periodText}` : ''}</span></span>
          <span className="shrink-0 text-[14px] tabular-nums">{feeWords(cardPct)}</span>
        </li>
      </ul>
      {extras.length === 0
        ? <>
          <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Boxes and bags to go, cups and lids, bread for the table: add each once, and it’s costed on every plate and taken off stock as it goes out.</p>
          <button type="button" onClick={() => setOpen(true)} className={`mt-3 min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Add what goes out</button>
        </>
        : <p className="mt-1 border-t pt-2.5 text-[13.5px]" style={{ borderColor: LINE }}>{used.cost > 0 ? <>{money(used.cost)} went out with orders {periodText}.</> : <span style={{ color: MUTED }}>Nothing went out with orders {periodText} yet.</span>}{used.unknown > 0 ? <span style={{ color: AMBER }}> Some of it has no cost yet.</span> : null}</p>}
      {open && <ExtrasSheet tenantId={tenantId} extras={extras} cardPct={cardPct} sections={sections} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
    </section>
  );
}

function ExtrasSheet({ tenantId, extras, cardPct, sections, onClose, onSaved }: { tenantId: string; extras: ExtraRow[]; cardPct: number; sections: string[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<EditRow[]>(() => extras.map((e) => ({ key: nextKey(), id: e.id, itemId: e.itemId, name: e.name, amount: String(e.amount), measure: e.measure, per: e.per, when: e.when, sections: e.sections })));
  const [fee, setFee] = useState(String(Math.round(cardPct * 100) / 100));
  const [stock, setStock] = useState<Ingredient[] | null>(null); const [find, setFind] = useState('');
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);
  // One open to change at a time (a new one opens as it's added); the rest read as a line each.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  useEffect(() => { void post('/api/menu', { tenantId, action: 'ingredients' }).then((d) => { if (d.ok) setStock(d.ingredients || []); else setErr(d.error || 'Your stock didn’t load.'); }); }, [tenantId]);
  const byId = useMemo(() => new Map((stock || []).map((x) => [x.id, x])), [stock]);
  const parts = useMemo(() => partsOf(stock), [stock]);
  const matches = useMemo(() => { const t = find.trim().toLowerCase(); return !t || !stock ? [] : stock.filter((x) => x.name.toLowerCase().includes(t)).slice(0, 6); }, [find, stock]);
  const set = (key: string, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const works = (r: EditRow) => { const p = parts.get(r.itemId); const a = Number(r.amount); return a > 0 && (!p || toStockUnits(a, r.measure, p) !== null); };
  const costOf = (r: EditRow) => { const a = Number(r.amount); if (!stock || !(a > 0) || !works(r)) return null; return linesCost([{ id: r.itemId, name: r.name, quantityUsed: a, unit: r.measure, amount: a, measure: r.measure }], parts).cost; };

  const save = async () => {
    setErr('');
    const bad = rows.find((r) => !works(r)); if (bad) { setErr(`${bad.name}: put in how much, in a measure it’s counted in.`); return; }
    const pct = Number(String(fee).replace('%', '').trim()); if (!String(fee).trim() || !Number.isFinite(pct) || pct < 0 || pct > 10) { setErr('Card fees: a share from 0% to 10%, like 2.9.'); return; }
    setSaving(true);
    const d = await post('/api/food-cost', { tenantId, action: 'extras', extras: rows.map(asExtra) });
    if (!d.ok) { setSaving(false); setErr(d.error || 'That didn’t save.'); return; }
    if (Math.round(pct * 100) !== Math.round(cardPct * 100)) {
      const f = await post('/api/food-cost', { tenantId, action: 'cardFee', pct });
      if (!f.ok) { setSaving(false); setErr(f.error || 'Card fees didn’t save.'); return; }
    }
    setSaving(false); onSaved();
  };

  const chip = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="extras-sheet" className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-[#fff] sm:max-w-xl sm:rounded-3xl" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0"><h2 id="extras-sheet" className="text-[21px] font-semibold">What goes out with food and drink</h2>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Set each once. It’s costed on every plate it goes out with, and taken off stock when the order goes to the kitchen. To go is for counter and drive-thru orders; at a table or the front desk, it’s for here.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {rows.length > 0 && (
            <ul className="space-y-2.5" aria-label="What goes out">
              {rows.map((r) => {
                const x = byId.get(r.itemId); const measures = Array.from(new Set([...(x?.measures || [x?.unit || r.measure]), r.measure].filter(Boolean)));
                const ok = works(r); const c = costOf(r); const e = asExtra(r); const isOpen = openKey === r.key || !ok;
                return (
                  <li key={r.key} className={`${isOpen ? 'space-y-2.5 pb-3' : ''} rounded-2xl pb-1.5 pl-3 pr-1.5 pt-1.5`} style={{ background: SOFT }}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => setOpenKey(isOpen ? null : r.key)} aria-expanded={isOpen} className={`min-h-[44px] min-w-0 flex-1 rounded-xl text-left ${RING}`}>
                        <span className="block text-[15px] font-medium">{r.name}{!isOpen && <span className="ml-1.5 text-[13px] font-normal underline underline-offset-4" style={{ color: MUTED }}>Change</span>}</span>
                        <span className="block text-[13px]" style={{ color: !ok || (stock && !x) ? AMBER : MUTED }}>{stock && !x ? 'Not in your stock any more' : !ok ? `Counted in ${x?.unit || r.measure} now: pick another measure` : `${r.amount} ${r.measure === 'each' ? '' : `${r.measure} `}${extraWords(e)}, ${c === null ? 'cost not known yet' : money(c)}`}</span>
                      </button>
                      <button type="button" onClick={() => setRows((rs) => rs.filter((y) => y.key !== r.key))} aria-label={`Take ${r.name} off`} className={`h-11 w-11 shrink-0 rounded-full text-[20px] ${RING}`} style={{ color: MUTED }}>×</button>
                    </div>
                    {isOpen && <>
                    <div className="flex items-center gap-1.5">
                      <label><span className="sr-only">How much {r.name}</span>
                        <input inputMode="decimal" value={r.amount} onChange={(ev) => set(r.key, { amount: ev.target.value.replace(/[^0-9.]/g, '').slice(0, 8) })}
                          className="min-h-[44px] w-[80px] rounded-xl border bg-[#fff] px-2.5 text-right text-[16px] tabular-nums outline-none focus:border-[#16171a]" style={{ borderColor: ok ? LINE : AMBER }} /></label>
                      {measures.length > 1
                        ? <label><span className="sr-only">Measured in</span>
                          <select value={r.measure} onChange={(ev) => set(r.key, { measure: ev.target.value })} className="min-h-[44px] rounded-xl border bg-[#fff] px-2 text-[15px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }}>
                            {measures.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select></label>
                        : <span className="text-[14px]" style={{ color: MUTED }}>{r.measure}</span>}
                    </div>
                    <div role="radiogroup" aria-label={`${r.name}: for each`} className="flex flex-wrap gap-1.5">
                      {PERS.map((p) => <button key={p.v} type="button" role="radio" aria-checked={r.per === p.v} onClick={() => set(r.key, { per: p.v, ...(p.v === 'guest' ? { when: 'here' as When } : {}) })} className={`min-h-[44px] rounded-full px-3.5 text-[13.5px] font-semibold ${RING}`} style={chip(r.per === p.v)}>{p.label}</button>)}
                    </div>
                    {r.per !== 'guest' && (
                      <div role="radiogroup" aria-label={`${r.name}: when`} className="flex flex-wrap gap-1.5">
                        {WHENS.map((w) => <button key={w.v} type="button" role="radio" aria-checked={r.when === w.v} onClick={() => set(r.key, { when: w.v })} className={`min-h-[44px] rounded-full px-3.5 text-[13.5px] font-semibold ${RING}`} style={chip(r.when === w.v)}>{w.label}</button>)}
                      </div>
                    )}
                    {r.per === 'item' && sections.length > 1 && (
                      <div>
                        <p className="text-[13px]" style={{ color: MUTED }}>{r.sections.length ? 'Only with items in' : 'With every item. Or only with items in'}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`${r.name}: only with items in`}>
                          {sections.slice(0, MAX_SECTIONS).map((s) => { const on = r.sections.some((y) => y.toLowerCase() === s.toLowerCase());
                            return <button key={s} type="button" aria-pressed={on} onClick={() => set(r.key, { sections: on ? r.sections.filter((y) => y.toLowerCase() !== s.toLowerCase()) : [...r.sections, s] })} className={`min-h-[44px] rounded-full px-3.5 text-[13.5px] font-semibold ${RING}`} style={chip(on)}>{s}</button>; })}
                        </div>
                      </div>
                    )}
                    </>}
                  </li>);
              })}
            </ul>
          )}
          {rows.length < MAX_EXTRAS && (
            <div className="relative">
              <label className="block"><span className="sr-only">Add what goes out</span>
                <input type="search" value={find} onChange={(e) => setFind(e.target.value.slice(0, 60))} placeholder={stock ? 'Add from your stock: a box, a bag, lids, bread' : 'Loading your stock…'} disabled={!stock}
                  className="w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
              {find.trim() && stock && (
                <ul className="mt-1.5 overflow-hidden rounded-2xl border bg-[#fff]" style={{ borderColor: LINE }}>
                  {matches.length === 0 ? <li className="px-4 py-3 text-[14px]" style={{ color: MUTED }}>Nothing in your stock is called that. Add it in <Link href="/inventory" className="underline">Inventory</Link> first.</li>
                    : matches.map((x) => (
                      <li key={x.id}><button type="button" onClick={() => { const k = nextKey(); setOpenKey(k); setRows((rs) => [...rs, { key: k, id: nextKey(), itemId: x.id, name: x.name, amount: '1', measure: (x.measures || [x.unit])[0], per: 'item', when: 'togo', sections: [] }]); setFind(''); }}
                        className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left ${RING}`}>
                        <span className="truncate text-[15px] font-medium">{x.name}</span>
                        <span className="shrink-0 text-[13px]" style={{ color: MUTED }}>{x.left === null ? 'Not counted' : `${Math.round(x.left * 100) / 100}${x.unit === 'each' ? '' : ` ${x.unit}`} in stock`}</span>
                      </button></li>))}
                </ul>
              )}
            </div>
          )}
          <div className="border-t pt-3" style={{ borderColor: LINE }}>
            <label htmlFor="card-fee" className="block text-[15px] font-medium">Card fees</label>
            <p className="text-[13px]" style={{ color: MUTED }}>What your card processor keeps from each card payment. 2.9% is typical.</p>
            <span className="mt-1.5 flex min-h-[44px] w-[120px] items-center rounded-xl border bg-[#fff] px-3 focus-within:border-[#16171a]" style={{ borderColor: LINE }}>
              <input id="card-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} className="min-w-0 flex-1 bg-transparent text-right text-[16px] tabular-nums outline-none" />
              <span aria-hidden className="pl-1" style={{ color: MUTED }}>%</span>
            </span>
          </div>
        </div>
        {err && <p role="alert" className="mx-6 mb-2 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <button type="button" onClick={onClose} className={`min-h-[48px] flex-1 rounded-xl text-[15px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving || !stock} className={`min-h-[48px] flex-[2] rounded-xl text-[15px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
