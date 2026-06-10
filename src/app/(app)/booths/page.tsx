'use client';

import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Booth,
  BoothStatus,
  RentFrequency,
  BOOTH_RENTAL_COLLECTIONS,
  FREQUENCY_LABELS,
  formatCents,
} from '@/lib/booth-rental-types';

const STATUS_CONFIG: Record<
  BoothStatus,
  { label: string; badgeClass: string }
> = {
  vacant: { label: 'Vacant', badgeClass: 'bg-amber-100 text-amber-800' },
  occupied: { label: 'Occupied', badgeClass: 'bg-emerald-100 text-emerald-800' },
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
                    onApplyWeeklyRent(
                      Math.round(result.floorWeekly)
                    );
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
  const { data: booths, isLoading } = useCollection<Booth>(boothsRef);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BoothFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const sortedBooths = useMemo(() => {
    const list = booths ? [...booths] : [];
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return list;
  }, [booths]);

  const summary = useMemo(() => {
    const list = sortedBooths.filter((b) => b.status !== 'inactive');
    const vacant = list.filter((b) => b.status === 'vacant').length;
    const occupied = list.filter((b) => b.status === 'occupied').length;
    const potentialMonthly = list.reduce((sum, b) => {
      const perMonth =
        b.baseRentFrequency === 'monthly'
          ? b.baseRentCents
          : b.baseRentFrequency === 'weekly'
          ? Math.round((b.baseRentCents * 52) / 12)
          : Math.round((b.baseRentCents * 26) / 12);
      return sum + perMonth;
    }, 0);
    return { total: list.length, vacant, occupied, potentialMonthly };
  }, [sortedBooths]);

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

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
    if (!form.name.trim()) return;
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
          { ...payload, currentLeaseId: null, createdAt: now }
        );
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (boothId: string) => {
    await deleteDoc(
      doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), boothId)
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Armchair className="h-6 w-6" />
            Booths
          </h1>
          <p className="text-sm text-muted-foreground">
            Your rentable chairs, booths, and suites.
          </p>
        </div>
        <div className="flex gap-2">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Booths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Occupied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.occupied}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vacant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.vacant}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Potential rent / mo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCents(summary.potentialMonthly)}
            </p>
          </CardContent>
        </Card>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit booth' : 'Add booth'}
            </DialogTitle>
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
