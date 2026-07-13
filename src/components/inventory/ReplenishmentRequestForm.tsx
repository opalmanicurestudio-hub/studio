'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader, PackagePlus, CheckCircle2 } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { useCurrentStaff } from '@/hooks/use-current-staff';
import { type Staff, type InventoryItem, type Location } from '@/lib/data';
import { submitAndAutoApproveIfSolo, shouldAutoApprove } from '@/lib/replenishment-firestore';

/**
 * Staff-facing replenishment request form.
 * Path: components/inventory/ReplenishmentRequestForm.tsx
 *
 * Works identically for solo and staff tenants — the only difference is
 * what happens after submit: solo tenants auto-approve immediately
 * (see submitAndAutoApproveIfSolo / shouldAutoApprove), staff tenants land
 * in ReplenishmentApprovalQueue for a manager to act on.
 */

export const ReplenishmentRequestForm = ({
  stationId,
}: {
  /** The station (Location.id) this request is for — usually the staff member's own station. */
  stationId: string;
}) => {
  const { inventory, locations, overflowEvents } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { currentStaff, isLoading: isStaffLoading, isUnrecognized } = useCurrentStaff();

  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only items opted into staff tracking show up here — legacy items
  // (trackingMode undefined) keep using the old direct-use flow instead.
  const eligibleItems = useMemo(
    () => inventory.filter(i => i.trackingMode === 'bulk' || i.trackingMode === 'serialized'),
    [inventory]
  );

  const selectedItem = eligibleItems.find(i => i.id === selectedItemId);
  const stationName = locations.find(l => l.id === stationId)?.name || 'your station';
  const isSolo = selectedTenant ? shouldAutoApprove(selectedTenant) : false;

  const handleSubmit = async () => {
    if (!firestore || !tenantId || !selectedItem || !quantity || !currentStaff) return;
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      toast({ variant: 'destructive', title: 'Enter a valid quantity' });
      return;
    }

    setIsSubmitting(true);
    const result = await submitAndAutoApproveIfSolo(
      firestore,
      tenantId,
      selectedTenant!,
      currentStaff,
      overflowEvents,
      {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        staffId: currentStaff.id,
        staffName: currentStaff.name,
        stationId,
        quantityRequested: qty,
      }
    );
    setIsSubmitting(false);

    if (result.autoApproved) {
      if (result.approveResult?.success) {
        toast({ title: 'Replenished', description: `${selectedItem.name} added to ${stationName}.` });
      } else {
        toast({ variant: 'destructive', title: 'Auto-approval failed', description: result.approveResult?.error });
      }
    } else {
      toast({ title: 'Request Submitted', description: `Waiting on manager approval for ${selectedItem.name}.` });
    }

    setSelectedItemId('');
    setQuantity('');
  };

  if (isStaffLoading) {
    return (
      <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
        <CardContent className="flex flex-col items-center justify-center p-16 gap-4">
          <Loader className="animate-spin h-8 w-8 text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (isUnrecognized || !currentStaff) {
    return (
      <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
        <CardContent className="text-center py-16 opacity-60 flex flex-col items-center gap-4">
          <PackagePlus className="w-10 h-10 opacity-40" />
          <p className="font-black uppercase tracking-widest text-sm">Account Not Linked to Staff Record</p>
          <p className="text-[10px] font-bold uppercase tracking-widest max-w-xs opacity-60">
            Your login isn't matched to a Staff document for this tenant. Ask an owner to check your staff record's ID.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
        <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
          <PackagePlus className="w-5 h-5 text-primary" />
          Request Restock
        </CardTitle>
        <p className="text-xs font-bold uppercase tracking-widest opacity-60">
          {isSolo ? 'Approved automatically — no manager needed' : `For ${stationName}`}
        </p>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-6">
        <div className="space-y-2 text-left">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Item</Label>
          <Select value={selectedItemId} onValueChange={setSelectedItemId}>
            <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest bg-white shadow-inner">
              <SelectValue placeholder="SELECT AN ITEM" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              {eligibleItems.length === 0 ? (
                <div className="p-4 text-center text-[10px] font-bold uppercase tracking-widest opacity-40">
                  No items enabled for staff tracking yet
                </div>
              ) : (
                eligibleItems.map(item => (
                  <SelectItem key={item.id} value={item.id} className="font-bold">
                    {item.name} <span className="opacity-40 ml-1">({item.trackingMode})</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 text-left">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Quantity Needed</Label>
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="h-14 rounded-2xl border-2 font-black text-lg tracking-tight bg-white"
            placeholder="e.g. 10"
          />
        </div>

        <Button
          className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20"
          onClick={handleSubmit}
          disabled={!selectedItemId || !quantity || isSubmitting}
        >
          {isSubmitting ? (
            <Loader className="h-4 w-4 animate-spin" />
          ) : isSolo ? (
            <><CheckCircle2 className="mr-2 h-4 w-4" /> Restock Now</>
          ) : (
            <><PackagePlus className="mr-2 h-4 w-4" /> Submit Request</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
