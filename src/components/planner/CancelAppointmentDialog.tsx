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
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { type Appointment, type Tenant, type Service } from '@/lib/data';
import { 
  DollarSign, 
  AlertTriangle, 
  CreditCard, 
  Landmark, 
  Loader, 
  Clock, 
  Ban, 
  Info, 
  TrendingDown, 
  Calculator, 
  ShieldCheck 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { differenceInHours } from 'date-fns';
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

  // Mock card data
  const cardOnFile = { brand: 'Visa', last4: '4242' };

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
      <DialogContent className="sm:max-w-md p-0 overflow-hidden flex flex-col h-full max-h-[90dvh] sm:h-auto sm:max-h-[85vh]">
        <DialogHeader className="p-6 pb-2 border-b bg-muted/10 shrink-0">
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Confirming cancellation for {appointment.clientName}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto bg-background">
            <div className="px-6 py-4 space-y-6 pb-8">
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason for Cancellation</Label>
                  <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 gap-2">
                    <div className="relative">
                        <RadioGroupItem value="client_request" id="reason-client" className="peer sr-only" />
                        <Label 
                            htmlFor="reason-client"
                            className={cn(
                                "flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer transition-all hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-md border-border"
                            )}
                        >
                            <div className="flex-1">
                                <p className="font-semibold text-sm">Client Request</p>
                                {isLateCancellation && <p className="text-[10px] text-amber-600 font-bold uppercase tracking-tighter">Late Notice Violation</p>}
                            </div>
                        </Label>
                    </div>
                    <div className="relative">
                        <RadioGroupItem value="no-show" id="reason-noshow" className="peer sr-only" />
                        <Label 
                            htmlFor="reason-noshow"
                            className={cn(
                                "flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer transition-all hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-md border-border"
                            )}
                        >
                            <div className="flex flex-col">
                                <span className="font-semibold text-sm">No-Show</span>
                                <span className="text-[10px] text-destructive font-black uppercase tracking-tighter">Maximum Penalty applied</span>
                            </div>
                        </Label>
                    </div>
                    <div className="relative">
                        <RadioGroupItem value="other" id="reason-other" className="peer sr-only" />
                        <Label 
                            htmlFor="reason-other"
                            className={cn(
                                "flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer transition-all hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-md border-border"
                            )}
                        >
                            <span className="font-semibold text-sm">Other Reason</span>
                        </Label>
                    </div>
                  </RadioGroup>
                  {reason === 'other' && (
                    <div className="mt-2">
                        <Textarea 
                        placeholder="Please specify details..." 
                        value={customReason} 
                        onChange={(e) => setCustomReason(e.target.value)}
                        />
                    </div>
                  )}
                </div>

                <Card className="bg-muted/30 border-2 overflow-hidden shadow-sm">
                  <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                              <TrendingDown className="w-3 h-3" />
                              Financial Impact
                          </p>
                          <Badge variant="outline" className="font-mono text-[9px] uppercase">{dynamicFees.duration}m Slot</Badge>
                      </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-3">
                      <div className="flex justify-between items-baseline border-b border-dashed pb-2">
                          <span className="text-xs text-muted-foreground">Reserved Overhead (${tenant?.tmhr?.toFixed(2) || '0.00'}/hr)</span>
                          <span className="font-bold text-sm text-destructive">${dynamicFees.overheadRecovery.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                          <span className="text-xs text-muted-foreground">Lost Revenue Opportunity</span>
                          <span className="font-bold text-sm text-destructive">${dynamicFees.noShowPenalty.toFixed(2)}</span>
                      </div>
                  </CardContent>
                </Card>

                {(isLateCancellation || reason === 'no-show') && (
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background shadow-inner">
                        <div className="space-y-0.5">
                            <Label className="text-base font-black">Enforce Policy Fee</Label>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Recover fixed costs for this time</p>
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
                                <div className="relative h-full">
                                    <RadioGroupItem value="card_on_file" id="pay-card" className="peer sr-only" />
                                    <Label htmlFor="pay-card" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-md border-border")}>
                                        <CreditCard className={cn("w-5 h-5 mb-1.5", paymentMethod === 'card_on_file' ? "text-primary" : "text-muted-foreground")} />
                                        <span className="text-[10px] font-black leading-tight uppercase">Card on File</span>
                                        <span className="text-[9px] text-muted-foreground mt-1">{cardOnFile.brand} •••• {cardOnFile.last4}</span>
                                    </Label>
                                </div>
                                <div className="relative h-full">
                                    <RadioGroupItem value="add_to_balance" id="pay-balance" className="peer sr-only" />
                                    <Label htmlFor="pay-balance" className={cn("flex flex-col items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all hover:bg-muted text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-md border-border")}>
                                        <Landmark className={cn("w-5 h-5 mb-1.5", paymentMethod === 'add_to_balance' ? "text-primary" : "text-muted-foreground")} />
                                        <span className="text-[10px] font-black leading-tight uppercase">Add to Client<br/>Balance</span>
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t sm:justify-between gap-2 bg-background shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting} className="h-12">Back</Button>
            <Button 
                variant={chargeFee && feeAmount > 0 ? "default" : "destructive"} 
                onClick={handleConfirm} 
                className="font-bold h-12"
                disabled={isSubmitting}
            >
                {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : (chargeFee && feeAmount > 0 ? 'Collect & Cancel' : 'Confirm Cancel')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
