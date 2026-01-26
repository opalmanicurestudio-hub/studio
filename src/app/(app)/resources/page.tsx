
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Hammer, Users, MoreHorizontal } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import type { Resource } from '@/lib/data';
import { AddResourceDialog } from '@/components/resources/AddResourceDialog';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const ResourceCard = ({ resource }: { resource: Resource }) => {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div className="space-y-1">
                    <CardTitle>{resource.name}</CardTitle>
                    <CardDescription>{resource.type}</CardDescription>
                </div>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent>
                <div className="flex items-center text-sm text-muted-foreground">
                    <Users className="w-4 h-4 mr-2"/>
                    Capacity: {resource.capacity}
                </div>
            </CardContent>
        </Card>
    )
}


export default function ResourcesPage() {
    const { firestore, user } = useFirebase();
    const tenantId = 'tenant-abc';
    const { toast } = useToast();

    const resourcesQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/resources`) : null, [firestore, tenantId]);
    const { data: resources, isLoading } = useCollection<Resource>(resourcesQuery);
    
    const [isAddResourceDialogOpen, setIsAddResourceDialogOpen] = useState(false);

    const handleSaveResource = (resourceData: Omit<Resource, 'id'>) => {
        if (!firestore) return;
        
        const newResource = {
            ...resourceData,
            id: nanoid()
        };
        const resourceRef = collection(firestore, 'tenants', tenantId, 'resources');
        addDocumentNonBlocking(resourceRef, newResource);
        toast({
            title: "Resource Created!",
            description: `${newResource.name} has been added.`
        });
    }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Resource Management" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Resource Management</h1>
            <p className="text-muted-foreground mt-1">
              Manage bookable assets like treatment rooms or specialized equipment.
            </p>
          </div>
          <Button onClick={() => setIsAddResourceDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Resource
          </Button>
        </div>
        {isLoading ? (
            <p>Loading...</p>
        ) : (resources && resources.length > 0) ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resources.map(resource => (
                    <ResourceCard key={resource.id} resource={resource} />
                ))}
            </div>
        ) : (
            <Card>
            <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
                <Hammer className="w-16 h-16 mb-4"/>
                <h3 className="text-xl font-semibold mb-2 text-foreground">No Resources Created Yet</h3>
                <p className="mb-4">Add your first resource, like a 'Treatment Room' or 'Lash Bed', to manage its availability.</p>
            </CardContent>
            </Card>
        )}
      </main>
      <AddResourceDialog 
        open={isAddResourceDialogOpen}
        onOpenChange={setIsAddResourceDialogOpen}
        onSave={handleSaveResource}
      />
    </div>
  );
}
