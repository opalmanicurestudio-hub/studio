'use client';

import React, { useEffect, useState, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DollarSign, Percent, PlusCircle, Trash2, Users, AlertTriangle, Wand, Landmark } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Discount, type Service } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { SelectServicesDialog } from '../services/SelectServicesDialog';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '../ui/card';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Alert, AlertDescription } from '../ui/alert';

const discountSchema = z.object({
  code: z.string().min(3, "Code must be at least 3 characters.").toUpperCase(),
  description: z.string().optional(),
  type: z.enum(['percentage', 'fixed']),
  value: z.coerce.number().min(0.01, "Value must be positive."),
  usageLimit: z.coerce.number().min(0).optional(),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
  applicableServiceIds: z.array(z.string()).optional(),
  limitOnePerCustomer: z.boolean().default(false),
  automation: z.object({
      trigger: z.enum(['none', 'new_client', 'loyalty', 're_engagement', 'birthday']),
      appointmentThreshold: z.coerce.number().optional(),
      daysSinceLastVisit: z.coerce.number().optional(),
  }).optional(),
}).refine(data => data.type !== 'percentage' || (data.value >= 1 && data.value <= 100), {
  message: "Percentage must be between 1 and 100.",
  path: ["value"],
});

type DiscountFormData = z.infer<typeof discountSchema>;

