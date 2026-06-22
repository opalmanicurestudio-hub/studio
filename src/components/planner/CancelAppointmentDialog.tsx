'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type Appointment,
  type Tenant,
  type Service,
  type Staff,
  type CancellationAudit,
  type AuditLogEntry,
  type StudioCancellationReason,
  type ClientCancellationReason,
} from '@/lib/data';
import {
  AlertTriangle,
  Ban,
  ArrowRight,
  DollarSign,
  ShieldCheck,
  Lock,
  Landmark,
  Zap,
  Loader,
  Clock,
  Scale,
  PackageOpen,
  Building2,
  UserCircle,
  UserX,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { resolveAppointmentCancellationFee, toCents2 } from '@/lib/opal/cancellation-policy';
import { differenceInHours, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase } from '@/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { nanoid } from 'nanoid';

// Who is performing the cancellation. Drives the audit trail's actorType.
type ActorType = 'studio' | 'client' | 'no_show';

const STUDIO_REASON_OPTIONS: { value: StudioCancellationReason; label: string }[] = [
  { value: 'late_arrival',           label: 'Late Arrival' },
  { value: 'staff_unavailable',      label: 'Staff Unavailable' },
  { value: 'double_booked',          label: 'Double Booked' },
  { value: 'client_request_relayed', label: 'Client Asked Us To' },
  { value: 'other',                  label: 'Other' },
];

const CLIENT_REASON_OPTIONS: { value: ClientCancellationReason; label: string }[] = [
  { value: 'schedule_conflict',   label: 'Schedule Conflict' },
  { value: 'changed_mind',        label: 'Changed Mind' },
  { value: 'found_alternative',   label: 'Found Alternative' },
  { value: 'price_concern',       label: 'Price Concern' },
  { value: 'health_or_childcare', label: 'Health / Childcare' },
  { value: 'other',               label: 'Other' },
];

function coarseReasonFor(
  actorType: ActorType,
  studioReason?: StudioCancellationReason,
  clientReason?: ClientCancellationReason,
): CancellationAudit['reason'] {
  if (actorType === 'no_show') return 'no-show';
  if (actorType === 'studio') {
    if (studioReason === 'late_arrival') return 'late';
    if (studioReason === 'client_request_relayed') return 'client_request';
    return 'other';
  }
  if (clientReason === 'other') return 'other';
  return 'client_request';
}

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  tenant: Tenant | null;
  currentStaff?: Staff | null;
  onConfirm: (data: {
    reason: string;
    chargeFee: boolean;
    feeAmount: number;
    paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
    cancellationAudit: CancellationAudit;
    auditLogEntry: Omit<AuditLogEntry, 'id' | 'tenantId'>;
    // Only meaningful when actorType === 'studio' and the appointment has a
    // paid deposit. Drives /api/stripe/studio-cancel-refund via
    // useCancellationConfirm. Omitted entirely for client/no-show cancels.
    depositDisposition?: 'refund' | 'store_credit';
    // Staff-added goodwill credit on top of the deposit conversion. Only
    // meaningful when depositDisposition === 'store_credit'.
    additionalCreditCents?: number;
  }) => Promise<void>;
}

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

