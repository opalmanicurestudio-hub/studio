'use client';
/**
 * components/planner/RescheduleAppointmentDialog.tsx
 *
 * A reschedule MOVES the same appointment (not a cancel + rebook — no
 * cancellation count, no refund/re-collect of the deposit). Every step goes
 * through /api/appointments/reschedule, which uses the same availability
 * engine and time frame as online booking.
 *
 * v3 — built for moving clients out quickly and calmly:
 *   • Provider chips — keep the same person or move to anyone who offers it
 *   • "Same time, later" — next week / in 2 weeks / in 4 weeks / next month,
 *     each ✓ when the usual time is free, else the nearest free time that day
 *   • A month calendar with availability dots (fuller dot = more room)
 *   • The chosen day's times, grouped Morning · Afternoon · Evening
 *   • Only open times can be chosen (no free-typed times); the server still
 *     re-checks at the moment of moving, with a plain reason if it changed
 *   • Managers can "Move anyway" (recorded). Fee inside the window, "Tell the
 *     client" (email + text), history and the activity log — all server-side.
 */

import { checkChange, hoursToDeadline } from '@/lib/change-rules';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, endOfMonth, format, isBefore, isSameDay, isSameMonth, parseISO, startOfDay, startOfMonth, differenceInHours, differenceInCalendarDays } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CalendarClock, ChevronLeft, ChevronRight, Loader } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';
import { useToast } from '@/hooks/use-toast';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};
export const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
export const key = (d: Date) => format(d, 'yyyy-MM-dd');
export const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; appointment: any; client?: any; tenant?: any; tenantId?: string;
  actorName?: string; actorId?: string; isMobile?: boolean; onRescheduled?: (newStartIso: string) => void;
}

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/appointments/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ...(d || {}) };
}

