'use client';
// src/components/menu/PrepRecipes.tsx — PREP RECIPES ON THE MENU PAGE (design canvas "Food numbers": Prep recipes). The
// sauces, soups, doughs and dressings made in batches: what a batch makes and costs, what a portion costs, what's on the
// shelf. Each opens in an editor: its name, what a batch makes, how long it keeps and takes, and what goes into it, as
// the cook measures it (components/menu/RecipeEditor). Saved through api/menu 'prep' (lib/prep-recipes-server); a dish
// then uses it by the portion like any ingredient, and the Prep page says when to make a batch.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RecipeEditor, toEditLine, toSaveLine, perPortion, type EditLine, type Ingredient } from '@/components/menu/RecipeEditor';
import { money } from '@/lib/menu-choices';
import { makesWords, PREP_COUNTS } from '@/lib/prep-recipes';
import { VOLUMES, WEIGHTS } from '@/lib/kitchen-units';
import type { RecipeLine } from '@/lib/menu-stock';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = 'mt-1.5 w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';

export type PrepRow = { id: string; name: string; makes: number; unit: string; keepsDays: number | null; minutes: number | null; lastMadeAt: string | null; lastMadeBy: string | null;
  left: number | null; batchCost: number | null; unitCost: number | null; typical: boolean; gaps: { name: string; why: string }[]; recipe: RecipeLine[] };
