
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type ActivityLog, type ClientFormData } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
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
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { AssignStaffDialog } from '@/components/pos/AssignStaffDialog';


const KpiCard = ({ title, value, icon, description }: { title: string; value: string; icon: React.ReactNode, description: string; }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);


export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs } = useInventory();
    const [cart, setCart] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    // State for group checkouts
    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set<string>());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    const isMobile = useIsMobile();
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [tipAmount, setTipAmount] = useState(0);

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedData, setScannedData] = useState<string | null>(null);

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
          endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
        }));
    }, [appointmentsFromDB]);
    
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
            toast({ variant: 'destructive', title: "Error", description: "Could not save new staff order." });
            setOrderedStaff(staff || []);
        });
    };

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointments || !clients || !services || !staff) return [];
        return appointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { ...apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is Appointment & { client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [appointments, clients, services, staff]);

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        selectedAppointmentIds.forEach(aptId => {
            const apt = readyForCheckoutAppointments.find(a => a.id === aptId);
            if (apt) {
                clientIds.add(apt.clientId);
            }
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [selectedAppointmentIds, readyForCheckoutAppointments, clients]);
    
    useEffect(() => {
        const newCart: any[] = [];
        
        selectedAppointmentIds.forEach(aptId => {
            const apt = readyForCheckoutAppointments.find(a => a.id === aptId);
            if (!apt) return;
            
            const mainService = services.find(s => s.id === apt.serviceId);
            if (mainService) {
                newCart.push({
                    id: `svc-${apt.id}-${mainService.id}`,
                    appointmentId: apt.id,
                    name: mainService.name,
                    price: mainService.price,
                    quantity: 1,
                    type: 'service',
                    staffId: apt.staffId,
                });
            }

            (apt.addOnIds || []).forEach(addOnId => {
                const addOnService = services.find(s => s.id === addOnId);
                if (addOnService) {
                    newCart.push({
                        id: `svc-${apt.id}-${addOnService.id}`,
                        appointmentId: apt.id,
                        name: addOnService.name,
                        price: addOnService.price,
                        quantity: 1,
                        type: 'service',
                        staffId: apt.staffId,
                    });
                }
            });
        });

        const nonAppointmentItems = cart.filter(item => !item.appointmentId);
        setCart([...newCart, ...nonAppointmentItems]);
        
        if (payerOptions.length === 1) {
            setSelectedClientId(payerOptions[0].id);
        } else if (payerOptions.length === 0 && selectedAppointmentIds.size === 0) {
            // Keep current client if no appointments are selected
        } else {
            setSelectedClientId(null);
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAppointmentIds, readyForCheckoutAppointments, services]);


    const handleSelectAppointment = (appointmentId: string) => {
        const newSet = new Set(selectedAppointmentIds);
        if (newSet.has(appointmentId)) {
            newSet.delete(appointmentId);
        } else {
            newSet.add(appointmentId);
        }
        setSelectedAppointmentIds(newSet);
    };

    const handleAddToCart = (item: InventoryItem | Service) => {
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
    };

    const handleCartChange = (newCart: any[]) => {
        setCart(newCart);
    }
    
    const handleAddClient = (data: ClientFormData) => {
        if (!firestore || !selectedTenant) return;
    
        const newClient: Omit<Client, 'id'> = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          avatarUrl: data.avatarUrl || `https://picsum.photos/seed/${nanoid()}/100`,
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

    const handleStatusChange = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
        if (!firestore || !staff || !selectedTenant) return;
        const tenantId = selectedTenant.id;

        const staffMember = staff.find(s => s.id === staffId);
        if (!staffMember) return;
        
        const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        const now = new Date().toISOString();

        let staffUpdate: Partial<Staff> = {};
        let logEntry: Omit<ActivityLog, 'id'> = { staffId, type: action, timestamp: now };

        switch (action) {
            case 'clock_in': staffUpdate = { active: true }; break;
            case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
            case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
            case 'break_end':
                if(staffMember.breakStartTime) {
                    const duration = differenceInMinutes(new Date(now), parseISO(staffMember.breakStartTime));
                    logEntry.durationMinutes = duration;
                }
                staffUpdate = { onBreak: false, breakStartTime: undefined }; 
                break;
        }
        
        addDocumentNonBlocking(activityLogsRef, logEntry);
        updateDocumentNonBlocking(staffDocRef, staffUpdate);
    };

    const handleStatusChangeWithConfirmation = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
        const staffMember = staff?.find(s => s.id === staffId);
        if (!staffMember) return;
  
        const titles = { clock_in: 'Confirm Clock In', clock_out: 'Confirm Clock Out', break_start: 'Confirm Start Break', break_end: 'Confirm End Break' };
         const descriptions = { clock_in: `Are you sure you want to clock in ${staffMember.name}?`, clock_out: `Are you sure you want to clock out ${staffMember.name}?`, break_start: `Are you sure you want to start a break for ${staffMember.name}?`, break_end: `Are you sure you want to end the break for ${staffMember.name}?` };
        
        setConfirmation({ isOpen: true, title: titles[action], description: descriptions[action], onConfirm: () => { handleStatusChange(staffId, action); setConfirmation(null); }});
    };

    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) { toast({ title: "Data not loaded", description: "Please wait a moment and try again." }); return; }
        const idleStaff = staff.filter(s => s.active && !s.onBreak && s.status === 'idle').sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
        const waitingClients = (walkIns || []).filter(w => w.status === 'waiting').sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0));

        if (idleStaff.length === 0) { toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' }); return; }
        if (waitingClients.length === 0) { toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' }); return; }

        for (const client of waitingClients) {
            for (const staffMember of idleStaff) {
                const requiredSkills = client.requiredSkills || []; const staffSkills = staffMember.skillSet || [];
                const canPerformService = requiredSkills.every(skill => staffSkills.includes(skill));
                if (canPerformService) { 
                    handleAssignStaff(client, staffMember.id); 
                    toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` }); 
                    return; 
                }
            }
        }
        
        toast({ variant: 'destructive', title: 'No Suitable Match', description: "Couldn't find an available staff member with the required skills for the next client in queue." });
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
      if (!firestore || !selectedTenant || !services) return;
      
      const batch = writeBatch(firestore);
      const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
      
      const personServices = walkIn.serviceIds.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
      const duration = personServices.reduce((acc, s) => acc + s.duration, 0);

      const appointmentId = `apt-walkin-${walkIn.id}`;
      const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
      
      const now = new Date();

      const appointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & { id: string, startTime: string, endTime: string } = {
          id: appointmentId,
          tenantId: selectedTenant.id,
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
      batch.set(appointmentRef, appointmentData);
      
      batch.update(walkInRef, { assignedStaffId: staffId, status: 'assigned' });
      
      batch.commit().then(() => {
        toast({ title: "Staff Assigned", description: "The client has been notified and an appointment is on the planner." });
      }).catch(err => {
        console.error("Error assigning staff and creating appointments:", err);
        toast({ variant: "destructive", title: "Assignment Failed", description: "Could not create placeholder appointment."});
      });
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
    
    const { subtotal, tax, total } = useMemo(() => {
        const sub = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const taxAmount = sub * 0.07;
        const grandTotal = sub + taxAmount + tipAmount;
        return { subtotal: sub, tax: taxAmount, total: grandTotal };
    }, [cart, tipAmount]);

    const handleScan = useCallback((data: string) => {
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
                description: `${product.name} has been added to the cart.`
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
    }, [inventory, readyForCheckoutAppointments, handleAddToCart, toast]);

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
    }, [isScannerOpen, toast]);

    const checkoutHubProps = {
        cart, 
        onCartChange: handleCartChange,
        clients: clients || [],
        isGroupCheckout: selectedAppointmentIds.size > 0,
        payerOptions,
        selectedClientId,
        setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true),
        onScanClick: () => setIsScannerOpen(true),
        subtotal,
        tax,
        total,
        tipAmount,
        setTipAmount
    };

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock />} description="Today's average wait for walk-ins." />
                            <KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp />} description="Walk-ins that resulted in a service." />
                            <KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users />} description="Total number of walk-in parties." />
                            <KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign />} description="Revenue per hour of active service." />
                        </div>
                        <TeamStatus 
                            staff={enrichedOrderedStaff} 
                            onStatusChange={handleStatusChangeWithConfirmation} 
                            appointments={appointments} 
                            services={services} 
                            onReorder={handleStaffReorder}
                        />
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} />
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">Walk-in Queue<Badge className="ml-2">{walkIns?.filter(w => w.status === 'waiting').length || 0}</Badge></TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} onAddToCart={handleAddToCart} /></TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6">
                                <WalkInQueue 
                                    walkIns={walkIns} 
                                    appointments={inServiceAppointments} 
                                    services={services} 
                                    staff={staff} 
                                    onAssignStaff={(walkIn, staffId) => handleAssignStaff(walkIn, staffId)} 
                                    onAssignNext={handleAssignNext} 
                                    onCancel={handleCancelWalkIn}
                                />
                            </TabsContent>
                        </Tabs>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto">
                        <CheckoutHub {...checkoutHubProps} />
                    </aside>
                </div>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                            <Button className="w-full h-14 text-lg" size="lg" disabled={cart.length === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{cart.length} item(s)</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
                           <CheckoutHub {...checkoutHubProps} />
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
        </>
    );
}
