

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


interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    appointments: Appointment[] | null;
    onAssignStaff: (walkInId: string, assignments: Record<string, string>) => void;
    onAssignNext: () => void;
    onStartService: (walkInId: string, personId: string) => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    appointments, 
    onAssignStaff,
    onAssignNext,
    onStartService,
}) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState('waiting');
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const { waitingQueue, notifiedQueue, inServiceQueue, readyForCheckoutQueue } = useMemo(() => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting');
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        const inService = (appointments || []).filter(apt => apt.status === 'servicing'); // Updated logic
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


    const handleOpenAssignDialog = (walkIn: WalkIn) => {
        setWalkInToAssign(walkIn);
    };
    
    const handleAssignConfirm = (walkInId: string, assignments: Record<string, string>) => {
        onAssignStaff(walkInId, assignments);
        setWalkInToAssign(null);
    }
    
    const handleSendToCheckout = (appointment: Appointment) => {
        if (!firestore || !selectedTenant) return;
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointment.id);
        updateDocumentNonBlocking(appointmentRef, { status: 'ready_for_checkout', actualEndTime: new Date().toISOString() });
        
        if (appointment.isWalkIn) {
            const walkInId = appointment.id.replace('apt-walkin-', '');
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
                        <Reorder.Group axis="y" values={orderedWaitingQueue} onReorder={handleReorder} className="space-y-4">
                            {orderedWaitingQueue.map(walkIn => (
                                <Reorder.Item key={walkIn.id} value={walkIn}>
                                    <WaitingCustomerCard 
                                        walkIn={walkIn} 
                                        services={services} 
                                        staffList={staff}
                                        onAssign={() => handleOpenAssignDialog(walkIn)} 
                                        onStartService={onStartService} 
                                    />
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    ) : <p className="text-center text-muted-foreground p-8">No clients are currently waiting.</p>}
                </TabsContent>
                <TabsContent value="notified" className="mt-4 space-y-4">
                    {notifiedQueue.length > 0 ? notifiedQueue.map(walkIn => (
                         <WaitingCustomerCard 
                            key={walkIn.id} 
                            walkIn={walkIn} 
                            services={services}
                            staffList={staff}
                            onAssign={() => handleOpenAssignDialog(walkIn)} 
                            onStartService={onStartService} 
                        />
                    )) : <p className="text-center text-muted-foreground p-8">No clients have been notified.</p>}
                </TabsContent>
                <TabsContent value="servicing" className="mt-4 space-y-4">
                     {inServiceQueue.length > 0 ? inServiceQueue.map(appointment => (
                        <InServiceAppointmentCard key={appointment.id} appointment={appointment} services={services} staff={staff} onSendToCheckout={() => handleSendToCheckout(appointment)} />
                    )) : <p className="text-center text-muted-foreground p-8">No clients are currently in service.</p>}
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
