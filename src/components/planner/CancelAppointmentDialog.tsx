
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
import { DollarSign, AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  tenant: Tenant | null;
  onConfirm: (data: { reason: string; chargeFee: boolean; feeAmount: number }) => void;
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
  const [customReason, setCustomReason] = useState('');

  const feeAmount = tenant?.cancellationFee || 0;

  const handleConfirm = () => {
    onConfirm({
      reason: reason === 'other' ? customReason : reason,
      chargeFee,
      feeAmount: chargeFee ? feeAmount : 0,
    });
    onOpenChange(false);
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
                  <Label className="text-base font-bold">Charge Cancellation Fee</Label>
                  <p className="text-xs text-muted-foreground">Apply a ${feeAmount.toFixed(2)} fee to client&apos;s account.</p>
                </div>
                <Switch checked={chargeFee} onCheckedChange={setChargeFee} />
              </div>
              
              {chargeFee && (
                <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-xs font-black uppercase">Fee Enforcement</AlertTitle>
                  <AlertDescription className="text-[11px] leading-tight">
                    This will add ${feeAmount.toFixed(2)} to {appointment.clientName}&apos;s outstanding balance. This is calculated as an &quot;Enforced Fee&quot; in reports.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Go Back</Button>
          <Button variant="destructive" onClick={handleConfirm} className="font-bold">Confirm Cancellation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
