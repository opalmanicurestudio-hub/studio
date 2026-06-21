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
import { differenceInHours, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase } from '@/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Checkbox } from '@/components/ui/checkbox';
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

  const [selectedHouseRecoveryIds, setSelectedHouseRecoveryIds] = useState<Set<string>>(new Set());
  const [selectedLaborRecoveryIds, setSelectedLaborRecoveryIds] = useState<Set<string>>(new Set());
  const [useOverrideFee, setUseOverrideFee] = useState(false);
  const [overrideFeeValue, setOverrideFeeValue] = useState(0);
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
      };
    });
  }, [sessionItems, tmhr, inventory, staff, appointment, taxBurden, tenant]);

  // Reset state each time the dialog opens
  useEffect(() => {
    if (open) {
      setActorType('studio');
      setStudioReason('client_request_relayed');
      setClientReason('schedule_conflict');
      setCustomReason('');
      setAdditionalCreditValue(0);
      const allIds = new Set(sessionItems.map(s => s.id));
      setSelectedHouseRecoveryIds(allIds);
      setSelectedLaborRecoveryIds(allIds);

      const firstOverride = recoveryMatrix.find(m => m.overrideFee > 0);
      if (firstOverride) {
        setUseOverrideFee(true);
        setOverrideFeeValue(firstOverride.overrideFee);
      } else {
        setUseOverrideFee(false);
        setOverrideFeeValue(tenant?.cancellationFee || 0);
      }
    }
  }, [open, sessionItems, recoveryMatrix, tenant]);

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

  const totalMatrixFee = useMemo(() => {
    let total = 0;
    recoveryMatrix.forEach(m => {
      if (selectedHouseRecoveryIds.has(m.id)) total += m.houseFloor;
      if (selectedLaborRecoveryIds.has(m.id)) total += m.laborProtection;
    });
    return total;
  }, [recoveryMatrix, selectedHouseRecoveryIds, selectedLaborRecoveryIds]);

  const finalFeeAmount = useMemo(() => {
    if (!chargeFee) return 0;
    if (isNoShow) {
      // Mirror handle-no-show-action's server-side computation exactly, so
      // the fee staff sees here always matches what's actually charged
      // regardless of which no-show entry point was used.
      if (tenant?.noShowFeeMode === 'flat' && tenant?.flatNoShowFee) return tenant.flatNoShowFee;
      return sessionItems.reduce((acc, s) => acc + s.price, 0);
    }
    if (useOverrideFee) return overrideFeeValue;
    return totalMatrixFee;
  }, [chargeFee, isNoShow, useOverrideFee, overrideFeeValue, totalMatrixFee, sessionItems, tenant]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const toggleHouse = (id: string) => {
    const next = new Set(selectedHouseRecoveryIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedHouseRecoveryIds(next);
  };

  const toggleLabor = (id: string) => {
    const next = new Set(selectedLaborRecoveryIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedLaborRecoveryIds(next);
  };

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
      timestamp: now,
    };

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
        paymentMethod: willChargeFee ? resolvedPaymentMethod : undefined,
        recoveryBreakdown: recoveryMatrix.map(m => ({
          serviceId: m.id,
          serviceName: m.name,
          houseFloor: selectedHouseRecoveryIds.has(m.id) ? m.houseFloor : 0,
          laborProtection: selectedLaborRecoveryIds.has(m.id) ? m.laborProtection : 0,
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
              <div className="space-y-4">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                  Cancellation Reason
                </Label>

                {actorType === 'studio' && (
                  <RadioGroup
                    value={studioReason}
                    onValueChange={v => setStudioReason(v as StudioCancellationReason)}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                  >
                    {STUDIO_REASON_OPTIONS.map(opt => (
                      <label key={opt.value} htmlFor={`sr-${opt.value}`} className="cursor-pointer">
                        <div
                          className={cn(
                            'flex items-center gap-3 border-2 p-4 rounded-2xl transition-all hover:bg-muted/50',
                            studioReason === opt.value
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border bg-white',
                          )}
                        >
                          <RadioGroupItem value={opt.value} id={`sr-${opt.value}`} />
                          <span className="font-black uppercase tracking-tight text-xs">{opt.label}</span>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                )}

                {actorType === 'client' && (
                  <RadioGroup
                    value={clientReason}
                    onValueChange={v => setClientReason(v as ClientCancellationReason)}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                  >
                    {CLIENT_REASON_OPTIONS.map(opt => (
                      <label key={opt.value} htmlFor={`cr-${opt.value}`} className="cursor-pointer">
                        <div
                          className={cn(
                            'flex items-center gap-3 border-2 p-4 rounded-2xl transition-all hover:bg-muted/50',
                            clientReason === opt.value
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border bg-white',
                          )}
                        >
                          <RadioGroupItem value={opt.value} id={`cr-${opt.value}`} />
                          <span className="font-black uppercase tracking-tight text-xs">{opt.label}</span>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
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

            {/* ── Recovery matrix — hidden for no-show, whose fee is fixed/flat
                 and never derived from this matrix at all. Previously this
                 stayed visible with fully-interactive checkboxes that had
                 zero effect on the no-show charge — confusing, no purpose. ── */}
            {!isNoShow && (
              <div className="space-y-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 text-left">
                    Suggested Cancellation Fee
                  </p>
                  <p className="text-[9px] font-bold text-muted-foreground opacity-60 ml-1 text-left">
                    Based on studio time, materials, and labor cost per service. Uncheck a service to exclude it.
                  </p>
                </div>
                <div className="space-y-3">
                  {recoveryMatrix.map(m => {
                    // Both sets are kept in lockstep by this single control —
                    // staff see one decision per service ("include this in
                    // the fee or not"), not two independently-toggleable
                    // cost components that almost nobody wants to split.
                    const included = selectedHouseRecoveryIds.has(m.id);
                    const lineTotal = m.houseFloor + m.laborProtection;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { toggleHouse(m.id); toggleLabor(m.id); }}
                        className={cn(
                          'w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left',
                          included ? 'border-primary/20 bg-primary/[0.02]' : 'border-border bg-muted/5 opacity-50',
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Checkbox
                            checked={included}
                            onCheckedChange={() => { toggleHouse(m.id); toggleLabor(m.id); }}
                            className="h-5 w-5 rounded-lg border-2 shrink-0 pointer-events-none"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-black uppercase tracking-tight truncate text-slate-900">{m.name}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                              Time + materials ${m.houseFloor.toFixed(2)} · Labor ${m.laborProtection.toFixed(2)}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-sm font-black text-slate-900 shrink-0 ml-3">${lineTotal.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Fee + settlement ── */}
            <div className="space-y-6">
              <Separator className="border-dashed" />
              <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner">
                <div className="space-y-1 text-left">
                  <Label className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                    <DollarSign className="w-4 h-4 text-primary" /> Final Settlement Fee
                  </Label>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">
                    {isNoShow
                      ? '100% of service total — no-show policy'
                      : useOverrideFee
                      ? 'Applied via Fixed Override'
                      : 'Calculated via Profitability Matrix'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={cn(
                      'text-3xl font-black font-mono tracking-tighter',
                      chargeFee ? 'text-primary' : 'text-muted-foreground opacity-40',
                    )}
                  >
                    ${finalFeeAmount.toFixed(2)}
                  </span>
                  <Switch checked={chargeFee} onCheckedChange={setChargeFee} className="scale-110" />
                </div>
              </div>

              <AnimatePresence>
                {chargeFee && finalFeeAmount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    <div className="space-y-6">
                      {/* Override toggle — not shown for no-show (always 100%) */}
                      {!isNoShow && (
                        <>
                          <div className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5">
                            <div className="space-y-0.5 text-left">
                              <p className="text-[10px] font-black uppercase text-slate-900">
                                Fixed Rate Override
                              </p>
                              <p className="text-[8px] font-bold uppercase opacity-60">
                                Bypass matrix suggestion
                              </p>
                            </div>
                            <Switch
                              checked={useOverrideFee}
                              onCheckedChange={setUseOverrideFee}
                            />
                          </div>

                          {useOverrideFee && (
                            <div className="space-y-3 text-left">
                              <Label
                                htmlFor="override-value-manual"
                                className="text-[10px] font-black uppercase tracking-widest text-primary ml-1"
                              >
                                Override Value ($)
                              </Label>
                              <div className="relative">
                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                <Input
                                  id="override-value-manual"
                                  type="number"
                                  step="0.01"
                                  value={overrideFeeValue || ''}
                                  onChange={e =>
                                    setOverrideFeeValue(parseFloat(e.target.value) || 0)
                                  }
                                  className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-white"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

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