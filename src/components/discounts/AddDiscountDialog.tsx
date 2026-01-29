
'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CalendarIcon, DollarSign, Percent } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Discount } from '@/lib/data';
import { format, parseISO } from 'date-fns';

const discountSchema = z.object({
  code: z.string().min(3, "Code must be at least 3 characters.").toUpperCase(),
  description: z.string().optional(),
  type: z.enum(['percentage', 'fixed']),
  value: z.coerce.number().min(0.01, "Value must be positive."),
  usageLimit: z.coerce.number().min(0).optional(),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
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

export const AddDiscountDialog: React.FC<AddDiscountDialogProps> = ({ open, onOpenChange, onSave, discountToEdit }) => {
    const { control, handleSubmit, register, watch, reset, formState: { errors } } = useForm<DiscountFormData>({
        resolver: zodResolver(discountSchema),
        defaultValues: {
            isActive: true,
            type: 'percentage',
        }
    });

    const discountType = watch('type');

    useEffect(() => {
        if (discountToEdit) {
            reset({
                ...discountToEdit,
                validFrom: discountToEdit.validFrom ? parseISO(discountToEdit.validFrom) : undefined,
                validUntil: discountToEdit.validUntil ? parseISO(discountToEdit.validUntil) : undefined,
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
            });
        }
    }, [discountToEdit, reset, open]);
    
    const onSubmit = (data: DiscountFormData) => {
        onSave({
            ...data,
            validFrom: data.validFrom?.toISOString(),
            validUntil: data.validUntil?.toISOString(),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{discountToEdit ? 'Edit Discount' : 'Create New Discount'}</DialogTitle>
                    <DialogDescription>
                        Fill in the details for your promotional code.
                    </DialogDescription>
                </DialogHeader>
                <form id="discount-form" onSubmit={handleSubmit(onSubmit)}>
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
                         <div className="space-y-2">
                            <Label htmlFor="usage-limit">Usage Limit</Label>
                            <Input id="usage-limit" type="number" placeholder="0 for unlimited" {...register('usageLimit')} />
                            <p className="text-xs text-muted-foreground">Set to 0 for unlimited uses.</p>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="is-active">Active</Label>
                            <Controller name="isActive" control={control} render={({ field }) => (<Switch id="is-active" checked={field.value} onCheckedChange={field.onChange} /> )}/>
                        </div>
                    </div>
                </form>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="submit" form="discount-form">Save Discount</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
