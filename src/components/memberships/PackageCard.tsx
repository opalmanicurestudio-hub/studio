
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Repeat, Users, DollarSign, Trash2, Edit, FileCheck2, BarChart, ArrowRight, Eye, MoreHorizontal, ListChecks, Percent, Box, Clock, Scale } from 'lucide-react';
import { type Package, type Service, type Client, Staff, PricingTier } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface PackageCardProps {
  pack: Package;
  services: Service[];
  clients: Client[];
  onEdit: (pack: Package) => void;
  onViewUsers: (pack: Package) => void;
  onDelete: (id: string) => void;
}

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return new Date(val);
    return new Date(val);
};

export const PackageCard: React.FC<PackageCardProps> = ({ pack, services, clients, onEdit, onViewUsers, onDelete }) => {
  const { staff, pricingTiers, inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const tmhr = selectedTenant?.tmhr || 50;
  const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;

  const activePackages = useMemo(() => {
    return clients.filter(c => c.activePackages?.some(p => p.packageId === pack.id)).length;
  }, [clients, pack.id]);
  
  const primaryService = useMemo(() => services.find(s => s.id === pack.serviceId), [pack.serviceId, services]);

  const { materialCost, timeLiabilityHours } = useMemo(() => {
    if (!primaryService) return { materialCost: 0, timeLiabilityHours: 0 };
    
    const calculateServiceMaterialCost = (s: Service) => {
        if (!s.products) return 0;
        return s.products.reduce((acc, p) => {
            const invItem = inventory.find(i => i.id === p.id);
            if (!invItem) return acc;
            
            let costPerBaseUnit = 0;
            if (invItem.costingMethod === 'size' && invItem.size) {
                costPerBaseUnit = (invItem.costPerUnit || 0) / invItem.size;
            } else if (invItem.costingMethod === 'uses' && invItem.estimatedUses) {
                costPerBaseUnit = (invItem.costPerUnit || 0) / invItem.estimatedUses;
            } else {
                costPerBaseUnit = invItem.costPerUnit || 0;
            }
            
            return acc + (costPerBaseUnit * p.quantityUsed);
        }, 0);
    };

    const materials = calculateServiceMaterialCost(primaryService) * pack.sessions;
    const totalTimeMinutes = ((primaryService.duration || 0) + (primaryService.padBefore || 0) + (primaryService.padAfter || 0)) * pack.sessions;
    return { materialCost: materials, timeLiabilityHours: totalTimeMinutes / 60 };
  }, [pack, primaryService, inventory]);

  const individualStaffAnalysis = useMemo(() => {
    if (!primaryService) return [];
    return staff.filter(s => s.active).map(member => {
        const tierConfig = primaryService.serviceTiers?.find(t => t.tierId === member.pricingTierId);
        const tierPrice = tierConfig ? tierConfig.price : primaryService.price;
        const tierDuration = tierConfig ? tierConfig.durationMinutes : primaryService.duration;
        const totalDuration = (tierDuration || 0) + (primaryService.padBefore || 0) + (primaryService.padAfter || 0);
        const timeValue = ((totalDuration * pack.sessions) / 60) * tmhr;
        
        let labor = 0;
        if (member.payStructure === 'commission') labor = tierPrice * (member.commissionRate / 100);
        else if (member.payStructure === 'hourly' && member.hourlyRate) labor = (tierDuration / 60) * member.hourlyRate;
        else if (member.payStructure === 'hourly_plus_commission' && member.hourlyRate) labor = ((tierDuration / 60) * member.hourlyRate) + (tierPrice * (member.commissionRate / 100));

        const burdenedLabor = labor * pack.sessions * (1 + (taxBurden / 100));
        const totalBurden = materialCost + timeValue + burdenedLabor;
        const netProfit = pack.price - totalBurden;
        const margin = pack.price > 0 ? (netProfit / pack.price) * 100 : 0;

        return {
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl,
            payStructure: member.payStructure,
            totalBurden,
            netProfit,
            margin,
            labor: burdenedLabor,
            timeValue
        };
    });
  }, [primaryService, pack, staff, tmhr, taxBurden, materialCost]);

  const yieldRange = useMemo(() => {
      const profits = individualStaffAnalysis.map(t => t.netProfit);
      if (profits.length === 0) return { min: 0, max: 0 };
      return { min: Math.min(...profits), max: Math.max(...profits) };
  }, [individualStaffAnalysis]);

  const isScopeRestricted = pack.applicableProductIds && pack.applicableProductIds.length > 0;

  return (
    <Card className={cn(
        "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col border-teal-500/20 bg-white hover:border-teal-500/50 hover:shadow-2xl hover:shadow-teal-500/10",
        !pack.isPrivate && "shadow-sm"
    )}>
      <CardHeader className="bg-teal-500/5 border-b p-6 sm:p-8">
        <div className="flex justify-between items-start">
            <div className='flex items-center gap-4 text-left'>
                <div className="p-3 bg-white rounded-2xl shadow-inner border border-teal-500/10">
                    <Repeat className="w-6 h-6 text-teal-500" />
                </div>
                 <div className="min-w-0">
                    <CardTitle className="text-lg md:text-xl font-black uppercase tracking-tight text-slate-900 leading-none mb-1.5 truncate">{pack.name}</CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-teal-500/20 text-teal-600 bg-white">
                            ${pack.price.toFixed(0)} FULL VALUE
                        </Badge>
                        {pack.isPrivate && <Badge className="h-5 px-2 rounded-full font-black text-[8px] uppercase bg-slate-900 text-white border-none">Private</Badge>}
                    </div>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-teal-500/10 shrink-0 -mt-1 -mr-1"><MoreHorizontal className="h-4 w-4 text-teal-500" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                    <DropdownMenuItem onClick={() => onViewUsers(pack)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Eye className="mr-2 h-3.5 w-3.5 opacity-40" /> View Holders</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(pack)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Edit className="mr-2 h-3.5 w-3.5 opacity-40" /> Refine Bundle</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(pack.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5"><Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-6 sm:p-8 flex-1 flex flex-col space-y-6">
        <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-teal-500/10 transition-all text-left">
                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Active Load</p>
                <p className="text-xl font-black font-mono tracking-tighter text-slate-900">{activePackages}<span className="text-[10px] ml-0.5 font-bold uppercase opacity-40">Bundles</span></p>
            </div>
            <div className="p-4 rounded-2xl bg-teal-500/[0.03] border-2 border-transparent group-hover:border-teal-500/10 transition-all text-right">
                <p className="text-[9px] font-black uppercase text-teal-600/60 tracking-widest mb-1 opacity-60">Net Yield Range</p>
                <p className="text-xl font-black font-mono tracking-tighter text-teal-600">${yieldRange.min.toFixed(0)} - ${yieldRange.max.toFixed(0)}</p>
            </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="contents" className="border-2 rounded-2xl overflow-hidden bg-muted/5 border-border/50">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                    <ListChecks className="w-3.5 h-3.5 mr-2 opacity-40"/> Bundle Manifest
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2 text-left">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight text-slate-700 bg-white p-3 rounded-xl border shadow-sm">
                            <span className="flex items-center gap-2"><FileCheck2 className="w-3.5 h-3.5 text-teal-500"/> {primaryService?.name || 'N/A'}</span>
                            <span className="font-black text-slate-900">{pack.sessions} SESSIONS</span>
                        </div>
                        {pack.retailDiscount && pack.retailDiscount > 0 && (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight text-slate-700 bg-white p-2 rounded-lg border shadow-sm">
                                    <span className="flex items-center gap-2"><Percent className="w-3 h-3 text-teal-500"/> Retail Privilege</span>
                                    <span className="font-black text-teal-600">{pack.retailDiscount}% OFF</span>
                                </div>
                                {isScopeRestricted && (
                                    <div className="flex items-center gap-1.5 px-2 text-[8px] font-black uppercase text-muted-foreground opacity-60">
                                        <Box className="w-2.5 h-2.5" />
                                        <span>Restricted to {pack.applicableProductIds?.length} SKUs</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <p className="text-[8px] font-black text-center text-muted-foreground uppercase mt-3 opacity-40 tracking-widest">Expires in {pack.expiresInMonths} months</p>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="capacity" className="border-2 rounded-2xl overflow-hidden bg-muted/5 border-border/50 mt-2">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                    <Clock className="w-3.5 h-3.5 mr-2 opacity-40"/> Capacity Load
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2 text-left">
                    <div className="space-y-2 p-3 bg-white rounded-xl border border-border/50 shadow-sm">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Time liability</span>
                            <span className="text-slate-900 font-mono">{timeLiabilityHours.toFixed(1)}h / bundle</span>
                        </div>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed">This bundle consumes {timeLiabilityHours.toFixed(1)} hours of studio billable capacity per member until fully redeemed.</p>
                    </div>
                </AccordionContent>
            </AccordionItem>

            <AccordionItem value="profit" className="border-2 rounded-2xl overflow-hidden bg-primary/[0.02] border-primary/5 mt-2">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-primary">
                    <BarChart className="w-3.5 h-3.5 mr-2 opacity-40"/> Provider Yield Matrix
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
                    {individualStaffAnalysis.map(sa => (
                        <div key={sa.id} className="space-y-2 p-3 bg-white rounded-xl border border-primary/10 shadow-sm text-left">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Avatar className="h-6 w-6 border shadow-inner">
                                        <AvatarImage src={sa.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-[7px]">{(sa.name || 'S')[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase text-slate-900 leading-none mb-0.5">{sa.name.split(' ')[0]}</p>
                                        <p className="text-[7px] font-bold text-muted-foreground uppercase opacity-60 leading-none">{sa.payStructure.replace('_', ' ')}</p>
                                    </div>
                                </div>
                                <Badge className={cn("h-4 text-[7px] font-black border-none", sa.netProfit >= 0 ? "bg-green-500 text-white" : "bg-destructive text-white")}>
                                    {sa.margin.toFixed(0)}% Margin
                                </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[8px] uppercase font-bold text-muted-foreground opacity-60">
                                <span>Materials: ${materialCost.toFixed(2)}</span>
                                <span className="text-right">Time (TMHR): ${sa.timeValue.toFixed(2)}</span>
                                <span className="col-span-2 border-t pt-1 mt-1">Burdened Labor: ${sa.labor.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center font-black uppercase pt-1 border-t border-dashed border-primary/10">
                                <span className="text-[9px] text-primary/60">Net Yield</span>
                                <span className={cn("text-xs font-mono", sa.netProfit > 0 ? 'text-primary' : 'text-destructive')}>
                                    ${sa.netProfit.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    ))}
                    <p className="text-[7px] font-bold text-muted-foreground uppercase opacity-40 text-center">Analysis includes dynamic TMHR: ${tmhr.toFixed(2)}/hr and burdened labor payouts.</p>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      
      <div className="p-3 border-t bg-muted/5 mt-auto">
        <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn" onClick={() => onViewUsers(pack)}>
            Examine Portfolio Load <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover:btn:translate-x-1" />
        </Button>
      </div>
    </Card>
  );
};
