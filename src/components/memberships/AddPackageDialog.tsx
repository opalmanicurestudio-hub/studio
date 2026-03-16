
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '../ui/card';
import { type Package, type Service, type InventoryItem, type PricingTier, type Staff } from '@/lib/data';
import { Repeat, Sparkles, DollarSign, Clock, ListChecks, Target, Info, ArrowRight, Activity, ShieldCheck, Check, Percent, PlusCircle, Trash2, Box, Star, Landmark, Users, Scale, Zap, Shield, CheckCircle2 } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Progress } from '../ui/progress';
import { nanoid } from 'nanoid';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useTenant } from '@/context/TenantContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface AddPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pack: Package) => void;
  packageToEdit: Package | null;
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
    service, 
    sessions, 
    price, 
    tmhr, 
    taxBurden, 
    staff 
}: { 
    service: Service | undefined, 
    sessions: number, 
    price: number, 
    tmhr: number, 
    taxBurden: number, 
    staff: Staff[] 
}) => {
    const { inventory } = useInventory();

    const { baseHouseFloor } = useMemo(() => {
        if (!service) return { baseHouseFloor: 0 };
        
        const calculateServiceMaterialCost = (s: Service) => {
            if (!s.products) return 0;
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
                
                return acc + (costPerBaseUnit * p.quantityUsed);
            }, 0);
        };

        const materialCost = calculateServiceMaterialCost(service) * sessions;
        const totalServiceTime = ((service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0)) * sessions;
        const timeCost = (totalServiceTime / 60) * tmhr;
        return { baseHouseFloor: materialCost + timeCost };
    }, [service, sessions, tmhr, inventory]);

    const staffAnalysis = useMemo(() => {
        if (!service) return [];
        return staff.filter(s => s.active).map(member => {
            const tierConfig = service.serviceTiers?.find(t => t.tierId === member.pricingTierId);
            const tierPrice = tierConfig ? tierConfig.price : service.price;
            const tierDuration = tierConfig ? tierConfig.durationMinutes : service.duration;
            const totalDuration = (tierDuration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
            
            let labor = 0;
            if (member.payStructure === 'commission') labor = tierPrice * (member.commissionRate / 100);
            else if (member.payStructure === 'hourly' && member.hourlyRate) labor = (tierDuration / 60) * member.hourlyRate;
            else if (member.payStructure === 'hourly_plus_commission' && member.hourlyRate) labor = ((tierDuration / 60) * member.hourlyRate) + (tierPrice * (member.commissionRate / 100));

            const burdenedLabor = labor * sessions * (1 + (taxBurden / 100));
            const totalBurden = baseHouseFloor + burdenedLabor;
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
                baseHouseFloor,
                price
            };
        });
    }, [service, sessions, staff, taxBurden, baseHouseFloor, price, tmhr]);

    if (!service) return null;
    
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
                    {staffAnalysis.map(sa => (
                        <div key={sa.id} className="p-5 rounded-[2rem] bg-white border-2 border-primary/10 shadow-inner space-y-4">
                            <div className="flex justify-between items-center px-1 text-left">
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
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">House Floor</p>
                                    <p className="font-mono text-xs font-black text-slate-900">${sa.baseHouseFloor.toFixed(2)}</p>
                                </div>
                                <div className="space-y-0.5 text-right">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Labor Load</p>
                                    <p className="font-mono text-xs font-black text-slate-900">${sa.labor.toFixed(2)}</p>
                                </div>
                            </div>
                            <Separator className="border-dashed" />
                            <div className="flex justify-between items-baseline pt-1 text-left">
                                <span className="text-[9px] font-black uppercase text-primary/60">Net Bundle Yield</span>
                                <span className={cn("text-2xl font-black tracking-tighter font-mono", sa.netProfit >= 0 ? "text-primary" : "text-destructive")}>
                                    ${sa.netProfit.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-dashed bg-muted/10 text-left">
                    <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[9px] font-bold uppercase text-slate-600 leading-relaxed tracking-tight text-left">
                        Yield reflects individual technician pay and current <strong>${tmhr.toFixed(2)}/hr</strong> foundation.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};

export const AddPackageDialog: React.FC<AddPackageDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  packageToEdit,
}) => {
  const isMobile = useIsMobile();
  const { services, inventory, pricingTiers, staff } = useInventory();
  const { selectedTenant } = useTenant();
  const tmhr = selectedTenant?.tmhr || 50;
  const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;
  
  const [name, setName] = useState('');
  const [primaryServiceId, setPrimaryServiceId] = useState<string>('');
  const [sessions, setSessions] = useState<number>(5);
  const [price, setPrice] = useState<number>(0);
  const [expiresIn, setExpiresIn] = useState<number>(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [retailDiscount, setRetailDiscount] = useState<number>(0);
  const [applicableProductIds, setApplicableProductIds] = useState<string[]>([]);
  const [isApplicableProductsSelectorOpen, setIsApplicableProductsSelectorOpen] = useState(false);
  
  const primaryService = useMemo(() => services.find(s => s.id === primaryServiceId), [primaryServiceId, services]);

  useEffect(() => {
    if (packageToEdit) {
      setName(packageToEdit.name);
      setPrimaryServiceId(packageToEdit.serviceId);
      setSessions(packageToEdit.sessions);
      setPrice(packageToEdit.price);
      setExpiresIn(packageToEdit.expiresInMonths);
      setIsPrivate(packageToEdit.isPrivate);
      setRetailDiscount(packageToEdit.retailDiscount || 0);
      setApplicableProductIds(packageToEdit.applicableProductIds || []);
    } else {
      setName('');
      setPrimaryServiceId('');
      setSessions(5);
      setPrice(0);
      setExpiresIn(6);
      setIsPrivate(false);
      setRetailDiscount(0);
      setApplicableProductIds([]);
    }
  }, [packageToEdit, open]);

  const handleSave = () => {
    const packageData: Package = {
      id: packageToEdit?.id || `pkg-${nanoid()}`,
      name,
      serviceId: primaryServiceId,
      sessions,
      price,
      expiresInMonths: expiresIn,
      isPrivate,
      retailDiscount,
      applicableProductIds,
    };
    onSave(packageData);
    onOpenChange(false);
  };
  
  const FormContent = (
    <div className="space-y-12">
      <div className="space-y-10">
        <SectionHeader icon={Repeat} title="Bundle Identity" step={1} />
        <div className="space-y-6 text-left">
            <div className="space-y-2">
                <Label htmlFor="pkg-name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Package Label</Label>
                <Input id="pkg-name-edit" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., SIGNATURE BLOWOUT 5-PACK" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-service-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Target Treatment</Label>
              <Select value={primaryServiceId} onValueChange={setPrimaryServiceId}>
                <SelectTrigger id="pkg-service-edit" className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5">
                    <SelectValue placeholder="SELECT FROM MENU..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                    {services.filter(s => s.type === 'service').map(s => (
                        <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2 text-left">
                    <Label htmlFor="pkg-sessions-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Session Count</Label>
                    <div className="relative">
                        <Activity className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input id="pkg-sessions-edit" type="number" value={sessions || ''} onChange={e => setSessions(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5 text-center" />
                    </div>
                </div>
                <div className="space-y-2 text-left">
                    <Label htmlFor="pkg-price-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Total Bundle Value</Label>
                    <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input id="pkg-price-edit" type="number" value={price || ''} onChange={e => setPrice(Number(e.target.value))} placeholder="0.00" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5 text-primary" />
                    </div>
                </div>
            </div>
             <div className="space-y-2 text-left">
                <Label htmlFor="pkg-expires-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Retention Window (Months)</Label>
                <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                    <Input id="pkg-expires-edit" type="number" value={expiresIn || ''} onChange={e => setExpiresIn(Number(e.target.value))} placeholder="6" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5" />
                </div>
            </div>
             <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5 mt-4 shadow-inner">
                <div className="space-y-1 text-left">
                    <Label htmlFor="pkg-private-edit" className="text-lg font-black uppercase tracking-tight">Private Bundle</Label>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Hide from the public booking directory</p>
                </div>
                <Switch id="pkg-private-edit" checked={isPrivate} onCheckedChange={setIsPrivate} className="scale-125" />
            </div>
        </div>
      </div>

      <div className="space-y-10">
          <SectionHeader icon={Star} title="Additional Privileges" step={2} />
          <div className="space-y-8 text-left">
              <div className="space-y-4">
                <div className='flex items-center justify-between px-1 text-left'>
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Retail Perk</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-[2.5rem] border-2 bg-muted/10 shadow-inner">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="pkg-retail-discount-edit" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Priority Discount</Label>
                        <div className="relative">
                            <Percent className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                            <Input id="pkg-retail-discount-edit" type="number" value={retailDiscount || ''} onChange={e => setRetailDiscount(Number(e.target.value))} placeholder="0" className="h-14 rounded-2xl border-2 font-black text-xl font-mono text-primary bg-white shadow-sm" />
                        </div>
                    </div>
                </div>

                {retailDiscount > 0 && (
                    <div className="space-y-4 pt-2">
                        <div className='flex items-center justify-between px-1 text-left'>
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
      
      <ProfitabilityAnalysis 
        service={primaryService} 
        sessions={sessions} 
        price={price} 
        tmhr={tmhr} 
        taxBurden={taxBurden} 
        staff={staff || []} 
      />
    </div>
  );

  const dialogTitle = packageToEdit ? 'Refine Protocol' : 'Register New Bundle';
  const dialogDescription = packageToEdit ? `Refining ID: ${packageToEdit.id.slice(-6).toUpperCase()}` : 'Define the details for this prepaid service package.';

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
                        <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Bundle <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                    </div>
                </DialogFooter>
            </ContentComponent>
        </DialogContainer>

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
