
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
import { Calendar as CalendarIcon, DollarSign, User } from 'lucide-react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Staff } from '@/lib/data';
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
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

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
  staffId: z.string().optional(),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff[];
  onConfirm: (transaction: Omit<Transaction, 'id'>) => void;
}

const AddTransactionForm = ({ staff }: { staff: Staff[] }) => {
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
                        <Input id="amount" type="number" step="0.01" placeholder="0.00" className="pl-8" {...field} />
                    </div>
                    {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                    </div>
                )}
            />
            <Controller
                name="date"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="date">Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? format(field.value, 'PPP') : 'Pick a date'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={(date) => {
                                    if (date) {
                                        const existingDate = field.value || new Date();
                                        const newDate = new Date(date);
                                        newDate.setHours(existingDate.getHours(), existingDate.getMinutes());
                                        field.onChange(newDate);
                                    }
                                }}
                                initialFocus
                            />
                            </PopoverContent>
                        </Popover>
                         {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="time">Time</Label>
                        <Input
                            id="time"
                            type="time"
                            value={field.value ? format(field.value, 'HH:mm') : ''}
                            onChange={(e) => {
                                const [hours, minutes] = e.target.value.split(':').map(Number);
                                const newDate = field.value ? new Date(field.value) : new Date();
                                newDate.setHours(hours, minutes);
                                field.onChange(newDate);
                            }}
                        />
                    </div>
                   </div>
                )}
            />
             <Controller
                name="staffId"
                control={control}
                render={({ field }) => (
                    <div className="space-y-2">
                        <Label htmlFor="staff-select">Associated Staff (Optional)</Label>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger id="staff-select">
                                <SelectValue placeholder="Select staff member" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None / Studio Wide</SelectItem>
                                {staff.map(s => (
                                    <SelectItem key={s.id} value={s.id}>
                                        <div className="flex items-center gap-2">
                                            <Avatar className="h-5 w-5 border shadow-inner">
                                                <AvatarImage src={s.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="text-[8px]">{s.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <span>{s.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
                                <div>
                                    <RadioGroupItem value="Business" id="business-add" className="peer sr-only" />
                                    <Label htmlFor="business-add" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Business</Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="Personal" id="personal-add" className="peer sr-only" />
                                    <Label htmlFor="personal-add" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Personal</Label>
                                </div>
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
  staff,
  onConfirm,
}) => {
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
        reset({
             date: new Date(),
             context: 'Business',
             type: 'expense',
             amount: undefined,
        });
    }
  }, [open, reset]);

  const handleFormSubmit = (data: TransactionFormData) => {
    const { staffId, ...rest } = data;
    const newTransaction: Omit<Transaction, 'id'> = {
      ...rest,
      date: data.date.toISOString(),
      hasReceipt: !!data.receiptUrl,
      staffId: staffId === 'none' ? undefined : staffId,
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
                <AddTransactionForm staff={staff} />
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
