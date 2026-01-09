

'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical } from 'lucide-react';
import { type InventoryItem } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { differenceInYears, differenceInMonths, parseISO } from 'date-fns';

interface EndCostPerUseTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onConfirm: (results: { actualLifespanMonths: number; totalMaintenanceCost: number }) => void;
}

export const EndCostPerUseTestDialog: React.FC<EndCostPerUseTestDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
}) => {
  const { toast } = useToast();

  if (!product) return null;
  
  if (product.type === 'equipment') {
      const purchaseDate = product.batches[0]?.receivedDate ? parseISO(product.batches[0].receivedDate) : new Date();
      const actualMonthsInService = differenceInMonths(new Date(), purchaseDate);
      const estimatedLifespanMonths = (product.lifespanYears || 0) * 12;

      const purchaseCost = product.costPerUnit || 0;
      const totalMaintenanceCost = (product.maintenanceHistory || []).reduce((acc, log) => acc + log.cost, 0);

      const estimatedCostPerMonth = estimatedLifespanMonths > 0 ? purchaseCost / estimatedLifespanMonths : 0;
      const actualCostPerMonth = actualMonthsInService > 0 ? (purchaseCost + totalMaintenanceCost) / actualMonthsInService : 0;


      const handleConfirm = () => {
         onConfirm({ actualLifespanMonths: actualMonthsInService, totalMaintenanceCost });
         toast({
            title: "Equipment Experiment Complete!",
            description: `${product.name} was in service for ${actualMonthsInService} months. Results saved.`,
        });
        onOpenChange(false);
      }

      return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <FlaskConical className="text-purple-500" />
                    Equipment Lifespan Results
                </DialogTitle>
                <DialogDescription>
                    You've completed a lifespan test for "{product.name}".
                </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                        <Card className="bg-muted/50">
                        <CardHeader>
                            <CardTitle className="text-base">Estimate</CardTitle>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <div>
                                <p className="text-3xl font-bold">{product.lifespanYears || 0}</p>
                                <p className="text-sm text-muted-foreground">years</p>
                            </div>
                             <div>
                                <p className="text-lg font-bold">${estimatedCostPerMonth.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">Est. Cost / Month</p>
                            </div>
                        </CardContent>
                        </Card>
                        <Card className="border-purple-500/50 shadow-lg shadow-purple-500/10">
                        <CardHeader>
                            <CardTitle className="text-base text-purple-500">Actual Results</CardTitle>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <div>
                                <p className="text-3xl font-bold text-purple-500">{actualMonthsInService}</p>
                                <p className="text-sm text-muted-foreground">months in service</p>
                            </div>
                            <div>
                                <p className="text-lg font-bold text-purple-500">${actualCostPerMonth.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">Actual Cost / Month</p>
                            </div>
                        </CardContent>
                        </Card>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm}>
                        Save & End Test
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      )
  }

  const estimatedUses = product.estimatedUses || 1;
  const actualUses = product.experimentUses || 0;
  
  // In a real app, this would find the specific batch under experiment
  const landedCost = product.batches[0]?.costPerUnit || 0; 

  const oldCostPerUse = estimatedUses > 0 ? landedCost / estimatedUses : 0;
  const newCostPerUse = actualUses > 0 ? landedCost / actualUses : 0;
  
  const handleConfirmProduct = () => {
    // The parent component will handle the state update.
    // This dialog's job is just to report the results.
    onConfirm({
        actualLifespanMonths: actualUses, // For products, we can re-purpose this to mean actual uses
        totalMaintenanceCost: 0 // Not applicable for products
    });
    toast({
        title: "Experiment Complete!",
        description: `Cost-per-use for ${product.name} updated to $${newCostPerUse.toFixed(3)}.`,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="text-purple-500" />
            Cost-Per-Use Experiment Results
          </DialogTitle>
          <DialogDescription>
            You've completed an experiment for "{product.name}". Here are the results.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <Card className="bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">Before (Estimate)</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-3xl font-bold">${oldCostPerUse.toFixed(3)}</p>
                <p className="text-sm text-muted-foreground">per use</p>
                <p className="text-xs text-muted-foreground mt-2">Based on {estimatedUses} estimated uses</p>
              </CardContent>
            </Card>
            <Card className="border-purple-500/50 shadow-lg shadow-purple-500/10">
              <CardHeader>
                <CardTitle className="text-base text-purple-500">After (Actual)</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-3xl font-bold text-purple-500">${newCostPerUse.toFixed(3)}</p>
                <p className="text-sm text-muted-foreground">per use</p>
                 <p className="text-xs text-muted-foreground mt-2">Based on {actualUses} logged uses</p>
              </CardContent>
            </Card>
          </div>
           <Card>
                <CardHeader>
                    <CardTitle className="text-base">Usage Log</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground text-center">
                    <p>Usage log history will be displayed here.</p>
                </CardContent>
           </Card>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirmProduct}>
            Update Cost & End Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
