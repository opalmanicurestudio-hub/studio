'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Repeat, Users, DollarSign, Trash2, Edit, FileCheck2, BarChart, ArrowRight, Eye, MoreHorizontal, ListChecks } from 'lucide-react';
import { type Package, type Service, type Client } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';

interface PackageCardProps {
  pack: Package;
  services: Service[];
  clients: Client[];
  onEdit: (pack: Package) => void;
  onViewUsers: (pack: Package) => void;
  onDelete: (id: string) => void;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pack, services, clients, onEdit, onViewUsers, onDelete }) => {
  const activePackages = useMemo(() => {
    return clients.filter(c => c.activePackages?.some(p => p.packageId === pack.id)).length;
  }, [clients, pack.id]);
  
  const totalRevenue = activePackages * pack.price;
  const primaryService = useMemo(() => services.find(s => s.id === pack.serviceId), [pack.serviceId, services]);

  const { netProfit, profitMargin } = useMemo(() => {
    if (!primaryService) return { netProfit: 0, profitMargin: 0 };
    const totalCost = (primaryService.cost || 0) * pack.sessions;
    const profit = pack.price - totalCost;
    const margin = pack.price > 0 ? (profit / pack.price) * 100 : 0;
    return { netProfit: profit, profitMargin: margin };
  }, [pack, primaryService]);

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
                <p className="text-[9px] font-black uppercase text-teal-600/60 tracking-widest mb-1 opacity-60">Total LTV</p>
                <p className="text-xl font-black font-mono tracking-tighter text-teal-600">${totalRevenue.toFixed(0)}</p>
            </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="contents" className="border-2 rounded-2xl overflow-hidden bg-muted/5 border-border/50">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                    <ListChecks className="w-3.5 h-3.5 mr-2 opacity-40"/> Bundle Manifest
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight text-slate-700 bg-white p-3 rounded-xl border shadow-sm">
                        <span className="flex items-center gap-2"><FileCheck2 className="w-3.5 h-3.5 text-teal-500"/> {primaryService?.name || 'N/A'}</span>
                        <span className="font-black text-slate-900">{pack.sessions} SESSIONS</span>
                    </div>
                    <p className="text-[8px] font-black text-center text-muted-foreground uppercase mt-3 opacity-40 tracking-widest">Expires in {pack.expiresInMonths} months</p>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="profit" className="border-2 rounded-2xl overflow-hidden bg-primary/[0.02] border-primary/5 mt-2">
                <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-primary">
                    <BarChart className="w-3.5 h-3.5 mr-2 opacity-40"/> Yield Analysis
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                    <div className="space-y-2 p-3 bg-white rounded-xl border border-primary/10 shadow-sm">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Retail Bundle</span>
                            <span className="text-slate-900 font-mono">${pack.price.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground opacity-60">Service Liability</span>
                            <span className="text-destructive font-mono">-${((primaryService?.cost || 0) * pack.sessions).toFixed(2)}</span>
                        </div>
                        <Separator className="border-dashed" />
                        <div className="flex justify-between items-center font-black uppercase">
                            <span className="text-[10px] text-primary">Net Bundle Yield</span>
                            <span className={cn("text-sm font-mono tracking-tighter", netProfit > 0 ? 'text-primary' : 'text-destructive')}>
                                ${netProfit.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      
      <div className="p-3 border-t bg-muted/5 mt-auto">
        <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary group/btn" onClick={() => onViewUsers(pack)}>
            Examine Portfolio Load <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
        </Button>
      </div>
    </Card>
  );
};

const DropdownMenu = ({ children }: any) => <div>{children}</div>;
import { DropdownMenu as DM, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
