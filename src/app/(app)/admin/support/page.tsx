'use client';
// src/app/(app)/admin/support/page.tsx
//
// HQ · HELP DESK — every request, sorted so the right one is answered first.
//
// Queues: Mine · Unassigned · Urgent · Overdue (past its reply deadline) ·
// Developers (escalated bugs) · All open · Solved. Each ticket shows its
// priority, category and time left to first reply. Open one to see:
//   • AI notes — a one-line summary, the likely cause, whether a developer
//     is needed — and a drafted reply you can use, edit or regenerate
//   • what they were looking at (page, device, version, recent errors)
//   • the conversation, internal notes (never sent), saved replies
//   • assign, priority, category, escalate to developers, solve

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HqShell, Glass, Label, Chip, Loading, hq, ago, PRIORITY_TONE, useHqMe } from '@/components/hq/hq';

const CATS: Record<string, string> = { login: 'Sign-in', payments: 'Payments', booking: 'Booking', messages: 'Emails & texts', renters: 'Renters & rent', data: 'Data & import', bug: 'Bug', billing: 'Billing', question: 'Question', idea: 'Idea' };
const STATUS: Record<string, [string, string]> = { open: ['New', 'bg-amber-100 text-amber-800'], waiting_on_us: ['Our move', 'bg-red-100 text-red-700'], waiting_on_them: ['Their move', 'bg-sky-100 text-sky-800'], solved: ['Solved', 'bg-emerald-100 text-emerald-800'] };
type Q = 'mine' | 'unassigned' | 'urgent' | 'overdue' | 'dev' | 'open' | 'solved';

const due = (k: any) => {
  if (k.firstRespondedAt || !k.firstResponseDueAt || k.status === 'solved') return null;
  const m = Math.round((new Date(k.firstResponseDueAt).getTime() - Date.now()) / 60000);
  return m < 0 ? { late: true, text: `${Math.abs(m) < 60 ? `${Math.abs(m)}m` : `${Math.round(Math.abs(m) / 60)}h`} overdue` } : { late: false, text: `reply in ${m < 60 ? `${m}m` : `${Math.round(m / 60)}h`}` };
};

