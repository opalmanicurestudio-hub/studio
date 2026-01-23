

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Clock, CheckCircle, Coffee, ShieldAlert, Link as LinkIcon, MoreHorizontal, Printer, UserPlus, ArrowUp, ArrowDown, DollarSign, Bell, Lock } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useCollection, useFirebase, updateDocumentNonBlocking, useMemoFirebase, setDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { WalkIn, Staff, Appointment, Service, ActivityLog, Client, Event } from '@/lib/data';
import { formatDistanceToNowStrict, parseISO, addMinutes, differenceInMinutes, differenceInSeconds, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PrintWalkInTicket, WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { CompleteAppointmentDialog } from '@/components/planner/CompleteAppointmentDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

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

const StaffStatusCard = ({ staffMember, onStatusChange, isNextUp }: { staffMember: Staff, onStatusChange: (staffId: string, status: Partial<Staff>) => void, isNextUp: boolean }) => {
    const { events } = useInventory();
    
    const isBlocked = useMemo(() => {
        if (!events) return false;
        const now = new Date();
        return events.some(event => {
            if (event.type !== 'blocked') return false;
            const eventStart = parseISO(event.startTime);
            const eventEnd = parseISO(event.endTime);
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

const WaitingCustomerCard = ({ walkIn, services, onPrintTicket, onOpenAssignDialog, queuePosition }: { walkIn: WalkIn, services: any[], onPrintTicket: (data: WalkIn) => void, onOpenAssignDialog: (walkIn: WalkIn) => void, queuePosition: number }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="flex items-start gap-4">
                        <div className="text-3xl font-bold text-primary w-10 text-center">{queuePosition}</div>
                        <div>
                            <p className="font-bold text-xl">{walkIn.customerName}</p>
                            <div className="flex items-center gap-2 text-lg font-semibold text-primary mt-1">
                                <Clock className="h-5 w-5" />
                                <span>Waiting <Timer startTime={walkIn.checkInTime} /></span>
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


const ServicingCustomerCard = ({ walkIn, services, staff, onStatusChange, onPrintTicket, onFinishService }: { walkIn: WalkIn, services: any[], staff: Staff[], onStatusChange: (walkInId: string, staffId: string, status: WalkIn['status']) => void, onPrintTicket: (data: WalkIn) => void, onFinishService: (walkIn: WalkIn) => void }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    const assignedStaff = staff.find(s => s.id === walkIn.assignedStaffId);
    
    const waitTime = walkIn.serviceStartTime ? differenceInMinutes(parseISO(walkIn.serviceStartTime), parseISO(walkIn.checkInTime)) : null;

    const [elapsedTime, setElapsedTime] = useState<string | null>(null);

    const assignedSlot = useMemo(() => {
        if (!walkIn.serviceStartTime) return null;
        const start = parseISO(walkIn.serviceStartTime);
        const end = addMinutes(start, walkIn.estimatedDuration);
        return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
    }, [walkIn.serviceStartTime, walkIn.estimatedDuration]);

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;

        if (walkIn.status === 'servicing' && walkIn.serviceStartTime) {
            const startTime = parseISO(walkIn.serviceStartTime);
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
    }, [walkIn.status, walkIn.serviceStartTime]);

    return (
        <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-primary">Assigned to: {assignedStaff?.name || 'N/A'}</p>
                        {assignedSlot && <p className="text-sm font-semibold">{format(parseISO(walkIn.serviceStartTime!), 'MMM d, yyyy')} &middot; {assignedSlot}</p>}
                        {waitTime !== null && <p className="text-xs text-muted-foreground">Waited {waitTime} minutes</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                             <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground capitalize flex items-center gap-1">
                                {walkIn.status === 'servicing' && <Clock className="h-3 w-3" />}
                                {walkIn.status}
                            </Badge>
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onClick={() => onPrintTicket(walkIn)}>
                                        <Printer className="mr-2 h-4 w-4"/>Print Ticket
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        {walkIn.status === 'servicing' && elapsedTime && (
                            <p className="font-mono text-sm font-semibold text-primary">{elapsedTime}</p>
                        )}
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                 <div className="mt-4 border-t pt-4 flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onStatusChange(walkIn.id, assignedStaff?.id || '', 'skipped')}>Mark as Skipped</Button>
                    <Button size="sm" onClick={() => onFinishService(walkIn)}>Finish Service</Button>
                </div>
            </CardContent>
        </Card>
    )
};

const ReadyForCheckoutCard = ({ walkIn, services, staff, onCheckoutClick }: { walkIn: WalkIn, services: Service[], staff: Staff[], onCheckoutClick: (walkIn: WalkIn) => void }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    const assignedStaff = staff.find(s => s.id === walkIn.assignedStaffId);
    
    return (
        <Card className="bg-orange-500/5 border-orange-500/20">
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground">Finished with: {assignedStaff?.name || 'N/A'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <Badge className="bg-orange-500 hover:bg-orange-500/90 text-orange-foreground capitalize flex items-center gap-1">
                           <DollarSign className="h-3 w-3" />
                            Awaiting Checkout
                        </Badge>
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                 <div className="mt-4 border-t pt-4 flex justify-end gap-2">
                    <Button size="sm" onClick={() => onCheckoutClick(walkIn)}>Checkout Client</Button>
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
            const eventStart = parseISO(event.startTime);
            const eventEnd = parseISO(event.endTime);
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


export default function WalkInQueuePage() {
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc';
  const { toast } = useToast();
  const [ticketToPrint, setTicketToPrint] = useState<WalkIn | null>(null);
  const [checkoutAppointment, setCheckoutAppointment] = useState<Appointment | null>(null);
  const [walkInToAssign, setWalkInToAssign] = useState<WalkIn | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'automatic' | 'ordered'>('automatic');
  const [staffOrder, setStaffOrder] = useState<Staff[]>([]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'staff');
  }, [firestore, user, tenantId]);
  
  const walkInQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'walkIns');
  }, [firestore, user, tenantId]);

  const servicesQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `tenants/${tenantId}/services`);
  }, [firestore, user, tenantId]);
  
  const clientsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'clients');
  }, [firestore, user, tenantId]);

  const eventsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `tenants/${tenantId}/events`);
  }, [firestore, user, tenantId]);

  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(walkInQuery);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);
  const { data: fetchedEvents, isLoading: eventsLoading } = useCollection<Event>(eventsQuery);

  const events = useMemo(() => {
    if (!fetchedEvents) return [];
    return fetchedEvents.map(evt => {
      const startTime = (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : parseISO(evt.startTime as any);
      const endTime = (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : parseISO(evt.endTime as any);
      return ({ ...evt, startTime, endTime });
    });
  }, [fetchedEvents]);
  
  useEffect(() => {
    if (staff) {
        setStaffOrder(staff);
    }
  }, [staff]);

  const handleReorder = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...staffOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newOrder.length) {
        const [movedItem] = newOrder.splice(index, 1);
        newOrder.splice(targetIndex, 0, movedItem);
        setStaffOrder(newOrder);
    }
  };
  
    const canNotifyNext = useMemo(() => {
        if (!staff || !walkIns || !events) return false;
        const now = new Date();
        const idleStaff = staff.filter(s => {
            if (s.status !== 'idle' || s.onBreak) return false;

            // Check for blocking events
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
            
            return !isBlocked;
        });

        if (idleStaff.length === 0) return false;
        const waitingCustomers = walkIns.filter(w => w.status === 'waiting');
        if (waitingCustomers.length === 0) return false;
        const notifiedCustomers = walkIns.filter(w => w.status === 'notified');
        return notifiedCustomers.length < idleStaff.length;
    }, [staff, walkIns, events]);

    const handleNotifyNext = () => {
        if (!canNotifyNext || !walkIns || !staff || !firestore || !services) {
            toast({
                variant: 'destructive',
                title: 'Cannot Notify',
                description: 'There are no waiting clients or no available staff.',
            });
            return;
        }
        
        const idleStaff = staff.filter(s => s.status === 'idle' && !s.onBreak);
        const waitingCustomers = walkIns.filter(w => w.status === 'waiting').sort((a,b) => (a.waitForPreferredStaff ? 0 : 1) - (b.waitForPreferredStaff ? 0 : 1) || parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
        const customerToNotify = waitingCustomers[0];

        const isAnyStaffQualified = idleStaff.some(staffMember => (customerToNotify.requiredSkills || []).every(skill => (staffMember.skillSet || []).includes(skill)));
        const preferredStaff = customerToNotify.preferredStaffId ? idleStaff.find(s => s.id === customerToNotify.preferredStaffId) : null;
        const isPreferredStaffQualifiedAndAvailable = preferredStaff ? (customerToNotify.requiredSkills || []).every(skill => (preferredStaff.skillSet || []).includes(skill)) : false;

        if ((!customerToNotify.preferredStaffId && isAnyStaffQualified) || (customerToNotify.preferredStaffId && isPreferredStaffQualifiedAndAvailable)) {
            const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', customerToNotify.id);
            updateDocumentNonBlocking(walkInDocRef, {
                status: 'notified',
                notifiedTimestamp: new Date().toISOString()
            });
            toast({
                title: 'Client Notified',
                description: `${customerToNotify.customerName} has been notified it's their turn.`,
            });
        } else {
            toast({
                variant: 'destructive',
                title: 'No Qualified Staff Available',
                description: `There are no available staff members qualified for ${customerToNotify.customerName}'s requested services.`,
            });
        }
    };

    const assignWalkIn = useCallback((walkInId: string, staffId: string) => {
        if (!firestore || !walkIns || !staff || !services || !clients) return;

        const walkIn = walkIns.find(w => w.id === walkInId);
        const staffMember = staff.find(s => s.id === staffId);

        if (!walkIn || !staffMember) return;
        
        const now = new Date();
        
        const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        const walkInUpdate = {
            status: 'servicing' as const,
            assignedStaffId: staffId,
            serviceStartTime: now.toISOString(),
        };
        updateDocumentNonBlocking(walkInDocRef, walkInUpdate);

        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        const staffUpdate = { status: 'busy' as const };
        updateDocumentNonBlocking(staffDocRef, staffUpdate);

        const client = clients.find(c => c.id === walkIn.clientId);
        const service = services.find(s => s.id === walkIn.serviceIds[0]);
        if (service) {
            const appointmentEndTime = addMinutes(now, walkIn.estimatedDuration);
            const newAppointmentForFirestore: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & { startTime: Date, endTime: Date, clientName: string } = {
                clientId: walkIn.clientId || `walkin-${walkIn.id}`,
                clientName: client?.name || walkIn.customerName,
                serviceId: service.id,
                staffId: staffId,
                startTime: now,
                endTime: appointmentEndTime,
                status: 'servicing',
                isWalkIn: true,
                addOnIds: walkIn.serviceIds.slice(1),
                actualStartTime: now.toISOString(),
            };
            const aptDocRef = doc(firestore, 'tenants', tenantId, 'appointments', `apt-walkin-${walkIn.id}`);
            setDocumentNonBlocking(aptDocRef, newAppointmentForFirestore, {});
        }
  }, [firestore, tenantId, walkIns, staff, services, clients]);

  const handleStartServiceFromNotified = useCallback((walkIn: WalkIn) => {
    if (!staff || !services || !events) return;
    const now = new Date();
    const idleStaff = staff.filter(s => {
        if (s.status !== 'idle' || s.onBreak) return false;

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
        
        return !isBlocked;
    });

    const qualifiedStaff = idleStaff.filter(s => (walkIn.requiredSkills || []).every(skill => (s.skillSet || []).includes(skill)));
    
    if(qualifiedStaff.length === 0) {
      toast({ variant: 'destructive', title: 'No Qualified Staff Available' });
      return;
    }
    
    // Simplistic: assign to the first qualified idle staff. Could be enhanced with nextUp logic.
    const staffToAssign = qualifiedStaff[0];
    assignWalkIn(walkIn.id, staffToAssign.id);

  }, [staff, services, assignWalkIn, toast, events]);
  
  const handleManualAssign = (staffId: string) => {
    if (walkInToAssign) {
        assignWalkIn(walkInToAssign.id, staffId);
    }
    setWalkInToAssign(null);
  };

  const nextUpStaffId = useMemo(() => {
    if (!staff || !events) return null;
    const now = new Date();
    
    const idleStaff = staff.filter(s => {
        if (s.status !== 'idle' || s.onBreak) return false;
        
        // Check for blocking events
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
        
        return !isBlocked;
    });

    if (idleStaff.length === 0) return null;

    if (assignmentMode === 'automatic') {
        const sortedIdleStaff = idleStaff.sort((a, b) =>
        (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) -
        (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0)
        );
        return sortedIdleStaff[0]?.id;
    } else { // 'ordered'
        for (const orderedStaffMember of staffOrder) {
            if (idleStaff.some(s => s.id === orderedStaffMember.id)) {
                return orderedStaffMember.id;
            }
        }
        return null;
    }
  }, [staff, assignmentMode, staffOrder, events]);


  const waitingQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);

  const notifiedQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'notified').sort((a, b) => parseISO(a.notifiedTimestamp!).getTime() - parseISO(b.notifiedTimestamp!).getTime());
  }, [walkIns]);
  
  const servicingQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'assigned' || w.status === 'servicing').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);

  const readyForCheckoutQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'ready_for_checkout').sort((a, b) => (parseISO(a.serviceEndTime || a.checkInTime)).getTime() - (parseISO(b.serviceEndTime || b.checkInTime)).getTime());
  }, [walkIns]);
  
  const handleFinishService = (walkIn: WalkIn) => {
    if (!firestore) return;
    const nowISO = new Date().toISOString();
    
    const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
    updateDocumentNonBlocking(walkInDocRef, {
        status: 'ready_for_checkout',
        serviceEndTime: nowISO,
    });
    
    const appointmentId = `apt-walkin-${walkIn.id}`;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'ready_for_checkout',
        actualEndTime: nowISO
    });
    
    toast({
        title: "Service Finished",
        description: `${walkIn.customerName} is now ready for checkout.`
    });
  };

  const handleStaffStatusChange = (staffId: string, statusUpdate: Partial<Staff>) => {
    if (!firestore || !staff) return;
    
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
    if (!firestore) return;
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

  const handleCompleteClick = (walkIn: WalkIn) => {
    if (!services) return;
    const service = services.find(s => s.id === walkIn.serviceIds[0]);
    if (!service) return;

    const tempAppointment: Appointment = {
      id: `apt-walkin-${walkIn.id}`,
      clientId: walkIn.clientId || `walkin-${walkIn.customerName}`,
      clientName: walkIn.customerName,
      serviceId: service.id,
      staffId: walkIn.assignedStaffId,
      startTime: parseISO(walkIn.serviceStartTime || walkIn.checkInTime).toISOString(),
      endTime: addMinutes(parseISO(walkIn.serviceStartTime || walkIn.checkInTime), walkIn.estimatedDuration).toISOString(),
      status: 'ready_for_checkout',
      isWalkIn: true,
      addOnIds: walkIn.serviceIds.slice(1),
      actualStartTime: walkIn.serviceStartTime,
      actualEndTime: walkIn.serviceEndTime
    };
    setCheckoutAppointment(tempAppointment);
  };

  const handleConfirmCheckout = () => {
    if (!checkoutAppointment) return;

    const walkInId = checkoutAppointment.id.replace('apt-walkin-', '');
    handleWalkInStatusChange(walkInId, checkoutAppointment.staffId || '', 'completed');
    
    setCheckoutAppointment(null);
  };

  // Auto-skip timer
  useEffect(() => {
    const timer = setInterval(() => {
        if (!firestore || !walkIns) return;
        const now = new Date();
        const skipTimeMinutes = 5; // Replace with tenant setting

        walkIns.forEach(walkIn => {
            if (walkIn.status === 'notified' && walkIn.notifiedTimestamp) {
                const notifiedTime = parseISO(walkIn.notifiedTimestamp);
                if (differenceInMinutes(now, notifiedTime) >= skipTimeMinutes) {
                    handleWalkInStatusChange(walkIn.id, '', 'skipped');
                    toast({
                        title: 'Client Skipped',
                        description: `${walkIn.customerName} was automatically skipped for not arriving in time.`,
                    });
                }
            }
        });
    }, 10000); // Check every 10 seconds
    return () => clearInterval(timer);
  }, [firestore, walkIns, handleWalkInStatusChange, toast]);

  const ticketData: WalkInTicketData | null = ticketToPrint && services ? {
    id: ticketToPrint.id,
    name: ticketToPrint.customerName,
    services: services.filter(s => ticketToPrint.serviceIds.includes(s.id)),
    queuePosition: (waitingQueue.findIndex(w => w.id === ticketToPrint.id) + 1) || 1, 
    checkInTime: ticketToPrint.checkInTime,
  } : null;

  const checkoutAppointmentData = useMemo(() => {
    if (!checkoutAppointment || !services || !clients) return null;
    const clientData = clients.find(c => c.id === checkoutAppointment.clientId);
    const serviceData = services.find(s => s.id === checkoutAppointment.serviceId);

    const walkInClientName = checkoutAppointment.isWalkIn ?
      (walkIns?.find(w => `apt-walkin-${w.id}` === checkoutAppointment.id))?.customerName || 'Walk-in'
      : 'Unknown Client';

    const displayClient = clientData || {
      id: checkoutAppointment.clientId,
      name: checkoutAppointment.isWalkIn ? walkInClientName : 'Unknown Client',
      email: '',
      phone: '',
      avatarUrl: '',
      lifetimeValue: 0,
      lastAppointment: '',
    };
    
    return {
      appointment: checkoutAppointment,
      client: displayClient,
      service: serviceData,
    };
  }, [checkoutAppointment, clients, services, walkIns]);


  return (
    <>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Smart Walk-in Queue" />
      <main className="flex-1 p-4 md:p-8 space-y-8 flex flex-col">
        <Card>
            <CardHeader>
                <CardTitle>Public Check-in Link</CardTitle>
                <CardDescription>Share this link with your customers to let them join the queue from their own device.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="relative flex-grow w-full">
                         <Input value={`${typeof window !== 'undefined' ? window.location.origin : ''}/walk-in`} readOnly className="pl-9"/>
                         <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                    <Button variant="outline" className="w-full" onClick={() => {
                        const url = `${window.location.origin}/walk-in`;
                        navigator.clipboard.writeText(url);
                        toast({ title: 'Link Copied!', description: 'The public check-in link has been copied to your clipboard.' });
                    }}>
                        Copy
                    </Button>
                    <Button asChild className="w-full">
                        <Link href="/walk-in" target="_blank">
                            Open
                        </Link>
                    </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
        
        <Card className="col-span-1 md:col-span-2 lg:col-span-3">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {staff?.map(member => (
                                <StaffStatusCard 
                                    key={member.id} 
                                    staffMember={member} 
                                    onStatusChange={handleStaffStatusChange} 
                                    isNextUp={member.id === nextUpStaffId}
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
                                        <p className="text-sm text-muted-foreground capitalize">{member.onBreak ? 'On Break' : member.status || 'Idle'}</p>
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
                    <CardTitle>Waiting Queue ({waitingQueue.length})</CardTitle>
                    <CardDescription>Customers waiting to be notified.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4 flex-1 overflow-y-auto p-6">
                    <Button onClick={handleNotifyNext} disabled={!canNotifyNext} className="w-full">
                        <Bell className="mr-2 h-4 w-4" />
                        Notify Next Client
                    </Button>
                    {waitingQueue.length > 0 ? (
                        waitingQueue.map((walkIn, index) => (
                            <WaitingCustomerCard key={walkIn.id} walkIn={walkIn} services={services || []} onPrintTicket={setTicketToPrint} onOpenAssignDialog={setWalkInToAssign} queuePosition={index + 1} />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <CheckCircle className="w-12 h-12 mx-auto mb-4" />
                            <h3 className="font-semibold text-lg text-foreground">All Caught Up!</h3>
                            <p>There are no customers in the walk-in queue.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
             <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>Notified ({notifiedQueue.length})</CardTitle>
                    <CardDescription>Clients who have been notified.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4 flex-1 overflow-y-auto p-6">
                    {notifiedQueue.length > 0 ? (
                        notifiedQueue.map(walkIn => (
                            <NotifiedCustomerCard 
                                key={walkIn.id}
                                walkIn={walkIn}
                                onStartService={handleStartServiceFromNotified}
                                onSkip={() => handleWalkInStatusChange(walkIn.id, '', 'skipped')}
                                skipTimeMinutes={5}
                            />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <p>No clients currently notified.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
             <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>In-Progress ({servicingQueue.length})</CardTitle>
                    <CardDescription>Customers currently being serviced.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4 flex-1 overflow-y-auto p-6">
                    {servicingQueue.length > 0 ? (
                        servicingQueue.map(walkIn => (
                            <ServicingCustomerCard 
                                key={walkIn.id} 
                                walkIn={walkIn} 
                                services={services || []} 
                                staff={staff || []}
                                onStatusChange={handleWalkInStatusChange}
                                onPrintTicket={setTicketToPrint}
                                onFinishService={handleFinishService}
                            />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <Coffee className="w-12 h-12 mx-auto mb-4" />
                            <h3 className="font-semibold text-lg text-foreground">No Active Clients</h3>
                            <p>All staff members are currently available.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
             <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle>Ready for Checkout ({readyForCheckoutQueue.length})</CardTitle>
                    <CardDescription>Clients who have finished their service.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4 flex-1 overflow-y-auto p-6">
                    {readyForCheckoutQueue.length > 0 ? (
                        readyForCheckoutQueue.map(walkIn => (
                            <ReadyForCheckoutCard 
                                key={walkIn.id} 
                                walkIn={walkIn} 
                                services={services || []} 
                                staff={staff || []}
                                onCheckoutClick={handleCompleteClick}
                            />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <CheckCircle className="w-12 h-12 mx-auto mb-4" />
                            <p>No clients are waiting for checkout.</p>
                        </div>
                    )}
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
      
      {checkoutAppointmentData && (
          <CompleteAppointmentDialog
            open={!!checkoutAppointment}
            onOpenChange={() => setCheckoutAppointment(null)}
            appointmentData={checkoutAppointmentData}
            onConfirmCheckout={handleConfirmCheckout}
            onRebook={() => {}}
            staff={staff || []}
          />
      )}
    </>
  );
}

