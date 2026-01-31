

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
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CheckCircle, FileText, FlaskConical, PlusCircle, Trash2, Library, Wand, QrCode, Search, AlertTriangle, ShoppingCart, CreditCard, Banknote, Gift, Coins, ShieldAlert, DollarSign, Users, Award, Repeat, Percent } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection, type CustomFormula, type Staff, AppointmentCheckoutState, Incident, Discount } from '@/lib/data';
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
import { ReceiptData } from './PrintReceipt';
import { LogIncidentForm, incidentSchema, type IncidentFormData } from '../incidents/LogIncidentForm';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { differenceInMinutes, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Badge } from '../ui/badge';
import { nanoid } from 'nanoid';
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking, errorEmitter } from '@/firebase';
import { doc, collection, arrayUnion, increment, writeBatch } from 'firebase/firestore';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { ScrollArea } from '../ui/scroll-area';

// ... (keep all existing types and interfaces)
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
    appliedDiscountId?: string;
    discountAmount?: number;
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
  onRebook: (appointment: Appointment, weeksOut?: number) => void;
  staff: Staff[];
}


export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onConfirmCheckout,
  onSendToFrontDesk,
  onRebook,
  staff,
}) => {
  const { inventory, services, memberships, packages, clients, discounts } = useInventory();
  const { appointment, client, service } = appointmentData;
  const { toast } = useToast();

  const [mobileStep, setMobileStep] = useState<'review' | 'payment'>('review');

  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  
  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  
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
  const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);

  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
  const isMobile = useIsMobile();
  const [view, setView] = useState<'checkout' | 'rebooking_prompt'>('checkout');
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ... (all existing useEffect, useMemo, and handler functions)
    const [formulaName, setFormulaName] = useState('Default Service Formula');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const { firestore, user } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;

    const applicableOffers = useMemo(() => {
    if (!client || !service) return [];
    const offers: { type: 'membership' | 'package'; offer: any; sessionsRemaining?: number }[] = [];
    if (client.activeMembershipId) {
        const membership = memberships.find(m => m.id === client.activeMembershipId);
        if (membership?.includedServices?.some(s => s.id === service.id)) {
            offers.push({ type: 'membership', offer: membership });
        }
    }
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

  const hasRedeemedThisMonth = true;

    useEffect(() => {
    if (open && service && appointment) {
        setView('checkout');
        setMobileStep('review');
        setCheckoutData(null);
        setIsSubmitting(false);
        const checkoutState = appointment.checkoutState;
        const initialFormula = checkoutState?.formula || service.products?.map(p => ({
            id: p.id, name: p.name, quantity: p.quantityUsed, unit: p.unit || 'uses', costPerUnit: p.costPerUnit || 0
        })) || [];
        setEditableFormula(initialFormula);
        setRetailItems(checkoutState?.retailItems || []);
        const initialAddons = (checkoutState?.addOns || (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s));
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
  }, [open, appointment, service, services, client?.referredBy, incidentMethods]);

  const allServicesForAppointment = useMemo(() => [service, ...selectedAddOns].filter((s): s is Service => !!s), [service, selectedAddOns]);
  
    const involvedStaff = useMemo(() => {
      const staffIds = new Set(Object.values(serviceStaffOverrides));
      return staff.filter(s => staffIds.has(s.id));
  }, [serviceStaffOverrides, staff]);

  useEffect(() => {
    if (involvedStaff.length === 1 && tipAmount > 0) {
      setTipAllocations({ [involvedStaff[0].id]: tipAmount });
    } else if (involvedStaff.length !== 1) {
        // If tip exists but staff changes, user needs to re-allocate
    }
  }, [tipAmount, involvedStaff]);

  const { initialBreakEven, finalBreakEven, additionalCharge, absorbedCost } = useMemo(() => {
    if (!service) return { initialBreakEven: 0, finalBreakEven: 0, additionalCharge: 0, absorbedCost: 0 };
    
    const tmhr = (typeof window !== 'undefined' && parseFloat(localStorage.getItem('tmhr') || '50')) || 50;
    
    const calculateCost = (service: Service, formula: EditableFormulaItem[]) => {
      const productCost = formula.reduce((acc, item) => {
        const inventoryItem = inventory.find(i => i.id === item.id);
        if (!inventoryItem) return acc;
        
        let costPerUse = 0;
        if (inventoryItem.costingMethod === 'size' && inventoryItem.size && inventoryItem.size > 0) {
            costPerUse = (inventoryItem.costPerUnit || 0) / inventoryItem.size;
        } else if (inventoryItem.costingMethod === 'uses' && inventoryItem.estimatedUses && inventoryItem.estimatedUses > 0) {
            costPerUse = (inventoryItem.costPerUnit || 0) / inventoryItem.estimatedUses;
        } else {
            costPerUse = inventoryItem.costPerUnit || 0;
        }

        return acc + (costPerUse * item.quantity);
      }, 0);

      return productCost;
    };
    
    const initialProductCost = calculateCost(service, service.products?.map(p => ({
        id: p.id, name: p.name, quantity: p.quantityUsed, unit: p.unit || 'unit', costPerUnit: p.costPerUnit || 0
    })) || []);
    const initialTimeCost = ((service.duration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const initialBreakEvenCost = initialProductCost + initialTimeCost;

    const finalProductCost = calculateCost(service, editableFormula);

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
        const price = product?.msrp || product?.costPerUnit || 0;
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
  const mockTax = subtotalAfterDiscounts * 0.07;
  const grandTotal = subtotalAfterDiscounts + mockTax + tipAmount;
  
  const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - grandTotal : 0;

    const handleApplyPromo = () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;

    const discountToApply = discounts.find(d => d.code.toUpperCase() === code);
    if (!discountToApply) {
        toast({ variant: 'destructive', title: 'Invalid Code', description: 'This promo code could not be found.' });
        return;
    }
    if (!discountToApply.isActive || (discountToApply.usageLimit > 0 && discountToApply.usageCount >= discountToApply.usageLimit)) {
        toast({ variant: 'destructive', title: 'Inactive Code', description: 'This promo code is either inactive or has reached its usage limit.' });
        return;
    }

    if (discountToApply.applicableServiceIds && discountToApply.applicableServiceIds.length > 0) {
        const applicableServicesInCart = allServicesForAppointment.filter(s => discountToApply.applicableServiceIds!.includes(s.id));
        if (applicableServicesInCart.length === 0) {
            toast({ variant: 'destructive', title: 'Not Applicable', description: 'This code is not valid for the services in this appointment.' });
            return;
        }
        
        let discountValue = 0;
        if (discountToApply.type === 'percentage') {
            const applicableTotal = applicableServicesInCart.reduce((sum, s) => sum + s.price, 0);
            discountValue = applicableTotal * (discountToApply.value / 100);
        } else {
            discountValue = discountToApply.value;
        }
        setDiscount(discountValue);
        toast({ title: 'Discount Applied!', description: `You saved $${discountValue.toFixed(2)}.` });

    } else { // Cart-wide discount
        let discountValue = 0;
        if (discountToApply.type === 'percentage') {
            discountValue = subtotal * (discountToApply.value / 100);
        } else {
            discountValue = discountToApply.value;
        }
        setDiscount(discountValue);
        toast({ title: 'Discount Applied!', description: `You saved $${discountValue.toFixed(2)}.` });
    }
  }

  const remainingTip = useMemo(() => {
    const allocated = Object.values(tipAllocations).reduce((sum, val) => sum + val, 0);
    return tipAmount - allocated;
  }, [tipAmount, tipAllocations]);

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

      const totalAllocated = amountPerStaff * involvedStaff.length;
      const remainder = tipAmount - totalAllocated;
      if (remainder !== 0) {
          newAllocations[involvedStaff[0].id] += remainder;
      }

      setTipAllocations(newAllocations);
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
  
  const removeProduct = (productId: string) => {
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
  };

  const { updatedInventory, newCorrections, warnings } = useMemo(() => {
    const warnings: string[] = [];
    const newCorrections: StockCorrection[] = [];
    let tempInventory = JSON.parse(JSON.stringify(inventory)) as InventoryItem[];
    const staffForAppointment = staff.find(s => s.id === appointment.staffId);
    const staffName = staffForAppointment ? staffForAppointment.name : 'Unknown Staff';

    const allItemsToDeduct = [...editableFormula, ...retailItems];

    allItemsToDeduct.forEach(item => {
      const productIndex = tempInventory.findIndex(p => p.id === item.id);
      if (productIndex === -1) {
        warnings.push(`Product ${item.name} not found in inventory.`);
        return;
      }
      
      const product = tempInventory[productIndex];
      let quantityToDeduct = item.quantity;
      
      const sortedBatches = [...(product.batches || [])].sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
      
      let totalAvailableStock = sortedBatches.reduce((acc, b) => acc + b.stock, 0);

      if (product.type === 'retail') { // Retail products are always per-unit
          if (totalAvailableStock < quantityToDeduct) {
              warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${totalAvailableStock}`);
              return;
          }
      } else { // Professional products can have partials
          if (product.costingMethod === 'size' || product.costingMethod === 'uses') {
              const unitsPerContainer = product.costingMethod === 'uses' ? product.estimatedUses || 1 : product.size || 1;
              const partialUnits = product.costingMethod === 'uses' ? product.partialContainerUses || 0 : product.partialContainerSize || 0;
              totalAvailableStock = (totalAvailableStock * unitsPerContainer) + partialUnits;

              if (totalAvailableStock < quantityToDeduct) {
                  warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${totalAvailableStock}`);
                  return;
              }
          } else { // Unit-based professional products
              if (totalAvailableStock < quantityToDeduct) {
                  warnings.push(`Insufficient stock for ${product.name}. Required: ${quantityToDeduct}, Available: ${totalAvailableStock}`);
                  return;
              }
          }
      }
      
      let remainingToDeduct = quantityToDeduct;
      let unit = product.unit || 'units';

      if (product.costingMethod === 'size' || product.costingMethod === 'uses') {
        const partialField = product.costingMethod === 'uses' ? 'partialContainerUses' : 'partialContainerSize';
        const unitsPerContainer = product.costingMethod === 'uses' ? product.estimatedUses || 1 : product.size || 1;
        unit = product.costingMethod === 'uses' ? product.useUnit || 'uses' : product.unit || 'unit';

        let partialUnits = product[partialField] || 0;

        const deductFromPartial = Math.min(partialUnits, remainingToDeduct);
        partialUnits -= deductFromPartial;
        remainingToDeduct -= deductFromPartial;
        
        product[partialField] = partialUnits;

        if (remainingToDeduct > 0) {
           for (const batch of sortedBatches) {
              if (remainingToDeduct <= 0) break;
              if (batch.stock <= 0) continue;

              const unitsInBatch = batch.stock * unitsPerContainer;
              const deductFromBatch = Math.min(unitsInBatch, remainingToDeduct);
              
              const remainingInBatch = unitsInBatch - deductFromBatch;
              
              batch.stock = Math.floor(remainingInBatch / unitsPerContainer);
              product[partialField] = (product[partialField] || 0) + (remainingInBatch % unitsPerContainer);
              
              remainingToDeduct -= deductFromBatch;
           }
        }
      } else { // Unit-based items
          for (const batch of sortedBatches) {
              if (remainingToDeduct <= 0) break;
              const deductFromBatch = Math.min(batch.stock, remainingToDeduct);
              batch.stock -= deductFromBatch;
              remainingToDeduct -= deductFromBatch;
          }
      }

      product.batches = sortedBatches;
      product.totalStock = product.batches.reduce((acc, b) => acc + b.stock, 0);

      newCorrections.push({
          id: `sc-${appointment.id}-${item.id}-${Date.now()}`,
          productId: item.id,
          date: new Date().toISOString(),
          change: -item.quantity,
          unit: unit,
          reason: `Appointment #${appointment.id} by ${staffName}`
      });

      tempInventory[productIndex] = product;
    });

    return { updatedInventory: tempInventory, newCorrections, warnings };
  }, [editableFormula, retailItems, inventory, appointment.id, staff, appointment.staffId]);
  
  
  const handleFinalizeAndShowRebook = async () => {
    let incidentData: IncidentFormData | undefined = undefined;
    if (logIncident) {
      const isValid = await incidentMethods.trigger();
      if (!isValid) {
        toast({
          variant: 'destructive',
          title: 'Incident Form Incomplete',
          description: 'Please fill out all required fields for the incident report.',
        });
        return;
      }
      incidentData = incidentMethods.getValues();
    }

    if (!client || !service) return;

    const receiptData: Omit<ReceiptData, 'business'> = {
      clientName: client.name,
      date: new Date(),
      items: [
        { name: service.name, quantity: 1, price: redeemedOffer ? 0 : service.price },
        ...selectedAddOns.map(s => ({ name: s.name, quantity: 1, price: s.price })),
        ...retailItems.map(item => {
          const product = inventory.find(p => p.id === item.id);
          const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0; // Mocked markup
          return { name: item.name, quantity: item.quantity, price };
        }),
        ...(additionalCharge > 0 && applyAdditionalCharges
          ? [{ name: 'Additional Charges', quantity: 1, price: additionalCharge }]
          : []),
      ],
      subtotal,
      discount: totalDiscount,
      tax: mockTax,
      tip: tipAmount,
      total: grandTotal,
      payment: {
        method: paymentTab,
        amountTendered: paymentTab === 'cash' ? amountTendered : grandTotal,
        changeDue: changeDue > 0 ? changeDue : 0,
      },
    };

    const dataForCheckout: CheckoutData = {
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
      redeemedOffer,
      appliedDiscountCode: discount > 0 ? promoCode : undefined,
      discountAmount: totalDiscount
    };
    
    setCheckoutData(dataForCheckout);
    setView('rebooking_prompt');
  };

  const handleSendToFrontDesk = () => {
    if (!client || !service || !onSendToFrontDesk) return;

    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems: [], // Retail is handled at front desk
        addOns: selectedAddOns,
        actualDuration,
        serviceStaffOverrides,
        tipAllocations: {},
        tipAmount: 0,
    };
    onSendToFrontDesk(appointment.id, checkoutState);
  }

  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const [isRetailBrowserOpen, setIsRetailBrowserOpen] = useState(false);
  
  const denominations = [100, 50, 20, 10, 5, 1, 0.25, 0.10, 0.05, 0.01];

  const handleDenominationClick = (amount: number) => {
    setAmountTendered(prev => prev + amount);
  };
  
  const handleKeepTheChange = () => {
    if (changeDue > 0) {
        setTipAmount(prevTip => prevTip + changeDue);
        setAmountTendered(grandTotal + changeDue); 
        toast({ title: "Tip Added!", description: `$${changeDue.toFixed(2)} has been added as a tip.` });
    }
  };
  
  const actualServiceDuration = useMemo(() => {
    if (appointment.actualStartTime && appointment.actualEndTime) {
      const startTime = typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime;
      const endTime = typeof appointment.actualEndTime === 'string' ? parseISO(appointment.actualEndTime) : appointment.actualEndTime;
      return differenceInMinutes(endTime, startTime);
    }
    return actualDuration;
  }, [appointment, actualDuration]);
  
  const handleConfirmAndClose = () => {
    setIsSubmitting(true);
    if (checkoutData) {
      onConfirmCheckout(checkoutData);
    }
    onOpenChange(false);
  };

  const handleRebookClick = (weeksOut?: number) => {
    setIsSubmitting(true);
    if (checkoutData) {
        onConfirmCheckout(checkoutData);
    }
    onRebook(appointment, weeksOut);
  };
  
    const handleProceedToPayment = async () => {
    let isValid = true;
    if (isValid) {
        setMobileStep('payment');
    }
  }


  if (!client || !service) {
    return null;
  }
  
  const ReviewContent = (<div className="space-y-6">
        <Card>
            <CardContent className="p-4 flex items-center gap-4">
                  <Avatar className="w-12 h-12"><AvatarImage src={client.avatarUrl} alt={client.name} /><AvatarFallback>{client.name.substring(0,2)}</AvatarFallback></Avatar>
                <div>
                    <p className="font-semibold">{client.name}</p>
                    <p className="text-sm text-muted-foreground">{service.name}</p>
                </div>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>Service Actuals</CardTitle>
                <CardDescription>Log what was actually used for this service.</CardDescription>
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
                        const unit = inventoryItem?.costingMethod === 'uses' 
                          ? (inventoryItem.useUnit || 'uses') 
                          : (inventoryItem?.unit || 'unit');
                        
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
                                  <p className="text-xs text-muted-foreground">Cost: ${costPerUse.toFixed(3)}/{unit}</p>
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
                                  <span className="text-xs text-muted-foreground w-10 truncate">{unit}</span>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeProduct(item.id)}>
                                      <Trash2 className="h-4 w-4" />
                                  </Button>
                              </div>
                          </div>
                        )
                    })}
                </div>
                <div className='flex gap-2'><Button variant="outline" size="sm" onClick={() => setIsProductBrowserOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4"/>Browse Library</Button><Button variant="outline" size="sm" type="button"><QrCode className="mr-2 h-4 w-4"/>Scan Product</Button></div>
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
    </div>
  );

  const PaymentContent = (
    <div className="space-y-6">
        {applicableOffers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary" />Available Offers</CardTitle></CardHeader>
              <CardContent>
                <RadioGroup onValueChange={(value) => {
                    if (value) {
                      const [type, id] = value.split(':');
                      setRedeemedOffer({ type: type as 'membership' | 'package', id });
                    } else {
                      setRedeemedOffer(null);
                    }
                  }}>
                  {applicableOffers.map(({ type, offer, sessionsRemaining }) => {
                    const isMembership = type === 'membership';
                    const isRedeemed = isMembership && hasRedeemedThisMonth;
                    return (
                      <div key={`${type}-${offer.id}`} className="flex items-center space-x-3 py-2">
                          <RadioGroupItem value={`${type}:${offer.id}`} id={`${type}:${offer.id}`} disabled={isRedeemed} />
                          <Label htmlFor={`${type}:${offer.id}`} className={cn("flex-1", isRedeemed && "text-muted-foreground")}>
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="font-medium">{isMembership ? 'Redeem from Membership' : 'Use Package Session'}</span>
                                <p className="text-xs text-muted-foreground">{offer.name}
                                    {type === 'package' && ` (${sessionsRemaining} left)`}
                                </p>
                              </div>
                              {isRedeemed && <Badge variant="secondary">Redeemed this month</Badge>}
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
          <CardHeader><CardTitle>Retail Sale</CardTitle></CardHeader>
          <CardContent className="space-y-3">
                <div className="space-y-2 text-sm">
                    {retailItems.map((item) => {
                        const product = inventory.find(p => p.id === item.id);
                        const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0; // Mocked markup
                        return (
                        <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-md">
                            <div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">Price: ${price.toFixed(2)}</p></div>
                            <div className="flex items-center gap-2">
                                <Input type="number" value={item.quantity} onChange={(e) => handleRetailQuantityChange(item.id, parseInt(e.target.value) || 0)} className="w-16 h-8 text-center" min={1}/>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveRetail(item.id)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    )})}
                </div>
                <div className='flex gap-2'><Button variant="outline" size="sm" onClick={() => setIsRetailBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Browse Retail</Button></div>
          </CardContent>
        </Card>
        <Card>
            <CardHeader><CardTitle>Payment & Checkout</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                  <div className="space-y-2">
                      <Label htmlFor="promo-code">Promo Code</Label>
                      <div className="flex gap-2">
                          <Input id="promo-code" value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="e.g., NEWCLIENT15" />
                          <Button variant="outline" type="button" onClick={() => setIsDiscountBrowserOpen(true)}>Browse</Button>
                          <Button variant="secondary" type="button" onClick={handleApplyPromo}>Apply</Button>
                      </div>
                  </div>
                <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
                  <div className='flex justify-between'><span>Base Service Price:</span><span>${(redeemedOffer ? 0 : service.price).toFixed(2)}</span></div>
                  {selectedAddOns.map(addon => (<div key={addon.id} className="flex justify-between pl-4"><span>+ {addon.name}</span><span>${addon.price.toFixed(2)}</span></div>))}
                  <div className='flex justify-between'><span>Retail:</span><span>${retailTotal.toFixed(2)}</span></div>
                  
                  {additionalCharge > 0 && applyAdditionalCharges && (<div className='flex justify-between text-amber-900 dark:text-amber-300 font-semibold'><span>Additional Time:</span><span>+${additionalCharge.toFixed(2)}</span></div>)}
                  {discount > 0 && (<div className='flex justify-between text-primary font-semibold'><span>Referral Discount:</span><span>-${discount.toFixed(2)}</span></div>)}
                  {membershipDiscount > 0 && (<div className='flex justify-between text-primary font-semibold'><span className="flex items-center gap-1.5"><Award className="w-3 h-3" />Membership Discount:</span><span>-${membershipDiscount.toFixed(2)}</span></div>)}
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
                        {involvedStaff.length > 1 ? (
                            <>
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
                            </>
                        ) : involvedStaff.length === 1 ? (
                            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                                <span className="text-sm font-medium">{involvedStaff[0].name}</span>
                                <span className="font-mono font-semibold text-primary">${tipAmount.toFixed(2)}</span>
                            </div>
                        ) : null}
                    </div>
                )}


                <Tabs value={paymentTab} onValueChange={setPaymentTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="card"><CreditCard className="w-4 h-4 mr-2"/>Card</TabsTrigger><TabsTrigger value="cash"><Banknote className="w-4 h-4 mr-2"/>Cash</TabsTrigger><TabsTrigger value="other"><Gift className="w-4 h-4 mr-2"/>Other</TabsTrigger></TabsList>
                    <TabsContent value="card" className="pt-4 space-y-4">
                        <div className="space-y-2"><Label htmlFor="tip-amount">Tip Amount</Label><div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="tip-amount" type="number" value={tipAmount || ''} onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)} className="h-10 text-right pr-2 pl-7" placeholder="0.00" /></div><p className="text-xs text-muted-foreground mt-1">Enter tip after charging the client on your terminal.</p></div>
                    </TabsContent>
                    <TabsContent value="cash" className="pt-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Amount Tendered</Label><div className='p-4 text-2xl font-bold text-center bg-muted rounded-md'>${amountTendered.toFixed(2)}</div></div><div className="space-y-2"><Label>Change Due</Label><div className={`p-4 text-2xl font-bold text-center rounded-md ${changeDue >= 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>${Math.abs(changeDue).toFixed(2)}</div></div></div>
                          {changeDue > 0 && (<Button variant="secondary" className="w-full" onClick={handleKeepTheChange}><Coins className="w-4 h-4 mr-2" /> Keep the Change as Tip</Button>)}
                        <div className="grid grid-cols-5 gap-2">{denominations.map(amount => (<Button key={amount} variant="outline" onClick={() => handleDenominationClick(amount)}>{amount >= 1 ? `$${amount}` : `${amount * 100}¢`}</Button>))}</div>
                          <Button variant="secondary" className="w-full" onClick={() => setAmountTendered(0)}>Clear</Button>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    </div>
  );
  
  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={cn(isMobile ? "h-[95vh] flex flex-col p-0" : "sm:max-w-4xl max-h-[90vh] flex flex-col p-0")}>
           {view === 'checkout' ? (
                isMobile ? (
                    // Mobile Stepped View
                    <>
                        {mobileStep === 'review' ? (
                            <>
                                <SheetHeader className="p-4 border-b text-left">
                                    <SheetTitle>Review Service</SheetTitle>
                                    <SheetDescription>Confirm products used and time spent.</SheetDescription>
                                </SheetHeader>
                                <ScrollArea className="flex-1"><div className="p-4 space-y-6">{ReviewContent}</div></ScrollArea>
                                <SheetFooter className="p-4 border-t bg-background">
                                    <div className="grid grid-cols-2 gap-2 w-full">
                                        {onSendToFrontDesk && <Button variant="secondary" onClick={handleSendToFrontDesk}>Send to Front Desk</Button>}
                                        <Button onClick={handleProceedToPayment} className="w-full">Proceed to Checkout</Button>
                                    </div>
                                </SheetFooter>
                            </>
                        ) : (
                            <>
                                <SheetHeader className="p-4 border-b text-left">
                                    <SheetTitle>Finalize & Checkout</SheetTitle>
                                    <SheetDescription>Complete the payment process.</SheetDescription>
                                </SheetHeader>
                                <ScrollArea className="flex-1"><div className="p-4 space-y-6">{PaymentContent}</div></ScrollArea>
                                <SheetFooter className="p-4 border-t bg-background">
                                    <div className="grid grid-cols-2 gap-2 w-full">
                                        <Button variant="outline" onClick={() => setMobileStep('review')}>Back</Button>
                                        <Button onClick={handleFinalizeAndShowRebook} disabled={warnings.length > 0}>Finalize & Record Sale</Button>
                                    </div>
                                </SheetFooter>
                            </>
                        )}
                    </>
                ) : (
                    // Desktop Two-Column View
                    <>
                        <DialogHeader className="p-6 pb-4 border-b">
                            <DialogTitle>Complete Appointment & Checkout</DialogTitle>
                            <DialogDescription>Confirm products used, add retail sales, and finalize the appointment.</DialogDescription>
                        </DialogHeader>
                        <div className="grid md:grid-cols-2 flex-1 min-h-0">
                            <ScrollArea className="md:border-r"><div className="p-6 space-y-6">{ReviewContent}</div></ScrollArea>
                            <ScrollArea><div className="p-6 space-y-6">{PaymentContent}</div></ScrollArea>
                        </div>
                        <DialogFooter className="p-6 pt-4 border-t">
                            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
                            {onSendToFrontDesk && <Button variant="secondary" onClick={handleSendToFrontDesk}>Send to Front Desk</Button>}
                            <div className="flex-1" />
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button onClick={handleFinalizeAndShowRebook} disabled={warnings.length > 0}>
                                Finalize & Record Sale
                            </Button>
                            </div>
                        </DialogFooter>
                    </>
                )
            ) : (
                <div className="flex flex-col items-center justify-center text-center p-8 space-y-4 flex-1">
                    <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                    <h2 className="text-2xl font-bold">Checkout Complete!</h2>
                    <p className="text-muted-foreground">Book their next appointment?</p>
                    <div className="grid grid-cols-2 gap-2 pt-4 w-full max-w-sm">
                        <Button variant="outline" onClick={() => handleRebookClick(2)} disabled={isSubmitting}>2 Weeks</Button>
                        <Button variant="outline" onClick={() => handleRebookClick(4)} disabled={isSubmitting}>4 Weeks</Button>
                        <Button variant="outline" onClick={() => handleRebookClick(6)} disabled={isSubmitting}>6 Weeks</Button>
                        <Button variant="outline" onClick={() => handleRebookClick(8)} disabled={isSubmitting}>8 Weeks</Button>
                    </div>
                    <div className="flex flex-col sm:flex-row justify-center gap-2 pt-2 w-full max-w-sm">
                        <Button onClick={() => handleRebookClick()} className="w-full" disabled={isSubmitting}>Custom Date</Button>
                        <Button variant="ghost" onClick={handleConfirmAndClose} className="w-full" disabled={isSubmitting}>No, Thanks</Button>
                    </div>
                    {isSubmitting && <p className="text-sm text-muted-foreground animate-pulse">Processing...</p>}
                </div>
            )}
        </ContentComponent>
      </DialogComponent>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={services.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
      <BrowseProductsDialog open={isRetailBrowserOpen} onOpenChange={setIsRetailBrowserOpen} onSelect={handleAddRetail} allProducts={inventory.filter(i => i.type === 'retail')} initialSelected={retailItems} />
      <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts} onSelect={(code) => { setPromoCode(code); handleApplyPromo(); }} cartServiceIds={allServicesForAppointment.map(s => s.id)} />
    </>
  );
};
