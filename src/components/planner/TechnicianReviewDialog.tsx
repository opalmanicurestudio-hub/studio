'use server';

import React, { useMemo, useState, useEffect } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
    FlaskConical, 
    PlusCircle, 
    Trash2, 
    Info, 
    Clock, 
    CheckCircle, 
    Package, 
    MessageSquare, 
    Workflow, 
    Zap, 
    PackageOpen, 
    Square, 
    BookMarked, 
    Tag, 
    Sparkles,
    Check,
    Loader,
    ArrowRight,
    ListChecks,
    Activity,
    Users
} from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type Staff, type AppointmentCheckoutState } from '@/lib/data';
import { Input } from '../ui/input';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useToast } from '@/hooks/use-toast';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { differenceInMinutes, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '../ui/badge';
import { useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '../ui/switch';
import { motion, AnimatePresence } from 'framer-motion';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

type EditableFormulaItem = {
    id: string; 
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
    isCustom?: boolean;
};

interface TechnicianReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentData: {
    appointment: Appointment | null;
    client: Client | undefined;
    service: Service | undefined;
  };
  onSendToFrontDesk: (appointmentId: string, checkoutState: AppointmentCheckoutState) => void;
  staff: Staff[];
}

export const TechnicianReviewDialog: React.FC<TechnicianReviewDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onSendToFrontDesk,
  staff,
}) => {
  const { appointment, client, service } = appointmentData;
  const { services: allServices, inventory } = useInventory();
  const { selectedTenant } = useTenant();
  const { user: currentUser } = useUser();
  const tmhr = selectedTenant?.tmhr || 50;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  
  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [completedServiceIds, setCompletedServiceIds] = useState<string[]>([]);
  const [concurrentServiceIds, setConcurrentServiceIds] = useState<string[]>([]);
  const [actualDuration, setActualDuration] = useState(service?.duration || 0);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  
  const [saveAsCustomFormula, setSaveAsCustomFormula] = useState(false);
  const [customFormulaName, setCustomFormulaName] = useState('');

  useEffect(() => {
    if (open && service && appointment) {
        const checkoutState = appointment.checkoutState;
        const initialFormula = checkoutState?.formula || service.products?.map(p => {
            const product = inventory.find(i => i.id === p.id);
            let baseCpu = product?.costPerUnit || 0;
            if (product) {
                if (product.costingMethod === 'size' && product.size) {
                    baseCpu = (product.costPerUnit || 0) / product.size;
                } else if (product.costingMethod === 'uses' && product.estimatedUses) {
                    baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
                }
            }
            return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: baseCpu,
            }
        }) || [];
        setEditableFormula(initialFormula);

        const initialAddons = (checkoutState?.addOns || (appointment.addOnIds || [])
            .map(id => allServices.find(s => s.id === id))
            .filter((s): s is Service => !!s));
        setSelectedAddOns(initialAddons);
        
        const alreadyDone = checkoutState?.completedServiceIds || [];
        const alreadyConcurrent = checkoutState?.concurrentServiceIds || [];
        const initialOverrides: Record<string, string> = { ... (checkoutState?.serviceStaffOverrides || {}) };
        
        if (!initialOverrides[service.id]) {
            initialOverrides[service.id] = appointment.staffId || '';
        }
        
        initialAddons.forEach(addon => {
            if (!initialOverrides[addon.id]) {
                initialOverrides[addon.id] = appointment.staffId || '';
            }
        });
        setServiceStaffOverrides(initialOverrides);
        setConcurrentServiceIds(alreadyConcurrent);

        const newlyCompleted = Object.entries(initialOverrides)
            .filter(([_, staffId]) => staffId === currentUser?.uid)
            .map(([svcId]) => svcId);
        
        setCompletedServiceIds([...new Set([...alreadyDone, ...newlyCompleted])]);
        
        let durationToSet = checkoutState?.actualDuration;
        if (!durationToSet && appointment.actualStartTime) {
            const startTime = safeDate(appointment.actualStartTime);
            const endTime = new Date(); 
            durationToSet = Math.max(1, differenceInMinutes(endTime, startTime));
        } else if (!durationToSet) {
            durationToSet = service.duration;
        }
        
        setActualDuration(durationToSet || 0);
        setReviewNotes(checkoutState?.reviewNotes || '');
        setSaveAsCustomFormula(false);
        setCustomFormulaName('');
    }
  }, [service, appointment, open, allServices, inventory, currentUser]);

  const toggleServiceComplete = (serviceId: string) => {
      setCompletedServiceIds(prev => 
          prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
      );
  };

  const handleToggleConcurrency = (serviceId: string, isConcurrent: boolean) => {
      setConcurrentServiceIds(prev => 
          isConcurrent ? [...new Set([...prev, serviceId])] : prev.filter(id => id !== serviceId)
      );
  };

  const allServiceIds = useMemo(() => {
      if (!service) return [];
      return [service.id, ...selectedAddOns.map(a => a.id)];
  }, [service, selectedAddOns]);

  const isLastProvider = useMemo(() => {
      return allServiceIds.every(id => completedServiceIds.includes(id));
  }, [allServiceIds, completedServiceIds]);

  const handleStaffOverride = (serviceId: string, staffId: string) => {
    setServiceStaffOverrides(prev => ({ ...prev, [serviceId]: staffId }));
  };

  const handleUpdateAddOns = (newAddOns: Service[]) => {
    setSelectedAddOns(newAddOns);
    const nextOverrides = { ...serviceStaffOverrides };
    newAddOns.forEach(addon => {
        if (!nextOverrides[addon.id]) {
            nextOverrides[addon.id] = currentUser?.uid || appointment?.staffId || '';
        }
    });
    setServiceStaffOverrides(nextOverrides);
    setIsAddOnSelectorOpen(false);
  };

  const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => {
        let baseCpu = p.costPerUnit || 0;
        if (p.costingMethod === 'size' && p.size) baseCpu = (p.costPerUnit || 0) / p.size;
        else if (p.costingMethod === 'uses' && p.estimatedUses) baseCpu = (p.costPerUnit || 0) / p.estimatedUses;

        return {
            id: p.id,
            name: p.name,
            quantity: 1,
            unit: p.costingMethod === 'uses' ? (p.useUnit || 'uses') : (p.unit || 'unit'),
            costPerUnit: baseCpu,
            isCustom: true,
        }
      });
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
      setIsProductBrowserOpen(false);
  };
  
  const removeProduct = (productId: string) => {
    setEditableFormula(prev => prev.filter(item => item.id !== productId));
  };

  const totalAdditionalCharge = useMemo(() => {
    if (!service) return 0;
    const timeOverage = Math.max(0, (actualDuration - service.duration) / 60) * tmhr;
    const currentCost = editableFormula.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
    const standardCost = service.products?.reduce((acc, p) => {
        const item = inventory.find(inv => inv.id === p.id);
        if (!item) return acc;
        let baseCpu = item.costPerUnit || 0;
        if (item.costingMethod === 'size' && item.size) baseCpu = (item.costPerUnit || 0) / item.size;
        else if (item.costingMethod === 'uses' && item.estimatedUses) baseCpu = (item.costPerUnit || 0) / item.estimatedUses;
        
        return acc + (p.quantityUsed * baseCpu);
    }, 0) || 0;
    const productOverage = Math.max(0, currentCost - standardCost);
    return timeOverage + productOverage;
  }, [actualDuration, service, tmhr, editableFormula, inventory]);

  const handleApplyClientFormula = (formulaNameToApply: string) => {
      if (!client || !service) return;

      if (formulaNameToApply === "default") {
          const defaultFormula = service?.products?.map(p => {
              const product = inventory.find(i => i.id === p.id);
              let baseCpu = product?.costPerUnit || 0;
              if (product) {
                  if (product.costingMethod === 'size' && product.size) baseCpu = (product.costPerUnit || 0) / product.size;
                  else if (product.costingMethod === 'uses' && product.estimatedUses) baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
              }
              return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: baseCpu,
            }
          }) || [];
          setEditableFormula(defaultFormula);
          return;
      }

      const formula = client.customFormulas?.find(f => f.name === formulaNameToApply);
      if (!formula) return;
      const newFormula: EditableFormulaItem[] = formula.items.map(item => {
        const product = inventory.find(p => p.id === item.id);
        let baseCpu = product?.costPerUnit || 0;
        if (product) {
            if (product.costingMethod === 'size' && product.size) baseCpu = (product.costPerUnit || 0) / product.size;
            else if (product.costingMethod === 'uses' && product.estimatedUses) baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
        }
        return {
            id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, costPerUnit: baseCpu,
        }
      });
      setEditableFormula(newFormula);
  };

  const handleCompleteMyPart = () => {
    if (!client || !service || !appointment || !currentUser) return;

    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems: appointment.checkoutState?.retailItems || [],
        addOnServices: selectedAddOns,
        actualDuration,
        reviewNotes,
        serviceStaffOverrides,
        completedServiceIds: completedServiceIds,
        concurrentServiceIds: concurrentServiceIds,
        absorbedCost: appointment.checkoutState?.absorbedCost || 0, 
        tipAmount: appointment.checkoutState?.tipAmount || 0, 
        tipAllocations: appointment.checkoutState?.tipAllocations || {}, 
        additionalCharge: totalAdditionalCharge,
        saveAsCustomFormula,
        customFormulaName: saveAsCustomFormula ? customFormulaName : undefined
    };
    onSendToFrontDesk(appointment.id, checkoutState);
  };

  if (!client || !service || !appointment) return null;

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  const titleText = isLastProvider ? 'Complete Service' : 'Service Hand-off';
  const buttonLabel = isLastProvider ? 'Complete Service & Send to Desk' : 'Complete Part & Hand-off';

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl rounded-[3rem] border-4 max-h-[95dvh]")}>
            <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
                <div className="flex items-center gap-3 mb-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical review</span>
                </div>
                <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{titleText}</DialogTitle>
                <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Verify actuals and mark completed parts before moving forward.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1">
              <div className={cn("pb-32 space-y-10", isMobile ? "p-6" : "p-8")}>
                <Card className="border-4 border-primary/10 bg-primary/[0.02] rounded-[2rem] shadow-xl shadow-primary/5 overflow-hidden">
                    <CardContent className="p-6 flex items-center gap-6 text-left">
                        <Avatar className="w-16 h-16 md:w-20 md:h-20 border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2rem] shrink-0">
                            <AvatarImage src={client.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black bg-primary/10 text-primary text-xl">{(client.name || 'G').substring(0,2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <p className="font-black text-xl md:text-2xl uppercase tracking-tighter text-slate-900 leading-none truncate">{client.name}</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1.5">{service.name}</p>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-8">
                  <SectionHeader icon={ListChecks} title="Flow Control" step={1} />
                  <div className="space-y-4">
                        <div className="space-y-3">
                            <div className="p-5 rounded-[2rem] border-2 transition-all bg-muted/10 shadow-inner">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0 flex-1">
                                        <Checkbox 
                                            id={`complete-${service.id}`} 
                                            checked={completedServiceIds.includes(service.id)} 
                                            onCheckedChange={() => toggleServiceComplete(service.id)}
                                            className="h-6 w-6 rounded-full border-2"
                                        />
                                        <div className="min-w-0 text-left">
                                            <Label htmlFor={`complete-${service.id}`} className="text-sm font-black uppercase tracking-tight text-slate-900 block truncate">{service.name}</Label>
                                            <p className="text-[9px] font-black uppercase text-primary tracking-widest opacity-60">Main Service</p>
                                        </div>
                                    </div>
                                    <Select value={serviceStaffOverrides[service.id] || ''} onValueChange={(sid) => handleStaffOverride(service.id, sid)}>
                                        <SelectTrigger className="w-[140px] h-11 rounded-xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                                            <SelectValue placeholder="Staff" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[service.id])).map(s => (
                                                <SelectItem key={s.id} value={s.id} className="rounded-xl font-bold uppercase text-[9px] tracking-widest">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn("w-2 h-2 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                                        <span>{s?.name?.split(' ')[0] || 'Tech'}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {selectedAddOns.map(addon => (
                                <div key={addon.id} className="p-5 rounded-[2rem] border-2 transition-all bg-muted/10 shadow-inner">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <Checkbox 
                                                id={`complete-${addon.id}`} 
                                                checked={completedServiceIds.includes(addon.id)} 
                                                onCheckedChange={() => toggleServiceComplete(addon.id)}
                                                className="h-6 w-6 rounded-full border-2"
                                            />
                                            <div className="min-w-0 text-left">
                                                <Label htmlFor={`complete-${addon.id}`} className="text-sm font-black uppercase tracking-tight text-slate-900 block truncate">{addon.name}</Label>
                                                <Badge variant="outline" className={cn("text-[8px] h-5 px-2 uppercase font-black tracking-widest cursor-pointer border-2 shadow-sm transition-all", (concurrentServiceIds.includes(addon.id)) ? "bg-primary text-white border-primary" : "bg-white text-muted-foreground border-border")} onClick={() => handleToggleConcurrency(addon.id, !concurrentServiceIds.includes(addon.id))}>
                                                    {concurrentServiceIds.includes(addon.id) ? <><Zap className="w-2.5 h-2.5 mr-1" /> Concurrent</> : <><Workflow className="w-2.5 h-2.5 mr-1" /> Sequential</>}
                                                </Badge>
                                            </div>
                                        </div>
                                        <Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}>
                                            <SelectTrigger className="w-[140px] h-11 rounded-xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                                                <SelectValue placeholder="Staff" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[addon.id]) && (!addon.requiredSkills || addon.requiredSkills?.length === 0 || addon.requiredSkills.every(sk => (s.skillSet || []).includes(sk)))).map(s => (
                                                    <SelectItem key={s.id} value={s.id} className="rounded-xl font-bold uppercase text-[9px] tracking-widest">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("w-2 h-2 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                                            <span>{s?.name?.split(' ')[0] || 'Tech'}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-[0.2em] shadow-inner bg-muted/5 mt-2">
                            <PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" /> Append Add-on Enhancement
                        </Button>
                  </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed">
                    <SectionHeader icon={Calculator} title="Usage Actuals" step={2} />
                    <div className="space-y-8 text-left">
                        <div className="space-y-3">
                          <Label htmlFor="actual-duration-review" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                              <Clock className="w-3.5 h-3.5 opacity-40" /> Actual Duration (Minutes)
                          </Label>
                          <Input 
                              id="actual-duration-review"
                              type="number"
                              value={actualDuration}
                              onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                              className="h-16 text-3xl font-black font-mono border-2 rounded-2xl shadow-inner bg-muted/5 text-center focus-visible:ring-primary/20"
                          />
                          {actualDuration > service.duration && (
                              <div className="p-4 bg-amber-500/5 border-2 border-amber-500/10 rounded-2xl animate-in slide-in-from-top-2">
                                  <span className="text-[10px] font-black text-amber-700 flex items-center gap-2 uppercase tracking-tight"><Info className="w-3.5 h-3.5"/> Foundation Burn: +{actualDuration - service.duration}m Over Goal</span>
                              </div>
                          )}
                        </div>

                        <div className="space-y-4 pt-4 border-t border-dashed">
                            <div className="flex items-center justify-between px-1">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <PackageOpen className="w-3.5 h-3.5 opacity-40" /> Actual Product Formula
                                </Label>
                                <div className="flex items-center gap-2">
                                    {(client.customFormulas && client.customFormulas.length > 0) && (
                                        <Select onValueChange={handleApplyClientFormula} defaultValue="default">
                                            <SelectTrigger className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm w-40">
                                                <SelectValue placeholder="Load Formula..." />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                <SelectItem value="default" className="font-bold text-[9px] uppercase">LIBRARY STANDARD</SelectItem>
                                                {client.customFormulas.map(formula => (
                                                    <SelectItem key={formula.id} value={formula.name} className="font-bold text-[9px] uppercase">{formula.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    <Button variant="ghost" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                        <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                                    </Button>
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                {editableFormula.length > 0 ? (
                                    <div className="grid gap-2">
                                        {editableFormula.map((item, index) => (
                                            <div key={item.id} className="flex justify-between items-center p-4 bg-white rounded-2xl border-2 shadow-sm gap-4 group hover:border-primary/20 transition-all">
                                                <span className="font-black text-xs uppercase tracking-tight text-slate-900 flex-1 truncate text-left">{item.name}</span>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                                        <Input
                                                            type="number"
                                                            value={item.quantity}
                                                            onChange={(e) => {
                                                                const newQty = parseFloat(e.target.value) || 0;
                                                                const next = [...editableFormula];
                                                                next[index] = { ...item, quantity: newQty };
                                                                setEditableFormula(next);
                                                            }}
                                                            className="w-16 h-9 text-center font-black font-mono border-2 rounded-lg text-xs"
                                                            step="0.1"
                                                        />
                                                        <span className="text-[9px] font-black uppercase text-muted-foreground w-10 opacity-60 truncate text-left">{item.unit}</span>
                                                    </div>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeProduct(item.id)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <Activity className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">Recipe Manifest Empty</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed">
                    <SectionHeader icon={BookMarked} title="Dossier Intelligence" step={3} />
                    <div className="space-y-6 text-left">
                        <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner transition-all">
                            <div className="space-y-1">
                                <Label htmlFor="save-formula-toggle-review" className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                    <FileSignature className="w-4 h-4 text-primary" /> Archive Formula
                                </Label>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Register this recipe in guest dossier</p>
                            </div>
                            <Switch id="save-formula-toggle-review" checked={saveAsCustomFormula} onCheckedChange={setSaveAsCustomFormula} className="scale-125 data-[state=checked]:bg-primary" />
                        </div>

                        <AnimatePresence>
                            {saveAsCustomFormula && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="overflow-hidden">
                                    <div className="space-y-3 p-6 rounded-[2rem] border-2 bg-white shadow-xl text-left">
                                        <Label htmlFor="custom-formula-name-review" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2">
                                            <Tag className="w-3.5 h-3.5" /> Formula Identifier
                                        </Label>
                                        <Input 
                                            id="custom-formula-name-review" 
                                            placeholder="e.g., WINTER GLOSS MIX" 
                                            value={customFormulaName} 
                                            onChange={e => setCustomFormulaName(e.target.value.toUpperCase())}
                                            className="h-12 rounded-xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-3">
                            <Label htmlFor="review-notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                                <MessageSquare className="w-3.5 h-3.5 opacity-40" /> Professional Debrief Notes
                            </Label>
                            <Textarea 
                                id="review-notes"
                                placeholder="Audit notes regarding treatment outcomes, reactions, or client requests..." 
                                value={reviewNotes}
                                onChange={(e) => setReviewNotes(e.target.value)}
                                rows={4}
                                className="rounded-[2.5rem] border-2 bg-muted/5 p-6 font-medium leading-relaxed focus-visible:ring-primary/20"
                            />
                        </div>
                    </div>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-6" : "p-8 pt-4")}>
                <div className="flex flex-col gap-3 w-full">
                    <Button 
                        onClick={handleCompleteMyPart} 
                        disabled={completedServiceIds.length === 0 || (saveAsCustomFormula && !customFormulaName.trim())}
                        className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-3xl shadow-primary/30 active:scale-95 transition-all group"
                    >
                        {buttonLabel} <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-2" />
                    </Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-tighter text-[10px] text-slate-400">Abort Review</Button>
                </div>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleUpdateAddOns} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
    </>
  );
};
