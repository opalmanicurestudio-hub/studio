'use client';

/**
 * WalkInQueue — v2
 *
 * v2 — FIX: each lane used `min-h-[400px]` (a minimum, not a bound). Radix
 * ScrollArea only scrolls internally when its ancestor has a genuinely
 * bounded height — with only a min-height, the lane just grew to fit every
 * card instead of ever scrolling. Combined with `xl:grid-cols-4` (CSS Grid
 * stretches all items in a row to match the tallest), a Waitlist with a
 * dozen people forced every OTHER lane — including a near-empty "Notified"
 * lane — to stretch to match, producing wildly inconsistent lane heights
 * and large dead space. Fixed by giving each lane a real bounded height
 * (LANE_HEIGHT below), so ScrollArea finally has something to scroll
 * within and all four lanes stay a consistent, predictable size regardless
 * of how many cards are in each.
 *
 * v2 — NEW: mobile lane switcher. Previously `grid-cols-1` stacked all four
 * lanes fully vertically on small screens — 1600px+ of scroll before
 * reaching "At Desk." Below the md breakpoint, a horizontal tab strip now
 * lets staff jump directly to one lane. Implemented via CSS `hidden md:flex`
 * rather than conditional unmounting — all four lanes stay mounted at all
 * times, just visually hidden, which avoids any Rules-of-Hooks risk from
 * child components conditionally entering/leaving the tree.
 *
 * v1 — four-lane walk-in/appointment board: Waitlist, Notified, In Service,
 * At Desk (checkout-ready).
 */

