'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff, Appointment } from '@/lib/data';
import { formatDistanceToNow, parseISO, format, isSameMonth } from 'date-fns';
import { User, Clock, UserPlus, Play, Users, GripVertical, ChevronDown, Trash2, TrendingUp, Printer, MessageSquare, Car, MapPin, AlertTriangle, MoreHorizontal, Fingerprint, Cake } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { cn } from '@/lib/utils';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useInventory } from '@/context/InventoryContext';

interface WaitingCustomerCardProps {
    item: (WalkIn | Appointment) & { type: 'walk-in' | 'appointment' };
    services: Service[] | null;
    staffList: Staff[] | null;
    onAssign: () => void;
    onCancel: (id: string, isWalkIn: boolean) => void;
    onMoveToFront?: (id: string) => void;
    onPrintTicket: (id: string) => void;
    groupSize?: number;
    onUpdateStatus: (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => void;
    onResolve: () => void;
}

const statusOptions = [
    { value: 'pending', label: 'Reset to Pending', icon: Clock, color: 'text-slate-400' },
    { value: 'on_my_way', label: 'Mark as On My Way', icon: Car, color: 'text-blue-500' },
    { value: 'arrived', label: 'Mark as Arrived', icon: MapPin, color: 'text-green-500' },
    { value: 'running_late', label: 'Mark as Running Late', icon: AlertTriangle, color: 'text-amber-500' },
];

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

export const WaitingCustomerCard: React.FC<WaitingCustomerCardProps> = ({ item, services, staffList, onAssign, onCancel, onMoveToFront, onPrintTicket, groupSize = 1, onUpdateStatus, onResolve }) => {
    const { clients } = useInventory();
    const isWalkIn = item.type === 'walk-in';
    const customerName = isWalkIn ? (item as WalkIn).customerName : (item as Appointment).clientName;
    const serviceIds = isWalkIn ? (item as WalkIn).serviceIds : [(item as Appointment).serviceId];
    const checkInTime = isWalkIn ? (item as WalkIn).checkInTime : (item as Appointment).startTime;
    const checkInStatus = (item as any).checkInStatus || 'pending';
    const lateTimeMinutes = (item as any).lateTimeMinutes || 0;
    const isPotentialAlias = (item as any).isPotentialAlias || false;
    
    const primaryServices = services?.filter(s => serviceIds.includes(s.id));
    const waitTime = isWalkIn ? formatDistanceToNow(safeDate(checkInTime), { addSuffix: true }) : format(safeDate(checkInTime), 'h:mm a');
    
    const preferredStaffId = isWalkIn ? (item as WalkIn).preferredStaffId : (item as Appointment).staffId;
    const preferredStaff = staffList?.find(s => s.id === preferredStaffId);
    
    const [isLateEntryOpen, setIsLateEntryOpen] = useState(false);
    const [tempLateMinutes, setTempLateMinutes] = useState(lateTimeMinutes.toString());

    const handleLateConfirm = () => {
        const mins = parseInt(tempLateMinutes) || 0;
        onUpdateStatus(item.id, isWalkIn, 'running_late', mins);
        setIsLateEntryOpen(false);
    };

    const isBirthdayToday = useMemo(() => {
        const clientId = isWalkIn ? (item as WalkIn).clientId : (item as Appointment).clientId;
        const client = clients?.find(c => c.id === clientId);
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        return isSameMonth(new Date(), birth) && birth.getDate() === new Date().getDate();
    }, [item, clients, isWalkIn]);

    return (
        <Card className={cn(
            "transition-all border-2 rounded-2xl overflow-hidden",
            checkInStatus === 'arrived' ? "border-green-500/20 bg-green-500/[0.03] shadow-lg shadow-green-500/5" : 
            checkInStatus === 'running_late' ? "border-amber-500/20 bg-amber-500/[0.03]" : 
            isPotentialAlias ? "border-destructive/40 ring-4 ring-destructive/10" : "border-border/50 bg-white"
        )}>
            <CardContent className="p-5 space-y-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{customerName}</p>
                            {isBirthdayToday && <Badge className="bg-pink-500 text-white border-none text-[8px] h-4 font-black uppercase animate-bounce"><Cake className="w-2 h-2 mr-1" /> B-Day</Badge>}
                        </div>
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mt-1 flex items-center gap-1.5 opacity-60">
                            <Clock className="w-2.5 h-2.5" />
                            {isWalkIn ? `Waiting ${waitTime}` : `Scheduled ${waitTime}`}
                        </p>
                    </div>
                    <div className="text-right shrink-0">
                        {primaryServices?.slice(0, 1).map(s => <p key={s.id} className="text-[10px] font-black uppercase text-primary tracking-tight">{s.name}</p>)}
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40">{groupSize > 1 ? `Group of ${groupSize}` : `${(item as any).estimatedDuration || 0} min`}</p>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 p-2 bg-muted/20 rounded-xl border-2 border-transparent">
                    <div className="flex gap-1.5">
                        {statusOptions.map((status) => {
                            const Icon = status.icon;
                            const isActive = checkInStatus === status.value;
                            return (
                                <TooltipProvider key={status.value}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant={isActive ? 'default' : 'outline'} size="icon" className={cn("h-8 w-8 rounded-xl border-2 transition-all", isActive ? "shadow-md" : "text-muted-foreground/40 hover:border-primary/20")} onClick={() => status.value === 'running_late' ? setIsLateEntryOpen(true) : onUpdateStatus(item.id, isWalkIn, status.value)}>
                                                <Icon className="h-3.5 w-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="rounded-xl border-2 font-black text-[10px] uppercase tracking-widest">{status.label}</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            );
                        })}
                    </div>
                    {checkInStatus === 'running_late' && <Badge className="bg-amber-500 border-none text-[9px] font-black uppercase animate-pulse">+{lateTimeMinutes}m Late</Badge>}
                    {checkInStatus === 'arrived' && <Badge className="bg-green-500 border-none text-[9px] font-black uppercase tracking-widest">Arrived</Badge>}
                </div>

                {isPotentialAlias && (
                    <Button size="sm" variant="destructive" className="w-full h-10 font-black text-[10px] uppercase tracking-widest rounded-xl shadow-xl shadow-destructive/20 animate-in slide-in-from-top-2" onClick={onResolve}>
                        <Fingerprint className="w-4 h-4 mr-2" /> Resolve Identity Match
                    </Button>
                )}

                {preferredStaff && (
                    <div className={cn("flex items-center gap-2 p-2 rounded-xl border-2 w-fit", isWalkIn ? "bg-primary/5 border-primary/10" : "bg-indigo-500/5 border-indigo-500/10")}>
                        <Avatar className="h-6 w-6 border-2 border-background shadow-inner rounded-lg"><AvatarImage src={preferredStaff.avatarUrl} className="object-cover" /><AvatarFallback className="text-[8px] font-black">{(preferredStaff.name || 'S').charAt(0)}</AvatarFallback></Avatar>
                        <span className={cn("text-[9px] font-black uppercase tracking-widest", isWalkIn ? "text-primary" : "text-indigo-700")}>{isWalkIn ? 'Pref:' : 'With:'} {preferredStaff.name.split(' ')[0]}</span>
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-2 border-t bg-muted/5 gap-2">
                {isWalkIn && onMoveToFront && <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-primary hover:bg-primary/10" onClick={() => onMoveToFront(item.id)}><TrendingUp className="w-4 h-4" /></Button>}
                <Button variant="secondary" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-sm" onClick={onAssign}>
                    <UserPlus className="w-3.5 h-3.5 mr-2" />
                    Assign Session
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl"><MoreHorizontal className="w-4 h-4"/></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-2xl">
                        <DropdownMenuItem onClick={() => onPrintTicket(item.id)} className="font-bold text-[10px] uppercase tracking-widest"><Printer className="w-3.5 h-3.5 mr-2" /> Print Ticket</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onCancel(item.id, isWalkIn)} className="text-destructive font-bold text-[10px] uppercase tracking-widest"><Trash2 className="w-3.5 h-3.5 mr-2" /> Cancel {isWalkIn ? 'Walk-in' : 'Appointment'}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>

            <Dialog open={isLateEntryOpen} onOpenChange={setIsLateEntryOpen}>
                <DialogContent className="sm:max-w-[320px] rounded-[3rem] border-4">
                    <DialogHeader className="p-6 pb-0"><DialogTitle className="text-xl font-black uppercase tracking-tighter">Minutes Late</DialogTitle></DialogHeader>
                    <div className="p-8">
                        <div className="grid grid-cols-4 gap-2 mb-6">
                            {['5', '10', '15', '20'].map(m => (
                                <Button key={m} variant={tempLateMinutes === m ? 'default' : 'outline'} className="h-10 rounded-xl font-black" onClick={() => setTempLateMinutes(m)}>{m}</Button>
                            ))}
                        </div>
                        <Input type="number" placeholder="Custom..." className="text-center text-3xl font-black h-16 rounded-2xl border-2" value={tempLateMinutes} onChange={(e) => setTempLateMinutes(e.target.value)} />
                    </div>
                    <DialogFooter className="p-6 pt-0"><Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-widest shadow-xl" onClick={handleLateConfirm}>Update Status</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};