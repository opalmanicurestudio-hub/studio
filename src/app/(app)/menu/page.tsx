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
//   Allergens: what each dish contains of the major allergens (lib/allergens), so a server is warned before ringing it
//   in for a guest who can't have it. Made each night: a dish counted down as it's ordered (lib/dish-counts), sold out by
//   itself at zero; what's left tonight shows beside it.
//   A manager builds each item step by step (components/menu/ItemBuilder), with what the guest sees beside it; the rest
//   of the team gets its choices to mark sold out.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { money, type ChoiceGroup } from '@/lib/menu-choices';
import type { MenuItem } from '@/lib/menu-server';
import { outWords, type RecipeLine } from '@/lib/menu-stock';
import { PrepRecipes, type PrepRow } from '@/components/menu/PrepRecipes';
import { DEFAULT_TARGET } from '@/lib/food-cost';
import type { ChoiceChange } from '@/lib/choice-recipe';
import { OrderAheadCard, type AheadSettings } from '@/components/menu/OrderAheadCard';
import { TableServiceSettings, type Service } from '@/components/menu/TableServiceSettings';
import { MenuTimesCard } from '@/components/menu/MenuTimesCard';
import type { Daypart, HappyHour } from '@/lib/menu-time';
import { leftWords, lowCount, type CountRow } from '@/lib/dish-counts';
import { NewItemSheet } from '@/components/menu/NewItemSheet';
import { ChoiceSetsPanel } from '@/components/menu/ChoiceSetsPanel';
import { ItemBuilder } from '@/components/menu/ItemBuilder';
import type { SetPick } from '@/components/menu/ChoicesEditor';
import { VOICE_OFFER_MODES, type VoiceOfferMode } from '@/lib/voice-offer';

