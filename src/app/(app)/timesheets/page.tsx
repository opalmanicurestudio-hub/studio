'use client';
// src/app/(app)/timesheets/page.tsx — HOURS (Team › Time, and /timesheets): the time clock's shifts for a week, worked
// out by the shared engine (lib/timeclock: overnight shifts kept, breaks from the punches, forgotten clock-outs flagged,
// rejected shifts not paid), against the schedule (lib/shift-check). What waits before payday covers the whole pay period
// the week is in (lib/pay-periods). Laid out by components/staff/TimesheetsScreen. For the owner and anyone whose role
// fixes and approves hours (time.approve: managers by default).
import React, { useState, useMemo, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Loader } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, writeBatch, query, where, updateDoc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { sessionsFrom, clockPolicy, localDay, zonedEpoch, weekOf, type Session } from '@/lib/timeclock';
import { usePunchesInRange } from '@/hooks/use-transactions';
import { dayCompare } from '@/lib/shift-check';
import { payRules } from '@/lib/pay-period';
import { periodOf } from '@/lib/pay-periods';
import { logAuditClient } from '@/lib/audit-client';
import { csvName, downloadCsv, type Cell } from '@/lib/csv';
import { getAuth } from 'firebase/auth';
import { TimesheetsScreen, ShiftDialog, type Shift, type PersonWeek, type Needs, type ClockFix } from '@/components/staff/TimesheetsScreen';

const DAY = 86400000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const NOTE: Record<string, string> = { late: 'Clocked in late', early: 'Clocked in early', noshift: 'Not on the schedule', left_early: 'Left early', stayed: 'Stayed late' };
/** A punch note ("late: 12 minutes after the shift") in words. */
const noteWords = (n: string) => n.replace(/^(\w+):\s*/, (_m, k: string) => (NOTE[k] ? `${NOTE[k]}: ` : ''));

