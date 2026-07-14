'use client';

/**
 * BoothsPage — the single unified surface for booths, renters, and
 * leases (previously three separate concerns split across Booths and
 * Renters pages).
 *
 * MERGE NOTES (checked against the real booth-rental-hooks.ts,
 * booth-rental-service.ts, AND booth-rental-types.ts — all three
 * confirmed consistent with each other and with this page):
 *
 *   1. useBoothRentalCollections() applies `where('locationId', '==',
 *      locationId)` to every query when a locationId is passed. Booths,
 *      renters, and leases in Firestore ALL require a real locationId
 *      field per the real types (Booth.locationId, Renter.locationId,
 *      Lease.locationId are all required, non-optional strings) —
 *      existing docs created before this field existed will need a
 *      backfill migration or they won't appear once this page is live.
 *   2. Renter/lease writes route through createRenter/createLease/
 *      endLease. All three signatures — and the Renter shape
 *      createRenter() writes (locationId, authUid, portalInviteStatus,
 *      portalInviteSentAt, no portalAccessToken) — match the real
 *      booth-rental-types.ts exactly. The schema merge that was
 *      previously a blocker has already landed.
 *   3. Booth creation goes through the real createBooth() service
 *      function; edit/delete remain direct updateDoc/deleteDoc calls,
 *      matching the file's own "only creation-with-required-fields or
 *      multi-effect ops get a service function" convention.
 *   4. Occupancy is computed via useOccupyingLeaseByBooth /
 *      useOccupyingLeaseByRenter — both canonical, both using
 *      OCCUPYING_LEASE_STATUSES (active, on_leave, pending_signature) —
 *      so the floor plan and renters view can't disagree about what
 *      "occupied" means.
 *   5. Booth.type is confirmed as 'booth' | 'chair' | 'room' | 'suite'
 *      (Booth has no `description` field — only `type` and optional
 *      `notes`). The booth form uses a real Select bound to this enum;
 *      the earlier "TEMP: free text" placeholder is gone.
 *   6. BOOTH_RENTAL_COLLECTIONS.locations() is defined in the real types
 *      file, so the location layer this page depends on (useLocation()
 *      context, location switcher, "no locations yet" empty state) has
 *      what it needs to actually function.
 *
 * REMAINING OPEN ITEM: this page has not been run against a live
 * Firestore instance or a real compiler — the checks above are
 * signature-level consistency checks between source files, not proof
 * the app builds or the security rules accept these writes. Run
 * `tsc --noEmit` and a real Firestore write before calling this done.
 *
 * BUILD FIX (carried over from the Renters page): this page reads live,
 * per-user Firestore data scoped to whoever is signed in, so it must
 * never be statically prerendered.
 */
export const dynamic = 'force-dynamic';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  doc,
  updateDoc,
  deleteDoc, onSnapshot, getDocs, collection, query } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Armchair,
  Users,
  Plus,
  Pencil,
  Trash2,
  Calculator,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  Wrench,
  CircleDollarSign,
  LayoutGrid,
  List,
  Lock,
  Unlock,
  RefreshCw,
  Info,
  Bell,
  Activity as ActivityIcon,
  X,
  UserPlus,
  FileClock,
  FileText,
  FileSignature,
  CalendarDays,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Upload,
  AlertCircle,
  Gift,
  Clock,
  Pause,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Booth,
  BoothStatus,
  Renter,
  RenterStatus,
  Lease,
  LeasePerk,
  PerkType,
  PerkTrigger,
  RentFrequency,
  WeekDay,
  BOOTH_RENTAL_COLLECTIONS,
  BOOTH_STATUS_LABELS,
  BOOTH_STATUS_COLORS,
  RENTER_STATUS_LABELS,
  FREQUENCY_LABELS,
  PERK_TYPE_LABELS,
  PERK_TRIGGER_LABELS,
  WEEKDAY_LABELS,
  formatCents,
  toIsoDate,
  slotsOverlap,
} from '@/lib/booth-rental-types';
import {
  useBoothRentalCollections,
  useBoothIndex,
  useRenterIndex,
  useOccupyingLeaseByRenter,
  useOccupyingLeaseByBooth,
} from '@/lib/booth-rental-hooks';
import { createBooth, createRenter, createLease, endLease } from '@/lib/booth-rental-service';
import { ImageUpload } from '@/components/shared/ImageUpload';

// ─── Canvas constants ─────────────────────────────────────────────────────────

const CANVAS_W = 1200;
const CANVAS_H = 800;
const GRID = 20;
const DEFAULT_W = 140;
const DEFAULT_H = 100;

const snap = (v: number) => Math.round(v / GRID) * GRID;

const FREQ_TO_MONTHLY: Record<string, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
};

// ─── Status config (list view badges) ─────────────────────────────────────────

const STATUS_CONFIG: Record <
  BoothStatus,
  { label: string; badgeClass: string }
