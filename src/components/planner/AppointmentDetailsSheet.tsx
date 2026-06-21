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
  CreditCard,
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
import { type Appointment, type Client, type Service, type Staff, AppointmentCheckoutState, ConsentForm } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, increment, writeBatch, arrayUnion, deleteField } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { AddAndConfigurePartsDialog } from './AddAndConfigurePartsDialog';
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

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const safeFormatPhone = (phone: any): string => {
  if (!phone || typeof phone !== 'string') return String(phone || '');
  try { return formatPhoneNumber(phone) || phone; } catch { return phone; }
};

// Guarded ticket-id formatter: never throws regardless of what appointment.id is.
const safeTicketId = (id: any): string => {
  if (typeof id === 'string' && id.length > 0) return id.slice(-6).toUpperCase();
  if (typeof id === 'number') return String(id).slice(-6).toUpperCase();
  return 'N/A';
};

// ─── Cancellation Record ────────────────────────────────────────────────────────
// Shown in place of the ReadinessBanner once an appointment is cancelled —
// readiness checks (deposit, forms, card) are meaningless for a cancelled
// session. This is the only place in the POS/Planner flow that surfaces
// who cancelled, why, what fee applied, and what happened to the deposit;
// previously a cancelled appointment looked identical to any other once you
// opened this sheet, with no record of any of that.
const CancellationRecord = ({ appointment }: { appointment: any }) => {
  const audit = appointment?.cancellationAudit;
  if (!audit) {
    return (
      <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-muted/10 border-2 border-border">
        <Ban className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Cancelled — no further detail on file
        </p>
      </div>
    );
  }

  const actorLabel =
    audit.actorType === 'studio' ? 'Studio / Staff' :
    audit.actorType === 'no_show' ? 'No-Show (automatic)' :
    'Client';

  const reasonText = (audit.studioReason || audit.clientReason || audit.reason || '')
    .toString().replace(/_/g, ' ');

  const feeLabel = audit.feeWaived
    ? 'Fee waived'
    : safeNumber(audit.feeAmount) > 0
    ? `Fee charged: $${safeNumber(audit.feeAmount).toFixed(2)}`
    : 'No fee';

  const depositLabel =
    appointment.depositDisposition === 'refunded' ? 'Deposit refunded to card' :
    appointment.depositDisposition === 'store_credit' ? 'Deposit converted to store credit' :
    appointment.depositDisposition === 'forfeited' ? 'Deposit forfeited' :
    null;

  return (
    <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/20 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Ban className="w-5 h-5 text-destructive shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-destructive leading-tight">
            Cancelled by {actorLabel}
          </p>
          {audit.timestamp && (
            <p className="text-[9px] font-bold text-destructive/60 uppercase tracking-wide">
              {format(safeDate(audit.timestamp), 'MMM d, yyyy · h:mm a')}
            </p>
          )}
        </div>
      </div>
      {reasonText && (
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed pl-7">
          {reasonText}{audit.reasonDetail ? ` — "${audit.reasonDetail}"` : ''}
        </p>
      )}
      <div className="flex items-center justify-between pl-7 pt-1 border-t border-dashed border-destructive/10">
        <span className={cn(
          'text-[9px] font-black uppercase tracking-widest',
          audit.feeWaived ? 'text-green-600' : safeNumber(audit.feeAmount) > 0 ? 'text-amber-600' : 'text-muted-foreground opacity-50'
        )}>
          {feeLabel}
        </span>
        {depositLabel && (
          <span className="text-[9px] font-black uppercase tracking-widest text-primary/70">{depositLabel}</span>
        )}
      </div>
    </div>
  );
};

