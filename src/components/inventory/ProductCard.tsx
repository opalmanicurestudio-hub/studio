'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { 
  Package, 
  Hammer, 
  Pipette, 
  PackageX, 
  Truck, 
  DollarSign, 
  Edit, 
  Rocket, 
  CheckCircle, 
  Printer, 
  Tag, 
  ArrowRight,
  FlaskConical,
  ShoppingCart,
  FileText
} from 'lucide-react';
import { type InventoryItem } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { isPast, parseISO } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import Image from 'next/image';

export const ProductCard = ({ 
    item, 
    onEdit, 
    onToggleExperiment, 
    onEndExperiment, 
    onLogUse, 
    onWriteOff, 
    onLogSale, 
    isSelected, 
    onSelect, 
    isOrdered 
}: { 
    item: InventoryItem, 
    onEdit: (item: InventoryItem) => void, 
    onToggleExperiment: (item: InventoryItem) => void, 
    onEndExperiment: (item: InventoryItem) => void, 
    onLogUse: (item: InventoryItem) => void,
    onWriteOff: (item: InventoryItem) => void,
    onLogSale: (item: InventoryItem) => void,
    isSelected: boolean, 
    onSelect: () => void, 
    isOrdered: boolean 
}) => {
    
    const stockStatus = useMemo(() => {
        const hasExpiredBatch = item.batches.some(b => b.expirationDate && isPast(parseISO(b.expirationDate)) && b.stock > 0);
        if (hasExpiredBatch) return { label: 'EXPIRED', className: 'bg-destructive text-white border-none animate-pulse' };
        if (item.totalStock <= 0 && (item.partialContainerUses === undefined || item.partialContainerUses <= 0) && (item.partialContainerSize === undefined || item.partialContainerSize <= 0) ) return { label: 'OUT OF STOCK', className: 'bg-slate-900 text-white border-none' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'LOW STOCK', className: 'bg-amber-500 text-white border-none' };
        return { label: 'IN STOCK', className: 'bg-primary/10 text-primary border-primary/20' };
    }, [item]);

    const detailHref = `/inventory/${item.id}`;

    let partialDisplay;

    if (item.costingMethod === 'size' && typeof item.partialContainerSize === 'number') {
        partialDisplay = (
            <div className="text-center p-4 rounded-2xl bg-primary/[0.03] border-2 border-primary/10">
                <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1">In Use</p>
                <p className="font-black text-xl font-mono tracking-tighter text-primary">{item.partialContainerSize.toFixed(0)}<span className="text-[10px] ml-0.5">{item.unit || 'ml'}</span></p>
            </div>
        );
    } else if (item.costingMethod === 'uses' && typeof item.partialContainerUses === 'number') {
         partialDisplay = (
            <div className="text-center p-4 rounded-2xl bg-primary/[0.03] border-2 border-primary/10">
                <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1">In Use</p>
                <p className="font-black text-xl font-mono tracking-tighter text-primary">{item.partialContainerUses}<span className="text-[10px] ml-0.5">{item.useUnit || 'uses'}</span></p>
            </div>
        );
    } else {
        partialDisplay = null;
    }
    
    return (
        <Card className={cn(
            "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col",
            isSelected ? "border-primary ring-4 ring-primary/10 shadow-2xl translate-y-[-4px]" : "border-border/50 bg-white hover:border-primary/20 shadow-sm",
            item.isExperimentActive && "border-purple-500/30 bg-purple-500/[0.01]"
        )}>
            <CardContent className="p-6 md:p-8 space-y-6 flex-1 flex flex-col" onClick={onSelect}>
                <div className="flex items-start justify-between gap-4 cursor-pointer">
                    <div className="flex items-center gap-4 min-w-0">
                        <Checkbox
                            id={`select-${item.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            className="h-6 w-6 rounded-lg border-2 shadow-inner"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <Link href={detailHref} className="relative shrink-0" onClick={e => e.stopPropagation()}>
                            <div className="w-16 h-16 md:w-20 md:h-20 border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2rem] overflow-hidden bg-muted/20 flex items-center justify-center transition-transform group-hover:scale-105 duration-500">
                                {item.imageUrl ? (
                                    <Image src={item.imageUrl} alt={item.name} fill className='object-cover' />
                                ) : (
                                    <Package className="w-8 h-8 md:w-10 md:h-10 text-muted-foreground/30" />
                                )}
                            </div>
                            {item.isExperimentActive && (
                                <div className="absolute -top-2 -right-2 bg-purple-600 text-white p-1 rounded-lg shadow-lg border-2 border-background">
                                    <FlaskConical className="w-3.5 h-3.5" />
                                </div>
                            )}
                        </Link>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <p className="font-black uppercase tracking-tight text-base md:text-lg text-slate-900 truncate leading-none">{item.name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 tracking-widest">{item.category}</p>
                                <Badge variant="outline" className={cn("h-4 px-1.5 font-black text-[8px] uppercase border-2", stockStatus.className)}>
                                    {stockStatus.label}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-3">
                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">
                                    <Tag className="w-3 h-3" />
                                    {item.sku || item.id.slice(-6).toUpperCase()}
                                </div>
                                {isOrdered && (
                                    <Badge className="bg-blue-500 text-white border-none text-[7px] h-4 font-black uppercase tracking-widest">
                                        <Truck className="w-2.5 h-2.5 mr-1" /> ON ORDER
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={cn("grid gap-4 mt-auto", partialDisplay ? "grid-cols-2" : "grid-cols-1")}>
                    <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all">
                        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Full Stock</p>
                        <p className="text-xl font-black font-mono tracking-tighter text-slate-900">{item.totalStock}<span className="text-[10px] ml-0.5 font-bold uppercase opacity-40">UNT</span></p>
                    </div>
                    {partialDisplay}
                </div>
            </CardContent>
            
            <div className="p-3 border-t bg-muted/5 flex items-center justify-between gap-4">
                <div className="flex gap-2">
                    <TooltipProvider>
                        {(item.type === 'professional' || item.type === 'overhead') && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-primary/5 hover:border-primary/30 text-primary transition-all active:scale-90"
                                        onClick={(e) => { e.stopPropagation(); onLogUse(item); }}
                                    >
                                        <Pipette className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Log Quick Use</TooltipContent>
                            </Tooltip>
                        )}
                        {item.type === 'retail' && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-green-50 hover:border-green-500/30 text-green-600 transition-all active:scale-90"
                                        onClick={(e) => { e.stopPropagation(); onLogSale(item); }}
                                    >
                                        <DollarSign className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Log Manual Sale</TooltipContent>
                            </Tooltip>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-destructive/5 hover:border-destructive/30 text-destructive transition-all active:scale-90"
                                    onClick={(e) => { e.stopPropagation(); onWriteOff(item); }}
                                >
                                    <PackageX className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Write-off Loss</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-purple-50 hover:border-purple-500/30 text-purple-600 transition-all active:scale-90"
                                    onClick={(e) => { e.stopPropagation(); item.isExperimentActive ? onEndExperiment(item) : onToggleExperiment(item); }}
                                >
                                    {item.isExperimentActive ? <CheckCircle className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">
                                {item.isExperimentActive ? 'Finalize Test' : 'Trigger Yield Test'}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" asChild className="h-10 w-10 sm:w-auto sm:flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn px-0 sm:px-4">
                                <Link href={detailHref} onClick={e => e.stopPropagation()}>
                                    <span className="hidden sm:inline mr-2">Dossier</span>
                                    <ArrowRight className="h-4 w-4 transition-transform group-hover:btn:translate-x-1" />
                                </Link>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent className="sm:hidden font-black uppercase text-[10px] tracking-widest border-2">
                            Open Dossier
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </Card>
    )
}
