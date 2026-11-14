'use client';
// src/app/(app)/menu/page.tsx — THE MENU: what guests see of each drink and dish on the station tablets and their own
// phones and at the drive-thru (and later the counter and kiosk), by section. Each item's price, words, choices (size, milk,
// extras, each with its own price) and whether it's on the menu; and "Sold out" in one tap, for the item or one of its
// choices. Reads and saves through api/menu. Items themselves (stock, cost) are made in Inventory.
//   Recipe: what goes into one, from the business's own stock. An item with a recipe is available while its ingredients
//   are in stock and each one sold takes them off; without one it uses its own count (lib/menu-stock).
//   Kitchen timing: how long each item takes to make (a drive-thru order is due no sooner than its slowest item), and
//   whether it's cooked ahead in batches and held (the kitchen screen's holding timers). Managers also set the time each
//   kind of order aims to be handed over in (the drive-thru's 3:30 unless they change it).
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { ChoicesEditor, type EditGroup } from '@/components/menu/ChoicesEditor';
import { money, type ChoiceGroup } from '@/lib/menu-choices';
import type { MenuItem } from '@/lib/menu-server';
import { outWords, type RecipeLine } from '@/lib/menu-stock';
import { uploadImage } from '@/lib/upload-image';
import { ImagePlus } from 'lucide-react';
import { OrderAheadCard, type AheadSettings } from '@/components/menu/OrderAheadCard';
import { TableServiceSettings, type Service } from '@/components/menu/TableServiceSettings';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = 'mt-1.5 w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const pickField = 'min-h-[44px] w-36 shrink-0 rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const MAKE_TIMES = [30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900];
const HOLD_TIMES = [5, 7, 10, 15, 20, 30, 45, 60, 90, 120];
const TARGET_TIMES = [90, 120, 150, 180, 210, 240, 270, 300, 360, 420, 480, 600, 900, 1200];
const TARGET_ROWS: [string, string, string][] = [['drive-thru', 'Drive-thru', 'From arriving at the speaker to driving away'], ['counter', 'Counter', 'From ordering to handed over'], ['ahead', 'Ordered ahead', 'From the order coming in to ready for pickup']];

function Switch({ on, label, onClick, busy, color = AMBER }: { on: boolean; label: string; onClick: () => void; busy?: boolean; color?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={busy}
      className={`flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${RING}`}>
      <span aria-hidden className="relative h-8 w-14 rounded-full transition-colors" style={{ background: on ? color : '#d4d6da' }}>
        <span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow transition-all" style={{ left: on ? 28 : 4 }} />
      </span>
    </button>
  );
}

