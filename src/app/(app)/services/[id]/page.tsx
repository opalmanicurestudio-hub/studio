
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
    Calendar as CalendarIcon,
    Activity,
    Scale,
    Percent,
    ShieldCheck,
    PackageOpen,
    ArrowRight,
    User,
    Loader,
    Pipette
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { type Service, type InventoryItem, type Appointment, type Staff, type PricingTier } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const ProfitAnalysisCard = ({ service, tmhr, staff, pricingTiers, taxBurden }: { service: Service; tmhr: number; staff: Staff[], pricingTiers: PricingTier[], taxBurden: number }) => {
    const { inventory } = useInventory();

    const { materialCost, timeCost } = useMemo(() => {
        const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
        const timeCost = (totalDuration / 60) * tmhr;
        
        const materialCost = (service.products || []).reduce((acc, p) => {
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
        
        return { materialCost, timeCost };
    }, [service, tmhr, inventory]);

    const tierAnalysis = useMemo(() => {
        return pricingTiers.sort((a,b) => a.rank - b.rank).map(tier => {
            const tierPriceConfig = service.serviceTiers?.find(t => t.tierId === tier.id);
            const price = tierPriceConfig ? tierPriceConfig.price : service.price;
            const duration = tierPriceConfig ? tierPriceConfig.durationMinutes : service.duration;

            const relevantStaff = staff.filter(s => s.pricingTierId === tier.id);

            const staffAnalysis = relevantStaff.map(member => {
                let laborCost = 0;
                if (member.payStructure === 'hourly' && member.hourlyRate) {
                    laborCost = (duration / 60) * member.hourlyRate;
                } else if (member.payStructure === 'hourly_plus_commission' && member.hourlyRate) {
                    laborCost = ((duration / 60) * member.hourlyRate) + (price * ((member.commissionRate || 40) / 100));
                } else {
                    const rate = member.commissionRate || 40;
                    laborCost = price * (rate / 100);
                }

                const burdenedLabor = laborCost * (1 + (taxBurden / 100));
                const studioNet = price - materialCost - timeCost - burdenedLabor;
                const margin = price > 0 ? (studioNet / price) * 100 : 0;

                return {
                    id: member.id,
                    name: member.name,
                    avatarUrl: member.avatarUrl,
                    payStructure: member.payStructure,
                    studioNet,
                    margin
                };
            });

            return {
                ...tier,
                price,
                duration,
                staffAnalysis
            };
        });
    }, [pricingTiers, service, staff, materialCost, timeCost, taxBurden]);

    return (
        <Card className="lg:sticky lg:top-24 border-4 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
            <CardHeader className="p-6 sm:p-8 pb-4 border-b bg-muted/5 text-left">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <Sparkles className="w-3 h-3" />
                    Yield Engine
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                    Net Analysis per Pro @ {taxBurden}% Tax Burden
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 sm:p-8 space-y-8">
                <div className="space-y-6 text-left">
                    {tierAnalysis.map(tier => (
                        <div key={tier.id} className="space-y-3">
                            <div className="flex justify-between items-center px-1 text-left">
                                <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{tier.name}</span>
                                <span className="font-black text-slate-900 text-xs">${tier.price.toFixed(2)}</span>
                            </div>
                            <div className="grid gap-2">
                                {tier.staffAnalysis.length > 0 ? tier.staffAnalysis.map(sa => (
                                    <div key={sa.id} className={cn(
                                        "p-3 rounded-2xl border-2 flex items-center justify-between transition-all shadow-sm",
                                        sa.studioNet >= 0 ? "bg-white border-primary/5 hover:border-primary/20" : "bg-red-50 border-red-200"
                                    )}>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <Avatar className="h-8 w-8 border-2 shadow-sm rounded-xl">
                                                <AvatarImage src={sa.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="text-[8px] font-black">{(sa.name || 'S')[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 text-left">
                                                <p className="font-black uppercase text-[10px] truncate leading-none mb-1">{sa.name.split(' ')[0]}</p>
                                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                                                    {sa.payStructure === 'hourly_plus_commission' ? 'Hybrid' : sa.payStructure}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className={cn("font-black font-mono text-xs", sa.studioNet >= 0 ? "text-primary" : "text-destructive")}>
                                                {sa.studioNet >= 0 ? '+' : ''}${sa.studioNet.toFixed(2)}
                                            </p>
                                            <p className={cn("text-[8px] font-black uppercase", sa.studioNet >= 0 ? "text-primary/60" : "text-destructive/60")}>
                                                {sa.margin.toFixed(0)}% Net
                                            </p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="p-4 rounded-2xl border-2 border-dashed bg-muted/5 text-center">
                                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">No staff assigned</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { inventory } = useInventory();
  const { timeCost, productCosts, totalHardCost } = useMemo(() => {
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
      return { ...p, cost: cost };
    });

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalHardCost = timeCost + totalProductCost;

    return { timeCost, productCosts, totalHardCost };
  }, [service, tmhr, inventory]);

  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
        <CardHeader className="bg-muted/5 border-b p-6 sm:p-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-left">Base Operational Load</CardTitle>
            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60 text-left">Studio-side overhead manifest.</CardDescription>
        </CardHeader>
        <CardContent className="p-6 sm:p-8 space-y-10 text-left">
            <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                    <Scale className="w-3.5 h-3.5" />
                    Material Components
                </h4>
                <div className="grid gap-3">
                    <div className="flex justify-between items-center bg-muted/20 p-4 rounded-xl border-2">
                        <div className="text-left">
                            <p className="font-black text-xs uppercase">Foundation Materials</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{service.products?.length || 0} Assets Aggregated</p>
                        </div>
                        <span className="font-black font-mono text-sm">${productCosts.reduce((acc, p) => acc + p.cost, 0).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                    <Clock className="w-3.5 h-3.5" />
                    Fixed Foundation Allocation
                </h4>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-muted/20 p-5 rounded-[1.5rem] border-2 border-transparent hover:border-primary/10 transition-all gap-4">
                    <div className="space-y-0.5 text-left">
                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">Reserved Studio Time</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{((service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0))} Min @ ${tmhr.toFixed(2)}/hr</p>
                    </div>
                    <span className="font-black text-2xl font-mono tracking-tighter text-slate-900">${timeCost.toFixed(2)}</span>
                </div>
            </div>
        </CardContent>
         <CardFooter className="bg-primary/5 p-6 sm:p-8 border-t-2 border-primary/10">
            <div className="flex justify-between items-center w-full gap-4">
                <div className="space-y-0.5 text-left">
                    <p className="text-[10px] font-black uppercase text-primary tracking-widest">Studio Overhead Burden</p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Does not include provider labor</p>
                </div>
                <span className="font-black text-2xl sm:text-3xl font-mono tracking-tighter text-primary">${totalHardCost.toFixed(2)}</span>
            </div>
        </CardFooter>
    </Card>
  );
};


export default function ServiceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { services, appointments, staff, pricingTiers, isLoading: isInventoryLoading } = useInventory();
    const { selectedTenant } = useTenant();
    const service = useMemo(() => services.find(s => s.id === id), [services, id]);
    const tmhr = selectedTenant?.tmhr || 50;
    const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;
    const { toast } = useToast();

    const servicePerformance = useMemo(() => {
        if (!service) return null;
        const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
        const totalRevenue = bookings.reduce((acc, apt) => acc + (apt.revenue || service.price), 0);
        const uniqueClients = new Set(bookings.map(apt => apt.clientId)).size;

        return {
            totalBookings: bookings.length,
            totalRevenue: totalRevenue,
            uniqueClients: uniqueClients,
            avgRevenuePerBooking: bookings.length > 0 ? totalRevenue / bookings.length : 0,
        };
    }, [service, appointments]);
    
    const handleCopyLink = () => {
        if (!service || !selectedTenant) return;
        const bookingLink = `${window.location.origin}/book/${selectedTenant.id}/${service.id}`;
        navigator.clipboard.writeText(bookingLink);
        toast({
            title: "Booking Link Copied!",
            description: "Direct URL is ready for guest distribution.",
        });
    };

    if (isInventoryLoading) return <div className="h-screen flex items-center justify-center bg-background"><Loader className="animate-spin text-primary h-10 w-10" /></div>;
    if (!service) return notFound();

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Service Record" />
      <main className="flex-1 p-4 sm:p-6 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-1 text-left">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Treatment Record</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Service definition & yield dossier</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/services" className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm" onClick={handleCopyLink}><LinkIcon className="h-4 w-4 mr-2"/>Share Link</Button>
                <Button size="sm" className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Pencil className="h-4 w-4 mr-2" />Modify</Button>
            </div>
        </div>

        <Card className="border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all">
            <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
                <div className="relative shrink-0">
                    <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2rem] md:rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl bg-muted/20 relative flex items-center justify-center">
                        {service.imageUrl ? (
                            <Image src={service.imageUrl} alt={service.name} fill className='object-cover transition-transform duration-700' />
                        ) : (
                            <Sparkles className="w-16 h-16 md:w-24 md:h-24 text-muted-foreground/30" />
                        )}
                    </div>
                </div>
                <div className="space-y-4 flex-1 min-w-0 text-left">
                    <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3 md:gap-4">
                        <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none">{service.name}</h2>
                        <div className="flex gap-2">
                            {service.isPrivate && <Badge className="bg-muted text-muted-foreground border-none font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Private Access</Badge>}
                            <Badge variant="outline" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-2">{service.category || 'Standard'}</Badge>
                        </div>
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
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Baseline Market Rate</p>
                            <p className="text-base md:text-xl font-black uppercase tracking-tight text-slate-700">${service.price.toFixed(2)}</p>
                        </div>
                    </div>
                    <p className="text-xs md:sm font-medium text-slate-600 leading-relaxed max-w-2xl pt-2">{service.description || 'No description provided for this treatment.'}</p>
                </div>
            </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
            <div className="lg:col-span-2 xl:col-span-3 space-y-10 min-w-0 order-2 lg:order-1">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white"><CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><CalendarIcon className="w-3 h-3"/>Bookings</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{servicePerformance?.totalBookings}</p></CardContent></Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white"><CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><TrendingUp className="w-3 h-3"/>Total Yield</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">${servicePerformance?.totalRevenue.toFixed(0)}</p></CardContent></Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white"><CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Users className="w-3 h-3"/>Guests</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 font-mono">{servicePerformance?.uniqueClients}</p></CardContent></Card>
                    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white"><CardHeader className="p-4 pb-1 text-left"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Target className="w-3 h-3"/>Avg. Value</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-left"><p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono">${servicePerformance?.avgRevenuePerBooking.toFixed(0)}</p></CardContent></Card>
                </div>

                <Tabs defaultValue="architecture" className="w-full">
                    <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 overflow-x-auto scrollbar-hide">
                        <TabsTrigger value="architecture" className="flex-1 min-w-[120px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Architecture</TabsTrigger>
                        <TabsTrigger value="logistics" className="flex-1 min-w-[120px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Logistics</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="architecture" className="m-0 space-y-10 animate-in fade-in duration-500 text-left">
                        <CostBreakdown service={service} tmhr={tmhr} />
                    </TabsContent>

                    <TabsContent value="logistics" className="m-0 space-y-10 animate-in fade-in duration-500 text-left">
                        <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                            <CardHeader className="bg-muted/5 border-b p-6 sm:p-8 pb-4">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3"><MapPin className="w-4 h-4 text-primary" /> Resource Dependencies</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 sm:p-8">
                                {(service.requiredResourceIds || []).length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {(service.requiredResourceIds || []).map(rid => (
                                            <div key={rid} className="p-4 rounded-2xl bg-muted/20 border-2 flex items-center gap-4 text-left">
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

            <div className="lg:col-span-1 min-w-0 order-1 lg:order-2">
                <ProfitAnalysisCard service={service} tmhr={tmhr} staff={staff} pricingTiers={pricingTiers} taxBurden={taxBurden} />
            </div>
        </div>
      </main>
    </div>
  );
}
