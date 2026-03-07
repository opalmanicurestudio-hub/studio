'use client';

import React, { useMemo, useState } from 'react';
import { useParams, notFound } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    ArrowLeft, 
    Edit, 
    DollarSign, 
    Package, 
    AlertCircle, 
    ShoppingCart, 
    BarChart, 
    FileText, 
    Clock, 
    Database, 
    Book, 
    QrCode, 
    Tag, 
    Truck, 
    TrendingUp, 
    TrendingDown, 
    RefreshCw, 
    Percent, 
    Search,
    Sparkles,
    Landmark,
    Calculator,
    ArrowRight,
    Loader,
    PackageOpen,
    Target,
    Printer,
    Pipette
} from 'lucide-react';
import Link from 'next/link';
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
import { format, parseISO, isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import { useInventory } from '@/context/InventoryContext';
import { type InventoryItem } from '@/lib/data';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const CorrectionIcon = ({ reason }: { reason: string }) => {
    const r = reason.toLowerCase();
    if (r.includes('appointment') || r.includes('service')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    if (r.includes('shipment')) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (r.includes('manual use')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    if (r.includes('retail sale')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <RefreshCw className="h-4 w-4 text-slate-400" />;
}

export default function ProductDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { inventory, stockCorrections, locations, services, transactions, appointments, clients, isLoading: isInventoryLoading } = useInventory();
    const { toast } = useToast();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [qrModalContent, setQrModalContent] = useState({ url: '', alt: '', title: '' });
    const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
    
    const product = useMemo(() => inventory.find((p) => p.id === id), [inventory, id]);

    const handleProductUpdate = (updatedProduct: InventoryItem) => {
        setIsEditDialogOpen(false);
    };
    
    const productCategories = useMemo(() => {
        const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
        return [...new Set(allCategories)];
    }, [inventory]);

    const ledgerWithRunningStock = useMemo(() => {
        if (!product || !appointments || !clients) return [];
      
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
            
            let displayReason = correction.reason;
            if (correction.reason.startsWith('Appointment #') && !correction.reason.includes(' for ')) {
                const parts = correction.reason.split(' by ');
                const shortId = parts[0].replace('Appointment #', '').toUpperCase();
                const staffName = parts[1] || 'Unknown Staff';
                const appointment = appointments.find(apt => apt.id.toUpperCase().endsWith(shortId));
                const clientName = appointment ? (clients.find(c => c.id === appointment.clientId)?.name) : 'Unknown Client';
                displayReason = `Service for ${clientName} by ${staffName}`;
            }
    
            return { ...correction, stockAfter: runningStock, partialAfter: runningPartial, displayReason };
        });
      
        return result.reverse(); 
    }, [product, stockCorrections, appointments, clients]);

    const filteredLedger = useMemo(() => {
        if (!ledgerWithRunningStock) return [];
        if (!ledgerSearchTerm.trim()) return ledgerWithRunningStock;
        const lowercasedSearch = ledgerSearchTerm.toLowerCase();
        return ledgerWithRunningStock.filter(correction => correction.displayReason.toLowerCase().includes(lowercasedSearch));
    }, [ledgerWithRunningStock, ledgerSearchTerm]);

    const professionalPerformance = useMemo(() => {
        if (!product || product.type !== 'professional' || !stockCorrections) return { consumptionYTD: 0, totalCostOfUse: 0, unit: '' };
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const relevantCorrections = stockCorrections.filter(sc => sc.productId === product.id && sc.change < 0 && parseISO(sc.date) >= yearStart);
        const totalConsumption = relevantCorrections.reduce((acc, sc) => acc + Math.abs(sc.change), 0);
        const costPerUnit = product.costPerUnit || 0;
        let costPerBaseUnit = 0;
        if (product.costingMethod === 'size' && product.size) costPerBaseUnit = costPerUnit / product.size;
        else if (product.costingMethod === 'uses' && product.estimatedUses) costPerBaseUnit = costPerUnit / product.estimatedUses;
        else costPerBaseUnit = costPerUnit;
        const totalCost = totalConsumption * costPerBaseUnit;
        const unit = product.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product.unit || 'units');
        return { consumptionYTD: totalConsumption, totalCostOfUse: totalCost, unit };
    }, [product, stockCorrections]);

    const retailPerformance = useMemo(() => {
        if (product?.type !== 'retail' || !transactions) return null;
        const landedCost = product.costPerUnit || 0;
        const retailPrice = product.msrp || landedCost;
        const profitPerUnit = retailPrice - landedCost;
        const retailSaleCorrections = transactions.filter(t => t.description.includes(product.name) && t.category === 'Retail');
        const unitsSold = retailSaleCorrections.length;
        const totalPurchased = unitsSold + product.totalStock;
        const sellThroughRate = totalPurchased > 0 ? (unitsSold / totalPurchased) * 100 : 0;
        return { landedCost, retailPrice, profitPerUnit, profitMargin: retailPrice > 0 ? (profitPerUnit / retailPrice) * 100 : 0, unitsSold, sellThroughRate, totalProfit: unitsSold * profitPerUnit };
    }, [product, transactions]);

    if (isInventoryLoading) return <div className="flex min-h-screen w-full flex-col bg-background justify-center items-center"><Loader className="w-8 h-8 animate-spin text-primary" /></div>;
    if (!product) return notFound();

    const stockValue = (product.totalStock || 0) * (product.costPerUnit || 0);

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
            <AppHeader title="Product Dossier" />
            <main className="flex-1 p-4 sm:p-6 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="space-y-1 text-left">
                        <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Product Record</h1>
                        <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Asset definition & usage matrix</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                        <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/inventory" className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
                        <Button size="sm" className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20" onClick={() => setIsEditDialogOpen(true)}><Edit className="h-4 w-4 mr-2" />Modify</Button>
                    </div>
                </div>

                <Card className="border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all">
                    <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
                        <div className="relative shrink-0">
                            <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2rem] md:rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl bg-muted/20 relative flex items-center justify-center">
                                {product.imageUrl ? (
                                    <Image src={product.imageUrl} alt={product.name} fill className='object-cover transition-transform duration-700' />
                                ) : (
                                    <Package className="w-16 h-16 md:w-24 md:h-24 text-muted-foreground/30" />
                                )}
                            </div>
                        </div>
                        <div className="space-y-4 flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3 md:gap-4">
                                <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none">{product.name}</h2>
                                <div className="flex gap-2">
                                    <Badge variant="outline" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-2">{product.category}</Badge>
                                    <Badge variant="secondary" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-none bg-primary/10 text-primary">{product.type}</Badge>
                                </div>
                            </div>
                            
                            <div className="flex flex-wrap justify-center sm:justify-start gap-x-10 gap-y-4 pt-2">
                                <div className="space-y-1">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Vendor Origin</p>
                                    <p className="text-base md:text-xl font-black uppercase tracking-tight text-slate-700">{product.supplier || 'Private Stock'}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Short ID / SKU</p>
                                    <p className="text-base md:text-xl font-black font-mono tracking-tighter text-primary">{product.sku || product.id.slice(-6).toUpperCase()}</p>
                                </div>
                            </div>
                            
                            <div className="flex flex-wrap justify-center sm:justify-start gap-4 pt-4">
                                <Button variant="outline" size="sm" className="h-9 px-4 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white shadow-sm" onClick={() => {
                                    setQrModalContent({
                                        url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://product/${product.id}`)}`,
                                        alt: `Internal QR for ${product.name}`,
                                        title: 'Internal Asset Code'
                                    });
                                    setIsQrModalOpen(true);
                                }}>
                                    <QrCode className="mr-2 h-3.5 w-3.5" /> Internal QR
                                </Button>
                                {product.supplierUrl && (
                                    <Button variant="outline" size="sm" className="h-9 px-4 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white shadow-sm" onClick={() => {
                                        setQrModalContent({
                                            url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(product.supplierUrl!)}`,
                                            alt: `Reorder QR for ${product.name}`,
                                            title: 'Direct Reorder Code'
                                        });
                                        setIsQrModalOpen(true);
                                    }}>
                                        <Truck className="mr-2 h-3.5 w-3.5" /> Reorder QR
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Package className="w-3 h-3"/>Full Stock</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{product.totalStock}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><DollarSign className="w-3 h-3"/>Stock Value</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">${stockValue.toFixed(0)}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><AlertCircle className="w-3 h-3"/>Threshold</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{product.reorderPoint || '—'}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1 text-left">
                            {product.type === 'professional' ? (
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><ShoppingCart className="w-3 h-3"/>Usage (YTD)</CardTitle>
                            ) : (
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><BarChart className="w-3 h-3"/>Yield (YTD)</CardTitle>
                            )}
                        </CardHeader>
                        <CardContent className="p-4 pt-0 text-left">
                            <p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono">
                                {product.type === 'professional' ? `$${professionalPerformance.totalCostOfUse.toFixed(0)}` : `$${(retailPerformance?.totalProfit || 0).toFixed(0)}`}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
                    <div className="lg:col-span-2 xl:col-span-3 space-y-10 min-w-0 order-2 lg:order-1">
                        <Tabs defaultValue="history" className="w-full">
                            <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 overflow-x-auto scrollbar-hide">
                                <TabsTrigger value="history" className="flex-1 min-w-[120px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Audit Ledger</TabsTrigger>
                                <TabsTrigger value="performance" className="flex-1 min-w-[120px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Performance</TabsTrigger>
                                <TabsTrigger value="batches" className="flex-1 min-w-[120px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Logistics</TabsTrigger>
                            </TabsList>
                            
                            <TabsContent value="history" className="m-0 space-y-6 animate-in fade-in duration-500">
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                    <Input placeholder="SEARCH LEDGER BY GUEST OR TECH..." className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white" value={ledgerSearchTerm} onChange={(e) => setLedgerSearchTerm(e.target.value)} />
                                </div>
                                <div className="space-y-3">
                                    {filteredLedger.length > 0 ? filteredLedger.map((correction: any) => (
                                        <div key={correction.id} className="flex flex-col sm:flex-row items-center justify-between p-5 rounded-[1.5rem] bg-white border-2 border-border/50 hover:border-primary/20 transition-all gap-4">
                                            <div className="flex items-center gap-4 w-full sm:w-auto">
                                                <div className="p-3 bg-muted/30 rounded-2xl border shadow-inner shrink-0">
                                                    <CorrectionIcon reason={correction.reason} />
                                                </div>
                                                <div className="min-w-0 text-left">
                                                    <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate">{correction.displayReason}</p>
                                                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60 mt-0.5">{format(safeDate(correction.date), 'MMM d, yyyy @ h:mm a')}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6 justify-between sm:justify-end w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-none border-dashed border-border/50">
                                                <div className="text-right">
                                                    <p className={cn("font-black font-mono text-sm tracking-tighter leading-none", correction.change > 0 ? "text-green-600" : "text-destructive")}>
                                                        {correction.change > 0 ? '+' : ''}{correction.change} {correction.unit}
                                                    </p>
                                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mt-1">Variance</p>
                                                </div>
                                                <div className="text-right bg-primary/[0.03] p-2.5 rounded-xl border border-primary/5 shadow-inner">
                                                    <p className="font-black font-mono text-[11px] tracking-tighter text-primary leading-none">
                                                        {correction.stockAfter}{product.costingMethod === 'uses' ? ` + ${correction.partialAfter}u` : ''}
                                                    </p>
                                                    <p className="text-[8px] font-black uppercase text-primary/40 mt-1">Net Stock</p>
                                                </div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                            <Book className="w-12 h-12" />
                                            <p className="text-[10px] font-black uppercase tracking-widest">No entries found</p>
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="performance" className="m-0 space-y-8 animate-in fade-in duration-500">
                                {product.type === 'retail' && retailPerformance && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        {[
                                            { label: 'Units Liquidated', value: retailPerformance.unitsSold, icon: TrendingUp },
                                            { label: 'Sell-Through Rate', value: `${retailPerformance.sellThroughRate.toFixed(1)}%`, icon: Percent },
                                            { label: 'Margin Precision', value: `${retailPerformance.profitMargin.toFixed(1)}%`, icon: Target },
                                            { label: 'Total Contribution', value: `$${retailPerformance.totalProfit.toFixed(2)}`, icon: DollarSign, color: 'text-primary' },
                                        ].map(kpi => (
                                            <div key={kpi.label} className="p-6 rounded-[2rem] bg-white border-2 flex items-center justify-between group hover:border-primary/20 transition-all shadow-sm">
                                                <div className='text-left'>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">{kpi.label}</p>
                                                    <p className={cn("text-3xl font-black tracking-tighter font-mono", kpi.color || "text-slate-900")}>{kpi.value}</p>
                                                </div>
                                                <div className="p-3 bg-muted/30 rounded-2xl shadow-inner group-hover:bg-primary/10 transition-colors"><kpi.icon className="w-6 h-6 text-muted-foreground/40 group-hover:text-primary transition-colors" /></div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {product.type === 'professional' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="p-6 rounded-[2rem] bg-white border-2 flex items-center justify-between group hover:border-primary/20 transition-all shadow-sm">
                                            <div className='text-left'>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">Volumetric Use</p>
                                                <p className="text-3xl font-black tracking-tighter font-mono text-slate-900">{professionalPerformance.consumptionYTD.toFixed(1)}<span className='text-xs ml-1'>{professionalPerformance.unit}</span></p>
                                            </div>
                                            <div className="p-3 bg-muted/30 rounded-2xl shadow-inner group-hover:bg-primary/10 transition-colors"><Pipette className="w-6 h-6 text-muted-foreground/40 group-hover:text-primary transition-colors" /></div>
                                        </div>
                                        <div className="p-6 rounded-[2rem] bg-white border-2 flex items-center justify-between group hover:border-primary/20 transition-all shadow-sm">
                                            <div className='text-left'>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">Cost Burn (YTD)</p>
                                                <p className="text-3xl font-black tracking-tighter font-mono text-primary">${professionalPerformance.totalCostOfUse.toFixed(2)}</p>
                                            </div>
                                            <div className="p-3 bg-muted/30 rounded-2xl shadow-inner group-hover:bg-primary/10 transition-colors"><DollarSign className="w-6 h-6 text-muted-foreground/40 group-hover:text-primary transition-colors" /></div>
                                        </div>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="batches" className="m-0 animate-in fade-in duration-500">
                                <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                                    <CardContent className="p-0 overflow-x-auto">
                                        <Table>
                                            <TableHeader className="bg-muted/10 border-b-2">
                                                <TableRow>
                                                    <TableHead className="font-black text-[10px] uppercase tracking-widest p-6">Intake Timestamp</TableHead>
                                                    <TableHead className="font-black text-[10px] uppercase tracking-widest">Inventory Qty</TableHead>
                                                    <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10">Landed Cost</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {product.batches.sort((a,b) => safeDate(b.receivedDate).getTime() - safeDate(a.receivedDate).getTime()).map(batch => (
                                                    <TableRow key={batch.id} className="group hover:bg-primary/[0.02]">
                                                        <TableCell className="p-6">
                                                            <p className="font-black uppercase tracking-tight text-xs text-slate-900">{format(safeDate(batch.receivedDate), 'MMMM d, yyyy')}</p>
                                                            {batch.expirationDate && (
                                                                <p className={cn("text-[9px] font-black uppercase tracking-widest mt-1 flex items-center gap-1.5", isPast(safeDate(batch.expirationDate)) ? "text-destructive" : "text-muted-foreground opacity-60")}>
                                                                    <Clock className="w-2.5 h-2.5" /> Expiry: {format(safeDate(batch.expirationDate), 'MMM d, yyyy')}
                                                                </p>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className="h-6 px-2.5 font-black font-mono bg-muted/50 border-none shadow-sm">{batch.stock} Units</Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right pr-10">
                                                            <span className="font-black font-mono text-base tracking-tighter text-slate-900">${batch.costPerUnit.toFixed(2)}</span>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>

                    <div className="lg:col-span-1 min-w-0 order-1 lg:order-2 space-y-8">
                        <Card className="border-4 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
                            <CardHeader className="p-8 pb-4">
                                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                                    <Calculator className="w-3 h-3" />
                                    Pricing Architecture
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 pt-4 space-y-8">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                        <span>Landed Cost</span>
                                        <span className="font-mono text-slate-900">${(product.costPerUnit || 0).toFixed(2)}</span>
                                    </div>
                                    <Separator className="border-dashed" />
                                    
                                    {product.type === 'retail' ? (
                                        <>
                                            <div className="p-6 rounded-[2rem] bg-primary/5 border-2 border-primary/10 space-y-4 shadow-inner">
                                                <p className="text-[9px] font-black uppercase text-primary tracking-widest text-center">Retail Strategy</p>
                                                <div className="flex justify-between items-baseline">
                                                    <div className="flex flex-col">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Display Price</span>
                                                        <span className="text-2xl font-black tracking-tighter font-mono text-slate-900">${(product.msrp || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="text-right flex flex-col">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Unit Profit</span>
                                                        <span className="text-3xl font-black tracking-tighter font-mono text-primary">${(retailPerformance?.profitPerUnit || 0).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                                <div className="pt-4 border-t border-primary/10 flex justify-between items-center">
                                                    <span className="text-10px] font-black uppercase text-slate-600">Profit Margin</span>
                                                    <Badge className="bg-primary text-white border-none font-black text-xs font-mono">{retailPerformance?.profitMargin.toFixed(1)}%</Badge>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="p-6 rounded-[2rem] bg-indigo-500/5 border-2 border-indigo-500/10 space-y-4 shadow-inner text-left">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-600 text-center">Efficiency Model</p>
                                                <div className="flex justify-between items-baseline">
                                                    <div className="flex flex-col">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Method</span>
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">By {product.costingMethod || 'Unit'}</span>
                                                    </div>
                                                    <div className="text-right flex flex-col">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Landed / Use</span>
                                                        <span className="text-3xl font-black tracking-tighter font-mono text-indigo-600">${((product.costPerUnit || 0) / (product.estimatedUses || product.size || 1)).toFixed(3)}</span>
                                                    </div>
                                                </div>
                                                <div className="pt-4 border-t border-indigo-500/10 space-y-2">
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase text-slate-600">
                                                        <span>Markup (Reserve)</span>
                                                        <span>{product.restockingMarkup || 0}%</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm font-black uppercase tracking-tight text-indigo-700">
                                                        <span>Final Cost / Use</span>
                                                        <span className="font-mono">${(((product.costPerUnit || 0) / (product.estimatedUses || product.size || 1)) * (1 + (product.restockingMarkup || 0) / 100)).toFixed(3)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>

            <Dialog open={isQrModalOpen} onOpenChange={setIsQrModalOpen}>
                <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden">
                    <DialogHeader className="p-8 pb-4 border-b bg-muted/5">
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter">{qrModalContent.title}</DialogTitle>
                        <DialogDescription className="sr-only">Scanning asset token for hardware reordering and tracking.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center justify-center p-12 space-y-8">
                        <div className="p-6 bg-white rounded-[2.5rem] shadow-2xl border-4 border-primary/10">
                            <Image src={qrModalContent.url} alt={qrModalContent.alt} width={220} height={220} className="rounded-xl" />
                        </div>
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-center max-w-[240px] opacity-60">System generated asset token. Authorized studio use only.</p>
                    </div>
                    <DialogFooter className="p-8 pt-0">
                        <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl" onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" /> Print Token
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
