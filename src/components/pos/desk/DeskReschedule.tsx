'use client';
// src/components/pos/desk/DeskReschedule.tsx — RESCHEDULE, in the desk's design.
// Same logic as the planner's dialog (useReschedule): the reschedule route's
// availability checks, fee window, client notice, manager override and the
// vacated-slot recovery — only the layout is the desk's.

import { format, isSameDay, isBefore, startOfDay, addMonths } from 'date-fns';
import { useReschedule, key, clock } from '@/components/planner/RescheduleAppointmentDialog';
import { Drawer, Btn, Seg } from './kit';

export function DeskReschedule({ e, appt, accent, onClose }: { e: any; appt: any | null; accent?: string | null; onClose: () => void }) {
  const client = appt?.clientId ? (e.clients || []).find((c: any) => c.id === appt.clientId) : null;
  const r: any = useReschedule({ open: !!appt, onOpenChange: (o: boolean) => { if (!o) onClose(); }, appointment: appt || {}, client, tenant: e.selectedTenant, tenantId: e.tenantId, isMobile: false } as any);
  if (!appt) return <Drawer accent={accent} open={false} onClose={onClose} title="Reschedule">{null}</Drawer>;
  const today = startOfDay(new Date());
  const Card = ({ children }: { children: React.ReactNode }) => <section className="space-y-2.5 rounded-3xl p-4" style={{ background: 'var(--card)' }}>{children}</section>;

  return (
    <Drawer accent={accent} open={!!appt} onClose={onClose} title={`Reschedule ${r.first}`}>
      <div className="space-y-3">
        <Card><p className="text-[12px]" style={{ color: 'var(--muted)' }}>Currently</p><p className="text-[16px] font-semibold">{format(r.original, 'EEEE, MMM d · h:mm a')}</p>{r.who && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>with {r.who}</p>}</Card>

        {r.providers.length > 1 && <Card><p className="text-[14px] font-semibold">With</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{r.providers.map((p: any) => { const on = p.id === r.staffId; return (
            <button key={p.id} type="button" aria-pressed={on} onClick={() => { r.setStaffId(p.id); r.setTime(''); r.setReason(null); r.setOverride(false); }}
              className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-[13px] font-semibold transition" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>
              {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px]" style={{ background: on ? 'rgba(255,255,255,.25)' : 'var(--card)' }}>{p.name.charAt(0)}</span>}
              {p.name.split(' ')[0]}{p.id === appt.staffId && <span className="text-[10px] opacity-75">now</span>}</button>); })}</div></Card>}

        <Card><p className="text-[14px] font-semibold">Same time, later <span className="font-normal" style={{ color: 'var(--muted)' }}>· usually {clock(r.usualTime)}</span></p>
          <div className="grid grid-cols-2 gap-2">{r.suggestions.map((s: any) => { const on = r.day === key(s.d) && r.time === s.t; const off = s.state === 'none' || s.state === 'loading'; return (
            <button key={s.label} type="button" disabled={off} aria-pressed={on} onClick={() => r.choose(key(s.d), s.t)} className="rounded-2xl p-3 text-left transition active:scale-[.98] disabled:opacity-50"
              style={on ? { background: 'color-mix(in srgb, var(--accent) 14%, var(--card))', boxShadow: 'inset 0 0 0 2px var(--accent)' } : { background: 'var(--soft)' }}>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{s.label}</p><p className="text-[14px] font-semibold">{format(s.d, 'EEE, MMM d')}</p>
              <p className="text-[12px]" style={{ color: s.state === 'same' ? 'var(--ok)' : s.state === 'near' ? 'var(--warn)' : 'var(--muted)' }}>{s.state === 'loading' ? 'Checking…' : s.state === 'none' ? 'No times that day' : s.state === 'same' ? `✓ ${clock(s.t)} · same time` : `${clock(s.t)} · nearest free`}</p></button>); })}</div></Card>

        <Card>
          <div className="flex items-center justify-between"><p className="text-[14px] font-semibold">{format(r.month, 'MMMM yyyy')}</p>
            <div className="flex gap-1"><Btn quiet label="Previous month" disabled={!isBefore(today, r.month)} onClick={() => r.setMonth(addMonths(r.month, -1))}>‹</Btn><Btn quiet label="Next month" onClick={() => r.setMonth(addMonths(r.month, 1))}>›</Btn></div></div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px]" style={{ color: 'var(--muted)' }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1">{r.cells.map((d: Date | null, i: number) => { if (!d) return <span key={i} />; const k = key(d); const list = r.timesFor(k); const past = isBefore(d, today); const on = r.day === k; const has = !!list?.length;
            return <button key={k} type="button" disabled={past} onClick={() => { r.setDay(k); r.setTime(''); r.setReason(null); r.setOverride(false); }} aria-pressed={on} aria-label={`${format(d, 'EEEE MMMM d')}${has ? `, ${list.length} times` : ''}`}
              className="relative flex h-10 flex-col items-center justify-center rounded-xl text-[14px] disabled:opacity-30" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 } : isSameDay(d, r.original) ? { boxShadow: 'inset 0 0 0 1.5px var(--line)' } : undefined}>
              {d.getDate()}{!past && list !== undefined && <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: has ? (on ? 'var(--accent-ink)' : 'var(--accent)') : 'transparent' }} />}</button>; })}</div>
          {r.loading && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Checking open times…</p>}
        </Card>

        {r.day && <Card><p className="text-[14px] font-semibold">{format(new Date(`${r.day}T12:00`), 'EEEE, MMM d')}</p>
          {r.dayTimes === undefined ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Checking…</p> : !r.dayTimes.length ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No open times with {r.who?.split(' ')[0] || 'them'} that day.</p>
            : r.groups.filter(([, l]: any) => l.length).map(([label, list]: [string, string[]]) => <div key={label} className="space-y-1.5"><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{label}</p>
              <div className="flex flex-wrap gap-1.5">{list.map((t) => <Btn key={t} quiet={r.time !== t} onClick={() => r.choose(r.day, t)}>{clock(t)}</Btn>)}</div></div>)}</Card>}

        {r.policyNote && <p className="rounded-2xl p-3 text-[13px] font-semibold" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--card))', color: 'var(--warn)' }}>{r.policyNote}</p>}
        <Card>
          <div className="space-y-1.5"><p className="text-[14px] font-semibold">Who asked for this change?</p>
            <div className="flex gap-1.5">{([['client', 'The client'], ['studio', 'We did']] as const).map(([v, l]) => <Btn key={v} quiet={r.initiatedBy !== v} onClick={() => r.setInitiatedBy(v)}>{l}</Btn>)}</div>
            {r.initiatedBy === 'studio' && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Our change: no fee, not counted toward their change limit, and their notice deadline starts from the new time.</p>}</div>
          {r.feeEligible && r.initiatedBy === 'client' && <label className="flex items-center justify-between gap-3 text-[14px]"><span><b>Reschedule fee</b> · ${r.fee.toFixed(2)} (inside your {Number(e.selectedTenant?.rescheduleFeeWindowHours || 0)}-hour window)</span><input type="checkbox" checked={r.applyFee} onChange={(ev) => r.setApplyFee(ev.target.checked)} /></label>}
          <label className="flex items-center justify-between gap-3 text-[14px]"><span><b>Tell {r.first}</b> · email + text with the new time</span><input type="checkbox" checked={r.notify} onChange={(ev) => r.setNotify(ev.target.checked)} /></label>
          {r.time && r.day && <p className="text-center text-[14px]"><span style={{ color: 'var(--muted)' }}>{format(r.original, 'EEE MMM d, h:mm a')} → </span><b>{format(new Date(`${r.day}T${r.time}`), 'EEE MMM d, h:mm a')}</b></p>}
          {r.override && r.reason ? <div className="space-y-2"><p className="rounded-2xl p-3 text-[13px]" style={{ background: 'color-mix(in srgb, var(--warn) 10%, var(--card))', color: 'var(--warn)' }}>{r.reason}</p>
            <Btn big onClick={() => r.move(true)} disabled={r.busy} className="w-full">Move anyway (recorded)</Btn><Btn quiet onClick={() => { r.setOverride(false); r.setReason(null); r.setTime(''); }} className="w-full">Pick another time</Btn></div>
            : <Btn big onClick={() => r.move(false)} disabled={r.busy || !r.time || !r.day} className="w-full">{r.busy ? 'Moving…' : r.time ? `Move ${r.first}` : 'Pick a time'}</Btn>}
        </Card>
      </div>
    </Drawer>
  );
}
