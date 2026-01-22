
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
import { FlaskConical, PlusCircle, Trash2, QrCode, AlertTriangle } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection, type CustomFormula, type Staff, AppointmentCheckoutState } from '@/lib/data';
import { Input } from '../ui/input';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { ScrollArea } from '../ui/scroll-area';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { differenceInMinutes, parseISO } from 'date-fns';

type EditableFormulaItem = {
    id: string; // productId
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
    appointment: Appointment;
    client: Client | undefined;
    service: Service | undefined;
  };
  onSendToFrontDesk: (appointmentId: string, checkoutState: AppointmentCheckoutState) => void;
}

export const TechnicianReviewDialog: React.FC<TechnicianReviewDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onSendToFrontDesk,
}) => {
  const { inventory, services, staff, clients } = useInventory();
  const { appointment, client, service } = appointmentData;
  const isMobile = useIsMobile();
  
  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const [applyAdditionalCharges, setApplyAdditionalCharges] = useState(true);

  const actualDuration = useMemo(() => {
    if (appointment.actualStartTime && appointment.actualEndTime) {
      return differenceInMinutes(parseISO(appointment.actualEndTime), parseISO(appointment.actualStartTime));
    }
    return service?.duration || 0;
  }, [appointment, service]);

  useEffect(() => {
    if (open && service && appointment) {
        const initialFormula = (appointment.checkoutState?.formula || service.products?.map(p => ({
            id: p.id, name: p.name, quantity: p.quantityUsed, unit: p.unit || 'uses', costPerUnit: p.costPerUnit || 0
        }))) || [];
        setEditableFormula(initialFormula);

        const initialAddons = (appointment.checkoutState?.addOns || (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s));
        setSelectedAddOns(initialAddons);

        const initialOverrides: Record<string, string> = { [service.id]: appointment.staffId || '' };
        initialAddons.forEach(addon => {
            initialOverrides[addon.id] = appointment.staffId || '';
        });
        setServiceStaffOverrides(appointment.checkoutState?.serviceStaffOverrides || initialOverrides);
    }
  }, [service, open, appointment, services]);
  
  const { initialBreakEven, finalBreakEven, additionalCharge, absorbedCost } = useMemo(() => {
    if (!service) return { initialBreakEven: 0, finalBreakEven: 0, additionalCharge: 0, absorbedCost: 0 };
    
    const tmhr = (typeof window !== 'undefined' && parseFloat(localStorage.getItem('tmhr') || '50')) || 50;
    
    const initialProductCost = (service.products || []).reduce((acc, p) => {
        const inventoryItem = inventory.find(i => i.id === p.id);
        const cost = inventoryItem?.costPerUnit || 0;
        return acc + (cost * p.quantityUsed);
    }, 0);
    const initialTimeCost = ((service.duration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const initialBreakEvenCost = initialProductCost + initialTimeCost;

    const finalProductCost = editableFormula.reduce((acc, item) => {
        const inventoryItem = inventory.find(i => i.id === item.id);
        const cost = inventoryItem?.costPerUnit || 0;
        return acc + (cost * item.quantity);
    }, 0);

    const finalTimeCost = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const finalBreakEvenCost = finalProductCost + finalTimeCost;
    
    const additionalChargeValue = Math.max(0, finalBreakEvenCost - initialBreakEvenCost);
    const absorbedCostValue = applyAdditionalCharges ? 0 : additionalChargeValue;

    return {
        initialBreakEven: initialBreakEvenCost,
        finalBreakEven: finalBreakEvenCost,
        additionalCharge: additionalChargeValue,
        absorbedCost: absorbedCostValue
    };
  }, [service, actualDuration, editableFormula, inventory, applyAdditionalCharges, appointment]);

  const handleStaffOverride = (serviceId: string, staffId: string) => {
    setServiceStaffOverrides(prev => ({ ...prev, [serviceId]: staffId }));
  };

  const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id, name: p.name, quantity: 1, unit: p.unit || 'unit', costPerUnit: p.costPerUnit || 0, isCustom: true,
      }));
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
      setIsProductBrowserOpen(false);
  };
  
  const removeProduct = (productId: string) => {
    setEditableFormula(prev => prev.filter(item => item.id !== productId));
  };
  
  const removeAddOn = (addOnId: string) => {
    setSelectedAddOns(prev => prev.filter(a => a.id !== addOnId));
  };
  
  const handleSend = () => {
    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        addOns: selectedAddOns,
        actualDuration: actualDuration,
        serviceStaffOverrides,
        absorbedCost: absorbedCost,
        retailItems: [],
        tipAllocations: {},
        tipAmount: 0,
    };
    onSendToFrontDesk(appointment.id, checkoutState);
  };

  if (!client || !service) {
    return null;
  }

  const FormContent = (
      <div className="space-y-6">
        <Card>
            <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="w-12 h-12"><AvatarImage src={client.avatarUrl} /><AvatarFallback>{client.name.substring(0,2)}</AvatarFallback></Avatar>
                <div>
                    <p className="font-semibold">{client.name}</p>
                    <p className="text-sm text-muted-foreground">{service.name}</p>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle>Service Actuals</CardTitle><CardDescription>Log what was actually used for this service.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Actual Duration: <span className="font-bold">{actualDuration} min</span> (Scheduled: {service.duration} min)</Label></div>
                <Separator />
                <h4 className="font-medium">Product Formula</h4>
                <div className="space-y-2 text-sm">
                    {editableFormula.map((item, index) => {
                        const inventoryItem = inventory.find(i => i.id === item.id);
                        const unit = inventoryItem?.costingMethod === 'uses' ? (inventoryItem.useUnit || 'uses') : (inventoryItem?.unit || 'unit');
                        return (
                            <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md gap-2">
                                <p className="font-medium flex-1 truncate pr-2">{item.name}</p>
                                <div className="flex items-center gap-2">
                                    <Input type="number" value={item.quantity} onChange={(e) => {
                                        const newQty = parseFloat(e.target.value) || 0;
                                        setEditableFormula(prev => prev.map(p => p.id === item.id ? {...p, quantity: newQty} : p))
                                    }} className="w-20 h-8 text-center" step="0.1" />
                                    <span className="text-xs text-muted-foreground w-10 truncate">{unit}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeProduct(item.id)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            </div>
                        )
                    })}
                </div>
                <Button variant="outline" size="sm" onClick={() => setIsProductBrowserOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader><CardTitle>Add-ons & Staff</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <h4 className="font-medium text-sm">Add-on Services</h4>
                {selectedAddOns.map(item => (<div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md"><p className="text-sm font-medium">{item.name}</p><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}
                <Button variant="outline" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4"/>Select Add-ons</Button>
                <Separator className="my-4"/>
                <h4 className="font-medium text-sm">Staff Assignment</h4>
                <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md"><span className="text-sm font-medium">{service.name}</span><Select value={serviceStaffOverrides[service.id] || ''} onValueChange={(staffId) => handleStaffOverride(service.id, staffId)}><SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Select Staff" /></SelectTrigger><SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                    {selectedAddOns.map(addon => (<div key={addon.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md"><span className="text-sm pl-4">+ {addon.name}</span><Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}><SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Select Staff" /></SelectTrigger><SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>))}
                </div>
            </CardContent>
        </Card>

        {additionalCharge > 0 && (
            <Card>
                <CardHeader>
                    <CardTitle>Additional Charges</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>This service ran over schedule.</AlertTitle>
                        <AlertDescription>
                            Based on your TMHR and the actual duration, there is an additional cost of <strong>${additionalCharge.toFixed(2)}</strong>.
                        </AlertDescription>
                    </Alert>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <Label htmlFor="apply-charges">Pass this cost on to the client?</Label>
                        <Switch id="apply-charges" checked={applyAdditionalCharges} onCheckedChange={setApplyAdditionalCharges} />
                    </div>
                     {!applyAdditionalCharges && <p className="text-xs text-muted-foreground">The cost of <strong>${absorbedCost.toFixed(2)}</strong> will be absorbed by the business.</p>}
                </CardContent>
            </Card>
        )}
      </div>
  );

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? 'bottom' : undefined} className={cn(isMobile ? "h-[90vh] flex flex-col p-0" : "sm:max-w-xl max-h-[90vh] flex flex-col p-0")}>
            <DialogHeader className="p-6 pb-0">
                <DialogTitle>Finish Service & Review</DialogTitle>
                <DialogDescription>Confirm service details before sending to the front desk for checkout.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1">
                {FormContent}
            </ScrollArea>
            <DialogFooter className="p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleSend}>Send to Front Desk</Button>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
      
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={services.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
    </>
  );
};
