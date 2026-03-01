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
import { ArrowLeft, Clock, DollarSign, Sparkles, Box, List, Pencil, Info, ShoppingCart, Hammer, BarChart, Users, TrendingUp, MapPin, Link as LinkIcon, AlertTriangle } from 'lucide-react';
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
        <Card className="lg:sticky top-24 border-2">
            <CardHeader>
                <CardTitle>Profitability Engine</CardTitle>
                <CardDescription>
                    Analysis based on your <strong>${tmhr.toFixed(2)}/hr</strong> TMHR.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-destructive/5 border-2 border-destructive/10 space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="w-3 h-3" />
                        Breakeven Cost
                    </p>
                    <div className="flex justify-between items-baseline">
                        <span className="text-3xl font-black text-destructive">${cost.toFixed(2)}</span>
                        <span className="text-xs text-muted-foreground">per service</span>
                    </div>
                    <div className="space-y-1 text-[11px] pt-2 border-t border-destructive/10">
                        <div className="flex justify-between"><span>Time Cost ({service.duration}m):</span> <span>${timeCost.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Product Cost:</span> <span>${productCost.toFixed(2)}</span></div>
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tier Performance</p>
                    {tierAnalysis.map(tier => (
                        <div key={tier.name} className={cn("p-3 rounded-xl border-2 transition-all", tier.profit >= 0 ? "bg-primary/5 border-primary/10" : "bg-red-50 border-red-200")}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-black uppercase tracking-tight">{tier.name}</span>
                                {tier.profit < 0 && <Badge variant="destructive" className="h-4 text-[8px] uppercase animate-pulse">Loss</Badge>}
                            </div>
                            <div className="flex justify-between items-baseline">
                                <span className="text-xs font-bold text-muted-foreground">Price: ${tier.price.toFixed(2)}</span>
                                <span className={cn("font-black text-sm", tier.profit >= 0 ? "text-primary" : "text-destructive")}>
                                    ${tier.profit.toFixed(2)} ({tier.margin.toFixed(0)}%)
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
            {tierAnalysis.some(t => t.profit < 0) && (
                <CardFooter className="p-4 bg-red-50 rounded-b-lg border-t border-red-100">
                    <div className="flex gap-3 text-xs text-red-800">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>One or more tiers are priced below your <strong>TMHR Breakeven</strong>. Adjust prices to ensure studio profitability.</p>
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
        location: 'Back Room - Shelf A' // Mock location
      }
    });

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalCost = timeCost + totalProductCost;

    return { timeCost, productCosts, totalCost };
  }, [service, tmhr, inventory]);

  return (
    <Card>
        <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
            <CardDescription>The true cost to perform this service once.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground"/>Time Cost</h4>
            <div className="flex justify-between items-center bg-muted/50 p-3 rounded-md">
                <span>Your TMHR @ {((service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0))} min</span>
                <span className="font-semibold">${timeCost.toFixed(2)}</span>
            </div>
        </div>
        <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-muted-foreground"/>Product Costs</h4>
            {productCosts.length > 0 ? productCosts.map(p => (
                 <div key={p.id} className="flex items-center justify-between bg-muted/50 p-2 rounded-md">
                    <div className='flex items-center gap-2'>
                        <div className="w-8 h-8 bg-background rounded-sm flex-shrink-0 flex items-center justify-center">
                            {p.imageUrl ? (
                                <Image src={p.imageUrl} alt={p.name} width={32} height={32} className='rounded-sm object-cover h-full w-full' />
                            ) : (
                                <Box className="w-5 h-5 text-muted-foreground" />
                            )}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-xs">{p.name}</span>
                            <span className='text-xs text-muted-foreground flex items-center gap-1'><MapPin className="w-2.5 h-2.5"/>{p.location}</span>
                        </div>
                    </div>
                    <span className="font-semibold text-xs">${(p.cost || 0).toFixed(3)}</span>
                </div>
            )) : <p className="text-xs text-muted-foreground text-center p-2">No products in formula.</p>}
        </div>
        </CardContent>
         <CardFooter className="bg-muted/50 p-4">
            <div className="flex justify-between font-bold text-base w-full">
                <span>Total Service Cost (Break-Even):</span>
                <span>${totalCost.toFixed(2)}</span>
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
        const totalRevenue = bookings.length * service.price;
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
        const bookingLink = `https://book.clarityflow.app/${service.id}`;
        navigator.clipboard.writeText(bookingLink);
        toast({
            title: "Booking Link Copied!",
            description: "You can now share this direct link with your clients.",
        });
    };


    if (!service) {
        return notFound();
    }
    const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Service Details" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
            <Button variant="outline" asChild>
                <Link href="/services">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Services
                </Link>
            </Button>
            <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleCopyLink}><LinkIcon className="mr-2"/> Copy Booking Link</Button>
                <Button>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Service
                </Button>
            </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 space-y-6">
                <Card>
                    <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row items-start gap-6">
                            <div className="w-32 h-32 bg-muted rounded-lg flex-shrink-0 flex items-center justify-center">
                                {service.imageUrl ? (
                                    <Image 
                                        src={service.imageUrl} 
                                        alt={service.name} 
                                        width={128} 
                                        height={128} 
                                        className='rounded-lg object-cover h-full w-full' 
                                        data-ai-hint="manicure nails" 
                                    />
                                ) : (
                                    <List className="w-16 h-16 text-muted-foreground" />
                                )}
                            </div>
                            <div className="flex-1 space-y-2">
                                <h1 className="text-3xl font-bold">{service.name}</h1>
                                <div className="flex items-center gap-4 text-muted-foreground">
                                    <div className="flex items-center gap-2"><Clock className="w-4 h-4" /> {service.duration} min {totalPadding > 0 && `(+${totalPadding} pad)`}</div>
                                </div>
                                <p className="text-sm pt-2">{service.description || 'No description provided.'}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                
                <Tabs defaultValue="performance">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="performance">Performance</TabsTrigger>
                        <TabsTrigger value="formula">Formula</TabsTrigger>
                    </TabsList>
                    <TabsContent value="performance" className="mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>All-Time Performance</CardTitle>
                            </CardHeader>
                             <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="p-4 bg-muted/50 rounded-lg">
                                    <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><BarChart className="w-4 h-4" /> Total Bookings</div>
                                    <div className="text-3xl font-bold">{servicePerformance?.totalBookings}</div>
                                </div>
                                 <div className="p-4 bg-muted/50 rounded-lg">
                                    <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Total Revenue</div>
                                    <div className="text-3xl font-bold">${servicePerformance?.totalRevenue.toFixed(2)}</div>
                                </div>
                                 <div className="p-4 bg-muted/50 rounded-lg">
                                    <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Unique Clients</div>
                                    <div className="text-3xl font-bold">{servicePerformance?.uniqueClients}</div>
                                </div>
                                 <div className="p-4 bg-muted/50 rounded-lg">
                                    <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" /> Avg. Revenue</div>
                                    <div className="text-3xl font-bold">${servicePerformance?.avgRevenuePerBooking.toFixed(2)}</div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="formula" className="mt-4">
                        <CostBreakdown service={service} tmhr={tmhr} />
                    </TabsContent>
                </Tabs>

            </div>
            <div className="lg:col-span-1">
                <ProfitAnalysisCard service={service} tmhr={tmhr} />
            </div>
        </div>
      </main>
    </div>
  );
}
