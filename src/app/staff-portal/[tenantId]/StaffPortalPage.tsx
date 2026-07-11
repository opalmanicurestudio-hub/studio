og'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar, Clock, Repeat, Zap, Bell, CheckCircle2, XCircle,
  LogOut, Delete, Shield, CalendarDays, ClipboardList,
  Coffee, ArrowRight, DollarSign, Plus, Timer,
  Scissors, Play, CheckCircle, ShieldCheck,
  Activity, ShoppingCart, LogIn,
  AlertCircle, ChevronRight, Trash2, Loader,
  ChevronLeft, ChevronDown, ChevronUp, RefreshCw,
  User, Lock, AlertTriangle, Workflow, MapPin, ShieldAlert,
  PlusCircle, Car, Users, MessageSquare, CreditCard,
} from 'lucide-react';
import {
  format, parseISO, startOfWeek, endOfWeek, addWeeks,
  eachDayOfInterval, isToday, isBefore, startOfDay,
  differenceInMinutes, differenceInSeconds, isSameDay, addMinutes, addMonths,
  startOfMonth, endOfMonth,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, getDocs, writeBatch, updateDoc, arrayUnion } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';

// ─── TIMELINE CONSTANTS ───────────────────────────────────────────────────────
// Full 24h so the "now" line is always visible no matter the time
const HOUR_START  = 0;
const HOUR_END    = 24;
const TOTAL_MINS  = (HOUR_END - HOUR_START) * 60; // 1440
const PX_PER_MIN  = 2.4;
const TIMELINE_H  = TOTAL_MINS * PX_PER_MIN;       // 3456px
const MIN_BLOCK   = 96;  // minimum block height — always enough room for the button

// ─── FLOOR VIEW CONSTANTS ─────────────────────────────────────────────────────
const FLOOR_TIME_GUTTER  = 52;   // px — fixed left time label column
const FLOOR_MY_COL       = 160;  // px — current tech's column (wider)
const FLOOR_OTHER_COL    = 120;  // px — other techs' columns
const FLOOR_WALKIN_COLOR = 'bg-teal-500'; // walk-in accent

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','del'];

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 gap-4">
          <div className="text-destructive font-black uppercase text-[10px] tracking-widest">Something went wrong</div>
          <div className="bg-white/10 rounded-2xl p-4 max-w-sm w-full">
            <p className="text-white text-xs font-mono break-all">{(this.state.error as Error).message}</p>
            <p className="text-white/40 text-[9px] font-mono mt-2 break-all">{(this.state.error as Error).stack?.split('\n').slice(0,3).join('\n')}</p>
          </div>
          <button onClick={() => this.setState({ error: null })} className="text-white/60 text-[10px] font-black uppercase tracking-widest">Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}



const STATUS_SWAP: Record<string, { label: string; color: string }> = {
  pending:              { label: 'Pending Review',          color: 'bg-amber-100 text-amber-700'   },
  pending_swap_consent: { label: 'Awaiting Response',       color: 'bg-purple-100 text-purple-700' },
  swap_consent_given:   { label: 'Agreed — Needs Approval', color: 'bg-blue-100 text-blue-700'     },
  swap_consent_denied:  { label: 'They Declined',           color: 'bg-red-100 text-red-700'       },
  approved:             { label: 'Approved',                color: 'bg-green-100 text-green-700'   },
  denied:               { label: 'Denied',                  color: 'bg-red-100 text-red-700'       },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const fmt12 = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const calcHours = (start: string, end: string, brk = 0) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm - brk) / 60);
};

// Convert Date → pixel offset from top of 24h timeline
const timeToPx = (d: Date) =>
  ((d.getHours() * 60 + d.getMinutes()) / TOTAL_MINS) * TIMELINE_H;

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-slate-200', className)} />;
}
function TabSkeleton() {
  return (
    <div className="space-y-4 py-2">
      <Skel className="h-16 w-full" />
      <Skel className="h-12 w-full" />
      <Skel className="h-[420px] w-full" />
    </div>
  );
}

// ─── MID-SERVICE ADD-ON SHEET ─────────────────────────────────────────────────
// Lets staff add a compatible add-on mid-service, assign a tech, set flow type,
// then writes to Firestore and notifies the assigned technician.
// ─── AVAILABILITY HELPERS ─────────────────────────────────────────────────────

// Returns the next appointment for a given staff member after a reference time
async function fetchNextAppointment(firestore: any, tenantId: string, staffId: string, afterTime: Date): Promise<any | null> {
  try {
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('staffId', '==', staffId),
      where('status', 'in', ['confirmed', 'servicing']),
    );
    const snap = await getDocs(q);
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((a: any) => safeDate(a.startTime) > afterTime)
      .sort((a: any, b: any) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
    return docs[0] || null;
  } catch { return null; }
}

