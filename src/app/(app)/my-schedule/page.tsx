'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Clock, Calendar, Repeat, Zap, Plus, Loader,
  ChevronLeft, ChevronRight, Coffee, CheckCircle2,
  ArrowRight, Users, AlertCircle
} from 'lucide-react';
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek,
  eachDayOfInterval, parseISO, isSameDay, isToday,
  isBefore, startOfDay
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, writeBatch } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const formatTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${p}`;
};

const calcHours = (start: string, end: string, breakMins: number) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm - breakMins) / 60);
};

export default function MySchedulePage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const { staff } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<'day_off' | 'swap' | 'early_release'>('day_off');
  const [requestDate, setRequestDate] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [swapTargetStaffId, setSwapTargetStaffId] = useState('');
  const [swapTargetShiftId, setSwapTargetShiftId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const shiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !user?.uid) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('staffId', '==', user.uid)
    );
  }, [firestore, tenantId, user?.uid]);

  const allShiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !requestDate || requestType !== 'swap') return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('date', '==', requestDate),
      where('status', 'in', ['published', 'confirmed'])
    );
  }, [firestore, tenantId, requestDate, requestType]);

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !user?.uid) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shiftRequests`),
      where('staffId', '==', user.uid)
    );
  }, [firestore, tenantId, user?.uid]);

  const { data: allShifts } = useCollection<any>(shiftsQuery);
  const { data: shiftsOnDate } = useCollection<any>(allShiftsQuery);
  const { data: allRequests } = useCollection<any>(requestsQuery);

  const myShifts = useMemo(() => {
    if (!allShifts) return [];
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
    return allShifts.filter(s =>
      s.date >= weekStartStr &&
      s.date <= weekEndStr &&
      s.status !== 'cancelled' &&
      s.status !== 'draft'
    );
  }, [allShifts, weekStart, weekEnd]);

  const swappableShifts = useMemo(() => {
    if (!shiftsOnDate || !user?.uid) return [];
    return shiftsOnDate.filter(s => s.staffId !== user.uid);
  }, [shiftsOnDate, user?.uid]);

  const myRequests = useMemo(() => {
    if (!allRequests) return [];
    return [...allRequests].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [allRequests]);

  const weeklyHours = useMemo(() =>
    myShifts.reduce((sum, s) => sum + calcHours(s.startTime, s.endTime, s.breakMinutes || 0), 0),
    [myShifts]
  );

  const myShiftOnDate = useMemo(() => {
    if (!requestDate || !allShifts) return null;
    return allShifts.find(s => s.date === requestDate && s.staffId === user?.uid && s.status !== 'cancelled');
  }, [allShifts, requestDate, user?.uid]);

  const handleSubmitRequest = async () => {
    if (!firestore || !tenantId || !user?.uid || !requestDate || !requestReason.trim()) {
      toast({ variant: 'destructive', title: 'Missing Info', description: 'Please fill in all fields.' });
      return;
    }
    if (requestType === 'swap' && !swapTargetShiftId) {
      toast({ variant: 'destructive', title: 'Select a Shift', description: 'Choose which shift to swap with.' });
      return;
    }
    setIsProcessing(true);

    try {
      if (!firestore) return;
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      const requestRef = doc(collection(firestore, `tenants/${tenantId}/shiftRequests`));
      batch.set(requestRef, {
        id: requestRef.id,
        staffId: user.uid,
        type: requestType,
        date: requestDate,
        reason: requestReason,
        status: 'pending',
        createdAt: now,
        ...(requestType === 'swap' && {
          swapWithStaffId: swapTargetStaffId,
          swapShiftId: swapTargetShiftId,
          myShiftId: myShiftOnDate?.id || null,
        }),
      });

      if (requestType === 'day_off') {
        const blockRef = doc(collection(firestore, `tenants/${tenantId}/shiftDayOffBlocks`));
        batch.set(blockRef, {
          id: blockRef.id,
          staffId: user.uid,
          date: requestDate,
          status: 'pending',
          requestId: requestRef.id,
          reason: requestReason,
          createdAt: now,
        });
      }

      const managersToNotify = (staff || []).filter(s => s.role === 'owner' || s.role === 'admin');
      managersToNotify.forEach(manager => {
        const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(notifRef, {
          id: notifRef.id,
          userId: manager.id,
          type: requestType === 'day_off' ? 'day_off_request' : requestType === 'swap' ? 'swap_request' : 'early_release_request',
          message: requestType === 'swap'
            ? `${(staff || []).find(s => s.id === user.uid)?.name || 'Staff'} wants to swap shifts on ${format(safeDate(requestDate), 'MMM d')} with ${(staff || []).find(s => s.id === swapTargetStaffId)?.name || 'another staff member'}.`
            : `${(staff || []).find(s => s.id === user.uid)?.name || 'Staff'} requested ${requestType === 'day_off' ? 'a day off' : 'early release'} on ${format(safeDate(requestDate), 'MMM d')}.`,
          link: '/schedule/requests',
          createdAt: now,
          read: false,
        });
      });

      await batch.commit();

      toast({
        title: requestType === 'day_off' ? 'Day Off Requested'
          : requestType === 'swap' ? 'Swap Requested'
          : 'Early Release Requested',
        description: requestType === 'swap'
          ? 'Your manager will review the swap. Both shifts will update automatically once approved.'
          : requestType === 'day_off'
          ? 'The day has been flagged as pending. Your manager will confirm.'
          : 'Your manager will review and respond shortly.',
      });

      setIsRequestOpen(false);
      setRequestReason('');
      setRequestDate('');
      setSwapTargetStaffId('');
      setSwapTargetShiftId('');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetDialog = () => {
    setIsRequestOpen(false);
    setRequestReason('');
    setRequestDate('');
    setSwapTargetStaffId('');
    setSwapTargetShiftId('');
  };

  const STATUS_COLORS: Record<string, string> = {
    published: 'bg-primary/10 text-primary border-primary/20',
    confirmed: 'bg-green-100 text-green-700 border-green-200',
  };

  const otherStaffOnSwapDate = swappableShifts.map(s => ({
    shift: s,
    member: (staff || []).find(m => m.id === s.staffId),
  })).filter(x => x.member);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="My Schedule" />
      <main className="flex-1 p-4 md:p-8 w-full max-w-2xl mx-auto space-y-6">

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">My Schedule</h1>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Your shifts & requests</p>
          </div>
          <Button onClick={() => setIsRequestOpen(true)} className="h-12 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4 mr-2" /> Request
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 p-4 bg-white rounded-[2rem] border-2 shadow-sm">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Week of</p>
            <p className="font-black text-sm uppercase tracking-tight">{format(weekStart, 'MMM d')} -- {format(weekEnd, 'MMM d')}</p>
            <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mt-0.5">{weeklyHours.toFixed(1)}h scheduled</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl">
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <div className="space-y-3">
          {weekDays.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const dayShifts = myShifts.filter(s => s.date === dayStr);
            const isPastDay = isBefore(day, startOfDay(new Date())) && !isToday(day);
            return (
              <div key={day.toISOString()} className={cn("rounded-[2rem] border-2 overflow-hidden bg-white transition-all", isToday(day) ? "border-primary/30 shadow-md shadow-primary/10" : "border-slate-200", isPastDay && "opacity-50")}>
                <div className={cn("px-5 py-3 flex items-center justify-between border-b border-dashed", isToday(day) ? "bg-primary/5" : "bg-muted/5")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0", isToday(day) ? "bg-primary text-white" : "bg-white border-2 text-slate-600")}>
                      {format(day, 'd')}
                    </div>
                    <div>
                      <p className={cn("font-black uppercase text-sm leading-none", isToday(day) ? "text-primary" : "text-slate-700")}>{format(day, 'EEEE')}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(day, 'MMMM d')}</p>
                    </div>
                  </div>
                  {isToday(day) && <Badge className="bg-primary text-white border-none font-black text-[9px] uppercase">Today</Badge>}
                </div>
                <div className="p-4 space-y-2">
                  {dayShifts.length > 0 ? dayShifts.map(shift => (
                    <div key={shift.id} className={cn("flex items-center justify-between p-4 rounded-2xl border-2", STATUS_COLORS[shift.status] || STATUS_COLORS.published)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Clock className="w-4 h-4 opacity-40 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-black uppercase text-[11px]">{formatTime(shift.startTime)} -- {formatTime(shift.endTime)}</p>
                          {(shift.breakMinutes || 0) > 0 && <p className="text-[9px] font-bold opacity-60 uppercase flex items-center gap-1"><Coffee className="w-2.5 h-2.5" />{shift.breakMinutes}m break</p>}
                          {shift.notes && <p className="text-[9px] font-bold italic opacity-70 mt-0.5 truncate">{shift.notes}</p>}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="font-black font-mono text-sm text-primary">{calcHours(shift.startTime, shift.endTime, shift.breakMinutes || 0).toFixed(1)}h</p>
                        <Badge className={cn("h-4 px-1.5 text-[7px] font-black uppercase border-none", STATUS_COLORS[shift.status] || STATUS_COLORS.published)}>{shift.status}</Badge>
                      </div>
                    </div>
                  )) : (
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40 text-center py-2">No shift scheduled</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {myRequests.length > 0 && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">My Requests</p>
            {myRequests.slice(0, 5).map(req => (
              <Card key={req.id} className="border-2 rounded-[2rem] shadow-sm bg-white">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn("p-2.5 rounded-xl shrink-0 border-2",
                    req.type === 'day_off' ? "bg-blue-50 border-blue-200" :
                    req.type === 'swap' ? "bg-purple-50 border-purple-200" :
                    "bg-amber-50 border-amber-200")}>
                    {req.type === 'day_off' ? <Calendar className="w-4 h-4 text-blue-600" /> :
                     req.type === 'swap' ? <Repeat className="w-4 h-4 text-purple-600" /> :
                     <Zap className="w-4 h-4 text-amber-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-black uppercase text-[10px] text-slate-900">
                        {req.type === 'day_off' ? 'Day Off' : req.type === 'swap' ? 'Shift Swap' : 'Early Release'}
                        {req.date && ` -- ${format(safeDate(req.date), 'MMM d')}`}
                      </p>
                      <Badge className={cn("font-black text-[8px] uppercase border-none h-5 px-2 shrink-0",
                        req.status === 'pending' ? "bg-amber-100 text-amber-700" :
                        req.status === 'approved' ? "bg-green-100 text-green-700" :
                        "bg-destructive/10 text-destructive")}>
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 mt-0.5 truncate">{req.reason}</p>
                    {req.swapWithStaffId && (
                      <p className="text-[9px] font-bold text-purple-600/70 uppercase mt-0.5 flex items-center gap-1">
                        <ArrowRight className="w-2.5 h-2.5" />
                        Swap with {(staff || []).find(s => s.id === req.swapWithStaffId)?.name || 'staff'}
                      </p>
                    )}
                    {req.managerNote && (
                      <p className="text-[9px] font-bold text-primary/70 italic mt-1 border-l-2 border-primary/20 pl-2">{req.managerNote}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={isRequestOpen} onOpenChange={v => { if (!v) resetDialog(); }}>
        <DialogContent className="sm:max-w-md max-h-[85dvh] !flex flex-col !gap-0 p-0 rounded-[2.5rem] border-4 shadow-2xl bg-background overflow-hidden">

          <div className="flex-shrink-0 p-6 pb-4 border-b bg-muted/5 text-left">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Submit Request</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Your manager will be notified immediately.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-6 space-y-5">

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Request Type</Label>
                <Select value={requestType} onValueChange={(v: any) => { setRequestType(v); setSwapTargetStaffId(''); setSwapTargetShiftId(''); }}>
                  <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-2 shadow-2xl">
                    <SelectItem value="day_off" className="font-bold uppercase text-[10px]">
                      <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" />Day Off Request</div>
                    </SelectItem>
                    <SelectItem value="swap" className="font-bold uppercase text-[10px]">
                      <div className="flex items-center gap-2"><Repeat className="w-4 h-4 text-purple-600" />Shift Swap</div>
                    </SelectItem>
                    <SelectItem value="early_release" className="font-bold uppercase text-[10px]">
                      <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" />Early Release</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {requestType === 'day_off' && (
                <div className="p-3 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-[9px] font-bold text-blue-700 uppercase leading-relaxed">The day will be flagged as pending immediately. Once your manager approves, it will be blocked on the schedule automatically.</p>
                </div>
              )}
              {requestType === 'swap' && (
                <div className="p-3 rounded-2xl bg-purple-50 border-2 border-purple-200 flex items-start gap-2">
                  <Repeat className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <p className="text-[9px] font-bold text-purple-700 uppercase leading-relaxed">Select the date and the staff member to swap with. Both shifts will be automatically reassigned once your manager approves.</p>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {requestType === 'swap' ? 'Date to Swap' : 'Date'}
                </Label>
                <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} min={format(new Date(), 'yyyy-MM-dd')} className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40" />
              </div>

              {requestType === 'swap' && requestDate && (
                <div className="space-y-3">
                  {myShiftOnDate ? (
                    <div className="p-3 rounded-2xl bg-slate-50 border-2 border-slate-200">
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Your Shift</p>
                      <p className="font-black text-sm text-primary">{formatTime(myShiftOnDate.startTime)} -- {formatTime(myShiftOnDate.endTime)}</p>
                    </div>
                  ) : (
                    <div className="p-3 rounded-2xl bg-amber-50 border-2 border-amber-200">
                      <p className="text-[9px] font-black uppercase text-amber-700 flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3" /> You have no published shift on this date
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Swap With</Label>
                    {otherStaffOnSwapDate.length > 0 ? (
                      <div className="space-y-2">
                        {otherStaffOnSwapDate.map(({ shift, member }) => (
                          <button
                            key={shift.id}
                            type="button"
                            onClick={() => { setSwapTargetStaffId(shift.staffId); setSwapTargetShiftId(shift.id); }}
                            className={cn(
                              "w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left",
                              swapTargetShiftId === shift.id
                                ? "border-purple-400 bg-purple-50"
                                : "border-slate-200 bg-white hover:border-purple-200"
                            )}
                          >
                            <Avatar className="w-8 h-8 rounded-xl border shrink-0">
                              <AvatarImage src={member?.avatarUrl} className="object-cover" />
                              <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-black uppercase text-[10px] truncate">{member?.name}</p>
                              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                                {formatTime(shift.startTime)} -- {formatTime(shift.endTime)}
                              </p>
                            </div>
                            {swapTargetShiftId === shift.id && <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed text-center">
                        <Users className="w-6 h-6 text-muted-foreground/40 mx-auto mb-1" />
                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">No other staff scheduled on this date</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
                <Textarea value={requestReason} onChange={e => setRequestReason(e.target.value)} placeholder="Explain your request..." className="rounded-2xl border-2 min-h-[80px]" />
              </div>

            </div>
          </div>

          <div className="flex-shrink-0 p-6 pt-4 border-t bg-background flex flex-col gap-3">
            <Button
              onClick={handleSubmitRequest}
              disabled={isProcessing || !requestDate || !requestReason.trim() || (requestType === 'swap' && !swapTargetShiftId)}
              className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20"
            >
              {isProcessing ? <Loader className="animate-spin" /> : (
                requestType === 'day_off' ? <><Calendar className="w-4 h-4 mr-2" />Request Day Off</> :
                requestType === 'swap' ? <><Repeat className="w-4 h-4 mr-2" />Request Swap</> :
                <><Zap className="w-4 h-4 mr-2" />Request Early Release</>
              )}
            </Button>
            <Button variant="ghost" onClick={resetDialog} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </div>

        </DialogContent>
      </Dialog>
    </div>
  );
}