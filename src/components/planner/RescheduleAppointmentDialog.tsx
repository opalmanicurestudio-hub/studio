'use client';
/**
 * components/planner/RescheduleAppointmentDialog.tsx
 *
 * A reschedule MOVES the same appointment to a new time (not a cancel +
 * rebook — no cancellation count, no refund/re-collect of the deposit).
 *
 * v2 (5c) — CHECKED LIKE A BOOKING. The dialog used to write any time straight
 * to the database: outside hours, on a day off, on top of another booking.
 * Now every step goes through /api/appointments/reschedule, which uses the
 * same availability engine and time frame as online booking:
 *   • pick a day → that day's open times for the provider
 *   • "Another time" → checked live, with a plain reason if it won't work
 *     ("Clashes with Maria Lopez's Gel manicure at 2:00 pm", "Outside
 *     Jessica's hours that day (9:00 am – 5:00 pm)", "Jessica has the day off")
 *   • managers can "Move anyway" — recorded with the reason it broke the rules
 * The server keeps what this dialog used to do (reschedule fee inside the
 * window, reschedule counts, history) and adds: the check-in copy is updated,
 * the move is in the activity log, and the client is told by email + text.
 * The "fill the freed slot" follow-up still runs from here afterwards.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { format, differenceInHours, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CalendarClock, Loader } from 'lucide-react';
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
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };

interface RescheduleAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: any;
  client?: any;
  tenant?: any;
  tenantId?: string;
  actorName?: string;
  actorId?: string;
  isMobile?: boolean;
  onRescheduled?: (newStartIso: string) => void;
}

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/appointments/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ...(d || {}) };
}

export const RescheduleAppointmentDialog: React.FC<RescheduleAppointmentDialogProps> = ({
  open, onOpenChange, appointment, client, tenant, tenantId, isMobile = false, onRescheduled,
}) => {
  const { toast } = useToast();
  const originalStart = useMemo(() => safeDate(appointment?.startTime), [appointment]);
  const [day, setDay] = useState(''); const [times, setTimes] = useState<string[]>([]); const [loadingTimes, setLoadingTimes] = useState(false);
  const [time, setTime] = useState(''); const [custom, setCustom] = useState(''); const [reason, setReason] = useState<string | null>(null);
  const [applyFee, setApplyFee] = useState(true); const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false); const [override, setOverride] = useState<{ reason: string } | null>(null);
  const rescheduleFee = Number(tenant?.rescheduleFee || 0), windowH = Number(tenant?.rescheduleFeeWindowHours || 0);
  const feeEligible = rescheduleFee > 0 && windowH > 0 && differenceInHours(originalStart, new Date()) < windowH;
  const base = { tenantId, appointmentId: appointment?.id };

  useEffect(() => { if (open) { setDay(format(originalStart, 'yyyy-MM-dd')); setTime(''); setCustom(''); setReason(null); setOverride(null); setApplyFee(true); setNotify(true); } }, [open, originalStart]);
  useEffect(() => { // that day's open times
    if (!open || !day || !tenantId || !appointment?.id) return; let stale = false;
    setLoadingTimes(true); setTime(''); setReason(null); setOverride(null);
    api({ ...base, action: 'check', date: day }).then((d) => { if (!stale) setTimes(d.ok ? d.times || [] : []); }).finally(() => { if (!stale) setLoadingTimes(false); });
    return () => { stale = true; };
  }, [open, day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // "Another time" — checked live
    if (!custom || !/^\d{2}:\d{2}$/.test(custom)) return; let stale = false;
    const h = setTimeout(() => api({ ...base, action: 'check', date: day, time: custom }).then((d) => { if (!stale) { setTime(custom); setReason(d.ok ? d.reason || null : d.error || 'Couldn’t check that time.'); setOverride(null); } }), 300);
    return () => { stale = true; clearTimeout(h); };
  }, [custom, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (force = false) => {
    if (!time || busy) return; setBusy(true);
    try {
      const d = await api({ ...base, action: 'move', date: day, time, applyFee: feeEligible && applyFee, notify, override: force });
      if (!d.ok) {
        if (d.canOverride) { setOverride({ reason: d.error }); setReason(d.error); }
        else toast({ variant: 'destructive', title: 'Couldn’t move it', description: d.error || 'Please try another time.' });
        return;
      }
      fetch('/api/opal/recovery-spawn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: appointment.id, resolutionTicketId: d.auditId, clientId: client?.id || appointment.clientId, eventType: 'reschedule', vacatedSlotStart: appointment.startTime, vacatedSlotEnd: appointment.endTime, locationId: appointment.locationId || null }) }).catch(() => {});
      const told = [d.told?.email && 'email', d.told?.sms && 'text'].filter(Boolean).join(' + ');
      toast({ title: 'Appointment moved', description: `${format(safeDate(d.startTime), 'EEE MMM d, h:mm a')}${d.feeApplied ? ` · $${Number(d.feeApplied).toFixed(2)} fee added` : ''}${notify ? (told ? ` · client told by ${told}` : ' · client couldn’t be messaged (no contact details or messaging off)') : ''}${d.overrode ? ' · moved outside the rules (recorded)' : ''}` });
      onRescheduled?.(d.startTime); onOpenChange(false);
    } finally { setBusy(false); }
  };

  const chip = (on: boolean) => `h-11 rounded-xl border-2 text-sm font-bold transition ${on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/40'}`;
  const body = (
    <div className="space-y-5 px-1">
      <div className="flex items-center gap-3 rounded-2xl border-2 bg-muted/5 p-4">
        <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0"><p className="text-xs text-muted-foreground">Currently</p><p className="truncate text-sm font-black">{format(originalStart, 'EEE MMM d, h:mm a')}</p><p className="text-xs text-muted-foreground">{appointment?.serviceName || 'Service'}{appointment?.staffName ? ` · ${appointment.staffName}` : ''}</p></div>
      </div>
      <label className="block space-y-1.5"><span className="text-sm font-bold">Day</span>
        <input type="date" value={day} min={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => { setDay(e.target.value); setCustom(''); }} className="h-12 w-full rounded-xl border-2 px-3 text-base" /></label>
      <div className="space-y-2" aria-live="polite">
        <p className="text-sm font-bold">Open times</p>
        {loadingTimes ? <p className="text-sm text-muted-foreground">Checking…</p>
          : times.length === 0 ? <p className="rounded-xl bg-muted/30 p-3 text-sm">No open times for {appointment?.staffName?.split(' ')[0] || 'this provider'} that day — try another day, or choose another time below to see why.</p>
          : <div className="grid grid-cols-3 gap-2">{times.map((t) => <button key={t} type="button" onClick={() => { setTime(t); setCustom(''); setReason(null); setOverride(null); }} aria-pressed={time === t && !custom} className={chip(time === t && !custom)}>{clock(t)}</button>)}</div>}
      </div>
      <label className="block space-y-1.5"><span className="text-sm font-bold">Another time</span>
        <input type="time" step={300} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-12 w-full rounded-xl border-2 px-3 text-base" /></label>
      {reason && <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{reason}</p>}
      {feeEligible && <label className="flex items-center justify-between gap-3 rounded-xl border-2 p-3"><span className="text-sm"><b>Reschedule fee</b> — ${rescheduleFee.toFixed(2)} (moved within {windowH} hours)</span><Switch checked={applyFee} onCheckedChange={setApplyFee} /></label>}
      <label className="flex items-center justify-between gap-3 rounded-xl border-2 p-3"><span className="text-sm"><b>Tell the client</b> — email + text with the new time</span><Switch checked={notify} onCheckedChange={setNotify} /></label>
    </div>
  );
  const footer = (
    <div className="flex w-full flex-col gap-2">
      {override ? <>
        <p className="text-center text-xs text-muted-foreground">As a manager you can move it anyway — it will be recorded.</p>
        <Button onClick={() => move(true)} disabled={busy} variant="destructive" className="h-12 w-full rounded-2xl font-black">{busy ? <Loader className="h-5 w-5 animate-spin" /> : 'Move anyway'}</Button>
        <Button onClick={() => { setOverride(null); setReason(null); setTime(''); setCustom(''); }} variant="outline" className="h-11 w-full rounded-2xl">Pick another time</Button>
      </> : (
        <Button onClick={() => move(false)} disabled={busy || !time || (!!reason && !custom)} className="h-12 w-full rounded-2xl text-base font-black">
          {busy ? <Loader className="h-5 w-5 animate-spin" /> : time ? `Move to ${format(parseISO(`${day}T${time}`), 'EEE MMM d')} at ${clock(time)}` : 'Pick a time'}
        </Button>
      )}
    </div>
  );
  if (isMobile) return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-[2rem] p-6">
      <SheetHeader className="mb-4 text-left"><SheetTitle className="text-xl font-black">Reschedule</SheetTitle></SheetHeader>{body}<SheetFooter className="mt-6">{footer}</SheetFooter>
    </SheetContent></Sheet>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-[2rem] p-8 sm:max-w-md">
      <DialogHeader className="mb-2"><DialogTitle className="text-2xl font-black">Reschedule</DialogTitle></DialogHeader>{body}<DialogFooter className="mt-6">{footer}</DialogFooter>
    </DialogContent></Dialog>
  );
};
export default RescheduleAppointmentDialog;
