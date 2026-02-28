'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type Appointment, type Tenant, type Service } from '@/lib/data';
import { DollarSign, AlertTriangle, CreditCard, Landmark, Loader, Clock, Ban, Info, TrendingDown, Calculator } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { differenceInHours } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  tenant: Tenant | null;
  onConfirm: (data: { 
    reason: string; 
    chargeFee: boolean; 
    feeAmount: number;
    paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
  }) => Promise<void>;
}

export const CancelAppointmentDialog: React.FC<CancelAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointment,
  tenant,
  onConfirm,
}) => {
  const { services } = useInventory();
  const [reason, setReason] = useState('client_request');
  const [chargeFee, setChargeFee] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'add_to_balance'>('card_on_file');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const service = useMemo(() => services?.find(s => s.id === appointment.serviceId), [services, appointment.serviceId]);

  const isLateCancellation = useMemo(() => {
    if (!appointment || !tenant?.cancellationWindowHours) return false;
    const startTime = appointment.startTime instanceof Date ? appointment.startTime : new Date(appointment.startTime);
    const hoursUntil = differenceInHours(startTime, new Date());
    return hoursUntil < tenant.cancellationWindowHours;
  }, [appointment, tenant]);

  const dynamicFees = useMemo(() => {
    if (!service || !tenant?.tmhr) return { overheadRecovery: 0, noShowPenalty: 0, duration: 0 };
    
    const duration = service.duration || 60;
    const overheadRecovery = (duration / 60) * (tenant.tmhr || 50);
    const noShowPenalty = service.price || 0;

    return {
        overheadRecovery,
        noShowPenalty,
        duration
    };
  }, [service, tenant?.tmhr]);

  const feeAmount = useMemo(() => {
    if (reason === 'no-show') return dynamicFees.noShowPenalty;
    return isLateCancellation ? dynamicFees.overheadRecovery : 0;
  }, [reason, isLateCancellation, dynamicFees]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
        await onConfirm({
            reason: reason === 'other' ? customReason : reason,
            chargeFee: chargeFee && feeAmount > 0,
            feeAmount: chargeFee ? feeAmount : 0,
            paymentMethod: (chargeFee && feeAmount > 0) ? paymentMethod : 'waived',
        });
        onOpenChange(false);
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Confirming cancellation for {appointment.clientName}.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            <Card className="bg-muted/30 border-2 overflow-hidden">
              <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                          <TrendingDown className="w-3 h-3" />
                          Specific Business Impact
                      </p>
                      <Badge variant="outline" className="font-mono text-[9px] uppercase">{dynamicFees.duration}m Slot</Badge>
                  </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                  <div className="flex justify-between items-baseline border-b border-dashed pb-2">
                      <span className="text-xs text-muted-foreground">Reserved Time Overhead ({dynamicFees.duration}m @ ${tenant?.tmhr?.toFixed(2)}/hr)</span>
                      <span className="font-bold text-sm text-destructive">${dynamicFees.overheadRecovery.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                      <span className="text-xs text-muted-foreground">Lost Revenue Opportunity (100% of price)</span>
                      <span className="font-bold text-sm text-destructive">${dynamicFees.noShowPenalty.toFixed(2)}</span>
                  </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason for Cancellation</Label>
              <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 gap-2">
                <label htmlFor="r1" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="client_request" id="r1" />
                  <div className="flex-1">
                      <p className="font-semibold text-sm">Client Request</p>
                      {isLateCancellation && <p className="text-[10px] text-amber-600 font-bold uppercase">Late: {tenant?.cancellationWindowHours}h window</p>}
                  </div>
                </label>
                <label htmlFor="r2" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="no-show" id="r2" />
                  <div className="flex flex-col">
                      <span className="font-semibold text-sm">No-Show</span>
                      <span className="text-[10px] text-destructive font-black uppercase tracking-tighter">Full revenue recovery applies</span>
                  </div>
                </label>
                <label htmlFor="r3" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="other" id="r3" />
                  <span className="font-semibold text-sm">Other Reason</span>
                </label>
              </RadioGroup>
              {reason === 'other' && (
                <Textarea 
                  placeholder="Describe the reason..." 
                  value={customReason} 
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>

            {(isLateCancellation || reason === 'no-show') ? (
              <div className="space-y-4 pt-4 border-t">
                <Alert className="bg-destructive/5 text-destructive border-destructive/20 shadow-sm border-2">
                  <Calculator className="h-4 w-4" />
                  <AlertTitle className="text-xs font-black uppercase tracking-tight">Fee Breakdown</AlertTitle>
                  <AlertDescription className="text-xs space-y-2 mt-1">
                      {reason === 'no-show' 
                          ? `Penalty set to 100% of the service price to cover total loss of time and profit.`
                          : `Fee set to recover ${dynamicFees.duration} minutes of fixed business overhead (TMHR).`
                      }
                  </AlertDescription>
                </Alert>

                <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background shadow-inner">
                  <div className="space-y-0.5">
                    <Label className="text-base font-black">Apply Calculated Fee</Label>
                    <p className="text-xs text-muted-foreground">Calculated for this specific appointment</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                      <span className="text-xl font-black text-destructive">${feeAmount.toFixed(2)}</span>
                      <Switch checked={chargeFee} onCheckedChange={setChargeFee} />
                  </div>
                </div>
                
                {chargeFee && (
                  <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Collection Method</Label>
                      <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="grid grid-cols-2 gap-2">
                          <label htmlFor="pay-card" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center", paymentMethod === 'card_on_file' ? "border-primary bg-primary/5 shadow-md" : "border-border")}>
                              <RadioGroupItem value="card_on_file" id="pay-card" className="sr-only" />
                              <CreditCard className={cn("w-5 h-5 mb-1.5", paymentMethod === 'card_on_file' ? "text-primary" : "text-muted-foreground")} />
                              <span className="text-[10px] font-black leading-tight uppercase">Charge Card<br/>on File</span>
                          </label>
                          <label htmlFor="pay-balance" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center", paymentMethod === 'add_to_balance' ? "border-primary bg-primary/5 shadow-md" : "border-border")}>
                              <RadioGroupItem value="add_to_balance" id="pay-balance" className="sr-only" />
                              <Landmark className={cn("w-5 h-5 mb-1.5", paymentMethod === 'add_to_balance' ? "text-primary" : "text-muted-foreground")} />
                              <span className="text-[10px] font-black leading-tight uppercase">Add to Client<br/>Balance</span>
                          </label>
                      </RadioGroup>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl border-2 bg-green-500/5 border-green-500/10 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <div className="flex-1">
                      <p className="text-xs font-bold text-green-700">Outside Policy Window</p>
                      <p className="text-[10px] text-green-600/80 leading-tight">No overhead recovery fee is required for this early cancellation.</p>
                  </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 pt-4 border-t sm:justify-between gap-2 bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Go Back</Button>
          <Button 
            variant={chargeFee && feeAmount > 0 ? "default" : "destructive"} 
            onClick={handleConfirm} 
            className="font-bold min-w-[140px]"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : (chargeFee && feeAmount > 0 ? 'Confirm & Collect' : 'Confirm Cancellation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
