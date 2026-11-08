'use client';
// src/app/(app)/admin/system/page.tsx
//
// HQ · SYSTEM — is ClarityFlow itself healthy?
//   • Ready to launch: every setting, Stripe webhook and published rule the
//     platform needs (lib/launch-readiness), grouped by how much it matters,
//     with the fix for each. Never the values, only whether they're there.
//   • Daily jobs: when each last ran; late or never is red.
//   • Delivery: emails and texts sent vs failed this week, with the latest
//     failures and which business they belong to.
//   • Versions: who's on an old copy of the app.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader, Check, X, CircleHelp, CircleAlert } from 'lucide-react';
import { HqShell, hq, ago } from '@/components/hq/hq';
import { readinessSummary } from '@/lib/launch-readiness-shared';

const GROUPS: { id: string; title: string; sub: string }[] = [
  { id: 'need', title: 'Needed to launch', sub: 'Without these, something people rely on fails.' },
  { id: 'invite', title: 'Before your first real business', sub: 'Fine for a test run.' },
  { id: 'optional', title: 'Optional', sub: 'Each turns on a feature. Nothing breaks without it.' },
  { id: 'unset', title: 'Leave these unset', sub: 'A problem only when they’re set.' },
];
const MARK: Record<string, { icon: any; color: string; label: string }> = {
  ok: { icon: Check, color: '#1f7a4d', label: 'Ready' },
  missing: { icon: X, color: '#b42318', label: 'Needs doing' },
  warn: { icon: CircleAlert, color: '#b45309', label: 'Check this' },
  unknown: { icon: CircleHelp, color: '#6d7075', label: 'Couldn’t check' },
};

function Readiness({ rows, error }: { rows: any[] | null; error: string }) {
  if (!rows) return (
    <section className="space-y-2 rounded-[1.75rem] border border-border bg-card p-4">
      <h2 className="text-[17px] font-bold">Ready to launch?</h2>
      {error ? <p className="text-[14px]" style={{ color: '#b45309' }}>{error}</p> : <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader className="h-4 w-4 animate-spin" aria-hidden /> Checking settings, Stripe and Firebase…</p>}
    </section>);
  const { need, unknown } = readinessSummary(rows);
  const line = need ? `${need} thing${need === 1 ? '' : 's'} still needed${unknown ? `, and ${unknown} couldn’t be checked` : ''}.` : unknown ? `Nothing known to be missing, but ${unknown} couldn’t be checked.` : 'Everything needed is in place.';
  return (
    <section className="space-y-4 rounded-[1.75rem] border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-[17px] font-bold">Ready to launch?</h2>
        <p className="text-[14px]" style={{ color: need ? '#b42318' : unknown ? '#b45309' : '#1f7a4d' }}>{line}</p>
      </div>
      {GROUPS.map((g) => { const list = rows.filter((r) => r.group === g.id); if (!list.length) return null; return (
        <div key={g.id} className="space-y-2">
          <div><p className="text-[14px] font-semibold">{g.title}</p><p className="text-[13px] text-muted-foreground">{g.sub}</p></div>
          {list.map((r) => { const m = MARK[r.state] || MARK.unknown; const I = m.icon; return (
            <div key={r.id} className="flex items-start gap-3 rounded-2xl bg-muted/40 px-3 py-2.5">
              <I className="mt-0.5 h-4 w-4 shrink-0" style={{ color: m.color }} aria-hidden />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[14px] font-semibold">{r.label} <span className="sr-only">: {m.label}</span></p>
                {r.note && <p className="break-words text-[13px] text-muted-foreground">{r.note}</p>}
                {r.fix && <p className={`break-words text-[13px] ${r.state === 'missing' ? 'text-foreground' : 'text-muted-foreground'}`}>{r.fix}</p>}
              </div>
            </div>); })}
        </div>); })}
    </section>
  );
}

export default function HqSystemPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<any[] | null>(null); const [rowsErr, setRowsErr] = useState('');
  useEffect(() => { hq({ action: 'system' }).then((r) => (r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.'))).catch(() => setErr('Couldn’t load. Check your connection and reload.')); }, []);
  // The launch check asks Stripe and Firebase, so it loads on its own and the rest of the page doesn't wait for it.
  useEffect(() => { hq({ action: 'readiness' }).then((r) => (r.ok && Array.isArray(r.rows) ? setRows(r.rows) : setRowsErr(r.error || 'The launch check didn’t load. Please reload.'))).catch(() => setRowsErr('The launch check didn’t load. Check your connection and reload.')); }, []);
  const rate = (x: any) => { const t = x.sent + x.failed; return t ? `${Math.round((x.sent / t) * 100)}%` : '—'; };
  return (
    <HqShell title="System" sub="Is ClarityFlow itself healthy?">
        <Readiness rows={rows} error={rowsErr} />
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!d && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {d && (
          <>

            <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[14px] font-semibold">Daily jobs</p>
              {d.jobs.map((j: any) => (
                <div key={j.name} className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${j.late ? 'bg-red-50 text-red-900' : 'bg-card/60'}`}>
                  <span><span className="font-bold">{j.label}</span></span>
                  <span className="shrink-0 text-[12px]">{j.lastRunAt ? `${j.hoursAgo}h ago` : 'never recorded'}{j.late ? ' — late' : ''}</span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Jobs start recording once this version is live — “never recorded” is expected until each has run once.</p>
            </section>

            <section className="space-y-3 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[14px] font-semibold">Delivery, last 7 days · {d.tenants} businesses</p>
              <div className="grid grid-cols-2 gap-2">
                {(['email', 'sms'] as const).map((ch) => (
                  <div key={ch} className="rounded-2xl bg-card/60 p-3"><p className="text-[13px] font-semibold text-muted-foreground">{ch === 'sms' ? 'Texts' : 'Emails'}</p><p className="text-2xl font-semibold">{rate(d.delivery[ch])}</p><p className="text-[12px] text-muted-foreground">{d.delivery[ch].sent} sent · {d.delivery[ch].failed} failed{d.delivery[ch].other ? ` · ${d.delivery[ch].other} held` : ''}</p></div>
                ))}
              </div>
              {d.failures.length > 0 && <div className="space-y-1">{d.failures.map((f: any, i: number) => <Link key={i} href={`/admin/tenants/${f.tenantId}`} className="block rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-900">{f.tenant} · {f.channel} · {f.kind} — {f.error || 'failed'} <span className="text-red-700">({ago(f.at)})</span></Link>)}</div>}
            </section>

            <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[14px] font-semibold">App versions</p>
              <p className="text-sm">Live version: <span className="font-mono font-bold">{d.current || 'unknown'}</span></p>
              {d.behind.length === 0 ? <p className="text-sm text-emerald-700">✓ Everyone active this week is on the live version.</p> : (
                <div className="space-y-1">{d.behind.map((b: any) => <Link key={b.tenantId} href={`/admin/tenants/${b.tenantId}`} className="block rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900">⚠ {b.tenantId} on {b.version} at {b.host || '?'} · seen {ago(b.lastSeenAt)}</Link>)}</div>
              )}
              <p className="text-[12px] text-muted-foreground">{d.openTickets} help request{d.openTickets === 1 ? '' : 's'} waiting · <Link href="/admin/support" className="underline">Help inbox</Link></p>
            </section>
          </>
        )}
      </HqShell>
  );
}
