'use client';

/**
 * WalkInQueue — v4
 *
 * v4 — THE FLOOR BOARD IS NOW THE FLOOR, NOT THE SCHEDULE.
 *
 * WHAT WAS WRONG
 *
 * 1. LANE ONE WAS TWO DIFFERENT THINGS. `unifiedWaitlist` merged walk-ins
 *    (status 'waiting') with EVERY non-walk-in appointment booked for today
 *    whose status was 'confirmed' | 'deposit_pending', with no check that the
 *    guest had actually arrived. At 9am the lane showed the entire day's book.
 *    A guest due at 4pm sat in the same list as a guest standing at the
 *    counter, and the lane was called "Waitlist" — the same word the studio
 *    uses for the /api/waitlist notify-me list. Three unrelated ideas, one
 *    word, one lane. Now: lane one is walk-ins ONLY. Booked appointments live
 *    in a separate arrivals rail above the board, because a guest with a
 *    reserved time is not queueing for anything — they already own a slot.
 *
 * 2. THE SORT COMPARED TWO INCOMPATIBLE NUMBERS. The comparator read
 *    `(w.queueOrder || new Date(w.checkInTime).getTime())`. `queueOrder` is a
 *    small counting number (1, 2, 3); `checkInTime.getTime()` is epoch
 *    milliseconds (~1.75e12). Any row that had ever been given a queueOrder
 *    sorted a trillion places ahead of every row that had not — so the order
 *    silently inverted the moment anyone was reordered. queueOrder is now a
 *    genuine manual-override tier that is never compared against a timestamp.
 *
 * 3. A GUEST WHO ASKED FOR A PROVIDER BY NAME WAS COUNTED AGAINST EVERYONE.
 *    The kiosk collects `preferredStaffId` and `waitForPreferred`, and this
 *    board ignored both. Someone holding out for Maya was shown a position
 *    computed against the whole floor, which is a number that cannot come
 *    true. Position is now computed per eligibility: "#2 for Maya" if they
 *    are waiting on one person, plain "#3" if they will take anyone.
 *
 * 4. SKIPPED GUESTS FELL OFF THE EARTH. `onSkip` writes status 'skipped', and
 *    no lane rendered that status — so the only control that could put them
 *    back (`onReturnToQueue`) was unreachable. Skipped rows now render at the
 *    foot of the waiting lane, dimmed and clearly labelled, so they can be
 *    restored.
 *
 * ALSO FIXED
 *   - `today` was `startOfDay(new Date())` computed in the render body and
 *     used as a useMemo dependency, so it was a new object every render and
 *     the memo never held. The identity-match scan (walkIns x clients) ran on
 *     every single render. Keyed on a stable day string now, and the client
 *     lookup is an index built once instead of a nested find.
 *   - `LaneHeader` was declared inside the component, making it a brand new
 *     component type each render, which unmounted and remounted every lane
 *     header. Hoisted to module scope.
 *   - Called guests now show elapsed time since they were called, escalating
 *     amber then red, so nobody sits in that lane forgotten.
 *   - No JSX comments anywhere in this file (SWC).
 *
 * v3 — board max width. v2 — bounded lane heights + mobile lane switcher.
 * v1 — four-lane walk-in/appointment board.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { WaitingCustomerCard } from './WaitingCustomerCard';
import { NotifiedCustomerCard } from './NotifiedCustomerCard';
import { type WalkIn, type Staff, type Service, type Appointment, type Client } from '@/lib/data';
import { AssignStaffDialog } from './AssignStaffDialog';
import { Button } from '../ui/button';
import {
    Sparkles, Users, Clock, CheckCircle, Activity, QrCode, Play,
    DollarSign, ShoppingCart, CalendarClock, RotateCcw,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { InServiceAppointmentCard } from './InServiceAppointmentCard';
import { CheckoutQueueCard } from './CheckoutQueueCard';
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

const LANE_HEIGHT = 'h-[460px] sm:h-[520px] md:h-[560px] xl:h-[600px] 2xl:h-[640px]';

const BOARD_MAX_WIDTH = 'w-full max-w-[1720px] mx-auto';

type LaneKey = 'waiting' | 'called' | 'inService' | 'atDesk';

/**
 * Firestore hands back timestamps in three shapes depending on how the row was
 * written: an ISO string from the API route, a Firestore Timestamp from a
 * direct client write, or a raw millisecond number from older rows. Anything
 * unparseable becomes epoch 0 so it sorts to the front rather than throwing —
 * a row with a broken timestamp is a row that has been waiting the longest as
 * far as anyone at the desk is concerned, and putting it first is the safe
 * failure.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date(0);
    if (val instanceof Date) return isNaN(val.getTime()) ? new Date(0) : val;
    if (typeof val?.toDate === 'function') {
        try { const d = val.toDate(); return isNaN(d.getTime()) ? new Date(0) : d; } catch { return new Date(0); }
    }
    if (typeof val === 'number') { const d = new Date(val); return isNaN(d.getTime()) ? new Date(0) : d; }
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? new Date(0) : d;
};

/**
 * A manual reorder writes a small counting number to `queueOrder`. It must
 * never be compared against a millisecond timestamp — that was the v3 bug.
 * Rows with a real override sort ahead of everyone, in override order; rows
 * without one fall through to arrival order. The upper bound rejects any row
 * where an epoch value was mistakenly written into this field.
 */