import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment, type Client } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import {
    Sparkles, TrendingUp, Users, Clock, CheckCircle, Activity, QrCode, Play,
    ShoppingBag, DollarSign, ShoppingCart, Target
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { cn, safeNumber } from '@/lib/utils';
import { InServiceAppointmentCard } from './InServiceAppointmentCard';
import { CheckoutQueueCard } from './CheckoutQueueCard';
import { startOfDay, isSameDay } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';

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

// v2 — real bounded height for every lane. Responsive at the sm breakpoint
// so mobile (which now only shows one lane at a time) gets a bit more room
// than the tighter 4-across desktop layout.
const LANE_HEIGHT = 'h-[460px] sm:h-[520px] md:h-[560px]';

type LaneKey = 'waitlist' | 'notified' | 'inService' | 'atDesk';

export const WalkInQueue: React.FC<WalkInQueueProps> = ({
    walkIns, staff, services, appointments,
    readyForCheckoutAppointments, selectedAppointmentIds, onSelectAppointment,
    onAssignStaff, onAssignNext, onCancel, onStartService,
    orderedWaitingQueue, onReorder, assignmentMode,
    onPrintTicket, onSkip, onReturnToQueue, groupSizes, onToggleWaitForStaff,
    onScanClick, onFinishService, onUpdateStatus, onRevertToReady, onRevertToService, onResolve,
}) => {
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);
    const [mobileActiveLane, setMobileActiveLane] = useState<LaneKey>('waitlist');
    const today = startOfDay(new Date());

    // Get clients to detect phone/email duplicates
    const { clients } = useInventory();

    const unifiedWaitlist = useMemo(() => {
        const wins = (walkIns || []).filter(w => w.status === 'waiting').map(w => {
            // REAL IDENTITY MATCH DETECTION: check if this walk-in's phone or email
            // matches an existing client in the database
            let isPotentialAlias = false;
            let matchedClient: Client | null = null;

            if (clients && clients.length > 0) {
                // Kiosk saves as customerPhone/customerEmail, manual walk-ins may use phone/email
                const rawPhone = (w as any).customerPhone || (w as any).phone || '';
                const rawEmail = (w as any).customerEmail || (w as any).email || '';
                const walkInPhone = rawPhone.replace(/\D/g, '');
                const walkInEmail = rawEmail.toLowerCase().trim();

                const match = clients.find(c => {
                    const clientPhone = c.phone?.replace(/\D/g, '');
                    const clientEmail = c.email?.toLowerCase().trim();

                    const phoneMatch = walkInPhone && clientPhone && walkInPhone === clientPhone;
                    const emailMatch = walkInEmail && clientEmail && walkInEmail === clientEmail;

                    // Only flag if they don't already have a clientId linking them
                    const alreadyLinked = w.clientId === c.id;

                    return (phoneMatch || emailMatch) && !alreadyLinked;
                });

                if (match) {
                    isPotentialAlias = true;
                    matchedClient = match;
                }
            }

            return { ...w, type: 'walk-in' as const, isPotentialAlias, matchedClient };
        });

        const apts = (appointments || []).filter(a =>
            !a.isWalkIn &&
            isSameDay(new Date(a.startTime), today) &&
            (a.status === 'confirmed' || a.status === 'deposit_pending' || a.checkInStatus === 'auto_cancelled')
        ).map(a => ({ ...a, type: 'appointment' as const, isPotentialAlias: false, matchedClient: null }));

        return [...wins, ...apts].sort((a, b) => {
            const timeA = a.type === 'walk-in' ? (a.queueOrder || new Date(a.checkInTime).getTime()) : new Date(a.startTime).getTime();
            const timeB = b.type === 'walk-in' ? (b.queueOrder || new Date(b.checkInTime).getTime()) : new Date(b.startTime).getTime();
            return timeA - timeB;
        });
    }, [walkIns, appointments, today, clients]);

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
    };

    const LaneHeader = ({ icon: Icon, title, count, colorClass, action }: { icon: any, title: string, count: number, colorClass?: string, action?: React.ReactNode }) => (
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b bg-muted/10 shrink-0">
            <div className="flex items-center gap-2 md:gap-3">
                <div className={cn("p-1 md:p-1.5 rounded-lg bg-background border shadow-sm", colorClass || "text-muted-foreground")}>
                    <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </div>
                <h3 className="font-black text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-muted-foreground truncate">{title}</h3>
                <Badge variant="secondary" className={cn("font-black text-[8px] md:text-[10px] h-4 md:h-5 px-1 md:px-1.5 border-none", colorClass ? "bg-primary text-white" : "bg-muted-foreground/20")}>{count}</Badge>
            </div>
            {action}
        </div>
    );

    // v2 — mobile lane tab definitions, built once per render from the
    // already-computed queues so counts always match what's shown.
    const laneTabs: { key: LaneKey; icon: any; label: string; count: number; colorClass: string }[] = [
        { key: 'waitlist', icon: Users, label: 'Waitlist', count: unifiedWaitlist.length, colorClass: 'text-slate-500' },
        { key: 'notified', icon: CheckCircle, label: 'Notified', count: notifiedQueue.length, colorClass: 'text-green-500' },
        { key: 'inService', icon: Activity, label: 'In Service', count: inServiceQueue.length, colorClass: 'text-blue-500' },
        { key: 'atDesk', icon: ShoppingCart, label: 'At Desk', count: readyForCheckoutAppointments.length, colorClass: 'text-orange-500' },
    ];

    return (
        <div className="flex flex-col border-4 rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white shadow-2xl shadow-primary/5">
            {/* v2 — mobile lane switcher. Hidden at md+ where all four lanes
                already sit side by side. All lanes below stay mounted
                regardless (CSS-hidden, not conditionally rendered) so this
                never risks a hooks-order issue in the lane cards. */}
            <div className="flex md:hidden items-center gap-1.5 p-3 border-b bg-muted/10 overflow-x-auto no-scrollbar">
                {laneTabs.map(tab => {
                    const isActive = mobileActiveLane === tab.key;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setMobileActiveLane(tab.key)}
                            className={cn(
                                'flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-[9px] font-black uppercase tracking-widest shrink-0 transition-all border-2',
                                isActive
                                    ? 'bg-primary text-white border-primary shadow-sm'
                                    : 'bg-white text-muted-foreground border-transparent hover:border-muted-foreground/20',
                            )}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                            <span className={cn(
                                'w-4 h-4 rounded-full text-[8px] flex items-center justify-center font-black shrink-0',
                                isActive ? 'bg-white/25 text-white' : 'bg-muted-foreground/15 text-muted-foreground',
                            )}>{tab.count}</span>
                        </button>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x border-b">
                {/* Waitlist */}
                <div className={cn('flex-col', LANE_HEIGHT, mobileActiveLane === 'waitlist' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader icon={Users} title="Waitlist" count={unifiedWaitlist.length} action={<Button size="sm" variant="ghost" onClick={onAssignNext} className="h-7 md:h-8 rounded-xl font-black uppercase text-[8px] md:text-[9px] tracking-widest text-primary hover:bg-primary/5">AUTO-TURN</Button>} />
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 md:p-6 space-y-4">
                            {unifiedWaitlist.length > 0 ? unifiedWaitlist.map(item => (
                                <WaitingCustomerCard key={item.id} item={item} services={services} staffList={staff} onAssign={() => handleOpenAssignDialog(item)} onCancel={onCancel} onPrintTicket={onPrintTicket} groupSize={item.type === 'walk-in' ? (groupSizes.get((item as any).groupId) || 1) : 1} onUpdateStatus={onUpdateStatus} onResolve={() => onResolve(item)} />
                            )) : (
                                <div className="text-center py-16 md:py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Sparkles className="w-8 h-8 md:w-10 md:h-10" />
                                    <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest px-4">No Guests Arriving</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Notified */}
                <div className={cn('flex-col bg-primary/[0.01]', LANE_HEIGHT, mobileActiveLane === 'notified' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader icon={CheckCircle} title="Notified" count={notifiedQueue.length} colorClass="text-green-500" />
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 md:p-6 space-y-4">
                            {notifiedQueue.length > 0 ? notifiedQueue.map(walkIn => (
                                <NotifiedCustomerCard key={walkIn.id} walkIn={walkIn} services={services} staff={staff} onStartService={() => onStartService(`apt-walkin-${walkIn.id}`)} onSkip={onSkip} onCancel={(id) => onCancel(id, true)} onReturnToQueue={onReturnToQueue} onUpdateStatus={onUpdateStatus} />
                            )) : (
                                <div className="text-center py-16 md:py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Clock className="w-8 h-8 md:w-10 md:h-10" />
                                    <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest px-4">Awaiting Prep</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* In Service */}
                <div className={cn('flex-col', LANE_HEIGHT, mobileActiveLane === 'inService' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader icon={Activity} title="In Service" count={inServiceQueue.length} colorClass="text-blue-500" />
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 md:p-6 space-y-4">
                            {inServiceQueue.length > 0 ? inServiceQueue.map(apt => (
                                <InServiceAppointmentCard key={apt.id} appointment={apt} services={services} staff={staff} onSendToCheckout={() => onFinishService(apt)} onViewDetails={() => onResolve(apt)} onCancel={() => onCancel(apt.id, !!apt.isWalkIn)} />
                            )) : (
                                <div className="text-center py-16 md:py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <Play className="w-8 h-8 md:w-10 md:h-10" />
                                    <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest px-4">Lanes Idle</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* At Desk */}
                <div className={cn('flex-col bg-orange-500/[0.01]', LANE_HEIGHT, mobileActiveLane === 'atDesk' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader icon={ShoppingCart} title="At Desk" count={readyForCheckoutAppointments.length} colorClass="text-orange-500" action={<Button size="sm" variant="ghost" onClick={onScanClick} className="h-7 md:h-8 rounded-xl font-black uppercase text-[8px] md:text-[9px] tracking-widest text-orange-600 hover:bg-orange-500/5"><QrCode className="w-3 h-3 mr-1" /> SCAN</Button>} />
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 md:p-6 space-y-4">
                            {readyForCheckoutAppointments.length > 0 ? readyForCheckoutAppointments.map(data => (
                                <CheckoutQueueCard key={data.id} appointmentData={data} isSelected={selectedAppointmentIds.has(data.id)} onSelect={() => onSelectAppointment(data.id)} onRevertToService={() => onRevertToService(data.id)} />
                            )) : (
                                <div className="text-center py-16 md:py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                    <DollarSign className="w-8 h-8 md:w-10 md:h-10" />
                                    <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest px-4">Queue Clear</p>
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
