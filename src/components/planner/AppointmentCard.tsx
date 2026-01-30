
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format, differenceInMinutes, isPast, parseISO, differenceInSeconds } from 'date-fns';
import {
  ShieldPlus,
  AlertTriangle,
  Ear,
  ImageIcon,
  Award,
  MoreHorizontal,
  DollarSign,
  Clock,
  Briefcase,
  FileText,
  FlaskConical,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock10,
  Printer,
  TrendingUp,
  Receipt,
  ListChecks,
  ShieldAlert,
  PlusCircle,
  Mail,
  Phone,
  MessageSquare,
  Send,
  User as UserIcon,
  Book,
  Calendar,
  FileText as TicketIcon,
  Users,
  Play,
  Square,
  Repeat,
  Link as LinkIcon,
  Car,
  Building,
  HardHat,
  Cake,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, CustomFormula, services, Resource } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { type ReceiptData } from './PrintReceipt';
import { type TicketData } from './PrintTicket';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useInventory } from '@/context/InventoryContext';

interface AppointmentCardProps {
  appointment: Appointment;
  client: Client;
  service: Service;
  resources: Resource[];
  style: React.CSSProperties;
  tmhr: number;
  onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void;
  onDelete: (appointmentId: string) => void;
  onCompleteClick: (appointment: Appointment) => void;
  onPrintReceipt: (data: Omit<ReceiptData, 'business'>) => void;
  onPrintTicket: (data: Omit<TicketData, 'business'>) => void;
  onEdit: (appointment: Appointment) => void;
  onReschedule: (appointment: Appointment) => void;
  onRebook: (appointment: Appointment) => void;
  onStartService: (appointmentId: string) => void;
  onFinishService: (appointment: Appointment) => void;
  onBookNewForClient: (clientId: string) => void;
}