// The page's three parts: the items first; the choice sets they share; and the settings (ordering ahead, menus by time
// of day, table service, service times, prep recipes). A link to one of the settings (/menu#order-ahead) opens Settings.
type Tab = 'items' | 'sets' | 'settings';
const SETTINGS_IDS = ['order-ahead', 'menu-times', 'table-service', 'service-times', 'prep-recipes'];

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = 'mt-1.5 w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const pickField = 'min-h-[44px] w-36 shrink-0 rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** What one costs to make, for a manager (lib/food-cost). */
const costWords = (c: { cost: number | null; share: number | null; typical: boolean }) => c.cost === null ? 'Cost to make not known yet: an ingredient has no cost'
  : `Costs ${money(c.cost)} to make${c.share !== null ? `, ${Math.round(c.share * 100)}% of its price` : ''}${c.typical ? ', at typical prices' : ''}`;
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
  // For managers: what each item's choices change in its recipe, and the prep recipes made in batches.
  const [changes, setChanges] = useState<Record<string, Record<string, ChoiceChange[]>>>({});
  const [preps, setPreps] = useState<PrepRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, CountRow>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [costs, setCosts] = useState<Record<string, { cost: number | null; share: number | null; over: boolean; typical: boolean; target: number; thin?: string[] }>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [targets, setTargets] = useState<Record<string, number> | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [times, setTimes] = useState<{ dayparts: Daypart[]; happyHour: HappyHour } | null>(null);
  const [spots, setSpots] = useState<number | null>(null);
  const [pickupOnly, setPickupOnlyState] = useState<boolean | null>(null);
  // Guests can ask for a text when their order is ready (lib/ready-text); null: texting isn't set up here.
  const [readyTexts, setReadyTexts] = useState<boolean | null>(null);
  // Whether orders placed ahead can come to the drive-thru (Ordering ahead on, with the drive-thru as a way): pickup only
  // applies only then.
  const [aheadThere, setAheadThere] = useState(true);
  const [ahead, setAhead] = useState<AheadSettings | null>(null);
  const [timesOpen, setTimesOpen] = useState(false);
  // New item: on the menu and in Inventory in one step (components/menu/NewItemSheet), its editor opening next.
  const [adding, setAdding] = useState(false);
  // An item just made opens on its sizes (its name, section and price were just given).
  const [fresh, setFresh] = useState(false);
  const [voice, setVoice] = useState<{ setUp: boolean; on: boolean; canSetUp?: boolean; askName?: boolean; offers?: VoiceOfferMode; offersReady?: boolean; outdated?: boolean } | null>(null);
  const [sets, setSets] = useState<SetPick[]>([]);
  const [tab, setTabState] = useState<Tab>(() => { try { const h = window.location.hash.slice(1); if (SETTINGS_IDS.includes(h)) return 'settings'; const t = new URLSearchParams(window.location.search).get('tab'); return t === 'sets' || t === 'settings' ? t : 'items'; } catch { return 'items'; } });
  const [openSet, setOpenSet] = useState<string | null>(null);
  const setTab = (t: Tab) => { setTabState(t); try { const u = new URL(window.location.href); if (t === 'items') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); u.hash = ''; window.history.replaceState(null, '', u.toString()); } catch { /* the address stays */ } };

  const call = useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const loadAll = useCallback(() => call({ action: 'list' }).then((d) => { if (d.ok) { setMenu(d.menu); setRecipes(d.recipes || {}); setCounts(Object.fromEntries((d.counts || []).map((r: CountRow) => [r.id, r]))); setCanEdit(!!d.canEdit); setCosts(d.costs || {}); setChanges(d.changes || {}); setPreps(Array.isArray(d.preps) ? d.preps : null); setTargets(d.targets || null); setService(d.service || null); setTimes(d.times || null); setSpots(d.lane?.spots || null); setPickupOnlyState(typeof d.lane?.pickupOnly === 'boolean' ? d.lane.pickupOnly : null); setReadyTexts(typeof d.lane?.readyTexts === 'boolean' ? d.lane.readyTexts : null); setAheadThere(d.lane?.aheadThere !== false); setAhead(d.ahead || null); setVoice(d.voice || null); setSets(Array.isArray(d.sets) ? d.sets : []); } else setErr(d.error || 'The menu didn’t load.'); }), [call]);
  useEffect(() => { if (!tenantId) return; void loadAll(); }, [tenantId, loadAll]);
  // A link straight to one of the settings: scrolled to once it's there.
  useEffect(() => { if (tab !== 'settings') return; let h = ''; try { h = window.location.hash.slice(1); } catch { /* none */ } if (!SETTINGS_IDS.includes(h)) return; const t = setTimeout(() => document.getElementById(h)?.scrollIntoView({ block: 'start' }), 300); return () => clearTimeout(t); }, [tab, ahead, service]);
  // Opened from somewhere else for one item (Food cost's "Look at the recipe": /menu?item=…): its editor, once.
  const deepOpened = useRef(false);
  useEffect(() => {
    if (deepOpened.current || !menu) return; let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get('item'); } catch { /* no address to read */ }
    if (!id) return; deepOpened.current = true; const m = menu.find((x) => x.id === id); if (m) setEditing(m);
  }, [menu]);
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
  // How often the assistant offers what each item offers (lib/voice-offer).
  const setOffers = async (offers: VoiceOfferMode) => {
    const was = voice; setVoice((v) => (v ? { ...v, offers } : v)); setBusy('offers'); setErr('');
    const d = await call({ action: 'voice', offers });
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
  const setPickupOnly = async (v: boolean) => {
    const was = pickupOnly; setPickupOnlyState(v); setBusy('pickupOnly'); setErr('');
    const d = await call({ action: 'laneSettings', pickupOnly: v });
    setBusy(null); if (!d.ok) { setPickupOnlyState(was); setErr(d.error || 'That didn’t save.'); } else setAheadThere(d.lane?.aheadThere !== false);
  };
  const setTexts = async (v: boolean) => {
    const was = readyTexts; setReadyTexts(v); setBusy('readyTexts'); setErr('');
    const d = await call({ action: 'laneSettings', readyTexts: v });
    setBusy(null); if (!d.ok) { setReadyTexts(was); setErr(d.error || 'That didn’t save.'); }
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
      <div className={`mx-auto ${canEdit && tab === 'sets' ? 'max-w-6xl' : 'max-w-4xl'} space-y-5 px-4 py-6 sm:px-6`}>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Menu</h1>
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>What guests see when they order from a station tablet, their own phone or the drive-thru. {canEdit ? <>Add something new with New item; drinks and food already in <Link href="/inventory" className="underline">Inventory</Link> show here by themselves.</> : <>New items are added in <Link href="/inventory" className="underline">Inventory</Link>.</>}{canEdit && Object.keys(costs).length > 0 ? <> What each costs to make, and what sold: <Link href="/food-cost" className="inline-flex min-h-[44px] items-center underline">Food cost</Link>.</> : null}{tenantId ? <> Show it on a screen: <a href={`/drive-thru/${tenantId}/menu`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center underline">open the menu board</a>.</> : null}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {outCount > 0 && <span className="rounded-full px-3 py-1.5 text-[14px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{outCount} with something sold out</span>}
            {canEdit && <button type="button" onClick={() => setAdding(true)} className={`min-h-[44px] rounded-xl px-5 text-[15px] font-semibold ${RING}`} style={{ background: INK, color: '#fff' }}>New item</button>}
          </div>
        </header>
        {canEdit && (
          <div role="tablist" aria-label="The menu" className="flex flex-wrap gap-2">
            {([['items', 'Items'], ['sets', 'Choice sets'], ['settings', 'Settings']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} aria-controls={`menu-${t}`} id={`tab-${t}`} onClick={() => setTab(t)}
                className={`min-h-[44px] rounded-xl border px-4 text-[14.5px] font-semibold ${RING}`} style={tab === t ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{label}</button>))}
          </div>
        )}
        {canEdit && tab === 'sets' && <div id="menu-sets" role="tabpanel" aria-labelledby="tab-sets"><ChoiceSetsPanel call={call} openId={openSet} onOpened={() => setOpenSet(null)} onChanged={() => void loadAll()} /></div>}
        {canEdit && tab === 'settings' && <div id="menu-settings" role="tabpanel" aria-labelledby="tab-settings" className="space-y-5">
          <p className="text-[14.5px]" style={{ color: MUTED }}>How the menu is ordered from and made: ordering ahead, menus by time of day, table service, service times and prep recipes.</p>
        {canEdit && ahead && <div id="order-ahead" className="scroll-mt-6"><OrderAheadCard start={ahead} call={call} /></div>}
        {canEdit && times && <div id="menu-times" className="scroll-mt-6"><MenuTimesCard start={times} onSave={async (next) => { const d = await call({ action: 'times', ...next }); if (d.ok) { setTimes({ dayparts: d.dayparts, happyHour: d.happyHour }); return null; } return d.error || 'That didn’t save.'; }} /></div>}
        {canEdit && service && <div id="table-service" className="scroll-mt-6"><TableServiceSettings service={service} onSave={async (next) => { const d = await call({ action: 'service', ...next }); if (d.ok) { setService(d.service); return null; } return d.error || 'That didn’t save.'; }} /></div>}
        {canEdit && targets && (
          <section id="service-times" aria-labelledby="times-title" className="scroll-mt-6 rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
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
              {pickupOnly !== null && (
                <div role="group" aria-labelledby="lane-kind" className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span id="lane-kind" className="block text-[15px] font-medium">Your drive-thru</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>{pickupOnly ? 'Cars pick up orders placed ahead (Ordering ahead, above). The lane screen finds them by code or name, nobody orders at the speaker, and the voice assistant stays off.' : 'Cars order at the speaker and pay at the window. Orders placed ahead are picked up there too.'}</span>
                    {pickupOnly && !aheadThere && <span className="mt-1 block text-[13px] font-medium" style={{ color: AMBER }}>Ordering ahead isn’t on for the drive-thru, so cars still order at the speaker. Turn it on under Ordering ahead to make the drive-thru pickup only.</span>}</span>
                  <span className="flex flex-wrap gap-2">
                    {([[false, 'Orders and pickup'], [true, 'Pickup only']] as [boolean, string][]).map(([v, label]) => { const on = pickupOnly === v; return (
                      <button key={label} type="button" aria-pressed={on} aria-disabled={busy === 'pickupOnly'} onClick={() => { if (!on && busy !== 'pickupOnly') void setPickupOnly(v); }} className={`${BTN} aria-disabled:opacity-50`}
                        style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{label}</button>); })}
                  </span>
                </div>
              )}
              {readyTexts !== null && (
                <div role="group" aria-labelledby="ready-texts" className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span id="ready-texts" className="block text-[15px] font-medium">A text when it’s ready</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>{readyTexts ? 'Guests can ask for one text when their order is ready: at the kiosk, ordering ahead, or at the counter. Only if they ask, and never for anything else.' : 'Guests aren’t offered a text when their order is ready. The counter calls it out, and the ready board shows it.'}</span></span>
                  <span className="flex flex-wrap gap-2">
                    {([[true, 'Offer it'], [false, 'Don’t offer it']] as [boolean, string][]).map(([v, label]) => { const on = readyTexts === v; return (
                      <button key={label} type="button" aria-pressed={on} aria-disabled={busy === 'readyTexts'} onClick={() => { if (!on && busy !== 'readyTexts') void setTexts(v); }} className={`${BTN} aria-disabled:opacity-50`}
                        style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{label}</button>); })}
                  </span>
                </div>
              )}
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
                    <span className="block text-[13px]" style={{ color: MUTED }}>{voice.setUp ? 'Greets each car and takes the order. The team can listen in and take over from the lane screen.' : voice.canSetUp ? 'Takes each car’s order at the speaker. The team can listen in and take over at any time.' : 'Needs the voice service connected before it can be set up.'}{pickupOnly && aheadThere && voice.setUp ? ' Off while your drive-thru is pickup only.' : ''}</span></span>
                  {voice.setUp ? <Switch on={voice.on} label="Voice assistant at the drive-thru speaker" busy={busy === 'voice'} onClick={() => setVoiceOn(!voice.on)} color={GREEN} />
                    : voice.canSetUp && <button type="button" onClick={setUpVoice} disabled={busy === 'voice'} className={BTN} style={{ background: INK, color: '#fff' }}>{busy === 'voice' ? 'Setting up…' : 'Set it up'}</button>}
                </div>
              )}
              {voice?.setUp && voice.outdated && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: AMBER_TINT }}>
                  <span className="text-[14px]" style={{ color: AMBER }}>There’s a newer version of the assistant: it offers a bigger size or something to go with it, only as you choose below, and can make what was just ordered bigger.</span>
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
              {voice?.setUp && (
                <div role="group" aria-labelledby="voice-offers" className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
                  <span><span id="voice-offers" className="block text-[15px] font-medium">What the assistant offers</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>A bigger size or something to go with it, from what each item offers under Offered at the end. One short question, never while the line is long.{voice.offersReady === false ? (voice.outdated ? ' Update the assistant first: until then it doesn’t offer.' : ' This assistant doesn’t offer yet.') : ''}</span></span>
                  <span className="flex flex-wrap gap-2">
                    {VOICE_OFFER_MODES.map((o) => { const on = (voice.offers || 'item') === o.value; return (
                      <button key={o.value} type="button" aria-pressed={on} aria-disabled={busy === 'offers'} onClick={() => { if (!on && busy !== 'offers') void setOffers(o.value); }} className={`${BTN} aria-disabled:opacity-50`}
                        style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{o.label}</button>); })}
                  </span>
                </div>
              )}
            </div>}
          </section>
        )}
        {canEdit && preps && <div id="prep-recipes" className="scroll-mt-6"><PrepRecipes preps={preps} call={call}
          onSaved={() => { void call({ action: 'list' }).then((d) => { if (d.ok) { setCosts(d.costs || {}); setChanges(d.changes || {}); setPreps(Array.isArray(d.preps) ? d.preps : null); setRecipes(d.recipes || {}); } }); }} /></div>}
        </div>}
        {(!canEdit || tab === 'items') && <div id="menu-items" role={canEdit ? 'tabpanel' : undefined} aria-labelledby={canEdit ? 'tab-items' : undefined} className="space-y-5">
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
                          {!m.from && !(m.price > 0) ? <span className="rounded-full px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Needs a price</span>
                            : <span className="text-[14.5px] tabular-nums" style={{ color: MUTED }}>{m.from ? `from ${money(m.startPrice)}` : money(m.price)}</span>}
                          {!m.onMenu && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: SOFT, color: MUTED }}>Not on the menu</span>}
                          {m.membersOnly && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: SOFT, color: MUTED }}>Members</span>}
                          {!m.inStock && !m.soldOut && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{outWords(m)}</span>}
                          {counts[m.id] && !m.soldOut && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-medium tabular-nums" style={lowCount(counts[m.id]) ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: MUTED }}>{leftWords(counts[m.id])} tonight</span>}
                          {costs[m.id]?.over && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Over {Math.round(costs[m.id].target * 100)}%</span>}
                        </span>
                        <span className="mt-0.5 block text-[13.5px]" style={{ color: outOpts.length ? AMBER : MUTED }}>
                          {outOpts.length ? `Sold out: ${outOpts.join(', ')}` : m.choices.length ? m.choices.map((g) => g.name).join(', ') : 'No choices'}
                        </span>
                        {costs[m.id] && <span className="mt-0.5 block text-[13px] tabular-nums" style={{ color: MUTED }}>{costWords(costs[m.id])}</span>}
                        {(costs[m.id]?.thin || []).length > 0 && <span className="mt-0.5 block text-[13px] font-semibold" style={{ color: AMBER }}>{costs[m.id].thin!.join(', ')} barely {costs[m.id].thin!.length === 1 ? 'pays' : 'pay'} for {costs[m.id].thin!.length === 1 ? 'itself' : 'themselves'}</span>}
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
        </div>}
      </div>
      {adding && <NewItemSheet sections={Array.from(new Set((menu || []).map((m) => m.section)))} stations={service?.stations || []} onClose={() => setAdding(false)}
        onCreate={async (body) => { const d = await call({ action: 'create', ...body }); if (!d.ok) return d.error || 'That didn’t save.';
          setMenu((xs) => [...(xs || []).filter((x) => x.id !== d.item.id), d.item].sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))); setAdding(false); setFresh(true); setEditing(d.item); return null; }} />}
      {editing && (canEdit
        ? <ItemBuilder key={editing.id} item={editing} recipe={recipes[editing.id] || []} changes={changes[editing.id] || {}} tenantId={tenantId} service={service} dayparts={times?.dayparts || []} allItems={menu || []} sets={sets}
            aim={costs[editing.id]?.target ?? Object.values(costs)[0]?.target ?? DEFAULT_TARGET} startStep={fresh ? 2 : 1} busy={busy} call={call}
            onClose={() => { setEditing(null); setFresh(false); }}
            onOpenSet={(id) => { setEditing(null); setFresh(false); setTab('sets'); setOpenSet(id); }}
            onSoldOut={(g, o, out) => { void soldOut(editing, out, g, o).then((it) => { if (it) setEditing(it); }); }}
            onSave={async (patch) => { const d = await call({ action: 'save', itemId: editing.id, item: patch }); if (d.ok) { put(d.item); if (Array.isArray(d.recipe)) setRecipes((r) => ({ ...r, [editing.id]: d.recipe })); if (d.changes) setChanges((c) => ({ ...c, [editing.id]: d.changes })); setEditing(null); setFresh(false);
              void call({ action: 'counts' }).then((c) => { if (c.ok) setCounts(Object.fromEntries((c.counts || []).map((r: CountRow) => [r.id, r]))); }); return null; } return d.error || 'That didn’t save.'; }} />
        : <SoldOutSheet item={editing} busy={busy} onClose={() => setEditing(null)} onSoldOut={(g, o, out) => { void soldOut(editing, out, g, o).then((it) => { if (it) setEditing(it); }); }} />)}
    </div>
  );
}

/** For the team: an item's choices to mark sold out tonight (a manager changes the rest). */
function SoldOutSheet({ item, busy, onClose, onSoldOut }: { item: MenuItem; busy: string | null; onClose: () => void; onSoldOut: (groupId: string, optionId: string, out: boolean) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = was; opener?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="edit-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[#fff] p-6 sm:max-w-2xl sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="edit-title" className="text-[22px] font-semibold">{item.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
        </div>
        <p className="mt-3 text-[15px]" style={{ color: MUTED }}>A manager can change the price and choices. You can mark choices sold out below.</p>
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
