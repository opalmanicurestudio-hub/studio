
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Service, type Staff, type PricingTier } from '@/lib/data';
import { StaffSelectionCard } from '@/components/shared/StaffSelectionCard';
import { useToast } from '@/hooks/use-toast';

interface SelectProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service | null;
  staff: Staff[];
  pricingTiers: PricingTier[];
  onConfirm: (service: Service, staff: Staff) => void;
}

export const SelectProviderDialog: React.FC<SelectProviderDialogProps> = ({
  open,
  onOpenChange,
  service,
  staff,
  pricingTiers,
  onConfirm,
}) => {
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setSelectedStaffId('');
    }
  }, [open]);

  const handleConfirm = () => {
    const selectedStaff = staff.find(s => s.id === selectedStaffId);
    if (service && selectedStaff) {
      onConfirm(service, selectedStaff);
      onOpenChange(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'No Provider Selected',
        description: 'Please select a staff member to perform the service.',
      });
    }
  };

  if (!service) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Select a Provider for {service.name}</DialogTitle>
          <DialogDescription>
            The price of the service may vary depending on the provider's tier.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <ScrollArea className="h-72">
            <RadioGroup
              value={selectedStaffId}
              onValueChange={setSelectedStaffId}
              className="grid grid-cols-2 md:grid-cols-3 gap-4 pr-4"
            >
              {staff.map(s => (
                <StaffSelectionCard key={s.id} staff={s} pricingTiers={pricingTiers} />
              ))}
            </RadioGroup>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedStaffId}>
            Add to Sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
