'use client';

/**
 * RentersPage — rewritten against booth-rental-service.ts,
 * booth-rental-hooks.ts, the merged booth-rental-types.ts, and the new
 * useLocation() context.
 *
 * WHAT CHANGED vs. the original RentersPage, and why — search "CHANGED:"
 * below for each specific spot:
 *
 *   1. All four duplicated useMemoFirebase/useCollection blocks replaced
 *      by useBoothRentalCollections() + the shared index hooks. Same
 *      data, one definition instead of four slightly different ones.
 *   2. activeLeaseByRenter (which used ['active','on_leave',
 *      'pending_signature']) replaced by useOccupyingLeaseByRenter,
 *      which uses the single canonical OCCUPYING_LEASE_STATUSES list
 *      from booth-rental-service.ts — so this page can no longer
 *      disagree with Booths/Rent-Roll about what counts as occupied.
 *   3. handleSaveRenter's direct addDoc replaced by createRenter() from
 *      the service layer, which writes the required locationId.
 *   4. handleCreateLease's three sequential awaited writes replaced by
 *      one call to createLease(), which batches them atomically.
 *   5. handleEndLease's buggy currentLeaseId write (which stored a booth
 *      id in a field meant to hold a lease id) replaced by endLease(),
 *      which fixes that.
 *   6. Every dialog now requires a selected location before it can save
 *      — enforced via useLocation(), since every write needs locationId
 *      and the security rules will reject a write missing it.
 *
 * ASSUMPTION CARRIED FROM useBoothRentalCollections (booth-rental-hooks.ts):
 * `booths`, `renters`, `leases` below are accessed as `.data` / `.isLoading`,
 * matching how the ORIGINAL page destructured useCollection
 * (`const { data: booths, isLoading } = useCollection<Booth>(ref)`). I
 * haven't seen your actual useCollection implementation — if it returns a
 * different shape (e.g. a tuple, or different key names), every `.data`
 * and `.isLoading` reference below needs updating to match. This is a
 * single, consistent assumption throughout the file, not a per-call guess.
 *
 * WHAT DID NOT CHANGE: every dialog, wizard step, form field, and the
 * PerkRow component are unchanged in structure and behavior. This is a
 * data-layer rewrite, not a redesign.
 */

import { useState, useMemo } from 'react';
import {
  doc,
  updateDoc,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
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
  Users, Plus, Pencil, FileText, FileSignature,
  CircleDollarSign, CalendarDays, DoorOpen, LogOut,
  ChevronRight, ChevronLeft, Upload, AlertCircle,
  Gift, Clock, Pause, MapPin,
} from 'lucide-react';
import {
  Booth, Renter, RenterStatus, Lease, LeasePerk,
  PerkType, PerkTrigger, RentFrequency, WeekDay,
  FREQUENCY_LABELS, RENTER_STATUS_LABELS, PERK_TYPE_LABELS,
  PERK_TRIGGER_LABELS, WEEKDAY_LABELS, formatCents, toIsoDate, slotsOverlap,
} from '@/lib/booth-rental-types';
import {
  useBoothRentalCollections,
  useBoothIndex,
  useOccupyingLeaseByRenter,
} from '@/lib/booth-rental-hooks';
import { createRenter, createLease, endLease } from '@/lib/booth-rental-service';

const RENTER_STATUS_CONFIG: Record<RenterStatus, { label: string; badgeClass: string }> = {
  prospective:     { label: 'Prospective',    badgeClass: 'bg-sky-100 text-sky-800' },
  active:          { label: 'Active',          badgeClass: 'bg-emerald-100 text-emerald-800' },
  on_leave:        { label: 'On leave',        badgeClass: 'bg-amber-100 text-amber-800' },
  maternity_leave: { label: 'Maternity leave', badgeClass: 'bg-pink-100 text-pink-800' },
  subletting:      { label: 'Subletting',      badgeClass: 'bg-violet-100 text-violet-800' },
  past:            { label: 'Past',            badgeClass: 'bg-slate-200 text-slate-700' },
  archived:        { label: 'Archived',        badgeClass: 'bg-slate-100 text-slate-500' },
};

