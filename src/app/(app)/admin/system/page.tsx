'use client';
// src/app/(app)/admin/system/page.tsx
//
// HQ · SYSTEM — is ClarityFlow itself healthy?
//   • Settings: every Vercel setting the platform needs, set or not (never
//     the values — just whether they're there and what they're doing).
//   • Daily jobs: when each last ran; late or never is red.
//   • Delivery: emails and texts sent vs failed this week, with the latest
//     failures and which business they belong to.
//   • Versions: who's on an old copy of the app.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader } from 'lucide-react';
import { HqShell, hq, ago } from '@/components/hq/hq';

export default function HqSystemPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { hq({ action: 'system' }).then((r) => (r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.'))); }, []);
  const rate = (x: any) => { const t = x.sent + x.failed; return t ? `${Math.round((x.sent / t) * 100)}%` : '—'; };
  return (
    <HqShell title="System" sub="Is ClarityFlow itself healthy?">
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!d && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-stone-400" /></div>}
        {d && (
          <>
            <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Settings</p>
              {d.settings.map((s: any) => (
                <div key={s.key} className="flex items-start gap-3 text-sm"><span className={s.ok ? 'text-emerald-600' : 'text-red-600'}>{s.ok ? '✓' : '✕'}</span><span className="min-w-0 flex-1"><span className="font-bold">{s.key}</span> <span className="text-stone-500">— {s.note}</span></span></div>
              ))}
            </section>

            <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Daily jobs</p>
              {d.jobs.map((j: any) => (
                <div key={j.name} className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${j.late ? 'bg-red-50 text-red-900' : 'bg-white/60'}`}>
                  <span><span className="font-bold">{j.label}</span></span>
                  <span className="shrink-0 text-[12px]">{j.lastRunAt ? `${j.hoursAgo}h ago` : 'never recorded'}{j.late ? ' — late' : ''}</span>
                </div>
              ))}
              <p className="text-[11px] text-stone-500">Jobs start recording once this version is live — “never recorded” is expected until each has run once.</p>
            </section>

            <section className="space-y-3 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Delivery · last 7 days · {d.tenants} businesses</p>
              <div className="grid grid-cols-2 gap-2">
                {(['email', 'sms'] as const).map((ch) => (
                  <div key={ch} className="rounded-2xl bg-white/60 p-3"><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{ch === 'sms' ? 'Texts' : 'Emails'}</p><p className="text-2xl font-semibold">{rate(d.delivery[ch])}</p><p className="text-[12px] text-stone-500">{d.delivery[ch].sent} sent · {d.delivery[ch].failed} failed{d.delivery[ch].other ? ` · ${d.delivery[ch].other} held` : ''}</p></div>
                ))}
              </div>
              {d.failures.length > 0 && <div className="space-y-1">{d.failures.map((f: any, i: number) => <Link key={i} href={`/admin/tenants/${f.tenantId}`} className="block rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-900">{f.tenant} · {f.channel} · {f.kind} — {f.error || 'failed'} <span className="text-red-700">({ago(f.at)})</span></Link>)}</div>}
            </section>

            <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">App versions</p>
              <p className="text-sm">Live version: <span className="font-mono font-bold">{d.current || 'unknown'}</span></p>
              {d.behind.length === 0 ? <p className="text-sm text-emerald-700">✓ Everyone active this week is on the live version.</p> : (
                <div className="space-y-1">{d.behind.map((b: any) => <Link key={b.tenantId} href={`/admin/tenants/${b.tenantId}`} className="block rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900">⚠ {b.tenantId} on {b.version} at {b.host || '?'} · seen {ago(b.lastSeenAt)}</Link>)}</div>
              )}
              <p className="text-[12px] text-stone-500">{d.openTickets} help request{d.openTickets === 1 ? '' : 's'} waiting · <Link href="/admin/support" className="underline">Help inbox</Link></p>
            </section>
          </>
        )}
      </HqShell>
  );
}
