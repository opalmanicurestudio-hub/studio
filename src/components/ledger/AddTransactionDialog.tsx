'use client';
// src/components/ledger/AddTransactionDialog.tsx — ADD A LINE (the Books tab's Add a line): money in or out that didn't
// come through a checkout or the bank feed, with its date, what it was for, its category, who it was paid to or from,
// business or personal, how it was paid, and a photo of the receipt. A sheet from the bottom on a phone, a dialog on a
// computer. What's saved is the line as before, its report group stamped from the category (lib/categories bucketFor).
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { type Staff } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ImageUpload } from '../shared/ImageUpload';
import { cn } from '@/lib/utils';
import { categoriesFor, bucketFor, CUSTOM_CATEGORY } from '@/lib/categories';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const field = `h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;
const fieldStyle = { border: `1px solid ${LINE}`, color: INK };
const chip = (on: boolean) => (on ? { background: INK, color: '#fff', fontWeight: 600 } : { background: '#fff', color: INK, border: `1px solid ${LINE}` });

const transactionSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: 'Put in an amount above zero.' }).positive('Put in an amount above zero.'),
  description: z.string().trim().min(1, 'Say what it was for.'),
  category: z.string().trim().min(1, 'Pick a category.'),
  paymentMethod: z.string().min(1, 'Pick how it was paid.'),
  paymentMethodIdentifier: z.string().optional(),
  clientOrVendor: z.string().optional(),
  receiptUrl: z.string().optional(),
  date: z.date({ required_error: 'Pick the day.' }),
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

/** How it was paid: the value kept with the line, and the words shown. */
export const PAID_WITH: [string, string][] = [
  ['Business Checking', 'Business checking'], ['Business Credit Card', 'Business credit card'], ['Personal Checking', 'Personal checking'],
  ['Personal Credit Card', 'Personal credit card'], ['Cash', 'Cash'], ['Other', 'Something else'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const Field = ({ label, htmlFor, error, children, hint }: { label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="block text-[14px] font-semibold" style={{ color: INK }}>{label}{hint && <span className="font-normal" style={{ color: MUTED }}> {hint}</span>}</label>
    {children}
    {error && <p role="alert" className="text-[13px] font-medium" style={{ color: AMBER }}>{error}</p>}
  </div>
);

const AddTransactionForm = () => {
  const { control, register, watch, setValue, getValues, formState: { errors } } = useFormContext<TransactionFormData>();
  const txnType = watch('type');
  const [customCategory, setCustomCategory] = useState(false);

  // When switching money in ↔ out, clear a category that no longer belongs to the list (one typed in stays).
  useEffect(() => {
    const cur = getValues('category');
    if (cur && !customCategory && !categoriesFor(txnType).some((c) => c.name === cur)) setValue('category', '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnType]);

  return (
    <div className="space-y-5" style={{ color: INK }}>
      <Controller name="type" control={control} render={({ field: f }) => (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Money in or out">
          {([['expense', 'Money out'], ['income', 'Money in']] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={f.value === v} onClick={() => f.onChange(v)} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(f.value === v)}>{l}</button>
          ))}
        </div>
      )} />

      <Controller name="amount" control={control} render={({ field: f }) => (
        <Field label="Amount" htmlFor="amount" error={errors.amount?.message}>
          <span className="flex h-12 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}>
            <span aria-hidden style={{ color: MUTED }}>$</span>
            <input ref={f.ref} id="amount" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur}
              className="h-full w-full min-w-0 bg-transparent pl-1 text-[20px] font-semibold tabular-nums focus:outline-none" />
          </span>
        </Field>
      )} />

      <Controller name="date" control={control} render={({ field: f }) => (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day" htmlFor="date" error={errors.date?.message}>
            <input ref={f.ref} id="date" type="date" className={field} style={fieldStyle} value={f.value ? ymd(f.value) : ''}
              onChange={(e) => { if (!e.target.value) return; const [y, m, d] = e.target.value.split('-').map(Number); const n = new Date(f.value || new Date()); n.setFullYear(y, m - 1, d); f.onChange(n); }} />
          </Field>
          <Field label="Time" htmlFor="time">
            <input id="time" type="time" className={field} style={fieldStyle} value={f.value ? hm(f.value) : ''}
              onChange={(e) => { if (!e.target.value) return; const [h, mi] = e.target.value.split(':').map(Number); const n = new Date(f.value || new Date()); n.setHours(h, mi); f.onChange(n); }} />
          </Field>
        </div>
      )} />

      <Field label="What was it for?" htmlFor="description" error={errors.description?.message}>
        <input id="description" placeholder="Printer paper and ink" {...register('description')} className={field} style={fieldStyle} />
      </Field>

      <Controller name="category" control={control} render={({ field: f }) => {
        const inList = categoriesFor(txnType).some((c) => c.name === f.value);
        const value = customCategory ? CUSTOM_CATEGORY : inList ? f.value : (f.value ? CUSTOM_CATEGORY : '');
        return (
          <Field label="Category" htmlFor="category" error={errors.category?.message}>
            <select ref={f.ref} id="category" value={value} className={field} style={fieldStyle}
              onChange={(e) => { const v = e.target.value; if (v === CUSTOM_CATEGORY) { setCustomCategory(true); f.onChange(''); } else { setCustomCategory(false); f.onChange(v); } }}>
              <option value="" disabled>Pick one</option>
              {categoriesFor(txnType).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              <option value={CUSTOM_CATEGORY}>Something else, typed in</option>
            </select>
            {customCategory && <input autoFocus aria-label="Your own category" placeholder="Type the category" value={f.value} onChange={(e) => f.onChange(e.target.value)} className={`${field} mt-2`} style={fieldStyle} />}
          </Field>
        );
      }} />

      <Field label={txnType === 'income' ? 'Who it came from' : 'Who it was paid to'} hint="(if you like)" htmlFor="vendor">
        <input id="vendor" placeholder={txnType === 'income' ? 'A client or a company' : 'A store or a company'} {...register('clientOrVendor')} className={field} style={fieldStyle} />
      </Field>

      <Controller name="context" control={control} render={({ field: f }) => (
        <Field label="Whose books">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Whose books">
            {([['Business', 'The business'], ['Personal', 'Personal']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={f.value === v} onClick={() => f.onChange(v)} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={chip(f.value === v)}>{l}</button>
            ))}
          </div>
        </Field>
      )} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller name="paymentMethod" control={control} render={({ field: f }) => (
          <Field label="How it was paid" htmlFor="paid-with" error={errors.paymentMethod?.message}>
            <select ref={f.ref} id="paid-with" value={f.value} onChange={(e) => f.onChange(e.target.value)} className={field} style={fieldStyle}>
              <option value="" disabled>Pick one</option>
              {PAID_WITH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )} />
        <Field label="Which account" hint="(if you like)" htmlFor="paymentMethodIdentifier">
          <input id="paymentMethodIdentifier" placeholder="Chase ending 1234" {...register('paymentMethodIdentifier')} className={field} style={fieldStyle} />
        </Field>
      </div>

      <Field label="Receipt" hint="(if you have one)">
        <Controller name="receiptUrl" control={control} render={({ field: f }) => <ImageUpload onImageUploaded={f.onChange} label="Add a photo of the receipt" enableMarkup={false} />} />
      </Field>
    </div>
  );
};

const EMPTY = (): Partial<TransactionFormData> => ({
  description: '', category: '', paymentMethod: '', paymentMethodIdentifier: '', clientOrVendor: '', receiptUrl: '',
  date: new Date(), context: 'Business', type: 'expense', amount: undefined,
});

export const AddTransactionDialog: React.FC<AddTransactionDialogProps> = ({ open, onOpenChange, onConfirm }) => {
  const isMobile = useIsMobile();
  const methods = useForm<TransactionFormData>({ resolver: zodResolver(transactionSchema), defaultValues: EMPTY() });
  const { handleSubmit, reset } = methods;

  useEffect(() => { if (open) reset(EMPTY()); }, [open, reset]);

  const handleFormSubmit = (data: TransactionFormData) => {
    const { staffId, ...rest } = data;
    const newTransaction = {
      ...rest,
      date: data.date.toISOString(),
      hasReceipt: !!data.receiptUrl,
      staffId: staffId === 'none' ? undefined : staffId,
      // v61 — stamp the report-color bucket from the category library
      taxBucket: bucketFor(data.category, data.type),
    } as Omit<Transaction, 'id'>;
    onConfirm(newTransaction);
  };

  const Container = isMobile ? Sheet : Dialog;
  const Content = isMobile ? SheetContent : DialogContent;
  const Title = isMobile ? SheetTitle : DialogTitle;
  const Description = isMobile ? SheetDescription : DialogDescription;

  return (
    <Container open={open} onOpenChange={onOpenChange}>
      <Content side={isMobile ? 'bottom' : undefined}
        className={cn('flex flex-col overflow-hidden border-0 bg-[#fff] p-0', isMobile ? 'h-[92dvh] rounded-t-3xl' : 'max-h-[90dvh] rounded-3xl sm:max-w-xl')}>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(handleFormSubmit)} className="flex min-h-0 flex-1 flex-col" style={{ color: INK }}>
            <div className="shrink-0 px-6 pb-3 pt-6 text-left">
              <Title className="text-[22px] font-semibold leading-tight" style={{ color: INK }}>Add a line to your books</Title>
              <Description className="mt-1 text-[14px]" style={{ color: MUTED }}>Money in or out that didn’t come through a checkout or your bank feed.</Description>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
              <AddTransactionForm />
            </div>
            <div className="flex shrink-0 gap-2 px-6 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
              <button type="submit" className={btn} style={{ background: INK, color: '#fff' }}>Add it</button>
              <button type="button" onClick={() => onOpenChange(false)} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Cancel</button>
            </div>
          </form>
        </FormProvider>
      </Content>
    </Container>
  );
};
