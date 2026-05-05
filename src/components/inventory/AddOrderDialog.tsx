'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Order, type InventoryItem } from '@/lib/data';
import { PlusCircle, Trash2, DollarSign, Sparkles, Truck, PackageOpen, Calculator, Landmark, ArrowRight, Search, Plus, Info } from 'lucide-react';
import { format } from 'date-fns';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { ImageUpload } from '../shared/ImageUpload';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { Progress } from '../ui/progress';

interface AddOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (orderData: Omit<Order, 'id'>) => void;
}

type OrderItem = {
  productId: string;
  productName: string;
  quantity: number;
  costPerUnit: number;
};

const SectionHeader = ({ icon: Icon, title, step }: { icon: any; title: string; step: number | string }) => (
  <div className="flex items-center gap-4 mb-6">
    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
      <Icon className="w-5 h-5" />
    </div>
    <div className="space-y-0.5 text-left">
      <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
      <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
    </div>
  </div>
);

export const AddOrderDialog: React.FC<AddOrderDialogProps> = ({ open, onOpenChange, onSave }) => {
  const isMobile = useIsMobile();
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const { inventory: products } = useInventory();

  const [supplier, setSupplier] = useState('');
  const [orderDate, setOrderDate] = useState<Date | undefined>(new Date());
  const [expectedDate, setExpectedDate] = useState<Date | undefined>();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customItemName, setCustomItemName] = useState('');
  const [shippingCost, setShippingCost] = useState(0);
  const [taxCost, setTaxCost] = useState(0);
  const [discounts, setDiscounts] = useState(0);
  const [paymentContext, setPaymentContext] = useState<'Business' | 'Personal'>('Business');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentMethodIdentifier, setPaymentMethodIdentifier] = useState('');
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1); setSupplier(''); setItems([]); setOrderDate(new Date());
      setExpectedDate(undefined); setTrackingNumber(''); setTrackingUrl('');
      setInvoiceUrl(''); setNotes(''); setPaymentMethod(''); setPaymentMethodIdentifier('');
      setShippingCost(0); setTaxCost(0); setDiscounts(0);
    }
  }, [open]);

  const handleAddProducts = (selectedProducts: InventoryItem[]) => {
    const newItems = selectedProducts.map(p => ({ productId: p.id, productName: p.name, quantity: 1, costPerUnit: p.costPerUnit || 0 }));
    setItems(prev => {
      const combined = [...prev];
      if (combined.length === 0 && newItems.length > 0) {
        const firstSup = products.find(p => p.id === newItems[0].productId)?.supplier;
        if (firstSup) setSupplier(firstSup);
      }
      newItems.forEach(newItem => { if (!combined.find(i => i.productId === newItem.productId)) combined.push(newItem); });
      return combined;
    });
  };

  const handleAddCustomItem = () => {
    if (!customItemName.trim()) return;
    setItems(prev => [...prev, { productId: `custom-${nanoid()}`, productName: customItemName, quantity: 1, costPerUnit: 0 }]);
    setCustomItemName('');
  };

  const handleItemChange = (productId: string, field: 'quantity' | 'costPerUnit', value: number) => {
    setItems(prev => prev.map(item => item.productId === productId ? { ...item, [field]: value } : item));
  };

  const handleRemoveItem = (productId: string) => {
    setItems(prev => prev.filter(item => item.productId !== productId));
  };

  const { itemsSubtotal, totalLandedCost, itemsWithLandedCost } = useMemo(() => {
    const subtotal = items.reduce((acc, item) => acc + item.quantity * item.costPerUnit, 0);
    const otherCosts = shippingCost + taxCost - discounts;
    const total = subtotal + otherCosts;
    const itemsWithCosts = items.map(item => {
      const itemSubtotal = item.quantity * item.costPerUnit;
      const proportion = subtotal > 0 ? itemSubtotal / subtotal : 0;
      const totalItemCost = itemSubtotal + otherCosts * proportion;
      const landed = item.quantity > 0 ? totalItemCost / item.quantity : item.costPerUnit;
      return { ...item, landedCostPerUnit: isNaN(landed) ? item.costPerUnit : landed };
    });
    return { itemsSubtotal: subtotal, totalLandedCost: total, itemsWithLandedCost: itemsWithCosts };
  }, [items, shippingCost, taxCost, discounts]);

  const handleSave = () => {
    let finalTrackingUrl = trackingUrl;
    if (finalTrackingUrl && !/^https?:\/\//i.test(finalTrackingUrl)) finalTrackingUrl = `https://${finalTrackingUrl}`;
    onSave({
      supplier, orderDate: (orderDate || new Date()).toISOString(), status: 'Placed',
      trackingNumber, trackingUrl: finalTrackingUrl, notes,
      items: itemsWithLandedCost.map(i => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, costPerUnit: i.landedCostPerUnit })),
      invoiceUrl, expectedArrivalDate: expectedDate?.toISOString(),
      paymentMethod, paymentContext, paymentMethodIdentifier, shippingCost, taxCost, discounts,
    });
    onOpenChange(false);
  };

  const header = (
    <div className="flex-shrink-0 text-left border-b bg-muted/5 p-6 md:p-8 md:pb-6">
      <div className="flex items-center gap-3 mb-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Procurement Intake</span>
      </div>
      <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Order Protocol</h2>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Log supplier shipments into the studio ledger.</p>
      <div className="pt-6">
        <Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" />
      </div>
    </div>
  );

  const step1Content = (
    <div className="space-y-10">
      <SectionHeader icon={PackageOpen} title="Manifest Composition" step={1} />
      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Manifest Items</Label>
          <div className="space-y-3">
            {items.length > 0 ? (
              <div className="grid gap-3">
                {items.map(item => (
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border-2 bg-white shadow-sm group" key={item.productId}>
                    <div className="min-w-0 flex-1 text-left w-full">
                      <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate">{item.productName}</p>
                      <p className="text-[9px] font-bold text-primary uppercase tracking-widest opacity-60">SKU Ref: {item.productId.slice(-6).toUpperCase()}</p>
                    </div>
                    <div className="flex items-center gap-3 justify-between w-full sm:w-auto">
                      <div className="flex items-center gap-2">
                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                        <Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-10 rounded-xl border-2 text-center font-black" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Unit Cost</Label>
                        <div className="relative w-24">
                          <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                          <Input type="number" value={item.costPerUnit || ''} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="h-10 pl-7 rounded-xl border-2 font-mono text-center text-xs" />
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveItem(item.productId)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                <PlusCircle className="w-12 h-12" />
                <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Line Items</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <Button variant="outline" className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest" onClick={() => setIsProductBrowserOpen(true)} type="button">
                <Search className="mr-2 h-4 w-4" /> Browse Inventory
              </Button>
              <div className="flex gap-2">
                <Input placeholder="NEW CUSTOM SKU..." value={customItemName} onChange={e => setCustomItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCustomItem()} className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest" />
                <Button variant="outline" size="icon" onClick={handleAddCustomItem} className="h-12 w-12 shrink-0 rounded-xl"><Plus className="h-5 w-5" /></Button>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier-order" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Verified Supplier</Label>
          <Input id="supplier-order" placeholder="e.g., SALONCENTRIC / ULINE" value={supplier} onChange={e => setSupplier(e.target.value)} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
        </div>
      </div>
    </div>
  );

  const step2Content = (
    <div className="space-y-10">
      <SectionHeader icon={Calculator} title="Landed Cost Calculation" step={2} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <Card className="border-2 rounded-[2.5rem] overflow-hidden shadow-sm">
          <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Expense Variables</CardTitle></CardHeader>
          <CardContent className="p-6 space-y-6 text-left">
            <div className="space-y-4">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Logistics / Shipping</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" /><Input type="number" value={shippingCost || ''} onChange={e => setShippingCost(parseFloat(e.target.value) || 0)} className="h-11 pl-8 rounded-xl border-2 font-bold font-mono" /></div></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Invoice Taxes</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" /><Input type="number" value={taxCost || ''} onChange={e => setTaxCost(parseFloat(e.target.value) || 0)} className="h-11 pl-8 rounded-xl border-2 font-bold font-mono" /></div></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Trade Discounts</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" /><Input type="number" value={discounts || ''} onChange={e => setDiscounts(parseFloat(e.target.value) || 0)} className="h-11 pl-8 rounded-xl border-2 font-bold font-mono" /></div></div>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6 text-left">
          <div className="p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
            <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.2em]">Total Project Value</p>
            <p className="text-5xl font-black text-primary tracking-tighter font-mono">${totalLandedCost.toFixed(2)}</p>
            <div className="pt-4 border-t border-primary/10 flex justify-between items-center text-[10px] font-black uppercase">
              <span className="text-muted-foreground opacity-60">Items Base</span>
              <span className="text-slate-900">${itemsSubtotal.toFixed(2)}</span>
            </div>
          </div>
          <div className="p-5 rounded-2xl border-2 border-dashed bg-muted/5 flex items-start gap-4">
            <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
            <p className="text-[10px] font-bold uppercase text-slate-600 leading-relaxed tracking-tight">
              Landed costs are mathematically distributed across each SKU based on their relative unit values to ensure margin accuracy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const step3Content = (
    <div className="space-y-10">
      <SectionHeader icon={Landmark} title="Settlement & Governance" step={3} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <Card className="border-2 rounded-[2.5rem] overflow-hidden shadow-sm">
          <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest text-left">Financial Context</CardTitle></CardHeader>
          <CardContent className="p-6 space-y-6 text-left">
            <RadioGroup value={paymentContext} onValueChange={(v: any) => setPaymentContext(v)} className="grid grid-cols-2 gap-3">
              <div><RadioGroupItem value="Business" id="bus-ctx" className="peer sr-only" /><Label htmlFor="bus-ctx" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">BUSINESS</Label></div>
              <div><RadioGroupItem value="Personal" id="per-ctx" className="peer sr-only" /><Label htmlFor="per-ctx" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-[10px] font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">PERSONAL</Label></div>
            </RadioGroup>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Distribution Source</Label><Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest shadow-inner"><SelectValue placeholder="SELECT ACCOUNT..." /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl"><SelectItem value="Checking" className="font-bold">CHECKING</SelectItem><SelectItem value="Credit Card" className="font-bold">CREDIT CARD</SelectItem><SelectItem value="Cash" className="font-bold">CASH</SelectItem><SelectItem value="Other" className="font-bold">OTHER</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Account ID</Label><Input placeholder="e.g., CHASE ****1234" value={paymentMethodIdentifier} onChange={e => setPaymentMethodIdentifier(e.target.value)} className="h-11 rounded-xl border-2 font-bold text-xs uppercase" /></div>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6 text-left">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Order Date</Label><Input type="date" value={orderDate ? format(orderDate, 'yyyy-MM-dd') : ''} onChange={e => setOrderDate(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)} className="h-12 rounded-xl border-2 font-bold" /></div>
            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Est. Arrival</Label><Input type="date" value={expectedDate ? format(expectedDate, 'yyyy-MM-dd') : ''} onChange={e => setExpectedDate(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)} className="h-12 rounded-xl border-2 font-bold" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Carrier Tracker (URL)</Label><Input placeholder="https://..." value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-xs" /></div>
          <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Digital Manifest</Label><ImageUpload onImageUploaded={setInvoiceUrl} initialImage={invoiceUrl} /></div>
        </div>
      </div>
    </div>
  );

  const body = (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-6 md:p-8 pb-10">
        {step === 1 && step1Content}
        {step === 2 && step2Content}
        {step === 3 && step3Content}
      </div>
    </ScrollArea>
  );

  const footer = (
    <div className="flex-shrink-0 border-t bg-background shadow-2xl p-4 md:p-6 md:pb-6">
      <div className="flex w-full gap-4">
        {step > 1 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)} type="button" className="flex-1 h-14 rounded-2xl font-black uppercase tracking-tighter text-[10px] text-slate-400">
            Back
          </Button>
        )}
        <div className={cn('flex gap-3', step === 1 ? 'w-full' : 'flex-[2.5]')}>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2">
            Cancel
          </Button>
          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)} disabled={items.length === 0} className="flex-[1.5] h-14 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-2xl shadow-primary/30 group">
              Continue <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          ) : (
            <Button onClick={handleSave} className="flex-[1.5] h-14 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-2xl shadow-primary/30">
              Save Order
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[92dvh] rounded-t-[3rem] p-0 border-none bg-background flex flex-col overflow-hidden shadow-2xl">
            {header}
            {body}
            {footer}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-4xl h-[90dvh] !flex flex-col !gap-0 p-0 overflow-hidden border-4 rounded-[2.5rem] shadow-2xl">
            {header}
            {body}
            {footer}
          </DialogContent>
        </Dialog>
      )}

      <BrowseProductsDialog
        open={isProductBrowserOpen}
        onOpenChange={setIsProductBrowserOpen}
        onSelect={handleAddProducts}
        allProducts={products}
        initialSelected={[]}
      />
    </>
  );
};