'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  ChevronLeft, ChevronRight, Plus, Sparkles, Send, AlertTriangle, Check,
  Clock, DollarSign, Users, Loader, Trash2, Edit, Eye, EyeOff, X,
  CalendarDays, Shield, TrendingUp, Bell, Coffee, Zap, Info, RefreshCw,
  ChevronDown, UserCheck, AlertCircle, CheckCircle2, Calendar
} from 'lucide-react';
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
  addDays, isSameDay, parseISO, differenceInHours, differenceInMinutes,
  isToday, isBefore, startOfDay, addMinutes
} from 'date-fns';
import { cn, safeNumber } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { motion, AnimatePresence } from 'framer-motion';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  const period = h < 12 ? 'AM' : 'PM';
  const display = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m} ${period}`;
  return { value: `${String(h).padStart(2, '0')}:${m}`, label: display };
});

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const minutesToTime = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
};
const formatTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2,'0')} ${p}`;
};

type Shift = {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: 'draft' | 'published' | 'confirmed' | 'cancelled';
  notes?: string;
  estimatedPay?: number;
  createdBy?: string;
  publishedAt?: string;
};

type ShiftRequest = {
  id: string;
  staffId: string;
  type: 'day_off' | 'swap' | 'early_release' | 'availability_update';
  date?: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  swapWithStaffId?: string;
  swapShiftId?: string;
  createdAt: string;
};

type StaffAvailability = {
  staffId: string;
  weekly: Record<string, { available: boolean; start: string; end: string }>;
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  published: 'bg-primary/10 text-primary border-primary/20',
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
};

