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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, TrendingUp, TrendingDown, Percent, DollarSign, Sparkles, CheckCircle2, History, List, X, ArrowRight } from 'lucide-react';
import { type Appointment, type InventoryItem, type Service, type LifespanTestResult } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { differenceInMonths, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';

interface EndCostPerUseTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: InventoryItem;
  onConfirm: (results: LifespanTestResult) => void;
  usageHistory?: {
    apt: Appointment;
    client: any;
    service: Service | undefined;
  }[];
}

export const EndCostPerUseTestDialog: React.FC<EndCostPerUseTestDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
  usageHistory = [],
}) => {
  const { toast } = useToast();

  const {
    totalRevenue,
    roi,
    actualCostPerMonth,
    estimatedCostPerMonth,
    actualMonthsInService,
    totalMaintenanceCost,
  } = useMemo(() => {
    if (!product || product.type !== 'equipment') {
      return { totalRevenue: 0, roi: 0, actualCostPerMonth: 0, estimatedCostPerMonth: 0, actualMonthsInService: 0, totalMaintenanceCost: 0 };
    }
    
    const purchaseDate = product.batches[0]?.receivedDate ? parseISO(product.batches[0].receivedDate) : new Date();
    const actualMonths = differenceInMonths(new Date(), purchaseDate);
    const estimatedLifespanMonths = (product.lifespanYears || 0) * 12;

    const purchaseCost = product.costPerUnit || 0;
    const maintenanceCost = (product.maintenanceHistory || []).reduce((acc, log) => acc + log.cost, 0);
    const totalCost = purchaseCost + maintenanceCost;

    const estCostPerMonth = estimatedLifespanMonths > 0 ? purchaseCost / estimatedLifespanMonths : 0;
    const actCostPerMonth = actualMonths > 0 ? totalCost / actualMonths : 0;

    const revenue = usageHistory.reduce((acc, use) => acc + (use.service?.price || 0), 0);
    const netProfit = revenue - totalCost;
    const calculatedRoi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;
    
    return {
      totalRevenue: revenue,
      roi: calculatedRoi,
      actualCostPerMonth: actCostPerMonth,
      estimatedCostPerMonth: estCostPerMonth,
      actualMonthsInService: actualMonths,
      totalMaintenanceCost: maintenanceCost,
    };
  }, [product, usageHistory]);

  if (!product) return null;

  const handleEndTest = () => {
    if (product.type === 'equipment') {
        onConfirm({ 
            actualLifespanMonths: actualMonthsInService, 
            totalMaintenanceCost,
            totalRevenue,
            roi,
        });
    } else {
        const estimatedUses = product.estimatedUses || 1;
        const actualUses = product.experimentUses || 0;
        onConfirm({
            actualLifespanMonths: actualUses,
            totalMaintenanceCost: 0,
            totalRevenue: 0,
            roi: 0
        });
    }
    onOpenChange(false);
  };

  const isEquipment = product.type === 'equipment';
  const estimatedUses = product.estimatedUses || 1;
  const actualUses = product.experimentUses || 0;
  const landedCost = product.batches[0]?.costPerUnit || 0; 
  const oldCostPerUse = estimatedUses > 0 ? landedCost / estimatedUses : 0;
  const newCostPerUse = actualUses > 0 ? landedCost / actualUses : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2">
            <FlaskConical className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Evaluation</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            Experiment Conclusion
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            Analyzing operational yield for: <strong className="text-foreground">{product.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* BEFORE CARD */}
              <Card className="rounded-[2rem] border-2 border-border/50 bg-muted/10 shadow-inner overflow-hidden">
                <CardHeader className="p-6 pb-2 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Original Estimate</p>
                </CardHeader>
                <CardContent className="p-6 pt-0 text-center space-y-2">
                  <p className="text-4xl font-black tracking-tighter text-slate-900 font-mono">
                    ${isEquipment ? estimatedCostPerMonth.toFixed(2) : oldCostPerUse.toFixed(3)}
                  </p>
                  <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">Per {isEquipment ? 'Month' : 'Use'}</p>
                  <div className="pt-4 border-t border-dashed border-border/50">
                    <p className="text-[8px] font-bold uppercase text-muted-foreground">Basis: {isEquipment ? `${product.lifespanYears} Years` : `${estimatedUses} Uses`}</p>
                  </div>
                </CardContent>
              </Card>

              {/* AFTER CARD */}
              <Card className="rounded-[2rem] border-4 border-primary/20 bg-primary/5 shadow-2xl shadow-primary/5 overflow-hidden">
                <CardHeader className="p-6 pb-2 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary">Actual Results</p>
                </CardHeader>
                <CardContent className="p-6 pt-0 text-center space-y-2">
                  <p className="text-4xl font-black tracking-tighter text-primary font-mono">
                    ${isEquipment ? actualCostPerMonth.toFixed(2) : newCostPerUse.toFixed(3)}
                  </p>
                  <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Per {isEquipment ? 'Month' : 'Use'}</p>
                  <div className="pt-4 border-t border-dashed border-primary/10">
                    <p className="text-[8px] font-bold uppercase text-primary/60">Verified: {isEquipment ? `${actualMonthsInService} Months` : `${actualUses} Uses`}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {isEquipment && (
                <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-6 shadow-3xl">
                    <div className="text-center sm:text-left space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Asset Contribution</p>
                        <p className="text-sm font-bold uppercase tracking-tight opacity-80">Verified Return on Investment</p>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-black tracking-tighter font-mono text-primary animate-in zoom-in duration-1000">{roi.toFixed(1)}%</span>
                        <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">ROI</span>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                    <History className="w-3.5 h-3.5 opacity-40" />
                    Audit Log Status
                </h4>
                <Card className="rounded-[2rem] border-2 border-dashed bg-muted/5">
                    <CardContent className="p-10 text-center space-y-3">
                        <List className="w-8 h-8 mx-auto text-muted-foreground opacity-20" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Usage record synchronized with studio terminal</p>
                    </CardContent>
                </Card>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 md:h-14 flex-1 rounded-2xl font-black uppercase text-[10px] tracking-widest text-slate-400">Abort Analysis</Button>
            <Button 
                onClick={handleEndTest} 
                className="h-12 md:h-14 flex-[2] rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 group"
            >
                Commit Actuals & Close <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};