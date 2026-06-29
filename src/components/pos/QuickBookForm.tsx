'use client';

/**
 * QuickBookForm — v4
 *
 * v4 — receptionist-workspace upgrades (from the Quick Book redesign doc):
 *   - NEW: provider-assignment transparency. The "Any available" preview now
 *     shows the actual reasons behind the pick (on-shift/available at this
 *     time, client's usual provider for this service, lightest schedule
 *     today, certified — if the service doc defines certifiedStaffIds) plus
 *     a rough match score, and a "Lock this provider" action that converts
 *     the booking from "any" to that specific person without losing the
 *     reasoning that was just shown.
 *   - NEW: richer confirmation screen — location, total duration, and a
 *     deposit-paid vs. remaining-balance breakdown, plus working Print and
 *     Resend Confirmation actions. Resend calls /api/notifications/resend-
 *     confirmation, which does not exist yet server-side — add it alongside
 *     send-completion-link before relying on this button.
 *   - NEW: inline contact editing. A pencil next to the client's name in the
 *     step-2 client panel lets staff fix a phone number or add an email
 *     without leaving the booking flow, writing straight to the client doc.
 *     Address / emergency contact / communication preferences are not yet
 *     wired in — need confirmed field names on the Client type first.
 *
 * All v1–v3 features retained — see prior revision notes below.
 *
 * v3 — call-in workflow upgrade:
 *   - BUG FIX: paying down a client's outstanding balance via handleChargeArrears
 *     previously only set local state (`arrearsResolved`). The client's
 *     `outstandingBalance` field in Firestore was never updated, so the balance
 *     kept showing as owed on every subsequent call or visit. Now writes
 *     outstandingBalance: 0 back to the client doc (merge) the moment the
 *     charge succeeds, and updates local `selectedClient` state to match.
 *   - NEW: comprehensive, always-expanded ClientDetailPanel shown the instant a
 *     client is selected in step 2 — total visits, last visit, avg spend,
 *     lifetime value, preferred provider/service, upcoming appointments,
 *     packages, patch test + consent form status, notes, and full visit
 *     history. Designed so front desk can answer almost any caller question
 *     without leaving the booking flow or clicking to "open" anything.
 *   - NEW: "Pending call-backs" workflow. If a call-in booking gets
 *     interrupted, staff can tap "Call back later" at any step to save the
 *     entire in-progress booking (client, service, time, notes, everything)
 *     as a draft in `tenants/{tenantId}/callBackDrafts`. Any staff member can
 *     see the pending list at step 1 and resume exactly where the call left
 *     off. The draft is automatically cleared once that booking completes.
 *   - NEW: persistent "live call" bar across all steps showing who's on the
 *     phone, what's being booked, and the running total, plus the call-back
 *     button — so nothing gets lost mid-call.
 *
 * Earlier (v2) fix carried forward:
 *   - staffDateLoad useMemo crashed with "a.startsWith is not a function" when
 *     any appointment had a non-string `startTime`. Now guards with
 *     `typeof a.startTime === 'string'` before calling .startsWith().
 *
 * NOTE FOR DEPLOYMENT: the new callBackDrafts collection needs Firestore
 * security rules added — staff need read/write on
 * `tenants/{tenantId}/callBackDrafts/{draftId}` the same way they already
 * have it for `appointments` and `clients`, or this will throw the same kind
 * of "Missing or insufficient permissions" error you saw on the appointments
 * list query.
 *
 * NOTE FOR DEPLOYMENT (v4): /api/notifications/resend-confirmation needs to
 * be created server-side — mirrors send-completion-link but resends the
 * original booking confirmation (not the deposit/consent-form link).
 *
 * v2 — bug fixes from v1:
 *   - New client doc no longer double-written on charge path (mini-batch removed;
 *     client is committed inside a single pre-charge batch, appointment follows)
 *   - Group guest clientId now uses a real generated id, not the appointment id
 *   - Multi-provider ledger batch failure now shown with a persistent error state,
 *     not just a dismissable toast
 *   - Deposit policy extended to include multi-provider legs total
 *   - Package redemption now validates that the package matches the selected service
 *   - Outstanding balance cent-rounding guard added
 *   - Add-on pricing resolves staff correctly when selectedStaff === 'any'
 *   - Changing client now clears all step-2 state (addOnIds, aptTime, groupGuests, etc.)
 *
 * v2 — features:
 *   - Blocked client gate, duplicate client detection, outstanding balance
 *     interstitial, patch test / allergy alert, service eligibility filtering,
 *     duration override stepper, staff date-load chips, waitlist path,
 *     add-on compatibility, promo codes, charge confirmation guard, reminder
 *     timing override, client-visible vs internal notes, consent form status,
 *     success screen parity, completion link expiry, slot concurrency guard.
 *
 * All existing features retained:
 *   - ClientIntelligencePanel, SmartAvailabilityGrid, GroupBookingPanel,
 *     MultiProviderPanel, package redemption, charge card on file, arrears banner,
 *     multi-provider legs, add-on upsell
 */

import React from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { format, addMinutes, addDays, addWeeks, addMonths, differenceInCalendarDays, differenceInMonths, formatDistanceToNow } from 'date-fns';
import {
  doc, writeBatch, collection, runTransaction, query,
  where, getDocs, onSnapshot, deleteDoc, setDoc,
} from 'firebase/firestore';
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
  Users, Package, CreditCard, AlertTriangle, Wallet, UserCog,
  Clock, FlaskConical, Ban, AlertCircle, Tag, MessageSquare,
  FileText, Minus, Plus, CalendarOff, PhoneIncoming, Save,
  History, Star, CalendarCheck, StickyNote, ChevronDown,
  ChevronUp, Trash2, Phone, Mail, Pencil, Printer, Send,
  MapPin, Lock, CalendarDays, Repeat, Gift, Award, QrCode, Cake,
} from 'lucide-react';

import { useClientIntelligence } from '@/hooks/useClientIntelligence';
import { useSmartAvailability } from '@/hooks/useSmartAvailability';
import { ClientIntelligencePanel } from '@/components/pos/ClientIntelligencePanel';
import { SmartAvailabilityGrid } from '@/components/pos/SmartAvailabilityGrid';
import {
  GroupBookingPanel, isGroupValid, type GroupGuest,
} from '@/components/pos/GroupBookingPanel';
import {
  MultiProviderPanel, computeLegSchedule, isMultiProviderValid, type ProviderLeg,
} from '@/components/pos/MultiProviderPanel';

// ── Firestore sanitizer ───────────────────────────────────────────────────────
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj._methodName !== undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)]),
  );
};

// Defensive relative-time formatter — never let a malformed date string crash
// the pending call-backs list the way the startsWith bug crashed the form.
const safeRelativeTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

