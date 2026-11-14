'use client';
// src/app/(app)/clear/page.tsx — CLEAR AND RESET (design canvas ClearReset): the phone of whoever clears tables during
// service. Tables guests have left, the one the host needs next first ("Needed next: Lee, 4 is waiting for it"), with
// the business's reset steps as a reminder, "On it" so nobody doubles up, and "Ready to seat", which frees the table on
// the host stand at once. Below, tables leaving soon: one that's paid can be marked as gone, which starts its clearing.
// Reads and acts through api/tab (lib/table-reset-server). Anyone on the team can use it, servers included.
// Through a Wi-Fi drop (lib/outbox, lib/last-seen): the list it last had, with its time; "On it" and "Ready to seat"
// are kept on the phone and sent when the connection's back. "They’ve left" needs the connection.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { leavingWords, leftWords, type ClearItem, type LeavingItem } from '@/lib/table-reset';
import { send } from '@/lib/outbox';
import { keepLast, lastOf } from '@/lib/last-seen';
import { ConnectionBar } from '@/components/shared/ConnectionBar';
import { useKeepPage } from '@/components/pwa/keep-page';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const POLL_MS = 15000;
const btn = 'min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const dark = { background: INK, color: '#fff' } as const;

type Data = { session: string | null; toClear: ClearItem[]; leaving: LeavingItem[]; steps: string[]; waitForReady: boolean; clearMin: number; meName: string };

/** A step through api/tab: kept on the phone when there's no connection and `keep` names it. */
async function call(body: any, keep?: string): Promise<any> {
  // Kept for 20 minutes at most, and a kept one says when it was tapped: arriving late, "Ready to seat" never clears
  // guests who sat down and left after it.
  const r = await send('/api/tab', body, { label: keep || 'A tap', auth: 'user', keep: !!keep, tenantId: String(body.tenantId || ''), maxAgeMs: 20 * 60000, stamp: 'at' });
  return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through.' };
}

