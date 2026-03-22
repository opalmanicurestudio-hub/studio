
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
    FlaskConical, 
    PlusCircle, 
    Trash2, 
    Info, 
    Clock, 
    CheckCircle, 
    Package, 
    MessageSquare, 
    Workflow, 
    Zap, 
    PackageOpen, 
    Square, 
    BookMarked, 
    Tag, 
    Sparkles,
    Check,
    Loader,
    ArrowRight,
    ListChecks,
    Activity,
    Users,
    FileSignature,
    Calculator,
    Pipette,
    Ear,
    Coffee,
    Star,
    Scale,
    FileImage,
    Maximize2,
    Edit,
    AlertTriangle
} from 'lucide-react';
import { type Appointment, type Client, type Service, type InventoryItem, type Staff, type AppointmentCheckoutState, type StockCorrection } from '@/lib/data';
import { Input } from '../ui/input';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useToast } from '@/hooks/use-toast';
import { Label } from '../ui/label';
import { cn, safeNumber } from '@/lib/utils';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '../ui/switch';
import { motion, AnimatePresence } from 'framer-motion';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { doc, writeBatch, collection, increment } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import Image from 'next/image';
import { ImageMarkupDialog } from '../shared/ImageMarkupDialog';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

type EditableFormulaItem = {
    id: string; 
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
    isCustom?: boolean;
    note?: string;
};

type ReviewRefreshmentItem = {
    id: string;
    name: string;
    price: number;
    deliveredAt: string;
    quantity?: number;
    isAccountedFor?: boolean;
};

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6 text-left">
        <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-4 h-4 md:w-5 md:h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</h3>
        </div>
    </div>
);

interface TechnicianReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentData: {
    appointment: Appointment | null;
    client: Client | undefined;
    service: Service | undefined;
  };
  onSendToFrontDesk: (appointmentId: string, checkoutState: AppointmentCheckoutState) => void;
  staff: Staff[];
}

