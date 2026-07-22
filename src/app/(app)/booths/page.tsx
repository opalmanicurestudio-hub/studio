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
  deleteDoc, setDoc, onSnapshot, getDocs, collection, query, where, writeBatch } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { AppHeader } from '@/components/shared/AppHeader';
import { TourManagerDialog } from '@/components/booths/TourManagerDialog';
import { DEFAULT_TOUR_PRINTOUT_CONFIG } from '@/lib/tour-printouts';
import {
  PIPELINE_STAGES, stageLabel, stageTone, contactKey as boothContactKey,
  ensureBoothContact, setContactPipeline, scheduleContactFollowUp,
  markContactLost, reengageContact, setContactNote, linkContactRenter,
} from '@/lib/booth-contacts';
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
  Calculator, MonitorSmartphone, Settings,
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
  Shield,
  XCircle,
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
import { auditEntry } from '@/lib/audit';
import {
  useBoothRentalCollections,
  useBoothIndex,
  useRenterIndex,
  useOccupyingLeaseByRenter,
  useOccupyingLeaseByBooth,
} from '@/lib/booth-rental-hooks';
import { createBooth, createRenter, createLease, endLease } from '@/lib/booth-rental-service';
import { BoothAutomationSettings } from '@/components/shared/BoothAutomationSettings';
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
  listingDescription: string;
  videoUrl: string;
  dayRentalDays: number[];
  blackoutDatesText: string;
  openTime: string;
  closeTime: string;
  bookingSlots: { label: string; start: string; end: string; dollars: string }[];
  shape: string;
  startIncrementMins: string;   // '15' | '30' | '60' — hourly start-time grid
  depositType: string;      // 'none' | 'flat' | 'percent' | 'breakeven'
  depositValue: string;     // dollars for flat, % for percent, ignored for breakeven/none
  balanceMode: string;
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
  listingDescription: '',
  videoUrl: '',
  dayRentalDays: [0, 1, 2, 3, 4, 5, 6],
  blackoutDatesText: '',
  openTime: '',
  closeTime: '',
  bookingSlots: [],
  shape: 'rect',
  startIncrementMins: '30',
  depositType: 'none',
  depositValue: '',
  balanceMode: 'in_person',
};

// ─── Renter form ──────────────────────────────────────────────────────────────

interface RenterFormState {
  firstName: string; lastName: string; email: string; phone: string;
  businessName: string; specialty: string; notes: string;
  linkedStaffId: string;
  credentials: { label: string; number: string; expiry: string }[];
}
const EMPTY_RENTER_FORM: RenterFormState = {
  firstName: '', lastName: '', email: '', phone: '', businessName: '', specialty: '', notes: '',
  linkedStaffId: '',
  credentials: [],
};

// v73 — LOCAL calendar date (YYYY-MM-DD). The page previously used
// `new Date().toISOString().slice(0,10)` for "today", which is UTC: for a
// US salon, everything (live floor, planner, upcoming lists) flipped to
// tomorrow at ~7-8pm local. Every "today" now goes through this.
const localISO = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Single default incidentals policy for the whole booths surface — the allowed
// charge types and their hard caps. Mirrors src/lib/incidentals.ts (server) and
// esign.ts's lease schedule, so the UI, the signed lease, and the server
// enforcement all agree. Owners override this on tenants/{id}.incidentalCategories.
const BOOTH_DEFAULT_INCIDENTALS: { label: string; capCents: number }[] = [
  { label: 'Cleaning fee', capCents: 7500 },
  { label: 'Damage', capCents: 50000 },
  { label: 'Lost key / fob', capCents: 2500 },
  { label: 'Late checkout', capCents: 5000 },
  { label: 'Missing product / supplies', capCents: 15000 },
];
const resolveBoothIncidentalPolicy = (tenant: any): { label: string; capCents: number }[] => {
  const saved = tenant?.incidentalCategories;
  return (Array.isArray(saved) && saved.length) ? saved : BOOTH_DEFAULT_INCIDENTALS;
};

// v73 — booth money actions now follow the app's audit-trail convention
// (tenants/{id}/auditLogs). Logging never breaks the action it describes.
const writeBoothAudit = (firestore: any, tenantId: string, e: any) => {
  try {
    const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
    setDoc(aRef, { id: aRef.id, ...auditEntry(e) }).catch(() => {});
  } catch { /* non-fatal */ }
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
  // v73 — were returned by buildEmptyLeaseForm() and read at save/review
  // time but missing from this interface: the file failed tsc because of it.
  leaseTerms: string;
  requireSignature: boolean;
}

