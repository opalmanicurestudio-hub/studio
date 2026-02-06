

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { InServiceAppointmentCard } from './InServiceCustomerCard'; // Updated import
import { type WalkIn, type Staff, type Service, type Appointment } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Button } from '../ui/button';
import { Sparkles } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';


interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    appointments: Appointment[] | null;
    onAssignStaff: (walkIn: WalkIn, staffId: string) => void;
    onAssignNext: () => void;
    onCancel: (walkInId: string) => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    appointments, 
    onAssignStaff,
    onAssignNext,
    onCancel,
}) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState('waiting');
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const { waitingQueue, notifiedQueue, inServiceQueue, readyForCheckoutQueue } = useMemo(() => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting');
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        const inService = (appointments || []).filter(apt => apt.isWalkIn && apt.status === 'servicing'); // Updated logic
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

    const groupSizes = useMemo(() => {
        const sizes = new Map<string, number>();
        (walkIns || []).forEach(w => {
            sizes.set(w.groupId, (sizes.get(w.groupId) || 0) + 1);
        });
        return sizes;
    }, [walkIns]);


    const handleOpenAssignDialog = (walkIn: WalkIn) => {
        setWalkInToAssign(walkIn);
    };
    
    const handleAssignConfirm = (walkInId: string, staffId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn && staffId) {
            onAssignStaff(walkIn, staffId);
        }
        setWalkInToAssign(null);
    }
    
    const handleSendToCheckout = (appointment: Appointment) => {
        if (!firestore || !selectedTenant) return;
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointment.id);
        updateDocumentNonBlocking(appointmentRef, { status: 'ready_for_checkout', actualEndTime: new Date().toISOString() });
        
        if (appointment.isWalkIn) {
            const walkInId = appointment.id.replace(/^apt-walkin-(.+?)(?:-.+)?$/, '$1');
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
            updateDocumentNonBlocking(walkInRef, { status: 'ready_for_checkout', serviceEndTime: new Date().toISOString() });
        }
        
        if (appointment.staffId) {
            const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', appointment.staffId);
            updateDocumentNonBlocking(staffRef, { status: 'idle' });
        }
        
        toast({ title: "Ready for Checkout", description: "The client has been sent to the order line." });
    };
    
    const handleReorder = (newOrder: WalkIn[]) => {
        setOrderedWaitingQueue(newOrder);
        if (!firestore || !selectedTenant) return;

        const baseOrder = Date.now();
        newOrder.forEach((walkIn, index) => {
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
            updateDocumentNonBlocking(walkInRef, { queueOrder: baseOrder + index });
        });
    };

    return (
        <>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="waiting">Waiting <Badge className="ml-2">{waitingQueue.length}</Badge></TabsTrigger>
                    <TabsTrigger value="notified">Notified <Badge className="ml-2">{notifiedQueue.length}</Badge></TabsTrigger>
                    <TabsTrigger value="servicing">In Service <Badge className="ml-2">{inServiceQueue.length}</Badge></TabsTrigger>
                    <TabsTrigger value="ready_for_checkout">Checkout <Badge className="ml-2">{readyForCheckoutQueue.length}</Badge></TabsTrigger>
                </TabsList>
                <TabsContent value="waiting" className="mt-4 space-y-4">
                    <div className="flex justify-end">
                        <Button onClick={onAssignNext}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Assign Next (Fair Play)
                        </Button>
                    </div>
                     {orderedWaitingQueue.length > 0 ? (
                        <ScrollArea>
                            <Reorder.Group axis="x" values={orderedWaitingQueue} onReorder={handleReorder} className="flex space-x-4 pb-4">
                                {orderedWaitingQueue.map(walkIn => (
                                    <Reorder.Item key={walkIn.id} value={walkIn} className="w-72 shrink-0">
                                        <WaitingCustomerCard 
                                            walkIn={walkIn} 
                                            services={services} 
                                            staffList={staff}
                                            onAssign={() => handleOpenAssignDialog(walkIn)} 
                                            onCancel={onCancel}
                                            groupSize={groupSizes.get(walkIn.groupId) || 1}
                                        />
                                    </Reorder.Item>
                                ))}
                            </Reorder.Group>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    ) : <p className="text-center text-muted-foreground p-8">No clients are currently waiting.</p>}
                </TabsContent>
                <TabsContent value="notified" className="mt-4 space-y-4">
                    {notifiedQueue.length > 0 ? (
                        <ScrollArea>
                            <div className="flex space-x-4 pb-4">
                                {notifiedQueue.map(walkIn => (
                                    <div key={walkIn.id} className="w-72 shrink-0">
                                        <WaitingCustomerCard 
                                            walkIn={walkIn} 
                                            services={services}
                                            staffList={staff}
                                            onAssign={() => handleOpenAssignDialog(walkIn)} 
                                            onCancel={onCancel}
                                            groupSize={groupSizes.get(walkIn.groupId) || 1}
                                        />
                                    </div>
                                ))}
                            </div>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    ) : <p className="text-center text-muted-foreground p-8">No clients have been notified.</p>}
                </TabsContent>
                <TabsContent value="servicing" className="mt-4 space-y-4">
                     {inServiceQueue.length > 0 ? (
                        <ScrollArea>
                            <div className="flex space-x-4 pb-4">
                                {inServiceQueue.map(appointment => (
                                    <div key={appointment.id} className="w-72 shrink-0">
                                        <InServiceAppointmentCard appointment={appointment} services={services} staff={staff} onSendToCheckout={() => handleSendToCheckout(appointment)} />
                                    </div>
                                ))}
                            </div>
                             <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                     ) : <p className="text-center text-muted-foreground p-8">No clients are currently in service.</p>}
                </TabsContent>
                <TabsContent value="ready_for_checkout" className="mt-4 space-y-4">
                     {/* This tab's content is now managed by CheckoutQueue component */}
                     <p className="text-center text-muted-foreground p-8">Clients ready for checkout are now shown in the queue above.</p>
                </TabsContent>
            </Tabs>
            <AssignStaffDialog open={!!walkInToAssign} onOpenChange={() => setWalkInToAssign(null)} walkIn={walkInToAssign} staff={staff} onAssign={handleAssignConfirm} />
        </>
    );
};
