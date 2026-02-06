

'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment, type Service } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee, GripVertical, Mail, Phone, ShieldAlert, ChevronDown } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO, isPast, differenceInDays, differenceInSeconds } from 'date-fns';
import { Reorder } from 'framer-motion';
import { formatPhoneNumber } from 'react-phone-number-input';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';


interface TeamStatusProps {
  staff: (Staff & { stats?: any })[] | null;
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void;
  appointments: Appointment[] | null;
  services: Service[] | null;
  onReorder: (newOrder: Staff[]) => void;
}

const StaffMemberCard = ({ member, isNextUp, onStatusChange, appointments, services }: {
    member: Staff & { stats: any, availability: { status: string, serviceName?: string | null, isOvertime?: boolean, elapsedTime?: string | null } | null },
    isNextUp: boolean,
    onStatusChange: TeamStatusProps['onStatusChange'],
    appointments: Appointment[] | null,
    services: Service[] | null,
}) => {
    
    const [elapsedTime, setElapsedTime] = useState<string | null>(null);
    const [isOvertime, setIsOvertime] = useState(false);
    const [currentService, setCurrentService] = useState<Service | null>(null);

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;

        if (member.status === 'busy' && member.active && !member.onBreak) {
            const currentApt = appointments?.find(apt => apt.staffId === member.id && apt.status === 'servicing');
            if (currentApt && currentApt.actualStartTime) {
                const service = services?.find(s => s.id === currentApt.serviceId);
                setCurrentService(service || null);

                const startTime = parseISO(currentApt.actualStartTime as string);
                
                const updateTimer = () => {
                    const now = new Date();
                    const diffInSeconds = differenceInSeconds(now, startTime);
                    
                    const hours = Math.floor(diffInSeconds / 3600);
                    const minutes = Math.floor((diffInSeconds % 3600) / 60);
                    const seconds = diffInSeconds % 60;

                    let elapsedTimeString = '';
                    if (hours > 0) {
                      elapsedTimeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    } else {
                      elapsedTimeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    }
                    setElapsedTime(elapsedTimeString);
                    
                    if (service) {
                        const elapsedMinutes = diffInSeconds / 60;
                        setIsOvertime(elapsedMinutes > service.duration);
                    }
                };

                updateTimer();
                timer = setInterval(updateTimer, 1000);

            } else {
                setElapsedTime(null);
                setIsOvertime(false);
                setCurrentService(null);
            }
        } else {
            setElapsedTime(null);
            setIsOvertime(false);
            setCurrentService(null);
        }

        return () => {
          if (timer) {
            clearInterval(timer);
          }
        };

    }, [member, appointments, services]);


    const getStatus = () => {
        if (!member.active) return { text: 'Clocked Out', className: 'bg-gray-100 text-gray-800' };
        if (member.onBreak) return { text: 'On Break', className: 'bg-yellow-100 text-yellow-800' };
        if (member.status === 'busy') return { text: 'Busy', className: 'bg-red-100 text-red-700' };
        return { text: 'Idle', className: 'bg-green-100 text-green-800' };
    };

    const status = getStatus();

    const licenseInfo = useMemo(() => {
        if (!member.compliance?.licenseExpiry) return null;
        try {
            const licenseExpiry = parseISO(member.compliance.licenseExpiry);
            if (licenseExpiry) {
                const daysUntil = differenceInDays(licenseExpiry, new Date());
                const expired = isPast(licenseExpiry);
                const expiringSoon = daysUntil <= 30 && !expired;

                return {
                    isExpired: expired,
                    isExpiringSoon: expiringSoon,
                    daysUntilExpiry: daysUntil,
                    expiryDate: licenseExpiry,
                };
            }
        } catch (e) {
            console.error("Invalid date format for license expiry:", member.compliance.licenseExpiry);
        }
        return null;
    }, [member.compliance?.licenseExpiry]);


    const renderActionButtons = () => {
        if (!member.active) {
            return <Button className="w-full" size="sm" onClick={() => onStatusChange(member.id, 'clock_in')}><Clock className="mr-2 h-4 w-4"/>Clock In</Button>
        }
        if (member.onBreak) {
            return (
                 <div className="flex flex-col gap-2 w-full">
                    <Button variant="destructive" size="sm" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
                    <Button variant="outline" size="sm" onClick={() => onStatusChange(member.id, 'break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>
                </div>
            )
        }
        return (
            <div className="flex flex-col gap-2 w-full">
                <Button variant="destructive" size="sm" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
                <Button variant="outline" size="sm" onClick={() => onStatusChange(member.id, 'break_start')}><Coffee className="mr-2 h-4 w-4"/>Start Break</Button>
            </div>
        )
    };

    return (
        <Reorder.Item
            value={member}
            id={member.id}
            className="w-56 shrink-0 relative"
            whileDrag={{ scale: 1.05, zIndex: 10, boxShadow: '0px 10px 20px rgba(0,0,0,0.2)' }}
            transition={{ duration: 0.1 }}
        >
            <Card className={cn("text-center flex flex-col h-full cursor-grab active:cursor-grabbing", isOvertime && "border-destructive ring-2 ring-destructive")}>
                <GripVertical className="absolute top-1/2 -translate-y-1/2 left-1 text-muted-foreground/50" size={20}/>
                <CardHeader className="p-3">
                     <div className="flex justify-between items-start">
                        {isNextUp ? (
                            <Badge className="bg-green-500 text-white">Next Up</Badge>
                        ) : (
                            <Badge variant={member.active ? (member.onBreak ? 'secondary' : 'default') : 'outline'} className={cn('capitalize', {
                                'bg-green-100 text-green-800 dark:bg-green-900/50': member.active && !member.onBreak && !isNextUp && member.status !== 'busy',
                                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50': member.active && member.onBreak,
                                'bg-red-100 text-red-700 dark:bg-red-900/50': member.status === 'busy',
                            })}>
                                {status.text}
                            </Badge>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 flex-1 flex flex-col items-center">
                    <Avatar className="w-16 h-16 mx-auto mb-2">
                        <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" />
                        <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <h3 className="text-sm font-semibold truncate w-full">{member.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{member.role}</p>

                    <div className="text-xs font-semibold mt-2 flex flex-col items-center justify-center text-center min-h-[36px]">
                        {elapsedTime && currentService ? (
                            <div>
                                <p className="text-xs text-muted-foreground truncate">{currentService.name}</p>
                                <p className={cn("text-lg font-mono font-semibold", isOvertime ? "text-destructive" : "text-primary")}>{elapsedTime}</p>
                            </div>
                        ) : member.availability && member.availability.status ? (
                            <span className="text-base text-blue-500">{member.availability.status}</span>
                        ) : null}
                    </div>
                    
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="details" className="border-none">
                            <AccordionTrigger className="py-1 px-2 text-xs text-muted-foreground hover:no-underline rounded-md hover:bg-accent w-full justify-center">
                                Details
                            </AccordionTrigger>
                            <AccordionContent className="pt-2">
                                 <Separator className="mb-3" />
                                <div className="w-full text-left space-y-2 text-xs">
                                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Today's Sales</span><span className="font-semibold">${(member.stats?.totalSales || 0).toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Tips</span><span className="font-semibold">${(member.stats?.tips || 0).toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Consumption</span><span className="font-semibold">${(member.stats?.consumptionValue || 0).toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center font-bold"><span className="text-primary">Est. Take-home</span><span className="text-primary">${(member.stats?.earnings || 0).toFixed(2)}</span></div>
                                </div>
                                {licenseInfo && (licenseInfo.isExpired || licenseInfo.isExpiringSoon) && (
                                    <div className="mt-2 text-left p-2 rounded-lg bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                                        <ShieldAlert className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-semibold">{licenseInfo.isExpired ? 'License Expired' : 'License Expiring'}</p>
                                            <p>
                                                {licenseInfo.isExpired 
                                                ? `Expired on ${format(licenseInfo.expiryDate!, 'MMM d, yyyy')}.`
                                                : `Expires in ${licenseInfo.daysUntilExpiry} days.`
                                                }
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter className="p-2 border-t mt-auto flex flex-col gap-2">
                    <div className="w-full flex flex-col gap-2">
                        {renderActionButtons()}
                    </div>
                </CardFooter>
            </Card>
        </Reorder.Item>
    )
}


export const TeamStatus: React.FC<TeamStatusProps> = ({ staff, onStatusChange, appointments, services, onReorder }) => {
    
    const staffWithAvailability = useMemo(() => {
        return staff?.map(member => {
            let availability: { status: string, serviceName?: string, isOvertime?: boolean, elapsedTime?: string } | null = null;
            if (member.status === 'busy' && member.active && !member.onBreak) {
                const now = new Date();
                const currentAppointment = appointments?.find(apt => apt.staffId === member.id && new Date(apt.startTime) <= now && new Date(apt.endTime) > now);
                if (currentAppointment) {
                    const service = services?.find(s => s.id === currentAppointment.serviceId);
                    const minutesRemaining = differenceInMinutes(new Date(currentAppointment.endTime), now);
                    if (minutesRemaining <= 0) {
                        availability = { status: "Finishing up", serviceName: service?.name };
                    } else {
                        availability = { status: `Free in ${minutesRemaining} min`, serviceName: service?.name };
                    }
                } else {
                     availability = { status: 'Busy' };
                }
            } else if (member.active && !member.onBreak && member.status === 'idle') {
                availability = { status: 'Idle' };
            }
            return { ...member, availability };
        }) || [];
    }, [staff, appointments, services]);

    const idleStaff = useMemo(() => {
        if (!staff) return [];
        return staff.filter(s => s.active && !s.onBreak && s.status === 'idle');
    }, [staff]);

    const nextUpStaffId = idleStaff.length > 0 ? idleStaff[0].id : null;

    if (!staff) return null;

    return (
        <div>
            <h2 className="text-xl font-bold mb-4">Team Status & Turn Order</h2>
            <ScrollArea>
                <Reorder.Group axis="x" values={staff} onReorder={onReorder} className="flex space-x-4 pb-4">
                    {staffWithAvailability.map(member => (
                        <StaffMemberCard
                            key={member.id}
                            member={member as Staff & { stats: any; availability: any }}
                            onStatusChange={onStatusChange}
                            isNextUp={member.id === nextUpStaffId}
                            appointments={appointments}
                            services={services}
                        />
                    ))}
                </Reorder.Group>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
};
