'use client';
// src/app/(app)/settings/closing/page.tsx — SETTINGS → CLOSING THE NIGHT (lib/night-close, saved through api/close
// 'settings'): the closing checklist (things to tick and temperatures to log, each with its limit and the area that does
// it, so the kitchen screen shows the kitchen's), whether the night can close before the checklist is done, who gets the
// night's report by email, and whether the night's tip shares are approved when a manager closes. Also the dish machine
// check the dish screen asks for (lib/dish, saved through api/back 'settings').
import * as React from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { SettingsPage, Section, Row, Toggle, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { AREAS, MAX_ITEMS, type CloseArea, type CloseItem, type CloseSettings } from '@/lib/night-close';
import { DEFAULT_DISH, EVERY_CHOICES, dishSettingsOf, type DishSettings } from '@/lib/dish';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
type Edit = { id: string; label: string; kind: 'check' | 'temp'; area: CloseArea; maxF: string; minF: string };
const toEdit = (i: CloseItem): Edit => ({ id: i.id, label: i.label, kind: i.kind, area: i.area, maxF: i.maxF === null || i.maxF === undefined ? '' : String(i.maxF), minF: i.minF === null || i.minF === undefined ? '' : String(i.minF) });
const everyWords = (h: number) => (h === 0 ? 'Once a day' : `Every ${h} hours`);

/** The dish machine check (lib/dish): which machine, its limits, and how often the dish screen asks for a reading. */
function DishMachine({ tenant, manager }: { tenant: any; manager: boolean }) {
  const [d, setD] = React.useState<DishSettings>(() => dishSettingsOf(tenant));
  const [minF, setMinF] = React.useState(String(d.minF)); const [lo, setLo] = React.useState(String(d.ppmMin)); const [hi, setHi] = React.useState(String(d.ppmMax));
  const [dirty, setDirty] = React.useState(false); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  const change = (patch: Partial<DishSettings>) => { setD({ ...d, ...patch }); setDirty(true); setMsg(''); };
  const save = async () => {
    setBusy(true); setErr('');
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    try {
      const r = await fetch('/api/back', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId: tenant.id, action: 'settings', dish: { ...d, minF: Number(minF), ppmMin: Number(lo), ppmMax: Number(hi) } }) });
      const x = await r.json().catch(() => ({}));
      if (x.ok) { setD(x.dish); setDirty(false); setMsg('Saved.'); } else setErr(x.error || 'That didn’t save.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  };
  const num = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); setDirty(true); setMsg(''); };
  return (
    <Section title="Dish machine check" help="The dish screen asks for a reading at the start of the day and then as often as you choose. One outside the limits asks what was done, and the owner and managers are told at once. The last 30 days print from the dish screen.">
      <Row label="Ask for readings" inline><Toggle checked={d.on} onChange={(v) => change({ on: v })} label="Ask for dish machine readings" disabled={!manager} /></Row>
      {d.on && (<>
        <div className="flex flex-wrap items-center gap-2 py-2 text-[14px]">
          <select value={d.machine} onChange={(e) => change({ machine: e.target.value === 'chemical' ? 'chemical' : 'hot' })} aria-label="Which machine" className={`${cfInput} w-auto`} style={cfInputStyle} disabled={!manager}>
            <option value="hot">Hot water, final rinse temperature</option><option value="chemical">Chemical, sanitizer strength</option></select>
          <select value={d.everyHours} onChange={(e) => change({ everyHours: Number(e.target.value) })} aria-label="How often" className={`${cfInput} w-auto`} style={cfInputStyle} disabled={!manager}>
            {EVERY_CHOICES.map((h) => <option key={h} value={h}>{everyWords(h)}</option>)}</select>
        </div>
        {d.machine === 'hot'
          ? <div className="flex flex-wrap items-center gap-2 text-[14px]"><span className="cf-muted">At least</span><input inputMode="numeric" value={minF} onChange={num(setMinF)} aria-label="Lowest final rinse, °F" className={`${cfInput} w-20`} style={cfInputStyle} disabled={!manager} /><span className="cf-muted">°F</span></div>
          : <div className="flex flex-wrap items-center gap-2 text-[14px]"><span className="cf-muted">From</span><input inputMode="numeric" value={lo} onChange={num(setLo)} aria-label="Lowest sanitizer, ppm" className={`${cfInput} w-20`} style={cfInputStyle} disabled={!manager} />
              <span className="cf-muted">to</span><input inputMode="numeric" value={hi} onChange={num(setHi)} aria-label="Highest sanitizer, ppm" className={`${cfInput} w-20`} style={cfInputStyle} disabled={!manager} /><span className="cf-muted">ppm</span></div>}
        <p className="text-[13px] cf-muted pt-2">Usual: a final rinse of at least {DEFAULT_DISH.minF}°F, or {DEFAULT_DISH.ppmMin} to {DEFAULT_DISH.ppmMax} ppm of chlorine. Your machine’s data plate and your local health code say what yours needs.</p>
      </>)}
      {manager && <div className="flex items-center gap-3 pt-2"><button type="button" disabled={!dirty || busy} onClick={save} className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{busy ? 'Saving…' : 'Save machine check'}</button>
        {msg && <span className="text-[14px] cf-muted" role="status">{msg}</span>}{err && <span className="text-[14px] font-semibold" style={{ color: '#b42318' }} role="alert">{err}</span>}</div>}
    </Section>
  );
}

