

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Clock, DollarSign, Sparkles, Box, List, Pencil, Search, SlidersHorizontal, Info, ShoppingCart, Hammer, FileText, BarChart, Users, TrendingUp, MapPin, Book, Calendar as CalendarIcon, Landmark, Link as LinkIcon, EyeOff, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { type Service, type InventoryItem, type Appointment, type Resource } from '@/lib/data';
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


const InlineProfitTester = ({ service, tmhr, onPriceUpdate }: { service: Service, tmhr: number, onPriceUpdate: (newPrice: number) => void; }) => {
  const [testPrice, setTestPrice] = useState(service.price);
  const { toast } = useToast();
  const { inventory } = useInventory();

  useEffect(() => {
    setTestPrice(service.price);
  }, [service.price]);

  const { profit, margin, breakEvenPoint } = useMemo(() => {
    const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;
    
    const productCost = (service.products || []).reduce((acc, p) => {
        const product = inventory.find(i => i.id === p.id);
        if (!product) return acc;

        let costPerUse = 0;
        if (product.costingMethod === 'size' && product.size && product.size > 0) {
            costPerUse = (product.costPerUnit || 0) / product.size;
        } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
            costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
        } else {
            costPerUse = product.costPerUnit || 0;
        }
        
        return acc + (costPerUse * (p.quantityUsed || 1));
    }, 0);

    const equipmentDepreciation = (service.requiredResourceIds || []).reduce((acc, resourceId) => {
        const equipmentItem = inventory.find(i => i.id === resourceId && i.type === 'equipment');
        if (!equipmentItem || !equipmentItem.lifespanYears || equipmentItem.lifespanYears === 0) return acc;

        const annualDepreciation = (equipmentItem.costPerUnit || 0) / equipmentItem.lifespanYears;
        const hourlyDepreciation = annualDepreciation / 2080; // Assuming 2080 work hours per year
        const serviceDurationHours = totalDuration / 60;
        
        return acc + (hourlyDepreciation * serviceDurationHours);
    }, 0);
    
    const breakEvenPoint = timeCost + productCost + equipmentDepreciation;

    const profitValue = testPrice - breakEvenPoint;
    const marginValue = testPrice > 0 ? (profitValue / testPrice) * 100 : 0;

    return { profit: profitValue, margin: marginValue, breakEvenPoint };
  }, [service, testPrice, tmhr, inventory]);
  
  const handleUpdateClick = () => {
    onPriceUpdate(testPrice);
    toast({
        title: "Price Updated",
        description: `${service.name} price is now $${testPrice.toFixed(2)}.`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label htmlFor={`price-slider-${service.id}`}>Test Price</Label>
          <div className="relative w-24">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id={`price-input-${service.id}`}
              type="number"
              value={testPrice}
              onChange={(e) => setTestPrice(Number(e.target.value) || 0)}
              className="h-8 pl-7 text-right font-semibold text-primary bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>
        <Slider
          id={`price-slider-${service.id}`}
          min={0}
          max={Math.max(service.price * 2 + 50, testPrice + 50)}
          step={1}
          value={[testPrice]}
          onValueChange={(value) => setTestPrice(value[0])}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Potential Profit</p>
          <p className={`text-lg font-bold ${profit >= 0 ? 'text-green-500' : 'text-destructive'}`}>
            ${profit.toFixed(2)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Profit Margin</p>
          <p className={`text-lg font-bold ${margin >= 0 ? 'text-green-500' : 'text-destructive'}`}>
            {margin.toFixed(1)}%
          </p>
        </div>
      </div>
       <div className='text-[10px] text-muted-foreground space-y-0.5 text-center'>
          <p>Break-Even: ${breakEvenPoint?.toFixed(2)}</p>
       </div>
       <Button size="sm" className="w-full" onClick={handleUpdateClick} disabled={testPrice === service.price}>
            Update Service Price
        </Button>
    </div>
  );
};

const CostBreakdown = ({ service, tmhr }: { service: Service; tmhr: number }) => {
  const { inventory } = useInventory();
  const { timeCost, productCosts, equipmentCosts, totalCost } = useMemo(() => {
    const totalDuration = (service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0);
    const timeCost = (totalDuration / 60) * tmhr;

    const productCosts = (service.products || []).map(p => {
        const product = inventory.find(i => i.id === p.id);
        let cost = 0;
        if (product) {
            let costPerUse = 0;
            if (product.costingMethod === 'size' && product.size && product.size > 0) {
                costPerUse = (product.costPerUnit || 0) / product.size;
            } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
            } else {
                costPerUse = product.costPerUnit || 0;
            }
            cost = costPerUse * (p.quantityUsed || 1);
        }
      return {
        ...p,
        cost: cost,
        location: 'Back Room - Shelf A' // Mock location
      }
    });

    const equipmentDepreciation = (service.requiredResourceIds || []).reduce((acc, resourceId) => {
        const equipmentItem = inventory.find(i => i.id === resourceId && i.type === 'equipment');
        if (!equipmentItem || !equipmentItem.lifespanYears || equipmentItem.lifespanYears === 0) return acc;

        const annualDepreciation = (equipmentItem.costPerUnit || 0) / equipmentItem.lifespanYears;
        const hourlyDepreciation = annualDepreciation / 2080; // Assuming 2080 work hours per year
        const serviceDurationHours = totalDuration / 60;
        
        return acc + (hourlyDepreciation * serviceDurationHours);
    }, 0);

    const totalProductCost = productCosts.reduce((acc, p) => acc + p.cost, 0);
    const totalEquipmentCost = equipmentCosts.reduce((acc, e) => acc + e.cost, 0);
    const totalCost = timeCost + totalProductCost + totalEquipmentCost;

    return { timeCost, productCosts, equipmentCosts, totalCost };
  }, [service, tmhr, inventory]);

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground"/>Time Cost</h4>
        <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md">
            <span>Your TMHR @ {((service.duration || 0) + (service.padBefore || 0) + (service.padAfter || 0))} min</span>
            <span className="font-semibold">${timeCost.toFixed(2)}</span>
        </div>
      </div>
       <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-muted-foreground"/>Product Costs</h4>
         {productCosts.length > 0 ? productCosts.map(p => (
            <div key={p.id} className="flex items-center justify-between bg-muted/50 p-2 rounded-md">
                <div className='flex items-center gap-2'>
                    <div className="w-8 h-8 bg-background rounded-sm flex-shrink-0">
                        <Image src={p.imageUrl || `https://picsum.photos/seed/inv${p.id}/100/100`} alt={p.name} width={32} height={32} className='rounded-sm object-cover h-full w-full' />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-medium text-xs">{p.name}</span>
                        <span className='text-xs text-muted-foreground flex items-center gap-1'><MapPin className="w-2.5 h-2.5"/>{p.location}</span>
                    </div>
                </div>
                <span className="font-semibold text-xs">${(p.cost || 0).toFixed(2)}</span>
            </div>
         )) : <p className="text-xs text-muted-foreground text-center p-2">No products in formula.</p>}
      </div>
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2"><Hammer className="w-4 h-4 text-muted-foreground"/>Equipment Depreciation</h4>
        {equipmentCosts.length > 0 ? equipmentCosts.map(e => (
             <div key={e.id} className="flex items-center justify-between bg-muted/50 p-2 rounded-md">
                <div className='flex items-center gap-2'>
                    <div className="w-8 h-8 bg-background rounded-sm flex-shrink-0">
                         <Image src={e.imageUrl || `https://picsum.photos/seed/inv${e.id}/100/100`} alt={e.name} width={32} height={32} className='rounded-sm object-cover h-full w-full' />
                    </div>
                    <span className="font-medium text-xs">{e.name}</span>
                </div>
                <span className="font-semibold text-xs">${e.cost.toFixed(2)}</span>
            </div>
         )) : <p className="text-xs text-muted-foreground text-center p-2">No equipment in formula.</p>}
      </div>
      <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
        <span>Total Service Cost (Break-Even):</span>
        <span>${totalCost.toFixed(2)}</span>
      </div>
    </div>
  );
};

