
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlusCircle, File, MoreHorizontal } from 'lucide-react';
import { inventory, type InventoryItem } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const InventoryTable = ({ items }: { items: InventoryItem[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead className="hidden sm:table-cell">Stock</TableHead>
        <TableHead className="hidden sm:table-cell">Cost/Unit</TableHead>
        <TableHead className="hidden md:table-cell">Supplier</TableHead>
        <TableHead>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell>
            <div className="font-medium">{item.name}</div>
            <div className="sm:hidden text-sm text-muted-foreground">
              <span>Stock: </span>
              <Badge
                variant={item.stock < 10 ? 'destructive' : 'outline'}
                className="mr-2"
              >
                {item.stock}
              </Badge>
              <span>Cost: ${item.costPerUnit.toFixed(2)}</span>
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            <Badge variant={item.stock < 10 ? 'destructive' : 'outline'}>
              {item.stock}
            </Badge>
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            ${item.costPerUnit.toFixed(2)}
          </TableCell>
          <TableCell className="hidden md:table-cell">{item.supplier}</TableCell>
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-haspopup="true" size="icon" variant="ghost">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Adjust Stock</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export default function InventoryPage() {
  const professionalItems = inventory.filter((i) => i.type === 'professional');
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
          <Card className="mt-4">
            <CardContent className="p-0">
              <TabsContent value="professional" className="m-0">
                <CardHeader>
                  <CardTitle>Professional</CardTitle>
                  <CardDescription>
                    Back-bar products used in your services.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <InventoryTable items={professionalItems} />
                </CardContent>
              </TabsContent>
              <TabsContent value="retail" className="m-0">
                <CardHeader>
                  <CardTitle>Retail</CardTitle>
                  <CardDescription>
                    Products you sell directly to clients.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <InventoryTable items={retailItems} />
                </CardContent>
              </TabsContent>
              <TabsContent value="overhead" className="m-0">
                <CardHeader>
                  <CardTitle>Overhead</CardTitle>
                  <CardDescription>
                    Consumable supplies not directly tied to a service.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {overheadItems.length > 0 ? (
                     <InventoryTable items={overheadItems} />
                  ) : (
                    <div className="text-center py-10">
                      <p className="text-muted-foreground">No overhead items yet.</p>
                    </div>
                  )}
                </CardContent>
              </TabsContent>
              <TabsContent value="equipment" className="m-0">
                 <CardHeader>
                  <CardTitle>Equipment</CardTitle>
                  <CardDescription>
                    Long-term assets that depreciate over time.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <InventoryTable items={equipmentItems} />
                </CardContent>
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>
      </main>
    </div>
  );
}
