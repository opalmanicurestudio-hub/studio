
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Users, Clock, CheckCircle, Coffee, ShieldAlert, Link as LinkIcon, MoreHorizontal, Printer, UserPlus, ArrowUp, ArrowDown, DollarSign, Bell, Lock, Building, HardHat, TrendingUp, UserX, SlidersHorizontal, MessageSquare, ShoppingCart } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useCollection, useFirebase, updateDocumentNonBlocking, useMemoFirebase, setDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import type { WalkIn, Staff, Appointment, Service, ActivityLog, Client, Event, Resource, AppointmentCheckoutState } from '@/lib/data';
import { formatDistanceToNowStrict, parseISO, addMinutes, differenceInMinutes, differenceInSeconds, format, areIntervalsOverlapping, isToday } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PrintWalkInTicket, WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Transaction } from '@/lib/financial-data';
import { Checkbox } from '@/components/ui/checkbox';

const Timer = ({ startTime }: { startTime: string }) => {
    const [elapsed, setElapsed] = useState('');

    useEffect(() => {
        const timer = setInterval(() => {
            const duration = formatDistanceToNowStrict(parseISO(startTime));
            setElapsed(duration);
        }, 1000);
        return () => clearInterval(timer);
    }, [startTime]);

    return <span>{elapsed}</span>;
};

const Countdown = ({ expiryTimestamp }: { expiryTimestamp: Date }) => {
    const [remaining, setRemaining] = useState('');

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            const diffSeconds = differenceInSeconds(expiryTimestamp, now);

            if (diffSeconds <= 0) {
                setRemaining('00:00');
                clearInterval(timer);
                return;
            }

            const minutes = Math.floor(diffSeconds / 60);
            const seconds = diffSeconds % 60;
            setRemaining(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
        }, 1000);
        return () => clearInterval(timer);
    }, [expiryTimestamp]);

    return <span className="font-mono text-lg font-bold text-primary">{remaining}</span>;
};

const StaffResourceIndicator = ({ staffMember, appointments, services, resources }: { staffMember: Staff, appointments: Appointment[], services: Service[], resources: Resource[] }) => {
    const currentAppointment = useMemo(() => {
        if (staffMember.status !== 'busy' || !appointments) return null;
        const now = new Date();
        return appointments.find(apt => {
            if (apt.staffId !== staffMember.id) return false;
            
            if (apt.status !== 'servicing' && apt.status !== 'assigned' && apt.status !== 'confirmed') return false; 
            
            const start = apt.startTime;
            const end = apt.endTime;

            return now >= start && now < end;
        });
    }, [staffMember.status, staffMember.id, appointments]);

    const usedResources = useMemo(() => {
        if (!currentAppointment || !services || !resources) return [];
        const service = services.find(s => s.id === currentAppointment.serviceId);
        if (!service || !service.requiredResourceIds) return [];
        return resources.filter(r => service.requiredResourceIds!.includes(r.id));
    }, [currentAppointment, services, resources]);

    if (usedResources.length === 0) return null;

    return (
        <div className="flex items-center justify-center gap-1.5 mt-1">
            {usedResources.map(resource => (
                <TooltipProvider key={resource.id} delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="p-1 bg-muted/50 rounded-full">
                                {resource.type === 'room' ? <Building className="w-3 h-3 text-muted-foreground" /> : <HardHat className="w-3 h-3 text-muted-foreground" />}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent><p>{resource.name}</p></TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ))}
        </div>
    );
};

const StaffStatusCard = ({ staffMember, onStatusChange, isNextUp, appointments, services, resources }: { staffMember: Staff & { stats: any }, onStatusChange: (staffId: string, status: Partial<Staff>) => void, isNextUp: boolean, appointments: Appointment[], services: Service[], resources: Resource[] }) => {
    const { events } = useInventory();
    
    const isBlocked = useMemo(() => {
        if (!events) return false;
        const now = new Date();
        return events.some(event => {
            if (event.type !== 'blocked') return false;
            const eventStart = event.startTime;
            const eventEnd = event.endTime;
            if (now >= eventStart && now < eventEnd) {
                if (!event.staffId || event.staffId === 'all' || event.staffId === staffMember.id) {
                    return true;
                }
            }
            return false;
        });
    }, [events, staffMember.id]);


  const statusConfig = {
    idle: { label: 'Idle', color: 'bg-green-500' },
    busy: { label: 'Busy', color: 'bg-red-500' },
    onBreak: { label: 'On Break', color: 'bg-yellow-500' },
    blocked: { label: 'Blocked', color: 'bg-gray-500' },
  };

  const currentStatus = isBlocked ? 'blocked' : staffMember.onBreak ? 'onBreak' : staffMember.status || 'idle';
  const { label, color } = statusConfig[currentStatus as keyof typeof statusConfig];

  return (
    <Card className={cn("text-center relative", isNextUp && "border-primary ring-2 ring-primary")}>
      {isNextUp && (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">Next Up</Badge>
      )}
      <CardContent className="p-4 flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar className="w-20 h-20">
              <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} />
              <AvatarFallback>{staffMember.name.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="absolute bottom-1 right-1 flex h-4 w-4">
              <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75", currentStatus === 'idle' && 'animate-ping', color)}></span>
              <span className={cn("relative inline-flex rounded-full h-4 w-4", color)}></span>
          </div>
        </div>
        <div>
          <p className="font-semibold">{staffMember.name}</p>
          <p className="text-sm text-muted-foreground capitalize">{label}</p>
          <StaffResourceIndicator staffMember={staffMember} appointments={appointments} services={services} resources={resources} />
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-2">Manage</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { onBreak: !staffMember.onBreak })}>
                    {staffMember.onBreak ? 'End Break' : 'Take Break'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { status: 'idle' })} disabled={staffMember.status === 'idle'}>
                   Force Idle
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { status: 'busy' })} disabled={staffMember.status === 'busy'}>
                   Force Busy
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

