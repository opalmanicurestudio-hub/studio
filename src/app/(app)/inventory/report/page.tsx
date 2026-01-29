
'use client';

import React, { useMemo, useRef } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowLeft, Printer, BarChart, DollarSign, Package, Store, Hammer, Recycle, TrendingUp, AlertTriangle, Download } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format, isPast, parseISO, differenceInMonths } from 'date-fns';
import { cn } from '@/lib/utils';
import { type InventoryItem } from '@/lib/data';

// Component for the report page
const InventoryReportPage = () => {
    const { inventory, stockCorrections } = useInventory();
    const reportRef = useRef<HTMLDivElement>(null);

    const handlePrint = () => {
        window.print();
    };

    const handleExport = () => {
        const headers = ['Product Name', 'Category', 'Type', 'Current Stock', 'Cost/Unit', 'Stock Value'];
        
        const data = inventory.map(item => [
            `"${item.name.replace(/"/g, '""')}"`, // Handle quotes in name
            item.category,
            item.type,
            item.totalStock.toString(),
            (item.costPerUnit || 0).toFixed(2),
            ((item.totalStock || 0) * (item.costPerUnit || 0)).toFixed(2)
        ]);

        const csvContent = [
            headers.join(','),
            ...data.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.href) {
            URL.revokeObjectURL(link.href);
        }
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', `inventory-stock-details_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const stats = useMemo(() => {
        let professionalValue = 0;
        let retailValue = 0;
        let overheadValue = 0;
        let equipmentValue = 0;

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
            
            switch (item.type) {
                case 'professional': professionalValue += itemTotalValue; break;
                case 'retail': retailValue += itemTotalValue; break;
                case 'overhead': overheadValue += itemTotalValue; break;
                case 'equipment': {
                    const purchaseCost = item.costPerUnit || 0;
                    const lifespanMonths = (item.lifespanYears || 5) * 12;
                    const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
                    
                    const purchaseDate = item.batches[0]?.receivedDate ? parseISO(item.batches[0].receivedDate) : new Date();
                    const monthsInService = differenceInMonths(new Date(), purchaseDate);
                    
                    const accumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
                    const bookValue = purchaseCost - accumulatedDepreciation;
                    equipmentValue += bookValue;
                    break;
                }
            }
        });
        const totalValue = professionalValue + retailValue + equipmentValue + overheadValue;
        return { professionalValue, retailValue, equipmentValue, overheadValue, totalValue, totalSKUs: inventory.length };
    }, [inventory]);

    const lowStockItems = useMemo(() => {
        return inventory.filter(item => item.reorderPoint && item.totalStock <= item.reorderPoint);
    }, [inventory]);

    const expiredItems = useMemo(() => {
        return inventory.flatMap(item =>
            item.batches
                .filter(batch => batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0)
                .map(batch => ({ ...item, expiredBatch: batch }))
        );
    }, [inventory]);

    const retailPerformance = useMemo(() => {
        return inventory.filter(item => item.type === 'retail').map(item => {
            const landedCost = item.costPerUnit || 0;
            const retailPrice = landedCost * 1.75; // 75% markup
            const profitPerUnit = retailPrice - landedCost;
            const profitMargin = retailPrice > 0 ? (profitPerUnit / retailPrice) * 100 : 0;
            return {
                ...item,
                retailPrice,
                profitMargin
            };
        });
    }, [inventory]);

    const professionalUsage = useMemo(() => {
        const usage = new Map<string, { item: InventoryItem, count: number }>();
        stockCorrections.forEach(sc => {
            if (sc.reason.startsWith('Appointment')) {
                const item = inventory.find(i => i.id === sc.productId);
                if (item) {
                    const current = usage.get(item.id) || { item, count: 0 };
                    current.count += Math.abs(sc.change);
                    usage.set(item.id, current);
                }
            }
        });
        return Array.from(usage.values()).sort((a, b) => b.count - a.count).slice(0, 10);
    }, [inventory, stockCorrections]);


    return (
        <div className="flex min-h-screen w-full flex-col bg-muted/40 print:bg-white">
            <AppHeader title="Inventory Report" />
            <main className="flex-1 p-4 md:p-8 space-y-6 print:p-4">
                <div className="flex items-center justify-between print:hidden">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/inventory">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Inventory
                        </Link>
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleExport}>
                            <Download className="h-4 w-4 mr-2" />
                            Export CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={handlePrint}>
                            <Printer className="h-4 w-4 mr-2" />
                            Print Report
                        </Button>
                    </div>
                </div>

                <div className="max-w-5xl mx-auto space-y-8" id="print-area" ref={reportRef}>
                    <header className="space-y-2">
                        <h1 className="text-3xl font-bold">Inventory Report</h1>
                        <p className="text-muted-foreground">Generated on {format(new Date(), 'MMMM d, yyyy')}</p>
                    </header>

                    {/* KPIs */}
                    <Card className="print:shadow-none print:border-gray-300">
                        <CardHeader><CardTitle>Inventory Snapshot</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="p-3 bg-primary/10 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm font-medium text-primary print:text-black">Total Value</div>
                                <div className="text-2xl font-bold text-primary print:text-black">${stats.totalValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-black"><Package className="w-4 h-4"/>Professional</div>
                                <div className="text-lg font-bold">${stats.professionalValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-black"><Store className="w-4 h-4"/>Retail</div>
                                <div className="text-lg font-bold">${stats.retailValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-black"><Hammer className="w-4 h-4"/>Equipment</div>
                                <div className="text-lg font-bold">${stats.equipmentValue.toFixed(2)}</div>
                            </div>
                             <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground print:text-black">Total SKUs</div>
                                <div className="text-lg font-bold">{stats.totalSKUs}</div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Alerts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="print:shadow-none print:border-gray-300">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Low Stock Alerts</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {lowStockItems.length > 0 ? (
                                    <Table>
                                        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Stock / Reorder Pt.</TableHead></TableRow></TableHeader>
                                        <TableBody>{lowStockItems.map(item => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="text-right font-mono">{item.totalStock} / {item.reorderPoint}</TableCell></TableRow>)}</TableBody>
                                    </Table>
                                ) : <p className="text-sm text-muted-foreground text-center py-4">No items are low on stock.</p>}
                            </CardContent>
                        </Card>
                         <Card className="print:shadow-none print:border-gray-300">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Expired Stock</CardTitle>
                            </CardHeader>
                            <CardContent>
                               {expiredItems.length > 0 ? (
                                    <Table>
                                        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Expired Date</TableHead><TableHead className="text-right">Stock</TableHead></TableRow></TableHeader>
                                        <TableBody>{expiredItems.map(item => <TableRow key={item.expiredBatch.id}><TableCell>{item.name}</TableCell><TableCell>{format(parseISO(item.expiredBatch.expirationDate!), 'MMM d, yyyy')}</TableCell><TableCell className="text-right font-mono">{item.expiredBatch.stock}</TableCell></TableRow>)}</TableBody>
                                    </Table>
                               ) : <p className="text-sm text-muted-foreground text-center py-4">No expired items in stock.</p>}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Stock Details */}
                    <Card className="print:shadow-none print:border-gray-300">
                        <CardHeader><CardTitle>Full Inventory Stock Details</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Current Stock</TableHead>
                                        <TableHead className="text-right">Cost/Unit</TableHead>
                                        <TableHead className="text-right">Stock Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {inventory.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.name}</TableCell>
                                            <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                                            <TableCell className="text-right font-mono">{item.totalStock}</TableCell>
                                            <TableCell className="text-right font-mono">${(item.costPerUnit || 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono">${((item.totalStock || 0) * (item.costPerUnit || 0)).toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    
                    {/* Retail Performance */}
                    <Card className="print:shadow-none print:border-gray-300">
                        <CardHeader><CardTitle>Retail Performance</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Profit Margin</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {retailPerformance.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.name}</TableCell>
                                            <TableCell className="text-right font-mono">${item.retailPrice.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono">{item.profitMargin.toFixed(1)}%</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    
                     {/* Professional Usage */}
                    <Card className="print:shadow-none print:border-gray-300">
                        <CardHeader><CardTitle>Professional Product Usage</CardTitle><CardDescription>Top 10 most used products in completed services.</CardDescription></CardHeader>
                        <CardContent>
                             <Table>
                                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Total Units Used</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {professionalUsage.map(({ item, count }) => (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.name}</TableCell>
                                            <TableCell className="text-right font-mono">{count} {item.costingMethod === 'uses' ? item.useUnit : item.unit}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                </div>
            </main>
             <style jsx global>{`
                @media print {
                  body * {
                    visibility: hidden;
                  }
                  #print-area, #print-area * {
                    visibility: visible;
                  }
                  #print-area {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                  }
                }
            `}</style>
        </div>
    );
}

export default InventoryReportPage;
