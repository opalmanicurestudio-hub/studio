'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import {
  Calendar, Clock, Repeat, Zap, Bell, CheckCircle2,
  XCircle, ChevronRight, LogOut, Delete, Shield,
  CalendarDays, ClipboardList, AlertTriangle, Coffee,
  ArrowRight, Users
} from 'lucide-react';
import {
  format, parseISO, startOfWeek, endOfWeek,
  eachDayOfInterval, isToday, isBefore, startOfDay
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, getDoc, getDocs, writeBatch, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

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

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','del'];

//  PIN ENTRY SCREEN 
function PinEntry({ onSuccess, tenantId, firestore }: {
  onSuccess: (staff: any) => void;
  tenantId: string;
  firestore: any;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  const handleDigit = (d: string) => {
    if (d === 'del') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) checkPin(next);
  };

  const checkPin = async (enteredPin: string) => {
    setChecking(true);
    try {
      const staffSnap = await getDocs(
        query(collection(firestore, `tenants/${tenantId}/staff`), where('pin', '==', enteredPin))
      );
      if (!staffSnap.empty) {
        const staffData = { id: staffSnap.docs[0].id, ...staffSnap.docs[0].data() };
        onSuccess(staffData);
      } else {
        setError('Incorrect PIN. Try again.');
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 600);
      }
    } catch {
      setError('Error checking PIN.');
      setPin('');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-10">
        {/* Logo / Studio name */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-[2rem] bg-primary/20 border-2 border-primary/30 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Staff Portal</h1>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Enter your 4-digit PIN</p>
        </div>

        {/* PIN display */}
        <motion.div
          animate={shake ? { x: [-8, 8, -8, 8, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="flex justify-center gap-4"
        >
          {[0,1,2,3].map(i => (
            <div key={i} className={cn(
              "w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all",
              pin.length > i
                ? "bg-primary border-primary"
                : "bg-white/5 border-white/10"
            )}>
              {pin.length > i && <div className="w-3 h-3 rounded-full bg-white" />}
            </div>
          ))}
        </motion.div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-[10px] font-black uppercase tracking-widest text-destructive"
          >
            {error}
          </motion.p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-4">
          {DIGITS.map((d, i) => (
            <button
              key={i}
              onClick={() => d !== '' && handleDigit(d)}
              disabled={checking || d === ''}
              className={cn(
                "h-16 rounded-2xl font-black text-xl transition-all active:scale-95",
                d === '' ? "pointer-events-none opacity-0" :
                d === 'del' ? "bg-white/5 border-2 border-white/10 text-white/60 hover:bg-white/10" :
                "bg-white/10 border-2 border-white/10 text-white hover:bg-white/20"
              )}
            >
              {d === 'del' ? <Delete className="w-5 h-5 mx-auto" /> : d}
            </button>
          ))}
        </div>

        {checking && (
          <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary/60 animate-pulse">
            Verifying...
          </p>
        )}
      </div>
    </div>
  );
}

//  STAFF DASHBOARD 
function StaffDashboard({ staffMember, tenantId, firestore, onSignOut }: {
  staffMember: any;
  tenantId: string;
  firestore: any;
  onSignOut: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'schedule' | 'requests' | 'notifications'>('schedule');
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const shiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('staffId', '==', staffMember.id)
    );
  }, [firestore, tenantId, staffMember?.id]);

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shiftRequests`),
      where('staffId', '==', staffMember.id)
    );
  }, [firestore, tenantId, staffMember?.id]);

  const notifsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/notifications`),
      where('userId', '==', staffMember.id)
    );
  }, [firestore, tenantId, staffMember?.id]);

  const { data: allShifts } = useCollection<any>(shiftsQuery);

  // Incoming swap requests WHERE this staff is the swap target
  const incomingSwapQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !staffMember?.id) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shiftRequests`),
      where('swapWithStaffId', '==', staffMember.id),
      where('status', '==', 'pending_swap_consent')
    );
  }, [firestore, tenantId, staffMember?.id]);

  // All staff for name lookups in swap cards
  const allStaffQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/staff`);
  }, [firestore, tenantId]);

  // All shifts for swap display
  const allShiftsForPortalQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/shifts`);
  }, [firestore, tenantId]);

  const { data: incomingSwapRequests } = useCollection<any>(incomingSwapQuery);
  const { data: allStaff } = useCollection<any>(allStaffQuery);
  const { data: allShiftsForPortal } = useCollection<any>(allShiftsForPortalQuery);
  const { data: allRequests } = useCollection<any>(requestsQuery);
  const { data: allNotifs } = useCollection<any>(notifsQuery);

  const weekShifts = useMemo(() => {
    if (!allShifts) return [];
    const s = format(weekStart, 'yyyy-MM-dd');
    const e = format(weekEnd, 'yyyy-MM-dd');
    return allShifts.filter(sh => sh.date >= s && sh.date <= e && sh.status !== 'cancelled' && sh.status !== 'draft');
  }, [allShifts, weekStart, weekEnd]);

  const recentRequests = useMemo(() => {
    if (!allRequests) return [];
    return [...allRequests].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ).slice(0, 10);
  }, [allRequests]);

  const notifications = useMemo(() => {
    if (!allNotifs) return [];
    return [...allNotifs].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ).slice(0, 20);
  }, [allNotifs]);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const weeklyHours = useMemo(() =>
    weekShifts.reduce((sum, s) => {
      if (!s.startTime || !s.endTime) return sum;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      return sum + Math.max(0, (eh * 60 + em - sh * 60 - sm - (s.breakMinutes || 0)) / 60);
    }, 0), [weekShifts]);

  const TABS = [
    { id: 'schedule', label: 'Schedule', icon: CalendarDays },
    { id: 'requests', label: 'Requests', icon: ClipboardList },
    { id: 'notifications', label: 'Inbox', icon: Bell, badge: unreadCount },
  ] as const;

  const NOTIF_ICONS: Record<string, any> = {
    timesheet_approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    timesheet_rejected: <XCircle className="w-4 h-4 text-destructive" />,
    day_off_approved: <Calendar className="w-4 h-4 text-blue-500" />,
    swap_approved: <Repeat className="w-4 h-4 text-purple-500" />,
    request_approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    request_denied: <XCircle className="w-4 h-4 text-destructive" />,
    schedule_published: <CalendarDays className="w-4 h-4 text-primary" />,
  };

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 px-5 pt-safe-top pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-11 h-11 rounded-2xl border-2 border-white/10">
              <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-primary/20 text-primary font-black">{staffMember.name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-black uppercase text-white text-sm leading-none">{staffMember.name}</p>
              <p className="text-[9px] font-black uppercase text-primary/60 mt-0.5">{staffMember.role}</p>
            </div>
          </div>
          <button onClick={onSignOut} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Week hours pill */}
        <div className="mt-4 flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
          <Clock className="w-4 h-4 text-primary" />
          <div>
            <p className="text-[8px] font-black uppercase text-white/40">This Week</p>
            <p className="font-black font-mono text-white">{weeklyHours.toFixed(1)}h scheduled</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[8px] font-black uppercase text-white/40">Shifts</p>
            <p className="font-black font-mono text-primary">{weekShifts.length}</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-white border-b-2 border-slate-100">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 text-[9px] font-black uppercase tracking-widest transition-all relative",
              activeTab === tab.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
            )}
          >
            <div className="relative">
              <tab.icon className="w-5 h-5" />
              {tab.badge && tab.badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[7px] font-black rounded-full flex items-center justify-center">{tab.badge}</span>
              )}
            </div>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">

        {/* SCHEDULE TAB */}
        {activeTab === 'schedule' && (
          <div className="space-y-3">
            {weekDays.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const dayShifts = weekShifts.filter(s => s.date === dayStr);
              const isPast = isBefore(day, startOfDay(new Date())) && !isToday(day);
              return (
                <div key={day.toISOString()} className={cn("rounded-[2rem] border-2 overflow-hidden bg-white", isToday(day) ? "border-primary/30 shadow-md shadow-primary/10" : "border-slate-100", isPast && "opacity-40")}>
                  <div className={cn("px-4 py-3 flex items-center gap-3 border-b border-dashed", isToday(day) ? "bg-primary/5" : "bg-muted/5")}>
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0", isToday(day) ? "bg-primary text-white" : "bg-white border-2 text-slate-600")}>
                      {format(day, 'd')}
                    </div>
                    <div className="flex-1">
                      <p className={cn("font-black uppercase text-sm leading-none", isToday(day) ? "text-primary" : "text-slate-700")}>{format(day, 'EEEE')}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(day, 'MMM d')}</p>
                    </div>
                    {isToday(day) && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase">Today</Badge>}
                  </div>
                  <div className="p-3 space-y-2">
                    {dayShifts.length > 0 ? dayShifts.map(shift => (
                      <div key={shift.id} className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border-2 border-primary/10">
                        <Clock className="w-4 h-4 text-primary/40 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-black uppercase text-[11px] text-primary">{formatTime(shift.startTime)} -- {formatTime(shift.endTime)}</p>
                          {(shift.breakMinutes || 0) > 0 && (
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 flex items-center gap-1">
                              <Coffee className="w-2.5 h-2.5" />{shift.breakMinutes}m break
                            </p>
                          )}
                          {shift.notes && <p className="text-[9px] italic text-muted-foreground opacity-60 truncate">{shift.notes}</p>}
                        </div>
                        <p className="font-black font-mono text-sm text-primary shrink-0">
                          {Math.max(0, ((shift.endTime.split(':').reduce((a: number, v: string, i: number) => a + Number(v) * (i === 0 ? 60 : 1), 0)) - (shift.startTime.split(':').reduce((a: number, v: string, i: number) => a + Number(v) * (i === 0 ? 60 : 1), 0)) - (shift.breakMinutes || 0)) / 60).toFixed(1)}h
                        </p>
                      </div>
                    )) : (
                      <p className="text-[9px] font-black uppercase text-muted-foreground opacity-30 text-center py-2">No shift scheduled</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div className="space-y-3">
            {/* Swap consent requests directed AT this staff member */}
            {incomingSwapRequests.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-purple-700 px-1 flex items-center gap-2">
                  <Repeat className="w-3.5 h-3.5" /> Swap Requests For You
                </p>
                {incomingSwapRequests.map(req => (
                  <SwapConsentCard
                    key={req.id}
                    req={req}
                    staffMember={staffMember}
                    tenantId={tenantId}
                    firestore={firestore}
                    allStaff={allStaff}
                    allShifts={allShiftsForPortal}
                  />
                ))}
              </div>
            )}
            {recentRequests.length === 0 && incomingSwapRequests.length === 0 && (
              <div className="py-16 text-center opacity-30">
                <ClipboardList className="w-10 h-10 mx-auto mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest">No requests yet</p>
              </div>
            )}
            {recentRequests.map(req => (
              <Card key={req.id} className="border-2 rounded-[2rem] bg-white shadow-sm">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={cn("p-2.5 rounded-xl border-2 shrink-0",
                    req.type === 'day_off' ? "bg-blue-50 border-blue-200" :
                    req.type === 'swap' ? "bg-purple-50 border-purple-200" :
                    "bg-amber-50 border-amber-200"
                  )}>
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
                      <Badge className={cn("font-black text-[8px] uppercase border-none h-5 px-2",
                        req.status === 'pending' ? "bg-amber-100 text-amber-700" :
                        req.status === 'approved' ? "bg-green-100 text-green-700" :
                        "bg-destructive/10 text-destructive"
                      )}>{req.status}</Badge>
                    </div>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase opacity-60 mt-0.5 truncate">{req.reason}</p>
                    {req.managerNote && (
                      <p className="text-[9px] font-bold text-primary/70 italic mt-1 border-l-2 border-primary/20 pl-2">{req.managerNote}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <div className="space-y-3">
            {notifications.length === 0 && (
              <div className="py-16 text-center opacity-30">
                <Bell className="w-10 h-10 mx-auto mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest">No notifications</p>
              </div>
            )}
            {notifications.map(notif => (
              <div key={notif.id} className={cn("flex items-start gap-3 p-4 rounded-2xl border-2 bg-white transition-all", !notif.read && "border-primary/20 bg-primary/[0.02]")}>
                <div className="p-2 rounded-xl bg-muted/20 border shrink-0">
                  {NOTIF_ICONS[notif.type] || <Bell className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-slate-700 leading-relaxed">{notif.message}</p>
                  <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mt-1">
                    {format(safeDate(notif.createdAt), 'MMM d, h:mm a')}
                  </p>
                </div>
                {!notif.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

//  ROOT PAGE 
export default function StaffPortalPage({ params }: { params: { tenantId: string } }) {
  const { firestore } = useFirebase();
  const [signedInStaff, setSignedInStaff] = useState<any | null>(null);
  const tenantId = params.tenantId;

  // Auto sign-out after 15 minutes of inactivity
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSignedInStaff(null), 15 * 60 * 1000);
  };

  useEffect(() => {
    if (signedInStaff) {
      resetTimeout();
      const events = ['touchstart', 'click', 'keydown'];
      events.forEach(e => window.addEventListener(e, resetTimeout));
      return () => {
        events.forEach(e => window.removeEventListener(e, resetTimeout));
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [signedInStaff]);

  if (!firestore || !tenantId) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-white/40 font-black uppercase text-[10px] tracking-widest">Loading...</p>
      </div>
    );
  }

  if (!signedInStaff) {
    return (
      <PinEntry
        firestore={firestore}
        tenantId={tenantId}
        onSuccess={(staff) => setSignedInStaff(staff)}
      />
    );
  }

  return (
    <StaffDashboard
      staffMember={signedInStaff}
      tenantId={tenantId}
      firestore={firestore}
      onSignOut={() => setSignedInStaff(null)}
    />
  );
}