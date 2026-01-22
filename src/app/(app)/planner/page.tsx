

'use client';

import { AppHeaderClient } from '@/components/shared/AppHeaderClient';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode } from 'lucide-react';
import { type Event, type EventChecklistItem, type StockCorrection, type Staff, type Appointment, type AppointmentCheckoutState } from '@/lib/data';
import { type Bill, type Transaction, type BillInstance, type BillDefinition } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
import { useInventory } from '@/context/InventoryContext';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp, doc } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EventCard } from '@/components/planner/EventCard';
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { WalkIn, type Client, type Service } from '@/lib/data';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { nanoid } from 'nanoid';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';


export default function PlannerPage() {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { 
    setAppointments: setAppointmentsInContext,
    setActivityLogs,
    addStockCorrection,
    setTransactions,
    setClients,
  } = useInventory();
  
  const { firestore, user, isUserLoading } = useFirebase();
  const tenantId = 'tenant-abc';
  
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
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
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  
  const [mobileSelectedStaffId, setMobileSelectedStaffId] = useState<string>('');

  const [startConfirmAppointment, setStartConfirmAppointment] = useState<Appointment | null>(null);
  const [finishConfirmAppointment, setFinishConfirmAppointment] = useState<Appointment | null>(null);

  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [initialClientIdForNewApt, setInitialClientIdForNewApt] = useState<string>('');

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);


  const finishDialogDuration = useMemo(() => {
    if (!finishConfirmAppointment?.actualStartTime) return null;
    const startTime = parseISO(finishConfirmAppointment.actualStartTime);
    const duration = differenceInMinutes(new Date(), startTime);
    return duration;
  }, [finishConfirmAppointment]);

  // --- Data Fetching ---
  const billDefinitionsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'bills');
  }, [firestore, user, isUserLoading, tenantId]);

  const billInstancesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'billInstances');
  }, [firestore, user, isUserLoading, tenantId]);
  
  const appointmentsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'appointments');
  }, [firestore, user, isUserLoading, tenantId]);
  
  const clientsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'clients');
  }, [firestore, user, isUserLoading, tenantId]);
  
  const walkInQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'walkIns');
  }, [firestore, user, isUserLoading, tenantId]);

  const servicesQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `tenants/${tenantId}/services`);
  }, [firestore, user, tenantId]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `tenants/${tenantId}/staff`);
  }, [firestore, user, tenantId]);

  const eventsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `tenants/${tenantId}/events`);
  }, [firestore, user, tenantId]);

  const { data: fetchedBillDefinitions, isLoading: billDefinitionsLoading } = useCollection<BillDefinition>(billDefinitionsQuery);
  const { data: fetchedBillInstances, isLoading: billInstancesLoading } = useCollection<BillInstance>(billInstancesQuery);
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(walkInQuery);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: fetchedEvents, isLoading: eventsLoading } = useCollection<Event>(eventsQuery);

  useEffect(() => {
    if (staff && staff.length > 0 && !mobileSelectedStaffId) {
      setMobileSelectedStaffId(staff[0].id);
    }
  }, [staff, mobileSelectedStaffId]);

 const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => {
        const startTime = (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any);
        const endTime = (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any);
        return { ...apt, startTime, endTime };
    });
}, [appointmentsFromDB]);