export default function MenuPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [recipes, setRecipes] = useState<Record<string, RecipeLine[]>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [targets, setTargets] = useState<Record<string, number> | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [spots, setSpots] = useState<number | null>(null);
  const [ahead, setAhead] = useState<AheadSettings | null>(null);
  const [timesOpen, setTimesOpen] = useState(false);
  const [voice, setVoice] = useState<{ setUp: boolean; on: boolean; canSetUp?: boolean; askName?: boolean; outdated?: boolean } | null>(null);

  const call = useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  useEffect(() => { if (!tenantId) return; void call({ action: 'list' }).then((d) => { if (d.ok) { setMenu(d.menu); setRecipes(d.recipes || {}); setCanEdit(!!d.canEdit); setTargets(d.targets || null); setService(d.service || null); setSpots(d.lane?.spots || null); setAhead(d.ahead || null); setVoice(d.voice || null); } else setErr(d.error || 'The menu didn’t load.'); }); }, [tenantId, call]);
  const setUpVoice = async () => {
    setBusy('voice'); setErr('');
    const d = await call({ action: 'voiceSetup' });
    setBusy(null); if (d.ok) setVoice((v) => ({ ...(v || {}), setUp: true, on: !!d.on, outdated: false })); else setErr(d.error || 'That didn’t go through. Try again.');
  };
  const setAskName = async (askName: boolean) => {
    const was = voice; setVoice((v) => (v ? { ...v, askName } : v)); setBusy('askName'); setErr('');
    const d = await call({ action: 'voice', askName });
    setBusy(null); if (!d.ok) { setVoice(was); setErr(d.error || 'That didn’t save.'); }
  };
  const updateVoice = async () => {
    setBusy('voiceUpdate'); setErr('');
    const d = await call({ action: 'voiceUpdate' });
    setBusy(null); if (d.ok) setVoice((v) => (v ? { ...v, outdated: false } : v)); else setErr(d.error || 'That didn’t go through. Try again.');
  };
  const setVoiceOn = async (on: boolean) => {
    const was = voice; setVoice((v) => (v ? { ...v, on } : v)); setBusy('voice'); setErr('');
    const d = await call({ action: 'voice', on });
    setBusy(null); if (!d.ok) { setVoice(was); setErr(d.error || 'That didn’t save.'); }
  };
  const setSpotCount = async (n: number) => {
    const was = spots; setSpots(n); setBusy('spots'); setErr('');
    const d = await call({ action: 'laneSettings', spots: n });
    setBusy(null); if (!d.ok) { setSpots(was); setErr(d.error || 'That didn’t save.'); }
  };
  const setTarget = async (channel: string, seconds: number) => {
    const was = targets; setTargets((t) => (t ? { ...t, [channel]: seconds } : t)); setBusy(`t-${channel}`); setErr('');
    const d = await call({ action: 'targets', targets: { [channel]: seconds } });
    setBusy(null); if (d.ok) setTargets(d.targets); else { setTargets(was); setErr(d.error || 'That didn’t save.'); }
  };

  const put = (item: MenuItem) => setMenu((m) => (m ? m.map((x) => (x.id === item.id ? item : x)) : m));
  const soldOut = async (item: MenuItem, out: boolean, groupId?: string, optionId?: string): Promise<MenuItem | null> => {
    const key = `${item.id}${groupId || ''}${optionId || ''}`; setBusy(key); setErr('');
    const d = await call({ action: 'soldout', itemId: item.id, groupId, optionId, out });
    setBusy(null); if (d.ok) { put(d.item); return d.item; } setErr(d.error || 'That didn’t go through.'); return null;
  };

  const sections = useMemo(() => {
    const list = (menu || []).filter((m) => !q.trim() || `${m.name} ${m.section}`.toLowerCase().includes(q.trim().toLowerCase()));
    const by = new Map<string, MenuItem[]>(); for (const m of list) by.set(m.section, [...(by.get(m.section) || []), m]);
    return Array.from(by.entries());
  }, [menu, q]);
  const hasPhotos = (menu || []).some((m) => !!m.imageUrl);
  const outCount = (menu || []).filter((m) => m.soldOut || m.choices.some((g) => g.options.some((o) => o.soldOut))).length;

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Menu</h1>
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>What guests see when they order from a station tablet, their own phone or the drive-thru. New items are added in <Link href="/inventory" className="underline">Inventory</Link>.{tenantId ? <> Show it on a screen: <a href={`/drive-thru/${tenantId}/menu`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center underline">open the menu board</a>.</> : null}</p>
          </div>
          {outCount > 0 && <span className="rounded-full px-3 py-1.5 text-[14px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{outCount} with something sold out</span>}
        </header>
        {canEdit && ahead && <OrderAheadCard start={ahead} call={call} />}
        {canEdit && service && <TableServiceSettings service={service} onSave={async (next) => { const d = await call({ action: 'service', ...next }); if (d.ok) { setService(d.service); return null; } return d.error || 'That didn’t save.'; }} />}
        {canEdit && targets && (
          <section aria-labelledby="times-title" className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
            <button type="button" onClick={() => setTimesOpen((v) => !v)} aria-expanded={timesOpen} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
              <span><span id="times-title" className="block text-[16px] font-semibold">Service times</span>
                <span className="block text-[13.5px]" style={{ color: MUTED }}>Drive-thru {mmss(targets['drive-thru'])}, counter {mmss(targets.counter)}, ordered ahead {mmss(targets.ahead)}</span></span>
              <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{timesOpen ? 'Close' : 'Change'}</span>
            </button>
            {timesOpen && <div className="space-y-3 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
              <p className="text-[14px]" style={{ color: MUTED }}>The time each order aims to be handed over in. The kitchen screen counts every ticket down to it and works the drive-thru first.</p>
              {TARGET_ROWS.map(([c, label, hint]) => (
                <label key={c} className="flex flex-wrap items-center justify-between gap-3">
                  <span><span className="block text-[15px] font-medium">{label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{hint}</span></span>
                  <select value={targets[c]} disabled={busy === `t-${c}`} onChange={(e) => setTarget(c, Number(e.target.value))} className={pickField} style={{ borderColor: LINE }}>
                    {Array.from(new Set([...TARGET_TIMES, targets[c]])).sort((a, b) => a - b).map((t) => <option key={t} value={t}>{mmss(t)}</option>)}
                  </select>
                </label>))}
              {spots !== null && (
                <label className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span className="block text-[15px] font-medium">Pull-forward spots</span><span className="block text-[13px]" style={{ color: MUTED }}>Numbered spots past the window where a car waits for something slow</span></span>
                  <select value={spots} disabled={busy === 'spots'} onChange={(e) => setSpotCount(Number(e.target.value))} className={pickField} style={{ borderColor: LINE }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'spot' : 'spots'}</option>)}
                  </select>
                </label>
              )}
              {voice && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span className="block text-[15px] font-medium">Voice assistant at the drive-thru speaker</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>{voice.setUp ? 'Greets each car and takes the order. The team can listen in and take over from the lane screen.' : voice.canSetUp ? 'Takes each car’s order at the speaker. The team can listen in and take over at any time.' : 'Needs the voice service connected before it can be set up.'}</span></span>
                  {voice.setUp ? <Switch on={voice.on} label="Voice assistant at the drive-thru speaker" busy={busy === 'voice'} onClick={() => setVoiceOn(!voice.on)} color={GREEN} />
                    : voice.canSetUp && <button type="button" onClick={setUpVoice} disabled={busy === 'voice'} className={BTN} style={{ background: INK, color: '#fff' }}>{busy === 'voice' ? 'Setting up…' : 'Set it up'}</button>}
                </div>
              )}
              {voice?.setUp && voice.outdated && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: AMBER_TINT }}>
                  <span className="text-[14px]" style={{ color: AMBER }}>There’s a newer version of the assistant: it asks for a name and keeps it short when the line is long.</span>
                  <button type="button" onClick={updateVoice} disabled={busy === 'voiceUpdate'} className={BTN} style={{ background: INK, color: '#fff' }}>{busy === 'voiceUpdate' ? 'Updating…' : 'Update the assistant'}</button>
                </div>
              )}
              {voice?.setUp && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span className="block text-[15px] font-medium">Ask each car for a first name</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>The assistant asks once, near the end. The name shows on the lane, the order board and the kitchen ticket.</span></span>
                  <Switch on={voice.askName !== false} label="Ask each car for a first name" busy={busy === 'askName'} onClick={() => setAskName(voice.askName === false)} color={GREEN} />
                </div>
              )}
            </div>}
          </section>
        )}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className={`${field} mt-0`} style={{ borderColor: LINE }} />
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {!menu ? <div className="h-40 rounded-3xl bg-[#fff]" aria-busy="true" />
          : menu.length === 0 ? <p className="rounded-3xl border bg-[#fff] px-6 py-10 text-center text-[15px]" style={{ borderColor: LINE, color: MUTED }}>Nothing on the menu yet. Add drinks and food in Inventory as refreshments, and they show here.</p>
          : sections.map(([section, items]) => (
            <section key={section} aria-labelledby={`s-${section}`} className="space-y-2">
              <h2 id={`s-${section}`} className="text-[15px] font-semibold" style={{ color: MUTED }}>{section}</h2>
              <ul className="divide-y rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
                {items.map((m) => {
                  const outOpts = m.choices.flatMap((g) => g.options.filter((o) => o.soldOut).map((o) => o.name));
                  return (
                    <li key={m.id} className="flex items-center gap-4 px-4 py-3 sm:px-5" style={{ borderColor: LINE }}>
                      {hasPhotos && <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl" style={{ background: SOFT }} aria-hidden>{m.imageUrl && <img src={m.imageUrl} alt="" className="h-full w-full object-cover" style={{ opacity: m.soldOut ? 0.45 : 1 }} />}</span>}
                      <button type="button" onClick={() => setEditing(m)} className={`min-w-0 flex-1 rounded-xl py-1 text-left ${RING}`} aria-label={`${m.name}: ${canEdit ? 'edit' : 'see'} its price and choices`}>
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[16px] font-semibold" style={{ opacity: m.soldOut ? 0.5 : 1 }}>{m.name}</span>
                          <span className="text-[14.5px] tabular-nums" style={{ color: MUTED }}>{m.from ? `from ${money(m.startPrice)}` : money(m.price)}</span>
                          {!m.onMenu && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: SOFT, color: MUTED }}>Not on the menu</span>}
                          {m.membersOnly && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: SOFT, color: MUTED }}>Members</span>}
                          {!m.inStock && !m.soldOut && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{outWords(m)}</span>}
                        </span>
                        <span className="mt-0.5 block text-[13.5px]" style={{ color: outOpts.length ? AMBER : MUTED }}>
                          {outOpts.length ? `Sold out: ${outOpts.join(', ')}` : m.choices.length ? m.choices.map((g) => g.name).join(', ') : 'No choices'}
                        </span>
                      </button>
                      <span className="flex items-center gap-2.5">
                        <span className="hidden text-[14px] sm:inline" style={{ color: m.soldOut ? AMBER : MUTED, fontWeight: m.soldOut ? 600 : 400 }}>Sold out</span>
                        <Switch on={m.soldOut} label={`${m.name} sold out`} busy={busy === m.id} onClick={() => soldOut(m, !m.soldOut)} />
                      </span>
                    </li>);
                })}
              </ul>
            </section>
          ))}
      </div>
      {editing && <EditSheet key={editing.id} item={editing} recipe={recipes[editing.id] || []} tenantId={tenantId} canEdit={canEdit} busy={busy} service={service} onClose={() => setEditing(null)} call={call}
        onSoldOut={(g, o, out) => { void soldOut(editing, out, g, o).then((it) => { if (it) setEditing(it); }); }}
        onSave={async (patch) => { const d = await call({ action: 'save', itemId: editing.id, item: patch }); if (d.ok) { put(d.item); if (Array.isArray(d.recipe)) setRecipes((r) => ({ ...r, [editing.id]: d.recipe })); setEditing(null); return null; } return d.error || 'That didn’t save.'; }} />}
    </div>
  );
}

