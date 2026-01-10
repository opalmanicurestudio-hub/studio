
'use client';

import React, { useState, useMemo } from 'react';
import { format, differenceInMinutes } from 'date-fns';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { type Appointment, type Client, type Service } from '@/lib/data';

interface AppointmentCardProps {
  appointment: Appointment;
  client: Client;
  service: Service;
  style: React.CSSProperties;
  tmhr: number;
  onViewDetails: () => void;
}

const AppointmentDetails = ({
    appointment,
    client,
    service,
    tmhr,
}: {
    appointment: Appointment;
    client: Client;
    service: Service;
    tmhr: number;
}) => {
    const { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost } = useMemo(() => {
    const revenue = service.price;
    const totalDuration = differenceInMinutes(appointment.endTime, appointment.startTime);
    const timeCost = (totalDuration / 60) * tmhr;
    const productCost = (service.products || []).reduce((sum, p) => sum + (p.costPerUnit || 0), 0);
    const equipmentCost = (service.equipment || []).reduce((sum, e) => {
        const lifespanInMinutes = (e.lifespanYears || 5) * 365 * 8 * 60;
        const costPerMinute = (e.costPerUnit || 0) / lifespanInMinutes;
        return sum + (costPerMinute * totalDuration);
    }, 0);

    const breakEvenCost = timeCost + productCost + equipmentCost;
    const netProfit = revenue - breakEvenCost;

    return { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost };
  }, [service, appointment, tmhr]);

  return (
    <div className="p-6 space-y-6">
        <div className="space-y-2">
            <h3 className="font-semibold text-lg">{client.name}</h3>
            <p className="text-muted-foreground text-sm">{service.name}</p>
            <p className="text-muted-foreground text-sm">{format(appointment.startTime, 'EEEE, LLL d, yyyy')} from {format(appointment.startTime, 'h:mm a')} to {format(appointment.endTime, 'h:mm a')}</p>
        </div>

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
                  <p className="text-xs text-muted-foreground">Net Profit</p>
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
            <div className="text-sm space-y-2">
                {client.notes && <div className="flex items-start gap-2"><FileText className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5"/><span>{client.notes}</span></div>}
                {!client.medicalNotes && !client.allergyNotes && !client.sensoryNeeds && !client.notes && <p className="text-muted-foreground">No special notes for this client.</p>}
                {client.medicalNotes && <div className="flex items-center gap-2"><ShieldPlus className="w-4 h-4 text-red-500 flex-shrink-0"/><span>{client.medicalNotes}</span></div>}
                {client.allergyNotes && <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0"/><span>{client.allergyNotes}</span></div>}
                {client.sensoryNeeds && <div className="flex items-center gap-2"><Ear className="w-4 h-4 text-blue-500 flex-shrink-0"/><span>{client.sensoryNeeds}</span></div>}
                {client.inspirationPhotoUrl && <div className="flex items-center gap-2"><ImageIcon className="w-4 h-4 flex-shrink-0"/><span>Client has inspiration photo</span></div>}
                {client.isMember && <div className="flex items-center gap-2"><Award className="w-4 h-4 flex-shrink-0"/><span>Client is a member</span></div>}
            </div>
        </div>
    </div>
  )
}

export function AppointmentCard({
  appointment,
  client,
  service,
  style,
  tmhr,
}: Omit<AppointmentCardProps, 'onViewDetails'>) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const isMobile = useIsMobile();

  const statusStyles: { [key: string]: string } = {
    confirmed: 'bg-blue-100 dark:bg-blue-900/30 border-blue-500',
    completed: 'bg-green-100 dark:bg-green-900/30 border-green-500',
    cancelled: 'bg-red-200/50 dark:bg-red-900/30 border-red-500',
    deposit_pending: 'bg-pink-100 dark:bg-pink-900/30 border-pink-500',
  };

  const hasPadBefore = (service.padBefore || 0) > 0;
  const hasPadAfter = (service.padAfter || 0) > 0;
  const totalDurationWithPadding = service.duration + (service.padBefore || 0) + (service.padAfter || 0);

  const beforeHeight = hasPadBefore ? `${(service.padBefore! / totalDurationWithPadding) * 100}%` : '0px';
  const mainHeight = `${(service.duration / totalDurationWithPadding) * 100}%`;
  const afterHeight = hasPadAfter ? `${(service.padAfter! / totalDurationWithPadding) * 100}%` : '0px';

  const MainContent = () => (
    <div className={cn(
        'p-2 border-l-4 w-full h-full flex flex-col justify-between',
        statusStyles[appointment.status] || 'bg-gray-100 border-gray-500',
        hasPadBefore ? '' : 'rounded-t-lg',
        hasPadAfter ? '' : 'rounded-b-lg',
        "bg-card" // Added this to make it opaque
    )}>
        <div>
          <p className="font-semibold text-xs leading-tight truncate">{client.name}</p>
          <p className="text-xs text-muted-foreground truncate">{service.name}</p>
        </div>
        <div className="flex items-center justify-between mt-1">
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize">{appointment.status}</Badge>
           <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mb-1">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={() => setIsDetailsOpen(true)}>
                    <FileText className="mr-2 h-4 w-4"/>View Details
                </DropdownMenuItem>
                <DropdownMenuItem>Change Status</DropdownMenuItem>
                <DropdownMenuItem>Edit Details</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </div>
  );


  const DialogOrSheet = isMobile ? Sheet : Dialog;
  const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

  return (
    <div
      style={style}
      className="absolute w-full flex flex-col"
    >
      {hasPadBefore && (
        <div style={{ height: beforeHeight }} className="bg-muted/30 rounded-t-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      <div style={{ height: mainHeight }}>
        <MainContent />
      </div>
      {hasPadAfter && (
        <div style={{ height: afterHeight }} className="bg-muted/30 rounded-b-lg flex items-center justify-center text-xs text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />
      )}
      
      <DialogOrSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogOrSheetContent className={cn(isMobile && "h-[90vh] flex flex-col")}>
          <SheetHeader>
            <SheetTitle>Appointment Details</SheetTitle>
            <SheetDescription>
                A full breakdown of this appointment.
            </SheetDescription>
          </SheetHeader>
          <div className={cn(isMobile && "flex-1 overflow-y-auto")}>
            <AppointmentDetails appointment={appointment} client={client} service={service} tmhr={tmhr} />
          </div>
        </DialogOrSheetContent>
      </DialogOrSheet>
    </div>
  );
}
