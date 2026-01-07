'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Clock, DollarSign, Sparkles, Box } from 'lucide-react';
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
import { services, type Service } from '@/lib/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';


const TMHR = 45; // True Minimum Hourly Rate (mock)
const PRODUCT_COST = 15; // Mock product cost

const ServiceCard = ({ service, onProfitTesterOpen }: { service: Service, onProfitTesterOpen: (service: Service) => void }) => {
  const profitPercentage = service.price > 0 ? (service.profit / service.price) * 100 : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-24 h-24 bg-muted rounded-md flex-shrink-0">
             <Image src={`https://picsum.photos/seed/svc${service.id}/100/100`} alt={service.name} width={96} height={96} className='rounded-md' data-ai-hint="manicure nails" />
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
                  <DropdownMenuItem>Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onProfitTesterOpen(service)}>
                    Profit Tester
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {service.duration} min <span className='text-muted-foreground/50'>(+20 pad)</span></p>
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


export default function ServicesPage() {
  const [isProfitTesterOpen, setIsProfitTesterOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [testPrice, setTestPrice] = useState(0);

  const handleOpenProfitTester = (service: Service) => {
    setSelectedService(service);
    setTestPrice(service.price);
    setIsProfitTesterOpen(true);
  };

  const { profit, margin } = useMemo(() => {
    if (!selectedService) return { profit: 0, margin: 0 };
    const timeCost = (selectedService.duration / 60) * TMHR;
    const totalCost = timeCost + PRODUCT_COST;
    const profitValue = testPrice - totalCost;
    const marginValue = testPrice > 0 ? (profitValue / testPrice) * 100 : 0;
    return { profit: profitValue, margin: marginValue };
  }, [selectedService, testPrice]);
  
  const mainServices = services.filter(s => s.type === 'service');
  const addOnServices = services.filter(s => s.type === 'addon');
  
  const servicesByCategory = mainServices.reduce((acc, service) => {
    if (!acc[service.category]) {
      acc[service.category] = [];
    }
    acc[service.category].push(service);
    return acc;
  }, {} as Record<string, Service[]>);

  const addOnsByCategory = addOnServices.reduce((acc, service) => {
    if (!acc[service.category]) {
      acc[service.category] = [];
    }
    acc[service.category].push(service);
    return acc;
  }, {} as Record<string, Service[]>);


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Services" />
      <main className="flex-1 p-4 md:p-8">
        <Tabs defaultValue="services">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <TabsList className="grid w-full grid-cols-2 sm:w-auto">
                <TabsTrigger value="services">Services</TabsTrigger>
                <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
              </TabsList>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                New Service
              </Button>
            </div>
          </div>
          <TabsContent value="services" className="mt-6 space-y-8">
            {Object.entries(servicesByCategory).map(([category, services]) => (
                <ServiceCategory key={category} title={category} services={services} onProfitTesterOpen={handleOpenProfitTester} />
            ))}
          </TabsContent>
           <TabsContent value="add-ons" className="mt-6 space-y-8">
             {addOnServices.length > 0 ? (
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
                min={selectedService ? selectedService.cost : 0}
                max={(selectedService ? selectedService.price : 0) * 2}
                step={1}
                value={[testPrice]}
                onValueChange={(value) => setTestPrice(value[0])}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Potential Profit</p>
                <p className={`text-2xl font-bold ${profit >= 0 ? 'text-green-500' : 'text-destructive'}`}>${profit.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className={`text-2xl font-bold ${margin >= 0 ? 'text-green-500' : 'text-destructive'}`}>{margin.toFixed(1)}%</p>
              </div>
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
    </div>
  );
}
