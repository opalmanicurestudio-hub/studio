

'use client';

import { AppHeaderClient } from '@/components/shared/AppHeaderClient';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode, Globe, Building, HardHat } from 'lucide-react';
import { type Event, type EventChecklistItem, type StockCorrection, type Staff, type Appointment, type AppointmentCheckoutState, type Resource } from '@/lib/data';
import { type Bill, type Transaction, type BillInstance, type BillDefinition } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping, addMonths } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, errorEmitter } from '@/firebase';
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EventCard } from '@/components/planner/EventCard';
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { WalkIn, type Client, type Service } from '@/lib/data';
import { DayTimeline as OriginalDayTimeline } from '@/components/planner/DayTimeline'; // Assuming original is renamed
import { nanoid } from 'nanoid';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';


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
    onAddTransaction,
    onReschedule,
    onRebook,
    onOpenPickingList,
    onStartService,
    onFinishService,
    onBookNewForClient,
    walkIns,
    clients,
    services,
    resources,
    publicScheduleProfile,
}: { 
    date: Date; 
    columns: (Staff | Resource)[];
    itemsByColumn: Map<string, (Appointment | Event)[]>;
    showColumnHeader: boolean;
    onCompleteClick: (apt: Appointment) => void; 
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void; 
    onDeleteAppointment: (appointmentId: string) => void; 
    onPrintReceipt: (data: ReceiptData) => void; 
    onPrintTicket: (data: TicketData) => void;
    onEditAppointment: (appointment: Appointment) => void; 
    onEditEvent: (event: Event) => void;
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    dailyTransactions: Transaction[] | null;
    onAddTransaction: (transaction: any) => void;
    onReschedule: (appointment: Appointment) => void;
    onRebook: (appointment: Appointment) => void;
    onOpenPickingList: () => void;
    onStartService: (appointmentId: string) => void;
    onFinishService: (appointment: Appointment) => void;
    onBookNewForClient: (clientId: string) => void;
    walkIns: WalkIn[] | null;
    clients: Client[] | null;
    services: Service[] | null;
    resources: Resource[];
    publicScheduleProfile: any;
}) => {
    const START_HOUR = 0; // Start at midnight
    const hours = Array.from({ length: 24 - START_HOUR }, (_, i) => i + START_HOUR);
    const [tmhr, setTmhr] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();

    useEffect(() => {
      if (typeof window !== 'undefined') {
        const storedTmhr = localStorage.getItem('tmhr');
        setTmhr(parseFloat(storedTmhr || '50'));
      }
    }, []);

    const positionedItemsByColumn = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!itemsByColumn) {
      return map;
    }
    for (const [columnId, items] of itemsByColumn.entries()) {
        let layoutInfo = items.map(item => ({
            ...item,
            layout: { cols: 0, col: 0 }
        }));
        
        function positionCluster(cluster: any[]) {
            cluster.sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
            
            if (isMobile) {
                for (const item of cluster) {
                    item.layout = { cols: 1, col: 0 };
                }
                return;
            }

            const columns: any[][] = [];
            for(const item of cluster) {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    
                    const hasOverlap = col.some(existingItem => 
                        areIntervalsOverlapping(
                            { start: item.startTime, end: item.endTime },
                            { start: existingItem.startTime, end: existingItem.endTime },
                            { inclusive: false }
                        )
                    );

                    if (!hasOverlap) {
                        col.push(item);
                        item.layout.col = i;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    columns.push([item]);
                    item.layout.col = columns.length - 1;
                }
            }
            for (const item of cluster) {
                item.layout.cols = columns.length;
            }
        }
        
        let lastEventEnd: Date | null = null;
        let currentCluster: any[] = [];
        for (const item of layoutInfo) {
            if (lastEventEnd !== null && item.startTime >= lastEventEnd) {
                positionCluster(currentCluster);
                currentCluster = [];
            }
            currentCluster.push(item);
            lastEventEnd = new Date(Math.max(lastEventEnd?.getTime() || 0, item.endTime.getTime()));
        }

        if (currentCluster.length > 0) {
            positionCluster(currentCluster);
        }
        
        const positionedItems = layoutInfo.map(item => ({
            ...item,
            layout: {
                width: `${100 / item.layout.cols}%`,
                left: `${(100 / item.layout.cols) * item.layout.col}%`,
            }
        }));
        positionedMap.set(columnId, positionedItems);
    }
    return positionedMap;
    }, [itemsByColumn, isMobile]);


    const renderAppointment = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        
        // Find service
        const service = (services || []).find(s => s.id === item.serviceId);
        
        // Try to find full client object
        let client = (clients || []).find(c => c.id === item.clientId);

        // If client object isn't found BUT we have a denormalized name (from a walk-in)
        // create a temporary client object.
        if (!client && item.clientName) {
            client = { 
                id: item.clientId, 
                name: item.clientName, 
                email: '', 
                phone: '', 
                avatarUrl: '', 
                lifetimeValue: 0, 
                lastAppointment: '' 
            };
        }
        
        // If we still don't have a client or a service, we can't render the card.
        if (!client || !service) {
          return null;
        }

        const padBefore = service.padBefore || 0;
        const coreDuration = differenceInMinutes(item.endTime, item.startTime);
        const totalDuration = coreDuration + padBefore + (service.padAfter || 0);
        
        const actualStartTime = subMinutes(item.startTime, padBefore);
        const minutesFromStart = differenceInMinutes(actualStartTime, dayStart);
        
        if (minutesFromStart < 0) return null;

        const top = minutesFromStart * (160/60);
        const height = totalDuration * (160/60);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
       
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style} data-is-event-card="true">
                <AppointmentCard
                    appointment={item}
                    client={client}
                    service={service}
                    style={{ height: '100%'}}
                    tmhr={tmhr}
                    onUpdateStatus={onUpdateStatus}
                    onDelete={onDeleteAppointment}
                    onCompleteClick={onCompleteClick}
                    onPrintReceipt={onPrintReceipt}
                    onPrintTicket={onPrintTicket}
                    onEdit={onEditAppointment}
                    onReschedule={onReschedule}
                    onRebook={onRebook}
                    onStartService={onStartService}
                    onFinishService={onFinishService}
                    onBookNewForClient={onBookNewForClient}
                    resources={resources}
                />
            </div>
        );
    };

    const renderEvent = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const minutesFromStart = differenceInMinutes(item.startTime, dayStart);
        
        if (minutesFromStart < 0) return null;

        const duration = differenceInMinutes(item.endTime, item.startTime);
        const height = duration * (160/60);
        const top = minutesFromStart * (160/60);

        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };

        const eventTransactions = dailyTransactions?.filter(t => t.relatedEventId === item.id) || [];

        return (
             <div key={item.id} className="absolute pr-2 z-10" style={style} data-is-event-card="true">
                <EventCard
                    event={item}
                    transactions={eventTransactions}
                    onChecklistItemToggle={onChecklistItemToggle}
                    onUpdateEvent={onUpdateEvent}
                    onEditEvent={onEditEvent}
                    onAddTransaction={onAddTransaction}
                />
            </div>
        )
    };

    const TimeIndicator = () => {
        const [top, setTop] = useState(0);

        useEffect(() => {
            const updatePosition = () => {
                const now = new Date();
                const minutesFromStart = differenceInMinutes(now, startOfDay(now));
                setTop(minutesFromStart * (160 / 60)); // 160px is h-40
            };

            updatePosition();
            const interval = setInterval(updatePosition, 60000);
            return () => clearInterval(interval);
        }, []);

        if (top === 0) return null;

        return (
            <div className="absolute w-full flex items-center z-20" style={{ top: `${top}px` }}>
                <div className="h-2 w-2 rounded-full bg-red-500 -ml-1"></div>
                <div className="h-px w-full bg-red-500"></div>
            </div>
        );
    };

    useEffect(() => {
        if (isToday(date) && scrollContainerRef.current) {
            const now = new Date();
            const minutesFromStart = differenceInMinutes(now, startOfDay(now));
            const scrollPosition = (minutesFromStart * (160/60)) - (scrollContainerRef.current.clientHeight / 4);

            scrollContainerRef.current.scrollTo({
                top: Math.max(0, scrollPosition),
                behavior: 'smooth'
            });
        }
    }, [date, columns]); // Rerun when date or staff changes

    const gridStyle = {
      gridTemplateColumns: `repeat(${columns.length}, minmax(${isMobile ? '0' : '250px'}, 1fr))`
    };

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}>
            <div className="grid grid-cols-[auto,1fr] min-w-max">
                
                <div className="sticky top-0 z-30 bg-background h-14 border-b border-r grid" style={{ width: isMobile ? '40px' : '48px' }} />
                <div className="sticky top-0 z-20 grid col-start-2 bg-background" style={gridStyle}>
                    {columns.map(column => (
                        <div key={column.id} className="p-2 h-14 border-b border-r text-center flex items-center justify-center">
                            {showColumnHeader && (
                                <div className="flex items-center justify-center gap-2 h-full">
                                    {'avatarUrl' in column ? (
                                        <Avatar className="w-6 h-6"><AvatarImage src={(column as Staff).avatarUrl} /><AvatarFallback>{column.name.charAt(0)}</AvatarFallback></Avatar>
                                    ) : (
                                        <div className="w-6 h-6 flex items-center justify-center">
                                            {(column as Resource).type === 'room' ? <Building className="w-5 h-5 text-muted-foreground" /> : <HardHat className="w-5 h-5 text-muted-foreground" />}
                                        </div>
                                    )}
                                    <p className="font-semibold text-sm truncate">{column.name}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                
                {/* Time labels column */}
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-10" : "w-12")}>
                    {hours.map(hour => (
                        <div key={hour} className="h-40 border-r border-b text-right pr-2 pt-1 flex justify-end">
                            <span className="text-xs text-muted-foreground -mt-2.5">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                        </div>
                    ))}
                </div>

                {/* Main content grid */}
                <div className="col-start-2 grid relative" style={gridStyle}>
                    {columns.map(column => {
                        const positionedItems = positionedItemsByColumn.get(column.id) || [];
                        return (
                            <div key={column.id} className="relative border-r">
                                {/* Grid lines */}
                                {hours.map(hour => (
                                    <div key={hour} className="h-40 border-b border-dashed" />
                                ))}
                                {/* Items */}
                                {positionedItems.map(item => {
                                    if ((item as any).itemType === 'appointment') {
                                        return renderAppointment(item);
                                    } else if ((item as any).itemType === 'event') {
                                        return renderEvent(item);
                                    }
                                    return null;
                                })}
                            </div>
                        )
                    })}

                    {isToday(date) && <TimeIndicator />}
                </div>
            </div>
        </div>
    );
};
