
'use client';

import React, { useState, useEffect } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, DollarSign } from 'lucide-react';
import { type BillDefinition, type BillInstance } from '@/lib/financial-data';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const paymentSchema = z.object({
  amount: z.coerce.number().positive({ message: 'Amount must be greater than zero.' }),
  date: z.date({ required_error: 'A payment date is required.' }),
  paymentMethod: z.string().min(1, 'Please select a payment method.'),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface LogPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billInstance: (BillInstance & { definition: BillDefinition }) | null;
  onConfirm: (paymentData: { amount: number; date: Date; paymentMethod: string; notes?: string }) => void;
}

const LogPaymentForm = ({ billInstance }: { billInstance: BillInstance & { definition: BillDefinition } }) => {
  const { control, formState: { errors }, watch } = useFormContext<PaymentFormData>();
  const amount = watch('amount');

  const amountRemaining = billInstance.amountDue - (amount || 0);

  return (
    <div className="space-y-4">
      <Controller
        name="amount"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="amount" type="number" step="0.01" placeholder="0.00" className="pl-8" {...field} />
            </div>
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            <p className="text-xs text-muted-foreground">
              ${amountRemaining.toFixed(2)} will remain due.
            </p>
          </div>
        )}
      />
      <Controller
        name="date"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="payment-date">Payment Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="payment-date"
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
              </PopoverContent>
            </Popover>
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>
        )}
      />
      <Controller
        name="paymentMethod"
        control={control}
        render={({ field }) => (
            <div className="space-y-2">
                <Label htmlFor="paymentMethod">Payment Method</Label>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger id="paymentMethod">
                    <SelectValue placeholder="Select a payment method" />
                    </SelectTrigger>
                    <SelectContent>
                    <SelectItem value="Business Checking">Business Checking</SelectItem>
                    <SelectItem value="Business Credit Card">Business Credit Card</SelectItem>
                    <SelectItem value="Personal Checking">Personal Checking</SelectItem>
                    <SelectItem value="Personal Credit Card">Personal Credit Card</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    </SelectContent>
                </Select>
                {errors.paymentMethod && <p className="text-sm text-destructive">{errors.paymentMethod.message}</p>}
            </div>
        )}
      />
      <Controller
        name="notes"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea id="notes" placeholder="e.g., Confirmation #12345" {...field} />
          </div>
        )}
      />
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
        notes: '',
      });
    }
  }, [billInstance, reset]);

  if (!billInstance) return null;

  const title = "Log Payment";
  const description = `Record a payment for "${billInstance.definition.name}".`;

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;
  const HeaderComponent = isMobile ? SheetHeader : DialogHeader;
  const TitleComponent = isMobile ? SheetTitle : DialogTitle;
  const DescriptionComponent = isMobile ? SheetDescription : DialogDescription;
  const FooterComponent = isMobile ? SheetFooter : DialogFooter;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? 'bottom' : undefined} className={cn(isMobile && "h-[80vh] flex flex-col")}>
        <HeaderComponent className={cn(isMobile && "text-left")}>
          <TitleComponent>{title}</TitleComponent>
          <DescriptionComponent>{description}</DescriptionComponent>
        </HeaderComponent>
        <div className={cn("py-4", isMobile && "flex-1 overflow-y-auto")}>
            <FormProvider {...methods}>
                <LogPaymentForm billInstance={billInstance} />
            </FormProvider>
        </div>
        <FooterComponent>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit(onConfirm)}>Confirm Payment</Button>
        </FooterComponent>
      </ContentComponent>
    </DialogComponent>
  );
};
