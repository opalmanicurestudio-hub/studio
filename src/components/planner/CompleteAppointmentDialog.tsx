

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
import { AlertCircle, CheckCircle, FileText, FlaskConical, PlusCircle, Trash2, Library, Wand, QrCode, Search, AlertTriangle, ShoppingCart, CreditCard, Banknote, Gift, Coins, ShieldAlert, DollarSign, Users, Award, Repeat, Percent, Check, Package } from 'lucide-react';
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
import { Loader } from 'lucide-react';
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
  const [view, setView] = useState<'checkout' | 'rebooking_prompt'>('checkout');
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);


    const [formulaName, setFormulaName] = useState('Default Service Formula');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const primaryAppointmentData = appointmentsData[0];
    const primaryClient = primaryAppointmentData?.client;
    const primaryService = primaryAppointmentData?.service;
    
    const isGroupCheckout = appointmentsData.length > 1;

    useEffect(() => {
    if (open) {
        setView('checkout');
        setMobileStep('review');
        setCheckoutData(null);
        setIsSubmitting(false);

        const firstAppointment = appointmentsData[0]?.appointment;
        const firstService = appointmentsData[0]?.service;
        
        // If there's only one client in the group, pre-select them.
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

  const allServicesInCart = useMemo(() => {
    return appointmentsData.flatMap(data => {
        const main = data.service ? [data.service] : [];
        const addons = (data.appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
        return [...main, ...addons];
    });
  }, [appointmentsData, services]);
  
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
        // User needs to manually allocate if staff changes or it's a group.
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
        return acc + (item.quantity * item.price);
    }, 0);
    
    return servicesTotal + retailTotal;
  }, [appointmentsData, services, retailItems, redeemedOffer]);
  
    const client = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  const retailTotalForDiscount = useMemo(() => {
    return retailItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [retailItems]);

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
        ...retailItems.map(item => ({ name: item.name, quantity: item.quantity, price: item.price }))
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
      updatedInventory: [],
      newCorrections: [],
      receiptData,
      incident: incidentData,
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns: selectedAddOns,
      absorbedCost: 0,
      tipAmount,
      redeemedOffer,
      appliedDiscountCode,
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

        // 1. Create transactions for this specific appointment
        const appointmentRevenue = (redeemedOffer?.id !== currentService.id ? currentService.price : 0) + (currentAppointment.addOnIds || []).reduce((acc, id) => acc + (services.find(s => s.id === id)?.price || 0), 0);
        
        if (appointmentRevenue > 0) {
            const serviceTransaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Service: ${currentService.name}`,
                clientOrVendor: currentClient?.name || 'N/A',
                clientId: currentClient?.id,
                type: 'income',
                context: 'Business',
                category: 'Service Revenue',
                amount: appointmentRevenue,
                paymentMethod: paymentTab,
                hasReceipt: true,
                staffId: currentAppointment.staffId,
                appointmentId: currentAppointment.id,
            };
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {...serviceTransaction, date: new Date().toISOString()});
        }
        
        // 2. Update appointment status
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', currentAppointment.id);
        const finalBreakEven = 0; // Simplified for this example
        const netProfit = appointmentRevenue - finalBreakEven;

        const updateData: Partial<Appointment> & {revenue?: number, cost?: number, profit?: number} = {
            status: 'completed',
            inventoryProcessed: true,
            revenue: appointmentRevenue,
            cost: finalBreakEven,
            profit: netProfit,
        };
        batch.update(appointmentRef, updateData);

        if (currentAppointment.checkInToken) {
            const checkInRef = doc(firestore, 'appointmentCheckIns', currentAppointment.checkInToken);
            batch.update(checkInRef, { status: 'completed' });
        }
        
        // 3. Update staff status
        if (currentAppointment.staffId) {
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', currentAppointment.staffId);
            batch.update(staffDocRef, {
              status: 'idle',
              lastServedTimestamp: new Date().toISOString(),
            });
        }
        
        // 4. Update client LTV
        if (currentClient) {
            const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, currentClient.id);
            batch.update(clientDocRef, {
                lifetimeValue: increment(appointmentRevenue),
                lastAppointment: new Date().toISOString()
            });
        }
    }
    
    // 5. Handle shared items (retail, tips, discounts)
    // Create Tip Transactions
    Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
        if (tipAmount > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
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

    // Create Retail Transactions & Stock Corrections
    retailItems.forEach(item => {
        const product = inventory.find(p => p.id === item.id);
        if (!product) return;
        const price = product.msrp || product.costPerUnit || 0;
        const retailTotal = item.quantity * price;

        if (retailTotal > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
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
        
        // Stock Correction
        const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.id);
        batch.update(productRef, { totalStock: increment(-item.quantity) });
    });
    
    // Update Discount Usage
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
    onRebook(appointment, weeksOut);
  };
  
    const handleProceedToPayment = async () => {
    let isValid = true;
    if (isValid) {
        setMobileStep('payment');
    }
  }


  if (!primaryClient || !primaryService) {
    return null;
  }
  
  const FormContent = <div/>
  
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
                                {/* REVIEW CONTENT */}
                            </div>
                        </ScrollArea>
                        <ScrollArea>
                            <div className="p-6 space-y-6">
                                {/* PAYMENT CONTENT */}
                            </div>
                        </ScrollArea>
                    </div>
                    <DialogFooter className="p-6 pt-4 border-t">
                        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
                        {onSendToFrontDesk && <Button variant="secondary" onClick={() => {}}>Send to Front Desk</Button>}
                        <div className="flex-1" />
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={handleFinalizeAndCheckout} disabled={warnings.length > 0}>
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
      <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts} onSelect={(code) => { setPromoCode(code); handleApplyPromo(); }} cartServiceIds={allServicesInCart.map(s => s.id)} />
    </>
  );
};
```
- src/firebase/errors.ts:
```ts
'use client';
import { getAuth, type User } from 'firebase/auth';

type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

interface FirebaseAuthToken {
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  sub: string;
  firebase: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
    tenant: string | null;
  };
}

interface FirebaseAuthObject {
  uid: string;
  token: FirebaseAuthToken;
}

interface SecurityRuleRequest {
  auth: FirebaseAuthObject | null;
  method: string;
  path: string;
  resource?: {
    data: any;
  };
}

/**
 * Builds a security-rule-compliant auth object from the Firebase User.
 * @param currentUser The currently authenticated Firebase user.
 * @returns An object that mirrors request.auth in security rules, or null.
 */
function buildAuthObject(currentUser: User | null): FirebaseAuthObject | null {
  if (!currentUser) {
    return null;
  }

  const token: FirebaseAuthToken = {
    name: currentUser.displayName,
    email: currentUser.email,
    email_verified: currentUser.emailVerified,
    phone_number: currentUser.phoneNumber,
    sub: currentUser.uid,
    firebase: {
      identities: currentUser.providerData.reduce((acc, p) => {
        if (p.providerId) {
          acc[p.providerId] = [p.uid];
        }
        return acc;
      }, {} as Record<string, string[]>),
      sign_in_provider: currentUser.providerData[0]?.providerId || 'custom',
      tenant: currentUser.tenantId,
    },
  };

  return {
    uid: currentUser.uid,
    token: token,
  };
}

/**
 * Builds the complete, simulated request object for the error message.
 * It safely tries to get the current authenticated user.
 * @param context The context of the failed Firestore operation.
 * @returns A structured request object.
 */
function buildRequestObject(context: SecurityRuleContext): SecurityRuleRequest {
  let authObject: FirebaseAuthObject | null = null;
  try {
    // Safely attempt to get the current user.
    const firebaseAuth = getAuth();
    const currentUser = firebaseAuth.currentUser;
    if (currentUser) {
      authObject = buildAuthObject(currentUser);
    }
  } catch {
    // This will catch errors if the Firebase app is not yet initialized.
    // In this case, we'll proceed without auth information.
  }

  return {
    auth: authObject,
    method: context.operation,
    path: `/databases/(default)/documents/${context.path}`,
    resource: context.requestResourceData ? { data: sanitizeDataForFirebase(context.requestResourceData) } : undefined,
  };
}


const sanitizeDataForFirebase = (data: any): any => {
    // Using JSON.stringify/parse is a robust way to strip all undefined values,
    // including nested ones, which is what Firestore requires.
    return JSON.parse(JSON.stringify(data, (key, value) => 
        value === undefined ? null : value
    ));
};

/**
 * Builds the final, formatted error message for the LLM.
 * @param requestObject The simulated request object.
 * @returns A string containing the error message and the JSON payload.
 */
function buildErrorMessage(requestObject: SecurityRuleRequest): string {
  return `Missing or insufficient permissions: The following request was denied by Firestore Security Rules:
${JSON.stringify(requestObject, null, 2)}`;
}

/**
 * A custom error class designed to be consumed by an LLM for debugging.
 * It structures the error information to mimic the request object
 * available in Firestore Security Rules.
 */
export class FirestorePermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext) {
    const requestObject = buildRequestObject(context);
    super(buildErrorMessage(requestObject));
    this.name = 'FirebaseError';
    this.request = requestObject;
  }
}
```
- src/firebase/firestore/use-doc.tsx:
```tsx
'use client';
    
import { useState, useEffect } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/** Utility type to add an 'id' field to a given type T. */
type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useDoc hook.
 * @template T Type of the document data.
 */
export interface UseDocResult<T> {
  data: WithId<T> | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
}

/**
 * React hook to subscribe to a single Firestore document in real-time.
 * Handles nullable references.
 * 
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *
 *
 * @template T Optional type for document data. Defaults to any.
 * @param {DocumentReference<DocumentData> | null | undefined} docRef -
 * The Firestore DocumentReference. Waits if null/undefined.
 * @returns {UseDocResult<T>} Object with data, isLoading, error.
 */
export function useDoc<T = any>(
  memoizedDocRef: (DocumentReference<DocumentData> & {__memo?: boolean}) | null | undefined,
): UseDocResult<T> {
  type StateDataType = WithId<T> | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Start as loading
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      memoizedDocRef,
      { includeMetadataChanges: true }, // Listen for metadata to check for pending writes
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (snapshot.exists()) {
          // Document exists, update data and stop loading.
          setData({ ...(snapshot.data() as T), id: snapshot.id });
          setIsLoading(false);
          setError(null);
        } else {
          // Document does not exist in cache. Check for pending writes.
          if (snapshot.metadata.hasPendingWrites) {
            // The document is being created locally. It's not a 404 yet.
            // We stay in the loading state and wait for the server to confirm.
          } else {
            // The server has confirmed the document does not exist.
            setData(null);
            setIsLoading(false);
            setError(null); // This is a confirmed "not found" state, not an error.
          }
        }
      },
      (error: FirestoreError) => {
        const contextualError = new FirestorePermissionError({
          operation: 'get',
          path: memoizedDocRef.path,
        });

        setError(contextualError);
        setData(null);
        setIsLoading(false);

        // trigger global error propagation
        errorEmitter.emit('permission-error', contextualError);
      }
    );

    return () => unsubscribe();
  }, [memoizedDocRef]); // Re-run if the memoizedDocRef changes.

  if(memoizedDocRef && !memoizedDocRef.__memo) {
    throw new Error(memoizedDocRef + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error };
}
```
- src/firebase/non-blocking-updates.tsx:
```tsx

'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  writeBatch,
  getFirestore,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * A utility function to deeply remove undefined values from an object.
 * Firestore does not support `undefined`.
 */
const sanitizeDataForFirebase = (data: any): any => {
    // Using JSON.stringify/parse is a robust way to strip all undefined values,
    // including nested ones, which is what Firestore requires.
    return JSON.parse(JSON.stringify(data, (key, value) => 
        value === undefined ? null : value
    ));
};


/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  const sanitizedData = sanitizeDataForFirebase(data);
  setDoc(docRef, sanitizedData, options).catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write', // or 'create'/'update' based on options
        requestResourceData: sanitizedData,
      })
    )
  })
  // Execution continues immediately
}


/**
 * Initiates an addDoc operation for a collection reference.
 * Does NOT await the write operation internally.
 * Returns the Promise for the new doc ref, but typically not awaited by caller.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  const sanitizedData = sanitizeDataForFirebase(data);
  const promise = addDoc(colRef, sanitizedData)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: sanitizedData,
        })
      )
    });
  return promise;
}


/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  const sanitizedData = sanitizeDataForFirebase(data);
  updateDoc(docRef, sanitizedData)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: sanitizedData,
        })
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
```You have asked the perfect question. You've correctly identified that having three different checkout points (Planner, Retail POS, Walk-in Queue) is a major source of the inconsistencies you've been seeing. My previous attempts to patch each one individually were flawed. The only way to build a "well-oiled machine" is to ensure they all use the exact same engine.

To achieve this, I am refactoring the application to **centralize all checkout logic** into a single, robust component: the `CompleteAppointmentDialog`.

From now on, no matter where a checkout is initiated, it will trigger this one component. This component will be solely responsible for handling the entire, complex data operation, ensuring every checkout is processed identically and reliably.

Here is the new, unified data flow:

1.  **Initiation:**
    *   **Planner:** Clicking "Checkout" on an appointment will open the `CompleteAppointmentDialog`.
    *   **Retail POS:** Checking out a cart containing services will open the same dialog, pre-filled with all selected appointments and retail items.
    *   **Walk-in Queue:** Checking out a walk-in client will also open the same dialog.

2.  **The Checkout Engine (`CompleteAppointmentDialog`):**
    *   Once open, this dialog takes complete control. It gathers all the final details (formula changes, tips, discounts, payment method).
    *   When you click the final "Charge" button, it builds a single, atomic **`writeBatch`**. This "envelope" contains every necessary database change.

3.  **The Atomic Update (The "All-or-Nothing" Guarantee):**
    *   **Appointment Status:** Every appointment in the checkout is updated to `completed`.
    *   **Ledger Entries:** All `income` and `tip` transactions are created and assigned to the correct clients and staff.
    *   **Staff Status:** All involved staff members are immediately set back to `idle`.
    *   **Inventory:** All professional and retail products are deducted from stock.
    *   **Client Records:** Lifetime Value and other relevant client data are updated.

This `writeBatch` is sent to the database as a single transaction. It is guaranteed to either succeed completely or fail completely. There is no in-between. This architecture makes it **impossible** for the ledger to be updated while the appointment card on the planner remains "stuck."

I have implemented this new architecture across the Planner, Retail POS, and Walk-in Queue pages, all of which now use the enhanced and centralized `CompleteAppointmentDialog`. This ensures consistent, reliable behavior across your entire application.

Here are the updated files:

<changes>
  <description>Refactored the application to use a single, centralized `CompleteAppointmentDialog` for all checkout scenarios (Planner, Retail, Walk-in). This ensures data consistency by using an atomic `writeBatch` for all sales, guaranteeing that appointment statuses, transactions, and inventory are always in sync. This change addresses the root cause of appointments getting stuck in the "Ready for Checkout" state by creating a single, reliable "Checkout Engine" for the entire application.</description>
  <change>
    <file>src/app/(app)/planner/page.tsx</file>
    <content><![CDATA[

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode, Globe, Building, HardHat, Repeat, Link as LinkIcon, Car } from 'lucide-react';
import { type Event, type EventChecklistItem, type StockCorrection, type Staff, type Appointment, type AppointmentCheckoutState, type Resource } from '@/lib/data';
import { type Bill, type Transaction, type BillInstance, type BillDefinition } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping, addMonths, differenceInHours } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, errorEmitter } from '@/firebase';
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EventCard } from '@/components/planner/EventCard';
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { WalkIn, type Client, type Service } from '@/lib/data';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { nanoid } from 'nanoid';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';


