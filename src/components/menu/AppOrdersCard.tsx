'use client';
// src/components/menu/AppOrdersCard.tsx — DELIVERY APP ORDERS, ON THE MENU PAGE'S SETTINGS (lib/app-orders; api/menu
// 'apps'; design board "Delivery app orders"). On or off, the apps the business takes orders from (and another by name),
// and how many spots its pickup shelf has. Orders are rung in at the counter (App order). For each app (design board
// "App orders in the books at the app's price"): how much higher its prices are, the share it keeps, and whether it
// collects and pays the sales tax.
import { useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const APPS = [{ code: 'doordash', label: 'DoorDash' }, { code: 'ubereats', label: 'Uber Eats' }, { code: 'grubhub', label: 'Grubhub' }];
const SHELVES = [4, 8, 12, 16];
const MARKUPS = [0, 10, 15, 20, 25, 30];
export type AppMoney = { markupPct: number; feePct: number | null; appPaysTax: boolean };
export type AppSettings = { on: boolean; apps: string[]; otherName: string; shelves: number; money?: Record<string, AppMoney> };

/** One app's money: its prices on the app, the share it keeps (empty: not set), and who pays the sales tax. */
function AppMoneyRow({ code, label, m, busy, onSave }: { code: string; label: string; m: AppMoney; busy: boolean; onSave: (patch: Partial<AppMoney>) => void }) {
  const [fee, setFee] = useState(m.feePct === null ? '' : String(m.feePct));
  const saveFee = () => { const v = fee.trim(); const was = m.feePct === null ? '' : String(m.feePct); if (v === was) return; onSave({ feePct: v === '' ? null : Number(v) }); };
  return (
    <div className="space-y-2 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}>
      <p className="text-[15px] font-semibold">{label}</p>
      <div role="radiogroup" aria-labelledby={`app-${code}-prices`}>
        <p id={`app-${code}-prices`} className="text-[13.5px] font-semibold">Your prices on {label}</p>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {MARKUPS.map((n) => { const on = m.markupPct === n; return (
            <button key={n} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onSave({ markupPct: n })}
              className={`min-h-[44px] rounded-xl text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={on ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff', color: INK }}>{n ? `+${n}%` : 'Same'}</button>); })}
        </div>
      </div>
      <label className="block text-[13.5px] font-semibold" htmlFor={`app-${code}-fee`}>What {label} keeps</label>
      <div className="flex items-center gap-2">
        <input id={`app-${code}-fee`} value={fee} inputMode="decimal" disabled={busy} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} onBlur={saveFee} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveFee(); } }}
          aria-describedby={`app-${code}-fee-help`} placeholder="15" className={`min-h-[44px] w-[90px] rounded-xl px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}` }} />
        <span className="text-[14.5px]">% of each order</span>
      </div>
      <p id={`app-${code}-fee-help`} className="text-[13px]" style={{ color: MUTED }}>From your {label} agreement. Left empty, the whole sale is counted as coming in the payout.</p>
      <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
        <input type="checkbox" checked={m.appPaysTax} disabled={busy} onChange={(e) => onSave({ appPaysTax: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />{label} collects and pays the sales tax
      </label>
      <p className="text-[13px]" style={{ color: MUTED }}>{m.appPaysTax ? 'Most apps do, so none is booked here.' : 'You pay it: it’s booked with each order’s sale and comes in the payout.'}</p>
    </div>);
}

export function AppOrdersCard({ start, call }: { start: AppSettings; call: (body: any) => Promise<any> }) {
  const [a, setA] = useState<AppSettings>(start);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [other, setOther] = useState(start.otherName);
  const save = async (k: string, patch: Partial<AppSettings> | { money: { app: string } & Partial<AppMoney> }) => {
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
      {a.apps.some((x) => x !== 'other' || !!a.otherName) && <div className="space-y-2.5">
        <p className="text-[14px] font-semibold">Each app’s prices, share and sales tax</p>
        {[...APPS.filter((x) => a.apps.includes(x.code)), ...(a.apps.includes('other') && a.otherName ? [{ code: 'other', label: a.otherName }] : [])].map((x) => (
          <AppMoneyRow key={x.code} code={x.code} label={x.label} m={a.money?.[x.code] || { markupPct: 0, feePct: null, appPaysTax: true }} busy={!!busy} onSave={(patch) => save(`money-${x.code}`, { money: { app: x.code, ...patch } })} />))}
      </div>}
      <p className="text-[13px]" style={{ color: MUTED }}>Each order goes in the books when the courier picks it up: at the app’s price, with the app’s share on its own line. Check each week’s payout on the Money page.</p>
      {err && <p role="alert" className="text-[13.5px] font-medium" style={{ color: 'var(--warn-ink)' }}>{err}</p>}
    </section>
  );
}
