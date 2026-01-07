
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle } from 'lucide-react';
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

const TMHR = 45; // True Minimum Hourly Rate (mock)
const PRODUCT_COST = 15; // Mock product cost

const ServiceCard = ({ service, onProfitTesterOpen }: { service: Service, onProfitTesterOpen: (service: Service) => void }) => {
  const profitPercentage = service.price > 0 ? (service.profit / service.price) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{service.name}</CardTitle>
            <CardDescription>{service.duration} min</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-2'>
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
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
            <Progress value={profitPercentage} className={`h-2 ${service.profit >= 0 ? 'text-green-500' : 'text-destructive'}`} />
            <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <p className="text-muted-foreground">Price</p>
                    <p className="font-semibold">${service.price.toFixed(2)}</p>
                </div>
                 <div className='text-right'>
                    <p className="text-muted-foreground">Est. Profit</p>
                    <p className={`font-semibold ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
};


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
          <TabsContent value="services" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {services.map((service) => (
                <ServiceCard key={service.id} service={service} onProfitTesterOpen={handleOpenProfitTester} />
              ))}
            </div>
          </TabsContent>
           <TabsContent value="add-ons" className="mt-6">
             <Card>
                <CardContent className="text-center py-20">
                    <p className="text-muted-foreground">No add-on services yet. Add one to get started.</p>
                </CardContent>
            </Card>
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