// v6 — birthday-proximity check for the new ClientDetailPanel badge.
// Returns 'today' | a day count (1-30) | null. Comparing month/day only
// (year-agnostic) since a stored birthday's year is the birth year, not
// this year. Wraps year-end correctly (e.g. today Dec 28, birthday Jan 3).
const birthdayProximity = (iso?: string): { isToday: boolean; daysAway: number } | null => {
  if (!iso) return null;
  try {
    const bday = new Date(iso);
    if (Number.isNaN(bday.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    let diffDays = Math.round((thisYear.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) {
      const nextYear = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
      diffDays = Math.round((nextYear.getTime() - today.getTime()) / 86400000);
    }
    if (diffDays > 30) return null;
    return { isToday: diffDays === 0, daysAway: diffDays };
  } catch {
    return null;
  }
};

// requiredFormIds only stores form codes/ids, not display names — this builds
// an id → name lookup from whatever source actually has the names. Checks, in
// order: live-fetched consent form docs (tenants/{tenantId}/consentForms,
// field `title`), tenant.consentForms, tenant.forms, the optional `forms`
// prop. Falls back to the raw id if nothing matches.
const buildFormNameLookup = (tenant: any, formsProp: any[] = [], liveForms: any[] = []): Record<string, string> => {
  const lookup: Record<string, string> = {};
  const sources: any[] = [
    ...(Array.isArray(liveForms) ? liveForms : []),
    ...(Array.isArray(tenant?.consentForms) ? tenant.consentForms : []),
    ...(Array.isArray(tenant?.forms) ? tenant.forms : []),
    ...(Array.isArray(formsProp) ? formsProp : []),
  ];
  sources.forEach((f: any) => {
    const id = f?.id || f?.formId;
    const name = f?.title || f?.name || f?.label;
    if (id && name && !lookup[id]) lookup[id] = name;
  });
  return lookup;
};

// Shows phone and email side by side with icons — replaces the old
// `c.phone || c.email` pattern that silently hid the email any time a phone
// number was also present.
// v7 — small avatar used everywhere a provider is shown (selection chips,
// add-on overrides, confirmation). Falls back to initials on a colored
// circle when there's no avatarUrl, so it never renders blank.
function StaffAvatar({ staffMember, size = 'w-5 h-5', textSize = 'text-[9px]' }: { staffMember: any; size?: string; textSize?: string }) {
  if (staffMember?.avatarUrl) {
    return (
      <img
        src={staffMember.avatarUrl}
        alt={staffMember.name || 'Provider'}
        className={cn(size, 'rounded-full object-cover shrink-0 border border-white shadow-sm')}
      />
    );
  }
  return (
    <div className={cn(size, textSize, 'rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold shrink-0')}>
      {staffMember?.name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  );
}

function ContactLine({
  contact,
  className,
  compact = false,
}: {
  contact: { phone?: string; email?: string } | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  if (!contact?.phone && !contact?.email) {
    return <span className={cn('text-slate-400', className)}>—</span>;
  }
  // Compact: single truncating line, one leading icon — used anywhere space
  // is tight (list rows). The full two-icon version can overflow its
  // container when both phone and email are present and the row is narrow.
  if (compact) {
    const parts = [contact.phone, contact.email].filter(Boolean);
    return (
      <span className={cn('inline-flex items-center gap-1 min-w-0 max-w-full', className)}>
        <Phone className="w-3 h-3 text-slate-400 shrink-0" />
        <span className="truncate">{parts.join(' · ')}</span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-2.5 flex-wrap', className)}>
      {contact.phone && (
        <span className="inline-flex items-center gap-1">
          <Phone className="w-3 h-3 text-slate-400 shrink-0" />
          {contact.phone}
        </span>
      )}
      {contact.email && (
        <span className="inline-flex items-center gap-1 truncate">
          <Mail className="w-3 h-3 text-slate-400 shrink-0" />
          {contact.email}
        </span>
      )}
    </span>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ARREARS_OVERRIDE_REASONS = [
  { value: 'will_collect_in_person', label: 'Will collect in person' },
  { value: 'manager_approved', label: 'Manager approved' },
  { value: 'dispute_in_progress', label: 'Dispute in progress' },
  { value: 'other', label: 'Other' },
] as const;

const REMINDER_OPTIONS = [
  { value: '1', label: '1 hour before' },
  { value: '24', label: '24 hours before' },
  { value: '48', label: '48 hours before (default)' },
  { value: '72', label: '72 hours before' },
] as const;

const DURATION_OFFSETS = [0, 15, 30, 45, 60] as const;

// Patch test validity window in months
const PATCH_TEST_VALIDITY_MONTHS = 6;

// ── Types ─────────────────────────────────────────────────────────────────────
type Props = {
  clients: any[];
  services: any[];
  staff: any[];
  tenantId: string;
  tenant: any;
  firestore: any;
  appointments?: any[];
  currentStaffId?: string;
  // Optional list of consent form definitions ({ id, name } or { id, label }).
  // Used to resolve a human-readable form name instead of showing the raw
  // form id/code. If your form definitions live somewhere else (e.g. a
  // dedicated `forms` collection passed down differently), wire that source
  // into buildFormNameLookup below.
  forms?: any[];
  // v5 — optional. If provided, Quick Book can nudge a package or
  // membership purchase based on the client's visit pattern. Omitted
  // entirely if your app doesn't pass these down — nudges just never show.
  packages?: any[];
  memberships?: any[];
  // v7 — optional. Discount docs (matching your Discount type: code, type,
  // value, isActive, automation.trigger, applicableServiceIds, etc). If
  // provided, eligible ones auto-surface as tap-to-apply chips in step 3
  // instead of requiring the client to know a code. Omitted entirely if not
  // passed — the manual code field still works exactly as before.
  discounts?: any[];
  onSuccess: () => void;
  onCancel: () => void;
};

type ChargeOutcome =
  | { charged: true; amountDollars: number }
  | { charged: false; reason: string }
  | null;

type BookingSuccess = {
  appointmentId: string;
  tenantId: string;
  checkInToken: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceName: string;
  aptDate: string;
  aptTime: string;
  locationName: string;
  totalMinutes: number;
  totalDollars: number;
  depositPaidDollars: number;
  remainingBalanceDollars: number;
  providersSummary: { name: string; detail: string; avatarUrl?: string }[];
  chargeOutcome: ChargeOutcome;
  generatedLink: string | null;
  sendStatus: any;
  isGroup: boolean;
  groupGuestCount: number;
  isMultiProvider: boolean;
  legCount: number;
  ledgerError: boolean;
};

// A saved, in-progress call-in booking that can be resumed by any staff member.
type CallBackDraft = {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  createdByStaffId: string | null;
  callerName: string;
  callerPhone: string;
  clientId: string | null;
  clientName: string;
  note: string;
  step: 1 | 2 | 3;
  snapshot: any;
  status: 'pending' | 'resolved';
};

// ── Command bar ───────────────────────────────────────────────────────────────
// Replaces the old separate step-dots + live-call-bar with a single header:
// who's on the phone, what's being booked, where they are in the flow (1/2/3),
// and the call-back action — all in one place instead of two stacked elements
// competing for attention.
function CommandBar({
  step,
  callerName,
  serviceLabel,
  onSaveDraft,
}: {
  step: 1 | 2 | 3;
  callerName: string;
  serviceLabel: string;
  onSaveDraft: () => void;
}) {
  return (
    <div className="rounded-xl bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
          <PhoneIncoming className="w-4 h-4 text-white/80" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{callerName}</p>
          <p className="text-[11px] text-white/60 truncate">{serviceLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map(n => (
            <span
              key={n}
              className={cn('w-1.5 h-1.5 rounded-full transition-colors', n <= step ? 'bg-white' : 'bg-white/25')}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onSaveDraft}
          className="flex items-center gap-1.5 text-[11px] font-medium bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Save className="w-3 h-3" /> Call back later
        </button>
      </div>
    </div>
  );
}

// ── Arrears banner ────────────────────────────────────────────────────────────
function ArrearsBanner({
  outstandingBalance,
  clientFirstName,
  canChargeOnFile,
  isChargingArrears,
  arrearsResolved,
  showOverride,
  overrideReason,
  overrideDetail,
  onChargeArrears,
  onShowOverride,
  onSetOverrideReason,
  onSetOverrideDetail,
  onCancelOverride,
}: {
  outstandingBalance: number;
  clientFirstName: string;
  canChargeOnFile: boolean;
  isChargingArrears: boolean;
  arrearsResolved: boolean;
  showOverride: boolean;
  overrideReason: string;
  overrideDetail: string;
  onChargeArrears: () => void;
  onShowOverride: () => void;
  onSetOverrideReason: (v: string) => void;
  onSetOverrideDetail: (v: string) => void;
  onCancelOverride: () => void;
}) {
  if (arrearsResolved) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <p className="text-xs font-medium text-green-700">
          Balance of ${outstandingBalance.toFixed(2)} collected
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 space-y-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs font-medium text-red-700">
            Outstanding balance: ${outstandingBalance.toFixed(2)}
          </p>
          <p className="text-[11px] text-red-600/80 mt-0.5">
            {clientFirstName} owes from a previous visit. Collect now or explain why you're proceeding.
          </p>
        </div>
      </div>

      {!showOverride ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onChargeArrears}
            disabled={isChargingArrears || !canChargeOnFile}
            className="h-9 text-xs"
          >
            {isChargingArrears
              ? <Loader className="w-3.5 h-3.5 animate-spin" />
              : <><Wallet className="w-3.5 h-3.5 mr-1.5" />Charge ${outstandingBalance.toFixed(2)}</>}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onShowOverride}
            className="h-9 text-xs border"
          >
            Book anyway
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <select
            value={overrideReason}
            onChange={e => onSetOverrideReason(e.target.value)}
            className="w-full h-9 rounded-lg border text-xs px-2 bg-white"
          >
            <option value="">Why book without collecting?</option>
            {ARREARS_OVERRIDE_REASONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {overrideReason === 'other' && (
            <Input
              value={overrideDetail}
              onChange={e => onSetOverrideDetail(e.target.value)}
              placeholder="Briefly explain"
              className="h-9 text-xs"
            />
          )}
          <button
            type="button"
            onClick={onCancelOverride}
            className="text-[10px] text-slate-400 hover:text-slate-600"
          >
            ← Back
          </button>
        </div>
      )}

      {!canChargeOnFile && !showOverride && (
        <p className="text-[10px] text-red-400">
          No usable card on file — use "Book anyway" or collect by another method first.
        </p>
      )}
    </div>
  );
}

// ── Client detail panel ────────────────────────────────────────────────────────
// Always-expanded, comprehensive client profile shown the instant a client is
// selected. Built so a staff member on the phone can answer almost any caller
// question (when was I last in? do I have sessions left? who do I usually see?
// do I owe anything?) without clicking to open or expand anything.
function ClientDetailPanel({
  client,
  appointments,
  services,
  staff,
  outstandingBalance,
  patchTestDate,
  patchTestExpired,
  selectedSvcRequiresPatchTest,
  formStatuses,
  activePackages,
  getFormName,
  firestore,
  tenantId,
  onChangeClient,
  onUpdateClient,
}: {
  client: any;
  appointments: any[];
  services: any[];
  staff: any[];
  outstandingBalance: number;
  patchTestDate: Date | null;
  patchTestExpired: boolean;
  selectedSvcRequiresPatchTest: boolean;
  formStatuses: { id: string; signed: boolean; expiredSig: boolean; signedAt: Date | null }[];
  activePackages: any[];
  getFormName: (id: string) => string;
  firestore: any;
  tenantId: string;
  onChangeClient: () => void;
  // v4 — lets the contact-edit panel below push phone/email updates back up
  // into the parent's selectedClient state immediately, without the parent
  // needing to know anything about how the edit UI works.
  onUpdateClient?: (updates: { phone?: string; email?: string }) => void;
}) {
  const [historyExpanded, setHistoryExpanded] = React.useState(false);

  // v4 — inline contact editing. Phone/email only for now; address,
  // emergency contact, and communication preferences need confirmed field
  // names on the Client type before they're added here.
  const [editingContact, setEditingContact] = React.useState(false);
  const [editPhone, setEditPhone] = React.useState(client.phone || '');
  const [editEmail, setEditEmail] = React.useState(client.email || '');
  const [isSavingContact, setIsSavingContact] = React.useState(false);
  const { toast: contactToast } = useToast();

  React.useEffect(() => {
    setEditPhone(client.phone || '');
    setEditEmail(client.email || '');
    setEditingContact(false);
  }, [client.id]);

  const handleSaveContact = async () => {
    if (!firestore || !tenantId || !client?.id) return;
    setIsSavingContact(true);
    try {
      const updates = { phone: editPhone.trim(), email: editEmail.trim() };
      await setDoc(
        doc(firestore, `tenants/${tenantId}/clients`, client.id),
        sanitizeForFirestore(updates),
        { merge: true },
      );
      onUpdateClient?.(updates);
      setEditingContact(false);
      contactToast({ title: 'Contact info updated' });
    } catch {
      contactToast({ variant: 'destructive', title: 'Could not save contact info' });
    } finally {
      setIsSavingContact(false);
    }
  };

  // The `appointments` prop passed into QuickBookForm is almost certainly
  // scoped for availability checking (a window around the date being
  // booked), not a client's full history — which is why these stats weren't
  // rendering real numbers. A dedicated, client-specific subscription
  // guarantees the full picture regardless of how the parent scopes that
  // shared prop for its own purposes. Single equality filter, no orderBy, so
  // it doesn't need a composite index (sorted client-side instead). Falls
  // back to the appointments prop only before the live snapshot has loaded,
  // to avoid a blank flash.
  const [clientAppointmentsLive, setClientAppointmentsLive] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    if (!firestore || !tenantId || !client?.id) return;
    setClientAppointmentsLive(null);
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('clientId', '==', client.id),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
        setClientAppointmentsLive(list);
      },
      () => { /* non-fatal — falls back to the appointments prop below */ },
    );
    return () => unsubscribe();
  }, [firestore, tenantId, client?.id]);

  // Defensive: only trust startTime values that are actually strings, same
  // guard as staffDateLoad — a non-string startTime should never crash this
  // panel either.
  const clientAppointments = React.useMemo(() => {
    const source = clientAppointmentsLive ?? appointments;
    return (source || [])
      .filter((a: any) => a.clientId === client.id && typeof a.startTime === 'string')
      .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [clientAppointmentsLive, appointments, client.id]);

  const nowMs = Date.now();
  const pastVisits = clientAppointments.filter((a: any) => new Date(a.startTime).getTime() < nowMs && a.status !== 'cancelled');
  const upcomingVisits = clientAppointments.filter((a: any) => new Date(a.startTime).getTime() >= nowMs && a.status !== 'cancelled');

  const visitValue = (a: any) => {
    const svc = services.find((s: any) => s.id === a.serviceId);
    const staffMember = staff.find((s: any) => s.id === a.staffId);
    return svc ? getServicePrice(svc, staffMember) : 0;
  };

  const totalSpent = pastVisits.reduce((acc, a) => acc + visitValue(a), 0);
  const avgPerVisit = pastVisits.length > 0 ? totalSpent / pastVisits.length : 0;

  const serviceTally: Record<string, number> = {};
  const staffTally: Record<string, number> = {};
  pastVisits.forEach((a: any) => {
    if (a.serviceId) serviceTally[a.serviceId] = (serviceTally[a.serviceId] || 0) + 1;
    if (a.staffId) staffTally[a.staffId] = (staffTally[a.staffId] || 0) + 1;
  });
  const topServiceId = Object.entries(serviceTally).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topStaffId = Object.entries(staffTally).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topService = services.find((s: any) => s.id === topServiceId);
  const topStaff = staff.find((s: any) => s.id === topStaffId);

  const visibleHistory = historyExpanded ? pastVisits : pastVisits.slice(0, 4);

  return (
    <div className="rounded-2xl border bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-4 flex items-start justify-between gap-3 border-b">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
            client.status === 'blocked' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700',
          )}>
            {client.status === 'blocked' ? <Ban className="w-4 h-4" /> : client.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{client.name}</p>
            {!editingContact ? (
              <div className="flex items-center gap-1.5">
                <ContactLine contact={client} className="text-xs text-slate-400" />
                <button
                  type="button"
                  onClick={() => setEditingContact(true)}
                  className="text-slate-300 hover:text-blue-500 shrink-0"
                  title="Edit contact info"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                <div className="h-8 rounded-md border border-input bg-background px-2 flex items-center [&_input]:border-none [&_input]:bg-transparent [&_input]:outline-none [&_input]:h-full [&_input]:w-full [&_input]:text-xs [&_.PhoneInputCountry]:mr-1.5">
                  <PhoneInput
                    international
                    defaultCountry="US"
                    value={editPhone}
                    onChange={(v) => setEditPhone(v || '')}
                    placeholder="(555) 000-0000"
                  />
                </div>
                <Input
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="h-8 text-xs"
                  type="email"
                />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-[11px] flex-1" onClick={handleSaveContact} disabled={isSavingContact}>
                    {isSavingContact ? <Loader className="w-3 h-3 animate-spin" /> : 'Save'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setEditingContact(false); setEditPhone(client.phone || ''); setEditEmail(client.email || ''); }}
                    className="text-[10px] text-slate-400 hover:text-slate-600 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <button onClick={onChangeClient} className="text-xs text-blue-600 hover:text-blue-800 shrink-0 mt-1">
          Change
        </button>
      </div>

      {/* Stat grid — answers the most common phone questions at a glance */}
      <div className="grid grid-cols-4 divide-x border-b bg-slate-50/60">
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold text-slate-900">{pastVisits.length}</p>
          <p className="text-[10px] text-slate-400">Visits</p>
        </div>
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {pastVisits[0] ? format(new Date(pastVisits[0].startTime), 'MMM d') : '—'}
          </p>
          <p className="text-[10px] text-slate-400">Last visit</p>
        </div>
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {avgPerVisit > 0 ? `$${avgPerVisit.toFixed(0)}` : '—'}
          </p>
          <p className="text-[10px] text-slate-400">Avg/visit</p>
        </div>
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold text-slate-900">
            ${Math.round(client.lifetimeValue || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-400">Lifetime</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Status badges row — things staff need to say out loud immediately */}
        <div className="flex flex-wrap gap-1.5">
          {outstandingBalance > 0 && (
            <span className="text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              Owes ${outstandingBalance.toFixed(2)}
            </span>
          )}
          {client.status === 'blocked' && (
            <span className="text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              Blocked
            </span>
          )}
          {(selectedSvcRequiresPatchTest ? patchTestExpired : !!patchTestDate && patchTestExpired) && (
            <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <FlaskConical className="w-2.5 h-2.5" />
              {patchTestDate ? 'Patch test expired' : 'No patch test on file'}
            </span>
          )}
          {client.cardOnFile?.paymentMethodId && (
            <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CreditCard className="w-2.5 h-2.5" /> Card on file
            </span>
          )}
          {topStaff && (
            <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Star className="w-2.5 h-2.5" /> Usually sees {topStaff.name?.split(' ')[0]}
            </span>
          )}
          {topService && (
            <span className="text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
              Usually books {topService.name}
            </span>
          )}
          {/* v6 — previously Quick Book never surfaced birthday or membership
              status anywhere, even though both fields exist on Client.
              Package status was already shown (further down); these close
              the gap for the other two. */}
          {client.activeMembershipId && (
            <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Award className="w-2.5 h-2.5" /> Member
            </span>
          )}
          {birthdayProximity(client.birthday)?.isToday && (
            <span className="text-[10px] font-medium text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Cake className="w-2.5 h-2.5" /> Birthday today!
            </span>
          )}
          {!birthdayProximity(client.birthday)?.isToday && birthdayProximity(client.birthday) && (
            <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Cake className="w-2.5 h-2.5" /> Birthday in {birthdayProximity(client.birthday)!.daysAway}d
            </span>
          )}
        </div>

        {/* Upcoming appointments */}
        {upcomingVisits.length > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <p className="text-[10px] font-medium text-blue-700 uppercase tracking-wide flex items-center gap-1 mb-1">
              <CalendarCheck className="w-3 h-3" /> Upcoming
            </p>
            {upcomingVisits.slice(0, 3).map((a: any) => (
              <p key={a.id} className="text-xs text-blue-800">
                {format(new Date(a.startTime), 'EEE MMM d · h:mm a')} —{' '}
                {services.find((s: any) => s.id === a.serviceId)?.name || 'Service'}
              </p>
            ))}
          </div>
        )}

        {/* Packages */}
        {activePackages.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Package className="w-3 h-3" /> Packages
            </p>
            {activePackages.map((pkg: any) => {
              const pkgSvc = services.find((s: any) => s.id === pkg.packageId);
              return (
                <p key={pkg.packageId} className="text-xs text-slate-700">
                  {pkgSvc?.name || pkg.packageId} — {pkg.sessionsRemaining} session{pkg.sessionsRemaining !== 1 ? 's' : ''} left
                </p>
              );
            })}
          </div>
        )}

        {/* Consent forms — compact */}
        {formStatuses.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <FileText className="w-3 h-3" /> Forms
            </p>
            <div className="flex flex-wrap gap-1.5">
              {formStatuses.map(fs => (
                <span
                  key={fs.id}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    fs.signed
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : fs.expiredSig
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-red-50 text-red-600 border border-red-200',
                  )}
                >
                  {getFormName(fs.id)} {fs.signed ? '✓' : fs.expiredSig ? '· expired' : '· unsigned'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notes on the client record, if present */}
        {client.notes && (
          <div className="rounded-lg bg-slate-50 border px-3 py-2 flex items-start gap-2">
            <StickyNote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600">{client.notes}</p>
          </div>
        )}

        {/* Visit history */}
        {pastVisits.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <History className="w-3 h-3" /> Visit history
              </p>
              {pastVisits.length > 4 && (
                <button
                  type="button"
                  onClick={() => setHistoryExpanded(v => !v)}
                  className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                >
                  {historyExpanded ? 'Show less' : `Show all ${pastVisits.length}`}
                  {historyExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>
            <div className="rounded-lg border divide-y overflow-hidden">
              {visibleHistory.map((a: any) => {
                const svc = services.find((s: any) => s.id === a.serviceId);
                const staffMember = staff.find((s: any) => s.id === a.staffId);
                return (
                  <div key={a.id} className="px-3 py-2 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-slate-900">{svc?.name || 'Service'}</p>
                      <p className="text-[10px] text-slate-400">
                        {format(new Date(a.startTime), 'MMM d yyyy')} · {staffMember?.name?.split(' ')[0] || 'Staff'}
                      </p>
                    </div>
                    <p className="text-slate-500">${visitValue(a).toFixed(0)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({
  result,
  onBookAnother,
  onDone,
}: {
  result: BookingSuccess;
  onBookAnother: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [isResending, setIsResending] = React.useState(false);
  const { toast } = useToast();

  const copyLink = async () => {
    if (!result.generatedLink) return;
    try {
      await navigator.clipboard.writeText(result.generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed' });
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  // v4 — hits a not-yet-built endpoint. Add /api/notifications/resend-
  // confirmation server-side (same shape as send-completion-link) before
  // shipping this; until then this will fail gracefully with a toast.
  const handleResend = async () => {
    setIsResending(true);
    try {
      const res = await fetch('/api/notifications/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: result.tenantId,
          appointmentId: result.appointmentId,
          clientEmail: result.clientEmail,
          clientPhone: result.clientPhone,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast({ title: 'Confirmation resent' });
      } else {
        toast({ variant: 'destructive', title: 'Could not resend', description: data.reason || 'Try again in a moment.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Could not resend', description: 'Endpoint may not be set up yet.' });
    } finally {
      setIsResending(false);
    }
  };

  const firstName = result.clientName.split(' ')[0];

  // v5 — printable check-in ticket. The old Print button just called
  // window.print() on the live app with no print stylesheet, which is why
  // it "didn't work" — there was nothing telling the browser what to
  // actually print, so it either printed the whole app chrome or did
  // nothing depending on the browser/PWA context. This wraps the rest of
  // the screen in print:hidden and renders a dedicated, print-only ticket
  // as a sibling — Tailwind's print: variant means only the ticket survives
  // when the browser print dialog fires. Note this only controls what THIS
  // component renders; if Quick Book is embedded inside POS page chrome
  // (nav bars, sidebar), that surrounding chrome isn't scoped by this
  // change and would need its own print:hidden, or the ticket should open
  // in its own window/tab for a guaranteed-clean printout.
  const checkInUrl = typeof window !== 'undefined' && result.checkInToken
    ? `${window.location.origin}/check-in/${result.checkInToken}`
    : '';
  const qrSrc = checkInUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(checkInUrl)}`
    : '';

  return (
    <>
    <div className="print:hidden space-y-5">
      {/* v6 — stronger, more celebratory hero. A flat icon-in-a-circle with
          small text read as "form submitted," not "you're booked" — this
          gives the confirmation a bit more visual weight to match the
          moment, without adding any new dependencies. */}
      <div className="text-center space-y-2 pt-3 pb-1">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto shadow-lg shadow-green-500/20">
          <CheckCircle2 className="w-8 h-8 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-900 tracking-tight">{result.clientName}</p>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mt-0.5">Booked</p>
        </div>
        <p className="text-sm text-slate-600">
          {format(new Date(`${result.aptDate}T${result.aptTime}`), 'EEE MMM d · h:mm a')}
        </p>
        {(result.isGroup && result.groupGuestCount > 0) || (result.isMultiProvider && result.legCount > 0) ? (
          <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
            {result.isGroup && result.groupGuestCount > 0 && (
              <span className="text-[10px] font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                Group of {result.groupGuestCount + 1}
              </span>
            )}
            {result.isMultiProvider && result.legCount > 0 && (
              <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                {result.legCount + 1} providers
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* v4 — booking-summary strip: location, duration, financial split */}
      <div className="rounded-xl border overflow-hidden bg-white">
        <p className="px-3.5 pt-3 pb-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
          Booking summary
        </p>
        <div className="divide-y">
        <div className="px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Location</span>
          <span className="text-slate-900">{result.locationName}</span>
        </div>
        <div className="px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Duration</span>
          <span className="text-slate-900">{result.totalMinutes} min</span>
        </div>
        <div className="px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">Total</span>
          <span className="text-slate-900 font-medium">${result.totalDollars.toFixed(2)}</span>
        </div>
        {result.depositPaidDollars > 0 && (
          <div className="px-3.5 py-2.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Deposit paid</span>
            <span className="text-green-700 font-medium">${result.depositPaidDollars.toFixed(2)}</span>
          </div>
        )}
        <div className="px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">Remaining balance</span>
          <span className="text-slate-900 font-medium">${Math.max(0, result.remainingBalanceDollars).toFixed(2)}</span>
        </div>
        </div>
      </div>

      {/* v6 — "who's working" (Quick Book redesign: confirmations must
          visually show which providers are on this appointment). Previously
          the confirmation only showed a leg/guest COUNT ("3 providers") with
          no names — this lists every resolved provider with what they're
          actually doing, built in handleBook from the primary assignment,
          any add-on overrides, multi-provider legs, and group guests. */}
      {result.providersSummary.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <p className="px-3.5 pt-3 pb-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
            Who's working this appointment
          </p>
          <div className="divide-y">
            {result.providersSummary.map((p, i) => (
              <div key={i} className="px-3.5 py-2.5 flex items-center gap-2.5">
                <StaffAvatar staffMember={{ name: p.name, avatarUrl: p.avatarUrl }} size="w-7 h-7" textSize="text-[11px]" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">{p.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.chargeOutcome?.charged && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 flex items-center gap-2.5">
          <CreditCard className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-xs font-medium text-green-700">
            ${result.chargeOutcome.amountDollars.toFixed(2)} charged to card on file
          </p>
        </div>
      )}

      {result.chargeOutcome && !result.chargeOutcome.charged && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-amber-700">Card on file declined</p>
            <p className="text-[11px] text-amber-600/80 mt-0.5">{result.chargeOutcome.reason} — completion link sent instead.</p>
          </div>
        </div>
      )}

      {result.ledgerError && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-2.5 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-orange-700">Booking confirmed — ledger needs review</p>
            <p className="text-[11px] text-orange-600/80 mt-0.5">Per-provider revenue lines couldn't be written. Check the Ledger page before end of day.</p>
          </div>
        </div>
      )}

      {result.generatedLink && (
        <div className="rounded-xl border p-3.5 space-y-2.5">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Link2 className="w-3 h-3" /> Completion link · valid {7} days
          </p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={result.generatedLink}
              onFocus={e => e.currentTarget.select()}
              className="h-10 text-xs font-mono"
            />
            <Button onClick={copyLink} size="sm" className="h-10 shrink-0">
              {copied ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" />Copy</>}
            </Button>
          </div>
          {result.sendStatus?.smsSent || result.sendStatus?.emailSent ? (
            <p className="text-[11px] text-green-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Auto-sent {result.sendStatus.smsSent ? 'by text' : ''}
              {result.sendStatus.smsSent && result.sendStatus.emailSent ? ' & ' : ''}
              {result.sendStatus.emailSent ? 'by email' : ''}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">Send this to {firstName} to secure their spot.</p>
          )}
        </div>
      )}

      {/* v4 — Print + Resend, the screen staff reference while on the phone */}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={handlePrint} variant="outline" className="h-10 text-xs">
          <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
        </Button>
        <Button onClick={handleResend} variant="outline" className="h-10 text-xs" disabled={isResending}>
          {isResending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-1.5" /> Resend confirmation</>}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onBookAnother} variant="outline" className="h-11">Book another</Button>
        <Button onClick={onDone} className="h-11">Done</Button>
      </div>
    </div>

    {/* Print-only ticket — invisible on screen, the only thing the browser
        prints. Same data already in hand from the booking, plus a QR code
        encoding the existing check-in token/link so it can be scanned at
        the door with no new backend route needed. */}
    <div className="hidden print:block p-6">
      <div className="text-center space-y-1 mb-4">
        <p className="text-lg font-semibold">{result.clientName}</p>
        <p className="text-sm text-slate-600">{result.serviceName}</p>
        <p className="text-sm text-slate-600">
          {format(new Date(`${result.aptDate}T${result.aptTime}`), 'EEEE, MMM d · h:mm a')}
        </p>
        <p className="text-xs text-slate-500">{result.locationName}</p>
      </div>
      {qrSrc && (
        <div className="flex flex-col items-center gap-2">
          <img src={qrSrc} alt="Check-in QR code" width={200} height={200} />
          <p className="text-xs text-slate-500">Show this code at check-in</p>
        </div>
      )}
      {result.depositPaidDollars > 0 && (
        <p className="text-center text-xs text-slate-500 mt-3">
          Deposit paid: ${result.depositPaidDollars.toFixed(2)} · Balance due: ${Math.max(0, result.remainingBalanceDollars).toFixed(2)}
        </p>
      )}
    </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function QuickBookForm({
  clients, services, staff, tenantId, tenant, firestore,
  appointments = [], forms = [], packages = [], memberships = [], discounts = [],
  currentStaffId, onSuccess, onCancel,
}: Props) {
  const { toast } = useToast();

  // ── Wizard step ─────────────────────────────────────────────────────────────
  const [step, setStep] = React.useState<1 | 2 | 3>(1);

  // Step 1 — client
  const [clientSearch, setClientSearch] = React.useState('');
  const [selectedClient, setSelectedClient] = React.useState<any>(null);
  const [isNewClient, setIsNewClient] = React.useState(false);
  const [newClientName, setNewClientName] = React.useState('');
  const [newClientPhone, setNewClientPhone] = React.useState('');
  const [newClientEmail, setNewClientEmail] = React.useState('');
  const [duplicateSuggestions, setDuplicateSuggestions] = React.useState<any[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = React.useState(false);
  // Arrears interstitial — shown between step 1 and step 2
  const [showArrearsInterstitial, setShowArrearsInterstitial] = React.useState(false);

  // Step 2 — service / time
  const [selectedService, setSelectedService] = React.useState('');
  const [addOnIds, setAddOnIds] = React.useState<string[]>([]);
  const [durationOffset, setDurationOffset] = React.useState(0);
  const [selectedStaff, setSelectedStaff] = React.useState('any');
  const [aptDate, setAptDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [aptTime, setAptTime] = React.useState(format(addMinutes(new Date(), 30), 'HH:mm'));
  const [isGroup, setIsGroup] = React.useState(false);
  const [groupGuests, setGroupGuests] = React.useState<GroupGuest[]>([]);
  const [isMultiProvider, setIsMultiProvider] = React.useState(false);
  const [providerLegs, setProviderLegs] = React.useState<ProviderLeg[]>([]);
  const [waitlistMode, setWaitlistMode] = React.useState(false);
  // v5 — per-add-on provider assignment. Keyed by add-on serviceId; absence
  // of a key means "same as primary provider" (the old, only behavior).
  // Written into appointment.checkoutState.serviceStaffOverrides at booking
  // time — the exact field AddAndConfigurePartsDialog / AppointmentDetailsSheet
  // already read for post-booking add-on reassignment, so this is additive,
  // not a new schema.
  const [addOnStaffOverrides, setAddOnStaffOverrides] = React.useState<Record<string, string>>({});
  // v5 — recurring booking. Writes a shared recurrenceId across the primary
  // appointment and however many future occurrences are requested — the
  // Appointment type already has an (until now unused) recurrenceId field.
  const [isRecurring, setIsRecurring] = React.useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = React.useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [recurrenceCount, setRecurrenceCount] = React.useState(4); // total occurrences, including the first

  // Step 3 — confirm
  const [sendLink, setSendLink] = React.useState(true);
  const [requestFiles, setRequestFiles] = React.useState(false);
  const [clientNotes, setClientNotes] = React.useState('');       // goes to client in confirmation
  const [internalNotes, setInternalNotes] = React.useState('');   // staff-only, never sent
  const [redeemPackageId, setRedeemPackageId] = React.useState<string | null>(null);
  const [chargeNow, setChargeNow] = React.useState(true);
  const [chargeConfirmPending, setChargeConfirmPending] = React.useState(false);
  const [promoCode, setPromoCode] = React.useState('');
  const [promoDiscount, setPromoDiscount] = React.useState<{ type: 'pct' | 'flat'; amount: number; label: string } | null>(null);
  const [promoChecking, setPromoChecking] = React.useState(false);
  const [reminderHours, setReminderHours] = React.useState('48');

  // Arrears (step 3 banner — still present for cases that slip through interstitial)
  const [isChargingArrears, setIsChargingArrears] = React.useState(false);
  const [arrearsResolved, setArrearsResolved] = React.useState(false);
  const [arrearsOverrideReason, setArrearsOverrideReason] = React.useState('');
  const [arrearsOverrideDetail, setArrearsOverrideDetail] = React.useState('');
  const [showArrearsOverride, setShowArrearsOverride] = React.useState(false);

  // Submit / result
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [successResult, setSuccessResult] = React.useState<BookingSuccess | null>(null);
  const [ledgerError, setLedgerError] = React.useState(false);
  const [slotConflict, setSlotConflict] = React.useState(false);

  // ── Pending call-backs (interrupted call-in bookings) ────────────────────────
  const [callBackDrafts, setCallBackDrafts] = React.useState<CallBackDraft[]>([]);
  const [currentDraftId, setCurrentDraftId] = React.useState<string | null>(null);
  const [showSaveDraftModal, setShowSaveDraftModal] = React.useState(false);
  const [draftCallerPhone, setDraftCallerPhone] = React.useState('');
  const [draftNote, setDraftNote] = React.useState('');
  const [isSavingDraft, setIsSavingDraft] = React.useState(false);
  const [discardingDraftId, setDiscardingDraftId] = React.useState<string | null>(null);

  // Live consent form definitions (tenants/{tenantId}/consentForms) — the
  // actual source of form names, fetched directly rather than relying solely
  // on a prop that may never get passed.
  const [consentFormDefs, setConsentFormDefs] = React.useState<any[]>([]);
  const [namingFormId, setNamingFormId] = React.useState<string | null>(null);
  const [newFormTitle, setNewFormTitle] = React.useState('');
  const [isSavingFormName, setIsSavingFormName] = React.useState(false);

  // Shift schedule (tenants/{tenantId}/shifts) — used for the call-in booking
  // turn order so "Any available" only rotates among staff actually scheduled
  // to work on the appointment's date.
  const [shifts, setShifts] = React.useState<any[]>([]);

  const searchRef = React.useRef<HTMLInputElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  // "Recent clients" — derived from real appointment records rather than the
  // client doc's `lastAppointment` field. That field gets stamped with the
  // moment a booking was CREATED (see handleBook below: `lastAppointment: now`),
  // not the appointment's actual date — so a client who just booked something
  // three weeks out would jump to the top of "recent," ahead of someone who
  // was genuinely serviced yesterday. This computes each client's true most
  // recent PAST visit from startTime instead.
  const lastVisitByClientId = React.useMemo(() => {
    const map: Record<string, string> = {};
    const nowMs = Date.now();
    appointments.forEach((a: any) => {
      if (!a.clientId || typeof a.startTime !== 'string') return;
      if (a.status === 'cancelled') return;
      const t = new Date(a.startTime).getTime();
      if (Number.isNaN(t) || t >= nowMs) return; // only real past visits count as "recent"
      if (!map[a.clientId] || t > new Date(map[a.clientId]).getTime()) {
        map[a.clientId] = a.startTime;
      }
    });
    return map;
  }, [appointments]);

  const recentClients = React.useMemo(() =>
    [...(clients || [])]
      .filter((c: any) => lastVisitByClientId[c.id])
      .sort((a: any, b: any) =>
        new Date(lastVisitByClientId[b.id]).getTime() - new Date(lastVisitByClientId[a.id]).getTime())
      .slice(0, 6),
  [clients, lastVisitByClientId]);

  // v5 — fills the otherwise-blank step 1 with something a receptionist can
  // actually act on between calls: how much of today is left, derived from
  // the same `appointments` prop already in hand, no new data source.
  const todaysRemainingCount = React.useMemo(() => {
    const todayStr2 = format(new Date(), 'yyyy-MM-dd');
    const nowMs2 = Date.now();
    return appointments.filter((a: any) =>
      typeof a.startTime === 'string' &&
      a.startTime.startsWith(todayStr2) &&
      new Date(a.startTime).getTime() >= nowMs2 &&
      a.status !== 'cancelled',
    ).length;
  }, [appointments]);

  const filteredClients = React.useMemo(() => {
    if (!clientSearch.trim()) return [];
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) =>
      c.name?.toLowerCase().includes(s) ||
      c.phone?.includes(s) ||
      c.email?.toLowerCase().includes(s),
    ).slice(0, 8);
  }, [clients, clientSearch]);

  const selectedSvc = services.find((s: any) => s.id === selectedService);

  // Resolve staff for pricing — when 'any', find first active staff
  const resolvedStaffForPrice = selectedStaff === 'any'
    ? staff.find((s: any) => s.active) ?? null
    : staff.find((s: any) => s.id === selectedStaff) ?? null;

  const svcPrice = selectedSvc ? getServicePrice(selectedSvc, resolvedStaffForPrice) : 0;

  // Add-on total — correctly uses resolvedStaffForPrice
  const addOnTotal = addOnIds.reduce((acc, id) => {
    const svc = services.find((s: any) => s.id === id);
    return acc + (svc ? getServicePrice(svc, resolvedStaffForPrice) : 0);
  }, 0);

  // Deposit: primary + legs total
  const primaryDepositCents = selectedSvc
    ? computeDepositCents({
        service: selectedSvc,
        price: svcPrice,
        depositsLive: tenant?.depositsLive === true,
      })
    : 0;

  // Multi-provider schedule
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
    const legStaff = staff.find((s: any) => s.id === leg.staffId);
    return acc + (svc ? getServicePrice(svc, legStaff) : 0);
  }, 0);

  const legDepositCents = scheduledLegs.reduce((acc, leg) => {
    const svc = services.find((s: any) => s.id === leg.serviceId);
    const legStaff = staff.find((s: any) => s.id === leg.staffId);
    const legPrice = svc ? getServicePrice(svc, legStaff) : 0;
    return acc + (svc ? computeDepositCents({
      service: svc,
      price: legPrice,
      depositsLive: tenant?.depositsLive === true,
    }) : 0);
  }, 0);

  const depositCents = primaryDepositCents + legDepositCents;

  // Promo discount applied to deposit
  const discountCents = promoDiscount
    ? promoDiscount.type === 'pct'
      ? Math.round(depositCents * promoDiscount.amount / 100)
      : Math.round(promoDiscount.amount * 100)
    : 0;
  const effectiveDepositCents = Math.max(0, depositCents - discountCents);

  const grandTotal = svcPrice + addOnTotal + legsTotal;

  const liveCallerName = selectedClient?.name || newClientName.trim() || 'New caller';
  const liveServiceLabel = selectedSvc?.name
    ? `${selectedSvc.name}${grandTotal > 0 ? ` · $${grandTotal.toFixed(0)}` : ''}`
    : 'No service selected yet';
  const openSaveDraftModal = () => {
    setDraftCallerPhone(selectedClient?.phone || newClientPhone || '');
    setShowSaveDraftModal(true);
  };

  const requiredFormIds: string[] = selectedSvc?.requiredFormIds || [];
  const alreadyHasCard = !!selectedClient?.cardOnFile?.token || !!selectedClient?.cardOnFile?.paymentMethodId;
  const canChargeOnFile = !!selectedClient?.cardOnFile?.customerId && !!selectedClient?.cardOnFile?.paymentMethodId;
  const clientEmail = selectedClient?.email || newClientEmail;
  const lastService = services.find((s: any) => s.id === selectedClient?.lastServiceId);
  const outstandingBalance = safeNumber(selectedClient?.outstandingBalance);
  const hasUnresolvedArrears = outstandingBalance > 0 && !arrearsResolved;
  const canConfirmBooking = !hasUnresolvedArrears || !!arrearsOverrideReason;

  // Active packages that match the selected service
  const activePackages: any[] = (selectedClient?.activePackages || []).filter(
    (p: any) => p.sessionsRemaining > 0 &&
      (!selectedService || p.serviceIds?.includes(selectedService) || p.packageId === selectedService),
  );

  // v5 — package/membership nudges (Quick Book redesign #4). Both are
  // entirely optional — if `packages`/`memberships` aren't passed in from
  // the parent, these simply never trigger, no errors.
  const pastVisitsForSelectedService = React.useMemo(() => {
    if (!selectedClient?.id || !selectedService) return 0;
    return appointments.filter((a: any) =>
      a.clientId === selectedClient.id &&
      a.serviceId === selectedService &&
      a.status !== 'cancelled' &&
      !a.redeemedPackageId,
    ).length;
  }, [appointments, selectedClient?.id, selectedService]);

  const matchingPackage = React.useMemo(
    () => (packages || []).find((p: any) => p.serviceId === selectedService) || null,
    [packages, selectedService],
  );
  const clientHasMatchingPackage = !!activePackages.find((p: any) => p.packageId === matchingPackage?.id);
  // Threshold of 3 full-price visits before nudging — tune freely.
  const showPackageNudge = !!matchingPackage && !clientHasMatchingPackage && pastVisitsForSelectedService >= 3;

  const cheapestMembership = React.useMemo(
    () => (memberships || []).length
      ? [...memberships].sort((a: any, b: any) => safeNumber(a.price) - safeNumber(b.price))[0]
      : null,
    [memberships],
  );
  // Light heuristic: client has no membership and has spent enough that one
  // would likely have paid for itself by now. Tune the $250 threshold per
  // your actual membership pricing.
  const showMembershipNudge = !!cheapestMembership &&
    !selectedClient?.activeMembershipId &&
    safeNumber(selectedClient?.lifetimeValue) > 250;

  // v7 — eligible discounts auto-surfaced in step 3 instead of requiring a
  // typed-in code. Computed from real visit history already in `appointments`.
  const clientVisitCount = React.useMemo(() => {
    if (!selectedClient?.id) return 0;
    return appointments.filter((a: any) => a.clientId === selectedClient.id && a.status !== 'cancelled').length;
  }, [appointments, selectedClient?.id]);

  const daysSinceLastVisit = React.useMemo(() => {
    const last = selectedClient?.id ? lastVisitByClientId[selectedClient.id] : null;
    if (!last) return null;
    return differenceInCalendarDays(new Date(), new Date(last));
  }, [lastVisitByClientId, selectedClient?.id]);

  const availableDiscounts = React.useMemo(() => {
    if (!discounts?.length) return [];
    const now = new Date();
    return discounts.filter((d: any) => {
      if (!d.isActive) return false;
      if (d.usageLimit && safeNumber(d.usageCount) >= d.usageLimit) return false;
      if (d.validFrom && new Date(d.validFrom) > now) return false;
      if (d.validUntil && new Date(d.validUntil) < now) return false;
      if (d.applicableServiceIds?.length && selectedService && !d.applicableServiceIds.includes(selectedService)) return false;
      if (d.limitOnePerCustomer && selectedClient?.id && (d.usedByClientIds || []).includes(selectedClient.id)) return false;
      const trig = d.automation?.trigger || 'none';
      // 'none' means manual-code-only by design — don't auto-surface those,
      // only ones with a real automation trigger that actually matches.
      if (trig === 'none') return false;
      if (trig === 'new_client') return !selectedClient || clientVisitCount === 0;
      if (trig === 'birthday') return !!birthdayProximity(selectedClient?.birthday)?.isToday;
      if (trig === 'loyalty') return clientVisitCount >= safeNumber(d.automation?.appointmentThreshold || 5);
      if (trig === 're_engagement') return daysSinceLastVisit !== null && daysSinceLastVisit >= safeNumber(d.automation?.daysSinceLastVisit || 60);
      return false;
    });
  }, [discounts, selectedService, selectedClient, clientVisitCount, daysSinceLastVisit]);

  // v7 fix — these two were previously declared after the step 1/step 2/
  // success-screen early `return`s, which only let them run when step === 3.
  // A hook (readBackSentence's useMemo) being called conditionally like
  // that violates React's Rules of Hooks and threw "Minified React error
  // #310" the moment someone reached step 3. Moved here so both are
  // computed unconditionally on every render, like every other hook in this
  // component.
  const summaryStaff = selectedStaff === 'any'
    ? 'First available'
    : staff.find((s: any) => s.id === selectedStaff)?.name || '—';

  // "Read this back to the client" sentence (Quick Book redesign:
  // confirmation should feel like someone reading back every detail). Pure
  // display, built entirely from values already in scope — doesn't change
  // what gets booked, just how it's communicated before the final tap.
  const readBackSentence = React.useMemo(() => {
    const name = selectedClient?.name || newClientName.trim() || 'the client';
    const addOnNames = addOnIds.map(id => services.find((s: any) => s.id === id)?.name).filter(Boolean);
    const servicePart = selectedSvc?.name ? `a ${selectedSvc.name}` : 'an appointment';
    const addOnPart = addOnNames.length > 0 ? ` with ${addOnNames.join(' and ')}` : '';
    let dateTimePart = '';
    try {
      dateTimePart = format(new Date(`${aptDate}T${aptTime}`), "EEEE, MMMM do 'at' h:mm a");
    } catch {
      dateTimePart = `${aptDate} at ${aptTime}`;
    }
    const providerPart = isMultiProvider && scheduledLegs.length > 0
      ? `starting with ${summaryStaff}`
      : `with ${summaryStaff}`;
    const groupPart = isGroup && groupGuests.length > 0
      ? `, plus ${groupGuests.length} more guest${groupGuests.length > 1 ? 's' : ''}`
      : '';
    const pricePart = `$${grandTotal.toFixed(2)} total`;
    const depositPart = effectiveDepositCents > 0
      ? `, with $${(effectiveDepositCents / 100).toFixed(2)} due now`
      : '';
    return `So that's ${servicePart}${addOnPart} for ${name}, ${providerPart}, on ${dateTimePart}${groupPart} — ${pricePart}${depositPart}.`;
  }, [selectedClient?.name, newClientName, addOnIds, services, selectedSvc, aptDate, aptTime, isMultiProvider, scheduledLegs.length, summaryStaff, isGroup, groupGuests.length, grandTotal, effectiveDepositCents]);

  // Patch test status
  const patchTestDate: Date | null = selectedClient?.lastPatchTest
    ? new Date(selectedClient.lastPatchTest)
    : null;
  const patchTestExpired = patchTestDate
    ? differenceInMonths(new Date(), patchTestDate) >= PATCH_TEST_VALIDITY_MONTHS
    : true;
  const selectedSvcRequiresPatchTest = selectedSvc?.requiresPatchTest === true;
  const patchTestBlocking = selectedSvcRequiresPatchTest && patchTestExpired;

  // Consent form statuses
  const formStatuses = requiredFormIds.map(fid => {
    const signed = selectedClient?.signedForms?.[fid];
    const signedAt = signed ? new Date(signed.signedAt) : null;
    const expired = signedAt
      ? differenceInMonths(new Date(), signedAt) >= 18
      : true;
    return { id: fid, signed: !!signed && !expired, expiredSig: !!signed && expired, signedAt };
  });
  const formsNeedingSignature = formStatuses.filter(f => !f.signed);

  // Human-readable form names — see buildFormNameLookup for which sources it checks.
  const formNameLookup = React.useMemo(
    () => buildFormNameLookup(tenant, forms, consentFormDefs),
    [tenant, forms, consentFormDefs],
  );
  const getFormName = React.useCallback((id: string) => formNameLookup[id] || id, [formNameLookup]);

  // Lets staff give an existing form id a real name on the spot, rather than
  // needing to go set this up elsewhere first. Writes directly to the id the
  // service already references, so nothing about the service's
  // requiredFormIds needs to change.
  const handleSaveFormName = async (id: string) => {
    if (!newFormTitle.trim() || !firestore || !tenantId) return;
    setIsSavingFormName(true);
    try {
      await setDoc(
        doc(firestore, `tenants/${tenantId}/consentForms`, id),
        sanitizeForFirestore({ id, title: newFormTitle.trim() }),
        { merge: true },
      );
      toast({ title: 'Form named', description: `"${newFormTitle.trim()}" saved.` });
      setNamingFormId(null);
      setNewFormTitle('');
    } catch {
      toast({ variant: 'destructive', title: 'Could not save form name' });
    } finally {
      setIsSavingFormName(false);
    }
  };

  // Smart availability
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // v6 — "how far out is this" indicator for the date-jump control. Pure
  // display, doesn't affect booking logic.
  const aptDateOffsetLabel = React.useMemo(() => {
    const days = differenceInCalendarDays(new Date(`${aptDate}T00:00`), new Date(`${todayStr}T00:00`));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    const ad = Math.abs(days);
    const unit = ad < 14 ? `${ad} day${ad !== 1 ? 's' : ''}` : ad < 60 ? `${Math.round(ad / 7)} week${Math.round(ad / 7) !== 1 ? 's' : ''}` : `${Math.round(ad / 30)} month${Math.round(ad / 30) !== 1 ? 's' : ''}`;
    return days > 0 ? `in ${unit}` : `${unit} ago`;
  }, [aptDate, todayStr]);
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
  const hasNoSlots = selectedService && slots.length === 0;

  // When the client said "any available," don't let the per-provider time
  // grid become a menu the receptionist can pick a favorite from — merge it
  // into one "anyone available" slot per time. The actual provider is
  // decided by fair rotation (resolveAnyStaffId below), not by which named
  // button looks most appealing. When a specific stylist is selected, this
  // is just a pass-through of the real per-provider slots.
  const displaySlots = React.useMemo(() => {
    if (selectedStaff !== 'any') return slots;
    const byTime = new Map<string, typeof slots[number]>();
    for (const s of slots) {
      if (!s.available) continue;
      const existing = byTime.get(s.time);
      if (!existing || s.gapMinutesAfter > existing.gapMinutesAfter) {
        byTime.set(s.time, { ...s, staffId: 'any', staffName: 'Any available' });
      }
    }
    return Array.from(byTime.values()).sort((a, b) => a.time.localeCompare(b.time));
  }, [slots, selectedStaff]);

  // Real per-time eligibility — which staff are genuinely free at the
  // selected time, from the actual availability data (not just "on shift").
  // Feeds resolveAnyStaffId so the rotation can't hand someone a booking
  // that collides with an appointment they already have.
  const eligibleStaffIdsForAptTime = React.useMemo(() => {
    if (selectedStaff !== 'any' || !aptTime) return undefined;
    const ids = Array.from(new Set(slots.filter(s => s.time === aptTime && s.available).map(s => s.staffId)));
    return ids.length > 0 ? ids : undefined;
  }, [slots, aptTime, selectedStaff]);

  // Staff date availability — how many appointments each provider already has on aptDate.
  // Guard against non-string startTime values (e.g. un-normalized Firestore
  // Timestamps) before calling .startsWith() on them.
  const staffDateLoad = React.useMemo(() => {
    const load: Record<string, number> = {};
    appointments.forEach((a: any) => {
      if (typeof a.startTime === 'string' && a.startTime.startsWith(aptDate) && a.staffId) {
        load[a.staffId] = (load[a.staffId] || 0) + 1;
      }
    });
    return load;
  }, [appointments, aptDate]);

  const activeStaff = staff.filter((s: any) => s.active);

  // ── "Any available" turn order for call-in bookings ───────────────────────
  // Mirrors the fair-play rotation already used for walk-ins (AssignStaffDialog
  // / WalkInLeaderboard, sorted by lastWalkInCompletedAt) — but kept as a
  // separate counter (lastBookingAssignedAt) since a phone booking is a future
  // reservation, not "who's free right now"; mixing the two would let every
  // call-in booking skew who gets the next walk-in and vice versa.
  //
  // `exclude` lets a single booking with multiple "any" slots (e.g. a
  // multi-provider booking) spread across different staff instead of handing
  // every slot to the same person, since lastBookingAssignedAt won't reflect
  // earlier picks in the same booking until it's written after commit.
  //
  // `eligibleStaffIds`, when provided, restricts the pool to staff who are
  // actually free at the specific time being booked (derived from the real
  // slot-availability data) — without this, the rotation could hand someone
  // a booking that collides with an appointment they already have, since
  // "most overdue + on shift" alone says nothing about a specific time slot.
  // Not every "any" assignment has this available (multi-provider legs and
  // group guests don't have per-slot availability data computed for them),
  // so it's optional and falls back to the broader shift-based pool.
  const resolveAnyStaffId = React.useCallback((
    dateStr: string,
    exclude: string[] = [],
    eligibleStaffIds?: string[],
  ): string | null => {
    const onShiftIds = new Set(
      shifts
        .filter((s: any) => s.date === dateStr && s.status !== 'cancelled' && s.status !== 'draft')
        .map((s: any) => s.staffId),
    );
    const basePool = staff.filter((s: any) =>
      s.active &&
      (s as any).acceptingWalkIns !== false && // reuses the walk-in opt-out flag; confirm the field name if call-in bookings need a separate one
      onShiftIds.has(s.id),
    );
    let pool = eligibleStaffIds
      ? basePool.filter((s: any) => eligibleStaffIds.includes(s.id))
      : basePool;
    // If restricting to "free at this exact time" leaves nobody, widen back
    // out rather than blocking the booking entirely — better to hand it to
    // someone than fail the call.
    if (pool.length === 0) pool = basePool;
    if (pool.length === 0) pool = staff.filter((s: any) => s.active && onShiftIds.has(s.id));
    if (pool.length === 0) pool = staff.filter((s: any) => s.active); // no shift data for that date at all
    const excluding = pool.filter((s: any) => !exclude.includes(s.id));
    const finalPool = excluding.length > 0 ? excluding : pool; // everyone already used this booking — allow a repeat
    if (finalPool.length === 0) return null;
    const sorted = [...finalPool].sort((a: any, b: any) => {
      const aLast = a.lastBookingAssignedAt ? new Date(a.lastBookingAssignedAt).getTime() : 0;
      const bLast = b.lastBookingAssignedAt ? new Date(b.lastBookingAssignedAt).getTime() : 0;
      return aLast - bLast;
    });
    return sorted[0]?.id || null;
  }, [staff, shifts]);

  // Live preview shown to the receptionist — uses the exact same inputs
  // handleBook will use, so what's displayed is genuinely what gets booked
  // (barring a true simultaneous-booking race, same caveat as the walk-in
  // rotation).
  const anyAvailablePreviewStaffId = selectedStaff === 'any' && aptTime
    ? resolveAnyStaffId(aptDate, [], eligibleStaffIdsForAptTime)
    : null;
  const anyAvailablePreviewName = anyAvailablePreviewStaffId
    ? staff.find((s: any) => s.id === anyAvailablePreviewStaffId)?.name
    : null;

  // v4 — which staff member this exact client has most often seen for THIS
  // exact service, derived from real appointment history (no schema change
  // needed). Feeds the "Client's usual provider" transparency reason below.
  const preferredStaffIdForService = React.useMemo(() => {
    if (!selectedClient?.id || !selectedService) return null;
    const tally: Record<string, number> = {};
    appointments.forEach((a: any) => {
      if (a.clientId === selectedClient.id && a.serviceId === selectedService && a.staffId && a.status !== 'cancelled') {
        tally[a.staffId] = (tally[a.staffId] || 0) + 1;
      }
    });
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }, [appointments, selectedClient?.id, selectedService]);

  // v4 — the actual reasons behind the "any available" pick, so staff (and
  // the client, if asked) get a real answer instead of "the computer picked
  // them." `certifiedStaffIds` on the Service doc is optional — if your
  // Service type doesn't have it yet, this reason simply never appears,
  // nothing breaks.
  const anyAvailableReasons = React.useMemo(() => {
    if (!anyAvailablePreviewStaffId) return [];
    const reasons: string[] = [];
    if (!eligibleStaffIdsForAptTime || eligibleStaffIdsForAptTime.includes(anyAvailablePreviewStaffId)) {
      reasons.push('Available at this time');
    }
    if (preferredStaffIdForService === anyAvailablePreviewStaffId) {
      reasons.push("Client's usual provider for this service");
    }
    const loads = activeStaff.map((s: any) => staffDateLoad[s.id] || 0);
    const minLoad = loads.length ? Math.min(...loads) : 0;
    if ((staffDateLoad[anyAvailablePreviewStaffId] || 0) <= minLoad) {
      reasons.push('Lightest schedule today');
    }
    const certifiedIds = (selectedSvc as any)?.certifiedStaffIds as string[] | undefined;
    if (Array.isArray(certifiedIds) && certifiedIds.includes(anyAvailablePreviewStaffId)) {
      reasons.push('Certified for this service');
    }
    return reasons;
  }, [anyAvailablePreviewStaffId, eligibleStaffIdsForAptTime, preferredStaffIdForService, activeStaff, staffDateLoad, selectedSvc]);

  // Presentational only — a rough "how solid is this pick" indicator, not a
  // real ML confidence score. Capped well under 100 so it never overclaims.
  const anyAvailableMatchScore = anyAvailablePreviewStaffId
    ? Math.min(96, 58 + anyAvailableReasons.length * 12)
    : null;

  // Client intelligence
  const intel = useClientIntelligence(selectedClient, appointments, services);

  // ── Effects ──────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (requiredFormIds.length > 0) setSendLink(true);
  }, [requiredFormIds.length]);

  React.useEffect(() => {
    if (step === 1) setTimeout(() => searchRef.current?.focus(), 80);
  }, [step]);

  React.useEffect(() => {
    // Reset all arrears state when client changes
    setArrearsResolved(false);
    setArrearsOverrideReason('');
    setArrearsOverrideDetail('');
    setShowArrearsOverride(false);
    setShowArrearsInterstitial(false);
  }, [selectedClient?.id]);

  // Auto-apply same-day reminder when booking for today
  React.useEffect(() => {
    if (aptDate === todayStr) setReminderHours('1');
    else setReminderHours('48');
  }, [aptDate, todayStr]);

  // Live subscription to pending call-back drafts — any staff member sees the
  // same list in real time. Filtered client-side by createdAt rather than
  // using orderBy in the query, so this doesn't need a composite Firestore
  // index (the same kind of missing-index trap that broke the client stats
  // bar elsewhere).
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const draftsQuery = query(
      collection(firestore, `tenants/${tenantId}/callBackDrafts`),
      where('status', '==', 'pending'),
    );
    const unsubscribe = onSnapshot(
      draftsQuery,
      (snap) => {
        const drafts: CallBackDraft[] = [];
        snap.forEach(d => drafts.push({ id: d.id, ...(d.data() as any) } as CallBackDraft));
        drafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setCallBackDrafts(drafts);
      },
      () => { /* non-fatal — pending call-backs are a convenience, not core booking */ },
    );
    return () => unsubscribe();
  }, [firestore, tenantId]);

  // Live consent form definitions — the actual names behind requiredFormIds.
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const formsQuery = collection(firestore, `tenants/${tenantId}/consentForms`);
    const unsubscribe = onSnapshot(
      formsQuery,
      (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
        setConsentFormDefs(list);
      },
      () => { /* non-fatal — falls back to showing the raw form id */ },
    );
    return () => unsubscribe();
  }, [firestore, tenantId]);

  // Shift schedule, today onward — used to keep "Any available" rotation
  // scoped to staff actually working on the appointment's date. Filtered by
  // date >= today rather than loading the whole history, and filtered
  // further client-side by exact date to avoid needing a composite index.
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const shiftsQuery = query(
      collection(firestore, `tenants/${tenantId}/shifts`),
      where('date', '>=', format(new Date(), 'yyyy-MM-dd')),
    );
    const unsubscribe = onSnapshot(
      shiftsQuery,
      (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
        setShifts(list);
      },
      () => { /* non-fatal — falls back to all active staff if shifts can't be read */ },
    );
    return () => unsubscribe();
  }, [firestore, tenantId]);
  const buildSnapshot = React.useCallback(() => ({
    clientSearch, selectedService, addOnIds, durationOffset, selectedStaff,
    aptDate, aptTime, isGroup, groupGuests, isMultiProvider, providerLegs,
    sendLink, requestFiles, clientNotes, internalNotes, redeemPackageId,
    chargeNow, promoCode, promoDiscount, reminderHours,
    isNewClient, newClientName, newClientPhone, newClientEmail,
  }), [
    clientSearch, selectedService, addOnIds, durationOffset, selectedStaff,
    aptDate, aptTime, isGroup, groupGuests, isMultiProvider, providerLegs,
    sendLink, requestFiles, clientNotes, internalNotes, redeemPackageId,
    chargeNow, promoCode, promoDiscount, reminderHours,
    isNewClient, newClientName, newClientPhone, newClientEmail,
  ]);

  const applySnapshot = (snap: any) => {
    if (!snap) return;
    setClientSearch(snap.clientSearch || '');
    setSelectedService(snap.selectedService || '');
    setAddOnIds(snap.addOnIds || []);
    setDurationOffset(snap.durationOffset || 0);
    setSelectedStaff(snap.selectedStaff || 'any');
    setAptDate(snap.aptDate || format(new Date(), 'yyyy-MM-dd'));
    setAptTime(snap.aptTime || format(addMinutes(new Date(), 30), 'HH:mm'));
    setIsGroup(!!snap.isGroup);
    setGroupGuests(snap.groupGuests || []);
    setIsMultiProvider(!!snap.isMultiProvider);
    setProviderLegs(snap.providerLegs || []);
    setSendLink(snap.sendLink !== false);
    setRequestFiles(!!snap.requestFiles);
    setClientNotes(snap.clientNotes || '');
    setInternalNotes(snap.internalNotes || '');
    setRedeemPackageId(snap.redeemPackageId || null);
    setChargeNow(snap.chargeNow !== false);
    setPromoCode(snap.promoCode || '');
    setPromoDiscount(snap.promoDiscount || null);
    setReminderHours(snap.reminderHours || '48');
    setIsNewClient(!!snap.isNewClient);
    setNewClientName(snap.newClientName || '');
    setNewClientPhone(snap.newClientPhone || '');
    setNewClientEmail(snap.newClientEmail || '');
  };

  const handleSaveDraft = async () => {
    if (!firestore || !tenantId) return;
    setIsSavingDraft(true);
    try {
      const { nanoid: _nanoid } = await import('nanoid');
      const now = new Date().toISOString();
      const draftId = currentDraftId || _nanoid();
      const existing = callBackDrafts.find(d => d.id === draftId);
      const callerName = selectedClient?.name || newClientName.trim() || 'Unknown caller';
      const callerPhone = draftCallerPhone.trim() || selectedClient?.phone || newClientPhone.trim() || '';

      await setDoc(
        doc(firestore, `tenants/${tenantId}/callBackDrafts`, draftId),
        sanitizeForFirestore({
          id: draftId,
          tenantId,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          createdByStaffId: currentStaffId || null,
          callerName,
          callerPhone,
          clientId: selectedClient?.id || null,
          clientName: selectedClient?.name || newClientName.trim() || '',
          note: draftNote.trim(),
          step,
          snapshot: buildSnapshot(),
          status: 'pending',
        }),
      );

      toast({ title: 'Saved for call-back', description: `${callerName} will appear in the pending call-backs list.` });
      setShowSaveDraftModal(false);
      setDraftNote('');
      setDraftCallerPhone('');
      onCancel();
    } catch {
      toast({ variant: 'destructive', title: 'Could not save', description: 'Please try again before ending the call.' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleResumeDraft = (draft: CallBackDraft) => {
    const matchedClient = draft.clientId ? (clients || []).find((c: any) => c.id === draft.clientId) : null;
    applySnapshot(draft.snapshot);
    if (matchedClient) {
      setSelectedClient(matchedClient);
      setIsNewClient(false);
    } else {
      setSelectedClient(null);
    }
    setCurrentDraftId(draft.id);
    setStep(draft.step || 1);
    toast({ title: 'Resumed', description: `Picking back up with ${draft.callerName}.` });
  };

  const handleDiscardDraft = async (id: string) => {
    if (!firestore || !tenantId) return;
    setDiscardingDraftId(id);
    try {
      await deleteDoc(doc(firestore, `tenants/${tenantId}/callBackDrafts`, id));
      if (currentDraftId === id) setCurrentDraftId(null);
    } catch {
      toast({ variant: 'destructive', title: 'Could not remove' });
    } finally {
      setDiscardingDraftId(null);
    }
  };

  const saveDraftModal = showSaveDraftModal ? (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => setShowSaveDraftModal(false)}
    >
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-sm font-semibold text-slate-900">Save & call back later</p>
          <p className="text-xs text-slate-400 mt-1">
            Everything entered so far is saved. Any staff member can pull this up from "Pending call-backs"
            and pick up exactly where you left off.
          </p>
        </div>
        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center text-sm [&_input]:border-none [&_input]:bg-transparent [&_input]:outline-none [&_input]:h-full [&_input]:w-full [&_input]:text-sm [&_.PhoneInputCountry]:mr-2">
          <PhoneInput
            international
            defaultCountry="US"
            value={draftCallerPhone}
            onChange={(v) => setDraftCallerPhone(v || '')}
            placeholder="(555) 000-0000"
          />
        </div>
        <textarea
          value={draftNote}
          onChange={e => setDraftNote(e.target.value)}
          placeholder="Quick note — e.g. checking with husband, will call back after 5pm"
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-xs resize-none outline-none focus:border-blue-300 bg-white"
        />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-10" onClick={() => setShowSaveDraftModal(false)}>
            Cancel
          </Button>
          <Button className="flex-1 h-10" onClick={handleSaveDraft} disabled={isSavingDraft}>
            {isSavingDraft ? <Loader className="w-4 h-4 animate-spin" /> : 'Save & close'}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const selectClient = (c: any) => {
    // Block immediately if banned
    if (c.status === 'blocked') {
      toast({
        variant: 'destructive',
        title: 'Client is blocked',
        description: `${c.name} cannot be booked. Check their client record for details.`,
      });
      return;
    }

    setSelectedClient(c);
    setIsNewClient(false);
    setClientSearch('');
    // Reset step-2 state for new client
    setSelectedService('');
    setAddOnIds([]);
    setDurationOffset(0);
    setSelectedStaff('any');
    setAptTime(format(addMinutes(new Date(), 30), 'HH:mm'));
    setGroupGuests([]);
    setIsGroup(false);
    setIsMultiProvider(false);
    setProviderLegs([]);
    setRedeemPackageId(null);
    setAddOnStaffOverrides({});

    if (c.lastServiceId) setSelectedService(c.lastServiceId);

    // Show arrears interstitial before proceeding to step 2
    if (safeNumber(c.outstandingBalance) > 0) {
      setShowArrearsInterstitial(true);
    } else {
      setStep(2);
    }
  };

  const checkDuplicates = React.useCallback(() => {
    const phone = newClientPhone.trim();
    const email = newClientEmail.trim().toLowerCase();
    const dupes = (clients || []).filter((c: any) =>
      (phone && c.phone === phone) || (email && c.email?.toLowerCase() === email),
    );
    setDuplicateSuggestions(dupes);
    if (dupes.length > 0) {
      setShowDuplicateWarning(true);
      return true;
    }
    return false;
  }, [clients, newClientPhone, newClientEmail]);

  const proceedNewClient = () => {
    setShowDuplicateWarning(false);
    setStep(2);
  };

  const toggleAddOn = (serviceId: string) => {
    const svc = services.find((s: any) => s.id === serviceId);
    // Compatibility check
    if (svc?.incompatibleWith?.includes(selectedService)) {
      toast({
        variant: 'destructive',
        title: 'Incompatible add-on',
        description: `${svc.name} cannot be combined with ${selectedSvc?.name || 'this service'}.`,
      });
      return;
    }
    setAddOnIds(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId],
    );
    // Clear any provider override for an add-on the moment it's turned off
    // — an override lingering for a removed add-on is harmless on its own
    // (it's keyed by serviceId, so it just sits unused), but leaving it
    // around risks resurrecting a stale assignment if the same add-on gets
    // re-added later in the same booking without the receptionist noticing.
    setAddOnStaffOverrides(prev => {
      if (!(serviceId in prev)) return prev;
      if (!addOnIds.includes(serviceId)) return prev; // being turned ON, nothing to clear
      const next = { ...prev };
      delete next[serviceId];
      return next;
    });
  };

  const applyPromoCode = async () => {
    if (!promoCode.trim()) return;
    setPromoChecking(true);
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, code: promoCode.trim(), serviceId: selectedService }),
      });
      const data = await res.json().catch(() => ({ valid: false }));
      if (data.valid) {
        setPromoDiscount({ type: data.type, amount: data.amount, label: data.label });
        toast({ title: 'Promo applied', description: data.label });
      } else {
        setPromoDiscount(null);
        toast({ variant: 'destructive', title: 'Invalid code', description: data.reason || 'Code not recognised.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Could not check code' });
    } finally {
      setPromoChecking(false);
    }
  };

  // v7 — applies an already-known-eligible discount directly, no server
  // round-trip needed since availableDiscounts already filtered for
  // eligibility client-side. Still records the code on the appointment
  // (promoCode field) for reporting consistency with the manual path.
  const applyListedDiscount = (d: any) => {
    setPromoCode(d.code || '');
    setPromoDiscount({
      type: d.type === 'percentage' ? 'pct' : 'flat',
      amount: d.value,
      label: d.description || d.code || 'Discount',
    });
    toast({ title: 'Discount applied', description: d.description || d.code });
  };

  const handleChargeArrears = async () => {
    if (!selectedClient || outstandingBalance <= 0) return;
    setIsChargingArrears(true);
    try {
      const amountCents = Math.round(outstandingBalance * 100);
      const res = await fetch('/api/stripe/charge-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          clientId: selectedClient.id,
          amountCents,
          description: 'Outstanding balance',
          category: 'Service Revenue',
          reason: 'Front desk collection at next booking',
          mode: 'auto',
          kind: 'arrears_fee',
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setArrearsResolved(true);

        // BUG FIX: the charge succeeding previously only updated local state.
        // The client's outstandingBalance field in Firestore was never
        // cleared, so the balance kept showing as owed on every later call or
        // visit. Persist it now, and update the in-memory client object so
        // this session reflects it immediately too.
        try {
          await setDoc(
            doc(firestore, `tenants/${tenantId}/clients`, selectedClient.id),
            sanitizeForFirestore({
              outstandingBalance: 0,
              arrearsClearedAt: new Date().toISOString(),
              arrearsClearedBy: currentStaffId || null,
            }),
            { merge: true },
          );
          setSelectedClient((prev: any) => (prev ? { ...prev, outstandingBalance: 0 } : prev));
        } catch {
          toast({
            variant: 'destructive',
            title: 'Charge succeeded, but balance field failed to clear',
            description: 'Check the client record — the outstanding balance may still show incorrectly.',
          });
        }

        toast({ title: 'Balance collected', description: `$${outstandingBalance.toFixed(2)} charged to card on file.` });
        if (showArrearsInterstitial) {
          setShowArrearsInterstitial(false);
          setStep(2);
        }
      } else {
        toast({ variant: 'destructive', title: 'Charge failed', description: data.reason || 'Could not charge card on file.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Could not reach payment processor.' });
    } finally {
      setIsChargingArrears(false);
    }
  };

  const handleAddToWaitlist = async () => {
    if (!selectedClient || !selectedService) return;
    try {
      const { nanoid: _nanoid } = await import('nanoid');
      const batch = writeBatch(firestore);
      const wlId = _nanoid();
      batch.set(doc(firestore, `tenants/${tenantId}/waitlist`, wlId), sanitizeForFirestore({
        id: wlId,
        tenantId,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        serviceId: selectedService,
        staffId: selectedStaff === 'any' ? null : selectedStaff,
        requestedDate: aptDate,
        createdAt: new Date().toISOString(),
        status: 'waiting',
      }));
      await batch.commit();
      toast({ title: 'Added to waitlist', description: `${selectedClient.name} will be notified when a slot opens.` });
    } catch {
      toast({ variant: 'destructive', title: 'Waitlist failed' });
    }
  };

  // ── Book ──────────────────────────────────────────────────────────────────
  const handleBook = async () => {
    const clientName = selectedClient?.name || newClientName.trim();
    if (!selectedService || !tenantId || !firestore) return;
    if (!selectedClient && !newClientName.trim()) {
      toast({ variant: 'destructive', title: 'Client name required' });
      return;
    }
    if (isGroup && !isGroupValid(groupGuests)) {
      toast({ variant: 'destructive', title: 'All guests need a name and service.' });
      return;
    }
    if (isMultiProvider && !isMultiProviderValid(providerLegs)) {
      toast({ variant: 'destructive', title: 'Every additional provider needs a service and staff member.' });
      return;
    }
    if (hasUnresolvedArrears && !arrearsOverrideReason) {
      toast({ variant: 'destructive', title: 'Outstanding balance', description: 'Collect the balance or choose a reason to proceed.' });
      return;
    }
    if (patchTestBlocking) {
      toast({ variant: 'destructive', title: 'Patch test required', description: `${selectedSvc?.name} requires a valid patch test.` });
      return;
    }

    const willChargeNow = canChargeOnFile && chargeNow && effectiveDepositCents > 0;

    if (!willChargeNow && sendLink && !clientEmail.trim()) {
      toast({ variant: 'destructive', title: 'Email required' });
      return;
    }

    // Charge confirmation guard — first tap sets pending, second tap executes
    if (willChargeNow && !chargeConfirmPending) {
      setChargeConfirmPending(true);
      setTimeout(() => setChargeConfirmPending(false), 4000);
      return;
    }
    setChargeConfirmPending(false);

    setIsSubmitting(true);
    setSlotConflict(false);
    setLedgerError(false);

    const { nanoid: _nanoid } = await import('nanoid');
    const now = new Date().toISOString();
    const groupBookingId = isGroup ? _nanoid() : null;
    const multiProviderGroupId = isMultiProvider && scheduledLegs.length > 0 ? _nanoid() : null;

    try {
      // ── Resolve / create client ──────────────────────────────────────────
      let clientId = selectedClient?.id;
      const startTime = new Date(`${aptDate}T${aptTime}:00`);
      const totalDuration =
        (selectedSvc?.duration || 60) +
        durationOffset +
        addOnIds.reduce((acc, id) => acc + (services.find((s: any) => s.id === id)?.duration || 0), 0);
      const endTime = addMinutes(startTime, totalDuration);
      // Tracks staff resolved via "Any available" in this booking, so the
      // turn-order counter only advances for actual any-available picks (not
      // explicit by-name requests) and so multiple any-available slots in one
      // booking don't all land on the same person.
      const anyAssignedStaffIds: string[] = [];
      // v6 — accumulated as legs/add-ons/group guests get their staff
      // resolved below, then baked into the success result so the
      // confirmation screen can show exactly who's working this
      // appointment instead of just a leg/guest count.
      const providersSummary: { name: string; detail: string }[] = [];
      const resolvedStaffId =
        selectedStaff === 'any'
          ? resolveAnyStaffId(aptDate, anyAssignedStaffIds, eligibleStaffIdsForAptTime)
          : selectedStaff;
      if (selectedStaff === 'any' && resolvedStaffId) anyAssignedStaffIds.push(resolvedStaffId);
      const resolvedPrimaryStaffMember = staff.find((s: any) => s.id === resolvedStaffId);
      providersSummary.push({
        name: resolvedPrimaryStaffMember?.name || 'Unassigned',
        detail: selectedSvc?.name || 'Primary service',
        avatarUrl: resolvedPrimaryStaffMember?.avatarUrl,
      });
      // Add-on provider overrides — same staff as primary unless explicitly
      // overridden via the per-add-on assignment UI in step 2.
      addOnIds.forEach((id) => {
        const overrideStaffId = addOnStaffOverrides[id];
        if (!overrideStaffId || overrideStaffId === resolvedStaffId) return;
        const addOnSvc = services.find((s: any) => s.id === id);
        const overrideStaffMember = staff.find((s: any) => s.id === overrideStaffId);
        if (addOnSvc && overrideStaffMember?.name) {
          providersSummary.push({ name: overrideStaffMember.name, detail: addOnSvc.name, avatarUrl: overrideStaffMember.avatarUrl });
        }
      });
      const aptId = _nanoid();
      const checkInToken = _nanoid();
      // v5 — shared across the primary appointment and every future
      // recurring occurrence created after the main batch commits below.
      const recurrenceId = isRecurring && recurrenceCount > 1 ? _nanoid() : null;

      // ── Slot concurrency guard ───────────────────────────────────────────
      // Use a Firestore transaction to atomically check + reserve the slot
      // before committing the full appointment batch.
      if (resolvedStaffId) {
        try {
          await runTransaction(firestore, async (tx) => {
            const slotRef = doc(
              firestore,
              `tenants/${tenantId}/slotLocks`,
              `${resolvedStaffId}_${aptDate}_${aptTime.replace(':', '')}`,
            );
            const existing = await tx.get(slotRef);
            if (existing.exists()) {
              throw new Error('SLOT_TAKEN');
            }
            tx.set(slotRef, {
              staffId: resolvedStaffId,
              date: aptDate,
              time: aptTime,
              aptId,
              reservedAt: now,
              // TTL: the booking batch will delete this and replace with the
              // actual appointment. If the batch fails, a Cloud Function
              // cleans up locks older than 5 minutes.
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });
          });
        } catch (e: any) {
          if (e?.message === 'SLOT_TAKEN') {
            setSlotConflict(true);
            toast({
              variant: 'destructive',
              title: 'Slot just taken',
              description: 'Someone else booked that slot. Please pick another time.',
            });
            setIsSubmitting(false);
            return;
          }
          // Non-conflict transaction error — proceed anyway (best effort)
        }
      }

      // ── If willChargeNow and new client, commit client first ──────────────
      if (willChargeNow && !selectedClient) {
        clientId = _nanoid();
        const clientBatch = writeBatch(firestore);
        clientBatch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
          id: clientId,
          name: clientName,
          phone: newClientPhone.trim(),
          email: newClientEmail.trim(),
          lifetimeValue: 0,
          lastAppointment: now,
          status: 'active',
          reminderSent: false,
        }));
        await clientBatch.commit();
      } else if (!selectedClient) {
        clientId = _nanoid();
      }

      // ── Charge card on file ───────────────────────────────────────────────
      let effectiveSendLink = sendLink;
      let chargeResultForLedger: { paymentIntentId: string } | null = null;
      let chargeOutcome: ChargeOutcome = null;

      if (willChargeNow) {
        try {
          const chargeRes = await fetch('/api/stripe/charge-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              clientId,
              amountCents: effectiveDepositCents,
              description: `Deposit — ${selectedSvc?.name || 'Appointment'}${multiProviderGroupId ? ' + additional providers' : ''}${promoDiscount ? ` (${promoDiscount.label})` : ''}`,
              category: 'Retainers',
              appointmentId: aptId,
              reason: 'Quick Book deposit',
              mode: 'auto',
              kind: 'deposit',
            }),
          });
          const chargeData = await chargeRes.json().catch(() => ({ ok: false, reason: 'Charge request failed' }));

          if (chargeData.ok) {
            chargeResultForLedger = { paymentIntentId: chargeData.paymentIntentId };
            effectiveSendLink = false;
            chargeOutcome = { charged: true, amountDollars: chargeData.amount ?? effectiveDepositCents / 100 };
          } else {
            effectiveSendLink = true;
            chargeOutcome = { charged: false, reason: chargeData.reason || 'Card charge failed' };
            toast({
              variant: 'destructive',
              title: 'Card declined',
              description: `${chargeData.reason || 'Charge failed'} — sending a completion link instead.`,
            });
          }
        } catch {
          effectiveSendLink = true;
          chargeOutcome = { charged: false, reason: 'Could not reach payment processor' };
        }

        if (effectiveSendLink && !clientEmail.trim()) {
          effectiveSendLink = false;
          toast({
            title: 'No email on file',
            description: 'Charge failed and no email available. Booking without payment — follow up with the client.',
          });
        }
      }

      // ── Main batch ────────────────────────────────────────────────────────
      const batch = writeBatch(firestore);

      // Client doc (new client, non-charge path)
      if (!selectedClient) {
        batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
          id: clientId,
          name: clientName,
          phone: newClientPhone.trim(),
          email: newClientEmail.trim(),
          lifetimeValue: 0,
          lastAppointment: now,
          status: 'active',
          reminderSent: false,
        }));
      } else {
        const updates: any = {};
        if (newClientEmail.trim() && !selectedClient.email) updates.email = newClientEmail.trim();
        if (Object.keys(updates).length) {
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), updates, { merge: true });
        }
      }

      // Primary appointment
      const aptDoc = sanitizeForFirestore({
        id: aptId,
        tenantId,
        clientId,
        clientName,
        serviceId: selectedService,
        addOnIds: addOnIds.length > 0 ? addOnIds : undefined,
        durationOverrideMinutes: durationOffset > 0 ? durationOffset : undefined,
        staffId: resolvedStaffId,
        checkInToken,
        status: 'confirmed',
        source: 'pos_quick_book',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        createdAt: now,
        reminderSent: false,
        reminderHours: parseInt(reminderHours, 10),
        autoCancelledNoShow: false,
        notes: clientNotes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        groupBookingId: groupBookingId || undefined,
        multiProviderGroupId: multiProviderGroupId || undefined,
        sequenceIndex: multiProviderGroupId ? 0 : undefined,
        recurrenceId: recurrenceId || undefined,
        promoCode: promoDiscount ? promoCode.trim() : undefined,
        promoDiscountCents: discountCents > 0 ? discountCents : undefined,
        // v5 — per-add-on provider assignment, written into the same
        // checkoutState.serviceStaffOverrides shape AddAndConfigurePartsDialog
        // / AppointmentDetailsSheet already read post-booking.
        ...(Object.keys(addOnStaffOverrides).length > 0 ? {
          checkoutState: { serviceStaffOverrides: addOnStaffOverrides, concurrentServiceIds: [] },
        } : {}),
        ...(effectiveSendLink ? {
          completionStatus: 'pending',
          depositAmountCents: effectiveDepositCents,
          depositStatus: effectiveDepositCents > 0 ? 'pending' : 'none',
        } : {}),
        ...(chargeResultForLedger ? {
          depositAmountCents: effectiveDepositCents,
          depositStatus: 'paid',
          depositPaymentIntentId: chargeResultForLedger.paymentIntentId,
        } : {}),
        ...(redeemPackageId ? { redeemedPackageId: redeemPackageId } : {}),
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

      // Client update
      batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
        lastServiceId: selectedService,
        lastAppointment: now,
        ...(redeemPackageId ? {
          activePackages: (selectedClient?.activePackages || [])
            .map((p: any) => p.packageId === redeemPackageId
              ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 }
              : p)
            .filter((p: any) => p.sessionsRemaining > 0),
        } : {}),
      }), { merge: true });

      // Delete slot lock
      if (resolvedStaffId) {
        batch.delete(doc(
          firestore,
          `tenants/${tenantId}/slotLocks`,
          `${resolvedStaffId}_${aptDate}_${aptTime.replace(':', '')}`,
        ));
      }

      // Multi-provider legs
      if (multiProviderGroupId && scheduledLegs.length > 0) {
        scheduledLegs.forEach((leg, idx) => {
          const legSvc = services.find((s: any) => s.id === leg.serviceId);
          // No per-slot availability data exists for legs (unlike the primary
          // booking time), so this can only check shift + active status, not
          // whether this specific person is free at the leg's computed time —
          // a real gap until multi-provider legs get their own availability
          // check. Flagging rather than silently pretending it's covered.
          const legStaffId = leg.staffId === 'any' ? resolveAnyStaffId(aptDate, anyAssignedStaffIds) : leg.staffId;
          if (leg.staffId === 'any' && legStaffId) anyAssignedStaffIds.push(legStaffId);
          const legStaffMemberForSummary = staff.find((s: any) => s.id === legStaffId);
          providersSummary.push({
            name: legStaffMemberForSummary?.name || 'Unassigned',
            detail: legSvc?.name || 'Service',
            avatarUrl: legStaffMemberForSummary?.avatarUrl,
          });
          const legId = _nanoid();
          const legToken = _nanoid();
          batch.set(doc(firestore, `tenants/${tenantId}/appointments`, legId), sanitizeForFirestore({
            id: legId, tenantId, clientId, clientName,
            serviceId: leg.serviceId,
            staffId: legStaffId,
            checkInToken: legToken,
            status: 'confirmed',
            source: 'pos_quick_book',
            startTime: leg.startTime.toISOString(),
            endTime: leg.endTime.toISOString(),
            createdAt: now,
            reminderSent: false,
            autoCancelledNoShow: false,
            multiProviderGroupId,
            sequenceIndex: idx + 1,
            internalNotes: internalNotes.trim() || undefined,
          }));
          batch.set(doc(firestore, 'appointmentCheckIns', legToken), sanitizeForFirestore({
            id: legId, tenantId, clientId, clientName,
            serviceId: leg.serviceId,
            staffId: legStaffId,
            checkInToken: legToken,
            status: 'confirmed',
            startTime: leg.startTime.toISOString(),
            endTime: leg.endTime.toISOString(),
            multiProviderGroupId,
            sequenceIndex: idx + 1,
          }));
        });
      }

      // Group guest appointments
      if (isGroup && groupGuests.length > 0) {
        for (const guest of groupGuests) {
          if (!guest.name.trim() || !guest.serviceId) continue;
          // v6 — honor a linked existing client instead of always minting a
          // duplicate. This was flagged as a known gap in GroupBookingPanel's
          // header notes since v2 but never actually wired up here — every
          // linked guest was still getting a brand-new client doc.
          const linkedGuestClient = guest.linkedClientId
            ? (clients || []).find((c: any) => c.id === guest.linkedClientId)
            : null;
          const gClientId = guest.linkedClientId || _nanoid();
          const gAptId = _nanoid();
          const gToken = _nanoid();
          const gSvc = services.find((s: any) => s.id === guest.serviceId);
          const gStaffId = guest.staffId === 'any' ? resolveAnyStaffId(aptDate, anyAssignedStaffIds) : guest.staffId;
          if (guest.staffId === 'any' && gStaffId) anyAssignedStaffIds.push(gStaffId);
          const gStaffMemberForSummary = staff.find((s: any) => s.id === gStaffId);
          providersSummary.push({
            name: gStaffMemberForSummary?.name || 'Unassigned',
            detail: `${gSvc?.name || 'Service'} (${guest.name.split(' ')[0]})`,
            avatarUrl: gStaffMemberForSummary?.avatarUrl,
          });
          const gAddOnIds = guest.addOnIds || [];
          const gAddOnDuration = gAddOnIds.reduce((acc, id) => acc + (services.find((s: any) => s.id === id)?.duration || 0), 0);
          const gEnd = addMinutes(startTime, (gSvc?.duration || 60) + gAddOnDuration);

          if (linkedGuestClient) {
            // Real client — just bump their visit record, don't recreate them.
            batch.set(doc(firestore, `tenants/${tenantId}/clients`, gClientId), sanitizeForFirestore({
              lastServiceId: guest.serviceId,
              lastAppointment: now,
            }), { merge: true });
          } else {
            // Create a minimal client record for the guest
            batch.set(doc(firestore, `tenants/${tenantId}/clients`, gClientId), sanitizeForFirestore({
              id: gClientId,
              name: guest.name,
              phone: guest.phone || undefined,
              email: guest.email || undefined,
              birthday: guest.birthday || undefined,
              marketingConsent: guest.marketingConsent || undefined,
              status: 'active',
              lifetimeValue: 0,
              lastAppointment: now,
              groupLinkedTo: clientId,
            }));
          }

          batch.set(doc(firestore, `tenants/${tenantId}/appointments`, gAptId), sanitizeForFirestore({
            id: gAptId, tenantId,
            clientId: gClientId,
            clientName: guest.name,
            serviceId: guest.serviceId,
            addOnIds: gAddOnIds.length > 0 ? gAddOnIds : undefined,
            staffId: gStaffId,
            checkInToken: gToken,
            status: 'confirmed',
            source: 'pos_quick_book_group',
            startTime: startTime.toISOString(),
            endTime: gEnd.toISOString(),
            createdAt: now,
            reminderSent: false,
            autoCancelledNoShow: false,
            groupBookingId,
            isPrimaryGroup: false,
          }));
        }
      }

      // Completion link
      let link: string | null = null;
      if (effectiveSendLink) {
        const token = _nanoid();
        const expiryDays = safeNumber(tenant?.completionLinkExpiryDays) || 7;
        const expiresAt = new Date(Date.now() + expiryDays * 24 * 3600 * 1000).toISOString();
        batch.set(doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), sanitizeForFirestore({
          token, tenantId,
          appointmentId: aptId,
          clientId,
          clientName,
          clientEmail: clientEmail.trim().toLowerCase(),
          serviceId: selectedService,
          serviceName: selectedSvc?.name || '',
          depositAmountCents: effectiveDepositCents,
          requiredConsentFormIds: formsNeedingSignature.map(f => f.id),
          skipCardStep: alreadyHasCard,
          cardAlreadyOnFile: alreadyHasCard,
          fileRequirements: requestFiles ? [{
            id: 'inspo',
            type: 'file_upload',
            label: 'Inspiration photos',
            required: true,
            prompt: 'Share your inspiration photos',
            minCount: 1,
            maxCount: 5,
            acceptedTypes: ['image/*'],
          }] : [],
          status: 'pending',
          createdAt: now,
          expiresAt,
        }));
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        link = `${origin}/complete/${tenantId}/${token}`;
      }

      await batch.commit();

      // ── Recurring occurrences (v5) ──────────────────────────────────────────
      // Best-effort: unlike the primary booking, these don't run the
      // slot-lock transaction or a per-slot availability check (same
      // documented gap as multi-provider legs above) — far-future dates
      // make a strict check impractical here, and a double-booked
      // recurring slot is something staff can catch on the calendar same
      // as any manually-created conflict. "Any available" occurrences each
      // re-resolve independently per date via resolveAnyStaffId, including
      // shift data for that date if it exists yet.
      if (recurrenceId && isRecurring && recurrenceCount > 1) {
        try {
          const recurBatch = writeBatch(firestore);
          const addDateOffset = (d: Date, occurrenceIndex: number) => {
            if (recurrenceInterval === 'weekly') return addWeeks(d, occurrenceIndex);
            if (recurrenceInterval === 'biweekly') return addDays(d, occurrenceIndex * 14);
            return addMonths(d, occurrenceIndex);
          };
          for (let i = 1; i < recurrenceCount; i++) {
            const occStart = addDateOffset(startTime, i);
            const occEnd = addMinutes(occStart, totalDuration);
            const occDateStr = format(occStart, 'yyyy-MM-dd');
            const occStaffId = selectedStaff === 'any'
              ? resolveAnyStaffId(occDateStr, [], undefined)
              : selectedStaff;
            const occId = _nanoid();
            const occToken = _nanoid();
            recurBatch.set(doc(firestore, `tenants/${tenantId}/appointments`, occId), sanitizeForFirestore({
              id: occId,
              tenantId,
              clientId,
              clientName,
              serviceId: selectedService,
              addOnIds: addOnIds.length > 0 ? addOnIds : undefined,
              staffId: occStaffId,
              checkInToken: occToken,
              status: 'confirmed',
              source: 'pos_quick_book',
              startTime: occStart.toISOString(),
              endTime: occEnd.toISOString(),
              createdAt: now,
              reminderSent: false,
              reminderHours: parseInt(reminderHours, 10),
              autoCancelledNoShow: false,
              recurrenceId,
              sequenceIndex: i,
              internalNotes: internalNotes.trim() || undefined,
              ...(Object.keys(addOnStaffOverrides).length > 0 ? {
                checkoutState: { serviceStaffOverrides: addOnStaffOverrides, concurrentServiceIds: [] },
              } : {}),
            }));
            recurBatch.set(doc(firestore, 'appointmentCheckIns', occToken), sanitizeForFirestore({
              id: occId, tenantId, clientId, clientName,
              serviceId: selectedService,
              staffId: occStaffId,
              checkInToken: occToken,
              status: 'confirmed',
              startTime: occStart.toISOString(),
              endTime: occEnd.toISOString(),
              recurrenceId,
              sequenceIndex: i,
            }));
          }
          await recurBatch.commit();
        } catch {
          toast({
            variant: 'destructive',
            title: 'Some recurring visits may not have been created',
            description: 'The first appointment is booked — check the calendar for the rest of the series.',
          });
        }
      }

      // ── Per-leg ledger entries ─────────────────────────────────────────────
      let ledgerFailed = false;
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
          ledgerFailed = true;
          setLedgerError(true);
        }
      }

      // ── Send completion link notification ─────────────────────────────────
      let sendStatus: any = null;
      if (link) {
        const clientPhone = selectedClient?.phone || newClientPhone;
        try {
          const sr = await fetch('/api/notifications/send-completion-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              link,
              clientName,
              clientEmail: clientEmail.trim(),
              clientPhone,
              studioName: tenant?.name,
            }),
          });
          sendStatus = await sr.json().catch(() => null);
        } catch { /* non-fatal */ }
      }

      // Advance the call-in turn order for anyone assigned via "Any available" —
      // explicit by-name requests don't consume rotation position.
      if (anyAssignedStaffIds.length > 0) {
        try {
          const turnBatch = writeBatch(firestore);
          const nowIso = new Date().toISOString();
          Array.from(new Set(anyAssignedStaffIds)).forEach(sid => {
            turnBatch.set(
              doc(firestore, `tenants/${tenantId}/staff`, sid),
              { lastBookingAssignedAt: nowIso },
              { merge: true },
            );
          });
          await turnBatch.commit();
        } catch { /* non-fatal — fairness ledger update, doesn't block the booking */ }
      }

      // Resolve (delete) any pending call-back draft this booking originated from
      if (currentDraftId) {
        try {
          await deleteDoc(doc(firestore, `tenants/${tenantId}/callBackDrafts`, currentDraftId));
        } catch { /* non-fatal */ }
        setCurrentDraftId(null);
      }

      // ── Show success screen ───────────────────────────────────────────────
      const depositPaidDollars = chargeOutcome?.charged ? chargeOutcome.amountDollars : 0;
      setSuccessResult({
        appointmentId: aptId,
        tenantId,
        checkInToken,
        clientName,
        clientEmail: clientEmail.trim(),
        clientPhone: selectedClient?.phone || newClientPhone || '',
        serviceName: selectedSvc?.name || '',
        aptDate,
        aptTime,
        locationName: tenant?.name || tenant?.locationName || 'Main Studio',
        totalMinutes: totalDuration,
        totalDollars: grandTotal,
        depositPaidDollars,
        remainingBalanceDollars: grandTotal - depositPaidDollars,
        providersSummary,
        chargeOutcome,
        generatedLink: link,
        sendStatus,
        isGroup,
        groupGuestCount: groupGuests.length,
        isMultiProvider,
        legCount: scheduledLegs.length,
        ledgerError: ledgerFailed,
      });

    } catch (e) {
      toast({ variant: 'destructive', title: 'Booking failed', description: 'Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setSelectedClient(null);
    setSelectedService('');
    setAddOnIds([]);
    setAddOnStaffOverrides({});
    setIsRecurring(false);
    setRecurrenceInterval('weekly');
    setRecurrenceCount(4);
    setDurationOffset(0);
    setAptTime(format(addMinutes(new Date(), 15), 'HH:mm'));
    setAptDate(format(new Date(), 'yyyy-MM-dd'));
    setClientNotes('');
    setInternalNotes('');
    setIsNewClient(false);
    setNewClientName('');
    setNewClientPhone('');
    setNewClientEmail('');
    setIsGroup(false);
    setGroupGuests([]);
    setIsMultiProvider(false);
    setProviderLegs([]);
    setRedeemPackageId(null);
    setChargeNow(true);
    setChargeConfirmPending(false);
    setPromoCode('');
    setPromoDiscount(null);
    setArrearsResolved(false);
    setArrearsOverrideReason('');
    setArrearsOverrideDetail('');
    setShowArrearsOverride(false);
    setShowArrearsInterstitial(false);
    setSuccessResult(null);
    setLedgerError(false);
    setSlotConflict(false);
    setWaitlistMode(false);
    setCurrentDraftId(null);
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (successResult) {
    return (
      <SuccessScreen
        result={successResult}
        onBookAnother={resetForm}
        onDone={onSuccess}
      />
    );
  }

  // ── Step 1: Client ────────────────────────────────────────────────────────
  if (step === 1) {
    // Arrears interstitial
    if (showArrearsInterstitial && selectedClient) {
      return (
        <div className="space-y-5">
          {saveDraftModal}
          <CommandBar step={1} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border">
            <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600 shrink-0">
              {selectedClient.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">{selectedClient.name}</p>
              <ContactLine contact={selectedClient} compact className="text-xs text-slate-400" />
            </div>
          </div>

          <ArrearsBanner
            outstandingBalance={outstandingBalance}
            clientFirstName={selectedClient.name?.split(' ')[0] || 'This client'}
            canChargeOnFile={canChargeOnFile}
            isChargingArrears={isChargingArrears}
            arrearsResolved={arrearsResolved}
            showOverride={showArrearsOverride}
            overrideReason={arrearsOverrideReason}
            overrideDetail={arrearsOverrideDetail}
            onChargeArrears={handleChargeArrears}
            onShowOverride={() => setShowArrearsOverride(true)}
            onSetOverrideReason={setArrearsOverrideReason}
            onSetOverrideDetail={setArrearsOverrideDetail}
            onCancelOverride={() => { setShowArrearsOverride(false); setArrearsOverrideReason(''); setArrearsOverrideDetail(''); }}
          />

          {(arrearsResolved || arrearsOverrideReason) && (
            <Button onClick={() => { setShowArrearsInterstitial(false); setStep(2); }} className="w-full h-11">
              Continue to service →
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedClient(null); setShowArrearsInterstitial(false); }}
            className="w-full text-slate-400"
          >
            ← Choose a different client
          </Button>
        </div>
      );
    }

    // Duplicate warning
    if (showDuplicateWarning && duplicateSuggestions.length > 0) {
      return (
        <div className="space-y-5">
          {saveDraftModal}
          <CommandBar step={1} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Possible duplicate client</p>
                <p className="text-xs text-amber-700/80 mt-0.5">
                  A client with the same phone or email already exists. Select them or continue creating a new record.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {duplicateSuggestions.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-white border border-amber-200 hover:border-amber-400 text-left transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{c.name}</p>
                    <ContactLine contact={c} compact className="text-xs text-slate-400" />
                  </div>
                  <span className="text-xs text-amber-700 font-medium">Use this client →</span>
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={proceedNewClient} className="w-full">
              Create new record anyway
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {saveDraftModal}
        <CommandBar step={1} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />

        {/* v5 — fills the blank space between the search bar and recent
            clients with something real, not decorative. */}
        {!clientSearch && !isNewClient && (
          <div className="rounded-xl border bg-white px-3.5 py-2.5 flex items-center gap-2.5">
            <CalendarCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <p className="text-xs text-slate-600">
              {todaysRemainingCount > 0
                ? <><span className="font-medium text-slate-900">{todaysRemainingCount}</span> appointment{todaysRemainingCount !== 1 ? 's' : ''} left today</>
                : 'Nothing else on the books for today'}
            </p>
          </div>
        )}

        {/* Pending call-backs — visible to every staff member, resumable from here */}
        {callBackDrafts.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
            <div className="px-3.5 py-2 flex items-center gap-2 border-b border-amber-200/60">
              <PhoneIncoming className="w-3.5 h-3.5 text-amber-600" />
              <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                Pending call-backs · {callBackDrafts.length}
              </p>
            </div>
            <div className="divide-y divide-amber-200/60">
              {callBackDrafts.map(d => (
                <div key={d.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">{d.callerName || 'Unknown caller'}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {d.callerPhone || '—'}{d.note ? ` · ${d.note}` : ''}
                    </p>
                    <p className="text-[10px] text-amber-600 mt-0.5">{safeRelativeTime(d.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" className="h-8 text-xs" onClick={() => handleResumeDraft(d)}>
                      Resume
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDiscardDraft(d.id)}
                      disabled={discardingDraftId === d.id}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isNewClient ? (
          <div className="space-y-4">
            <button
              onClick={() => setIsNewClient(false)}
              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
            >
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
            <p className="text-xs text-slate-400 uppercase tracking-wider">New client</p>
            <Input
              autoFocus
              placeholder="Full name *"
              value={newClientName}
              onChange={e => setNewClientName(e.target.value)}
              className="h-11"
            />
            <div className="h-11 rounded-md border border-input bg-background px-3 flex items-center [&_input]:border-none [&_input]:bg-transparent [&_input]:outline-none [&_input]:h-full [&_input]:w-full [&_input]:text-sm [&_.PhoneInputCountry]:mr-2">
              <PhoneInput
                international
                defaultCountry="US"
                value={newClientPhone}
                onChange={(v) => setNewClientPhone(v || '')}
                placeholder="(555) 000-0000"
              />
            </div>
            <Input
              placeholder="Email (for link & receipt)"
              value={newClientEmail}
              onChange={e => setNewClientEmail(e.target.value)}
              className="h-11"
              type="email"
            />
            <Button
              disabled={!newClientName.trim()}
              onClick={() => {
                const hasDupes = checkDuplicates();
                if (!hasDupes) setStep(2);
              }}
              className="w-full h-11"
            >
              Continue → Pick service
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Input
                ref={searchRef}
                placeholder="Search by name, phone, or email…"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                className="h-11 pr-10"
              />
              {clientSearch && (
                <button
                  onClick={() => setClientSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>

            {filteredClients.length > 0 && (
              <div className="rounded-xl border divide-y overflow-hidden">
                {filteredClients.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => selectClient(c)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                        c.status === 'blocked'
                          ? 'bg-red-100 text-red-600'
                          : 'bg-slate-100 text-slate-500',
                      )}>
                        {c.status === 'blocked'
                          ? <Ban className="w-3.5 h-3.5" />
                          : c.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{c.name}</p>
                        <ContactLine contact={c} compact className="text-xs text-slate-400" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.status === 'blocked' && (
                        <span className="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Blocked</span>
                      )}
                      {safeNumber(c.outstandingBalance) > 0 && (
                        <span className="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                          Owes ${safeNumber(c.outstandingBalance).toFixed(0)}
                        </span>
                      )}
                      {c.lastServiceId && (
                        <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Rebook</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {clientSearch && filteredClients.length === 0 && (
              <button
                onClick={() => { setNewClientName(clientSearch); setIsNewClient(true); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-dashed border-slate-200 hover:border-blue-200 hover:bg-blue-50/50 transition-all text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Create "{clientSearch}"</p>
                  <p className="text-xs text-slate-400">New client · add details next</p>
                </div>
              </button>
            )}

            {!clientSearch && recentClients.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Recent clients</p>
                <div className="rounded-xl border divide-y overflow-hidden">
                  {recentClients.map((c: any) => (
                    <button
                      key={c.id}
                      onClick={() => selectClient(c)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          'w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                          c.status === 'blocked' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500',
                        )}>
                          {c.status === 'blocked' ? <Ban className="w-3.5 h-3.5" /> : c.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{c.name}</p>
                          <ContactLine contact={c} compact className="text-xs text-slate-400" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {lastVisitByClientId[c.id] && (
                          <span className="text-[10px] text-slate-400">
                            {format(new Date(lastVisitByClientId[c.id]), 'MMM d')}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!clientSearch && (
              <button
                onClick={() => setIsNewClient(true)}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-dashed border-slate-200 hover:border-blue-200 hover:bg-blue-50/50 transition-all text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs font-medium text-slate-500">New client</p>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Step 2: Service + Provider + Time ─────────────────────────────────────
  if (step === 2) {
    return (
      <div className="space-y-5">
        {saveDraftModal}
        <CommandBar step={2} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />

        {/* Client profile — comprehensive, always expanded */}
        {selectedClient ? (
          <ClientDetailPanel
            client={selectedClient}
            appointments={appointments}
            services={services}
            staff={staff}
            outstandingBalance={outstandingBalance}
            patchTestDate={patchTestDate}
            patchTestExpired={patchTestExpired}
            selectedSvcRequiresPatchTest={selectedSvcRequiresPatchTest}
            formStatuses={formStatuses}
            activePackages={activePackages}
            getFormName={getFormName}
            firestore={firestore}
            tenantId={tenantId}
            onChangeClient={() => { setStep(1); setSelectedService(''); }}
            onUpdateClient={(updates) => setSelectedClient((prev: any) => (prev ? { ...prev, ...updates } : prev))}
          />
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center gap-3 px-3.5 py-2.5 bg-white">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-medium text-slate-500 shrink-0">
                {newClientName.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{newClientName || 'New client'}</p>
                <p className="text-[11px] text-slate-400">New client · no history yet</p>
              </div>
              <button
                onClick={() => { setStep(1); setSelectedService(''); }}
                className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
              >
                Change
              </button>
            </div>
          </div>
        )}

        {/* Intelligence panel */}
        <ClientIntelligencePanel
          intel={intel}
          staff={staff}
          onActionClick={(insight) => {
            if (insight.actionData?.serviceId) {
              setSelectedService(insight.actionData.serviceId as string);
              setAddOnIds([]);
              setAddOnStaffOverrides({});
              setDurationOffset(0);
            }
          }}
        />

        {/* v5 — package/membership nudges, dismissible by simply not acting
            on them — non-blocking, never required to proceed. */}
        {showPackageNudge && matchingPackage && (
          <div className="rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-3 flex items-start gap-2.5">
            <Gift className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-purple-800">
                {selectedClient?.name?.split(' ')[0]} has booked this {pastVisitsForSelectedService}× — a package could save them money
              </p>
              <p className="text-[11px] text-purple-700/80 mt-0.5">
                {matchingPackage.name} · ${matchingPackage.price} for {matchingPackage.sessions} visits
              </p>
            </div>
          </div>
        )}
        {showMembershipNudge && cheapestMembership && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-3 flex items-start gap-2.5">
            <Award className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-indigo-800">Worth mentioning {cheapestMembership.name}</p>
              <p className="text-[11px] text-indigo-700/80 mt-0.5">
                ${cheapestMembership.price}/{cheapestMembership.interval} · based on their spend, this could pay for itself
              </p>
            </div>
          </div>
        )}

        {/* Rebook shortcut */}
        {lastService && (
          <button
            onClick={() => setSelectedService(lastService.id)}
            className={cn(
              'w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left',
              selectedService === lastService.id
                ? 'border-blue-200 bg-blue-50'
                : 'border-amber-200 bg-amber-50 hover:border-amber-300',
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div>
                <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">Rebook last service</p>
                <p className="text-xs text-slate-900">{lastService.name} · {lastService.duration}m · ${getServicePrice(lastService, resolvedStaffForPrice)}</p>
              </div>
            </div>
            {selectedService === lastService.id && <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />}
          </button>
        )}

        {/* Service list */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Service</p>
          <div className="rounded-xl border overflow-hidden bg-white divide-y">
            {services.filter((s: any) => s.type === 'service').map((s: any) => {
              const price = getServicePrice(s, resolvedStaffForPrice);
              const needsPatch = s.requiresPatchTest && patchTestExpired;
              const isSelected = selectedService === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedService(s.id);
                    setAddOnIds([]);
                    setAddOnStaffOverrides({});
                    setDurationOffset(0);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      isSelected ? 'bg-blue-500' : 'bg-slate-200',
                    )} />
                    <div>
                      <p className={cn('text-sm', isSelected ? 'font-medium text-blue-700' : 'text-slate-900')}>
                        {s.name}
                      </p>
                      <p className="text-[11px] text-slate-400">{s.duration}m</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {needsPatch && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        <FlaskConical className="w-2.5 h-2.5" /> Patch test
                      </span>
                    )}
                    <p className={cn('text-sm', isSelected ? 'font-medium text-blue-700' : 'text-slate-900')}>
                      ${price.toFixed(0)}
                    </p>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-500" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Patch test warning */}
        {patchTestBlocking && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 flex items-start gap-2.5">
            <FlaskConical className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-800">Patch test required</p>
              <p className="text-[11px] text-amber-700/80 mt-0.5">
                {patchTestDate
                  ? `Last patch test was ${format(patchTestDate, 'MMM d yyyy')} — more than ${PATCH_TEST_VALIDITY_MONTHS} months ago.`
                  : 'No patch test on record.'}
                {' '}This service cannot be booked without a valid patch test.
              </p>
            </div>
          </div>
        )}

        {/* Duration override */}
        {selectedSvc && (
          <div className="flex items-center gap-3 px-1">
            <p className="text-xs text-slate-500 flex-1">
              Duration: {(selectedSvc.duration || 60) + durationOffset} min
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setDurationOffset(prev => Math.max(0, prev - 15))}
                disabled={durationOffset === 0}
                className="w-7 h-7 rounded-lg border flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 disabled:opacity-30 transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs text-slate-500 w-12 text-center">
                {durationOffset === 0 ? 'Standard' : `+${durationOffset}m`}
              </span>
              <button
                onClick={() => setDurationOffset(prev => Math.min(60, prev + 15))}
                disabled={durationOffset >= 60}
                className="w-7 h-7 rounded-lg border flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 disabled:opacity-30 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* v5/v6 — direct date jump (Quick Book redesign: "schedule weeks or
            months outward"). Previously the only way to move aptDate was
            one day at a time via the no-slots "Try tomorrow" button or
            whatever date-nav exists inside SmartAvailabilityGrid — there
            was no way to jump straight to, say, six weeks from now. This is
            always visible regardless of slot availability. v6 adds the
            relative-distance label and back/Today controls so it's clear
            how far out you've moved, with an easy way to step back. */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Date</p>
            <span className={cn('text-[10px] font-medium', aptDate === todayStr ? 'text-slate-400' : 'text-blue-600')}>
              {aptDateOffsetLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-10 rounded-lg border bg-white px-3 flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={aptDate}
                onChange={(e) => e.target.value && setAptDate(e.target.value)}
                className="flex-1 text-xs outline-none bg-transparent min-w-0"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAptDate(format(addMonths(new Date(`${aptDate}T00:00`), -1), 'yyyy-MM-dd'))}
              className="flex-1 h-9 rounded-lg border text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
            >
              −1 mo
            </button>
            <button
              type="button"
              onClick={() => setAptDate(format(addWeeks(new Date(`${aptDate}T00:00`), -1), 'yyyy-MM-dd'))}
              className="flex-1 h-9 rounded-lg border text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
            >
              −1 wk
            </button>
            <button
              type="button"
              onClick={() => setAptDate(todayStr)}
              disabled={aptDate === todayStr}
              className="flex-1 h-9 rounded-lg border text-xs font-medium text-blue-600 hover:border-blue-300 transition-colors disabled:opacity-40 disabled:hover:border-slate-200"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAptDate(format(addWeeks(new Date(`${aptDate}T00:00`), 1), 'yyyy-MM-dd'))}
              className="flex-1 h-9 rounded-lg border text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
            >
              +1 wk
            </button>
            <button
              type="button"
              onClick={() => setAptDate(format(addMonths(new Date(`${aptDate}T00:00`), 1), 'yyyy-MM-dd'))}
              className="flex-1 h-9 rounded-lg border text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
            >
              +1 mo
            </button>
          </div>
        </div>

        {/* Provider chips */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Provider</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedStaff('any')}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                selectedStaff === 'any'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300',
              )}
            >
              Any available
            </button>
            {activeStaff.map((s: any) => {
              const load = staffDateLoad[s.id] || 0;
              const isFullyBooked = load >= (s.maxDailyAppointments || 99);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStaff(s.id)}
                  className={cn(
                    'pl-1.5 pr-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5',
                    selectedStaff === s.id
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : isFullyBooked
                        ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                  disabled={isFullyBooked}
                >
                  <StaffAvatar staffMember={s} size="w-5 h-5" />
                  {s.name.split(' ')[0]}
                  {!isFullyBooked && (
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      s.status === 'idle' || s.status === 'available' ? 'bg-green-400' : 'bg-slate-300',
                    )} />
                  )}
                  {isFullyBooked && (
                    <span className="text-[9px] text-slate-300">Full</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Smart availability grid */}
        {selectedService && !hasNoSlots && (
          <SmartAvailabilityGrid
            slots={displaySlots}
            addOnUpsells={addOnUpsells}
            selectedTime={aptTime}
            onSelectTime={(time, staffId) => {
              setAptTime(time);
              // "any" is a synthetic id from displaySlots — never let it pin
              // a specific provider. Only a genuinely named staffId (i.e.
              // selectedStaff was already a specific person, not "any")
              // should ever switch the selection.
              if (staffId && staffId !== 'any' && staffId !== selectedStaff) setSelectedStaff(staffId);
            }}
            addOnIds={addOnIds}
            onToggleAddOn={toggleAddOn}
            date={aptDate}
            onDateChange={setAptDate}
          />
        )}

        {/* v5 — per-add-on provider assignment (Quick Book redesign #3).
            Previously every add-on silently rode along with whichever
            provider was selected for the primary service — there was no way
            to say "color with Jessica, blowout add-on with Kylie" inside
            Quick Book itself; that only existed post-booking via
            AddAndConfigurePartsDialog. This writes into the same
            checkoutState.serviceStaffOverrides shape that dialog already
            reads, so nothing downstream needs to change. */}
        {addOnIds.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Add-on providers</p>
            {addOnIds.map(id => {
              const addOnSvc = services.find((s: any) => s.id === id);
              if (!addOnSvc) return null;
              const overrideStaffId = addOnStaffOverrides[id];
              return (
                <div key={id} className="rounded-xl border bg-white p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-900">{addOnSvc.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAddOnStaffOverrides(prev => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                      })}
                      className={cn(
                        'px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors',
                        !overrideStaffId ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300',
                      )}
                    >
                      Same as primary
                    </button>
                    {activeStaff.map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setAddOnStaffOverrides(prev => ({ ...prev, [id]: s.id }))}
                        className={cn(
                          'pl-1 pr-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors flex items-center gap-1',
                          overrideStaffId === s.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300',
                        )}
                      >
                        <StaffAvatar staffMember={s} size="w-4 h-4" textSize="text-[8px]" />
                        {s.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Any-available transparency note — the receptionist picks a time,
            not a person; this is who the fair rotation currently resolves to. */}
        {selectedStaff === 'any' && aptTime && !hasNoSlots && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Star className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <p className="text-xs text-blue-700 min-w-0">
                  Assigned automatically by rotation — currently{' '}
                  <span className="font-medium">{anyAvailablePreviewName || 'unassigned'}</span>
                </p>
              </div>
              {anyAvailableMatchScore !== null && (
                <span className="text-[10px] font-medium text-blue-600 bg-white border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                  {anyAvailableMatchScore}% match
                </span>
              )}
            </div>
            {anyAvailableReasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {anyAvailableReasons.map(r => (
                  <span key={r} className="text-[10px] text-blue-700 bg-white border border-blue-200 px-2 py-0.5 rounded-full">
                    ✔ {r}
                  </span>
                ))}
              </div>
            )}
            {anyAvailablePreviewStaffId && (
              <button
                type="button"
                onClick={() => setSelectedStaff(anyAvailablePreviewStaffId)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700 hover:text-blue-900"
              >
                <Lock className="w-3 h-3" /> Lock {anyAvailablePreviewName?.split(' ')[0] || 'this provider'} for this booking
              </button>
            )}
          </div>
        )}

        {/* No slots / waitlist */}
        {hasNoSlots && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-center">
            <CalendarOff className="w-7 h-7 text-slate-300 mx-auto" />
            <div>
              <p className="text-sm font-medium text-slate-600">No availability on {format(new Date(aptDate), 'EEE MMM d')}</p>
              <p className="text-xs text-slate-400 mt-1">Try a different date or add {selectedClient?.name?.split(' ')[0] || 'the client'} to the waitlist.</p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAptDate(format(addMinutes(new Date(`${aptDate}T00:00`), 24 * 60), 'yyyy-MM-dd'))}
              >
                Try tomorrow
              </Button>
              {selectedClient && (
                <Button size="sm" onClick={handleAddToWaitlist}>
                  Add to waitlist
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Slot conflict warning */}
        {slotConflict && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">That slot was just taken by another booking. Please pick a different time.</p>
          </div>
        )}

        {/* Group booking */}
        <button
          type="button"
          onClick={() => {
            setIsGroup(v => !v);
            if (!isGroup && groupGuests.length === 0) {
              setGroupGuests([{ id: 'g1', name: '', serviceId: selectedService, staffId: 'any' }]);
            }
          }}
          className={cn(
            'w-full rounded-xl border p-3.5 text-left transition-all',
            isGroup ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-700 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-slate-400" /> Group booking
            </p>
            <div className={cn('w-10 h-5.5 rounded-full relative transition-colors', isGroup ? 'bg-blue-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', isGroup ? 'left-[22px]' : 'left-0.5')} />
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
            clients={clients}
          />
        )}

        {/* Multi-provider */}
        {!isGroup && selectedService && (
          <button
            type="button"
            onClick={() => {
              setIsMultiProvider(v => !v);
              if (!isMultiProvider && providerLegs.length === 0) {
                setProviderLegs([{ id: `leg_${Date.now()}`, serviceId: '', staffId: 'any' }]);
              }
            }}
            className={cn(
              'w-full rounded-xl border p-3.5 text-left transition-all',
              isMultiProvider ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-700 flex items-center gap-2">
                  <UserCog className="w-3.5 h-3.5 text-slate-400" /> Add another provider
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">e.g. color with one stylist, then a cut with another</p>
              </div>
              <div className={cn('w-10 h-5.5 rounded-full relative transition-colors shrink-0', isMultiProvider ? 'bg-blue-500' : 'bg-slate-200')}>
                <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', isMultiProvider ? 'left-[22px]' : 'left-0.5')} />
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
          <Button onClick={() => setStep(1)} variant="outline" className="h-11 px-4">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            disabled={!selectedService || !aptTime || patchTestBlocking}
            onClick={() => setStep(3)}
            className="flex-1 h-11"
          >
            Review →
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 3: Confirm ───────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {saveDraftModal}
      <CommandBar step={3} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />

      {/* v7 — the read-back. Distinct styling from the itemized receipt
          below (which is for staff's eyes / record-keeping) — this one is
          meant to be spoken out loud to the caller before confirming. */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3.5 flex items-start gap-2.5">
        <MessageSquare className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wider mb-1">Read this back to confirm</p>
          <p className="text-sm text-blue-900 leading-relaxed">{readBackSentence}</p>
        </div>
      </div>

      {/* Arrears banner (fallback for step 3) */}
      {hasUnresolvedArrears && (
        <ArrearsBanner
          outstandingBalance={outstandingBalance}
          clientFirstName={selectedClient?.name?.split(' ')[0] || 'This client'}
          canChargeOnFile={canChargeOnFile}
          isChargingArrears={isChargingArrears}
          arrearsResolved={arrearsResolved}
          showOverride={showArrearsOverride}
          overrideReason={arrearsOverrideReason}
          overrideDetail={arrearsOverrideDetail}
          onChargeArrears={handleChargeArrears}
          onShowOverride={() => setShowArrearsOverride(true)}
          onSetOverrideReason={setArrearsOverrideReason}
          onSetOverrideDetail={setArrearsOverrideDetail}
          onCancelOverride={() => { setShowArrearsOverride(false); setArrearsOverrideReason(''); setArrearsOverrideDetail(''); }}
        />
      )}

      {/* Receipt summary */}
      <div className="rounded-xl border overflow-hidden bg-white">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium text-slate-900">
            {selectedSvc?.name}
            {addOnIds.length > 0 && ` + ${addOnIds.length} add-on${addOnIds.length > 1 ? 's' : ''}`}
            {isMultiProvider && scheduledLegs.length > 0 && ` · ${scheduledLegs.length + 1} providers`}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {format(new Date(`${aptDate}T${aptTime}`), 'EEE MMM d · h:mm a')} · {summaryStaff}
            {durationOffset > 0 && ` · +${durationOffset}m`}
          </p>
        </div>
        <div className="px-4 py-2.5 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Client</span>
            <span className="text-slate-900">{selectedClient?.name || newClientName}</span>
          </div>
          {addOnIds.length > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Add-ons</span>
              <span className="text-slate-900">
                {addOnIds.map(id => services.find((s: any) => s.id === id)?.name).filter(Boolean).join(', ')}
              </span>
            </div>
          )}
          {scheduledLegs.map(leg => {
            const legSvc = services.find((s: any) => s.id === leg.serviceId);
            const legStaff = staff.find((s: any) => s.id === leg.staffId);
            return (
              <div key={leg.id} className="flex justify-between text-xs pl-3 border-l border-slate-100">
                <span className="text-slate-400">+ {legSvc?.name || 'Service'}</span>
                <span className="text-slate-700">{legStaff?.name?.split(' ')[0] || 'Any'} · {format(leg.startTime, 'h:mm a')}</span>
              </div>
            );
          })}
          {isGroup && groupGuests.length > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Group size</span>
              <span className="text-slate-900">{groupGuests.length + 1} guests</span>
            </div>
          )}
          {promoDiscount && (
            <div className="flex justify-between text-xs text-green-700">
              <span>Promo ({promoDiscount.label})</span>
              <span>−${(discountCents / 100).toFixed(2)}</span>
            </div>
          )}
        </div>
        <div className="px-4 py-4 border-t bg-slate-50/60 flex items-center justify-between">
          <span className="text-xs text-slate-400">Total</span>
          <div className="text-right">
            <p className="text-3xl font-semibold text-slate-900 tracking-tight">${grandTotal.toFixed(2)}</p>
            {effectiveDepositCents > 0 && (
              <p className="text-[11px] text-slate-400 mt-0.5">${(effectiveDepositCents / 100).toFixed(2)} deposit due now</p>
            )}
          </div>
        </div>
      </div>

      {/* Consent form status */}
      {requiredFormIds.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Consent forms
          </p>
          <div className="rounded-xl border divide-y overflow-hidden">
            {formStatuses.map(fs => {
              const hasName = getFormName(fs.id) !== fs.id;
              return (
                <div key={fs.id} className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                  {namingFormId === fs.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        autoFocus
                        value={newFormTitle}
                        onChange={e => setNewFormTitle(e.target.value)}
                        placeholder="Form name"
                        className="h-8 text-xs flex-1"
                      />
                      <Button
                        size="sm"
                        className="h-8 text-xs shrink-0"
                        onClick={() => handleSaveFormName(fs.id)}
                        disabled={isSavingFormName || !newFormTitle.trim()}
                      >
                        {isSavingFormName ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { setNamingFormId(null); setNewFormTitle(''); }}
                        className="text-[10px] text-slate-400 hover:text-slate-600 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-xs text-slate-700 truncate">{getFormName(fs.id)}</p>
                        {!hasName && (
                          <button
                            type="button"
                            onClick={() => { setNamingFormId(fs.id); setNewFormTitle(''); }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 shrink-0"
                          >
                            Name this form
                          </button>
                        )}
                      </div>
                      {fs.signed ? (
                        <span className="text-[10px] text-green-600 font-medium flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          Signed {fs.signedAt ? format(fs.signedAt, 'MMM d yyyy') : ''}
                        </span>
                      ) : fs.expiredSig ? (
                        <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1 shrink-0">
                          <AlertCircle className="w-3 h-3" /> Expired — needs re-sign
                        </span>
                      ) : (
                        <span className="text-[10px] text-red-500 font-medium shrink-0">Not signed</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Package redemption */}
      {activePackages.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-3 h-3" /> Redeem package
          </p>
          {activePackages.map((pkg: any) => {
            const pkgSvc = services.find((s: any) => s.id === pkg.packageId) || { name: pkg.packageId };
            const isSelected = redeemPackageId === pkg.packageId;
            return (
              <button
                key={pkg.packageId}
                onClick={() => setRedeemPackageId(isSelected ? null : pkg.packageId)}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left',
                  isSelected ? 'border-blue-200 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <div>
                  <p className={cn('text-xs font-medium', isSelected ? 'text-blue-700' : 'text-slate-900')}>
                    {pkgSvc.name}
                  </p>
                  <p className="text-[10px] text-slate-400">{pkg.sessionsRemaining} session{pkg.sessionsRemaining !== 1 ? 's' : ''} remaining</p>
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-500" />}
              </button>
            );
          })}
        </div>
      )}

      {/* v7 — eligible discounts (Quick Book redesign #4: "existing
          discounts should be instantly available"). Tap to apply, no code
          to remember. The manual field below still works for anything not
          covered by an automation trigger. */}
      {availableDiscounts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Gift className="w-3 h-3" /> Available discounts
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableDiscounts.map((d: any) => {
              const isApplied = promoDiscount?.label === (d.description || d.code);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => applyListedDiscount(d)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5',
                    isApplied ? 'border-green-200 bg-green-50 text-green-700' : 'border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-300',
                  )}
                >
                  {isApplied ? <CheckCircle2 className="w-3 h-3" /> : '✔'}
                  {d.description || d.code}
                  <span className="opacity-70">
                    {d.type === 'percentage' ? `${d.value}% off` : `$${safeNumber(d.value).toFixed(0)} off`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Promo code */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Tag className="w-3 h-3" /> {availableDiscounts.length > 0 ? 'Other promo code' : 'Promo code'}
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Enter code"
            value={promoCode}
            onChange={e => { setPromoCode(e.target.value); setPromoDiscount(null); }}
            className="h-10 text-xs flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={applyPromoCode}
            disabled={promoChecking || !promoCode.trim()}
            className="h-10 shrink-0"
          >
            {promoChecking ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
          </Button>
        </div>
      </div>

      {/* Charge card on file */}
      {canChargeOnFile && effectiveDepositCents > 0 && (
        <button
          type="button"
          onClick={() => { setChargeNow(v => !v); setChargeConfirmPending(false); }}
          className={cn(
            'w-full rounded-xl border p-4 text-left transition-all',
            chargeNow ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-slate-900 flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                Charge card on file now
              </p>
              <p className="text-[11px] text-slate-400">
                {selectedClient?.cardOnFile?.brand && selectedClient?.cardOnFile?.last4
                  ? `${selectedClient.cardOnFile.brand.toUpperCase()} ••••${selectedClient.cardOnFile.last4} — `
                  : ''}
                ${(effectiveDepositCents / 100).toFixed(2)} charged immediately.
                If declined, a completion link will be sent instead.
              </p>
            </div>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', chargeNow ? 'bg-blue-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', chargeNow ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      {/* Email */}
      {!selectedClient?.email && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">
            Client email {(!canChargeOnFile || !chargeNow) && sendLink ? '(required)' : '(optional)'}
          </p>
          <Input
            type="email"
            placeholder="client@email.com"
            value={newClientEmail}
            onChange={e => setNewClientEmail(e.target.value)}
            className="h-10 text-xs"
          />
        </div>
      )}
      {selectedClient?.email && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-100">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
          <p className="text-xs text-green-700">{selectedClient.email}</p>
        </div>
      )}

      {/* v5 — recurring booking (Quick Book redesign #4). Writes a shared
          recurrenceId across the primary appointment and N-1 future
          occurrences in handleBook. Future legs are booked best-effort —
          they don't run the slot-lock transaction or a full per-slot
          availability check the way the primary booking does (same
          documented gap as multi-provider legs elsewhere in this file). */}
      <button
        type="button"
        onClick={() => setIsRecurring(v => !v)}
        className={cn(
          'w-full rounded-xl border p-4 text-left transition-all',
          isRecurring ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-900 flex items-center gap-2">
              <Repeat className="w-3.5 h-3.5 text-slate-400" /> Make this recurring
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Books future visits on the same schedule automatically</p>
          </div>
          <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', isRecurring ? 'bg-blue-500' : 'bg-slate-200')}>
            <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', isRecurring ? 'left-[22px]' : 'left-0.5')} />
          </div>
        </div>
      </button>

      {isRecurring && (
        <div className="rounded-xl border p-3.5 space-y-3 bg-white">
          <div className="flex gap-2">
            {(['weekly', 'biweekly', 'monthly'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setRecurrenceInterval(opt)}
                className={cn(
                  'flex-1 h-9 rounded-lg border text-xs font-medium capitalize transition-colors',
                  recurrenceInterval === opt ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-slate-500 flex-1">Repeat {recurrenceCount} times total</p>
            <button
              type="button"
              onClick={() => setRecurrenceCount(c => Math.max(2, c - 1))}
              className="w-7 h-7 rounded-lg border flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="text-xs text-slate-700 w-8 text-center">{recurrenceCount}</span>
            <button
              type="button"
              onClick={() => setRecurrenceCount(c => Math.min(52, c + 1))}
              className="w-7 h-7 rounded-lg border flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Deposits/charges only apply to this first visit — future occurrences are booked without collecting payment.
          </p>
        </div>
      )}

      {/* Reminder timing */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3 h-3" /> Reminder
        </p>
        <select
          value={reminderHours}
          onChange={e => setReminderHours(e.target.value)}
          className="w-full h-10 rounded-lg border text-xs px-3 bg-white"
        >
          {REMINDER_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Notes: client-visible */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <MessageSquare className="w-3 h-3" /> Note for client (included in confirmation)
        </p>
        <textarea
          value={clientNotes}
          onChange={e => setClientNotes(e.target.value)}
          placeholder="e.g. Please arrive with dry hair"
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-xs resize-none outline-none focus:border-blue-300 transition-colors bg-white"
        />
      </div>

      {/* Notes: internal only */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3" /> Internal note (staff only — not sent to client)
        </p>
        <textarea
          value={internalNotes}
          onChange={e => setInternalNotes(e.target.value)}
          placeholder="e.g. Prefers no small talk, allergic to latex gloves"
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-xs resize-none outline-none focus:border-blue-300 transition-colors bg-white"
        />
      </div>

      {/* Completion link toggle */}
      {!(canChargeOnFile && chargeNow && effectiveDepositCents > 0) && (
        <button
          type="button"
          onClick={() => {
            if (!sendLink && requiredFormIds.length > 0) {
              toast({ title: 'Link required', description: 'Consent forms must be signed via the link.' });
              return;
            }
            setSendLink(v => !v);
          }}
          className={cn(
            'w-full rounded-xl border p-4 text-left transition-all',
            sendLink ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                Send secure completion link
              </p>
              <p className="text-[11px] text-slate-400">
                {alreadyHasCard && formsNeedingSignature.length === 0
                  ? 'Card already on file — link optional.'
                  : effectiveDepositCents > 0
                    ? `Client pays $${(effectiveDepositCents / 100).toFixed(2)} deposit${formsNeedingSignature.length > 0 ? ` + signs ${formsNeedingSignature.length} form${formsNeedingSignature.length > 1 ? 's' : ''}` : ''}.`
                    : formsNeedingSignature.length > 0
                      ? `Client signs ${formsNeedingSignature.length} consent form${formsNeedingSignature.length > 1 ? 's' : ''}.`
                      : 'Client adds card on file before arrival.'}
              </p>
            </div>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', sendLink ? 'bg-blue-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', sendLink ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      {sendLink && !(canChargeOnFile && chargeNow && effectiveDepositCents > 0) && (
        <button
          type="button"
          onClick={() => setRequestFiles(v => !v)}
          className={cn(
            'w-full rounded-xl border p-3.5 text-left transition-all',
            requestFiles ? 'border-blue-200 bg-blue-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-700 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-slate-400" /> Request inspiration photos
            </p>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', requestFiles ? 'bg-blue-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', requestFiles ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>
      )}

      {/* Confirm button */}
      <div className="flex gap-3 pt-1">
        <Button onClick={() => setStep(2)} variant="outline" className="h-11 px-4">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          onClick={handleBook}
          disabled={
            isSubmitting ||
            !canConfirmBooking ||
            (!(canChargeOnFile && chargeNow && effectiveDepositCents > 0) && sendLink && !clientEmail.trim())
          }
          className={cn('flex-1 h-11 transition-all', chargeConfirmPending ? 'bg-amber-500 hover:bg-amber-600' : '')}
        >
          {isSubmitting ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : !canConfirmBooking ? (
            'Resolve balance first'
          ) : canChargeOnFile && chargeNow && effectiveDepositCents > 0 ? (
            chargeConfirmPending ? (
              `Tap again to confirm charge of $${(effectiveDepositCents / 100).toFixed(2)}`
            ) : (
              `Charge $${(effectiveDepositCents / 100).toFixed(2)} and book`
            )
          ) : sendLink ? (
            'Book and send link'
          ) : (
            'Confirm booking'
          )}
        </Button>
      </div>
    </div>
  );
}
