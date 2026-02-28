
'use client';

import React, { useState } from 'react';
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
import { type Appointment, type Tenant } from '@/lib/data';
import { DollarSign, AlertTriangle, CreditCard, Landmark, Loader } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

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
  const [reason, setReason] = useState('client_request');
  const [chargeFee, setChargeFee] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'add_to_balance'>('card_on_file');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const feeAmount = tenant?.cancellationFee || 0;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
        await onConfirm({
            reason: reason === 'other' ? customReason : reason,
            chargeFee,
            feeAmount: chargeFee ? feeAmount : 0,
            paymentMethod: chargeFee ? paymentMethod : 'waived',
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
            Are you sure you want to cancel the appointment for {appointment.clientName}?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason for Cancellation</Label>
            <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 gap-2">
              <label htmlFor="r1" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="client_request" id="r1" />
                <span className="font-semibold text-sm">Client Request</span>
              </label>
              <label htmlFor="r2" className="flex items-center space-x-3 border-2 p-3 rounded-xl cursor-pointer hover:bg-muted transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="no-show" id="r2" />
                <span className="font-semibold text-sm">No-Show</span>
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

          {feeAmount > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base font-bold">Apply Cancellation Fee</Label>
                  <p className="text-xs text-muted-foreground">The policy fee is ${feeAmount.toFixed(2)}.</p>
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

                    <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-xs font-black uppercase">Collection Notice</AlertTitle>
                        <AlertDescription className="text-[11px] leading-tight">
                            {paymentMethod === 'card_on_file' 
                                ? `Attempting to charge the card ending in **** 4242. If payment fails, you may choose to add it to their balance instead.`
                                : `This adds $${feeAmount.toFixed(2)} to ${appointment.clientName}'s profile. It will be flagged for collection during their next visit.`
                            }
                        </AlertDescription>
                    </Alert>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Go Back</Button>
          <Button 
            variant={chargeFee ? "default" : "destructive"} 
            onClick={handleConfirm} 
            className="font-bold min-w-[140px]"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : (chargeFee ? 'Confirm & Charge' : 'Confirm Cancellation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
