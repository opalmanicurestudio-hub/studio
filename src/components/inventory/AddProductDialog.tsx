
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Info, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { AddLocationDialog, type Location, type LocationType } from './AddLocationDialog';


export type ProductType = 'professional' | 'retail' | 'both';

const Step1_BasicDetails = ({ productType, setProductType }: { productType: ProductType, setProductType: (type: ProductType) => void }) => (
  <div className="grid gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" placeholder="e.g., Hydrating Shampoo" />
    </div>
    <div className="space-y-2">
      <Label>Product Type</Label>
      <RadioGroup
        value={productType}
        onValueChange={(value: string) => setProductType(value as ProductType)}
        className="grid grid-cols-3 gap-2"
      >
        <div>
          <RadioGroupItem value="professional" id="professional" className="peer sr-only" />
          <Label htmlFor="professional" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Professional</Label>
        </div>
        <div>
          <RadioGroupItem value="retail" id="retail" className="peer sr-only" />
          <Label htmlFor="retail" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Retail</Label>
        </div>
         <div>
          <RadioGroupItem value="both" id="both" className="peer sr-only" />
          <Label htmlFor="both" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Both</Label>
        </div>
      </RadioGroup>
    </div>
    <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <div className="flex gap-2">
            <Select>
                <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="color">Color</SelectItem>
                    <SelectItem value="styling">Styling</SelectItem>
                    <SelectItem value="care">Care</SelectItem>
                </SelectContent>
            </Select>
            <Button variant="outline" size="icon"><PlusCircle className="h-4 w-4" /></Button>
        </div>
    </div>
     <div className="space-y-2">
        <Label>Image</Label>
        <Button variant="outline" className="w-full">Upload Image</Button>
    </div>
    <div className="space-y-2">
      <Label htmlFor="internal-notes">Internal Notes</Label>
      <Textarea id="internal-notes" placeholder="Private notes or usage instructions..." />
    </div>
  </div>
);

const Step2_CostingPricing = ({ productType }: { productType: ProductType }) => {
    const [costingMethod, setCostingMethod] = useState('by-size');

    return (
    <div className="grid gap-6 py-4">
        { (productType === 'professional' || productType === 'both') && (
            <Card>
                <CardHeader>
                    <CardTitle>Professional Costing</CardTitle>
                    <CardDescription>How much does it cost to use this once in a service?</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="space-y-2">
                        <Label>Costing Method</Label>
                        <RadioGroup defaultValue="by-size" onValueChange={setCostingMethod} className="grid grid-cols-2 gap-2">
                            <div>
                                <RadioGroupItem value="by-size" id="by-size" className="peer sr-only" />
                                <Label htmlFor="by-size" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Size</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="by-uses" id="by-uses" className="peer sr-only" />
                                <Label htmlFor="by-uses" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">By Uses</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {costingMethod === 'by-size' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="container-size">Container Size</Label>
                                <Input id="container-size" type="number" placeholder="e.g., 1000" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unit</Label>
                                 <Select>
                                    <SelectTrigger id="unit">
                                        <SelectValue placeholder="Select unit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ml">ml</SelectItem>
                                        <SelectItem value="oz">oz</SelectItem>
                                        <SelectItem value="g">g</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    ) : (
                         <div className="space-y-2">
                            <Label htmlFor="estimated-uses">Estimated Uses Per Container</Label>
                            <Input id="estimated-uses" type="number" placeholder="e.g., 50" />
                        </div>
                    )}
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <Switch id="cost-experiment" />
                            <Label htmlFor="cost-experiment">Cost-Per-Use Experiment</Label>
                        </div>
                        <Info className="h-4 w-4 text-muted-foreground" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="restocking-markup">Restocking Markup</Label>
                        <div className="relative">
                            <Input id="restocking-markup" type="number" placeholder="e.g., 5" className="pl-8"/>
                             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )}

        { (productType === 'retail' || productType === 'both') && (
            <Card>
                <CardHeader>
                    <CardTitle>Retail Pricing</CardTitle>
                    <CardDescription>How much will clients pay for this product?</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="msrp">MSRP</Label>
                        <Input id="msrp" type="number" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="markdown-price">Markdown Price</Label>
                        <Input id="markdown-price" type="number" placeholder="Optional sale price" />
                    </div>
                </CardContent>
            </Card>
        )}
        
        <Card>
            <CardHeader>
                <CardTitle>Landed Cost</CardTitle>
                <CardDescription>Calculate the true cost per item after fees.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="total-cost">Total Cost of Goods</Label>
                        <Input id="total-cost" type="number" placeholder="From invoice" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="num-units">Number of Units</Label>
                        <Input id="num-units" type="number" placeholder="In shipment" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="shipping">Shipping</Label>
                        <Input id="shipping" type="number" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="taxes">Taxes</Label>
                        <Input id="taxes" type="number" placeholder="0.00" />
                    </div>
                </div>
                <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                    <span className="font-medium">Landed Cost Per Item:</span>
                    <span className="text-lg font-bold text-primary">$0.00</span>
                </div>
            </CardContent>
        </Card>
    </div>
    );
};