const OVERRIDE_CEILING = 1_000_000;
const overrideRank = (val: any): number => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 && n < OVERRIDE_CEILING ? n : Number.MAX_SAFE_INTEGER;
};

const digitsOnly = (val: any): string => String(val || '').replace(/\D/g, '');
const normalizedEmail = (val: any): string => String(val || '').toLowerCase().trim();

const firstNameOf = (val: any): string => String(val || '').trim().split(/\s+/)[0] || '';

const minutesSince = (val: any, nowMs: number): number => {
    const t = safeDate(val).getTime();
    if (!t) return 0;
    return Math.max(0, Math.round((nowMs - t) / 60000));
};

const LaneHeader = ({ icon: Icon, title, count, colorClass, action }: {
    icon: any; title: string; count: number; colorClass?: string; action?: React.ReactNode;
}) => (
    <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b bg-muted/10 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
            <div className={cn('p-1 md:p-1.5 rounded-lg bg-background border shadow-sm', colorClass || 'text-muted-foreground')}>
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </div>
            <h3 className="font-black text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-muted-foreground truncate">{title}</h3>
            <Badge variant="secondary" className={cn('font-black text-[8px] md:text-[10px] h-4 md:h-5 px-1 md:px-1.5 border-none', colorClass ? 'bg-primary text-white' : 'bg-muted-foreground/20')}>{count}</Badge>
        </div>
        {action}
    </div>
);

const EmptyLane = ({ icon: Icon, label }: { icon: any; label: string }) => (
    <div className="text-center py-16 md:py-20 border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
        <Icon className="w-8 h-8 md:w-10 md:h-10" />
        <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest px-4">{label}</p>
    </div>
);

/**
 * The number the guest is told. An open guest gets a plain position against
 * everyone else who will take anybody. A guest holding out for one provider
 * gets their position in that provider's line only, because that is the queue
 * they are actually standing in — quoting them a floor-wide number is quoting
 * them a number that cannot happen.
 */
const PositionBadge = ({ position, waitingFor, skipped }: {
    position: number; waitingFor: string | null; skipped: boolean;
}) => {
    if (skipped) {
        return (
            <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-amber-600">Skipped — tap return to put back in line</span>
            </div>
        );
    }
    return (
        <div className="flex items-center gap-2 mb-1.5 pl-1">
            <span className={cn(
                'inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-lg text-[10px] font-black tabular-nums',
                position === 1 ? 'bg-primary text-white' : 'bg-muted-foreground/15 text-muted-foreground',
            )}>{position}</span>
            {waitingFor ? (
                <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground truncate">
                    in line for {waitingFor}
                </span>
            ) : null}
        </div>
    );
};

