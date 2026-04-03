'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Calendar, Clock, Repeat, Zap, Bell, CheckCircle2, XCircle,
  LogOut, Delete, Shield, CalendarDays, ClipboardList, AlertTriangle,
  Coffee, ArrowRight, Users, DollarSign, TrendingUp, Plus, Timer,
  Scissors, Star, ChevronRight, MapPin, Info, Loader
} from 'lucide-react';
import {
  format, parseISO, startOfWeek, endOfWeek, addWeeks,
  eachDayOfInterval, isToday, isBefore, startOfDay,
  differenceInMinutes, isSameDay, addDays
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import {
  collection, query, where, doc, getDocs, writeBatch, updateDoc
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

//  HELPERS 
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const fmt = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${p}`;
};

const calcHours = (start: string, end: string, brk = 0) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm - brk) / 60);
};

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','del'];

const STATUS_SWAP: Record<string, { label: string; color: string }> = {
  pending:               { label: 'Pending Manager Review', color: 'bg-amber-100 text-amber-700' },
  pending_swap_consent:  { label: 'Awaiting Their Response', color: 'bg-purple-100 text-purple-700' },
  swap_consent_given:    { label: 'They Agreed  Needs Approval', color: 'bg-blue-100 text-blue-700' },
  swap_consent_denied:   { label: 'They Declined', color: 'bg-red-100 text-red-700' },
  approved:              { label: 'Approved', color: 'bg-green-100 text-green-700' },
  denied:                { label: 'Denied', color: 'bg-red-100 text-red-700' },
};

//  SWAP CONSENT CARD 
function SwapConsentCard({ req, staffMember, tenantId, firestore, allStaff, allShifts, onDone }: any) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const requester = (allStaff || []).find((s: any) => s.id === req.staffId);
  const myShift = (allShifts || []).find((s: any) => s.id === req.swapShiftId);
  const theirShift = (allShifts || []).find((s: any) => s.id === req.myShiftId);

  const respond = async (agree: boolean) => {
    setIsProcessing(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);

      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, req.id), {
        status: agree ? 'swap_consent_given' : 'swap_consent_denied',
        consentBy: staffMember.id,
        consentAt: now,
      });

      // Notify requester
      const n1 = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(n1, {
        id: n1.id, userId: req.staffId, read: false, createdAt: now, link: '/my-schedule',
        type: agree ? 'swap_consent_given' : 'swap_consent_denied',
        message: agree
          ? `${staffMember.name} agreed to swap shifts on ${req.date ? format(safeDate(req.date), 'MMM d') : 'the requested date'}. Waiting for manager approval.`
          : `${staffMember.name} declined your swap request for ${req.date ? format(safeDate(req.date), 'MMM d') : 'the requested date'}.`,
      });

      // Notify managers
      const mgrsSnap = await getDocs(query(
        collection(firestore, `tenants/${tenantId}/staff`),
        where('role', 'in', ['owner', 'admin'])
      ));
      mgrsSnap.docs.forEach(mgr => {
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(n, {
          id: n.id, userId: mgr.id, read: false, createdAt: now,
          link: '/schedule/requests', type: 'swap_request',
          message: agree
            ? `${staffMember.name} agreed to swap with ${requester?.name || 'staff'} on ${req.date ? format(safeDate(req.date), 'MMM d') : 'the date'}. Ready for approval.`
            : `Swap between ${requester?.name || 'staff'} and ${staffMember.name} was declined.`,
        });
      });

      await batch.commit();
      toast({ title: agree ? 'Swap Agreed' : 'Swap Declined' });
      onDone();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="rounded-[2rem] border-2 border-purple-200 bg-purple-50 overflow-hidden">
      <div className="px-4 py-3 bg-purple-100/60 border-b border-purple-200 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-purple-600 shrink-0" />
        <p className="font-black uppercase text-[10px] text-purple-700">Swap Request from {requester?.name}</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-white border-2 border-purple-100 space-y-1">
            <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Their shift  yours</p>
            {theirShift
              ? <><p className="font-black text-[11px] text-primary">{fmt(theirShift.startTime)}  {fmt(theirShift.endTime)}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{theirShift.date}</p></>
              : <p className="text-[9px] font-bold opacity-40 uppercase">Not found</p>}
          </div>
          <div className="p-3 rounded-xl bg-white border-2 border-purple-100 space-y-1">
            <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Your shift  theirs</p>
            {myShift
              ? <><p className="font-black text-[11px] text-purple-600">{fmt(myShift.startTime)}  {fmt(myShift.endTime)}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{myShift.date}</p></>
              : <p className="text-[9px] font-bold opacity-40 uppercase">Not found</p>}
          </div>
        </div>
        {req.reason && <p className="text-[10px] font-bold text-purple-700 uppercase leading-relaxed">{req.reason}</p>}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button onClick={() => respond(false)} disabled={isProcessing}
            className="h-12 rounded-2xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[9px] tracking-widest hover:bg-destructive/5 transition-all active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5">
            <XCircle className="w-4 h-4" />Decline
          </button>
          <button onClick={() => respond(true)} disabled={isProcessing}
            className="h-12 rounded-2xl bg-green-600 text-white font-black uppercase text-[9px] tracking-widest hover:bg-green-700 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-green-500/20 flex flex-col items-center justify-center gap-0.5">
            <CheckCircle2 className="w-4 h-4" />Agree to Swap
          </button>
        </div>
      </div>
    </div>
  );
}

//  PIN ENTRY 
function PinEntry({ onSuccess, tenantId, firestore }: any) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  const checkPin = async (entered: string) => {
    setChecking(true);
    try {
      const snap = await getDocs(query(
        collection(firestore, `tenants/${tenantId}/staff`),
        where('pin', '==', entered)
      ));
      if (!snap.empty) {
        onSuccess({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setError('Incorrect PIN. Try again.');
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 600);
      }
    } catch { setError('Error. Try again.'); setPin(''); }
    finally { setChecking(false); }
  };

  const handleDigit = (d: string) => {
    if (d === 'del') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) checkPin(next);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-10">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-[2rem] bg-primary/20 border-2 border-primary/30 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Staff Portal</h1>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Enter your 4-digit PIN</p>
        </div>

        <motion.div animate={shake ? { x: [-8, 8, -8, 8, 0] } : {}} transition={{ duration: 0.4 }} className="flex justify-center gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className={cn("w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all",
              pin.length > i ? "bg-primary border-primary" : "bg-white/5 border-white/10")}>
              {pin.length > i && <div className="w-3 h-3 rounded-full bg-white" />}
            </div>
          ))}
        </motion.div>

        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-center text-[10px] font-black uppercase tracking-widest text-destructive">
            {error}
          </motion.p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {DIGITS.map((d, i) => (
            <button key={i} onClick={() => d !== '' && handleDigit(d)}
              disabled={checking || d === ''}
              className={cn("h-16 rounded-2xl font-black text-xl transition-all active:scale-95",
                d === '' ? "pointer-events-none opacity-0" :
                d === 'del' ? "bg-white/5 border-2 border-white/10 text-white/60 hover:bg-white/10" :
                "bg-white/10 border-2 border-white/10 text-white hover:bg-white/20")}>
              {d === 'del' ? <Delete className="w-5 h-5 mx-auto" /> : d}
            </button>
          ))}
        </div>
        {checking && <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary/60 animate-pulse">Verifying...</p>}
      </div>
    </div>
  );
}

//  MAIN DASHBOARD 
function StaffDashboard({ staffMember, tenantId, firestore, onSignOut }: any) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'today' | 'schedule' | 'requests' | 'earnings' | 'inbox'>('today');
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<'day_off' | 'swap' | 'early_release'>('day_off');
  const [requestDate, setRequestDate] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [swapTargetShiftId, setSwapTargetShiftId] = useState('');
  const [swapTargetStaffId, setSwapTargetStaffId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduleWeek, setScheduleWeek] = useState(0); // 0 = this week, 1 = next

  const weekStart = startOfWeek(addWeeks(new Date(), scheduleWeek), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const today = new Date();

  //  Queries (all single-field to avoid composite index) 
  const myShiftsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/shifts`), where('staffId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const allShiftsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/shifts`);
  }, [firestore, tenantId]);

  const myApptsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/appointments`), where('staffId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const myRequestsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/shiftRequests`), where('staffId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const incomingSwapQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/shiftRequests`),
      where('swapWithStaffId', '==', staffMember.id),
      where('status', '==', 'pending_swap_consent'));
  }, [firestore, tenantId, staffMember?.id]);

  const allStaffQ = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/staff`);
  }, [firestore, tenantId]);

  const servicesQ = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/services`);
  }, [firestore, tenantId]);

  const notifsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/notifications`), where('userId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const activityLogsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/activityLogs`), where('staffId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const transactionsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/transactions`), where('staffId', '==', staffMember.id));
  }, [firestore, tenantId, staffMember?.id]);

  const { data: myShiftsRaw } = useCollection<any>(myShiftsQ);
  const { data: allShiftsRaw } = useCollection<any>(allShiftsQ);
  const { data: myApptsRaw } = useCollection<any>(myApptsQ);
  const { data: myRequests } = useCollection<any>(myRequestsQ);
  const { data: incomingSwaps } = useCollection<any>(incomingSwapQ);
  const { data: allStaff } = useCollection<any>(allStaffQ);
  const { data: services } = useCollection<any>(servicesQ);
  const { data: notifs } = useCollection<any>(notifsQ);
  const { data: activityLogs } = useCollection<any>(activityLogsQ);
  const { data: transactions } = useCollection<any>(transactionsQ);

  //  Derived data 

  // Week shifts
  const weekShifts = useMemo(() => {
    if (!myShiftsRaw) return [];
    const s = format(weekStart, 'yyyy-MM-dd');
    const e = format(weekEnd, 'yyyy-MM-dd');
    return myShiftsRaw.filter((sh: any) => sh.date >= s && sh.date <= e && sh.status !== 'cancelled' && sh.status !== 'draft');
  }, [myShiftsRaw, weekStart, weekEnd]);

  // Today's appointments (no client contact info exposed)
  const todayApts = useMemo(() => {
    if (!myApptsRaw) return [];
    return myApptsRaw
      .filter((a: any) => isSameDay(safeDate(a.startTime), today) && a.status !== 'cancelled')
      .sort((a: any, b: any) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())
      .map((a: any) => ({
        id: a.id,
        time: format(safeDate(a.startTime), 'h:mm a'),
        serviceName: (services || []).find((s: any) => s.id === a.serviceId)?.name || 'Service',
        duration: a.duration || (services || []).find((s: any) => s.id === a.serviceId)?.duration || 60,
        status: a.status,
        // Only show first name for privacy
        guestFirstName: (a.clientName || 'Guest').split(' ')[0],
      }));
  }, [myApptsRaw, today, services]);

  // Today's schedule -- who else is working (first name + role only)
  const todayColleagues = useMemo(() => {
    if (!allShiftsRaw || !allStaff) return [];
    const todayStr = format(today, 'yyyy-MM-dd');
    return allShiftsRaw
      .filter((s: any) => s.date === todayStr && s.staffId !== staffMember.id && s.status !== 'cancelled' && s.status !== 'draft')
      .map((s: any) => {
        const member = (allStaff || []).find((st: any) => st.id === s.staffId);
        return member ? {
          id: s.id,
          firstName: member.name?.split(' ')[0] || 'Staff',
          role: member.role || 'staff',
          startTime: s.startTime,
          endTime: s.endTime,
        } : null;
      })
      .filter(Boolean);
  }, [allShiftsRaw, allStaff, today, staffMember.id]);

  // My today shift
  const todayShift = useMemo(() => {
    if (!myShiftsRaw) return null;
    const todayStr = format(today, 'yyyy-MM-dd');
    return myShiftsRaw.find((s: any) => s.date === todayStr && s.status !== 'cancelled' && s.status !== 'draft') || null;
  }, [myShiftsRaw, today]);

  // Clock status from activityLogs
  const clockStatus = useMemo(() => {
    if (!activityLogs) return { isClockedIn: false, clockInTime: null, minutesWorked: 0 };
    const todayLogs = activityLogs
      .filter((l: any) => isSameDay(safeDate(l.timestamp), today))
      .sort((a: any, b: any) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
    
    let isClockedIn = false;
    let clockInTime: Date | null = null;
    let totalMinutes = 0;
    
    for (const log of todayLogs) {
      if (log.type === 'clock_in') { isClockedIn = true; clockInTime = safeDate(log.timestamp); }
      else if (log.type === 'clock_out' && clockInTime) {
        totalMinutes += differenceInMinutes(safeDate(log.timestamp), clockInTime);
        isClockedIn = false; clockInTime = null;
      }
    }
    if (isClockedIn && clockInTime) {
      totalMinutes += differenceInMinutes(new Date(), clockInTime);
    }
    return { isClockedIn, clockInTime, minutesWorked: totalMinutes };
  }, [activityLogs, today]);

  // This week earnings estimate
  const weekEarnings = useMemo(() => {
    const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const thisWeekEnd = endOfWeek(thisWeekStart, { weekStartsOn: 1 });
    
    if (!myShiftsRaw) return { estimatedPay: 0, weekHours: 0, tipTotal: 0, serviceRevenue: 0, appointmentCount: 0 };

    const thisWeekShifts = myShiftsRaw.filter((s: any) => {
      return s.date >= format(thisWeekStart, 'yyyy-MM-dd') &&
             s.date <= format(thisWeekEnd, 'yyyy-MM-dd') &&
             s.status !== 'cancelled';
    });

    const weekHours = thisWeekShifts.reduce((sum: number, s: any) =>
      sum + calcHours(s.startTime, s.endTime, s.breakMinutes || 0), 0);
    
    let estimatedPay = 0;
    if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
      estimatedPay = weekHours * staffMember.hourlyRate;
    }

    // Tips and service revenue from transactions this week
    const weekTx = (transactions || []).filter((t: any) => {
      const d = safeDate(t.date);
      return d >= thisWeekStart && d <= thisWeekEnd;
    });

    const tipTotal = weekTx.reduce((sum: number, t: any) => sum + (t.tipAmount || (t.category === 'Tips' ? t.amount : 0)), 0);
    const serviceRevenue = weekTx.filter((t: any) => t.category === 'Service Revenue').reduce((sum: number, t: any) => sum + t.amount, 0);

    if (staffMember.payStructure === 'commission' && staffMember.commissionRate) {
      estimatedPay = serviceRevenue * (staffMember.commissionRate / 100);
    } else if (staffMember.payStructure === 'hourly_plus_commission') {
      const commEarned = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
      estimatedPay = (staffMember.hourlyRate || 0) * weekHours + commEarned;
    }

    const appointmentCount = (myApptsRaw || []).filter((a: any) => {
      const d = safeDate(a.startTime);
      return d >= thisWeekStart && d <= thisWeekEnd && a.status === 'completed';
    }).length;

    return { estimatedPay, weekHours, tipTotal, serviceRevenue, appointmentCount };
  }, [myShiftsRaw, transactions, myApptsRaw, staffMember]);

  // Notifications
  const sortedNotifs = useMemo(() => {
    if (!notifs) return [];
    return [...notifs].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [notifs]);

  const unreadCount = useMemo(() => sortedNotifs.filter(n => !n.read).length, [sortedNotifs]);

  // Sorted requests
  const sortedRequests = useMemo(() => {
    if (!myRequests) return [];
    return [...myRequests].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [myRequests]);

  // Shifts on swap date for selecting target
  const shiftsOnRequestDate = useMemo(() => {
    if (!requestDate || requestType !== 'swap' || !allShiftsRaw || !allStaff) return [];
    return allShiftsRaw
      .filter((s: any) => s.date === requestDate && s.staffId !== staffMember.id && s.status !== 'cancelled' && s.status !== 'draft')
      .map((s: any) => ({ shift: s, member: (allStaff || []).find((st: any) => st.id === s.staffId) }))
      .filter((x: any) => x.member);
  }, [allShiftsRaw, allStaff, requestDate, requestType, staffMember.id]);

  const myShiftOnRequestDate = useMemo(() => {
    if (!requestDate || !myShiftsRaw) return null;
    return myShiftsRaw.find((s: any) => s.date === requestDate && s.status !== 'cancelled') || null;
  }, [myShiftsRaw, requestDate]);

  //  Submit request 
  const handleSubmitRequest = async () => {
    if (!requestDate || !requestReason.trim()) {
      toast({ variant: 'destructive', title: 'Missing info', description: 'Fill in all fields.' });
      return;
    }
    if (requestType === 'swap' && !swapTargetShiftId) {
      toast({ variant: 'destructive', title: 'Select a shift', description: 'Choose who to swap with.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();
      const reqRef = doc(collection(firestore, `tenants/${tenantId}/shiftRequests`));
      
      batch.set(reqRef, {
        id: reqRef.id, staffId: staffMember.id, type: requestType,
        date: requestDate, reason: requestReason,
        status: requestType === 'swap' ? 'pending_swap_consent' : 'pending',
        createdAt: now,
        ...(requestType === 'swap' && {
          swapWithStaffId: swapTargetStaffId,
          swapShiftId: swapTargetShiftId,
          myShiftId: myShiftOnRequestDate?.id || null,
        }),
      });

      if (requestType === 'day_off') {
        const blockRef = doc(collection(firestore, `tenants/${tenantId}/shiftDayOffBlocks`));
        batch.set(blockRef, { id: blockRef.id, staffId: staffMember.id, date: requestDate, status: 'pending', requestId: reqRef.id, reason: requestReason, createdAt: now });
      }

      // Notify swap target
      if (requestType === 'swap' && swapTargetStaffId) {
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(n, {
          id: n.id, userId: swapTargetStaffId, read: false, createdAt: now,
          type: 'swap_request', link: '/my-schedule',
          message: `${staffMember.name} wants to swap shifts with you on ${format(safeDate(requestDate), 'EEE, MMM d')}. Open your Staff Portal to respond.`,
        });
      }

      // Notify managers for non-swap requests
      if (requestType !== 'swap') {
        const mgrsSnap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/staff`),
          where('role', 'in', ['owner', 'admin'])
        ));
        mgrsSnap.docs.forEach(mgr => {
          const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
          batch.set(n, {
            id: n.id, userId: mgr.id, read: false, createdAt: now,
            type: requestType === 'day_off' ? 'day_off_request' : 'early_release_request',
            link: '/schedule/requests',
            message: `${staffMember.name} requested ${requestType === 'day_off' ? 'a day off' : 'early release'} on ${format(safeDate(requestDate), 'EEE, MMM d')}.`,
          });
        });
      }

      await batch.commit();
      toast({ title: 'Request Submitted', description: requestType === 'swap' ? 'The other staff member has been notified to respond.' : 'Your manager has been notified.' });
      setIsRequestOpen(false);
      setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId('');
    } finally { setIsSubmitting(false); }
  };

  //  Mark notif read 
  const markRead = async (notifId: string) => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/notifications`, notifId), { read: true });
    } catch {}
  };

  //  Tab config 
  const TABS = [
    { id: 'today',    label: 'Today',    icon: CalendarDays },
    { id: 'schedule', label: 'Schedule', icon: Calendar },
    { id: 'earnings', label: 'Earnings', icon: DollarSign },
    { id: 'requests', label: 'Requests', icon: ClipboardList, badge: (incomingSwaps || []).length },
    { id: 'inbox',    label: 'Inbox',    icon: Bell, badge: unreadCount },
  ] as const;

  const NOTIF_ICONS: Record<string, any> = {
    timesheet_approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    timesheet_rejected: <XCircle className="w-4 h-4 text-destructive" />,
    day_off_approved:   <Calendar className="w-4 h-4 text-blue-500" />,
    swap_approved:      <Repeat className="w-4 h-4 text-purple-500" />,
    swap_consent_given: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    swap_consent_denied:<XCircle className="w-4 h-4 text-destructive" />,
    swap_request:       <Repeat className="w-4 h-4 text-purple-500" />,
    request_approved:   <CheckCircle2 className="w-4 h-4 text-green-500" />,
    request_denied:     <XCircle className="w-4 h-4 text-destructive" />,
    schedule_published: <CalendarDays className="w-4 h-4 text-primary" />,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">

      {/*  Header  */}
      <div className="bg-slate-900 px-5 pt-6 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-11 h-11 rounded-2xl border-2 border-white/10">
              <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-primary/20 text-primary font-black">{staffMember.name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-black uppercase text-white text-sm leading-none">{staffMember.name}</p>
              <p className="text-[9px] font-black uppercase text-primary/60 mt-0.5">{staffMember.role}  {format(today, 'EEE, MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsRequestOpen(true)}
              className="h-9 px-3 rounded-xl bg-primary/20 border border-primary/30 text-primary font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 hover:bg-primary/30 transition-colors">
              <Plus className="w-3.5 h-3.5" />Request
            </button>
            <button onClick={onSignOut} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clock status */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
          <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", clockStatus.isClockedIn ? "bg-green-400 animate-pulse" : "bg-white/20")} />
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase text-white/40">Status</p>
            <p className="font-black text-white text-sm">{clockStatus.isClockedIn ? `Clocked In  ${Math.floor(clockStatus.minutesWorked / 60)}h ${clockStatus.minutesWorked % 60}m` : 'Not Clocked In'}</p>
          </div>
          {todayShift && (
            <div className="text-right shrink-0">
              <p className="text-[9px] font-black uppercase text-white/40">Shift</p>
              <p className="font-black text-primary text-sm">{fmt(todayShift.startTime)}  {fmt(todayShift.endTime)}</p>
            </div>
          )}
        </div>
      </div>

      {/*  Tab bar  */}
      <div className="flex bg-white border-b-2 border-slate-100 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={cn("flex-1 flex flex-col items-center gap-1 py-3 text-[8px] font-black uppercase tracking-widest transition-all relative shrink-0 min-w-[56px]",
              activeTab === tab.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}>
            <div className="relative">
              <tab.icon className="w-4 h-4" />
              {(tab as any).badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[7px] font-black rounded-full flex items-center justify-center">{(tab as any).badge}</span>
              )}
            </div>
            {tab.label}
          </button>
        ))}
      </div>

      {/*  Content  */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto pb-8">

        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div className="space-y-4">
            {/* My appointments today */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Your Appointments Today</p>
              {todayApts.length > 0 ? todayApts.map(apt => (
                <div key={apt.id} className={cn("flex items-center gap-3 p-4 rounded-2xl border-2 bg-white",
                  apt.status === 'completed' ? "border-green-200 bg-green-50/50" :
                  apt.status === 'in_progress' ? "border-primary/20 bg-primary/5" :
                  "border-slate-100")}>
                  <div className={cn("w-2 h-12 rounded-full shrink-0",
                    apt.status === 'completed' ? "bg-green-400" :
                    apt.status === 'in_progress' ? "bg-primary animate-pulse" : "bg-slate-200")} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase text-[11px] text-slate-900">{apt.serviceName}</p>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{apt.time}  {apt.duration}min  {apt.guestFirstName}</p>
                  </div>
                  <Badge className={cn("font-black text-[8px] uppercase border-none h-5 px-2 shrink-0",
                    apt.status === 'completed' ? "bg-green-100 text-green-700" :
                    apt.status === 'in_progress' ? "bg-primary/10 text-primary" :
                    "bg-slate-100 text-slate-600")}>
                    {apt.status === 'in_progress' ? 'In Service' : apt.status}
                  </Badge>
                </div>
              )) : (
                <div className="py-8 text-center border-2 border-dashed rounded-[2rem] opacity-30">
                  <Scissors className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest">No appointments today</p>
                </div>
              )}
            </div>

            {/* Who else is working */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Also Working Today</p>
              {todayColleagues.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {todayColleagues.map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 p-3 rounded-2xl border-2 border-slate-100 bg-white">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <p className="font-black text-primary text-sm">{c.firstName[0]}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="font-black uppercase text-[10px] truncate">{c.firstName}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{fmt(c.startTime)}  {fmt(c.endTime)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center rounded-2xl border-2 border-dashed opacity-30">
                  <p className="text-[10px] font-black uppercase tracking-widest">No other staff scheduled</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SCHEDULE TAB */}
        {activeTab === 'schedule' && (
          <div className="space-y-4">
            {/* Week nav */}
            <div className="flex items-center justify-between p-3 bg-white rounded-2xl border-2">
              <button onClick={() => setScheduleWeek(w => Math.max(0, w - 1))} disabled={scheduleWeek === 0}
                className="w-9 h-9 rounded-xl border-2 flex items-center justify-center font-black text-slate-600 disabled:opacity-30 hover:bg-slate-50"></button>
              <div className="text-center">
                <p className="text-[9px] font-black uppercase text-primary/60">{scheduleWeek === 0 ? 'This Week' : scheduleWeek === 1 ? 'Next Week' : `+${scheduleWeek} Weeks`}</p>
                <p className="font-black text-sm uppercase tracking-tight">{format(weekStart, 'MMM d')}  {format(weekEnd, 'MMM d')}</p>
              </div>
              <button onClick={() => setScheduleWeek(w => Math.min(3, w + 1))}
                className="w-9 h-9 rounded-xl border-2 flex items-center justify-center font-black text-slate-600 hover:bg-slate-50"></button>
            </div>

            {weekDays.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const dayShift = weekShifts.find((s: any) => s.date === dayStr);
              const isPast = isBefore(day, startOfDay(today)) && !isToday(day);
              return (
                <div key={day.toISOString()} className={cn("rounded-[2rem] border-2 overflow-hidden bg-white",
                  isToday(day) ? "border-primary/30 shadow-md shadow-primary/10" : "border-slate-100",
                  isPast && "opacity-40")}>
                  <div className={cn("px-4 py-3 flex items-center gap-3 border-b border-dashed",
                    isToday(day) ? "bg-primary/5" : "bg-muted/5")}>
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0",
                      isToday(day) ? "bg-primary text-white" : "bg-white border-2 text-slate-600")}>
                      {format(day, 'd')}
                    </div>
                    <div className="flex-1">
                      <p className={cn("font-black uppercase text-sm leading-none", isToday(day) ? "text-primary" : "text-slate-700")}>{format(day, 'EEEE')}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(day, 'MMM d')}</p>
                    </div>
                    {isToday(day) && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase">Today</Badge>}
                  </div>
                  <div className="p-3">
                    {dayShift ? (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border-2 border-primary/10">
                        <Clock className="w-4 h-4 text-primary/40 shrink-0" />
                        <div className="flex-1">
                          <p className="font-black uppercase text-[11px] text-primary">{fmt(dayShift.startTime)}  {fmt(dayShift.endTime)}</p>
                          {(dayShift.breakMinutes || 0) > 0 && <p className="text-[9px] font-bold opacity-60 uppercase flex items-center gap-1"><Coffee className="w-2.5 h-2.5" />{dayShift.breakMinutes}m break</p>}
                          {dayShift.notes && <p className="text-[9px] italic text-muted-foreground opacity-70 mt-0.5 truncate">{dayShift.notes}</p>}
                        </div>
                        <p className="font-black font-mono text-sm text-primary shrink-0">
                          {calcHours(dayShift.startTime, dayShift.endTime, dayShift.breakMinutes || 0).toFixed(1)}h
                        </p>
                      </div>
                    ) : (
                      <p className="text-[9px] font-black uppercase text-muted-foreground opacity-30 text-center py-2">No shift scheduled</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* EARNINGS TAB */}
        {activeTab === 'earnings' && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">This Week's Summary</p>

            {/* Big earnings card */}
            <div className="p-6 rounded-[2.5rem] bg-slate-900 text-white space-y-6">
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.3em]">Estimated Earnings</p>
                <p className="text-5xl font-black font-mono tracking-tighter text-primary">${weekEarnings.estimatedPay.toFixed(2)}</p>
                <p className="text-[9px] font-bold text-white/40 uppercase">{staffMember.payStructure?.replace('_', ' ') || 'commission'}  {weekEarnings.weekHours.toFixed(1)}h scheduled</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[8px] font-black uppercase text-white/40">Tips</p>
                  <p className="font-black font-mono text-green-400 text-lg">${weekEarnings.tipTotal.toFixed(0)}</p>
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[8px] font-black uppercase text-white/40">Services</p>
                  <p className="font-black font-mono text-white text-lg">{weekEarnings.appointmentCount}</p>
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[8px] font-black uppercase text-white/40">Hours</p>
                  <p className="font-black font-mono text-white text-lg">{weekEarnings.weekHours.toFixed(1)}</p>
                </div>
              </div>
            </div>

            {/* Pay structure info */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-100 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Pay Structure</p>
              <div className="flex items-center justify-between">
                <p className="font-bold uppercase text-sm text-slate-700">{staffMember.payStructure?.replace(/_/g, ' ') || 'Commission'}</p>
                {staffMember.commissionRate && <Badge className="bg-primary/10 text-primary border-none font-black text-[10px]">{staffMember.commissionRate}% service</Badge>}
              </div>
              {staffMember.hourlyRate && <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">${staffMember.hourlyRate}/hr base</p>}
              {staffMember.retailCommissionRate && <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{staffMember.retailCommissionRate}% retail commission</p>}
              <div className="pt-2 border-t border-dashed">
                <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed">Estimates are based on scheduled shifts and completed services. Final payout confirmed by management at pay period end.</p>
              </div>
            </div>
          </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div className="space-y-4">

            {/* Incoming swap consent requests */}
            {(incomingSwaps || []).length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-purple-700 px-1 flex items-center gap-2">
                  <Repeat className="w-3.5 h-3.5" /> Swap Requests For You
                </p>
                {(incomingSwaps || []).map((req: any) => (
                  <SwapConsentCard
                    key={req.id}
                    req={req}
                    staffMember={staffMember}
                    tenantId={tenantId}
                    firestore={firestore}
                    allStaff={allStaff}
                    allShifts={allShiftsRaw}
                    onDone={() => {}}
                  />
                ))}
              </div>
            )}

            {/* My submitted requests */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">My Requests</p>
              {sortedRequests.length === 0 && (incomingSwaps || []).length === 0 && (
                <div className="py-12 text-center border-2 border-dashed rounded-[2rem] opacity-30">
                  <ClipboardList className="w-10 h-10 mx-auto mb-3" />
                  <p className="text-[10px] font-black uppercase tracking-widest">No requests yet</p>
                </div>
              )}
              {sortedRequests.map((req: any) => {
                const swapTarget = req.swapWithStaffId ? (allStaff || []).find((s: any) => s.id === req.swapWithStaffId) : null;
                const statusInfo = STATUS_SWAP[req.status] || STATUS_SWAP.pending;
                return (
                  <Card key={req.id} className="border-2 rounded-[2rem] bg-white shadow-sm">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {req.type === 'day_off' ? <Calendar className="w-4 h-4 text-blue-600" /> :
                           req.type === 'swap' ? <Repeat className="w-4 h-4 text-purple-600" /> :
                           <Zap className="w-4 h-4 text-amber-600" />}
                          <div>
                            <p className="font-black uppercase text-[10px] text-slate-900">
                              {req.type === 'day_off' ? 'Day Off' : req.type === 'swap' ? 'Shift Swap' : 'Early Release'}
                              {req.date && `  ${format(safeDate(req.date), 'MMM d')}`}
                            </p>
                            <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(req.createdAt), 'MMM d, p')}</p>
                          </div>
                        </div>
                        <Badge className={cn("font-black text-[8px] uppercase border-none h-5 px-2 shrink-0 text-center", statusInfo.color)}>
                          {statusInfo.label}
                        </Badge>
                      </div>

                      {req.type === 'swap' && swapTarget && (
                        <div className="flex items-center gap-2 text-[9px] font-bold text-purple-700 uppercase">
                          <ArrowRight className="w-3 h-3 shrink-0" />
                          Swap with {swapTarget.name?.split(' ')[0]}
                        </div>
                      )}

                      <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">{req.reason}</p>

                      {req.managerNote && (
                        <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/10">
                          <p className="text-[9px] font-black uppercase text-primary/60 mb-0.5">Manager Response</p>
                          <p className="text-[10px] font-bold text-slate-700">{req.managerNote}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* INBOX TAB */}
        {activeTab === 'inbox' && (
          <div className="space-y-3">
            {sortedNotifs.length === 0 && (
              <div className="py-16 text-center opacity-30">
                <Bell className="w-10 h-10 mx-auto mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest">No notifications</p>
              </div>
            )}
            {sortedNotifs.map(n => (
              <div key={n.id} onClick={() => !n.read && markRead(n.id)}
                className={cn("flex items-start gap-3 p-4 rounded-2xl border-2 bg-white cursor-pointer transition-all",
                  !n.read ? "border-primary/20 bg-primary/[0.02]" : "border-slate-100")}>
                <div className="p-2 rounded-xl bg-muted/20 border shrink-0">
                  {NOTIF_ICONS[n.type] || <Bell className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-slate-700 leading-relaxed">{n.message}</p>
                  <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mt-1">{format(safeDate(n.createdAt), 'MMM d, h:mm a')}</p>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/*  Request Dialog  */}
      <Dialog open={isRequestOpen} onOpenChange={v => { if (!v) { setIsRequestOpen(false); setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId(''); } }}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Submit Request</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Your manager will be notified.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</Label>
              <Select value={requestType} onValueChange={(v: any) => { setRequestType(v); setSwapTargetShiftId(''); setSwapTargetStaffId(''); }}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  <SelectItem value="day_off" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" />Day Off</div></SelectItem>
                  <SelectItem value="swap" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Repeat className="w-4 h-4 text-purple-600" />Shift Swap</div></SelectItem>
                  <SelectItem value="early_release" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" />Early Release</div></SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)}
                min={format(today, 'yyyy-MM-dd')}
                className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40" />
            </div>

            {/* Swap: show other staff on that day */}
            {requestType === 'swap' && requestDate && (
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Swap With</Label>
                {myShiftOnRequestDate ? (
                  <p className="text-[9px] font-bold text-primary/70 uppercase">Your shift: {fmt(myShiftOnRequestDate.startTime)}  {fmt(myShiftOnRequestDate.endTime)}</p>
                ) : (
                  <p className="text-[9px] font-bold text-amber-600 uppercase">You have no shift on this date</p>
                )}
                {shiftsOnRequestDate.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {shiftsOnRequestDate.map(({ shift, member }: any) => (
                      <button key={shift.id} type="button"
                        onClick={() => { setSwapTargetShiftId(shift.id); setSwapTargetStaffId(shift.staffId); }}
                        className={cn("w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left",
                          swapTargetShiftId === shift.id ? "border-purple-400 bg-purple-50" : "border-slate-200 bg-white hover:border-purple-200")}>
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <p className="font-black text-primary text-sm">{member?.name?.[0]}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black uppercase text-[10px] truncate">{member?.name?.split(' ')[0]}</p>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{fmt(shift.startTime)}  {fmt(shift.endTime)}</p>
                        </div>
                        {swapTargetShiftId === shift.id && <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed text-center">
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">No other staff scheduled on this date</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
              <Textarea value={requestReason} onChange={e => setRequestReason(e.target.value)}
                placeholder="Explain your request..." className="rounded-2xl border-2 min-h-[80px]" />
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleSubmitRequest}
              disabled={isSubmitting || !requestDate || !requestReason.trim() || (requestType === 'swap' && !swapTargetShiftId)}
              className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isSubmitting ? <Loader className="animate-spin" /> : 'Submit Request'}
            </Button>
            <Button variant="ghost" onClick={() => setIsRequestOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

//  ROOT 
export default function StaffPortalPage({ params }: { params: { tenantId: string } }) {
  const { firestore } = useFirebase();
  const [signedInStaff, setSignedInStaff] = useState<any | null>(null);
  const tenantId = params.tenantId;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSignedInStaff(null), 15 * 60 * 1000);
  };

  useEffect(() => {
    if (!signedInStaff) return;
    resetTimeout();
    const events = ['touchstart', 'click', 'keydown'];
    events.forEach(e => window.addEventListener(e, resetTimeout));
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimeout));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [signedInStaff]);

  if (!firestore || !tenantId) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-white/40 font-black uppercase text-[10px] tracking-widest">Loading...</p>
    </div>
  );

  if (!signedInStaff) return (
    <PinEntry firestore={firestore} tenantId={tenantId} onSuccess={setSignedInStaff} />
  );

  return (
    <StaffDashboard
      staffMember={signedInStaff}
      tenantId={tenantId}
      firestore={firestore}
      onSignOut={() => setSignedInStaff(null)}
    />
  );
}