const WaitingCustomerCard = ({ walkIn, services, resources, onPrintTicket, onOpenAssignDialog, queuePosition, estimatedWaitTime }: { walkIn: WalkIn, services: any[], resources: Resource[], onPrintTicket: (data: WalkIn) => void, onOpenAssignDialog: (walkIn: WalkIn) => void, queuePosition: number, estimatedWaitTime?: number | null }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    const requiredResourceIds = useMemo(() => {
        return [...new Set(walkInServices.flatMap(s => s.requiredResourceIds || []))];
    }, [walkInServices]);
    const requiredResources = useMemo(() => {
        return resources.filter(r => requiredResourceIds.includes(r.id));
    }, [resources, requiredResourceIds]);
    const isFirstInQueue = queuePosition === 1;

    return (
        <Card className={cn(isFirstInQueue && "bg-primary/5 border-primary/20")}>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="flex items-start gap-4">
                        <div className="text-3xl font-bold text-primary w-10 text-center">{queuePosition}</div>
                        <div>
                            <p className="font-bold text-xl">{walkIn.customerName}</p>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Clock className="h-4 w-4" />
                                    <span>Waiting <Timer startTime={walkIn.checkInTime} /></span>
                                </div>
                                {estimatedWaitTime !== undefined && estimatedWaitTime !== null && estimatedWaitTime < Infinity && (
                                    <p className="text-primary font-semibold text-xs mt-1 pl-6">
                                        Est. Wait: ~{estimatedWaitTime} min
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary">{walkIn.status}</Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => onOpenAssignDialog(walkIn)}>
                                    <UserPlus className="mr-2 h-4 w-4" />Assign Manually
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onPrintTicket(walkIn)}>
                                    <Printer className="mr-2 h-4 w-4"/>Print Ticket
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <div className="mt-4 space-y-2 pl-14">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                     {requiredResources.length > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                            <p className="text-xs font-semibold text-muted-foreground">Needs:</p>
                            <div className="flex items-center gap-1.5">
                                {requiredResources.map(resource => (
                                    <TooltipProvider key={resource.id} delayDuration={0}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="p-1 bg-muted/50 rounded-full">
                                                    {resource.type === 'room' ? <Building className="w-3 h-3 text-muted-foreground" /> : <HardHat className="w-3 h-3 text-muted-foreground" />}
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent><p>{resource.name}</p></TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                ))}
                            </div>
                        </div>
                    )}
                    {walkIn.notes && (
                        <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                            <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <p className="italic">{walkIn.notes}</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const NotifiedCustomerCard = ({ walkIn, onStartService, onSkip, skipTimeMinutes }: { walkIn: WalkIn, onStartService: (walkIn: WalkIn) => void, onSkip: () => void, skipTimeMinutes: number }) => {
    const expiryTimestamp = useMemo(() => {
        if (!walkIn.notifiedTimestamp) return new Date();
        return addMinutes(parseISO(walkIn.notifiedTimestamp), skipTimeMinutes);
    }, [walkIn.notifiedTimestamp, skipTimeMinutes]);

    return (
        <Card className="border-primary ring-2 ring-primary">
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground">Notified <Timer startTime={walkIn.notifiedTimestamp!} /></p>
                    </div>
                    <Badge className="bg-primary hover:bg-primary/90 flex items-center gap-1.5"><Bell className="w-3 h-3" /> Notified</Badge>
                </div>
                <div className="text-center my-4">
                    <p className="text-sm text-muted-foreground">Time to claim spot:</p>
                    <Countdown expiryTimestamp={expiryTimestamp} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={onSkip}>Skip</Button>
                    <Button onClick={() => onStartService(walkIn)}>Start Service</Button>
                </div>
            </CardContent>
        </Card>
    );
};


const ServicingCustomerCard = ({ appointment, services, resources, staff, onUpdateStatus, onPrintTicket, onFinishService, walkIns }: { appointment: Appointment, services: any[], resources: Resource[], staff: Staff[], onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void, onPrintTicket: (data: any) => void, onFinishService: (item: Appointment) => void, walkIns: WalkIn[] | null }) => {
    
    const serviceIds = [appointment.serviceId, ...(appointment.addOnIds || [])];
    const customerName = appointment.clientName;
    const assignedStaff = staff.find(s => s.id === appointment.staffId);
    
    const itemServices = services.filter(s => serviceIds.includes(s.id));
    
    const serviceStartTime = appointment.actualStartTime;

    const assignedSlot = useMemo(() => {
        if (!serviceStartTime || !appointment.endTime) return null;
        
        const start = typeof serviceStartTime === 'string' ? parseISO(serviceStartTime as string) : serviceStartTime;
        const end = typeof appointment.endTime === 'string' ? parseISO(appointment.endTime) : appointment.endTime;
        return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
    }, [serviceStartTime, appointment.endTime]);

    const waitTime = useMemo(() => {
        if (appointment.isWalkIn && appointment.actualStartTime && walkIns) {
            const walkInId = appointment.id.replace('apt-walkin-', '');
            const walkIn = walkIns.find(w => w.id === walkInId);
            if (walkIn) {
                const startTime = typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime;
                return differenceInMinutes(startTime, parseISO(walkIn.checkInTime));
            }
        }
        return null;
    }, [appointment, walkIns]);

    const [elapsedTime, setElapsedTime] = useState<string | null>(null);

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;

        if (appointment.status === 'servicing' && serviceStartTime) {
            const startTime = typeof serviceStartTime === 'string' ? parseISO(serviceStartTime) : serviceStartTime;
            timer = setInterval(() => {
                const now = new Date();
                const diffInSeconds = differenceInSeconds(now, startTime);
                
                const hours = Math.floor(diffInSeconds / 3600);
                const minutes = Math.floor((diffInSeconds % 3600) / 60);
                const seconds = diffInSeconds % 60;

                if (hours > 0) {
                    setElapsedTime(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
                } else {
                    setElapsedTime(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
                }
            }, 1000);
        } else {
            setElapsedTime(null);
        }

        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, [appointment.status, serviceStartTime]);

    const handleSkip = () => {
        onUpdateStatus(appointment.id, 'cancelled');
    };
    
    const handlePrintTicketClick = () => {
        if (appointment.isWalkIn && walkIns) {
            const walkInId = appointment.id.replace('apt-walkin-', '');
            const walkIn = walkIns.find(w => w.id === walkInId);
            if(walkIn) onPrintTicket(walkIn);
        }
    }

    return (
        <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <p className="font-bold text-xl">{customerName}</p>
                        {assignedStaff && (
                            <div className="flex items-center gap-2 text-sm text-primary">
                                <Avatar className="w-6 h-6">
                                    <AvatarImage src={assignedStaff.avatarUrl} alt={assignedStaff.name} />
                                    <AvatarFallback>{assignedStaff.name.substring(0, 2)}</AvatarFallback>
                                </Avatar>
                                <span className="font-semibold">{assignedStaff.name}</span>
                            </div>
                        )}
                        {assignedSlot && <p className="text-sm font-semibold">{format(typeof serviceStartTime === 'string' ? parseISO(serviceStartTime) : serviceStartTime!, 'MMM d, yyyy')} &middot; {assignedSlot}</p>}
                        {waitTime !== null && <p className="text-xs text-muted-foreground">Waited {waitTime} minutes</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                             <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground capitalize flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                In Service
                            </Badge>
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onClick={handlePrintTicketClick} disabled={!appointment.isWalkIn}>
                                        <Printer className="mr-2 h-4 w-4"/>Print Ticket
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        {elapsedTime && (
                            <p className="font-mono text-sm font-semibold text-primary">{elapsedTime}</p>
                        )}
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {itemServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                 <div className="mt-4 border-t pt-4 flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={handleSkip}>Mark as Skipped</Button>
                    <Button size="sm" onClick={() => onFinishService(appointment)}>Finish Service</Button>
                </div>
            </CardContent>
        </Card>
    )
};

const ReadyForCheckoutCard = ({ item, services, clients, onCheckoutClick, isSelected, onSelect }: { 
    item: WalkIn | Appointment, 
    services: Service[], 
    clients: Client[], 
    onCheckoutClick: (item: WalkIn | Appointment) => void,
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const isWalkIn = 'customerName' in item;
    const client = isWalkIn ? null : clients.find(c => c.id === item.clientId);
    const customerName = isWalkIn ? item.customerName : client?.name;
    const serviceIds = isWalkIn ? item.serviceIds : [item.serviceId, ...(item.addOnIds || [])];
    const itemServices = services.filter(s => serviceIds.includes(s.id));
    
    return (
        <Card className={cn(isSelected && "border-primary ring-2 ring-primary")}>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="flex items-start gap-4">
                         <Checkbox checked={isSelected} onCheckedChange={onSelect} className="mt-1" />
                        <div className="space-y-1">
                            <p className="font-bold text-xl">{customerName}</p>
                            <p className="text-sm text-muted-foreground">Finished Service</p>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <Badge className="bg-orange-500 hover:bg-orange-500/90 text-orange-foreground capitalize flex items-center gap-1">
                           <DollarSign className="h-3 w-3" />
                            Awaiting Checkout
                        </Badge>
                    </div>
                </div>
                <div className="mt-4 space-y-2 pl-10">
                    <p className="font-semibold text-sm">Services Rendered:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {itemServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                 <div className="mt-4 border-t pt-4 flex justify-end gap-2 pl-10">
                    <Button size="sm" onClick={() => onCheckoutClick(item)}>Checkout Client</Button>
                </div>
            </CardContent>
        </Card>
    );
};

const AssignStaffDialog = ({ open, onOpenChange, walkIn, staff, services, events, onAssign }: { open: boolean, onOpenChange: (open: boolean) => void, walkIn: WalkIn | null, staff: Staff[], services: Service[], events: Event[], onAssign: (staffId: string) => void }) => {
  const [selectedStaffId, setSelectedStaffId] = useState('');

  const staffWithStatus = useMemo(() => {
    if (!walkIn || !staff || !events) return [];
    const requiredSkills = walkIn.serviceIds.flatMap(id => services.find(s => s.id === id)?.requiredSkills || []);
    const uniqueSkills = [...new Set(requiredSkills)];
    const now = new Date();

    return staff.map(s => {
        const isBlocked = events.some(event => {
            if (event.type !== 'blocked') return false;
            const eventStart = event.startTime;
            const eventEnd = event.endTime;
            if (now >= eventStart && now < eventEnd) {
                if (!event.staffId || event.staffId === 'all' || event.staffId === s.id) {
                    return true;
                }
            }
            return false;
        });

        return {
            ...s,
            isQualified: uniqueSkills.every(skill => (s.skillSet || []).includes(skill)),
            isBlocked,
        };
    }).sort((a, b) => {
        const aAvailable = a.isQualified && !a.isBlocked && a.status === 'idle' && !a.onBreak;
        const bAvailable = b.isQualified && !b.isBlocked && b.status === 'idle' && !b.onBreak;
        if (aAvailable && !bAvailable) return -1;
        if (!aAvailable && bAvailable) return 1;

        const aQualified = a.isQualified && !a.isBlocked;
        const bQualified = b.isQualified && !b.isBlocked;
        if (aQualified && !bQualified) return -1;
        if (!aQualified && bQualified) return 1;
        
        return a.name.localeCompare(b.name);
    });
  }, [walkIn, staff, services, events]);

  const handleAssign = () => {
    if (selectedStaffId) {
      onAssign(selectedStaffId);
    }
  };

  if (!walkIn) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {walkIn.customerName} to...</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId}>
            {staffWithStatus.map(s => (
              <Label 
                key={s.id} 
                htmlFor={`assign-${s.id}`} 
                className={cn(
                    "flex items-center gap-4 p-3 border rounded-md cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary",
                    (!s.isQualified || s.isBlocked) && "cursor-not-allowed opacity-50"
                )}
              >
                <Avatar className="w-12 h-12">
                  <AvatarImage src={s.avatarUrl} />
                  <AvatarFallback>{s.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-semibold">{s.name}</p>
                   <div className="flex items-center gap-2">
                        {s.isBlocked ? (
                             <Badge variant="destructive" className="bg-gray-500">Blocked</Badge>
                        ) : s.onBreak ? (
                             <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">On Break</Badge>
                        ) : s.status === 'busy' ? (
                             <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">Busy</Badge>
                        ) : s.status === 'idle' ? (
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Idle</Badge>
                        ) : null}
                         {!s.isQualified && <Badge variant="destructive">Not Qualified</Badge>}
                   </div>
                </div>
                <RadioGroupItem value={s.id} id={`assign-${s.id}`} disabled={!s.isQualified || s.isBlocked} />
              </Label>
            ))}
          </RadioGroup>
          {staffWithStatus.filter(s => s.isQualified).length === 0 && (
              <div className="text-center text-muted-foreground p-8">
                <p>No qualified staff members for the requested services.</p>
              </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAssign} disabled={!selectedStaffId}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


export default function POSPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const [ticketToPrint, setTicketToPrint] = useState<WalkIn | null>(null);
  const [appointmentsToCheckout, setAppointmentsToCheckout] = useState<any[]>([]);
  const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'automatic' | 'ordered'>('automatic');
  const [staffOrder, setStaffOrder] = useState<Staff[]>([]);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [isNewRetailSaleOpen, setIsNewRetailSaleOpen] = useState(false);
  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set<string>());

  const isMobile = useIsMobile();
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);

  // Helper function to safely get timestamp from a date string or Date object
  const getTime = (date: string | Date | undefined): number => {
      if (!date) return 0;
      if (typeof date === 'string') return parseISO(date).getTime();
      return date.getTime();
  };

  // ... (All the useMemoFirebase and useCollection hooks from the original walk-in-queue page)
    const staffQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'staff');
  }, [firestore, user, tenantId]);
  
  const walkInQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'walkIns');
  }, [firestore, user, tenantId]);

  const servicesQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/services`);
  }, [firestore, user, tenantId]);
  
  const clientsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/clients`);
  }, [firestore, user, tenantId]);

  const eventsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/events`);
  }, [firestore, user, tenantId]);
  
  const appointmentsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'appointments');
  }, [firestore, user, tenantId]);

  const resourcesQuery = useMemoFirebase(() => {
    if (!firestore || !user || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/resources`);
  }, [firestore, user, tenantId]);

  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(walkInQuery);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);
  const { data: fetchedEvents, isLoading: eventsLoading } = useCollection<Event>(eventsQuery);
  const { data: appointmentsFromDB } = useCollection<Appointment>(appointmentsQuery);
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(resourcesQuery);
  const { data: transactions, isLoading: transactionsLoading } = useCollection<Transaction>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'transactions') : null, [firestore, tenantId]));

  const events = useMemo(() => {
    if (!fetchedEvents) return [];
    return fetchedEvents.map(evt => {
      const startTime = (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : parseISO(evt.startTime as any);
      const endTime = (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : parseISO(evt.endTime as any);
      return ({ ...evt, startTime, endTime });
    });
  }, [fetchedEvents]);

  const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => ({
        ...apt,
        startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
        endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
        actualStartTime: apt.actualStartTime ? ((apt.actualStartTime as any)?.toDate ? (apt.actualStartTime as any).toDate() : parseISO(apt.actualStartTime as string)) : undefined,
    }));
  }, [appointmentsFromDB]);


  // ... (All the useMemo and useEffect hooks from the original walk-in-queue page)
  const activeStaff = useMemo(() => {
    if (!staff) return [];
    return staff.filter(s => s.active);
  }, [staff]);
  
  useEffect(() => {
    if (activeStaff) {
        setStaffOrder(activeStaff);
    }
  }, [activeStaff]);

    const dailyStats = useMemo(() => {
    if (!walkIns) return { total: 0, completed: 0, skippedOrCancelled: 0, avgWaitTime: 0, conversionRate: 0 };

    const todayWalkIns = walkIns.filter(w => isToday(parseISO(w.checkInTime)));
    const total = todayWalkIns.length;

    const completed = todayWalkIns.filter(w => w.status === 'completed' && w.serviceStartTime);
    const skippedOrCancelled = todayWalkIns.filter(w => w.status === 'skipped' || w.status === 'cancelled');

    const totalWaitTime = completed.reduce((acc, w) => {
        return acc + differenceInMinutes(parseISO(w.serviceStartTime!), parseISO(w.checkInTime));
    }, 0);

    const avgWaitTime = completed.length > 0 ? totalWaitTime / completed.length : 0;
    
    const terminalWalkIns = completed.length + skippedOrCancelled.length;
    const conversionRate = terminalWalkIns > 0 ? (completed.length / terminalWalkIns) * 100 : 0;

    return { 
        total, 
        conversionRate, 
        skippedOrCancelled: skippedOrCancelled.length,
        avgWaitTime,
    };
  }, [walkIns]);

  const handleReorder = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...staffOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newOrder.length) {
        const [movedItem] = newOrder.splice(index, 1);
        newOrder.splice(targetIndex, 0, movedItem);
        setStaffOrder(newOrder);
    }
  };
  
    const assignWalkIn = useCallback(async (walkInId: string, staffId: string) => {
    if (!firestore || !tenantId || !walkIns || !staff || !services || !clients) return;

    const walkIn = walkIns.find(w => w.id === walkInId);
    const staffMember = staff.find(s => s.id === staffId);

    if (!walkIn || !staffMember) return;
    
    let finalClientId: string;
    let finalClientName: string;

    if (walkIn.clientId) {
        const clientFromKiosk = clients.find(c => c.id === walkIn.clientId);
        if (clientFromKiosk) {
            finalClientId = clientFromKiosk.id;
            finalClientName = clientFromKiosk.name;
        }
    }

    if (!finalClientId!) {
        const existingClient = clients.find(c => 
            (walkIn.customerEmail && c.email && c.email.toLowerCase() === walkIn.customerEmail.toLowerCase()) || 
            (walkIn.customerPhone && c.phone && c.phone === walkIn.customerPhone)
        );

        if (existingClient) {
            finalClientId = existingClient.id;
            finalClientName = existingClient.name;
        } else {
            const newId = `cli-${nanoid()}`;
            const newClientData: Omit<Client, 'id'> = {
                name: walkIn.customerName,
                email: walkIn.customerEmail || '',
                phone: walkIn.customerPhone || '',
                birthday: walkIn.customerBirthday,
                avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
                lifetimeValue: 0,
                lastAppointment: new Date().toISOString(),
                status: 'active',
            };
            const clientDocRef = doc(firestore, 'tenants', tenantId, 'clients', newId);
            setDocumentNonBlocking(clientDocRef, { ...newClientData, id: newId }, {});
            
            finalClientId = newId;
            finalClientName = newClientData.name;
            toast({
                title: "New Client Created",
                description: `${walkIn.customerName} has been added to your client list.`,
            });
        }
    }


    const now = new Date();
    const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
    const walkInUpdate = {
        status: 'assigned' as const,
        assignedStaffId: staffId,
        clientId: finalClientId,
    };
    updateDocumentNonBlocking(walkInDocRef, walkInUpdate);

    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
    const staffUpdate = { status: 'busy' as const };
    updateDocumentNonBlocking(staffDocRef, staffUpdate);

    const mainService = services.find(s => s.id === walkIn.serviceIds[0]);
    if (mainService) {
        const appointmentEndTime = addMinutes(now, walkIn.estimatedDuration);
        
        const allServicesForWalkIn = walkIn.serviceIds.map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
        const allRequiredResourceIds = [...new Set(allServicesForWalkIn.flatMap(s => s.requiredResourceIds || []))];

        const checkInToken = nanoid(16);

        const newAppointmentForFirestore = {
            clientId: finalClientId!,
            clientName: finalClientName!,
            clientEmail: walkIn.customerEmail,
            clientPhone: walkIn.customerPhone,
            serviceId: mainService.id,
            staffId: staffId,
            startTime: now,
            endTime: appointmentEndTime,
            status: 'confirmed' as const,
            source: 'walk-in' as const,
            isWalkIn: true,
            addOnIds: walkIn.serviceIds.slice(1),
            checkInToken: checkInToken,
            requiredResourceIds: allRequiredResourceIds,
            tenantId: tenantId,
            id: `apt-walkin-${walkIn.id}`,
        };
        const aptDocRef = doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkIn.id}`);
        setDocumentNonBlocking(aptDocRef, newAppointmentForFirestore, {});
        
        const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
        setDocumentNonBlocking(checkInDocRef, newAppointmentForFirestore, {});
    }
  }, [firestore, tenantId, walkIns, staff, services, clients, toast]);

    const availableStaff = useMemo(() => {
        if (!activeStaff || !events || !appointments) return [];
        const now = new Date();
        return activeStaff.filter(s => {
            if (s.status !== 'idle' || s.onBreak) return false;
            
            const isEventBlocked = events.some(event => 
                event.type === 'blocked' &&
                areIntervalsOverlapping({ start: now, end: addMinutes(now, 1) }, { start: event.startTime, end: event.endTime }) &&
                (!event.staffId || event.staffId === 'all' || event.staffId === s.id)
            );
            if (isEventBlocked) return false;

            const isAppointmentBusy = appointments.some(apt =>
                apt.staffId === s.id &&
                (apt.status === 'servicing' || apt.status === 'confirmed' || apt.status === 'assigned') &&
                areIntervalsOverlapping({ start: now, end: addMinutes(now, 1) }, { start: apt.startTime, end: apt.endTime })
            );
            if (isAppointmentBusy) return false;
            
            return true;
        });
    }, [activeStaff, events, appointments]);

    const nextUpStaffId = useMemo(() => {
        if (availableStaff.length === 0) return null;

        if (assignmentMode === 'automatic') {
            const sortedIdleStaff = [...availableStaff].sort((a, b) =>
                (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) -
                (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0)
            );
            return sortedIdleStaff[0]?.id;
        } else { // 'ordered'
            for (const orderedStaffMember of staffOrder) {
                if (availableStaff.some(s => s.id === orderedStaffMember.id)) {
                    return orderedStaffMember.id;
                }
            }
            return null; // Should not happen if availableStaff is not empty
        }
    }, [availableStaff, assignmentMode, staffOrder]);
    
    const canNotifyNext = useMemo(() => {
        if (!walkIns || !services || !resources) return false;

        const waitingCustomers = walkIns.filter(w => w.status === 'waiting');
        if (waitingCustomers.length === 0) return false;

        const notifiedCustomers = walkIns.filter(w => w.status === 'notified');
        if (notifiedCustomers.length >= availableStaff.length) return false;

        const customerToNotify = waitingCustomers[0];
        const walkInServices = customerToNotify.serviceIds.map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
        
        // Check resource availability
        const requiredResourceIds = [...new Set(walkInServices.flatMap(s => s.requiredResourceIds || []))];
        const busyResourceIds = new Set<string>();
        const now = new Date();
        (appointments || []).forEach(apt => {
            if ((apt.status === 'servicing' || apt.status === 'assigned' || apt.status === 'confirmed') && areIntervalsOverlapping({ start: now, end: addMinutes(now, 1) }, { start: apt.startTime, end: apt.endTime })) {
                (apt.requiredResourceIds || []).forEach(id => busyResourceIds.add(id));
            }
        });
        if (requiredResourceIds.some(id => busyResourceIds.has(id))) return false;

        // Check staff availability and qualification
        const requiredSkills = customerToNotify.requiredSkills || [];
        const qualifiedAndAvailableStaff = availableStaff.filter(s => 
            requiredSkills.every(skill => (s.skillSet || []).includes(skill))
        );

        if (qualifiedAndAvailableStaff.length === 0) return false;

        if (customerToNotify.preferredStaffId && customerToNotify.waitForPreferredStaff) {
            return qualifiedAndAvailableStaff.some(s => s.id === customerToNotify.preferredStaffId);
        }

        return true;
    }, [walkIns, services, resources, availableStaff, appointments]);

    const estimatedWaitTimes = useMemo(() => {
        const waitTimes = new Map<string, number>();
        if (!staff || !activeStaff || !services || !appointments || !events || !walkIns) return waitTimes;

        const now = new Date();
        
        // Deep copy arrays to prevent accidental mutation
        const futureAppointmentsData = JSON.parse(JSON.stringify(appointments));
        const futureEventsData = JSON.parse(JSON.stringify(events));

        const futureAppointments: Appointment[] = futureAppointmentsData
            .map((apt: any) => ({...apt, startTime: parseISO(apt.startTime), endTime: parseISO(apt.endTime)}))
            .filter((apt: Appointment) => apt.endTime > now && isToday(apt.startTime));

        const futureEvents: Event[] = futureEventsData
            .map((evt: any) => ({...evt, startTime: parseISO(evt.startTime), endTime: parseISO(evt.endTime)}))
            .filter((evt: Event) => evt.endTime > now && isToday(evt.startTime));

        const staffTimelines: { [staffId: string]: Date } = {};
        activeStaff.forEach(s => {
            let nextFreeTime = now;

            const staffAppointments = futureAppointments.filter(apt => apt.staffId === s.id);
            const staffEvents = futureEvents.filter(e => !e.staffId || e.staffId === 'all' || e.staffId === s.id);
            
            const allItems = [...staffAppointments, ...staffEvents];
            allItems.forEach(item => {
                if (areIntervalsOverlapping({ start: now, end: addMinutes(now, 1) }, { start: item.startTime, end: item.endTime })) {
                    nextFreeTime = new Date(Math.max(nextFreeTime.getTime(), item.endTime.getTime()));
                }
            });
            staffTimelines[s.id] = nextFreeTime;
        });

        const waitingCustomers = walkIns.filter(w => w.status === 'waiting').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());

        for (const customer of waitingCustomers) {
            const requiredSkills = customer.requiredSkills || [];
            const qualifiedStaff = activeStaff.filter(s => requiredSkills.every(skill => (s.skillSet || []).includes(skill)));

            if (qualifiedStaff.length === 0) {
                waitTimes.set(customer.id, Infinity);
                continue;
            }

            let bestStaffId = '';
            let soonestFreeTime = new Date(8640000000000000); 

            for (const staffMember of qualifiedStaff) {
                if (staffTimelines[staffMember.id] < soonestFreeTime) {
                    soonestFreeTime = staffTimelines[staffMember.id];
                    bestStaffId = staffMember.id;
                }
            }
            
            const waitInMinutes = differenceInMinutes(soonestFreeTime, now);
            waitTimes.set(customer.id, waitInMinutes > 0 ? waitInMinutes : 0);
            
            if (bestStaffId) {
                staffTimelines[bestStaffId] = addMinutes(soonestFreeTime, customer.estimatedDuration);
            }
        }
        
        return waitTimes;
    }, [walkIns, staff, activeStaff, appointments, events, services]);
    
    const handleStartServiceFromNotified = useCallback((walkIn: WalkIn) => {
        if (!services) return;
        
        const requiredSkills = walkIn.requiredSkills || [];
        const qualifiedAndAvailableStaff = availableStaff.filter(s => 
            requiredSkills.every(skill => (s.skillSet || []).includes(skill))
        );

        if (qualifiedAndAvailableStaff.length === 0) {
            toast({ variant: 'destructive', title: 'No Qualified Staff Available' });
            return;
        }

        let staffToAssign: Staff | undefined;

        if (walkIn.preferredStaffId) {
            const preferred = qualifiedAndAvailableStaff.find(s => s.id === walkIn.preferredStaffId);
            if (preferred) {
                staffToAssign = preferred;
            }
        }

        if (!staffToAssign) {
            if (assignmentMode === 'automatic') {
                const nextUpIsQualified = qualifiedAndAvailableStaff.find(s => s.id === nextUpStaffId);
                if (nextUpIsQualified) {
                    staffToAssign = nextUpIsQualified;
                } else {
                     const sortedQualifiedStaff = [...qualifiedAndAvailableStaff].sort((a, b) =>
                        (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) -
                        (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0)
                    );
                    staffToAssign = sortedQualifiedStaff[0];
                }
            } else { // 'ordered'
                for (const orderedStaffMember of staffOrder) {
                    const found = qualifiedAndAvailableStaff.find(s => s.id === orderedStaffMember.id);
                    if (found) {
                        staffToAssign = found;
                        break;
                    }
                }
            }
        }
        
        if (!staffToAssign) {
            toast({ variant: 'destructive', title: 'Could not determine staff assignment.' });
            return;
        }

        assignWalkIn(walkIn.id, staffToAssign.id);

    }, [availableStaff, services, assignWalkIn, toast, nextUpStaffId, staffOrder, assignmentMode]);

    const handleNotifyNext = () => {
        if (!canNotifyNext) {
            toast({
                variant: 'destructive',
                title: 'Cannot Notify',
                description: 'No available qualified staff/resources at this time.',
            });
            return;
        }

        if (!walkIns || !firestore || !tenantId) return;

        const waitingCustomers = walkIns.filter(w => w.status === 'waiting').sort((a, b) => (a.waitForPreferredStaff ? 0 : 1) - (b.waitForPreferredStaff ? 0 : 1) || parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
        const customerToNotify = waitingCustomers[0];

        const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', customerToNotify.id);
        updateDocumentNonBlocking(walkInDocRef, {
            status: 'notified',
            notifiedTimestamp: new Date().toISOString()
        });
        toast({
            title: 'Client Notified',
            description: `${customerToNotify.customerName} has been notified it's their turn.`,
        });
    };

    const handleManualAssign = (staffId: string) => {
        if (walkInToAssign) {
            assignWalkIn(walkInToAssign.id, staffId);
        }
        setWalkInToAssign(null);
    };

  const waitingQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);

  const notifiedQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'notified').sort((a, b) => parseISO(a.notifiedTimestamp!).getTime() - parseISO(b.notifiedTimestamp!).getTime());
  }, [walkIns]);
  
  const servicingQueue = useMemo(() => {
    if (!appointments) return [];
    const inServiceAppointments = (appointments || []).filter(a => a.status === 'servicing');
    return inServiceAppointments.sort((a, b) => {
        const timeA = getTime(a.actualStartTime);
        const timeB = getTime(b.actualStartTime);
        return timeA - timeB;
    });
  }, [appointments]);

  const readyForCheckoutQueue = useMemo(() => {
    const walkInsReady = (walkIns || []).filter(w => w.status === 'ready_for_checkout');
    const appointmentsReady = (appointments || []).filter(apt => apt.status === 'ready_for_checkout');

    const combined = [
        ...walkInsReady.map(w => ({ ...w, itemType: 'walk-in' as const })),
        ...appointmentsReady.map(a => ({ ...a, itemType: 'appointment' as const }))
    ];
    
    return combined.sort((a,b) => {
        const aTime = a.itemType === 'walk-in' ? a.serviceEndTime : a.endTime;
        const bTime = b.itemType === 'walk-in' ? b.serviceEndTime : b.endTime;
        return getTime(aTime) - getTime(bTime);
    });
  }, [walkIns, appointments]);
  
  const handleFinishService = (item: Appointment) => {
    if (!firestore || !services || !tenantId) return;
    
    setSelectedAppointment(item);
    setIsTechnicianReviewOpen(true);
  };

  const handleStaffStatusChange = (staffId: string, statusUpdate: Partial<Staff>) => {
    if (!firestore || !staff || !tenantId) return;
    
    const staffMember = staff.find(s => s.id === staffId);
    if (!staffMember) return;

    let finalUpdate = { ...statusUpdate };
    
    if (statusUpdate.hasOwnProperty('onBreak')) {
        const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
        if (statusUpdate.onBreak === true) { 
            finalUpdate.breakStartTime = new Date().toISOString();
            const newLog: Omit<ActivityLog, 'id'> = {
                staffId,
                type: 'break_start',
                timestamp: finalUpdate.breakStartTime,
            };
            addDocumentNonBlocking(activityLogsRef, newLog);

        } else if (statusUpdate.onBreak === false && staffMember.onBreak && staffMember.breakStartTime) { 
            const breakStart = parseISO(staffMember.breakStartTime);
            const breakEnd = new Date();
            const durationMinutes = differenceInMinutes(breakEnd, breakStart);
            
            const newLog: Omit<ActivityLog, 'id'> = {
                staffId,
                type: 'break_end',
                timestamp: breakEnd.toISOString(),
                durationMinutes,
            };
            addDocumentNonBlocking(activityLogsRef, newLog);
            finalUpdate.breakStartTime = undefined; 
        }
    }

    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
    updateDocumentNonBlocking(staffDocRef, finalUpdate);
  }
  
  const handleWalkInStatusChange = useCallback((walkInId: string, staffId: string, status: WalkIn['status']) => {
    if (!firestore || !tenantId) return;
    const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
    
    let update: Partial<WalkIn> = { status };
    
    updateDocumentNonBlocking(walkInDocRef, update);

    if ((status === 'completed' || status === 'skipped' || status === 'cancelled') && staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        updateDocumentNonBlocking(staffDocRef, { 
            status: 'idle',
            lastServedTimestamp: new Date().toISOString(),
        });
    }
  }, [firestore, tenantId]);

  const handleAppointmentSelect = (itemId: string) => {
    const newSelection = new Set(selectedAppointmentIds);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedAppointmentIds(newSelection);
  };
  
  const handleGroupCheckout = () => {
    const appointmentsForCheckout = readyForCheckoutQueue
        .filter(item => selectedAppointmentIds.has(item.id))
        .map(item => {
            const isWalkIn = 'customerName' in item;
            let appointment: Appointment | undefined;

            if (isWalkIn) {
                appointment = appointments?.find(apt => apt.id === `apt-walkin-${item.id}`);
            } else {
                appointment = item as Appointment;
            }

            if (!appointment) return null;

            const client = clients?.find(c => c.id === appointment!.clientId);
            const service = services?.find(s => s.id === appointment!.serviceId);

            return { appointment, client, service };
        })
        .filter((i): i is { appointment: Appointment; client: Client | undefined; service: Service | undefined; } => i !== null);
    
    setAppointmentsToCheckout(appointmentsForCheckout);
    setIsNewRetailSaleOpen(true);
  };

  const handleCompleteClick = (item: WalkIn | Appointment) => {
    setSelectedAppointmentIds(new Set()); // Reset selection
    if (!services || !clients) return;

    const isWalkIn = 'customerName' in item;
    let appointmentForCheckout: Appointment | undefined;

    if (isWalkIn) {
        appointmentForCheckout = appointments?.find(apt => apt.id === `apt-walkin-${item.id}`);
    } else {
        appointmentForCheckout = item as Appointment;
    }

    if (!appointmentForCheckout) {
        toast({ title: 'Error', description: 'Could not find appointment to checkout.', variant: 'destructive'});
        return;
    }

    const client = clients.find(c => c.id === appointmentForCheckout!.clientId);
    const service = services.find(s => s.id === appointmentForCheckout!.serviceId);
    
    setAppointmentsToCheckout([{
        appointment: appointmentForCheckout,
        client: client,
        service: service
    }]);
    setIsNewRetailSaleOpen(true);
  };

  const handleCheckoutComplete = () => {
    toast({ title: "Checkout Complete!" });
    setIsNewRetailSaleOpen(false);
  };

  const handleRebook = () => {};


  const ticketData: WalkInTicketData | null = ticketToPrint && services ? {
    id: ticketToPrint.id,
    name: ticketToPrint.customerName,
    services: services.filter(s => ticketToPrint.serviceIds.includes(s.id)),
    queuePosition: (waitingQueue.findIndex(w => w.id === ticketToPrint.id) + 1) || 1, 
    checkInTime: ticketToPrint.checkInTime,
  } : null;

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment || !clients || !services) return null;
    
    const clientData = clients.find(c => c.id === selectedAppointment.clientId);
    const serviceData = services.find(s => s.id === selectedAppointment.serviceId);
    
    if (!clientData || !serviceData) return null;

    return {
      appointment: selectedAppointment,
      client: clientData,
      service: serviceData,
    };
  }, [selectedAppointment, clients, services]);

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId || !appointments) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'ready_for_checkout',
        checkoutState,
        actualEndTime: new Date().toISOString(),
    });
    
    const appointment = appointments.find(apt => apt.id === appointmentId);
    if (appointment?.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
        updateDocumentNonBlocking(checkInRef, { status: 'ready_for_checkout', tenantId: tenantId });
    }

    const staffIdsInvolved = new Set(Object.values(checkoutState.serviceStaffOverrides || {}));
    if (appointment?.staffId) {
      staffIdsInvolved.add(appointment.staffId);
    }

    staffIdsInvolved.forEach(staffId => {
      if (staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        updateDocumentNonBlocking(staffDocRef, {
          status: 'idle',
        });
      }
    });

    const walkInId = appointmentId.replace('apt-walkin-', '');
    if (walkIns?.find(w => w.id === walkInId)) {
        const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, {
            status: 'ready_for_checkout',
            serviceEndTime: new Date().toISOString()
        });
    }

    setIsTechnicianReviewOpen(false);
    setSelectedAppointment(null);
    toast({
      title: 'Sent to Front Desk',
      description: "Client is ready for checkout.",
    });
  };

  const KpiCards = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="bg-blue-500/10 border-blue-500/20">
          <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center justify-between text-blue-800 dark:text-blue-300">
                  Total Walk-ins Today <Users className="w-4 h-4 text-blue-500/80" />
              </CardTitle>
          </CardHeader>
          <CardContent>
              <p className="text-2xl font-bold text-blue-800 dark:text-blue-400">{dailyStats.total}</p>
          </CardContent>
      </Card>
      <Card className="bg-purple-500/10 border-purple-500/20">
          <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center justify-between text-purple-800 dark:text-purple-300">
                  Avg. Wait Time <Clock className="w-4 h-4 text-purple-500/80" />
              </CardTitle>
          </CardHeader>
          <CardContent>
              <p className="text-2xl font-bold text-purple-800 dark:text-purple-400">~{dailyStats.avgWaitTime.toFixed(0)} min</p>
          </CardContent>
      </Card>
      <Card className="bg-green-500/10 border-green-500/20">
          <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center justify-between text-green-800 dark:text-green-300">
                  Conversion Rate <TrendingUp className="w-4 h-4 text-green-500/80" />
              </CardTitle>
          </CardHeader>
          <CardContent>
              <p className="text-2xl font-bold text-green-800 dark:text-green-400">{dailyStats.conversionRate.toFixed(1)}%</p>
          </CardContent>
      </Card>
      <Card className="bg-red-500/10 border-red-500/20">
          <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center justify-between text-red-800 dark:text-red-300">
                  Skipped / Cancelled <UserX className="w-4 h-4 text-red-500/80" />
              </CardTitle>
          </CardHeader>
          <CardContent>
              <p className="text-2xl font-bold text-red-800 dark:text-red-400">{dailyStats.skippedOrCancelled}</p>
          </CardContent>
      </Card>
    </div>
  );

  return (
    <>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Point of Sale" />
      <main className="flex-1 p-4 md:p-8 space-y-8 flex flex-col">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold">Point of Sale</h1>
                <p className="text-muted-foreground mt-1">Manage your front desk, from walk-ins to checkouts.</p>
            </div>
            <Button onClick={() => setIsNewRetailSaleOpen(true)}>
                <ShoppingCart className="mr-2 h-4 w-4" /> New Retail Sale
            </Button>
          </div>
        {isMobile ? (
            <Sheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen}>
                <SheetTrigger asChild>
                    <Button variant="outline" className="w-full">
                        <SlidersHorizontal className="mr-2 h-4 w-4" />
                        View Live Stats
                    </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[60vh] p-0 flex flex-col">
                    <SheetHeader className="p-6 text-left">
                        <SheetTitle>Live Queue Stats</SheetTitle>
                    </SheetHeader>
                    <div className="p-6 pt-0 flex-1 overflow-y-auto">
                        <KpiCards />
                    </div>
                </SheetContent>
            </Sheet>
        ) : (
            <KpiCards />
        )}
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Team Status</CardTitle>
                        <CardDescription>Current availability and assignment mode.</CardDescription>
                    </div>
                     <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Label htmlFor="assignment-mode" className="text-sm shrink-0">Assignment Mode:</Label>
                        <Select value={assignmentMode} onValueChange={(value: 'automatic' | 'ordered') => setAssignmentMode(value)}>
                            <SelectTrigger id="assignment-mode" className="w-full sm:w-[220px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="automatic">Automatic Fair-Play</SelectItem>
                                <SelectItem value="ordered">Ordered List</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {assignmentMode === 'automatic' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {activeStaff.map(member => (
                            <StaffStatusCard 
                                key={member.id} 
                                staffMember={member as Staff & { stats: any }}
                                onStatusChange={handleStaffStatusChange} 
                                isNextUp={member.id === nextUpStaffId}
                                appointments={appointments || []}
                                services={services || []}
                                resources={resources || []}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {staffOrder.map((member, index) => (
                            <Card key={member.id} className={cn("relative flex items-center p-3 gap-4", member.id === nextUpStaffId && "border-primary ring-2 ring-primary")}>
                                 {member.id === nextUpStaffId && (
                                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">Next Up</Badge>
                                )}
                                <div className="font-bold text-lg text-primary">{index + 1}</div>
                                <Avatar className="w-10 h-10">
                                    <AvatarImage src={member.avatarUrl} alt={member.name} />
                                    <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1">
                                    <p className="font-semibold">{member.name}</p>
                                    <div className="flex items-center gap-1">
                                        <p className="text-sm text-muted-foreground capitalize">{member.onBreak ? 'On Break' : member.status || 'Idle'}</p>
                                        <StaffResourceIndicator staffMember={member} appointments={appointments || []} services={services || []} resources={resources || []} />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => handleReorder(index, 'up')} disabled={index === 0}>
                                        <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => handleReorder(index, 'down')} disabled={index === staffOrder.length - 1}>
                                        <ArrowDown className="h-4 w-4" />
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
        
        <div className="grid flex-1 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start min-h-0">
            <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>Waiting ({waitingQueue.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 flex flex-col">
                    <ScrollArea className="h-full">
                        <div className="p-6 space-y-4">
                            <Button onClick={handleNotifyNext} disabled={!canNotifyNext} className="w-full">
                                <Bell className="mr-2 h-4 w-4" />
                                Notify Next Client
                            </Button>
                            {waitingQueue.length > 0 ? (
                                waitingQueue.map((walkIn, index) => {
                                    const estWait = estimatedWaitTimes.get(walkIn.id);
                                    return (
                                        <WaitingCustomerCard 
                                            key={walkIn.id} 
                                            walkIn={walkIn} 
                                            services={services || []} 
                                            resources={resources || []}
                                            onPrintTicket={setTicketToPrint} 
                                            onOpenAssignDialog={setWalkInToAssign} 
                                            queuePosition={index + 1} 
                                            estimatedWaitTime={estWait}
                                        />
                                    )
                                })
                            ) : (
                                <div className="text-center py-16 px-6 text-muted-foreground">
                                    <CheckCircle className="w-12 h-12 mx-auto mb-4" />
                                    <p>The queue is empty.</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
            <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>Notified ({notifiedQueue.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 flex flex-col">
                    <ScrollArea className="h-full">
                        <div className="p-6 space-y-4">
                            {notifiedQueue.length > 0 ? (
                                notifiedQueue.map(walkIn => (
                                    <NotifiedCustomerCard 
                                        key={walkIn.id}
                                        walkIn={walkIn}
                                        onStartService={handleStartServiceFromNotified}
                                        onSkip={() => handleWalkInStatusChange(walkIn.id, '', 'skipped')}
                                        skipTimeMinutes={selectedTenant?.queueSkipTimeMinutes || 5}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-16 px-6 text-muted-foreground">
                                    <p>No clients currently notified.</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
            <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>In Service ({servicingQueue.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 flex flex-col">
                    <ScrollArea className="h-full">
                        <div className="p-6 space-y-4">
                            {servicingQueue.length > 0 ? (
                                servicingQueue.map(appointment => (
                                    <ServicingCustomerCard 
                                        key={appointment.id} 
                                        appointment={appointment} 
                                        services={services || []} 
                                        resources={resources || []}
                                        staff={staff || []}
                                        onUpdateStatus={handleWalkInStatusChange}
                                        onPrintTicket={setTicketToPrint}
                                        onFinishService={handleFinishService}
                                        walkIns={walkIns}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-16 px-6 text-muted-foreground">
                                    <Coffee className="w-12 h-12 mx-auto mb-4" />
                                    <p>No active clients.</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
            <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>Ready for Checkout ({readyForCheckoutQueue.length})</CardTitle>
                </CardHeader>
                 <CardContent className="flex-1 p-0 flex flex-col">
                    <ScrollArea className="h-full">
                        <div className="p-6 space-y-4">
                            {selectedAppointmentIds.size > 1 && (
                                <Button onClick={handleGroupCheckout} className="w-full">
                                    <Users className="mr-2 h-4 w-4" />
                                    Group Checkout ({selectedAppointmentIds.size} items)
                                </Button>
                            )}
                            {readyForCheckoutQueue.length > 0 ? (
                                readyForCheckoutQueue.map(item => (
                                    <ReadyForCheckoutCard 
                                        key={item.id} 
                                        item={item} 
                                        services={services || []} 
                                        clients={clients || []}
                                        onCheckoutClick={handleCompleteClick}
                                        isSelected={selectedAppointmentIds.has(item.id)}
                                        onSelect={() => handleAppointmentSelect(item.id)}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-16 px-6 text-muted-foreground">
                                    <p>No clients are waiting for checkout.</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      </main>
    </div>
    
    <AssignStaffDialog
      open={!!walkInToAssign}
      onOpenChange={() => setWalkInToAssign(null)}
      walkIn={walkInToAssign}
      staff={staff || []}
      services={services || []}
      events={events || []}
      onAssign={handleManualAssign}
    />

    <Dialog open={!!ticketToPrint} onOpenChange={() => setTicketToPrint(null)}>
      <DialogContent className="sm:w-auto bg-transparent border-none shadow-none print-content">
        <DialogHeader className="sr-only">
          <DialogTitle>Print Walk-in Ticket</DialogTitle>
          <DialogDescription>A printable ticket for the walk-in client.</DialogDescription>
        </DialogHeader>
        <div id="ticket-area">
          {ticketData && <PrintWalkInTicket data={ticketData} />}
        </div>
        <DialogFooter className="print:hidden sm:justify-start">
          <Button variant="outline" onClick={() => setTicketToPrint(null)}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
     <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-content, .print-content * {
            visibility: visible;
          }
          .print-content {
            position: fixed !important;
            inset: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .print-content > *:not(#ticket-area) {
              display: none !important;
          }
          #ticket-area, #ticket-area * {
            visibility: visible;
          }
          #ticket-area {
            display: block !important;
          }
        }
      `}</style>
      
      <CompleteAppointmentDialog
        open={isNewRetailSaleOpen}
        onOpenChange={setIsNewRetailSaleOpen}
        appointmentsData={appointmentsToCheckout}
        onCheckoutComplete={handleCheckoutComplete}
        onRebook={handleRebook}
      />

       {selectedAppointmentData && (
        <TechnicianReviewDialog
            open={isTechnicianReviewOpen}
            onOpenChange={(isOpen) => {
                if(!isOpen) setSelectedAppointment(null);
                setIsTechnicianReviewOpen(isOpen);
            }}
            appointmentData={selectedAppointmentData}
            onSendToFrontDesk={handleSendToFrontDesk}
            staff={staff || []}
        />
      )}
    </>
  );
}