const Step3_InventorySupplier = ({ onAddLocationClick, locations }: { onAddLocationClick: () => void, locations: Location[] }) => {
    const [secondaryLocations, setSecondaryLocations] = useState<string[]>([]);
    const addSecondaryLocation = () => setSecondaryLocations(prev => [...prev, `loc-${Date.now()}`]);
    const removeSecondaryLocation = (id: string) => setSecondaryLocations(prev => prev.filter(locId => locId !== id));

    return (
    <div className="grid gap-6 py-4">
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                 <Select>
                    <SelectTrigger>
                        <SelectValue placeholder="Select vendor" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="vendor-a">Vendor A</SelectItem>
                        <SelectItem value="vendor-b">Vendor B</SelectItem>
                    </SelectContent>
                </Select>
            </div>
             <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" placeholder="Product SKU" />
            </div>
        </div>
         <div className="space-y-2">
            <Label htmlFor="low-stock-point">Low Stock Point</Label>
            <Input id="low-stock-point" type="number" placeholder="e.g., 5" />
        </div>

        <Card>
            <CardHeader>
                <CardTitle>Storage Locations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Primary Location</Label>
                    <div className="flex gap-2">
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="Select primary location" />
                            </SelectTrigger>
                            <SelectContent>
                                {locations.map(loc => (
                                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                         <Button variant="outline" size="icon" onClick={onAddLocationClick}><PlusCircle className="h-4 w-4" /></Button>
                    </div>
                </div>
                 <div className="space-y-2">
                    {secondaryLocations.map((locId) => (
                        <div key={locId} className="space-y-2">
                             <Label className="text-muted-foreground">Secondary Location</Label>
                             <div className="flex gap-2">
                                <Select>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select secondary location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                         {locations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeSecondaryLocation(locId)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addSecondaryLocation}><PlusCircle className="mr-2 h-4 w-4" />Add Secondary Location</Button>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Initial Stock</CardTitle>
                <CardDescription>Log the first batch of this product you have on hand.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="initial-quantity">Quantity</Label>
                    <Input id="initial-quantity" type="number" placeholder="0" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="expiration-date">Expiration Date</Label>
                    <Input id="expiration-date" type="date" />
                </div>
            </CardContent>
        </Card>

    </div>
    )
};


export const AddProductDialog = ({ 
    open, 
    onOpenChange, 
    locations,
    locationTypes,
    onAddNewLocationType,
    isAddLocationDialogOpen, 
    onAddLocationDialogOpenChange,
    onAddNewLocation,
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    locations: Location[],
    locationTypes: LocationType[],
    onAddNewLocationType: (name: string) => LocationType,
    isAddLocationDialogOpen: boolean, 
    onAddLocationDialogOpenChange: (open: boolean) => void,
    onAddNewLocation: (newLocation: Omit<Location, 'id'>) => void,
}) => {
  const [step, setStep] = useState(1);
  const [productType, setProductType] = useState<ProductType>('professional');
  const totalSteps = 3;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        // Reset state when dialog closes
        setTimeout(() => {
            setStep(1);
            setProductType('professional');
        }, 300);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Product</DialogTitle>
          <DialogDescription>Create a new professional or retail product for your inventory.</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
            <Progress value={(step / totalSteps) * 100} />
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                {step === 1 && <Step1_BasicDetails productType={productType} setProductType={setProductType} />}
                {step === 2 && <Step2_CostingPricing productType={productType} />}
                {step === 3 && <Step3_InventorySupplier onAddLocationClick={() => onAddLocationDialogOpenChange(true)} locations={locations}/>}
            </div>
        </div>

        <DialogFooter>
          <div className='flex justify-between w-full'>
              <div>
                {step > 1 && <Button variant="outline" onClick={handleBack}>Back</Button>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
                {step < totalSteps && <Button onClick={handleNext}>Next</Button>}
                {step === totalSteps && <Button>Save Product</Button>}
              </div>
          </div>
        </DialogFooter>

        <AddLocationDialog 
            open={isAddLocationDialogOpen} 
            onOpenChange={onAddLocationDialogOpenChange}
            onSave={onAddNewLocation}
            locations={locations}
            locationTypes={locationTypes}
            onAddNewLocationType={onAddNewLocationType}
        />

      </DialogContent>
    </Dialog>
  );
};
