'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MODIFIED from your original AppointmentCard.tsx. Search for "PROFIT:" to
// find every change — five total, each small and isolated:
//
//   1. Three new imports (computeServiceProfitability/classifyProfitability
//      from the shared lib, and useProfitabilityVisibility hook)
//   2. Pull `inventory` and `tmhr` from useInventory()/useTenant() — the
//      same pattern this file already uses to pull `staff`
//   3. A `profitTier` useMemo computing the signal, gated on the toggle
//      being on AND the appointment having reached a state where checkout
//      data (or at least price) is meaningful
//   4. A left-edge accent color applied to the existing Card className,
//      conditional on profitTier — same cn() pattern already used for the
//      destructive/running-over state
//   5. One new badge in the existing badge row, following the exact same
//      Badge + Tooltip pattern as MEM/PKG/FEE — not a new visual language
//
// Everything else — every prop, every existing badge, the elapsed-time
// timer, the dropdown menu, the padding blocks — is untouched, same as
// your original file.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds, addMinutes } from 'date-fns';
import {
  Award,
  MoreHorizontal,
  Clock,
  Trash2,
  CheckCircle,
  FileText,
  Calendar,
  Users,
  Cake,
  Link as LinkIcon,
  MapPin,
  Car,
  Square,
  Sparkles,
  Repeat,
  AlertTriangle,
  Undo2,
  Scale,
  FileImage,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, safeNumber } from '@/lib/utils';
import { type Appointment, type Client, type Service, Staff } from '@/lib/data';
import { appointmentReadiness } from '@/lib/appointment-requirements';
import { useInventory } from '@/context/InventoryContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
// PROFIT: shared cost utility + visibility toggle, both built as standalone pieces
import { computeServiceProfitability, classifyProfitability, type ProfitabilityTier } from '@/lib/service-cost';
import { useProfitabilityVisibility } from '@/hooks/useProfitabilityVisibility';
import { useTenant } from '@/context/TenantContext';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

