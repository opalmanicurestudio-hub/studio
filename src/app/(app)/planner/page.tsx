'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, BarChart, Calendar as CalendarIcon, User, Building, QrCode, Sparkles, CreditCard, AlertTriangle, Square, Undo2, ArrowRight, Hourglass } from 'lucide-react';
import { type Appointment, type Event, type Staff, type Resource, type Membership, type AppointmentCheckoutState, Service, type Client, type Package, type Redemption, type CustomFormula } from '@/lib/data';
import { format, addDays, subDays, startOfWeek, endOfDay, differenceInDays, isPast, isToday, startOfDay, isSameDay, subWeeks, addWeeks, eachDayOfInterval, parseISO, addMinutes, addMonths, subMonths, subMinutes } from 'date-fns';
import { query, where, collection, doc, writeBatch, increment, arrayUnion, deleteField } from 'firebase/firestore';
import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/EventsDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useFirebase, useCollection, useMemoFirebase, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { useIsMobile } from '@/hooks/use-mobile';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { WaitlistSheet } from '@/components/planner/WaitlistSheet';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { ScanCheckInDialog } from '@/components/planner/ScanCheckInDialog';
import { printAppointmentTicket } from '@/lib/appointment-ticket';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { type Transaction, type BillDefinition } from '@/lib/financial-data';
import { DebugErrorBoundary } from '@/components/shared/DebugErrorBoundary';
import { approveBooking, denyBooking, raiseIssue, isAwaitingApproval, isDeadAppointment } from '@/lib/booking-approval';
import { resolveAuthority } from '@/lib/appointment-authority';
import { ReportIssueDialog } from '@/components/planner/ReportIssueDialog';
import { AlertCircle, XCircle } from 'lucide-react';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try { return parseISO(val); } catch { return new Date(val); }
    }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const sanitizeForFirestore = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
};

// v16 — SELF-DIAGNOSIS for React error #130 ("element type is invalid…
// got: undefined"). That error means one of the components imported above
// is undefined at runtime — a named-vs-default export mismatch in its
// file. Instead of guessing which of ~15 imports it is, this checks them
// all and prints the guilty name(s) on screen. Zero cost when all is well.
const IMPORT_CHECK: Record<string, any> = {
  AppHeader, Button, Badge, Label, Separator, ScrollArea, ScrollBar,
  RadioGroup, RadioGroupItem, Tooltip, TooltipProvider, TooltipTrigger, TooltipContent,
  AddAppointmentDialog, EditAppointmentDialog, AddEventDialog, DayTimeline,
  WeeklyKpiSheet, BillsDueSheet, WaitlistSheet, AppointmentDetailsSheet, LogPaymentDialog,
  FloatingActionButton, OverrideCancellationDialog, CancelAppointmentDialog,
  TechnicianReviewDialog, DebugErrorBoundary,
};
const UNDEFINED_IMPORTS = Object.entries(IMPORT_CHECK)
  .filter(([, v]) => v === undefined)
  .map(([k]) => k);