export default function SchedulePage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { staff, appointments, services } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [isAISuggestOpen, setIsAISuggestOpen] = useState(false);
  const [isPublishConfirmOpen, setIsPublishConfirmOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Shift[]>([]);
  const [isAILoading, setIsAILoading] = useState(false);
  const [showDraftOnly, setShowDraftOnly] = useState(false);

  // Shift form state
  const [shiftStaffId, setShiftStaffId] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [shiftBreak, setShiftBreak] = useState(30);
  const [shiftNotes, setShiftNotes] = useState('');

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Firestore queries
  const shiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('date', '>=', format(weekStart, 'yyyy-MM-dd')),
      where('date', '<=', format(weekEnd, 'yyyy-MM-dd'))
    );
  }, [firestore, tenantId, weekStart.toISOString()]);

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/shiftRequests`), where('status', '==', 'pending'));
  }, [firestore, tenantId]);

  const availabilityQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/staffAvailability`);
  }, [firestore, tenantId]);

  const { data: shifts } = useCollection<Shift>(shiftsQuery);
  const { data: pendingRequests } = useCollection<ShiftRequest>(requestsQuery);
  const { data: availabilityData } = useCollection<StaffAvailability>(availabilityQuery);

  // Safeguards config from tenant
  const minRestHours = safeNumber(selectedTenant?.minRestBetweenShifts) || 10;
  const minHoursPerWeek = safeNumber(selectedTenant?.minHoursPerWeek) || 0;
  const maxHoursPerWeek = safeNumber(selectedTenant?.overtimeThresholdHours) || 40;

  // Compute warnings for each staff member this week
  const staffWarnings = useMemo(() => {
    if (!shifts || !staff) return new Map<string, string[]>();
    const warnings = new Map<string, string[]>();
    staff.forEach(member => {
      const memberShifts = (shifts || []).filter(s => s.staffId === member.id && s.status !== 'cancelled');
      const totalMins = memberShifts.reduce((sum, s) => {
        const worked = timeToMinutes(s.endTime) - timeToMinutes(s.startTime) - (s.breakMinutes || 0);
        return sum + Math.max(0, worked);
      }, 0);
      const totalHours = totalMins / 60;
      const msgs: string[] = [];

      if (maxHoursPerWeek > 0 && totalHours > maxHoursPerWeek) {
        msgs.push(`Overtime: ${totalHours.toFixed(1)}h scheduled (limit ${maxHoursPerWeek}h)`);
      }
      if (minHoursPerWeek > 0 && totalHours < minHoursPerWeek && memberShifts.length > 0) {
        msgs.push(`Under minimum: ${totalHours.toFixed(1)}h (min ${minHoursPerWeek}h)`);
      }

      // Rest period check
      const sorted = [...memberShifts].sort((a, b) => {
        const aStart = new Date(`${a.date}T${a.startTime}`);
        const bStart = new Date(`${b.date}T${b.startTime}`);
        return aStart.getTime() - bStart.getTime();
      });
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = new Date(`${sorted[i-1].date}T${sorted[i-1].endTime}`);
        const currStart = new Date(`${sorted[i].date}T${sorted[i].startTime}`);
        const restHours = differenceInHours(currStart, prevEnd);
        if (restHours < minRestHours) {
          msgs.push(`Only ${restHours}h rest before ${format(currStart, 'EEE')} shift (min ${minRestHours}h)`);
        }
      }

      if (msgs.length > 0) warnings.set(member.id, msgs);
    });
    return warnings;
  }, [shifts, staff, maxHoursPerWeek, minHoursPerWeek, minRestHours]);

  // Coverage alerts -- days with no scheduled staff
  const coverageAlerts = useMemo(() => {
    if (!shifts) return [];
    return weekDays.filter(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayShifts = (shifts || []).filter(s => s.date === dayStr && s.status !== 'cancelled');
      return dayShifts.length === 0 && !isBefore(day, startOfDay(new Date()));
    });
  }, [shifts, weekDays]);

  // Labor cost preview
  const laborPreview = useMemo(() => {
    if (!shifts || !staff) return { total: 0, byStaff: [] };
    const byStaff = staff.map(member => {
      const memberShifts = (shifts || []).filter(s => s.staffId === member.id && s.status !== 'cancelled');
      const totalMins = memberShifts.reduce((sum, s) => {
        return sum + Math.max(0, timeToMinutes(s.endTime) - timeToMinutes(s.startTime) - (s.breakMinutes || 0));
      }, 0);
      const totalHours = totalMins / 60;
      let pay = 0;
      if (member.payStructure === 'hourly' && member.hourlyRate) {
        const otHours = Math.max(0, totalHours - maxHoursPerWeek);
        const regHours = totalHours - otHours;
        pay = regHours * member.hourlyRate + otHours * member.hourlyRate * (safeNumber(selectedTenant?.overtimeMultiplier) || 1.5);
      }
      return { member, totalHours, pay, shiftCount: memberShifts.length };
    }).filter(s => s.shiftCount > 0);
    return { total: byStaff.reduce((sum, s) => sum + s.pay, 0), byStaff };
  }, [shifts, staff, maxHoursPerWeek, selectedTenant]);

  // Draft shifts count
  const draftCount = useMemo(() => (shifts || []).filter(s => s.status === 'draft').length, [shifts]);
  const publishedCount = useMemo(() => (shifts || []).filter(s => s.status === 'published').length, [shifts]);

  // Check staff availability for a day
  const isStaffAvailable = useCallback((staffId: string, date: Date) => {
    const avail = (availabilityData || []).find(a => a.staffId === staffId);
    if (!avail) return true; // No availability set = assume available
    const dayName = format(date, 'EEEE').toLowerCase();
    const dayAvail = avail.weekly?.[dayName];
    if (!dayAvail) return true;
    return dayAvail.available !== false;
  }, [availabilityData]);

  const openAddShift = (day?: Date, staffId?: string) => {
    setEditingShift(null);
    setShiftStaffId(staffId || '');
    setShiftDate(day ? format(day, 'yyyy-MM-dd') : format(weekStart, 'yyyy-MM-dd'));
    setShiftStart('09:00');
    setShiftEnd('17:00');
    setShiftBreak(30);
    setShiftNotes('');
    setIsAddShiftOpen(true);
  };

  const openEditShift = (shift: Shift) => {
    setEditingShift(shift);
    setShiftStaffId(shift.staffId);
    setShiftDate(shift.date);
    setShiftStart(shift.startTime);
    setShiftEnd(shift.endTime);
    setShiftBreak(shift.breakMinutes || 0);
    setShiftNotes(shift.notes || '');
    setIsAddShiftOpen(true);
  };

  const handleSaveShift = async () => {
    if (!firestore || !tenantId || !shiftStaffId || !shiftDate) return;
    setIsProcessing(true);

    const worked = timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) - shiftBreak;
    const member = (staff || []).find(s => s.id === shiftStaffId);
    let estimatedPay = 0;
    if (member?.payStructure === 'hourly' && member.hourlyRate) {
      estimatedPay = (worked / 60) * member.hourlyRate;
    }

    const payload: Shift = {
      id: editingShift?.id || nanoid(),
      staffId: shiftStaffId,
      date: shiftDate,
      startTime: shiftStart,
      endTime: shiftEnd,
      breakMinutes: shiftBreak,
      status: editingShift?.status || 'draft',
      notes: shiftNotes || undefined,
      estimatedPay,
      createdBy: user?.uid,
    };

    try {
      await setDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/shifts`, payload.id),
        payload, {}
      );
      toast({ title: editingShift ? 'Shift Updated' : 'Shift Added' });
      setIsAddShiftOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (!firestore || !tenantId) return;
    await updateDocumentNonBlocking(
      doc(firestore, `tenants/${tenantId}/shifts`, shiftId),
      { status: 'cancelled' }
    );
    toast({ title: 'Shift Removed' });
  };

  const handlePublishAll = async () => {
    if (!firestore || !tenantId) return;
    setIsProcessing(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const draftShifts = (shifts || []).filter(s => s.status === 'draft');

    draftShifts.forEach(shift => {
      batch.update(doc(firestore, `tenants/${tenantId}/shifts`, shift.id), {
        status: 'published',
        publishedAt: now,
      });
    });

    // Notify all affected staff
    const notifiedStaff = new Set<string>();
    draftShifts.forEach(shift => notifiedStaff.add(shift.staffId));
    notifiedStaff.forEach(staffId => {
      const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(notifRef, {
        id: notifRef.id, userId: staffId, type: 'schedule_published',
        message: `Your schedule for the week of ${format(weekStart, 'MMM d')} has been published.`,
        link: '/schedule', createdAt: now, read: false,
      });
    });

    try {
      await batch.commit();
      toast({ title: 'Schedule Published', description: `${draftShifts.length} shifts published. Staff notified.` });
      setIsPublishConfirmOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  // Smart rule-based schedule suggestion -- no API key required
  // Uses the same logic an AI would: appointment demand, staff availability,
  // overtime limits, rest periods, skill matching, and labor cost optimization
  const handleAISuggest = () => {
    if (!staff || !appointments) return;
    setIsAILoading(true);

    try {
      const suggestions: Shift[] = [];
      // Track hours assigned per staff this week to respect OT limits
      const hoursAssigned: Record<string, number> = {};
      // Track last shift end per staff to enforce min rest
      const lastShiftEnd: Record<string, Date> = {};

      (staff || []).forEach(s => { hoursAssigned[s.id] = 0; });

      // Sort staff by cost: hourly staff cheapest first, then commission
      const sortedStaff = [...(staff || [])].sort((a, b) => {
        const aCost = a.payStructure === 'hourly' ? (a.hourlyRate || 99) : 50;
        const bCost = b.payStructure === 'hourly' ? (b.hourlyRate || 99) : 50;
        return aCost - bCost;
      });

      weekDays.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        // Skip past days
        if (isBefore(day, startOfDay(new Date()))) return;

        const dayApts = (appointments || []).filter(
          a => isSameDay(safeDate(a.startTime), day) && a.status !== 'cancelled'
        );

        // Determine how many staff we need based on appointment volume
        const staffNeeded = dayApts.length === 0 ? 0
          : dayApts.length <= 2 ? 1
          : dayApts.length <= 5 ? 2
          : 3;

        if (staffNeeded === 0) return;

        // Find the earliest and latest appointment times to anchor shift windows
        let shiftStart = '09:00';
        let shiftEnd = '17:00';
        if (dayApts.length > 0) {
          const times = dayApts.map(a => safeDate(a.startTime));
          const earliest = times.reduce((min, t) => t < min ? t : min, times[0]);
          const latest = times.reduce((max, t) => t > max ? t : max, times[0]);
          // Start 30 min before first appointment, end 1hr after last
          const startMins = Math.max(0, earliest.getHours() * 60 + earliest.getMinutes() - 30);
          const endMins = Math.min(23 * 60 + 30, latest.getHours() * 60 + latest.getMinutes() + 60);
          // Round to nearest 30
          shiftStart = minutesToTime(Math.floor(startMins / 30) * 30);
          shiftEnd = minutesToTime(Math.ceil(endMins / 30) * 30);
          // Minimum 4h shift
          if (timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) < 240) {
            shiftEnd = minutesToTime(timeToMinutes(shiftStart) + 480);
          }
        }

        const shiftDurationHours = (timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) - 30) / 60;
        let staffAssignedToday = 0;

        for (const member of sortedStaff) {
          if (staffAssignedToday >= staffNeeded) break;

          // Check availability setting
          if (!isStaffAvailable(member.id, day)) continue;

          // Check weekly OT limit
          if (maxHoursPerWeek > 0 && (hoursAssigned[member.id] || 0) + shiftDurationHours > maxHoursPerWeek + 2) continue;

          // Check min rest from last shift
          if (lastShiftEnd[member.id]) {
            const shiftStartDate = new Date(`${dayStr}T${shiftStart}:00`);
            const restHours = differenceInHours(shiftStartDate, lastShiftEnd[member.id]);
            if (restHours < minRestHours) continue;
          }

          // Check if already scheduled this day
          const alreadyScheduled = suggestions.some(s => s.staffId === member.id && s.date === dayStr);
          if (alreadyScheduled) continue;

          // Skill match -- if appointments require specific services, check staff skills
          const requiredSkills = dayApts.flatMap(a => {
            const svc = (services || []).find(s => s.id === a.serviceId);
            return svc?.requiredSkills || [];
          });
          const uniqueSkills = [...new Set(requiredSkills)];
          if (uniqueSkills.length > 0 && member.skillSet && member.skillSet.length > 0) {
            const hasRequiredSkill = uniqueSkills.some(skill => member.skillSet!.includes(skill));
            if (!hasRequiredSkill && staffAssignedToday > 0) continue; // Skip if not skilled and coverage already met
          }

          // Assign the shift
          const worked = timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) - 30;
          const estimatedPay = member.payStructure === 'hourly' && member.hourlyRate
            ? (worked / 60) * member.hourlyRate : 0;

          const aptCount = dayApts.length;
          const note = aptCount === 0 ? 'Coverage shift'
            : aptCount === 1 ? '1 appointment scheduled'
            : `${aptCount} appointments scheduled`;

          suggestions.push({
            id: nanoid(),
            staffId: member.id,
            date: dayStr,
            startTime: shiftStart,
            endTime: shiftEnd,
            breakMinutes: shiftDurationHours > 5 ? 30 : 0,
            status: 'draft',
            notes: note,
            estimatedPay,
          });

          hoursAssigned[member.id] = (hoursAssigned[member.id] || 0) + shiftDurationHours;
          lastShiftEnd[member.id] = new Date(`${dayStr}T${shiftEnd}:00`);
          staffAssignedToday++;
        }
      });

      if (suggestions.length === 0) {
        toast({ title: 'Nothing to Suggest', description: 'No upcoming appointments found or all staff are unavailable this week.' });
        return;
      }

      setAiSuggestions(suggestions);
      setIsAISuggestOpen(true);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Suggestion Failed', description: 'Something went wrong generating the schedule.' });
    } finally {
      setIsAILoading(false);
    }
  };

  const handleApplyAISuggestions = async () => {
    if (!firestore || !tenantId || !aiSuggestions.length) return;
    setIsProcessing(true);
    const batch = writeBatch(firestore);
    aiSuggestions.forEach(shift => {
      batch.set(doc(firestore, `tenants/${tenantId}/shifts`, shift.id), shift);
    });
    try {
      await batch.commit();
      toast({ title: 'AI Schedule Applied', description: `${aiSuggestions.length} shifts added as drafts. Review and publish when ready.` });
      setIsAISuggestOpen(false);
      setAiSuggestions([]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Shifts grouped by staff + day for grid
  const shiftGrid = useMemo(() => {
    const grid: Record<string, Record<string, Shift[]>> = {};
    (staff || []).forEach(member => {
      grid[member.id] = {};
      weekDays.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        grid[member.id][dayStr] = (shifts || []).filter(
          s => s.staffId === member.id && s.date === dayStr && s.status !== 'cancelled'
        );
      });
    });
    return grid;
  }, [shifts, staff, weekDays]);

  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="Shift Schedule" />
      <main className="flex-1 p-4 md:p-8 w-full max-w-[1400px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Schedule</h1>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Shift management & labor planning</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-3">
              {(pendingRequests || []).length > 0 && (
                <Button variant="outline" className="h-12 px-5 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest relative" onClick={() => window.location.href = '/schedule/requests'}>
                  <Bell className="w-4 h-4 mr-2" />
                  Requests
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-white text-[8px] font-black rounded-full flex items-center justify-center">{(pendingRequests || []).length}</span>
                </Button>
              )}
              <Button variant="outline" onClick={handleAISuggest} disabled={isAILoading} className="h-12 px-5 rounded-2xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/10">
                {isAILoading ? <Loader className="animate-spin w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Auto-Schedule
              </Button>
              <Button onClick={() => openAddShift()} className="h-12 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" /> Add Shift
              </Button>
              {draftCount > 0 && (
                <Button onClick={() => setIsPublishConfirmOpen(true)} className="h-12 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-green-500/20 bg-green-600 hover:bg-green-700">
                  <Send className="w-4 h-4 mr-2" /> Publish {draftCount} Draft{draftCount !== 1 ? 's' : ''}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Alerts row */}
        <div className="flex flex-wrap gap-3">
          {coverageAlerts.map(day => (
            <Badge key={day.toISOString()} variant="outline" className="h-8 px-4 rounded-2xl bg-amber-50 border-amber-200 text-amber-700 font-black uppercase text-[9px] gap-2">
              <AlertTriangle className="w-3 h-3" /> No coverage {format(day, 'EEE MMM d')}
            </Badge>
          ))}
          {Array.from(staffWarnings.entries()).slice(0, 3).map(([sId, msgs]) => {
            const member = (staff || []).find(s => s.id === sId);
            return (
              <Badge key={sId} variant="outline" className="h-8 px-4 rounded-2xl bg-red-50 border-red-200 text-red-700 font-black uppercase text-[9px] gap-2">
                <AlertCircle className="w-3 h-3" /> {member?.name}: {msgs[0]}
              </Badge>
            );
          })}
        </div>

        {/* Week nav + Labor preview */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 p-1 bg-white rounded-[2rem] border-2 shadow-sm">
            <Button variant="ghost" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronLeft className="w-5 h-5" /></Button>
            <div className="text-center min-w-[160px]">
              <p className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Week</p>
              <p className="font-black text-sm uppercase tracking-tight">{format(weekStart, 'MMM d')} -- {format(weekEnd, 'MMM d')}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="h-10 w-10 rounded-xl"><ChevronRight className="w-5 h-5" /></Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="h-9 px-4 rounded-xl font-black uppercase text-[9px] border-2 mr-1">Today</Button>
          </div>

          {/* Labor cost pill */}
          {laborPreview.total > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 bg-white rounded-[2rem] border-2 shadow-sm">
              <DollarSign className="w-4 h-4 text-green-600" />
              <div>
                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Est. Labor Cost</p>
                <p className="font-black text-lg font-mono text-green-600">${laborPreview.total.toFixed(2)}</p>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Shifts</p>
                <p className="font-black text-lg font-mono text-slate-900">{(shifts || []).filter(s => s.status !== 'cancelled').length}</p>
              </div>
            </div>
          )}
        </div>

        {/* Schedule grid -- desktop */}
        <Card className="border-2 rounded-[2.5rem] shadow-sm overflow-hidden bg-white hidden md:block">
          <ScrollArea className="w-full">
            <div className="min-w-[800px]">
              {/* Day headers */}
              <div className="grid border-b" style={{ gridTemplateColumns: '180px repeat(7, 1fr)' }}>
                <div className="p-4 border-r bg-muted/5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Staff</p>
                </div>
                {weekDays.map(day => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const dayShifts = (shifts || []).filter(s => s.date === dayStr && s.status !== 'cancelled');
                  const hasCoverage = dayShifts.length > 0;
                  return (
                    <div key={day.toISOString()} className={cn("p-3 border-r text-center", isToday(day) && "bg-primary/5")}>
                      <p className={cn("text-[9px] font-black uppercase tracking-widest opacity-60", isToday(day) ? "text-primary" : "text-muted-foreground")}>{format(day, 'EEE')}</p>
                      <p className={cn("font-black text-lg", isToday(day) ? "text-primary" : "text-slate-900")}>{format(day, 'd')}</p>
                      {!hasCoverage && !isBefore(day, startOfDay(new Date())) && (
                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full mx-auto mt-1" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Staff rows */}
              {(staff || []).map(member => {
                const warnings = staffWarnings.get(member.id) || [];
                const weekHours = laborPreview.byStaff.find(s => s.member.id === member.id)?.totalHours || 0;
                return (
                  <div key={member.id} className="grid border-b hover:bg-muted/5 transition-colors" style={{ gridTemplateColumns: '180px repeat(7, 1fr)' }}>
                    {/* Staff info */}
                    <div className="p-3 border-r flex flex-col gap-1.5 justify-center">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-8 h-8 rounded-xl border shrink-0">
                          <AvatarImage src={member.avatarUrl} className="object-cover" />
                          <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">{member.name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase truncate">{member.name}</p>
                          <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 truncate">{weekHours.toFixed(1)}h this week</p>
                        </div>
                      </div>
                      {warnings.length > 0 && (
                        <Badge className="bg-red-50 text-red-700 border-none font-black text-[7px] uppercase px-1.5 h-4 w-fit">
                          <AlertTriangle className="w-2.5 h-2.5 mr-1" />{warnings.length} alert{warnings.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>

                    {/* Day cells */}
                    {weekDays.map(day => {
                      const dayStr = format(day, 'yyyy-MM-dd');
                      const dayShifts = shiftGrid[member.id]?.[dayStr] || [];
                      const available = isStaffAvailable(member.id, day);
                      return (
                        <div
                          key={day.toISOString()}
                          className={cn(
                            "p-2 border-r min-h-[80px] relative group",
                            isToday(day) && "bg-primary/[0.02]",
                            !available && "bg-slate-50",
                          )}
                        >
                          {/* Availability indicator */}
                          {!available && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-20">
                              <p className="text-[8px] font-black uppercase text-slate-500 rotate-[-30deg]">Unavailable</p>
                            </div>
                          )}

                          {/* Shift blocks */}
                          <div className="space-y-1">
                            {dayShifts.map(shift => (
                              <div
                                key={shift.id}
                                className={cn(
                                  "rounded-xl px-2 py-1.5 border-2 text-left cursor-pointer transition-all hover:shadow-md group/shift",
                                  shift.status === 'draft' ? "bg-slate-50 border-slate-200" :
                                  shift.status === 'published' ? "bg-primary/5 border-primary/20" :
                                  shift.status === 'confirmed' ? "bg-green-50 border-green-200" :
                                  "bg-destructive/5 border-destructive/20"
                                )}
                                onClick={() => canManage && openEditShift(shift)}
                              >
                                <p className="text-[9px] font-black uppercase truncate">
                                  {formatTime(shift.startTime)} -- {formatTime(shift.endTime)}
                                </p>
                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                                  {((timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime) - (shift.breakMinutes || 0)) / 60).toFixed(1)}h
                                </p>
                                <div className="flex items-center justify-between mt-0.5">
                                  <Badge className={cn("h-3.5 px-1 text-[7px] font-black uppercase border-none", STATUS_STYLES[shift.status])}>
                                    {shift.status}
                                  </Badge>
                                  {canManage && (
                                    <button
                                      onClick={e => { e.stopPropagation(); handleDeleteShift(shift.id); }}
                                      className="opacity-0 group-hover/shift:opacity-100 transition-opacity text-destructive hover:text-destructive/70"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Add shift button */}
                          {canManage && available && (
                            <button
                              onClick={() => openAddShift(day, member.id)}
                              className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-lg bg-white border-2 border-dashed border-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary/30 hover:text-primary"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>

        {/* Mobile schedule -- day-by-day list */}
        <div className="md:hidden space-y-4">
          {weekDays.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const dayShifts = (shifts || []).filter(s => s.date === dayStr && s.status !== 'cancelled');
            return (
              <Card key={day.toISOString()} className={cn("border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm", isToday(day) && "border-primary/30 shadow-primary/10")}>
                <div className={cn("px-4 py-3 flex items-center justify-between border-b", isToday(day) ? "bg-primary/5" : "bg-muted/5")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0", isToday(day) ? "bg-primary text-white" : "bg-white border-2 text-slate-700")}>
                      {format(day, 'd')}
                    </div>
                    <div>
                      <p className={cn("font-black uppercase text-sm leading-none", isToday(day) ? "text-primary" : "text-slate-900")}>{format(day, 'EEEE')}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(day, 'MMM d')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {coverageAlerts.some(d => isSameDay(d, day)) && (
                      <Badge className="bg-amber-100 text-amber-700 border-none font-black text-[8px] uppercase h-5 px-2">
                        <AlertTriangle className="w-2.5 h-2.5 mr-1" />No Cover
                      </Badge>
                    )}
                    {canManage && (
                      <Button size="sm" variant="outline" onClick={() => openAddShift(day)} className="h-8 w-8 rounded-xl border-2 p-0">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {dayShifts.length > 0 ? dayShifts.map(shift => {
                    const member = (staff || []).find(s => s.id === shift.staffId);
                    const hours = ((timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime) - (shift.breakMinutes || 0)) / 60);
                    return (
                      <div key={shift.id} className={cn("flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer", shift.status === 'draft' ? "bg-slate-50 border-slate-200" : shift.status === 'published' ? "bg-primary/5 border-primary/20" : "bg-green-50 border-green-200")} onClick={() => canManage && openEditShift(shift)}>
                        <Avatar className="w-8 h-8 rounded-xl border shrink-0">
                          <AvatarImage src={member?.avatarUrl} className="object-cover" />
                          <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-black uppercase text-[10px] truncate">{member?.name || 'Unknown'}</p>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{formatTime(shift.startTime)} -- {formatTime(shift.endTime)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black font-mono text-sm text-primary">{hours.toFixed(1)}h</p>
                          <Badge className={cn("h-4 px-1 text-[7px] font-black uppercase border-none", STATUS_STYLES[shift.status])}>{shift.status}</Badge>
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40 text-center py-3">No shifts scheduled</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {/* Labor breakdown */}
        {laborPreview.byStaff.length > 0 && (
          <Card className="border-2 rounded-[2.5rem] shadow-sm bg-white overflow-hidden">
            <CardHeader className="p-5 border-b bg-muted/5">
              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-primary" />
                <p className="font-black uppercase tracking-widest text-sm text-slate-900">Labor Cost Preview</p>
              </div>
            </CardHeader>
            <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {laborPreview.byStaff.map(({ member, totalHours, pay, shiftCount }) => {
                const warnings = staffWarnings.get(member.id) || [];
                return (
                  <div key={member.id} className={cn("p-4 rounded-2xl border-2 space-y-2", warnings.length > 0 ? "border-red-200 bg-red-50" : "border-slate-100 bg-slate-50")}>
                    <div className="flex items-center gap-2">
                      <Avatar className="w-7 h-7 rounded-xl border"><AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{member.name?.[0]}</AvatarFallback></Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase truncate">{member.name}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{shiftCount} shift{shiftCount !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">{totalHours.toFixed(1)}h scheduled</p>
                      {pay > 0 && <p className="font-black font-mono text-sm text-green-600">${pay.toFixed(2)}</p>}
                    </div>
                    {warnings.map((w, i) => (
                      <p key={i} className="text-[8px] font-bold text-red-600 uppercase flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" />{w}
                      </p>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Add/Edit Shift Dialog */}
      <Dialog open={isAddShiftOpen} onOpenChange={setIsAddShiftOpen}>
        <DialogContent className="sm:max-w-lg rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">
              {editingShift ? 'Edit Shift' : 'Add Shift'}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-5">
            {/* Staff */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Staff Member</Label>
              <Select value={shiftStaffId} onValueChange={setShiftStaffId}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue placeholder="Select staff..." /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  {(staff || []).map(s => (
                    <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px]">
                      <div className="flex items-center gap-2">
                        {s.name}
                        {!isStaffAvailable(s.id, shiftDate ? new Date(shiftDate) : new Date()) && (
                          <Badge className="bg-amber-100 text-amber-700 border-none text-[7px] font-black h-4 px-1">Unavail</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40" />
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Start Time</Label>
                <Select value={shiftStart} onValueChange={setShiftStart}>
                  <SelectTrigger className="h-12 rounded-2xl border-2 font-black text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-2 shadow-2xl max-h-64">
                    {TIME_OPTIONS.map(t => <SelectItem key={t.value} value={t.value} className="font-bold">{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">End Time</Label>
                <Select value={shiftEnd} onValueChange={setShiftEnd}>
                  <SelectTrigger className="h-12 rounded-2xl border-2 font-black text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-2 shadow-2xl max-h-64">
                    {TIME_OPTIONS.map(t => <SelectItem key={t.value} value={t.value} className="font-bold">{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Break */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Break Duration (minutes)</Label>
              <Select value={String(shiftBreak)} onValueChange={v => setShiftBreak(Number(v))}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  {[0, 15, 30, 45, 60].map(m => <SelectItem key={m} value={String(m)} className="font-bold">{m === 0 ? 'No Break' : `${m} minutes`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Hours preview */}
            {shiftStart && shiftEnd && (
              <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 flex justify-between items-center">
                <div>
                  <p className="text-[9px] font-black uppercase text-primary/60">Total Shift</p>
                  <p className="font-black text-xl font-mono text-primary">
                    {((timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) - shiftBreak) / 60).toFixed(1)}h
                  </p>
                </div>
                {shiftStaffId && (() => {
                  const m = (staff || []).find(s => s.id === shiftStaffId);
                  if (!m?.hourlyRate) return null;
                  const pay = ((timeToMinutes(shiftEnd) - timeToMinutes(shiftStart) - shiftBreak) / 60) * m.hourlyRate;
                  return (
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase text-primary/60">Est. Pay</p>
                      <p className="font-black text-xl font-mono text-green-600">${pay.toFixed(2)}</p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Notes (optional)</Label>
              <Textarea value={shiftNotes} onChange={e => setShiftNotes(e.target.value)} placeholder="Any special instructions..." className="rounded-2xl border-2 min-h-[60px]" />
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleSaveShift} disabled={isProcessing || !shiftStaffId || !shiftDate} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isProcessing ? <Loader className="animate-spin" /> : editingShift ? 'Update Shift' : 'Add to Schedule'}
            </Button>
            <Button variant="ghost" onClick={() => setIsAddShiftOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Suggestion Review Dialog */}
      <Dialog open={isAISuggestOpen} onOpenChange={setIsAISuggestOpen}>
        <DialogContent className="sm:max-w-2xl rounded-[3rem] border-4 shadow-3xl bg-background max-h-[90dvh] flex flex-col">
          <DialogHeader className="p-6 pb-0 text-left flex-shrink-0">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 flex items-center gap-3">
              <Sparkles className="w-6 h-6 text-primary" /> Smart Schedule Suggestion
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              Smart scheduler analyzed your appointments and staff availability. {aiSuggestions.length} shifts suggested for {format(weekStart, 'MMM d')} -- {format(weekEnd, 'MMM d')}. Review and apply as drafts.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-3">
              {aiSuggestions.map((shift, idx) => {
                const member = (staff || []).find(s => s.id === shift.staffId);
                const hours = (timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime) - (shift.breakMinutes || 0)) / 60;
                return (
                  <div key={idx} className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-white shadow-sm">
                    <Avatar className="w-10 h-10 rounded-xl border shrink-0">
                      <AvatarImage src={member?.avatarUrl} className="object-cover" />
                      <AvatarFallback className="text-[10px] font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-black uppercase text-[11px] text-slate-900">{member?.name || 'Unknown'}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                        {format(new Date(shift.date), 'EEE, MMM d')} -- {formatTime(shift.startTime)} to {formatTime(shift.endTime)}
                      </p>
                      {shift.notes && <p className="text-[9px] font-bold text-primary/70 italic mt-0.5">{shift.notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black font-mono text-sm text-primary">{hours.toFixed(1)}h</p>
                      {shift.estimatedPay && shift.estimatedPay > 0 && (
                        <p className="text-[9px] font-black font-mono text-green-600">${shift.estimatedPay.toFixed(2)}</p>
                      )}
                    </div>
                    <button onClick={() => setAiSuggestions(prev => prev.filter((_, i) => i !== idx))} className="text-destructive/40 hover:text-destructive transition-colors shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <DialogFooter className="p-6 pt-4 border-t flex flex-col gap-3 flex-shrink-0">
            <Button onClick={handleApplyAISuggestions} disabled={isProcessing || aiSuggestions.length === 0} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isProcessing ? <Loader className="animate-spin" /> : `Apply ${aiSuggestions.length} Shifts as Drafts`}
            </Button>
            <Button variant="ghost" onClick={() => { setIsAISuggestOpen(false); setAiSuggestions([]); }} className="font-bold uppercase text-[10px] tracking-widest">Discard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Confirmation */}
      <Dialog open={isPublishConfirmOpen} onOpenChange={setIsPublishConfirmOpen}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Publish Schedule</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              {draftCount} draft shift{draftCount !== 1 ? 's' : ''} will be published. All affected staff will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            {/* Warnings before publish */}
            {staffWarnings.size > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-2">
                <p className="text-[10px] font-black uppercase text-amber-700 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Publish Warnings</p>
                {Array.from(staffWarnings.entries()).map(([sId, msgs]) => {
                  const member = (staff || []).find(s => s.id === sId);
                  return msgs.map((msg, i) => (
                    <p key={`${sId}-${i}`} className="text-[9px] font-bold text-amber-700 uppercase">{member?.name}: {msg}</p>
                  ));
                })}
              </div>
            )}
            {coverageAlerts.length > 0 && (
              <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 space-y-2">
                <p className="text-[10px] font-black uppercase text-red-700 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" /> Coverage Gaps</p>
                {coverageAlerts.map(day => (
                  <p key={day.toISOString()} className="text-[9px] font-bold text-red-700 uppercase">{format(day, 'EEEE, MMM d')} has no coverage</p>
                ))}
              </div>
            )}
            <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 flex justify-between">
              <p className="text-[10px] font-black uppercase text-primary/60">Est. Labor Cost</p>
              <p className="font-black font-mono text-lg text-green-600">${laborPreview.total.toFixed(2)}</p>
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handlePublishAll} disabled={isProcessing} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-green-500/20 bg-green-600 hover:bg-green-700">
              {isProcessing ? <Loader className="animate-spin" /> : <><Send className="w-4 h-4 mr-2" />Publish & Notify Staff</>}
            </Button>
            <Button variant="ghost" onClick={() => setIsPublishConfirmOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Go Back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}