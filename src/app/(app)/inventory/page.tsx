'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal, Database, Camera, AlertTriangle } from 'lucide-react';
import { inventory, type InventoryItem } from '@/lib/data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';


const ProductCard = ({ item }: { item: InventoryItem }) => {
    return (
        <Card className="w-full shrink-0 md:w-72">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className='flex items-start gap-3'>
                        <div className='w-14 h-14 bg-muted rounded-md flex-shrink-0'>
                            <Image src={`https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={56} height={56} className='rounded-md' data-ai-hint="product photo"/>
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
                        <DropdownMenuItem>View Details</DropdownMenuItem>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem>Reorder</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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


export default function InventoryPage() {
  const professionalColor = inventory.filter((i) => i.type === 'professional' && i.category === 'Color');
  const professionalStyling = inventory.filter((i) => i.type === 'professional' && i.category === 'Styling');
  const professionalCare = inventory.filter((i) => i.type === 'professional' && i.category === 'Care');

  const retailItems = inventory.filter((i) => i.type === 'retail');
  const overheadItems = inventory.filter((i) => i.type === 'overhead');
  const equipmentItems = inventory.filter((i) => i.type === 'equipment');

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

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
      <main className="flex-1 p-4 md:p-8">
        <Tabs defaultValue="professional">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <ScrollArea className="w-full whitespace-nowrap sm:w-auto">
              <TabsList className="inline-grid w-max grid-cols-4 sm:w-auto">
                <TabsTrigger value="professional">Professional</TabsTrigger>
                <TabsTrigger value="retail">Retail</TabsTrigger>
                <TabsTrigger value="overhead">Overhead</TabsTrigger>
                <TabsTrigger value="equipment">Equipment</TabsTrigger>
              </TabsList>
              <ScrollBar orientation="horizontal" className="sm:hidden" />
            </ScrollArea>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setIsScannerOpen(true)}>
                <Camera className="mr-2 h-4 w-4" />
                Scan
              </Button>
              <Button size="sm" variant="outline">
                <File className="mr-2 h-4 w-4" />
                Export
              </Button>
              <Button size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <TabsContent value="professional" className="m-0 space-y-4">
                <ProductShelf title="Color" items={professionalColor} />
                <ProductShelf title="Care" items={professionalCare} />
                <ProductShelf title="Styling" items={professionalStyling} />
            </TabsContent>
            <TabsContent value="retail" className="m-0">
               {retailItems.length > 0 ? (
                    <ProductShelf title="All Retail" items={retailItems} />
                ) : (
                    <EmptyState message="No retail items yet." />
                )}
            </TabsContent>
            <TabsContent value="overhead" className="m-0">
              {overheadItems.length > 0 ? (
                    <ProductShelf title="All Overhead" items={overheadItems} />
                ) : (
                    <EmptyState message="No overhead items yet." />
                )}
            </TabsContent>
            <TabsContent value="equipment" className="m-0">
                {equipmentItems.length > 0 ? (
                    <ProductShelf title="All Equipment" items={equipmentItems} />
                ) : (
                    <EmptyState message="No equipment items yet." />
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
    </div>
  