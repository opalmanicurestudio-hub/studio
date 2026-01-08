
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal, Database, Camera, AlertTriangle, Truck, Search, SlidersHorizontal, QrCode, Package, Hammer, Beaker, FlaskConical, Pencil, Rocket, CheckCircle, Trash2, Edit, MapPin, Printer } from 'lucide-react';
import { type InventoryItem } from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { AddLocationDialog, type Location } from '@/components/inventory/AddLocationDialog';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';


const ProductCard = ({ item }: { item: InventoryItem }) => {
    return (
        <Card className="w-full shrink-0">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className='flex items-start gap-3'>
                        <div className='w-14 h-14 bg-muted rounded-md flex-shrink-0'>
                            <Image src={item.id ? `https://picsum.photos/seed/inv${item.id}/100/100` : ''} alt={item.name} width={56} height={56} className='rounded-md' data-ai-hint="product photo"/>
                        </div>
                        <div className='flex-1'>
                            <p className="font-semibold text-base leading-snug">{item.name}</p>
                            <p className="text-sm text-muted-foreground">{item.type}</p>
                        </div>
                    </div>
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" className="-mt-1 h-8 w-8 flex-shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem><Rocket className="mr-2 h-4 w-4" /> Start/End Experiment</DropdownMenuItem>
                        <DropdownMenuItem><AlertTriangle className="mr-2 h-4 w-4" /> Write-off / Damage</DropdownMenuItem>
                         <DropdownMenuItem><QrCode className="mr-2 h-4 w-4" /> Reorder</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                 <div className="flex items-center justify-between text-sm">
                     <Badge variant="outline" className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" />
                        Back Room
                    </Badge>
                </div>
                
                <Card className='bg-muted/50'>
                    <CardContent className='p-3 text-center'>
                        <p className='text-xs text-muted-foreground'>Total On Hand</p>
                        <p className='text-3xl font-bold'>{item.stock}</p>
                        <p className='text-xs text-muted-foreground'>30 uses left in open container</p>
                    </CardContent>
                </Card>

                <div className='space-y-2'>
                    <Button variant='secondary' className='w-full bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-400 dark:hover:bg-yellow-900/60 dark:border-yellow-600/30'>Low Stock</Button>
                    <Button variant='outline' className='w-full'>Log 1 Use</Button>
                </div>
                
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="batches" className='border-0'>
                        <AccordionTrigger className='p-2 text-sm text-muted-foreground justify-center gap-2 hover:no-underline rounded-md hover:bg-muted/50'>
                             <Database className='w-4 h-4' /> Batches (1)
                        </AccordionTrigger>
                        <AccordionContent className='pt-2'>
                            <p className='text-sm text-muted-foreground'>Batch details would go here.</p>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>
        </Card>
    )
}