export default function HelpDeskPage() {
  const me = useHqMe();
  const [list, setList] = useState<any[] | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [macros, setMacros] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState<Q>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [instr, setInstr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const d = await hq({ action: 'tickets' }); if (d.ok) setList(d.tickets); else setErr(d.error || 'Couldn’t load.');
  }, []);
  useEffect(() => {
    void load();
    hq({ action: 'macros' }).then((d) => d.ok && setMacros(d.macros));
    hq({ action: 'team' }).then((d) => d.ok && setTeam([...(d.owners || []), ...(d.members || []).filter((m: any) => m.active !== false).map((m: any) => m.email)]));
  }, [load]);

  const counts = useMemo(() => {
    const L = list || []; const openL = L.filter((k) => k.status !== 'solved');
    return { mine: me?.email ? openL.filter((k) => k.assignee === me.email).length : 0, unassigned: openL.filter((k) => !k.assignee).length, urgent: openL.filter((k) => k.priority === 'urgent').length,
      overdue: openL.filter((k) => due(k)?.late).length, dev: openL.filter((k) => k.devStatus && !['fixed', 'wont_fix'].includes(k.devStatus)).length, open: openL.length, solved: L.length - openL.length };
  }, [list, me?.email]);
  const shown = useMemo(() => {
    const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return (list || []).filter((k) => {
      if (q === 'solved') return k.status === 'solved';
      if (k.status === 'solved') return false;
      if (q === 'mine') return !!me?.email && k.assignee === me.email;
      if (q === 'unassigned') return !k.assignee;
      if (q === 'urgent') return k.priority === 'urgent';
      if (q === 'overdue') return !!due(k)?.late;
      if (q === 'dev') return k.devStatus && !['fixed', 'wont_fix'].includes(k.devStatus);
      return true;
    }).sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2) || String(a.firstResponseDueAt || a.createdAt).localeCompare(String(b.firstResponseDueAt || b.createdAt)));
  }, [list, q, me?.email]);
  const k = (list || []).find((x) => x.id === openId) || null;

  const act = async (body: any, done?: string) => { setBusy(body.action); const d = await hq(body); setBusy(''); if (!d.ok) { setFlash(d.error || 'That didn’t work.'); return d; } if (done) setFlash(done); await load(); return d; };
  const open = (id: string) => { setOpenId(id); if (window.innerWidth < 1024) window.setTimeout(() => document.getElementById('hq-ticket')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); const t = (list || []).find((x) => x.id === id); setDraft(t?.ai?.suggestedReply && !(t.thread || []).some((m: any) => m.from === 'hq') ? t.ai.suggestedReply : ''); setNote(''); setInstr(''); setFlash(''); };

  return (
    <HqShell title="Help desk" sub="Every request, sorted so the right one is answered first.">
      {err && <p className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
      {!list && !err && <Loading />}
      {list && (
        <div className="space-y-4">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {([['mine', 'Mine'], ['unassigned', 'Unassigned'], ['urgent', 'Urgent'], ['overdue', 'Overdue'], ['dev', 'Developers'], ['open', 'All open'], ['solved', 'Solved']] as const).map(([key, l]) => (
              <Chip key={key} on={q === key} onClick={() => setQ(key)}>{l} <span className="opacity-60">{counts[key]}</span></Chip>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            {/* The queue */}
            <div className="space-y-2">
              {shown.length === 0 && <Glass><p className="py-6 text-center text-stone-500">{q === 'overdue' ? 'Nothing overdue. ✨' : 'All clear here. ✨'}</p></Glass>}
              {shown.map((t) => { const d = due(t); const st = STATUS[t.status] || STATUS.open; return (
                <button key={t.id} type="button" onClick={() => open(t.id)} className={`glass block w-full rounded-3xl border p-4 text-left transition ${openId === t.id ? 'border-stone-900/50 shadow-lg' : 'border-white/70 hover:border-stone-300'}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_TONE[t.priority || 'normal']}`}>{t.priority || 'normal'}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-stone-600">{CATS[t.category] || t.category || '—'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${st[1]}`}>{st[0]}</span>
                    {t.devStatus && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-800">dev · {t.devStatus}</span>}
                    {d && <span className={`ml-auto text-[11px] ${d.late ? 'font-semibold text-red-600' : 'text-stone-500'}`}>{d.text}</span>}
                  </div>
                  <p className="mt-2 truncate font-semibold">{t.ai?.summary || t.subject}</p>
                  <p className="truncate text-[12px] text-stone-500">{t.tenantName || t.tenantId} · {t.contactName || ''} · {ago(t.createdAt)}{t.assignee ? ` · ${t.assignee.split('@')[0]}` : ' · unassigned'}</p>
                </button>
              ); })}
            </div>

            {/* The working panel */}
            <div id="hq-ticket" className="scroll-mt-20 lg:sticky lg:top-20 lg:self-start">
              {!k ? <Glass><p className="py-10 text-center text-stone-500">Pick a request to work on it.</p></Glass> : (
                <Glass className="space-y-4">
                  <div>
                    <p className="text-xl font-light tracking-tight">{k.subject}</p>
                    <p className="text-[13px] text-stone-500"><Link href={`/admin/tenants/${k.tenantId}`} className="underline">{k.tenantName || k.tenantId}</Link> · {k.contactName} · {k.contactEmail} · {ago(k.createdAt)}</p>
                  </div>
                  {flash && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">{flash}</p>}

                  {k.ai && (
                    <div className="rounded-2xl border border-violet-200/70 bg-violet-50/70 p-3 text-sm">
                      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-violet-700">✦ AI notes</p>
                      <p className="mt-1 font-medium text-violet-950">{k.ai.summary}</p>
                      <p className="mt-1 text-violet-900">{k.ai.likelyCause}</p>
                      {k.ai.needsDeveloper && <p className="mt-1 font-semibold text-violet-900">Looks like a bug — consider escalating to developers.</p>}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <select value={k.assignee || ''} onChange={(e) => act({ action: 'ticket-update', ticketId: k.id, assignee: e.target.value || null })} className="h-10 rounded-xl border border-white/80 bg-white/70 px-2 text-[13px]" aria-label="Assignee">
                      <option value="">Unassigned</option>{team.map((e) => <option key={e} value={e}>{e.split('@')[0]}</option>)}
                    </select>
                    <select value={k.priority || 'normal'} onChange={(e) => act({ action: 'ticket-update', ticketId: k.id, priority: e.target.value })} className="h-10 rounded-xl border border-white/80 bg-white/70 px-2 text-[13px]" aria-label="Priority">
                      {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={k.category || 'question'} onChange={(e) => act({ action: 'ticket-update', ticketId: k.id, category: e.target.value })} className="h-10 rounded-xl border border-white/80 bg-white/70 px-2 text-[13px]" aria-label="Category">
                      {Object.entries(CATS).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </select>
                    {k.devStatus
                      ? <select value={k.devStatus} onChange={(e) => act({ action: 'ticket-update', ticketId: k.id, devStatus: e.target.value })} className="h-10 rounded-xl border border-violet-200 bg-violet-50 px-2 text-[13px]" aria-label="Developer status">{['new', 'investigating', 'fixed', 'wont_fix'].map((x) => <option key={x} value={x}>dev · {x.replace('_', ' ')}</option>)}</select>
                      : <button type="button" onClick={() => act({ action: 'ticket-update', ticketId: k.id, escalate: true }, 'Escalated to developers.')} className="h-10 rounded-xl border border-violet-200 bg-violet-50 px-2 text-[13px] text-violet-900">Escalate to dev</button>}
                  </div>

                  <div className="space-y-2">
                    <p className="whitespace-pre-wrap rounded-2xl bg-white/70 p-3 text-sm"><span className="font-semibold">{k.contactName || 'Owner'}:</span> {k.message}</p>
                    {(k.thread || []).map((m: any, i: number) => <p key={i} className={`whitespace-pre-wrap rounded-2xl p-3 text-sm ${m.from === 'hq' ? 'bg-emerald-50/80' : 'bg-white/70'}`}><span className="font-semibold">{m.from === 'hq' ? (m.by || '').split('@')[0] : k.contactName || 'Owner'}</span> · {ago(m.at)}<br />{m.message}</p>)}
                    {(k.internalNotes || []).map((n: any, i: number) => <p key={i} className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/80 p-3 text-[13px] text-amber-950">🔒 {n.text} <span className="text-[11px] text-amber-700">— {n.by?.split('@')[0]} · {ago(n.at)}</span></p>)}
                  </div>

                  <details className="rounded-2xl bg-white/60 p-3 text-[12px] text-stone-600">
                    <summary className="cursor-pointer font-medium">What they were looking at {(k.context?.errors || []).length ? <span className="text-red-600">· {k.context.errors.length} error{k.context.errors.length === 1 ? '' : 's'}</span> : ''}</summary>
                    <p className="mt-2"><span className="font-semibold">Page:</span> {k.context?.page || '—'}</p>
                    <p><span className="font-semibold">Version:</span> {k.context?.appVersion || '—'} on {k.context?.host || '—'} · {k.context?.screen || ''}</p>
                    <p className="break-all"><span className="font-semibold">Device:</span> {k.context?.userAgent || '—'}</p>
                    {(k.context?.errors || []).map((e: any, i: number) => <p key={i} className="text-red-700">• {e.message} ({e.page})</p>)}
                  </details>

                  {k.status !== 'solved' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {macros.slice(0, 8).map((m) => <button key={m.id} type="button" onClick={() => setDraft((x) => (x ? `${x}\n\n${m.body}` : m.body))} className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] text-stone-700">+ {m.title}</button>)}
                        <button type="button" onClick={async () => { const title = window.prompt('Save this reply as… (title)'); if (title && draft.trim()) await act({ action: 'macro-save', title, body: draft, category: k.category }, 'Saved reply added.'); hq({ action: 'macros' }).then((d) => d.ok && setMacros(d.macros)); }} className="rounded-full px-2.5 py-1 text-[11px] text-stone-500 underline">Save as reply</button>
                      </div>
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} placeholder={`Reply to ${k.contactName || 'them'} — emailed, and shown in their Help sheet`} className="w-full rounded-2xl border border-white/80 bg-white/80 p-3 text-sm outline-none focus:ring-2 focus:ring-stone-300" />
                      {me?.ai && (
                        <div className="flex gap-2">
                          <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Tell AI what to say (optional) — e.g. apologise, explain deposits" className="h-9 min-w-0 flex-1 rounded-xl border border-white/80 bg-white/70 px-3 text-[13px]" />
                          <button type="button" disabled={!!busy} onClick={async () => { const d = await act({ action: 'ticket-draft', ticketId: k.id, instructions: instr }); if (d?.ok && d.draft) { setDraft(d.draft); setFlash('Draft ready — read it before sending.'); } }} className="h-9 shrink-0 rounded-xl bg-violet-600 px-3 text-[12px] font-medium text-white disabled:opacity-50">{busy === 'ticket-draft' ? '…' : '✦ Draft with AI'}</button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!!busy || !draft.trim()} onClick={async () => { await act({ action: 'ticket-reply', ticketId: k.id, message: draft }, 'Reply sent.'); setDraft(''); }} className="h-10 rounded-full bg-stone-900 px-5 text-sm text-white disabled:opacity-40">Send reply</button>
                        <button type="button" disabled={!!busy} onClick={async () => { await act(draft.trim() ? { action: 'ticket-reply', ticketId: k.id, message: draft, status: 'solved' } : { action: 'ticket-status', ticketId: k.id, status: 'solved' }, 'Solved.'); setDraft(''); }} className="h-10 rounded-full border border-stone-300 bg-white/70 px-5 text-sm">{draft.trim() ? 'Send & solve' : 'Mark solved'}</button>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="🔒 Internal note — never sent" className="h-9 min-w-0 flex-1 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 text-[13px]" />
                        <button type="button" disabled={!note.trim()} onClick={async () => { await act({ action: 'ticket-note', ticketId: k.id, text: note }); setNote(''); }} className="h-9 rounded-xl bg-amber-200 px-3 text-[12px] text-amber-950 disabled:opacity-40">Add</button>
                      </div>
                    </div>
                  )}
                  {k.status === 'solved' && <button type="button" onClick={() => act({ action: 'ticket-status', ticketId: k.id, status: 'waiting_on_us' }, 'Reopened.')} className="text-[13px] underline">Reopen</button>}
                </Glass>
              )}
            </div>
          </div>
        </div>
      )}
    </HqShell>
  );
}
