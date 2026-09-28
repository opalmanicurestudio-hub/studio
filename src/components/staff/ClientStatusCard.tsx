'use client';
// src/components/staff/ClientStatusCard.tsx — WHAT THE CLIENT TOLD US, and a
// decision on the spot. Used on the staff portal's appointment cards so the
// provider sees running late (with the estimated arrival and their note), on
// the way (with the trip ETA), arrived — and can decide what happens when a
// client is late, with the client told straight away (text/email + their visit
// link). The front desk has the fuller panel (shorter visit, switch, late fee).
import React from 'react';
import { getAuth } from 'firebase/auth';

const hm = (iso?: string | null) => { if (!iso) return null; const d = new Date(iso); return isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };

export function ClientStatusCard({ apt, tenantId }: { apt: any; tenantId?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null); const [tell, setTell] = React.useState(true); const [msg, setMsg] = React.useState<string | null>(null);
  const st = String(apt?.checkInStatus || '');
  const done = ['servicing', 'completed', 'cancelled', 'no_show'].includes(String(apt?.status || ''));
  if (!apt || done || !['arrived', 'running_late', 'on_my_way'].includes(st) && !apt.studioAskedToMove) return null;
  const first = String(apt.clientName || 'Client').split(' ')[0];
  const eta = hm(apt.etaAt || apt.clientEtaAt) || (st === 'running_late' && apt.startTime && apt.lateTimeMinutes ? hm(new Date(Date.parse(apt.startTime) + Number(apt.lateTimeMinutes) * 60000).toISOString()) : null);
  const trip = apt.clientTrip?.at && Date.now() - Date.parse(apt.clientTrip.at) < 10 * 60000 ? apt.clientTrip : null;
  const decide = async (option: 'keep' | 'move') => {
    setBusy(option); setMsg(null);
    try {
      const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
      const r = await fetch('/api/appointments/late-decision', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({ tenantId, appointmentId: apt.id, option, tell }) }).then((x) => x.json());
      setMsg(r?.ok ? (tell ? `${first} has been told.` : 'Saved — tell them yourself.') : (r?.error || 'That didn’t save — please try again.'));
    } catch { setMsg('That didn’t save — please try again.'); } finally { setBusy(null); }
  };
  const tone = apt.studioAskedToMove || st === 'running_late' ? 'border-amber-200 bg-amber-50 text-amber-900' : st === 'arrived' ? 'border-green-200 bg-green-50 text-green-900' : 'border-blue-200 bg-blue-50 text-blue-900';
  return (
    <div className={`space-y-2 rounded-xl border p-3 text-[12px] ${tone}`} aria-live="polite">
      <p className="font-semibold">
        {apt.studioAskedToMove ? `Asked ${first} to reschedule — waiting for their new time`
          : st === 'arrived' ? `${first} is here`
          : st === 'running_late' ? `${first} is running late${eta ? ` — arriving about ${eta}` : apt.lateTimeMinutes ? ` (~${apt.lateTimeMinutes} min)` : ''}`
          : `${first} is on the way${trip?.etaMin ? ` · ~${trip.etaMin} min (${trip.distanceKm} km)` : ''}`}
      </p>
      {st === 'running_late' && apt.clientLateNote && <p>“{apt.clientLateNote}”</p>}
      {apt.lateReply?.message && <p className="rounded-lg bg-white/70 p-2"><b>They’ve been told:</b> {apt.lateReply.message}</p>}
      {st === 'running_late' && !apt.studioAskedToMove && (
        <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell {first} (text/email + their visit link)</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => decide('keep')} className="rounded-full bg-amber-900 px-3 py-1.5 font-semibold text-white disabled:opacity-60">{busy === 'keep' ? 'Saving…' : 'Still see them'}</button>
            <button type="button" disabled={!!busy} onClick={() => decide('move')} className="rounded-full border border-amber-900 px-3 py-1.5 font-semibold disabled:opacity-60">{busy === 'move' ? 'Saving…' : 'Ask them to reschedule'}</button>
          </div>
          <p className="opacity-80">Shorter visit, another provider or a late fee: the front desk’s “Running late”.</p>
        </>
      )}
      {msg && <p className="font-semibold">{msg}</p>}
    </div>
  );
}
