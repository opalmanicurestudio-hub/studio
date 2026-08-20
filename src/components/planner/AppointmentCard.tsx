'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FIX #1 (previous pass): the earlier version had
//   <profitStyles[profitTier].Icon className="..." />
// which is invalid JSX — you cannot use a member/index expression directly
// as a JSX tag. JSX tag names must be either a plain identifier (capitalized
// for components) or a simple dotted identifier chain (e.g. <Foo.Bar />),
// not an arbitrary expression with a bracket index in it. The fix: extract
// the icon component into a local variable first (capitalized, since it
// holds a component reference), then use that variable as the tag. Search
// "FIX #1:" to find that spot.
//
// FIX #2 (this pass): the runtime crash
//   ReferenceError: Cannot access '_' before initialization
// was caused by the `estimatedArrival` useMemo listing itself
// (`estimatedArrival`) inside its own dependency array — a temporal-dead-zone
// reference to a `const` before that `const`'s initializer has finished
// running. Removed the self-reference from the deps array. Search "FIX #2:"
// to find that spot.
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, safeNumber } from '@/lib/utils';
import { isAwaitingApproval, approvalChannel, holdReasonLabel, acceptConsequenceLabel, isDeadAppointment } from '@/lib/booking-approval';
import { type Appointment, type Client, type Service, Staff } from '@/lib/data';
import { appointmentReadiness } from '@/lib/appointment-requirements';
import { useInventory } from '@/context/InventoryContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
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
  onStartService,
  onPrintTicket,
  onApproveRequest,
  onDeclineRequest,
  onReportIssue,
  onResolveIssue,
  canDeclineDirectly,
  canResolveIssues,
  heightPx,
}: any) {
  const { staff, inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const { showProfitability } = useProfitabilityVisibility();
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [settledStatus, setSettledStatus] = useState<string | null>(null);

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
        setIsRunningOver(mins > (service?.duration ?? Infinity));
      };
      updateTimer();
      timer = setInterval(updateTimer, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment.status, appointment.actualStartTime, service?.duration]);

  const isBirthdayToday = useMemo(() => {
    if (!client?.birthday) return false;
    const birth = safeDate(client.birthday);
    const today = new Date();
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  }, [client?.birthday]);

  const profitTier: ProfitabilityTier | null = useMemo(() => {
    if (!showProfitability) return null;
    if (appointment.status === 'cancelled') return null;
    const assignedStaff = (staff || []).find((s: Staff) => s.id === appointment.staffId);
    const price = service?.price || 0;
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

  const profitStyles: Record<ProfitabilityTier, { edgeClass: string; badgeClass: string; Icon: any; label: string }> = {
    healthy: { edgeClass: '', badgeClass: '', Icon: TrendingUp, label: 'Healthy' },
    thin: { edgeClass: 'border-l-4 border-l-foreground/25', badgeClass: '', Icon: Minus, label: 'Thin' },
    negative: { edgeClass: 'border-l-4 border-l-destructive', badgeClass: '', Icon: TrendingDown, label: 'Below cost' },
  };

  // FIX #1: pull the icon component reference out into its own variable BEFORE
  // the JSX return, rather than indexing into profitStyles[...] inline
  // inside the tag position. `ProfitIcon` is a plain capitalized identifier,
  // which is valid as a JSX tag; `profitStyles[profitTier].Icon` used
  // directly as `<profitStyles[profitTier].Icon />` is not.
  const ProfitIcon = profitTier ? profitStyles[profitTier].Icon : null;

  const handleCopyCheckInLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (appointment.checkInToken) {
      navigator.clipboard.writeText(`${window.location.origin}/check-in/${appointment.checkInToken}`);
      toast({ title: "Link Copied" });
    }
  };

  const statusDisplay: Record<string, { text: string; className: string; bgClassName: string; dotColor: string }> = {
    confirmed: { text: 'Confirmed', className: 'border-border text-foreground bg-white', bgClassName: 'bg-white', dotColor: 'bg-foreground/40' },
    servicing: { text: 'Live', className: 'border-primary ring-2 sm:ring-4 ring-primary/10 text-primary bg-primary/[0.03]', bgClassName: 'bg-primary/5', dotColor: 'bg-primary' },
    completed: { text: 'Finished', className: 'border-border text-muted-foreground bg-muted/30', bgClassName: 'bg-muted/30', dotColor: 'bg-emerald-600' },
    cancelled: { text: 'Cancelled', className: 'border-border text-muted-foreground bg-muted/20 grayscale opacity-70', bgClassName: 'bg-muted/20', dotColor: 'bg-foreground/30' },
    deposit_pending: { text: 'Deposit Due', className: 'border-amber-600/40 text-amber-900 bg-amber-500/[0.05]', bgClassName: 'bg-amber-500/5', dotColor: 'bg-amber-600' },
    ready_for_checkout: { text: 'Checkout', className: 'border-emerald-600/40 text-emerald-900 bg-emerald-500/[0.05]', bgClassName: 'bg-emerald-500/5', dotColor: 'bg-emerald-600' },
    pending_payment: { text: 'Awaiting Payment', className: 'border-amber-600/40 text-amber-900 bg-amber-500/[0.05]', bgClassName: 'bg-amber-500/5', dotColor: 'bg-amber-600' },
    declined: { text: 'Declined', className: 'border-border text-muted-foreground bg-muted/20 grayscale opacity-70', bgClassName: 'bg-muted/20', dotColor: 'bg-foreground/30' },
    requested: { text: 'Requested', className: 'border-dashed border-primary/50 text-foreground bg-primary/[0.03]', bgClassName: 'bg-primary/5', dotColor: 'bg-primary/60' },
  };

  useEffect(() => {
    if (settledStatus && appointment.status === settledStatus) setSettledStatus(null);
  }, [appointment.status, settledStatus]);

  const settled = !!settledStatus;
  const awaitingDecision = !settled && isAwaitingApproval(appointment);
  const decisionChannel = approvalChannel(appointment);
  const canDecide = awaitingDecision
    && typeof onApproveRequest === 'function'
    && typeof onDeclineRequest === 'function';
  /* Someone who may not decline is not told "no" — they are given the path
   * that actually solves it. The server enforces the same rule; this only
   * decides which word appears on the button. */
  const declinesDirectly = canDeclineDirectly !== false;
  const canReport = typeof onReportIssue === 'function';
  const openIssue = appointment.issue && appointment.issue.status === 'open' ? appointment.issue : null;
  const canResolve = !!openIssue && canResolveIssues === true && typeof onResolveIssue === 'function';
  const holdReason = awaitingDecision ? holdReasonLabel(appointment) : null;
  const acceptConsequence = awaitingDecision ? acceptConsequenceLabel(appointment, client) : null;

  const effectiveStatus = settledStatus || appointment.status;
  const cardStatus = isDeadAppointment({ ...appointment, status: effectiveStatus }) && effectiveStatus !== 'declined'
    ? 'cancelled'
    : awaitingDecision
      ? 'requested'
      : effectiveStatus;
  const currentStatus = statusDisplay[cardStatus];

  // FIX #2: removed the self-reference to `estimatedArrival` from this memo's
  // own dependency array. The previous array was:
  //   [appointment.checkInStatus, appointment.lateTimeMinutes, appointment.status, estimatedArrival]
  // `estimatedArrival` cannot be read inside the array that determines its own
  // value — at the moment this array is evaluated, the `const estimatedArrival`
  // binding exists (hoisted) but is still in the temporal dead zone, since its
  // initializer (this very useMemo call) hasn't returned yet. Referencing it
  // here throws "Cannot access 'estimatedArrival' before initialization",
  // which is exactly what the minified stack trace ("Cannot access '_' before
  // initialization") was reporting.
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

  const CHIP_TONES: Record<string, string> = {
    alert: 'bg-destructive text-white',
    live: 'bg-primary text-white',
    good: 'bg-emerald-600 text-white',
    info: 'bg-foreground/[0.08] text-foreground',
  };

  const totalPadding = (service?.padBefore || 0) + (service?.padAfter || 0);
  /* ── A CARD MUST RENDER EVEN WHEN ITS SERVICE IS GONE ──────────────────
   * `service` is looked up by id from the current service list, so it comes
   * back undefined for any appointment whose service was renamed, deleted, or
   * written by a path that did not stamp a matching serviceId. Every
   * dereference below then threw DURING RENDER — and a card that throws takes
   * the timeline with it, which is felt as taps doing nothing at all.
   *
   * The appointment itself always carries enough to draw a card. Falling back
   * to its own duration keeps the row honest instead of blank. */
  const safeDuration = Number(service?.duration ?? appointment.durationMinutes ?? 60) || 60;
  const totalDuration = safeDuration + totalPadding;

  const isMember = !!(client?.activeMembershipId || client?.subscription);
  const hasPackage = (client?.activePackages?.length || 0) > 0;

  const chips = useMemo(() => {
    const out: Array<{ key: string; tone: string; Icon: any; label: string }> = [];
    const push = (key: string, tone: string, Icon: any, label: string) => out.push({ key, tone, Icon, label });

    if (appointment.isEscalated) push('esc', 'alert', ShieldAlert, 'Manager');
    if (appointment.issue && appointment.issue.status === 'open') push('issue', 'alert', AlertTriangle, 'Issue');
    if (appointment.status !== 'servicing' && appointment.status !== 'completed') {
      if (appointment.checkInStatus === 'running_late') push('late', 'alert', Clock, `+${appointment.lateTimeMinutes}m`);
      if (appointment.checkInStatus === 'arrived') push('here', 'good', MapPin, 'Here');
      if (appointment.checkInStatus === 'on_my_way') push('otw', 'info', Car, 'En route');
    }
    if (setupPending) push('prep', 'alert', AlertTriangle, 'Prep');
    if (profitTier === 'negative') push('cost', 'alert', TrendingDown, 'Below cost');
    if (appointment.status === 'servicing') push('live', 'live', Sparkles, 'Live');
    if (awaitingReview) push('rev', 'info', FileImage, 'Review');
    if (hasDeferredFee) push('fee', 'info', Scale, 'Fee');
    if (isMember) push('mem', 'info', Award, 'Member');
    if (hasPackage) push('pkg', 'info', Repeat, 'Package');
    if (hasInspiration) push('ref', 'info', FileImage, 'Photo');
    if (appointment.isSecondary) push('part', 'info', Sparkles, 'Part');
    if (appointment.isWalkIn) push('walk', 'info', Users, 'Walk-in');
    if (isBirthdayToday) push('bday', 'info', Cake, 'Birthday');
    return out;
  }, [appointment, setupPending, profitTier, awaitingReview, hasDeferredFee, isMember, hasPackage, hasInspiration, isBirthdayToday]);


  const involvedStaff = useMemo(() => {
    const ids = new Set<string>();
    if (appointment.staffId) ids.add(appointment.staffId);
    const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
    Object.values(overrides).forEach((sid: any) => { if (sid && typeof sid === 'string') ids.add(sid); });
    return staff.filter((s: Staff) => ids.has(s.id));
  }, [appointment, staff]);

  const measuredHeight = Number(heightPx);
  const tier = !Number.isFinite(measuredHeight) || measuredHeight >= 104
    ? 'full'
    : measuredHeight < 56
      ? 'compact'
      : 'medium';

  const chipCap = tier === 'full' ? 3 : 2;

  const openDetails = () => onViewDetails(appointment);

  const runDecision = async (kind: 'approve' | 'decline') => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    try {
      const res = kind === 'approve'
        ? await onApproveRequest(appointment)
        : await onDeclineRequest(appointment);
      if (res && res.ok) {
        setSettledStatus(res.nextStatus || (kind === 'approve' ? 'confirmed' : 'declined'));
      } else if (res && res.alreadyStatus) {
        setSettledStatus(String(res.alreadyStatus));
      }
    } finally {
      setDecisionBusy(false);
      setConfirmingDecline(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full group">
      {(service?.padBefore ?? 0) > 0 && <div style={{ height: `${((service?.padBefore ?? 0) / totalDuration) * 100}%` }} className="bg-muted/10 rounded-t-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
      <div style={{ height: `${(safeDuration / totalDuration) * 100}%` }} className="flex-1 min-h-0 overflow-hidden">
        <Card 
          className={cn(
            'p-1.5 sm:p-2.5 border-2 w-full h-full flex flex-col transition-all duration-300 hover:shadow-2xl relative rounded-xl overflow-hidden', 
            currentStatus?.className,
            (isRunningOver || appointment.isEscalated) && 'border-destructive ring-2 sm:ring-4 ring-destructive/20 animate-pulse bg-destructive/10',
            awaitingDecision && 'bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(22,23,26,0.06)_5px,rgba(22,23,26,0.06)_7px)]',
            profitTier && profitStyles[profitTier].edgeClass
          )}
          role="button"
          tabIndex={0}
          aria-label={`Open details for ${client.name}`}
          onClick={openDetails}
          onKeyDown={(e: any) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(); }
          }}
        >
          <div className="flex items-start justify-between gap-1.5 sm:gap-2 min-w-0">
            <div className="min-w-0 flex-1 text-left">
                <div className={cn(
                    "items-center gap-1 mb-0.5 sm:mb-1",
                    tier === 'compact' ? "hidden" : "flex flex-nowrap overflow-hidden",
                )}>
                    {chips.slice(0, chipCap).map(chip => {
                      const ChipIcon = chip.Icon;
                      return (
                        <span
                          key={chip.key}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 h-4 text-[8px] font-black uppercase tracking-widest",
                            CHIP_TONES[chip.tone] || CHIP_TONES.info,
                            chip.key === 'live' && 'animate-pulse',
                          )}
                        >
                          <ChipIcon className="w-2 h-2 shrink-0" aria-hidden="true" />
                          {chip.label}
                        </span>
                      );
                    })}
                    {chips.length > chipCap && (
                      <span className="inline-flex shrink-0 items-center rounded-md px-1 h-4 text-[8px] font-black uppercase tracking-widest bg-foreground/[0.08] text-foreground/70">
                        +{chips.length - chipCap}
                      </span>
                    )}
                </div>
                <p className="font-black uppercase tracking-tight text-[10px] sm:text-[11px] text-foreground truncate leading-none mb-0.5 sm:mb-1">{client.name}</p>
                {tier !== 'compact' && (
                  <p className="text-[8px] sm:text-[9px] font-bold text-muted-foreground uppercase tracking-widest truncate opacity-60">{service?.name || appointment.serviceName || 'Service'}</p>
                )}
                {holdReason && tier === 'full' && (
                  <p className="text-[8px] font-bold text-foreground/70 uppercase tracking-widest truncate">{holdReason}</p>
                )}
                {openIssue && tier !== 'compact' && (
                  <p className="text-[8px] font-bold text-destructive uppercase tracking-widest truncate">{openIssue.label}</p>
                )}
                {acceptConsequence && tier === 'full' && (
                  <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest truncate">{acceptConsequence}</p>
                )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
                <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Appointment actions"
                    aria-label={`Actions for ${client.name}`}
                    className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-white/70 border shadow-sm hover:bg-white active:scale-95"
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1 min-w-[11rem]">
                    {canResolve && (
                      <>
                        <DropdownMenuItem onSelect={() => { onResolveIssue(appointment); }} className="font-bold text-[10px] uppercase tracking-widest text-destructive"><AlertTriangle className="mr-2 h-3.5 w-3.5" /> Resolve Issue</DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {canDecide && (
                      <>
                        <DropdownMenuItem disabled={decisionBusy} onSelect={() => { void runDecision('approve'); }} className="font-bold text-[10px] uppercase tracking-widest text-emerald-700"><CheckCircle className="mr-2 h-3.5 w-3.5" /> Accept Request</DropdownMenuItem>
                        {declinesDirectly
                          ? <DropdownMenuItem disabled={decisionBusy} onSelect={() => { setConfirmingDecline(true); }} className="font-bold text-[10px] uppercase tracking-widest text-destructive"><ShieldAlert className="mr-2 h-3.5 w-3.5" /> Decline Request</DropdownMenuItem>
                          : canReport
                            ? <DropdownMenuItem disabled={decisionBusy} onSelect={() => { onReportIssue(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><AlertTriangle className="mr-2 h-3.5 w-3.5" /> Report an Issue</DropdownMenuItem>
                            : null}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => { openDetails(); }} className="font-bold text-[10px] uppercase tracking-widest"><FileText className="mr-2 h-3.5 w-3.5" /> View Details</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { onEdit(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><Calendar className="mr-2 h-3.5 w-3.5" /> Edit</DropdownMenuItem>
                    {typeof onPrintTicket === 'function' && (
                      <DropdownMenuItem onSelect={() => { onPrintTicket(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><FileText className="mr-2 h-3.5 w-3.5" /> Print Ticket</DropdownMenuItem>
                    )}
                    {typeof onStartService === 'function' && appointment.status !== 'servicing' && appointment.status !== 'ready_for_checkout' && (
                      <DropdownMenuItem onSelect={() => { onStartService(appointment); }} className="font-bold text-[10px] uppercase tracking-widest text-primary"><Clock className="mr-2 h-3.5 w-3.5" /> Start Session</DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {appointment.status === 'servicing' && <DropdownMenuItem onSelect={() => { onFinishService(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><Square className="mr-2 h-3.5 w-3.5" /> End Session</DropdownMenuItem>}
                    {appointment.status === 'ready_for_checkout' && <DropdownMenuItem onSelect={() => { onCompleteClick(appointment); }} className="font-bold text-[10px] uppercase tracking-widest text-primary"><CheckCircle className="mr-2 h-3.5 w-3.5" /> Open Checkout</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => { onReschedule(appointment); }} className="font-bold text-[10px] uppercase tracking-widest"><Undo2 className="mr-2 h-3.5 w-3.5" /> Reschedule</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { handleCopyCheckInLink({ stopPropagation: () => {} } as any); }} className="font-bold text-[10px] uppercase tracking-widest"><LinkIcon className="mr-2 h-3.5 w-3.5" /> Copy Link</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => { onDelete(appointment.id); }} className="text-destructive font-bold text-[10px] uppercase tracking-widest"><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
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
                                            <AvatarFallback className="text-[8px] sm:text-[8px] font-black">{(s.name || 'S')[0]}</AvatarFallback>
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

          {appointment.status === 'servicing' && elapsedTime && tier === 'full' && (
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
            {canResolve && !canDecide && tier !== 'compact' && (
                <Button size="xs" aria-label={`Resolve the issue on ${client.name}'s booking`} className="h-6 px-2 bg-destructive text-white border-none font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); onResolveIssue(appointment); }}>Resolve</Button>
            )}
            {canDecide && tier !== 'compact' && !confirmingDecline && (
                <div className="flex items-center gap-1">
                    <Button size="xs" disabled={decisionBusy} aria-label={`Accept the request from ${client.name}`} className="h-6 px-2 bg-emerald-600 text-white border-none font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); runDecision('approve'); }}>Accept</Button>
                    {declinesDirectly
                      ? <Button size="xs" variant="outline" disabled={decisionBusy} aria-label={`Decline the request from ${client.name}`} className="h-6 px-2 border-2 font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); setConfirmingDecline(true); }}>Decline</Button>
                      : canReport
                        ? <Button size="xs" variant="outline" disabled={decisionBusy} aria-label={`Report an issue with ${client.name}'s booking`} className="h-6 px-2 border-2 font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); onReportIssue(appointment); }}>Report</Button>
                        : null}
                </div>
            )}
            {canDecide && confirmingDecline && (
                <div className="flex items-center gap-1">
                    <span className="text-[8px] font-black uppercase tracking-widest text-destructive">{decisionChannel === 'request' ? 'Tell them no?' : 'Release it?'}</span>
                    <Button size="xs" disabled={decisionBusy} aria-label={`Confirm declining ${client.name}`} className="h-6 px-2 bg-destructive text-white border-none font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); runDecision('decline'); }}>Yes</Button>
                    <Button size="xs" variant="outline" aria-label="Keep the request" className="h-6 px-2 border-2 font-black text-[8px] uppercase tracking-widest rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); setConfirmingDecline(false); }}>Keep</Button>
                </div>
            )}
            {appointment.status === 'ready_for_checkout' && (
                <Button size="xs" aria-label={`Take payment for ${client.name}`} className="h-6 px-2.5 bg-primary text-white border-none font-black text-[8px] uppercase tracking-widest shadow-sm rounded-lg active:scale-95" onClick={e => { e.stopPropagation(); onCompleteClick(appointment); }}>PAY</Button>
            )}
          </div>
        </Card>
      </div>
      {(service?.padAfter ?? 0) > 0 && <div style={{ height: `${((service?.padAfter ?? 0) / totalDuration) * 100}%` }} className="bg-muted/10 rounded-b-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
    </div>
  );
}