export default function ClearPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState('');
  // Steps ticked on this phone, by table: a reminder only, never saved.
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  // No connection: what the phone last had, and when (null while the server answers).
  const [asOf, setAsOf] = useState<number | null>(null); const good = useRef(0);
  useKeepPage();

  const load = useCallback(async () => {
    if (!tenantId) return;
    const r = await call({ tenantId, action: 'clearing' });
    if (r.offline) {
      if (!good.current) { const last = lastOf<Data>(`clear.${tenantId}`); if (last) { good.current = last.at; setD(last.data); } }
      setAsOf(good.current || Date.now()); return;
    }
    if (!r.ok) { setErr(r.error || 'The tables couldn’t be read.'); return; }
    good.current = Date.now(); setErr(''); setD(r); setAsOf(null); keepLast(`clear.${tenantId}`, r);
    setTicks((t) => Object.fromEntries(Object.entries(t).filter(([u]) => (r.toClear || []).some((i: ClearItem) => i.unitId === u))));
  }, [tenantId]);
  useEffect(() => {
    void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void load(); }; document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const act = async (key: string, body: any, done: (r: any) => string, keep?: { label: string; local: (x: Data) => Data; kept: string }) => {
    if (!tenantId) return; setBusy(key); setMsg('');
    const r = await call({ tenantId, ...body }, keep?.label);
    setBusy(null);
    // Kept on the phone: shown as done here, sent when the connection's back.
    if (r.kept && keep) { setD((x) => (x ? keep.local(x) : x)); setMsg(keep.kept); return r; }
    if (!r.ok) { setMsg(r.error || 'That didn’t go through.'); void load(); return null; }
    setMsg(done(r)); void load(); return r;
  };
  const ready = (i: ClearItem) => act(`ready:${i.unitId}`, { action: 'clear_done', unitId: i.unitId }, () => `${i.table} is ready to seat. The host stand has it.`,
    { label: `${i.table}: ready to seat`, local: (x) => ({ ...x, toClear: x.toClear.filter((y) => y.unitId !== i.unitId) }), kept: `${i.table} is marked ready. The host stand gets it when the connection’s back.` });
  const onIt = (i: ClearItem, on: boolean) => act(`on:${i.unitId}`, { action: 'clear_on', unitId: i.unitId, on }, () => (on ? `You’re on ${i.table}.` : `You’re off ${i.table}.`),
    { label: `${i.table}: ${on ? 'on it' : 'not me'}`, local: (x) => ({ ...x, toClear: x.toClear.map((y) => (y.unitId === i.unitId ? { ...y, by: on ? x.meName || 'You' : null } : y)) }), kept: on ? `You’re on ${i.table}. The others see it when the connection’s back.` : `You’re off ${i.table}.` });
  const gone = async (l: LeavingItem) => {
    const r = await act(`left:${l.partyId}`, { action: 'left', partyId: l.partyId }, () => `${l.table} is yours to clear.`);
    // They came from the walk-in line: close their row there too (the line's own step, as the host stand does).
    if (r?.walkInId) {
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const w = await fetch('/api/walkins', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ action: 'complete', tenantId, walkInId: r.walkInId }) })
        .then(async (x) => ({ status: x.status, d: await x.json().catch(() => ({})) })).catch(() => null);
      // A booked visit on the line is closed from the booking (409): nothing to say. Anything else that didn't go through, the host should know.
      if (!w || (w.status !== 409 && w.d?.ok !== true)) setMsg(`${l.table} is yours to clear. Their place on the walk-in line didn’t close, so tell the host.`);
    }
  };
  const tick = (unitId: string, n: number) => setTicks((t) => { const cur = new Set(t[unitId] || []); if (cur.has(n)) cur.delete(n); else cur.add(n); return { ...t, [unitId]: Array.from(cur) }; });

  const me = d?.meName || '';
  const toClear = d?.toClear || []; const leaving = d?.leaving || [];
  const sub = d ? [`${me ? `${me.split(' ')[0]}. ` : ''}${toClear.length ? `${toClear.length} ${toClear.length === 1 ? 'table' : 'tables'} to clear` : 'Nothing to clear'}`, leaving.length ? `${leaving.length} leaving soon` : ''].filter(Boolean).join(', ') : 'Loading…';

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">Clear and reset</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>{sub}</p>
          </div>
          <Link href="/tables" className={`${btn} inline-flex items-center`} style={quiet}>My tables</Link>
        </header>
        {tenantId && <ConnectionBar tenantId={tenantId} down={asOf !== null} asOf={asOf} />}
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {msg && <p role="status" className="rounded-2xl bg-[#fff] px-4 py-3 text-[14.5px]" style={{ border: `1px solid ${LINE}` }}>{msg}</p>}

        <section aria-label="Tables to clear" className="space-y-2.5">
          {d && toClear.length === 0 && <p className="rounded-2xl bg-[#fff] px-4 py-6 text-center text-[15px]" style={{ color: MUTED, border: `1px dashed ${LINE}` }}>{d.session ? 'Nothing to clear right now. Tables show here as soon as guests leave.' : 'The host stand hasn’t opened tonight’s floor yet.'}</p>}
          {toClear.map((i) => {
            const mine = !!i.by && i.by === me; const late = i.over > 0;
            const done = new Set(ticks[i.unitId] || []);
            return (
              <article key={i.unitId} className="space-y-2 rounded-2xl bg-[#fff] p-4" style={i.needed ? { boxShadow: `inset 0 0 0 2px ${AMBER}` } : undefined}>
                <div className="flex items-baseline justify-between gap-3"><b className="text-[17px] font-semibold">{i.table}</b>
                  <span className="text-[13px] font-semibold" style={{ color: late || i.needed ? AMBER : MUTED }}>{leftWords(i.minutes)}</span></div>
                {i.needed && <p className="text-[14.5px] font-semibold leading-snug" style={{ color: AMBER }}>Needed next: {i.needed}</p>}
                {late && !i.needed && <p className="text-[14px] leading-snug" style={{ color: AMBER }}>Past the usual {d?.clearMin} min. The host stand is waiting for it.</p>}
                <p className="text-[14px]" style={{ color: MUTED }}>{i.name}, {i.size}{i.by ? `. ${mine ? 'You’re on it' : `${i.by} is on it`}` : ''}</p>
                {(d?.steps || []).length > 0 && (!i.by || mine) && <ul aria-label={`Reset steps for ${i.table}`}>
                  {(d?.steps || []).map((s, n) => (
                    <li key={n}><button type="button" role="checkbox" aria-checked={done.has(n)} onClick={() => tick(i.unitId, n)} className="flex min-h-[44px] w-full items-center gap-3 text-left text-[14.5px]">
                      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={done.has(n) ? { background: INK } : { border: '1.5px solid #c9cacd' }}>
                        {done.has(n) && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                      <span style={done.has(n) ? { color: MUTED } : undefined}>{s}</span></button></li>))}
                </ul>}
                <div className="flex gap-2">
                  <button type="button" disabled={busy === `ready:${i.unitId}`} onClick={() => ready(i)} className={`${btn} flex-1`} style={dark}>{busy === `ready:${i.unitId}` ? 'Saving…' : 'Ready to seat'}</button>
                  <button type="button" disabled={busy === `on:${i.unitId}`} onClick={() => onIt(i, !mine)} className={btn} style={quiet}>{mine ? 'Not me' : 'On it'}</button>
                </div>
              </article>
            );
          })}
        </section>

        {leaving.length > 0 && <section aria-labelledby="leaving" className="space-y-2">
          <h2 id="leaving" className="pt-1 text-[17px] font-semibold">Leaving soon</h2>
          <div className="rounded-2xl bg-[#fff] px-4">
            {leaving.map((l, n) => (
              <div key={l.partyId} className="flex min-h-[60px] items-center gap-3 py-2" style={n ? { borderTop: `1px solid ${LINE}` } : undefined}>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{l.table}</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{l.name}, {l.size}. {leavingWords(l)}</span></span>
                {l.kind === 'paid' && l.closed && <button type="button" disabled={busy === `left:${l.partyId}`} onClick={() => gone(l)} className={btn} style={quiet}>They’ve left</button>}
              </div>))}
          </div>
        </section>}
      </div>
    </div>
  );
}
