'use client';
// src/components/referrals/CampaignsBoard.tsx — the CAMPAIGNS tab on the Referrals page (design canvas RF29): creators
// judged like any ad channel — what they cost, new clients who paid, what those clients are worth, the return, and
// whether they come back — each creator with a plain label (give them more, hire again, watch, discount hunters), the
// pieces that brought clients, spend by how clients found you, and every campaign with what needs a decision.
// /api/creator-campaigns (lib/creator-campaigns-server).
import * as React from 'react';
import Link from 'next/link';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const money = (c: number | null | undefined) => (c == null ? '—' : `$${(Math.round(Number(c)) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const TAG: Record<string, [string, string]> = { more: ['#e8f3ec', GREEN], hire: ['#e8f3ec', GREEN], watch: [SOFT, INK], hunters: ['#fdf1e3', AMBER], new: [SOFT, MUTED] };

export function CampaignsBoard({ tenantId }: { tenantId: string }) {
  const [list, setList] = React.useState<any>(null); const [sc, setSc] = React.useState<any>(null); const [months, setMonths] = React.useState(6);
  React.useEffect(() => { if (tenantId) void payPost('/api/creator-campaigns', { tenantId, action: 'list' }).then(setList); }, [tenantId]);
  React.useEffect(() => { if (tenantId) void payPost('/api/creator-campaigns', { tenantId, action: 'scorecards', months }).then(setSc); }, [tenantId, months]);
  if (!list) return <p className="mt-4" style={{ color: MUTED }}>Loading…</p>;
  if (!list.ok) return <p className="mt-4" style={{ color: RED }}>{list.error || 'Campaigns couldn’t load.'}</p>;
  const tot = sc?.totals || {}; const cards: any[] = sc?.cards || []; const pieces: any[] = sc?.pieces || []; const sources: any[] = sc?.sources || [];
  const topSource = Math.max(1, ...sources.map((s) => s.v?.cents || 0));
  const topPiece = Math.max(1, ...pieces.map((p) => p.clients));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[26px] font-light tracking-[-0.02em]">Creator campaigns</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>Judged by new clients who paid and whether they come back, not likes.</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 rounded-full p-1" style={{ background: SOFT }} role="radiogroup" aria-label="Period">{[3, 6, 12].map((m) => <button key={m} type="button" role="radio" aria-checked={months === m} onClick={() => setMonths(m)} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold" style={months === m ? { background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.12)' } : { color: MUTED }}>{m === 12 ? 'Year' : `${m} months`}</button>)}</div>
          <Link href="/referrals/campaigns/new" className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>New campaign</Link></div></div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Spent on creators', money(tot.costCents), 'fees, offers, credit, cash'], ['New clients who paid', tot.paidFirst ?? '—', tot.perClientCents ? `${money(tot.perClientCents)} each` : ''], ['What they’ve spent', money(tot.spendCents), 'so far, all visits'], ['Return', tot.returnX ? `${tot.returnX}×` : '—', 'spend for every $1']].map(([k, v, s]: any, i) =>
        <div key={k} className="rounded-[18px] border bg-white px-4 py-3.5" style={{ borderColor: LINE }}><p className="text-[12px] font-semibold" style={{ color: MUTED }}>{k}</p><p className="text-[28px] font-light tracking-[-0.02em]" style={{ color: i >= 2 && v !== '—' ? GREEN : INK }}>{v}</p><p className="text-[11.5px]" style={{ color: MUTED }}>{s}</p></div>)}</div>

      <section className="overflow-x-auto rounded-[20px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Creator scorecards">
        <p className="pb-2 text-[16px] font-semibold">Creator scorecards</p>
        {cards.length ? <table className="w-full min-w-[760px] text-left text-[13.5px]"><thead><tr className="text-[11px] uppercase tracking-[0.06em]" style={{ color: MUTED }}>{['Creator', 'New clients who paid', 'Cost each', 'Came back', 'Return', 'On time', ''].map((h) => <th key={h} className="pb-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{cards.map((c) => <tr key={c.clientId} className="border-t" style={{ borderColor: LINE }}>
            <td className="py-3"><b>{c.name}</b><span className="block text-[12px]" style={{ color: MUTED }}>{[c.code, c.handle].filter(Boolean).join(' · ')}</span></td>
            <td>{c.paidFirst}</td><td>{money(c.perClientCents)}</td><td>{c.comeBack == null ? '—' : `${Math.round(c.comeBack * 100)}%`}</td>
            <td className="font-bold" style={{ color: c.returnX == null ? MUTED : c.returnX >= 2 ? GREEN : c.returnX < 1 ? RED : INK }}>{c.returnX == null ? '—' : `${c.returnX}×`}</td>
            <td>{c.onTime == null ? '—' : `${Math.round(c.onTime * 100)}%`}</td>
            <td><span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: TAG[c.tag]?.[0], color: TAG[c.tag]?.[1] }}>{c.label}</span></td></tr>)}</tbody></table>
          : <p className="text-[13px]" style={{ color: MUTED }}>No creators yet. Make one from the Circle tab, then start a campaign.</p>}
        <p className="pt-2 text-[12px]" style={{ color: MUTED }}>Came back: new clients who visited again (counted after their first 30 days). Return: what their clients have spent for every dollar they cost.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-[20px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Which content worked"><p className="pb-1 text-[16px] font-semibold">Which content worked</p>
          {pieces.length ? pieces.map((p, i) => <div key={i} className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: LINE }}>
            {p.shot ? <img src={p.shot} alt="" className="h-14 w-10 shrink-0 rounded-[8px] object-cover" /> : <span className="h-14 w-10 shrink-0 rounded-[8px]" style={{ background: SOFT }} />}
            <div className="min-w-0 flex-1"><a href={p.url} target="_blank" rel="noreferrer" className="block truncate text-[14px] font-semibold hover:underline">{p.creator} · {p.label}</a><p className="truncate text-[12px]" style={{ color: MUTED }}>{p.campaign}{p.views ? ` · ${Number(p.views).toLocaleString('en-US')} views` : ''} · {p.opens} opens{p.rights ? ' · may repost: boost it as an ad' : ''}</p></div>
            <div className="hidden w-24 sm:block"><div className="h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full" style={{ width: `${(p.clients / topPiece) * 100}%`, background: GREEN }} /></div></div>
            <span className="w-16 text-right text-[13px] font-bold">{p.clients} client{p.clients === 1 ? '' : 's'}</span></div>) : <p className="text-[13px]" style={{ color: MUTED }}>Approved pieces show here with the clients each one brought.</p>}</section>
        <section className="rounded-[20px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Are they good clients?"><p className="text-[16px] font-semibold">Are they good clients?</p>
          <p className="pb-2 text-[12.5px]" style={{ color: MUTED }}>What a new client spends in their first 6 months, by how they found you</p>
          {sources.length ? sources.map((s) => <div key={s.label} className="flex items-center gap-3 py-1.5"><span className="w-32 text-[13px]">{s.label}</span><div className="h-2.5 flex-1 rounded-full" style={{ background: SOFT }}><div className="h-2.5 rounded-full" style={{ width: `${(s.v.cents / topSource) * 100}%`, background: s.label === 'Everyone else' ? '#9a9ca3' : GREEN }} /></div><span className="w-14 text-right text-[13px] font-bold">{money(s.v.cents)}</span></div>)
            : <p className="text-[13px]" style={{ color: MUTED }}>Shows once clients who started 6 to 12 months ago have had time to come back.</p>}</section>
      </div>

      <section className="space-y-2" aria-label="Campaigns"><p className="text-[16px] font-semibold">Campaigns</p>
        {list.campaigns.length ? list.campaigns.map((c: any) => <Link key={c.id} href={`/referrals/campaigns/${c.id}`} className="flex flex-wrap items-center gap-3 rounded-[18px] border bg-white p-4 hover:shadow-sm" style={{ borderColor: c.paused || c.stats.waiting ? '#f3dfc4' : LINE }}>
          <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{c.name} <span className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: c.live ? '#e8f3ec' : SOFT, color: c.live ? GREEN : MUTED }}>{c.paused ? 'Paused' : c.live ? 'Live' : c.status === 'done' ? 'Ended' : 'Draft'}</span></p>
            <p className="text-[12.5px]" style={{ color: c.paused ? AMBER : MUTED }}>{c.paused ? c.paused.why : `${c.creators.length} creator${c.creators.length === 1 ? '' : 's'} · ${c.stats.approved} of ${c.stats.pieces} pieces approved${c.stats.waiting ? ` · ${c.stats.waiting} waiting for you` : ''}`}</p></div>
          {[['opens', c.stats.opens], ['booked', c.stats.booked], ['paid first', c.stats.paidFirst], ['cost', money(c.stats.costCents)]].map(([k, v]) => <div key={k as string} className="w-20 text-right"><p className="text-[18px] font-light">{v}</p><p className="text-[11px]" style={{ color: MUTED }}>{k}</p></div>)}
        </Link>) : <div className="rounded-[18px] border border-dashed p-6 text-[14px]" style={{ borderColor: '#d8d9dc', color: MUTED }}>No campaigns yet. Start one: show creators exactly what you want with a moodboard, see what it should earn before you send it, and pay mostly for results.</div>}
      </section>
    </div>);
}