const ServiceCard = ({ service, onEditServiceOpen, tmhr, appointments, onPriceUpdate, isSelected, onSelectItem }: { service: Service, onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null, onPriceUpdate: (serviceId: string, newPrice: number) => void, isSelected: boolean, onSelectItem: () => void }) => {
  const { toast } = useToast();
  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  
  const performance = useMemo(() => {
    if (!appointments) return { totalBookings: 0, totalRevenue: 0, uniqueClients: 0 };
    const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
    const totalRevenue = bookings.length * service.price;
    const uniqueClients = new Set(bookings.map(apt => apt.clientId)).size;
    return {
        totalBookings: bookings.length,
        totalRevenue,
        uniqueClients
    };
  }, [service.id, service.price, appointments]);

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
    const tierOrder = ['junior', 'senior', 'master'];
    return [...service.pricingTiers].sort((a, b) => tierOrder.indexOf(a.level) - tierOrder.indexOf(b.level));
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
          <div className="flex-1 space-y-1 min-w-0">
            <div className="flex justify-between items-start">
              <Link href={`/services/${service.id}`} className="group">
                <p className="font-semibold text-base leading-tight group-hover:underline pr-2">{service.name}</p>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-1 h-8 w-8 flex-shrink-0'>
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEditServiceOpen(service)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {service.isPrivate && (
                <Badge variant="secondary" className="text-xs">
                    <EyeOff className="w-3 h-3 mr-1.5" />
                    Private
                </Badge>
            )}
            <div className="text-sm text-muted-foreground space-y-1 pt-1">
                <div className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {service.duration} min {totalPadding > 0 && <span className='text-muted-foreground/50'>(+{totalPadding} pad)</span>}</div>
                <div className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" /> 
                    {sortedTiers ? (
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs font-medium">
                            {sortedTiers.map(tier => (
                                <div key={tier.level} className="flex items-center gap-1">
                                    <span className="capitalize text-muted-foreground">{tier.level.charAt(0)}:</span>
                                    <span>${tier.price.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <span>{service.price.toFixed(2)}</span>
                    )}
                </div>
                {service.capacity && service.capacity > 1 && <div className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Up to {service.capacity}</div>}
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="font-semibold text-destructive">${service.cost.toFixed(2)}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Profit</p>
                <p className={`font-semibold ${service.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>${service.profit.toFixed(2)}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`font-semibold ${service.margin >= 0 ? 'text-primary' : 'text-destructive'}`}>{service.margin.toFixed(0)}%</p>
            </div>
        </div>

        <Accordion type="multiple" className="w-full">
            <AccordionItem value="details" className="border-b-0">
                <AccordionTrigger className='p-2.5 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>
                    <div className='flex items-center gap-2'>
                         <Sparkles className='w-4 h-4 text-primary' /> More Details
                    </div>
                </AccordionTrigger>
                <AccordionContent className='pt-4 space-y-4'>
                    <Tabs defaultValue="performance">
                        <TabsList className="grid w-full grid-cols-3 text-xs h-8 rounded-sm">
                            <TabsTrigger value="performance" className="h-full rounded-sm">Performance</TabsTrigger>
                            <TabsTrigger value="profit" className="h-full rounded-sm">Profit Tester</TabsTrigger>
                            <TabsTrigger value="cost" className="h-full rounded-sm">Cost Breakdown</TabsTrigger>
                        </TabsList>
                        <TabsContent value="performance" className="mt-4">
                            <div className='grid grid-cols-3 gap-2'>
                                <div className='text-center p-2 rounded-md bg-background'>
                                    <p className="text-xs text-muted-foreground">Bookings</p>
                                    <p className='font-bold text-lg'>{performance.totalBookings}</p>
                                </div>
                                <div className='text-center p-2 rounded-md bg-background'>
                                    <p className="text-xs text-muted-foreground">Revenue</p>
                                    <p className='font-bold text-base'>${performance.totalRevenue.toFixed(2)}</p>
                                </div>
                                <div className='text-center p-2 rounded-md bg-background'>
                                    <p className="text-xs text-muted-foreground">Clients</p>
                                    <p className='font-bold text-lg'>{performance.uniqueClients}</p>
                                </div>
                            </div>
                        </TabsContent>
                        <TabsContent value="profit" className="mt-4">
                             <InlineProfitTester service={service} tmhr={tmhr} onPriceUpdate={(newPrice) => onPriceUpdate(service.id, newPrice)} />
                        </TabsContent>
                         <TabsContent value="cost" className="mt-4">
                            <CostBreakdown service={service} tmhr={tmhr} />
                        </TabsContent>
                    </Tabs>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
       <CardFooter className="p-2 border-t bg-muted/50">
            <div className="grid grid-cols-1 gap-2 w-full">
                <Button variant="ghost" size="sm" className="w-full" onClick={handleCopyLink}><LinkIcon className="mr-2 h-4 w-4"/>Share Booking Link</Button>
            </div>
        </CardFooter>
    </Card>
  );
};

const ServiceCategory = ({ title, services, onEditServiceOpen, tmhr, appointments, onPriceUpdate, selectedItems, onSelectItem }: { title: string, services: Service[], onEditServiceOpen: (service: Service) => void, tmhr: number, appointments: Appointment[] | null, onPriceUpdate: (serviceId: string, newPrice: number) => void, selectedItems: Set<string>, onSelectItem: (id: string) => void }) => {
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
  const { services, appointments, resources, isLoading } = useInventory();
  

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
    const storedTmhr = localStorage.getItem('tmhr');
    if (storedTmhr) {
      setTmhr(parseFloat(storedTmhr));
    }
  }, []);

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
