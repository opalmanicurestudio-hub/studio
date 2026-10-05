'use client';
// src/components/planner/NowFirst.tsx — THE PHONE'S TODAY: what matters this minute first. The current client (in the
// chair, or here and waiting) as one big card with the two buttons a provider reaches for between clients — Finished /
// Start, and "Tell [next] I'm late" — then Up next, then Done (collapsed). Provider chips narrow it; providers open
// filtered to themselves. Tapping any row opens the full visit.
import * as React from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { stateOf } from '@/components/planner/AgendaView';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
const money = (n: number) => `$${Math.round(Number(n) || 0)}`;
export function NowFirst({ appointments, clients, services, staff, providerFilter, onProviderFilter, onStart, onFinish, onToDesk, onRunningLate, onOpen, onBook }: {
  appointments: any[]; clients: any[]; services: any[]; staff: any[]; providerFilter: string; onProviderFilter: (id: string) => void;
  onStart: (a: any) => void; onFinish: (a: any) => void; onToDesk: (a: any) => void; onRunningLate: (next: any) => void; onOpen: (a: any) => void; onBook: () => void;
}) {
  const [showDone, setShowDone] = React.useState(false);
  const mine = appointments.filter((a) => !['cancelled', 'declined'].includes(String(a.status)) && (providerFilter === 'all' || a.staffId === providerFilter)).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime());
  const done = mine.filter((a) => a.status === 'completed').reverse();
  const open = mine.filter((a) => a.status !== 'completed');
  // "Now": someone in the chair first, then ready to pay, then here and waiting, then the next booked visit.
  const now = open.find((a) => a.status === 'servicing') || open.find((a) => a.status === 'ready_for_checkout') || open.find((a) => a.checkInStatus === 'arrived') || null;
  const upNext = open.filter((a) => a.id !== now?.id);
  const name = (a: any) => clients.find((c) => c.id === a.clientId)?.name || a.clientName || 'Client';
  const first = (a: any) => String(name(a)).split(' ')[0];
  const svc = (a: any) => services.find((s) => s.id === a.serviceId);
  const prov = (a: any) => staff.find((s) => s.id === a.staffId);
  const nextAfter = (a: any) => upNext.find((x) => x.staffId === a.staffId && safe(x.startTime) >= safe(a.startTime));
  const booked = mine.reduce((n, a) => n + (Number(a.price ?? svc(a)?.price) || 0), 0);
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
  const row = (a: any) => { const st = stateOf(a, svc(a)); return (
    <button key={a.id} type="button" onClick={() => onOpen(a)} className="grid min-h-[60px] w-full grid-cols-[52px_5px_minmax(0,1fr)] items-center gap-3 border-t px-4 py-3 text-left text-[14px]" style={{ borderColor: 'var(--line)' }}>
      <span style={muted}>{format(safe(a.startTime), 'h:mm')}</span><span className="h-9 w-[5px] rounded-full" style={{ background: st.color }} />
      <span className="min-w-0"><b>{name(a)}</b> · {svc(a)?.name || a.serviceName || 'Service'}<br /><span className="text-[12px]" style={{ color: st.over || /late|due|unpaid/i.test(st.word) ? 'var(--warn, #b45309)' : 'var(--muted, #6b635c)', fontWeight: st.over ? 600 : 400 }}>{prov(a)?.name ? `${prov(a).name} · ` : ''}{st.word}</span></span>
    </button>); };
  const card = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-1">
        <p className="text-[13px]" style={muted}>{mine.length} visit{mine.length === 1 ? '' : 's'}{booked ? ` · ${money(booked)} booked` : ''}</p>
        <button type="button" onClick={onBook} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>+ Book</button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2">{[{ id: 'all', name: 'Everyone' }, ...staff].map((s: any) => <button key={s.id} type="button" aria-pressed={providerFilter === s.id} onClick={() => onProviderFilter(s.id)} className="h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold" style={providerFilter === s.id ? { background: 'var(--ink)', color: '#fff' } : { background: 'var(--soft)' }}>{s.name}</button>)}</div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-28">
        {now ? (() => { const st = stateOf(now, svc(now)); const nx = nextAfter(now); const elapsed = now.actualStartTime ? differenceInMinutes(new Date(), safe(now.actualStartTime)) : null;
          return (
            <section className="rounded-3xl p-4" style={{ ...card, borderLeft: `5px solid ${st.color}` }} aria-label="Now">
              <p className="text-[12px]" style={muted}>Now{prov(now) ? ` · ${prov(now).name}` : ''} · <span style={st.over ? { color: st.color, fontWeight: 600 } : undefined}>{st.word}</span>{elapsed !== null && !st.over ? ` · ${elapsed} min in` : ''}</p>
              <button type="button" onClick={() => onOpen(now)} className="mt-1 block text-left"><span className="block text-[19px] font-semibold leading-tight">{name(now)} · {svc(now)?.name || 'Service'}</span>
                <span className="block text-[13px]" style={muted}>{format(safe(now.startTime), 'h:mm')} – {format(safe(now.endTime || now.startTime), 'h:mm a')}{nx ? ` · next: ${first(nx)} at ${format(safe(nx.startTime), 'h:mm')}${nx.checkInStatus === 'arrived' ? ', waiting' : ''}` : ''}</span></button>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {now.status === 'servicing' && <button type="button" onClick={() => onFinish(now)} className="h-12 rounded-full text-[15px] font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>Finished</button>}
                {now.status === 'ready_for_checkout' && <button type="button" onClick={() => onToDesk(now)} className="h-12 rounded-full text-[15px] font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>Take payment</button>}
                {now.status === 'confirmed' && <button type="button" onClick={() => onStart(now)} className="h-12 rounded-full text-[15px] font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>Start</button>}
                {nx ? <button type="button" onClick={() => onRunningLate(nx)} className="h-12 rounded-full text-[15px] font-semibold" style={{ background: 'var(--soft)' }}>Tell {first(nx)} I’m late</button>
                  : <button type="button" onClick={() => onOpen(now)} className="h-12 rounded-full text-[15px] font-semibold" style={{ background: 'var(--soft)' }}>Open</button>}
              </div>
            </section>); })()
          : open.length ? null : <p className="px-2 pt-6 text-center text-[15px]" style={muted}>{done.length ? 'All done for the day.' : 'Nothing booked yet.'}</p>}
        {upNext.length > 0 && <section className="overflow-hidden rounded-3xl" style={card} aria-label="Up next"><h2 className="px-4 pb-1 pt-3 text-[12px] font-semibold" style={muted}>Up next · {upNext.length}</h2>{upNext.map(row)}</section>}
        {done.length > 0 && <section className="overflow-hidden rounded-3xl" style={{ ...card, opacity: 0.9 }} aria-label="Done">
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-semibold" style={muted}><span>Done · {done.length}</span><span>{showDone ? 'Hide' : 'Show'}</span></button>
          {showDone && done.map(row)}</section>}
      </div>
    </div>);
}
