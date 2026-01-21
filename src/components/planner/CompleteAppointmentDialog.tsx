
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
import { AlertCircle, CheckCircle, FileText, FlaskConical, PlusCircle, Trash2, Library, Wand, QrCode, Search, AlertTriangle, ShoppingCart, CreditCard, Banknote, Gift, Coins, ShieldAlert, DollarSign, Users, Award, Repeat } from 'lucide-react';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Badge } from '../ui/badge';


type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
    isCustom?: boolean; // Flag for items added on the fly
};

export type CheckoutData = {
    updatedInventory: InventoryItem[];
    newCorrections: StockCorrection[];
    receiptData: Omit<ReceiptData, 'business'>;
    incident?: IncidentFormData;
    serviceStaffOverrides: Record<string, string>;
    tipAllocations: Record<string, number>;
    retailItems: EditableFormulaItem[];
    addOns: Service[];
    absorbedCost: number;
    tipAmount: number;
    redeemedOffer?: {
        type: 'membership' | 'package';
        id: string;
    } | null;
};

interface CompleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentData: {
    appointment: Appointment;
    client: Client | undefined;
    service: Service | undefined;
  };
  onConfirmCheckout: (data: CheckoutData) => void;
  onSendToFrontDesk?: (appointmentId: string, checkoutState: AppointmentCheckoutState) => void;
}

