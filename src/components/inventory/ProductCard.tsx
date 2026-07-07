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
import { Label } from '@/components/ui/label';
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
    Pipette,
    Coffee,
    Award,
    ShieldCheck,
    Building,
    User,
    Mail,
    Phone,
    Link as LinkIcon,
    ImageIcon,
    Lock,
    Unlock,
    KeyRound
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
import { cn, safeNumber } from '@/lib/utils';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { type InventoryItem } from '@/lib/data';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

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
    if (r.includes('amenity') || r.includes('refreshment') || r.includes('recipe')) return <Coffee className="h-4 w-4 text-indigo-500" />;
    if (r.includes('manual use')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    if (r.includes('retail sale')) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <RefreshCw className="h-4 w-4 text-slate-400" />;
}

export default function ProductDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { inventory, stockCorrections, locations, services, transactions, appointments, clients, staff, isLoading: isInventoryLoading } = useInventory();
    const { firestore } = useFirebase();
    // FIX: tenantId was never derived from selectedTenant — handleProductUpdate
    // referenced a bare `tenantId` that didn't exist, throwing a ReferenceError
    // the moment anyone tried to edit a product from this page.
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [qrModalContent, setQrModalContent] = useState({ url: '', alt: '', title: '' });
    const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
    
    // Vault State
    const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
    const [vaultPin, setVaultPin] = useState('');
    const [isVerifyingVault, setIsVerifyingVault] = useState(false);
    
    const product = useMemo(() => inventory.find((p) => p.id === id), [inventory, id]);

    const handleProductUpdate = (updatedProduct: InventoryItem) => {
        // FIX: guard on tenantId (derived above) instead of the undefined bare identifier
        if (!firestore || !tenantId) return;
        const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', updatedProduct.id);
        updateDocumentNonBlocking(itemRef, updatedProduct);
        toast({ title: "Dossier Synchronized", description: "Record updates committed to ledger." });
        setIsEditDialogOpen(false);
    };
    
    const productCategories = useMemo(() => {
        const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
        return [...new Set(allCategories)];
    }, [inventory]);

    const handleUnlockVault = () => {
        setIsVerifyingVault(true);
        const authorized = staff.find(s => s.pin === vaultPin && (s.role === 'admin' || s.role === 'owner'));
        
        if (authorized) {
            setIsVaultUnlocked(true);
            setVaultPin('');
            toast({ title: "Vault Unlocked", description: "Proprietary protocols now visible." });
        } else {
            toast({ variant: 'destructive', title: "Access Denied", description: "Invalid Manager PIN." });
            setVaultPin('');
        }
        setIsVerifyingVault(false);
    };

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
        } else if (product.costingMethod === 'size' && product.size) {
          const sizePerContainer = product.size || 1;
          let currentTotalSize = (product.totalStock * sizePerContainer) + (product.partialContainerSize || 0);
          initialTotalUnits = currentTotalSize - totalChange;
        } else {
          initialTotalUnits = product.totalStock - totalChange;
        }
    
        let runningStock: number;
        let runningPartial: number;
    
        if (product.costingMethod === 'uses') {
            const usesPerContainer = product.estimatedUses || 1;
            runningStock = Math.floor(initialTotalUnits / usesPerContainer);
            runningPartial = initialTotalUnits % usesPerContainer;
        } else if (product.costingMethod === 'size' ) {
            const sizePerContainer = product.size || 1;
            runningStock = Math.floor(initialTotalUnits / sizePerContainer);
            runningPartial = initialTotalUnits % sizePerContainer;
        } else {
            runningStock = initialTotalUnits;
            runningPartial = 0;
        }
      
        const result = correctionsOldestFirst.map(correction => {
            const stockBefore = runningStock;
            const partialBefore = runningPartial;

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
    
            return { 
                ...correction, 
                stockBefore,
                partialBefore,
                stockAfter: runningStock, 
                partialAfter: runningPartial, 
                displayReason 
            };
        });
      
        return result.reverse(); 
    }, [product, stockCorrections, appointments, clients]);

    const filteredLedger = useMemo(() => {
        if (!ledgerWithRunningStock) return [];
        if (!ledgerSearchTerm.trim()) return ledgerWithRunningStock;
        const lowercasedSearch = ledgerSearchTerm.toLowerCase();
        return ledgerWithRunningStock.filter(correction => correction.displayReason.toLowerCase().includes(lowercasedSearch));
    }, [ledgerWithRunningStock, ledgerSearchTerm]);

    if (isInventoryLoading) return <div className="flex min-h-screen w-full flex-col bg-background justify-center items-center"><Loader className="w-8 h-8 animate-spin text-primary" /></div>;
    if (!product) return notFound();

    const stockValue = (product.totalStock || 0) * (product.costPerUnit || 0);

    // FIX: product.batches was typed as required but has been observed missing on
    // some Firestore docs (same root cause as the ProductCard crash) — guard here too.
    const productBatches = product.batches ?? [];

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
            <AppHeader title="Product Dossier" />
            <main className="flex-1 p-4 sm:p-6 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0 text-left">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="space-y-1 text-left">
                        <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Product Record</h1>
                        <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60 text-left">Asset definition & usage matrix</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                        <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/inventory" className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
                        <Button size="sm" className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20" onClick={() => setIsEditDialogOpen(true)}><Edit className="h-4 w-4 mr-2" />Modify</Button>
                    </div>
                </div>

                <Card className="border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all text-left">
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
                        <div className="space-y-4 flex-1 min-w-0 text-left">
                            <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3 md:gap-4 text-left">
                                <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none text-left">{product.name}</h2>
                                <div className="flex gap-2">
                                    <Badge variant="outline" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-2">{product.category}</Badge>
                                    <Badge variant="secondary" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase border-none bg-primary/10 text-primary">{product.type}</Badge>
                                    {product.isMembersOnly && (
                                        <Badge className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase border-none bg-indigo-600 text-white shadow-lg">
                                            <Award className="w-3 h-3 mr-1.5" /> Club Exclusive
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            
                            <div className="flex flex-wrap justify-center sm:justify-start gap-x-10 gap-y-4 pt-2 text-left">
                                <div className="space-y-1 text-left">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Verified SKU</p>
                                    <p className="text-base md:text-xl font-black font-mono tracking-tighter text-primary text-left">{product.sku || product.id.slice(-6).toUpperCase()}</p>
                                </div>
                                <div className="space-y-1 text-left">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Vendor Origin</p>
                                    <p className="text-base md:text-xl font-black uppercase tracking-tight text-slate-700 text-left">{product.supplier || 'Private Stock'}</p>
                                </div>
                            </div>

                            {product.description && (
                                <div className="pt-4 space-y-1 text-left">
                                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Operational Context</p>
                                    <p className="text-xs md:text-sm font-medium text-slate-600 leading-relaxed italic border-l-4 border-primary/20 pl-4 text-left">
                                        "{product.description}"
                                    </p>
                                </div>
                            )}
                            
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
                                    <Button variant="outline" size="sm" className="h-9 px-4 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white shadow-sm" onClick={() => window.open(product.supplierUrl, '_blank')}>
                                        <ShoppingCart className="mr-2 h-3.5 w-3.5" /> Shop Asset
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Package className="w-3 h-3"/>Full Stock</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono text-left">{product.totalStock}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><DollarSign className="w-3 h-3"/>Stock Value</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono text-left">${stockValue.toFixed(2)}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><AlertCircle className="w-3 h-3"/>Threshold</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono text-left">{product.reorderPoint || '—'}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                        <CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Calculator className="w-3 h-3"/>Landed / Unit</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono text-left">${(product.costPerUnit || 0).toFixed(2)}</p></CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
                    <div className="lg:col-span-2 xl:col-span-3 space-y-10 min-w-0 order-2 lg:order-1 text-left">
                        <Tabs defaultValue="history" className="w-full">
                            <ScrollArea className="w-full">
                                <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 w-max">
                                    <TabsTrigger value="history" className="px-6 md:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Audit Ledger</TabsTrigger>
                                    <TabsTrigger value="manufacturing" className="px-6 md:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Manufacturing Archive</TabsTrigger>
                                    <TabsTrigger value="batches" className="px-6 md:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Logistics</TabsTrigger>
                                </TabsList>
                                <ScrollBar orientation="horizontal" className="hidden" />
                            </ScrollArea>
                            
                            <TabsContent value="history" className="m-0 space-y-6 animate-in fade-in duration-500 text-left">
                                <div className="relative text-left">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                    <Input placeholder="SEARCH LEDGER BY GUEST OR TECH..." className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white shadow-inner" value={ledgerSearchTerm} onChange={(e) => setLedgerSearchTerm(e.target.value)} />
                                </div>
                                <div className="space-y-3 text-left">
                                    {filteredLedger.length > 0 ? filteredLedger.map((correction: any) => (
                                        <div key={correction.id} className="flex flex-col sm:flex-row items-center justify-between p-5 rounded-[1.5rem] bg-white border-2 border-border/50 hover:border-primary/20 transition-all gap-4 text-left shadow-sm">
                                            <div className="flex items-center gap-4 w-full sm:w-auto text-left">
                                                <div className="p-3 bg-muted/30 rounded-2xl border shadow-inner shrink-0">
                                                    <CorrectionIcon reason={correction.reason} />
                                                </div>
                                                <div className="min-w-0 text-left">
                                                    <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate text-left">{correction.displayReason}</p>
                                                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60 mt-0.5 text-left">{format(safeDate(correction.date), 'MMM d, yyyy @ h:mm a')}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6 justify-between sm:justify-end w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-none border-dashed border-border/50 text-left">
                                                <div className="text-right">
                                                    <p className={cn("font-black font-mono text-sm tracking-tighter leading-none", correction.change > 0 ? "text-green-600" : "text-destructive")}>
                                                        {correction.change > 0 ? '+' : ''}{correction.change} {correction.unit}
                                                    </p>
                                                    {correction.stockAfter !== correction.stockBefore && (
                                                        <p className={cn("text-[8px] font-black uppercase mt-1", correction.stockAfter < correction.stockBefore ? "text-destructive/60" : "text-green-600/60")}>
                                                            {correction.stockAfter < correction.stockBefore ? '-' : '+'}{Math.abs(correction.stockAfter - correction.stockBefore)} FULL UNIT
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="text-right bg-primary/[0.03] p-2.5 rounded-xl border border-primary/5 shadow-inner text-left">
                                                    <p className="font-black font-mono text-[11px] tracking-tighter text-primary leading-none text-right">
                                                        {correction.stockAfter}u {product.costingMethod === 'uses' ? `+ ${correction.partialAfter}${product.useUnit || 'u'}` : product.costingMethod === 'size' ? `+ ${correction.partialAfter}${product.unit || 'ml'}` : ''}
                                                    </p>
                                                    <p className="text-[8px] font-black uppercase text-primary/40 mt-1 text-right">Net Stock</p>
                                                </div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-left">
                                            <Book className="w-12 h-12" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-center">No entries found</p>
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="manufacturing" className="m-0 space-y-10 animate-in fade-in duration-500 text-left">
                                <AnimatePresence mode="wait">
                                    {!isVaultUnlocked ? (
                                        <motion.div 
                                            key="lock-screen"
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 1.05 }}
                                            className="py-20 flex flex-col items-center justify-center text-center space-y-8"
                                        >
                                            <div className="w-24 h-24 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl border-2 border-primary/10 rotate-6">
                                                <Lock className="w-12 h-12 text-primary -rotate-6" />
                                            </div>
                                            <div className="space-y-2">
                                                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Technical Vault Locked</h3>
                                                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest opacity-60 max-w-sm mx-auto">Proprietary SOPs and manufacturing logistics require manager authorization.</p>
                                            </div>
                                            
                                            <div className="flex flex-col items-center gap-4 w-full max-w-xs">
                                                <div className="space-y-2 w-full">
                                                    <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Manager PIN</Label>
                                                    <Input 
                                                        type="password" 
                                                        maxLength={4} 
                                                        placeholder="••••"
                                                        value={vaultPin}
                                                        onChange={e => setVaultPin(e.target.value.replace(/\D/g, ''))}
                                                        onKeyDown={e => e.key === 'Enter' && handleUnlockVault()}
                                                        className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 focus-visible:ring-primary/20 shadow-inner bg-white"
                                                    />
                                                </div>
                                                <Button 
                                                    size="lg" 
                                                    className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/30"
                                                    onClick={handleUnlockVault}
                                                    disabled={vaultPin.length < 4 || isVerifyingVault}
                                                >
                                                    {isVerifyingVault ? <Loader className="animate-spin" /> : <>Authorize Access <ArrowRight className="ml-2 h-4 w-4"/></>}
                                                </Button>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <motion.div 
                                            key="vault-content"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="space-y-10"
                                        >
                                            <div className="flex items-center justify-between px-1">
                                                <div className="flex items-center gap-3 text-left">
                                                    <ShieldCheck className="w-5 h-5 text-primary" />
                                                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 text-left">Institutional Knowledge Vault</h3>
                                                </div>
                                                <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] uppercase tracking-widest h-6 px-3">
                                                    <Unlock className="w-2.5 h-2.5 mr-1.5" /> Unlocked
                                                </Badge>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                                                <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left">
                                                    <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Building className="w-4 h-4 opacity-40"/> Manufacturer Matrix</CardTitle></CardHeader>
                                                    <CardContent className="p-6 space-y-6 text-left">
                                                        <div className="space-y-4 text-left">
                                                            <div className="space-y-1 text-left">
                                                                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Company Identity</p>
                                                                <p className="text-base font-black uppercase tracking-tight text-slate-900 text-left">{product.manufacturerName || 'Private Label Registry'}</p>
                                                            </div>
                                                            <div className="space-y-1 text-left">
                                                                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Primary Account Contact</p>
                                                                <p className="text-sm font-bold uppercase text-slate-700 text-left">{product.manufacturerContactName || 'No contact on file'}</p>
                                                            </div>
                                                            <div className="pt-4 border-t border-dashed space-y-3 text-left">
                                                                {product.manufacturerEmail && (
                                                                    <a href={`mailto:${product.manufacturerEmail}`} className="flex items-center gap-3 p-3 rounded-xl border-2 hover:bg-primary/5 hover:border-primary/20 transition-all group">
                                                                        <Mail className="w-4 h-4 text-primary opacity-40 group-hover:opacity-100" />
                                                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 truncate">{product.manufacturerEmail}</span>
                                                                    </a>
                                                                )}
                                                                {product.manufacturerPhone && (
                                                                    <a href={`tel:${product.manufacturerPhone}`} className="flex items-center gap-3 p-3 rounded-xl border-2 hover:bg-primary/5 hover:border-primary/20 transition-all group">
                                                                        <Phone className="w-4 h-4 text-primary opacity-40 group-hover:opacity-100" />
                                                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">{product.manufacturerPhone}</span>
                                                                    </a>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left">
                                                    <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><Landmark className="w-4 h-4 opacity-40"/> Procurement Protocols</CardTitle></CardHeader>
                                                    <CardContent className="p-6 space-y-6 text-left">
                                                        <div className="grid grid-cols-2 gap-4 text-left">
                                                            <div className="p-4 rounded-xl bg-muted/20 border-2 text-left">
                                                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 mb-1 text-left">Min. Order (MOQ)</p>
                                                                <p className="text-xl font-black font-mono tracking-tighter text-slate-900 text-left">{product.moq || 'None'}</p>
                                                            </div>
                                                            <div className="p-4 rounded-xl bg-muted/20 border-2 text-left">
                                                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 mb-1 text-left">Lead Time</p>
                                                                <p className="text-xl font-black font-mono tracking-tighter text-slate-900 text-left">{product.leadTimeDays || '—'} <span className='text-[10px]'>Days</span></p>
                                                            </div>
                                                        </div>
                                                        <div className="pt-4 border-t border-dashed space-y-4 text-left">
                                                            <div className="space-y-2 text-left">
                                                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 text-left">Order Portal</p>
                                                                {product.supplierUrl ? (
                                                                    <Button asChild variant="outline" className="w-full h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white">
                                                                        <a href={product.supplierUrl} target="_blank" rel="noopener noreferrer">
                                                                            <ShoppingCart className="w-4 h-4 mr-2" />
                                                                            Visit Shop & Reorder
                                                                        </a>
                                                                    </Button>
                                                                ) : (
                                                                    <div className="p-4 rounded-xl border-2 border-dashed opacity-40 text-center text-left">
                                                                        <p className="text-[10px] font-bold uppercase tracking-widest">No shop URL archived</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="space-y-2 text-left">
                                                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 text-left">Brand Assets</p>
                                                                {product.labelTemplateUrl ? (
                                                                    <a href={product.labelTemplateUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all group">
                                                                        <div className="flex items-center gap-3">
                                                                            <FileText className="w-5 h-5 text-primary" />
                                                                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">Label Source (Canva/PDF)</span>
                                                                        </div>
                                                                        <LinkIcon className="w-4 h-4 text-primary opacity-40 group-hover:translate-x-1 transition-transform" />
                                                                    </a>
                                                                ) : (
                                                                    <div className="p-4 rounded-2xl border-2 border-dashed border-border flex items-center gap-3 opacity-40 text-left">
                                                                        <FileText className="w-5 h-5 text-muted-foreground" />
                                                                        <span className="text-[10px] font-black uppercase tracking-widest">No labels archived</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            </div>

                                            {product.labelImageUrl && (
                                                <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left">
                                                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 flex flex-row items-center justify-between">
                                                        <div className="space-y-1 text-left">
                                                            <CardTitle className="text-xs md:text-sm font-black uppercase tracking-widest flex items-center gap-3 text-left">
                                                                <ImageIcon className="w-4 h-4 text-primary opacity-40" />
                                                                Verified Brand Label
                                                            </CardTitle>
                                                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 text-left">Master asset for print production.</p>
                                                        </div>
                                                        <Button variant="outline" size="sm" asChild className="h-9 px-4 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white">
                                                            <Link href={`/inventory/labels?product=${product.id}`}>
                                                                <Printer className="w-3.5 h-3.5 mr-2" />
                                                                Print Custom Label
                                                            </Link>
                                                        </Button>
                                                    </CardHeader>
                                                    <CardContent className="p-6 md:p-10 flex justify-center bg-muted/10">
                                                        <div className="relative aspect-video w-full max-w-lg rounded-2xl overflow-hidden border-2 shadow-2xl bg-white">
                                                            <Image src={product.labelImageUrl} alt="Product Label" fill className="object-contain p-4" />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left">
                                                <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><CardTitle className="text-xs md:text-sm font-black uppercase tracking-widest flex items-center gap-3 text-left"><Landmark className="w-4 h-4 text-primary opacity-40" /> Standard Operating Procedure (SOP)</CardTitle></CardHeader>
                                                <CardContent className="p-6 md:p-10 text-left">
                                                    {product.manufacturingSop ? (
                                                        <div className="prose prose-sm max-w-none text-left">
                                                            <p className="whitespace-pre-wrap font-medium text-slate-700 leading-relaxed italic border-l-4 border-primary/20 pl-6 text-left">
                                                                "{product.manufacturingSop}"
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="py-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-left">
                                                            <Book className="w-12 h-12" />
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-center px-10">No technical protocol established for this asset.</p>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </TabsContent>

                            <TabsContent value="batches" className="m-0 animate-in fade-in duration-500 text-left">
                                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white text-left">
                                    <CardContent className="p-0 overflow-x-auto text-left">
                                        <Table>
                                            <TableHeader className="bg-muted/10 border-b-2">
                                                <TableRow>
                                                    <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-left">Intake Timestamp</TableHead>
                                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-left">Inventory Qty</TableHead>
                                                    <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10">Landed Cost</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {/* FIX: product.batches.sort(...) crashed the whole page whenever batches
                                                    was undefined. Using the guarded productBatches array instead. */}
                                                {[...productBatches].sort((a,b) => safeDate(b.receivedDate).getTime() - safeDate(a.receivedDate).getTime()).map(batch => (
                                                    <TableRow key={batch.id} className="group hover:bg-primary/[0.02]">
                                                        <TableCell className="p-6 text-left">
                                                            <p className="font-black uppercase tracking-tight text-xs text-slate-900 text-left">{format(safeDate(batch.receivedDate), 'MMMM d, yyyy')}</p>
                                                            {batch.expirationDate && (
                                                                <p className={cn("text-[9px] font-black uppercase tracking-widest mt-1 flex items-center gap-1.5 text-left", isPast(safeDate(batch.expirationDate)) ? "text-destructive" : "text-muted-foreground opacity-60")}>
                                                                    <Clock className="w-2.5 h-2.5" /> Expiry: {format(safeDate(batch.expirationDate), 'MMM d, yyyy')}
                                                                </p>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-left">
                                                            <Badge variant="secondary" className="h-6 px-2.5 font-black font-mono bg-muted/50 border-none shadow-sm">{batch.stock} Units</Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right pr-10">
                                                            <span className="font-black font-mono text-base md:text-xl tracking-tighter text-slate-900">${batch.costPerUnit.toFixed(2)}</span>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                {productBatches.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={3} className="py-16 text-center opacity-30 uppercase font-black tracking-widest text-xs">
                                                            No logistics entries found
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>

                    <div className="lg:col-span-1 min-w-0 order-1 lg:order-2 space-y-8 text-left">
                        <Card className="border-4 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden text-left">
                            <CardHeader className="p-8 pb-4 border-b bg-muted/5">
                                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                                    <Calculator className="w-3 h-3" />
                                    Pricing Architecture
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 pt-4 space-y-8 text-left">
                                <div className="space-y-4 text-left">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">
                                        <span>Landed Cost</span>
                                        <span className="font-mono text-slate-900">${(product.costPerUnit || 0).toFixed(2)}</span>
                                    </div>
                                    <Separator className="border-dashed" />
                                    
                                    {(product.type === 'retail' || product.type === 'refreshment') ? (
                                        <>
                                            <div className="p-6 rounded-[2rem] bg-primary/5 border-2 border-primary/10 space-y-4 shadow-inner text-left">
                                                <p className="text-[9px] font-black uppercase text-primary tracking-widest text-center">Price Strategy</p>
                                                <div className="flex justify-between items-baseline text-left">
                                                    <div className="flex flex-col text-left">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Display Rate</span>
                                                        <span className="text-2xl font-black tracking-tighter font-mono text-slate-900">${(product.msrp || product.price || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="text-right flex flex-col items-end text-left">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40 text-right">Unit Profit</span>
                                                        <span className="text-3xl font-black tracking-tighter font-mono text-primary">${((product.msrp || product.price || 0) - (product.costPerUnit || 0)).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                                <div className="pt-4 border-t border-primary/10 flex justify-between items-center text-left">
                                                    <span className="text-[10px] font-black uppercase text-slate-600">Net Margin</span>
                                                    <Badge className="bg-primary text-white border-none font-black text-xs font-mono">
                                                        {((product.msrp || product.price || 0) > 0 ? (((product.msrp || product.price || 0) - (product.costPerUnit || 0)) / (product.msrp || product.price || 1)) * 100 : 0).toFixed(1)}%
                                                    </Badge>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="p-6 rounded-[2rem] bg-indigo-500/5 border-2 border-indigo-500/10 space-y-4 shadow-inner text-left">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-600 text-center">Efficiency Model</p>
                                                <div className="flex justify-between items-baseline text-left">
                                                    <div className="flex flex-col text-left">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Method</span>
                                                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">By {product.costingMethod || 'Unit'}</span>
                                                    </div>
                                                    <div className="text-right flex flex-col items-end text-left">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40 text-right">Landed / Use</span>
                                                        <span className="text-3xl font-black tracking-tighter font-mono text-indigo-600">${((product.costPerUnit || 0) / (product.estimatedUses || product.size || 1)).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                                <div className="pt-4 border-t border-indigo-500/10 space-y-2 text-left">
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase text-slate-600 text-left">
                                                        <span>Markup (Reserve)</span>
                                                        <span>{product.restockingMarkup || 0}%</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm font-black uppercase tracking-tight text-indigo-700 text-left">
                                                        <span>Final Cost / Use</span>
                                                        <span className="font-mono">${(((product.costPerUnit || 0) / (product.estimatedUses || product.size || 1)) * (1 + (product.restockingMarkup || 0) / 100)).toFixed(2)}</span>
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
                <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden text-left">
                    <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">{qrModalContent.title}</DialogTitle>
                        <DialogDescription className="sr-only">Scanning asset token for hardware reordering and tracking.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center justify-center p-12 space-y-8 text-left">
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
