'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  Award, DollarSign, Clock, FileText, Edit, Trash2, Mail, Phone,
  User as UserIcon, Play, Square, Link as LinkIcon, MapPin, PlusCircle,
  ShieldCheck, Ban, Wallet, ShieldAlert, Sparkles, Loader, Users,
  AlertTriangle, Undo2, FileSignature, CheckCircle2, ArrowRight, MessageSquare,
  Ear, Unlock, Scale, FileImage, Maximize2, Zap, FlaskConical, Target,
  RefreshCw, History, HeartHandshake, AlertCircle, BookMarked, Heart,
  CreditCard, CalendarClock, MoreHorizontal, HeartPulse,
  Calendar, Camera, UserX, Globe, Receipt,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { cn, safeNumber } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, type Staff, type AppointmentCheckoutState, type ConsentForm } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, increment, writeBatch, arrayUnion, deleteField, query, where } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { AddAndConfigurePartsDialog } from './AddAndConfigurePartsDialog';
import { RescheduleAppointmentDialog } from './RescheduleAppointmentDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import { nanoid } from 'nanoid';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Textarea } from '../ui/textarea';
import NextImage from 'next/image';
import { ImageMarkupDialog } from '../shared/ImageMarkupDialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { computeDepositCents } from '@/lib/deposit-policy';
import { StoreCreditBadge } from '@/components/StoreCreditBadge';
import { StoreCreditSection } from '@/components/appointments/StoreCreditSection';
import { useStoreCredit } from '@/hooks/useStoreCredit';
import { useDepositCredit } from '@/hooks/useDepositCredit';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
  return new Date(val);
};

const safeFormatPhone = (phone: any): string => {
  if (!phone || typeof phone !== 'string') return String(phone || '');
  try { return formatPhoneNumber(phone) || phone; } catch { return phone; }
};

const safeTicketId = (id: any): string => {
  if (typeof id === 'string' && id.length > 0) return id.slice(-6).toUpperCase();
  if (typeof id === 'number') return String(id).slice(-6).toUpperCase();
  return 'N/A';
};

// Resolves a staffId to a display name. Falls back to the raw id (or a
// supplied label) rather than silently showing nothing — every accountability
// field (waivedBy, resolvedBy, noShowConfirmedBy, lastRescheduledBy) is only
// useful if it actually shows who, not just that someone did something.
const staffName = (staffId: any, staffList: any[], fallback = 'Staff'): string => {
  if (!staffId) return fallback;
  if (staffId === 'client') return 'Client';
  if (staffId === 'system') return 'System';
  const match = (staffList || []).find((s: any) => s.id === staffId);
  return match?.name || fallback;
};

