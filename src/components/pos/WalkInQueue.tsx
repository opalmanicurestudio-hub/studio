
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';

interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    onAssignStaff: (walkIn: WalkIn, staffId: string) => void;
    onAssignNext: () => void;
    onCancel: (walkInId: string) => void;
    onStartService: (appointmentId: string) => void;
    orderedWaitingQueue: WalkIn[];
    onReorder: (newOrder: WalkIn[]) => void;
    assignmentMode: 'fair_play' | 'ordered_list';
    onPrintTicket: (walkInId: string) => void;
    onSkip: (walkInId: string) => void;
    onReturnToQueue: (walkInId: string) => void;
    groupSizes: Map<string, number>;
    onToggleWaitForStaff: (walkInId: string, wait: boolean) => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    onAssignStaff,
    onAssignNext,
    onCancel,
    onStartService,
    orderedWaitingQueue,
    onReorder,
    assignmentMode,
    onPrintTicket,
    onSkip,
    onReturnToQueue,
    groupSizes,
    onToggleWaitForStaff,
}) => {
    const [activeTab, setActiveTab] = useState('waiting');
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const notifiedQueue = useMemo(() => {
        return (walkIns || []).filter(w => w.status === 'notified');
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

    return (
        <>
            <div className="flex justify-end items-center gap-4 mb-4">
                <Button onClick={onAssignNext} className="w-full sm:w-auto">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Assign Next
                </Button>
            </div>
            <Tabs defaultValue="waiting" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="waiting">Waiting <Badge className="ml-2">{orderedWaitingQueue.length}</Badge></TabsTrigger>
                    <TabsTrigger value="notified">Notified <Badge className="ml-2">{notifiedQueue.length}</Badge></TabsTrigger>
                </TabsList>
                <TabsContent value="waiting" className="mt-4">
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
                <TabsContent value="notified" className="mt-4">
                    {notifiedQueue.length > 0 ? (
                        <ScrollArea>
                            <div className="flex space-x-4 pb-4">
                                {notifiedQueue.map(walkIn => (
                                    <div key={walkIn.id} className="w-72 shrink-0">
                                        <NotifiedCustomerCard 
                                            walkIn={walkIn} 
                                            services={services} 
                                            staff={staff}
                                            onStartService={() => onStartService(`apt-walkin-${walkIn.id}`)}
                                            onSkip={onSkip}
                                            onCancel={onCancel}
                                            onReturnToQueue={onReturnToQueue}
                                        />
                                    </div>
                                ))}
                            </div>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    ) : <p className="text-center text-muted-foreground p-8">No clients have been notified yet.</p>}
                </TabsContent>
            </Tabs>
            <AssignStaffDialog
                open={!!walkInToAssign}
                onOpenChange={() => setWalkInToAssign(null)}
                walkIn={walkInToAssign}
                staff={staff}
                onAssign={handleAssignConfirm}
                onToggleWaitForStaff={onToggleWaitForStaff}
            />
        </>
    );
};
