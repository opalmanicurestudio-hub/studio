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
import { FlaskConical, PlusCircle, Trash2, QrCode, AlertTriangle, Calculator, Clock, Send, Package, Info, MessageSquare, Repeat, Square, CheckCircle, Loader, Check } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type Staff, type AppointmentCheckoutState, getServicePrice } from '@/lib/data';
import { Input } from '../ui/input';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '@/lib/utils';
import { differenceInMinutes, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Badge } from '../ui/badge';
import { nanoid } from 'nanoid';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  
  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [completedServiceIds, setCompletedServiceIds] = useState<string[]>([]);
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
        setCompletedServiceIds(checkoutState?.completedServiceIds || []);
        
        let durationToSet = checkoutState?.actualDuration;

        if (!durationToSet) {
            if (appointment.actualStartTime) {
                const startTime = safeDate(appointment.actualStartTime);
                const endTime = new Date(); 
                durationToSet = differenceInMinutes(endTime, startTime);
            } else {
                durationToSet = service.duration;
            }
        }
        
        setActualDuration(durationToSet || 0);
        setReviewNotes(checkoutState?.reviewNotes || '');
        
        const initialOverrides: Record<string, string> = {};
        initialOverrides[service.id] = appointment.staffId || '';
        initialAddons.forEach(addon => {
            initialOverrides[addon.id] = checkoutState?.serviceStaffOverrides?.[addon.id] || appointment.staffId || '';
        });
        setServiceStaffOverrides(initialOverrides);
    }
  }, [service, appointment, open, allServices, inventory]);

  const isLastProvider = useMemo(() => {
      if (!appointment || !currentUser) return true;
      const othersWorking = Object.entries(serviceStaffOverrides).some(([svcId, staffId]) => {
          return staffId !== currentUser.uid && !completedServiceIds.includes(svcId);
      });
      return !othersWorking;
  }, [serviceStaffOverrides, completedServiceIds, currentUser, appointment]);

  const nextUpStaff = useMemo(() => {
      if (!appointment || !currentUser) return null;
      const nextStaffId = Object.entries(serviceStaffOverrides).find(([svcId, staffId]) => {
          return staffId !== currentUser.uid && !completedServiceIds.includes(svcId);
      })?.[1];
      if (!nextStaffId) return null;
      return staff.find(s => s.id === nextStaffId);
  }, [serviceStaffOverrides, completedServiceIds, currentUser, staff, appointment]);

  const handleStaffOverride = (serviceId: string, staffId: string) => {
    setServiceStaffOverrides(prev => ({ ...prev, [serviceId]: staffId }));
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

    const myServiceIds = Object.entries(serviceStaffOverrides)
        .filter(([_, staffId]) => staffId === currentUser.uid)
        .map(([svcId]) => svcId);

    const newCompletedIds = [...new Set([...completedServiceIds, ...myServiceIds])];

    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems: appointment.checkoutState?.retailItems || [],
        addOnServices: selectedAddOns,
        actualDuration,
        reviewNotes,
        serviceStaffOverrides,
        completedServiceIds: newCompletedIds,
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

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={cn(isMobile ? "h-[90vh]" : "sm:max-w-xl max-h-[90vh]", "flex flex-col p-0")}>
            <DialogHeader className="p-6 pb-0 text-left">
                <DialogTitle>{isLastProvider ? 'Complete Service' : 'Complete Part & Hand-off'}</DialogTitle>
                <DialogDescription>Confirm actuals before moving the client forward.</DialogDescription>
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

                <Card>
                    <CardHeader>
                        <CardTitle>Service Actuals</CardTitle>
                        <CardDescription>Note any deviations from scheduled time or formula.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div className="space-y-2">
                          <Label htmlFor="actual-duration-rev" className="flex items-center gap-2"><Clock className="w-4 h-4" /> Actual Duration (minutes)</Label>
                          <Input 
                              id="actual-duration-rev"
                              type="number"
                              value={actualDuration}
                              onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                          />
                          {actualDuration > service.duration && (
                              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-md">
                                  <span className="text-xs font-bold text-amber-700 flex items-center gap-2"><Info className="w-3 h-3"/> Extra Time Logged ({actualDuration - service.duration}m)</span>
                              </div>
                          )}
                        </div>
                        <Separator />
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <h4 className="font-medium flex items-center gap-2"><Package className="w-4 h-4"/> Product Formula</h4>
                            {(client.customFormulas && client.customFormulas.length > 0) && (
                            <div className="w-full sm:w-auto sm:min-w-[200px]">
                                <Select onValueChange={handleApplyClientFormula} defaultValue="default">
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Load a formula..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">Default Service Formula</SelectItem>
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
                            <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md gap-2">
                                <span className="font-medium flex-1 truncate pr-2">{item.name}</span>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => {
                                            const newQty = parseFloat(e.target.value) || 0;
                                            setEditableFormula(prev => prev.map(p => p.id === item.id ? {...p, quantity: newQty} : p))
                                        }}
                                        className="w-20 h-8 text-center"
                                        step="0.1"
                                    />
                                    <span className="text-xs text-muted-foreground w-10 truncate">{item.unit}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeProduct(item.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            ))}
                        </div>
                        <div className='flex gap-2'>
                            <Button variant="outline" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-primary" />
                            Review Notes
                        </CardTitle>
                        <CardDescription>Provide context for the front desk (e.g. "Client requested extra length").</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Textarea 
                            placeholder="e.g., Arrived with severe matting, requested extra density..." 
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            rows={3}
                        />
                    </CardContent>
                </Card>
                
                <Card>
                  <CardHeader><CardTitle>Assigned Providers</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                <span className="text-sm font-medium">{service.name}</span>
                                <div className="flex items-center gap-2">
                                    {completedServiceIds.includes(service.id) && <CheckCircle className="w-4 h-4 text-green-500" />}
                                    <span className="text-sm font-semibold">{staff.find(s => s.id === serviceStaffOverrides[service.id])?.name || 'Unassigned'}</span>
                                </div>
                            </div>
                            {selectedAddOns.map(addon => (
                                <div key={addon.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                    <span className="text-sm pl-4">+ {addon.name}</span>
                                    <div className="flex items-center gap-2">
                                        {completedServiceIds.includes(addon.id) && <CheckCircle className="w-4 h-4 text-green-500" />}
                                        <Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}>
                                            <SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Select Staff" /></SelectTrigger>
                                            <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ))}
                        </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
            <DialogFooter className="p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleCompleteMyPart} className="h-11 font-bold">
                    {isLastProvider ? (
                        <>
                            <Send className="mr-2 h-4 w-4" /> Complete Service & Send to Desk
                        </>
                    ) : (
                        <>
                            <Repeat className="mr-2 h-4 w-4" /> Complete Part & Hand-off
                        </>
                    )}
                </Button>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={allServices.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
    </>
  );
};
