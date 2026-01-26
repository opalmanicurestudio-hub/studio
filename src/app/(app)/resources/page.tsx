
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
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useInventory } from '@/context/InventoryContext';
import type { Resource, InventoryItem } from '@/lib/data';
import { AddResourceDialog } from '@/components/resources/AddResourceDialog';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

const ResourceCard = ({ resource, inventory, onDelete }: { resource: Resource, inventory: InventoryItem[], onDelete: (id: string) => void }) => {
    const linkedItem = resource.inventoryItemId ? inventory.find(i => i.id === resource.inventoryItemId) : null;

    const Icon = resource.type === 'room' ? Building : HardHat;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                         <Icon className="w-6 h-6 text-muted-foreground" />
                         <CardTitle className="text-lg">{resource.name}</CardTitle>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-2 -mr-2">
                                <MoreHorizontal className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(resource.id)}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                 <CardDescription className="pl-9">{resource.type === 'room' ? 'Room / Location' : 'Equipment'}</CardDescription>
            </CardHeader>
            <CardContent>
                 {linkedItem && (
                    <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md">
                        <p className="font-semibold text-foreground">Linked to Inventory Item:</p>
                        <p>{linkedItem.name}</p>
                    </div>
                 )}
            </CardContent>
            <CardFooter>
                 <p className="text-sm text-muted-foreground">Capacity: {resource.capacity || 1}</p>
            </CardFooter>
        </Card>
    );
};

export default function ResourcesPage() {
    const { firestore, user } = useFirebase();
    const tenantId = 'tenant-abc';
    const { inventory } = useInventory();
    const { toast } = useToast();

    const resourcesQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, `tenants/${tenantId}/resources`);
    }, [firestore, tenantId]);

    const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(resourcesQuery);
    
    const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);

    const handleSaveResource = (resourceData: Omit<Resource, 'id'>) => {
        if (!firestore) return;
        
        const newResource = {
            ...resourceData,
            id: `res-${nanoid()}`
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
        if (!firestore) return;
        const resourceRef = doc(firestore, 'tenants', tenantId, 'resources', resourceId);
        deleteDocumentNonBlocking(resourceRef);
        toast({
            variant: "destructive",
            title: "Resource Deleted",
            description: "The resource has been removed."
        });
    }

    const equipmentInventory = useMemo(() => inventory.filter(i => i.type === 'equipment'), [inventory]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Resources" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Resource Management</h1>
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
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resources.map(resource => (
                    <ResourceCard key={resource.id} resource={resource} inventory={inventory} onDelete={handleDeleteResource} />
                ))}
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
