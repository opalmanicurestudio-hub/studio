'use client';
// src/components/support/HelpDesk.tsx
//
// HELP, FROM INSIDE THE APP — and the quiet recorder that makes it useful.
//
// • Keeps the last 10 errors this browser hit (page + message), in memory.
// • "Help" (sidebar footer) opens a sheet: what kind of thing it is, what
//   happened, send. The ticket goes to ClarityFlow HQ with the page, device,
//   app version and those recent errors attached — no "what were you doing?".
// • Shows your past requests and HQ's replies, and lets you answer back.
// • useIsHqAdmin(): shows the HQ link to platform admins only (server-checked).

import { errorEmitter } from '@/firebase/error-emitter';
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, X } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';

type Err = { at: string; message: string; page: string };
const W = (typeof window !== 'undefined' ? window : {}) as any;
function recorded(): Err[] { return (W.__cfErrors as Err[]) || []; }

export function openHelp() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('cf:help')); }

export function useIsHqAdmin() {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    let alive = true;
    // Only a YES is remembered for the session — so setting
    // PLATFORM_ADMIN_EMAILS takes effect without opening a new tab.
    try { if (sessionStorage.getItem('cf_hq') === '1') { setYes(true); return; } } catch { /* ignore */ }
    const unsub = getAuth().onAuthStateChanged(async (u) => {
      if (!u) return;
      try {
        const tk = await u.getIdToken();
        const r = await fetch('/api/hq', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'whoami' }) });
        const d = await r.json().catch(() => null);
        if (alive) setYes(!!d?.admin);
        try { if (d?.admin) sessionStorage.setItem('cf_hq', '1'); } catch { /* ignore */ }
      } catch { /* not an admin */ }
    });
    return () => { alive = false; unsub(); };
  }, []);
  return yes;
}

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const STATUS: Record<string, string> = { open: 'Sent — we’ll reply soon', waiting_on_us: 'We’re on it', waiting_on_them: 'We replied', solved: 'Solved' };

