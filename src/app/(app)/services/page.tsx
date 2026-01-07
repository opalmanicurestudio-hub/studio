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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

const TMHR = 45; // True Minimum Hourly Rate (mock)
const PRODUCT_COST = 15; // Mock product cost

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
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Service Library</CardTitle>
                <CardDescription>
                  Manage your services and analyze their profitability.
                </CardDescription>
              </div>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Service
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead className="hidden sm:table-cell">Duration</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="hidden md:table-cell">Est. Profit</TableHead>
                  <TableHead className="hidden md:table-cell">Margin</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <div className="font-medium">{service.name}</div>
                      <div className="text-sm text-muted-foreground sm:hidden">
                        {service.duration} min
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{service.duration} min</TableCell>
                    <TableCell>${service.price.toFixed(2)}</TableCell>
                    <TableCell className="hidden md:table-cell text-primary">
                      ${service.profit.toFixed(2)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge
                        variant={
                          service.margin > 80 ? 'default' : 'secondary'
                        }
                        className={service.margin > 80 ? 'bg-green-600/20 text-green-400 border-green-600/30' : ''}
                      >
                        {service.margin.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleOpenProfitTester(service)}
                          >
                            Profit Tester
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
