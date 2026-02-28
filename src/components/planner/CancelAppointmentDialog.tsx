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
import { type Appointment, type Tenant, type Service } from '@/lib/data';
import { DollarSign, AlertTriangle, CreditCard, Landmark, Loader, Clock, Ban, Info, TrendingDown } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { differenceInHours, differenceInMinutes } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';

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

  const financialImpact = useMemo(() => {
    if (!service || !tenant?.tmhr) return null;
    const duration = service.duration || 60;
    const hours = duration / 60;
    const overheadLoss = hours * tenant.tmhr;
    return {
        overheadLoss,
        potentialRevenue: service.price,
    };
  }, [service, tenant?.tmhr]);

  const isLateCancellation = useMemo(() => {
    if (!appointment || !tenant?.cancellationWindowHours) return false;
    const startTime = appointment.startTime instanceof Date ? appointment.startTime : new Date(appointment.startTime);
    const hoursUntil = differenceInHours(startTime, new Date());
    return hoursUntil < tenant.cancellationWindowHours;
  }, [appointment, tenant]);

  const feeAmount = useMemo(() => {
    if (reason === 'no-show') return tenant?.noShowFee || 0;
    return isLateCancellation ? (tenant?.cancellationFee || 0) : 0;
  }, [reason, isLateCancellation, tenant]);

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Confirming cancellation for {appointment.clientName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Financial Impact Breakdown */}
          {financialData && (
            <div className="p-4 rounded-xl border-2 bg-muted/30 space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                    <TrendingDown className="w-3 h-3" />
                    Business Impact Analysis
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase">Overhead Loss</p>
                        <p className="text-lg font-black text-destructive">${financialImpact?.overheadLoss.toFixed(2)}</p>
                        <p className="text-[9px] text-muted-foreground leading-tight">Fixed costs for this {service?.duration}m slot</p>
                    </div>
                    <div className="text-right border-l pl-4">
                        <p className="text-[10px] text-muted-foreground font-bold uppercase">Revenue Gap</p>
                        <p className="text-lg font-black text-destructive">${financialImpact?.potentialRevenue.toFixed(2)}</p>
                        <p className="text-[9px] text-muted-foreground leading-tight">Total lost sales opportunity</p>
                    </div>
                </div>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason for Cancellation</Label>
            <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 gap-2">
              <label htmlFor="r1" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="client_request" id="r1" />
                <span className="font-semibold text-sm">Client Request</span>
              </label>
              <label htmlFor="r2" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="no-show" id="r2" />
                <div className="flex flex-col">
                    <span className="font-semibold text-sm">No-Show</span>
                    {tenant?.noShowFee && <span className="text-[10px] text-destructive font-black uppercase tracking-tighter">${tenant.noShowFee.toFixed(2)} penalty applies</span>}
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
              <Alert className="bg-destructive/10 text-destructive border-destructive/20 shadow-sm border-2">
                <Clock className="h-4 w-4" />
                <AlertTitle className="text-xs font-black uppercase tracking-tight">Policy Violation Detected</AlertTitle>
                <AlertDescription className="text-xs space-y-2 mt-1">
                    {reason === 'no-show' 
                        ? `A no-show penalty of $${(tenant?.noShowFee || 0).toFixed(2)} is standard for this business.`
                        : `This cancellation is within the ${tenant?.cancellationWindowHours}-hour window. A fee of $${(tenant?.cancellationFee || 0).toFixed(2)} is applicable.`
                    }
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background">
                <div className="space-y-0.5">
                  <Label className="text-base font-bold">Apply Fee</Label>
                  <p className="text-xs text-muted-foreground">Collect ${feeAmount.toFixed(2)} from client</p>
                </div>
                <Switch checked={chargeFee} onCheckedChange={setChargeFee} />
              </div>
              
              {chargeFee && (
                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Collection Method</Label>
                    <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="grid grid-cols-2 gap-2">
                        <label htmlFor="pay-card" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center", paymentMethod === 'card_on_file' ? "border-primary bg-primary/5" : "border-border")}>
                            <RadioGroupItem value="card_on_file" id="pay-card" className="sr-only" />
                            <CreditCard className={cn("w-5 h-5 mb-1.5", paymentMethod === 'card_on_file' ? "text-primary" : "text-muted-foreground")} />
                            <span className="text-xs font-bold leading-tight">Charge Card<br/>on File</span>
                        </label>
                        <label htmlFor="pay-balance" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center", paymentMethod === 'add_to_balance' ? "border-primary bg-primary/5" : "border-border")}>
                            <RadioGroupItem value="add_to_balance" id="pay-balance" className="sr-only" />
                            <Landmark className={cn("w-5 h-5 mb-1.5", paymentMethod === 'add_to_balance' ? "text-primary" : "text-muted-foreground")} />
                            <span className="text-xs font-bold leading-tight">Add to Client<br/>Balance</span>
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
                    <p className="text-[10px] text-green-600/80 leading-tight">No late cancellation fee is required for this appointment.</p>
                </div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Go Back</Button>
          <Button 
            variant={chargeFee && feeAmount > 0 ? "default" : "destructive"} 
            onClick={handleConfirm} 
            className="font-bold min-w-[140px]"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : (chargeFee && feeAmount > 0 ? 'Confirm & Charge' : 'Confirm Cancellation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
