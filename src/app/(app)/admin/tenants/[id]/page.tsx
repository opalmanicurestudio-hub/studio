'use client';
// src/app/(app)/admin/tenants/[id]/page.tsx
//
// HQ · ONE BUSINESS — everything you need to help them, on one screen:
// health and WHY, setup steps and what's next, the owner and when they were
// last seen, their tools, their help requests, and a TIMELINE of what's been
// happening (bookings, messages — failures in red — changes, help requests).

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader, ArrowLeft } from 'lucide-react';
import { HqNav, hq, HEALTH_TONE, ago } from '@/components/hq/hq';
import { TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';

const KIND: Record<string, string> = { booking: '📅', message: '✉️', change: '✎', help: '🛟' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function HqTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<'all' | 'booking' | 'message' | 'change' | 'help' | 'problems'>('all');
  useEffect(() => { hq({ action: 'tenant', id }).then((r) => (r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.'))); }, [id]);

  const timeline = (d?.timeline || []).filter((e: any) => kind === 'all' ? true : kind === 'problems' ? e.tone === 'bad' || e.tone === 'warn' : e.kind === kind);
  return (
    <div className="min-h-screen bg-slate-50">
      <HqNav />
      <main className="mx-auto max-w-5xl space-y-4 px-4 pb-24 pt-5">
        <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />All businesses</Link>
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!d && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {d && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight">{d.tenant.name}</h1>
                <p className="text-sm text-slate-500">{d.tenant.businessType} · {d.tenant.status} · joined {ago(d.tenant.createdAt)}{d.tenant.inviteCode ? ` · invite ${d.tenant.inviteCode}` : ''}</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-sm font-black ${HEALTH_TONE[d.health.label]}`}>{d.health.label} · {d.health.score}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <section className="space-y-2 rounded-3xl border-2 border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Why</p>
                {d.health.reasons.map((r: string) => <p key={r} className="text-sm text-red-700">⚠ {r}</p>)}
                {d.health.good.map((r: string) => <p key={r} className="text-sm text-emerald-700">✓ {r}</p>)}
                {!d.health.reasons.length && !d.health.good.length && <p className="text-sm text-slate-500">Not enough activity yet.</p>}
              </section>
              <section className="space-y-2 rounded-3xl border-2 border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Setup · {d.setup.done}/{d.setup.total}</p>
                {d.setup.steps.map((s: any) => <p key={s.key} className={`text-sm ${s.done ? 'text-slate-700' : 'font-bold text-slate-900'}`}>{s.done ? '✓' : '○'} {s.label}</p>)}
              </section>
              <section className="space-y-1.5 rounded-3xl border-2 border-slate-200 bg-white p-4 text-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Owner</p>
                <p className="font-bold">{d.tenant.owner.email ? <a href={`mailto:${d.tenant.owner.email}`} className="underline">{d.tenant.owner.email}</a> : '—'}</p>
                <p className="text-slate-600">Last signed in {ago(d.tenant.owner.lastSignIn)}</p>
                <p className="text-slate-600">{d.signals.clients} clients · {d.signals.services} services · {d.signals.staff} team</p>
                <p className="text-slate-600">{d.signals.bookings7d} bookings this week (previous week {d.signals.bookingsPrev7d})</p>
                <p className="text-slate-600">Payments {d.signals.stripeConnected ? 'connected ✓' : 'not connected'}</p>
                <a href={d.tenant.bookingUrl} target="_blank" rel="noreferrer" className="inline-block pt-1 text-[12px] font-bold underline">Open their booking page ↗</a>
              </section>
            </div>

            <section className="rounded-3xl border-2 border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tools on</p>
              <p className="mt-2 flex flex-wrap gap-1.5">{(d.tenant.tools as string[]).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px]">{TOOL_BY_ID[t as ToolId]?.emoji} {TOOL_BY_ID[t as ToolId]?.name || t}</span>)}</p>
            </section>

            <section className="space-y-3 rounded-3xl border-2 border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Timeline</p>
                <div className="flex flex-wrap gap-1">
                  {([['all', 'All'], ['problems', 'Problems'], ['booking', 'Bookings'], ['message', 'Messages'], ['change', 'Changes'], ['help', 'Help']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={`h-8 rounded-full px-3 text-xs font-bold ${kind === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {timeline.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
              <ol className="space-y-1.5">
                {timeline.map((e: any, i: number) => (
                  <li key={i} className={`flex gap-3 rounded-2xl px-3 py-2 text-sm ${e.tone === 'bad' ? 'bg-red-50 text-red-900' : e.tone === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
                    <span aria-hidden>{KIND[e.kind] || '•'}</span>
                    <span className="min-w-0 flex-1 break-words">{e.text}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{when(e.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
