'use client';
// src/app/(app)/admin/support/page.tsx
//
// HQ · HELP INBOX — every request from the in-app Help button, with what the
// business was looking at: page, device, app version, recent errors. Reply
// (emailed to them and shown in their Help sheet), set status, jump to the
// business's timeline.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader } from 'lucide-react';
import { HqNav, hq, ago } from '@/components/hq/hq';

const STATUS: [string, string, string][] = [['open', 'New', 'bg-amber-100 text-amber-800'], ['waiting_on_us', 'Our move', 'bg-red-100 text-red-700'], ['waiting_on_them', 'Their move', 'bg-sky-100 text-sky-800'], ['solved', 'Solved', 'bg-emerald-100 text-emerald-800']];
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function HqSupportPage() {
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => hq({ action: 'tickets' }).then((d) => (d.ok ? setList(d.tickets) : setErr(d.error || 'Couldn’t load.'))), []);
  useEffect(() => { void load(); }, [load]);

  const shown = (list || []).filter((k) => filter === 'all' || ['open', 'waiting_on_us'].includes(k.status));
  const reply = async (k: any, solve = false) => {
    setBusy(true);
    const d = draft.trim() ? await hq({ action: 'ticket-reply', ticketId: k.id, message: draft, status: solve ? 'solved' : 'waiting_on_them' }) : await hq({ action: 'ticket-status', ticketId: k.id, status: 'solved' });
    setBusy(false);
    if (d.ok) { setDraft(''); void load(); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HqNav />
      <main className="mx-auto max-w-4xl space-y-4 px-4 pb-24 pt-5">
        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
        {!list && !err && <div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {list && (
          <>
            <div className="flex gap-2">
              {([['todo', `To do · ${(list || []).filter((k) => ['open', 'waiting_on_us'].includes(k.status)).length}`], ['all', 'All']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={`h-9 rounded-full border-2 px-3.5 text-xs font-bold ${filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{l}</button>
              ))}
            </div>
            {shown.length === 0 && <p className="rounded-3xl border-2 border-dashed p-8 text-center text-sm text-slate-500">Inbox zero. 🎉</p>}
            {shown.map((k) => { const st = STATUS.find((s) => s[0] === k.status) || STATUS[0]; const isOpen = openId === k.id; return (
              <article key={k.id} className="rounded-3xl border-2 border-slate-200 bg-white p-4">
                <button type="button" onClick={() => { setOpenId(isOpen ? null : k.id); setDraft(''); }} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-black">{k.subject}</p><p className="truncate text-xs text-slate-500">{k.tenantName || k.tenantId} · {k.contactName || ''} · {ago(k.createdAt)} · {k.kind}</p></div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${st[2]}`}>{st[1]}</span>
                  </div>
                  {!isOpen && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{k.message}</p>}
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-3">
                    <p className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 text-sm">{k.message}</p>
                    <div className="grid gap-1 rounded-2xl border-2 border-slate-100 p-3 text-[12px] text-slate-600">
                      <p><span className="font-bold">Page:</span> {k.context?.page || '—'}</p>
                      <p><span className="font-bold">Version:</span> {k.context?.appVersion || '—'} on {k.context?.host || '—'} · {k.context?.screen || ''}</p>
                      <p className="truncate"><span className="font-bold">Device:</span> {k.context?.userAgent || '—'}</p>
                      {(k.context?.errors || []).length > 0 ? (
                        <div><p className="font-bold text-red-700">Recent errors</p>{k.context.errors.map((e: any, i: number) => <p key={i} className="text-red-700">• {e.message} <span className="text-slate-400">({e.page})</span></p>)}</div>
                      ) : <p className="text-emerald-700">No errors recorded</p>}
                    </div>
                    {(k.thread || []).map((m: any, i: number) => <p key={i} className={`rounded-2xl p-3 text-sm ${m.from === 'hq' ? 'bg-emerald-50' : 'bg-slate-100'}`}><span className="font-bold">{m.from === 'hq' ? 'You' : k.contactName || 'Them'}</span> · {when(m.at)}<br />{m.message}</p>)}
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder={`Reply to ${k.contactName || 'them'} — sent by email and shown in their Help sheet`} className="w-full rounded-2xl border-2 border-slate-200 p-3 text-sm" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !draft.trim()} onClick={() => reply(k)} className="h-10 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-40">Send reply</button>
                      <button type="button" disabled={busy} onClick={() => reply(k, true)} className="h-10 rounded-xl border-2 px-4 text-xs font-bold">{draft.trim() ? 'Send & mark solved' : 'Mark solved'}</button>
                      <Link href={`/admin/tenants/${k.tenantId}`} className="h-10 rounded-xl px-3 text-xs font-bold leading-10 text-slate-600 underline">Their timeline →</Link>
                    </div>
                  </div>
                )}
              </article>
            ); })}
          </>
        )}
      </main>
    </div>
  );
}
