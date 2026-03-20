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
import { ArrowLeft, Edit, PlusCircle, Trash2, User, Wrench, DollarSign, FlaskConical, Calendar as CalendarIcon, Rocket, CheckCircle, Percent, TrendingUp, Hammer, Tag, Truck, QrCode } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, differenceInMonths, parseISO, differenceInYears } from 'date-fns';
import { type MaintenanceRecord, type Service, type LifespanTestResult, type InventoryItem } from '@/lib/data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { EndCostPerUseTestDialog } from '@/components/inventory/EndCostPerUseTestDialog';
import { useToast } from '@/hooks/use-toast';
import { EditEquipmentDialog } from '@/components/inventory/EditEquipmentDialog';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';

const LogMaintenanceDialog = ({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: Omit<MaintenanceRecord, 'id'>) => void;
}) => {
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState(0);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [imageUrl, setImageUrl] = useState('');

  const handleSave = () => {
    if (!date) return;
    onSave({ date: date.toISOString(), description, cost, imageUrl });
    onOpenChange(false);
    setDescription('');
    setCost(0);
    setDate(new Date());
    setImageUrl('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Maintenance</DialogTitle>
          <DialogDescription>Record a new maintenance or repair event.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="maintenance-date">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="maintenance-date"
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-description">Description</Label>
            <Textarea
              id="maintenance-description"
              placeholder="e.g., Replaced UV bulb, Calibrated sensors"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-cost">Cost</Label>
            <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                id="maintenance-cost"
                type="number"
                value={cost || ''}
                onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="pl-8"
                />
            </div>
          </div>
           <div className="space-y-2">
            <Label>Photo Evidence</Label>
            <ImageUpload onImageUploaded={setImageUrl} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { inventory, locations, services, appointments, clients } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const [isLogMaintenanceOpen, setIsLogMaintenanceOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrModalContent, setQrModalContent] = useState({ url: '', alt: '', title: '' });
  
  const equipment = inventory.find((p) => p.id === id && p.type === 'equipment');
  
  const handleEquipmentUpdate = (updatedEquipment: InventoryItem) => {
    if (!firestore || !selectedTenant) return;
    const itemRef = doc(firestore, 'tenants', selectedTenant.id, 'inventory', updatedEquipment.id);
    updateDocumentNonBlocking(itemRef, updatedEquipment);
    toast({
        title: "Asset Synchronized",
        description: "Capital equipment updates committed to ledger.",
    });
    setIsEditDialogOpen(false);
  };
  
  const equipmentCategories = useMemo(() => {
    const allCategories = inventory.filter(i => i.type === 'equipment').map(p => p.category).filter((c): c is string => !!c);
    return [...new Set(allCategories)];
  }, [inventory]);

  const { purchaseCost, monthlyDepreciation, accumulatedDepreciation, bookValue, serviceMonths } = useMemo(() => {
    if (!equipment) return { purchaseCost: 0, monthlyDepreciation: 0, accumulatedDepreciation: 0, bookValue: 0, serviceMonths: 0 };
    
    const purchaseCost = equipment.costPerUnit || 0;
    const lifespanMonths = (equipment.lifespanYears || 5) * 12;
    const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
    
    const purchaseDate = equipment.batches[0]?.receivedDate ? parseISO(equipment.batches[0].receivedDate) : new Date();
    const monthsInService = differenceInMonths(new Date(), purchaseDate);
    
    const calculatedAccumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
    const calculatedBookValue = purchaseCost - calculatedAccumulatedDepreciation;

    return {
        purchaseCost,
        monthlyDepreciation,
        accumulatedDepreciation: calculatedAccumulatedDepreciation,
        bookValue: calculatedBookValue,
        serviceMonths: monthsInService,
    };
  }, [equipment]);
  
  const usageHistory = useMemo(() => {
    if (!equipment || !appointments) return [];
    
    return appointments
      .filter(apt => {
        if (apt.status !== 'completed') return false;
        const service = services.find(s => s.id === apt.serviceId);
        return service?.requiredResourceIds?.includes(equipment.id);
      })
      .map(apt => ({
          ...apt,
          client: clients.find(c => c.id === apt.clientId),
          service: services.find(s => s.id === apt.serviceId),
      }))
      .sort((a,b) => parseISO(b.endTime).getTime() - parseISO(a.endTime).getTime());

  }, [equipment, appointments, services, clients]);

  const handleSaveMaintenance = (entry: Omit<MaintenanceRecord, 'id'>) => {
    if (!equipment || !firestore || !selectedTenant) return;
    const newRecord: MaintenanceRecord = { ...entry, id: `maint-${nanoid()}` };
    const updatedHistory = [...(equipment.maintenanceHistory || []), newRecord];
    
    const itemRef = doc(firestore, 'tenants', selectedTenant.id, 'inventory', equipment.id);
    updateDocumentNonBlocking(itemRef, { maintenanceHistory: updatedHistory });
    toast({ title: "Maintenance Logged", description: "Audit trail updated successfully." });
  };

  const handleToggleExperiment = () => {
    if (!equipment || !firestore || !selectedTenant) return;
    
    const itemRef = doc(firestore, 'tenants', selectedTenant.id, 'inventory', equipment.id);
    if (equipment.isExperimentActive) {
        setIsEndExperimentOpen(true);
    } else {
        updateDocumentNonBlocking(itemRef, { isExperimentActive: true, experimentUses: 0 });
        toast({ title: "Test Triggered", description: "Yield experiment is now live." });
    }
  }

  const handleEndExperimentConfirmed = (results: LifespanTestResult) => {
    if (!equipment || !firestore || !selectedTenant) return;
    
    const itemRef = doc(firestore, 'tenants', selectedTenant.id, 'inventory', equipment.id);
    updateDocumentNonBlocking(itemRef, { isExperimentActive: false, lastTestResult: results });
    toast({ title: "Test Concluded", description: "Actuals committed to dossier." });
    setIsEndExperimentOpen(false);
  };
  
  if (!equipment) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Equipment Details" />
            <main className="flex-1 p-4 md:p-8 space-y-6 text-left">
                <div>Asset not found in registry.</div>
            </main>
        </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Asset Dossier" />
      <main className="flex-1 p-4 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-left w-full sm:w-auto">
                <Button variant="outline" size="sm" asChild className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                    <Link href="/inventory">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Return
                    </Link>
                </Button>
                <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate">Asset Record</h1>
            </div>
            <Button size="sm" className="h-12 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20 w-full sm:w-auto" onClick={() => setIsEditDialogOpen(true)}>
                <Edit className="h-4 w-4 mr-2"/>
                Modify Detail
            </Button>
        </div>

        <Card className="border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all text-left">
            <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
                <div className="relative shrink-0">
                    <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2rem] md:rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl bg-muted/20 relative flex items-center justify-center">
                        {equipment.imageUrl ? (
                            <Image src={equipment.imageUrl} alt={equipment.name} fill className='object-cover' />
                        ) : (
                            <Hammer className="w-16 h-16 md:w-24 md:h-24 text-muted-foreground/30" />
                        )}
                    </div>
                </div>
                <div className="space-y-4 flex-1 min-w-0 text-left">
                    <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3 md:gap-4 text-left">
                        <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none">{equipment.name}</h2>
                        <div className="flex gap-2">
                            <Badge variant="outline" className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-2">{equipment.category}</Badge>
                            {equipment.isExperimentActive && (
                                <Badge className="h-6 px-3 rounded-full font-black text-[8px] md:text-[9px] uppercase tracking-widest border-none bg-purple-600 text-white shadow-lg animate-pulse">
                                    <FlaskConical className="h-3 w-3 mr-1.5" /> Yield Test Live
                                </Badge>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap justify-center sm:justify-start gap-x-10 gap-y-4 pt-2 text-left">
                        <div className="space-y-1">
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Vendor Origin</p>
                            <p className="text-base md:text-xl font-black uppercase tracking-tight text-slate-700">{equipment.supplier || 'Private Registry'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Asset Identifier (SKU)</p>
                            <p className="text-base md:text-xl font-black font-mono tracking-tighter text-primary">{equipment.sku || equipment.id.slice(-6).toUpperCase()}</p>
                        </div>
                    </div>

                    {equipment.description && (
                        <div className="pt-4 space-y-1 text-left">
                            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Operational Context</p>
                            <p className="text-xs md:text-sm font-medium text-slate-600 leading-relaxed italic border-l-4 border-primary/20 pl-4 text-left">
                                "{equipment.description}"
                            </p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
             <Card className="lg:col-span-2 border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Financial Matrix</CardTitle></CardHeader>
                <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-5 rounded-2xl bg-muted/20 border-2 shadow-inner text-left">
                        <div className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mb-1">Purchase Investment</div>
                        <div className="text-2xl font-black font-mono tracking-tighter">${purchaseCost.toFixed(2)}</div>
                    </div>
                     <div className="p-5 rounded-2xl bg-muted/20 border-2 shadow-inner text-left">
                        <div className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mb-1">Monthly Yield Load</div>
                        <div className="text-2xl font-black font-mono tracking-tighter">${monthlyDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-5 rounded-2xl bg-muted/20 border-2 shadow-inner text-left">
                        <div className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mb-1">Accumulated Depreciation</div>
                        <div className="text-2xl font-black font-mono tracking-tighter text-destructive">-${accumulatedDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-5 rounded-2xl bg-primary/5 border-4 border-primary/10 text-left shadow-xl">
                        <div className="text-[9px] font-black uppercase text-primary tracking-widest mb-1">Current Registry Value</div>
                        <div className="text-3xl font-black font-mono tracking-tighter text-primary">${bookValue.toFixed(2)}</div>
                    </div>
                </CardContent>
             </Card>
             <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Lifespan Audit</CardTitle></CardHeader>
                <CardContent className="p-6 space-y-6 text-left">
                     <div className="flex justify-between items-center p-4 bg-muted/20 rounded-xl border-2">
                        <span className="text-[10px] font-black uppercase text-slate-600">Operational Window</span>
                        <span className="font-mono font-black text-sm">{serviceMonths} MONTHS</span>
                    </div>
                     {equipment.lastTestResult && !equipment.isExperimentActive && (
                        <div className="p-5 rounded-2xl bg-indigo-50 border-2 border-indigo-100 space-y-4">
                            <p className="text-[9px] font-black uppercase text-indigo-600 tracking-widest text-center">Protocol Audit Result</p>
                            <div className="grid gap-2">
                                <div className="flex justify-between text-[10px] font-bold uppercase"><span className="opacity-60">Verified Revenue</span> <span>${equipment.lastTestResult.totalRevenue.toFixed(0)}</span></div>
                                <div className="flex justify-between text-[10px] font-bold uppercase"><span className="opacity-60">Maintenance Expense</span> <span className="text-destructive">-${equipment.lastTestResult.totalMaintenanceCost.toFixed(0)}</span></div>
                                <Separator className="bg-indigo-200" />
                                <div className="flex justify-between items-baseline"><span className="text-xs font-black uppercase text-indigo-700">Audit ROI</span> <span className="text-2xl font-black font-mono text-indigo-700">{equipment.lastTestResult.roi.toFixed(1)}%</span></div>
                            </div>
                        </div>
                     )}
                    <Button variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-white" onClick={handleToggleExperiment}>
                        {equipment.isExperimentActive ? <><CheckCircle className="mr-2 h-4 w-4"/>Conclude Yield Test</> : <><Rocket className="mr-2 h-4 w-4"/>Trigger Performance Test</>}
                    </Button>
                </CardContent>
             </Card>
        </div>

        <div className="grid gap-10 md:grid-cols-2">
            <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-sm font-black uppercase tracking-widest">Maintenance Archive</CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Audit trail of all technical interventions.</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white" onClick={() => setIsLogMaintenanceOpen(true)}><PlusCircle className="mr-2 h-3.5 w-3.5"/>Append Log</Button>
                </CardHeader>
                <CardContent className="p-0">
                     <Table>
                        <TableHeader className="bg-muted/10">
                            <TableRow>
                                <TableHead className="font-black text-[9px] uppercase tracking-widest p-4">Effective Date</TableHead>
                                <TableHead className="font-black text-[9px] uppercase tracking-widest">Protocol Detail</TableHead>
                                <TableHead className="text-right font-black text-[9px] uppercase tracking-widest pr-6">Distribution</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {equipment.maintenanceHistory && equipment.maintenanceHistory.length > 0 ? (
                                [...equipment.maintenanceHistory].sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()).map(log => (
                                    <TableRow key={log.id} className="group hover:bg-muted/5">
                                        <TableCell className="p-4 text-[10px] font-black uppercase text-slate-600">{format(parseISO(log.date), 'MMM d, yyyy')}</TableCell>
                                        <TableCell className="text-[10px] font-medium text-slate-500 uppercase">{log.description}</TableCell>
                                        <TableCell className="text-right pr-6 font-black font-mono text-xs text-destructive">-${log.cost.toFixed(2)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="py-16 text-center opacity-30 font-black uppercase text-[10px] tracking-widest">
                                        Archive Idle
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white text-left">
                <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-sm font-black uppercase tracking-widest">Operational Usage History</CardTitle><CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Registry of technical deployment events.</CardDescription></CardHeader>
                <CardContent className="p-0">
                      <Table>
                        <TableHeader className="bg-muted/10">
                            <TableRow>
                                <TableHead className="font-black text-[9px] uppercase tracking-widest p-4">Timestamp</TableHead>
                                <TableHead className="font-black text-[9px] uppercase tracking-widest">Guest Payer</TableHead>
                                <TableHead className="font-black text-[9px] uppercase tracking-widest">Assigned Protocol</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {usageHistory.length > 0 ? (
                                usageHistory.map(apt => (
                                    <TableRow key={apt.id} className="group hover:bg-muted/5">
                                        <TableCell className="p-4 text-[10px] font-black uppercase text-slate-600">{format(parseISO(apt.endTime), 'MMM d, p')}</TableCell>
                                        <TableCell className="text-[10px] font-black uppercase tracking-tight text-slate-900">{apt.client?.name || 'Walk-in'}</TableCell>
                                        <TableCell className="text-[10px] font-bold text-primary uppercase truncate max-w-[150px]">{apt.service?.name || 'Service'}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="py-16 text-center opacity-30 font-black uppercase text-[10px] tracking-widest">
                                        History Empty
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
        <LogMaintenanceDialog 
            open={isLogMaintenanceOpen} 
            onOpenChange={setIsLogMaintenanceOpen}
            onSave={handleSaveMaintenance}
        />
        {equipment && <EndCostPerUseTestDialog 
            open={isEndExperimentOpen} 
            onOpenChange={setIsEndExperimentOpen}
            product={equipment}
            onConfirm={handleEndExperimentConfirmed}
            usageHistory={usageHistory}
        />}
        {equipment && (
            <EditEquipmentDialog 
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                equipment={equipment}
                onEquipmentUpdated={handleEquipmentUpdate}
                equipmentCategories={equipmentCategories}
                onNewCategory={() => {}}
                locations={locations}
            />
        )}
        <Dialog open={isQrModalOpen} onOpenChange={setIsQrModalOpen}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden">
                <DialogHeader className="p-8 pb-4 border-b bg-muted/5">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter">{qrModalContent.title}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col items-center justify-center p-12 space-y-8">
                    <div className="p-6 bg-white rounded-[2.5rem] shadow-2xl border-4 border-primary/10">
                        <Image
                            src={qrModalContent.url}
                            alt={qrModalContent.alt}
                            width={220}
                            height={220}
                            className="object-contain rounded-md"
                        />
                    </div>
                    <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-center max-w-[240px] opacity-60">System generated asset token. Authorized studio use only.</p>
                </div>
                <DialogFooter className="p-8 pt-0">
                    <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" /> Print Token
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
