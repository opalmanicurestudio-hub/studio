'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Armchair,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Booth,
  BoothStatus,
  Renter,
  Lease,
  RentFrequency,
  BOOTH_RENTAL_COLLECTIONS,
  BOOTH_STATUS_LABELS,
  BOOTH_STATUS_COLORS,
  RENTER_STATUS_LABELS,
  FREQUENCY_LABELS,
  formatCents,
} from '@/lib/booth-rental-types';

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

const STATUS_CONFIG: Record
  BoothStatus,
  { label: string; badgeClass: string }
> = {
  vacant: { label: 'Vacant', badgeClass: 'bg-amber-100 text-amber-800' },
  occupied: { label: 'Occupied', badgeClass: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Partial', badgeClass: 'bg-orange-100 text-orange-800' },
  maintenance: { label: 'Maintenance', badgeClass: 'bg-slate-200 text-slate-700' },
  inactive: { label: 'Inactive', badgeClass: 'bg-slate-100 text-slate-500' },
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

// ─── Booth form ───────────────────────────────────────────────────────────────

interface BoothFormState {
  name: string;
  description: string;
  baseRentDollars: string;
  baseRentFrequency: RentFrequency;
  status: BoothStatus;
  amenities: string[];
}

const EMPTY_FORM: BoothFormState = {
  name: '',
  description: '',
  baseRentDollars: '',
  baseRentFrequency: 'weekly',
  status: 'vacant',
  amenities: [],
};

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

function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

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
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
  const c = BOOTH_STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {BOOTH_STATUS_LABELS[status]}
    </span>
  );
}

// ─── Booth card on canvas ─────────────────────────────────────────────────────

interface BoothCanvasCardProps {
  booth: Booth;
  renter?: Renter;
  lease?: Lease;
  selected: boolean;
  locked: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string) => void;
  onClick: (id: string) => void;
}

