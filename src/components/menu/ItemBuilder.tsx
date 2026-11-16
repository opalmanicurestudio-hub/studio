'use client';
// src/components/menu/ItemBuilder.tsx — BUILDING A MENU ITEM, STEP BY STEP (design canvas "Food numbers": Menu builder).
// One step at a time instead of one long form, with what the guest sees beside it the whole way, and what the business
// keeps on one as it's picked there:
//   1 The basics       its name, price and section, a photo and a line guests read; on the menu, members only
//   2 Sizes            one size, or sizes with what each adds to the price (and to the recipe: a 16 oz uses more milk)
//   3 Choices          the business's choice sets turned on or off (lib/choice-sets), and any choice only it has
//   4 What goes in it  its recipe from the business's stock, or, for a combo, the items it always has
//   5 Where and when   what it contains, where and how long it's made, when it's sold, and the menu board
// Only the basics are needed to sell it; each step says what it adds. Every step is one draft, saved together through
// api/menu 'save' (the server cleans and checks all of it, and takes a set's options from the set itself). The guest's
// view is the guests' own picker (components/menu/ChoicePicker) and prices with priceChoices(), so it reads as they'll
// see it; what one keeps is worked out by the same rules as the server (lib/food-cost costWith).
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { OptionChanges, OwnGroup, STARTERS, groupFromSet, nid, type EditGroup, type SetPick } from '@/components/menu/ChoicesEditor';
import { RecipeEditor, asRecipe, partsOf, toEditLine, toSaveLine, type EditLine, type Ingredient } from '@/components/menu/RecipeEditor';
import type { Service } from '@/components/menu/TableServiceSettings';
import { costWith, linesCost, optionCosts, type OptionCost } from '@/lib/food-cost';
import type { ChoiceChange } from '@/lib/choice-recipe';
import { kindOfGroup, optionsLine, setRule } from '@/lib/choice-sets';
import { choiceGroups, defaultPicks, money, priceChoices, type Picks } from '@/lib/menu-choices';
import type { MenuItem } from '@/lib/menu-server';
import type { RecipeLine } from '@/lib/menu-stock';
import type { Daypart } from '@/lib/menu-time';
import { ALLERGENS, cleanKeys, type AllergenKey } from '@/lib/allergens';
import { uploadImage } from '@/lib/upload-image';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = 'mt-1.5 w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const pickField = 'min-h-[44px] w-36 shrink-0 rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const chip = (on: boolean) => (on ? { background: INK, color: '#fff', fontWeight: 600 } : { border: `1px solid ${LINE}`, fontWeight: 500 });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const takes = (s: number) => (s < 60 ? `${s} seconds` : s % 60 ? mmss(s) : `${s / 60} ${s === 60 ? 'minute' : 'minutes'}`);
const MAKE_TIMES = [30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900];
const HOLD_TIMES = [5, 7, 10, 15, 20, 30, 45, 60, 90, 120];
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** What an amount typed for an option comes to: empty is 0; anything else that isn't a number is asked about. */
const money2 = (v: unknown) => { const t = String(v ?? '').trim(); if (t === '' || t === '-') return 0; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { n: Step; title: string; next: string }[] = [
  { n: 1, title: 'The basics', next: 'the basics' }, { n: 2, title: 'Sizes', next: 'sizes' }, { n: 3, title: 'Choices and add-ons', next: 'choices' },
  { n: 4, title: 'What goes in it', next: 'what goes in it' }, { n: 5, title: 'Where and when', next: 'where and when' },
];
/** The sizes it comes in: a "pick one" choice called Size (or Sizes). */
const isSize = (g: { name: string; pick: string }) => g.pick === 'one' && /^\s*(cup\s+)?sizes?\s*$/i.test(g.name);
const DRINKS = /coffee|tea|drink|espresso|latte|juice|smoothie|shake|cocktail|wine|beer|soda|beverage|\bbar\b/i;
/** What it's called in the words on the page: a drink (its section or station says so), else an item. */
const nounOf = (m: { section?: string | null; station?: string | null }) => (DRINKS.test(`${m.section || ''} ${m.station || ''}`) ? 'drink' : 'item');

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`flex h-11 w-14 shrink-0 items-center justify-center rounded-full ${RING}`}>
      <span aria-hidden className="relative h-[26px] w-[44px] rounded-full transition-colors" style={{ background: on ? GREEN : '#d4d6da' }}>
        <span className="absolute top-[3px] h-5 w-5 rounded-full bg-[#fff] shadow transition-all" style={{ left: on ? 21 : 3 }} />
      </span>
    </button>
  );
}

/** One of the business's choice sets: on this item or not, what it is, and how many items have it. */
function SetRow({ name, rule, line, count, on, open, label, onToggle, onOpen, children }: { name: string; rule: string; line: string; count: string; on: boolean; open: boolean; label: string;
  onToggle: () => void; onOpen: () => void; children?: ReactNode }) {
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-2"><span className="text-[15px] font-semibold">{name}</span><span className="shrink-0 text-[12.5px]" style={{ color: MUTED }}>{count}</span></span>
      <span className="mt-0.5 block text-[13px]" style={{ color: MUTED }}>{rule}</span>
      <span className="mt-1 block text-[13.5px] leading-snug">{line}</span>
    </>
  );
  return (
    <div className="flex items-start gap-2 rounded-2xl py-2 pl-2 pr-4" style={{ border: on && open ? `2px solid ${INK}` : `1px solid ${LINE}`, background: on ? '#fff' : SOFT }}>
      <Toggle on={on} label={label} onClick={onToggle} />
      <div className="min-w-0 flex-1 py-1">
        {on ? <button type="button" onClick={onOpen} aria-expanded={open} className={`block w-full rounded-lg text-left ${RING}`}>{body}</button> : <div>{body}</div>}
        {on && open && children}
      </div>
    </div>
  );
}

