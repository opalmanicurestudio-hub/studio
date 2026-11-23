'use client';
// src/components/events/GuestAsks.tsx — WHAT GUESTS ASKED FOR, on the event's manifest (design board "The event pass";
// lib/event-pass, api/event-night 'asks' and 'askSeen'). On the night a guest's pass can ask for water or someone to
// help; each shows here with their table and party, newest first, and On it tells the guest who has it. Kept up to date
// every 20 seconds while the page is in view; nothing shows until someone asks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { EventAsk } from '@/lib/event-pass';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Ask = EventAsk & { text: string };

async function post(body: any) {
  const auth: any = getAuth(); try { await auth.authStateReady?.(); } catch { /* fine */ }
  const tk = await auth.currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/event-night', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`; };

export default function GuestAsks({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [asks, setAsks] = useState<Ask[]>([]); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  // (Only a new ask is read out by a screen reader, not the whole list each time it's checked.)
  const known = useRef<Set<string> | null>(null); const [fresh, setFresh] = useState('');
  const load = useCallback(async () => {
    const d = await post({ tenantId, eventId, action: 'asks' }); if (!d.ok) return;
    const list: Ask[] = d.asks || []; setAsks(list); setErr('');
    const novel = known.current ? list.filter((a) => !a.seenBy && !known.current!.has(a.id)) : [];
    known.current = new Set(list.map((a) => a.id));
    // (Emptied first, so the same words asked again are read out again.)
    if (novel.length) { const say = novel.length === 1 ? `New: ${novel[0].text}` : `${novel.length} new asks. ${novel.map((a) => a.text).join(' ')}`; setFresh(''); setTimeout(() => setFresh(say), 60); }
  }, [tenantId, eventId]);
  useEffect(() => {
    void load();
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const t = setInterval(tick, 20000); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [load]);
  const take = async (a: Ask) => {
    setBusy(a.id); const d = await post({ tenantId, eventId, action: 'askSeen', askId: a.id }); setBusy('');
    if (d.ok) { setAsks(d.asks || []); setErr(''); } else setErr(d.error || 'That didn’t save. Try again.');
  };
  const open = asks.filter((a) => !a.seenBy);
  // (The read-out stays the same element, there before the first ask, so that first ask is read out too.)
  return (<>
    <p role="status" className="sr-only">{fresh}</p>
    {asks.length > 0 && <section aria-labelledby="asks-title" className="space-y-2 rounded-2xl border bg-[#fff] p-4 sm:p-5" style={{ borderColor: open.length ? AMBER : LINE, color: INK }}>
      <h2 id="asks-title" className="text-[17px] font-semibold">{open.length ? `Guests asking (${open.length})` : 'Guests asking'}</h2>
      {err && <p role="alert" className="text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>}
      <ul className="space-y-1.5">
        {asks.map((a) => (
          <li key={a.id} className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2" style={{ background: a.seenBy ? '#fff' : AMBER_TINT, border: a.seenBy ? `1px solid ${LINE}` : 'none' }}>
            <span className="min-w-0 flex-1 text-[15px]"><span className={a.seenBy ? '' : 'font-semibold'}>{a.text}</span> <span className="text-[13.5px]" style={{ color: MUTED }}>{ago(a.at)}</span></span>
            {a.seenBy ? <span className="text-[13.5px] font-semibold" style={{ color: GREEN }}>{a.seenBy} has it</span>
              : <button type="button" disabled={busy === a.id} onClick={() => take(a)} className={`min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>On it</button>}
          </li>))}
      </ul>
    </section>}
  </>);
}
