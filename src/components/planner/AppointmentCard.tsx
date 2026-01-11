

'use client';

import React, { useState, useMemo } from 'react';
import { format, differenceInMinutes, isPast } from 'date-fns';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
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
import { type Appointment, type Client, type Service, inventory, CustomFormula, services } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

interface AppointmentCardProps {
  appointment: Appointment;
  client: Client;
  service: Service;
  style: React.CSSProperties;
  tmhr: number;
  onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void;
  onDelete: (appointmentId: string) => void;
  onCompleteClick: (appointment: Appointment) => void;
  onPrintReceipt: (appointment: Appointment) => void;
  onEdit: (appointment: Appointment) => void;
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
    onEdit,
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
    onEdit: (appointment: Appointment) => void;
}) => {
    const { toast } = useToast();

  return (
    <ScrollArea className="h-[80vh] p-6">
        <div className="space-y-6">
             <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                    <h3 className="font-semibold text-lg">{client.name}</h3>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <MoreHorizontal className="w-4 h-4 mr-2" />
                                Actions
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem asChild>
                                <Link href={`/clients/${client.id}`}>
                                    <UserIcon className="w-4 h-4 mr-2"/>
                                    View Client Profile
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEdit(appointment)}>
                                <Edit className="w-4 h-4 mr-2"/>
                                Edit Appointment
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                                toast({ title: 'Confirmation Resent', description: `An email confirmation has been resent to ${client.email}.`})
                            }}>
                                <Send className="w-4 h-4 mr-2"/>
                                Resend Confirmation
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <Book className="w-4 h-4 mr-2"/>
                                Book New Appointment
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
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
                 <div className="text-muted-foreground text-sm pt-4 space-y-1">
                    <p className="font-medium text-foreground">{service.name}</p>
                    {addOnServices.map(addon => (
                        <p key={addon.id} className="text-xs pl-4">+ {addon.name}</p>
                    ))}
                    <div className='flex flex-col'>
                      <span className='font-medium'>{format(appointment.startTime, 'EEEE, LLL d, yyyy')}</span>
                      <span>{format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}</span>
                    </div>
                </div>
            </div>

            {(appointment.inspirationPhotoUrl || client.inspirationPhotoUrl) && (
                <div className="space-y-3">
                    <h4 className="font-medium text-sm">Inspiration Photo</h4>
                    <div className="rounded-lg overflow-hidden border">
                        <Image src={appointment.inspirationPhotoUrl || client.inspirationPhotoUrl!} alt="Inspiration" width={400} height={300} className="object-cover" />
                    </div>
                </div>
            )}

            <Separator />

            <div className="space-y-4">
                <h4 className="font-medium text-sm">Financials</h4>
                <div className="grid grid-cols-3 text-center rounded-lg bg-muted p-4">
                  <div>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="font-bold text-xl">${revenue.toFixed(2)}</p>
                  </div>
                  <div>
                      <p className="text-xs text-muted-foreground">Cost</p>
                      <p className="font-bold text-xl text-destructive">${breakEvenCost.toFixed(2)}</p>
                  </div>
                  <div>
                      <p className="font-bold text-xs text-muted-foreground">Net Profit</p>
                      <p className={cn("font-bold text-xl", netProfit >= 0 ? 'text-primary' : 'text-destructive')}>
                        ${netProfit.toFixed(2)}
                      </p>
                  </div>
              </div>
              <div className="text-xs space-y-2 text-muted-foreground">
                 <div className="flex justify-between"><span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/>Time Cost</span> <span>${timeCost.toFixed(2)}</span></div>
                 <div className="flex justify-between"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Product Cost</span> <span>${productCost.toFixed(2)}</span></div>
                 <div className="flex justify-between"><span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3"/>Equipment Cost</span> <span>${equipmentCost.toFixed(2)}</span></div>
              </div>
            </div>
            
            <Separator />
            
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
  style,
  tmhr,
  onUpdateStatus,
  onDelete,
  onCompleteClick,
  onPrintReceipt,
  onEdit,
}: AppointmentCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const isMobile = useIsMobile();

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
  }, [service, appointment, tmhr, client, addOnServices]);


  const statusDisplay: { [key in Appointment['status']]: { text: string; className: string } } = {
    confirmed: { text: 'Confirmed', className: 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300' },
    completed: { text: 'Completed', className: 'bg-green-500/10 border-green-500/30 text-green-800 dark:text-green-300' },
    cancelled: { text: 'Cancelled', className: 'bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-300' },
    deposit_pending: { text: 'Awaiting Payment', className: 'bg-pink-500/10 border-pink-500/30 text-pink-800 dark:text-pink-300' },
  };

  const hasPadBefore = (service.padBefore || 0) > 0;
  const hasPadAfter = (service.padAfter || 0) > 0;
  const totalDurationWithPadding = service.duration + (service.padBefore || 0) + (service.padAfter || 0);

  const beforeHeight = hasPadBefore ? `${(service.padBefore! / totalDurationWithPadding) * 100}%` : '0px';
  const mainHeight = `${(service.duration / totalDurationWithPadding) * 100}%`;
  const afterHeight = hasPadAfter ? `${(service.padAfter! / totalDurationWithPadding) * 100}%` : '0px';
  

  const MainContent = () => {
    const serviceNameDisplay = addOnServices.length > 0
        ? `${service.name} + ${addOnServices.length} add-on(s)`
        : service.name;

    return (
    <div 
        className={cn(
            'p-2 border rounded-lg w-full h-full flex flex-col justify-between cursor-pointer',
            statusDisplay[appointment.status]?.className || 'bg-gray-100 border-gray-500',
            hasPadBefore ? 'rounded-t-none' : '',
            hasPadAfter ? 'rounded-b-none' : ''
        )}
        onClick={() => setIsDetailsOpen(true)}
    >
      <div className="flex-grow flex flex-col justify-between min-h-0">
        <div className="flex items-start justify-between">
            <div className='flex-1 min-w-0'>
                <p className="font-semibold text-xs leading-tight truncate">{client.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{serviceNameDisplay}</p>
                <div className="flex items-center space-x-1 mt-1">
                    {client.medicalNotes && <ShieldPlus className="h-3 w-3 text-red-500" />}
                    {client.allergyNotes && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                    {client.sensoryNeeds && <Ear className="h-3 w-3 text-blue-500" />}
                    {(client.inspirationPhotoUrl || appointment.inspirationPhotoUrl) && (
                        <button onClick={(e) => { e.stopPropagation(); setIsImageViewerOpen(true); }} className="focus:outline-none">
                            <ImageIcon className="h-3 w-3 text-orange-400" />
                        </button>
                    )}
                    {client.isMember && <Award className="h-3 w-3 text-amber-500" />}
                </div>
            </div>
            <div className="text-right flex-shrink-0">
                 <div className='text-[10px] space-y-0.5 text-right'>
                    <div className="flex items-center justify-end gap-1.5">
                        <span className="text-muted-foreground">Rev:</span>
                        <span className="text-green-600 dark:text-green-400 font-semibold">${revenue.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        <span className="text-muted-foreground">Cost:</span>
                        <span className="text-red-600 dark:text-red-400 font-semibold">${breakEvenCost.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        <span className="text-muted-foreground">Profit:</span>
                        <span className={cn("font-semibold", netProfit >= 0 ? 'text-primary' : 'text-destructive')}>
                          ${netProfit.toFixed(2)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div className="mt-1 flex items-end justify-between">
            <div className="flex flex-col items-start">
                <Badge variant="secondary" className={cn("text-[10px] h-5 px-1.5 capitalize", statusDisplay[appointment.status]?.className)}>{statusDisplay[appointment.status]?.text}</Badge>
                <p className="text-[10px] text-muted-foreground">{format(appointment.startTime, 'h:mm')} - {format(appointment.endTime, 'h:mm a')}</p>
            </div>
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => onCompleteClick(appointment)}>
                    <CheckCircle className="mr-2" /> Complete Appointment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(appointment)}>
                    <Edit className="mr-2" /> Edit Appointment
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
                 <DropdownMenuItem onClick={() => onPrintReceipt(appointment)} disabled={appointment.status !== 'completed'}>
                    <Printer className="mr-2" /> Print Receipt
                </DropdownMenuItem>
                <Separator />
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}>
                    <Trash2 className="mr-2" /> Delete Appointment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </div>
    </div>
  )};


  const DialogOrSheet = isMobile ? Sheet : Dialog;
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
            onEdit={onEdit}
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

