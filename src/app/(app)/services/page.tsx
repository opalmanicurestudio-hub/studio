'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PlusCircle, Clock, Sparkles, Pencil, Search, SlidersHorizontal,
  Calculator, Check, Link as LinkIcon, BarChart, ArrowRight, BookOpen,
} from 'lucide-react';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { type Service, type Appointment, type Transaction, type PricingTier } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AddServiceDialog, EditServiceDialog } from '@/components/services/ServiceFormSheet';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import {
  useFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking,
} from '@/firebase';
import { doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTenant } from '@/context/TenantContext';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface ServiceCardProps {
  service: Service;
  onEditServiceOpen: (service: Service) => void;
  tmhr: number;
  taxBurden: number;
  appointments: Appointment[] | null;
  transactions: Transaction[] | null;
  onPriceUpdate: (serviceId: string, newPrice: number) => void;
  isSelected: boolean;
  onSelectItem: () => void;
  pricingTiers: PricingTier[];
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  service, onEditServiceOpen, tmhr, taxBurden, appointments, transactions,
  isSelected, onSelectItem, pricingTiers,
}) => {
  const { toast } = useToast();
  const { staff, inventory } = useInventory();
  const totalPadding = (service.padBefore || 0) + (service.padAfter || 0);
  const totalDuration = (service.duration || 0) + totalPadding;

  const performance = useMemo(() => {
    if (!appointments || !transactions) return { totalBookings: 0, totalRevenue: 0 };
    const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
    const bookingIds = new Set(bookings.map(b => b.id));
    const totalRevenue = transactions
      .filter(t => t.appointmentId && bookingIds.has(t.appointmentId) && t.category === 'Service Revenue')
      .reduce((total, t) => total + t.amount, 0);
    return { totalBookings: bookings.length, totalRevenue };
  }, [service.id, appointments, transactions]);

  const materialCost = useMemo(() => {
    return (service.products || []).reduce((acc, p) => {
      const product = inventory.find(i => i.id === p.id);
      if (!product) return acc;
      let cpu = product.costPerUnit || 0;
      if (product.costingMethod === 'size' && product.size) cpu = cpu / product.size;
      else if (product.costingMethod === 'uses' && product.estimatedUses) cpu = cpu / product.estimatedUses;
      return acc + (p.quantityUsed * cpu);
    }, 0);
  }, [service.products, inventory]);

  const timeCost = (totalDuration / 60) * tmhr;

  const tierAnalysis = useMemo(() => {
    return pricingTiers.sort((a, b) => a.rank - b.rank).map(tier => {
      const tc = service.serviceTiers?.find(t => t.tierId === tier.id);
      const price = tc ? tc.price : service.price;
      const duration = tc ? tc.durationMinutes : service.duration;
      const relevantStaff = staff.filter(s => s.pricingTierId === tier.id);
      const staffAnalysis = relevantStaff.map(member => {
        let laborCost = 0;
        if (member.payStructure === 'hourly' && member.hourlyRate) laborCost = (duration / 60) * member.hourlyRate;
        else if (member.payStructure === 'hourly_plus_commission' && member.hourlyRate) laborCost = ((duration / 60) * member.hourlyRate) + (price * ((member.commissionRate || 40) / 100));
        else laborCost = price * ((member.commissionRate || 40) / 100);
        const burdenedLabor = laborCost * (1 + (taxBurden / 100));
        const studioNet = price - materialCost - timeCost - burdenedLabor;
        const margin = price > 0 ? (studioNet / price) * 100 : 0;
        return { id: member.id, name: member.name, avatarUrl: member.avatarUrl, studioNet, margin };
      });
      return { ...tier, price, staffAnalysis };
    });
  }, [pricingTiers, service, staff, materialCost, timeCost, taxBurden]);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/book/${service.id}`);
    toast({ title: 'Link Copied!', description: 'Direct booking URL is on your clipboard.' });
  };

  return (
    <Card className={cn(
      'transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col',
      isSelected ? 'border-primary ring-4 ring-primary/10 shadow-2xl translate-y-[-4px]' : 'border-border/50 bg-white hover:border-primary/20 shadow-sm',
    )}>
      <CardContent className="p-6 md:p-8 space-y-6 flex-1 flex flex-col" onClick={onSelectItem}>
        <div className="flex items-start gap-4 cursor-pointer">
          <Checkbox
            id={`select-${service.id}`}
            checked={isSelected}
            onCheckedChange={onSelectItem}
            className="h-6 w-6 rounded-lg border-2 shadow-inner mt-1"
            onClick={e => e.stopPropagation()}
          />
          <Link href={`/services/${service.id}`} className="relative shrink-0" onClick={e => e.stopPropagation()}>
            <Avatar className="w-16 h-16 md:w-20 md:h-20 border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2rem] overflow-hidden transition-transform group-hover:scale-105 duration-500">
              <AvatarImage src={service.imageUrl} alt={service.name} className="object-cover" />
              <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(service.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 text-left">
              <p className="font-black uppercase tracking-tight text-base md:text-lg text-slate-900 truncate leading-none">{service.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 tracking-widest">{service.category}</p>
              {service.isPrivate && <Badge variant="secondary" className="h-4 px-1.5 font-black text-[7px] uppercase border-none bg-muted/50">Private</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-primary/60">
                <Clock className="w-3 h-3" />{service.duration}m
              </div>
              {totalPadding > 0 && (
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-muted-foreground opacity-40">
                  +{totalPadding}m Pad
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-primary/10 transition-all text-left">
            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Volume</p>
            <p className="text-xl font-black font-mono tracking-tighter text-slate-900">{performance.totalBookings}</p>
          </div>
          <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-primary/10 transition-all text-right">
            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Gross Yield</p>
            <p className="text-xl font-black font-mono tracking-tighter text-slate-900">${performance.totalRevenue.toFixed(0)}</p>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="profitability" className="border-2 rounded-2xl overflow-hidden bg-primary/[0.02] border-primary/10">
            <AccordionTrigger className="px-4 py-3 h-10 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-primary">
              <Sparkles className="w-3.5 h-3.5 mr-2 opacity-40" /> Studio Net Matrix
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
              {tierAnalysis.map(tier => (
                <div key={tier.id} className="space-y-2">
                  <div className="flex justify-between items-center px-1 text-left">
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{tier.name}</span>
                    <span className="font-mono text-[9px] font-black text-slate-900">${tier.price.toFixed(2)}</span>
                  </div>
                  <div className="grid gap-1.5">
                    {tier.staffAnalysis.length > 0 ? tier.staffAnalysis.map(sa => (
                      <div key={sa.id} className={cn('p-2 rounded-xl border-2 flex justify-between items-center bg-white transition-all', sa.studioNet >= 0 ? 'border-primary/5' : 'border-red-100')}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-6 w-6 border shadow-inner">
                            <AvatarImage src={sa.avatarUrl} className="object-cover" />
                            <AvatarFallback className="text-[7px] font-black">{(sa.name || 'S')[0]}</AvatarFallback>
                          </Avatar>
                          <span className="font-black uppercase text-[9px] truncate text-slate-700">{sa.name.split(' ')[0]}</span>
                        </div>
                        <span className={cn('font-black font-mono text-[10px]', sa.studioNet >= 0 ? 'text-primary' : 'text-destructive')}>
                          ${sa.studioNet.toFixed(2)}
                        </span>
                      </div>
                    )) : (
                      <div className="p-2 rounded-xl border-2 border-dashed bg-muted/5 text-center">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">No staff assigned</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>

      <CardFooter className="p-3 border-t bg-muted/5 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="icon"
                  className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-primary/5 hover:border-primary/30 text-primary transition-all active:scale-90"
                  onClick={e => { e.stopPropagation(); onEditServiceOpen(service); }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Modify Record</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="icon"
                  className="h-10 w-10 rounded-xl border-2 shadow-sm bg-white hover:bg-primary/5 hover:border-primary/30 text-primary transition-all active:scale-90"
                  onClick={handleCopyLink}
                >
                  <LinkIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Copy Link</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Button variant="ghost" asChild className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn">
          <Link href={`/services/${service.id}`} onClick={e => e.stopPropagation()}>
            View Analysis <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
};

const EmptyState = ({ onAddNewService }: { onAddNewService: () => void }) => (
  <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
    <div className="w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner">
      <BookOpen className="w-12 h-12 text-muted-foreground" />
    </div>
    <div className="space-y-2 text-center">
      <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Library is Empty</h3>
      <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
        Populate your menu to unlock automated breakeven analysis and client booking.
      </p>
    </div>
    <Button size="lg" onClick={onAddNewService} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 mt-4">
      <PlusCircle className="mr-2 h-5 w-5" />Add First Treatment
    </Button>
  </div>
);

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
  const [serviceCategories, setServiceCategories] = useState<string[]>([]);

  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const taxBurden = selectedTenant?.employerTaxBurdenPct || 10;
  const { services, appointments, resources, isLoading, transactions, pricingTiers } = useInventory();

  useEffect(() => { setTmhr(selectedTenant?.tmhr ?? 50); }, [selectedTenant]);

  useEffect(() => {
    if (services) {
      const cats = services.map(s => s.category).filter((c): c is string => !!c);
      setServiceCategories([...new Set(cats)]);
    }
  }, [services]);

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }, []);

  const handleBulkArchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id), { status: 'archived' }));
    toast({ title: `${selectedItems.size} service(s) archived.` });
    setSelectedItems(new Set());
  }, [selectedItems, firestore, tenantId, toast]);

  const handleBulkUnarchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id), { status: 'active' }));
    toast({ title: `${selectedItems.size} service(s) restored.` });
    setSelectedItems(new Set());
  }, [selectedItems, firestore, tenantId, toast]);

  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const count = selectedItems.size;
    selectedItems.forEach(id => deleteDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'services', id)));
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({ title: 'Services Deleted', description: `${count} service(s) removed.` });
  }, [selectedItems, firestore, tenantId, toast]);

  const handleOpenEditService = (service: Service) => {
    setSelectedService(service);
    setIsEditServiceDialogOpen(true);
  };

  const handleNewCategory = (cat: string) => {
    if (!serviceCategories.includes(cat)) setServiceCategories(prev => [...prev, cat]);
  };

  const handleAddNewService = (newService: Service) => {
    if (!firestore || !tenantId) return;
    const ref = doc(firestore, 'tenants', tenantId, 'services', newService.id);
    const data = Object.fromEntries(Object.entries(newService).filter(([, v]) => v !== undefined));
    setDocumentNonBlocking(ref, data, {});
    if (newService.category && !serviceCategories.includes(newService.category))
      setServiceCategories(prev => [...prev, newService.category as string]);
  };

  const handleUpdateService = (updated: Service) => {
    if (!firestore || !tenantId) return;
    const ref = doc(firestore, 'tenants', tenantId, 'services', updated.id);
    const data = Object.fromEntries(Object.entries(updated).filter(([, v]) => v !== undefined));
    updateDocumentNonBlocking(ref, data);
    if (updated.category && !serviceCategories.includes(updated.category))
      setServiceCategories(prev => [...prev, updated.category as string]);
    toast({ title: 'Service Updated', description: `${updated.name} has been updated.` });
  };

  const filteredServices = useMemo(() => {
    if (!services) return [];
    return services
      .filter(s => showArchived ? s.status === 'archived' : s.status !== 'archived')
      .filter(s => !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [services, searchTerm, showArchived]);

  const mainServices = filteredServices.filter(s => s.type === 'service');
  const addOnServices = filteredServices.filter(s => s.type === 'addon');
  const hasServices = services && services.length > 0;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Service Library" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 text-left">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Menu</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Treatment catalog & profitability matrix</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button variant="outline" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white/50 backdrop-blur-sm">
              <Link href="/services/report"><BarChart className="mr-2 h-4 w-4" /> Reports</Link>
            </Button>
            <Button onClick={() => setIsAddServiceDialogOpen(true)} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
              <PlusCircle className="mr-2 h-4 w-4" /> New Service
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-10 items-start">
          <div className="lg:col-span-2 xl:col-span-3 space-y-8 min-w-0">
            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
              <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-8 text-left">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                  <Input
                    placeholder="SEARCH SERVICES & TREATMENTS..."
                    className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="p-4 md:p-6 bg-primary/[0.03] rounded-3xl border-2 border-dashed border-primary/20 flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-xl"><SlidersHorizontal className="w-4 h-4 text-primary" /></div>
                    <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">Library Matrix</h4>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="show-archived-svc" checked={showArchived} onCheckedChange={setShowArchived} />
                    <Label htmlFor="show-archived-svc" className="text-[10px] font-black uppercase tracking-widest cursor-pointer text-slate-600">Archived</Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                {selectedItems.size > 0 && (
                  <div className="mb-8 p-5 rounded-[2rem] bg-slate-900 text-white flex items-center justify-between shadow-2xl animate-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-white/10 rounded-xl"><Check className="w-5 h-5" /></div>
                      <p className="text-xs font-black uppercase tracking-widest">{selectedItems.size} Selected</p>
                    </div>
                    <div className="flex gap-2">
                      {showArchived
                        ? <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkUnarchive}>Restore</Button>
                        : <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkArchive}>Archive</Button>
                      }
                      <Button variant="destructive" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest" onClick={() => setIsBulkDeleteConfirmOpen(true)}>Purge</Button>
                    </div>
                  </div>
                )}

                <Tabs defaultValue="services" className="w-full">
                  <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8">
                    <TabsTrigger value="services" className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Treatments</TabsTrigger>
                    <TabsTrigger value="add-ons" className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Enhancements</TabsTrigger>
                  </TabsList>
                  <TabsContent value="services" className="mt-0">
                    {!hasServices && !isLoading ? (
                      <EmptyState onAddNewService={() => setIsAddServiceDialogOpen(true)} />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {mainServices.map(service => (
                          <ServiceCard
                            key={service.id} service={service} onEditServiceOpen={handleOpenEditService}
                            tmhr={tmhr} taxBurden={taxBurden} appointments={appointments}
                            transactions={transactions} onPriceUpdate={() => {}}
                            isSelected={selectedItems.has(service.id)}
                            onSelectItem={() => handleItemSelect(service.id)}
                            pricingTiers={pricingTiers || []}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="add-ons" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {addOnServices.map(service => (
                        <ServiceCard
                          key={service.id} service={service} onEditServiceOpen={handleOpenEditService}
                          tmhr={tmhr} taxBurden={taxBurden} appointments={appointments}
                          transactions={transactions} onPriceUpdate={() => {}}
                          isSelected={selectedItems.has(service.id)}
                          onSelectItem={() => handleItemSelect(service.id)}
                          pricingTiers={pricingTiers || []}
                        />
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="hidden lg:block lg:col-span-1 space-y-6">
            <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <Calculator className="w-24 h-24 text-primary" />
              </div>
              <CardHeader className="p-8 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />Efficiency Hub
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8 pt-0 text-left">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Studio Floor Rate</p>
                <p className="text-5xl font-black text-primary tracking-tighter font-mono leading-none">${tmhr.toFixed(2)}</p>
                <div className="mt-6 p-4 rounded-2xl bg-white/50 border border-primary/10 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-2">Base Metric</p>
                  <p className="text-xs font-medium text-slate-600 leading-relaxed uppercase tracking-tight">
                    Every session is evaluated against this hourly breakeven threshold to ensure studio growth.
                  </p>
                </div>
                <Button variant="outline" asChild className="w-full mt-6 h-12 rounded-xl border-2 font-black uppercase tracking-widest text-[9px] bg-white shadow-sm">
                  <Link href="/financials">Recalculate Foundation</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
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
          categories={serviceCategories}
          onNewCategory={handleNewCategory}
          onServiceUpdated={handleUpdateService}
          resources={resources || []}
        />
      )}

      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
          <AlertDialogHeader className="p-6 pb-0 text-left">
            <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Menu Items</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
              Permanently delete {selectedItems.size} services. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
            <Button onClick={handleBulkDeleteConfirm} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Services</Button>
            <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
