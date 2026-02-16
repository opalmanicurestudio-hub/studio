

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Clock, DollarSign, Sparkles, Box, List, Pencil, Search, SlidersHorizontal, Info, ShoppingCart, Hammer, FileText, BarChart, Users, TrendingUp, MapPin, Book, Calendar as CalendarIcon, Landmark, Link as LinkIcon, EyeOff, Trash2, Calculator } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from '@/components/ui/label';
import { type Service, type InventoryItem, type Appointment, type Resource, type Transaction } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { AddServiceDialog } from '@/components/services/AddServiceDialog';
import { EditServiceDialog } from '@/components/services/EditServiceDialog';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTenant } from '@/context/TenantContext';


const ServiceCard = ({ service, onEditServiceOpen, tmhr, appointments, transactions, onPriceUpdate, isSelected, onSelectItem }: { service: Service, onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null, transactions: Transaction[] | null, onPriceUpdate: (serviceId: string, newPrice: number) => void, isSelected: boolean, onSelectItem: () => void }) => {
  const { toast } = useToast();
  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  
  const performance = useMemo(() => {
    if (!appointments || !transactions) return { totalBookings: 0, totalRevenue: 0 };
    const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
    const bookingIds = new Set(bookings.map(b => b.id));

    const totalRevenue = transactions
        .filter(t => t.appointmentId && bookingIds.has(t.appointmentId) && t.category === 'Service Revenue')
        .reduce((total, t) => total + t.amount, 0);

    return {
        totalBookings: bookings.length,
        totalRevenue,
    };
  }, [service.id, appointments, transactions]);

  const handleCopyLink = () => {
    const tenantId = 'tenant-abc'; // This should be dynamic in a real multi-tenant app
    const bookingLink = `https://clarityflow.app/book/${tenantId}/${service.id}`;
    navigator.clipboard.writeText(bookingLink);
    toast({
        title: "Booking Link Copied!",
        description: "You can now share this direct link with your clients.",
    });
  };
  
  const sortedTiers = useMemo(() => {
    if (!service.pricingTiers || service.pricingTiers.length === 0) {
        return null;
    }
    const tierOrder = ['apprentice', 'junior', 'senior', 'master'];
    return [...service.pricingTiers].sort((a,b) => tierOrder.indexOf(a.level) - tierOrder.indexOf(b.level));
  }, [service.pricingTiers]);


  return (
    <Card className={cn("overflow-hidden flex flex-col transition-all duration-200 hover:shadow-xl hover:-translate-y-1", isSelected && "border-primary ring-2 ring-primary")}>
      <CardContent className="p-4 space-y-4 flex-1 flex flex-col">
        <div className="flex items-start gap-3">
          <div className="flex items-center pt-1">
            <Checkbox
                id={`select-${service.id}`}
                checked={isSelected}
                onCheckedChange={onSelectItem}
                aria-label={`Select ${service.name}`}
            />
          </div>
          <Link href={`/services/${service.id}`} className="w-20 h-20 bg-muted rounded-md flex-shrink-0">
             <Image 
                src={service.imageUrl || `https://picsum.photos/seed/svc${service.id}/200/200`} 
                alt={service.name} 
                width={80} 
                height={80} 
                className='rounded-md object-cover h-full w-full' 
                data-ai-hint="manicure nails" 
            />
          </Link>
          <div className="flex-1 min-w-0">
             <div className="flex justify-between items-start">
                <Link href={`/services/${service.id}`} className="group">
                    <p className="font-semibold text-base leading-tight group-hover:underline pr-2">{service.name}</p>
                </Link>
            </div>
            {service.isPrivate && (
                <Badge variant="secondary" className="text-xs mt-1">
                    <EyeOff className="w-3 h-3 mr-1.5" />
                    Private
                </Badge>
            )}
            <div className="text-sm text-muted-foreground space-y-1 pt-1">
                <div className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {service.duration} min {totalPadding > 0 && <span className='text-muted-foreground/50'>(+{totalPadding} pad)</span>}</div>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-center">
             <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Bookings</p>
                <p className="font-bold text-lg">{performance.totalBookings}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="font-bold text-lg">${performance.totalRevenue.toFixed(2)}</p>
            </div>
             <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Profit</p>
                <p className={`font-bold text-lg ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`font-bold text-lg ${service.margin >= 0 ? 'text-primary' : 'text-destructive'}`}>{service.margin.toFixed(0)}%</p>
            </div>
        </div>

      </CardContent>
       <CardFooter className="p-2 border-t bg-muted/50">
            <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => onEditServiceOpen(service)}>
                    <Pencil className="mr-2 h-4 w-4"/>
                    Edit
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={handleCopyLink}>
                    <LinkIcon className="mr-2 h-4 w-4"/>
                    Share Link
                </Button>
            </div>
        </CardFooter>
    </Card>
  );
};

const ServiceCategory = ({ title, services, onEditServiceOpen, tmhr, appointments, transactions, onPriceUpdate, selectedItems, onSelectItem }: { title: string, services: Service[], onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null, transactions: Transaction[] | null, onPriceUpdate: (serviceId: string, newPrice: number) => void, selectedItems: Set<string>, onSelectItem: (id: string) => void }) => {
    if (services.length === 0) return null;
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">{title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {services.map((service) => (
                    <ServiceCard 
                        key={service.id} 
                        service={service} 
                        onEditServiceOpen={onEditServiceOpen} 
                        tmhr={tmhr} 
                        appointments={appointments}
                        transactions={transactions}
                        onPriceUpdate={onPriceUpdate}
                        isSelected={selectedItems.has(service.id)}
                        onSelectItem={() => onSelectItem(service.id)}
                    />
                ))}
            </div>
        </div>
    )
}

const EmptyState = ({ onAddNewService }: { onAddNewService: () => void }) => (
    <Card className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <CardContent className='space-y-4'>
            <div className='flex justify-center'>
                 <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                    <List className='w-10 h-10 text-muted-foreground' />
                 </div>
            </div>
            <h3 className="text-2xl font-semibold">Build Your Service Menu</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
                This is where your services will live. Add your first service to calculate its profitability and build your client-facing menu.
            </p>
            <Button className='mt-4' onClick={onAddNewService}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add New Service
            </Button>
        </CardContent>
    </Card>
)


export default function ServicesPage() {
  const [isAddServiceDialogOpen, setIsAddServiceDialogOpen] = useState(false);
  const [isEditServiceDialogOpen, setIsEditServiceDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [tmhr, setTmhr] = useState(0);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showArchived, setShowArchived] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { services, appointments, resources, isLoading, transactions } = useInventory();
  

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(itemId)) {
            newSelection.delete(itemId);
        } else {
            newSelection.add(itemId);
        }
        return newSelection;
    });
  }, []);

  const handleBulkArchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => {
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id), { status: 'archived' });
    });
    toast({ title: `${selectedItems.size} service(s) have been archived.` });
    setSelectedItems(new Set());
  }, [selectedItems, firestore, tenantId, toast]);

  const handleBulkUnarchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => {
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id), { status: 'active' });
    });
    toast({ title: `${selectedItems.size} service(s) have been restored.` });
    setSelectedItems(new Set());
  }, [selectedItems, firestore, tenantId, toast]);

  const handleBulkDeleteClick = () => {
    setIsBulkDeleteConfirmOpen(true);
  };
  
  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    selectedItems.forEach(id => {
        deleteDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id));
    });
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Services Deleted",
        description: `${itemCount} service(s) have been removed.`,
    })
  }, [selectedItems, firestore, tenantId, toast]);

  useEffect(() => {
      if (selectedTenant && typeof selectedTenant.tmhr === 'number') {
        setTmhr(selectedTenant.tmhr);
    } else {
        setTmhr(50); // Fallback
    }
  }, [selectedTenant]);

  const handleOpenEditService = (service: Service) => {
    setSelectedService(service);
    setIsEditServiceDialogOpen(true);
  };
  
  const handlePriceUpdate = (serviceId: string, newPrice: number) => {
    if (!firestore || !services || !tenantId) return;
    const serviceToUpdate = services.find(s => s.id === serviceId);
    if (!serviceToUpdate) return;
    
    const breakEvenCost = serviceToUpdate.cost;
    const newProfit = newPrice - breakEvenCost;
    const finalPrice = newPrice;
    const newMargin = finalPrice > 0 ? (newProfit / finalPrice) * 100 : 0;

    const serviceRef = doc(firestore, 'tenants', tenantId, 'services', serviceId);
    updateDocumentNonBlocking(serviceRef, { 
        price: newPrice,
        profit: newProfit,
        margin: newMargin
    });
  };
  
    const [serviceCategories, setServiceCategories] = useState<string[]>([]);
    
    useEffect(() => {
        if (services) {
            const allCategories = services.map(s => s.category).filter((c): c is string => !!c);
            setServiceCategories([...new Set(allCategories)]);
        }
    }, [services]);

  const handleNewCategory = (newCategory: string) => {
    if (!serviceCategories.includes(newCategory)) {
        setServiceCategories(prev => [...prev, newCategory]);
    }
  };
  
  const handleAddNewService = (newService: Service) => {
    if (!firestore || !tenantId) return;
    const serviceRef = doc(firestore, 'tenants', tenantId, 'services', newService.id);
    const sanitizedData = Object.fromEntries(
        Object.entries(newService).filter(([, value]) => value !== undefined)
    );
    setDocumentNonBlocking(serviceRef, sanitizedData, {});

    if (newService.category && !serviceCategories.includes(newService.category)) {
      setServiceCategories(prev => [...prev, newService.category as string]);
    }
  };

  const handleUpdateService = (updatedService: Service) => {
    if (!firestore || !tenantId) return;
    const serviceRef = doc(firestore, 'tenants', tenantId, 'services', updatedService.id);
    const sanitizedData = Object.fromEntries(
        Object.entries(updatedService).filter(([, value]) => value !== undefined)
    );
    updateDocumentNonBlocking(serviceRef, sanitizedData);

    if (updatedService.category && !serviceCategories.includes(updatedService.category)) {
      setServiceCategories(prev => [...prev, updatedService.category as string]);
    }
    toast({
        title: "Service Updated",
        description: `${updatedService.name} has been updated successfully.`
    })
  };

  const filteredServices = useMemo(() => {
    if (!services) return [];
    let servicesToFilter = services.filter(service => {
        return showArchived ? service.status === 'archived' : service.status !== 'archived';
    });
    if (searchTerm) {
        servicesToFilter = servicesToFilter.filter(service =>
          service.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
    return servicesToFilter;
  }, [services, searchTerm, showArchived]);

  const mainServices = filteredServices.filter(s => s.type === 'service');
  const addOnServices = filteredServices.filter(s => s.type === 'addon');
  
  const servicesByCategory = useMemo(() => mainServices.reduce((acc, service) => {
    const category = service.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>), [mainServices]);

  const addOnsByCategory = useMemo(() => addOnServices.reduce((acc, service) => {
    const category = service.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>), [addOnServices]);
  
  const hasServices = services && services.length > 0;

  return (
    <div className="w-full">
      <AppHeader title="Services" />
      <main className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
                <h1 className="text-3xl font-bold">Service Library</h1>
                <p className="text-muted-foreground">Your menu builder and profitability calculator.</p>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="outline" asChild>
                    <Link href="/services/report"><BarChart className="mr-2 h-4 w-4" />View Report</Link>
                </Button>
                <Button onClick={() => setIsAddServiceDialogOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Service
                </Button>
            </div>
        </div>
        <Card className="mb-6">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4">
                <div className="flex-1">
                    <Label htmlFor="tmhr-display" className="text-xs text-muted-foreground">Your Default TMHR</Label>
                    <p id="tmhr-display" className="text-2xl font-bold">${tmhr.toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/hr</span></p>
                </div>
                 <div className='flex items-center gap-2 w-full sm:w-auto'>
                    <Link href="/financials" className='w-full'>
                        <Button variant="outline" className='w-full'>
                            <SlidersHorizontal className="mr-2 h-4 w-4" /> Edit TMHR
                        </Button>
                    </Link>
                </div>
            </CardContent>
        </Card>

         <div className='flex flex-col md:flex-row gap-4 mb-6'>
            <div className="relative w-full md:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search services..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived">{showArchived ? "Viewing Archived" : "Show Archived"}</Label>
            </div>
        </div>
        
        {selectedItems.size > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                <p className="text-sm font-medium">{selectedItems.size} service(s) selected</p>
                <div className="flex gap-2">
                    {showArchived ? (
                        <Button variant="outline" size="sm" onClick={handleBulkUnarchive}>Unarchive</Button>
                    ) : (
                        <Button variant="outline" size="sm" onClick={handleBulkArchive}>Archive</Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={handleBulkDeleteClick}>Delete</Button>
                </div>
            </div>
        )}
        
        <Tabs defaultValue="services" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
          </TabsList>
          <TabsContent value="services" className="mt-6 space-y-8">
             {!hasServices && !isLoading ? (
                <EmptyState onAddNewService={() => setIsAddServiceDialogOpen(true)} />
            ) : Object.keys(servicesByCategory).length > 0 ? (
                Object.entries(servicesByCategory).map(([category, services]) => (
                    <ServiceCategory 
                        key={category} 
                        title={category} 
                        services={services} 
                        onEditServiceOpen={handleOpenEditService} 
                        tmhr={tmhr} 
                        appointments={appointments}
                        transactions={transactions}
                        onPriceUpdate={handlePriceUpdate}
                        selectedItems={selectedItems}
                        onSelectItem={handleItemSelect}
                    />
                ))
            ) : !isLoading ? (
                 <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No services match your filters.</p>
                    </CardContent>
                </Card>
            ) : null}
          </TabsContent>
          <TabsContent value="add-ons" className="mt-6 space-y-8">
             {Object.keys(addOnsByCategory).length > 0 ? (
                Object.entries(addOnsByCategory).map(([category, services]) => (
                    <ServiceCategory 
                        key={category} 
                        title={category} 
                        services={services} 
                        onEditServiceOpen={handleOpenEditService} 
                        tmhr={tmhr} 
                        appointments={appointments}
                        transactions={transactions}
                        onPriceUpdate={handlePriceUpdate}
                        selectedItems={selectedItems}
                        onSelectItem={handleItemSelect}
                    />
                ))
             ) : (
                <Card>
                    <CardContent className="text-center py-20">
                        <p className="text-muted-foreground">No add-on services yet. Add one to get started.</p>
                    </CardContent>
                </Card>
             )}
          </TabsContent>
        </Tabs>

      </main>

      <AddServiceDialog 
        open={isAddServiceDialogOpen} 
        onOpenChange={setIsAddServiceDialogOpen}
        initialType="service"
        categories={serviceCategories}
        onNewCategory={handleNewCategory}
        onServiceAdded={handleAddNewService}
        resources={resources || []}
        services={services || []}
      />
      {selectedService && (
        <EditServiceDialog 
            open={isEditServiceDialogOpen}
            onOpenChange={setIsEditServiceDialogOpen}
            service={selectedService}
            services={services || []}
            categories={serviceCategories}
            onNewCategory={handleNewCategory}
            onServiceUpdated={handleUpdateService}
            resources={resources || []}
        />
      )}

      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently delete {selectedItems.size} service(s). This action cannot be undone.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkDeleteConfirm} className={buttonVariants({ variant: "destructive" })}>
                    Delete
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}

