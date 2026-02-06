

'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type ActivityLog } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { OrderLine } from '@/components/pos/OrderLine';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


export default function POSPage() {
    const { inventory, services, appointments, clients, walkIns, staff } = useInventory();
    const [activeOrder, setActiveOrder] = useState<Appointment | null>(null);
    const [cart, setCart] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    
    // New state for ordered staff
    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);

    // Initialize and sort staff based on turnOrder
    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

    // Handle reordering of staff
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
            // Revert state on failure
            setOrderedStaff(staff || []);
        });
    };


    const posAppointments = useMemo(() => {
        if (!appointments || !clients || !services) return [];
        return appointments.map(apt => {
            const client = clients.find(c => c.id === apt.clientId);
            const service = services.find(s => s.id === apt.serviceId);
            return {
                ...apt,
                client: client,
                service: service
            };
        }).filter((a): a is Appointment & { client: Client, service: Service } => !!(a.client && a.service));
    }, [appointments, clients, services]);

    const handleSelectOrder = (order: Appointment) => {
        setActiveOrder(order);
        
        const service = services.find(s => s.id === order.serviceId);
        const addOns = (order.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean);

        const newCart = [];
        if (service) {
             newCart.push({
                id: service.id,
                name: service.name,
                price: service.price,
                quantity: 1,
                type: 'service',
            });
        }
        addOns.forEach(addon => {
            if(addon) {
                newCart.push({
                    id: addon.id,
                    name: addon.name,
                    price: addon.price,
                    quantity: 1,
                    type: 'service',
                });
            }
        });
        setCart(newCart);
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
            return [...prevCart, { ...item, quantity: 1, price }];
        });
    };

    const handleCartChange = (newCart: any[]) => {
        setCart(newCart);
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
            case 'clock_in':
                staffUpdate = { active: true };
                break;
            case 'clock_out':
                staffUpdate = { active: false, onBreak: false, status: 'idle' };
                break;
            case 'break_start':
                staffUpdate = { onBreak: true, breakStartTime: now };
                break;
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
  
        const titles = {
            clock_in: 'Confirm Clock In',
            clock_out: 'Confirm Clock Out',
            break_start: 'Confirm Start Break',
            break_end: 'Confirm End Break',
        };
         const descriptions = {
            clock_in: `Are you sure you want to clock in ${staffMember.name}?`,
            clock_out: `Are you sure you want to clock out ${staffMember.name}?`,
            break_start: `Are you sure you want to start a break for ${staffMember.name}?`,
            break_end: `Are you sure you want to end the break for ${staffMember.name}?`,
        };
        
        setConfirmation({
            isOpen: true,
            title: titles[action],
            description: descriptions[action],
            onConfirm: () => {
                handleStatusChange(staffId, action);
                setConfirmation(null);
            }
        });
    };

    const handleAssignNext = () => {
        if (!staff || !walkIns || !services) {
            toast({ title: "Data not loaded", description: "Please wait a moment and try again." });
            return;
        }

        const idleStaff = staff
            .filter(s => s.active && !s.onBreak && s.status === 'idle')
            .sort((a, b) => {
                const timeA = a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0;
                const timeB = b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0;
                return timeA - timeB; // Sorts oldest first
            });

        const waitingClients = walkIns
            .filter(w => w.status === 'waiting')
            .sort((a, b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());

        if (idleStaff.length === 0) {
            toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' });
            return;
        }

        if (waitingClients.length === 0) {
            toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' });
            return;
        }

        for (const staffMember of idleStaff) {
            for (const client of waitingClients) {
                const requiredSkills = client.requiredSkills || [];
                const staffSkills = staffMember.skillSet || [];

                const canPerformService = requiredSkills.every(skill => staffSkills.includes(skill));

                if (canPerformService) {
                    // Found a match!
                    handleAssignStaff(client.id, staffMember.id);
                    toast({ title: 'Assigned!', description: `${client.customerName} has been assigned to ${staffMember.name}.` });
                    return; // Exit after assigning
                }
            }
        }
        
        // If we get here, no suitable match was found
        toast({
            variant: 'destructive',
            title: 'No Suitable Match',
            description: "Couldn't find an available staff member with the required skills for the next client in queue.",
        });
    };

     const handleAssignStaff = (walkInId: string, staffId: string) => {
        if (!firestore || !selectedTenant) return;
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified' });
        toast({ title: "Staff Assigned", description: "The client has been notified." });
    };
    
    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6">
                        <TeamStatus 
                            staff={orderedStaff} 
                            onStatusChange={handleStatusChangeWithConfirmation} 
                            appointments={appointments}
                            onReorder={handleStaffReorder}
                        />
                        <OrderLine 
                            appointments={posAppointments}
                            onSelectOrder={handleSelectOrder}
                            selectedOrderId={activeOrder?.id}
                        />
                        
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">
                                    Walk-in Queue
                                    <Badge className="ml-2">{walkIns?.filter(w => w.status === 'waiting' || w.status === 'notified').length || 0}</Badge>
                                </TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6">
                                <RetailCatalog 
                                    services={services || []}
                                    inventory={inventory || []}
                                    onAddToCart={handleAddToCart}
                                />
                            </TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6">
                                <WalkInQueue 
                                    walkIns={walkIns}
                                    appointments={appointments}
                                    services={services}
                                    staff={staff}
                                    onAssignStaff={handleAssignStaff}
                                    onAssignNext={handleAssignNext}
                                />
                            </TabsContent>
                        </Tabs>

                    </main>
                    <aside className="border-l bg-card p-4 lg:p-6 flex flex-col h-full overflow-y-auto">
                        <CheckoutHub 
                            order={activeOrder}
                            cart={cart}
                            onCartChange={handleCartChange}
                        />
                    </aside>
                </div>
            </div>
             {confirmation && (
                <AlertDialog open={confirmation.isOpen} onOpenChange={() => setConfirmation(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmation.onConfirm}>Confirm</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </>
    )
}
