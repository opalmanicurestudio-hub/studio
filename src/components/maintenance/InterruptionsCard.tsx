'use client';
// src/components/maintenance/InterruptionClients.tsx — an interruption's CLIENTS
// and its RECORD: link the maintenance tickets that caused it, see who's
// affected (studio + renter bookings), give studio clients their choices (a new
// time or cancel — no fee), and watch the outcomes add up. The tallies come from
// what actually happened to each appointment (kept on the interruption), so the
// insurance packet and renter reimbursements are built from facts.
import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { disruptionTotals } from '@/lib/disruptions';

const money = (c: number) => `$${((c || 0) / 100).toFixed(2)}`;
async function staffPost(url: string, body: any) { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({})); }

export function InterruptionClients({ tenantId, firestore, rec }: { tenantId: string; firestore: any; rec: any }) {
  const [tickets, setTickets] = useState<any[]>([]); const [linked, setLinked] = useState<string[]>(rec.ticketIds || []);
  const [prev, setPrev] = useState<any>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [moved, setMoved] = useState<string[]>([]); // moved to another room instead — no client impact
  useEffect(() => { if (!firestore || !tenantId) return; return onSnapshot(collection(firestore, `tenants/${tenantId}/tickets`), (s) => setTickets(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))); }, [firestore, tenantId]);
  const relevant = tickets.filter((t) => linked.includes(t.id) || !['closed', 'done', 'resolved', 'cancelled'].includes(String(t.status || ''))).slice(0, 12);
  const run = async (action: 'preview' | 'notify') => { setBusy(true); setMsg(null);
    const r = await staffPost('/api/appointments/disruption', { tenantId, action, kind: 'interruption', interruptionId: rec.id, ticketIds: linked, movedRoomIds: moved }); setBusy(false);
    if (!r?.ok) { setMsg(r?.error || 'That didn’t work.'); return; }
    if (action === 'preview') setPrev(r); else { setPrev(null); setMsg(`Done — ${r.told} client${r.told === 1 ? '' : 's'} told and asked to choose; ${r.rentersTold} renter${r.rentersTold === 1 ? '' : 's'} told about their bookings. Outcomes will fill in below as clients choose.`); } };
  const t = disruptionTotals(rec.affected);
  return (
    <div className="space-y-2 rounded-xl border-2 bg-white px-3 py-2.5">
      <p className="text-sm font-semibold">Clients and records</p>
      <div className="space-y-1"><p className="text-xs text-slate-500">Maintenance tickets behind this (for the insurance record):</p>
        {relevant.length === 0 ? <p className="text-xs text-slate-500">No open tickets.</p> : relevant.map((tk) => <label key={tk.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={linked.includes(tk.id)} onChange={(e) => setLinked((l) => (e.target.checked ? [...l, tk.id] : l.filter((x) => x !== tk.id)))} /> {tk.title || 'Ticket'}{tk.category ? <span className="text-xs text-slate-500"> · {tk.category}</span> : null}</label>)}</div>
      {!prev ? <button type="button" disabled={busy} onClick={() => run('preview')} className="h-9 rounded-lg border-2 px-3 text-sm font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'See who’s affected'}</button> : <>
        <p className="text-sm">{prev.totals.appointments} appointment{prev.totals.appointments === 1 ? '' : 's'} ({prev.totals.studio} studio, {prev.totals.renter} renter) · {money(prev.totals.bookedCents)} booked · {money(prev.totals.depositsCents)} deposits held</p>
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">{prev.affected.map((x: any) => <li key={x.appointmentId} className="flex flex-wrap items-center justify-between gap-2"><span>{new Date(x.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {x.clientName || 'Client'}{x.isRenterBooking ? ' (renter — they’ll be told)' : ''}</span>
          {!x.isRenterBooking && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={moved.includes(x.appointmentId)} onChange={(e) => setMoved((m) => (e.target.checked ? [...m, x.appointmentId] : m.filter((y) => y !== x.appointmentId)))} /> Move room instead</label>}</li>)}</ul>
        {moved.length > 0 && <p className="text-xs text-slate-500">{moved.length} moved to another room — they won’t be messaged; it’s recorded as “moved room”.</p>}
        {prev.totals.appointments > 0 && <button type="button" disabled={busy} onClick={() => run('notify')} className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : `Give ${Math.max(0, prev.totals.studio - moved.length)} client${prev.totals.studio - moved.length === 1 ? '' : 's'} their choices (new time or cancel — no fee)`}</button>}
      </>}
      {msg && <p className="text-sm font-semibold text-emerald-700">{msg}</p>}
      {t.appointments > 0 && <div className="rounded-lg bg-slate-50 p-2 text-sm">
        <p className="font-semibold">So far</p>
        <p>{t.rescheduled} rescheduled · {t.reassigned} with another provider · {t.cancelled} cancelled · {t.kept} kept · {t.pending} waiting</p>
        <p>Refunds {money(t.refundsCents)} · credits {money(t.creditsCents)} · booked value lost {money(t.lostCents)}</p>
      </div>}
    </div>
  );
}
