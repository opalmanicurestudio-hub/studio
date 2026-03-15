
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Award, Users, BarChart, Trash2, Edit, CheckCircle, Percent, Sparkles, ArrowRight, Eye, MoreHorizontal, ListChecks, Clock } from 'lucide-react';
import { type Membership, type Client } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useInventory } from '@/context/InventoryContext';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useTenant } from '@/context/TenantContext';

interface MembershipCardProps {
  membership: Membership;
  clients: Client[];
  onEdit: (membership: Membership) => void;
  onViewUsers: (membership: Membership) => void;
  onDelete: (id: string) => void;
}

export const MembershipCard: React.FC<MembershipCardProps> = ({ membership, clients, onEdit, onViewUsers, onDelete }) => {
  const { services, inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const tmhr = selectedTenant?.tmhr || 50;
  
  const activeMembers = useMemo(() => {
    return clients.filter(c => c.activeMembershipId === membership.id).length;
  }, [clients, membership.id]);

  const { costOfPerks, netProfit, profitMargin, monthlyTimeLiability } = useMemo(() => {
    // 1. Calculate Material Costs
    const servicesMaterialCost = (membership.includedServices || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.cost || 0) * perk.quantity;
    }, 0);
    const addOnsMaterialCost = (membership.includedAddOns || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.cost || 0) * perk.quantity;
    }, 0);
    const productsCost = (membership.includedProducts || []).reduce((acc, perk) => {
        const p = inventory.find(inv => inv.id === perk.id);
        return acc + (p?.costPerUnit || 0) * perk.quantity;
    }, 0);

    // 2. Calculate Time Liability per member
    const serviceTime = (membership.includedServices || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.duration || 0) * perk.quantity;
    }, 0);
    const addOnTime = (membership.includedAddOns || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.duration || 0) * perk.quantity;
    }, 0);

    const timeLiabilityHours = (serviceTime + addOnTime) / 60;
    const timeCostAtTmhr = timeLiabilityHours * tmhr;

    const totalCost = servicesMaterialCost + addOnsMaterialCost + productsCost + timeCostAtTmhr;
    const profit = membership.price - totalCost;
    const margin = membership.price > 0 ? (profit / membership.price) * 100 : 0;
    
    return { 
        costOfPerks: totalCost, 
        netProfit: profit, 
        profitMargin: margin, 
        monthlyTimeLiability: timeLiabilityHours 
    };
  }, [membership, services, inventory, tmhr]);

  return (
    <Card className={cn(
        "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col border-indigo-500/20 bg-white hover:border-indigo-500/50 hover:shadow-2xl hover:shadow-indigo-500/10",
        !membership.isPrivate && "shadow-sm"
    )}>
      <CardHeader className="bg-indigo-500/5 border-b p-6 sm:p-8">
        <div className="flex justify-between items-start">
            <div className='flex items-center gap-4 text-left'>
                <div className="p-3 bg-white rounded-2xl shadow-inner border border-indigo-500/10">
                    <Award className="w-6 h-6 text-indigo-500" />
                </div>
                 <div className="min-w-0">
                    <CardTitle className="text-lg md:text-xl font-black uppercase tracking-tight text-slate-900 leading-none mb-1.5 truncate">{membership.name}</CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-indigo-500/20 text-indigo-600 bg-white">
                            ${membership.price.toFixed(0)}/{membership.interval === 'monthly' ? 'MO' : 'YR'}
                        </Badge>
                        {membership.isPrivate && <Badge className="h-5 px-2 rounded-full font-black text-[8px] uppercase bg-slate-900 text-white border-none">Private</Badge>}
                    </div>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-indigo-500/10 shrink-0 -mt-1 -mr-1"><MoreHorizontal className="h-4 w-4 text-indigo-500" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                    <DropdownMenuItem onClick={() => onViewUsers(membership)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Eye className="mr-2 h-3.5 w-3.5 opacity-40" /> View Members</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(membership)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Edit className="mr-2 h-3.5 w-3.5 opacity-40" /> Refine Tier</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(membership.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5"><Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-6 sm:p-8 flex-1 flex flex-col space-y-6">
        <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-indigo-500/10 transition-all text-left">
                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Active Load</p>
                <p className="text-xl font-black font-mono tracking-tighter text-slate-900">{activeMembers}<span className="text-[10px] ml-0.5 font-bold uppercase opacity-40">Guests</span></p>
            </div>
            <div className="p-4 rounded-2xl bg-indigo-500/[0.03] border-2 border-transparent group-hover:border-indigo-500/10 transition-all text-right">
                <p className="text-[9px] font-black uppercase text-indigo-600/60 tracking-widest mb-1 opacity-60">Capacity Use</p>
                <p className="text-xl font-black font-mono tracking-tighter text-indigo-600">{(monthlyTimeLiability * activeMembers).toFixed(1)}<span className="text-[10px] ml-0.5 font-bold uppercase opacity-40">h/mo</span></p>
            </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="perks" className="border-2 rounded-2xl overflow-hidden bg-muted/5 border-border/50">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                    <ListChecks className="w-3.5 h-3.5 mr-2 opacity-40"/> Included Perks
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2 space-y-2">
                    <div className="space-y-1.5">
                        {(membership.includedServices || []).map(p => (
                            <div key={p.id} className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight text-slate-700 bg-white p-2 rounded-lg border shadow-sm">
                                <span className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500"/> {p.name}</span>
                                <span className="font-black text-slate-900">{p.quantity}x</span>
                            </div>
                        ))}
                        {membership.retailDiscount && (
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight text-slate-700 bg-white p-2 rounded-lg border shadow-sm">
                                <span className="flex items-center gap-2"><Percent className="w-3 h-3 text-blue-500"/> Retail Privilege</span>
                                <span className="font-black text-slate-900">{membership.retailDiscount}% OFF</span>
                            </div>
                        )}
                    </div>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="capacity" className="border-2 rounded-2xl overflow-hidden bg-muted/5 border-border/50 mt-2">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                    <Clock className="w-3.5 h-3.5 mr-2 opacity-40"/> Capacity Load
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                    <div className="space-y-2 p-3 bg-white rounded-xl border border-border/50 shadow-sm text-left">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Time commitment</span>
                            <span className="text-slate-900 font-mono">{monthlyTimeLiability.toFixed(1)}h / member</span>
                        </div>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed">This tier consumes {monthlyTimeLiability.toFixed(1)} hours of studio billable capacity per member per cycle.</p>
                    </div>
                </AccordionContent>
            </AccordionItem>

            <AccordionItem value="profit" className="border-2 rounded-2xl overflow-hidden bg-primary/[0.02] border-primary/5 mt-2">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-primary">
                    <BarChart className="w-3.5 h-3.5 mr-2 opacity-40"/> Dynamic Yield
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                    <div className="space-y-2 p-3 bg-white rounded-xl border border-primary/10 shadow-sm text-left">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Retail Price</span>
                            <span className="text-slate-900 font-mono">${membership.price.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Total Allotment Cost</span>
                            <span className="text-destructive font-mono">-${costOfPerks.toFixed(2)}</span>
                        </div>
                        <Separator className="border-dashed" />
                        <div className="flex justify-between items-center font-black uppercase">
                            <span className="text-[10px] text-primary">Net Cycle Yield</span>
                            <span className={cn("text-sm font-mono tracking-tighter", netProfit > 0 ? 'text-primary' : 'text-destructive')}>
                                ${netProfit.toFixed(2)}
                            </span>
                        </div>
                        <p className="text-[7px] font-bold text-muted-foreground uppercase opacity-40 pt-1">Analysis includes dynamic TMHR: ${tmhr.toFixed(2)}/hr</p>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      
      <div className="p-3 border-t bg-muted/5 mt-auto">
        <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn" onClick={() => onViewUsers(membership)}>
            Examine Active Portfolio <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover:btn:translate-x-1" />
        </Button>
      </div>
    </Card>
  );
};
