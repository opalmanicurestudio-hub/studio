'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  ShieldPlus,
  AlertTriangle,
  Ear,
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
  Printer,
  TrendingUp,
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
  LinkIcon,
  Building,
  HardHat,
  MapPin,
  PlusCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, Resource, type Transaction, getServicePrice } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';

interface AppointmentDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  client: Client | null;
  service: Service | null;
  tmhr: number;
  transactions: Transaction[];
  onStartService: (id: string) => void;
  onFinishService: (apt: Appointment) => void;
  onEdit: (apt: Appointment) => void;
  onDelete: (id: string) => void;
  onReschedule: (apt: Appointment) => void;
  onRebook: (apt: Appointment) => void;
  onBookNewForClient: (clientId: string) => void;
  onPrintTicket: (data: any) => void;
}

export const AppointmentDetailsSheet: React.FC<AppointmentDetailsSheetProps> = ({
  open,
  onOpenChange,
  appointment,
  client,
  service,
  tmhr,
  transactions,
  onStartService,
  onFinishService,
  onEdit,
  onDelete,
  onReschedule,
  onRebook,
  onBookNewForClient,
  onPrintTicket,
}) => {
  const isMobile = useIsMobile();
  const { inventory, services: allServices, resources, staff } = useInventory();
  const { role, user } = useTenant();
  const { toast } = useToast();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime;
      const interval = setInterval(() => {
        const now = new Date();
        const diffInSeconds = differenceInSeconds(now, startTime);
        const hours = Math.floor(diffInSeconds / 3600);
        const minutes = Math.floor((diffInSeconds % 3600) / 60);
        const seconds = diffInSeconds % 60;
        setElapsedTime(hours > 0 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
        setIsRunningOver(Math.floor(diffInSeconds / 60) > (service?.duration || 0));
      }, 1000);
      timer = interval;
    } else {
      setElapsedTime(null);
      setIsRunningOver(false);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  const handleCopyCheckInLink = () => {
    if (appointment?.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({
        title: "Link Copied",
        description: "The check-in link has been copied to your clipboard.",
      });
    }
  };

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    const isCompleted = appointment.status === 'completed';
    const addOns = (appointment.addOnIds || []).map(id => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
    const allServicesInApt = [service, ...addOns];
    const assignedStaffMember = staff.find(s => s.id === appointment.staffId);

    const formulaForCosting = (isCompleted && appointment.checkoutState?.formula) 
        ? appointment.checkoutState.formula 
        : allServicesInApt.flatMap(s => s?.products || []).map(p => ({ id: p.id, quantityUsed: p.quantityUsed }));

    const productCost = formulaForCosting.reduce((acc: number, p: any) => {
      const product = inventory.find(i => i.id === p.id);
      if (!product) return acc;
      const quantity = p.quantityUsed || 1;
      let costPerUse = 0;
      if (product.costingMethod === 'size' && product.size && product.size > 0) costPerUse = (product.costPerUnit || 0) / product.size;
      else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
      else costPerUse = product.costPerUnit || 0;
      return acc + (costPerUse * quantity);
    }, 0);

    const actualDuration = appointment.actualEndTime && appointment.actualStartTime
        ? differenceInMinutes(new Date(appointment.actualEndTime), new Date(appointment.actualStartTime))
        : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
    
    const timeCost = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const breakEven = timeCost + productCost;
    
    const revenue = isCompleted 
        ? transactions.filter(t => t.appointmentId === appointment.id && t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0) 
        : allServicesInApt.reduce((acc, s) => acc + getServicePrice(s, assignedStaffMember), 0);

    return { revenue, breakEven, profit: revenue - breakEven, timeCost, productCost };
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  if (!appointment || !client || !service) return null;

  const ticketId = appointment.id.slice(-6).toUpperCase();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90vh]" : "sm:max-w-md", "flex flex-col p-0")}>
        <SheetHeader className="p-6 pb-0">
          <SheetTitle>Appointment Details</SheetTitle>
          <SheetDescription>A full breakdown of this appointment.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {appointment.status === 'confirmed' && (
              <Button onClick={() => onStartService(appointment.id)} className="w-full h-12" size="lg">
                <Play className="mr-2 h-4 w-4" /> Start Service
              </Button>
            )}
            {appointment.status === 'servicing' && (
              <div className="space-y-3">
                <Button onClick={() => onFinishService(appointment)} className="w-full h-12" size="lg" variant="default">
                  <Square className="mr-2 h-4 w-4" /> Finish Service
                </Button>
                {elapsedTime && (
                  <div className={cn("p-4 rounded-xl border-2 text-center transition-all", isRunningOver ? "bg-destructive/10 border-destructive text-destructive animate-pulse" : "bg-primary/5 border-primary/20 text-primary")}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1">Service Time Elapsed</p>
                    <p className="text-4xl font-black font-mono">{elapsedTime}</p>
                    {isRunningOver && <p className="text-[10px] font-bold mt-1 uppercase">Exceeding scheduled time</p>}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-xl tracking-tight">{client.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1.5 uppercase tracking-wider">
                      <TicketIcon className="w-3 h-3" />
                      Ticket ID: {ticketId}
                    </p>
                    {appointment.status === 'ready_for_checkout' && <Badge className="bg-orange-500 hover:bg-orange-600">Checkout Ready</Badge>}
                  </div>
                </div>
              </div>
              {isOwnerOrAdmin ? (
                <div className="text-muted-foreground text-sm space-y-1.5 pt-2">
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4" /> {client.email}</div>
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4" /> {client.phone}</div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic pt-2">Contact info restricted by business owner.</p>
              )}
              <div className="text-muted-foreground text-sm pt-4 space-y-3">
                <div>
                  <p className='font-bold text-foreground text-base'>{service.name}</p>
                  {(appointment.addOnIds || []).map(id => {
                    const addon = allServices.find(s => s.id === id);
                    return addon ? <p key={addon.id} className="text-sm pl-4 text-muted-foreground/80 font-medium">+ {addon.name}</p> : null;
                  })}
                </div>
                <div className='flex flex-col p-3 rounded-lg border bg-muted/30'>
                  <span className='font-bold text-foreground'>{format(new Date(appointment.startTime), 'EEEE, MMM d, yyyy')}</span>
                  <span className="text-xs">{format(new Date(appointment.startTime), 'h:mm a')} - {format(new Date(appointment.endTime), 'h:mm a')}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" className="w-full justify-start h-11" onClick={handleCopyCheckInLink}>
                    <LinkIcon className="mr-2 h-4 w-4" /> Copy Check-in Link
                </Button>
                <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-start h-11">
                    <MoreHorizontal className="mr-2 h-4 w-4" /> More Actions
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuItem asChild><Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-4 w-4"/>View Client Profile</Link></DropdownMenuItem>
                    {isOwnerOrAdmin && (
                    <>
                        <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onEdit(appointment), 150); }}><Edit className="mr-2 h-4 w-4"/>Edit Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onReschedule(appointment), 150); }} disabled={appointment.status === 'completed'}><Calendar className="mr-2 h-4 w-4"/>Reschedule</DropdownMenuItem>
                    </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onRebook(appointment), 150); }}><Repeat className="mr-2 h-4 w-4"/>Rebook Service</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onBookNewForClient(client.id), 150); }}><PlusCircle className="mr-2 h-4 w-4"/>Book New</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onPrintTicket({ appointment, client, service })}><Printer className="mr-2 h-4 w-4"/>Print Ticket</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {isOwnerOrAdmin && <DropdownMenuItem className="text-destructive" onClick={() => { onOpenChange(false); onDelete(appointment.id); }}><Trash2 className="mr-2 h-4 w-4"/>Delete Appointment</DropdownMenuItem>}
                </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Separator />

            {isOwnerOrAdmin && financialData && (
              <div className="space-y-4">
                <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3"/> Financial Performance</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border-2 p-3 bg-muted/20">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Revenue</p>
                    <p className="font-black text-xl text-primary">${financialData.revenue.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border-2 p-3 bg-muted/20">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Est. Cost</p>
                    <p className="font-black text-xl text-destructive">${financialData.breakEven.toFixed(2)}</p>
                  </div>
                  <div className={cn("rounded-xl border-2 p-3 col-span-2 flex justify-between items-center", financialData.profit >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-destructive/5 border-destructive/20")}>
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Actual Net Profit</p>
                    <p className={cn("font-black text-2xl", financialData.profit >= 0 ? "text-green-600" : "text-destructive")}>${financialData.profit.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2"><FlaskConical className="w-3 h-3"/> Service Intel</h4>
              {(client.customFormulas && client.customFormulas.length > 0) && (
                <div className='p-3 rounded-xl border-2 bg-blue-500/5 border-blue-500/10 space-y-2'>
                  <p className='font-black text-[10px] uppercase text-blue-600'>Formula: {client.customFormulas[0].name}</p>
                  {client.customFormulas[0].items.map((item, idx) => (
                    <div key={idx} className='text-xs flex justify-between'>
                      <span className='font-bold'>{item.productName}</span>
                      <span className='font-mono'>{item.quantityUsed}{item.unit}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {client.medicalNotes && <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 text-red-700 text-xs font-bold border border-red-500/10"><ShieldPlus className="w-4 h-4 shrink-0"/><p>{client.medicalNotes}</p></div>}
                {client.allergyNotes && <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 text-amber-700 text-xs font-bold border border-amber-500/10"><AlertTriangle className="w-4 h-4 shrink-0"/><p>{client.allergyNotes}</p></div>}
                {client.sensoryNeeds && <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-500/5 text-blue-700 text-xs font-bold border border-blue-500/10"><Ear className="w-4 h-4 shrink-0"/><p>{client.sensoryNeeds}</p></div>}
              </div>
            </div>
          </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};