export function AppointmentCard({
  appointment,
  client,
  service,
  style,
  onUpdateStatus,
  onDelete,
  onCompleteClick,
  onEdit,
  onReschedule,
  onViewDetails,
  onFinishService,
}: any) {
  // PROFIT: `inventory` pulled alongside the existing `staff` destructure —
  // same source, same pattern, no new subscription. `tmhr` comes from
  // useTenant(), already used elsewhere in your codebase (POSPage,
  // PlannerPageContent) via `selectedTenant?.tmhr || 50`.
  const { staff, inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const { showProfitability } = useProfitabilityVisibility();
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      const updateTimer = () => {
        const now = new Date();
        const diff = differenceInSeconds(now, startTime);
        const mins = Math.floor(diff / 60);
        const hours = Math.floor(mins / 60);
        const displayMins = mins % 60;
        const displaySecs = diff % 60;
        setElapsedTime(hours > 0 ? `${hours}:${String(displayMins).padStart(2, '0')}:${String(displaySecs).padStart(2, '0')}` : `${displayMins}:${String(displaySecs).padStart(2, '0')}`);
        setIsRunningOver(mins > service.duration);
      };
      updateTimer();
      timer = setInterval(updateTimer, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment.status, appointment.actualStartTime, service.duration]);

  const isBirthdayToday = useMemo(() => {
    if (!client?.birthday) return false;
    const birth = safeDate(client.birthday);
    const today = new Date();
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  }, [client?.birthday]);

  // PROFIT: the signal itself. Computed for any non-cancelled appointment
  // with a resolvable staff member — not gated to a specific status, since
  // an owner may want to see projected margin on a confirmed-but-not-yet-
  // serviced appointment, not just completed ones. Returns null (no badge
  // rendered) if the toggle is off, the appointment is cancelled, or price
  // is 0 (comped/redeemed — marginPct is undefined in that case, not a
  // misleading number).
  const profitTier: ProfitabilityTier | null = useMemo(() => {
    if (!showProfitability) return null;
    if (appointment.status === 'cancelled') return null;
    const assignedStaff = (staff || []).find((s: Staff) => s.id === appointment.staffId);
    const price = service.price || 0;
    if (price <= 0) return null;
    const result = computeServiceProfitability(
      service,
      appointment,
      assignedStaff,
      inventory || [],
      selectedTenant?.tmhr || 50,
      price
    );
    return classifyProfitability(result.marginPct);
  }, [showProfitability, appointment, service, staff, inventory, selectedTenant?.tmhr]);

  // PROFIT: maps tier to the left-edge accent + badge styling. Kept as a
  // small local lookup rather than baked into the lib, since the visual
  // treatment (which CSS classes) is a UI concern, not a business-math one.
  const profitStyles: Record<ProfitabilityTier, { edgeClass: string; badgeClass: string; Icon: any; label: string }> = {
    healthy: { edgeClass: 'border-l-4 border-l-green-500', badgeClass: 'bg-green-600', Icon: TrendingUp, label: 'Healthy' },
    thin: { edgeClass: 'border-l-4 border-l-amber-500', badgeClass: 'bg-amber-600', Icon: Minus, label: 'Thin' },
    negative: { edgeClass: 'border-l-4 border-l-red-500', badgeClass: 'bg-red-600', Icon: TrendingDown, label: 'Below cost' },
  };

  const handleCopyCheckInLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (appointment.checkInToken) {
      navigator.clipboard.writeText(`${window.location.origin}/check-in/${appointment.checkInToken}`);
      toast({ title: "Link Copied" });
    }
  };

  const statusDisplay: Record<string, { text: string; className: string; bgClassName: string; dotColor: string }> = {
    confirmed: { text: 'Confirmed', className: 'border-blue-500/20 text-blue-800 bg-blue-500/[0.03]', bgClassName: 'bg-blue-500/5', dotColor: 'bg-blue-500' },
    servicing: { text: 'Live', className: 'border-primary ring-2 sm:ring-4 ring-primary/10 text-primary bg-primary/[0.02]', bgClassName: 'bg-primary/5', dotColor: 'bg-primary' },
    completed: { text: 'Finished', className: 'border-green-500/20 text-green-800 bg-green-500/[0.03]', bgClassName: 'bg-green-500/5', dotColor: 'bg-green-500' },
    cancelled: { text: 'Cancelled', className: 'border-red-500/20 text-red-800 bg-red-500/[0.03] grayscale', bgClassName: 'bg-red-500/5', dotColor: 'bg-red-500' },
    deposit_pending: { text: 'Deposit Due', className: 'border-amber-500/20 text-amber-800 bg-amber-500/[0.03]', bgClassName: 'bg-amber-500/5', dotColor: 'bg-amber-500' },
    ready_for_checkout: { text: 'Checkout', className: 'border-orange-500/20 text-orange-800 bg-orange-500/[0.03] shadow-lg', bgClassName: 'bg-orange-500/5', dotColor: 'bg-orange-500' },
  };

  const cardStatus = appointment.checkInStatus === 'auto_cancelled' ? 'cancelled' : appointment.status;
  const currentStatus = statusDisplay[cardStatus];

  const estimatedArrival = useMemo(() => {
      if (appointment.checkInStatus === 'running_late' && appointment.lateTimeMinutes) {
          return format(addMinutes(safeDate(appointment.startTime), appointment.lateTimeMinutes), 'h:mm a');
      }
      return null;
  }, [appointment.checkInStatus, appointment.lateTimeMinutes, appointment.startTime]);

  const hasDeferredFee = safeNumber(appointment.checkoutState?.additionalCharge) > 0;
  const reqFiles = appointment.requirementFiles || [];
  const hasInspiration = !!appointment.inspirationPhotoUrl || reqFiles.some((rf: any) => (rf.files || []).length > 0);
  const reqReadiness = appointment.requirements ? appointmentReadiness(appointment.requirements) : null;
  const setupPending = appointment.completionStatus === 'pending' || (reqReadiness ? reqReadiness.confirmationBlocking > 0 : false);
  const awaitingReview = (reqReadiness?.awaitingReview || 0) > 0;

  const checkInIndicator = useMemo(() => {
    if (appointment.status === 'servicing' || appointment.status === 'completed') return null;
    switch (appointment.checkInStatus) {
        case 'arrived': return <Badge className="bg-green-500 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm"><MapPin className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />HERE</Badge>;
        case 'running_late': return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge className="bg-amber-500 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm animate-pulse cursor-help">
                            <Clock className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />+{appointment.lateTimeMinutes}M
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                        Est. Arrival: {estimatedArrival}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
        case 'on_my_way': return <Badge className="bg-blue-500 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm"><Car className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />EN ROUTE</Badge>;
        default: return null;
    }
  }, [appointment.checkInStatus, appointment.lateTimeMinutes, appointment.status, estimatedArrival]);

  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  const totalDuration = service.duration + totalPadding;

  const isMember = !!(client?.activeMembershipId || client?.subscription);
  const hasPackage = (client?.activePackages?.length || 0) > 0;

  const involvedStaff = useMemo(() => {
    const ids = new Set<string>();
    if (appointment.staffId) ids.add(appointment.staffId);
    const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
    Object.values(overrides).forEach((sid: any) => { if (sid && typeof sid === 'string') ids.add(sid); });
    return staff.filter((s: Staff) => ids.has(s.id));
  }, [appointment, staff]);

  return (
    <div className="flex flex-col h-full w-full group">
      {service.padBefore > 0 && <div style={{ height: `${(service.padBefore / totalDuration) * 100}%` }} className="bg-muted/10 rounded-t-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
      <div style={{ height: `${(service.duration / totalDuration) * 100}%` }} className="min-h-fit flex-1">
        <Card 
          className={cn(
            'p-1.5 sm:p-2.5 border-2 w-full h-full flex flex-col transition-all duration-300 hover:shadow-2xl relative rounded-xl overflow-hidden', 
            currentStatus?.className,
            (isRunningOver || appointment.isEscalated) && 'border-destructive ring-2 sm:ring-4 ring-destructive/20 animate-pulse bg-destructive/10',
            // PROFIT: left-edge accent, applied last so it isn't clobbered by
            // the status border classes above (border-l-* targets a single
            // side, status classes set the full border — no conflict).
            profitTier && profitStyles[profitTier].edgeClass
          )}
          onClick={() => onViewDetails(appointment)}
        >
          <div className="flex items-start justify-between gap-1.5 sm:gap-2 min-w-0">
            <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1 flex-wrap">
                    {appointment.isEscalated && (
                        <Badge variant="destructive" className="animate-pulse h-3.5 sm:h-4 px-1.5 text-[7px] sm:text-[8px] font-black uppercase border-none shadow-lg">
                            <ShieldAlert className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" /> MANAGER REQ
                        </Badge>
                    )}
                    {isBirthdayToday && <Cake className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-pink-500 animate-bounce shrink-0" />}
                    {checkInIndicator}
                    {appointment.status === 'servicing' && <Badge className="bg-primary text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 animate-pulse">LIVE</Badge>}
                    {isMember && <Badge className="bg-indigo-600 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm"><Award className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />MEM</Badge>}
                    {hasPackage && <Badge className="bg-teal-600 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm"><Repeat className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />PKG</Badge>}
                    {hasDeferredFee && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge className="bg-amber-600 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm">
                                        <Scale className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />FEE
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Deferred Protocol Fee Attached</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {hasInspiration && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge className="bg-primary text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm">
                                        <FileImage className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />REF
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Inspiration Photo Attached</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {setupPending && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge className="bg-amber-500 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm">
                                        <AlertTriangle className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />PREP
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Client setup incomplete — deposit, card, forms or photos outstanding</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {awaitingReview && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge className="bg-violet-600 text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm">
                                        <FileImage className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />REVIEW
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Photos / files submitted — awaiting your review</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {appointment.isSecondary && <Badge className="bg-primary/10 text-primary border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1"><Sparkles className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />PART</Badge>}
                    {appointment.isWalkIn && <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-muted-foreground opacity-40" />}
                    {/* PROFIT: follows the exact same Badge + Tooltip shape as MEM/PKG/FEE above */}
                    {profitTier && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge className={cn("text-white border-none text-[7px] sm:text-[8px] font-black uppercase h-3.5 sm:h-4 px-1 shadow-sm", profitStyles[profitTier].badgeClass)}>
                                        <profitStyles[profitTier].Icon className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />
                                        {profitStyles[profitTier].label}
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                                    {profitTier === 'negative' ? 'Estimated cost exceeds price' : profitTier === 'thin' ? 'Margin below target threshold' : 'Margin within healthy range'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
                <p className="font-black uppercase tracking-tight text-[10px] sm:text-[11px] text-slate-900 truncate leading-none mb-0.5 sm:mb-1">{client.name}</p>
                <p className="text-[8px] sm:text-[9px] font-bold text-muted-foreground uppercase tracking-widest truncate opacity-60">{service.name}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
                <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}><MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                    {appointment.status === 'servicing' && <DropdownMenuItem onClick={() => onFinishService(appointment)} className="font-bold text-[10px] uppercase tracking-widest"><Square className="mr-2 h-3.5 w-3.5" /> End Session</DropdownMenuItem>}
                    {appointment.status === 'ready_for_checkout' && <DropdownMenuItem onClick={() => onCompleteClick(appointment)} className="font-bold text-[10px] uppercase tracking-widest text-primary"><CheckCircle className="mr-2 h-3.5 w-3.5" /> Open Checkout</DropdownMenuItem>}
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReschedule(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><Undo2 className="mr-2 h-3.5 w-3.5" /> Reschedule</DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCopyCheckInLink} className="font-bold text-[10px] uppercase tracking-widest"><LinkIcon className="mr-2 h-3.5 w-3.5" /> Copy Link</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(appointment.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest"><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
                </DropdownMenu>
                
                {involvedStaff.length > 1 && (
                    <div className="flex -space-x-3 overflow-hidden">
                        {involvedStaff.map(s => (
                            <TooltipProvider key={s.id}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Avatar className="h-4 w-4 sm:h-5 sm:w-5 border-2 border-background shadow-sm">
                                            <AvatarImage src={s.avatarUrl} className="object-cover" />
                                            <AvatarFallback className="text-[6px] sm:text-[7px] font-black">{(s.name || 'S')[0]}</AvatarFallback>
                                        </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[8px] tracking-widest">{s.name}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ))}
                    </div>
                )}
            </div>
          </div>

          {appointment.status === 'servicing' && elapsedTime && (
            <div className="flex-1 flex items-center justify-center py-0.5 sm:py-1">
                <p className={cn("text-lg sm:text-2xl font-black font-mono tracking-tighter leading-none", isRunningOver ? "text-destructive" : "text-primary")}>{elapsedTime}</p>
            </div>
          )}

          <div className="mt-auto pt-1 sm:pt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-1.5">
                <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", currentStatus?.dotColor)} />
                <p className="text-[8px] sm:text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 text-left">
                    {appointment.checkInStatus === 'running_late' && estimatedArrival 
                        ? `EST: ${estimatedArrival}` 
                        : format(safeDate(appointment.startTime), 'h:mm a')
                    }
                </p>
            </div>
            {appointment.status === 'ready_for_checkout' && (
                <Button size="xs" className="h-4 sm:h-5 px-1.5 sm:px-2 bg-primary text-white border-none font-black text-[7px] sm:text-[8px] uppercase tracking-widest shadow-lg shadow-primary/20 rounded-lg animate-bounce" onClick={e => { e.stopPropagation(); onCompleteClick(appointment); }}>PAY</Button>
            )}
          </div>
        </Card>
      </div>
      {service.padAfter > 0 && <div style={{ height: `${(service.padAfter / totalDuration) * 100}%` }} className="bg-muted/10 rounded-b-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
    </div>
  );
}
