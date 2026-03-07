'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    ArrowLeft, 
    Clock, 
    DollarSign, 
    Sparkles, 
    Box, 
    List, 
    Pencil, 
    Info, 
    ShoppingCart, 
    Hammer, 
    BarChart, 
    Users, 
    TrendingUp, 
    MapPin, 
    Link as LinkIcon, 
    AlertTriangle,
    Target,
    Zap,
    Briefcase,
    Calendar as CalendarIcon
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { type Service, type InventoryItem, type Appointment } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';

const ProfitAnalysisCard = ({ service, tmhr }: { service: Service; tmhr: number }) => {
    const { inventory, pricingTiers } = useInventory();

    const { cost, timeCost, productCost } = useMemo(() => {
        const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
        const timeCost = (totalDuration / 60) * tmhr;
        
        const productCost = (service.products || []).reduce((acc, p) => {
            const product = inventory.find(i => i.id === p.id);
            if (!product) return acc;

            let costPerUse = 0;
            if (product.costingMethod === 'size' && product.size && product.size > 0) {
                costPerUse = (product.costPerUnit || 0) / product.size;
            } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
            } else {
                costPerUse = product.costPerUnit || 0;
            }
            
            return acc + (costPerUse * p.quantityUsed);
        }, 0);
        
        return { cost: timeCost + productCost, timeCost, productCost };
    }, [service, tmhr, inventory]);

    const tierAnalysis = useMemo(() => {
        if (!service.serviceTiers || service.serviceTiers.length === 0 || !pricingTiers) {
            const profit = service.price - cost;
            const margin = service.price > 0 ? (profit / service.price) * 100 : 0;
            return [{ name: 'Standard', price: service.price, profit, margin, rank: 0 }];
        }

        return service.serviceTiers.map(tier => {
            const tierInfo = pricingTiers.find(pt => pt.id === tier.tierId);
            if (!tierInfo) return null;

            const profit = tier.price - cost;
            const margin = tier.price > 0 ? (profit / tier.price) * 100 : 0;

            return {
                name: tierInfo.name,
                rank: tierInfo.rank,
                price: tier.price,
                profit,
                margin,
            };
        }).filter((t): t is NonNullable<typeof t> => t !== null).sort((a,b) => a.rank - b.rank);
    }, [service, cost, pricingTiers]);

    return (
        <Card className="lg:sticky top-24 border-4 rounded-[2.5rem] shadow-2xl shadow-primary/5">
            <CardHeader className="p-8 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <Sparkles className="w-3 h-3" />
                    Yield Engine
                </CardTitle>
                <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">
                    Target analysis @ <strong>${tmhr.toFixed(2)}/hr</strong> TMHR
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-4 space-y-8">
                <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 space-y-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-destructive/60 flex items-center gap-2">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Breakeven Threshold
                    </p>
                    <div className="flex justify-between items-baseline">
                        <span className="text-4xl font-black text-destructive tracking-tighter font-mono">${cost.toFixed(2)}</span>
                        <span className="text-[9px] font-black uppercase text-destructive/40">Unit Cost</span>
                    </div>
                    <div className="space-y-1.5 text-[10px] pt-4 border-t border-destructive/10 font-bold uppercase tracking-tight">
                        <div className="flex justify-between"><span>Time ({service.duration}m):</span> <span className="font-mono">${timeCost.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Formula:</span> <span className="font-mono">${productCost.toFixed(2)}</span></div>
                    </div>
                </div>

                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Profit Distribution</p>
                    <div className="grid gap-3">
                        {tierAnalysis.map(tier => (
                            <div key={tier.name} className={cn(
                                "p-4 rounded-2xl border-2 transition-all", 
                                tier.profit >= 0 ? "bg-primary/5 border-primary/10" : "bg-red-50 border-red-200"
                            )}>
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs font-black uppercase tracking-widest">{tier.name}</span>
                                    {tier.profit < 0 && <Badge variant="destructive" className="h-4 text-[8px] font-black uppercase animate-pulse border-none">Hard Loss</Badge>}
                                </div>
                                <div className="flex justify-between items-baseline">
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Price Point</span>
                                        <span className="text-sm font-black font-mono tracking-tight">${tier.price.toFixed(2)}</span>
                                    </div>
                                    <div className="text-right flex flex-col">
                                        <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Net Profit</span>
                                        <span className={cn("font-black text-lg tracking-tighter font-mono", tier.profit >= 0 ? "text-primary" : "text-destructive")}>
                                            ${tier.profit.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
            {tierAnalysis.some(t => t.profit < 0) && (
                <CardFooter className="p-6 bg-red-50 rounded-b-[2.2rem] border-t-2 border-red-100">
                    <div className="flex gap-3 text-[10px] text-red-800 font-bold uppercase leading-relaxed">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>One or more tiers are operating below breakeven. Adjust pricing to avoid studio deficit.</p>
                    </div>
                </CardFooter>
            )}
        </Card>
    );
};

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { inventory } = useInventory();
  const { timeCost, productCosts, totalCost } = useMemo(() => {
    const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;

    const productCosts = (service.products || []).map(p => {
        const product = inventory.find(i => i.id === p.id);
        let cost = 0;
        if (product) {
            let costPerUse = 0;
            if (product.costingMethod === 'size' && product.size && product.size > 0) {
                costPerUse = (product.costPerUnit || 0) / product.size;
            } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
            } else {
                costPerUse = product.costPerUnit || 0;
            }
            cost = costPerUse * (p.quantityUsed || 1);
        }
      return {
        ...p,
        cost: cost,
        location: 'Back Room - Shelf A' 
      }
    });

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalCost = timeCost + totalProductCost;

    return { timeCost, productCosts, totalCost };
  }, [service, tmhr, inventory]);

  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden">
        <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest">Breakeven Architecture</CardTitle>
            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Complete cost profile per session.</CardDescription>
        </CardHeader>
        <CardContent className="p-6 md:p-8 space-y-10">
            <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                    <Clock className="w-3.5 h-3.5" />
                    Time Allocation Cost
                </h4>
                <div className="flex justify-between items-center bg-muted/20 p-5 rounded-[1.5rem] border-2 border-transparent hover:border-primary/10 transition-all">
                    <div className="space-y-0.5">
                        <p className="font-black text-sm uppercase tracking-tight">Reserved Studio Time</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{((service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0))} Min @ ${tmhr.toFixed(2)}/hr</p>
                    </div>
                    <span className="font-black text-xl font-mono tracking-tighter text-slate-900">${timeCost.toFixed(2)}</span>
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Formula Expenditures
                </h4>
                <div className="grid gap-3">
                    {productCosts.length > 0 ? productCosts.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-muted/20 p-4 rounded-[1.5rem] border-2 border-transparent hover:border-primary/10 transition-all">
                            <div className='flex items-center gap-4 min-w-0'>
                                <div className="w-10 h-10 bg-background rounded-2xl border shadow-inner flex-shrink-0 flex items-center justify-center overflow-hidden">
                                    {p.imageUrl ? (
                                        <Image src={p.imageUrl} alt={p.name} width={40} height={40} className='object-cover h-full w-full' />
                                    ) : (
                                        <Box className="w-5 h-5 text-muted-foreground/40" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="font-black text-xs uppercase tracking-tight truncate text-slate-900">{p.name}</p>
                                    <p className='text-[9px] text-muted-foreground font-black uppercase tracking-widest flex items-center gap-1 opacity-60'><MapPin className="w-2.5 h-2.5"/>{p.location}</p>
                                </div>
                            </div>
                            <span className="font-black text-sm font-mono tracking-tighter text-slate-700 shrink-0">${(p.cost || 0).toFixed(3)}</span>
                        </div>
                    )) : (
                        <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                            <PlusCircle className="w-8 h-8" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No products in formula</p>
                        </div>
                    )}
                </div>
            </div>
        </CardContent>
         <CardFooter className="bg-primary/5 p-8 border-t-2 border-primary/10">
            <div className="flex justify-between items-center w-full">
                <div className="space-y-0.5">
                    <p className="text-[10px] font-black uppercase text-primary tracking-widest">Combined Breakeven</p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Minimum threshold for profit</p>
                </div>
                <span className="font-black text-3xl font-mono tracking-tighter text-primary">${totalCost.toFixed(2)}</span>
            </div>
        </CardFooter>
    </Card>
  );
};


export default function ServiceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { services, appointments } = useInventory();
    const { selectedTenant } = useTenant();
    const service = useMemo(() => services.find(s => s.id === id), [services, id]);
    const [tmhr, setTmhr] = useState(0);
    const { toast } = useToast();

    useEffect(() => {
        if (selectedTenant && typeof selectedTenant.tmhr === 'number') {
            setTmhr(selectedTenant.tmhr);
        } else {
            setTmhr(50); // Fallback if not set
        }
    }, [selectedTenant]);

    const servicePerformance = useMemo(() => {
        if (!service) return null;
        const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
        const totalRevenue = bookings.reduce((acc, apt) => acc + (apt.revenue || 0), 0);
        const uniqueClients = new Set(bookings.map(apt => apt.clientId)).size;

        return {
            totalBookings: bookings.length,
            totalRevenue: totalRevenue,
            uniqueClients: uniqueClients,
            avgRevenuePerBooking: bookings.length > 0 ? totalRevenue / bookings.length : 0,
        };
    }, [service, appointments]);
    
    
     const handleCopyLink = () => {
        if (!service) return;
        const bookingLink = `${window.location.origin}/book/${selectedTenant?.id}/${service.id}`;
        navigator.clipboard.writeText(bookingLink);
        toast({
            title: "Booking Link Copied!",
            description: "Direct URL is ready for guest distribution.",
        });
    };


    if (!service) {
        return notFound();
    }
    const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Service Record" />
      <main className="flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-1">
                <h1 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Treatment Record</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Service definition & yield dossier</p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button variant="outline" asChild className="flex-1 sm:flex-none h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/services"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
                <Button variant="outline" className="flex-1 sm:flex-none h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm" onClick={handleCopyLink}><LinkIcon className="h-4 w-4 mr-2"/>Share Link</Button>
                <Button className="flex-1 sm:flex-none h-12 px-6 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Pencil className="h-4 w-4 mr-2" />Modify</Button>
            </div>
        </div>

        <Card className="border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all">
            <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
                <div className="relative shrink-0">
                    <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2rem] md:rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl bg-muted/20 relative flex items-center justify-center">
                        {service.imageUrl ? (
                            <Image 
                                src={service.imageUrl} 
                                alt={service.name} 
                                fill
                                className='object-cover transition-transform duration-700' 
                            />
                        ) : (
                            <List className="w-16 h-16 md:w-24 md:h-24 text-muted-foreground/30" />
                        )}
                    </div>
                </div>
                <div className="space-y-4 flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3 md:gap-4">
                        <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none">{service.name}</h2>
                        {service.isPrivate && <Badge className="bg-muted text-muted-foreground border-none font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Private Access</Badge>}
                    </div>
                    
                    <div className="flex flex-wrap justify-center sm:justify-start gap-x-10 gap-y-4 pt-2">
                        <div className="space-y-1">
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Treatment Duration</p>
                            <div className="flex items-center gap-2 font-black text-base md:text-xl text-primary tracking-tight">
                                <Clock className="w-4 h-4 md:w-5 md:h-5" />
                                {service.duration} MIN
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Service Category</p>
                            <p className="text-xs md:text-sm font-black uppercase tracking-tight text-slate-700">{service.category || 'Uncategorized'}</p>
                        </div>
                    </div>
                    <p className="text-xs md:text-sm font-medium text-slate-600 leading-relaxed max-w-2xl pt-2">{service.description || 'No description provided for this treatment.'}</p>
                </div>
            </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
            <div className="lg:col-span-2 xl:col-span-3 space-y-10 min-w-0">
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><CalendarIcon className="w-3 h-3"/>Bookings</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{servicePerformance?.totalBookings}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><TrendingUp className="w-3 h-3"/>Total Yield</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">${servicePerformance?.totalRevenue.toFixed(0)}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Users className="w-3 h-3"/>Unique Guests</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{servicePerformance?.uniqueClients}</p></CardContent>
                    </Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-4 pb-1"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Target className="w-3 h-3"/>Avg. Value</CardTitle></CardHeader>
                        <CardContent className="p-4 pt-0"><p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono">${servicePerformance?.avgRevenuePerBooking.toFixed(0)}</p></CardContent>
                    </Card>
                </div>

                <Tabs defaultValue="architecture">
                    <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8">
                        <TabsTrigger value="architecture" className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Architecture</TabsTrigger>
                        <TabsTrigger value="logistics" className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Logistics</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="architecture" className="m-0 space-y-10 animate-in fade-in duration-500">
                        <CostBreakdown service={service} tmhr={tmhr} />
                    </TabsContent>

                    <TabsContent value="logistics" className="m-0 space-y-10 animate-in fade-in duration-500">
                        <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                            <CardHeader className="bg-muted/5 border-b p-8 pb-4 text-left">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3"><MapPin className="w-4 h-4 text-primary" /> Resource Dependencies</CardTitle>
                            </CardHeader>
                            <CardContent className="p-8">
                                {(service.requiredResourceIds || []).length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {(service.requiredResourceIds || []).map(rid => (
                                            <div key={rid} className="p-4 rounded-2xl bg-muted/20 border-2 flex items-center gap-4">
                                                <div className="p-2.5 bg-background rounded-xl shadow-inner text-muted-foreground"><Hammer className="w-5 h-5"/></div>
                                                <p className="font-black text-xs uppercase tracking-tight text-slate-900">Resource Unit #{rid.slice(-4).toUpperCase()}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                                        <Briefcase className="w-10 h-10" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Resource Dependencies</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>

            <div className="lg:col-span-1 min-w-0">
                <ProfitAnalysisCard service={service} tmhr={tmhr} />
            </div>
        </div>
      </main>
    </div>
  );
}
