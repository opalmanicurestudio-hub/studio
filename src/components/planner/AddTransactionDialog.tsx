
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DollarSign } from 'lucide-react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Event } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { useIsMobile } from '@/hooks/use-is-mobile';

const transactionSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
  description: z.string().min(1, 'A description is required.'),
  category: z.string().min(1, 'Category is required.'),
  paymentMethod: z.string().min(1, 'Payment method is required.'),
  paymentMethodIdentifier: z.string().optional(),
  clientOrVendor: z.string().optional(),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event;
  onConfirm: (transaction: Omit<Transaction, 'id' | 'date'>) => void;
}

const AddTransactionForm = () => {
    const { control, formState: { errors } } = useFormContext<TransactionFormData>();

    return (
        <div className="grid gap-4 py-4">
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
                name="category"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger id="category">
                        <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                        <SelectItem value="Supplies">Supplies</SelectItem>
                        <SelectItem value="Travel">Travel</SelectItem>
                        <SelectItem value="Meals & Entertainment">Meals & Entertainment</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                    </Select>
                    {errors.category && <p className="text-sm text-destructive">{errors.category.message}</p>}
                    </div>
                )}
            />
            <Controller
                name="clientOrVendor"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="vendor">Vendor (Optional)</Label>
                    <Input id="vendor" placeholder="e.g., Coffee Shop, Delta Airlines" {...field} />
                    </div>
                )}
            />
            <Controller
                name="description"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                    <Label htmlFor="description">Description / Notes</Label>
                    <Textarea id="description" placeholder="e.g., Coffee with client to discuss project" {...field} />
                    {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
                    </div>
                )}
            />
        </div>
    )
}

export const AddTransactionDialog: React.FC<AddTransactionDialogProps> = ({
  open,
  onOpenChange,
  event,
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
    },
  });

  const { handleSubmit, reset } = methods;

  useEffect(() => {
    if(open) {
        reset({
            amount: 0,
            description: `Expense for: ${event.title}`,
            category: event.type === 'business' ? 'Travel' : 'Other',
            paymentMethod: '',
            paymentMethodIdentifier: '',
            clientOrVendor: '',
        });
    }
  }, [open, event.title, event.type, reset]);

  const handleFormSubmit = (data: TransactionFormData) => {
    const newTransaction: Omit<Transaction, 'id' | 'date'> = {
      description: data.description,
      clientOrVendor: data.clientOrVendor || 'N/A',
      type: 'expense' as const,
      context: event.type === 'business' ? 'Business' : 'Personal',
      category: data.category,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      paymentMethodIdentifier: data.paymentMethodIdentifier,
      hasReceipt: false,
      relatedEventId: event.id,
    };
    onConfirm(newTransaction);
    onOpenChange(false);
  };
  
  const title = "Log Expense for Event";
  const description = `Create a new transaction linked to "${event.title}".`;
  const formId = `add-transaction-form-${event.id}`;


  if (isMobile) {
      return (
        <FormProvider {...methods}>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="bottom" className="h-[90dvh] flex flex-col p-0">
                    <SheetHeader className="p-6 pb-0 text-left">
                        <SheetTitle>{title}</SheetTitle>
                        <SheetDescription>{description}</SheetDescription>
                    </SheetHeader>
                    <ScrollArea className="flex-1 px-6">
                        <form id={formId} onSubmit={handleSubmit(handleFormSubmit)}>
                            <AddTransactionForm />
                        </form>
                    </ScrollArea>
                    <SheetFooter className="p-6 pt-4 border-t bg-background">
                        <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
                        <Button type="submit" form={formId}>Log Expense</Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </FormProvider>
      )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <FormProvider {...methods}>
            <form id={formId} onSubmit={handleSubmit(handleFormSubmit)}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-6 -mr-6">
                  <AddTransactionForm />
                </ScrollArea>
                <DialogFooter className="pt-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
                    <Button type="submit" form={formId}>Log Expense</Button>
                </DialogFooter>
            </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};
