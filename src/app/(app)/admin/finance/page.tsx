'use client';
// src/app/(app)/admin/finance/page.tsx
//
// HQ · FINANCE — ClarityFlow the company (owners only).
//
//   The profit ladder   income → cost to serve → gross profit → running
//                       costs → your pay → tax set aside → growth → kept
//   Income              platform fees from Stripe, per business and renter
//                       (subscriptions arrive with billing — next build)
//   Stripe              everything Stripe charged ClarityFlow, by type
//   Running costs       staff, software, marketing… entered here
//   Growth planner      how many businesses you need to break even, to pay
//                       yourself, and to pay everyone + tax + a profit goal

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HqShell, Glass, Label, Stat, Chip, Loading, hq, money } from '@/components/hq/hq';

const TYPE_LABEL: Record<string, string> = {
  application_fee: 'Platform fees collected', application_fee_refund: 'Platform fees refunded', stripe_fee: 'Stripe billing (Connect, Radar…)', payment: 'Payments', charge: 'Charges',
  refund: 'Refunds', adjustment: 'Adjustments (disputes etc.)', payout: 'Payouts to your bank', transfer: 'Transfers', connect_collection_transfer: 'Collected from accounts', tax_fee: 'Tax fees',
};
const CATS = ['staff', 'software', 'marketing', 'contractors', 'office', 'insurance', 'other'];
const c2 = (n: number) => money(n, 2);

