

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, Minus, X, DollarSign, ShoppingCart, CreditCard, Banknote, Gift, QrCode, AlertTriangle, UserPlus, Coins, Printer, Wallet, Award, Repeat, CheckCircle, Percent } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { type InventoryItem, type StockCorrection, type Transaction, type Client, type Appointment, type Service, type AppointmentCheckoutState, Membership, Package, type ClientFormData } from '@/lib/data';
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


type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  stock: number;
  type: 'product' | 'membership' | 'package';
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
                                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                    <span className="truncate">1x {p.name}</span>
                                </li>
                            ))}
                            {membership.retailDiscount && (
                                 <li className="flex items-center gap-1.5">
                                    <Percent className="w-3 h-3 text-blue-500 flex-shrink-0" />
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


const PackageProductCard = ({ pack, onClick, services }: { pack: Package; onClick: () => void; services: Service[] }) => {
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
    paymentTab,
    setPaymentTab,
    amountTendered,
    changeDue,
    handleKeepTheChange,
    denominations,
    handleDenominationClick,
    setAmountTendered,
    handleCheckout,
    clients,
    updateQuantity,
    discount,
    setDiscount,
    promoCode,
    setPromoCode,
    handleApplyPromo,
    appliedStoreCredit,
    setAppliedStoreCredit,
}: any) => {
    
  const selectedClient = useMemo(() => {
    return clients.find((c: Client) => c.id === selectedClientId);
  }, [selectedClientId, clients]);

  const maxCreditToApply = Math.min(selectedClient?.walletCredit || 0, total);

  const handleApplyCredit = () => {
    setAppliedStoreCredit(maxCreditToApply);
  }

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
              value={selectedClientId || 'walk-in'}
              onValueChange={(value) => {
                if (value === 'walk-in') {
                  setSelectedClientId(null);
                } else {
                  setSelectedClientId(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Walk-in Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                {clients.map((c: Client) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
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
                    <Image
                        src={
                        item.imageUrl ||
                        `https://picsum.photos/seed/inv${item.id}/100/100`
                        }
                        alt={item.name}
                        width={48}
                        height={48}
                        className="rounded-md"
                    />
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
                <div className="space-y-2">
                <Label htmlFor="promo-code">Promo Code</Label>
                <div className="flex gap-2">
                    <Input
                    id="promo-code"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    placeholder="e.g., NEWCLIENT15"
                    />
                    <Button variant="outline" onClick={handleApplyPromo}>
                    Apply
                    </Button>
                </div>
                </div>
                <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                <div className="flex justify-between text-sm text-primary font-medium">
                    <span>Discount:</span>
                    <span>-${discount.toFixed(2)}</span>
                </div>
                )}
                <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax (7%)</span>
                <span>${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Tip</span>
                <div className="relative w-24">
                    <DollarSignIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                {appliedStoreCredit > 0 && (
                <div className="flex justify-between text-sm font-medium text-primary">
                    <span>Store Credit Used</span>
                    <span>-${appliedStoreCredit.toFixed(2)}</span>
                </div>
                )}
                <Separator className="my-2" />
                <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
                </div>
            </div>

            <Tabs
                value={paymentTab}
                onValueChange={setPaymentTab}
                className="w-full"
            >
                <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="card">
                    <CreditCard className="w-4 h-4 mr-2" />
                    Card
                </TabsTrigger>
                <TabsTrigger value="cash">
                    <Banknote className="w-4 h-4 mr-2" />
                    Cash
                </TabsTrigger>
                <TabsTrigger value="other">
                    <Gift className="w-4 h-4 mr-2" />
                    Other
                </TabsTrigger>
                </TabsList>
                <TabsContent value="cash" className="pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                    <Label>Amount Tendered</Label>
                    <div className='p-4 text-2xl font-bold text-center bg-background rounded-md border'>
                        ${amountTendered.toFixed(2)}
                    </div>
                    </div>
                    <div className="space-y-2">
                    <Label>Change Due</Label>
                    <div
                        className={`p-4 text-2xl font-bold text-center rounded-md ${
                        changeDue >= 0
                            ? 'bg-green-500/10 text-green-600'
                            : 'bg-red-500/10 text-red-600'
                        }`}
                    >
                        ${Math.abs(changeDue).toFixed(2)}
                    </div>
                    </div>
                </div>
                {changeDue > 0 && (
                    <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleKeepTheChange}
                    >
                    <Coins className="w-4 h-4 mr-2" /> Keep the Change as Tip
                    </Button>
                )}
                <div className="grid grid-cols-5 gap-2">
                    {denominations.map((amount: number) => (
                    <Button
                        key={amount}
                        variant="outline"
                        onClick={() => handleDenominationClick(amount)}
                    >
                        {amount >= 1 ? `$${amount}` : `${amount * 100}¢`}
                    </Button>
                    ))}
                </div>
                <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setAmountTendered(0)}
                >
                    Clear
                </Button>
                </TabsContent>
                <TabsContent value="other" className="pt-4 space-y-4">
                {selectedClient && (selectedClient.walletCredit || 0) > 0 ? (
                    <div className="p-4 rounded-lg bg-muted/50 text-center space-y-3">
                    <p className="text-sm">
                        Client has{' '}
                        <span className="font-bold text-primary">
                        ${(selectedClient.walletCredit || 0).toFixed(2)}
                        </span>{' '}
                        in store credit.
                    </p>
                    <Button
                        variant="secondary"
                        onClick={handleApplyCredit}
                        disabled={appliedStoreCredit > 0 || total <= 0}
                    >
                        Apply ${maxCreditToApply.toFixed(2)} to this sale
                    </Button>
                    </div>
                ) : (
                    <p className="text-sm text-center text-muted-foreground p-4">
                    No store credit available.
                    </p>
                )}
                </TabsContent>
            </Tabs>
            </CardContent>
        </div>
      </div>
      <CardFooter className="flex-col !p-0">
        <div className="p-4 w-full border-t bg-background">
          <Button
            size="lg"
            className="w-full text-lg h-14"
            onClick={handleCheckout}
            disabled={total < 0}
          >
            <DollarSignIcon className="mr-2 h-6 w-6" />
            Charge ${total > 0 ? total.toFixed(2) : '0.00'}
          </Button>
        </div>
      </CardFooter>
    </>
  );
};

export default function RetailPage() {
  const { inventory, appointments, services, addStockCorrection, setTransactions, setClients, clients, setAppointments, memberships, packages } = useInventory();
  const [activeTab, setActiveTab] = useState('products');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [discount, setDiscount] = useState(0);
  const [promoCode, setPromoCode] = useState('');
  
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scannedData, setScannedData] = useState<string | null>(null);
  
  const [checkoutAppointment, setCheckoutAppointment] = useState<Appointment | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  
  const [appliedStoreCredit, setAppliedStoreCredit] = useState(0);

  const retailProducts = useMemo(() => {
    return inventory.filter(
      item => item.type === 'retail' && item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [inventory, searchTerm]);

  const addToCart = (item: InventoryItem | Membership | Package, type: 'product' | 'membership' | 'package') => {
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
        price = (item as InventoryItem).costPerUnit ? (item as InventoryItem).costPerUnit! * 1.75 : 0;
    } else {
        price = (item as Membership | Package).price;
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
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    const cartItem = cart.find(item => item.id === productId);
    if (!cartItem) return;

    if (newQuantity <= 0) {
      setCart(cart.filter(item => item.id !== productId));
    } else if (cartItem.type === 'product' && newQuantity > cartItem.stock) {
        toast({
            variant: 'destructive',
            title: 'Not Enough Stock',
            description: `Only ${cartItem.stock} units of ${cartItem.name} are available.`,
        });
    } else {
      setCart(cart.map(item =>
        item.id === productId ? { ...item, quantity: newQuantity } : item
      ));
    }
  };

  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + item.price * item.quantity, 0), [cart]);
  const tax = (subtotal - discount) * 0.07; // Mock tax
  const total = subtotal - discount - appliedStoreCredit + tax + tipAmount;
  const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - total : 0;

  const handleApplyPromo = () => {
    const selectedClient = clients.find(c => c.id === selectedClientId);
    const service = services.find(s => s.id === appointments[0]?.serviceId);
    if (promoCode === 'NEWCLIENT15' && selectedClient && service && selectedClient.lifetimeValue < (service?.price || 0)) {
        setDiscount(15);
        toast({
            title: "Discount Applied!",
            description: "$15.00 new client discount has been applied.",
        })
    } else {
        toast({
            variant: "destructive",
            title: "Invalid Code",
            description: "This promo code is not valid for this client or appointment.",
        })
    }
  }

  const handleRetailCheckout = () => {
    const hasMembershipOrPackage = cart.some(item => item.type === 'membership' || item.type === 'package');
    
    if (hasMembershipOrPackage && !selectedClientId) {
      toast({
        variant: 'destructive',
        title: 'Client Required',
        description: 'Please select or create a client profile to sell memberships or packages.',
      });
      return;
    }

    if (cart.length === 0) {
        toast({ variant: 'destructive', title: 'Empty Cart', description: 'Please add items to the cart before checking out.'});
        return;
    };
    
    const selectedClient = clients.find(c => c.id === selectedClientId);

    // Handle product stock corrections
    const productItems = cart.filter(item => item.type === 'product');
    productItems.forEach(item => {
        const newCorrection: StockCorrection = {
            id: `sc-${Date.now()}-${item.id}`,
            productId: item.id,
            date: new Date().toISOString(),
            change: -item.quantity,
            unit: 'unit',
            reason: `Retail Sale #${Date.now().toString().slice(-4)}`
        };
        addStockCorrection(newCorrection);
    });
    
    // Create transaction
    const newTransaction: Omit<Transaction, 'id'> = {
        date: new Date().toISOString(),
        description: `Retail Sale (${cart.map(i => i.name).join(', ')})`,
        clientOrVendor: selectedClient?.name || 'In-Store Customer',
        type: 'income',
        context: 'Business',
        category: 'Retail',
        amount: total,
        paymentMethod: paymentTab,
        hasReceipt: true,
    };
    setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);
    
    // Update Client State
    if (selectedClient) {
        const membershipItem = cart.find(item => item.type === 'membership');
        const packageItems = cart.filter(item => item.type === 'package');

        let updatedClient = { ...selectedClient };
        
        if (appliedStoreCredit > 0) {
            updatedClient.walletCredit = (updatedClient.walletCredit || 0) - appliedStoreCredit;
        }

        if (membershipItem) {
            updatedClient.activeMembershipId = membershipItem.id;
        }

        if (packageItems.length > 0) {
            const newPackages = packageItems.map(p => {
                const pack = packages.find(pkg => pkg.id === p.id);
                return {
                    packageId: p.id,
                    sessionsRemaining: pack?.sessions || 0,
                };
            });
            updatedClient.activePackages = [...(updatedClient.activePackages || []), ...newPackages];
        }

        setClients(prevClients => prevClients.map(c => c.id === updatedClient.id ? updatedClient : c));
    }


     const receiptData: Omit<ReceiptData, 'business'> = {
        clientName: selectedClient?.name || 'In-Store Customer',
        date: new Date(),
        items: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
        })),
        subtotal: subtotal,
        tax: tax,
        tip: tipAmount,
        total: total,
        payment: {
            method: paymentTab,
            amountTendered: paymentTab === 'cash' ? amountTendered : total,
            changeDue: changeDue > 0 ? changeDue : 0,
        }
    };
    
    setReceiptToPrint({
      business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
      ...receiptData
    });

    toast({
        title: 'Sale Complete!',
        description: `Successfully processed a sale of $${total.toFixed(2)}. Inventory has been updated.`
    });

    // Reset State
    setCart([]);
    setAmountTendered(0);
    setTipAmount(0);
    setSelectedClientId(null);
    setIsCartSheetOpen(false);
    setDiscount(0);
    setPromoCode('');
    setAppliedStoreCredit(0);
  };
  
    useEffect(() => {
        if (scannedData) {
            handleScan(scannedData);
            setScannedData(null); // Reset after processing
        }
    }, [scannedData]);
    
    const handleScan = (data: string) => {
        if (data.startsWith('clarityflow://walk-in/')) {
            const walkInId = data.split('/').pop();
            const appointmentId = `apt-walkin-${walkInId}`;
            const appointmentToCheckout = appointments.find(apt => apt.id === appointmentId);

            if (appointmentToCheckout) {
                setCheckoutAppointment(appointmentToCheckout);
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Appointment Not Found',
                    description: 'Could not find a matching walk-in appointment.',
                });
            }
        } else if (data.startsWith('clarityflow://product/')) {
            const productId = data.split('/').pop();
            const productToAdd = inventory.find(p => p.id === productId);
            if (productToAdd) {
                addToCart(productToAdd, 'product');
                toast({ title: 'Product Added', description: `${productToAdd.name} added to cart.` });
            }
        }
    };
  
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
    };

    const handleKeepTheChange = () => {
        if (changeDue > 0) {
            setTipAmount(prevTip => prevTip + changeDue);
            setAmountTendered(total + changeDue); 
            toast({ title: "Tip Added!", description: `$${changeDue.toFixed(2)} has been added as a tip.` });
        }
    };
    
    const handleAppointmentCheckout = (data: CheckoutData) => {
        if (!checkoutAppointment) return;

        const {
            newCorrections,
            receiptData,
            incident,
            serviceStaffOverrides,
            tipAllocations,
            addOns,
            absorbedCost,
        } = data;
        
        const allPerformedServices = [services.find(s => s.id === checkoutAppointment.serviceId), ...addOns].filter((s): s is Service => !!s);
        
        allPerformedServices.forEach(service => {
            const staffId = serviceStaffOverrides[service.id] || checkoutAppointment.staffId;
            const newTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Service: ${service.name}`,
                clientOrVendor: clients.find(c => c.id === checkoutAppointment.clientId)?.name || 'N/A',
                type: 'income',
                context: 'Business',
                category: 'Service Revenue',
                amount: service.price,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: staffId,
                appointmentId: checkoutAppointment.id,
            };
            setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);
        });
        
        Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
            if (tipAmount > 0) {
                const newTransaction: Omit<Transaction, 'id'> = {
                    date: new Date().toISOString(),
                    description: `Tip for Appointment #${checkoutAppointment.id.slice(-4)}`,
                    clientOrVendor: clients.find(c => c.id === checkoutAppointment.clientId)?.name || 'N/A',
                    type: 'income',
                    context: 'Business',
                    category: 'Tips',
                    amount: tipAmount,
                    paymentMethod: receiptData.payment.method,
                    hasReceipt: true,
                    staffId: staffId,
                    tipAmount: tipAmount,
                    appointmentId: checkoutAppointment.id,
                };
                 setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);
            }
        });
        
        newCorrections.forEach(addStockCorrection);
        
        const completedAppointment: Appointment = { 
            ...checkoutAppointment, 
            status: 'completed' as const,
            absorbedCost: absorbedCost,
            incident: incident,
        };
        setAppointments(prev => prev.map(apt => apt.id === checkoutAppointment.id ? completedAppointment : apt));
        
        toast({
            title: "Appointment Completed",
            description: `Inventory levels have been updated and financial transactions logged.`
        });
        
        setCheckoutAppointment(null);
        setReceiptToPrint({
            business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
            ...receiptData
        });
    };

      const handleAddClient = (data: ClientFormData) => {
        const { referringClientId } = data;
        
        const firstName = data.name.split(' ')[0].toUpperCase();
        const referralCode = `${firstName}${nanoid(4)}`;

        const newClient: Client = {
          id: `cli-${nanoid()}`,
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          avatarUrl: data.avatarUrl || '',
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
        
        let updatedClients = [...clients];
        
        if (referringClientId) {
            const referrerIndex = updatedClients.findIndex(c => c.id === referringClientId);
            if (referrerIndex !== -1) {
                const referrer = { ...updatedClients[referrerIndex] };
                
                newClient.referredBy = referrer.name;

                referrer.successfulReferrals = [...(referrer.successfulReferrals || []), newClient.name];
                
                updatedClients[referrerIndex] = referrer;
            }
        }
        
        updatedClients.push(newClient);
        
        setClients(updatedClients);
        setSelectedClientId(newClient.id);

        toast({
          title: "Client Added",
          description: `${newClient.name} has been added to your client list and selected.`,
        });
        setIsAddClientOpen(false);
    }
    
    const checkoutAppointmentData = useMemo(() => {
        if (!checkoutAppointment) return null;
        const clientData = clients.find(c => c.id === checkoutAppointment.clientId);
        const serviceData = services.find(s => s.id === checkoutAppointment.serviceId);

        const walkInClientName = checkoutAppointment.isWalkIn ?
          (inventory.find(i => `apt-walkin-${i.id}` === checkoutAppointment.id) as any)?.customerName || 'Walk-in'
          : 'Unknown Client';

        const displayClient = clientData || {
          id: checkoutAppointment.clientId,
          name: checkoutAppointment.isWalkIn ? walkInClientName : 'Unknown Client',
          email: '', phone: '', avatarUrl: '', lifetimeValue: 0, lastAppointment: '',
        };
        
        return {
          appointment: checkoutAppointment,
          client: displayClient,
          service: serviceData,
        };
    }, [checkoutAppointment, clients, services, inventory]);


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
                        <TabsList>
                            <TabsTrigger value="products">Products</TabsTrigger>
                            <TabsTrigger value="memberships">Memberships</TabsTrigger>
                            <TabsTrigger value="packages">Packages</TabsTrigger>
                        </TabsList>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search items..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                        <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                            <QrCode className="h-4 w-4" />
                            <span className="sr-only">Scan</span>
                        </Button>
                    </div>
                </div>
                <ScrollArea className="flex-1">
                  <TabsContent value="products" className="m-0">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                          {retailProducts.map(product => (
                              <Card key={product.id} onClick={() => addToCart(product, 'product')} className="cursor-pointer hover:shadow-lg transition-shadow">
                                  <CardContent className="p-2 space-y-2">
                                      <div className="aspect-square bg-muted rounded-md overflow-hidden">
                                          <Image src={product.imageUrl || `https://picsum.photos/seed/inv${product.id}/200/200`} alt={product.name} width={200} height={200} className="object-cover h-full w-full" />
                                      </div>
                                      <h3 className="text-sm font-medium leading-tight truncate">{product.name}</h3>
                                      <p className="text-sm font-semibold">${(product.costPerUnit || 0 * 1.75).toFixed(2)}</p>
                                  </CardContent>
                              </Card>
                          ))}
                      </div>
                  </TabsContent>
                   <TabsContent value="memberships" className="m-0">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                          {memberships.map(membership => (
                              <MembershipProductCard key={membership.id} membership={membership} onClick={() => addToCart(membership, 'membership')} />
                          ))}
                      </div>
                  </TabsContent>
                  <TabsContent value="packages" className="m-0">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                          {packages.map(pack => (
                              <PackageProductCard key={pack.id} pack={pack} onClick={() => addToCart(pack, 'package')} services={services} />
                          ))}
                      </div>
                  </TabsContent>
                </ScrollArea>
            </Tabs>
          </div>

          {/* Cart & Checkout */}
          <div className="hidden lg:flex lg:col-span-1 border-l flex-col h-full bg-muted/20">
            <Card className="flex-1 flex flex-col shadow-none border-0 rounded-none">
                <CartContent 
                    cart={cart}
                    selectedClientId={selectedClientId}
                    setSelectedClientId={setSelectedClientId}
                    isAddClientOpen={isAddClientOpen}
                    setIsAddClientOpen={setIsAddClientOpen}
                    subtotal={subtotal}
                    tax={tax}
                    tipAmount={tipAmount}
                    setTipAmount={setTipAmount}
                    total={total}
                    paymentTab={paymentTab}
                    setPaymentTab={setPaymentTab}
                    amountTendered={amountTendered}
                    changeDue={changeDue}
                    handleKeepTheChange={handleKeepTheChange}
                    denominations={denominations}
                    handleDenominationClick={handleDenominationClick}
                    setAmountTendered={setAmountTendered}
                    handleCheckout={handleRetailCheckout}
                    clients={clients}
                    updateQuantity={updateQuantity}
                    discount={discount}
                    setDiscount={setDiscount}
                    promoCode={promoCode}
                    setPromoCode={setPromoCode}
                    handleApplyPromo={handleApplyPromo}
                    appliedStoreCredit={appliedStoreCredit}
                    setAppliedStoreCredit={setAppliedStoreCredit}
                />
            </Card>
          </div>
        </div>
      </main>

        {isMobile && cart.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t lg:hidden">
                 <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                    <SheetTrigger asChild>
                        <Button className="w-full h-14 text-lg" size="lg">
                            <div className="flex justify-between items-center w-full">
                                <span>{cart.length} item(s)</span>
                                <span>${total.toFixed(2)}</span>
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
                            tax={tax}
                            tipAmount={tipAmount}
                            setTipAmount={setTipAmount}
                            total={total}
                            paymentTab={paymentTab}
                            setPaymentTab={setPaymentTab}
                            amountTendered={amountTendered}
                            changeDue={changeDue}
                            handleKeepTheChange={handleKeepTheChange}
                            denominations={denominations}
                            handleDenominationClick={handleDenominationClick}
                            setAmountTendered={setAmountTendered}
                            handleCheckout={handleRetailCheckout}
                            clients={clients}
                            updateQuantity={updateQuantity}
                            discount={discount}
                            setDiscount={setDiscount}
                            promoCode={promoCode}
                            setPromoCode={setPromoCode}
                            handleApplyPromo={handleApplyPromo}
                            appliedStoreCredit={appliedStoreCredit}
                            setAppliedStoreCredit={setAppliedStoreCredit}
                        />
                    </SheetContent>
                </Sheet>
            </div>
        )}

       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Code</DialogTitle>
            <DialogDescription>
              Position a product barcode or appointment ticket QR code inside the frame.
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
    </div>
    <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients} onSave={handleAddClient} />
    
    {checkoutAppointmentData && (
        <CompleteAppointmentDialog
            open={!!checkoutAppointment}
            onOpenChange={() => setCheckoutAppointment(null)}
            appointmentData={checkoutAppointmentData}
            onConfirmCheckout={handleAppointmentCheckout}
        />
    )}

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
