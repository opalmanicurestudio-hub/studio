'use client';
// src/components/menu/ChoiceSetsPanel.tsx — CHOICE SETS on the Menu page (lib/choice-sets, lib/choice-sets-server; api/menu
// 'sets', 'setSave', 'setApply', 'setOff', 'setFrom', 'setRemove', 'setSoldOut'; design canvas "Food numbers": Choice sets).
// Milk, Syrups, Shots, Bread, Leave out: each made once, then turned on for every item that has it. Changing one changes
// it on all of them; sold out on one of its options is sold out everywhere. Choices the same on several items already
// are offered as a set, in a tap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_OPTIONS } from '@/lib/menu-choices';
import { SET_KINDS, type ChoiceSet, type SetKind } from '@/lib/choice-sets';
import { changeWords, type ChoiceChange } from '@/lib/choice-recipe';
import { OptionChanges } from '@/components/menu/ChoicesEditor';
import type { Ingredient } from '@/components/menu/RecipeEditor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#fff] px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const FIELD = `min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15.5px] outline-none focus:border-[#16171a]`;
let n = 0; const nid = () => `n${Date.now().toString(36)}${(n++).toString(36)}`;

type Listed = ChoiceSet & { rule: string; line: string; on: { id: string; name: string; section: string }[] };
type Suggestion = { name: string; rule: string; line: string; itemId: string; groupId: string; count: number; items: string[] };
type Draft = { id?: string; name: string; kind: SetKind; required: boolean; max: number; options: { id: string; name: string; price: string; soldOut: boolean; changes?: ChoiceChange[] }[] };
const draftOf = (s: ChoiceSet): Draft => ({ id: s.id, name: s.name, kind: s.kind, required: s.required, max: s.max, options: s.options.map((o) => ({ id: o.id, name: o.name, price: o.price.toFixed(2), soldOut: o.soldOut, ...(o.changes?.length ? { changes: o.changes } : {}) })) });

