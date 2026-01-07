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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const InventoryTable = ({ items }: { items: InventoryItem[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Stock</TableHead>
        <TableHead>Cost/Unit</TableHead>
        <TableHead>Supplier</TableHead>
        <TableHead><span className="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="font-medium">{item.name}</TableCell>
          <TableCell>
            <Badge variant={item.stock < 10 ? 'destructive' : 'outline'}>
              {item.stock}
            </Badge>
          </TableCell>
          <TableCell>${item.costPerUnit.toFixed(2)}</TableCell>
          <TableCell>{item.supplier}</TableCell>
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
                <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
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
  const equipmentItems = inventory.filter((i) => i.type === 'equipment');

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-8">
        <Tabs defaultValue="professional">
          <div className="flex items-center">
            <TabsList>
              <TabsTrigger value="professional">Professional</TabsTrigger>
              <TabsTrigger value="retail">Retail</TabsTrigger>
              <TabsTrigger value="equipment">Equipment</TabsTrigger>
            </TabsList>
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
                <InventoryTable items={professionalItems} />
              </TabsContent>
              <TabsContent value="retail" className="m-0">
                <InventoryTable items={retailItems} />
              </TabsContent>
              <TabsContent value="equipment" className="m-0">
                <InventoryTable items={equipmentItems} />
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>
      </main>
    </div>
  );
}