export function HelpDesk() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'broken' | 'question' | 'idea'>('broken');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [mine, setMine] = useState<any[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [issuePrompt, setIssuePrompt] = useState(false);   // "Something didn't load properly" — offered at most every 10 min

  // The recorder: last 10 errors, with the page they happened on.
  useEffect(() => {
    const push = (message: string) => {
      const list: Err[] = W.__cfErrors || (W.__cfErrors = []);
      list.push({ at: new Date().toISOString(), message: String(message || 'Unknown error').slice(0, 300), page: window.location.pathname });
      if (list.length > 10) list.shift();
      // Offer an account check — politely, at most once every 10 minutes, never on the check itself.
      try { const last = Number(localStorage.getItem('cf_issue_prompt_at') || 0);
        if (window.location.pathname !== '/diagnostics' && Date.now() - last > 10 * 60000) { localStorage.setItem('cf_issue_prompt_at', String(Date.now())); setIssuePrompt(true); } } catch { /* ignore */ }
    };
    // Database refusals arrive on the app's own channel, not as browser errors — record them too.
    const onDenied = (e: any) => push(`Couldn’t load: ${String(e?.request?.path || e?.message || 'data').slice(0, 200)}`);
    errorEmitter.on('permission-error', onDenied);
    const onErr = (e: ErrorEvent) => push(e.message || String(e.error));
    const onRej = (e: PromiseRejectionEvent) => push(String((e.reason && (e.reason.message || e.reason)) || 'Unhandled rejection'));
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    const onHelp = () => setOpen(true);
    window.addEventListener('cf:help', onHelp);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); window.removeEventListener('cf:help', onHelp); try { (errorEmitter as any).off?.('permission-error', onDenied); (errorEmitter as any).removeListener?.('permission-error', onDenied); } catch { /* ignore */ } };
  }, []);

  // Once per session: tell HQ this business is here, and on which version.
  useEffect(() => {
    if (!tenantId) return;
    try { if (sessionStorage.getItem(`cf_ping_${tenantId}`)) return; sessionStorage.setItem(`cf_ping_${tenantId}`, '1'); } catch { /* ignore */ }
    const t = window.setTimeout(() => { void api({ action: 'ping', tenantId, version: String(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 12), host: window.location.host }); }, 4000);
    return () => window.clearTimeout(t);
  }, [tenantId]);

  const loadMine = useCallback(async () => { if (!tenantId) return; const d = await api({ action: 'mine', tenantId }); if (d.ok) setMine(d.tickets); }, [tenantId]);
  useEffect(() => { if (open) { setSent(false); setErr(''); void loadMine(); } }, [open, loadMine]);

  const send = async () => {
    if (!tenantId) { setErr('Pick a business first.'); return; }
    setBusy(true); setErr('');
    const d = await api({ action: 'create', tenantId, kind, message, context: {
      page: window.location.pathname + window.location.search, host: window.location.host,
      appVersion: String(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 12),
      screen: `${window.innerWidth}×${window.innerHeight}`, errors: recorded(),
    } });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Couldn’t send — try again.'); return; }
    setSent(true); setMessage(''); void loadMine();
  };

  const answer = async (id: string) => {
    const m = (reply[id] || '').trim(); if (!m) return;
    const d = await api({ action: 'reply', tenantId, ticketId: id, message: m });
    if (d.ok) { setReply((r) => ({ ...r, [id]: '' })); void loadMine(); }
  };

  if (!open) return issuePrompt ? (
    <div role="status" className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-md rounded-3xl border border-stone-200 bg-white/95 p-4 shadow-xl backdrop-blur md:bottom-6">
      <p className="text-[15px] font-semibold">Something didn’t load properly</p>
      <p className="mt-0.5 text-[13px] text-stone-600">A quick account check can often fix it — and if not, send it to us with one tap.</p>
      <div className="mt-3 flex gap-2">
        <a href="/diagnostics" onClick={() => setIssuePrompt(false)} className="flex h-10 items-center rounded-full bg-stone-900 px-4 text-[13px] font-semibold text-white">Check &amp; send to support</a>
        <button type="button" onClick={() => setIssuePrompt(false)} className="h-10 rounded-full px-4 text-[13px] text-stone-600">Dismiss</button>
      </div>
    </div>) : null;
  const errors = recorded();
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-[#f7f5f2] p-5 shadow-2xl sm:rounded-[2rem]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }} role="dialog" aria-label="Help">
        <div className="flex items-center justify-between">
          <p className="text-2xl font-light tracking-tight">How can we <span className="font-semibold">help?</span></p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-stone-500 hover:bg-white"><X className="h-5 w-5" /></button>
        </div>

        {sent ? (
          <div className="mt-4 rounded-3xl bg-emerald-50 p-5 text-center">
            <p className="text-2xl">✓</p><p className="mt-1 font-semibold text-emerald-900">Got it — we’re on it.</p>
            <p className="mt-1 text-sm text-emerald-800">We’ll reply by email and here. We already have the page you were on and any errors, so there’s nothing else to send.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {([['broken', 'Something’s not working'], ['question', 'A question'], ['idea', 'An idea']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`rounded-2xl px-2 py-3 text-[13px] ${kind === k ? 'bg-stone-900 text-white' : 'bg-white/80 text-stone-700'}`}>{l}</button>
              ))}
            </div>
            <a href="/diagnostics" className="flex items-center justify-between rounded-2xl bg-stone-100 px-4 py-3 text-[13px]"><span><span className="block font-semibold">Something not loading?</span><span className="text-stone-600">Run a quick account check — it can fix common problems for you.</span></span><span aria-hidden>›</span></a>
            <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 4000))} rows={5} placeholder={kind === 'broken' ? 'What happened, and what did you expect?' : kind === 'idea' ? 'What would make ClarityFlow better for you?' : 'What would you like to know?'}
              className="w-full rounded-2xl border border-white/80 bg-white/80 p-4 text-[15px] outline-none focus:ring-2 focus:ring-stone-300" />
            <p className="text-[12px] text-stone-500">We’ll include the page you’re on{errors.length ? `, ${errors.length} recent error${errors.length === 1 ? '' : 's'}` : ''}, your device and app version — so you don’t have to explain.</p>
            {err && <p className="text-sm text-red-700">{err}</p>}
            <button type="button" disabled={busy || message.trim().length < 5} onClick={send} className="flex h-12 w-full items-center justify-center rounded-full bg-stone-900 text-sm font-medium text-white disabled:opacity-40">{busy ? <Loader className="h-4 w-4 animate-spin" /> : 'Send to ClarityFlow'}</button>
          </div>
        )}

        {mine && mine.length > 0 && (
          <div className="mt-6 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">Your requests</p>
            {mine.map((k) => (
              <div key={k.id} className="rounded-2xl bg-white/80 p-3">
                <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{k.subject}</p><span className="shrink-0 text-[11px] text-stone-500">{STATUS[k.status] || k.status}</span></div>
                <p className="text-[12px] text-stone-500">{when(k.createdAt)}</p>
                {(k.thread || []).map((m: any, i: number) => (
                  <p key={i} className={`mt-2 rounded-xl p-2 text-[13px] ${m.from === 'hq' ? 'bg-emerald-50 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}><span className="font-semibold">{m.from === 'hq' ? 'ClarityFlow' : 'You'}:</span> {m.message}</p>
                ))}
                {k.status !== 'solved' && (k.thread || []).some((m: any) => m.from === 'hq') && (
                  <div className="mt-2 flex gap-2">
                    <input value={reply[k.id] || ''} onChange={(e) => setReply((r) => ({ ...r, [k.id]: e.target.value }))} placeholder="Reply" className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm" />
                    <button type="button" onClick={() => answer(k.id)} className="h-10 rounded-xl bg-stone-900 px-3 text-xs text-white">Send</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