export const WalkInQueue: React.FC<WalkInQueueProps> = ({
    walkIns, staff, services, appointments,
    readyForCheckoutAppointments, selectedAppointmentIds, onSelectAppointment,
    onAssignStaff, onAssignNext, onCancel, onStartService,
    orderedWaitingQueue, onReorder, assignmentMode,
    onPrintTicket, onSkip, onReturnToQueue, groupSizes, onToggleWaitForStaff,
    onScanClick, onFinishService, onUpdateStatus, onRevertToReady, onRevertToService, onResolve,
}) => {
    const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);
    const [mobileActiveLane, setMobileActiveLane] = useState<LaneKey>('waiting');

    /**
     * A ticking clock so "called 14 minutes ago" stays honest without the
     * parent having to re-render. Thirty seconds is fine for a number rounded
     * to the minute and costs nothing.
     */
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNowMs(Date.now()), 30000);
        return () => clearInterval(id);
    }, []);

    const { clients } = useInventory();

    /**
     * A stable string, not a Date object. The previous version put a freshly
     * constructed Date in the dependency array, which changes identity every
     * render and defeated every memo that depended on it.
     */
    const dayKey = useMemo(() => new Date(nowMs).toDateString(), [nowMs]);

    const staffNameById = useMemo(() => {
        const m = new Map<string, string>();
        (staff || []).forEach(s => { if (s?.id) m.set(String(s.id), String((s as any).name || '')); });
        return m;
    }, [staff]);

    /**
     * Built once per client-list change instead of scanning every client for
     * every waiting guest on every render.
     */
    const clientIndex = useMemo(() => {
        const byPhone = new Map<string, Client>();
        const byEmail = new Map<string, Client>();
        (clients || []).forEach(c => {
            const p = digitsOnly((c as any).phone);
            const e = normalizedEmail((c as any).email);
            if (p && !byPhone.has(p)) byPhone.set(p, c);
            if (e && !byEmail.has(e)) byEmail.set(e, c);
        });
        return { byPhone, byEmail };
    }, [clients]);

    /**
     * LANE ONE. Walk-ins only. Nothing with a booked start time belongs here.
     */
    const waitingQueue = useMemo(() => {
        const rows = (walkIns || [])
            .filter(w => w.status === 'waiting' || w.status === 'skipped')
            .map(w => {
                const raw = w as any;
                const phone = digitsOnly(raw.customerPhone || raw.phone);
                const email = normalizedEmail(raw.customerEmail || raw.email);

                let matchedClient: Client | null = null;
                const hit = (phone && clientIndex.byPhone.get(phone)) || (email && clientIndex.byEmail.get(email)) || null;
                if (hit && w.clientId !== (hit as any).id) matchedClient = hit as Client;

                const preferredStaffId = raw.preferredStaffId ? String(raw.preferredStaffId) : null;
                const holdingForPreferred = !!preferredStaffId && raw.waitForPreferred === true;

                return {
                    ...w,
                    type: 'walk-in' as const,
                    isPotentialAlias: !!matchedClient,
                    matchedClient,
                    preferredStaffId,
                    holdingForPreferred,
                    isSkipped: w.status === 'skipped',
                    waitedMinutes: minutesSince(raw.checkInTime, nowMs),
                };
            });

        rows.sort((a, b) => {
            if (a.isSkipped !== b.isSkipped) return a.isSkipped ? 1 : -1;
            const oa = overrideRank((a as any).queueOrder);
            const ob = overrideRank((b as any).queueOrder);
            if (oa !== ob) return oa - ob;
            return safeDate((a as any).checkInTime).getTime() - safeDate((b as any).checkInTime).getTime();
        });

        /**
         * Position is assigned after sorting, per eligibility. Open guests
         * count against open guests; a guest holding for one provider counts
         * only against the others holding for that same provider.
         */
        let openSeq = 0;
        const heldSeq = new Map<string, number>();

        return rows.map(row => {
            if (row.isSkipped) return { ...row, position: 0, waitingForName: null as string | null };
            if (row.holdingForPreferred && row.preferredStaffId) {
                const next = (heldSeq.get(row.preferredStaffId) || 0) + 1;
                heldSeq.set(row.preferredStaffId, next);
                return {
                    ...row,
                    position: next,
                    waitingForName: firstNameOf(staffNameById.get(row.preferredStaffId)) || 'their provider',
                };
            }
            openSeq += 1;
            return { ...row, position: openSeq, waitingForName: null as string | null };
        });
    }, [walkIns, clientIndex, staffNameById, nowMs]);

    const activeWaitingCount = useMemo(() => waitingQueue.filter(w => !w.isSkipped).length, [waitingQueue]);

    /**
     * LANE TWO. Called — a chair is ready and the guest has been sent for.
     * Elapsed minutes are carried so the lane can escalate rather than let
     * someone sit here unnoticed.
     */
    const calledQueue = useMemo(() => (walkIns || [])
        .filter(w => w.status === 'notified')
        .map(w => ({ ...w, calledMinutes: minutesSince((w as any).notifiedAt || (w as any).notifiedTimestamp, nowMs) }))
        .sort((a, b) => b.calledMinutes - a.calledMinutes),
        [walkIns, nowMs]);

    const stalledCalls = useMemo(() => calledQueue.filter(w => w.calledMinutes >= 10).length, [calledQueue]);

    const inServiceQueue = useMemo(
        () => (appointments || []).filter(apt => apt.status === 'servicing'),
        [appointments],
    );

    /**
     * THE ARRIVALS RAIL. Booked appointments, which are not a queue. Arrived
     * guests come first and are actionable; the rest are shown dim so the desk
     * can see what is coming without those rows competing for a position they
     * do not need. Walk-in mirror rows (`apt-walkin-*`) are excluded — they
     * are already represented by their walkIns row in lane one.
     */
    const arrivals = useMemo(() => {
        const rows = (appointments || [])
            .filter(a => {
                if ((a as any).isWalkIn) return false;
                if (a.status === 'servicing' || a.status === 'completed' || a.status === 'cancelled') return false;
                const start = safeDate((a as any).startTime);
                if (start.toDateString() !== dayKey) return false;
                return a.status === 'confirmed' || (a as any).status === 'deposit_pending' || (a as any).checkInStatus === 'auto_cancelled';
            })
            .map(a => {
                const raw = a as any;
                const checkIn = String(raw.checkInStatus || '');
                const hasArrived = checkIn === 'arrived' || checkIn === 'checked_in' || checkIn === 'checkedIn';
                return {
                    ...a,
                    type: 'appointment' as const,
                    isPotentialAlias: false,
                    matchedClient: null,
                    hasArrived,
                    needsAttention: checkIn === 'auto_cancelled' || raw.status === 'deposit_pending',
                };
            });

        rows.sort((a, b) => {
            if (a.hasArrived !== b.hasArrived) return a.hasArrived ? -1 : 1;
            return safeDate((a as any).startTime).getTime() - safeDate((b as any).startTime).getTime();
        });
        return rows;
    }, [appointments, dayKey]);

    const arrivedCount = useMemo(() => arrivals.filter(a => a.hasArrived).length, [arrivals]);

    const handleOpenAssignDialog = (item: any) => {
        if (item.type === 'walk-in') setWalkInToAssign(item);
        else onStartService(item.id);
    };

    const handleAssignConfirm = (walkInId: string, staffId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn && staffId) onAssignStaff(walkIn, staffId);
        setWalkInToAssign(null);
    };

    const laneTabs: { key: LaneKey; icon: any; label: string; count: number; colorClass: string }[] = [
        { key: 'waiting', icon: Users, label: 'Waiting', count: activeWaitingCount, colorClass: 'text-slate-500' },
        { key: 'called', icon: CheckCircle, label: 'Called', count: calledQueue.length, colorClass: 'text-green-500' },
        { key: 'inService', icon: Activity, label: 'In Service', count: inServiceQueue.length, colorClass: 'text-blue-500' },
        { key: 'atDesk', icon: ShoppingCart, label: 'At Desk', count: readyForCheckoutAppointments.length, colorClass: 'text-orange-500' },
    ];

    return (
        <div className={cn(BOARD_MAX_WIDTH, 'flex flex-col border-4 rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white shadow-2xl shadow-primary/5')}>

            <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b bg-muted/5 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 shrink-0">
                    <div className="p-1.5 rounded-lg bg-background border shadow-sm text-indigo-500">
                        <CalendarClock className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="font-black text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Booked today</h3>
                    <Badge variant="secondary" className="font-black text-[8px] md:text-[10px] h-4 md:h-5 px-1.5 border-none bg-muted-foreground/20">
                        {arrivedCount} here / {arrivals.length}
                    </Badge>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                    {arrivals.length === 0 ? (
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 shrink-0">Nothing on the book</span>
                    ) : arrivals.slice(0, 12).map(apt => {
                        const raw = apt as any;
                        return (
                            <button
                                key={apt.id}
                                onClick={() => onResolve(apt)}
                                className={cn(
                                    'flex items-center gap-1.5 h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest shrink-0 border-2 transition-all',
                                    apt.hasArrived
                                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/20'
                                        : apt.needsAttention
                                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 hover:bg-amber-500/20'
                                            : 'bg-white border-muted-foreground/15 text-muted-foreground/70 hover:border-muted-foreground/40',
                                )}
                            >
                                {apt.hasArrived ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                <span className="truncate max-w-[9rem]">{firstNameOf(raw.clientName) || 'Guest'}</span>
                                <span className="opacity-60 tabular-nums">
                                    {safeDate(raw.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

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

                <div className={cn('flex-col min-w-0', LANE_HEIGHT, mobileActiveLane === 'waiting' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader
                        icon={Users}
                        title="Waiting"
                        count={activeWaitingCount}
                        action={(
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={onAssignNext}
                                disabled={activeWaitingCount === 0}
                                className="h-7 md:h-8 rounded-xl font-black uppercase text-[8px] md:text-[9px] tracking-widest text-primary hover:bg-primary/5 disabled:opacity-30"
                            >
                                AUTO-TURN
                            </Button>
                        )}
                    />
                    <ScrollArea className="flex-1 min-h-0 min-w-0">
                        <div className="p-4 xl:p-5 space-y-3 min-w-0">
                            {waitingQueue.length > 0 ? waitingQueue.map(item => (
                                <div key={item.id} className={cn('min-w-0', item.isSkipped && 'opacity-50')}>
                                    <PositionBadge position={item.position} waitingFor={item.waitingForName} skipped={item.isSkipped} />
                                    <WaitingCustomerCard
                                        item={item}
                                        services={services}
                                        staffList={staff}
                                        onAssign={() => handleOpenAssignDialog(item)}
                                        onCancel={onCancel}
                                        onPrintTicket={onPrintTicket}
                                        groupSize={groupSizes.get((item as any).groupId) || 1}
                                        onUpdateStatus={onUpdateStatus}
                                        onResolve={() => onResolve(item)}
                                    />
                                    {item.isSkipped ? (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => onReturnToQueue(item.id)}
                                            className="mt-1.5 h-7 w-full rounded-xl font-black uppercase text-[8px] tracking-widest text-amber-700 hover:bg-amber-500/10"
                                        >
                                            <RotateCcw className="w-3 h-3 mr-1.5" />
                                            Return to line
                                        </Button>
                                    ) : null}
                                </div>
                            )) : (
                                <EmptyLane icon={Sparkles} label="Nobody waiting" />
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className={cn('flex-col bg-primary/[0.01] min-w-0', LANE_HEIGHT, mobileActiveLane === 'called' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader
                        icon={CheckCircle}
                        title="Called"
                        count={calledQueue.length}
                        colorClass="text-green-500"
                        action={stalledCalls > 0 ? (
                            <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-red-600">
                                {stalledCalls} waiting 10m+
                            </span>
                        ) : undefined}
                    />
                    <ScrollArea className="flex-1 min-h-0 min-w-0">
                        <div className="p-4 xl:p-5 space-y-3 min-w-0">
                            {calledQueue.length > 0 ? calledQueue.map(walkIn => (
                                <div key={walkIn.id} className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5 pl-1">
                                        <span className={cn(
                                            'text-[8px] md:text-[9px] font-black uppercase tracking-widest tabular-nums',
                                            walkIn.calledMinutes >= 15 ? 'text-red-600'
                                                : walkIn.calledMinutes >= 10 ? 'text-amber-600'
                                                    : 'text-muted-foreground',
                                        )}>
                                            Called {walkIn.calledMinutes}m ago
                                        </span>
                                    </div>
                                    <NotifiedCustomerCard
                                        walkIn={walkIn}
                                        services={services}
                                        staff={staff}
                                        onStartService={() => onStartService(`apt-walkin-${walkIn.id}`)}
                                        onSkip={onSkip}
                                        onCancel={(id: string) => onCancel(id, true)}
                                        onReturnToQueue={onReturnToQueue}
                                        onUpdateStatus={onUpdateStatus}
                                    />
                                </div>
                            )) : (
                                <EmptyLane icon={Clock} label="Nobody called" />
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className={cn('flex-col min-w-0', LANE_HEIGHT, mobileActiveLane === 'inService' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader icon={Activity} title="In Service" count={inServiceQueue.length} colorClass="text-blue-500" />
                    <ScrollArea className="flex-1 min-h-0 min-w-0">
                        <div className="p-4 xl:p-5 space-y-3 min-w-0">
                            {inServiceQueue.length > 0 ? inServiceQueue.map(apt => (
                                <InServiceAppointmentCard
                                    key={apt.id}
                                    appointment={apt}
                                    services={services}
                                    staff={staff}
                                    onSendToCheckout={() => onFinishService(apt)}
                                    onViewDetails={() => onResolve(apt)}
                                    onCancel={() => onCancel(apt.id, !!(apt as any).isWalkIn)}
                                />
                            )) : (
                                <EmptyLane icon={Play} label="Chairs idle" />
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <div className={cn('flex-col bg-orange-500/[0.01] min-w-0', LANE_HEIGHT, mobileActiveLane === 'atDesk' ? 'flex' : 'hidden md:flex')}>
                    <LaneHeader
                        icon={ShoppingCart}
                        title="At Desk"
                        count={readyForCheckoutAppointments.length}
                        colorClass="text-orange-500"
                        action={(
                            <Button size="sm" variant="ghost" onClick={onScanClick} className="h-7 md:h-8 rounded-xl font-black uppercase text-[8px] md:text-[9px] tracking-widest text-orange-600 hover:bg-orange-500/5">
                                <QrCode className="w-3 h-3 mr-1" /> SCAN
                            </Button>
                        )}
                    />
                    <ScrollArea className="flex-1 min-h-0 min-w-0">
                        <div className="p-4 xl:p-5 space-y-3 min-w-0">
                            {readyForCheckoutAppointments.length > 0 ? readyForCheckoutAppointments.map(data => (
                                <CheckoutQueueCard
                                    key={data.id}
                                    appointmentData={data}
                                    isSelected={selectedAppointmentIds.has(data.id)}
                                    onSelect={() => onSelectAppointment(data.id)}
                                    onRevertToService={() => onRevertToService(data.id)}
                                />
                            )) : (
                                <EmptyLane icon={DollarSign} label="Queue clear" />
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
