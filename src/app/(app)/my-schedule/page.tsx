'use client';

import { addDocumentNonBlocking, useCollection, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Clock, Calendar, Repeat, Zap, Plus, Loader, ChevronLeft, ChevronRight,
  Check, AlertTriangle, Coffee
} from 'lucide-react';
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
  parseISO, isSameDay, isToday, isBefore, startOfDay
} from 'date-fns';
import { cn } from '@/lib/utils';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
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
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${p}`;
};

export default function MySchedulePage() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<'day_off' | 'swap' | 'early_release'>('day_off');
  const [requestDate, setRequestDate] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const shiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !user) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('staffId', '==', user.uid),
      where('date', '>=', format(weekStart, 'yyyy-MM-dd')),
      where('date', '<=', format(weekEnd, 'yyyy-MM-dd')),
      where('status', 'in', ['published', 'confirmed'])
    );
  }, [firestore, tenantId, user?.uid, weekStart.toISOString()]);

  const myRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !user) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shiftRequests`),
      where('staffId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, tenantId, user?.uid]);

  const { data: myShifts } = useCollection<any>(shiftsQuery);
  const { data: myRequests } = useCollection<any>(myRequestsQuery);

  const weeklyHours = useMemo(() => {
    if (!myShifts) return 0;
    return myShifts.reduce((sum, s) => {
      const h = s.startTime && s.endTime
        ? (parseInt(s.endTime.split(':')[0]) * 60 + parseInt(s.endTime.split(':')[1])
          - parseInt(s.startTime.split(':')[0]) * 60 - parseInt(s.startTime.split(':')[1])
          - (s.breakMinutes || 0)) / 60
        : 0;
      return sum + Math.max(0, h);
    }, 0);
  }, [myShifts]);

  const handleSubmitRequest = async () => {
    if (!firestore || !tenantId || !user || !requestDate || !requestReason.trim()) {
      toast({ variant: 'destructive', title: 'Missing Info', description: 'Please fill in all fields.' });
      return;
    }
    setIsProcessing(true);
    try {
      await addDocumentNonBlocking(
        collection(firestore, `tenants/${tenantId}/shiftRequests`),
        {
          id: nanoid(),
          staffId: user.uid,
          type: requestType,
          date: requestDate,
          reason: requestReason,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }
      );
      toast({ title: 'Request Submitted', description: 'Your manager will review and respond shortly.' });
      setIsRequestOpen(false);
      setRequestReason('');
      setRequestDate('');
    } finally {
      setIsProcessing(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    published: 'bg-primary/10 text-primary border-primary/20',
    confirmed: 'bg-green-100 text-green-700 border-green-200',
    draft: 'bg-slate-100 text-slate-600 border-slate-200',
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="My Schedule" />
      <main className="flex-1 p-4 md:p-8 w-full max-w-2xl mx-auto space-y-6">

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">My Schedule</h1>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Your upcoming shifts & requests</p>
          </div>
          <Button onClick={() => setIsRequestOpen(true)} className="h-12 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4 mr-2" /> Request
          </Button>
        </div>

        {/* Week nav + hours summary */}
        <div className="flex items-center justify-between gap-4 p-4 bg-white rounded-[2rem] border-2 shadow-sm">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronLeft className="w-5 h-5" /></Button>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Week of</p>
            <p className="font-black text-sm uppercase tracking-tight">{format(weekStart, 'MMM d')} -- {format(weekEnd, 'MMM d')}</p>
            <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mt-0.5">{weeklyHours.toFixed(1)}h scheduled</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronRight className="w-5 h-5" /></Button>
        </div>

        {/* Daily shift cards */}
        <div className="space-y-3">
          {weekDays.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const dayShifts = (myShifts || []).filter(s => s.date === dayStr);
            return (
              <div key={day.toISOString()} className={cn("rounded-[2rem] border-2 overflow-hidden transition-all", isToday(day) ? "border-primary/30 shadow-md shadow-primary/10" : "border-slate-200 bg-white", isBefore(day, startOfDay(new Date())) && !isToday(day) && "opacity-50")}>
                {/* Day header */}
                <div className={cn("px-5 py-3 flex items-center justify-between", isToday(day) ? "bg-primary/5" : "bg-muted/5 border-b border-dashed")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm", isToday(day) ? "bg-primary text-white" : "bg-white border-2 text-slate-600")}>
                      {format(day, 'd')}
                    </div>
                    <div>
                      <p className={cn("font-black uppercase text-sm", isToday(day) ? "text-primary" : "text-slate-700")}>{format(day, 'EEEE')}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(day, 'MMMM d, yyyy')}</p>
                    </div>
                  </div>
                  {isToday(day) && <Badge className="bg-primary text-white border-none font-black text-[9px] uppercase">Today</Badge>}
                </div>

                {/* Shifts */}
                <div className="p-4 space-y-2">
                  {dayShifts.length > 0 ? dayShifts.map(shift => (
                    <div key={shift.id} className={cn("flex items-center justify-between p-4 rounded-2xl border-2", STATUS_COLORS[shift.status] || STATUS_COLORS.published)}>
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 opacity-40 shrink-0" />
                        <div>
                          <p className="font-black uppercase text-[11px]">{formatTime(shift.startTime)} -- {formatTime(shift.endTime)}</p>
                          {shift.breakMinutes > 0 && (
                            <p className="text-[9px] font-bold opacity-60 uppercase flex items-center gap-1">
                              <Coffee className="w-2.5 h-2.5" /> {shift.breakMinutes}m break
                            </p>
                          )}
                          {shift.notes && <p className="text-[9px] font-bold italic opacity-70 mt-0.5">{shift.notes}</p>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black font-mono text-sm text-primary">
                          {((parseInt(shift.endTime.split(':')[0]) * 60 + parseInt(shift.endTime.split(':')[1]) - parseInt(shift.startTime.split(':')[0]) * 60 - parseInt(shift.startTime.split(':')[1]) - (shift.breakMinutes || 0)) / 60).toFixed(1)}h
                        </p>
                        <Badge className={cn("h-4 px-1.5 text-[7px] font-black uppercase border-none", STATUS_COLORS[shift.status])}>{shift.status}</Badge>
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

        {/* My recent requests */}
        {(myRequests || []).length > 0 && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">My Requests</p>
            {(myRequests || []).slice(0, 5).map(req => (
              <Card key={req.id} className="border-2 rounded-[2rem] shadow-sm bg-white">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn("p-2.5 rounded-xl shrink-0 border-2",
                    req.type === 'day_off' ? "bg-blue-50 border-blue-200" :
                    req.type === 'swap' ? "bg-purple-50 border-purple-200" :
                    "bg-amber-50 border-amber-200"
                  )}>
                    {req.type === 'day_off' ? <Calendar className="w-4 h-4 text-blue-600" /> :
                     req.type === 'swap' ? <Repeat className="w-4 h-4 text-purple-600" /> :
                     <Zap className="w-4 h-4 text-amber-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-black uppercase text-[10px] text-slate-900">
                        {req.type === 'day_off' ? 'Day Off' : req.type === 'swap' ? 'Shift Swap' : 'Early Release'}
                        {req.date && ` -- ${format(safeDate(req.date), 'MMM d')}`}
                      </p>
                      <Badge className={cn("font-black text-[8px] uppercase border-none h-5 px-2 shrink-0",
                        req.status === 'pending' ? "bg-amber-100 text-amber-700" :
                        req.status === 'approved' ? "bg-green-100 text-green-700" :
                        "bg-destructive/10 text-destructive"
                      )}>
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 mt-0.5">{req.reason}</p>
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

      {/* New Request Dialog */}
      <Dialog open={isRequestOpen} onOpenChange={setIsRequestOpen}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Submit Request</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Your manager will review and respond.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Request Type</Label>
              <Select value={requestType} onValueChange={(v: any) => setRequestType(v)}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  <SelectItem value="day_off" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" />Day Off Request</div></SelectItem>
                  <SelectItem value="swap" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Repeat className="w-4 h-4 text-purple-600" />Shift Swap</div></SelectItem>
                  <SelectItem value="early_release" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" />Early Release</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} min={format(new Date(), 'yyyy-MM-dd')} className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40" />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
              <Textarea value={requestReason} onChange={e => setRequestReason(e.target.value)} placeholder="Explain your request..." className="rounded-2xl border-2 min-h-[100px]" />
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleSubmitRequest} disabled={isProcessing || !requestDate || !requestReason.trim()} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isProcessing ? <Loader className="animate-spin" /> : 'Submit Request'}
            </Button>
            <Button variant="ghost" onClick={() => setIsRequestOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}