const ProfitabilityAnalysis = ({ 
    services, 
    discountType, 
    discountValue 
}: { 
    services: Service[], 
    discountType: 'percentage' | 'fixed', 
    discountValue: number 
}) => {
    if (services.length === 0 || !discountValue || discountValue <= 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Landmark className="w-3 h-3" />
                Service Profitability Analysis
            </h4>
            <Accordion type="multiple" className="w-full space-y-2">
                {services.map(service => {
                    const tiers = [
                        { level: 'Apprentice', price: service.serviceTiers?.find(t => t.tierId === 'apprentice')?.price || service.price * 0.8 },
                        { level: 'Junior', price: service.serviceTiers?.find(t => t.tierId === 'junior')?.price || service.price * 0.9 },
                        { level: 'Senior', price: service.serviceTiers?.find(t => t.tierId === 'senior')?.price || service.price },
                        { level: 'Master', price: service.serviceTiers?.find(t => t.tierId === 'master')?.price || service.price * 1.2 },
                    ];

                    return (
                        <AccordionItem key={service.id} value={service.id} className="border rounded-xl overflow-hidden">
                            <AccordionTrigger className="px-4 py-3 font-bold text-sm hover:no-underline bg-muted/20">
                                {service.name}
                            </AccordionTrigger>
                            <AccordionContent className="p-4 space-y-3">
                                {tiers.map(tier => {
                                    const originalPrice = tier.price;
                                    const discountAmount = discountType === 'percentage'
                                        ? originalPrice * (discountValue / 100)
                                        : discountValue;
                                    
                                    const discountedPrice = Math.max(0, originalPrice - discountAmount);
                                    const newProfit = discountedPrice - service.cost;
                                    const newMargin = discountedPrice > 0 ? (newProfit / discountedPrice) * 100 : 0;

                                    return (
                                        <div key={tier.level} className="text-xs space-y-2 p-3 bg-background rounded-lg border shadow-sm">
                                            <div className="flex justify-between items-center">
                                                <p className="font-black uppercase text-[10px] text-muted-foreground tracking-tight">{tier.level}</p>
                                                {newProfit < 0 && <Badge variant="destructive" className="h-4 text-[9px]">Loss Warning</Badge>}
                                            </div>
                                            <div className="flex justify-between items-baseline">
                                                <span className="text-muted-foreground">Retail: <span className="font-bold text-foreground">${originalPrice.toFixed(2)}</span></span>
                                                <span className="text-muted-foreground">New: <span className="font-bold text-primary">${discountedPrice.toFixed(2)}</span></span>
                                            </div>
                                            <div className="flex justify-between items-center pt-2 border-t border-dashed">
                                                <span className="font-bold">Net Profit</span>
                                                <span className={cn("font-black font-mono text-sm", newProfit >= 0 ? "text-primary" : "text-destructive")}>
                                                    ${newProfit.toFixed(2)} ({newMargin.toFixed(0)}%)
                                                </span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </AccordionContent>
                        </AccordionItem>
                    )
                })}
            </Accordion>
        </div>
    )
};


const PotentialImpactAnalysis = ({ 
    discountType, 
    discountValue,
    usageLimit,
    selectedServices,
}: { 
    discountType: 'percentage' | 'fixed', 
    discountValue: number,
    usageLimit: number,
    selectedServices: Service[],
}) => {
    const impact = useMemo(() => {
        if (!usageLimit || usageLimit <= 0) {
            return { title: 'Per-Use Impact', loss: 0, profit: 0, isPerUse: true };
        }
        
        let totalPotentialLoss = 0;
        let totalPotentialProfit = 0;

        if (selectedServices.length > 0) {
            let totalOriginalPrice = 0;
            let totalCost = 0;
            selectedServices.forEach(service => {
                const seniorPrice = service.serviceTiers?.find(t => t.tierId === 'senior')?.price || service.price;
                totalOriginalPrice += seniorPrice;
                totalCost += service.cost;
            });
            const avgOriginalPrice = totalOriginalPrice / selectedServices.length;
            const avgCost = totalCost / selectedServices.length;
            
            const discountAmount = discountType === 'percentage' ? avgOriginalPrice * (discountValue / 100) : discountValue;
            const profitPerUse = avgOriginalPrice - avgCost - discountAmount;
            
            totalPotentialProfit = profitPerUse * usageLimit;
            totalPotentialLoss = discountAmount * usageLimit;

        } else {
            if (discountType === 'fixed') {
                totalPotentialLoss = discountValue * usageLimit;
                totalPotentialProfit = NaN; 
            } else { 
                totalPotentialLoss = NaN;
                totalPotentialProfit = NaN;
            }
        }

        return { title: 'Total Potential Impact', loss: totalPotentialLoss, profit: totalPotentialProfit, isPerUse: false };

    }, [discountType, discountValue, usageLimit, selectedServices]);

    if (!usageLimit || usageLimit <= 0) {
        return null; 
    }

    return (
        <div className="space-y-2">
            <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Exposure Risk Analysis</Label>
            <Card className="bg-muted/50 border-2">
                <CardContent className="p-4 grid grid-cols-2 gap-4">
                     <div className="text-center p-3 rounded-xl bg-background border shadow-sm">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Max Expense</p>
                        {isNaN(impact.loss) ? (
                             <p className="text-xl font-black text-destructive">N/A*</p>
                        ) : (
                             <p className="text-xl font-black text-destructive">-${impact.loss.toFixed(2)}</p>
                        )}
                    </div>
                     <div className="text-center p-3 rounded-xl bg-background border shadow-sm">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Target Net Profit</p>
                         {isNaN(impact.profit) ? (
                            <p className="text-xl font-black text-primary">N/A*</p>
                        ) : (
                            <p className={cn("text-xl font-black", impact.profit >= 0 ? "text-primary" : "text-destructive")}>${impact.profit.toFixed(2)}</p>
                        )}
                    </div>
                </CardContent>
                {isNaN(impact.loss) && (
                     <CardFooter className="p-3 pt-0">
                        <p className="text-[10px] text-muted-foreground text-center w-full leading-tight">* Multi-service percentage discounts depend on the total cart value. Impact cannot be pre-calculated.</p>
                     </CardFooter>
                )}
            </Card>
        </div>
    );
};


export const AddDiscountDialog: React.FC<AddDiscountDialogProps> = ({ open, onOpenChange, onSave, discountToEdit, initialTrigger = 'none' }) => {
    const { services: allServices } = useInventory();
    const [isServiceSelectorOpen, setIsServiceSelectorOpen] = useState(false);
    const isMobile = useIsMobile();

    const { control, handleSubmit, register, watch, reset, setValue, formState: { errors } } = useForm<DiscountFormData>({
        resolver: zodResolver(discountSchema),
        defaultValues: {
            isActive: true,
            type: 'percentage',
            applicableServiceIds: [],
            limitOnePerCustomer: false,
            automation: {
                trigger: initialTrigger,
            }
        }
    });

    const discountType = watch('type');
    const discountValue = watch('value');
    const usageLimit = watch('usageLimit') || 0;
    const selectedServiceIds = watch('applicableServiceIds') || [];
    const automationTrigger = watch('automation.trigger');


    const selectedServices = useMemo(() => {
        return allServices.filter(s => selectedServiceIds.includes(s.id));
    }, [selectedServiceIds, allServices]);

    useEffect(() => {
        if (discountToEdit) {
            reset({
                ...discountToEdit,
                validFrom: discountToEdit.validFrom ? parseISO(discountToEdit.validFrom) : undefined,
                validUntil: discountToEdit.validUntil ? parseISO(discountToEdit.validUntil) : undefined,
                applicableServiceIds: discountToEdit.applicableServiceIds || [],
                limitOnePerCustomer: discountToEdit.limitOnePerCustomer || false,
                automation: discountToEdit.automation || { trigger: 'none' }
            });
        } else {
            reset({
                code: '',
                description: '',
                type: 'percentage',
                value: 10,
                usageLimit: 0,
                isActive: true,
                validFrom: undefined,
                validUntil: undefined,
                applicableServiceIds: [],
                limitOnePerCustomer: false,
                automation: {
                    trigger: initialTrigger || 'none'
                }
            });
        }
    }, [discountToEdit, reset, open, initialTrigger]);
    
    const onSubmit = (data: DiscountFormData) => {
        onSave({
            ...data,
            validFrom: data.validFrom?.toISOString(),
            validUntil: data.validUntil?.toISOString(),
        });
        onOpenChange(false);
    };

    const removeService = (id: string) => {
        setValue('applicableServiceIds', selectedServiceIds.filter(serviceId => serviceId !== id), { shouldDirty: true });
    };

    const formId = "discount-form";
    const title = discountToEdit ? 'Edit Discount' : 'Create New Discount';
    const description = "Define your rules and values. Note: Only one code can be applied per transaction.";

    const formContent = (
      <div className="grid gap-6 py-4">
        <div className="space-y-2">
            <Label htmlFor="code" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Discount Code</Label>
            <Input id="code" placeholder="e.g., SUMMER20" {...register('code')} className="font-black h-12 text-xl tracking-tight" />
            {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
        </div>
        <div className="space-y-2">
            <Label htmlFor="description" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Internal Description</Label>
            <Textarea id="description" placeholder="e.g., Seasonal promotion for email subscribers." {...register('description')} />
        </div>
        <Controller
            name="type"
            control={control}
            render={({ field }) => (
                <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Discount Type</Label>
                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                    <div><RadioGroupItem value="percentage" id="percentage-edit" className="peer sr-only" /><Label htmlFor="percentage-edit" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-sm font-bold hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">% Percentage</Label></div>
                    <div><RadioGroupItem value="fixed" id="fixed-edit" className="peer sr-only" /><Label htmlFor="fixed-edit" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-sm font-bold hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">$ Fixed Amount</Label></div>
                </RadioGroup>
                </div>
            )}
        />
        <div className="space-y-2">
            <Label htmlFor="value" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Value</Label>
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground">
                    {discountType === 'percentage' ? <Percent /> : <DollarSign />}
                </span>
                <Input id="value" type="number" placeholder={discountType === 'percentage' ? '15' : '10.00'} className="pl-9 h-12 text-xl font-black" {...register('value')} />
            </div>
            {errors.value && <p className="text-sm text-destructive">{errors.value.message}</p>}
        </div>

        <Separator />

        <Accordion type="single" collapsible>
            <AccordionItem value="applicability" className="border-0">
                <AccordionTrigger className="p-0 hover:no-underline font-black text-[10px] uppercase tracking-widest text-muted-foreground">Rules & Applicability</AccordionTrigger>
                <AccordionContent className="pt-4 space-y-6">
                    <div className="space-y-2">
                        <Label className="font-bold">Applicability Rules</Label>
                        <p className="text-xs text-muted-foreground">
                            Restrict this discount to specific services to protect your low-margin treatments. Leave empty to apply to the entire cart.
                        </p>
                        {selectedServices.length > 0 && (
                            <Card className="rounded-xl border-2">
                                <CardContent className="p-2 space-y-2">
                                    {selectedServices.map(service => (
                                        <div key={service.id} className="flex justify-between items-center bg-muted/50 p-2.5 rounded-lg border border-border/50">
                                            <span className="text-xs font-bold">{service.name}</span>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeService(service.id)} type="button">
                                                <Trash2 className="h-4 w-4"/>
                                            </Button>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        )}
                        <Button variant="outline" type="button" className="w-full h-11 border-dashed" onClick={() => setIsServiceSelectorOpen(true)}>
                            <PlusCircle className="mr-2 h-4 w-4"/>
                            {selectedServices.length > 0 ? 'Modify Service Restrictions' : 'Restrict to Specific Services'}
                        </Button>
                    </div>

                    {selectedServices.length > 0 && (
                        <ProfitabilityAnalysis services={selectedServices} discountType={discountType} discountValue={discountValue} />
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="usage-limit" className="font-bold">Total Usage Limit</Label>
                        <Input id="usage-limit" type="number" placeholder="0 for unlimited" {...register('usageLimit')} className="h-11" />
                        <p className="text-[10px] text-muted-foreground font-medium uppercase">Set to 0 for unlimited campaign duration.</p>
                    </div>

                    <PotentialImpactAnalysis 
                        discountType={discountType}
                        discountValue={discountValue}
                        usageLimit={usageLimit}
                        selectedServices={selectedServices}
                    />

                    <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-muted/20">
                        <div className="space-y-0.5">
                            <Label htmlFor="limit-per-customer" className="font-bold flex items-center gap-2">One use per customer</Label>
                            <p className="text-[10px] text-muted-foreground uppercase font-black">Prevents repeat exploitation</p>
                        </div>
                        <Controller name="limitOnePerCustomer" control={control} render={({ field }) => (<Switch id="limit-per-customer" checked={field.value} onCheckedChange={field.onChange} /> )}/>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-muted/20">
                        <Label htmlFor="is-active" className="font-bold">Status: Active</Label>
                        <Controller name="isActive" control={control} render={({ field }) => (<Switch id="is-active" checked={field.value} onCheckedChange={field.onChange} /> )}/>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
        
        <Separator />

        <Accordion type="single" collapsible defaultValue={initialTrigger !== 'none' ? 'automation' : undefined}>
            <AccordionItem value="automation" className="border-0">
                <AccordionTrigger className="p-0 hover:no-underline font-black text-[10px] uppercase tracking-widest text-muted-foreground">Smart Automation</AccordionTrigger>
                 <AccordionContent className="pt-4 space-y-4">
                    <Alert className="bg-primary/5 border-primary/20">
                        <Wand className="h-4 w-4 text-primary" />
                        <AlertDescription className="text-xs">
                            Automated discounts are intelligently suggested in the POS whenever an eligible client is checked out.
                        </AlertDescription>
                    </Alert>
                    <Controller
                        name="automation.trigger"
                        control={control}
                        render={({ field }) => (
                        <div className="space-y-2">
                            <Label className="font-bold">Trigger Rule</Label>
                            <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger className="h-11">
                                <SelectValue placeholder="No Automation" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Manual Entry Only</SelectItem>
                                <SelectItem value="new_client">New Client Welcome (1st Visit)</SelectItem>
                                <SelectItem value="loyalty">Loyalty Milestone (Visits)</SelectItem>
                                <SelectItem value="re_engagement">Win-Back (Inactivity)</SelectItem>
                                <SelectItem value="birthday">Birthday Celebration</SelectItem>
                            </SelectContent>
                            </Select>
                        </div>
                        )}
                    />
                    {automationTrigger === 'loyalty' && (
                        <Controller
                        name="automation.appointmentThreshold"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                            <Label className="font-bold">Visit Threshold</Label>
                            <Input type="number" placeholder="e.g., 5" {...field} value={field.value ?? ''} className="h-11" />
                            <p className="text-[10px] text-muted-foreground uppercase font-black">Trigger reward after this many completed services.</p>
                            </div>
                        )}
                        />
                    )}
                    {automationTrigger === 're_engagement' && (
                        <Controller
                        name="automation.daysSinceLastVisit"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                            <Label className="font-bold">Days of Inactivity</Label>
                            <Input type="number" placeholder="e.g., 90" {...field} value={field.value ?? ''} className="h-11" />
                            <p className="text-[10px] text-muted-foreground uppercase font-black">Trigger win-back offer after this many days away.</p>
                            </div>
                        )}
                        />
                    )}
                 </AccordionContent>
            </AccordionItem>
        </Accordion>
      </div>
    );

    const DialogComponent = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <>
            <DialogComponent open={open} onOpenChange={onOpenChange}>
                <ContentComponent
                    className={isMobile ? "h-[90vh] flex flex-col p-0" : "sm:max-w-xl"}
                    side={isMobile ? "bottom" : undefined}
                >
                    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0">
                        <DialogHeader className={cn("p-6 pb-4 flex-shrink-0", isMobile && "p-4 border-b text-left")}>
                            <DialogTitle>{title}</DialogTitle>
                            <DialogDescription>{description}</DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="flex-1">
                            <div className={isMobile ? "p-4" : "p-6 pt-0"}>
                                {formContent}
                            </div>
                        </ScrollArea>
                        <DialogFooter className={cn("flex-shrink-0", isMobile ? "p-4 border-t" : "p-6 pt-4")}>
                           <div className={cn("flex w-full", isMobile ? "grid grid-cols-2 gap-2" : "justify-end gap-2")}>
                                <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button type="submit">Save Discount & Apply Rules</Button>
                            </div>
                        </DialogFooter>
                    </form>
                </ContentComponent>
            </DialogComponent>

            <SelectServicesDialog
                open={isServiceSelectorOpen}
                onOpenChange={setIsServiceSelectorOpen}
                allServices={allServices}
                initialSelected={selectedServices}
                onSelect={(newSelection) => {
                    setValue('applicableServiceIds', newSelection.map(s => s.id), { shouldDirty: true });
                }}
            />
        </>
    );
};