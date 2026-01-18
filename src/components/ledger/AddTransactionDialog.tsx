

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar as CalendarIcon, DollarSign } from 'lucide-react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Transaction } from '@/lib/financial-data';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { ImageUpload } from '../shared/ImageUpload';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

const transactionSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
  description: z.string().min(1, 'A description is required.'),
  category: z.string().min(1, 'Category is required.'),
  paymentMethod: z.string().min(1, 'Payment method is required.'),
  paymentMethodIdentifier: z.string().optional(),
  clientOrVendor: z.string().optional(),
  receiptUrl: z.string().optional(),
  date: z.date({ required_error: "A date is required." }),
  context: z.enum(['Business', 'Personal']),
  type: z.enum(['income', 'expense']),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (transaction: Omit<Transaction, 'id'>) => void;
}

const AddTransactionForm = () => {
    const { control, formState: { errors } } = useFormContext<TransactionFormData>();

    return (
        <ScrollArea className="h-[70vh] -mr-6 pr-6">
        <div className="grid gap-6 py-4 pl-1">
            <Controller
                name="amount"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="amount" type="number" placeholder="0.00" className="pl-8" {...field} />
                    </div>
                    {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                    </div>
                )}
            />
            <Controller
                name="date"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="date">Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant="outline"
                                className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}
                            >
                                <span className="flex items-center">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? format(field.value, 'PPP') : 'Pick a date'}
                                </span>
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
                name="description"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea id="description" placeholder="e.g., Coffee with client, new equipment purchase" {...field} />
                        {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
                    </div>
                )}
            />
            <div className="grid grid-cols-2 gap-4">
                 <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="income">Income</SelectItem>
                                    <SelectItem value="expense">Expense</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                />
                 <Controller
                    name="context"
                    control={control}
                    render={({ field }) => (
                        <div className="space-y-2">
                            <Label>Context</Label>
                            <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="grid grid-cols-2 gap-2">
                                <RadioGroupItem value="Business" id="business-add" className="peer sr-only" />
                                <Label htmlFor="business-add" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                                <RadioGroupItem value="Personal" id="personal-add" className="peer sr-only" />
                                <Label htmlFor="personal-add" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                            </RadioGroup>
                        </div>
                    )}
                 />
            </div>
             <Controller
                name="category"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" placeholder="e.g., Supplies, Travel, Service Revenue" {...field} />
                        {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
                    </div>
                )}
            />
            <Controller
                name="clientOrVendor"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="vendor">Client / Vendor (Optional)</Label>
                    <Input id="vendor" placeholder="e.g., ProSupply Co, Jane Doe" {...field} />
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
                        <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                    </Select>
                    {errors.paymentMethod && <p className="text-sm text-destructive">{errors.paymentMethod.message}</p>}
                    </div>
                )}
            />
             <Controller
                name="paymentMethodIdentifier"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="paymentMethodIdentifier">Account Identifier (Optional)</Label>
                    <Input id="paymentMethodIdentifier" placeholder="e.g., Chase ****1234" {...field} />
                    </div>
                )}
            />
             <Controller
                name="receiptUrl"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label>Receipt</Label>
                        <ImageUpload onImageUploaded={field.onChange} />
                    </div>
                )}
            />
        </div>
        </ScrollArea>
    )
}

export const AddTransactionDialog: React.FC<AddTransactionDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      amount: undefined,
      description: '',
      category: '',
      paymentMethod: '',
      paymentMethodIdentifier: '',
      clientOrVendor: '',
      receiptUrl: '',
      date: new Date(),
      context: 'Business',
      type: 'expense'
    },
  });

  const { handleSubmit, reset } = methods;

  useEffect(() => {
    if(open) {
        reset();
    }
  }, [open, reset]);

  const handleFormSubmit = (data: TransactionFormData) => {
    const newTransaction: Omit<Transaction, 'id'> = {
      ...data,
      date: data.date.toISOString(),
      hasReceipt: !!data.receiptUrl,
    };
    onConfirm(newTransaction);
  };
  
  const title = "Add New Transaction";
  const description = "Manually log an income or expense transaction.";
  const formId = `add-transaction-form`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <FormProvider {...methods}>
            <form id={formId} onSubmit={handleSubmit(handleFormSubmit)}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <AddTransactionForm />
                <DialogFooter className="pt-6 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
                    <Button type="submit" form={formId}>Log Transaction</Button>
                </DialogFooter>
            </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};
