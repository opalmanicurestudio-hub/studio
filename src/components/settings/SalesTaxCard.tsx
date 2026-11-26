'use client';
// src/components/settings/SalesTaxCard.tsx — SALES TAX (Settings → Payments; design board "Settings: sales tax, by
// location, and when you file"). What's added to a sale (products share the online shop's rate; services only when
// they're taxed; fees never), a location's own rates when its city or county charges another, and paying the state:
// how often, the day it's due, the reminder, and the last period's figures with its report (lib/sales-tax-filing,
// api/money/sales-tax). Until it's set, no tax is added at checkout.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useLocation } from '@/context/LocationContext';
import { businessLocations } from '@/lib/business-locations';
import { posTaxOf } from '@/lib/pos-tax';
import { filingOf, nextPeriod, periodOf, previousPeriod, type FilingEvery } from '@/lib/sales-tax-filing';
import { buildSalesTaxHtml } from '@/lib/report-builders';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: string) => { const n = Number(String(v).trim()); return String(v).trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 25 ? Math.round(n * 1000) / 1000 : null; };
type Own = { own: boolean; products: string; services: string };

async function api(body: any) {
  try {
    const r = await fetch('/api/money/sales-tax', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'No answer. Try again.' }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Pills<T extends string | boolean>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" disabled={disabled} aria-pressed={value === v} onClick={() => onChange(v)}
          className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={value === v ? { background: INK, color: '#fff', fontWeight: 600, border: `1px solid ${INK}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{l}</button>
      ))}
    </div>
  );
}

function Pct({ value, onChange, label, disabled, width = 96 }: { value: string; onChange: (v: string) => void; label: string; disabled: boolean; width?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" disabled={disabled}
        className={`h-11 rounded-xl px-3 text-[15px] ${RING}`} style={{ width, border: `1px solid ${LINE}`, color: INK }} />
      <span style={{ color: MUTED }}>%</span>
    </span>
  );
}

const Card = ({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) => (
  <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}`, color: INK }}>
    <h3 className="text-[16px] font-semibold">{title}</h3>
    {help && <p className="mt-0.5 text-[14px] leading-relaxed" style={{ color: MUTED }}>{help}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

export function SalesTaxCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const places = businessLocations((useLocation() as any)?.locations || []);
  const cur = posTaxOf(tenant); const st = tenant?.salesTax || {};
  // (A business from before still charged 7% on everything: shown as it is, to be checked and saved.)
  const [products, setProducts] = React.useState(cur.unset ? '' : String(cur.legacy ? tenant?.retailSettings?.taxRatePercent || 7 : cur.productsPct));
  const [servicesTaxed, setServicesTaxed] = React.useState<boolean>(cur.legacy || st.servicesTaxed === true);
  const [services, setServices] = React.useState(String(st.servicesPct ?? (cur.unset ? '' : cur.productsPct)));
  const [own, setOwn] = React.useState<Record<string, Own>>(() => Object.fromEntries(Object.entries(st.byLocation || {}).map(([id, x]: [string, any]) =>
    [id, { own: x?.productsPct !== undefined && x?.productsPct !== null, products: String(x?.productsPct ?? ''), services: String(x?.servicesTaxed ? x?.servicesPct ?? '' : 0) }])));
  const f0 = filingOf(tenant);
  const [every, setEvery] = React.useState<FilingEvery>(f0.every);
  const [dueDay, setDueDay] = React.useState(String(f0.dueDay));
  const [remind, setRemind] = React.useState(f0.remind);
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const p = pct(products), sv = servicesTaxed ? pct(services) : 0;
    if (p === null) { setMsg({ ok: false, text: 'Type your products rate, between 0 and 25%. Type 0 if nothing you sell is taxed.' }); return; }
    if (sv === null) { setMsg({ ok: false, text: 'Type your services rate, between 0 and 25%.' }); return; }
    const byLocation: Record<string, any> = {};
    for (const l of places) {
      const o = own[l.id]; if (!o?.own) continue;
      const lp = pct(o.products), ls = pct(o.services || '0');
      if (lp === null || ls === null) { setMsg({ ok: false, text: `Type ${l.name || 'that location'}’s rates, between 0 and 25%.` }); return; }
      byLocation[l.id] = { productsPct: lp, servicesTaxed: ls > 0, servicesPct: ls };
    }
    const d = Math.round(Number(dueDay));
    if (!Number.isFinite(d) || d < 1 || d > 31) { setMsg({ ok: false, text: 'Type the day it’s due, 1 to 31.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { 'retailSettings.taxRatePercent': p,
        salesTax: { ...st, configured: true, servicesTaxed, servicesPct: servicesTaxed ? sv : 0, byLocation, filing: { every, dueDay: d, remind }, updatedAt: new Date().toISOString() } });
      setMsg({ ok: true, text: 'Saved. Checkout adds these from the next sale.' });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'That didn’t save. Try again.' }); } finally { setBusy(false); }
  };

  const ro = !canEdit;
  return (
    <div className="space-y-4" id="sales-tax">
      <div>
        <h2 className="text-[20px] font-semibold" style={{ color: INK }}>Sales tax</h2>
        <p className="mt-0.5 max-w-[640px] text-[14px] leading-relaxed" style={{ color: MUTED }}>What’s added to a sale, at each of your locations, and when you pay it to the state. Fees for late cancellations, no-shows and balances are never taxed.</p>
      </div>
      {cur.legacy && (
        <div className="flex gap-3 rounded-2xl p-4" style={{ background: AMBER_TINT }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
          <div><p className="text-[15px] font-semibold" style={{ color: AMBER }}>Please check your rates</p>
            <p className="text-[14px]" style={{ color: MUTED }}>Checkout still adds 7% on everything, services included, until you save your rates here. Most states don’t tax services. Check with your accountant if you’re unsure what’s taxable where you are.</p></div>
        </div>
      )}
      {cur.unset && (
        <div className="flex gap-3 rounded-2xl p-4" style={{ background: AMBER_TINT }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
          <div><p className="text-[15px] font-semibold" style={{ color: AMBER }}>Sales tax isn’t set up yet</p>
            <p className="text-[14px]" style={{ color: MUTED }}>Nothing is added at checkout until your rates are in. Your state’s tax website lists the rate for your address.</p></div>
        </div>
      )}

      <Card title="Your rates" help="Your state’s rate and your city’s or county’s together.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[15px] font-semibold">Products</p>
            <Pct value={products} onChange={setProducts} label="Products rate" disabled={ro} />
            <p className="text-[13px]" style={{ color: MUTED }}>Also what your online shop uses, unless the card company works it out.</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[15px] font-semibold">Services</p>
            <Pills label="Services" value={servicesTaxed} onChange={setServicesTaxed} disabled={ro} options={[[false, 'Not taxed'], [true, 'Taxed']]} />
            {servicesTaxed && <Pct value={services} onChange={setServices} label="Services rate" disabled={ro} />}
            <p className="text-[13px]" style={{ color: MUTED }}>Most states don’t tax personal services. Check yours.</p>
          </div>
        </div>
      </Card>

      {places.length > 1 && (
        <Card title="Each location" help="A location in another city or county may charge a different rate.">
          <div>
            {places.map((l: any) => {
              const o = own[l.id] || { own: false, products: products, services: servicesTaxed ? services : '0' };
              const set = (patch: Partial<Own>) => setOwn((m) => ({ ...m, [l.id]: { ...o, ...patch } }));
              return (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
                  <div className="min-w-0"><p className="text-[15px] font-medium">{l.name || 'Location'}</p>{l.address && <p className="text-[13px]" style={{ color: MUTED }}>{typeof l.address === 'string' ? l.address : ''}</p>}</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Pills label={`${l.name || 'Location'} rates`} value={o.own} onChange={(v) => set({ own: v })} disabled={ro} options={[[false, 'The same'], [true, 'Its own']]} />
                    {o.own && <>
                      <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Products<Pct value={o.products} onChange={(v) => set({ products: v })} label={`${l.name || 'Location'} products rate`} disabled={ro} width={80} /></label>
                      <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Services<Pct value={o.services} onChange={(v) => set({ services: v })} label={`${l.name || 'Location'} services rate`} disabled={ro} width={72} /></label>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Paying the state" help="The state tells you how often when you register. The report adds up each period for your return.">
        <div className="flex flex-wrap items-end gap-6">
          <div className="space-y-1.5"><p className="text-[15px] font-semibold">How often you file</p>
            <Pills label="How often you file" value={every} onChange={setEvery} disabled={ro} options={[['month', 'Monthly'], ['quarter', 'Every 3 months'], ['year', 'Once a year']]} /></div>
          <div className="space-y-1.5"><p className="text-[15px] font-semibold">Due by day</p>
            <span className="inline-flex items-center gap-2"><input aria-label="Due by day of the month after" value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" disabled={ro}
              className={`h-11 w-[72px] rounded-xl px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} /><span className="text-[14px]" style={{ color: MUTED }}>of the month after</span></span></div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <div><p className="text-[15px] font-medium">Remind me a week before it’s due</p><p className="text-[13px]" style={{ color: MUTED }}>On your Money page and in your morning brief, with the amount</p></div>
          <button type="button" role="switch" aria-checked={remind} aria-label="Remind me a week before it’s due" disabled={ro} onClick={() => setRemind(!remind)}
            className={`relative h-8 w-[52px] shrink-0 rounded-full ${RING}`} style={{ background: remind ? GREEN : '#d4d5d8' }}>
            <span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] transition-all" style={{ left: remind ? 24 : 4 }} />
          </button>
        </div>
        {canEdit && !cur.unset && <PeriodBox tenantId={tenantId} tenant={tenant} />}
      </Card>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className={`min-h-[48px] rounded-full px-7 text-[15px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`} style={{ background: INK }}>{busy ? 'Saving' : 'Save'}</button>
          <p className="text-[14px]" style={{ color: MUTED }}>Check your rates with your accountant or your state.</p>
        </div>
      ) : <p className="text-[14px]" style={{ color: MUTED }}>Only a manager can change sales tax.</p>}
      {msg && <p role="status" className="text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : AMBER }}>{msg.text}</p>}
    </div>
  );
}

/** The last period that ended (or another, by the arrows): what was collected, given back and is to pay, its report,
 *  and whether it's paid. */
function PeriodBox({ tenantId, tenant }: { tenantId: string; tenant: any }) {
  const f = filingOf(tenant);
  const [key, setKey] = React.useState<string | null>(null);
  const [v, setV] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false); const [amt, setAmt] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async (k: string | null) => {
    setErr(null); const r = await api({ tenantId, action: 'view', ...(k ? { period: k } : {}) });
    if (r?.ok) { setV(r); setKey(r.report.period.key); setAmt(String(r.report.toPay.toFixed(2))); setPaying(false); } else setErr(r?.error || 'The figures didn’t load. Try again.');
  }, [tenantId]);
  React.useEffect(() => { load(null); }, [load, f.every, f.dueDay]);
  if (err) return <p className="mt-4 text-[14px]" style={{ color: AMBER }}>{err}</p>;
  if (!v) return <p className="mt-4 text-[14px]" style={{ color: MUTED }}>Adding up the last period</p>;
  const r = v.report; const p = r.period; const ended = v.today > p.end;
  const noNext = (periodOf(nextPeriod(p.key, f.every))?.start || '') > v.today;
  const open = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(buildSalesTaxHtml(r, { shopName: String(tenant?.name || ''), paid: v.paid })); w.document.close(); };
  const pay = async () => {
    const c = Math.round(Number(amt) * 100); if (!(c > 0)) { setErr('Type what you paid.'); return; }
    setBusy(true); const x = await api({ tenantId, action: 'paid', period: p.key, cents: c }); setBusy(false);
    if (x?.ok) load(p.key); else setErr(x?.error || 'That didn’t save. Try again.');
  };
  const filed = async () => { setBusy(true); const x = await api({ tenantId, action: 'paid', period: p.key, cents: 0 }); setBusy(false); if (x?.ok) load(p.key); else setErr(x?.error || 'That didn’t save. Try again.'); };
  const undo = async () => { setBusy(true); const x = await api({ tenantId, action: 'unpaid', period: p.key }); setBusy(false); if (x?.ok) load(p.key); else setErr(x?.error || 'That didn’t go through. Try again.'); };
  const arrow = (dir: -1 | 1, disabled: boolean) => (
    <button type="button" aria-label={dir < 0 ? 'The period before' : 'The period after'} disabled={disabled} onClick={() => load(dir < 0 ? previousPeriod(p.key, f.every) : nextPeriod(p.key, f.every))}
      className={`flex h-11 w-11 items-center justify-center rounded-full bg-[#fff] disabled:opacity-40 ${RING}`} style={{ border: `1px solid ${LINE}` }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
    </button>
  );
  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: SOFT }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{ended ? `${p.label} is due ${p.dueLabel}` : `${p.label}, so far`}</p>
          <p className="text-[14px]" style={{ color: MUTED }}>{money(r.collected)} collected{r.givenBack ? `, ${money(r.givenBack)} given back on refunds` : ''}, {money(r.toPay)} to pay</p>
          {v.paid && <p className="mt-0.5 text-[14px] font-medium" style={{ color: GREEN }}>{v.paid.cents > 0 ? `Paid ${new Date(v.paid.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}: ${money(v.paid.cents / 100)}` : `Filed ${new Date(v.paid.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, nothing to pay`}</p>}
        </div>
        <div className="flex items-center gap-1.5">{arrow(-1, false)}{arrow(1, noNext)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={open} className={`min-h-[44px] rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>See the report</button>
        {ended && !v.paid && !paying && r.toPay > 0 && <button type="button" onClick={() => setPaying(true)} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold text-[#fff] ${RING}`} style={{ background: INK }}>I paid it</button>}
        {ended && !v.paid && r.toPay <= 0 && <button type="button" onClick={filed} disabled={busy} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`} style={{ background: INK }}>I filed it, nothing to pay</button>}
        {v.paid && <button type="button" onClick={undo} disabled={busy} className={`min-h-[44px] rounded-full px-3 text-[14px] font-medium underline underline-offset-2 ${RING}`} style={{ color: MUTED }}>Take it back</button>}
      </div>
      {paying && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>What you paid
            <span className="inline-flex items-center gap-1"><span>$</span><input aria-label="What you paid" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal"
              className={`h-11 w-[120px] rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} /></span></label>
          <button type="button" onClick={pay} disabled={busy} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`} style={{ background: INK }}>Record the payment</button>
          <button type="button" onClick={() => setPaying(false)} className={`min-h-[44px] rounded-full px-3 text-[14px] ${RING}`} style={{ color: MUTED }}>Cancel</button>
        </div>
      )}
      {paying && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>It’s in your books as sales tax paid, never an expense. When the payment shows in your bank, it’s matched to this.</p>}
    </div>
  );
}
