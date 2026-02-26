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
  const { inventory, setInventory, locations, services, appointments, clients } = useInventory();
  const [isLogMaintenanceOpen, setIsLogMaintenanceOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrModalContent, setQrModalContent] = useState({ url: '', alt: '', title: '' });
  
  const equipment = inventory.find((p) => p.id === id && p.type === 'equipment');
  
  const handleEquipmentUpdate = (updatedEquipment: InventoryItem) => {
    // This is a placeholder. In a real app, you'd call a function from context or a server action.
    const updatedInventory = inventory.map(item => item.id === updatedEquipment.id ? updatedEquipment : item);
    // In a real app, you'd likely call a function passed down via context to update the state
    console.log("Updated Inventory (simulation):", updatedInventory);
    
    toast({
        title: "Equipment Updated",
        description: `${updatedEquipment.name} has been successfully updated.`,
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
        // The original code had a bug here, referencing equipment instead of service.equipment
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
    if (!equipment) return;
    const newRecord: MaintenanceRecord = { ...entry, id: `maint-${Date.now()}` };
    const updatedHistory = [...(equipment.maintenanceHistory || []), newRecord];
    
    // In a real app, this would be a Firestore update
    console.log("Saving maintenance:", newRecord);
  };

  const handleToggleExperiment = () => {
    if (!equipment) return;
    
    if (equipment.isExperimentActive) {
        setIsEndExperimentOpen(true);
    } else {
        // In a real app, this would be a Firestore update
        console.log("Starting experiment for:", equipment.id);
    }
  }

  const handleEndExperimentConfirmed = (results: LifespanTestResult) => {
    if (!equipment) return;
    
    // In a real app, this would be a Firestore update
    console.log("Ending experiment with results:", results);
    
    setIsEndExperimentOpen(false);
};
  
  if (!equipment) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Equipment Details" />
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div>Equipment not found.</div>
            </main>
        </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Equipment Details" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" asChild>
                <Link href="/inventory">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Inventory
                </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)}>
                <Edit className="h-4 w-4 mr-2"/>
                Edit Equipment
            </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="w-24 h-24 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                {equipment.imageUrl ? (
                    <Image src={equipment.imageUrl} alt={equipment.name} width={96} height={96} className='rounded-md object-cover w-full h-full' />
                ) : (
                    <Hammer className="w-12 h-12 text-muted-foreground" />
                )}
            </div>
            <div className='flex-1'>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                    {equipment.name}
                </h1>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <Badge variant="outline">{equipment.category}</Badge>
                    <Badge variant="secondary">{equipment.totalStock > 0 ? "Active" : "Retired"}</Badge>
                    <Badge variant="secondary" className="font-mono">ID: {equipment.id.slice(-6).toUpperCase()}</Badge>
                    {equipment.isExperimentActive && (
                        <Badge variant="secondary" className="flex items-center gap-1.5 bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                            <FlaskConical className="h-3 w-3" /> Lifespan Test Active
                        </Badge>
                    )}
                </div>
            </div>
        </div>

        <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><Tag className='w-4 h-4' /> SKU / Short ID</div>
                    <div className='font-mono text-sm'>{equipment.sku || equipment.id.slice(-6).toUpperCase()}</div>
                </div>
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><Truck className='w-4 h-4' /> Vendor</div>
                    <div className='font-medium text-sm'>{equipment.supplier}</div>
                </div>
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><QrCode className='w-4 h-4' /> Reorder QR</div>
                    <button
                        className={cn(
                            'w-12 h-12 bg-muted flex items-center justify-center rounded-md',
                            !equipment.supplierUrl && 'cursor-not-allowed opacity-50'
                        )}
                        onClick={() => {
                            if (equipment.supplierUrl) {
                                setQrModalContent({
                                    url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(equipment.supplierUrl)}`,
                                    alt: `Reorder QR for ${equipment.name}`,
                                    title: 'Reorder QR Code'
                                });
                                setIsQrModalOpen(true);
                            }
                        }}
                        disabled={!equipment.supplierUrl}
                    >
                        {equipment.supplierUrl ? (
                            <Image
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=48x48&data=${encodeURIComponent(equipment.supplierUrl)}`}
                                alt={`Reorder QR for ${equipment.name}`}
                                width={48}
                                height={48}
                                className="object-contain"
                            />
                        ) : (
                            <div className="w-12 h-12 bg-muted/50 flex items-center justify-center rounded-md">
                                <QrCode className="w-6 h-6 text-muted-foreground/50" />
                            </div>
                        )}
                    </button>
                </div>
                <div className='space-y-1'>
                    <div className='text-sm text-muted-foreground flex items-center gap-2'><QrCode className='w-4 h-4' /> Internal QR</div>
                     <button
                        className='w-12 h-12 bg-muted flex items-center justify-center rounded-md'
                        onClick={() => {
                            setQrModalContent({
                                url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://product/${equipment.id}`)}`,
                                alt: `Internal QR for ${equipment.name}`,
                                title: 'Internal Equipment QR Code'
                            });
                            setIsQrModalOpen(true);
                        }}
                    >
                        <Image
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=48x48&data=${encodeURIComponent(`clarityflow://product/${equipment.id}`)}`}
                            alt={`Internal QR for ${equipment.name}`}
                            width={48}
                            height={48}
                            className="object-contain"
                        />
                    </button>
                </div>
            </CardContent>
        </Card>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
             <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle>Financial Overview</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Purchase Cost</div>
                        <div className="text-2xl font-bold">${purchaseCost.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Monthly Depreciation</div>
                        <div className="text-2xl font-bold">${monthlyDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Accumulated Depreciation</div>
                        <div className="text-2xl font-bold">${accumulatedDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1 border-2 border-primary/20">
                        <div className="text-sm font-medium text-primary">Book Value</div>
                        <div className="text-2xl font-bold text-primary">${bookValue.toFixed(2)}</div>
                    </div>
                </CardContent>
             </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Lifespan Test</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="flex justify-between p-3 bg-muted/50 rounded-md">
                        <span className="font-medium">Time in Service:</span>
                        <span className="font-mono">{serviceMonths} months</span>
                    </div>
                     {equipment.lastTestResult && !equipment.isExperimentActive && (
                        <Card className="border-blue-500/30">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    <CheckCircle className="h-5 w-5" /> Last Test Results
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm space-y-2">
                                <div className="flex justify-between"><span className="text-muted-foreground">Actual Lifespan:</span> <span className="font-semibold">{equipment.lastTestResult.actualLifespanMonths} months</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Total Revenue:</span> <span className="font-semibold">${equipment.lastTestResult.totalRevenue.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Total Maintenance:</span> <span className="font-semibold">${equipment.lastTestResult.totalMaintenanceCost.toFixed(2)}</span></div>
                                <div className="flex justify-between font-bold text-base pt-1 border-t"><span className="text-blue-600 dark:text-blue-400">ROI:</span> <span className="text-blue-600 dark:text-blue-400">{equipment.lastTestResult.roi.toFixed(1)}%</span></div>
                            </CardContent>
                        </Card>
                     )}
                    <Button variant="outline" className="w-full" onClick={handleToggleExperiment}>
                        {equipment.isExperimentActive ? <><CheckCircle className="mr-2"/>End Lifespan Test</> : <><Rocket className="mr-2"/>Start New Lifespan Test</>}
                    </Button>
                </CardContent>
             </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Maintenance History</CardTitle>
                        <CardDescription>Log of all repairs and maintenance.</CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => setIsLogMaintenanceOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Log Maintenance</Button>
                </CardHeader>
                <CardContent>
                     <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Cost</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {equipment.maintenanceHistory && equipment.maintenanceHistory.length > 0 ? (
                                equipment.maintenanceHistory.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell>{format(parseISO(log.date), 'MMM d, yyyy')}</TableCell>
                                        <TableCell>{log.description}</TableCell>
                                        <TableCell className="text-right">${log.cost.toFixed(2)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground h-24">
                                        No maintenance history logged.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Usage History</CardTitle>
                    <CardDescription>Track services this equipment was used in.</CardDescription>
                </CardHeader>
                <CardContent>
                      <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Client</TableHead>
                                <TableHead>Service</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {usageHistory.length > 0 ? (
                                usageHistory.map(apt => (
                                    <TableRow key={apt.id}>
                                        <TableCell>{format(parseISO(apt.endTime), 'MMM d, yyyy')}</TableCell>
                                        <TableCell>
                                            <div className='flex items-center gap-2'>
                                                 <User className="h-4 w-4 text-muted-foreground"/>
                                                 {apt.client?.name || 'N/A'}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className='flex items-center gap-2'>
                                                <Wrench className="h-4 w-4 text-muted-foreground"/>
                                                {apt.service?.name || 'N/A'}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
                                        No usage history recorded.
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{qrModalContent.title}</DialogTitle>
                </DialogHeader>
                <div className="flex items-center justify-center p-4">
                    <Image
                        src={qrModalContent.url}
                        alt={qrModalContent.alt}
                        width={256}
                        height={256}
                        className="object-contain rounded-md"
                    />
                </div>
            </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
