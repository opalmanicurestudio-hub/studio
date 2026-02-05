

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
import { AlertTriangle, CheckCircle, FlaskConical, PlusCircle, Trash2, QrCode, ShoppingCart, CreditCard, Banknote, Gift, Coins, DollarSign, Users, Award, Repeat, Percent, Check, Loader } from 'lucide-react';
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
import { useTenant } from '@/context/TenantContext';
import { type Transaction } from '@/lib/financial-data';


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
  appointmentsData: {
    appointment: Appointment;
    client?: Client; // Client might not exist for a pure walk-in yet
    service?: Service;
  }[];
  initialRetailItems?: { id: string; name: string; price: number; quantity: number; imageUrl?: string; stock?: number; type: 'product' }[];
  onCheckoutComplete: (data: Omit<ReceiptData, 'business'>) => void;
  onRebook: (appointment: Appointment, weeksOut?: number) => void;
}


export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentsData,
  initialRetailItems,
  onCheckoutComplete,
  onRebook,
}) => {
  const { inventory, services, staff, memberships, packages, clients, discounts } = useInventory();
  const { toast } = useToast();
  const { firestore, selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [view, setView] = useState<'checkout' | 'rebooking_prompt'>('checkout');
  const [mobileStep, setMobileStep] = useState<'review' | 'payment'>('review');

  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  
  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  const [actualDuration, setActualDuration] = useState(0);
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
      photoUrls: [],
    },
  });

  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [membershipDiscount, setMembershipDiscount] = useState(0);
  const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
  const [appliedDiscountCode, setAppliedDiscountCode] = useState<string | undefined>(undefined);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
  const isMobile = useIsMobile();
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);


    const [formulaName, setFormulaName] = useState('Default Service Formula');
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [isRetailBrowserOpen, setIsRetailBrowserOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const primaryAppointmentData = appointmentsData[0];
    const primaryClient = primaryAppointmentData?.client;
    const primaryService = primaryAppointmentData?.service;
    
    const isGroupCheckout = appointmentsData.length > 1;

    const allServicesInCart = useMemo(() => {
        return appointmentsData.flatMap(data => {
            const main = data.service ? [data.service] : [];
            const addons = (data.appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
            return [...main, ...addons];
        });
      }, [appointmentsData, services]);

    const handleAddProduct = (products: InventoryItem[]) => {
        const newItems = products.map(p => ({
            id: p.id,
            name: p.name,
            quantity: 1,
            unit: p.unit || 'uses',
            costPerUnit: p.costPerUnit || 0,
            isCustom: true
        }));
        setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
        setIsProductBrowserOpen(false);
    };

    const handleAddRetail = (products: InventoryItem[]) => {
        const newItems = products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.msrp || 0,
            quantity: 1,
            unit: p.unit || 'unit',
            imageUrl: p.imageUrl,
            stock: p.totalStock,
            type: 'product' as const,
        }));
         setRetailItems(prev => {
            const newCart = [...prev];
            newItems.forEach(newItem => {
                const existingItem = newCart.find(item => item.id === newItem.id);
                if (existingItem) {
                    existingItem.quantity += 1;
                } else {
                    newCart.push(newItem);
                }
            });
            return newCart;
        });
        setIsRetailBrowserOpen(false);
    };

  const handleApplyPromo = (codeToApply?: string) => {
    const code = (codeToApply || promoCode).trim().toUpperCase();
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
    
    let discountValue = 0;
    if (discountToApply.type === 'percentage') {
        discountValue = subtotal * (discountToApply.value / 100);
    } else {
        discountValue = discountToApply.value;
    }
    setDiscount(discountValue);
    setAppliedDiscountCode(discountToApply.id);
    toast({ title: 'Discount Applied!', description: `You saved $${discountValue.toFixed(2)}.` });
  }

    useEffect(() => {
    if (open) {
        setView('checkout');
        setMobileStep('review');
        setCheckoutData(null);
        setIsSubmitting(false);

        const firstAppointment = appointmentsData[0]?.appointment;
        const firstService = appointmentsData[0]?.service;
        
        const distinctClientIds = [...new Set(appointmentsData.map(a => a.client?.id).filter(Boolean))];
        if (distinctClientIds.length === 1) {
            setSelectedClientId(distinctClientIds[0]!);
        } else {
            setSelectedClientId(null);
        }

        const checkoutState = firstAppointment?.checkoutState;
        const initialFormula = checkoutState?.formula || firstService?.products?.map(p => ({
            id: p.id, name: p.name, quantity: p.quantityUsed, unit: p.unit || 'uses', costPerUnit: p.costPerUnit || 0
        })) || [];
        setEditableFormula(initialFormula);
        setRetailItems(initialRetailItems || checkoutState?.retailItems || []);
        
        const initialAddons = (checkoutState?.addOns || (firstAppointment?.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s));
        setSelectedAddOns(initialAddons);
        
        setFormulaName('Default Service Formula');
        setAmountTendered(0);
        setTipAmount(checkoutState?.tipAmount || 0);
        setPaymentTab('card');
        setRedeemedOffer(null);
        setActualDuration(checkoutState?.actualDuration || firstService?.duration || 0);
        setApplyAdditionalCharges(true);
        setLogIncident(false);
        incidentMethods.reset();
        setPromoCode(primaryClient?.referredBy ? 'NEWCLIENT15' : '');
        setDiscount(0);
        setMembershipDiscount(0);

        const initialOverrides: Record<string, string> = {};
        if (firstService) {
            initialOverrides[firstService.id] = firstAppointment?.staffId || '';
        }
        initialAddons.forEach(addon => {
            initialOverrides[addon.id] = firstAppointment?.staffId || '';
        });
        setServiceStaffOverrides(checkoutState?.serviceStaffOverrides || initialOverrides);
        setTipAllocations(checkoutState?.tipAllocations || {});
    }
  }, [open, appointmentsData, initialRetailItems, services, primaryClient?.referredBy, incidentMethods]);

  
  const involvedStaff = useMemo(() => {
      const staffIds = new Set<string>();
      appointmentsData.forEach(data => {
          if (data.appointment.staffId) {
              staffIds.add(data.appointment.staffId);
          }
      });
      return staff.filter(s => staffIds.has(s.id));
  }, [appointmentsData, staff]);

  useEffect(() => {
    if (involvedStaff.length === 1 && tipAmount > 0) {
      setTipAllocations({ [involvedStaff[0].id]: tipAmount });
    } else if (involvedStaff.length !== 1) {
        // Handled in UI
    }
  }, [tipAmount, involvedStaff]);

  const subtotal = useMemo(() => {
    const servicesTotal = appointmentsData.reduce((total, data) => {
        const servicePrice = redeemedOffer?.id === data.service?.id ? 0 : data.service?.price || 0;
        const addOnsPrice = (data.appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id)?.price || 0)
            .reduce((a, b) => a + b, 0);
        return total + servicePrice + addOnsPrice;
    }, 0);

    const retailTotal = retailItems.reduce((acc, item) => {
        const product = inventory.find(p => p.id === item.id);
        const price = product?.msrp || 0;
        return acc + (item.quantity * price);
    }, 0);
    
    return servicesTotal + retailTotal;
  }, [appointmentsData, services, retailItems, redeemedOffer, inventory]);
  
    const client = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  const retailTotalForDiscount = useMemo(() => {
    return retailItems.reduce((acc, item) => {
        const product = inventory.find(p => p.id === item.id);
        return acc + (item.quantity * (product?.msrp || 0));
    }, 0);
  }, [retailItems, inventory]);

  useEffect(() => {
        if (client && client.activeMembershipId) {
            const membership = memberships.find(m => m.id === client.activeMembershipId);
            if (membership?.retailDiscount && retailTotalForDiscount > 0) {
                const discountValue = retailTotalForDiscount * (membership.retailDiscount / 100);
                setMembershipDiscount(discountValue);
            } else {
                setMembershipDiscount(0);
            }
        } else {
            setMembershipDiscount(0);
        }
    }, [client, retailTotalForDiscount, memberships]);

  const totalDiscount = discount + membershipDiscount;
  const subtotalAfterDiscounts = subtotal > totalDiscount ? subtotal - totalDiscount : 0;
  const mockTax = subtotalAfterDiscounts * 0.07;
  const grandTotal = subtotalAfterDiscounts + mockTax + tipAmount;
  
  const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - grandTotal : 0;

  const handleFinalizeAndCheckout = async () => {
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

    if (!client || !primaryService) return;

    const allCartItems = [
        ...appointmentsData.flatMap(d => {
            const mainService = d.service ? [{ name: d.service.name, quantity: 1, price: redeemedOffer?.id === d.service.id ? 0 : d.service.price }] : [];
            const addOns = (d.appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean).map(s => ({ name: s!.name, quantity: 1, price: s!.price }));
            return [...mainService, ...addOns];
        }),
        ...retailItems.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    ];


    const receiptData: Omit<ReceiptData, 'business'> = {
      clientName: client.name,
      date: new Date(),
      items: allCartItems,
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
    
    // This logic is simplified; real logic is now in `handleConfirmAndClose`
    const dataForCheckout: CheckoutData = {
      updatedInventory: [], // This would be calculated based on formula changes
      newCorrections: [], // This would be generated
      receiptData,
      incident: incidentData,
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns: selectedAddOns,
      absorbedCost: 0,
      tipAmount,
      redeemedOffer,
      appliedDiscountId,
      discountAmount: totalDiscount
    };
    
    setCheckoutData(dataForCheckout);
    setView('rebooking_prompt');
  };

  const handleConfirmAndClose = async () => {
    setIsSubmitting(true);
    
    if (!client) {
        toast({variant: 'destructive', title: 'No Payer Selected'});
        setIsSubmitting(false);
        return;
    }
    
    if (!firestore || !tenantId) {
        toast({variant: 'destructive', title: 'Database Error'});
        setIsSubmitting(false);
        return;
    }

    const batch = writeBatch(firestore);

    // Loop through each appointment in the checkout
    for (const data of appointmentsData) {
        const { appointment: currentAppointment, client: currentClient, service: currentService } = data;

        if (!currentAppointment || !currentService) continue;
        
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', currentAppointment.id);

        const allServicesInAppointment = [currentService, ...selectedAddOns.filter(a => currentAppointment.addOnIds?.includes(a.id))];
        
        const appointmentRevenue = allServicesInAppointment.reduce((acc, s) => acc + s.price, 0);

        if (redeemedOffer?.id === currentService.id) {
            // Logic to handle redeemed offer, e.g. mark as used
        }
        
        batch.update(appointmentRef, { 
            status: 'completed',
            revenue: appointmentRevenue,
            discountAmount: discount / appointmentsData.length, // Distribute discount
            appliedDiscountCode: appliedDiscountCode || ''
        });

        if (currentAppointment.checkInToken) {
            const checkInRef = doc(firestore, 'appointmentCheckIns', currentAppointment.checkInToken);
            batch.update(checkInRef, { status: 'completed' });
        }
        
        // Update staff status
        if (currentAppointment.staffId) {
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', currentAppointment.staffId);
            batch.update(staffDocRef, {
              status: 'idle',
              lastServedTimestamp: new Date().toISOString(),
            });
        }
        
        // Update client LTV
        if (currentClient) {
            const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, currentClient.id);
            batch.update(clientDocRef, {
                lifetimeValue: increment(appointmentRevenue),
                lastAppointment: new Date().toISOString()
            });
        }
    }
    
    // Create transactions for shared items
    Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
        if (tipAmount > 0) {
            const newTransaction: Omit<Transaction, 'id'|'date'> = {
                description: `Tip for ${isGroupCheckout ? 'Group ' : ''}Checkout`,
                clientOrVendor: client.name,
                clientId: client.id,
                type: 'income',
                context: 'Business',
                category: 'Tips',
                amount: tipAmount,
                paymentMethod: paymentTab,
                hasReceipt: true,
                staffId: staffId,
                tipAmount: tipAmount,
                appointmentId: appointmentsData[0].appointment.id,
            };
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {...newTransaction, date: new Date().toISOString()});
        }
    });

    retailItems.forEach(item => {
        const product = inventory.find(p => p.id === item.id);
        if (!product) return;
        const price = product.msrp || product.costPerUnit || 0;
        const retailTotal = item.quantity * price;

        if (retailTotal > 0) {
            const newTransaction: Omit<Transaction, 'id'|'date'> = {
                description: `Retail: ${item.quantity}x ${item.name}`,
                clientOrVendor: client.name,
                clientId: client.id,
                type: 'income',
                context: 'Business',
                category: 'Retail',
                amount: retailTotal,
                paymentMethod: paymentTab,
                hasReceipt: true,
                staffId: appointmentsData[0].appointment.staffId,
                appointmentId: appointmentsData[0].appointment.id,
            };
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {...newTransaction, date: new Date().toISOString()});
        }
        
        const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.id);
        batch.update(productRef, { totalStock: increment(-item.quantity) });
    });
    
    if (appliedDiscountCode) {
        const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', appliedDiscountCode);
        batch.update(discountRef, {
            usageCount: increment(1),
            usedByClientIds: arrayUnion(client.id),
        });
    }

    try {
        await batch.commit();
        if (checkoutData?.receiptData) {
            onCheckoutComplete(checkoutData.receiptData);
        }
        onOpenChange(false);
    } catch (e) {
        console.error("Checkout failed:", e);
        toast({ variant: 'destructive', title: 'Checkout Failed', description: 'Could not save all checkout data.'});
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleRebookClick = (weeksOut?: number) => {
    handleConfirmAndClose();
    onRebook(primaryAppointmentData.appointment, weeksOut);
  };

  if (!client || !primaryService) {
    return null;
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
           {view === 'checkout' ? (
                <>
                    <DialogHeader className="p-6 pb-4 border-b">
                        <DialogTitle>Complete Appointment & Checkout</DialogTitle>
                        <DialogDescription>Confirm service details, add retail, and finalize the appointment.</DialogDescription>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 flex-1 min-h-0">
                        <ScrollArea className="md:border-r">
                           <div className="p-6 space-y-6">
                            {/* REVIEW CONTENT HERE */}
                           </div>
                        </ScrollArea>
                        <ScrollArea>
                           <div className="p-6 space-y-6">
                            {/* PAYMENT CONTENT HERE */}
                           </div>
                        </ScrollArea>
                    </div>
                    <DialogFooter className="p-6 pt-4 border-t">
                        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
                        <div className="flex-1" />
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={handleFinalizeAndCheckout}>
                            Finalize & Record Sale
                        </Button>
                        </div>
                    </DialogFooter>
                </>
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
        </DialogContent>
      </Dialog>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={setSelectedAddOns} allAddOns={services.filter(s => s.type === 'addon')} initialSelected={selectedAddOns} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
      <BrowseProductsDialog open={isRetailBrowserOpen} onOpenChange={setIsRetailBrowserOpen} onSelect={handleAddRetail} allProducts={inventory.filter(i => i.type === 'retail')} initialSelected={retailItems} />
      <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts} onSelect={(code) => { setPromoCode(code); handleApplyPromo(code); }} cartServiceIds={allServicesInCart.map(s => s.id)} />
    </>
  );
};
