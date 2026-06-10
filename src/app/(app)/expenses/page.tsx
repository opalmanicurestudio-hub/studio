'use client';

import { useState, useMemo } from 'react';
import { collection, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Wallet,
  Plus,
  Pencil,
  Trash2,
  Upload,
  ExternalLink,
  AlertCircle,
  TrendingDown,
  Receipt,
  Tag,
} from 'lucide-react';
import {
  Booth,
  Expense,
  ExpenseCategory,
  BOOTH_RENTAL_COLLECTIONS,
  EXPENSE_CATEGORY_LABELS,
  formatCents,
  toIsoDate,
} from '@/lib/booth-rental-types';

// ─── Category colour chips ────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  rent_income:      'bg-emerald-100 text-emerald-800',
  maintenance:      'bg-orange-100 text-orange-800',
  supplies:         'bg-sky-100 text-sky-800',
  utilities:        'bg-violet-100 text-violet-800',
  insurance:        'bg-rose-100 text-rose-800',
  marketing:        'bg-pink-100 text-pink-800',
  equipment:        'bg-amber-100 text-amber-800',
  professional_fees:'bg-teal-100 text-teal-800',
  other:            'bg-slate-100 text-slate-700',
};

// ─── Year options ─────────────────────────────────────────────────────────────

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];

// ─── Form state ───────────────────────────────────────────────────────────────

interface ExpenseFormState {
  category: ExpenseCategory;
  description: string;
  amountDollars: string;
  date: string;
  boothId: string;
  notes: string;
  receiptFile: File | null;
}

