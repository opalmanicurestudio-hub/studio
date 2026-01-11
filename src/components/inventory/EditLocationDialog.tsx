

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Upload, Save, Check, Box, Building, Store, ClipboardList, LucideIcon } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { cn } from '@/lib/utils';
import { Location, LocationType } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';

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

const iconMap: { [key: string]: LucideIcon } = {
    Box,
    Building,
    Store,
    ClipboardList,
};

export const EditLocationDialog = ({
  open,
  onOpenChange,
  location,
  onSave,
  locationTypes,
  onAddNewLocationType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: Location;
  onSave: (data: Location) => void;
  locationTypes: LocationType[];
  onAddNewLocationType: (name: string, icon: string) => LocationType;
}) => {
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeIcon, setNewTypeIcon] = useState('Box');

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
  });

  useEffect(() => {
    if (location && open) {
      reset({
        name: location.name,
        locationTypeId: location.locationTypeId,
        description: location.description || '',
        customNeeds: location.customNeeds || '',
        refrigerated: location.environmentalNeeds?.includes('Refrigerated'),
        noSunlight: location.environmentalNeeds?.includes('Keep out of sunlight'),
        ventilated: location.environmentalNeeds?.includes('Ventilated'),
        humidityControlled: location.environmentalNeeds?.includes('Humidity Controlled'),
      });
    }
  }, [location, open, reset]);

  const handleSave = (data: LocationFormData) => {
    const environmentalNeeds: string[] = [];
    if (data.refrigerated) environmentalNeeds.push('Refrigerated');
    if (data.noSunlight) environmentalNeeds.push('Keep out of sunlight');
    if (data.ventilated) environmentalNeeds.push('Ventilated');
    if (data.humidityControlled) environmentalNeeds.push('Humidity Controlled');
    
    const finalData: Location = {
        id: location.id,
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
        const newType = onAddNewLocationType(newTypeName.trim(), newTypeIcon);
        setValue('locationTypeId', newType.id, { shouldValidate: true });
        setNewTypeName('');
        setIsAddingType(false);
    }
  };

  const handleClose = () => {
    setIsAddingType(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>
            Update the details for &quot;{location.name}&quot;.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleSave)}>
          <ScrollArea className="max-h-[70vh] -mr-6 pr-6">
            <div className="grid gap-6 py-4 px-6">
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label htmlFor="location-name-edit">Location Name</Label>
                    <Input id="location-name-edit" placeholder="e.g., Back Room - Shelf A" {...field} />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>
                )}
              />

              <Controller
                name="locationTypeId"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label htmlFor="location-type-edit">Location Type</Label>
                    {isAddingType ? (
                      <div className="p-4 border rounded-lg space-y-4">
                          <Input 
                              placeholder="Enter new type name..." 
                              value={newTypeName}
                              onChange={(e) => setNewTypeName(e.target.value)}
                          />
                          <div>
                              <Label className="mb-2 block">Icon</Label>
                              <RadioGroup value={newTypeIcon} onValueChange={setNewTypeIcon} className="grid grid-cols-4 gap-2">
                                  {Object.keys(iconMap).map(iconKey => {
                                      const Icon = iconMap[iconKey];
                                      return (
                                          <div key={iconKey}>
                                              <RadioGroupItem value={iconKey} id={`edit-${iconKey}`} className="peer sr-only" />
                                              <Label htmlFor={`edit-${iconKey}`} className={cn("flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary")}>
                                                  <Icon className="w-5 h-5 mb-1" />
                                                  {iconKey}
                                              </Label>
                                          </div>
                                      )
                                  })}
                              </RadioGroup>
                          </div>
                          <div className="flex gap-2">
                              <Button onClick={handleAddNewType} type="button" className="w-full">Save New Type</Button>
                              <Button variant="outline" onClick={() => setIsAddingType(false)} type="button">Cancel</Button>
                          </div>
                      </div>
                      ) : (
                      <div className="flex gap-2">
                          <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger id="location-type-edit">
                              <SelectValue placeholder="Select a type" />
                          </SelectTrigger>
                          <SelectContent>
                              {locationTypes.map((type) => {
                                  const Icon = iconMap[type.icon];
                                  return (
                                      <SelectItem key={type.id} value={type.id}>
                                          <div className="flex items-center gap-2">
                                            {Icon && <Icon className="w-4 h-4" />}
                                            {type.name}
                                          </div>
                                      </SelectItem>
                                  )
                              })}
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
                          <Label htmlFor="location-description-edit">Description</Label>
                          <Textarea id="location-description-edit" placeholder="Optional: Describe what is typically stored here." {...field} />
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
                          <Checkbox id="refrigerated-edit" checked={field.value} onCheckedChange={field.onChange} />
                          <Label htmlFor="refrigerated-edit" className="font-normal">Refrigerated</Label>
                      </div>
                  )}/>
                  <Controller name="noSunlight" control={control} render={({ field }) => (
                      <div className="flex items-center space-x-2">
                          <Checkbox id="no-sunlight-edit" checked={field.value} onCheckedChange={field.onChange} />
                          <Label htmlFor="no-sunlight-edit" className="font-normal">Keep out of sunlight</Label>
                      </div>
                  )}/>
                  <Controller name="ventilated" control={control} render={({ field }) => (
                      <div className="flex items-center space-x-2">
                          <Checkbox id="ventilated-edit" checked={field.value} onCheckedChange={field.onChange}/>
                          <Label htmlFor="ventilated-edit" className='font-normal'>Ventilated</Label>
                      </div>
                  )}/>
                  <Controller name="humidityControlled" control={control} render={({ field }) => (
                      <div className="flex items-center space-x-2">
                          <Checkbox id="humidity-controlled-edit" checked={field.value} onCheckedChange={field.onChange} />
                          <Label htmlFor="humidity-controlled-edit" className='font-normal'>Humidity Controlled</Label>
                      </div>
                  )}/>
                </div>
                <Controller
                  name="customNeeds"
                  control={control}
                  render={({ field }) => (
                      <div className="space-y-2 pt-2">
                          <Label htmlFor="other-needs-edit">Other Custom Needs</Label>
                          <Input id="other-needs-edit" placeholder="e.g., Must be upright" {...field} />
                      </div>
                  )}
                />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="pt-4 border-t">
            <Button variant="outline" onClick={handleClose} type="button">
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
