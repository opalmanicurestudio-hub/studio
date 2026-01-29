

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
import { DollarSign, Percent, PlusCircle, Trash2, Users, AlertTriangle } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Discount, type Service } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { SelectServicesDialog } from '../services/SelectServicesDialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';

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
}).refine(data => data.type !== 'percentage' || (data.value >= 1 && data.value <= 100), {
  message: "Percentage must be between 1 and 100.",
  path: ["value"],
});

type DiscountFormData = z.infer<typeof discountSchema>;

interface AddDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Partial<Discount>) => void;
  discountToEdit: Discount | null;
}

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
            <h4 className="font-medium text-sm">Profitability Analysis per Service</h4>
            <Accordion type="multiple" className="w-full space-y-2">
                {services.map(service => {
                    const tiers = [
                        { level: 'apprentice', price: service.pricingTiers?.find(t => t.level === 'apprentice')?.price || service.price * 0.8 },
                        { level: 'junior', price: service.pricingTiers?.find(t => t.level === 'junior')?.price || service.price * 0.9 },
                        { level: 'senior', price: service.pricingTiers?.find(t => t.level === 'senior')?.price || service.price },
                        { level: 'master', price: service.pricingTiers?.find(t => t.level === 'master')?.price || service.price * 1.2 },
                    ];

                    return (
                        <AccordionItem key={service.id} value={service.id} className="border rounded-md">
                            <AccordionTrigger className="p-3 font-medium text-sm hover:no-underline">
                                {service.name}
                            </AccordionTrigger>
                            <AccordionContent className="p-3 pt-0 text-xs space-y-2">
                                {tiers.map(tier => {
                                    const originalPrice = tier.price;
                                    const discountedPrice = discountType === 'percentage'
                                        ? originalPrice * (1 - discountValue / 100)
                                        : originalPrice - discountValue;
                                    
                                    const newProfit = discountedPrice - service.cost;
                                    const newMargin = discountedPrice > 0 ? (newProfit / discountedPrice) * 100 : 0;

                                    return (
                                        <div key={tier.level} className="text-xs space-y-2 p-2 bg-background rounded-md border">
                                            <p className="font-semibold text-sm capitalize">{tier.level}</p>
                                            <div className="flex justify-between">
                                                <span>Original Price: <span className="font-mono">${originalPrice.toFixed(2)}</span></span>
                                                <span>Profit: <span className="font-mono">${(originalPrice - service.cost).toFixed(2)}</span></span>
                                            </div>
                                            <div className="flex justify-between font-semibold text-primary">
                                                <span>Discounted Price: <span className="font-mono">${discountedPrice.toFixed(2)}</span></span>
                                                <span>New Profit: <span className={cn("font-mono", newProfit < 0 && "text-destructive")}>${newProfit.toFixed(2)}</span> ({newMargin.toFixed(1)}%)</span>
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
                const seniorPrice = service.pricingTiers?.find(t => t.level === 'senior')?.price || service.price;
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
            <Label>Potential Financial Impact</Label>
            <Card className="bg-muted/50">
                <CardContent className="p-4 grid grid-cols-2 gap-4">
                     <div className="text-center p-3 rounded-lg bg-background">
                        <p className="text-xs text-muted-foreground">Est. Total Discount</p>
                        {isNaN(impact.loss) ? (
                             <p className="text-lg font-bold text-destructive">N/A*</p>
                        ) : (
                             <p className="text-lg font-bold text-destructive">-${impact.loss.toFixed(2)}</p>
                        )}
                    </div>
                     <div className="text-center p-3 rounded-lg bg-background">
                        <p className="text-xs text-muted-foreground">Est. Total Net Profit</p>
                         {isNaN(impact.profit) ? (
                            <p className="text-lg font-bold text-primary">N/A*</p>
                        ) : (
                            <p className={cn("text-lg font-bold", impact.profit >= 0 ? "text-primary" : "text-destructive")}>${impact.profit.toFixed(2)}</p>
                        )}
                    </div>
                </CardContent>
                {isNaN(impact.loss) && (
                     <CardFooter className="p-2 pt-0">
                        <p className="text-[10px] text-muted-foreground text-center w-full">* Cart-wide percentage discounts depend on the total value of each sale.</p>
                     </CardFooter>
                )}
            </Card>
        </div>
    );
};


export const AddDiscountDialog: React.FC<AddDiscountDialogProps> = ({ open, onOpenChange, onSave, discountToEdit }) => {
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
        }
    });

    const discountType = watch('type');
    const discountValue = watch('value');
    const usageLimit = watch('usageLimit') || 0;
    const selectedServiceIds = watch('applicableServiceIds') || [];

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
            });
        }
    }, [discountToEdit, reset, open]);
    
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
    const description = "Fill in the details for your promotional code.";

    const formContent = (
      <div className="grid gap-6 py-4">
        <div className="space-y-2">
            <Label htmlFor="code">Discount Code</Label>
            <Input id="code" placeholder="e.g., SUMMER20" {...register('code')} />
            {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
        </div>
        <div className="space-y-2">
            <Label htmlFor="description">Description (Internal)</Label>
            <Textarea id="description" placeholder="e.g., Summer sale promotion" {...register('description')} />
        </div>
        <Controller
            name="type"
            control={control}
            render={({ field }) => (
                <div className="space-y-2">
                <Label>Type</Label>
                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                    <div><RadioGroupItem value="percentage" id="percentage" className="peer sr-only" /><Label htmlFor="percentage" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-3 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">% Percentage</Label></div>
                    <div><RadioGroupItem value="fixed" id="fixed" className="peer sr-only" /><Label htmlFor="fixed" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-3 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">$ Fixed Amount</Label></div>
                </RadioGroup>
                </div>
            )}
        />
        <div className="space-y-2">
            <Label htmlFor="value">Value</Label>
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground">
                    {discountType === 'percentage' ? <Percent /> : <DollarSign />}
                </span>
                <Input id="value" type="number" placeholder={discountType === 'percentage' ? '15' : '10.00'} className="pl-8" {...register('value')} />
            </div>
            {errors.value && <p className="text-sm text-destructive">{errors.value.message}</p>}
        </div>

        <Separator />

        <div className="space-y-2">
            <Label>Applicability</Label>
            <p className="text-xs text-muted-foreground">
                Apply this discount to specific services, or leave empty to apply to the entire cart.
            </p>
            {selectedServices.length > 0 && (
                <Card>
                    <CardContent className="p-2 space-y-2">
                        {selectedServices.map(service => (
                            <div key={service.id} className="flex justify-between items-center bg-muted/50 p-2 rounded-md">
                                <span className="text-sm font-medium">{service.name}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeService(service.id)} type="button">
                                    <Trash2 className="h-4 w-4"/>
                                </Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
            <Button variant="outline" type="button" className="w-full" onClick={() => setIsServiceSelectorOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4"/>
                {selectedServices.length > 0 ? 'Edit Services' : 'Select Services'}
            </Button>
        </div>

        {selectedServices.length > 0 && (
            <ProfitabilityAnalysis services={selectedServices} discountType={discountType} discountValue={discountValue} />
        )}
        
        <Separator />

        <div className="space-y-2">
            <Label htmlFor="usage-limit">Usage Limit</Label>
            <Input id="usage-limit" type="number" placeholder="0 for unlimited" {...register('usageLimit')} />
            <p className="text-xs text-muted-foreground">Set to 0 for unlimited uses.</p>
        </div>

         <PotentialImpactAnalysis 
            discountType={discountType}
            discountValue={discountValue}
            usageLimit={usageLimit}
            selectedServices={selectedServices}
        />

        <div className="flex items-center justify-between">
            <Label htmlFor="limit-per-customer" className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" />One use per customer</Label>
            <Controller name="limitOnePerCustomer" control={control} render={({ field }) => (<Switch id="limit-per-customer" checked={field.value} onCheckedChange={field.onChange} /> )}/>
        </div>
        <div className="flex items-center justify-between">
            <Label htmlFor="is-active">Active</Label>
            <Controller name="isActive" control={control} render={({ field }) => (<Switch id="is-active" checked={field.value} onCheckedChange={field.onChange} /> )}/>
        </div>
      </div>
    );

    const DialogComponent = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <>
            <DialogComponent open={open} onOpenChange={onOpenChange}>
                <ContentComponent
                    className={isMobile ? "h-[90vh] flex flex-col p-0" : "sm:max-w-md"}
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
                                <Button type="submit">Save Discount</Button>
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