function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');

  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  const { user: currentUser } = useUser();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id;
  const router = useRouter();

  const {
      inventory, clients, services, staff: allStaff, appointments, events: eventsFromInventory,
      walkIns, billDefinitions, billInstances, transactions, memberships, packages, isLoading
  } = useInventory();

  const [showCancelled, setShowCancelled] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [issueFor, setIssueFor] = useState<any | null>(null);
  const [issueBusy, setIssueBusy] = useState(false);
  const [awaitingCursor, setAwaitingCursor] = useState(0);
  const [tmhr, setTmhr] = useState(0);
  useEffect(() => { setTmhr(selectedTenant?.tmhr || 50); }, [selectedTenant]);

  const events = eventsFromInventory || [];

  const studioEventsQ = useMemoFirebase(
    () => !firestore || !tenantId ? null :
      query(collection(firestore, `tenants/${tenantId}/studioEvents`),
        where('status', 'in', ['draft', 'upcoming', 'active', 'completed'])
      ),
    [firestore, tenantId]
  );
  const { data: studioEventsRaw } = useCollection<any>(studioEventsQ);

  const studioEventsToday = useMemo(() => {
    if (!studioEventsRaw) return [];
    return studioEventsRaw.filter(e => {
      const d = e.date ? safeDate(e.date) : e.startTime ? safeDate(e.startTime) : null;
      return d && isSameDay(d, currentDate);
    });
  }, [studioEventsRaw, currentDate]);

  // Tours booked through the public Rentals page land as boothApplications
  // (kind:'tour'). Any with a concrete tourStartIso show on the Studio lane so
  // a solo owner sees tours beside appointments. Declined/cancelled are hidden.
  const tourAppsQ = useMemoFirebase(
    () => !firestore || !tenantId ? null :
      query(collection(firestore, `tenants/${tenantId}/boothApplications`), where('kind', '==', 'tour')),
    [firestore, tenantId]
  );
  const { data: tourAppsRaw } = useCollection<any>(tourAppsQ);

  const toursToday = useMemo(() => {
    if (!tourAppsRaw) return [];
    return tourAppsRaw.filter((t: any) => {
      if (!t || !t.tourStartIso) return false;
      // Hide every resolved state — 'closed' is what the "Resolve" button sets,
      // so without it a handled tour lingered on the planner all day.
      if (['declined', 'cancelled', 'closed', 'completed', 'archived', 'no_show', 'done', 'converted'].includes(String(t.status || ''))) return false;
      const d = safeDate(t.tourStartIso);
      return d && !isNaN(d.getTime()) && isSameDay(d, currentDate);
    });
  }, [tourAppsRaw, currentDate]);

  // Paid day/hourly reservations (from the reserve API, via Stripe) land here so
  // the Studio lane is one unified calendar — appointments, tours, and rentals.
  const reservationsQ = useMemoFirebase(
    () => !firestore || !tenantId ? null :
      query(collection(firestore, `tenants/${tenantId}/boothReservations`), where('status', 'in', ['confirmed', 'checked_in'])),
    [firestore, tenantId]
  );
  const { data: reservationsRaw } = useCollection<any>(reservationsQ);

  const reservationsToday = useMemo(() => {
    if (!reservationsRaw) return [];
    const cd = currentDate;
    const curIso = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
    return (reservationsRaw as any[]).filter(r =>
      r && r.startDate && r.startDate <= curIso && (r.endDate || r.startDate) >= curIso);
  }, [reservationsRaw, currentDate]);

  // ── MAINTENANCE ON THE PLANNER ──────────────────────────────────────
  // Two live feeds keep every planner honest about spaces nobody can use:
  // open blocking tickets (urgent/high, unresolved → the station is out of
  // service until fixed) and preventive-maintenance plans (nextRunAt = the
  // day the work happens — visible when browsing ahead, not just today).
  // They render as blocked time on the Studio lane, on the matching
  // resource column, and as secondary blocks on every staff column, so
  // the whole team sees it before anyone books into a dead space.
  const openTicketsQ = useMemoFirebase(
    () => !firestore || !tenantId ? null :
      query(collection(firestore, `tenants/${tenantId}/tickets`), where('status', 'in', ['open', 'in_progress'])),
    [firestore, tenantId]
  );
  const { data: openTicketsRaw } = useCollection<any>(openTicketsQ);
  const maintPlansQ = useMemoFirebase(
    () => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/maintenancePlans`),
    [firestore, tenantId]
  );
  const { data: maintPlansRaw } = useCollection<any>(maintPlansQ);

  const maintenanceToday = useMemo(() => {
    const items: any[] = [];
    const cd = currentDate;
    const curIso = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
    // Blocking tickets: the space is down from the day it was reported
    // until someone marks it resolved.
    (openTicketsRaw || []).forEach((t: any) => {
      if (!['urgent', 'high'].includes(String(t.priority || ''))) return;
      const created = String(t.createdAt || '').slice(0, 10);
      if (created && created > curIso) return; // not reported yet on this day
      items.push({
        kind: 'ticket', id: t.id,
        title: `Out of service — ${t.boothName || t.resourceName || t.title}`,
        detail: `${t.title}${t.assigneeName ? ` · ${t.assigneeName} on it` : ' · unassigned'}`,
        resourceId: t.resourceId || null, status: t.status,
      });
    });
    // Scheduled preventive runs: pinned to the exact day the ticket opens.
    (maintPlansRaw || []).forEach((p: any) => {
      if (p.active === false) return;
      if (String(p.nextRunAt || '') !== curIso) return;
      items.push({
        kind: 'plan', id: p.id,
        title: `Scheduled maintenance — ${p.boothName || p.resourceName || p.title}`,
        detail: `${p.title}${p.assigneeName ? ` · ${p.assigneeName}` : ''} · repeats every ${p.everyDays} days`,
        resourceId: p.resourceId || null, status: 'scheduled',
      });
    });
    return items;
  }, [openTicketsRaw, maintPlansRaw, currentDate]);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [isWaitlistSheetOpen, setIsWaitlistSheetOpen] = useState(false);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [clientForNewApt, setClientForNewApt] = useState<Client | null>(null);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);

  const { toast } = useToast();
  const [mobileSelectedColumnId, setMobileSelectedColumnId] = useState<string>('');
  const [activeView, setActiveView] = useState<'staff' | 'resources'>(viewParam === 'resources' ? 'resources' : 'staff');

  const onMobileColumnChange = useCallback((id: string) => {
    setMobileSelectedColumnId(id);
  }, []);

  const { data: scheduleProfilesData } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]));
  const { data: resourcesData } = useCollection<Resource>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'resources'), [firestore, tenantId]));
  const publicScheduleProfile = useMemo(() => scheduleProfilesData?.find(p => p.isActive), [scheduleProfilesData]);

  // Lounge orders, so the printed ticket can list what the guest has already had
  // brought to them. Same plain subscription the kitchen board uses.
  const { data: refreshmentRequests } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'refreshmentRequests'), [firestore, tenantId]));

  // The waiting list. Front desk writes it from Quick Book; the walk-in kiosk
  // writes it through /api/waitlist when every chair is full. Until now nothing
  // read it back out, so the "we'll notify you when a slot opens" promise had
  // no machinery behind it. The sheet below is that machinery.
  const { data: waitlistRaw } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'waitlist'), [firestore, tenantId]));

  const waitlistEntries = useMemo(() => waitlistRaw || [], [waitlistRaw]);

  // Badge count is people still WAITING — a booked or removed row is history,
  // and a badge that counts history would never go down.
  const openWaitlistCount = useMemo(() => {
    const closed = ['booked', 'closed', 'cancelled', 'expired', 'declined', 'converted', 'done'];
    return waitlistEntries.filter((e: any) => !closed.includes(String(e?.status || 'waiting'))).length;
  }, [waitlistEntries]);

  const staff = useMemo(() => {
    // Skip "ghost" staff docs — records with no name AND no role. These are
    // created accidentally when a merge-write (status/lastBookingAssignedAt)
    // fires against a provider id that has no real staff record yet. They have
    // no business appearing as a bookable provider column, so we hide them
    // here. (A real provider always has a name.)
    const real = (allStaff || []).filter((s: any) => s && (s.name || '').trim());
    if (role === 'staff' && currentUser) return real.filter((s: any) => s.id === currentUser.uid);
    return real;
  }, [allStaff, role, currentUser]);

  const columns = useMemo(() => {
    let cols: any[] = activeView === 'staff' ? (staff || []) : (resourcesData || []);
    if (role === 'owner' || role === 'admin') cols = [{ id: 'business', name: 'Studio', isBusiness: true }, ...cols];
    return cols;
  }, [activeView, staff, resourcesData, role]);

  useEffect(() => {
    if (columns.length > 0 && !mobileSelectedColumnId) setMobileSelectedColumnId(columns[0].id);
  }, [columns, mobileSelectedColumnId]);

  useEffect(() => {
    const rebookAptId = searchParams.get('rebook_apt_id');
    if (rebookAptId && appointments && appointments.length > 0) {
      const apt = appointments.find((a: Appointment) => a.id === rebookAptId);
      if (apt) {
        setAppointmentToRebook(apt);
        setClientForNewApt(null);
        setIsAddAppointmentOpen(true);
        router.replace('/planner');
      }
    }
  }, [searchParams, appointments, router]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 0 }), i)), [currentDate]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, (Appointment | Event | any)[]>();
    (columns || []).forEach(c => map.set(c.id, []));
    const targetDateStart = startOfDay(currentDate);

    appointments?.filter(a => isSameDay(safeDate(a.startTime), targetDateStart))
      .filter(a => showCancelled || !isDeadAppointment(a))
      .forEach(a => {
        if (activeView === 'staff') {
            const involvedIds = new Set<string>();
            if (a.staffId) involvedIds.add(a.staffId);
            if (a.checkoutState?.serviceStaffOverrides) {
                Object.values(a.checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            }
            Array.from(involvedIds).forEach(sid => {
                if (map.has(sid)) map.get(sid)!.push({ ...a, itemType: 'appointment', isSecondary: sid !== a.staffId } as any);
            });
        } else {
            (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); });
        }
    });

    if (map.has('business')) {
        billInstances?.filter(i => isSameDay(safeDate(i.dueDate), targetDateStart)).forEach(i => {
            const def = (billDefinitions || []).find(d => d.id === i.billDefinitionId);
            map.get('business')!.push({ ...i, definition: def, itemType: 'bill' } as any);
        });

        studioEventsToday.forEach(se => {
            let startTime: string;
            if (se.startTime) {
                startTime = typeof se.startTime === 'string' ? se.startTime : safeDate(se.startTime).toISOString();
            } else if (se.date && se.time) {
                try {
                    const d = safeDate(se.date);
                    const [timePart, meridian] = se.time.split(' ');
                    const [h, m] = timePart.split(':').map(Number);
                    let hours = h;
                    if (meridian?.toUpperCase() === 'PM' && h !== 12) hours += 12;
                    if (meridian?.toUpperCase() === 'AM' && h === 12) hours = 0;
                    d.setHours(hours, m || 0, 0, 0);
                    startTime = d.toISOString();
                } catch {
                    const d = safeDate(se.date);
                    d.setHours(9, 0, 0, 0);
                    startTime = d.toISOString();
                }
            } else {
                const d = safeDate(se.date || new Date());
                d.setHours(9, 0, 0, 0);
                startTime = d.toISOString();
            }

            let endTime: string;
            if (se.endTime) {
                endTime = typeof se.endTime === 'string' ? se.endTime : safeDate(se.endTime).toISOString();
            } else {
                endTime = addMinutes(safeDate(startTime), (se.durationMinutes || 180)).toISOString();
            }

            map.get('business')!.push({
                ...se,
                itemType:    'studio_event',
                startTime,
                endTime,
                id:          se.id,
                title:       se.title || se.name || 'Event',
                status:      se.status,
                guestCount:  se.guestCount || 0,
                isStudioEvent: true,
            } as any);
        });

        toursToday.forEach(t => {
            const start = safeDate(t.tourStartIso);
            const end = t.tourEndIso ? safeDate(t.tourEndIso) : addMinutes(start, 20);
            map.get('business')!.push({
                id:        `tour-${t.id}`,
                itemType:  'event',
                type:      'tour',
                title:     `Tour — ${t.name || 'Guest'}`,
                name:      `Tour — ${t.name || 'Guest'}`,
                startTime: start.toISOString(),
                endTime:   (isNaN(end.getTime()) ? addMinutes(start, 20) : end).toISOString(),
                allDay:    false,
                staffIds:  [],
                checklist: [],
                guestCount: 0,
                notes:     [t.boothName, t.phone, t.email].filter(Boolean).join(' · '),
                location:  t.boothName || '',
                status:    t.status || 'new',
                guestName: t.name || 'Guest',
                boothName: t.boothName || null,
                phone:     t.phone || null,
                email:     t.email || null,
                tourTimeTBD: !!t.tourTimeTBD,
                isTourRequest: true,
            } as any);
        });

        reservationsToday.forEach(r => {
            const cd = currentDate;
            const curIso = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
            const isHourly = r.bookingType === 'hourly' && r.startTime && r.endTime;
            const start = safeDate(`${curIso}T${isHourly ? r.startTime : '09:00'}:00`);
            const end = safeDate(`${curIso}T${isHourly ? r.endTime : '17:00'}:00`);
            map.get('business')!.push({
                id:        `resv-${r.id}-${curIso}`,
                itemType:  'event',
                type:      'reservation',
                title:     `${isHourly ? 'Hourly' : 'Day'} rental — ${r.name || 'Guest'}`,
                name:      `${r.boothName || 'Space'} · ${r.name || 'Guest'}`,
                startTime: start.toISOString(),
                endTime:   end.toISOString(),
                allDay:    !isHourly,
                staffIds:  [],
                checklist: [],
                guestCount: 0,
                notes:     [r.boothName, r.phone].filter(Boolean).join(' · '),
                location:  r.boothName || '',
                status:    r.status,
                guestName: r.name || 'Guest',
                boothName: r.boothName || null,
                phone:     r.phone || null,
                email:     r.email || null,
                bookingType: isHourly ? 'hourly' : 'daily',
                checkedInAt: r.checked_inAt || null,
                bookedEndIso: isHourly ? end.toISOString() : null,
                overageStatus: r.overageStatus || null,
                overageDueCents: r.overageDueCents || 0,
                balanceDueCents: r.balancePaid ? 0 : (r.balanceDueCents || 0),
                overageRateCentsPerHour: isHourly ? ((): number => { const h = (end.getTime() - start.getTime()) / 3600000; return h > 0 ? Math.round((r.amountCents || 0) / h) : 0; })() : 0,
                isReservation: true,
            } as any);
        });
    }

    events?.filter(e => isSameDay(safeDate(e.startTime), targetDateStart)).forEach(e => {
        const targetStaffIds = e.staffIds || [];
        const isGlobal = targetStaffIds.length === 0 || targetStaffIds.includes('all');
        if (isGlobal) {
            if (map.has('business')) map.get('business')!.push({ ...e, itemType: 'event' } as any);
            if (e.type === 'blocked' && activeView === 'staff') {
                columns.forEach(col => {
                    if (col.id !== 'business' && map.has(col.id)) map.get(col.id)!.push({ ...e, itemType: 'event', isSecondary: true } as any);
                });
            }
        } else if (activeView === 'staff') {
            targetStaffIds.forEach(sid => { if (map.has(sid)) map.get(sid)!.push({ ...e, itemType: 'event' } as any); });
        }
    });

    // Maintenance blocks propagate exactly like global blocked events: the
    // Studio lane gets the primary item, the matching resource column gets
    // it in resources view, and every staff column gets a secondary copy —
    // staff see "Out of service — Station 3" on THEIR planner, not just
    // the owner's, so nobody plans a day around a space they can't occupy.
    maintenanceToday.forEach((mi) => {
        const start = new Date(targetDateStart); start.setHours(9, 0, 0, 0);
        const end = new Date(targetDateStart); end.setHours(17, 0, 0, 0);
        const base = {
            id: `maint-${mi.kind}-${mi.id}`,
            itemType: 'event', type: 'blocked',
            title: mi.title, name: mi.title,
            startTime: start.toISOString(), endTime: end.toISOString(),
            allDay: true, staffIds: [], checklist: [], guestCount: 0,
            notes: mi.detail, location: '', status: mi.status,
            isMaintenance: true,
        } as any;
        if (map.has('business')) map.get('business')!.push(base);
        if (activeView === 'resources' && mi.resourceId && map.has(mi.resourceId)) {
            map.get(mi.resourceId)!.push({ ...base, isSecondary: true });
        }
        if (activeView === 'staff') {
            columns.forEach(col => {
                if (col.id !== 'business' && map.has(col.id)) map.get(col.id)!.push({ ...base, isSecondary: true });
            });
        }
    });

    map.forEach(items => items.sort((a, b) => safeDate(a.startTime || a.dueDate).getTime() - safeDate(b.startTime || b.dueDate).getTime()));
    return map;
  }, [currentDate, appointments, columns, activeView, showCancelled, billInstances, billDefinitions, events, studioEventsToday, toursToday, reservationsToday, maintenanceToday]);

  const kpis = useMemo(() => {
    if (!transactions || !appointments || !services || !selectedTenant) return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    const start = startOfWeek(currentDate);
    const end = endOfDay(addDays(start, 6));
    const weeklyTransactions = transactions.filter(t => { const d = safeDate(t.date); return d >= start && d <= end; });
    const revenue = weeklyTransactions.filter(t => t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail')).reduce((acc, t) => acc + t.amount, 0);
    const absorbed = weeklyTransactions.filter(t => t.type === 'expense' && t.category === 'Discounts').reduce((acc, t) => acc + t.amount, 0);
    const waivedTotal = (appointments || []).filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && a.cancellationFeeWaived; }).reduce((acc, a) => acc + (a.cancellationFeeApplied || 0), 0);
    const projected = (appointments || []).filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && (a.status === 'confirmed' || a.status === 'deposit_pending'); }).reduce((acc, a) => { const svc = services.find(s => s.id === a.serviceId); return acc + (svc?.price || 0); }, 0);
    const weeklyBreakEven = ((selectedTenant.tmhr || 50) * 160 / 30.44) * 7;
    return { weeklyRevenue: revenue, projectedRevenue: projected, weeklyBreakEven, weeklyNetProfit: revenue - weeklyBreakEven, absorbedCosts: absorbed + waivedTotal };
  }, [transactions, appointments, services, currentDate, selectedTenant]);

  // ── Stuck appointments: servicing or ready_for_checkout from a previous day ──
  const stuckAppointments = useMemo(() => {
    if (!appointments) return [];
    return appointments.filter(a =>
      ['servicing', 'ready_for_checkout'].includes(a.status) &&
      !isSameDay(safeDate(a.startTime), currentDate)
    );
  }, [appointments, currentDate]);

  const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
    if (!firestore || !tenantId || !selectedTenant) return;
    const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
    const tmhrValue = selectedTenant.tmhr || 50;
    const premium = selectedTenant.lateInconveniencePremium || 0;

    if (status === 'running_late' && lateMinutes && !isWalkIn) {
        const apt = appointments?.find(a => a.id === id);
        if (apt) {
            const grace = selectedTenant.lateArrivalGracePeriod || 15;
            const autoCancel = selectedTenant.autoCancelLateArrivals === true;
            const primarySvc = services?.find(s => s.id === apt.serviceId);
            const addOns = (apt.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
            const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
            const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
            const fullSessionBlock = totalDur + totalPadding;
            const staffId = apt.staffId;
            let clash = null;

            if (staffId) {
                const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
                const nextApt = (appointments || []).filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime)).sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];
                if (nextApt) {
                    const nextService = services?.find(s => s.id === nextApt.serviceId);
                    const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                    if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                }
            }

            if ((lateMinutes > grace && autoCancel) || clash) {
                const cancelReason = clash ? 'clash' : 'late';
                const overheadRecovery = (fullSessionBlock / 60) * tmhrValue;
                const materialRecovery = (primarySvc?.cost || 0) + addOns.reduce((sum, a) => sum + (a.cost || 0), 0);
                const fee = Number((overheadRecovery + materialRecovery).toFixed(2));
                const batch = writeBatch(firestore);
                batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
                if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Profitable Auto-Cancel: ${clash ? 'Clash with next session' : 'Beyond grace period'} (${fullSessionBlock}m session block)` })) });
                batch.commit().then(() => toast({ variant: "destructive", title: clash ? "Conflict: Auto-Cancelled" : "Late: Auto-Cancelled", description: clash ? `Session block overlaps with session at ${clash.clashTime}.` : `Arrival of +${lateMinutes}m is beyond grace.` }));
                return;
            } else if (lateMinutes > grace) {
                const timeLostCost = (lateMinutes / 60) * tmhrValue;
                const fee = Number((timeLostCost + premium).toFixed(2));
                const batch = writeBatch(firestore);
                batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes }));
                if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Dynamic Late Penalty: +${lateMinutes}m (Foundation Recovery + Premium)` })) });
                batch.commit().then(() => toast({ title: "Status Updated: Fee Applied", description: `Client accommodated with a $${fee.toFixed(2)} penalty.` }));
                return;
            }
        }
    }

    const updates: any = { checkInStatus: status };
    if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
    updateDocumentNonBlocking(docRef, updates);
    toast({ title: "Status Updated" });
  };

  const handleConfirmCancellation = async (data: any) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    const clientRef = doc(firestore, 'tenants', tenantId, 'clients', selectedAppointment.clientId);
    const currentClient = (clients || []).find(c => c.id === selectedAppointment.clientId);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    batch.update(appointmentRef, sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount, cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid') }));
    if (selectedAppointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, tenantId }));
    if (selectedAppointment.checkInToken) batch.set(doc(firestore, 'tenants', tenantId, 'appointmentCheckIns', selectedAppointment.checkInToken), sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, tenantId }), { merge: true });

    // ── SIBLINGS OF THE SAME VISIT ──────────────────────────────────────────
    // A multi-provider visit is one appointment row per leg: colour with Ana,
    // then cut with Bea. Voiding one leg used to leave the others on the books,
    // so a client who cancelled still showed up as expected for her cut, her
    // chair stayed held, and her tech's day never freed up. The legs are one
    // visit and cancel together.
    //
    // A party is one row per guest. Those are different PEOPLE, so a guest
    // cancelling never touches anyone else — but voiding the ORGANIZER's row
    // voids the party, because that is what "cancel the party of five" means.
    // Nothing here is silent: the toast says exactly how many rows were voided.
    const siblingVisitId = (selectedAppointment as any).multiProviderGroupId || null;
    const partyId = (selectedAppointment as any).isPrimaryGroup ? ((selectedAppointment as any).groupBookingId || null) : null;
    const siblings = (siblingVisitId || partyId)
        ? (appointments || []).filter((s: any) => {
            if (s.id === selectedAppointment.id) return false;
            if (['cancelled', 'canceled', 'completed', 'no_show'].includes(String(s.status || ''))) return false;
            if (siblingVisitId && s.multiProviderGroupId === siblingVisitId) return true;
            if (partyId && s.groupBookingId === partyId) return true;
            return false;
        })
        : [];
    siblings.forEach((s: any) => {
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', s.id), sanitizeForFirestore({
            status: 'cancelled',
            cancellationReason: data.reason,
            cancelledWithAppointmentId: selectedAppointment.id,
        }));
        // set-with-merge, not update: a mirror that was never written would
        // fail the whole batch and take the real cancellation down with it.
        if (s.checkInToken) {
            batch.set(doc(firestore, 'appointmentCheckIns', s.checkInToken), sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, tenantId }), { merge: true });
            batch.set(doc(firestore, 'tenants', tenantId, 'appointmentCheckIns', s.checkInToken), sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, tenantId }), { merge: true });
        }
    });

    if (data.chargeFee && data.feeAmount > 0) {
        if (data.paymentMethod === 'card_on_file') {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ date: now, description: `Cancellation Fee: ${selectedAppointment.clientName}`, clientOrVendor: selectedAppointment.clientName || 'Client', clientId: selectedAppointment.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: data.feeAmount, paymentMethod: 'Card on File', hasReceipt: false, appointmentId: selectedAppointment.id, staffId: selectedAppointment.staffId }));
        } else if (data.paymentMethod === 'add_to_balance') {
            batch.update(clientRef, { unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: selectedAppointment.id, appointmentDate: safeDate(selectedAppointment.startTime).toISOString(), feeAmount: data.feeAmount, reason: `Late Cancellation: ${data.reason.replace('_', ' ')}`, staffId: selectedAppointment.staffId })), outstandingBalance: increment(data.feeAmount) });
        }
    }

    if (currentClient && (data.reason === 'late' || data.reason === 'no-show' || data.reason === 'client_request')) {
        const isLateOrNoShow = data.reason === 'late' || data.reason === 'no-show';
        if (currentClient.activeMembershipId) {
            const membership = (memberships || []).find(m => m.id === currentClient.activeMembershipId);
            const shouldForfeit = (data.reason === 'no-show' && membership?.forfeitOnNoShow) || (data.reason === 'late' && membership?.forfeitOnLateCancel);
            if (shouldForfeit) {
                const perkId = selectedAppointment.serviceId;
                const currentUsage = currentClient.subscription?.perkUsage || {};
                batch.update(clientRef, { 'subscription.perkUsage': { ...currentUsage, [perkId]: (currentUsage[perkId] || 0) + 1 }, 'subscription.perkLastUsed': now });
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
                batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: currentClient.id, type: 'membership', offeringId: membership!.id, offeringName: membership!.name, serviceId: selectedAppointment.serviceId, serviceName: services.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true }));
            }
        }
        const activePack = currentClient.activePackages?.find(p => { const pkgDef = (packages || []).find(pkg => pkg.id === p.packageId); return pkgDef?.serviceId === selectedAppointment.serviceId; });
        if (activePack && isLateOrNoShow) {
            const nextPackages = currentClient.activePackages!.map(p => p.packageId === activePack.packageId ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
            batch.update(clientRef, { activePackages: nextPackages });
            const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
            const pkgDef = packages.find(pkg => pkg.id === activePack.packageId);
            batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: currentClient.id, type: 'package', offeringId: activePack.packageId, offeringName: pkgDef?.name || 'Package', serviceId: selectedAppointment.serviceId, serviceName: services.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true }));
        }
    }

    try {
        await batch.commit();
        toast({
            title: "Policy Enforced",
            description: siblings.length > 0
                ? `Appointment voided along with ${siblings.length} linked ${siblings.length === 1 ? 'booking' : 'bookings'} on the same visit.`
                : "Appointment voided and logic reconciled.",
        });
    } catch (e) {
        toast({ variant: 'destructive', title: "Process Error" });
    }
    setIsCancelDialogOpen(false);
    setIsDetailsOpen(false);
  };

  const handleStartService = (id: string) => {
    if (!firestore || !tenantId || !appointments) return;
    const now = new Date().toISOString();
    const appointment = appointments.find(a => a.id === id);
    if (!appointment) return;
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', id), { status: 'servicing', actualStartTime: now });
    if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
    if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
    batch.commit();
  };

  const handleFinishService = (apt: Appointment) => { setSelectedAppointment(apt); setIsTechnicianReviewOpen(true); };

  /**
   * Prints the guest ticket.
   *
   * The appointment document stores IDs, not names — there is no serviceName and
   * no price on it — so everything the ticket displays is resolved here from the
   * collections this page already holds in memory, and handed to the printer as
   * plain strings. `onPrintTicket` is called with the appointment alone, which is
   * why this resolution cannot live in the caller.
   */
  const handlePrintTicket = useCallback((aptArg: any) => {
    // Prefer the live copy from state: the row a card was rendered with can be a
    // few seconds stale, and the check-in status is exactly what changes.
    const apt = (appointments || []).find((a: any) => a?.id === aptArg?.id) || aptArg;
    if (!apt) return;

    const client = (clients || []).find((c: any) => c.id === apt.clientId) || null;
    const service = (services || []).find((s: any) => s.id === apt.serviceId) || null;
    const provider = (allStaff || []).find((s: any) => s.id === apt.staffId) || null;

    // Tiered pricing, resolved the same way the checkout resolves it, so the
    // ticket never quotes a price the register will not charge.
    const tierPrice = (service as any)?.serviceTiers?.find(
      (t: any) => t.tierId === (provider as any)?.pricingTierId
    )?.price;
    const dollars = tierPrice ?? (service as any)?.price;
    const priceCents = typeof dollars === 'number' && isFinite(dollars) ? Math.round(dollars * 100) : null;

    const addOnNames = ((apt.addOnIds || []) as string[])
      .map((id) => (services || []).find((s: any) => s.id === id)?.name)
      .filter((n): n is string => !!n);

    const resourceNames = ((apt.requiredResourceIds || []) as string[])
      .map((id) => (resourcesData || []).find((r: any) => r.id === id)?.name)
      .filter((n): n is string => !!n);

    // Lounge orders for THIS visit only, and never a cancelled one.
    const amenities = (refreshmentRequests || [])
      .filter((r: any) => r && r.appointmentId && r.appointmentId === apt.id)
      .filter((r: any) => !['cancelled', 'canceled', 'recalled'].includes(String(r.status || '').toLowerCase()))
      .map((r: any) => ({ name: r.itemName || 'Amenity', quantity: safeNumber(r.quantity || 1) || 1, status: r.status || null }));

    const t: any = selectedTenant || {};
    const opened = printAppointmentTicket(apt, {
      studioName: t.name || null,
      studioPhone: t.phone || null,
      studioEmail: t.email || null,
      studioAddress: t.address || null,
      clientName: (client as any)?.name || null,
      clientPhone: (client as any)?.phone || null,
      serviceName: (service as any)?.name || null,
      addOnNames,
      staffName: (provider as any)?.name || null,
      resourceNames,
      priceCents,
      amenities,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
    });

    // A blocked popup is silent — without this the owner presses Print and
    // nothing at all appears to happen.
    if (!opened) {
      toast({
        variant: 'destructive',
        title: 'Allow popups to print',
        description: 'Your browser blocked the ticket window. Allow popups for this site, then press Print again.',
      });
    }
  }, [appointments, clients, services, allStaff, resourcesData, refreshmentRequests, selectedTenant, toast]);

  /**
   * Marks a guest as arrived from the front desk.
   *
   * Only the top-level `appointmentCheckIns` mirror is written here, never the
   * scoped `tenants/{id}/appointmentCheckIns` copy — that one is `allow write: if
   * false` in firestore.rules, so touching it would fail the whole batch and the
   * check-in would silently not happen.
   */
  const handleDeskCheckIn = useCallback((aptArg: any) => {
    if (!firestore || !tenantId || !aptArg?.id) return;
    const apt = (appointments || []).find((a: any) => a?.id === aptArg.id) || aptArg;
    const now = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', apt.id), {
      checkInStatus: 'arrived',
      checkInStatusTimestamp: now,
      checkedInAt: now,
    });
    if (apt.checkInToken) {
      batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { checkInStatus: 'arrived', checkInStatusTimestamp: now, checkedInAt: now, tenantId }, { merge: true });
    }
    batch.commit()
      .then(() => toast({ title: 'Checked in', description: `${(clients || []).find((c: any) => c.id === apt.clientId)?.name || 'Guest'} is marked as arrived.` }))
      .catch(() => toast({ variant: 'destructive', title: 'Check-in failed', description: 'The arrival was not saved. Try again.' }));
  }, [firestore, tenantId, appointments, clients, toast]);

  const handleUpdateAppointment = (apt: Appointment) => {
    if (!firestore || !tenantId) return;
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', apt.id), apt);
    if (apt.checkInToken) updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { ...apt, tenantId });
    setIsEditAppointmentOpen(false);
    toast({ title: "Session Updated" });
  };

  const handleOverrideConfirm = async (staffId: string, reason: string) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id), { status: 'confirmed', checkInStatus: 'pending', overrideReason: reason, overriddenBy: staffId, cancellationReason: deleteField() as any, cancellationFeeApplied: 0 });
    if (selectedAppointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), { status: 'confirmed', checkInStatus: 'pending', tenantId });
    try {
        await batch.commit();
        setIsOverrideOpen(false);
        setIsDetailsOpen(false);
        toast({ title: "Cancellation Overridden" });
    } catch (e) {
        toast({ variant: 'destructive', title: "Override Failed" });
    }
  };

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId) return;
    const apt = (appointments || []).find(a => a.id === appointmentId);
    if (!apt) return;
    const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
    const completedIds = checkoutState.completedServiceIds || [];
    const allComplete = completedIds.length >= allPartIds.length;
    const batch = writeBatch(firestore);
    const sanitizedCheckoutState = sanitizeForFirestore(checkoutState);

    // Promote the technician's checkout note to a PERMANENT field on the
    // appointment. It is also kept inside checkoutState for the checkout screen,
    // but checkoutState gets rewritten wholesale on every hand-off, so anything
    // that needs to survive has to live at the top level. This is the field the
    // appointment drawer reads and lets you edit afterwards.
    const reviewNote = typeof checkoutState.reviewNotes === 'string' ? checkoutState.reviewNotes.trim() : '';
    const notePromotion = reviewNote
      ? { serviceNotes: reviewNote, serviceNotesRecordedAt: new Date().toISOString() }
      : {};

    if (checkoutState.saveAsCustomFormula && checkoutState.customFormulaName && apt.clientId) {
        const newFormula: CustomFormula = { id: nanoid(), name: checkoutState.customFormulaName, date: new Date().toISOString(), items: checkoutState.formula || [], notes: checkoutState.reviewNotes };
        batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { customFormulas: arrayUnion(sanitizeForFirestore(newFormula)) });
    }

    if (allComplete) {
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), sanitizeForFirestore({ status: 'ready_for_checkout', checkoutState: sanitizedCheckoutState, actualEndTime: new Date().toISOString(), ...notePromotion }));
        if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ status: 'ready_for_checkout', tenantId }));
        const involvedIds = new Set<string>();
        if (apt.staffId) involvedIds.add(apt.staffId);
        if (checkoutState.serviceStaffOverrides) Object.values(checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
        involvedIds.forEach(sid => batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }));
    } else {
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), sanitizeForFirestore({ checkoutState: sanitizedCheckoutState, ...notePromotion }));
        const overrides = checkoutState.serviceStaffOverrides || {};
        const involvedStaffIdsSet = new Set<string>();
        if (apt.staffId) involvedStaffIdsSet.add(apt.staffId);
        Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedStaffIdsSet.add(id); });
        involvedStaffIdsSet.forEach(sid => {
            const hasRemainingParts = allPartIds.some(pid => { if (completedIds.includes(pid)) return false; return (overrides[pid] === sid || (pid === apt.serviceId && apt.staffId === sid && !overrides[pid])); });
            if (!hasRemainingParts) batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
        });
        const nextPartId = allPartIds.find(id => !completedIds.includes(id) && !(checkoutState.concurrentServiceIds || []).includes(id));
        const nextStaffId = overrides[nextPartId || ''] || (nextPartId === apt.serviceId ? apt.staffId : null);
        if (nextStaffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', nextStaffId), { status: 'busy' }, { merge: true });
    }

    batch.commit().then(() => { toast({ title: allComplete ? "Service Finished" : "Part Completed", description: allComplete ? "Ready for checkout." : "Hand-off confirmed." }); setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); });
  };

  const cancelledToday = useMemo(
    () => (appointments || []).filter(a =>
      isSameDay(safeDate(a.startTime), startOfDay(currentDate)) && isDeadAppointment(a)).length,
    [appointments, currentDate],
  );

  const awaitingUpcoming = useMemo(() => {
    const floor = startOfDay(new Date()).getTime();
    return (appointments || [])
      .filter(a => isAwaitingApproval(a) && safeDate(a.startTime).getTime() >= floor)
      .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  }, [appointments]);

  const jumpToNextAwaiting = useCallback(() => {
    if (awaitingUpcoming.length === 0) return;
    const idx = awaitingCursor % awaitingUpcoming.length;
    const target = awaitingUpcoming[idx];
    setAwaitingCursor(idx + 1);
    const when = safeDate(target.startTime);
    if (!isSameDay(when, currentDate)) setCurrentDate(when);
    if (activeView === 'staff' && target.staffId) setMobileSelectedColumnId(target.staffId);
    setFocusId(target.id);
  }, [awaitingUpcoming, awaitingCursor, currentDate, activeView]);

  const revealCancelled = useCallback(() => {
    const next = !showCancelled;
    setShowCancelled(next);
    if (!next) { setFocusId(null); return; }
    const first = (appointments || [])
      .filter(a => isSameDay(safeDate(a.startTime), startOfDay(currentDate)) && isDeadAppointment(a))
      .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];
    if (first) setFocusId(first.id);
  }, [showCancelled, appointments, currentDate]);

  const authorityPolicy = useMemo(
    () => (selectedTenant as any)?.appointmentAuthority || null,
    [selectedTenant],
  );

  /* The same resolution the server runs, so the button says the right word
   * before the round trip. The server is still the one that enforces it. */
  const myAuthority = useMemo(() => {
    const me = (allStaff || []).find((s: any) => s.id === currentUser?.uid || s.userId === currentUser?.uid);
    return resolveAuthority({
      isManager: role === 'owner' || role === 'admin' || (me as any)?.role === 'manager',
      employmentModel: (me as any)?.employmentModel || null,
      decisionAuthority: (me as any)?.decisionAuthority || null,
      policy: authorityPolicy,
    });
  }, [allStaff, currentUser, role, authorityPolicy]);

  const decidingStaffName = useMemo(() => {
    const me = (allStaff || []).find((s: any) => s.id === currentUser?.uid || s.userId === currentUser?.uid);
    return me?.name || selectedTenant?.name || 'The studio';
  }, [allStaff, currentUser, selectedTenant]);

  const reportDecision = useCallback((res: any, okTitle: string) => {
    if (res.ok) { toast({ title: okTitle, description: res.message }); return; }
    if (res.alreadyStatus) {
      toast({ title: 'Already answered', description: `Nothing changed — this one is ${String(res.alreadyStatus).replace(/_/g, ' ')}.` });
      return;
    }
    toast({ variant: 'destructive', title: res.reason });
  }, [toast]);

  const handleApproveRequest = useCallback(async (apt: any) => {
    const res = await approveBooking(firestore, tenantId, apt, currentUser?.uid, selectedTenant?.name, decidingStaffName);
    reportDecision(res, 'Request accepted');
    return res;
  }, [firestore, tenantId, currentUser, selectedTenant, decidingStaffName, reportDecision]);

  const handleReportIssue = useCallback(async (code: string, note: string) => {
    if (!issueFor) return;
    setIssueBusy(true);
    try {
      const me = (allStaff || []).find((s: any) => s.id === currentUser?.uid || s.userId === currentUser?.uid);
      const res = await raiseIssue(firestore, tenantId, issueFor, code, note, {
        uid: currentUser?.uid,
        name: decidingStaffName,
        role: (me as any)?.role || role || null,
        isManager: role === 'owner' || role === 'admin',
      }, authorityPolicy);
      if (res.ok) {
        toast({ title: 'Sent to a manager', description: res.message });
        setIssueFor(null);
      } else {
        toast({ variant: 'destructive', title: res.reason });
      }
    } finally {
      setIssueBusy(false);
    }
  }, [issueFor, allStaff, currentUser, firestore, tenantId, decidingStaffName, role, authorityPolicy, toast]);

  const handleDeclineRequest = useCallback(async (apt: any) => {
    const res = await denyBooking(firestore, tenantId, apt, currentUser?.uid, decidingStaffName, 'alternative');
    reportDecision(res, 'Request declined');
    return res;
  }, [firestore, tenantId, currentUser, decidingStaffName, reportDecision]);

  const billInstancesWithDefinitions = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    const today = startOfDay(new Date());
    return billInstances.filter(i => { const d = safeDate(i.dueDate); return i.status !== 'paid' && (isPast(d) || isToday(d) || differenceInDays(d, today) <= 7); }).map(instance => { const definition = billDefinitions.find(def => def.id === instance.billDefinitionId); return definition ? { ...instance, definition } : null; }).filter((i): i is any => i !== null);
  }, [billInstances, billDefinitions]);

  if (UNDEFINED_IMPORTS.length > 0) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-8">
        <div className="max-w-md p-6 rounded-2xl border-2 border-red-200 bg-red-50 text-left space-y-3">
          <p className="text-sm font-semibold text-red-700">Found the crash — a component import is undefined:</p>
          <p className="text-lg font-mono font-bold text-red-800">{UNDEFINED_IMPORTS.join(', ')}</p>
          <p className="text-xs text-red-600 leading-relaxed">
            The file for {UNDEFINED_IMPORTS.length === 1 ? 'this component' : 'these components'} exists but doesn't export
            {UNDEFINED_IMPORTS.length === 1 ? ' this exact name' : ' these exact names'} (it probably uses a default export
            or a different name). Send this name to Claude and it's a one-line fix.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white">
      <AppHeader />
      <div className="shrink-0 px-3 py-2.5 sm:p-4 md:py-3 md:px-8 border-b bg-white/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto space-y-2.5 sm:space-y-4 text-left">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Planner</h1>
              <p className="hidden sm:block text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Synchronized studio agenda</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {(role === 'owner' || role === 'admin') && (
                <div className="flex gap-1.5 sm:gap-2">
                  <Button variant="outline" size="icon" title="Bills due" aria-label="Bills due" className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsBillsSheetOpen(true)}>
                    <CreditCard className="h-4 w-4 sm:h-5 sm:w-5" />
                    {billInstancesWithDefinitions.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-destructive text-[8px] sm:text-[10px] font-black text-white shadow-lg border-2 border-white">{billInstancesWithDefinitions.length}</span>}
                  </Button>
                  <Button variant="outline" size="icon" title="Weekly numbers" aria-label="Weekly numbers" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
                </div>
              )}
              <Button variant="outline" size="icon" title="Waiting list" aria-label="Waiting list" className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsWaitlistSheetOpen(true)}>
                <Hourglass className="h-4 w-4 sm:h-5 sm:w-5" />
                {openWaitlistCount > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-amber-500 text-[8px] sm:text-[10px] font-black text-white shadow-lg border-2 border-white">{openWaitlistCount}</span>}
              </Button>
              <Button variant="outline" size="icon" title="Scan check-in code" aria-label="Scan check-in code" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsScannerOpen(true)}><QrCode className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
            </div>
          </div>

          {studioEventsToday.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {studioEventsToday.map(se => (
                <button
                  key={se.id}
                  onClick={() => router.push(`/events/${se.id}/manifest`)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl border-2 whitespace-nowrap shrink-0 transition-all active:scale-95',
                    se.status === 'active'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : se.status === 'completed'
                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                        : 'bg-violet-50 border-violet-200 text-violet-800'
                  )}
                >
                  {se.status === 'active' && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {se.title || se.name}
                  </span>
                  {se.status === 'active' && (
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Live →</span>
                  )}
                  {se.status !== 'active' && se.time && (
                    <span className="text-[9px] font-bold opacity-60">{se.time}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {(awaitingUpcoming.length > 0 || cancelledToday > 0) && (
            <div className="flex w-full items-center gap-2 overflow-x-auto scrollbar-hide">
              {awaitingUpcoming.length > 0 && (
                <button
                  type="button"
                  onClick={jumpToNextAwaiting}
                  aria-label={`Go to the next of ${awaitingUpcoming.length} bookings awaiting your answer`}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-violet-300 bg-violet-50 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-violet-800 active:scale-95"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {awaitingUpcoming.length} awaiting you
                </button>
              )}
              {cancelledToday > 0 && (
                <button
                  type="button"
                  onClick={revealCancelled}
                  aria-pressed={showCancelled}
                  aria-label={`${showCancelled ? 'Hide' : 'Show'} ${cancelledToday} cancelled bookings on this day`}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-muted bg-muted/40 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground active:scale-95"
                >
                  <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {cancelledToday} cancelled · {showCancelled ? 'hide' : 'show'}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" title="Previous day" aria-label="Previous day" className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl shrink-0 hover:bg-muted" onClick={() => setCurrentDate(subDays(currentDate, 1))}><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
            <ScrollArea className="flex-1 min-w-0">
              <div className="flex w-full gap-1.5 sm:gap-2 px-0.5 pb-1">
                {weekDays.map(day => {
                  const isSelected = isSameDay(day, currentDate);
                  const hasStudioEvent = studioEventsRaw?.some(se => {
                    const d = se.date ? safeDate(se.date) : se.startTime ? safeDate(se.startTime) : null;
                    return d && isSameDay(d, day);
                  });
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setCurrentDate(day)}
                      aria-pressed={isSelected}
                      aria-label={format(day, 'EEEE, MMMM d')}
                      className={cn(
                        "flex-1 py-1.5 sm:py-2 min-w-[44px] sm:min-w-[80px] rounded-xl sm:rounded-2xl transition-colors border-2 flex flex-col items-center gap-0.5 active:scale-95",
                        isSelected
                          ? "bg-primary border-primary shadow-lg shadow-primary/20"
                          : "bg-muted/50 border-transparent hover:bg-muted"
                      )}
                    >
                      <p className={cn("text-[10px] font-black uppercase tracking-widest", isSelected ? "text-white/70" : "text-muted-foreground/70")}>{format(day, 'EEE')}</p>
                      <p className={cn("text-base sm:text-2xl font-black tracking-tighter leading-none", isSelected ? "text-white" : "text-slate-900")}>{format(day, 'd')}</p>
                      {hasStudioEvent && (
                        <span className={cn('w-1.5 h-1.5 rounded-full', isSelected ? 'bg-white/70' : 'bg-violet-400')} />
                      )}
                    </button>
                  );
                })}
              </div>
              <ScrollBar orientation="horizontal" className="hidden" />
            </ScrollArea>
            <Button variant="ghost" size="icon" title="Next day" aria-label="Next day" className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl shrink-0 hover:bg-muted" onClick={() => setCurrentDate(addDays(currentDate, 1))}><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
          </div>

          <div className="flex items-center justify-between gap-2 sm:gap-6">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary leading-none mb-0.5">{format(currentDate, 'MMMM yyyy')}</p>
              <p className="text-sm sm:text-base font-black text-slate-900 leading-none truncate">{format(currentDate, 'EEEE, do')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-9 sm:h-10 px-3 sm:px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 shadow-sm shrink-0">Today</Button>
              <RadioGroup value={activeView} onValueChange={(v: any) => setActiveView(v)} className="flex gap-1 p-1 bg-muted/30 rounded-xl border-2 border-muted shadow-inner shrink-0">
                <Label htmlFor="staff-v" className={cn("flex items-center justify-center gap-1.5 h-7 sm:h-8 px-2.5 sm:px-4 rounded-lg cursor-pointer font-black text-[10px] uppercase tracking-widest transition-colors", activeView === 'staff' ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:bg-white/50")}><User className="w-3.5 h-3.5 shrink-0" /> Providers <RadioGroupItem value="staff" id="staff-v" className="sr-only" /></Label>
                <Label htmlFor="res-v" className={cn("flex items-center justify-center gap-1.5 h-7 sm:h-8 px-2.5 sm:px-4 rounded-lg cursor-pointer font-black text-[10px] uppercase tracking-widest transition-colors", activeView === 'resources' ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:bg-white/50")}><Building className="w-3.5 h-3.5 shrink-0" /> Resources <RadioGroupItem value="resources" id="res-v" className="sr-only" /></Label>
              </RadioGroup>
            </div>
          </div>
        </div>
      </div>

      {stuckAppointments.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-amber-50 border-b-2 border-amber-200">
          <div className="max-w-7xl mx-auto space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" />
              {stuckAppointments.length} session{stuckAppointments.length > 1 ? 's' : ''} need attention
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {stuckAppointments.map(apt => {
                const svc = services?.find(s => s.id === apt.serviceId);
                return (
                  <button
                    key={apt.id}
                    onClick={() => { setSelectedAppointment(apt); setIsDetailsOpen(true); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border-2 border-amber-300 shrink-0 hover:bg-amber-50 transition-all active:scale-95"
                  >
                    <div className={cn('w-2 h-2 rounded-full shrink-0',
                      apt.status === 'servicing' ? 'bg-primary animate-pulse' : 'bg-emerald-500')} />
                    <div className="text-left">
                      <p className="font-black uppercase text-[10px] text-slate-800">{apt.clientName || 'Guest'}</p>
                      <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                        {svc?.name || 'Service'} · {(() => { try { const d = safeDate(apt.startTime); return isNaN(d.getTime()) ? '' : format(d, 'MMM d, h:mm a'); } catch { return ''; } })()}
                      </p>
                    </div>
                    <Badge className={cn('font-black text-[8px] uppercase border-none shrink-0',
                      apt.status === 'servicing' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                      {apt.status === 'servicing' ? 'In Service' : 'Checkout'}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
        <DayTimeline
          date={currentDate} columns={columns} itemsByColumn={itemsByColumn}
          showColumnHeader={activeView === 'resources'} isMobile={isMobile || false} activeView={activeView}
          allStaff={allStaff || []} mobileSelectedColumnId={mobileSelectedColumnId} onMobileColumnChange={onMobileColumnChange}
          onCompleteClick={a => router.push(`/pos?checkout_id=${a.id}`)} onUpdateStatus={handleUpdateStatus}
          onDeleteAppointment={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onPrintReceipt={() => {}} onPrintTicket={handlePrintTicket}
          onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
          onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onChecklistItemToggleCallback={() => {}} onUpdateEvent={() => {}}
          dailyTransactions={transactions?.filter(t => isSameDay(safeDate(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
          onReschedule={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
          onRebook={a => { setAppointmentToRebook(a); setClientForNewApt(null); setIsAddAppointmentOpen(true); }}
          onStartService={handleStartService} onFinishService={handleFinishService}
          onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }}
          onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))}
          onDeleteAppointmentFromDB={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
          onApproveRequest={handleApproveRequest} onDeclineRequest={handleDeclineRequest}
          onReportIssue={(a: any) => setIssueFor(a)} canDeclineDirectly={myAuthority === 'full'}
          focusId={focusId} onFocusSettled={() => setFocusId(null)}
          walkIns={walkIns} clients={clients} services={services} resources={resourcesData || []}
        />
      </main>

      <DebugErrorBoundary>
        <AppointmentDetailsSheet
          open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
          client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
          service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
          tmhr={tmhr} transactions={transactions || []}
          onStartService={handleStartService} onFinishService={handleFinishService}
          onEdit={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
          onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onCancel={id => { setSelectedAppointment((appointments || []).find(a => a.id === id) || null); setIsCancelDialogOpen(true); }}
          onRebook={a => { setAppointmentToRebook(a); setClientForNewApt(null); setIsAddAppointmentOpen(true); }}
          onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }}
          onPrintTicket={handlePrintTicket} onOverride={handleOverrideConfirm}
          onWaiveFee={(id: string, aut: any, res: string) => {
            if (!firestore || !tenantId) return;
            const apt = (appointments || []).find(a => a.id === id);
            if (!apt) return;
            const batch = writeBatch(firestore);
            batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id), { cancellationFeeWaived: true, waivedBy: aut.id, waivedReason: res, waivedAt: new Date().toISOString() });
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, apt.clientId), { outstandingBalance: increment(-(apt.cancellationFeeApplied || 0)) });
            batch.commit().then(() => toast({ title: "Fee Absorbed" }));
          }}
        />
      </DebugErrorBoundary>

      <ReportIssueDialog
        open={!!issueFor}
        onOpenChange={(v: boolean) => { if (!v) setIssueFor(null); }}
        clientName={issueFor?.clientName}
        policy={authorityPolicy}
        busy={issueBusy}
        onSubmit={handleReportIssue}
      />

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={allStaff || []} onConfirm={handleOverrideConfirm} />

      {selectedAppointment && (
        <EditAppointmentDialog open={isEditAppointmentOpen} onOpenChange={setIsEditAppointmentOpen} appointment={selectedAppointment} clients={clients || []} services={services || []} appointments={appointments} onConfirm={handleUpdateAppointment} />
      )}

      {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={handleConfirmCancellation} />}
      {selectedAppointment && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: selectedAppointment, client: (clients || []).find(c => c.id === selectedAppointment.clientId), service: (services || []).find(s => s.id === selectedAppointment.serviceId) }} staff={allStaff || []} onSendToFrontDesk={handleSendToFrontDesk} />}

      <AddAppointmentDialog
        open={isAddAppointmentOpen}
        onOpenChange={(val: boolean) => { setIsAddAppointmentOpen(val); if (!val) { setClientForNewApt(null); setAppointmentToRebook(null); } }}
        onConfirm={async (data: any) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          const token = nanoid(16);
          const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), apt, {});
          await setDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), apt, {});
          setIsAddAppointmentOpen(false);
          toast({ title: "Booked" });
        }}
        client={clientForNewApt}
        appointmentToRebook={appointmentToRebook}
        memberships={memberships || []}
      />

      <AddEventDialog
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={async (data: any) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'events', id), { ...data, id, tenantId, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString() }, {});
          setIsAddEventOpen(false);
          toast({ title: "Event Added" });
        }}
        staff={allStaff || []}
      />

      <ScanCheckInDialog
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        firestore={firestore}
        tenantId={tenantId || ''}
        appointments={appointments || []}
        clients={clients || []}
        services={services || []}
        staff={allStaff || []}
        onSelect={(a: any) => { setSelectedAppointment(a); setIsScannerOpen(false); setIsDetailsOpen(true); }}
        onCheckIn={handleDeskCheckIn}
        onPrintTicket={handlePrintTicket}
      />

      <FloatingActionButton onNewAppointmentClick={() => { setClientForNewApt(null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }} onNewEventClick={() => setIsAddEventOpen(true)} />
      <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={billInstancesWithDefinitions} isMobile={isMobile || false} onLogPaymentClick={(instance: any) => { setSelectedBill(instance); setIsBillsSheetOpen(false); }} />
      <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={kpis} isMobile={isMobile || false} />
      <WaitlistSheet
        open={isWaitlistSheetOpen}
        onOpenChange={setIsWaitlistSheetOpen}
        tenantId={tenantId || ''}
        entries={waitlistEntries}
        clients={clients || []}
        services={services || []}
        staff={allStaff || []}
        isMobile={isMobile || false}
        onBookClient={(client: any) => {
          // Hand the person straight to the booking dialog with their record
          // already attached — the whole point of the list is that the desk
          // does not have to look them up a second time.
          setAppointmentToRebook(null);
          setClientForNewApt(client);
          setIsWaitlistSheetOpen(false);
          setIsAddAppointmentOpen(true);
        }}
      />
      {selectedBill && <LogPaymentDialog open={!!selectedBill} onOpenChange={(isOpen) => !isOpen && setSelectedBill(null)} billInstance={selectedBill} onConfirm={() => {}} />}
    </div>
  );
}

export default function PlannerPageWrapper() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>}>
      <DebugErrorBoundary>
        <PlannerPageContent />
      </DebugErrorBoundary>
    </Suspense>
  );
}
