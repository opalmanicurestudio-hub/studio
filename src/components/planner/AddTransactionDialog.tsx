
'use client';

import React from 'react';
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
import { DollarSign } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Event } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';

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

export const AddTransactionDialog: React.FC<AddTransactionDialogProps> = ({
  open,
  onOpenChange,
  event,
  onConfirm,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      amount: 0,
      description: `Expense for: ${event.title}`,
      category: event.type === 'business' ? 'Business Travel' : 'Personal Travel',
    }
  });

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
      hasReceipt: false, // Default to false, can be updated later
      relatedEventId: event.id,
    };
    onConfirm(newTransaction);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md flex flex-col">
        <DialogHeader>
          <DialogTitle>Log Expense for Event</DialogTitle>
          <DialogDescription>
            Create a new transaction linked to &quot;{event.title}&quot;.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} id="add-transaction-form" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full pr-6">
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
                        <SelectItem value={event.type === 'business' ? 'Business Other' : 'Personal Other'}>Other</SelectItem>
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
          </ScrollArea>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-transaction-form">
            Log Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
