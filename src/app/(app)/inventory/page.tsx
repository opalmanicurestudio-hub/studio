'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal, MapPin } from 'lucide-react';
import { inventory, type InventoryItem } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';

const getStockStatus = (stock: number): { text: string; variant: 'default' | 'destructive' | 'secondary' } => {
    if (stock <= 0) return { text: 'Out of Stock', variant: 'destructive' };
    if (stock < 10) return { text: 'Low Stock', variant: 'secondary' }; // Yellowish
    return { text: 'In Stock', variant: 'default' }; // Greenish
}


const ProductCard = ({ item }: { item: InventoryItem }) => {
    const status = getStockStatus(item.stock);
    return (
        <Card className="w-full shrink-0 md:w-72">
            <CardHeader className="p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle className="text-base">{item.name}</CardTitle>
                        <Badge 
                            variant={status.variant} 
                            className={cn(
                                'mt-1',
                                status.variant === 'default' && 'bg-green-600/20 text-green-400 border-green-600/30',
                                status.variant === 'secondary' && 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30'
                            )}
                        >
                            {status.text}
                        </Badge>
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
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
                <div className='flex gap-4 items-center'>
                    <div className='w-20 h-20 bg-muted rounded-md flex-shrink-0'>
                        <Image src={`https://picsum.photos/seed/inv${item.id}/200/200`} alt={item.name} width={80} height={80} className='rounded-md' data-ai-hint="product photo"/>
                    </div>
                    <div className='space-y-1 text-center'>
                        <p className='text-3xl font-bold'>{item.stock}</p>
                        <p className='text-xs text-muted-foreground'>Total Stock</p>
                    </div>
                </div>
                 <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" />
                    <span>Color Bar - Shelf A</span>
                    <Badge variant="outline" className="ml-auto">+2 more</Badge>
                </div>
            </CardContent>
        </Card>
    )
}

const ProductShelf = ({ title, items }: { title: string, items: InventoryItem[] }) => (
  <div className="space-y-3">
    <h3 className="text-lg font-semibold px-1 md:px-0">{title}</h3>
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
