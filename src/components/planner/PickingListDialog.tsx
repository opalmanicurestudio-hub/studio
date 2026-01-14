
'use client';

import React, { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Appointment, type Service, type InventoryItem } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { services } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import Image from 'next/image';

interface PickingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointments: Appointment[];
}

type AggregatedProduct = {
  product: InventoryItem;
  totalQuantity: number;
  unit: string;
  appointments: {
    clientName: string;
    quantity: number;
  }[];
};

export const PickingListDialog: React.FC<PickingListDialogProps> = ({
  open,
  onOpenChange,
  appointments,
}) => {
  const { inventory, locations } = useInventory();

  const pickingListByLocation = useMemo(() => {
    const productMap = new Map<string, AggregatedProduct>();

    const activeAppointments = appointments.filter(
      apt => apt.status === 'confirmed' || apt.status === 'deposit_pending'
    );

    activeAppointments.forEach(apt => {
      const service = services.find(s => s.id === apt.serviceId);
      if (!service) return;

      const allServicesInAppointment = [service];
      if (apt.addOnIds) {
        apt.addOnIds.forEach(id => {
          const addOn = services.find(s => s.id === id);
          if (addOn) allServicesInAppointment.push(addOn);
        });
      }

      allServicesInAppointment.forEach(currentService => {
        currentService.products?.forEach(formulaItem => {
          const product = inventory.find(p => p.id === formulaItem.id);
          if (!product) return;

          const key = product.id;
          if (!productMap.has(key)) {
            productMap.set(key, {
              product,
              totalQuantity: 0,
              unit: formulaItem.unit || 'unit',
              appointments: [],
            });
          }

          const entry = productMap.get(key)!;
          entry.totalQuantity += formulaItem.quantityUsed;
          entry.appointments.push({
            clientName: 'Client Name', // This should be fetched from client data
            quantity: formulaItem.quantityUsed,
          });
        });
      });
    });

    const byLocation = new Map<string, AggregatedProduct[]>();

    productMap.forEach(aggregatedProduct => {
      const locationId = aggregatedProduct.product.primaryLocationId || 'unassigned';
      if (!byLocation.has(locationId)) {
        byLocation.set(locationId, []);
      }
      byLocation.get(locationId)!.push(aggregatedProduct);
    });

    return Array.from(byLocation.entries()).map(([locationId, products]) => ({
      location: locations.find(l => l.id === locationId) || { id: 'unassigned', name: 'Unassigned' },
      products,
    }));
  }, [appointments, inventory, locations]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Today's Picking List</DialogTitle>
          <DialogDescription>
            All products needed for today's confirmed appointments, grouped by location.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-6">
            {pickingListByLocation.length > 0 ? (
              pickingListByLocation.map(({ location, products }) => (
                <div key={location.id}>
                  <h3 className="font-semibold mb-2">{location.name}</h3>
                  <Accordion type="multiple" className="space-y-2">
                    {products.map(item => (
                      <AccordionItem key={item.product.id} value={item.product.id} className="border rounded-md">
                        <AccordionTrigger className="p-3 hover:no-underline">
                           <div className="flex items-center gap-3 w-full">
                                <div className="w-10 h-10 bg-muted rounded-md flex-shrink-0">
                                    <Image src={item.product.imageUrl || `https://picsum.photos/seed/inv${item.product.id}/100/100`} alt={item.product.name} width={40} height={40} className='rounded-md'/>
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="font-medium text-sm">{item.product.name}</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-base">{item.totalQuantity}{item.unit}</p>
                                    <p className="text-xs text-muted-foreground">Total</p>
                                </div>
                           </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-3 pb-3">
                           <div className="space-y-1 text-xs text-muted-foreground">
                             {item.appointments.map((apt, index) => (
                                <div key={index} className="flex justify-between">
                                    <span>{apt.clientName}</span>
                                    <span>{apt.quantity}{item.unit}</span>
                                </div>
                             ))}
                           </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground py-10">
                No products required for today's confirmed appointments.
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => window.print()}>Print List</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
