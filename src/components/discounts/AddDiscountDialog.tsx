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
import { DollarSign, Percent, PlusCircle, Trash2, Wand, Landmark, Sparkles, ListChecks, Tag } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Discount, type Service, type PricingTier } from '@/lib/data';
import { parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { SelectServicesDialog } from '../services/SelectServicesDialog';
import { Card, CardContent, CardFooter } from '../ui/card';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';

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

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Protocol Entry</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const ProfitabilityAnalysis = ({ 
    services, 
    discountType, 
    discountValue,
    pricingTiers,
}: { 
    services: Service[], 
    discountType: 'percentage' | 'fixed', 
    discountValue: number,
    pricingTiers: PricingTier[],
}) => {
    if (services.length === 0 || !discountValue || discountValue <= 0 || pricingTiers.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Landmark className="w-3 h-3" />
                Service Profitability Analysis
            </h4>
            <Accordion type="multiple" className="w-full space-y-2">
                {services.map(service => (
                    <AccordionItem key={service.id} value={service.id} className="border-2 rounded-2xl overflow-hidden bg-white">
                        <AccordionTrigger className="px-4 py-3 font-black uppercase text-[10px] tracking-widest hover:no-underline bg-muted/10">
                            {service.name}
                        </AccordionTrigger>
                        <AccordionContent className="p-4 space-y-3">
                            {pricingTiers.sort((a, b) => a.rank - b.rank).map(tier => {
                                const tierConfig = service.serviceTiers?.find(t => t.tierId === tier.id);
                                const originalPrice = tierConfig ? tierConfig.price : service.price;
                                const discountAmount = discountType === 'percentage'
                                    ? originalPrice * (discountValue / 100)
                                    : discountValue;
                                const discountedPrice = Math.max(0, originalPrice - discountAmount);
                                const newProfit = discountedPrice - service.cost;
                                const newMargin = discountedPrice > 0 ? (newProfit / discountedPrice) * 100 : 0;

                                return (
                                    <div key={tier.id} className="text-xs space-y-2 p-3 bg-background rounded-xl border shadow-sm">
                                        <div className="flex justify-between items-center">
                                            <p className="font-black uppercase text-[10px] text-muted-foreground tracking-tight">{tier.name}</p>
                                            {newProfit < 0 && <Badge variant="destructive" className="h-4 text-[8px] font-black uppercase border-none">Loss Warning</Badge>}
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Retail: <span className="font-black text-slate-900">${originalPrice.toFixed(2)}</span></span>
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">New: <span className="font-black text-primary">${discountedPrice.toFixed(2)}</span></span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-dashed">
                                            <span className="font-black uppercase text-[10px] tracking-widest">Net Profit</span>
                                            <span className={cn("font-black font-mono text-sm", newProfit >= 0 ? "text-primary" : "text-destructive")}>
                                                ${newProfit.toFixed(2)} ({newMargin.toFixed(0)}%)
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    );
};

const PotentialImpactAnalysis = ({ 
    discountType, 
    discountValue,
    usageLimit,
    selectedServices,
    pricingTiers,
}: { 
    discountType: 'percentage' | 'fixed', 
    discountValue: number,
    usageLimit: number,
    selectedServices: Service[],
    pricingTiers: PricingTier[],
}) => {
    const impact = useMemo(() => {
        if (!usageLimit || usageLimit <= 0) {
            return { title: 'Per-Use Impact', loss: 0, profit: 0, isPerUse: true };
        }

        let totalPotentialLoss = 0;
        let totalPotentialProfit = 0;

        if (selectedServices.length > 0) {
            const baselineTier = pricingTiers.find(t => t.name.toLowerCase().includes('senior')) || pricingTiers[Math.floor(pricingTiers.length / 2)] || pricingTiers[0];
            let totalOriginalPrice = 0;
            let totalCost = 0;

            selectedServices.forEach(service => {
                const tierPrice = service.serviceTiers?.find(t => t.tierId === baselineTier?.id)?.price || service.price;
                totalOriginalPrice += tierPrice;
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
    }, [discountType, discountValue, usageLimit, selectedServices, pricingTiers]);

    if (!usageLimit || usageLimit <= 0) return null;

    return (
        <div className="space-y-3">
            <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Exposure Risk Analysis</Label>
            <Card className="bg-muted/50 border-2 rounded-[2rem] overflow-hidden shadow-inner">
                <CardContent className="p-6 grid grid-cols-2 gap-4">
                    <div className="text-center p-4 rounded-2xl bg-white border shadow-sm space-y-1">
                        <p className="text-[9px] uppercase font-black text-muted-foreground opacity-60">Max Expense</p>
                        {isNaN(impact.loss) ? (
                            <p className="text-xl font-black text-destructive">N/A*</p>
                        ) : (
                            <p className="text-xl font-black text-destructive">-${impact.loss.toFixed(2)}</p>
                        )}
                    </div>
                    <div className="text-center p-4 rounded-2xl bg-white border shadow-sm space-y-1">
                        <p className="text-[9px] uppercase font-black text-muted-foreground opacity-60">Target Yield</p>
                        {isNaN(impact.profit) ? (
                            <p className="text-xl font-black text-primary">N/A*</p>
                        ) : (
                            <p className={cn("text-xl font-black", impact.profit >= 0 ? "text-primary" : "text-destructive")}>${impact.profit.toFixed(2)}</p>
                        )}
                    </div>
                </CardContent>
                {isNaN(impact.loss) && (
                    <CardFooter className="p-4 pt-0">
                        <p className="text-[9px] font-bold text-muted-foreground text-center w-full leading-relaxed uppercase opacity-60">* Multi-service percentage discounts depend on the total cart value.</p>
                    </CardFooter>
                )}
            </Card>
        </div>
    );
};

export const AddDiscountDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (discount: Partial<Discount>) => void;
  discountToEdit: Discount | null;
  initialTrigger?: 'none' | 'new_client' | 'loyalty' | 're_engagement' | 'birthday';
}> = ({ open, onOpenChange, onSave, discountToEdit, initialTrigger = 'none' }) => {
    const { services: allServices, pricingTiers } = useInventory();
    const [isServiceSelectorOpen, setIsServiceSelectorOpen] = useState(false);
    const isMobile = useIsMobile();

    const { control, handleSubmit, register, watch, reset, setValue, formState: { errors } } = useForm<DiscountFormData>({
        resolver: zodResolver(discountSchema),
        defaultValues: {
            isActive: true,
            type: 'percentage',
            applicableServiceIds: [],
            limitOnePerCustomer: false,
            automation: { trigger: initialTrigger },
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
                automation: { trigger: initialTrigger || 'none' }
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

    const formContent = (
        <div className="grid gap-8 py-4">
            <div className="space-y-3">
                <SectionHeader icon={Tag} title="Protocol Identification" />
                <Label htmlFor="code" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Discount Code</Label>
                <Input id="code" placeholder="e.g., SUMMER20" {...register('code')} className="font-black h-14 rounded-2xl border-2 text-3xl tracking-tighter shadow-inner bg-muted/5 focus-visible:ring-primary/20" />
                {errors.code && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.code.message}</p>}
            </div>
            <div className="space-y-3">
                <Label htmlFor="description" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Internal Description</Label>
                <Textarea id="description" placeholder="e.g., Seasonal promotion for email subscribers." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 font-medium" />
            </div>
            <Controller
                name="type"
                control={control}
                render={({ field }) => (
                    <div className="space-y-3">
                        <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Discount Mode</Label>
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                            <label htmlFor="percentage-edit" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-5 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'percentage' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <Percent className={cn("mb-2 h-6 w-6", field.value === 'percentage' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">% Percentage</span>
                                    <RadioGroupItem value="percentage" id="percentage-edit" className="sr-only" />
                                </div>
                            </label>
                            <label htmlFor="fixed-edit" className="cursor-pointer">
                                <div className={cn(
                                    "flex flex-col items-center justify-center p-5 rounded-[2rem] border-2 transition-all h-full",
                                    field.value === 'fixed' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <DollarSign className={cn("mb-2 h-6 w-6", field.value === 'fixed' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">$ Fixed Amount</span>
                                    <RadioGroupItem value="fixed" id="fixed-edit" className="sr-only" />
                                </div>
                            </label>
                        </RadioGroup>
                    </div>
                )}
            />
            <div className="space-y-3">
                <Label htmlFor="value" className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Incentive Value</Label>
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 h-8 w-8 text-primary opacity-40 flex items-center justify-center">
                        {discountType === 'percentage' ? <Percent className="w-6 h-6" /> : <DollarSign className="w-6 h-6" />}
                    </span>
                    <Input id="value" type="number" placeholder={discountType === 'percentage' ? '15' : '10.00'} className="pl-14 h-20 rounded-[2rem] border-4 font-black text-5xl tracking-tighter text-primary shadow-inner bg-muted/5 focus-visible:ring-primary/20 text-center" {...register('value')} />
                </div>
                {errors.value && <p className="text-[10px] font-bold text-destructive uppercase ml-1 text-center">{errors.value.message}</p>}
            </div>

            <Separator className="border-dashed" />

            <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="applicability" className="border-none">
                    <AccordionTrigger className="p-4 bg-muted/30 rounded-2xl border-2 hover:no-underline shadow-sm">
                        <div className="flex items-center gap-2">
                            <ListChecks className="w-4 h-4 text-primary" />
                            <span className="font-black uppercase text-xs tracking-widest text-primary">Rules & Applicability</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-8 space-y-10 px-1">
                        <div className="space-y-6">
                            <div className="space-y-1 text-left">
                                <Label className="font-black uppercase text-[10px] tracking-widest text-muted-foreground ml-1">Service Constraints</Label>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-relaxed ml-1 opacity-60">
                                    Restrict this discount to specific treatments to safeguard low-margin sessions. Leave empty for studio-wide application.
                                </p>
                            </div>
                            {selectedServices.length > 0 && (
                                <div className="grid gap-2">
                                    {selectedServices.map(service => (
                                        <div key={service.id} className="flex justify-between items-center bg-white p-4 rounded-2xl border-2 shadow-sm group">
                                            <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate">{service.name}</span>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-40 group-hover:opacity-100 transition-opacity" onClick={() => removeService(service.id)} type="button">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <Button variant="outline" type="button" className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-[0.2em] shadow-inner bg-muted/5" onClick={() => setIsServiceSelectorOpen(true)}>
                                <PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" />
                                {selectedServices.length > 0 ? 'Modify Treatment Registry' : 'Define Service Constraints'}
                            </Button>
                        </div>

                        {selectedServices.length > 0 && (
                            <ProfitabilityAnalysis
                                services={selectedServices}
                                discountType={discountType}
                                discountValue={discountValue}
                                pricingTiers={pricingTiers}
                            />
                        )}

                        <div className="space-y-3 text-left">
                            <Label htmlFor="usage-limit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Protocol Lifespan (Usage Limit)</Label>
                            <Input id="usage-limit" type="number" placeholder="0 FOR UNLIMITED DEPLOYMENT" {...register('usageLimit')} className="h-12 rounded-xl border-2 font-black text-center text-sm shadow-inner bg-muted/5" />
                        </div>

                        <PotentialImpactAnalysis
                            discountType={discountType}
                            discountValue={discountValue}
                            usageLimit={usageLimit}
                            selectedServices={selectedServices}
                            pricingTiers={pricingTiers}
                        />

                        <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="limit-per-customer" className="text-base font-black uppercase tracking-tight">Cap Usage per Guest</Label>
                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight opacity-60">Prevents repeated protocol exploitation</p>
                            </div>
                            <Controller name="limitOnePerCustomer" control={control} render={({ field }) => (
                                <Switch id="limit-per-customer" checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
                            )} />
                        </div>
                        <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/5 shadow-inner border-primary/10">
                            <Label htmlFor="is-active" className="text-base font-black uppercase tracking-tight text-primary">Protocol Status: Active</Label>
                            <Controller name="isActive" control={control} render={({ field }) => (
                                <Switch id="is-active" checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
                            )} />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <Separator className="border-dashed" />

            <Accordion type="single" collapsible className="w-full" defaultValue={initialTrigger !== 'none' ? 'automation' : undefined}>
                <AccordionItem value="automation" className="border-none">
                    <AccordionTrigger className="p-4 bg-primary/5 rounded-2xl border-2 border-primary/10 hover:no-underline shadow-sm">
                        <div className="flex items-center gap-2">
                            <Wand className="w-4 h-4 text-primary" />
                            <span className="font-black uppercase text-xs tracking-widest text-primary">Smart Automation Architecture</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-8 space-y-8 px-1 text-left">
                        <Alert className="bg-primary/5 border-primary/20 rounded-2xl p-5 border-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            <AlertDescription className="text-[10px] font-bold uppercase tracking-tight leading-relaxed text-slate-600">
                                Automated scripts are intelligently evaluated during guest checkout and suggested in the studio terminal when criteria are met.
                            </AlertDescription>
                        </Alert>
                        <Controller
                            name="automation.trigger"
                            control={control}
                            render={({ field }) => (
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Automated Trigger Rule</Label>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5">
                                            <SelectValue placeholder="Manual Entry Only" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            <SelectItem value="none" className="font-bold uppercase text-[10px] tracking-widest">MANUAL PROTOCOL ONLY</SelectItem>
                                            <SelectItem value="new_client" className="font-bold uppercase text-[10px] tracking-widest">NEW GUEST WELCOME (1ST VISIT)</SelectItem>
                                            <SelectItem value="loyalty" className="font-bold uppercase text-[10px] tracking-widest">LOYALTY MILESTONE (VISIT THRESHOLD)</SelectItem>
                                            <SelectItem value="re_engagement" className="font-bold uppercase text-[10px] tracking-widest">WIN-BACK (DORMANT GUEST)</SelectItem>
                                            <SelectItem value="birthday" className="font-bold uppercase text-[10px] tracking-widest">BIRTHDAY CELEBRATION</SelectItem>
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
                                    <div className="space-y-3 animate-in slide-in-from-top-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Visit Threshold</Label>
                                        <Input type="number" placeholder="e.g., 5" {...field} value={field.value ?? ''} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-white text-center" />
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase text-center opacity-60">Authorize reward after this many completed treatments.</p>
                                    </div>
                                )}
                            />
                        )}
                        {automationTrigger === 're_engagement' && (
                            <Controller
                                name="automation.daysSinceLastVisit"
                                control={control}
                                render={({ field }) => (
                                    <div className="space-y-3 animate-in slide-in-from-top-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Inactivity Window (Days)</Label>
                                        <Input type="number" placeholder="e.g., 90" {...field} value={field.value ?? ''} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-white text-center" />
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase text-center opacity-60">Authorize acquisition script after this many dormant days.</p>
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
                    className={cn(
                        "p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden",
                        isMobile
                            ? "h-[92dvh] rounded-t-[3rem]"
                            : "sm:max-w-xl rounded-[3rem] border-4 max-h-[90dvh]"
                    )}
                    side={isMobile ? "bottom" : undefined}
                >
                    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                        <DialogHeader className="flex-shrink-0 text-left border-b bg-muted/5 p-8 pb-6">
                            <div className="flex items-center gap-3 mb-2">
                                <Sparkles className="w-5 h-5 text-primary" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
                            </div>
                            <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Initialize Discount</DialogTitle>
                            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Define your rules and values. Note: Only one code can be applied per transaction.</DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 min-h-0 overflow-y-auto">
                            <div className="p-8 pb-32">
                                {formContent}
                            </div>
                        </div>

                        <DialogFooter className="border-t bg-background flex-shrink-0 shadow-2xl p-8 pt-4">
                            <div className="grid grid-cols-2 gap-3 w-full">
                                <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                                <Button type="submit" className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30">Commit Protocol</Button>
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
