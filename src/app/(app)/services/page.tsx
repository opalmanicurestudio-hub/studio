
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
import { MoreHorizontal, PlusCircle, Clock, DollarSign, Sparkles, Box, List, Pencil, Search, SlidersHorizontal, Info } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { services as initialServices, type Service } from '@/lib/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { AddServiceDialog } from '@/components/services/AddServiceDialog';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';


const ServiceCard = ({ service, onProfitTesterOpen }: { service: Service, onProfitTesterOpen: (service: Service) => void }) => {
  const profitPercentage = service.price > 0 ? (service.profit / service.price) * 100 : 0;
  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);

  return (
    <Card className="overflow-hidden w-full max-w-sm shrink-0">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-24 h-24 bg-muted rounded-md flex-shrink-0">
             <Image 
                src={service.imageUrl || `https://picsum.photos/seed/svc${service.id}/100/100`} 
                alt={service.name} 
                width={96} 
                height={96} 
                className='rounded-md object-cover h-full w-full' 
                data-ai-hint="manicure nails" 
            />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex justify-between items-start">
              <h3 className="font-semibold text-lg">{service.name}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-1 h-8 w-8 flex-shrink-0'>
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onProfitTesterOpen(service)}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Profit Tester
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {service.duration} min {totalPadding > 0 && <span className='text-muted-foreground/50'>(+{totalPadding} pad)</span>}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Deposit</p>
          </div>
        </div>
        
        <div className="space-y-2">
            <Progress value={profitPercentage} className={`h-2 ${service.profit >= 0 ? 'text-green-500' : 'text-destructive'}`} />
            <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                    <p className="text-muted-foreground">Price</p>
                    <p className="font-semibold text-base">${service.price.toFixed(2)}</p>
                </div>
                 <div className='text-center'>
                    <p className="text-muted-foreground">Cost</p>
                    <p className="font-semibold text-base text-destructive">${service.cost.toFixed(2)}</p>
                </div>
                 <div className='text-right'>
                    <p className="text-muted-foreground">Profit</p>
                    <p className={`font-semibold text-base ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
                </div>
            </div>
        </div>

        <Accordion type="multiple" className="w-full">
            <AccordionItem value="profit-tester" className="border-b-0">
                <AccordionTrigger className='p-3 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                    <div className='flex items-center gap-2'>
                        <Sparkles className='w-4 h-4 text-primary' /> Profit Tester
                    </div>
                </AccordionTrigger>
                <AccordionContent className='pt-4'>
                    <p className='text-sm text-center text-muted-foreground'>Use the profit tester by opening the dialog.</p>
                </AccordionContent>
            </AccordionItem>
             <AccordionItem value="cost-breakdown" className="border-b-0 mt-2">
                <AccordionTrigger className='p-3 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                     <div className='flex items-center gap-2'>
                        <Box className='w-4 h-4 text-primary' /> Cost Breakdown
                    </div>
                </AccordionTrigger>
                <AccordionContent className='p-4 text-sm text-muted-foreground'>
                    Cost breakdown details will be shown here.
                </AccordionContent>
            </AccordionItem>
        </Accordion>

      </CardContent>
    </Card>
  );
};

const ServiceCategory = ({ title, services, onProfitTesterOpen }: { title: string, services: Service[], onProfitTesterOpen: (service: Service) => void }) => {
    return (
        <Accordion type="single" collapsible defaultValue="item-1">
            <AccordionItem value="item-1">
                <AccordionTrigger className="text-xl font-bold hover:no-underline">
                    {title}
                </AccordionTrigger>
                <AccordionContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
                        {services.map((service) => (
                            <ServiceCard key={service.id} service={service} onProfitTesterOpen={onProfitTesterOpen} />
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
  const [isProfitTesterOpen, setIsProfitTesterOpen] = useState(false);
  const [isAddServiceDialogOpen, setIsAddServiceDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [testPrice, setTestPrice] = useState(0);
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

  const handleOpenProfitTester = (service: Service) => {
    setSelectedService(service);
    setTestPrice(service.price);
    setIsProfitTesterOpen(true);
  };

  const profitability = useMemo(() => {
    if (!selectedService) return { profit: 0, margin: 0, breakEvenPoint: 0, timeCost: 0 };
    
    const totalDuration = (selectedService.duration || 0) + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;
    const productCost = selectedService.cost - timeCost; // cost on service is already total, so we subtract timecost to get product cost
    
    const breakEvenPoint = timeCost + productCost;

    const profitValue = testPrice - breakEvenPoint;
    const marginValue = testPrice > 0 ? (profitValue / testPrice) * 100 : 0;

    return { profit: profitValue, margin: marginValue, breakEvenPoint, timeCost };
  }, [selectedService, testPrice, tmhr]);
  
  const mainServices = services.filter(s => s.type === 'service');
  const addOnServices = services.filter(s => s.type === 'addon');
  
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
  
  const initialCategories = useMemo(() => {
    const allCategories = initialServices.map(s => s.category).filter((c): c is string => !!c);
    return [...new Set(allCategories)];
  }, []);

  const [serviceCategories, setServiceCategories] = useState(initialCategories);

  const handleNewCategory = (newCategory: string) => {
    if (!serviceCategories.includes(newCategory)) {
        setServiceCategories(prev => [...prev, newCategory]);
    }
  };
  
  const handleAddNewService = (newService: Service) => {
    setServices(prev => [...prev, newService]);
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Services" />
      <main className="flex-1 p-4 md:p-8">
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

        <div className='flex flex-col md:flex-row gap-4 mb-6'>
            <div className="relative w-full md:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search services..." className="pl-9" />
            </div>
            <div className='flex items-center gap-2 w-full md:w-auto'>
                <Button variant="outline" className='w-full'><SlidersHorizontal className="mr-2 h-4 w-4" /> Filters</Button>
            </div>
        </div>
        
        <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Your Default TMHR</CardTitle>
                    <CardDescription>
                        This is the default hourly rate used for profit calculations.
                    </CardDescription>
                </div>
                <Button variant="secondary" asChild>
                    <Link href="/financials">Change Rate</Link>
                </Button>
            </CardHeader>
            <CardContent>
                <p className="text-4xl font-bold text-primary">${tmhr.toFixed(2)}<span className="text-lg font-medium text-muted-foreground">/hr</span></p>
            </CardContent>
        </Card>

        <Tabs defaultValue="services">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto">
                <TabsTrigger value="services">Services</TabsTrigger>
                <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
            </TabsList>
          <TabsContent value="services" className="mt-6 space-y-8">
            {Object.keys(servicesByCategory).length > 0 ? (
                Object.entries(servicesByCategory).map(([category, services]) => (
                    <ServiceCategory key={category} title={category} services={services} onProfitTesterOpen={handleOpenProfitTester} />
                ))
            ) : <EmptyState onAddNewService={() => setIsAddServiceDialogOpen(true)} />}
          </TabsContent>
           <TabsContent value="add-ons" className="mt-6 space-y-8">
             {Object.keys(addOnsByCategory).length > 0 ? (
                Object.entries(addOnsByCategory).map(([category, services]) => (
                    <ServiceCategory key={category} title={category} services={services} onProfitTesterOpen={handleOpenProfitTester} />
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

      <Dialog
        open={isProfitTesterOpen}
        onOpenChange={setIsProfitTesterOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profit Tester</DialogTitle>
            <DialogDescription>
              Adjust the price for &quot;{selectedService?.name}&quot; to see potential profit.
              (Using TMHR of <span className='font-bold'>${tmhr.toFixed(2)}/hr</span>)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-8 py-4">
            <div className="space-y-4">
              <div className="flex justify-between items-baseline">
                <Label htmlFor="price-slider">Service Price</Label>
                <span className="text-2xl font-bold text-primary">${testPrice.toFixed(2)}</span>
              </div>
              <Slider
                id="price-slider"
                min={0}
                max={(selectedService ? selectedService.price : 0) * 2 + 50}
                step={1}
                value={[testPrice]}
                onValueChange={(value) => setTestPrice(value[0])}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Potential Profit</p>
                <p className={`text-2xl font-bold ${profitability.profit >= 0 ? 'text-green-500' : 'text-destructive'}`}>${profitability.profit.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className={`text-2xl font-bold ${profitability.margin >= 0 ? 'text-green-500' : 'text-destructive'}`}>{profitability.margin.toFixed(1)}%</p>
              </div>
            </div>
             <div className='text-xs text-muted-foreground space-y-1 text-center'>
                <p>Break-Even Point (Time + Products): ${profitability.breakEvenPoint?.toFixed(2) || '0.00'}</p>
                <p>Time Cost ({(selectedService?.duration || 0) + (selectedService?.padBefore || 0) + (selectedService?.padAfter || 0)} min): ${profitability.timeCost?.toFixed(2) || '0.00'}</p>
             </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsProfitTesterOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddServiceDialog 
        open={isAddServiceDialogOpen} 
        onOpenChange={setIsAddServiceDialogOpen}
        categories={serviceCategories}
        onNewCategory={handleNewCategory}
        onServiceAdded={handleAddNewService}
      />
    </div>
  );

    




