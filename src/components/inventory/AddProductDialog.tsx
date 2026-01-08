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
import { PlusCircle } from 'lucide-react';

const Step1_BasicDetails = () => (
  <div className="grid gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="product-name">Product Name</Label>
      <Input id="product-name" placeholder="e.g., Hydrating Shampoo" />
    </div>
    <div className="space-y-2">
      <Label>Product Type</Label>
      <RadioGroup defaultValue="professional" className="grid grid-cols-3 gap-2">
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

const Step2_CostingPricing = () => (
    <div className="grid gap-6 py-4">
        <div className="p-4 border rounded-lg space-y-4">
            <h4 className="font-semibold">Landed Cost Calculator</h4>
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
        </div>
         <div className="space-y-4">
            <Label>Costing Method (for Professional Use)</Label>
            <RadioGroup defaultValue="by-size" className="grid grid-cols-2 gap-2">
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
         <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label htmlFor="msrp">MSRP</Label>
                <Input id="msrp" type="number" placeholder="0.00" />
            </div>
             <div className="space-y-2">
                <Label htmlFor="markdown-price">Markdown Price</Label>
                <Input id="markdown-price" type="number" placeholder="Optional sale price" />
            </div>
        </div>
    </div>
);

const Step3_InventorySupplier = () => (
    <div className="grid gap-4 py-4">
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input id="vendor" placeholder="Supplier name" />
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
        <div className="p-4 border rounded-lg space-y-4">
            <h4 className="font-semibold">Initial Stock</h4>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="initial-quantity">Quantity</Label>
                    <Input id="initial-quantity" type="number" placeholder="0" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="expiration-date">Expiration Date</Label>
                    <Input id="expiration-date" type="date" />
                </div>
            </div>
        </div>
    </div>
);


export const AddProductDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
  const [step, setStep] = useState(1);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Product</DialogTitle>
          <DialogDescription>Create a new professional or retail product for your inventory.</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
            <Progress value={(step / totalSteps) * 100} />
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                {step === 1 && <Step1_BasicDetails />}
                {step === 2 && <Step2_CostingPricing />}
                {step === 3 && <Step3_InventorySupplier />}
            </div>
        </div>

        <DialogFooter>
          <div className='flex justify-between w-full'>
              <div>
                {step > 1 && <Button variant="outline" onClick={handleBack}>Back</Button>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                {step < totalSteps && <Button onClick={handleNext}>Next</Button>}
                {step === totalSteps && <Button>Save Product</Button>}
              </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
