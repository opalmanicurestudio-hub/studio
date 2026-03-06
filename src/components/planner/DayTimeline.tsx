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
import { Building, HardHat, Lock, Users, Landmark, Briefcase } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '@/components/ui/badge';

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
    const START_HOUR = 0;
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const displayedColumns = useMemo(() => {
        if (!isMobile) return columns;
        const selected = columns.find((c:any) => c.id === mobileSelectedColumnId);
        return selected ? [selected] : (columns.length > 0 ? [columns[0]] : []);
    }, [isMobile, columns, mobileSelectedColumnId]);

    const positionedItemsByColumn = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!itemsByColumn) return map;
        
        for (const column of columns) {
            const columnId = column.id;
            const items = itemsByColumn.get(columnId) || [];
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
                const end = safeDate(item.endTime || (item.itemType === 'bill' ? addMinutes(start, 60) : item.endTime));
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
    }, [itemsByColumn, columns]);

    const renderBill = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const dueDate = safeDate(item.dueDate);
        const top = differenceInMinutes(dueDate, dayStart) * (160/60);
        const height = 60 * (160/60);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <Card className="h-full border-2 sm:border-4 border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 transition-all cursor-pointer overflow-hidden shadow-xl rounded-xl sm:rounded-2xl">
                    <CardContent className="p-2 sm:p-3 flex flex-col justify-center h-full gap-0.5 sm:gap-1 text-left">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                            <Landmark className="w-3 h-3 sm:w-4 sm:h-4 text-orange-600" />
                            <p className="text-[8px] sm:text-[10px] font-black uppercase text-orange-700 tracking-widest truncate">{item.definition?.name || 'Bill'}</p>
                        </div>
                        <p className="font-black text-sm sm:text-lg text-orange-800 tracking-tighter">${item.definition?.amount?.toFixed(2) || '0.00'}</p>
                        <Badge variant="outline" className="w-fit h-4 sm:h-5 px-1 sm:px-1.5 text-[7px] sm:text-[9px] border-orange-500/20 text-orange-600 uppercase font-black">Due Today</Badge>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const renderAppointment = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const service = (services || []).find(s => s.id === item.serviceId);
        let client = (clients || []).find(c => c.id === item.clientId);
        if (!client && item.clientName) client = { id: item.clientId, name: item.clientName, email: '', phone: '', avatarUrl: '', lifetimeValue: 0, lastAppointment: '' } as any;
        if (!client || !service) return null;

        const startTime = safeDate(item.startTime);
        const endTime = safeDate(item.endTime);
        const padBefore = service.padBefore || 0;
        const totalDuration = differenceInMinutes(endTime, startTime) + padBefore + (service.padAfter || 0);
        const top = differenceInMinutes(subMinutes(startTime, padBefore), dayStart) * (160/60);
        const height = totalDuration * (160/60);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.25rem)`, left: item.layout.left };
       
        return (
            <div key={`${item.id}-${item.isSecondary ? 'sec' : 'pri'}`} className={cn("absolute pr-1 z-10", item.isSecondary && "opacity-80")} style={style}>
                <AppointmentCard
                    appointment={item} client={client} service={service} style={{ height: '100%'}}
                    onUpdateStatus={onUpdateStatus} onDelete={onDeleteAppointment}
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
        const startTime = safeDate(item.startTime);
        const endTime = safeDate(item.endTime);
        const mins = differenceInMinutes(startTime, dayStart);
        if (mins < 0) return null;
        const style = { top: `${mins * (160/60)}px`, height: `${differenceInMinutes(endTime, startTime) * (160/60)}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
        return (
             <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <EventCard event={item} transactions={dailyTransactions?.filter(t => t.relatedEventId === item.id) || []} onChecklistItemToggle={onChecklistItemToggle} onUpdateEvent={onUpdateEvent} onEditEvent={onEditEvent} onAddTransaction={() => {}} onDeleteEvent={onDeleteEvent} />
            </div>
        )
    };

    useEffect(() => {
        if (isToday(date) && scrollContainerRef.current) {
            const pos = (differenceInMinutes(new Date(), startOfDay(new Date())) * (160/60)) - (scrollContainerRef.current.clientHeight / 4);
            scrollContainerRef.current.scrollTo({ top: Math.max(0, pos), behavior: 'smooth' });
        }
    }, [date, columns]);

    const gridStyle = { gridTemplateColumns: `repeat(${displayedColumns.length}, minmax(${isMobile ? '0' : '280px'}, 1fr))` };

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}>
            <div className="grid grid-cols-[auto,1fr] min-w-max md:min-w-full">
                <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md h-12 sm:h-16 border-b border-r" style={{ width: isMobile ? '32px' : '64px' }} />
                <div className="sticky top-0 z-20 grid col-start-2 bg-background/80 backdrop-blur-md" style={gridStyle}>
                    {displayedColumns.map(column => (
                        <div key={column.id} className="p-2 sm:p-3 h-12 sm:h-16 border-b border-r text-center flex items-center justify-center">
                            {isMobile ? (
                                <Select value={mobileSelectedColumnId} onValueChange={onMobileColumnChange}>
                                    <SelectTrigger className="border-none h-full p-0 focus:ring-0 w-full bg-transparent">
                                        <div className="flex items-center justify-center gap-1.5 h-full w-full">
                                            <SelectValue />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                        {columns.map(c => (
                                            <SelectItem key={c.id} value={c.id}>
                                                <div className="flex items-center gap-2">
                                                    {'isBusiness' in c ? <Briefcase className="w-3.5 h-3.5 text-primary" /> : 'role' in c ? <Avatar className="w-5 h-5"><AvatarImage src={(c as Staff).avatarUrl} /><AvatarFallback className="font-black text-[7px] bg-primary/10 text-primary">{c.name.charAt(0)}</AvatarFallback></Avatar> : ((c as Resource).type === 'room' ? <Building className="w-3.5 h-3.5" /> : <HardHat className="w-3.5 h-3.5" />)}
                                                    <span className="font-black uppercase text-[9px] tracking-widest">{c.name}</span>
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
                                            <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{column.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                    ) : (
                                        (column as Resource).type === 'room' ? <Building className="w-5 h-5 text-muted-foreground" /> : <HardHat className="w-5 h-5 text-muted-foreground" />
                                    )}
                                    <p className="font-black uppercase tracking-tight text-xs truncate max-w-[180px]">{column.name}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-8" : "w-16")}>
                    {hours.map(hour => (<div key={hour} className="h-40 border-r border-b text-right pr-1.5 sm:pr-3 pt-1 flex justify-end items-start"><span className="text-[7px] sm:text-[10px] font-black uppercase text-muted-foreground -mt-2 sm:-mt-2.5 opacity-40 tracking-widest">{format(new Date(0, 0, 0, hour), 'ha')}</span></div>))}
                </div>
                <div className="col-start-2 grid relative bg-white/30" style={gridStyle}>
                    {displayedColumns.map(column => (
                        <div key={column.id} className="relative border-r border-slate-200">
                            {hours.map(hour => (<div key={hour} className="h-40 border-b border-dashed border-slate-100" />))}
                            {(positionedItemsByColumn.get(column.id) || []).map(item => {
                                if (item.itemType === 'bill') return renderBill(item);
                                if (item.itemType === 'event') return renderEvent(item);
                                return renderAppointment(item);
                            })}
                        </div>
                    ))}
                    {isToday(date) && (
                        <div 
                            className="absolute w-full flex items-center z-20 pointer-events-none" 
                            style={{ top: `${(differenceInMinutes(new Date(), startOfDay(new Date())) * (160 / 60))}px` }}
                        >
                            <div className="h-2 w-2 sm:h-3 sm:w-3 rounded-full bg-red-500 -ml-1 sm:-ml-1.5 border-2 sm:border-4 border-white shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>
                            <div className="h-0.5 w-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]"></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
