

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit, DollarSign, Package, AlertCircle, ShoppingCart, BarChart, FileText, Clock, Database, Book, QrCode, Tag, Truck, TrendingUp, TrendingDown, RefreshCw, Percent } from 'lucide-react';
import { services } from '@/lib/data';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import React, { useMemo, useState } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { StockCorrection, type InventoryItem } from '@/lib/data';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useToast } from '@/hooks/use-toast';

const CorrectionIcon = ({ reason }: { reason: string }) => {
    if (reason.startsWith('Appointment')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    if (reason.startsWith('Shipment')) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (reason.startsWith('Manual Use')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <RefreshCw className="h-4 w-4 text-gray-500" />;
}


export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { inventory, stockCorrections, setInventory, locations } = useInventory();
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const product = inventory.find((p) => p.id === id);

  const handleProductUpdate = (updatedProduct: InventoryItem) => {
    setInventory(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    toast({
        title: "Product Updated",
        description: `${updatedProduct.name} has been successfully updated.`,
    });
    setIsEditDialogOpen(false);
  };
  
  const productCategories = useMemo(() => {
    const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
    return [...new Set(allCategories)];
  }, [inventory]);


  if (!product) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Product Details" />
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div>Product not found.</div>
            </main>
        </div>
    )
  }
  
  const servicesUsingProduct = services.filter(s => s.products?.some(p => p.id === product.id));
  const productStockCorrections = stockCorrections.filter(sc => sc.productId === product.id).sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());

  const stockValue = (product.totalStock || 0) * (product.costPerUnit || 0);

  const ledgerWithRunningStock = useMemo(() => {
    if (!product) return [];
  
    const correctionsOldestFirst = stockCorrections
      .filter(sc => sc.productId === product.id)
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

    let totalChange = correctionsOldestFirst.reduce((acc, c) => acc + c.change, 0);
    
    let initialTotalUnits;
    if (product.costingMethod === 'uses') {
      const usesPerContainer = product.estimatedUses || 1;
      let currentTotalUses = (product.totalStock * usesPerContainer) + (product.partialContainerUses || 0);
      initialTotalUnits = currentTotalUses - totalChange;
    } else if (product.costingMethod === 'size') {
      const sizePerContainer = product.size || 1;
      let currentTotalSize = (product.totalStock * sizePerContainer) + (product.partialContainerSize || 0);
      initialTotalUnits = currentTotalSize - totalChange;
    } else {
      initialTotalUnits = product.totalStock - totalChange;
    }

    let runningStock;
    let runningPartial;

    if (product.costingMethod === 'uses') {
        const usesPerContainer = product.estimatedUses || 1;
        runningStock = Math.floor(initialTotalUnits / usesPerContainer);
        runningPartial = initialTotalUnits % usesPerContainer;
    } else if (product.costingMethod === 'size') {
        const sizePerContainer = product.size || 1;
        runningStock = Math.floor(initialTotalUnits / sizePerContainer);
        runningPartial = initialTotalUnits % sizePerContainer;
    } else {
        runningStock = initialTotalUnits;
        runningPartial = 0;
    }
  
    const result = correctionsOldestFirst.map(correction => {
        if (product.costingMethod === 'uses') {
            const usesPerContainer = product.estimatedUses || 1;
            let currentTotalUses = (runningStock * usesPerContainer) + runningPartial;
            currentTotalUses += correction.change;
            runningStock = Math.floor(currentTotalUses / usesPerContainer);
            runningPartial = currentTotalUses % usesPerContainer;
        } else if (product.costingMethod === 'size') {
            const sizePerContainer = product.size || 1;
            let currentTotalSize = (runningStock * sizePerContainer) + runningPartial;
            currentTotalSize += correction.change;
            runningStock = Math.floor(currentTotalSize / sizePerContainer);
            runningPartial = currentTotalSize % sizePerContainer;
        } else {
            runningStock += correction.change;
        }

        return { 
            ...correction, 
            stockAfter: runningStock, 
            partialAfter: runningPartial,
        };
    });
  
    return result.reverse(); 
  }, [product, stockCorrections]);


  // Mock retail data for demonstration
  const retailPerformance = useMemo(() => {
    if (product.type !== 'retail') return null;

    const landedCost = product.costPerUnit || 0;
    const retailPrice = landedCost * 1.75; // Mock 75% markup
    const profitPerUnit = retailPrice - landedCost;
    
    // Mock sales data
    const unitsSold = 53;
    const totalPurchased = unitsSold + product.totalStock;
    const sellThroughRate = totalPurchased > 0 ? (unitsSold / totalPurchased) * 100 : 0;
    const totalProfit = unitsSold * profitPerUnit;

    return {
        landedCost,
        retailPrice,
        profitPerUnit,
        profitMargin: retailPrice > 0 ? (profitPerUnit / retailPrice) * 100 : 0,
        unitsSold,
        sellThroughRate,
        totalProfit,
    };
  }, [product]);


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Product Details" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" asChild>
                <Link href="/inventory">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Inventory
                </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)}>
                <Edit className="h-4 w-4 mr-2"/>
                Edit Product
            </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="w-24 h-24 bg-muted rounded-md flex-shrink-0 flex items-center justify-center">
                {product.imageUrl ? (
                    <Image src={product.imageUrl} alt={product.name} width={96} height={96} className='rounded-md object-cover w-full h-full' data-ai-hint="product photo"/>
                ) : (
                    <Package className="w-12 h-12 text-muted-foreground" />
                )}
            </div>
            <div className='flex-1'>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                    {product.name}
                </h1>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <Badge variant="outline">{product.category}</Badge>
                    <Badge variant="secondary">{product.type}</Badge>
                </div>
            </div>
        </div>

        <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><Tag className='w-4 h-4' /> SKU</div>
                    <div className='font-mono text-sm'>{product.id.slice(-8).toUpperCase()}</div>
                </div>
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><Truck className='w-4 h-4' /> Vendor</div>
                    <div className='font-medium text-sm'>{product.supplier}</div>
                </div>
                 <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><QrCode className='w-4 h-4' /> Reorder QR</div>
                    <div className='w-12 h-12 bg-muted flex items-center justify-center rounded-md'>
                        <Image
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=48x48&data=${encodeURIComponent(product.supplierUrl || `clarityflow://product/${product.id}`)}`}
                            alt={`Reorder QR for ${product.name}`}
                            width={48}
                            height={48}
                            className="object-contain"
                        />
                    </div>
                </div>
                 <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><QrCode className='w-4 h-4' /> Internal QR</div>
                     <div className='w-12 h-12 bg-muted flex items-center justify-center rounded-md'>
                        <Image
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=48x48&data=${encodeURIComponent(`clarityflow://product/${product.id}`)}`}
                            alt={`Internal QR for ${product.name}`}
                            width={48}
                            height={48}
                            className="object-contain"
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Stock</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{product.totalStock}</div>
            </CardContent>
          </Card>
           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stockValue.toFixed(2)}</div>
            </CardContent>
          </Card>
           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Reorder Point</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{product.reorderPoint || 'N/A'}</div>
            </CardContent>
          </Card>
          {product.type === 'professional' ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cost of Consumption (YTD)</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">$125.50</div>
                </CardContent>
            </Card>
          ) : (
             <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Profit (YTD)</CardTitle>
                <BarChart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                <div className="text-2xl font-bold">${(retailPerformance?.totalProfit || 0).toFixed(2)}</div>
                </CardContent>
            </Card>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
             <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle>Cost & Price Analysis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex justify-between p-2 bg-muted/50 rounded-md"><span>Landed Cost / Item:</span><span className="font-mono">${(product.costPerUnit || 0).toFixed(2)}</span></div>
                    
                    {product.type === 'professional' ? (
                        <>
                            <div className="flex justify-between p-2 bg-muted/50 rounded-md"><span>Restocking Markup:</span><span className="font-mono">5%</span></div>
                            <div className="flex justify-between p-2 bg-muted/50 rounded-md"><span>Raw Cost/Use:</span><span className="font-mono">$0.23</span></div>
                            <div className="flex justify-between p-3 bg-primary/10 rounded-md font-bold"><span>Final Cost/Use:</span><span className="font-mono text-primary">$0.25</span></div>
                        </>
                    ): (
                         <>
                            <div className="flex justify-between p-2 bg-muted/50 rounded-md"><span>Retail Price (MSRP):</span><span className="font-mono">${(retailPerformance?.retailPrice || 0).toFixed(2)}</span></div>
                            <div className="flex justify-between p-3 bg-primary/10 rounded-md font-bold"><span>Profit per Unit:</span><span className="font-mono text-primary">${(retailPerformance?.profitPerUnit || 0).toFixed(2)}</span></div>
                            <div className="flex justify-between p-2 bg-muted/50 rounded-md items-center">
                                <span>Profit Margin:</span>
                                <Badge variant="secondary" className="text-base">{(retailPerformance?.profitMargin || 0).toFixed(1)}%</Badge>
                            </div>
                        </>
                    )}
                </CardContent>
             </Card>
             <Card className="lg:col-span-2">
                <Tabs defaultValue="performance">
                    <CardHeader>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="performance">Performance</TabsTrigger>
                            <TabsTrigger value="history">History & Notes</TabsTrigger>
                        </TabsList>
                    </CardHeader>
                    <CardContent>
                        <TabsContent value="performance">
                            {product.type === 'retail' && retailPerformance && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-muted/50 rounded-md">
                                        <p className="text-sm text-muted-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Units Sold (YTD)</p>
                                        <p className="text-2xl font-bold">{retailPerformance.unitsSold}</p>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded-md">
                                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Percent className="w-4 h-4" /> Sell-Through Rate</p>
                                        <p className="text-2xl font-bold">{retailPerformance.sellThroughRate.toFixed(1)}%</p>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded-md">
                                        <p className="text-sm text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" /> Profit per Unit</p>
                                        <p className="text-2xl font-bold text-primary">${retailPerformance.profitPerUnit.toFixed(2)}</p>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded-md">
                                        <p className="text-sm text-muted-foreground flex items-center gap-2"><BarChart className="w-4 h-4" /> Total Profit (YTD)</p>
                                        <p className="text-2xl font-bold text-primary">${retailPerformance.totalProfit.toFixed(2)}</p>
                                    </div>
                                </div>
                            )}
                             {product.type === 'professional' && (
                                <div className="space-y-4">
                                     <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-muted/50 rounded-md">
                                            <p className="text-sm text-muted-foreground">Consumption (YTD)</p>
                                            <p className="text-xl font-bold">502ml</p>
                                        </div>
                                         <div className="p-3 bg-muted/50 rounded-md">
                                            <p className="text-sm text-muted-foreground">Total Cost of Use</p>
                                            <p className="text-xl font-bold">$125.50</p>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="font-medium mb-2">Used In Services</h4>
                                        <div className="space-y-2">
                                            {servicesUsingProduct.length > 0 ? (
                                                servicesUsingProduct.map(service => (
                                                    <div key={service.id} className="p-2 bg-muted/50 rounded-md text-sm">{service.name}</div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-center text-muted-foreground py-4">Not used in any services yet.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                        <TabsContent value="history">
                            <Tabs defaultValue="ledger">
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="ledger"><Book className="w-4 h-4 mr-2"/>Ledger</TabsTrigger>
                                    <TabsTrigger value="batches"><Database className="w-4 h-4 mr-2"/>Batches</TabsTrigger>
                                    <TabsTrigger value="notes"><FileText className="w-4 h-4 mr-2"/>Notes</TabsTrigger>
                                </TabsList>
                                <TabsContent value="ledger" className="mt-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Reason</TableHead>
                                                <TableHead className='text-right'>Change</TableHead>
                                                <TableHead className='text-right'>Stock After</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {ledgerWithRunningStock.length > 0 ? (
                                                ledgerWithRunningStock.map((correction) => {
                                                    let stockAfterDisplay = `${(correction as any).stockAfter?.toFixed(0) || 'N/A'}`;
                                                    if (product.costingMethod === 'uses') {
                                                        stockAfterDisplay = `${Math.floor((correction as any).stockAfter) || 0} full, ${((correction as any).partialAfter || 0)} uses`;
                                                    } else if (product.costingMethod === 'size') {
                                                        stockAfterDisplay = `${Math.floor((correction as any).stockAfter) || 0} full, ${((correction as any).partialAfter || 0).toFixed(2)}${product.unit}`;
                                                    }

                                                    return (
                                                    <TableRow key={correction.id}>
                                                        <TableCell>{format(parseISO(correction.date), 'MMM d, yyyy h:mm a')}</TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <CorrectionIcon reason={correction.reason} />
                                                                <span>{correction.reason}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className={cn('text-right font-mono', correction.change > 0 ? 'text-green-500' : 'text-red-500')}>
                                                            {correction.change > 0 ? '+' : ''}{correction.change} {correction.unit}
                                                        </TableCell>
                                                         <TableCell className="text-right font-mono text-xs">
                                                            {stockAfterDisplay}
                                                         </TableCell>
                                                    </TableRow>
                                                )})
                                            ) : (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No inventory movements recorded yet.</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </TabsContent>
                                <TabsContent value="batches" className="mt-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Received</TableHead>
                                                <TableHead>Qty</TableHead>
                                                <TableHead>Cost/Unit</TableHead>
                                                <TableHead>Expires</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {product.batches.map(batch => (
                                                <TableRow key={batch.id}>
                                                    <TableCell>{format(parseISO(batch.receivedDate), 'MMM d, yyyy')}</TableCell>
                                                    <TableCell>{batch.stock}</TableCell>
                                                    <TableCell>${batch.costPerUnit.toFixed(2)}</TableCell>
                                                    <TableCell>{batch.expirationDate ? format(parseISO(batch.expirationDate), 'MMM d, yyyy') : 'N/A'}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TabsContent>
                                <TabsContent value="notes" className="mt-4">
                                     <p className="text-sm text-center text-muted-foreground py-8">Internal notes coming soon.</p>
                                </TabsContent>
                            </Tabs>
                        </TabsContent>
                    </CardContent>
                </Tabs>
             </Card>
        </div>
      </main>
      {product && (
        <EditProductDialog
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            product={product}
            onProductUpdated={handleProductUpdate}
            categories={productCategories}
            onNewCategory={() => {}}
            locations={locations}
            onAddLocationClick={() => {}}
        />
      )}
    </div>
  );

    
}
