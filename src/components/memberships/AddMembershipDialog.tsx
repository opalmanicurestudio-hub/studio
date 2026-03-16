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
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { PlusCircle, Trash2, DollarSign, Percent, Award, Info, Sparkles, ArrowRight, ShieldCheck, Star, Activity, ListChecks, Target, Check, Landmark, Clock, Box, Users, Scale, Zap } from 'lucide-react';
import { type Membership, type Service, type InventoryItem, type MembershipPerk, type PricingTier, type Staff } from '@/lib/data';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { BrowseServicesDialog } from '../services/BrowseServicesDialog';

interface AddMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (membership: Membership) => void;
  membershipToEdit: Membership | null;
}

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6 text-left">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const ProfitabilityAnalysis = ({ 
    perks, 
    price, 
    tmhr, 
    taxBurden, 
    staff 
}: { 
    perks: { services: MembershipPerk[], addOns: MembershipPerk[], products: MembershipPerk[] }, 
    price: number, 
    tmhr: number, 
    taxBurden: number, 
    staff: Staff[] 
}) => {
    const { services, inventory } = useInventory();
    
    const { materialCost, timeLiabilityHours } = useMemo(() => {
        const calculateServiceMaterialCost = (svcId: string, perkQty: number) => {
            const s = services.find(svc => svc.id === svcId);
            if (!s || !s.products) return 0;
            
            return s.products.reduce((acc, p) => {
                const invItem = inventory.find(i => i.id === p.id);
                if (!invItem) return acc;
                
                let costPerBaseUnit = 0;
                if (invItem.costingMethod === 'size' && invItem.size) {
                    costPerBaseUnit = (invItem.costPerUnit || 0) / invItem.size;
                } else if (invItem.costingMethod === 'uses' && invItem.estimatedUses) {
                    costPerBaseUnit = (invItem.costPerUnit || 0) / invItem.estimatedUses;
                } else {
                    costPerBaseUnit = invItem.costPerUnit || 0;
                }
                
                return acc + (costPerBaseUnit * p.quantityUsed * perkQty);
            }, 0);
        };

        const servicesCost = perks.services.reduce((acc, perk) => acc + calculateServiceMaterialCost(perk.id, perk.quantity), 0);
        const addOnsCost = perks.addOns.reduce((acc, perk) => acc + calculateServiceMaterialCost(perk.id, perk.quantity), 0);
        const productsCost = perks.products.reduce((acc, perk) => {
            const p = inventory.find(inv => inv.id === perk.id);
            return acc + (p?.costPerUnit || 0) * (perk.quantity || 1);
        }, 0);

        const servicesDuration = perks.services.reduce((acc, perk) => {
            const s = services.find(svc => svc.id === perk.id);
            return acc + ((s?.duration || 0) + (s?.padBefore || 0) + (s?.padAfter || 0)) * (perk.quantity || 1);
        }, 0);
        const addOnsDuration = perks.addOns.reduce((acc, perk) => {
            const s = services.find(svc => svc.id === perk.id);
            return acc + ((s?.duration || 0) + (s?.padBefore || 0) + (s?.padAfter || 0)) * (perk.quantity || 1);
        }, 0);

        return { materialCost: servicesCost + addOnsCost + productsCost, timeLiabilityHours: (servicesDuration + addOnsDuration) / 60 };
    }, [perks, services, inventory]);

    const individualStaffAnalysis = useMemo(() => {
        return staff.filter(s => s.active).map(member => {
            const timeValue = timeLiabilityHours * tmhr;
            
            let labor = 0;
            const projectedRevenueValue = [
                ...perks.services, 
                ...perks.addOns
            ].reduce((sum, perk) => {
                const svc = services.find(sv => sv.id === perk.id);
                const priceAtTier = svc?.serviceTiers?.find(t => t.tierId === member.pricingTierId)?.price || svc?.price || 0;
                return sum + (priceAtTier * perk.quantity);
            }, 0);

            if (member.payStructure === 'commission') {
                labor = projectedRevenueValue * (member.commissionRate / 100);
            } else if (member.payStructure === 'hourly' && member.hourlyRate) {
                labor = timeLiabilityHours * member.hourlyRate;
            } else if (member.payStructure === 'hourly_plus_commission' && member.hourlyRate) {
                labor = (timeLiabilityHours * member.hourlyRate) + (projectedRevenueValue * (member.commissionRate / 100));
            }
            
            const burdenedLabor = labor * (1 + (taxBurden / 100));
            const totalBurden = materialCost + timeValue + burdenedLabor;
            const netProfit = price - totalBurden;
            const margin = price > 0 ? (netProfit / price) * 100 : 0;

            return {
                id: member.id,
                name: member.name,
                avatarUrl: member.avatarUrl,
                payStructure: member.payStructure,
                totalBurden,
                netProfit,
                margin,
                labor: burdenedLabor,
                timeValue,
                materialCost
            };
        });
    }, [staff, timeLiabilityHours, tmhr, materialCost, taxBurden, perks.services, perks.addOns, services, price]);

    return (
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
            <CardHeader className="p-8 pb-4 border-b bg-white/50 backdrop-blur-sm text-left">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <Target className="w-3 h-3" />
                    Individual Payout Matrix
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-tight opacity-60 text-left">
                    Net Analysis per professional @ {taxBurden}% Tax Burden
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-6 space-y-6">
                <div className="space-y-4">
                    {individualStaffAnalysis.map(sa => (
                        <div key={sa.id} className="p-5 rounded-[2rem] bg-white border-2 border-primary/10 shadow-inner space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-8 w-8 border-2 border-background shadow-sm rounded-xl">
                                        <AvatarImage src={sa.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-[8px]">{(sa.name || 'S')[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="text-left min-w-0">
                                        <p className="text-[10px] font-black uppercase text-slate-900 truncate leading-none mb-0.5">{sa.name.split(' ')[0]}</p>
                                        <p className="text-[7px] font-bold text-muted-foreground uppercase opacity-60 leading-none">{sa.payStructure.replace('_', ' ')}</p>
                                    </div>
                                </div>
                                <Badge className={cn("text-white border-none font-black text-[8px] h-5 px-2 rounded-lg uppercase", sa.netProfit >= 0 ? "bg-primary" : "bg-destructive animate-pulse")}>
                                    {sa.margin.toFixed(0)}% Margin
                                </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-left">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Material Load</p>
                                    <p className="font-mono text-xs font-black text-slate-900">${sa.materialCost.toFixed(2)}</p>
                                </div>
                                <div className="space-y-0.5 text-right">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Time (TMHR)</p>
                                    <p className="font-mono text-xs font-black text-slate-900">${sa.timeValue.toFixed(2)}</p>
                                </div>
                                <div className="space-y-0.5 text-left">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Burdened Labor</p>
                                    <p className="font-mono text-xs font-black text-slate-900">${sa.labor.toFixed(2)}</p>
                                </div>
                            </div>
                            <Separator className="border-dashed" />
                            <div className="flex justify-between items-baseline pt-1 text-left">
                                <span className="text-[9px] font-black uppercase text-primary/60">Studio Net Yield</span>
                                <span className={cn("text-2xl font-black tracking-tighter font-mono", sa.netProfit >= 0 ? "text-primary" : "text-destructive")}>
                                    ${sa.netProfit.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-dashed bg-muted/10">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[9px] font-bold uppercase text-slate-600 leading-relaxed tracking-tight text-left">
                        Yield reflects individual technician pay structures and your current <strong>${tmhr.toFixed(2)}/hr</strong> foundation.
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
  const { services, inventory, pricingTiers, staff } = useInventory();
  const { selectedTenant } = useTenant();
  const tmhr = selectedTenant?.tmhr || 50;
  const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;
  
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
  const [applicableProductIds, setApplicableProductIds] = useState<string[]>([]);

  const [forfeitOnLateCancel, setForfeitOnLateCancel] = useState(true);
  const [forfeitOnNoShow, setForfeitOnNoShow] = useState(true);
  const [allowRollover, setAllowRollover] = useState(false);

  const [isServiceSelectorOpen, setIsServiceSelectorOpen] = useState(false);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductPerkSelectorOpen, setIsProductPerkSelectorOpen] = useState(false);
  const [isApplicableProductsSelectorOpen, setIsApplicableProductsSelectorOpen] = useState(false);

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
      setApplicableProductIds(membershipToEdit.applicableProductIds || []);
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
      setApplicableProductIds([]);
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
      applicableProductIds,
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
                <div className="space-y-1 text-left">
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
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Included Add-ons</Label>
                    <Button variant="ghost" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                        <PlusCircle className="w-3 h-3 mr-1.5" /> Select Add-ons
                    </Button>
                </div>
                {includedAddOns.length > 0 ? (
                    <div className="grid gap-2">
                    {includedAddOns.map(perk => (
                        <div key={perk.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                            <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{perk.name}</span>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Qty</Label>
                                    <Input 
                                        type="number" 
                                        value={perk.quantity || 1} 
                                        onChange={e => updatePerkQuantity('addon', perk.id, parseInt(e.target.value) || 1)} 
                                        className="w-14 h-9 rounded-lg border-2 text-center font-black font-mono"
                                    />
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeItem('addon', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                        </div>
                    ))}
                    </div>
                ) : (
                    <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                        <Zap className="w-10 h-10" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Add-ons Included</p>
                    </div>
                )}
              </div>

              <div className="space-y-4">
                <div className='flex items-center justify-between px-1'>
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retail Perks (LTV)</Label>
                    <Button variant="ghost" size="sm" onClick={() => setIsProductPerkSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                        <PlusCircle className="w-3 h-3 mr-1.5" /> Select Products
                    </Button>
                </div>
                {includedProducts.length > 0 ? (
                    <div className="grid gap-2">
                    {includedProducts.map(perk => (
                        <div key={perk.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                            <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{perk.name}</span>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Qty</Label>
                                    <Input 
                                        type="number" 
                                        value={perk.quantity || 1} 
                                        onChange={e => updatePerkQuantity('product', perk.id, parseInt(e.target.value) || 1)} 
                                        className="w-14 h-9 rounded-lg border-2 text-center font-black font-mono"
                                    />
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeItem('product', perk.id)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                        </div>
                    ))}
                    </div>
                ) : (
                    <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                        <Box className="w-10 h-10" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Retail Included</p>
                    </div>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-dashed">
                <div className='flex items-center justify-between px-1 text-left'>
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retail Privilege</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-[2.5rem] border-2 bg-muted/10 shadow-inner">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="retail-discount" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Priority Discount</Label>
                        <div className="relative">
                            <Percent className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                            <Input id="retail-discount" type="number" value={retailDiscount || ''} onChange={e => setRetailDiscount(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono text-primary bg-white shadow-sm" />
                        </div>
                    </div>
                    <div className="space-y-2 text-left">
                        <Label htmlFor="retail-discount-limit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Usage Load (Per Cycle)</Label>
                        <Input id="retail-discount-limit" type="number" value={retailDiscountLimit || ''} onChange={e => setRetailDiscountLimit(Number(e.target.value))} placeholder="0" className="h-14 rounded-2xl border-2 font-black text-xl font-mono bg-white shadow-sm text-center" />
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 text-center">0 for unlimited access</p>
                    </div>
                </div>

                {retailDiscount > 0 && (
                    <div className="space-y-4 pt-2">
                        <div className='flex items-center justify-between px-1'>
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Eligible Products</Label>
                            <Button variant="ghost" size="sm" onClick={() => setIsApplicableProductsSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                <PlusCircle className="w-3 h-3 mr-1.5" /> Select Scope
                            </Button>
                        </div>
                        {applicableProductIds.length > 0 ? (
                            <div className="grid gap-2">
                                {applicableProductIds.map(pid => {
                                    const p = inventory.find(i => i.id === pid);
                                    return (
                                        <div key={pid} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                                            <div className="flex items-center gap-3 truncate flex-1 text-left">
                                                <div className="p-2 bg-muted rounded-lg shrink-0">
                                                    <Box className="w-3 h-3 text-muted-foreground opacity-40" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{p?.name || 'Unknown Product'}</span>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-7 h-7 text-destructive shrink-0" onClick={() => setApplicableProductIds(prev => prev.filter(id => id !== pid))}><Trash2 className="w-3.5 h-3.5" /></Button>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-4 border-2 border-dashed rounded-xl">Applied to all retail assets</p>
                        )}
                    </div>
                )}
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
                    <div className="space-y-0.5 text-left">
                        <Label htmlFor={policy.id} className="text-sm font-black uppercase tracking-tight cursor-pointer">{policy.label}</Label>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{policy.desc}</p>
                    </div>
                    <Switch id={policy.id} checked={policy.state} onCheckedChange={policy.setter} className="scale-110" />
                </div>
              ))}
          </div>
      </div>

       <ProfitabilityAnalysis 
        perks={{ services: includedServices, addOns: includedAddOns, products: includedProducts }} 
        price={price} 
        tmhr={tmhr} 
        taxBurden={taxBurden} 
        staff={staff || []} 
       />
    </div>
  );

  const dialogTitle = membershipToEdit ? 'Refine Protocol' : 'Register New Tier';
  const dialogDescription = membershipToEdit ? `Refining ID: ${membershipToEdit.id.slice(-6).toUpperCase()}` : 'Define the details and perks for this membership tier.';

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <>
        <DialogContainer open={open} onOpenChange={onOpenChange}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-2xl max-h-[90dvh]")}>
                <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-10 pb-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1">
                    <div className={cn("p-8", isMobile ? "p-6" : "p-8")}>
                        {FormContent}
                    </div>
                </ScrollArea>
                <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-10 pt-4")}>
                    <div className="grid grid-cols-2 gap-3 w-full">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                        <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Tier <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                    </div>
                </DialogFooter>
            </ContentComponent>
        </DialogContainer>

         <BrowseServicesDialog
            open={isServiceSelectorOpen}
            onOpenChange={setIsServiceSelectorOpen}
            onSelect={(selected) => setIncludedServices(selected.map(s => {
                const existing = includedServices.find(p => p.id === s.id);
                return { id: s.id, name: s.name, quantity: existing?.quantity || 1 };
            }))}
            allServices={services.filter(s => s.type === 'service')}
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
            open={isProductPerkSelectorOpen}
            onOpenChange={setIsProductPerkSelectorOpen}
            onSelect={(selected) => setIncludedProducts(selected.map(p => {
                const existing = includedProducts.find(pk => pk.id === p.id);
                return { id: p.id, name: p.name, quantity: existing?.quantity || 1 };
            }))}
            allProducts={inventory.filter(p => p.type === 'retail')}
            initialSelected={inventory.filter(p => includedProducts.some(pk => pk.id === p.id))}
        />
        <BrowseProductsDialog
            open={isApplicableProductsSelectorOpen}
            onOpenChange={setIsApplicableProductsSelectorOpen}
            onSelect={(selected) => setApplicableProductIds(selected.map(p => p.id))}
            allProducts={inventory.filter(p => p.type === 'retail')}
            initialSelected={inventory.filter(p => applicableProductIds.includes(p.id))}
        />
    </>
  );
};