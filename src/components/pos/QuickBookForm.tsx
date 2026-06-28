'use client';

/**
 * QuickBookForm — v3
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
 * All v1/v2 features retained — see prior revision notes below.
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
import { format, addMinutes, differenceInMonths, formatDistanceToNow } from 'date-fns';
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
  ChevronUp, Trash2,
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

// requiredFormIds only stores form codes/ids, not display names — this builds
// an id → name lookup from whatever source actually has the names. Checks,
// in order: tenant.consentForms, tenant.forms, the optional `forms` prop.
// Falls back to the raw id if nothing matches, so it degrades safely rather
// than breaking if the names live somewhere else — point it at the right
// source if this guess is wrong for your data model.
const buildFormNameLookup = (tenant: any, formsProp: any[] = []): Record<string, string> => {
  const lookup: Record<string, string> = {};
  const sources: any[] = [
    ...(Array.isArray(tenant?.consentForms) ? tenant.consentForms : []),
    ...(Array.isArray(tenant?.forms) ? tenant.forms : []),
    ...(Array.isArray(formsProp) ? formsProp : []),
  ];
  sources.forEach((f: any) => {
    const id = f?.id || f?.formId;
    const name = f?.name || f?.label || f?.title;
    if (id && name) lookup[id] = name;
  });
  return lookup;
};

// "phone · email" with whichever pieces actually exist. Several spots
// previously used `c.phone || c.email`, which silently hid the email any
// time a phone number was also present.
const contactLine = (c: { phone?: string; email?: string } | null | undefined): string => {
  if (!c) return '—';
  const parts = [c?.phone, c?.email].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
};

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
  onSuccess: () => void;
  onCancel: () => void;
};

type ChargeOutcome =
  | { charged: true; amountDollars: number }
  | { charged: false; reason: string }
  | null;

type BookingSuccess = {
  clientName: string;
  serviceName: string;
  aptDate: string;
  aptTime: string;
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
  onChangeClient,
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
  onChangeClient: () => void;
}) {
  const [historyExpanded, setHistoryExpanded] = React.useState(false);

  // Defensive: only trust startTime values that are actually strings, same
  // guard as staffDateLoad — a non-string startTime should never crash this
  // panel either.
  const clientAppointments = React.useMemo(
    () => (appointments || [])
      .filter((a: any) => a.clientId === client.id && typeof a.startTime === 'string')
      .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [appointments, client.id],
  );

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
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
            client.status === 'blocked' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700',
          )}>
            {client.status === 'blocked' ? <Ban className="w-4 h-4" /> : client.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{client.name}</p>
            <p className="text-xs text-slate-400 truncate">{contactLine(client)}</p>
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

  const firstName = result.clientName.split(' ')[0];

  return (
    <div className="space-y-5">
      <div className="text-center space-y-3 pt-2">
        <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-100 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-7 h-7 text-green-500" />
        </div>
        <div>
          <p className="text-base font-medium text-slate-900">{result.clientName} · Booked</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {format(new Date(`${result.aptDate}T${result.aptTime}`), 'EEE MMM d · h:mm a')}
            {result.isGroup && result.groupGuestCount > 0 && ` · Group of ${result.groupGuestCount + 1}`}
            {result.isMultiProvider && result.legCount > 0 && ` · ${result.legCount + 1} providers`}
          </p>
        </div>
      </div>

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

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onBookAnother} variant="outline" className="h-11">Book another</Button>
        <Button onClick={onDone} className="h-11">Done</Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function QuickBookForm({
  clients, services, staff, tenantId, tenant, firestore,
  appointments = [], forms = [], currentStaffId, onSuccess, onCancel,
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

  const searchRef = React.useRef<HTMLInputElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const recentClients = React.useMemo(() =>
    [...(clients || [])]
      .filter((c: any) => c.lastAppointment)
      .sort((a: any, b: any) =>
        new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime())
      .slice(0, 6),
  [clients]);

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
  const formNameLookup = React.useMemo(() => buildFormNameLookup(tenant, forms), [tenant, forms]);
  const getFormName = React.useCallback((id: string) => formNameLookup[id] || id, [formNameLookup]);

  // Smart availability
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
  const hasNoSlots = selectedService && slots.length === 0;

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

  // ── Call-back draft snapshot helpers ──────────────────────────────────────
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
        <Input
          placeholder="Caller's phone number"
          value={draftCallerPhone}
          onChange={e => setDraftCallerPhone(e.target.value)}
          className="h-10 text-sm"
          type="tel"
        />
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
      const resolvedStaffId =
        selectedStaff === 'any'
          ? (staff.find((s: any) => s.active)?.id || null)
          : selectedStaff;
      const aptId = _nanoid();
      const checkInToken = _nanoid();

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
        promoCode: promoDiscount ? promoCode.trim() : undefined,
        promoDiscountCents: discountCents > 0 ? discountCents : undefined,
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
          const legStaffId = leg.staffId === 'any' ? (staff.find((s: any) => s.active)?.id || null) : leg.staffId;
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
          const gClientId = _nanoid(); // real client id, not apt id
          const gAptId = _nanoid();
          const gToken = _nanoid();
          const gSvc = services.find((s: any) => s.id === guest.serviceId);
          const gStaffId = guest.staffId === 'any' ? (staff.find((s: any) => s.active)?.id || null) : guest.staffId;
          const gEnd = addMinutes(startTime, gSvc?.duration || 60);

          // Create a minimal client record for the guest
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, gClientId), sanitizeForFirestore({
            id: gClientId,
            name: guest.name,
            status: 'active',
            lifetimeValue: 0,
            lastAppointment: now,
            groupLinkedTo: clientId,
          }));

          batch.set(doc(firestore, `tenants/${tenantId}/appointments`, gAptId), sanitizeForFirestore({
            id: gAptId, tenantId,
            clientId: gClientId,
            clientName: guest.name,
            serviceId: guest.serviceId,
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

      // Resolve (delete) any pending call-back draft this booking originated from
      if (currentDraftId) {
        try {
          await deleteDoc(doc(firestore, `tenants/${tenantId}/callBackDrafts`, currentDraftId));
        } catch { /* non-fatal */ }
        setCurrentDraftId(null);
      }

      // ── Show success screen ───────────────────────────────────────────────
      setSuccessResult({
        clientName,
        serviceName: selectedSvc?.name || '',
        aptDate,
        aptTime,
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
              <p className="text-xs text-slate-400">{contactLine(selectedClient)}</p>
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
                    <p className="text-xs text-slate-400">{contactLine(c)}</p>
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
            <Input
              placeholder="Phone number"
              value={newClientPhone}
              onChange={e => setNewClientPhone(e.target.value)}
              className="h-11"
              type="tel"
            />
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
                        <p className="text-xs text-slate-400">{contactLine(c)}</p>
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
                <div className="grid grid-cols-2 gap-2">
                  {recentClients.map((c: any) => (
                    <button
                      key={c.id}
                      onClick={() => selectClient(c)}
                      className="flex items-center gap-2.5 p-3 rounded-xl border hover:border-blue-200 hover:bg-blue-50/50 transition-all text-left"
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                        c.status === 'blocked' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500',
                      )}>
                        {c.status === 'blocked' ? <Ban className="w-3 h-3" /> : c.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">{c.name}</p>
                        {c.lastAppointment && (
                          <p className="text-[10px] text-slate-400">{format(new Date(c.lastAppointment), 'MMM d')}</p>
                        )}
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
            onChangeClient={() => { setStep(1); setSelectedService(''); }}
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
              setDurationOffset(0);
            }
          }}
        />

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
                    'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5',
                    selectedStaff === s.id
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : isFullyBooked
                        ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                  disabled={isFullyBooked}
                >
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
  const summaryStaff = selectedStaff === 'any'
    ? 'First available'
    : staff.find((s: any) => s.id === selectedStaff)?.name || '—';

  return (
    <div className="space-y-5">
      {saveDraftModal}
      <CommandBar step={3} callerName={liveCallerName} serviceLabel={liveServiceLabel} onSaveDraft={openSaveDraftModal} />

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
            {formStatuses.map(fs => (
              <div key={fs.id} className="flex items-center justify-between px-3.5 py-2.5">
                <p className="text-xs text-slate-700">{getFormName(fs.id)}</p>
                {fs.signed ? (
                  <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Signed {fs.signedAt ? format(fs.signedAt, 'MMM d yyyy') : ''}
                  </span>
                ) : fs.expiredSig ? (
                  <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Expired — needs re-sign
                  </span>
                ) : (
                  <span className="text-[10px] text-red-500 font-medium">Not signed</span>
                )}
              </div>
            ))}
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

      {/* Promo code */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Tag className="w-3 h-3" /> Promo code
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