const WEEKDAY_OPTIONS: { value: WeekDay; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

interface RenterFormState {
  firstName: string; lastName: string; email: string; phone: string;
  businessName: string; specialty: string; notes: string;
}
const EMPTY_RENTER_FORM: RenterFormState = {
  firstName: '', lastName: '', email: '', phone: '', businessName: '', specialty: '', notes: '',
};

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

function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

const WIZARD_STEPS = ['Booth & rent', 'Deposit & fees', 'Perks', 'Review'] as const;

function PerkRow({
  perk, onChange, onRemove,
}: {
  perk: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>;
  onChange: (u: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
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
      <div className="grid grid-cols-2 gap-3">
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

export default function RentersPage() {
  const { firebaseApp, firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  // CHANGED: location is now a first-class selection, not implicit.
  // Every write below needs locationId; this page can't usefully render
  // (or, more importantly, can't safely WRITE) without one selected.
  const { selectedLocation, selectedLocationId, locations, isLoading: locationsLoading } =
    useLocation();

  const storage = useMemo(() => getStorage(firebaseApp), [firebaseApp]);

  // CHANGED: one hook replaces the three separate useMemoFirebase +
  // useCollection blocks the original page had for renters/booths/leases.
  // Passing selectedLocationId scopes every query to the active location
  // — this is the query-layer half of the location-scoping design (see
  // the LOCATION-SCOPED LIST CAVEAT note in firestore.rules: rules alone
  // cannot filter list queries by field, so this where() clause is what
  // actually keeps a location-restricted view correctly scoped).
  const { booths, renters, leases } = useBoothRentalCollections(
    tenantId,
    selectedLocationId
  );

  const boothById = useBoothIndex(booths.data);
  // CHANGED: replaces the page's local activeLeaseByRenter (which used
  // ['active','on_leave','pending_signature']) with the canonical
  // definition shared across all pages.
  const occupyingLeaseByRenter = useOccupyingLeaseByRenter(leases.data);

  const [renterDialogOpen, setRenterDialogOpen] = useState(false);
  const [editingRenterId, setEditingRenterId] = useState<string | null>(null);
  const [renterForm, setRenterForm] = useState<RenterFormState>(EMPTY_RENTER_FORM);
  const [renterError, setRenterError] = useState<string | null>(null);
  const [savingRenter, setSavingRenter] = useState(false);

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

  const availableBooths = useMemo(
    () => (booths.data ?? []).filter((b) => b.status === 'vacant' || b.status === 'partial'),
    [booths.data]
  );

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

  const sortedRenters = useMemo(() => {
    const list = renters.data ? [...renters.data] : [];
    const order: Record<RenterStatus, number> = {
      active: 0, on_leave: 1, maternity_leave: 2, subletting: 3,
      prospective: 4, past: 5, archived: 6,
    };
    list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.lastName.localeCompare(b.lastName));
    return list;
  }, [renters.data]);

  // CHANGED: tenant loading state now also accounts for location loading
  // — a tenant with zero locations yet (first-time setup) is a distinct,
  // real state from "still fetching," handled separately below.
  if (!tenantId) return <div className="p-8 text-sm text-muted-foreground">Loading your studio…</div>;

  if (!locationsLoading && locations.length === 0) {
    return (
      <div className="p-8 space-y-3">
        <p className="font-medium">No locations set up yet</p>
        <p className="text-sm text-muted-foreground">
          Add at least one location before managing renters and leases —
          every booth, renter, and lease belongs to a specific location.
        </p>
      </div>
    );
  }

  if (locationsLoading || !selectedLocationId) {
    return <div className="p-8 text-sm text-muted-foreground">Loading location…</div>;
  }

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

  const openCreateRenter = () => {
    setEditingRenterId(null); setRenterForm(EMPTY_RENTER_FORM); setRenterError(null); setRenterDialogOpen(true);
  };
  const openEditRenter = (renter: Renter) => {
    setEditingRenterId(renter.id);
    setRenterForm({ firstName: renter.firstName, lastName: renter.lastName, email: renter.email,
      phone: renter.phone ?? '', businessName: renter.businessName ?? '',
      specialty: renter.specialty ?? '', notes: renter.notes ?? '' });
    setRenterError(null); setRenterDialogOpen(true);
  };
  const handleRenterDialogOpenChange = (open: boolean) => {
    if (!open) { setEditingRenterId(null); setRenterError(null); }
    setRenterDialogOpen(open);
  };

  const handleSaveRenter = async () => {
    if (!renterForm.firstName.trim() || !renterForm.email.trim() || !selectedLocationId) return;
    setSavingRenter(true); setRenterError(null);
    const now = new Date().toISOString();
    try {
      if (editingRenterId) {
        // Editing an existing renter is a single-document update with no
        // cross-collection side effects — stays a direct updateDoc, same
        // as the booth update/delete pattern in booth-rental-service.ts's
        // header comment (only creation/multi-effect ops get a wrapper).
        await updateDoc(
          doc(firestore, 'tenants', tenantId, 'renters', editingRenterId),
          {
            firstName: renterForm.firstName.trim(),
            lastName: renterForm.lastName.trim(),
            email: renterForm.email.trim(),
            phone: renterForm.phone.trim(),
            businessName: renterForm.businessName.trim(),
            specialty: renterForm.specialty.trim(),
            notes: renterForm.notes.trim(),
            updatedAt: now,
          }
        );
      } else {
        // CHANGED: was a direct addDoc with no locationId. createRenter()
        // writes locationId (required by the security rules) and the new
        // portal-identity fields (authUid, portalInviteStatus) instead of
        // the removed portalAccessToken.
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

  const handleCreateLease = async () => {
    if (!leaseRenterId || !leaseForm.boothId || !selectedLocationId) return;
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

      // CHANGED: was 3 sequential awaited writes (addDoc lease, updateDoc
      // booth, updateDoc renter) — a dropped connection between any two
      // left the system half-written. createLease() batches all three
      // atomically. Also now passes locationId, taken from the booth
      // being leased (booth.locationId once that field is populated on
      // existing booth docs — see the merged Booth type's backfill note).
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
      // CHANGED: was a hand-rolled updateDoc that wrote
      // `currentLeaseId: lease.boothId` (a BOOTH id) into a field meant
      // to hold a LEASE id, on shared booths with a remaining renter.
      // endLease() fixes this — it correctly resolves the remaining
      // lease's own id, or null if the booth is now fully vacant.
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

  const selectedBooth = boothById.get(leaseForm.boothId);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" />Renters
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            The independent professionals renting space in your studio.
            {selectedLocation && (
              <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
                <MapPin className="h-3 w-3" />{selectedLocation.name}
              </span>
            )}
          </p>
        </div>
        <Button onClick={openCreateRenter}><Plus className="h-4 w-4 mr-2" />Add renter</Button>
      </div>

      {renters.isLoading && <p className="text-sm text-muted-foreground">Loading renters…</p>}
      {!renters.isLoading && sortedRenters.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Users className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No renters yet</p>
            <p className="text-sm text-muted-foreground">Add a renter, then set up their lease with schedule, deposit, and perks.</p>
            <Button onClick={openCreateRenter}><Plus className="h-4 w-4 mr-2" />Add your first renter</Button>
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
                      {formatCents(lease.rentAmountCents)} / {FREQUENCY_LABELS[lease.frequency].toLowerCase()}
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
                    {lease.perks?.length > 0 && (
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

      {/* Renter dialog */}
      <Dialog open={renterDialogOpen} onOpenChange={handleRenterDialogOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRenterId ? 'Edit renter' : 'Add renter'}</DialogTitle>
            <DialogDescription>Their independent business — your records.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="r-first">First name</Label>
                <Input id="r-first" value={renterForm.firstName} onChange={(e) => setRenterForm((p) => ({ ...p, firstName: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="r-last">Last name</Label>
                <Input id="r-last" value={renterForm.lastName} onChange={(e) => setRenterForm((p) => ({ ...p, lastName: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="r-email">Email</Label>
              <Input id="r-email" type="email" value={renterForm.email} onChange={(e) => setRenterForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
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
                        {b.name} ({b.status === 'partial' ? 'shared' : 'vacant'}) — {formatCents(b.baseRentCents)} / {FREQUENCY_LABELS[b.baseRentFrequency].toLowerCase()}
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
                  <div className="grid grid-cols-2 gap-3">
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

              <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="l-start">Lease start</Label>
                  <Input id="l-start" type="date" value={leaseForm.startDate} onChange={(e) => setLeaseForm((p) => ({ ...p, startDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="l-end">End (blank = month-to-month)</Label>
                  <Input id="l-end" type="date" min={leaseForm.startDate} value={leaseForm.endDate} onChange={(e) => setLeaseForm((p) => ({ ...p, endDate: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-3 gap-3">
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
                  <span className="font-medium">{selectedBooth?.name ?? '—'}</span>
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
                  <span className="font-medium">{formatCents(Math.round(toNumber(leaseForm.rentDollars) * 100))} / {FREQUENCY_LABELS[leaseForm.frequency].toLowerCase()}</span></p>
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

      {/* Status change */}
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
    </div>
  );
}