// ─── Readiness Banner ─────────────────────────────────────────────────────────
const ReadinessBanner = ({
  appointment, client, complianceInfo,
}: {
  appointment: any;
  client: any;
  complianceInfo: { pendingForms: any[]; allCertified: boolean };
}) => {
  const { availableCredits, totalAvailable: totalStoreCreditAvailable } = useStoreCredit(client);
  const flags      = appointment?.readinessFlags || {};
  const hasBan     = client?.status === 'banned';
  const hasDispute = client?.hasOpenDispute === true;
  const hasAllergy = !!(client?.allergyNotes || client?.medicalNotes);

  const blockers = [
    hasBan     && { level: 'banned',  msg: `Banned — ${client?.banMessage || 'No service permitted'}` },
    hasDispute && { level: 'dispute', msg: `Open chargeback dispute on file — verify before service` },
    flags.healthGateActive && { level: 'danger', msg: `Health disclosure required before any product is applied` },
    hasAllergy && {
      level: 'allergy',
      msg: [
        client.allergyNotes ? `Allergy: ${client.allergyNotes}` : '',
        client.medicalNotes ? `Medical: ${client.medicalNotes}` : '',
      ].filter(Boolean).join(' · '),
    },
    flags.formGateActive && { level: 'danger', msg: `Required consent form not signed — collect before starting` },
    !complianceInfo.allCertified && complianceInfo.pendingForms.length > 0 && {
      level: 'warn',
      msg: `${complianceInfo.pendingForms.length} consent form${complianceInfo.pendingForms.length !== 1 ? 's' : ''} not yet signed`,
    },
    flags.depositRequired && { level: 'danger', msg: `Deposit not received — cannot proceed` },
    flags.cardRequired    && { level: 'warn',   msg: `No card on file — collect at check-in` },
    flags.balanceRequired && { level: 'warn',   msg: `Outstanding $${Number(client?.outstandingBalance || 0).toFixed(2)} — settle at checkout` },
    flags.needsConsultationBuffer && { level: 'info', msg: `No reference photos — allow 15 min design consultation` },
  ].filter(Boolean) as { level: string; msg: string }[];

  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-green-50 border-2 border-green-200">
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
        <div key={i} className={cn('flex items-start gap-3 p-3.5 rounded-2xl border-2', BG[b.level])}>
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

  const appointment = useMemo(() => {
    if (!initialAppointment || !allAppointments) return initialAppointment;
    return allAppointments.find((a: any) => a.id === initialAppointment.id) || initialAppointment;
  }, [initialAppointment, allAppointments]);

  const currentAddOns = useMemo(() => {
    if (!appointment?.addOnIds || !allServices) return [];
    return appointment.addOnIds.map((id: string) => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
  }, [appointment?.addOnIds, allServices]);

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
    if (!service || !consentForms) return { requiredForms: [], pendingForms: [], allCertified: true };
    const requiredIds   = service.requiredFormIds || [];
    const requiredForms = (consentForms || []).filter(f => requiredIds.includes(f.id));
    const aptSignedIds  = (appointment?.signedForms || []).map((f: any) => f.formId);
    const pendingForms  = requiredForms.filter(rf =>
      !signedConsents?.some(sc => sc.formId === rf.id) && !aptSignedIds.includes(rf.id)
    );
    return { requiredForms, pendingForms, allCertified: pendingForms.length === 0 };
  }, [service, consentForms, signedConsents, appointment?.signedForms]);

  const { availableCredits, totalAvailable: totalStoreCreditAvailable } = useStoreCredit(client);

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

  // ── All hooks done — safe to early-return now ──────────────────────────────
  if (!mounted || !open || !appointment || !client || !service) return null;

  const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
  const ticketId           = safeTicketId(appointment.id);
  const mainStaffId        = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
  const mainStaffMember    = (staff || []).find((s: Staff) => s.id === mainStaffId);
  const cardSecured        = !!(appointment.cardOnFileSecured || client.cardOnFile?.token || client.cardOnFile?.paymentMethodId);
  const reqFiles           = appointment.requirementFiles || [];
  const isCancelled        = appointment.status === 'cancelled';

  // ── Sheet body ─────────────────────────────────────────────────────────────
  const SheetBody = (
    <ScrollArea className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-5 md:p-8 pb-16">

        {isCancelled ? <CancellationRecord appointment={appointment} /> : <ReadinessBanner appointment={appointment} client={client} complianceInfo={complianceInfo} />}

        {appointment.status === 'confirmed' && (
          <Button
            onClick={() => onStartService(appointment.id)}
            className="w-full h-14 rounded-2xl font-black uppercase shadow-2xl shadow-primary/20"
            size="lg"
            disabled={!!(appointment.readinessFlags?.healthGateActive || appointment.readinessFlags?.formGateActive || appointment.readinessFlags?.depositRequired)}
          >
            <Play className="mr-3 h-5 w-5" /> Start Session
          </Button>
        )}

        {appointment.status === 'servicing' && (
          <div className="space-y-4">
            <Button onClick={() => onFinishService(appointment)} className="w-full h-14 rounded-2xl font-black uppercase shadow-2xl shadow-primary/20" size="lg">
              <Square className="mr-3 h-5 w-5" /> Finish Service
            </Button>
            {elapsedTime && (
              <div className={cn('rounded-2xl border-4 text-center p-4 transition-all', isRunningOver ? 'bg-destructive/5 border-destructive animate-pulse' : 'bg-primary/5 border-primary/20')}>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-1">Live Session Time</p>
                <p className={cn('font-black font-mono tracking-tighter text-4xl', isRunningOver ? 'text-destructive' : 'text-primary')}>{elapsedTime}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Client info ── */}
        <div className="flex items-center gap-4">
          <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-[1.5rem] shrink-0">
            <AvatarImage src={client.avatarUrl} className="object-cover" />
            <AvatarFallback className="text-xl font-black bg-primary/10 text-primary uppercase">
              {(client?.name || 'G').substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1 flex-1 min-w-0">
            <h2 className="font-black uppercase tracking-tighter text-slate-900 truncate text-xl">{client.name}</h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest border-2">
                <UserIcon className="w-2.5 h-2.5 mr-1 opacity-40" /> Guest
              </Badge>
              {client.activeMembershipId && (
                <Badge className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest bg-indigo-600 text-white border-none">
                  <Award className="w-2.5 h-2.5 mr-1" /> Member
                </Badge>
              )}
              {client.status === 'banned' && (
                <Badge className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest bg-black text-white border-none">
                  <Ban className="w-2.5 h-2.5 mr-1" /> Banned
                </Badge>
              )}
              {client.hasOpenDispute && (
                <Badge className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest bg-purple-600 text-white border-none">
                  <AlertTriangle className="w-2.5 h-2.5 mr-1" /> Dispute
                </Badge>
              )}
              <StoreCreditBadge
                credits={availableCredits}
                totalAvailable={totalStoreCreditAvailable}
              />
            </div>
            {isOwnerOrAdminUser && (
              <div className="flex flex-col gap-0.5 pt-1">
                {client.email && (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest truncate flex items-center gap-1.5">
                    <Mail className="w-3 h-3 opacity-40" /> {client.email}
                  </p>
                )}
                {client.phone && (
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest truncate flex items-center gap-1.5">
                    <Phone className="w-3 h-3 opacity-40" /> {safeFormatPhone(client.phone)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Compliance ── */}
        <div className="space-y-3 pt-4 border-t border-dashed">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Compliance & Digital Intake</h3>
          <div className="p-4 rounded-2xl bg-muted/10 border-2 space-y-3 shadow-inner">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase text-muted-foreground">Certified Status</span>
              <Badge variant="outline" className={cn('text-[8px] font-black uppercase h-5 px-2 border-none shadow-sm text-white', complianceInfo.allCertified ? 'bg-green-500' : 'bg-amber-500')}>
                {complianceInfo.allCertified
                  ? <><CheckCircle2 className="w-2 h-2 mr-1" /> Protocol Certified</>
                  : <><Clock className="w-2 h-2 mr-1" /> Signature Pending</>}
              </Badge>
            </div>
            {complianceInfo.pendingForms.map(f => (
              <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-amber-700 bg-amber-50/50 p-2 rounded-lg border border-amber-200">
                <span className="flex items-center gap-2 truncate"><FileSignature className="w-3 h-3 opacity-40" /> {f.title}</span>
                <span className="shrink-0 ml-4">Required</span>
              </div>
            ))}
            <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10" onClick={handleCopyLink}>
              <LinkIcon className="w-3 h-3 mr-2" /> Dispatch Guest Link
            </Button>
          </div>
        </div>

        {/* ── Client Requirements ── */}
        <div className="space-y-3 pt-4 border-t border-dashed">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Client Requirements</h3>
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
          <div className="p-4 rounded-2xl bg-muted/10 border-2 space-y-2.5 shadow-inner">
            <div className="flex items-center justify-between text-[10px] font-black uppercase">
              <span className="flex items-center gap-2 text-muted-foreground"><Wallet className="w-3 h-3 opacity-40" /> Deposit</span>
              <span className={cn(
                appointment.depositStatus === 'paid' ? 'text-green-600'
                : appointment.depositAmountCents ? 'text-amber-600'
                : 'text-muted-foreground opacity-50'
              )}>
                {appointment.depositStatus === 'paid'
                  ? `Paid $${((appointment.depositAmountCents || 0) / 100).toFixed(2)}`
                  : appointment.depositAmountCents
                    ? `Due $${(appointment.depositAmountCents / 100).toFixed(2)}`
                    : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-black uppercase">
              <span className="flex items-center gap-2 text-muted-foreground"><ShieldCheck className="w-3 h-3 opacity-40" /> Card on File</span>
              <span className={cn(cardSecured ? 'text-green-600' : 'text-muted-foreground opacity-50')}>
                {cardSecured ? 'Secured' : 'Not on file'}
              </span>
            </div>
            <StoreCreditSection client={client} />
            {reqFiles.map((rf: any) => (
              <div key={rf.requirementId} className="space-y-2 pt-1.5 border-t border-dashed border-muted/40">
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
                <div className="space-y-3 pt-2 border-t border-dashed border-muted/40">
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
              <div className="space-y-2 pt-2 border-t border-dashed border-muted/40">
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

        {/* ── Inspiration photo ── */}
        {appointment.inspirationPhotoUrl && (
          <div className="space-y-3 pt-4 border-t border-dashed">
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

        {/* ── Dossier Intelligence ── */}
        <div className="space-y-3 pt-4 border-t border-dashed">
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

        {/* ── Escalation ── */}
        <div className="space-y-3 pt-4 border-t border-dashed">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-primary">Service Recovery & Escalation</h3>
            {selectedTenant?.escalationPolicy && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-[9px] font-black uppercase text-primary underline decoration-2 underline-offset-4">Standing Orders</button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px] p-4 rounded-2xl border-2 shadow-2xl bg-white">
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed">{selectedTenant.escalationPolicy}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className={cn(
            'flex flex-col gap-4 p-5 rounded-[2rem] border-4 transition-all shadow-xl',
            appointment.isEscalated
              ? 'bg-destructive text-white border-destructive shadow-destructive/20'
              : 'border-destructive/20 bg-destructive/[0.02] shadow-destructive/5'
          )}>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label className={cn('text-sm font-black uppercase tracking-tight flex items-center gap-2', appointment.isEscalated ? 'text-white' : 'text-destructive')}>
                  <ShieldAlert className="w-4 h-4" /> {appointment.isEscalated ? 'Priority Escalated' : 'Manager Escalation'}
                </Label>
                <p className={cn('text-[10px] font-bold uppercase tracking-widest', appointment.isEscalated ? 'text-white/80' : 'text-destructive/60')}>
                  {appointment.isEscalated ? 'Manager dispatch active' : 'Immediate technical or guest issue'}
                </p>
              </div>
              <Button
                variant={appointment.isEscalated ? 'secondary' : 'destructive'}
                size="icon"
                disabled={isEscalating}
                onClick={appointment.isEscalated ? undefined : handleEscalate}
                className={cn('h-14 w-14 rounded-2xl shadow-xl', !appointment.isEscalated && 'shadow-destructive/20 animate-pulse')}
              >
                {isEscalating ? <Loader className="animate-spin" /> : appointment.isEscalated ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
              </Button>
            </div>
            {appointment.isEscalated && isOwnerOrAdminUser && (
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
        </div>

        {/* ── Alerts ── */}
        {financialData && financialData.adjustmentCharge > 0 && (
          <Alert className="border-2 border-primary/20 bg-primary/[0.01] rounded-2xl p-5 shadow-sm">
            <Scale className="h-5 w-5 text-primary" />
            <AlertTitle className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-primary">Strategic Adjustment Fee</AlertTitle>
            <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase">
              This session includes <strong>${financialData.adjustmentCharge.toFixed(2)}</strong> in adjustments to be collected at checkout.
            </AlertDescription>
          </Alert>
        )}
        {safeNumber(client.outstandingBalance) > 0 && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-2xl p-5 shadow-sm">
            <Wallet className="h-5 w-5" />
            <AlertTitle className="text-[10px] font-black uppercase tracking-[0.2em] mb-2">Accounting Alert</AlertTitle>
            <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase">
              Client owes <strong>${Number(client.outstandingBalance).toFixed(2)}</strong>. Settle at checkout.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Action buttons ── */}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest" asChild>
            <Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-3.5 w-3.5" /> Profile</Link>
          </Button>
          {!isCancelled && (
            <Button variant="outline" className="h-12 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/5" onClick={() => { onOpenChange(false); onCancel(appointment.id, !!appointment.isWalkIn); }}>
              <AlertTriangle className="mr-2 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>

        <Separator className="bg-muted/50" />

        {/* ── Treatment details ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Treatment Details</h3>
            {!isCancelled && (
              <Button variant="ghost" size="sm" onClick={() => setIsAddAndConfigureOpen(true)} className="h-6 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                <PlusCircle className="w-3 h-3 mr-1" /> Add Part
              </Button>
            )}
          </div>
          <Card className="rounded-[1.5rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
            <CardContent className="p-4 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-tight">{service.name}</p>
                  <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                    <Clock className="w-2.5 h-2.5" /> {service.duration}m
                  </div>
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-primary/10">
                    <Avatar className="h-5 w-5 border shadow-sm">
                      <AvatarImage src={mainStaffMember?.avatarUrl} className="object-cover" />
                      <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(mainStaffMember?.name || 'S')[0]}</AvatarFallback>
                    </Avatar>
                    <span className="text-[9px] font-black uppercase text-primary tracking-widest truncate">{mainStaffMember?.name || 'Unassigned'}</span>
                  </div>
                </div>
                <p className="text-lg font-black text-primary tracking-tighter font-mono shrink-0">${(financialData?.revenue ?? 0).toFixed(2)}</p>
              </div>
              {(appointment.addOnIds || []).length > 0 && (
                <div className="space-y-3 pt-3 border-t border-dashed">
                  <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest opacity-40">Add-ons</p>
                  {(appointment.addOnIds || []).map((id: string) => {
                    const s = (allServices || []).find((svc) => svc.id === id);
                    if (!s) return null;
                    return (
                      <div key={id} className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground bg-muted/10 p-2 rounded-lg border border-muted/20">
                        <span className="truncate flex items-center gap-2"><Sparkles className="w-3 h-3" /> {s.name}</span>
                        <span className="shrink-0 text-primary font-mono">${(s.price ?? 0).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </ScrollArea>
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
          <SheetHeader className="border-b bg-muted/5 flex-shrink-0 p-5 md:p-8 md:pb-6">
            {isMobile && <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mb-3" />}
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Session Dossier</span>
            </div>
            <SheetTitle className="font-black uppercase tracking-tighter text-slate-900 leading-none text-xl md:text-3xl">
              Session Summary
            </SheetTitle>
            <SheetDescription className="text-[9px] font-bold uppercase tracking-widest opacity-60 mt-1">
              ID: {ticketId}
            </SheetDescription>
          </SheetHeader>
          {SheetBody}
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