

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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CheckCircle, FileText, FlaskConical, PlusCircle, Trash2, Library, Wand, QrCode, Search, AlertTriangle, ShoppingCart, CreditCard, Banknote, Gift, Coins, ShieldAlert, DollarSign as DollarSignIcon } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection, type CustomFormula, type Staff, AppointmentCheckoutState } from '@/lib/data';
import { Input } from '../ui/input';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '@/lib/utils';
import { ReceiptData } from './PrintReceipt';
import { LogIncidentForm, incidentSchema, type IncidentFormData } from '../incidents/LogIncidentForm';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { differenceInMinutes, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
    isCustom?: boolean; // Flag for items added on the fly
};


interface CompleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentData: {
    appointment: Appointment;
    client: Client | undefined;
    service: Service | undefined;
  };
  onConfirmCheckout: (updatedInventory: InventoryItem[], newCorrections: StockCorrection[], receiptData: Omit<ReceiptData, 'business'>, incident?: IncidentFormData) => void;
  onSendToFrontDesk: (appointmentId: string, checkoutState: AppointmentCheckoutState) => void;
}

export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onConfirmCheckout,
  onSendToFrontDesk,
}) => {
  const { inventory, services, staff } = useInventory();
  const { appointment, client, service } = appointmentData;
  const [formulaName, setFormulaName] = useState('Default Service Formula');
  const { toast } = useToast();

  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  
  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [actualDuration, setActualDuration] = useState(service?.duration || 0);
  const [applyAdditionalCharges, setApplyAdditionalCharges] = useState(true);

  const [logIncident, setLogIncident] = useState(false);
  const incidentMethods = useForm<IncidentFormData>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      type: 'Other',
      severity: 'Minor',
      description: '',
      actionsTaken: '',
      photoUrl: '',
    },
  });

  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);

  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
  
  useEffect(() => {
    if (open && service && appointment) {
        const checkoutState = appointment.checkoutState;
        const initialFormula = checkoutState?.formula || service.products?.map(p => ({
            id: p.id, name: p.name, quantity: p.quantityUsed, unit: p.unit || 'uses', costPerUnit: p.costPerUnit || 0
        })) || [];
        setEditableFormula(initialFormula);
        setRetailItems(checkoutState?.retailItems || []);
        const initialAddons = checkoutState?.addOns || (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s);
        setSelectedAddOns(initialAddons);
        setFormulaName('Default Service Formula');
        setAmountTendered(0);
        setTipAmount(checkoutState?.tipAmount || 0);
        setPaymentTab('card');
        setActualDuration(checkoutState?.actualDuration || service.duration);
        setApplyAdditionalCharges(true);
        setLogIncident(false);
        incidentMethods.reset();
        setPromoCode(client?.referredBy ? 'NEWCLIENT15' : '');
        setDiscount(0);
        setServiceStaffOverrides(checkoutState?.serviceStaffOverrides || { [service.id]: appointment.staffId || '' });
    }
  }, [service, open, appointment, incidentMethods, client, services]);

  const allServicesForAppointment = useMemo(() => [service, ...selectedAddOns].filter((s): s is Service => !!s), [service, selectedAddOns]);

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

    const actualServiceDuration = appointment.actualEndTime && appointment.actualStartTime
      ? differenceInMinutes(parseISO(appointment.actualEndTime), parseISO(appointment.actualStartTime))
      : actualDuration;
      
    const finalTimeCost = ((actualServiceDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
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

  const retailTotal = useMemo(() => {
    return retailItems.reduce((acc, item) => {
        const product = inventory.find(p => p.id === item.id);
        const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0; // Mocked markup
        return acc + (item.quantity * price);
    }, 0);
  }, [retailItems, inventory]);
  
  const subtotal = (service?.price || 0) + selectedAddOns.reduce((acc, s) => acc + s.price, 0) + retailTotal + (applyAdditionalCharges ? additionalCharge : 0);
  const mockTax = (subtotal - discount) * 0.07; // 7% tax for demo
  const grandTotal = subtotal - discount + mockTax + tipAmount;
  
  const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - grandTotal : 0;

  const handleApplyPromo = () => {
    if (promoCode === 'NEWCLIENT15' && client && client.lifetimeValue < (service?.price || 0)) {
        setDiscount(15);
        toast({ title: "Discount Applied!", description: "$15.00 new client discount has been applied." })
    } else {
        toast({ variant: "destructive", title: "Invalid Code", description: "This promo code is not valid for this client or appointment." })
    }
  }


  const handleKeepTheChange = () => {
    if (changeDue > 0) {
        setTipAmount(prevTip => prevTip + changeDue);
        setAmountTendered(grandTotal + changeDue); 
        toast({ title: "Tip Added!", description: `$${changeDue.toFixed(2)} has been added as a tip.` });
    }
  };

  const handleQuantityChange = (productId: string, newQuantity: number) => {
    setEditableFormula(prev => prev.map(item => item.id === productId ? { ...item, quantity: newQuantity } : item));
  };
  
  const handleRetailQuantityChange = (productId: string, newQuantity: number) => {
    setRetailItems(prev => prev.map(item => item.id === productId ? { ...item, quantity: newQuantity } : item));
  };
  
  const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id, name: p.name, quantity: 1, unit: p.unit || 'unit', costPerUnit: p.costPerUnit || 0, isCustom: true,
      }));
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
  };

  const handleAddRetail = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id, name: p.name, quantity: 1, unit: 'unit', costPerUnit: p.costPerUnit || 0,
      }));
      setRetailItems(newItems);
  }
  
  const handleRemoveProduct = (productId: string) => {
    setEditableFormula(prev => prev.filter(item => item.id !== productId));
  };

  const handleRemoveRetail = (productId: string) => {
    setRetailItems(prev => prev.filter(item => item.id !== productId));
  };

  const handleApplyClientFormula = (formulaName: string) => {
      const formula = client?.customFormulas?.find(f => f.name === formulaName);
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

  const { updatedInventory, newCorrections, warnings } = useMemo(() => {
    const warnings: string[] = [];
    const newCorrections: StockCorrection[] = [];
    let tempInventory = JSON.parse(JSON.stringify(inventory)) as InventoryItem[];

    editableFormula.forEach(item => {
    });

    return { updatedInventory: tempInventory, displayCorrections: editableFormula, newCorrections, warnings };
  }, [editableFormula, inventory, appointment.id]);
  
  const handleCompleteAppointment = async () => {
    let incidentData: IncidentFormData | undefined = undefined;
    if (logIncident) {
        const isValid = await incidentMethods.trigger();
        if (!isValid) {
            toast({ variant: 'destructive', title: "Incident Form Incomplete", description: "Please fill out all required fields for the incident report." });
            return;
        }
        incidentData = incidentMethods.getValues();
    }

    if (!client || !service) return;

    const receiptData: Omit<ReceiptData, 'business'> = {
        clientName: client.name, date: appointment.endTime,
        items: [
            { name: service.name, quantity: 1, price: service.price },
            ...retailItems.map(item => {
                const product = inventory.find(p => p.id === item.id);
                const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
                return { name: item.name, quantity: item.quantity, price: price };
            }),
            ...(additionalCharge > 0 && applyAdditionalCharges ? [{ name: 'Additional Charges', quantity: 1, price: additionalCharge }] : [])
        ],
        subtotal: subtotal, tax: mockTax, tip: tipAmount, total: grandTotal,
        payment: { method: paymentTab, amountTendered: paymentTab === 'cash' ? amountTendered : grandTotal, changeDue: changeDue > 0 ? changeDue : 0 }
    };
    onConfirmCheckout(updatedInventory, newCorrections, receiptData, incidentData);
  };

  const handleSendToFrontDesk = () => {
    if (!client || !service) return;

    const currentCheckoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems,
        addOns: selectedAddOns,
        actualDuration,
        serviceStaffOverrides,
        tipAllocations,
        tipAmount,
    };
    onSendToFrontDesk(appointment.id, currentCheckoutState);
  }

  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const [isRetailBrowserOpen, setIsRetailBrowserOpen] = useState(false);
  
   useEffect(() => {
    if (isScannerOpen) {
      const getCameraPermission = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          setHasCameraPermission(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } catch (error) {
          console.error('Error accessing camera:', error);
          setHasCameraPermission(false);
          toast({
            variant: 'destructive',
            title: 'Camera Access Denied',
            description: 'Please enable camera permissions in your browser settings to use the scanner.',
          });
          setIsScannerOpen(false);
        }
      };
      getCameraPermission();
    } else {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }
  }, [isScannerOpen, toast]);
  
  const denominations = [100, 50, 20, 10, 5, 1, 0.25, 0.10, 0.05, 0.01];

  const handleDenominationClick = (amount: number) => {
    setAmountTendered(prev => prev + amount);
  }
  
  const actualServiceDuration = useMemo(() => {
    if (appointment.actualStartTime && appointment.actualEndTime) {
      return differenceInMinutes(parseISO(appointment.actualEndTime), parseISO(appointment.actualStartTime));
    }
    return actualDuration;
  }, [appointment, actualDuration]);

  if (!client || !service) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl print:hidden">
          <DialogHeader>
            <DialogTitle>Complete Appointment & Checkout</DialogTitle>
            <DialogDescription>
              Confirm products used, add retail sales, and finalize the appointment.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
          <div className="py-4 space-y-6">
              <Card>
                  <CardContent className="p-4 flex items-center gap-4">
                       <Avatar className="w-12 h-12">
                          <AvatarImage src={client.avatarUrl} alt={client.name} />
                          <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                          <p className="font-semibold">{client.name}</p>
                          <p className="text-sm text-muted-foreground">{service.name}</p>
                      </div>
                  </CardContent>
              </Card>
              
               <Card>
                  <CardHeader>
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div>
                              <CardTitle>Service Actuals</CardTitle>
                              <CardDescription>Log what was actually used for this service.</CardDescription>
                          </div>
                      </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="actual-duration">Actual Duration (minutes)</Label>
                        <Input 
                            id="actual-duration"
                            type="number"
                            value={actualServiceDuration}
                            onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                            readOnly={!!(appointment.actualStartTime && appointment.actualEndTime)}
                        />
                         {appointment.actualStartTime && appointment.actualEndTime && (
                            <p className="text-xs text-muted-foreground">
                                Service duration tracked from start to finish: {actualServiceDuration} min. (Scheduled: {service.duration} min)
                            </p>
                        )}
                      </div>
                      <Separator />
                       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <h4 className="font-medium">Product Formula</h4>
                          {client.customFormulas && client.customFormulas.length > 0 && (
                            <div className="w-full sm:w-auto sm:min-w-[200px]">
                                <Select onValueChange={handleApplyClientFormula}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Load a client formula..." />
                                    </SelectTrigger>
                                    <SelectContent>
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
                          {editableFormula.map((item) => (
                              <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                                  <div>
                                      <p className="font-medium">{item.name}</p>
                                      <p className="text-xs text-muted-foreground">Cost: ${(item.costPerUnit || 0).toFixed(2)}/{item.unit}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <Input
                                          type="number"
                                          value={item.quantity}
                                          onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                                          className="w-20 h-8 text-center"
                                      />
                                      <span className="w-8 text-muted-foreground">{item.unit}</span>
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveProduct(item.id)}>
                                          <Trash2 className="h-4 w-4" />
                                      </Button>
                                  </div>
                              </div>
                          ))}
                      </div>
                      <div className='flex gap-2'>
                        <Button variant="outline" size="sm" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button>
                        <Button variant="outline" size="sm" onClick={() => setIsScannerOpen(true)}><QrCode className="mr-2 h-4 w-4"/>Scan Product</Button>
                      </div>
                  </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Retail & Add-ons</CardTitle>
                  <CardDescription>Add any products the client is purchasing or extra services.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                     <h4 className="font-medium text-sm">Add-on Services</h4>
                     <div className="space-y-2 text-sm">
                          {selectedAddOns.map((item) => (
                              <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                                  <p className="font-medium">{item.name}</p>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setSelectedAddOns(prev => prev.filter(s => s.id !== item.id))}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                              </div>
                          ))}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setIsAddOnSelectorOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Select Add-ons</Button>
                     <Separator className="my-4"/>
                     <h4 className="font-medium text-sm">Retail Products</h4>
                     <div className="space-y-2 text-sm">
                          {retailItems.map((item) => {
                             const product = inventory.find(p => p.id === item.id);
                             const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
                             return (
                              <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                                  <div>
                                      <p className="font-medium">{item.name}</p>
                                      <p className="text-xs text-muted-foreground">Price: ${price.toFixed(2)}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <Input
                                          type="number"
                                          value={item.quantity}
                                          onChange={(e) => handleRetailQuantityChange(item.id, parseInt(e.target.value) || 0)}
                                          className="w-16 h-8 text-center"
                                          min={1}
                                      />
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveRetail(item.id)}>
                                          <Trash2 className="h-4 w-4" />
                                      </Button>
                                  </div>
                              </div>
                          )})}
                      </div>
                      <div className='flex gap-2'>
                        <Button variant="outline" size="sm" onClick={() => setIsRetailBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Retail</Button>
                        <Button variant="outline" size="sm" onClick={() => setIsScannerOpen(true)}><QrCode className="mr-2 h-4 w-4"/>Scan to Add</Button>
                      </div>
                </CardContent>
              </Card>
              
               <Card>
                <CardHeader>
                  <CardTitle>Incident Report</CardTitle>
                  <div className="flex items-center justify-between">
                    <CardDescription>Log an incident related to this appointment.</CardDescription>
                    <Switch checked={logIncident} onCheckedChange={setLogIncident} />
                  </div>
                </CardHeader>
                {logIncident && (
                  <CardContent>
                     <FormProvider {...incidentMethods}>
                        <LogIncidentForm />
                     </FormProvider>
                  </CardContent>
                )}
              </Card>

               <Card>
                  <CardHeader>
                      <CardTitle>Payment & Checkout</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="space-y-2">
                          <Label htmlFor="promo-code">Promo Code</Label>
                          <div className="flex gap-2">
                              <Input id="promo-code" value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="e.g., NEWCLIENT15" />
                              <Button variant="outline" onClick={handleApplyPromo}>Apply</Button>
                          </div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
                        <div className='flex justify-between'><span>Base Service Price:</span><span>${service.price.toFixed(2)}</span></div>
                        {selectedAddOns.map(addon => (
                            <div key={addon.id} className="flex justify-between pl-4"><span>+ {addon.name}</span><span>${addon.price.toFixed(2)}</span></div>
                        ))}
                        <div className='flex justify-between'><span>Retail:</span><span>${retailTotal.toFixed(2)}</span></div>
                        
                        {additionalCharge > 0 && (
                             <div className='flex justify-between items-center p-3 my-2 -mx-3 rounded-lg bg-amber-500/10'>
                                <div className="space-y-1">
                                    <Label htmlFor="apply-charges" className="font-medium text-amber-900 dark:text-amber-300">Apply Additional Charges?</Label>
                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                        Initial Cost: ${initialBreakEven.toFixed(2)} vs Final Cost: ${finalBreakEven.toFixed(2)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-semibold text-amber-900 dark:text-amber-300">+${additionalCharge.toFixed(2)}</span>
                                    <Switch 
                                        id="apply-charges" 
                                        checked={applyAdditionalCharges} 
                                        onCheckedChange={setApplyAdditionalCharges} 
                                    />
                                </div>
                            </div>
                        )}
                        {discount > 0 && (
                            <div className='flex justify-between text-primary font-semibold'>
                                <span>Referral Discount:</span>
                                <span>-${discount.toFixed(2)}</span>
                            </div>
                        )}
                         <Separator className="my-2" />
                        <div className='flex justify-between font-semibold'><span>Subtotal:</span><span>${(subtotal - discount).toFixed(2)}</span></div>
                        <div className='flex justify-between'><span>Taxes (7%):</span><span>${mockTax.toFixed(2)}</span></div>
                         {tipAmount > 0 && (
                            <div className='flex justify-between font-semibold text-primary'><span>Tip:</span><span>${tipAmount.toFixed(2)}</span></div>
                         )}
                      </div>
                      <div className="p-4 rounded-lg bg-primary/10 text-center">
                          <p className="text-sm font-medium text-primary">Total Due</p>
                          <p className="text-5xl font-bold text-primary">${grandTotal.toFixed(2)}</p>
                      </div>

                      {absorbedCost > 0 && (
                          <Alert variant="destructive" className="bg-orange-500/5 border-orange-500/30 text-orange-800 dark:text-orange-300 [&>svg]:text-orange-500">
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>Absorbed Cost</AlertTitle>
                              <AlertDescription>
                                  You are absorbing <span className="font-bold">${absorbedCost.toFixed(2)}</span> in extra costs for this service.
                              </AlertDescription>
                          </Alert>
                      )}

                      <Tabs value={paymentTab} onValueChange={setPaymentTab} className="w-full">
                          <TabsList className="grid w-full grid-cols-3">
                              <TabsTrigger value="card"><CreditCard className="w-4 h-4 mr-2"/>Card</TabsTrigger>
                              <TabsTrigger value="cash"><Banknote className="w-4 h-4 mr-2"/>Cash</TabsTrigger>
                              <TabsTrigger value="other"><Gift className="w-4 h-4 mr-2"/>Other</TabsTrigger>
                          </TabsList>
                          <TabsContent value="card" className="pt-4 space-y-4">
                              <Button className="w-full" size="lg">Charge Card on File</Button>
                              <div className="grid grid-cols-2 gap-4">
                                  <Button variant="outline" className="w-full" size="lg">Launch Square</Button>
                                  <Button variant="outline" className="w-full" size="lg">Launch Stripe</Button>
                              </div>
                          </TabsContent>
                          <TabsContent value="cash" className="pt-4 space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                      <Label>Amount Tendered</Label>
                                      <div className='p-4 text-2xl font-bold text-center bg-muted rounded-md'>
                                          ${amountTendered.toFixed(2)}
                                      </div>
                                  </div>
                                   <div className="space-y-2">
                                      <Label>Change Due</Label>
                                       <div className={`p-4 text-2xl font-bold text-center rounded-md ${changeDue >= 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                                          ${Math.abs(changeDue).toFixed(2)}
                                      </div>
                                  </div>
                              </div>
                               {changeDue > 0 && (
                                <Button variant="secondary" className="w-full" onClick={handleKeepTheChange}>
                                    <Coins className="w-4 h-4 mr-2" /> Keep the Change as Tip
                                </Button>
                               )}
                              <div className="grid grid-cols-5 gap-2">
                                  {denominations.map(amount => (
                                      <Button key={amount} variant="outline" onClick={() => handleDenominationClick(amount)}>
                                          {amount >= 1 ? `$${amount}` : `${amount * 100}¢`}
                                      </Button>
                                  ))}
                              </div>
                               <Button variant="secondary" className="w-full" onClick={() => setAmountTendered(0)}>Clear</Button>
                          </TabsContent>
                          <TabsContent value="other" className="pt-4">
                               <Button variant="outline" className="w-full" size="lg">Record Manual Payment (Venmo, etc.)</Button>
                          </TabsContent>
                      </Tabs>
                  </CardContent>
              </Card>
          </div>
          </ScrollArea>
          <DialogFooter className="print:hidden pt-4 border-t">
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
                <Button variant="secondary" onClick={handleSendToFrontDesk}>Send to Front Desk</Button>
                <div className="flex-1" />
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleCompleteAppointment} disabled={warnings.some(w => w.includes('Insufficient stock'))}>
                  Complete & Charge
                </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SelectAddOnsDialog
        open={isAddOnSelectorOpen}
        onOpenChange={setIsAddOnSelectorOpen}
        onSelect={setSelectedAddOns}
        allAddOns={services.filter(s => s.type === 'addon')}
        initialSelected={selectedAddOns}
      />
      <BrowseProductsDialog
        open={isProductBrowserOpen}
        onOpenChange={setIsProductBrowserOpen}
        onSelect={handleAddProduct}
        allProducts={inventory.filter(i => i.type === 'professional')}
        initialSelected={[]}
      />
      <BrowseProductsDialog
        open={isRetailBrowserOpen}
        onOpenChange={setIsRetailBrowserOpen}
        onSelect={handleAddRetail}
        allProducts={inventory.filter(i => i.type === 'retail')}
        initialSelected={retailItems}
      />
       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Product</DialogTitle>
            <DialogDescription>
              Position the product's barcode or QR code inside the frame.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <video ref={videoRef} className="w-full aspect-square rounded-md bg-muted" autoPlay muted playsInline />
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please enable camera access to use the scanner. You may need to change permissions in your browser settings.
                    </AlertDescription>
                </Alert>
            )}
          </div>
           <DialogFooter className="p-4 pt-0 flex-col gap-2">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
