
'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type PricingTier, InventoryItem, AppointmentCheckoutState, getServicePrice, type Discount, type Membership, type Package } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, isSameDay } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, QrCode, Keyboard, Loader, TicketIcon, Play, CheckCircle, Plus, Activity, KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { Separator } from '@/components/ui/separator';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';

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
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, pricingTiers } = useInventory();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const router = useRouter();
    const isMobile = useIsMobile();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [manualTicketId, setManualTicketId] = useState('');
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [viewingAppointment, setViewingAppointment] = useState<Appointment | null>(null);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);

    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
    const [authPin, setAuthPin] = useState('');
    const [pendingStatusAction, setPendingStatusAction] = useState<{ staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' } | null>(null);

    // Turn Rotation State
    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);

    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

    const handleStaffReorder = (newOrder: Staff[]) => {
        setOrderedStaff(newOrder);
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((staffMember, index) => {
            const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffMember.id);
            batch.update(staffRef, { turnOrder: index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save staff order:", err);
            toast({ variant: 'destructive', title: "Error", description: "Could not save turn order." });
        });
    };

    const handleStatusChangeInitiate = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
        setPendingStatusAction({ staffId, action });
        setIsPinAuthOpen(true);
    };

    const handleVerifyPin = () => {
        if (!pendingStatusAction || !staff || !firestore || !tenantId) return;
        
        const targetStaff = staff.find(s => s.id === pendingStatusAction.staffId);
        
        if (targetStaff && targetStaff.pin === authPin) {
            const { staffId, action } = pendingStatusAction;
            const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
            const now = new Date().toISOString();

            let staffUpdate: Partial<Staff> = {};
            let logEntry: any = { staffId, type: action, timestamp: now };

            switch (action) {
                case 'clock_in': staffUpdate = { active: true }; break;
                case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
                case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
                case 'break_end':
                    if (targetStaff.breakStartTime) {
                        const duration = differenceInMinutes(new Date(now), new Date(targetStaff.breakStartTime));
                        logEntry.durationMinutes = duration;
                    }
                    staffUpdate = { onBreak: false, breakStartTime: undefined };
                    break;
            }
            addDocumentNonBlocking(activityLogsRef, logEntry);
            updateDocumentNonBlocking(staffDocRef, staffUpdate);
            
            setIsPinAuthOpen(false);
            setAuthPin('');
            setPendingStatusAction(null);
            toast({ title: "Authorized", description: "Status updated successfully." });
        } else {
            toast({ variant: "destructive", title: "Invalid PIN" });
        }
    };

    const enrichedOrderedStaff = useMemo(() => {
        if (!orderedStaff || !transactions) return orderedStaff;
        
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        return orderedStaff.map(member => {
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
            
            return {
                ...member,
                stats: {
                    totalSales,
                    tips,
                }
            };
        });
    }, [orderedStaff, transactions]);

    const appointments = useMemo(() => appointmentsFromInventory || [], [appointmentsFromInventory]);

    const todayAppointments = useMemo(() => {
        const today = startOfDay(new Date());
        return appointments.filter(apt => isSameDay(new Date(apt.startTime), today));
    }, [appointments]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!todayAppointments || !clients || !services || !staff) return [];
        return todayAppointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { 
                    id: apt.id,
                    appointment: apt,
                    client, 
                    service, 
                    addOnServices, 
                    staff: staffMember 
                };
            }).filter((a): a is { id: string, appointment: Appointment, client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [todayAppointments, clients, services, staff]);

    const handleSelectAppointment = useCallback((id: string) => {
        setSelectedAppointmentIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
                return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            let price = 0;
            let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            
            if ('msrp' in item) {
                price = item.msrp || item.costPerUnit || 0;
                type = 'product';
            } else if ('duration' in item) {
                price = item.price || 0;
                type = 'service';
            } else if ('interval' in item) {
                price = item.price || 0;
                type = 'membership';
            } else if ('sessions' in item) {
                price = item.price || 0;
                type = 'package';
            }

            return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
        });
    }, []);

    const handleScan = useCallback((data: string) => {
      const raw = data.trim();
      const id = raw.split('/').pop();
      if (!id) return;

      const apt = appointments.find(a => a.id === id || a.id.toUpperCase().endsWith(id.toUpperCase()));
      if (apt) {
          if (apt.status === 'ready_for_checkout') {
              handleSelectAppointment(apt.id);
              toast({ title: "Client Added", description: `${apt.clientName} added to sale.` });
          } else {
              setViewingAppointment(apt);
              setIsDetailsOpen(true);
              toast({ title: "Viewing Progress", description: `Opening progress for ${apt.clientName}.` });
          }
      } else {
          const product = inventory.find(p => p.sku === raw || p.id === id);
          if (product) {
              handleAddToCart(product);
              toast({ title: "Product Added" });
          } else toast({ variant: 'destructive', title: 'Code Not Recognized' });
      }
    }, [appointments, inventory, handleSelectAppointment, handleAddToCart, toast]);

    const handleCheckInStatusUpdate = (id: string, isWalkIn: boolean, newStatus: string, lateMinutes?: number) => {
        if (!firestore || !tenantId) return;
        
        const updateData: any = { checkInStatus: newStatus, lateTimeMinutes: lateMinutes || 0 };
        
        if (newStatus === 'auto_cancelled') {
            updateData.status = 'cancelled';
            updateData.cancellationReason = 'late';
        }

        if (isWalkIn) {
            const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', id);
            updateDocumentNonBlocking(walkInRef, updateData);
            
            const walkIn = walkIns?.find(w => w.id === id);
            if (walkIn?.assignedStaffId) {
                const aptId = `apt-walkin-${id}`;
                updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', aptId), updateData);
            }
        } else {
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
            updateDocumentNonBlocking(appointmentRef, updateData);
            
            const apt = appointments.find(a => a.id === id);
            if (apt?.checkInToken) {
                updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { ...updateData, tenantId });
            }

            if (apt?.staffId) {
                const statusLabels = {
                    on_my_way: 'is on their way',
                    arrived: 'has arrived',
                    running_late: `is running ${lateMinutes || 0} minutes late`,
                    auto_cancelled: 'appointment was cancelled due to lateness'
                };
                const label = (statusLabels as any)[newStatus] || 'updated status';
                addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/notifications`), {
                    userId: apt.staffId,
                    type: 'client_movement',
                    message: `${apt.clientName || 'Client'} ${label} (Updated by Front Desk).`,
                    link: '/planner',
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        }
        
        toast({ title: "Status Updated", description: `Client status changed to ${newStatus.replace('_', ' ')}.` });
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
        if (!firestore || !tenantId || !services) return;
        
        const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
        updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: new Date().toISOString() });
        
        const personServices = (walkIn.serviceIds || []).map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
        const duration = personServices.reduce((acc, s) => acc + s.duration, 0);
  
        const appointmentId = `apt-walkin-${walkIn.id}`;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        
        const now = new Date();
  
        const appointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & { id: string, startTime: string, endTime: string } = {
            id: appointmentId,
            tenantId: tenantId,
            clientId: walkIn.clientId || walkIn.id,
            clientName: walkIn.customerName,
            serviceId: walkIn.serviceIds[0],
            staffId: staffId,
            status: 'confirmed',
            source: 'walk-in',
            isWalkIn: true,
            startTime: now.toISOString(),
            endTime: addMinutes(now, duration).toISOString(),
        };
        setDocumentNonBlocking(appointmentRef, appointmentData, {});
          
        toast({ title: "Staff Assigned", description: "The client has been notified and an appointment is on the planner." });
    };

    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) { toast({ title: "Data not loaded" }); return; }
    
        const idleStaff = staff.filter(s => s.active && !s.onBreak && s.status === 'idle').sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
        
        if (idleStaff.length === 0) {
          toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' });
          return;
        }
        
        const waitingClients = (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => (a.queueOrder || 0) - (b.queueOrder || 0));
        
        if (waitingClients.length === 0) {
          toast({ title: 'No Clients Waiting' });
          return;
        }
    
        for (const client of waitingClients) {
            for (const staffMember of (assignmentMode === 'ordered_list' ? idleStaff.sort((a,b) => (a.turnOrder || 0) - (b.turnOrder || 0)) : idleStaff)) {
                const allRequiredSkills = [...new Set(services?.filter(s => client.serviceIds.includes(s.id)).flatMap(s => s.requiredSkills || []))];
                const canPerform = allRequiredSkills.every(skill => (staffMember.skillSet || []).includes(skill));
    
                if (canPerform) {
                    handleAssignStaff(client, staffMember.id);
                    toast({ title: 'Assigned!', description: `${client.customerName} assigned to ${staffMember.name}.` });
                    return;
                }
            }
        }
    
        toast({ variant: 'destructive', title: 'No Suitable Match', description: "No available qualified staff member found." });
    };

    const handleCancelWalkIn = (walkInId: string) => {
        if (!firestore || !tenantId) return;
        
        setConfirmation({
            isOpen: true,
            title: 'Cancel Walk-in?',
            description: 'This will remove the client from the queue. This action cannot be undone.',
            onConfirm: async () => {
                const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
                const walkIn = walkIns?.find(w => w.id === walkInId);
                
                const batch = writeBatch(firestore);
                batch.update(walkInRef, { status: 'cancelled' });

                if (walkIn && walkIn.assignedStaffId) {
                    const appointmentId = `apt-walkin-${walkIn.id}`;
                    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
                    batch.update(appointmentRef, { status: 'cancelled', cancellationReason: 'client_request' });
                }

                await batch.commit();
                toast({ title: "Walk-in Cancelled" });
                setConfirmation(null);
            }
        });
    };

    const handleStartService = (id: string) => {
        if (!firestore || !tenantId) return;
        const now = new Date().toISOString();
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), { status: 'servicing', actualStartTime: now });
        const apt = appointments?.find(a => a.id === id);
        if (apt?.checkInToken) {
            updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'servicing' });
        }
    }

    const handleReturnToQueue = (walkInId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        setConfirmation({
            isOpen: true,
            title: 'Return to Arrivals Waitlist?',
            description: `This will remove ${walkIn?.customerName}'s staff assignment and move them back to the waitlist.`,
            onConfirm: () => {
                if (!firestore || !tenantId) return;
                const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
                const appointmentId = `apt-walkin-${walkInId}`;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);

                const batch = writeBatch(firestore);
                batch.update(walkInRef, { 
                    status: 'waiting', 
                    assignedStaffId: deleteField(),
                    notifiedTimestamp: deleteField() 
                });
                batch.delete(appointmentRef);

                batch.commit().then(() => {
                    toast({ title: "Moved back to waitlist", description: "Staff assignment has been cleared." });
                });
                setConfirmation(null);
            }
        });
    };

    const handleRevertToReady = (appointmentId: string) => {
        const appointment = appointments.find(a => a.id === appointmentId);
        setConfirmation({
            isOpen: true,
            title: 'Stop Service & Revert to Ready?',
            description: `This will stop the active timer for ${appointment?.clientName} and move them back to the Ready lane.`,
            onConfirm: () => {
                if (!firestore || !tenantId) return;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
                
                const updateData: any = { 
                    status: 'confirmed', 
                    actualStartTime: deleteField() 
                };

                updateDocumentNonBlocking(appointmentRef, updateData);

                if (appointment?.checkInToken) {
                    updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'confirmed' });
                }

                if (appointment?.isWalkIn) {
                    const walkInId = appointmentId.replace('apt-walkin-', '');
                    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'notified', serviceStartTime: deleteField() });
                }

                toast({ title: "Service Reverted", description: "Appointment moved back to Ready lane." });
                setConfirmation(null);
            }
        });
    };

    const handleRevertToService = (appointmentId: string) => {
        const appointment = appointments.find(a => a.id === appointmentId);
        setConfirmation({
            isOpen: true,
            title: 'Revert to In Service?',
            description: `This will move ${appointment?.clientName} back from Checkout into the In Service lane.`,
            onConfirm: () => {
                if (!firestore || !tenantId) return;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
                
                updateDocumentNonBlocking(appointmentRef, { 
                    status: 'servicing', 
                    actualEndTime: deleteField() 
                });

                if (appointment?.checkInToken) {
                    updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing' });
                }

                if (appointment?.isWalkIn) {
                    const walkInId = appointmentId.replace('apt-walkin-', '');
                    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'servicing', serviceEndTime: deleteField() });
                }

                toast({ title: "Status Reverted", description: "Appointment moved back to In Service." });
                setConfirmation(null);
            }
        });
    };

    const handleSkip = (walkInId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        setConfirmation({
            isOpen: true,
            title: 'Skip Customer?',
            description: `This will mark ${walkIn?.customerName} as skipped (No-Show). This impacts their reliability score.`,
            onConfirm: () => {
                if (!firestore || !tenantId) return;
                const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
                updateDocumentNonBlocking(walkInRef, { status: 'skipped' });
                
                if (walkIn?.assignedStaffId) {
                    const appointmentId = `apt-walkin-${walkInId}`;
                    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
                    updateDocumentNonBlocking(appointmentRef, { status: 'cancelled', cancellationReason: 'no-show' });
                }
                
                toast({ title: "Customer Skipped", description: "Marked as no-show." });
                setConfirmation(null);
            }
        });
    };

    // Calculate totals for the current sale
    const { subtotal, discount, membershipDiscount, tax, total } = useMemo(() => {
        // 1. Service Subtotal from selected appointments
        const servicesTotal = Array.from(selectedAppointmentIds).reduce((acc, id) => {
            const data = readyForCheckoutAppointments.find(a => a.id === id);
            if (!data) return acc;
            const servicePrice = redeemedOffer?.id === data.service.id ? 0 : getServicePrice(data.service, data.staff);
            const addOnsPrice = data.addOnServices.reduce((sum, s) => sum + getServicePrice(s, data.staff), 0);
            return acc + servicePrice + addOnsPrice;
        }, 0);

        // 2. Retail Subtotal from cart items
        const retailTotal = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        
        const currentSubtotal = servicesTotal + retailTotal;

        // 3. Manual Discounts (Applied promo codes)
        let manualDiscount = 0;
        appliedDiscountCodes.forEach(code => {
            const d = discounts.find(disc => disc.code === code);
            if (d) {
                if (d.type === 'percentage') {
                    manualDiscount += currentSubtotal * (d.value / 100);
                } else {
                    manualDiscount += d.value;
                }
            }
        });

        // 4. Membership Retail Discount
        let memDiscount = 0;
        if (selectedClientId) {
            const client = clients.find(c => c.id === selectedClientId);
            const membership = client?.activeMembershipId ? memberships.find(m => m.id === client.activeMembershipId) : null;
            if (membership?.retailDiscount && retailTotal > 0) {
                memDiscount = retailTotal * (membership.retailDiscount / 100);
            }
        }

        const totalDisc = manualDiscount + memDiscount;
        const subtotalAfterDisc = Math.max(0, currentSubtotal - totalDisc);
        const taxAmount = subtotalAfterDisc * 0.07; // Static 7% tax for MVP
        const grandTotal = subtotalAfterDisc + taxAmount + tipAmount;

        return {
            subtotal: currentSubtotal,
            discount: manualDiscount,
            membershipDiscount: memDiscount,
            tax: taxAmount,
            total: grandTotal
        };
    }, [selectedAppointmentIds, readyForCheckoutAppointments, retailItems, appliedDiscountCodes, discounts, selectedClientId, clients, memberships, tipAmount, redeemedOffer]);

    const handleCheckout = async (paymentDetails: { paymentMethod: string; amountTendered?: number }) => {
        if (!firestore || !tenantId) return;
        if (!selectedClientId && Array.from(selectedAppointmentIds).length > 0) {
            toast({ variant: 'destructive', title: 'Payer Required' });
            return;
        }

        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date();
        const nowISO = now.toISOString();

        const productStates = new Map<string, any>();
        const getProductState = (id: string) => {
            if (productStates.has(id)) return productStates.get(id);
            const p = inventory.find(i => i.id === id);
            if (!p) return null;
            const state = { ...p, batches: JSON.parse(JSON.stringify(p.batches)) };
            productStates.set(id, state);
            return state;
        };

        try {
            for (const id of Array.from(selectedAppointmentIds)) {
                const data = readyForCheckoutAppointments.find(a => a.id === id);
                if (!data) continue;

                const { appointment, service, staff: provider, client: aptClient } = data;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
                const shortTicketId = appointment.id.slice(-6).toUpperCase();
                
                if (appointment.checkoutState?.formula) {
                    for (const formulaItem of appointment.checkoutState.formula) {
                        const pState = getProductState(formulaItem.id);
                        if (!pState) continue;

                        const qty = formulaItem.quantity;
                        if (pState.costingMethod === 'uses') {
                            const usesPerContainer = pState.estimatedUses || 1;
                            let currentUses = (pState.partialContainerUses || 0) - qty;
                            while (currentUses < 0 && pState.totalStock > 0) {
                                const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                                for (const b of sorted) { if (b.stock > 0) { b.stock -= 1; break; } }
                                pState.totalStock -= 1;
                                currentUses += usesPerContainer;
                            }
                            pState.partialContainerUses = currentUses;
                        } else if (pState.costingMethod === 'size') {
                            const sizePerContainer = pState.size || 1;
                            let currentSize = (pState.partialContainerSize || 0) - qty;
                            while (currentSize < 0 && pState.totalStock > 0) {
                                const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                                for (const b of sorted) { if (b.stock > 0) { b.stock -= 1; break; } }
                                pState.totalStock -= 1;
                                currentSize += sizePerContainer;
                            }
                            pState.partialContainerSize = currentSize;
                        } else {
                            pState.totalStock -= qty;
                        }

                        const scRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
                        batch.set(scRef, {
                            productId: pState.id,
                            date: nowISO,
                            change: -qty,
                            unit: pState.costingMethod === 'uses' ? (pState.useUnit || 'uses') : (pState.unit || 'units'),
                            reason: `Service: ${service.name} (#${shortTicketId}) for ${aptClient.name} by ${provider.name}`
                        });
                    }
                }

                batch.update(appointmentRef, { 
                    status: 'completed',
                    revenue: getServicePrice(service, provider),
                    discountAmount: (discount + membershipDiscount) / (selectedAppointmentIds.size || 1),
                    appliedDiscountCode: appliedDiscountCodes.join(', ')
                });

                if (appointment.checkInToken) {
                    batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'completed' });
                }

                const staffRef = doc(firestore, 'tenants', tenantId, 'staff', provider.id);
                batch.update(staffRef, { status: 'idle', lastServedTimestamp: nowISO });

                const servicePrice = redeemedOffer?.id === service.id ? 0 : getServicePrice(service, provider);
                const serviceTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(serviceTxnRef, {
                    date: nowISO,
                    description: `Service: ${service.name}`,
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Service Revenue',
                    amount: servicePrice,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                    staffId: provider.id,
                    appointmentId: appointment.id,
                });

                data.addOnServices.forEach(addon => {
                    const addonPrice = getServicePrice(addon, provider);
                    const addonTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                    batch.set(addonTxnRef, {
                        date: nowISO,
                        description: `Add-on: ${addon.name}`,
                        clientOrVendor: selectedClient?.name || 'Walk-in',
                        clientId: selectedClientId,
                        type: 'income',
                        context: 'Business',
                        category: 'Service Revenue',
                        amount: addonPrice,
                        paymentMethod: paymentDetails.paymentMethod,
                        hasReceipt: true,
                        staffId: provider.id,
                        appointmentId: appointment.id,
                    });
                });
            }

            for (const item of retailItems) {
                const pState = getProductState(item.id);
                if (pState && item.type === 'product') {
                    const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                    let remaining = item.quantity;
                    for (const b of sorted) {
                        if (remaining <= 0) break;
                        const d = Math.min(b.stock, remaining);
                        b.stock -= d;
                        remaining -= d;
                    }
                    pState.totalStock = sorted.reduce((acc: number, b: any) => acc + b.stock, 0);
                    pState.batches = sorted;

                    const scRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
                    batch.set(scRef, {
                        productId: pState.id,
                        date: nowISO,
                        change: -item.quantity,
                        unit: 'units',
                        reason: `Retail Sale: ${item.name} to ${selectedClient?.name || 'Walk-in'}`
                    });
                }
                
                const retailTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(retailTxnRef, {
                    date: nowISO,
                    description: `Retail: ${item.quantity}x ${item.name}`,
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Retail',
                    amount: item.price * item.quantity,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                });
            }

            productStates.forEach((state, id) => {
                const productRef = doc(firestore, 'tenants', tenantId, 'inventory', id);
                batch.update(productRef, {
                    totalStock: state.totalStock,
                    batches: state.batches,
                    partialContainerUses: state.partialContainerUses ?? 0,
                    partialContainerSize: state.partialContainerSize ?? 0
                });
            });

            if (tipAmount > 0) {
                const tipTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(tipTxnRef, {
                    date: nowISO,
                    description: 'Gratuity',
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Tips',
                    amount: tipAmount,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                    staffId: readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.staff?.id,
                });
            }

            appliedDiscountCodes.forEach(code => {
                const d = discounts.find(disc => disc.code === code);
                if (d) {
                    batch.update(doc(firestore, 'tenants', tenantId, 'discounts', d.id), { usageCount: increment(1) });
                }
            });

            await batch.commit();
            
            setReceiptToPrint({
                business: { name: selectedTenant?.name || 'ClarityFlow', phone: selectedTenant?.twilioPhoneNumber || '' },
                clientName: selectedClient?.name || 'Walk-in Customer',
                date: now,
                items: [
                    ...readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).flatMap(a => [
                        { name: a.service.name, quantity: 1, price: redeemedOffer?.id === a.service.id ? 0 : getServicePrice(a.service, a.staff) },
                        ...a.addOnServices.map(addon => ({ name: addon.name, quantity: 1, price: getServicePrice(addon, a.staff) }))
                    ]),
                    ...retailItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.price }))
                ],
                subtotal,
                discount: discount + membershipDiscount,
                tax,
                tip: tipAmount,
                total,
                payment: {
                    method: paymentDetails.paymentMethod,
                    amountTendered: paymentDetails.amountTendered || total,
                    changeDue: (paymentDetails.amountTendered || total) - total
                }
            });
            setIsReceiptDialogOpen(true);
            
            setRetailItems([]);
            setSelectedAppointmentIds(new Set());
            setSelectedClientId(null);
            setTipAmount(0);
            setAppliedDiscountCodes([]);
            setRedeemedOffer(null);
            toast({ title: 'Sale Complete!' });

        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFinishService = (apt: Appointment) => {
        setAppointmentToReview(apt);
        setIsTechnicianReviewOpen(true);
    };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        updateDocumentNonBlocking(appointmentRef, {
            status: 'ready_for_checkout',
            checkoutState,
            actualEndTime: new Date().toISOString(),
        });
        const appointment = appointments?.find(a => a.id === appointmentId);
        if (appointment?.checkInToken) {
            updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'ready_for_checkout' });
        }
        setIsTechnicianReviewOpen(false);
        setIsDetailsOpen(false);
        toast({ title: "Service Finished", description: "Client sent to checkout queue." });
    };

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        selectedAppointmentIds.forEach(aptId => {
          const aptData = readyForCheckoutAppointments.find(a => a.id === aptId);
          if (aptData) clientIds.add(aptData.appointment.clientId);
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [selectedAppointmentIds, readyForCheckoutAppointments, clients]);

    const checkoutHubProps = {
        cart: retailItems, 
        onCartChange: setRetailItems,
        appointmentsData: Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any,
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
        onCheckout: handleCheckout,
        appliedDiscountCodes,
        setAppliedDiscountCodes,
        discount,
        membershipDiscount,
        isSubmitting,
        paymentTab,
        setPaymentTab,
        discounts: discounts || [],
        amountTendered,
        setAmountTendered,
        adjustments: [],
        appliedAdjustments: new Set<string>(),
        onApplyAdjustmentToggle: () => {},
        absorbedCost: 0,
        redeemedOffer,
        setRedeemedOffer,
        memberships: memberships || [],
        packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false,
        showTitle: false,
    };

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-8 pb-24 lg:pb-8">
                        <TeamStatus 
                            staff={enrichedOrderedStaff} 
                            onStatusChange={handleStatusChangeInitiate} 
                            appointments={todayAppointments} 
                            services={services} 
                            onReorder={handleStaffReorder}
                            assignmentMode={assignmentMode}
                            onAssignmentModeChange={setAssignmentMode}
                        />

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                                    <Activity className="w-6 h-6 text-primary" />
                                    Studio Pulse
                                </h2>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="bg-background">{walkIns?.filter(w => w.status === 'waiting').length} Waiting</Badge>
                                    <Badge variant="outline" className="bg-background">{todayAppointments.filter(a => a.status === 'servicing').length} In Service</Badge>
                                    <Badge variant="outline" className="bg-background">{readyForCheckoutAppointments.length} Checkout</Badge>
                                </div>
                            </div>
                            
                            <Card className="border-2 shadow-sm bg-background/50 backdrop-blur-sm overflow-hidden">
                                <CardContent className="p-0">
                                    <WalkInQueue 
                                        walkIns={walkIns} 
                                        appointments={todayAppointments} 
                                        readyForCheckoutAppointments={readyForCheckoutAppointments}
                                        selectedAppointmentIds={selectedAppointmentIds}
                                        onSelectAppointment={handleSelectAppointment}
                                        services={services} 
                                        staff={staff} 
                                        onAssignStaff={handleAssignStaff}
                                        onAssignNext={handleAssignNext}
                                        onCancel={handleCancelWalkIn}
                                        onStartService={handleStartService}
                                        orderedWaitingQueue={[]}
                                        onReorder={() => {}}
                                        assignmentMode={assignmentMode}
                                        onPrintTicket={() => {}}
                                        onSkip={handleSkip}
                                        onReturnToQueue={handleReturnToQueue}
                                        groupSizes={new Map()}
                                        onToggleWaitForStaff={() => {}}
                                        onScanClick={() => setIsScannerOpen(true)}
                                        onFinishService={handleFinishService}
                                        onUpdateStatus={handleCheckInStatusUpdate}
                                        onRevertToReady={handleRevertToReady}
                                        onRevertToService={handleRevertToService}
                                    />
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                                <ShoppingCart className="w-6 h-6 text-primary" />
                                Menu & Products
                            </h2>
                            <RetailCatalog 
                                services={services || []} 
                                inventory={inventory || []} 
                                memberships={memberships || []} 
                                packages={packages || []} 
                                onAddToCart={handleAddToCart} 
                                onScanClick={() => setIsScannerOpen(true)}
                            />
                        </div>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">Current Sale</h2>
                        <CheckoutHub {...checkoutHubProps} />
                    </aside>
                </div>
            </div>

            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                            <Button className="w-full h-14 text-lg" size="lg" disabled={retailItems.length === 0 && selectedAppointmentIds.size === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{retailItems.length + selectedAppointmentIds.size} item(s)</span>
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

            <AppointmentDetailsSheet 
                open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={viewingAppointment}
                client={clients?.find(c => c.id === viewingAppointment?.clientId) || null}
                service={services?.find(s => s.id === viewingAppointment?.serviceId) || null}
                tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []}
                onStartService={handleStartService} 
                onFinishService={handleFinishService} 
                onEdit={() => {}} onDelete={() => {}} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}}
                onCancel={(id) => handleCheckInStatusUpdate(id, false, 'auto_cancelled')}
                resources={[]}
                onOverride={() => {}}
            />

            {appointmentToReview && (
                <TechnicianReviewDialog 
                    open={isTechnicianReviewOpen}
                    onOpenChange={setIsTechnicianReviewOpen}
                    appointmentData={{
                        appointment: appointmentToReview,
                        client: clients?.find(c => c.id === appointmentToReview.clientId),
                        service: services?.find(s => s.id === appointmentToReview.serviceId)
                    }}
                    staff={staff || []}
                    onSendToFrontDesk={handleSendToFrontDesk}
                />
            )}

            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 pb-0"><DialogTitle>Scan Ticket or SKU</DialogTitle><DialogDescription>Scanning is automatic. Position the code inside the frame.</DialogDescription></DialogHeader>
                <div className="p-4 space-y-4"><div className="relative overflow-hidden rounded-xl border-2 border-muted bg-muted/50 aspect-square"><div id="qr-reader-pos" className="w-full h-full" /><div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div>
                  <Separator /><form onSubmit={(e) => { e.preventDefault(); if (manualTicketId.trim()) { handleScan(`clarityflow://checkout/${manualTicketId.trim()}`); setManualTicketId(''); } }} className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-widest"><Keyboard className="w-4 h-4" /><span>Manual Entry</span></div><div className="flex gap-2"><Input placeholder="Enter Ticket or Product ID..." value={manualTicketId} onChange={(e) => setManualTicketId(e.target.value)} className="h-11 font-mono uppercase" /><Button type="submit" disabled={!manualTicketId.trim()}>Pull Up</Button></div></form>
                </div>
                <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Close Scanner</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={(d) => { if (!firestore || !selectedTenant) return; const newClient = { ...d, id: nanoid(), lifetimeValue: 0, lastAppointment: new Date().toISOString(), status: 'active' as const }; setDocumentNonBlocking(doc(firestore, 'tenants', selectedTenant.id, 'clients', newClient.id), newClient, {}); toast({ title: "Client Added" }); }} />
            
            {receiptToPrint && (
                <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
                    <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
                        <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
                        <PrintReceipt data={receiptToPrint} />
                        <DialogFooter><Button onClick={() => window.print()}>Print</Button></DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {confirmation && (
                <AlertDialog open={confirmation.isOpen} onOpenChange={() => setConfirmation(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmation.onConfirm}>Confirm Action</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <KeyRound className="w-5 h-5 text-primary" />
                            Authorize Status Change
                        </DialogTitle>
                        <DialogDescription>Enter your unique 4-digit PIN to confirm.</DialogDescription>
                    </DialogHeader>
                    <div className="py-6 flex flex-col items-center space-y-4">
                        <Label className="text-sm font-black uppercase tracking-widest text-muted-foreground">Verification PIN</Label>
                        <div className="relative w-48">
                            <Input 
                                type="password" 
                                maxLength={4} 
                                className="text-center text-3xl font-black h-16 tracking-[0.5em] bg-muted/50 border-2" 
                                value={authPin} 
                                onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPinAuthOpen(false)}>Cancel</Button>
                        <Button onClick={handleVerifyPin} disabled={authPin.length < 4}>Verify & Confirm</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
