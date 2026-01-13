
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle } from 'lucide-react';
import { type Location } from '@/lib/data';

export const AddOverheadDialog = ({ 
    open, 
    onOpenChange, 
    locations,
    onOverheadAdded
}: { 
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locations: Location[];
    onOverheadAdded: (overhead: any) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Overhead/Supply Item</DialogTitle>
          <DialogDescription>
            Add a consumable business supply to your inventory.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-4">
            <div className="space-y-2">
                <Label htmlFor="overhead-name">Item Name</Label>
                <Input id="overhead-name" placeholder="e.g., Paper Towels" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="overhead-category">Category</Label>
                    <Input id="overhead-category" placeholder="e.g., Cleaning Supplies" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="overhead-vendor">Vendor</Label>
                    <Input id="overhead-vendor" placeholder="e.g., SupplyCo" />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="overhead-cost">Purchase Cost</Label>
                <Input id="overhead-cost" type="number" placeholder="25.00" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="overhead-quantity">Quantity</Label>
                    <Input id="overhead-quantity" type="number" placeholder="1" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="overhead-expiration">Expiration Date (Optional)</Label>
                    <Input id="overhead-expiration" type="date" />
                </div>
            </div>
            <div className="space-y-2">
                <Label>Storage Location</Label>
                <div className="flex gap-2">
                    <Select>
                        <SelectTrigger>
                            <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                            {locations.map(loc => (
                                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" type="button"><PlusCircle className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onOverheadAdded({})}>Save Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
