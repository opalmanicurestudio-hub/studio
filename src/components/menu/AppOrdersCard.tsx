'use client';
// src/components/menu/AppOrdersCard.tsx — DELIVERY APP ORDERS, ON THE MENU PAGE'S SETTINGS (lib/app-orders; api/menu
// 'apps'; design board "Delivery app orders"). On or off, the apps the business takes orders from (and another by name),
// and how many spots its pickup shelf has. Orders are rung in at the counter (App order).
import { useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const APPS = [{ code: 'doordash', label: 'DoorDash' }, { code: 'ubereats', label: 'Uber Eats' }, { code: 'grubhub', label: 'Grubhub' }];
const SHELVES = [4, 8, 12, 16];
export type AppSettings = { on: boolean; apps: string[]; otherName: string; shelves: number };

export function AppOrdersCard({ start, call }: { start: AppSettings; call: (body: any) => Promise<any> }) {
  const [a, setA] = useState<AppSettings>(start);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [other, setOther] = useState(start.otherName);
  const save = async (k: string, patch: Partial<AppSettings>) => {
    setBusy(k); setErr('');
    const d = await call({ action: 'apps', ...patch });
    setBusy('');
    if (d.ok) { setA(d.apps); setOther(d.apps.otherName || ''); } else setErr(d.error || 'That didn’t save. Try again.');
  };
  const toggle = (code: string, on: boolean) => save(code, { apps: on ? [...a.apps, code] : a.apps.filter((x) => x !== code) });
  const anyApp = a.apps.some((x) => x !== 'other') || (a.apps.includes('other') && !!a.otherName);
  return (
    <section aria-labelledby="apps-title" className="space-y-4 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE, color: INK }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="apps-title" className="text-[16px] font-semibold">Delivery apps</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>Orders from DoorDash, Uber Eats or Grubhub are rung in at the counter with App order, from the same menu. Each goes to the kitchen to go, with the app’s order code and a spot on the pickup shelf.</p>
        </div>
        <button type="button" role="switch" aria-checked={a.on} aria-label="Delivery app orders" disabled={!!busy || (!a.on && !anyApp)} onClick={() => save('on', { on: !a.on })}
          className={`relative mt-0.5 h-7 w-12 flex-none rounded-full disabled:opacity-40 ${RING}`} style={{ background: a.on ? INK : '#c9cbcf' }}>
          <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full transition-all" style={{ left: a.on ? 23 : 3, background: '#fff' }} />
        </button>
      </div>
      <fieldset>
        <legend className="text-[14px] font-semibold">The apps you take orders from</legend>
        {APPS.map((x) => (
          <label key={x.code} className="flex min-h-[44px] items-center gap-3 text-[15px]">
            <input type="checkbox" checked={a.apps.includes(x.code)} disabled={!!busy} onChange={(e) => toggle(x.code, e.target.checked)} className="h-5 w-5 accent-[#16171a]" />{x.label}
          </label>))}
        <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
          <input type="checkbox" checked={a.apps.includes('other')} disabled={!!busy || !other.trim()} onChange={(e) => save('other', { apps: e.target.checked ? [...a.apps, 'other'] : a.apps.filter((x) => x !== 'other'), otherName: other })} className="h-5 w-5 accent-[#16171a]" />
          <span className="sr-only">Another app</span>
          <input value={other} onChange={(e) => setOther(e.target.value.slice(0, 24))} onBlur={() => { if (a.apps.includes('other') && other.trim() && other.trim() !== a.otherName) void save('otherName', { otherName: other }); }}
            placeholder="Another app: its name" aria-label="Another app’s name" className={`min-h-[44px] w-full max-w-[260px] rounded-xl px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}` }} />
        </label>
      </fieldset>
      <div role="radiogroup" aria-labelledby="apps-shelf">
        <p id="apps-shelf" className="text-[14px] font-semibold">Spots on the pickup shelf</p>
        <div className="mt-2 grid max-w-[320px] grid-cols-4 gap-1.5">
          {SHELVES.map((n) => { const on = a.shelves === n; return (
            <button key={n} type="button" role="radio" aria-checked={on} disabled={!!busy} onClick={() => save('shelves', { shelves: n })}
              className={`min-h-[44px] rounded-xl text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={on ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff', color: INK }}>{n}</button>); })}
        </div>
        <p className="mt-1.5 text-[13px]" style={{ color: MUTED }}>Spots A1 to A{a.shelves}. With every spot taken, an order waits at the counter.</p>
      </div>
      <p className="text-[13px]" style={{ color: MUTED }}>The app collects the sales tax on its orders, so none is added here. Each one goes in the books when the courier picks it up, as that app’s sale; the app pays you later, less its fees.</p>
      {err && <p role="alert" className="text-[13.5px] font-medium" style={{ color: 'var(--warn-ink)' }}>{err}</p>}
    </section>
  );
}
