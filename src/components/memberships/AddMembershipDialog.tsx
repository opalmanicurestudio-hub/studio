'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Trash2, DollarSign, Percent, Award } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Membership, type Service, type InventoryItem, type MembershipPerk } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useInventory } from '@/context/InventoryContext';

interface AddMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (membership: Membership) => void;
  membershipToEdit: Membership | null;
}

const ProfitabilityAnalysis = ({ perks, price }: { perks: { services: MembershipPerk[], addOns: MembershipPerk[], products: MembershipPerk[] }, price: number }) => {
    const { services, inventory } = useInventory();
    
    const totalCostOfPerks = useMemo(() => {
        const servicesCost = perks.services.reduce((acc, perk) => {
            const s = services.find(svc => svc.id === perk.id);
            return acc + (s?.cost || 0) * (perk.quantity || 1);
        }, 0);
        const addOnsCost = perks.addOns.reduce((acc, perk) => {
            const s = services.find(svc => svc.id === perk.id);
            return acc + (s?.cost || 0) * (perk.quantity || 1);
        }, 0);
        const productsCost = perks.products.reduce((acc, perk) => {
            const p = inventory.find(inv => inv.id === perk.id);
            return acc + (p?.costPerUnit || 0) * (perk.quantity || 1);
        }, 0);
        return servicesCost + addOnsCost + productsCost;
    }, [perks, services, inventory]);

    const netProfit = price - totalCostOfPerks;
    const profitMargin = price > 0 ? (netProfit / price) * 100 : 0;
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Profitability Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Membership Price</span>
                    <span>${price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost of Perks</span>
                    <span className="text-destructive">-${totalCostOfPerks.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-2 mt-2">
                    <span>Net Profit</span>
                    <span className={netProfit >= 0 ? 'text-primary' : 'text-destructive'}>${netProfit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Profit Margin</span>
                    <span>{profitMargin.toFixed(1)}%</span>
                </div>
            </CardContent>
        </Card>
    )
};


export const AddMembershipDialog: React.FC<AddMembershipDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  membershipToEdit,
}) => {
  const isMobile = useIsMobile();
  const { services, inventory } = useInventory();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [isPrivate, setIsPrivate] = useState(false);
  
  const [includedServices, setIncludedServices] = useState<MembershipPerk[]>([]);
  const [includedAddOns, setIncludedAddOns] = useState<MembershipPerk[]>([]);
  const [includedProducts, setIncludedProducts] = useState<MembershipPerk[]>([]);
  const [retailDiscount, setRetailDiscount] = useState<number>(0);

  const [forfeitOnLateCancel, setForfeitOnLateCancel] = useState(true);
  const [forfeitOnNoShow, setForfeitOnNoShow] = useState(true);
  const [allowRollover, setAllowRollover] = useState(false);

  const [isServiceSelectorOpen, setIsServiceSelectorOpen] = useState(false);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductSelectorOpen, setIsProductSelectorOpen] = useState(false);

  useEffect(() => {
    if (membershipToEdit) {
      setName(membershipToEdit.name);
      setDescription(membershipToEdit.description || '');
      setPrice(membershipToEdit.price);
      setInterval(membershipToEdit.interval);
      setIsPrivate(membershipToEdit.isPrivate);
      setIncludedServices(membershipToEdit.includedServices || []);
      setIncludedAddOns(membershipToEdit.includedAddOns || []);
      setIncludedProducts(membershipToEdit.includedProducts || []);
      setRetailDiscount(membershipToEdit.retailDiscount || 0);
      setForfeitOnLateCancel(membershipToEdit.forfeitOnLateCancel);
      setForfeitOnNoShow(membershipToEdit.forfeitOnNoShow);
      setAllowRollover(membershipToEdit.allowRollover);
    } else {
      setName('');
      setDescription('');
      setPrice(0);
      setInterval('monthly');
      setIsPrivate(false);
      setIncludedServices([]);
      setIncludedAddOns([]);
      setIncludedProducts([]);
      setRetailDiscount(0);
      setForfeitOnLateCancel(true);
      setForfeitOnNoShow(true);
      setAllowRollover(false);
    }
  }, [membershipToEdit, open]);

  const handleSave = () => {
    const membershipData: Membership = {
      id: membershipToEdit?.id || `mem-${Date.now()}`,
      name,
      description,
      price,
      interval,
      isPrivate,
      includedServices,
      includedAddOns,
      includedProducts,
      retailDiscount,
      forfeitOnLateCancel,
      forfeitOnNoShow,
      allowRollover,
    };
    onSave(membershipData);
    onOpenChange(false);
  };

  const updatePerkQuantity = (type: 'service' | 'addon' | 'product', id: string, quantity: number) => {
      const updater = (prev: MembershipPerk[]) => prev.map(p => p.id === id ? { ...p, quantity } : p);
      if (type === 'service') setIncludedServices(updater);
      if (type === 'addon') setIncludedAddOns(updater);
      if (type === 'product') setIncludedProducts(updater);
  };

  const removeItem = (type: 'service' | 'addon' | 'product', id: string) => {
    if (type === 'service') setIncludedServices(prev => prev.filter(s => s.id !== id));
    if (type === 'addon') setIncludedAddOns(prev => prev.filter(s => s.id !== id));
    if (type === 'product') setIncludedProducts(prev => prev.filter(p => p.id !== id));
  }

  const FormContent = (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Core Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="mem-name">Name</Label>
                <Input id="mem-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., VIP Glow Club" />
            </div>
             <div className="space-y-2">
                <Label htmlFor="mem-desc">Description</Label>
                <Textarea id="mem-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g., Exclusive monthly perks for our most loyal clients." />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="mem-price">Price</Label>
                    <Input id="mem-price" type="number" value={price || ''} onChange={e => setPrice(Number(e.target.value))} placeholder="99.00" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="mem-interval">Interval</Label>
                    <Select value={interval} onValueChange={(v: any) => setInterval(v)}>
                        <SelectTrigger id="mem-interval"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="yearly">Yearly</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
             <div className="flex items-center justify-between pt-2">
                <Label htmlFor="mem-private">Private Membership</Label>
                <Switch id="mem-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>
        </CardContent>
      </Card>
      
      <Card>
          <CardHeader><CardTitle>Included Perks</CardTitle></CardHeader>
          <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Included Services</Label>
                {includedServices.length > 0 && (
                    <div className="space-y-2">
                    {includedServices.map(perk => (
                        <div key={perk.id} className="flex gap-2 items-center bg-muted/50 p-2 rounded-md">
                            <span className="text-sm flex-1 truncate">{perk.name}</span>
                            <div className="flex items-center gap-2">
                                <Label className="text-[10px]">Qty</Label>
                                <Input 
                                    type="number" 
                                    value={perk.quantity || ''} 
                                    onChange={e => updatePerkQuantity('service', perk.id, parseInt(e.target.value) || 0)} 
                                    className="w-14 h-8 text-center"
                                />
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem('service', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                    ))}
                    </div>
                )}
                <Button variant="outline" className="w-full" onClick={() => setIsServiceSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Select Services</Button>
              </div>
               <div className="space-y-2">
                <Label>Included Add-ons</Label>
                 {includedAddOns.length > 0 && (
                    <div className="space-y-2">
                    {includedAddOns.map(perk => (
                        <div key={perk.id} className="flex gap-2 items-center bg-muted/50 p-2 rounded-md">
                            <span className="text-sm flex-1 truncate">{perk.name}</span>
                            <div className="flex items-center gap-2">
                                <Label className="text-[10px]">Qty</Label>
                                <Input 
                                    type="number" 
                                    value={perk.quantity || ''} 
                                    onChange={e => updatePerkQuantity('addon', perk.id, parseInt(e.target.value) || 0)} 
                                    className="w-14 h-8 text-center"
                                />
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem('addon', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                    ))}
                    </div>
                )}
                 <Button variant="outline" className="w-full" onClick={() => setIsAddOnSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Select Add-ons</Button>
              </div>
              <div className="space-y-2">
                <Label>Included Products</Label>
                 {includedProducts.length > 0 && (
                    <div className="space-y-2">
                    {includedProducts.map(perk => (
                        <div key={perk.id} className="flex gap-2 items-center bg-muted/50 p-2 rounded-md">
                            <span className="text-sm flex-1 truncate">{perk.name}</span>
                            <div className="flex items-center gap-2">
                                <Label className="text-[10px]">Qty</Label>
                                <Input 
                                    type="number" 
                                    value={perk.quantity || ''} 
                                    onChange={e => updatePerkQuantity('product', perk.id, parseInt(e.target.value) || 0)} 
                                    className="w-14 h-8 text-center"
                                />
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem('product', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                    ))}
                    </div>
                )}
                 <Button variant="outline" className="w-full" onClick={() => setIsProductSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Select Products</Button>
              </div>
              <div className="space-y-2">
                  <Label htmlFor="retail-discount">Retail Discount (%)</Label>
                  <div className="relative">
                      <Input id="retail-discount" type="number" value={retailDiscount || ''} onChange={e => setRetailDiscount(Number(e.target.value))} placeholder="e.g., 15" className="pr-8" />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
              </div>
          </CardContent>
      </Card>

      <Card>
          <CardHeader><CardTitle>Policies</CardTitle></CardHeader>
          <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="forfeit-cancel">Forfeit on Late Cancellation</Label>
                <Switch id="forfeit-cancel" checked={forfeitOnLateCancel} onCheckedChange={setForfeitOnLateCancel} />
            </div>
             <div className="flex items-center justify-between">
                <Label htmlFor="forfeit-noshow">Forfeit on No-Show</Label>
                <Switch id="forfeit-noshow" checked={forfeitOnNoShow} onCheckedChange={setForfeitOnNoShow} />
            </div>
             <div className="flex items-center justify-between">
                <Label htmlFor="allow-rollover">Allow Rollover</Label>
                <Switch id="allow-rollover" checked={allowRollover} onCheckedChange={setAllowRollover} />
            </div>
          </CardContent>
      </Card>

       <ProfitabilityAnalysis perks={{ services: includedServices, addOns: includedAddOns, products: includedProducts }} price={price} />
    </div>
  );

  const dialogTitle = membershipToEdit ? `Edit: ${membershipToEdit.name}` : 'Create New Membership';

  return (
    <>
        <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
            <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>Define the details and perks for this membership tier.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] -mr-6 pr-6">
                <div className="py-4 pl-6">
                    {FormContent}
                </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t pr-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Membership</Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>

         <BrowseProductsDialog
            open={isServiceSelectorOpen}
            onOpenChange={setIsServiceSelectorOpen}
            onSelect={(selected) => setIncludedServices(selected.map(s => {
                const existing = includedServices.find(p => p.id === s.id);
                return { id: s.id, name: s.name, quantity: existing?.quantity || 1 };
            }))}
            allProducts={services.filter(s => s.type === 'service')}
            initialSelected={services.filter(s => includedServices.some(p => p.id === s.id))}
        />
        <SelectAddOnsDialog
            open={isAddOnSelectorOpen}
            onOpenChange={setIsAddOnSelectorOpen}
            onSelect={(selected) => setIncludedAddOns(selected.map(s => {
                const existing = includedAddOns.find(p => p.id === s.id);
                return { id: s.id, name: s.name, quantity: existing?.quantity || 1 };
            }))}
            allAddOns={services.filter(s => s.type === 'addon')}
            initialSelected={services.filter(s => includedAddOns.some(p => p.id === s.id))}
        />
        <BrowseProductsDialog
            open={isProductSelectorOpen}
            onOpenChange={setIsProductSelectorOpen}
            onSelect={(selected) => setIncludedProducts(selected.map(p => {
                const existing = includedProducts.find(pk => pk.id === p.id);
                return { id: p.id, name: p.name, quantity: existing?.quantity || 1 };
            }))}
            allProducts={inventory.filter(p => p.type === 'retail')}
            initialSelected={inventory.filter(p => includedProducts.some(pk => pk.id === p.id))}
        />
    </>
  );
};