const AppointmentDetails = ({
    appointment,
    client,
    service,
    tmhr,
    revenue,
    breakEvenCost,
    netProfit,
    timeCost,
    productCost,
    equipmentCost,
    addOnServices,
    requiredResources,
    onEdit,
    onUpdateStatus,
    onDelete,
    onReschedule,
    onBookNewForClient,
}: {
    appointment: Appointment;
    client: Client;
    service: Service;
    tmhr: number;
    revenue: number;
    breakEvenCost: number;
    netProfit: number;
    timeCost: number;
    productCost: number;
    equipmentCost: number;
    addOnServices: Service[];
    requiredResources: Resource[];
    onEdit: (appointment: Appointment) => void;
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void;
    onDelete: (appointmentId: string) => void;
    onReschedule: (appointment: Appointment) => void;
    onBookNewForClient: (clientId: string) => void;
}) => {
    const { toast } = useToast();

  return (
    <ScrollArea className="h-[80vh] p-6">
        <div className="space-y-6">
             <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                    <h3 className="font-semibold text-lg">{client.name}</h3>
                </div>
                <div className="text-muted-foreground text-sm space-y-1">
                    <a href={`mailto:${client.email}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                        <Mail className="w-4 h-4" /> {client.email}
                    </a>
                     <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        <span>{client.phone}</span>
                        <a href={`tel:${client.phone}`} className="ml-auto p-1.5 rounded-md hover:bg-muted"><Phone className="w-4 h-4 text-primary" /></a>
                        <a href={`sms:${client.phone}`} className="p-1.5 rounded-md hover:bg-muted"><MessageSquare className="w-4 h-4 text-primary" /></a>
                    </div>
                </div>
                <div className="text-muted-foreground text-sm pt-4 space-y-2">
                    <div>
                      <p className='font-medium text-foreground'>{service.name}</p>
                      {addOnServices.map(addon => (
                          <p key={addon.id} className="text-xs pl-4">+ {addon.name}</p>
                      ))}
                    </div>
                    <div className='flex flex-col'>
                      <span className='font-medium'>{format(appointment.startTime, 'EEEE, LLL d, yyyy')}</span>
                      <span>{format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}</span>
                    </div>
                    {requiredResources.length > 0 && (
                        <div className="flex items-center gap-2">
                            {requiredResources.map(resource => (
                                <Badge key={resource.id} variant="outline" className="gap-1.5">
                                    {resource.type === 'room' ? <Building className="w-3 h-3"/> : <HardHat className="w-3 h-3"/>}
                                    {resource.name}
                                </Badge>
                            ))}
                        </div>
                    )}
                    <div className="pt-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                                <MoreHorizontal className="w-4 h-4 mr-2" />
                                Actions
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                            <DropdownMenuItem asChild>
                                <Link href={`/clients/${client.id}`}>
                                    <UserIcon className="w-4 h-4 mr-2"/>
                                    View Client Profile
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEdit(appointment)}>
                                <Edit className="w-4 h-4 mr-2"/>
                                Edit Details
                            </DropdownMenuItem>
                             <DropdownMenuItem onClick={() => onReschedule(appointment)}>
                                <Calendar className="w-4 h-4 mr-2"/>
                                Reschedule
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                                toast({ title: 'Confirmation Resent', description: `An email confirmation has been resent to ${client.email}.`})
                            }}>
                                <Send className="w-4 h-4 mr-2"/>
                                Resend Confirmation
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onBookNewForClient(client.id)}>
                                <Book className="w-4 h-4 mr-2"/>
                                Book New Appointment
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => onUpdateStatus(appointment.id, 'cancelled')}
                            >
                                <XCircle className="w-4 h-4 mr-2" />
                                Cancel Appointment
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                </div>
            </div>

            {(appointment.inspirationPhotoUrl || client.inspirationPhotoUrl) && (
                <div className="space-y-3">
                    <h4 className="font-medium text-sm">Inspiration Photo</h4>
                    <div className="rounded-lg overflow-hidden border">
                        <Image src={appointment.inspirationPhotoUrl || client.inspirationPhotoUrl} alt="Inspiration" width={400} height={300} className="object-cover" />
                    </div>
                </div>
            )}

            <Separator className="my-6" />

            <div className="space-y-4">
                <h4 className="font-medium text-sm">Financials</h4>
                 <div className="grid grid-cols-2 gap-4 w-full text-center">
                    <div className="rounded-md bg-green-500/10 p-3">
                        <p className="text-xs text-green-800/80 dark:text-green-400/80">Revenue</p>
                        <p className="font-bold text-xl text-green-800 dark:text-green-400">${revenue.toFixed(2)}</p>
                    </div>
                    <div className="rounded-md bg-red-500/10 p-3">
                        <p className="text-xs text-red-800/80 dark:text-red-400/80">Cost</p>
                        <p className="font-bold text-xl text-red-800 dark:text-red-400">${breakEvenCost.toFixed(2)}</p>
                    </div>
                    <div className="rounded-md bg-blue-500/10 p-3 col-span-2">
                        <p className="text-xs text-blue-800/80 dark:text-blue-400/80">Net Profit</p>
                        <p className="font-bold text-xl text-blue-800 dark:text-blue-400">${netProfit.toFixed(2)}</p>
                    </div>
                </div>
              <div className="text-xs space-y-2 text-muted-foreground pt-2">
                 <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/>Time Cost</span> <span className='font-mono'>${timeCost.toFixed(2)}</span></div>
                 <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Product Cost</span> <span className='font-mono'>${productCost.toFixed(2)}</span></div>
                 <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Equipment Cost</span> <span className='font-mono'>${equipmentCost.toFixed(2)}</span></div>
              </div>
            </div>
            
            <Separator className="my-6" />
            
            <div className="space-y-4">
                <h4 className="font-medium text-sm">Client Intel</h4>
                 {client.customFormulas && client.customFormulas.length > 0 && (
                    <div className='space-y-3'>
                        <h5 className='font-semibold text-xs flex items-center gap-2'><FlaskConical className="w-4 h-4 text-blue-500"/>Custom Formula: {client.customFormulas[0].name}</h5>
                         <div className='p-3 rounded-md bg-blue-500/5 border border-blue-500/20 space-y-2'>
                            {client.customFormulas[0].items.map((item, index) => (
                                <div key={index} className='text-sm'>
                                    <p className='font-medium'>{item.quantityUsed}{item.unit} {item.productName}</p>
                                    {item.note && <p className='text-xs text-muted-foreground pl-4'>&ndash; {item.note}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="text-sm space-y-2">
                    {client.medicalNotes && <div className="flex items-center gap-2"><ShieldPlus className="w-4 h-4 text-red-500 flex-shrink-0"/><span>{client.medicalNotes}</span></div>}
                    {client.allergyNotes && <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0"/><span>{client.allergyNotes}</span></div>}
                    {client.sensoryNeeds && <div className="flex items-center gap-2"><Ear className="w-4 h-4 text-blue-500 flex-shrink-0"/><span>{client.sensoryNeeds}</span></div>}
                    {client.isMember && <div className="flex items-center gap-2"><Award className="w-4 h-4 flex-shrink-0"/><span>Client is a member</span></div>}
                </div>
            </div>
        </div>
    </ScrollArea>
  )
}

export function AppointmentCard({
  appointment,
  client,
  service,
  resources,
  style,
  tmhr,
  onUpdateStatus,
  onDelete,
  onCompleteClick,
  onPrintReceipt,
  onPrintTicket,
  onEdit,
  onReschedule,
  onRebook,
  onStartService,
  onFinishService,
  onBookNewForClient,
}: AppointmentCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { inventory } = useInventory();
  
  const scheduledDuration = useMemo(() => {
    if (!appointment.startTime || !appointment.endTime) return 0;
    const start = typeof appointment.startTime === 'string' ? parseISO(appointment.startTime) : appointment.startTime;
    const end = typeof appointment.endTime === 'string' ? parseISO(appointment.endTime) : appointment.endTime;
    return differenceInMinutes(end, start);
  }, [appointment.startTime, appointment.endTime]);

  const isCompact = scheduledDuration < 30;

  const isBirthday = useMemo(() => {
    if (!client?.birthday) return false;
    try {
        const appointmentDate = typeof appointment.startTime === 'string' 
            ? parseISO(appointment.startTime) 
            : appointment.startTime;
        
        const birthdayDate = parseISO(client.birthday);
        
        const appointmentMonthDay = format(appointmentDate, 'MM-dd');
        const birthdayMonthDay = format(birthdayDate, 'MM-dd');

        return appointmentMonthDay === birthdayMonthDay;
    } catch (e) {
        console.error("Error parsing birthday date:", client.birthday, e);
        return false;
    }
  }, [client?.birthday, appointment.startTime]);

  const handleShareLink = () => {
    if (!appointment.checkInToken) {
        toast({
            variant: 'destructive',
            title: 'No Check-in Link',
            description: 'This appointment does not have a check-in link associated with it.',
        });
        return;
    }
    const checkInUrl = `${window.location.origin}/check-in/${appointment.checkInToken}`;
    navigator.clipboard.writeText(checkInUrl);
    toast({
        title: 'Link Copied',
        description: 'The check-in link has been copied to your clipboard.',
    });
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;

    if (appointment.status === 'servicing' && appointment.actualStartTime) {
      const startTime = parseISO(appointment.actualStartTime as string);
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
  }, [appointment.status, appointment.actualStartTime]);

  const finalDuration = useMemo(() => {
    if (appointment.actualStartTime && appointment.actualEndTime) {
      const start = parseISO(appointment.actualStartTime);
      const end = parseISO(appointment.actualEndTime);
      return differenceInMinutes(end, start);
    }
    return null;
  }, [appointment.actualStartTime, appointment.actualEndTime]);

  const addOnServices = useMemo(() => {
      return (appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
  }, [appointment.addOnIds]);

  const { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost } = useMemo(() => {
    let totalRevenue = service.price;
    
    const allServices = [service, ...addOnServices];

    let totalProductCost = 0;
    let totalEquipmentCost = 0;
    
    allServices.forEach(s => {
        if(s.type === 'addon') totalRevenue += s.price;
        
        let productsToUse: { productId?: string; quantityUsed: number; productName?: string; costPerUnit?: number; id?:string }[] = s.products || [];
        totalProductCost += productsToUse.reduce((sum, p) => {
            const productData = inventory.find(i => i.id === (p.id || p.productId));
            return sum + ((productData?.costPerUnit || 0) * (p.quantityUsed || 1));
        }, 0);

        totalEquipmentCost += (s.equipment || []).reduce((sum, e) => {
            const totalDuration = differenceInMinutes(appointment.endTime, appointment.startTime);
            const lifespanInMinutes = (e.lifespanYears || 5) * 365 * 8 * 60;
            const costPerMinute = (e.costPerUnit || 0) / lifespanInMinutes;
            return sum + (costPerMinute * totalDuration);
        }, 0);
    });

    const totalDuration = differenceInMinutes(appointment.endTime, appointment.startTime);
    const totalTimeCost = (totalDuration / 60) * tmhr;

    const totalBreakEvenCost = totalTimeCost + totalProductCost + totalEquipmentCost;
    const totalNetProfit = totalRevenue - totalBreakEvenCost;

    return { revenue: totalRevenue, breakEvenCost: totalBreakEvenCost, netProfit: totalNetProfit, timeCost: totalTimeCost, productCost: totalProductCost, equipmentCost: totalEquipmentCost };
  }, [service, appointment, tmhr, client, addOnServices, inventory]);

  const requiredResources = useMemo(() => {
    if (!service.requiredResourceIds || !resources) return [];
    return resources.filter(r => service.requiredResourceIds!.includes(r.id));
  }, [service, resources]);


  const statusDisplay: { [key in Appointment['status']]: { text: string; className: string; bgClassName: string } } = {
    confirmed: { text: 'Confirmed', className: 'border-blue-500/30 text-blue-800 dark:text-blue-300', bgClassName: 'bg-blue-500/10' },
    servicing: { text: 'In Service', className: 'border-yellow-500/30 text-yellow-800 dark:text-yellow-300', bgClassName: 'bg-yellow-500/10' },
    completed: { text: 'Completed', className: 'border-green-500/30 text-green-800 dark:text-green-300', bgClassName: 'bg-green-500/10' },
    cancelled: { text: 'Cancelled', className: 'border-red-500/30 text-red-800 dark:text-red-300', bgClassName: 'bg-red-500/10' },
    deposit_pending: { text: 'Awaiting Payment', className: 'border-pink-500/30 text-pink-800 dark:text-pink-300', bgClassName: 'bg-pink-500/10' },
    ready_for_checkout: { text: 'Checkout', className: 'border-orange-500/30 text-orange-800 dark:text-orange-300 animate-pulse', bgClassName: 'bg-orange-500/10' },
  };

  const hasPadBefore = (service.padBefore || 0) > 0;
  const hasPadAfter = (service.padAfter || 0) > 0;
  const totalDurationWithPadding = service.duration + (service.padBefore || 0) + (service.padAfter || 0);

  const beforeHeight = hasPadBefore ? `${(service.padBefore! / totalDurationWithPadding) * 100}%` : '0px';
  const mainHeight = `${(service.duration / totalDurationWithPadding) * 100}%`;
  const afterHeight = hasPadAfter ? `${(service.padAfter! / totalDurationWithPadding) * 100}%` : '0px';
  

  const MainContent = () => {
    const serviceNameDisplay = isCompact
      ? service.name
      : addOnServices.length > 0
      ? `${service.name} + ${addOnServices.length} add-on(s)`
      : service.name;

    const handleCardClick = () => {
      setIsDetailsOpen(true);
    };

    const handleStartClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onStartService(appointment.id);
    };

    const handleFinishClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onFinishService(appointment);
    };
    
    const handleCheckoutClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onCompleteClick(appointment);
    }

    return (
    <div 
        className={cn(
            'p-2 border rounded-lg w-full h-full flex flex-col justify-between cursor-pointer',
            statusDisplay[appointment.status]?.bgClassName,
            statusDisplay[appointment.status]?.className,
            hasPadBefore ? 'rounded-t-none' : '',
            hasPadAfter ? 'rounded-b-none' : ''
        )}
        onClick={handleCardClick}
    >
      <div className="flex-grow flex flex-col justify-between min-h-0">
        <div className="flex items-start justify-between">
            <div className='flex-1 min-w-0'>
                <p className="font-semibold text-xs leading-tight truncate flex items-center gap-1.5">
                  {appointment.isWalkIn && <Users className="h-3 w-3 text-muted-foreground" />}
                  {isBirthday && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Cake className="h-4 w-4 text-pink-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>It's {client.name.split(' ')[0]}'s Birthday!</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                  )}
                  {client.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{serviceNameDisplay}</p>
                 {!isCompact && requiredResources.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
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
                )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-haspopup="true"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 flex-shrink-0 -mr-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => setIsDetailsOpen(true)}>
                    <FileText className="mr-2" /> View Details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleCheckoutClick}
                >
                  <CheckCircle className="mr-2" /> Checkout
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareLink}>
                    <LinkIcon className="mr-2 h-4 w-4" /> Share Check-in Link
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => onPrintTicket({ appointment, client, service })}>
                    <TicketIcon className="mr-2" /> Print Ticket
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(appointment)}>
                    <Edit className="mr-2" />
                    Edit Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReschedule(appointment)}>
                    <Calendar className="mr-2" /> Reschedule
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRebook(appointment)}>
                    <Repeat className="mr-2 h-4 w-4" />
                    Rebook
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger><Clock10 className="mr-2"/> Change Status</DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => onUpdateStatus(appointment.id, 'confirmed')}>Confirmed</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onUpdateStatus(appointment.id, 'cancelled')}>Cancelled</DropdownMenuItem>
                             <DropdownMenuItem onClick={() => onUpdateStatus(appointment.id, 'deposit_pending')}>Awaiting Payment</DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>
                <Separator />
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}>
                    <Trash2 className="mr-2" /> Delete Appointment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
        <div className="mt-1 flex items-end justify-between">
            <div className="flex flex-col items-start gap-1">
                {!isCompact && (
                  <>
                    {appointment.status === 'servicing' && elapsedTime ? (
                        <p className="font-mono text-sm font-semibold text-yellow-600 dark:text-yellow-400 mt-1">{elapsedTime}</p>
                    ) : finalDuration !== null ? (
                        <div className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
                            <p>Scheduled: {format(appointment.startTime, 'h:mm')} - {format(appointment.endTime, 'h:mm a')}</p>
                            <p>Actual: <span className="font-semibold text-foreground">{finalDuration} min</span></p>
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground">{format(appointment.startTime, 'h:mm')} - {format(appointment.endTime, 'h:mm a')}</p>
                    )}
                  </>
                )}
                <div className="flex items-center gap-1 flex-wrap">
                    {appointment.status !== 'ready_for_checkout' && (
                        <Badge
                            variant="secondary"
                            className={cn(
                                "text-[10px] h-5 px-1.5 capitalize",
                                statusDisplay[appointment.status]?.className,
                                statusDisplay[appointment.status]?.bgClassName
                            )}
                        >
                            {appointment.status === 'servicing' && <Clock className="w-3 h-3 mr-1 animate-spin" />}
                            {statusDisplay[appointment.status]?.text}
                        </Badge>
                    )}
                     {appointment.checkInStatus === 'on_my_way' && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize border-blue-500/30 text-blue-800 dark:text-blue-300 bg-blue-500/10">
                            <Car className="w-3 h-3 mr-1" />
                            On My Way
                        </Badge>
                    )}
                    {appointment.checkInStatus === 'arrived' && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize border-green-500/30 text-green-800 dark:text-green-300 bg-green-500/10">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Arrived
                        </Badge>
                    )}
                    {appointment.checkInStatus === 'running_late' && (
                        <Badge variant="destructive" className="text-[10px] h-5 px-1.5 capitalize">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {appointment.lateTimeMinutes}m late
                        </Badge>
                    )}
                </div>
            </div>
             <div className="flex items-center gap-2">
                 {appointment.status === 'ready_for_checkout' ? (
                    <Badge
                        variant="secondary"
                        className={cn(
                            "text-xs h-7 px-2.5 capitalize font-semibold",
                            statusDisplay[appointment.status]?.className,
                            statusDisplay[appointment.status]?.bgClassName,
                            'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-orange-500'
                        )}
                        onClick={handleCheckoutClick}
                    >
                        <DollarSign className="w-3 h-3 mr-1.5" />
                        {statusDisplay[appointment.status]?.text}
                    </Badge>
                ) : null}
                 {appointment.status === 'confirmed' && (
                  <Button variant="ghost" size="icon" className="rounded-full bg-primary text-primary-foreground h-7 w-7 hover:bg-primary/90" onClick={handleStartClick}>
                    <Play className="w-3 h-3 fill-current" />
                  </Button>
                )}
                {appointment.status === 'servicing' && (
                  <Button variant="ghost" size="icon" className="rounded-full bg-primary text-primary-foreground h-7 w-7 hover:bg-primary/90" onClick={handleFinishClick}>
                    <Square className="w-3 h-3 fill-current" />
                  </Button>
                )}
            </div>
        </div>
      </div>
    </div>
  )};


  const DialogOrSheet = isMobile ? Sheet : Sheet;
  const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;
  const imageUrl = appointment.inspirationPhotoUrl || client.inspirationPhotoUrl;

  return (
    <div
      style={style}
      className="absolute w-full flex flex-col"
    >
      {hasPadBefore && (
        <div style={{ height: beforeHeight }} className="bg-muted/30 rounded-t-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      <div style={{ height: mainHeight }} className="min-h-fit">
        <MainContent />
      </div>
      {hasPadAfter && (
        <div style={{ height: afterHeight }} className="bg-muted/30 rounded-b-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      
      <DialogOrSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogOrSheetContent className={cn(isMobile ? "h-[90vh] flex flex-col p-0" : "p-0")}>
          <SheetHeader className="p-6 pb-0">
            <SheetTitle>Appointment Details</SheetTitle>
            <SheetDescription>
                A full breakdown of this appointment.
            </SheetDescription>
          </SheetHeader>
          <AppointmentDetails 
            appointment={appointment} 
            client={client} 
            service={service} 
            tmhr={tmhr}
            revenue={revenue}
            breakEvenCost={breakEvenCost}
            netProfit={netProfit}
            timeCost={timeCost}
            productCost={productCost}
            equipmentCost={equipmentCost}
            addOnServices={addOnServices}
            requiredResources={requiredResources}
            onEdit={onEdit}
            onUpdateStatus={onUpdateStatus}
            onDelete={onDelete}
            onReschedule={onReschedule}
            onBookNewForClient={onBookNewForClient}
          />
        </DialogOrSheetContent>
      </DialogOrSheet>

      {imageUrl && (
          <Dialog open={isImageViewerOpen} onOpenChange={setIsImageViewerOpen}>
              <DialogContent className="max-w-xl">
                  <DialogHeader>
                      <DialogTitle>Inspiration Photo</DialogTitle>
                  </DialogHeader>
                  <div className="p-4">
                      <Image src={imageUrl} alt="Inspiration" width={600} height={400} className="rounded-lg object-contain" />
                  </div>
              </DialogContent>
          </Dialog>
      )}
    </div>
  );
}
    