const events = useMemo(() => {
  if (!fetchedEvents) return [];
  return fetchedEvents.map(evt => {
    const startTime = (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : parseISO(evt.startTime as string);
    const endTime = (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : parseISO(evt.endTime as string);
    return { ...evt, startTime, endTime };
  });
}, [fetchedEvents]);

  
  const billDefinitions = useMemo(() => (fetchedBillDefinitions && fetchedBillDefinitions.length > 0) ? fetchedBillDefinitions : [], [fetchedBillDefinitions]);
  const billInstances = useMemo(() => (fetchedBillInstances && fetchedBillInstances.length > 0) ? fetchedBillInstances : [], [fetchedBillInstances]);


  const weekStart = useMemo(() => {
    return startOfWeek(currentDate, { weekStartsOn: 0 });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = weekStart;
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekStart]);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    const dayStart = startOfDay(currentDate);
    const dayEnd = endOfDay(currentDate);
    return query(
        collection(firestore, 'tenants', tenantId, 'transactions'),
        where('date', '>=', Timestamp.fromDate(dayStart)),
        where('date', '<=', Timestamp.fromDate(dayEnd))
    );
  }, [firestore, user, currentDate, tenantId]);

  const { data: dailyTransactions, isLoading: transactionsLoading } = useCollection<Transaction>(transactionsQuery);

  const dailyBillInstances = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    
    const today = startOfDay(currentDate);

    return billInstances
        .filter(instance => {
            const dueDate = startOfDay(parseISO(instance.dueDate));
            return (isEqual(dueDate, today) || isBefore(dueDate, today)) && instance.status !== 'paid';
        })
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            return { ...instance, definition: definition! };
        })
        .filter(item => item.definition)
        .sort((a,b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
    }, [currentDate, billInstances, billDefinitions]);


  const weeklyKpis = useMemo(() => {
    const start = weekStart;
    const end = endOfDay(addDays(start, 6));
    const weekInterval = { start, end };
    
    const appointmentsInWeek = (appointments || []).filter(apt => {
        const aptStartTime = apt.startTime;
        return aptStartTime >= weekInterval.start && aptStartTime <= weekInterval.end;
    });

    const completedAppointments = appointmentsInWeek.filter(apt => apt.status === 'completed');
    const confirmedAppointments = appointmentsInWeek.filter(apt => apt.status === 'confirmed');

    const weeklyRevenue = completedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const projectedRevenue = weeklyRevenue + confirmedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const weeklyCosts = completedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + (service?.cost || 0);
    }, 0);
    
    const monthlyCosts = (billDefinitions || []).reduce((acc, bill) => {
        if (bill.billingCycle === 'monthly') return acc + bill.amount;
        if (bill.billingCycle === 'weekly') return acc + (bill.amount * 4);
        if (bill.billingCycle === 'quarterly') return acc + (bill.amount / 3);
        if (bill.billingCycle === 'annually') return acc + (bill.amount / 12);
        return acc;
    }, 0);

    const absorbedCosts = completedAppointments.reduce((acc, apt) => acc + (apt.absorbedCost || 0), 0);

    return {
        weeklyRevenue: weeklyRevenue,
        projectedRevenue: projectedRevenue,
        weeklyBreakEven: monthlyCosts / 4,
        weeklyNetProfit: weeklyRevenue - weeklyCosts,
        absorbedCosts: absorbedCosts,
    }
  }, [currentDate, appointments, weekStart, billDefinitions, services]);
  
  const itemsByStaff = useMemo(() => {
    const map = new Map<string, (Appointment | Event & { itemType: string })[]>();
    (staff || []).forEach(s => map.set(s.id, []));

    // Process appointments
    (appointments || [])
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .forEach(apt => {
        const staffId = apt.staffId || (staff || [])[0]?.id;
        if (staffId && map.has(staffId)) {
          map.get(staffId)!.push({ ...apt, itemType: 'appointment' });
        }
      });

    // Process events
    (events || [])
      .filter(evt => isSameDay(evt.startTime, currentDate))
      .forEach(evt => {
          const eventWithDateObjects = {
              ...evt,
              startTime: evt.startTime,
              endTime: evt.endTime,
          };

          if (evt.staffId && map.has(evt.staffId)) {
              // Event with specific staff
              map.get(evt.staffId)!.push({ ...eventWithDateObjects, itemType: 'event' });
          } else if (evt.type === 'blocked' && !evt.staffId) {
              // Block all staff
              (staff || []).forEach(s => {
                  map.get(s.id)!.push({ ...eventWithDateObjects, itemType: 'event' });
              });
          } else {
              // Personal/Business event for the owner (first staff member)
              const ownerId = (staff || [])[0]?.id;
              if (ownerId) {
                  map.get(ownerId)!.push({ ...eventWithDateObjects, itemType: 'event' });
              }
          }
      });

    map.forEach(items => {
        items.sort((a,b) => a.startTime.getTime() - b.startTime.getTime())
    });

    return map;
  }, [currentDate, appointments, events, staff]);

  const staffToDisplay = useMemo(() => {
    if (isMobile) {
        if (!mobileSelectedStaffId || !staff) return [];
        const selected = (staff || []).find(s => s.id === mobileSelectedStaffId);
        return selected ? [selected] : [];
    }
    return staff || [];
  }, [isMobile, mobileSelectedStaffId, staff]);

  const itemsToDisplay = useMemo(() => {
      if (isMobile) {
          if (!mobileSelectedStaffId || !itemsByStaff.has(mobileSelectedStaffId)) return new Map();
          return new Map([[mobileSelectedStaffId, itemsByStaff.get(mobileSelectedStaffId)!]]);
      }
      return itemsByStaff;
  }, [isMobile, mobileSelectedStaffId, itemsByStaff]);


  const handleCompleteClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsCheckoutOpen(true);
  };

  const handleEditClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsEditAppointmentOpen(true);
  };
  
   const handleRescheduleClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsRescheduleOpen(true);
  };
  
  const handleEditEventClick = (event: Event) => {
    setSelectedEvent(event);
    setIsEditEventOpen(true);
  }
  
  const handleLogPaymentClick = (instance: BillInstance & { definition: BillDefinition }) => {
    setSelectedBill(instance);
  };

  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string, receiptUrl?: string; }) => {
    if (!selectedBill || !firestore || !user) return;

    const billInstanceRef = doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus: BillInstance['status'] = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    
    updateDocumentNonBlocking(billInstanceRef, {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        status: newStatus
    });

    const newTransaction: Omit<Transaction, 'id'> = {
        date: paymentData.date.toISOString(),
        description: `Payment for ${selectedBill.definition.name}`,
        clientOrVendor: selectedBill.definition.name,
        type: 'payment',
        context: selectedBill.definition.context,
        category: selectedBill.definition.category,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        paymentMethodIdentifier: paymentData.paymentMethodIdentifier,
        hasReceipt: !!paymentData.receiptUrl,
        relatedBillInstanceId: selectedBill.id,
    };
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, newTransaction);
    
    toast({
        title: "Payment Logged",
        description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
    })

    setSelectedBill(null);
    if (isBillsSheetOpen) {
        setIsBillsSheetOpen(false);
    }
  };

  const handleCheckout = (data: CheckoutData) => {
    if (!selectedAppointment || !firestore) return;
    
    const {
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns,
      absorbedCost,
      receiptData,
      newCorrections,
      incident,
      redeemedOffer
    } = data;

    const allPerformedServices = [services?.find(s => s.id === selectedAppointment.serviceId), ...addOns].filter((s): s is Service => !!s);
    
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');

    // 1. Service Revenue Transactions
    allPerformedServices.forEach(service => {
        const staffId = serviceStaffOverrides[service.id] || selectedAppointment.staffId;
        const newTransaction: Omit<Transaction, 'id'> = {
            date: new Date().toISOString(),
            description: `Service: ${service.name}`,
            clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
            type: 'income',
            context: 'Business',
            category: 'Service Revenue',
            amount: redeemedOffer ? 0 : service.price,
            paymentMethod: receiptData.payment.method,
            hasReceipt: true,
            staffId: staffId,
        };
        addDocumentNonBlocking(transactionsRef, newTransaction);
    });

    // 2. Tip Transactions
    Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
        if (tipAmount > 0) {
            const newTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Tip for Appointment #${selectedAppointment.id.slice(-4)}`,
                clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                type: 'income',
                context: 'Business',
                category: 'Tips',
                amount: tipAmount,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: staffId,
                tipAmount: tipAmount,
            };
            addDocumentNonBlocking(transactionsRef, newTransaction);
        }
    });

    // 3. Retail Transactions
    if (retailItems.length > 0) {
        const retailTotal = retailItems.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
            return acc + (item.quantity * price);
        }, 0);
        if (retailTotal > 0) {
            const newTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Retail Sale (${retailItems.length} items)`,
                clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                type: 'income',
                context: 'Business',
                category: 'Retail',
                amount: retailTotal,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: selectedAppointment.staffId, // Or assign to a specific staff
            };
            addDocumentNonBlocking(transactionsRef, newTransaction);
        }
    }
    
    // 4. Update stock corrections
    newCorrections.forEach(addStockCorrection);
    
    // 5. Update appointment
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'completed',
        absorbedCost: absorbedCost,
        incident: incident,
    });
    
    // 6. Update client packages
    if (redeemedOffer?.type === 'package') {
        const clientToUpdate = (clients || []).find(c => c.id === selectedAppointment.clientId);
        if (clientToUpdate) {
            const updatedPackages = clientToUpdate.activePackages?.map(p => {
                if (p.packageId === redeemedOffer.id) {
                    return { ...p, sessionsRemaining: p.sessionsRemaining - 1 };
                }
                return p;
            }).filter(p => p.sessionsRemaining > 0);

            const updatedClient = { ...clientToUpdate, activePackages: updatedPackages };
            setClients(prev => (prev || []).map(c => c.id === updatedClient.id ? updatedClient : c));
        }
    }
    
    handlePrintReceipt(receiptData);
  };
  
  const handleAddAppointment = (newAppointment: Omit<Appointment, 'id'>) => {
    if (!firestore) return;
    const newAptWithId = { ...newAppointment, id: nanoid() };
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', newAptWithId.id);
    setDocumentNonBlocking(appointmentRef, newAptWithId, {});
    toast({
        title: "Appointment Booked",
        description: `Appointment with ${(clients || []).find(c => c.id === newAppointment.clientId)?.name} has been added.`
    })
    setIsAddAppointmentOpen(false);
    setInitialClientIdForNewApt('');
  };

  const handleUpdateAppointment = (updatedAppointment: Appointment) => {
    if (!firestore) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', updatedAppointment.id);
    // Firestore doesn't like custom objects like Date, so we serialize
    const dataToSave = {
        ...updatedAppointment,
        startTime: updatedAppointment.startTime.toISOString(),
        endTime: updatedAppointment.endTime.toISOString()
    }
    updateDocumentNonBlocking(appointmentRef, dataToSave);
    toast({
        title: "Appointment Updated",
        description: `The appointment has been successfully updated.`
    })
    setIsEditAppointmentOpen(false);
    setIsRescheduleOpen(false);
  };

  const handleRebook = (appointment: Appointment) => {
      setIsCheckoutOpen(false);
      setSelectedAppointment(null); // Clear appointment from checkout
      setAppointmentToRebook(appointment);
      setIsAddAppointmentOpen(true);
  }

  const handleBookNewAppointmentForClient = (clientId: string) => {
    setAppointmentToRebook(null);
    setInitialClientIdForNewApt(clientId);
    setIsAddAppointmentOpen(true);
  };

  const handleAddEvent = (newEvent: Omit<Event, 'id'>) => {
    if (!firestore) return;
    const newEventWithId = { ...newEvent, id: nanoid() };
    const eventRef = doc(firestore, 'tenants', tenantId, 'events', newEventWithId.id);
    const dataToSave = {
        ...newEventWithId,
        startTime: newEventWithId.startTime.toISOString(),
        endTime: newEventWithId.endTime.toISOString(),
    };
    setDocumentNonBlocking(eventRef, dataToSave, {});

    if (newEvent.cost && newEvent.cost > 0 && newEvent.type !== 'blocked') {
        const newTransaction = {
            description: `Expense for: ${newEvent.title}`,
            clientOrVendor: 'N/A',
            type: 'expense' as const,
            context: newEvent.type === 'business' ? 'Business' : 'Personal',
            category: newEvent.type === 'business' ? 'Business Travel' : 'Personal Travel',
            amount: newEvent.cost,
            paymentMethod: 'Unknown',
            hasReceipt: false,
            relatedEventId: newEventWithId.id
        };
        addTransaction(newTransaction)
    }

    toast({
        title: "Event Added",
        description: `"${newEvent.title}" has been added to your calendar.`
    });
    setIsAddEventOpen(false);
  };

    const handleUpdateEvent = (updatedEvent: Event) => {
        if (!firestore) return;
        const eventRef = doc(firestore, 'tenants', tenantId, 'events', updatedEvent.id);
        const dataToSave = {
            ...updatedEvent,
            startTime: updatedEvent.startTime.toISOString(),
            endTime: updatedEvent.endTime.toISOString(),
        };
        updateDocumentNonBlocking(eventRef, dataToSave);
        toast({
            title: "Event Updated",
            description: `"${updatedEvent.title}" has been updated.`
        });
        setIsEditEventOpen(false);
    }
    
    const handleAddTransaction = (transaction: Omit<Transaction, 'id' | 'date'>) => {
        if (!firestore || !user) {
            toast({
                variant: 'destructive',
                title: 'Authentication Error',
                description: 'You must be logged in to log an expense.',
            });
            return;
        }
        const transactionRef = collection(firestore, 'tenants', tenantId, 'transactions');
        const newTransaction = {
            ...transaction,
            date: Timestamp.fromDate(currentDate),
        };
        addDocumentNonBlocking(transactionRef, newTransaction);
        toast({
            title: "Expense Logged",
            description: `An expense of $${transaction.amount.toFixed(2)} for "${transaction.description}" has been recorded in your ledger.`
        });
    }
  
  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'ready_for_checkout',
        checkoutState,
    });
    setIsCheckoutOpen(false);
    setSelectedAppointment(null);
    toast({
      title: 'Sent to Front Desk',
      description: "Client is ready for checkout.",
    });
  };

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    if (!firestore) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, { status });
    toast({
        title: "Status Updated",
        description: `Appointment status changed to ${status}.`
    });
  };

  const handleStartService = (appointmentId: string) => {
    const appointmentToStart = appointments.find(apt => apt.id === appointmentId);
    if (appointmentToStart) {
        setStartConfirmAppointment(appointmentToStart);
    }
  };

  const confirmStartService = () => {
    if (!startConfirmAppointment || !firestore) return;
    const nowISO = new Date().toISOString();
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', startConfirmAppointment.id);
    updateDocumentNonBlocking(appointmentRef, { status: 'servicing', actualStartTime: nowISO });

    if (startConfirmAppointment.isWalkIn) {
        const walkInId = startConfirmAppointment.id.replace('apt-walkin-', '');
        const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInDocRef, {
            status: 'servicing',
            serviceStartTime: nowISO,
        });
    }

    toast({
        title: "Service Started",
        description: "The appointment is now marked as 'In Service'."
    });
    setStartConfirmAppointment(null);
  };

  const handleFinishService = (appointment: Appointment) => {
     setFinishConfirmAppointment(appointment);
  };

  const confirmFinishService = () => {
    if (!finishConfirmAppointment || !finishConfirmAppointment.actualStartTime || !firestore) return;
    
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', finishConfirmAppointment.id);
    updateDocumentNonBlocking(appointmentRef, { status: 'ready_for_checkout', actualEndTime: new Date().toISOString() });

    const startTime = parseISO(finishConfirmAppointment.actualStartTime as string);
    const duration = differenceInMinutes(new Date(), startTime);

    toast({
        title: "Service Finished",
        description: `The service took ${duration} minutes. Client is ready for checkout.`
    });

    setFinishConfirmAppointment(null);
  };

  const handleDeleteAppointment = (appointmentId: string) => {
    if (!firestore) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    deleteDocumentNonBlocking(appointmentRef);
     toast({
        variant: "destructive",
        title: "Appointment Deleted",
        description: `The appointment has been removed from your calendar.`
    });
  };
  
  const handleChecklistItemToggle = (eventId: string, checklistItemId: string, completed: boolean) => {
      if (!firestore) return;
      const eventToUpdate = events.find(e => e.id === eventId);
      if (!eventToUpdate) return;
      
      const updatedChecklist = eventToUpdate.checklist?.map(item => 
          item.id === checklistItemId ? { ...item, completed } : item
      );
      
      const eventRef = doc(firestore, 'tenants', tenantId, 'events', eventId);
      updateDocumentNonBlocking(eventRef, { checklist: updatedChecklist });
  };

  const handleJumpTo = (weeks: number) => {
    setCurrentDate(prevDate => addWeeks(prevDate, weeks));
  };
  
  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setCurrentDate(date);
    }
  };

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    let client = (clients || []).find(c => c.id === selectedAppointment.clientId);
    const service = (services || []).find(s => s.id === selectedAppointment.serviceId);

    // If client is not found in the main client list (e.g., for a new walk-in)
    // create a temporary client object using the denormalized name.
    if (!client && selectedAppointment.clientName) {
        client = {
            id: selectedAppointment.clientId,
            name: selectedAppointment.clientName,
            email: '', phone: '', avatarUrl: '', lifetimeValue: 0, lastAppointment: ''
        };
    }

    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment, clients, services]);
  
  const handlePrintReceipt = (receiptData: Omit<ReceiptData, 'business'>) => {
    setReceiptToPrint({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...receiptData
    });
  };

  const handlePrintTicket = (ticketData: Omit<TicketData, 'business'>) => {
    setTicketToPrint({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...ticketData
    });
  }

  const appointmentsForDay = useMemo(() => {
    return (appointments || [])
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .sort((a, b) => apt.startTime.getTime() - b.startTime.getTime());
  }, [appointments, currentDate]);

  const eventsForDay = (events || [])
      .filter(evt => isSameDay(evt.startTime, currentDate))
      .sort((a,b) => evt.startTime.getTime() - b.startTime.getTime());
  
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  const handleScan = useCallback((data: string) => {
    if (!appointments) return;
    if (data.startsWith('clarityflow://walk-in/')) {
        const walkInId = data.split('/').pop();
        const appointmentId = `apt-walkin-${walkInId}`;
        const appointmentToCheckout = appointments.find(apt => apt.id === appointmentId);

        if (appointmentToCheckout) {
            setSelectedAppointment(appointmentToCheckout);
            setIsCheckoutOpen(true);
        } else {
            toast({
                variant: 'destructive',
                title: 'Appointment Not Found',
                description: 'Could not find a matching walk-in appointment. The data may still be syncing. Please try again in a moment.',
            });
        }
    }
  }, [appointments, toast]);

  useEffect(() => {
    if (scannedData) {
        handleScan(scannedData);
        setScannedData(null); // Reset after processing
    }
  }, [scannedData, handleScan]);

  useEffect(() => {
    let html5QrCode: Html5Qrcode | undefined;
    if (isScannerOpen) {
        // Use a timeout to ensure the element is in the DOM and visible
        const timer = setTimeout(() => {
            const element = document.getElementById('qr-reader-planner');
            if (element) {
                html5QrCode = new Html5Qrcode('qr-reader-planner');
                const onScanSuccess = (decodedText: string, decodedResult: any) => {
                    if (html5QrCode?.isScanning) {
                        html5QrCode.stop().catch(console.error);
                    }
                    setScannedData(decodedText);
                    setIsScannerOpen(false);
                };

                const onScanFailure = (error: any) => { /* ignore */ };

                html5QrCode.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: 250, height: 250 } },
                    onScanSuccess,
                    onScanFailure
                ).catch(err => {
                    toast({
                        variant: 'destructive',
                        title: 'Camera Error',
                        description: 'Could not start the camera. Please check permissions and try again.',
                    });
                    setIsScannerOpen(false);
                });
            }
        }, 300); // A small delay to allow dialog animation to complete

        return () => {
            clearTimeout(timer);
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => {
                    console.error("Failed to stop QR Code scanner.", err);
                });
            }
        };
    }
}, [isScannerOpen, handleScan, toast]);
  
  const showStaffColumnHeader = !isMobile || (staff || []).length === 1;

  if (!hasMounted || isUserLoading || appointmentsLoading || servicesLoading || clientsLoading || walkInsLoading || staffLoading || eventsLoading || billDefinitionsLoading || billInstancesLoading) {
    return (
      <div className="flex h-screen w-full flex-col">
        <AppHeaderClient title="Planner" />
        <div className="flex items-center justify-center flex-1">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeaderClient title="Planner" />
      
      <div className="p-4 border-b space-y-4">
        <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-semibold">{format(currentDate, 'MMMM yyyy')}</h2>
            </div>

            {/* Mobile: date nav under month/year */}
             <div className="md:hidden flex items-center gap-2">
                <Button variant="outline" onClick={() => setCurrentDate(subWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                <Button variant="outline" onClick={() => setCurrentDate(addWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                <Button variant="outline" onClick={handleToday} className="h-8">Today</Button>
                <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8"><CalendarIcon className="h-4 w-4" /><span className="sr-only">Jump To...</span></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleJumpTo(2)}>+ 2 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(4)}>+ 4 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(6)}>+ 6 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(8)}>+ 8 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(10)}>+ 10 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(12)}>+ 12 Weeks</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleJumpTo(-2)}>- 2 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-4)}>- 4 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-6)}>- 6 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-8)}>- 8 Weeks</DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleJumpTo(-10)}>- 10 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-12)}>- 12 Weeks</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>

        <div className="md:hidden flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-4 h-4" /><span className="sr-only">Weekly KPIs</span></Button></TooltipTrigger><TooltipContent><p>Weekly KPIs</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                        <BellRing className={cn("h-4 w-4", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                        {dailyBillInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                        <span className="sr-only">Bills Due Today</span>
                    </Button>
                </TooltipTrigger><TooltipContent><p>Bills Due Today</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-4 h-4" /><span className="sr-only">Picking List</span></Button></TooltipTrigger><TooltipContent><p>Picking List</p></TooltipContent></Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsScannerOpen(true)}><QrCode className="w-4 h-4 mr-2"/>Scan</Button>
            <Button size="sm" onClick={() => setIsAddEventOpen(true)}>
                + Event
            </Button>
            <Button size="sm" onClick={() => setIsAddAppointmentOpen(true)}>
                + Appointment
            </Button>
          </div>
        </div>

        <div className="hidden md:block space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setCurrentDate(subWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                    <Button variant="outline" onClick={() => setCurrentDate(addWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                    <Button variant="outline" onClick={handleToday} className="h-8">Today</Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-8 w-8"><CalendarIcon className="h-4 w-4" /><span className="sr-only">Jump To...</span></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleJumpTo(2)}>+ 2 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(4)}>+ 4 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(6)}>+ 6 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(8)}>+ 8 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(10)}>+ 10 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(12)}>+ 12 Weeks</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleJumpTo(-2)}>- 2 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-4)}>- 4 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-6)}>- 6 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-8)}>- 8 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-10)}>- 10 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-12)}>- 12 Weeks</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
             <div className="flex items-center justify-end gap-2">
                <TooltipProvider>
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-4 h-4" /><span className="sr-only">Weekly KPIs</span></Button></TooltipTrigger><TooltipContent><p>Weekly KPIs</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                            <BellRing className={cn("h-4 w-4", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                            {dailyBillInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                            <span className="sr-only">Bills Due Today</span>
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Bills Due Today</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-4 h-4" /><span className="sr-only">Picking List</span></Button></TooltipTrigger><TooltipContent><p>Picking List</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><QrCode className="h-4 w-4" /><span className="sr-only">Scan Ticket</span></Button></TooltipTrigger><TooltipContent><p>Scan Ticket</p></TooltipContent></Tooltip>
                </TooltipProvider>
                <Button size="sm" onClick={() => setIsAddEventOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Event</Button>
                <Button size="sm" onClick={() => setIsAddAppointmentOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
            </div>
        </div>
      </div>
      
      <main className="flex-1 flex flex-col min-h-0">
          {isMobile && (staff || []).length > 1 && (
            <div className="p-4 border-b">
              <Label htmlFor="staff-selector">Viewing Schedule For</Label>
              <Select value={mobileSelectedStaffId} onValueChange={setMobileSelectedStaffId}>
                <SelectTrigger id="staff-selector" className="mt-1">
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {(staff || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DayTimeline 
              date={currentDate} 
              staff={staffToDisplay}
              itemsByStaff={itemsToDisplay}
              onCompleteClick={handleCompleteClick} 
              onUpdateStatus={handleUpdateStatus}
              onDeleteAppointment={handleDeleteAppointment} 
              onPrintReceipt={handlePrintReceipt}
              onPrintTicket={handlePrintTicket}
              onEditAppointment={handleEditClick}
              onEditEvent={handleEditEventClick}
              onChecklistItemToggle={handleChecklistItemToggle}
              onUpdateEvent={handleUpdateEvent}
              dailyTransactions={dailyTransactions}
              onAddTransaction={handleAddTransaction}
              onReschedule={handleRescheduleClick}
              onOpenPickingList={() => setIsPickingListOpen(true)}
              onStartService={handleStartService}
              onFinishService={handleFinishService}
              onBookNewForClient={handleBookNewAppointmentForClient}
              walkIns={walkIns}
              clients={clients}
              services={services}
              showStaffColumnHeader={showStaffColumnHeader}
          />
      </main>
      {selectedAppointmentData && (
        <CompleteAppointmentDialog
            open={isCheckoutOpen}
            onOpenChange={(isOpen) => {
              if(!isOpen) setSelectedAppointment(null);
              setIsCheckoutOpen(isOpen);
            }}
            appointmentData={selectedAppointmentData}
            onConfirmCheckout={handleCheckout}
            onSendToFrontDesk={handleSendToFrontDesk}
            onRebook={handleRebook}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setAppointmentToRebook(null);
                setInitialClientIdForNewApt('');
            }
            setIsAddAppointmentOpen(isOpen);
        }}
        clients={clients || []}
        services={services || []}
        staff={staff || []}
        appointments={appointments || []}
        onConfirm={handleAddAppointment}
        initialClientId={appointmentToRebook ? appointmentToRebook.clientId : initialClientIdForNewApt}
        appointmentToRebook={appointmentToRebook}
      />
       {selectedAppointment && (
        <EditAppointmentDialog 
            open={isEditAppointmentOpen}
            onOpenChange={setIsEditAppointmentOpen}
            appointment={selectedAppointment}
            clients={clients || []}
            services={services || []}
            appointments={appointments || []}
            onConfirm={handleUpdateAppointment}
        />
       )}
        {selectedAppointment && (
            <RescheduleDialog
                open={isRescheduleOpen}
                onOpenChange={setIsRescheduleOpen}
                appointment={selectedAppointment}
                clients={clients || []}
                services={services || []}
                appointments={appointments || []}
                onConfirm={handleUpdateAppointment}
            />
        )}
      <AddEventDialog 
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={handleAddEvent}
        appointments={appointments || []}
        events={events || []}
        staff={staff || []}
      />
       {selectedEvent && (
        <EditEventDialog
            open={isEditEventOpen}
            onOpenChange={setIsEditEventOpen}
            event={selectedEvent}
            onConfirm={handleUpdateEvent}
        />
       )}
        <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={weeklyKpis} isMobile={!!isMobile} />
        <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={dailyBillInstances} isMobile={!!isMobile} onLogPaymentClick={handleLogPaymentClick}/>
        
        <PickingListDialog
            open={isPickingListOpen}
            onOpenChange={setIsPickingListOpen}
            appointments={appointmentsForDay}
        />
        
        {selectedBill && (
            <LogPaymentDialog
                open={!!selectedBill}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setSelectedBill(null);
                    }
                }}
                billInstance={selectedBill}
                onConfirm={handleLogPaymentConfirm}
            />
      )}

      <Dialog open={!!receiptToPrint} onOpenChange={(open) => !open && setReceiptToPrint(null)}>
        <DialogContent className="max-w-sm print-content">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          <div id="receipt-area">
            {receiptToPrint && <PrintReceipt data={receiptToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setReceiptToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!ticketToPrint} onOpenChange={(open) => !open && setTicketToPrint(null)}>
        <DialogContent className="max-w-md print-content">
          <DialogHeader className="print:hidden">
            <DialogTitle>Appointment Ticket</DialogTitle>
          </DialogHeader>
          <div id="ticket-area-dialog">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setTicketToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Ticket</DialogTitle>
            <DialogDescription>
              Position the walk-in ticket's QR code inside the frame to check out the client.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <div id="qr-reader-planner" className="w-full rounded-md bg-muted" />
          </div>
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <AlertDialog open={!!startConfirmAppointment} onOpenChange={(open) => !open && setStartConfirmAppointment(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Start Service?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will mark the appointment as &quot;In Service&quot; and log the current time as the actual start time.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmStartService}>Start Service</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!finishConfirmAppointment} onOpenChange={(open) => !open && setFinishConfirmAppointment(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Finish Service?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {finishDialogDuration !== null ?
                        `This will end the service. Total elapsed time: ${finishDialogDuration} minutes. ` : ''
                        }
                        The appointment status will be set to "Ready for Checkout".
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmFinishService}>Finish &amp; Await Checkout</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <div id="print-ticket-area" className="hidden">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
        </div>
    </div>
  );
}

