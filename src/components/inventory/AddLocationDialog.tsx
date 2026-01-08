
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Upload } from 'lucide-react';

export const AddLocationDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Location</DialogTitle>
          <DialogDescription>
            Create a new storage location for your inventory with detailed organizational options.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-4">
          <div className="space-y-2">
            <Label htmlFor="location-name">Location Name</Label>
            <Input
              id="location-name"
              placeholder="e.g., Back Room - Shelf A"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-type">Location Type</Label>
            <div className='flex gap-2'>
              <Select>
                  <SelectTrigger id="location-type">
                      <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="back-room">Back Room Storage</SelectItem>
                      <SelectItem value="retail-display">Retail Display</SelectItem>
                      <SelectItem value="styling-station">Styling Station</SelectItem>
                      <SelectItem value="color-bar">Color Bar</SelectItem>
                  </SelectContent>
              </Select>
              <Button variant="outline" size="icon"><PlusCircle className="h-4 w-4" /></Button>
            </div>
          </div>
           <div className="space-y-2">
            <Label htmlFor="parent-location">Parent Location (Optional)</Label>
            <Select>
                <SelectTrigger id="parent-location">
                    <SelectValue placeholder="Nest inside another location" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">None (Top-Level Location)</SelectItem>
                    <SelectItem value="back-room">Back Room</SelectItem>
                    <SelectItem value="styling-station-1">Styling Station 1</SelectItem>
                </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-description">Description</Label>
            <Textarea
              id="location-description"
              placeholder="Optional: Describe what is typically stored here."
            />
          </div>
           <div className="space-y-2">
                <Label>Location Photo</Label>
                <Button variant="outline" className="w-full">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Photo
                </Button>
           </div>
           <div className="space-y-4">
                <Label>Environmental Needs</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center space-x-2">
                      <Checkbox id="refrigerated" />
                      <Label htmlFor="refrigerated" className='font-normal'>Refrigerated</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                      <Checkbox id="no-sunlight" />
                      <Label htmlFor="no-sunlight" className='font-normal'>Keep out of sunlight</Label>
                  </div>
                   <div className="flex items-center space-x-2">
                      <Checkbox id="ventilated" />
                      <Label htmlFor="ventilated" className='font-normal'>Ventilated</Label>
                  </div>
                   <div className="flex items-center space-x-2">
                      <Checkbox id="humidity-controlled" />
                      <Label htmlFor="humidity-controlled" className='font-normal'>Humidity Controlled</Label>
                  </div>
                </div>
                 <div className="space-y-2 pt-2">
                    <Label htmlFor="other-needs">Other Custom Needs</Label>
                    <Input id="other-needs" placeholder="e.g., Must be upright" />
                 </div>
           </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button>Save Location</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
