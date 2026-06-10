'use client';

import { useState, useMemo } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
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
  Users,
  Plus,
  Pencil,
  FileText,
  FileSignature,
  CircleDollarSign,
  CalendarDays,
  DoorOpen,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Booth,
  Renter,
  RenterStatus,
  Lease,
  RentFrequency,
  BOOTH_RENTAL_COLLECTIONS,
  FREQUENCY_LABELS,
  formatCents,
  toIsoDate,
} from '@/lib/booth-rental-types';

const RENTER_STATUS_CONFIG: Record
  RenterStatus,
  { label: string; badgeClass: string }
> = {
  prospective: { label: 'Prospective', badgeClass: 'bg-sky-100 text-sky-800' },
  active: { label: 'Active', badgeClass: 'bg-emerald-100 text-emerald-800' },
  past: { label: 'Past', badgeClass: 'bg-slate-200 text-slate-700' },
  archived: { label: 'Archived', badgeClass: 'bg-slate-100 text-slate-500' },
};

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
];

interface RenterFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessName: string;
  specialty: string;
  notes: string;
}

const EMPTY_RENTER_FORM: RenterFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  businessName: '',
  specialty: '',
  notes: '',
};

interface LeaseFormState {
  boothId: string;
  rentDollars: string;
  frequency: RentFrequency;
  dueDay: string;
  firstChargeDate: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  noticeDays: string;
  depositDollars: string;
  depositRefundable: boolean;
  depositConditions: string;
  lateFeeEnabled: boolean;
  lateFeeGraceDays: string;
  lateFeeType: 'flat' | 'percent';
  lateFeeAmountDollars: string;
  lateFeePercent: string;
  houseRules: string;
  signedFile: File | null;
}

function buildEmptyLeaseForm(): LeaseFormState {
  const today = toIsoDate(new Date());
  return {
    boothId: '',
    rentDollars: '',
    frequency: 'weekly',
    dueDay: '1',
    firstChargeDate: today,
    startDate: today,
    endDate: '',
    autoRenew: true,
    noticeDays: '30',
    depositDollars: '',
    depositRefundable: true,
    depositConditions: '',
    lateFeeEnabled: true,
    lateFeeGraceDays: '3',
    lateFeeType: 'flat',
    lateFeeAmountDollars: '25',
    lateFeePercent: '5',
    houseRules: '',
    signedFile: null,
  };
}

function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

const WIZARD_STEPS = ['Booth & rent', 'Deposit & fees', 'Review'] as const;

