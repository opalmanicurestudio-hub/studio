'use client';

/**
 * QuickBookForm — enhanced with:
 *   1. ClientIntelligencePanel (step 1) — insights, preferences, birthday perk
 *   2. SmartAvailabilityGrid (step 2) — pre-filtered slots + add-on upsell
 *   3. GroupBookingPanel (step 2) — multi-GUEST booking (separate clients,
 *      same time slot)
 *   4. Package redemption shortcut (step 3)
 *   5. Charge card on file (step 3) — when the client has a saved card, staff
 *      can charge the deposit immediately via /api/stripe/charge-card
 *      (mode: 'auto', kind: 'deposit'). On decline, the booking still goes
 *      through — falls back to the completion link so the client can
 *      re-authenticate / pay from their phone.
 *   6. Arrears banner (step 3) — if the client has an outstanding balance
 *      from a PAST appointment, staff must either collect it now
 *      (kind: 'arrears_fee', the original semantics) or explicitly override
 *      with a reason before the booking can be confirmed. Mirrors the
 *      actor/reason audit pattern already used for cancellations.
 *   7. Multi-provider legs (step 2) — the SAME client moving through
 *      multiple DIFFERENT services with different staff, sequentially
 *      (e.g. color with Stylist A, then style with Stylist B). Each leg is
 *      its OWN appointment document chained by multiProviderGroupId, so the
 *      planner calendar renders each provider's real time block correctly
 *      with no changes to planner code. Distinct from GroupBookingPanel,
 *      which is concurrent guests under separate client identities.
 *
 * Drop-in replacement for the existing QuickBookForm in page.tsx.
 * All props are identical to the original.
 */

import React from 'react';
import { format, addMinutes } from 'date-fns';
import { doc, writeBatch, collection } from 'firebase/firestore';
import { getServicePrice } from '@/lib/data';
import { computeDepositCents } from '@/lib/deposit-policy';
import { nanoid } from 'nanoid';
import { cn, safeNumber } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ChevronLeft, ChevronRight, XCircle, UserPlus, ArrowRight,
  CheckCircle2, ShieldCheck, Sparkles, Loader, Copy, Link2,
  Users, Package, Lock, CreditCard, AlertTriangle, Wallet, UserCog,
} from 'lucide-react';

import { useClientIntelligence } from '@/hooks/useClientIntelligence';
import { useSmartAvailability } from '@/hooks/useSmartAvailability';
import { ClientIntelligencePanel } from '@/components/pos/ClientIntelligencePanel';
import { SmartAvailabilityGrid } from '@/components/pos/SmartAvailabilityGrid';
import { GroupBookingPanel, isGroupValid, type GroupGuest } from '@/components/pos/GroupBookingPanel';
import { MultiProviderPanel, computeLegSchedule, isMultiProviderValid, type ProviderLeg } from '@/components/pos/MultiProviderPanel';

// ── Firestore sanitizer (same as page.tsx) ────────────────────────────────────
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj._methodName !== undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

// ── Arrears override reasons — mirrors the studio/client cancellation-reason
// pattern (CancellationAudit) so this has the same shape as other audited
// staff judgment calls in the system, rather than a free-text-only field.
const ARREARS_OVERRIDE_REASONS = [
  { value: 'will_collect_in_person', label: 'Will collect in person' },
  { value: 'manager_approved', label: 'Manager approved' },
  { value: 'dispute_in_progress', label: 'Dispute in progress' },
  { value: 'other', label: 'Other' },
] as const;

type Props = {
  clients: any[];
  services: any[];
  staff: any[];
  tenantId: string;
  tenant: any;
  firestore: any;
  appointments?: any[]; // pass appointmentsFromInventory for smart availability
  currentStaffId?: string; // for arrearsOverrideBy attribution
  onSuccess: () => void;
  onCancel: () => void;
};

