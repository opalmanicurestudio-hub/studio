'use client';

/**
 * ExpensesPage — v1  (src/app/(app)/expenses/page.tsx)
 *
 * The missing half of the tax story: income has been flowing into the
 * ledger automatically (POS, booth rent, day rentals) — expenses had no
 * capture surface, and the nav link 404'd. This page is a fast expense
 * logger writing the CANONICAL Transaction shape (amount in dollars,
 * type 'expense', context 'Business') into tenants/{tid}/transactions,
 * so everything lands in the same Ledger and P&L views.
 *
 * ASSUMPTION (flagged): taxBucket for expenses maps 'Supplies & product'
 * → 'cogs', everything else → 'operating'. If your Ledger's P&L buckets
 * differ, adjust EXPENSE_CATEGORIES below.
 */
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import { collection, doc, onSnapshot, query, where, setDoc, deleteDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Plus, Trash2 } from 'lucide-react';

// VERIFIED against the real Ledger page: the P&L computes COGS by CATEGORY
// STRING match (categories containing 'supplies', 'spoilage', 'cost of
// goods', or 'comp' → COGS; everything else except 'Processing Fee' →
// operating expenses). taxBucket is used for row styling only, and the
// Ledger's vocabulary for expense styling is 'operating_cost'.
const EXPENSE_CATEGORIES: { label: string; taxBucket: string }[] = [
  { label: 'Supplies & product',   taxBucket: 'operating_cost' }, // 'supplies' → COGS in P&L
  { label: 'Cost of Goods Sold',   taxBucket: 'operating_cost' }, // explicit COGS
  { label: 'Rent & utilities',     taxBucket: 'operating_cost' },
  { label: 'Equipment',            taxBucket: 'operating_cost' },
  { label: 'Software & subscriptions', taxBucket: 'operating_cost' },
  { label: 'Marketing',            taxBucket: 'operating_cost' },
  { label: 'Insurance',            taxBucket: 'operating_cost' },
  { label: 'Education & training', taxBucket: 'operating_cost' },
  { label: 'Fees & licenses',      taxBucket: 'operating_cost' },
  { label: 'Travel',               taxBucket: 'operating_cost' },
  { label: 'Other',                taxBucket: 'operating_cost' },
];

const PAYMENT_METHODS = ['Card', 'Cash', 'Bank transfer', 'Check', 'Other'];

export default function ExpensesPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [expenses, setExpenses] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    amount: '', category: EXPENSE_CATEGORIES[0].label, description: '',
    vendor: '', date: new Date().toISOString().slice(0, 10), method: 'Card',
  });

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      query(collection(firestore, 'tenants', tenantId, 'transactions'), where('type', '==', 'expense')),
      (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setExpenses([]));
    return () => unsub();
  }, [firestore, tenantId]);

  const sorted = useMemo(() =>
    [...(expenses || [])].sort((a, b) => ((b.date || b.createdAt || '') + '').localeCompare((a.date || a.createdAt || '') + '')),
    [expenses]);

  const monthTotal = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return sorted.filter(t => ((t.date || '') + '').startsWith(ym))
      .reduce((s, t) => s + (typeof t.amount === 'number' ? t.amount : 0), 0);
  }, [sorted]);

  const canSave = parseFloat(form.amount) > 0 && form.description.trim() && !saving;

  const save = async () => {
    if (!canSave || !firestore || !tenantId) return;
    setSaving(true);
    try {
      const cat = EXPENSE_CATEGORIES.find(c => c.label === form.category) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
      const ref = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
      const nowIso = new Date().toISOString();
      await setDoc(ref, {
        id: ref.id,
        type: 'expense',
        context: 'Business',
        taxBucket: cat.taxBucket,
        amount: Math.round(parseFloat(form.amount) * 100) / 100,
        category: form.category,
        description: form.description.trim(),
        clientOrVendor: form.vendor.trim() || 'Vendor',
        date: `${form.date}T12:00:00.000Z`,
        paymentMethod: form.method,
        hasReceipt: false,
        tenantId,
        createdAt: nowIso,
      });
      setForm(f => ({ ...f, amount: '', description: '', vendor: '' }));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!firestore || !tenantId) return;
    await deleteDoc(doc(firestore, 'tenants', tenantId, 'transactions', id)).catch(() => {});
  };

  if (!tenantId) return <div className="p-8 text-sm text-muted-foreground">Loading your studio…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b px-4 sm:px-6 md:px-8 pt-5 pb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
            <Receipt className="h-5 w-5 text-slate-500" /> Expenses
          </h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
            Business spending · flows into the Ledger and P&L
          </p>
        </div>
        <div className="rounded-xl border bg-white px-3.5 py-2 text-right">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">This month</p>
          <p className="text-lg font-black tracking-tighter text-red-600">${monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      <div className="px-4 sm:px-6 md:px-8 py-5 space-y-5 max-w-3xl">
        {/* Quick add */}
        <div className="rounded-2xl border-2 bg-white p-4 space-y-3">
          <p className="text-xs font-black uppercase tracking-widest">Log an expense</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount ($)</Label>
              <Input type="number" inputMode="decimal" placeholder="0.00" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>What was it?</Label>
            <Input placeholder="Gel polish restock, booth fan, Canva subscription…" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vendor</Label>
              <Input placeholder="Who was paid" value={form.vendor}
                onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Paid with</Label>
              <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button className="w-full" onClick={save} disabled={!canSave}>
            <Plus className="h-4 w-4 mr-1.5" />
            {saving ? 'Saving…' : 'Log expense'}
          </Button>
        </div>

        {/* List */}
        {expenses === null ? (
          <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No expenses logged yet.</p>
        ) : (
          <div className="space-y-2">
            {sorted.slice(0, 100).map(t => (
              <div key={t.id} className="rounded-xl border-2 bg-white px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black truncate">{t.description || t.category}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">
                    {((t.date || t.createdAt || '') + '').slice(0, 10)} · {t.category}{t.clientOrVendor && t.clientOrVendor !== 'Vendor' ? ` · ${t.clientOrVendor}` : ''}{t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                  </p>
                </div>
                <p className="font-black text-red-600 shrink-0">−${(typeof t.amount === 'number' ? t.amount : 0).toFixed(2)}</p>
                <button onClick={() => remove(t.id)} className="h-8 w-8 rounded-lg border flex items-center justify-center text-slate-400 hover:text-red-600 shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