const amt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function PrepRecipes({ preps, call, onSaved }: { preps: PrepRow[]; call: (body: any) => Promise<any>; onSaved: () => void }) {
  const [open, setOpen] = useState<PrepRow | 'new' | null>(null);
  return (
    <section aria-labelledby="prep-title" className="rounded-3xl border bg-[#fff] px-5 py-4" style={{ borderColor: LINE }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="prep-title" className="text-[16px] font-semibold">Prep recipes</h2>
          <p className="text-[13.5px]" style={{ color: MUTED }}>Sauces, soups, doughs and dressings made in batches. A dish uses them by the portion, and each portion carries its share of the batch’s cost. <Link href="/prep" className="underline">The Prep page</Link> says when to make one.</p>
        </div>
        <button type="button" onClick={() => setOpen('new')} className={BTN} style={{ border: `1px solid ${LINE}` }}>New prep recipe</button>
      </div>
      {preps.length > 0 && (
        <ul className="mt-3 divide-y" style={{ borderColor: LINE }}>
          {preps.map((p) => (
            <li key={p.id} style={{ borderColor: LINE }}>
              <button type="button" onClick={() => setOpen(p)} className={`flex min-h-[56px] w-full flex-wrap items-center gap-x-4 gap-y-0.5 py-2 text-left ${RING}`} aria-label={`${p.name}: open its recipe`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{p.name}</span>
                  <span className="block text-[13px]" style={{ color: MUTED }}>{makesWords(p)}{p.keepsDays ? `, keeps ${p.keepsDays} day${p.keepsDays === 1 ? '' : 's'}` : ''}{p.left !== null ? `. ${amt(p.left)} ${p.unit} on the shelf` : ''}</span>
                </span>
                <span className="text-right text-[13.5px] tabular-nums">{p.batchCost === null ? <span style={{ color: AMBER }}>Cost not known yet</span>
                  : <><span className="block font-semibold">{money(p.batchCost)} a batch</span><span className="block" style={{ color: MUTED }}>{p.unitCost !== null ? perPortion(p.unitCost, p.unit) : ''}</span></>}</span>
              </button>
            </li>))}
        </ul>
      )}
      {open && <PrepSheet prep={open === 'new' ? null : open} call={call} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} />}
    </section>
  );
}

function PrepSheet({ prep, call, onClose, onSaved }: { prep: PrepRow | null; call: (body: any) => Promise<any>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(prep?.name || '');
  const [makes, setMakes] = useState(prep ? String(prep.makes) : '');
  const [unit, setUnit] = useState(prep?.unit || 'L');
  const [keeps, setKeeps] = useState(prep?.keepsDays ? String(prep.keepsDays) : '');
  const [mins, setMins] = useState(prep?.minutes ? String(prep.minutes) : '');
  const [lines, setLines] = useState<EditLine[]>(() => (prep?.recipe || []).map(toEditLine));
  const [stock, setStock] = useState<Ingredient[] | null>(null);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(''); const [removing, setRemoving] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { void call({ action: 'ingredients' }).then((d: any) => { if (d.ok) setStock((d.ingredients || []).filter((x: Ingredient) => x.id !== prep?.id)); }); }, [call, prep?.id]);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = was; opener?.focus?.(); };
  }, []);
  const units = useMemo(() => Array.from(new Set([unit, ...VOLUMES.filter((u) => !['tsp', 'tbsp', 'fl oz', 'cup', 'pt'].includes(u)), ...WEIGHTS, ...PREP_COUNTS])), [unit]);
  const save = async () => {
    if (!name.trim()) { setErr('Give it a name, like House aioli.'); return; }
    if (!(Number(makes) > 0)) { setErr('What does one batch make? Type an amount, like 2.'); return; }
    if (!lines.length) { setErr('Add what goes into a batch.'); return; }
    const none = lines.find((l) => !(Number(l.q) > 0)); if (none) { setErr(`How much ${none.name} goes in? Type an amount.`); return; }
    setSaving(true); setErr('');
    const d = await call({ action: 'prep', ...(prep ? { prepId: prep.id } : {}), name: name.trim(), makes: Number(makes), unit, keepsDays: keeps, minutes: mins, recipe: lines.map(toSaveLine) });
    setSaving(false); if (d.ok) onSaved(); else setErr(d.error || 'That didn’t save.');
  };
  const remove = async () => {
    setSaving(true); setErr('');
    const d = await call({ action: 'prepRemove', prepId: prep!.id });
    setSaving(false); if (d.ok) onSaved(); else { setRemoving(false); setErr(d.error || 'That didn’t go through.'); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="prep-edit-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[#fff] p-6 sm:max-w-2xl sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="prep-edit-title" className="text-[22px] font-semibold">{prep ? prep.name : 'New prep recipe'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
        </div>
        <div className="mt-4 space-y-5">
          <label className="block"><span className="text-[14px] font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="House aioli, Tomato soup, Pizza dough" className={field} style={{ borderColor: LINE }} /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><span className="text-[14px] font-medium" id="makes-l">A batch makes</span>
              <div className="mt-1.5 flex gap-2" role="group" aria-labelledby="makes-l">
                <input inputMode="decimal" value={makes} onChange={(e) => setMakes(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} placeholder="2" aria-label="How much a batch makes" className="min-h-[44px] w-20 min-w-0 flex-1 rounded-xl border bg-[#fff] px-3 text-[16px] tabular-nums outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
                <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Counted in" className="min-h-[44px] w-28 rounded-xl border bg-[#fff] px-2 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }}>
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </div></div>
            <label><span className="text-[14px] font-medium">Keeps for <span style={{ color: MUTED }}>(days)</span></span>
              <input inputMode="numeric" value={keeps} onChange={(e) => setKeeps(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="Optional" className={field} style={{ borderColor: LINE }} /></label>
            <label><span className="text-[14px] font-medium">Takes <span style={{ color: MUTED }}>(minutes)</span></span>
              <input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Optional" className={field} style={{ borderColor: LINE }} /></label>
          </div>
          <RecipeEditor lines={lines} onChange={setLines} stock={stock} ownId={prep?.id || ''} batch={Number(makes) > 0 ? { makes: Number(makes), unit } : null}
            title="What goes into a batch" intro="As you measure it. Making a batch on the Prep page takes these off stock, and puts what it makes on the shelf." />
          {prep && prep.left !== null && prep.left > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>{amt(prep.left)} {prep.unit} on the shelf now. Changing what a batch makes keeps it, turned into the new measure.</p>}
          {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={saving} className={`${BTN} flex-1`} style={{ background: INK, color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={onClose} className={BTN} style={{ border: `1px solid ${LINE}` }}>Cancel</button>
          </div>
          {prep && (removing
            ? <div className="flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3" style={{ background: SOFT }}>
                <span className="min-w-0 flex-1 text-[14px]">Put {prep.name} away? Its history stays.</span>
                <button type="button" onClick={remove} disabled={saving} className={BTN} style={{ background: RED, color: '#fff' }}>Put it away</button>
                <button type="button" onClick={() => setRemoving(false)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Keep it</button>
              </div>
            : <button type="button" onClick={() => setRemoving(true)} className={`${BTN} px-0 underline underline-offset-4`} style={{ color: RED }}>Put this prep recipe away</button>)}
        </div>
      </div>
    </div>
  );
}
