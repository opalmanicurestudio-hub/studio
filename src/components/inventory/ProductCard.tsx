

'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ShieldPlus, AlertTriangle, Ear, Package, Hammer, Pipette, PackageX, Truck, DollarSign, Edit, Rocket, CheckCircle, Printer } from 'lucide-react';
import { type InventoryItem } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { isPast, parseISO } from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import Image from 'next/image';

export const ProductCard = ({ item, onEdit, onToggleExperiment, onEndExperiment, onLogUse, onWriteOff, onLogSale, isSelected, onSelect, isOrdered }: { 
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
        if (hasExpiredBatch) return { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.totalStock <= 0 && (item.partialContainerUses === undefined || item.partialContainerUses <= 0) && (item.partialContainerSize === undefined || item.partialContainerSize <= 0) ) return { label: 'Out of Stock', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-600/30' };
        if (item.reorderPoint && item.totalStock <= item.reorderPoint) return { label: 'Low Stock', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:border-yellow-600/30' };
        return { label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-600/30' };
    }, [item]);

    const detailHref = `/inventory/${item.id}`;

    let partialDisplay;

    if (item.costingMethod === 'size' && typeof item.partialContainerSize === 'number') {
        partialDisplay = (
            <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">In Use</p>
                <p className="font-semibold text-lg">{item.partialContainerSize.toFixed(0)} <span className="text-sm">{item.unit || 'unit'}</span></p>
            </div>
        );
    } else if (item.costingMethod === 'uses' && typeof item.partialContainerUses === 'number') {
         partialDisplay = (
            <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">In Use</p>
                <p className="font-semibold text-lg">{item.partialContainerUses} <span className="text-sm">{item.useUnit || 'uses'}</span></p>
            </div>
        );
    } else {
        partialDisplay = null;
    }
    
    return (
        <Card className={cn(
            "transition-all duration-200 hover:shadow-xl hover:-translate-y-1 flex flex-col",
            item.isExperimentActive && "shadow-lg shadow-purple-500/10 border-purple-500/20",
            isSelected && "border-primary ring-2 ring-primary"
        )}>
            <CardContent className="p-4 flex-1 flex flex-col space-y-4">
                 <div className="flex items-start gap-4">
                    <div className="flex items-center pt-1">
                        <Checkbox
                            id={`select-${item.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            aria-label={`Select ${item.name}`}
                        />
                    </div>
                     <Link href={detailHref} className="w-16 h-16 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                        {item.imageUrl ? (
                            <Image src={item.imageUrl} alt={item.name} width={64} height={64} className='rounded-md object-cover w-full h-full' data-ai-hint="product photo"/>
                        ) : (
                            <Package className="w-8 h-8 text-muted-foreground" />
                        )}
                    </Link>
                    <div className='flex-1 min-w-0'>
                        <Link href={detailHref} className="group">
                            <p className="font-semibold text-base leading-tight group-hover:underline pr-2">{item.name}</p>
                        </Link>
                        <p className="text-sm text-muted-foreground">{item.category}</p>
                        <div className="flex items-center gap-2 mt-2">
                             <Badge variant="outline" className={stockStatus.className}>{stockStatus.label}</Badge>
                            {isOrdered && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <Truck className="h-4 w-4 text-blue-500" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>This item is on order.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </div>
                </div>
                 
                 <div className={cn("grid gap-2 mt-auto", partialDisplay ? "grid-cols-2" : "grid-cols-1")}>
                     <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Full Stock</p>
                        <p className="font-semibold text-lg">{item.totalStock} <span className="text-sm">units</span></p>
                    </div>
                    {partialDisplay}
                 </div>
            </CardContent>
            <CardFooter className="p-2 border-t bg-muted/50">
                <TooltipProvider>
                    <div className="flex justify-around w-full">
                        {(item.type === 'professional' || item.type === 'overhead' || item.type === 'retail') && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => item.type === 'retail' ? onLogSale(item) : onLogUse(item)}>
                                        {item.type === 'retail' ? <DollarSign /> : <Pipette />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{item.type === 'retail' ? 'Log Sale' : 'Log Use'}</p></TooltipContent>
                            </Tooltip>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => onWriteOff(item)}>
                                    <PackageX />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Write-off</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                                    <Edit />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Edit</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => item.isExperimentActive ? onEndExperiment(item) : onToggleExperiment(item)}>
                                    {item.isExperimentActive ? <CheckCircle className="text-green-500" /> : <Rocket className="text-purple-500" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{item.isExperimentActive ? 'End Experiment' : 'Start Experiment'}</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                 <Button asChild variant="ghost" size="icon">
                                    <Link href={`/inventory/labels?product=${item.id}`}>
                                        <Printer />
                                    </Link>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Print Label</p></TooltipContent>
                        </Tooltip>
                    </div>
                </TooltipProvider>
            </CardFooter>
        </Card>
    )
}
