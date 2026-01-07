'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal, ChevronUp, Database } from 'lucide-react';
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

const ProductCard = ({ item }: { item: InventoryItem }) => {
    return (
        <Card className="w-full shrink-0 md:w-72">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className='flex items-center gap-3'>
                        <div className='w-14 h-14 bg-muted rounded-md flex-shrink-0'>
                            <Image src={`https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={56} height={56} className='rounded-md' data-ai-hint="product photo"/>
                        </div>
                        <div>
                            <p className="font-semibold text-base">{item.name}</p>
                            <p className="text-sm text-muted-foreground">{item.type}</p>
                        </div>
                    </div>
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" className="h-6 w-6">
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

const ProductShelf = ({ title, items }: { title: string, items: InventoryItem[] }) => (
  <div className="space-y-4">
    <div className='flex items-center justify-between px-1 md:px-0'>
        <h3 className="text-xl font-bold">{title}</h3>
        <Button variant='ghost' size='icon' className='h-8 w-8'>
            <ChevronUp className='h-5 w-5' />
        </Button>
    </div>
     <div className="md:hidden space-y-4">
      {items.map((item) => <ProductCard key={item.id} item={item} />)}
    </div>
    <ScrollArea className="hidden md:block">
      <div className="flex space-x-4 pb-4">
        {items.map((item) => <ProductCard key={item.id} item={item} />)}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  </div>
);


export default function InventoryPage() {
  const professionalColor = inventory.filter((i) => i.type === 'professional' && i.category === 'Color');
  const professionalStyling = inventory.filter((i) => i.type === 'professional' && i.category === 'Styling');
  const professionalCare = inventory.filter((i) => i.type === 'professional' && i.category === 'Care');

  const retailItems = inventory.filter((i) => i.type === 'retail');
  const overheadItems = inventory.filter((i) => i.type === 'overhead');
  const equipmentItems = inventory.filter((i) => i.type === 'equipment');

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
          <div className="mt-6 space-y-8">
            <TabsContent value="professional" className="m-0 space-y-8">
                <ProductShelf title="Color" items={professionalColor} />
                <ProductShelf title="Care" items={professionalCare} />
                <ProductShelf title="Styling" items={professionalStyling} />
            </TabsContent>
            <TabsContent value="retail" className="m-0">
               {retailItems.length > 0 ? (
                    <ProductShelf title="All Retail" items={retailItems} />
                ) : (
                <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No retail items yet.</p>
                    </CardContent>
                </Card>
                )}
            </TabsContent>
            <TabsContent value="overhead" className="m-0">
              {overheadItems.length > 0 ? (
                    <ProductShelf title="All Overhead" items={overheadItems} />
                ) : (
                <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No overhead items yet.</p>
                    </CardContent>
                </Card>
                )}
            </TabsContent>
            <TabsContent value="equipment" className="m-0">
                {equipmentItems.length > 0 ? (
                    <ProductShelf title="All Equipment" items={equipmentItems} />
                ) : (
                <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No equipment items yet.</p>
                    </CardContent>
                </Card>
                )}
            </TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}
