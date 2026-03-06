
'use client';

import React, { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff, getServicePrice } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, FlaskConical, TicketIcon, MoreHorizontal, Undo2, Cake, DollarSign, User } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

export const CheckoutQueueCard: React.FC<any> = ({ appointmentData, isSelected, onSelect, onRevertToService }) => {
  if (!appointmentData || !appointmentData.appointment) return null;
  const { appointment: apt, client, service, addOnServices, staff } = appointmentData;
  const isBirthdayToday = useMemo(() => {
    if (!client?.birthday) return false;
    const birth = safeDate(client.birthday);
    return birth.getMonth() === new Date().getMonth() && birth.getDate() === new Date().getDate();
  }, [client]);

  const totalPrice = useMemo(() => {
    const mainPrice = getServicePrice(service, staff);
    const addOnsTotal = addOnServices.reduce((acc: number, s: any) => acc + getServicePrice(s, staff), 0);
    const additional = apt.checkoutState?.additionalCharge || 0;
    return mainPrice + addOnsTotal + additional;
  }, [service, addOnServices, staff, apt.checkoutState]);

  return (
    <div className="w-full shrink-0">
        <Label htmlFor={`pos-checkout-sel-${apt.id}`} className={cn("block cursor-pointer rounded-[2rem] border-2 bg-white transition-all relative group", isSelected ? "border-primary ring-4 ring-primary/10 shadow-2xl translate-y-[-4px]" : "border-border/50 hover:border-primary/30 shadow-sm")}>
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <Checkbox id={`pos-checkout-sel-${apt.id}`} checked={isSelected} onCheckedChange={onSelect} className="h-6 w-6 rounded-lg border-2" onClick={(e) => e.stopPropagation()} />
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{client?.name || 'Walk-in'}</p>
                                {isBirthdayToday && <Cake className="w-3.5 h-3.5 text-pink-500 animate-pulse shrink-0" />}
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 tracking-widest">{apt.startTime ? format(safeDate(apt.startTime), 'h:mm a') : 'Now'}</p>
                                <Badge variant="outline" className="text-[8px] h-4 font-black bg-muted/50 border-none">#{apt.id.slice(-4).toUpperCase()}</Badge>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <Avatar className="h-9 w-9 border-2 border-background shadow-xl rounded-xl">
                            <AvatarImage src={staff?.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary">{(staff?.name || 'S')[0]}</AvatarFallback>
                        </Avatar>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.preventDefault()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-2xl"><DropdownMenuItem onClick={(e) => { e.preventDefault(); onRevertToService(); }} className="font-bold text-[10px] uppercase tracking-widest"><Undo2 className="w-3.5 h-3.5 mr-2" /> Revert Entry</DropdownMenuItem></DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                 <div className="flex items-end justify-between pt-4 border-t border-dashed mt-2">
                    <div className="space-y-1 min-w-0">
                        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-40">Assigned Pro</p>
                        <p className="text-[11px] font-black text-slate-700 uppercase tracking-tight truncate">{staff?.name}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-black uppercase text-primary tracking-widest opacity-60 mb-0.5">Grand Total</p>
                        <p className="text-2xl font-black text-primary tracking-tighter font-mono">${totalPrice.toFixed(2)}</p>
                    </div>
                </div>
            </CardContent>
        </Label>
    </div>
  );
};