export const CancelAppointmentDialog: React.FC<CancelAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointment,
  tenant,
  currentStaff,
  onConfirm,
}) => {
  const { services, clients, staff, inventory } = useInventory();
  const { firestore } = useFirebase();

  const [actorType, setActorType] = useState<ActorType>('studio');
  const [studioReason, setStudioReason] = useState<StudioCancellationReason>('client_request_relayed');
  const [clientReason, setClientReason] = useState<ClientCancellationReason>('schedule_conflict');
  const [customReason, setCustomReason] = useState('');

  const [chargeFee, setChargeFee] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'add_to_balance'>('card_on_file');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Fee — one number, not four separate mechanisms ──────────────────────
  // Previously: per-service House Floor / Labor Protection checkboxes, PLUS
  // a separate "Fixed Rate Override" toggle, PLUS a separate override input
  // — three independent ways to arrive at the same single dollar figure.
  // Now: one editable amount. It starts at the computed suggestion; editing
  // it IS the override, with no separate toggle to flip first. Whether it
  // was overridden is derived by comparing to the suggestion, not tracked
  // as its own state.
  const [feeValue, setFeeValue] = useState(0);
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const [depositDisposition, setDepositDisposition] = useState<'refund' | 'store_credit'>('refund');
  const [additionalCreditValue, setAdditionalCreditValue] = useState(0);

  // Live deposit lookup against depositCredits — NOT appointment.depositStatus
  // / depositAmountCents. Those appointment-level fields aren't populated by
  // the actual deposit-payment webhook in this codebase; depositCredits is
  // the single source of truth every cancellation path now agrees on
  // (studio-cancel-refund, handle-no-show-action, useCancellationConfirm,
  // self-cancel). Looked up fresh each time the dialog opens.
  const [depositCredit, setDepositCredit] = useState<any>(null);
  const [isLoadingDeposit, setIsLoadingDeposit] = useState(false);

  const client = useMemo(
    () => clients?.find(c => c.id === appointment.clientId),
    [clients, appointment.clientId],
  );
  const hasCardOnFile = !!client?.cardOnFile?.token;
  const hasDeposit = !!depositCredit;
  const depositDollars = depositCredit ? Number(depositCredit.amountDollars ?? (depositCredit.amountCents || 0) / 100) : 0;
  const tmhr = tenant?.tmhr || 50;
  const taxBurden = tenant?.employerTaxBurdenPct || 10;

  const sessionItems = useMemo(() => {
    const primarySvc = services.find(s => s.id === appointment.serviceId);
    const addOns = (appointment.addOnIds || [])
      .map(id => services.find(s => s.id === id))
      .filter(Boolean) as Service[];
    return [primarySvc, ...addOns].filter((s): s is Service => !!s);
  }, [appointment, services]);

  const recoveryMatrix = useMemo(() => {
    return sessionItems.map(s => {
      const duration = s.duration || 60;
      const houseOverhead = (duration / 60) * tmhr;
      const materialCost = (s.products || []).reduce((acc, p) => {
        const product = inventory.find(i => i.id === p.id);
        let cpu = 0;
        if (product) {
          if (product.costingMethod === 'size' && product.size)
            cpu = (product.costPerUnit || 0) / product.size;
          else if (product.costingMethod === 'uses' && product.estimatedUses)
            cpu = (product.costPerUnit || 0) / product.estimatedUses;
          else cpu = product.costPerUnit || 0;
        }
        return acc + cpu * (p.quantityUsed || 1);
      }, 0);

      const proId =
        appointment.checkoutState?.serviceStaffOverrides?.[s.id] || appointment.staffId;
      const pro = staff.find(sm => sm.id === proId);
      const price =
        s.serviceTiers?.find(t => t.tierId === pro?.pricingTierId)?.price || s.price;

      let labor = 0;
      if (pro?.payStructure === 'commission') labor = price * (pro.commissionRate / 100);
      else if (pro?.payStructure === 'hourly' && pro.hourlyRate)
        labor = (duration / 60) * pro.hourlyRate;
      const burdenedLabor = labor * (1 + taxBurden / 100);

      return {
        id: s.id,
        name: s.name,
        houseFloor: houseOverhead + materialCost,
        laborProtection: burdenedLabor,
        overrideFee: s.customCancellationFee || 0,
        window: s.cancellationWindowHours || tenant?.cancellationWindowHours || 24,
        feeMode: s.cancellationFeeMode || 'inherit',
        feeValue: s.cancellationFeeValue ?? s.customCancellationFee ?? 0,
        price,
      };
    });
  }, [sessionItems, tmhr, inventory, staff, appointment, taxBurden, tenant]);

  // ── Suggested fee inputs ──────────────────────────────────────────────────
  // Moved above the "reset state on open" effect below: that effect reads
  // suggestedFeeTotal, so the memo computing it (and the memo it depends on,
  // hoursUntilAppt) must be declared first. Declaring them after the effect
  // that consumes them throws "Cannot access 'suggestedFeeTotal' before
  // initialization" on every render — this was crashing the dialog (and, by
  // extension, anything that mounts it alongside the appointment details
  // sheet) outright.
  const hoursUntilAppt = useMemo(() => {
    const st = appointment?.startTime ? new Date(appointment.startTime).getTime() : 0;
    return st ? (st - Date.now()) / 3600000 : 0;
  }, [appointment]);

  // A CANCELLATION fee follows the cancellation POLICY, not the full service
  // cost. (Full cost is no-show economics — handled in the isNoShow branch of
  // finalFeeAmount.) Enough notice → free; a per-service cancellation fee wins
  // where set; otherwise the studio's flat fee applies once. Rounded to cents.
  const suggestedFeeTotal = useMemo(() => {
    return resolveAppointmentCancellationFee({
      services: recoveryMatrix.map(m => ({
        mode: m.feeMode,
        value: m.feeValue,
        window: m.window,
        matrixBasis: m.houseFloor + m.laborProtection,
        price: m.price,
      })),
      globalMode: (tenant?.defaultCancellationMode || 'matrix'),
      tenantFlatFee: tenant?.cancellationFee || 0,
      defaultWindowHours: tenant?.cancellationWindowHours || 24,
      hoursUntilAppointment: hoursUntilAppt,
    });
  }, [recoveryMatrix, hoursUntilAppt, tenant]);

  // Reset state each time the dialog opens
  useEffect(() => {
    if (open) {
      setActorType('studio');
      setStudioReason('client_request_relayed');
      setClientReason('schedule_conflict');
      setCustomReason('');
      setAdditionalCreditValue(0);
      setShowFeeBreakdown(false);
    }
  }, [open]);

  // feeValue tracks the suggestion until the person edits it directly —
  // recomputed whenever the underlying suggestion changes (e.g. actor type
  // toggles which fee logic applies), but only while still un-edited.
  useEffect(() => {
    if (open) {
      setFeeValue(suggestedFeeTotal);
      // Default the toggle to whether a fee is actually owed: enough notice
      // (suggested 0) → off, so a routine in-policy cancel never pre-loads a
      // charge. No-show always defaults on.
      setChargeFee(actorType === 'no_show' ? true : suggestedFeeTotal > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, suggestedFeeTotal]);

  // Live deposit-credit lookup — runs each time the dialog opens for a given
  // appointment/client. Mirrors the exact lookup pattern used in
  // useCancellationConfirm and the self-cancel route, by clientId then by
  // email, most-recent-first, excluding expired credits.
  useEffect(() => {
    if (!open || !firestore || !tenant?.id) {
      setDepositCredit(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDeposit(true);
    (async () => {
      try {
        const creditsCol = collection(firestore, `tenants/${tenant.id}/depositCredits`);
        let snap = appointment.clientId
          ? await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', appointment.clientId)))
          : null;
        if ((!snap || snap.empty) && client?.email) {
          snap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientEmail', '==', String(client.email).toLowerCase().trim())));
        }
        if (cancelled) return;
        if (snap && !snap.empty) {
          const candidates = snap.docs
            .map(d => ({ id: d.id, ...(d.data() as any) }))
            .filter((c: any) => !c.expiresAt || new Date(c.expiresAt).getTime() > Date.now());
          candidates.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
          setDepositCredit(candidates[0] || null);
        } else {
          setDepositCredit(null);
        }
      } catch (e) {
        console.warn('[CancelAppointmentDialog deposit lookup]', e);
        if (!cancelled) setDepositCredit(null);
      } finally {
        if (!cancelled) setIsLoadingDeposit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, firestore, tenant?.id, appointment.clientId, client?.email]);

  // Default the disposition once the lookup resolves. If there's no Stripe
  // payment intent on file for the deposit, refunding will just fail and
  // fall back to store credit anyway (see /api/stripe/studio-cancel-refund)
  // — so default straight to store credit in that case instead of making
  // staff discover the failure first.
  useEffect(() => {
    if (!depositCredit) return;
    const tenantDefault = tenant?.studioRefundPolicy || 'refund';
    setDepositDisposition(
      tenantDefault === 'refund' && !depositCredit.stripePaymentIntentId
        ? 'store_credit'
        : tenantDefault,
    );
  }, [depositCredit, tenant]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const isNoShow = actorType === 'no_show';

  // Which reason value is "active" for the current actor
  const activeSpecificReason: string = isNoShow
    ? 'no_show'
    : actorType === 'studio'
    ? studioReason
    : clientReason;

  const isOtherSelected =
    (actorType === 'studio' && studioReason === 'other') ||
    (actorType === 'client' && clientReason === 'other');

  const coarseReason = useMemo(
    () =>
      coarseReasonFor(
        actorType,
        actorType === 'studio' ? studioReason : undefined,
        actorType === 'client' ? clientReason : undefined,
      ),
    [actorType, studioReason, clientReason],
  );

  const isFeeOverridden = !isNoShow && Math.abs(feeValue - suggestedFeeTotal) > 0.005;

  const finalFeeAmount = useMemo(() => {
    if (!chargeFee) return 0;
    if (isNoShow) {
      // Mirror handle-no-show-action's server-side computation exactly, so
      // the fee staff sees here always matches what's actually charged
      // regardless of which no-show entry point was used.
      if (tenant?.noShowFeeMode === 'flat' && tenant?.flatNoShowFee) return tenant.flatNoShowFee;
      return toCents2(sessionItems.reduce((acc, s) => acc + s.price, 0));
    }
    return feeValue;
  }, [chargeFee, isNoShow, feeValue, sessionItems, tenant]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleAction = async () => {
    setIsSubmitting(true);

    // Build the human-readable reason string passed to onConfirm
    let finalReasonStr: string;
    if (isNoShow) {
      finalReasonStr = 'no-show';
    } else if (isOtherSelected) {
      finalReasonStr = customReason.trim() || 'other';
    } else {
      finalReasonStr = activeSpecificReason;
    }

    const willChargeFee = chargeFee && finalFeeAmount > 0;
    const resolvedPaymentMethod = willChargeFee ? paymentMethod : 'waived';
    const now = new Date().toISOString();

    let actorId = 'system';
    let actorName = 'System';
    if (actorType === 'studio' || actorType === 'no_show') {
      actorId = currentStaff?.id || appointment.staffId || 'unknown_staff';
      actorName = currentStaff?.name || 'Studio Staff';
    } else if (actorType === 'client') {
      actorId = client?.id || appointment.clientId;
      actorName = client?.name || appointment.clientName || 'Client';
    }

    const cancellationAudit: CancellationAudit = {
      actorType,
      actorId,
      actorName,
      reason: coarseReason,
      reasonDetail: isOtherSelected ? customReason : undefined,
      ...(actorType === 'studio' && { studioReason }),
      ...(actorType === 'client' && { clientReason }),
      feeAmount: finalFeeAmount,
      feeWaived: !willChargeFee && finalFeeAmount > 0,
      paymentStatus: willChargeFee ? 'unpaid' : finalFeeAmount > 0 ? 'waived' : 'paid',
      // Audit layer: was this fee what the policy/matrix suggested, or did a
      // human override it? Both numbers are kept, not just the final one —
      // that's the difference between "an appointment was cancelled" and
      // "here's exactly what was suggested, what actually happened, and
      // that a person made that call."
      ...(!isNoShow && { feeOverridden: isFeeOverridden, suggestedFeeAmount: suggestedFeeTotal }),
      timestamp: now,
    } as CancellationAudit;

    const actorLabel =
      actorType === 'studio' ? 'Studio' : actorType === 'client' ? 'Client' : 'No-Show';
    const summary = `${actorName} (${actorLabel}) cancelled ${
      client?.name || appointment.clientName || 'guest'
    }'s appointment${
      willChargeFee
        ? ` — $${finalFeeAmount.toFixed(2)} fee charged`
        : finalFeeAmount > 0
        ? ' — fee waived'
        : ''
    }`;

    const auditLogEntry: Omit<AuditLogEntry, 'id' | 'tenantId'> = {
      entityType: 'appointment_cancellation',
      entityId: appointment.id,
      actorType,
      actorId,
      actorName,
      timestamp: now,
      summary,
      detail: {
        clientId: client?.id || appointment.clientId,
        clientName: client?.name || appointment.clientName || 'Unknown',
        reason: finalReasonStr,
        reasonDetail: isOtherSelected ? customReason : undefined,
        feeAmount: finalFeeAmount,
        feeWaived: cancellationAudit.feeWaived,
        feeOverridden: !isNoShow ? isFeeOverridden : undefined,
        suggestedFeeAmount: !isNoShow ? suggestedFeeTotal : undefined,
        paymentMethod: willChargeFee ? resolvedPaymentMethod : undefined,
        recoveryBreakdown: recoveryMatrix.map(m => ({
          serviceId: m.id,
          serviceName: m.name,
          houseFloor: m.houseFloor,
          laborProtection: m.laborProtection,
          serviceOverrideFee: m.overrideFee || undefined,
        })),
      },
    };

    await onConfirm({
      reason: finalReasonStr,
      chargeFee: willChargeFee,
      feeAmount: finalFeeAmount,
      paymentMethod: resolvedPaymentMethod,
      cancellationAudit,
      auditLogEntry,
      ...(actorType === 'studio' && hasDeposit ? {
        depositDisposition,
        ...(depositDisposition === 'store_credit' && additionalCreditValue > 0
          ? { additionalCreditCents: Math.round(additionalCreditValue * 100) }
          : {}),
      } : {}),
    });

    setIsSubmitting(false);
    onOpenChange(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl flex flex-col h-[95dvh] max-h-[95dvh] bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Ban className="w-5 h-5 text-destructive" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">
              Protocol Termination
            </span>
          </div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">
            Cancel Appointment
          </DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">
            Guest: <strong>{appointment.clientName}</strong>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8 space-y-10">

            {/* ── Who is cancelling ── */}
            <div className="space-y-4">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                Who Is Cancelling?
              </Label>
              <RadioGroup
                value={actorType}
                onValueChange={v => setActorType(v as ActorType)}
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                {/* Studio */}
                <label htmlFor="actor-studio" className="cursor-pointer">
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all text-center',
                      actorType === 'studio'
                        ? 'border-primary bg-primary/5 shadow-md'
                        : 'border-border bg-white hover:border-primary/20',
                    )}
                  >
                    <Building2
                      className={cn(
                        'w-5 h-5',
                        actorType === 'studio' ? 'text-primary' : 'text-muted-foreground opacity-40',
                      )}
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                      Studio / Staff
                    </span>
                    <RadioGroupItem value="studio" id="actor-studio" className="sr-only" />
                  </div>
                </label>

                {/* Client */}
                <label htmlFor="actor-client" className="cursor-pointer">
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all text-center',
                      actorType === 'client'
                        ? 'border-primary bg-primary/5 shadow-md'
                        : 'border-border bg-white hover:border-primary/20',
                    )}
                  >
                    <UserCircle
                      className={cn(
                        'w-5 h-5',
                        actorType === 'client' ? 'text-primary' : 'text-muted-foreground opacity-40',
                      )}
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                      Client
                    </span>
                    <RadioGroupItem value="client" id="actor-client" className="sr-only" />
                  </div>
                </label>

                {/* No-show */}
                <label htmlFor="actor-noshow" className="cursor-pointer">
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all text-center',
                      actorType === 'no_show'
                        ? 'border-destructive bg-destructive/5 shadow-md'
                        : 'border-border bg-white hover:border-destructive/20',
                    )}
                  >
                    <UserX
                      className={cn(
                        'w-5 h-5',
                        actorType === 'no_show' ? 'text-destructive' : 'text-muted-foreground opacity-40',
                      )}
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                      No-Show
                    </span>
                    <RadioGroupItem value="no_show" id="actor-noshow" className="sr-only" />
                  </div>
                </label>
              </RadioGroup>

              {actorType === 'studio' && (
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight ml-1 opacity-60">
                  Will be logged as cancelled by{' '}
                  <strong className="text-slate-700">
                    {currentStaff?.name || 'the logged-in staff member'}
                  </strong>
                  .
                </p>
              )}

              {/* ── Deposit disposition — studio is always at fault here, ──
                  client should never lose money. Only shown for studio cancels
                  with a paid deposit; refund/store-credit is processed before
                  the cancellation itself commits (see useCancellationConfirm). */}
              {actorType === 'studio' && hasDeposit && (
                <Card className="border-4 border-primary/10 bg-primary/[0.02] rounded-[2rem] shadow-inner">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                        <Wallet className="w-3.5 h-3.5" /> Client Has a Paid Deposit
                      </p>
                      <span className="font-mono text-sm font-black text-primary">
                        ${depositDollars.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60">
                      The studio is cancelling — the client keeps this money one way or another.
                    </p>
                    <RadioGroup
                      value={depositDisposition}
                      onValueChange={v => setDepositDisposition(v as 'refund' | 'store_credit')}
                      className="grid grid-cols-2 gap-3"
                    >
                      <label htmlFor="deposit-refund" className="cursor-pointer">
                        <RadioGroupItem value="refund" id="deposit-refund" className="peer sr-only" />
                        <div
                          className={cn(
                            'flex flex-col items-center justify-center p-4 border-2 rounded-2xl transition-all text-center gap-1.5',
                            depositDisposition === 'refund'
                              ? 'border-primary bg-white shadow-lg'
                              : 'border-border bg-white/50',
                          )}
                        >
                          <RefreshCw className={cn('w-4 h-4', depositDisposition === 'refund' ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">Refund to Card</span>
                          <span className="text-[8px] font-bold uppercase opacity-50 leading-tight">3–5 business days</span>
                        </div>
                      </label>
                      <label htmlFor="deposit-credit" className="cursor-pointer">
                        <RadioGroupItem value="store_credit" id="deposit-credit" className="peer sr-only" />
                        <div
                          className={cn(
                            'flex flex-col items-center justify-center p-4 border-2 rounded-2xl transition-all text-center gap-1.5',
                            depositDisposition === 'store_credit'
                              ? 'border-primary bg-white shadow-lg'
                              : 'border-border bg-white/50',
                          )}
                        >
                          <Wallet className={cn('w-4 h-4', depositDisposition === 'store_credit' ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">Store Credit</span>
                          <span className="text-[8px] font-bold uppercase opacity-50 leading-tight">Instant, usable next visit</span>
                        </div>
                      </label>
                    </RadioGroup>
                    {depositDisposition === 'refund' && depositCredit && !depositCredit.stripePaymentIntentId && (
                      <p className="text-[9px] font-bold text-amber-600 uppercase tracking-tight flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        No Stripe record found for this deposit — will automatically fall back to store credit.
                      </p>
                    )}
                    {depositDisposition === 'store_credit' && (
                      <div className="space-y-2 pt-2 border-t border-dashed">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                          Add Goodwill Credit (optional)
                        </Label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={additionalCreditValue || ''}
                            onChange={e => setAdditionalCreditValue(Math.max(0, parseFloat(e.target.value) || 0))}
                            placeholder="0.00"
                            className="h-11 pl-9 rounded-xl border-2 font-bold text-sm bg-white"
                          />
                        </div>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-tight opacity-60">
                          On top of the ${depositDollars.toFixed(2)} deposit — logged as a separate expense, not part of the deposit conversion above.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── Reason (hidden for no-show) ── */}
            {!isNoShow && (
              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                  Cancellation Reason
                </Label>

                {actorType === 'studio' && (
                  <Select value={studioReason} onValueChange={v => setStudioReason(v as StudioCancellationReason)}>
                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight bg-white shadow-inner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                      {STUDIO_REASON_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="font-bold uppercase text-xs tracking-tight py-2.5">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {actorType === 'client' && (
                  <Select value={clientReason} onValueChange={v => setClientReason(v as ClientCancellationReason)}>
                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight bg-white shadow-inner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                      {CLIENT_REASON_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="font-bold uppercase text-xs tracking-tight py-2.5">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {isOtherSelected && (
                  <Input
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                    placeholder="Describe the reason..."
                    className="h-12 rounded-xl border-2 font-bold text-sm bg-white"
                  />
                )}
              </div>
            )}

            {/* ── Recovery matrix breakdown — hidden for no-show, whose fee is
                 fixed/flat and never derived from this matrix at all.
                 Passive disclosure only: this used to be a SECOND editable
                 fee mechanism (per-service checkboxes) sitting alongside a
                 separate override input below, two controls fighting over
                 one number. Now it's just "here's how the suggestion was
                 calculated," collapsed by default. ── */}
            {!isNoShow && recoveryMatrix.length > 0 && (
              <button
                type="button"
                onClick={() => setShowFeeBreakdown(v => !v)}
                className="w-full flex items-center justify-between px-1 text-left"
              >
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                  {showFeeBreakdown ? 'Hide' : 'See'} each service's cost basis (for reference)
                </span>
                <ArrowRight className={cn('w-3 h-3 text-muted-foreground opacity-40 transition-transform', showFeeBreakdown && 'rotate-90')} />
              </button>
            )}
            {!isNoShow && showFeeBreakdown && (
              <div className="space-y-2 -mt-2">
                {recoveryMatrix.map(m => {
                  const lineTotal = m.overrideFee > 0 ? m.overrideFee : m.houseFloor + m.laborProtection;
                  return (
                    <div key={m.id} className="flex items-center justify-between p-3 rounded-xl border border-dashed bg-muted/5">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-tight text-slate-700 truncate">{m.name}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                          {m.overrideFee > 0 ? 'Fixed service override' : `Time + materials $${m.houseFloor.toFixed(2)} · Labor $${m.laborProtection.toFixed(2)}`}
                        </p>
                      </div>
                      <span className="font-mono text-xs font-black text-slate-700 shrink-0 ml-3">${lineTotal.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Fee + settlement ── */}
            <div className="space-y-6">
              <Separator className="border-dashed" />
              <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner">
                <div className="space-y-1 text-left">
                  <Label className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                    <DollarSign className="w-4 h-4 text-primary" /> Cancellation Fee
                  </Label>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">
                    {isNoShow
                      ? '100% of service total — no-show policy'
                      : isFeeOverridden
                      ? `Edited from suggested $${suggestedFeeTotal.toFixed(2)}`
                      : 'Suggested — tap to edit'}
                  </p>
                </div>
                <Switch checked={chargeFee} onCheckedChange={setChargeFee} className="scale-110" />
              </div>

              {chargeFee && !isNoShow && (
                <div className="relative -mt-2">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-primary opacity-40" />
                  <Input
                    type="number"
                    step="0.01"
                    value={feeValue || ''}
                    onChange={e => setFeeValue(toCents2(parseFloat(e.target.value) || 0))}
                    className="h-16 pl-12 rounded-2xl border-2 font-black text-3xl tracking-tighter text-primary bg-white shadow-inner"
                  />
                </div>
              )}
              {chargeFee && isNoShow && (
                <p className="text-3xl font-black font-mono tracking-tighter text-primary text-right -mt-2">
                  ${finalFeeAmount.toFixed(2)}
                </p>
              )}

              <AnimatePresence>
                {chargeFee && finalFeeAmount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    <div className="space-y-6">
                      {/* Settlement protocol */}
                      <div className="space-y-4 pt-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                          Settlement Protocol
                        </Label>
                        <RadioGroup
                          value={paymentMethod}
                          onValueChange={(v: any) => setPaymentMethod(v)}
                          disabled={isSubmitting}
                          className="grid grid-cols-2 gap-3"
                        >
                          <label
                            htmlFor="pay-vault-cancel"
                            className={cn(
                              'cursor-pointer h-full',
                              !hasCardOnFile && 'opacity-40 grayscale',
                            )}
                          >
                            <RadioGroupItem
                              value="card_on_file"
                              id="pay-vault-cancel"
                              className="peer sr-only"
                              disabled={!hasCardOnFile}
                            />
                            <div
                              className={cn(
                                'flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full',
                                paymentMethod === 'card_on_file'
                                  ? 'border-primary bg-primary/5 shadow-lg'
                                  : 'border-border bg-white shadow-sm',
                              )}
                            >
                              {hasCardOnFile ? (
                                <ShieldCheck className="w-6 h-6 mb-2 text-primary" />
                              ) : (
                                <Lock className="w-6 h-6 mb-2 text-slate-400" />
                              )}
                              <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                                Vault Card
                              </span>
                            </div>
                          </label>
                          <label htmlFor="pay-balance-cancel" className="cursor-pointer h-full">
                            <RadioGroupItem
                              value="add_to_balance"
                              id="pay-balance-cancel"
                              className="peer sr-only"
                            />
                            <div
                              className={cn(
                                'flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full',
                                paymentMethod === 'add_to_balance'
                                  ? 'border-primary bg-primary/5 shadow-lg'
                                  : 'border-border bg-white shadow-sm',
                              )}
                            >
                              <Landmark
                                className={cn(
                                  'w-6 h-6 mb-2 transition-colors',
                                  paymentMethod === 'add_to_balance'
                                    ? 'text-primary'
                                    : 'text-muted-foreground opacity-40',
                                )}
                              />
                              <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                                Client Arrears
                              </span>
                            </div>
                          </label>
                        </RadioGroup>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3 shrink-0">
          <div className="px-2 py-3 rounded-xl bg-muted/10 border border-dashed text-center">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed">
              {client?.name || appointment.clientName || 'Client'} will be {chargeFee && finalFeeAmount > 0
                ? <>charged <span className="font-black text-primary">${finalFeeAmount.toFixed(2)}</span> via {paymentMethod === 'card_on_file' ? 'card on file' : 'balance owed'}</>
                : <span className="font-black text-green-600">charged no fee</span>}
              {actorType === 'studio' && depositCredit && (
                <> · deposit {depositDisposition === 'refund' ? 'refunded' : 'converted to credit'}</>
              )}
            </p>
          </div>
          <Button
            onClick={handleAction}
            className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 group"
            disabled={isSubmitting || (isOtherSelected && !customReason.trim())}
          >
            {isSubmitting ? (
              <Loader className="w-6 h-6 animate-spin" />
            ) : (
              <>
                Finalize Reversal{' '}
                <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400"
          >
            Abort Protocol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
