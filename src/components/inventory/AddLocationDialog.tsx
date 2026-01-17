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
import { PlusCircle, Upload, Save, Check, Box, Building, Store, ClipboardList, LucideIcon } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { cn } from '@/lib/utils';
import { Location } from '@/lib/data';

export type LocationType = {
  id: string;
  name: string;
  icon: string;
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

const iconMap: { [key: string]: { component: LucideIcon, label: string } } = {
    Box: { component: Box, label: 'Box' },
    Building: { component: Building, label: 'Building' },
    Store: { component: Store, label: 'Store' },
    ClipboardList: { component: ClipboardList, label: 'Clipboard' },
};

export const AddLocationDialog = ({
  open,
  onOpenChange,
  onSave,
  locationTypes,
  onAddNewLocationType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Omit<Location, 'id'>) => Location;
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
        const newType = onAddNewLocationType(newTypeName.trim(), newTypeIcon);
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
                    <div className="p-4 border rounded-lg space-y-4">
                        <Input 
                            placeholder="Enter new type name..." 
                            value={newTypeName}
                            onChange={(e) => setNewTypeName(e.target.value)}
                        />
                        <div>
                            <Label className="mb-2 block">Icon</Label>
                             <RadioGroup value={newTypeIcon} onValueChange={setNewTypeIcon} className="grid grid-cols-4 gap-2">
                                {Object.entries(iconMap).map(([iconKey, { component: Icon, label }]) => (
                                    <div key={iconKey}>
                                        <RadioGroupItem value={iconKey} id={iconKey} className="peer sr-only" />
                                        <Label htmlFor={iconKey} className={cn("flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary whitespace-nowrap")}>
                                            <Icon className="w-5 h-5 mb-1" />
                                            {label}
                                        </Label>
                                    </div>
                                ))}
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
                        <SelectTrigger id="location-type">
                            <SelectValue placeholder="Select a type" />
                        </SelectTrigger>
                        <SelectContent>
                            {locationTypes.map((type) => {
                                const Icon = iconMap[type.icon]?.component;
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