function buildEmptyLeaseForm(): LeaseFormState {
  const today = toIsoDate(new Date());
  return {
    boothId: '', rentDollars: '', frequency: 'weekly', dueDay: '1',
    firstChargeDate: today, startDate: today, endDate: '', autoRenew: true, noticeDays: '30',
    isShared: false, scheduleDays: [], scheduleStartTime: '', scheduleEndTime: '', scheduleLabel: '',
    leaseTerms: '',
    requireSignature: false,
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
          <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
            <Calculator className="h-5 w-5 text-slate-500" />
            Pricing Advisor
          </DialogTitle>
          <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            Break-even floor · renter viability check
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
          <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
            <ActivityIcon className="h-5 w-5 text-slate-500" />
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
  liveRes?: any;
  nowTick?: number;
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
  liveRes,
  nowTick,
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

  // v76 — live state: who's here now, how long they have left.
  const isLive = liveRes?.status === 'checked_in';
  const isExpected = liveRes?.status === 'confirmed';
  const guestFirst = liveRes ? String(liveRes.name || 'Guest').split(' ')[0] : '';
  let timePct: number | null = null;
  let timeLabel = '';
  let overtime = false;
  if (isLive && liveRes.bookingType === 'hourly' && liveRes.startTime && liveRes.endTime && nowTick) {
    const dayStr = localISO(new Date(nowTick));
    const startMs = new Date(`${liveRes.startDate}T${liveRes.startTime}:00`).getTime();
    const endMs = new Date(`${liveRes.startDate}T${liveRes.endTime}:00`).getTime();
    if (endMs > startMs && liveRes.startDate === dayStr) {
      timePct = Math.min(100, Math.max(0, ((nowTick - startMs) / (endMs - startMs)) * 100));
      const leftMin = Math.round((endMs - nowTick) / 60000);
      overtime = leftMin < 0;
      timeLabel = overtime ? `+${Math.abs(leftMin)}m over` : `${leftMin}m left`;
    }
  }

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
        className={`w-full h-full flex flex-col overflow-hidden transition-shadow ${
          (booth as any).shape === 'round' ? 'rounded-full items-center justify-center text-center p-1.5'
          : (booth as any).shape === 'oval' ? 'rounded-[50%] items-center justify-center text-center p-1.5'
          : ['chair', 'pedicure', 'sink', 'dryer', 'plant'].includes((booth as any).shape) ? 'rounded-2xl items-center justify-center text-center p-1'
          : (booth as any).shape === 'desk' ? 'rounded-t-3xl rounded-b-lg items-center justify-center text-center p-1.5'
          : ['wall', 'door'].includes((booth as any).shape) ? 'rounded-sm justify-center p-1'
          : (booth as any).shape === 'square' ? 'rounded-lg p-2.5'
          : 'rounded-xl p-2.5'
        }`}
        style={{
          background: (booth as any).shape === 'wall' ? '#cbd5e1'
            : (booth as any).shape === 'door' ? 'repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 4px,#f8fafc 4px,#f8fafc 8px)'
            : (booth as any).shape === 'plant' ? '#ecfdf5'
            : colors.bg,
          border: (booth as any).shape === 'wall' ? '2px solid #94a3b8'
            : (booth as any).shape === 'door' ? '2px dashed #94a3b8'
            : (booth as any).shape === 'plant' ? '2px solid #a7f3d0'
            : `2px solid ${selected ? colors.border : colors.border + '99'}`,
          boxShadow: overtime ? '0 0 0 3px #ef444455, 0 0 18px 2px #ef444466'
            : isLive ? '0 0 0 3px #6366f155, 0 0 16px 2px #6366f144'
            : selected ? `0 0 0 2px ${colors.border}44` : undefined,
          cursor: locked ? 'pointer' : 'grab',
        }}
      >
        {(isLive || isExpected) && (
          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
            {isLive && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${overtime ? 'bg-red-500' : 'bg-indigo-500'}`} />}
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${overtime ? 'bg-red-500' : isLive ? 'bg-indigo-500' : 'bg-emerald-400'}`} />
          </span>
        )}
        {(booth as any).shape === 'chair' && <span className="text-base leading-none">🪑</span>}
        {(booth as any).shape === 'pedicure' && <span className="text-base leading-none">💺</span>}
        {(booth as any).shape === 'sink' && <span className="text-base leading-none">🚿</span>}
        {(booth as any).shape === 'dryer' && <span className="text-base leading-none">💨</span>}
        {(booth as any).shape === 'plant' && <span className="text-base leading-none">🪴</span>}
        {(booth as any).shape === 'door' && <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Entry</span>}
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
        {liveRes && (
          <span className={`text-[10px] font-black leading-none mb-1 truncate ${overtime ? 'text-red-600' : isLive ? 'text-indigo-700' : 'text-emerald-700'}`}>
            {isLive ? '● ' : '◷ '}{guestFirst}{timeLabel ? ` · ${timeLabel}` : isExpected && liveRes.startTime ? ` · ${liveRes.startTime}` : ''}
          </span>
        )}
        {timePct !== null && (
          <div className="h-1 w-full rounded-full bg-black/10 overflow-hidden mb-1">
            <div className={`h-full rounded-full transition-all ${overtime ? 'bg-red-500' : timePct > 85 ? 'bg-amber-500' : 'bg-indigo-500'}`}
              style={{ width: `${overtime ? 100 : timePct}%` }} />
          </div>
        )}
        {!renter && !liveRes && booth.status === 'vacant' && (
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
          className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-60 md:opacity-40 md:group-hover:opacity-100 transition-opacity touch-none"
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

// ─── Contact profile drawer (v87) ────────────────────────────────────────────
// Non-renter contacts (guests, tour-takers, applicants) get a real
// profile too — parity with renters. Their full cross-channel history
// from reservations, tours, applications, and reviews.
function ContactProfileDrawer({
  contact, reservations, applications, tenantId, onClose,
  onConvert, onSetPipeline, onFollowUp, onMarkLost, onReengage, onSaveNote, converting,
}: {
  contact: any;
  reservations: any[];
  applications: any[];
  tenantId: string;
  onClose: () => void;
  onConvert?: (person: any) => void;
  onSetPipeline?: (person: any, stage: string) => void;
  onFollowUp?: (person: any, date: string | null) => void;
  onMarkLost?: (person: any, reason: string) => void;
  onReengage?: (person: any) => void;
  onSaveNote?: (person: any, note: string) => void;
  converting?: boolean;
}) {
  const norm = (v: any) => (v || '').trim().toLowerCase();
  const key = contact.key;
  const mine = (p: any, e: any) => norm(p) === key || norm(e) === key;
  const [noteDraft, setNoteDraft] = useState<string>(contact.ownerNotes || '');
  const [lostReasonDraft, setLostReasonDraft] = useState<string>('');
  const [followDraft, setFollowDraft] = useState<string>(contact.nextFollowUpAt || '');
  const isRenter = !!contact.isRenter || !!contact.convertedRenterId;
  const stage = contact.pipelineStage || (isRenter ? 'won' : null);
  const converted = isRenter || stage === 'won';

  const myRes = reservations
    .filter(r => mine(r.phone, r.email) && ['confirmed', 'checked_in', 'completed', 'cancel_requested'].includes(r.status))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const myApps = applications
    .filter(a => mine(a.phone, a.email))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const t12 = (t?: string) => {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
    const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hr = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
  };

  const timeline: { at: string; label: string; tone: string }[] = [];
  for (const r of myRes) {
    if (r.confirmedAt) timeline.push({ at: String(r.confirmedAt).slice(0, 10), label: `Booked & paid · ${r.boothName} ($${((r.amountCents || 0) / 100).toFixed(0)})`, tone: 'money' });
    if (r.checked_inAt) timeline.push({ at: String(r.checked_inAt).slice(0, 10), label: `Checked in · ${r.boothName}`, tone: 'in' });
    if (r.completedAt) timeline.push({ at: String(r.completedAt).slice(0, 10), label: `Completed · ${r.boothName}${r.rating ? ` · ${'★'.repeat(r.rating)}` : ''}`, tone: 'ok' });
    if (r.cancelRequestedAt) timeline.push({ at: String(r.cancelRequestedAt).slice(0, 10), label: `Requested cancellation · ${r.boothName}`, tone: 'warn' });
  }
  for (const a of myApps) {
    timeline.push({ at: String(a.createdAt || '').slice(0, 10), label: `${a.kind === 'tour' ? 'Requested a tour' : a.kind === 'waitlist' ? 'Joined waitlist' : a.kind === 'question' ? 'Asked a question' : 'Applied'}${a.boothName ? ` · ${a.boothName}` : ''}`, tone: 'inquiry' });
  }
  timeline.sort((x, y) => y.at.localeCompare(x.at));

  const TONE: Record<string, string> = { money: 'bg-emerald-500', in: 'bg-indigo-500', ok: 'bg-slate-800', warn: 'bg-amber-500', inquiry: 'bg-sky-500' };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="px-5 pt-5 pb-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shrink-0">
                {(contact.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-black text-base truncate">{contact.name}</p>
                <div className="flex gap-1.5 mt-0.5 flex-wrap">
                  {(() => {
                    const S: Record<string, string> = { inquiry: 'text-slate-500', tour: 'text-sky-600', applicant: 'text-violet-600', guest: 'text-emerald-600', repeat: 'text-amber-600' };
                    const L: Record<string, string> = { inquiry: 'Inquiry', tour: 'Toured', applicant: 'Applicant', guest: 'Guest', repeat: 'Regular' };
                    return <span className={`text-[9px] font-black uppercase tracking-widest ${S[contact.stage] || 'text-slate-500'}`}>{L[contact.stage] || 'Contact'}</span>;
                  })()}
                  {contact.lastRating && <span className="text-amber-500 text-[10px]">{'★'.repeat(contact.lastRating)}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-xl border-2 flex items-center justify-center text-slate-500 shrink-0"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex gap-2">
            {contact.phone && <a href={`tel:${contact.phone}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Call</a>}
            {contact.phone && <a href={`sms:${contact.phone}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Text</a>}
            {contact.email && <a href={`mailto:${contact.email}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Email</a>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border-2 px-2 py-2.5 text-center">
              <p className="text-lg font-black tracking-tighter">{contact.visits || 0}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Visits</p>
            </div>
            <div className="rounded-xl border-2 px-2 py-2.5 text-center">
              <p className="text-lg font-black tracking-tighter text-emerald-700">${((contact.totalCents || 0) / 100).toFixed(0)}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Lifetime</p>
            </div>
            <div className="rounded-xl border-2 px-2 py-2.5 text-center">
              <p className="text-lg font-black tracking-tighter">{contact.lastRating || '—'}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Rating</p>
            </div>
          </div>

          <div className="rounded-2xl border-2 p-4 space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
            {contact.phone && <p className="text-xs font-bold">{contact.phone}</p>}
            {contact.email && <p className="text-xs font-bold">{contact.email}</p>}
            {contact.firstDate && contact.firstDate !== '9999' && <p className="text-[10px] font-bold text-muted-foreground">First seen {contact.firstDate}</p>}
          </div>

          {/* ── Journey: where this lead is + what to do next ── */}
          <div className="rounded-2xl border-2 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Journey</p>
              {stage && <span className={`text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${stageTone(stage)}`}>{stageLabel(stage)}</span>}
            </div>

            {converted ? (
              <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 px-3 py-2.5">
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">✓ {isRenter ? 'Renter' : 'Converted'}</p>
                <p className="text-[10px] font-bold text-emerald-700/80">{isRenter ? 'Manage them from their renter profile.' : 'A renter record was created — assign their booth with a lease.'}</p>
              </div>
            ) : (
              <>
                {/* Convert */}
                <button
                  onClick={() => onConvert?.(contact)}
                  disabled={converting}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" /> {converting ? 'Converting…' : 'Convert to renter'}
                </button>

                {/* Pipeline stage */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Stage</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PIPELINE_STAGES.filter(s => s.value !== 'won').map(s => (
                      <button
                        key={s.value}
                        onClick={() => s.value === 'lost' ? undefined : onSetPipeline?.(contact, s.value)}
                        disabled={s.value === 'lost'}
                        className={`h-7 px-2.5 rounded-full border-2 text-[9px] font-black uppercase tracking-wide ${stage === s.value ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'} ${s.value === 'lost' ? 'opacity-40 cursor-default' : ''}`}
                      >{s.label}</button>
                    ))}
                  </div>
                </div>

                {/* Follow-up */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Follow up on</p>
                  <div className="flex gap-2">
                    <input type="date" value={followDraft} onChange={e => setFollowDraft(e.target.value)} className="flex-1 h-9 rounded-xl border-2 px-3 text-sm font-medium" />
                    <button onClick={() => onFollowUp?.(contact, followDraft || null)} className="h-9 px-3 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">Set</button>
                    {contact.nextFollowUpAt && <button onClick={() => { setFollowDraft(''); onFollowUp?.(contact, null); }} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Clear</button>}
                  </div>
                  {contact.nextFollowUpAt && <p className="text-[10px] font-bold text-amber-600 mt-1">Reminder set for {contact.nextFollowUpAt}</p>}
                </div>

                {/* Lost / re-engage */}
                {stage === 'lost' ? (
                  <div className="rounded-xl bg-slate-50 border-2 px-3 py-2.5 space-y-2">
                    <p className="text-[10px] font-bold text-slate-600">Lost{contact.lostReason ? ` · ${contact.lostReason}` : ''} — kept on file.</p>
                    <button onClick={() => onReengage?.(contact)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-indigo-600">Re-engage</button>
                  </div>
                ) : (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Not moving forward?</p>
                    <div className="flex gap-2">
                      <input value={lostReasonDraft} onChange={e => setLostReasonDraft(e.target.value)} placeholder="Reason (optional)" className="flex-1 h-9 rounded-xl border-2 px-3 text-sm font-medium" />
                      <button onClick={() => onMarkLost?.(contact, lostReasonDraft.trim())} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500 hover:text-red-600 hover:border-red-200">Mark lost</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Notes */}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Notes</p>
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => { if ((noteDraft || '') !== (contact.ownerNotes || '')) onSaveNote?.(contact, noteDraft); }} rows={2} placeholder="Private notes about this contact…" className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium resize-none" />
            </div>
          </div>

          {myRes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Bookings</p>
              {myRes.map(r => (
                <div key={r.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate">{r.boothName}</p>
                    <p className="text-[10px] font-bold text-muted-foreground">{r.bookingType === 'hourly' && r.startTime ? `${r.startDate} · ${t12(r.startTime)}–${t12(r.endTime)}` : r.startDate}</p>
                  </div>
                  <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0">📄</a>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1 mb-2">Timeline</p>
            {timeline.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No activity yet.</p> : timeline.slice(0, 30).map((t, i) => (
              <div key={i} className="flex gap-3 pb-4 relative">
                <div className="flex flex-col items-center">
                  <div className={`h-2.5 w-2.5 rounded-full mt-1 shrink-0 ${TONE[t.tone] || 'bg-slate-400'}`} />
                  {i < timeline.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                </div>
                <div className="min-w-0 -mt-0.5">
                  <p className="text-xs font-bold leading-snug">{t.label}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">{t.at}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compliance status (v80) ─────────────────────────────────────────────────
// green = valid >30d out · amber = expires ≤30d · red = expired or missing
function complianceOf(r: any): { items: { label: string; number: string; expiry: string; state: string }[]; worst: string } {
  const judge = (expiry: any): string => {
    if (!expiry) return 'missing';
    const days = Math.floor((new Date(expiry + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'ok';
  };
  const items: { label: string; number: string; expiry: string; state: string }[] = [];
  if (Array.isArray(r.credentials)) {
    for (const cr of r.credentials) {
      if (!cr?.label) continue;
      items.push({ label: cr.label, number: cr.number || '', expiry: cr.expiry || '', state: judge(cr.expiry) });
    }
  }
  // Legacy fields from the first compliance version — still honored
  if (items.length === 0) {
    if (r.licenseExpiry || r.licenseNumber) items.push({ label: 'Professional license', number: r.licenseNumber || '', expiry: r.licenseExpiry || '', state: judge(r.licenseExpiry) });
    if (r.insuranceExpiry || r.insuranceCarrier) items.push({ label: `Liability insurance${r.insuranceCarrier ? ` (${r.insuranceCarrier})` : ''}`, number: '', expiry: r.insuranceExpiry || '', state: judge(r.insuranceExpiry) });
  }
  const rank: Record<string, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
  const worst = items.length === 0 ? 'none' : items.reduce((w, it) => rank[it.state] < rank[w] ? it.state : w, 'ok');
  return { items, worst };
}

// ─── Renter profile drawer (v65) ─────────────────────────────────────────────
// Tap a renter card → full profile: identity, lease, money, documents,
// activity. Self-contained: fetches this renter's ledger entries on open.

function RenterProfileDrawer({
  renter, lease, booth, reservations, w9, tenantId, firestore,
  onClose, onEdit, onLease, onEndLease,
}: {
  renter: Renter;
  lease?: Lease;
  booth?: Booth;
  reservations: any[];
  w9: any;
  tenantId: string;
  firestore: any;
  onClose: () => void;
  onEdit: () => void;
  onLease: () => void;
  onEndLease: () => void;
}) {
  const [ptab, setPtab] = useState<'overview' | 'money' | 'documents' | 'activity'>('overview');
  const [chargeAmt, setChargeAmt] = useState('');
  const [chargeCat, setChargeCat] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [renterChargingId, setRenterChargingId] = useState<string | null>(null);
  const { toast: drawerToast } = useToast();
  const { selectedTenant: drawerTenant } = useTenant();
  // Constrained to the studio's capped incidentals policy — no made-up charges.
  const chargePolicy = resolveBoothIncidentalPolicy(drawerTenant);
  const chargeCatObj = chargePolicy.find((c: any) => c.label === chargeCat) || null;
  const chargeCapCents = chargeCatObj ? Math.round(Number(chargeCatObj.capCents) || 0) : 0;
  const chargeCents = Math.round((parseFloat(chargeAmt) || 0) * 100);
  const chargeOverCap = chargeCapCents > 0 && chargeCents > chargeCapCents;
  const chargeRenterCard = async (rt: Renter) => {
    if (!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId) return;
    setRenterChargingId(rt.id);
    try {
      // Hardened monthly-renter path: same capped policy as day/hourly renters,
      // enforced server-side (setup-card PUT validates category + cap).
      const res = await fetch('/api/booths/setup-card', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: rt.id, amountCents: chargeCents, category: chargeCat, note: chargeNote.trim() }),
      });
      const d = await res.json();
      if (d.ok) {
        const label = chargeCat + (chargeNote.trim() ? ` — ${chargeNote.trim()}` : '');
        setChargeAmt(''); setChargeCat(''); setChargeNote('');
        drawerToast({ title: 'Card charged', description: `$${(d.chargedCents / 100).toFixed(2)} — ${chargeCat} recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.renter_charged', targetType: 'renter', targetId: rt.id,
          summary: `Card on file charged: ${rt.firstName || ''} ${rt.lastName || ''}`.trim() + ` — ${label}`,
          amount: (d.chargedCents || chargeCents) / 100, actor: { type: 'user' },
        });
      } else {
        drawerToast({ variant: 'destructive', title: 'Charge failed', description: d.error || 'Try again or collect another way.' });
      }
    } catch {
      drawerToast({ variant: 'destructive', title: 'Network error', description: 'The charge may not have completed — check Stripe before retrying.' });
    }
    finally { setRenterChargingId(null); }
  };
  const [txns, setTxns] = useState<any[] | null>(null);

  const fullName = `${renter.firstName} ${renter.lastName}`.trim();

  // This renter's day rentals — matched by phone/email
  const myReservations = useMemo(() =>
    reservations.filter(r =>
      (renter.phone && r.phone === renter.phone) ||
      (renter.email && r.email === renter.email)
    ).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [reservations, renter.phone, renter.email]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const byName = await getDocs(query(
          collection(firestore, 'tenants', tenantId, 'transactions'),
          where('source', '==', 'booth_rent'),
          where('clientOrVendor', '==', fullName)));
        if (cancelled) return;
        setTxns(byName.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => ((b.date || b.createdAt || '') + '').localeCompare((a.date || a.createdAt || '') + '')));
      } catch { if (!cancelled) setTxns([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, fullName]);

  const dollars = (t: any) => typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100;
  const dateStr = (v: any) => {
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString().slice(0, 10); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
    return '';
  };
  const thisYear = new Date().getFullYear().toString();
  const ytdTotal = useMemo(() => {
    const fromTxns = (txns || []).filter(t => dateStr(t.date || t.createdAt).startsWith(thisYear)).reduce((s, t) => s + dollars(t), 0);
    const fromRes = myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status) && (r.startDate || '').startsWith(thisYear)).reduce((s, r) => s + (r.amountCents || 0) / 100, 0);
    return fromTxns + fromRes;
  }, [txns, myReservations, thisYear]);

  // Activity timeline: lease events + reservation lifecycle stamps
  const activity = useMemo(() => {
    const items: { at: string; label: string }[] = [];
    if ((renter as any).appliedAt) items.push({ at: String((renter as any).appliedAt).slice(0, 10), label: 'Applied via website' });
    if (lease) {
      if (lease.startDate) items.push({ at: lease.startDate, label: `Lease started · ${booth?.name ?? ''}` });
      if (lease.endDate) items.push({ at: lease.endDate, label: `Lease ends · ${booth?.name ?? ''}` });
    }
    myReservations.forEach(r => {
      if (r.createdAt) items.push({ at: dateStr(r.createdAt), label: `Booked ${r.boothName} (${r.startDate} → ${r.endDate})` });
      if (r.checked_inAt) items.push({ at: dateStr(r.checked_inAt), label: `Checked in · ${r.boothName}` });
      if (r.completedAt) items.push({ at: dateStr(r.completedAt), label: `Completed stay · ${r.boothName}` });
      if (r.cancelled_refund_pendingAt) items.push({ at: dateStr(r.cancelled_refund_pendingAt), label: `Cancelled — refund pending · ${r.boothName}` });
    });
    return items.filter(i => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  }, [lease, booth, myReservations]);

  const PTABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'money', label: 'Money' },
    { id: 'documents', label: 'Docs' },
    { id: 'activity', label: 'Activity' },
  ] as const;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shrink-0">
                {(renter.firstName || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-black text-base truncate">{fullName}</p>
                {renter.businessName && <p className="text-[10px] font-bold text-muted-foreground truncate">{renter.businessName}</p>}
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <Badge className="text-[9px]">{RENTER_STATUS_LABELS[renter.status] ?? renter.status}</Badge>
                  {(renter as any).linkedStaffId && <span className="text-[9px] font-black uppercase tracking-widest text-violet-600">Hybrid</span>}
                  {w9 ? <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">✓ W-9</span> : w9 === null ? <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">⚠ W-9</span> : null}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-xl border-2 flex items-center justify-center text-slate-500 shrink-0"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex gap-2">
            <button onClick={onEdit} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700">Edit</button>
            {renter.phone && <a href={`tel:${renter.phone}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Call</a>}
            {renter.email && <a href={`mailto:${renter.email}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Email</a>}
          </div>
          <div className="flex gap-0 -mb-4 border-b-0">
            {PTABS.map(t => (
              <button key={t.id} onClick={() => setPtab(t.id)}
                className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${ptab === t.id ? 'text-slate-900 border-b-2 border-slate-900' : 'text-muted-foreground'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {ptab === 'overview' && (
            <>
              <div className="rounded-2xl border-2 p-4 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
                {renter.email && <p className="text-xs font-bold">{renter.email}</p>}
                {renter.phone && <p className="text-xs font-bold">{renter.phone}</p>}
                {renter.specialty && <p className="text-[10px] font-bold text-muted-foreground">{renter.specialty}</p>}
                {renter.notes && <p className="text-[11px] text-muted-foreground leading-relaxed border-t pt-2">{renter.notes}</p>}
              </div>

              {(() => {
                const comp = complianceOf(renter as any);
                const STYLE: Record<string, string> = { ok: 'text-emerald-600', expiring: 'text-amber-600', expired: 'text-red-600', missing: 'text-slate-400' };
                const WORD: Record<string, (d: string) => string> = {
                  ok: d => `valid · exp ${d}`, expiring: d => `⚠ expires ${d}`, expired: d => `🔴 EXPIRED ${d}`, missing: () => 'no expiry on file',
                };
                return (
                  <div className={`rounded-2xl border-2 p-4 space-y-1.5 ${comp.worst === 'ok' || comp.worst === 'none' ? '' : comp.worst === 'expiring' ? 'border-amber-200 bg-amber-50/50' : 'border-red-200 bg-red-50/50'}`}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Credentials & compliance</p>
                    {comp.items.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400">Nothing tracked yet — add credentials via Edit.</p>
                    ) : comp.items.map((it, i) => (
                      <p key={i} className="text-xs font-bold">
                        {it.label}{it.number ? ` #${it.number}` : ''}: <span className={STYLE[it.state]}>{WORD[it.state](it.expiry)}</span>
                      </p>
                    ))}
                  </div>
                );
              })()}
              {lease && booth ? (
                <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 text-white p-4 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Current lease</p>
                  <p className="font-black text-sm uppercase">{booth.name}</p>
                  <p className="text-xs font-bold text-white/80">{formatCents(lease.rentAmountCents)}/{lease.frequency} · {lease.endDate ? `ends ${lease.endDate}` : 'month-to-month'}</p>
                  <button onClick={onEndLease} className="text-[9px] font-black uppercase tracking-widest text-red-300 underline underline-offset-2">End lease</button>
                </div>
              ) : (
                <button onClick={onLease} className="w-full h-11 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:border-slate-400">
                  + Assign a space
                </button>
              )}
              {(renter as any).portalEnabled && (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Portal active · PIN {(renter as any).portalPin}</p>
                </div>
              )}

              {/* v71 — card on file + incidental charge (v86: capped policy picker,
                  no made-up charges — same policy the day/hourly path enforces) */}
              {(renter as any).cardOnFile ? (
                <div className="rounded-2xl border-2 p-4 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Card on file{(renter as any).cardBrand ? ` · ${(renter as any).cardBrand} ····${(renter as any).cardLast4}` : ' · Stripe'}
                  </p>
                  <select
                    value={chargeCat}
                    onChange={e => { setChargeCat(e.target.value); const c = chargePolicy.find((x: any) => x.label === e.target.value); if (c && c.capCents > 0 && chargeCents > c.capCents) setChargeAmt((c.capCents / 100).toFixed(0)); }}
                    className="w-full h-10 rounded-xl border-2 px-3 text-sm font-bold bg-white"
                  >
                    <option value="">Select charge type…</option>
                    {chargePolicy.map((c: any) => (
                      <option key={c.label} value={c.label}>{c.label}{c.capCents > 0 ? ` — up to $${(c.capCents / 100).toFixed(0)}` : ''}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <input type="number" inputMode="decimal" placeholder="$" value={chargeAmt}
                      onChange={e => setChargeAmt(e.target.value)}
                      className={`h-10 rounded-xl border-2 px-3 text-sm font-bold ${chargeOverCap ? 'border-red-400 text-red-600' : ''}`} />
                    <input type="text" placeholder="Note (optional)" value={chargeNote}
                      onChange={e => setChargeNote(e.target.value)}
                      className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                  </div>
                  {chargeOverCap && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Over the ${(chargeCapCents / 100).toFixed(0)} cap for {chargeCat}</p>
                  )}
                  <button
                    onClick={() => chargeRenterCard(renter)}
                    disabled={!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId === renter.id}
                    className="w-full h-10 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40"
                  >
                    {renterChargingId === renter.id ? 'Charging…' : `Charge Card${chargeCents >= 50 ? ` $${(chargeCents / 100).toFixed(2)}` : ''}`}
                  </button>
                  <p className="text-[9px] font-bold text-muted-foreground">Only your policy's charge types, each capped. Charges off-session and records under "Renter Incidental" in the ledger.</p>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed p-3">
                  <p className="text-[10px] font-bold text-muted-foreground">No card on file yet — it's saved automatically the first time this renter pays rent online, or they can add one in their portal. Once on file, capped incidentals charge from right here.</p>
                </div>
              )}
            </>
          )}

          {ptab === 'money' && (
            <>
              <div className="rounded-2xl bg-slate-900 text-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/50">{thisYear} total paid</p>
                <p className="text-2xl font-black tracking-tighter">${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              </div>
              {txns === null ? <p className="text-xs text-muted-foreground text-center py-4">Loading…</p> : (
                <>
                  {(txns.length + myReservations.length) === 0 && <p className="text-xs text-muted-foreground text-center py-4">No payments on record.</p>}
                  {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).map(r => (
                    <div key={r.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate">Day rental · {r.boothName}</p>
                        <p className="text-[10px] font-bold text-muted-foreground">{r.startDate} → {r.endDate}</p>
                      </div>
                      <p className="font-black text-emerald-700 text-sm shrink-0">${((r.amountCents || 0) / 100).toFixed(2)}</p>
                    </div>
                  ))}
                  {txns.map(t => (
                    <div key={t.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate">{t.description || 'Booth rent'}</p>
                        <p className="text-[10px] font-bold text-muted-foreground">{dateStr(t.date || t.createdAt)}</p>
                      </div>
                      <p className="font-black text-emerald-700 text-sm shrink-0">${dollars(t).toFixed(2)}</p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {ptab === 'documents' && (
            <>
              <div className={`rounded-2xl border-2 p-4 space-y-1 ${w9 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`text-[9px] font-black uppercase tracking-widest ${w9 ? 'text-emerald-700' : 'text-amber-700'}`}>{w9 ? 'W-9 on file ✓' : 'W-9 missing'}</p>
                {w9 ? (
                  <p className="text-xs font-bold text-emerald-800">{w9.legalName} · TIN {w9.tinMasked}</p>
                ) : (
                  <p className="text-[11px] text-amber-700">Renter completes this in their portal → Documents tab.</p>
                )}
              </div>
              {Array.isArray((renter as any).applicationAttachments) && (renter as any).applicationAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Application documents</p>
                  {(renter as any).applicationAttachments.map((at: any) => (
                    <a key={at.url} href={at.url} target="_blank" rel="noreferrer"
                      className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                      <p className="text-xs font-black truncate">📎 {at.label || at.name || 'Document'}</p>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0">Open →</span>
                    </a>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Annual statements</p>
                {[new Date().getFullYear(), new Date().getFullYear()-1].map(yr => (
                  <a key={yr} href={`/api/booths/statement?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renter.id)}&year=${yr}`} target="_blank" rel="noreferrer"
                    className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                    <p className="text-xs font-black">{yr} Rent Statement</p>
                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Open →</span>
                  </a>
                ))}
              </div>
              {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Receipts</p>
                  {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).map(r => (
                    <a key={r.id} href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer"
                      className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                      <p className="text-xs font-black truncate">{r.boothName} · {r.startDate}</p>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0">📄 Receipt</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {ptab === 'activity' && (
            activity.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">No activity yet.</p> : (
              <div className="space-y-0">
                {activity.map((a, i) => (
                  <div key={i} className="flex gap-3 pb-4 relative">
                    <div className="flex flex-col items-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-900 mt-1 shrink-0" />
                      {i < activity.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                    </div>
                    <div className="min-w-0 -mt-0.5">
                      <p className="text-xs font-bold leading-snug">{a.label}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{a.at}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
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
  const isMobile = useIsMobile();
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

  const [view, setView] = useState<'floor' | 'list' | 'renters' | 'money'>('floor');
  // v61 — three-tab command center (declared here, with the other hooks,
  // never after an early return)
  const [tab, setTab] = useState<'spaces' | 'ops' | 'money'>('ops');
  const [profileRenter, setProfileRenter] = useState<Renter | null>(null);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [viewingApp, setViewingApp] = useState<any | null>(null);
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false);
  const [plannerDay, setPlannerDay] = useState<string>(localISO());

  const [kioskCopied, setKioskCopied] = useState(false);
  const [spaceView, setSpaceView] = useState<'floor' | 'list' | 'planner'>('floor');

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

  // Persisted contact records — the durable journey layer (pipeline stage,
  // follow-ups, lost reason, notes, renter link). Overlaid onto the live-derived
  // guestBook by key, so identity/value stays derived while management is stored.
  const [contactDocs, setContactDocs] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'contacts')), (snap) => {
      setContactDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, () => {});
    return () => unsub();
  }, [firestore, tenantId]);
  const contactByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of contactDocs) if (c.key) m.set(c.key, c);
    return m;
  }, [contactDocs]);
  const pendingApps = useMemo(() =>
    applications.filter(a => (a.status === 'new' || a.status === 'in_review') && (!a.locationId || a.locationId === selectedLocationId))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [applications, selectedLocationId]);

  // Follow-up tasks (created by the tour manager's outcome capture).
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'tasks'),
      (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setTasks([]));
    return () => unsub();
  }, [firestore, tenantId]);
  const openTasks = useMemo(() => tasks.filter((t: any) => !t.done).sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || '')), [tasks]);

  // Tour scorecard — outcomes recorded by the tour manager drive these KPIs.
  const tourKpis = useMemo(() => {
    const tourApps = applications.filter((a: any) => a.kind === 'tour');
    const closed = tourApps.filter((a: any) => a.status === 'closed').length;
    const noShow = tourApps.filter((a: any) => a.status === 'no_show').length;
    // "Hot leads" counts the TOP interest tier the owner defined (default 'Hot'),
    // so the KPI follows customized interest labels instead of a fixed word.
    const levels = (selectedTenant as any)?.tourPrintoutConfig?.interestLevels;
    const topInterest = (Array.isArray(levels) && levels.length && String(levels[0] || '').trim()) ? String(levels[0]).trim() : 'Hot';
    const hot = tourApps.filter((a: any) => a.tourOutcome?.interest === topInterest).length;
    const resolvedCount = closed + noShow;
    const showRate = resolvedCount > 0 ? Math.round((closed / resolvedCount) * 100) : 0;
    const norm = (x: any) => String(x || '').replace(/[^\da-z@.]/gi, '').toLowerCase();
    const tourKeys = new Set(tourApps.map((a: any) => norm(a.phone || a.email)).filter(Boolean));
    const convertedKeys = new Set(applications.filter((a: any) => a.kind !== 'tour' && (a.rentalType === 'lease' || a.status === 'approved')).map((a: any) => norm(a.phone || a.email)).filter(Boolean));
    let converted = 0; tourKeys.forEach(k => { if (convertedKeys.has(k)) converted++; });
    const convRate = tourKeys.size > 0 ? Math.round((converted / tourKeys.size) * 100) : 0;
    return { total: tourApps.length, closed, noShow, hot, showRate, convRate, converted };
  }, [applications, selectedTenant]);

  // v53 — owner's view of paid day rentals
  const [reservations, setReservations] = useState<any[]>([]);
  // v76 — LIVE FLOOR: a slow heartbeat so time-remaining bars tick.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const liveResByBooth = useMemo(() => {
    const today = localISO();
    const m = new Map<string, any>();
    for (const r of reservations) {
      if (r.startDate > today || r.endDate < today) continue;
      if (!['checked_in', 'confirmed'].includes(r.status)) continue;
      const prev = m.get(r.boothId);
      // checked_in beats confirmed; earliest start wins among hourlies
      if (!prev || (r.status === 'checked_in' && prev.status !== 'checked_in')) m.set(r.boothId, r);
    }
    return m;
  }, [reservations]);
  // Today's floor events, newest first — the game log.
  const floorEvents = useMemo(() => {
    const today = localISO();
    // v73 — timestamps are UTC ISO strings; compare their LOCAL calendar
    // day, otherwise evening events vanish from today's log.
    const isToday = (iso: any) => typeof iso === 'string' && localISO(new Date(iso)) === today;
    const evts: { at: string; text: string; tone: string }[] = [];
    for (const r of reservations) {
      const first = (r.name || 'Guest').split(' ')[0];
      if (isToday(r.checked_inAt))
        evts.push({ at: r.checked_inAt, text: `${first} checked in · ${r.boothName}${r.kioskCheckIn ? ' (kiosk)' : ''}`, tone: 'in' });
      if (isToday(r.completedAt))
        evts.push({ at: r.completedAt, text: `${first} checked out · ${r.boothName}`, tone: 'out' });
      if (isToday(r.confirmedAt))
        evts.push({ at: r.confirmedAt, text: `${first} booked & paid · ${r.boothName} ($${((r.amountCents || 0) / 100).toFixed(0)})`, tone: 'money' });
      if (isToday(r.overageChargedAt))
        evts.push({ at: r.overageChargedAt, text: `Overage charged · ${first} ($${((r.overageDueCents || 0) / 100).toFixed(2)})`, tone: 'money' });
    }
    return evts.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [reservations]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'boothReservations')), (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, () => {});
    return () => unsub();
  }, [firestore, tenantId]);
  // v56 — day-renter workflow: confirmed → checked_in → completed
  // v78 — RENT ROLL: invoices from the rentCollector function.
  const [rentInvoices, setRentInvoices] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'rentInvoices'),
      (snap) => setRentInvoices(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setRentInvoices([]));
    return () => unsub();
  }, [firestore, tenantId]);

  // v88 — tours (pipeline Step 3)
  const [tours, setTours] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'tours'),
      (snap) => setTours(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setTours([]));
    return () => unsub();
  }, [firestore, tenantId]);
  const upcomingTours = useMemo(() => {
    const today = localISO();
    return tours
      .filter(t => ['requested', 'confirmed'].includes(t.status) && t.date >= today)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [tours]);
  const setTourStatus = async (t: any, status: string) => {
    await updateDoc(doc(firestore, 'tenants', tenantId, 'tours', t.id), { status, [`${status}At`]: new Date().toISOString() }).catch(() => {});
  };
  const t12tour = (t?: string) => {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
    const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hr = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
  };

  // v77 — GUEST BOOK: every paying day/hourly guest, deduped by contact.
  // The answer to "where did their contact info go" — it goes here,
  // permanently, with visit history and lifetime value.
  // v83 — REVIEWS: every rated stay, newest first. Lands in the Money tab.
  const reviews = useMemo(() =>
    reservations
      .filter(r => Number(r.rating) >= 1)
      .sort((a, b) => (b.reviewedAt || '').localeCompare(a.reviewedAt || '')),
    [reservations]);
  const reviewStats = useMemo(() => {
    if (reviews.length === 0) return null;
    const sum = reviews.reduce((s, r) => s + (r.rating || 0), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);


  const [guestBookOpen, setGuestBookOpen] = useState(false);
  const [profileContact, setProfileContact] = useState<any | null>(null);
  const [managingTour, setManagingTour] = useState<any | null>(null);

  const upcomingReservations = useMemo(() => {
    const today = localISO();
    return reservations
      .filter(r => ((['confirmed', 'checked_in', 'payment_received_conflict', 'cancelled_refund_pending'].includes(r.status)) && r.endDate >= today || r.overageStatus === 'due' || r.creditDecision === 'pending' || r.status === 'cancel_requested')
        && (!r.locationId || r.locationId === selectedLocationId))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }, [reservations, selectedLocationId]);

  // v63 — W-9 compliance map. FIXED: reads renters.data (declared above via
  // the collections hook), never sortedRenters (declared later — TDZ crash).
  const [w9Map, setW9Map] = useState<Record<string, any>>({});
  useEffect(() => {
    const list = (renters.data ?? []) as Renter[];
    if (!list.length || !tenantId) return;
    list.forEach((r: Renter) => {
      if (w9Map[r.id] !== undefined) return;
      fetch(`/api/booths/w9?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(r.id)}`)
        .then(res => res.json())
        .then(d => setW9Map(prev => ({ ...prev, [r.id]: d.w9 || null })))
        .catch(() => setW9Map(prev => ({ ...prev, [r.id]: null })));
    });
  }, [renters.data, tenantId]);

  // v57 — transactions (booth income ledger view)
  const [boothTxns, setBoothTxns] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId || tab !== 'money') return;
    const unsub = onSnapshot(
      query(collection(firestore, 'tenants', tenantId, 'transactions'), where('source', '==', 'booth_rent')),
      (snap) => setBoothTxns(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => {});
    return () => unsub();
  }, [firestore, tenantId, tab]);
  const txnDateStr = (t: any): string => {
    const v = t.date || t.createdAt;
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString().slice(0, 10); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
    return '';
  };
  const txnDollars = (t: any): number => typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100;
  const txnDesc = (t: any): string => t.description || t.category || 'Booth payment';
  const sortedTxns = useMemo(() =>
    [...boothTxns].sort((a, b) => txnDateStr(b).localeCompare(txnDateStr(a))),
    [boothTxns]);
  const txnTotalCents = useMemo(() => sortedTxns.reduce((s, t) => s + Math.round(txnDollars(t) * 100), 0), [sortedTxns]);

  const setResStatus = async (r: any, status: string) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { status, [`${status}At`]: new Date().toISOString() });
      if (['cancelled_refund_pending', 'refunded', 'cancelled'].includes(status)) {
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.reservation_' + status, targetType: 'boothReservation', targetId: r.id,
          summary: `Reservation ${status.replace(/_/g, ' ')}: ${r.name || 'guest'} · ${r.boothName || 'space'}`,
          amount: (r.amountCents || 0) / 100, actor: { type: 'user' },
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'The reservation was not changed — try again.' });
    }
  };

  // ── v69 TIME CLOCK: check-in/out are real timestamps, not status flips.
  // On check-out we settle the stay against the booked window:
  //   over  → overageDueCents recorded (15-min increments, 10-min grace),
  //           surfaced as a Collect action — charged via POS/link since
  //           checkout payments don't save a card for off-session charges.
  //   under → unused time becomes a credit (boothCredits, keyed by the
  //           guest's phone/email) that auto-applies to their next booking.
  const hourlyCentsOf = (boothId: string): number => {
    const b = boothById.get(boothId) as any;
    const opts = Array.isArray(b?.pricingOptions) ? b.pricingOptions : [];
    return opts.find((o: any) => o.frequency === 'hourly' && o.amountCents > 0)?.amountCents || 0;
  };
  const checkInRes = async (r: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id), {
        status: 'checked_in',
        checked_inAt: new Date().toISOString(),
        actualCheckIn: new Date().toISOString(),
        // v73 — snapshot the rate NOW so checkout settles at the rate in
        // force during the stay, not whatever the booth costs later.
        settleHourlyCents: hourlyCentsOf(r.boothId) || r.settleHourlyCents || 0,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Check-in failed', description: 'Nothing was saved — try again.' });
    }
  };
  const checkOutRes = async (r: any) => {
    const now = new Date();
    const updates: any = {
      status: 'completed',
      completedAt: now.toISOString(),
      actualCheckOut: now.toISOString(),
    };
    // Settlement only makes sense for hourly stays with a booked window.
    if (r.bookingType === 'hourly' && r.startTime && r.endTime && r.actualCheckIn) {
      const bookedEnd = new Date(`${r.startDate}T${r.endTime}:00`);
      // v73 — settle at the rate snapshotted at check-in (falls back to
      // the current rate only for stays that predate the snapshot).
      const rate = (r.settleHourlyCents > 0 ? r.settleHourlyCents : hourlyCentsOf(r.boothId));
      const GRACE_MS = 10 * 60 * 1000;
      const diffMs = now.getTime() - bookedEnd.getTime();
      if (diffMs > GRACE_MS && rate > 0) {
        const overQuarters = Math.ceil((diffMs - GRACE_MS) / (15 * 60 * 1000));
        updates.overageMinutes = overQuarters * 15;
        updates.overageDueCents = Math.round(rate * (overQuarters * 15) / 60);
        updates.overageStatus = 'due';
      } else if (diffMs < -(30 * 60 * 1000) && rate > 0) {
        // Left 30+ min early: unused time is recorded as a POTENTIAL
        // credit — issuing it is the owner's call (v70: discretionary,
        // per business decision), via the Issue Credit button on the card.
        const underQuarters = Math.floor(-diffMs / (15 * 60 * 1000));
        const creditCents = Math.round(rate * (underQuarters * 15) / 60);
        if (creditCents >= 100) {
          updates.unusedMinutes = underQuarters * 15;
          updates.potentialCreditCents = creditCents;
          updates.creditDecision = 'pending';
        }
      }
    }
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id), updates);
    } catch {
      toast({ variant: 'destructive', title: 'Check-out failed', description: 'Nothing was saved — try again.' });
    }
  };
  // v73 — atomic: credit doc + reservation flag commit together (the old
  // two-write version could create the credit while the decision stayed
  // 'pending' — one more click, one duplicate credit). Also guards
  // re-entry and only toasts success after the commit actually succeeds.
  const issueCredit = async (r: any) => {
    const contactKey = (r.phone || r.email || '').trim();
    if (!contactKey || !(r.potentialCreditCents > 0)) return;
    if (r.creditDecision !== 'pending') return;
    try {
      const batch = writeBatch(firestore);
      const credRef = doc(collection(firestore, 'tenants', tenantId, 'boothCredits'));
      batch.set(credRef, {
        id: credRef.id, contactKey, phone: r.phone || null, email: r.email || null,
        name: r.name || '', amountCents: r.potentialCreditCents, minutes: r.unusedMinutes || 0,
        sourceReservationId: r.id, sourceBoothName: r.boothName || '',
        status: 'available', createdAt: new Date().toISOString(),
      });
      batch.update(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { creditDecision: 'issued', creditIssuedCents: r.potentialCreditCents, creditIssuedAt: new Date().toISOString() });
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      batch.set(aRef, { id: aRef.id, ...auditEntry({
        action: 'booth.credit_issued', targetType: 'boothCredit', targetId: credRef.id,
        summary: `Credit issued to ${r.name || 'guest'} for unused time (${r.unusedMinutes || 0} min) · ${r.boothName || 'space'}`,
        amount: r.potentialCreditCents / 100, actor: { type: 'user' },
      }) });
      await batch.commit();
      toast({ title: 'Credit issued', description: `$${(r.potentialCreditCents / 100).toFixed(2)} will auto-apply to ${r.name}'s next booking.` });
    } catch {
      toast({ variant: 'destructive', title: 'Credit failed', description: 'Nothing was issued — try again.' });
    }
  };
  const declineCredit = async (r: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { creditDecision: 'declined' });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.credit_declined', targetType: 'boothReservation', targetId: r.id,
        summary: `Unused-time credit declined for ${r.name || 'guest'} ($${((r.potentialCreditCents || 0) / 100).toFixed(2)})`,
        amount: (r.potentialCreditCents || 0) / 100, actor: { type: 'user' },
      });
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'Try again.' });
    }
  };
  // v74 — REAL refunds: calls the PATCH endpoint (Stripe refund + ledger
  // reversal + audit) instead of the old status flip that moved no money.
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const refundReservation = async (r: any) => {
    if (refundingId) return;
    setRefundingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id }),
      });
      const d = await res.json();
      if (d.ok) toast({ title: 'Refunded', description: `$${((d.refundedCents || 0) / 100).toFixed(2)} refunded to ${r.name || 'guest'}'s card${d.alreadyRefunded ? ' (was already processed)' : ''}.` });
      else toast({ variant: 'destructive', title: 'Refund failed', description: d.error || 'Try again, or record it manually.' });
    } catch {
      toast({ variant: 'destructive', title: 'Network error', description: 'The refund may not have completed — check Stripe before retrying.' });
    } finally { setRefundingId(null); }
  };
  const [chargingId, setChargingId] = useState<string | null>(null);
  const chargeOverageToCard = async (r: any) => {
    if (chargingId) return;
    setChargingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Card charged', description: `$${(data.chargedCents / 100).toFixed(2)} collected and recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.overage_charged', targetType: 'boothReservation', targetId: r.id,
          summary: `Overage charged to card on file: ${r.name || 'guest'} · ${r.boothName || 'space'}`,
          amount: (data.chargedCents || 0) / 100, actor: { type: 'user' },
        });
      }
      else toast({ variant: 'destructive', title: 'Charge failed', description: data.error || 'Collect in person instead.' });
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Network error — try again or collect in person.' });
    } finally { setChargingId(null); }
  };
  // Arbitrary incidental/damage charge to a reservation's card on file (hotel-style).
  const [incidentalForId, setIncidentalForId] = useState<string | null>(null);
  const [incidentalAmt, setIncidentalAmt] = useState('');
  const [incidentalDesc, setIncidentalDesc] = useState('');
  const [incidentalCat, setIncidentalCat] = useState('');
  const DEFAULT_INCIDENTALS = [
    { label: 'Cleaning fee', capCents: 7500 },
    { label: 'Damage', capCents: 50000 },
    { label: 'Lost key / fob', capCents: 2500 },
    { label: 'Late checkout', capCents: 5000 },
    { label: 'Missing product / supplies', capCents: 15000 },
  ];
  const incidentalPolicy: any[] = (Array.isArray((selectedTenant as any)?.incidentalCategories) && (selectedTenant as any).incidentalCategories.length)
    ? (selectedTenant as any).incidentalCategories : DEFAULT_INCIDENTALS;
  const [incidentalBusyId, setIncidentalBusyId] = useState<string | null>(null);
  // ── Incidentals charge-policy editor ───────────────────────────────────────
  // Owners set the ALLOWED charge types and a hard cap on each. The server
  // enforces these on every card charge (reserve route PATCH action:'incidental'),
  // and the same list is folded into the signed lease — so nobody can invent a fee.
  const [chargePolicyOpen, setChargePolicyOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<{ label: string; cap: string }[]>([]);
  const [policySaving, setPolicySaving] = useState(false);
  const openChargePolicy = () => {
    setPolicyDraft(incidentalPolicy.map((c: any) => ({ label: String(c.label || ''), cap: c.capCents ? (c.capCents / 100).toFixed(0) : '' })));
    setChargePolicyOpen(true);
  };
  // ── Tour-sheet copy editor ─────────────────────────────────────────────────
  // Everything printed on the visitor confirmation + staff prep sheet is
  // owner-editable here (stored on tenants/{id}.tourPrintoutConfig). Unset
  // fields fall back to the defaults, so the sheets always read well.
  const [tourSheetsOpen, setTourSheetsOpen] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetDraft, setSheetDraft] = useState<any>(null);
  const openTourSheets = () => {
    const saved = (selectedTenant as any)?.tourPrintoutConfig || {};
    const d = DEFAULT_TOUR_PRINTOUT_CONFIG;
    setSheetDraft({
      confirmationTitle: saved.confirmationTitle ?? d.confirmationTitle,
      confirmationIntro: saved.confirmationIntro ?? d.confirmationIntro,
      whatToBringTitle: saved.whatToBringTitle ?? d.whatToBringTitle,
      whatToBring: Array.isArray(saved.whatToBring) && saved.whatToBring.length ? [...saved.whatToBring] : [...d.whatToBring],
      changeTimeTitle: saved.changeTimeTitle ?? d.changeTimeTitle,
      changeTimeNote: saved.changeTimeNote ?? d.changeTimeNote,
      prepTitle: saved.prepTitle ?? d.prepTitle,
      prepIntro: saved.prepIntro ?? d.prepIntro,
      checklistTitle: saved.checklistTitle ?? d.checklistTitle,
      checklist: Array.isArray(saved.checklist) && saved.checklist.length ? [...saved.checklist] : [...d.checklist],
      captureTitle: saved.captureTitle ?? d.captureTitle,
      interestLevels: Array.isArray(saved.interestLevels) && saved.interestLevels.length ? [...saved.interestLevels] : [...d.interestLevels],
      nextSteps: Array.isArray(saved.nextSteps) && saved.nextSteps.length ? [...saved.nextSteps] : [...d.nextSteps],
      notesTitle: saved.notesTitle ?? d.notesTitle,
      footerNote: saved.footerNote ?? '',
      hideBranding: !!saved.hideBranding,
    });
    setTourSheetsOpen(true);
  };
  const saveTourSheets = async () => {
    if (!tenantId || !sheetDraft) return;
    setSheetSaving(true);
    try {
      const clean = {
        confirmationTitle: String(sheetDraft.confirmationTitle || '').trim(),
        confirmationIntro: String(sheetDraft.confirmationIntro || '').trim(),
        whatToBringTitle: String(sheetDraft.whatToBringTitle || '').trim(),
        whatToBring: (sheetDraft.whatToBring || []).map((s: string) => String(s || '').trim()).filter(Boolean),
        changeTimeTitle: String(sheetDraft.changeTimeTitle || '').trim(),
        changeTimeNote: String(sheetDraft.changeTimeNote || '').trim(),
        prepTitle: String(sheetDraft.prepTitle || '').trim(),
        prepIntro: String(sheetDraft.prepIntro || '').trim(),
        checklistTitle: String(sheetDraft.checklistTitle || '').trim(),
        checklist: (sheetDraft.checklist || []).map((s: string) => String(s || '').trim()).filter(Boolean),
        captureTitle: String(sheetDraft.captureTitle || '').trim(),
        interestLevels: (sheetDraft.interestLevels || []).map((s: string) => String(s || '').trim()).filter(Boolean),
        nextSteps: (sheetDraft.nextSteps || []).map((s: string) => String(s || '').trim()).filter(Boolean),
        notesTitle: String(sheetDraft.notesTitle || '').trim(),
        footerNote: String(sheetDraft.footerNote || '').trim(),
        hideBranding: !!sheetDraft.hideBranding,
      };
      await updateDoc(doc(firestore, 'tenants', tenantId), { tourPrintoutConfig: clean });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.tour_sheets_updated', targetType: 'tenant', targetId: tenantId,
        summary: 'Tour printout copy updated (visitor confirmation + staff prep sheet)',
        actor: { type: 'user' },
      });
      toast({ title: 'Tour sheets saved', description: 'Your custom wording now prints on both sheets.' });
      setTourSheetsOpen(false);
    } catch {
      toast({ variant: 'destructive', title: 'Could not save', description: 'Network error — try again.' });
    } finally { setSheetSaving(false); }
  };

  // ── No-show policy ─────────────────────────────────────────────────────────
  // Default OFF (flag only). When the owner turns it on and sets a fee, the
  // nightly sweep charges the card on file for confirmed reservations that fully
  // elapsed without a check-in. A declined card is flagged, never punitive.
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [noShowSaving, setNoShowSaving] = useState(false);
  const [noShowEnabled, setNoShowEnabled] = useState(false);
  const [noShowFee, setNoShowFee] = useState('');
  const openNoShow = () => {
    const p = (selectedTenant as any)?.noShowPolicy || {};
    setNoShowEnabled(!!p.enabled);
    setNoShowFee(p.feeCents ? (p.feeCents / 100).toFixed(0) : '');
    setNoShowOpen(true);
  };
  const saveNoShow = async () => {
    if (!tenantId) return;
    const feeCents = Math.max(0, Math.round((parseFloat(noShowFee) || 0) * 100));
    if (noShowEnabled && !(feeCents > 0)) {
      toast({ variant: 'destructive', title: 'Set a fee amount', description: 'Turn off no-show fees, or enter an amount to charge.' });
      return;
    }
    setNoShowSaving(true);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId), { noShowPolicy: { enabled: noShowEnabled, feeCents } });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.no_show_policy_updated', targetType: 'tenant', targetId: tenantId,
        summary: noShowEnabled ? `No-show fee turned ON — $${(feeCents / 100).toFixed(0)} charged to card on file` : 'No-show fees turned OFF (flag only)',
        actor: { type: 'user' },
      });
      toast({ title: 'No-show policy saved', description: noShowEnabled ? `No-shows will be charged $${(feeCents / 100).toFixed(0)} when a card is on file.` : 'No-shows will be flagged for review — no automatic charge.' });
      setNoShowOpen(false);
    } catch {
      toast({ variant: 'destructive', title: 'Could not save', description: 'Network error — try again.' });
    } finally { setNoShowSaving(false); }
  };

  const savePolicy = async () => {
    if (!tenantId) return;
    const cleaned = policyDraft
      .map(r => ({ label: r.label.trim(), capCents: Math.max(0, Math.round((parseFloat(r.cap) || 0) * 100)) }))
      .filter(r => r.label.length > 0);
    if (!cleaned.length) { toast({ variant: 'destructive', title: 'Add at least one charge type', description: 'A policy needs at least one allowed charge.' }); return; }
    setPolicySaving(true);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId), { incidentalCategories: cleaned });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.incidental_policy_updated', targetType: 'tenant', targetId: tenantId,
        summary: `Incidental charge policy updated — ${cleaned.length} allowed charge${cleaned.length === 1 ? '' : 's'} (${cleaned.map(c => `${c.label} ≤ $${(c.capCents / 100).toFixed(0)}`).join(', ')})`,
        actor: { type: 'user' },
      });
      toast({ title: 'Charge policy saved', description: `${cleaned.length} allowed charge type${cleaned.length === 1 ? '' : 's'}. Caps are enforced on every card charge and shown in the lease.` });
      setChargePolicyOpen(false);
    } catch {
      toast({ variant: 'destructive', title: 'Could not save', description: 'Network error — try again.' });
    } finally { setPolicySaving(false); }
  };
  const chargeIncidentalToCard = async (r: any) => {
    const cents = Math.round(parseFloat(incidentalAmt) * 100);
    if (!(cents >= 50) || !incidentalCat || incidentalBusyId) return;
    setIncidentalBusyId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'incidental', tenantId, reservationId: r.id, amountCents: cents, category: incidentalCat, note: incidentalDesc.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Card charged', description: `$${(data.chargedCents / 100).toFixed(2)} — ${incidentalCat} recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.incidental_charged', targetType: 'boothReservation', targetId: r.id,
          summary: `Incidental charged to card on file: ${r.name || 'guest'} · ${r.boothName || 'space'} — ${incidentalCat}${incidentalDesc.trim() ? ` (${incidentalDesc.trim()})` : ''}`,
          amount: (data.chargedCents || 0) / 100, actor: { type: 'user' },
        });
        setIncidentalForId(null); setIncidentalAmt(''); setIncidentalDesc(''); setIncidentalCat('');
      } else toast({ variant: 'destructive', title: 'Charge failed', description: data.error || 'Collect in person instead.' });
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Network error — try again.' });
    } finally { setIncidentalBusyId(null); }
  };
  const markOverageCollected = async (r: any) => {
    const nowIso = new Date().toISOString();
    try {
      // v73 — three fixes in one: (1) `source: 'booth_rent'` — WITHOUT it
      // this money was invisible to every booth ledger view and renter
      // statement, which all filter on that field; (2) atomic batch so the
      // ledger entry and the reservation flag can't drift; (3) audit entry.
      const batch = writeBatch(firestore);
      const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
      batch.set(txnRef, {
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
        source: 'booth_rent',
        amount: (r.overageDueCents || 0) / 100, category: 'Booth Rent',
        description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
        clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Collected in person',
        hasReceipt: false, sourceId: r.id, tenantId, createdAt: nowIso,
      });
      batch.update(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { overageStatus: 'collected', overageCollectedAt: nowIso });
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      batch.set(aRef, { id: aRef.id, ...auditEntry({
        action: 'booth.overage_collected', targetType: 'transaction', targetId: txnRef.id,
        summary: `Overage collected in person: ${r.name || 'guest'} · ${r.boothName || 'space'} (+${r.overageMinutes || 0} min)`,
        amount: (r.overageDueCents || 0) / 100, actor: { type: 'user' },
      }) });
      await batch.commit();
      toast({ title: 'Overage collected', description: `$${((r.overageDueCents || 0) / 100).toFixed(2)} recorded in the ledger.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not record', description: 'Nothing was saved — try again.' });
    }
  };

  // ── v86: applicant decision emails — opens a prefilled draft in the
  // owner's mail app (no email provider needed yet; when one is wired,
  // swap this for a server call and keep the same wording).
  const openDecisionEmail = (app: any, decision: 'approved' | 'declined') => {
    if (!app?.email) {
      toast({ title: 'No email on the application', description: 'Reach out by phone — their number is on the card.' });
      return;
    }
    const studio = selectedTenant?.name || 'our studio';
    const first = (app.name || '').trim().split(' ')[0] || 'there';
    const subject = decision === 'approved'
      ? `Your ${app.boothName || 'booth'} application at ${studio} — approved!`
      : `Your application at ${studio}`;
    const bodyText = decision === 'approved'
      ? `Hi ${first},\n\nGreat news — your application${app.boothName ? ` for ${app.boothName}` : ''} has been approved!\n\nNext step: ${app.rentalType === 'lease' ? "we'll get your lease ready and walk you through move-in." : "reply with the dates you'd like and we'll lock them in."}\n\nTalk soon,\n${studio}`
      : `Hi ${first},\n\nThank you so much for applying${app.boothName ? ` for ${app.boothName}` : ''}. After careful consideration we won't be moving forward right now, but we'd love to keep your application on file in case a space opens up.\n\nWith appreciation,\n${studio}`;
    try {
      window.open(`mailto:${app.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`, '_self');
      updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', app.id),
        { applicantNotifiedAt: new Date().toISOString() }).catch(() => {});
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.applicant_emailed', targetType: 'boothApplication', targetId: app.id,
        summary: `Decision email drafted to ${app.name || 'applicant'} (${decision})`,
        actor: auditActor,
      });
    } catch { /* the decision itself already saved — email draft is best-effort */ }
  };

  const [decidingAppId, setDecidingAppId] = useState<string | null>(null);
  const setAppStatus = async (app: any, status: string) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', app.id), { status, decidedAt: new Date().toISOString() });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.application_' + status, targetType: 'boothApplication', targetId: app.id,
        summary: `Application ${status.replace(/_/g, ' ')}: ${app.name || 'applicant'}${app.boothName ? ` · ${app.boothName}` : ''}`,
        actor: { type: 'user' },
      });
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'The application was not changed — try again.' });
    }
  };
  const approveApplication = async (app: any) => {
    if (decidingAppId) return;
    setDecidingAppId(app.id);
    try {
      if (app.rentalType === 'lease') {
        const parts = (app.name || '').trim().split(' ');
        // v68 — context carry-over: nothing from the application dies at
        // conversion. Attachments, message, timing, and consent all land
        // on the renter record and surface in the profile drawer.
        await createRenter(firestore, {
          tenantId,
          locationId: app.locationId || selectedLocationId,
          firstName: parts[0] || 'New',
          lastName: parts.slice(1).join(' ') || 'Renter',
          email: app.email || '',
          phone: app.phone || undefined,
          specialty: app.specialty || undefined,
          notes: `Applied via website for ${app.boothName || 'a booth'}${app.timing ? ` · ${app.timing}` : ''}${app.message ? ` · "${app.message}"` : ''}`,
          sourceApplicationId: app.id,
          applicationAttachments: Array.isArray(app.attachments) ? app.attachments : [],
          applicationMessage: app.message || '',
          appliedAt: app.createdAt || null,
          consentAccepted: app.consentAccepted ?? null,
          consentAcceptedAt: app.consentAcceptedAt ?? null,
        } as any);
        await setAppStatus(app, 'approved');
        toast({ title: 'Approved — renter created', description: 'Assign their booth via a lease below. An approval email draft just opened.' });
        openDecisionEmail(app, 'approved');
      } else {
        await setAppStatus(app, 'approved');
        toast({ title: 'Day rental approved', description: `${app.name} is in your Guest book below. An approval email draft just opened.` });
        openDecisionEmail(app, 'approved');
      }
    } catch {
      toast({ variant: 'destructive', title: 'Could not approve', description: 'Email may be missing — check the card.' });
    } finally { setDecidingAppId(null); }
  };

  // ── Contact journey: convert to renter + pipeline management ────────────────
  // The missing link. A tour or contact can now become a renter in one tap —
  // carrying name/phone/email/specialty across — and the source lead is retired
  // from the pipeline and linked to the new renter. Non-converts get managed
  // (stage, follow-up date, lost reason, notes) instead of just sitting closed.
  const [convertingKey, setConvertingKey] = useState<string | null>(null);
  const convertToRenter = async (person: any, sourceApp?: any) => {
    if (!tenantId || convertingKey) return;
    const name = String(person?.name || sourceApp?.name || '').trim();
    const phone = person?.phone || sourceApp?.phone || '';
    const email = person?.email || sourceApp?.email || '';
    const key = person?.key || boothContactKey(phone, email);
    if (!name && !phone && !email) {
      toast({ variant: 'destructive', title: 'Not enough detail', description: 'This contact needs at least a name, phone, or email to convert.' });
      return;
    }
    setConvertingKey(key || 'x');
    try {
      const parts = name.split(' ');
      const specialty = person?.specialty || sourceApp?.specialty || undefined;
      const boothName = sourceApp?.boothName;
      const res: any = await createRenter(firestore, {
        tenantId,
        locationId: sourceApp?.locationId || selectedLocationId,
        firstName: parts[0] || 'New',
        lastName: parts.slice(1).join(' ') || 'Renter',
        email: email || '',
        phone: phone || undefined,
        specialty,
        notes: sourceApp
          ? `Converted from ${sourceApp.kind === 'tour' ? 'a tour' : 'an application'}${boothName ? ` for ${boothName}` : ''}${sourceApp.timing ? ` · ${sourceApp.timing}` : ''}${sourceApp.message ? ` · "${sourceApp.message}"` : ''}`
          : 'Converted from a contact',
        sourceApplicationId: sourceApp?.id || null,
        appliedAt: sourceApp?.createdAt || null,
      } as any);
      const rid: string | null = res?.id || res?.renterId || (typeof res === 'string' ? res : null);
      if (rid) await linkContactRenter(firestore, tenantId, { name, phone, email }, rid);
      else await setContactPipeline(firestore, tenantId, { name, phone, email }, 'won');
      if (sourceApp?.id) {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', sourceApp.id), {
          status: 'converted', convertedAt: new Date().toISOString(), ...(rid ? { convertedRenterId: rid } : {}),
        }).catch(() => {});
      }
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.contact_converted', targetType: 'renter', targetId: rid || key,
        summary: `Converted ${name || 'contact'} to a renter${boothName ? ` · ${boothName}` : ''}`,
        actor: { type: 'user' },
      });
      toast({ title: 'Converted to renter', description: `${name || 'They'} are now a renter — assign their booth with a lease, then run onboarding.` });
      setManagingTour(null);
      setProfileContact(null);
    } catch {
      toast({ variant: 'destructive', title: 'Could not convert', description: 'Try again, or add them via Add Renter.' });
    } finally { setConvertingKey(null); }
  };

  const runContactAction = async (p: Promise<any>, okTitle: string) => {
    try { await p; toast({ title: okTitle }); }
    catch { toast({ variant: 'destructive', title: 'Could not save', description: 'Network error — try again.' }); }
  };
  const handleSetPipeline = (person: any, stage: any) => runContactAction(setContactPipeline(firestore, tenantId, person, stage), 'Stage updated');
  const handleFollowUp = (person: any, date: string | null) => runContactAction(scheduleContactFollowUp(firestore, tenantId, person, date), date ? 'Follow-up scheduled' : 'Follow-up cleared');
  const handleMarkLost = (person: any, reason: string) => runContactAction(markContactLost(firestore, tenantId, person, reason), 'Marked as lost — kept on file');
  const handleReengage = (person: any) => runContactAction(reengageContact(firestore, tenantId, person), 'Back in nurturing');
  const handleSaveNote = (person: any, note: string) => runContactAction(setContactNote(firestore, tenantId, person, note), 'Note saved');

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
  // ── v86 UNIFIED CRM (pipeline Step 2) ────────────────────────────────
  // One contact identity per person, keyed by phone/email, merging every
  // touchpoint: reservations, applications/tours, leases, reviews. Tour-
  // takers and lease renters are valued on the SAME yardstick — lifetime
  // value, visits, stage, rating — because they are finally one object.
  // Stage ladder: inquiry → tour → applicant → guest → renter → repeat.
  const guestBook = useMemo(() => {
    const norm = (v: any) => (v || '').trim().toLowerCase();
    const byContact = new Map<string, any>();
    const get = (phone: any, email: any, name: any) => {
      const key = norm(phone) || norm(email);
      if (!key) return null;
      let g = byContact.get(key);
      if (!g) {
        g = { key, name: name || 'Guest', phone: phone || '', email: email || '',
          visits: 0, totalCents: 0, lastDate: '', firstDate: '9999',
          stage: 'inquiry', stageRank: 0, tags: new Set<string>() };
        byContact.set(key, g);
      }
      if (name && (!g.name || g.name === 'Guest')) g.name = name;
      if (phone && !g.phone) g.phone = phone;
      if (email && !g.email) g.email = email;
      return g;
    };
    const STAGE_RANK: Record<string, number> = { inquiry: 0, tour: 1, applicant: 2, guest: 3, renter: 4, repeat: 5 };
    const promote = (g: any, stage: string) => { if (STAGE_RANK[stage] > g.stageRank) { g.stage = stage; g.stageRank = STAGE_RANK[stage]; } };

    // Reservations — paid guests, lifetime value, ratings
    for (const r of reservations) {
      if (!['confirmed', 'checked_in', 'completed', 'cancel_requested'].includes(r.status)) continue;
      const g = get(r.phone, r.email, r.name); if (!g) continue;
      if (['confirmed', 'checked_in', 'completed'].includes(r.status)) {
        g.visits += 1;
        g.totalCents += (r.amountCents || 0) + (r.overageStatus === 'charged' ? (r.overageDueCents || 0) : 0);
        promote(g, g.visits > 1 ? 'repeat' : 'guest');
      }
      if ((r.startDate || '') > g.lastDate) { g.lastDate = r.startDate; }
      if ((r.startDate || '') < g.firstDate) g.firstDate = r.startDate;
      if (Number(r.rating) >= 1 && (r.reviewedAt || '') > (g.lastReviewedAt || '')) { g.lastRating = r.rating; g.lastReviewedAt = r.reviewedAt || ''; }
    }
    // Applications & tours — the top of the funnel, never lost
    for (const app of applications) {
      const g = get(app.phone, app.email, app.name); if (!g) continue;
      const when = String(app.decidedAt || app.createdAt || '').slice(0, 10);
      if (when && when > g.lastDate) g.lastDate = when;
      if (when && when < g.firstDate) g.firstDate = when;
      const kind = app.kind || 'application';
      if (kind === 'tour') { promote(g, 'tour'); g.tags.add('toured'); }
      else { promote(g, 'applicant'); }
      if (app.status === 'approved') g.tags.add('approved');
    }
    // Leases — renters, valued with their rent
    for (const l of (leases.data || [])) {
      if (!['active', 'on_leave', 'pending_signature'].includes(l.status)) continue;
      const rt = renterById.get(l.renterId);
      if (!rt) continue;
      const g = get(rt.phone, rt.email, `${rt.firstName || ''} ${rt.lastName || ''}`.trim()); if (!g) continue;
      promote(g, 'renter');
      g.tags.add('renter');
      g.isRenter = true; g.renterId = rt.id;
      g.monthlyRentCents = (l.rentAmountCents || 0) * (FREQ_TO_MONTHLY[l.frequency] ?? 1);
    }
    const arr = Array.from(byContact.values()).map(g => {
      const c = contactByKey.get(g.key);
      return {
        ...g,
        tags: Array.from(g.tags),
        // Persisted journey overlay (undefined until the owner acts on them).
        pipelineStage: c?.pipelineStage || null,
        nextFollowUpAt: c?.nextFollowUpAt || null,
        lostReason: c?.lostReason || null,
        ownerNotes: c?.ownerNotes || null,
        convertedRenterId: c?.convertedRenterId || (g.isRenter ? g.renterId : null),
      };
    });
    return arr.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
  }, [reservations, applications, leases.data, renterById, contactByKey]);

  // Deep-link from the planner: /booths?contact=<phone|email> opens that exact
  // person's history & details on load — renter profile if they're a renter,
  // otherwise their guest/contact profile (reservations, tours, lifetime value).
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('contact');
    if (!raw || !guestBook || guestBook.length === 0) return;
    const norm = (s: any) => String(s || '').replace(/[^\da-z@.]/gi, '').toLowerCase();
    const nkey = norm(raw);
    if (!nkey) return;
    const match = guestBook.find((g: any) =>
      (g.phone && norm(g.phone) === nkey) || (g.email && norm(g.email) === nkey) || (g.key && norm(g.key) === nkey));
    if (!match) return;
    deepLinkHandled.current = true;
    if (match.isRenter && match.renterId) { const rt = renterById.get(match.renterId); if (rt) { setProfileRenter(rt); return; } }
    setProfileContact(match);
  }, [guestBook, renterById]);

  const rentRoll = useMemo(() => {
    const occupying = (leases.data || []).filter((l: any) => ['active', 'on_leave', 'pending_signature'].includes(l.status));
    return occupying.map((l: any) => {
      const renter = renterById.get(l.renterId);
      const booth = boothById.get(l.boothId);
      const myInv = rentInvoices.filter(i => i.leaseId === l.id).sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
      const open = myInv.find(i => ['due', 'late'].includes(i.status));
      const owedCents = open ? (open.amountCents || 0) + (open.lateFeeCents || 0) : 0;
      return { lease: l, renter, booth, open, owedCents, lastPaid: myInv.find(i => i.status === 'paid') };
    }).sort((a, b) => (b.owedCents - a.owedCents));
  }, [leases.data, rentInvoices, renterById, boothById]);
  const toggleAutoCollect = async (l: any) => {
    const dueDay = Math.min(28, new Date((l.startDate || localISO()) + 'T00:00:00Z').getUTCDate());
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'leases', l.id),
        { autoCollect: !l.autoCollect, dueDay: l.dueDay ?? dueDay });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.autocollect_' + (!l.autoCollect ? 'on' : 'off'), targetType: 'lease', targetId: l.id,
        summary: `Rent auto-collect turned ${!l.autoCollect ? 'ON' : 'OFF'} (lease ${l.id.slice(-6)})`,
        amount: (l.rentAmountCents || 0) / 100, actor: { type: 'user' },
      });
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'Auto-collect was not changed — try again.' });
    }
  };

  // ── v84: record manual rent / deposit payments (cash, check, Zelle…) ──────
  const { user: currentUser } = useUser();
  const auditActor = useMemo(() => ({
    type: 'user' as const,
    id: currentUser?.uid || undefined,
    name: currentUser?.displayName || currentUser?.email || 'Owner',
  }), [currentUser?.uid, currentUser?.displayName, currentUser?.email]);

  const [recordPay, setRecordPay] = useState<any>(null); // { mode:'rent'|'deposit', lease, renter, booth, invoice? }
  const [recordPayAmount, setRecordPayAmount] = useState('');
  const [recordPayMethod, setRecordPayMethod] = useState('Cash');
  const [recordPayNote, setRecordPayNote] = useState('');
  const [recordPaySaving, setRecordPaySaving] = useState(false);
  const openRecordPay = (mode: 'rent' | 'deposit', row: any) => {
    setRecordPay({ mode, lease: row.lease, renter: row.renter, booth: row.booth, invoice: row.open || null });
    setRecordPayAmount(mode === 'deposit'
      ? String(((row.lease as any)?.deposit?.amountCents || 0) / 100)
      : String((row.owedCents || 0) / 100));
    setRecordPayMethod('Cash');
    setRecordPayNote('');
  };
  // ── v85: reschedule (server conflict-checked) + lease renewals ────────────
  const [reschedRes, setReschedRes] = useState<any>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedStartTime, setReschedStartTime] = useState('');
  const [reschedEndTime, setReschedEndTime] = useState('');
  const [reschedSaving, setReschedSaving] = useState(false);
  const openReschedule = (r: any) => {
    setReschedRes(r);
    setReschedDate(r.startDate || '');
    setReschedStartTime(r.startTime || '');
    setReschedEndTime(r.endTime || '');
  };
  const handleReschedule = async () => {
    if (!reschedRes || reschedSaving || !reschedDate) return;
    setReschedSaving(true);
    try {
      const isHourly = reschedRes.bookingType === 'hourly';
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reschedule', tenantId, reservationId: reschedRes.id,
          startDate: reschedDate,
          // daily: server keeps the same number of days automatically
          startTime: isHourly ? reschedStartTime : undefined,
          endTime: isHourly ? reschedEndTime : undefined,
          actorName: auditActor.name,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        toast({ title: 'Booking moved', description: `Now ${d.startDate}${d.startTime ? ` · ${d.startTime}–${d.endTime}` : ''}.` });
        setReschedRes(null);
      } else {
        toast({ variant: 'destructive', title: 'Couldn’t reschedule', description: d.error || 'Try again.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Couldn’t reschedule', description: 'Network error — nothing was changed.' });
    } finally { setReschedSaving(false); }
  };
  const renewLease = async (l: any) => {
    if (!l.endDate) return;
    try {
      const termDays = l.startDate
        ? Math.max(1, Math.round((new Date(l.endDate + 'T00:00:00Z').getTime() - new Date(l.startDate + 'T00:00:00Z').getTime()) / 86400000))
        : 30;
      const base = new Date(l.endDate + 'T00:00:00Z');
      base.setUTCDate(base.getUTCDate() + termDays);
      const newEnd = base.toISOString().slice(0, 10);
      await updateDoc(doc(firestore, 'tenants', tenantId, 'leases', l.id), {
        endDate: newEnd, renewedAt: new Date().toISOString(), status: 'active', expiryNotifiedAt: null,
      });
      writeBoothAudit(firestore, tenantId, {
        action: 'lease.renewed', targetType: 'lease', targetId: l.id,
        summary: `Lease renewed through ${newEnd} (one full term)`,
        actor: auditActor,
      });
      toast({ title: 'Lease renewed', description: `New end date: ${newEnd}.` });
    } catch {
      toast({ variant: 'destructive', title: 'Renewal failed', description: 'Nothing was changed — try again.' });
    }
  };

  const handleRecordPayment = async () => {
    if (!recordPay || recordPaySaving) return;
    const cents = Math.round((Number(recordPayAmount) || 0) * 100);
    if (cents <= 0) return;
    setRecordPaySaving(true);
    const nowIso = new Date().toISOString();
    const { mode, lease: pl, renter: prt, booth: pbt, invoice } = recordPay;
    const who = prt ? `${prt.firstName || ''} ${prt.lastName || ''}`.trim() || 'Renter' : 'Renter';
    try {
      const batch = writeBatch(firestore);
      const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
      if (mode === 'rent' && invoice) {
        batch.update(doc(firestore, 'tenants', tenantId, 'rentInvoices', invoice.id), {
          status: 'paid', paidAt: nowIso, paidMethod: recordPayMethod,
          paidAmountCents: cents, paidLedgerEntryId: txnRef.id, recordedManually: true,
        });
        batch.set(txnRef, {
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          source: 'booth_rent', category: 'Booth Rent',
          amount: cents / 100,
          description: `Booth rent — ${pbt?.name || 'space'} (due ${invoice.dueDate})${recordPayNote ? ` · ${recordPayNote}` : ''}`,
          clientOrVendor: who, date: nowIso, paymentMethod: recordPayMethod,
          hasReceipt: false, sourceId: invoice.id, tenantId, createdAt: nowIso,
        });
        const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
        batch.set(aRef, { id: aRef.id, ...auditEntry({
          action: 'booth.rent_recorded', targetType: 'rentInvoice', targetId: invoice.id,
          summary: `Recorded ${recordPayMethod} rent payment of $${(cents / 100).toFixed(2)} from ${who} (${pbt?.name || 'space'})`,
          amount: cents / 100, actor: auditActor,
        }) });
      } else if (mode === 'deposit') {
        batch.update(doc(firestore, 'tenants', tenantId, 'leases', pl.id), {
          'deposit.collectedLedgerEntryId': txnRef.id,
          'deposit.collectedAt': nowIso,
          'deposit.collectedMethod': recordPayMethod,
          'deposit.collectedCents': cents,
        });
        batch.set(txnRef, {
          id: txnRef.id, type: 'income', context: 'Business',
          // Deposits are HELD funds, not earnings — 'transfer' keeps them
          // out of P&L revenue while staying visible in the ledger.
          taxBucket: 'transfer',
          source: 'booth_rent', category: 'Booth Deposit',
          amount: cents / 100,
          description: `Security deposit — ${pbt?.name || 'space'} (${who})${recordPayNote ? ` · ${recordPayNote}` : ''}`,
          clientOrVendor: who, date: nowIso, paymentMethod: recordPayMethod,
          hasReceipt: false, sourceId: pl.id, tenantId, createdAt: nowIso,
        });
        const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
        batch.set(aRef, { id: aRef.id, ...auditEntry({
          action: 'booth.deposit_collected', targetType: 'lease', targetId: pl.id,
          summary: `Collected $${(cents / 100).toFixed(2)} security deposit (${recordPayMethod}) from ${who} (${pbt?.name || 'space'})`,
          amount: cents / 100, actor: auditActor,
        }) });
      }
      await batch.commit();
      toast({ title: mode === 'deposit' ? 'Deposit recorded' : 'Payment recorded',
        description: `$${(cents / 100).toFixed(2)} · ${recordPayMethod} — it's in your ledger and audit trail.` });
      setRecordPay(null);
    } catch {
      toast({ variant: 'destructive', title: 'Couldn’t record it', description: 'Nothing was saved — try again.' });
    } finally { setRecordPaySaving(false); }
  };

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
    // v85 — time-aware: two shared renters CAN share a day with
    // non-overlapping windows (Mon 9–1 and Mon 2–6 is fine).
    const proposed = {
      days: leaseForm.scheduleDays,
      startTime: leaseForm.scheduleStartTime || undefined,
      endTime: leaseForm.scheduleEndTime || undefined,
    };
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
      const boothName = booth?.name ?? 'a booth';
      list.push({
        id: `lease-exp-${l.id}`,
        severity: days <= 3 ? 'danger' : 'warning',
        message:
          days === 0
            ? `${boothName}'s lease with ${who} ends today`
            : `${boothName}'s lease with ${who} ends in ${days} day${days === 1 ? '' : 's'}`,
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

    // v84 — late/overdue rent belongs in the Command Center, not just the
    // rent roll: it's the single most expensive thing to miss.
    rentRoll.forEach(({ lease: l, renter, booth, open, owedCents }) => {
      if (!open) return;
      const who = renter ? `${renter.firstName} ${renter.lastName}` : 'A renter';
      const boothName = booth?.name ?? 'their booth';
      if (open.status === 'late') {
        list.push({
          id: `rent-late-${open.id}`, severity: 'danger',
          message: `${who}'s rent is LATE — $${(owedCents / 100).toFixed(2)} owed (${boothName})`,
        });
      } else if (open.dueDate && open.dueDate < localISO()) {
        list.push({
          id: `rent-overdue-${open.id}`, severity: 'warning',
          message: `${who}'s rent was due ${open.dueDate} — $${(owedCents / 100).toFixed(2)} outstanding (${boothName})`,
        });
      }
    });
    (leases.data ?? []).forEach((l) => {
      if (!['active', 'on_leave'].includes(l.status)) return;
      const dep: any = (l as any).deposit;
      if (dep && dep.amountCents > 0 && !dep.collectedLedgerEntryId) {
        const renter = renterById.get(l.renterId);
        const who = renter ? `${renter.firstName} ${renter.lastName}` : 'a renter';
        list.push({
          id: `dep-${l.id}`, severity: 'info',
          message: `Security deposit of ${formatCents(dep.amountCents)} not yet collected from ${who}`,
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
  }, [leases.data, booths.data, boothById, renterById, metrics, rentRoll]);

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
      startIncrementMins: (booth as any).startIncrementMins ? String((booth as any).startIncrementMins) : '30',
      depositType: (booth as any).depositType || ((booth as any).depositPercent > 0 ? 'percent' : 'none'),
      depositValue: (booth as any).depositType === 'flat'
        ? String(((booth as any).depositFlatCents || 0) / 100)
        : (booth as any).depositType === 'breakeven'
        ? String(((booth as any).breakevenHourlyCents || 0) / 100)
        : (booth as any).depositPercent != null ? String((booth as any).depositPercent) : '',
      balanceMode: (booth as any).balanceMode || 'in_person',
      baseRentFrequency: booth.baseRentFrequency,
      extraRates: (((booth as any).pricingOptions || []) as any[])
        .filter((o) => !(o.frequency === booth.baseRentFrequency && o.amountCents === booth.baseRentCents))
        .map((o) => ({ frequency: o.frequency, dollars: (o.amountCents / 100).toString() })),
      status: booth.status,
      amenities: booth.amenities ?? [],
      photoUrls: (booth as any).photoUrls ?? [],
      listingDescription: (booth as any).listingDescription ?? '',
      videoUrl: (booth as any).videoUrl ?? '',
      dayRentalDays: Array.isArray((booth as any).dayRentalDays) ? (booth as any).dayRentalDays : [0, 1, 2, 3, 4, 5, 6],
      blackoutDatesText: (Array.isArray((booth as any).blackoutDates) ? (booth as any).blackoutDates : []).join(', '),
      openTime: (booth as any).openTime ?? '',
      closeTime: (booth as any).closeTime ?? '',
      bookingSlots: (Array.isArray((booth as any).bookingSlots) ? (booth as any).bookingSlots : [])
        .map((s: any) => ({ label: s.label, start: s.startTime, end: s.endTime, dollars: (s.amountCents / 100).toString() })),
      shape: (booth as any).shape ?? 'rect',
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
            listingDescription: form.listingDescription.trim(),
            videoUrl: form.videoUrl.trim(),
            dayRentalDays: form.dayRentalDays,
            blackoutDates: form.blackoutDatesText.split(/[,\n]/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
            depositType: form.depositType,
            depositPercent: form.depositType === 'percent' ? Math.min(100, Math.max(0, Number(form.depositValue) || 0)) : null,
            depositFlatCents: form.depositType === 'flat' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
            breakevenHourlyCents: form.depositType === 'breakeven' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
            depositRequired: form.depositType !== 'none',
            balanceMode: form.balanceMode,
            openTime: form.openTime || null,
            closeTime: form.closeTime || null,
            startIncrementMins: Number(form.startIncrementMins) || 30,
            bookingSlots: form.bookingSlots
              .filter(s => s.label.trim() && s.start && s.end && toNumber(s.dollars) > 0)
              .map(s => ({ label: s.label.trim(), startTime: s.start, endTime: s.end, amountCents: Math.round(toNumber(s.dollars) * 100) })),
            shape: form.shape || 'rect',
            updatedAt: now,
          }
        );
      } else {
        const newBooth = await createBooth(firestore, {
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
          listingDescription: form.listingDescription.trim(),
          videoUrl: form.videoUrl.trim(),
          dayRentalDays: form.dayRentalDays,
          blackoutDates: form.blackoutDatesText.split(/[,\n]/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
          depositType: form.depositType,
          depositPercent: form.depositType === 'percent' ? Math.min(100, Math.max(0, Number(form.depositValue) || 0)) : null,
          depositFlatCents: form.depositType === 'flat' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
          breakevenHourlyCents: form.depositType === 'breakeven' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
          depositRequired: form.depositType !== 'none',
          balanceMode: form.balanceMode,
          openTime: form.openTime || null,
          closeTime: form.closeTime || null,
          startIncrementMins: Number(form.startIncrementMins) || 30,
          bookingSlots: form.bookingSlots
              .filter(s => s.label.trim() && s.start && s.end && toNumber(s.dollars) > 0)
              .map(s => ({ label: s.label.trim(), startTime: s.start, endTime: s.end, amountCents: Math.round(toNumber(s.dollars) * 100) })),
          shape: form.shape || 'rect',
        } as any);
        // Guarantee deposit fields persist even if the service layer
        // whitelists its payload (they'd otherwise be silently dropped
        // on new spaces, and the reserve route would charge full price).
        try {
          const newId = (newBooth as any)?.id || (typeof newBooth === 'string' ? newBooth : null);
          if (newId) {
            await updateDoc(doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), newId), {
              depositType: form.depositType,
              depositPercent: form.depositType === 'percent' ? Math.min(100, Math.max(0, Number(form.depositValue) || 0)) : null,
              depositFlatCents: form.depositType === 'flat' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
              breakevenHourlyCents: form.depositType === 'breakeven' ? Math.max(0, Math.round(Number(form.depositValue) * 100) || 0) : null,
              depositRequired: form.depositType !== 'none',
              balanceMode: form.balanceMode,
            });
          }
        } catch { /* update path already includes these; this is a safety net */ }
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
      specialty: renter.specialty ?? '', notes: renter.notes ?? '',
      linkedStaffId: (renter as any).linkedStaffId ?? '',
      credentials: Array.isArray((renter as any).credentials)
        ? (renter as any).credentials.map((cr: any) => ({ label: cr.label || '', number: cr.number || '', expiry: cr.expiry || '' }))
        : [
            ...((renter as any).licenseExpiry || (renter as any).licenseNumber ? [{ label: 'Professional license', number: (renter as any).licenseNumber || '', expiry: (renter as any).licenseExpiry || '' }] : []),
            ...((renter as any).insuranceExpiry || (renter as any).insuranceCarrier ? [{ label: `Liability insurance${(renter as any).insuranceCarrier ? ` (${(renter as any).insuranceCarrier})` : ''}`, number: '', expiry: (renter as any).insuranceExpiry || '' }] : []),
          ] });
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
            credentials: renterForm.credentials.filter(cr => cr.label.trim()).map(cr => ({ label: cr.label.trim(), number: cr.number.trim(), expiry: cr.expiry || null })),
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
          credentials: renterForm.credentials.filter(cr => cr.label.trim()).map(cr => ({ label: cr.label.trim(), number: cr.number.trim(), expiry: cr.expiry || null })),
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
        leaseTerms: leaseForm.leaseTerms.trim() || null,
        requireSignature: leaseForm.requireSignature,
        status: leaseForm.requireSignature ? 'pending_signature' : undefined,
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
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.lease_ended', targetType: 'lease', targetId: lease.id,
        summary: `Lease ended: ${endLeaseTarget.firstName || ''} ${endLeaseTarget.lastName || ''}`.trim(),
        amount: (lease.rentAmountCents || 0) / 100, actor: { type: 'user' },
      });
    } catch {
      // v73 — the old version closed the dialog as if it succeeded.
      toast({ variant: 'destructive', title: 'End lease failed', description: 'The lease is still active — try again.' });
    } finally { setSavingEndLease(false); setEndLeaseTarget(null); }
  };

  const handleStatusChange = async () => {
    if (!statusTarget || !tenantId) return;
    setSavingStatus(true);
    try {
      // v73 — atomic: the old two-write version could leave a renter "on
      // leave" while the lease (and rent billing) stayed active.
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'renters', statusTarget.id),
        { status: newStatus, updatedAt: new Date().toISOString() });
      const lease = occupyingLeaseByRenter.get(statusTarget.id);
      if (lease && (newStatus === 'on_leave' || newStatus === 'maternity_leave')) {
        batch.update(doc(firestore, 'tenants', tenantId, 'leases', lease.id),
          { status: 'on_leave', updatedAt: new Date().toISOString() });
      }
      if (lease && newStatus === 'active') {
        batch.update(doc(firestore, 'tenants', tenantId, 'leases', lease.id),
          { status: 'active', updatedAt: new Date().toISOString() });
      }
      await batch.commit();
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.renter_status', targetType: 'renter', targetId: statusTarget.id,
        summary: `Renter status → ${newStatus}: ${statusTarget.firstName || ''} ${statusTarget.lastName || ''}`.trim() + (lease ? ' (lease updated with it)' : ''),
        actor: { type: 'user' },
      });
    } catch {
      toast({ variant: 'destructive', title: 'Status change failed', description: 'Nothing was changed — try again.' });
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


  const opsBadge = pendingApps.length + upcomingReservations.filter(r => r.status === 'confirmed' || r.status === 'checked_in').length;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50">
      <AppHeader title="Booths" />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* ── KPI HEADER STRIP ─────────────────────────────────────────── */}
      <div className="bg-white border-b px-4 sm:px-6 md:px-8 pt-5 pb-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 flex items-center gap-2.5 leading-none">
              <span className="h-9 w-9 rounded-2xl bg-slate-900 flex items-center justify-center shadow-md shadow-slate-900/10">
                <Armchair className="h-5 w-5 text-white" />
              </span>
              Spaces
            </h1>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mt-1.5 ml-0.5">
              {metrics.occupancyPct}% occupied · {metrics.activeRenters} active renter{metrics.activeRenters !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <LocationSwitcher />
            <Button size="sm" variant="outline" className="relative" onClick={() => setCommandCenterOpen(true)}>
              <ActivityIcon className="h-4 w-4" />
              {alertBadgeSeverity && (
                <span className={`absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-[9px] font-black text-white flex items-center justify-center ${alertBadgeSeverity === 'danger' ? 'bg-red-500' : alertBadgeSeverity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`}>
                  {alerts.length}
                </span>
              )}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Space
            </Button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Monthly revenue', value: formatCents(metrics.monthlyRevenue), sub: `${metrics.occupancyPct}% occupancy`, color: 'text-emerald-700' },
            { label: 'Occupied', value: `${metrics.occupied} / ${metrics.total}`, sub: 'spaces', color: 'text-slate-900' },
            { label: 'Vacant', value: String(metrics.vacant), sub: metrics.vacancyCost > 0 ? `${formatCents(metrics.vacancyCost)}/mo uncollected` : 'all leased', color: metrics.vacant > 0 ? 'text-amber-600' : 'text-slate-900' },
            { label: 'Potential', value: formatCents(metrics.potentialMonthly), sub: 'if fully leased', color: 'text-slate-500' },
          ].map(k => (
            <div key={k.label} className="rounded-xl border bg-white px-3.5 py-2.5 space-y-0.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
              <p className={`text-xl font-black tracking-tighter ${k.color}`}>{k.value}</p>
              <p className="text-[9px] font-bold text-muted-foreground">{k.sub}</p>
            </div>
          ))}
        </div>

        {/* Tab strip */}
        <div className="flex gap-0 border-b -mb-4">
          {([
            { id: 'spaces', label: 'Spaces', badge: null },
            { id: 'ops', label: 'Operations', badge: opsBadge > 0 ? opsBadge : null },
            { id: 'money', label: 'Money', badge: null },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-1.5
                ${tab === t.id ? 'text-slate-900 border-b-2 border-slate-900 -mb-px' : 'text-muted-foreground hover:text-slate-700'}`}
            >
              {t.label}
              {t.badge && (
                <span className="h-4 min-w-4 px-1 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── SPACES TAB ───────────────────────────────────────────────── */}
      {tab === 'spaces' && (
        <div className="px-4 sm:px-6 md:px-8 py-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1 p-1 bg-white rounded-xl border">
              <button onClick={() => setSpaceView('floor')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${spaceView === 'floor' ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:text-slate-700'}`}>
                <LayoutGrid className="h-3 w-3 inline mr-1" />Floor
              </button>
              <button onClick={() => setSpaceView('list')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${spaceView === 'list' ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:text-slate-700'}`}>
                <List className="h-3 w-3 inline mr-1" />List
              </button>
              <button onClick={() => setSpaceView('planner')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${spaceView === 'planner' ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:text-slate-700'}`}>
                <CalendarDays className="h-3 w-3 inline mr-1" />Planner
              </button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPricingOpen(true)}>
                <Calculator className="h-3.5 w-3.5 mr-1" />Pricing
              </Button>
              <Button size="sm" variant="outline" onClick={() => setKioskOpen(true)}>
                <MonitorSmartphone className="h-3.5 w-3.5 mr-1" />Kiosk
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAutoSettingsOpen(true)}>
                <Settings className="h-3.5 w-3.5 mr-1" />Automations
              </Button>
              {spaceView === 'floor' && !isMobile && (
                <>
                  <Button size="sm" variant="outline" onClick={autoArrangeBooths} disabled={layoutSaving}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />Arrange
                  </Button>
                  <Button size="sm" variant={locked ? 'default' : 'secondary'} onClick={() => setLocked(l => !l)}>
                    {locked ? <><Lock className="h-3.5 w-3.5 mr-1" />Locked</> : <><Unlock className="h-3.5 w-3.5 mr-1" />Editing</>}
                  </Button>
                </>
              )}
            </div>
          </div>

          {spaceView === 'floor' && (
            <div className="flex flex-wrap gap-3">
              {(Object.entries(BOOTH_STATUS_COLORS) as [Booth['status'], (typeof BOOTH_STATUS_COLORS)[Booth['status']]][]).map(([status, sc]) => (
                <span key={status} className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sc.bg, border: `1.5px solid ${sc.border}` }} />
                  {BOOTH_STATUS_LABELS[status]}
                </span>
              ))}
            </div>
          )}

          {booths.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading spaces…</div>
          ) : sortedBooths.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Armchair className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="font-medium text-muted-foreground">No spaces yet</p>
              <Button onClick={openCreate}>Add your first space</Button>
            </div>
          ) : spaceView === 'list' ? (
            <div className="space-y-3">
              {sortedBooths.map((booth: Booth) => {
                const sc = BOOTH_STATUS_COLORS[booth.status] ?? BOOTH_STATUS_COLORS.vacant;
                const lease = activeLeaseByBooth.get(booth.id);
                const renter = lease ? renterById.get(lease.renterId) : undefined;
                return (
                  <button key={booth.id} onClick={() => openEdit(booth)} className="w-full text-left rounded-2xl border-2 bg-white p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3">
                      <div className="self-stretch rounded-full shrink-0" style={{ background: sc.bg, border: `2px solid ${sc.border}`, minHeight: 40, width: 6 }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-black text-sm uppercase">{booth.name}</p>
                          <span className="text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 text-white" style={{ background: sc.border }}>{BOOTH_STATUS_LABELS[booth.status]}</span>
                          {booth.type && <span className="text-[9px] font-bold text-muted-foreground uppercase">{booth.type}</span>}
                        </div>
                        {renter && <p className="text-xs font-bold text-muted-foreground truncate">{renter.firstName} {renter.lastName}{renter.businessName ? ` · ${renter.businessName}` : ''}</p>}
                        {lease && <p className="text-[10px] font-bold text-muted-foreground">{formatCents(lease.rentAmountCents)}/{lease.frequency} · ends {lease.endDate || '—'}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        {booth.baseRentCents > 0 && <p className="font-black text-sm">{formatCents(booth.baseRentCents)}<span className="font-normal text-muted-foreground text-[10px]">/{booth.baseRentFrequency || 'mo'}</span></p>}
                        {Array.isArray(booth.amenities) && booth.amenities.length > 0 && <p className="text-[9px] font-bold text-muted-foreground">{booth.amenities.slice(0, 2).join(' · ')}</p>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : spaceView === 'planner' ? (
            /* ── BOOKING PLANNER: rows = spaces, columns = next 14 days.
                One glance answers "who is where, when, and what's open."
                Lease occupancy fills the row; day rentals overlay their
                exact dates; vacant days are tappable inventory. ── */
            (() => {
              const days: string[] = Array.from({ length: 14 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() + i);
                return localISO(d);
              });
              const dayLabel = (iso: string) => {
                const d = new Date(iso + 'T00:00:00');
                return { dow: d.toLocaleDateString('en-US', { weekday: 'short' }), num: d.getDate() };
              };
              const cellFor = (booth: Booth, iso: string): { kind: 'lease' | 'rental' | 'in' | 'issue' | 'open' | 'closed'; label?: string } => {
                if (booth.status === 'maintenance' || booth.status === 'inactive') return { kind: 'closed' };
                const lease = activeLeaseByBooth.get(booth.id);
                if (lease) {
                  const started = !lease.startDate || lease.startDate <= iso;
                  const notEnded = !lease.endDate || lease.endDate >= iso;
                  if (started && notEnded) {
                    const renter = renterById.get(lease.renterId);
                    return { kind: 'lease', label: renter ? renter.firstName : 'Leased' };
                  }
                }
                const dayRes = reservations.filter(r =>
                  r.boothId === booth.id && r.startDate <= iso && r.endDate >= iso &&
                  ['confirmed', 'checked_in', 'payment_received_conflict'].includes(r.status));
                if (dayRes.length > 0) {
                  const issue = dayRes.find(r => r.status === 'payment_received_conflict');
                  if (issue) return { kind: 'issue', label: issue.name };
                  const checkedIn = dayRes.find(r => r.status === 'checked_in');
                  if (checkedIn) return { kind: 'in', label: checkedIn.name };
                  const hourlies = dayRes.filter(r => r.bookingType === 'hourly');
                  if (hourlies.length > 1) return { kind: 'rental', label: `${hourlies.length}× hrly` };
                  const r0 = dayRes[0];
                  return { kind: 'rental', label: r0.bookingType === 'hourly' ? `${r0.startTime}` : r0.name };
                }
                // Availability engine: owner-declared schedule closes cells
                const schedDays = (booth as any).dayRentalDays;
                const blackouts = (booth as any).blackoutDates;
                const dow = new Date(iso + 'T00:00:00').getDay();
                if (Array.isArray(schedDays) && !schedDays.includes(dow)) return { kind: 'closed' };
                if (Array.isArray(blackouts) && blackouts.includes(iso)) return { kind: 'closed' };
                return { kind: 'open' };
              };
              const CELL_STYLE: Record<string, string> = {
                lease:  'bg-slate-800 text-white',
                rental: 'bg-emerald-500 text-white',
                in:     'bg-indigo-500 text-white',
                issue:  'bg-red-500 text-white',
                open:   'bg-white border border-slate-200 text-slate-300',
                closed: 'bg-slate-100 text-slate-300',
              };
              const monthLabel = new Date(days[0] + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-black tracking-tight">{monthLabel} · next 14 days</p>
                      <p className="text-[10px] font-bold text-muted-foreground">Each row is a space, each column a day. Colors say who's in; white dots are open to book.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[10px] font-bold text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-800" />Lease</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Day rental</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />Checked in</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />Conflict</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white border border-slate-300" />Open to book</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-100" />Not offered (— )</span>
                  </div>
                  {isMobile ? (
                    /* ── MOBILE PLANNER: pick a day, see every space ── */
                    <div className="space-y-3">
                      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                        {days.map(iso => {
                          const l = dayLabel(iso);
                          const isSel = iso === plannerDay;
                          const isToday = iso === days[0];
                          return (
                            <button key={iso} onClick={() => setPlannerDay(iso)}
                              className={`shrink-0 w-12 py-2 rounded-xl border-2 text-center transition-colors ${isSel ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200'}`}>
                              <p className={`text-[8px] font-black uppercase ${isSel ? 'text-white/60' : isToday ? 'text-amber-600' : 'text-muted-foreground'}`}>{isToday ? 'Today' : l.dow}</p>
                              <p className="text-sm font-black">{l.num}</p>
                            </button>
                          );
                        })}
                      </div>
                      <div className="space-y-2">
                        {sortedBooths.map((booth: Booth) => {
                          const cell = cellFor(booth, plannerDay);
                          return (
                            <div key={booth.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
                              <span className={`h-3 w-3 rounded-full shrink-0 ${
                                cell.kind === 'lease' ? 'bg-slate-800' : cell.kind === 'rental' ? 'bg-emerald-500'
                                : cell.kind === 'in' ? 'bg-indigo-500' : cell.kind === 'issue' ? 'bg-red-500'
                                : cell.kind === 'closed' ? 'bg-slate-200' : 'bg-white border-2 border-emerald-400'}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-black uppercase truncate">{booth.name}</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">{booth.type}</p>
                              </div>
                              <p className={`text-[10px] font-black uppercase shrink-0 ${
                                cell.kind === 'lease' ? 'text-slate-700' : cell.kind === 'rental' ? 'text-emerald-600'
                                : cell.kind === 'in' ? 'text-indigo-600' : cell.kind === 'issue' ? 'text-red-600'
                                : cell.kind === 'closed' ? 'text-slate-300' : 'text-emerald-600'}`}>
                                {cell.kind === 'open' ? 'Open' : cell.kind === 'closed' ? 'Not offered' : cell.kind === 'issue' ? `⚠ ${cell.label}` : cell.label || cell.kind}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                  <div className="overflow-x-auto rounded-2xl border-2 bg-white">
                    <table className="w-full border-collapse min-w-[720px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 bg-white text-left px-3 py-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground border-b-2 min-w-[110px]">Space</th>
                          {days.map(iso => {
                            const l = dayLabel(iso);
                            const isToday = iso === days[0];
                            return (
                              <th key={iso} className={`px-1 py-2 text-center border-b-2 min-w-[48px] ${isToday ? 'bg-amber-50' : ''}`}>
                                {isToday ? (
                                  <p className="text-[7px] font-black uppercase tracking-widest text-amber-600">Today</p>
                                ) : (
                                  <p className="text-[8px] font-black uppercase text-muted-foreground">{l.dow}</p>
                                )}
                                <p className={`text-sm font-black ${isToday ? 'text-amber-600' : 'text-slate-700'}`}>{l.num}</p>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBooths.map((booth: Booth) => (
                          <tr key={booth.id} className="border-b last:border-0">
                            <td className="sticky left-0 bg-white px-3 py-1.5 border-r">
                              <p className="text-[10px] font-black uppercase truncate max-w-[100px]">{booth.name}</p>
                              <p className="text-[8px] font-bold text-muted-foreground uppercase">{booth.type}</p>
                            </td>
                            {days.map(iso => {
                              const cell = cellFor(booth, iso);
                              return (
                                <td key={iso} className="p-0.5">
                                  <div
                                    className={`h-11 rounded-md flex flex-col items-center justify-center text-[8px] font-black uppercase overflow-hidden px-0.5 leading-tight ${CELL_STYLE[cell.kind]}`}
                                    title={cell.label ? `${cell.label} · ${iso}` : cell.kind === 'open' ? `Open · ${iso}` : cell.kind === 'closed' ? `Not offered · ${iso}` : iso}
                                  >
                                    <span className="truncate max-w-full">{cell.label ? cell.label.split(' ')[0].slice(0, 8) : cell.kind === 'open' ? '·' : cell.kind === 'closed' ? '—' : ''}</span>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                  <p className="text-[10px] font-bold text-muted-foreground">Open cells are bookable inventory — they're what the public pay-and-book flow offers. Conflicts always show red until refunded or rebooked.</p>
                </div>
              );
            })()
          ) : isMobile ? (
            <div className="grid grid-cols-2 gap-3">
              {sortedBooths.map((booth: Booth) => {
                const lease = activeLeaseByBooth.get(booth.id);
                const renter = lease ? renterById.get(lease.renterId) : undefined;
                const sc = BOOTH_STATUS_COLORS[booth.status] ?? BOOTH_STATUS_COLORS.vacant;
                return (
                  <button key={booth.id} onClick={() => setSelectedId(booth.id)} className="rounded-2xl border-2 p-3 text-left space-y-1 active:scale-[0.98] transition-transform" style={{ borderColor: sc.border, background: sc.bg }}>
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-black text-xs uppercase truncate">{booth.name}</p>
                      <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 text-white shrink-0" style={{ background: sc.border }}>{BOOTH_STATUS_LABELS[booth.status] ?? booth.status}</span>
                    </div>
                    {renter && <p className="text-[10px] font-bold truncate opacity-70">{renter.firstName} {renter.lastName}</p>}
                    {booth.baseRentCents > 0 && <p className="text-[10px] font-black">{formatCents(booth.baseRentCents)}<span className="font-normal opacity-50">/{booth.baseRentFrequency || 'mo'}</span></p>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="relative">
              {!locked && (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700 flex items-center gap-1.5">
                  <Unlock className="h-3 w-3 shrink-0" /> Drag booths to reposition, drag the corner to resize. Click a booth to select it.
                </div>
              )}
              <div className="h-[380px] sm:h-[500px] lg:h-[600px] overflow-auto rounded-xl border border-border bg-muted/30 touch-pan-x touch-pan-y">
                {floorEvents.length > 0 && (
                  <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0 flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
                      Live
                    </span>
                    {floorEvents.map((e, i) => (
                      <span key={i} className={`shrink-0 text-[10px] font-bold rounded-full px-2.5 py-1 border ${e.tone === 'in' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : e.tone === 'money' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                        {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {e.text}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className="relative"
                  style={{ width: CANVAS_W, height: CANVAS_H, backgroundImage: locked ? undefined : 'radial-gradient(circle, var(--border) 1px, transparent 1px)', backgroundSize: `${GRID}px ${GRID}px` }}
                  onClick={e => { if (e.target === e.currentTarget) setSelectedId(null); }}
                >
                  {sortedBooths.map((b: Booth) => {
                    const eb = effectiveBooth(b);
                    const lease = activeLeaseByBooth.get(b.id);
                    const renter = lease ? renterById.get(lease.renterId) : undefined;
                    return (
                      <BoothCanvasCard
                        key={b.id}
                        booth={eb}
                        renter={renter}
                        lease={lease}
                        liveRes={liveResByBooth.get(b.id)}
                        nowTick={nowTick}
                        selected={selectedId === b.id}
                        locked={locked}
                        onDragStart={handleDragStart}
                        onResizeStart={handleResizeStart}
                        onClick={setSelectedId}
                      />
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
                  onEdit={(booth) => openEdit(booth)}
                />
              )}
            </div>
          )}

          {/* Mobile: selected booth detail */}
          {isMobile && selectedBooth && (
            <DetailPanel
              booth={effectiveBooth(selectedBooth)}
              renter={selectedRenter}
              lease={selectedLease}
              onClose={() => setSelectedId(null)}
              onEdit={(booth) => openEdit(booth)}
            />
          )}
        </div>
      )}

      {/* ── OPERATIONS TAB ───────────────────────────────────────────── */}
      {tab === 'ops' && (
        <div className="px-4 sm:px-6 md:px-8 py-5 space-y-6">
          {/* Tour scorecard */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-widest">Tours</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={openTourSheets}
                  className="h-8 px-3 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                  title="Customize the visitor confirmation and staff prep sheet"
                >
                  <FileText className="h-3.5 w-3.5" /> Tour sheets
                </button>
                <button
                  onClick={openChargePolicy}
                  className="h-8 px-3 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                  title="Set the allowed incidental charges and their caps"
                >
                  <Shield className="h-3.5 w-3.5" /> Charge policy
                </button>
                <button
                  onClick={openNoShow}
                  className="h-8 px-3 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                  title="Set what happens when a reservation is a no-show"
                >
                  <XCircle className="h-3.5 w-3.5" /> No-shows
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Tours booked', value: String(tourKpis.total), sub: 'all time', color: 'text-slate-900' },
                { label: 'Show rate', value: `${tourKpis.showRate}%`, sub: `${tourKpis.noShow} no-show${tourKpis.noShow === 1 ? '' : 's'}`, color: tourKpis.showRate >= 70 ? 'text-emerald-700' : 'text-amber-600' },
                { label: 'Hot leads', value: String(tourKpis.hot), sub: 'from tours', color: 'text-red-600' },
                { label: 'Tour → rental', value: `${tourKpis.convRate}%`, sub: `${tourKpis.converted} converted`, color: 'text-slate-900' },
              ].map(k => (
                <div key={k.label} className="rounded-2xl border-2 bg-white px-4 py-3 space-y-0.5 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
                  <p className={`text-xl md:text-2xl font-black tracking-tighter ${k.color}`}>{k.value}</p>
                  <p className="text-[9px] font-bold text-muted-foreground">{k.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Follow-ups */}
          {openTasks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Follow-ups</h2>
                <span className="h-5 min-w-5 px-1.5 bg-indigo-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{openTasks.length}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {openTasks.map((t: any) => (
                  <div key={t.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black truncate">{t.title}</p>
                      <p className="text-[10px] font-bold text-muted-foreground truncate">{[t.contactPhone, t.contactEmail].filter(Boolean).join(' · ') || 'No contact on file'}</p>
                    </div>
                    {t.contactPhone && <a href={`sms:${t.contactPhone}`} className="h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center">Text</a>}
                    {!t.contactPhone && t.contactEmail && <a href={`mailto:${t.contactEmail}`} className="h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center">Email</a>}
                    <button onClick={() => updateDoc(doc(firestore, 'tenants', tenantId, 'tasks', t.id), { done: true, doneAt: new Date().toISOString() })} className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">Done</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Applications */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Applications</h2>
                {pendingApps.length > 0 && <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{pendingApps.length}</span>}
              </div>
              <Button size="sm" variant="outline" onClick={openCreateRenter}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add renter
              </Button>
            </div>
            {pendingApps.length === 0 ? (
              <p className="text-xs text-muted-foreground font-medium py-3">No pending applications — new inquiries from the website appear here live.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {pendingApps.map((app: any) => (
                  <div key={app.id} className={`rounded-2xl border-2 p-4 space-y-3 ${app.status === 'in_review' ? 'border-sky-200 bg-sky-50/40' : 'border-amber-300 bg-amber-50/50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-black text-sm uppercase truncate">{app.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">
                          {app.kind === 'tour' ? '🗓 Tour request' : app.kind === 'question' ? '💬 Question' : app.kind === 'waitlist' ? '⏳ Waitlist' : app.rentalType === 'lease' ? 'Monthly lease' : 'Hourly / daily'}
                          {' · '}{app.boothName || 'Any booth'}{app.specialty ? ` · ${app.specialty}` : ''}
                        </p>
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 shrink-0 ${app.status === 'in_review' ? 'bg-sky-200 text-sky-800' : 'bg-amber-200 text-amber-800'}`}>
                        {app.status === 'in_review' ? 'Contacted' : 'New'}
                      </span>
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
                    <button onClick={() => setViewingApp(app)} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2 text-left">
                      View full application →
                    </button>
                    <div className="flex gap-2 pt-1">
                      {(!app.kind || app.kind === 'application') ? (
                        <button onClick={() => approveApplication(app)} disabled={decidingAppId === app.id} className="flex-1 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                          {decidingAppId === app.id ? 'Working…' : app.rentalType === 'lease' ? 'Approve → Create Renter' : 'Approve'}
                        </button>
                      ) : (
                        <button onClick={() => setAppStatus(app, 'closed')} className="flex-1 h-9 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">{app.kind === 'tour' ? 'Mark Toured' : app.kind === 'question' ? 'Mark Answered' : app.kind === 'waitlist' ? 'Remove' : 'Close Out'}</button>
                      )}
                      {app.kind === 'tour' && <button onClick={() => setManagingTour(app)} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-indigo-700 border-indigo-300">Manage Tour</button>}
                      {app.status === 'new' && app.kind !== 'tour' && <button onClick={() => setAppStatus(app, 'in_review')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-sky-700 border-sky-300">Contacted</button>}
                      {(!app.kind || app.kind === 'application') && <button onClick={() => { setAppStatus(app, 'declined'); openDecisionEmail(app, 'declined'); }} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Decline</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Day rentals */}
          {/* ── Tours (v88) ── */}
          {upcomingTours.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Tours</h2>
                <span className="h-5 min-w-5 px-1.5 bg-sky-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">{upcomingTours.length}</span>
                {upcomingTours.some(t => t.status === 'requested') && <span className="text-[10px] font-black uppercase text-amber-600">· some need your OK</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {upcomingTours.map((t: any) => (
                  <div key={t.id} className={`rounded-xl border-2 bg-white px-3.5 py-2.5 space-y-1.5 ${t.status === 'requested' ? 'border-amber-300 bg-amber-50/40' : 'border-sky-200'}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate">{t.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{t.date} · {t12tour(t.time)} · {t.durationMins || 30} min</p>
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 shrink-0 ${t.status === 'confirmed' ? 'bg-sky-200 text-sky-800' : 'bg-amber-200 text-amber-800'}`}>{t.status === 'confirmed' ? 'Confirmed' : 'Requested'}</span>
                      {t.phone && <a href={`tel:${t.phone}`} className="text-[9px] font-black uppercase text-indigo-600 shrink-0">Call</a>}
                    </div>
                    {t.message && <p className="text-[10px] text-slate-600 italic line-clamp-2">"{t.message}"</p>}
                    <div className="flex gap-2">
                      {t.status === 'requested' && <button onClick={() => setTourStatus(t, 'confirmed')} className="flex-1 h-7 rounded-lg bg-sky-600 text-white font-black uppercase text-[9px] tracking-widest">Confirm</button>}
                      {t.status === 'confirmed' && <button onClick={() => setTourStatus(t, 'completed')} className="flex-1 h-7 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">Mark done</button>}
                      <button onClick={() => setTourStatus(t, 'cancelled')} className="h-7 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {upcomingReservations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Day Rentals</h2>
                <span className="h-5 min-w-5 px-1.5 bg-emerald-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">{upcomingReservations.length}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {upcomingReservations.map((r: any) => (
                  <div key={r.id} className={`rounded-2xl border-2 px-4 py-3 space-y-2 ${r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending' ? 'border-red-300 bg-red-50' : r.status === 'cancel_requested' ? 'border-amber-300 bg-amber-50' : r.status === 'checked_in' ? 'border-indigo-300 bg-indigo-50/50' : 'border-emerald-200 bg-emerald-50/40'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm truncate">{r.name} <span className="font-bold text-muted-foreground normal-case text-xs">· {r.boothName}</span></p>
                        <p className="text-[10px] font-bold text-slate-600 uppercase">{r.bookingType === 'hourly' ? `${r.startDate} · ${r.startTime}–${r.endTime}` : `${r.startDate} → ${r.endDate}`} · ${((r.amountCents || 0) / 100).toFixed(2)} paid{r.consentAccepted ? ' · ✓' : ''}</p>
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 shrink-0 ${r.status === 'checked_in' ? 'bg-indigo-200 text-indigo-800' : r.status === 'confirmed' ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                        {r.status === 'checked_in' ? 'In' : r.status === 'confirmed' ? 'Upcoming' : 'Issue'}
                      </span>
                      {r.phone && <a href={`tel:${r.phone}`} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2 shrink-0">Call</a>}
                    </div>
                    {(r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending') && (
                      <p className="text-[10px] font-black uppercase text-red-600">⚠ Refund needed · {r.stripePaymentIntentId || ''}</p>
                    )}
                    {r.status === 'cancel_requested' && (
                      <p className="text-[10px] font-black uppercase text-amber-700">🚫 Guest requested cancellation{r.cancelReason ? ` · "${r.cancelReason}"` : ''}</p>
                    )}
                    {r.noShow && (
                      <p className="text-[10px] font-black uppercase text-red-600">👻 No-show — never checked in</p>
                    )}
                    {(r.licenseNumber || r.insuranceConfirmed || r.idAcknowledged || r.doingServices || r.licenseDocUrl || r.insuranceDocUrl || r.idDocUrl) && (
                      <div className="text-[10px] font-black uppercase text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {r.doingServices && <span>✂ Services</span>}
                        {r.licenseNumber && <span>· Lic {r.licenseNumber}</span>}
                        {r.licenseDocUrl && <a href={r.licenseDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">· 📄 License</a>}
                        {(r.insuranceConfirmed || r.insuranceDocUrl) && <span>· ✓ Insured</span>}
                        {r.insuranceDocUrl && <a href={r.insuranceDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">📄 COI</a>}
                        {r.idDocUrl ? <a href={r.idDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">· 📄 ID</a> : r.idAcknowledged && <span>· ✓ ID</span>}
                      </div>
                    )}
                    {r.balanceDueCents > 0 && !r.balancePaid && (
                      <p className="text-[10px] font-black uppercase text-amber-600">
                        💰 Deposit ${((r.depositCents || 0) / 100).toFixed(0)} paid · balance ${((r.balanceDueCents || 0) / 100).toFixed(2)} {r.balanceMode === 'at_checkin' ? 'at check-in' : 'due in person'}
                      </p>
                    )}
                    {r.status === 'checked_in' && r.actualCheckIn && (
                      <p className="text-[10px] font-black uppercase text-indigo-700">
                        ⏱ In since {new Date(r.actualCheckIn).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {r.bookingType === 'hourly' && r.endTime ? ` · booked until ${r.endTime}` : ''}
                      </p>
                    )}
                    {r.overageStatus === 'due' && (
                      <p className="text-[10px] font-black uppercase text-red-600">⏱ Ran {r.overageMinutes} min over · ${((r.overageDueCents || 0) / 100).toFixed(2)} due</p>
                    )}
                    {r.creditDecision === 'pending' && r.potentialCreditCents > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1.5">
                        <p className="text-[10px] font-black uppercase text-emerald-700">Left {r.unusedMinutes} min early — issue ${(r.potentialCreditCents / 100).toFixed(2)} credit toward their next booking?</p>
                        <div className="flex gap-2">
                          <button onClick={() => issueCredit(r)} className="flex-1 h-7 rounded-lg bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Issue Credit</button>
                          <button onClick={() => declineCredit(r)} className="h-7 px-3 rounded-lg border font-black uppercase text-[9px] tracking-widest text-slate-500">No Credit</button>
                        </div>
                      </div>
                    )}
                    {r.creditDecision === 'issued' && r.creditIssuedCents > 0 && (
                      <p className="text-[10px] font-black uppercase text-emerald-600">✓ ${(r.creditIssuedCents / 100).toFixed(2)} credit issued — auto-applies to their next booking</p>
                    )}
                    {r.rescheduleRequestedAt && r.status === 'confirmed' && (
                      <p className="text-[10px] font-black uppercase text-indigo-600">⏱ Renter asked to reschedule{r.rescheduleRequestNote ? ` — “${r.rescheduleRequestNote}”` : ''}</p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      {r.status === 'confirmed' && <button onClick={() => checkInRes(r)} className="flex-1 h-8 rounded-lg bg-indigo-600 text-white font-black uppercase text-[9px] tracking-widest">Check In</button>}
                      {r.status === 'checked_in' && <button onClick={() => checkOutRes(r)} className="flex-1 h-8 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">Check Out</button>}
                      {r.overageStatus === 'due' && r.cardOnFile && (
                        <button onClick={() => chargeOverageToCard(r)} disabled={chargingId === r.id} className="flex-1 h-8 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                          {chargingId === r.id ? 'Charging…' : `Charge Card $${((r.overageDueCents || 0) / 100).toFixed(2)}`}
                        </button>
                      )}
                      {r.overageStatus === 'due' && <button onClick={() => markOverageCollected(r)} className={`${r.cardOnFile ? 'h-8 px-3 border-2 text-red-600 border-red-300' : 'flex-1 h-8 bg-red-600 text-white'} rounded-lg font-black uppercase text-[9px] tracking-widest`}>{r.cardOnFile ? 'Paid in person' : `Collect $${((r.overageDueCents || 0) / 100).toFixed(2)} → Ledger`}</button>}
                      {r.status === 'confirmed' && <button onClick={() => openReschedule(r)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-indigo-600 border-indigo-300">Reschedule</button>}
                      {r.status === 'confirmed' && <button onClick={() => setResStatus(r, 'cancelled_refund_pending')} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-red-600 border-red-300">Cancel</button>}
                      {r.status === 'cancel_requested' && <button onClick={() => refundReservation(r)} disabled={refundingId === r.id} className="flex-1 h-8 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-50">{refundingId === r.id ? 'Refunding…' : 'Approve → Refund Card'}</button>}
                      {r.status === 'cancel_requested' && <button onClick={() => setResStatus(r, 'confirmed')} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600">Decline</button>}
                      <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">📄 Receipt</a>
                      {r.cardOnFile && !['cancel_requested', 'cancelled_refund_pending', 'payment_received_conflict'].includes(r.status) && (
                        <button onClick={() => { setIncidentalForId(incidentalForId === r.id ? null : r.id); setIncidentalAmt(''); setIncidentalDesc(''); setIncidentalCat(''); }} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 border-slate-300">＋ Incidental</button>
                      )}
                      {(r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending') && <button onClick={() => refundReservation(r)} disabled={refundingId === r.id} className="flex-1 h-8 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-red-600 border-red-300 disabled:opacity-50">{refundingId === r.id ? 'Refunding…' : 'Refund via Stripe'}</button>}
                    </div>
                    {incidentalForId === r.id && (() => {
                      const sel = incidentalPolicy.find((c: any) => c.label === incidentalCat) || null;
                      const capCents = sel ? Math.round(Number(sel.capCents) || 0) : 0;
                      const overCap = capCents > 0 && Math.round(parseFloat(incidentalAmt) * 100) > capCents;
                      return (
                        <div className="mt-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-2.5 space-y-2">
                          <select value={incidentalCat} onChange={e => setIncidentalCat(e.target.value)} className="w-full h-9 rounded-lg border-2 px-2 text-xs font-black uppercase bg-white">
                            <option value="">Select a charge type…</option>
                            {incidentalPolicy.map((c: any) => <option key={c.label} value={c.label}>{c.label}{c.capCents ? ` — up to $${(c.capCents / 100).toFixed(0)}` : ''}</option>)}
                          </select>
                          <div className="flex gap-2">
                            <input type="number" inputMode="decimal" placeholder="$" value={incidentalAmt} onChange={e => setIncidentalAmt(e.target.value)} className={`w-20 h-9 rounded-lg border-2 px-2.5 text-sm font-bold ${overCap ? 'border-red-400' : ''}`} />
                            <input type="text" placeholder="Note (optional)" value={incidentalDesc} onChange={e => setIncidentalDesc(e.target.value)} className="flex-1 h-9 rounded-lg border-2 px-3 text-sm font-medium" />
                          </div>
                          {overCap && sel && <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Over the ${(capCents / 100).toFixed(0)} cap for {sel.label}</p>}
                          <button onClick={() => chargeIncidentalToCard(r)} disabled={!incidentalCat || !(parseFloat(incidentalAmt) > 0) || overCap || incidentalBusyId === r.id} className="w-full h-9 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                            {incidentalBusyId === r.id ? 'Charging…' : `Charge card${parseFloat(incidentalAmt) > 0 ? ` $${parseFloat(incidentalAmt).toFixed(2)}` : ''}`}
                          </button>
                          <p className="text-[9px] font-bold text-muted-foreground">Only your policy's charge types, each capped — no made-up charges. Records under “Renter Incidental” in the ledger.</p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Guest book: every day/hourly guest who has ever paid ── */}
          {guestBook.length > 0 && (
            <div className="space-y-3">
              <button onClick={() => setGuestBookOpen(o => !o)} className="flex items-center gap-2 w-full text-left">
                <h2 className="text-xs font-black uppercase tracking-widest">Contacts</h2>
                <span className="h-5 min-w-5 px-1.5 bg-slate-700 text-white text-[9px] font-black rounded-full flex items-center justify-center">{guestBook.length}</span>
                <span className="text-[10px] font-bold text-muted-foreground">everyone who's touched your business · tap to {guestBookOpen ? 'hide' : 'show'}</span>
              </button>
              {guestBookOpen && (
                <div className="grid gap-2 md:grid-cols-2">
                  {guestBook.map((g: any) => (
                    <div key={g.key} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
                      <button onClick={() => {
                        if (g.isRenter && g.renterId) { const rt = renterById.get(g.renterId); if (rt) { setProfileRenter(rt); return; } }
                        setProfileContact(g);
                      }} className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0 active:scale-95 transition-transform">
                        {g.name.charAt(0).toUpperCase()}
                      </button>
                      <button onClick={() => {
                        if (g.isRenter && g.renterId) { const rt = renterById.get(g.renterId); if (rt) { setProfileRenter(rt); return; } }
                        setProfileContact(g);
                      }} className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-black truncate">{g.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(() => {
                            const S: Record<string, string> = { inquiry: 'bg-slate-100 text-slate-500', tour: 'bg-sky-100 text-sky-700', applicant: 'bg-violet-100 text-violet-700', guest: 'bg-emerald-100 text-emerald-700', renter: 'bg-slate-900 text-white', repeat: 'bg-amber-100 text-amber-700' };
                            const L: Record<string, string> = { inquiry: 'Inquiry', tour: 'Toured', applicant: 'Applicant', guest: 'Guest', renter: 'Renter', repeat: 'Regular' };
                            return <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 ${S[g.stage] || S.inquiry}`}>{L[g.stage] || 'Contact'}</span>;
                          })()}
                          {g.lastRating && <span className="text-amber-500 text-[9px]">{'★'.repeat(g.lastRating)}</span>}
                        </div>
                        <p className="text-[10px] font-bold text-muted-foreground truncate">
                          {g.isRenter
                            ? `Renter · $${(((g.monthlyRentCents || 0) / 100)).toFixed(0)}/mo${g.visits ? ` · +${g.visits} booking${g.visits === 1 ? '' : 's'}` : ''} · $${((g.totalCents / 100)).toFixed(0)} in bookings`
                            : g.stage === 'inquiry' || g.stage === 'tour' || g.stage === 'applicant'
                              ? `${g.stage === 'tour' ? 'Toured' : g.stage === 'applicant' ? 'Applied' : 'Inquired'}${g.lastDate ? ` · ${g.lastDate}` : ''} · not yet booked`
                              : `${g.visits} visit${g.visits === 1 ? '' : 's'} · $${(g.totalCents / 100).toFixed(0)} lifetime · last ${g.lastDate}`}
                        </p>
                      </button>
                      <div className="flex gap-1.5 shrink-0">
                        {g.phone && <a href={`tel:${g.phone}`} className="h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center">Call</a>}
                        {g.phone && <a href={`sms:${g.phone}`} className="h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center">Text</a>}
                        {!g.phone && g.email && <a href={`mailto:${g.email}`} className="h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center">Email</a>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Renters */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-widest">Renters</h2>
              {sortedRenters.length > 0 && <span className="text-[10px] font-bold text-muted-foreground">{sortedRenters.length}</span>}
            </div>
            {renters.isLoading ? (
              <p className="text-xs text-muted-foreground py-3">Loading renters…</p>
            ) : sortedRenters.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No renters yet. Approve an application or add one manually.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {sortedRenters.map((renter: Renter) => {
                  const lease = occupyingLeaseByRenter.get(renter.id);
                  const booth = lease ? boothById.get(lease.boothId) : undefined;
                  return (
                    <div key={renter.id} className="rounded-2xl border-2 bg-white p-4 space-y-2">
                      <div className="flex items-start gap-3">
                        <button onClick={() => setProfileRenter(renter)} className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-sm shrink-0 active:scale-95 transition-transform">
                          {(renter.firstName || '?').charAt(0).toUpperCase()}
                        </button>
                        <button onClick={() => setProfileRenter(renter)} className="flex-1 min-w-0 text-left">
                          <p className="font-black text-sm underline-offset-2 hover:underline">{renter.firstName} {renter.lastName}</p>
                          {renter.businessName && <p className="text-[10px] font-bold text-muted-foreground truncate">{renter.businessName}</p>}
                          <div className="flex gap-1.5 flex-wrap mt-1">
                            <Badge className="text-[9px]">{RENTER_STATUS_LABELS[renter.status] ?? renter.status ?? 'Unknown'}</Badge>
                            {(renter as any).linkedStaffId && <span className="text-[9px] font-black uppercase tracking-widest text-violet-600">Hybrid</span>}
                            {(() => { const w = complianceOf(renter as any).worst; return w === 'expired' ? <span className="text-[9px] font-black uppercase tracking-widest text-red-600">🔴 Compliance</span> : w === 'expiring' ? <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">⚠ Compliance</span> : null; })()}
                          </div>
                        </button>
                        <div className="flex gap-2 shrink-0 items-center">
                          {renter.email && <a href={`mailto:${renter.email}`} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2">Email</a>}
                          {renter.phone && <a href={`tel:${renter.phone}`} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2">Call</a>}
                          <button onClick={() => openEditRenter(renter)} className="h-8 w-8 rounded-lg border flex items-center justify-center text-slate-500 hover:text-slate-900"><Pencil className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      {lease && booth && (
                        <div className="rounded-xl bg-slate-50 border px-3 py-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-black uppercase">{booth.name}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{formatCents(lease.rentAmountCents)}/{lease.frequency} · ends {lease.endDate || '—'}</p>
                          </div>
                          <button onClick={() => setEndLeaseTarget(renter)} className="text-[9px] font-black uppercase tracking-widest text-red-500 underline underline-offset-2 shrink-0">End lease</button>
                        </div>
                      )}
                      {!lease && (renter.status === 'active' || renter.status === 'prospective') && (
                        <button onClick={() => openLeaseWizard(renter.id)} className="w-full h-8 rounded-xl border-2 border-dashed text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:border-slate-400 hover:text-slate-700 transition-colors">
                          + Assign booth
                        </button>
                      )}
                      <div className="flex items-center gap-3 pt-0.5 flex-wrap">
                        <button onClick={() => { setStatusTarget(renter); setNewStatus(renter.status === 'active' ? 'on_leave' : 'active'); }} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 underline underline-offset-2">
                          Status
                        </button>
                        {[new Date().getFullYear(), new Date().getFullYear()-1].map(yr => (
                          <a key={yr} href={`/api/booths/statement?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renter.id)}&year=${yr}`} target="_blank" rel="noreferrer"
                            className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 underline underline-offset-2">
                            {yr} statement
                          </a>
                        ))}
                        {w9Map[renter.id] ? (
                          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">✓ W-9 on file</span>
                        ) : w9Map[renter.id] === null ? (
                          <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">⚠ W-9 missing</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MONEY TAB ────────────────────────────────────────────────── */}
      {tab === 'money' && (
        <div className="px-4 sm:px-6 md:px-8 py-5 space-y-4">
          {/* ── RENT ROLL (v78): every active lease, collection status ── */}
          {rentRoll.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Rent roll</h2>
                {rentRoll.some(r => r.owedCents > 0) && (
                  <span className="h-5 px-2 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center">
                    ${(rentRoll.reduce((s, r) => s + r.owedCents, 0) / 100).toFixed(0)} outstanding
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {rentRoll.map(({ lease: l, renter: rt, booth: bt, open, owedCents, lastPaid }) => (
                  <div key={l.id} className={`rounded-xl border-2 bg-white px-4 py-3 flex items-center gap-3 flex-wrap ${open?.status === 'late' ? 'border-red-300' : open ? 'border-amber-300' : ''}`}>
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-xs font-black truncate">{rt ? `${rt.firstName} ${rt.lastName}` : 'Renter'} · {bt?.name || '—'}</p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">
                        {formatCents(l.rentAmountCents)}/{l.frequency}
                        {l.autoCollect ? ` · auto on day ${l.dueDay ?? '1'}` : ''}
                        {lastPaid ? ` · last paid ${lastPaid.dueDate}` : ''}
                      </p>
                    </div>
                    {l.status === 'pending_signature' ? (
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 shrink-0">✍️ Awaiting signature</span>
                    ) : open ? (
                      <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${open.status === 'late' ? 'text-red-600' : 'text-amber-600'}`}>
                        {open.status === 'late' ? `🔴 Late · $${(owedCents / 100).toFixed(2)} owed` : `⏳ Due ${open.dueDate}`}
                      </span>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 shrink-0">✓ Current</span>
                    )}
                    {open && l.status !== 'pending_signature' && (
                      <button onClick={() => openRecordPay('rent', { lease: l, renter: rt, booth: bt, open, owedCents })}
                        className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest shrink-0 active:scale-95 transition-all">
                        Record payment
                      </button>
                    )}
                    {(l as any).deposit?.amountCents > 0 && !(l as any).deposit?.collectedLedgerEntryId && (
                      <button onClick={() => openRecordPay('deposit', { lease: l, renter: rt, booth: bt })}
                        title="Security deposit hasn't been collected yet"
                        className="h-8 px-3 rounded-lg border-2 border-violet-300 text-violet-700 text-[9px] font-black uppercase tracking-widest shrink-0 active:scale-95 transition-all">
                        Deposit due · {formatCents((l as any).deposit.amountCents)}
                      </button>
                    )}
                    {l.endDate && Math.ceil((new Date(l.endDate + 'T00:00:00').getTime() - Date.now()) / 86400000) <= 30 && (
                      <button onClick={() => renewLease(l)}
                        title={`Lease ends ${l.endDate} — extend by one full term`}
                        className="h-8 px-3 rounded-lg border-2 border-indigo-300 text-indigo-700 text-[9px] font-black uppercase tracking-widest shrink-0 active:scale-95 transition-all">
                        Renew lease
                      </button>
                    )}
                    <button onClick={() => toggleAutoCollect(l)}
                      className={`h-8 px-3 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 transition-colors ${l.autoCollect ? 'bg-slate-900 text-white' : 'border-2 border-slate-200 text-slate-500'}`}>
                      {l.autoCollect ? 'Auto-collect ON' : 'Auto-collect OFF'}
                    </button>
                    {(rt as any)?.cardOnFile ? (
                      <span className="text-[9px] font-black uppercase text-emerald-600 shrink-0">💳 Card ✓</span>
                    ) : (
                      <span className="text-[9px] font-black uppercase text-amber-600 shrink-0" title="Renter adds a card in their portal Documents tab">No card</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-bold text-muted-foreground">Auto-collect charges the card on file on each due date (8 AM ET). Grace 3 days → late fee + retry → final retry day 7. Renters without a card get a due notification instead.</p>
            </div>
          )}

          {/* ── Reviews (v83) ── */}
          {reviewStats && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-widest">Reviews</h2>
                <span className="text-amber-500 text-sm font-black">★ {reviewStats.avg.toFixed(1)}</span>
                <span className="text-[10px] font-bold text-muted-foreground">{reviewStats.count} rating{reviewStats.count === 1 ? '' : 's'}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {reviews.slice(0, 6).map((r: any) => (
                  <div key={r.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-amber-500 text-xs">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                      <span className="text-[9px] font-bold text-muted-foreground uppercase">{r.boothName} · {String(r.reviewedAt || '').slice(0, 10)}</span>
                    </div>
                    <p className="text-xs font-black truncate">{(r.name || 'Guest').split(' ')[0]}</p>
                    {r.reviewText && <p className="text-[11px] text-slate-600 italic leading-relaxed">"{r.reviewText}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border-2 bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Booth income · all time</p>
              <p className="text-3xl font-black tracking-tighter mt-0.5">${(txnTotalCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <CircleDollarSign className="h-8 w-8 text-white/20" />
          </div>

          {/* Year-end W-9 compliance */}
          {sortedRenters.length > 0 && (
            <div className="rounded-2xl border-2 bg-white p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest">Year-end compliance</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-center">
                  <p className="text-2xl font-black text-emerald-700">{Object.values(w9Map).filter(Boolean).length}</p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">W-9 on file</p>
                </div>
                <div className={`rounded-xl px-3 py-2 text-center border ${Object.values(w9Map).filter(v => v === null).length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <p className={`text-2xl font-black ${Object.values(w9Map).filter(v => v === null).length > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{Object.values(w9Map).filter(v => v === null).length}</p>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${Object.values(w9Map).filter(v => v === null).length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>W-9 missing</p>
                </div>
              </div>
              {Object.values(w9Map).filter(v => v === null).length > 0 && (
                <p className="text-[10px] font-bold text-amber-700">Renters missing a W-9 show ⚠ on their cards in Operations — they can complete it in their portal's Documents tab.</p>
              )}
            </div>
          )}

          {sortedTxns.length === 0 ? (
            <p className="text-sm text-muted-foreground font-medium text-center py-8">No booth transactions yet — rent payments and paid day rentals appear here.</p>
          ) : (
            <div className="space-y-2">
              {sortedTxns.map((t: any) => (
                <div key={t.id} className="rounded-xl border-2 bg-white px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{txnDesc(t)}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{txnDateStr(t)}{t.paymentMethod ? ` · ${t.paymentMethod}` : ''}{t.clientOrVendor ? ` · ${t.clientOrVendor}` : ''}</p>
                  </div>
                  <p className="font-black text-emerald-700 shrink-0 mr-2">${txnDollars(t).toFixed(2)}</p>
                  <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=ledger&id=${encodeURIComponent(t.id)}`} target="_blank" rel="noreferrer" className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 underline underline-offset-2 shrink-0">PDF</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <Armchair className="h-5 w-5 text-slate-500" />
              {editingId ? 'Edit space' : 'Add space'}
            </DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Name it the way your renters know it
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

            <div className="space-y-1">
              <Label>Photos</Label>
              {form.photoUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {form.photoUrls.map((url, i) => (
                    <div key={url} className="relative rounded-lg overflow-hidden border aspect-square">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setForm(prev => ({ ...prev, photoUrls: prev.photoUrls.filter((_, j) => j !== i) }))}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              )}
              <ImageUpload multiple clearOnUpload enableMarkup={false} storageFolder="uploads"
                onImageUploaded={(url) => { if (url) setForm(prev => ({ ...prev, photoUrls: [...prev.photoUrls, url] })); }} />
            </div>

            <div className="space-y-1">
              <Label>Listing description (public)</Label>
              <Textarea rows={4} placeholder="Sell the space — light, equipment, vibe, what's included..."
                value={form.listingDescription}
                onChange={(e) => setForm(prev => ({ ...prev, listingDescription: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Video tour URL (YouTube, Vimeo, or direct .mp4)</Label>
              <Input placeholder="https://youtube.com/watch?v=..."
                value={form.videoUrl}
                onChange={(e) => setForm(prev => ({ ...prev, videoUrl: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Day-rental availability</Label>
              <p className="text-[10px] font-bold text-muted-foreground -mt-1">Which days can this space be booked for day rentals? Leases are unaffected.</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm(prev => ({
                      ...prev,
                      dayRentalDays: prev.dayRentalDays.includes(value)
                        ? prev.dayRentalDays.filter(d => d !== value)
                        : [...prev.dayRentalDays, value],
                    }))}
                    className={`h-9 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${form.dayRentalDays.includes(value) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-400'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.dayRentalDays.length === 0 && <p className="text-[10px] font-black uppercase text-amber-600">⚠ No days selected — this space won't be bookable for day rentals at all.</p>}
            </div>

            <div className="space-y-1">
              <Label>Blackout dates</Label>
              <Textarea rows={2} placeholder="2026-08-15, 2026-12-25 — closed dates, comma or newline separated"
                value={form.blackoutDatesText}
                onChange={(e) => setForm(prev => ({ ...prev, blackoutDatesText: e.target.value }))} />
              <p className="text-[10px] font-bold text-muted-foreground">Format YYYY-MM-DD. These dates show closed in the planner and can't be booked.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Shape on the floor plan</Label>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['rect', '▭ Booth / suite'],
                  ['square', '◻ Square table'],
                  ['round', '● Round table'],
                  ['oval', '⬭ Oval table'],
                  ['chair', '🪑 Styling chair'],
                  ['pedicure', '💺 Pedicure station'],
                  ['sink', '🚿 Shampoo / sink'],
                  ['dryer', '💨 Drying station'],
                  ['desk', '🛎 Reception desk'],
                  ['wall', '▬ Wall / divider'],
                  ['door', '🚪 Door / entry'],
                  ['plant', '🪴 Décor'],
                ] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setForm(prev => ({ ...prev, shape: v }))}
                    className={`h-9 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${form.shape === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <p className="text-[10px] font-bold text-muted-foreground">Purely visual — changes how this space draws on the floor plan.</p>
            </div>

            <div className="space-y-2">
              <Label>Booking slots (pre-set time products)</Label>
              <p className="text-[10px] font-bold text-muted-foreground -mt-1">Define the exact packages guests can buy — half days, evenings, full days. When slots exist, guests pick from these instead of free times: you stay in control.</p>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => setForm(prev => ({ ...prev, bookingSlots: [
                  { label: 'Morning half-day', start: '09:00', end: '13:00', dollars: '' },
                  { label: 'Afternoon half-day', start: '13:00', end: '17:00', dollars: '' },
                ] }))}>AM / PM halves</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setForm(prev => ({ ...prev, bookingSlots: [
                  { label: 'Full day', start: '09:00', end: '19:00', dollars: '' },
                ] }))}>Full day</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setForm(prev => ({ ...prev, bookingSlots: [
                  { label: 'Morning', start: '09:00', end: '13:00', dollars: '' },
                  { label: 'Afternoon', start: '13:00', end: '17:00', dollars: '' },
                  { label: 'Evening', start: '17:00', end: '21:00', dollars: '' },
                ] }))}>Thirds</Button>
              </div>
              {form.bookingSlots.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_82px_82px_72px_32px] gap-1.5 items-center">
                  <Input placeholder="Label" value={s.label} onChange={(e) => setForm(prev => ({ ...prev, bookingSlots: prev.bookingSlots.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                  <Input type="time" value={s.start} onChange={(e) => setForm(prev => ({ ...prev, bookingSlots: prev.bookingSlots.map((x, j) => j === i ? { ...x, start: e.target.value } : x) }))} />
                  <Input type="time" value={s.end} onChange={(e) => setForm(prev => ({ ...prev, bookingSlots: prev.bookingSlots.map((x, j) => j === i ? { ...x, end: e.target.value } : x) }))} />
                  <Input type="number" placeholder="$" value={s.dollars} onChange={(e) => setForm(prev => ({ ...prev, bookingSlots: prev.bookingSlots.map((x, j) => j === i ? { ...x, dollars: e.target.value } : x) }))} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm(prev => ({ ...prev, bookingSlots: prev.bookingSlots.filter((_, j) => j !== i) }))}>×</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setForm(prev => ({ ...prev, bookingSlots: [...prev.bookingSlots, { label: '', start: '09:00', end: '13:00', dollars: '' }] }))}>+ Add slot</Button>
            </div>

            <div className="space-y-1">
              <Label>Hourly booking window</Label>
              <p className="text-[10px] font-bold text-muted-foreground -mt-0.5">Only applies when this space has an hourly rate. Leave blank for all day.</p>
              <div className="grid grid-cols-2 gap-3">
                <Input type="time" value={form.openTime} onChange={(e) => setForm(prev => ({ ...prev, openTime: e.target.value }))} />
                <Input type="time" value={form.closeTime} onChange={(e) => setForm(prev => ({ ...prev, closeTime: e.target.value }))} />
              </div>
              <div className="pt-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Offer start times every</p>
                <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                  {(['15', '30', '60'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setForm(prev => ({ ...prev, startIncrementMins: m }))}
                      className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${form.startIncrementMins === m ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                      {m === '60' ? '1 hour' : `${m} min`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Deposit</Label>
              <p className="text-[10px] font-bold text-muted-foreground -mt-0.5">Collect part of the total up front; the rest becomes a balance. Choose how the deposit is calculated.</p>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                {([['none', 'Full payment'], ['flat', 'Flat $'], ['percent', 'Percent'], ['breakeven', 'Break-even']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setForm(prev => {
                    const next = { ...prev, depositType: v };
                    // Break-even defaults to your studio TMHR from Foundation
                    if (v === 'breakeven' && !prev.depositValue) {
                      const tmhr = Number((selectedTenant as any)?.tmhr) || 0;
                      if (tmhr > 0) next.depositValue = tmhr.toFixed(2);
                    }
                    return next;
                  })}
                    className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${form.depositType === v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
              {form.depositType === 'flat' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">$</span>
                  <Input type="number" min={0} step="0.01" placeholder="e.g. 30" value={form.depositValue} onChange={(e) => setForm(prev => ({ ...prev, depositValue: e.target.value }))} />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">flat deposit</span>
                </div>
              )}
              {form.depositType === 'percent' && (
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={100} placeholder="e.g. 25" value={form.depositValue} onChange={(e) => setForm(prev => ({ ...prev, depositValue: e.target.value }))} />
                  <span className="text-sm font-bold">%</span>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">of the total</span>
                </div>
              )}
              {form.depositType === 'breakeven' && (() => {
                const tmhr = Number((selectedTenant as any)?.tmhr) || 0;
                const val = Number(form.depositValue) || 0;
                const differs = tmhr > 0 && Math.abs(val - tmhr) > 0.005;
                return (
                <div className="rounded-xl border-2 border-slate-100 p-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-muted-foreground">The deposit covers your cost to hold this space — your break-even for the booked time, so a cancellation never leaves you out of pocket.</p>
                  {tmhr > 0 ? (
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">✓ Pulled from your Foundation · TMHR ${tmhr.toFixed(2)}/hr</p>
                  ) : (
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Set your TMHR in Financial Foundation to auto-fill this</p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">$</span>
                    <Input type="number" min={0} step="0.01" placeholder={tmhr > 0 ? tmhr.toFixed(2) : 'e.g. 12.50'} value={form.depositValue} onChange={(e) => setForm(prev => ({ ...prev, depositValue: e.target.value }))} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">/ hour cost</span>
                  </div>
                  {differs && (
                    <button type="button" onClick={() => setForm(prev => ({ ...prev, depositValue: tmhr.toFixed(2) }))}
                      className="text-[10px] font-black uppercase tracking-widest text-indigo-600 underline">
                      Reset to studio TMHR (${tmhr.toFixed(2)})
                    </button>
                  )}
                  <p className="text-[9px] font-bold text-muted-foreground">Override above if this specific space costs more or less to hold than your studio average.</p>
                </div>
                );
              })()}
              {form.depositType !== 'none' && (
                <Select value={form.balanceMode} onValueChange={(v) => setForm(prev => ({ ...prev, balanceMode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_person">Balance due in person</SelectItem>
                    <SelectItem value="at_checkin">Balance at check-in</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1">
              <Label>Additional rates (optional)</Label>
              {form.extraRates.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={r.frequency} onValueChange={(v) => setForm(prev => ({ ...prev, extraRates: prev.extraRates.map((x, j) => j === i ? { ...x, frequency: v } : x) }))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['hourly','daily','weekly','monthly'].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="$" className="flex-1" value={r.dollars}
                    onChange={(e) => setForm(prev => ({ ...prev, extraRates: prev.extraRates.map((x, j) => j === i ? { ...x, dollars: e.target.value } : x) }))} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm(prev => ({ ...prev, extraRates: prev.extraRates.filter((_, j) => j !== i) }))}>×</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setForm(prev => ({ ...prev, extraRates: [...prev.extraRates, { frequency: 'daily', dollars: '' }] }))}>
                + Add rate
              </Button>
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
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-slate-500" />
              {editingRenterId ? 'Edit renter' : 'Add renter'}
            </DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Their independent business · your records</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingRenterId && convertibleStaff.length > 0 && (
              <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3.5 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Convert a team member (hybrid)</p>
                <p className="text-[11px] text-violet-700/80 leading-relaxed">Someone on your team also renting a space? Pick them — one identity, one PIN, two financial relationships.</p>
                <Select value={renterForm.linkedStaffId || 'none'} onValueChange={(v) => pickStaffToConvert(v === 'none' ? '' : v)}>
                  <SelectTrigger className="bg-white"><SelectValue placeholder="Start fresh — not a team member" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Start fresh — not a team member</SelectItem>
                    {convertibleStaff.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}{s.specialty ? ` · ${s.specialty}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {renterForm.linkedStaffId && <p className="text-[9px] font-black uppercase tracking-widest text-violet-600">✓ Details pre-filled from their staff record</p>}
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
            <div className="space-y-2 rounded-2xl border-2 border-slate-100 p-3.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Credentials & compliance</p>
              <p className="text-[10px] font-bold text-muted-foreground -mt-1">Track whatever their trade requires — licenses, permits, certifications, insurance. You'll be nagged 30 and 7 days before anything lapses.</p>
              <div className="flex flex-wrap gap-1.5">
                {['Professional license', 'Liability insurance', 'Health permit', 'Certification', 'Business registration'].map(ql => (
                  <button key={ql} type="button"
                    onClick={() => setRenterForm(p => ({ ...p, credentials: [...p.credentials, { label: ql, number: '', expiry: '' }] }))}
                    className="h-8 px-3 rounded-full border-2 border-slate-200 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:border-slate-400">
                    + {ql}
                  </button>
                ))}
              </div>
              {renterForm.credentials.map((cr, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_120px_32px] gap-1.5 items-center">
                  <Input placeholder="Credential (e.g. LMT license, Tattoo permit)" value={cr.label}
                    onChange={(e) => setRenterForm(p => ({ ...p, credentials: p.credentials.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                  <Input placeholder="#" value={cr.number}
                    onChange={(e) => setRenterForm(p => ({ ...p, credentials: p.credentials.map((x, j) => j === i ? { ...x, number: e.target.value } : x) }))} />
                  <Input type="date" value={cr.expiry}
                    onChange={(e) => setRenterForm(p => ({ ...p, credentials: p.credentials.map((x, j) => j === i ? { ...x, expiry: e.target.value } : x) }))} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRenterForm(p => ({ ...p, credentials: p.credentials.filter((_, j) => j !== i) }))}>×</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => setRenterForm(p => ({ ...p, credentials: [...p.credentials, { label: '', number: '', expiry: '' }] }))}>
                + Add custom credential
              </Button>
            </div>

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
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-slate-500" />
              Set up lease
            </DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{WIZARD_STEPS[leaseStep]}</DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 pb-1">
            {WIZARD_STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${i === leaseStep ? 'bg-slate-900 text-white' : i < leaseStep ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {i < leaseStep ? '✓' : i + 1}
                </div>
                {i < WIZARD_STEPS.length - 1 && <div className={`h-0.5 w-5 rounded ${i < leaseStep ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
              </div>
            ))}
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">{leaseStep + 1} / {WIZARD_STEPS.length}</p>
          </div>

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
              {/* v79 — e-signature */}
              <div className="space-y-1.5">
                <Label>Lease terms (shown to the renter)</Label>
                <Textarea rows={4} placeholder="Paste your lease / independent contractor agreement terms here…"
                  value={leaseForm.leaseTerms}
                  onChange={(e) => setLeaseForm(prev => ({ ...prev, leaseTerms: e.target.value }))} />
              </div>
              <button type="button" onClick={() => setLeaseForm(prev => ({ ...prev, requireSignature: !prev.requireSignature }))}
                className={`w-full rounded-xl border-2 p-3 flex items-center gap-3 text-left transition-colors ${leaseForm.requireSignature ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                <span className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center text-xs font-black shrink-0 ${leaseForm.requireSignature ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>{leaseForm.requireSignature ? '✓' : ''}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-tight">Require e-signature before activation</span>
                  <span className="block text-[10px] font-bold text-muted-foreground">The lease starts as "awaiting signature" — the renter reviews the terms and signs in their portal (Documents tab). Rent auto-collection begins only after they sign.</span>
                </span>
              </button>
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


      {/* ── Automation settings (v85) ── */}
      <Dialog open={autoSettingsOpen} onOpenChange={setAutoSettingsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <BoothAutomationSettings
            tenantId={tenantId}
            firestore={firestore}
            initial={(selectedTenant as any)?.bookingPageSettings?.automationRules}
          />
        </DialogContent>
      </Dialog>

      {/* ── Full application dialog (v81) ── */}
      <Dialog open={!!viewingApp} onOpenChange={(o) => { if (!o) setViewingApp(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {viewingApp && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-black tracking-tight">{viewingApp.name}</DialogTitle>
                <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                  {viewingApp.kind || 'application'} · {viewingApp.boothName || 'General'} · {String(viewingApp.createdAt || '').slice(0, 10)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-xl border-2 p-3.5 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
                  {viewingApp.phone && <p className="text-xs font-bold">{viewingApp.phone} <a href={`tel:${viewingApp.phone}`} className="text-indigo-600 font-black text-[9px] uppercase ml-2">Call</a> <a href={`sms:${viewingApp.phone}`} className="text-indigo-600 font-black text-[9px] uppercase ml-1">Text</a></p>}
                  {viewingApp.email && <p className="text-xs font-bold">{viewingApp.email} <a href={`mailto:${viewingApp.email}`} className="text-indigo-600 font-black text-[9px] uppercase ml-2">Email</a></p>}
                </div>
                {(viewingApp.specialty || viewingApp.timing || viewingApp.niche) && (
                  <div className="rounded-xl border-2 p-3.5 space-y-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Details</p>
                    {viewingApp.specialty && <p className="text-xs font-bold">Specialty: {viewingApp.specialty}</p>}
                    {viewingApp.niche && <p className="text-xs font-bold">Niche: {viewingApp.niche}</p>}
                    {viewingApp.timing && <p className="text-xs font-bold">Timing: {viewingApp.timing}</p>}
                    {viewingApp.startDate && <p className="text-xs font-bold">Requested: {viewingApp.startDate}{viewingApp.endDate && viewingApp.endDate !== viewingApp.startDate ? ` → ${viewingApp.endDate}` : ''}</p>}
                  </div>
                )}
                {viewingApp.message && (
                  <div className="rounded-xl border-2 p-3.5 space-y-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Their message</p>
                    <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">{viewingApp.message}</p>
                  </div>
                )}
                {Array.isArray(viewingApp.attachments) && viewingApp.attachments.length > 0 && (
                  <div className="rounded-xl border-2 p-3.5 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Documents ({viewingApp.attachments.length})</p>
                    {viewingApp.attachments.map((at: any) => (
                      <a key={at.url} href={at.url} target="_blank" rel="noreferrer"
                        className="rounded-lg border px-3 py-2 flex items-center justify-between hover:border-slate-400 transition-colors">
                        <span className="text-xs font-black truncate">📎 {at.label || at.name || 'Document'}</span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0">Open →</span>
                      </a>
                    ))}
                  </div>
                )}
                {viewingApp.consentAccepted && (
                  <p className="text-[10px] font-bold text-emerald-600">✓ Agreed to terms {viewingApp.consentAcceptedAt ? `· ${String(viewingApp.consentAcceptedAt).slice(0, 10)}` : ''}</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Kiosk link dialog (v74) ── */}
      <Dialog open={kioskOpen} onOpenChange={setKioskOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <MonitorSmartphone className="h-5 w-5 text-slate-500" />
              Check-in kiosk
            </DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Self check-in for renters · front-desk tablet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border-2 bg-slate-50 px-3 py-2.5 font-mono text-[11px] font-bold break-all select-all">
              {typeof window !== 'undefined' ? `${window.location.origin}/kiosk/${tenantId}` : `/kiosk/${tenantId}`}
            </div>
            <div className="rounded-xl border-2 border-sky-200 bg-sky-50/60 px-3 py-2.5 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-sky-700">Tour booking link (share with prospects)</p>
              <p className="font-mono text-[11px] font-bold break-all select-all text-sky-900">
                {typeof window !== 'undefined' ? `${window.location.origin}/tour/${tenantId}` : `/tour/${tenantId}`}
              </p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/tour/${tenantId}`).catch(() => {}); }} className="text-[9px] font-black uppercase tracking-widest text-sky-700 underline">Copy tour link</button>
                <button onClick={() => window.open(`/tour/${tenantId}`, '_blank')} className="text-[9px] font-black uppercase tracking-widest text-sky-700 underline">Open →</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => {
                navigator.clipboard?.writeText(`${window.location.origin}/kiosk/${tenantId}`).then(() => {
                  setKioskCopied(true); setTimeout(() => setKioskCopied(false), 2000);
                }).catch(() => {});
              }}>
                {kioskCopied ? '✓ Copied' : 'Copy link'}
              </Button>
              <Button onClick={() => window.open(`/kiosk/${tenantId}`, '_blank')}>
                Open kiosk →
              </Button>
            </div>
            <div className="rounded-xl border bg-white p-3 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">iPad setup (once)</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Open the link in Safari on the iPad → tap the Share icon → <strong>Add to Home Screen</strong>. It launches full-screen like an app. Enable Guided Access (Settings → Accessibility) to lock the iPad to the kiosk.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {profileContact && (
        <ContactProfileDrawer
          contact={profileContact}
          reservations={reservations}
          applications={applications}
          tenantId={tenantId}
          onClose={() => setProfileContact(null)}
          onConvert={(person) => convertToRenter(person)}
          onSetPipeline={handleSetPipeline}
          onFollowUp={handleFollowUp}
          onMarkLost={handleMarkLost}
          onReengage={handleReengage}
          onSaveNote={handleSaveNote}
          converting={!!convertingKey}
        />
      )}

      {profileRenter && (
        <RenterProfileDrawer
          renter={profileRenter}
          lease={occupyingLeaseByRenter.get(profileRenter.id)}
          booth={(() => { const l = occupyingLeaseByRenter.get(profileRenter.id); return l ? boothById.get(l.boothId) : undefined; })()}
          reservations={reservations}
          w9={w9Map[profileRenter.id]}
          tenantId={tenantId}
          firestore={firestore}
          onClose={() => setProfileRenter(null)}
          onEdit={() => { const r = profileRenter; setProfileRenter(null); openEditRenter(r); }}
          onLease={() => { const r = profileRenter; setProfileRenter(null); openLeaseWizard(r.id); }}
          onEndLease={() => { const r = profileRenter; setProfileRenter(null); setEndLeaseTarget(r); }}
        />
      )}

      {managingTour && (
        <TourManagerDialog
          open={!!managingTour}
          onOpenChange={(o) => { if (!o) setManagingTour(null); }}
          firestore={firestore}
          tenantId={tenantId}
          tour={managingTour}
          studioName={(selectedTenant as any)?.name || null}
          studioPhone={(selectedTenant as any)?.phone || null}
          studioEmail={(selectedTenant as any)?.email || null}
          studioAddress={(selectedTenant as any)?.address || null}
          printConfig={(selectedTenant as any)?.tourPrintoutConfig || null}
          onConvert={(t) => convertToRenter({ name: t.name, phone: t.phone, email: t.email, specialty: t.specialty, key: boothContactKey(t.phone, t.email) }, t)}
        />
      )}

      {/* ── Incidentals charge-policy editor ── */}
      <Dialog open={chargePolicyOpen} onOpenChange={(o) => { if (!o) setChargePolicyOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Incidental charge policy</DialogTitle>
            <DialogDescription>
              These are the only charges that can be billed to a card on file, each with a hard cap. Staff can't exceed a cap or invent a charge — the server enforces it, and this exact list is written into every signed lease.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-[1fr_5.5rem_2rem] gap-2 items-center px-0.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Charge type</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Cap ($)</span>
              <span />
            </div>
            {policyDraft.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_2rem] gap-2 items-center">
                <Input
                  value={row.label}
                  placeholder="e.g. Damage"
                  onChange={(e) => setPolicyDraft(d => d.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                  className="h-9 text-xs font-bold"
                />
                <Input
                  value={row.cap}
                  inputMode="decimal"
                  placeholder="No cap"
                  onChange={(e) => setPolicyDraft(d => d.map((r, j) => j === i ? { ...r, cap: e.target.value } : r))}
                  className="h-9 text-xs font-bold text-center"
                />
                <button
                  onClick={() => setPolicyDraft(d => d.filter((_, j) => j !== i))}
                  className="h-9 w-8 rounded-lg border-2 flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setPolicyDraft(d => [...d, { label: '', cap: '' }])}
              className="w-full h-9 rounded-lg border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add charge type
            </button>
          </div>
          <p className="text-[10px] font-medium text-muted-foreground">
            Leave the cap blank for no limit (not recommended). A blank cap means staff can charge any amount for that type.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setChargePolicyOpen(false)} disabled={policySaving}>Cancel</Button>
            <Button onClick={savePolicy} disabled={policySaving}>{policySaving ? 'Saving…' : 'Save policy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Tour-sheet copy editor ── */}
      <Dialog open={tourSheetsOpen} onOpenChange={(o) => { if (!o) setTourSheetsOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Tour sheets</DialogTitle>
            <DialogDescription>
              Every word printed on the visitor confirmation and the staff prep sheet is yours to edit. Leave a field as-is to keep the default. Guest name, space, time, and your studio's contact details fill in automatically.
            </DialogDescription>
          </DialogHeader>
          {sheetDraft && (
            <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
              {/* Visitor confirmation */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Visitor confirmation</p>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Headline</Label>
                  <Input value={sheetDraft.confirmationTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, confirmationTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Intro line</Label>
                  <Textarea value={sheetDraft.confirmationIntro} onChange={(e) => setSheetDraft((s: any) => ({ ...s, confirmationIntro: e.target.value }))} rows={2} className="text-sm resize-none" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">"What to bring" heading</Label>
                  <Input value={sheetDraft.whatToBringTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, whatToBringTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">"What to bring" items</Label>
                  {sheetDraft.whatToBring.map((it: string, i: number) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={it} onChange={(e) => setSheetDraft((s: any) => ({ ...s, whatToBring: s.whatToBring.map((x: string, j: number) => j === i ? e.target.value : x) }))} className="h-9 text-sm flex-1" />
                      <button onClick={() => setSheetDraft((s: any) => ({ ...s, whatToBring: s.whatToBring.filter((_: string, j: number) => j !== i) }))} className="h-9 w-8 rounded-lg border-2 flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setSheetDraft((s: any) => ({ ...s, whatToBring: [...s.whatToBring, ''] }))} className="w-full h-9 rounded-lg border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add item</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reschedule heading</Label>
                    <Input value={sheetDraft.changeTimeTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, changeTimeTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reschedule note</Label>
                    <Input value={sheetDraft.changeTimeNote} onChange={(e) => setSheetDraft((s: any) => ({ ...s, changeTimeNote: e.target.value }))} className="h-9 text-sm" />
                  </div>
                </div>
              </div>

              {/* Staff prep sheet */}
              <div className="space-y-2.5 border-t pt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Staff prep sheet</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Headline</Label>
                    <Input value={sheetDraft.prepTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, prepTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Checklist heading</Label>
                    <Input value={sheetDraft.checklistTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, checklistTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sub-line</Label>
                  <Input value={sheetDraft.prepIntro} onChange={(e) => setSheetDraft((s: any) => ({ ...s, prepIntro: e.target.value }))} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Walkthrough checklist items</Label>
                  {sheetDraft.checklist.map((it: string, i: number) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={it} onChange={(e) => setSheetDraft((s: any) => ({ ...s, checklist: s.checklist.map((x: string, j: number) => j === i ? e.target.value : x) }))} className="h-9 text-sm flex-1" />
                      <button onClick={() => setSheetDraft((s: any) => ({ ...s, checklist: s.checklist.filter((_: string, j: number) => j !== i) }))} className="h-9 w-8 rounded-lg border-2 flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setSheetDraft((s: any) => ({ ...s, checklist: [...s.checklist, ''] }))} className="w-full h-9 rounded-lg border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add step</button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">"Capture" section heading</Label>
                  <Input value={sheetDraft.captureTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, captureTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Interest levels</Label>
                  <p className="text-[10px] font-medium text-muted-foreground -mt-0.5">These are the exact chips you tap when closing a tour. The first one is your "hot lead" tier and drives the Hot leads KPI.</p>
                  {sheetDraft.interestLevels.map((it: string, i: number) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={it} onChange={(e) => setSheetDraft((s: any) => ({ ...s, interestLevels: s.interestLevels.map((x: string, j: number) => j === i ? e.target.value : x) }))} className="h-9 text-sm flex-1" />
                      {i === 0 && <span className="text-[8px] font-black uppercase tracking-widest text-red-600 shrink-0">Top tier</span>}
                      <button onClick={() => setSheetDraft((s: any) => ({ ...s, interestLevels: s.interestLevels.filter((_: string, j: number) => j !== i) }))} className="h-9 w-8 rounded-lg border-2 flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setSheetDraft((s: any) => ({ ...s, interestLevels: [...s.interestLevels, ''] }))} className="w-full h-9 rounded-lg border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add level</button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Next-step options</Label>
                  {sheetDraft.nextSteps.map((it: string, i: number) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={it} onChange={(e) => setSheetDraft((s: any) => ({ ...s, nextSteps: s.nextSteps.map((x: string, j: number) => j === i ? e.target.value : x) }))} className="h-9 text-sm flex-1" />
                      <button onClick={() => setSheetDraft((s: any) => ({ ...s, nextSteps: s.nextSteps.filter((_: string, j: number) => j !== i) }))} className="h-9 w-8 rounded-lg border-2 flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setSheetDraft((s: any) => ({ ...s, nextSteps: [...s.nextSteps, ''] }))} className="w-full h-9 rounded-lg border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add option</button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Notes section heading</Label>
                  <Input value={sheetDraft.notesTitle} onChange={(e) => setSheetDraft((s: any) => ({ ...s, notesTitle: e.target.value }))} className="h-9 text-sm font-bold" />
                </div>
              </div>

              {/* Footer / branding */}
              <div className="space-y-2.5 border-t pt-4">
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Footer note (both sheets, optional)</Label>
                  <Input value={sheetDraft.footerNote} placeholder="e.g. Questions? Text us anytime." onChange={(e) => setSheetDraft((s: any) => ({ ...s, footerNote: e.target.value }))} className="h-9 text-sm" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!sheetDraft.hideBranding} onChange={(e) => setSheetDraft((s: any) => ({ ...s, hideBranding: e.target.checked }))} className="h-4 w-4" />
                  <span className="text-xs font-bold text-slate-700">Hide "Powered by ClarityFlow" on printed sheets</span>
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTourSheetsOpen(false)} disabled={sheetSaving}>Cancel</Button>
            <Button onClick={saveTourSheets} disabled={sheetSaving}>{sheetSaving ? 'Saving…' : 'Save sheets'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── No-show policy ── */}
      <Dialog open={noShowOpen} onOpenChange={(o) => { if (!o) setNoShowOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><XCircle className="h-4 w-4" /> No-show policy</DialogTitle>
            <DialogDescription>
              Each night, a paid reservation whose booked day has fully passed with no check-in is marked a no-show and surfaced for you. Whether that carries a fee is up to you.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border-2 p-3">
              <input type="checkbox" checked={noShowEnabled} onChange={(e) => setNoShowEnabled(e.target.checked)} className="h-4 w-4 mt-0.5" />
              <span>
                <span className="text-sm font-black block">Charge a no-show fee automatically</span>
                <span className="text-[11px] font-medium text-muted-foreground">When a card is on file, charge the fee below and record it in your ledger. Off = flag only, you decide.</span>
              </span>
            </label>
            {noShowEnabled && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">No-show fee</Label>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black">$</span>
                  <Input value={noShowFee} inputMode="decimal" placeholder="0" onChange={(e) => setNoShowFee(e.target.value)} className="h-11 w-28 rounded-xl border-2 font-black text-lg" />
                </div>
                <p className="text-[10px] font-medium text-muted-foreground">Charged off-session to the card saved at booking. If the card declines, the no-show is still flagged and you're told to collect another way — the renter is never banned or suspended. No card on file means it's flagged only.</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNoShowOpen(false)} disabled={noShowSaving}>Cancel</Button>
            <Button onClick={saveNoShow} disabled={noShowSaving}>{noShowSaving ? 'Saving…' : 'Save policy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* ── Reschedule booking (v85) ── */}
      <Dialog open={!!reschedRes} onOpenChange={(o) => { if (!o) setReschedRes(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
            <DialogDescription>
              {reschedRes?.name} · {reschedRes?.boothName} — same {reschedRes?.bookingType === 'hourly' ? 'duration' : 'length'}, new time.
              The move is conflict-checked against other bookings and resident renters' schedules.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New date</Label>
              <Input type="date" value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} />
            </div>
            {reschedRes?.bookingType === 'hourly' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Start</Label>
                  <Input type="time" value={reschedStartTime} onChange={(e) => setReschedStartTime(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>End</Label>
                  <Input type="time" value={reschedEndTime} onChange={(e) => setReschedEndTime(e.target.value)} /></div>
              </div>
            )}
            {reschedRes?.bookingType !== 'hourly' && (reschedRes?.numDays || 1) > 1 && (
              <p className="text-[10px] font-bold text-muted-foreground">
                {reschedRes.numDays}-day booking — the end date shifts automatically to keep the same length.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReschedRes(null)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={reschedSaving || !reschedDate}>
              {reschedSaving ? 'Moving…' : 'Move booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record rent / deposit payment (v84) ── */}
      <Dialog open={!!recordPay} onOpenChange={(o) => { if (!o) setRecordPay(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{recordPay?.mode === 'deposit' ? 'Record security deposit' : 'Record rent payment'}</DialogTitle>
            <DialogDescription>
              {recordPay?.mode === 'deposit'
                ? 'Log a deposit collected outside the app (cash, check, transfer). It books as held funds — not revenue — and the lease is marked collected.'
                : 'Log a rent payment collected outside the app. The invoice is marked paid and the income lands in your ledger, activity feed, and reports.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input inputMode="decimal" value={recordPayAmount}
                onChange={(e) => setRecordPayAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>How was it paid?</Label>
              <Select value={recordPayMethod} onValueChange={setRecordPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Cash', 'Check', 'Zelle / Venmo', 'Card (in person)', 'Other'].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input value={recordPayNote} onChange={(e) => setRecordPayNote(e.target.value)}
                placeholder="Check #204, paid early…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordPay(null)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={recordPaySaving || !(Number(recordPayAmount) > 0)}>
              {recordPaySaving ? 'Saving…' : recordPay?.mode === 'deposit' ? 'Record deposit' : 'Record payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommandCenterPanel
        open={commandCenterOpen}
        onOpenChange={setCommandCenterOpen}
        alerts={alerts}
        activity={activityLog}
      />
    </div>
  );
}
