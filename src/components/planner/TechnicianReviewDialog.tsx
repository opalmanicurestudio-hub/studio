

'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
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
import { FlaskConical, PlusCircle, Trash2, QrCode, AlertTriangle, Calculator, Clock } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection, type CustomFormula, type Staff, AppointmentCheckoutState, Incident, Discount } from '@/lib/data';
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
  staff: Staff[];
}

const FormContent = ({
  appointment,
  client,
  service,
  staff,
  editableFormula, setEditableFormula,
  selectedAddOns, setSelectedAddOns,
  serviceStaffOverrides, setServiceStaffOverrides,
  actualDuration, setActualDuration,
  applyAdditionalCharges, setApplyAdditionalCharges,
  additionalCharge,
  absorbedCost,
  timeDifference,
  timeCostDifference,
  productDifferences,
}: {
  appointment: Appointment,
  client: Client,
  service: Service,
  staff: Staff[];
  editableFormula: EditableFormulaItem[];
  setEditableFormula: React.Dispatch<React.SetStateAction<EditableFormulaItem[]>>;
  selectedAddOns: Service[];
  setSelectedAddOns: React.Dispatch<React.SetStateAction<Service[]>>;
  serviceStaffOverrides: Record<string, string>;
  setServiceStaffOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  actualDuration: number;
  setActualDuration: React.Dispatch<React.SetStateAction<number>>;
  applyAdditionalCharges: boolean;
  setApplyAdditionalCharges: React.Dispatch<React.SetStateAction<boolean>>;
  additionalCharge: number;
  absorbedCost: number;
  timeDifference: number;
  timeCostDifference: number;
  productDifferences: { name: string; extraQuantity: number; cost: number; unit: string; }[];
}) => {
  const { inventory, services } = useInventory();
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const [formulaName, setFormulaName] = useState('Default Service Formula');
  
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
  
  const removeAddOn = (addOnId: string) => {
    setSelectedAddOns(prev => prev.filter(a => a.id !== addOnId));
  };

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
          setFormulaName('Default Service Formula');
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
      setFormulaName(formula.name);
  }

  return (
    <>
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
                <div className="space-y-2">
                  <Label htmlFor="actual-duration">Actual Duration (minutes)</Label>
                  <Input 
                      id="actual-duration"
                      type="number"
                      value={actualDuration}
                      onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                      readOnly={!!(appointment.actualStartTime && appointment.actualEndTime)}
                  />
                    {appointment.actualStartTime && appointment.actualEndTime && (
                      <p className="text-xs text-muted-foreground">
                          Service duration tracked from start to finish: {actualDuration} min. (Scheduled: {service.duration} min)
                      </p>
                  )}
                </div>
                <Separator />
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h4 className="font-medium">Product Formula</h4>
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
                  <div className="p-3 rounded-md bg-muted/50 text-muted-foreground text-sm flex items-start gap-2">
                    <FlaskConical className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>Currently applying: <span className="font-semibold text-foreground">{formulaName}</span></p>
                  </div>
                <div className="space-y-2 text-sm">
                    {editableFormula.map((item, index) => {
                        const inventoryItem = inventory.find(i => i.id === item.id);
                        let costPerUse = 0;
                        if (inventoryItem) {
                            if (inventoryItem.costingMethod === 'size' && inventoryItem.size && inventoryItem.size > 0) {
                                costPerUse = (inventoryItem.costPerUnit || 0) / inventoryItem.size;
                            } else if (inventoryItem.costingMethod === 'uses' && inventoryItem.estimatedUses && inventoryItem.estimatedUses > 0) {
                                costPerUse = (inventoryItem.costPerUnit || 0) / inventoryItem.estimatedUses;
                            } else { // 'unit' or undefined
                                costPerUse = inventoryItem.costPerUnit || 0;
                            }
                        }
                          
                        return (
                          <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md gap-2">
                              <div>
                                  <p className="font-medium">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">Cost: ${costPerUse.toFixed(3)}/{item.unit}</p>
                              </div>
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
                        )
                    })}
                </div>
                <div className='flex gap-2'><Button variant="outline" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button><Button variant="outline" size="sm" type="button" onClick={() => {}}><QrCode className="mr-2 h-4 w-4"/>Scan Product</Button></div>
            </CardContent>
        </Card>
        
        <Card>
          <CardHeader><CardTitle>Add-ons & Staff</CardTitle></CardHeader>
          <CardContent className="space-y-3">
                <h4 className="font-medium text-sm">Add-on Services</h4>
                <div className="space-y-2 text-sm">
                    {selectedAddOns.map(item => (<div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md"><p className="font-medium">{item.name}</p><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}><Trash2 className="h-4 w-4" /></Button></div>))}
                </div>
                <Button variant="outline" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
                <Separator className="my-4"/>
                <h4 className="font-medium text-sm">Staff Assignment</h4>
                 <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                        <span className="text-sm font-medium">{service.name}</span>
                        <span className="text-sm font-semibold pr-2">{staff.find(s => s.id === appointment.staffId)?.name || 'Unassigned'}</span>
                    </div>
                    {selectedAddOns.map(addon => (
                        <div key={addon.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                            <span className="text-sm pl-4">+ {addon.name}</span>
                            <Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}>
                                <SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Select Staff" /></SelectTrigger>
                                <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    ))}
                </div>
          </CardContent>
        </Card>

        {additionalCharge > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Service Adjustments</CardTitle>
              <CardDescription>
                Additional time or product was used for this service.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg border bg-muted/50 space-y-2 text-sm">
                {timeDifference > 0 && (
                  <div className="flex justify-between items-center">
                    <span>
                      <Clock className="w-3 h-3 inline-block mr-1.5" /> Extra
                      Time
                    </span>
                    <span className="font-mono flex items-center gap-2">
                      {timeDifference} min{' '}
                      <span className="text-muted-foreground font-sans text-xs">
                        (${timeCostDifference.toFixed(2)})
                      </span>
                    </span>
                  </div>
                )}
                {productDifferences.length > 0 && (
                  <>
                    {timeDifference > 0 && <Separator />}
                    {productDifferences.map((p, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span>
                          <FlaskConical className="w-3 h-3 inline-block mr-1.5" />{' '}
                          {p.name}
                        </span>
                        <span className="font-mono flex items-center gap-2">
                          +{p.extraQuantity}
                          {p.unit}{' '}
                          <span className="text-muted-foreground font-sans text-xs">
                            (${p.cost.toFixed(2)})
                          </span>
                        </span>
                      </div>
                    ))}
                  </>
                )}
                <Separator className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Additional Cost</span>
                  <span>${additionalCharge.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <Label htmlFor="apply-charges">
                  Pass this cost on to the client?
                </Label>
                <Switch
                  id="apply-charges"
                  checked={applyAdditionalCharges}
                  onCheckedChange={setApplyAdditionalCharges}
                />
              </div>
              {!applyAdditionalCharges && (
                <p className="text-xs text-muted-foreground">
                  The cost of <strong>${absorbedCost.toFixed(2)}</strong> will
                  be absorbed by the business.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={services.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
    </>
  );
}


export const TechnicianReviewDialog: React.FC<TechnicianReviewDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onSendToFrontDesk,
  staff,
}) => {
  const { appointment, client, service } = appointmentData;
  const { services, inventory } = useInventory();
  const isMobile = useIsMobile();
  
  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [actualDuration, setActualDuration] = useState(service?.duration || 0);
  const [applyAdditionalCharges, setApplyAdditionalCharges] = useState(true);
  const [tmhr, setTmhr] = useState(0);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
        }
    }, []);

    const { 
        additionalCharge, 
        absorbedCost,
        timeDifference,
        timeCostDifference,
        productDifferences,
    } = useMemo(() => {
        if (!service) return { additionalCharge: 0, absorbedCost: 0, timeDifference: 0, timeCostDifference: 0, productDifferences: [] };
        
        const tmhrValue = tmhr;

        // Time Difference
        const scheduledDuration = service.duration || 0;
        const timeDiff = actualDuration - scheduledDuration;
        const timeCostDiff = timeDiff > 0 ? (timeDiff / 60) * tmhrValue : 0;

        // Product Difference
        const defaultFormulaMap = new Map( (service.products || []).map(p => [p.id, p.quantityUsed]) );
        const actualFormulaMap = new Map( editableFormula.map(p => [p.id, p.quantity]) );
        
        const productDiffs: { name: string; extraQuantity: number; cost: number; unit: string; }[] = [];
        let productCostDiff = 0;

        const allProductIds = new Set([...defaultFormulaMap.keys(), ...actualFormulaMap.keys()]);

        allProductIds.forEach(productId => {
            const defaultQty = defaultFormulaMap.get(productId) || 0;
            const actualQty = actualFormulaMap.get(productId) || 0;
            const qtyDifference = actualQty - defaultQty;

            if (qtyDifference > 0) {
                const product = inventory.find(i => i.id === productId);
                if (product) {
                    let costPerUse = 0;
                    if (product.costingMethod === 'size' && product.size && product.size > 0) {
                        costPerUse = (product.costPerUnit || 0) / product.size;
                    } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                        costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
                    } else {
                        costPerUse = product.costPerUnit || 0;
                    }
                    
                    const costOfDifference = qtyDifference * costPerUse;
                    productCostDiff += costOfDifference;
                    productDiffs.push({
                        name: product.name,
                        extraQuantity: qtyDifference,
                        cost: costOfDifference,
                        unit: product.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product.unit || 'unit')
                    });
                }
            }
        });
        
        const additionalChargeValue = timeCostDiff + productCostDiff;
        const absorbedCostValue = applyAdditionalCharges ? 0 : additionalChargeValue;

        return {
            additionalCharge: additionalChargeValue,
            absorbedCost: absorbedCostValue,
            timeDifference: timeDiff,
            timeCostDifference: timeCostDiff,
            productDifferences: productDiffs,
        };
    }, [service, actualDuration, editableFormula, inventory, applyAdditionalCharges, tmhr]);

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
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s));
        setSelectedAddOns(initialAddons);

        setActualDuration(checkoutState?.actualDuration || 
            (appointment.actualStartTime && appointment.actualEndTime 
                ? differenceInMinutes(
                    typeof appointment.actualEndTime === 'string' ? parseISO(appointment.actualEndTime) : appointment.actualEndTime,
                    typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime
                ) 
                : service.duration));
        
        const initialOverrides: Record<string, string> = {};
        initialAddons.forEach(addon => {
            initialOverrides[addon.id] = appointment.staffId || '';
        });
        setServiceStaffOverrides(checkoutState?.serviceStaffOverrides || initialOverrides);
    }
  }, [service, appointment, open, services, inventory]);

  
  const handleSend = () => {
    if (!client || !service || !onSendToFrontDesk) return;

    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems: [],
        addOns: selectedAddOns,
        actualDuration,
        serviceStaffOverrides,
        tipAllocations: {},
        tipAmount: 0,
        absorbedCost,
    };
    onSendToFrontDesk(appointment.id, checkoutState);
  };

  if (!client || !service) {
    return null;
  }

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={cn(isMobile ? "h-[90vh] flex flex-col p-0" : "sm:max-w-xl max-h-[90vh] flex flex-col p-0")}>
            <DialogHeader className="p-6 pb-0">
                <DialogTitle>Finish Service & Review</DialogTitle>
                <DialogDescription>Confirm service details before sending to the front desk for checkout.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-6 pt-4">
                  <FormContent 
                    appointment={appointment} 
                    client={client} 
                    service={service} 
                    staff={staff} 
                    editableFormula={editableFormula}
                    setEditableFormula={setEditableFormula}
                    selectedAddOns={selectedAddOns}
                    setSelectedAddOns={setSelectedAddOns}
                    serviceStaffOverrides={serviceStaffOverrides}
                    setServiceStaffOverrides={setServiceStaffOverrides}
                    actualDuration={actualDuration}
                    setActualDuration={setActualDuration}
                    applyAdditionalCharges={applyAdditionalCharges}
                    setApplyAdditionalCharges={setApplyAdditionalCharges}
                    additionalCharge={additionalCharge}
                    absorbedCost={absorbedCost}
                    timeDifference={timeDifference}
                    timeCostDifference={timeCostDifference}
                    productDifferences={productDifferences}
                  />
              </div>
            </div>
            <DialogFooter className="p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleSend}>Send to Front Desk</Button>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
    </>
  );
};
