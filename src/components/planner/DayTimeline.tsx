'use client';

import { format, differenceInMinutes, isSameDay, isToday, subMinutes, areIntervalsOverlapping, setHours, startOfDay } from 'date-fns';
import { type Staff, type Appointment, type Service, type Resource, type Event } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { type ReceiptData } from './PrintReceipt';
import { type TicketData } from './PrintTicket';
import { EventCard } from '@/components/planner/EventCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Building, HardHat, Lock } from 'lucide-react';

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
    onAddTransaction,
    onReschedule,
    onRebook,
    onStartService,
    onFinishService,
    onBookNewForClient,
    onDeleteEvent,
    onViewDetails,
    walkIns,
    clients,
    services,
    resources,
    isMobile,
    activeView,
    allStaff,
    mobileSelectedStaffId,
    onMobileStaffChange,
}: { 
    date: Date; 
    columns: (Staff | Resource)[];
    itemsByColumn: Map<string, (Appointment | Event)[]>;
    showColumnHeader: boolean;
    onCompleteClick: (apt: Appointment) => void; 
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void; 
    onDeleteAppointment: (appointmentId: string) => void; 
    onPrintReceipt: (data: Omit<ReceiptData, 'business'>) => void; 
    onPrintTicket: (data: Omit<TicketData, 'business'>) => void;
    onEditAppointment: (appointment: Appointment) => void; 
    onEditEvent: (event: Event) => void;
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    dailyTransactions: Transaction[] | null;
    allTransactions: Transaction[];
    onAddTransaction: (transaction: any) => void;
    onReschedule: (appointment: Appointment) => void;
    onRebook: (appointment: Appointment) => void;
    onStartService: (appointmentId: string) => void;
    onFinishService: (appointment: Appointment) => void;
    onBookNewForClient: (clientId: string) => void;
    onDeleteEvent: (eventId: string) => void;
    onViewDetails: (appointment: Appointment) => void;
    walkIns: any[] | null;
    clients: any[] | null;
    services: Service[] | null;
    resources: Resource[];
    isMobile: boolean;
    activeView: 'staff' | 'resources';
    allStaff: Staff[];
    mobileSelectedStaffId: string;
    onMobileStaffChange: (id: string) => void;
}) => {
    const START_HOUR = 0;
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const [tmhr, setTmhr] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
      }
    }, []);

    const positionedItemsByColumn = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!itemsByColumn) return map;
        for (const [columnId, items] of itemsByColumn.entries()) {
            let layoutInfo = items.map(item => ({ ...item, layout: { cols: 0, col: 0 } }));
            function positionCluster(cluster: any[]) {
                cluster.sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                const columns: any[][] = [];
                for(const item of cluster) {
                    let placed = false;
                    for (let i = 0; i < columns.length; i++) {
                        if (!columns[i].some(ex => areIntervalsOverlapping({ start: item.startTime, end: item.endTime }, { start: ex.startTime, end: ex.endTime }, { inclusive: false }))) {
                            columns[i].push(item); item.layout.col = i; placed = true; break;
                        }
                    }
                    if (!placed) { columns.push([item]); item.layout.col = columns.length - 1; }
                }
                cluster.forEach(item => item.layout.cols = columns.length);
            }
            let lastEventEnd: Date | null = null;
            let currentCluster: any[] = [];
            for (const item of layoutInfo) {
                if (lastEventEnd !== null && item.startTime >= lastEventEnd) { positionCluster(currentCluster); currentCluster = []; }
                currentCluster.push(item);
                lastEventEnd = new Date(Math.max(lastEventEnd?.getTime() || 0, item.endTime.getTime()));
            }
            if (currentCluster.length > 0) positionCluster(currentCluster);
            map.set(columnId, layoutInfo.map(item => ({ ...item, layout: { width: `${100 / item.layout.cols}%`, left: `${(100 / item.layout.cols) * item.layout.col}%` } })));
        }
        return map;
    }, [itemsByColumn]);

    const renderAppointment = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const service = (services || []).find(s => s.id === item.serviceId);
        let client = (clients || []).find(c => c.id === item.clientId);
        if (!client && item.clientName) client = { id: item.clientId, name: item.clientName, email: '', phone: '', avatarUrl: '', lifetimeValue: 0, lastAppointment: '' };
        if (!client || !service) return null;

        const padBefore = service.padBefore || 0;
        const totalDuration = differenceInMinutes(item.endTime, item.startTime) + padBefore + (service.padAfter || 0);
        const top = differenceInMinutes(subMinutes(item.startTime, padBefore), dayStart) * (160/60);
        const height = totalDuration * (160/60);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
       
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <AppointmentCard
                    appointment={item} client={client} service={service} style={{ height: '100%'}}
                    tmhr={tmhr} onUpdateStatus={onUpdateStatus} onDelete={onDeleteAppointment}
                    onCompleteClick={onCompleteClick} onPrintReceipt={onPrintReceipt} onPrintTicket={onPrintTicket}
                    onEdit={onEditAppointment} onReschedule={onReschedule} onRebook={onRebook}
                    onStartService={onStartService} onFinishService={onFinishService}
                    onBookNewForClient={onBookNewForClient} onViewDetails={onViewDetails}
                    resources={resources} transactions={allTransactions}
                />
            </div>
        );
    };

    const renderEvent = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const mins = differenceInMinutes(item.startTime, dayStart);
        if (mins < 0) return null;
        const style = { top: `${mins * (160/60)}px`, height: `${differenceInMinutes(item.endTime, item.startTime) * (160/60)}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        return (
             <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <EventCard event={item} transactions={dailyTransactions?.filter(t => t.relatedEventId === item.id) || []} onChecklistItemToggle={onChecklistItemToggle} onUpdateEvent={onUpdateEvent} onEditEvent={onEditEvent} onAddTransaction={onAddTransaction} onDeleteEvent={onDeleteEvent} />
            </div>
        )
    };

    useEffect(() => {
        if (isToday(date) && scrollContainerRef.current) {
            const pos = (differenceInMinutes(new Date(), startOfDay(new Date())) * (160/60)) - (scrollContainerRef.current.clientHeight / 4);
            scrollContainerRef.current.scrollTo({ top: Math.max(0, pos), behavior: 'smooth' });
        }
    }, [date, columns]);

    const gridStyle = { gridTemplateColumns: `repeat(${columns.length}, minmax(${isMobile ? '0' : '250px'}, 1fr))` };

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}>
            <div className="grid grid-cols-[auto,1fr] min-w-max">
                <div className="sticky top-0 z-30 bg-background h-14 border-b border-r" style={{ width: isMobile ? '40px' : '48px' }} />
                <div className="sticky top-0 z-20 grid col-start-2 bg-background" style={gridStyle}>
                    {columns.map(column => (
                        <div key={column.id} className="p-2 h-14 border-b border-r text-center flex items-center justify-center">
                            {isMobile && activeView === 'staff' ? (
                                <Select value={mobileSelectedStaffId} onValueChange={onMobileStaffChange}>
                                    <SelectTrigger className="border-none h-auto p-0 focus:ring-0 w-full bg-transparent"><SelectValue asChild><div className="flex items-center justify-center gap-2 h-full w-full"><Avatar className="w-8 h-8"><AvatarImage src={(column as Staff).avatarUrl} /><AvatarFallback>{column.name.charAt(0)}</AvatarFallback></Avatar><div><p className="font-semibold text-base truncate">{column.name}</p></div></div></SelectValue></SelectTrigger>
                                    <SelectContent>{allStaff.map(s => (<SelectItem key={s.id} value={s.id}><div className="flex items-center gap-2"><Avatar className="w-6 h-6"><AvatarImage src={s.avatarUrl} /><AvatarFallback>{s.name.charAt(0)}</AvatarFallback></Avatar><span>{s.name}</span></div></SelectItem>))}</SelectContent>
                                </Select>
                            ) : (
                                <div className="flex items-center justify-center gap-2 h-full">
                                    {'avatarUrl' in column ? <Avatar className="w-8 h-8"><AvatarImage src={(column as Staff).avatarUrl} /><AvatarFallback>{column.name.charAt(0)}</AvatarFallback></Avatar> : ((column as Resource).type === 'room' ? <Building className="w-5 h-5 text-muted-foreground" /> : <HardHat className="w-5 h-5 text-muted-foreground" />)}
                                    <p className="font-semibold text-sm truncate">{column.name}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-10" : "w-12")}>
                    {hours.map(hour => (<div key={hour} className="h-40 border-r border-b text-right pr-2 pt-1 flex justify-end"><span className="text-xs text-muted-foreground -mt-2.5">{format(new Date(0, 0, 0, hour), 'ha')}</span></div>))}
                </div>
                <div className="col-start-2 grid relative" style={gridStyle}>
                    {columns.map(column => (
                        <div key={column.id} className="relative border-r">
                            {hours.map(hour => (<div key={hour} className="h-40 border-b border-dashed" />))}
                            {(positionedItemsByColumn.get(column.id) || []).map(item => (item.itemType === 'appointment' ? renderAppointment(item) : renderEvent(item)))}
                        </div>
                    ))}
                    {isToday(date) && <div className="absolute w-full flex items-center z-20" style={{ top: `${(differenceInMinutes(new Date(), startOfDay(new Date())) * (160 / 60))}px` }}><div className="h-2 w-2 rounded-full bg-red-500 -ml-1"></div><div className="h-px w-full bg-red-500"></div></div>}
                </div>
            </div>
        </div>
    );
};