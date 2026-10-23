
'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
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

// What reaches paper, in the app's print look (lib/print-style): Plus Jakarta Sans, a light title, sentence-case grey
// labels, soft stat panels, thin #ececee lines, tabular figures. Scoped to #print-area and to print only, so the screen
// is untouched; the id selectors outrank the global print rules that keep app screens uppercase and heavy on paper.
const PAPER_CSS = `
@media print {
  @page { margin: 0.55in; }
  #print-area { font-family: 'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #16171a; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-area > * + * { margin-top: 20px !important; }
  #print-area * { color: inherit !important; background-color: transparent !important; border-color: #ececee !important; box-shadow: none !important; text-shadow: none !important; text-transform: none !important; letter-spacing: normal !important; opacity: 1 !important; font-variant-numeric: tabular-nums; }
  #print-area svg, #print-area button { display: none !important; }
  #print-area .font-mono { font-family: inherit !important; font-weight: 400 !important; }
  #print-area .font-bold, #print-area .font-semibold, #print-area .font-medium { font-weight: 500 !important; }
  #print-area .text-muted-foreground { color: #6d7075 !important; }

  #print-area > header { padding-bottom: 14px; border-bottom: 1px solid #ececee; }
  #print-area > header h1[class] { margin: 0; font-size: 26px !important; font-weight: 300 !important; letter-spacing: -0.02em !important; line-height: 1.15; }
  #print-area > header p { margin-top: 4px !important; color: #6d7075 !important; }

  #print-area .rp-card { border: 0 !important; border-radius: 0 !important; break-inside: auto; }
  #print-area .rp-card > div:first-child { padding: 0 0 8px !important; }
  #print-area .rp-card > div:first-child > :first-child { font-size: 13px !important; font-weight: 600 !important; line-height: 1.3 !important; }
  #print-area .rp-card > div:first-child > :first-child + * { margin-top: 2px; font-size: 11px !important; color: #6d7075 !important; }
  #print-area .rp-card > div:last-child { padding: 0 !important; }
  #print-area .rp-two { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 20px !important; }

  #print-area .rp-stats { display: grid !important; grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 10px !important; }
  #print-area .rp-stats > div { background-color: #f5f5f7 !important; border-radius: 14px !important; padding: 12px 14px !important; text-align: left !important; break-inside: avoid; }
  #print-area .rp-stats > div > div:first-child { display: block !important; font-size: 11px !important; font-weight: 500 !important; color: #6d7075 !important; }
  #print-area .rp-stats > div > div:last-child { margin-top: 3px; font-size: 20px !important; font-weight: 300 !important; letter-spacing: -0.01em !important; line-height: 1.25; }

  #print-area table { width: 100%; border-collapse: collapse; }
  #print-area thead { display: table-header-group; }
  #print-area tr { border-bottom: 1px solid #ececee !important; break-inside: avoid; }
  #print-area th { height: auto !important; padding: 6px 8px !important; font-size: 11px !important; font-weight: 500 !important; color: #6d7075 !important; }
  #print-area td { padding: 7px 8px !important; vertical-align: top; font-size: 12px !important; }
  #print-area td p, #print-area td div { font-size: inherit !important; }
  #print-area td .text-xs { font-size: 11px !important; }
  #print-area td [class~="rounded-full"] { display: inline-flex; padding: 2px 8px !important; border: 0 !important; border-radius: 999px !important; background-color: #f5f5f7 !important; color: #45474c !important; font-size: 10.5px !important; font-weight: 500 !important; }
}
`;

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
            let itemTotalValue = 0;
            if (item.type === 'equipment') {
                const purchaseCost = item.costPerUnit || 0;
                const lifespanMonths = (item.lifespanYears || 5) * 12;
                const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
                const purchaseDate = item.batches[0]?.receivedDate ? parseISO(item.batches[0].receivedDate) : new Date();
                const monthsInService = differenceInMonths(new Date(), purchaseDate);
                const accumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
                itemTotalValue = purchaseCost - accumulatedDepreciation;
                equipmentValue += itemTotalValue;
            } else {
                itemTotalValue = (item.totalStock || 0) * (item.costPerUnit || 0);
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
        return inventory
          .filter(item => item.type === 'retail')
          .map(item => {
            const landedCost = item.costPerUnit || 0;
            const retailPrice = item.msrp || landedCost * 1.75; // 75% markup fallback
            const profitPerUnit = retailPrice - landedCost;
    
            const unitsSold = stockCorrections
              .filter(sc => sc.productId === item.id && sc.reason.startsWith('Retail Sale'))
              .reduce((sum, sc) => sum + Math.abs(sc.change), 0);
    
            const totalUnitsHandled = unitsSold + item.totalStock;
            const sellThroughRate = totalUnitsHandled > 0 ? (unitsSold / totalUnitsHandled) * 100 : 0;
            
            const totalRevenue = unitsSold * retailPrice;
            const totalProfit = unitsSold * profitPerUnit;
    
            return {
              ...item,
              retailPrice,
              profitPerUnit,
              profitMargin: retailPrice > 0 ? (profitPerUnit / retailPrice) * 100 : 0,
              unitsSold,
              sellThroughRate,
              totalRevenue,
              totalProfit,
            };
          })
          .sort((a,b) => b.totalRevenue - a.totalRevenue); // Sort by most revenue
      }, [inventory, stockCorrections]);

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
        <div className="flex min-h-screen w-full flex-col bg-background print:bg-card">
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

                    <Card className="rp-card print:shadow-none print:border-border">
                        <CardHeader><CardTitle>Inventory Snapshot</CardTitle></CardHeader>
                        <CardContent className="rp-stats grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="p-3 bg-primary/10 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm font-medium text-primary print:text-foreground">Total Value</div>
                                <div className="text-2xl font-bold text-primary print:text-foreground">${stats.totalValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-foreground"><Package className="w-4 h-4"/> Professional</div>
                                <div className="text-lg font-bold">${stats.professionalValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-foreground"><Store className="w-4 h-4"/>Retail</div>
                                <div className="text-lg font-bold">${stats.retailValue.toFixed(2)}</div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2 print:text-foreground"><Hammer className="w-4 h-4"/>Equipment</div>
                                <div className="text-lg font-bold">${stats.equipmentValue.toFixed(2)}</div>
                            </div>
                             <div className="p-3 bg-muted/50 rounded-lg text-center print:bg-transparent">
                                <div className="text-sm text-muted-foreground print:text-foreground">Total SKUs</div>
                                <div className="text-lg font-bold">{stats.totalSKUs}</div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rp-two grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="rp-card print:shadow-none print:border-border">
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
                         <Card className="rp-card print:shadow-none print:border-border">
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

                    <Card className="rp-card print:shadow-none print:border-border">
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
                                    {inventory.map(item => {
                                        let stockDisplay;
                                        if ((item.costingMethod === 'size' && typeof item.partialContainerSize === 'number') || (item.costingMethod === 'uses' && typeof item.partialContainerUses === 'number')) {
                                            const partialValue = item.costingMethod === 'size' ? `${item.partialContainerSize.toFixed(0)} ${item.unit || 'unit'}` : `${item.partialContainerUses} ${item.useUnit || 'uses'}`;
                                            stockDisplay = (
                                                <div className="text-right">
                                                    <p className="font-mono">{item.totalStock} full</p>
                                                    <p className="text-xs font-mono text-muted-foreground"> + {partialValue} in use</p>
                                                </div>
                                            );
                                        } else {
                                            stockDisplay = <div className="text-right font-mono">{item.totalStock}</div>;
                                        }

                                        let itemTotalValue = 0;
                                        if (item.type === 'equipment') {
                                            const purchaseCost = item.costPerUnit || 0;
                                            const lifespanMonths = (item.lifespanYears || 5) * 12;
                                            const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
                                            const purchaseDate = item.batches[0]?.receivedDate ? parseISO(item.batches[0].receivedDate) : new Date();
                                            const monthsInService = differenceInMonths(new Date(), purchaseDate);
                                            const accumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
                                            itemTotalValue = purchaseCost - accumulatedDepreciation;
                                        } else {
                                            itemTotalValue = (item.totalStock || 0) * (item.costPerUnit || 0);
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
                                        }

                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell>{item.name}</TableCell>
                                                <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                                                <TableCell>{stockDisplay}</TableCell>
                                                <TableCell className="text-right font-mono">${(item.costPerUnit || 0).toFixed(2)}</TableCell>
                                                <TableCell className="text-right font-mono">${itemTotalValue.toFixed(2)}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    
                    <Card className="rp-card print:shadow-none print:border-border">
                        <CardHeader>
                            <CardTitle>Retail Performance</CardTitle>
                            <CardDescription>A breakdown of your retail product sales performance.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Units Sold</TableHead>
                                        <TableHead className="text-right">Sell-Through</TableHead>
                                        <TableHead className="text-right">Revenue</TableHead>
                                        <TableHead className="text-right">Profit/Unit</TableHead>
                                        <TableHead className="text-right">Margin</TableHead>
                                        <TableHead className="text-right">Total Profit</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {retailPerformance.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.name}</TableCell>
                                            <TableCell className="text-right font-mono">{item.unitsSold}</TableCell>
                                            <TableCell className="text-right font-mono">{item.sellThroughRate.toFixed(1)}%</TableCell>
                                            <TableCell className="text-right font-mono">${item.totalRevenue.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono text-green-500">${item.profitPerUnit.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono font-semibold">{item.profitMargin.toFixed(1)}%</TableCell>
                                            <TableCell className="text-right font-mono font-bold">${item.totalProfit.toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    
                    <Card className="rp-card print:shadow-none print:border-border">
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
             <style>{PAPER_CSS}</style>
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
