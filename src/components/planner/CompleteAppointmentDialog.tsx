
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection } from '@/lib/data';
import { format } from 'date-fns';

interface CompleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentData: {
    appointment: Appointment;
    client: Client | undefined;
    service: Service | undefined;
  };
  inventory: InventoryItem[];
  onConfirmCheckout: (updatedInventory: InventoryItem[], newCorrections: StockCorrection[]) => void;
}

export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  inventory,
  onConfirmCheckout,
}) => {
  const { appointment, client, service } = appointmentData;

  const { updatedInventory, displayCorrections, newCorrections, warnings } = useMemo(() => {
    const warnings: string[] = [];
    const displayCorrections: { name: string; change: string }[] = [];
    const newCorrections: StockCorrection[] = [];
    
    // Deep clone inventory to simulate changes without mutating state
    let tempInventory = JSON.parse(JSON.stringify(inventory)) as InventoryItem[];

    if (!service || !service.products) {
      return { updatedInventory: inventory, displayCorrections, newCorrections, warnings };
    }

    service.products.forEach(productInService => {
        const productIndex = tempInventory.findIndex(p => p.id === productInService.id);
        if (productIndex === -1) {
            warnings.push(`Product "${productInService.name}" not found in inventory.`);
            return;
        }

        const product = tempInventory[productIndex];
        let quantityNeeded = productInService.quantityUsed;

        if (product.costingMethod === 'uses') {
            if (product.partialContainerUses === undefined) product.partialContainerUses = 0;
            
            const createCorrection = (change: number) => {
                 newCorrections.push({
                    id: `sc-${Date.now()}-${Math.random()}`,
                    productId: product.id,
                    date: new Date().toISOString(),
                    change: -change,
                    unit: 'use',
                    reason: `Appointment #${appointment.id.slice(-4)}`
                });
            };

            if (product.partialContainerUses >= quantityNeeded) {
                product.partialContainerUses -= quantityNeeded;
                displayCorrections.push({ name: product.name, change: `-${quantityNeeded} uses` });
                createCorrection(quantityNeeded);
            } else {
                let usesToFulfill = quantityNeeded;
                if (product.partialContainerUses > 0) {
                    usesToFulfill -= product.partialContainerUses;
                    displayCorrections.push({ name: product.name, change: `-${product.partialContainerUses} uses (emptied)` });
                    createCorrection(product.partialContainerUses);
                    product.partialContainerUses = 0;
                }

                while (usesToFulfill > 0) {
                    if (product.totalStock <= 0) {
                        warnings.push(`Insufficient stock for ${product.name}. Cannot fulfill ${usesToFulfill} more uses.`);
                        break;
                    }
                    product.totalStock -= 1; // "Open" a new container
                    const usesPerContainer = product.estimatedUses || 1;
                    product.partialContainerUses = usesPerContainer;
                    
                    if (product.partialContainerUses >= usesToFulfill) {
                        product.partialContainerUses -= usesToFulfill;
                        displayCorrections.push({ name: product.name, change: `-1 container, -${usesToFulfill} uses` });
                        createCorrection(usesToFulfill);
                        usesToFulfill = 0;
                    } else {
                        displayCorrections.push({ name: product.name, change: `-1 container (emptied)` });
                        createCorrection(product.partialContainerUses);
                        usesToFulfill -= product.partialContainerUses;
                        product.partialContainerUses = 0;
                    }
                }
            }
        } else if (product.costingMethod === 'size') {
             const createCorrection = (change: number) => {
                 newCorrections.push({
                    id: `sc-${Date.now()}-${Math.random()}`,
                    productId: product.id,
                    date: new Date().toISOString(),
                    change: -change,
                    unit: product.unit || '',
                    reason: `Appointment #${appointment.id.slice(-4)}`
                });
            };

            if (product.partialContainerSize === undefined) product.partialContainerSize = 0;

            if (product.partialContainerSize >= quantityNeeded) {
                product.partialContainerSize -= quantityNeeded;
                displayCorrections.push({ name: product.name, change: `-${quantityNeeded}${product.unit || ''}` });
                createCorrection(quantityNeeded);
            } else {
                let sizeToFulfill = quantityNeeded;
                if (product.partialContainerSize > 0) {
                    sizeToFulfill -= product.partialContainerSize;
                    displayCorrections.push({ name: product.name, change: `-${product.partialContainerSize}${product.unit || ''} (emptied)` });
                    createCorrection(product.partialContainerSize);
                    product.partialContainerSize = 0;
                }

                while(sizeToFulfill > 0) {
                    if (product.totalStock <= 0) {
                        warnings.push(`Insufficient stock for ${product.name}. Cannot fulfill ${sizeToFulfill} more ${product.unit || ''}.`);
                        break;
                    }
                    product.totalStock -= 1;
                    const sizePerContainer = product.size || 0;
                    product.partialContainerSize = sizePerContainer;

                    if (product.partialContainerSize >= sizeToFulfill) {
                        product.partialContainerSize -= sizeToFulfill;
                        displayCorrections.push({ name: product.name, change: `-1 container, -${sizeToFulfill}${product.unit || ''}` });
                        createCorrection(sizeToFulfill);
                        sizeToFulfill = 0;
                    } else {
                        displayCorrections.push({ name: product.name, change: `-1 container (emptied)` });
                        createCorrection(product.partialContainerSize);
                        sizeToFulfill -= product.partialContainerSize;
                        product.partialContainerSize = 0;
                    }
                }
            }
        }
        tempInventory[productIndex] = product;
    });

    return { updatedInventory: tempInventory, displayCorrections, newCorrections, warnings };
  }, [service, inventory, appointment.id]);

  if (!client || !service) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Appointment</DialogTitle>
          <DialogDescription>
            Confirm details and complete the checkout process.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6 max-h-[70vh] overflow-y-auto pr-4">
            <Card>
                <CardContent className="p-4 flex items-center gap-4">
                     <Avatar className="w-12 h-12">
                        <AvatarImage src={client.avatarUrl} alt={client.name} />
                        <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="text-sm text-muted-foreground">{format(appointment.startTime, 'MMMM d, yyyy @ h:mm a')}</p>
                    </div>
                </CardContent>
            </Card>
            
             <Card>
                <CardHeader>
                    <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span>{service.name}</span>
                        <span>${service.price.toFixed(2)}</span>
                    </div>
                     <div className="flex justify-between text-muted-foreground">
                        <span>Service Cost</span>
                        <span>-${service.cost.toFixed(2)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-bold text-base">
                        <span>Net Profit</span>
                        <span>${service.profit.toFixed(2)}</span>
                    </div>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Inventory Deductions</CardTitle>
                    <CardDescription>The following stock adjustments will be made.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {warnings.length > 0 && warnings.map((warning, i) => (
                         <div key={`warn-${i}`} className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                             <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            {warning}
                        </div>
                    ))}
                    
                    {displayCorrections.length > 0 ? (
                        <div className="space-y-2 text-sm">
                            {displayCorrections.map((correction, i) => (
                                <div key={`corr-${i}`} className="flex justify-between p-2 bg-muted/50 rounded-md">
                                    <span>{correction.name}</span>
                                    <span className="font-mono font-medium">{correction.change}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                         <div className="p-3 rounded-md bg-green-500/10 text-green-700 text-sm flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            No inventory items will be deducted for this service.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onConfirmCheckout(updatedInventory, newCorrections)} disabled={warnings.some(w => w.includes('Insufficient stock'))}>
            Confirm & Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
