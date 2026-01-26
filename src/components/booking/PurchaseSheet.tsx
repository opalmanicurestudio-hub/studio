
'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Membership, type Package } from '@/lib/data';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { PhoneInput } from '../ui/phone-input';
import { Card, CardContent } from '../ui/card';
import { Award, Repeat, DollarSign, CreditCard, Loader } from 'lucide-react';
import { Separator } from '../ui/separator';

const purchaseSchema = z.object({
  clientName: z.string().min(1, 'Name is required'),
  clientEmail: z.string().email('Invalid email address'),
  clientPhone: z.string().optional(),
});

type PurchaseFormData = z.infer<typeof purchaseSchema>;

interface PurchaseSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: Membership | Package;
    type: 'membership' | 'package';
    onConfirm: (formData: PurchaseFormData, item: Membership | Package, type: 'membership' | 'package') => Promise<void>;
}

export const PurchaseSheet: React.FC<PurchaseSheetProps> = ({
    open,
    onOpenChange,
    item,
    type,
    onConfirm,
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const methods = useForm<PurchaseFormData>({
        resolver: zodResolver(purchaseSchema),
    });
    const { handleSubmit, formState: { errors } } = methods;
    const isMembership = type === 'membership';

    const handleFormSubmit = async (data: PurchaseFormData) => {
        setIsSubmitting(true);
        await onConfirm(data, item, type);
        setIsSubmitting(false);
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
                 <SheetHeader className="p-6 pb-4">
                    <SheetTitle>Purchase {isMembership ? 'Membership' : 'Package'}</SheetTitle>
                    <SheetDescription>Enter your details to complete the purchase.</SheetDescription>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6">
                    <FormProvider {...methods}>
                        <form id="purchase-details-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
                           <Card className="bg-muted/50">
                                <CardContent className="p-4 flex gap-4 items-center">
                                     <div className="p-3 bg-background rounded-lg">
                                        {isMembership ? <Award className="w-6 h-6 text-indigo-500" /> : <Repeat className="w-6 h-6 text-teal-500" />}
                                     </div>
                                     <div>
                                        <p className="font-semibold">{item.name}</p>
                                        <p className="text-sm text-muted-foreground">${item.price.toFixed(2)}{isMembership ? ` / ${(item as Membership).interval.replace('ly', '')}` : ''}</p>
                                     </div>
                                </CardContent>
                            </Card>
                            <div className="space-y-2">
                                <Label htmlFor="clientName">Full Name</Label>
                                <Input id="clientName" {...methods.register('clientName')} />
                                {errors.clientName && <p className="text-sm text-destructive">{errors.clientName.message}</p>}
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="clientEmail">Email</Label>
                                <Input id="clientEmail" type="email" {...methods.register('clientEmail')} />
                                {errors.clientEmail && <p className="text-sm text-destructive">{errors.clientEmail.message}</p>}
                            </div>
                            <PhoneInput name="clientPhone" label="Phone (Optional)" />
                            
                            <Separator />
                            
                            <h3 className="font-medium text-lg">Payment</h3>
                            <Card>
                                <CardContent className="p-4 space-y-4">
                                     <div className="space-y-2"><Label>Card Number</Label><Input placeholder="**** **** **** 1234" /></div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2"><Label>Expiry</Label><Input placeholder="MM / YY" /></div>
                                        <div className="space-y-2"><Label>CVC</Label><Input placeholder="123" /></div>
                                    </div>
                                </CardContent>
                            </Card>
                        </form>
                    </FormProvider>
                </div>
                 <SheetFooter className="p-6 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="submit" form="purchase-details-form" disabled={isSubmitting}>
                        {isSubmitting ? <Loader className="animate-spin mr-2" /> : <CreditCard className="mr-2" />}
                        Pay ${item.price.toFixed(2)}
                    </Button>
                 </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
