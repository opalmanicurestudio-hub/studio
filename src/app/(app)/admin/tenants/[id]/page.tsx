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
import { HqShell, hq, HEALTH_TONE, ago, money, pctText, rate } from '@/components/hq/hq';
import { TOOL_BY_ID, TOOLS, type ToolId } from '@/lib/module-catalog';

const KIND: Record<string, string> = { booking: '📅', message: '✉️', change: '✎', help: '🛟' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function HqTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<'all' | 'booking' | 'message' | 'change' | 'help' | 'problems'>('all');
  const load = () => hq({ action: 'tenant', id }).then((r) => (r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.')));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [tools, setTools] = useState<string[] | null>(null);
  const fix = async (fixName: string, extra: any = {}, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(fixName + (extra.appointmentId || '')); setMsg('');
    const r = await hq({ action: 'fix', tenantId: id, fix: fixName, ...extra });
    setBusy('');
    if (r.link) { try { await navigator.clipboard.writeText(r.link); } catch { /* ignore */ } }
    setMsg(r.message || r.error || (r.ok ? 'Done.' : 'That didn’t work.'));
    void load();
  };

  const timeline = (d?.timeline || []).filter((e: any) => kind === 'all' ? true : kind === 'problems' ? e.tone === 'bad' || e.tone === 'warn' : e.kind === kind);
  return (
    <HqShell>
        <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-stone-500"><ArrowLeft className="h-4 w-4" />All businesses</Link>
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!d && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-stone-400" /></div>}
        {d && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-light tracking-tight">{d.tenant.name}</h1>
                <p className="text-sm text-stone-500">{d.tenant.businessType} · {d.tenant.status} · joined {ago(d.tenant.createdAt)}{d.tenant.inviteCode ? ` · invite ${d.tenant.inviteCode}` : ''}</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${HEALTH_TONE[d.health.label]}`}>{d.health.label} · {d.health.score}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Why</p>
                {d.health.reasons.map((r: string) => <p key={r} className="text-sm text-red-700">⚠ {r}</p>)}
                {d.health.good.map((r: string) => <p key={r} className="text-sm text-emerald-700">✓ {r}</p>)}
                {!d.health.reasons.length && !d.health.good.length && <p className="text-sm text-stone-500">Not enough activity yet.</p>}
              </section>
              <section className="space-y-2 glass rounded-[1.75rem] border border-white/70 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Setup · {d.setup.done}/{d.setup.total}</p>
                {d.setup.steps.map((s: any) => <p key={s.key} className={`text-sm ${s.done ? 'text-stone-700' : 'font-bold text-stone-900'}`}>{s.done ? '✓' : '○'} {s.label}</p>)}
              </section>
              <section className="space-y-1.5 glass rounded-[1.75rem] border border-white/70 p-4 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Owner</p>
                <p className="font-bold">{d.tenant.owner.email ? <a href={`mailto:${d.tenant.owner.email}`} className="underline">{d.tenant.owner.email}</a> : '—'}</p>
                <p className="text-stone-600">Last signed in {ago(d.tenant.owner.lastSignIn)}</p>
                <p className="text-stone-600">{d.signals.clients} clients · {d.signals.services} services · {d.signals.staff} team</p>
                <p className="text-stone-600">{d.signals.bookings7d} bookings this week (previous week {d.signals.bookingsPrev7d})</p>
                <p className="text-stone-600">Payments {d.signals.stripeConnected ? 'connected ✓' : 'not connected'}</p>
                <a href={d.tenant.bookingUrl} target="_blank" rel="noreferrer" className="inline-block pt-1 text-[12px] font-bold underline">Open their booking page ↗</a>
              </section>
            </div>

            {d.metrics && (
              <section className="glass rounded-[1.75rem] border border-white/70 p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-stone-400">Results & cost to serve · 30 days</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-6">
                  {[['Revenue', money(d.metrics.revenue30)], ['vs prior', pctText(d.metrics.revenueChangePct)], ['Since joining', d.metrics.sinceJoining ? pctText(d.metrics.sinceJoining.revenueChangePct) : 'too new'],
                    ['No-shows', rate(d.metrics.noShowRate)], ['Rebook', rate(d.metrics.rebookRate)], ['Cost to serve', money(d.metrics.cost30?.total, 2)]].map(([l, v]) => (
                    <div key={l} className="rounded-2xl bg-white/60 p-2"><p className="text-lg font-semibold">{v}</p><p className="text-[10px] uppercase tracking-widest text-stone-400">{l}</p></div>
                  ))}
                </div>
                {d.metrics.sinceJoining && <p className="mt-2 text-[12px] text-stone-600">First month {money(d.metrics.sinceJoining.firstMonthRevenue)} → latest {money(d.metrics.sinceJoining.latestMonthRevenue)} · bookings {d.metrics.sinceJoining.firstMonthBookings} → {d.metrics.sinceJoining.latestMonthBookings}</p>}
              </section>
            )}

            {/* ── Fix & manage — every action is logged ── */}
            <section className="space-y-3 glass rounded-[1.75rem] border border-stone-900/40 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Fix & manage</p>
              {msg && <p className="break-all rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} onClick={() => fix('password-link', { send: true }, `Email a password reset link to ${d.tenant.owner.email}?`)} className="h-9 rounded-xl bg-stone-900 px-3 text-xs font-bold text-white disabled:opacity-50">Email a password reset</button>
                <button type="button" disabled={!!busy} onClick={() => fix('password-link', { send: false })} className="h-9 rounded-xl border-2 px-3 text-xs font-bold disabled:opacity-50">Copy reset link</button>
                {d.accessLocked
                  ? <button type="button" disabled={!!busy} onClick={() => fix('restore', {}, 'Restore access for this business?')} className="h-9 rounded-xl border-2 border-emerald-300 px-3 text-xs font-bold text-emerald-800">Restore access</button>
                  : <button type="button" disabled={!!busy} onClick={() => { const reason = window.prompt('Pause access — reason (shown in your log):'); if (reason !== null) void fix('suspend', { reason }); }} className="h-9 rounded-xl border-2 border-red-200 px-3 text-xs font-bold text-red-700">Pause access</button>}
              </div>
              {d.accessLocked && <p className="text-sm font-bold text-red-700">Access is paused — they see the suspended page.</p>}
              <p className="text-[12px] text-stone-500">In the app: {d.presence?.lastSeenAt ? `last seen ${ago(d.presence.lastSeenAt)} on version ${d.presence.version || '?'}${d.currentVersion && d.presence.version && d.presence.version !== d.currentVersion ? ' — ⚠ not the current version (old copy or cached app)' : ''}` : 'not seen since this was added'}</p>

              <div>
                <p className="mb-1.5 text-[11px] font-bold text-stone-500">Recent bookings</p>
                <div className="space-y-1">
                  {(d.recent || []).map((a: any) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/60 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{a.clientName || 'Client'} · {a.serviceName || ''} · {a.startTime ? new Date(a.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''} · <span className="font-bold">{a.status}</span></span>
                      <button type="button" disabled={!!busy} onClick={() => fix('resend-confirmation', { appointmentId: a.id })} className="h-7 rounded-lg border px-2 text-[11px] font-bold">{busy === 'resend-confirmation' + a.id ? '…' : 'Resend confirmation'}</button>
                      {a.hasCheckIn && <button type="button" disabled={!!busy} onClick={() => fix('resync-checkin', { appointmentId: a.id })} className="h-7 rounded-lg border px-2 text-[11px] font-bold">{busy === 'resync-checkin' + a.id ? '…' : 'Re-sync status'}</button>}
                    </div>
                  ))}
                  {(!d.recent || d.recent.length === 0) && <p className="text-sm text-stone-500">No bookings yet.</p>}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold text-stone-500">Tools (for them)</p>
                {tools === null ? <button type="button" onClick={() => setTools(d.tenant.tools)} className="h-8 rounded-lg border px-3 text-[11px] font-bold">Change their tools</button> : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">{TOOLS.map((t) => { const on = tools.includes(t.id) || t.gates.length === 0; return (
                      <button key={t.id} type="button" disabled={t.gates.length === 0} onClick={() => setTools(on ? tools.filter((x) => x !== t.id) : [...tools, t.id])} className={`h-8 rounded-full px-3 text-[12px] ${on ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-600'}`}>{t.emoji} {t.name}</button>); })}</div>
                    <div className="flex gap-2"><button type="button" onClick={async () => { await fix('set-tools', { tools }); setTools(null); }} className="h-8 rounded-lg bg-stone-900 px-3 text-[11px] font-bold text-white">Save tools</button><button type="button" onClick={() => setTools(null)} className="h-8 rounded-lg px-3 text-[11px] font-bold text-stone-500">Cancel</button></div>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold text-stone-500">Private notes (only HQ sees these)</p>
                <div className="flex gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called Sept 25 — moving from Vagaro next week" className="h-9 min-w-0 flex-1 rounded-xl border-2 px-3 text-sm" /><button type="button" disabled={!note.trim()} onClick={async () => { await fix('note', { text: note }); setNote(''); }} className="h-9 rounded-xl bg-stone-900 px-3 text-xs font-bold text-white disabled:opacity-40">Save</button></div>
                <div className="mt-2 space-y-1">{(d.notes || []).map((n: any, i: number) => <p key={i} className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{n.text} <span className="text-[11px] text-amber-700">— {n.by?.split('@')[0]} · {ago(n.at)}</span></p>)}</div>
              </div>

              {(d.hqActions || []).length > 0 && (
                <details><summary className="cursor-pointer text-[11px] font-bold text-stone-500">HQ actions on this business</summary>
                  <div className="mt-1 space-y-0.5">{d.hqActions.map((a: any) => <p key={a.id} className="text-[12px] text-stone-600">{ago(a.at)} · {a.by?.split('@')[0]} · {a.summary}</p>)}</div>
                </details>
              )}
            </section>

            <section className="glass rounded-[1.75rem] border border-white/70 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Tools on</p>
              <p className="mt-2 flex flex-wrap gap-1.5">{(d.tenant.tools as string[]).map((t) => <span key={t} className="rounded-full bg-white/70 px-2.5 py-1 text-[12px]">{TOOL_BY_ID[t as ToolId]?.emoji} {TOOL_BY_ID[t as ToolId]?.name || t}</span>)}</p>
            </section>

            <section className="space-y-3 glass rounded-[1.75rem] border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Timeline</p>
                <div className="flex flex-wrap gap-1">
                  {([['all', 'All'], ['problems', 'Problems'], ['booking', 'Bookings'], ['message', 'Messages'], ['change', 'Changes'], ['help', 'Help']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={`h-8 rounded-full px-3 text-xs font-bold ${kind === k ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-600'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {timeline.length === 0 && <p className="text-sm text-stone-500">Nothing yet.</p>}
              <ol className="space-y-1.5">
                {timeline.map((e: any, i: number) => (
                  <li key={i} className={`flex gap-3 rounded-2xl px-3 py-2 text-sm ${e.tone === 'bad' ? 'bg-red-50 text-red-900' : e.tone === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-white/60 text-stone-700'}`}>
                    <span aria-hidden>{KIND[e.kind] || '•'}</span>
                    <span className="min-w-0 flex-1 break-words">{e.text}</span>
                    <span className="shrink-0 text-[11px] text-stone-400">{when(e.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </HqShell>
  );
}