export default function FinancePage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [s, setS] = useState<any>(null);
  const [exp, setExp] = useState({ name: '', monthly: '', category: 'software' });

  const load = useCallback(async (m?: string) => {
    const r = await hq({ action: 'finance', month: m || month || undefined });
    if (r.ok) { setD(r); setS(r.settings); if (!month) setMonth(r.month); } else setErr(r.error || 'Couldn’t load.');
  }, [month]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => { setBusy('sync'); setMsg(''); const r = await hq({ action: 'finance-sync', month }); setBusy(''); setMsg(r.ok ? `Synced ${r.month} from Stripe.` : r.error); void load(month); };
  const saveSettings = async () => { setBusy('settings'); const r = await hq({ action: 'finance-settings', ...s }); setBusy(''); setMsg(r.ok ? 'Planner updated.' : r.error); void load(month); };

  const L = d?.ladder, P = d?.plan;
  const rows: [string, number, 'in' | 'out' | 'sum'][] = L ? [
    ['Income', L.revenue, 'in'], ['Cost to serve', -L.costToServe, 'out'], ['Gross profit', L.gross, 'sum'],
    ['Running costs', -L.opex, 'out'], ['Operating profit', L.operating, 'sum'], ['Your pay', -L.ownerPay, 'out'],
    ['Profit before tax', L.beforeTax, 'sum'], [`Tax set aside (${d.settings.taxRatePct}%)`, -L.tax, 'out'], ['After tax', L.afterTax, 'sum'],
    [`Reinvested in growth (${d.settings.reinvestPct}%)`, -L.reinvest, 'out'], ['Kept', L.keep, 'sum'],
  ] : [];
  const byTenant = d?.finance ? Object.entries(d.finance.byTenant || {}).map(([id, v]: any) => ({ id, ...v })).sort((a: any, b: any) => b.feesCents - a.feesCents) : [];
  const progress = (need: number | null) => (need ? Math.min(100, Math.round(((d?.costs?.activeBusinesses || 0) / need) * 100)) : 0);

  return (
    <HqShell title="Finance" sub="ClarityFlow the company — what it earns, what it costs, what’s left."
      action={<div className="flex flex-wrap gap-2">
        {d && [d.month, d.lastMonth].filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).map((m: string) => <Chip key={m} on={month === m} onClick={() => { setMonth(m); void load(m); }}>{new Date(`${m}-15`).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</Chip>)}
        <button type="button" disabled={!!busy || !d?.stripeReady} onClick={sync} className="h-9 rounded-full bg-stone-900 px-4 text-sm text-white disabled:opacity-40">{busy === 'sync' ? 'Reading Stripe…' : 'Sync from Stripe'}</button>
      </div>}>
      {err && <p className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
      {!d && !err && <Loading />}
      {msg && <p className="mb-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      {d && (
        <div className="space-y-5">
          {!d.finance && <Glass><p className="text-sm text-stone-700">No Stripe figures for this month yet — press <span className="font-semibold">Sync from Stripe</span>. After that it updates every day on its own.</p></Glass>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Income this month" value={c2(L.revenue)} sub={`${c2(d.income.subscriptions)} subscriptions · ${c2(d.income.fees)} fees`} />
            <Stat label="Cost to serve" value={c2(L.costToServe)} sub={`${c2(d.costs.perBusiness)} per active business`} />
            <Stat label="Gross margin" value={L.grossMarginPct == null ? '—' : `${Math.round(L.grossMarginPct)}%`} sub="goal: 80%+" tone={L.grossMarginPct != null && L.grossMarginPct < 75 ? 'text-red-600' : ''} />
            <Stat label="After tax" value={c2(L.afterTax)} tone={L.afterTax < 0 ? 'text-red-600' : 'text-emerald-700'} sub="after everyone’s paid" />
            <Stat label="Runway" value={d.runwayMonths == null ? (L.afterTax >= 0 ? 'Profitable' : 'Add cash') : `${d.runwayMonths} mo`} sub={d.runwayMonths == null && L.afterTax < 0 ? 'set cash in the planner' : ''} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Glass>
              <Label>The profit ladder · this month</Label>
              <div className="mt-3 space-y-1">
                {rows.map(([l, v, kind]) => (
                  <div key={l} className={`flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${kind === 'sum' ? 'bg-white/75 font-semibold' : ''}`}>
                    <span className={kind === 'out' ? 'pl-3 text-stone-600' : ''}>{kind === 'out' ? '− ' : ''}{l}</span>
                    <span className={kind === 'sum' ? (v < 0 ? 'text-red-600' : 'text-stone-900') : kind === 'out' ? 'text-stone-600' : 'text-emerald-700'}>{c2(Math.abs(v))}{kind === 'sum' && v < 0 ? ' short' : ''}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-stone-500">Cost to serve = what Stripe charged ClarityFlow + texts, emails, AI and hosting (Insights). Your pay is treated as a salary; how it’s taxed depends on how ClarityFlow is set up — confirm with your accountant. Subscriptions join the income line once billing is live.</p>
            </Glass>

            <Glass className="space-y-3">
              <Label>Growth planner</Label>
              {s && (
                <div className="grid grid-cols-2 gap-2">
                  {([['arpa', 'Expected subscription / business ($/mo)'], ['ownerPayMonthly', 'Your pay ($/mo)'], ['profitGoalMonthly', 'Profit to keep after tax ($/mo)'], ['taxRatePct', 'Tax set aside (%)'], ['reinvestPct', 'Reinvest of after-tax profit (%)'], ['cashOnHand', 'Cash in the bank ($)']] as const).map(([k, l]) => (
                    <label key={k} className="text-[12px] text-stone-600">{l}<input type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-white/80 bg-white/75 px-3 text-sm text-stone-900" /></label>
                  ))}
                </div>
              )}
              <button type="button" disabled={!!busy} onClick={saveSettings} className="h-10 w-full rounded-full bg-stone-900 text-sm text-white disabled:opacity-50">{busy === 'settings' ? 'Saving…' : 'Update the plan'}</button>
              <div className="rounded-2xl bg-white/70 p-3 text-sm">
                <p>Each business brings about <span className="font-semibold">{c2(d.settings.arpa + d.income.feesPerBusiness)}</span>/mo and costs <span className="font-semibold">{c2(d.costs.perBusiness)}</span> — leaving <span className={`font-semibold ${P.contribution <= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{c2(P.contribution)}</span> ({P.contributionPct == null ? '—' : `${Math.round(P.contributionPct)}%`}).</p>
              </div>
              {([['Break even (running costs covered)', P.breakEven], ['Pay yourself', P.payYou], ['Everyone paid, tax covered, profit goal kept', P.payYouAfterTaxAndGrow]] as const).map(([l, need]) => (
                <div key={l}>
                  <div className="flex justify-between text-sm"><span>{l}</span><span className="font-semibold">{need == null ? 'raise prices' : `${need} businesses`}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-white/70"><div className="h-2 rounded-full bg-stone-900 transition-all" style={{ width: `${progress(need)}%` }} /></div>
                  <p className="mt-0.5 text-[11px] text-stone-500">{d.costs.activeBusinesses} active today</p>
                </div>
              ))}
            </Glass>
          </div>

          {/* ── Billing: ClarityFlow's own subscriptions ── */}
          <Glass className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Subscriptions · {d.billing.subscribers} paying · {c2(d.income.subscriptions)} this month</Label>
              <span className={`rounded-full px-3 py-1 text-[12px] font-medium ${d.billing.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>Billing {d.billing.enabled ? 'on' : 'off'}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-2xl bg-white/65 p-3 text-sm">
                <p className="font-semibold">{d.billing.pricesReadyAt ? '✓' : '1.'} Prices in Stripe</p>
                <p className="text-[12px] text-stone-500">{d.billing.pricesReadyAt ? `Set up ${new Date(d.billing.pricesReadyAt).toLocaleDateString()}` : 'Creates every plan and tool price in your Stripe account.'}</p>
                <button type="button" disabled={!!busy} onClick={async () => { setBusy('prices'); const r = await hq({ action: 'billing-setup-prices' }); setBusy(''); setMsg(r.ok ? `Prices ready in Stripe (${r.created} new).` : r.error); void load(month); }} className="mt-2 h-8 rounded-full bg-stone-900 px-3 text-[12px] text-white disabled:opacity-40">{busy === 'prices' ? 'Creating…' : d.billing.pricesReadyAt ? 'Check again' : 'Set up prices'}</button>
              </div>
              <div className="rounded-2xl bg-white/65 p-3 text-sm">
                <p className="font-semibold">{d.billing.webhookReady ? '✓' : '2.'} Stripe tells ClarityFlow</p>
                <p className="text-[12px] text-stone-500">{d.billing.webhookReady ? 'Billing webhook connected.' : 'Stripe → Developers → Webhooks → Add endpoint: …/api/stripe/billing-webhook (Your account). Put its signing secret in Vercel as STRIPE_BILLING_WEBHOOK_SECRET.'}</p>
              </div>
              <div className="rounded-2xl bg-white/65 p-3 text-sm">
                <p className="font-semibold">{d.billing.enabled ? '✓' : '3.'} Switch billing on</p>
                <p className="text-[12px] text-stone-500">{d.billing.enabled ? 'New businesses subscribe before entering.' : 'Until then, businesses enter free (early access).'}</p>
                <button type="button" disabled={!!busy} onClick={async () => { if (!window.confirm(d.billing.enabled ? 'Switch billing OFF? New businesses will enter free again.' : 'Switch billing ON? New businesses will subscribe before entering.')) return; setBusy('enable'); const r = await hq({ action: 'billing-settings', enabled: !d.billing.enabled }); setBusy(''); setMsg(r.ok ? `Billing ${r.billing.enabled ? 'on' : 'off'}.` : r.error); void load(month); }} className={`mt-2 h-8 rounded-full px-3 text-[12px] disabled:opacity-40 ${d.billing.enabled ? 'border border-stone-300 bg-white' : 'bg-emerald-600 text-white'}`}>{d.billing.enabled ? 'Switch off' : 'Switch on'}</button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-[12px] text-stone-600">Founding members — % off forever<input id="cf-founding" type="number" defaultValue={d.billing.foundingPct} min={0} max={90} className="mt-1 h-10 w-full rounded-xl border border-white/80 bg-white/75 px-3 text-sm text-stone-900" /></label>
              <label className="text-[12px] text-stone-600">Free until (optional — subscriptions start then)<input id="cf-free" type="date" defaultValue={d.billing.freeUntil ? String(d.billing.freeUntil).slice(0, 10) : ''} className="mt-1 h-10 w-full rounded-xl border border-white/80 bg-white/75 px-3 text-sm text-stone-900" /></label>
              <button type="button" disabled={!!busy} onClick={async () => { const pct = (document.getElementById('cf-founding') as HTMLInputElement).value; const free = (document.getElementById('cf-free') as HTMLInputElement).value; setBusy('bset'); const r = await hq({ action: 'billing-settings', foundingPct: Number(pct) || 0, freeUntil: free || null }); setBusy(''); setMsg(r.ok ? 'Billing settings saved.' : r.error); void load(month); }} className="h-10 self-end rounded-xl bg-stone-900 px-4 text-sm text-white disabled:opacity-40">Save</button>
            </div>
            <details className="rounded-2xl bg-white/55 p-3 text-sm">
              <summary className="cursor-pointer font-medium">The price list ({d.billing.prices.length} prices)</summary>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">{d.billing.prices.map((p: any) => <p key={p.key} className="flex justify-between gap-2 rounded-xl bg-white/70 px-3 py-1.5 text-[13px]"><span>{p.name}</span><span className="font-semibold">${p.amount}/mo</span></p>)}</div>
              <p className="mt-2 text-[11px] text-stone-500">Change prices in src/lib/billing-plans.ts (bump the version, e.g. _v2), then “Set up prices” again. Existing subscribers keep their price.</p>
            </details>
          </Glass>

          <div className="grid gap-4 lg:grid-cols-2">
            <Glass>
              <Label>Platform fees by business · {month}</Label>
              {byTenant.length === 0 ? <p className="mt-2 text-sm text-stone-600">No platform fees yet. Once your Stripe pricing scheme is enabled, every payment’s fee appears here, by business and renter.</p> : (
                <div className="mt-2 space-y-1">
                  {byTenant.slice(0, 15).map((t: any) => (
                    <div key={t.id} className="rounded-2xl bg-white/60 px-3 py-2 text-sm">
                      <div className="flex justify-between"><span>{t.id.startsWith('unknown:') ? t.name : <Link href={`/admin/tenants/${t.id}`} className="underline-offset-2 hover:underline">{t.name}</Link>} <span className="text-stone-500">· {t.count} payments</span></span><span className="font-semibold">{money(t.feesCents / 100, 2)}</span></div>
                      {Object.values(t.renters || {}).map((r: any) => <p key={r.name} className="pl-3 text-[12px] text-stone-500">↳ renter {r.name}: {money(r.feesCents / 100, 2)}</p>)}
                    </div>
                  ))}
                </div>
              )}
            </Glass>
            <Glass>
              <Label>Through ClarityFlow’s Stripe · {month}</Label>
              {!d.finance ? <p className="mt-2 text-sm text-stone-600">Sync to see this month.</p> : (
                <div className="mt-2 space-y-1 text-sm">
                  {Object.entries(d.finance.byType || {}).sort((a: any, b: any) => Math.abs(b[1].amountCents) - Math.abs(a[1].amountCents)).map(([type, v]: any) => (
                    <div key={type} className="flex justify-between rounded-2xl bg-white/60 px-3 py-2"><span>{TYPE_LABEL[type] || type.replace(/_/g, ' ')} <span className="text-stone-500">· {v.count}</span></span><span>{money(v.amountCents / 100, 2)}{v.feeCents ? <span className="text-stone-500"> · fees {money(v.feeCents / 100, 2)}</span> : null}</span></div>
                  ))}
                  <p className="pt-1 text-[12px] text-stone-600">Stripe charged ClarityFlow <span className="font-semibold">{money(d.finance.stripeCostsCents / 100, 2)}</span> this month.</p>
                </div>
              )}
            </Glass>
          </div>

          <Glass className="space-y-3">
            <Label>Running costs · {c2(d.opex)}/month</Label>
            <p className="text-[12px] text-stone-500">Staff, software, marketing, insurance… (hosting, texts, email and AI are already in cost to serve — don’t add them twice).</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_150px_auto]">
              <input value={exp.name} onChange={(e) => setExp({ ...exp, name: e.target.value })} placeholder="e.g. Support assistant (part-time)" className="h-10 rounded-xl border border-white/80 bg-white/75 px-3 text-sm" />
              <input value={exp.monthly} onChange={(e) => setExp({ ...exp, monthly: e.target.value })} type="number" placeholder="$ / month" className="h-10 rounded-xl border border-white/80 bg-white/75 px-3 text-sm" />
              <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} className="h-10 rounded-xl border border-white/80 bg-white/75 px-2 text-sm">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <button type="button" disabled={!exp.name || exp.monthly === ''} onClick={async () => { await hq({ action: 'expense-save', ...exp, monthly: Number(exp.monthly) }); setExp({ name: '', monthly: '', category: 'software' }); void load(month); }} className="h-10 rounded-xl bg-stone-900 px-4 text-sm text-white disabled:opacity-40">Add</button>
            </div>
            {d.expenses.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between rounded-2xl bg-white/60 px-3 py-2 text-sm">
                <span>{e.name} <span className="text-stone-500">· {e.category}</span></span>
                <span className="flex items-center gap-3"><span className="font-semibold">{c2(e.monthly)}</span><button type="button" onClick={async () => { await hq({ action: 'expense-delete', id: e.id }); void load(month); }} className="text-[12px] text-red-600 underline">Remove</button></span>
              </div>
            ))}
          </Glass>
        </div>
      )}
    </HqShell>
  );
}
