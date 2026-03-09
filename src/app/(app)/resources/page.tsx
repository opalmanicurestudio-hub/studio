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
  Box,
  Building,
  HardHat,
  Trash2,
  Users,
  Edit,
  Calendar,
  Loader,
  Sparkles,
  MapPin,
  Package,
  ArrowRight,
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';
import Image from 'next/image';
import { useInventory } from '@/context/InventoryContext';
import type { Resource, InventoryItem } from '@/lib/data';
import { AddResourceDialog } from '@/components/resources/AddResourceDialog';
import { EditResourceDialog } from '@/components/resources/EditResourceDialog';
import { useFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const ResourceCard = ({ 
    resource, 
    inventory, 
    onDelete, 
    onEdit 
}: { 
    resource: Resource, 
    inventory: InventoryItem[], 
    onDelete: (id: string) => void, 
    onEdit: (resource: Resource) => void 
}) => {
    const linkedItem = resource.inventoryItemId ? inventory.find(i => i.id === resource.inventoryItemId) : null;
    const Icon = resource.type === 'room' ? Building : HardHat;
    const imageUrl = linkedItem?.imageUrl;

    return (
        <Card className="transition-all duration-500 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col bg-white hover:border-primary/20 hover:shadow-2xl hover:shadow-primary/5 shadow-sm">
            <CardHeader className="p-6 pb-2 bg-muted/5 border-b">
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4 min-w-0 text-left">
                        <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 shadow-inner group-hover:bg-primary transition-all duration-500 shrink-0">
                            <Icon className="w-6 h-6 text-primary group-hover:text-white transition-colors" />
                        </div>
                        <div className="min-w-0">
                            <CardTitle className="text-lg md:text-xl font-black uppercase tracking-tight text-slate-900 leading-none mb-1.5 truncate">{resource.name}</CardTitle>
                            <p className="text-[10px] font-black text-primary/60 uppercase tracking-widest">{resource.type}</p>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/5 shrink-0 -mt-1 -mr-1">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                            <DropdownMenuItem onClick={() => onEdit(resource)} className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                                <Edit className="mr-2 h-3.5 w-3.5 opacity-40" /> Edit Detail
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5" onClick={() => onDelete(resource.id)}>
                                <Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate Unit
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="p-6 flex-1 space-y-6">
                {resource.type === 'equipment' && linkedItem && (
                    <div className="p-4 rounded-2xl bg-primary/[0.02] border-2 border-primary/10 flex items-center gap-4 text-left">
                        <div className="w-14 h-14 bg-white rounded-xl flex-shrink-0 relative border-2 border-primary/5 shadow-sm overflow-hidden flex items-center justify-center">
                            {imageUrl ? (
                                <Image src={imageUrl} alt={linkedItem.name} fill className="object-cover" />
                            ) : (
                                <Package className="w-6 h-6 text-primary opacity-20" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[8px] font-black uppercase text-primary/60 tracking-widest mb-0.5">Asset Registry</p>
                            <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-tight">{linkedItem.name}</p>
                        </div>
                    </div>
                )}
                
                <div className="grid grid-cols-1 gap-4 mt-auto">
                    <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all flex justify-between items-center text-left">
                        <div className="space-y-0.5">
                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 leading-none">Occupancy Load</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Active Capacity</p>
                        </div>
                        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">{resource.capacity || 1}</p>
                    </div>
                </div>
            </CardContent>
             <CardFooter className="p-3 border-t bg-muted/5 mt-auto">
                <Button variant="ghost" asChild className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary group/btn">
                    <Link href="/planner?view=resources">
                        Analyze Agenda <ChevronRight className="ml-2 h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
                    </Link>
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
    const [isEditResourceOpen, setIsEditResourceOpen] = useState(false);
    const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

    const handleSaveResource = (resourceData: Omit<Resource, 'id'>) => {
        if (!firestore || !tenantId) return;
        
        const newResourceId = nanoid();
        const newResource: Resource = {
            ...resourceData,
            id: newResourceId,
        };

        const resourceRef = doc(firestore, 'tenants', tenantId, 'resources', newResourceId);
        setDocumentNonBlocking(resourceRef, newResource, {});
        
        toast({
            title: "Resource Registered",
            description: `${newResource.name} has been established in the studio matrix.`
        });
        setIsAddResourceOpen(false);
    }

    const handleUpdateResource = (resourceData: Resource) => {
        if (!firestore || !tenantId) return;
        const resourceRef = doc(firestore, 'tenants', tenantId, 'resources', resourceData.id);
        updateDocumentNonBlocking(resourceRef, resourceData);
        toast({ title: "Resource Refined" });
        setIsEditResourceOpen(false);
    }
    
    const handleDeleteResource = (resourceId: string) => {
        if (!firestore || !tenantId) return;
        const resourceRef = doc(firestore, 'tenants', tenantId, 'resources', resourceId);
        deleteDocumentNonBlocking(resourceRef);
        toast({
            variant: "destructive",
            title: "Resource Decommissioned",
            description: "The unit has been removed from the studio manifest."
        });
    }

    const handleEditResource = (resource: Resource) => {
        setSelectedResource(resource);
        setIsEditResourceOpen(true);
    };

    const equipmentInventory = useMemo(() => inventory.filter(i => i.type === 'equipment'), [inventory]);

    const roomsAndStations = useMemo(() => resources?.filter(r => r.type === 'room') || [], [resources]);
    const equipment = useMemo(() => resources?.filter(r => r.type === 'equipment') || [], [resources]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Studio Infrastructure" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Matrix</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Studio layout & bookable asset manifest
            </p>
          </div>
          <Button onClick={() => setIsAddResourceOpen(true)} className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <PlusCircle className="mr-2 h-4 w-4" /> Register New Unit
          </Button>
        </div>
        
        {resourcesLoading ? (
            <div className="flex flex-col items-center justify-center p-24 gap-4">
                <Loader className="animate-spin h-8 w-8 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Matrix...</p>
            </div>
        ) : (resources && resources.length > 0) ? (
            <div className="space-y-16">
                 <section className="space-y-8">
                    <div className="space-y-1 text-left px-1">
                        <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-900">Rooms & Stations</h2>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Primary treatment environments</p>
                    </div>
                    {roomsAndStations.length > 0 ? (
                         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 animate-in fade-in duration-500">
                            {roomsAndStations.map(resource => (
                                <ResourceCard key={resource.id} resource={resource} inventory={inventory} onDelete={handleDeleteResource} onEdit={handleEditResource} />
                            ))}
                        </div>
                    ) : (
                        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                            <Building className="w-12 h-12" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No Rooms Registered</p>
                        </div>
                    )}
                </section>

                <section className="space-y-8">
                    <div className="space-y-1 text-left px-1">
                        <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-900">Capital Hardware</h2>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Bookable equipment & machinery</p>
                    </div>
                    {equipment.length > 0 ? (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 animate-in fade-in duration-500">
                            {equipment.map(resource => (
                                <ResourceCard key={resource.id} resource={resource} inventory={inventory} onDelete={handleDeleteResource} onEdit={handleEditResource} />
                            ))}
                        </div>
                    ) : (
                         <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                            <HardHat className="w-12 h-12" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No Hardware Registered</p>
                        </div>
                    )}
                </section>
            </div>
        ) : (
             <div className="text-center py-24 md:py-32 px-6 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                <div className='w-24 h-24 bg-muted rounded-[2.5rem] flex items-center justify-center shadow-inner'>
                    <Box className='w-12 h-12 text-muted-foreground' />
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Infrastructure Empty</h3>
                    <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
                        Establish your physical studio zones to enable coordinate-based planning and resource scheduling.
                    </p>
                </div>
                <Button size="lg" onClick={() => setIsAddResourceOpen(true)} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 mt-4">
                    Register First Unit
                </Button>
            </div>
        )}
      </main>

       <AddResourceDialog
        open={isAddResourceOpen}
        onOpenChange={setIsAddResourceOpen}
        onSave={handleSaveResource}
        equipmentInventory={equipmentInventory}
      />

      {selectedResource && (
          <EditResourceDialog
            open={isEditResourceOpen}
            onOpenChange={setIsEditResourceOpen}
            resource={selectedResource}
            onSave={handleUpdateResource}
            equipmentInventory={equipmentInventory}
          />
      )}
    </div>
  );
}
