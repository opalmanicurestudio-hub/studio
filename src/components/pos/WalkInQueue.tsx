'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment, type Client } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp, Users, Clock, CheckCircle, Activity, QrCode, Play, ShoppingCart } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { InServiceAppointmentCard } from './InServiceAppointmentCard';
import { CheckoutQueueCard } from './CheckoutQueueCard';

interface WalkInQueueProps {
    walkIns: WalkIn[] | null;
    staff: Staff[] | null;
    services: Service[] | null;
    appointments: Appointment[] | null;
    readyForCheckoutAppointments: {
        id: string;
        appointment: Appointment;
        client: Client;
        service: Service;
        addOnServices: Service[];
        staff: Staff;
    }[];
    selectedAppointmentIds: Set<string>;
    onSelectAppointment: (id: string) => void;
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
    onScanClick: () => void;
    onFinishService: (apt: Appointment) => void;
}

export const WalkInQueue: React.FC<WalkInQueueProps> = ({ 
    walkIns, 
    staff, 
    services, 
    appointments,
    readyForCheckoutAppointments,
    selectedAppointmentIds,
    onSelectAppointment,
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
    onScanClick,
    onFinishService,
}) => {
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);

    const notifiedQueue = useMemo(() => {
        return (walkIns || []).filter(w => w.status === 'notified');
    }, [walkIns]);

    const inServiceQueue = useMemo(() => {
        return (appointments || []).filter(apt => apt.status === 'servicing');
    }, [appointments]);

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

    const LaneHeader = ({ icon: Icon, title, count, colorClass, action }: { icon: any, title: string, count: number, colorClass?: string, action?: React.ReactNode }) => (
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
                <Icon className={cn("w-4 h-4", colorClass || "text-muted-foreground")} />
                <h3 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
                <Badge variant="secondary" className={cn("font-bold text-[10px]", colorClass && "bg-primary/10 text-primary")}>{count}</Badge>
            </div>
            {action}
        </div>
    );

    return (
        <div className="flex flex-col">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x border-b">
                {/* 1. Waiting Lane */}
                <div className="flex flex-col min-h-[300px]">
                    <LaneHeader 
                        icon={Users} 
                        title="Waitlist" 
                        count={orderedWaitingQueue.length} 
                        action={
                            <Button size="sm" variant="ghost" onClick={onAssignNext} className="h-7 text-[10px] font-black hover:text-primary">
                                AUTO
                            </Button>
                        }
                    />
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-3">
                            {orderedWaitingQueue.length > 0 ? (
                                orderedWaitingQueue.map(walkIn => (
                                    <WaitingCustomerCard 
                                        key={walkIn.id}
                                        walkIn={walkIn} 
                                        services={services} 
                                        staffList={staff}
                                        onAssign={() => handleOpenAssignDialog(walkIn)} 
                                        onCancel={onCancel}
                                        onMoveToFront={handleMoveToFront}
                                        onPrintTicket={onPrintTicket}
                                        groupSize={groupSizes.get(walkIn.groupId) || 1}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-12 border-2 border-dashed rounded-xl opacity-40">
                                    <p className="text-xs font-medium">Waitlist clear</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* 2. Notified Lane */}
                <div className="flex flex-col min-h-[300px] bg-primary/[0.02]">
                    <LaneHeader icon={CheckCircle} title="Ready" count={notifiedQueue.length} colorClass="text-green-500" />
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-3">
                            {notifiedQueue.length > 0 ? (
                                notifiedQueue.map(walkIn => (
                                    <NotifiedCustomerCard 
                                        key={walkIn.id} 
                                        walkIn={walkIn} 
                                        services={services} 
                                        staff={staff}
                                        onStartService={() => onStartService(`apt-walkin-${walkIn.id}`)}
                                        onSkip={onSkip}
                                        onCancel={onCancel}
                                        onReturnToQueue={onReturnToQueue}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-12 border-2 border-dashed rounded-xl opacity-40">
                                    <p className="text-xs font-medium">No one ready</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* 3. In Service Lane */}
                <div className="flex flex-col min-h-[300px]">
                    <LaneHeader icon={Clock} title="In Service" count={inServiceQueue.length} colorClass="text-blue-500" />
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-3">
                            {inServiceQueue.length > 0 ? (
                                inServiceQueue.map(apt => (
                                    <InServiceAppointmentCard 
                                        key={apt.id} 
                                        appointment={apt} 
                                        services={services} 
                                        staff={staff} 
                                        onSendToCheckout={() => onFinishService(apt)} 
                                    />
                                ))
                            ) : (
                                <div className="text-center py-12 border-2 border-dashed rounded-xl opacity-40">
                                    <p className="text-xs font-medium">Lanes free</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* 4. Checkout Lane */}
                <div className="flex flex-col min-h-[300px] bg-orange-500/[0.02]">
                    <LaneHeader 
                        icon={ShoppingCart} 
                        title="Checkout" 
                        count={readyForCheckoutAppointments.length} 
                        colorClass="text-orange-500"
                        action={
                            <Button size="sm" variant="ghost" onClick={onScanClick} className="h-7 text-[10px] font-black hover:text-orange-600">
                                <QrCode className="w-3 h-3 mr-1" /> SCAN
                            </Button>
                        }
                    />
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-3">
                            {readyForCheckoutAppointments.length > 0 ? (
                                readyForCheckoutAppointments.map(data => (
                                    <CheckoutQueueCard
                                        key={data.id}
                                        appointmentData={data}
                                        isSelected={selectedAppointmentIds.has(data.id)}
                                        onSelect={() => onSelectAppointment(data.id)}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-12 border-2 border-dashed rounded-xl opacity-40">
                                    <p className="text-xs font-medium">Queue empty</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
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
