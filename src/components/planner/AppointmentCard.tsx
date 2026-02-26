'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  Globe,
  Package,
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
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, CustomFormula, Resource, type Transaction } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { type ReceiptData } from './PrintReceipt';
import { type TicketData } from './PrintTicket';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useInventory } from '@/context/InventoryContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { useTenant } from '@/context/TenantContext';

interface AppointmentDetailsProps {
    appointment: Appointment;
    client: Client;
    service: Service;
    tmhr: number;
    transactions: Transaction[] | null;
    onStartService: (appointmentId: string) => void;
    onFinishService: (appointment: Appointment) => void;
    setIsDetailsOpen: (isOpen: boolean) => void;
    onEdit: (appointment: Appointment) => void;
    onDelete: (appointmentId: string) => void;
    onReschedule: (appointment: Appointment) => void;
    onRebook: (appointment: Appointment) => void;
    onBookNewForClient: (clientId: string) => void;
    onPrintTicket: (data: Omit<TicketData, 'business'>) => void;
    resources: Resource[];
}

const AppointmentDetails = ({
    appointment,
    client,
    service,
    tmhr,
    transactions,
    onStartService,
    onFinishService,
    setIsDetailsOpen,
    onEdit,
    onDelete,
    onReschedule,
    onRebook,
    onBookNewForClient,
    onPrintTicket,
    resources,
}: AppointmentDetailsProps) => {
    const { inventory, services: allServices } = useInventory();
    const { role } = useTenant();
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    const ticketId = appointment.id.slice(-6).toUpperCase();
    
    const addOnServices = useMemo(() => {
        return (appointment.addOnIds || []).map(id => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
    }, [appointment.addOnIds, allServices]);

    const requiredResources = useMemo(() => {
        if (!service.requiredResourceIds || !resources) return [];
        return resources.filter(r => service.requiredResourceIds!.includes(r.id));
    }, [service, resources]);
    
    const { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost, actualTotal, tipAmount, discountAmount, actualSaleItems } = useMemo(() => {
        const isCompleted = appointment.status === 'completed';

        const allServicesInAppointment = [service, ...addOnServices];

        const formulaForCosting = 
            (isCompleted && appointment.checkoutState?.formula) 
            ? appointment.checkoutState.formula
            : allServicesInAppointment.flatMap(s => s?.products || []).map(p => ({
                id: p.id,
                quantityUsed: p.quantityUsed,
            }));

        const finalProductCost = formulaForCosting.reduce((acc: number, p: any) => {
            const product = inventory.find(i => i.id === p.id);
            if (!product) return acc;
            const quantity = p.quantityUsed || 1;
            let costPerUse = 0;

            if (product.costingMethod === 'size' && product.size && product.size > 0) {
                costPerUse = (product.costPerUnit || 0) / product.size;
            } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
            } else {
                costPerUse = product.costPerUnit || 0;
            }

            return acc + (costPerUse * quantity);
        }, 0);

        const actualServiceDuration = appointment.actualEndTime && appointment.actualStartTime
            ? differenceInMinutes(
                typeof appointment.actualEndTime === 'string' ? parseISO(appointment.actualEndTime) : appointment.actualEndTime,
                typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime
              )
            : allServicesInAppointment.reduce((acc, s) => acc + (s?.duration || 0), 0);
        
        const finalTimeCost = ((actualServiceDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;

        const allRequiredResourceIds = [...new Set(allServicesInAppointment.flatMap(s => s?.requiredResourceIds || []))];
        const finalEquipmentCost = allRequiredResourceIds.reduce((acc, resourceId) => {
            const equipmentItem = inventory.find(i => i.id === resourceId && i.type === 'equipment');
            if (!equipmentItem || !equipmentItem.lifespanYears || equipmentItem.lifespanYears === 0) return acc;
            const totalDuration = actualServiceDuration + (service.padBefore || 0) + (service.padAfter || 0);
            const lifespanInMinutes = (equipmentItem.lifespanYears || 5) * 365 * 8 * 60;
            const costPerMinute = (equipmentItem.costPerUnit || 0) / lifespanInMinutes;
            return acc + (costPerMinute * totalDuration);
        }, 0);
        
        const finalBreakEvenCost = finalTimeCost + finalProductCost + finalEquipmentCost;
        
        const estimatedRevenue = allServicesInAppointment.reduce((acc, s) => acc + (s?.price || 0), 0);
        const estimatedNetProfit = estimatedRevenue - finalBreakEvenCost;

        const initialReturn = {
            revenue: estimatedRevenue,
            breakEvenCost: finalBreakEvenCost,
            netProfit: estimatedNetProfit,
            timeCost: finalTimeCost,
            productCost: finalProductCost,
            equipmentCost: finalEquipmentCost,
            actualTotal: 0,
            tipAmount: 0,
            discountAmount: 0,
            actualSaleItems: [],
        };
        
        if (isCompleted && transactions) {
            const appointmentTransactions = transactions.filter(t => t.appointmentId === appointment.id);
            
            const serviceRevenue = appointmentTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
            const retailRevenue = appointmentTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
            const totalRevenue = serviceRevenue + retailRevenue;
            const totalTips = appointmentTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
            const totalDiscounts = appointmentTransactions.reduce((acc, t) => acc + (t.discountAmount || 0), 0);
            
            const finalNetProfit = serviceRevenue - finalBreakEvenCost;

            const actualItems = appointmentTransactions
                .filter(t => ['Service Revenue', 'Retail'].includes(t.category))
                .map(t => ({ name: t.description, amount: t.amount, isDiscount: false }));
            
            if (totalDiscounts > 0) {
                actualItems.push({ name: 'Discounts', amount: -totalDiscounts, isDiscount: true });
            }

            return {
                ...initialReturn,
                revenue: totalRevenue,
                netProfit: finalNetProfit,
                actualTotal: totalRevenue + totalTips,
                tipAmount: totalTips,
                discountAmount: totalDiscounts,
                actualSaleItems: actualItems,
            };
        }

        return initialReturn;

    }, [appointment, service, tmhr, inventory, transactions, addOnServices]);
    
    const handleShareLink = () => {
        if (!appointment.checkInToken) {
            console.error('No check-in link');
            return;
        }
        const checkInUrl = `${window.location.origin}/check-in/${appointment.checkInToken}`;
        navigator.clipboard.writeText(checkInUrl);
    };

  return (
    <>
    <ScrollArea className="h-[80vh] p-6">
        <div className="space-y-6">
            
            {appointment.status === 'confirmed' && (
                <Button onClick={() => onStartService(appointment.id)} className="w-full" size="lg">
                    <Play className="mr-2 h-4 w-4" /> Start Service
                </Button>
            )}
            {appointment.status === 'servicing' && (
                 <Button onClick={() => onFinishService(appointment)} className="w-full" size="lg">
                    <Square className="mr-2 h-4 w-4" /> Finish Service
                </Button>
            )}

             <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                        <h3 className="font-semibold text-lg">{client.name}</h3>
                        <p className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded-md w-fit flex items-center gap-1">
                            <TicketIcon className="w-2.5 h-2.5" />
                            Ticket ID: {ticketId}
                        </p>
                    </div>
                </div>
                {isOwnerOrAdmin && (
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
                )}
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
                    <div className="flex items-center gap-2 pt-1">
                        {appointment.source === 'online' && <Globe className="w-4 h-4"/>}
                        {appointment.source === 'walk-in' && <Users className="w-4 h-4"/>}
                        {(appointment.source === 'manual' || !appointment.source) && <Phone className="w-4 h-4"/>}
                        <span className="capitalize">{appointment.source || 'Manual'}</span>
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
                </div>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                        <MoreHorizontal className="mr-2 h-4 w-4" />
                        More Actions
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[calc(var(--radix-dropdown-menu-trigger-width)-1.5rem)]">
                    <DropdownMenuItem asChild>
                        <Link href={`/clients/${client.id}`} className="flex items-center">
                            <UserIcon className="mr-2"/>View Client Profile
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setIsDetailsOpen(false); setTimeout(() => onEdit(appointment), 150)}}>
                        <Edit className="mr-2"/>Edit Details
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                        onClick={() => { setIsDetailsOpen(false); setTimeout(() => onReschedule(appointment), 150)}}
                        disabled={appointment.status === 'completed'}
                    >
                        <Calendar className="mr-2"/>Reschedule
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setIsDetailsOpen(false); setTimeout(() => onRebook(appointment), 150) }}>
                        <Repeat className="mr-2"/>Rebook Same Service
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setIsDetailsOpen(false); setTimeout(() => onBookNewForClient(client.id), 150) }}>
                        <Book className="mr-2"/>Book New for Client
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onPrintTicket({ appointment, client, service })}>
                        <TicketIcon className="mr-2"/>Print Ticket
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleShareLink}>
                        <LinkIcon className="mr-2"/>Share Check-in Link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { /* toast is not defined */ }}>
                        <Send className="mr-2"/>Resend Confirmation
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}>
                        <Trash2 className="mr-2"/>Delete Appointment
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {appointment.inspirationPhotoUrl && (
                <div className="space-y-3">
                    <h4 className="font-medium text-sm">Inspiration Photo</h4>
                    <div className="rounded-lg overflow-hidden border">
                        <Image src={appointment.inspirationPhotoUrl} alt="Inspiration" width={400} height={300} className="object-cover" />
                    </div>
                </div>
            )}

            <Separator className="my-6" />

            {isOwnerOrAdmin && (
                <div className="space-y-4">
                    <h4 className="font-medium text-sm">Financials</h4>
                    <div className="grid grid-cols-2 gap-4 w-full text-center">
                        <div className="rounded-md bg-green-500/10 p-3">
                            <p className="text-xs text-green-800/80 dark:text-green-400/80">{appointment.status === 'completed' ? 'Actual Revenue' : 'Est. Revenue'}</p>
                            <p className="font-bold text-xl text-green-800 dark:text-green-400">${revenue.toFixed(2)}</p>
                        </div>
                        <div className="rounded-md bg-red-500/10 p-3">
                            <p className="text-xs text-red-800/80 dark:text-red-400/80">Est. Cost</p>
                            <p className="font-bold text-xl text-red-800 dark:text-red-400">${breakEvenCost.toFixed(2)}</p>
                        </div>
                        <div className="rounded-md bg-blue-500/10 p-3 col-span-2">
                            <p className="text-xs text-blue-800/80 dark:text-blue-400/80">{appointment.status === 'completed' ? 'Actual Net Profit' : 'Est. Net Profit'}</p>
                            <p className="font-bold text-xl text-blue-800 dark:text-blue-400">${netProfit.toFixed(2)}</p>
                        </div>
                    </div>
                    <div className="text-xs space-y-2 text-muted-foreground pt-2">
                        <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/>Time Cost</span> <span className='font-mono'>${timeCost.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Product Cost</span> <span className='font-mono'>${productCost.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Equipment Cost</span> <span className='font-mono'>${equipmentCost.toFixed(2)}</span></div>
                    </div>
                </div>
            )}

            {isOwnerOrAdmin && appointment.status === 'completed' && (
                <div className="space-y-4">
                    <h4 className="font-medium text-sm">Actuals from Checkout</h4>
                    <Card>
                        <CardContent className="p-4 text-sm space-y-2">
                            {actualSaleItems.map((item, index) => (
                                <div key={index} className="flex justify-between">
                                    <span className={cn(item.isDiscount && "text-primary font-semibold")}>{item.name}</span>
                                    <span className={cn("font-mono", item.isDiscount && "text-primary font-semibold")}>
                                        {item.isDiscount ? `-$${Math.abs(item.amount).toFixed(2)}` : `$${item.amount.toFixed(2)}`}
                                    </span>
                                </div>
                            ))}
                            {tipAmount > 0 && (
                                <div className="flex justify-between border-t pt-2 mt-2">
                                    <span className="text-muted-foreground">Tip</span>
                                    <span className="font-mono">${tipAmount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between font-bold border-t pt-2 mt-2">
                                <span>Total Charged</span>
                                <span className="font-mono">${actualTotal.toFixed(2)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
            
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
                    {client.activeMembershipId && <div className="flex items-center gap-2"><Award className="w-4 h-4 flex-shrink-0"/><span>Client is a member</span></div>}
                </div>
            </div>
        </div>
    </ScrollArea>
    </>
  );
};

interface AppointmentCardProps {
  appointment: Appointment;
  client: Client;
  service: Service;
  resources: Resource[];
  style: React.CSSProperties;
  tmhr: number;
  transactions: Transaction[] | null;
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

export function AppointmentCard({
  appointment,
  client,
  service,
  resources,
  style,
  tmhr,
  transactions,
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
  const [isRunningOver, setIsRunningOver] = useState(false);
  const { toast } = useToast();

  const isMobile = useIsMobile();
  const { services } = useInventory();
  
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;

    if (appointment.status === 'servicing' && appointment.actualStartTime) {
      const startTime = typeof appointment.actualStartTime === 'string'
        ? parseISO(appointment.actualStartTime)
        : appointment.actualStartTime;
        
      const interval = setInterval(() => {
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

        const elapsedMinutes = Math.floor(diffInSeconds / 60);
        setIsRunningOver(elapsedMinutes > service.duration);

      }, 1000);
      timer = interval;
    } else {
      setElapsedTime(null);
      setIsRunningOver(false);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [appointment.status, appointment.actualStartTime, service.duration]);


  const scheduledDuration = useMemo(() => {
    if (!appointment.startTime || !appointment.endTime) return 0;
    const start = typeof appointment.startTime === 'string' ? parseISO(appointment.startTime) : appointment.startTime;
    const end = typeof appointment.endTime === 'string' ? parseISO(appointment.endTime) : appointment.endTime;
    return differenceInMinutes(end, start);
  }, [appointment.startTime, appointment.endTime]);

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

  const finalDuration = useMemo(() => {
    if (appointment.actualStartTime && appointment.actualEndTime) {
      const start = typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime;
      const end = typeof appointment.actualEndTime === 'string' ? parseISO(appointment.actualEndTime) : appointment.actualEndTime;
      return differenceInMinutes(end, start);
    }
    return null;
  }, [appointment.actualStartTime, appointment.actualEndTime]);

  const addOnServices = useMemo(() => {
      return (appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
  }, [appointment.addOnIds, services]);
  
  const cardStatus = appointment.checkInStatus === 'auto_cancelled' ? 'cancelled' : appointment.status;

  const statusDisplay: { [key in Appointment['status']]: { text: string; className: string; bgClassName: string } } = {
    confirmed: { text: 'Confirmed', className: 'border-blue-500/30 text-blue-800 dark:text-blue-300', bgClassName: 'bg-blue-500/10' },
    servicing: { text: 'In Service', className: 'border-yellow-500/30 text-yellow-800 dark:text-yellow-300', bgClassName: 'bg-yellow-500/10' },
    completed: { text: 'Completed', className: 'border-green-500/30 text-green-800 dark:text-green-300', bgClassName: 'bg-green-500/10' },
    cancelled: { text: 'Cancelled', className: 'border-red-500/30 text-red-800 dark:text-red-300', bgClassName: 'bg-red-500/10' },
    deposit_pending: { text: 'Awaiting Payment', className: 'border-pink-500/30 text-pink-800 dark:text-pink-300', bgClassName: 'bg-pink-500/10' },
    ready_for_checkout: { text: 'Checkout', className: 'border-orange-500/30 text-orange-800 dark:text-orange-300', bgClassName: 'bg-orange-500/10' },
  };

  const hasPadBefore = (service.padBefore || 0) > 0;
  const hasPadAfter = (service.padAfter || 0) > 0;
  const totalDurationWithPadding = service.duration + (service.padBefore || 0) + (service.padAfter || 0);

  const beforeHeight = hasPadBefore ? `${((service.padBefore || 0) / totalDurationWithPadding) * 100}%` : '0px';
  const mainHeight = `${(service.duration / totalDurationWithPadding) * 100}%`;
  const afterHeight = hasPadAfter ? `${((service.padAfter || 0) / totalDurationWithPadding) * 100}%` : '0px';

  const isCompact = scheduledDuration < 50;
  
  const serviceNameDisplay = isCompact
      ? service.name
      : addOnServices.length > 0
      ? `${service.name} + ${addOnServices.length} add-on(s)`
      : service.name;

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      e.stopPropagation();
      return;
    }
    setIsDetailsOpen(true);
  };

  const handleCheckoutClick = (e: React.MouseEvent) => { e.stopPropagation(); onCompleteClick(appointment); };
  
  const DialogOrSheet = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;
  const imageUrl = appointment.inspirationPhotoUrl || client.inspirationPhotoUrl;

  return (
    <div style={style} className="flex flex-col h-full w-full">
      {hasPadBefore && (
        <div style={{ height: beforeHeight }} className="bg-muted/30 rounded-t-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      <div style={{ height: mainHeight }} className="min-h-fit">
        {isCompact ? (
          <div
            className={cn(
                'p-2 border rounded-lg w-full h-full flex items-center justify-between cursor-pointer gap-2', 
                statusDisplay[cardStatus]?.bgClassName, 
                statusDisplay[cardStatus]?.className, 
                hasPadBefore ? 'rounded-t-none' : '', 
                hasPadAfter ? 'rounded-b-none' : '',
                isRunningOver && 'bg-destructive/20 border-destructive/50 ring-2 ring-destructive/50 animate-pulse'
            )}
            onClick={handleCardClick}
            data-is-event-card="true"
          >
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs leading-tight truncate">
                  {client.activeMembershipId && <Award className="inline-block w-3 h-3 mr-1 text-indigo-500" />}
                  <span className="font-bold">{client.name}</span> &middot; <span className="text-muted-foreground">{service.name}</span>
                </p>
                {appointment.status === 'servicing' && elapsedTime ? (
                    <p className="text-sm font-mono font-semibold text-yellow-600 dark:text-yellow-400">{elapsedTime}</p>
                ) : (
                    <p className="text-[11px] text-muted-foreground font-medium">{format(appointment.startTime, 'h:mm a')}</p>
                )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {appointment.status === 'ready_for_checkout' && (
                <Button variant="ghost" size="icon" className="rounded-full bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-300 h-7 w-7 hover:bg-orange-200 dark:hover:bg-orange-500/20" onClick={handleCheckoutClick}>
                  <DollarSign className="w-4 h-4" />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => onCompleteClick(appointment)}><CheckCircle className="mr-2" /> Checkout</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onReschedule(appointment)} disabled={appointment.status === 'completed'}><Calendar className="mr-2" /> Reschedule</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setIsDetailsOpen(true)}><FileText className="mr-2" /> View Details</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}><Trash2 className="mr-2" /> Delete Appointment</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : (
          <div 
              className={cn(
                'p-2 border rounded-lg w-full h-full flex flex-col justify-between cursor-pointer', 
                statusDisplay[cardStatus]?.bgClassName, 
                statusDisplay[cardStatus]?.className, 
                hasPadBefore ? 'rounded-t-none' : '', 
                hasPadAfter ? 'rounded-b-none' : '',
                isRunningOver && 'bg-destructive/20 border-destructive/50 ring-2 ring-destructive/50 animate-pulse'
                )}
              onClick={handleCardClick}
              data-is-event-card="true"
          >
              <div className="flex items-start justify-between min-w-0">
                  <div className='flex-1 min-w-0'>
                      <p className="font-semibold text-xs leading-tight truncate flex items-center gap-1.5">
                        {appointment.isWalkIn && <Users className="h-3 w-3 text-muted-foreground" />}
                        {client.activeMembershipId && <Award className="w-3 h-3 text-indigo-500" />}
                        {isBirthday && (<TooltipProvider><Tooltip><TooltipTrigger><Cake className="h-4 w-4 text-pink-500" /></TooltipTrigger><TooltipContent><p>It's {client.name.split(' ')[0]}'s Birthday!</p></TooltipContent></Tooltip></TooltipProvider>)}
                        {appointment.inventoryProcessed === false && (
                          <TooltipProvider><Tooltip><TooltipTrigger><AlertTriangle className="h-4 w-4 text-amber-500" /></TooltipTrigger><TooltipContent><p>Inventory not deducted for this appointment.</p></TooltipContent></Tooltip></TooltipProvider>
                        )}
                        {client.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{serviceNameDisplay}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0 -mr-1" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => onCompleteClick(appointment)}><CheckCircle className="mr-2" /> Checkout</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onReschedule(appointment)} disabled={appointment.status === 'completed'}><Calendar className="mr-2" /> Reschedule</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setIsDetailsOpen(true)}><FileText className="mr-2" /> View Details</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}><Trash2 className="mr-2" /> Delete Appointment</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
              </div>
              
              {appointment.status === 'servicing' && elapsedTime && (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-2xl font-bold font-mono text-yellow-700 dark:text-yellow-400">{elapsedTime}</p>
                </div>
              )}
              
              <div className="flex items-end justify-between">
                  <div className="flex flex-col items-start gap-1">
                      <p className="text-[10px] text-muted-foreground font-medium">{format(appointment.startTime, 'h:mm a')}</p>
                       <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="secondary" className={cn("text-[10px] h-5 px-1.5 capitalize", statusDisplay[cardStatus]?.className, statusDisplay[cardStatus]?.bgClassName)}>
                              {statusDisplay[cardStatus]?.text}
                          </Badge>
                          {appointment.checkInStatus === 'on_my_way' && (<Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize border-blue-500/30 text-blue-800 dark:text-blue-300 bg-blue-500/10"><Car className="w-3 h-3 mr-1" />On My Way</Badge>)}
                          {appointment.checkInStatus === 'arrived' && (<Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize border-green-500/30 text-green-800 dark:text-green-300 bg-green-500/10"><CheckCircle className="w-3 h-3 mr-1" />Arrived</Badge>)}
                          {appointment.checkInStatus === 'running_late' && (<Badge variant="destructive" className="text-[10px] h-5 px-1.5 capitalize"><AlertTriangle className="w-3 h-3 mr-1" />{appointment.lateTimeMinutes}m late</Badge>)}
                      </div>
                  </div>
                   {appointment.status === 'ready_for_checkout' && (
                         <Button size="xs" className={cn('capitalize font-semibold h-7 px-2', statusDisplay[appointment.status]?.className, statusDisplay[appointment.status]?.bgClassName, 'hover:ring-2 hover:ring-offset-1 hover:ring-orange-500 hover:bg-orange-500/20')} onClick={handleCheckoutClick}>
                           <DollarSign className="w-3 h-3 mr-1" />
                           {statusDisplay[appointment.status]?.text}
                         </Button>
                      )}
              </div>
          </div>
        )}
      </div>
      {hasPadAfter && (
        <div style={{ height: afterHeight }} className="bg-muted/30 rounded-b-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      
      <DialogOrSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <ContentComponent className={cn(isMobile ? "h-[90vh] flex flex-col p-0" : "p-0 sm:max-w-md")}>
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
            transactions={transactions}
            onStartService={onStartService}
            onFinishService={onFinishService}
            setIsDetailsOpen={setIsDetailsOpen}
            onEdit={onEdit}
            onReschedule={onReschedule}
            onRebook={onRebook}
            onDelete={onDelete}
            onBookNewForClient={onBookNewForClient}
            onPrintTicket={onPrintTicket}
            resources={resources}
          />
        </ContentComponent>
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
};
