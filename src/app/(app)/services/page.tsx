
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Clock, DollarSign, Sparkles, Box, List, Pencil, Search, SlidersHorizontal, Info, ShoppingCart, Hammer, FileText, BarChart, Users, TrendingUp, MapPin } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { services as initialServices, type Service, inventory as allInventory, type InventoryItem, type Appointment } from '@/lib/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { AddServiceDialog } from '@/components/services/AddServiceDialog';
import { EditServiceDialog } from '@/components/services/EditServiceDialog';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';

const InlineProfitTester = ({ service, tmhr }: { service: Service, tmhr: number }) => {
  const [testPrice, setTestPrice] = useState(service.price);

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
    
    const breakEvenPoint = timeCost + productCost + equipmentDepreciation;

    const profitValue = testPrice - breakEvenPoint;
    const marginValue = testPrice > 0 ? (profitValue / testPrice) * 100 : 0;

    return { profit: profitValue, margin: marginValue, breakEvenPoint };
  }, [service, testPrice, tmhr]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <Label htmlFor={`price-slider-${service.id}`}>Test Price</Label>
          <span className="font-semibold text-primary">${testPrice.toFixed(2)}</span>
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
       <div className='text-[10px] text-muted-foreground space-y-0.5 text-center'>
          <p>Break-Even: ${breakEvenPoint?.toFixed(2)}</p>
       </div>
    </div>
  );
};

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { timeCost, productCosts, equipmentCosts, totalCost } = useMemo(() => {
    const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;

    const productCosts = (service.products || []).map(p => ({
      ...p,
      cost: p.costPerUnit || 0,
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
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground"/>Time Cost</h4>
        <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md">
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
      <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
        <span>Total Service Cost (Break-Even):</span>
        <span>${totalCost.toFixed(2)}</span>
      </div>
    </div>
  );
};


const ServiceCard = ({ service, onEditServiceOpen, tmhr, appointments }: { service: Service, onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null }) => {
  const profitPercentage = service.price > 0 ? (service.profit / service.price) * 100 : 0;
  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  
  const performance = useMemo(() => {
    if (!appointments) return { totalBookings: 0, totalRevenue: 0, uniqueClients: 0 };
    const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
    const totalRevenue = bookings.length * service.price;
    const uniqueClients = new Set(bookings.map(apt => apt.clientId)).size;
    return {
        totalBookings: bookings.length,
        totalRevenue,
        uniqueClients
    };
  }, [service.id, service.price, appointments]);


  return (
    <Card className="overflow-hidden w-full max-w-[340px] shrink-0 transition-all duration-200 hover:shadow-xl hover:-translate-y-1">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start gap-3">
          <Link href={`/services/${service.id}`} className="w-16 h-16 bg-muted rounded-md flex-shrink-0">
             <Image 
                src={service.imageUrl || `https://picsum.photos/seed/svc${service.id}/200/200`} 
                alt={service.name} 
                width={64} 
                height={64} 
                className='rounded-md object-cover h-full w-full' 
                data-ai-hint="manicure nails" 
            />
          </Link>
          <div className="flex-1 space-y-1">
            <div className="flex justify-between items-start">
              <Link href={`/services/${service.id}`} className="font-semibold text-sm hover:underline">{service.name}</Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-1 h-8 w-8 flex-shrink-0'>
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEditServiceOpen(service)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" /> {service.duration} min {totalPadding > 0 && <span className='text-muted-foreground/50'>(+{totalPadding} pad)</span>}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Deposit</p>
          </div>
        </div>
        
        <div className="space-y-1.5">
            <Progress value={profitPercentage} className={`h-1.5 ${service.profit >= 0 ? 'text-green-500' : 'text-destructive'}`} />
            <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                    <p className="text-muted-foreground">Price</p>
                    <p className="font-semibold text-sm">${service.price.toFixed(2)}</p>
                </div>
                 <div className='text-center'>
                    <p className="text-muted-foreground">Cost</p>
                    <p className="font-semibold text-sm text-destructive">${service.cost.toFixed(2)}</p>
                </div>
                 <div className='text-right'>
                    <p className="text-muted-foreground">Profit</p>
                    <p className={`font-semibold text-sm ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
                </div>
            </div>
        </div>

        <Accordion type="multiple" className="w-full">
            <AccordionItem value="performance" className="border-b-0">
                <AccordionTrigger className='p-2.5 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                    <div className='flex items-center gap-2'>
                        <BarChart className='w-4 h-4 text-primary' /> Performance
                    </div>
                </AccordionTrigger>
                <AccordionContent className='pt-4 text-sm'>
                    <div className='grid grid-cols-3 gap-2'>
                        <div className='text-center p-2 rounded-md bg-background'>
                            <p className='text-xs text-muted-foreground'>Bookings</p>
                            <p className='font-bold text-lg'>{performance.totalBookings}</p>
                        </div>
                        <div className='text-center p-2 rounded-md bg-background'>
                            <p className='text-xs text-muted-foreground'>Revenue</p>
                            <p className='font-bold text-base'>${performance.totalRevenue.toFixed(2)}</p>
                        </div>
                         <div className='text-center p-2 rounded-md bg-background'>
                            <p className='text-xs text-muted-foreground'>Clients</p>
                            <p className='font-bold text-lg'>{performance.uniqueClients}</p>
                        </div>
                    </div>
                </AccordionContent>
            </AccordionItem>
             <AccordionItem value="profit-tester" className="border-b-0 mt-2">
                <AccordionTrigger className='p-2.5 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                    <div className='flex items-center gap-2'>
                        <Sparkles className='w-4 h-4 text-primary' /> Profit Tester
                    </div>
                </AccordionTrigger>
                <AccordionContent className='pt-4'>
                    <InlineProfitTester service={service} tmhr={tmhr} />
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="cost-breakdown" className="border-b-0 mt-2">
                <AccordionTrigger className='p-2.5 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                    <div className='flex items-center gap-2'>
                        <FileText className='w-4 h-4 text-primary' /> Cost Breakdown
                    </div>
                </AccordionTrigger>
                <AccordionContent className='pt-4'>
                    <CostBreakdown service={service} tmhr={tmhr} />
                </AccordionContent>
            </AccordionItem>
        </Accordion>

      </CardContent>
    </Card>
  );
};

const ServiceCategory = ({ title, services, onEditServiceOpen, tmhr, appointments }: { title: string, services: Service[], onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null }) => {
    if (services.length === 0) return null;
    return (
        <Accordion type="single" collapsible defaultValue="item-1">
            <AccordionItem value="item-1">
                <AccordionTrigger className="text-xl font-bold hover:no-underline">
                    {title}
                </AccordionTrigger>
                <AccordionContent>
                    <div className="flex flex-wrap gap-6 pt-4">
                        {services.map((service) => (
                            <ServiceCard key={service.id} service={service} onEditServiceOpen={onEditServiceOpen} tmhr={tmhr} appointments={appointments} />
                        ))}
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    )
}

const EmptyState = ({ onAddNewService }: { onAddNewService: () => void }) => (
    <Card className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <CardContent className='space-y-4'>
            <div className='flex justify-center'>
                 <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                    <List className='w-10 h-10 text-muted-foreground' />
                 </div>
            </div>
            <h3 className="text-2xl font-semibold">Build Your Service Menu</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
                This is where your services will live. Add your first service to calculate its profitability and build your client-facing menu.
            </p>
            <Button className='mt-4' onClick={onAddNewService}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add New Service
            </Button>
        </CardContent>
    </Card>
)


export default function ServicesPage() {
  const [services, setServices] = useState(initialServices);
  const [isAddServiceDialogOpen, setIsAddServiceDialogOpen] = useState(false);
  const [isEditServiceDialogOpen, setIsEditServiceDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [tmhr, setTmhr] = useState(0);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const { firestore, user, isUserLoading } = useFirebase();
  const tenantId = 'tenant-abc';
  const appointmentsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'appointments');
  }, [firestore, user, isUserLoading, tenantId]);

  const { data: appointments, isLoading: areAppointmentsLoading } = useCollection<Appointment>(appointmentsQuery);


  useEffect(() => {
    // This code now runs only on the client, after the initial render.
    const storedTmhr = localStorage.getItem('tmhr');
    if (storedTmhr) {
      setTmhr(parseFloat(storedTmhr));
    }
  }, []); // The empty dependency array ensures this runs only once on mount.

  const handleOpenEditService = (service: Service) => {
    setSelectedService(service);
    setIsEditServiceDialogOpen(true);
  };
  
  const filteredServices = useMemo(() => {
    return services.filter(service =>
      service.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [services, searchTerm]);

  const mainServices = filteredServices.filter(s => s.type === 'service');
  const addOnServices = filteredServices.filter(s => s.type === 'addon');
  
  const servicesByCategory = useMemo(() => mainServices.reduce((acc, service) => {
    const category = service.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>), [mainServices]);

  const addOnsByCategory = useMemo(() => addOnServices.reduce((acc, service) => {
    const category = service.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>), [addOnServices]);
  
  const [serviceCategories, setServiceCategories] = useState(() => {
      const allCategories = initialServices.map(s => s.category).filter((c): c is string => !!c);
      return [...new Set(allCategories)];
  });

  const handleNewCategory = (newCategory: string) => {
    if (!serviceCategories.includes(newCategory)) {
        setServiceCategories(prev => [...prev, newCategory]);
    }
  };
  
  const handleAddNewService = (newService: Service) => {
    setServices(prev => [...prev, newService]);
    if (newService.category && !serviceCategories.includes(newService.category)) {
      setServiceCategories(prev => [...prev, newService.category as string]);
    }
  };

  const handleUpdateService = (updatedService: Service) => {
    setServices(prev => prev.map(s => s.id === updatedService.id ? updatedService : s));
    if (updatedService.category && !serviceCategories.includes(updatedService.category)) {
      setServiceCategories(prev => [...prev, updatedService.category as string]);
    }
    toast({
        title: "Service Updated",
        description: `${updatedService.name} has been updated successfully.`
    })
  };


  return (
    <div className="w-full">
      <AppHeader title="Services" />
      <main className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
                <h1 className="text-3xl font-bold">Service Library</h1>
                <p className="text-muted-foreground">Your menu builder and profitability calculator.</p>
            </div>
            <Button onClick={() => setIsAddServiceDialogOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Service
            </Button>
        </div>

         <Card className="mb-6">
            <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className='flex-1'>
                    <h3 className="font-semibold">Your Default TMHR</h3>
                    <p className="text-xs text-muted-foreground">
                        This is the default hourly rate used for profit calculations.
                    </p>
                    <p className="text-2xl font-bold text-primary">${tmhr.toFixed(2)}<span className="text-base font-medium text-muted-foreground">/hr</span></p>
                </div>
                <Button variant="secondary" asChild>
                    <Link href="/financials">Change Rate</Link>
                </Button>
            </CardContent>
        </Card>
        
        <div className='flex flex-col md:flex-row gap-4 mb-6'>
            <div className="relative w-full md:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search services..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <div className='flex items-center gap-2 w-full md:w-auto'>
                <Button variant="outline" className='w-full'><SlidersHorizontal className="mr-2 h-4 w-4" /> Filters</Button>
            </div>
        </div>

        <Tabs defaultValue="services">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-2">
                <TabsTrigger value="services">Services</TabsTrigger>
                <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
            </TabsList>
          <TabsContent value="services" className="mt-6 space-y-8">
            {Object.keys(servicesByCategory).length > 0 ? (
                Object.entries(servicesByCategory).map(([category, services]) => (
                    <ServiceCategory key={category} title={category} services={services} onEditServiceOpen={handleOpenEditService} tmhr={tmhr} appointments={appointments} />
                ))
            ) : <EmptyState onAddNewService={() => setIsAddServiceDialogOpen(true)} />}
          </TabsContent>
           <TabsContent value="add-ons" className="mt-6 space-y-8">
             {Object.keys(addOnsByCategory).length > 0 ? (
                Object.entries(addOnsByCategory).map(([category, services]) => (
                    <ServiceCategory key={category} title={category} services={services} onEditServiceOpen={handleOpenEditService} tmhr={tmhr} appointments={appointments} />
                ))
             ) : (
                <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No add-on services yet. Add one to get started.</p>
                    </CardContent>
                </Card>
             )}
          </TabsContent>
        </Tabs>
      </main>

      <AddServiceDialog 
        open={isAddServiceDialogOpen} 
        onOpenChange={setIsAddServiceDialogOpen}
        categories={serviceCategories}
        onNewCategory={handleNewCategory}
        onServiceAdded={handleAddNewService}
      />
      {selectedService && (
        <EditServiceDialog 
            open={isEditServiceDialogOpen}
            onOpenChange={setIsEditServiceDialogOpen}
            service={selectedService}
            categories={serviceCategories}
            onNewCategory={handleNewCategory}
            onServiceUpdated={handleUpdateService}
        />
      )}
    </div>
  );
}

