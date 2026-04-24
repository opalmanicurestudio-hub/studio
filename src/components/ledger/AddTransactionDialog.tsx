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
import { Calendar as CalendarIcon, DollarSign, User, Sparkles, Clock, FileText, ArrowRight, Check, CreditCard, Landmark, Tag } from 'lucide-react';
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
import { Separator } from '../ui/separator';

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

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module Entry</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const AddTransactionForm = ({ staff }: { staff: Staff[] }) => {
    const { control, register, formState: { errors } } = useFormContext<TransactionFormData>();

    return (
        <div className="space-y-10">
            <div className="space-y-8">
                <SectionHeader icon={DollarSign} title="Capital Parameters" />
                <div className="space-y-6">
                    <Controller
                        name="amount"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-3">
                                <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-primary opacity-40" />
                                    <Input id="amount" type="number" step="0.01" placeholder="0.00" className="h-20 pl-14 rounded-[2rem] border-4 font-black text-5xl tracking-tighter text-primary shadow-inner bg-muted/5 focus-visible:ring-primary/20 text-center" {...field} />
                                </div>
                                {errors.amount && <p className="text-[10px] font-black text-destructive uppercase ml-1 text-center">{errors.amount.message}</p>}
                            </div>
                        )}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <Controller
                            name="date"
                            control={control}
                            render={({ field }) => (
                                <div className="space-y-2 text-left">
                                    <Label htmlFor="date" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Archive Date</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                "w-full h-14 rounded-2xl border-2 font-black text-lg justify-start px-4 shadow-sm bg-background",
                                                !field.value && "text-muted-foreground"
                                                )}
                                            >
                                                <CalendarIcon className="mr-3 h-5 w-5 text-primary opacity-40" />
                                                {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4">
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
                                </div>
                            )}
                        />
                        <div className="space-y-2 text-left">
                            <Label htmlFor="time" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Timestamp</Label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                <Controller
                                    name="date"
                                    control={control}
                                    render={({ field }) => (
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
                                            className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5"
                                        />
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <Separator className="border-dashed" />

            <div className="space-y-8">
                {/* FIX: was icon={List} — List was never imported. Changed to FileText which is imported above. */}
                <SectionHeader icon={FileText} title="Audit Detail" />
                <div className="space-y-6 text-left">
                    <div className="space-y-2">
                        <Label htmlFor="description" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Operational Description</Label>
                        <Textarea id="description" placeholder="Specify the purpose of this distribution..." {...register('description')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 font-medium" />
                        {errors.description && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.description.message}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Transaction Logic</Label>
                            <Controller name="type" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="income" className="font-bold">INCOME YIELD</SelectItem>
                                        <SelectItem value="expense" className="font-bold">EXPENSE LOAD</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}/>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Financial Context</Label>
                            <Controller name="context" control={control} render={({ field }) => (
                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                    <label htmlFor="bus-add-txn" className="cursor-pointer">
                                        <div className={cn("flex items-center justify-center p-3 rounded-xl border-2 transition-all", field.value === 'Business' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                            <span className="text-[10px] font-black uppercase tracking-widest">Business</span>
                                            <RadioGroupItem value="Business" id="bus-add-txn" className="sr-only" />
                                        </div>
                                    </label>
                                    <label htmlFor="per-add-txn" className="cursor-pointer">
                                        <div className={cn("p-3 rounded-xl border-2 text-center transition-all", field.value === 'Personal' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-background")}>
                                            <span className="text-[10px] font-black uppercase tracking-widest">Personal</span>
                                            <RadioGroupItem value="Personal" id="per-add-txn" className="sr-only" />
                                        </div>
                                    </label>
                                </RadioGroup>
                            )}/>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="category" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Classification Category</Label>
                        <div className="relative">
                            <Tag className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input id="category" placeholder="e.g., Supplies, Travel, Revenue" {...register('category')} className="h-12 pl-10 rounded-xl border-2 font-black uppercase text-xs" />
                        </div>
                        {errors.category && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.category.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="vendor" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Counterparty (Optional)</Label>
                        <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input id="vendor" placeholder="Counterparty name..." {...register('clientOrVendor')} className="h-12 pl-10 rounded-xl border-2 font-bold uppercase text-xs" />
                        </div>
                    </div>
                </div>
            </div>

            <Separator className="border-dashed" />

            <div className="space-y-8">
                <SectionHeader icon={CreditCard} title="Settlement Protocol" />
                <div className="space-y-6 text-left">
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Source</Label>
                        <Controller name="paymentMethod" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5"><SelectValue placeholder="SELECT ACCOUNT" /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    <SelectItem value="Business Checking" className="font-bold">BUSINESS CHECKING</SelectItem>
                                    <SelectItem value="Business Credit Card" className="font-bold">BUSINESS CREDIT CARD</SelectItem>
                                    <SelectItem value="Personal Checking" className="font-bold">PERSONAL CHECKING</SelectItem>
                                    <SelectItem value="Personal Credit Card" className="font-bold">PERSONAL CREDIT CARD</SelectItem>
                                    <SelectItem value="Cash" className="font-bold">CASH TENDER</SelectItem>
                                    <SelectItem value="Other" className="font-bold">OTHER PROTOCOL</SelectItem>
                                </SelectContent>
                            </Select>
                        )}/>
                        {errors.paymentMethod && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.paymentMethod.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="paymentMethodIdentifier" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Account Identifier</Label>
                        <Input id="paymentMethodIdentifier" placeholder="e.g., Chase ****1234" {...register('paymentMethodIdentifier')} className="h-12 rounded-xl border-2 font-mono font-black text-xs uppercase" />
                    </div>
                    
                    <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Proof of Transaction</Label>
                        </div>
                        <Controller name="receiptUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const AddTransactionDialog: React.FC<AddTransactionDialogProps> = ({
  open,
  onOpenChange,
  staff,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
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
    if (open) {
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
  
  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-2xl max-h-[90dvh]")}>
        <FormProvider {...methods}>
            <form id="add-transaction-strategic-form" onSubmit={handleSubmit(handleFormSubmit)} className="flex flex-col h-full overflow-hidden">
                <div className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-8 pb-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Accounting Suite</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Add New Transaction</DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Manually log an income or expense into the studio ledger.</DialogDescription>
                </div>
                
                <ScrollArea className="flex-1">
                    <div className="p-8 pb-32">
                        <AddTransactionForm staff={staff} />
                    </div>
                </ScrollArea>

                <div className="border-t bg-background flex-shrink-0 shadow-2xl p-6 sm:p-8">
                    <div className="flex w-full gap-4">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-14 font-black uppercase tracking-widest text-[11px] text-slate-500">Cancel</Button>
                        <Button type="submit" className="flex-[2.5] h-12 md:h-14 rounded-[2rem] font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Log Transaction <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                    </div>
                </div>
            </form>
        </FormProvider>
      </ContentComponent>
    </DialogContainer>
  );
};