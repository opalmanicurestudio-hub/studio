'use client';
// src/app/(app)/admin/tenants/page.tsx
//
// HQ · BUSINESSES — every business on ClarityFlow, the ones needing you most
// first. Health (0–100, with the reasons), setup progress and the next step,
// this week's bookings, last owner sign-in. Filter by what matters today.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader, Search } from 'lucide-react';
import { HqNav, hq, HEALTH_TONE, ago } from '@/components/hq/hq';

type Filter = 'all' | 'attention' | 'setup' | 'thriving' | 'new';

export default function HqTenantsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('attention');
  const [q, setQ] = useState('');
  useEffect(() => { hq({ action: 'tenants' }).then((d) => (d.ok ? setRows(d.tenants) : setErr(d.error || 'Couldn’t load.'))); }, []);

  const shown = useMemo(() => (rows || []).filter((t) => {
    if (q && !`${t.name} ${t.ownerEmail || ''} ${t.businessType}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'attention') return ['at risk', 'watch'].includes(t.health.label);
    if (filter === 'setup') return t.setup.done < t.setup.total;
    if (filter === 'thriving') return ['thriving', 'healthy'].includes(t.health.label);
    if (filter === 'new') return t.health.label === 'new';
    return true;
  }), [rows, filter, q]);

  const kpi = useMemo(() => {
    const r = rows || [];
    return {
      total: r.length, active: r.filter((t) => t.status === 'active').length,
      attention: r.filter((t) => ['at risk', 'watch'].includes(t.health.label)).length,
      bookings: r.reduce((n, t) => n + t.signals.bookings7d, 0),
      stuck: r.filter((t) => t.setup.done < t.setup.total && (t.signals.ageDays || 0) >= 3).length,
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50">
      <HqNav />
      <main className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-5">
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!rows && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {rows && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[['Businesses', kpi.total], ['Active', kpi.active], ['Need attention', kpi.attention], ['Stuck in setup', kpi.stuck], ['Bookings this week', kpi.bookings]].map(([l, v]) => (
                <div key={String(l)} className="rounded-3xl border-2 border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{l}</p><p className="mt-1 text-2xl font-black">{v}</p></div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {([['attention', 'Need attention'], ['setup', 'Stuck in setup'], ['new', 'New'], ['thriving', 'Doing well'], ['all', 'All']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={`h-9 rounded-full border-2 px-3.5 text-xs font-bold ${filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{l}</button>
              ))}
              <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search businesses" className="h-9 w-full rounded-full border-2 border-slate-200 pl-9 pr-3 text-sm" /></div>
            </div>

            {shown.length === 0 && <p className="rounded-3xl border-2 border-dashed p-8 text-center text-sm text-slate-500">{filter === 'attention' ? 'Nobody needs attention right now. 🎉' : 'Nothing here.'}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((t) => (
                <Link key={t.id} href={`/admin/tenants/${t.id}`} className="block space-y-3 rounded-3xl border-2 border-slate-200 bg-white p-4 transition hover:border-slate-400">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-base font-black">{t.name}</p><p className="truncate text-xs text-slate-500">{t.businessType} · {t.ownerEmail || 'no email'} · joined {ago(t.createdAt)}</p></div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${HEALTH_TONE[t.health.label]}`}>{t.health.label} · {t.health.score}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-500"><span>Setup {t.setup.done}/{t.setup.total}</span>{t.setup.next && <span>Next: {t.setup.next}</span>}</div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-slate-900" style={{ width: `${t.setup.pct}%` }} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-2xl bg-slate-50 p-2"><p className="text-lg font-black">{t.signals.bookings7d}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bookings 7d</p></div>
                    <div className="rounded-2xl bg-slate-50 p-2"><p className="text-lg font-black">{t.signals.clients}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Clients</p></div>
                    <div className="rounded-2xl bg-slate-50 p-2"><p className="text-sm font-black leading-7">{ago(t.lastSignIn)}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Owner seen</p></div>
                  </div>
                  {t.health.reasons.length > 0 && <p className="text-[12px] text-red-700">⚠ {t.health.reasons.slice(0, 2).join(' · ')}</p>}
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
