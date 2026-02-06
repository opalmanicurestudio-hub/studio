
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { InServiceAppointmentCard } from './InServiceCustomerCard'; // Updated import
import { type WalkIn, type Staff, type Service, type Appointment } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    appointments: Appointment[] | null;
    onAssignStaff: (walkIn: WalkIn, staffId: string) => void;
    onAssignNext: () => void;
    onCancel: (walkInId: string) => void;
    onStartService: (appointmentId: string) => void;
    orderedWaitingQueue: WalkIn[];
    onReorder: (newOrder: WalkIn[]) => void;
    assignmentMode: 'fair_play' | 'ordered_list';
    onPrintTicket: (walkInId: string) => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    appointments, 
    onAssignStaff,
    onAssignNext,
    onCancel,
    onStartService,
    orderedWaitingQueue,
    onReorder,
    assignmentMode,
    onPrintTicket,
}) => {
    const [activeTab, setActiveTab] = useState('waiting');
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const { notifiedQueue, inServiceQueue, readyForCheckoutQueue } = useMemo(() => {
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        const inService = (appointments || []).filter(apt => apt.isWalkIn && apt.status === 'servicing');
        const ready = (walkIns || []).filter(w => w.status === 'ready_for_checkout');
        return { notifiedQueue: notified, inServiceQueue: inService, readyForCheckoutQueue: ready };
    }, [walkIns, appointments]);

    const groupSizes = useMemo(() => {
        const sizes = new Map<string, number>();
        (walkIns || []).forEach(w => {
            if (w.groupId) {
                sizes.set(w.groupId, (sizes.get(w.groupId) || 0) + 1);
            }
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

    const handleMoveToFront = (walkInId: string) => {
        const item = orderedWaitingQueue.find(w => w.id === walkInId);
        if (!item) return;
        const newOrder = [item, ...orderedWaitingQueue.filter(w => w.id !== walkInId)];
        onReorder(newOrder);
    };

    const handleSendToCheckout = (appointment: Appointment) => {
        // This logic now lives in the parent POSPage component
    };

    return (
        <>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="waiting">Waiting <Badge className="ml-2">{orderedWaitingQueue.length}</Badge></TabsTrigger>
                    <TabsTrigger value="servicing">In Service <Badge className="ml-2">{inServiceQueue.length}</Badge></TabsTrigger>
                </TabsList>
                <TabsContent value="waiting" className="mt-4 space-y-4">
                    <div className="flex justify-end items-center gap-4">
                        <Button onClick={onAssignNext} className="w-full sm:w-auto">
                            <Sparkles className="mr-2 h-4 w-4" />
                            Assign Next
                        </Button>
                    </div>
                     {orderedWaitingQueue.length > 0 ? (
                        <ScrollArea>
                            <Reorder.Group axis="x" values={orderedWaitingQueue} onReorder={onReorder} className="flex space-x-4 pb-4">
                                {orderedWaitingQueue.map(walkIn => (
                                    <Reorder.Item key={walkIn.id} value={walkIn} className="w-72 shrink-0">
                                        <WaitingCustomerCard 
                                            walkIn={walkIn} 
                                            services={services} 
                                            staffList={staff}
                                            onAssign={() => handleOpenAssignDialog(walkIn)} 
                                            onCancel={onCancel}
                                            onMoveToFront={handleMoveToFront}
                                            onPrintTicket={onPrintTicket}
                                            groupSize={groupSizes.get(walkIn.groupId) || 1}
                                        />
                                    </Reorder.Item>
                                ))}
                            </Reorder.Group>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    ) : <p className="text-center text-muted-foreground p-8">No clients are currently waiting.</p>}
                </TabsContent>
                <TabsContent value="servicing" className="mt-4 space-y-4">
                     {inServiceQueue.length > 0 ? (
                        <ScrollArea>
                            <div className="flex space-x-4 pb-4">
                                {inServiceQueue.map(appointment => (
                                    <div key={appointment.id} className="w-72 shrink-0">
                                        <InServiceAppointmentCard appointment={appointment} services={services} staff={staff} onSendToCheckout={() => {}} />
                                    </div>
                                ))}
                            </div>
                             <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                     ) : <p className="text-center text-muted-foreground p-8">No clients are currently in service.</p>}
                </TabsContent>
            </Tabs>
            <AssignStaffDialog open={!!walkInToAssign} onOpenChange={() => setWalkInToAssign(null)} walkIn={walkInToAssign} staff={staff} onAssign={handleAssignConfirm} />
        </>
    );
};
