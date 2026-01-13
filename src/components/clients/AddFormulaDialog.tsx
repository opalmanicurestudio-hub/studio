
'use client';

import React, { useState, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type CustomFormula, type InventoryItem } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '../ui/card';

type EditableFormulaItem = {
    productId: string;
    productName: string;
    quantityUsed: number;
    unit: string;
    note?: string;
};

interface AddFormulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (formula: CustomFormula) => void;
}

const AddFormulaForm = ({
  onSave,
  onCancel,
}: {
  onSave: (formula: CustomFormula) => void;
  onCancel: () => void;
}) => {
  const { inventory } = useInventory();
  const [formulaName, setFormulaName] = useState('');
  const [items, setItems] = useState<EditableFormulaItem[]>([]);
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const { toast } = useToast();

  const handleAddProducts = (products: InventoryItem[]) => {
    const newItems: EditableFormulaItem[] = products.map(p => ({
      productId: p.id,
      productName: p.name,
      quantityUsed: 1,
      unit: p.unit || 'uses',
    }));
    
    setItems(prev => {
        const existingIds = new Set(prev.map(item => item.productId));
        const filteredNewItems = newItems.filter(newItem => !existingIds.has(newItem.productId));
        return [...prev, ...filteredNewItems];
    });

    setIsProductBrowserOpen(false);
  };

  const handleItemChange = (productId: string, field: keyof EditableFormulaItem, value: string | number) => {
    setItems(prev =>
      prev.map(item =>
        item.productId === productId ? { ...item, [field]: value } : item
      )
    );
  };
  
  const handleRemoveItem = (productId: string) => {
    setItems(prev => prev.filter(item => item.productId !== productId));
  };
  
  const handleSaveClick = () => {
    if (!formulaName.trim()) {
      toast({ variant: 'destructive', title: 'Missing Name', description: 'Please give your formula a name.' });
      return;
    }
    if (items.length === 0) {
      toast({ variant: 'destructive', title: 'Empty Formula', description: 'Please add at least one product to the formula.' });
      return;
    }

    const newFormula: CustomFormula = {
      name: formulaName,
      items: items,
    };
    onSave(newFormula);
  };

  return (
    <>
      <form id="add-formula-form" onSubmit={(e) => { e.preventDefault(); handleSaveClick(); }}>
        <ScrollArea className="h-[70vh] pr-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="formula-name">Formula Name</Label>
              <Input
                id="formula-name"
                placeholder="e.g., Summer Highlights, Standard Root Color"
                value={formulaName}
                onChange={e => setFormulaName(e.target.value)}
              />
            </div>
            
            <Card>
                <CardContent className="p-4 space-y-3">
                     <h3 className="font-medium">Products</h3>
                     {items.length > 0 ? (
                         <div className="space-y-3">
                            {items.map(item => (
                                <div key={item.productId} className="p-3 bg-muted/50 rounded-lg space-y-3">
                                    <div className="flex justify-between items-start">
                                        <p className="font-semibold text-sm">{item.productName}</p>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 -mt-1 -mr-1 text-destructive" onClick={() => handleRemoveItem(item.productId)}><Trash2 className="w-4 h-4"/></Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label htmlFor={`qty-${item.productId}`} className="text-xs">Quantity</Label>
                                            <Input id={`qty-${item.productId}`} type="number" value={item.quantityUsed} onChange={e => handleItemChange(item.productId, 'quantityUsed', parseFloat(e.target.value) || 0)} className="h-9"/>
                                        </div>
                                         <div className="space-y-1">
                                            <Label htmlFor={`unit-${item.productId}`} className="text-xs">Unit</Label>
                                            <Input id={`unit-${item.productId}`} value={item.unit} onChange={e => handleItemChange(item.productId, 'unit', e.target.value)} className="h-9"/>
                                        </div>
                                    </div>
                                     <div className="space-y-1">
                                        <Label htmlFor={`note-${item.productId}`} className="text-xs">Note (Optional)</Label>
                                        <Input id={`note-${item.productId}`} value={item.note || ''} onChange={e => handleItemChange(item.productId, 'note', e.target.value)} placeholder="e.g., Apply to roots first" className="h-9"/>
                                    </div>
                                </div>
                            ))}
                         </div>
                     ) : (
                        <p className="text-sm text-center text-muted-foreground py-4">No products added yet.</p>
                     )}
                      <Button type="button" variant="outline" className="w-full" onClick={() => setIsProductBrowserOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Products from Inventory
                    </Button>
                </CardContent>
            </Card>
           
          </div>
        </ScrollArea>
      </form>
      <BrowseProductsDialog
        open={isProductBrowserOpen}
        onOpenChange={setIsProductBrowserOpen}
        onSelect={handleAddProducts}
        allProducts={inventory.filter(p => p.type === 'professional')}
        initialSelected={[]}
      />
    </>
  );
};

export const AddFormulaDialog: React.FC<AddFormulaDialogProps> = ({ open, onOpenChange, onSave }) => {
  const isMobile = useIsMobile();
  const title = "Add New Formula";
  const description = "Create a reusable custom formula for this client.";

  const handleSave = (formula: CustomFormula) => {
    onSave(formula);
    onOpenChange(false);
  };
  
  const FormContent = <AddFormulaForm onSave={handleSave} onCancel={() => onOpenChange(false)} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95dvh] flex flex-col">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto">{FormContent}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="add-formula-form">Save Formula</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">{FormContent}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-formula-form">Save Formula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