function emptyForm(): ExpenseFormState {
  return {
    category: 'maintenance',
    description: '',
    amountDollars: '',
    date: toIsoDate(new Date()),
    boothId: '',
    notes: '',
    receiptFile: null,
  };
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  amount,
  count,
  colorClass,
}: {
  label: string;
  amount: number;
  count: number;
  colorClass: string;
}) {
  return (
    <div className="bg-background border border-border/40 rounded-xl p-4 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
          {label}
        </span>
        <span className="text-xs text-muted-foreground">{count} item{count !== 1 ? 's' : ''}</span>
      </div>
      <p className="text-lg font-semibold">{formatCents(amount)}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { firebaseApp, firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const storage = useMemo(() => getStorage(firebaseApp), [firebaseApp]);

  const expensesRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.expenses(tenantId)) : null,
    [firestore, tenantId]
  );
  const boothsRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId)) : null,
    [firestore, tenantId]
  );

  const { data: expenses, isLoading } = useCollection<Expense>(expensesRef);
  const { data: booths } = useCollection<Booth>(boothsRef);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [filterYear, setFilterYear] = useState(THIS_YEAR);
  const [filterCategory, setFilterCategory] = useState<ExpenseCategory | 'all'>('all');

  const boothById = useMemo(() => {
    const m = new Map<string, Booth>();
    (booths ?? []).forEach((b) => m.set(b.id, b));
    return m;
  }, [booths]);

  // Filter + sort
  const filtered = useMemo(() => {
    return [...(expenses ?? [])]
      .filter((e) => {
        const year = parseInt(e.date.slice(0, 4));
        if (year !== filterYear) return false;
        if (filterCategory !== 'all' && e.category !== filterCategory) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, filterYear, filterCategory]);

  // Category totals for summary
  const summaryByCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, { amount: number; count: number }>();
    filtered.forEach((e) => {
      const existing = map.get(e.category) ?? { amount: 0, count: 0 };
      map.set(e.category, {
        amount: existing.amount + e.amountCents,
        count: existing.count + 1,
      });
    });
    return map;
  }, [filtered]);

  const totalCents = useMemo(
    () => filtered.reduce((s, e) => s + e.amountCents, 0),
    [filtered]
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setForm({
      category: expense.category,
      description: expense.description,
      amountDollars: (expense.amountCents / 100).toString(),
      date: expense.date,
      boothId: expense.boothId ?? '',
      notes: expense.notes,
      receiptFile: null,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setEditingId(null);
      setFormError(null);
    }
    setDialogOpen(open);
  };

  const handleSave = async () => {
    if (!form.description.trim() || !form.amountDollars || !tenantId) return;
    setSaving(true);
    setFormError(null);
    const now = new Date().toISOString();
    try {
      let receiptUrl: string | null = null;
      if (form.receiptFile) {
        const path = `tenants/${tenantId}/expenses/${Date.now()}-${form.receiptFile.name}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, form.receiptFile);
        receiptUrl = await getDownloadURL(fileRef);
      }

      const payload = {
        category: form.category,
        description: form.description.trim(),
        amountCents: Math.round(parseFloat(form.amountDollars) * 100),
        date: form.date,
        boothId: form.boothId || null,
        notes: form.notes.trim(),
        updatedAt: now,
        ...(receiptUrl ? { receiptUrl } : {}),
      };

      if (editingId) {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.expenses(tenantId), editingId),
          payload
        );
      } else {
        await addDoc(
          collection(firestore, BOOTH_RENTAL_COLLECTIONS.expenses(tenantId)),
          { ...payload, receiptUrl: receiptUrl ?? null, createdAt: now }
        );
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save expense.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !tenantId) return;
    try {
      await deleteDoc(
        doc(firestore, BOOTH_RENTAL_COLLECTIONS.expenses(tenantId), deleteTarget.id)
      );
    } finally {
      setDeleteTarget(null);
    }
  };

  if (!tenantId) {
    return <div className="p-8 text-sm text-muted-foreground">Loading your studio…</div>;
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Wallet className="h-6 w-6" />
            Expenses
          </h1>
          <p className="text-sm text-muted-foreground">
            Track studio operating costs for tax write-offs and profit analysis.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Log expense
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select
          value={String(filterYear)}
          onValueChange={(v) => setFilterYear(Number(v))}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterCategory}
          onValueChange={(v) => setFilterCategory(v as ExpenseCategory | 'all')}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
              <SelectItem key={cat} value={cat}>
                {EXPENSE_CATEGORY_LABELS[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered.length > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} expenses · <span className="font-semibold text-foreground">{formatCents(totalCents)}</span> total
          </span>
        )}
      </div>

      {/* Category summary strip */}
      {summaryByCategory.size > 0 && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {[...summaryByCategory.entries()].map(([cat, { amount, count }]) => (
            <SummaryCard
              key={cat}
              label={EXPENSE_CATEGORY_LABELS[cat]}
              amount={amount}
              count={count}
              colorClass={CATEGORY_COLORS[cat]}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <TrendingDown className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No expenses logged for {filterYear}</p>
            <p className="text-sm text-muted-foreground">
              Track maintenance, supplies, utilities, and other studio costs here.
              These records support your tax write-offs.
            </p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Log first expense
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Expense list */}
      <div className="space-y-2">
        {filtered.map((expense) => {
          const booth = expense.boothId ? boothById.get(expense.boothId) : undefined;
          return (
            <div
              key={expense.id}
              className="flex items-start gap-3 rounded-xl border border-border/50 bg-background p-4 hover:border-border transition-colors"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{expense.description}</span>
                  <Badge className={`text-[10px] ${CATEGORY_COLORS[expense.category]}`}>
                    {EXPENSE_CATEGORY_LABELS[expense.category]}
                  </Badge>
                  {booth && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      {booth.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{expense.date}</span>
                  {expense.notes && <span className="truncate">{expense.notes}</span>}
                  {expense.receiptUrl && (
                    
                      href={expense.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      <Receipt className="h-3 w-3" />
                      Receipt
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 space-y-2">
                <p className="text-sm font-semibold">{formatCents(expense.amountCents)}</p>
                <div className="flex gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => openEdit(expense)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(expense)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tax note */}
      {filtered.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Tax write-off summary — {filterYear}</p>
          <p>
            Total logged expenses: <strong>{formatCents(totalCents)}</strong>. These records
            support deductions for ordinary and necessary business expenses. Consult a qualified
            tax professional to confirm eligibility for your specific situation.
          </p>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit expense' : 'Log expense'}</DialogTitle>
            <DialogDescription>
              Receipts and detailed records make write-offs defensible at tax time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label htmlFor="e-desc">Description</Label>
                <Input
                  id="e-desc"
                  placeholder="e.g. Replace shampoo bowl, monthly Wi-Fi bill…"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((p) => ({ ...p, category: v as ExpenseCategory }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {EXPENSE_CATEGORY_LABELS[cat]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="e-amount">Amount ($)</Label>
                <Input
                  id="e-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={form.amountDollars}
                  onChange={(e) => setForm((p) => ({ ...p, amountDollars: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="e-date">Date</Label>
                <Input
                  id="e-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label>Booth (optional)</Label>
                <Select
                  value={form.boothId || 'none'}
                  onValueChange={(v) => setForm((p) => ({ ...p, boothId: v === 'none' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Not booth-specific" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not booth-specific</SelectItem>
                    {(booths ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="e-notes">Notes</Label>
              <Textarea
                id="e-notes"
                placeholder="Vendor, purpose, or anything useful at tax time…"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="e-receipt">Upload receipt (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="e-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) =>
                    setForm((p) => ({ ...p, receiptFile: e.target.files?.[0] ?? null }))
                  }
                />
                <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogClose(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.description.trim() || !form.amountDollars}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Log expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.description}" ({deleteTarget ? formatCents(deleteTarget.amountCents) : ''})
              will be permanently removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}