const ProductShelf = ({ title, items }: { title: string, items: InventoryItem[] }) => {
    if (items.length === 0) return null;

    return (
        <Accordion type="single" collapsible defaultValue="item-1" className="w-full">
            <AccordionItem value="item-1" className='border-b-0'>
                <AccordionTrigger className='px-1 md:px-0 hover:no-underline'>
                    <div className='flex items-center justify-between w-full'>
                        <h3 className="text-xl font-bold">{title}</h3>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <div className="md:hidden space-y-4 pt-4">
                        {items.map((item) => <ProductCard key={item.id} item={item} />)}
                    </div>
                    <ScrollArea className="hidden md:block">
                        <div className="flex space-x-4 pb-4">
                            {items.map((item) => <ProductCard key={item.id} item={item} />)}
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
}

const EmptyState = ({ message }: { message: string }) => (
    <Card>
        <CardContent className="text-center py-20">
            <p className="text-muted-foreground">{message}</p>
        </CardContent>
    </Card>
);

const ReceiveStockDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Receive Stock</DialogTitle>
                    <DialogDescription>Log a new shipment from a vendor and update your stock levels.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="vendor">Vendor</Label>
                            <Select>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a vendor" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="vendor1">Supplier A</SelectItem>
                                    <SelectItem value="vendor2">Supplier B</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="po-number">PO Number / Tracking</Label>
                            <Input id="po-number" placeholder="Optional" />
                        </div>
                    </div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Items in Shipment</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className='p-4 border rounded-md'>
                                <p className="text-sm text-muted-foreground mb-4">No items added yet. Add products from your library.</p>
                                <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Add Items</Button>
                            </div>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader>
                            <CardTitle>Landed Cost Calculator</CardTitle>
                            <CardDescription>Add shipping, taxes, or other fees from the invoice to calculate the true cost per item.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-3 gap-4">
                             <div className="space-y-2">
                                <Label htmlFor="shipping-cost">Shipping</Label>
                                <Input id="shipping-cost" type="number" placeholder="0.00" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tax-cost">Taxes</Label>
                                <Input id="tax-cost" type="number" placeholder="0.00" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="other-fees">Other Fees</Label>
                                <Input id="other-fees" type="number" placeholder="0.00" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Shipment & Update Stock</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const AddEquipmentDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Equipment</DialogTitle>
                    <DialogDescription>Add a new piece of capital equipment to your asset list.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="equipment-name">Equipment Name</Label>
                        <Input id="equipment-name" placeholder="e.g., Hydraulic Styling Chair" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="purchase-cost">Purchase Cost</Label>
                            <Input id="purchase-cost" type="number" placeholder="0.00" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lifespan">Lifespan (Years)</Label>
                            <Input id="lifespan" type="number" placeholder="5" />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="purchase-date">Purchase Date</Label>
                        <Input id="purchase-date" type="date" />
                    </div>
                    <div className="space-y-2">
                        <Label>Image</Label>
                        <Button variant="outline" className="w-full">Upload Image</Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Equipment</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
const AddOverheadDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Overhead Item</DialogTitle>
                    <DialogDescription>Add a general supply item to your inventory.</DialogDescription>
                </DialogHeader>
                 <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="item-name">Item Name</Label>
                        <Input id="item-name" placeholder="e.g., Disinfectant Wipes" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="purchase-cost">Total Purchase Cost</Label>
                            <Input id="purchase-cost" type="number" placeholder="0.00" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="initial-stock">Initial Stock (Units)</Label>
                            <Input id="initial-stock" type="number" placeholder="1" />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cleaning">Cleaning Supplies</SelectItem>
                                <SelectItem value="office">Office Supplies</SelectItem>
                                <SelectItem value="beverages">Client Beverages</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Item</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
const CreateBundleDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    return (
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Bundle</DialogTitle>
                    <DialogDescription>Group existing retail products into a sellable bundle.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="bundle-name">Bundle Name</Label>
                        <Input id="bundle-name" placeholder="e.g., Summer Glow Kit" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bundle-price">Bundle Price</Label>
                        <Input id="bundle-price" type="number" placeholder="0.00" />
                    </div>
                    <div className='space-y-2'>
                        <Label>Component Products</Label>
                        <Card>
                            <CardContent className="p-4 text-sm text-muted-foreground text-center">
                                <p>No products added yet.</p>
                            </CardContent>
                        </Card>
                        <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Add Products</Button>
                    </div>
                    <Card className="bg-muted/50">
                        <CardHeader>
                            <CardTitle className="text-base">Profitability Analysis</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                             <div className="flex justify-between">
                                <span>Total Component Cost:</span>
                                <span className="font-medium">$0.00</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Net Profit:</span>
                                <span className="font-medium text-primary">$0.00</span>
                            </div>
                             <div className="flex justify-between">
                                <span>Profit Margin:</span>
                                <span className="font-medium text-primary">0.0%</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button>Save Bundle</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function InventoryPage() {
  const professionalColor: InventoryItem[] = [];
  const professionalStyling: InventoryItem[] = [];
  const professionalCare: InventoryItem[] = [];
  const retailItems: InventoryItem[] = [];
  const overheadItems: InventoryItem[] = [];
  const equipmentItems: InventoryItem[] = [];
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationTypes, setLocationTypes] = useState([
    { id: 'lt1', name: 'Back Room Storage' },
    { id: 'lt2', name: 'Retail Display' },
    { id: 'lt3', name: 'Styling Station' },
    { id: 'lt4', name: 'Color Bar' },
  ]);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  const [isReceiveStockOpen, setIsReceiveStockOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false);
  const [isAddOverheadOpen, setIsAddOverheadOpen] = useState(false);
  const [isCreateBundleOpen, setIsCreateBundleOpen] = useState(false);
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isAddLocationFromProductOpen, setIsAddLocationFromProductOpen] = useState(false);

  const handleAddNewLocation = (newLocation: Omit<Location, 'id'>) => {
    const locationWithId = { ...newLocation, id: `loc-${Date.now()}` };
    setLocations(prev => [...prev, locationWithId]);
    toast({ title: "Location Added", description: `${locationWithId.name} has been created.` });
    setIsAddLocationOpen(false);
    setIsAddLocationFromProductOpen(false);
  }

  const handleAddNewLocationType = (newType: string) => {
    const newLocationType = { id: `lt-${Date.now()}`, name: newType };
    setLocationTypes(prev => [...prev, newLocationType]);
    return newLocationType;
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

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-8 space-y-4">
        <Tabs defaultValue="professional" className="w-full space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <ScrollArea className="w-full whitespace-nowrap md:w-auto">
              <TabsList className="inline-grid w-max grid-cols-5 md:w-auto">
                <TabsTrigger value="professional">Professional</TabsTrigger>
                <TabsTrigger value="retail">Retail</TabsTrigger>
                <TabsTrigger value="overhead">Overhead</TabsTrigger>
                <TabsTrigger value="equipment">Equipment</TabsTrigger>
                <TabsTrigger value="locations">Locations</TabsTrigger>
              </TabsList>
              <ScrollBar orientation="horizontal" className="md:hidden" />
            </ScrollArea>
             <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:flex-row">
                <Button className="w-full md:w-auto" onClick={() => setIsReceiveStockOpen(true)}><Truck className="mr-2 h-4 w-4" /> Receive Stock</Button>
                <div className="flex w-full items-stretch gap-2 md:w-auto">
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/inventory/labels">
                      <Printer className="mr-2 h-4 w-4" /> Print Labels
                    </Link>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                       <Button variant="outline" className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Add New</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setIsAddProductOpen(true)}><Package className="mr-2 h-4 w-4" /> Add Product</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setIsAddEquipmentOpen(true)}><Hammer className="mr-2 h-4 w-4" /> Add Equipment</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setIsAddOverheadOpen(true)}><Beaker className="mr-2 h-4 w-4" /> Add Overhead Item</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setIsCreateBundleOpen(true)}><FlaskConical className="mr-2 h-4 w-4" /> Create Bundle</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
            </div>
          </div>
            
          <div className='flex flex-col md:flex-row gap-4'>
             <div className="relative w-full md:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search inventory..." className="pl-9" />
            </div>
            <div className='flex items-center gap-2 w-full md:w-auto'>
              <Button variant="outline" className='flex-1 md:flex-initial' onClick={() => setIsScannerOpen(true)}>
                <QrCode className="mr-2 h-4 w-4" />
                Scan
              </Button>
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button variant="outline" className='flex-1 md:flex-initial'><SlidersHorizontal className="mr-2 h-4 w-4" /> Filters</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Filter by Status</DropdownMenuItem>
                    <DropdownMenuItem>Filter by Category</DropdownMenuItem>
                     <DropdownMenuItem>Filter by Vendor</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            </div>
          </div>

          <div className="mt-2 space-y-4">
            <TabsContent value="professional" className="m-0 space-y-4">
              {professionalColor.length === 0 && professionalCare.length === 0 && professionalStyling.length === 0 ? (
                <EmptyState message="No professional products yet. Add one to get started." />
              ) : (
                <>
                  <ProductShelf title="Color" items={professionalColor} />
                  <ProductShelf title="Care" items={professionalCare} />
                  <ProductShelf title="Styling" items={professionalStyling} />
                </>
              )}
            </TabsContent>
            <TabsContent value="retail" className="m-0">
              {retailItems.length === 0 ? (
                <EmptyState message="No retail items yet. Add one to get started." />
              ) : (
                <ProductShelf title="All Retail" items={retailItems} />
              )}
            </TabsContent>
            <TabsContent value="overhead" className="m-0">
              {overheadItems.length === 0 ? (
                <EmptyState message="No overhead items yet. Add one to get started." />
              ) : (
                <ProductShelf title="All Overhead" items={overheadItems} />
              )}
            </TabsContent>
            <TabsContent value="equipment" className="m-0">
              {equipmentItems.length === 0 ? (
                <EmptyState message="No equipment items yet. Add one to get started." />
              ) : (
                <ProductShelf title="All Equipment" items={equipmentItems} />
              )}
            </TabsContent>
            <TabsContent value="locations" className="m-0 space-y-6">
              <div className="flex items-center justify-between">
                  <div>
                      <h2 className="text-2xl font-bold">Storage Locations</h2>
                      <p className="text-muted-foreground">A map of all your physical storage areas.</p>
                  </div>
                  <Button onClick={() => setIsAddLocationOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> New Location</Button>
              </div>
               {locations.length === 0 ? (
                  <EmptyState message="No storage locations defined yet. Add one to get started." />
               ) : (
                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {locations.map(location => (
                          <Card key={location.id}>
                              <CardHeader>
                                  <CardTitle className="text-lg">{location.name}</CardTitle>
                                  {location.description && <CardDescription>{location.description}</CardDescription>}
                              </CardHeader>
                              <CardFooter className="flex gap-2">
                                  <Button variant="outline" size="sm"><Edit className="mr-2 h-3 w-3"/> Edit</Button>
                                  <Button variant="outline" size="sm" className="text-destructive"><Trash2 className="mr-2 h-3 w-3"/> Delete</Button>
                              </CardFooter>
                          </Card>
                      ))}
                   </div>
               )}
            </TabsContent>
          </div>
         </Tabs>
      </main>

       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Scan Barcode/QR Code</DialogTitle>
            <DialogDescription>
              Position the barcode or QR code inside the frame to scan it.
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
           <DialogFooter className="p-4 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiveStockDialog open={isReceiveStockOpen} onOpenChange={setIsReceiveStockOpen} />
      <AddProductDialog 
        open={isAddProductOpen} 
        onOpenChange={setIsAddProductOpen}
        locations={locations}
        isAddLocationDialogOpen={isAddLocationFromProductOpen}
        onAddLocationDialogOpenChange={setIsAddLocationFromProductOpen}
        onAddNewLocation={handleAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={handleAddNewLocationType}
      />
      <AddEquipmentDialog open={isAddEquipmentOpen} onOpenChange={setIsAddEquipmentOpen} />
      <AddOverheadDialog open={isAddOverheadOpen} onOpenChange={setIsAddOverheadOpen} />
      <CreateBundleDialog open={isCreateBundleOpen} onOpenChange={setIsCreateBundleOpen} />
      <AddLocationDialog 
        open={isAddLocationOpen} 
        onOpenChange={setIsAddLocationOpen}
        onSave={handleAddNewLocation}
        locationTypes={locationTypes}
        onAddNewLocationType={handleAddNewLocationType}
       />

    </div>
  );
}
