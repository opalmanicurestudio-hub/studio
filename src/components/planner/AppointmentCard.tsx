'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds, isSameMonth } from 'date-fns';
import {
  Award,
  MoreHorizontal,
  Clock,
  Trash2,
  CheckCircle,
  FileText,
  Calendar,
  Users,
  Cake,
  Link as LinkIcon,
  MapPin,
  Car,
  Square,
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
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

export function AppointmentCard({
  appointment,
  client,
  service,
  style,
  onUpdateStatus,
  onDelete,
  onCompleteClick,
  onEdit,
  onReschedule,
  onViewDetails,
  onFinishService,
}: any) {
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
        setElapsedTime(hours > 0 ? `${hours}:${String(displayMins).padStart(2, '0')}:${String(displaySecs).padStart(2, '0')}` : `${displayMins}:${String(displaySecs).padStart(2, '0')}`);
        setIsRunningOver(mins > service.duration);
      }, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment.status, appointment.actualStartTime, service.duration]);

  const isBirthdayToday = useMemo(() => {
    if (!client?.birthday) return false;
    const birth = safeDate(client.birthday);
    const today = new Date();
    return isSameMonth(today, birth) && birth.getDate() === today.getDate();
  }, [client?.birthday]);

  const handleCopyCheckInLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (appointment.checkInToken) {
      navigator.clipboard.writeText(`${window.location.origin}/check-in/${appointment.checkInToken}`);
      toast({ title: "Link Copied" });
    }
  };

  const statusDisplay: Record<string, { text: string; className: string; bgClassName: string; dotColor: string }> = {
    confirmed: { text: 'Confirmed', className: 'border-blue-500/20 text-blue-800 bg-blue-500/[0.03]', bgClassName: 'bg-blue-500/5', dotColor: 'bg-blue-500' },
    servicing: { text: 'Live', className: 'border-primary ring-4 ring-primary/10 text-primary bg-primary/[0.02]', bgClassName: 'bg-primary/5', dotColor: 'bg-primary' },
    completed: { text: 'Finished', className: 'border-green-500/20 text-green-800 bg-green-500/[0.03]', bgClassName: 'bg-green-500/5', dotColor: 'bg-green-500' },
    cancelled: { text: 'Cancelled', className: 'border-red-500/20 text-red-800 bg-red-500/[0.03] grayscale', bgClassName: 'bg-red-500/5', dotColor: 'bg-red-500' },
    deposit_pending: { text: 'Deposit Due', className: 'border-amber-500/20 text-amber-800 bg-amber-500/[0.03]', bgClassName: 'bg-amber-500/5', dotColor: 'bg-amber-500' },
    ready_for_checkout: { text: 'Checkout', className: 'border-orange-500/20 text-orange-800 bg-orange-500/[0.03] shadow-lg', bgClassName: 'bg-orange-500/5', dotColor: 'bg-orange-500' },
  };

  const cardStatus = appointment.checkInStatus === 'auto_cancelled' ? 'cancelled' : appointment.status;
  const currentStatus = statusDisplay[cardStatus];

  const checkInIndicator = useMemo(() => {
    if (appointment.status === 'servicing' || appointment.status === 'completed') return null;
    switch (appointment.checkInStatus) {
        case 'arrived': return <Badge className="bg-green-500 text-white border-none text-[8px] font-black uppercase h-4 px-1 shadow-sm"><MapPin className="w-2 h-2 mr-0.5" />HERE</Badge>;
        case 'running_late': return <Badge className="bg-amber-500 text-white border-none text-[8px] font-black uppercase h-4 px-1 shadow-sm animate-pulse">+{appointment.lateTimeMinutes}M</Badge>;
        case 'on_my_way': return <Badge className="bg-blue-500 text-white border-none text-[8px] font-black uppercase h-4 px-1 shadow-sm">WAY</Badge>;
        default: return null;
    }
  }, [appointment.checkInStatus, appointment.lateTimeMinutes, appointment.status]);

  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  const totalDuration = service.duration + totalPadding;

  return (
    <div style={style} className="flex flex-col h-full w-full group">
      {service.padBefore > 0 && <div style={{ height: `${(service.padBefore / totalDuration) * 100}%` }} className="bg-muted/10 rounded-t-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
      <div style={{ height: `${(service.duration / totalDuration) * 100}%` }} className="min-h-fit flex-1">
        <Card 
          className={cn(
            'p-2.5 border-2 w-full h-full flex flex-col transition-all duration-300 hover:shadow-2xl relative rounded-xl overflow-hidden', 
            currentStatus?.className,
            isRunningOver && 'border-destructive ring-4 ring-destructive/20 animate-pulse bg-destructive/10'
          )}
          onClick={() => onViewDetails(appointment)}
        >
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    {checkInIndicator}
                    {appointment.status === 'servicing' && <Badge className="bg-primary text-white border-none text-[8px] font-black uppercase h-4 px-1 animate-pulse">LIVE</Badge>}
                    {appointment.isWalkIn && <Users className="h-3 w-3 text-muted-foreground opacity-40" />}
                    {isBirthdayToday && <Cake className="h-3 w-3 text-pink-500" />}
                </div>
                <p className="font-black uppercase tracking-tight text-[11px] text-slate-900 truncate leading-none mb-1">{client.name}</p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest truncate opacity-60">{service.name}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                {appointment.status === 'servicing' && <DropdownMenuItem onClick={() => onFinishService(appointment)} className="font-bold text-[10px] uppercase tracking-widest"><Square className="mr-2 h-3.5 w-3.5" /> End Session</DropdownMenuItem>}
                {appointment.status === 'ready_for_checkout' && <DropdownMenuItem onClick={() => onCompleteClick(appointment)} className="font-bold text-[10px] uppercase tracking-widest text-primary"><CheckCircle className="mr-2 h-3.5 w-3.5" /> Open Checkout</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => onReschedule(appointment)} className="font-bold text-[10px] uppercase tracking-widest"><Calendar className="mr-2 h-3.5 w-3.5" /> Reschedule</DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyCheckInLink} className="font-bold text-[10px] uppercase tracking-widest"><LinkIcon className="mr-2 h-3.5 w-3.5" /> Copy Link</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(appointment.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest"><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {appointment.status === 'servicing' && elapsedTime && (
            <div className="flex-1 flex items-center justify-center py-1">
                <p className={cn("text-2xl font-black font-mono tracking-tighter leading-none", isRunningOver ? "text-destructive" : "text-primary")}>{elapsedTime}</p>
            </div>
          )}

          <div className="mt-auto pt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
                <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", currentStatus?.dotColor)} />
                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">{format(safeDate(appointment.startTime), 'h:mm a')}</p>
            </div>
            {appointment.status === 'ready_for_checkout' && (
                <Button size="xs" className="h-5 px-2 bg-primary text-white border-none font-black text-[8px] uppercase tracking-widest shadow-lg shadow-primary/20 rounded-lg animate-bounce" onClick={e => { e.stopPropagation(); onCompleteClick(appointment); }}>PAY</Button>
            )}
          </div>
        </Card>
      </div>
      {service.padAfter > 0 && <div style={{ height: `${(service.padAfter / totalDuration) * 100}%` }} className="bg-muted/10 rounded-b-xl bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.05)_4px,rgba(0,0,0,0.05)_5px)]" />}
    </div>
  );
}
