'use client';

import { format, differenceInMinutes, isSameDay, isToday, subMinutes, areIntervalsOverlapping, setHours, startOfDay, parseISO, addMinutes } from 'date-fns';
import { type Staff, type Appointment, type Service, type Resource, type Event } from '@/lib/data';
import { type Transaction, type BillInstance } from '@/lib/financial-data';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { EventCard } from '@/components/planner/EventCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Building, HardHat, Lock, Users, Landmark, Briefcase, Eye, DollarSign, Link2, ChevronsUpDown, Phone, MessageSquare } from 'lucide-react';

// Live elapsed timer for a checked-in reservation — ticks itself so only the
// timer re-renders, not the whole timeline. Turns red + "OVER" past booked end.
const LiveTimer = ({ startIso, bookedEndIso, overageRateCentsPerHour }: { startIso?: string | null; bookedEndIso?: string | null; overageRateCentsPerHour?: number }) => {
    const [now, setNow] = React.useState<number>(() => new Date().getTime());
    React.useEffect(() => {
        const id = setInterval(() => setNow(new Date().getTime()), 1000);
        return () => clearInterval(id);
    }, []);
    if (!startIso) return null;
    const start = new Date(startIso).getTime();
    if (isNaN(start)) return null;
    const fmt = (ms: number) => {
        const s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
    };
    const endMs = bookedEndIso ? new Date(bookedEndIso).getTime() : NaN;
    if (!isNaN(endMs) && now - endMs > 0) {
        // Running overage total — mirrors the booth rule (10-min grace, 15-min
        // increments). Live estimate; the authoritative charge is at checkout.
        const overMin = (now - endMs) / 60000;
        let est = 0;
        if (overageRateCentsPerHour && overMin > 10) est = overageRateCentsPerHour * (Math.ceil(overMin / 15) * 15) / 60;
        return <span className="tabular-nums font-semibold text-destructive">OVER +{fmt(now - endMs)}{est > 0 ? ` · ~$${(est / 100).toFixed(0)}` : ''}</span>;
    }
    return <span className="tabular-nums font-semibold">{fmt(now - start)}</span>;
};
import { Card, CardContent } from '../ui/card';
import { Badge } from '@/components/ui/badge';

// React #130 tripwire — if either card import resolves to undefined (a
// named-vs-default export mismatch inside AppointmentCard.tsx / EventCard.tsx),
// name the culprit on screen instead of letting React take down the planner.
const _CARD_IMPORTS: Array<[string, any]> = [
    ['AppointmentCard (src/components/planner/AppointmentCard.tsx)', AppointmentCard],
    ['EventCard (src/components/planner/EventCard.tsx)', EventCard],
];
const _MISSING_CARDS = _CARD_IMPORTS.filter(([, c]) => !c).map(([n]) => n);

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