export function ChoiceSetsPanel({ call, openId, onOpened, onChanged }: { call: (body: any) => Promise<any>; openId?: string | null; onOpened?: () => void; onChanged?: () => void }) {
  const [sets, setSets] = useState<Listed[] | null>(null); const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [items, setItems] = useState<{ id: string; name: string; section: string }[]>([]);
  const [stock, setStock] = useState<Ingredient[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null); const [picking, setPicking] = useState(false); const [picked, setPicked] = useState<string[]>([]);
  const [section, setSection] = useState(''); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState(''); const [said, setSaid] = useState('');
  const [removing, setRemoving] = useState(false);
  const editor = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const d = await call({ action: 'sets' });
    if (!d.ok) { setErr(d.error || 'The sets didn’t load.'); return null; }
    setSets(d.sets); setSugg(d.suggestions || []); setItems(d.items || []); return d.sets as Listed[];
  }, [call]);
  useEffect(() => { void load(); void call({ action: 'ingredients' }).then((d: any) => { if (d.ok) setStock(d.ingredients || []); }); }, [load, call]);
  // Opened from an item's editor ("Change it for every item").
  useEffect(() => { if (!openId || !sets) return; const s = sets.find((x) => x.id === openId); if (s) { open(s); onOpened?.(); } }, [openId, sets]); // eslint-disable-line react-hooks/exhaustive-deps

  const listed = draft?.id ? sets?.find((x) => x.id === draft.id) || null : null;
  const sections = Array.from(new Set(items.map((i) => i.section)));
  const open = (s: Listed | null) => {
    setErr(''); setSaid(''); setPicking(false); setPicked([]); setRemoving(false);
    setDraft(s ? draftOf(s) : { name: '', kind: 'one', required: true, max: 1, options: [{ id: nid(), name: '', price: '0.00', soldOut: false }] });
    setTimeout(() => editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const setO = (k: number, patch: Partial<Draft['options'][number]>) => setDraft((d) => (d ? { ...d, options: d.options.map((o, j) => (j === k ? { ...o, ...patch } : o)) } : d));
  const moveO = (k: number, by: -1 | 1) => setDraft((d) => { if (!d) return d; const j = k + by; if (j < 0 || j >= d.options.length) return d; const o = d.options.slice(); [o[k], o[j]] = [o[j], o[k]]; return { ...d, options: o }; });

  const save = async () => {
    if (!draft) return; setBusy('save'); setErr(''); setSaid('');
    const d = await call({ action: 'setSave', set: { ...draft, options: draft.options.filter((o) => o.name.trim()).map((o) => ({ id: o.id, name: o.name, price: draft.kind === 'leaveout' ? 0 : o.price, changes: o.changes || [] })) } });
    setBusy(null); if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    const all = await load(); const s = all?.find((x) => x.id === d.set.id);
    if (s) setDraft(draftOf(s));
    setSaid(d.items ? `${d.set.name} is saved, and changed on ${d.items} ${d.items === 1 ? 'item' : 'items'}.` : `${d.set.name} is saved. Put it on the items that have it below.`); onChanged?.();
  };
  const apply = async (ids: string[], what: string) => {
    if (!draft?.id || !ids.length) return; setBusy('apply'); setErr(''); setSaid('');
    const d = await call({ action: 'setApply', setId: draft.id, itemIds: ids }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    await load(); setPicking(false); setPicked([]); onChanged?.();
    setSaid(`${draft.name} is on ${d.added} more ${d.added === 1 ? 'item' : 'items'}${what}.${d.full?.length ? ` ${d.full.length} already ${d.full.length === 1 ? 'has' : 'have'} as many choices as an item can, so ${d.full.length === 1 ? 'it was' : 'they were'} left as they are.` : ''}`);
  };
  const off = async (itemId: string, name: string) => {
    if (!draft?.id) return; setBusy(`off-${itemId}`); setErr('');
    const d = await call({ action: 'setOff', setId: draft.id, itemId }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    await load(); onChanged?.(); setSaid(`${draft.name} is off ${name}.`);
  };
  const soldOut = async (optionId: string, out: boolean, name: string) => {
    if (!draft?.id) return; setBusy(`so-${optionId}`); setErr('');
    const d = await call({ action: 'setSoldOut', setId: draft.id, optionId, out }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    setDraft((x) => (x ? { ...x, options: x.options.map((o) => (o.id === optionId ? { ...o, soldOut: out } : o)) } : x));
    await load(); onChanged?.(); setSaid(out ? `${name} is sold out on ${d.items} ${d.items === 1 ? 'item' : 'items'}, until the morning.` : `${name} is back on ${d.items} ${d.items === 1 ? 'item' : 'items'}.`);
  };
  const fromGroup = async (x: Suggestion) => {
    setBusy(`from-${x.groupId}`); setErr(''); setSaid('');
    const d = await call({ action: 'setFrom', itemId: x.itemId, groupId: x.groupId }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    const all = await load(); onChanged?.(); setSaid(`${d.set.name} is a set now, on ${d.items} ${d.items === 1 ? 'item' : 'items'}. Change it once here and it changes on all of them.`);
    const s = all?.find((y) => y.id === d.set.id); if (s) open(s);
  };
  const remove = async () => {
    if (!draft?.id) return; setBusy('remove'); setErr('');
    const d = await call({ action: 'setRemove', setId: draft.id }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    const name = draft.name; setDraft(null); await load(); onChanged?.(); setSaid(`${name} isn’t a set any more. ${d.items ? `The ${d.items} ${d.items === 1 ? 'item' : 'items'} with it keep it as a choice of their own.` : ''}`);
  };

  const kindWords = SET_KINDS.find((k) => k.id === draft?.kind)?.words || '';
  const notOn = items.filter((i) => !listed?.on.some((x) => x.id === i.id));
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4 min-w-0">
        {said && <p role="status" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: GREEN_TINT, color: GREEN }}>{said}</p>}
        {err && !draft && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {sugg.map((x) => (
          <div key={`${x.itemId}/${x.groupId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-[#fff] px-4 py-3" style={{ borderColor: LINE }}>
            <p className="min-w-0 flex-1 text-[14px] leading-snug"><b className="font-semibold">{x.name}</b> is on {x.count} items, the same each time ({x.items.slice(0, 4).join(', ')}{x.count > 4 ? ` and ${x.count - 4} more` : ''}). <span style={{ color: MUTED }}>As a set, it’s changed in one place.</span></p>
            <button type="button" onClick={() => void fromGroup(x)} disabled={busy === `from-${x.groupId}`} className={`${BTN} text-[#fff]`} style={{ background: INK }}>{busy === `from-${x.groupId}` ? 'Making it…' : `Make ${x.name} a set`}</button>
          </div>))}
        <section aria-labelledby="sets-title" className="rounded-3xl border bg-[#fff] px-3 pb-2 pt-4 sm:px-4" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-1 pb-2">
            <div><h2 id="sets-title" className="text-[17px] font-semibold">Choice sets</h2>
              <p className="text-[13px]" style={{ color: MUTED }}>Made once, used on every item you turn them on for.</p></div>
            <button type="button" onClick={() => open(null)} className={`${BTN} text-[#fff]`} style={{ background: INK }}>New set</button>
          </div>
          {!sets ? <div className="h-24" aria-busy="true" /> : sets.length === 0 ? <p className="px-1 pb-3 text-[14px]" style={{ color: MUTED }}>No sets yet. Make one for each choice several items share: Milk, Syrups, Sizes, Bread, Leave out.</p> : (
            <ul>{sets.map((x) => { const out = x.options.filter((o) => o.soldOut).map((o) => o.name); const sel = draft?.id === x.id;
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => open(x)} aria-current={sel ? 'true' : undefined} className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left ${RING}`} style={sel ? { boxShadow: `inset 0 0 0 2px ${INK}` } : { borderBottom: `1px solid ${LINE}` }}>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold">{x.name} <span className="ml-1 text-[13px] font-normal" style={{ color: MUTED }}>{x.rule}</span></span>
                      <span className="mt-0.5 block text-[13.5px] leading-snug">{x.line}{out.length > 0 && <span className="ml-1.5 inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{out.join(', ')} sold out</span>}</span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[13px]" style={{ color: MUTED }}>{x.on.length ? `On ${x.on.length} ${x.on.length === 1 ? 'item' : 'items'}` : 'On nothing yet'}</span>
                  </button>
                </li>); })}</ul>)}
        </section>
        <div className="grid gap-3 sm:grid-cols-3">
          {SET_KINDS.map((k) => <div key={k.id} className="rounded-2xl border bg-[#fff] px-4 py-3" style={{ borderColor: LINE }}><p className="text-[14px] font-semibold">{k.label}</p><p className="mt-0.5 text-[13px] leading-snug" style={{ color: MUTED }}>{k.words}</p></div>)}
        </div>
      </div>

      {draft && (
        <section ref={editor} aria-labelledby="set-edit-title" className="scroll-mt-4 space-y-3 rounded-3xl border bg-[#fff] p-4 sm:p-5 lg:sticky lg:top-4" style={{ borderColor: LINE }}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 id="set-edit-title" className="text-[18px] font-semibold">{draft.id ? draft.name || 'The set' : 'New set'}</h2>
              {listed && <p className="text-[13px]" style={{ color: MUTED }}>{listed.rule}. On {listed.on.length} {listed.on.length === 1 ? 'item' : 'items'}.</p>}</div>
            <button type="button" onClick={() => setDraft(null)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Close</button>
          </div>
          <label className="block"><span className="text-[13.5px] font-semibold">Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 40) })} placeholder="Milk, Syrups, Bread" className={`${FIELD} mt-1 w-full`} style={{ borderColor: LINE }} /></label>
          <div role="radiogroup" aria-label="What kind of choice" className="flex flex-wrap gap-2">
            {SET_KINDS.map((k) => <button key={k.id} type="button" role="radio" aria-checked={draft.kind === k.id} onClick={() => setDraft({ ...draft, kind: k.id, required: k.id === 'one', max: k.id === 'one' ? 1 : Math.max(1, draft.options.length) })}
              className={`min-h-[44px] rounded-xl border px-3.5 text-[14px] font-semibold ${RING}`} style={draft.kind === k.id ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{k.label}</button>)}
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>{kindWords}</p>
          {draft.kind === 'one' && <label className="flex min-h-[44px] items-center gap-3 text-[14.5px]"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />They must pick one</label>}
          {draft.kind === 'addons' && <label className="flex min-h-[44px] items-center gap-2 text-[14.5px]">Up to
            <select value={Math.min(draft.max, Math.max(1, draft.options.length))} onChange={(e) => setDraft({ ...draft, max: Number(e.target.value) })} className={FIELD} style={{ borderColor: LINE }}>
              {Array.from({ length: Math.max(1, draft.options.length) }, (_, k) => k + 1).map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <span style={{ color: MUTED }}>of these</span></label>}
          <ul className="space-y-2">
            {draft.options.map((o, k) => (
              <li key={o.id} className="space-y-1.5 rounded-2xl p-2.5" style={{ background: o.soldOut ? AMBER_TINT : SOFT }}>
                <div className="flex items-center gap-2">
                  <input value={o.name} onChange={(e) => setO(k, { name: e.target.value.slice(0, 40) })} placeholder={draft.kind === 'leaveout' ? 'No onions' : 'Oat, Vanilla, Extra shot'} aria-label={`Option ${k + 1}`} className={`${FIELD} min-w-0 flex-1`} style={{ borderColor: LINE }} />
                  {draft.kind !== 'leaveout' && <span className="relative w-24 shrink-0"><span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }}>$</span>
                    <input inputMode="decimal" value={o.price} onChange={(e) => setO(k, { price: e.target.value.replace(/[^0-9.\-]/g, '').slice(0, 8) })} aria-label={`What ${o.name || 'this option'} adds`} className={`${FIELD} w-full pl-6`} style={{ borderColor: LINE }} /></span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => moveO(k, -1)} disabled={k === 0} aria-label={`Move ${o.name || 'this option'} up`} className={`h-11 w-11 rounded-xl border bg-[#fff] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↑</button>
                  <button type="button" onClick={() => moveO(k, 1)} disabled={k === draft.options.length - 1} aria-label={`Move ${o.name || 'this option'} down`} className={`h-11 w-11 rounded-xl border bg-[#fff] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↓</button>
                  {draft.id && listed?.options.some((x) => x.id === o.id) && <button type="button" onClick={() => void soldOut(o.id, !o.soldOut, o.name)} disabled={busy === `so-${o.id}`} aria-pressed={o.soldOut} className={`min-h-[44px] rounded-xl border px-3 text-[13.5px] font-semibold ${RING}`} style={o.soldOut ? { background: AMBER, color: '#fff', borderColor: AMBER } : { background: '#fff', borderColor: LINE }}>{o.soldOut ? 'Sold out' : 'Mark sold out'}</button>}
                  <button type="button" onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== k) })} aria-label={`Remove ${o.name || 'this option'}`} className={`ml-auto min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[13.5px] ${RING}`} style={{ borderColor: LINE, color: MUTED }}>Remove</button>
                </div>
                {stock && <OptionChanges name={o.name || 'This option'} changes={o.changes || []} onChange={(changes) => setO(k, { changes })} recipe={[]} stock={stock} anyStock />}
                {!stock && (o.changes || []).length > 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>{(o.changes || []).map(changeWords).join('; ')}</p>}
              </li>))}
          </ul>
          {draft.options.length < MAX_OPTIONS && <button type="button" onClick={() => setDraft({ ...draft, options: [...draft.options, { id: nid(), name: '', price: '0.00', soldOut: false }] })} className={BTN} style={{ border: `1px solid ${LINE}` }}>Add an option</button>}
          <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>{draft.kind === 'one' ? 'It starts on the first one. ' : ''}A recipe change is kept on each item only where it fits its recipe: oat instead of whole milk does nothing on a drink with no milk.</p>
          {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy === 'save'} className={`${BTN} flex-1 text-[#fff]`} style={{ background: INK }}>{busy === 'save' ? 'Saving…' : listed?.on.length ? `Save, on all ${listed.on.length}` : 'Save'}</button>
          </div>

          {listed && <div className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
            <p className="text-[14px] font-semibold">On these items</p>
            {listed.on.length ? <ul className="flex flex-wrap gap-1.5">{listed.on.map((i) => (
              <li key={i.id} className="flex items-center gap-1 rounded-full py-0.5 pl-3 pr-0.5 text-[13px]" style={{ background: SOFT }}>{i.name}
                <button type="button" onClick={() => void off(i.id, i.name)} disabled={busy === `off-${i.id}`} aria-label={`Take ${listed.name} off ${i.name}`} className={`h-11 w-11 rounded-full text-[16px] ${RING}`} style={{ color: MUTED }}>×</button></li>))}</ul>
              : <p className="text-[13px]" style={{ color: MUTED }}>Not on any item yet.</p>}
            {notOn.length > 0 && <div className="flex flex-wrap items-center gap-2">
              <select value={section || sections[0] || ''} onChange={(e) => setSection(e.target.value)} aria-label="Which section" className={FIELD} style={{ borderColor: LINE }}>{sections.map((x) => <option key={x} value={x}>{x}</option>)}</select>
              <button type="button" onClick={() => { const sec = section || sections[0]; void apply(notOn.filter((i) => i.section === sec).map((i) => i.id), ` in ${sec}`); }} disabled={busy === 'apply' || !notOn.some((i) => i.section === (section || sections[0]))} className={BTN} style={{ border: `1px solid ${LINE}` }}>Add to every item in it</button>
              <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className={BTN} style={{ border: `1px solid ${LINE}` }}>Pick items</button>
            </div>}
            {picking && <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">{notOn.map((i) => (
                <label key={i.id} className="flex min-h-[44px] items-center gap-3 text-[14px]"><input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, i.id] : xs.filter((y) => y !== i.id)))} className="h-5 w-5 accent-[#16171a]" />{i.name} <span style={{ color: MUTED }}>{i.section}</span></label>))}</div>
              <button type="button" onClick={() => void apply(picked, '')} disabled={!picked.length || busy === 'apply'} className={`${BTN} text-[#fff]`} style={{ background: INK }}>{busy === 'apply' ? 'Adding…' : `Add to ${picked.length || ''} ${picked.length === 1 ? 'item' : 'items'}`}</button>
            </div>}
          </div>}

          {draft.id && <div className="border-t pt-3" style={{ borderColor: LINE }}>
            {!removing ? <button type="button" onClick={() => setRemoving(true)} className={`min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Stop using it as a set</button>
              : <div className="space-y-2"><p className="text-[13.5px]">The items with it keep it as a choice of their own, changed one item at a time.</p>
                <div className="flex gap-2"><button type="button" onClick={() => void remove()} disabled={busy === 'remove'} className={BTN} style={{ border: `1px solid ${LINE}` }}>{busy === 'remove' ? 'Stopping…' : 'Stop using it'}</button>
                  <button type="button" onClick={() => setRemoving(false)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Keep it</button></div></div>}
          </div>}
        </section>
      )}
    </div>
  );
}
