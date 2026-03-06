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
import { Award, Repeat, DollarSign, CreditCard, Loader, Sparkles, ShieldCheck, Lock, ArrowRight } from 'lucide-react';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

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
    const [step, setStep] = useState<'info' | 'payment' | 'success'>('info');
    
    const methods = useForm<PurchaseFormData>({
        resolver: zodResolver(purchaseSchema),
    });
    const { handleSubmit, formState: { errors } } = methods;
    const isMembership = type === 'membership';

    const handleFormSubmit = async (data: PurchaseFormData) => {
        if (step === 'info') {
            const valid = await methods.trigger();
            if (valid) setStep('payment');
            return;
        }
        setIsSubmitting(true);
        await onConfirm(data, item, type);
        setIsSubmitting(false);
        setStep('success');
    };

    return (
        <Sheet open={open} onOpenChange={(val) => { onOpenChange(val); if(!val) setStep('info'); }}>
            <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col border-l-0 sm:border-l bg-background overflow-hidden">
                 <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Access Unlock</span>
                    </div>
                    <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900">
                        {isMembership ? 'Unlock Membership' : 'Secure Package'}
                    </SheetTitle>
                    <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Complete your {type} acquisition.</SheetDescription>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className="p-8 space-y-12 pb-32">
                        <AnimatePresence mode="wait">
                            {step === 'success' ? (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-12 space-y-8" key="success">
                                    <div className="w-32 h-32 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                                        <ShieldCheck className="w-16 h-16 text-green-500 -rotate-6" />
                                    </div>
                                    <div className="space-y-3">
                                        <h2 className="text-4xl font-black uppercase tracking-tighter">Welcome Aboard!</h2>
                                        <p className="text-muted-foreground font-medium max-w-sm mx-auto leading-relaxed">You have successfully unlocked the <strong className="text-foreground">{item.name}</strong>. Confirmation details are heading to your inbox.</p>
                                    </div>
                                    <Button className="w-full h-16 text-lg font-black uppercase tracking-widest rounded-3xl shadow-2xl shadow-primary/20" variant="outline" onClick={() => onOpenChange(false)}>Return to Studio</Button>
                                </motion.div>
                            ) : (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key={step} className="space-y-10">
                                    <div className="space-y-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Tier Selection</p>
                                        <Card className={cn("overflow-hidden rounded-[2rem] border-2 shadow-2xl shadow-primary/5", isMembership ? "border-indigo-500/20 bg-indigo-500/[0.02]" : "border-teal-500/20 bg-teal-500/[0.02]")}>
                                            <CardContent className="p-8 flex gap-6 items-center">
                                                <div className={cn("p-4 rounded-2xl shadow-inner", isMembership ? "bg-indigo-100 text-indigo-600" : "bg-teal-100 text-teal-600")}>
                                                    {isMembership ? <Award className="w-10 h-10" /> : <Repeat className="w-10 h-10" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-black text-2xl uppercase tracking-tighter leading-none mb-2">{item.name}</p>
                                                    <div className="flex items-baseline gap-1.5">
                                                        <span className="text-2xl font-black text-primary tracking-tighter">${item.price.toFixed(2)}</span>
                                                        <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{isMembership ? `/ ${(item as Membership).interval.replace('ly', '')}` : 'Total'}</span>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {step === 'info' ? (
                                        <FormProvider {...methods}>
                                            <form id="purchase-details-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-10">
                                                <div className="space-y-2">
                                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                                        <User className="w-6 h-6 text-primary" />
                                                        Payer Profile
                                                    </h3>
                                                    <p className="text-xs font-medium text-muted-foreground">Associated account details.</p>
                                                </div>
                                                <div className="space-y-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Legal Name</Label>
                                                        <Input {...methods.register('clientName')} className="h-14 rounded-2xl border-2 text-lg font-bold shadow-inner" placeholder="e.g., Alexander Smith" />
                                                        {errors.clientName && <p className="text-xs text-destructive font-bold uppercase">{errors.clientName.message}</p>}
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Email Address</Label>
                                                        <Input type="email" {...methods.register('clientEmail')} className="h-14 rounded-2xl border-2 text-lg font-bold shadow-inner" placeholder="alex@example.com" />
                                                        {errors.clientEmail && <p className="text-xs text-destructive font-bold uppercase">{errors.clientEmail.message}</p>}
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile Contact</Label>
                                                        <PhoneInput name="clientPhone" label="" className="h-14" />
                                                    </div>
                                                </div>
                                            </form>
                                        </FormProvider>
                                    ) : (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                                            <div className="space-y-2">
                                                <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                                    <CreditCard className="w-6 h-6 text-primary" />
                                                    Secure Payment
                                                </h3>
                                                <p className="text-xs font-medium text-muted-foreground">Billed securely via encrypted checkout.</p>
                                            </div>
                                            <Card className="border-4 rounded-[3rem] shadow-2xl overflow-hidden border-primary/10">
                                                <CardContent className="p-10 space-y-8">
                                                    <div className="space-y-4">
                                                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Number</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 text-lg font-mono" /></div>
                                                        <div className="grid grid-cols-2 gap-6"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-14 rounded-2xl border-2 text-lg text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-14 rounded-2xl border-2 text-lg text-center" /></div></div>
                                                    </div>
                                                    <div className="flex items-center gap-3 p-4 bg-muted/20 rounded-2xl text-xs text-muted-foreground font-medium italic">
                                                        <Lock className="w-4 h-4 shrink-0" />
                                                        Encrypted SSL Secure Payment
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </ScrollArea>

                {step !== 'success' && (
                    <SheetFooter className="p-8 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20">
                        <div className="flex w-full gap-4">
                            {step === 'payment' && (
                                <Button variant="ghost" onClick={() => setStep('info')} className="flex-1 h-16 md:h-20 rounded-3xl font-black uppercase tracking-tighter text-lg md:text-2xl text-slate-400">
                                    Back
                                </Button>
                            )}
                            <Button 
                                type="submit" 
                                form={step === 'info' ? "purchase-details-form" : undefined}
                                onClick={step === 'payment' ? handleSubmit(handleFormSubmit) : undefined}
                                disabled={isSubmitting}
                                className={cn(
                                    "h-16 md:h-20 font-black uppercase tracking-widest text-lg md:text-2xl rounded-[2rem] shadow-2xl shadow-primary/30 group transition-all",
                                    step === 'info' ? "w-full" : "flex-[2.5]"
                                )}
                            >
                                {isSubmitting ? (
                                    <Loader className="animate-spin h-8 w-8" />
                                ) : (
                                    <>
                                        {step === 'info' ? 'Next: Payment' : `Unlock Access • $${item.price.toFixed(2)}`}
                                        <ArrowRight className="ml-3 w-6 h-6 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" />
                                    </>
                                )}
                            </Button>
                        </div>
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    )
}