function BoothCanvasCard({
  booth,
  renter,
  lease,
  selected,
  locked,
  onMouseDown,
  onResizeMouseDown,
  onClick,
}: BoothCanvasCardProps) {
  const colors = BOOTH_STATUS_COLORS[booth.status];

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
      }}
      onMouseDown={(e) => !locked && onMouseDown(e, booth.id)}
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
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeMouseDown(e, booth.id);
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
    <div className="absolute right-4 top-4 w-64 bg-background border border-border rounded-xl shadow-lg p-4 space-y-3 z-50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{booth.name}</p>
          <StatusPill status={booth.status} />
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
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
          <Badge className="text-[10px]">{RENTER_STATUS_LABELS[renter.status]}</Badge>
        </div>
      )}

      {lease && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Lease</p>
          <p className="text-sm font-medium">{formatCents(monthlyRent)} / mo</p>
          <p className="text-xs text-muted-foreground">
            {formatCents(lease.rentAmountCents)} /{' '}
            {FREQUENCY_LABELS[lease.frequency].toLowerCase()}
          </p>
          {lease.scheduleSlot && (
            <p className="text-xs text-muted-foreground">
              Days: {lease.scheduleSlot.label ?? lease.scheduleSlot.days.join(', ')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {lease.endDate ? `Ends ${lease.endDate}` : 'Month-to-month'}
          </p>
          {lease.perks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {lease.perks.length} perk{lease.perks.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {booth.amenities.length > 0 && (
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BoothsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const boothsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId))
        : null,
    [firestore, tenantId]
  );
  const rentersRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId))
        : null,
    [firestore, tenantId]
  );
  const leasesRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId))
        : null,
    [firestore, tenantId]
  );

  const { data: booths, isLoading } = useCollection<Booth>(boothsRef);
  const { data: renters } = useCollection<Renter>(rentersRef);
  const { data: leases } = useCollection<Lease>(leasesRef);

  const [view, setView] = useState<'floor' | 'list'>('floor');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BoothFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [locked, setLocked] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);

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

  const [localPos, setLocalPos] = useState
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});

  const renterById = useMemo(() => {
    const m = new Map<string, Renter>();
    (renters ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [renters]);

  const activeLeaseByBooth = useMemo(() => {
    const m = new Map<string, Lease>();
    (leases ?? []).forEach((l) => {
      if (l.status === 'active' || l.status === 'on_leave') {
        if (!m.has(l.boothId)) m.set(l.boothId, l);
      }
    });
    return m;
  }, [leases]);

  const sortedBooths = useMemo(() => {
    const list = booths ? [...booths] : [];
    list.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
    );
    return list;
  }, [booths]);

  const metrics = useMemo(() => {
    const allBooths = (booths ?? []).filter((b) => b.status !== 'inactive');
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

    const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    return {
      total,
      occupied,
      vacant,
      monthlyRevenue,
      vacancyCost,
      potentialMonthly,
      occupancyPct,
    };
  }, [booths, activeLeaseByBooth]);

  const effectiveBooth = useCallback(
    (booth: Booth) => {
      const lp = localPos[booth.id];
      if (lp)
        return { ...booth, canvasX: lp.x, canvasY: lp.y, canvasW: lp.w, canvasH: lp.h };
      return booth;
    },
    [localPos]
  );

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const beginDrag = useCallback(
    (e: React.MouseEvent, boothId: string, mode: 'move' | 'resize') => {
      if (locked) return;
      e.preventDefault();
      const booth = (booths ?? []).find((b) => b.id === boothId);
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
    },
    [locked, booths, localPos]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, boothId: string) => beginDrag(e, boothId, 'move'),
    [beginDrag]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, boothId: string) => beginDrag(e, boothId, 'resize'),
    [beginDrag]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
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

    const handleMouseUp = async () => {
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

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [firestore, tenantId, localPos]);

  const autoArrangeBooths = async () => {
    if (!tenantId) return;
    const unplaced = (booths ?? []).filter(
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

  // ── CRUD handlers ───────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (booth: Booth) => {
    setEditingId(booth.id);
    setForm({
      name: booth.name,
      description: booth.description ?? '',
      baseRentDollars: (booth.baseRentCents / 100).toString(),
      baseRentFrequency: booth.baseRentFrequency,
      status: booth.status,
      amenities: booth.amenities ?? [],
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
    if (!form.name.trim() || !tenantId) return;
    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      baseRentCents: Math.round(toNumber(form.baseRentDollars) * 100),
      baseRentFrequency: form.baseRentFrequency,
      status: form.status,
      amenities: form.amenities,
      updatedAt: now,
    };
    try {
      if (editingId) {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), editingId),
          payload
        );
      } else {
        await addDoc(
          collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId)),
          {
            ...payload,
            currentLeaseId: null,
            canvasX: 0,
            canvasY: 0,
            canvasW: DEFAULT_W,
            canvasH: DEFAULT_H,
            createdAt: now,
          }
        );
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

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

  const selectedBooth = selectedId
    ? (booths ?? []).find((b) => b.id === selectedId)
    : null;
  const selectedLease = selectedBooth
    ? activeLeaseByBooth.get(selectedBooth.id)
    : undefined;
  const selectedRenter = selectedLease
    ? renterById.get(selectedLease.renterId)
    : undefined;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Armchair className="h-6 w-6" />
            Booths
          </h1>
          <p className="text-sm text-muted-foreground">
            Your rentable chairs, booths, and suites — arranged the way your
            studio actually looks.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex rounded-lg border border-border p-0.5">
            <Button
              variant={view === 'floor' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('floor')}
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Floor plan
            </Button>
            <Button
              variant={view === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('list')}
            >
              <List className="h-4 w-4 mr-1.5" />
              List
            </Button>
          </div>
          <Button variant="outline" onClick={() => setPricingOpen(true)}>
            <Calculator className="h-4 w-4 mr-2" />
            Pricing Advisor
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add booth
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading booths…</p>
      )}

      {!isLoading && sortedBooths.length === 0 && (
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
            <div className="h-[600px] overflow-auto rounded-xl border border-border bg-muted/30">
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
                              onMouseDown={handleMouseDown}
                              onResizeMouseDown={handleResizeMouseDown}
                              onClick={setSelectedId}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                          <p className="font-medium">{b.name}</p>
                          {b.amenities.length > 0 && (
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
                      / {FREQUENCY_LABELS[booth.baseRentFrequency].toLowerCase()}
                    </span>
                  </p>
                  {booth.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {booth.description}
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

            <div className="grid grid-cols-2 gap-3">
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
              <Label htmlFor="booth-desc">Description (optional)</Label>
              <Textarea
                id="booth-desc"
                placeholder="Window seat, private suite with door, near reception…"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
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
    </div>
  );
}