// Returns all today's appointments for every staff member for overlap detection
async function fetchTodayAppointments(firestore: any, tenantId: string): Promise<any[]> {
  try {
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('status', 'in', ['confirmed', 'servicing']),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

// Checks if a tech is available right now given today's appointments
function getTechAvailability(
  tech: any,
  allShifts: any[],
  todayApts: any[],
  addOnDuration: number,
  excludeAptId: string,
): { available: boolean; reason: string; nextApt: any | null; conflictMinutes: number } {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');

  // 1. Check shift
  const shift = allShifts.find((s: any) => s.staffId === tech.id && s.date === today && s.status !== 'cancelled');
  if (!shift) return { available: false, reason: 'Off shift', nextApt: null, conflictMinutes: 0 };

  const shiftStart = safeDate(`${today}T${shift.startTime}`);
  const shiftEnd   = safeDate(`${today}T${shift.endTime}`);
  if (now < shiftStart || now > shiftEnd) return { available: false, reason: 'Off shift', nextApt: null, conflictMinutes: 0 };

  // 2. Check for active servicing appointment (not the current one)
  const myApts = todayApts.filter((a: any) => a.staffId === tech.id && a.id !== excludeAptId);
  const isServicing = myApts.some((a: any) => a.status === 'servicing');
  if (isServicing) return { available: false, reason: 'Currently servicing', nextApt: null, conflictMinutes: 0 };

  // 3. Check overlap: does adding this add-on duration conflict with their next appointment?
  const addOnEnd = addMinutes(now, addOnDuration);
  const upcoming = myApts
    .filter((a: any) => safeDate(a.startTime) > now)
    .sort((a: any, b: any) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  const nextApt = upcoming[0] || null;

  if (nextApt) {
    const nextStart = safeDate(nextApt.startTime);
    if (addOnEnd > nextStart) {
      const overlapMins = differenceInMinutes(addOnEnd, nextStart);
      return { available: true, reason: 'conflict', nextApt, conflictMinutes: overlapMins };
    }
  }

  return { available: true, reason: 'idle', nextApt, conflictMinutes: 0 };
}

// ─── MID-SERVICE ADD-ON SHEET ─────────────────────────────────────────────────
function MidServiceAddOnSheet({ apt, service, allServices, allStaff, allShifts, tenantId, firestore, currentStaffId, onClose }: any) {
  const { toast } = useToast();

  // Step 1: pick add-on  Step 2: pick assignment mode  Step 3: confirm (with optional warning)
  const [selectedAddOn, setSelectedAddOn] = useState<any | null>(null);
  const [mode, setMode] = useState<'self' | 'assign' | null>(null);
  const [assignedTechId, setAssignedTechId] = useState<string | null>(null);
  const [isConcurrent, setIsConcurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Availability data fetched once an add-on is selected
  const [todayApts, setTodayApts] = useState<any[]>([]);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, ReturnType<typeof getTechAvailability>>>({});

  // Conflict warning state
  const [selfConflict, setSelfConflict] = useState<{ nextApt: any; overlapMins: number } | null>(null);
  const [techConflict, setTechConflict] = useState<{ nextApt: any; overlapMins: number } | null>(null);
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);

  const compatibleAddOns = useMemo(() => {
    if (!allServices || !service) return [];
    const compatible = service.compatibleAddOnIds || [];
    const already    = apt.addOnIds || [];
    return allServices.filter((s: any) => s.type === 'addon' && compatible.includes(s.id) && !already.includes(s.id));
  }, [allServices, service, apt]);

  // When an add-on is selected, fetch today's appointments and compute availability
  useEffect(() => {
    if (!selectedAddOn || !firestore || !tenantId) return;
    setLoadingAvailability(true);
    setMode(null);
    setAssignedTechId(null);
    setAvailabilityMap({});

    fetchTodayAppointments(firestore, tenantId).then(apts => {
      setTodayApts(apts);

      // Build availability map for every staff member
      const map: Record<string, ReturnType<typeof getTechAvailability>> = {};
      (allStaff || []).forEach((tech: any) => {
        map[tech.id] = getTechAvailability(tech, allShifts || [], apts, selectedAddOn.duration, apt.id);
      });
      setAvailabilityMap(map);
      setLoadingAvailability(false);
    });
  }, [selectedAddOn?.id]);

  // Compute self-conflict whenever add-on changes
  const selfAvailability = useMemo(() => {
    if (!selectedAddOn || !currentStaffId) return null;
    return getTechAvailability(
      { id: currentStaffId },
      allShifts || [],
      todayApts,
      selectedAddOn.duration,
      apt.id,
    );
  }, [selectedAddOn, currentStaffId, todayApts, allShifts, apt.id]);

  // Compute tech conflict when a tech is selected
  const selectedTechAvailability = useMemo(() => {
    if (!assignedTechId || !selectedAddOn) return null;
    return availabilityMap[assignedTechId] || null;
  }, [assignedTechId, availabilityMap, selectedAddOn]);

  const handleSelfAdd = () => {
    if (!selectedAddOn || !currentStaffId) {
      toast({ variant: 'destructive', title: 'Cannot identify current staff member.' });
      return;
    }
    // If availability hasn't loaded yet, just commit — no conflict data available
    if (loadingAvailability) {
      commitAddOn(currentStaffId, true);
      return;
    }
    if (selfAvailability?.conflictMinutes && selfAvailability.conflictMinutes > 0) {
      setSelfConflict({ nextApt: selfAvailability.nextApt, overlapMins: selfAvailability.conflictMinutes });
      setTechConflict(null);
      setShowConflictWarning(true);
      setPendingSubmit(true);
    } else {
      commitAddOn(currentStaffId, true);
    }
  };

  const handleAssignTech = () => {
    if (!selectedAddOn || !assignedTechId) return;
    const av = availabilityMap[assignedTechId];
    if (av?.conflictMinutes && av.conflictMinutes > 0) {
      setTechConflict({ nextApt: av.nextApt, overlapMins: av.conflictMinutes });
      setSelfConflict(null);
      setShowConflictWarning(true);
      setPendingSubmit(true);
    } else {
      commitAddOn(assignedTechId, false);
    }
  };

  const commitAddOn = async (techId: string | undefined, isSelf: boolean) => {
    if (!selectedAddOn || !firestore || !tenantId || !techId) {
      toast({ variant: 'destructive', title: 'Missing required data to save add-on.' });
      return;
    }
    setSaving(true);
    setShowConflictWarning(false);
    try {
      const now  = new Date().toISOString();
      const batch = writeBatch(firestore);
      const aptRef = doc(firestore, `tenants/${tenantId}/appointments`, apt.id);
      const currentOverrides  = apt.checkoutState?.serviceStaffOverrides || {};
      const currentConcurrent = apt.checkoutState?.concurrentServiceIds  || [];

      // Extend duration + preserve original
      const originalDuration = apt.originalDuration ?? apt.duration ?? 60;
      const newDuration = (apt.duration ?? 60) + selectedAddOn.duration;

      batch.update(aptRef, {
        duration: newDuration,
        originalDuration,
        addOnIds: arrayUnion(selectedAddOn.id),
        assignedStaffIds: arrayUnion(techId),
        'checkoutState.serviceStaffOverrides': { ...currentOverrides, [selectedAddOn.id]: techId },
        'checkoutState.concurrentServiceIds': isConcurrent
          ? [...new Set([...currentConcurrent, selectedAddOn.id])]
          : currentConcurrent,
      });

      // Notify tech (skip if self — they already know)
      if (!isSelf) {
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(n, {
          id: n.id, userId: techId, read: false, createdAt: now,
          type: 'addon_handoff', link: 'today',
          message: `${apt.clientName || 'A guest'} needs ${selectedAddOn.name} — ${isConcurrent ? 'concurrent with current service' : 'sequential after current service'}. Please proceed.`,
        });
      }

      // Write a staffBlock for sequential assignments so the tech's slot is
      // protected in the booking system and visible in floor view.
      if (!isConcurrent) {
        const blockRef = doc(collection(firestore, `tenants/${tenantId}/staffBlocks`));
        batch.set(blockRef, {
          id: blockRef.id,
          staffId: techId,
          startTime: now,
          duration: selectedAddOn.duration,
          type: 'sequential_addon',
          sourceAppointmentId: apt.id,
          addOnId: selectedAddOn.id,
          createdAt: now,
          createdBy: currentStaffId || techId,
        });
      }

      await batch.commit();
      toast({
        title: `Add-on added ✓`,
        description: isSelf
          ? `${selectedAddOn.name} added to your session. Duration extended by ${selectedAddOn.duration}m.`
          : `${selectedAddOn.name} assigned. Tech notified.`,
      });
      onClose();
    } catch {
      toast({ variant: 'destructive', title: 'Failed to add add-on.' });
    } finally { setSaving(false); }
  };

  // ── Empty state ──
  if (compatibleAddOns.length === 0) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-[10px] font-black uppercase text-muted-foreground opacity-40">No compatible add-ons available</p>
        <button onClick={onClose} className="text-[10px] font-black uppercase text-primary">Close</button>
      </div>
    );
  }

  // ── Conflict warning overlay ──
  if (showConflictWarning) {
    const conflict = selfConflict || techConflict;
    const isSelfConflict = !!selfConflict;
    return (
      <div className="p-4 space-y-4">
        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-3">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="font-black uppercase text-[11px] tracking-wide">Schedule Conflict</p>
          </div>
          <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
            Adding <span className="font-black">{selectedAddOn?.name}</span> ({selectedAddOn?.duration}m) will run{' '}
            <span className="font-black text-amber-900">{conflict?.overlapMins} min</span> into{' '}
            {isSelfConflict ? 'your' : 'their'} next appointment
            {conflict?.nextApt?.clientName ? ` with ${conflict.nextApt.clientName}` : ''} at{' '}
            {conflict?.nextApt ? format(safeDate(conflict.nextApt.startTime), 'h:mm a') : ''}.
          </p>
          <p className="text-[10px] font-bold text-amber-700 uppercase opacity-70">
            Consider reassigning or adjusting the schedule.
          </p>
        </div>
        <button
          onClick={() => {
            if (isSelfConflict && currentStaffId) commitAddOn(currentStaffId, true);
            else if (assignedTechId) commitAddOn(assignedTechId, false);
          }}
          disabled={saving || (isSelfConflict ? !currentStaffId : !assignedTechId)}
          className="w-full h-12 rounded-2xl bg-amber-500 text-white font-black uppercase text-[11px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97] transition-all"
        >
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : 'Proceed Anyway'}
        </button>
        <button
          onClick={() => { setShowConflictWarning(false); setPendingSubmit(false); }}
          className="w-full h-10 rounded-2xl border-2 border-slate-200 font-black uppercase text-[10px] text-slate-400 tracking-widest active:scale-[0.97]"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── STEP 1: Pick add-on ── */}
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Select Add-on</p>
      <div className="space-y-2 max-h-44 overflow-y-auto">
        {compatibleAddOns.map((addon: any) => (
          <button
            key={addon.id}
            onClick={() => { setSelectedAddOn(addon); setMode(null); setAssignedTechId(null); }}
            className={cn(
              'w-full flex items-center justify-between p-3 rounded-2xl border-2 text-left transition-all active:scale-[0.98]',
              selectedAddOn?.id === addon.id ? 'border-primary bg-primary/5' : 'border-slate-100 bg-white hover:border-primary/20',
            )}
          >
            <div>
              <p className="font-black uppercase text-[11px] text-slate-800">{addon.name}</p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{addon.duration}m · ${addon.price?.toFixed(2)}</p>
            </div>
            {selectedAddOn?.id === addon.id && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
          </button>
        ))}
      </div>

      {/* ── STEP 2: Assignment options (shown once add-on selected) ── */}
      <AnimatePresence>
        {selectedAddOn && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="space-y-3 pt-2 border-t border-dashed"
          >
            {/* Self-assign — always first, prominent */}
            <button
              onClick={() => { setMode('self'); handleSelfAdd(); }}
              disabled={saving}
              className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-primary bg-primary/5 active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  {saving && mode === 'self'
                    ? <Loader className="w-4 h-4 text-white animate-spin" />
                    : <User className="w-4 h-4 text-white" />
                  }
                </div>
                <div className="text-left">
                  <p className="font-black uppercase text-[11px] text-primary">Add to My Session</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                    Extends your appointment by {selectedAddOn.duration}m
                    {loadingAvailability
                      ? ' · Checking conflicts...'
                      : selfAvailability?.conflictMinutes && selfAvailability.conflictMinutes > 0
                        ? ` · ⚠ Runs ${selfAvailability.conflictMinutes}m over next apt`
                        : ' · No conflicts'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-primary shrink-0" />
            </button>

            {/* Assign to another tech */}
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-50 px-1">
                Or Assign to Available Tech
              </p>
              {loadingAvailability ? (
                <div className="flex items-center justify-center py-6 gap-2">
                  <Loader className="w-4 h-4 animate-spin text-primary" />
                  <p className="text-[10px] font-black uppercase text-muted-foreground opacity-40">Checking availability...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {(allStaff || [])
                    .filter((t: any) => t.id !== currentStaffId)
                    .map((tech: any) => {
                      const av = availabilityMap[tech.id];
                      const isAvailable = av?.available && av.reason !== 'Off shift' && av.reason !== 'Currently servicing';
                      const isSelected = assignedTechId === tech.id;

                      return (
                        <button
                          key={tech.id}
                          onClick={() => isAvailable ? setAssignedTechId(tech.id) : undefined}
                          disabled={!isAvailable}
                          className={cn(
                            'w-full flex items-center justify-between p-3 rounded-2xl border-2 text-left transition-all',
                            isSelected ? 'border-primary bg-primary/5' :
                            isAvailable ? 'border-slate-100 bg-white hover:border-primary/20 active:scale-[0.98]' :
                            'border-slate-100 bg-slate-50 opacity-40 cursor-not-allowed',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 rounded-xl border-2 shrink-0">
                              <AvatarImage src={tech.avatarUrl} className="object-cover" />
                              <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">
                                {(tech.name || 'T')[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 text-left">
                              <p className="font-black uppercase text-[10px] text-slate-800 truncate">{tech.name?.split(' ')[0]}</p>
                              <p className={cn(
                                'text-[8px] font-bold uppercase',
                                av?.reason === 'idle' ? 'text-green-600' :
                                av?.reason === 'conflict' ? 'text-amber-500' :
                                'text-slate-400',
                              )}>
                                {av?.reason === 'idle' ? '● Idle'
                                  : av?.reason === 'conflict' ? `⚠ Free · ${av.conflictMinutes}m overlap`
                                  : av?.reason === 'Currently servicing' ? '● Servicing'
                                  : '○ Off shift'}
                              </p>
                            </div>
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                        </button>
                      );
                    })
                  }
                </div>
              )}
            </div>

            {/* Flow type + confirm — shown when a tech is selected */}
            <AnimatePresence>
              {assignedTechId && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 pt-2 border-t border-dashed">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-50 px-1">Flow Type</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Sequential', value: false, icon: Workflow, desc: 'After current' },
                      { label: 'Concurrent', value: true,  icon: Zap,      desc: 'Same time'    },
                    ].map(opt => (
                      <button
                        key={opt.label}
                        onClick={() => setIsConcurrent(opt.value)}
                        className={cn(
                          'p-3 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all',
                          isConcurrent === opt.value ? 'border-primary bg-primary/5 text-primary' : 'border-slate-100 bg-white text-slate-500',
                        )}
                      >
                        <opt.icon className="w-4 h-4" />
                        <p className="font-black uppercase text-[9px]">{opt.label}</p>
                        <p className="font-bold text-[8px] opacity-60">{opt.desc}</p>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleAssignTech}
                    disabled={saving}
                    className="w-full h-14 rounded-2xl bg-primary text-white font-black uppercase text-[12px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
                  >
                    {saving ? <Loader className="w-4 h-4 animate-spin" /> : <><PlusCircle className="w-5 h-5" />Assign & Notify Tech</>}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={onClose}
        className="w-full h-10 rounded-2xl border-2 border-slate-200 font-black uppercase text-[10px] text-slate-400 tracking-widest active:scale-[0.97]"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── APPOINTMENT ACTION DRAWER ────────────────────────────────────────────────
function AppointmentDrawer({ apt, service, allServices, allStaff, allShifts, currentStaffId, tenantId, firestore, onClose, onAction, onReview, onEscalate }: {
  apt: any; service: any; allServices: any[]; allStaff: any[]; allShifts: any[]; currentStaffId: string;
  tenantId: string; firestore: any;
  onClose: () => void;
  onAction: (aptId: string, action: string, apt: any) => void;
  onReview: (apt: any) => void;
  onEscalate: (apt: any) => void;
}) {
  // ── ALL hooks must come before any early return ──
  const [elapsed, setElapsed]       = useState('');
  const [isOverTime, setIsOverTime] = useState(false);
  const [showAddOn, setShowAddOn]   = useState(false);

  const start     = apt ? safeDate(apt.startTime) : new Date();
  const padBefore = service?.padBefore ?? apt?.padBefore ?? 0;
  const padAfter  = service?.padAfter  ?? apt?.padAfter  ?? 0;
  const svcDur    = service?.duration  ?? apt?.duration  ?? 60;
  const totalDur  = padBefore + svcDur + padAfter;
  const end       = addMinutes(start, totalDur);
  const st        = apt?.status || 'confirmed';

  useEffect(() => {
    if (st !== 'servicing' || !apt?.actualStartTime) return;
    const tick = () => {
      const secs = differenceInSeconds(new Date(), safeDate(apt.actualStartTime));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setElapsed(h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
        : `${m}:${String(s).padStart(2,'0')}`);
      setIsOverTime(Math.floor(secs / 60) > svcDur);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [st, apt?.actualStartTime, svcDur]);

  // Early return AFTER all hooks
  if (!apt) return null;

  const statusLabel: Record<string, string> = {
    pending: 'Pending', confirmed: 'Confirmed', servicing: 'In Service',
    ready_for_checkout: 'Ready for Checkout', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No Show',
  };
  const statusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700', confirmed: 'bg-blue-100 text-blue-700',
    servicing: 'bg-primary/10 text-primary', ready_for_checkout: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
    no_show: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end" onClick={onClose}>
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="w-full max-w-lg mx-auto bg-white rounded-t-[2.5rem] overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header info */}
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-black text-xl uppercase tracking-tight text-slate-900 truncate">{service?.name || 'Service'}</p>
              <p className="text-sm font-bold text-muted-foreground mt-0.5">
                {apt.clientName || 'Guest'} · {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
                {(padBefore > 0 || padAfter > 0) && (
                  <span className="text-[10px] font-bold opacity-50 ml-1">
                    ({svcDur}m svc{padBefore > 0 ? ` · ${padBefore}m pre` : ''}{padAfter > 0 ? ` · ${padAfter}m post` : ''})
                  </span>
                )}
              </p>
              {apt.clientPhone && <p className="text-[11px] font-bold text-muted-foreground mt-0.5">📞 {apt.clientPhone}</p>}
            </div>
            <Badge className={cn('font-black text-[10px] uppercase border-none shrink-0 mt-1', statusColor[st] || 'bg-slate-100 text-slate-600')}>
              {statusLabel[st] || st}
            </Badge>
          </div>

          {/* Live timer */}
          {st === 'servicing' && elapsed && (
            <div className={cn('rounded-2xl border-4 text-center py-3 transition-all',
              isOverTime ? 'bg-destructive/5 border-destructive/30 animate-pulse' : 'bg-primary/5 border-primary/20')}>
              <p className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-0.5">
                {isOverTime ? '⚠ Running Over' : 'Live Session Time'}
              </p>
              <p className={cn('font-black font-mono text-3xl tracking-tighter', isOverTime ? 'text-destructive' : 'text-primary')}>
                {elapsed}
              </p>
            </div>
          )}

          {/* Notes */}
          {apt.notes && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-[10px] font-black uppercase text-amber-700 mb-0.5">Client Notes</p>
              <p className="text-xs text-amber-800">{apt.notes}</p>
            </div>
          )}

          {/* Check-in status */}
          {apt.checkInStatus && !['none', undefined, null].includes(apt.checkInStatus) && !['servicing','completed'].includes(st) && (
            <div className={cn('p-2.5 rounded-xl border flex items-center gap-2',
              apt.checkInStatus === 'arrived'      ? 'bg-green-50 border-green-200' :
              apt.checkInStatus === 'running_late' ? 'bg-amber-50 border-amber-200' :
                                                     'bg-blue-50 border-blue-200')}>
              {apt.checkInStatus === 'arrived'      ? <MapPin className="w-3 h-3 text-green-600 shrink-0" /> :
               apt.checkInStatus === 'running_late' ? <Clock   className="w-3 h-3 text-amber-600 shrink-0 animate-pulse" /> :
                                                      <Car     className="w-3 h-3 text-blue-600 shrink-0" />}
              <p className={cn('text-[10px] font-black uppercase',
                apt.checkInStatus === 'arrived'      ? 'text-green-700' :
                apt.checkInStatus === 'running_late' ? 'text-amber-700' : 'text-blue-700')}>
                {apt.checkInStatus === 'arrived'      ? 'Client has arrived' :
                 apt.checkInStatus === 'running_late' ? `Running late · est. +${apt.lateTimeMinutes}min` :
                                                        'Client is on their way'}
              </p>
            </div>
          )}
        </div>

        {/* Add-on sheet — slides in when toggled */}
        <AnimatePresence>
          {showAddOn && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-slate-100 bg-slate-50">
              <MidServiceAddOnSheet
                apt={apt} service={service} allServices={allServices} allStaff={allStaff}
                allShifts={allShifts} currentStaffId={currentStaffId}
                tenantId={tenantId} firestore={firestore}
                onClose={() => setShowAddOn(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        {!showAddOn && (
          <div className="p-4 space-y-2.5">
            {/* Start */}
            {(st === 'confirmed' || st === 'pending') && (
              <button onClick={() => { onAction(apt.id, 'start', apt); onClose(); }}
                className="w-full h-14 rounded-2xl font-black uppercase text-[13px] tracking-wide flex items-center justify-center gap-3 transition-all active:scale-[0.97] bg-primary text-white shadow-lg shadow-primary/30">
                <Play className="w-5 h-5" />Start Service
              </button>
            )}

            {/* Servicing actions */}
            {st === 'servicing' && (<>
              <button onClick={() => { onReview(apt); onClose(); }}
                className="w-full h-14 rounded-2xl font-black uppercase text-[13px] tracking-wide flex items-center justify-center gap-3 transition-all active:scale-[0.97] bg-emerald-600 text-white shadow-lg shadow-emerald-500/30">
                <ShoppingCart className="w-5 h-5" />Finish Service & Review
              </button>
              <button onClick={() => setShowAddOn(true)}
                className="w-full h-12 rounded-2xl font-black uppercase text-[11px] tracking-wide flex items-center justify-center gap-2 transition-all active:scale-[0.97] border-2 border-primary/20 bg-primary/5 text-primary">
                <PlusCircle className="w-4 h-4" />Add On Mid-Service
              </button>
              <button onClick={() => { onEscalate(apt); onClose(); }}
                className="w-full h-12 rounded-2xl font-black uppercase text-[11px] tracking-wide flex items-center justify-center gap-2 transition-all active:scale-[0.97] bg-destructive/10 border-2 border-destructive/20 text-destructive">
                <ShieldAlert className="w-4 h-4" />Alert Management
              </button>
            </>)}

            {/* Ready for checkout */}
            {st === 'ready_for_checkout' && (
              <button onClick={() => { onEscalate(apt); onClose(); }}
                className="w-full h-14 rounded-2xl font-black uppercase text-[13px] tracking-wide flex items-center justify-center gap-3 transition-all active:scale-[0.97] bg-amber-500 text-white shadow-lg">
                <AlertTriangle className="w-5 h-5" />Escalate to Manager
              </button>
            )}

            {/* No show — available on any non-terminal status */}
            {!['completed','cancelled','no_show'].includes(st) && (
              <button onClick={() => { onAction(apt.id, 'noshow', apt); onClose(); }}
                className="w-full h-11 rounded-2xl font-black uppercase text-[11px] tracking-wide flex items-center justify-center gap-2 transition-all active:scale-[0.97] bg-slate-100 text-slate-600 border-2 border-slate-200">
                <XCircle className="w-4 h-4" />Mark No Show
              </button>
            )}

            {['completed','cancelled','no_show'].includes(st) && (
              <p className="text-center text-[11px] font-black uppercase text-muted-foreground opacity-30 py-2">
                No actions available
              </p>
            )}

            <button onClick={onClose}
              className="w-full h-11 rounded-2xl border-2 border-slate-200 font-black uppercase text-[11px] text-slate-400 tracking-widest hover:bg-slate-50 transition-all active:scale-[0.97]">
              Dismiss
            </button>
          </div>
        )}
        <div className="pb-6" />
      </motion.div>
    </div>
  );
}

// ─── LIVE TIMER BADGE ─────────────────────────────────────────────────────────
// Ticking timer shown on appointment blocks when status is 'servicing'
function LiveTimerBadge({ startTime, duration }: { startTime: any; duration: number }) {
  const [elapsed, setElapsed]       = useState('');
  const [isOver, setIsOver]         = useState(false);
  useEffect(() => {
    const tick = () => {
      const secs = differenceInSeconds(new Date(), safeDate(startTime));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setElapsed(h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`);
      setIsOver(Math.floor(secs / 60) > duration);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startTime, duration]);
  return (
    <div className={cn('flex items-center justify-center rounded-xl py-1 mt-0.5', isOver ? 'bg-destructive/10' : 'bg-primary/10')}>
      <p className={cn('font-black font-mono text-sm tracking-tighter', isOver ? 'text-destructive' : 'text-primary')}>{elapsed}</p>
    </div>
  );
}

// ─── COLLISION DETECTION ─────────────────────────────────────────────────────
// Groups overlapping appointments into columns for side-by-side rendering.
// Returns each apt with { colIndex, totalCols } added.
function assignColumns(apts: any[]): any[] {
  if (!apts.length) return [];
  const sorted = [...apts].sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  const result: any[] = [];
  // Each "group" tracks the end times of active columns
  const colEnds: number[] = [];

  for (const apt of sorted) {
    const svcDur   = apt._svcDur ?? apt.duration ?? 60;
    const start    = safeDate(apt.startTime).getTime();
    const end      = start + (apt.padBefore ?? 0) * 60000 + svcDur * 60000 + (apt.padAfter ?? 0) * 60000;

    // Find a free column
    let col = colEnds.findIndex(e => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); }
    else colEnds[col] = end;

    result.push({ ...apt, _colIndex: col });
  }

  // Second pass — assign totalCols per overlap group
  for (let i = 0; i < result.length; i++) {
    const apt   = result[i];
    const start = safeDate(apt.startTime).getTime();
    const svcDur = apt._svcDur ?? apt.duration ?? 60;
    const end   = start + ((apt.padBefore ?? 0) + svcDur + (apt.padAfter ?? 0)) * 60000;
    let maxCol  = apt._colIndex;
    for (const other of result) {
      const os  = safeDate(other.startTime).getTime();
      const od  = other._svcDur ?? other.duration ?? 60;
      const oe  = os + ((other.padBefore ?? 0) + od + (other.padAfter ?? 0)) * 60000;
      if (os < end && oe > start) maxCol = Math.max(maxCol, other._colIndex);
    }
    result[i] = { ...apt, _totalCols: maxCol + 1 };
  }
  return result;
}

// ─── READ-ONLY TECH PEEK SHEET ────────────────────────────────────────────────
function TechPeekSheet({ apt, tech, service, onClose }: any) {
  if (!apt) return null;
  const start  = safeDate(apt.startTime);
  const dur    = apt.duration ?? 60;
  const end    = addMinutes(start, dur);
  const st     = apt.status ?? 'confirmed';
  const stColor: Record<string, string> = {
    servicing: 'text-primary', confirmed: 'text-blue-600',
    completed: 'text-green-600', no_show: 'text-slate-500',
  };
  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-end" onClick={onClose}>
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="w-full max-w-sm mx-auto bg-white rounded-t-[2rem] overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
        <div className="px-5 py-4 space-y-4">
          {/* Tech info */}
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 rounded-2xl border-2 shrink-0">
              <AvatarImage src={tech?.avatarUrl} className="object-cover" />
              <AvatarFallback className="font-black text-sm bg-primary/10 text-primary">{(tech?.name || 'T')[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-black uppercase text-sm text-slate-900">{tech?.name?.split(' ')[0] || 'Tech'}</p>
              <p className={cn('text-[10px] font-black uppercase', stColor[st] || 'text-slate-500')}>
                {st === 'servicing' ? '● In Service' : st === 'confirmed' ? '● Confirmed' : st === 'completed' ? '✓ Done' : st}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="font-black text-sm text-slate-900">{format(start, 'h:mm a')}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">→ {format(end, 'h:mm a')}</p>
            </div>
          </div>
          {/* Service category shown but NOT client name */}
          <div className="p-3 rounded-2xl bg-slate-50 border-2 border-slate-100 flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
            <div>
              <p className="font-black uppercase text-[11px] text-slate-700">
                {apt._isWalkIn ? 'Walk-in' : (service?.category || 'Service')}
              </p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{dur}m · {apt._isWalkIn ? 'Unscheduled' : 'Scheduled'}</p>
            </div>
          </div>
          <p className="text-center text-[9px] font-black uppercase text-muted-foreground opacity-40">
            Client info is private to assigned staff
          </p>
          <button onClick={onClose} className="w-full h-11 rounded-2xl border-2 border-slate-200 font-black uppercase text-[10px] text-slate-400 tracking-widest">
            Close
          </button>
        </div>
        <div className="pb-4" />
      </motion.div>
    </div>
  );
}

// ─── FULL 24H DAY TIMELINE ────────────────────────────────────────────────────
function DayTimeline({
  appointments, services, selectedDate, onAptTap,
  allStaffApts, allWalkIns, allStaff, allStaffBlocks,
  allEvents, allShiftsForDay, currentStaffId, clockStatus,
}: {
  appointments: any[]; services: any[]; selectedDate: Date;
  onAptTap: (apt: any) => void;
  allStaffApts?: any[];    // all staff's appointments for floor view
  allWalkIns?: any[];      // all walk-ins for floor view
  allStaff?: any[];        // all staff members
  allStaffBlocks?: any[];  // sequential add-on blocks
  allEvents?: any[];       // studio events and blocked time
  allShiftsForDay?: any[]; // for capacity calculation
  currentStaffId?: string;
  clockStatus?: any;       // for break block rendering
}) {
  const scrollRef    = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [viewMode, setViewMode] = useState<'my_day' | 'floor'>('my_day');
  const [peekApt, setPeekApt]   = useState<any>(null);   // read-only peek for other tech's apt
  const isToday_     = isSameDay(selectedDate, now);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll: today → now minus 130px; other days → 8 AM
  useEffect(() => {
    if (!scrollRef.current) return;
    const target = isToday_
      ? Math.max(0, timeToPx(now) - 130)
      : 8 * 60 * PX_PER_MIN - 30;
    scrollRef.current.scrollTo({ top: target, behavior: 'smooth' });
  }, [selectedDate]); // eslint-disable-line

  const dayApts = useMemo(() => {
    if (!appointments) return [];
    return appointments
      .filter(a => isSameDay(safeDate(a.startTime), selectedDate) && a.status !== 'cancelled')
      .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  }, [appointments, selectedDate]);

  // ── Floor view data ──────────────────────────────────────────────────────────
  // Techs on shift today (for column headers)
  const todayStr = format(selectedDate, 'yyyy-MM-dd');

  // Build per-tech columns for floor view
  const floorColumns = useMemo(() => {
    if (!allStaff || !allStaffApts) return [];
    const staffOnShift = allStaff; // show all staff, grey out if not on shift

    return staffOnShift.map((tech: any) => {
      const isMe = tech.id === currentStaffId;

      // This tech's appointments today
      const techApts = (allStaffApts || [])
        .filter((a: any) =>
          a.staffId === tech.id &&
          isSameDay(safeDate(a.startTime), selectedDate) &&
          a.status !== 'cancelled'
        )
        .map((a: any) => {
          const svc = (services || []).find((s: any) => s.id === a.serviceId);
          return {
            ...a,
            _svcDur:    svc?.duration   ?? a.duration   ?? 60,
            _padBefore: svc?.padBefore  ?? a.padBefore  ?? 0,
            _padAfter:  svc?.padAfter   ?? a.padAfter   ?? 0,
            _isMe: isMe,
            _isWalkIn: false,
          };
        });

      // This tech's walk-ins today
      const techWalkIns = (allWalkIns || [])
        .filter((w: any) =>
          w.staffId === tech.id &&
          isSameDay(safeDate(w.checkInTime || w.startTime || new Date()), selectedDate) &&
          !['cancelled'].includes(w.status)
        )
        .map((w: any) => ({
          ...w,
          startTime: w.startTime || w.checkInTime,
          _svcDur: w.estimatedDuration || 30,
          _padBefore: 0, _padAfter: 0,
          _isMe: isMe,
          _isWalkIn: true,
        }));

      // Sequential add-on staff blocks
      const techBlocks = (allStaffBlocks || [])
        .filter((b: any) =>
          b.staffId === tech.id &&
          isSameDay(safeDate(b.startTime), selectedDate)
        )
        .map((b: any) => ({
          ...b,
          _svcDur: b.duration ?? 30,
          _padBefore: 0, _padAfter: 0,
          _isMe: isMe,
          _isWalkIn: false,
          _isBlock: true,
        }));

      const all = [...techApts, ...techWalkIns, ...techBlocks];
      const withCols = assignColumns(all);

      return { tech, isMe, items: withCols };
    }).sort((a: any, b: any) => {
      // My column always first
      if (a.isMe) return -1;
      if (b.isMe) return 1;
      return (a.tech.name || '').localeCompare(b.tech.name || '');
    });
  }, [allStaff, allStaffApts, allWalkIns, allStaffBlocks, services, selectedDate, currentStaffId]);

  // My Day: collision-aware layout for own appointments
  const myDayWithCols = useMemo(() => {
    const enriched = dayApts.map(a => {
      const svc = (services || []).find((s: any) => s.id === a.serviceId);
      return {
        ...a,
        _svcDur:    svc?.duration   ?? a.duration   ?? 60,
        _padBefore: svc?.padBefore  ?? a.padBefore  ?? 0,
        _padAfter:  svc?.padAfter   ?? a.padAfter   ?? 0,
      };
    });
    return assignColumns(enriched);
  }, [dayApts, services]);

  const hours = Array.from({ length: 25 }, (_, i) => i); // 0–24

  // Visual ring / colour per status
  const ringCls: Record<string, string> = {
    servicing:          'border-primary ring-2 ring-primary/30 bg-primary/5 shadow-md shadow-primary/10',
    ready_for_checkout: 'border-emerald-400 ring-2 ring-emerald-300/30 bg-emerald-50',
    completed:          'border-green-300 bg-green-50',
    no_show:            'border-slate-200 bg-slate-50 opacity-40',
    confirmed:          'border-primary/30 bg-white shadow-sm',
    pending:            'border-amber-300 bg-amber-50/60',
  };
  const dotCls: Record<string, string> = {
    servicing: 'bg-primary animate-pulse', ready_for_checkout: 'bg-emerald-500',
    completed: 'bg-green-500', no_show: 'bg-slate-400',
    confirmed: 'bg-blue-400', pending: 'bg-amber-400',
  };
  const statusTxt: Record<string, string> = {
    servicing: 'In Service', ready_for_checkout: 'Checkout Queue',
    completed: '✓ Done', no_show: 'No Show',
    confirmed: 'Confirmed', pending: 'Pending',
  };

  return (
    <div className="rounded-[2rem] border-2 border-slate-100 bg-white flex flex-col">
      {/* ── Header with mode toggle ── */}
      <div className="px-4 py-3 border-b bg-white flex items-center justify-between shrink-0 rounded-t-[2rem]">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
          {isToday_ ? "Today's Timeline" : format(selectedDate, 'EEE, MMM d')}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-[9px] font-black uppercase text-primary">
            {dayApts.length} apt{dayApts.length !== 1 ? 's' : ''}
          </p>
          {/* View mode toggle — only shown when floor data is available */}
          {(allStaff?.length ?? 0) > 1 && (
            <div className="flex items-center bg-slate-100 rounded-xl p-0.5 ml-1">
              <button
                onClick={() => setViewMode('my_day')}
                className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all',
                  viewMode === 'my_day' ? 'bg-white text-primary shadow-sm' : 'text-slate-500')}
              >
                <User className="w-2.5 h-2.5" />My Day
              </button>
              <button
                onClick={() => setViewMode('floor')}
                className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all',
                  viewMode === 'floor' ? 'bg-white text-primary shadow-sm' : 'text-slate-500')}
              >
                <Users className="w-2.5 h-2.5" />Floor
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════
          MY DAY VIEW — collision-aware own apt layout
          ════════════════════════════════════════════ */}
      {viewMode === 'my_day' && (
        <div ref={scrollRef} className="overflow-y-auto rounded-b-[2rem]" style={{ height: 460 }}>
          <div className="relative overflow-hidden" style={{ height: TIMELINE_H }}>
            {/* Hour grid lines */}
            {hours.map(h => {
              const topPx = h * 60 * PX_PER_MIN;
              const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
              return (
                <div key={h} className="absolute left-0 right-0 flex items-center pointer-events-none" style={{ top: topPx }}>
                  <span className="text-[8px] font-black text-slate-400 w-12 text-right pr-2 shrink-0 leading-none select-none bg-white z-10">{label}</span>
                  <div className={cn('flex-1 border-t', h % 6 === 0 ? 'border-slate-200' : 'border-dashed border-slate-100')} />
                </div>
              );
            })}

            {/* Now indicator */}
            {isToday_ && (
              <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: timeToPx(now) }}>
                <div className="w-3 h-3 rounded-full bg-rose-500 ml-10 shrink-0 ring-2 ring-white shadow-md shadow-rose-400/60" />
                <div className="flex-1 h-[2px] bg-rose-500 opacity-80" />
                <span className="text-[8px] font-black text-rose-500 pr-2 shrink-0 bg-white/90 rounded px-1">{format(now, 'h:mm a')}</span>
              </div>
            )}

            {/* ── EVENT BLOCKS ──────────────────────────────────────────
                 Logic:
                 1. allDay flag OR duration ≥ 1 full day (1440m)
                    → full-height background wash behind all blocks (z-5)
                    → no top/height positioning needed — fills entire column
                 2. Multi-day event spanning today
                    → starts at midnight (top=0) if event started before today
                    → ends at midnight (bottom=TIMELINE_H) if event ends after today
                 3. Timed single-day event
                    → precise top/height from actual startTime → endTime
                 ──────────────────────────────────────────────────────────── */}
            {(allEvents || [])
              .filter((e: any) => {
                // Only show if event is global (no staffIds) OR includes this staff member
                const staffIds: string[] = e.staffIds || [];
                const isGlobal = staffIds.length === 0;
                const isForMe  = currentStaffId ? staffIds.includes(currentStaffId) : false;
                if (!isGlobal && !isForMe) return false;
                // Include if event covers selectedDate at all
                const evS = safeDate(e.startTime || e.date || e.start);
                const evE = e.endTime ? safeDate(e.endTime) : e.allDay ? addMinutes(evS, 1440) : addMinutes(evS, e.duration || 60);
                const dayStart = startOfDay(selectedDate);
                const dayEnd   = addMinutes(dayStart, 1440);
                return evS < dayEnd && evE > dayStart;
              })
              .map((e: any) => {
                const evS    = safeDate(e.startTime || e.date || e.start);
                const evE    = e.endTime ? safeDate(e.endTime) : e.allDay ? addMinutes(evS, 1440) : addMinutes(evS, e.duration || 60);
                const dayStart = startOfDay(selectedDate);
                const dayEnd   = addMinutes(dayStart, 1440);

                // Is this an all-day or multi-day event?
                const spansDays = differenceInMinutes(evE, evS) >= 1440 || e.allDay;

                // Clamp to today's visible window
                const clampedStart = evS < dayStart ? dayStart : evS;
                const clampedEnd   = evE > dayEnd   ? dayEnd   : evE;
                const evTop  = spansDays ? 0 : timeToPx(clampedStart);
                const evH    = spansDays ? TIMELINE_H : Math.max(28, differenceInMinutes(clampedEnd, clampedStart) * PX_PER_MIN);

                // Colour by event type
                const evBg = e.type === 'blocked'  ? 'bg-slate-800/10 border-slate-400/30' :
                             e.type === 'holiday'  ? 'bg-rose-500/10 border-rose-400/30' :
                             e.type === 'training' ? 'bg-amber-500/10 border-amber-400/30' :
                                                     'bg-indigo-500/10 border-indigo-400/30';
                const evText = e.type === 'blocked'  ? 'text-slate-600' :
                               e.type === 'holiday'  ? 'text-rose-600' :
                               e.type === 'training' ? 'text-amber-700' :
                                                       'text-indigo-600';

                return (
                  <div
                    key={e.id}
                    className={cn(
                      'absolute left-12 right-0 pointer-events-none overflow-hidden',
                      spansDays
                        ? `${evBg} border-l-4 z-5`           // all-day: full wash, left accent
                        : `${evBg} border-2 rounded-xl z-10`, // timed: precise block
                    )}
                    style={{ top: evTop, height: evH }}
                  >
                    {/* Label — pinned to top-left so it's always visible */}
                    <div className="sticky top-0 flex items-center gap-1.5 px-2 py-1">
                      <CalendarDays className={cn('w-2.5 h-2.5 shrink-0', evText)} />
                      <p className={cn('text-[7px] font-black uppercase truncate', evText)}>
                        {e.title || e.name || 'Event'}
                        {spansDays && !e.allDay && (
                          <span className="opacity-60 ml-1 normal-case font-bold">
                            {format(evS, 'MMM d')}–{format(evE, 'MMM d')}
                          </span>
                        )}
                      </p>
                      {!spansDays && (
                        <p className={cn('text-[6px] font-bold uppercase shrink-0 ml-auto opacity-70', evText)}>
                          {format(clampedStart, 'h:mm')}–{format(clampedEnd, 'h:mm a')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

            {/* Break block — amber hatched block while tech is on break */}
            {clockStatus?.isOnBreak && clockStatus?.breakStartTime && isToday_ && (
              <div
                className="absolute left-14 right-2 z-25 rounded-2xl overflow-hidden pointer-events-none"
                style={{
                  top: timeToPx(clockStatus.breakStartTime),
                  height: Math.max(40, differenceInMinutes(now, clockStatus.breakStartTime) * PX_PER_MIN),
                }}
              >
                <div className="h-full w-full bg-amber-400/20 border-2 border-dashed border-amber-400 flex flex-col items-center justify-center gap-0.5">
                  <Coffee className="w-3 h-3 text-amber-600 animate-pulse" />
                  <p className="text-[7px] font-black uppercase text-amber-700 tracking-widest">
                    On Break · {clockStatus.breakMinutes}m
                  </p>
                </div>
              </div>
            )}

            {/* Appointment blocks — collision-aware side-by-side */}
            {myDayWithCols.map(apt => {
              const start      = safeDate(apt.startTime);
              const padBefore  = apt._padBefore ?? 0;
              const padAfter   = apt._padAfter  ?? 0;
              const svcDur     = apt._svcDur    ?? apt.duration ?? 60;
              const totalDur   = padBefore + svcDur + padAfter;
              const topPx      = timeToPx(start);
              const totalH     = Math.max(MIN_BLOCK, totalDur * PX_PER_MIN);
              const padBPx     = padBefore > 0 ? Math.max(16, padBefore * PX_PER_MIN) : 0;
              const padAPx     = padAfter  > 0 ? Math.max(16, padAfter  * PX_PER_MIN) : 0;
              const svcH       = Math.max(MIN_BLOCK, totalH - padBPx - padAPx);
              const st         = apt.status || 'confirmed';
              const isPast     = addMinutes(start, totalDur) < now && isToday_;

              // Collision layout: left/width based on column assignment
              const colIdx   = apt._colIndex   ?? 0;
              const totalCols = apt._totalCols  ?? 1;
              const availW   = '100%';
              const leftPct  = totalCols > 1 ? `calc(52px + ${(colIdx / totalCols) * (100 - 14)}%)` : undefined;
              const widthPct = totalCols > 1 ? `calc(${(1 / totalCols) * (100 - 14)}% - 4px)` : undefined;

              // Multi-staff indicators
              const concurrentIds = apt.checkoutState?.concurrentServiceIds || [];
              const overrideEntries = Object.entries(apt.checkoutState?.serviceStaffOverrides || {});
              // Add-on techs: any override where the service is not the primary service
              // Includes self-assigned add-ons (staffId === currentStaffId)
              const addOnTechs = overrideEntries
                .filter(([svcId]: any) => svcId !== apt.serviceId)
                .map(([, staffId]) => (allStaff || []).find((s: any) => s.id === staffId)
                  || (staffId === currentStaffId ? { id: currentStaffId, name: 'You', _isSelf: true } : null))
                .filter(Boolean);
              const hasSelfAddOn  = addOnTechs.some((t: any) => t?.id === currentStaffId || t?._isSelf);
              const hasMultiStaff = addOnTechs.length > 0;
              const isConcurrent  = concurrentIds.length > 0;

              const isAddOnTech = apt.checkoutState?.serviceStaffOverrides &&
                overrideEntries.some(([svcId, staffId]: any) => staffId === apt._viewingStaffId && svcId !== apt.serviceId);

              return (
                <div
                  key={apt.id}
                  className="absolute z-30 flex flex-col"
                  style={totalCols > 1
                    ? { top: topPx, height: totalH, left: leftPct, width: widthPct }
                    : { top: topPx, height: totalH, left: '56px', right: '8px' }
                  }
                >
                  {/* Pre-pad */}
                  {padBefore > 0 && (
                    <div className="shrink-0 rounded-t-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 flex items-center px-2 gap-1 overflow-hidden" style={{ height: padBPx }}>
                      <div className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                      <span className="text-[7px] font-black uppercase text-slate-400 tracking-widest truncate">{padBefore}m prep</span>
                    </div>
                  )}

                  {/* Service zone */}
                  <button
                    onClick={() => onAptTap(apt)}
                    className={cn(
                      'flex-1 text-left pointer-events-auto cursor-pointer transition-all active:scale-[0.97] active:brightness-95',
                      padBefore > 0 && padAfter > 0 ? 'rounded-none border-x-2 border-b-0 border-t-0' :
                      padBefore > 0 ? 'rounded-b-2xl border-2 border-t-0' :
                      padAfter  > 0 ? 'rounded-t-2xl border-2 border-b-0' : 'rounded-2xl border-2',
                      apt.isEscalated ? 'border-destructive ring-2 ring-destructive/30 bg-destructive/5 animate-pulse' :
                      ringCls[st] || 'border-primary/20 bg-white shadow-sm',
                      isPast && st !== 'completed' && !apt.isEscalated && 'opacity-55',
                    )}
                    style={{ height: svcH }}
                  >
                    <div className="p-3 h-full flex flex-col gap-1 overflow-hidden">
                      {/* Escalated banner */}
                      {apt.isEscalated && (
                        <div className="flex items-center gap-1 mb-0.5">
                          <ShieldAlert className="w-2.5 h-2.5 text-destructive shrink-0" />
                          <span className="text-[7px] font-black uppercase text-destructive tracking-widest">Manager Alerted</span>
                        </div>
                      )}
                      {/* Service name + dot + check-in */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotCls[st] || 'bg-slate-400')} />
                        <p className="font-black text-[11px] uppercase truncate text-slate-800 flex-1">
                          {(services || []).find((s: any) => s.id === apt.serviceId)?.name || 'Service'}
                        </p>
                        {apt.checkInStatus === 'arrived'      && <span className="shrink-0 text-[7px] font-black uppercase bg-green-500 text-white rounded-md px-1 py-0.5">HERE</span>}
                        {apt.checkInStatus === 'running_late' && <span className="shrink-0 text-[7px] font-black uppercase bg-amber-500 text-white rounded-md px-1 py-0.5 animate-pulse">+{apt.lateTimeMinutes}M</span>}
                        {apt.checkInStatus === 'on_my_way'    && <span className="shrink-0 text-[7px] font-black uppercase bg-blue-500 text-white rounded-md px-1 py-0.5">EN ROUTE</span>}
                      </div>
                      {/* Time + client */}
                      <p className="text-[9px] font-bold text-muted-foreground uppercase pl-3 truncate">
                        {format(start, 'h:mm a')} · {apt.clientName?.split(' ')[0] || 'Guest'}
                      </p>
                      {/* Padding summary */}
                      {(padBefore > 0 || padAfter > 0) && (
                        <p className="text-[8px] font-bold text-muted-foreground opacity-50 uppercase pl-3 truncate">
                          {svcDur}m svc{padBefore > 0 ? ` · ${padBefore}m pre` : ''}{padAfter > 0 ? ` · ${padAfter}m post` : ''}
                        </p>
                      )}
                      {/* Multi-staff badge */}
                      {hasMultiStaff && (
                        <div className={cn('flex items-center gap-1 ml-3 px-1.5 py-0.5 rounded-lg w-fit',
                          hasSelfAddOn ? 'bg-teal-100 text-teal-700' :
                          isConcurrent ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700')}>
                          <Zap className="w-2.5 h-2.5 shrink-0" />
                          <span className="text-[7px] font-black uppercase tracking-widest">
                            {hasSelfAddOn
                              ? `Self · +Add-on`
                              : isConcurrent
                                ? `Concurrent · ${addOnTechs.length + 1} techs`
                                : `Sequential · ${addOnTechs.length + 1} techs`}
                          </span>
                          {!hasSelfAddOn && (
                            <div className="flex -space-x-1 ml-0.5">
                              {addOnTechs.slice(0, 2).map((t: any) => (
                                <Avatar key={t.id} className="h-3.5 w-3.5 border border-white rounded-full shrink-0">
                                  <AvatarImage src={t.avatarUrl} className="object-cover" />
                                  <AvatarFallback className="text-[5px] font-black">{t.name?.[0]}</AvatarFallback>
                                </Avatar>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Add-on tech badge */}
                      {isAddOnTech && <span className="text-[7px] font-black uppercase bg-purple-100 text-purple-700 rounded-md px-1.5 py-0.5 w-fit ml-3">ADD-ON</span>}
                      {/* Live timer */}
                      {st === 'servicing' && apt.actualStartTime && <LiveTimerBadge startTime={apt.actualStartTime} duration={svcDur} />}
                      {/* Status */}
                      <div className="flex items-center justify-between mt-auto pl-3">
                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-50">{statusTxt[st] || st}</span>
                        <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-primary bg-primary/10 rounded-lg px-1.5 py-0.5">
                          <ChevronUp className="w-2.5 h-2.5" />Actions
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Post-pad */}
                  {padAfter > 0 && (
                    <div className="shrink-0 rounded-b-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 flex items-center px-2 gap-1 overflow-hidden" style={{ height: padAPx }}>
                      <div className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                      <span className="text-[7px] font-black uppercase text-slate-400 tracking-widest truncate">{padAfter}m buffer</span>
                    </div>
                  )}
                </div>
              );
            })}

            {dayApts.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingTop: 8 * 60 * PX_PER_MIN }}>
                <div className="text-center opacity-20">
                  <Scissors className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest">No appointments</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          FLOOR VIEW — horizontally scrollable columns
          ════════════════════════════════════════════ */}
      {viewMode === 'floor' && (
        <div className="flex flex-col rounded-b-[2rem] overflow-hidden" style={{ height: 460 }}>
          {/* Column headers — sticky */}
          <div className="flex shrink-0 border-b border-slate-100 bg-white">
            {/* Time gutter spacer */}
            <div style={{ width: FLOOR_TIME_GUTTER, minWidth: FLOOR_TIME_GUTTER }} className="shrink-0" />
            {/* Horizontally scrollable headers — sync scroll with body */}
            <div className="flex overflow-x-auto scrollbar-hide" id="floor-header-scroll">
              {floorColumns.map(({ tech, isMe }) => (
                <div
                  key={tech.id}
                  style={{ minWidth: isMe ? FLOOR_MY_COL : FLOOR_OTHER_COL, width: isMe ? FLOOR_MY_COL : FLOOR_OTHER_COL }}
                  className={cn('shrink-0 px-2 py-2 border-r border-slate-100 flex flex-col items-center gap-1',
                    isMe ? 'bg-primary/5 border-primary/10' : 'bg-white')}
                >
                  <Avatar className={cn('rounded-xl border-2 shrink-0', isMe ? 'h-8 w-8 border-primary/30' : 'h-6 w-6 border-slate-200')}>
                    <AvatarImage src={tech.avatarUrl} className="object-cover" />
                    <AvatarFallback className={cn('font-black', isMe ? 'text-xs bg-primary/10 text-primary' : 'text-[8px] bg-slate-100 text-slate-500')}>
                      {(tech.name || 'T')[0]}
                    </AvatarFallback>
                  </Avatar>
                  <p className={cn('font-black uppercase truncate text-center', isMe ? 'text-[9px] text-primary' : 'text-[8px] text-slate-500')}>
                    {isMe ? `★ ${tech.name?.split(' ')[0]}` : tech.name?.split(' ')[0]}
                  </p>
                  {/* On-break indicator in column header */}
                  {isMe && clockStatus?.isOnBreak && (
                    <span className="text-[6px] font-black uppercase bg-amber-400 text-amber-900 rounded px-1 animate-pulse">
                      Break
                    </span>
                  )}
                  {/* Tech status dot for other techs */}
                  {!isMe && (() => {
                    const techObj = (allStaff || []).find((s: any) => s.id === tech.id);
                    const techStatus = techObj?.status;
                    return techStatus ? (
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                        techStatus === 'busy'     ? 'bg-primary animate-pulse' :
                        techStatus === 'on_break' ? 'bg-amber-400 animate-pulse' :
                        techStatus === 'available'? 'bg-green-400' :
                        techStatus === 'off'      ? 'bg-slate-300' : 'bg-slate-300',
                      )} />
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
          </div>

          {/* Floor at capacity banner */}
          {(() => {
if (!allStaff) return null;
            const todayStr2 = format(selectedDate, 'yyyy-MM-dd');
            const onShiftIds = (allShiftsForDay || [])
              .filter((s: any) => s.date === todayStr2 && s.status !== 'cancelled' && s.status !== 'draft')
              .map((s: any) => s.staffId);
            if (onShiftIds.length === 0) return null;
            const allBusy = onShiftIds.every((id: string) => {
              const tech = (allStaff || []).find((s: any) => s.id === id);
              return tech?.status === 'busy' || tech?.status === 'on_break';
            });
            if (!allBusy) return null;
            return (
              <div className="px-3 py-1.5 bg-rose-500 flex items-center justify-center gap-2 shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
                <p className="text-[9px] font-black uppercase text-white tracking-widest">
                  Floor at Capacity — All Techs Busy
                </p>
              </div>
            );
          })()}

          {/* Scrollable body */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto"
            onScroll={e => {
              // Sync horizontal scroll of header
              const hdr = document.getElementById('floor-header-scroll');
              if (hdr) hdr.scrollLeft = (e.target as HTMLElement).scrollLeft;
            }}
          >
            <div className="relative flex" style={{ height: TIMELINE_H }}>

              {/* ── Cross-column event banners — rendered over all columns ── */}
              {(allEvents || [])
                .filter((e: any) => {
                  // Cross-column banner: only truly global events (no staffIds assigned)
                  const staffIds: string[] = e.staffIds || [];
                  return staffIds.length === 0 && isSameDay(safeDate(e.startTime || e.date), selectedDate);
                })
                .map((e: any) => {
                  const evStart  = safeDate(e.startTime || e.date);
                  const evEnd    = e.endTime ? safeDate(e.endTime) : addMinutes(evStart, e.duration || 60);
                  const evDur    = differenceInMinutes(evEnd, evStart);
                  const evTop    = timeToPx(evStart);
                  const evH      = e.allDay ? 20 : Math.max(24, evDur * PX_PER_MIN);
                  const evColor  = e.type === 'blocked'  ? 'bg-slate-800/75 border-slate-600' :
                                   e.type === 'holiday'  ? 'bg-rose-500/75 border-rose-400'   :
                                                           'bg-indigo-500/75 border-indigo-400';
                  // left offset = time gutter + starts after gutter
                  return (
                    <div
                      key={`ev-floor-${e.id}`}
                      className={cn(
                        'absolute z-40 flex items-center gap-1.5 px-2 overflow-hidden pointer-events-none border',
                        evColor,
                      )}
                      style={{
                        top: evTop,
                        height: evH,
                        left: FLOOR_TIME_GUTTER,
                        right: 0,
                        opacity: 0.88,
                      }}
                    >
                      <CalendarDays className="w-2.5 h-2.5 text-white shrink-0" />
                      <p className="text-[7px] font-black uppercase text-white truncate flex-1">
                        {e.title || e.name || 'Event'}
                      </p>
                      {!e.allDay && (
                        <p className="text-[6px] font-bold text-white/70 uppercase shrink-0">
                          {format(evStart, 'h:mm')}–{format(evEnd, 'h:mm')}
                        </p>
                      )}
                    </div>
                  );
                })}

              {/* Fixed time gutter */}
              <div className="relative shrink-0" style={{ width: FLOOR_TIME_GUTTER, minWidth: FLOOR_TIME_GUTTER }}>
                {hours.map(h => {
                  const topPx = h * 60 * PX_PER_MIN;
                  const label = h === 0 ? '12A' : h < 12 ? `${h}A` : h === 12 ? '12P' : `${h-12}P`;
                  return (
                    <div key={h} className="absolute right-0 flex items-center justify-end pr-1.5 pointer-events-none" style={{ top: topPx }}>
                      <span className="text-[7px] font-black text-slate-400 leading-none select-none">{label}</span>
                    </div>
                  );
                })}
                {/* Now indicator dot */}
                {isToday_ && (
                  <div className="absolute right-0 w-full z-20 pointer-events-none" style={{ top: timeToPx(now) }}>
                    <div className="w-2 h-2 rounded-full bg-rose-500 ml-auto mr-1 ring-1 ring-white" />
                  </div>
                )}
              </div>

              {/* Tech columns */}
              {floorColumns.map(({ tech, isMe, items }) => {
                const colW = isMe ? FLOOR_MY_COL : FLOOR_OTHER_COL;
                return (
                  <div
                    key={tech.id}
                    className={cn('relative shrink-0 border-r border-slate-100', isMe ? 'bg-primary/[0.01]' : 'bg-white')}
                    style={{ width: colW, minWidth: colW, height: TIMELINE_H }}
                  >
                    {/* Hour grid lines for this column */}
                    {hours.map(h => (
                      <div
                        key={h}
                        className={cn('absolute left-0 right-0 border-t pointer-events-none',
                          h % 6 === 0 ? 'border-slate-200' : 'border-dashed border-slate-100')}
                        style={{ top: h * 60 * PX_PER_MIN }}
                      />
                    ))}

                    {/* Now line */}
                    {isToday_ && (
                      <div className="absolute left-0 right-0 h-[2px] bg-rose-500/60 z-20 pointer-events-none" style={{ top: timeToPx(now) }} />
                    )}

                    {/* Event overlays for this column — show if global OR assigned to this tech */}
                    {(allEvents || [])
                      .filter((e: any) => {
                        const staffIds: string[] = e.staffIds || [];
                        const isGlobal  = staffIds.length === 0;
                        const isForTech = staffIds.includes(tech.id);
                        return (isGlobal || isForTech) && isSameDay(safeDate(e.startTime || e.date), selectedDate);
                      })
                      .map((e: any) => {
                        const evStart = safeDate(e.startTime || e.date);
                        const evEnd   = e.endTime ? safeDate(e.endTime) : addMinutes(evStart, e.duration || 60);
                        const evDur   = differenceInMinutes(evEnd, evStart);
                        const evTop   = timeToPx(evStart);
                        const evH     = Math.max(20, evDur * PX_PER_MIN);
                        return (
                          <div key={e.id}
                            className="absolute left-0 right-0 z-10 flex items-center justify-center overflow-hidden pointer-events-none bg-indigo-400/15 border-y border-indigo-300/40"
                            style={{ top: evTop, height: e.allDay ? 16 : evH }}>
                            {isMe && (
                              <p className="text-[6px] font-black uppercase text-indigo-600 truncate px-1">
                                {e.title || e.name || 'Event'}
                              </p>
                            )}
                          </div>
                        );
                      })}

                    {/* Break overlay for this tech's column */}
                    {isMe && clockStatus?.isOnBreak && clockStatus?.breakStartTime && isToday_ && (
                      <div
                        className="absolute left-0 right-0 z-25 overflow-hidden pointer-events-none"
                        style={{
                          top: timeToPx(clockStatus.breakStartTime),
                          height: Math.max(32, differenceInMinutes(now, clockStatus.breakStartTime) * PX_PER_MIN),
                        }}
                      >
                        <div className="h-full w-full bg-amber-400/20 border-y-2 border-dashed border-amber-400 flex items-center justify-center gap-1">
                          <Coffee className="w-2.5 h-2.5 text-amber-600 animate-pulse shrink-0" />
                          <p className="text-[6px] font-black uppercase text-amber-700">Break</p>
                        </div>
                      </div>
                    )}
                    {/* Other tech on break — amber column tint */}
                    {!isMe && tech.status === 'on_break' && (
                      <div className="absolute inset-0 bg-amber-400/8 pointer-events-none z-5" />
                    )}

                    {/* Appointment / walk-in / block items */}
                    {items.map((item: any) => {
                      const start    = safeDate(item.startTime || item.checkInTime);
                      const dur      = item._svcDur ?? 30;
                      const padB     = item._padBefore ?? 0;
                      const padA     = item._padAfter  ?? 0;
                      const totalDur = padB + dur + padA;
                      const topPx    = timeToPx(start);
                      const totalH   = Math.max(isMe ? MIN_BLOCK : 32, totalDur * PX_PER_MIN);
                      const padBPx   = padB > 0 ? Math.max(12, padB * PX_PER_MIN) : 0;
                      const padAPx   = padA > 0 ? Math.max(12, padA * PX_PER_MIN) : 0;
                      const svcH     = Math.max(isMe ? MIN_BLOCK : 32, totalH - padBPx - padAPx);
                      const st       = item.status || 'confirmed';

                      // Column layout within this tech's column
                      const colIdx   = item._colIndex  ?? 0;
                      const totCols  = item._totalCols ?? 1;
                      const leftPx   = totCols > 1 ? (colIdx / totCols) * colW : 2;
                      const widthPx  = totCols > 1 ? (colW / totCols) - 2 : colW - 4;

                      // Walk-in styling
                      if (item._isWalkIn) {
                        return (
                          <div
                            key={item.id}
                            className="absolute z-30 flex flex-col"
                            style={{ top: topPx, height: totalH, left: leftPx, width: widthPx }}
                          >
                            <button
                              onClick={() => isMe ? onAptTap(item) : setPeekApt({ apt: item, tech })}
                              className={cn(
                                'flex-1 rounded-xl border-2 text-left transition-all active:scale-[0.97] overflow-hidden',
                                isMe
                                  ? 'bg-teal-500 border-teal-600 shadow-md shadow-teal-500/20'
                                  : 'bg-teal-100 border-teal-200 cursor-default',
                              )}
                              style={{ height: svcH }}
                            >
                              <div className="p-1.5 h-full flex flex-col gap-0.5 overflow-hidden">
                                <div className="flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-white/80 shrink-0 animate-pulse" />
                                  <p className={cn('font-black text-[9px] uppercase truncate', isMe ? 'text-white' : 'text-teal-700')}>
                                    {isMe ? (item.customerName || item.clientName || 'Walk-in')?.split(' ')[0] : 'Walk-in'}
                                  </p>
                                </div>
                                {isMe && (
                                  <p className="text-[8px] font-bold text-white/70 uppercase pl-2.5 truncate">
                                    {format(start, 'h:mm a')} · {dur}m
                                  </p>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      }

                      // Staff block (sequential add-on)
                      if (item._isBlock) {
                        return (
                          <div
                            key={item.id}
                            className="absolute z-30"
                            style={{ top: topPx, height: Math.max(24, totalH), left: leftPx + 2, width: widthPx - 4 }}
                          >
                            <div className="h-full rounded-xl border-2 border-dashed border-purple-300 bg-purple-50/80 flex flex-col items-center justify-center p-1 overflow-hidden">
                              <Zap className="w-2.5 h-2.5 text-purple-500 shrink-0" />
                              <p className="text-[7px] font-black uppercase text-purple-600 truncate">{dur}m add-on</p>
                            </div>
                          </div>
                        );
                      }

                      // Regular appointment
                      const isEsc = item.isEscalated;
                      const statusDot: Record<string,string> = {
                        servicing: 'bg-primary animate-pulse', confirmed: 'bg-blue-400',
                        completed: 'bg-green-500', no_show: 'bg-slate-400', pending: 'bg-amber-400',
                        ready_for_checkout: 'bg-emerald-500',
                      };
                      const myBg: Record<string,string> = {
                        servicing: 'bg-primary/5 border-primary/30 shadow-md shadow-primary/10',
                        confirmed: 'bg-white border-primary/20 shadow-sm',
                        completed: 'bg-green-50 border-green-200',
                        ready_for_checkout: 'bg-emerald-50 border-emerald-300',
                        no_show: 'bg-slate-50 border-slate-200 opacity-40',
                        pending: 'bg-amber-50 border-amber-200',
                      };
                      // Multi-staff indicator
                      const overrides = Object.entries(item.checkoutState?.serviceStaffOverrides || {});
                      const concIds = item.checkoutState?.concurrentServiceIds || [];
                      const addOnTs = overrides
                        .filter(([sid, sid2]: any) => sid !== item.serviceId)
                        .map(([, techId]) => (allStaff || []).find((s: any) => s.id === techId))
                        .filter(Boolean);

                      return (
                        <div
                          key={item.id}
                          className="absolute z-30 flex flex-col"
                          style={{ top: topPx, height: totalH, left: leftPx, width: widthPx }}
                        >
                          {/* Pre-pad */}
                          {padB > 0 && (
                            <div className="shrink-0 rounded-t-xl border border-dashed border-slate-200 bg-slate-50 flex items-center px-1 overflow-hidden" style={{ height: padBPx }}>
                              <span className="text-[6px] font-black uppercase text-slate-400 truncate">{padB}m</span>
                            </div>
                          )}

                          <button
                            onClick={() => isMe ? onAptTap(item) : setPeekApt({ apt: item, tech, service: (services||[]).find((s: any) => s.id === item.serviceId) })}
                            className={cn(
                              'flex-1 text-left transition-all overflow-hidden',
                              padB > 0 && padA > 0 ? 'rounded-none border-x border-b-0 border-t-0' :
                              padB > 0 ? 'rounded-b-xl border border-t-0' :
                              padA > 0 ? 'rounded-t-xl border border-b-0' : 'rounded-xl border',
                              isMe
                                ? (isEsc ? 'border-destructive bg-destructive/5 ring-1 ring-destructive/20 animate-pulse' : (myBg[st] || 'bg-white border-slate-200'))
                                : 'bg-slate-100 border-slate-200 cursor-default',
                              !isMe && 'opacity-70',
                            )}
                            style={{ height: svcH }}
                          >
                            <div className="p-1.5 h-full flex flex-col gap-0.5 overflow-hidden">
                              <div className="flex items-center gap-1 min-w-0">
                                <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', isMe ? (statusDot[st] || 'bg-slate-400') : 'bg-slate-400')} />
                                {isMe ? (
                                  <p className="font-black text-[9px] uppercase truncate text-slate-800 flex-1">
                                    {(services||[]).find((s: any) => s.id === item.serviceId)?.name || 'Svc'}
                                  </p>
                                ) : (
                                  <p className="font-black text-[9px] uppercase text-slate-500 truncate flex-1">Booked</p>
                                )}
                              </div>
                              {isMe && (
                                <>
                                  <p className="text-[8px] font-bold text-muted-foreground uppercase pl-2.5 truncate">
                                    {format(start, 'h:mm')} · {item.clientName?.split(' ')[0] || 'Guest'}
                                  </p>
                                  {/* Check-in badge */}
                                  {item.checkInStatus === 'arrived'      && <span className="text-[6px] font-black uppercase bg-green-500 text-white rounded px-1 w-fit ml-2.5">HERE</span>}
                                  {item.checkInStatus === 'running_late' && <span className="text-[6px] font-black uppercase bg-amber-500 text-white rounded px-1 w-fit ml-2.5 animate-pulse">LATE</span>}
                                  {/* Multi-staff badge */}
                                  {addOnTs.length > 0 && (
                                    <div className={cn('flex items-center gap-0.5 ml-2.5 px-1 py-0.5 rounded w-fit',
                                      concIds.length > 0 ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700')}>
                                      <Zap className="w-2 h-2 shrink-0" />
                                      <span className="text-[6px] font-black uppercase">{concIds.length > 0 ? 'CON' : 'SEQ'} +{addOnTs.length}</span>
                                    </div>
                                  )}
                                  {/* Escalated */}
                                  {isEsc && <span className="text-[6px] font-black uppercase bg-destructive text-white rounded px-1 w-fit ml-2.5 animate-pulse">ESC</span>}
                                  {/* Live timer */}
                                  {st === 'servicing' && item.actualStartTime && (
                                    <LiveTimerBadge startTime={item.actualStartTime} duration={dur} />
                                  )}
                                </>
                              )}
                              {/* For other techs — just show status dot and time, no client info */}
                              {!isMe && (
                                <p className="text-[7px] font-bold text-slate-400 uppercase pl-2.5 truncate">
                                  {format(start, 'h:mm')}–{format(addMinutes(start, dur), 'h:mm')}
                                </p>
                              )}
                            </div>
                          </button>

                          {/* Post-pad */}
                          {padA > 0 && (
                            <div className="shrink-0 rounded-b-xl border border-dashed border-slate-200 bg-slate-50 flex items-center px-1 overflow-hidden" style={{ height: padAPx }}>
                              <span className="text-[6px] font-black uppercase text-slate-400 truncate">{padA}m</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Read-only peek sheet for other techs' appointments */}
      <AnimatePresence>
        {peekApt && (
          <TechPeekSheet
            apt={peekApt.apt}
            tech={peekApt.tech}
            service={peekApt.service}
            onClose={() => setPeekApt(null)}
          />
        )}
      </AnimatePresence>

      {/* Floor view legend */}
      {viewMode === 'floor' && (
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 flex-wrap bg-slate-50 rounded-b-[2rem]">
          {[
            { color: 'bg-primary/20 border border-primary/30', label: 'Your apts' },
            { color: 'bg-slate-200 border border-slate-300', label: 'Other techs' },
            { color: 'bg-teal-400', label: 'Walk-in' },
            { color: 'bg-purple-100 border border-dashed border-purple-300', label: 'Add-on block' },
            { color: 'bg-amber-300/40 border border-dashed border-amber-400', label: 'On break' },
            { color: 'bg-indigo-400/50', label: 'Event' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={cn('w-3 h-3 rounded shrink-0', color)} />
              <span className="text-[8px] font-black uppercase text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DATE NAVIGATOR ───────────────────────────────────────────────────────────
// Week strip + expandable month calendar so staff can jump any date/month
function DateNavigator({ selectedDate, onChange }: { selectedDate: Date; onChange: (d: Date) => void }) {
  const [monthOffset, setMonthOffset]       = useState(0);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const today = new Date();

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays  = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });

  const monthBase  = addMonths(startOfMonth(today), monthOffset);
  const monthDays  = eachDayOfInterval({ start: startOfMonth(monthBase), end: endOfMonth(monthBase) });
  const blankStart = (startOfMonth(monthBase).getDay() + 6) % 7;

  return (
    <div className="bg-white border-2 border-slate-100 rounded-[2rem] overflow-hidden">
      {/* Week strip header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button onClick={() => onChange(addWeeks(selectedDate, -1))}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>
        <button
          onClick={() => setShowMonthPicker(v => !v)}
          className="flex items-center gap-1 font-black uppercase text-[11px] text-slate-700 hover:text-primary transition-colors"
        >
          {format(selectedDate, 'MMMM yyyy')}
          {showMonthPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button onClick={() => onChange(addWeeks(selectedDate, 1))}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* 7-day strip */}
      <div className="grid grid-cols-7 gap-1 px-3 pb-3">
        {weekDays.map(day => {
          const isSel = isSameDay(day, selectedDate);
          const isT   = isToday(day);
          return (
            <button key={day.toISOString()} onClick={() => onChange(day)}
              className={cn('flex flex-col items-center py-2 rounded-xl transition-all active:scale-95',
                isSel ? 'bg-primary text-white shadow-lg shadow-primary/30'
                      : isT ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-600')}>
              <span className="text-[8px] font-black uppercase">{format(day, 'EEE')}</span>
              <span className={cn('font-black text-sm mt-0.5', isSel ? 'text-white' : isT ? 'text-primary' : 'text-slate-800')}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Expandable full month picker */}
      <AnimatePresence>
        {showMonthPicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden border-t border-slate-100"
          >
            <div className="flex items-center justify-between px-4 py-2">
              <button onClick={() => setMonthOffset(o => o - 1)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
              <p className="font-black uppercase text-[11px] text-slate-700">{format(monthBase, 'MMMM yyyy')}</p>
              <button onClick={() => setMonthOffset(o => o + 1)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 px-3 pb-1">
              {['M','T','W','T','F','S','S'].map((d, i) => (
                <p key={i} className="text-[8px] font-black uppercase text-center text-slate-400">{d}</p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 px-3 pb-3">
              {Array.from({ length: blankStart }).map((_, i) => <div key={`b${i}`} />)}
              {monthDays.map(day => {
                const isSel = isSameDay(day, selectedDate);
                const isT   = isToday(day);
                return (
                  <button key={day.toISOString()} onClick={() => { onChange(day); setShowMonthPicker(false); }}
                    className={cn('aspect-square rounded-xl flex items-center justify-center text-[11px] font-black transition-all active:scale-95',
                      isSel ? 'bg-primary text-white' : isT ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-700')}>
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FORGOT PIN FLOW ──────────────────────────────────────────────────────────
function ForgotPinFlow({ tenantId, firestore, onBack, onSuccess }: any) {
  const [step, setStep]     = useState<'name' | 'verify'>('name');
  const [name, setName]     = useState('');
  const [answer, setAnswer] = useState('');
  const [found, setFound]   = useState<any>(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const lookupByName = async () => {
    if (!name.trim()) return;
    setLoading(true); setError('');
    try {
      const allSnap = await getDocs(collection(firestore, `tenants/${tenantId}/staff`));
      const match   = allSnap.docs.find(d =>
        (d.data().name || '').toLowerCase().includes(name.trim().toLowerCase())
      );
      if (match) { setFound({ id: match.id, ...match.data() }); setStep('verify'); }
      else setError('Name not found. Check spelling or ask a manager.');
    } catch { setError('Error. Try again.'); }
    finally { setLoading(false); }
  };

  const verify = () => {
    if (!found) return;
    setLoading(true); setError('');
    const phone4 = (found.phone || '').replace(/\D/g, '').slice(-4);
    const email  = (found.email || '').toLowerCase();
    const input  = answer.trim().toLowerCase();
    if (input === phone4 || input === email) {
      toast({ title: `Welcome back, ${found.name?.split(' ')[0]}!` });
      onSuccess(found);
    } else {
      setError('Verification failed. Ask a manager to reset your PIN.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-8">
        <button onClick={onBack} className="flex items-center gap-2 text-white/40 font-black uppercase text-[9px] tracking-widest hover:text-white/60 transition-colors">
          <ChevronLeft className="w-4 h-4" />Back to PIN
        </button>

        {step === 'name' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-[2rem] bg-amber-500/20 border-2 border-amber-500/30 flex items-center justify-center mx-auto">
                <User className="w-7 h-7 text-amber-400" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Forgot PIN</h2>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Enter your name to continue</p>
            </div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
              onKeyDown={e => e.key === 'Enter' && lookupByName()}
              className="w-full h-14 rounded-2xl bg-white/10 border-2 border-white/10 px-4 text-white font-bold placeholder:text-white/30 outline-none focus:border-primary/50" />
            {error && <p className="text-[10px] font-black uppercase text-destructive text-center">{error}</p>}
            <button onClick={lookupByName} disabled={loading || !name.trim()}
              className="w-full h-14 rounded-2xl bg-primary font-black uppercase tracking-widest text-white disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : <>Continue <ChevronRight className="w-4 h-4" /></>}
            </button>
          </motion.div>
        )}

        {step === 'verify' && found && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-[2rem] bg-blue-500/20 border-2 border-blue-500/30 flex items-center justify-center mx-auto">
                <Lock className="w-7 h-7 text-blue-400" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Verify Identity</h2>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40 leading-relaxed">
                Enter your email address<br />or last 4 digits of your phone
              </p>
            </div>
            <input value={answer} onChange={e => setAnswer(e.target.value)} placeholder="email or last 4 of phone"
              onKeyDown={e => e.key === 'Enter' && verify()}
              className="w-full h-14 rounded-2xl bg-white/10 border-2 border-white/10 px-4 text-white font-bold placeholder:text-white/30 outline-none focus:border-primary/50" />
            {error && <p className="text-[10px] font-black uppercase text-destructive text-center">{error}</p>}
            <button onClick={verify} disabled={loading || !answer.trim()}
              className="w-full h-14 rounded-2xl bg-primary font-black uppercase tracking-widest text-white disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Verify & Sign In'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── PIN ENTRY ────────────────────────────────────────────────────────────────
function PinEntry({ onSuccess, tenantId, firestore }: any) {
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [shake, setShake]   = useState(false);
  const [checking, setChecking] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  if (showForgot) return <ForgotPinFlow tenantId={tenantId} firestore={firestore} onBack={() => setShowForgot(false)} onSuccess={onSuccess} />;

  const checkPin = async (entered: string) => {
    setChecking(true);
    try {
      const snap = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('pin', '==', entered)));
      if (!snap.empty) { onSuccess({ id: snap.docs[0].id, ...snap.docs[0].data() }); }
      else { setError('Incorrect PIN. Try again.'); setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 600); }
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
            <div key={i} className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all', pin.length > i ? 'bg-primary border-primary' : 'bg-white/5 border-white/10')}>
              {pin.length > i && <div className="w-3 h-3 rounded-full bg-white" />}
            </div>
          ))}
        </motion.div>

        {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-center text-[10px] font-black uppercase tracking-widest text-destructive">{error}</motion.p>}

        <div className="grid grid-cols-3 gap-3">
          {DIGITS.map((d, i) => (
            <button key={i} onClick={() => d !== '' && handleDigit(d)} disabled={checking || d === ''}
              className={cn('h-16 rounded-2xl font-black text-xl transition-all active:scale-95',
                d === '' ? 'pointer-events-none opacity-0'
                  : d === 'del' ? 'bg-white/5 border-2 border-white/10 text-white/60 hover:bg-white/10'
                  : 'bg-white/10 border-2 border-white/10 text-white hover:bg-white/20')}>
              {d === 'del' ? <Delete className="w-5 h-5 mx-auto" /> : d}
            </button>
          ))}
        </div>

        {checking && <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary/60 animate-pulse">Verifying...</p>}

        <button onClick={() => setShowForgot(true)}
          className="w-full text-center text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors pt-2">
          Forgot PIN?
        </button>
      </div>
    </div>
  );
}

// ─── CLOCK BUTTON ─────────────────────────────────────────────────────────────
// ─── STAFF STATUS BUTTON ─────────────────────────────────────────────────────
// Handles: Clock In, Clock Out, Go on Break, End Break
// Break time is tracked in activityLogs and subtracted from hours worked
function StaffStatusButton({ staffMember, tenantId, firestore, clockStatus }: any) {
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  // Determine current state from clockStatus
  const isOnBreak = clockStatus.isOnBreak;
  const isClockedIn = clockStatus.isClockedIn;

  const handleClockInOut = async () => {
    if (!isClockedIn && isOnBreak) return; // can't clock out while on break
    setProcessing(true);
    try {
      const now  = new Date().toISOString();
      const type = isClockedIn ? 'clock_out' : 'clock_in';
      const batch = writeBatch(firestore);
      const logRef = doc(collection(firestore, `tenants/${tenantId}/activityLogs`));
      batch.set(logRef, { id: logRef.id, staffId: staffMember.id, type, timestamp: now, createdAt: now });
      batch.set(doc(firestore, `tenants/${tenantId}/staff`, staffMember.id),
        { status: type === 'clock_in' ? 'available' : 'off', ...(type === 'clock_in' ? { lastClockIn: now } : { lastClockOut: now }) },
        { merge: true });
      await batch.commit();
      toast({ title: type === 'clock_in' ? 'Clocked In ✓' : 'Clocked Out ✓' });
    } catch { toast({ variant: 'destructive', title: 'Clock action failed.' }); }
    finally { setProcessing(false); }
  };

  const handleBreak = async () => {
    setProcessing(true);
    try {
      const now  = new Date().toISOString();
      const type = isOnBreak ? 'break_end' : 'break_start';
      const batch = writeBatch(firestore);
      const logRef = doc(collection(firestore, `tenants/${tenantId}/activityLogs`));
      batch.set(logRef, { id: logRef.id, staffId: staffMember.id, type, timestamp: now, createdAt: now });
      batch.set(doc(firestore, `tenants/${tenantId}/staff`, staffMember.id),
        { status: isOnBreak ? 'available' : 'on_break', ...(isOnBreak ? { lastBreakEnd: now } : { lastBreakStart: now }) },
        { merge: true });
      await batch.commit();
      toast({ title: isOnBreak ? 'Break Ended ✓' : 'On Break ✓' });
    } catch { toast({ variant: 'destructive', title: 'Failed.' }); }
    finally { setProcessing(false); }
  };

  if (!isClockedIn) {
    return (
      <button onClick={handleClockInOut} disabled={processing}
        className="flex items-center gap-1.5 h-8 px-3 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95 disabled:opacity-50 bg-green-500/20 border border-green-400/30 text-green-300 hover:bg-green-500/30">
        {processing ? <Loader className="w-3 h-3 animate-spin" /> : <><LogIn className="w-3 h-3" />Clock In</>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Break toggle */}
      <button onClick={handleBreak} disabled={processing}
        className={cn('flex items-center gap-1 h-8 px-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95 disabled:opacity-50',
          isOnBreak
            ? 'bg-amber-500/20 border border-amber-400/30 text-amber-300 hover:bg-amber-500/30 animate-pulse'
            : 'bg-white/10 border border-white/10 text-white/50 hover:bg-white/20')}>
        {processing ? <Loader className="w-3 h-3 animate-spin" /> : isOnBreak ? <><Coffee className="w-3 h-3" />End Break</> : <><Coffee className="w-3 h-3" />Break</>}
      </button>
      {/* Clock out */}
      <button onClick={handleClockInOut} disabled={processing || isOnBreak}
        className="flex items-center gap-1 h-8 px-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95 disabled:opacity-50 bg-rose-500/20 border border-rose-400/30 text-rose-300 hover:bg-rose-500/30">
        {processing ? <Loader className="w-3 h-3 animate-spin" /> : <><LogOut className="w-3 h-3" />Out</>}
      </button>
    </div>
  );
}

// Keep ClockButton as alias for backwards compat
const ClockButton = StaffStatusButton;

// ─── WALK-IN QUEUE PANEL ─────────────────────────────────────────────────────
// Shows the full walk-in turn order, highlights the tech's assigned walk-ins,
// and provides Accept / Pass actions. Position = checkInTime sort order.
// ─── WALK-IN LEADERBOARD ─────────────────────────────────────────────────────
// Two views:
//   ALL TECHS  — every tech on shift, their current status, accepting toggle
//   WALK-IN QUEUE — full guest lineup with positions, est. wait, actions

const CANCEL_REASONS = [
  'Client left', 'Wait too long', 'Changed mind',
  'Wrong service', 'Price concern', 'Other',
];

function WalkInLeaderboard({
  allWalkIns, allStaff, allShifts, services,
  tenantId, firestore, currentStaffId, activityLogs,
}: any) {
  const { toast } = useToast();
  const [view, setView]             = useState<'floor' | 'queue'>('queue');
  const [processing, setProcessing] = useState<string | null>(null);
  const [actionSheet, setActionSheet] = useState<{ walkIn: any; type: 'cancel' | 'noshow' | 'skip' } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  // ── Queue: waiting + notified + arrived, sorted by checkInTime ──
  const queue = useMemo(() => {
    return (allWalkIns || [])
      .filter((w: any) => ['waiting', 'notified', 'arrived'].includes(w.status))
      .sort((a: any, b: any) => safeDate(a.checkInTime).getTime() - safeDate(b.checkInTime).getTime());
  }, [allWalkIns]);

  // In-service walk-ins
  const inService = useMemo(() => {
    return (allWalkIns || []).filter((w: any) => w.status === 'in_service');
  }, [allWalkIns]);

  // Avg service duration for wait estimate
  const avgSvcMins = useMemo(() => {
    const durations = (allWalkIns || [])
      .filter((w: any) => w.status === 'in_service' && w.serviceStartTime)
      .map((w: any) => {
        const svc = w.serviceId
          ? (services || []).find((s: any) => s.id === w.serviceId)
          : (services || []).find((s: any) => (w.serviceIds || []).includes(s.id));
        return svc?.duration || 30;
      });
    return durations.length ? durations.reduce((a: number, b: number) => a + b, 0) / durations.length : 30;
  }, [allWalkIns, services]);

  // Turn order: techs accepting walk-ins, sorted by lastWalkInCompletedAt asc
  const turnOrder = useMemo(() => {
    const onShift = (allShifts || [])
      .filter((s: any) => s.date === todayStr && s.status !== 'cancelled')
      .map((s: any) => s.staffId);
    return (allStaff || [])
      .filter((t: any) => onShift.includes(t.id) && t.acceptingWalkIns !== false)
      .sort((a: any, b: any) => {
        const aLast = a.lastWalkInCompletedAt ? safeDate(a.lastWalkInCompletedAt).getTime() : 0;
        const bLast = b.lastWalkInCompletedAt ? safeDate(b.lastWalkInCompletedAt).getTime() : 0;
        return aLast - bLast;
      });
  }, [allStaff, allShifts, todayStr]);

  // ── Actions ──────────────────────────────────────────────────
  const startService = async (walkIn: any) => {
    if (!firestore || !tenantId || !currentStaffId) return;
    setProcessing(walkIn.id);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/walkIns`, walkIn.id), {
        status: 'in_service', serviceStartTime: now,
      });
      if (walkIn.appointmentId) {
        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, walkIn.appointmentId), {
          status: 'servicing', actualStartTime: now,
        });
      }
      batch.set(doc(firestore, `tenants/${tenantId}/staff`, currentStaffId),
        { status: 'busy', lastWalkInStartedAt: now }, { merge: true });
      await batch.commit();
      toast({ title: 'Service Started ✓' });
    } catch { toast({ variant: 'destructive', title: 'Failed.' }); }
    finally { setProcessing(null); }
  };

  const passWalkIn = async (walkIn: any) => {
    if (!firestore || !tenantId) return;
    setProcessing(`pass-${walkIn.id}`);
    try {
      await writeBatch(firestore)
        .update(doc(firestore, `tenants/${tenantId}/walkIns`, walkIn.id), {
          status: 'waiting', staffId: null, notifiedAt: null,
        })
        .commit();
      toast({ title: 'Passed — back to queue' });
    } catch { toast({ variant: 'destructive', title: 'Failed.' }); }
    finally { setProcessing(null); }
  };

  const confirmAction = async () => {
    if (!actionSheet || !firestore || !tenantId) return;
    const { walkIn, type } = actionSheet;
    const reason = cancelReason === 'Other' ? customReason.trim() : cancelReason;
    setProcessing(`action-${walkIn.id}`);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      const newStatus = type === 'noshow' ? 'no_show' : type === 'skip' ? 'waiting' : 'cancelled';
      const update: any = { status: newStatus, updatedAt: now };
      if (type === 'cancel') { update.cancellationReason = reason || 'No reason'; update.cancelledAt = now; }
      if (type === 'skip')   { update.staffId = null; update.notifiedAt = null; }
      batch.update(doc(firestore, `tenants/${tenantId}/walkIns`, walkIn.id), update);
      if (walkIn.appointmentId && (type === 'cancel' || type === 'noshow')) {
        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, walkIn.appointmentId), {
          status: type === 'noshow' ? 'no_show' : 'cancelled',
          ...(type === 'cancel' ? { cancellationReason: reason } : {}),
        });
      }
      await batch.commit();
      toast({ title: type === 'noshow' ? 'Marked No Show' : type === 'skip' ? 'Skipped — back to queue' : 'Walk-in Cancelled' });
      setActionSheet(null); setCancelReason(''); setCustomReason('');
    } catch { toast({ variant: 'destructive', title: 'Failed.' }); }
    finally { setProcessing(null); }
  };

  const toggleAccepting = async () => {
    if (!firestore || !tenantId || !currentStaffId) return;
    const me = (allStaff || []).find((s: any) => s.id === currentStaffId);
    const next = me?.acceptingWalkIns === false ? true : false;
    try {
      await writeBatch(firestore)
        .set(doc(firestore, `tenants/${tenantId}/staff`, currentStaffId),
          { acceptingWalkIns: next }, { merge: true })
        .commit();
      toast({ title: next ? 'Now accepting walk-ins ✓' : 'Walk-ins paused' });
    } catch {}
  };

  const me = (allStaff || []).find((s: any) => s.id === currentStaffId);
  const isAccepting = me?.acceptingWalkIns !== false;
  const myQueue = queue.filter((w: any) => w.staffId === currentStaffId);
  const totalActive = queue.length + inService.length;

  // ── Tech status helpers ──────────────────────────────────────
  const getTechStatus = (tech: any) => {
    const st = tech.status || 'off';
    if (st === 'busy')     return { dot: 'bg-blue-500',  label: 'In Service', priority: 0 };
    if (st === 'on_break') return { dot: 'bg-amber-400 animate-pulse', label: 'On Break', priority: 1 };
    if (st === 'available' || st === 'idle') return { dot: 'bg-green-500', label: 'Available', priority: 2 };
    return { dot: 'bg-slate-400', label: 'Not Clocked In', priority: 3 };
  };

  // ALL hooks must be before any early return — Rules of Hooks
  const onShiftToday = useMemo(() => {
    const ids = new Set((allShifts || []).filter((s: any) => s.date === todayStr && s.status !== 'cancelled').map((s: any) => s.staffId));
    return (allStaff || []).filter((t: any) => ids.has(t.id)).sort((a: any, b: any) => {
      const as_ = getTechStatus(a).priority;
      const bs_ = getTechStatus(b).priority;
      if (as_ !== bs_) return as_ - bs_;
      // My entry first
      if (a.id === currentStaffId) return -1;
      if (b.id === currentStaffId) return 1;
      return 0;
    });
  }, [allStaff, allShifts, todayStr]);

  // Early return AFTER all hooks
  if (totalActive === 0 && inService.length === 0 && queue.length === 0) return null;

  return (
    <>
      {/* ── Action bottom sheet (cancel / no-show / skip) ── */}
      <AnimatePresence>
        {actionSheet && (
          <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end" onClick={() => setActionSheet(null)}>
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="w-full max-w-lg mx-auto bg-white rounded-t-[2.5rem] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
              <div className="px-5 py-4 space-y-4">
                <p className="font-black uppercase text-base text-slate-900">
                  {actionSheet.type === 'cancel' ? 'Cancel Walk-in' :
                   actionSheet.type === 'noshow' ? 'Mark No Show' : 'Skip Guest'}
                </p>
                <p className="text-[11px] font-bold text-muted-foreground">
                  {actionSheet.walkIn.customerName || actionSheet.walkIn.clientName || 'Guest'}
                  {actionSheet.type === 'skip' && ' will be returned to the back of the queue.'}
                  {actionSheet.type === 'noshow' && ' will be marked as no show.'}
                  {actionSheet.type === 'cancel' && ' — select a reason:'}
                </p>
                {actionSheet.type === 'cancel' && (
                  <div className="grid grid-cols-2 gap-2">
                    {CANCEL_REASONS.map(r => (
                      <button key={r} onClick={() => setCancelReason(r)}
                        className={cn('p-2.5 rounded-2xl border-2 font-black uppercase text-[9px] transition-all active:scale-95',
                          cancelReason === r ? 'border-destructive bg-destructive/5 text-destructive' : 'border-slate-200 bg-white text-slate-600')}>
                        {r}
                      </button>
                    ))}
                  </div>
                )}
                {actionSheet.type === 'cancel' && cancelReason === 'Other' && (
                  <input value={customReason} onChange={e => setCustomReason(e.target.value)}
                    placeholder="Describe reason..."
                    className="w-full h-11 rounded-2xl border-2 px-4 font-bold text-sm outline-none focus:border-primary/40" />
                )}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button onClick={() => { setActionSheet(null); setCancelReason(''); setCustomReason(''); }}
                    className="h-12 rounded-2xl border-2 border-slate-200 font-black uppercase text-[10px] text-slate-400 active:scale-95">
                    Back
                  </button>
                  <button
                    onClick={confirmAction}
                    disabled={!!processing || (actionSheet.type === 'cancel' && !cancelReason)}
                    className={cn('h-12 rounded-2xl font-black uppercase text-[10px] text-white active:scale-95 disabled:opacity-50',
                      actionSheet.type === 'noshow' ? 'bg-slate-600' :
                      actionSheet.type === 'skip'   ? 'bg-amber-500' : 'bg-destructive')}>
                    {processing ? <Loader className="w-4 h-4 animate-spin mx-auto" /> :
                      actionSheet.type === 'cancel' ? 'Cancel Walk-in' :
                      actionSheet.type === 'noshow' ? 'Mark No Show' : 'Skip'}
                  </button>
                </div>
              </div>
              <div className="pb-6" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Main panel ── */}
      <div className="rounded-[2rem] border-2 border-slate-100 bg-white overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-teal-500 flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-800">Walk-ins</p>
              <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                {queue.length} waiting · {inService.length} in service
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
              <button onClick={() => setView('queue')}
                className={cn('px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all',
                  view === 'queue' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-500')}>
                Queue
              </button>
              <button onClick={() => setView('floor')}
                className={cn('px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all',
                  view === 'floor' ? 'bg-white text-primary shadow-sm' : 'text-slate-500')}>
                Floor
              </button>
            </div>
            {/* My accepting toggle */}
            <button onClick={toggleAccepting}
              className={cn('h-7 px-2.5 rounded-xl font-black uppercase text-[8px] tracking-widest transition-all active:scale-95 border',
                isAccepting
                  ? 'bg-teal-500/10 border-teal-400/30 text-teal-700'
                  : 'bg-slate-100 border-slate-200 text-slate-400')}>
              {isAccepting ? '● Accepting' : '○ Paused'}
            </button>
          </div>
        </div>

        {/* ══════ QUEUE VIEW ══════ */}
        {view === 'queue' && (
          <div>
            {/* Turn order strip */}
            {turnOrder.length > 0 && (
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                <p className="text-[7px] font-black uppercase text-slate-400 shrink-0">Turn:</p>
                {turnOrder.map((t: any, i: number) => (
                  <div key={t.id} className={cn('flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-lg',
                    t.id === currentStaffId ? 'bg-teal-100 text-teal-700' : 'bg-white border border-slate-200 text-slate-500')}>
                    <span className="text-[7px] font-black uppercase">
                      {i === 0 ? '★ ' : ''}{t.name?.split(' ')[0]}
                      {t.id === currentStaffId ? ' (You)' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Waiting guests */}
            {queue.length === 0 && inService.length === 0 ? (
              <div className="py-10 text-center opacity-30">
                <Users className="w-8 h-8 mx-auto mb-2" />
                <p className="text-[9px] font-black uppercase tracking-widest">Queue clear</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.map((w: any, idx: number) => {
                  const isMe       = w.staffId === currentStaffId;
                  const isArrived  = w.status === 'arrived';
                  const isNotified = w.status === 'notified';
                  const assignedT  = w.staffId ? (allStaff || []).find((s: any) => s.id === w.staffId) : null;
                  const svcName    = w.serviceId
                    ? (services || []).find((s: any) => s.id === w.serviceId)?.name
                    : (services || []).find((s: any) => (w.serviceIds || []).includes(s.id))?.name;
                  const waitMins   = differenceInMinutes(new Date(), safeDate(w.checkInTime));
                  const estWait    = Math.round(idx * avgSvcMins);
                  const groupSize  = w.groupSize || 1;

                  return (
                    <div key={w.id}
                      className={cn('px-4 py-3 transition-all',
                        isMe && isArrived ? 'bg-green-50 border-l-4 border-green-500' :
                        isMe ? 'bg-teal-50 border-l-4 border-teal-500' : 'bg-white')}>
                      <div className="flex items-start gap-3">
                        {/* Position */}
                        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-black text-sm mt-0.5',
                          isMe && isArrived ? 'bg-green-500 text-white' :
                          isMe ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500')}>
                          {idx + 1}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className={cn('font-black uppercase text-[11px] truncate',
                              isMe ? 'text-teal-800' : 'text-slate-700')}>
                              {w.customerName || w.clientName || 'Guest'}
                            </p>
                            {groupSize > 1 && (
                              <span className="text-[7px] font-black uppercase bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 shrink-0">
                                Group · {groupSize}
                              </span>
                            )}
                            {isMe && (
                              <span className="text-[7px] font-black uppercase bg-teal-500 text-white rounded px-1.5 py-0.5 shrink-0">YOU</span>
                            )}
                            {isArrived && (
                              <span className="text-[7px] font-black uppercase bg-green-500 text-white rounded px-1.5 py-0.5 shrink-0 animate-pulse">
                                HERE
                              </span>
                            )}
                            {isNotified && !isArrived && (
                              <span className="text-[7px] font-black uppercase bg-blue-500 text-white rounded px-1.5 py-0.5 shrink-0">
                                Notified
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {svcName && <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-70 truncate">{svcName}</p>}
                            <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-50">
                              {waitMins < 60 ? `${waitMins}m wait` : `${Math.floor(waitMins/60)}h ${waitMins%60}m`}
                            </p>
                            {idx > 0 && (
                              <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40">~{estWait}m est.</p>
                            )}
                            {assignedT && !isMe && (
                              <p className="text-[8px] font-bold text-slate-500 uppercase">→ {assignedT.name?.split(' ')[0]}</p>
                            )}
                            {!w.staffId && (
                              <p className="text-[8px] font-bold text-amber-600 uppercase">Unassigned</p>
                            )}
                          </div>
                        </div>
                        {/* Actions */}
                        {isMe && (
                          <div className="flex flex-col gap-1 shrink-0">
                            {/* Start service — only when arrived */}
                            {isArrived ? (
                              <button onClick={() => startService(w)} disabled={!!processing}
                                className="h-9 px-3 rounded-xl bg-green-500 text-white font-black uppercase text-[8px] flex items-center gap-1 active:scale-95 disabled:opacity-50 shadow-sm">
                                {processing === w.id ? <Loader className="w-3 h-3 animate-spin" /> : <><Play className="w-2.5 h-2.5" />Start</>}
                              </button>
                            ) : (
                              <button onClick={() => startService(w)} disabled={!!processing}
                                className="h-9 px-3 rounded-xl bg-teal-500 text-white font-black uppercase text-[8px] flex items-center gap-1 active:scale-95 disabled:opacity-50 shadow-sm shadow-teal-500/20">
                                {processing === w.id ? <Loader className="w-3 h-3 animate-spin" /> : <><Play className="w-2.5 h-2.5" />Accept</>}
                              </button>
                            )}
                            <button onClick={() => passWalkIn(w)} disabled={!!processing}
                              className="h-7 px-3 rounded-xl border border-slate-200 text-slate-400 font-black uppercase text-[7px] active:scale-95 disabled:opacity-50">
                              Pass
                            </button>
                            <button onClick={() => setActionSheet({ walkIn: w, type: 'cancel' })}
                              className="h-7 px-2 rounded-xl text-destructive/60 font-black uppercase text-[6px] active:scale-95">
                              Cancel
                            </button>
                          </div>
                        )}
                        {!isMe && w.staffId && (
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => setActionSheet({ walkIn: w, type: 'noshow' })}
                              className="h-7 px-2 rounded-xl border border-slate-100 text-slate-400 font-black uppercase text-[6px] active:scale-95">
                              No Show
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* In service section */}
                {inService.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
                      <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">In Service Now</p>
                    </div>
                    {inService.map((w: any) => {
                      const tech    = w.staffId ? (allStaff || []).find((s: any) => s.id === w.staffId) : null;
                      const svcName = (services || []).find((s: any) => s.id === w.serviceId || (w.serviceIds || []).includes(s.id))?.name;
                      const elapsed = w.serviceStartTime ? differenceInMinutes(new Date(), safeDate(w.serviceStartTime)) : 0;
                      const isMe    = w.staffId === currentStaffId;
                      return (
                        <div key={w.id} className={cn('px-4 py-2.5 flex items-center gap-3',
                          isMe ? 'bg-primary/5' : 'bg-white')}>
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-black uppercase text-[10px] text-slate-700 truncate">
                              {tech?.name?.split(' ')[0] || 'Tech'}{isMe ? ' (You)' : ''}
                              {svcName ? ` · ${svcName}` : ''}
                            </p>
                            <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                              {w.customerName || w.clientName || 'Guest'} · {elapsed}m in
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════ FLOOR VIEW ══════ */}
        {view === 'floor' && (
          <div className="divide-y divide-slate-50">
            {onShiftToday.length === 0 ? (
              <div className="py-10 text-center opacity-30">
                <Users className="w-8 h-8 mx-auto mb-2" />
                <p className="text-[9px] font-black uppercase tracking-widest">No techs on shift</p>
              </div>
            ) : onShiftToday.map((tech: any) => {
              const isMe   = tech.id === currentStaffId;
              const ts     = getTechStatus(tech);
              const myWalkIn = (allWalkIns || []).find((w: any) =>
                w.staffId === tech.id && ['notified', 'arrived', 'in_service'].includes(w.status)
              );
              const myApt = null; // Could wire in current appointment later
              const accepting = tech.acceptingWalkIns !== false;
              const turnPos = turnOrder.findIndex((t: any) => t.id === tech.id);

              return (
                <div key={tech.id}
                  className={cn('px-4 py-3 transition-all',
                    isMe ? 'bg-primary/[0.02] border-l-4 border-primary/30' : 'bg-white')}>
                  <div className="flex items-center gap-3">
                    <Avatar className={cn('rounded-xl border-2 shrink-0', isMe ? 'h-10 w-10 border-primary/30' : 'h-8 w-8 border-slate-200')}>
                      <AvatarImage src={tech.avatarUrl} className="object-cover" />
                      <AvatarFallback className={cn('font-black', isMe ? 'text-sm bg-primary/10 text-primary' : 'text-xs bg-slate-100 text-slate-500')}>
                        {(tech.name || 'T')[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={cn('font-black uppercase text-[11px]', isMe ? 'text-primary' : 'text-slate-800')}>
                          {tech.name?.split(' ')[0]}{isMe ? ' (You)' : ''}
                        </p>
                        {turnPos === 0 && accepting && (
                          <span className="text-[7px] font-black uppercase bg-teal-500 text-white rounded px-1.5 py-0.5">Up Next</span>
                        )}
                        {turnPos > 0 && accepting && (
                          <span className="text-[7px] font-black uppercase bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">#{turnPos + 1} in rotation</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', ts.dot)} />
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-70">{ts.label}</p>
                        {myWalkIn && (
                          <p className="text-[8px] font-bold text-teal-600 uppercase">
                            {myWalkIn.status === 'in_service' ? '● Walk-in in service' :
                             myWalkIn.status === 'arrived' ? '★ Client arrived' : '→ Walk-in assigned'}
                          </p>
                        )}
                        {!accepting && (
                          <span className="text-[7px] font-black uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Not accepting</span>
                        )}
                      </div>
                    </div>
                    {/* Accepting toggle — only for current tech */}
                    {isMe && (
                      <button onClick={toggleAccepting}
                        className={cn('h-7 px-2.5 rounded-xl font-black uppercase text-[7px] transition-all active:scale-95 border shrink-0',
                          isAccepting
                            ? 'bg-teal-500/10 border-teal-400/30 text-teal-700'
                            : 'bg-slate-100 border-slate-200 text-slate-400')}>
                        {isAccepting ? '● On' : '○ Off'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── NEXT APPOINTMENT BANNER ──────────────────────────────────────────────────
function NextBanner({ appointments, services }: any) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const next = useMemo(() => {
    if (!appointments) return null;
    // Show the soonest upcoming or very recently started (within 10 min) appointment
    return appointments.filter((a: any) =>
      !['cancelled', 'completed', 'no_show'].includes(a.status) &&
      isSameDay(safeDate(a.startTime), now) &&
      safeDate(a.startTime) > addMinutes(now, -10)
    ).sort((a: any, b: any) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0] || null;
  }, [appointments, now]);

  if (!next) return null;

  const start        = safeDate(next.startTime);
  const minsUntil    = differenceInMinutes(start, now);
  const svc          = (services || []).find((s: any) => s.id === next.serviceId);
  const checkIn      = next.checkInStatus;
  const lateBy       = next.lateTimeMinutes || 0;
  const isCancelled  = next.status === 'cancelled';
  const isRunningLate = checkIn === 'running_late';
  const isOnMyWay    = checkIn === 'on_my_way';
  const isArrived    = checkIn === 'arrived';

  // Estimated arrival when running late
  const estimatedArrival = isRunningLate && lateBy > 0
    ? addMinutes(start, lateBy)
    : null;

  // Late fee applies if tenant has a cancellation window and they're past it
  const lateFeeApplies = isRunningLate && lateBy >= 15;

  // Colour theme based on situation
  const theme = isCancelled       ? 'bg-destructive/5 border-destructive/30 text-destructive' :
                isRunningLate     ? 'bg-amber-50 border-amber-300 text-amber-800' :
                isArrived         ? 'bg-green-50 border-green-300 text-green-800' :
                isOnMyWay         ? 'bg-blue-50 border-blue-200 text-blue-700' :
                minsUntil <= 10   ? 'bg-primary/10 border-primary/30 text-primary' :
                                    'bg-slate-50 border-slate-200 text-slate-700';

  const iconTheme = isCancelled   ? 'bg-destructive text-white' :
                    isRunningLate ? 'bg-amber-500 text-white' :
                    isArrived     ? 'bg-green-500 text-white' :
                    isOnMyWay     ? 'bg-blue-500 text-white' :
                                    'bg-primary text-white';

  return (
    <div className={cn('rounded-2xl border-2 p-3 space-y-2 transition-all', theme)}>
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', iconTheme)}>
          {isCancelled   ? <XCircle className="w-5 h-5" /> :
           isRunningLate ? <AlertTriangle className="w-5 h-5" /> :
           isArrived     ? <CheckCircle2 className="w-5 h-5" /> :
           isOnMyWay     ? <Car className="w-5 h-5" /> :
                           <Timer className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-black uppercase tracking-widest opacity-60">
            {isCancelled   ? 'Appointment Cancelled' :
             isRunningLate ? 'Client Running Late' :
             isArrived     ? 'Client Arrived' :
             isOnMyWay     ? 'Client En Route' :
             minsUntil <= 0 ? 'Starting Now' : 'Next Up'}
          </p>
          <p className="font-black text-sm truncate">
            {svc?.name || 'Service'} · {next.clientName?.split(' ')[0] || 'Guest'}
          </p>
        </div>
        <div className="text-right shrink-0">
          {!isCancelled && (
            <>
              <p className="font-black text-lg leading-none">
                {minsUntil <= 0 ? 'Now' : minsUntil < 60 ? `${minsUntil}m` : `${Math.floor(minsUntil/60)}h ${minsUntil%60}m`}
              </p>
              <p className="text-[8px] font-black uppercase opacity-60">{format(start, 'h:mm a')}</p>
            </>
          )}
        </div>
      </div>

      {/* Running late details */}
      {isRunningLate && (
        <div className="space-y-1.5 pl-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase bg-amber-100 text-amber-700 rounded-lg px-2 py-0.5">
              +{lateBy}m late
            </span>
            {estimatedArrival && (
              <span className="text-[10px] font-black uppercase opacity-70">
                Est. arrival {format(estimatedArrival, 'h:mm a')}
              </span>
            )}
          </div>
          {lateFeeApplies && (
            <div className="flex items-center gap-1.5 text-amber-700">
              <DollarSign className="w-3 h-3 shrink-0" />
              <p className="text-[9px] font-black uppercase">Late fee may apply — notify front desk</p>
            </div>
          )}
        </div>
      )}

      {/* On my way ETA */}
      {isOnMyWay && !isRunningLate && (
        <p className="text-[9px] font-bold uppercase opacity-70 pl-1">
          Client is heading in · {format(start, 'h:mm a')} appointment
        </p>
      )}

      {/* Cancellation reason */}
      {isCancelled && (
        <div className="pl-1 space-y-1">
          <p className="text-[9px] font-black uppercase text-destructive">
            {next.cancellationReason
              ? `Reason: ${next.cancellationReason}`
              : 'No reason provided'}
          </p>
          {next.cancelledAt && (
            <p className="text-[8px] font-bold uppercase opacity-60">
              Cancelled at {format(safeDate(next.cancelledAt), 'h:mm a')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SWAP CARDS ───────────────────────────────────────────────────────────────
function SwapConsentCard({ req, staffMember, tenantId, firestore, allStaff, allShifts }: any) {
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();
  const requester  = (allStaff  || []).find((s: any) => s.id === req.staffId);
  const myShift    = (allShifts || []).find((s: any) => s.id === req.swapShiftId);
  const theirShift = (allShifts || []).find((s: any) => s.id === req.myShiftId);

  const respond = async (agree: boolean) => {
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, req.id), { status: agree ? 'swap_consent_given' : 'swap_consent_denied', consentBy: staffMember.id, consentAt: now });
      const n1 = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(n1, { id: n1.id, userId: req.staffId, read: false, createdAt: now, link: 'requests', type: agree ? 'swap_consent_given' : 'swap_consent_denied', message: agree ? `${staffMember.name} agreed to your swap on ${req.date ? format(safeDate(req.date), 'MMM d') : 'the date'}.` : `${staffMember.name} declined your swap.` });
      const mgrs = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('role', 'in', ['owner', 'admin'])));
      mgrs.docs.forEach(mgr => { const n = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(n, { id: n.id, userId: mgr.id, read: false, createdAt: now, link: '/schedule/requests', type: 'swap_request', message: agree ? `${staffMember.name} agreed to swap with ${requester?.name}. Ready for approval.` : `Swap between ${requester?.name} and ${staffMember.name} declined.` }); });
      await batch.commit();
      toast({ title: agree ? 'Swap Agreed ✓' : 'Swap Declined' });
    } catch { toast({ variant: 'destructive', title: 'Error.' }); }
    finally { setProcessing(false); }
  };

  return (
    <div className="rounded-[2rem] border-2 border-purple-200 bg-purple-50 overflow-hidden">
      <div className="px-4 py-3 bg-purple-100/60 border-b border-purple-200 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-purple-600 shrink-0" />
        <p className="font-black uppercase text-[10px] text-purple-700">Swap Request from {requester?.name}</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[{ label: 'Their shift → you', sh: theirShift, col: 'text-primary' }, { label: 'Your shift → them', sh: myShift, col: 'text-purple-600' }].map(({ label, sh, col }) => (
            <div key={label} className="p-3 rounded-xl bg-white border-2 border-purple-100">
              <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 mb-0.5">{label}</p>
              {sh ? <><p className={cn('font-black text-[11px]', col)}>{fmt12(sh.startTime)} – {fmt12(sh.endTime)}</p><p className="text-[8px] font-bold opacity-60 uppercase">{sh.date}</p></> : <p className="text-[9px] opacity-40 uppercase">Not found</p>}
            </div>
          ))}
        </div>
        {req.reason && <p className="text-[10px] font-bold text-purple-700 uppercase">{req.reason}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => respond(false)} disabled={processing} className="h-12 rounded-2xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"><XCircle className="w-4 h-4" />Decline</button>
          <button onClick={() => respond(true)}  disabled={processing} className="h-12 rounded-2xl bg-green-600 text-white font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 shadow-lg flex flex-col items-center justify-center gap-0.5"><CheckCircle2 className="w-4 h-4" />Agree</button>
        </div>
      </div>
    </div>
  );
}

function SwapApproveCard({ req, staffMember, tenantId, firestore, allStaff, allShifts }: any) {
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState('');
  const { toast } = useToast();
  if (staffMember.role !== 'owner' && staffMember.role !== 'admin') return null;
  const requester    = (allStaff  || []).find((s: any) => s.id === req.staffId);
  const consentGiver = (allStaff  || []).find((s: any) => s.id === req.swapWithStaffId);
  const shift1       = (allShifts || []).find((s: any) => s.id === req.myShiftId);
  const shift2       = (allShifts || []).find((s: any) => s.id === req.swapShiftId);

  const decide = async (approve: boolean) => {
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, req.id), { status: approve ? 'approved' : 'denied', approvedBy: staffMember.id, approvedAt: now, managerNote: note.trim() || null });
      if (approve && shift1 && shift2) { batch.update(doc(firestore, `tenants/${tenantId}/shifts`, shift1.id), { staffId: req.swapWithStaffId }); batch.update(doc(firestore, `tenants/${tenantId}/shifts`, shift2.id), { staffId: req.staffId }); }
      [req.staffId, req.swapWithStaffId].filter(Boolean).forEach((uid: string) => { const n = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(n, { id: n.id, userId: uid, read: false, createdAt: now, link: 'schedule', type: approve ? 'swap_approved' : 'request_denied', message: approve ? `Your swap was approved.` : `Your swap was denied.${note ? ` Note: ${note}` : ''}` }); });
      await batch.commit();
      toast({ title: approve ? 'Swap Approved ✓' : 'Swap Denied' });
    } catch { toast({ variant: 'destructive', title: 'Error.' }); }
    finally { setProcessing(false); }
  };

  return (
    <div className="rounded-[2rem] border-2 border-blue-200 bg-blue-50 overflow-hidden">
      <div className="px-4 py-3 bg-blue-100/60 border-b border-blue-200 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
        <p className="font-black uppercase text-[10px] text-blue-700">Swap Awaiting Approval</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[{ label: `${requester?.name?.split(' ')[0]}'s shift`, sh: shift1 }, { label: `${consentGiver?.name?.split(' ')[0]}'s shift`, sh: shift2 }].map(({ label, sh }) => (
            <div key={label} className="p-3 rounded-xl bg-white border-2 border-blue-100">
              <p className="text-[8px] font-black uppercase opacity-60 mb-0.5">{label}</p>
              {sh ? <><p className="font-black text-[11px] text-primary">{fmt12(sh.startTime)} – {fmt12(sh.endTime)}</p><p className="text-[8px] font-bold opacity-60 uppercase">{sh.date}</p></> : <p className="text-[9px] opacity-40">N/A</p>}
            </div>
          ))}
        </div>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Manager note (optional)" className="rounded-2xl border-2 bg-white min-h-[60px] text-sm" />
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => decide(false)} disabled={processing} className="h-12 rounded-2xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"><XCircle className="w-4 h-4" />Deny</button>
          <button onClick={() => decide(true)}  disabled={processing} className="h-12 rounded-2xl bg-blue-600 text-white font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 shadow-lg flex flex-col items-center justify-center gap-0.5"><CheckCircle2 className="w-4 h-4" />Approve</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
function StaffDashboard({ staffMember, tenantId, firestore, onSignOut }: any) {
  const { toast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab]   = useState<'today'|'schedule'|'requests'|'earnings'|'inbox'|'messages'>('today');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [drawerApt, setDrawerApt]   = useState<any>(null);
  const [drawerSvc, setDrawerSvc]   = useState<any>(null);
  const [reviewApt, setReviewApt]   = useState<any>(null);
  const [reviewSvc, setReviewSvc]   = useState<any>(null);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType]     = useState<'day_off'|'swap'|'early_release'>('day_off');
  const [requestDate, setRequestDate]     = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [swapTargetShiftId, setSwapTargetShiftId] = useState('');
  const [swapTargetStaffId, setSwapTargetStaffId] = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [isClearingInbox, setIsClearingInbox] = useState(false);
  const [refreshKey, setRefreshKey]       = useState(0);

  const isOwnerOrAdmin = staffMember.role === 'owner' || staffMember.role === 'admin';
  const today = new Date();

  // ── Queries ──
  const myShiftsQ       = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shifts`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id,refreshKey]);
  const allShiftsQ      = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/shifts`), [firestore,tenantId]);
  // Primary appointments
  const myApptsQ        = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/appointments`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id,refreshKey]);
  // Add-on handoff appointments — where this staff member is assigned via assignedStaffIds array
  const myAddonApptsQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/appointments`), where('assignedStaffIds','array-contains',staffMember.id)), [firestore,tenantId,staffMember?.id,refreshKey]);
  // Check-in status — separate collection merged by checkInToken (same pattern as InventoryContext)
  const checkInsQ       = useMemoFirebase(() => (!firestore||!tenantId) ? null : query(collection(firestore,'appointmentCheckIns'), where('tenantId','==',tenantId)), [firestore,tenantId]);
  // ── Floor view queries ──
  // All today's appointments across ALL staff for floor view
  const allTodayApptsQ  = useMemoFirebase(() => (!firestore||!tenantId) ? null : query(collection(firestore,`tenants/${tenantId}/appointments`), where('status','in',['confirmed','servicing','ready_for_checkout','pending'])), [firestore,tenantId,refreshKey]);
  // All today's walk-ins for floor view
  const allWalkInsQ     = useMemoFirebase(() => (!firestore||!tenantId) ? null : query(collection(firestore,`tenants/${tenantId}/walkIns`), where('status','in',['waiting','notified','in_service'])), [firestore,tenantId,refreshKey]);
  // Staff blocks (sequential add-on time holds)
  const staffBlocksQ    = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/staffBlocks`), [firestore,tenantId,refreshKey]);
  // Events (studio-wide blocked time, staff meetings, etc.)
  const eventsQ         = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/events`), [firestore,tenantId,refreshKey]);

  const myRequestsQ     = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  // Single-field where only — filter status client-side to avoid composite index requirement
  const incomingSwapQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('swapWithStaffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const pendingApprovalQ = useMemoFirebase(() => (!firestore||!tenantId||!isOwnerOrAdmin) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('status','==','swap_consent_given')), [firestore,tenantId,isOwnerOrAdmin]);
  // v25 — badge for the new Messages entry point. Owner/admin see a count
  // across every open conversation; regular staff only see ones actually
  // assigned to them — same admin-vs-staff visibility split already
  // established by isOwnerOrAdmin elsewhere in this file, now applied
  // consistently to client conversations too.
  const openThreadsQ = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return isOwnerOrAdmin
      ? query(collection(firestore, `tenants/${tenantId}/smsThreads`), where('status', '==', 'open'))
      : query(collection(firestore, `tenants/${tenantId}/smsThreads`), where('status', '==', 'open'), where('assignedStaffId', '==', staffMember.id));
  }, [firestore, tenantId, isOwnerOrAdmin, staffMember.id]);
  const { data: openThreads } = useCollection(openThreadsQ);
  const messagesBadge = (openThreads || []).length;
  const allStaffQ       = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/staff`), [firestore,tenantId]);
  const servicesQ       = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/services`), [firestore,tenantId]);
  const notifsQ         = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/notifications`), where('userId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const activityLogsQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/activityLogs`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const transactionsQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/transactions`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);

  const { data: myShiftsRaw,  loading: shiftsLoading }  = useCollection<any>(myShiftsQ);
  const { data: allShiftsRaw }                          = useCollection<any>(allShiftsQ);
  const { data: myApptsRaw,   loading: apptsLoading }   = useCollection<any>(myApptsQ);
  const { data: myAddonAptsRaw }                        = useCollection<any>(myAddonApptsQ);
  const { data: checkInsRaw }                           = useCollection<any>(checkInsQ);
  const { data: allTodayApptsRaw }                      = useCollection<any>(allTodayApptsQ);
  const { data: allWalkInsRaw }                         = useCollection<any>(allWalkInsQ);
  const { data: staffBlocksRaw }                        = useCollection<any>(staffBlocksQ);
  const { data: allEventsRaw }                          = useCollection<any>(eventsQ);
  const { data: myRequests }                            = useCollection<any>(myRequestsQ);
  const { data: incomingSwapsRaw }                      = useCollection<any>(incomingSwapQ);
  const { data: pendingApprovals }                      = useCollection<any>(pendingApprovalQ);
  const { data: allStaff }                              = useCollection<any>(allStaffQ);
  const { data: services,     loading: svcsLoading }    = useCollection<any>(servicesQ);
  const { data: notifs }                                = useCollection<any>(notifsQ);
  const { data: activityLogs }                          = useCollection<any>(activityLogsQ);
  const { data: transactions }                          = useCollection<any>(transactionsQ);

  // Build a token→checkIn map for fast lookup — mirrors InventoryContext pattern
  const checkInMap = useMemo(() => {
    const map = new Map<string, any>();
    (checkInsRaw || []).forEach((ci: any) => { if (ci.checkInToken) map.set(ci.checkInToken, ci); });
    return map;
  }, [checkInsRaw]);

  // Notify tech when a walk-in is newly assigned to them
  const prevMyWalkIns = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!allWalkInsRaw || !staffMember?.id || !firestore || !tenantId) return;
    const myNotified = (allWalkInsRaw as any[]).filter(
      (w: any) => w.staffId === staffMember.id && w.status === 'notified'
    );
    const newOnes = myNotified.filter((w: any) => !prevMyWalkIns.current.has(w.id));
    newOnes.forEach(async (w: any) => {
      // Write notification to inbox
      try {
        const svcName = (w.serviceIds || []).join(', ') || 'service';
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        await writeBatch(firestore).set(n, {
          id: n.id, userId: staffMember.id, read: false,
          createdAt: new Date().toISOString(), type: 'walk_in_assigned', link: 'today',
          message: `Walk-in assigned: ${w.customerName || w.clientName || 'Guest'} · ready for you now.`,
        }).commit();
      } catch {}
    });
    prevMyWalkIns.current = new Set(myNotified.map((w: any) => w.id));
  }, [allWalkInsRaw, staffMember?.id]);

  // Merge primary + add-on appointments, deduplicating by id.
  // Also merges live checkInStatus from the appointmentCheckIns collection.
  // Tags add-on appointments with _viewingStaffId so the card knows this staff is the add-on tech.
  const allMyApts = useMemo(() => {
    const mergeCheckIn = (apt: any) => {
      const ci = apt.checkInToken ? checkInMap.get(apt.checkInToken) : null;
      return {
        ...apt,
        checkInStatus:   ci?.checkInStatus   ?? apt.checkInStatus   ?? 'pending',
        lateTimeMinutes: ci?.lateTimeMinutes  ?? apt.lateTimeMinutes ?? 0,
        // If the check-in says confirmed but appt is still confirmed, keep appt status
        status: (ci?.status && apt.status === 'confirmed') ? ci.status : apt.status,
      };
    };
    const primary = (myApptsRaw || []).map(mergeCheckIn);
    const addon   = (myAddonAptsRaw || [])
      .filter((a: any) => !primary.find((p: any) => p.id === a.id))
      .map((a: any) => mergeCheckIn({ ...a, _viewingStaffId: staffMember.id }));
    return [...primary, ...addon];
  }, [myApptsRaw, myAddonAptsRaw, checkInMap, staffMember.id]);

  const isLoadingToday = apptsLoading || svcsLoading;

  // Filter incomingSwaps client-side (single-field query avoids composite index)
  const incomingSwaps = useMemo(() => (incomingSwapsRaw||[]).filter((r: any) => r.status === 'pending_swap_consent'), [incomingSwapsRaw]);

  // ── Derived state ──
  const todayShift = useMemo(() => {
    if (!myShiftsRaw) return null;
    const s = format(today, 'yyyy-MM-dd');
    return myShiftsRaw.find((sh: any) => sh.date === s && sh.status !== 'cancelled' && sh.status !== 'draft') || null;
  }, [myShiftsRaw]);

// Stuck appointments — servicing or ready_for_checkout from a previous day
  const stuckApts = useMemo(() => {
    return allMyApts.filter((a: any) =>
      ['servicing', 'ready_for_checkout'].includes(a.status) &&
      !isSameDay(safeDate(a.startTime), today)
    );
  }, [allMyApts, today]);

  const clockStatus = useMemo(() => {
    if (!activityLogs) return { isClockedIn: false, isOnBreak: false, minutesWorked: 0, breakMinutes: 0, breakStartTime: null as Date | null };
    const logs = activityLogs
      .filter((l: any) => isSameDay(safeDate(l.timestamp), today))
      .sort((a: any, b: any) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());

    let isClockedIn = false, clockInTime: Date | null = null;
    let isOnBreak = false, breakStartTime: Date | null = null;
    let totalWorked = 0, totalBreak = 0;

    for (const l of logs) {
      const ts = safeDate(l.timestamp);
      if      (l.type === 'clock_in')    { isClockedIn = true;  clockInTime = ts; }
      else if (l.type === 'clock_out' && clockInTime) {
        totalWorked += differenceInMinutes(ts, clockInTime);
        isClockedIn = false; clockInTime = null;
      }
      else if (l.type === 'break_start') { isOnBreak = true;  breakStartTime = ts; }
      else if (l.type === 'break_end' && breakStartTime) {
        totalBreak += differenceInMinutes(ts, breakStartTime);
        isOnBreak = false; breakStartTime = null;
      }
    }
    // Add current open clock-in period
    if (isClockedIn && clockInTime) totalWorked += differenceInMinutes(new Date(), clockInTime);
    // Add current open break period
    if (isOnBreak && breakStartTime) totalBreak += differenceInMinutes(new Date(), breakStartTime);

    return {
      isClockedIn,
      isOnBreak,
      breakStartTime,
      minutesWorked: Math.max(0, totalWorked - totalBreak), // net of breaks
      breakMinutes: totalBreak,
    };
  }, [activityLogs]);

  const weekEarnings = useMemo(() => {
    const ws = startOfWeek(today, { weekStartsOn: 1 });
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const shifts = (myShiftsRaw || []).filter((s: any) => s.date >= format(ws,'yyyy-MM-dd') && s.date <= format(we,'yyyy-MM-dd') && s.status !== 'cancelled');
    const weekHours = shifts.reduce((sum: number, s: any) => sum + calcHours(s.startTime, s.endTime, s.breakMinutes||0), 0);
    const weekTx    = (transactions||[]).filter((t: any) => { const d = safeDate(t.date); return d >= ws && d <= we; });
    const tipTotal       = weekTx.reduce((s: number, t: any) => s + (t.tipAmount || (t.category==='Tips' ? t.amount : 0)), 0);
    const serviceRevenue = weekTx.filter((t: any) => t.category==='Service Revenue').reduce((s: number, t: any) => s + t.amount, 0);
    const apptCount      = (myApptsRaw||[]).filter((a: any) => { const d = safeDate(a.startTime); return d >= ws && d <= we && a.status==='completed'; }).length;
    const ps = staffMember.payStructure;
    let estimatedPay = 0;
    if      (ps==='hourly')                estimatedPay = weekHours * (staffMember.hourlyRate||0);
    else if (ps==='commission')            estimatedPay = serviceRevenue * ((staffMember.commissionRate||0)/100);
    else if (ps==='hourly_plus_commission') estimatedPay = (staffMember.hourlyRate||0)*weekHours + serviceRevenue*((staffMember.commissionRate||0)/100);
    else if (ps==='salary')               estimatedPay = staffMember.salaryWeekly || 0;
    return { estimatedPay, weekHours, tipTotal, serviceRevenue, apptCount };
  }, [myShiftsRaw, transactions, myApptsRaw, staffMember]);

  const sortedNotifs   = useMemo(() => notifs ? [...notifs].sort((a,b) => new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime()) : [], [notifs]);
  const unreadCount    = useMemo(() => sortedNotifs.filter(n => !n.read).length, [sortedNotifs]);
  const sortedRequests = useMemo(() => myRequests ? [...myRequests].sort((a,b) => new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime()) : [], [myRequests]);
  const requestsBadge  = (incomingSwaps||[]).length + (isOwnerOrAdmin ? (pendingApprovals||[]).length : 0);

  const shiftsOnRequestDate = useMemo(() => {
    if (!requestDate||requestType!=='swap'||!allShiftsRaw||!allStaff) return [];
    return allShiftsRaw.filter((s: any) => s.date===requestDate&&s.staffId!==staffMember.id&&s.status!=='cancelled'&&s.status!=='draft').map((s: any) => ({ shift:s, member:(allStaff||[]).find((st: any) => st.id===s.staffId) })).filter((x: any) => x.member);
  }, [allShiftsRaw, allStaff, requestDate, requestType, staffMember.id]);

  const myShiftOnRequestDate = useMemo(() => (!requestDate||!myShiftsRaw) ? null : myShiftsRaw.find((s: any) => s.date===requestDate&&s.status!=='cancelled') || null, [myShiftsRaw, requestDate]);

  const todayColleagues = useMemo(() => {
    if (!allShiftsRaw||!allStaff) return [];
    const s = format(today,'yyyy-MM-dd');
    return allShiftsRaw.filter((sh: any) => sh.date===s&&sh.staffId!==staffMember.id&&sh.status!=='cancelled'&&sh.status!=='draft').map((sh: any) => { const m=(allStaff||[]).find((st: any) => st.id===sh.staffId); return m ? { id:sh.id, firstName:m.name?.split(' ')[0]||'Staff', startTime:sh.startTime, endTime:sh.endTime } : null; }).filter(Boolean);
  }, [allShiftsRaw, allStaff, today, staffMember.id]);

  // ── Appointment action handler ──
  const handleAptAction = useCallback(async (aptId: string, action: string, apt: any) => {
    if (!firestore||!tenantId) return;
    const now   = new Date().toISOString();
    const batch = writeBatch(firestore);
    const aptRef = doc(firestore,`tenants/${tenantId}/appointments`,aptId);
    switch (action) {
      case 'start':
        batch.update(aptRef,{ status:'servicing', actualStartTime:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'busy' },{ merge:true });
        break;
      case 'checkout':
        batch.update(aptRef,{ status:'ready_for_checkout', actualEndTime:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'idle' },{ merge:true });
        break;
      case 'complete':
        batch.update(aptRef,{ status:'completed', completedAt:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'available' },{ merge:true });
        break;
      case 'escalate': {
        batch.update(aptRef,{ escalatedAt:now, escalatedBy:staffMember.id });
        const mgrs = await getDocs(query(collection(firestore,`tenants/${tenantId}/staff`),where('role','in',['owner','admin'])));
        mgrs.docs.forEach(mgr => { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:mgr.id, read:false, createdAt:now, type:'escalation', link:'/appointments', message:`${staffMember.name} escalated ${apt.clientName||'a client'} at checkout.` }); });
        break;
      }
      case 'noshow':
        batch.update(aptRef,{ status:'no_show', noShowAt:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'available' },{ merge:true });
        break;
    }
    await batch.commit();
    const labels: Record<string,string> = { start:'Service Started ✓', checkout:'Sent to Checkout ✓', complete:'Marked Complete ✓', escalate:'Escalated to Manager ✓', noshow:'Marked No Show' };
    toast({ title: labels[action] || 'Updated' });
  }, [firestore, tenantId, staffMember]);

  // ── Escalation handler ──
  const handleEscalate = useCallback(async (apt: any) => {
    if (!firestore||!tenantId) return;
    const now  = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore,`tenants/${tenantId}/appointments`,apt.id), { isEscalated: true, escalatedAt: now, escalatedBy: staffMember.id });
    const mgrs = await getDocs(query(collection(firestore,`tenants/${tenantId}/staff`),where('role','in',['owner','admin'])));
    mgrs.docs.forEach(mgr => {
      const n = doc(collection(firestore,`tenants/${tenantId}/notifications`));
      batch.set(n,{ id:n.id, userId:mgr.id, read:false, createdAt:now, type:'escalation', link:'/appointments', message:`URGENT: ${staffMember.name} escalated an issue with ${apt.clientName||'a guest'} (${apt.id.slice(-6).toUpperCase()}).` });
    });
    await batch.commit();
    toast({ title:'Management Alerted ✓', description:'All owners and admins have been notified.' });
  }, [firestore, tenantId, staffMember]);

  const handleNotifClick = async (n: any) => {
    if (!n.read) { try { await updateDoc(doc(firestore,`tenants/${tenantId}/notifications`,n.id),{ read:true }); } catch {} }
    const map: Record<string,typeof activeTab> = { requests:'requests', schedule:'schedule', '/my-schedule':'schedule', '/schedule/requests':'requests', earnings:'earnings', today:'today' };
    if (n.link && map[n.link]) {
      setActiveTab(map[n.link]);
      return;
    }
    // v24 — FIX: previously any link that wasn't one of the five internal
    // tab names above did nothing at all — tapping an SMS escalation or
    // membership-payment-failed notification (both write a real /messages
    // or /clients link) just silently marked it read, despite the row
    // showing a "View →" indicator implying it was tappable. Falls
    // through to real navigation for anything else.
    if (n.link) {
      router.push(n.link);
    }
  };

  const handleClearInbox = async () => {
    if (!notifs?.length) return;
    setIsClearingInbox(true);
    try {
      const batch = writeBatch(firestore);
      notifs.forEach(n => batch.delete(doc(firestore,`tenants/${tenantId}/notifications`,n.id)));
      await batch.commit();
      toast({ title:'Inbox Cleared' });
    } catch { toast({ variant:'destructive', title:'Failed to clear inbox.' }); }
    finally { setIsClearingInbox(false); }
  };

  const handleSubmitRequest = async () => {
    if (!requestDate||!requestReason.trim()) { toast({ variant:'destructive', title:'Fill in all fields.' }); return; }
    if (requestType==='swap'&&!swapTargetShiftId) { toast({ variant:'destructive', title:'Choose a shift to swap.' }); return; }
    if (requestType==='swap'&&!myShiftOnRequestDate) { toast({ variant:'destructive', title:"You're not scheduled on this date." }); return; }
    setIsSubmitting(true);
    try {
      const batch=writeBatch(firestore); const now=new Date().toISOString();
      const reqRef=doc(collection(firestore,`tenants/${tenantId}/shiftRequests`));
      batch.set(reqRef,{ id:reqRef.id, staffId:staffMember.id, type:requestType, date:requestDate, reason:requestReason, status:requestType==='swap'?'pending_swap_consent':'pending', createdAt:now, ...(requestType==='swap'&&{ swapWithStaffId:swapTargetStaffId, swapShiftId:swapTargetShiftId, myShiftId:myShiftOnRequestDate?.id||null }) });
      if (requestType==='day_off') { const b=doc(collection(firestore,`tenants/${tenantId}/shiftDayOffBlocks`)); batch.set(b,{ id:b.id, staffId:staffMember.id, date:requestDate, status:'pending', requestId:reqRef.id, reason:requestReason, createdAt:now }); }
      if (requestType==='swap'&&swapTargetStaffId) { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:swapTargetStaffId, read:false, createdAt:now, type:'swap_request', link:'requests', message:`${staffMember.name} wants to swap shifts on ${format(safeDate(requestDate),'EEE, MMM d')}.` }); }
      if (requestType!=='swap') { const mgrs=await getDocs(query(collection(firestore,`tenants/${tenantId}/staff`),where('role','in',['owner','admin']))); mgrs.docs.forEach(mgr => { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:mgr.id, read:false, createdAt:now, type:requestType==='day_off'?'day_off_request':'early_release_request', link:'/schedule/requests', message:`${staffMember.name} requested ${requestType==='day_off'?'a day off':'early release'} on ${format(safeDate(requestDate),'EEE, MMM d')}.` }); }); }
      await batch.commit();
      toast({ title:'Request Submitted ✓' });
      setIsRequestOpen(false); setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId('');
    } catch { toast({ variant:'destructive', title:'Submission failed.' }); }
    finally { setIsSubmitting(false); }
  };

  const TABS = [
    { id:'today',    label:'Today',    icon:CalendarDays },
    { id:'schedule', label:'Schedule', icon:Calendar },
    { id:'earnings', label:'Earnings', icon:DollarSign },
    { id:'requests', label:'Requests', icon:ClipboardList, badge:requestsBadge },
    { id:'messages', label:'Messages', icon:MessageSquare, badge:messagesBadge, external:'/messages' },
    { id:'inbox',    label:'Inbox',    icon:Bell, badge:unreadCount },
  ] as const;

  const NOTIF_ICONS: Record<string,any> = {
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
    escalation:         <AlertTriangle className="w-4 h-4 text-amber-500" />,
    client_movement:    <Activity className="w-4 h-4 text-blue-500" />,
    sms_escalation:      <MessageSquare className="w-4 h-4 text-primary" />,
    sms_escalation_unassigned: <MessageSquare className="w-4 h-4 text-amber-500" />,
    membership_payment_failed: <CreditCard className="w-4 h-4 text-destructive" />,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">

      {/* Header */}
      <div className="bg-slate-900 px-5 pt-6 pb-5 space-y-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-11 h-11 rounded-2xl border-2 border-white/10">
              <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-primary/20 text-primary font-black">{staffMember.name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-black uppercase text-white text-sm leading-none">{staffMember.name}</p>
              <p className="text-[9px] font-black uppercase text-primary/60 mt-0.5">{staffMember.role} · {format(today,'EEE, MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsRequestOpen(true)} className="h-9 px-3 rounded-xl bg-primary/20 border border-primary/30 text-primary font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 hover:bg-primary/30 transition-colors">
              <Plus className="w-3.5 h-3.5" />Request
            </button>
            <button onClick={onSignOut} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
          <div className={cn('w-2.5 h-2.5 rounded-full shrink-0',
            clockStatus.isOnBreak ? 'bg-amber-400 animate-pulse' :
            clockStatus.isClockedIn ? 'bg-green-400 animate-pulse' : 'bg-white/20')} />
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase text-white/40">Status</p>
            <p className="font-black text-white text-sm">
              {clockStatus.isOnBreak
                ? `On Break · ${clockStatus.breakMinutes}m`
                : clockStatus.isClockedIn
                  ? `Clocked In · ${Math.floor(clockStatus.minutesWorked/60)}h ${clockStatus.minutesWorked%60}m`
                  : 'Not Clocked In'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {todayShift && <div className="text-right"><p className="text-[9px] font-black uppercase text-white/40">Shift</p><p className="font-black text-primary text-sm">{fmt12(todayShift.startTime)} – {fmt12(todayShift.endTime)}</p></div>}
            <ClockButton staffMember={staffMember} tenantId={tenantId} firestore={firestore} clockStatus={clockStatus} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-white border-b-2 border-slate-100 shrink-0">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => (tab as any).external ? router.push((tab as any).external) : setActiveTab(tab.id as any)}
            className={cn('flex-1 flex flex-col items-center gap-1 py-3 text-[8px] font-black uppercase tracking-widest transition-all relative shrink-0 min-w-[56px]', activeTab===tab.id ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground')}>
            <div className="relative">
              <tab.icon className="w-4 h-4" />
              {(tab as any).badge > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[7px] font-black rounded-full flex items-center justify-center">{(tab as any).badge}</span>}
            </div>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end px-4 py-1.5 bg-slate-50 shrink-0">
        <button onClick={() => setRefreshKey(k => k+1)} className="flex items-center gap-1 text-[8px] font-black uppercase text-muted-foreground opacity-30 hover:opacity-60 transition-opacity">
          <RefreshCw className="w-2.5 h-2.5" />Refresh
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-10 space-y-4">

          {/* TODAY */}
          {activeTab==='today' && (
            isLoadingToday ? <TabSkeleton /> : (
              <div className="space-y-4">
{stuckApts.length > 0 && (
                  <div className="rounded-[2rem] border-2 border-amber-300 bg-amber-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-2 bg-amber-100/60">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <p className="font-black uppercase text-[10px] text-amber-700 tracking-widest">
                        {stuckApts.length} Session{stuckApts.length > 1 ? 's' : ''} Need Attention
                      </p>
                    </div>
                    <div className="divide-y divide-amber-100">
                      {stuckApts.map((apt: any) => {
                        const svc = (services || []).find((s: any) => s.id === apt.serviceId);
                        return (
                          <button key={apt.id}
                            onClick={() => { setDrawerApt(apt); setDrawerSvc(svc); }}
                            className="w-full flex items-center gap-3 p-4 text-left active:bg-amber-100 transition-all active:scale-[0.98]">
                            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                              apt.status === 'servicing' ? 'bg-primary/10' : 'bg-emerald-100')}>
                              {apt.status === 'servicing'
                                ? <Timer className="w-4 h-4 text-primary" />
                                : <ShoppingCart className="w-4 h-4 text-emerald-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black uppercase text-[11px] text-slate-800 truncate">
                                {apt.clientName?.split(' ')[0] || 'Guest'} · {svc?.name || 'Service'}
                              </p>
                              <p className="text-[8px] font-bold text-amber-700 uppercase">
                                Started {format(safeDate(apt.startTime), 'MMM d')} · Never closed
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className={cn('text-[7px] font-black uppercase rounded-lg px-1.5 py-0.5',
                                apt.status === 'servicing' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                                {apt.status === 'servicing' ? 'In Service' : 'Checkout Queue'}
                              </span>
                              <ChevronRight className="w-3 h-3 text-amber-500" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <NextBanner appointments={allMyApts} services={services} />
                <WalkInLeaderboard
                  allWalkIns={allWalkInsRaw || []}
                  allStaff={allStaff || []}
                  allShifts={allShiftsRaw || []}
                  services={services || []}
                  tenantId={tenantId}
                  firestore={firestore}
                  currentStaffId={staffMember?.id}
                  activityLogs={activityLogs || []}
                />
                <DateNavigator selectedDate={selectedDate} onChange={setSelectedDate} />
                <DayTimeline
                  appointments={allMyApts}
                  services={services}
                  selectedDate={selectedDate}
                  onAptTap={apt => { setDrawerApt(apt); setDrawerSvc((services||[]).find((s: any) => s.id===apt.serviceId)); }}
                  allStaffApts={allTodayApptsRaw || []}
                  allWalkIns={allWalkInsRaw || []}
                  allStaff={allStaff || []}
                  allStaffBlocks={staffBlocksRaw || []}
                  allEvents={allEventsRaw || []}
                  allShiftsForDay={allShiftsRaw || []}
                  currentStaffId={staffMember?.id}
                  clockStatus={clockStatus}
                />
                {isSameDay(selectedDate,today) && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Also Working Today</p>
                    {todayColleagues.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {todayColleagues.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-2 p-3 rounded-2xl border-2 border-slate-100 bg-white">
                            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><p className="font-black text-primary text-sm">{c.firstName[0]}</p></div>
                            <div className="min-w-0"><p className="font-black uppercase text-[10px] truncate">{c.firstName}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{fmt12(c.startTime)} – {fmt12(c.endTime)}</p></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center rounded-2xl border-2 border-dashed opacity-30"><p className="text-[10px] font-black uppercase tracking-widest">No other staff scheduled</p></div>
                    )}
                  </div>
                )}

                {/* Today's Activity Feed — real-time appointment status changes */}
                {isSameDay(selectedDate, today) && (() => {
                  const todayApts = allMyApts
                    .filter((a: any) => isSameDay(safeDate(a.startTime), today))
                    .sort((a: any, b: any) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
                  if (todayApts.length === 0) return null;

                  const statusIcon: Record<string, any> = {
                    confirmed:          { icon: CheckCircle2,  color: 'text-blue-500',    bg: 'bg-blue-50',    label: 'Confirmed'          },
                    servicing:          { icon: Play,           color: 'text-primary',     bg: 'bg-primary/5',  label: 'In Service'         },
                    ready_for_checkout: { icon: ShoppingCart,   color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Ready for Checkout' },
                    completed:          { icon: CheckCircle,    color: 'text-green-600',   bg: 'bg-green-50',   label: 'Completed'          },
                    no_show:            { icon: XCircle,        color: 'text-slate-500',   bg: 'bg-slate-50',   label: 'No Show'            },
                    cancelled:          { icon: XCircle,        color: 'text-destructive', bg: 'bg-destructive/5', label: 'Cancelled'       },
                  };
                  const checkInIcon: Record<string, any> = {
                    arrived:      { label: 'Client Arrived',    color: 'text-green-600', bg: 'bg-green-50' },
                    running_late: { label: 'Running Late',      color: 'text-amber-600', bg: 'bg-amber-50' },
                    on_my_way:    { label: 'Client En Route',   color: 'text-blue-600',  bg: 'bg-blue-50'  },
                  };

                  return (
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Today's Activity</p>
                      <div className="space-y-2">
                        {todayApts.map((a: any) => {
                          const svc = (services || []).find((s: any) => s.id === a.serviceId);
                          const st  = statusIcon[a.status] || statusIcon.confirmed;
                          const ci  = a.checkInStatus && a.checkInStatus !== 'pending' ? checkInIcon[a.checkInStatus] : null;
                          const Icon = st.icon;
                          return (
                            <div key={a.id}
                              onClick={() => { setDrawerApt(a); setDrawerSvc(svc); }}
                              className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-100 bg-white cursor-pointer active:scale-[0.98] transition-all">
                              <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', st.bg)}>
                                <Icon className={cn('w-4 h-4', st.color)} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-black uppercase text-[11px] text-slate-800 truncate">
                                  {a.clientName?.split(' ')[0] || 'Guest'} · {svc?.name || 'Service'}
                                </p>
                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                                  {format(safeDate(a.startTime), 'h:mm a')} · {st.label}
                                </p>
                              </div>
                              {ci && (
                                <span className={cn('shrink-0 text-[7px] font-black uppercase rounded-lg px-1.5 py-0.5', ci.bg, ci.color)}>
                                  {ci.label}
                                </span>
                              )}
                              {a.isEscalated && (
                                <span className="shrink-0 text-[7px] font-black uppercase rounded-lg px-1.5 py-0.5 bg-destructive/10 text-destructive animate-pulse">
                                  Escalated
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )
          )}

          {/* SCHEDULE */}
          {activeTab==='schedule' && (
            shiftsLoading ? <TabSkeleton /> : (
              <div className="space-y-4">
                <DateNavigator selectedDate={selectedDate} onChange={setSelectedDate} />
                {(() => {
                  const dayStr   = format(selectedDate,'yyyy-MM-dd');
                  const dayShift = (myShiftsRaw||[]).find((s: any) => s.date===dayStr&&s.status!=='cancelled'&&s.status!=='draft');
                  const isPast   = isBefore(selectedDate,startOfDay(today))&&!isToday(selectedDate);
                  return (
                    <div className={cn('rounded-[2rem] border-2 overflow-hidden bg-white', isToday(selectedDate) ? 'border-primary/30 shadow-md shadow-primary/10' : 'border-slate-100', isPast && 'opacity-50')}>
                      <div className={cn('px-4 py-3 flex items-center gap-3 border-b border-dashed', isToday(selectedDate) ? 'bg-primary/5' : 'bg-muted/5')}>
                        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0', isToday(selectedDate) ? 'bg-primary text-white' : 'bg-white border-2 text-slate-600')}>{format(selectedDate,'d')}</div>
                        <div className="flex-1"><p className={cn('font-black uppercase text-sm leading-none', isToday(selectedDate) ? 'text-primary' : 'text-slate-700')}>{format(selectedDate,'EEEE')}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(selectedDate,'MMMM d, yyyy')}</p></div>
                        {isToday(selectedDate) && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase">Today</Badge>}
                      </div>
                      <div className="p-3">
                        {dayShift ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border-2 border-primary/10">
                            <Clock className="w-4 h-4 text-primary/40 shrink-0" />
                            <div className="flex-1"><p className="font-black uppercase text-[11px] text-primary">{fmt12(dayShift.startTime)} – {fmt12(dayShift.endTime)}</p>{(dayShift.breakMinutes||0)>0&&<p className="text-[9px] font-bold opacity-60 uppercase flex items-center gap-1"><Coffee className="w-2.5 h-2.5"/>{dayShift.breakMinutes}m break</p>}{dayShift.notes&&<p className="text-[9px] italic text-muted-foreground opacity-70 mt-0.5 truncate">{dayShift.notes}</p>}</div>
                            <p className="font-black font-mono text-sm text-primary shrink-0">{calcHours(dayShift.startTime,dayShift.endTime,dayShift.breakMinutes||0).toFixed(1)}h</p>
                          </div>
                        ) : <p className="text-[9px] font-black uppercase text-muted-foreground opacity-30 text-center py-2">No shift scheduled</p>}
                      </div>
                    </div>
                  );
                })()}
                <DayTimeline
                  appointments={allMyApts}
                  services={services}
                  selectedDate={selectedDate}
                  onAptTap={apt => { setDrawerApt(apt); setDrawerSvc((services||[]).find((s: any) => s.id===apt.serviceId)); }}
                  allStaffApts={allTodayApptsRaw || []}
                  allWalkIns={allWalkInsRaw || []}
                  allStaff={allStaff || []}
                  allStaffBlocks={staffBlocksRaw || []}
                  allEvents={allEventsRaw || []}
                  allShiftsForDay={allShiftsRaw || []}
                  currentStaffId={staffMember?.id}
                  clockStatus={clockStatus}
                />
              </div>
            )
          )}

          {/* EARNINGS */}
          {activeTab==='earnings' && (
            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">This Week's Summary</p>
              <div className="p-6 rounded-[2.5rem] bg-slate-900 text-white space-y-6">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.3em]">Estimated Earnings</p>
                  <p className="text-5xl font-black font-mono tracking-tighter text-primary">${weekEarnings.estimatedPay.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-white/40 uppercase">{staffMember.payStructure?.replace(/_/g,' ')||'commission'} · {weekEarnings.weekHours.toFixed(1)}h</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[{l:'Tips',v:`$${weekEarnings.tipTotal.toFixed(0)}`,c:'text-green-400'},{l:'Services',v:String(weekEarnings.apptCount),c:'text-white'},{l:'Hours',v:weekEarnings.weekHours.toFixed(1),c:'text-white'}].map(({l,v,c}) => (
                    <div key={l} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center"><p className="text-[8px] font-black uppercase text-white/40">{l}</p><p className={cn('font-black font-mono text-lg',c)}>{v}</p></div>
                  ))}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-white border-2 border-slate-100 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Pay Structure</p>
                <div className="flex items-center justify-between"><p className="font-bold uppercase text-sm text-slate-700">{staffMember.payStructure?.replace(/_/g,' ')||'Commission'}</p>{staffMember.commissionRate&&<Badge className="bg-primary/10 text-primary border-none font-black text-[10px]">{staffMember.commissionRate}% service</Badge>}</div>
                {staffMember.hourlyRate&&<p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">${staffMember.hourlyRate}/hr base</p>}
                <div className="pt-2 border-t border-dashed"><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed">Estimates based on scheduled shifts and completed services. Final payout confirmed by management.</p></div>
              </div>
            </div>
          )}

          {/* REQUESTS */}
          {activeTab==='requests' && (
            <div className="space-y-4">
              {isOwnerOrAdmin&&(pendingApprovals||[]).length>0&&(
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 px-1 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5"/>Awaiting Your Approval</p>
                  {(pendingApprovals||[]).map((r: any) => <SwapApproveCard key={r.id} req={r} staffMember={staffMember} tenantId={tenantId} firestore={firestore} allStaff={allStaff} allShifts={allShiftsRaw}/>)}
                </div>
              )}
              {(incomingSwaps||[]).length>0&&(
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-700 px-1 flex items-center gap-2"><Repeat className="w-3.5 h-3.5"/>Swap Requests For You</p>
                  {(incomingSwaps||[]).map((r: any) => <SwapConsentCard key={r.id} req={r} staffMember={staffMember} tenantId={tenantId} firestore={firestore} allStaff={allStaff} allShifts={allShiftsRaw}/>)}
                </div>
              )}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">My Requests</p>
                {sortedRequests.length===0&&(incomingSwaps||[]).length===0&&(!isOwnerOrAdmin||(pendingApprovals||[]).length===0)&&(
                  <div className="py-12 text-center border-2 border-dashed rounded-[2rem] opacity-30"><ClipboardList className="w-10 h-10 mx-auto mb-3"/><p className="text-[10px] font-black uppercase tracking-widest">No requests yet</p></div>
                )}
                {sortedRequests.map((req: any) => {
                  const swapTarget = req.swapWithStaffId ? (allStaff||[]).find((s: any) => s.id===req.swapWithStaffId) : null;
                  const si = STATUS_SWAP[req.status]||STATUS_SWAP.pending;
                  return (
                    <Card key={req.id} className="border-2 rounded-[2rem] bg-white shadow-sm">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {req.type==='day_off'?<Calendar className="w-4 h-4 text-blue-600"/>:req.type==='swap'?<Repeat className="w-4 h-4 text-purple-600"/>:<Zap className="w-4 h-4 text-amber-600"/>}
                            <div><p className="font-black uppercase text-[10px] text-slate-900">{req.type==='day_off'?'Day Off':req.type==='swap'?'Shift Swap':'Early Release'}{req.date&&` · ${format(safeDate(req.date),'MMM d')}`}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(req.createdAt),'MMM d, p')}</p></div>
                          </div>
                          <Badge className={cn('font-black text-[8px] uppercase border-none h-5 px-2 shrink-0',si.color)}>{si.label}</Badge>
                        </div>
                        {req.type==='swap'&&swapTarget&&<div className="flex items-center gap-2 text-[9px] font-bold text-purple-700 uppercase"><ArrowRight className="w-3 h-3 shrink-0"/>Swap with {swapTarget.name?.split(' ')[0]}</div>}
                        <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">{req.reason}</p>
                        {req.managerNote&&<div className="p-2.5 rounded-xl bg-primary/5 border border-primary/10"><p className="text-[9px] font-black uppercase text-primary/60 mb-0.5">Manager Response</p><p className="text-[10px] font-bold text-slate-700">{req.managerNote}</p></div>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* INBOX */}
          {activeTab==='inbox' && (
            <div className="space-y-3">
              {sortedNotifs.length>0&&(
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{unreadCount>0?`${unreadCount} unread`:'All caught up'}</p>
                  <button onClick={handleClearInbox} disabled={isClearingInbox} className="flex items-center gap-1.5 h-8 px-3 rounded-xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[8px] tracking-widest hover:bg-destructive/5 transition-all active:scale-95 disabled:opacity-50">
                    {isClearingInbox?<Loader className="w-3 h-3 animate-spin"/>:<Trash2 className="w-3 h-3"/>}Clear All
                  </button>
                </div>
              )}
              {sortedNotifs.length===0&&<div className="py-16 text-center opacity-30"><Bell className="w-10 h-10 mx-auto mb-3"/><p className="text-[10px] font-black uppercase tracking-widest">No notifications</p></div>}
              {sortedNotifs.map(n => (
                <div key={n.id} onClick={() => handleNotifClick(n)} className={cn('flex items-start gap-3 p-4 rounded-2xl border-2 bg-white cursor-pointer transition-all active:scale-[0.98]', !n.read?'border-primary/20 bg-primary/[0.02]':'border-slate-100')}>
                  <div className="p-2 rounded-xl bg-muted/20 border shrink-0">{NOTIF_ICONS[n.type]||<Bell className="w-4 h-4 text-muted-foreground"/>}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-relaxed">{n.message}</p>
                    <div className="flex items-center gap-2 mt-1"><p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">{format(safeDate(n.createdAt),'MMM d, h:mm a')}</p>{n.link&&<p className="text-[8px] font-black uppercase text-primary/50 flex items-center gap-0.5"><ChevronRight className="w-2.5 h-2.5"/>View</p>}</div>
                  </div>
                  {!n.read&&<div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5"/>}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Appointment action drawer */}
      {drawerApt && (
        <AppointmentDrawer
          apt={drawerApt}
          service={drawerSvc}
          allServices={services || []}
          allStaff={allStaff || []}
          allShifts={allShiftsRaw || []}
          currentStaffId={staffMember?.id}
          tenantId={tenantId}
          firestore={firestore}
          onClose={() => { setDrawerApt(null); setDrawerSvc(null); }}
          onAction={handleAptAction}
          onEscalate={handleEscalate}
          onReview={apt => {
            const svc = (services||[]).find((s: any) => s.id === apt.serviceId);
            setReviewApt(apt);
            setReviewSvc(svc);
          }} />
      )}

      {/* Technician Review Dialog — opens when staff tap "Finish Service & Review" */}
      {reviewApt && reviewSvc && (
        <TechnicianReviewDialog
          open={!!reviewApt}
          onOpenChange={v => { if (!v) { setReviewApt(null); setReviewSvc(null); } }}
          appointmentData={{ appointment: reviewApt, client: { id: reviewApt.clientId, name: reviewApt.clientName, phone: reviewApt.clientPhone, ...reviewApt.clientSnapshot }, service: reviewSvc }}
          onSendToFrontDesk={(aptId, checkoutState) => {
            if (!firestore || !tenantId) return;
            const batch = writeBatch(firestore);
            batch.update(doc(firestore, `tenants/${tenantId}/appointments`, aptId), {
              checkoutState: JSON.parse(JSON.stringify(checkoutState)),
            });
            batch.commit().then(() => toast({ title: 'Handed off to front desk ✓' }));
            setReviewApt(null); setReviewSvc(null);
          }}
          staff={allStaff || []}
        />
      )}

      {/* Request dialog */}
      <Dialog open={isRequestOpen} onOpenChange={v => { if (!v) { setIsRequestOpen(false); setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId(''); }}}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Submit Request</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Your manager will be notified.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</Label>
              <Select value={requestType} onValueChange={(v: any) => { setRequestType(v); setSwapTargetShiftId(''); setSwapTargetStaffId(''); }}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue/></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  <SelectItem value="day_off" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600"/>Day Off</div></SelectItem>
                  <SelectItem value="swap" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Repeat className="w-4 h-4 text-purple-600"/>Shift Swap</div></SelectItem>
                  <SelectItem value="early_release" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600"/>Early Release</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} min={format(today,'yyyy-MM-dd')} className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40"/>
            </div>
            {requestType==='swap'&&requestDate&&(
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Swap With</Label>
                {myShiftOnRequestDate ? <p className="text-[9px] font-bold text-primary/70 uppercase">Your shift: {fmt12(myShiftOnRequestDate.startTime)} – {fmt12(myShiftOnRequestDate.endTime)}</p>
                  : <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200"><AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0"/><p className="text-[9px] font-bold text-amber-700 uppercase">No shift on this date — swap not allowed</p></div>}
                {shiftsOnRequestDate.length>0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {shiftsOnRequestDate.map(({ shift, member }: any) => (
                      <button key={shift.id} type="button" onClick={() => { setSwapTargetShiftId(shift.id); setSwapTargetStaffId(shift.staffId); }}
                        className={cn('w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left', swapTargetShiftId===shift.id?'border-purple-400 bg-purple-50':'border-slate-200 bg-white hover:border-purple-200')}>
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><p className="font-black text-primary text-sm">{member?.name?.[0]}</p></div>
                        <div className="flex-1 min-w-0"><p className="font-black uppercase text-[10px] truncate">{member?.name?.split(' ')[0]}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{fmt12(shift.startTime)} – {fmt12(shift.endTime)}</p></div>
                        {swapTargetShiftId===shift.id&&<CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0"/>}
                      </button>
                    ))}
                  </div>
                ) : <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed text-center"><p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">No other staff scheduled on this date</p></div>}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
              <Textarea value={requestReason} onChange={e => setRequestReason(e.target.value)} placeholder="Explain your request..." className="rounded-2xl border-2 min-h-[80px]"/>
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleSubmitRequest} disabled={isSubmitting||!requestDate||!requestReason.trim()||(requestType==='swap'&&(!swapTargetShiftId||!myShiftOnRequestDate))} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isSubmitting ? <Loader className="animate-spin"/> : 'Submit Request'}
            </Button>
            <Button variant="ghost" onClick={() => setIsRequestOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function StaffPortalPage({ params }: { params: { tenantId: string } }) {
  const { firestore } = useFirebase();
  const [signedInStaff, setSignedInStaff] = useState<any | null>(null);
  const tenantId = params.tenantId;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSignedInStaff(null), 15 * 60 * 1000);
  }, []);

  useEffect(() => {
    if (!signedInStaff) return;
    resetTimeout();
    const events = ['touchstart','click','keydown'];
    events.forEach(e => window.addEventListener(e, resetTimeout));
    return () => { events.forEach(e => window.removeEventListener(e, resetTimeout)); if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [signedInStaff, resetTimeout]);

  if (!firestore || !tenantId) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-white/40 font-black uppercase text-[10px] tracking-widest animate-pulse">Loading...</p>
    </div>
  );

  if (!signedInStaff) return <PinEntry firestore={firestore} tenantId={tenantId} onSuccess={setSignedInStaff} />;

  return <ErrorBoundary><StaffDashboard staffMember={signedInStaff} tenantId={tenantId} firestore={firestore} onSignOut={() => setSignedInStaff(null)} /></ErrorBoundary>;
}
