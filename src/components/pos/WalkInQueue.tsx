
'use client';

import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment, type Client } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp, Users, Clock, CheckCircle, Activity, QrCode, Play, ShoppingCart, DollarSign } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { InServiceAppointmentCard } from './InServiceAppointmentCard';
import { CheckoutQueueCard } from './CheckoutQueueCard';
import { startOfDay, isSameDay } from 'date-fns';

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
    onCancel: (id: string, isWalkIn: boolean) => void;
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
    onUpdateStatus: (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => void;
    onRevertToReady: (appointmentId: string) => void;
    onRevertToService: (appointmentId: string) => void;
    onResolve: (item: any) => void;
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
    onUpdateStatus,
    onRevertToReady,
    onRevertToService,
    onResolve,
}) => {
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);
    const today = startOfDay(new Date());

    const unifiedWaitlist = useMemo(() => {
        const wins = (walkIns || []).filter(w => w.status === 'waiting').map(w => ({ ...w, type: 'walk-in' as const }));
        const apts = (appointments || []).filter(a => 
            !a.isWalkIn && 
            isSameDay(new Date(a.startTime), today) && 
            (a.status === 'confirmed' || a.status === 'deposit_pending' || a.checkInStatus === 'auto_cancelled')
        ).map(a => ({ ...a, type: 'appointment' as const }));

        return [...wins, ...apts].sort((a, b) => {
            const timeA = a.type === 'walk-in' ? (a.queueOrder || new Date(a.checkInTime).getTime()) : new Date(a.startTime).getTime();
            const timeB = b.type === 'walk-in' ? (b.queueOrder || new Date(b.checkInTime).getTime()) : new Date(b.startTime).getTime();
            return timeA - timeB;
        });
    }, [walkIns, appointments, today]);

    const notifiedQueue = useMemo(() => (walkIns || []).filter(w => w.status === 'notified'), [walkIns]);
    const inServiceQueue = useMemo(() => (appointments || []).filter(apt => apt.status === 'servicing'), [appointments]);

    const handleOpenAssignDialog = (item: any) => {
        if (item.type === 'walk-in') setWalkInToAssign(item);
        else onStartService(item.id);
    };
    
    const handleAssignConfirm = (walkInId: string, staffId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn && staffId) onAssignStaff(walkIn, staffId);
        setWalkInToAssign(null);
    }

    const LaneHeader = ({ icon: Icon, title, count, colorClass, action }: { icon: any, title: string, count: number, colorClass?: string, action?: React.ReactNode }) => (
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/10">
            <div className="flex items-center gap-3">
                <div className={cn("p-1.5 rounded-lg bg-background border shadow-sm", colorClass || "text-muted-foreground")}>
                    <Icon className="w-4 h-4" />
                </div>
                <h3 className="font-black text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{title}</h3>
                <Badge variant="secondary" className={cn("font-black text-[10px] h-5 px-1.5 border-none", colorClass ? "bg-primary text-white" : "bg-muted-foreground/20")}>{count}</Badge>
            </div>
            {action}
        </div>
    );

    return (
        <div className="flex flex-col border-4 rounded-[3rem] overflow-hidden bg-white shadow-2xl shadow-primary/5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y xl:divide-y-0 xl:divide-x border-b">
                <div className="flex flex-col min-h-[450px]">
                    <LaneHeader icon={Users} title="Waitlist" count={unifiedWaitlist.length} action={<Button size="sm" variant="ghost" onClick={onAssignNext} className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5">AUTO-TURN</Button>} />
                    <ScrollArea className="flex-1">
                        <div className="p-6 space-y-4">
                            {unifiedWaitlist.length > 0 ? unifiedWaitlist.map(item => (
                                <WaitingCustomerCard key={item.id} item={item} services={services} staffList={staff} onAssign={() => handleOpenAssignDialog(item)} onCancel={onCancel} onPrintTicket={onPrintTicket} groupSize={item.type === 'walk-in' ? (groupSizes.get(item.groupId) || 1) : 1} onUpdateStatus={onUpdateStatus} onResolve={() => onResolve(item)} />
                            )) : (
                                <div className="text-center py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Sparkles className="w-10 h-10" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No Guests Arriving</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className="flex flex-col min-h-[450px] bg-primary/[0.01]">
                    <LaneHeader icon={CheckCircle} title="Notified" count={notifiedQueue.length} colorClass="text-green-500" />
                    <ScrollArea className="flex-1">
                        <div className="p-6 space-y-4">
                            {notifiedQueue.length > 0 ? notifiedQueue.map(walkIn => (
                                <NotifiedCustomerCard key={walkIn.id} walkIn={walkIn} services={services} staff={staff} onStartService={() => onStartService(`apt-walkin-${walkIn.id}`)} onSkip={onSkip} onCancel={(id) => onCancel(id, true)} onReturnToQueue={onReturnToQueue} />
                            )) : (
                                <div className="text-center py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Clock className="w-10 h-10" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Prep</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className="flex flex-col min-h-[450px]">
                    <LaneHeader icon={Activity} title="In Service" count={inServiceQueue.length} colorClass="text-blue-500" />
                    <ScrollArea className="flex-1">
                        <div className="p-6 space-y-4">
                            {inServiceQueue.length > 0 ? inServiceQueue.map(apt => (
                                <InServiceAppointmentCard key={apt.id} appointment={apt} services={services} staff={staff} onSendToCheckout={() => onFinishService(apt)} onRevertToReady={() => onRevertToReady(apt.id)} onViewDetails={() => onResolve(apt)} />
                            )) : (
                                <div className="text-center py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Play className="w-10 h-10" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Lanes Idle</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className="flex flex-col min-h-[450px] bg-orange-500/[0.01]">
                    <LaneHeader icon={ShoppingCart} title="At Desk" count={readyForCheckoutAppointments.length} colorClass="text-orange-500" action={<Button size="sm" variant="ghost" onClick={onScanClick} className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest text-orange-600 hover:bg-orange-500/5"><QrCode className="w-3 h-3 mr-1.5" /> SCAN</Button>} />
                    <ScrollArea className="flex-1">
                        <div className="p-6 space-y-4">
                            {readyForCheckoutAppointments.length > 0 ? readyForCheckoutAppointments.map(data => (
                                <CheckoutQueueCard key={data.id} appointmentData={data} isSelected={selectedAppointmentIds.has(data.id)} onSelect={() => onSelectAppointment(data.id)} onRevertToService={() => onRevertToService(data.id)} />
                            )) : (
                                <div className="text-center py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <DollarSign className="w-10 h-10" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Queue Clear</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </div>

            <AssignStaffDialog open={!!walkInToAssign} onOpenChange={() => setWalkInToAssign(null)} walkIn={walkInToAssign} staff={staff} onAssign={handleAssignConfirm} onToggleWaitForStaff={onToggleWaitForStaff} />
        </div>
    );
};