export function QuickBookForm({
  clients, services, staff, tenantId, tenant, firestore, appointments = [], currentStaffId, onSuccess, onCancel,
}: Props) {
  const { toast } = useToast();

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = React.useState<1 | 2 | 3>(1);

  // Step 1
  const [clientSearch, setClientSearch] = React.useState('');
  const [selectedClient, setSelectedClient] = React.useState<any>(null);
  const [isNewClient, setIsNewClient] = React.useState(false);
  const [newClientName, setNewClientName] = React.useState('');
  const [newClientPhone, setNewClientPhone] = React.useState('');
  const [newClientEmail, setNewClientEmail] = React.useState('');

  // Step 2
  const [selectedService, setSelectedService] = React.useState('');
  const [addOnIds, setAddOnIds] = React.useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = React.useState('any');
  const [aptDate, setAptDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [aptTime, setAptTime] = React.useState(format(addMinutes(new Date(), 30), 'HH:mm'));
  const [isGroup, setIsGroup] = React.useState(false);
  const [groupGuests, setGroupGuests] = React.useState<GroupGuest[]>([]);
  // Multi-provider: sequential legs for the SAME client. Empty by default —
  // today's single-service flow is leg 0 (the fields above); this array
  // holds leg 1+.
  const [isMultiProvider, setIsMultiProvider] = React.useState(false);
  const [providerLegs, setProviderLegs] = React.useState<ProviderLeg[]>([]);

  // Step 3
  const [sendLink, setSendLink] = React.useState(true);
  const [requestFiles, setRequestFiles] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [redeemPackageId, setRedeemPackageId] = React.useState<string | null>(null);
  // Charge card on file now, instead of (or as a fallback to) sending a
  // completion link. Defaults on whenever a card is on file.
  const [chargeNow, setChargeNow] = React.useState(true);

  // Arrears (outstanding balance from a PAST appointment)
  const [isChargingArrears, setIsChargingArrears] = React.useState(false);
  const [arrearsResolved, setArrearsResolved] = React.useState(false); // cleared by a successful charge
  const [arrearsOverrideReason, setArrearsOverrideReason] = React.useState('');
  const [arrearsOverrideDetail, setArrearsOverrideDetail] = React.useState('');
  const [showArrearsOverride, setShowArrearsOverride] = React.useState(false);

  // Submit
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [generatedLink, setGeneratedLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [sendStatus, setSendStatus] = React.useState<any>(null);
  // Outcome of the charge-card-on-file attempt, shown on the success screen.
  const [chargeOutcome, setChargeOutcome] = React.useState<
    { charged: true; amountDollars: number } | { charged: false; reason: string } | null
  >(null);

  const searchRef = React.useRef<HTMLInputElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const recentClients = React.useMemo(() =>
    [...(clients || [])]
      .filter((c: any) => c.lastAppointment)
      .sort((a: any, b: any) => new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime())
      .slice(0, 6),
  [clients]);

  const filteredClients = React.useMemo(() => {
    if (!clientSearch.trim()) return [];
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) =>
      c.name?.toLowerCase().includes(s) || c.phone?.includes(s) || c.email?.toLowerCase().includes(s)
    ).slice(0, 8);
  }, [clients, clientSearch]);

  const selectedSvc = services.find((s: any) => s.id === selectedService);
  const resolvedStaffMember = staff.find((s: any) => s.id === selectedStaff);
  const svcPrice = selectedSvc ? getServicePrice(selectedSvc, resolvedStaffMember) : 0;
  const depositCents = selectedSvc
    ? computeDepositCents({ service: selectedSvc, price: svcPrice, depositsLive: tenant?.depositsLive === true })
    : 0;
  const requiredFormIds: string[] = selectedSvc?.requiredFormIds || [];
  const alreadyHasCard = !!selectedClient?.cardOnFile?.token || !!selectedClient?.cardOnFile?.paymentMethodId;
  // The charge-card route needs Stripe's customer + payment method ids, not
  // just "a card exists" — some older records only have a `token` (legacy
  // vaulting) without a usable customerId/paymentMethodId pair.
  const canChargeOnFile = !!selectedClient?.cardOnFile?.customerId && !!selectedClient?.cardOnFile?.paymentMethodId;
  const clientEmail = selectedClient?.email || newClientEmail;
  const lastService = services.find((s: any) => s.id === selectedClient?.lastServiceId);

  // Active packages for the selected client
  const activePackages: any[] = (selectedClient?.activePackages || []).filter(
    (p: any) => p.sessionsRemaining > 0,
  );

  // Outstanding balance from a PAST appointment (no-show / late-cancel fees,
  // etc. — see Client.outstandingBalance / unpaidFees). Cleared locally once
  // a charge-now succeeds in this session; re-derived from the client record
  // otherwise so switching clients always reflects the real balance.
  const outstandingBalance = safeNumber(selectedClient?.outstandingBalance);
  const hasUnresolvedArrears = outstandingBalance > 0 && !arrearsResolved;
  const canConfirmBooking = !hasUnresolvedArrears || !!arrearsOverrideReason;

  // ── Client intelligence ──────────────────────────────────────────────────
  const intel = useClientIntelligence(selectedClient, appointments, services);

  // ── Smart availability ───────────────────────────────────────────────────
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const nowTimeStr = format(addMinutes(new Date(), 5), 'HH:mm');
  const { slots, addOnUpsells } = useSmartAvailability({
    date: aptDate,
    serviceId: selectedService,
    staffId: selectedStaff,
    allAppointments: appointments,
    allServices: services,
    allStaff: staff,
    skipSlotsBefore: aptDate === todayStr ? nowTimeStr : undefined,
  });

  // ── Multi-provider derived schedule + totals ────────────────────────────
  const primaryStartTimeForLegs = React.useMemo(
    () => new Date(`${aptDate}T${aptTime}:00`),
    [aptDate, aptTime],
  );
  const scheduledLegs = React.useMemo(
    () => isMultiProvider
      ? computeLegSchedule(providerLegs, services, primaryStartTimeForLegs, selectedService)
      : [],
    [isMultiProvider, providerLegs, services, primaryStartTimeForLegs, selectedService],
  );
  const legsTotal = scheduledLegs.reduce((acc, leg) => {
    const svc = services.find((s: any) => s.id === leg.serviceId);
    const staffMember = staff.find((s: any) => s.id === leg.staffId);
    return acc + (svc ? getServicePrice(svc, staffMember) : 0);
  }, 0);

  // ── Toggle add-on ────────────────────────────────────────────────────────
  const toggleAddOn = (serviceId: string) => {
    setAddOnIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId],
    );
  };

  React.useEffect(() => { if (requiredFormIds.length > 0) setSendLink(true); }, [requiredFormIds.length]);
  React.useEffect(() => { if (step === 1) setTimeout(() => searchRef.current?.focus(), 80); }, [step]);
  // Reset arrears UI state whenever the client changes, so a resolved/
  // overridden balance from a previous client never leaks onto the next one.
  React.useEffect(() => {
    setArrearsResolved(false);
    setArrearsOverrideReason('');
    setArrearsOverrideDetail('');
    setShowArrearsOverride(false);
  }, [selectedClient?.id]);

  const selectClient = (c: any) => {
    setSelectedClient(c);
    setIsNewClient(false);
    setClientSearch('');
    if (c.lastServiceId) setSelectedService(c.lastServiceId);
    setStep(2);
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    try { await navigator.clipboard.writeText(generatedLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast({ variant: 'destructive', title: 'Copy failed' }); }
  };

  // ── Charge outstanding arrears right now (kind: 'arrears_fee' — the
  // ORIGINAL charge-card semantics: failure parks/flags as before) ─────────
  const handleChargeArrears = async () => {
    if (!selectedClient || outstandingBalance <= 0) return;
    setIsChargingArrears(true);
    try {
      const res = await fetch('/api/stripe/charge-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          clientId: selectedClient.id,
          amountCents: Math.round(outstandingBalance * 100),
          description: 'Outstanding balance',
          category: 'Service Revenue',
          reason: 'Front desk collection at next booking',
          mode: 'auto',
          kind: 'arrears_fee',
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, reason: 'Charge request failed' }));
      if (data.ok) {
        setArrearsResolved(true);
        toast({ title: 'Balance collected', description: `$${outstandingBalance.toFixed(2)} charged to card on file.` });
      } else {
        toast({ variant: 'destructive', title: 'Charge failed', description: data.reason || 'Could not charge card on file.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Could not reach payment processor.' });
    } finally {
      setIsChargingArrears(false);
    }
  };

  // ── Book ─────────────────────────────────────────────────────────────────
  const handleBook = async () => {
    const clientName = selectedClient?.name || newClientName.trim();
    if (!selectedService || !tenantId || !firestore) return;
    if (!selectedClient && !newClientName.trim()) { toast({ variant: 'destructive', title: 'Client name required' }); return; }
    if (isGroup && !isGroupValid(groupGuests)) { toast({ variant: 'destructive', title: 'All guests need a name and service.' }); return; }
    if (isMultiProvider && !isMultiProviderValid(providerLegs)) { toast({ variant: 'destructive', title: 'Every additional provider needs a service and staff member.' }); return; }
    if (hasUnresolvedArrears && !arrearsOverrideReason) {
      toast({ variant: 'destructive', title: 'Outstanding balance', description: 'Collect the balance or choose a reason to book anyway.' });
      return;
    }

    // Will we actually attempt a card-on-file charge for this booking? Only
    // makes sense with a real card, a deposit/amount to collect, and the
    // staff toggle on. If true, we DON'T require an email up front — only
    // the link path needs one. Resolved here (not just read off state) so
    // the rest of handleBook and the email-required check below agree.
    const depositAndLegsTotalCents = depositCents; // deposit policy is computed off the PRIMARY service only — see note below
    const willChargeNow = canChargeOnFile && chargeNow && depositAndLegsTotalCents > 0;

    // The completion link still requires an email — but only if we're not
    // charging right now (a successful charge needs no link at all).
    if (!willChargeNow && sendLink && !clientEmail.trim()) {
      toast({ variant: 'destructive', title: 'Email required' });
      return;
    }

    setIsSubmitting(true);
    const { nanoid: _nanoid } = await import('nanoid');
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const groupBookingId = isGroup ? _nanoid() : null;
    const multiProviderGroupId = isMultiProvider && scheduledLegs.length > 0 ? _nanoid() : null;

    try {
      // Resolve / create client
      let clientId = selectedClient?.id;
      if (!clientId) {
        clientId = _nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
          id: clientId, name: clientName, phone: newClientPhone.trim(), email: newClientEmail.trim(),
          lifetimeValue: 0, lastAppointment: now, status: 'active', reminderSent: false,
        }));
      } else {
        const updates: any = {};
        if (newClientEmail.trim() && !selectedClient.email) updates.email = newClientEmail.trim();
        if (Object.keys(updates).length) batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), updates, { merge: true });
      }

      // Build primary appointment
      const aptId = _nanoid();
      const checkInToken = _nanoid();
      const startTime = new Date(`${aptDate}T${aptTime}:00`);
      const totalDuration = (selectedSvc?.duration || 60) +
        addOnIds.reduce((acc, id) => acc + (services.find((s: any) => s.id === id)?.duration || 0), 0);
      const endTime = addMinutes(startTime, totalDuration);
      const resolvedStaffId =
        selectedStaff === 'any' ? (staff.find((s: any) => s.active)?.id || null) : selectedStaff;

      // ── Charge card on file FIRST, before the appointment batch commits ──
      // /api/stripe/charge-card writes its own ledger entry directly to
      // Firestore (outside this batch) and needs a clientId that already
      // exists there. An existing selectedClient is fine; a brand-new client
      // doc is still sitting in `batch`, uncommitted — so for a new client we
      // commit the client doc on its own first, then charge, then commit the
      // appointment in a second batch.
      let effectiveSendLink = sendLink;
      let chargeResultForLedger: { paymentIntentId: string } | null = null;

      if (willChargeNow) {
        if (!selectedClient) {
          const clientBatch = writeBatch(firestore);
          clientBatch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
            id: clientId, name: clientName, phone: newClientPhone.trim(), email: newClientEmail.trim(),
            lifetimeValue: 0, lastAppointment: now, status: 'active', reminderSent: false,
          }));
          await clientBatch.commit();
        }

        try {
          const chargeRes = await fetch('/api/stripe/charge-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              clientId,
              amountCents: depositAndLegsTotalCents,
              description: `Deposit — ${selectedSvc?.name || 'Appointment'}${multiProviderGroupId ? ' + additional providers' : ''}`,
              category: 'Retainers',
              appointmentId: aptId,
              reason: 'Quick Book deposit',
              mode: 'auto',
              kind: 'deposit', // FIX: see charge-card route — no arrears side effects on decline
            }),
          });
          const chargeData = await chargeRes.json().catch(() => ({ ok: false, reason: 'Charge request failed' }));

          if (chargeData.ok) {
            chargeResultForLedger = { paymentIntentId: chargeData.paymentIntentId };
            effectiveSendLink = false; // no link needed — money's already in
            setChargeOutcome({ charged: true, amountDollars: chargeData.amount ?? depositAndLegsTotalCents / 100 });
          } else {
            effectiveSendLink = true;
            setChargeOutcome({ charged: false, reason: chargeData.reason || 'Card charge failed' });
            toast({
              variant: 'destructive',
              title: 'Card on file declined',
              description: `${chargeData.reason || 'Charge failed'} — sending a completion link instead.`,
            });
          }
        } catch {
          effectiveSendLink = true;
          setChargeOutcome({ charged: false, reason: 'Could not reach payment processor' });
          toast({
            variant: 'destructive',
            title: 'Card charge failed',
            description: 'Sending a completion link instead.',
          });
        }

        if (effectiveSendLink && !clientEmail.trim()) {
          toast({
            variant: 'destructive',
            title: 'No email on file',
            description: 'Charge failed and there is no email to send a completion link to. Booking with no payment collected — please follow up.',
          });
          effectiveSendLink = false;
        }
      }

      const aptDoc = sanitizeForFirestore({
        id: aptId, tenantId, clientId, clientName,
        serviceId: selectedService,
        addOnIds: addOnIds.length > 0 ? addOnIds : undefined,
        staffId: resolvedStaffId, checkInToken,
        status: 'confirmed', source: 'pos_quick_book',
        startTime: startTime.toISOString(), endTime: endTime.toISOString(),
        createdAt: now, reminderSent: false, autoCancelledNoShow: false,
        notes: notes.trim() || undefined,
        groupBookingId: groupBookingId || undefined,
        multiProviderGroupId: multiProviderGroupId || undefined,
        sequenceIndex: multiProviderGroupId ? 0 : undefined,
        ...(effectiveSendLink ? {
          completionStatus: 'pending',
          depositAmountCents: depositCents,
          depositStatus: depositCents > 0 ? 'pending' : 'none',
        } : {}),
        ...(chargeResultForLedger ? {
          depositAmountCents: depositCents,
          depositStatus: 'paid',
          depositPaymentIntentId: chargeResultForLedger.paymentIntentId,
        } : {}),
        ...(redeemPackageId ? { redeemedPackageId: redeemPackageId } : {}),
        // Arrears override audit trail — only present when an unresolved
        // balance existed and staff explicitly chose to proceed anyway.
        ...(hasUnresolvedArrears && arrearsOverrideReason ? {
          arrearsOverrideReason,
          arrearsOverrideDetail: arrearsOverrideDetail.trim() || undefined,
          arrearsOverrideBy: currentStaffId || undefined,
          arrearsOverrideAt: now,
          arrearsBalanceAtBooking: outstandingBalance,
        } : {}),
      });

      batch.set(doc(firestore, `tenants/${tenantId}/appointments`, aptId), aptDoc);
      batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), sanitizeForFirestore({ ...aptDoc, tenantId }));
      batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), {
        lastServiceId: selectedService, lastAppointment: now,
        ...(redeemPackageId ? {
          activePackages: (selectedClient?.activePackages || [])
            .map((p: any) => p.packageId === redeemPackageId ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p)
            .filter((p: any) => p.sessionsRemaining > 0),
        } : {}),
      }, { merge: true });

      // ── Multi-provider legs: one Appointment doc each, chained by
      // multiProviderGroupId + sequenceIndex. Each leg's own staffId/
      // serviceId/startTime/endTime makes it render correctly on the
      // planner calendar with zero planner changes. depositAppliesToBalance
      // is read from each leg's OWN service definition, same mechanism
      // CheckoutHub already uses for booth-renter passthrough deposits — no
      // new logic invented here, just applied per leg.
      if (multiProviderGroupId && scheduledLegs.length > 0) {
        scheduledLegs.forEach((leg, idx) => {
          const legSvc = services.find((s: any) => s.id === leg.serviceId);
          const legStaffId = leg.staffId === 'any' ? (staff.find((s: any) => s.active)?.id || null) : leg.staffId;
          const legId = _nanoid();
          const legToken = _nanoid();
          batch.set(doc(firestore, `tenants/${tenantId}/appointments`, legId), sanitizeForFirestore({
            id: legId, tenantId, clientId, clientName,
            serviceId: leg.serviceId,
            staffId: legStaffId,
            checkInToken: legToken,
            status: 'confirmed', source: 'pos_quick_book',
            startTime: leg.startTime.toISOString(), endTime: leg.endTime.toISOString(),
            createdAt: now, reminderSent: false, autoCancelledNoShow: false,
            multiProviderGroupId,
            sequenceIndex: idx + 1,
            notes: notes.trim() || undefined,
          }));
          batch.set(doc(firestore, 'appointmentCheckIns', legToken), sanitizeForFirestore({
            id: legId, tenantId, clientId, clientName,
            serviceId: leg.serviceId, staffId: legStaffId, checkInToken: legToken,
            status: 'confirmed', startTime: leg.startTime.toISOString(), endTime: leg.endTime.toISOString(),
            multiProviderGroupId, sequenceIndex: idx + 1,
          }));
        });
      }

      // Group guest appointments
      if (isGroup && groupGuests.length > 0) {
        for (const guest of groupGuests) {
          if (!guest.name.trim() || !guest.serviceId) continue;
          const gId = _nanoid();
          const gToken = _nanoid();
          const gSvc = services.find((s: any) => s.id === guest.serviceId);
          const gStaffId = guest.staffId === 'any' ? (staff.find((s: any) => s.active)?.id || null) : guest.staffId;
          const gEnd = addMinutes(startTime, gSvc?.duration || 60);
          batch.set(doc(firestore, `tenants/${tenantId}/appointments`, gId), sanitizeForFirestore({
            id: gId, tenantId, clientId: gId, clientName: guest.name,
            serviceId: guest.serviceId, staffId: gStaffId, checkInToken: gToken,
            status: 'confirmed', source: 'pos_quick_book_group',
            startTime: startTime.toISOString(), endTime: gEnd.toISOString(),
            createdAt: now, reminderSent: false, autoCancelledNoShow: false,
            groupBookingId: groupBookingId,
            isPrimaryGroup: false,
          }));
        }
      }

      // Completion link
      let link: string | null = null;
      if (effectiveSendLink) {
        const token = _nanoid();
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        batch.set(doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), sanitizeForFirestore({
          token, tenantId, appointmentId: aptId, clientId, clientName,
          clientEmail: clientEmail.trim().toLowerCase(),
          serviceId: selectedService, serviceName: selectedSvc?.name || '',
          depositAmountCents: depositCents,
          requiredConsentFormIds: requiredFormIds,
          skipCardStep: alreadyHasCard, cardAlreadyOnFile: alreadyHasCard,
          fileRequirements: requestFiles ? [{
            id: 'inspo', type: 'file_upload', label: 'Inspiration photos',
            required: true, prompt: 'Share your inspiration photos',
            minCount: 1, maxCount: 5, acceptedTypes: ['image/*'],
          }] : [],
          status: 'pending', createdAt: now, expiresAt,
        }));
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        link = `${origin}/complete/${tenantId}/${token}`;
      }

      await batch.commit();

      // ── Ledger entries for multi-provider legs ──────────────────────────
      // The deposit charge above is ONE PaymentIntent for the combined
      // total. Per the booth-renter / mixed-comp requirement, revenue must
      // still be attributable PER PROVIDER for payroll/rent reconciliation
      // — so post N ledger transactions here (one per leg, sharing the same
      // stripePaymentIntentId), mirroring how charge-card's own
      // writeLedger() splits a base amount from a surcharge into separate
      // lines rather than blending them. The actual Stripe processing fee
      // is attributed to the PRIMARY leg's entry only (via charge-card's
      // own writeLedger call above) — these per-leg entries do NOT add a
      // second fee line, which would double-count it.
      if (chargeResultForLedger && multiProviderGroupId && scheduledLegs.length > 0) {
        try {
          const ledgerBatch = writeBatch(firestore);
          scheduledLegs.forEach((leg) => {
            const legSvc = services.find((s: any) => s.id === leg.serviceId);
            const legStaffMember = staff.find((s: any) => s.id === leg.staffId);
            const legAmount = legSvc ? getServicePrice(legSvc, legStaffMember) : 0;
            if (legAmount <= 0) return;
            const legTxnId = `multiprovider_leg__${chargeResultForLedger!.paymentIntentId}__${leg.id}`;
            ledgerBatch.set(doc(firestore, `tenants/${tenantId}/transactions`, legTxnId), sanitizeForFirestore({
              id: legTxnId,
              date: now,
              description: `${legSvc?.name || 'Service'} (multi-provider leg)`,
              clientOrVendor: clientName,
              clientId,
              type: 'income',
              context: 'Business',
              category: 'Service Revenue',
              taxBucket: 'revenue',
              amount: legAmount,
              paymentMethod: 'Card on file (Stripe)',
              staffId: leg.staffId === 'any' ? undefined : leg.staffId,
              appointmentId: aptId,
              stripePaymentIntentId: chargeResultForLedger!.paymentIntentId,
              hasReceipt: true,
              tenantId,
            }));
          });
          await ledgerBatch.commit();
        } catch {
          // Non-fatal — the booking itself already succeeded. Surface so
          // staff know per-provider attribution may need a manual fix.
          toast({ title: 'Booked, but ledger attribution needs review', description: 'Per-provider revenue lines could not be written — check the Ledger page.' });
        }
      }

      if (link) {
        setGeneratedLink(link);
        const clientPhone = selectedClient?.phone || newClientPhone;
        try {
          const sr = await fetch('/api/notifications/send-completion-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link, clientName, clientEmail: clientEmail.trim(), clientPhone, studioName: tenant?.name }),
          });
          setSendStatus(await sr.json().catch(() => null));
        } catch { setSendStatus(null); }
        toast({ title: 'Booked!', description: `${clientName} · ${format(new Date(`${aptDate}T${aptTime}`), 'EEE MMM d · h:mm a')}` });
      } else {
        if (chargeResultForLedger) {
          toast({
            title: 'Booked & charged!',
            description: `${clientName} · $${(depositCents / 100).toFixed(2)} charged to card on file`,
          });
        }
        onSuccess();
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Booking Failed' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Step indicator ────────────────────────────────────────────────────────
  const StepDots = () => (
    <div className="flex items-center gap-2 mb-6">
      {([1, 2, 3] as const).map((n) => (
        <div key={n} className={cn('h-1.5 rounded-full transition-all duration-300',
          n === step ? 'flex-1 bg-primary' : n < step ? 'w-6 bg-primary/30' : 'flex-1 bg-slate-100')} />
      ))}
    </div>
  );

  // ── Arrears banner — shown in step 3, blocking-with-override ───────────────
  const ArrearsBanner = () => {
    if (!hasUnresolvedArrears) return null;
    return (
      <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-destructive">
              Outstanding balance: ${outstandingBalance.toFixed(2)}
            </p>
            <p className="text-[10px] text-destructive/70 font-medium mt-0.5">
              {selectedClient?.name?.split(' ')[0] || 'This client'} owes money from a previous visit. Collect it now, or confirm you want to book anyway.
            </p>
          </div>
        </div>

        {!showArrearsOverride ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={handleChargeArrears}
              disabled={isChargingArrears || !canChargeOnFile}
              className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest"
            >
              {isChargingArrears
                ? <Loader className="w-3.5 h-3.5 animate-spin" />
                : <><Wallet className="w-3.5 h-3.5 mr-1.5" /> Charge ${outstandingBalance.toFixed(2)} now</>}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowArrearsOverride(true)}
              className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
            >
              Book anyway
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <select
              value={arrearsOverrideReason}
              onChange={(e) => setArrearsOverrideReason(e.target.value)}
              className="w-full h-10 rounded-xl border-2 text-[11px] font-bold px-2 bg-white"
            >
              <option value="">Why book without collecting?</option>
              {ARREARS_OVERRIDE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {arrearsOverrideReason === 'other' && (
              <Input
                value={arrearsOverrideDetail}
                onChange={(e) => setArrearsOverrideDetail(e.target.value)}
                placeholder="Briefly explain"
                className="h-10 rounded-xl border-2 text-[11px]"
              />
            )}
            <button
              type="button"
              onClick={() => { setShowArrearsOverride(false); setArrearsOverrideReason(''); setArrearsOverrideDetail(''); }}
              className="text-[9px] font-black uppercase text-muted-foreground hover:text-primary"
            >
              ← Back
            </button>
          </div>
        )}

        {!canChargeOnFile && !showArrearsOverride && (
          <p className="text-[9px] font-bold text-destructive/60 uppercase">No usable card on file — choose "Book anyway" or collect another way first.</p>
        )}
      </div>
    );
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (generatedLink) {
    const firstName = (selectedClient?.name || newClientName).split(' ')[0];
    return (
      <div className="space-y-6">
        <div className="text-center space-y-3 pt-2">
          <div className="w-16 h-16 rounded-full bg-green-50 border-4 border-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <p className="text-lg font-black uppercase tracking-tight text-slate-900">{selectedClient?.name || newClientName} · Booked</p>
            <p className="text-xs font-bold text-muted-foreground mt-0.5">
              {selectedSvc?.name} · {format(new Date(`${aptDate}T${aptTime}`), 'EEE MMM d · h:mm a')}
              {isGroup && groupGuests.length > 0 && ` · Group of ${groupGuests.length + 1}`}
              {isMultiProvider && scheduledLegs.length > 0 && ` · ${scheduledLegs.length + 1} providers`}
            </p>
          </div>
        </div>

        {chargeOutcome && !chargeOutcome.charged && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Card on file declined</p>
              <p className="text-[10px] text-amber-700/80 font-medium mt-0.5">{chargeOutcome.reason} — sent a completion link below instead.</p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border-2 p-4 bg-muted/5 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Link2 className="w-3 h-3" /> Completion link · valid 7 days
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={generatedLink} onFocus={(e) => e.currentTarget.select()} className="h-11 rounded-xl border-2 text-[11px] font-mono bg-white" />
            <Button onClick={copyLink} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] shrink-0">
              {copied ? <><CheckCircle2 className="w-4 h-4 mr-1" />Copied</> : <><Copy className="w-4 h-4 mr-1" />Copy</>}
            </Button>
          </div>
          {sendStatus?.smsSent || sendStatus?.emailSent
            ? <p className="text-[10px] text-green-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Auto-sent {sendStatus.smsSent ? 'by text' : ''}{sendStatus.smsSent && sendStatus.emailSent ? ' & ' : ''}{sendStatus.emailSent ? 'by email' : ''}</p>
            : <p className="text-[10px] text-muted-foreground font-medium">Copy and send to {firstName} to secure their spot.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => {
            setStep(1); setSelectedClient(null); setSelectedService(''); setAddOnIds([]);
            setAptTime(format(addMinutes(new Date(), 15), 'HH:mm'));
            setGeneratedLink(null); setSendStatus(null); setNotes(''); setChargeOutcome(null);
            setIsNewClient(false); setNewClientName(''); setNewClientPhone(''); setNewClientEmail('');
            setIsGroup(false); setGroupGuests([]); setRedeemPackageId(null); setChargeNow(true);
            setIsMultiProvider(false); setProviderLegs([]);
            setArrearsResolved(false); setArrearsOverrideReason(''); setArrearsOverrideDetail(''); setShowArrearsOverride(false);
          }} variant="outline" className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
            Book Another
          </Button>
          <Button onClick={onSuccess} className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">Done</Button>
        </div>
      </div>
    );
  }

  // ── Step 1: Client ────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-5">
        <StepDots />
        {isNewClient ? (
          <div className="space-y-4">
            <button onClick={() => setIsNewClient(false)} className="text-[10px] font-black uppercase text-muted-foreground hover:text-primary flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" />Back
            </button>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">New Client</p>
            <Input autoFocus placeholder="Full name *" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className="h-12 rounded-xl border-2" />
            <Input placeholder="Phone number" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} className="h-12 rounded-xl border-2" type="tel" />
            <Input placeholder="Email (for link & receipt)" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} className="h-12 rounded-xl border-2" type="email" />
            <Button disabled={!newClientName.trim()} onClick={() => setStep(2)} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
              Continue → Pick Service
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Input ref={searchRef} placeholder="Search client by name, phone, email…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="h-12 rounded-xl border-2 pr-10" />
              {clientSearch && <button onClick={() => setClientSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><XCircle className="w-4 h-4" /></button>}
            </div>

            {filteredClients.length > 0 && (
              <div className="rounded-2xl border-2 divide-y overflow-hidden shadow-sm">
                {filteredClients.map((c: any) => (
                  <button key={c.id} onClick={() => selectClient(c)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors text-left group">
                    <div>
                      <p className="font-black text-sm text-slate-900">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">{c.phone || c.email || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {safeNumber(c.outstandingBalance) > 0 && <span className="text-[9px] font-black uppercase text-destructive bg-destructive/5 px-2 py-0.5 rounded-full">Owes ${safeNumber(c.outstandingBalance).toFixed(0)}</span>}
                      {c.lastServiceId && <span className="text-[9px] font-black uppercase text-primary/60 bg-primary/5 px-2 py-0.5 rounded-full">Rebook ready</span>}
                      {c.lifetimeValue > 0 && <span className="text-[9px] font-bold text-slate-400">${Math.round(c.lifetimeValue)}</span>}
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-80" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {clientSearch && filteredClients.length === 0 && (
              <button onClick={() => { setNewClientName(clientSearch); setIsNewClient(true); }} className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all text-left">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><UserPlus className="w-4 h-4 text-primary" /></div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-primary">Create "{clientSearch}"</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase">New client · add details next</p>
                </div>
              </button>
            )}

            {!clientSearch && recentClients.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Recent Clients</p>
                <div className="grid grid-cols-2 gap-2">
                  {recentClients.map((c: any) => (
                    <button key={c.id} onClick={() => selectClient(c)} className="flex items-center gap-3 p-3 rounded-2xl border-2 border-muted/50 hover:border-primary/30 hover:bg-primary/5 transition-all text-left group">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 text-[11px] font-black text-slate-500">{c.name?.charAt(0)?.toUpperCase()}</div>
                      <div className="min-w-0">
                        <p className="font-black text-[11px] text-slate-900 truncate">{c.name}</p>
                        {c.lastAppointment && <p className="text-[9px] text-muted-foreground">{format(new Date(c.lastAppointment), 'MMM d')}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!clientSearch && (
              <button onClick={() => setIsNewClient(true)} className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 border-dashed border-muted hover:border-primary/30 hover:bg-primary/5 transition-all text-left">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"><UserPlus className="w-4 h-4 text-slate-400" /></div>
                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">New Client</p>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Step 2: Service + Provider + Time ─────────────────────────────────────
  if (step === 2) {
    const activeStaff = staff.filter((s: any) => s.active);
    return (
      <div className="space-y-5">
        <StepDots />

        {/* Client pill */}
        <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/5 border-2 border-primary/10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary">
              {(selectedClient?.name || newClientName).charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-[11px] font-black text-slate-900">{selectedClient?.name || newClientName}</p>
              {alreadyHasCard && <p className="text-[9px] text-green-600 font-bold">Card on file ✓</p>}
            </div>
          </div>
          <button onClick={() => { setStep(1); setSelectedService(''); }} className="text-[9px] font-black uppercase text-muted-foreground hover:text-primary">Change</button>
        </div>

        {/* Intelligence panel */}
        <ClientIntelligencePanel
          intel={intel}
          staff={staff}
          onActionClick={(insight) => {
            if (insight.actionData?.serviceId) setSelectedService(insight.actionData.serviceId as string);
          }}
        />

        {/* Rebook shortcut */}
        {lastService && (
          <button onClick={() => setSelectedService(lastService.id)} className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left', selectedService === lastService.id ? 'border-primary bg-primary/5' : 'border-amber-200 bg-amber-50 hover:border-amber-300')}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0"><ArrowRight className="w-3.5 h-3.5 text-amber-600" /></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Rebook last service</p>
                <p className="text-[11px] font-bold text-slate-900">{lastService.name} · {lastService.duration}m · ${getServicePrice(lastService, null)}</p>
              </div>
            </div>
            {selectedService === lastService.id && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
          </button>
        )}

        {/* Service list */}
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service</p>
          <div className="rounded-2xl border-2 divide-y overflow-hidden">
            {services.filter((s: any) => s.type === 'service').map((s: any) => {
              const price = getServicePrice(s, resolvedStaffMember);
              return (
                <button key={s.id} onClick={() => setSelectedService(s.id)} className={cn('w-full flex items-center justify-between px-4 py-3 text-left transition-colors', selectedService === s.id ? 'bg-primary/5' : 'hover:bg-muted/30')}>
                  <div>
                    <p className={cn('font-bold text-sm', selectedService === s.id ? 'text-primary' : 'text-slate-900')}>{s.name}</p>
                    <p className="text-[9px] text-muted-foreground">{s.duration}m</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-black text-sm text-slate-900">${price.toFixed(0)}</p>
                    {selectedService === s.id && <CheckCircle2 className="w-4 h-4 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Provider chips */}
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Provider</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSelectedStaff('any')} className={cn('px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase transition-all', selectedStaff === 'any' ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground hover:border-primary/30')}>Any</button>
            {activeStaff.map((s: any) => (
              <button key={s.id} onClick={() => setSelectedStaff(s.id)} className={cn('px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase transition-all', selectedStaff === s.id ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground hover:border-primary/30')}>
                {s.name.split(' ')[0]}
                {(s.status === 'idle' || s.status === 'available') && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
              </button>
            ))}
          </div>
        </div>

        {/* Smart availability grid */}
        {selectedService && (
          <SmartAvailabilityGrid
            slots={slots}
            addOnUpsells={addOnUpsells}
            selectedTime={aptTime}
            onSelectTime={(time, staffId) => {
              setAptTime(time);
              if (staffId && staffId !== selectedStaff) setSelectedStaff(staffId);
            }}
            addOnIds={addOnIds}
            onToggleAddOn={toggleAddOn}
            date={aptDate}
            onDateChange={setAptDate}
          />
        )}

        {/* Group booking toggle */}
        <button
          type="button"
          onClick={() => { setIsGroup((v) => !v); if (!isGroup && groupGuests.length === 0) setGroupGuests([{ id: 'g1', name: '', serviceId: selectedService, staffId: 'any' }]); }}
          className={cn('w-full rounded-2xl border-2 p-3.5 text-left transition-all', isGroup ? 'border-primary bg-primary/5' : 'border-border bg-white')}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-primary" />Group booking
            </p>
            <div className={cn('w-11 h-6 rounded-full shrink-0 transition-colors relative', isGroup ? 'bg-primary' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', isGroup ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>

        {isGroup && (
          <GroupBookingPanel
            primaryClient={selectedClient}
            primaryServiceId={selectedService}
            primaryStaffId={selectedStaff}
            services={services}
            staff={staff}
            guests={groupGuests}
            onChange={setGroupGuests}
          />
        )}

        {/* Multi-provider toggle — SAME client, different services/staff, sequential */}
        {!isGroup && selectedService && (
          <button
            type="button"
            onClick={() => { setIsMultiProvider((v) => !v); if (!isMultiProvider && providerLegs.length === 0) setProviderLegs([{ id: `leg_${Date.now()}`, serviceId: '', staffId: 'any' }]); }}
            className={cn('w-full rounded-2xl border-2 p-3.5 text-left transition-all', isMultiProvider ? 'border-primary bg-primary/5' : 'border-border bg-white')}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                  <UserCog className="w-3.5 h-3.5 text-primary" />Add another provider
                </p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">e.g. color, then a separate stylist for the cut</p>
              </div>
              <div className={cn('w-11 h-6 rounded-full shrink-0 transition-colors relative', isMultiProvider ? 'bg-primary' : 'bg-slate-200')}>
                <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', isMultiProvider ? 'left-[22px]' : 'left-0.5')} />
              </div>
            </div>
          </button>
        )}

        {isMultiProvider && selectedService && (
          <MultiProviderPanel
            legs={providerLegs}
            onChange={setProviderLegs}
            services={services}
            staff={staff}
            primaryStartTime={primaryStartTimeForLegs}
            primaryServiceId={selectedService}
            date={aptDate}
            allAppointments={appointments}
          />
        )}

        <div className="flex gap-3 pt-1">
          <Button onClick={() => setStep(1)} variant="outline" className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 px-5"><ChevronLeft className="w-4 h-4" /></Button>
          <Button disabled={!selectedService || !aptTime} onClick={() => setStep(3)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Review →</Button>
        </div>
      </div>
    );
  }

  // ── Step 3: Confirm ───────────────────────────────────────────────────────
  const summaryStaff = selectedStaff === 'any' ? 'First available' : staff.find((s: any) => s.id === selectedStaff)?.name || '—';
  const addOnTotal = addOnIds.reduce((acc, id) => {
    const svc = services.find((s: any) => s.id === id);
    return acc + (svc ? getServicePrice(svc, resolvedStaffMember) : 0);
  }, 0);
  const grandTotal = svcPrice + addOnTotal + legsTotal;

  return (
    <div className="space-y-5">
      <StepDots />

      <ArrearsBanner />

      {/* Summary */}
      <div className="rounded-2xl border-2 border-primary/10 bg-primary/5 p-4 space-y-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Booking Summary</p>
        <div className="space-y-1.5">
          <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">Client</p><p className="text-[11px] font-black text-slate-900">{selectedClient?.name || newClientName}</p></div>
          <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">Service</p><p className="text-[11px] font-black text-slate-900">{selectedSvc?.name}{addOnIds.length > 0 && ` + ${addOnIds.length} add-on${addOnIds.length > 1 ? 's' : ''}`}</p></div>
          <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">Provider</p><p className="text-[11px] font-black text-slate-900">{summaryStaff}</p></div>
          <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">When</p><p className="text-[11px] font-black text-slate-900">{format(new Date(`${aptDate}T${aptTime}`), 'EEE MMM d · h:mm a')}</p></div>
          {scheduledLegs.map((leg) => {
            const legSvc = services.find((s: any) => s.id === leg.serviceId);
            const legStaff = staff.find((s: any) => s.id === leg.staffId);
            return (
              <div key={leg.id} className="flex justify-between pl-3 border-l-2 border-primary/10">
                <p className="text-[11px] font-bold text-muted-foreground">+ {legSvc?.name || 'Service'}</p>
                <p className="text-[11px] font-black text-slate-900">{legStaff?.name?.split(' ')[0] || 'Any'} · {format(leg.startTime, 'h:mm a')}</p>
              </div>
            );
          })}
          <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">Price</p><p className="text-[11px] font-black text-slate-900">${grandTotal.toFixed(2)}{depositCents > 0 ? ` · $${(depositCents / 100).toFixed(2)} deposit` : ''}</p></div>
          {isGroup && groupGuests.length > 0 && <div className="flex justify-between"><p className="text-[11px] font-bold text-muted-foreground">Group</p><p className="text-[11px] font-black text-slate-900">{groupGuests.length + 1} guests</p></div>}
        </div>
        <button onClick={() => setStep(2)} className="text-[9px] font-black uppercase tracking-widest text-primary/60 hover:text-primary">Edit details</button>
      </div>

      {/* Package redemption */}
      {activePackages.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Package className="w-3 h-3" />Redeem package session</p>
          {activePackages.map((pkg: any) => {
            const pkgDef = services.find((s: any) => s.id === pkg.packageId) || { name: pkg.packageId };
            const isSelected = redeemPackageId === pkg.packageId;
            return (
              <button key={pkg.packageId} onClick={() => setRedeemPackageId(isSelected ? null : pkg.packageId)}
                className={cn('w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left', isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/20')}>
                <div>
                  <p className={cn('text-[11px] font-black uppercase', isSelected ? 'text-primary' : 'text-slate-900')}>{pkgDef.name}</p>
                  <p className="text-[10px] text-muted-foreground">{pkg.sessionsRemaining} session{pkg.sessionsRemaining !== 1 ? 's' : ''} remaining</p>
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Charge card on file */}
      {canChargeOnFile && depositCents > 0 && (
        <button
          type="button"
          onClick={() => setChargeNow((v) => !v)}
          className={cn('w-full rounded-2xl border-2 p-4 text-left transition-all', chargeNow ? 'border-primary bg-primary/5' : 'border-border bg-white')}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-primary" />
                Charge card on file now
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {selectedClient?.cardOnFile?.brand && selectedClient?.cardOnFile?.last4
                  ? `${selectedClient.cardOnFile.brand.toUpperCase()} •••• ${selectedClient.cardOnFile.last4} — `
                  : ''}
                Charges ${(depositCents / 100).toFixed(2)} immediately. If it's declined, we'll send a completion link instead.
              </p>
            </div>
            <div className={cn('w-11 h-6 rounded-full shrink-0 transition-colors relative', chargeNow ? 'bg-primary' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', chargeNow ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      {/* Email */}
      {!selectedClient?.email && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Client email {(!canChargeOnFile || !chargeNow) && sendLink ? '(required)' : '(optional, needed if charge is declined)'}
          </p>
          <Input type="email" placeholder="client@email.com" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} className="h-11 rounded-xl border-2" />
        </div>
      )}
      {selectedClient?.email && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
          <p className="text-[10px] font-bold text-green-700">{selectedClient.email}</p>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Receptionist notes (optional)</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, special requests, etc." rows={2} className="w-full rounded-xl border-2 p-3 text-sm font-medium resize-none outline-none focus:border-primary transition-colors" />
      </div>

      {/* Completion link toggle — hidden entirely when we're about to charge
          the card on file now; it reappears automatically if that charge
          gets declined, since handleBook falls back to effectiveSendLink. */}
      {!(canChargeOnFile && chargeNow && depositCents > 0) && (
        <button type="button"
          onClick={() => { if (!sendLink && requiredFormIds.length > 0) { toast({ title: 'Link required — consent forms must be signed.' }); return; } setSendLink((v) => !v); }}
          className={cn('w-full rounded-2xl border-2 p-4 text-left transition-all', sendLink ? 'border-primary bg-primary/5' : 'border-border bg-white')}>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" />Send secure completion link</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {alreadyHasCard && requiredFormIds.length === 0 ? 'Card on file — no link needed.' :
                 depositCents > 0 ? `Client pays $${(depositCents / 100).toFixed(2)} deposit${requiredFormIds.length > 0 ? ` + signs ${requiredFormIds.length} form${requiredFormIds.length > 1 ? 's' : ''}` : ''} · secures card.` :
                 requiredFormIds.length > 0 ? `Client signs ${requiredFormIds.length} consent form${requiredFormIds.length > 1 ? 's' : ''} · secures card.` :
                 'Client secures card on file before arrival.'}
              </p>
            </div>
            <div className={cn('w-11 h-6 rounded-full shrink-0 transition-colors relative', sendLink ? 'bg-primary' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', sendLink ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      {sendLink && !(canChargeOnFile && chargeNow && depositCents > 0) && (
        <button type="button" onClick={() => setRequestFiles((v) => !v)} className={cn('w-full rounded-2xl border-2 p-3.5 text-left transition-all', requestFiles ? 'border-primary bg-primary/5' : 'border-border bg-white')}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-primary" />Request inspiration photos</p>
            <div className={cn('w-11 h-6 rounded-full shrink-0 transition-colors relative', requestFiles ? 'bg-primary' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', requestFiles ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      <div className="flex gap-3 pt-1">
        <Button onClick={() => setStep(2)} variant="outline" className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 px-5"><ChevronLeft className="w-4 h-4" /></Button>
        <Button
          onClick={handleBook}
          disabled={
            isSubmitting ||
            !canConfirmBooking ||
            (!(canChargeOnFile && chargeNow && depositCents > 0) && sendLink && !clientEmail.trim())
          }
          className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"
        >
          {isSubmitting
            ? <Loader className="w-4 h-4 animate-spin" />
            : !canConfirmBooking
              ? 'Resolve Balance First'
              : canChargeOnFile && chargeNow && depositCents > 0
                ? `Charge $${(depositCents / 100).toFixed(2)} & Book →`
                : sendLink ? 'Book & Send Link →' : 'Confirm Booking →'}
        </Button>
      </div>
    </div>
  );
}