export function ItemBuilder({ item, recipe, changes, tenantId, service, dayparts, allItems, sets, aim, startStep = 1, busy, onClose, onSave, onSoldOut, onOpenSet, call }: {
  item: MenuItem; recipe: RecipeLine[]; changes: Record<string, ChoiceChange[]>; tenantId: string | null; service: Service | null; dayparts: Daypart[]; allItems: MenuItem[];
  sets: SetPick[]; /** The food cost it aims for (lib/food-cost targetOf). */ aim: number; startStep?: Step; busy: string | null;
  onClose: () => void; onSave: (patch: any) => Promise<string | null>; onSoldOut: (groupId: string, optionId: string, out: boolean) => void;
  /** Opens a set (or 'new') in the Menu's Choice sets. */ onOpenSet: (setId: string) => void; call: (body: any) => Promise<any> }) {
  const startLines = useMemo<EditLine[]>(() => recipe.map(toEditLine), [recipe]);
  const [lines, setLines] = useState<EditLine[]>(startLines);
  const [stock, setStock] = useState<Ingredient[] | null>(null);
  useEffect(() => { void call({ action: 'ingredients' }).then((d: any) => { if (d.ok) setStock(d.ingredients || []); }); }, [call]);
  const [name, setName] = useState(item.name); const [section, setSection] = useState(item.section); const [words, setWords] = useState(item.words || '');
  const [price, setPrice] = useState(item.price.toFixed(2)); const [onMenu, setOnMenu] = useState(item.onMenu); const [membersOnly, setMembersOnly] = useState(item.membersOnly);
  // The menu board: shown big up front, a tag, and calories (optional).
  const [featured, setFeatured] = useState(!!item.featured); const [badge, setBadge] = useState<string>(item.badge || ''); const [calories, setCalories] = useState(item.calories === null || item.calories === undefined ? '' : String(item.calories));
  // Each option with what it changes in the recipe (lib/choice-recipe), when it does.
  const [groups, setGroups] = useState<EditGroup[]>(item.choices.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: o.price.toFixed(2), ...(changes[`${g.id}/${o.id}`] ? { changes: changes[`${g.id}/${o.id}`] } : {}) })) })));
  const [station, setStation] = useState(item.station || ''); const [course, setCourse] = useState(item.course === null ? '' : String(item.course));
  // Also made at another station, as a part of its own (lib/two-stations): "the fries" at the fryer.
  const [also, setAlso] = useState<{ station: string; part: string }[]>(() => (item.alsoAt || []).map((a) => ({ ...a })));
  // What it contains (lib/allergens) and how many it starts each night with (lib/dish-counts).
  const [allergens, setAllergens] = useState<AllergenKey[] | null>(item.allergensSet ? item.allergens || [] : null); const [daily, setDaily] = useState(item.dailyCount === null || item.dailyCount === undefined ? '' : String(item.dailyCount));
  const [makeSeconds, setMakeSeconds] = useState(item.makeSeconds); const [makeTouched, setMakeTouched] = useState(false); const [held, setHeld] = useState(item.holdMinutes > 0);
  const [holdMinutes, setHoldMinutes] = useState(item.holdMinutes || 10); const [batchSize, setBatchSize] = useState(String(item.batchSize));
  // Its menus by time of day and happy-hour price (lib/menu-time), and as a combo, what's in it (lib/counter-orders).
  const [parts, setParts] = useState<string[]>(item.dayparts || []); const [happy, setHappy] = useState(item.happyPrice === null || item.happyPrice === undefined ? '' : item.happyPrice.toFixed(2));
  const [combo, setCombo] = useState(!!item.combo); const [inIt, setInIt] = useState<string[]>(item.comboParts || []);
  const others = allItems.filter((x) => x.id !== item.id && !x.combo);
  const [photo, setPhoto] = useState<string | null>(item.imageUrl || null); const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState('');

  const [step, setStep] = useState<Step>(startStep); const [seen, setSeen] = useState<Step[]>([startStep]);
  // Its sizes: the "pick one" choice called Size it came with (or the one made in Sizes), kept by its id, so another
  // choice renamed "Size" stays where it is.
  const [sizeId, setSizeId] = useState<string | null>(() => item.choices.find(isSize)?.id || null);
  const [openSet, setOpenSetRow] = useState<string | null>(null); const [addingOwn, setAddingOwn] = useState(false); const [pickingSize, setPickingSize] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  // Tonight's sold-out switches (they act straight away, saved or not), and on a phone, the guest's view, each opened.
  const [outOpen, setOutOpen] = useState(false); const [peek, setPeek] = useState(false);
  const outNames = item.choices.flatMap((g) => g.options.filter((o) => o.soldOut).map((o) => o.name));
  // Leaving with changes not saved: asked first (closing, or opening a set to change it for every item).
  const [leaving, setLeaving] = useState<null | { to: 'close' } | { to: 'set'; id: string }>(null);
  const shell = useRef<HTMLDivElement | null>(null); const head = useRef<HTMLHeadingElement | null>(null); const phoneSteps = useRef<HTMLElement | null>(null);
  const noun = nounOf({ section, station: station || item.station });

  const snap = JSON.stringify([name, section, words, price, onMenu, membersOnly, featured, badge, calories, photo, groups, station, course, also, allergens, daily, makeSeconds, held, holdMinutes, batchSize, parts, happy, combo, inIt, lines]);
  const first = useRef(snap); const dirty = snap !== first.current;

  // The recipe and the choices as they stand here, priced and costed by the server's own rules.
  const stockParts = useMemo(() => partsOf(stock), [stock]);
  const formula = useMemo(() => (stock ? asRecipe(lines, stockParts) : []), [stock, lines, stockParts]);
  // What's sold out tonight is the item's as it is now (Sold out tonight acts straight away), not as it was when opened.
  const liveOut = useMemo(() => new Map(item.choices.flatMap((g) => g.options.map((o) => [`${g.id}/${o.id}`, o.soldOut] as [string, boolean]))), [item.choices]);
  const outOf = (gid: string, o: { id: string; soldOut: boolean }) => liveOut.get(`${gid}/${o.id}`) ?? o.soldOut;
  const draft = useMemo(() => ({ id: item.id, name, price: Number(price) || 0, words, formula,
    choices: groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, soldOut: liveOut.get(`${g.id}/${o.id}`) ?? o.soldOut, price: Number.isNaN(money2(o.price)) ? 0 : money2(o.price) })) })) }), [item.id, name, price, words, formula, groups, liveOut]);
  const baseCost = useMemo(() => (formula.length ? linesCost(formula, stockParts) : null), [formula, stockParts]);
  // What each choice costs and keeps (lib/food-cost optionCosts): only for an item made from a recipe, whose cost is known.
  const optCosts = useMemo<Record<string, OptionCost>>(() => (!baseCost ? {} : Object.fromEntries(optionCosts(item.id, draft, stockParts, baseCost.cost).map((c) => [`${c.groupId}/${c.optionId}`, c]))), [baseCost, draft, stockParts, item.id]);

  const sizeIdx = sizeId ? groups.findIndex((g) => g.id === sizeId) : -1; const sizeG = sizeIdx >= 0 ? groups[sizeIdx] : null;
  /** Its sizes, made here: first among its choices. */
  const addSizes = (g: EditGroup) => { setSizeId(g.id); setGroups((gs) => [g, ...gs]); };
  const ownSizes = (): EditGroup => ({ id: nid(), name: 'Size', pick: 'one', required: true, max: 1, options: [{ id: nid(), name: 'Small', price: '0.00', soldOut: false }, { id: nid(), name: 'Large', price: '0.50', soldOut: false }] });
  const sizeSets = sets.filter((s) => s.kind === 'one' && isSize({ name: s.name, pick: 'one' }));
  const byId = useMemo(() => new Map(sets.map((s) => [s.id, s])), [sets]);
  /** How many items a set is on, with this one as it stands here. */
  const onCount = (setId: string) => {
    const on = allItems.filter((x) => x.id !== item.id && x.choices.some((g) => g.setId === setId)).map((x) => nounOf(x));
    if (groups.some((g) => g.setId === setId)) on.push(noun);
    if (!on.length) return 'Not on any item yet';
    const w = on.every((x) => x === 'drink') ? 'drink' : 'item'; return `On ${on.length} ${w}${on.length === 1 ? '' : 's'}`;
  };
  const setG = (i: number, patch: Partial<EditGroup>) => setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const dropG = (i: number) => setGroups((gs) => gs.filter((_, k) => k !== i));
  /** Moved among its choices (sizes stay first). */
  const moveG = (i: number, d: -1 | 1) => setGroups((gs) => { const order = gs.map((_, k) => k).filter((k) => gs[k].id !== sizeId); const at = order.indexOf(i); const j = order[at + d]; if (j === undefined) return gs; const next = gs.slice(); [next[i], next[j]] = [next[j], next[i]]; return next; });
  const ruleOf = (g: EditGroup) => setRule({ kind: kindOfGroup({ name: g.name, pick: g.pick, options: g.options.map((o) => ({ price: Number(o.price) || 0 })) }), required: g.required, max: g.max, options: g.options as any });
  const lineOf = (g: EditGroup) => optionsLine({ options: g.options.map((o) => ({ ...o, price: Number(o.price) || 0 })) as any });

  const go = (n: Step) => { setStep(n); setSeen((s) => (s.includes(n) ? s : [...s, n])); setErr(''); };
  useEffect(() => { shell.current?.scrollTo({ top: 0 }); head.current?.focus({ preventScroll: true }); phoneSteps.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [step]);
  // Mid-save it waits: the save closes it, or says what's wrong.
  const tryClose = () => { if (saving) return; if (dirty) setLeaving({ to: 'close' }); else onClose(); };
  const toSet = (id: string) => (dirty ? setLeaving({ to: 'set', id }) : onOpenSet(id));
  const closeRef = useRef(tryClose); closeRef.current = leaving ? () => setLeaving(null) : tryClose;
  // What had the focus when it opened (read before the first step's heading takes it), given it back on close.
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  const leaveFirst = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (leaving) leaveFirst.current?.focus(); }, [leaving]);
  useEffect(() => {
    const back = opener.current;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); }; document.addEventListener('keydown', k);
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = was; back?.focus?.(); };
  }, []);

  // A photo is made smaller on this device before it's uploaded (a phone photo becomes a few hundred KB), then kept with
  // the business's product photos. It's saved onto the item only with Save.
  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f || !tenantId || uploading) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setErr('Use a JPEG, PNG or WebP photo.'); return; }
    if (f.size > 25 * 1024 * 1024) { setErr('That photo is too big. Use one under 25 MB.'); return; }
    setUploading(true); setErr('');
    try {
      const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      setPhoto(await uploadImage(`tenants/${tenantId}/products/menu-${item.id}-${Date.now()}.${ext}`, f, 900));
    } catch { setErr('That photo didn’t upload. Check the connection and try again.'); }
    finally { setUploading(false); }
  };

  /** Everything saved together. What isn't right is asked about on the step it's on. */
  const save = async (): Promise<boolean> => {
    const stop = (n: Step, e: string) => { go(n); setErr(e); return false; };
    if (String(price).trim() === '' || !Number.isFinite(Number(price))) return stop(1, 'What does it cost? Type a price, like 4.50.');
    for (const g of groups) { const bad = g.options.find((o) => Number.isNaN(money2(o.price))); if (bad) return stop(g.id === sizeId ? 2 : 3, `What does ${bad.name || 'that option'} add? Type an amount, like 0.75, or leave it at 0.`); }
    const noAmount = lines.find((l) => !(Number(l.q) > 0));
    if (noAmount) return stop(4, `How much ${noAmount.name} goes into one? Type an amount, like 1 or 0.5.`);
    const batch = Math.floor(Number(batchSize));
    if (held && !(batch >= 1 && batch <= 200)) return stop(5, 'How many in a batch? Between 1 and 200.');
    // The recipe is saved only when it was changed here (one left alone is kept as it is).
    // (Saved again, too, when an ingredient is now counted in another unit, so the recipe says what it's measured in.)
    const recipeChanged = JSON.stringify(lines.map((l) => [l.id, Number(l.q), l.measure])) !== JSON.stringify(startLines.map((l) => [l.id, Number(l.q), l.measure]))
      || lines.some((l) => { const x = stock?.find((y) => y.id === l.id); return !!x && x.unit !== l.unit; });
    setSaving(true); setErr('');
    const e = await onSave({ name, section, words, price: Number(price), onMenu, membersOnly, featured, badge: badge || null, calories: calories.trim() === '' ? null : Number(calories), ...(photo !== (item.imageUrl || null) ? { imageUrl: photo } : {}), choices: groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: money2(o.price) })) })),
      // Timing is saved only when it's set here (an item left alone keeps the kitchen's default, not a copy of it).
      ...(makeTouched ? { makeSeconds } : {}), ...(station !== (item.station || '') ? { station: station || null } : {}), ...(course !== (item.course === null ? '' : String(item.course)) ? { course: course === '' ? null : Number(course) } : {}), ...(held || item.holdMinutes > 0 ? { holdMinutes: held ? holdMinutes : 0 } : {}), ...(held ? { batchSize: batch } : {}),
      ...(recipeChanged ? { recipe: lines.map(toSaveLine) } : {}),
      ...(allergens !== null && JSON.stringify(allergens) !== JSON.stringify(item.allergensSet ? item.allergens || [] : null) ? { allergens } : {}),
      ...(daily !== (item.dailyCount === null || item.dailyCount === undefined ? '' : String(item.dailyCount)) ? { dailyCount: daily === '' ? null : Number(daily) } : {}),
      ...(JSON.stringify(parts) !== JSON.stringify(item.dayparts || []) ? { dayparts: parts } : {}),
      ...(JSON.stringify(also) !== JSON.stringify(item.alsoAt || []) ? { alsoAt: also.map((a) => ({ station: a.station, part: a.part.trim() })) } : {}),
      ...(happy !== (item.happyPrice === null || item.happyPrice === undefined ? '' : item.happyPrice.toFixed(2)) ? { happyPrice: happy === '' ? null : Number(happy) } : {}),
      ...(combo !== !!item.combo || JSON.stringify(inIt) !== JSON.stringify(item.comboParts || []) ? { combo, comboParts: combo ? inIt : [] } : {}) });
    setSaving(false); if (e) { setErr(e); return false; } return true;
  };

  // Each step's line on the left: what's set so far, in a few words.
  const otherGroups = groups.filter((g) => g.id !== sizeId);
  const allergenWords = (allergens || []).map((k) => (ALLERGENS.find((a) => a.key === k)?.label || k).toLowerCase());
  const summary: Record<Step, string> = {
    1: `${[name.trim() || 'No name yet', Number(price) > 0 ? money(Number(price)) : 'no price yet', section.trim() || 'no section'].join(', ')}.${photo && words.trim() ? ' A photo and a line guests read.' : photo ? ' A photo.' : words.trim() ? ' A line guests read.' : ''}${onMenu ? '' : ' Not on the menu yet.'}`,
    2: sizeG ? `${andList(sizeG.options.filter((o) => o.name.trim()).map((o) => (Number(o.price) ? `${o.name} (${Number(o.price) > 0 ? '+' : ''}${money(Number(o.price))})` : o.name)))}.${sizeG.options.some((o) => o.changes?.length) ? ' The recipe grows with the size.' : ''}` : 'One size.',
    3: otherGroups.length ? `${andList(otherGroups.map((g, k) => (k ? g.name.toLowerCase() : g.name)).filter(Boolean))}.` : 'None yet.',
    4: combo ? `A combo${inIt.length ? `: ${andList(inIt.map((id) => others.find((x) => x.id === id)?.name || '').filter(Boolean))}` : ''}.`
      : lines.length ? `${andList(lines.slice(0, 4).map((l, k) => (k ? l.name.toLowerCase() : l.name)))}${lines.length > 4 ? ' and more' : ''}${baseCost?.cost !== null && baseCost?.cost !== undefined ? `: costs you ${money(baseCost.cost)}` : ''}.` : 'Nothing yet. With it, stock and cost follow each one sold.',
    5: `${station ? `Made at ${station.toLowerCase().startsWith('the ') ? station : `the ${station.toLowerCase()}`}` : 'Made where its section goes'}, ${takes(makeSeconds)}, ${parts.length ? andList(dayparts.filter((d) => parts.includes(d.id)).map((d) => d.name)) : 'all day'}.${allergens === null ? ' Allergens not said yet.' : allergens.length ? ` Contains ${andList(allergenWords)}.` : ' None of the major allergens.'}`,
  };
  const done = (n: Step) => (n === 1 ? !!name.trim() && Number(price) > 0 : n === 2 ? !!sizeG || seen.includes(2) : n === 3 ? otherGroups.length > 0 || seen.includes(3) : n === 4 ? lines.length > 0 || combo : seen.includes(5) || allergens !== null);
  const at = STEPS.find((s) => s.n === step)!; const nextStep = STEPS.find((s) => s.n === step + 1);

  // What the guest sees: their own picker, starting where theirs starts, and the price as it's picked.
  const guestGroups = useMemo(() => choiceGroups(draft), [draft]);
  const shown = useMemo<Picks>(() => {
    const out: Picks = { ...defaultPicks(draft) };
    for (const g of guestGroups) { const v = picks[g.id]; if (!v) continue; const ok = v.filter((id) => g.options.some((o) => o.id === id)); if (ok.length || !g.required) out[g.id] = ok; }
    return out;
  }, [draft, guestGroups, picks]);
  const priced = priceChoices(draft, shown);
  const total = Math.max(0, Math.round(((Number(price) || 0) + (priced.ok ? priced.extra : 0)) * 100) / 100);
  const madeCost = formula.length ? costWith(item.id, draft, stockParts, shown) : null;
  const keeps = madeCost === null ? null : Math.round((total - madeCost) * 100) / 100;
  const share = madeCost !== null && total > 0 ? madeCost / total : null;
  const pickedNotes = priced.ok ? priced.lines.map((l) => optCosts[`${l.groupId}/${l.optionId}`]).filter((c): c is OptionCost => !!c && c.cost !== null && c.changes).slice(0, 2) : [];

  const actions = (
    <>
      <button type="button" onClick={() => void save()} disabled={saving || uploading} className={BTN} style={step === 5 ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>{saving ? 'Saving…' : 'Save and close'}</button>
      {nextStep && <button type="button" onClick={() => go(nextStep.n)} className={BTN} style={{ background: INK, color: '#fff' }}>Next<span className="sr-only sm:not-sr-only">: {nextStep.next}</span></button>}
    </>
  );

  return (
    <div ref={shell} role="dialog" aria-modal="true" aria-labelledby="build-title" className="fixed inset-0 z-50 overflow-y-auto" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 sm:px-8 lg:pb-10 lg:pt-7">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px]" style={{ color: MUTED }}>Menu, {section.trim() || 'no section yet'}</p>
            <h2 id="build-title" className="mt-0.5 truncate text-[26px] font-semibold tracking-tight">{name.trim() || item.name}</h2>
            <p className="mt-1 hidden max-w-[760px] text-[14.5px] leading-relaxed sm:block" style={{ color: MUTED }}>One step at a time, with what the guest sees beside it. Choices come from sets you make once, like Milk or Syrups, so a price is changed in one place for every {noun} with it.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden gap-2 lg:flex">{actions}</span>
            <button type="button" onClick={tryClose} aria-label="Close without saving" className={`h-11 w-11 shrink-0 rounded-full border bg-[#fff] text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)_340px] lg:gap-6">
          <nav aria-label="Steps" className="hidden lg:flex lg:flex-col lg:gap-4">
            <ol className="space-y-1.5">
              {STEPS.map((s) => { const now = s.n === step; const ok = done(s.n);
                return (
                  <li key={s.n}>
                    <button type="button" onClick={() => go(s.n)} aria-current={now ? 'step' : undefined} className={`flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left ${RING}`}
                      style={now ? { background: INK, color: '#fff' } : ok ? { background: '#fff', border: `1px solid ${LINE}` } : { border: '1px solid transparent' }}>
                      <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold" style={now ? { background: '#fff', color: INK } : ok ? { background: GREEN_TINT, color: GREEN } : { background: '#e7e8ea', color: MUTED }}>{s.n}</span>
                      <span className="min-w-0"><span className="block text-[14.5px] font-semibold">{s.title}</span><span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: now ? '#c9cacd' : MUTED }}>{summary[s.n]}</span></span>
                    </button>
                  </li>);
              })}
            </ol>
            <p className="rounded-2xl border bg-[#fff] px-3.5 py-3 text-[12.5px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>Only the basics are needed to sell it. Every other step can wait, and each one says what it adds.</p>
          </nav>

          <div className="min-w-0 space-y-4">
            <nav ref={phoneSteps} aria-label="Steps" className="-mx-4 overflow-x-auto px-4 lg:hidden">
              <ol className="flex gap-1.5">
                {STEPS.map((s) => { const now = s.n === step;
                  return <li key={s.n} className="shrink-0"><button type="button" onClick={() => go(s.n)} aria-current={now ? 'step' : undefined} className={`flex min-h-[44px] items-center gap-2 rounded-full px-3.5 text-[14px] font-semibold ${RING}`}
                    style={now ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}><span aria-hidden className="tabular-nums" style={{ color: now ? '#c9cacd' : done(s.n) ? GREEN : MUTED }}>{s.n}</span>{s.title}</button></li>;
                })}
              </ol>
            </nav>

            {leaving && (
              <div role="alertdialog" aria-labelledby="leave-words" className="space-y-3 rounded-2xl px-4 py-3" style={{ background: AMBER_TINT }}>
                <p id="leave-words" className="text-[14.5px] font-semibold" style={{ color: AMBER }}>{leaving.to === 'close' ? `Leave without saving? What you changed on ${name.trim() || item.name} isn’t kept.` : `Save ${name.trim() || item.name} first? The set opens in Choice sets.`}</p>
                <div className="flex flex-wrap gap-2">
                  <button ref={leaveFirst} type="button" disabled={saving} onClick={async () => { const to = leaving; setLeaving(null); if (await save() && to.to === 'set') onOpenSet(to.id); }} className={BTN} style={{ background: INK, color: '#fff' }}>{leaving.to === 'close' ? 'Save and close' : 'Save, then open the set'}</button>
                  <button type="button" onClick={() => { const to = leaving; setLeaving(null); if (to.to === 'close') onClose(); else onOpenSet(to.id); }} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>{leaving.to === 'close' ? 'Leave without saving' : 'Open it without saving'}</button>
                  <button type="button" onClick={() => setLeaving(null)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Keep editing</button>
                </div>
              </div>
            )}

            <section aria-labelledby="step-title" className="space-y-4">
              <div>
                <h3 id="step-title" ref={head} tabIndex={-1} className="text-[20px] font-semibold outline-none">{at.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed" style={{ color: MUTED }}>{step === 1 ? 'What it’s called, what it costs and where it sits on the menu. A photo and a line guests read help it sell.'
                  : step === 2 ? `One size, or a few. Each says what it adds to the price, and can add to the recipe too, so a 16 oz uses more milk and costs you what it really costs.`
                  : step === 3 ? `Turn on the sets this ${noun} has. A set is the same on every item it’s on: change it once, and it changes everywhere. Sold out once, sold out everywhere.`
                  : step === 4 ? `What goes into one, from your stock. With it, the ${noun} is available while there’s enough to make it, each one sold comes off stock, and you see what it costs you.`
                  : 'What it contains, where and how long it’s made, when it’s sold, and how it shows on the menu board.'}</p>
              </div>
              {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}

              {step === 1 && <div className="space-y-5 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                <div className="flex items-center gap-4">
                  <span className="flex h-[90px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: SOFT, border: `1px solid ${LINE}` }}>
                    {photo ? <img src={photo} alt={`${name || item.name}`} className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" style={{ color: MUTED }} aria-hidden />}
                  </span>
                  <div className="min-w-0 space-y-2">
                    <p><span className="block text-[14px] font-medium">Photo</span><span className="block text-[13px]" style={{ color: MUTED }}>Shows on the drive-thru’s buttons, on the order board facing the car, and on guests’ menus. A photo on a plain background reads best.</span></p>
                    <div className="flex flex-wrap gap-2">
                      <label className={`${BTN} inline-flex cursor-pointer items-center focus-within:ring-2 focus-within:ring-[#16171a] focus-within:ring-offset-2`} style={{ border: `1px solid ${LINE}`, opacity: uploading ? 0.6 : 1 }}>
                        {uploading ? 'Adding the photo…' : photo ? 'Change photo' : 'Add a photo'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pickPhoto} disabled={!tenantId} aria-disabled={uploading} />
                      </label>
                      {photo && !uploading && <button type="button" onClick={() => setPhoto(null)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Remove</button>}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_140px]">
                  <label><span className="text-[14px] font-medium">Name</span><input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className={field} style={{ borderColor: LINE }} /></label>
                  <label><span className="text-[14px] font-medium">Section</span><input value={section} onChange={(e) => setSection(e.target.value.slice(0, 40))} placeholder="Coffee, Food" className={field} style={{ borderColor: LINE }} /></label>
                  <label><span className="text-[14px] font-medium">Price</span>
                    <span className="relative block"><span aria-hidden className="pointer-events-none absolute left-3 top-[calc(50%+3px)] -translate-y-1/2 text-[16px]" style={{ color: MUTED }}>$</span>
                      <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} className={`${field} pl-6`} style={{ borderColor: LINE }} /></span></label>
                </div>
                <label className="block"><span className="text-[14px] font-medium">What it is</span><span className="block text-[13px]" style={{ color: MUTED }}>A line guests read. Name anything people are often allergic to, and tick it under Contains (in Where and when).</span>
                  <textarea value={words} onChange={(e) => setWords(e.target.value.slice(0, 240))} rows={2} className={`${field} py-2.5`} style={{ borderColor: LINE }} /></label>
                <div className="space-y-1">
                  <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={onMenu} onChange={(e) => setOnMenu(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />On the menu guests see</label>
                  {item.starter && !item.onMenu && <p className="text-[13px]" style={{ color: MUTED }}>From your starter menu: give it a price, then tick this to put it on the menu.</p>}
                  <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Members only</label>
                </div>
              </div>}

              {step === 2 && <div className="space-y-4">
                <div role="radiogroup" aria-label="How it comes" className="inline-flex rounded-2xl border bg-[#fff] p-1" style={{ borderColor: LINE }}>
                  {([['one', 'One size'], ['sizes', 'In sizes']] as const).map(([k, label]) => { const on = k === 'one' ? !sizeG && !pickingSize : !!sizeG || pickingSize;
                    return <button key={k} type="button" role="radio" aria-checked={on} onClick={() => {
                      if (k === 'one') { setPickingSize(false); if (sizeIdx >= 0) dropG(sizeIdx); setSizeId(null); return; }
                      if (sizeG) return; if (sizeSets.length) { setPickingSize(true); return; }
                      addSizes(ownSizes());
                    }} className={`min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold ${RING}`} style={on ? { background: INK, color: '#fff' } : { color: INK }}>{label}</button>; })}
                </div>
                {!sizeG && pickingSize && <div className="flex flex-wrap items-center gap-2 rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                  {sizeSets.map((s) => <button key={s.id} type="button" onClick={() => { setPickingSize(false); addSizes(groupFromSet(s)); }} className={BTN} style={{ background: INK, color: '#fff' }}>Use your {s.name} set</button>)}
                  <button type="button" onClick={() => { setPickingSize(false); addSizes(ownSizes()); }} className={BTN} style={{ border: `1px solid ${LINE}` }}>Sizes only this {noun} has</button>
                </div>}
                {sizeG && sizeG.setId && <div className="space-y-2 rounded-2xl border bg-[#fff] p-4" style={{ borderColor: LINE }}>
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{sizeG.name}<span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: SOFT, color: MUTED }}>Set</span><span className="text-[12.5px] font-normal" style={{ color: MUTED }}>{onCount(sizeG.setId)}</span></p>
                  <p className="text-[13.5px]">{lineOf(sizeG)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => toSet(sizeG.setId!)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Change {sizeG.name} for every item</button>
                    <button type="button" onClick={() => setG(sizeIdx, { setId: undefined, options: sizeG.options.map(({ setOption: _s, ...o }: any) => o) })} className={BTN} style={{ border: `1px solid ${LINE}` }}>Only for this {noun}</button>
                  </div>
                </div>}
                {sizeG && !sizeG.setId && <div className="space-y-3 rounded-2xl border bg-[#fff] p-4" style={{ borderColor: LINE }}>
                  <ul className="space-y-3">
                    {sizeG.options.map((o, j) => (
                      <li key={o.id} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input value={o.name} onChange={(e) => setG(sizeIdx, { options: sizeG.options.map((x, k) => (k === j ? { ...x, name: e.target.value.slice(0, 40) } : x)) })} placeholder="12 oz, Large" aria-label={`Size ${j + 1}`} className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
                          <span className="relative w-28 shrink-0"><span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: MUTED }}>$</span>
                            <input inputMode="decimal" value={String(o.price)} onChange={(e) => setG(sizeIdx, { options: sizeG.options.map((x, k) => (k === j ? { ...x, price: e.target.value.replace(/[^0-9.\-]/g, '').slice(0, 8) } : x)) })} aria-label={`What ${o.name || 'this size'} adds to the price (a minus takes off)`} className="min-h-[44px] w-full rounded-xl border bg-[#fff] pl-6 pr-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></span>
                          <button type="button" onClick={() => setG(sizeIdx, { options: sizeG.options.filter((_, k) => k !== j) })} disabled={sizeG.options.length < 2} aria-label={`Remove ${o.name || 'this size'}`} className={`h-11 w-11 shrink-0 rounded-xl border text-[18px] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE, color: MUTED }}>×</button>
                        </div>
                        {stock && <OptionChanges name={o.name || 'This size'} changes={o.changes || []} onChange={(c) => setG(sizeIdx, { options: sizeG.options.map((x, k) => (k === j ? { ...x, changes: c } : x)) })} recipe={formula} stock={stock} cost={optCosts[`${sizeG.id}/${o.id}`]}
                          recipeHint={`Add what goes in it (step 4) first, then a size can use something instead.`} />}
                      </li>))}
                  </ul>
                  {sizeG.options.length < 8 && <button type="button" onClick={() => setG(sizeIdx, { options: [...sizeG.options, { id: nid(), name: '', price: '0.00', soldOut: false }] })} className={BTN} style={{ border: `1px solid ${LINE}` }}>Add a size</button>}
                  <p className="text-[13px]" style={{ color: MUTED }}>It starts on the first. The price is what each adds: 0 for the first, a minus takes off.</p>
                </div>}
              </div>}

              {step === 3 && <div className="space-y-3">
                {groups.map((g, i) => { if (i === sizeIdx) return null;
                  const order = groups.map((_, k) => k).filter((k) => k !== sizeIdx); const pos = order.indexOf(i);
                  if (!g.setId) return (
                    <div key={g.id} className="space-y-1.5">
                      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Only this {noun} has</p>
                      <OwnGroup g={g} onChange={(patch) => setG(i, patch)} onRemove={() => dropG(i)} onMove={(d) => moveG(i, d)} first={pos === 0} last={pos === order.length - 1}
                        recipe={formula} stock={stock} costs={optCosts} recipeHint="Add what goes in it (step 4) first, then a choice can swap or leave out what’s in it." />
                    </div>);
                  const s = byId.get(g.setId); const open = openSet === g.id; const firstUp = g.options.find((o) => !outOf(g.id, o));
                  return (
                    <SetRow key={g.id} name={g.name} rule={s ? setRule(s) : ruleOf(g)} line={lineOf(g)} count={onCount(g.setId)} on open={open} label={`${g.name} on this ${noun}`}
                      onToggle={() => { dropG(i); setOpenSetRow(null); }} onOpen={() => setOpenSetRow(open ? null : g.id)}>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {g.pick === 'one' && g.required && <span className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: SOFT }}>Must pick one</span>}
                        {g.pick === 'one' && firstUp && <span className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: SOFT }}>Starts on {firstUp.name}</span>}
                        <button type="button" onClick={() => toSet(g.setId!)} className={`min-h-[44px] rounded-xl border bg-[#fff] px-3.5 text-[14px] font-semibold ${RING}`} style={{ borderColor: LINE }}>Change {g.name} for every item</button>
                        <button type="button" onClick={() => { setG(i, { setId: undefined, options: g.options.map(({ setOption: _s, ...o }: any) => o) }); setOpenSetRow(null); }} className={`min-h-[44px] rounded-xl border bg-[#fff] px-3.5 text-[14px] font-semibold ${RING}`} style={{ borderColor: LINE }}>Only for this {noun}</button>
                        <button type="button" onClick={() => moveG(i, -1)} disabled={pos === 0} aria-label={`Show ${g.name} earlier`} className={`h-11 w-11 rounded-xl border bg-[#fff] text-[16px] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↑</button>
                        <button type="button" onClick={() => moveG(i, 1)} disabled={pos === order.length - 1} aria-label={`Show ${g.name} later`} className={`h-11 w-11 rounded-xl border bg-[#fff] text-[16px] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↓</button>
                      </div>
                    </SetRow>);
                })}
                {sets.filter((s) => !groups.some((g) => g.setId === s.id) && !sizeSets.includes(s)).map((s) => (
                  <SetRow key={s.id} name={s.name} rule={setRule(s)} line={optionsLine(s)} count={onCount(s.id)} on={false} open={false} label={`${s.name} on this ${noun}`}
                    onToggle={() => setGroups((gs) => [...gs, groupFromSet(s)])} onOpen={() => undefined} />))}
                {!sets.length && <p className="rounded-2xl border bg-[#fff] px-4 py-3 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>No choice sets yet. Make one, like Milk or Syrups, and turn it on for every {noun} that has it.</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => toSet('new')} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>New set</button>
                  <button type="button" aria-expanded={addingOwn} onClick={() => setAddingOwn((v) => !v)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>A choice only this {noun} has</button>
                </div>
                {addingOwn && <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-[#fff] p-3" style={{ borderColor: LINE }}>
                  <span className="text-[14px]" style={{ color: MUTED }}>Start from:</span>
                  {STARTERS.filter((x) => x.label !== 'Size').map((x) => <button key={x.label} type="button" onClick={() => { setGroups((gs) => [...gs, x.make()]); setAddingOwn(false); }} className={BTN} style={{ background: SOFT }}>{x.label}</button>)}
                  <button type="button" onClick={() => { setGroups((gs) => [...gs, { id: nid(), name: '', pick: 'one', required: true, max: 1, options: [{ id: nid(), name: '', price: 0, soldOut: false }] }]); setAddingOwn(false); }} className={BTN} style={{ background: SOFT }}>Something else</button>
                </div>}
                {item.choices.length > 0 && <div className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
                  <h4><button type="button" onClick={() => setOutOpen((v) => !v)} aria-expanded={outOpen} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
                    <span><span className="block text-[16px] font-semibold">Sold out tonight</span>
                      <span className="block text-[13px] font-normal" style={{ color: outNames.length ? AMBER : MUTED }}>{outNames.length ? `${andList(outNames)} sold out` : 'Nothing sold out'}</span></span>
                    <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{outOpen ? 'Close' : 'Change'}</span></button></h4>
                  {outOpen && <div className="space-y-3 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
                  {item.choices.map((g) => (
                    <div key={g.id} className="space-y-1.5">
                      <p className="text-[14px] font-medium" style={{ color: MUTED }}>{g.name}</p>
                      {g.options.map((o) => (
                        <div key={o.id} className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl px-3" style={{ background: o.soldOut ? AMBER_TINT : SOFT }}>
                          <span className="text-[15px]" style={{ color: o.soldOut ? AMBER : INK, fontWeight: o.soldOut ? 600 : 400 }}>{o.name}{o.soldOut ? ', sold out' : ''}</span>
                          <button type="button" role="switch" aria-checked={o.soldOut} aria-label={`${o.name} sold out`} disabled={busy === `${item.id}${g.id}${o.id}`} onClick={() => onSoldOut(g.id, o.id, !o.soldOut)} className={`flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${RING}`}>
                            <span aria-hidden className="relative h-8 w-14 rounded-full transition-colors" style={{ background: o.soldOut ? AMBER : '#d4d6da' }}><span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow transition-all" style={{ left: o.soldOut ? 28 : 4 }} /></span>
                          </button>
                        </div>))}
                    </div>))}
                  <p className="text-[13px]" style={{ color: GREEN }}>Sold out shows straight away on every menu, and on the kitchen screen. A choice from a set sells out on every item with it.</p>
                  </div>}
                </div>}
              </div>}

              {step === 4 && <div className="space-y-4">
                <div className="rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <RecipeEditor lines={lines} onChange={setLines} stock={stock} ownId={item.id} price={Number(price) || 0} canMake={item.byRecipe ? item.canMake : null} short={item.short} title="The recipe" intro={`As you measure it. Each line shows what it costs; the total is what one costs you to make.`} />
                  {(item.recipeGaps || []).length > 0 && <p className="mt-3 text-[13.5px] font-semibold" style={{ color: AMBER }}>Add {item.recipeGaps.join(', ')} to its recipe yourself: {item.recipeGaps.length === 1 ? 'yours is' : 'yours are'} measured differently from the starter recipe.</p>}
                </div>
                <div className="space-y-3 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <div className="flex items-start justify-between gap-3">
                    <span><span className="block text-[15px] font-semibold">A combo</span><span className="block text-[13px]" style={{ color: MUTED }}>A meal deal at the counter and drive-thru: the items it always has, and a choice of others (each choice made as one of your items). Each part goes to its own station and comes off its own stock.</span></span>
                    <Toggle on={combo} label="A combo" onClick={() => setCombo((v) => !v)} />
                  </div>
                  {combo && <>
                    <p className="text-[14px] font-medium">Always has</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Items it always has">{others.map((x) => { const on = inIt.includes(x.id);
                      return <button key={x.id} type="button" aria-pressed={on} onClick={() => setInIt((xs) => (on ? xs.filter((y) => y !== x.id) : [...xs, x.id].slice(0, 6)))} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(on)}>{x.name}</button>; })}</div>
                    {groups.length > 0 && <div className="space-y-2"><p className="text-[14px] font-medium">Made as</p>
                      {groups.flatMap((g, gi) => g.options.map((o, oi) => (
                        <label key={`${g.id}/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 text-[14px]"><span>{g.name}: {o.name}</span>
                          <select value={o.itemId || ''} onChange={(e) => setGroups((gs) => gs.map((x, k) => (k !== gi ? x : { ...x, options: x.options.map((y, m) => (m !== oi ? y : { ...y, itemId: e.target.value || undefined })) })))} className={pickField} style={{ borderColor: LINE }}>
                            <option value="">Nothing more (a note on the ticket)</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>)))}</div>}
                  </>}
                </div>
              </div>}

              {step === 5 && <div className="space-y-4">
                <fieldset className="space-y-2 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <legend className="float-left w-full text-[16px] font-semibold">Contains</legend>
                  <p className="clear-both text-[13px]" style={{ color: MUTED }}>A server ringing it in for a guest with one of these is warned, and the kitchen ticket says so. The nine major allergens, plus gluten. Until you say, a server is warned for any guest with a severe allergy.</p>
                  <div className="flex flex-wrap gap-2">{ALLERGENS.map((a) => { const on = !!allergens?.includes(a.key);
                    return <button key={a.key} type="button" aria-pressed={on} onClick={() => { const cur = allergens || []; setAllergens(cleanKeys(on ? cur.filter((x) => x !== a.key) : [...cur, a.key])); }} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(on)}>{a.label}</button>; })}
                    <button type="button" aria-pressed={allergens !== null && allergens.length === 0} onClick={() => setAllergens([])} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(allergens !== null && allergens.length === 0)}>None of these</button></div>
                  {allergens === null && (item.allergensLikely || []).length > 0
                    ? <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2" style={{ background: AMBER_TINT }}>
                        <p className="min-w-0 flex-1 text-[13.5px] font-semibold" style={{ color: AMBER }}>Likely contains {item.allergensLikely.map((k) => (ALLERGENS.find((a) => a.key === k)?.label || k).toLowerCase()).join(', ')}, from the starter menu. Anything not listed may still be in it: check your own products’ labels, then change these to match.</p>
                        <button type="button" onClick={() => setAllergens(cleanKeys(item.allergensLikely))} className={`min-h-[44px] rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Start from these</button></div>
                    : allergens === null && <p className="text-[13px] font-semibold" style={{ color: AMBER }}>Not said yet.</p>}
                </fieldset>

                <div className="space-y-3 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <h4 className="text-[16px] font-semibold">Where it’s made</h4>
                  {service && <>
                    <label className="flex flex-wrap items-center justify-between gap-3">
                      <span><span className="block text-[15px] font-medium">Made at</span><span className="block text-[13px]" style={{ color: MUTED }}>Shows on that station’s screen. Drinks go to the bar unless set.</span></span>
                      <select value={station} onChange={(e) => setStation(e.target.value)} className={pickField} style={{ borderColor: LINE }}>
                        <option value="">Worked out from its section</option>
                        {service.stations.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </label>
                    {service.stations.length > 1 && !combo && <div className="space-y-2">
                      <span><span className="block text-[15px] font-medium">Also made at</span><span className="block text-[13px]" style={{ color: MUTED }}>A part made at another station (the fries for a steak, at the fryer). Each station sees its own part, and the plate is ready once both are.</span></span>
                      {also.map((a, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <select value={a.station} onChange={(e) => setAlso((xs) => xs.map((x, k) => (k === i ? { ...x, station: e.target.value } : x)))} aria-label="Other station" className={pickField} style={{ borderColor: LINE }}>
                            <option value="">Pick a station</option>
                            {service.stations.filter((x) => x !== station).map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          <input value={a.part} onChange={(e) => setAlso((xs) => xs.map((x, k) => (k === i ? { ...x, part: e.target.value.slice(0, 40) } : x)))} placeholder="the fries" aria-label="What’s made there" className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
                          <button type="button" onClick={() => setAlso((xs) => xs.filter((_, k) => k !== i))} aria-label={`Not made at ${a.station || 'that station'}`} className={`h-11 w-11 shrink-0 rounded-xl text-[18px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: MUTED }}>×</button>
                        </div>))}
                      {also.length < 2 && <button type="button" onClick={() => setAlso((xs) => [...xs, { station: '', part: '' }])} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Add another station</button>}
                    </div>}
                    <label className="flex flex-wrap items-center justify-between gap-3">
                      <span><span className="block text-[15px] font-medium">Course at a table</span><span className="block text-[13px]" style={{ color: MUTED }}>A held course waits until the server fires it.</span></span>
                      <select value={course} onChange={(e) => setCourse(e.target.value)} className={pickField} style={{ borderColor: LINE }}>
                        <option value="">From its section</option>
                        <option value="0">Always right away</option>
                        {service.courses.map((c) => <option key={c.n} value={String(c.n)}>{c.name}{c.hold ? ', held until fired' : ''}</option>)}
                      </select>
                    </label>
                  </>}
                  <label className="flex flex-wrap items-center justify-between gap-3">
                    <span><span className="block text-[15px] font-medium">Takes to make</span><span className="block text-[13px]" style={{ color: MUTED }}>An order is never due sooner than its slowest item.</span></span>
                    <select value={makeSeconds} onChange={(e) => { setMakeSeconds(Number(e.target.value)); setMakeTouched(true); }} className={pickField} style={{ borderColor: LINE }}>
                      {Array.from(new Set([...MAKE_TIMES, makeSeconds])).sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t < 60 ? `${t} seconds` : mmss(t)}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-wrap items-center justify-between gap-3">
                    <span><span className="block text-[15px] font-medium">Made each night</span><span className="block text-[13px]" style={{ color: MUTED }}>Counts down as it’s ordered, and sells out by itself at zero. The kitchen can change tonight’s number. Leave empty to not count it.</span></span>
                    <input inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Not counted" aria-label="How many are made each night" className={pickField} style={{ borderColor: LINE }} />
                  </label>
                  <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={held} onChange={(e) => setHeld(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Cooked ahead in batches and held</label>
                  {held && <div className="grid gap-3 rounded-2xl p-4 sm:grid-cols-2" style={{ background: SOFT }}>
                    <label><span className="text-[14px] font-medium">Hold for</span>
                      <select value={holdMinutes} onChange={(e) => setHoldMinutes(Number(e.target.value))} className={field} style={{ borderColor: LINE }}>
                        {Array.from(new Set([...HOLD_TIMES, holdMinutes])).sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} minutes</option>)}
                      </select></label>
                    <label><span className="text-[14px] font-medium">A batch is</span>
                      <input inputMode="numeric" value={batchSize} onChange={(e) => setBatchSize(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={field} style={{ borderColor: LINE }} /></label>
                    <p className="text-[13px] sm:col-span-2" style={{ color: MUTED }}>The kitchen screen starts a batch in one tap, counts it down, and says when it has to be thrown out.</p>
                  </div>}
                </div>

                <div className="space-y-3 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <h4 className="text-[16px] font-semibold">When it’s sold</h4>
                  {dayparts.length > 0 ? <div className="flex flex-wrap gap-2" role="group" aria-label="Menus by time of day it’s in">{dayparts.map((d) => { const on = parts.includes(d.id);
                    return <button key={d.id} type="button" aria-pressed={on} onClick={() => setParts((xs) => (on ? xs.filter((x) => x !== d.id) : [...xs, d.id]))} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(on)}>{d.name}</button>; })}
                    <span className="self-center text-[13px]" style={{ color: MUTED }}>{parts.length ? 'Only while one of these is on.' : 'All day.'}</span></div>
                    : <p className="text-[13px]" style={{ color: MUTED }}>All day. Add menus by time of day (Breakfast, Lunch) in the Menu’s Settings to sell it only then.</p>}
                  <label className="flex flex-wrap items-center justify-between gap-3"><span><span className="block text-[15px] font-medium">Happy-hour price</span><span className="block text-[13px]" style={{ color: MUTED }}>During happy hour (set in the Menu’s Settings). Empty: its price.</span></span>
                    <span className="relative block w-32"><span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px]" style={{ color: MUTED }}>$</span>
                      <input inputMode="decimal" value={happy} onChange={(e) => setHappy(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} aria-label="Happy-hour price" className={`${field} mt-0 pl-6`} style={{ borderColor: LINE }} /></span></label>
                </div>

                <fieldset className="space-y-2 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
                  <legend className="sr-only">On the menu board</legend>
                  <p className="text-[16px] font-semibold">On the menu board</p>
                  <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Feature it: shown big, up front</label>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label htmlFor="item-badge" className="text-[15px]">Tag</label>
                    <select id="item-badge" value={badge} onChange={(e) => setBadge(e.target.value)} className={pickField} style={{ borderColor: LINE }}>
                      <option value="">None</option><option value="new">New</option><option value="limited">Limited time</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label htmlFor="item-cal" className="text-[15px]">Calories <span style={{ color: MUTED }}>(optional)</span></label>
                    <input id="item-cal" value={calories} onChange={(e) => setCalories(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="540" className={pickField} style={{ borderColor: LINE }} />
                  </div>
                  <p className="text-[13px]" style={{ color: MUTED }}>Popular shows by itself on your three best sellers this week.</p>
                </fieldset>
              </div>}
            </section>
          </div>

          <aside aria-label="What the guest sees, and what you keep" className="space-y-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)] lg:self-start lg:overflow-y-auto">
            <p className="hidden text-[13px] font-semibold lg:block" style={{ color: MUTED }}>What the guest sees</p>
            <button type="button" onClick={() => setPeek((v) => !v)} aria-expanded={peek} aria-controls="guest-view" className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border bg-[#fff] px-4 text-left lg:hidden ${RING}`} style={{ borderColor: LINE }}>
              <span><span className="block text-[15px] font-semibold">What the guest sees</span><span className="block text-[13px]" style={{ color: MUTED }}>{money(total)} as picked{madeCost !== null && keeps !== null ? `, keeps ${money(keeps)}` : ''}</span></span>
              <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{peek ? 'Close' : 'Open'}</span></button>
            <div id="guest-view" className={`${peek ? 'block' : 'hidden'} space-y-3 lg:block`}>
            <div className="overflow-hidden rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
              {photo && <img src={photo} alt="" className="h-36 w-full object-cover" />}
              <div className="space-y-3 p-4">
                <div>
                  <p className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-[18px] font-semibold">{name.trim() || 'Name'}</span><span className="shrink-0 text-[15px] font-semibold tabular-nums">{money(Number(price) || 0)}</span></p>
                  {(words.trim() || allergenWords.length > 0) && <p className="mt-1 text-[13px] leading-snug" style={{ color: MUTED }}>{words.trim()}{words.trim() && allergenWords.length ? ' ' : ''}{allergenWords.length ? `Contains ${andList(allergenWords)}.` : ''}</p>}
                  {(!onMenu || membersOnly || item.soldOut) && <p className="mt-2 flex flex-wrap gap-1.5">
                    {!onMenu && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Not on the menu yet: guests don’t see it</span>}
                    {membersOnly && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-medium" style={{ background: SOFT, color: MUTED }}>Members only</span>}
                    {item.soldOut && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Sold out</span>}</p>}
                </div>
                <ChoicePicker item={draft} picks={shown} onChange={setPicks} />
                <p className="flex min-h-[48px] items-center justify-center rounded-2xl text-[15.5px] font-semibold" style={{ background: INK, color: '#fff' }}>Add to order, {money(total)}</p>
              </div>
            </div>
            <div className="lg:sticky lg:bottom-0 lg:py-1" style={{ background: SOFT }}>
            <div className="space-y-2 rounded-3xl border bg-[#fff] p-4" style={{ borderColor: LINE }}>
              <p className="text-[14.5px] font-semibold">What you keep on this one</p>
              <p className="text-[13px]" style={{ color: MUTED }}>{priced.ok && priced.lines.length ? `As picked above: ${priced.lines.map((l) => l.option).join(', ')}.` : 'As it comes, at its price.'}</p>
              {combo ? <p className="text-[13px]" style={{ color: MUTED }}>A combo costs what its items cost: see each one.</p>
                : !formula.length ? <p className="text-[13px]" style={{ color: MUTED }}>{stock ? 'Add what goes in it (step 4) to see what one costs you and what you keep.' : 'Working out what it costs…'}</p>
                : madeCost === null || keeps === null ? <p className="text-[13px] font-semibold" style={{ color: AMBER }}>Not known yet: {andList((baseCost?.gaps || []).map((x) => x.name)) || 'an ingredient'} {(baseCost?.gaps || []).length > 1 ? 'have' : 'has'} no cost in Inventory.</p>
                : <>
                  <div aria-hidden className="flex h-3 overflow-hidden rounded-full" style={{ background: '#cfe8da' }}><span style={{ width: `${Math.max(0, Math.min(100, Math.round((share || 0) * 100)))}%`, background: INK }} /></div>
                  <p className="flex justify-between gap-3 text-[13.5px] tabular-nums"><span>Costs you <b className="font-semibold">{money(madeCost)}</b></span><span>Keeps <b className="font-semibold" style={{ color: keeps < 0 ? AMBER : GREEN }}>{money(keeps)}</b></span></p>
                  {share !== null && <p className="text-[13px]" style={{ color: share > aim ? AMBER : MUTED, fontWeight: share > aim ? 600 : 400 }}>Food cost {Math.round(share * 100)}%, {share > aim ? 'over' : 'under'} your {Math.round(aim * 100)}% aim.{pickedNotes.map((c) => ` ${c.option} ${c.cost! > 0.004 ? `costs you ${money(c.cost!)} more` : c.cost! < -0.004 ? `saves you ${money(-c.cost!)}` : 'costs you nothing more'}${c.price ? ` and adds ${money(c.price)}` : ''}.`).join('')}</p>}
                </>}
            </div>
            </div>
            </div>
          </aside>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-[51] flex gap-2 border-t bg-[#fff] px-4 py-3 lg:hidden" style={{ borderColor: LINE }}>
        {step > 1 && <button type="button" onClick={() => go((step - 1) as Step)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Back</button>}
        <span className="flex flex-1 justify-end gap-2 [&>button]:flex-1">{actions}</span>
      </div>
    </div>
  );
}
