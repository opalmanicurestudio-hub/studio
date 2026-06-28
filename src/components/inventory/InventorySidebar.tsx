'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    DollarSign, 
    Package, 
    Store, 
    Recycle, 
    Hammer, 
    TrendingUp, 
    AlertTriangle, 
    FlaskConical, 
    Pipette, 
    Sparkles, 
    BarChart, 
    Landmark,
    ShieldAlert,
    TrendingDown,
    ArrowRight
} from 'lucide-react';
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
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { Transaction } from '@/lib/financial-data';
import { cn } from '@/lib/utils';

export const InventorySidebar = ({ 
    inventory,
    stockCorrections,
    onLogOverheadUse,
}: { 
    inventory: InventoryItem[];
    stockCorrections: StockCorrection[];
    onLogOverheadUse: (productId: string) => void;
}) => {
    const [isSpoilageDialogOpen, setIsSpoilageDialogOpen] = useState(false);
    const [isLogUseConfirmOpen, setIsLogUseConfirmOpen] = useState(false);
    const [itemToLogUse, setItemToLogUse] = useState<InventoryItem | null>(null);
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;

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

        // FIX: guard inventory itself
        (inventory ?? []).forEach(item => {
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
                
                // FIX: guard item.batches before indexing
                const batches = item.batches ?? [];
                const purchaseDate = batches[0]?.receivedDate ? parseISO(batches[0].receivedDate) : new Date();
                const monthsInService = differenceInMonths(new Date(), purchaseDate);
                
                const accumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
                const bookValue = purchaseCost - accumulatedDepreciation;
                equipVal += bookValue;
            }
            if (item.isExperimentActive) {
                activeExp.push(item);
            }

            // FIX: guard item.batches before iterating
            (item.batches ?? []).forEach(batch => {
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
        // FIX: guard both stockCorrections and inventory
        (stockCorrections ?? [])
            .filter(sc => sc.reason.includes('Service') || sc.reason.includes('Appointment'))
            .forEach(sc => {
                const product = (inventory ?? []).find(p => p.id === sc.productId);
                if (product) {
                    if (!usageCounts[sc.productId]) {
                        usageCounts[sc.productId] = { name: product.name, count: 0 };
                    }
                    usageCounts[sc.productId].count += Math.abs(sc.change);
                }
            });
        return Object.values(usageCounts).sort((a, b) => b.count - a.count).slice(0, 5);
    }, [stockCorrections, inventory]);
    
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

    const handleSpoilageConfirm = (items: SpoilageItem[], notes?: string, imageUrl?: string) => {
        if (!firestore || !tenantId || !inventory) return;

        const batch = writeBatch(firestore);
        let totalLoss = 0;
        
        // FIX: guard items
        (items ?? []).forEach(item => {
            const product = (inventory ?? []).find(p => p.id === item.productId);
            if (product) {
                const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.productId);

                // FIX: guard product.batches
                const updatedBatches = (product.batches ?? []).map(b => {
                    if (b.id === item.batchId) {
                        totalLoss += item.stock * item.costPerUnit;
                        return { ...b, stock: 0 };
                    }
                    return b;
                });
                
                const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);
                const updatePayload: Partial<InventoryItem> = { batches: updatedBatches, totalStock: newTotalStock };
                if (newTotalStock === 0) {
                    updatePayload.partialContainerUses = 0;
                    updatePayload.partialContainerSize = 0;
                }
                batch.update(productRef, updatePayload);
                
                const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
                batch.set(scRef, { productId: item.productId, date: new Date().toISOString(), change: -item.stock, unit: product.unit || 'units', reason: 'Spoilage - Expired' });
            }
        });
        
        if (totalLoss > 0) {
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(txnRef, { date: new Date().toISOString(), description: `Spoilage Write-off: ${(items ?? []).length} batch(es)`, clientOrVendor: 'Internal', type: 'expense', context: 'Business', category: 'Spoilage', amount: totalLoss, paymentMethod: 'Internal', hasReceipt: !!imageUrl, receiptUrl: imageUrl, notes });
        }

        batch.commit().then(() => {
            toast({ title: "Spoilage Written Off", description: `${(items ?? []).length} item(s) written off with a total loss of $${totalLoss.toFixed(2)}.` });
        });
        setIsSpoilageDialogOpen(false);
    };

    return (
    <div className="space-y-8 lg:sticky top-24">
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-6 opacity-5 transition-opacity group-hover:opacity-10">
                <Sparkles className="w-24 h-24 text-primary" />
            </div>
            <CardHeader className="p-8 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <ShieldAlert className="w-3 h-3" />
                    Capital Value
                </CardTitle>
            </CardHeader>
            <CardContent className="p-8 pt-0">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Total Assets</p>
                <p className="text-5xl font-black text-primary tracking-tighter font-mono leading-none">${totalValue.toFixed(2)}</p>
                
                <div className="mt-8 space-y-3">
                    {[
                        { label: 'Professional', value: professionalValue, icon: Package },
                        { label: 'Retail', value: retailValue, icon: Store },
                        { label: 'Overhead', value: overheadValue, icon: Recycle },
                        { label: 'Equipment', value: equipmentValue, icon: Hammer },
                    ].map(item => (
                        <div key={item.label} className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                            <span className="flex items-center gap-2">
                                <item.icon className="w-3 h-3" />
                                {item.label}
                            </span>
                            <span className="font-mono text-xs text-slate-900">${item.value.toFixed(0)}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>

        <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="bg-muted/5 border-b p-6">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="w-3 h-3" /> Consumption Matrix
                </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6 text-left">
                <div className="space-y-4">
                    <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">High Rotation Items</p>
                    {topUsedProducts.length > 0 ? (
                        <div className="grid gap-2">
                            {topUsedProducts.map(p => (
                                <div key={p.name} className="flex justify-between items-center p-2.5 rounded-xl bg-muted/20 border-2 border-transparent transition-all hover:border-primary/10">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-700 truncate pr-2">{p.name}</span>
                                    <Badge variant="secondary" className="h-5 px-1.5 font-mono font-black text-[9px] border-none bg-primary/10 text-primary">{p.count}</Badge>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground uppercase font-bold text-center py-4 border-2 border-dashed rounded-xl opacity-40">No usage data</p>
                    )}
                </div>
                
                <Separator className="border-dashed" />

                <div className="space-y-4">
                    <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Overhead Velocity</p>
                    {overheadItemsInStock.length > 0 ? (
                        <div className="grid gap-2">
                            {overheadItemsInStock.slice(0, 3).map(item => (
                                <div key={item.id} className="flex justify-between items-center p-2.5 rounded-xl bg-muted/20 border-2 border-transparent transition-all hover:border-primary/10">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-700 truncate pr-2">{item.name}</span>
                                    <Button variant="ghost" size="xs" onClick={() => handleLogUseClick(item)} className="h-6 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                                        <Pipette className="mr-1 h-2.5 w-2.5"/> Log Unit
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground uppercase font-bold text-center py-4 border-2 border-dashed rounded-xl opacity-40">All overhead consumed</p>
                    )}
                </div>
            </CardContent>
        </Card>

        <Card className={cn(
            "border-2 shadow-sm rounded-[2rem] overflow-hidden transition-all",
            expiredItemsCount > 0 ? "border-destructive/20 bg-destructive/[0.02]" : "bg-white"
        )}>
            <CardHeader className="bg-muted/5 border-b p-6">
                <CardTitle className={cn(
                    "text-[10px] font-black uppercase tracking-widest flex items-center gap-2",
                    expiredItemsCount > 0 ? "text-destructive" : "text-muted-foreground"
                )}>
                    <AlertTriangle className="w-3 h-3" /> Spoilage & Risk
                </CardTitle>
            </CardHeader>
            <CardContent className="p-6 text-center space-y-4">
                <div className="space-y-1">
                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest opacity-60">Potential Loss</p>
                    <p className={cn("text-3xl font-black font-mono tracking-tighter", expiredItemsCount > 0 ? "text-destructive" : "text-slate-900")}>
                        ${expiredValue.toFixed(2)}
                    </p>
                </div>
                {expiredItemsCount > 0 && (
                    <Badge variant="destructive" className="animate-pulse h-5 font-black text-[8px] uppercase tracking-widest">
                        {expiredItemsCount} BATCHES VOID
                    </Badge>
                )}
            </CardContent>
            <CardFooter className="p-4 pt-0">
                <Button 
                    variant="ghost" 
                    className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[9px] text-destructive hover:bg-destructive/5" 
                    onClick={() => setIsSpoilageDialogOpen(true)}
                >
                    Reconcile Spoilage <ArrowRight className="ml-2 h-3 w-3" />
                </Button>
            </CardFooter>
        </Card>

        <ManageSpoilageDialog open={isSpoilageDialogOpen} onOpenChange={setIsSpoilageDialogOpen} inventory={inventory} onConfirm={handleSpoilageConfirm} />

        <AlertDialog open={isLogUseConfirmOpen} onOpenChange={setIsLogUseConfirmOpen}>
            <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                <AlertDialogHeader className="p-6 pb-0">
                    <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Log Consumption</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                        Recording usage for: <strong>{itemToLogUse?.name}</strong>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="p-6 text-sm font-medium text-slate-600 leading-relaxed uppercase tracking-tight">
                    Confirming the use of 1 unit. This will automatically deduct stock and record the associated cost in the studio ledger.
                </div>
                <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                    <Button onClick={handleConfirmLogUse} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Confirm Log</Button>
                    <AlertDialogCancel onClick={() => setIsLogUseConfirmOpen(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Abort</AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
    )
}
