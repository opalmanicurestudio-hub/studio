
'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, Package, Store, Recycle, Hammer, TrendingUp, AlertTriangle, FlaskConical, Pipette } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ManageSpoilageDialog, SpoilageItem } from './ManageSpoilageDialog';
import { type InventoryItem, type Batch, type StockCorrection } from '@/lib/data';
import { isPast, parseISO, differenceInMonths } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';


export const InventorySidebar = ({ 
    inventory,
    stockCorrections,
    onSpoilageConfirm,
    onLogOverheadUse,
}: { 
    inventory: InventoryItem[];
    stockCorrections: StockCorrection[];
    onSpoilageConfirm: (items: SpoilageItem[]) => void; 
    onLogOverheadUse: (productId: string) => void;
}) => {
    const [isSpoilageDialogOpen, setIsSpoilageDialogOpen] = useState(false);
    const [isLogUseConfirmOpen, setIsLogUseConfirmOpen] = useState(false);
    const [itemToLogUse, setItemToLogUse] = useState<InventoryItem | null>(null);

    const {
        professionalValue,
        retailValue,
        overheadValue,
        equipmentValue,
        totalValue,
        expiredValue,
        expiredItemsCount,
        activeExperiments,
        overheadItemsInStock,
    } = useMemo(() => {
        let profVal = 0;
        let retVal = 0;
        let overVal = 0;
        let equipVal = 0;
        let expVal = 0;
        let expCount = 0;
        const activeExp: InventoryItem[] = [];
        const overheadInStock: InventoryItem[] = [];

        inventory.forEach(item => {
            let itemTotalValue = (item.totalStock || 0) * (item.costPerUnit || 0);
            
            const costPerUnit = item.costPerUnit || 0;
            if (costPerUnit > 0) {
                if (item.costingMethod === 'size' && item.size && item.size > 0 && item.partialContainerSize) {
                    const costPerBaseUnit = costPerUnit / item.size;
                    itemTotalValue += item.partialContainerSize * costPerBaseUnit;
                } else if (item.costingMethod === 'uses' && item.estimatedUses && item.estimatedUses > 0 && item.partialContainerUses) {
                    const costPerBaseUnit = costPerUnit / item.estimatedUses;
                    itemTotalValue += item.partialContainerUses * costPerBaseUnit;
                }
            }

            if (item.type === 'professional') profVal += itemTotalValue;
            if (item.type === 'retail') retVal += itemTotalValue;
            if (item.type === 'overhead') {
              overVal += itemTotalValue;
              if (item.totalStock > 0 || (item.partialContainerSize || 0) > 0 || (item.partialContainerUses || 0) > 0) {
                overheadInStock.push(item);
              }
            }
            if (item.type === 'equipment') {
                const purchaseCost = item.costPerUnit || 0;
                const lifespanMonths = (item.lifespanYears || 5) * 12;
                const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
                
                const purchaseDate = item.batches[0]?.receivedDate ? parseISO(item.batches[0].receivedDate) : new Date();
                const monthsInService = differenceInMonths(new Date(), purchaseDate);
                
                const accumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
                const bookValue = purchaseCost - accumulatedDepreciation;
                equipVal += bookValue;
            }
            if (item.isExperimentActive) {
                activeExp.push(item);
            }

            item.batches.forEach(batch => {
                if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
                    expVal += batch.stock * batch.costPerUnit;
                    expCount += batch.stock;
                }
            });
        });

        const totalValue = profVal + retVal + overVal + equipVal;

        return {
            professionalValue: profVal,
            retailValue: retVal,
            overheadValue: overVal,
            equipmentValue: equipVal,
            totalValue: totalValue,
            expiredValue: expVal,
            expiredItemsCount: expCount,
            activeExperiments: activeExp,
            overheadItemsInStock: overheadInStock,
        };
    }, [inventory]);

    const topUsedProducts = useMemo(() => {
        const usageCounts: { [key: string]: { name: string; count: number } } = {};
        stockCorrections
            .filter(sc => sc.reason.startsWith('Appointment'))
            .forEach(sc => {
                const product = inventory.find(p => p.id === sc.productId);
                if (product) {
                    if (!usageCounts[sc.productId]) {
                        usageCounts[sc.productId] = { name: product.name, count: 0 };
                    }
                    usageCounts[sc.productId].count += Math.abs(sc.change);
                }
            });
        return Object.values(usageCounts).sort((a, b) => b.count - a.count).slice(0, 5);
    }, [stockCorrections, inventory]);

    const handleConfirmAndClose = (items: SpoilageItem[]) => {
        onSpoilageConfirm(items);
        setIsSpoilageDialogOpen(false);
    };

    const handleLogUseClick = (item: InventoryItem) => {
        setItemToLogUse(item);
        setIsLogUseConfirmOpen(true);
    };

    const handleConfirmLogUse = () => {
        if (itemToLogUse) {
            onLogOverheadUse(itemToLogUse.id);
        }
        setIsLogUseConfirmOpen(false);
        setItemToLogUse(null);
    };

    return (
    <div className="lg:sticky top-24 space-y-6">
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><DollarSign className="text-primary"/> Inventory Value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                 <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2"><Package className="w-4 h-4"/> Professional</span>
                    <span className="font-semibold font-mono">${professionalValue.toFixed(2)}</span>
                </div>
                 <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2"><Store className="w-4 h-4"/> Retail</span>
                    <span className="font-semibold font-mono">${retailValue.toFixed(2)}</span>
                </div>
                 <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2"><Recycle className="w-4 h-4"/> Overhead</span>
                    <span className="font-semibold font-mono">${overheadValue.toFixed(2)}</span>
                </div>
                 <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2"><Hammer className="w-4 h-4"/> Equipment</span>
                    <span className="font-semibold font-mono">${equipmentValue.toFixed(2)}</span>
                </div>
            </CardContent>
            <CardFooter className="p-4 bg-muted/50 flex justify-between items-baseline">
                 <span className="font-semibold">Total Value</span>
                 <span className="font-bold text-lg text-primary">${totalValue.toFixed(2)}</span>
            </CardFooter>
        </Card>
         <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><TrendingUp className="text-primary"/> Usage & Consumption</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <div>
                    <h4 className="font-semibold text-xs text-muted-foreground mb-2">Top 5 Products Used in Services</h4>
                    <div className="space-y-2">
                        {topUsedProducts.length > 0 ? topUsedProducts.map(p => (
                            <div key={p.name} className="flex justify-between items-center text-xs">
                                <span className="truncate pr-2">{p.name}</span>
                                <Badge variant="secondary">{p.count} uses</Badge>
                            </div>
                        )) : <p className="text-xs text-muted-foreground text-center py-2">No service usage yet.</p>}
                    </div>
                </div>
                <Separator />
                <div>
                    <h4 className="font-semibold text-xs text-muted-foreground mb-2">Overhead Consumables</h4>
                    <div className="space-y-2">
                         {overheadItemsInStock.length > 0 ? overheadItemsInStock.map(item => (
                             <div key={item.id} className="flex justify-between items-center text-xs">
                                <span className="truncate pr-2">{item.name}</span>
                                <Button variant="outline" size="xs" onClick={() => handleLogUseClick(item)}>
                                    <Pipette className="mr-1.5 h-3 w-3"/> Log 1 Unit Used
                                </Button>
                            </div>
                         )) : <p className="text-xs text-muted-foreground text-center py-2">No overhead items in stock.</p>}
                    </div>
                </div>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/> Spoilage & Risk</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex justify-between items-center">
                    <div>
                        <p className="font-bold">{expiredItemsCount} items expired</p>
                        <p className="text-xs">Potential loss calculated</p>
                    </div>
                    <div className="text-right">
                        <p className="text-2xl font-bold">${expiredValue.toFixed(2)}</p>
                    </div>
                </div>
            </CardContent>
             <CardFooter>
                 <Button variant="destructive" className="w-full" onClick={() => setIsSpoilageDialogOpen(true)}><Recycle className="mr-2"/> Manage Spoilage</Button>
             </CardFooter>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="text-primary"/> Active Experiments</CardTitle>
            </CardHeader>
            <CardContent>
                 {activeExperiments.length > 0 ? (
                    <div className="space-y-2">
                        {activeExperiments.map(item => (
                            <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                                <span className="text-sm font-medium">{item.name}</span>
                                <Badge variant="outline" className="border-purple-500/30 text-purple-700 dark:text-purple-300">
                                    {item.type === 'equipment' ? 'Lifespan Test' : 'Cost-Per-Use'}
                                </Badge>
                            </div>
                        ))}
                    </div>
                 ) : (
                    <p className="text-sm text-center text-muted-foreground py-4">No active experiments.</p>
                 )}
            </CardContent>
        </Card>

        <ManageSpoilageDialog open={isSpoilageDialogOpen} onOpenChange={setIsSpoilageDialogOpen} inventory={inventory} onConfirm={handleConfirmAndClose} />

        <AlertDialog open={isLogUseConfirmOpen} onOpenChange={setIsLogUseConfirmOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Usage</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to log the use of 1 unit of &quot;{itemToLogUse?.name}&quot;? This will be recorded as an expense.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmLogUse}>
                        Log Use
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
    )

    