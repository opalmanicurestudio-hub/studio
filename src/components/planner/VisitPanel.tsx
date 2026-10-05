'use client';
// src/components/planner/VisitPanel.tsx — THE SIDE PANEL: what the desk decides with, without leaving the list or the
// board. Who and when, the state, the two or three actions that state needs, what they had last time, the provider's
// typical time against today, what's owed, who's next and whether they're waiting, and what the client has been told.
// "Open the full visit" hands over to the full appointment sheet for everything else.
import * as React from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { stateOf } from '@/components/planner/AgendaView';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
export function VisitPanel({ appointment, appointments, clients, services, staff, typical, onStart, onFinish, onToDesk, onRunningLate, onOpen, onClose }: {
  appointment: any; appointments: any[]; clients: any[]; services: any[]; staff: any[]; typical?: number | null;
  onStart: (a: any) => void; onFinish: (a: any) => void; onToDesk: (a: any) => void; onRunningLate?: (a: any) => void; onOpen: (a: any) => void; onClose?: () => void;
}) {
  const a = appointment; const client = clients.find((c) => c.id === a.clientId); const service = services.find((s) => s.id === a.serviceId); const prov = staff.find((s) => s.id === a.staffId);
  const st = stateOf(a, service); const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
  const elapsed = a.status === 'servicing' && a.actualStartTime ? differenceInMinutes(new Date(), safe(a.actualStartTime)) : null;
  // Last time: the client's most recent finished visit before this one.
  const last = appointments.filter((x) => x.clientId === a.clientId && x.id !== a.id && x.status === 'completed' && safe(x.startTime) < safe(a.startTime)).sort((x, y) => safe(y.startTime).getTime() - safe(x.startTime).getTime())[0];
  const lastService = last ? services.find((s) => s.id === last.serviceId) : null;
  // Next for this provider after this visit.
  const next = appointments.filter((x) => x.staffId === a.staffId && x.id !== a.id && !['cancelled', 'declined', 'completed'].includes(String(x.status)) && safe(x.startTime) >= safe(a.endTime || a.startTime)).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime())[0];
  const nextClient = next ? clients.find((c) => c.id === next.clientId) : null;
  const visits = appointments.filter((x) => x.clientId === a.clientId && x.status === 'completed').length;
  const owed = Number(a.balanceDue ?? a.amountDue ?? 0); const paid = Number(a.depositPaid ?? a.depositAmount ?? 0);
  const told: string[] = [];
  if (a.reminderSentAt) told.push(`reminded ${format(safe(a.reminderSentAt), 'EEE h:mm a')}`); if (a.lateNoticeSentAt || a.providerLateNoticeAt) told.push(`told we're running late ${format(safe(a.lateNoticeSentAt || a.providerLateNoticeAt), 'h:mm a')}`); if (a.rescheduledNoticeAt) told.push(`told of the move ${format(safe(a.rescheduledNoticeAt), 'EEE h:mm a')}`);
  const chip = (t: string, c?: string) => <span key={t} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={c ? { background: `color-mix(in srgb, ${c} 12%, transparent)`, color: c } : { background: 'var(--soft)' }}>{t}</span>;
  const btn = (label: string, f: () => void, primary = false) => <button key={label} type="button" onClick={f} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={primary ? { background: 'var(--ink)', color: '#fff' } : { background: 'var(--soft)' }}>{label}</button>;
  const actions: React.ReactNode[] = [];
  if (a.status === 'confirmed' && a.checkInStatus === 'arrived') actions.push(btn('Start', () => onStart(a), true));
  if (a.status === 'servicing') actions.push(btn('Finished — to the desk', () => onFinish(a), true));
  if (a.status === 'ready_for_checkout') actions.push(btn('Take payment', () => onToDesk(a), true));
  if (onRunningLate && ['confirmed', 'servicing'].includes(String(a.status)) && next) actions.push(btn(`Tell ${nextClient?.name?.split(' ')[0] || 'the next client'} we're late`, () => onRunningLate(next)));
  actions.push(btn('Open the full visit', () => onOpen(a)));
  return (
    <aside className="flex w-full flex-col gap-4 overflow-auto rounded-3xl p-5" style={{ background: 'var(--card)', border: '1px solid var(--line)' }} aria-label={`${client?.name || 'Client'} — ${service?.name || 'visit'}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[13px]" style={muted}>{format(safe(a.startTime), 'h:mm')} – {format(safe(a.endTime || a.startTime), 'h:mm a')}{prov ? ` · ${prov.name}` : ''}</p>
          <h2 className="mt-1 text-[22px] font-light leading-tight">{client?.name || a.clientName || 'Client'} <span className="text-[15px]" style={muted}>· {service?.name || a.serviceName || 'Service'}</span></h2></div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 shrink-0 rounded-full text-[18px]" style={{ background: 'var(--soft)' }}>×</button>}
      </div>
      <div className="flex flex-wrap gap-2">{chip(st.word, st.color)}{visits === 0 ? chip('First visit', 'var(--accent)') : chip(`${visits + 1}${['st', 'nd', 'rd'][((visits + 1) % 10) - 1] && (visits + 1) % 100 - (visits + 1) % 10 !== 10 ? ['st', 'nd', 'rd'][((visits + 1) % 10) - 1] : 'th'} visit`)}{paid > 0 && chip(`Deposit ${money(paid)} paid`)}{owed > 0 && chip(`${money(owed)} owed`, 'var(--warn, #b45309)')}{Array.isArray(a.addOnIds) && a.addOnIds.length > 0 && chip(`+${a.addOnIds.length} add-on${a.addOnIds.length === 1 ? '' : 's'}`)}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{actions}</div>
      <div className="space-y-2 border-t pt-3 text-[14px]" style={{ borderColor: 'var(--line)' }}>
        {last ? <p><b>Last time:</b> {lastService?.name || 'a visit'} on {format(safe(last.startTime), 'd MMM')}{last.note || last.notes || last.providerNote ? ` · ${last.note || last.notes || last.providerNote}` : ''}</p> : <p style={muted}><b>Last time:</b> nothing on record yet</p>}
        {(client?.nextVisitNote || client?.notes) && <p><b>Note:</b> {client.nextVisitNote || client.notes}</p>}
        {prov && service && <p><b>Typical for {prov.name}:</b> {typical ? `${typical} min on this service` : `booked at ${service.duration} min`}{elapsed !== null ? ` · today ${elapsed} min so far` : ''}</p>}
        {next ? <p><b>Next for {prov?.name || 'them'}:</b> {nextClient?.name || 'a client'} at {format(safe(next.startTime), 'h:mm a')}{next.checkInStatus === 'arrived' ? ', here and waiting' : ''}</p> : <p style={muted}><b>Next for {prov?.name || 'them'}:</b> nothing after this</p>}
        {told.length > 0 && <p style={muted}><b>Told:</b> {told.join(' · ')}</p>}
      </div>
    </aside>);
}
