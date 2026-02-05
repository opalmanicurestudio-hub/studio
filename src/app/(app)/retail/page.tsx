
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, Minus, X, DollarSign, ShoppingCart, CreditCard, Banknote, Gift, QrCode, AlertTriangle, UserPlus, Coins, Printer, Wallet, Award, Repeat, Percent, Check, Loader, Package } from 'lucide-react';
import { type InventoryItem, type StockCorrection, type Transaction, type Client, type Appointment, type Service, type AppointmentCheckoutState, type Membership, type Package as PackageType, type ClientFormData, type WalkIn, type Discount } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Image from 'next/image';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { useIsMobile } from '@/hooks/use-mobile';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
import { nanoid } from 'nanoid';
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { BrowseDiscountsDialog } from '@/components/discounts/BrowseDiscountsDialog';
import { Checkbox } from '@/components/ui/checkbox';


type CartItem = {
  id: string; // productId, serviceId, membershipId, or packageId
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  stock?: number;
  type: 'product' | 'service' | 'membership' | 'package';
  appointmentId?: string; // For service items
  staffId?: string;
  serviceObject?: Service; // To hold the full service object if needed
};

const MembershipProductCard = ({ membership, onClick }: { membership: Membership; onClick: () => void }) => {
    const hasPerks = (membership.includedServices && membership.includedServices.length > 0) ||
                   (membership.includedAddOns && membership.includedAddOns.length > 0) ||
                   (membership.includedProducts && membership.includedProducts.length > 0) ||
                   membership.retailDiscount;

    return (
        <Card onClick={onClick} className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="p-2 space-y-2">
                <div className="aspect-square bg-indigo-500/10 rounded-md flex items-center justify-center">
                    <Award className="w-1/2 h-1/2 text-indigo-500" />
                </div>
                <h3 className="text-sm font-medium leading-tight truncate">{membership.name}</h3>
                <p className="text-sm font-semibold">${membership.price.toFixed(2)} / {membership.interval.replace('ly', '')}</p>
                 {hasPerks && (
                    <div className="text-xs text-muted-foreground pt-2 border-t mt-1">
                        <ul className="space-y-1">
                            {(membership.includedServices || []).map(s => (
                                <li key={s.id} className="flex items-center gap-1.5">
                                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                    <span className="truncate">1x {s.name}</span>
                                </li>
                            ))}
                            {(membership.includedAddOns || []).map(s => (
                                <li key={s.id} className="flex items-center gap-1.5">
                                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                    <span className="truncate">1x {s.name}</span>
                                </li>
                            ))}
                            {(membership.includedProducts || []).map(p => (
                                <li key={p.id} className="flex items-center gap-1.5">
                                    <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                    <span className="truncate">1x {p.name}</span>
                                </li>
                            ))}
                            {membership.retailDiscount && (
                                 <li className="flex items-center gap-1.5">
                                    <Percent className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                    <span className="truncate">{membership.retailDiscount}% off retail</span>
                                </li>
                            )}
                        </ul>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};


const PackageProductCard = ({ pack, onClick, services }: { pack: PackageType; onClick: () => void; services: Service[] }) => {
    const service = services.find(s => s.id === pack.serviceId);
    return (
        <Card onClick={onClick} className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="p-2 space-y-2">
                <div className="aspect-square bg-teal-500/10 rounded-md flex items-center justify-center">
                    <Repeat className="w-1/2 h-1/2 text-teal-500" />
                </div>
                <h3 className="text-sm font-medium leading-tight truncate">{pack.name}</h3>
                <p className="text-sm font-semibold">${pack.price.toFixed(2)}</p>
                 {service && (
                    <div className="text-xs text-muted-foreground pt-1 border-t">
                        <p>Includes: {pack.sessions}x {service.name}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const CartContent = ({
    cart,
    selectedClientId,
    setSelectedClientId,
    isAddClientOpen,
    setIsAddClientOpen,
    subtotal,
    tax,
    tipAmount,
    setTipAmount,
    total,
    onCheckout,
    clients,
    updateQuantity,
    discount,
    membershipDiscount,
    setIsDiscountBrowserOpen,
    isGroupCheckout,
    payerOptions,
}: any) => {
    
  const selectedClient = useMemo(() => {
    return clients.find((c: Client) => c.id === selectedClientId);
  }, [selectedClientId, clients]);

  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" /> Current Sale
        </CardTitle>
        <div className="pt-4">
          <Label>Client</Label>
           <div className="flex gap-2 mt-2">
              <Select
                value={isGroupCheckout ? selectedClientId || 'group' : selectedClientId || 'walk-in'}
                onValueChange={(value) => {
                    if (value === 'walk-in' || value === 'group') {
                        setSelectedClientId(null);
                    } else {
                        setSelectedClientId(value);
                    }
                }}
              >
                <SelectTrigger>
                    {isGroupCheckout ? (
                        <SelectValue placeholder="Select a primary payer" />
                    ) : (
                        <SelectValue placeholder="Walk-in Customer" />
                    )}
                </SelectTrigger>
                <SelectContent>
                  {isGroupCheckout ? (
                     payerOptions.map((c: Client) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                        <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                        {clients.map((c: Client) => (
                        <SelectItem key={c.id} value={c.id}>
                            {c.name}
                        </SelectItem>
                        ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsAddClientOpen(true)}
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>
          {selectedClient && (
            <div className="mt-4 flex items-center gap-3 p-2 bg-background rounded-md">
              <Avatar className="h-9 w-9">
                <AvatarImage
                  src={selectedClient.avatarUrl}
                  alt={selectedClient.name}
                />
                <AvatarFallback>{selectedClient.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <span className="font-medium text-sm">{selectedClient.name}</span>
                {(selectedClient.walletCredit || 0) > 0 && (
                  <p className="text-xs text-primary font-medium flex items-center gap-1">
                    <Wallet className="h-3 w-3" />$
                    {selectedClient.walletCredit?.toFixed(2)} in credit
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-auto"
                onClick={() => setSelectedClientId(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <div className="flex-1 relative">
        <div className="absolute inset-0 overflow-y-auto">
            <CardContent className="space-y-6 px-6 py-4">
            {cart.length > 0 ? (
                <div className="space-y-4">
                {cart.map((item: CartItem) => (
                    <div key={item.id} className="flex items-center gap-4">
                     <div className='w-12 h-12 bg-muted rounded-md flex-shrink-0 flex items-center justify-center'>
                       {item.imageUrl ? (
                           <Image src={item.imageUrl} alt={item.name} width={48} height={48} className='rounded-md object-cover h-full w-full'/>
                       ) : (
                           <Package className="w-6 h-6 text-muted-foreground" />
                       )}
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                        ${item.price.toFixed(2)}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            disabled={item.type !== 'product'}
                        >
                        <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                                updateQuantity(item.id, parseInt(e.target.value) || 0)
                            }
                            className="w-12 h-8 text-center"
                            readOnly={item.type !== 'product'}
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            disabled={item.type !== 'product'}
                        >
                        <Plus className="h-3 w-3" />
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => updateQuantity(item.id, 0)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                    </div>
                ))}
                </div>
            ) : (
                <div className="text-center text-muted-foreground py-16">
                <p>No items in cart.</p>
                </div>
            )}

            <div className="w-full space-y-2 pt-6 border-t">
                <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                <div className="flex justify-between text-sm text-primary font-medium">
                    <span>Promo Code Discount:</span>
                    <span>-${discount.toFixed(2)}</span>
                </div>
                )}
                {membershipDiscount > 0 && (
                <div className="flex justify-between text-sm text-primary font-medium">
                    <span className="flex items-center gap-1.5"><Award className="w-3 h-3" />Membership Discount:</span>
                    <span>-${membershipDiscount.toFixed(2)}</span>
                </div>
                )}
                <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax (7%)</span>
                <span>${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Tip</span>
                <div className="relative w-24">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                    type="number"
                    value={tipAmount || ''}
                    onChange={(e) =>
                        setTipAmount(parseFloat(e.target.value) || 0)
                    }
                    className="h-8 text-right pr-2 pl-7"
                    placeholder="0.00"
                    />
                </div>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
                </div>
            </div>
            </CardContent>
        </div>
      </div>
      <CardFooter className="flex-col !p-0">
        <div className="p-4 w-full border-t bg-background">
          <Button
            size="lg"
            className="w-full text-lg h-14"
            onClick={onCheckout}
            disabled={cart.length === 0}
          >
            <DollarSign className="mr-2 h-6 w-6" />
            Checkout
          </Button>
        </div>
      </CardFooter>
    </>
  );
};

export default function RetailPage() {
  const [activeTab, setActiveTab] = useState('catalog');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
  
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);

  const [appointmentsToCheckout, setAppointmentsToCheckout] = useState<any[]>([]);
  const [initialRetailItems, setInitialRetailItems] = useState<any[]>([]);
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const {
    inventory,
    clients,
    services,
    staff,
    walkIns,
    memberships,
    packages,
    discounts,
    appointments: appointmentsFromDB,
    isLoading,
  } = useInventory();

  // Memoized conversion to Date objects
  const liveAppointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => ({
      ...apt,
      startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
      endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
    }));
  }, [appointmentsFromDB]);

  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set<string>());
  
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const readyForCheckoutAppointments = useMemo(() => {
    return (liveAppointments || []).filter(apt => apt.status === 'ready_for_checkout');
  }, [liveAppointments]);

  const payerOptions = useMemo(() => {
    const clientIds = new Set<string>();
    selectedAppointmentIds.forEach(aptId => {
      const apt = readyForCheckoutAppointments.find(a => a.id === aptId);
      if (apt) {
        clientIds.add(apt.clientId);
      }
    });
    return (clients || []).filter(c => clientIds.has(c.id));
  }, [selectedAppointmentIds, readyForCheckoutAppointments, clients]);


  useEffect(() => {
    const newCart: CartItem[] = [];
    
    // Add items from selected appointments
    selectedAppointmentIds.forEach(aptId => {
        const apt = readyForCheckoutAppointments.find(a => a.id === aptId);
        if (!apt) return;
        
        const mainService = services.find(s => s.id === apt.serviceId);
        if (mainService) {
            newCart.push({
                id: `svc-${apt.id}-${mainService.id}`,
                appointmentId: apt.id,
                name: mainService.name,
                price: mainService.price,
                quantity: 1,
                type: 'service',
                staffId: apt.staffId,
            });
        }

        (apt.addOnIds || []).forEach(addOnId => {
            const addOnService = services.find(s => s.id === addOnId);
            if (addOnService) {
                newCart.push({
                    id: `svc-${apt.id}-${addOnService.id}`,
                    appointmentId: apt.id,
                    name: addOnService.name,
                    price: addOnService.price,
                    quantity: 1,
                    type: 'service',
                    staffId: apt.staffId,
                });
            }
        });
    });

    // Keep existing non-appointment items
    const nonAppointmentItems = cart.filter(item => !item.appointmentId);
    setCart([...newCart, ...nonAppointmentItems]);
    
    if (payerOptions.length === 1) {
        setSelectedClientId(payerOptions[0].id);
    } else {
        setSelectedClientId(null);
    }

  }, [selectedAppointmentIds, readyForCheckoutAppointments, services]);


  const retailProducts = useMemo(() => {
    if (!inventory) return [];
    return inventory.filter(
      item => item.type === 'retail' && item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [inventory, searchTerm]);
  
  const updateQuantity = useCallback((itemId: string, newQuantity: number) => {
    const cartItem = cart.find(item => item.id === itemId);
    if (!cartItem) return;

    if (newQuantity <= 0) {
      setCart(cart.filter(item => item.id !== itemId));
    } else if (cartItem.type === 'product' && cartItem.stock && newQuantity > cartItem.stock) {
        toast({
            variant: 'destructive',
            title: 'Not Enough Stock',
            description: `Only ${cartItem.stock} units of ${cartItem.name} are available.`,
        });
    } else {
      setCart(cart.map(item =>
        item.id === itemId ? { ...item, quantity: newQuantity } : item
      ));
    }
  }, [cart, toast]);

  const addToCart = useCallback((item: InventoryItem | Membership | PackageType, type: 'product' | 'membership' | 'package') => {
    const existingItem = cart.find(cartItem => cartItem.id === item.id);
    
    if (type === 'membership') {
        const hasMembership = cart.some(cartItem => cartItem.type === 'membership');
        if (hasMembership) {
            toast({
                variant: 'destructive',
                title: 'Membership Already in Cart',
                description: 'Only one membership can be purchased at a time.',
            });
            return;
        }
    }

    if (existingItem) {
        if (type === 'product' && existingItem.quantity < (item as InventoryItem).totalStock) {
            updateQuantity(item.id, existingItem.quantity + 1);
        } else if (type === 'product') {
            toast({
                variant: 'destructive',
                title: 'Out of Stock',
                description: `No more units of ${item.name} are available.`,
            });
        }
        return;
    }

    let price = 0;
    if (type === 'product') {
        price = (item as InventoryItem).msrp || 0;
    } else {
        price = (item as Membership | PackageType).price;
    }

    const stock = type === 'product' ? (item as InventoryItem).totalStock : Infinity;

    if (stock > 0) {
        setCart(prev => [...prev, {
            id: item.id,
            name: item.name,
            price: price,
            quantity: 1,
            imageUrl: (item as InventoryItem).imageUrl,
            stock: stock,
            type: type,
        }]);
    } else {
         toast({
          variant: 'destructive',
          title: 'Out of Stock',
          description: `${item.name} is currently out of stock.`,
        });
    }
  }, [cart, toast, updateQuantity]);

  const handleAddClient = async (data: ClientFormData) => {
    if (!firestore || !tenantId) return;

    const { referringClientId, ...clientData } = data;
    const firstName = data.name.split(' ')[0].toUpperCase();
    const referralCode = `${firstName}${nanoid(4)}`;

    const newClient: Omit<Client, 'id'> = {
      name: data.name,
      email: data.email || '',
      phone: data.phone || '',
      avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
      lifetimeValue: 0,
      lastAppointment: new Date().toISOString(),
      status: 'active',
      notes: data.notes,
      referralCode: referralCode,
      birthday: data.birthday ? data.birthday.toISOString() : undefined,
      address: data.address,
      emergencyContact: data.emergencyContact,
      intel: {
        referralSource: data.intel?.referralSource
      }
    };
    
    const clientsCollection = collection(firestore, 'tenants', tenantId, 'clients');
    const newClientRef = doc(clientsCollection);
    
    const newClientWithId = { ...newClient, id: newClientRef.id };
    
    await setDoc(newClientRef, newClientWithId);

    if (referringClientId && clients) {
        const referrer = clients.find(c => c.id === referringClientId);
        if (referrer) {
            const referrerDocRef = doc(firestore, `tenants/${tenantId}/clients/${referringClientId}`);
            const updatedReferrals = [...(referrer.successfulReferrals || []), newClient.name];
            updateDocumentNonBlocking(referrerDocRef, { successfulReferrals: updatedReferrals });
        }
    }
        
    setSelectedClientId(newClientWithId.id);

    toast({
      title: "Client Added",
      description: `${data.name} has been added and selected for this sale.`,
    });
    setIsAddClientOpen(false);
  }

  const handleOpenCheckout = () => {
    const serviceAppointmentsInCart = cart.filter(item => item.type === 'service');
    const retailItemsInCart = cart.filter(item => item.type === 'product');

    if (serviceAppointmentsInCart.length > 0) {
      const appointmentIds = new Set(serviceAppointmentsInCart.map(item => item.appointmentId));
      const dataForDialog = readyForCheckoutAppointments
        .filter(apt => appointmentIds.has(apt.id))
        .map(appointment => ({
          appointment,
          client: clients?.find(c => c.id === appointment.clientId),
          service: services?.find(s => s.id === appointment.serviceId),
        }));
      setAppointmentsToCheckout(dataForDialog);
      setInitialRetailItems(retailItemsInCart);
      setIsCheckoutOpen(true);
    } else {
        // Handle pure retail checkout if needed
        setAppointmentsToCheckout([]);
        setInitialRetailItems(retailItemsInCart);
        setIsCheckoutOpen(true);
    }
  };

  const handleCheckoutComplete = (receiptData: Omit<ReceiptData, 'business'>) => {
    // This is the callback after the dialog finishes its own checkout logic
    setCart([]);
    setSelectedAppointmentIds(new Set());
    setReceiptToPrint({
        business: { name: selectedTenant?.name || 'ClarityFlow', phone: '555-123-4567'},
        ...receiptData
    });
  };

  const handleRebook = (appointment: Appointment, weeksOut?: number) => {
    // This would typically navigate to the planner with some state
    // For now, we just log it.
    toast({
      title: 'Rebooking Initiated',
      description: `Rebooking for ${appointment.clientName} in ${weeksOut} weeks.`,
    });
  };
  
  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + item.price * item.quantity, 0), [cart]);
  const client = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);
  const retailTotalForDiscount = useMemo(() => cart.filter(item => item.type === 'product').reduce((acc, item) => acc + item.price * item.quantity, 0), [cart]);
  const [membershipDiscount, setMembershipDiscount] = useState(0);
  const [discount, setDiscount] = useState(0);

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
  const mockTax = subtotalAfterDiscounts * 0.07; // 7% tax for demo
  const [tipAmount, setTipAmount] = useState(0);
  const grandTotal = subtotalAfterDiscounts + mockTax + tipAmount;


  return (
    <>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Retail POS" />
      <main className="flex-1 overflow-hidden">
        <div className="grid lg:grid-cols-3 h-full">
          <div className="lg:col-span-2 flex flex-col h-full">
             <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                <div className="p-4 border-b">
                    <div className="flex items-center gap-4">
                        <TabsList className="grid grid-cols-3 w-full sm:w-auto">
                            <TabsTrigger value="catalog">Catalog</TabsTrigger>
                            <TabsTrigger value="checkout">Checkout</TabsTrigger>
                            <TabsTrigger value="memberships">Offers</TabsTrigger>
                        </TabsList>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search items..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                </div>
                <ScrollArea className="flex-1">
                  <TabsContent value="catalog" className="m-0">
                      {isLoading ? (
                         <div className="flex items-center justify-center p-10"><Loader className="h-6 w-6 animate-spin"/></div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                            {(retailProducts || []).map(product => (
                                <Card key={product.id} onClick={() => addToCart(product, 'product')} className="cursor-pointer hover:shadow-lg transition-shadow">
                                    <CardContent className="p-2 space-y-2">
                                        <div className="relative aspect-square bg-muted rounded-md overflow-hidden">
                                            <Image 
                                                src={product.imageUrl || `https://picsum.photos/seed/inv${product.id}/200/200`} 
                                                alt={product.name} 
                                                fill 
                                                className="object-cover"
                                            />
                                        </div>
                                        <h3 className="text-sm font-medium leading-tight truncate">{product.name}</h3>
                                        <p className="text-sm font-semibold">${(product.msrp || 0).toFixed(2)}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                      )}
                  </TabsContent>
                   <TabsContent value="checkout" className="m-0 p-4">
                      <div className="space-y-4">
                          {readyForCheckoutAppointments.map(apt => {
                            const client = clients?.find(c => c.id === apt.clientId);
                            const service = services?.find(s => s.id === apt.serviceId);
                            const staffForApt = staff?.find(s => s.id === apt.staffId);
                            const addOns = (apt.addOnIds || []).map(id => services?.find(s => s.id === id)).filter(Boolean) as Service[];
                            const totalPrice = (service?.price || 0) + addOns.reduce((acc, s) => acc + s.price, 0);

                            return (
                               <Card
                                  key={apt.id}
                                  className={cn(
                                    "transition-all",
                                    selectedAppointmentIds.has(apt.id) && "border-primary ring-2 ring-primary"
                                  )}
                                >
                                  <Label
                                    htmlFor={`apt-${apt.id}`}
                                    className="flex items-start gap-4 p-4 cursor-pointer"
                                  >
                                    <Checkbox
                                      id={`apt-${apt.id}`}
                                      checked={selectedAppointmentIds.has(apt.id)}
                                      onCheckedChange={() => {
                                        const newSet = new Set(selectedAppointmentIds);
                                        if (newSet.has(apt.id)) {
                                          newSet.delete(apt.id);
                                        } else {
                                          newSet.add(apt.id);
                                        }
                                        setSelectedAppointmentIds(newSet);
                                      }}
                                      className="mt-1"
                                    />
                                    <div className="flex-1 space-y-2">
                                      <div className="flex justify-between items-start">
                                        <div>
                                          <p className="font-semibold">{client?.name || 'Walk-in Client'}</p>
                                          <p className="text-sm text-muted-foreground">{format(apt.startTime, 'h:mm a')}</p>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm">
                                          <Avatar className="w-6 h-6">
                                            <AvatarImage src={staffForApt?.avatarUrl} />
                                            <AvatarFallback>{staffForApt?.name.charAt(0)}</AvatarFallback>
                                          </Avatar>
                                          <span>{staffForApt?.name}</span>
                                        </div>
                                      </div>
                                      <Separator />
                                      <div className="space-y-1 text-sm">
                                        <div className="flex justify-between">
                                          <span>{service?.name}</span>
                                          <span>${service?.price.toFixed(2)}</span>
                                        </div>
                                        {addOns.map(addon => (
                                          <div key={addon.id} className="flex justify-between text-muted-foreground">
                                            <span className="pl-4">+ {addon.name}</span>
                                            <span>${addon.price.toFixed(2)}</span>
                                          </div>
                                        ))}
                                      </div>
                                      <Separator />
                                      <div className="flex justify-between font-semibold">
                                        <span>Total</span>
                                        <span>${totalPrice.toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </Label>
                                </Card>
                            )
                          })}
                      </div>
                  </TabsContent>
                   <TabsContent value="memberships" className="m-0 p-4">
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Memberships</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {memberships.map(membership => (
                                    <MembershipProductCard key={membership.id} membership={membership} onClick={() => addToCart(membership, 'membership')} />
                                ))}
                                </div>
                            </div>
                             <div>
                                <h3 className="text-lg font-semibold mb-2">Packages</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {packages.map(pack => (
                                    <PackageProductCard key={pack.id} pack={pack} onClick={() => addToCart(pack, 'package')} services={services || []} />
                                ))}
                                </div>
                            </div>
                        </div>
                  </TabsContent>
                </ScrollArea>
            </Tabs>
          </div>

          <div className="hidden lg:flex lg:col-span-1 border-l flex-col h-full bg-muted/20">
            <Card className="flex-1 flex flex-col shadow-none border-0 rounded-none">
                <CartContent 
                    cart={cart}
                    selectedClientId={selectedClientId}
                    setSelectedClientId={setSelectedClientId}
                    isAddClientOpen={isAddClientOpen}
                    setIsAddClientOpen={setIsAddClientOpen}
                    subtotal={subtotal}
                    tax={mockTax}
                    tipAmount={tipAmount}
                    setTipAmount={setTipAmount}
                    total={grandTotal}
                    onCheckout={handleOpenCheckout}
                    clients={clients || []}
                    updateQuantity={updateQuantity}
                    discount={discount}
                    membershipDiscount={membershipDiscount}
                    setIsDiscountBrowserOpen={setIsDiscountBrowserOpen}
                    isGroupCheckout={selectedAppointmentIds.size > 0}
                    payerOptions={payerOptions}
                />
            </Card>
          </div>
        </div>
      </main>

        {isMobile && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t lg:hidden">
                 <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                    <SheetTrigger asChild>
                        <Button className="w-full h-14 text-lg" size="lg" disabled={cart.length === 0}>
                            <div className="flex justify-between items-center w-full">
                                <span>{cart.length} item(s)</span>
                                <span>${grandTotal.toFixed(2)}</span>
                            </div>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
                        <SheetTitle className="sr-only">Current Sale</SheetTitle>
                        <CartContent 
                            cart={cart}
                            selectedClientId={selectedClientId}
                            setSelectedClientId={setSelectedClientId}
                            isAddClientOpen={isAddClientOpen}
                            setIsAddClientOpen={setIsAddClientOpen}
                            subtotal={subtotal}
                            tax={mockTax}
                            tipAmount={tipAmount}
                            setTipAmount={setTipAmount}
                            total={grandTotal}
                            onCheckout={handleOpenCheckout}
                            clients={clients || []}
                            updateQuantity={updateQuantity}
                            discount={discount}
                            membershipDiscount={membershipDiscount}
                            setIsDiscountBrowserOpen={setIsDiscountBrowserOpen}
                            isGroupCheckout={selectedAppointmentIds.size > 0}
                            payerOptions={payerOptions}
                        />
                    </SheetContent>
                </Sheet>
            </div>
        )}
    </div>
    <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={handleAddClient} />
    
    <CompleteAppointmentDialog
        open={isCheckoutOpen}
        onOpenChange={setIsCheckoutOpen}
        appointmentsData={appointmentsToCheckout}
        initialRetailItems={initialRetailItems}
        onCheckoutComplete={handleCheckoutComplete}
        onRebook={handleRebook}
    />
    
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
    </>
  );
}

    