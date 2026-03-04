
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  Award,
  MoreHorizontal,
  DollarSign,
  Clock,
  Edit,
  Trash2,
  CheckCircle,
  FileText,
  Calendar,
  Users,
  Cake,
  AlertTriangle,
  Square,
  Link as LinkIcon,
  MapPin,
  Car,
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
import { cn } from '@/lib/utils';
import { type Appointment, type Client, type Service, Resource, type Transaction } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useToast } from '@/hooks/use-toast';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
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
  onPrintReceipt: (data: any) => void;
  onPrintTicket: (data: any) => void;
  onEdit: (appointment: Appointment) => void;
  onReschedule: (appointment: Appointment) => void;
  onRebook: (appointment: Appointment) => void;
  onStartService: (appointmentId: string) => void;
  onFinishService: (appointment: Appointment) => void;
  onBookNewForClient: (clientId: string) => void;
  onViewDetails: (appointment: Appointment) => void;
}

export function AppointmentCard({
  appointment,
  client,
  service,
  style,
  onDelete,
  onCompleteClick,
  onReschedule,
  onViewDetails,
  onFinishService,
}: AppointmentCardProps) {
  const { services } = useInventory();
  const { toast } = useToast();
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      timer = setInterval(() => {
        const now = new Date();
        const diff = differenceInSeconds(now, startTime);
        const mins = Math.floor(diff / 60);
        const hours = Math.floor(mins / 60);
        const displayMins = mins % 60;
        const displaySecs = diff % 60;
        
        const timeStr = hours > 0 
            ? `${String(hours).padStart(2, '0')}:${String(displayMins).padStart(2, '0')}:${String(displaySecs).padStart(2, '0')}`
            : `${String(displayMins).padStart(2, '0')}:${String(displaySecs).padStart(2, '0')}`;
            
        setElapsedTime(timeStr);
        setIsRunningOver(mins > service.duration);
      }, 1000);
    } else { setElapsedTime(null); setIsRunningOver(false); }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment.status, appointment.actualStartTime, service.duration]);

  const scheduledDuration = useMemo(() => {
    const start = safeDate(appointment.startTime);
    const end = safeDate(appointment.endTime);
    return differenceInMinutes(end, start);
  }, [appointment.startTime, appointment.endTime]);

  const isBirthdayToday = useMemo(() => {
    if (!client?.birthday) return false;
    const birth = safeDate(client.birthday);
    const today = new Date();
    return birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate();
  }, [client?.birthday]);

  const handleCopyCheckInLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (appointment.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({
        title: "Link Copied",
        description: "The check-in link has been copied to your clipboard.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "No Token Found",
        description: "This appointment does not have a check-in token.",
      });
    }
  };

  const addOnServices = (appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean);
  const cardStatus = appointment.checkInStatus === 'auto_cancelled' ? 'cancelled' : appointment.status;

  const statusDisplay: Record<string, { text: string; className: string; bgClassName: string }> = {
    confirmed: { text: 'Confirmed', className: 'border-blue-500/30 text-blue-800 dark:text-blue-300', bgClassName: 'bg-blue-500/10' },
    servicing: { text: 'In Service', className: 'border-yellow-500/30 text-yellow-800 dark:text-yellow-300', bgClassName: 'bg-yellow-500/10' },
    completed: { text: 'Completed', className: 'border-green-500/30 text-green-800 dark:text-green-300', bgClassName: 'bg-green-500/10' },
    cancelled: { text: 'Cancelled', className: 'border-red-500/30 text-red-800 dark:text-red-300', bgClassName: 'bg-red-500/10' },
    deposit_pending: { text: 'Awaiting Payment', className: 'border-pink-500/30 text-pink-800 dark:text-pink-300', bgClassName: 'bg-pink-500/10' },
    ready_for_checkout: { text: 'Checkout', className: 'border-orange-500/30 text-orange-800 dark:text-orange-300', bgClassName: 'bg-orange-500/10' },
  };

  const hasPadBefore = (service.padBefore || 0) > 0;
  const hasPadAfter = (service.padAfter || 0) > 0;
  const totalDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
  const isCompact = scheduledDuration < 50;

  // Check-in visual cues
  const checkInIndicator = useMemo(() => {
    if (appointment.status === 'servicing' || appointment.status === 'completed') return null;
    
    switch (appointment.checkInStatus) {
        case 'arrived':
            return (
                <Badge className="bg-green-500 text-white border-none text-[9px] font-black uppercase h-4 px-1 shadow-sm">
                    <MapPin className="w-2 h-2 mr-0.5 fill-current" />
                    Here
                </Badge>
            );
        case 'running_late':
            return (
                <Badge className="bg-amber-500 text-white border-none text-[9px] font-black uppercase h-4 px-1 shadow-sm animate-pulse">
                    <Clock className="w-2 h-2 mr-0.5" />
                    +{appointment.lateTimeMinutes}m
                </Badge>
            );
        case 'on_my_way':
            return (
                <Badge className="bg-blue-500 text-white border-none text-[9px] font-black uppercase h-4 px-1 shadow-sm">
                    <Car className="w-2 h-2 mr-0.5" />
                    Way
                </Badge>
            );
        default:
            return null;
    }
  }, [appointment.checkInStatus, appointment.lateTimeMinutes, appointment.status]);

  return (
    <div style={style} className="flex flex-col h-full w-full">
      {hasPadBefore && <div style={{ height: `${(service.padBefore! / totalDuration) * 100}%` }} className="bg-muted/20 rounded-t-lg bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />}
      <div style={{ height: `${(service.duration / totalDuration) * 100}%` }} className="min-h-fit">
        <div 
          className={cn(
            'p-2 border rounded-lg w-full h-full flex flex-col justify-between cursor-pointer transition-all hover:shadow-md backdrop-blur-sm relative', 
            statusDisplay[cardStatus]?.bgClassName, 
            statusDisplay[cardStatus]?.className, 
            hasPadBefore && 'rounded-t-none', 
            hasPadAfter && 'rounded-b-none', 
            isRunningOver && 'bg-destructive/20 border-destructive animate-pulse',
            appointment.checkInStatus === 'arrived' && 'ring-2 ring-green-500/50 border-green-500/50'
          )}
          onClick={() => onViewDetails(appointment)}
        >
          <div className="flex items-start justify-between min-w-0">
            <div className='flex-1 min-w-0'>
              <div className="flex items-center gap-1.5 mb-0.5">
                {checkInIndicator}
                {appointment.isWalkIn && <Users className="h-3 w-3 text-muted-foreground" />}
                {client.activeMembershipId && <Award className="w-3 h-3 text-indigo-500" />}
                {isBirthdayToday && <TooltipProvider><Tooltip><TooltipTrigger><Cake className="h-3 w-3 text-pink-500" /></TooltipTrigger><TooltipContent>Birthday!</TooltipContent></Tooltip></TooltipProvider>}
              </div>
              <p className="font-bold text-xs leading-tight truncate">
                {client.name}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">{isCompact ? service.name : (addOnServices.length > 0 ? `${service.name} + ${addOnServices.length}` : service.name)}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={e => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent onClick={e => e.stopPropagation()}>
                {appointment.status === 'servicing' && (
                    <DropdownMenuItem onClick={() => onFinishService(appointment)}><Square className="mr-2 h-4 w-4" /> Finish Service</DropdownMenuItem>
                )}
                {appointment.status === 'ready_for_checkout' && (
                    <DropdownMenuItem onClick={() => onCompleteClick(appointment)}><CheckCircle className="mr-2 h-4 w-4" /> Checkout</DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onReschedule(appointment)} disabled={appointment.status === 'completed'}><Calendar className="mr-2 h-4 w-4" /> Reschedule</DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyCheckInLink}><LinkIcon className="mr-2 h-4 w-4" /> Copy Check-in Link</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewDetails(appointment)}><FileText className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(appointment.id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {appointment.status === 'servicing' && elapsedTime && <div className="flex-1 flex items-center justify-center"><p className="text-2xl font-black font-mono tracking-tighter">{elapsedTime}</p></div>}
          <div className="flex items-end justify-between mt-1">
            <p className="text-[10px] text-muted-foreground font-bold">{format(safeDate(appointment.startTime), 'h:mm a')}</p>
            {appointment.status === 'ready_for_checkout' && <Button size="xs" className="h-6 px-2 bg-orange-500 text-white hover:bg-orange-600" onClick={e => { e.stopPropagation(); onCompleteClick(appointment); }}>Checkout</Button>}
          </div>
        </div>
      </div>
      {hasPadAfter && <div style={{ height: `${(service.padAfter! / totalDuration) * 100}%` }} className="bg-muted/20 rounded-b-lg bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]" />}
    </div>
  );
}
