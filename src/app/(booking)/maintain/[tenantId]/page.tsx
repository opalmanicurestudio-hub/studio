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
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [costDollars, setCostDollars] = useState('');
  const [hoursDraft, setHoursDraft] = useState('');
  const [deadlineDraft, setDeadlineDraft] = useState('');

  const pickPhoto = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('That file isn\'t an image.'); return; }
    if (file.size > 2_800_000) { setError('Photo too large — most phones can pick a smaller size, or screenshot it.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setPhotoData(String(reader.result || '')); setPhotoName(file.name); setError(''); };
    reader.onerror = () => setError('Could not read that photo — try another.');
    reader.readAsDataURL(file);
  };

  const load = async () => {
    if (!tenantId || !token) { setState('denied'); setError('This link is incomplete — ask the studio to resend it.'); return; }
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'worker-view', tenantId, token }),
      });
      // Surface the REAL failure — a generic "network error" hides whether
      // the API route is missing (404), crashed (500), or rejected the token.
      let d: any = null;
      try { d = await res.json(); } catch { /* non-JSON body (error page) */ }
      if (!res.ok || !d?.ok) {
        setState('denied');
        if (res.status === 404) setError('The portal service is not on this deployment (404). The app needs src/app/api/maintenance/route.ts deployed — then this link will work.');
        else if (res.status >= 500) setError(`The portal service hit an error (${res.status})${d?.error ? ` — ${d.error}` : ''}. The studio can check the /api/maintenance function logs.`);
        else setError(d?.error || `Access denied (${res.status}). Ask the studio to resend your link.`);
        return;
      }
      setStudioName(d.studioName || 'The studio');
      setWorker(d.worker);
      setTickets(d.tickets || []);
      setState('ready');
    } catch { setState('denied'); setError('No connection to the server — check your signal and tap Try again.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, token]);

  const act = async (ticketId: string, status?: 'in_progress' | 'resolved', dueAt?: string) => {
    if (busy) return;
    if (!status && !note.trim() && !photoData && !dueAt) return;
    setBusy(true);
    try {
      const costCents = status === 'resolved' && Number(costDollars) > 0
        ? Math.round(Number(costDollars) * 100) : undefined;
      const laborHours = status === 'resolved' && Number(hoursDraft) > 0
        ? Math.min(24, Number(hoursDraft)) : undefined;
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'worker-update', tenantId, token, ticketId, status,
          note: note.trim() || undefined,
          photoData: photoData || undefined,
          costCents, laborHours,
          dueAt: dueAt || undefined,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        if (d.photoError) setError(d.photoError);
        setNote(''); setPhotoData(null); setPhotoName(''); setCostDollars(''); setHoursDraft(''); setDeadlineDraft(''); setOpenId(null);
        await load();
      } else setError(d.error || 'Could not save — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  };

  // Print a WORK ORDER — a clean paper/PDF record of the whole job:
  // details, timeline, money, and sign-off lines. Works from the phone's
  // share/print sheet; the studio has the same button on their side.
  const printTicket = (t: any) => {
    try {
      const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const rows = (t.updates || []).map((u: any) =>
        `<tr><td>${esc(fmtWhen(u.at))}</td><td>${esc(u.by)}${u.status ? ` → ${esc(u.status === 'in_progress' ? 'in progress' : u.status)}` : ''}</td><td>${esc(u.note || '')}${u.photoUrl ? ' (photo)' : ''}</td></tr>`).join('');
      const photos = (Array.isArray(t.photoUrls) ? t.photoUrls : []).map((u: string) =>
        `<img src="${esc(u)}" style="height:120px;border:1px solid #ccc;border-radius:8px;margin:4px" />`).join('');
      const w = window.open('', '_blank');
      if (!w) { setError('Allow pop-ups to print.'); return; }
      w.document.write(`<!doctype html><html><head><title>Work order — ${esc(t.title)}</title><style>
        body{font-family:-apple-system,system-ui,sans-serif;padding:24px;color:#111;max-width:720px;margin:0 auto}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#555;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0} td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:13px;margin:12px 0}
        .lbl{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
        .sig{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
        .sig div{border-top:1px solid #111;padding-top:4px;font-size:11px;color:#555}
        @media print{.noprint{display:none}}</style></head><body>
        <h1>Work order — ${esc(t.title)}</h1>
        <p class="sub">${esc(studioName)} · Ticket ${esc(String(t.id).slice(0, 8).toUpperCase())}</p>
        <div class="grid">
          <div><span class="lbl">Location</span><br/>${esc([t.boothName, t.resourceName].filter(Boolean).join(' · ') || '—')}</div>
          <div><span class="lbl">Category / priority</span><br/>${esc(t.category)} · ${esc(t.priority)}</div>
          <div><span class="lbl">Reported by</span><br/>${esc(t.reporterName || '—')} on ${esc(fmtWhen(t.createdAt))}</div>
          <div><span class="lbl">Status</span><br/>${esc(t.status === 'in_progress' ? 'In progress' : t.status)}${t.dueAt ? ` · due ${esc(fmtWhen(t.dueAt))}` : ''}</div>
        </div>
        ${t.description ? `<p style="font-size:13px;white-space:pre-wrap">${esc(t.description)}</p>` : ''}
        <table><tr><th>When</th><th>Who</th><th>Update</th></tr>${rows || '<tr><td colspan=3>No updates yet</td></tr>'}</table>
        ${photos ? `<div>${photos}</div>` : ''}
        <div class="sig"><div>Completed by / date</div><div>Approved by / date</div></div>
        <p class="noprint" style="margin-top:24px"><button onclick="window.print()" style="padding:10px 18px;font-weight:700">Print</button></p>
        <script>setTimeout(function(){ try { window.print(); } catch (e) {} }, 300)</script>
      </body></html>`);
      w.document.close();
    } catch { setError('Could not open the print view.'); }
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
          {state === 'ready' && worker?.payType !== 'payroll' && (worker?.unpaidLaborCents || 0) > 0 && (
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mt-1">
              Unpaid labor balance: ${((worker.unpaidLaborCents || 0) / 100).toFixed(2)} — the studio pays this out
            </p>
          )}
        </div>

        {/* Persistent error banner — a photo that failed to save must not
            vanish with the collapsed ticket. */}
        {state === 'ready' && error && (
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 flex items-start gap-2">
            <p className="flex-1 text-[11px] font-bold text-red-700">{error}</p>
            <button onClick={() => setError('')} className="text-[9px] font-black uppercase tracking-widest text-red-400 underline shrink-0">Dismiss</button>
          </div>
        )}

        {state === 'loading' && (
          <div className="rounded-3xl bg-white border-2 p-8 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
          </div>
        )}

        {state === 'denied' && (
          <div className="rounded-3xl bg-white border-2 p-6 text-center space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-900">Can't open the queue</p>
              <p className="text-xs font-bold text-slate-500">{error}</p>
            </div>
            <button onClick={() => { setState('loading'); setError(''); load(); }}
              className="h-10 px-5 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">
              Try again
            </button>
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
              <button onClick={() => { setOpenId(expanded ? null : t.id); setNote(''); setPhotoData(null); setPhotoName(''); setCostDollars(''); }} className="w-full text-left p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 leading-snug">{t.title}</p>
                    <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                      {[t.boothName, t.resourceName].filter(Boolean).join(' · ')}{(t.boothName || t.resourceName) ? ' · ' : ''}{t.category} · reported by {t.reporterName} · {fmtWhen(t.createdAt)}
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
                  {Array.isArray(t.photoUrls) && t.photoUrls.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {t.photoUrls.map((u: string, i: number) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={u} alt="" className="h-16 w-16 rounded-xl object-cover border-2" />
                        </a>
                      ))}
                    </div>
                  )}
                  {(t.updates || []).length > 0 && (
                    <div className="space-y-1.5">
                      {(t.updates || []).slice(-5).map((u: any, i: number) => (
                        <div key={i} className="text-[11px] font-medium text-slate-500">
                          <span className="font-black text-slate-700">{u.by}</span>
                          {u.status ? ` → ${u.status === 'in_progress' ? 'in progress' : u.status}` : ''}
                          {u.note ? ` — ${u.note}` : ''}
                          <span className="text-slate-400"> · {fmtWhen(u.at)}</span>
                          {u.photoUrl && (
                            <a href={u.photoUrl} target="_blank" rel="noreferrer" className="block mt-1">
                              <img src={u.photoUrl} alt="" className="h-14 w-14 rounded-lg object-cover border-2" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder="Progress note — parts ordered, what you found, what's next…"
                    className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium" />
                  <div className="flex gap-2 items-center">
                    <label className="h-10 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center cursor-pointer">
                      {photoData ? `Photo: ${photoName.slice(0, 16)}` : 'Attach photo / receipt'}
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                    {photoData && <button onClick={() => { setPhotoData(null); setPhotoName(''); }} className="text-[9px] font-black uppercase tracking-widest text-red-500 underline">Remove</button>}
                  </div>
                  <div className="flex gap-3 items-center flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Materials $</span>
                      <input type="number" inputMode="decimal" min={0} value={costDollars} onChange={(e) => setCostDollars(e.target.value)}
                        placeholder="0" className="w-20 h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Hours worked</span>
                      <input type="number" inputMode="decimal" min={0} max={24} step={0.25} value={hoursDraft} onChange={(e) => setHoursDraft(e.target.value)}
                        placeholder="0" className="w-20 h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                    </div>
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 -mt-1.5">
                    Both save when you mark resolved. Materials (attach the receipt photo) go to the studio's books.
                    {worker?.payType === 'payroll'
                      ? ' Hours are logged for the record — pay comes through your wages.'
                      : (worker?.hourlyRateCents || 0) > 0
                        ? ` Labor pays at the studio's rate: $${((worker.hourlyRateCents || 0) / 100).toFixed(2)}/hr${Number(hoursDraft) > 0 ? ` × ${Math.min(24, Number(hoursDraft))}h = $${((Math.min(24, Number(hoursDraft)) * (worker.hourlyRateCents || 0)) / 100).toFixed(2)}` : ''}.`
                        : ' No hourly rate is on file yet — hours are logged, but ask the studio to set your rate so labor can accrue.'}
                  </p>
                  <div className="flex gap-2 items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">Move deadline</span>
                    <input type="date" value={deadlineDraft} onChange={(e) => setDeadlineDraft(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white" />
                    <button onClick={() => deadlineDraft && act(t.id, undefined, deadlineDraft)} disabled={busy || !deadlineDraft}
                      className="h-10 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 disabled:opacity-40">Set</button>
                    <button onClick={() => printTicket(t)} className="ml-auto h-10 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Print</button>
                  </div>
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
                    <button onClick={() => act(t.id)} disabled={busy || (!note.trim() && !photoData)}
                      className={`h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest text-slate-700 disabled:opacity-40 ${t.status === 'open' ? 'col-span-2' : ''}`}>
                      Save note / photo
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
