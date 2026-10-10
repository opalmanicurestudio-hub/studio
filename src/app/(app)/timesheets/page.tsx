'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Clock, CheckCircle2, XCircle, AlertTriangle, ChevronLeft, ChevronRight,
  Loader, Users, Timer, TrendingUp, Shield, MapPin, Download, Edit, Coffee,
  DollarSign, Info
} from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays,
  parseISO, differenceInMinutes, isSameDay, eachDayOfInterval, startOfDay, endOfDay
} from 'date-fns';
import { cn, safeNumber } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { sessionsFrom, clockPolicy, localDay, zonedEpoch } from '@/lib/timeclock';
import { dayCompare } from '@/lib/shift-check';
import { logAuditClient } from '@/lib/audit-client';
import { getAuth } from 'firebase/auth';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const formatDuration = (minutes: number) => {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${h}h ${m}m`;
};

export default function TimesheetsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { staff, activityLogs, isLoading } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const wso = ((selectedTenant as any)?.workweekStartsOn === 0 ? 0 : 1) as 0 | 1;
  // Times shown and edited in the BUSINESS's time zone, whatever device the manager is on.
  const bizTz = (selectedTenant as any)?.timezone || 'America/New_York';
  const tHM = (d: Date | null | undefined, h24 = false) => (d ? new Intl.DateTimeFormat(h24 ? 'en-GB' : 'en-US', { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !h24, timeZone: bizTz }).format(d) : '');   // the business's workweek (Settings)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  React.useEffect(() => { setWeekStart((w) => startOfWeek(w, { weekStartsOn: wso })); }, [wso]);
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: wso });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const overtimeThreshold = safeNumber(selectedTenant?.overtimeThresholdHours) || 40;
  const paidBreakMinutes = safeNumber(selectedTenant?.paidBreakMinutes) || 0;

  // The published schedule for this week — compared with what was worked (lib/shift-check).
  const wkFrom = format(weekStart, 'yyyy-MM-dd'), wkTo = format(weekEnd, 'yyyy-MM-dd');
  const { data: weekShifts } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/shifts`), where('date', '>=', wkFrom), where('date', '<=', wkTo)) : null), [firestore, tenantId, wkFrom, wkTo]));

  const timesheets = useMemo(() => {
    if (!staff || !activityLogs) return [];
    // Sessions from the shared time clock engine (lib/timeclock): overnight shifts kept, forgotten clock-outs flagged,
    // breaks worked out from the punches, rejected sessions not paid.
    const all = sessionsFrom(activityLogs as any, clockPolicy(selectedTenant));
    return staff.filter((m: any) => m.isRenter !== true && m.archived !== true).map(member => {
      const mine = all.filter((x) => x.staffId === member.id);
      const latestIn = mine.length ? mine[mine.length - 1].inAt : '';
      const days = weekDays.map(day => {
        const key = format(day, 'yyyy-MM-dd');
        const sessions = mine.filter((x) => x.localDate === key).map((x) => ({
          clockIn: new Date(x.inAt), clockOut: x.outAt ? new Date(x.outAt) : null, breakMinutes: x.breakMinutes, paidBreakMins: x.paidBreakMinutes,
          workedMinutes: x.workedMinutes, geoVerified: x.geoVerified, geoWarnOnly: x.geoWarnOnly, status: x.status, logId: x.outId || null, inId: x.inId || null,
          missingOut: x.missingOut, isLatest: x.inAt === latestIn, localDate: x.localDate, shiftNoteIn: x.shiftNoteIn || null, shiftNoteOut: x.shiftNoteOut || null, managerNote: x.note || '', approvedBy: x.approvedBy || '', staffId: member.id,
        }));
        const totalMinutes = sessions.reduce((sum, s) => sum + s.workedMinutes, 0);
        const cmp = dayCompare(key, (weekShifts || []).filter((x: any) => x.staffId === member.id), mine, selectedTenant);
        return { date: day, sessions, totalMinutes, scheduledMinutes: cmp.scheduledMinutes, shiftLabel: cmp.shiftLabel, noShow: cmp.noShow };
      });

      const totalWeekMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);
      const scheduledWeekMinutes = days.reduce((sum, d: any) => sum + (d.scheduledMinutes || 0), 0);
      // On track for overtime? What's been worked plus the shifts still to come this week.
      const todayKey = format(new Date(), 'yyyy-MM-dd');
      const projectedMinutes = totalWeekMinutes + days.filter((d: any) => format(d.date, 'yyyy-MM-dd') > todayKey).reduce((sum, d: any) => sum + (d.scheduledMinutes || 0), 0);
      const projectedOvertime = Math.max(0, projectedMinutes - overtimeThreshold * 60);
      const noShows = days.filter((d: any) => d.noShow).length;
      const overtimeMinutes = Math.max(0, totalWeekMinutes - overtimeThreshold * 60);
      const regularMinutes = totalWeekMinutes - overtimeMinutes;
      const multiplier = safeNumber(selectedTenant?.overtimeMultiplier) || 1.5;

      let estimatedPay = 0;
      if (member.payStructure === 'hourly' && member.hourlyRate) {
        estimatedPay = (regularMinutes / 60) * member.hourlyRate
          + (overtimeMinutes / 60) * member.hourlyRate * multiplier;
      }

      const pendingCount = days.reduce((sum, d) =>
        sum + d.sessions.filter(s => s.status === 'pending' && s.clockOut).length, 0);
      const missingCount = days.reduce((sum, d) => sum + d.sessions.filter((s: any) => s.missingOut).length, 0);

      return {
        member, days, totalWeekMinutes,
        totalWeekHours: totalWeekMinutes / 60,
        overtimeMinutes, regularMinutes, estimatedPay,
        hasUnapproved: pendingCount > 0, pendingCount, missingCount, scheduledWeekMinutes, projectedOvertime, noShows
      };
    });
  }, [staff, activityLogs, weekStart, weekEnd, overtimeThreshold, paidBreakMinutes, selectedTenant, weekShifts]);

  // Send notification to staff member
  const sendStaffNotification = useCallback(async (staffId: string, type: string, message: string, link: string) => {
    if (!firestore || !tenantId) return;
    const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
    await setDocumentNonBlocking(notifRef, {
      id: notifRef.id,
      userId: staffId,
      type,
      message,
      link: link || '/timesheets',
      createdAt: new Date().toISOString(),
      read: false,
    }, {});
  }, [firestore, tenantId]);

  const handleApprove = async (session: any) => {
    if (!firestore || !tenantId) return;
    setIsProcessing(true);
    try {
      await updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/activityLogs`, session.logId),
        {
          timesheetStatus: 'approved',
          approvedBy: 'manager',
          approvedAt: new Date().toISOString(),
          reviewNote,
        }
      );
      // Notify staff
      await sendStaffNotification(
        session.staffId,
        'timesheet_approved',
        `Your timesheet session on ${format(session.clockIn, 'MMM d')} has been approved.`,
        '/timesheets'
      );
      toast({ title: 'Session Approved' });
      setIsReviewOpen(false);
      setReviewNote('');
      setIsEditing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (session: any) => {
    if (!reviewNote.trim()) {
      toast({ variant: 'destructive', title: 'Note Required', description: 'Explain the reason for rejection.' });
      return;
    }
    if (!firestore || !tenantId) return;
    setIsProcessing(true);
    try {
      await updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/activityLogs`, session.logId),
        {
          timesheetStatus: 'rejected',
          rejectedBy: 'manager',
          rejectedAt: new Date().toISOString(),
          reviewNote,
        }
      );
      // Notify staff
      await sendStaffNotification(
        session.staffId,
        'timesheet_rejected',
        `Your timesheet session on ${format(session.clockIn, 'MMM d')} was flagged for review: "${reviewNote}"`,
        '/timesheets'
      );
      toast({ title: 'Session Rejected', variant: 'destructive' });
      setIsReviewOpen(false);
      setReviewNote('');
      setIsEditing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  // Manager correction: moves the clock-in punch and the clock-out punch to the times given (adds the clock-out when it
  // was forgotten), keeps the original times on each punch, and records who changed what in the audit log.
  const handleSaveEdit = async (session: any) => {
    if (!firestore || !tenantId || !session?.inId) return;
    if (!editClockIn || !editClockOut) {
      toast({ variant: 'destructive', title: 'Both times needed', description: 'Put in the clock-in and clock-out times.' });
      return;
    }
    const baseDate = session.localDate || localDay(session.clockIn.getTime(), bizTz);
    const newClockIn = new Date(zonedEpoch(baseDate, editClockIn, bizTz));
    let newClockOut = new Date(zonedEpoch(baseDate, editClockOut, bizTz));
    if (newClockOut <= newClockIn) newClockOut = new Date(newClockOut.getTime() + 86400000);   // past midnight: the next day
    if (newClockOut.getTime() - newClockIn.getTime() > 18 * 3600000) {
      toast({ variant: 'destructive', title: 'Check the times', description: 'That shift would be over 18 hours.' });
      return;
    }
    setIsProcessing(true);
    try {
      const now = new Date().toISOString(); const note = reviewNote || 'Manager correction';
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/activityLogs`, session.inId), {
        timestamp: newClockIn.toISOString(), managerEdited: true, editedAt: now, editNote: note,
        ...(session.clockIn ? { originalTimestamp: (session as any).originalIn || session.clockIn.toISOString() } : {}),
      });
      if (session.logId) {
        batch.update(doc(firestore, `tenants/${tenantId}/activityLogs`, session.logId), {
          timestamp: newClockOut.toISOString(), managerEdited: true, editedAt: now, editNote: note, timesheetStatus: 'pending',
          ...(session.clockOut ? { originalTimestamp: session.clockOut.toISOString() } : {}),
        });
      } else {
        const ref = doc(collection(firestore, `tenants/${tenantId}/activityLogs`));
        batch.set(ref, { id: ref.id, staffId: session.staffId, type: 'clock_out', timestamp: newClockOut.toISOString(), addedByManager: true, editedAt: now, editNote: note, timesheetStatus: 'pending' });
        // The person still shows as on the clock from the forgotten shift — clear it (only when it's their latest one).
        if (session.isLatest) batch.update(doc(firestore, `tenants/${tenantId}/staff`, session.staffId), { active: false, onBreak: false, clockInTime: null, status: 'off' });
      }
      await batch.commit();
      const hm = (d: Date | null) => (d ? tHM(d) : 'no clock-out');
      void logAuditClient(firestore, tenantId, { action: 'timesheet.edited', targetType: 'staff', targetId: session.staffId, actor: { type: 'user', id: getAuth().currentUser?.uid },
        summary: `${session.staffName || 'Team member'} ${format(session.clockIn, 'EEE MMM d')}: ${hm(session.clockIn)}–${hm(session.clockOut)} changed to ${hm(newClockIn)}–${hm(newClockOut)}${note ? ` (${note})` : ''}`,
        before: { in: session.clockIn?.toISOString(), out: session.clockOut?.toISOString() || null }, after: { in: newClockIn.toISOString(), out: newClockOut.toISOString() } } as any);
      toast({ title: 'Times corrected', description: 'Review and approve to finish.' });
      setIsEditing(false); setIsReviewOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Couldn’t save', description: e?.message || 'Try again.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveAll = async (tsData: any) => {
    if (!firestore || !tenantId) return;
    setIsProcessing(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    tsData.days.forEach((day: any) => {
      day.sessions.forEach((session: any) => {
        if (session.status === 'pending' && session.logId && session.clockOut) {
          batch.update(
            doc(firestore, `tenants/${tenantId}/activityLogs`, session.logId),
            { timesheetStatus: 'approved', approvedBy: getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Manager', approvedById: getAuth().currentUser?.uid || null, approvedAt: now }
          );
        }
      });
    });
    try {
      await batch.commit();
      // Notify staff member
      await sendStaffNotification(
        tsData.member.id,
        'timesheet_approved',
        `All timesheet sessions for the week of ${format(weekStart, 'MMM d')} have been approved.`,
        '/timesheets'
      );
      toast({ title: 'All Sessions Approved', description: `${tsData.member.name}'s week approved.` });
    } finally {
      setIsProcessing(false);
    }
  };

  const exportCSV = () => {
    const rows = [['Staff', 'Date', 'Clock In', 'Clock Out', 'Break (min)', 'Paid Break (min)', 'Hours Worked', 'Overtime', 'Status', 'Geo Verified', 'Manager Note']];
    timesheets.forEach(ts => {
      ts.days.forEach(day => {
        day.sessions.forEach((session: any) => {
          rows.push([
            ts.member.name,
            format(day.date, 'yyyy-MM-dd'),
            session.clockIn ? tHM(session.clockIn, true) : '',
            session.clockOut ? tHM(session.clockOut, true) : 'Active',
            String(session.breakMinutes),
            String(session.paidBreakMins),
            (session.workedMinutes / 60).toFixed(2),
            session.overtimeMinutes ? (session.overtimeMinutes / 60).toFixed(2) : '0',
            session.status,
            session.geoVerified ? 'Yes' : (session.geoWarnOnly ? 'Warn' : 'No'),
            session.managerNote || '',
          ]);
        });
      });
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheets_${format(weekStart, 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const openReview = (session: any, staffId: string, staffName: string) => {
    setSelectedEntry({ ...session, staffId, staffName });
    setReviewNote(session.managerNote || '');
    setIsEditing(false);
    setEditClockIn(session.clockIn ? tHM(session.clockIn, true) : '');
    setEditClockOut(session.clockOut ? tHM(session.clockOut, true) : '');
    setIsReviewOpen(true);
  };

  if (role !== 'owner' && role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50/50">
        <AppHeader title="Timesheets" />
        <main className="flex-1 flex items-center justify-center">
          <p className="font-black uppercase text-muted-foreground opacity-40">Access Restricted</p>
        </main>
      </div>
    );
  }

  if (isLoading) return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="Timesheets" />
      <main className="flex-1 flex items-center justify-center"><Loader className="h-8 w-8 animate-spin text-primary" /></main>
    </div>
  );

  const totalUnapproved = timesheets.reduce((sum, ts) => sum + ts.pendingCount, 0);
  const totalWeekHours = timesheets.reduce((sum, ts) => sum + ts.totalWeekHours, 0);
  const totalOvertimeHours = timesheets.reduce((sum, ts) => sum + ts.overtimeMinutes / 60, 0);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="Timesheets" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Timesheets</h1>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Weekly review & approval</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {paidBreakMinutes > 0 && (
              <Badge className="h-8 px-4 rounded-2xl font-black uppercase text-[9px] bg-green-100 text-green-700 border-none gap-1.5">
                <Coffee className="w-3 h-3" /> First {paidBreakMinutes}min Break is Paid
              </Badge>
            )}
            {totalUnapproved > 0 && (
              <Badge variant="destructive" className="h-8 px-4 rounded-2xl font-black uppercase text-[10px] animate-pulse">
                {totalUnapproved} Pending Review
              </Badge>
            )}
            <Button variant="outline" onClick={exportCSV} className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Week nav */}
        <div className="flex items-center gap-4 p-4 bg-white rounded-[2rem] border-2 shadow-sm w-fit">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronLeft className="w-5 h-5" /></Button>
          <div className="text-center min-w-[200px]">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Pay Week</p>
            <p className="font-black text-sm uppercase tracking-tight">{format(weekStart, 'MMM d')} -- {format(weekEnd, 'MMM d, yyyy')}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronRight className="w-5 h-5" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: wso }))} className="h-9 px-4 rounded-xl font-black uppercase text-[9px] border-2">This Week</Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Staff', value: String(timesheets.length), icon: Users, color: 'text-primary' },
            { label: 'Total Hours', value: `${totalWeekHours.toFixed(1)}h`, icon: Clock, color: 'text-blue-600' },
            { label: 'Overtime Hours', value: `${totalOvertimeHours.toFixed(1)}h`, icon: AlertTriangle, color: totalOvertimeHours > 0 ? 'text-amber-600' : 'text-muted-foreground' },
            { label: 'Pending Approval', value: String(totalUnapproved), icon: Shield, color: totalUnapproved > 0 ? 'text-destructive' : 'text-green-600' },
          ].map(kpi => (
            <Card key={kpi.label} className="border-2 rounded-[2rem] shadow-sm bg-white">
              <CardContent className="p-5 flex items-center gap-4">
                <div className={cn("p-3 rounded-2xl bg-muted/20", kpi.color)}><kpi.icon className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{kpi.label}</p>
                  <p className={cn("text-2xl font-black tracking-tighter font-mono", kpi.color)}>{kpi.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Per-staff timesheets */}
        <div className="space-y-6">
          {timesheets.map(ts => (
            <Card key={ts.member.id} className={cn("border-2 rounded-[2rem] shadow-sm overflow-hidden bg-white", ts.hasUnapproved && "border-amber-300 shadow-amber-100")}>
              <CardHeader className="p-5 md:p-6 border-b bg-muted/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12 rounded-2xl border-2 shadow-sm">
                      <AvatarFallback className="font-black bg-primary/10 text-primary text-sm">{ts.member.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-black uppercase tracking-tight text-slate-900">{ts.member.name}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{ts.member.role} -- {ts.member.payStructure || 'commission'}</p>
                        {paidBreakMinutes > 0 && (
                          <Badge className="bg-green-100 text-green-700 border-none font-black text-[8px] uppercase h-4 px-1.5">
                            <Coffee className="w-2.5 h-2.5 mr-1" />{paidBreakMinutes}m paid break
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Week Total</p>
                      <p className="font-black text-lg font-mono text-primary">{formatDuration(ts.totalWeekMinutes)}</p>
                    </div>
                    {(ts as any).scheduledWeekMinutes > 0 && (
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Scheduled</p>
                        <p className="font-black text-lg font-mono text-slate-500">{formatDuration((ts as any).scheduledWeekMinutes)}</p>
                      </div>
                    )}
                    {(ts as any).projectedOvertime > 0 && ts.overtimeMinutes === 0 && (
                      <Badge className="bg-amber-50 text-amber-800 border-none text-[11px] font-semibold normal-case">
                        <AlertTriangle className="w-3 h-3 mr-1" /> On track for {formatDuration((ts as any).projectedOvertime)} overtime this week
                      </Badge>
                    )}
                    {(ts as any).noShows > 0 && (
                      <Badge className="bg-destructive/10 text-destructive border-none text-[11px] font-semibold normal-case">{(ts as any).noShows} shift{(ts as any).noShows === 1 ? '' : 's'} with no clock-in</Badge>
                    )}
                    {ts.overtimeMinutes > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 border-none font-black text-[9px] uppercase">
                        <AlertTriangle className="w-3 h-3 mr-1" /> OT: {formatDuration(ts.overtimeMinutes)}
                      </Badge>
                    )}
                    {ts.member.payStructure === 'hourly' && ts.estimatedPay > 0 && (
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Est. Pay</p>
                        <p className="font-black text-sm font-mono text-green-600">${ts.estimatedPay.toFixed(2)}</p>
                      </div>
                    )}
                    {ts.hasUnapproved && (
                      <Button size="sm" onClick={() => handleApproveAll(ts)} disabled={isProcessing} className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-lg shadow-primary/20">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve All
                      </Button>
                    )}
                    {!ts.hasUnapproved && ts.totalWeekMinutes > 0 && (
                      <Badge className="bg-green-100 text-green-700 border-none font-black text-[9px] uppercase h-7 px-3">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> All Approved
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {/* Day grid */}
                <div className="grid grid-cols-7 divide-x border-b">
                  {ts.days.map(day => (
                    <div key={day.date.toISOString()} className={cn("p-3 text-center", isSameDay(day.date, new Date()) && "bg-primary/5")}>
                      <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">{format(day.date, 'EEE')}</p>
                      <p className={cn("font-black text-sm", isSameDay(day.date, new Date()) ? "text-primary" : "text-slate-900")}>{format(day.date, 'd')}</p>
                      <p className="text-[10px] font-black font-mono text-primary mt-1">{day.totalMinutes > 0 ? formatDuration(day.totalMinutes) : '--'}</p>
                      {(day as any).scheduledMinutes > 0 && <p className={cn("text-[10px] font-mono", (day as any).noShow ? "font-black text-destructive" : "text-muted-foreground")}>{(day as any).noShow ? 'no-show' : `of ${formatDuration((day as any).scheduledMinutes)}`}</p>}
                    </div>
                  ))}
                </div>

                {/* Session rows */}
                <div className="divide-y">
                  {ts.days.map(day =>
                    day.sessions.map((session: any, idx: number) => (
                      <div key={`${day.date.toISOString()}-${idx}`} className="flex items-center justify-between px-5 py-3 hover:bg-muted/10 transition-colors gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn("w-2 h-2 rounded-full shrink-0",
                            session.status === 'approved' ? "bg-green-500"
                            : session.status === 'rejected' ? "bg-destructive"
                            : session.status === 'active' ? "bg-primary animate-pulse"
                            : session.missingOut ? "bg-destructive"
                            : "bg-amber-400"
                          )} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-black uppercase text-slate-900">{format(day.date, 'EEE, MMM d')}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                              {tHM(session.clockIn)} -- {session.clockOut ? tHM(session.clockOut) : session.missingOut ? 'no clock-out' : 'Active'}
                              {session.breakMinutes > 0 && ` (${session.breakMinutes}m break`}
                              {session.paidBreakMins > 0 && `, ${session.paidBreakMins}m paid`}
                              {session.breakMinutes > 0 && ')'}
                            </p>
                            {(session.shiftNoteIn || session.shiftNoteOut) && (
                              <p className="text-[11px] font-semibold text-amber-700">{[session.shiftNoteIn, session.shiftNoteOut].filter(Boolean).map((n: string) => n.replace(/^(\w+):\s*/, (_m: string, k: string) => ({ late: 'Late — ', early: 'Early — ', noshift: '', left_early: 'Left early — ', stayed: 'Stayed — ' } as any)[k] ?? '')).join(' · ')}</p>
                            )}
                            {session.approvedBy && (
                              <p className="text-[8px] font-black uppercase text-primary/60">Approved by {session.approvedBy}</p>
                            )}
                            {session.managerNote && (
                              <p className="text-[8px] font-bold text-muted-foreground italic truncate max-w-[200px]">"{session.managerNote}"</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {session.geoVerified && <Badge className="bg-green-50 text-green-700 border-none font-black text-[8px] uppercase h-5 px-2"><MapPin className="w-2.5 h-2.5 mr-1" />Verified</Badge>}
                          {session.geoWarnOnly && <Badge className="bg-amber-50 text-amber-700 border-none font-black text-[8px] uppercase h-5 px-2"><MapPin className="w-2.5 h-2.5 mr-1" />Out of Zone</Badge>}
                          <p className="font-black text-sm font-mono text-primary">{formatDuration(session.workedMinutes)}</p>
                          <Badge variant="outline" className={cn("font-black text-[8px] uppercase h-5 px-2 border-none",
                            session.status === 'approved' ? "bg-green-100 text-green-700"
                            : session.status === 'rejected' ? "bg-destructive/10 text-destructive"
                            : session.status === 'active' ? "bg-primary/10 text-primary animate-pulse"
                            : "bg-amber-100 text-amber-700"
                          )}>
                            {session.missingOut ? 'Needs clock-out' : session.status}
                          </Badge>
                          {session.missingOut && session.inId && (
                            <Button size="sm" variant="ghost" onClick={() => { openReview(session, ts.member.id, ts.member.name); setIsEditing(true); }} className="h-7 px-3 text-[9px] font-black uppercase rounded-xl border border-destructive/30 text-destructive">
                              Add clock-out
                            </Button>
                          )}
                          {/* Review/Edit button for pending sessions */}
                          {session.status === 'pending' && session.clockOut && session.logId && (
                            <Button size="sm" variant="ghost" onClick={() => openReview(session, ts.member.id, ts.member.name)} className="h-7 px-3 text-[9px] font-black uppercase rounded-xl border border-muted hover:bg-primary/5 hover:text-primary hover:border-primary/20">
                              Review
                            </Button>
                          )}
                          {/* Allow editing approved sessions too */}
                          {(session.status === 'approved' || session.status === 'rejected') && session.logId && (
                            <Button size="sm" variant="ghost" onClick={() => openReview(session, ts.member.id, ts.member.name)} className="h-7 px-3 text-[9px] font-black uppercase rounded-xl border border-muted hover:bg-primary/5 hover:text-primary hover:border-primary/20">
                              <Edit className="w-3 h-3 mr-1" /> Edit
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {ts.days.every(d => d.sessions.length === 0) && (
                    <div className="py-8 text-center opacity-30">
                      <p className="text-[10px] font-black uppercase tracking-widest">No clock entries this week</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      {/* Review / Edit Dialog */}
      <Dialog open={isReviewOpen} onOpenChange={(v) => { setIsReviewOpen(v); if (!v) { setIsEditing(false); setReviewNote(''); } }}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">
              {isEditing ? 'Edit Session Times' : 'Review Session'}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              {selectedEntry?.staffName} -- {selectedEntry?.clockIn ? format(selectedEntry.clockIn, 'EEE MMM d') : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-6">
            {/* Session summary */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10">
                <p className="text-[9px] font-black uppercase text-primary/60">Duration</p>
                <p className="font-black text-lg font-mono text-primary">{selectedEntry ? formatDuration(selectedEntry.workedMinutes) : '--'}</p>
              </div>
              <div className="p-4 rounded-2xl bg-muted/20 border-2">
                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Break</p>
                <p className="font-black text-lg font-mono text-slate-900">{selectedEntry?.breakMinutes || 0}m</p>
                {(selectedEntry?.paidBreakMins || 0) > 0 && (
                  <p className="text-[8px] font-black text-green-600 uppercase">{selectedEntry.paidBreakMins}m paid</p>
                )}
              </div>
              <div className={cn("p-4 rounded-2xl border-2", selectedEntry?.geoVerified ? "bg-green-50 border-green-200" : selectedEntry?.geoWarnOnly ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200")}>
                <p className="text-[9px] font-black uppercase opacity-60">Geo</p>
                <p className={cn("font-black text-[10px] uppercase", selectedEntry?.geoVerified ? "text-green-700" : selectedEntry?.geoWarnOnly ? "text-amber-700" : "text-slate-400")}>
                  {selectedEntry?.geoVerified ? 'Verified' : selectedEntry?.geoWarnOnly ? 'Out of Zone' : 'N/A'}
                </p>
              </div>
            </div>

            {/* Edit time fields */}
            {isEditing ? (
              <div className="space-y-3 p-3 rounded-2xl bg-amber-50 border-2 border-amber-200">
                <p className="text-[9px] font-black uppercase text-amber-700 flex items-center gap-1.5">
                  <Edit className="w-3 h-3" /> Correcting Times
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">In</Label>
                    <input type="time" value={editClockIn} onChange={e => setEditClockIn(e.target.value)} className="w-full h-9 rounded-xl border-2 px-2 font-bold text-sm outline-none bg-white focus:border-amber-400 text-center" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Out</Label>
                    <input type="time" value={editClockOut} onChange={e => setEditClockOut(e.target.value)} className="w-full h-9 rounded-xl border-2 px-2 font-bold text-sm outline-none bg-white focus:border-amber-400 text-center" />
                  </div>
                </div>
                <p className="text-[7px] font-bold text-amber-700/60 uppercase leading-relaxed">Times saved as same date. Returns to Pending.</p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Recorded Times</p>
                    <p className="font-black text-sm text-slate-900">
                      {selectedEntry?.clockIn ? tHM(selectedEntry.clockIn) : '--'} to {selectedEntry?.clockOut ? tHM(selectedEntry.clockOut) : '--'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-8 px-3 text-[9px] font-black uppercase rounded-xl border border-muted hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200">
                    <Edit className="w-3 h-3 mr-1.5" /> Correct
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Manager Note {selectedEntry?.status !== 'approved' && '(required for rejection)'}</Label>
              <Textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add a note about this session..." className="rounded-2xl border-2 min-h-[80px]" />
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            {isEditing ? (
              <>
                <Button onClick={() => handleSaveEdit(selectedEntry)} disabled={isProcessing} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-amber-500/20 bg-amber-600 hover:bg-amber-700">
                  {isProcessing ? <Loader className="animate-spin" /> : <><Edit className="w-4 h-4 mr-2" />Save Corrected Times</>}
                </Button>
                <Button variant="ghost" onClick={() => setIsEditing(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel Edit</Button>
              </>
            ) : (
              <>
                <Button onClick={() => handleApprove(selectedEntry)} disabled={isProcessing} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Approve Session
                </Button>
                <Button variant="destructive" onClick={() => handleReject(selectedEntry)} disabled={isProcessing || !reviewNote.trim()} className="w-full h-12 rounded-2xl font-black uppercase">
                  <XCircle className="w-4 h-4 mr-2" /> Reject Session
                </Button>
                <Button variant="ghost" onClick={() => setIsReviewOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}