'use client';

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
import { FlaskConical, PlusCircle, Trash2, Info, Clock, CheckCircle, Package, MessageSquare, Workflow, Zap, PackageOpen, Square } from 'lucide-react';
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
import { useUser, useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

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

  useEffect(() => {
    if (open && service && appointment) {
        const checkoutState = appointment.checkoutState;
        const initialFormula = checkoutState?.formula || service.products?.map(p => {
            const product = inventory.find(i => i.id === p.id);
            return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: product?.costPerUnit || 0,
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
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id,
        name: p.name,
        quantity: 1,
        unit: p.costingMethod === 'uses' ? (p.useUnit || 'uses') : (p.unit || 'unit'),
        costPerUnit: p.costPerUnit || 0,
        isCustom: true,
      }));
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
        const cpu = item?.costPerUnit || 0;
        return acc + (p.quantityUsed * cpu);
    }, 0) || 0;
    const productOverage = Math.max(0, currentCost - standardCost);
    return timeOverage + productOverage;
  }, [actualDuration, service, tmhr, editableFormula, inventory]);

  const handleApplyClientFormula = (formulaNameToApply: string) => {
      if (!client || !service) return;

      if (formulaNameToApply === "default") {
          const defaultFormula = service?.products?.map(p => {
              const product = inventory.find(i => i.id === p.id);
              return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: product?.costPerUnit || 0,
            }
          }) || [];
          setEditableFormula(defaultFormula);
          return;
      }

      const formula = client.customFormulas?.find(f => f.name === formulaNameToApply);
      if (!formula) return;
      const newFormula: EditableFormulaItem[] = formula.items.map(item => {
        const product = inventory.find(p => p.id === item.productId);
        return {
            id: item.productId, name: item.productName, quantity: item.quantityUsed, unit: item.unit, costPerUnit: product?.costPerUnit || 0,
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
        <ContentComponent side={isMobile ? "bottom" : undefined} className={cn(isMobile ? "h-[90vh]" : "sm:max-w-xl max-h-[90vh]", "flex flex-col p-0")}>
            <DialogHeader className="p-6 pb-0 text-left flex-shrink-0">
                <DialogTitle>{titleText}</DialogTitle>
                <DialogDescription>Verify actuals and mark completed parts before moving forward.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6 pt-4 space-y-6">
                <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                        <Avatar className="w-12 h-12">
                            <AvatarImage src={client.avatarUrl} />
                            <AvatarFallback>{client.name.substring(0,2)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="font-semibold">{client.name}</p>
                            <p className="text-sm text-muted-foreground">{service.name}</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-primary/10">
                  <CardHeader className="pb-3 flex-shrink-0"><CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground">Flow Control</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                        <div className="space-y-3">
                            <div className="space-y-2 p-3 bg-muted/20 rounded-2xl border-2 transition-all has-[:checked]:border-primary">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Checkbox 
                                            id={`complete-${service.id}`} 
                                            checked={completedServiceIds.includes(service.id)} 
                                            onCheckedChange={() => toggleServiceComplete(service.id)}
                                        />
                                        <div className="min-w-0">
                                            <Label htmlFor={`complete-${service.id}`} className="text-sm font-bold block truncate">{service.name}</Label>
                                            <p className="text-[10px] font-black uppercase text-primary tracking-widest">Main Service</p>
                                        </div>
                                    </div>
                                    <Select value={serviceStaffOverrides[service.id] || ''} onValueChange={(sid) => handleStaffOverride(service.id, sid)}>
                                        <SelectTrigger className="w-[120px] h-10 text-[10px] font-black uppercase border-2 bg-background">
                                            <SelectValue placeholder="Staff" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[service.id])).map(s => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn("w-1.5 h-1.5 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                                        <span>{s?.name?.split(' ')[0] || 'Tech'}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {selectedAddOns.map(addon => (
                                <div key={addon.id} className="space-y-3 p-3 bg-muted/20 rounded-2xl border-2 transition-all has-[:checked]:border-primary">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Checkbox 
                                                id={`complete-${addon.id}`} 
                                                checked={completedServiceIds.includes(addon.id)} 
                                                onCheckedChange={() => toggleServiceComplete(addon.id)}
                                            />
                                            <div className="min-w-0">
                                                <Label htmlFor={`complete-${addon.id}`} className="text-sm font-bold block truncate">{addon.name}</Label>
                                                <Badge variant="outline" className={cn("text-[8px] h-4 px-1 uppercase font-black cursor-pointer", (concurrentServiceIds.includes(addon.id)) ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-transparent")} onClick={() => handleToggleConcurrency(addon.id, !concurrentServiceIds.includes(addon.id))}>
                                                    {concurrentServiceIds.includes(addon.id) ? <><Zap className="w-2 h-2 mr-0.5" /> Concurrent</> : <><Workflow className="w-2 h-2 mr-0.5" /> Sequential</>}
                                                </Badge>
                                            </div>
                                        </div>
                                        <Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}>
                                            <SelectTrigger className="w-[120px] h-10 text-[10px] font-black uppercase border-2 bg-background">
                                                <SelectValue placeholder="Staff" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[addon.id]) && (!addon.requiredSkills || addon.requiredSkills?.length === 0 || addon.requiredSkills.every(sk => (s.skillSet || []).includes(sk)))).map(s => (
                                                    <SelectItem key={s.id} value={s.id}>
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("w-1.5 h-1.5 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
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
                  </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Usage Actuals</CardTitle>
                        <CardDescription>Verify time and product formula used.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div className="space-y-2">
                          <Label htmlFor="actual-duration-rev" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground"><Clock className="w-3 h-3" /> Actual Duration (minutes)</Label>
                          <Input 
                              id="actual-duration-rev"
                              type="number"
                              value={actualDuration}
                              onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                              className="h-12 text-lg font-black font-mono border-2"
                          />
                          {actualDuration > service.duration && (
                              <div className="p-3 bg-amber-500/5 border-2 border-amber-500/10 rounded-xl">
                                  <span className="text-[10px] font-black text-amber-700 flex items-center gap-2 uppercase tracking-tight"><Info className="w-3 h-3"/> Efficiency Alert: +{actualDuration - service.duration}m Overage</span>
                              </div>
                          )}
                        </div>
                        <Separator />
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2"><PackageOpen className="w-3 h-3"/> Formula Review</h4>
                            {(client.customFormulas && client.customFormulas.length > 0) && (
                            <div className="w-full sm:w-auto sm:min-w-[200px]">
                                <Select onValueChange={handleApplyClientFormula} defaultValue="default">
                                    <SelectTrigger className="h-8 text-[10px] font-black uppercase border-2">
                                        <SelectValue placeholder="Load client formula..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">Standard Formula</SelectItem>
                                        {client.customFormulas.map(formula => (
                                            <SelectItem key={formula.name} value={formula.name}>{formula.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            {editableFormula.map((item) => (
                            <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-xl border-2 border-transparent gap-2">
                                <span className="font-bold text-xs flex-1 truncate pr-2">{item.name}</span>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => {
                                            const newQty = parseFloat(e.target.value) || 0;
                                            setEditableFormula(prev => prev.map(p => p.id === item.id ? {...p, quantity: newQty} : p))
                                        }}
                                        className="w-20 h-8 text-center font-black font-mono"
                                        step="0.1"
                                    />
                                    <span className="text-[9px] font-black uppercase text-muted-foreground w-10 truncate">{item.unit}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeProduct(item.id)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" type="button" className="w-full border-dashed h-11" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Extra Product</Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <MessageSquare className="w-3 h-3 text-primary" />
                            Session Debrief Notes
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Textarea 
                            placeholder="Formula adjustments, skin reactions, or client requests..." 
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            rows={3}
                            className="bg-muted/10 border-2"
                        />
                    </CardContent>
                </Card>
              </div>
            </ScrollArea>
            <DialogFooter className="p-6 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
                <div className="grid grid-cols-2 gap-3 w-full">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 font-bold uppercase tracking-tight">Cancel</Button>
                    <Button onClick={handleCompleteMyPart} className="h-12 font-black uppercase tracking-tight shadow-xl shadow-primary/20" disabled={completedServiceIds.length === 0}>
                        {buttonLabel}
                    </Button>
                </div>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleUpdateAddOns} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
    </>
  );
};
