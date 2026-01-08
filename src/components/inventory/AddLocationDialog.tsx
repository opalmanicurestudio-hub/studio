
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Upload, Save, Check } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

export type LocationType = {
  id: string;
  name: string;
};

export type Location = {
  id: string;
  name: string;
  locationTypeId: string;
  description?: string;
  environmentalNeeds?: string[];
  customNeeds?: string;
  photoUrl?: string;
};

const locationSchema = z.object({
  name: z.string().min(1, { message: 'Location name is required.' }),
  locationTypeId: z.string().min(1, { message: 'Location type is required.' }),
  description: z.string().optional(),
  refrigerated: z.boolean().optional(),
  noSunlight: z.boolean().optional(),
  ventilated: z.boolean().optional(),
  humidityControlled: z.boolean().optional(),
  customNeeds: z.string().optional(),
});

type LocationFormData = z.infer<typeof locationSchema>;

export const AddLocationDialog = ({
  open,
  onOpenChange,
  onSave,
  locationTypes,
  onAddNewLocationType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Omit<Location, 'id'>) => void;
  locationTypes: LocationType[];
  onAddNewLocationType: (name: string) => LocationType;
}) => {
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      refrigerated: false,
      noSunlight: false,
      ventilated: false,
      humidityControlled: false,
    }
  });

  const handleSave = (data: LocationFormData) => {
    const environmentalNeeds: string[] = [];
    if (data.refrigerated) environmentalNeeds.push('Refrigerated');
    if (data.noSunlight) environmentalNeeds.push('Keep out of sunlight');
    if (data.ventilated) environmentalNeeds.push('Ventilated');
    if (data.humidityControlled) environmentalNeeds.push('Humidity Controlled');
    
    const finalData: Omit<Location, 'id'> = {
        name: data.name,
        locationTypeId: data.locationTypeId,
        description: data.description,
        customNeeds: data.customNeeds,
        environmentalNeeds,
    };
    onSave(finalData);
    handleClose();
  };
  
  const handleAddNewType = () => {
    if (newTypeName.trim()) {
        const newType = onAddNewLocationType(newTypeName.trim());
        setValue('locationTypeId', newType.id, { shouldValidate: true });
        setNewTypeName('');
        setIsAddingType(false);
    }
  };

  const handleClose = () => {
    reset();
    setIsAddingType(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Location</DialogTitle>
          <DialogDescription>
            Create a new storage location for your inventory with detailed organizational options.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleSave)}>
          <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-4">
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="location-name">Location Name</Label>
                  <Input id="location-name" placeholder="e.g., Back Room - Shelf A" {...field} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
              )}
            />

            <Controller
              name="locationTypeId"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="location-type">Location Type</Label>
                   {isAddingType ? (
                    <div className="flex gap-2">
                        <Input 
                            placeholder="Enter new type name..." 
                            value={newTypeName}
                            onChange={(e) => setNewTypeName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddNewType()}
                        />
                        <Button onClick={handleAddNewType} type="button"><Check className="h-4 w-4" /></Button>
                    </div>
                    ) : (
                    <div className="flex gap-2">
                        <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger id="location-type">
                            <SelectValue placeholder="Select a type" />
                        </SelectTrigger>
                        <SelectContent>
                            {locationTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                            ))}
                        </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" onClick={() => setIsAddingType(true)} type="button">
                            <PlusCircle className="h-4 w-4" />
                        </Button>
                    </div>
                    )}
                   {errors.locationTypeId && <p className="text-sm text-destructive">{errors.locationTypeId.message}</p>}
                </div>
              )}
            />

            <Controller
                name="description"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="location-description">Description</Label>
                        <Textarea id="location-description" placeholder="Optional: Describe what is typically stored here." {...field} />
                    </div>
                )}
            />
            
            <div className="space-y-2">
              <Label>Location Photo</Label>
              <Button variant="outline" className="w-full" type="button">
                <Upload className="mr-2 h-4 w-4" />
                Upload Photo
              </Button>
            </div>

            <div className="space-y-4">
              <Label>Environmental Needs</Label>
              <div className="grid grid-cols-2 gap-2">
                <Controller name="refrigerated" control={control} render={({ field }) => (
                    <div className="flex items-center space-x-2">
                        <Checkbox id="refrigerated" checked={field.value} onCheckedChange={field.onChange} />
                        <Label htmlFor="refrigerated" className="font-normal">Refrigerated</Label>
                    </div>
                )}/>
                <Controller name="noSunlight" control={control} render={({ field }) => (
                    <div className="flex items-center space-x-2">
                        <Checkbox id="no-sunlight" checked={field.value} onCheckedChange={field.onChange} />
                        <Label htmlFor="no-sunlight" className="font-normal">Keep out of sunlight</Label>
                    </div>
                )}/>
                 <Controller name="ventilated" control={control} render={({ field }) => (
                    <div className="flex items-center space-x-2">
                        <Checkbox id="ventilated" checked={field.value} onCheckedChange={field.onChange}/>
                        <Label htmlFor="ventilated" className='font-normal'>Ventilated</Label>
                    </div>
                )}/>
                <Controller name="humidityControlled" control={control} render={({ field }) => (
                    <div className="flex items-center space-x-2">
                        <Checkbox id="humidity-controlled" checked={field.value} onCheckedChange={field.onChange} />
                        <Label htmlFor="humidity-controlled" className='font-normal'>Humidity Controlled</Label>
                    </div>
                )}/>
              </div>
              <Controller
                name="customNeeds"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2 pt-2">
                        <Label htmlFor="other-needs">Other Custom Needs</Label>
                        <Input id="other-needs" placeholder="e.g., Must be upright" {...field} />
                    </div>
                )}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              Cancel
            </Button>
            <Button type="submit">Save Location</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
