'use client';
// src/components/visit/AddOnSheet.tsx — ADD AN ADD-ON DURING A VISIT, from the staff portal or the planner's visit.
// Pick a compatible add-on; do it yourself or give it to someone free; at the same time or after; with a warning when it
// would push your (or their) next client. Moved here from the staff portal so both use the same one.
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, doc, getDocs, writeBatch, arrayUnion } from 'firebase/firestore';
import { format, differenceInMinutes, addMinutes } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, CheckCircle2, ChevronRight, Loader, PlusCircle, User, Workflow, Zap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { biz, bizKey } from '@/lib/biz-clock';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

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
  const today = bizKey(now);

  // 1. Check shift
  const shift = allShifts.find((s: any) => s.staffId === tech.id && s.date === today && s.status !== 'cancelled' && s.status !== 'draft');
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
export function MidServiceAddOnSheet({ apt, service, allServices, allStaff, allShifts, tenantId, firestore, currentStaffId, onClose }: any) {
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

      // The planner draws the card from endTime — move it too, or the card doesn't grow and the slot looks free.
      const startMs = Date.parse(String(apt.startTime || ''));
      const endPatch = Number.isFinite(startMs) && !isConcurrent ? { endTime: new Date(startMs + newDuration * 60000).toISOString() } : {};
      batch.update(aptRef, {
        duration: newDuration,
        originalDuration,
        ...endPatch,
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
        <p className="text-[12px] font-semibold text-muted-foreground opacity-40">No compatible add-ons available</p>
        <button onClick={onClose} className="text-[12px] font-semibold text-primary">Close</button>
      </div>
    );
  }

  // ── Conflict warning overlay ──
  if (showConflictWarning) {
    const conflict = selfConflict || techConflict;
    const isSelfConflict = !!selfConflict;
    return (
      <div className="p-4 space-y-4">
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="font-semibold text-[11px] tracking-wide">Schedule Conflict</p>
          </div>
          <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
            Adding <span className="font-semibold">{selectedAddOn?.name}</span> ({selectedAddOn?.duration}m) will run{' '}
            <span className="font-semibold text-amber-900">{conflict?.overlapMins} min</span> into{' '}
            {isSelfConflict ? 'your' : 'their'} next appointment
            {conflict?.nextApt?.clientName ? ` with ${conflict.nextApt.clientName}` : ''} at{' '}
            {conflict?.nextApt ? format(biz(safeDate(conflict.nextApt.startTime)), 'h:mm a') : ''}.
          </p>
          <p className="text-[12px] font-bold text-amber-700 opacity-70">
            Consider reassigning or adjusting the schedule.
          </p>
        </div>
        <button
          onClick={() => {
            if (isSelfConflict && currentStaffId) commitAddOn(currentStaffId, true);
            else if (assignedTechId) commitAddOn(assignedTechId, false);
          }}
          disabled={saving || (isSelfConflict ? !currentStaffId : !assignedTechId)}
          className="w-full h-12 rounded-2xl bg-amber-500 text-white font-semibold text-[11px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97] transition-all"
        >
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : 'Proceed Anyway'}
        </button>
        <button
          onClick={() => { setShowConflictWarning(false); setPendingSubmit(false); }}
          className="w-full h-10 rounded-2xl border border-[#ececee] font-semibold text-[12px] text-[#6d7075] active:scale-[0.97]"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">

      <p className="text-[12px] font-semibold text-muted-foreground opacity-60 px-1">Select Add-on</p>
      <div className="space-y-2 max-h-44 overflow-y-auto">
        {compatibleAddOns.map((addon: any) => (
          <button
            key={addon.id}
            onClick={() => { setSelectedAddOn(addon); setMode(null); setAssignedTechId(null); }}
            className={cn(
              'w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all active:scale-[0.98]',
              selectedAddOn?.id === addon.id ? 'border-primary bg-primary/5' : 'border-[#ececee] bg-white hover:border-primary/20',
            )}
          >
            <div>
              <p className="font-semibold text-[11px] text-[#16171a]">{addon.name}</p>
              <p className="text-[12px] font-bold text-muted-foreground opacity-60">{addon.duration}m · ${addon.price?.toFixed(2)}</p>
            </div>
            {selectedAddOn?.id === addon.id && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {selectedAddOn && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="space-y-3 pt-2 border-t border-dashed"
          >
            <button
              onClick={() => { setMode('self'); handleSelfAdd(); }}
              disabled={saving}
              className="w-full flex items-center justify-between p-4 rounded-2xl border border-primary bg-primary/5 active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  {saving && mode === 'self'
                    ? <Loader className="w-4 h-4 text-white animate-spin" />
                    : <User className="w-4 h-4 text-white" />
                  }
                </div>
                <div className="text-left">
                  <p className="font-semibold text-[11px] text-primary">Add to My Session</p>
                  <p className="text-[12px] font-bold text-muted-foreground opacity-60">
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

            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-muted-foreground opacity-50 px-1">
                Or Assign to Available Tech
              </p>
              {loadingAvailability ? (
                <div className="flex items-center justify-center py-6 gap-2">
                  <Loader className="w-4 h-4 animate-spin text-primary" />
                  <p className="text-[12px] font-semibold text-muted-foreground opacity-40">Checking availability...</p>
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
                            'w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all',
                            isSelected ? 'border-primary bg-primary/5' :
                            isAvailable ? 'border-[#ececee] bg-white hover:border-primary/20 active:scale-[0.98]' :
                            'border-[#ececee] bg-[#f5f5f7] opacity-40 cursor-not-allowed',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 rounded-xl border shrink-0">
                              <AvatarImage src={tech.avatarUrl} className="object-cover" />
                              <AvatarFallback className="text-[12px] font-semibold bg-primary/10 text-primary">
                                {(tech.name || 'T')[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 text-left">
                              <p className="font-semibold text-[12px] text-[#16171a] truncate">{tech.name?.split(' ')[0]}</p>
                              <p className={cn(
                                'text-[11px] font-bold',
                                av?.reason === 'idle' ? 'text-green-600' :
                                av?.reason === 'conflict' ? 'text-amber-500' :
                                'text-[#6d7075]',
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

            <AnimatePresence>
              {assignedTechId && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 pt-2 border-t border-dashed">
                  <p className="text-[12px] font-semibold text-muted-foreground opacity-50 px-1">Flow Type</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Sequential', value: false, icon: Workflow, desc: 'After current' },
                      { label: 'Concurrent', value: true,  icon: Zap,      desc: 'Same time'    },
                    ].map(opt => (
                      <button
                        key={opt.label}
                        onClick={() => setIsConcurrent(opt.value)}
                        className={cn(
                          'p-3 rounded-2xl border flex flex-col items-center gap-1 transition-all',
                          isConcurrent === opt.value ? 'border-primary bg-primary/5 text-primary' : 'border-[#ececee] bg-white text-[#6d7075]',
                        )}
                      >
                        <opt.icon className="w-4 h-4" />
                        <p className="font-semibold text-[12px]">{opt.label}</p>
                        <p className="font-bold text-[11px] opacity-60">{opt.desc}</p>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleAssignTech}
                    disabled={saving}
                    className="w-full h-14 rounded-2xl bg-primary text-white font-semibold text-[12px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
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
        className="w-full h-10 rounded-2xl border border-[#ececee] font-semibold text-[12px] text-[#6d7075] active:scale-[0.97]"
      >
        Cancel
      </button>
    </div>
  );
}