/** The reschedule dialog's logic, shared by the planner dialog and the front desk (same behaviour, two layouts). */
export function useReschedule(props: Props) {
  const { open, onOpenChange, appointment, client, tenant, tenantId, isMobile = false, onRescheduled } = props;
  const { toast } = useToast();
  const original = useMemo(() => safeDate(appointment?.startTime), [appointment]);
  const usualTime = format(original, 'HH:mm');
  const today = startOfDay(new Date());
  const [staffId, setStaffId] = useState<string>(appointment?.staffId || '');
  const [providers, setProviders] = useState<{ id: string; name: string; avatarUrl: string | null }[]>([]);
  const [slots, setSlots] = useState<Record<string, string[]>>({}); // `${staffId}|yyyy-MM-dd` → times
  const [loading, setLoading] = useState(false); const fetched = useRef(new Set<string>());
  const [month, setMonth] = useState(() => startOfMonth(original < today ? today : original));
  const [day, setDay] = useState(''); const [time, setTime] = useState(''); const [custom, setCustom] = useState('');
  const [reason, setReason] = useState<string | null>(null); const [override, setOverride] = useState(false);
  const [applyFee, setApplyFee] = useState(true); const [notify, setNotify] = useState(true); const [busy, setBusy] = useState(false);
  const [initiatedBy, setInitiatedBy] = useState<'client' | 'studio'>('client'); // who asked for this change
  const [grace, setGrace] = useState<any>(null); const [graceOn, setGraceOn] = useState(false); // late-reschedule grace allowance
  const fee = Number(tenant?.rescheduleFee || 0), windowH = Number(tenant?.rescheduleFeeWindowHours || 0);
  // Counted from the ORIGINAL time (Booking policies) — the same way the server charges it.
  const feeEligible = fee > 0 && windowH > 0 && hoursToDeadline(tenant, appointment) < windowH;
  // Staff are never blocked — but they see when a move goes past your policy (and it's recorded).
  const policyNote = useMemo(() => checkChange(tenant, appointment, 'staff').staffNote, [tenant, appointment]);
  useEffect(() => {
    setGrace(null); setGraceOn(false);
    if (!open || !feeEligible || initiatedBy !== 'client' || !appointment?.clientId) return;
    let live = true;
    (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
      const g = await fetch('/api/grace', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ tenantId, action: 'check', event: 'late_reschedule', clientId: appointment.clientId, serviceId: appointment.serviceId || null, staffId: appointment.staffId || null }) }).then((x) => x.json()).catch(() => null);
      if (live && g?.ok && g.enabled) setGrace(g); })();
    return () => { live = false; };
  }, [open, feeEligible, initiatedBy, appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = { tenantId, appointmentId: appointment?.id };
  const first = String(appointment?.clientName || client?.name || 'client').split(' ')[0];

  /** Load open times for a stretch of days (cached per provider). */
  const ensure = useCallback(async (from: Date, days: number, sid = staffId) => {
    const start = from < today ? today : from; const k = `${sid}|${key(start)}|${days}`;
    if (!tenantId || !appointment?.id || fetched.current.has(k)) return; fetched.current.add(k);
    setLoading(true);
    try {
      const d = await api({ ...base, action: 'range', date: key(start), days, staffId: sid });
      if (d.ok) { setSlots((s) => { const n = { ...s }; for (const x of d.days || []) n[`${sid}|${x.date}`] = x.times || []; return n; }); if (d.providers?.length) setProviders(d.providers); }
    } finally { setLoading(false); }
  }, [tenantId, appointment?.id, staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!open) return; setStaffId(appointment?.staffId || ''); setDay(''); setTime(''); setCustom(''); setReason(null); setOverride(false); setApplyFee(true); setNotify(true); setInitiatedBy('client'); setMonth(startOfMonth(original < today ? today : original)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && staffId) void ensure(original, 42, staffId); }, [open, staffId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && staffId) void ensure(startOfMonth(month), differenceInCalendarDays(endOfMonth(month), startOfMonth(month)) + 1, staffId); }, [open, month, staffId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // "Another time" — checked live
    if (!custom || !day) return; let stale = false;
    const h = setTimeout(() => api({ ...base, action: 'check', date: day, time: custom, staffId }).then((d) => { if (!stale) { setTime(custom); setReason(d.ok ? d.reason || null : d.error || 'Couldn’t check that time.'); setOverride(false); } }), 300);
    return () => { stale = true; clearTimeout(h); };
  }, [custom, day, staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  const timesFor = (d: string) => slots[`${staffId}|${d}`];
  // Presets: the same time 2, 4, 6 or 8 weeks on (same weekday).
  const presetDates = useMemo(() => [2, 4, 6, 8].map((w) => [`In ${w} weeks`, addDays(original, w * 7)] as [string, Date]), [original]); // eslint-disable-line react-hooks/exhaustive-deps
  // The first load covers 6 weeks; the 8-week date is fetched on its own.
  useEffect(() => { if (!open || !staffId) return; for (const [, d] of presetDates) if (d > addDays(original, 41) && !timesFor(key(d))) void ensure(d, 1, staffId); }, [open, staffId, presetDates, slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => {
    return presetDates.map(([label, d]) => {
      const list = timesFor(key(d));
      if (!list) return { label, d, state: 'loading' as const };
      if (list.includes(usualTime)) return { label, d, state: 'same' as const, t: usualTime };
      if (!list.length) return { label, d, state: 'none' as const };
      const near = [...list].sort((a, b) => Math.abs(mins(a) - mins(usualTime)) - Math.abs(mins(b) - mins(usualTime)))[0];
      return { label, d, state: 'near' as const, t: near };
    });
  }, [slots, staffId, original]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (d: string, t: string) => { setDay(d); setTime(t); setCustom(''); setReason(null); setOverride(false); };
  const move = async (force = false) => {
    if (!time || !day || busy) return; setBusy(true);
    try {
      const d = await api({ ...base, action: 'move', date: day, time, staffId, applyFee: feeEligible && applyFee && initiatedBy === 'client' && !graceOn, notify, override: force, initiatedBy });
      if (!d.ok) { if (d.canOverride) { setOverride(true); setReason(d.error); } else toast({ variant: 'destructive', title: 'Couldn’t move it', description: d.error || 'Please try another time.' }); return; }
      fetch('/api/opal/recovery-spawn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: appointment.id, resolutionTicketId: d.auditId, clientId: client?.id || appointment.clientId, eventType: 'reschedule', vacatedSlotStart: appointment.startTime, vacatedSlotEnd: appointment.endTime, locationId: appointment.locationId || null }) }).catch(() => {});
      const told = [d.told?.email && 'email', d.told?.sms && 'text'].filter(Boolean).join(' + ');
      toast({ title: `${first} moved`, description: `${format(safeDate(d.startTime), 'EEE MMM d, h:mm a')}${d.feeApplied ? ` · $${Number(d.feeApplied).toFixed(2)} fee added` : ''}${notify ? (told ? ` · told by ${told}` : ' · couldn’t be messaged') : ''}${d.overrode ? ' · outside the rules (recorded)' : ''}` });
      if (graceOn && appointment.clientId) { const gu = getAuth().currentUser; const gtk = gu ? await gu.getIdToken() : '';
        await fetch('/api/grace', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gtk}` }, body: JSON.stringify({ tenantId, action: 'use', event: 'late_reschedule', clientId: appointment.clientId, appointmentId: appointment.id, serviceId: appointment.serviceId || null, staffId: appointment.staffId || null }) }).catch(() => {}); }
      onRescheduled?.(d.startTime); onOpenChange(false);
    } finally { setBusy(false); }
  };

  // ── Calendar ────────────────────────────────────────────────────────────
  const cells = useMemo(() => { const f = startOfMonth(month); return [...Array(f.getDay()).fill(null), ...Array.from({ length: endOfMonth(month).getDate() }, (_, i) => addDays(f, i))]; }, [month]);
  const dayTimes = day ? timesFor(day) : undefined;
  const groups: [string, string[]][] = dayTimes ? [['Morning', dayTimes.filter((t) => mins(t) < 720)], ['Afternoon', dayTimes.filter((t) => mins(t) >= 720 && mins(t) < 1020)], ['Evening', dayTimes.filter((t) => mins(t) >= 1020)]] : [];
  const who = providers.find((p) => p.id === staffId)?.name || appointment?.staffName || '';

  const body = (
    <div className="space-y-5 px-1">
      {policyNote && <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{policyNote}</p>}
      <div className="flex items-center gap-3 rounded-2xl border bg-muted/20 p-4">
        <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Currently</p><p className="truncate text-[15px] font-bold">{format(original, 'EEEE, MMM d · h:mm a')}</p><p className="truncate text-xs text-muted-foreground">{appointment?.serviceName || 'Service'}{appointment?.staffName ? ` with ${appointment.staffName}` : ''}</p></div>
      </div>

      {providers.length > 1 && <section className="space-y-2" aria-label="Provider">
        <p className="text-sm font-bold">With</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{providers.map((p) => { const on = p.id === staffId; return (
          <button key={p.id} type="button" onClick={() => { setStaffId(p.id); setTime(''); setReason(null); setOverride(false); }} aria-pressed={on} className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm transition active:scale-95 ${on ? 'border-primary bg-primary text-primary-foreground shadow' : 'bg-background hover:bg-muted/40'}`}>
            {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${on ? 'bg-white/25' : 'bg-muted'}`}>{p.name.charAt(0)}</span>}
            {p.name.split(' ')[0]}{p.id === appointment?.staffId && <span className={`text-[10px] ${on ? 'opacity-80' : 'text-muted-foreground'}`}>· now</span>}
          </button>
        ); })}</div>
      </section>}

      <section className="space-y-2" aria-label="Same time, later">
        <p className="text-sm font-bold">Same time, later <span className="font-normal text-muted-foreground">· usually {clock(usualTime)}</span></p>
        <div className="grid grid-cols-2 gap-2">{suggestions.map((s) => { const on = day === key(s.d) && time === (s as any).t; const off = s.state === 'none' || s.state === 'loading'; return (
          <button key={s.label} type="button" disabled={off} onClick={() => choose(key(s.d), (s as any).t)} aria-pressed={on}
            className={`rounded-2xl border p-3 text-left transition active:scale-[.98] disabled:opacity-50 ${on ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'bg-background hover:bg-muted/30'}`}>
            <p className="text-xs text-muted-foreground">{s.label}</p><p className="text-sm font-bold">{format(s.d, 'EEE, MMM d')}</p>
            <p className={`text-xs ${s.state === 'same' ? 'text-emerald-700' : s.state === 'near' ? 'text-amber-700' : 'text-muted-foreground'}`}>
              {s.state === 'loading' ? 'Checking…' : s.state === 'none' ? 'No times that day' : s.state === 'same' ? `✓ ${clock(s.t!)} — same time` : `${clock(s.t!)} — nearest free`}</p>
          </button>
        ); })}</div>
      </section>

      <section className="space-y-2 rounded-2xl border p-3" aria-label="Pick a day">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} disabled={isSameMonth(month, today)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <p className="text-sm font-bold">{format(month, 'MMMM yyyy')} {loading && <Loader className="ml-1 inline h-3 w-3 animate-spin" />}</p>
          <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i}>{x}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">{cells.map((d, i) => { if (!d) return <span key={i} />;
          const k = key(d); const past = isBefore(d, today); const list = timesFor(k); const n = list?.length ?? -1; const on = day === k; const isOrig = isSameDay(d, original);
          const dot = n <= 0 ? null : n >= 8 ? 'w-4 opacity-100' : n >= 4 ? 'w-3 opacity-80' : 'w-1.5 opacity-60';
          return (
            <button key={k} type="button" disabled={past} onClick={() => { setDay(k); setTime(''); setCustom(''); setReason(null); setOverride(false); }} aria-pressed={on} aria-label={`${format(d, 'EEEE, MMMM d')}${n >= 0 ? ` — ${n} open time${n === 1 ? '' : 's'}` : ''}`}
              className={`relative flex h-11 flex-col items-center justify-center rounded-xl text-sm transition active:scale-95 ${on ? 'bg-primary font-bold text-primary-foreground shadow' : past ? 'text-muted-foreground/40' : n === 0 ? 'text-muted-foreground/60' : 'hover:bg-muted/50'} ${isOrig && !on ? 'ring-1 ring-primary/40' : ''}`}>
              {format(d, 'd')}{dot && <span className={`mt-0.5 h-1 rounded-full ${dot} ${on ? 'bg-white' : 'bg-emerald-600'}`} />}
            </button>
          ); })}</div>
        <p className="text-[11px] text-muted-foreground">Fuller dot = more open times · ringed = current day</p>
      </section>

      {day && <section className="space-y-3" aria-live="polite" aria-label="Times">
        <p className="text-sm font-bold">{format(parseISO(day), 'EEEE, MMMM d')}{who ? <span className="font-normal text-muted-foreground"> · {who.split(' ')[0]}</span> : null}</p>
        {!dayTimes ? <p className="text-sm text-muted-foreground">Checking…</p> : dayTimes.length === 0 ? <p className="rounded-xl bg-muted/30 p-3 text-sm">No open times that day — try another day, or another provider.</p>
          : groups.filter(([, l]) => l.length).map(([label, list]) => (
            <div key={label} className="space-y-1.5"><p className="text-xs text-muted-foreground">{label}</p>
              <div className="grid grid-cols-3 gap-2">{list.map((t) => <button key={t} type="button" onClick={() => choose(day, t)} aria-pressed={time === t && !custom} className={`h-10 rounded-xl border text-sm font-semibold transition active:scale-95 ${time === t && !custom ? 'border-primary bg-primary text-primary-foreground shadow' : 'bg-background hover:bg-muted/40'}`}>{clock(t)}{t === usualTime && <span className="ml-1 text-[10px] opacity-70">usual</span>}</button>)}</div></div>))}
      </section>}

      {reason && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{reason}</p>}
      <div className="space-y-1.5 rounded-xl border p-3"><p className="text-sm font-semibold">Who asked for this change?</p>
        <div className="flex gap-2">{([['client', 'The client'], ['studio', 'We did']] as const).map(([v, l]) => <Button key={v} type="button" size="sm" variant={initiatedBy === v ? 'default' : 'outline'} onClick={() => setInitiatedBy(v)}>{l}</Button>)}</div>
        {initiatedBy === 'studio' && <p className="text-xs text-muted-foreground">Our change: no reschedule fee, it doesn’t count toward their change limit, and their notice deadline starts from the new time.</p>}</div>
      {grace && initiatedBy === 'client' && <div className="space-y-1 rounded-xl border p-3"><p className="text-sm"><b>Grace allowance</b> · {grace.remaining} of {grace.allowance} left (every {grace.periodMonths} months) — no reschedule fee.</p>
        {grace.remaining > 0 ? (grace.canApply ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={graceOn} onChange={(ev) => setGraceOn(ev.target.checked)} /> Use grace for this</label> : <p className="text-xs text-muted-foreground">A manager approves grace for this.</p>) : <p className="text-xs text-muted-foreground">None left — the reschedule fee applies.</p>}</div>}
      {feeEligible && initiatedBy === 'client' && !graceOn && <label className="flex items-center justify-between gap-3 rounded-xl border p-3"><span className="text-sm"><b>Reschedule fee</b> — ${fee.toFixed(2)} (moved within {windowH} hours)</span><Switch checked={applyFee} onCheckedChange={setApplyFee} /></label>}
      <label className="flex items-center justify-between gap-3 rounded-xl border p-3"><span className="text-sm"><b>Tell {first}</b> — email + text with the new time</span><Switch checked={notify} onCheckedChange={setNotify} /></label>
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-2">
      {time && day && !override && <p className="text-center text-sm"><span className="text-muted-foreground">{format(original, 'EEE MMM d, h:mm a')} → </span><b>{format(parseISO(day), 'EEE MMM d')} · {clock(time)}</b>{who ? ` with ${who.split(' ')[0]}` : ''}</p>}
      {override ? <>
        <p className="text-center text-xs text-muted-foreground">As a manager you can move it anyway — it will be recorded.</p>
        <Button onClick={() => move(true)} disabled={busy} variant="destructive" className="h-12 w-full rounded-2xl font-bold">{busy ? <Loader className="h-5 w-5 animate-spin" /> : 'Move anyway'}</Button>
        <Button onClick={() => { setOverride(false); setReason(null); setTime(''); setCustom(''); }} variant="outline" className="h-11 w-full rounded-2xl">Pick another time</Button>
      </> : <Button onClick={() => move(false)} disabled={busy || !time || !day} className="h-12 w-full rounded-2xl text-base font-bold">{busy ? <Loader className="h-5 w-5 animate-spin" /> : time && day ? `Move ${first}` : 'Pick a day and time'}</Button>}
    </div>
  );

  return {
    toast, original, usualTime, today, staffId, setStaffId, providers, setProviders,
    slots, setSlots, loading, setLoading, fetched, month, setMonth, day,
    setDay, time, setTime, custom, setCustom, reason, setReason, override,
    setOverride, applyFee, setApplyFee, notify, setNotify, busy, setBusy, fee, initiatedBy, setInitiatedBy, grace, graceOn, setGraceOn,
    windowH, feeEligible, base, first, ensure, timesFor, suggestions, choose,
    move, cells, dayTimes, groups, who, body, footer, policyNote,
  };
}

export const RescheduleAppointmentDialog: React.FC<Props> = (props) => {
  const { open, onOpenChange, appointment, client, tenant, tenantId, isMobile = false, onRescheduled } = props;
  const {
    toast, original, usualTime, today, staffId, setStaffId, providers, setProviders,
    slots, setSlots, loading, setLoading, fetched, month, setMonth, day,
    setDay, time, setTime, custom, setCustom, reason, setReason, override,
    setOverride, applyFee, setApplyFee, notify, setNotify, busy, setBusy, fee, initiatedBy, setInitiatedBy, grace, graceOn, setGraceOn,
    windowH, feeEligible, base, first, ensure, timesFor, suggestions, choose,
    move, cells, dayTimes, groups, who, body, footer,
  } = useReschedule(props);
  if (isMobile) return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="max-h-[94vh] overflow-y-auto rounded-t-[2rem] p-5">
      <SheetHeader className="mb-3 text-left"><SheetTitle className="text-xl font-black">Reschedule {first}</SheetTitle></SheetHeader>{body}<SheetFooter className="sticky bottom-0 mt-5 bg-background pb-2 pt-3">{footer}</SheetFooter>
    </SheetContent></Sheet>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-[2rem] p-7 sm:max-w-lg">
      <DialogHeader className="mb-1"><DialogTitle className="text-2xl font-black">Reschedule {first}</DialogTitle></DialogHeader>{body}<DialogFooter className="mt-5">{footer}</DialogFooter>
    </DialogContent></Dialog>
  );
};

export default RescheduleAppointmentDialog;
