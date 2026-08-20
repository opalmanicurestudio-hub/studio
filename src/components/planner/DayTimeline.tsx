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
        return <span className="tabular-nums font-black text-destructive">OVER +{fmt(now - endMs)}{est > 0 ? ` · ~$${(est / 100).toFixed(0)}` : ''}</span>;
    }
    return <span className="tabular-nums font-black">{fmt(now - start)}</span>;
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
}: any) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const safeColumns = columns || [];
    const [showFullDay, setShowFullDay] = useState(false);

    const PX_PER_HOUR = isMobile ? 96 : 160;
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

    const START_HOUR = showFullDay ? 0 : dayWindow.start;
    const END_HOUR = showFullDay ? 24 : dayWindow.end;
    const hours = useMemo(
        () => Array.from({ length: Math.max(1, END_HOUR - START_HOUR) }, (_, i) => START_HOUR + i),
        [START_HOUR, END_HOUR],
    );
    const hoursHidden = 24 - (END_HOUR - START_HOUR);

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
                <Card className="h-full border-2 border-amber-600/40 bg-amber-500/[0.07] hover:bg-amber-500/[0.12] transition-colors cursor-pointer overflow-hidden shadow-none rounded-xl sm:rounded-2xl">
                    <CardContent className="p-2 sm:p-3 flex flex-col justify-center h-full gap-0.5 sm:gap-1 text-left">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                            <Landmark className="w-3 h-3 sm:w-4 sm:h-4 text-amber-700" />
                            <p className="text-[8px] sm:text-[10px] font-black uppercase text-amber-800 tracking-widest truncate">{item.definition?.name || 'Bill'}</p>
                        </div>
                        <p className="font-black text-sm sm:text-lg text-amber-900 tracking-tighter">${item.definition?.amount?.toFixed(2) || '0.00'}</p>
                        <Badge variant="outline" className="w-fit h-4 sm:h-5 px-1 sm:px-1.5 text-[8px] sm:text-[9px] border-amber-600/30 text-amber-800 uppercase font-black">Due Today</Badge>
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
            >
                {group && height > 44 && (
                    <div
                        title={group.label}
                        className={cn(
                            'absolute -top-1 left-1 z-20 pointer-events-none inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] sm:text-[8px] font-black uppercase tracking-widest text-white shadow-sm max-w-[calc(100%-0.75rem)]',
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
                    onUpdateStatus={onUpdateStatus} onDelete={onDeleteAppointment}
                    onCompleteClick={onCompleteClick} onPrintReceipt={onPrintReceipt} onPrintTicket={onPrintTicket}
                    onEdit={onEditAppointment} onReschedule={onReschedule} onRebook={onRebook}
                    onStartService={onStartService} onFinishService={onFinishService}
                    onBookNewForClient={onBookNewForClient} onViewDetails={onViewDetails}
                    onApproveRequest={onApproveRequest} onDeclineRequest={onDeclineRequest}
                    onReportIssue={onReportIssue} canDeclineDirectly={canDeclineDirectly}
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
                <div className={cn('relative h-full rounded-xl sm:rounded-2xl border-2 overflow-hidden shadow-none transition-colors p-1.5 sm:p-2', scheme.bg, scheme.border)}>
                    <a
                        href={(item.phone || item.email) ? `/booths?contact=${encodeURIComponent(item.phone || item.email)}` : '/booths'}
                        aria-label={`Open ${label.toLowerCase()} for ${item.guestName || item.name || 'guest'}`}
                        className="absolute inset-0 z-0"
                    />
                    <div className="relative z-10 flex items-center justify-between gap-1 pointer-events-none">
                        <span className={cn('inline-flex items-center gap-0.5 text-[8px] sm:text-[8px] font-black uppercase tracking-widest text-white rounded-full px-1.5 py-0.5', scheme.badge)}>
                            {isTour ? <Eye className="w-2 h-2" /> : <DollarSign className="w-2 h-2" />}{label}
                        </span>
                        {live ? (
                            <span className="inline-flex items-center gap-1 text-[8px] sm:text-[9px] text-emerald-800"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" /><LiveTimer startIso={item.checkedInAt} bookedEndIso={item.bookedEndIso} overageRateCentsPerHour={item.overageRateCentsPerHour} /></span>
                        ) : (
                            <span className={cn('text-[8px] sm:text-[8px] font-black uppercase tracking-widest', scheme.text)}>{item.tourTimeTBD ? 'Time TBD' : fmtT(startTime)}</span>
                        )}
                    </div>
                    <p className={cn('relative z-10 pointer-events-none font-black text-[11px] sm:text-sm tracking-tight truncate mt-0.5', scheme.text)}>{item.guestName || item.name || 'Guest'}</p>
                    {med && <p className="relative z-10 pointer-events-none text-[8px] sm:text-[10px] font-bold text-muted-foreground truncate">{item.boothName || item.location || ''}{!live && !isTour ? ` · ${fmtT(startTime)}–${fmtT(endTime)}` : ''}</p>}
                    {(overageDue || balanceDue) && (
                        <div className="relative z-10 pointer-events-none flex flex-wrap gap-1 mt-1">
                            {overageDue && <span className="text-[8px] font-black uppercase tracking-widest bg-destructive text-white rounded-full px-1.5 py-0.5">Overage due</span>}
                            {balanceDue && <span className="text-[8px] font-black uppercase tracking-widest bg-amber-700 text-white rounded-full px-1.5 py-0.5">Balance ${(item.balanceDueCents / 100).toFixed(0)}</span>}
                        </div>
                    )}
                    {tall && item.phone && (
                        <div className="relative z-20 flex gap-1 mt-1.5">
                            <a href={`tel:${item.phone}`} aria-label={`Call ${item.guestName || item.name || 'guest'}`} className="flex-1 inline-flex items-center justify-center gap-1 text-[8px] font-black uppercase tracking-widest rounded-md bg-white/80 border py-1 active:scale-95"><Phone className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />Call</a>
                            <a href={`sms:${item.phone}`} aria-label={`Text ${item.guestName || item.name || 'guest'}`} className="flex-1 inline-flex items-center justify-center gap-1 text-[8px] font-black uppercase tracking-widest rounded-md bg-white/80 border py-1 active:scale-95"><MessageSquare className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />Text</a>
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
            <div className="m-4 p-4 rounded-xl border-2 border-red-300 bg-red-50 text-sm text-red-800">
                <p className="font-black uppercase tracking-widest text-[10px] mb-2">Planner import problem</p>
                {_MISSING_CARDS.map(n => (
                    <p key={n} className="font-semibold">{n} resolved to <code>undefined</code> — that file likely uses <code>export default</code> instead of a named export (or the export name doesn't match).</p>
                ))}
            </div>
        );
    }

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}>
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
                        <span className="text-[8px] font-black tabular-nums text-muted-foreground leading-none">+{hoursHidden}</span>
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
                                    <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                        {safeColumns.map((c: any) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                <div className="flex items-center gap-2">
                                                    {'isBusiness' in c ? <Briefcase className="w-3.5 h-3.5 text-primary" /> : 'role' in c ? <Avatar className="w-5 h-5"><AvatarImage src={(c as Staff).avatarUrl} /><AvatarFallback className="font-black text-[8px] bg-primary/10 text-primary">{(c.name || '?').charAt(0)}</AvatarFallback></Avatar> : ((c as Resource).type === 'room' ? <Building className="w-3.5 h-3.5" /> : <HardHat className="w-3.5 h-3.5" />)}
                                                    <span className="font-black uppercase text-[9px] tracking-widest">{c.name || 'Unnamed'}</span>
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
                                        <Avatar className="w-9 h-9 border-2 border-background shadow-md rounded-xl">
                                            <AvatarImage src={(column as Staff).avatarUrl} className="object-cover" />
                                            <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(column.name || '?').charAt(0)}</AvatarFallback>
                                        </Avatar>
                                    ) : (
                                        (column as Resource).type === 'room' ? <Building className="w-5 h-5 text-muted-foreground" /> : <HardHat className="w-5 h-5 text-muted-foreground" />
                                    )}
                                    <p className="font-black uppercase tracking-tight text-xs truncate max-w-[180px]">{column.name || 'Unnamed'}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-10" : "w-16")}>
                    {hours.map(hour => (
                        <div key={hour} className="border-r border-b border-border text-right pr-1.5 sm:pr-3 pt-1 flex justify-end items-start" style={{ height: `${PX_PER_HOUR}px` }}>
                            <span className="text-[10px] font-black uppercase text-muted-foreground -mt-2 sm:-mt-2.5 opacity-60 tracking-widest">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                        </div>
                    ))}
                </div>
                <div className="col-start-2 grid relative bg-white/30" style={gridStyle}>
                    {displayedColumns.map(column => (
                        <div key={column.id} className="relative border-r border-border">
                            {hours.map(hour => (
                                <div key={hour} className="border-b border-border" style={{ height: `${PX_PER_HOUR}px` }}>
                                    <div className="h-1/2 border-b border-dashed border-border/50" />
                                </div>
                            ))}
                            {(positionedItemsByColumn.get(column.id) || []).map(item => {
                                if (item.itemType === 'bill') return renderBill(item);
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
                            <span className="-ml-1 shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black tabular-nums leading-none text-white shadow-[0_0_12px_rgba(239,68,68,0.45)]">{format(new Date(), 'h:mm')}</span>
                            <div className="h-0.5 w-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]"></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
