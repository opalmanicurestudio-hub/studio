

'use client';

import React, { useState, useMemo } from 'react';
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
import {
  PlusCircle,
  MoreHorizontal,
  Box,
  Building,
  HardHat,
  Trash2,
  Users,
  Edit,
} from 'lucide-react';
import Image from 'next/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useInventory } from '@/context/InventoryContext';
import type { Resource, InventoryItem } from '@/lib/data';
import { AddResourceDialog } from '@/components/resources/AddResourceDialog';
import { useFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';

const ResourceCard = ({ resource, inventory, onDelete, onEdit }: { resource: Resource, inventory: InventoryItem[], onDelete: (id: string) => void, onEdit: (resource: Resource) => void }) => {
    const linkedItem = resource.inventoryItemId ? inventory.find(i => i.id === resource.inventoryItemId) : null;
    const Icon = resource.type === 'room' ? Building : HardHat;
    const imageUrl = linkedItem?.imageUrl || `https://picsum.photos/seed/res${resource.id}/200/200`;

    return (
        <Card className="flex flex-col overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
            <CardHeader className="p-4 bg-muted/50">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-background rounded-lg border">
                        <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <CardTitle className="text-lg">{resource.name}</CardTitle>
                        <CardDescription className="capitalize">{resource.type}</CardDescription>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => onEdit(resource)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(resource.id)}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="p-4 flex-1 space-y-4">
                {resource.type === 'equipment' && linkedItem && (
                    <div className="flex items-center gap-3 p-3 bg-background rounded-md border">
                        <div className="w-12 h-12 bg-muted rounded-md flex-shrink-0 relative">
                            <Image src={imageUrl} alt={linkedItem.name} fill className="object-cover rounded-md" />
                        </div>
                        <div className="text-sm">
                            <p className="text-muted-foreground text-xs">Linked Inventory</p>
                            <p className="font-semibold">{linkedItem.name}</p>
                        </div>
                    </div>
                )}
                <div className="flex items-center justify-between p-3 bg-background rounded-md border">
                    <p className="font-medium text-sm flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> Capacity</p>
                    <p className="font-bold text-lg">{resource.capacity || 1}</p>
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t">
                <Button asChild variant="ghost" className="w-full">
                    <Link href="/planner?view=resources">View Schedule</Link>
                </Button>
            </CardFooter>
        </Card>
    );
};

export default function ResourcesPage() {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { inventory, resources, isLoading: resourcesLoading } = useInventory();
    const { toast } = useToast();

    const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);

    const handleSaveResource = (resourceData: Omit<Resource, 'id'>) => {
        if (!firestore || !tenantId) return;
        
        const newResource: Resource = {
            ...resourceData,
            id: nanoid(),
        };

        const resourceRef = collection(firestore, 'tenants', tenantId, 'resources');
        addDocumentNonBlocking(resourceRef, newResource);
        
        toast({
            title: "Resource Added",
            description: `${newResource.name} has been added to your resources.`
        });
        setIsAddResourceOpen(false);
    }
    
    const handleDeleteResource = (resourceId: string) => {
        if (!firestore || !tenantId) return;
        const resourceRef = doc(firestore, 'tenants', tenantId, 'resources', resourceId);
        deleteDocumentNonBlocking(resourceRef);
        toast({
            variant: "destructive",
            title: "Resource Deleted",
            description: "The resource has been removed."
        });
    }

    const handleEditResource = (resource: Resource) => {
        toast({
            title: "Edit Action",
            description: `Editing ${resource.name}. (Functionality to be implemented)`,
        });
    };

    const equipmentInventory = useMemo(() => inventory.filter(i => i.type === 'equipment'), [inventory]);

    const roomsAndStations = useMemo(() => resources?.filter(r => r.type === 'room') || [], [resources]);
    const equipment = useMemo(() => resources?.filter(r => r.type === 'equipment') || [], [resources]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Resources" />
      <main className="flex-1 p-4 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Studio Layout & Resources</h1>
            <p className="text-muted-foreground mt-1">
              Manage your bookable rooms, stations, and equipment.
            </p>
          </div>
          <Button onClick={() => setIsAddResourceOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Resource
          </Button>
        </div>
        
        {resourcesLoading ? (
            <p>Loading...</p>
        ) : (resources && resources.length > 0) ? (
            <div className="space-y-8">
                 <section>
                    <h2 className="text-2xl font-semibold mb-4 border-b pb-2">Rooms & Stations</h2>
                    {roomsAndStations.length > 0 ? (
                         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {roomsAndStations.map(resource => (
                                <ResourceCard key={resource.id} resource={resource} inventory={inventory} onDelete={handleDeleteResource} onEdit={handleEditResource} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-muted-foreground text-sm py-4">No rooms or stations have been created yet.</p>
                    )}
                </section>
                <section>
                    <h2 className="text-2xl font-semibold mb-4 border-b pb-2">Equipment</h2>
                    {equipment.length > 0 ? (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {equipment.map(resource => (
                                <ResourceCard key={resource.id} resource={resource} inventory={inventory} onDelete={handleDeleteResource} onEdit={handleEditResource} />
                            ))}
                        </div>
                    ) : (
                         <p className="text-muted-foreground text-sm py-4">No equipment resources have been created yet.</p>
                    )}
                </section>
            </div>
        ) : (
             <Card>
                <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
                    <Box className="w-16 h-16 mb-4"/>
                    <h3 className="text-xl font-semibold mb-2 text-foreground">No Resources Created Yet</h3>
                    <p className="mb-4">Add rooms or equipment to manage their availability.</p>
                </CardContent>
            </Card>
        )}
      </main>

       <AddResourceDialog
        open={isAddResourceOpen}
        onOpenChange={setIsAddResourceOpen}
        onSave={handleSaveResource}
        equipmentInventory={equipmentInventory}
      />
    </div>
  );
}

    