'use client';
// src/components/events/DoorScan.tsx — SCAN AT THE DOOR on the event's manifest (design board "The event pass";
// lib/event-pass, api/event-night 'door' and 'doorIn'). The team scans the code on a guest's pass (with the camera here,
// or any phone's own camera: the code opens this page with that party), or types its 4 digits. The party shows with each
// place's seat and allergies, who's already in and when; Check in the ones picked (all of them to start with).
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { QRScanner } from '@/components/pos/QRScanner';
import type { DoorParty } from '@/lib/event-pass';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;

async function post(body: any) {
  // (Opened cold from a phone's camera, sign-in may still be loading: waited for, so the scan isn't sent signed out.)
  const auth: any = getAuth(); try { await auth.authStateReady?.(); } catch { /* fine */ }
  const tk = await auth.currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/event-night', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const at = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const names = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export default function DoorScan({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [scanning, setScanning] = useState(false); const [digits, setDigits] = useState('');
  const [parties, setParties] = useState<DoorParty[] | null>(null); const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [said, setSaid] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const find = useCallback(async (scan: string): Promise<boolean> => {
    setBusy(true); setErr(''); setSaid('');
    const r = await post({ action: 'door', tenantId, eventId, scan });
    setBusy(false);
    if (!r.ok) { setParties(null); setErr(r.error || 'That didn’t go through. Try again.'); return !!r.error && !/sign in/i.test(String(r.error)); }
    const ps: DoorParty[] = r.parties || [];
    setParties(ps); setPicked(Object.fromEntries(ps.flatMap((p) => p.places.map((x) => [x.id, !x.checkedIn]))));
    requestAnimationFrame(() => box.current?.focus());
    return true;
  }, [tenantId, eventId]);
  // Opened from a phone's own camera (the code's link): that party. The code comes off the address once it's been looked
  // up (kept, and tried once more, if sign-in wasn't ready).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search); const d = q.get('door'); if (!d) return;
    const drop = () => { q.delete('door'); try { window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}`); } catch { /* fine */ } };
    void find(d).then((done) => { if (done) drop(); else setTimeout(() => void find(d).then(drop), 2000); });
  }, [find]);
  const checkIn = async (p: DoorParty) => {
    const ids = p.places.filter((x) => picked[x.id] && !x.checkedIn).map((x) => x.id); if (!ids.length) return;
    setBusy(true); setErr('');
    const r = await post({ action: 'doorIn', tenantId, eventId, partyId: p.partyId, guestIds: ids });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t go through. Try again.'); return; }
    const now: DoorParty = r.party; setParties((ps) => (ps || []).map((x) => (x.partyId === p.partyId ? now : x)));
    setSaid(`Checked in ${names(now.places.filter((x) => ids.includes(x.id)).map((x) => x.name.split(' ')[0]))}.`);
  };
  return (
    <section className="space-y-3 rounded-2xl border bg-[#fff] p-4 sm:p-5" style={{ borderColor: LINE, color: INK }} aria-labelledby="door-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 id="door-title" className="text-[17px] font-semibold">At the door</h2>
          <p className="text-[14px]" style={{ color: MUTED }}>Scan the code on a guest’s pass, or type its 4 digits.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setScanning(true)} className={btn} style={{ background: INK, color: '#fff' }}>Scan at the door</button>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (/^\d{4}$/.test(digits)) void find(digits); }}>
            <label className="sr-only" htmlFor="door-digits">The pass’s 4 digits</label>
            <input id="door-digits" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" placeholder="4 digits"
              className={`h-11 w-28 rounded-xl border px-3 text-center text-[16px] tabular-nums ${RING}`} style={{ borderColor: LINE }} />
            <button type="submit" disabled={busy || digits.length !== 4} className={btn} style={{ background: SOFT, color: INK }}>Find</button>
          </form>
        </div>
      </div>
      {err && <p role="alert" className="text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>}
      <p role="status" className={said ? 'rounded-xl px-3 py-2 text-[14.5px] font-medium' : 'sr-only'} style={said ? { background: GREEN_TINT, color: GREEN } : undefined}>{said}</p>
      {parties && (
        <div ref={box} tabIndex={-1} className="space-y-3" style={{ outline: 'none' }}>
          {parties.length > 1 && <p className="text-[14px]" style={{ color: MUTED }}>{parties.length} parties have those digits. Check the name with them.</p>}
          {parties.map((p) => {
            const left = p.places.filter((x) => !x.checkedIn); const pick = left.filter((x) => picked[x.id]).length;
            return (
              <div key={p.partyId} className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
                <p className="text-[16px] font-semibold">{p.lead}<span className="font-normal" style={{ color: MUTED }}>{`, ${p.places.length} ${p.places.length === 1 ? 'place' : 'places'}${p.paid ? ', paid' : ''}`}</span></p>
                <ul className="space-y-1.5">
                  {p.places.map((x) => (
                    <li key={x.id}>
                      <label className={`flex min-h-[44px] items-center gap-3 rounded-xl bg-[#fff] px-3 py-2 ${x.checkedIn ? '' : 'cursor-pointer'}`}>
                        <input type="checkbox" checked={x.checkedIn || !!picked[x.id]} disabled={x.checkedIn} onChange={(e) => setPicked((m) => ({ ...m, [x.id]: e.target.checked }))} className="h-5 w-5 shrink-0 accent-[#16171a]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium">{x.name}{x.seat ? <span className="font-normal" style={{ color: MUTED }}>{`, ${x.seat}`}</span> : null}</span>
                          {x.allergies.length > 0 && <span className="block text-[13.5px] font-medium" style={{ color: AMBER }}>{x.allergies.join(', ')}{x.severe ? ', severe' : ''}</span>}
                        </span>
                        {x.checkedIn && <span className="shrink-0 text-[13.5px] font-semibold" style={{ color: GREEN }}>In{x.checkedInAt ? ` at ${at(x.checkedInAt)}` : ''}</span>}
                      </label>
                    </li>))}
                </ul>
                {left.length ? <button type="button" disabled={busy || !pick} onClick={() => checkIn(p)} className={`${btn} w-full sm:w-auto`} style={{ background: INK, color: '#fff' }}>{pick === left.length && left.length > 1 ? `Check in all ${pick}` : pick === 1 ? 'Check in 1' : `Check in ${pick}`}</button>
                  : <p className="text-[14px] font-medium" style={{ color: GREEN }}>Everyone in this party is in.</p>}
              </div>);
          })}
          <button type="button" onClick={() => { setParties(null); setDigits(''); setSaid(''); }} className={`${btn} px-0 underline underline-offset-4`} style={{ color: MUTED }}>Next guest</button>
        </div>)}
      {scanning && <QRScanner onScan={(v) => { setScanning(false); void find(v); }} onClose={() => setScanning(false)} />}
    </section>);
}
