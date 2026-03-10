'use client';

import React, { useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { 
    DollarSign, 
    Calendar as CalendarIcon, 
    CreditCard, 
    Sparkles, 
    Check, 
    ArrowRight, 
    Landmark,
    FileText,
    Activity,
    Tag
} from 'lucide-react';
import { type BillDefinition, type BillInstance } from '@/lib/financial-data';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ImageUpload } from '../shared/ImageUpload';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';

const paymentSchema = z.object({
  amount: z.coerce.number().positive({ message: 'Amount must be greater than zero.' }),
  date: z.date({ required_error: 'A payment date is required.' }),
  paymentMethod: z.string().min(1, 'Please select a payment method.'),
  paymentMethodIdentifier: z.string().optional(),
  receiptUrl: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface LogPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billInstance: (BillInstance & { definition: BillDefinition }) | null;
  onConfirm: (paymentData: PaymentFormData) => void;
}

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
        <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-4 h-4 md:w-5 md:h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-primary/60">Module Entry</p>
            <h3 className="text-sm md:text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const LogPaymentForm = ({ billInstance }: { billInstance: BillInstance & { definition: BillDefinition } }) => {
  const { control, formState: { errors }, watch, register } = useFormContext<PaymentFormData>();
  const amount = watch('amount');

  const amountRemaining = billInstance.amountDue - (amount || 0);

  return (
    <div className="space-y-8 md:space-y-10">
        <div className="space-y-6 md:space-y-8">
            <SectionHeader icon={DollarSign} title="Settlement Parameters" />
            <div className="space-y-4 md:space-y-6">
                <Controller
                    name="amount"
                    control={control}
                    render={({ field }) => (
                    <div className="space-y-2 md:space-y-3 text-left">
                        <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Payment Amount</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 md:h-8 md:w-8 text-primary opacity-40" />
                            <Input 
                                id="amount" 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                className="h-14 md:h-20 pl-12 md:pl-14 rounded-2xl md:rounded-[2rem] border-2 md:border-4 font-black text-3xl md:text-5xl tracking-tighter text-primary shadow-inner bg-muted/5 focus-visible:ring-primary/20 text-center" 
                                {...field} 
                            />
                        </div>
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[8px] md:text-[9px] font-black uppercase text-muted-foreground opacity-60">Remaining: ${amountRemaining.toFixed(2)}</p>
                            {errors.amount && <p className="text-[8px] md:text-[9px] font-black text-destructive uppercase">{errors.amount.message}</p>}
                        </div>
                    </div>
                    )}
                />
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                    <Controller
                        name="date"
                        control={control}
                        render={({ field }) => (
                        <div className="space-y-1.5 md:space-y-2 text-left">
                            <Label htmlFor="payment-date" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Effective Date</Label>
                            <div className="relative">
                                <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 md:h-5 md:w-5 text-primary opacity-40" />
                                <Input
                                    id="payment-date"
                                    type="date"
                                    value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)}
                                    className="h-12 md:h-14 pl-10 md:pl-12 rounded-xl md:rounded-2xl border-2 font-black text-base md:text-xl shadow-inner bg-muted/5"
                                />
                            </div>
                            {errors.date && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.date.message}</p>}
                        </div>
                        )}
                    />
                    
                    <div className="space-y-1.5 md:space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Method</Label>
                        <Controller
                            name="paymentMethod"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger className="h-12 md:h-14 rounded-xl md:rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-tight shadow-inner bg-muted/5">
                                        <SelectValue placeholder="Select Method" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="Business Checking" className="font-bold uppercase text-[10px] tracking-widest">BUSINESS CHECKING</SelectItem>
                                        <SelectItem value="Business Credit Card" className="font-bold uppercase text-[10px] tracking-widest">BUSINESS CREDIT CARD</SelectItem>
                                        <SelectItem value="Personal Checking" className="font-bold uppercase text-[10px] tracking-widest">PERSONAL CHECKING</SelectItem>
                                        <SelectItem value="Personal Credit Card" className="font-bold uppercase text-[10px] tracking-widest">PERSONAL CREDIT CARD</SelectItem>
                                        <SelectItem value="Cash" className="font-bold uppercase text-[10px] tracking-widest">CASH TENDER</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>
                </div>
            </div>
        </div>

        <Separator className="border-dashed" />

        <div className="space-y-6 md:space-y-8">
            <SectionHeader icon={FileText} title="Audit Verification" />
            <div className="space-y-4 md:space-y-6 text-left">
                <div className="space-y-1.5 md:space-y-2">
                    <Label htmlFor="paymentMethodIdentifier" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Account Reference (Optional)</Label>
                    <Input id="paymentMethodIdentifier" placeholder="e.g., Chase ****1234" {...register('paymentMethodIdentifier')} className="h-11 md:h-12 rounded-xl border-2 font-mono font-black uppercase text-xs md:text-sm shadow-inner" />
                </div>
                
                <div className="space-y-1.5 md:space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Digital Receipt</Label>
                    <Controller
                        name="receiptUrl"
                        control={control}
                        render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}
                    />
                </div>

                <div className="space-y-1.5 md:space-y-2">
                    <Label htmlFor="notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Internal Log Notes</Label>
                    <Textarea id="notes" placeholder="e.g., Confirmation #12345..." {...register('notes')} className="rounded-xl md:rounded-2xl border-2 bg-muted/5 min-h-[80px] md:min-h-[100px] focus-visible:ring-primary/20 font-medium p-4 md:p-6" />
                </div>
            </div>
        </div>
    </div>
  );
};

export const LogPaymentDialog: React.FC<LogPaymentDialogProps> = ({
  open,
  onOpenChange,
  billInstance,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
  });
  const { handleSubmit, reset } = methods;

  useEffect(() => {
    if (billInstance) {
      reset({
        amount: billInstance.amountDue,
        date: new Date(),
        paymentMethod: billInstance.definition.context === 'Business' ? 'Business Checking' : 'Personal Checking',
        paymentMethodIdentifier: '',
        receiptUrl: '',
        notes: '',
      });
    }
  }, [billInstance, reset]);

  if (!billInstance) return null;

  const title = "Log Settlement";
  const description = `Recording distribution for: ${billInstance.definition.name}`;

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? 'bottom' : 'right'} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-xl max-h-[90dvh]")}>
        <SheetHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6 pb-4" : "p-8 pb-6")}>
            <div className="flex items-center gap-2 md:gap-3 mb-1.5 md:mb-2">
                <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Distribution</span>
            </div>
            <SheetTitle className="text-xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</SheetTitle>
            <SheetDescription className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{description}</SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1">
            <div className={cn("p-6 md:p-8 pb-32")}>
                <FormProvider {...methods}>
                    <LogPaymentForm billInstance={billInstance} />
                </FormProvider>
            </div>
        </ScrollArea>

        <SheetFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8")}>
            <div className="flex w-full gap-3 md:gap-4">
                <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-11 md:h-14 font-black uppercase tracking-widest text-[10px] md:text-[11px] text-slate-500">Cancel</Button>
                <Button onClick={handleSubmit(onConfirm)} className="flex-[2] h-11 md:h-14 rounded-xl md:rounded-[2rem] font-black uppercase tracking-widest text-[10px] md:text-[11px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Confirm Settlement <ArrowRight className="ml-2 w-3.5 h-3.5 md:w-4 md:h-4 transition-transform group-hover:translate-x-1"/></Button>
            </div>
        </SheetFooter>
      </ContentComponent>
    </DialogComponent>
  );
};