> = {
  vacant: { label: 'Vacant', badgeClass: 'bg-amber-100 text-amber-800' },
  occupied: { label: 'Occupied', badgeClass: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Partial', badgeClass: 'bg-orange-100 text-orange-800' },
  maintenance: { label: 'Maintenance', badgeClass: 'bg-slate-200 text-slate-700' },
  inactive: { label: 'Inactive', badgeClass: 'bg-slate-100 text-slate-500' },
};

const RENTER_STATUS_CONFIG: Record<RenterStatus, { label: string; badgeClass: string }> = {
  prospective:     { label: 'Prospective',    badgeClass: 'bg-sky-100 text-sky-800' },
  active:          { label: 'Active',          badgeClass: 'bg-emerald-100 text-emerald-800' },
  on_leave:        { label: 'On leave',        badgeClass: 'bg-amber-100 text-amber-800' },
  maternity_leave: { label: 'Maternity leave', badgeClass: 'bg-pink-100 text-pink-800' },
  subletting:      { label: 'Subletting',      badgeClass: 'bg-violet-100 text-violet-800' },
  past:            { label: 'Past',            badgeClass: 'bg-slate-200 text-slate-700' },
  archived:        { label: 'Archived',        badgeClass: 'bg-slate-100 text-slate-500' },
};

const AMENITY_OPTIONS = [
  'Backbar product',
  'Laundry',
  'Reception / front desk',
  'Storage',
  'Wifi',
  'Retail shelf space',
  'Parking',
  'Towel service',
];

const WEEKDAY_OPTIONS: { value: WeekDay; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const WIZARD_STEPS = ['Booth & rent', 'Deposit & fees', 'Perks', 'Review'] as const;

const LEASE_ALERT_WINDOW_DAYS = 14;
const ACTIVITY_LOG_LIMIT = 40;
const TOAST_LIFETIME_MS = 6000;

function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// ─── Booth form ───────────────────────────────────────────────────────────────

interface BoothFormState {
  name: string;
  typeValue: Booth['type'];
  notes: string;
  baseRentDollars: string;
  baseRentFrequency: RentFrequency;
  extraRates: { frequency: string; dollars: string }[];
  status: BoothStatus;
  amenities: string[];
  photoUrls: string[];
}

const EMPTY_FORM: BoothFormState = {
  name: '',
  typeValue: 'booth',
  notes: '',
  baseRentDollars: '',
  baseRentFrequency: 'weekly',
  extraRates: [],
  status: 'vacant',
  amenities: [],
  photoUrls: [],
};

// ─── Renter form ──────────────────────────────────────────────────────────────

interface RenterFormState {
  firstName: string; lastName: string; email: string; phone: string;
  businessName: string; specialty: string; notes: string;
  linkedStaffId: string;
}
const EMPTY_RENTER_FORM: RenterFormState = {
  firstName: '', lastName: '', email: '', phone: '', businessName: '', specialty: '', notes: '',
  linkedStaffId: '',
};

// ─── Lease form ───────────────────────────────────────────────────────────────

interface LeaseFormState {
  boothId: string; rentDollars: string; frequency: RentFrequency;
  dueDay: string; firstChargeDate: string; startDate: string; endDate: string;
  autoRenew: boolean; noticeDays: string;
  isShared: boolean; scheduleDays: WeekDay[]; scheduleStartTime: string;
  scheduleEndTime: string; scheduleLabel: string;
  depositDollars: string; depositRefundable: boolean; depositConditions: string;
  lateFeeEnabled: boolean; lateFeeGraceDays: string; lateFeeType: 'flat' | 'percent';
  lateFeeAmountDollars: string; lateFeePercent: string;
  perks: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>[];
  houseRules: string; signedFile: File | null;
}

function buildEmptyLeaseForm(): LeaseFormState {
  const today = toIsoDate(new Date());
  return {
    boothId: '', rentDollars: '', frequency: 'weekly', dueDay: '1',
    firstChargeDate: today, startDate: today, endDate: '', autoRenew: true, noticeDays: '30',
    isShared: false, scheduleDays: [], scheduleStartTime: '', scheduleEndTime: '', scheduleLabel: '',
    depositDollars: '', depositRefundable: true, depositConditions: '',
    lateFeeEnabled: true, lateFeeGraceDays: '3', lateFeeType: 'flat',
    lateFeeAmountDollars: '25', lateFeePercent: '5',
    perks: [], houseRules: '', signedFile: null,
  };
}

// ─── Pricing Advisor ──────────────────────────────────────────────────────────

interface PricingInputs {
  monthlyLease: string;
  monthlyUtilities: string;
  monthlyInsurance: string;
  monthlySoftware: string;
  monthlySupplies: string;
  monthlyOther: string;
  boothCount: string;
  targetMarginPct: string;
  renterAvgTicket: string;
  renterTakeHomeGoal: string;
}

const EMPTY_PRICING: PricingInputs = {
  monthlyLease: '',
  monthlyUtilities: '',
  monthlyInsurance: '',
  monthlySoftware: '',
  monthlySupplies: '',
  monthlyOther: '',
  boothCount: '',
  targetMarginPct: '20',
  renterAvgTicket: '',
  renterTakeHomeGoal: '',
};

interface PricingResult {
  costPerBoothMonthly: number;
  floorMonthly: number;
  floorWeekly: number;
  servicesPerWeekToCoverRent: number;
  servicesPerWeekToThrive: number;
  utilizationWarning: boolean;
}

function computePricing(inputs: PricingInputs): PricingResult | null {
  const totalMonthly =
    toNumber(inputs.monthlyLease) +
    toNumber(inputs.monthlyUtilities) +
    toNumber(inputs.monthlyInsurance) +
    toNumber(inputs.monthlySoftware) +
    toNumber(inputs.monthlySupplies) +
    toNumber(inputs.monthlyOther);

  const boothCount = toNumber(inputs.boothCount);
  if (boothCount <= 0 || totalMonthly <= 0) return null;

  const margin = toNumber(inputs.targetMarginPct) / 100;
  const costPerBoothMonthly = totalMonthly / boothCount;
  const floorMonthly = costPerBoothMonthly * (1 + margin);
  const floorWeekly = (floorMonthly * 12) / 52;

  const avgTicket = toNumber(inputs.renterAvgTicket);
  const takeHomeGoal = toNumber(inputs.renterTakeHomeGoal);

  const servicesPerWeekToCoverRent =
    avgTicket > 0 ? floorWeekly / avgTicket : 0;
  const servicesPerWeekToThrive =
    avgTicket > 0 ? (floorWeekly + takeHomeGoal) / avgTicket : 0;

  const utilizationWarning = servicesPerWeekToThrive > 35;

  return {
    costPerBoothMonthly,
    floorMonthly,
    floorWeekly,
    servicesPerWeekToCoverRent,
    servicesPerWeekToThrive,
    utilizationWarning,
  };
}

function PricingAdvisor(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyWeeklyRent: (dollars: number) => void;
}) {
  const { open, onOpenChange, onApplyWeeklyRent } = props;
  const [inputs, setInputs] = useState<PricingInputs>(EMPTY_PRICING);

  const result = useMemo(() => computePricing(inputs), [inputs]);

  const setField = (field: keyof PricingInputs) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setInputs((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const viabilityToneClass =
    result && result.utilizationWarning
      ? 'border-amber-300 bg-amber-50'
      : 'border-emerald-200 bg-emerald-50';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Pricing Advisor
          </DialogTitle>
          <DialogDescription>
            Find your break-even floor, then check whether a renter can
            actually thrive at that rent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold mb-3">
              Step 1 — Your monthly fixed costs
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pa-lease">Lease / mortgage</Label>
                <Input
                  id="pa-lease"
                  type="number"
                  placeholder="2500"
                  value={inputs.monthlyLease}
                  onChange={setField('monthlyLease')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-utilities">Utilities</Label>
                <Input
                  id="pa-utilities"
                  type="number"
                  placeholder="350"
                  value={inputs.monthlyUtilities}
                  onChange={setField('monthlyUtilities')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-insurance">Insurance</Label>
                <Input
                  id="pa-insurance"
                  type="number"
                  placeholder="150"
                  value={inputs.monthlyInsurance}
                  onChange={setField('monthlyInsurance')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-software">Software &amp; subscriptions</Label>
                <Input
                  id="pa-software"
                  type="number"
                  placeholder="120"
                  value={inputs.monthlySoftware}
                  onChange={setField('monthlySoftware')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-supplies">Shared supplies / laundry</Label>
                <Input
                  id="pa-supplies"
                  type="number"
                  placeholder="200"
                  value={inputs.monthlySupplies}
                  onChange={setField('monthlySupplies')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-other">Everything else</Label>
                <Input
                  id="pa-other"
                  type="number"
                  placeholder="100"
                  value={inputs.monthlyOther}
                  onChange={setField('monthlyOther')}
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">
              Step 2 — Spread across your booths
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pa-count">Number of rentable booths</Label>
                <Input
                  id="pa-count"
                  type="number"
                  placeholder="4"
                  value={inputs.boothCount}
                  onChange={setField('boothCount')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-margin">Target profit margin %</Label>
                <Input
                  id="pa-margin"
                  type="number"
                  placeholder="20"
                  value={inputs.targetMarginPct}
                  onChange={setField('targetMarginPct')}
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">
              Step 3 — Can a renter thrive here?
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pa-ticket">Typical service ticket ($)</Label>
                <Input
                  id="pa-ticket"
                  type="number"
                  placeholder="65"
                  value={inputs.renterAvgTicket}
                  onChange={setField('renterAvgTicket')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-goal">
                  Renter weekly take-home goal ($)
                </Label>
                <Input
                  id="pa-goal"
                  type="number"
                  placeholder="1000"
                  value={inputs.renterTakeHomeGoal}
                  onChange={setField('renterTakeHomeGoal')}
                />
              </div>
            </div>
          </div>

          {result && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-sm font-semibold">Your floor</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Each booth carries{' '}
                  <span className="font-medium text-foreground">
                    {formatCents(Math.round(result.costPerBoothMonthly * 100))}
                    /mo
                  </span>{' '}
                  of your costs. With your target margin, charge at least{' '}
                  <span className="font-semibold text-foreground">
                    {formatCents(Math.round(result.floorWeekly * 100))}/week
                  </span>{' '}
                  ({formatCents(Math.round(result.floorMonthly * 100))}/mo).
                  Below this, you are subsidizing your renters.
                </p>
              </div>

              {toNumber(inputs.renterAvgTicket) > 0 && (
                <div className={cn('rounded-lg border p-4', viabilityToneClass)}>
                  <div className="flex items-center gap-2 mb-2">
                    {result.utilizationWarning ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    )}
                    <span className="text-sm font-semibold">
                      Renter viability check
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    At that rent, a renter covers her booth after{' '}
                    <span className="font-medium text-foreground">
                      {result.servicesPerWeekToCoverRent.toFixed(1)} services a
                      week
                    </span>
                    , and reaches her take-home goal at{' '}
                    <span className="font-medium text-foreground">
                      {result.servicesPerWeekToThrive.toFixed(1)} services a
                      week
                    </span>
                    .{' '}
                    {result.utilizationWarning
                      ? 'That utilization is hard to sustain — renters at this rent are likely to churn, and vacancy will cost you more than a lower rent would.'
                      : 'That is a sustainable workload. A renter who thrives renews — and a full chair beats a vacant one every time.'}
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    onApplyWeeklyRent(Math.round(result.floorWeekly));
                    onOpenChange(false);
                  }}
                >
                  Use {formatCents(Math.round(result.floorWeekly * 100))}/week
                  as base rent
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="bg-background border border-border/40 rounded-xl p-4 flex gap-3 items-start">
      <div
        className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: accent ?? 'var(--color-background-secondary)' }}
      >
        <Icon className="h-4 w-4" style={{ color: accent ? '#fff' : undefined }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-none mb-1">{label}</p>
        <p className="text-xl font-semibold leading-none truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Booth['status'] }) {
  const c = BOOTH_STATUS_COLORS[status] ?? BOOTH_STATUS_COLORS.vacant;
  const label = BOOTH_STATUS_LABELS[status] ?? status ?? 'Unknown';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {label}
    </span>
  );
}

// ─── Live pulse indicator ─────────────────────────────────────────────────────

function LivePulse({ lastSync }: { lastSync: Date | null }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const label = useMemo(() => {
    if (!lastSync) return 'Connecting…';
    const seconds = Math.max(0, Math.round((Date.now() - lastSync.getTime()) / 1000));
    if (seconds < 5) return 'Updated just now';
    if (seconds < 60) return `Updated ${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `Updated ${minutes}m ago`;
  }, [lastSync]);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="font-medium text-emerald-700">Live</span>
      <span>· {label}</span>
    </div>
  );
}

// ─── Toast stack ──────────────────────────────────────────────────────────────

interface ToastItem {
  id: string;
  message: string;
  kind: 'booth' | 'lease' | 'renter';
}

const TOAST_ICON: Record<ToastItem['kind'], React.ElementType> = {
  booth: Armchair,
  lease: FileClock,
  renter: UserPlus,
};

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed left-4 right-4 top-4 sm:left-auto sm:right-4 sm:w-80 z-[100] flex flex-col gap-2"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind];
        return (
          <div
            key={t.id}
            className="bg-background border border-border shadow-lg rounded-lg p-3 flex items-start gap-2.5 animate-in slide-in-from-top-2 fade-in"
          >
            <div className="mt-0.5 h-6 w-6 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <p className="text-xs leading-snug flex-1">{t.message}</p>
            <button
              onClick={() => onDismiss(t.id)}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Command Center panel (alerts + activity) ─────────────────────────────────

interface AlertItem {
  id: string;
  severity: 'danger' | 'warning' | 'info';
  message: string;
}

interface ActivityItem {
  id: string;
  message: string;
  time: string;
  kind: 'booth' | 'lease' | 'renter';
}

const ALERT_STYLES: Record<
  AlertItem['severity'],
  { border: string; bg: string; icon: React.ElementType; iconClass: string }
> = {
  danger: {
    border: 'border-red-200',
    bg: 'bg-red-50',
    icon: AlertTriangle,
    iconClass: 'text-red-600',
  },
  warning: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
  },
  info: {
    border: 'border-sky-200',
    bg: 'bg-sky-50',
    icon: Info,
    iconClass: 'text-sky-600',
  },
};

function CommandCenterPanel({
  open,
  onOpenChange,
  alerts,
  activity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: AlertItem[];
  activity: ActivityItem[];
}) {
  const [tab, setTab] = useState<'alerts' | 'activity'>('alerts');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ActivityIcon className="h-5 w-5" />
            Command Center
          </DialogTitle>
          <DialogDescription>
            Everything that needs your attention across booths, renters, and
            leases — and everything that just happened, live.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setTab('alerts')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === 'alerts'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Alerts {alerts.length > 0 && `(${alerts.length})`}
          </button>
          <button
            onClick={() => setTab('activity')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === 'activity'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Activity
          </button>
        </div>

        <div className="overflow-y-auto flex-1 -mx-1 px-1">
          {tab === 'alerts' && (
            <div className="space-y-2 py-3">
              {alerts.length === 0 && (
                <div className="text-center py-10 space-y-2">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500" />
                  <p className="text-sm text-muted-foreground">
                    Nothing needs attention right now.
                  </p>
                </div>
              )}
              {alerts.map((a) => {
                const style = ALERT_STYLES[a.severity];
                const Icon = style.icon;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'rounded-lg border p-3 flex items-start gap-2.5',
                      style.border,
                      style.bg
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', style.iconClass)} />
                    <p className="text-sm">{a.message}</p>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-1 py-3">
              {activity.length === 0 && (
                <div className="text-center py-10 space-y-2">
                  <FileClock className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Activity will appear here as things change.
                  </p>
                </div>
              )}
              {activity.map((entry) => {
                const Icon = TOAST_ICON[entry.kind];
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0"
                  >
                    <div className="mt-0.5 h-6 w-6 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-sm flex-1">{entry.message}</p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {entry.time}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Booth card on canvas ─────────────────────────────────────────────────────

interface BoothCanvasCardProps {
  booth: Booth;
  renter?: Renter;
  lease?: Lease;
  selected: boolean;
  locked: boolean;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onResizeStart: (e: React.PointerEvent, id: string) => void;
  onClick: (id: string) => void;
}

function BoothCanvasCard({
  booth,
  renter,
  lease,
  selected,
  locked,
  onDragStart,
  onResizeStart,
  onClick,
}: BoothCanvasCardProps) {
  const colors = BOOTH_STATUS_COLORS[booth.status] ?? BOOTH_STATUS_COLORS.vacant;

  const monthlyRent = useMemo(() => {
    if (!lease) return 0;
    return Math.round(
      lease.rentAmountCents * (FREQ_TO_MONTHLY[lease.frequency] ?? 1)
    );
  }, [lease]);

  return (
    <div
      className="absolute select-none group"
      style={{
        left: booth.canvasX,
        top: booth.canvasY,
        width: booth.canvasW,
        height: booth.canvasH,
        touchAction: locked ? undefined : 'none',
      }}
      onPointerDown={(e) => !locked && onDragStart(e, booth.id)}
      onClick={() => onClick(booth.id)}
    >
      <div
        className="w-full h-full rounded-xl flex flex-col p-2.5 overflow-hidden transition-shadow"
        style={{
          background: colors.bg,
          border: `2px solid ${selected ? colors.border : colors.border + '99'}`,
          boxShadow: selected ? `0 0 0 2px ${colors.border}44` : undefined,
          cursor: locked ? 'pointer' : 'grab',
        }}
      >
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className="text-xs font-semibold truncate leading-none"
            style={{ color: colors.text }}
          >
            {booth.name}
          </span>
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: colors.border }}
          />
        </div>

        {renter && (
          <span
            className="text-[11px] truncate leading-none mb-1"
            style={{ color: colors.text + 'cc' }}
          >
            {renter.firstName} {renter.lastName}
          </span>
        )}
        {!renter && booth.status === 'vacant' && (
          <span
            className="text-[11px] italic leading-none mb-1"
            style={{ color: colors.text + '88' }}
          >
            Available
          </span>
        )}

        {lease && monthlyRent > 0 && (
          <span
            className="text-[11px] font-medium leading-none mt-auto"
            style={{ color: colors.text }}
          >
            {formatCents(monthlyRent)}/mo
          </span>
        )}

        {renter?.specialty && booth.canvasH >= 90 && (
          <span
            className="text-[10px] truncate leading-none mt-0.5"
            style={{ color: colors.text + '99' }}
          >
            {renter.specialty}
          </span>
        )}
      </div>

      {!locked && (
        <div
          className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity touch-none"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, booth.id);
          }}
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${colors.border} 50%)`,
            borderBottomRightRadius: 10,
          }}
        />
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  booth,
  renter,
  lease,
  onClose,
  onEdit,
}: {
  booth: Booth;
  renter?: Renter;
  lease?: Lease;
  onClose: () => void;
  onEdit: (booth: Booth) => void;
}) {
  const monthlyRent = useMemo(() => {
    if (!lease) return 0;
    return Math.round(
      lease.rentAmountCents * (FREQ_TO_MONTHLY[lease.frequency] ?? 1)
    );
  }, [lease]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto w-full sm:w-64 max-h-[75vh] sm:max-h-none overflow-y-auto bg-background border border-border rounded-t-2xl sm:rounded-xl shadow-lg p-4 space-y-3 z-50"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border sm:hidden" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{booth.name}</p>
          <StatusPill status={booth.status} />
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xl leading-none h-8 w-8 flex items-center justify-center -mt-1 -mr-1 shrink-0"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {renter && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Renter</p>
          <p className="text-sm font-medium">
            {renter.firstName} {renter.lastName}
          </p>
          {renter.businessName && (
            <p className="text-xs text-muted-foreground">{renter.businessName}</p>
          )}
          {renter.specialty && (
            <p className="text-xs text-muted-foreground">{renter.specialty}</p>
          )}
          <p className="text-xs text-muted-foreground">{renter.email}</p>
          <Badge className="text-[10px]">{RENTER_STATUS_LABELS[renter.status] ?? renter.status ?? 'Unknown'}</Badge>
          {(renter as any).linkedStaffId && (
            <p className="text-[9px] font-black uppercase tracking-widest text-violet-600">Hybrid · Team member</p>
          )}
        </div>
      )}

      {lease && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Lease</p>
          <p className="text-sm font-medium">{formatCents(monthlyRent)} / mo</p>
          <p className="text-xs text-muted-foreground">
            {formatCents(lease.rentAmountCents)} /{' '}
            {(FREQUENCY_LABELS[lease.frequency] ?? lease.frequency ?? 'period').toLowerCase()}
          </p>
          {lease.scheduleSlot && (
            <p className="text-xs text-muted-foreground">
              Days: {lease.scheduleSlot.label ?? lease.scheduleSlot.days.join(', ')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {lease.endDate ? `Ends ${lease.endDate}` : 'Month-to-month'}
          </p>
          {(lease.perks?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {lease.perks.length} perk{lease.perks.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {(booth.amenities?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amenities</p>
          <div className="flex flex-wrap gap-1">
            {booth.amenities.map((a) => (
              <span
                key={a}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onEdit(booth)}
      >
        <Pencil className="h-3.5 w-3.5 mr-1.5" />
        Edit booth
      </Button>
    </div>
  );
}

// ─── Perk row (lease wizard) ──────────────────────────────────────────────────

function PerkRow({
  perk, onChange, onRemove,
}: {
  perk: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>;
  onChange: (u: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Perk type</Label>
          <Select value={perk.type} onValueChange={(v) => onChange({ ...perk, type: v as PerkType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PERK_TYPE_LABELS) as PerkType[]).map((t) => (
                <SelectItem key={t} value={t}>{PERK_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>When</Label>
          <Select value={perk.trigger} onValueChange={(v) => onChange({ ...perk, trigger: v as PerkTrigger })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PERK_TRIGGER_LABELS) as PerkTrigger[]).map((t) => (
                <SelectItem key={t} value={t}>{PERK_TRIGGER_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Label (visible on receipt)</Label>
          <Input placeholder="e.g. Sign-up bonus week" value={perk.label}
            onChange={(e) => onChange({ ...perk, label: e.target.value })} />
        </div>
        {(perk.type === 'product_credit' || perk.type === 'custom') && (
          <div className="space-y-1">
            <Label>Value ($)</Label>
            <Input type="number" min={0}
              value={perk.valueCents !== undefined ? (perk.valueCents / 100).toString() : ''}
              onChange={(e) => onChange({ ...perk, valueCents: Math.round(toNumber(e.target.value) * 100) })} />
          </div>
        )}
        {perk.type === 'rent_discount' && (
          <div className="space-y-1">
            <Label>Discount (%)</Label>
            <Input type="number" min={0} max={100} value={perk.valuePercent ?? ''}
              onChange={(e) => onChange({ ...perk, valuePercent: toNumber(e.target.value) })} />
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive hover:text-destructive">
        Remove perk
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BoothsPage() {
  const { firebaseApp, firestore } = useFirebase();
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const { selectedLocationId, locations, isLoading: locationsLoading } =
    useLocation();

  const storage = useMemo(() => getStorage(firebaseApp), [firebaseApp]);

  const { booths, renters, leases } = useBoothRentalCollections(
    tenantId,
    selectedLocationId
  );

  const boothById = useBoothIndex(booths.data);
  const occupyingLeaseByRenter = useOccupyingLeaseByRenter(leases.data);

  const [view, setView] = useState<'floor' | 'list' | 'renters'>('floor');

  // ── Booth dialog state ──────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BoothFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ── Renter dialog state ─────────────────────────────────────────────────────
  const [renterDialogOpen, setRenterDialogOpen] = useState(false);
  const [editingRenterId, setEditingRenterId] = useState<string | null>(null);
  const [renterForm, setRenterForm] = useState<RenterFormState>(EMPTY_RENTER_FORM);

  // ── v49 — CONSOLIDATION: BoothsPage is THE booth-rental hub. The
  // application pipeline and employee→renter conversion live here now;
  // the standalone Renters page is decommissioned.
  const [applications, setApplications] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'boothApplications')), (snap) => {
      setApplications(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, () => {});
    return () => unsub();
  }, [firestore, tenantId]);
  const pendingApps = useMemo(() =>
    applications.filter(a => (a.status === 'new' || a.status === 'in_review') && (!a.locationId || a.locationId === selectedLocationId))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [applications, selectedLocationId]);
  const [decidingAppId, setDecidingAppId] = useState<string | null>(null);
  const setAppStatus = async (app: any, status: string) => {
    await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', app.id), { status, decidedAt: new Date().toISOString() }).catch(() => {});
  };
  const approveApplication = async (app: any) => {
    if (decidingAppId) return;
    setDecidingAppId(app.id);
    try {
      if (app.rentalType === 'lease') {
        const parts = (app.name || '').trim().split(' ');
        await createRenter(firestore, {
          tenantId,
          locationId: app.locationId || selectedLocationId,
          firstName: parts[0] || 'New',
          lastName: parts.slice(1).join(' ') || 'Renter',
          email: app.email || '',
          phone: app.phone || undefined,
          specialty: app.specialty || undefined,
          notes: `Applied via website for ${app.boothName || 'a booth'}${app.timing ? ` · ${app.timing}` : ''}${app.message ? ` · "${app.message}"` : ''}`,
        } as any);
        await setAppStatus(app, 'approved');
        toast({ title: 'Approved — renter created', description: 'Assign their booth via a lease below.' });
      } else {
        await setAppStatus(app, 'approved');
        toast({ title: 'Day rental approved', description: `Reach out to ${app.name} to lock in dates.` });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Could not approve', description: 'Email may be missing — check the card.' });
    } finally { setDecidingAppId(null); }
  };

  // Employee → renter conversion (one identity, two financial relationships)
  const [convertibleStaff, setConvertibleStaff] = useState<any[]>([]);
  const loadConvertibleStaff = async () => {
    try {
      const snap = await getDocs(collection(firestore, 'tenants', tenantId, 'staff'));
      setConvertibleStaff(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter((s: any) => !s.isRenter && s.role !== 'renter'));
    } catch { setConvertibleStaff([]); }
  };
  const pickStaffToConvert = (staffId: string) => {
    const s = convertibleStaff.find(x => x.id === staffId);
    if (!s) { setRenterForm(f => ({ ...f, linkedStaffId: '' })); return; }
    const parts = (s.name || '').trim().split(' ');
    setRenterForm(f => ({ ...f, linkedStaffId: s.id, firstName: parts[0] || f.firstName, lastName: parts.slice(1).join(' ') || f.lastName, email: s.email || f.email, phone: s.phone || f.phone, specialty: s.specialty || f.specialty }));
  };
  const [renterError, setRenterError] = useState<string | null>(null);
  const [savingRenter, setSavingRenter] = useState(false);

  // ── Lease wizard state ──────────────────────────────────────────────────────
  const [leaseDialogOpen, setLeaseDialogOpen] = useState(false);
  const [leaseRenterId, setLeaseRenterId] = useState<string | null>(null);
  const [leaseStep, setLeaseStep] = useState(0);
  const [leaseForm, setLeaseForm] = useState<LeaseFormState>(buildEmptyLeaseForm());
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [savingLease, setSavingLease] = useState(false);

  const [statusTarget, setStatusTarget] = useState<Renter | null>(null);
  const [newStatus, setNewStatus] = useState<RenterStatus>('on_leave');
  const [savingStatus, setSavingStatus] = useState(false);

  const [endLeaseTarget, setEndLeaseTarget] = useState<Renter | null>(null);
  const [savingEndLease, setSavingEndLease] = useState(false);

  // ── Floor plan layout state ─────────────────────────────────────────────────
  const [locked, setLocked] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);

  // ── Command center state ────────────────────────────────────────────────────
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const prevBoothsMapRef = useRef<Map<string, Booth> | null>(null);
  const prevLeasesMapRef = useRef<Map<string, Lease> | null>(null);
  const prevRentersMapRef = useRef<Map<string, Renter> | null>(null);

  // Reset the diff baselines whenever the tenant or location changes.
  // Without this, switching locations swaps in a whole new booths/
  // renters/leases data set, and the diff effects below — seeing every
  // id as unfamiliar — would report the entire new location as "new"
  // activity and fire a toast per record. Setting the refs back to null
  // makes the next data arrival re-seed the baseline silently instead.
  useEffect(() => {
    prevBoothsMapRef.current = null;
    prevLeasesMapRef.current = null;
    prevRentersMapRef.current = null;
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
    setToasts([]);
  }, [tenantId, selectedLocationId]);

  const dragRef = useRef<{
    boothId: string;
    mode: 'move' | 'resize';
    startMouseX: number;
    startMouseY: number;
    startBoothX: number;
    startBoothY: number;
    startBoothW: number;
    startBoothH: number;
  } | null>(null);

  const [localPos, setLocalPos] = useState <
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});

  const renterById = useRenterIndex(renters.data);

  // Canonical, boothId-keyed occupancy — confirmed via booth-rental-hooks.ts
  // to use OCCUPYING_LEASE_STATUSES (active, on_leave, pending_signature),
  // the same definition occupyingLeaseByRenter already uses. Replaces the
  // page's previous local ['active','on_leave'] approximation.
  const activeLeaseByBooth = useOccupyingLeaseByBooth(leases.data);

  const sortedBooths = useMemo(() => {
    const list = booths.data ? [...booths.data] : [];
    list.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
    );
    return list;
  }, [booths.data]);

  const availableBooths = useMemo(
    () => (booths.data ?? []).filter((b) => b.status === 'vacant' || b.status === 'partial'),
    [booths.data]
  );

  const sortedRenters = useMemo(() => {
    const list = renters.data ? [...renters.data] : [];
    const order: Record<RenterStatus, number> = {
      active: 0, on_leave: 1, maternity_leave: 2, subletting: 3,
      prospective: 4, past: 5, archived: 6,
    };
    list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.lastName.localeCompare(b.lastName));
    return list;
  }, [renters.data]);

  const conflictingSlots = useMemo(() => {
    if (!leaseForm.boothId || !leaseForm.isShared) return [];
    return (leases.data ?? [])
      .filter((l) => l.boothId === leaseForm.boothId && l.scheduleSlot && l.status === 'active')
      .map((l) => l.scheduleSlot!);
  }, [leases.data, leaseForm.boothId, leaseForm.isShared]);

  const hasSlotConflict = useMemo(() => {
    if (!leaseForm.isShared || leaseForm.scheduleDays.length === 0) return false;
    const proposed = { days: leaseForm.scheduleDays };
    return conflictingSlots.some((existing) => slotsOverlap(proposed, existing));
  }, [leaseForm.isShared, leaseForm.scheduleDays, conflictingSlots]);

  const metrics = useMemo(() => {
    const allBooths = (booths.data ?? []).filter((b) => b.status !== 'inactive');
    const total = allBooths.length;
    const occupied = allBooths.filter(
      (b) => b.status === 'occupied' || b.status === 'partial'
    ).length;
    const vacant = allBooths.filter((b) => b.status === 'vacant').length;

    let monthlyRevenue = 0;
    let vacancyCost = 0;
    let potentialMonthly = 0;

    allBooths.forEach((b) => {
      const lease = activeLeaseByBooth.get(b.id);
      const baseMonthly = Math.round(
        b.baseRentCents * (FREQ_TO_MONTHLY[b.baseRentFrequency] ?? 1)
      );
      potentialMonthly += baseMonthly;
      if (lease) {
        monthlyRevenue += Math.round(
          lease.rentAmountCents * (FREQ_TO_MONTHLY[lease.frequency] ?? 1)
        );
      } else if (b.status === 'vacant') {
        vacancyCost += baseMonthly;
      }
    });

    const activeRenters = (renters.data ?? []).filter((r) => r.status === 'active').length;
    const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    return {
      total,
      occupied,
      vacant,
      monthlyRevenue,
      vacancyCost,
      potentialMonthly,
      occupancyPct,
      activeRenters,
    };
  }, [booths.data, activeLeaseByBooth, renters.data]);

  // ── Alerts (computed live from current data) ────────────────────────────────

  const alerts = useMemo<AlertItem[]>(() => {
    const list: AlertItem[] = [];
    const now = Date.now();

    (leases.data ?? []).forEach((l) => {
      if (l.status !== 'active' || !l.endDate) return;
      const end = new Date(l.endDate).getTime();
      if (Number.isNaN(end)) return;
      const days = Math.ceil((end - now) / 86_400_000);
      if (days < 0 || days > LEASE_ALERT_WINDOW_DAYS) return;
      const booth = boothById.get(l.boothId);
      const renter = renterById.get(l.renterId);
      const who = renter ? `${renter.firstName} ${renter.lastName}` : 'a renter';
      const where = booth?.name ?? 'a booth';
      list.push({
        id: `lease-exp-${l.id}`,
        severity: days <= 3 ? 'danger' : 'warning',
        message:
          days === 0
            ? `${where}'s lease with ${who} ends today`
            : `${where}'s lease with ${who} ends in ${days} day${days === 1 ? '' : 's'}`,
      });
    });

    (booths.data ?? []).forEach((b) => {
      if (b.status === 'maintenance') {
        list.push({
          id: `maint-${b.id}`,
          severity: 'warning',
          message: `${b.name} is flagged for maintenance`,
        });
      }
    });

    if (metrics.vacant > 0) {
      list.push({
        id: 'vacancy-cost',
        severity: 'info',
        message: `${metrics.vacant} booth${metrics.vacant > 1 ? 's' : ''} vacant — ${formatCents(
          metrics.vacancyCost
        )}/mo uncollected`,
      });
    }

    const severityRank: Record<AlertItem['severity'], number> = {
      danger: 0,
      warning: 1,
      info: 2,
    };
    return list.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [leases.data, booths.data, boothById, renterById, metrics]);

  const alertBadgeSeverity: AlertItem['severity'] | null =
    alerts.find((a) => a.severity === 'danger')?.severity ??
    alerts.find((a) => a.severity === 'warning')?.severity ??
    (alerts.length > 0 ? 'info' : null);

  // ── Activity feed + toasts (diffed off live Firestore snapshots) ───────────

  const pushActivity = useCallback(
    (message: string, kind: ActivityItem['kind']) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const time = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      setActivityLog((prev) => [{ id, message, time, kind }, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
      setToasts((prev) => [...prev, { id, message, kind }]);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        toastTimersRef.current.delete(id);
      }, TOAST_LIFETIME_MS);
      toastTimersRef.current.set(id, timer);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (booths.data || leases.data || renters.data) setLastSync(new Date());
  }, [booths.data, leases.data, renters.data]);

  // Diff booths → activity + toasts
  useEffect(() => {
    if (!booths.data) return;
    const map = new Map(booths.data.map((b) => [b.id, b]));
    const prev = prevBoothsMapRef.current;
    if (prev) {
      map.forEach((b, id) => {
        const old = prev.get(id);
        if (!old) {
          pushActivity(`New booth added: ${b.name}`, 'booth');
        } else if (old.status !== b.status) {
          pushActivity(
            `${b.name} changed from ${STATUS_CONFIG[old.status]?.label ?? old.status} to ${
              STATUS_CONFIG[b.status]?.label ?? b.status
            }`,
            'booth'
          );
        }
      });
      prev.forEach((b, id) => {
        if (!map.has(id)) pushActivity(`Booth removed: ${b.name}`, 'booth');
      });
    }
    prevBoothsMapRef.current = map;
  }, [booths.data, pushActivity]);

  // Diff leases → activity + toasts
  useEffect(() => {
    if (!leases.data) return;
    const map = new Map(leases.data.map((l) => [l.id, l]));
    const prev = prevLeasesMapRef.current;
    if (prev) {
      map.forEach((l, id) => {
        const boothName = boothById.get(l.boothId)?.name ?? 'a booth';
        const renter = renterById.get(l.renterId);
        const renterName = renter ? `${renter.firstName} ${renter.lastName}` : 'a renter';
        const old = prev.get(id);
        if (!old) {
          pushActivity(`New lease: ${renterName} signed for ${boothName}`, 'lease');
        } else if (old.status !== l.status) {
          pushActivity(`Lease for ${boothName} (${renterName}) is now ${l.status}`, 'lease');
        }
      });
      prev.forEach((l, id) => {
        if (!map.has(id)) {
          const boothName = boothById.get(l.boothId)?.name ?? 'a booth';
          pushActivity(`Lease removed for ${boothName}`, 'lease');
        }
      });
    }
    prevLeasesMapRef.current = map;
  }, [leases.data, boothById, renterById, pushActivity]);

  // Diff renters → activity + toasts
  useEffect(() => {
    if (!renters.data) return;
    const map = new Map(renters.data.map((r) => [r.id, r]));
    const prev = prevRentersMapRef.current;
    if (prev) {
      map.forEach((r, id) => {
        const old = prev.get(id);
        if (!old) {
          pushActivity(`New renter added: ${r.firstName} ${r.lastName}`, 'renter');
        } else if (old.status !== r.status) {
          pushActivity(
            `${r.firstName} ${r.lastName} status changed to ${
              RENTER_STATUS_LABELS[r.status] ?? r.status
            }`,
            'renter'
          );
        }
      });
    }
    prevRentersMapRef.current = map;
  }, [renters.data, pushActivity]);

  const effectiveBooth = useCallback(
    (booth: Booth) => {
      const lp = localPos[booth.id];
      if (lp)
        return { ...booth, canvasX: lp.x, canvasY: lp.y, canvasW: lp.w, canvasH: lp.h };
      return booth;
    },
    [localPos]
  );

  // ── Drag handlers (pointer events → works for mouse & touch) ───────────────

  const beginDrag = useCallback(
    (e: React.PointerEvent, boothId: string, mode: 'move' | 'resize') => {
      if (locked) return;
      e.preventDefault();
      const booth = (booths.data ?? []).find((b) => b.id === boothId);
      if (!booth) return;
      const lp = localPos[boothId];
      dragRef.current = {
        boothId,
        mode,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startBoothX: lp?.x ?? booth.canvasX,
        startBoothY: lp?.y ?? booth.canvasY,
        startBoothW: lp?.w ?? booth.canvasW,
        startBoothH: lp?.h ?? booth.canvasH,
      };
      setSelectedId(boothId);
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
    },
    [locked, booths.data, localPos]
  );

  const handleDragStart = useCallback(
    (e: React.PointerEvent, boothId: string) => beginDrag(e, boothId, 'move'),
    [beginDrag]
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, boothId: string) => beginDrag(e, boothId, 'resize'),
    [beginDrag]
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startMouseX;
      const dy = e.clientY - d.startMouseY;

      if (d.mode === 'move') {
        setLocalPos((prev) => ({
          ...prev,
          [d.boothId]: {
            x: Math.max(0, Math.min(CANVAS_W - d.startBoothW, snap(d.startBoothX + dx))),
            y: Math.max(0, Math.min(CANVAS_H - d.startBoothH, snap(d.startBoothY + dy))),
            w: d.startBoothW,
            h: d.startBoothH,
          },
        }));
      } else {
        setLocalPos((prev) => ({
          ...prev,
          [d.boothId]: {
            x: d.startBoothX,
            y: d.startBoothY,
            w: Math.max(GRID * 4, snap(d.startBoothW + dx)),
            h: Math.max(GRID * 4, snap(d.startBoothH + dy)),
          },
        }));
      }
    };

    const handlePointerUp = async () => {
      const d = dragRef.current;
      if (!d || !tenantId) {
        dragRef.current = null;
        return;
      }
      const lp = localPos[d.boothId];
      dragRef.current = null;
      if (!lp) return;

      setLayoutSaving(true);
      try {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), d.boothId),
          {
            canvasX: lp.x,
            canvasY: lp.y,
            canvasW: lp.w,
            canvasH: lp.h,
            updatedAt: new Date().toISOString(),
          }
        );
        setLocalPos((prev) => {
          const next = { ...prev };
          delete next[d.boothId];
          return next;
        });
      } finally {
        setLayoutSaving(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [firestore, tenantId, localPos]);

  const autoArrangeBooths = async () => {
    if (!tenantId) return;
    const unplaced = (booths.data ?? []).filter(
      (b) => (b.canvasX ?? 0) === 0 && (b.canvasY ?? 0) === 0
    );
    if (unplaced.length === 0) return;
    const cols = 4;
    const padX = 40;
    const padY = 40;
    const gapX = 20;
    const gapY = 20;
    setLayoutSaving(true);
    try {
      await Promise.all(
        unplaced.map((b, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return updateDoc(
            doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), b.id),
            {
              canvasX: padX + col * (DEFAULT_W + gapX),
              canvasY: padY + row * (DEFAULT_H + gapY),
              canvasW: DEFAULT_W,
              canvasH: DEFAULT_H,
              updatedAt: new Date().toISOString(),
            }
          );
        })
      );
    } finally {
      setLayoutSaving(false);
    }
  };

  // ── Booth CRUD ───────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (booth: Booth) => {
    setEditingId(booth.id);
    setForm({
      name: booth.name,
      typeValue: booth.type ?? 'booth',
      notes: booth.notes ?? '',
      baseRentDollars: (booth.baseRentCents / 100).toString(),
      baseRentFrequency: booth.baseRentFrequency,
      extraRates: (((booth as any).pricingOptions || []) as any[])
        .filter((o) => !(o.frequency === booth.baseRentFrequency && o.amountCents === booth.baseRentCents))
        .map((o) => ({ frequency: o.frequency, dollars: (o.amountCents / 100).toString() })),
      status: booth.status,
      amenities: booth.amenities ?? [],
      photoUrls: (booth as any).photoUrls ?? [],
    });
    setDialogOpen(true);
  };

  const toggleAmenity = (amenity: string) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || !tenantId || !selectedLocationId) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      if (editingId) {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), editingId),
          {
            name: form.name.trim(),
            type: form.typeValue,
            notes: form.notes.trim(),
            baseRentCents: Math.round(toNumber(form.baseRentDollars) * 100),
            baseRentFrequency: form.baseRentFrequency,
            pricingOptions: [
              { frequency: form.baseRentFrequency, amountCents: Math.round(toNumber(form.baseRentDollars) * 100) },
              ...form.extraRates.filter((r) => toNumber(r.dollars) > 0).map((r) => ({ frequency: r.frequency, amountCents: Math.round(toNumber(r.dollars) * 100) })),
            ],
            status: form.status,
            amenities: form.amenities,
            photoUrls: form.photoUrls,
            updatedAt: now,
          }
        );
      } else {
        // createBooth() always creates as 'vacant' (hardcoded in the
        // service function) — the Status selector is hidden for new
        // booths in the dialog below for exactly this reason; form.status
        // is only meaningful when editing.
        await createBooth(firestore, {
          tenantId,
          locationId: selectedLocationId,
          name: form.name.trim(),
          type: form.typeValue,
          notes: form.notes.trim() || undefined,
          baseRentCents: Math.round(toNumber(form.baseRentDollars) * 100),
          baseRentFrequency: form.baseRentFrequency,
          pricingOptions: [
            { frequency: form.baseRentFrequency, amountCents: Math.round(toNumber(form.baseRentDollars) * 100) },
            ...form.extraRates.filter((r) => toNumber(r.dollars) > 0).map((r) => ({ frequency: r.frequency, amountCents: Math.round(toNumber(r.dollars) * 100) })),
          ],
          amenities: form.amenities,
          photoUrls: form.photoUrls,
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (boothId: string) => {
    if (!tenantId) return;
    await deleteDoc(
      doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), boothId)
    );
    if (selectedId === boothId) setSelectedId(null);
  };

  // ── Renter CRUD ──────────────────────────────────────────────────────────────

  const openCreateRenter = () => {
    setEditingRenterId(null); setRenterForm(EMPTY_RENTER_FORM); setRenterError(null); setRenterDialogOpen(true); loadConvertibleStaff();
  };
  const openEditRenter = (renter: Renter) => {
    setEditingRenterId(renter.id);
    setRenterForm({ firstName: renter.firstName, lastName: renter.lastName, email: renter.email,
      phone: renter.phone ?? '', businessName: renter.businessName ?? '',
      specialty: renter.specialty ?? '', notes: renter.notes ?? '' });
    setRenterError(null); setRenterDialogOpen(true); loadConvertibleStaff();
  };
  const handleRenterDialogOpenChange = (open: boolean) => {
    if (!open) { setEditingRenterId(null); setRenterError(null); }
    setRenterDialogOpen(open);
  };

  const handleSaveRenter = async () => {
    if (!renterForm.firstName.trim() || !renterForm.email.trim() || !selectedLocationId || !tenantId) return;
    setSavingRenter(true); setRenterError(null);
    const now = new Date().toISOString();
    try {
      if (editingRenterId) {
        await updateDoc(
          doc(firestore, 'tenants', tenantId, 'renters', editingRenterId),
          {
            firstName: renterForm.firstName.trim(),
            lastName: renterForm.lastName.trim(),
            email: renterForm.email.trim(),
            phone: renterForm.phone.trim(),
            businessName: renterForm.businessName.trim(),
            specialty: renterForm.specialty.trim(),
            notes: [renterForm.notes.trim(), renterForm.linkedStaffId ? 'Hybrid — also a team member.' : ''].filter(Boolean).join(' '),
            linkedStaffId: renterForm.linkedStaffId || undefined,
            updatedAt: now,
          }
        );
      } else {
        await createRenter(firestore, {
          tenantId,
          locationId: selectedLocationId,
          firstName: renterForm.firstName.trim(),
          lastName: renterForm.lastName.trim(),
          email: renterForm.email.trim(),
          phone: renterForm.phone.trim() || undefined,
          businessName: renterForm.businessName.trim() || undefined,
          specialty: renterForm.specialty.trim() || undefined,
          notes: renterForm.notes.trim() || undefined,
        });
      }
      setRenterDialogOpen(false); setEditingRenterId(null);
    } catch (err) {
      setRenterError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setSavingRenter(false); }
  };

  // ── Lease wizard ─────────────────────────────────────────────────────────────

  const openLeaseWizard = (renterId: string) => {
    setLeaseRenterId(renterId); setLeaseForm(buildEmptyLeaseForm());
    setLeaseStep(0); setLeaseError(null); setLeaseDialogOpen(true);
  };
  const handleLeaseDialogOpenChange = (open: boolean) => {
    if (!open) { setLeaseStep(0); setLeaseForm(buildEmptyLeaseForm()); setLeaseError(null); }
    setLeaseDialogOpen(open);
  };
  const handleBoothSelect = (boothId: string) => {
    const booth = boothById.get(boothId);
    setLeaseForm((prev) => ({
      ...prev, boothId,
      rentDollars: booth ? (booth.baseRentCents / 100).toString() : prev.rentDollars,
      frequency: booth ? booth.baseRentFrequency : prev.frequency, dueDay: '1',
    }));
  };
  const toggleScheduleDay = (day: WeekDay) => {
    setLeaseForm((prev) => ({
      ...prev,
      scheduleDays: prev.scheduleDays.includes(day)
        ? prev.scheduleDays.filter((d) => d !== day)
        : [...prev.scheduleDays, day],
    }));
  };
  const addPerk = () => {
    setLeaseForm((prev) => ({
      ...prev,
      perks: [...prev.perks, { id: crypto.randomUUID(), type: 'free_week', label: 'Free week',
        trigger: 'on_signup', valueCents: undefined, valuePercent: undefined }],
    }));
  };
  const updatePerk = (id: string, updated: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>) =>
    setLeaseForm((prev) => ({ ...prev, perks: prev.perks.map((p) => p.id === id ? updated : p) }));
  const removePerk = (id: string) =>
    setLeaseForm((prev) => ({ ...prev, perks: prev.perks.filter((p) => p.id !== id) }));

  const step0Valid =
    Boolean(leaseForm.boothId && toNumber(leaseForm.rentDollars) > 0) &&
    !hasSlotConflict &&
    (!leaseForm.isShared || leaseForm.scheduleDays.length > 0);
  const step1Valid = (() => {
    if (!leaseForm.lateFeeEnabled) return true;
    if (leaseForm.lateFeeType === 'flat' && toNumber(leaseForm.lateFeeAmountDollars) <= 0) return false;
    if (leaseForm.lateFeeType === 'percent' && toNumber(leaseForm.lateFeePercent) <= 0) return false;
    return true;
  })();
  const wizardCanAdvance = leaseStep === 0 ? step0Valid : leaseStep === 1 ? step1Valid : true;

  const handleCreateLease = async () => {
    if (!leaseRenterId || !leaseForm.boothId || !selectedLocationId || !tenantId) return;
    setSavingLease(true); setLeaseError(null);
    try {
      let signedDocumentUrl: string | null = null;
      if (leaseForm.signedFile) {
        const path = `tenants/${tenantId}/leases/${Date.now()}-${leaseForm.signedFile.name}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, leaseForm.signedFile);
        signedDocumentUrl = await getDownloadURL(fileRef);
      }
      const booth = boothById.get(leaseForm.boothId);
      const depositCents = Math.round(toNumber(leaseForm.depositDollars) * 100);
      const scheduleSlot = leaseForm.isShared && leaseForm.scheduleDays.length > 0
        ? { days: leaseForm.scheduleDays,
            startTime: leaseForm.scheduleStartTime || undefined,
            endTime: leaseForm.scheduleEndTime || undefined,
            label: leaseForm.scheduleLabel || undefined }
        : null;

      await createLease(firestore, {
        tenantId,
        locationId: booth?.locationId ?? selectedLocationId,
        boothId: leaseForm.boothId,
        renterId: leaseRenterId,
        rentAmountCents: Math.round(toNumber(leaseForm.rentDollars) * 100),
        frequency: leaseForm.frequency,
        dueDay: parseInt(leaseForm.dueDay, 10) || 1,
        firstChargeDate: leaseForm.firstChargeDate,
        startDate: leaseForm.startDate,
        endDate: leaseForm.endDate || null,
        autoRenew: leaseForm.autoRenew,
        earlyTerminationNoticeDays: parseInt(leaseForm.noticeDays, 10) || 30,
        deposit: depositCents > 0 ? {
          amountCents: depositCents,
          refundable: leaseForm.depositRefundable,
          refundConditions: leaseForm.depositConditions.trim(),
          collectedLedgerEntryId: null,
          refundedLedgerEntryId: null,
        } : null,
        lateFeePolicy: {
          enabled: leaseForm.lateFeeEnabled,
          graceDays: parseInt(leaseForm.lateFeeGraceDays, 10) || 0,
          type: leaseForm.lateFeeType,
          ...(leaseForm.lateFeeType === 'flat'
            ? { amountCents: Math.round(toNumber(leaseForm.lateFeeAmountDollars) * 100) }
            : { percent: toNumber(leaseForm.lateFeePercent) }),
        },
        scheduleSlot,
        perks: leaseForm.perks,
        includedAmenities: booth?.amenities ?? [],
        houseRules: leaseForm.houseRules.trim(),
        signedDocumentUrl,
        isShared: leaseForm.isShared,
      });

      setLeaseDialogOpen(false);
    } catch (err) {
      setLeaseError(err instanceof Error ? err.message : 'Failed to create lease.');
    } finally { setSavingLease(false); }
  };

  const handleEndLease = async () => {
    if (!endLeaseTarget || !tenantId) return;
    const lease = occupyingLeaseByRenter.get(endLeaseTarget.id);
    if (!lease) return;
    setSavingEndLease(true);
    try {
      await endLease(firestore, tenantId, lease, endLeaseTarget.id, leases.data ?? []);
    } finally { setSavingEndLease(false); setEndLeaseTarget(null); }
  };

  const handleStatusChange = async () => {
    if (!statusTarget || !tenantId) return;
    setSavingStatus(true);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renters', statusTarget.id),
        { status: newStatus, updatedAt: new Date().toISOString() });
      const lease = occupyingLeaseByRenter.get(statusTarget.id);
      if (lease && (newStatus === 'on_leave' || newStatus === 'maternity_leave')) {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'leases', lease.id),
          { status: 'on_leave', updatedAt: new Date().toISOString() });
      }
      if (lease && newStatus === 'active') {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'leases', lease.id),
          { status: 'active', updatedAt: new Date().toISOString() });
      }
    } finally { setSavingStatus(false); setStatusTarget(null); }
  };

  // ── Loading / empty states ───────────────────────────────────────────────────

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

  if (!locationsLoading && locations.length === 0) {
    return (
      <div className="p-8 space-y-3">
        <p className="font-medium">No locations set up yet</p>
        <p className="text-sm text-muted-foreground">
          Add at least one location before managing booths, renters, and
          leases — every booth, renter, and lease belongs to a specific
          location.
        </p>
      </div>
    );
  }

  if (locationsLoading || !selectedLocationId) {
    return <div className="p-8 text-sm text-muted-foreground">Loading location…</div>;
  }

  const selectedBooth = selectedId
    ? (booths.data ?? []).find((b) => b.id === selectedId)
    : null;
  const selectedLease = selectedBooth
    ? activeLeaseByBooth.get(selectedBooth.id)
    : undefined;
  const selectedRenter = selectedLease
    ? renterById.get(selectedLease.renterId)
    : undefined;
  const selectedLeaseBooth = boothById.get(leaseForm.boothId);

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* v49 — website applications land here, top of the hub: inbound
          demand gets first attention. Live via onSnapshot. */}
      {pendingApps.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black uppercase tracking-widest">Applications</h2>
            <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">{pendingApps.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingApps.map((app: any) => (
              <div key={app.id} className={`rounded-2xl border-2 p-4 space-y-3 ${app.status === 'in_review' ? 'border-sky-200 bg-sky-50/40' : 'border-amber-300 bg-amber-50/50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-black text-sm uppercase truncate">{app.name}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{app.rentalType === 'lease' ? 'Monthly lease' : 'Hourly / daily'} · {app.boothName || 'Any booth'}{app.specialty ? ` · ${app.specialty}` : ''}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 shrink-0 ${app.status === 'in_review' ? 'bg-sky-200 text-sky-800' : 'bg-amber-200 text-amber-800'}`}>{app.status === 'in_review' ? 'Contacted' : 'New'}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-600">
                  {app.phone && <a href={`tel:${app.phone}`} className="underline underline-offset-2 text-indigo-600">{app.phone}</a>}
                  {app.email && <a href={`mailto:${app.email}`} className="underline underline-offset-2 text-indigo-600 truncate">{app.email}</a>}
                  {app.timing && <span className="text-slate-500">{app.timing}</span>}
                </div>
                {Array.isArray(app.attachments) && app.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {app.attachments.map((at: any) => (
                      <a key={at.url} href={at.url} target="_blank" rel="noreferrer" className="text-[9px] font-black uppercase tracking-wide bg-slate-100 text-slate-700 rounded-full px-2 py-0.5 underline underline-offset-2">📎 {at.label || at.name}</a>
                    ))}
                  </div>
                )}
                {app.message && <p className="text-xs font-medium text-slate-600 italic line-clamp-2">"{app.message}"</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => approveApplication(app)} disabled={decidingAppId === app.id} className="flex-1 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">{decidingAppId === app.id ? 'Working...' : app.rentalType === 'lease' ? 'Approve → Create Renter' : 'Approve'}</button>
                  {app.status === 'new' && <button onClick={() => setAppStatus(app, 'in_review')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-sky-700 border-sky-300">Contacted</button>}
                  <button onClick={() => setAppStatus(app, 'declined')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Armchair className="h-6 w-6" />
            Booths
          </h1>
          <p className="text-sm text-muted-foreground mb-1.5">
            Booths, renters, and leases — all in one place.
          </p>
          <div className="mb-1.5">
            <LocationSwitcher />
          </div>
          <LivePulse lastSync={lastSync} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="grid grid-cols-3 sm:flex rounded-lg border border-border p-0.5 gap-0.5 sm:gap-0">
            <Button
              variant={view === 'floor' ? 'default' : 'ghost'}
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setView('floor')}
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              <span className="sm:hidden">Floor</span>
              <span className="hidden sm:inline">Floor plan</span>
            </Button>
            <Button
              variant={view === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setView('list')}
            >
              <List className="h-4 w-4 mr-1.5" />
              List
            </Button>
            <Button
              variant={view === 'renters' ? 'default' : 'ghost'}
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setView('renters')}
            >
              <Users className="h-4 w-4 mr-1.5" />
              Renters
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-2">
            <Button
              variant="outline"
              className="relative w-full sm:w-auto"
              onClick={() => setCommandCenterOpen(true)}
            >
              <Bell className="h-4 w-4 mr-1.5 sm:mr-2 shrink-0" />
              <span className="sm:hidden">Alerts</span>
              <span className="hidden sm:inline">Command Center</span>
              {alertBadgeSeverity && (
                <span
                  className={cn(
                    'absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center text-white',
                    alertBadgeSeverity === 'danger' && 'bg-red-500',
                    alertBadgeSeverity === 'warning' && 'bg-amber-500',
                    alertBadgeSeverity === 'info' && 'bg-sky-500'
                  )}
                >
                  {alerts.length}
                </span>
              )}
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setPricingOpen(true)}>
              <Calculator className="h-4 w-4 mr-1.5 sm:mr-2 shrink-0" />
              <span className="sm:hidden">Pricing</span>
              <span className="hidden sm:inline">Pricing Advisor</span>
            </Button>
            {view === 'renters' ? (
              <Button className="w-full sm:w-auto" onClick={openCreateRenter}>
                <UserPlus className="h-4 w-4 mr-1.5 sm:mr-2 shrink-0" />
                <span className="sm:hidden">Add</span>
                <span className="hidden sm:inline">Add renter</span>
              </Button>
            ) : (
              <Button className="w-full sm:w-auto" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5 sm:mr-2 shrink-0" />
                <span className="sm:hidden">Add</span>
                <span className="hidden sm:inline">Add booth</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard
          label="Monthly revenue"
          value={formatCents(metrics.monthlyRevenue)}
          sub={`${metrics.occupancyPct}% occupancy`}
          icon={CircleDollarSign}
          accent="#185FA5"
        />
        <MetricCard
          label="Occupied"
          value={`${metrics.occupied} / ${metrics.total}`}
          sub="booths"
          icon={TrendingUp}
          accent="#0F6E56"
        />
        <MetricCard
          label="Vacant"
          value={String(metrics.vacant)}
          sub={
            metrics.vacancyCost > 0
              ? `${formatCents(metrics.vacancyCost)}/mo uncollected`
              : 'No vacancies'
          }
          icon={DoorOpen}
          accent={metrics.vacant > 0 ? '#BA7517' : '#3B6D11'}
        />
        <MetricCard
          label="Potential rent"
          value={formatCents(metrics.potentialMonthly)}
          sub="if fully occupied"
          icon={Calculator}
          accent="#5B4A8A"
        />
        <MetricCard
          label="Active renters"
          value={String(metrics.activeRenters)}
          sub={`${sortedRenters.length} total`}
          icon={Users}
          accent="#B23A6B"
        />
      </div>

      {(booths.isLoading || renters.isLoading) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {view === 'floor' && !booths.isLoading && sortedBooths.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <DoorOpen className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No booths yet</p>
            <p className="text-sm text-muted-foreground">
              Add your first booth, then use the Pricing Advisor to set a rent
              that actually covers your costs.
            </p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add your first booth
            </Button>
          </CardContent>
        </Card>
      )}

      {view === 'floor' && sortedBooths.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              {(Object.entries(BOOTH_STATUS_COLORS) as [
                Booth['status'],
                (typeof BOOTH_STATUS_COLORS)[Booth['status']]
              ][]).map(([status, c]) => (
                <span
                  key={status}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: c.bg, border: `1.5px solid ${c.border}` }}
                  />
                  {BOOTH_STATUS_LABELS[status]}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {layoutSaving && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Saving…
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={autoArrangeBooths}
                disabled={layoutSaving || locked}
              >
                <LayoutGrid className="h-4 w-4 mr-1.5" />
                Auto-arrange
              </Button>
              <Button
                variant={locked ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setLocked((l) => !l)}
              >
                {locked ? (
                  <>
                    <Lock className="h-4 w-4 mr-1.5" />
                    Layout locked
                  </>
                ) : (
                  <>
                    <Unlock className="h-4 w-4 mr-1.5" />
                    Editing layout
                  </>
                )}
              </Button>
            </div>
          </div>

          {!locked && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              Drag to move · drag corner to resize · changes save automatically
            </p>
          )}

          <div className="relative">
            <div className="h-[380px] sm:h-[500px] lg:h-[600px] overflow-auto rounded-xl border border-border bg-muted/30 touch-pan-x touch-pan-y">
              <div
                className="relative"
                style={{
                  width: CANVAS_W,
                  height: CANVAS_H,
                  backgroundImage: locked
                    ? undefined
                    : 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
                  backgroundSize: `${GRID}px ${GRID}px`,
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSelectedId(null);
                }}
              >
                {sortedBooths.map((b) => {
                  const eb = effectiveBooth(b);
                  const lease = activeLeaseByBooth.get(b.id);
                  const renter = lease ? renterById.get(lease.renterId) : undefined;
                  return (
                    <TooltipProvider key={b.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <BoothCanvasCard
                              booth={eb}
                              renter={renter}
                              lease={lease}
                              selected={selectedId === b.id}
                              locked={locked}
                              onDragStart={handleDragStart}
                              onResizeStart={handleResizeStart}
                              onClick={setSelectedId}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                          <p className="font-medium">{b.name}</p>
                          {(b.amenities?.length ?? 0) > 0 && (
                            <p className="text-muted-foreground">
                              {b.amenities.join(', ')}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            </div>

            {selectedBooth && (
              <DetailPanel
                booth={effectiveBooth(selectedBooth)}
                renter={selectedRenter}
                lease={selectedLease}
                onClose={() => setSelectedId(null)}
                onEdit={(booth) => {
                  openEdit(booth);
                }}
              />
            )}
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedBooths.map((booth) => {
            const statusConfig = STATUS_CONFIG[booth.status] ?? STATUS_CONFIG.vacant;
            return (
              <Card key={booth.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{booth.name}</CardTitle>
                    <Badge className={statusConfig.badgeClass}>
                      {booth.status === 'maintenance' && (
                        <Wrench className="h-3 w-3 mr-1" />
                      )}
                      {statusConfig.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3">
                  <p className="text-lg font-semibold">
                    {formatCents(booth.baseRentCents)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      / {(FREQUENCY_LABELS[booth.baseRentFrequency] ?? booth.baseRentFrequency ?? 'period').toLowerCase()}
                    </span>
                  </p>
                  {booth.notes && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {booth.notes}
                    </p>
                  )}
                  {booth.amenities?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {booth.amenities.map((amenity) => (
                        <Badge key={amenity} variant="secondary" className="text-xs">
                          {amenity}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => openEdit(booth)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(booth.id)}
                      disabled={booth.status === 'occupied'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {view === 'renters' && (
        <div className="space-y-4">
          {!renters.isLoading && sortedRenters.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Users className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="font-medium">No renters yet</p>
                <p className="text-sm text-muted-foreground">Add a renter, then set up their lease with schedule, deposit, and perks.</p>
                <Button onClick={openCreateRenter}><UserPlus className="h-4 w-4 mr-2" />Add your first renter</Button>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {sortedRenters.map((renter) => {
              const sc = RENTER_STATUS_CONFIG[renter.status] ?? RENTER_STATUS_CONFIG.prospective;
              const lease = occupyingLeaseByRenter.get(renter.id);
              const booth = lease ? boothById.get(lease.boothId) : undefined;
              return (
                <Card key={renter.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{renter.firstName} {renter.lastName}</CardTitle>
                        {renter.businessName && <p className="text-sm text-muted-foreground">{renter.businessName}</p>}
                      </div>
                      <Badge className={sc.badgeClass}>{sc.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>{renter.email}</p>
                      {renter.phone && <p>{renter.phone}</p>}
                      {renter.specialty && <p>Specialty: {renter.specialty}</p>}
                    </div>
                    {lease && (
                      <div className="rounded-lg border p-3 space-y-1.5">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <FileText className="h-4 w-4" />{booth ? booth.name : 'Lease'}
                          {lease.scheduleSlot && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CircleDollarSign className="h-4 w-4" />
                          {formatCents(lease.rentAmountCents)} / {(FREQUENCY_LABELS[lease.frequency] ?? lease.frequency ?? 'period').toLowerCase()}
                        </div>
                        {lease.scheduleSlot && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {lease.scheduleSlot.label ?? lease.scheduleSlot.days.map((d) => WEEKDAY_LABELS[d]).join(', ')}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarDays className="h-4 w-4" />
                          {lease.endDate ? `Through ${lease.endDate}` : 'Month-to-month'}
                        </div>
                        {(lease.perks?.length ?? 0) > 0 && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Gift className="h-4 w-4" />{lease.perks.length} perk{lease.perks.length > 1 ? 's' : ''}
                          </div>
                        )}
                        {lease.signedDocumentUrl && (
                          <a href={lease.signedDocumentUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm underline underline-offset-2">
                            <FileSignature className="h-4 w-4" />Signed agreement
                          </a>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => openEditRenter(renter)}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                      </Button>
                      {!lease && (
                        <Button size="sm" onClick={() => openLeaseWizard(renter.id)}>
                          <DoorOpen className="h-3.5 w-3.5 mr-1.5" />Set up lease
                        </Button>
                      )}
                      {(renter.status === 'active' || renter.status === 'on_leave' || renter.status === 'maternity_leave') && (
                        <Button variant="outline" size="sm" onClick={() => {
                          setStatusTarget(renter);
                          setNewStatus(renter.status === 'active' ? 'on_leave' : 'active');
                        }}>
                          <Pause className="h-3.5 w-3.5 mr-1.5" />
                          {renter.status === 'active' ? 'Put on leave' : 'Return from leave'}
                        </Button>
                      )}
                      {lease && (
                        <Button variant="ghost" size="sm" onClick={() => setEndLeaseTarget(renter)}>
                          <LogOut className="h-3.5 w-3.5 mr-1.5" />End lease
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Booth dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit booth' : 'Add booth'}</DialogTitle>
            <DialogDescription>
              Name it the way your renters know it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="booth-name">Name</Label>
              <Input
                id="booth-name"
                placeholder="Booth 1, Suite B, Chair 3…"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={form.typeValue}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, typeValue: value as Booth['type'] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booth">Booth</SelectItem>
                  <SelectItem value="chair">Chair</SelectItem>
                  <SelectItem value="room">Room</SelectItem>
                  <SelectItem value="suite">Suite</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="booth-rent">Base rent ($)</Label>
                <Input
                  id="booth-rent"
                  type="number"
                  placeholder="250"
                  value={form.baseRentDollars}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      baseRentDollars: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Frequency</Label>
                <Select
                  value={form.baseRentFrequency}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      baseRentFrequency: value as RentFrequency,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* v50 — MULTI-PRICING. One asset, many rates ("$25/hr ·
                $450/wk · $1,500/mo"). The primary rate above stays the
                lease anchor; these add transactional and alternative
                rates. Stored as pricingOptions[] alongside the legacy
                base fields for full backward compatibility. */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Additional rates (optional)</Label>
              {form.extraRates.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input type="number" min="0" placeholder="0.00" value={r.dollars} className="w-28"
                    onChange={(e) => setForm((prev) => ({ ...prev, extraRates: prev.extraRates.map((x, j) => j === i ? { ...x, dollars: e.target.value } : x) }))} />
                  <select value={r.frequency} className="h-10 rounded-lg border-2 px-3 text-sm font-medium bg-white"
                    onChange={(e) => setForm((prev) => ({ ...prev, extraRates: prev.extraRates.map((x, j) => j === i ? { ...x, frequency: e.target.value } : x) }))}>
                    <option value="hourly">Per hour</option>
                    <option value="daily">Per day</option>
                    <option value="weekly">Per week</option>
                    <option value="monthly">Per month</option>
                  </select>
                  <button type="button" className="text-slate-400 font-black px-2"
                    onClick={() => setForm((prev) => ({ ...prev, extraRates: prev.extraRates.filter((_, j) => j !== i) }))}>×</button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => setForm((prev) => ({ ...prev, extraRates: [...prev.extraRates, { frequency: 'daily', dollars: '' }] }))}>
                + Add a rate
              </Button>
            </div>

            <Button
              type="button"
              variant="link"
              className="px-0 h-auto text-sm"
              onClick={() => setPricingOpen(true)}
            >
              <Calculator className="h-3.5 w-3.5 mr-1.5" />
              Not sure what to charge? Open the Pricing Advisor
            </Button>

            {editingId && (
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, status: value as BoothStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacant">Vacant</SelectItem>
                    <SelectItem value="occupied">Occupied</SelectItem>
                    <SelectItem value="partial">Partial (shared)</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Included with this booth</Label>
              <div className="flex flex-wrap gap-2">
                {AMENITY_OPTIONS.map((amenity) => {
                  const selected = form.amenities.includes(amenity);
                  const chipClass = selected
                    ? 'cursor-pointer'
                    : 'cursor-pointer opacity-60';
                  return (
                    <Badge
                      key={amenity}
                      variant={selected ? 'default' : 'outline'}
                      className={chipClass}
                      onClick={() => toggleAmenity(amenity)}
                    >
                      {amenity}
                    </Badge>
                  );
                })}
              </div>

              {/* v47 — listing photos. Shared ImageUpload pipeline
                  (Storage-backed); first photo is the listing hero. */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Listing photos</p>
                {form.photoUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.photoUrls.map((u, i) => (
                      <div key={u} className="relative w-16 h-16 rounded-xl overflow-hidden border-2">
                        <img src={u} alt="" className="w-full h-full object-cover" />
                        {i === 0 && <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[7px] font-black uppercase text-center">Hero</span>}
                        <button type="button" onClick={() => setForm(prev => ({ ...prev, photoUrls: prev.photoUrls.filter(x => x !== u) }))} className="absolute top-0 right-0 bg-black/60 text-white w-4 h-4 text-[9px] leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <ImageUpload multiple clearOnUpload enableMarkup={false} storageFolder="uploads"
                  onImageUploaded={(url) => { if (url) setForm(prev => ({ ...prev, photoUrls: [...prev.photoUrls, url] })); }} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="booth-notes">Notes (optional)</Label>
              <Textarea
                id="booth-notes"
                placeholder="Window seat, private suite with door, near reception…"
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add booth'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renter dialog */}
      <Dialog open={renterDialogOpen} onOpenChange={handleRenterDialogOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRenterId ? 'Edit renter' : 'Add renter'}</DialogTitle>
            <DialogDescription>Their independent business — your records.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingRenterId && convertibleStaff.length > 0 && (
              <div className="space-y-1 rounded-xl border-2 border-indigo-100 bg-indigo-50/40 p-3">
                <Label className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Converting an existing team member?</Label>
                <select value={renterForm.linkedStaffId} onChange={(e) => pickStaffToConvert(e.target.value)} className="w-full h-10 rounded-lg border-2 px-3 text-sm font-medium bg-white">
                  <option value="">No — this is a new person</option>
                  {convertibleStaff.map((s: any) => (<option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${s.role}` : ''}</option>))}
                </select>
                {renterForm.linkedStaffId && (
                  <p className="text-[10px] font-bold text-indigo-600">Details prefilled. Their staff PIN stays their portal login — this adds the rent relationship only.</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="r-first">First name</Label>
                <Input id="r-first" value={renterForm.firstName} onChange={(e) => setRenterForm((p) => ({ ...p, firstName: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="r-last">Last name</Label>
                <Input id="r-last" value={renterForm.lastName} onChange={(e) => setRenterForm((p) => ({ ...p, lastName: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="r-email">Email</Label>
              <Input id="r-email" type="email" value={renterForm.email} onChange={(e) => setRenterForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="r-phone">Phone</Label>
                <Input id="r-phone" value={renterForm.phone} onChange={(e) => setRenterForm((p) => ({ ...p, phone: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="r-specialty">Specialty</Label>
                <Input id="r-specialty" placeholder="Nails, hair, lashes…" value={renterForm.specialty} onChange={(e) => setRenterForm((p) => ({ ...p, specialty: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="r-business">Business name (optional)</Label>
              <Input id="r-business" value={renterForm.businessName} onChange={(e) => setRenterForm((p) => ({ ...p, businessName: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="r-notes">Notes (private)</Label>
              <Textarea id="r-notes" value={renterForm.notes} onChange={(e) => setRenterForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            {renterError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />{renterError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleRenterDialogOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSaveRenter} disabled={savingRenter || !renterForm.firstName.trim() || !renterForm.email.trim()}>
              {savingRenter ? 'Saving…' : editingRenterId ? 'Save changes' : 'Add renter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lease wizard */}
      <Dialog open={leaseDialogOpen} onOpenChange={handleLeaseDialogOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set up lease</DialogTitle>
            <DialogDescription>Step {leaseStep + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[leaseStep]}</DialogDescription>
          </DialogHeader>

          {leaseStep === 0 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Booth</Label>
                <Select value={leaseForm.boothId} onValueChange={handleBoothSelect}>
                  <SelectTrigger><SelectValue placeholder="Choose a booth" /></SelectTrigger>
                  <SelectContent>
                    {availableBooths.length === 0 && <SelectItem value="none" disabled>No available booths</SelectItem>}
                    {availableBooths.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.status === 'partial' ? 'shared' : 'vacant'}) — {formatCents(b.baseRentCents)} / {(FREQUENCY_LABELS[b.baseRentFrequency] ?? b.baseRentFrequency ?? 'period').toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Shared / part-time booth</p>
                  <p className="text-xs text-muted-foreground">Multiple renters share on different days</p>
                </div>
                <Switch checked={leaseForm.isShared}
                  onCheckedChange={(c) => setLeaseForm((p) => ({ ...p, isShared: c, scheduleDays: [] }))} />
              </div>

              {leaseForm.isShared && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="space-y-2">
                    <Label>Days of access</Label>
                    <div className="flex gap-2 flex-wrap">
                      {WEEKDAY_OPTIONS.map((opt) => {
                        const taken = conflictingSlots.some((s) => s.days.includes(opt.value));
                        const checked = leaseForm.scheduleDays.includes(opt.value);
                        return (
                          <button key={opt.value} type="button"
                            disabled={taken && !checked}
                            onClick={() => !taken && toggleScheduleDay(opt.value)}
                            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                              checked ? 'bg-primary text-primary-foreground border-primary'
                              : taken ? 'opacity-40 cursor-not-allowed border-border'
                              : 'border-border hover:bg-muted'
                            }`}>
                            {opt.label}{taken && !checked && <span className="ml-1 text-[10px] text-destructive">taken</span>}
                          </button>
                        );
                      })}
                    </div>
                    {hasSlotConflict && <p className="text-xs text-destructive">Selected days conflict with an existing lease.</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Start time (optional)</Label>
                      <Input type="time" value={leaseForm.scheduleStartTime} onChange={(e) => setLeaseForm((p) => ({ ...p, scheduleStartTime: e.target.value }))} /></div>
                    <div className="space-y-1"><Label>End time (optional)</Label>
                      <Input type="time" value={leaseForm.scheduleEndTime} onChange={(e) => setLeaseForm((p) => ({ ...p, scheduleEndTime: e.target.value }))} /></div>
                  </div>
                  <div className="space-y-1"><Label>Slot label (optional)</Label>
                    <Input placeholder="e.g. Tuesday / Thursday mornings" value={leaseForm.scheduleLabel}
                      onChange={(e) => setLeaseForm((p) => ({ ...p, scheduleLabel: e.target.value }))} /></div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="l-rent">Rent ($)</Label>
                  <Input id="l-rent" type="number" value={leaseForm.rentDollars} onChange={(e) => setLeaseForm((p) => ({ ...p, rentDollars: e.target.value }))} /></div>
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <Select value={leaseForm.frequency} onValueChange={(v) => setLeaseForm((p) => ({ ...p, frequency: v as RentFrequency, dueDay: '1' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="l-start">Lease start</Label>
                  <Input id="l-start" type="date" value={leaseForm.startDate} onChange={(e) => setLeaseForm((p) => ({ ...p, startDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="l-end">End (blank = month-to-month)</Label>
                  <Input id="l-end" type="date" min={leaseForm.startDate} value={leaseForm.endDate} onChange={(e) => setLeaseForm((p) => ({ ...p, endDate: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="l-fc">First charge date</Label>
                  <Input id="l-fc" type="date" min={toIsoDate(new Date())} value={leaseForm.firstChargeDate} onChange={(e) => setLeaseForm((p) => ({ ...p, firstChargeDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="l-notice">Notice days</Label>
                  <Input id="l-notice" type="number" value={leaseForm.noticeDays} onChange={(e) => setLeaseForm((p) => ({ ...p, noticeDays: e.target.value }))} /></div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="text-sm font-medium">Auto-renew</p>
                  <p className="text-xs text-muted-foreground">Continues unless either party gives notice</p></div>
                <Switch checked={leaseForm.autoRenew} onCheckedChange={(c) => setLeaseForm((p) => ({ ...p, autoRenew: c }))} />
              </div>
            </div>
          )}

          {leaseStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-1"><Label htmlFor="l-deposit">Security deposit ($)</Label>
                <Input id="l-deposit" type="number" placeholder="0 for none" value={leaseForm.depositDollars}
                  onChange={(e) => setLeaseForm((p) => ({ ...p, depositDollars: e.target.value }))} /></div>
              {toNumber(leaseForm.depositDollars) > 0 && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Deposit is refundable</p>
                    <Switch checked={leaseForm.depositRefundable} onCheckedChange={(c) => setLeaseForm((p) => ({ ...p, depositRefundable: c }))} />
                  </div>
                  <div className="space-y-1"><Label htmlFor="l-depcond">Refund conditions</Label>
                    <Textarea id="l-depcond" placeholder="Returned within 14 days of move-out…" value={leaseForm.depositConditions}
                      onChange={(e) => setLeaseForm((p) => ({ ...p, depositConditions: e.target.value }))} /></div>
                </div>
              )}
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-medium">Late fees</p>
                    <p className="text-xs text-muted-foreground">Applied after grace period</p></div>
                  <Switch checked={leaseForm.lateFeeEnabled} onCheckedChange={(c) => setLeaseForm((p) => ({ ...p, lateFeeEnabled: c }))} />
                </div>
                {leaseForm.lateFeeEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1"><Label>Grace days</Label>
                      <Input type="number" min={0} value={leaseForm.lateFeeGraceDays} onChange={(e) => setLeaseForm((p) => ({ ...p, lateFeeGraceDays: e.target.value }))} /></div>
                    <div className="space-y-1"><Label>Type</Label>
                      <Select value={leaseForm.lateFeeType} onValueChange={(v) => setLeaseForm((p) => ({ ...p, lateFeeType: v as 'flat' | 'percent' }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat $</SelectItem>
                          <SelectItem value="percent">% of rent</SelectItem>
                        </SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label>{leaseForm.lateFeeType === 'flat' ? 'Fee ($)' : 'Fee (%)'}</Label>
                      <Input type="number" min={0.01}
                        value={leaseForm.lateFeeType === 'flat' ? leaseForm.lateFeeAmountDollars : leaseForm.lateFeePercent}
                        onChange={(e) => setLeaseForm((p) => p.lateFeeType === 'flat'
                          ? { ...p, lateFeeAmountDollars: e.target.value }
                          : { ...p, lateFeePercent: e.target.value })} /></div>
                  </div>
                )}
                {leaseForm.lateFeeEnabled && !step1Valid && <p className="text-xs text-destructive">Enter a fee amount greater than 0.</p>}
              </div>
              <div className="space-y-1"><Label htmlFor="l-rules">House rules (optional)</Label>
                <Textarea id="l-rules" placeholder="Shared space expectations, product policies…" value={leaseForm.houseRules}
                  onChange={(e) => setLeaseForm((p) => ({ ...p, houseRules: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="l-doc">Signed agreement (PDF, optional)</Label>
                <div className="flex items-center gap-2">
                  <Input id="l-doc" type="file" accept="application/pdf"
                    onChange={(e) => setLeaseForm((p) => ({ ...p, signedFile: e.target.files?.[0] ?? null }))} />
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </div></div>
            </div>
          )}

          {leaseStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Perks are incentives attached to this lease — free weeks, discounts, or credits. They appear on receipts.
              </p>
              {leaseForm.perks.map((perk) => (
                <PerkRow key={perk.id} perk={perk}
                  onChange={(u) => updatePerk(perk.id, u)}
                  onRemove={() => removePerk(perk.id)} />
              ))}
              <Button variant="outline" onClick={addPerk}><Gift className="h-4 w-4 mr-2" />Add perk</Button>
              {leaseForm.perks.length === 0 && <p className="text-xs text-muted-foreground">No perks — skip to Review if not needed.</p>}
            </div>
          )}

          {leaseStep === 3 && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                <p><span className="text-muted-foreground">Booth:</span>{' '}
                  <span className="font-medium">{selectedLeaseBooth?.name ?? '—'}</span>
                  {leaseForm.isShared && <Badge variant="outline" className="ml-2 text-[10px]">Shared</Badge>}</p>
                {leaseForm.isShared && leaseForm.scheduleDays.length > 0 && (
                  <p><span className="text-muted-foreground">Schedule:</span>{' '}
                    <span className="font-medium">
                      {leaseForm.scheduleLabel || leaseForm.scheduleDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}
                      {leaseForm.scheduleStartTime && ` · ${leaseForm.scheduleStartTime}`}
                      {leaseForm.scheduleEndTime && `–${leaseForm.scheduleEndTime}`}
                    </span></p>
                )}
                <p><span className="text-muted-foreground">Rent:</span>{' '}
                  <span className="font-medium">{formatCents(Math.round(toNumber(leaseForm.rentDollars) * 100))} / {(FREQUENCY_LABELS[leaseForm.frequency] ?? leaseForm.frequency ?? 'period').toLowerCase()}</span></p>
                <p><span className="text-muted-foreground">First charge:</span>{' '}<span className="font-medium">{leaseForm.firstChargeDate}</span></p>
                <p><span className="text-muted-foreground">Term:</span>{' '}
                  <span className="font-medium">{leaseForm.startDate} — {leaseForm.endDate || 'month-to-month'}{leaseForm.autoRenew ? ' (auto-renews)' : ''}</span></p>
                <p><span className="text-muted-foreground">Deposit:</span>{' '}
                  <span className="font-medium">{toNumber(leaseForm.depositDollars) > 0
                    ? `${formatCents(Math.round(toNumber(leaseForm.depositDollars) * 100))} (${leaseForm.depositRefundable ? 'refundable' : 'non-refundable'})`
                    : 'None'}</span></p>
                <p><span className="text-muted-foreground">Late fee:</span>{' '}
                  <span className="font-medium">{leaseForm.lateFeeEnabled
                    ? leaseForm.lateFeeType === 'flat'
                      ? `${formatCents(Math.round(toNumber(leaseForm.lateFeeAmountDollars) * 100))} after ${leaseForm.lateFeeGraceDays} grace days`
                      : `${leaseForm.lateFeePercent}% after ${leaseForm.lateFeeGraceDays} grace days`
                    : 'None'}</span></p>
                <p><span className="text-muted-foreground">Perks:</span>{' '}
                  <span className="font-medium">{leaseForm.perks.length > 0 ? leaseForm.perks.map((p) => p.label).join(', ') : 'None'}</span></p>
                <p><span className="text-muted-foreground">Agreement:</span>{' '}
                  <span className="font-medium">{leaseForm.signedFile ? leaseForm.signedFile.name : 'Not uploaded'}</span></p>
              </div>
              <p className="text-xs text-muted-foreground">
                Creating this lease marks the booth {leaseForm.isShared ? 'as shared (partial)' : 'occupied'} and the renter active.
              </p>
              {leaseError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />{leaseError}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {leaseStep > 0 && (
              <Button variant="outline" onClick={() => setLeaseStep((s) => s - 1)} disabled={savingLease}>
                <ChevronLeft className="h-4 w-4 mr-1" />Back
              </Button>
            )}
            {leaseStep < WIZARD_STEPS.length - 1 && (
              <Button onClick={() => setLeaseStep((s) => s + 1)} disabled={!wizardCanAdvance}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {leaseStep === WIZARD_STEPS.length - 1 && (
              <Button onClick={handleCreateLease} disabled={savingLease}>
                {savingLease ? 'Creating…' : 'Create lease'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renter status change */}
      <Dialog open={Boolean(statusTarget)} onOpenChange={(open) => { if (!open) setStatusTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change renter status</DialogTitle>
            <DialogDescription>Leave and maternity leave pause billing while keeping the lease active.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New status</Label>
            <Select value={newStatus} onValueChange={(v) => setNewStatus(v as RenterStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['active', 'on_leave', 'maternity_leave', 'subletting'] as RenterStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{RENTER_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusTarget(null)}>Cancel</Button>
            <Button onClick={handleStatusChange} disabled={savingStatus}>{savingStatus ? 'Updating…' : 'Update status'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End lease */}
      <AlertDialog open={Boolean(endLeaseTarget)} onOpenChange={(open) => { if (!open) setEndLeaseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End lease?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends <strong>{endLeaseTarget?.firstName} {endLeaseTarget?.lastName}</strong>'s lease immediately,
              frees the booth, and marks them as Past. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingEndLease}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndLease} disabled={savingEndLease}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {savingEndLease ? 'Ending…' : 'End lease'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PricingAdvisor
        open={pricingOpen}
        onOpenChange={setPricingOpen}
        onApplyWeeklyRent={(dollars) =>
          setForm((prev) => ({
            ...prev,
            baseRentDollars: dollars.toString(),
            baseRentFrequency: 'weekly',
          }))
        }
      />

      <CommandCenterPanel
        open={commandCenterOpen}
        onOpenChange={setCommandCenterOpen}
        alerts={alerts}
        activity={activityLog}
      />
    </div>
  );
}
