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
// Priority reads at a glance from the card's left rail — color does the
// work before any text is read.
const PRIORITY_RAIL: Record<string, string> = {
  urgent: 'border-l-red-500', high: 'border-l-orange-400',
  normal: 'border-l-indigo-300', low: 'border-l-slate-200',
};
const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700', in_progress: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-emerald-100 text-emerald-700',
};
const REQ_KINDS = [
  { value: 'materials' as const, label: 'Materials' },
  { value: 'tool' as const, label: 'Tool' },
  { value: 'access' as const, label: 'Access / keys' },
  { value: 'help' as const, label: 'Extra hands' },
  { value: 'other' as const, label: 'Other' },
];
const fmtMin = (m: number) => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const timedMin = (t: any, nowMs: number) => Math.round(((t.workSessions || []) as any[]).reduce((a, s) => {
  const end = s.endAt ? new Date(s.endAt).getTime() : nowMs;
  return a + Math.max(0, end - new Date(s.startAt).getTime());
}, 0) / 60000);

const dueChip = (t: any): { label: string; late: boolean } | null => {
  if (!t.dueAt || ['resolved', 'cancelled'].includes(t.status)) return null;
  const ms = new Date(t.dueAt).getTime() - Date.now();
  const h = Math.max(1, Math.round(Math.abs(ms) / 3600000));
  const span = h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
  return { label: ms < 0 ? `${span} overdue` : `due in ${span}`, late: ms < 0 };
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
  const [rules, setRules] = useState<any>({});
  const [tickets, setTickets] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Requests — "need more caulk" shouldn't be a text message you hope
  // the studio remembers. It's a tracked ticket with a paper trail.
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqTitle, setReqTitle] = useState('');
  const [reqDetail, setReqDetail] = useState('');
  const [reqKind, setReqKind] = useState<'materials' | 'tool' | 'access' | 'help' | 'other'>('materials');
  const [reqQty, setReqQty] = useState('');
  const [reqNeededBy, setReqNeededBy] = useState('');
  const [reqEstCost, setReqEstCost] = useState('');
  const [reqForStaff, setReqForStaff] = useState<string[]>([]);
  const [reqRelated, setReqRelated] = useState('');
  const [staffNames, setStaffNames] = useState<string[]>([]);
  // Quotes — price the job before starting it
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [qHours, setQHours] = useState('');
  const [qMaterials, setQMaterials] = useState('');
  const [qNote, setQNote] = useState('');
  // Job clock — ticks every 15s so the elapsed time reads live
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setClockTick((x) => x + 1), 15000);
    return () => clearInterval(i);
  }, []);
  const toggleClock = async (t: any) => {
    if (busy) return;
    setBusy(true);
    try {
      const running = (t.workSessions || []).some((s: any) => !s.endAt);
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'worker-timer', tenantId, token, ticketId: t.id, op: running ? 'stop' : 'start' }),
      });
      const d = await res.json();
      if (d.ok) await load();
      else setError(d.error || 'Clock did not respond — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  };
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
      setRules(d.rules || {});
      setStaffNames(d.staffNames || []);
      setTickets(d.tickets || []);
      setHistory(d.history || []);
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

  const submitQuote = async (ticketId: string) => {
    if (busy) return;
    if (!(Number(qHours) > 0) && !(Number(qMaterials) > 0)) { setError('Give the quote hours or materials.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'worker-quote', tenantId, token, ticketId,
          hours: Number(qHours) || 0,
          materialsCents: Math.round((Number(qMaterials) || 0) * 100),
          note: qNote.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (d.ok) { setQuoteFor(null); setQHours(''); setQMaterials(''); setQNote(''); await load(); }
      else setError(d.error || 'Could not send the quote — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  };

  const submitRequest = async () => {
    if (busy || !reqTitle.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'worker-request', tenantId, token,
          title: reqTitle.trim(), detail: reqDetail.trim() || undefined,
          kind: reqKind,
          qty: reqQty.trim() || undefined,
          neededBy: reqNeededBy || undefined,
          estCostCents: Number(reqEstCost) > 0 ? Math.round(Number(reqEstCost) * 100) : undefined,
          forStaff: reqForStaff.length ? reqForStaff : undefined,
          relatedTicketId: reqRelated || undefined,
          photoData: photoData || undefined,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        if (d.photoError) setError(d.photoError);
        setReqTitle(''); setReqDetail(''); setReqQty(''); setReqNeededBy(''); setReqEstCost(''); setReqForStaff([]); setReqRelated('');
        setPhotoData(null); setPhotoName(''); setRequestOpen(false);
        await load();
      } else setError(d.error || 'Could not send the request — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  };

  // Print a WORK ORDER — the same branded document the studio prints:
  // header, status chip, meta grid, description, activity log, photos,
  // and sign-off lines. Browser print → paper or Save as PDF.
  const printTicket = (t: any) => {
    try {
      const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const num = esc(String(t.id).slice(0, 8).toUpperCase());
      const statusLabel = esc(t.status === 'in_progress' ? 'In progress' : t.status.charAt(0).toUpperCase() + t.status.slice(1));
      const chipColor = t.status === 'resolved' ? '#047857' : t.status === 'in_progress' ? '#4338ca' : '#b45309';
      const chipBg = t.status === 'resolved' ? '#d1fae5' : t.status === 'in_progress' ? '#e0e7ff' : '#fef3c7';
      const rows = (t.updates || []).map((u: any, i: number) =>
        `<tr${i % 2 ? ' class="alt"' : ''}><td class="nowrap">${esc(fmtWhen(u.at))}</td><td><strong>${esc(u.by)}</strong> <span class="who">${esc(u.byType || '')}</span></td><td>${u.status ? `<span class="move">→ ${esc(u.status === 'in_progress' ? 'in progress' : u.status)}</span> ` : ''}${esc(u.note || '')}${u.photoUrl ? ' <span class="who">(photo)</span>' : ''}</td></tr>`).join('');
      const photos = (Array.isArray(t.photoUrls) ? t.photoUrls : []).map((u: string) => `<img src="${esc(u)}" />`).join('');
      const w = window.open('', '_blank');
      if (!w) { setError('Allow pop-ups to print.'); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Work order ${num} — ${esc(t.title)}</title><style>
        @page{margin:16mm}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:28px;font-size:13px;line-height:1.5}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:3px solid #0f172a}
        .brand{font-size:11px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#64748b}
        h1{font-size:24px;margin:4px 0 0;letter-spacing:-.02em}
        .ttl{font-size:15px;font-weight:700;color:#334155;margin-top:2px}
        .numbox{text-align:right;flex-shrink:0}
        .num{font-size:15px;font-weight:800;font-family:ui-monospace,Menlo,monospace}
        .chip{display:inline-block;margin-top:6px;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${chipColor};background:${chipBg}}
        .printed{font-size:10px;color:#94a3b8;margin-top:6px}
        .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:0;margin:18px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
        .meta>div{padding:10px 14px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0}
        .meta>div:nth-child(2n){border-right:none}.meta>div:nth-last-child(-n+2){border-bottom:none}
        .lbl{display:block;color:#94a3b8;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;margin-bottom:2px}
        .desc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;white-space:pre-wrap;margin:0 0 18px}
        h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#64748b;margin:22px 0 8px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#0f172a;color:#fff;text-align:left;padding:7px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.12em}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
        tr.alt td{background:#f8fafc}
        .nowrap{white-space:nowrap}.who{color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
        .move{color:#4338ca;font-weight:700}
        .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .photos img{width:100%;height:150px;object-fit:cover;border:1px solid #e2e8f0;border-radius:10px}
        .sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
        .sig div{border-top:1.5px solid #0f172a;padding-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
        .foot{margin-top:28px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between}
        @media print{.noprint{display:none}}
      </style></head><body>
        <div class="top">
          <div>
            <p class="brand">${esc(studioName || 'Studio')}</p>
            <h1>Work Order</h1>
            <p class="ttl">${esc(t.title)}</p>
          </div>
          <div class="numbox">
            <p class="num">#${num}</p>
            <span class="chip">${statusLabel}</span>
            <p class="printed">Printed ${esc(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
          </div>
        </div>
        <div class="meta">
          <div><span class="lbl">Location</span>${esc([t.boothName, t.resourceName].filter(Boolean).join(' · ') || '—')}</div>
          <div><span class="lbl">Category / priority</span>${esc(t.category)} · ${esc(t.priority)}</div>
          <div><span class="lbl">Reported by</span>${esc(t.reporterName || '—')}<br/><span style="color:#94a3b8;font-size:11px">${esc(fmtWhen(t.createdAt))}</span></div>
          <div><span class="lbl">Due</span>${esc(t.dueAt ? fmtWhen(t.dueAt) : '—')}</div>
        </div>
        ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
        <h2>Activity log</h2>
        <table><tr><th>When</th><th>Who</th><th>Update</th></tr>${rows || '<tr><td colspan="3">No updates yet</td></tr>'}</table>
        ${photos ? `<h2>Photo record</h2><div class="photos">${photos}</div>` : ''}
        <div class="sig"><div>Completed by / date</div><div>Approved by / date</div></div>
        <div class="foot"><span>${esc(studioName || 'Studio')} · Maintenance work order #${num}</span><span>Keep with receipts for tax records</span></div>
        <p class="noprint" style="margin-top:24px;text-align:center"><button onclick="window.print()" style="padding:12px 28px;font-weight:800;border-radius:10px;border:2px solid #0f172a;background:#0f172a;color:#fff;letter-spacing:.1em;text-transform:uppercase;font-size:11px">Print / Save as PDF</button></p>
        <script>setTimeout(function(){ try { window.print(); } catch (e) {} }, 400)</script>
      </body></html>`);
      w.document.close();
    } catch { setError('Could not open the print view.'); }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-lg mx-auto space-y-4">
        {/* ── HEADER — who you are, what's on your plate, what you're owed ── */}
        <div className="rounded-3xl bg-slate-900 text-white p-5 shadow-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{studioName || 'Maintenance'}</p>
          <h1 className="text-xl font-black tracking-tight mt-0.5">
            {state === 'ready' ? worker?.name : 'Maintenance portal'}
          </h1>
          {state === 'ready' && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {(() => {
                const open = tickets.length;
                const late = tickets.filter((t) => dueChip(t)?.late).length;
                const chips: { label: string; cls: string }[] = [
                  { label: `${open} open job${open === 1 ? '' : 's'}`, cls: 'bg-white/10 text-white' },
                  ...(late > 0 ? [{ label: `${late} overdue`, cls: 'bg-red-500/90 text-white' }] : []),
                  ...(worker?.payType !== 'payroll' && (worker?.unpaidLaborCents || 0) > 0
                    ? [{ label: `$${((worker.unpaidLaborCents || 0) / 100).toFixed(0)} owed to you`, cls: 'bg-emerald-500/90 text-white' }] : []),
                  ...((worker?.hourlyRateCents || 0) > 0 && worker?.payType !== 'payroll'
                    ? [{ label: `$${((worker.hourlyRateCents || 0) / 100).toFixed(0)}/hr`, cls: 'bg-white/10 text-slate-200' }] : []),
                ];
                return chips.map((c) => (
                  <span key={c.label} className={`h-7 px-3 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center ${c.cls}`}>{c.label}</span>
                ));
              })()}
            </div>
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
          const due = dueChip(t);
          const expanded = openId === t.id;
          return (
            <div key={t.id} className={`rounded-3xl bg-white border-2 border-l-4 overflow-hidden shadow-sm ${PRIORITY_RAIL[t.priority] || PRIORITY_RAIL.normal} ${due?.late ? 'border-red-200' : ''}`}>
              <button onClick={() => { setOpenId(expanded ? null : t.id); setNote(''); setPhotoData(null); setPhotoName(''); setCostDollars(''); }} className="w-full text-left p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 leading-snug">{t.title}</p>
                    <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                      {[[t.boothName, t.resourceName].filter(Boolean).join(' · ') || null,
                        t.category, `by ${t.reporterName}`, fmtWhen(t.createdAt)].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {due && <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${due.late ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{due.label}</span>}
                      {!t.assignedToMe && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-indigo-100 text-indigo-700">Open to claim</span>}
                      {t.quoteRequested && !t.quote && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">Quote needed</span>}
                      {t.quote?.status === 'pending' && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">Quote sent</span>}
                      {t.quote?.status === 'approved' && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">Quote approved</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${PRIORITY_TONE[t.priority] || PRIORITY_TONE.normal}`}>{t.priority}</span>
                    <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${STATUS_TONE[t.status] || ''}`}>{t.status === 'in_progress' ? 'In progress' : t.status}</span>
                  </div>
                </div>
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
                  {/* ── JOB CLOCK — tap when the wrench comes out ── */}
                  {['open', 'in_progress'].includes(t.status) && (() => {
                    const running = (t.workSessions || []).some((s: any) => !s.endAt);
                    const total = timedMin(t, Date.now());
                    return (
                      <div className={`rounded-xl border-2 p-2.5 flex items-center gap-3 ${running ? 'border-emerald-300 bg-emerald-50' : ''}`}>
                        <button onClick={() => toggleClock(t)} disabled={busy}
                          className={`h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest disabled:opacity-40 shrink-0 ${running ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                          {running ? 'Stop clock' : total > 0 ? 'Resume clock' : 'Start clock'}
                        </button>
                        <div className="min-w-0">
                          <p className={`text-sm font-black ${running ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {running ? `On the clock · ${fmtMin(total)}` : total > 0 ? `${fmtMin(total)} on this job` : 'Not started'}
                          </p>
                          <p className="text-[9px] font-bold text-muted-foreground">
                            {(t.workSessions || []).length > 0 ? `${(t.workSessions || []).length} session${(t.workSessions || []).length === 1 ? '' : 's'} — every start and stop is on the record` : 'Times your work and fills in your hours at the end'}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  {/* ── QUOTE — price it before you start ── */}
                  {t.quoteRequested && !t.quote && (
                    <p className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-2.5 text-[11px] font-bold text-indigo-700">
                      The studio wants a quote before work starts — tap Send quote below.
                    </p>
                  )}
                  {t.quote && (
                    <div className={`rounded-xl border-2 p-2.5 ${t.quote.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : t.quote.status === 'declined' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                      <p className="text-[9px] font-black uppercase tracking-widest">
                        {t.quote.status === 'approved' ? 'Quote approved — go ahead' : t.quote.status === 'declined' ? 'Quote declined — hold off' : 'Quote sent — waiting on the studio'}
                      </p>
                      <p className="text-xs font-bold mt-0.5">
                        {[(t.quote.hours || 0) > 0 ? `${t.quote.hours}h` : null,
                          (t.quote.materialsCents || 0) > 0 ? `$${(t.quote.materialsCents / 100).toFixed(2)} materials` : null]
                          .filter(Boolean).join(' + ')} {(t.quote.totalCents || 0) > 0 ? `= $${(t.quote.totalCents / 100).toFixed(2)}` : ''}
                      </p>
                      {t.quote.note && <p className="text-[11px] font-medium text-slate-600 mt-0.5">{t.quote.note}</p>}
                    </div>
                  )}
                  {['open', 'in_progress'].includes(t.status) && (!t.quote || t.quote.status === 'declined') && (
                    quoteFor === t.id ? (
                      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-2.5 space-y-2">
                        <div className="flex gap-3 items-center flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700">Est. hours</span>
                            <input type="number" inputMode="decimal" min={0} step={0.5} value={qHours} onChange={(e) => setQHours(e.target.value)}
                              placeholder="0" className="w-20 h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700">Materials $</span>
                            <input type="number" inputMode="decimal" min={0} value={qMaterials} onChange={(e) => setQMaterials(e.target.value)}
                              placeholder="0" className="w-20 h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                          </div>
                        </div>
                        {(worker?.hourlyRateCents || 0) > 0 && worker?.payType !== 'payroll' && (Number(qHours) > 0 || Number(qMaterials) > 0) && (
                          <p className="text-[10px] font-bold text-indigo-700">
                            Comes to ${(((Number(qHours) || 0) * (worker.hourlyRateCents || 0) + (Number(qMaterials) || 0) * 100) / 100).toFixed(2)} at your ${((worker.hourlyRateCents || 0) / 100).toFixed(2)}/hr rate.
                          </p>
                        )}
                        {(rules?.autoApproveUnderCents || 0) > 0 && (
                          <p className="text-[10px] font-bold text-indigo-600">Quotes at or under ${((rules.autoApproveUnderCents || 0) / 100).toFixed(0)} approve instantly — no waiting.</p>
                        )}
                        <input value={qNote} onChange={(e) => setQNote(e.target.value)} placeholder="What the price covers, options, caveats…"
                          className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                        <div className="flex gap-2">
                          <button onClick={() => submitQuote(t.id)} disabled={busy}
                            className="flex-1 h-10 rounded-xl bg-indigo-600 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">Send quote</button>
                          <button onClick={() => setQuoteFor(null)} className="h-10 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setQuoteFor(t.id); setQHours(''); setQMaterials(''); setQNote(''); }}
                        className={`h-10 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest ${t.quoteRequested ? 'border-indigo-400 text-indigo-700 bg-indigo-50' : 'text-slate-600'}`}>
                        {t.quote?.status === 'declined' ? 'Send a new quote' : 'Send quote'}
                      </button>
                    )
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
                    {timedMin(t, Date.now()) > 0 && (
                      <button onClick={() => setHoursDraft(String(Math.max(0.25, Math.round((timedMin(t, Date.now()) / 60) * 4) / 4)))}
                        className="h-10 px-3 rounded-xl border-2 border-emerald-300 text-emerald-700 font-black uppercase text-[9px] tracking-widest">
                        Use timed · {fmtMin(timedMin(t, Date.now()))}
                      </button>
                    )}
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 -mt-1.5">
                    Both save when you mark resolved. Materials (attach the receipt photo) go to the studio's books.
                    {worker?.payType === 'payroll'
                      ? ' Hours are logged for the record — pay comes through your wages.'
                      : (worker?.hourlyRateCents || 0) > 0
                        ? ` Labor pays at the studio's rate: $${((worker.hourlyRateCents || 0) / 100).toFixed(2)}/hr${Number(hoursDraft) > 0 ? ` × ${Math.min(24, Number(hoursDraft))}h = $${((Math.min(24, Number(hoursDraft)) * (worker.hourlyRateCents || 0)) / 100).toFixed(2)}` : ''}.`
                        : ' No hourly rate is on file yet — hours are logged, but ask the studio to set your rate so labor can accrue.'}
                  </p>
                  {/* The studio's own rules, surfaced BEFORE the server
                      rejects — no one finds out at the last tap. */}
                  {(() => {
                    const mat = Math.round((Number(costDollars) || 0) * 100);
                    const lab = worker?.payType !== 'payroll' ? Math.round(Math.min(24, Number(hoursDraft) || 0) * (worker?.hourlyRateCents || 0)) : 0;
                    const warns: string[] = [];
                    if ((rules?.requireQuoteOverCents || 0) > 0 && (mat + lab) > rules.requireQuoteOverCents && t.quote?.status !== 'approved') {
                      warns.push(`Jobs over $${(rules.requireQuoteOverCents / 100).toFixed(0)} need an approved quote first — send one above before resolving.`);
                    }
                    if ((rules?.receiptRequiredOverCents || 0) > 0 && mat > rules.receiptRequiredOverCents && !photoData && !(Array.isArray(t.photoUrls) && t.photoUrls.length > 0)) {
                      warns.push(`Materials over $${(rules.receiptRequiredOverCents / 100).toFixed(0)} need the receipt photo attached.`);
                    }
                    return warns.length > 0 ? (
                      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-2.5 space-y-1">
                        {warns.map((w, i) => <p key={i} className="text-[11px] font-bold text-amber-700">{w}</p>)}
                      </div>
                    ) : null;
                  })()}
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

        {/* ── REQUEST SOMETHING — structured enough to decide from a phone:
            what kind, how many, by when, roughly how much, for which job,
            and which staff member is affected. ── */}
        {state === 'ready' && (
          <div className={`rounded-3xl bg-white border-2 overflow-hidden shadow-sm ${requestOpen ? 'border-indigo-300' : ''}`}>
            <button onClick={() => setRequestOpen(o => !o)} className="w-full text-left p-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">Need something?</p>
                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">Materials, tools, keys, backup — tracked with a paper trail, answered with a text.</p>
              </div>
              <span className={`h-8 w-8 rounded-xl flex items-center justify-center text-lg font-black shrink-0 ${requestOpen ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>+</span>
            </button>
            {requestOpen && (
              <div className="border-t px-4 py-3 space-y-2.5">
                {/* What KIND — one tap sets the shape of the request */}
                <div className="flex gap-1.5 flex-wrap">
                  {REQ_KINDS.map((k) => (
                    <button key={k.value} onClick={() => setReqKind(k.value)}
                      className={`h-8 px-3 rounded-full text-[9px] font-black uppercase tracking-widest ${reqKind === k.value ? 'bg-indigo-600 text-white' : 'border-2 text-slate-500'}`}>
                      {k.label}
                    </button>
                  ))}
                </div>
                <input value={reqTitle} onChange={(e) => setReqTitle(e.target.value)}
                  placeholder={reqKind === 'materials' ? 'What exactly? e.g. Silicone caulk, white *' : reqKind === 'tool' ? 'What tool? e.g. 6ft ladder *' : reqKind === 'access' ? 'Access to what? e.g. supply closet key *' : reqKind === 'help' ? 'What do you need help with? *' : 'What do you need? *'}
                  className="w-full h-11 rounded-xl border-2 px-3 text-sm font-medium" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Quantity / size</p>
                    <input value={reqQty} onChange={(e) => setReqQty(e.target.value)} placeholder="e.g. 3 tubes"
                      className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Est. cost $</p>
                    <input type="number" inputMode="decimal" min={0} value={reqEstCost} onChange={(e) => setReqEstCost(e.target.value)} placeholder="optional"
                      className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Needed by</p>
                    <input type="date" value={reqNeededBy} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setReqNeededBy(e.target.value)}
                      className="w-full h-10 rounded-xl border-2 px-2 text-sm font-medium bg-white" />
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">For which job</p>
                    <select value={reqRelated} onChange={(e) => setReqRelated(e.target.value)}
                      className="w-full h-10 rounded-xl border-2 px-2 text-xs font-bold bg-white">
                      <option value="">Not job-specific</option>
                      {tickets.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 40)}</option>)}
                    </select>
                  </div>
                </div>
                {staffNames.length > 0 && (
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Who's affected (tap names)</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {staffNames.map((n) => (
                        <button key={n} onClick={() => setReqForStaff(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n])}
                          className={`h-8 px-3 rounded-full text-[10px] font-bold ${reqForStaff.includes(n) ? 'bg-slate-900 text-white' : 'border-2 text-slate-500'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <textarea value={reqDetail} onChange={(e) => setReqDetail(e.target.value)} rows={2}
                  placeholder="Anything else — brand, link, which room, why it matters…"
                  className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium" />
                <div className="flex gap-2 items-center">
                  <label className="h-11 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center cursor-pointer shrink-0">
                    {photoData ? `Photo ✓` : 'Photo'}
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  <button onClick={submitRequest} disabled={busy || !reqTitle.trim()}
                    className="flex-1 h-11 rounded-xl bg-indigo-600 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
                    Send request
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MY HISTORY — the jobs already done, reprintable on site ── */}
        {state === 'ready' && history.length > 0 && (
          <div className="rounded-3xl bg-white border-2 overflow-hidden">
            <button onClick={() => setShowHistory(o => !o)} className="w-full text-left p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">My finished jobs</p>
                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{history.length} on record — tap one to reprint its work order.</p>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{showHistory ? 'Hide' : 'Show'}</span>
            </button>
            {showHistory && (
              <div className="border-t divide-y">
                {history.map((h) => (
                  <div key={h.id} className="px-4 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black truncate">{h.title}</p>
                      <p className="text-[10px] font-bold text-muted-foreground truncate">
                        {[h.boothName, h.resourceName, `done ${fmtWhen(h.resolvedAt)}`,
                          (h.costCents || 0) > 0 ? `$${(h.costCents / 100).toFixed(0)} materials` : null,
                          (h.laborHours || 0) > 0 ? `${h.laborHours}h` : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button onClick={() => printTicket(h)} className="h-8 px-2.5 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-500 shrink-0">Print</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
