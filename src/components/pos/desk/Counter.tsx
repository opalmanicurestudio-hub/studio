'use client';
// src/components/pos/desk/Counter.tsx — COUNTER: sell anything to anyone.
//
// Starts from "Who's paying?" so every sale lands on a client's record (their
// history, lifetime spend, later their Client Journey). New clients are added
// in seconds (the POS's own Add client dialog); a Guest sale still works.
// Everything runs on the POS engine: selecting today's services, owed fees as
// checkout adjustments, the retail/membership catalog and the same checkout.

import { useMemo, useState } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { moduleEnabled } from '@/lib/modules';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { Btn, Pill, Empty, Panel } from './kit';

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;

export function Counter({ e, onFollowUp }: { e: any; onFollowUp?: (visit: any) => void }) {
  const tenant = e.selectedTenant;
  const retailOn = moduleEnabled(tenant, 'retail'), membershipsOn = moduleEnabled(tenant, 'memberships');
  const [q, setQ] = useState(''); const [guest, setGuest] = useState(false);
  const clients: any[] = e.clients || [];
  const client = e.selectedClientId ? clients.find((c) => c.id === e.selectedClientId) : null;

  const results = useMemo(() => {
    const n = q.trim().toLowerCase(); if (n.length < 2) return [];
    const digits = n.replace(/\D/g, '');
    return clients.filter((c) => `${c.name || ''} ${c.email || ''}`.toLowerCase().includes(n) || (digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 8);
  }, [q, clients]);

  // Their appointments: today's ready-to-pay (to add), visit history (to know them)
  const theirs = useMemo(() => (client ? (e.appointmentsFromInventory || []).filter((a: any) => a.clientId === client.id) : []), [client, e.appointmentsFromInventory]);
  const readyToday = theirs.filter((a: any) => a.status === 'ready_for_checkout');
  const past = theirs.filter((a: any) => a.status === 'completed').map((a: any) => toDate(a.startTime)).filter(Boolean).sort((a: any, b: any) => b - a) as Date[];
  const upcoming = theirs.filter((a: any) => { const d = toDate(a.startTime); return d && d > new Date() && !['cancelled', 'canceled'].includes(String(a.status)); }).sort((a: any, b: any) => (toDate(a.startTime)!.getTime() - toDate(b.startTime)!.getTime()))[0];
  const fees: any[] = client?.unpaidFees || [];
  const applied: Set<string> = e.appliedAdjustments || new Set();
  const toggleFee = (id: string) => e.checkoutHubProps?.onApplyAdjustmentToggle?.(id, !applied.has(id));
  const pick = (c: any) => { e.setSelectedClientId(c.id); setGuest(false); setQ(''); };
  const clear = () => { e.setSelectedClientId(null); setGuest(false); };
  const addReady = (a: any) => { if (!e.selectedAppointmentIds?.has?.(a.id)) e.handleSelectAppointment(a.id); };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-4">
        {/* Who's paying? */}
        {!client && !guest ? (
          <section className="space-y-3 rounded-3xl p-5" style={{ background: 'var(--card)' }} aria-label="Who's paying">
            <p className="text-[20px] font-light">Who’s <b className="font-semibold">paying?</b></p>
            <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Name, phone or email" aria-label="Find a client"
              className="h-12 w-full rounded-2xl px-4 text-[16px] outline-none" style={{ background: 'var(--soft)' }} />
            {results.length > 0 && <div className="space-y-1.5">{results.map((c) => (
              <button key={c.id} type="button" onClick={() => pick(c)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:opacity-90" style={{ background: 'var(--soft)' }}>
                <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span><span className="block truncate text-[12px]" style={{ color: 'var(--muted)' }}>{[c.phone, c.email].filter(Boolean).join(' · ')}</span></span>
                {(c.unpaidFees || []).length > 0 && <Pill tone="warn">Owes</Pill>}
              </button>))}</div>}
            {q.trim().length >= 2 && results.length === 0 && <Empty>No client matches “{q}”.</Empty>}
            <div className="flex flex-wrap gap-2 pt-1"><Btn onClick={() => e.setIsAddClientOpen(true)}>New client</Btn><Btn quiet onClick={() => { setGuest(true); e.setSelectedClientId(null); }}>Guest sale</Btn></div>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Choosing who’s paying keeps the sale on their record — their history, spend and journey.</p>
          </section>
        ) : guest ? (
          <section className="space-y-2 rounded-3xl p-5" style={{ background: 'var(--card)' }} aria-label="Guest sale">
            <div className="flex items-center justify-between gap-2"><p className="text-[17px] font-semibold">Guest sale</p><button type="button" onClick={clear} className="text-[13px] underline underline-offset-2">Change</button></div>
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>This sale won’t be on anyone’s record. If they’ll share a name, number or email, <button type="button" onClick={() => setGuest(false)} className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>find or add them</button> first.</p>
          </section>
        ) : (
          <section className="space-y-4 rounded-3xl p-5" style={{ background: 'var(--card)' }} aria-label={client.name}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold" style={{ background: 'var(--soft)' }}>{String(client.name || '?').charAt(0)}</span>
                <div className="min-w-0"><p className="truncate text-[18px] font-semibold">{client.name}</p><p className="truncate text-[12px]" style={{ color: 'var(--muted)' }}>{[client.phone, client.email].filter(Boolean).join(' · ') || 'No contact details yet'}</p></div></div>
              <button type="button" onClick={clear} className="shrink-0 text-[13px] underline underline-offset-2">Change</button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              <Pill>{past.length} visit{past.length === 1 ? '' : 's'}</Pill>
              {past[0] && <Pill>Last {format(past[0], 'MMM d')}</Pill>}
              {client.activeMembershipId && <Pill tone="accent">Member</Pill>}
              {(client.activePackages || []).length > 0 && <Pill tone="accent">Package</Pill>}
              {Number(client.storeCredit || client.creditBalance || 0) > 0 && <Pill tone="ok">{money(client.storeCredit || client.creditBalance)} credit</Pill>}
              {upcoming && <Pill>Next {format(toDate(upcoming.startTime)!, 'MMM d')}</Pill>}
            </div>
            {readyToday.length > 0 && <Panel title="Ready to pay today" count={readyToday.length}>{readyToday.map((a: any) => { const on = e.selectedAppointmentIds?.has?.(a.id);
              return <div key={a.id} className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--card)' }}><span className="min-w-0 truncate text-[14px]">{(e.services || []).find((s: any) => s.id === a.serviceId)?.name || 'Service'}</span>{on ? <Pill tone="ok">In this sale</Pill> : <Btn quiet onClick={() => addReady(a)}>Add</Btn>}</div>; })}</Panel>}
            {fees.length > 0 && <Panel title="Owed" count={fees.length}>{fees.map((f: any) => { const on = applied.has(f.feeId);
              return <div key={f.feeId} className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--card)' }}><span className="min-w-0 text-[14px]"><span className="block truncate">{String(f.reason || 'Fee').replace(/_/g, ' ')}</span><span className="text-[12px]" style={{ color: 'var(--muted)' }}>{money(f.feeAmount)}</span></span>{on ? <Btn quiet onClick={() => toggleFee(f.feeId)}>Remove</Btn> : <Btn quiet onClick={() => toggleFee(f.feeId)}>Add to sale</Btn>}</div>; })}</Panel>}
            <div className="flex flex-wrap gap-2"><Btn quiet onClick={() => { const last = readyToday[0] || [...theirs].filter((a: any) => ['completed', 'ready_for_checkout', 'servicing', 'confirmed'].includes(String(a.status))).sort((a: any, b: any) => (toDate(b.startTime)?.getTime() || 0) - (toDate(a.startTime)?.getTime() || 0))[0];
                if (last && onFollowUp) onFollowUp(last); else e.setIsQuickBookOpen(true); }}>Book next visit</Btn>{client.id && <Btn quiet onClick={() => { const a = theirs[0]; if (a) { e.setSelectedAppointment(a); e.setIsDetailsOpen(true); } }} disabled={!theirs.length}>History</Btn>}</div>
          </section>
        )}
        {(retailOn || membershipsOn) && <section className="rounded-3xl p-4" style={{ background: 'var(--card)' }} aria-label="Add to the sale">
          <p className="mb-3 text-[15px] font-semibold">Add to the sale</p>
          <RetailCatalog services={e.services || []} inventory={retailOn ? e.inventory || [] : []} memberships={membershipsOn ? e.memberships || [] : []} packages={membershipsOn ? e.packages || [] : []}
            onAddToCart={e.handleAddToCart} onScanClick={() => { e.setScanMode?.('retail'); e.setIsCameraScanOpen?.(true); }} />
        </section>}
      </div>
      <section className="rounded-3xl p-4 lg:sticky lg:top-2 lg:self-start" style={{ background: 'var(--card)' }} aria-label="Checkout">
        <p className="mb-2 text-[15px] font-semibold">Checkout{client ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {client.name}</span> : guest ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · guest</span> : null}</p>
        {!client && !guest ? <Empty>Choose who’s paying to start a sale.</Empty> : <CheckoutHub {...e.checkoutHubProps} />}
      </section>
    </div>
  );
}
