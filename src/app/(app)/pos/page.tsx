
'use client';

import React, { useState, useMemo, useEffect, KeyboardEvent, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type ActivityLog, type ClientFormData, StockCorrection, Discount, Membership, Package } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckoutQueue } from '@/components/pos/CheckoutQueue';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, Sparkles, Printer, Loader } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';


const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className={cn("p-2 rounded-lg", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);


export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages } = useInventory();
    const [cart, setCart] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    // State for group checkouts
    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set<string>());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    const isMobile = useIsMobile();
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedData, setScannedData] = useState<string | null>(null);
    
    const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);

    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [promoCode, setPromoCode] = useState('');
    const [discount, setDiscount] = useState(0);
    const [membershipDiscount, setMembershipDiscount] = useState(0);
    const [appliedDiscountCode, setAppliedDiscountCode] = useState<string | undefined>(undefined);
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
          endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
        }));
    }, [appointmentsFromDB]);

    const readyForCheckoutAppointments = useMemo(() => {
      if (!appointments || !clients || !services || !staff) return [];
      return appointments
        .filter(apt => apt.status === 'ready_for_checkout')
        .map(apt => {
          let client = clients.find(c => c.id === apt.clientId);
          // If a client isn't found but there's a name on the appointment, create a temporary client object for display.
          if (!client && apt.clientName) {
            client = {
              id: apt.clientId,
              name: apt.clientName,
              email: apt.clientEmail || '',
              phone: apt.clientPhone || '',
              avatarUrl: '',
              lifetimeValue: 0,
              lastAppointment: ''
            } as Client;
          }

          const service = services.find(s => s.id === apt.serviceId);
          const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
          const staffMember = staff.find(s => s.id === apt.staffId);
          return { ...apt, client, service, addOnServices, staff: staffMember };
        })
        .filter((a): a is Appointment & { client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [appointments, clients, services, staff]);

    const handleSelectAppointment = useCallback((appointmentId: string) => {
        const newSet = new Set(selectedAppointmentIds);
        if (newSet.has(appointmentId)) {
            newSet.delete(appointmentId);
        } else {
            newSet.add(appointmentId);
        }
        setSelectedAppointmentIds(newSet);
    }, [selectedAppointmentIds]);
    
    useEffect(() => {
        const checkoutId = searchParams.get('checkout_id');
        if (checkoutId && readyForCheckoutAppointments.length > 0) {
          const appointmentExists = readyForCheckoutAppointments.some(apt => apt.id === checkoutId);
          if (appointmentExists && !selectedAppointmentIds.has(checkoutId)) {
            setSelectedAppointmentIds(new Set([checkoutId]));
            const appointment = readyForCheckoutAppointments.find(apt => apt.id === checkoutId);
            if (appointment) {
                setSelectedClientId(appointment.clientId);
            }
            // Optional: remove the query param from URL without reloading
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('checkout_id');
            router.replace(newUrl.toString(), { scroll: false });
          }
        }
    }, [searchParams, readyForCheckoutAppointments, router, selectedAppointmentIds]);
    
    const handleAddToCart = useCallback((item: InventoryItem | Service) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (existingItem) {
                return prevCart.map(cartItem => 
                    cartItem.id === item.id 
                    ? { ...cartItem, quantity: cartItem.quantity + 1 }
                    : cartItem
                );
            }
            const price = 'price' in item ? item.price : ('msrp' in item ? item.msrp || 0 : 0);
            return [...prevCart, { ...item, quantity: 1, price, type: 'price' in item ? 'service' : 'product' }];
        });
    }, []);

    const handleScan = useCallback((data: string) => {
      if (!inventory || !appointments) {
        toast({
          variant: 'destructive',
          title: 'Data Not Ready',
          description: 'Inventory and appointments are still loading. Please try again in a moment.'
        });
        return;
      }
      let appointmentId: string | undefined;

      if (data.startsWith('clarityflow://checkout/')) {
        appointmentId = data.split('/').pop();
      } else if (data.startsWith('clarityflow://walk-in/')) {
        const walkInId = data.split('/').pop();
        if (walkInId) {
          appointmentId = `apt-walkin-${walkInId}`;
        }
      } else {
        const product = inventory.find(p => p.sku === data || p.id === data);
        if (product) {
            handleAddToCart(product);
            toast({
                title: "Product Added",
                description: `${product.name} has been added to the sale.`
            });
        } else {
            toast({ variant: 'destructive', title: 'Invalid Code', description: 'Scanned code is not a valid checkout ticket or product.' });
        }
        return;
      }
      
      if (!appointmentId) {
        toast({ variant: 'destructive', title: 'Invalid Code', description: 'Could not read ID from QR code.' });
        return;
      }

      const appointmentToCheckout = readyForCheckoutAppointments.find(apt => apt.id === appointmentId);
      if (appointmentToCheckout) {
        handleSelectAppointment(appointmentId);
        toast({ title: "Appointment Added", description: "The client's services have been added to the sale." });
      } else {
        toast({ variant: 'destructive', title: 'Appointment Not Found', description: "This appointment is not ready for checkout." });
      }
    }, [inventory, appointments, readyForCheckoutAppointments, handleAddToCart, toast, handleSelectAppointment]);

    const inServiceAppointments = useMemo(() => {
        return (appointments || []).filter(apt => apt.isWalkIn && apt.status === 'servicing');
    }, [appointments]);

    // Initialize and sort staff based on turnOrder
    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);
    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

     const enrichedOrderedStaff = useMemo(() => {
        if (!orderedStaff || !appointments || !transactions || !activityLogs) return orderedStaff;
        
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        return orderedStaff.map(member => {
            const staffAppointmentsToday = (appointments || []).filter(apt =>
                apt.staffId === member.id &&
                new Date(apt.startTime) >= todayStart &&
                new Date(apt.startTime) <= todayEnd
            );
            
            const completedAppointmentsCount = staffAppointmentsToday.filter(apt => apt.status === 'completed').length;
            
            const staffTransactionsToday = (transactions || []).filter(t => {
                if (t.staffId !== member.id) return false;
                const transactionDate = new Date(t.date);
                return transactionDate >= todayStart && transactionDate <= todayEnd;
            });

            const serviceRevenue = staffTransactionsToday
                .filter(t => t.category === 'Service Revenue')
                .reduce((acc, t) => acc + t.amount, 0);

            const retailSales = staffTransactionsToday
                .filter(t => t.category === 'Retail')
                .reduce((acc, t) => acc + t.amount, 0);

            const totalSales = serviceRevenue + retailSales;
            const tips = staffTransactionsToday.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
            const consumptionValue = 0; // Simplified for now
            
            let earnings = 0;
            if (member.payStructure === 'commission') {
                earnings = serviceRevenue * ((member.commissionRate || 0) / 100);
            } else if (member.payStructure === 'hourly' && member.hourlyRate) {
                const staffLogs = activityLogs.filter(log => {
                    if (log.staffId !== member.id) return false;
                    const logDate = new Date(log.timestamp);
                    return logDate >= todayStart && logDate <= todayEnd;
                });
                
                const sortedLogs = staffLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                let totalMinutesWorked = 0;
                let clockInTime: Date | null = null;
                let totalBreakMinutes = 0;
                
                for (const log of sortedLogs) {
                    const logTime = new Date(log.timestamp);
                    if (log.type === 'clock_in') {
                        if (clockInTime) {
                            totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                        }
                        clockInTime = logTime;
                        totalBreakMinutes = 0;
                    } else if (log.type === 'clock_out' && clockInTime) {
                        let sessionEnd = logTime;
                        if (sessionEnd > todayEnd) sessionEnd = todayEnd;
                        totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
                        clockInTime = null;
                    } else if (log.type === 'break_end' && log.durationMinutes) {
                        totalBreakMinutes += log.durationMinutes;
                    }
                }
                if(clockInTime) {
                    const endOfRange = todayEnd < new Date() ? todayEnd : new Date();
                    totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
                }
                
                const hoursWorked = totalMinutesWorked / 60;
                earnings = hoursWorked * member.hourlyRate;
            }

            const retailCommission = retailSales * ((member.retailCommissionRate || 0) / 100);
            earnings += tips + retailCommission;

            return {
                ...member,
                stats: {
                    totalSales,
                    tips,
                    consumptionValue,
                    completedServices: completedAppointmentsCount,
                    earnings,
                }
            };
        });
    }, [orderedStaff, appointments, transactions, activityLogs]);

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = parseISO(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });

        const completedWalkIns = walkInsToday.filter(w => w.status === 'completed' && w.serviceStartTime);
        const waitTimes = completedWalkIns.map(w => differenceInMinutes(parseISO(w.serviceStartTime!), parseISO(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;

        const terminalWalkIns = walkInsToday.filter(w => ['completed', 'skipped', 'cancelled'].includes(w.status));
        const conversionRate = terminalWalkIns.length > 0 ? (completedWalkIns.length / terminalWalkIns.length) * 100 : 0;

        const totalInServiceMinutes = enrichedOrderedStaff.reduce((total, staff) => {
            const staffAppointmentsToday = (appointments || []).filter(apt =>
                apt.staffId === staff.id &&
                apt.status === 'completed' &&
                new Date(apt.startTime) >= todayStart &&
                new Date(apt.startTime) <= todayEnd
            );
            return total + staffAppointmentsToday.reduce((acc, apt) => {
                 if (apt.actualStartTime && apt.actualEndTime) {
                    return acc + differenceInMinutes(parseISO(apt.actualEndTime as string), parseISO(apt.actualStartTime as string));
                 }
                 const service = services.find(s => s.id === apt.serviceId);
                 return acc + (service?.duration || 0);
            }, 0);
        }, 0);

        const totalServiceRevenue = (transactions || []).filter(t => {
            const transactionDate = new Date(t.date);
            return t.category === 'Service Revenue' && transactionDate >= todayStart && transactionDate <= todayEnd;
        }).reduce((acc, t) => acc + t.amount, 0);

        const revenuePerServiceHour = totalInServiceMinutes > 0 ? (totalServiceRevenue / (totalInServiceMinutes / 60)) : 0;

        return {
            avgWaitTime,
            walkInConversionRate: conversionRate,
            totalWalkIns: walkInsToday.length,
            revenuePerServiceHour,
        };
    }, [walkIns, enrichedOrderedStaff, appointments, transactions, services]);
    
    const { waitingQueue, notifiedQueue, inServiceQueue, readyForCheckoutQueue } = useMemo(() => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting');
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        const inService = (appointments || []).filter(apt => apt.isWalkIn && apt.status === 'servicing');
        const ready = (walkIns || []).filter(w => w.status === 'ready_for_checkout');
        return { waitingQueue: waiting, notifiedQueue: notified, inServiceQueue: inService, readyForCheckoutQueue: ready };
    }, [walkIns, appointments]);

    const [orderedWaitingQueue, setOrderedWaitingQueue] = useState<WalkIn[]>([]);
    useEffect(() => {
        const sorted = [...waitingQueue].sort((a, b) => {
            const orderA = a.queueOrder || new Date(a.checkInTime).getTime();
            const orderB = b.queueOrder || new Date(b.checkInTime).getTime();
            return orderA - orderB;
        });
        setOrderedWaitingQueue(sorted);
    }, [waitingQueue]);

    const handleReorder = (newOrder: WalkIn[]) => {
        setOrderedWaitingQueue(newOrder);
        if (!firestore || !selectedTenant) return;

        const baseOrder = Date.now();
        const batch = writeBatch(firestore);
        newOrder.forEach((walkIn, index) => {
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
            batch.update(walkInRef, { queueOrder: baseOrder + index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save reorder", err);
            toast({ variant: 'destructive', title: "Reorder Failed", description: "Could not save the new queue order."});
        });
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        setOrderedStaff(newOrder);

        if (!firestore || !selectedTenant) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((staffMember, index) => {
            const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', staffMember.id);
            batch.update(staffRef, { turnOrder: index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save staff order:", err);
            // Revert on failure
            const sorted = [...(staff || [])].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
            toast({ variant: 'destructive', title: "Error", description: "Could not save new staff order." });
        });
    };
    
    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) {
          toast({ title: "Data not loaded", description: "Please wait a moment and try again." });
          return;
        }
    
        const waitingClients = orderedWaitingQueue.filter(w => w.status === 'waiting');
        if (waitingClients.length === 0) {
          toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' });
          return;
        }
    
        if (assignmentMode === 'fair_play') {
          const idleStaff = staff.filter(s => s.active && !s.onBreak && s.status === 'idle').sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
          
          if (idleStaff.length === 0) {
            toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' });
            return;
          }
          
          for (const staffMember of idleStaff) {
            for (const client of waitingClients) {
              const allServiceIds = client.serviceIds;
              const allRequiredSkills = [...new Set(services?.filter(s => allServiceIds.includes(s.id)).flatMap(s => s.requiredSkills || []))];
              const staffSkills = staffMember.skillSet || [];
              const canPerformService = allRequiredSkills.every(skill => staffSkills.includes(skill));
        
              const existingAssignment = walkIns.find(w => w.id === client.id && w.assignedStaffId);
              if (canPerformService && !existingAssignment) {
                handleAssignStaff(client, staffMember.id);
                toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` });
                return;
              }
            }
          }
        } else { // 'ordered_list'
            for (const client of waitingClients) {
                const existingAssignment = walkIns.find(w => w.id === client.id && w.assignedStaffId);
                if (existingAssignment) continue;
        
                for (const staffMember of orderedStaff) {
                  if (!staffMember.active || staffMember.onBreak || staffMember.status !== 'idle') {
                    continue;
                  }
        
                  const allServiceIds = client.serviceIds;
                  const allRequiredSkills = [...new Set(services?.filter(s => allServiceIds.includes(s.id)).flatMap(s => s.requiredSkills || []))];
                  const staffSkills = staffMember.skillSet || [];
                  const canPerformService = allRequiredSkills.every(skill => staffSkills.includes(skill));
        
                  if (canPerformService) {
                    handleAssignStaff(client, staffMember.id);
                    toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` });
                    return;
                  }
                }
              }
        }
    
        toast({ variant: 'destructive', title: 'No Suitable Match', description: "Couldn't find an available staff member with the required skills for the next client in queue." });
      };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
        if (!firestore || !selectedTenant || !services) return;
        
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
        updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
          
        toast({ title: "Staff Assigned", description: "The client has been notified." });
    };

    const handleCancelWalkIn = (walkInId: string) => {
        if (!firestore || !selectedTenant) return;
        
        setConfirmation({
            isOpen: true,
            title: 'Are you sure?',
            description: 'This will remove the client from the queue. If they have already been assigned, their placeholder appointment on the planner will also be cancelled. This action cannot be undone.',
            onConfirm: async () => {
                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                const walkIn = walkIns?.find(w => w.id === walkInId);
                
                const batch = writeBatch(firestore);
                
                batch.update(walkInRef, { status: 'cancelled' });

                if (walkIn && walkIn.assignedStaffId) {
                    const appointmentId = `apt-walkin-${walkIn.id}`;
                    const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
                    batch.update(appointmentRef, { status: 'cancelled', cancellationReason: 'client_request' });
                }

                await batch.commit();

                toast({
                    title: "Walk-in Cancelled",
                    description: "The client has been removed from the queue."
                });
                setConfirmation(null);
            }
        });
    };
    
    const handleSkipWalkIn = async (walkInId: string) => {
        if (!firestore || !selectedTenant || !walkIns || !staff) return;

        const walkIn = walkIns.find(w => w.id === walkInId);
        if (!walkIn) return;

        setConfirmation({
            isOpen: true,
            title: 'Are you sure?',
            description: `This will mark ${walkIn.customerName} as a "skipped" no-show and remove them from the active queue. This action cannot be undone.`,
            onConfirm: async () => {
                const batch = writeBatch(firestore);

                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                batch.update(walkInRef, { status: 'skipped' });

                if (walkIn.assignedStaffId) {
                    const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
                    batch.update(staffRef, { status: 'idle' });
                }

                await batch.commit();

                toast({
                    title: "Client Skipped",
                    description: `${walkIn.customerName} has been skipped.`,
                });
                setConfirmation(null);
            }
        });
    };

    const handleReturnToQueue = async (walkInId: string) => {
        if (!firestore || !selectedTenant || !walkIns || !staff) return;
    
        const walkIn = walkIns.find(w => w.id === walkInId);
        if (!walkIn) return;
    
        setConfirmation({
            isOpen: true,
            title: `Return ${walkIn.customerName} to Queue?`,
            description: `This will move the client back to the 'Waiting' list and free up the assigned staff member.`,
            onConfirm: async () => {
                const batch = writeBatch(firestore);
    
                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                batch.update(walkInRef, { 
                    status: 'waiting',
                    assignedStaffId: deleteField(),
                    notifiedTimestamp: deleteField(),
                    queueOrder: Date.now(), // Put them at the end of the queue
                });
    
                if (walkIn.assignedStaffId) {
                    const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
                    batch.update(staffRef, { status: 'idle' });
                }
    
                await batch.commit();
    
                toast({
                    title: "Returned to Queue",
                    description: `${walkIn.customerName} is now back in the waiting list.`,
                });
                setConfirmation(null);
            }
        });
    };

    const appointmentsData = useMemo(() => {
        return Array.from(selectedAppointmentIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter((a): a is Appointment & { client: Client; service: Service; addOnServices: Service[]; staff: Staff; } => !!a);
    }, [selectedAppointmentIds, readyForCheckoutAppointments]);
    
    useEffect(() => {
        if (appointmentsData.length === 1) {
            setSelectedClientId(appointmentsData[0].clientId);
        } else if (appointmentsData.length === 0) {
            setSelectedClientId(null);
        }
    }, [appointmentsData]);
    
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package', id: string} | null>(null);

    const { subtotal, tax, total } = useMemo(() => {
        const servicesSubtotal = appointmentsData.reduce((total, data) => {
            if (!data || !data.service) return total;
            const mainServicePrice = redeemedOffer?.id === data.service?.id ? 0 : data.service?.price || 0;
            const addOnsPrice = (data.appointment.addOnIds || [])
                .map(id => services.find(s => s.id === id)?.price || 0)
                .reduce((a, b) => a + b, 0);
            return total + mainServicePrice + addOnsPrice;
        }, 0);

        const retailSubtotal = cart.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            const price = product?.msrp || 0;
            return acc + (item.quantity * price);
        }, 0);
        
        const sub = retailSubtotal + servicesSubtotal;
        const finalDiscount = discount + membershipDiscount;
        const subAfterDiscount = sub > finalDiscount ? sub - finalDiscount : 0;
        const taxAmount = subAfterDiscount * 0.07;
        const grandTotal = subAfterDiscount + taxAmount + tipAmount;
        return { subtotal: sub, tax: taxAmount, total: grandTotal };
    }, [cart, appointmentsData, tipAmount, discount, membershipDiscount, services, inventory, redeemedOffer]);

    const selectedClient = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

    const retailTotalForDiscount = useMemo(() => {
        return cart.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            return acc + (item.quantity * (product?.msrp || 0));
        }, 0);
    }, [cart, inventory]);

    useEffect(() => {
        if (selectedClient && selectedClient.activeMembershipId && memberships) {
            const membership = memberships.find(m => m.id === selectedClient.activeMembershipId);
            if (membership?.retailDiscount && retailTotalForDiscount > 0) {
                const discountValue = retailTotalForDiscount * (membership.retailDiscount / 100);
                setMembershipDiscount(discountValue);
            } else {
                setMembershipDiscount(0);
            }
        } else {
            setMembershipDiscount(0);
        }
    }, [selectedClient, retailTotalForDiscount, memberships]);

    const totalItemsInCart = useMemo(() => {
        const retailItemsCount = cart.reduce((acc, item) => acc + item.quantity, 0);
        
        const serviceItemsCount = appointmentsData.reduce((acc, aptData) => {
            let count = 0;
            if (aptData.service) count += 1;
            if (aptData.addOnServices) {
                count += aptData.addOnServices.length;
            }
            return acc + count;
        }, 0);

        return retailItemsCount + serviceItemsCount;
    }, [cart, appointmentsData]);

    const handleStartService = (walkInId: string) => {
        if (!firestore || !selectedTenant || !services || !walkIns) {
            toast({ variant: "destructive", title: "Error", description: "Data not fully loaded." });
            return;
        }
    
        const walkIn = walkIns.find(w => w.id === walkInId);
        if (!walkIn || !walkIn.assignedStaffId) {
            toast({ variant: "destructive", title: "Error", description: "Walk-in not found or not assigned." });
            return;
        }
        
        const batch = writeBatch(firestore);
    
        const appointmentId = `apt-walkin-${walkIn.id}`;
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
        
        const now = new Date();
        const nowISO = now.toISOString();

        const dataToSave = {
            status: 'servicing',
            actualStartTime: nowISO,
        };
        
        updateDocumentNonBlocking(appointmentRef, dataToSave);
    
        const staffDocRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
        batch.update(staffDocRef, { status: 'busy' });
        
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
        batch.update(walkInRef, { status: 'servicing', serviceStartTime: nowISO });
    
        batch.commit().then(() => {
            toast({
                title: "Service Started!",
                description: `The service for ${walkIn.customerName} has begun.`
            });
        }).catch(error => {
            console.error("Error starting service:", error);
            toast({
                variant: 'destructive',
                title: "Error",
                description: "Failed to start service.",
            });
        });
    };
    
    useEffect(() => {
        if (scannedData) {
            handleScan(scannedData);
            setScannedData(null); // Reset after processing
        }
    }, [scannedData, handleScan]);
    
    useEffect(() => {
        let html5QrCode: Html5Qrcode | undefined;
        if (isScannerOpen) {
          const timer = setTimeout(() => {
            const element = document.getElementById('qr-reader-pos');
            if (element) {
                html5QrCode = new Html5Qrcode('qr-reader-pos');
                const onScanSuccess = (decodedText: string) => {
                    if (html5QrCode?.isScanning) {
                        html5QrCode.stop().catch(console.error);
                    }
                    setScannedData(decodedText);
                    setIsScannerOpen(false);
                };
                const onScanFailure = () => { /* ignore */ };
                
                html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
                  .catch(err => {
                    toast({ variant: 'destructive', title: 'Camera Error', description: 'Could not start camera.' });
                    setIsScannerOpen(false);
                  });
            }
          }, 300);
          return () => {
              clearTimeout(timer);
              if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => console.error("Failed to stop QR scanner.", err));
              }
          };
        }
    }, [isScannerOpen, toast, handleScan]);
    
    const handleCartChange = (newCart: any[]) => {
        setCart(newCart);
    }
    
    const handleAddClient = (data: ClientFormData) => {
        if (!firestore || !selectedTenant) return;
    
        const newClient: Omit<Client, 'id'> = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
          lifetimeValue: 0,
          lastAppointment: new Date().toISOString(),
          status: 'active',
          notes: data.notes,
          referralCode: '', // referral code generation logic is missing here
          birthday: data.birthday ? data.birthday.toISOString() : undefined,
          address: data.address,
          emergencyContact: data.emergencyContact,
          intel: {
            referralSource: data.intel?.referralSource
          }
        };
        
        addDocumentNonBlocking(collection(firestore, 'tenants', selectedTenant.id, 'clients'), newClient);
    
        toast({
          title: "Client Added",
          description: `${data.name} has been added to your client list.`,
        });
      }

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        appointmentsData.forEach(apt => {
          if(apt.client) {
            clientIds.add(apt.client.id);
          }
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [appointmentsData, clients]);
    
    const cartServiceIds = useMemo(() => {
        const appointmentServiceIds = appointmentsData.map(a => a.serviceId);
        const cartServices = cart.filter(item => item.type === 'service').map(item => item.id);
        return [...new Set([...appointmentServiceIds, ...cartServices])];
    }, [cart, appointmentsData]);

    const checkoutHubProps = {
        cart, 
        onCartChange: handleCartChange,
        appointmentsData,
        onSelectAppointment: handleSelectAppointment,
        clients: clients || [],
        isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions,
        selectedClientId,
        setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true),
        onScanClick: () => setIsScannerOpen(true),
        subtotal,
        tax,
        total,
        tipAmount,
        setTipAmount,
        onCheckout: () => {},
        appliedDiscountCode,
        setAppliedDiscountCode,
        discount,
        membershipDiscount,
        showTitle: false,
        isSubmitting,
        paymentTab,
        setPaymentTab,
        discounts: discounts || [],
    };
    
    const handleStatusChangeWithConfirmation = () => {};

    return (
        <>
            <div className="h-full w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto gap-6 px-4 md:px-6 lg:px-8 pt-4 md:pt-6 lg:pt-8 pb-28 lg:pb-8">
                        {/* KPI Cards for Desktop */}
                        <div className="hidden md:grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                           <KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." />
                           <KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Walk-ins that resulted in a service." />
                           <KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total number of walk-in parties." />
                           <KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Revenue per hour of active service." />
                        </div>

                        {/* KPI Cards for Mobile */}
                        <div className="md:hidden">
                            <ScrollArea>
                                <div className="flex space-x-4 pb-4">
                                    <div className="w-60 shrink-0"><KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Walk-ins that resulted in a service." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total number of walk-in parties." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Revenue per hour of active service." /></div>
                                </div>
                                <ScrollBar orientation="horizontal" />
                            </ScrollArea>
                        </div>
                        
                        <TeamStatus 
                            staff={enrichedOrderedStaff} 
                            onStatusChange={handleStatusChangeWithConfirmation} 
                            appointments={appointments} 
                            services={services} 
                            onReorder={handleStaffReorder}
                            assignmentMode={assignmentMode}
                            onAssignmentModeChange={setAssignmentMode}
                        />
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} />
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">Walk-in Queue<Badge className="ml-2">{orderedWaitingQueue.length}</Badge></TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} onAddToCart={handleAddToCart} /></TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6">
                                <WalkInQueue 
                                    walkIns={walkIns} 
                                    appointments={inServiceAppointments} 
                                    services={services} 
                                    staff={staff} 
                                    onAssignStaff={handleAssignStaff}
                                    onAssignNext={handleAssignNext}
                                    onCancel={handleCancelWalkIn}
                                    onStartService={handleStartService}
                                    orderedWaitingQueue={orderedWaitingQueue}
                                    onReorder={handleReorder}
                                    assignmentMode={assignmentMode}
                                    onPrintTicket={(walkInId: string) => {
                                        const walkIn = walkIns?.find(w => w.id === walkInId);
                                        if (walkIn) {
                                            setTicketToPrint({
                                                id: walkIn.id,
                                                name: walkIn.customerName,
                                                services: (walkIn.serviceIds || []).map(id => services?.find(s => s.id === id)).filter((s): s is Service => !!s),
                                                queuePosition: orderedWaitingQueue.findIndex(w => w.id === walkInId) + 1,
                                                checkInTime: walkIn.checkInTime,
                                            });
                                            setIsPrintDialogOpen(true);
                                        }
                                    }}
                                    onSkip={handleSkipWalkIn}
                                    onReturnToQueue={handleReturnToQueue}
                                />
                            </TabsContent>
                        </Tabs>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto">
                         <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Current Sale</h2>
                        </div>
                        <CheckoutHub {...checkoutHubProps} />
                    </aside>
                </div>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                             <Button className="w-full h-14 text-lg" size="lg" disabled={totalItemsInCart === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{totalItemsInCart} item(s)</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
                           <SheetHeader className="p-4 border-b">
                               <SheetTitle>Current Sale</SheetTitle>
                           </SheetHeader>
                            <div className="p-4 flex-1 overflow-y-auto">
                                <CheckoutHub {...checkoutHubProps} />
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            )}
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={handleAddClient} />
             {confirmation && (
                <AlertDialog open={confirmation.isOpen} onOpenChange={() => setConfirmation(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{confirmation.title}</AlertDialogTitle><AlertDialogDescription>{confirmation.description}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmation.onConfirm}>Confirm</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0">
                <DialogHeader className="p-4 pb-0">
                  <DialogTitle>Scan QR Code</DialogTitle>
                  <DialogDescription>
                    Position the code inside the frame to add to sale or checkout.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-4 relative">
                  <div id="qr-reader-pos" className="w-full rounded-md bg-muted" />
                  <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                      <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
                  </div>
                </div>
                <DialogFooter className="p-4 pt-0">
                  <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
                <DialogContent className="max-w-sm print:hidden">
                    <DialogHeader>
                        <DialogTitle>Walk-in Ticket</DialogTitle>
                    </DialogHeader>
                    <div id="print-ticket-area">
                        {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>Close</Button>
                        <Button onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <div className="hidden print:block print-only">
                <div id="printable-ticket-pos">
                    {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
                </div>
            </div>
            <style jsx global>{`
                @media print {
                    body > *:not(.print-only) {
                    display: none !important;
                    }
                    .print-only, .print-only * {
                    display: block !important;
                    visibility: visible !important;
                    }
                    .print-only {
                    position: absolute;
                    left: 0;
                    top: 0;
                    }
                }
            `}</style>
        </>
    );
}

    