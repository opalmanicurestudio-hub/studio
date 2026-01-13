
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle } from 'lucide-react';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { type Location, type LocationType } from '@/lib/data';
import { AddLocationDialog } from './AddLocationDialog';

export const AddEquipmentDialog = ({ 
    open, 
    onOpenChange, 
    locations,
    locationTypes,
    onEquipmentAdded,
    isAddLocationDialogOpen, 
    onAddLocationDialogOpenChange,
    onAddNewLocation,
    onAddNewLocationType,
}: { 
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locations: Location[];
    locationTypes: LocationType[];
    onEquipmentAdded: (equipment: any) => void;
    isAddLocationDialogOpen: boolean;
    onAddLocationDialogOpenChange: (open: boolean) => void;
    onAddNewLocation: (newLocation: Omit<Location, 'id'>) => void;
    onAddNewLocationType: (name: string, icon: string) => LocationType;
}) => {
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Equipment</DialogTitle>
          <DialogDescription>
            Add a new piece of capital equipment to your inventory.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-4">
            <div className="space-y-2">
                <Label htmlFor="equipment-name">Equipment Name</Label>
                <Input id="equipment-name" placeholder="e.g., HydroFacial Machine" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="equipment-category">Category</Label>
                    <Input id="equipment-category" placeholder="e.g., Skincare Tech" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="equipment-vendor">Vendor</Label>
                    <Input id="equipment-vendor" placeholder="e.g., ProBeautyTech" />
                </div>
            </div>
            <div className="space-y-2">
                <Label>Equipment Image</Label>
                <ImageUpload onImageUploaded={() => {}} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="purchase-cost">Total Purchase Cost</Label>
                    <Input id="purchase-cost" type="number" placeholder="15000.00" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="purchase-date">Purchase Date</Label>
                    <Input id="purchase-date" type="date" />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="lifespan">Estimated Lifespan (Years)</Label>
                <Input id="lifespan" type="number" placeholder="5" />
            </div>
             <div className="space-y-2">
                <Label>Status</Label>
                <Select defaultValue="active">
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="retired">Retired</SelectItem>
                    </SelectContent>
                </Select>
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
                    <Button variant="outline" size="icon" type="button" onClick={() => onAddLocationDialogOpenChange(true)}><PlusCircle className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onEquipmentAdded({})}>Save Equipment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

     <AddLocationDialog 
        open={isAddLocationDialogOpen} 
        onOpenChange={onAddLocationDialogOpenChange}
        onSave={onAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={onAddNewLocationType}
    />
    </>
  );
};
