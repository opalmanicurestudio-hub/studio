'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode, Globe, Building, HardHat } from 'lucide-react';
import { type Event, type EventChecklistItem, type StockCorrection, type Staff, type Appointment, type AppointmentCheckoutState, type Resource } from '@/lib/data';
import { type Bill, type Transaction, type BillInstance, type BillDefinition } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping, addMonths } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
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
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch } from 'firebase/firestore';
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
import { WalkIn, type Client, type Service, memberships as initialMemberships, packages as initialPackages } from '@/lib/data';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { nanoid } from 'nanoid';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';


function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { firestore, user, isUserLoading } = useFirebase();
  const { selectedTenant, isLoading: isTenantLoading } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const { 
      clients, 
      services, 
      staff, 
      appointments: appointmentsFromInventory, 
      events: eventsFromInventory, 
      resources,
      walkIns,
      billDefinitions,
      billInstances,
      isLoading
  } = useInventory();
  
  const appointments = useMemo(() => {
    if (!appointmentsFromInventory) return [];
    return appointmentsFromInventory.map(apt => ({
        ...apt,
        startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
        endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
    }));
  }, [appointmentsFromInventory]);
  
  const events = useMemo(() => {
    if (!eventsFromInventory) return [];
    return eventsFromInventory.map(evt => ({
        ...evt,
        startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime),
        endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime),
    }));
  }, [eventsFromInventory]);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
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
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [receiptDataForPrompt, setReceiptDataForPrompt] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  
  const [mobileSelectedStaffId, setMobileSelectedStaffId] = useState<string>('');

  const [startConfirmAppointment, setStartConfirmAppointment] = useState<Appointment | null>(null);

  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [initialClientIdForNewApt, setInitialClientIdForNewApt] = useState<string>('');
  const [newAppointmentSlot, setNewAppointmentSlot] = useState<{ startTime: Date; staffId: string } | null>(null);


  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);

  const [activeView, setActiveView] = useState(viewParam === 'resources' ? 'resources' : 'staff');
    
  const scheduleProfilesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true));
  }, [firestore, tenantId]);
  
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);

  useEffect(() => {
    if (staff && staff.length > 0 && !mobileSelectedStaffId) {
      setMobileSelectedStaffId(staff[0].id);
    }
  }, [staff, mobileSelectedStaffId]);

  const weekStart = useMemo(() => {
    return startOfWeek(currentDate, { weekStartsOn: 0 });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = weekStart;
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekStart]);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
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
        .sort((a,b) => parseISO(a.dueDate).getTime() - (parseISO(b.dueDate)).getTime());
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
  
  const itemsByResource = useMemo(() => {
    const map = new Map<string, (Appointment | Event)[]>();
    if (!resources || !services) return map;
    resources.forEach(res => map.set(res.id, []));

    (appointments || [])
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .forEach(apt => {
        const resourceIds = apt.requiredResourceIds && apt.requiredResourceIds.length > 0
          ? apt.requiredResourceIds
          : [...new Set([
              ...(services.find(s => s.id === apt.serviceId)?.requiredResourceIds || []),
              ...(apt.addOnIds || []).flatMap(id => services.find(s => s.id === id)?.requiredResourceIds || [])
            ])];

        if (resourceIds && resourceIds.length > 0) {
          resourceIds.forEach(resourceId => {
            if (map.has(resourceId)) {
              map.get(resourceId)!.push({ ...apt, itemType: 'appointment' } as Appointment);
            }
          });
        }
      });

    map.forEach(items => {
      items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    });

  }, [currentDate, appointments, resources, services]);

  const staffToDisplay = useMemo(() => {
    if (isMobile) {
        if (!mobileSelectedStaffId || !staff) return [];
        const selected = (staff || []).find(s => s.id === mobileSelectedStaffId);
        return selected ? [selected] : [];
    }
    return staff || [];
  }, [isMobile, mobileSelectedStaffId, staff]);

  const staffItemsToDisplay = useMemo(() => {
      if (isMobile) {
          if (!mobileSelectedStaffId || !itemsByStaff.has(mobileSelectedStaffId)) return new Map();
          return new Map([[mobileSelectedStaffId, itemsByStaff.get(mobileSelectedStaffId)!]]);
      }
      return itemsByStaff;
  }, [isMobile, mobileSelectedStaffId, itemsByStaff]);


  const handleCompleteClick = (appointment: Appointment) => {
    if (appointment.status === 'completed') {
      toast({
        title: 'Already Completed',
        description: 'This appointment has already been checked out.',
      });
      return;
    }
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
    if (!selectedBill || !firestore || !user || !tenantId) return;

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

  const handleCheckout = async (data: CheckoutData) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    
    const {
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns,
      absorbedCost,
      receiptData,
      newCorrections,
      incident,
      redeemedOffer,
      appliedDiscountId
    } = data;

    const allPerformedServices = [services?.find(s => s.id === selectedAppointment.serviceId), ...addOns].filter((s): s is Service => !!s);
    
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');

    // 1. Service Revenue Transactions
    allPerformedServices.forEach(service => {
        const staffId = serviceStaffOverrides[service.id] || selectedAppointment.staffId;
        const newTransaction: Omit<Transaction, 'id' | 'date'> = {
            description: `Service: ${service.name}`,
            clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
            clientId: selectedAppointment.clientId,
            type: 'income',
            context: 'Business',
            category: 'Service Revenue',
            amount: redeemedOffer ? 0 : service.price,
            paymentMethod: receiptData.payment.method,
            hasReceipt: true,
            staffId: staffId,
            appointmentId: selectedAppointment.id,
        };
        addDocumentNonBlocking(transactionsRef, {...newTransaction, date: new Date().toISOString()});
    });

    // 2. Tip Transactions
    Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
        if (tipAmount > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Tip for Appointment #${selectedAppointment.id.slice(-4)}`,
                clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                clientId: selectedAppointment.clientId,
                type: 'income',
                context: 'Business',
                category: 'Tips',
                amount: tipAmount,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: staffId,
                tipAmount: tipAmount,
                appointmentId: selectedAppointment.id,
            };
            addDocumentNonBlocking(transactionsRef, {...newTransaction, date: new Date().toISOString()});
        }
    });

    // 3. Retail Transactions
    if (retailItems.length > 0 && inventory) {
        const retailTotal = retailItems.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
            return acc + (item.quantity * price);
        }, 0);
        if (retailTotal > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Retail Sale (${retailItems.length} items)`,
                clientOrVendor: (clients || []).find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                clientId: selectedAppointment.clientId,
                type: 'income',
                context: 'Business',
                category: 'Retail',
                amount: retailTotal,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: selectedAppointment.staffId, // Or assign to a specific staff
                appointmentId: selectedAppointment.id,
            };
            addDocumentNonBlocking(transactionsRef, {...newTransaction, date: new Date().toISOString()});
        }
    }
    
    // 4. Update stock corrections
    newCorrections.forEach((correction) => {
        addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'stockCorrections'), correction);
    });
    
    // 5. Update appointment
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    const updateData: any = {
        status: 'completed',
        absorbedCost: absorbedCost,
    };
    if (incident) {
        updateData.incident = incident;
    }
    updateDocumentNonBlocking(appointmentRef, updateData);

    // 6. Update staff status for all involved staff
    const staffIdsInvolved = new Set(Object.values(serviceStaffOverrides));
    staffIdsInvolved.forEach(staffId => {
      if (staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        updateDocumentNonBlocking(staffDocRef, {
          status: 'idle',
          lastServedTimestamp: new Date().toISOString(),
        });
      }
    });
    
    // 7. Update Walk-in if applicable
    if (selectedAppointment.isWalkIn) {
      const walkInId = selectedAppointment.id.replace('apt-walkin-', '');
      const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
      updateDocumentNonBlocking(walkInDocRef, { status: 'completed' });
    }
    
    // 8. Update Client Lifetime Value
    const clientToUpdate = (clients || []).find(c => c.id === selectedAppointment.clientId);
    if (clientToUpdate) {
        const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, clientToUpdate.id);
        const updates: Partial<Client> = {
            lifetimeValue: (clientToUpdate.lifetimeValue || 0) + receiptData.total,
            lastAppointment: new Date().toISOString()
        };

        if (redeemedOffer?.type === 'package') {
            updates.activePackages = clientToUpdate.activePackages?.map(p => {
                if (p.packageId === redeemedOffer.id) {
                    return { ...p, sessionsRemaining: p.sessionsRemaining - 1 };
                }
                return p;
            }).filter(p => p.sessionsRemaining > 0);
        }

        updateDocumentNonBlocking(clientDocRef, updates);
    }
    
    // 9. Update Discount Usage
    if (appliedDiscountId) {
        const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', appliedDiscountId);
        const discountUpdate: any = {
            usageCount: increment(1)
        };
        if (selectedAppointment.clientId) {
            discountUpdate.usedByClientIds = arrayUnion(selectedAppointment.clientId);
        }
        updateDocumentNonBlocking(discountRef, discountUpdate);
    }

    setReceiptDataForPrompt({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...receiptData
    });
  };
  
  const handleAddAppointment = async (newAppointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date, recurrence?: { frequency: string, endDate: Date }}) => {
    if (!firestore || !tenantId) return;

    const { recurrence, ...baseAppointment } = newAppointmentData;

    let finalClientId = baseAppointment.clientId;
    let finalClientName = (clients || []).find(c => c.id === finalClientId)?.name || 'Walk-in Customer';
    
    if (finalClientId && finalClientId.startsWith('walkin-')) {
        const existingClient = (clients || []).find(c => c.name === baseAppointment.clientName);
        if (existingClient) {
            finalClientId = existingClient.id;
        } else {
            const clientsCollection = collection(firestore, 'tenants', tenantId, 'clients');
            const newClientRef = doc(clientsCollection);
            const newId = newClientRef.id;
            const newClient: Client = {
              id: newId,
              name: baseAppointment.clientName || 'Walk-in Customer',
              email: '', 
              phone: '',
              avatarUrl: '',
              lifetimeValue: 0,
              lastAppointment: new Date().toISOString(),
              status: 'active',
            };
            await setDoc(newClientRef, newClient);
            finalClientId = newId;
            finalClientName = newClient.name;
        }
    }

    if (recurrence && recurrence.frequency && recurrence.endDate) {
        const batch = writeBatch(firestore);
        const recurrenceId = nanoid();
        let currentStartTime = baseAppointment.startTime;
        let currentEndTime = baseAppointment.endTime;

        while (isBefore(currentStartTime, recurrence.endDate)) {
            const appointmentDocId = nanoid();
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentDocId);
            const checkInToken = nanoid(16);

            const appointmentToSave = {
                ...baseAppointment,
                clientId: finalClientId,
                clientName: finalClientName,
                id: appointmentDocId,
                startTime: currentStartTime.toISOString(),
                endTime: currentEndTime.toISOString(),
                checkInToken: checkInToken,
                recurrenceId: recurrenceId,
            };
            batch.set(appointmentRef, appointmentToSave);

            const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
            batch.set(checkInDocRef, appointmentToSave);
            
            if (recurrence.frequency === 'weekly') {
                currentStartTime = addWeeks(currentStartTime, 1);
                currentEndTime = addWeeks(currentEndTime, 1);
            } else if (recurrence.frequency === 'bi-weekly') {
                currentStartTime = addWeeks(currentStartTime, 2);
                currentEndTime = addWeeks(currentEndTime, 2);
            } else if (recurrence.frequency === 'every-3-weeks') {
                currentStartTime = addWeeks(currentStartTime, 3);
                currentEndTime = addWeeks(currentEndTime, 3);
            } else if (recurrence.frequency === 'every-4-weeks') {
                currentStartTime = addWeeks(currentStartTime, 4);
                currentEndTime = addWeeks(currentEndTime, 4);
            } else if (recurrence.frequency === 'monthly') {
                currentStartTime = addMonths(currentStartTime, 1);
                currentEndTime = addMonths(currentEndTime, 1);
            } else {
                break;
            }
        }
        await batch.commit();
        toast({
            title: "Recurring Appointments Booked",
            description: `Appointments with ${finalClientName} have been added to the calendar.`
        });
    } else {
        const appointmentDocId = nanoid();
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentDocId);
        
        const checkInToken = nanoid(16);
        const appointmentToSave = { 
            ...baseAppointment, 
            id: appointmentDocId,
            clientId: finalClientId, 
            clientName: finalClientName,
            checkInToken: checkInToken,
            startTime: baseAppointment.startTime.toISOString(),
            endTime: baseAppointment.endTime.toISOString(),
        };
        
        await setDoc(appointmentRef, appointmentToSave);

        const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
        await setDoc(checkInDocRef, appointmentToSave);
        
        toast({
            title: "Appointment Booked",
            description: `Appointment with ${finalClientName} has been added.`
        });
    }
    
    setIsAddAppointmentOpen(false);
    setInitialClientIdForNewApt('');
  };

  const handleUpdateAppointment = (updatedAppointment: Appointment) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', updatedAppointment.id);
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

  const handleRebook = (appointment: Appointment, weeksOut?: number) => {
    setIsCheckoutOpen(false);
    setSelectedAppointment(null); // Clear appointment from checkout
    
    let rebookAppointmentData: Appointment = { ...appointment };

    if (weeksOut) {
        rebookAppointmentData.startTime = addWeeks(appointment.startTime, weeksOut);
    }
    
    setAppointmentToRebook(rebookAppointmentData);
    setIsAddAppointmentOpen(true);
  };

  const handleBookNewAppointmentForClient = (clientId: string) => {
    setAppointmentToRebook(null);
    setInitialClientIdForNewApt(clientId);
    setIsAddAppointmentOpen(true);
  };

  const handleTimeSlotClick = (startTime: Date, staffId: string) => {
    setNewAppointmentSlot({ startTime, staffId });
    setAppointmentToRebook(null);
    setInitialClientIdForNewApt('');
    setIsAddAppointmentOpen(true);
  };


  const handleAddEvent = (newEvent: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date}) => {
    if (!firestore || !tenantId) return;
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
        if (!firestore || !tenantId) return;
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
    
    const addTransaction = (transaction: Omit<Transaction, 'id' | 'date'>) => {
        if (!firestore || !user || !tenantId) {
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
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'ready_for_checkout',
        checkoutState,
        actualEndTime: new Date().toISOString(),
    });
    
    const walkInId = appointmentId.replace('apt-walkin-', '');
    if (walkIns?.find(w => w.id === walkInId)) {
        const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, {
            status: 'ready_for_checkout',
            serviceEndTime: new Date().toISOString()
        });
    }

    setIsTechnicianReviewOpen(false);
    setSelectedAppointment(null);
    toast({
      title: 'Sent to Front Desk',
      description: "Client is ready for checkout.",
    });
  };

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    if (!firestore || !tenantId) return;
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
    if (!startConfirmAppointment || !firestore || !tenantId) return;
    const nowISO = new Date().toISOString();
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', startConfirmAppointment.id);
    updateDocumentNonBlocking(appointmentRef, { status: 'servicing', actualStartTime: nowISO });
    
    if (startConfirmAppointment.staffId) {
      const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', startConfirmAppointment.staffId);
      updateDocumentNonBlocking(staffDocRef, { status: 'busy' });
    }

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
    const updatedAppointment = { ...appointment, actualEndTime: new Date().toISOString() };
    setSelectedAppointment(updatedAppointment);
    setIsTechnicianReviewOpen(true);
  };


  const handleDeleteAppointment = (appointmentId: string) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    deleteDocumentNonBlocking(appointmentRef);
     toast({
        variant: "destructive",
        title: "Appointment Deleted",
        description: `The appointment has been removed from your calendar.`
    });
  };
  
  const handleChecklistItemToggle = (eventId: string, checklistItemId: string, completed: boolean) => {
      if (!firestore || !tenantId) return;
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

    const walkIn = selectedAppointment.isWalkIn && walkIns
      ? walkIns.find(w => `apt-walkin-${w.id}` === selectedAppointment.id)
      : undefined;

    if (!client && selectedAppointment.clientName) {
        client = {
            id: selectedAppointment.clientId,
            name: selectedAppointment.clientName,
            email: selectedAppointment.clientEmail || '',
            phone: selectedAppointment.clientPhone || '',
            avatarUrl: '',
            lifetimeValue: 0,
            lastAppointment: ''
        };
    }

    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment, clients, services, walkIns]);
  
  const handlePrintReceipt = (receiptData: ReceiptData) => {
    setReceiptToPrint(receiptData);
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
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
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

        if (appointmentToCheckout && appointmentToCheckout.status === 'ready_for_checkout') {
            setSelectedAppointment(appointmentToCheckout);
            setIsCheckoutOpen(true);
        } else if (appointmentToCheckout) {
          toast({
            title: 'Appointment Not Ready',
            description: "This appointment is not yet marked as ready for checkout.",
          });
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
            
            setTimeout(() => {
                html5QrCode?.start(
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
            }, 300);
        }
      }, 100); 

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
  
  const showStaffColumnHeader = !isMobile;
  
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);

  if (isLoading || isUserLoading || isTenantLoading || scheduleProfilesLoading) {
    return (
      <div className="flex h-screen w-full flex-col">
        <AppHeader />
        <div className="flex items-center justify-center flex-1">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader />
      
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

        <div className="md:hidden flex items-center justify-end gap-2">
            <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
              <QrCode className="w-4 h-4"/>
              <span className="sr-only">Scan</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <MoreHorizontal className="mr-2 h-4 w-4" />
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                 <DropdownMenuItem onClick={() => setIsAddAppointmentOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Appointment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsAddEventOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Event
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href={`/book/${tenantId}`} target="_blank">
                        <Globe className="mr-2 h-4 w-4" />
                        Booking Page
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href={`/walk-in/${tenantId}`} target="_blank">
                        <Users className="mr-2 h-4 w-4" />
                        Walk-in Kiosk
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsKpiSheetOpen(true)}>
                    <BarChart className="mr-2 h-4 w-4" />
                    Weekly KPIs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsBillsSheetOpen(true)}>
                    <BellRing className="mr-2 h-4 w-4" />
                    Bills Due
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsPickingListOpen(true)}>
                    <List className="mr-2 h-4 w-4" />
                    Picking List
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                        <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><QrCode className="w-4 h-4" /><span className="sr-only">Scan Ticket</span></Button></TooltipTrigger><TooltipContent><p>Scan Ticket</p></TooltipContent></Tooltip>
                    </TooltipProvider>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                                <Globe className="mr-2 h-4 w-4" />
                                Public Pages
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                                <Link href={`/book/${tenantId}`} target="_blank">View Booking Page</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href={`/walk-in/${tenantId}`} target="_blank">View Walk-in Kiosk</Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button size="sm" onClick={() => setIsAddEventOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Event</Button>
                    <Button size="sm" onClick={() => setIsAddAppointmentOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
                </div>
            </div>
        </div>
      </div>
      
      <Tabs value={activeView} onValueChange={setActiveView} className="px-4 pt-2 border-b">
        <TabsList className="grid w-full grid-cols-2 md:inline-flex md:w-auto">
          <TabsTrigger value="staff">Staff View</TabsTrigger>
          <TabsTrigger value="resources">Resource View</TabsTrigger>
        </TabsList>
      </Tabs>

       <div className="border-b">
        <ScrollArea className="w-full md:whitespace-normal">
            <div className="flex w-full">
                {weekDays.map(day => (
                    <button
                        key={day.toISOString()}
                        onClick={() => setCurrentDate(day)}
                        className={cn(
                            "flex-1 p-2 text-center md:p-3 transition-colors hover:bg-muted/50",
                            isSameDay(day, currentDate) && (isMobile ? "border-b-2 border-primary" : "bg-muted")
                        )}
                    >
                        <p className={cn("text-xs", isSameDay(day, currentDate) ? "text-primary font-semibold" : "text-muted-foreground")}>
                            {format(day, 'EEE')}
                        </p>
                        <p className={cn("text-lg md:text-2xl font-bold mt-1", !isSameDay(day, currentDate) && "text-muted-foreground")}>
                            {format(day, 'd')}
                        </p>
                    </button>
                ))}
            </div>
            <ScrollBar orientation="horizontal" className="md:hidden" />
        </ScrollArea>
    </div>
      
      <main className="flex-1 flex flex-col min-h-0">
          {isMobile && activeView === 'staff' && (
            <div className="p-4 border-b">
              <Label htmlFor="staff-selector">Viewing Schedule For</Label>
              <Select value={mobileSelectedStaffId} onValueChange={setMobileSelectedStaffId}>
                <SelectTrigger id="staff-selector" className="mt-1">
                    {mobileSelectedStaffId && staff?.find(s => s.id === mobileSelectedStaffId) ? (
                    <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                        <AvatarImage src={staff.find(s => s.id === mobileSelectedStaffId)?.avatarUrl} />
                        <AvatarFallback>{staff.find(s => s.id === mobileSelectedStaffId)?.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span>{staff.find(s => s.id === mobileSelectedStaffId)?.name}</span>
                    </div>
                    ) : (
                    <SelectValue placeholder="Select a staff member" />
                    )}
                </SelectTrigger>
                <SelectContent>
                  {(staff || []).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                            <Avatar className="w-6 h-6">
                                <AvatarImage src={s.avatarUrl} />
                                <AvatarFallback>{s.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span>{s.name}</span>
                        </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

           {activeView === 'staff' && (
            <DayTimeline 
                date={currentDate} 
                columns={staffToDisplay}
                itemsByColumn={staffItemsToDisplay}
                showColumnHeader={showStaffColumnHeader}
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
                onAddTransaction={addTransaction}
                onReschedule={handleRescheduleClick}
                onRebook={handleRebook}
                onOpenPickingList={() => setIsPickingListOpen(true)}
                onStartService={handleStartService}
                onFinishService={handleFinishService}
                onBookNewForClient={handleBookNewAppointmentForClient}
                walkIns={walkIns}
                clients={clients}
                services={services}
                resources={resources || []}
                publicScheduleProfile={publicScheduleProfile}
                onTimeSlotClick={handleTimeSlotClick}
            />
          )}

          {activeView === 'resources' && (
             <DayTimeline 
                date={currentDate} 
                columns={resources || []}
                itemsByColumn={itemsByResource}
                showColumnHeader={true}
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
                onAddTransaction={addTransaction}
                onReschedule={handleRescheduleClick}
                onRebook={handleRebook}
                onOpenPickingList={() => setIsPickingListOpen(true)}
                onStartService={handleStartService}
                onFinishService={handleFinishService}
                onBookNewForClient={handleBookNewAppointmentForClient}
                walkIns={walkIns}
                clients={clients}
                services={services}
                resources={resources || []}
                publicScheduleProfile={publicScheduleProfile}
                onTimeSlotClick={() => {}} // Not implemented for resource view
            />
          )}
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
            onRebook={handleRebook}
            staff={staff || []}
        />
      )}
      {selectedAppointmentData && (
        <TechnicianReviewDialog
            open={isTechnicianReviewOpen}
            onOpenChange={(isOpen) => {
                if(!isOpen) setSelectedAppointment(null);
                setIsTechnicianReviewOpen(isOpen);
            }}
            appointmentData={selectedAppointmentData}
            onSendToFrontDesk={handleSendToFrontDesk}
            staff={staff || []}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setAppointmentToRebook(null);
                setInitialClientIdForNewApt('');
                setNewAppointmentSlot(null);
            }
            setIsAddAppointmentOpen(isOpen);
        }}
        initialClientId={appointmentToRebook ? appointmentToRebook.clientId : initialClientIdForNewApt}
        appointmentToRebook={appointmentToRebook}
        initialStartTime={newAppointmentSlot?.startTime}
        initialStaffId={newAppointmentSlot?.staffId}
        onConfirm={handleAddAppointment}
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

      <AlertDialog open={!!receiptDataForPrompt} onOpenChange={() => setReceiptDataForPrompt(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Print Receipt?</AlertDialogTitle>
                <AlertDialogDescription>
                    Would you like to print a receipt for this transaction?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>No, Thanks</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                    if (receiptDataForPrompt) {
                        handlePrintReceipt(receiptDataForPrompt);
                    }
                    setReceiptDataForPrompt(null);
                }}>
                    Print Receipt
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!receiptToPrint} onOpenChange={(open) => !open && setReceiptToPrint(null)}>
        <DialogContent className="max-w-sm print-content">
          <DialogHeader className="print:hidden">
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

        <div id="print-ticket-area" className="hidden">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
        </div>
    </div>
  );
}



export default function PlannerPageWrapper() {
  return (
    <Suspense fallback={
        <div className="flex h-screen w-full flex-col">
            <AppHeader />
            <div className="flex items-center justify-center flex-1">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        </div>
    }>
        <PlannerPageContent />
    </Suspense>
  )
}

    