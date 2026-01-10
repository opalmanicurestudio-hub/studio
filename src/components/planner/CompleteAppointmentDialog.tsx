
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
import { AlertCircle, CheckCircle, FileText, FlaskConical, PlusCircle, Trash2, Library, Wand, QrCode, Search, AlertTriangle, ShoppingCart, CreditCard, Banknote, Gift, Coins } from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type StockCorrection, type CustomFormula } from '@/lib/data';
import { format } from 'date-fns';
import { Input } from '../ui/input';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';

// --- Start of PrintReceipt Component ---
export interface ReceiptData {
  business: {
    name: string;
    phone: string;
  };
  clientName: string;
  date: Date;
  items: {
    name: string;
    quantity: number;
    price: number;
  }[];
  subtotal: number;
  tax: number;
  total: number;
  payment: {
    method: string;
    amountTendered: number;
    changeDue: number;
  };
}

interface PrintReceiptProps {
  data: ReceiptData;
}

export const PrintReceipt: React.FC<PrintReceiptProps> = ({ data }) => {
  return (
    <div id="receipt" className="p-4 bg-white text-black font-mono text-sm max-w-sm mx-auto">
      <div className="text-center space-y-1 mb-6">
        <h1 className="text-xl font-bold">{data.business.name}</h1>
        <p>{data.business.phone}</p>
        <p>{format(data.date, 'MMM d, yyyy h:mm a')}</p>
      </div>

      <div className="mb-4">
        <p>
          <span className="font-semibold">Client:</span> {data.clientName}
        </p>
      </div>

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-2">
        {data.items.map((item, index) => (
          <div key={index} className="flex justify-between">
            <div>
              <p>{item.name}</p>
              {item.quantity > 1 && <p className="pl-4 text-xs">({item.quantity} @ ${item.price.toFixed(2)})</p>}
            </div>
            <p>${(item.quantity * item.price).toFixed(2)}</p>
          </div>
        ))}
      </div>

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <p>Subtotal</p>
          <p>${data.subtotal.toFixed(2)}</p>
        </div>
        <div className="flex justify-between">
          <p>Tax</p>
          <p>${data.tax.toFixed(2)}</p>
        </div>
        <div className="flex justify-between font-bold text-base">
          <p>Total</p>
          <p>${data.total.toFixed(2)}</p>
        </div>
      </div>

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <p>Payment Method</p>
          <p>{data.payment.method}</p>
        </div>
        <div className="flex justify-between">
          <p>Amount Tendered</p>
          <p>${data.payment.amountTendered.toFixed(2)}</p>
        </div>
        <div className="flex justify-between">
          <p>Change Due</p>
          <p>${data.payment.changeDue.toFixed(2)}</p>
        </div>
      </div>

      <div className="text-center mt-8">
        <p>Thank you for your business!</p>
      </div>
      
       <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #receipt, #receipt * {
            visibility: visible;
          }
          #receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};
// --- End of PrintReceipt Component ---


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
  onConfirmCheckout: (updatedInventory: InventoryItem[], newCorrections: StockCorrection[]) => void;
}

export const CompleteAppointmentDialog: React.FC<CompleteAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onConfirmCheckout,
}) => {
  const { inventory } = useInventory();
  const { appointment, client, service } = appointmentData;
  const [formulaName, setFormulaName] = useState('Default Service Formula');
  const { toast } = useToast();

  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);
  
  const [amountTendered, setAmountTendered] = useState<number>(0);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);


  useEffect(() => {
    if (open && service) {
        const defaultFormula = service.products?.map(p => ({
            id: p.id,
            name: p.name,
            quantity: p.quantityUsed,
            unit: p.unit || 'uses',
            costPerUnit: p.costPerUnit || 0,
        })) || [];
        setEditableFormula(defaultFormula);
        setRetailItems([]);
        setFormulaName('Default Service Formula');
        setAmountTendered(0);
        setReceiptData(null);
    }
  }, [service, open]);

  const { actualCost, additionalCost } = useMemo(() => {
    const cost = editableFormula.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
    const additional = service ? cost - service.cost : cost;
    return { actualCost: cost, additionalCost: additional > 0 ? additional : 0 };
  }, [editableFormula, service]);

  const retailTotal = useMemo(() => {
    return retailItems.reduce((acc, item) => {
        const product = inventory.find(p => p.id === item.id);
        const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0; // Mocked markup
        return acc + (item.quantity * price);
    }, 0);
  }, [retailItems, inventory]);
  
  const subtotal = (service?.price || 0) + retailTotal;
  const mockTax = subtotal * 0.07; // 7% tax for demo
  const grandTotal = subtotal + mockTax;
  
  const changeDue = amountTendered > 0 ? amountTendered - grandTotal : 0;

  const handleQuantityChange = (productId: string, newQuantity: number) => {
    setEditableFormula(prev => prev.map(item => item.id === productId ? { ...item, quantity: newQuantity } : item));
  };
  
  const handleRetailQuantityChange = (productId: string, newQuantity: number) => {
    setRetailItems(prev => prev.map(item => item.id === productId ? { ...item, quantity: newQuantity } : item));
  };
  
  const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id,
        name: p.name,
        quantity: 1, // Default quantity, user can edit
        unit: p.unit || 'unit',
        costPerUnit: p.costPerUnit || 0,
        isCustom: true,
      }));
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
  };

  const handleAddRetail = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id,
        name: p.name,
        quantity: 1,
        unit: 'unit',
        costPerUnit: p.costPerUnit || 0,
      }));
      setRetailItems(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
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
            id: item.productId,
            name: item.productName,
            quantity: item.quantityUsed,
            unit: item.unit,
            costPerUnit: product?.costPerUnit || 0,
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
  
  const handleCompleteAndPrint = () => {
    if (!client || !service) return;

    onConfirmCheckout(updatedInventory, newCorrections)

    const finalReceiptData: ReceiptData = {
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        clientName: client.name,
        date: new Date(),
        items: [
            { name: service.name, quantity: 1, price: service.price },
            ...retailItems.map(item => {
                const product = inventory.find(p => p.id === item.id);
                const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
                return { name: item.name, quantity: item.quantity, price: price };
            }),
        ],
        subtotal: subtotal,
        tax: mockTax,
        total: grandTotal,
        payment: {
            method: 'Cash', // This would be dynamic
            amountTendered: amountTendered || grandTotal,
            changeDue: changeDue > 0 ? changeDue : 0,
        }
    };
    setReceiptData(finalReceiptData);
    
    // Defer print action to allow state to update and component to render
    setTimeout(() => {
      window.print();
      onOpenChange(false);
    }, 100);
  };


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


  if (!client || !service) {
    return null;
  }
  
  if (receiptData) {
      return <PrintReceipt data={receiptData} />;
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
                              <CardTitle>Service Formula & Usage</CardTitle>
                              <CardDescription>What was actually used for this service?</CardDescription>
                          </div>
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
                  </CardHeader>
                  <CardContent className="space-y-3">
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
                  <CardDescription>Add any products the client is purchasing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
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
                      <CardTitle>Payment & Checkout</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="p-4 rounded-lg bg-primary/10 text-center">
                          <p className="text-sm font-medium text-primary">Total Due</p>
                          <p className="text-5xl font-bold text-primary">${grandTotal.toFixed(2)}</p>
                      </div>
                      <Tabs defaultValue="card" className="w-full">
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
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleCompleteAndPrint} disabled={warnings.some(w => w.includes('Insufficient stock'))}>
              Complete & Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        initialSelected={[]}
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
                <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            {hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                        Please allow camera access to use the scanner. You may need to change permissions in your browser settings.
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