export default function RentersPage() {
  const { firebaseApp, firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const storage = useMemo(() => getStorage(firebaseApp), [firebaseApp]);

  const rentersRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId))
        : null,
    [firestore, tenantId]
  );
  const boothsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId))
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

  const { data: renters, isLoading: rentersLoading } =
    useCollection<Renter>(rentersRef);
  const { data: booths } = useCollection<Booth>(boothsRef);
  const { data: leases } = useCollection<Lease>(leasesRef);

  const [renterDialogOpen, setRenterDialogOpen] = useState(false);
  const [editingRenterId, setEditingRenterId] = useState<string | null>(null);
  const [renterForm, setRenterForm] =
    useState<RenterFormState>(EMPTY_RENTER_FORM);

  const [leaseDialogOpen, setLeaseDialogOpen] = useState(false);
  const [leaseRenterId, setLeaseRenterId] = useState<string | null>(null);
  const [leaseStep, setLeaseStep] = useState(0);
  const [leaseForm, setLeaseForm] = useState<LeaseFormState>(
    buildEmptyLeaseForm()
  );

  const [saving, setSaving] = useState(false);

  const activeLeaseByRenter = useMemo(() => {
    const map = new Map<string, Lease>();
    (leases ?? []).forEach((lease) => {
      if (lease.status === 'active' || lease.status === 'pending_signature') {
        map.set(lease.renterId, lease);
      }
    });
    return map;
  }, [leases]);

  const boothById = useMemo(() => {
    const map = new Map<string, Booth>();
    (booths ?? []).forEach((booth) => map.set(booth.id, booth));
    return map;
  }, [booths]);

  const vacantBooths = useMemo(
    () => (booths ?? []).filter((booth) => booth.status === 'vacant'),
    [booths]
  );

  const sortedRenters = useMemo(() => {
    const list = renters ? [...renters] : [];
    const statusOrder: Record<RenterStatus, number> = {
      active: 0,
      prospective: 1,
      past: 2,
      archived: 3,
    };
    list.sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        a.lastName.localeCompare(b.lastName)
    );
    return list;
  }, [renters]);

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

  const openCreateRenter = () => {
    setEditingRenterId(null);
    setRenterForm(EMPTY_RENTER_FORM);
    setRenterDialogOpen(true);
  };

  const openEditRenter = (renter: Renter) => {
    setEditingRenterId(renter.id);
    setRenterForm({
      firstName: renter.firstName,
      lastName: renter.lastName,
      email: renter.email,
      phone: renter.phone ?? '',
      businessName: renter.businessName ?? '',
      specialty: renter.specialty ?? '',
      notes: renter.notes ?? '',
    });
    setRenterDialogOpen(true);
  };

  const handleSaveRenter = async () => {
    if (!renterForm.firstName.trim() || !renterForm.email.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      firstName: renterForm.firstName.trim(),
      lastName: renterForm.lastName.trim(),
      email: renterForm.email.trim(),
      phone: renterForm.phone.trim(),
      businessName: renterForm.businessName.trim(),
      specialty: renterForm.specialty.trim(),
      notes: renterForm.notes.trim(),
      updatedAt: now,
    };
    try {
      if (editingRenterId) {
        await updateDoc(
          doc(
            firestore,
            BOOTH_RENTAL_COLLECTIONS.renters(tenantId),
            editingRenterId
          ),
          payload
        );
      } else {
        await addDoc(
          collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId)),
          {
            ...payload,
            status: 'prospective' as RenterStatus,
            stripeCustomerId: null,
            defaultPaymentMethodId: null,
            autopayEnabled: false,
            portalAccessToken: null,
            createdAt: now,
          }
        );
      }
      setRenterDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const openLeaseWizard = (renterId: string) => {
    setLeaseRenterId(renterId);
    setLeaseForm(buildEmptyLeaseForm());
    setLeaseStep(0);
    setLeaseDialogOpen(true);
  };

  const handleBoothSelect = (boothId: string) => {
    const booth = boothById.get(boothId);
    setLeaseForm((prev) => ({
      ...prev,
      boothId,
      rentDollars:
        prev.rentDollars || (booth ? (booth.baseRentCents / 100).toString() : ''),
      frequency: booth ? booth.baseRentFrequency : prev.frequency,
    }));
  };

  const handleCreateLease = async () => {
    if (!leaseRenterId || !leaseForm.boothId) return;
    setSaving(true);
    const now = new Date().toISOString();
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

      const leaseDoc = {
        boothId: leaseForm.boothId,
        renterId: leaseRenterId,
        status: 'active' as const,
        rentAmountCents: Math.round(toNumber(leaseForm.rentDollars) * 100),
        frequency: leaseForm.frequency,
        dueDay: parseInt(leaseForm.dueDay, 10) || 1,
        firstChargeDate: leaseForm.firstChargeDate,
        lastChargeDate: null,
        startDate: leaseForm.startDate,
        endDate: leaseForm.endDate || null,
        autoRenew: leaseForm.autoRenew,
        earlyTerminationNoticeDays: parseInt(leaseForm.noticeDays, 10) || 30,
        deposit:
          depositCents > 0
            ? {
                amountCents: depositCents,
                refundable: leaseForm.depositRefundable,
                refundConditions: leaseForm.depositConditions.trim(),
                collectedLedgerEntryId: null,
                refundedLedgerEntryId: null,
              }
            : null,
        lateFeePolicy: {
          enabled: leaseForm.lateFeeEnabled,
          graceDays: parseInt(leaseForm.lateFeeGraceDays, 10) || 0,
          type: leaseForm.lateFeeType,
          amountCents:
            leaseForm.lateFeeType === 'flat'
              ? Math.round(toNumber(leaseForm.lateFeeAmountDollars) * 100)
              : undefined,
          percent:
            leaseForm.lateFeeType === 'percent'
              ? toNumber(leaseForm.lateFeePercent)
              : undefined,
        },
        includedAmenities: booth?.amenities ?? [],
        houseRules: leaseForm.houseRules.trim(),
        signedDocumentUrl,
        signedAt: signedDocumentUrl ? now : null,
        stripeSubscriptionId: null,
        createdAt: now,
        updatedAt: now,
      };

      const leaseRef = await addDoc(
        collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId)),
        leaseDoc
      );

      await updateDoc(
        doc(
          firestore,
          BOOTH_RENTAL_COLLECTIONS.booths(tenantId),
          leaseForm.boothId
        ),
        { status: 'occupied', currentLeaseId: leaseRef.id, updatedAt: now }
      );

      await updateDoc(
        doc(
          firestore,
          BOOTH_RENTAL_COLLECTIONS.renters(tenantId),
          leaseRenterId
        ),
        { status: 'active', updatedAt: now }
      );

      setLeaseDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleEndLease = async (renter: Renter) => {
    const lease = activeLeaseByRenter.get(renter.id);
    if (!lease) return;
    setSaving(true);
    const now = new Date().toISOString();
    const today = toIsoDate(new Date());
    try {
      await updateDoc(
        doc(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId), lease.id),
        { status: 'ended', lastChargeDate: today, updatedAt: now }
      );
      await updateDoc(
        doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), lease.boothId),
        { status: 'vacant', currentLeaseId: null, updatedAt: now }
      );
      await updateDoc(
        doc(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId), renter.id),
        { status: 'past', updatedAt: now }
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedBooth = boothById.get(leaseForm.boothId);
  const wizardCanAdvance =
    leaseStep === 0
      ? Boolean(leaseForm.boothId && toNumber(leaseForm.rentDollars) > 0)
      : true;
  const dueDayIsWeekday = leaseForm.frequency !== 'monthly';

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Renters
          </h1>
          <p className="text-sm text-muted-foreground">
            The independent professionals renting space in your studio.
          </p>
        </div>
        <Button onClick={openCreateRenter}>
          <Plus className="h-4 w-4 mr-2" />
          Add renter
        </Button>
      </div>

      {rentersLoading && (
        <p className="text-sm text-muted-foreground">Loading renters…</p>
      )}

      {!rentersLoading && sortedRenters.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Users className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No renters yet</p>
            <p className="text-sm text-muted-foreground">
              Add a renter, then set up her lease — booth, rent, deposit, and
              the signed agreement, all in one place.
            </p>
            <Button onClick={openCreateRenter}>
              <Plus className="h-4 w-4 mr-2" />
              Add your first renter
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {sortedRenters.map((renter) => {
          const statusConfig =
            RENTER_STATUS_CONFIG[renter.status] ??
            RENTER_STATUS_CONFIG.prospective;
          const lease = activeLeaseByRenter.get(renter.id);
          const booth = lease ? boothById.get(lease.boothId) : undefined;
          return (
            <Card key={renter.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {renter.firstName} {renter.lastName}
                    </CardTitle>
                    {renter.businessName && (
                      <p className="text-sm text-muted-foreground">
                        {renter.businessName}
                      </p>
                    )}
                  </div>
                  <Badge className={statusConfig.badgeClass}>
                    {statusConfig.label}
                  </Badge>
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
                      <FileText className="h-4 w-4" />
                      {booth ? booth.name : 'Lease'}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CircleDollarSign className="h-4 w-4" />
                      {formatCents(lease.rentAmountCents)} /{' '}
                      {FREQUENCY_LABELS[lease.frequency].toLowerCase()}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      {lease.endDate
                        ? `Through ${lease.endDate}`
                        : 'Month-to-month'}
                    </div>
                    {lease.signedDocumentUrl && (
                      
                        href={lease.signedDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm underline underline-offset-2"
                      >
                        <FileSignature className="h-4 w-4" />
                        Signed agreement
                      </a>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditRenter(renter)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                  {!lease && (
                    <Button size="sm" onClick={() => openLeaseWizard(renter.id)}>
                      <DoorOpen className="h-3.5 w-3.5 mr-1.5" />
                      Set up lease
                    </Button>
                  )}
                  {lease && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => handleEndLease(renter)}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                      End lease
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={renterDialogOpen} onOpenChange={setRenterDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRenterId ? 'Edit renter' : 'Add renter'}
            </DialogTitle>
            <DialogDescription>
              Her independent business — your records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="r-first">First name</Label>
                <Input
                  id="r-first"
                  value={renterForm.firstName}
                  onChange={(e) =>
                    setRenterForm((p) => ({ ...p, firstName: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-last">Last name</Label>
                <Input
                  id="r-last"
                  value={renterForm.lastName}
                  onChange={(e) =>
                    setRenterForm((p) => ({ ...p, lastName: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-email">Email</Label>
              <Input
                id="r-email"
                type="email"
                value={renterForm.email}
                onChange={(e) =>
                  setRenterForm((p) => ({ ...p, email: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="r-phone">Phone</Label>
                <Input
                  id="r-phone"
                  value={renterForm.phone}
                  onChange={(e) =>
                    setRenterForm((p) => ({ ...p, phone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-specialty">Specialty</Label>
                <Input
                  id="r-specialty"
                  placeholder="Nails, hair, lashes…"
                  value={renterForm.specialty}
                  onChange={(e) =>
                    setRenterForm((p) => ({ ...p, specialty: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-business">Business name (optional)</Label>
              <Input
                id="r-business"
                value={renterForm.businessName}
                onChange={(e) =>
                  setRenterForm((p) => ({ ...p, businessName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-notes">Notes (private to you)</Label>
              <Textarea
                id="r-notes"
                value={renterForm.notes}
                onChange={(e) =>
                  setRenterForm((p) => ({ ...p, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenterDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveRenter}
              disabled={
                saving ||
                !renterForm.firstName.trim() ||
                !renterForm.email.trim()
              }
            >
              {saving ? 'Saving…' : editingRenterId ? 'Save changes' : 'Add renter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaseDialogOpen} onOpenChange={setLeaseDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set up lease</DialogTitle>
            <DialogDescription>
              Step {leaseStep + 1} of {WIZARD_STEPS.length}:{' '}
              {WIZARD_STEPS[leaseStep]}
            </DialogDescription>
          </DialogHeader>

          {leaseStep === 0 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Booth</Label>
                <Select
                  value={leaseForm.boothId}
                  onValueChange={handleBoothSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a vacant booth" />
                  </SelectTrigger>
                  <SelectContent>
                    {vacantBooths.length === 0 && (
                      <SelectItem value="none" disabled>
                        No vacant booths — add or free one first
                      </SelectItem>
                    )}
                    {vacantBooths.map((booth) => (
                      <SelectItem key={booth.id} value={booth.id}>
                        {booth.name} — {formatCents(booth.baseRentCents)} /{' '}
                        {FREQUENCY_LABELS[booth.baseRentFrequency].toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="l-rent">Rent ($)</Label>
                  <Input
                    id="l-rent"
                    type="number"
                    value={leaseForm.rentDollars}
                    onChange={(e) =>
                      setLeaseForm((p) => ({ ...p, rentDollars: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <Select
                    value={leaseForm.frequency}
                    onValueChange={(value) =>
                      setLeaseForm((p) => ({
                        ...p,
                        frequency: value as RentFrequency,
                        dueDay: value === 'monthly' ? '1' : p.dueDay,
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{dueDayIsWeekday ? 'Due on' : 'Due day of month'}</Label>
                  {dueDayIsWeekday ? (
                    <Select
                      value={leaseForm.dueDay}
                      onValueChange={(value) =>
                        setLeaseForm((p) => ({ ...p, dueDay: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={leaseForm.dueDay}
                      onChange={(e) =>
                        setLeaseForm((p) => ({ ...p, dueDay: e.target.value }))
                      }
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="l-firstcharge">First charge date</Label>
                  <Input
                    id="l-firstcharge"
                    type="date"
                    value={leaseForm.firstChargeDate}
                    onChange={(e) =>
                      setLeaseForm((p) => ({
                        ...p,
                        firstChargeDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="l-start">Lease start</Label>
                  <Input
                    id="l-start"
                    type="date"
                    value={leaseForm.startDate}
                    onChange={(e) =>
                      setLeaseForm((p) => ({ ...p, startDate: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="l-end">Lease end (blank = month-to-month)</Label>
                  <Input
                    id="l-end"
                    type="date"
                    value={leaseForm.endDate}
                    onChange={(e) =>
                      setLeaseForm((p) => ({ ...p, endDate: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Auto-renew</p>
                  <p className="text-xs text-muted-foreground">
                    Lease continues unless either side gives notice
                  </p>
                </div>
                <Switch
                  checked={leaseForm.autoRenew}
                  onCheckedChange={(checked) =>
                    setLeaseForm((p) => ({ ...p, autoRenew: checked }))
                  }
                />
              </div>
            </div>
          )}

          {leaseStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="l-deposit">Security deposit ($)</Label>
                  <Input
                    id="l-deposit"
                    type="number"
                    placeholder="0 for none"
                    value={leaseForm.depositDollars}
                    onChange={(e) =>
                      setLeaseForm((p) => ({
                        ...p,
                        depositDollars: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="l-notice">Termination notice (days)</Label>
                  <Input
                    id="l-notice"
                    type="number"
                    value={leaseForm.noticeDays}
                    onChange={(e) =>
                      setLeaseForm((p) => ({ ...p, noticeDays: e.target.value }))
                    }
                  />
                </div>
              </div>

              {toNumber(leaseForm.depositDollars) > 0 && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Deposit is refundable</p>
                    <Switch
                      checked={leaseForm.depositRefundable}
                      onCheckedChange={(checked) =>
                        setLeaseForm((p) => ({
                          ...p,
                          depositRefundable: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="l-depcond">Refund conditions</Label>
                    <Textarea
                      id="l-depcond"
                      placeholder="Returned within 14 days of move-out, less any damages or unpaid balance…"
                      value={leaseForm.depositConditions}
                      onChange={(e) =>
                        setLeaseForm((p) => ({
                          ...p,
                          depositConditions: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Late fees</p>
                    <p className="text-xs text-muted-foreground">
                      Applied automatically after the grace period
                    </p>
                  </div>
                  <Switch
                    checked={leaseForm.lateFeeEnabled}
                    onCheckedChange={(checked) =>
                      setLeaseForm((p) => ({ ...p, lateFeeEnabled: checked }))
                    }
                  />
                </div>
                {leaseForm.lateFeeEnabled && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label>Grace days</Label>
                      <Input
                        type="number"
                        value={leaseForm.lateFeeGraceDays}
                        onChange={(e) =>
                          setLeaseForm((p) => ({
                            ...p,
                            lateFeeGraceDays: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Type</Label>
                      <Select
                        value={leaseForm.lateFeeType}
                        onValueChange={(value) =>
                          setLeaseForm((p) => ({
                            ...p,
                            lateFeeType: value as 'flat' | 'percent',
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat $</SelectItem>
                          <SelectItem value="percent">% of rent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>
                        {leaseForm.lateFeeType === 'flat' ? 'Fee ($)' : 'Fee (%)'}
                      </Label>
                      <Input
                        type="number"
                        value={
                          leaseForm.lateFeeType === 'flat'
                            ? leaseForm.lateFeeAmountDollars
                            : leaseForm.lateFeePercent
                        }
                        onChange={(e) =>
                          setLeaseForm((p) =>
                            p.lateFeeType === 'flat'
                              ? { ...p, lateFeeAmountDollars: e.target.value }
                              : { ...p, lateFeePercent: e.target.value }
                          )
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="l-rules">House rules (optional)</Label>
                <Textarea
                  id="l-rules"
                  placeholder="Shared space expectations, hours of access, product policies…"
                  value={leaseForm.houseRules}
                  onChange={(e) =>
                    setLeaseForm((p) => ({ ...p, houseRules: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="l-doc">Signed agreement (PDF, optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="l-doc"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) =>
                      setLeaseForm((p) => ({
                        ...p,
                        signedFile: e.target.files?.[0] ?? null,
                      }))
                    }
                  />
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          )}

          {leaseStep === 2 && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Booth:</span>{' '}
                  <span className="font-medium">
                    {selectedBooth ? selectedBooth.name : '—'}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Rent:</span>{' '}
                  <span className="font-medium">
                    {formatCents(Math.round(toNumber(leaseForm.rentDollars) * 100))}{' '}
                    / {FREQUENCY_LABELS[leaseForm.frequency].toLowerCase()}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">First charge:</span>{' '}
                  <span className="font-medium">{leaseForm.firstChargeDate}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Term:</span>{' '}
                  <span className="font-medium">
                    {leaseForm.startDate} —{' '}
                    {leaseForm.endDate || 'month-to-month'}
                    {leaseForm.autoRenew ? ' (auto-renews)' : ''}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Deposit:</span>{' '}
                  <span className="font-medium">
                    {toNumber(leaseForm.depositDollars) > 0
                      ? `${formatCents(
                          Math.round(toNumber(leaseForm.depositDollars) * 100)
                        )} (${leaseForm.depositRefundable ? 'refundable' : 'non-refundable'})`
                      : 'None'}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Late fee:</span>{' '}
                  <span className="font-medium">
                    {leaseForm.lateFeeEnabled
                      ? leaseForm.lateFeeType === 'flat'
                        ? `${formatCents(
                            Math.round(
                              toNumber(leaseForm.lateFeeAmountDollars) * 100
                            )
                          )} after ${leaseForm.lateFeeGraceDays} grace days`
                        : `${leaseForm.lateFeePercent}% after ${leaseForm.lateFeeGraceDays} grace days`
                      : 'None'}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Agreement:</span>{' '}
                  <span className="font-medium">
                    {leaseForm.signedFile
                      ? leaseForm.signedFile.name
                      : 'Not uploaded'}
                  </span>
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Creating this lease marks the booth occupied and the renter
                active. Rent charges will follow the schedule above.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {leaseStep > 0 && (
              <Button
                variant="outline"
                onClick={() => setLeaseStep((s) => s - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            {leaseStep < WIZARD_STEPS.length - 1 && (
              <Button
                onClick={() => setLeaseStep((s) => s + 1)}
                disabled={!wizardCanAdvance}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {leaseStep === WIZARD_STEPS.length - 1 && (
              <Button onClick={handleCreateLease} disabled={saving}>
                {saving ? 'Creating…' : 'Create lease'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}