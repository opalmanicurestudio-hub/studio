'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp, Users, Clock, CheckCircle } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

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
        <div className="space-y-6">
            {/* Waiting Lane */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Waiting List</h3>
                        <Badge variant="secondary" className="font-bold">{orderedWaitingQueue.length}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={onAssignNext} className="h-8 text-xs text-primary font-black hover:text-primary hover:bg-primary/5">
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        AUTO-ASSIGN
                    </Button>
                </div>
                {orderedWaitingQueue.length > 0 ? (
                    <ScrollArea className="w-full">
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
                ) : (
                    <div className="text-center py-8 border-2 border-dashed rounded-xl bg-muted/20">
                        <p className="text-sm text-muted-foreground">The waitlist is clear.</p>
                    </div>
                )}
            </div>

            <Separator className="border-dashed" />

            {/* Notified Lane */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Ready to Start</h3>
                    <Badge variant="secondary" className="font-bold bg-green-500/10 text-green-700">{notifiedQueue.length}</Badge>
                </div>
                {notifiedQueue.length > 0 ? (
                    <ScrollArea className="w-full">
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
                ) : (
                    <div className="text-center py-8 border-2 border-dashed rounded-xl bg-muted/20">
                        <p className="text-sm text-muted-foreground">No clients waiting at the station.</p>
                    </div>
                )}
            </div>

            <AssignStaffDialog
                open={!!walkInToAssign}
                onOpenChange={() => setWalkInToAssign(null)}
                walkIn={walkInToAssign}
                staff={staff}
                onAssign={handleAssignConfirm}
                onToggleWaitForStaff={onToggleWaitForStaff}
            />
        </div>
    );
};
