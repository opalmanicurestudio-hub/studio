

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
import { differenceInMinutes, parseISO, startOfDay, endOfDay } from 'date-fns';
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
import { ShoppingCart } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';


export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs } = useInventory();
    const [cart, setCart] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore, selectedTenant } = useFirebase();
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
            const price = 'msrp' in item ? (item.msrp || item.costPerUnit || 0) : item.price;
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
        const waitingClients = walkIns.filter(w => w.status === 'waiting').sort((a, b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());

        if (idleStaff.length === 0) { toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' }); return; }
        if (waitingClients.length === 0) { toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' }); return; }

        for (const staffMember of idleStaff) {
            for (const client of waitingClients) {
                const requiredSkills = client.requiredSkills || []; const staffSkills = staffMember.skillSet || [];
                const canPerformService = requiredSkills.every(skill => staffSkills.includes(skill));
                if (canPerformService) { handleAssignStaff(client.id, staffMember.id); toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` }); return; }
            }
        }
        
        toast({ variant: 'destructive', title: 'No Suitable Match', description: "Couldn't find an available staff member with the required skills for the next client in queue." });
    };

     const handleAssignStaff = (walkInId: string, staffId: string) => {
        if (!firestore || !selectedTenant) return;
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified' });
        toast({ title: "Staff Assigned", description: "The client has been notified." });
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
    }, [inventory, readyForCheckoutAppointments, handleSelectAppointment, toast]);

    useEffect(() => {
        if (scannedData) {
            handleScan(scannedData);
            setScannedData(null);
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
                        <TeamStatus 
                            staff={enrichedOrderedStaff} 
                            onStatusChange={handleStatusChangeWithConfirmation} 
                            appointments={appointments} 
                            onReorder={handleStaffReorder}
                            services={services || []}
                        />
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} />
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">Walk-in Queue<Badge className="ml-2">{walkIns?.filter(w => w.status === 'waiting' || w.status === 'notified').length || 0}</Badge></TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} onAddToCart={handleAddToCart} /></TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6"><WalkInQueue walkIns={walkIns} appointments={appointments} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} /></TabsContent>
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
    )
}
