

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

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { inventory } = useInventory();
  const { timeCost, productCosts, equipmentCosts, totalCost } = useMemo(() => {
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

    const equipmentCosts = (service.requiredResourceIds || []).map(resourceId => {
        const equipmentItem = inventory.find(i => i.id === resourceId && i.type === 'equipment');
        if (!equipmentItem || !equipmentItem.lifespanYears || equipmentItem.lifespanYears === 0) {
            return {
                id: resourceId,
                name: equipmentItem?.name || 'Unknown Equipment',
                cost: 0,
                imageUrl: equipmentItem?.imageUrl
            };
        }

        const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
        const annualDepreciation = (equipmentItem.costPerUnit || 0) / equipmentItem.lifespanYears;
        const hourlyDepreciation = annualDepreciation / 2080; // Assuming 2080 work hours per year
        const serviceDurationHours = totalDuration / 60;
        const depreciationForService = hourlyDepreciation * serviceDurationHours;
        
        return {
            id: resourceId,
            name: equipmentItem.name,
            cost: depreciationForService,
            imageUrl: equipmentItem.imageUrl
        };
    });

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalEquipmentCost = equipmentCosts.reduce((acc, e) => acc + e.cost, 0);
    const totalCost = timeCost + totalProductCost; // Removed equipment cost

    return { timeCost, productCosts, equipmentCosts, totalCost };
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

    const sortedTiers = useMemo(() => {
        if (!service.pricingTiers || service.pricingTiers.length === 0) {
            return [];
        }
        const tierOrder = ['apprentice', 'junior', 'senior', 'master'];
        return [...service.pricingTiers].sort((a,b) => tierOrder.indexOf(a.level) - tierOrder.indexOf(b.level));
    }, [service.pricingTiers]);

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

        <div className="space-y-6">
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
                     <Separator className="my-6" />
                     <div className="space-y-4">
                         <h4 className="font-medium">Pricing Tiers</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {sortedTiers.map(tier => (
                                <div key={tier.level} className="p-3 rounded-lg bg-muted/50 text-center">
                                    <p className="text-sm capitalize text-muted-foreground">{tier.level}</p>
                                    <p className="text-2xl font-bold">${tier.price.toFixed(2)}</p>
                                </div>
                            ))}
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
      </main>
    </div>
  );
}