type Ingredient = { id: string; name: string; unit: string; left: number | null; menu: boolean };
type EditLine = { id: string; name: string; unit: string; q: string };
const amount = (n: number) => String(Math.round(n * 1000) / 1000);
// "each", "unit", "units" and nothing all mean counted one by one.
const sameUnit = (a: string, b: string) => { const n = (u: string) => (!u || /^(each|units?)$/i.test(u.trim()) ? 'each' : u.trim().toLowerCase()); return n(a) === n(b); };

/** What goes into one: the ingredients from the business's stock, each with how much one takes. */
function RecipeEditor({ lines, onChange, stock, item }: { lines: EditLine[]; onChange: (l: EditLine[]) => void; stock: Ingredient[] | null; item: MenuItem }) {
  const [find, setFind] = useState('');
  const byId = useMemo(() => new Map((stock || []).map((x) => [x.id, x])), [stock]);
  const matches = useMemo(() => {
    const t = find.trim().toLowerCase(); if (!t || !stock) return [];
    return stock.filter((x) => x.id !== item.id && !lines.some((l) => l.id === x.id) && x.name.toLowerCase().includes(t)).slice(0, 6);
  }, [find, stock, lines, item.id]);
  const leftWords = (x: Ingredient | undefined) => (!x ? 'Not in your stock any more' : x.left === null ? 'Not counted' : `${amount(x.left)}${x.unit === 'each' ? '' : ` ${x.unit}`} in stock`);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold">Recipe</h3>
        <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>What goes into one. With a recipe, this item is available while its ingredients are in stock, and each one sold takes them off. Without one, it uses its own count in Inventory.</p>
      </div>
      {lines.length > 0 && (
        <ul className="space-y-2" aria-label="Ingredients">
          {lines.map((l, i) => {
            // Measured as the ingredient is counted now (if that changed since the recipe was saved, the amount is checked).
            const x = byId.get(l.id); const unit = x?.unit || l.unit; const moved = !!x && !sameUnit(x.unit, l.unit);
            return (
              <li key={l.id} className="flex items-center gap-2 rounded-xl py-1.5 pl-3 pr-1" style={{ background: SOFT }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{l.name}</span>
                  {stock && <span className="block text-[12.5px]" style={{ color: moved || (x && x.left !== null && x.left <= 0) ? AMBER : MUTED }}>{moved ? `Now counted in ${unit}: check the amount` : leftWords(x)}</span>}
                </span>
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="sr-only">How much {l.name} goes into one</span>
                  <input inputMode="decimal" value={l.q} onChange={(e) => onChange(lines.map((y, k) => (k === i ? { ...y, q: e.target.value.replace(/[^0-9.]/g, '').slice(0, 8) } : y)))}
                    className="min-h-[44px] w-20 rounded-xl border bg-[#fff] px-2.5 text-right text-[16px] tabular-nums outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
                  <span className="w-10 truncate text-[13.5px]" style={{ color: MUTED }}>{unit}</span>
                </label>
                <button type="button" onClick={() => onChange(lines.filter((_, k) => k !== i))} aria-label={`Take ${l.name} out of the recipe`} className={`h-11 w-11 shrink-0 rounded-full text-[20px] ${RING}`} style={{ color: MUTED }}>×</button>
              </li>);
          })}
        </ul>
      )}
      {lines.length < 20 && (
        <div className="relative">
          <label className="block"><span className="sr-only">Add an ingredient</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value.slice(0, 60))} placeholder={stock ? 'Add an ingredient: buns, milk, cups' : 'Loading your stock…'} disabled={!stock}
              className={`${field} mt-0`} style={{ borderColor: LINE }} /></label>
          {find.trim() && stock && (
            <ul className="mt-1.5 overflow-hidden rounded-2xl border bg-[#fff]" style={{ borderColor: LINE }}>
              {matches.length === 0 ? <li className="px-4 py-3 text-[14px]" style={{ color: MUTED }}>Nothing in your stock is called that. Add it in Inventory first.</li>
                : matches.map((x) => (
                  <li key={x.id}><button type="button" onClick={() => { onChange([...lines, { id: x.id, name: x.name, unit: x.unit, q: '1' }]); setFind(''); }}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left ${RING}`}>
                    <span className="min-w-0 truncate text-[15px] font-medium">{x.name}</span>
                    <span className="shrink-0 text-[13px]" style={{ color: MUTED }}>{leftWords(x)}</span>
                  </button></li>))}
            </ul>
          )}
        </div>
      )}
      {item.byRecipe && item.canMake !== null && (
        <p className="text-[13.5px]" style={{ color: item.canMake > 0 ? GREEN : AMBER }}>{item.canMake > 0 ? `Enough in stock for ${item.canMake} right now.` : `Can’t be made right now: ${item.short || 'an ingredient'} has run out.`}</p>
      )}
    </div>
  );
}

function EditSheet({ item, recipe, tenantId, canEdit, busy, service, onClose, onSave, onSoldOut, call }: { item: MenuItem; recipe: RecipeLine[]; tenantId: string | null; canEdit: boolean; busy: string | null; service: Service | null; onClose: () => void;
  onSave: (patch: any) => Promise<string | null>; onSoldOut: (groupId: string, optionId: string, out: boolean) => void; call: (body: any) => Promise<any> }) {
  const startLines = useMemo<EditLine[]>(() => recipe.map((l) => ({ id: l.id, name: l.name, unit: l.unit, q: amount(l.quantityUsed) })), [recipe]);
  const [lines, setLines] = useState<EditLine[]>(startLines);
  const [stock, setStock] = useState<Ingredient[] | null>(null);
  useEffect(() => { if (!canEdit) return; void call({ action: 'ingredients' }).then((d: any) => { if (d.ok) setStock(d.ingredients || []); }); }, [canEdit, call]);
  const [name, setName] = useState(item.name); const [section, setSection] = useState(item.section); const [words, setWords] = useState(item.words || '');
  const [price, setPrice] = useState(item.price.toFixed(2)); const [onMenu, setOnMenu] = useState(item.onMenu); const [membersOnly, setMembersOnly] = useState(item.membersOnly);
  // The menu board: shown big up front, a tag, and calories (optional).
  const [featured, setFeatured] = useState(!!item.featured); const [badge, setBadge] = useState<string>(item.badge || ''); const [calories, setCalories] = useState(item.calories === null || item.calories === undefined ? '' : String(item.calories));
  const [groups, setGroups] = useState<EditGroup[]>(item.choices.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: o.price.toFixed(2) })) })));
  const [station, setStation] = useState(item.station || ''); const [course, setCourse] = useState(item.course === null ? '' : String(item.course));
  const [makeSeconds, setMakeSeconds] = useState(item.makeSeconds); const [makeTouched, setMakeTouched] = useState(false); const [held, setHeld] = useState(item.holdMinutes > 0);
  const [holdMinutes, setHoldMinutes] = useState(item.holdMinutes || 10); const [batchSize, setBatchSize] = useState(String(item.batchSize));
  const [saving, setSaving] = useState(false); const [err, setErr] = useState('');
  const [photo, setPhoto] = useState<string | null>(item.imageUrl || null); const [uploading, setUploading] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
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
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = was; opener?.focus?.(); };
  }, []);
  const save = async () => {
    // A price that isn't a number is asked about, never saved as nothing.
    const money2 = (v: unknown) => { const t = String(v ?? '').trim(); if (t === '' || t === '-') return 0; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
    if (String(price).trim() === '' || !Number.isFinite(Number(price))) { setErr('What does it cost? Type a price, like 4.50.'); return; }
    const bad = groups.flatMap((g) => g.options).find((o) => Number.isNaN(money2(o.price)));
    if (bad) { setErr(`What does ${bad.name || 'that option'} add? Type an amount, like 0.75, or leave it at 0.`); return; }
    const batch = Math.floor(Number(batchSize));
    if (held && !(batch >= 1 && batch <= 200)) { setErr('How many in a batch? Between 1 and 200.'); return; }
    const noAmount = lines.find((l) => !(Number(l.q) > 0));
    if (noAmount) { setErr(`How much ${noAmount.name} goes into one? Type an amount, like 1 or 0.5.`); return; }
    // The recipe is saved only when it was changed here (one left alone is kept as it is).
    // (Saved again, too, when an ingredient is now counted in another unit, so the recipe says what it's measured in.)
    const recipeChanged = JSON.stringify(lines.map((l) => [l.id, Number(l.q)])) !== JSON.stringify(startLines.map((l) => [l.id, Number(l.q)]))
      || lines.some((l) => { const x = stock?.find((y) => y.id === l.id); return !!x && !sameUnit(x.unit, l.unit); });
    setSaving(true); setErr('');
    const e = await onSave({ name, section, words, price: Number(price), onMenu, membersOnly, featured, badge: badge || null, calories: calories.trim() === '' ? null : Number(calories), ...(photo !== (item.imageUrl || null) ? { imageUrl: photo } : {}), choices: groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: money2(o.price) })) })),
      // Timing is saved only when it's set here (an item left alone keeps the kitchen's default, not a copy of it).
      ...(makeTouched ? { makeSeconds } : {}), ...(station !== (item.station || '') ? { station: station || null } : {}), ...(course !== (item.course === null ? '' : String(item.course)) ? { course: course === '' ? null : Number(course) } : {}), ...(held || item.holdMinutes > 0 ? { holdMinutes: held ? holdMinutes : 0 } : {}), ...(held ? { batchSize: batch } : {}),
      ...(recipeChanged ? { recipe: lines.map((l) => ({ id: l.id, name: l.name, quantityUsed: Number(l.q) })) } : {}) });
    setSaving(false); if (e) setErr(e);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="edit-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[#fff] p-6 sm:max-w-2xl sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="edit-title" className="text-[22px] font-semibold">{item.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
        </div>
        {canEdit ? <div className="mt-4 space-y-5">
          <div className="flex items-center gap-4">
            <span className="flex h-[90px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: SOFT, border: `1px solid ${LINE}` }}>
              {photo ? <img src={photo} alt={`${name || item.name}`} className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" style={{ color: MUTED }} aria-hidden />}
            </span>
            <div className="min-w-0 space-y-2">
              <p><span className="block text-[14px] font-medium">Photo</span><span className="block text-[13px]" style={{ color: MUTED }}>Shows on the drive-thru’s buttons and on the order board facing the car. A photo on a plain background reads best.</span></p>
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
          <label className="block"><span className="text-[14px] font-medium">What it is</span><span className="block text-[13px]" style={{ color: MUTED }}>A line guests read. Name anything people are often allergic to.</span>
            <textarea value={words} onChange={(e) => setWords(e.target.value.slice(0, 240))} rows={2} className={`${field} py-2.5`} style={{ borderColor: LINE }} /></label>
          <div className="space-y-2">
            <h3 className="text-[16px] font-semibold">Choices</h3>
            <ChoicesEditor groups={groups} onChange={setGroups} />
          </div>
          <RecipeEditor lines={lines} onChange={setLines} stock={stock} item={item} />
          <div className="space-y-3">
            <h3 className="text-[16px] font-semibold">Kitchen timing</h3>
            {service && <>
              <label className="flex flex-wrap items-center justify-between gap-3">
                <span><span className="block text-[15px] font-medium">Made at</span><span className="block text-[13px]" style={{ color: MUTED }}>Shows on that station’s screen. Drinks go to the bar unless set.</span></span>
                <select value={station} onChange={(e) => setStation(e.target.value)} className={pickField} style={{ borderColor: LINE }}>
                  <option value="">Worked out from its section</option>
                  {service.stations.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
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
          <div className="space-y-2">
            <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={onMenu} onChange={(e) => setOnMenu(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />On the menu guests see</label>
            <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Members only</label>
          </div>
          <fieldset className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}>
            <legend className="sr-only">On the menu board</legend>
            <p className="text-[15px] font-semibold">On the menu board</p>
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
          {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving || uploading} className={`${BTN} flex-1`} style={{ background: INK, color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={onClose} className={BTN} style={{ border: `1px solid ${LINE}` }}>Cancel</button>
          </div>
        </div> : <p className="mt-3 text-[15px]" style={{ color: MUTED }}>A manager can change the price and choices. You can mark choices sold out below.</p>}
        {item.choices.length > 0 && <div className="mt-6 space-y-3 border-t pt-5" style={{ borderColor: LINE }}>
          <h3 className="text-[16px] font-semibold">Sold out tonight</h3>
          {item.choices.map((g: ChoiceGroup) => (
            <div key={g.id} className="space-y-1.5">
              <p className="text-[14px] font-medium" style={{ color: MUTED }}>{g.name}</p>
              {g.options.map((o) => (
                <div key={o.id} className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl px-3" style={{ background: o.soldOut ? AMBER_TINT : SOFT }}>
                  <span className="text-[15px]" style={{ color: o.soldOut ? AMBER : INK, fontWeight: o.soldOut ? 600 : 400 }}>{o.name}{o.soldOut ? ', sold out' : ''}</span>
                  <Switch on={o.soldOut} label={`${o.name} sold out`} busy={busy === `${item.id}${g.id}${o.id}`} onClick={() => onSoldOut(g.id, o.id, !o.soldOut)} />
                </div>))}
            </div>))}
          <p className="text-[13px]" style={{ color: GREEN }}>Sold out shows straight away on every menu, and on the kitchen screen.</p>
        </div>}
      </div>
    </div>
  );
}