type RowStatus = 'good' | 'warn' | 'bad' | 'neutral';
const STATUS_TEXT: Record<RowStatus, string> = {
  good: 'text-green-600', warn: 'text-amber-600', bad: 'text-destructive', neutral: 'text-muted-foreground opacity-50',
};
const RequirementRow = ({
  icon, label, value, status, action,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; status: RowStatus; action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
      <span className="opacity-50">{icon}</span>{label}
    </span>
    <div className="flex items-center gap-2 shrink-0">
      <span className={cn('text-[10px] font-black uppercase tracking-tight font-mono', STATUS_TEXT[status])}>{value}</span>
      {action}
    </div>
  </div>
);

// ─── Cancellation Record (full resolution wrap) ──────────────────────────────
// Two write paths produce cancelled appointments in this codebase: the public
// self-cancel route (writes appointment.cancellationAudit, the rich shape),
// and the planner's CancelAppointmentDialog flow (writes only the legacy
// discrete fields: cancellationReason / cancellationFeeApplied /
// cancellationPaymentStatus, no audit object). Without a fallback, any
// appointment cancelled from the planner showed "Cancelled by Unknown" with
// no reason or fee row — the data existed, just under different field names.
// This now synthesizes an equivalent audit shape from the legacy fields when
// the real one is absent, so the comprehensive view is comprehensive
// regardless of which surface cancelled it.
const CancellationRecord = ({
  appointment, transactions, staff, cancellationEvent, depositDecision,
  onProcessRefund, onKeepAsCredit, isProcessingRefund,
}: {
  appointment: any; transactions: any[]; staff: any[];
  cancellationEvent: any; depositDecision: any;
  onProcessRefund: () => void; onKeepAsCredit: () => void; isProcessingRefund: boolean;
}) => {
  const realAudit = appointment?.cancellationAudit;
  const hasLegacyData = !!(appointment?.cancellationReason || appointment?.cancellationFeeApplied != null || appointment?.cancelledAt);
  const audit = realAudit || (hasLegacyData ? {
    actorType: appointment.studioCancelled ? 'studio'
      : appointment.cancellationReason === 'no-show' ? 'no_show'
      : appointment.cancellationReason === 'automation' ? 'system'
      : 'client',
    reason: appointment.cancellationReason,
    studioReason: appointment.cancellationStudioReason,
    clientReason: appointment.cancellationClientReason,
    feeAmount: safeNumber(appointment.cancellationFeeApplied ?? appointment.cancellationFeeCharged),
    feeWaived: !!appointment.cancellationFeeWaived,
    paymentStatus: appointment.cancellationPaymentStatus,
    timestamp: appointment.cancelledAt,
    _legacy: true,
  } : null);

  const aptTxns = (transactions || [])
    .filter((t: any) => t.appointmentId === appointment.id)
    .sort((a: any, b: any) => safeDate(a.createdAt || a.date || 0).getTime() - safeDate(b.createdAt || b.date || 0).getTime());

  const feeAmount = safeNumber(audit?.feeAmount);
  const feeWaived = !!audit?.feeWaived && feeAmount > 0;
  const feeCharged = audit && !audit.feeWaived ? feeAmount : 0;

  const refunded = safeNumber(appointment.depositRefundedAmountCents) / 100;
  const creditFromDeposit = safeNumber(appointment.depositConvertedAmountCents) / 100;
  const depositPaid = appointment.depositStatus === 'paid'
    ? safeNumber(appointment.depositAmountCents) / 100
    : 0;

  const storeCreditIssued = aptTxns
    .filter((t: any) => t.type === 'store_credit_issued' || t.category === 'Store Credit')
    .reduce((s: number, t: any) => s + safeNumber(t.amount), 0);

  const feeChargeRecorded = aptTxns.some((t: any) =>
    t.type === 'income' &&
    (String(t.category || '').toLowerCase().includes('cancellation') ||
     String(t.description || '').toLowerCase().includes('cancellation'))
  );
  // The charge-outcome doc (cancellationEvents) is the more precise source —
  // if we have it, trust its chargeStatus over the ledger-presence guess.
  const chargeOutcomeKnown = !!cancellationEvent?.chargeStatus;
  const feeMarkedButMissing = feeCharged > 0 && !feeChargeRecorded &&
    (!chargeOutcomeKnown || cancellationEvent.chargeStatus === 'uncollected' || cancellationEvent.chargeStatus === 'failed');

  const actorLabel =
    audit?.actorType === 'studio' ? `Studio / ${staffName(audit.actorId, staff, 'Staff')}` :
    audit?.actorType === 'no_show' ? 'No-Show (automatic)' :
    audit?.actorType === 'system' ? 'System (automation)' :
    audit ? 'Client' : 'Unknown';

  const reasonText = (audit?.studioReason || audit?.clientReason || audit?.reason || '')
    .toString().replace(/_/g, ' ');

  const dispositionLabel =
    appointment.depositDisposition === 'refunded' ? `Refunded to card${refunded > 0 ? ` · $${refunded.toFixed(2)}` : ''}` :
    appointment.depositDisposition === 'store_credit' ? `Converted to credit${creditFromDeposit > 0 ? ` · $${creditFromDeposit.toFixed(2)}` : ''}` :
    appointment.depositDisposition === 'forfeited' || appointment.depositForfeited ? 'Forfeited (studio kept it)' :
    null;

  const rows: { label: string; value: string; tone: string }[] = [];
  if (depositPaid > 0) rows.push({ label: 'Deposit collected', value: `$${depositPaid.toFixed(2)}`, tone: 'text-slate-700' });
  rows.push({
    label: 'Cancellation fee',
    value: feeWaived ? 'Waived' : feeCharged > 0 ? `$${feeCharged.toFixed(2)}` : 'None',
    tone: feeWaived ? 'text-green-600' : feeCharged > 0 ? 'text-amber-600' : 'text-muted-foreground opacity-50',
  });
  if (dispositionLabel) rows.push({ label: 'Deposit outcome', value: dispositionLabel, tone: 'text-primary/80' });
  if (storeCreditIssued > 0) rows.push({ label: 'Store credit issued', value: `$${storeCreditIssued.toFixed(2)}`, tone: 'text-green-600' });
  if (chargeOutcomeKnown) {
    const chargeLabelMap: Record<string, string> = {
      charged: 'Charged successfully', failed: 'Card declined', uncollected: 'No card — added to balance',
      waived: 'Waived', balance: 'Added to balance',
    };
    rows.push({
      label: 'Charge outcome',
      value: chargeLabelMap[cancellationEvent.chargeStatus] || cancellationEvent.chargeStatus,
      tone: cancellationEvent.chargeStatus === 'charged' ? 'text-green-600'
        : cancellationEvent.chargeStatus === 'failed' || cancellationEvent.chargeStatus === 'uncollected' ? 'text-destructive'
        : 'text-amber-600',
    });
  }

  const isNoShow = audit?.actorType === 'no_show';
  const waiverStaffId = appointment.waivedBy;
  const showWaiverRow = (feeWaived || appointment.cancellationFeeWaived) && waiverStaffId;
  const refundPending = depositDecision?.outcome === 'refund_pending';

  if (!audit) {
    return (
      <div className="rounded-[1.75rem] bg-destructive/5 border-2 border-destructive/20 overflow-hidden p-5">
        <div className="flex items-center gap-2.5">
          <Ban className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-[11px] font-black uppercase tracking-widest text-destructive leading-tight">Cancelled</p>
        </div>
        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight mt-2 pl-7 opacity-60">
          No further cancellation detail was recorded for this appointment.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.75rem] bg-destructive/5 border-2 border-destructive/20 overflow-hidden">
      <div className="p-5 space-y-2.5">
        <div className="flex items-center gap-2.5">
          {isNoShow ? <UserX className="w-5 h-5 text-destructive shrink-0" /> : <Ban className="w-5 h-5 text-destructive shrink-0" />}
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-destructive leading-tight">
              {isNoShow ? 'No-Show' : `Cancelled by ${actorLabel}`}
            </p>
            {audit?.timestamp && (
              <p className="text-[9px] font-bold text-destructive/60 uppercase tracking-wide">
                {format(safeDate(audit.timestamp), 'MMM d, yyyy · h:mm a')}
              </p>
            )}
          </div>
        </div>
        {reasonText && (
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed pl-7">
            {reasonText}{audit?.reasonDetail ? ` — "${audit.reasonDetail}"` : ''}
          </p>
        )}
        {isNoShow && safeNumber(appointment.lateTimeMinutes) > 0 && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight pl-7 opacity-70">
            {appointment.noShowConfirmedBy
              ? `Confirmed by ${staffName(appointment.noShowConfirmedBy, staff)}`
              : `Automatically flagged after ${appointment.lateTimeMinutes}m past start`}
          </p>
        )}
      </div>

      <div className="px-5 pb-5 space-y-2">
        <div className="rounded-2xl bg-white border-2 border-destructive/10 divide-y divide-dashed divide-muted/40">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{r.label}</span>
              <span className={cn('text-[11px] font-black uppercase tracking-tight font-mono', r.tone)}>{r.value}</span>
            </div>
          ))}
        </div>

        {showWaiverRow && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border-2 border-green-200">
            <HeartHandshake className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-green-700 leading-relaxed">
              Fee waived by {staffName(waiverStaffId, staff)}
              {appointment.waivedReason ? ` — "${appointment.waivedReason}"` : ''}
            </p>
          </div>
        )}

        {chargeOutcomeKnown && cancellationEvent.errorMessage && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border-2 border-red-200">
            <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-destructive leading-relaxed">
              Stripe error: {cancellationEvent.errorMessage}
            </p>
          </div>
        )}

        {feeMarkedButMissing && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border-2 border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 leading-relaxed">
              A ${feeCharged.toFixed(2)} fee was marked but no matching charge is in the ledger — verify the card was actually run.
            </p>
          </div>
        )}

        {refundPending && (
          <div className="p-3.5 rounded-xl bg-blue-50 border-2 border-blue-200 space-y-2.5">
            <p className="text-[9px] font-black uppercase tracking-wide text-blue-800 leading-relaxed flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Deposit refund pending — ${safeNumber(depositDecision.amountDollars).toFixed(2)}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm" onClick={onProcessRefund} disabled={isProcessingRefund}
                className="h-8 flex-1 rounded-lg text-[8px] font-black uppercase tracking-widest"
              >
                {isProcessingRefund ? <Loader className="w-3 h-3 animate-spin" /> : 'Refund to Card'}
              </Button>
              <Button
                size="sm" variant="outline" onClick={onKeepAsCredit} disabled={isProcessingRefund}
                className="h-8 flex-1 rounded-lg text-[8px] font-black uppercase tracking-widest border-2"
              >
                Keep as Credit
              </Button>
            </div>
          </div>
        )}

        {aptTxns.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-50 pl-1">Ledger Receipts</p>
            {aptTxns.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-muted/30">
                <div className="min-w-0 flex items-center gap-2">
                  <History className="w-3 h-3 text-muted-foreground opacity-40 shrink-0" />
                  <span className="text-[9px] font-bold uppercase tracking-tight text-slate-600 truncate">
                    {String(t.description || t.category || 'Transaction')}
                  </span>
                </div>
                <span className={cn(
                  'text-[10px] font-black font-mono shrink-0 ml-2',
                  t.type === 'income' ? 'text-green-600' :
                  t.type === 'refund' || t.type === 'reversal' ? 'text-slate-400' :
                  t.type === 'store_credit_issued' ? 'text-primary' : 'text-amber-600'
                )}>
                  {t.type === 'income' ? '+' : t.type === 'refund' || t.type === 'reversal' ? '−' : ''}
                  ${Math.abs(safeNumber(t.amount)).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Completion Receipt ───────────────────────────────────────────────────────
// Replaces the (irrelevant, nothing's gating anymore) ReadinessBanner for a
// completed appointment with an actual checkout-style summary: what was
// collected, tip, discount, payment method — pulled from this appointment's
// own ledger transactions rather than re-deriving it.
const CompletionReceipt = ({ appointment, transactions, staff }: { appointment: any; transactions: any[]; staff: any[] }) => {
  const aptTxns = (transactions || []).filter((t: any) => t.appointmentId === appointment.id);
  const serviceRevenue = aptTxns.filter((t: any) => t.category === 'Service Revenue').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const tips = aptTxns.filter((t: any) => t.category === 'Tips').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const discounts = aptTxns.filter((t: any) => t.category === 'Discounts').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const adjustments = aptTxns.filter((t: any) =>
    ['Protocol Recovery', 'Strategic Adjustment', 'Adjustment Fee'].includes(t.category)
  ).reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const paymentMethod = aptTxns.find((t: any) => t.category === 'Service Revenue')?.paymentMethod || aptTxns[0]?.paymentMethod || '—';
  const total = serviceRevenue + tips + adjustments - discounts;
  const completedByName = staffName(appointment.staffId, staff, 'Unassigned');

  return (
    <div className="rounded-[1.75rem] bg-green-50 border-2 border-green-200 overflow-hidden">
      <div className="p-5 flex items-center gap-2.5">
        <Receipt className="w-5 h-5 text-green-600 shrink-0" />
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-green-700 leading-tight">Session Completed</p>
          {appointment.actualEndTime && (
            <p className="text-[9px] font-bold text-green-700/60 uppercase tracking-wide">
              {format(safeDate(appointment.actualEndTime), 'MMM d, yyyy · h:mm a')}
            </p>
          )}
        </div>
      </div>
      <div className="px-5 pb-5">
        <div className="rounded-2xl bg-white border-2 border-green-100 divide-y divide-dashed divide-muted/30">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service Revenue</span>
            <span className="text-[11px] font-black font-mono">${serviceRevenue.toFixed(2)}</span>
          </div>
          {adjustments > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Adjustments</span>
              <span className="text-[11px] font-black font-mono text-amber-600">${adjustments.toFixed(2)}</span>
            </div>
          )}
          {discounts > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Discount</span>
              <span className="text-[11px] font-black font-mono text-amber-600">-${discounts.toFixed(2)}</span>
            </div>
          )}
          {tips > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Gratuity</span>
              <span className="text-[11px] font-black font-mono text-green-600">${tips.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Payment Method</span>
            <span className="text-[11px] font-black font-mono">{paymentMethod}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Performed By</span>
            <span className="text-[11px] font-black font-mono">{completedByName}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-green-50/50">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-700">Total Collected</span>
            <span className="text-[13px] font-black font-mono text-primary">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Readiness Banner ─────────────────────────────────────────────────────────
const ReadinessBanner = ({
  appointment, client, complianceInfo, hasDeposit, isLoadingDeposit, cardSecured,
}: {
  appointment: any;
  client: any;
  complianceInfo: { healthPendingForms: ConsentForm[]; otherPendingForms: ConsentForm[]; allCertified: boolean };
  hasDeposit: boolean;
  isLoadingDeposit: boolean;
  cardSecured: boolean;
}) => {
  const flags      = appointment?.readinessFlags || {};
  const hasBan     = client?.status === 'banned';
  const hasDispute = client?.hasOpenDispute === true;
  const hasAllergy = !!(client?.allergyNotes || client?.medicalNotes);
  const outstandingBalance = safeNumber(client?.outstandingBalance);

  const depositRequiredButMissing = !!flags.depositRequired && !hasDeposit && !isLoadingDeposit;
  const healthFormsPending = complianceInfo.healthPendingForms.length > 0;
  const otherFormsPending  = complianceInfo.otherPendingForms.length > 0;
  const cardActuallyMissing = !!flags.cardRequired && !cardSecured;

  const blockers = [
    hasBan     && { level: 'banned',  msg: `Banned — ${client?.banMessage || 'No service permitted'}` },
    hasDispute && { level: 'dispute', msg: `Open chargeback dispute on file — verify before service` },
    healthFormsPending && {
      level: 'danger',
      msg: `Health disclosure required: ${complianceInfo.healthPendingForms.map(f => f.title).join(', ')}`,
    },
    hasAllergy && {
      level: 'allergy',
      msg: [
        client.allergyNotes ? `Allergy: ${client.allergyNotes}` : '',
        client.medicalNotes ? `Medical: ${client.medicalNotes}` : '',
      ].filter(Boolean).join(' · '),
    },
    otherFormsPending && {
      level: 'warn',
      msg: `${complianceInfo.otherPendingForms.length} consent form${complianceInfo.otherPendingForms.length !== 1 ? 's' : ''} not yet signed`,
    },
    depositRequiredButMissing && { level: 'danger', msg: `Deposit not received — collect below before starting` },
    cardActuallyMissing && { level: 'warn',   msg: `No card on file — collect at check-in` },
    outstandingBalance > 0 && { level: 'warn', msg: `Outstanding $${outstandingBalance.toFixed(2)} — settle at checkout` },
    flags.needsConsultationBuffer && { level: 'info', msg: `No reference photos — allow 15 min design consultation` },
  ].filter(Boolean) as { level: string; msg: string }[];

  if (flags.depositRequired && isLoadingDeposit) {
    return (
      <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-muted/10 border-2 border-muted/30">
        <Loader className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Verifying deposit status…
        </p>
      </div>
    );
  }

  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-green-50 border-2 border-green-200">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
          Ready to start — all requirements met
        </p>
      </div>
    );
  }

  const BG: Record<string, string> = {
    banned:  'bg-slate-900 border-slate-900',
    dispute: 'bg-purple-50 border-purple-300',
    danger:  'bg-red-50 border-red-300',
    allergy: 'bg-red-50 border-red-400',
    warn:    'bg-amber-50 border-amber-200',
    info:    'bg-blue-50 border-blue-200',
  };
  const TX: Record<string, string> = {
    banned:  'text-white',
    dispute: 'text-purple-900',
    danger:  'text-red-900',
    allergy: 'text-red-900',
    warn:    'text-amber-900',
    info:    'text-blue-800',
  };
  const IC: Record<string, string> = {
    banned:  'text-white',
    dispute: 'text-purple-600',
    danger:  'text-red-600',
    allergy: 'text-red-600',
    warn:    'text-amber-600',
    info:    'text-blue-500',
  };

  return (
    <div className="space-y-2">
      {blockers.map((b, i) => (
        <div key={i} className={cn('flex items-start gap-3 p-4 rounded-2xl border-2', BG[b.level])}>
          <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-0.5', IC[b.level])} />
          <p className={cn('text-[10px] font-black uppercase tracking-wide leading-snug', TX[b.level])}>
            {b.msg}
          </p>
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const AppointmentDetailsSheet: React.FC<any> = ({
  open, onOpenChange, appointment: initialAppointment, client, service, tmhr,
  transactions, onStartService, onFinishService, onEdit, onDelete, onCancel,
  onReschedule, onRebook, onBookNewForClient, onPrintTicket, onOverride, onWaiveFee,
}) => {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const { inventory, services: allServices, staff, appointments: allAppointments, consentForms } = useInventory();
  const { role, selectedTenant } = useTenant();
  const { user: currentUser } = useUser();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { firestore } = useFirebase();

  useEffect(() => { setMounted(true); }, []);

  const [isAddAndConfigureOpen, setIsAddAndConfigureOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestPhotos, setRequestPhotos] = useState(false);
  const [reqLink, setReqLink] = useState<string | null>(null);
  const [reqSending, setReqSending] = useState(false);
  const [reqCopied, setReqCopied] = useState(false);
  const [isCollectingDeposit, setIsCollectingDeposit] = useState(false);
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  const appointment = useMemo(() => {
    if (!initialAppointment || !allAppointments) return initialAppointment;
    return allAppointments.find((a: any) => a.id === initialAppointment.id) || initialAppointment;
  }, [initialAppointment, allAppointments]);

  const currentAddOns = useMemo(() => {
    if (!appointment?.addOnIds || !allServices) return [];
    return appointment.addOnIds.map((id: string) => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
  }, [appointment?.addOnIds, allServices]);

  // ── Cancellation charge outcome (Tier 2) — the cancellationEvents doc has
  // the precise Stripe result (chargeStatus, errorMessage); the appointment
  // doc alone only lets us infer success from ledger presence.
  const cancellationEventQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !appointment?.cancellationEventId) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/cancellationEvents`),
      where('id', '==', appointment.cancellationEventId),
    );
  }, [firestore, tenantId, appointment?.cancellationEventId]);
  const { data: cancellationEventDocs } = useCollection<any>(cancellationEventQuery);
  const cancellationEvent = cancellationEventDocs?.[0] || null;

  // ── Pending deposit refund (Tier 2) — surfaces the exact gap where a
  // self-cancel outside the window flagged a refund as owed but nothing
  // ever auto-executed it.
  const depositDecisionsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !appointment?.id || appointment.status !== 'cancelled') return null;
    return query(
      collection(firestore, `tenants/${tenantId}/depositDecisions`),
      where('appointmentId', '==', appointment.id),
    );
  }, [firestore, tenantId, appointment?.id, appointment?.status]);
  const { data: depositDecisionDocs } = useCollection<any>(depositDecisionsQuery);
  const latestDepositDecision = useMemo(() => {
    if (!depositDecisionDocs || depositDecisionDocs.length === 0) return null;
    return [...depositDecisionDocs].sort((a: any, b: any) =>
      safeDate(b.decidedAt || 0).getTime() - safeDate(a.decidedAt || 0).getTime()
    )[0];
  }, [depositDecisionDocs]);

  const handleEscalate = async () => {
    if (!firestore || !tenantId || !appointment?.id) return;
    setIsEscalating(true);
    const batch = writeBatch(firestore);
    const adminsAndOwners = (staff || []).filter(s => s.role === 'admin' || s.role === 'owner');
    const now = new Date().toISOString();
    const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, appointment.id);
    batch.update(appointmentRef, { isEscalated: true });
    if (appointment.isWalkIn) {
      const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, String(appointment.id).replace('apt-walkin-', ''));
      batch.update(walkInRef, { isEscalated: true });
    }
    adminsAndOwners.forEach(admin => {
      const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(notifRef, {
        id: notifRef.id, userId: admin.id, type: 'escalation',
        message: `URGENT ESCALATION: Service Issue for ${client?.name || 'Guest'} at ${safeTicketId(appointment.id)}`,
        link: `/pos?checkout_id=${appointment.id}`, createdAt: now, read: false,
      });
    });
    try {
      await batch.commit();
      toast({ title: 'Manager Notified', description: 'Escalation sequence initiated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Escalation Failed' });
    } finally { setIsEscalating(false); }
  };

  const handleResolveEscalation = async () => {
    if (!firestore || !tenantId || !appointment?.id) return;
    setIsResolving(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, appointment.id);
    batch.update(appointmentRef, { isEscalated: false, resolutionNotes: resolutionNote, resolvedAt: now, resolvedBy: currentUser?.uid });
    if (appointment.isWalkIn) {
      const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, String(appointment.id).replace('apt-walkin-', ''));
      batch.update(walkInRef, { isEscalated: false });
    }
    try {
      await batch.commit();
      toast({ title: 'Escalation Resolved' });
      setResolutionNote('');
    } catch {
      toast({ variant: 'destructive', title: 'Resolution Failed' });
    } finally { setIsResolving(false); }
  };

  const signedConsentsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !client?.id) return null;
    return collection(firestore, `tenants/${tenantId}/clients/${client.id}/signedConsents`);
  }, [firestore, tenantId, client?.id]);
  const { data: signedConsents } = useCollection<any>(signedConsentsQuery);

  const complianceInfo = useMemo(() => {
    if (!service || !consentForms) {
      return { requiredForms: [], pendingForms: [], healthPendingForms: [], otherPendingForms: [], allCertified: true };
    }
    const requiredIds   = service.requiredFormIds || [];
    const requiredForms = (consentForms || []).filter(f => requiredIds.includes(f.id));
    const aptSignedIds  = (appointment?.signedForms || []).map((f: any) => f.formId);
    const pendingForms  = requiredForms.filter(rf =>
      !signedConsents?.some(sc => sc.formId === rf.id) && !aptSignedIds.includes(rf.id)
    );
    const healthPendingForms = pendingForms.filter(f => f.category === 'Intake');
    const otherPendingForms  = pendingForms.filter(f => f.category !== 'Intake');
    return { requiredForms, pendingForms, healthPendingForms, otherPendingForms, allCertified: pendingForms.length === 0 };
  }, [service, consentForms, signedConsents, appointment?.signedForms]);

  const { availableCredits, totalAvailable: totalStoreCreditAvailable } = useStoreCredit(client);

  const { hasDeposit: hasLiveDeposit, isLoadingDeposit: isLoadingLiveDeposit } = useDepositCredit(
    appointment?.clientId,
    client?.email,
    tenantId,
    true,
  );

  const cardSecured = !!(appointment?.cardOnFileSecured || client?.cardOnFile?.token || client?.cardOnFile?.paymentMethodId);

  const depositOwedCents = safeNumber(appointment?.depositAmountCents);
  const depositUnpaid = depositOwedCents > 0 && appointment?.depositStatus !== 'paid' && !hasLiveDeposit && !isLoadingLiveDeposit;
  const depositActuallyMissing = !!appointment?.readinessFlags?.depositRequired && depositUnpaid;
  const canCollectDepositNow = !!appointment && appointment.status !== 'cancelled' && cardSecured && depositUnpaid;

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    try {
      const isCompleted = appointment.status === 'completed';
      const addOns = (appointment.addOnIds || [])
        .map((id: string) => (allServices || []).find((s) => s.id === id))
        .filter((s): s is Service => !!s);
      const allServicesInApt = [service, ...addOns];
      const assignedStaffMember = (staff || []).find((s) => s.id === appointment.staffId);
      const productCost = allServicesInApt.flatMap((s) => s?.products || []).reduce((acc: number, p: any) => {
        const product = (inventory || []).find((i) => i.id === p.id);
        if (!product) return acc;
        let costPerBaseUnit = 0;
        if (product.costingMethod === 'size' && product.size) costPerBaseUnit = (product.costPerUnit || 0) / product.size;
        else if (product.costingMethod === 'uses' && product.estimatedUses) costPerBaseUnit = (product.costPerUnit || 0) / product.estimatedUses;
        else costPerBaseUnit = product.costPerUnit || 0;
        return acc + costPerBaseUnit * (p.quantityUsed || 1);
      }, 0);
      const start = safeDate(appointment.actualStartTime || appointment.startTime);
      const end   = safeDate(appointment.actualEndTime   || appointment.endTime);
      const actualDuration = appointment.actualEndTime
        ? differenceInMinutes(end, start)
        : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
      const timeCost    = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * (tmhr || 0);
      const breakEven   = timeCost + productCost;
      const baseRevenue = allServicesInApt.reduce((acc, s) => {
        const tierPrice = s.serviceTiers?.find((t: any) => t.tierId === assignedStaffMember?.pricingTierId)?.price;
        return acc + (tierPrice ?? s.price ?? 0);
      }, 0);
      const adjustmentCharge = safeNumber(appointment.checkoutState?.additionalCharge);
      const revenue = isCompleted
        ? (transactions || []).filter((t: any) => t.appointmentId === appointment.id && t.category === 'Service Revenue').reduce((acc: number, t: any) => acc + t.amount, 0)
        : baseRevenue;
      return { revenue, breakEven, profit: revenue - breakEven, adjustmentCharge };
    } catch {
      return { revenue: 0, breakEven: 0, profit: 0, adjustmentCharge: 0 };
    }
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      const update = () => {
        const diff = differenceInSeconds(new Date(), startTime);
        const h    = Math.floor(diff / 3600);
        const m    = Math.floor((diff % 3600) / 60);
        const s    = diff % 60;
        setElapsedTime(h > 0
          ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
          : `${m}:${String(s).padStart(2,'0')}`);
        setIsRunningOver(Math.floor(diff / 60) > (service?.duration || 0));
      };
      update();
      timer = setInterval(update, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  const handleAddAndConfigureConfirm = (selectedAddOns: Service[], configs: any) => {
    if (!firestore || !tenantId || !appointment?.id) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
    const currentCheckoutState = appointment.checkoutState || {};
    const newStaffOverrides    = { ...(currentCheckoutState.serviceStaffOverrides || {}) };
    const newConcurrentIds     = [...(currentCheckoutState.concurrentServiceIds || [])];
    selectedAddOns.forEach((s) => {
      const config = configs[s.id];
      if (config) {
        newStaffOverrides[s.id] = config.staffId;
        if (config.isConcurrent) newConcurrentIds.push(s.id);
      }
    });
    updateDocumentNonBlocking(appointmentRef, {
      addOnIds: selectedAddOns.map(s => s.id),
      checkoutState: {
        ...currentCheckoutState,
        serviceStaffOverrides: newStaffOverrides,
        concurrentServiceIds: Array.from(new Set(newConcurrentIds)),
      },
    });
    setIsAddAndConfigureOpen(false);
  };

  const handleCopyLink = useCallback(() => {
    if (appointment?.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({ title: 'Link Copied' });
    }
  }, [appointment?.checkInToken, toast]);

  const handleMarkupSave = (markedUpUrl: string) => {
    if (!firestore || !tenantId || !appointment?.id) return;
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { inspirationPhotoUrl: markedUpUrl });
    toast({ title: 'Technical Mapping Archived' });
  };

  const handleSendRequirements = async () => {
    if (!firestore || !tenantId || !appointment?.id || !service) return;
    if (!client?.email) {
      toast({ variant: 'destructive', title: 'Email needed', description: 'Add an email to this client first.' });
      return;
    }
    setReqSending(true);
    try {
      const token  = nanoid();
      const price  = service.serviceTiers?.find((t: any) => t.tierId === (staff || []).find((s: any) => s.id === appointment.staffId)?.pricingTierId)?.price ?? service.price ?? 0;
      const depositCents = (() => {
        try {
          return computeDepositCents({ service, price, depositsLive: selectedTenant?.depositsLive === true });
        } catch { return 0; }
      })();
      const requiredFormIds = service.requiredFormIds || [];
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const batch = writeBatch(firestore);

      batch.set(doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), {
        token, tenantId, appointmentId: appointment.id, clientId: client.id,
        clientName: client.name, clientEmail: String(client.email).toLowerCase().trim(),
        serviceId: service.id, serviceName: service.name,
        depositAmountCents: depositCents,
        requiredConsentFormIds: requiredFormIds,
        skipCardStep: !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token),
        cardAlreadyOnFile: !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token),
        fileRequirements: requestPhotos
          ? [{ id: 'inspo', type: 'file_upload', label: 'Inspiration photos', required: true, prompt: 'Share your inspiration photos', minCount: 1, maxCount: 5, acceptedTypes: ['image/*'] }]
          : [],
        status: 'pending', createdAt: new Date().toISOString(), expiresAt,
      });

      batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), {
        completionStatus: 'pending', depositAmountCents: depositCents,
      });

      const auditRef = doc(collection(firestore, `tenants/${tenantId}/completionRequests`));
      batch.set(auditRef, {
        id: auditRef.id, tenantId, appointmentId: appointment.id,
        clientId: client.id, clientName: client.name, token,
        requested: { deposit: depositCents > 0, card: true, consentForms: requiredFormIds.length, photos: requestPhotos },
        depositAmountCents: depositCents, channel: 'link', status: 'sent',
        source: 'appointment_details', requestedBy: currentUser?.uid || null,
        requestedAt: new Date().toISOString(), expiresAt,
      });

      await batch.commit();
      const link = `${window.location.origin}/complete/${tenantId}/${token}`;
      setReqLink(link);

      try {
        await fetch('/api/notifications/send-completion-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link, clientName: client.name, clientEmail: client.email, clientPhone: client.phone, studioName: selectedTenant?.name }),
        });
      } catch {}

      toast({ title: 'Requirements sent', description: 'Secure link generated and sent to the client.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send', description: e?.message || 'Unknown error' });
    } finally { setReqSending(false); }
  };

  const handleCollectDepositNow = async () => {
    if (!firestore || !tenantId || !appointment?.id || !client?.id || !service) return;
    setIsCollectingDeposit(true);
    try {
      const staffIdForPricing = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
      const staffForPricing = (staff || []).find((s: any) => s.id === staffIdForPricing);
      const price = service.serviceTiers?.find((t: any) => t.tierId === staffForPricing?.pricingTierId)?.price ?? service.price ?? 0;
      const depositCents = depositOwedCents > 0
        ? depositOwedCents
        : (() => {
            try { return computeDepositCents({ service, price, depositsLive: selectedTenant?.depositsLive === true }); }
            catch { return 0; }
          })();

      if (!depositCents || depositCents <= 0) {
        toast({ variant: 'destructive', title: 'No deposit amount set', description: 'Set a deposit on this service or appointment first.' });
        return;
      }

      const res = await fetch('/api/stripe/charge-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          clientId: client.id,
          amountCents: depositCents,
          description: `Deposit — ${service.name}`,
          category: 'Retainers',
          appointmentId: appointment.id,
          reason: 'Deposit collection (card on file)',
          mode: 'pos',
        }),
      });
      const out = await res.json().catch(() => null);

      if (!out?.ok) {
        if (out?.requiresAction) {
          toast({ variant: 'destructive', title: 'Card needs verification', description: out.reason || 'Ask the client to verify their card.' });
        } else {
          toast({ variant: 'destructive', title: 'Could not collect deposit', description: out?.reason || 'Card charge failed.' });
        }
        return;
      }

      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), {
        depositStatus: 'paid',
        depositAmountCents: depositCents,
        depositStripePaymentIntentId: out.paymentIntentId,
      });
      const creditRef = doc(collection(firestore, `tenants/${tenantId}/depositCredits`));
      batch.set(creditRef, {
        id: creditRef.id,
        tenantId,
        clientId: client.id,
        clientEmail: String(client.email || '').toLowerCase().trim(),
        clientName: client.name || 'Client',
        amountCents: depositCents,
        status: 'available',
        sourceAppointmentId: appointment.id,
        createdAt: new Date().toISOString(),
        stripeChargeId: out.paymentIntentId,
      });
      await batch.commit();

      toast({ title: 'Deposit collected', description: `$${(depositCents / 100).toFixed(2)} charged to the card on file.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not collect deposit', description: e?.message || 'Unknown error' });
    } finally {
      setIsCollectingDeposit(false);
    }
  };

  // ── Process or skip a pending deposit refund (Tier 2) ──────────────────────
  // Mirrors the exact choice already used at POS checkout (refund vs. keep as
  // credit) — surfaced here so a cancelled appointment with a pending refund
  // decision doesn't just sit unresolved until someone happens to look at the
  // notification.
  const handleProcessPendingRefund = async () => {
    if (!latestDepositDecision || !tenantId || !firestore) return;
    setIsProcessingRefund(true);
    try {
      const res = await fetch('/api/stripe/deposit-refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, creditId: latestDepositDecision.creditId }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out?.ok) {
        toast({ variant: 'destructive', title: 'Refund failed', description: out?.error || 'Could not refund the deposit.' });
        return;
      }
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), {
        depositDisposition: 'refunded',
        depositRefunded: true,
        depositRefundedAt: new Date().toISOString(),
        depositRefundedAmountCents: Math.round(safeNumber(latestDepositDecision.amountDollars) * 100),
      });
      batch.update(doc(firestore, `tenants/${tenantId}/depositDecisions`, latestDepositDecision.id), {
        outcome: 'refunded', resolvedAt: new Date().toISOString(), resolvedBy: currentUser?.uid || 'staff',
      });
      await batch.commit();
      toast({ title: 'Deposit refunded', description: `$${safeNumber(latestDepositDecision.amountDollars).toFixed(2)} returned to ${client?.name || 'the client'}.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Refund failed', description: e?.message || 'Unknown error' });
    } finally {
      setIsProcessingRefund(false);
    }
  };

  const handleKeepAsCredit = async () => {
    if (!latestDepositDecision || !tenantId || !firestore) return;
    setIsProcessingRefund(true);
    try {
      await updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/depositDecisions`, latestDepositDecision.id), {
        outcome: 'kept_as_credit', resolvedAt: new Date().toISOString(), resolvedBy: currentUser?.uid || 'staff',
      });
      toast({ title: 'Kept as store credit', description: 'The deposit remains available toward a future visit.' });
    } finally {
      setIsProcessingRefund(false);
    }
  };

  // ── All hooks done — safe to early-return now ──────────────────────────────
  if (!mounted || !open || !appointment || !client || !service) return null;

  const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
  const ticketId           = safeTicketId(appointment.id);
  const mainStaffId        = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
  const mainStaffMember    = (staff || []).find((s: Staff) => s.id === mainStaffId);
  const reqFiles           = appointment.requirementFiles || [];
  const isCancelled        = appointment.status === 'cancelled';
  const isCompleted        = appointment.status === 'completed';
  const outstandingBalance = safeNumber(client.outstandingBalance);
  const adjustmentCharge   = financialData?.adjustmentCharge ?? 0;

  const canStart  = appointment.status === 'confirmed';
  const canFinish = appointment.status === 'servicing';
  const startDisabled = !!(
    complianceInfo.healthPendingForms.length > 0 ||
    complianceInfo.otherPendingForms.length > 0 ||
    depositActuallyMissing
  );

  // Source / booking-channel badge — was previously invisible anywhere in the sheet.
  const SourceIcon = appointment.source === 'online' ? Globe : appointment.isWalkIn || appointment.source === 'walk-in' ? MapPin : Edit;
  const sourceLabel = appointment.source === 'online' ? 'Online Booking' : appointment.isWalkIn || appointment.source === 'walk-in' ? 'Walk-In' : 'Manual Entry';

  const statusLabel: Record<string, string> = {
    confirmed: 'Confirmed', deposit_pending: 'Awaiting Deposit', ready_for_checkout: 'Ready for Checkout',
    servicing: 'In Session', completed: 'Completed', cancelled: 'Cancelled',
  };

  // Click-to-contact: phone/email/profile were static text before — staff
  // had to copy a number out by hand to call or text a client. Avatar and
  // name now link straight to the client profile (the explicit "View
  // Profile" action elsewhere stays as the unambiguous nav option, this is
  // just a faster path from the dossier itself). Phone is a tel: link with
  // its own adjacent sms: icon for texting; email is a mailto: link. Email
  // was present in the original sheet (owner/admin only) and got dropped in
  // the layout pass — restored here, visible to everyone since it's no more
  // sensitive than the phone number sitting right next to it.
  const IdentityHeader = (
    <div className="flex items-center gap-3.5">
      <Link href={`/clients/${client.id}`} className="shrink-0 transition-opacity hover:opacity-80">
        <Avatar className="w-12 h-12 border-3 border-background shadow-lg rounded-2xl shrink-0">
          <AvatarImage src={client.avatarUrl} className="object-cover" />
          <AvatarFallback className="text-base font-black bg-primary/10 text-primary uppercase">
            {(client?.name || 'G').substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/clients/${client.id}`} className="hover:underline">
            <h2 className="font-black uppercase tracking-tighter text-slate-900 truncate text-lg leading-none">{client.name}</h2>
          </Link>
          {client.activeMembershipId && <Badge className="h-[18px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-indigo-600 text-white border-none shrink-0"><Award className="w-2 h-2 mr-0.5" />Member</Badge>}
          {client.status === 'banned' && <Badge className="h-[18px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-black text-white border-none shrink-0"><Ban className="w-2 h-2 mr-0.5" />Banned</Badge>}
          {client.hasOpenDispute && <Badge className="h-[18px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-purple-600 text-white border-none shrink-0"><AlertTriangle className="w-2 h-2 mr-0.5" />Dispute</Badge>}
          <StoreCreditBadge credits={Array.isArray(availableCredits) ? availableCredits : []} totalAvailable={totalStoreCreditAvailable} />
        </div>
        <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
          {client.phone && (
            <span className="flex items-center gap-1 shrink-0">
              <a href={`tel:${client.phone}`} className="text-[9px] font-bold text-primary uppercase tracking-widest truncate flex items-center gap-1 hover:underline">
                <Phone className="w-2.5 h-2.5" /> {safeFormatPhone(client.phone)}
              </a>
              <a href={`sms:${client.phone}`} title="Text" className="text-primary/40 hover:text-primary transition-colors">
                <MessageSquare className="w-3 h-3" />
              </a>
            </span>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="text-[9px] font-bold text-primary uppercase tracking-widest truncate flex items-center gap-1 hover:underline min-w-0 max-w-[160px]">
              <Mail className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{client.email}</span>
            </a>
          )}
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-50 shrink-0">
            #{ticketId}
          </p>
        </div>
      </div>
      <Badge variant="outline" className={cn(
        'h-6 px-2.5 rounded-full font-black uppercase text-[8px] tracking-widest border-2 shrink-0',
        isCancelled ? 'border-destructive/30 text-destructive bg-destructive/5'
        : isCompleted ? 'border-green-300 text-green-700 bg-green-50'
        : canFinish ? 'border-primary/30 text-primary bg-primary/5'
        : 'border-muted text-muted-foreground'
      )}>
        {statusLabel[appointment.status] || appointment.status}
      </Badge>
    </div>
  );

  const SheetBody = (
    <ScrollArea className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-5 md:p-8 pb-6">

        {isCancelled
          ? <CancellationRecord
              appointment={appointment} transactions={transactions} staff={staff || []}
              cancellationEvent={cancellationEvent} depositDecision={latestDepositDecision}
              onProcessRefund={handleProcessPendingRefund} onKeepAsCredit={handleKeepAsCredit}
              isProcessingRefund={isProcessingRefund}
            />
          : isCompleted
            ? <CompletionReceipt appointment={appointment} transactions={transactions} staff={staff || []} />
            : <ReadinessBanner
                appointment={appointment} client={client} complianceInfo={complianceInfo}
                hasDeposit={hasLiveDeposit} isLoadingDeposit={isLoadingLiveDeposit} cardSecured={cardSecured}
              />}

        {appointment.status === 'servicing' && elapsedTime && (
          <div className={cn('rounded-2xl border-4 text-center p-4 transition-all', isRunningOver ? 'bg-destructive/5 border-destructive animate-pulse' : 'bg-primary/5 border-primary/20')}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-1">Live Session Time</p>
            <p className={cn('font-black font-mono tracking-tighter text-4xl', isRunningOver ? 'text-destructive' : 'text-primary')}>{elapsedTime}</p>
          </div>
        )}

        {safeNumber(appointment.rescheduleCount) > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border-2 border-blue-200 text-[9px] font-bold uppercase text-blue-700">
            <RefreshCw className="w-3 h-3 shrink-0" />
            <span>
              Rescheduled {appointment.rescheduleCount}×
              {appointment.lastRescheduledAt && ` · moved ${format(safeDate(appointment.lastRescheduledAt), 'MMM d, h:mm a')}`}
              {appointment.lastRescheduledBy && ` by ${staffName(appointment.lastRescheduledBy, staff)}`}
            </span>
          </div>
        )}

        <Card className="rounded-[1.5rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-700 tracking-tight">
                <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                {format(safeDate(appointment.startTime), 'EEE, MMM d · h:mm a')}
                {appointment.rescheduledFromTime && (
                  <span className="text-[9px] font-bold text-muted-foreground line-through opacity-50">
                    {format(safeDate(appointment.rescheduledFromTime), 'MMM d, h:mm a')}
                  </span>
                )}
              </div>
              <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 shrink-0">
                <SourceIcon className="w-3 h-3" /> {sourceLabel}
              </span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="font-black text-base uppercase tracking-tight text-slate-900 truncate leading-tight">{service.name}</p>
                <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                  <Clock className="w-2.5 h-2.5" /> {service.duration}m
                  {(appointment.addOnIds || []).length > 0 && (
                    <span className="opacity-60">· {(appointment.addOnIds || []).length} add-on{(appointment.addOnIds || []).length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-dashed border-primary/10">
                  <Avatar className="h-5 w-5 border shadow-sm">
                    <AvatarImage src={mainStaffMember?.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(mainStaffMember?.name || 'S')[0]}</AvatarFallback>
                  </Avatar>
                  <span className="text-[9px] font-black uppercase text-primary tracking-widest truncate">{mainStaffMember?.name || 'Unassigned'}</span>
                </div>
              </div>
              <p className="text-2xl font-black text-primary tracking-tighter font-mono shrink-0">${(financialData?.revenue ?? 0).toFixed(2)}</p>
            </div>
            {(appointment.addOnIds || []).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-dashed">
                {(appointment.addOnIds || []).map((id: string) => {
                  const s = (allServices || []).find((svc) => svc.id === id);
                  if (!s) return null;
                  return (
                    <div key={id} className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground bg-white p-2 rounded-lg border border-muted/20">
                      <span className="truncate flex items-center gap-2"><Sparkles className="w-3 h-3" /> {s.name}</span>
                      <span className="shrink-0 text-primary font-mono">${(s.price ?? 0).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {!isCancelled && (
              <Button variant="ghost" size="sm" onClick={() => setIsAddAndConfigureOpen(true)} className="h-7 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 w-fit">
                <PlusCircle className="w-3 h-3 mr-1" /> Add Part
              </Button>
            )}
          </CardContent>
        </Card>

        {!isCancelled && !isCompleted && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
              <DollarSign className="w-3 h-3" /> Financial Summary
            </h3>
            <div className="rounded-2xl border-2 bg-white shadow-inner divide-y divide-dashed divide-muted/30 px-4">
              <RequirementRow
                icon={<Wallet className="w-3.5 h-3.5" />}
                label="Deposit"
                status={appointment.depositStatus === 'paid' ? 'good' : depositOwedCents > 0 ? 'bad' : 'neutral'}
                value={
                  appointment.depositStatus === 'paid'
                    ? `Paid $${(depositOwedCents / 100).toFixed(2)}`
                    : depositOwedCents > 0
                      ? `Due $${(depositOwedCents / 100).toFixed(2)}`
                      : '—'
                }
                action={canCollectDepositNow && (
                  <Button
                    size="sm"
                    onClick={handleCollectDepositNow}
                    disabled={isCollectingDeposit}
                    className="h-7 px-2.5 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-md shadow-primary/20"
                  >
                    {isCollectingDeposit ? <Loader className="w-3 h-3 animate-spin" /> : <><CreditCard className="w-3 h-3 mr-1" />Collect Now</>}
                  </Button>
                )}
              />
              <RequirementRow
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
                label="Card on File"
                status={cardSecured ? 'good' : 'neutral'}
                value={cardSecured ? 'Secured' : 'Not on file'}
              />
              {outstandingBalance > 0 && (
                <RequirementRow
                  icon={<AlertTriangle className="w-3.5 h-3.5" />}
                  label="Outstanding Balance"
                  status="bad"
                  value={`$${outstandingBalance.toFixed(2)}`}
                />
              )}
              {adjustmentCharge > 0 && (
                <RequirementRow
                  icon={<Scale className="w-3.5 h-3.5" />}
                  label="Adjustment Fee"
                  status="warn"
                  value={`$${adjustmentCharge.toFixed(2)} at checkout`}
                />
              )}
              <div className="py-2">
                <StoreCreditSection client={client} />
              </div>
            </div>
            {canCollectDepositNow && (
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60 leading-relaxed pl-1">
                Card on file but no deposit was collected — charge it now instead of waiting on a link.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Requirements & Intake</h3>
            <Badge className={cn(
              'text-[8px] font-black uppercase h-5 px-2 border-none text-white shadow-sm',
              appointment.completionStatus === 'complete' ? 'bg-green-500'
              : appointment.completionStatus === 'pending' ? 'bg-amber-500'
              : 'bg-slate-400'
            )}>
              {appointment.completionStatus === 'complete'
                ? <><CheckCircle2 className="w-2 h-2 mr-1" /> Complete</>
                : appointment.completionStatus === 'pending'
                  ? <><Clock className="w-2 h-2 mr-1" /> Awaiting Client</>
                  : 'None Requested'}
            </Badge>
          </div>

          {complianceInfo.healthPendingForms.length > 0 && (
            <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-3.5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-red-700 flex items-center gap-1.5">
                <HeartPulse className="w-3 h-3" /> Health Disclosure Required
              </p>
              {complianceInfo.healthPendingForms.map(f => (
                <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-red-700 bg-white/70 p-2 rounded-lg border border-red-200">
                  <span className="flex items-center gap-2 truncate"><FileSignature className="w-3 h-3 opacity-50" /> {f.title}</span>
                  <span className="shrink-0 ml-4 opacity-70">Unsigned</span>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 rounded-2xl bg-muted/10 border-2 space-y-1 shadow-inner divide-y divide-dashed divide-muted/30">
            {complianceInfo.otherPendingForms.map(f => (
              <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-amber-700 py-2">
                <span className="flex items-center gap-2 truncate"><FileSignature className="w-3 h-3 opacity-40" /> {f.title}</span>
                <span className="shrink-0 ml-4">Required</span>
              </div>
            ))}
            {complianceInfo.allCertified && (
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-green-600 py-1">
                <CheckCircle2 className="w-3 h-3" /> All consent forms signed
              </div>
            )}
            <div className="pt-2">
              <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10" onClick={handleCopyLink}>
                <LinkIcon className="w-3 h-3 mr-2" /> Dispatch Guest Link
              </Button>
            </div>

            {reqFiles.map((rf: any) => (
              <div key={rf.requirementId} className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-[10px] font-black uppercase">
                  <span className="flex items-center gap-2 text-muted-foreground"><FileImage className="w-3 h-3 opacity-40" /> {rf.label || 'Files'}</span>
                  <span className="text-green-600">{(rf.files || []).length} received</span>
                </div>
                {(rf.files || []).length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {(rf.files || []).map((f: any, i: number) => (
                      /\.(png|jpe?g|gif|webp)$/i.test(f.name || '')
                        ? <button key={i} onClick={() => setExpandedImage(f.url)} className="relative aspect-square rounded-lg overflow-hidden border bg-muted/5 cursor-zoom-in">
                            <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                          </button>
                        : <a key={i} href={f.url} target="_blank" rel="noreferrer" className="flex items-center justify-center aspect-square rounded-lg border bg-muted/5 text-[8px] p-1 text-center text-muted-foreground break-all">{f.name}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {!reqLink ? (
              !isRequestOpen ? (
                <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10 mt-1" onClick={() => setIsRequestOpen(true)}>
                  <ArrowRight className="w-3 h-3 mr-2" /> Request from Client
                </Button>
              ) : (
                <div className="space-y-3 pt-2">
                  <button type="button" onClick={() => setRequestPhotos(v => !v)} className={cn('w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all', requestPhotos ? 'border-primary bg-primary/5' : 'border-border bg-white')}>
                    <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><FileImage className="w-3.5 h-3.5 text-primary" /> Request inspo photos</span>
                    <div className={cn('w-9 h-5 rounded-full relative transition-colors shrink-0', requestPhotos ? 'bg-primary' : 'bg-slate-200')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', requestPhotos ? 'left-[18px]' : 'left-0.5')} />
                    </div>
                  </button>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60 leading-relaxed">
                    Sends a secure link for deposit & card on file{(service.requiredFormIds || []).length > 0 ? ', consent forms' : ''}{requestPhotos ? ', and inspiration photos' : ''}.
                    {cardSecured ? ' Card already on file — form step only.' : ''}
                  </p>
                  <Button onClick={handleSendRequirements} disabled={reqSending} className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    {reqSending ? <Loader className="w-4 h-4 animate-spin" /> : 'Generate & Send Link'}
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <input readOnly value={reqLink} onFocus={e => e.currentTarget.select()} className="flex-1 h-10 rounded-xl border-2 px-3 text-[10px] font-mono bg-white" />
                  <Button onClick={() => { navigator.clipboard.writeText(reqLink!); setReqCopied(true); setTimeout(() => setReqCopied(false), 2000); }} className="h-10 px-3 rounded-xl font-black uppercase text-[9px] tracking-widest shrink-0">
                    {reqCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[9px] font-black text-green-600 uppercase tracking-tight">Sent to {client.name} · valid 7 days</p>
              </div>
            )}
          </div>
        </div>

        {appointment.inspirationPhotoUrl && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Inspiration & Mapping</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsMarkupOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                <Edit className="w-3 h-3 mr-1.5" /> Markup Tool
              </Button>
            </div>
            <div className="relative aspect-video w-full rounded-[2rem] overflow-hidden border-2 border-primary/10 bg-muted/5 group shadow-inner cursor-zoom-in" onClick={() => setExpandedImage(appointment.inspirationPhotoUrl)}>
              <NextImage src={appointment.inspirationPhotoUrl} alt="Inspiration" fill className="object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="w-8 h-8 text-white" />
              </div>
              <div className="absolute top-4 right-4">
                <Badge className="bg-primary/90 backdrop-blur-md text-white border-none font-black text-[8px] uppercase h-6 px-3 shadow-xl">Guest Choice</Badge>
              </div>
            </div>
          </div>
        )}

        {/* ── Incident Report (Tier 3) — previously invisible anywhere in the sheet ── */}
        {appointment.incident && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Incident Report</h3>
            <div className={cn(
              'rounded-2xl border-2 p-4 space-y-2.5',
              appointment.incident.severity === 'Severe' ? 'bg-red-50 border-red-300'
              : appointment.incident.severity === 'Moderate' ? 'bg-amber-50 border-amber-300'
              : 'bg-slate-50 border-slate-200'
            )}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wide flex items-center gap-2 text-slate-800">
                  <AlertCircle className="w-3.5 h-3.5" /> {appointment.incident.type}
                </span>
                <Badge className={cn(
                  'text-[8px] font-black uppercase border-none text-white shrink-0',
                  appointment.incident.severity === 'Severe' ? 'bg-red-600'
                  : appointment.incident.severity === 'Moderate' ? 'bg-amber-600'
                  : 'bg-slate-500'
                )}>
                  {appointment.incident.severity}
                </Badge>
              </div>
              {appointment.incident.date && (
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
                  {format(safeDate(appointment.incident.date), 'MMM d, yyyy · h:mm a')}
                </p>
              )}
              <p className="text-[10px] font-medium text-slate-700 leading-relaxed">{appointment.incident.description}</p>
              {appointment.incident.actionsTaken && (
                <p className="text-[9px] font-bold uppercase text-muted-foreground">
                  <span className="opacity-60">Action taken: </span>{appointment.incident.actionsTaken}
                </p>
              )}
              {appointment.incident.photoUrls && appointment.incident.photoUrls.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {appointment.incident.photoUrls.map((url: string, i: number) => (
                    <button key={i} onClick={() => setExpandedImage(url)} className="relative aspect-square rounded-lg overflow-hidden border bg-white cursor-zoom-in">
                      <img src={url} alt="Incident documentation" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Dossier Intelligence</h3>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="pref-notes" className="border-2 rounded-2xl overflow-hidden bg-muted/5 mb-2 shadow-inner">
              <AccordionTrigger className="px-4 py-3 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                <Sparkles className="w-3.5 h-3.5 mr-2 opacity-40" /> Preferences & Notes
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
                {client.notes?.goals && (
                  <div className="space-y-1">
                    <p className="text-[8px] font-black uppercase text-primary/60">Strategic Goals</p>
                    <p className="text-[10px] font-medium leading-relaxed italic">"{client.notes.goals}"</p>
                  </div>
                )}
                {client.sensoryNeeds && (
                  <div className="space-y-1">
                    <p className="text-[8px] font-black uppercase text-blue-600/60">Sensory Needs</p>
                    <p className="text-[10px] font-medium leading-relaxed italic">"{client.sensoryNeeds}"</p>
                  </div>
                )}
                {client.notes?.history && (
                  <div className="space-y-1">
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">History Alert</p>
                    <p className="text-[10px] font-medium leading-relaxed italic">"{client.notes.history}"</p>
                  </div>
                )}
                {!client.notes?.goals && !client.sensoryNeeds && !client.notes?.history && (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-2">No preference data archived</p>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="prev-formulas" className="border-2 rounded-2xl overflow-hidden bg-muted/5 shadow-inner">
              <AccordionTrigger className="px-4 py-3 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                <FlaskConical className="w-3.5 h-3.5 mr-2 opacity-40" /> Technical Formulas
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                {client.customFormulas && client.customFormulas.length > 0 ? (
                  <div className="grid gap-2">
                    {client.customFormulas.map((f: any) => (
                      <div key={f.id} className="p-3 rounded-xl bg-white border-2 border-transparent hover:border-primary/10 transition-all flex justify-between items-center shadow-sm">
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-tight truncate block">{f.name}</span>
                          <span className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(f.date), 'MMM d, yyyy')}</span>
                        </div>
                        <ArrowRight className="w-3 h-3 text-primary opacity-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-2">No historical formulas found</p>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="space-y-3">
          {appointment.isEscalated ? (
            <div className="flex flex-col gap-4 p-5 rounded-[2rem] border-4 bg-destructive text-white border-destructive shadow-xl shadow-destructive/20">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-sm font-black uppercase tracking-tight flex items-center gap-2 text-white">
                    <ShieldAlert className="w-4 h-4" /> Priority Escalated
                  </Label>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">Manager dispatch active</p>
                </div>
                <Button variant="secondary" size="icon" className="h-12 w-12 rounded-2xl shadow-xl" disabled>
                  <CheckCircle2 className="w-6 h-6" />
                </Button>
              </div>
              {isOwnerOrAdminUser && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4 pt-4 border-t border-white/20">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-white/60 ml-1">Resolution Protocol Summary</Label>
                    <Textarea
                      value={resolutionNote}
                      onChange={e => setResolutionNote(e.target.value)}
                      placeholder="Detail the manager intervention..."
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/40 min-h-[80px] rounded-xl focus-visible:ring-white/20"
                    />
                  </div>
                  <Button
                    onClick={handleResolveEscalation}
                    disabled={isResolving || !resolutionNote.trim()}
                    className="w-full h-12 bg-white text-destructive hover:bg-white/90 rounded-xl font-black uppercase text-[10px] tracking-widest"
                  >
                    {isResolving ? <Loader className="animate-spin" /> : 'Certify Resolution & Clear Alert'}
                  </Button>
                </motion.div>
              )}
            </div>
          ) : (
            <>
              {/* Resolved-escalation trace (Tier 3) — previously vanished entirely
                  once isEscalated flipped back to false; the resolution note and
                  who handled it are worth keeping visible, not discarding. */}
              {appointment.resolutionNotes && (
                <div className="rounded-xl border-2 border-muted/30 bg-muted/5 p-3.5 space-y-1">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-500" /> Escalation resolved
                    {appointment.resolvedAt && ` · ${format(safeDate(appointment.resolvedAt), 'MMM d, h:mm a')}`}
                    {appointment.resolvedBy && ` · ${staffName(appointment.resolvedBy, staff)}`}
                  </p>
                  <p className="text-[10px] font-medium text-slate-600 leading-relaxed">{appointment.resolutionNotes}</p>
                </div>
              )}
              <button
                onClick={handleEscalate}
                disabled={isEscalating}
                className="w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border-2 border-destructive/15 bg-destructive/[0.02] hover:bg-destructive/5 transition-all text-left"
              >
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-widest text-destructive/70">
                  <ShieldAlert className="w-3.5 h-3.5" /> Report an issue / escalate to manager
                </span>
                {isEscalating ? <Loader className="w-3.5 h-3.5 animate-spin text-destructive/50" /> : <ArrowRight className="w-3.5 h-3.5 text-destructive/30" />}
              </button>
            </>
          )}
        </div>

      </div>
    </ScrollArea>
  );

  const ActionBar = (
    <div className="border-t bg-white/95 backdrop-blur-md flex-shrink-0 p-4 md:px-8 flex items-center gap-3">
      {canStart && (
        <Button
          onClick={() => onStartService(appointment.id)}
          disabled={startDisabled}
          className="flex-1 h-12 rounded-2xl font-black uppercase shadow-xl shadow-primary/20"
        >
          <Play className="mr-2 h-4 w-4" /> Start Session
        </Button>
      )}
      {canFinish && (
        <Button onClick={() => onFinishService(appointment)} className="flex-1 h-12 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
          <Square className="mr-2 h-4 w-4" /> Finish Service
        </Button>
      )}
      {isCancelled && (
        <Button onClick={() => onRebook?.(appointment)} className="flex-1 h-12 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
          <Undo2 className="mr-2 h-4 w-4" /> Rebook
        </Button>
      )}
      {!canStart && !canFinish && !isCancelled && (
        <Button variant="outline" className="flex-1 h-12 rounded-2xl font-bold uppercase border-2" asChild>
          <Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-4 w-4" /> View Profile</Link>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-12 w-12 rounded-2xl border-2 shrink-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-2xl border-2 w-56">
          <DropdownMenuItem asChild className="font-bold uppercase text-[10px] tracking-wide">
            <Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-3.5 w-3.5" /> View Profile</Link>
          </DropdownMenuItem>
          {!isCancelled && (
            <DropdownMenuItem onClick={() => setIsRescheduleOpen(true)} className="font-bold uppercase text-[10px] tracking-wide">
              <CalendarClock className="mr-2 h-3.5 w-3.5" /> Reschedule
            </DropdownMenuItem>
          )}
          {!isCancelled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { onOpenChange(false); onCancel(appointment.id, !!appointment.isWalkIn); }}
                className="font-bold uppercase text-[10px] tracking-wide text-destructive focus:text-destructive"
              >
                <AlertTriangle className="mr-2 h-3.5 w-3.5" /> Cancel Appointment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'flex flex-col p-0 border-none bg-background shadow-2xl overflow-hidden',
            isMobile ? 'h-[92dvh] rounded-t-[2.5rem] w-full' : 'sm:max-w-xl'
          )}
        >
          <SheetHeader className="border-b bg-muted/5 flex-shrink-0 p-5 md:p-6">
            {isMobile && <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mb-3" />}
            <SheetTitle className="sr-only">Session Details for {client.name}</SheetTitle>
            <SheetDescription className="sr-only">Appointment {ticketId}</SheetDescription>
            {IdentityHeader}
          </SheetHeader>
          {SheetBody}
          {ActionBar}
        </SheetContent>
      </Sheet>

      <AddAndConfigurePartsDialog
        open={isAddAndConfigureOpen}
        onOpenChange={setIsAddAndConfigureOpen}
        onConfirm={handleAddAndConfigureConfirm}
        allAddOns={(allServices || []).filter(s => s.type === 'addon' && (service?.compatibleAddOnIds || []).includes(s.id))}
        initialSelected={currentAddOns}
        staff={staff || []}
        defaultStaffId={appointment.staffId || ''}
      />

      <RescheduleAppointmentDialog
        open={isRescheduleOpen}
        onOpenChange={setIsRescheduleOpen}
        appointment={appointment}
        client={client}
        tenant={selectedTenant}
        tenantId={tenantId}
        actorName={currentUser?.displayName || 'Staff'}
        actorId={currentUser?.uid || 'system'}
        isMobile={isMobile}
        onRescheduled={() => onOpenChange(false)}
      />

      {appointment.inspirationPhotoUrl && isMarkupOpen && (
        <ImageMarkupDialog
          open={isMarkupOpen}
          onOpenChange={setIsMarkupOpen}
          imageUrl={appointment.inspirationPhotoUrl}
          onSave={handleMarkupSave}
          title={`Mapping for ${client.name}`}
        />
      )}

      <Dialog open={!!expandedImage} onOpenChange={(val) => !val && setExpandedImage(null)}>
        <DialogContent className="max-w-fit p-0 border-none bg-transparent shadow-none overflow-hidden flex items-center justify-center">
          <DialogHeader className="sr-only">
            <DialogTitle>Inspiration Image</DialogTitle>
            <DialogDescription>Full screen preview</DialogDescription>
          </DialogHeader>
          <div className="relative rounded-[2.5rem] overflow-hidden border-4 border-white/20 shadow-2xl bg-black/40 backdrop-blur-xl max-w-[95vw] max-h-[95vh]">
            {expandedImage && <img src={expandedImage} alt="Expanded" className="block max-w-full max-h-[90vh] object-contain" />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};