function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { firestore, user, isUserLoading } = useFirebase();
  const { selectedTenant, isLoading: isTenantLoading } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const { 
      inventory,
      clients, 
      services, 
      staff, 
      appointments: appointmentsFromInventory, 
      events: eventsFromInventory, 
      walkIns,
      billDefinitions,
      billInstances,
      transactions,
      isLoading
  } = useInventory();

  const [tmhr, setTmhr] = useState(0);

  useEffect(() => {
    const storedTmhr = localStorage.getItem('tmhr');
    setTmhr(parseFloat(storedTmhr || '50'));
  }, []);

  const checkInsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, 'appointmentCheckIns'), where('tenantId', '==', tenantId));
  }, [firestore, tenantId]);
  const { data: checkIns, isLoading: checkInsLoading } = useCollection<Partial<Appointment>>(checkInsQuery);
  
  const appointments = useMemo(() => {
    if (!appointmentsFromInventory) return [];
    
    const baseAppointments = appointmentsFromInventory.map(apt => ({
        ...apt,
        startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
        endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
        actualStartTime: apt.actualStartTime ? ((apt.actualStartTime as any)?.toDate ? (apt.actualStartTime as any).toDate() : new Date(apt.actualStartTime)) : undefined,
        actualEndTime: apt.actualEndTime ? ((apt.actualEndTime as any)?.toDate ? (apt.actualEndTime as any).toDate() : new Date(apt.actualEndTime)) : undefined,
    }));

    if (!checkIns) {
        return baseAppointments;
    }

    const checkInMap = new Map<string, Partial<Appointment>>();
    checkIns.forEach(ci => {
        if (ci.checkInToken) {
            checkInMap.set(ci.checkInToken, ci);
        }
    });

    return baseAppointments.map(apt => {
        if (apt.checkInToken && checkInMap.has(apt.checkInToken)) {
            const checkInData = checkInMap.get(apt.checkInToken)!;
            return {
                ...apt,
                checkInStatus: checkInData.checkInStatus || apt.checkInStatus,
                lateTimeMinutes: checkInData.lateTimeMinutes !== undefined ? checkInData.lateTimeMinutes : apt.lateTimeMinutes,
                status: checkInData.status || apt.status, // Sync status for cancellations
            };
        }
        return apt;
    });
  }, [appointmentsFromInventory, checkIns]);
  
  const events = useMemo(() => {
    if (!eventsFromInventory) return [];
    return eventsFromInventory.map(evt => ({
        ...evt,
        startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime),
        endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime),
    }));
  }, [eventsFromInventory]);
  
  useEffect(() => {
    const fromDate = subDays(new Date(), 7); 
    const toDate = new Date();
    
    const stuckAppointments = (appointments || []).filter(apt => 
      apt.status === 'ready_for_checkout' && 
      apt.endTime > fromDate &&
      apt.endTime < toDate &&
      (differenceInHours(new Date(), apt.endTime) > 2)
    );
      
    const appointmentIdsWithTransactions = new Set(
      (transactions || []).filter(t => t.appointmentId).map(t => t.appointmentId)
    );

    const appointmentsToFix = stuckAppointments.filter(apt => appointmentIdsWithTransactions.has(apt.id));

    if (appointmentsToFix.length > 0 && firestore && tenantId) {
        const batch = writeBatch(firestore);
        appointmentsToFix.forEach(apt => {
            const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, apt.id);
            batch.update(appointmentRef, { status: 'completed' });
        });
        batch.commit();
    }
  }, [appointments, transactions, firestore, tenantId]);


  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [isPickingListOpen, setIsPickingListOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [receiptDataForPrompt, setReceiptDataForPrompt] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  
  const [mobileSelectedStaffId, setMobileSelectedStaffId] = useState<string>('');

  const [startConfirmAppointment, setStartConfirmAppointment] = useState<Appointment | null>(null);

  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [clientForNewApt, setClientForNewApt] = useState<Client | null>(null);


  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);

  const [activeView, setActiveView] = useState(viewParam === 'resources' ? 'resources' : 'staff');
    
  const scheduleProfilesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true));
  }, [firestore, tenantId]);

  const resourcesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'resources');
  }, [firestore, tenantId]);
  
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(resourcesQuery);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);

  const [notifiedOvertime, setNotifiedOvertime] = useState<Set<string>>(new Set());

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            (appointments || []).forEach(apt => {
                if (apt.status === 'servicing' && apt.actualStartTime) {
                    const service = (services || []).find(s => s.id === apt.serviceId);
                    if (!service) return;

                    const elapsedMinutes = differenceInMinutes(now, apt.actualStartTime);

                    if (elapsedMinutes > service.duration && !notifiedOvertime.has(apt.id)) {
                        const client = (clients || []).find(c => c.id === apt.clientId);
                        toast({
                            variant: 'destructive',
                            title: 'Service Running Over',
                            description: `${client?.name || 'A client'}'s ${service.name} service is over its scheduled time.`,
                        });
                        setNotifiedOvertime(prev => new Set(prev).add(apt.id));
                    }
                } else if (apt.status !== 'servicing' && notifiedOvertime.has(apt.id)) {
                    setNotifiedOvertime(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(apt.id);
                        return newSet;
                    });
                }
            });
        }, 30000); // Check every 30 seconds

        return () => clearInterval(timer);
    }, [appointments, services, clients, toast, notifiedOvertime]);

  useEffect(() => {
    if (staff && staff.length > 0 && !mobileSelectedStaffId) {
      setMobileSelectedStaffId(staff[0].id);
    }
  }, [staff, mobileSelectedStaffId]);

  const weekStart = useMemo(() => {
    return startOfWeek(currentDate, { weekStartsOn: 0 });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = weekStart;
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekStart]);

  const dailyTransactions = useMemo(() => {
    if (!transactions) return [];
    const dayStart = startOfDay(currentDate);
    const dayEnd = endOfDay(currentDate);
    return transactions.filter(t => {
      const transactionDate = (t.date as any)?.toDate ? (t.date as any).toDate() : parseISO(t.date as any);
      return transactionDate >= dayStart && transactionDate <= dayEnd;
    });
  }, [transactions, currentDate]);

  const dailyBillInstances = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    
    const today = startOfDay(currentDate);

    return billInstances
        .filter(instance => {
            const dueDate = startOfDay(parseISO(instance.dueDate));
            return (isEqual(dueDate, today) || isBefore(dueDate, today)) && instance.status !== 'paid';
        })
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            return { ...instance, definition: definition! };
        })
        .filter(item => item.definition)
        .sort((a,b) => parseISO(a.dueDate).getTime() - (parseISO(b.dueDate)).getTime());
    }, [currentDate, billInstances, billDefinitions]);


  const weeklyKpis = useMemo(() => {
    const start = weekStart;
    const end = endOfDay(addDays(start, 6));
    const weekInterval = { start, end };
    
    const appointmentsInWeek = (appointments || []).filter(apt => {
        const aptStartTime = apt.startTime;
        return aptStartTime >= weekInterval.start && aptStartTime <= weekInterval.end;
    });

    const completedAppointments = appointmentsInWeek.filter(apt => apt.status === 'completed');
    const confirmedAppointments = appointmentsInWeek.filter(apt => apt.status === 'confirmed');

    const weeklyRevenue = completedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const projectedRevenue = weeklyRevenue + confirmedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const weeklyCosts = completedAppointments.reduce((acc, apt) => {
        const service = (services || []).find(s => s.id === apt.serviceId);
        return acc + ((service as any)?.cost || 0);
    }, 0);
    
    const monthlyCosts = (billDefinitions || []).reduce((acc, bill) => {
        if (bill.billingCycle === 'monthly') return acc + bill.amount;
        if (bill.billingCycle === 'weekly') return acc + (bill.amount * 4);
        if (bill.billingCycle === 'quarterly') return acc + (bill.amount / 3);
        if (bill.billingCycle === 'annually') return acc + (bill.amount / 12);
        return acc;
    }, 0);

    const absorbedCosts = completedAppointments.reduce((acc, apt) => acc + (apt.absorbedCost || 0), 0);

    return {
        weeklyRevenue: weeklyRevenue,
        projectedRevenue: projectedRevenue,
        weeklyBreakEven: monthlyCosts / 4,
        weeklyNetProfit: weeklyRevenue - weeklyCosts,
        absorbedCosts: absorbedCosts,
    }
  }, [currentDate, appointments, weekStart, billDefinitions, services]);
  
   const itemsByColumnRaw = useMemo(() => {
    const map = new Map<string, (Appointment | Event & { itemType: string })[]>();
    
    const columnsToProcess = activeView === 'staff' ? (staff || []) : (resources || []);

    columnsToProcess.forEach(s => map.set(s.id, []));

    // Process appointments
    (appointments || [])
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .forEach(apt => {
        if (activeView === 'staff') {
            const staffId = apt.staffId || (staff || [])[0]?.id;
            if (staffId && map.has(staffId)) {
                map.get(staffId)!.push({ ...apt, itemType: 'appointment' });
            }
        } else { // resource view
            const resourceIds = apt.requiredResourceIds && apt.requiredResourceIds.length > 0
              ? apt.requiredResourceIds
              : [...new Set([
                  ...(services?.find(s => s.id === apt.serviceId)?.requiredResourceIds || []),
                  ...(apt.addOnIds || []).flatMap(id => services?.find(s => s.id === id)?.requiredResourceIds || [])
                ])];

            if (resourceIds && resourceIds.length > 0) {
              resourceIds.forEach(resourceId => {
                if (map.has(resourceId)) {
                  map.get(resourceId)!.push({ ...apt, itemType: 'appointment' });
                }
              });
            }
        }
      });

    // Process events
    (events || [])
      .filter(evt => isSameDay(evt.startTime, currentDate))
      .forEach(evt => {
          const eventWithDateObjects = {
              ...evt,
              startTime: evt.startTime,
              endTime: evt.endTime,
          };
          if (activeView === 'staff') {
            if (evt.staffId && map.has(evt.staffId)) {
                // Event with specific staff
                map.get(evt.staffId)!.push({ ...eventWithDateObjects, itemType: 'event' });
            } else if (evt.type === 'blocked' && !evt.staffId) {
                // Block all staff
                (staff || []).forEach(s => {
                    map.get(s.id)!.push({ ...eventWithDateObjects, itemType: 'event' });
                });
            } else {
                // Personal/Business event for the owner (first staff member)
                const ownerId = (staff || [])[0]?.id;
                if (ownerId) {
                    map.get(ownerId)!.push({ ...eventWithDateObjects, itemType: 'event' });
                }
            }
          }
      });

    map.forEach(items => {
        items.sort((a,b) => a.startTime.getTime() - b.startTime.getTime())
    });

    return map;
  }, [currentDate, appointments, events, staff, resources, activeView, services]);
  
  const itemsByColumn = useMemo(() => {
    if(!itemsByColumnRaw) return new Map(); 
    const map = new Map<string, (Appointment | Event)[]>();
    
    const columnsToUse = activeView === 'staff' ? staff : resources;
    (columnsToUse || []).forEach(s => map.set(s.id, []));

    for(const [columnId, items] of itemsByColumnRaw.entries()) {
        if (map.has(columnId)) {
            map.set(columnId, items);
        }
    }
    return map;
  }, [itemsByColumnRaw, activeView, staff, resources]);

  const staffToDisplay = useMemo(() => {
    if (isMobile && activeView === 'staff') {
        if (!mobileSelectedStaffId || !staff) return [];
        const selected = (staff || []).find(s => s.id === mobileSelectedStaffId);
        return selected ? [selected] : [];
    }
    return staff || [];
  }, [isMobile, mobileSelectedStaffId, staff, activeView]);

  const columnsToDisplay = useMemo(() => {
    if (activeView === 'staff') {
      return staffToDisplay;
    }
    return resources || [];
  }, [activeView, staffToDisplay, resources]);


  const handleCompleteClick = (appointment: Appointment) => {
    if (appointment.status === 'completed') {
      toast({
        title: 'Already Completed',
        description: 'This appointment has already been checked out.',
      });
      return;
    }
    setSelectedAppointment(appointment);
    setIsCheckoutOpen(true);
  };

  const handleEditClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsEditAppointmentOpen(true);
  };
  
   const handleRescheduleClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsRescheduleOpen(true);
  };
  
  const handleEditEventClick = (event: Event) => {
    setSelectedEvent(event);
    setIsEditEventOpen(true);
  }
  
  const handleLogPaymentClick = (instance: BillInstance & { definition: BillDefinition }) => {
    setSelectedBill(instance);
  };

  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string, receiptUrl?: string; }) => {
    if (!selectedBill || !firestore || !user || !tenantId) return;

    const billInstanceRef = doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus: BillInstance['status'] = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    
    updateDocumentNonBlocking(billInstanceRef, {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        status: newStatus
    });

    const newTransaction: Omit<Transaction, 'id'> = {
        date: paymentData.date.toISOString(),
        description: `Payment for ${selectedBill.definition.name}`,
        clientOrVendor: selectedBill.definition.name,
        type: 'payment',
        context: selectedBill.definition.context,
        category: selectedBill.definition.category,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        paymentMethodIdentifier: paymentData.paymentMethodIdentifier,
        hasReceipt: !!paymentData.receiptUrl,
        relatedBillInstanceId: selectedBill.id,
    };
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, newTransaction);
    
    toast({
        title: "Payment Logged",
        description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
    })

    setSelectedBill(null);
    if (isBillsSheetOpen) {
        setIsBillsSheetOpen(false);
    }
  };

  const handleCheckoutComplete = (receiptData: Omit<ReceiptData, 'business'>) => {
    setReceiptDataForPrompt({
        business: { name: selectedTenant?.name || 'ClarityFlow', phone: '555-123-4567' },
        ...receiptData
    });
  }

  const handleAddAppointment = async (newAppointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date, recurrence?: { frequency: string, endDate: Date }}) => {
    if (!firestore || !tenantId) return;

    const { recurrence, ...baseAppointment } = newAppointmentData;

    let finalClientId = baseAppointment.clientId;
    let finalClientName = (clients || []).find(c => c.id === finalClientId)?.name || 'Walk-in Customer';
    
    if (finalClientId && finalClientId.startsWith('walkin-')) {
        const existingClient = (clients || []).find(c => c.name === baseAppointment.clientName);
        if (existingClient) {
            finalClientId = existingClient.id;
        } else {
            const clientsCollection = collection(firestore, 'tenants', tenantId, 'clients');
            const newClientRef = doc(clientsCollection);
            const newId = newClientRef.id;
            const newClient: Client = {
              id: newId,
              name: baseAppointment.clientName || 'Walk-in Customer',
              email: '', 
              phone: '',
              avatarUrl: '',
              lifetimeValue: 0,
              lastAppointment: new Date().toISOString(),
              status: 'active',
            };
            await setDoc(newClientRef, newClient);
            finalClientId = newId;
            finalClientName = newClient.name;
        }
    }

    if (recurrence && recurrence.frequency && recurrence.endDate) {
        const batch = writeBatch(firestore);
        const recurrenceId = nanoid();
        let currentStartTime = baseAppointment.startTime;
        let currentEndTime = baseAppointment.endTime;

        while (isBefore(currentStartTime, recurrence.endDate)) {
            const appointmentDocId = nanoid();
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentDocId);
            const checkInToken = nanoid(16);

            const appointmentToSave = {
                ...baseAppointment,
                clientId: finalClientId,
                clientName: finalClientName,
                id: appointmentDocId,
                startTime: currentStartTime.toISOString(),
                endTime: currentEndTime.toISOString(),
                checkInToken: checkInToken,
                recurrenceId: recurrenceId,
                source: 'manual',
                tenantId: tenantId,
            };
            batch.set(appointmentRef, appointmentToSave);

            const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
            batch.set(checkInDocRef, appointmentToSave);
            
            if (recurrence.frequency === 'weekly') {
                currentStartTime = addWeeks(currentStartTime, 1);
                currentEndTime = addWeeks(currentEndTime, 1);
            } else if (recurrence.frequency === 'bi-weekly') {
                currentStartTime = addWeeks(currentStartTime, 2);
                currentEndTime = addWeeks(currentEndTime, 2);
            } else if (recurrence.frequency === 'every-3-weeks') {
                currentStartTime = addWeeks(currentStartTime, 3);
                currentEndTime = addWeeks(currentEndTime, 3);
            } else if (recurrence.frequency === 'every-4-weeks') {
                currentStartTime = addWeeks(currentStartTime, 4);
                currentEndTime = addWeeks(currentEndTime, 4);
            } else if (recurrence.frequency === 'monthly') {
                currentStartTime = addMonths(currentStartTime, 1);
                currentEndTime = addMonths(currentEndTime, 1);
            } else {
                break;
            }
        }
        await batch.commit();
        toast({
            title: "Recurring Appointments Booked",
            description: `Appointments with ${finalClientName} have been added to the calendar.`
        });
    } else {
        const appointmentDocId = nanoid();
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentDocId);
        
        const checkInToken = nanoid(16);
        const appointmentToSave = { 
            ...baseAppointment, 
            id: appointmentDocId,
            tenantId: tenantId,
            clientId: finalClientId, 
            clientName: finalClientName,
            checkInToken: checkInToken,
            startTime: baseAppointment.startTime.toISOString(),
            endTime: baseAppointment.endTime.toISOString(),
            source: 'manual' as const,
        };
        
        await setDoc(appointmentRef, appointmentToSave);

        const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
        await setDoc(checkInDocRef, appointmentToSave);
        
        toast({
            title: "Appointment Booked",
            description: `Appointment with ${finalClientName} has been added.`
        });
    }
    
    setIsAddAppointmentOpen(false);
    setAppointmentToRebook(null);
    setClientForNewApt(null);
  };

  const handleUpdateAppointment = (updatedAppointment: Appointment) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', updatedAppointment.id);
    const dataToSave = {
        ...updatedAppointment,
        startTime: updatedAppointment.startTime.toISOString(),
        endTime: updatedAppointment.endTime.toISOString()
    };
    updateDocumentNonBlocking(appointmentRef, dataToSave);

    if (updatedAppointment.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', updatedAppointment.checkInToken);
        updateDocumentNonBlocking(checkInRef, dataToSave);
    }
    
    toast({
        title: "Appointment Updated",
        description: `The appointment has been successfully updated.`
    })
    setIsEditAppointmentOpen(false);
    setIsRescheduleOpen(false);
  };

  const handleRebook = (appointment: Appointment, weeksOut?: number) => {
    setIsCheckoutOpen(false);
    setSelectedAppointment(null); // Clear appointment from checkout
    
    let rebookAppointmentData: Appointment = { ...appointment };

    if (weeksOut) {
        rebookAppointmentData.startTime = addWeeks(appointment.startTime, weeksOut);
    }
    
    setAppointmentToRebook(rebookAppointmentData);
    setIsAddAppointmentOpen(true);
  };
  
  const handleBookNewForClient = (clientId: string) => {
    setAppointmentToRebook(null);
    const client = clients?.find(c => c.id === clientId);
    if (client) {
      setClientForNewApt(client);
    }
    setIsAddAppointmentOpen(true);
  };


  const handleAddEvent = (newEvent: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date}) => {
    if (!firestore || !tenantId) return;
    const newEventWithId = { ...newEvent, id: nanoid() };
    const eventRef = doc(firestore, 'tenants', tenantId, 'events', newEventWithId.id);
    const dataToSave = {
        ...newEventWithId,
        startTime: newEventWithId.startTime.toISOString(),
        endTime: newEventWithId.endTime.toISOString(),
    };
    setDocumentNonBlocking(eventRef, dataToSave, {});

    if (newEvent.cost && newEvent.cost > 0 && newEvent.type !== 'blocked') {
        const newTransaction = {
            description: `Expense for: ${newEvent.title}`,
            clientOrVendor: 'N/A',
            type: 'expense' as const,
            context: newEvent.type === 'business' ? 'Business' : 'Personal',
            category: newEvent.type === 'business' ? 'Business Travel' : 'Personal Travel',
            amount: newEvent.cost,
            paymentMethod: 'Unknown',
            hasReceipt: false,
            relatedEventId: newEventWithId.id
        };
        addTransaction(newTransaction)
    }

    toast({
        title: "Event Added",
        description: `"${newEvent.title}" has been added to your calendar.`
    });
    setIsAddEventOpen(false);
  };

    const handleUpdateEvent = (updatedEvent: Event) => {
        if (!firestore || !tenantId) return;
        const eventRef = doc(firestore, 'tenants', tenantId, 'events', updatedEvent.id);
        const dataToSave = {
            ...updatedEvent,
            startTime: updatedEvent.startTime.toISOString(),
            endTime: updatedEvent.endTime.toISOString(),
        };
        updateDocumentNonBlocking(eventRef, dataToSave);
        toast({
            title: "Event Updated",
            description: `"${updatedEvent.title}" has been updated.`
        });
        setIsEditEventOpen(false);
    }
    
    const addTransaction = (transaction: Omit<Transaction, 'id' | 'date'>) => {
        if (!firestore || !user || !tenantId) {
            toast({
                variant: 'destructive',
                title: 'Authentication Error',
                description: 'You must be logged in to log an expense.',
            });
            return;
        }
        const transactionRef = collection(firestore, 'tenants', tenantId, 'transactions');
        const newTransaction = {
            ...transaction,
            date: Timestamp.fromDate(currentDate),
        };
        addDocumentNonBlocking(transactionRef, newTransaction);
        toast({
            title: "Expense Logged",
            description: `An expense of $${transaction.amount.toFixed(2)} for "${transaction.description}" has been recorded in your ledger.`
        });
  }
  
  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId || !appointments) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    updateDocumentNonBlocking(appointmentRef, {
        status: 'ready_for_checkout', 
        checkoutState,
        actualEndTime: new Date().toISOString(),
    });
    
    const appointment = appointments.find(apt => apt.id === appointmentId);
    if (appointment?.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
        updateDocumentNonBlocking(checkInRef, { status: 'ready_for_checkout', tenantId: tenantId });
    }

    const staffIdsInvolved = new Set(Object.values(checkoutState.serviceStaffOverrides || {}));
    if (appointment?.staffId) {
      staffIdsInvolved.add(appointment.staffId);
    }

    staffIdsInvolved.forEach(staffId => {
      if (staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        updateDocumentNonBlocking(staffDocRef, {
          status: 'idle',
        });
      }
    });
    
    const walkInId = appointmentId.replace('apt-walkin-', '');
    if (walkIns?.find(w => w.id === walkInId)) {
        const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, {
            status: 'ready_for_checkout',
            serviceEndTime: new Date().toISOString()
        });
    }

    setIsTechnicianReviewOpen(false);
    setSelectedAppointment(null);
    toast({
      title: 'Sent to Front Desk',
      description: "Client is ready for checkout.",
    });
  };

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    if (!firestore || !tenantId || !appointments || !clients || !selectedTenant) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    
    let updateData: Partial<Appointment> = { status };
    
    if (status === 'cancelled') {
        const appointment = appointments.find(apt => apt.id === appointmentId);
        const client = clients?.find(c => c.id === appointment?.clientId);
        
        if (appointment && client) {
            const timeDiffHours = differenceInHours(appointment.startTime, new Date());
            const cancellationWindow = selectedTenant.cancellationWindowHours || 24;

            if (timeDiffHours < cancellationWindow && appointment.status !== 'cancelled') {
                const fee = selectedTenant.cancellationFee || 25; 
                const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
                
                const newFee = {
                    feeId: nanoid(),
                    appointmentId: appointment.id,
                    appointmentDate: appointment.startTime.toISOString(),
                    feeAmount: fee,
                    reason: 'Late Cancellation'
                };

                updateDocumentNonBlocking(clientRef, { 
                    outstandingBalance: increment(fee),
                    unpaidFees: arrayUnion(newFee)
                });
                
                updateData.cancellationReason = 'client_request';
                updateData.cancellationFeeApplied = fee;

                toast({
                    title: "Late Cancellation Fee Applied",
                    description: `$${fee.toFixed(2)} fee has been added to ${client.name}'s account.`
                });
            }
        }
    }

    updateDocumentNonBlocking(appointmentRef, updateData);

    const appointment = appointments.find(apt => apt.id === appointmentId);
    if (appointment?.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
        updateDocumentNonBlocking(checkInRef, { status, tenantId: tenantId });
    }

    toast({
        title: "Status Updated",
        description: `Appointment status changed to ${status}.`
    });
  };
  
  const handleFinishService = (appointment: Appointment) => {
    const updatedAppointment = { ...appointment, actualEndTime: new Date().toISOString() };
    setSelectedAppointment(updatedAppointment);
    setIsTechnicianReviewOpen(true);
  };

  const handleDeleteAppointment = (appointmentId: string) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    deleteDocumentNonBlocking(appointmentRef);
     toast({
        variant: "destructive",
        title: "Appointment Deleted",
        description: `The appointment has been removed from your calendar.`
    });
  };
  
  const handleChecklistItemToggle = (eventId: string, checklistItemId: string, completed: boolean) => {
      if (!firestore || !tenantId || !events) return;
      const eventToUpdate = events.find(e => e.id === eventId);
      if (!eventToUpdate) return;
      
      const updatedChecklist = eventToUpdate.checklist?.map(item => 
          item.id === checklistItemId ? { ...item, completed } : item
      );
      
      const eventRef = doc(firestore, 'tenants', tenantId, 'events', eventId);
      updateDocumentNonBlocking(eventRef, { checklist: updatedChecklist });
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setCurrentDate(date);
    }
  };

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    let client = (clients || []).find(c => c.id === selectedAppointment.clientId);
    const service = (services || []).find(s => s.id === selectedAppointment.serviceId);

    const walkIn = selectedAppointment.isWalkIn && walkIns
      ? walkIns.find(w => `apt-walkin-${w.id}` === selectedAppointment.id)
      : undefined;

    if (!client && selectedAppointment.clientName) {
        client = {
            id: selectedAppointment.clientId,
            name: selectedAppointment.clientName,
            email: selectedAppointment.clientEmail || '',
            phone: selectedAppointment.clientPhone || '',
            avatarUrl: '',
            lifetimeValue: 0,
            lastAppointment: ''
        };
    }

    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment, clients, services, walkIns]);
  
  const handlePrintReceipt = (receiptData: ReceiptData) => {
    setReceiptToPrint(receiptData);
  };

  const handlePrintTicket = (ticketData: Omit<TicketData, 'business'>) => {
    if (!selectedTenant) return;
    setTicketToPrint({
        business: { name: selectedTenant.name, phone: '555-123-4567' },
        ...ticketData
    });
  }

  const appointmentsForDay = useMemo(() => {
    return (appointments || [])
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }, [appointments, currentDate]);

  const eventsForDay = (events || [])
      .filter(evt => isSameDay(evt.startTime, currentDate))
      .sort((a,b) => evt.startTime.getTime() - b.startTime.getTime());
  
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  const handleScan = useCallback((data: string) => {
    if (!appointments) return;
    if (data.startsWith('clarityflow://checkout/')) {
        const appointmentId = data.split('/').pop();
        const appointmentToCheckout = appointments.find(apt => apt.id === appointmentId);

        if (appointmentToCheckout && appointmentToCheckout.status === 'ready_for_checkout') {
            setSelectedAppointment(appointmentToCheckout);
            setIsCheckoutOpen(true);
        } else if (appointmentToCheckout) {
          toast({
            title: 'Appointment Not Ready',
            description: "This appointment is not yet marked as ready for checkout.",
          });
        } else {
            toast({
                variant: 'destructive',
                title: 'Appointment Not Found',
                description: 'Could not find a matching appointment. The data may still be syncing. Please try again in a moment.',
            });
        }
    }
  }, [appointments, toast, setIsCheckoutOpen, setSelectedAppointment]);

  useEffect(() => {
    if (scannedData) {
        handleScan(scannedData);
        setScannedData(null); // Reset after processing
    }
  }, [scannedData, handleScan]);

  useEffect(() => {
    let html5QrCode: Html5Qrcode | undefined;
    if (isScannerOpen) {
      // Use a timeout to ensure the element is in the DOM and visible
      const timer = setTimeout(() => {
        const element = document.getElementById('qr-reader-planner');
        if (element) {
            html5QrCode = new Html5Qrcode('qr-reader-planner');
            const onScanSuccess = (decodedText: string, decodedResult: any) => {
                if (html5QrCode?.isScanning) {
                    html5QrCode.stop().catch(console.error);
                }
                setScannedData(decodedText);
                setIsScannerOpen(false);
            };

            const onScanFailure = (error: any) => { /* ignore */ };
            
            setTimeout(() => {
                html5QrCode?.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: 250, height: 250 } },
                    onScanSuccess,
                    onScanFailure
                ).catch(err => {
                    toast({
                        variant: 'destructive',
                        title: 'Camera Error',
                        description: 'Could not start the camera. Please check permissions and try again.',
                    });
                    setIsScannerOpen(false);
                });
            }, 300);
        }
      }, 100); 

      return () => {
          clearTimeout(timer);
          if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => {
                console.error("Failed to stop QR Code scanner.", err);
            });
          }
      };
    }
}, [isScannerOpen, handleScan, toast]);
  
  const isDataLoading = isLoading || isUserLoading || isTenantLoading || scheduleProfilesLoading || resourcesLoading || checkInsLoading;
  
  const onStartService = (appointmentId: string) => {
    const appointmentToStart = (appointments || []).find(apt => apt.id === appointmentId);
    if (appointmentToStart) {
        setStartConfirmAppointment(appointmentToStart);
    }
  };
  
  const confirmStartService = () => {
    if (!startConfirmAppointment || !firestore || !tenantId) return;
    const nowISO = new Date().toISOString();
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', startConfirmAppointment.id);
    updateDocumentNonBlocking(appointmentRef, { status: 'servicing', actualStartTime: nowISO });
    
    if (startConfirmAppointment.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', startConfirmAppointment.checkInToken);
        updateDocumentNonBlocking(checkInRef, { status: 'servicing', tenantId: tenantId });
    }

    if (startConfirmAppointment.staffId) {
      const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', startConfirmAppointment.staffId);
      updateDocumentNonBlocking(staffDocRef, { status: 'busy' });
    }

    if (startConfirmAppointment.isWalkIn) {
        const walkInId = startConfirmAppointment.id.replace('apt-walkin-', '');
        const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInDocRef, {
            status: 'servicing',
            serviceStartTime: nowISO,
        });
    }

    toast({
        title: "Service Started",
        description: "The appointment is now marked as 'In Service'."
    });
    setStartConfirmAppointment(null);
  };


  if (isDataLoading) {
    return (
      <div className="flex h-screen w-full flex-col">
        <AppHeader />
        <div className="flex items-center justify-center flex-1">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader />
      
      <div className="p-4 border-b">
            <div className="flex flex-col gap-4">
                {isMobile ? (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                            <h2 className="text-2xl font-semibold mr-auto">{format(currentDate, 'MMMM yyyy')}</h2>
                            <div className="flex items-center gap-0.5">
                                <Button variant="ghost" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-5 h-5" /></Button>
                                <Button variant="ghost" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                                    <BellRing className={cn("h-5 w-5", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                                    {dailyBillInstances.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />}
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-5 h-5" /></Button>
                                <Button variant="ghost" size="icon" onClick={() => setIsScannerOpen(true)}><QrCode className="w-5 h-5" /></Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon">
                                            <Globe className="h-5 w-5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem asChild><Link href={`/book/${tenantId}`} target="_blank">View Booking Page</Link></DropdownMenuItem>
                                        <DropdownMenuItem asChild><Link href={`/walk-in-queue`}>View Walk-in Kiosk</Link></DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                         <div className="text-sm font-medium text-muted-foreground flex items-center justify-center gap-1.5 pt-1">
                            <DollarSign className="w-4 h-4" />
                            <span>TMHR: ${tmhr.toFixed(2)}/hr</span>
                        </div>
                    </div>
                ) : (
                     <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => setCurrentDate(subDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                            <Button variant="outline" onClick={() => setCurrentDate(addDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                            <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-8">Today</Button>
                            <div className="relative h-8">
                                <Button variant="outline" size="icon" className="h-8 w-8" asChild>
                                    <label htmlFor="date-picker-desktop" className="cursor-pointer">
                                        <CalendarIcon className="h-4 w-4" />
                                        <span className="sr-only">Jump To...</span>
                                    </label>
                                </Button>
                                <input
                                    id="date-picker-desktop"
                                    type="date"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    value={format(currentDate, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            handleDateSelect(new Date(e.target.value.replace(/-/g, '/')));
                                        }
                                    }}
                                />
                            </div>
                             <Separator orientation="vertical" className="h-6" />
                             <RadioGroup
                                value={activeView}
                                onValueChange={(value) => setActiveView(value as 'staff' | 'resources')}
                                className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5"
                            >
                                <TooltipProvider>
                                    <div>
                                        <RadioGroupItem value="staff" id="staff-view" className="peer sr-only" />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Label
                                                    htmlFor="staff-view"
                                                    className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background peer-data-[state=checked]:shadow peer-data-[state=checked]:text-foreground"
                                                >
                                                    <User className="h-3.5 w-3.5" />
                                                </Label>
                                            </TooltipTrigger>
                                            <TooltipContent>Staff View</TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="resources" id="resource-view" className="peer sr-only" />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Label
                                                    htmlFor="resource-view"
                                                    className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background peer-data-[state=checked]:shadow peer-data-[state=checked]:text-foreground"
                                                >
                                                    <Building className="h-3.5 w-3.5" />
                                                </Label>
                                            </TooltipTrigger>
                                            <TooltipContent>Resource View</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </TooltipProvider>
                            </RadioGroup>
                        </div>
                         <div className="flex items-center justify-end gap-2">
                             <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground border-r pr-4 mr-2">
                                <DollarSign className="w-4 h-4" />
                                <span>TMHR: ${tmhr.toFixed(2)}/hr</span>
                            </div>
                            <TooltipProvider>
                                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-4 h-4" /><span className="sr-only">Weekly KPIs</span></Button></TooltipTrigger><TooltipContent><p>Weekly KPIs</p></TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild>
                                    <Button variant="outline" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                                        <BellRing className={cn("h-4 w-4", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                                        {dailyBillInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                                        <span className="sr-only">Bills Due Today</span>
                                    </Button>
                                </TooltipTrigger><TooltipContent><p>Bills Due Today</p></TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-4 h-4" /><span className="sr-only">Picking List</span></Button></TooltipTrigger><TooltipContent><p>Picking List</p></TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><QrCode className="w-4 h-4" /><span className="sr-only">Scan Ticket</span></Button></TooltipTrigger><TooltipContent><p>Scan Ticket</p></TooltipContent></Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="icon">
                                                    <Globe className="h-4 w-4" />
                                                    <span className="sr-only">Public Pages</span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem asChild>
                                                    <Link href={`/book/${tenantId}`} target="_blank">View Booking Page</Link>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem asChild>
                                                    <Link href={`/walk-in-queue`}>View Walk-in Kiosk</Link></DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Public Pages</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Button size="sm" onClick={() => setIsAddEventOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Event</Button>
                            <Button size="sm" onClick={() => handleBookNewForClient('')}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
                        </div>
                    </div>
                )}
                 <div className="-mx-4 md:m-0">
                    <ScrollArea className="w-full">
                        <div className="flex w-full px-4 md:px-0">
                            {weekDays.map(day => (
                                <button
                                    key={day.toISOString()}
                                    onClick={() => setCurrentDate(day)}
                                    className={cn(
                                        "flex-1 py-2 text-center md:p-3 transition-colors hover:bg-muted/50 rounded-md",
                                         isSameDay(day, currentDate) && "bg-muted"
                                    )}
                                >
                                    <p className={cn("text-xs", isSameDay(day, currentDate) ? "text-primary font-semibold" : "text-muted-foreground")}>
                                        {format(day, 'EEE')}
                                    </p>
                                    <p className={cn("text-lg md:text-2xl font-bold mt-1", !isSameDay(day, currentDate) && "text-muted-foreground")}>
                                        {format(day, 'd')}
                                    </p>
                                </button>
                            ))}
                        </div>
                        <ScrollBar orientation="horizontal" className="md:hidden" />
                    </ScrollArea>
                </div>
            </div>
      </div>
      
      <main className="flex-1 flex flex-col min-h-0">
           {activeView === 'staff' && (
            <DayTimeline 
                date={currentDate} 
                columns={staffToDisplay}
                showColumnHeader={false} // Header logic is now internal
                isMobile={isMobile || false}
                activeView={activeView}
                allStaff={staff || []}
                mobileSelectedStaffId={mobileSelectedStaffId}
                onMobileStaffChange={setMobileSelectedStaffId}
                itemsByColumn={itemsByColumn}
                onCompleteClick={handleCompleteClick} 
                onUpdateStatus={onUpdateStatus}
                onDeleteAppointment={handleDeleteAppointment} 
                onPrintReceipt={handlePrintReceipt}
                onPrintTicket={handlePrintTicket}
                onEditAppointment={handleEditClick}
                onEditEvent={handleEditEventClick}
                onChecklistItemToggle={handleChecklistItemToggle}
                onUpdateEvent={handleUpdateEvent}
                dailyTransactions={dailyTransactions}
                allTransactions={transactions || []}
                onAddTransaction={addTransaction}
                onReschedule={handleRescheduleClick}
                onRebook={handleRebook}
                onOpenPickingList={() => setIsPickingListOpen(true)}
                onStartService={onStartService}
                onFinishService={handleFinishService}
                onBookNewForClient={handleBookNewForClient}
                walkIns={walkIns}
                clients={clients}
                services={services}
                resources={resources || []}
                publicScheduleProfile={publicScheduleProfile}
            />
          )}

          {activeView === 'resources' && (
             <DayTimeline 
                date={currentDate} 
                columns={resources || []}
                showColumnHeader={true}
                isMobile={isMobile || false}
                activeView={activeView}
                allStaff={staff || []}
                mobileSelectedStaffId={mobileSelectedStaffId}
                onMobileStaffChange={setMobileSelectedStaffId}
                itemsByColumn={itemsByColumn}
                onCompleteClick={handleCompleteClick} 
                onUpdateStatus={onUpdateStatus}
                onDeleteAppointment={handleDeleteAppointment} 
                onPrintReceipt={handlePrintReceipt}
                onPrintTicket={handlePrintTicket}
                onEditAppointment={handleEditClick}
                onEditEvent={handleEditEventClick}
                onChecklistItemToggle={handleChecklistItemToggle}
                onUpdateEvent={handleUpdateEvent}
                dailyTransactions={dailyTransactions}
                allTransactions={transactions || []}
                onAddTransaction={addTransaction}
                onReschedule={handleRescheduleClick}
                onRebook={handleRebook}
                onOpenPickingList={() => setIsPickingListOpen(true)}
                onStartService={onStartService}
                onFinishService={handleFinishService}
                onBookNewForClient={handleBookNewForClient}
                walkIns={walkIns}
                clients={clients}
                services={services}
                resources={resources || []}
                publicScheduleProfile={publicScheduleProfile}
            />
          )}
      </main>
      
      <FloatingActionButton
        onNewAppointmentClick={() => handleBookNewForClient('')}
        onNewEventClick={() => setIsAddEventOpen(true)}
      />

      {selectedAppointmentData && (
        <CompleteAppointmentDialog
            open={isCheckoutOpen}
            onOpenChange={(isOpen) => {
              if(!isOpen) setSelectedAppointment(null);
              setIsCheckoutOpen(isOpen);
            }}
            appointmentsData={[selectedAppointmentData]}
            onCheckoutComplete={handleCheckoutComplete}
            onRebook={handleRebook}
        />
      )}
      {selectedAppointmentData && (
        <TechnicianReviewDialog
            open={isTechnicianReviewOpen}
            onOpenChange={(isOpen) => {
                if(!isOpen) setSelectedAppointment(null);
                setIsTechnicianReviewOpen(isOpen);
            }}
            appointmentData={selectedAppointmentData}
            onSendToFrontDesk={handleSendToFrontDesk}
            staff={staff || []}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setAppointmentToRebook(null);
                setClientForNewApt(null);
            }
            setIsAddAppointmentOpen(isOpen);
        }}
        client={clientForNewApt}
        appointmentToRebook={appointmentToRebook}
        onConfirm={handleAddAppointment}
      />
       {selectedAppointment && (
        <EditAppointmentDialog 
            open={isEditAppointmentOpen}
            onOpenChange={setIsEditAppointmentOpen}
            appointment={selectedAppointment}
            clients={clients || []}
            services={services || []}
            appointments={appointments || []}
            onConfirm={handleUpdateAppointment}
        />
       )}
        {selectedAppointment && (
            <RescheduleDialog
                open={isRescheduleOpen}
                onOpenChange={setIsRescheduleOpen}
                appointment={selectedAppointment}
                clients={clients || []}
                services={services || []}
                appointments={appointments || []}
                onConfirm={handleUpdateAppointment}
            />
        )}
      <AddEventDialog 
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={handleAddEvent}
        staff={staff || []}
      />
       {selectedEvent && (
        <EditEventDialog
            open={isEditEventOpen}
            onOpenChange={setIsEditEventOpen}
            event={selectedEvent}
            onConfirm={handleUpdateEvent}
        />
       )}
        <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={weeklyKpis} isMobile={!!isMobile} />
        <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={dailyBillInstances} isMobile={!!isMobile} onLogPaymentClick={handleLogPaymentClick}/>
        
        <PickingListDialog
            open={isPickingListOpen}
            onOpenChange={setIsPickingListOpen}
            appointments={appointmentsForDay}
        />
        
        {selectedBill && (
            <LogPaymentDialog
                open={!!selectedBill}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setSelectedBill(null);
                    }
                }}
                billInstance={selectedBill}
                onConfirm={handleLogPaymentConfirm}
            />
      )}

      <AlertDialog open={!!receiptDataForPrompt} onOpenChange={() => setReceiptDataForPrompt(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Print Receipt?</AlertDialogTitle>
                <AlertDialogDescription>
                    Would you like to print a receipt for this transaction?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>No, Thanks</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                    if (receiptDataForPrompt) {
                        handlePrintReceipt(receiptDataForPrompt);
                    }
                    setReceiptDataForPrompt(null);
                }}>
                    Print Receipt
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!receiptToPrint} onOpenChange={(open) => !open && setReceiptToPrint(null)}>
        <DialogContent className="max-w-sm print-content">
          <DialogHeader className="print:hidden">
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          <div id="receipt-area">
            {receiptToPrint && <PrintReceipt data={receiptToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setReceiptToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!ticketToPrint} onOpenChange={(open) => !open && setTicketToPrint(null)}>
        <DialogContent className="max-w-md print-content">
          <DialogHeader className="print:hidden">
            <DialogTitle>Appointment Ticket</DialogTitle>
          </DialogHeader>
          <div id="ticket-area-dialog">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setTicketToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Ticket</DialogTitle>
            <DialogDescription>
              Position the walk-in ticket's QR code inside the frame to check out the client.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <div id="qr-reader-planner" className="w-full rounded-md bg-muted" />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
          </div>
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <AlertDialog open={!!startConfirmAppointment} onOpenChange={(open) => !open && setStartConfirmAppointment(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure you want to start this service?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will mark the appointment as &quot;In Service&quot; and log the current time as the actual start time.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmStartService}>Start Service</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <div id="print-ticket-area" className="hidden">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
        </div>
    </div>
  );
}



export default function PlannerPageWrapper() {
  return (
    <Suspense fallback={
        <div className="flex h-screen w-full flex-col">
            <AppHeader title="Planner" />
            <div className="flex items-center justify-center flex-1">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        </div>
    }>
        <PlannerPageContent />
    </Suspense>
  )
}