export default function TimesheetsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, can } = useTenant();
  const { staff, isLoading: ctxLoading } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const tenant: any = selectedTenant || {};

  // The business's own days and workweek, whatever device the manager is on.
  const bizTz = tenant.timezone || 'America/New_York';
  const wso = tenant.workweekStartsOn === 0 ? 0 : 1;
  const time = useCallback((d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: bizTz }).format(d), [bizTz]);
  const hhmm = useCallback((d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: bizTz }).format(d), [bizTz]);
  const today = localDay(Date.now(), bizTz);
  const thisWeek = weekOf(today, wso);
  const [weekFrom, setWeekFrom] = useState(thisWeek);
  React.useEffect(() => { setWeekFrom((w) => weekOf(w, wso)); }, [wso]);
  const weekTo = addDays(weekFrom, 6);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)), [weekFrom]);
  // The pay period the week is in: what waits before its payday is looked at across all of it.
  const period = useMemo(() => periodOf(tenant, weekFrom), [tenant, weekFrom]);
  const spanFrom = period.from < weekFrom ? period.from : weekFrom, spanTo = period.to > weekTo ? period.to : weekTo;
  const punchFrom = useMemo(() => new Date(zonedEpoch(spanFrom, '00:00', bizTz)), [spanFrom, bizTz]);
  const punchTo = useMemo(() => new Date(zonedEpoch(addDays(spanTo, 1), '00:00', bizTz)), [spanTo, bizTz]);
  const { activityLogs, isLoading: punchLoading } = usePunchesInRange(punchFrom, punchTo);
  const isLoading = ctxLoading || punchLoading;
  const rules = payRules(tenant);

  // The published schedule for the week, compared with what was worked.
  const { data: weekShifts } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/shifts`), where('date', '>=', weekFrom), where('date', '<=', weekTo)) : null), [firestore, tenantId, weekFrom, weekTo]));
  // Forgotten clock-outs the person has said when they left (lib/clock-fix).
  const { data: fixList } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/clockFixes`), where('status', '==', 'pending')) : null), [firestore, tenantId]));
  const fixesAll: ClockFix[] = useMemo(() => (fixList || []).slice().sort((a: any, b: any) => String(a.inAt).localeCompare(String(b.inAt))).map((f: any) => ({ id: f.id, staffId: String(f.staffId || ''), staffName: String(f.staffName || 'Someone'), inAt: f.inAt, outAt: f.outAt, note: f.note || undefined, dayKey: localDay(Date.parse(f.inAt), bizTz) })), [fixList, bizTz]);
  const fixFor = useMemo(() => new Set(fixesAll.map((f) => `${f.id}`)), [fixesAll]);

  const team = useMemo(() => (staff || []).filter((m: any) => m.isRenter !== true && m.archived !== true), [staff]);
  // (Your own hours are fixed and approved by someone else, unless you're the owner: the rules and lib/clock-fix say so too.)
  const uid = getAuth().currentUser?.uid || '';
  const selfId = String((staff || []).find((m: any) => m.id === uid || m.authUid === uid)?.id || '');
  const isOwner = !!uid && uid === tenant.userId;
  const fixes = useMemo(() => fixesAll.filter((f) => isOwner || !selfId || f.staffId !== selfId), [fixesAll, isOwner, selfId]);
  const all = useMemo(() => (activityLogs ? sessionsFrom(activityLogs as any, clockPolicy(selectedTenant)) : []), [activityLogs, selectedTenant]);
  const latestIn = useMemo(() => { const m = new Map<string, string>(); for (const s of all) if (!m.get(s.staffId) || s.inAt > m.get(s.staffId)!) m.set(s.staffId, s.inAt); return m; }, [all]);
  const toShift = useCallback((x: Session): Shift => ({
    key: `${x.staffId}_${x.inAt}`, dayKey: x.localDate, inAt: new Date(x.inAt), outAt: x.outAt ? new Date(x.outAt) : null,
    breakMinutes: x.breakMinutes, paidBreakMinutes: x.paidBreakMinutes, workedMinutes: x.workedMinutes, hourlyMinutes: x.hourlyMinutes || 0,
    splitTime: !!(team.find((m: any) => m.id === x.staffId) as any)?.splitTime,
    status: x.missingOut ? 'pending' : x.status === 'approved' ? 'approved' : x.status === 'rejected' ? 'rejected' : x.status === 'active' || x.open ? 'active' : 'pending',
    missingOut: x.missingOut, outOfZone: !!x.geoWarnOnly, notes: [x.shiftNoteIn, x.shiftNoteOut].filter(Boolean).map((n) => noteWords(String(n))),
    managerNote: x.note || '', approvedBy: x.approvedBy || '',
    // (A shift the person asked to fix themselves waits in their request, above, not here.)
    canReview: !!x.inId && !(x.missingOut && fixFor.has(String(x.inId))) && (x.missingOut || !!x.outId) && (isOwner || !selfId || x.staffId !== selfId),
  }), [team, fixFor, isOwner, selfId]);
  const raw = useMemo(() => new Map(all.map((x) => [`${x.staffId}_${x.inAt}`, x])), [all]);

  const people: PersonWeek[] = useMemo(() => team.map((m: any) => {
    const contractor = m.employmentType === 'contractor';
    const mine = all.filter((x) => x.staffId === m.id && x.localDate >= weekFrom && x.localDate <= weekTo);
    const shiftsOf = (weekShifts || []).filter((x: any) => x.staffId === m.id);
    const days = weekDays.map((k) => { const cmp = dayCompare(k, shiftsOf, mine, selectedTenant); return { dayKey: k, workedMinutes: mine.filter((x) => x.localDate === k).reduce((n, x) => n + x.workedMinutes, 0), scheduledMinutes: cmp.scheduledMinutes, noShow: cmp.noShow, later: k > today }; });
    const worked = days.reduce((n, d) => n + d.workedMinutes, 0), scheduled = days.reduce((n, d) => n + d.scheduledMinutes, 0);
    const toCome = days.filter((d) => d.later).reduce((n, d) => n + d.scheduledMinutes, 0);
    const shifts = mine.map(toShift).sort((a, b) => a.inAt.getTime() - b.inAt.getTime());
    return { id: m.id, name: String(m.name || 'Team member'), contractor, days, shifts, workedMinutes: worked, scheduledMinutes: scheduled,
      overtimeMinutes: contractor ? 0 : Math.max(0, worked - rules.overtimeHours * 60), projectedOvertime: contractor ? 0 : Math.max(0, worked + toCome - rules.overtimeHours * 60),
      waiting: shifts.filter((s) => s.status === 'pending' && !s.missingOut && !!s.outAt).length, missing: shifts.filter((s) => s.missingOut).length, noShows: days.filter((d) => d.noShow).length };
  }).sort((a: PersonWeek, b: PersonWeek) => (b.missing + b.waiting) - (a.missing + a.waiting) || a.name.localeCompare(b.name)), [team, all, weekFrom, weekTo, weekDays, weekShifts, selectedTenant, today, rules.overtimeHours, toShift]);

  // What waits before payday, across the whole pay period.
  const needs: Needs = useMemo(() => {
    const inPeriod = all.filter((x) => x.localDate >= period.from && x.localDate <= period.to);
    const nameOf = (id: string) => String(team.find((m: any) => m.id === id)?.name || 'Someone');
    const onTeam = new Set(team.map((m: any) => m.id));
    const missing = inPeriod.filter((x) => x.missingOut && onTeam.has(x.staffId)).map((x) => ({ staffId: x.staffId, name: nameOf(x.staffId), shift: toShift(x) })).filter((m) => m.shift.canReview);
    const waitingBy = new Map<string, Shift[]>();
    for (const x of inPeriod) { if (!onTeam.has(x.staffId)) continue; const s = toShift(x); if (s.status === 'pending' && !s.missingOut && s.outAt && s.canReview) (waitingBy.get(x.staffId) || waitingBy.set(x.staffId, []).get(x.staffId)!).push(s); }
    const waiting = [...waitingBy.entries()].map(([staffId, shifts]) => ({ staffId, name: nameOf(staffId), shifts: shifts.sort((a, b) => a.inAt.getTime() - b.inAt.getTime()) }));
    const overtime = weekFrom === thisWeek ? people.filter((x) => x.projectedOvertime > 0 && x.overtimeMinutes === 0).map((x) => ({ staffId: x.id, name: x.name, projected: x.projectedOvertime, worked: x.workedMinutes, scheduled: x.days.filter((d) => d.later).reduce((n, d) => n + d.scheduledMinutes, 0) })) : [];
    return { missing, waiting, overtime };
  }, [all, period, team, toShift, people, weekFrom, thisWeek]);

  // ── Taps ──
  const [busy, setBusy] = useState(false);
  const [openShift, setOpenShift] = useState<{ staffId: string; name: string; shift: Shift } | null>(null);
  const [changing, setChanging] = useState(false); const [inTime, setInTime] = useState(''); const [outTime, setOutTime] = useState(''); const [note, setNote] = useState('');
  // (Who did it, by their name on the team: never their sign-in email, which the team would see.)
  const me = () => { const u = getAuth().currentUser; const m: any = (staff || []).find((x: any) => x.id === u?.uid || x.authUid === u?.uid);
    return { id: u?.uid || null, name: String(m?.name || (u?.uid && u.uid === tenant.userId ? 'The owner' : 'A manager')) }; };
  const tell = useCallback((staffId: string, type: string, message: string) => {
    if (!firestore || !tenantId) return Promise.resolve();
    const ref = doc(collection(firestore, `tenants/${tenantId}/notifications`));
    return writeBatch(firestore).set(ref, { id: ref.id, userId: staffId, type, message, link: '/staff-portal?tab=me', createdAt: new Date().toISOString(), read: false }).commit().catch(() => {});
  }, [firestore, tenantId]);
  const onOpen = (staffId: string, name: string, shift: Shift, change: boolean) => {
    setOpenShift({ staffId, name, shift }); setChanging(change); setNote(shift.managerNote || '');
    setInTime(hhmm(shift.inAt)); setOutTime(shift.outAt ? hhmm(shift.outAt) : '');
  };
  const dayWords = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  /** Approves shifts (each one's clock-out punch), saying who did and telling the person. */
  const approve = async (staffId: string, shifts: Shift[], withNote = '') => {
    if (!firestore || !tenantId) return;
    const ids = shifts.map((s) => raw.get(s.key)?.outId).filter(Boolean) as string[]; if (!ids.length) return;
    setBusy(true);
    try {
      const b = writeBatch(firestore); const now = new Date().toISOString(); const who = me();
      for (const id of ids) b.update(doc(firestore, `tenants/${tenantId}/activityLogs`, id), { timesheetStatus: 'approved', approvedBy: who.name, approvedById: who.id, approvedAt: now, ...(withNote ? { reviewNote: withNote } : {}) });
      await b.commit();
      const name = String(team.find((m: any) => m.id === staffId)?.name || 'Their');
      await tell(staffId, 'timesheet_approved', ids.length === 1 ? `Your shift on ${dayWords(shifts[0].dayKey)} is approved.` : `${ids.length} of your shifts are approved.`);
      toast({ title: ids.length === 1 ? 'Shift approved' : `${ids.length} shifts approved`, description: `${name.split(' ')[0]}’s hours count on payday.` });
      return true;
    } catch (e: any) { toast({ variant: 'destructive', title: 'Not approved', description: e?.code === 'permission-denied' ? 'Your role can’t approve hours.' : 'Nothing changed. Try again.' }); return false; }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (!firestore || !tenantId || !openShift) return;
    const outId = raw.get(openShift.shift.key)?.outId; if (!outId || !note.trim()) return;
    setBusy(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/activityLogs`, outId), { timesheetStatus: 'rejected', rejectedBy: me().name, rejectedAt: new Date().toISOString(), reviewNote: note.trim() });
      await tell(openShift.staffId, 'timesheet_rejected', `Your shift on ${dayWords(openShift.shift.dayKey)} wasn’t approved: “${note.trim()}”`);
      toast({ title: 'Not approved', description: `${openShift.name.split(' ')[0]} is told why. That shift isn’t paid.` });
      setOpenShift(null);
    } catch (e: any) { toast({ variant: 'destructive', title: 'Not saved', description: 'Nothing changed. Try again.' }); }
    finally { setBusy(false); }
  };
  // A manager's correction: moves the clock-in and clock-out to the times given (adds the clock-out when it was
  // forgotten), keeps the original times on each punch, and records who changed what. It waits for approval after.
  const save = async () => {
    if (!firestore || !tenantId || !openShift) return;
    const x = raw.get(openShift.shift.key); if (!x?.inId || !inTime || !outTime) return;
    const newIn = new Date(zonedEpoch(x.localDate, inTime, bizTz)); let newOut = new Date(zonedEpoch(x.localDate, outTime, bizTz));
    if (newOut <= newIn) newOut = new Date(newOut.getTime() + DAY);   // past midnight: the next day
    if (newOut.getTime() - newIn.getTime() > 18 * 3600000) { toast({ variant: 'destructive', title: 'Check the times', description: 'That shift would be over 18 hours.' }); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString(); const why = note.trim() || 'Changed by a manager'; const b = writeBatch(firestore);
      b.update(doc(firestore, `tenants/${tenantId}/activityLogs`, x.inId), { timestamp: newIn.toISOString(), managerEdited: true, editedAt: now, editNote: why, originalTimestamp: x.inAt });
      if (x.outId) b.update(doc(firestore, `tenants/${tenantId}/activityLogs`, x.outId), { timestamp: newOut.toISOString(), managerEdited: true, editedAt: now, editNote: why, timesheetStatus: 'pending', ...(x.outAt ? { originalTimestamp: x.outAt } : {}) });
      else { const ref = doc(collection(firestore, `tenants/${tenantId}/activityLogs`)); b.set(ref, { id: ref.id, staffId: x.staffId, type: 'clock_out', timestamp: newOut.toISOString(), addedByManager: true, editedAt: now, editNote: why, timesheetStatus: 'pending' }); }
      await b.commit();
      // (Still shown on the clock from the forgotten shift: cleared, when it's their latest. A role that can't change the
      // person's record leaves it; the time clock clears it at their next clock-in.)
      if (!x.outId && latestIn.get(x.staffId) === x.inAt) await updateDoc(doc(firestore, `tenants/${tenantId}/staff`, x.staffId), { active: false, onBreak: false, clockInTime: null, status: 'off' }).catch(() => {});
      void logAuditClient(firestore, tenantId, { action: 'timesheet.edited', targetType: 'staff', targetId: x.staffId, actor: { type: 'user', id: me().id || undefined },
        summary: `${openShift.name} ${dayWords(x.localDate)}: ${time(new Date(x.inAt))} to ${x.outAt ? time(new Date(x.outAt)) : 'no clock-out'} changed to ${time(newIn)} to ${time(newOut)} (${why})`,
        before: { in: x.inAt, out: x.outAt || null }, after: { in: newIn.toISOString(), out: newOut.toISOString() } } as any);
      toast({ title: 'Times saved', description: 'Approve the shift to finish.' });
      setOpenShift(null);
    } catch (e: any) { toast({ variant: 'destructive', title: 'Not saved', description: e?.code === 'permission-denied' ? 'Your role can’t change hours.' : 'Nothing changed. Try again.' }); }
    finally { setBusy(false); }
  };
  const decideFix = async (f: ClockFix, ok: boolean, out: string, why: string) => {
    if (!tenantId) return;
    let outAt = f.outAt;
    if (ok && out) { const day = localDay(Date.parse(f.inAt), bizTz); let t = zonedEpoch(day, out, bizTz); if (t <= Date.parse(f.inAt)) t += DAY; outAt = new Date(t).toISOString(); }
    setBusy(true);
    try {
      const r = await fetch('/api/timeclock/fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'decide', id: f.id, approve: ok, outAt, note: why }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
      toast(r.ok ? { title: ok ? 'Clock-out added' : 'Sent back', description: r.message } : { variant: 'destructive', title: 'Not saved', description: r.error });
    } finally { setBusy(false); }
  };
  const download = () => {
    const status: Record<string, string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved', active: 'On the clock' };
    const rows: Cell[][] = [['Person', 'Day', 'Clocked in', 'Clocked out', 'Break (minutes)', 'Paid break (minutes)', 'Hours worked', 'Status', 'Where', 'Note']];
    for (const x of people) for (const s of x.shifts) rows.push([x.name, s.dayKey, time(s.inAt), s.outAt ? time(s.outAt) : (s.missingOut ? 'No clock-out' : 'On the clock'), s.breakMinutes, s.paidBreakMinutes,
      Math.round((s.workedMinutes / 60) * 100) / 100, s.missingOut ? 'No clock-out' : status[s.status], s.outOfZone ? 'Away from the business' : 'At the business', s.managerNote || '']);
    downloadCsv(csvName(String(tenant.name || ''), 'hours', weekFrom), rows);
  };

  // (The owner, and anyone whose role fixes and approves time clock hours: managers by default.)
  if (!can('time.approve')) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <AppHeader title="Timesheets" />
        <main className="flex flex-1 items-center justify-center px-6">
          <p className="max-w-sm text-center text-[15px] text-muted-foreground">Fixing and approving hours is for the owner and people whose role includes it.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden" style={{ background: '#f5f5f7' }}>
      <AppHeader title="Timesheets" />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-5 md:px-6">
        {isLoading ? <div className="flex min-h-[40vh] items-center justify-center"><Loader className="h-7 w-7 animate-spin" style={{ color: '#6d7075' }} aria-label="Getting the hours" /></div> : (
          <TimesheetsScreen weekFrom={weekFrom} weekTo={weekTo} isThisWeek={weekFrom === thisWeek} onWeek={(n) => setWeekFrom(addDays(weekFrom, n * 7))} onThisWeek={() => setWeekFrom(thisWeek)}
            period={period} people={people} needs={needs} fixes={fixes} time={time} busy={busy}
            onApprove={(id, shifts) => { void approve(id, shifts); }} onDecideFix={decideFix} onOpen={onOpen} onDownload={download} />
        )}
      </main>
      <ShiftDialog open={!!openShift} onOpenChange={(o) => { if (!o) setOpenShift(null); }} name={openShift?.name || ''} shift={openShift?.shift || null}
        changing={changing} onChanging={setChanging} inTime={inTime} outTime={outTime} onInTime={setInTime} onOutTime={setOutTime} note={note} onNote={setNote} busy={busy} time={time}
        onApprove={async () => { if (openShift && await approve(openShift.staffId, [openShift.shift], note.trim())) setOpenShift(null); }} onReject={reject} onSave={save} />
    </div>
  );
}
