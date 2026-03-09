'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { PlusCircle, Trash2, DollarSign, Percent, Award, Info, Sparkles, ArrowRight, ShieldCheck, Star, Activity, ListChecks, Target, Check, Landmark } from 'lucide-react';
import { type Membership, type Service, type InventoryItem, type MembershipPerk } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';

interface AddMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (membership: Membership) => void;
  membershipToEdit: Membership | null;
}

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
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
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
            <CardHeader className="p-8 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <Target className="w-3 h-3" />
                    Yield Engine
                </CardTitle>
            </CardHeader>
            <CardContent className="p-8 pt-0 space-y-6">
                <div className="p-6 rounded-[2rem] bg-white border-2 border-primary/10 shadow-inner space-y-4">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                        <span>Revenue Rate</span>
                        <span className="font-mono text-slate-900">${price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-destructive opacity-60">
                        <span>Est. Perk Overhead</span>
                        <span className="font-mono text-destructive">-${totalCostOfPerks.toFixed(2)}</span>
                    </div>
                    <Separator className="border-dashed" />
                    <div className="flex justify-between items-baseline pt-2">
                        <div className="flex flex-col text-left">
                            <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Net Operating Yield</span>
                            <span className={cn("text-3xl font-black tracking-tighter font-mono leading-none", netProfit >= 0 ? "text-primary" : "text-destructive")}>
                                ${netProfit.toFixed(2)}
                            </span>
                        </div>
                        <Badge className={cn("text-white border-none font-black text-xs font-mono", netProfit >= 0 ? "bg-primary" : "bg-destructive")}>
                            {profitMargin.toFixed(1)}%
                        </Badge>
                    </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed bg-muted/10">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[9px] font-bold uppercase text-muted-foreground leading-relaxed tracking-tight text-left">
                        Calculated based on current treatment costs and landed asset values in your manifest.
                    </p>
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
  const [retailDiscountLimit, setRetailDiscountLimit] = useState<number>(0);

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
      setRetailDiscountLimit(membershipToEdit.retailDiscountLimit || 0);
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
      setRetailDiscountLimit(0);
      setForfeitOnLateCancel(true);
      setForfeitOnNoShow(true);
      setAllowRollover(false);
    }
  }, [membershipToEdit, open]);

  const handleSave = () => {
    const membershipData: Membership = {
      id: membershipToEdit?.id || `mem-${nanoid()}`,
      name,
      description,
      price,
      interval,
      isPrivate,
      includedServices,
      includedAddOns,
      includedProducts,
      retailDiscount,
      retailDiscountLimit,
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
    <div className="space-y-12">
      <div className="space-y-10">
        <SectionHeader icon={Award} title="Tier Identity" step={1} />
        <div className="space-y-6 text-left">
            <div className="space-y-2">
                <Label htmlFor="mem-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Membership Label</Label>
                <Input id="mem-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., VIP GLOW CLUB" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
            </div>
             <div className="space-y-2">
                <Label htmlFor="mem-desc" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Value Proposition</Label>
                <Textarea id="mem-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the exclusive benefits..." className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="mem-price" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Subscription Rate</Label>
                    <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input id="mem-price" type="number" value={price || ''} onChange={e => setPrice(Number(e.target.value))} placeholder="0.00" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner text-primary" />
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="mem-interval" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Billing Cycle</Label>
                    <Select value={interval} onValueChange={(v: any) => setInterval(v)}>
                        <SelectTrigger id="mem-interval" className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                            <SelectItem value="monthly" className="font-bold uppercase text-[10px] tracking-widest">MONTHLY ACCESS</SelectItem>
                            <SelectItem value="yearly" className="font-bold uppercase text-[10px] tracking-widest">ANNUAL ACCESS</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
             <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5 mt-4 shadow-inner">
                <div className="space-y-1">
                    <Label htmlFor="mem-private" className="text-lg font-black uppercase tracking-tight">Private Access</Label>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Hide from the public booking directory</p>
                </div>
                <Switch id="mem-private" checked={isPrivate} onCheckedChange={setIsPrivate} className="scale-125" />
            </div>
        </div>
      </div>
      
      <div className="space-y-10">
          <SectionHeader icon={Star} title="Privilege Manifest" step={2} />
          <div className="space-y-8 text-left">
              <div className="space-y-4">
                <div className='flex items-center justify-between px-1'>
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Included Services</Label>
                    <Button variant="ghost" size="sm" onClick={() => setIsServiceSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                        <PlusCircle className="w-3 h-3 mr-1.5" /> Select Library
                    </Button>
                </div>
                {includedServices.length > 0 ? (
                    <div className="grid gap-2">
                    {includedServices.map(perk => (
                        <div key={perk.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                            <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{perk.name}</span>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Qty</Label>
                                    <Input 
                                        type="number" 
                                        value={perk.quantity || 1} 
                                        onChange={e => updatePerkQuantity('service', perk.id, parseInt(e.target.value) || 1)} 
                                        className="w-14 h-9 rounded-lg border-2 text-center font-black font-mono"
                                    />
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeItem('service', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                        </div>
                    ))}
                    </div>
                ) : (
                    <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                        <Sparkles className="w-10 h-10" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Services Included</p>
                    </div>
                )}
              </div>

              <div className="space-y-4">
                <div className='flex items-center justify-between px-1'>
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retail Privilege</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-[2.5rem] border-2 bg-muted/10 shadow-inner">
                    <div className="space-y-2">
                        <Label htmlFor="retail-discount" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Priority Discount</Label>
                        <div className="relative">
                            <Percent className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                            <Input id="retail-discount" type="number" value={retailDiscount || ''} onChange={e => setRetailDiscount(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono text-primary bg-white shadow-sm" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="retail-discount-limit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Usage Load (Per Cycle)</Label>
                        <Input id="retail-discount-limit" type="number" value={retailDiscountLimit || ''} onChange={e => setRetailDiscountLimit(Number(e.target.value))} placeholder="0" className="h-14 rounded-2xl border-2 font-black text-xl font-mono bg-white shadow-sm text-center" />
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 text-center">0 for unlimited access</p>
                    </div>
                </div>
              </div>
          </div>
      </div>

      <div className="space-y-10">
          <SectionHeader icon={ShieldCheck} title="Governance & Terms" step={3} />
          <div className="space-y-4 text-left">
              {[
                  { id: 'forfeit-cancel', label: 'Forfeit on Late Notice', desc: 'Deduct perk for late cancellations', state: forfeitOnLateCancel, setter: setForfeitOnLateCancel },
                  { id: 'forfeit-noshow', label: 'Forfeit on No-Show', desc: 'Deduct perk if guest is absent', state: forfeitOnNoShow, setter: setForfeitOnNoShow },
                  { id: 'allow-rollover', label: 'Rollover Protocol', desc: 'Unused perks transfer to next cycle', state: allowRollover, setter: setAllowRollover }
              ].map(policy => (
                <div key={policy.id} className="flex items-center justify-between p-5 rounded-2xl border-2 bg-muted/5 shadow-inner group transition-all hover:bg-muted/10">
                    <div className="space-y-0.5">
                        <Label htmlFor={policy.id} className="text-sm font-black uppercase tracking-tight cursor-pointer">{policy.label}</Label>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{policy.desc}</p>
                    </div>
                    <Switch id={policy.id} checked={policy.state} onCheckedChange={policy.setter} className="scale-110" />
                </div>
              ))}
          </div>
      </div>

       <ProfitabilityAnalysis perks={{ services: includedServices, addOns: includedAddOns, products: includedProducts }} price={price} />
    </div>
  );

  const dialogTitle = membershipToEdit ? 'Refine Protocol' : 'Register New Tier';
  const dialogDescription = membershipToEdit ? `Refining ID: ${membershipToEdit.id.slice(-6).toUpperCase()}` : 'Define the details and perks for this membership tier.';

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <>
        <DialogContainer open={open} onOpenChange={onOpenChange}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-4xl max-h-[90dvh]")}>
                <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1">
                    <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                        {FormContent}
                    </div>
                </ScrollArea>
                <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
                    <div className="grid grid-cols-2 gap-3 w-full">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                        <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Tier <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                    </div>
                </DialogFooter>
            </ContentComponent>
        </DialogContainer>

         <BrowseProductsDialog
            open={isServiceSelectorOpen}
            onOpenChange={setIsServiceSelectorOpen}
            onSelect={(selected) => setIncludedServices(selected.map(s => {
                const existing = includedServices.find(p => p.id === s.id);
                return { id: s.id, name: s.name, quantity: existing?.quantity || 1 };
            }))}
            allProducts={services.filter(s => s.type === 'service')}
            initialSelected={services.filter(s => includedServices.some(p => p.id === s.id)) as any}
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
