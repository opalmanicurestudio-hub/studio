
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
import { Search, Plus, Minus, X, DollarSign, ShoppingCart, CreditCard, Banknote, Gift, QrCode, AlertTriangle } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { type InventoryItem, type StockCorrection, type Transaction } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Image from 'next/image';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  stock: number;
};

export default function RetailPage() {
  const { inventory, addStockCorrection, setTransactions } = useInventory();
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const { toast } = useToast();

  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [tipAmount, setTipAmount] = useState<number>(0);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);


  const retailProducts = useMemo(() => {
    return inventory.filter(
      item => item.type === 'retail' && item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [inventory, searchTerm]);

  const addToCart = (product: InventoryItem) => {
    const existingItem = cart.find(item => item.id === product.id);
    const price = product.costPerUnit ? product.costPerUnit * 1.75 : 0; // Mocked markup

    if (existingItem) {
      if (existingItem.quantity < product.totalStock) {
        setCart(cart.map(item =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        ));
      } else {
        toast({
          variant: 'destructive',
          title: 'Out of Stock',
          description: `No more units of ${product.name} are available.`,
        });
      }
    } else {
      if (product.totalStock > 0) {
        setCart([...cart, {
          id: product.id,
          name: product.name,
          price: price,
          quantity: 1,
          imageUrl: product.imageUrl,
          stock: product.totalStock,
        }]);
      } else {
         toast({
          variant: 'destructive',
          title: 'Out of Stock',
          description: `${product.name} is currently out of stock.`,
        });
      }
    }
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    const cartItem = cart.find(item => item.id === productId);
    if (!cartItem) return;

    if (newQuantity <= 0) {
      setCart(cart.filter(item => item.id !== productId));
    } else if (newQuantity > cartItem.stock) {
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
  const tax = subtotal * 0.07; // Mock tax
  const total = subtotal + tax + tipAmount;

  const handleCheckout = () => {
    if (cart.length === 0) {
        toast({ variant: 'destructive', title: 'Empty Cart', description: 'Please add items to the cart before checking out.'});
        return;
    };

    // 1. Create Stock Corrections
    cart.forEach(item => {
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

    // 2. Create Transaction
    const newTransaction: Omit<Transaction, 'id'> = {
        date: new Date().toISOString(),
        description: `Retail Sale (${cart.length} items)`,
        clientOrVendor: 'In-Store Customer',
        type: 'income',
        context: 'Business',
        category: 'Retail',
        amount: total,
        paymentMethod: paymentTab,
        hasReceipt: false,
    };
    setTransactions(prev => [...prev, { ...newTransaction, id: `txn-${Date.now()}` }]);

    toast({
        title: 'Sale Complete!',
        description: `Successfully processed a sale of $${total.toFixed(2)}. Inventory has been updated.`
    });

    // 3. Reset State
    setCart([]);
    setAmountTendered(0);
    setTipAmount(0);
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
            description: 'Please enable camera permissions in your browser settings to use this app.',
          });
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


  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Retail POS" />
      <main className="flex-1 overflow-hidden">
        <div className="grid lg:grid-cols-3 h-full">
          {/* Product Browser */}
          <div className="lg:col-span-2 flex flex-col h-full">
            <div className="p-4 border-b flex items-center gap-2">
                 <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search products..." 
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                 <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                    <QrCode className="h-4 w-4" />
                    <span className="sr-only">Scan</span>
                </Button>
            </div>
            <ScrollArea className="flex-1">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                    {retailProducts.map(product => (
                        <Card key={product.id} onClick={() => addToCart(product)} className="cursor-pointer hover:shadow-lg transition-shadow">
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
            </ScrollArea>
          </div>

          {/* Cart & Checkout */}
          <div className="lg:col-span-1 border-l flex flex-col h-full bg-muted/20">
            <Card className="flex-1 flex flex-col shadow-none border-0 rounded-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Current Sale</CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 px-6">
                {cart.length > 0 ? (
                    <div className="space-y-4">
                        {cart.map(item => (
                            <div key={item.id} className="flex items-center gap-4">
                                <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={48} height={48} className="rounded-md" />
                                <div className="flex-1">
                                    <p className="text-sm font-medium truncate">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">${item.price.toFixed(2)}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                                    <Input type="number" value={item.quantity} onChange={(e) => updateQuantity(item.id, parseInt(e.target.value) || 0)} className="w-12 h-8 text-center" />
                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, item.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => updateQuantity(item.id, 0)}><X className="h-4 w-4" /></Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-16">
                        <p>No items in cart.</p>
                    </div>
                )}
              </ScrollArea>
              <CardFooter className="flex-col !p-0">
                <div className="p-6 w-full space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tax (7%)</span>
                        <span>${tax.toFixed(2)}</span>
                    </div>
                     <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tip</span>
                         <Input type="number" value={tipAmount || ''} onChange={e => setTipAmount(parseFloat(e.target.value) || 0)} className="w-20 h-7 text-right" placeholder="0.00" />
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-bold text-lg">
                        <span>Total</span>
                        <span>${total.toFixed(2)}</span>
                    </div>
                </div>
                 <Tabs value={paymentTab} onValueChange={setPaymentTab} className="w-full border-t p-4">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="card"><CreditCard className="w-4 h-4 mr-2"/>Card</TabsTrigger>
                        <TabsTrigger value="cash"><Banknote className="w-4 h-4 mr-2"/>Cash</TabsTrigger>
                        <TabsTrigger value="other"><Gift className="w-4 h-4 mr-2"/>Other</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="p-4 w-full border-t bg-background">
                     <Button size="lg" className="w-full text-lg h-14" onClick={handleCheckout}>
                        <DollarSign className="mr-2 h-6 w-6" />
                        Charge ${total.toFixed(2)}
                    </Button>
                </div>
              </CardFooter>
            </Card>
          </div>
        </div>
      </main>

       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Product</DialogTitle>
            <DialogDescription>
              Position the product's barcode or QR code inside the frame.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 relative">
             <video ref={videoRef} className="w-full aspect-video rounded-md" autoPlay muted playsInline />
             <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-1/2 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please allow camera access to use this feature.
                    </AlertDescription>
                </Alert>
            )}
          </div>
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
