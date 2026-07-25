'use client';

// src/app/(booking)/maintain/[tenantId]/page.tsx
//
// MAINTENANCE TECH PORTAL — the whole job in one thumb-friendly page.
// Techs open their personal token link (texted by the owner), see their
// queue sorted by SLA deadline, and work tickets: claim, add progress
// notes, resolve. Every action lands on the ticket's public thread, so
// the owner and the reporting renter see status without anyone calling
// anyone.
//
// Auth = the token in the URL (?t=...). Rotating the worker's token in
// the Booth Hub revokes this link instantly. No accounts, no passwords.

import React, { useEffect, useMemo, useState } from 'react';

function useIds(): { tenantId: string; token: string } {
  return useMemo(() => {
    if (typeof window === 'undefined') return { tenantId: '', token: '' };
    try {
      const q = new URLSearchParams(window.location.search);
      const parts = window.location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('maintain');
      return { tenantId: i >= 0 ? (parts[i + 1] || '') : (q.get('tenantId') || ''), token: q.get('t') || '' };
    } catch { return { tenantId: '', token: '' }; }
  }, []);
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
  normal: 'bg-slate-100 text-slate-600', low: 'bg-slate-50 text-slate-400',
};
const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700', in_progress: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-emerald-100 text-emerald-700',
};

const fmtWhen = (s?: string | null) => {
  if (!s) return '';
  try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return String(s).slice(0, 16); }
};

export function MaintenancePortalPage() {
  const { tenantId, token } = useIds();
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [error, setError] = useState('');
  const [studioName, setStudioName] = useState('');
  const [worker, setWorker] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!tenantId || !token) { setState('denied'); setError('This link is incomplete — ask the studio to resend it.'); return; }
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'worker-view', tenantId, token }),
      });
      const d = await res.json();
      if (!d.ok) { setState('denied'); setError(d.error || 'Access denied.'); return; }
      setStudioName(d.studioName || 'The studio');
      setWorker(d.worker);
      setTickets(d.tickets || []);
      setState('ready');
    } catch { setState('denied'); setError('Network error — pull to refresh.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, token]);

  const act = async (ticketId: string, status?: 'in_progress' | 'resolved') => {
    if (busy) return;
    if (!status && !note.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'worker-update', tenantId, token, ticketId, status, note: note.trim() || undefined }),
      });
      const d = await res.json();
      if (d.ok) { setNote(''); setOpenId(null); await load(); }
      else setError(d.error || 'Could not save — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  };

  const nowIso = new Date().toISOString();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">{studioName || 'Maintenance'}</p>
          <h1 className="text-xl font-black tracking-tight text-slate-900 mt-0.5">
            {state === 'ready' ? `Work queue — ${worker?.name}` : 'Maintenance portal'}
          </h1>
        </div>

        {state === 'loading' && (
          <div className="rounded-3xl bg-white border-2 p-8 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
          </div>
        )}

        {state === 'denied' && (
          <div className="rounded-3xl bg-white border-2 p-6 text-center space-y-1">
            <p className="text-sm font-black text-slate-900">Can't open the queue</p>
            <p className="text-xs font-bold text-slate-500">{error}</p>
          </div>
        )}

        {state === 'ready' && tickets.length === 0 && (
          <div className="rounded-3xl bg-white border-2 p-8 text-center">
            <p className="text-sm font-black text-slate-900">Queue is clear</p>
            <p className="text-xs font-bold text-slate-500 mt-1">Nothing open right now — new tickets will appear here and you'll get a text.</p>
          </div>
        )}

        {state === 'ready' && tickets.map((t) => {
          const overdue = t.dueAt && t.dueAt < nowIso;
          const expanded = openId === t.id;
          return (
            <div key={t.id} className={`rounded-3xl bg-white border-2 overflow-hidden ${overdue ? 'border-red-300' : ''}`}>
              <button onClick={() => { setOpenId(expanded ? null : t.id); setNote(''); }} className="w-full text-left p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 leading-snug">{t.title}</p>
                    <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                      {t.boothName ? `${t.boothName} · ` : ''}{t.category} · reported by {t.reporterName} · {fmtWhen(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${PRIORITY_TONE[t.priority] || PRIORITY_TONE.normal}`}>{t.priority}</span>
                    <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${STATUS_TONE[t.status] || ''}`}>{t.status === 'in_progress' ? 'In progress' : t.status}</span>
                  </div>
                </div>
                {overdue && <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mt-1.5">Overdue — was due {fmtWhen(t.dueAt)}</p>}
                {!t.assignedToMe && !expanded && <p className="text-[10px] font-bold text-indigo-600 mt-1.5">Unassigned — open to claim it</p>}
              </button>

              {expanded && (
                <div className="border-t px-4 py-3 space-y-3">
                  {t.description && <p className="text-xs font-medium text-slate-600 whitespace-pre-wrap">{t.description}</p>}
                  {(t.updates || []).length > 0 && (
                    <div className="space-y-1.5">
                      {(t.updates || []).slice(-5).map((u: any, i: number) => (
                        <p key={i} className="text-[11px] font-medium text-slate-500">
                          <span className="font-black text-slate-700">{u.by}</span>
                          {u.status ? ` → ${u.status === 'in_progress' ? 'in progress' : u.status}` : ''}
                          {u.note ? ` — ${u.note}` : ''}
                          <span className="text-slate-400"> · {fmtWhen(u.at)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder="Progress note — parts ordered, what you found, what's next…"
                    className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium" />
                  <div className="grid grid-cols-2 gap-2">
                    {t.status === 'open' && (
                      <button onClick={() => act(t.id, 'in_progress')} disabled={busy}
                        className="h-12 rounded-2xl bg-indigo-600 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
                        {t.assignedToMe ? 'Start work' : 'Claim & start'}
                      </button>
                    )}
                    <button onClick={() => act(t.id, 'resolved')} disabled={busy}
                      className="h-12 rounded-2xl bg-emerald-600 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
                      Mark resolved
                    </button>
                    <button onClick={() => act(t.id)} disabled={busy || !note.trim()}
                      className={`h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest text-slate-700 disabled:opacity-40 ${t.status === 'open' ? 'col-span-2' : ''}`}>
                      Save note only
                    </button>
                  </div>
                  {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}
                </div>
              )}
            </div>
          );
        })}

        {state === 'ready' && (
          <p className="text-center text-[10px] font-medium text-slate-400">
            Notes and status changes are visible to the studio and the person who reported the issue.
          </p>
        )}
      </div>
    </div>
  );
}

export default MaintenancePortalPage;