// Colour by provider: a calm palette, one per column in order.
const PROVIDER_COLOURS = ['#2e6f6a', '#7c5a3c', '#5b5bd6', '#b45309', '#be185d', '#0f766e', '#6d28d9', '#a16207'];
export const DayTimeline = ({ 
    date, 
    columns,
    itemsByColumn,
    showColumnHeader,
    onCompleteClick, 
    onUpdateStatus, 
    onDeleteAppointment, 
    onPrintReceipt, 
    onPrintTicket,
    onEditAppointment,
    onEditEvent,
    onChecklistItemToggle,
    onUpdateEvent,
    dailyTransactions,
    allTransactions,
    onReschedule,
    onRebook,
    onStartService,
    onFinishService,
    onBookNewForClient,
    onDeleteEvent,
    onViewDetails,
    onApproveRequest,
    onDeclineRequest,
    onReportIssue,
    onResolveIssue,
    canDeclineDirectly,
    canResolveIssues,
    focusId,
    onFocusSettled,
    walkIns,
    clients,
    services,
    resources,
    isMobile,
    activeView,
    allStaff,
    mobileSelectedColumnId,
    onMobileColumnChange,
    onBookAt,        // (columnId, Date) — "Book here" on a gap
    onBlockAt,       // (columnId, Date, minutes) — "Block" on a gap
    onMoveAppointment,   // (appointment, columnId, 'HH:mm') — a card dropped on a new time; the page checks with the server first
    density = 'roomy',   // 'roomy' | 'compact'
    startHour = null,    // a person's "start my day at" (earlier visits still show)
    colourBy = 'state',  // 'state' | 'provider'
}: any) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const safeColumns = columns || [];
    const [showFullDay, setShowFullDay] = useState(false);

    const PX_PER_HOUR = isMobile ? 96 : density === 'compact' ? 100 : 160;
    const PX_PER_MIN = PX_PER_HOUR / 60;

    const dayWindow = useMemo(() => {
        const dayZero = startOfDay(date);
        let firstMin = 9 * 60;
        let lastMin = 19 * 60;
        const consider = (v: any, isEnd: boolean) => {
            const d = safeDate(v);
            if (!(d instanceof Date) || Number.isNaN(d.getTime())) return;
            const m = differenceInMinutes(d, dayZero);
            if (m < 0) return;
            if (isEnd) lastMin = Math.max(lastMin, m);
            else firstMin = Math.min(firstMin, m);
        };
        if (itemsByColumn) {
            for (const items of Array.from(itemsByColumn.values()) as any[]) {
                for (const it of (items || [])) {
                    if (!it) continue;
                    consider(it.startTime || it.dueDate, false);
                    consider(it.endTime || it.startTime || it.dueDate, true);
                }
            }
        }
        if (isToday(date)) {
            const nowMin = differenceInMinutes(new Date(), startOfDay(new Date()));
            firstMin = Math.min(firstMin, nowMin);
            lastMin = Math.max(lastMin, nowMin);
        }
        firstMin = Math.min(Math.max(firstMin, 0), 1439);
        lastMin = Math.min(Math.max(lastMin, firstMin + 60), 1440);
        const start = Math.max(0, Math.floor(firstMin / 60) - 1);
        const end = Math.min(24, Math.max(Math.ceil(lastMin / 60) + 1, start + 4));
        return { start, end };
    }, [itemsByColumn, date]);

    const START_HOUR = showFullDay ? 0 : (Number.isFinite(startHour) && startHour !== null ? Math.min(dayWindow.start, Number(startHour)) : dayWindow.start);
    const END_HOUR = showFullDay ? 24 : dayWindow.end;
    const hours = useMemo(
        () => Array.from({ length: Math.max(1, END_HOUR - START_HOUR) }, (_, i) => START_HOUR + i),
        [START_HOUR, END_HOUR],
    );
    const hoursHidden = 24 - (END_HOUR - START_HOUR);

    // WORKING HOURS for a provider column on this day (from their availability), as minutes from the window start.
    const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
    const hoursFor = (column: any): { start: number; end: number } | null => {
        const d = column?.availability?.week?.[dayKey]; if (!d || d.enabled === false || !d.start || !d.end) return null;
        const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
        return { start: toMin(d.start), end: toMin(d.end) };
    };
    // Drag to move: the card being dragged, and where it would land (snapped to 5 min).
    const [drag, setDrag] = useState<{ id: string; mins: number; columnId: string | null; top: number } | null>(null);
    const dragRef = useRef<any>(null);
    const swipeRef = useRef<{ x: number; y: number } | null>(null);
    const displayedColumns = useMemo(() => {
        if (!isMobile) return safeColumns;
        const selected = safeColumns.find((c:any) => c.id === mobileSelectedColumnId);
        return selected ? [selected] : (safeColumns.length > 0 ? [safeColumns[0]] : []);
    }, [isMobile, safeColumns, mobileSelectedColumnId]);

    const positionedItemsByColumn = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!itemsByColumn) return map;
        
        for (const column of safeColumns) {
            const columnId = column.id;
            /* ── DROP UNDATEABLE ITEMS BEFORE ANY DATE MATHS ──────────────
             * date-fns throws a RangeError on an Invalid Date, and the
             * overlap test below is called for every pair of items in a
             * column. One appointment with a malformed or missing start time
             * therefore throws inside this useMemo and takes the entire
             * timeline down — which is felt as the planner freezing the
             * moment you switch to the provider who happens to own that
             * appointment.
             *
             * An item we cannot place in time cannot be drawn on a time grid,
             * so it is left out rather than allowed to kill the grid. */
            const rawItems = itemsByColumn.get(columnId) || [];
            const items = rawItems.filter((it: any) => {
                const st = safeDate(it.startTime || it.dueDate);
                return st instanceof Date && !Number.isNaN(st.getTime());
            });
            let layoutInfo = items.map(item => ({ ...item, layout: { width: '100%', left: '0', cols: 1, col: 0 } }));
            
            function positionCluster(cluster: any[]) {
                cluster.sort((a,b) => safeDate(a.startTime || a.dueDate).getTime() - safeDate(b.startTime || b.dueDate).getTime());
                const cols: any[][] = [];
                for(const item of cluster) {
                    const start = safeDate(item.startTime || item.dueDate);
                    const end = safeDate(item.endTime || (item.itemType === 'bill' ? addMinutes(start, 60) : item.endTime));
                    let placed = false;
                    for (let i = 0; i < cols.length; i++) {
                        if (!cols[i].some(ex => {
                            const exStart = safeDate(ex.startTime || ex.dueDate);
                            const exEnd = safeDate(ex.endTime || (ex.itemType === 'bill' ? addMinutes(exStart, 60) : ex.endTime));
                            /* Belt and braces: an end date can still be
                             * invalid even when the start is fine (a missing
                             * endTime on a non-bill). Treat anything we cannot
                             * compare as "not overlapping" rather than letting
                             * date-fns throw. */
                            const ok = [start, end, exStart, exEnd].every(
                                (d) => d instanceof Date && !Number.isNaN(d.getTime()),
                            );
                            if (!ok) return false;
                            return areIntervalsOverlapping({ start, end }, { start: exStart, end: exEnd }, { inclusive: false });
                        })) {
                            cols[i].push(item); item.layout.col = i; placed = true; break;
                        }
                    }
                    if (!placed) { cols.push([item]); item.layout.col = cols.length - 1; }
                }
                cluster.forEach(item => { item.layout.cols = cols.length; });
            }

            let lastEventEnd: Date | null = null;
            let currentCluster: any[] = [];
            for (const item of layoutInfo) {
                const start = safeDate(item.startTime || item.dueDate);
                let end = safeDate(item.endTime || (item.itemType === 'bill' ? addMinutes(start, 60) : item.endTime));
                // A missing end is survivable — assume a nominal hour — where
                // a NaN in the cluster maths is not.
                if (!(end instanceof Date) || Number.isNaN(end.getTime())) end = addMinutes(start, 60);
                if (lastEventEnd !== null && start.getTime() >= lastEventEnd.getTime()) { 
                    positionCluster(currentCluster); 
                    currentCluster = []; 
                }
                currentCluster.push(item);
                lastEventEnd = new Date(Math.max(lastEventEnd?.getTime() || 0, end.getTime()));
            }
            if (currentCluster.length > 0) positionCluster(currentCluster);
            map.set(columnId, layoutInfo.map(item => ({ ...item, layout: { width: `${100 / item.layout.cols}%`, left: `${(100 / item.layout.cols) * item.layout.col}%` } })));
        }
        return map;
    }, [itemsByColumn, safeColumns]);

    const renderBill = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const dueDate = safeDate(item.dueDate);
        const top = differenceInMinutes(dueDate, dayStart) * PX_PER_MIN;
        const height = 60 * PX_PER_MIN;
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <Card className="h-full border border-amber-600/40 bg-amber-500/[0.07] hover:bg-amber-500/[0.12] transition-colors cursor-pointer overflow-hidden shadow-none rounded-xl sm:rounded-2xl">
                    <CardContent className="p-2 sm:p-3 flex flex-col justify-center h-full gap-0.5 sm:gap-1 text-left">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                            <Landmark className="w-3 h-3 sm:w-4 sm:h-4 text-amber-700" />
                            <p className="text-[12px] sm:text-[12px] font-semibold text-amber-800 truncate">{item.definition?.name || 'Bill'}</p>
                        </div>
                        <p className="font-semibold text-sm sm:text-lg text-amber-900">${item.definition?.amount?.toFixed(2) || '0.00'}</p>
                        <Badge variant="outline" className="w-fit h-4 sm:h-5 px-1 sm:px-1.5 text-[12px] sm:text-[12px] border-amber-600/30 text-amber-800 font-semibold">Due Today</Badge>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ── WHICH CARDS BELONG TOGETHER ─────────────────────────────────────────
    // A party of five and a three-provider visit both land on the board as
    // separate cards in separate columns, which read as five and three
    // unrelated strangers. Front desk then greeted them one at a time and
    // moved one card when the whole booking shifted. This indexes every visit
    // once so each card can say what it is part of and where it sits in it.
    const visitIndex = useMemo(() => {
        const groups = new Map<string, { kind: 'party' | 'chain'; ids: string[] }>();
        const all: any[] = [];
        if (itemsByColumn) {
            const seen = new Set<string>();
            for (const items of Array.from(itemsByColumn.values()) as any[]) {
                for (const it of (items || [])) {
                    if (it?.itemType && it.itemType !== 'appointment') continue;
                    if (!it?.id || it.isSecondary || seen.has(it.id)) continue;
                    seen.add(it.id);
                    all.push(it);
                }
            }
        }
        for (const it of all) {
            const key = it.groupBookingId
                ? `party:${it.groupBookingId}`
                : it.multiProviderGroupId
                ? `chain:${it.multiProviderGroupId}`
                : null;
            if (!key) continue;
            const g = groups.get(key) || { kind: (it.groupBookingId ? 'party' : 'chain') as 'party' | 'chain', ids: [] };
            g.ids.push(it.id);
            groups.set(key, g);
        }
        // Order within a visit is chronological, so "2 of 3" means the second
        // thing that happens — not the second row Firestore handed back.
        const byId = new Map(all.map((it) => [it.id, it]));
        const out = new Map<string, { kind: 'party' | 'chain'; position: number; total: number; label: string }>();
        for (const g of groups.values()) {
            if (g.ids.length < 2) continue;
            const ordered = [...g.ids].sort((a, b) => {
                const av = safeDate(byId.get(a)?.startTime).getTime();
                const bv = safeDate(byId.get(b)?.startTime).getTime();
                return av - bv;
            });
            ordered.forEach((id, i) => {
                out.set(id, {
                    kind: g.kind,
                    position: i + 1,
                    total: ordered.length,
                    label: g.kind === 'party'
                        ? `Party of ${ordered.length} · guest ${i + 1}`
                        : `One visit · stop ${i + 1} of ${ordered.length}`,
                });
            });
        }
        return out;
    }, [itemsByColumn]);

    const renderAppointment = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const startTime = safeDate(item.startTime);
        const endTime = safeDate(item.endTime);

        // A walk-in is not a booked reservation and must not be measured like one.
        // Both writers of a walk-in's card (/api/walkins and the Terminal's
        // assign-by-hand) already bake the pad minutes INTO endTime, and its start
        // is literally "now". See the pad maths below for why that matters.
        const isWalkIn = item.isWalkIn === true
            || item.source === 'walk-in'
            || String(item.id || '').startsWith('apt-walkin-');

        let service: any = (services || []).find(s => s.id === item.serviceId);
        // Same rescue the client gets on the next line. A walk-in for a service
        // that was renamed, archived, or never resolved used to return null here,
        // so the card VANISHED from the planner — the guest was in the building,
        // sitting in a chair, and invisible to whoever was running the floor.
        // Better a card that says "Service" than no card at all.
        if (!service) {
            const mins = Math.max(15, differenceInMinutes(endTime, startTime) || Number(item.estimatedDuration) || 30);
            service = {
                id: item.serviceId || `unknown-${item.id}`,
                name: item.serviceName || 'Service',
                duration: mins, price: 0, category: '', description: '',
                padBefore: 0, padAfter: 0, isActive: true,
            } as any;
        }
        let client = (clients || []).find(c => c.id === item.clientId);
        if (!client && item.clientName) client = { id: item.clientId, name: item.clientName, email: '', phone: '', avatarUrl: '', lifetimeValue: 0, lastAppointment: '' } as any;
        if (!client) return null;

        // Pads are drawn for a booked appointment because the tech needs setup and
        // turnaround time reserved around it. For a walk-in they are already inside
        // endTime, so adding them again made the card too tall by 2x(pad) AND
        // shifted it UP by padBefore — which is how a guest who checked in at 2:05
        // ended up floating ABOVE the red now-line, looking like a 1:50 booking.
        /* Optional-chained for the same reason as AppointmentCard: `service`
         * is a lookup by id and comes back undefined whenever the service was
         * renamed, deleted, or never matched. Throwing here kills the whole
         * timeline render, which the user experiences as cards that cannot be
         * tapped at all. */
        const padBefore = isWalkIn ? 0 : (service?.padBefore || 0);
        const padAfter = isWalkIn ? 0 : (service?.padAfter || 0);
        const cardStart = subMinutes(startTime, padBefore);
        const minsFromTop = differenceInMinutes(cardStart, dayStart);
        // renderEvent and renderBooking have both had this guard for ages;
        // renderAppointment did not. A bad or missing date produced a negative
        // top and the card was drawn off the top edge of the grid, unreachable.
        if (minsFromTop < 0) return null;
        // Never draw a zero-height card. 10 minutes is the floor, which is still
        // tall enough to click.
        const totalDuration = Math.max(10, differenceInMinutes(endTime, startTime) + padBefore + padAfter);
        const MIN_CARD_PX = 44;
        const top = minsFromTop * PX_PER_MIN;
        const height = Math.max(MIN_CARD_PX, totalDuration * PX_PER_MIN);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.25rem)`, left: item.layout.left };
       
        const group = visitIndex.get(item.id);

        return (
            <div
                key={`${item.id}-${item.isSecondary ? 'sec' : 'pri'}`}
                data-apt-id={item.id}
                className={cn(
                    "absolute pr-1 z-10 overflow-hidden rounded-xl",
                    item.isSecondary && "opacity-80",
                    focusId === item.id && "ring-4 ring-primary/60 z-20",
                )}
                style={style}
                draggable={!!onMoveAppointment && !['completed', 'cancelled', 'declined', 'servicing'].includes(String(item.status))} onDragStart={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); dragRef.current = { id: item.id, appointment: item, grabOffset: e.clientY - rect.top }; try { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; } catch { /* fine */ } }} onDragEnd={() => { dragRef.current = null; setDrag(null); }}
            >
                {group && height > 44 && (
                    <div
                        title={group.label}
                        className={cn(
                            'absolute -top-1 left-1 z-20 pointer-events-none inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] sm:text-[12px] font-semibold  text-white shadow-sm max-w-[calc(100%-0.75rem)]',
                            'bg-foreground/80',
                        )}
                    >
                        {group.kind === 'party' ? <Users className="w-2 h-2 shrink-0" /> : <Link2 className="w-2 h-2 shrink-0" />}
                        <span className="truncate">
                            {group.kind === 'party'
                                ? `Party ${group.position}/${group.total}`
                                : `Visit ${group.position}/${group.total}`}
                        </span>
                    </div>
                )}
                <AppointmentCard
                    appointment={item} client={client} service={service} style={{ height: '100%'}} heightPx={height}
                    edgeColor={colourBy === 'provider' ? PROVIDER_COLOURS[Math.max(0, safeColumns.findIndex((c: any) => c.id === item.staffId)) % PROVIDER_COLOURS.length] : undefined}
                    onUpdateStatus={onUpdateStatus} onDelete={onDeleteAppointment}
                    onCompleteClick={onCompleteClick} onPrintReceipt={onPrintReceipt} onPrintTicket={onPrintTicket}
                    onEdit={onEditAppointment} onReschedule={onReschedule} onRebook={onRebook}
                    onStartService={onStartService} onFinishService={onFinishService}
                    onBookNewForClient={onBookNewForClient} onViewDetails={onViewDetails}
                    onApproveRequest={onApproveRequest} onDeclineRequest={onDeclineRequest}
                    onReportIssue={onReportIssue} canDeclineDirectly={canDeclineDirectly}
                    allServices={services}
                    onResolveIssue={onResolveIssue} canResolveIssues={canResolveIssues}
                    resources={resources} transactions={allTransactions}
                />
            </div>
        );
    };

    const renderEvent = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const startTime = safeDate(item.startTime);
        const endTime = safeDate(item.endTime);
        const mins = differenceInMinutes(startTime, dayStart);
        if (mins < 0) return null;
        const style = { top: `${mins * PX_PER_MIN}px`, height: `${differenceInMinutes(endTime, startTime) * PX_PER_MIN}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        return (
             <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <EventCard event={item} transactions={dailyTransactions?.filter(t => t.relatedEventId === item.id) || []} onChecklistItemToggle={onChecklistItemToggle} onUpdateEvent={onUpdateEvent} onEditEvent={onEditEvent} onAddTransaction={() => {}} onDeleteEvent={onDeleteEvent} />
            </div>
        )
    };

    // Standout card for booth tours & paid reservations on the Studio lane.
    const renderBooking = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const startTime = safeDate(item.startTime);
        const endTime = safeDate(item.endTime);
        const mins = differenceInMinutes(startTime, dayStart);
        if (mins < 0) return null;
        const height = Math.max(30, differenceInMinutes(endTime, startTime) * PX_PER_MIN);
        const style = { top: `${mins * PX_PER_MIN}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        const fmtT = (d: Date) => { try { return format(d, 'h:mma').toLowerCase(); } catch { return ''; } };
        const isTour = item.type === 'tour';
        const live = item.status === 'checked_in';
        const overageDue = item.overageStatus === 'due' || (item.overageDueCents || 0) > 0;
        const balanceDue = (item.balanceDueCents || 0) > 0;
        const med = height > 58;
        const tall = height > 104;
        const scheme = live
            ? { bg: 'bg-emerald-500/[0.07]', border: 'border-emerald-600/50', text: 'text-emerald-900', badge: 'bg-emerald-600' }
            : isTour
            ? { bg: 'bg-white', border: 'border-foreground/30 border-dashed', text: 'text-foreground', badge: 'bg-foreground/70' }
            : { bg: 'bg-white', border: 'border-border', text: 'text-foreground', badge: 'bg-foreground/70' };
        const label = isTour ? 'Tour' : (item.bookingType === 'hourly' ? 'Hourly' : 'Day rental');
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <div className={cn('relative h-full rounded-xl sm:rounded-2xl border overflow-hidden shadow-none transition-colors p-1.5 sm:p-2', scheme.bg, scheme.border)}>
                    {/* A tour opens its LEAD in the pipeline — the place with the
                        approve/confirm/outcome buttons — not the booth hub's old
                        contact drawer, which is being retired. Day rentals still
                        open the hub's contact card until the POS spaces tab grows
                        its own. */}
                    <a
                        href={isTour
                            ? `/pipeline?lead=${encodeURIComponent(String(item.id).replace(/^tour-/, ''))}`
                            : ((item.phone || item.email) ? `/booths?contact=${encodeURIComponent(item.phone || item.email)}` : '/booths')}
                        aria-label={`Open ${label.toLowerCase()} for ${item.guestName || item.name || 'guest'}`}
                        className="absolute inset-0 z-0"
                    />
                    <div className="relative z-10 flex items-center justify-between gap-1 pointer-events-none">
                        <span className={cn('inline-flex items-center gap-0.5 text-[12px] sm:text-[12px] font-semibold  text-white rounded-full px-1.5 py-0.5', scheme.badge)}>
                            {isTour ? <Eye className="w-2 h-2" /> : <DollarSign className="w-2 h-2" />}{label}
                        </span>
                        {live ? (
                            <span className="inline-flex items-center gap-1 text-[12px] sm:text-[12px] text-emerald-800"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" /><LiveTimer startIso={item.checkedInAt} bookedEndIso={item.bookedEndIso} overageRateCentsPerHour={item.overageRateCentsPerHour} /></span>
                        ) : (
                            <span className={cn('text-[12px] sm:text-[12px] font-semibold ', scheme.text)}>{item.tourTimeTBD ? 'Time TBD' : fmtT(startTime)}</span>
                        )}
                    </div>
                    <p className={cn('relative z-10 pointer-events-none font-semibold text-[11px] sm:text-sm tracking-tight truncate mt-0.5', scheme.text)}>{item.guestName || item.name || 'Guest'}</p>
                    {med && <p className="relative z-10 pointer-events-none text-[12px] sm:text-[12px] font-bold text-muted-foreground truncate">{item.boothName || item.location || ''}{!live && !isTour ? ` · ${fmtT(startTime)}–${fmtT(endTime)}` : ''}</p>}
                    {(overageDue || balanceDue) && (
                        <div className="relative z-10 pointer-events-none flex flex-wrap gap-1 mt-1">
                            {overageDue && <span className="text-[12px] font-semibold bg-destructive text-white rounded-full px-1.5 py-0.5">Overage due</span>}
                            {balanceDue && <span className="text-[12px] font-semibold bg-amber-700 text-white rounded-full px-1.5 py-0.5">Balance ${(item.balanceDueCents / 100).toFixed(0)}</span>}
                        </div>
                    )}
                    {tall && item.phone && (
                        <div className="relative z-20 flex gap-1 mt-1.5">
                            <a href={`tel:${item.phone}`} aria-label={`Call ${item.guestName || item.name || 'guest'}`} className="flex-1 inline-flex items-center justify-center gap-1 text-[12px] font-semibold rounded-md bg-white/80 border py-1 active:scale-95"><Phone className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />Call</a>
                            <a href={`sms:${item.phone}`} aria-label={`Text ${item.guestName || item.name || 'guest'}`} className="flex-1 inline-flex items-center justify-center gap-1 text-[12px] font-semibold rounded-md bg-white/80 border py-1 active:scale-95"><MessageSquare className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />Text</a>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    useEffect(() => {
        if (!focusId || !scrollContainerRef.current) return;
        const el = scrollContainerRef.current.querySelector(`[data-apt-id="${focusId}"]`) as HTMLElement | null;
        if (!el) return;
        const top = el.offsetTop - (scrollContainerRef.current.clientHeight / 3);
        scrollContainerRef.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        const timer = setTimeout(() => { if (typeof onFocusSettled === 'function') onFocusSettled(); }, 2200);
        return () => clearTimeout(timer);
    }, [focusId, date, columns, onFocusSettled]);

    useEffect(() => {
        if (isToday(date) && scrollContainerRef.current) {
            const pos = (differenceInMinutes(new Date(), setHours(startOfDay(new Date()), START_HOUR)) * PX_PER_MIN) - (scrollContainerRef.current.clientHeight / 3);
            scrollContainerRef.current.scrollTo({ top: Math.max(0, pos), behavior: 'smooth' });
        }
    }, [date, columns, START_HOUR, PX_PER_MIN]);

    const gridStyle = { gridTemplateColumns: `repeat(${displayedColumns.length}, minmax(${isMobile ? '0' : '280px'}, 1fr))` };

    if (_MISSING_CARDS.length > 0) {
        return (
            <div className="m-4 p-4 rounded-xl border border-red-300 bg-red-50 text-sm text-red-800">
                <p className="font-semibold text-[12px] mb-2">Planner import problem</p>
                {_MISSING_CARDS.map(n => (
                    <p key={n} className="font-semibold">{n} resolved to <code>undefined</code> — that file likely uses <code>export default</code> instead of a named export (or the export name doesn't match).</p>
                ))}
            </div>
        );
    }

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}
             // Phone: swipe left / right to move between providers (one column at a time).
             onTouchStart={(e) => { if (!isMobile) return; const t = e.touches[0]; swipeRef.current = { x: t.clientX, y: t.clientY }; }}
             onTouchEnd={(e) => { if (!isMobile || !swipeRef.current || !onMobileColumnChange || safeColumns.length < 2) return; const t = e.changedTouches[0]; const dx = t.clientX - swipeRef.current.x, dy = t.clientY - swipeRef.current.y; swipeRef.current = null;
               if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; const i = Math.max(0, safeColumns.findIndex((c: any) => c.id === (displayedColumns[0] as any)?.id)); const j = dx < 0 ? Math.min(safeColumns.length - 1, i + 1) : Math.max(0, i - 1); if (j !== i) onMobileColumnChange(safeColumns[j].id); }}>
            <div className="grid grid-cols-[auto,1fr] min-w-max md:min-w-full">
                <button
                    type="button"
                    onClick={() => setShowFullDay(v => !v)}
                    title={showFullDay ? 'Show working hours only' : 'Show the full 24 hours'}
                    aria-label={showFullDay ? 'Show working hours only' : `Show the full 24 hours (${hoursHidden} hidden)`}
                    aria-pressed={showFullDay}
                    className="sticky top-0 left-0 z-30 bg-background/90 backdrop-blur-md h-12 sm:h-16 border-b border-r flex flex-col items-center justify-center gap-0.5 hover:bg-muted transition-colors"
                    style={{ width: isMobile ? '40px' : '64px' }}
                >
                    <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                    {hoursHidden > 0 && !showFullDay && (
                        <span className="text-[12px] font-semibold tabular-nums text-muted-foreground leading-none">+{hoursHidden}</span>
                    )}
                </button>
                <div className="sticky top-0 z-20 grid col-start-2 bg-background/80 backdrop-blur-md" style={gridStyle}>
                    {displayedColumns.map(column => (
                        <div key={column.id} className="p-2 sm:p-3 h-12 sm:h-16 border-b border-r text-center flex items-center justify-center">
                            {isMobile ? (
                                <Select value={mobileSelectedColumnId} onValueChange={onMobileColumnChange}>
                                    <SelectTrigger aria-label="Choose which column to show" className="border-none h-full p-0 focus:ring-0 w-full bg-transparent">
                                        <div className="flex items-center justify-center gap-1.5 h-full w-full">
                                            <SelectValue />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border shadow-2xl">
                                        {safeColumns.map((c: any) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                <div className="flex items-center gap-2">
                                                    {'isBusiness' in c ? <Briefcase className="w-3.5 h-3.5 text-primary" /> : 'role' in c ? <Avatar className="w-5 h-5"><AvatarImage src={(c as Staff).avatarUrl} /><AvatarFallback className="font-semibold text-[12px] bg-primary/10 text-primary">{(c.name || '?').charAt(0)}</AvatarFallback></Avatar> : ((c as Resource).type === 'room' ? <Building className="w-3.5 h-3.5" /> : <HardHat className="w-3.5 h-3.5" />)}
                                                    <span className="font-semibold text-[12px]">{c.name || 'Unnamed'}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="flex items-center justify-center gap-3 h-full">
                                    {'isBusiness' in column ? (
                                        <Briefcase className="w-5 h-5 text-primary" />
                                    ) : 'role' in column ? (
                                        <Avatar className="w-9 h-9 border border-background shadow-md rounded-xl">
                                            <AvatarImage src={(column as Staff).avatarUrl} className="object-cover" />
                                            <AvatarFallback className="font-semibold text-xs bg-primary/10 text-primary">{(column.name || '?').charAt(0)}</AvatarFallback>
                                        </Avatar>
                                    ) : (
                                        (column as Resource).type === 'room' ? <Building className="w-5 h-5 text-muted-foreground" /> : <HardHat className="w-5 h-5 text-muted-foreground" />
                                    )}
                                    <p className="font-semibold tracking-tight text-xs truncate max-w-[180px]">{column.name || 'Unnamed'}</p>
                                    {'role' in column && (() => { const its = (positionedItemsByColumn.get(column.id) || []).filter((it: any) => it.itemType !== 'bill' && it.itemType !== 'block' && it.itemType !== 'event'); const live = its.find((it: any) => it.status === 'servicing');
                                        const over = live?.actualStartTime ? Math.max(0, differenceInMinutes(new Date(), safeDate(live.actualStartTime)) - (Number(services?.find((sv: any) => sv.id === live.serviceId)?.duration) || 0)) : 0;
                                        return <p className="text-[12px] truncate" style={{ color: over > 0 ? 'var(--warn, #b45309)' : 'var(--muted, #6b635c)' }}>{its.length} visit{its.length === 1 ? '' : 's'}{over > 0 ? ` · ${over} min behind` : live ? ' · on time' : ''}</p>; })()}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-10" : "w-16")}>
                    {hours.map(hour => (
                        <div key={hour} className="border-r border-b border-border text-right pr-1.5 sm:pr-3 pt-1 flex justify-end items-start" style={{ height: `${PX_PER_HOUR}px` }}>
                            <span className="text-[12px] font-semibold text-muted-foreground -mt-2 sm:-mt-2.5 opacity-60">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                        </div>
                    ))}
                </div>
                <div className="col-start-2 grid relative bg-white/30" style={gridStyle}>
                    {displayedColumns.map(column => (
                        <div key={column.id} className="relative border-r border-border"
                             onDragOver={(e) => { if (!dragRef.current || !onMoveAppointment) return; e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); const y = e.clientY - rect.top - (dragRef.current.grabOffset || 0); const mins = Math.max(0, Math.round((y / PX_PER_MIN) / 5) * 5); setDrag({ id: dragRef.current.id, mins, columnId: column.id, top: mins * PX_PER_MIN }); }}
                             onDrop={(e) => { if (!dragRef.current || !onMoveAppointment || !drag) return; e.preventDefault(); const start = setHours(startOfDay(date), START_HOUR); const when = new Date(start.getTime() + drag.mins * 60000); onMoveAppointment(dragRef.current.appointment, column.id, format(when, 'HH:mm')); dragRef.current = null; setDrag(null); }}>
                            {/* Outside the provider's hours: dimmed, so the day reads at a glance. */}
                            {(() => { const h = hoursFor(column); if (!h) return null; const s0 = START_HOUR * 60, e0 = END_HOUR * 60; const dim = 'absolute left-0 right-0 z-[1] pointer-events-none bg-stone-900/[0.04]';
                                return <>{h.start > s0 && <div className={dim} style={{ top: 0, height: `${(h.start - s0) * PX_PER_MIN}px` }} />}{h.end < e0 && <div className={dim} style={{ top: `${(h.end - s0) * PX_PER_MIN}px`, height: `${(e0 - h.end) * PX_PER_MIN}px` }} />}</>; })()}
                            {/* Gaps inside working hours (20 min or more) are things, not blank space. */}
                            {onBookAt && 'role' in column && (() => { const h = hoursFor(column); if (!h) return null; const s0 = START_HOUR * 60;
                                const busy = (positionedItemsByColumn.get(column.id) || []).filter((it: any) => it.itemType !== 'bill').map((it: any) => { const a = safeDate(it.startTime), b = safeDate(it.endTime); return [differenceInMinutes(a, startOfDay(date)), differenceInMinutes(b, startOfDay(date))]; }).sort((x: number[], y: number[]) => x[0] - y[0]);
                                const nowMin = isToday(date) ? differenceInMinutes(new Date(), startOfDay(new Date())) : -1; const gaps: number[][] = []; let cursor = Math.max(h.start, nowMin > 0 ? Math.ceil(nowMin / 5) * 5 : h.start);
                                for (const [a, b] of busy) { if (a - cursor >= 20) gaps.push([cursor, a]); cursor = Math.max(cursor, b); } if (h.end - cursor >= 20) gaps.push([cursor, h.end]);
                                return gaps.map(([a, b]) => { const when = new Date(startOfDay(date).getTime() + a * 60000); const top = (a - s0) * PX_PER_MIN + 2, h = Math.max(22, (b - a) * PX_PER_MIN - 4);
                                    return (<div key={`gap-${a}`} className="absolute left-1 right-1 z-[4] flex items-center justify-between gap-2 rounded-lg border border-dashed px-2 text-[12px]" style={{ top: `${top}px`, height: `${h}px`, borderColor: 'var(--line, #e7e2dc)', color: 'var(--muted, #6b635c)' }}>
                                        <span>{b - a} min open</span>
                                        <span className="flex gap-2">{onBlockAt && <button type="button" onClick={() => onBlockAt(column.id, when, b - a)} className="font-semibold underline-offset-2 hover:underline" aria-label={`Block ${b - a} minutes at ${format(when, 'h:mm a')}`}>Block</button>}
                                        <button type="button" onClick={() => onBookAt(column.id, when)} className="font-semibold" style={{ color: 'var(--accent)' }} aria-label={`${b - a} minute gap at ${format(when, 'h:mm a')} — book here`}>Book here</button></span>
                                    </div>); }); })()}
                            {/* Where a dragged card would land. */}
                            {drag && drag.columnId === column.id && (() => { const a = dragRef.current?.appointment; const len = a ? Math.max(15, differenceInMinutes(safeDate(a.endTime), safeDate(a.startTime))) : 30;
                                return <div className="absolute left-1 right-1 z-[30] rounded-lg border-2 border-dashed px-2 py-1 text-[12px] font-semibold pointer-events-none" style={{ top: `${drag.top}px`, height: `${len * PX_PER_MIN}px`, borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', color: 'var(--accent)' }}>{format(new Date(setHours(startOfDay(date), START_HOUR).getTime() + drag.mins * 60000), 'h:mm a')}</div>; })()}
                            {hours.map(hour => (
                                <div key={hour} className="border-b border-border" style={{ height: `${PX_PER_HOUR}px` }}>
                                    <div className="h-1/2 border-b border-dashed border-border/50" />
                                </div>
                            ))}
                            {(positionedItemsByColumn.get(column.id) || []).map(item => {
                                if (item.itemType === 'bill') return renderBill(item);
                                if (item.itemType === 'block') {
                                    const startTime = safeDate(item.startTime);
                                    const endTime = safeDate(item.endTime);
                                    const mins = differenceInMinutes(startTime, setHours(startOfDay(startTime), START_HOUR));
                                    const height = Math.max(22, differenceInMinutes(endTime, startTime) * PX_PER_MIN);
                                    const style = { top: `${mins * PX_PER_MIN}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
                                    return (
                                        <div key={item.id} style={style} title={`${item.reason || 'Blocked'} · ${item.source === 'renter_portal' ? 'set by the renter' : 'blocked'}`}
                                             className="absolute z-[5] overflow-hidden rounded-lg border border-slate-300 bg-slate-50/90 px-2 py-1 text-left">
                                            <p className="truncate text-[12px] font-semibold text-slate-500">{item.reason || 'Blocked'}</p>
                                            {height > 34 && <p className="truncate text-[12px] font-bold text-slate-400">{item.source === 'renter_portal' ? 'Set by renter' : 'Not bookable'}</p>}
                                        </div>
                                    );
                                }
                                if (item.itemType === 'event') {
                                    if (item.type === 'tour' || item.type === 'reservation') return renderBooking(item);
                                    return renderEvent(item);
                                }
                                return renderAppointment(item);
                            })}
                        </div>
                    ))}
                    {isToday(date) && (
                        <div 
                            className="absolute w-full flex items-center z-20 pointer-events-none" 
                            style={{ top: `${(differenceInMinutes(new Date(), setHours(startOfDay(new Date()), START_HOUR)) * PX_PER_MIN)}px` }}
                        >
                            <span className="-ml-1 shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums leading-none text-white shadow-[0_0_12px_rgba(239,68,68,0.45)]">{format(new Date(), 'h:mm')}</span>
                            <div className="h-0.5 w-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]"></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