export const TechnicianReviewDialog: React.FC<TechnicianReviewDialogProps> = ({
  open,
  onOpenChange,
  appointmentData,
  onSendToFrontDesk,
  staff,
}) => {
  const { appointment, client, service } = appointmentData;
  const { services: allServices, inventory, refreshmentRequests } = useInventory();
  const { selectedTenant } = useTenant();
  const { user: currentUser } = useUser();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id;
  const tmhr = selectedTenant?.tmhr || 50;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  
  const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
  const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
  const [completedServiceIds, setCompletedServiceIds] = useState<string[]>([]);
  const [concurrentServiceIds, setConcurrentServiceIds] = useState<string[]>([]);
  const [actualDuration, setActualDuration] = useState(service?.duration || 0);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
  const [isRefreshmentBrowserOpen, setIsRefreshmentBrowserOpen] = useState(false);
  const [refreshments, setRefreshments] = useState<ReviewRefreshmentItem[]>([]);
  
  const [saveAsCustomFormula, setSaveAsCustomFormula] = useState(false);
  const [customFormulaName, setCustomFormulaName] = useState('');
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);

  useEffect(() => {
    if (open && service && appointment) {
        const checkoutState = appointment.checkoutState;
        
        const initialFormula = checkoutState?.formula || service.products?.map(p => {
            const product = inventory.find(i => i.id === p.id);
            let baseCpu = product?.costPerUnit || 0;
            if (product) {
                if (product.costingMethod === 'size' && product.size) {
                    baseCpu = (product.costPerUnit || 0) / product.size;
                } else if (product.costingMethod === 'uses' && product.estimatedUses) {
                    baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
                }
            }
            return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: baseCpu,
                note: '',
            }
        }) || [];
        setEditableFormula(initialFormula);

        const initialAddons = (checkoutState?.addOns || (appointment.addOnIds || [])
            .map(id => allServices.find(s => s.id === id))
            .filter((s): s is Service => !!s));
        setSelectedAddOns(initialAddons);
        
        const alreadyDone = checkoutState?.completedServiceIds || [];
        const alreadyConcurrent = checkoutState?.concurrentServiceIds || [];
        const initialOverrides: Record<string, string> = { ... (checkoutState?.serviceStaffOverrides || {}) };
        
        if (!initialOverrides[service.id]) {
            initialOverrides[service.id] = appointment.staffId || '';
        }
        
        initialAddons.forEach(addon => {
            if (!initialOverrides[addon.id]) {
                initialOverrides[addon.id] = appointment.staffId || '';
            }
        });
        setServiceStaffOverrides(initialOverrides);
        setConcurrentServiceIds(alreadyConcurrent);

        const newlyCompleted = Object.entries(initialOverrides)
            .filter(([_, staffId]) => staffId === currentUser?.uid)
            .map(([svcId]) => svcId);
        
        setCompletedServiceIds([...new Set([...alreadyDone, ...newlyCompleted])]);
        
        let durationToSet = checkoutState?.actualDuration;
        if (!durationToSet && appointment.actualStartTime) {
            const startTime = safeDate(appointment.actualStartTime);
            const endTime = new Date(); 
            durationToSet = Math.max(1, differenceInMinutes(endTime, startTime));
        } else if (!durationToSet) {
            durationToSet = service.duration;
        }
        
        setActualDuration(durationToSet || 0);
        setReviewNotes(checkoutState?.reviewNotes || '');
        setSaveAsCustomFormula(false);
        setCustomFormulaName('');

        const sessionRequests = refreshmentRequests?.filter(r => r.appointmentId === appointment.id && r.status === 'delivered') || [];
        const dashboardRefreshments = sessionRequests.map(r => ({
            id: r.itemId,
            name: r.itemName,
            price: safeNumber(r.priceAtRequest),
            deliveredAt: r.deliveredAt || r.requestedAt,
            isAccountedFor: true
        }));

        setRefreshments([...dashboardRefreshments, ...(checkoutState?.refreshments?.filter((r: any) => !r.isAccountedFor) || [])]);
    }
  }, [service, appointment, open, allServices, inventory, currentUser, refreshmentRequests]);

  const toggleServiceComplete = (serviceId: string) => {
      setCompletedServiceIds(prev => 
          prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
      );
  };

  const handleToggleConcurrency = (serviceId: string, isConcurrent: boolean) => {
      setConcurrentServiceIds(prev => 
          isConcurrent ? [...new Set([...prev, serviceId])] : prev.filter(id => id !== serviceId)
      );
  };

  const allServiceIds = useMemo(() => {
      if (!service) return [];
      return [service.id, ...selectedAddOns.map(a => a.id)];
  }, [service, selectedAddOns]);

  const isLastProvider = useMemo(() => {
      return allServiceIds.every(id => completedServiceIds.includes(id));
  }, [allServiceIds, completedServiceIds]);

  const handleStaffOverride = (serviceId: string, staffId: string) => {
    setServiceStaffOverrides(prev => ({ ...prev, [serviceId]: staffId }));
  };

  const handleUpdateAddOns = (newAddOns: Service[]) => {
    setSelectedAddOns(newAddOns);
    const nextOverrides = { ...serviceStaffOverrides };
    newAddOns.forEach(addon => {
        if (!nextOverrides[addon.id]) {
            nextOverrides[addon.id] = currentUser?.uid || appointment?.staffId || '';
        }
    });
    setServiceStaffOverrides(nextOverrides);
    setIsAddOnSelectorOpen(false);
  };

  const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => {
        let baseCpu = p.costPerUnit || 0;
        if (p.costingMethod === 'size' && p.size) baseCpu = (p.costPerUnit || 0) / p.size;
        else if (p.costingMethod === 'uses' && p.estimatedUses) baseCpu = (p.costPerUnit || 0) / p.estimatedUses;

        return {
            id: p.id,
            name: p.name,
            quantity: 1, 
            unit: p.costingMethod === 'uses' ? (p.useUnit || 'uses') : (p.unit || 'unit'),
            costPerUnit: baseCpu,
            isCustom: true,
            note: ''
        }
      });
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
      setIsProductBrowserOpen(false);
  };

  const handleAddRefreshments = (products: InventoryItem[]) => {
      const newItems: ReviewRefreshmentItem[] = products.map(p => ({
          id: p.id,
          name: p.name,
          price: safeNumber(p.price || 0),
          deliveredAt: new Date().toISOString(),
          isAccountedFor: false 
      }));
      setRefreshments(prev => [...prev, ...newItems.filter(ni => !prev.find(p => p.id === ni.id))]);
      setIsRefreshmentBrowserOpen(false);
  };
  
  const removeProduct = (productId: string) => {
    setEditableFormula(prev => prev.filter(item => item.id !== productId));
  };

  const adjustmentBreakdown = useMemo(() => {
    if (!service) return { rescheduleFee: 0, timeOverage: 0, materialOverage: 0, total: 0 };
    
    // 1. Existing Deferred Fee (usually from reschedule)
    const rescheduleFee = safeNumber(appointment?.checkoutState?.additionalCharge);
    
    // 2. Time overage based on target vs actual
    const targetDuration = service.duration || 60;
    const timeOverageMinutes = Math.max(0, actualDuration - targetDuration);
    const timeOverage = (timeOverageMinutes / 60) * tmhr;
    
    // 3. Material overage based on target formula vs actual formula
    const currentCost = editableFormula.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
    const standardCost = service.products?.reduce((acc, p) => {
        const item = inventory.find(inv => inv.id === p.id);
        if (!item) return acc;
        let baseCpu = item.costPerUnit || 0;
        if (item.costingMethod === 'size' && item.size) baseCpu = (item.costPerUnit || 0) / item.size;
        else if (item.costingMethod === 'uses' && item.estimatedUses) baseCpu = (item.costPerUnit || 0) / item.estimatedUses;
        
        return acc + (p.quantityUsed * baseCpu);
    }, 0) || 0;
    const materialOverage = Math.max(0, currentCost - standardCost);

    return {
        rescheduleFee,
        timeOverage,
        materialOverage,
        total: rescheduleFee + timeOverage + materialOverage
    };
  }, [actualDuration, service, tmhr, editableFormula, inventory, appointment]);

  const handleApplyClientFormula = (formulaNameToApply: string) => {
      if (!client || !service) return;

      if (formulaNameToApply === "default") {
          const defaultFormula = service?.products?.map(p => {
              const product = inventory.find(i => i.id === p.id);
              let baseCpu = product?.costPerUnit || 0;
              if (product) {
                  if (product.costingMethod === 'size' && product.size) baseCpu = (product.costPerUnit || 0) / product.size;
                  else if (product.costingMethod === 'uses' && product.estimatedUses) baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
              }
              return {
                id: p.id,
                name: p.name,
                quantity: p.quantityUsed,
                unit: product?.costingMethod === 'uses' ? (product.useUnit || 'uses') : (product?.unit || 'unit'),
                costPerUnit: baseCpu,
                note: ''
            }
          }) || [];
          setEditableFormula(defaultFormula);
          return;
      }

      const formula = client.customFormulas?.find(f => f.name === formulaNameToApply);
      if (!formula) return;
      const newFormula: EditableFormulaItem[] = formula.items.map(item => {
        const product = inventory.find(p => p.id === item.id);
        let baseCpu = product?.costPerUnit || 0;
        if (product) {
            if (product.costingMethod === 'size' && product.size) baseCpu = (product.costPerUnit || 0) / product.size;
            else if (product.costingMethod === 'uses' && product.estimatedUses) baseCpu = (product.costPerUnit || 0) / product.estimatedUses;
        }
        return {
            id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, costPerUnit: baseCpu, note: item.note || ''
        }
      });
      setEditableFormula(newFormula);
  };

  const handleCompleteMyPart = () => {
    if (!client || !service || !appointment || !currentUser || !firestore || !tenantId) return;

    const checkoutState: AppointmentCheckoutState = {
        formula: editableFormula,
        retailItems: appointment.checkoutState?.retailItems || [],
        addOnServices: selectedAddOns,
        refreshments: refreshments,
        actualDuration,
        reviewNotes,
        serviceStaffOverrides,
        completedServiceIds: completedServiceIds,
        concurrentServiceIds: concurrentServiceIds,
        absorbedCost: appointment.checkoutState?.absorbedCost || 0, 
        tipAmount: appointment.checkoutState?.tipAmount || 0, 
        tipAllocations: appointment.checkoutState?.tipAllocations || {}, 
        additionalCharge: adjustmentBreakdown.total,
        adjustments: {
            rescheduleFee: adjustmentBreakdown.rescheduleFee,
            timeOverage: adjustmentBreakdown.timeOverage,
            materialOverage: adjustmentBreakdown.materialOverage
        },
        saveAsCustomFormula,
        customFormulaName: saveAsCustomFormula ? customFormulaName : undefined
    };

    if (isLastProvider) {
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();

        editableFormula.forEach(item => {
            const product = inventory.find(p => p.id === item.id);
            if (!product) return;

            const productRef = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
            const updateData: any = {};
            let unitLabel = product.unit || 'units';

            if (product.costingMethod === 'uses') {
                unitLabel = product.useUnit || 'uses';
                let currentUses = safeNumber(product.partialContainerUses);
                let currentStock = safeNumber(product.totalStock);
                const usesPerContainer = safeNumber(product.estimatedUses) || 1;
                
                currentUses -= item.quantity;
                while (currentUses <= 0 && currentStock > 0) {
                    currentStock -= 1;
                    currentUses += usesPerContainer;
                }
                updateData.totalStock = currentStock;
                updateData.partialContainerUses = currentUses;
            } else if (product.costingMethod === 'size' && product.size) {
                unitLabel = product.unit || 'ml';
                let currentSize = safeNumber(product.partialContainerSize);
                let currentStock = safeNumber(product.totalStock);
                const sizePerContainer = safeNumber(product.size);
                
                currentSize -= item.quantity;
                while (currentSize <= 0 && currentStock > 0) {
                    currentStock -= 1;
                    currentSize += sizePerContainer;
                }
                updateData.totalStock = currentStock;
                updateData.partialContainerSize = currentSize;
            } else {
                updateData.totalStock = increment(-item.quantity);
            }

            batch.update(productRef, updateData);

            const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            batch.set(scRef, {
                id: nanoid(),
                productId: product.id,
                date: now,
                change: -item.quantity,
                unit: unitLabel,
                reason: `Service Formula: ${service.name} for ${client.name}`,
                appointmentId: appointment.id
            } as StockCorrection);
        });

        refreshments.forEach(ref => {
            if (ref.isAccountedFor) return; 

            const product = inventory.find(p => p.id === ref.id);
            if (!product) return;

            const productRef = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
            const qty = 1; 
            
            batch.update(productRef, { totalStock: increment(-qty) });

            const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            batch.set(scRef, {
                id: nanoid(),
                productId: product.id,
                date: now,
                change: -qty,
                unit: product.unit || 'unit',
                reason: `Manual Amenity: ${ref.name} during Review for ${client.name}`,
                appointmentId: appointment.id
            } as StockCorrection);
        });

        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), {
            status: 'ready_for_checkout',
            checkoutState: JSON.parse(JSON.stringify(checkoutState)),
            actualEndTime: now
        });

        const involvedIds = new Set([appointment.staffId || '', ...Object.values(serviceStaffOverrides)]);
        involvedIds.forEach(sid => {
            if (sid) batch.update(doc(firestore, `tenants/${tenantId}/staff`, sid), { status: 'idle' });
        });

        batch.commit().then(() => {
            toast({ title: "Service Concluded", description: "Record sent to front desk for settlement." });
            onOpenChange(false);
        });
    } else {
        onSendToFrontDesk(appointment.id, checkoutState);
    }
  };

  const handleMarkupSave = (markedUpUrl: string) => {
      if (!firestore || !tenantId || !appointment) return;
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
      updateDocumentNonBlocking(appointmentRef, { inspirationPhotoUrl: markedUpUrl });
      toast({ title: "Markup Committed to Dossier" });
  };

  if (!client || !service || !appointment) return null;

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  const titleText = isLastProvider ? 'Complete Service' : 'Service Hand-off';
  const buttonLabel = isLastProvider ? 'Complete Service & Send to Desk' : 'Complete Part & Hand-off';

  return (
    <>
      <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-xl rounded-[3rem] border-4 max-h-[95dvh]")}>
            <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
                <div className="flex items-center gap-3 mb-2 text-left">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical review</span>
                </div>
                <DialogTitle className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none", isMobile ? "text-xl" : "text-3xl")}>{titleText}</DialogTitle>
                <DialogDescription className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Verify actuals and mark completed parts before moving forward.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 text-left">
              <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                <Card className="border-4 border-primary/10 bg-primary/5 rounded-[2rem] shadow-xl shadow-primary/5 overflow-hidden text-left">
                    <CardContent className="p-6 flex items-center gap-6">
                        <Avatar className="w-16 h-16 md:w-20 md:h-20 border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2rem] shrink-0">
                            <AvatarImage src={client.avatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black bg-primary/10 text-primary text-xl">{(client.name || 'G').substring(0,2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1 text-left">
                            <p className="font-black text-lg md:text-2xl uppercase tracking-tighter text-slate-900 leading-none truncate">{client.name}</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1.5">{service.name}</p>
                        </div>
                    </CardContent>
                </Card>

                {appointment.inspirationPhotoUrl && (
                    <div className="mt-8 space-y-4">
                        <div className="flex justify-between items-center px-1 text-left">
                            <SectionHeader icon={FileImage} title="Target Reference" step="Ref" />
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => setIsMarkupOpen(true)}
                                className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm"
                            >
                                <Edit className="w-3 h-3 mr-1.5" /> Markup Tool
                            </Button>
                        </div>
                        <div 
                            className="relative aspect-video w-full rounded-[2rem] overflow-hidden border-2 border-primary/10 bg-muted/5 group shadow-inner cursor-zoom-in"
                            onClick={() => setExpandedImage(appointment.inspirationPhotoUrl!)}
                        >
                            <Image src={appointment.inspirationPhotoUrl} alt="Target Inspiration" fill className="object-cover transition-transform duration-700 hover:scale-105" />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Maximize2 className="w-8 h-8 text-white" />
                            </div>
                            <div className="absolute top-4 right-4">
                                <Badge className="bg-primary/90 backdrop-blur-md text-white border-none font-black text-[8px] uppercase h-6 px-3 shadow-xl">Guest Choice</Badge>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-8 space-y-3 text-left">
                    <AnimatePresence>
                        {adjustmentBreakdown.rescheduleFee > 0 && (
                            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                                <Alert className="border-4 rounded-[2.5rem] bg-amber-500/5 border-amber-500/20 p-6 shadow-xl text-left">
                                    <AlertTriangle className="h-6 w-6 text-amber-600" />
                                    <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2 text-amber-700">Protocol Recovery Alert</AlertTitle>
                                    <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left text-amber-600">
                                        A deferred rescheduling recovery of <strong>${adjustmentBreakdown.rescheduleFee.toFixed(2)}</strong> is attached to this session.
                                    </AlertDescription>
                                </Alert>
                            </motion.div>
                        )}
                        
                        {(adjustmentBreakdown.timeOverage > 0 || adjustmentBreakdown.materialOverage > 0) && (
                            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                                <Alert className="border-4 rounded-[2.5rem] bg-primary/[0.02] border-primary/20 p-6 shadow-xl text-left">
                                    <Scale className="h-6 w-6 text-primary" />
                                    <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2 text-primary">Strategic Adjustments</AlertTitle>
                                    <AlertDescription className="space-y-2 text-xs font-bold leading-relaxed opacity-80 uppercase text-left">
                                        {adjustmentBreakdown.timeOverage > 0 && (
                                            <div className="flex justify-between items-center">
                                                <span>Time Overage (+{actualDuration - service.duration}m)</span>
                                                <span className="font-mono text-primary">+${adjustmentBreakdown.timeOverage.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {adjustmentBreakdown.materialOverage > 0 && (
                                            <div className="flex justify-between items-center">
                                                <span>Material Protocol Overage</span>
                                                <span className="font-mono text-primary">+${adjustmentBreakdown.materialOverage.toFixed(2)}</span>
                                            </div>
                                        )}
                                        <div className="pt-2 border-t border-primary/10 flex justify-between items-center text-primary">
                                            <span>Total Session Delta</span>
                                            <span className="font-black font-mono">${(adjustmentBreakdown.timeOverage + adjustmentBreakdown.materialOverage).toFixed(2)}</span>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {client.sensoryNeeds && (
                        <Alert className="border-2 rounded-xl bg-blue-500/5 border-blue-200 text-left">
                            <Ear className="h-4 w-4 text-blue-600" />
                            <AlertTitle className="text-[9px] font-black uppercase text-left text-blue-700">Special Accommodations</AlertTitle>
                            <AlertDescription className="text-[10px] font-bold opacity-80 uppercase text-left text-blue-600">{client.sensoryNeeds}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <div className="space-y-10 mt-10 text-left">
                  <SectionHeader icon={ListChecks} title="Flow Control" step={1} />
                  <div className="space-y-4 text-left">
                        <div className="space-y-3 text-left">
                            <div className="p-5 rounded-[2rem] border-2 transition-all bg-muted/10 shadow-inner">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0 flex-1 text-left">
                                        <Checkbox 
                                            id={`complete-review-${service.id}`} 
                                            checked={completedServiceIds.includes(service.id)} 
                                            onCheckedChange={() => toggleServiceComplete(service.id)}
                                            className="h-6 w-6 rounded-full border-2"
                                        />
                                        <div className="min-w-0 text-left">
                                            <Label htmlFor={`complete-review-${service.id}`} className="text-sm font-black uppercase tracking-tight text-slate-900 block truncate text-left">{service.name}</Label>
                                            <p className="text-[8px] font-black uppercase text-primary tracking-widest opacity-60 text-left">Main Service</p>
                                        </div>
                                    </div>
                                    <Select value={serviceStaffOverrides[service.id] || ''} onValueChange={(sid) => handleStaffOverride(service.id, sid)}>
                                        <SelectTrigger className="w-[140px] h-11 rounded-xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                                            <SelectValue placeholder="Staff" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[service.id])).map(s => (
                                                <SelectItem key={s.id} value={s.id} className="rounded-xl font-bold uppercase text-[9px] tracking-widest">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn("w-2 h-2 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                                        <span>{s?.name?.split(' ')[0] || 'Tech'}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {selectedAddOns.map(addon => (
                                <div key={addon.id} className="p-5 rounded-[2rem] border-2 transition-all bg-muted/10 shadow-inner">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0 flex-1 text-left">
                                            <Checkbox 
                                                id={`complete-review-${addon.id}`} 
                                                checked={completedServiceIds.includes(addon.id)} 
                                                onCheckedChange={() => toggleServiceComplete(addon.id)}
                                                className="h-6 w-6 rounded-full border-2"
                                            />
                                            <div className="min-w-0 text-left">
                                                <Label htmlFor={`complete-review-${addon.id}`} className="text-sm font-black uppercase tracking-tight text-slate-900 block truncate text-left">{addon.name}</Label>
                                                <Badge variant="outline" className={cn("text-[8px] h-5 px-2 uppercase font-black tracking-widest cursor-pointer border-2 shadow-sm transition-all", (concurrentServiceIds.includes(addon.id)) ? "bg-primary text-white border-primary" : "bg-white text-muted-foreground border-border")} onClick={() => handleToggleConcurrency(addon.id, !concurrentServiceIds.includes(addon.id))}>
                                                    {concurrentServiceIds.includes(addon.id) ? <><Zap className="w-2.5 h-2.5 mr-1" /> Concurrent</> : <><Workflow className="w-2.5 h-2.5 mr-1" /> Sequential</>}
                                                </Badge>
                                            </div>
                                        </div>
                                        <Select value={serviceStaffOverrides[addon.id] || ''} onValueChange={(staffId) => handleStaffOverride(addon.id, staffId)}>
                                            <SelectTrigger className="w-[140px] h-11 rounded-xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                                                <SelectValue placeholder="Staff" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                {staff.filter(s => ((s.active && !s.onBreak) || s.id === serviceStaffOverrides[addon.id]) && (!addon.requiredSkills || addon.requiredSkills?.length === 0 || addon.requiredSkills.every(sk => (s.skillSet || []).includes(sk)))).map(s => (
                                                    <SelectItem key={s.id} value={s.id} className="rounded-xl font-bold uppercase text-[9px] tracking-widest">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("w-2 h-2 rounded-full", s.status === 'busy' ? "bg-red-500" : "bg-green-500")} />
                                                            <span>{s?.name?.split(' ')[0] || 'Tech'}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5 mt-2">
                            <PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" /> Append Add-on Enhancement
                        </Button>
                  </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed text-left">
                    <SectionHeader icon={Calculator} title="Usage Actuals" step={2} />
                    <div className="space-y-8 text-left">
                        <div className="space-y-3 text-left">
                          <Label htmlFor="actual-duration-review" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                              <Clock className="w-3.5 h-3.5 opacity-40" /> Actual Duration (Minutes)
                          </Label>
                          <Input 
                              id="actual-duration-review"
                              type="number"
                              value={actualDuration}
                              onChange={(e) => setActualDuration(parseInt(e.target.value) || 0)}
                              className="h-16 text-2xl md:text-3xl font-black font-mono border-2 rounded-2xl shadow-inner bg-muted/5 text-center focus-visible:ring-primary/20"
                          />
                          {actualDuration > service.duration && (
                              <div className="p-4 bg-amber-500/5 border-2 border-amber-500/10 rounded-2xl animate-in slide-in-from-top-2 text-left">
                                  <span className="text-[10px] font-black text-amber-700 flex items-center gap-2 uppercase tracking-tight text-left"><Info className="w-3.5 h-3.5"/> Foundation Burn: +{actualDuration - service.duration}m Over Goal</span>
                              </div>
                          )}
                        </div>

                        <div className="space-y-4 pt-4 border-t border-dashed text-left">
                            <div className="flex items-center justify-between px-1 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                                    <PackageOpen className="w-3.5 h-3.5 opacity-40" /> Actual Product Formula
                                </Label>
                                <div className="flex items-center gap-2 text-left">
                                    {(client.customFormulas && client.customFormulas.length > 0) && (
                                        <Select onValueChange={handleApplyClientFormula} defaultValue="default">
                                            <SelectTrigger className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm w-40">
                                                <SelectValue placeholder="Load Formula..." />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                <SelectItem value="default" className="font-bold text-[9px] uppercase">LIBRARY STANDARD</SelectItem>
                                                {client.customFormulas.map(formula => (
                                                    <SelectItem key={formula.id} value={formula.name} className="font-bold text-[9px] uppercase">{formula.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    <Button variant="ghost" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                        <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                                    </Button>
                                </div>
                            </div>
                            
                            <div className="space-y-2 text-left">
                                {editableFormula.length > 0 ? (
                                    <div className="grid gap-3 text-left">
                                        {editableFormula.map((item, index) => (
                                            <div key={item.id} className="p-5 bg-white rounded-2xl border-2 shadow-sm space-y-4 group hover:border-primary/20 transition-all">
                                                <div className="flex items-center justify-between gap-4 text-left">
                                                    <span className="font-black text-xs uppercase tracking-tight text-slate-900 flex-1 truncate text-left">{item.name}</span>
                                                    <div className="flex items-center gap-3 text-left">
                                                        <div className="flex items-center gap-2 text-left">
                                                            <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40 text-left">Load</Label>
                                                            <Input
                                                                type="number"
                                                                value={item.quantity}
                                                                onChange={(e) => {
                                                                    const newQty = parseFloat(e.target.value) || 0;
                                                                    const next = [...editableFormula];
                                                                    next[index] = { ...item, quantity: newQty };
                                                                    setEditableFormula(next);
                                                                }}
                                                                className="w-16 h-9 text-center font-black font-mono border-2 rounded-lg text-xs"
                                                                step="0.1"
                                                            />
                                                            <span className="text-[9px] font-black uppercase text-muted-foreground w-10 opacity-60 truncate text-left">{item.unit}</span>
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeProduct(item.id)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="relative">
                                                    <MessageSquare className="absolute left-3 top-3 w-3 h-3 text-primary opacity-20" />
                                                    <Input 
                                                        placeholder="ITEM PROTOCOL NOTE..." 
                                                        value={item.note || ''} 
                                                        onChange={(e) => {
                                                            const next = [...editableFormula];
                                                            next[index] = { ...item, note: e.target.value };
                                                            setEditableFormula(next);
                                                        }}
                                                        className="h-9 pl-8 rounded-lg border-2 bg-muted/5 font-bold uppercase text-[9px] tracking-tight"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-left">
                                        <Activity className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-left">Recipe Manifest Empty</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed text-left">
                    <SectionHeader icon={Coffee} title="Hospitality Audit" step={3} />
                    <div className="space-y-4 text-left">
                        <div className="flex items-center justify-between px-1 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Refreshments Served</Label>
                            <Button variant="ghost" size="sm" onClick={() => setIsRefreshmentBrowserOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                <PlusCircle className="w-3 h-3 mr-1.5" /> Append Amenity
                            </Button>
                        </div>
                        
                        {refreshments.length > 0 ? (
                            <div className="grid gap-2 text-left">
                                {refreshments.map((ref, idx) => (
                                    <div key={`${ref.id}-${idx}`} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group">
                                        <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                            <div className="p-2 bg-primary/5 rounded-xl shrink-0"><Coffee className="w-4 h-4 text-primary" /></div>
                                            <div className="min-w-0 text-left">
                                                <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate text-left">{ref.name}</p>
                                                <div className="flex items-center gap-2 text-left">
                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Served {format(parseISO(ref.deliveredAt), 'h:mm a')}</p>
                                                    {ref.isAccountedFor && <Badge variant="outline" className="h-3.5 text-[6px] font-black uppercase bg-green-50 text-green-700 border-green-200">Inventory Sync</Badge>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 shrink-0 text-left">
                                            {safeNumber(ref.price) === 0 ? (
                                                <Badge className="bg-indigo-600 text-white border-none font-black text-[8px] uppercase tracking-widest shadow-sm">
                                                    <Star className="w-2  h-2 mr-1 fill-current" /> Club Perk
                                                </Badge>
                                            ) : (
                                                <p className="font-black font-mono text-xs text-primary">${safeNumber(ref.price).toFixed(2)}</p>
                                            )}
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setRefreshments(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3 text-left">
                                <Coffee className="w-10 h-10" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No Amenities Served</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-8 pt-10 border-t border-dashed text-left">
                    <SectionHeader icon={BookMarked} title="Dossier Intelligence" step={4} />
                    <div className="space-y-6 text-left">
                        <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/5 shadow-inner transition-all text-left">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="save-formula-toggle" className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                                    <FileSignature className="w-4 h-4 text-primary" /> Archive Formula
                                </Label>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Register this recipe in guest dossier</p>
                            </div>
                            <Switch id="save-formula-toggle" checked={saveAsCustomFormula} onCheckedChange={setSaveAsCustomFormula} className="scale-125 data-[state=checked]:bg-primary" />
                        </div>

                        <AnimatePresence>
                            {saveAsCustomFormula && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden text-left">
                                    <div className="space-y-3 p-6 rounded-[2rem] border-2 bg-white shadow-xl text-left">
                                        <Label htmlFor="custom-formula-name" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2 text-left">
                                            <Tag className="w-3.5 h-3.5" /> Formula Identifier
                                        </Label>
                                        <Input 
                                            id="custom-formula-name" 
                                            placeholder="e.g., WINTER GLOSS MIX" 
                                            value={customFormulaName} 
                                            onChange={e => setCustomFormulaName(e.target.value.toUpperCase())}
                                            className="h-12 rounded-xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-3 text-left">
                            <Label htmlFor="review-notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2 text-left">
                                <MessageSquare className="w-3.5 h-3.5 opacity-40" /> Professional Debrief Notes
                            </Label>
                            <Textarea 
                                id="review-notes"
                                placeholder="Audit notes regarding treatment outcomes, reactions, or client requests..." 
                                value={reviewNotes}
                                onChange={(e) => setReviewNotes(e.target.value)}
                                rows={4}
                                className="rounded-[2.5rem] border-2 bg-muted/5 p-6 font-medium leading-relaxed focus-visible:ring-primary/20 shadow-inner"
                            />
                        </div>
                    </div>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-6" : "p-8 pt-4")}>
                <div className="flex flex-col gap-3 w-full">
                    <Button 
                        onClick={handleCompleteMyPart} 
                        disabled={completedServiceIds.length === 0 || (saveAsCustomFormula && !customFormulaName.trim())}
                        className="w-full h-14 sm:h-16 rounded-[1.5rem] md:rounded-[2rem] text-xs sm:text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 active:scale-95 transition-all group whitespace-normal leading-tight px-4"
                    >
                        {buttonLabel} <ArrowRight className="ml-2 sm:ml-3 w-4 h-4 sm:w-6 sm:h-6 transition-transform group-hover:translate-x-2 shrink-0" />
                    </Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-tighter text-[10px] text-slate-400">Abort Review</Button>
                </div>
            </DialogFooter>
        </ContentComponent>
      </DialogComponent>
      <SelectAddOnsDialog open={isAddOnSelectorOpen} onOpenChange={setIsAddOnSelectorOpen} onSelect={handleUpdateAddOns} allAddOns={allServices.filter(s => s.type === 'addon' && (service?.compatibleAddOnIds || []).includes(s.id))} initialSelected={selectedAddOns} staff={staff} defaultStaffId={appointment.staffId || ''} />
      <BrowseProductsDialog open={isProductBrowserOpen} onOpenChange={setIsProductBrowserOpen} onSelect={handleAddProduct} allProducts={inventory.filter(i => i.type === 'professional')} initialSelected={[]} />
      <BrowseProductsDialog open={isRefreshmentBrowserOpen} onOpenChange={setIsRefreshmentBrowserOpen} onSelect={handleAddRefreshments} allProducts={inventory.filter(i => i.type === 'refreshment' || i.type === 'overhead')} initialSelected={[]} />

      {appointment.inspirationPhotoUrl && isMarkupOpen && (
          <ImageMarkupDialog 
            open={isMarkupOpen}
            onOpenChange={setIsMarkupOpen}
            imageUrl={appointment.inspirationPhotoUrl}
            onSave={handleMarkupSave}
            title={`Mapping for ${client.name}`}
          />
      )}

      <Dialog open={!!expandedImage} onOpenChange={(val) => !val && setExpandedImage(null)}>
        <DialogContent className="max-w-fit p-0 border-none bg-transparent shadow-none overflow-hidden flex items-center justify-center">
            <DialogHeader className="sr-only">
                <DialogTitle>Image Expansion</DialogTitle>
                <DialogDescription>Full screen preview of technical asset.</DialogDescription>
            </DialogHeader>
            <div className="relative rounded-[2.5rem] overflow-hidden border-4 border-white/20 shadow-2xl bg-black/40 backdrop-blur-xl max-w-[95vw] max-h-[95vh]">
                {expandedImage && <img src={expandedImage} alt="Expanded Inspiration" className="block max-w-full max-h-[90vh] object-contain" priority />}
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
