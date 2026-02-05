
'use client';

import React, { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { InServiceCustomerCard } from './InServiceCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Button } from '../ui/button';
import { Sparkles } from 'lucide-react';

interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    appointments: Appointment[] | null;
    onAssignStaff: (walkInId: string, staffId: string) => void;
    onAssignNext: () => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    appointments, 
    onAssignStaff,
    onAssignNext,
}) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState('waiting');
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const { waitingQueue, notifiedQueue, inServiceQueue, readyForCheckoutQueue } = useMemo(() => {
        const waiting = walkIns?.filter(w => w.status === 'waiting') || [];
        const notified = walkIns?.filter(w => w.status === 'notified') || [];
        const inService = walkIns?.filter(w => w.status === 'servicing') || [];
        const ready = walkIns?.filter(w => w.status === 'ready_for_checkout') || [];
        return { waitingQueue: waiting, notifiedQueue: notified, inServiceQueue: inService, readyForCheckoutQueue: ready };
    }, [walkIns]);

    const handleOpenAssignDialog = (walkIn: WalkIn) => {
        setWalkInToAssign(walkIn);
    };
    
    const handleAssignConfirm = (walkInId: string, staffId: string) => {
        onAssignStaff(walkInId, staffId);
        setWalkInToAssign(null);
    }

    const handleStartService = (walkIn: WalkIn) => {
        if (!firestore || !selectedTenant || !services) return;
        
        const appointmentId = `apt-walkin-${walkIn.id}`;
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);

        const serviceDetails = walkIn.serviceIds.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
        const totalDuration = serviceDetails.reduce((acc, s) => acc + s.duration, 0);

        const newAppointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date} = {
            tenantId: selectedTenant.id,
            clientId: walkIn.clientId || `walkin-${walkIn.id}`,
            clientName: walkIn.customerName,
            clientEmail: walkIn.customerEmail,
            clientPhone: walkIn.customerPhone,
            serviceId: serviceDetails[0]?.id || '', // Assuming one service for now
            addOnIds: serviceDetails.slice(1).map(s => s.id),
            staffId: walkIn.assignedStaffId,
            startTime: new Date(),
            endTime: new Date(new Date().getTime() + totalDuration * 60000),
            actualStartTime: new Date().toISOString(),
            status: 'servicing',
            source: 'walk-in',
            isWalkIn: true,
        };
        
        const newAppointment = {
            ...newAppointmentData,
            id: appointmentId,
            startTime: newAppointmentData.startTime.toISOString(),
            endTime: newAppointmentData.endTime.toISOString(),
        }

        addDocumentNonBlocking(appointmentRef, newAppointment);
        updateDocumentNonBlocking(walkInRef, { status: 'servicing', serviceStartTime: new Date().toISOString() });
        
        if (walkIn.assignedStaffId) {
            const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
            updateDocumentNonBlocking(staffRef, { status: 'busy' });
        }

        toast({ title: "Service Started", description: "The appointment has been created on the planner." });
    };

    const handleSendToCheckout = (walkIn: WalkIn) => {
        if (!firestore || !selectedTenant) return;
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', `apt-walkin-${walkIn.id}`);

        updateDocumentNonBlocking(walkInRef, { status: 'ready_for_checkout', serviceEndTime: new Date().toISOString() });
        updateDocumentNonBlocking(appointmentRef, { status: 'ready_for_checkout', actualEndTime: new Date().toISOString() });
        
        if (walkIn.assignedStaffId) {
            const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
            updateDocumentNonBlocking(staffRef, { status: 'idle' });
        }
        
        toast({ title: "Ready for Checkout", description: "The client has been sent to the order line." });
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
                    {waitingQueue.length > 0 ? waitingQueue.map(walkIn => (
                        <WaitingCustomerCard key={walkIn.id} walkIn={walkIn} services={services} onAssign={() => handleOpenAssignDialog(walkIn)} onStart={() => handleStartService(walkIn)} />
                    )) : <p className="text-center text-muted-foreground p-8">No clients are currently waiting.</p>}
                </TabsContent>
                <TabsContent value="notified" className="mt-4 space-y-4">
                    {notifiedQueue.length > 0 ? notifiedQueue.map(walkIn => (
                         <WaitingCustomerCard key={walkIn.id} walkIn={walkIn} services={services} onAssign={() => handleOpenAssignDialog(walkIn)} onStart={() => handleStartService(walkIn)} />
                    )) : <p className="text-center text-muted-foreground p-8">No clients have been notified.</p>}
                </TabsContent>
                <TabsContent value="servicing" className="mt-4 space-y-4">
                     {inServiceQueue.length > 0 ? inServiceQueue.map(walkIn => (
                        <InServiceCustomerCard key={walkIn.id} walkIn={walkIn} services={services} staff={staff} onSendToCheckout={() => handleSendToCheckout(walkIn)} />
                    )) : <p className="text-center text-muted-foreground p-8">No clients are currently in service.</p>}
                </TabsContent>
                <TabsContent value="ready_for_checkout" className="mt-4 space-y-4">
                     {readyForCheckoutQueue.length > 0 ? (
                        readyForCheckoutQueue.map(walkIn => (
                             <InServiceCustomerCard key={walkIn.id} walkIn={walkIn} services={services} staff={staff} onSendToCheckout={() => {}} />
                        ))
                    ) : (
                        <p className="text-center text-muted-foreground p-8">No clients are ready for checkout.</p>
                    )}
                </TabsContent>
            </Tabs>
            <AssignStaffDialog open={!!walkInToAssign} onOpenChange={() => setWalkInToAssign(null)} walkIn={walkInToAssign} staff={staff} onAssign={handleAssignConfirm} />
        </>
    );
};
