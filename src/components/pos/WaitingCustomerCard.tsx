'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff, Appointment } from '@/lib/data';
import { formatDistanceToNow, parseISO, format, differenceInMinutes } from 'date-fns';
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

/**
 * Utility to safely convert potential strings or Date objects into valid Date instances.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
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

    const isBirthdayToday = useMemo(() => {
        const clientId = isWalkIn ? (item as WalkIn).clientId : (item as Appointment).clientId;
        const client = clients?.find(c => c.id === clientId);
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate();
    }, [item, clients, isWalkIn]);

    const handleLateConfirm = () => {
        onUpdateStatus(item.id, isWalkIn, 'running_late', parseInt(tempLateMinutes) || 0);
        setIsLateEntryOpen(false);
    };

    return (
        <Card className={cn(
            "transition-all border-2",
            checkInStatus === 'arrived' ? "border-green-500/20 bg-green-500/[0.02]" : 
            checkInStatus === 'running_late' ? "border-amber-500/20 bg-amber-500/[0.02]" : 
            isPotentialAlias ? "border-destructive/40 ring-2 ring-destructive/10" : "border-border"
        )}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="font-bold truncate flex items-center gap-2 text-sm text-foreground">
                                        {!isWalkIn && <Clock className="w-3 h-3 text-primary shrink-0" />}
                                        {customerName}
                                    </p>
                                    {isBirthdayToday && <Badge className="bg-pink-500 text-white border-none text-[8px] h-4 px-1 uppercase font-black shadow-sm animate-bounce"><Cake className="w-2 h-2 mr-0.5" /> Birthday</Badge>}
                                </div>
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 font-bold uppercase tracking-wider">
                                    <Clock className="w-3 h-3"/>
                                    {isWalkIn ? `Waiting ${waitTime}` : `SCHEDULED ${waitTime}`}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                {primaryServices?.map(s => <p key={s.id} className="text-[11px] font-bold leading-tight">{s.name}</p>)}
                                <p className="text-[10px] text-muted-foreground">
                                    {isWalkIn 
                                        ? `${(item as WalkIn).estimatedDuration} min` 
                                        : `${differenceInMinutes(safeDate((item as Appointment).endTime), safeDate((item as Appointment).startTime))} min`
                                    }
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-dashed">
                    <div className="flex gap-1.5">
                        <TooltipProvider>
                            {statusOptions.map((status) => {
                                const Icon = status.icon;
                                const isActive = checkInStatus === status.value;
                                return (
                                    <Tooltip key={status.value}>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant={isActive ? 'default' : 'outline'}
                                                size="icon"
                                                className={cn(
                                                    "h-8 w-8 rounded-full",
                                                    isActive ? "" : "text-muted-foreground border-muted"
                                                )}
                                                onClick={() => {
                                                    if (status.value === 'running_late') {
                                                        setIsLateEntryOpen(true);
                                                    } else {
                                                        onUpdateStatus(item.id, isWalkIn, status.value);
                                                    }
                                                }}
                                            >
                                                <Icon className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>{status.label}</p></TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </TooltipProvider>
                    </div>
                    {checkInStatus === 'running_late' && (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-black animate-pulse">
                            +{lateTimeMinutes} MIN
                        </Badge>
                    )}
                    {checkInStatus === 'arrived' && (
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 text-[10px] font-black uppercase">
                            Here
                        </Badge>
                    )}
                </div>

                {isPotentialAlias && (
                    <Button 
                        size="sm" 
                        variant="destructive" 
                        className="w-full mt-2 h-9 font-black animate-pulse shadow-lg shadow-destructive/20"
                        onClick={onResolve}
                    >
                        <Fingerprint className="w-4 h-4 mr-2" />
                        RESOLVE IDENTITY MATCH
                    </Button>
                )}

                {(preferredStaff || (item as any).notes) && (
                    <div className="flex flex-wrap gap-2 pt-1 items-center">
                        {preferredStaff && (
                            <div className={cn(
                                "flex items-center gap-2 p-1.5 rounded-lg border shadow-sm",
                                isWalkIn ? "bg-primary/5 border-primary/10" : "bg-indigo-500/5 border-indigo-500/20"
                            )}>
                                <Avatar className="h-5 w-5 border border-background shadow-inner">
                                    <AvatarImage src={preferredStaff.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[8px] bg-muted">{preferredStaff.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className={cn(
                                    "text-[9px] font-black uppercase tracking-tight",
                                    isWalkIn ? "text-primary" : "text-indigo-700 dark:text-indigo-400"
                                )}>
                                    {isWalkIn ? `Pref: ${preferredStaff.name.split(' ')[0]}` : `With: ${preferredStaff.name}`}
                                </span>
                            </div>
                        )}
                        {(item as any).notes && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge variant="outline" className="text-[9px] h-5 cursor-help">
                                            <MessageSquare className="w-2.5 h-2.5 mr-1" />
                                            Notes
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent><p className="max-w-xs">{(item as any).notes}</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-2 border-t bg-muted/30">
                <TooltipProvider>
                    <div className="flex justify-around w-full">
                        {isWalkIn && onMoveToFront && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMoveToFront(item.id)}>
                                        <TrendingUp className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Move to Front</p></TooltipContent>
                            </Tooltip>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onAssign}>
                                    <UserPlus className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Assign Staff</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPrintTicket(item.id)}>
                                    <Printer className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Print Ticket</p></TooltipContent>
                        </Tooltip>
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4"/></Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent><p>More Actions</p></TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onCancel(item.id, isWalkIn)} className="text-destructive">
                                    <Trash2 className="w-4 h-4 mr-2" /> Cancel {isWalkIn ? 'Walk-in' : 'Appointment'}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </TooltipProvider>
            </CardFooter>

            <Dialog open={isLateEntryOpen} onOpenChange={setIsLateEntryOpen}>
                <DialogContent className="sm:max-w-[300px]">
                    <DialogHeader>
                        <DialogTitle>Minutes Late</DialogTitle>
                        <DialogDescription>Enter how many minutes the client will be delayed.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="late-mins" className="sr-only">Minutes</Label>
                        <div className="grid grid-cols-4 gap-2">
                            {['5', '10', '15', '20'].map(m => (
                                <Button key={m} variant={tempLateMinutes === m ? 'default' : 'outline'} size="sm" onClick={() => setTempLateMinutes(m)}>
                                    {m}
                                </Button>
                            ))}
                        </div>
                        <Input 
                            id="late-mins" 
                            type="number" 
                            placeholder="Custom..." 
                            className="mt-4 text-center font-bold text-lg h-12"
                            value={tempLateMinutes}
                            onChange={(e) => setTempLateMinutes(e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button className="w-full h-12 text-lg font-black" onClick={handleLateConfirm}>Update Status</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};