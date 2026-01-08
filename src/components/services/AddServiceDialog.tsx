
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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Package, Hammer, Trash2, QrCode, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { inventory, type InventoryItem } from '@/lib/data';
import { BrowseProductsDialog } from './BrowseProductsDialog';
import { SelectEquipmentDialog } from './SelectEquipmentDialog';


const Step1_Basics = ({ 
    onImageUpload, 
    categories, 
    onNewCategory 
}: { 
    onImageUpload: (url: string) => void;
    categories: string[];
    onNewCategory: (category: string) => void;
}) => {
    const [selectedCategory, setSelectedCategory] = useState('');
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    const handleAddNewCategory = () => {
        if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
            const newCategory = newCategoryName.trim();
            onNewCategory(newCategory);
            setSelectedCategory(newCategory);
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };
    
    return (
    <div className="grid gap-6 py-4">
        <div className="space-y-2">
            <Label htmlFor="service-name">Service Name</Label>
            <Input id="service-name" placeholder="e.g., Signature Haircut" />
        </div>
        <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            {isAddingCategory ? (
                <div className="flex gap-2">
                    <Input
                        placeholder="Enter new category name..."
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()}
                    />
                    <Button onClick={handleAddNewCategory} type="button"><Check className="h-4 w-4" /></Button>
                </div>
            ) : (
                <div className="flex gap-2">
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map(cat => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={() => setIsAddingCategory(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> New</Button>
                </div>
            )}
        </div>
        <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
                <Label htmlFor="duration">Duration (min)</Label>
                <Input id="duration" type="number" placeholder="60" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="pad-before">Pad Before (min)</Label>
                <Input id="pad-before" type="number" placeholder="0" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="pad-after">Pad After (min)</Label>
                <Input id="pad-after" type="number" placeholder="15" />
            </div>
        </div>
        <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" placeholder="Describe the service for your booking page..." />
        </div>
        <div className="space-y-2">
            <Label>Service Image</Label>
            <ImageUpload onImageUploaded={onImageUpload} />
        </div>
        <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className='space-y-1'>
                <Label htmlFor="private-service">Private Service</Label>
                <p className='text-sm text-muted-foreground'>Hide from public booking page.</p>
            </div>
            <Switch id="private-service" />
        </div>
         <div className="space-y-2">
            <Label>Required Consent Forms</Label>
            <Card>
                <CardContent className="p-4 text-center text-sm text-muted-foreground">
                    Consent form selection will go here.
                </CardContent>
            </Card>
        </div>
    </div>
    );
};

const Step2_Formula = ({
    selectedProducts,
    onProductsChange,
    selectedEquipment,
    onEquipmentChange,
}: {
    selectedProducts: InventoryItem[];
    onProductsChange: (products: InventoryItem[]) => void;
    selectedEquipment: InventoryItem[];
    onEquipmentChange: (equipment: InventoryItem[]) => void;
}) => {
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isEquipmentSelectorOpen, setIsEquipmentSelectorOpen] = useState(false);

    const handleProductSelect = (products: InventoryItem[]) => {
        onProductsChange(products);
        setIsProductBrowserOpen(false);
    };
    
    const handleEquipmentSelect = (equipment: InventoryItem[]) => {
        onEquipmentChange(equipment);
        setIsEquipmentSelectorOpen(false);
    };

    const removeProduct = (productId: string) => {
        onProductsChange(selectedProducts.filter(p => p.id !== productId));
    };

    const removeEquipment = (equipmentId: string) => {
        onEquipmentChange(selectedEquipment.filter(e => e.id !== equipmentId));
    };

    return (
    <>
    <div className="grid gap-6 py-4">
        <div className="space-y-4">
            <div className="space-y-2">
                <div className='flex items-center gap-2'>
                    <Package className="w-5 h-5 text-primary" />
                    <Label className="text-lg font-semibold">Product Formula</Label>
                </div>
                {selectedProducts.length > 0 ? (
                    <Card>
                        <CardContent className="p-2 space-y-2">
                            {selectedProducts.map(product => (
                                <div key={product.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                    <span className="text-sm font-medium">{product.name}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeProduct(product.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                 ) : (
                    <Card>
                        <CardContent className="p-4 text-center text-sm text-muted-foreground">
                            No products added yet.
                        </CardContent>
                    </Card>
                 )}
                <div className='flex gap-2'>
                    <Button variant="outline" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Browse Library</Button>
                    <Button variant="outline"><QrCode className="mr-2 h-4 w-4" /> Scan to Add</Button>
                </div>
            </div>
        </div>
        <div className="space-y-4">
            <div className="space-y-2">
                 <div className='flex items-center gap-2'>
                    <Hammer className="w-5 h-5 text-primary" />
                    <Label className="text-lg font-semibold">Equipment Used</Label>
                </div>
                {selectedEquipment.length > 0 ? (
                    <Card>
                         <CardContent className="p-2 space-y-2">
                            {selectedEquipment.map(item => (
                                <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                    <span className="text-sm font-medium">{item.name}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeEquipment(item.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="p-4 text-center text-sm text-muted-foreground">
                            No equipment added.
                        </CardContent>
                    </Card>
                )}
                <Button variant="outline" onClick={() => setIsEquipmentSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Select Equipment</Button>
            </div>
        </div>
         <div className="space-y-4">
            <div className="space-y-2">
                 <div className='flex items-center gap-2'>
                    <PlusCircle className="w-5 h-5 text-primary" />
                    <Label className="text-lg font-semibold">Compatible Add-ons</Label>
                </div>
                 <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                        No add-ons selected.
                    </CardContent>
                </Card>
                <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
            </div>
        </div>
    </div>
    <BrowseProductsDialog
        open={isProductBrowserOpen}
        onOpenChange={setIsProductBrowserOpen}
        onSelect={handleProductSelect}
        allProducts={inventory.filter(i => i.type === 'professional' || i.type === 'retail')}
        initialSelected={selectedProducts}
    />
     <SelectEquipmentDialog
        open={isEquipmentSelectorOpen}
        onOpenChange={setIsEquipmentSelectorOpen}
        onSelect={handleEquipmentSelect}
        allEquipment={inventory.filter(i => i.type === 'equipment')}
        initialSelected={selectedEquipment}
    />
    </>
);

const Step3_Deposits = () => {
    const [depositType, setDepositType] = useState('none');
    
    return (
        <div className="grid gap-6 py-4">
             <div className="space-y-2">
                <Label>Deposit Requirement</Label>
                <RadioGroup
                    value={depositType}
                    onValueChange={setDepositType}
                    className="grid grid-cols-3 gap-2"
                >
                    <div>
                    <RadioGroupItem value="none" id="none" className="peer sr-only" />
                    <Label htmlFor="none" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">None</Label>
                    </div>
                    <div>
                    <RadioGroupItem value="deposit" id="deposit" className="peer sr-only" />
                    <Label htmlFor="deposit" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Deposit</Label>
                    </div>
                    <div>
                    <RadioGroupItem value="full" id="full" className="peer sr-only" />
                    <Label htmlFor="full" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Pay in Full</Label>
                    </div>
                </RadioGroup>
            </div>

            {depositType === 'deposit' && (
                 <Card className="bg-muted/50">
                    <CardContent className="p-4 space-y-4">
                         <div className="space-y-2">
                            <Label>Deposit Type</Label>
                            <Select>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select deposit type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="flat">Flat Rate</SelectItem>
                                    <SelectItem value="percentage">Percentage</SelectItem>
                                    <SelectItem value="break-even">Break-Even Cost</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Deposit Amount</Label>
                            <Input type="number" placeholder="25.00" />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

const Step4_Pricing = () => {
    const [pricingStrategy, setPricingStrategy] = useState('manual');
    const [margin, setMargin] = useState(60);

    return (
        <div className="grid gap-6 py-4">
            <div className="space-y-2">
                <Label>Pricing Strategy</Label>
                <RadioGroup
                    value={pricingStrategy}
                    onValueChange={setPricingStrategy}
                    className="grid grid-cols-2 gap-2"
                >
                    <div>
                        <RadioGroupItem value="manual" id="manual" className="peer sr-only" />
                        <Label htmlFor="manual" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Manual</Label>
                    </div>
                    <div>
                        <RadioGroupItem value="auto" id="auto" className="peer sr-only" />
                        <Label htmlFor="auto" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Auto (Margin-Based)</Label>
                    </div>
                </RadioGroup>
            </div>
            
            {pricingStrategy === 'manual' ? (
                <div className="space-y-2">
                    <Label htmlFor="final-price">Final Price</Label>
                    <Input id="final-price" type="number" placeholder="100.00" />
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex justify-between items-baseline">
                        <Label>Desired Profit Margin</Label>
                        <span className="text-2xl font-bold text-primary">{margin}%</span>
                    </div>
                    <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[margin]}
                        onValueChange={(value) => setMargin(value[0])}
                    />
                </div>
            )}

            <Card>
                <CardContent className="p-4 space-y-4">
                    <h4 className="font-semibold text-center">Profitability Preview</h4>
                    <div className="flex justify-between items-center p-4 rounded-lg bg-primary/10">
                        <div>
                        <p className="text-sm text-primary/80">Final Price</p>
                        <p className="text-2xl font-bold text-primary">$100.00</p>
                        </div>
                    </div>
                     <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                            <span>Break-Even Cost:</span>
                            <span className="font-mono text-destructive">$35.00</span>
                        </div>
                        <div className="flex justify-between font-medium border-t pt-2 mt-2">
                            <span>Net Profit:</span>
                            <span className="text-primary">$65.00</span>
                        </div>
                         <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Profit Margin:</span>
                            <span className="text-primary">65.0%</span>
                        </div>
                    </div>
                     <Progress value={65} className="h-2 text-green-500" />
                </CardContent>
            </Card>

        </div>
    );
};

export const AddServiceDialog = ({ 
    open, 
    onOpenChange,
    categories,
    onNewCategory,
}: { 
    open: boolean; 
    onOpenChange: (open: boolean) => void;
    categories: string[];
    onNewCategory: (category: string) => void;
}) => {
  const [step, setStep] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<InventoryItem[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<InventoryItem[]>([]);
  const totalSteps = 4;
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
        setTimeout(() => {
          setStep(1);
          setImageUrl(null);
          setSelectedProducts([]);
          setSelectedEquipment([]);
        }, 300);
    }
  }

  const handleNext = () => step < totalSteps && setStep(step + 1);
  const handleBack = () => step > 1 && setStep(step - 1);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add New Service</DialogTitle>
          <DialogDescription>
            Create a new service for your menu. Follow the steps to ensure accurate pricing.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <Progress value={(step / totalSteps) * 100} />
           <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                {step === 1 && <Step1_Basics onImageUpload={setImageUrl} categories={categories} onNewCategory={onNewCategory} />}
                {step === 2 && <Step2_Formula 
                    selectedProducts={selectedProducts}
                    onProductsChange={setSelectedProducts}
                    selectedEquipment={selectedEquipment}
                    onEquipmentChange={setSelectedEquipment}
                />}
                {step === 3 && <Step3_Deposits />}
                {step === 4 && <Step4_Pricing />}
           </div>
        </div>

        <DialogFooter>
          <div className='flex justify-between w-full'>
              <div>
                {step > 1 && <Button variant="outline" onClick={handleBack}>Back</Button>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
                {step < totalSteps ? (
                    <Button onClick={handleNext}>Next</Button>
                ) : (
                    <Button>Save Service</Button>
                )}
              </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

    