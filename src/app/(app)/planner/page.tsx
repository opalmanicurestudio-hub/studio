'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode, Globe, Building, HardHat, Repeat, Link as LinkIcon, Car, Check, X } from 'lucide-react';
import { type Event, type Staff, type Appointment, type AppointmentCheckoutState, type Resource, type Membership } from '@/lib/data';
import { type BillInstance, type BillDefinition, type Transaction } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping, addMonths, differenceInHours } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, errorEmitter, useUser } from '@/firebase';
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch, addDoc } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { type Client, type Service } from '@/lib/data';
import { nanoid } from 'nanoid';
import { Textarea } from '@/components/ui/textarea';


function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { user } = useUser();
  const { selectedTenant, role } = useTenant();
  const firestore = useFirebase().firestore;
  const tenantId = selectedTenant?.id;
  const router = useRouter();
  
  const { 
      inventory, clients, services, staff: allStaff, appointments: appointmentsFromInventory, events: eventsFromInventory, walkIns, billDefinitions, billInstances, transactions, memberships, isLoading
  } = useInventory();

  const [tmhr, setTmhr] = useState(0);
  useEffect(() => { setTmhr(selectedTenant?.tmhr || 50); }, [selectedTenant]);

  const { data: checkIns } = useCollection<Partial<Appointment>>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, 'appointmentCheckIns'), where('tenantId', '==', tenantId)), [firestore, tenantId]));
  
  const appointments = useMemo(() => {
    if (!appointmentsFromInventory) return [];
    const base = appointmentsFromInventory.map(apt => ({ ...apt, startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime), endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime), actualStartTime: apt.actualStartTime ? ((apt.actualStartTime as any)?.toDate ? (apt.actualStartTime as any).toDate() : new Date(apt.actualStartTime)) : undefined, actualEndTime: apt.actualEndTime ? ((apt.actualEndTime as any)?.toDate ? (apt.actualEndTime as any).toDate() : new Date(apt.actualEndTime)) : undefined }));
    if (!checkIns) return base;
    const checkInMap = new Map(checkIns.map(ci => [ci.checkInToken, ci]));
    return base.map(apt => {
        const ci = apt.checkInToken ? checkInMap.get(apt.checkInToken) : null;
        return ci ? { ...apt, checkInStatus: ci.checkInStatus || apt.checkInStatus, lateTimeMinutes: ci.lateTimeMinutes ?? apt.lateTimeMinutes, status: ci.status || apt.status } : apt;
    });
  }, [appointmentsFromInventory, checkIns]);
  
  const events = useMemo(() => eventsFromInventory?.map(evt => ({ ...evt, startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime), endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime) })) || [], [eventsFromInventory]);
  
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [isPickingListOpen, setIsPickingListOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const [eventToDeny, setEventToDeny] = useState<Event | null>(null);
  const [denialReason, setDenialReason] = useState('');
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  const [mobileSelectedStaffId, setMobileSelectedStaffId] = useState<string>('');
  const [startConfirmAppointment, setStartConfirmAppointment] = useState<Appointment | null>(null);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [clientForNewApt, setClientForNewApt] = useState<Client | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [activeView, setActiveView] = useState(viewParam === 'resources' ? 'resources' : 'staff');
    
  const { data: scheduleProfiles } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]));
  const { data: resources } = useCollection<Resource>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'resources'), [firestore, tenantId]));
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const staff = useMemo(() => (role === 'staff' && user) ? (allStaff || []).filter(s => s.id === user.uid) : (allStaff || []), [allStaff, role, user]);
  useEffect(() => { if (staff?.length > 0 && !mobileSelectedStaffId) setMobileSelectedStaffId(staff[0].id); }, [staff, mobileSelectedStaffId]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 0 }), i)), [currentDate]);

  const dailyBillInstances = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    const today = startOfDay(currentDate);
    return billInstances.filter(i => i.status !== 'paid' && isBefore(startOfDay(parseISO(i.dueDate)), addDays(today, 1))).map(i => ({ ...i, definition: billDefinitions.find(def => def.id === i.billDefinitionId)! })).filter(i => i.definition).sort((a,b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
  }, [currentDate, billInstances, billDefinitions]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, (Appointment | Event)[]>();
    const cols = activeView === 'staff' ? staff : resources;
    (cols || []).forEach(c => map.set(c.id, []));
    appointments?.filter(a => isSameDay(a.startTime, currentDate)).forEach(a => {
        if (activeView === 'staff') { if (a.staffId && map.has(a.staffId)) map.get(a.staffId)!.push({ ...a, itemType: 'appointment' } as any); }
        else { (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); }); }
    });
    events?.filter(e => isSameDay(e.startTime, currentDate)).forEach(e => {
        if (activeView === 'staff') { if (e.staffId && map.has(e.staffId)) map.get(e.staffId)!.push({ ...e, itemType: 'event' } as any); }
    });
    map.forEach(items => items.sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    return map;
  }, [currentDate, appointments, events, staff, resources, activeView]);

  const handleScan = useCallback((data: string) => {
    if (!appointments) return;
    const raw = data.trim();
    if (raw.startsWith('clarityflow://checkout/')) {
        const id = raw.split('/').pop();
        const apt = appointments.find(a => a.id === id);
        if (apt) {
            setSelectedAppointment(apt);
            setIsDetailsOpen(true);
            if (apt.status === 'ready_for_checkout') {
                toast({ title: "Ticket Scanned", description: "This client is ready for checkout. Opening details." });
            }
        } else {
            toast({ variant: 'destructive', title: 'Appointment Not Found' });
        }
    }
  }, [appointments, toast]);

  const handleUpdateStatus = (id: string, status: Appointment['status']) => {
    if (!firestore || !tenantId) return;
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), { status });
    toast({ title: "Status Updated", description: `Appointment status changed to ${status}.` });
  };

  const handleAddAppointment = async (data: any) => {
    if (!firestore || !tenantId) return;
    const id = nanoid();
    const token = nanoid(16);
    const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
    await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), apt, {});
    await setDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), apt, {});
    setIsAddAppointmentOpen(false);
    toast({ title: "Appointment Booked" });
  };

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader />
      <div className="p-4 border-b">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setCurrentDate(subDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(addDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-8">Today</Button>
                        <Separator orientation="vertical" className="h-6" />
                        <RadioGroup value={activeView} onValueChange={(v: any) => setActiveView(v)} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
                            <Label htmlFor="staff-view" className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background"><User className="h-3.5 w-3.5" /><RadioGroupItem value="staff" id="staff-view" className="sr-only" /></Label>
                            <Label htmlFor="res-view" className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background"><Building className="h-3.5 w-3.5" /><RadioGroupItem value="resources" id="res-view" className="sr-only" /></Label>
                        </RadioGroup>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><QrCode className="h-4 w-4" /></Button>
                        <Button size="sm" onClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
                    </div>
                </div>
                <ScrollArea className="w-full">
                    <div className="flex w-full px-4 md:px-0">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => setCurrentDate(day)} className={cn("flex-1 py-2 text-center md:p-3 transition-colors hover:bg-muted/50 rounded-md", isSameDay(day, currentDate) && "bg-muted")}>
                                <p className={cn("text-xs", isSameDay(day, currentDate) ? "text-primary font-bold" : "text-muted-foreground")}>{format(day, 'EEE')}</p>
                                <p className={cn("text-lg md:text-2xl font-bold mt-1", !isSameDay(day, currentDate) && "text-muted-foreground")}>{format(day, 'd')}</p>
                            </button>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </div>
      </div>
      
      <main className="flex-1 flex flex-col min-h-0">
            <DayTimeline 
                date={currentDate} columns={activeView === 'staff' ? staff : resources || []} itemsByColumn={itemsByColumn}
                showColumnHeader={activeView === 'resources'} isMobile={isMobile || false} activeView={activeView}
                allStaff={allStaff || []} mobileSelectedStaffId={mobileSelectedStaffId} onMobileStaffChange={setMobileSelectedStaffId}
                onCompleteClick={a => router.push(`/pos?checkout_id=${a.id}`)} onUpdateStatus={handleUpdateStatus} onDeleteAppointment={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
                onPrintReceipt={setReceiptToPrint} onPrintTicket={setTicketToPrint} onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
                onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onUpdateEvent={() => {}}
                dailyTransactions={transactions?.filter(t => isSameDay(new Date(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
                onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }} onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
                onStartService={id => updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id), { status: 'servicing', actualStartTime: new Date().toISOString() })}
                onFinishService={a => { setSelectedAppointment(a); setIsTechnicianReviewOpen(true); }} onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
                onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))} onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
                walkIns={walkIns} clients={clients} services={services} resources={resources || []} publicScheduleProfile={publicScheduleProfile}
            />
      </main>

      <AppointmentDetailsSheet 
        open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
        client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
        service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
        tmhr={tmhr} transactions={transactions || []}
        onStartService={id => updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id), { status: 'servicing', actualStartTime: new Date().toISOString() })}
        onFinishService={a => { setSelectedAppointment(a); setIsTechnicianReviewOpen(true); }}
        onEdit={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
        onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
        onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }}
        onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
        onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
        onPrintTicket={setTicketToPrint}
      />

      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} onConfirm={handleAddAppointment} client={clientForNewApt} appointmentToRebook={appointmentToRebook} memberships={memberships || []} />
      {selectedAppointment && <EditAppointmentDialog open={isEditAppointmentOpen} onOpenChange={setIsEditAppointmentOpen} appointment={selectedAppointment} clients={clients || []} services={services || []} appointments={appointments || []} onConfirm={a => updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', a.id), a)} />}
      
      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4"><DialogTitle>Scan Ticket</DialogTitle></DialogHeader>
          <div className="p-4 relative"><div id="qr-reader-planner" className="w-full aspect-square rounded-md bg-muted" /><div className="absolute inset-4 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div>
          <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} className="w-full">Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PlannerPageWrapper() { return <Suspense fallback={<div className="flex h-screen w-full flex-col"><AppHeader /><div className="flex items-center justify-center flex-1"><Loader className="h-8 w-8 animate-spin" /></div></div>}><PlannerPageContent /></Suspense> }
