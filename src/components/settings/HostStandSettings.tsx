'use client';
// src/components/settings/HostStandSettings.tsx — THE HOST STAND'S OWN SETTINGS (design canvas HostSettings), on Hosting
// settings: how long a table usually stays here by party size (a café and a tasting menu are very different), the
// check-to-leaving and clearing times, who to seat next, spreading tables across servers, and how early to text the
// next party (lib/table-stage). And the wait list from the guest's phone (lib/wait-line): off until the business turns
// it on; how long a table's held after we text, asking for more time, and a drink while they wait (which drinks, and
// whether the bar makes it when they sit down or when we text them). Saved by api/host/floor (a manager).
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { DEFAULT_FLOOR, type FloorSettings } from '@/lib/table-stage';
import { DEFAULT_WAIT, MAX_SECTIONS, sectionKey, type WaitSettings } from '@/lib/wait-line';
import { isDrinkItem } from '@/lib/table-service';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', RED = '#b42318';
const field = 'h-11 rounded-xl border px-3 text-[15px] outline-none bg-[#fff]';
const row = 'flex flex-wrap items-center justify-between gap-3 min-h-[60px] py-2';
const mins = (list: number[], cur: number) => Array.from(new Set([...list, cur])).sort((a, b) => a - b);

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="relative h-8 w-14 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2" style={{ background: on ? INK : LINE }}>
      <span className="absolute top-[3px] h-[26px] w-[26px] rounded-full bg-[#fff] transition-all" style={{ left: on ? 27 : 3 }} />
    </button>
  );
}
function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl border p-1" style={{ borderColor: LINE }}>
      {options.map(([v, w]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className="min-h-[44px] rounded-lg px-3 text-[14px] font-semibold" style={value === v ? { background: INK, color: '#fff' } : { color: MUTED }}>{w}</button>)}
    </div>
  );
}
const Label = ({ title, hint }: { title: string; hint?: string }) => (
  <span className="min-w-[220px] flex-1"><span className="block text-[14.5px] font-medium">{title}</span>{hint && <span className="block text-[13px] leading-snug" style={{ color: MUTED }}>{hint}</span>}</span>
);

