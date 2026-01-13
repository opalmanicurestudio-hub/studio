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
import { ArrowLeft, Clock, DollarSign, Sparkles, Box, List, Pencil, Info, ShoppingCart, Hammer, BarChart, Users, TrendingUp, MapPin, Link as LinkIcon } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { services as initialServices, type Service, inventory as allInventory, type InventoryItem, appointments, clients } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

const ProfitAnalysisCard = ({ service, tmhr, onPriceUpdate }: { service: Service; tmhr: number; onPriceUpdate: (newPrice: number) => void; }) => {
    const [testPrice, setTestPrice] = useState(service.price);
    const { toast } = useToast();

    useEffect(() => {
        setTestPrice(service.price);
    }, [service.price]);

    const { profit, margin, breakEvenPoint } = useMemo(() => {
        const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
        const timeCost = (totalDuration / 60) * tmhr;
        
        const productCost = (service.products || []).reduce((acc, p) => acc + (p.costPerUnit || 0), 0);
        const equipmentDepreciation = (service.equipment || []).reduce((acc, eq) => {
            const lifespanInMinutes = (eq.lifespanYears || 5) * 365 * 8 * 60; // Assuming 8hr work day
            const costPerMinute = (eq.costPerUnit || 0) / lifespanInMinutes;
            return acc + (costPerMinute * totalDuration);
        }, 0);
        
        const breakEven = timeCost + productCost + equipmentDepreciation;

        const profitValue = testPrice - breakEven;
        const marginValue = testPrice > 0 ? (profitValue / testPrice) * 100 : 0;

        return { profit: profitValue, margin: marginValue, breakEvenPoint: breakEven };
    }, [service, testPrice, tmhr]);
    
    const handleUpdateClick = () => {
        onPriceUpdate(testPrice);
        toast({
            title: "Price Updated",
            description: `${service.name} price is now $${testPrice.toFixed(2)}.`,
        });
    };

  return (
    <Card className="lg:sticky top-24">
      <CardHeader>
        <CardTitle>Profit & Pricing Tester</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
            <div className="flex justify-between items-baseline">
            <Label htmlFor={`price-slider-${service.id}`}>Test Price</Label>
            <span className="font-semibold text-primary text-2xl">${testPrice.toFixed(2)}</span>
            </div>
            <Slider
            id={`price-slider-${service.id}`}
            min={0}
            max={service.price * 2 + 50}
            step={1}
            value={[testPrice]}
            onValueChange={(value) => setTestPrice(value[0])}
            />
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2">
            <div className="text-center">
                <p className="text-xs text-muted-foreground">Potential Profit</p>
                <p className={`text-lg font-bold ${profit >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                    ${profit.toFixed(2)}
                </p>
            </div>
            <div className="text-center">
                <p className="text-xs text-muted-foreground">Profit Margin</p>
                <p className={`text-lg font-bold ${margin >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                    {margin.toFixed(1)}%
                </p>
            </div>
        </div>
        <div className='text-xs text-muted-foreground space-y-0.5 text-center'>
            <p>Break-Even Point: ${breakEvenPoint?.toFixed(2)}</p>
        </div>
      </CardContent>
       <CardFooter>
            <Button className="w-full" onClick={handleUpdateClick} disabled={testPrice === service.price}>
                Update Service Price
            </Button>
        </CardFooter>
    </Card>
  );
};

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { timeCost, productCosts, equipmentCosts, totalCost } = useMemo(() => {
    const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;

    const productCosts = (service.products || []).map(p => ({
      ...p,
      cost: p.costPerUnit || 0, // This might need to be adjusted based on usage
      location: 'Back Room - Shelf A' // Mock location
    }));

    const equipmentCosts = (service.equipment || []).map(e => ({
      ...e,
      cost: (e.costPerUnit || 0) * 0.001 // Mock depreciation
    }));

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalEquipmentCost = equipmentCosts.reduce((acc, e) => acc + e.cost, 0);
    const totalCost = timeCost + totalProductCost + totalEquipmentCost;

    return { timeCost, productCosts, equipmentCosts, totalCost };
  }, [service, tmhr]);

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
                        <div className="w-8 h-8 bg-background rounded-sm flex-shrink-0">
                            <Image src={p.imageUrl || `https://picsum.photos/seed/inv${p.id}/100/100`} alt={p.name} width={32} height={32} className='rounded-sm object-cover h-full w-full' />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-xs">{p.name}</span>
                            <span className='text-xs text-muted-foreground flex items-center gap-1'><MapPin className="w-2.5 h-2.5"/>{p.location}</span>
                        </div>
                    </div>
                    <span className="font-semibold text-xs">${(p.cost || 0).toFixed(2)}</span>
                </div>
            )) : <p className="text-xs text-muted-foreground text-center p-2">No products in formula.</p>}
        </div>
        <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2"><Hammer className="w-4 h-4 text-muted-foreground"/>Equipment Depreciation</h4>
            {equipmentCosts.length > 0 ? equipmentCosts.map(e => (
                 <div key={e.id} className="flex items-center justify-between bg-muted/50 p-2 rounded-md">
                    <div className='flex items-center gap-2'>
                        <div className="w-8 h-8 bg-background rounded-sm flex-shrink-0">
                            <Image src={e.imageUrl || `https://picsum.photos/seed/inv${e.id}/100/100`} alt={e.name} width={32} height={32} className='rounded-sm object-cover h-full w-full' />
                        </div>
                        <span className="font-medium text-xs">{e.name}</span>
                    </div>
                    <span className="font-semibold text-xs">${e.cost.toFixed(2)}</span>
                </div>
            )) : <p className="text-xs text-muted-foreground text-center p-2">No equipment in formula.</p>}
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
    const [service, setService] = useState<Service | undefined>(initialServices.find(s => s.id === id));
    const [tmhr, setTmhr] = useState(0);
    const { toast } = useToast();

    useEffect(() => {
        if (typeof window !== 'undefined') {
        const storedTmhr = localStorage.getItem('tmhr');
        if (storedTmhr) {
            setTmhr(parseFloat(storedTmhr));
        }
        }
    }, []);

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
    }, [service]);
    
    const handlePriceUpdate = (newPrice: number) => {
        if (!service) return;

        const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
        const timeCost = (totalDuration / 60) * tmhr;
        const productCost = (service.products || []).reduce((acc, p) => acc + (p.costPerUnit || 0), 0);
        const equipmentDepreciation = (service.equipment || []).reduce((acc, eq) => {
            const lifespanInMinutes = (eq.lifespanYears || 5) * 365 * 8 * 60;
            const costPerMinute = (eq.costPerUnit || 0) / lifespanInMinutes;
            return acc + (costPerMinute * totalDuration);
        }, 0);
        const breakEvenCost = timeCost + productCost + equipmentDepreciation;
        const newProfit = newPrice - breakEvenCost;
        const newMargin = newPrice > 0 ? (newProfit / newPrice) * 100 : 0;

        setService(prevService => prevService ? {
            ...prevService,
            price: newPrice,
            profit: newProfit,
            margin: newMargin,
        } : undefined);
    };
    
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
    const profitPercentage = service.price > 0 ? (service.profit / service.price) * 100 : 0;
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
                            <div className="w-32 h-32 bg-muted rounded-lg flex-shrink-0">
                                <Image 
                                    src={service.imageUrl || `https://picsum.photos/seed/svc${service.id}/200/200`} 
                                    alt={service.name} 
                                    width={128} 
                                    height={128} 
                                    className='rounded-lg object-cover h-full w-full' 
                                    data-ai-hint="manicure nails" 
                                />
                            </div>
                            <div className="flex-1 space-y-2">
                                <h1 className="text-3xl font-bold">{service.name}</h1>
                                <div className="flex items-center gap-4 text-muted-foreground">
                                    <div className="flex items-center gap-2"><Clock className="w-4 h-4" /> {service.duration} min {totalPadding > 0 && `(+${totalPadding} pad)`}</div>
                                    <div className="flex items-center gap-2"><DollarSign className="w-4 h-4" /> ${service.price.toFixed(2)}</div>
                                </div>
                                <p className="text-sm pt-2">{service.description || 'No description provided.'}</p>
                            </div>
                        </div>
                         <Separator className="my-6" />
                         <div className="space-y-2">
                            <Progress value={profitPercentage} className={`h-2 ${service.profit >= 0 ? 'text-green-500' : 'text-destructive'}`} />
                            <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground">Price</p>
                                    <p className="font-semibold text-lg">${service.price.toFixed(2)}</p>
                                </div>
                                <div className='text-center'>
                                    <p className="text-muted-foreground">Cost</p>
                                    <p className="font-semibold text-lg text-destructive">${service.cost.toFixed(2)}</p>
                                </div>
                                <div className='text-right'>
                                    <p className="text-muted-foreground">Profit</p>
                                    <p className={`font-semibold text-lg ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
                                </div>
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
                <ProfitAnalysisCard service={service} tmhr={tmhr} onPriceUpdate={handlePriceUpdate} />
            </div>
        </div>
      </main>
    </div>
  );
}