const PRESET: { label: string; maxF: string; minF: string }[] = [{ label: 'Fridge, at most 41°F', maxF: '41', minF: '' }, { label: 'Freezer, at most 0°F', maxF: '0', minF: '' }, { label: 'Hot holding, at least 135°F', maxF: '', minF: '135' }];

export default function ClosingSettings() {
  const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const [s, setS] = React.useState<CloseSettings | null>(null); const [items, setItems] = React.useState<Edit[]>([]);
  const [manager, setManager] = React.useState(false); const [dirty, setDirty] = React.useState(false); const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState(''); const [newTo, setNewTo] = React.useState('');
  React.useEffect(() => { if (!tenantId) return; void post({ tenantId, action: 'state', lite: true }).then((d) => { if (d.ok) {
    // Until the business saves its own checklist, the usual one doesn't hold up closing; once saved, it does unless switched off.
    setS(d.settingsSaved ? d.settings : { ...d.settings, requireChecklist: true }); setItems(d.settings.items.map(toEdit)); setManager(!!d.manager); } else setErr(d.error || 'That didn’t load.'); }); }, [tenantId]);
  if (!s) return <SettingsPage title="Closing the night"><p className="cf-muted">{err || 'Loading…'}</p></SettingsPage>;
  const set = (patch: Partial<CloseSettings>) => { setS({ ...s, ...patch }); setDirty(true); setMsg(''); };
  const setItem = (i: number, patch: Partial<Edit>) => { setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); setMsg(''); };
  const save = async () => { setBusy(true); setErr('');
    const d = await post({ tenantId, action: 'settings', requireChecklist: s.requireChecklist, approveTips: s.approveTips, reportTo: s.reportTo,
      items: items.map((x) => ({ id: x.id, label: x.label, kind: x.kind, area: x.area, ...(x.kind === 'temp' ? { maxF: x.maxF === '' ? null : Number(x.maxF), minF: x.minF === '' ? null : Number(x.minF) } : {}) })) });
    setBusy(false); if (d.ok) { setS(d.settings); setItems(d.settings.items.map(toEdit)); setDirty(false); setMsg('Saved.'); } else setErr(d.error || 'That didn’t save.'); };
  const blankLimit = items.some((x) => x.kind === 'temp' && x.maxF === '' && x.minF === '');
  return (
    <SettingsPage title="Closing the night" help={<>What gets checked before the night closes, and who hears how it went. Closing happens on <Link href="/close" className="underline underline-offset-4">Close the night</Link>.</>}
      actions={manager ? <button type="button" disabled={!dirty || busy || blankLimit || items.some((x) => !x.label.trim())} onClick={save} className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--card)' }}>Save</button> : null}>
      {!manager && <p className="cf-muted text-[14px]">Only a manager can change these.</p>}
      {err && <p className="text-[14px] font-semibold" style={{ color: '#b42318' }} role="alert">{err}</p>}
      {msg && <p className="text-[14px] cf-muted" role="status">{msg}</p>}

      <Section title="Closing checklist" help="Things to tick and temperatures to log. A reading outside its limit asks what was done about it, and is flagged on the night’s report. Each item belongs to an area, so the kitchen screen shows the kitchen’s and the bar’s, and the dish screen the dish pit’s.">
        {items.map((x, i) => (
          <div key={x.id + i} className="py-3 space-y-2" style={{ borderTop: i ? '1px solid var(--line)' : undefined }}>
            <div className="flex flex-wrap items-center gap-2">
              <input value={x.label} onChange={(e) => setItem(i, { label: e.target.value.slice(0, 60) })} aria-label={`Item ${i + 1}`} className={`${cfInput} max-w-xs`} style={cfInputStyle} disabled={!manager} />
              <select value={x.kind} onChange={(e) => setItem(i, { kind: e.target.value as any })} aria-label="Kind" className={`${cfInput} w-auto`} style={cfInputStyle} disabled={!manager}><option value="check">Tick when done</option><option value="temp">Log a temperature</option></select>
              <select value={x.area} onChange={(e) => setItem(i, { area: e.target.value as CloseArea })} aria-label="Who does it" className={`${cfInput} w-auto`} style={cfInputStyle} disabled={!manager}>{AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
              {manager && <button type="button" onClick={() => { setItems(items.filter((_, j) => j !== i)); setDirty(true); }} className="min-h-[44px] px-3 text-[14px] font-semibold cf-muted">Remove</button>}
            </div>
            {x.kind === 'temp' && (
              <div className="flex flex-wrap items-center gap-2 text-[14px]">
                <span className="cf-muted">At most</span><input inputMode="decimal" value={x.maxF} onChange={(e) => setItem(i, { maxF: e.target.value.replace(/[^\d.-]/g, '').slice(0, 5) })} aria-label="Highest it can read, °F" className={`${cfInput} w-20`} style={cfInputStyle} disabled={!manager} /><span className="cf-muted">°F</span>
                <span className="cf-muted ml-2">At least</span><input inputMode="decimal" value={x.minF} onChange={(e) => setItem(i, { minF: e.target.value.replace(/[^\d.-]/g, '').slice(0, 5) })} aria-label="Lowest it can read, °F" className={`${cfInput} w-20`} style={cfInputStyle} disabled={!manager} /><span className="cf-muted">°F</span>
                {manager && PRESET.map((p) => <button key={p.label} type="button" onClick={() => setItem(i, { maxF: p.maxF, minF: p.minF })} className="min-h-[40px] rounded-full px-3 text-[12.5px] font-medium" style={{ background: 'var(--soft)' }}>{p.label}</button>)}
              </div>
            )}
          </div>
        ))}
        {manager && items.length < MAX_ITEMS && <button type="button" onClick={() => { setItems([...items, { id: `item-${Date.now().toString(36)}`, label: '', kind: 'check', area: 'anyone', maxF: '', minF: '' }]); setDirty(true); }} className="mt-2 min-h-[44px] rounded-xl border px-4 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Add an item</button>}
        {blankLimit && <p className="text-[13px]" style={{ color: '#b45309' }}>Give each temperature a limit.</p>}
        <p className="text-[13px] cf-muted pt-2">Usual limits: fridges at most 41°F, freezers at most 0°F, hot food at least 135°F. Check what your local health code asks for.</p>
      </Section>

      {selectedTenant && <DishMachine tenant={selectedTenant} manager={manager} />}

      <Section title="Closing">
        <Row label="Close only once the checklist is done" help="Off: a manager can close with items left; they show as not done on the report." inline>
          <Toggle checked={s.requireChecklist} onChange={(v) => set({ requireChecklist: v })} label="Close only once the checklist is done" disabled={!manager} />
        </Row>
        <Row label="Approve the night’s tips at close" help="When your tips are shared by the day (Money, tip sharing), closing approves that day’s shares so they go on each person’s pay record." inline>
          <Toggle checked={s.approveTips} onChange={(v) => set({ approveTips: v })} label="Approve the night’s tips at close" disabled={!manager} />
        </Row>
      </Section>

      <Section title="Who gets the report" help="Emailed when the night closes. Nobody listed: it goes to the business’s own email.">
        <div className="flex flex-wrap gap-2 items-center">
          {s.reportTo.map((x) => <span key={x} className="inline-flex min-h-[40px] items-center gap-1 rounded-full pl-3 pr-1 text-[14px]" style={{ background: 'var(--soft)' }}>{x}
            {manager && <button type="button" onClick={() => set({ reportTo: s.reportTo.filter((y) => y !== x) })} aria-label={`Remove ${x}`} className="h-9 w-9 rounded-full grid place-items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}</span>)}
          {manager && s.reportTo.length < 10 && <form onSubmit={(e) => { e.preventDefault(); const v = newTo.trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !s.reportTo.includes(v)) { set({ reportTo: [...s.reportTo, v] }); setNewTo(''); } }} className="flex gap-2">
            <input type="email" value={newTo} onChange={(e) => setNewTo(e.target.value)} placeholder="name@example.com" aria-label="Email to send the report to" className={`${cfInput} w-64`} style={cfInputStyle} />
            <button type="submit" className="min-h-[44px] rounded-xl border px-4 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Add</button></form>}
        </div>
      </Section>
    </SettingsPage>
  );
}