export function HostStandSettings({ firestore, tenantId, tenant }: { firestore: Firestore | null; tenantId: string | null; tenant: any }) {
  const start = React.useMemo(() => ({ floor: { ...DEFAULT_FLOOR, ...(tenant?.hostingSettings?.floor || {}) } as FloorSettings, wait: { ...DEFAULT_WAIT, ...(tenant?.hostingSettings?.wait || {}) } as WaitSettings }), [tenant]);
  const [floor, setFloor] = React.useState<FloorSettings>(start.floor);
  const [wait, setWait] = React.useState<WaitSettings>(start.wait);
  const [saved, setSaved] = React.useState(JSON.stringify(start));
  const [sections, setSections] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState(''); const [err, setErr] = React.useState('');
  React.useEffect(() => { setFloor(start.floor); setWait(start.wait); setSaved(JSON.stringify(start)); }, [start]);
  // The menu's sections, for "Which drinks": the drinks sections first.
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    getDocs(query(collection(firestore, `tenants/${tenantId}/inventory`), where('type', '==', 'refreshment'))).then((snap) => {
      const seen = new Map<string, { name: string; drink: boolean }>();
      for (const d of snap.docs) { const x: any = d.data() || {}; const name = String(x.section || x.menuSection || x.category || '').trim(); if (!name) continue;
        const k = sectionKey(name); const cur = seen.get(k); seen.set(k, { name: cur?.name || name, drink: !!cur?.drink || isDrinkItem(x) }); }
      setSections(Array.from(seen.values()).sort((a, b) => Number(b.drink) - Number(a.drink) || a.name.localeCompare(b.name)).map((x) => x.name).slice(0, 30));
    }).catch(() => {});
  }, [firestore, tenantId]);
  const changed = JSON.stringify({ floor, wait }) !== saved;
  const F = <K extends keyof FloorSettings>(k: K, v: FloorSettings[K]) => setFloor((f) => ({ ...f, [k]: v }));
  const W = <K extends keyof WaitSettings>(k: K, v: WaitSettings[K]) => setWait((w) => ({ ...w, [k]: v }));
  const picked = new Set(wait.sections.map(sectionKey));
  const toggleSection = (name: string) => W('sections', picked.has(sectionKey(name)) ? wait.sections.filter((x) => sectionKey(x) !== sectionKey(name)) : [...wait.sections, name].slice(0, MAX_SECTIONS));

  const save = async () => {
    if (!tenantId) return; setBusy(true); setErr(''); setNote('');
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r = await fetch('/api/host/floor', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'settings', floor, wait }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' }));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t save.'); return; }
    setFloor(r.floor); setWait(r.wait); setSaved(JSON.stringify({ floor: r.floor, wait: r.wait }));
    setNote('Saved. The host stand picks it up within a few seconds.');
  };

  return (
    <div className="space-y-5" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <section aria-labelledby="hs-floor" className="rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
        <h2 id="hs-floor" className="text-[18px] font-semibold">Seating and table times</h2>
        <p className="mb-2 text-[13.5px] leading-snug" style={{ color: MUTED }}>How long tables usually stay, so free times and wait quotes match your room. A café and a tasting menu are very different here.</p>
        <div className="space-y-2 border-t py-3" style={{ borderColor: LINE }}>
          <Label title="How long a table usually stays" hint="By party size. Each table’s free time starts from this, then follows where it is in its meal." />
          <div className="grid grid-cols-3 gap-2">
            {([['turnSmall', '1 or 2 guests'], ['turnMid', '3 or 4 guests'], ['turnLarge', '5 or more']] as [keyof FloorSettings, string][]).map(([k, w]) => (
              <label key={k} className="block"><span className="sr-only">{w}</span>
                <select value={floor[k] as number} onChange={(e) => F(k, Number(e.target.value) as any)} className={`${field} w-full`} style={{ borderColor: LINE }}>
                  {mins([20, 30, 40, 45, 50, 60, 65, 75, 80, 90, 105, 120, 150, 180, 240], floor[k] as number).map((n) => <option key={n} value={n}>{n} min</option>)}
                </select>
                <span className="mt-1 block text-[12.5px]" style={{ color: MUTED }}>{w}</span></label>))}
          </div>
        </div>
        <label className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="From asking for the check to leaving" hint="Used once a table asks for the check" />
          <select value={floor.payMin} onChange={(e) => F('payMin', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{mins([3, 5, 8, 10, 15, 20, 30], floor.payMin).map((n) => <option key={n} value={n}>{n} min</option>)}</select></label>
        <label className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Clearing and resetting a table" hint="The table shows “Being cleared” this long after guests leave. Off if it’s ready right away." />
          <select value={floor.clearMin} onChange={(e) => F('clearMin', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{mins([0, 1, 2, 3, 5, 8, 10, 15], floor.clearMin).map((n) => <option key={n} value={n}>{n ? `${n} min` : 'Off'}</option>)}</select></label>
        <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Who to seat next" hint="Anyone waiting past the time they were told always comes first" />
          <Seg label="Who to seat next" value={floor.seatOrder} onChange={(v) => F('seatOrder', v)} options={[['longest', 'Longest wait'], ['fit', 'Best fit']]} /></div>
        <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Spread tables across servers" hint="When two tables fit, suggest the one in the section with the fewest guests" />
          <Switch label="Spread tables across servers" on={floor.balance} onChange={(v) => F('balance', v)} /></div>
        <label className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Text the next party ahead" hint="Suggest holding a table and texting them this long before it’s free" />
          <select value={floor.textAheadMin} onChange={(e) => F('textAheadMin', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{mins([0, 2, 3, 5, 8, 10, 15], floor.textAheadMin).map((n) => <option key={n} value={n}>{n ? `${n} min` : 'Only once it’s free'}</option>)}</select></label>
      </section>

      <section aria-labelledby="hs-wait" className="rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE }}>
        <h2 id="hs-wait" className="text-[18px] font-semibold">Wait list from their phone</h2>
        <p className="mb-2 text-[13.5px] leading-snug" style={{ color: MUTED }}>Off until you turn it on. Guests added with a mobile number get a text with their own link.</p>
        <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Send waiting guests a link" hint="Their place in line and a wait time that updates, “Leave the list” and “Need more time”" />
          <Switch label="Send waiting guests a link" on={wait.link} onChange={(v) => W('link', v)} /></div>
        <label className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Hold a table after we text" hint="Then the host sees they haven’t come back" />
          <select value={wait.holdMin} onChange={(e) => W('holdMin', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{mins([3, 5, 8, 10, 15, 20, 30], wait.holdMin).map((n) => <option key={n} value={n}>{n} min</option>)}</select></label>
        <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="Asking for more time" hint="Each time moves them back this long, and lets a held table go to the next party" />
          <div className="flex gap-2">
            <select aria-label="How often" value={wait.moreTimes} onChange={(e) => W('moreTimes', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{[[0, 'Not at all'], [1, 'Once'], [2, 'Twice'], [3, 'Three times']].map(([n, w]) => <option key={n} value={n}>{w}</option>)}</select>
            {wait.moreTimes > 0 && <select aria-label="How long" value={wait.moreMin} onChange={(e) => W('moreMin', Number(e.target.value))} className={field} style={{ borderColor: LINE }}>{mins([5, 10, 15, 20, 30], wait.moreMin).map((n) => <option key={n} value={n}>{n} min</option>)}</select>}
          </div></div>
        <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="A drink while they wait" hint="Ordered from their link, it goes on their table’s check" />
          <Switch label="A drink while they wait" on={wait.preorder} onChange={(v) => W('preorder', v)} /></div>
        {wait.preorder && <>
          <div className={`${row} border-t`} style={{ borderColor: LINE }}><Label title="When the bar makes it" hint={wait.drinksWhen === 'ready' ? 'Ready as they sit. If they leave the list, drinks not taken out yet come off.' : 'Nothing is made for someone who leaves the list.'} />
            <Seg label="When the bar makes it" value={wait.drinksWhen} onChange={(v) => W('drinksWhen', v)} options={[['seated', 'When they sit down'], ['ready', 'When we text them']]} /></div>
          <div className="space-y-2 border-t py-3" style={{ borderColor: LINE }}>
            <Label title="Which drinks" hint="None picked: everything in a drinks section. Items with choices to make (a size, a milk) are ordered at the table." />
            {sections.length === 0 ? <p className="text-[13.5px]" style={{ color: MUTED }}>Your menu’s sections show here once it has items.</p>
              : <div className="flex flex-wrap gap-2">{sections.map((name) => { const on = picked.has(sectionKey(name)); return (
                <button key={name} type="button" aria-pressed={on} onClick={() => toggleSection(name)} className="min-h-[44px] rounded-full border px-3 text-[13.5px] font-medium" style={on ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{name}</button>); })}</div>}
          </div>
        </>}
      </section>

      {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
      {note && !changed && <p role="status" className="text-[14px]" style={{ color: MUTED }}>{note}</p>}
      <button type="button" disabled={!changed || busy || !tenantId} onClick={save} className="min-h-[48px] w-full rounded-2xl px-6 text-[15px] font-semibold text-[#fff] disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save host stand settings'}</button>
    </div>
  );
}
