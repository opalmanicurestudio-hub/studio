'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Staff, type Appointment, Service } from '@/lib/data';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { 
    Clock, Users, Trash2, TrendingUp, Printer, Car, MapPin, AlertTriangle, 
    Fingerprint, Cake, UserPlus, Award, Repeat, ShieldAlert, MessageSquare, Ear
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { cn, safeNumber } from '@/lib/utils';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useInventory } from '@/context/InventoryContext';

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

export const WaitingCustomerCard: React.FC<any> = ({ item, services, staffList, onAssign, onCancel, onMoveToFront, onPrintTicket, groupSize = 1, onUpdateStatus, onResolve }) => {
    const { clients } = useInventory();
    const isWalkIn = item.type === 'walk-in';
    const customerName = isWalkIn ? (item as WalkIn).customerName : (item as Appointment).clientName;
    const serviceIds = isWalkIn ? (item as WalkIn).serviceIds : [(item as Appointment).serviceId];
    const checkInTime = isWalkIn ? (item as WalkIn).checkInTime : (item as Appointment).startTime;
    const checkInStatus = (item as any).checkInStatus || 'pending';
    const lateTimeMinutes = safeNumber((item as any).lateTimeMinutes) || 0;
    const isPotentialAlias = (item as any).isPotentialAlias || false;
    
    const primaryServices = services?.filter((s: Service) => serviceIds.includes(s.id));
    const waitTime = isWalkIn ? formatDistanceToNow(safeDate(checkInTime), { addSuffix: true }) : format(safeDate(checkInTime), 'h:mm a');
    const preferredStaffId = isWalkIn ? (item as WalkIn).preferredStaffId : (item as Appointment).staffId;
    const preferredStaff = staffList?.find((s: Staff) => s.id === preferredStaffId);
    
    const [isLateEntryOpen, setIsLateEntryOpen] = useState(false);
    const [tempLateMinutes, setTempLateMinutes] = useState(lateTimeMinutes.toString());

    const handleLateConfirm = () => {
        const mins = parseInt(tempLateMinutes) || 0;
        onUpdateStatus(item.id, isWalkIn, 'running_late', mins);
        setIsLateEntryOpen(false);
    };

    const client = useMemo(() => {
        const clientId = isWalkIn ? (item as WalkIn).clientId : (item as Appointment).clientId;
        return clients?.find(c => c.id === clientId);
    }, [item, clients, isWalkIn]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client]);

    const isMember = !!(client?.activeMembershipId || client?.subscription);
    const hasPackage = (client?.activePackages?.length || 0) > 0;
    const isAutoCancelled = checkInStatus === 'auto_cancelled';

    // FIX: Always pass item to onResolve so the details sheet receives the data
    const handleResolve = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        onResolve(item);
    };

    return (
        <Card className={cn(
            "transition-all border-2 rounded-[2rem] overflow-hidden group",
            checkInStatus === 'arrived' ? "border-green-500 bg-green-500/5 shadow-lg shadow-green-500/5 ring-2 ring-green-500/20" : 
            checkInStatus === 'running_late' ? "border-amber-500/20 bg-amber-500/5" : 
            checkInStatus === 'on_my_way' ? "border-blue-500/20 bg-blue-500/5" :
            (isAutoCancelled || item.isEscalated) ? "border-destructive ring-4 ring-destructive/10 bg-destructive/5" :
            isPotentialAlias ? "border-destructive/40 ring-4 ring-destructive/10" : "border-border/50 bg-white"
        )}>
            {item.isEscalated && (
                <div className="bg-destructive px-4 py-1 flex items-center justify-center gap-2 animate-pulse">
                    <ShieldAlert className="w-2.5 h-2.5 text-white" />
                    <span className="text-[8px] font-black uppercase text-white tracking-widest">Escalated</span>
                </div>
            )}
            <CardContent className="p-5 space-y-4 text-left cursor-pointer" onClick={handleResolve}>
                <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            {isBirthdayToday && <Cake className="h-3.5 w-3.5 text-pink-500 animate-bounce shrink-0" />}
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{customerName}</p>
                            {isMember && <Badge className="bg-indigo-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm"><Award className="w-2 h-2 mr-0.5" /> MEM</Badge>}
                            {hasPackage && <Badge className="bg-teal-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm"><Repeat className="w-2 h-2 mr-0.5" /> PKG</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 opacity-60">
                                <Clock className="w-2.5 h-2.5" />
                                {isWalkIn ? `Waiting ${waitTime}` : `Scheduled ${waitTime}`}
                            </p>
                            <div className="flex gap-1.5">
                                {item.notes && (
                                    <TooltipProvider><Tooltip><TooltipTrigger asChild><div className="p-1 bg-primary/10 rounded-lg shrink-0"><MessageSquare className="w-3 h-3 text-primary" /></div></TooltipTrigger><TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Guest Intel Available</TooltipContent></Tooltip></TooltipProvider>
                                )}
                                {client?.sensoryNeeds && (
                                    <TooltipProvider><Tooltip><TooltipTrigger asChild><div className="p-1 bg-blue-500/10 rounded-lg shrink-0"><Ear className="w-3 h-3 text-blue-600" /></div></TooltipTrigger><TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Special Accommodations</TooltipContent></Tooltip></TooltipProvider>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        {primaryServices?.slice(0, 1).map((s: Service) => <p key={s.id} className="text-[10px] font-black uppercase text-primary tracking-tight">{s.name}</p>)}
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40">{groupSize > 1 ? `Group of ${groupSize}` : `${safeNumber((item as any).estimatedDuration) || 0} min`}</p>
                    </div>
                </div>

                {!isAutoCancelled && (
                    <div className="flex items-center justify-between gap-3 p-2 bg-muted/20 rounded-xl border-2 border-transparent" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                            {statusOptions.map((status) => {
                                const Icon = status.icon;
                                const isActive = checkInStatus === status.value;
                                return (
                                    <TooltipProvider key={status.value}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button variant={isActive ? 'default' : 'outline'} size="icon" className={cn("h-8 w-8 rounded-xl border-2 transition-all", isActive ? "shadow-md" : "text-muted-foreground/40 hover:border-primary/20")} onClick={(e) => { e.stopPropagation(); status.value === 'running_late' ? setIsLateEntryOpen(true) : onUpdateStatus(item.id, isWalkIn, status.value); }}>
                                                    <Icon className="h-3.5 w-3.5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-xl border-2 font-black text-[10px] uppercase tracking-widest">{status.label}</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                );
                            })}
                        </div>
                        {checkInStatus === 'running_late' && <Badge className="bg-amber-50 border-none text-[9px] font-black uppercase text-amber-700 animate-pulse">+{lateTimeMinutes}m Late</Badge>}
                        {checkInStatus === 'arrived' && <Badge className="bg-green-500 border-none text-[9px] font-black uppercase tracking-widest shadow-sm">HERE</Badge>}
                        {checkInStatus === 'on_my_way' && <Badge className="bg-blue-500 border-none text-[9px] font-black uppercase tracking-widest"><Car className="w-2.5 h-2.5 mr-1" />EN ROUTE</Badge>}
                    </div>
                )}

                {isAutoCancelled && (
                    <div className="p-4 rounded-2xl bg-destructive/10 border-2 border-destructive/20 space-y-3 shadow-inner">
                        <div className="flex items-center gap-2 text-destructive">
                            <ShieldAlert className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Protocol Intervention Required</span>
                        </div>
                        <p className="text-[10px] font-bold uppercase text-slate-600 leading-tight">Session auto-cancelled due to critical delay (+{lateTimeMinutes}m).</p>
                        <Button variant="destructive" size="sm" className="w-full h-10 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl" onClick={handleResolve}>
                            Resolve Resolution
                        </Button>
                    </div>
                )}

                {isPotentialAlias && !isAutoCancelled && (
                    <Button size="sm" variant="destructive" className="w-full h-10 font-black text-[10px] uppercase tracking-widest rounded-xl shadow-xl shadow-destructive/20 animate-in slide-in-from-top-2" onClick={handleResolve}>
                        <Fingerprint className="w-4 h-4 mr-2" /> Resolve Identity Match
                    </Button>
                )}

                {preferredStaff && !isAutoCancelled && (
                    <div className={cn("flex items-center gap-2 p-2 rounded-xl border-2 w-fit", isWalkIn ? "bg-primary/5 border-primary/10" : "bg-indigo-500/5 border-indigo-500/10")}>
                        <Avatar className="h-6 w-6 border-2 border-background shadow-inner rounded-lg shrink-0"><AvatarImage src={preferredStaff.avatarUrl} className="object-cover" /><AvatarFallback className="text-[8px] font-black">{(preferredStaff.name || 'S').charAt(0)}</AvatarFallback></Avatar>
                        <span className={cn("text-[9px] font-black uppercase tracking-widest", isWalkIn ? 'text-primary' : 'text-indigo-600')}>{isWalkIn ? 'Pref:' : 'With:'} {preferredStaff.name.split(' ')[0]}</span>
                    </div>
                )}
            </CardContent>
            
            {!isAutoCancelled && (
                <div className="p-2 pt-0 grid grid-cols-1 gap-2">
                    <Button variant="secondary" className="w-full h-12 rounded-xl font-black uppercase text-xs tracking-[0.2em] shadow-sm" onClick={(e) => { e.stopPropagation(); onAssign(); }}>
                        <UserPlus className="w-4 h-4 mr-2" />Assign Session
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-10 w-full rounded-xl border-2" onClick={(e) => { e.stopPropagation(); onPrintTicket(item.id); }}>
                                        <Printer className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px]">Print Ticket</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-10 w-full rounded-xl border-2 text-destructive hover:bg-destructive/5" onClick={(e) => { e.stopPropagation(); onCancel(item.id, isWalkIn); }}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px]">Cancel Visit</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            )}

            <Dialog open={isLateEntryOpen} onOpenChange={setIsLateEntryOpen}>
                <DialogContent className="sm:max-w-[320px] rounded-[3rem] border-4 shadow-3xl" onClick={(e) => e.stopPropagation()}>
                    <DialogHeader className="p-6 pb-0"><DialogTitle className="text-xl font-black uppercase tracking-tighter text-left">Minutes Late</DialogTitle></DialogHeader>
                    <div className="p-8 text-left">
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