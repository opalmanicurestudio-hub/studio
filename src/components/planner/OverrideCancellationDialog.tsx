
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, Loader, KeyRound } from 'lucide-react';
import { type Staff } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';

interface OverrideCancellationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff[];
  onConfirm: (staffId: string, reason: string) => Promise<void>;
}

export const OverrideCancellationDialog: React.FC<OverrideCancellationDialogProps> = ({
  open,
  onOpenChange,
  staff,
  onConfirm,
}) => {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleConfirm = async () => {
    if (!pin || pin.length < 4) {
      toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Please enter a 4-digit PIN.' });
      return;
    }
    if (!reason.trim()) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for the override.' });
      return;
    }

    // Identify staff by PIN
    const authorizedStaff = staff.find(s => s.pin === pin && (s.role === 'admin' || s.role === 'staff')); // In real world, only admin/owner can override
    
    if (!authorizedStaff) {
        toast({ variant: 'destructive', title: 'Unauthorized', description: 'Incorrect PIN or unauthorized staff member.' });
        return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(authorizedStaff.id, reason);
      onOpenChange(false);
      setPin('');
      setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to perform override.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Admin Override
          </DialogTitle>
          <DialogDescription>
            Perform a high-security override to restore an auto-cancelled appointment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2 text-center">
            <Label htmlFor="pin" className="text-sm font-black uppercase tracking-widest text-muted-foreground">Admin PIN</Label>
            <div className="flex justify-center">
                <div className="relative w-40">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="pin"
                        type="password"
                        placeholder="••••"
                        maxLength={4}
                        className="text-center text-2xl tracking-[0.5em] h-14 font-black bg-muted/50 border-2"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    />
                </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-xs font-bold uppercase tracking-wider">Reason for Override</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Accommodating VIP client, traffic delay verified..."
              className="resize-none"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground italic">Overriding an auto-cancellation will be logged for owner review and calculated as an absorbed cost.</p>
          </div>
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? <Loader className="animate-spin" /> : 'Authorize Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
