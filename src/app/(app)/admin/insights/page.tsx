'use client';
// src/app/(app)/admin/insights/page.tsx
//
// HQ · INSIGHTS — the numbers that run ClarityFlow, measured daily.
//   • Platform: active businesses, bookings, money processed, cost to serve,
//     cost per active business, support speed — each with a trend.
//   • Since joining: each business's first month vs latest month (revenue,
//     bookings, no-shows) — proof ClarityFlow works, and your best sales story.
//   • Cost per business: texts, emails, AI, hosting share.
//   • Industry benchmarks by niche (3+ businesses only — never identifiable).
//   • ✦ Weekly briefing: AI reads the numbers and says what to do this week.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HqShell, Glass, Label, Stat, Chip, Loading, Spark, hq, money, pctText, rate } from '@/components/hq/hq';

export default function InsightsPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [brief, setBrief] = useState('');
  const [sort, setSort] = useState<'growth' | 'revenue' | 'cost'>('growth');
  const load = (refresh = false) => { setBusy(refresh ? 'refresh' : ''); hq({ action: refresh ? 'insights-refresh' : 'insights' }).then((r) => { setBusy(''); r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.'); }); };
  useEffect(() => { load(false); }, []);

  const L = d?.latest;
  const series = (k: string) => (d?.days || []).map((x: any) => Number(x[k]) || 0);
  const tenants = useMemo(() => {
    const t = [...(d?.tenants || [])];
    if (sort === 'growth') t.sort((a, b) => (b.sinceJoining?.revenueChangePct ?? -1e9) - (a.sinceJoining?.revenueChangePct ?? -1e9));
    if (sort === 'revenue') t.sort((a, b) => b.revenue30 - a.revenue30);
    if (sort === 'cost') t.sort((a, b) => (b.cost30?.total || 0) - (a.cost30?.total || 0));
    return t;
  }, [d, sort]);

  return (
    <HqShell title="Insights" sub="The numbers that run ClarityFlow — measured every day."
      action={<div className="flex gap-2">
        {d?.ai && <button type="button" disabled={!!busy} onClick={async () => { setBusy('brief'); const r = await hq({ action: 'insights-brief' }); setBusy(''); setBrief(r.ok ? r.brief : r.error || 'Couldn’t write a briefing.'); }} className="h-10 rounded-full bg-violet-600 px-4 text-sm text-white disabled:opacity-50">{busy === 'brief' ? 'Reading the numbers…' : '✦ Weekly briefing'}</button>}
        <button type="button" disabled={!!busy} onClick={() => load(true)} className="glass h-10 rounded-full border border-white/70 px-4 text-sm disabled:opacity-50">{busy === 'refresh' ? 'Measuring…' : 'Refresh now'}</button>
      </div>}>
      {err && <p className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
      {!d && !err && <Loading />}
      {d && !L && <Glass><p className="py-6 text-center text-stone-600">No numbers yet. Press <span className="font-semibold">Refresh now</span> — after that they update every day on their own.</p></Glass>}
      {d && L && (
        <div className="space-y-5">
          {brief && <Glass className="border-violet-200/80"><Label>✦ This week</Label><div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800">{brief.replace(/\*\*/g, '')}</div></Glass>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Active businesses" value={L.activeBusinesses} sub={<>of {L.businesses} · <Spark values={series('activeBusinesses')} className="inline text-stone-500" /></>} />
            <Stat label="Bookings · 30 days" value={L.bookings30.toLocaleString()} sub={<Spark values={series('bookings30')} className="text-stone-500" />} />
            <Stat label="Processed · 30 days" value={money(L.revenue30)} sub={<>{pctText(L.revenuePrev30 ? Math.round(((L.revenue30 - L.revenuePrev30) / L.revenuePrev30) * 1000) / 10 : null)} vs prior 30 days</>} />
            <Stat label="Cost to serve · 30 days" value={money(L.cost30.total, 2)} sub={<Spark values={series('cost')} className="text-stone-500" />} />
            <Stat label="Cost per active business" value={money(L.costPerActiveBusiness, 2)} sub="per month" />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Glass>
              <Label>Where the cost goes · 30 days</Label>
              {[['Texts', L.cost30.texts], ['Emails', L.cost30.emails], ['AI', L.cost30.ai], ['Hosting & database', L.cost30.infra]].map(([l, v]) => (
                <div key={String(l)} className="mt-3">
                  <div className="flex justify-between text-sm"><span>{l}</span><span className="font-semibold">{money(Number(v), 2)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-white/70"><div className="h-1.5 rounded-full bg-stone-900" style={{ width: `${L.cost30.total ? Math.min(100, (Number(v) / L.cost30.total) * 100) : 0}%` }} /></div>
                </div>
              ))}
              <p className="mt-3 text-[11px] text-stone-500">Texts and emails use your rates (SMS_COST_CENTS, EMAIL_COST_CENTS); hosting is INFRA_MONTHLY_USD. AI is measured.</p>
            </Glass>
            <Glass>
              <Label>Since joining ClarityFlow</Label>
              <p className="mt-2 text-4xl font-light tracking-tight">{L.sinceJoiningMedianRevenueChange == null ? '—' : pctText(L.sinceJoiningMedianRevenueChange)}</p>
              <p className="text-sm text-stone-600">typical change in monthly revenue, first month vs latest (businesses 45+ days in)</p>
              <p className="mt-3 text-sm"><span className="font-semibold">{L.growingBusinesses}</span> of {L.businesses} businesses grew revenue in the last 30 days.</p>
            </Glass>
            <Glass>
              <Label>Support · 30 days</Label>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><p className="text-2xl font-semibold">{L.support.opened30}</p><p className="text-[11px] text-stone-500">requests</p></div>
                <div><p className="text-2xl font-semibold">{L.support.solved30}</p><p className="text-[11px] text-stone-500">solved</p></div>
                <div><p className="text-2xl font-semibold">{L.support.medianFirstResponseHours == null ? '—' : `${Math.round(L.support.medianFirstResponseHours * 10) / 10}h`}</p><p className="text-[11px] text-stone-500">first reply</p></div>
              </div>
            </Glass>
          </div>

          <Glass>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Every business</Label>
              <div className="flex gap-1.5">{([['growth', 'Growth since joining'], ['revenue', 'Revenue'], ['cost', 'Cost to serve']] as const).map(([k, l]) => <Chip key={k} on={sort === k} onClick={() => setSort(k)}>{l}</Chip>)}</div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-widest text-stone-400"><th className="py-2 font-medium">Business</th><th className="font-medium">Revenue 30d</th><th className="font-medium">vs prior</th><th className="font-medium">Since joining</th><th className="font-medium">No-shows</th><th className="font-medium">Rebook</th><th className="font-medium">Online</th><th className="font-medium">Cost 30d</th></tr></thead>
                <tbody>
                  {tenants.map((t: any) => (
                    <tr key={t.tenantId} className="border-t border-white/70">
                      <td className="py-2.5"><Link href={`/admin/tenants/${t.tenantId}`} className="font-medium underline-offset-2 hover:underline">{t.name}</Link><span className="block text-[11px] text-stone-500">{t.businessType} · {t.ageDays}d</span></td>
                      <td>{money(t.revenue30)}</td>
                      <td className={(t.revenueChangePct || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}>{pctText(t.revenueChangePct)}</td>
                      <td className="font-semibold">{t.sinceJoining ? <span className={(t.sinceJoining.revenueChangePct || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}>{pctText(t.sinceJoining.revenueChangePct)}</span> : <span className="text-stone-400">too new</span>}</td>
                      <td>{rate(t.noShowRate)}</td><td>{rate(t.rebookRate)}</td><td>{rate(t.onlineShare)}</td>
                      <td>{money(t.cost30?.total, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass>
            <Label>Industry benchmarks · by niche</Label>
            {(L.benchmarks || []).length === 0 ? <p className="mt-2 text-sm text-stone-600">Benchmarks appear once a niche has 3 or more active businesses — so no single business can ever be identified.</p> : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {L.benchmarks.map((b: any) => (
                  <div key={b.niche} className="rounded-3xl bg-white/60 p-4">
                    <p className="font-semibold"><span className="capitalize">{b.niche}</span> <span className="font-normal text-stone-500">· {b.businesses} businesses</span></p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                      <div><p className="font-semibold">{money(b.avgTicket)}</p><p className="text-[11px] text-stone-500">avg visit</p></div>
                      <div><p className="font-semibold">{b.bookingsPerWeek == null ? '—' : Math.round(b.bookingsPerWeek)}</p><p className="text-[11px] text-stone-500">bookings/wk</p></div>
                      <div><p className="font-semibold">{rate(b.noShowRate)}</p><p className="text-[11px] text-stone-500">no-shows</p></div>
                      <div><p className="font-semibold">{rate(b.rebookRate)}</p><p className="text-[11px] text-stone-500">rebook</p></div>
                      <div><p className="font-semibold">{rate(b.onlineShare)}</p><p className="text-[11px] text-stone-500">book online</p></div>
                      <div><p className="font-semibold">{rate(b.noShowWithDeposits)} / {rate(b.noShowWithoutDeposits)}</p><p className="text-[11px] text-stone-500">no-shows with / without deposits</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Glass>
          <p className="text-center text-[11px] text-stone-500">Revenue = booked value of completed visits. Measured {L.computedAt ? new Date(L.computedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}.</p>
        </div>
      )}
    </HqShell>
  );
}