export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onConfirmCheckout,
  onSendToFrontDesk,
}) => {
  const { inventory, services, staff, memberships, packages, clients, setClients } = useInventory();
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
  const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package', id: string} | null>(null);

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
  const [membershipDiscount, setMembershipDiscount] = useState(0);

  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
  const isMobile = useIsMobile();
  
  const applicableOffers = useMemo(() => {
    if (!client || !service) return [];
    const offers: { type: 'membership' | 'package'; offer: any; sessionsRemaining?: number }[] = [];
    // Membership check
    if (client.activeMembershipId) {
        const membership = memberships.find(m => m.id === client.activeMembershipId);
        if (membership?.includedServices?.some(s => s.id === service.id)) {
            offers.push({ type: 'membership', offer: membership });
        }
    }
    // Package check
    if (client.activePackages) {
        client.activePackages.forEach(p => {
            if (p.sessionsRemaining > 0) {
                const packageInfo = packages.find(pkg => pkg.id === p.packageId);
                if (packageInfo?.serviceId === service.id) {
                    offers.push({ type: 'package', offer: packageInfo, sessionsRemaining: p.sessionsRemaining });
                }
            }
        });
    }
    return offers;
}, [client, service, memberships, packages]);

  // This would be dynamic in a real app, based on client's transaction history for the month
  const hasRedeemedThisMonth = true;

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
        setRedeemedOffer(null);
        setActualDuration(checkoutState?.actualDuration || service.duration);
        setApplyAdditionalCharges(true);
        setLogIncident(false);
        incidentMethods.reset();
        setPromoCode(client?.referredBy ? 'NEWCLIENT15' : '');
        setDiscount(0);
        setMembershipDiscount(0);

        const initialOverrides: Record<string, string> = { [service.id]: appointment.staffId || '' };
        initialAddons.forEach(addon => {
            initialOverrides[addon.id] = appointment.staffId || '';
        });
        setServiceStaffOverrides(checkoutState?.serviceStaffOverrides || initialOverrides);
        setTipAllocations(checkoutState?.tipAllocations || {});
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
  
    useEffect(() => {
        if (client && client.activeMembershipId) {
            const membership = memberships.find(m => m.id === client.activeMembershipId);
            if (membership?.retailDiscount && retailTotal > 0) {
                const discountValue = retailTotal * (membership.retailDiscount / 100);
                setMembershipDiscount(discountValue);
            } else {
                setMembershipDiscount(0);
            }
        } else {
            setMembershipDiscount(0);
        }
    }, [client, retailTotal, memberships]);

  const subtotal = useMemo(() => {
    const isPerkApplied = !!redeemedOffer;
    const servicePrice = isPerkApplied ? 0 : (service?.price || 0);
    return servicePrice + selectedAddOns.reduce((acc, s) => acc + s.price, 0) + retailTotal + (applyAdditionalCharges ? additionalCharge : 0);
  }, [service, selectedAddOns, retailTotal, additionalCharge, applyAdditionalCharges, redeemedOffer]);

  const totalDiscount = discount + membershipDiscount;
  const subtotalAfterDiscounts = subtotal > totalDiscount ? subtotal - totalDiscount : 0;
  const mockTax = subtotalAfterDiscounts * 0.07; // 7% tax for demo
  const grandTotal = subtotalAfterDiscounts + mockTax + tipAmount;
  
  const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - grandTotal : 0;

  const involvedStaff = useMemo(() => {
      const staffIds = new Set(Object.values(serviceStaffOverrides));
      return staff.filter(s => staffIds.has(s.id));
  }, [serviceStaffOverrides, staff]);

  const remainingTip = useMemo(() => {
      const allocatedTip = Object.values(tipAllocations).reduce((sum, amount) => sum + amount, 0);
      return tipAmount - allocatedTip;
  }, [tipAmount, tipAllocations]);


  const handleApplyPromo = () => {
    if (promoCode === 'NEWCLIENT15' && client && client.lifetimeValue < (service?.price || 0)) {
        setDiscount(15);
        toast({ title: "Discount Applied!", description: "$15.00 new client discount has been applied." })
    } else {
        toast({ variant: "destructive", title: "Invalid Code", description: "This promo code is not valid for this client or appointment." })
    }
  }


  const handleStaffOverride = (serviceId: string, staffId: string) => {
    setServiceStaffOverrides(prev => ({ ...prev, [serviceId]: staffId }));
  };

  const handleTipAllocation = (staffId: string, value: string) => {
    const amount = parseFloat(value) || 0;
    setTipAllocations(prev => ({ ...prev, [staffId]: amount }));
  };

  const splitTipEvenly = () => {
      if (involvedStaff.length === 0) return;
      const amountPerStaff = parseFloat((tipAmount / involvedStaff.length).toFixed(2));
      const newAllocations: Record<string, number> = {};
      involvedStaff.forEach(s => {
          newAllocations[s.id] = amountPerStaff;
      });

      // Adjust for rounding errors
      const totalAllocated = amountPerStaff * involvedStaff.length;
      const remainder = tipAmount - totalAllocated;
      if (remainder !== 0) {
          newAllocations[involvedStaff[0].id] += remainder;
      }

      setTipAllocations(newAllocations);
  };

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

    const allItemsToDeduct = [...editableFormula, ...retailItems];

    allItemsToDeduct.forEach(item => {
      const productIndex = tempInventory.findIndex(p => p.id === item.id);
      if (productIndex === -1) {
        warnings.push(`Product ${item.name} not found in inventory.`);
        return;
      }
      
      const product = tempInventory[productIndex];
      let quantityToDeduct = item.quantity;
      
      if (!product.costingMethod) {
          if (product.totalStock < quantityToDeduct) {
             warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${product.totalStock}`);
             return;
          }
          product.totalStock -= quantityToDeduct;
           newCorrections.push({
                id: `sc-${appointment.id}-${item.id}-${Date.now()}`,
                productId: item.id,
                date: new Date().toISOString(),
                change: -quantityToDeduct,
                unit: product.unit || 'units',
                reason: `Appointment #${appointment.id.slice(-4)}`
            });
            tempInventory[productIndex] = product;
            return;
      }

      if (product.costingMethod === 'uses') {
        const unit = product.useUnit || 'uses';
        let currentUses = product.partialContainerUses || 0;
        let totalStock = product.totalStock;
        const usesPerContainer = product.estimatedUses || 1;
        let totalAvailableUses = (totalStock * usesPerContainer) + currentUses;

        if (totalAvailableUses < quantityToDeduct) {
            warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${totalAvailableUses}`);
            return;
        }

        currentUses -= quantityToDeduct;
        while(currentUses < 0 && totalStock > 0) {
            totalStock -= 1;
            currentUses += usesPerContainer;
        }
        product.totalStock = totalStock;
        product.partialContainerUses = currentUses;

        newCorrections.push({
            id: `sc-${appointment.id}-${item.id}-${Date.now()}`,
            productId: item.id,
            date: new Date().toISOString(),
            change: -quantityToDeduct,
            unit: unit,
            reason: `Appointment #${appointment.id.slice(-4)}`
        });

      } else if (product.costingMethod === 'size') {
        const unit = product.unit || 'ml';
        let currentSize = product.partialContainerSize || 0;
        let totalStock = product.totalStock;
        const sizePerContainer = product.size || 1;
        let totalAvailableSize = (totalStock * sizePerContainer) + currentSize;

        if (totalAvailableSize < quantityToDeduct) {
            warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${totalAvailableSize}`);
            return;
        }

        currentSize -= quantityToDeduct;
        while(currentSize < 0 && totalStock > 0) {
            totalStock -= 1;
            currentSize += sizePerContainer;
        }
        product.totalStock = totalStock;
        product.partialContainerSize = currentSize;

        newCorrections.push({
            id: `sc-${appointment.id}-${item.id}-${Date.now()}`,
            productId: item.id,
            date: new Date().toISOString(),
            change: -quantityToDeduct,
            unit: unit,
            reason: `Appointment #${appointment.id.slice(-4)}`
        });
      }

      tempInventory[productIndex] = product;
    });

    return { updatedInventory: tempInventory, newCorrections, warnings };
  }, [editableFormula, retailItems, inventory, appointment.id]);
  
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
    
    // Update Client's Package if redeemed
    if (redeemedOffer?.type === 'package') {
        const clientToUpdate = clients.find(c => c.id === appointment.clientId);
        if (clientToUpdate) {
            const updatedPackages = clientToUpdate.activePackages?.map(p => {
                if (p.packageId === redeemedOffer.id) {
                    return { ...p, sessionsRemaining: p.sessionsRemaining - 1 };
                }
                return p;
            }).filter(p => p.sessionsRemaining > 0);

            const updatedClient = { ...clientToUpdate, activePackages: updatedPackages };
            setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
        }
    }


    const receiptData: Omit<ReceiptData, 'business'> = {
        clientName: client.name, date: appointment.endTime,
        items: [
            { name: service.name, quantity: 1, price: redeemedOffer ? 0 : service.price },
            ...selectedAddOns.map(s => ({ name: s.name, quantity: 1, price: s.price })),
            ...retailItems.map(item => {
                const product = inventory.find(p => p.id === item.id);
                const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
                return { name: item.name, quantity: item.quantity, price: price };
            }),
            ...(additionalCharge > 0 && applyAdditionalCharges ? [{ name: 'Additional Charges', quantity: 1, price: additionalCharge }] : [])
        ],
        subtotal: subtotal,
        discount: totalDiscount,
        tax: mockTax,
        tip: tipAmount,
        total: grandTotal,
        payment: {
            method: paymentTab,
            amountTendered: paymentTab === 'cash' ? amountTendered : grandTotal,
            changeDue: changeDue > 0 ? changeDue : 0,
        }
    };
    onConfirmCheckout({
      updatedInventory,
      newCorrections,
      receiptData,
      incident: incidentData,
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns: selectedAddOns,
      absorbedCost,
      tipAmount,
      redeemedOffer: redeemedOffer,
    });
  };

  const handleSendToFrontDesk = () => {
    if (!client || !service || !onSendToFrontDesk) return;

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
  
  const FormContent = (
      <div className="p-6 space-y-6">
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

          {applicableOffers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" />
                  Available Offers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  onValueChange={(value) => {
                    if (value) {
                      const [type, id] = value.split(':');
                      setRedeemedOffer({ type: type as 'membership' | 'package', id });
                    } else {
                      setRedeemedOffer(null);
                    }
                  }}
                >
                  {applicableOffers.map(({ type, offer, sessionsRemaining }) => {
                    const isMembership = type === 'membership';
                    const isRedeemed = isMembership && hasRedeemedThisMonth;
                    return (
                      <div key={`${type}-${offer.id}`} className="flex items-center space-x-3 py-2">
                          <RadioGroupItem
                          value={`${type}:${offer.id}`}
                          id={`${type}:${offer.id}`}
                          disabled={isRedeemed}
                          />
                          <Label
                          htmlFor={`${type}:${offer.id}`}
                          className={cn("flex-1", isRedeemed && "text-muted-foreground")}
                          >
                          <div className="flex justify-between items-center">
                              <div>
                              <span className="font-medium">{isMembership ? 'Redeem from Membership' : 'Use Package Session'}</span>
                              <p className="text-xs text-muted-foreground">{offer.name}
                                  {type === 'package' && ` (${sessionsRemaining} left)`}
                              </p>
                              </div>
                              {isRedeemed && (
                              <Badge variant="secondary">Redeemed this month</Badge>
                              )}
                          </div>
                          </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </CardContent>
            </Card>
          )}
        
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
                    {editableFormula.map((item, index) => {
                        const inventoryItem = inventory.find(i => i.id === item.id);
                        const unit = inventoryItem?.costingMethod === 'uses' 
                          ? (inventoryItem.useUnit || 'uses') 
                          : (inventoryItem?.unit || 'unit');
                          
                        return (
                          <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md gap-2">
                              <div>
                                  <p className="font-medium">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">Cost: ${(item.costPerUnit || 0).toFixed(2)}/{unit}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                  <Input
                                      type="number"
                                      value={item.quantity}
                                      onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                                      className="w-20 h-8 text-center"
                                      step="0.1"
                                  />
                                  <span className="w-8 text-muted-foreground truncate">{unit}</span>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => handleRemoveProduct(item.id)}>
                                      <Trash2 className="h-4 w-4" />
                                  </Button>
                              </div>
                          </div>
                        )
                    })}
                </div>
                <div className='flex gap-2'>
                  <Button variant="outline" size="sm" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button>
                  <Button variant="outline" size="sm" onClick={() => setIsScannerOpen(true)}><QrCode className="mr-2 h-4 w-4"/>Scan Product</Button>
                </div>
            </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retail &amp; Add-ons</CardTitle>
            <CardDescription>Add any products the client is purchasing or extra services.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
                <h4 className="font-medium text-sm">Add-on Services</h4>
                <div className="space-y-2 text-sm">
                    {selectedAddOns.map((item) => (
                        <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                            <p className="font-medium">{item.name}</p>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}>
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
                <CardTitle>Payment &amp; Checkout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                  <div className="space-y-2">
                      <Label>Staff &amp; Service Assignment</Label>
                      <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                          <span className="text-sm font-medium">{service.name}</span>
                          <Select value={serviceStaffOverrides[service.id] || ''} onValueChange={(staffId) => handleStaffOverride(service.id, staffId)}>
                              <SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Select Staff" /></SelectTrigger>
                              <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                          </Select>
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

                <div className="space-y-2">
                    <Label htmlFor="promo-code">Promo Code</Label>
                    <div className="flex gap-2">
                        <Input id="promo-code" value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="e.g., NEWCLIENT15" />
                        <Button variant="outline" onClick={handleApplyPromo}>Apply</Button>
                    </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
                  <div className='flex justify-between'><span>Base Service Price:</span><span>${(redeemedOffer ? 0 : service.price).toFixed(2)}</span></div>
                  {selectedAddOns.map(addon => (
                      <div key={addon.id} className="flex justify-between pl-4"><span>+ {addon.name}</span><span>${addon.price.toFixed(2)}</span></div>
                  ))}
                  <div className='flex justify-between'><span>Retail:</span><span>${retailTotal.toFixed(2)}</span></div>
                  
                  {additionalCharge > 0 && applyAdditionalCharges && (
                        <div className='flex justify-between text-amber-900 dark:text-amber-300 font-semibold'>
                          <span>Additional Time:</span>
                          <span>+${additionalCharge.toFixed(2)}</span>
                      </div>
                  )}
                  {discount > 0 && (
                      <div className='flex justify-between text-primary font-semibold'>
                          <span>Referral Discount:</span>
                          <span>-${discount.toFixed(2)}</span>
                      </div>
                  )}
                  {membershipDiscount > 0 && (
                    <div className='flex justify-between text-primary font-semibold'>
                        <span className="flex items-center gap-1.5"><Award className="w-3 h-3" />Membership Discount:</span>
                        <span>-${membershipDiscount.toFixed(2)}</span>
                    </div>
                  )}
                    <Separator className="my-2" />
                  <div className='flex justify-between font-semibold'><span>Subtotal:</span><span>${(subtotalAfterDiscounts).toFixed(2)}</span></div>
                  <div className='flex justify-between'><span>Taxes (7%):</span><span>${mockTax.toFixed(2)}</span></div>
                </div>
                
                <div className="p-4 rounded-lg bg-primary/10 text-center">
                    <p className="text-sm font-medium text-primary">Total Due</p>
                    <p className="text-5xl font-bold text-primary">${(grandTotal - tipAmount).toFixed(2)}</p>
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

                  {tipAmount > 0 && (
                      <div className="space-y-2 pt-4 border-t">
                          <Label>Tip Allocation</Label>
                          <div className="space-y-3">
                              {involvedStaff.map(staffMember => (
                                  <div key={staffMember.id} className="flex items-center justify-between">
                                      <Label htmlFor={`tip-${staffMember.id}`} className="text-sm">{staffMember.name}</Label>
                                      <div className="relative w-28">
                                          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                          <Input
                                              id={`tip-${staffMember.id}`}
                                              type="number"
                                              value={tipAllocations[staffMember.id] || ''}
                                              onChange={(e) => handleTipAllocation(staffMember.id, e.target.value)}
                                              placeholder="0.00"
                                              className="h-8 text-right pr-2 pl-7"
                                          />
                                      </div>
                                  </div>
                              ))}
                          </div>
                          <div className="flex justify-between text-xs font-medium pt-2">
                              <Button variant="link" size="xs" className="p-0 h-auto" onClick={splitTipEvenly}>Split Evenly</Button>
                              <span>Remaining: <span className={remainingTip < 0 ? 'text-destructive' : ''}>${remainingTip.toFixed(2)}</span></span>
                          </div>
                      </div>
                  )}

                <Tabs value={paymentTab} onValueChange={setPaymentTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="card"><CreditCard className="w-4 h-4 mr-2"/>Card</TabsTrigger>
                        <TabsTrigger value="cash"><Banknote className="w-4 h-4 mr-2"/>Cash</TabsTrigger>
                        <TabsTrigger value="other"><Gift className="w-4 h-4 mr-2"/>Other</TabsTrigger>
                    </TabsList>
                    <TabsContent value="card" className="pt-4 space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="tip-amount">Tip Amount</Label>
                          <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input id="tip-amount" type="number" value={tipAmount || ''} onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)} className="h-10 text-right pr-2 pl-7" placeholder="0.00" />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">Enter tip after charging the client on your terminal.</p>
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
  );

  if (isMobile) {
    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="w-full p-0 flex flex-col sm:max-w-full">
                    <SheetHeader className="p-6 pb-4 border-b">
                        <SheetTitle>Complete Appointment & Checkout</SheetTitle>
                        <SheetDescription>
                        Confirm products used, add retail sales, and finalize the appointment.
                        </SheetDescription>
                    </SheetHeader>
                    <ScrollArea className="flex-1">
                        {FormContent}
                    </ScrollArea>
                    <SheetFooter className="p-4 border-t bg-background flex-col sm:flex-col sm:space-x-0 gap-2">
                        {onSendToFrontDesk && <Button variant="secondary" onClick={handleSendToFrontDesk}>Send to Front Desk</Button>}
                        <Button onClick={handleCompleteAppointment} disabled={warnings.length > 0} size="lg">
                            Finalize & Record Sale
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
            <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={services.filter(s => s.type === 'addon')} initialSelected={selectedAddOns}/>
            <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]}/>
            <BrowseProductsDialog open={isRetailBrowserOpen} onOpenChange={setIsRetailBrowserOpen} onSelect={handleAddRetail} allProducts={inventory.filter(i => i.type === 'retail')} initialSelected={retailItems}/>
        </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b flex-shrink-0">
            <DialogTitle>Complete Appointment & Checkout</DialogTitle>
            <DialogDescription>
              Confirm products used, add retail sales, and finalize the appointment.
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1">
            {FormContent}
          </ScrollArea>
          
          <DialogFooter className="p-6 pt-4 border-t flex-shrink-0">
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
                {onSendToFrontDesk && <Button variant="secondary" onClick={handleSendToFrontDesk}>Send to Front Desk</Button>}
                <div className="flex-1" />
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleCompleteAppointment} disabled={warnings.length > 0}>
                  Finalize & Record Sale
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
                        Please enable camera access to use the scanner.
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

