'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { 
  ShieldPlus, 
  AlertTriangle, 
  Ear, 
  ShieldAlert, 
  Award, 
  Wallet,
  FileText,
  DollarSign,
  ArrowRight,
  Lock
} from 'lucide-react';
import { type Client } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from 'react-phone-number-input';
import { useTenant } from '@/context/TenantContext';

export const ClientCard = ({ client, isSelected, onSelect }: { client: Client, isSelected: boolean, onSelect: () => void }) => {
    const { role } = useTenant();
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

    const lastAppointment = useMemo(() => {
        if (!client.lastAppointment) return null;
        return new Date(client.lastAppointment);
    }, [client.lastAppointment]);
    
    const getInitials = (name: string) => {
        const parts = name.split(' ');
        if (parts.length > 1 && parts[parts.length - 1]) {
            return (parts[0][0] + (parts[parts.length - 1][0]).toUpperCase()).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    const hasDebt = Number(client.outstandingBalance || 0) > 0;
    const isMember = !!(client.activeMembershipId || client.subscription);
    const hasCardOnFile = !!client.cardOnFile?.token;

    return (
        <Card className={cn(
            "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col",
            isSelected ? "border-primary ring-4 ring-primary/10 shadow-2xl translate-y-[-4px]" : "border-border/50 bg-white hover:border-primary/20 shadow-sm",
            hasDebt && "border-destructive/30 bg-destructive/[0.01]",
            isMember && "border-indigo-500/20 bg-indigo-500/[0.01]"
        )}>
            <CardContent className="p-6 md:p-8 space-y-6 flex-1 flex flex-col" onClick={onSelect}>
                <div className="flex items-start justify-between gap-4 cursor-pointer">
                    <div className="flex items-center gap-4 min-w-0">
                        <Checkbox
                            id={`select-${client.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            className="h-6 w-6 rounded-lg border-2 shadow-inner"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <div className="relative shrink-0">
                            <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-3xl transition-transform group-hover:scale-105 duration-500">
                                <AvatarImage src={client.avatarUrl} alt={client.name} className="object-cover"/>
                                <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{getInitials(client.name)}</AvatarFallback>
                            </Avatar>
                            {isMember && (
                                <div className="absolute -top-2 -right-2 bg-indigo-600 text-white p-1 rounded-lg shadow-lg border-2 border-background">
                                    <Award className="w-3.5 h-3.5" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-2 mb-1">
                                <p className="font-black uppercase tracking-tight text-base md:text-lg text-slate-900 truncate leading-none">{client.name}</p>
                                {hasCardOnFile && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                <Lock className="w-3.5 h-3.5 text-primary opacity-40" />
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Secure Card on File</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 tracking-widest">{client.status === 'active' ? 'Registered' : client.status}</p>
                                {hasDebt && <Badge variant="destructive" className="h-4 px-1.5 font-black text-[8px] uppercase border-none animate-pulse">Arrears</Badge>}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all text-left">
                        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Gross Yield</p>
                        <p className="text-xl font-black font-mono tracking-tighter text-slate-900">${Number(client.lifetimeValue || 0).toFixed(2)}</p>
                    </div>
                    {hasDebt ? (
                        <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/10 space-y-1 text-left">
                            <p className="text-[9px] font-black uppercase tracking-widest text-destructive/60">Arrears</p>
                            <p className="text-xl font-black font-mono tracking-tighter text-destructive">${Number(client.outstandingBalance || 0).toFixed(2)}</p>
                        </div>
                    ) : (
                        <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all text-right">
                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Last Seen</p>
                            <p className="text-xs font-black uppercase tracking-tight text-slate-700">
                                {lastAppointment ? format(lastAppointment, 'MMM d, yyyy') : 'New Guest'}
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-dashed mt-auto">
                    <TooltipProvider>
                        <div className="flex gap-2">
                            {client.intel?.hasIncidents && (
                                <Tooltip>
                                    <TooltipTrigger><ShieldAlert className="w-4 h-4 text-purple-500 opacity-60 hover:opacity-100" /></TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Incidents on file</TooltipContent>
                                </Tooltip>
                            )}
                            {client.medicalNotes && (
                                <Tooltip>
                                    <TooltipTrigger><ShieldPlus className="w-4 h-4 text-red-500 opacity-60 hover:opacity-100" /></TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Medical Alert</TooltipContent>
                                </Tooltip>
                            )}
                            {client.allergyNotes && (
                                <Tooltip>
                                    <TooltipTrigger><AlertTriangle className="w-4 h-4 text-orange-500 opacity-60 hover:opacity-100" /></TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Allergy Alert</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    </TooltipProvider>
                    
                    {isOwnerOrAdmin && (
                        <div className="flex-1 flex flex-col items-end gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                            <p className="text-[8px] font-black uppercase tracking-tighter text-muted-foreground truncate w-full text-right">{client.email || 'No email'}</p>
                            <p className="text-[8px] font-black uppercase tracking-tighter text-muted-foreground">{client.phone ? formatPhoneNumber(client.phone) : 'No phone'}</p>
                        </div>
                    )}
                </div>
            </CardContent>
            
            <div className="p-3 border-t bg-muted/5 flex items-center justify-between gap-4">
                <div className="flex gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-primary/5 hover:border-primary/30 text-primary transition-all active:scale-90"
                                    asChild
                                >
                                    <Link href={`/clients/${client.id}`} onClick={e => e.stopPropagation()}>
                                        <FileText className="h-5 w-5" />
                                    </Link>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Open Dossier</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-primary/5 hover:border-primary/30 text-primary transition-all active:scale-90"
                                    asChild
                                >
                                    <Link href={`/pos?payer_id=${client.id}`} onClick={e => e.stopPropagation()}>
                                        <DollarSign className="h-5 w-5" />
                                    </Link>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Quick Checkout</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <Button variant="ghost" asChild className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn">
                    <Link href={`/clients/${client.id}`} onClick={e => e.stopPropagation()}>
                        View Record <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover:btn:translate-x-1" />
                    </Link>
                </Button>
            </div>
        </Card>
    )
}