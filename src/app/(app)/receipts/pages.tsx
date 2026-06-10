'use client';

import { useState, useMemo } from 'react';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Receipt as ReceiptIcon,
  Plus,
  Download,
  Printer,
  FileText,
  AlertCircle,
  CalendarDays,
  CircleDollarSign,
} from 'lucide-react';
import {
  Booth,
  Renter,
  Lease,
  Receipt,
  BOOTH_RENTAL_COLLECTIONS,
  FREQUENCY_LABELS,
  formatCents,
  toIsoDate,
  generateReceiptNumber,
} from '@/lib/booth-rental-types';

// ─── Receipt printer (opens a print-friendly window) ─────────────────────────

function printReceipt(receipt: Receipt, renter: Renter, booth: Booth, studioName: string) {
  const lines = receipt.lineItems
    .map(
      (li) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">${li.description}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">
          ${formatCents(li.amountCents)}
        </td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt ${receipt.receiptNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;color:#111;padding:48px;max-width:600px;margin:auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
    .studio{font-size:20px;font-weight:700}
    .receipt-no{font-size:13px;color:#666;margin-top:4px}
    .issued{font-size:13px;color:#666}
    .section{margin-bottom:28px}
    .section-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px}
    .name{font-size:15px;font-weight:600}
    .sub{font-size:13px;color:#555;margin-top:3px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    .total-row td{padding-top:12px;font-weight:700;font-size:16px}
    .footer{margin-top:40px;font-size:12px;color:#888;text-align:center;border-top:1px solid #eee;padding-top:16px}
    .tax-note{margin-top:28px;padding:16px;background:#f8f8f6;border-radius:8px;font-size:13px;color:#444;line-height:1.5}
    @media print{body{padding:32px}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="studio">${studioName}</div>
      <div class="receipt-no">Receipt ${receipt.receiptNumber}</div>
    </div>
    <div class="issued">Issued: ${receipt.issuedAt.slice(0, 10)}</div>
  </div>

  <div class="section">
    <div class="section-label">Billed to</div>
    <div class="name">${renter.firstName} ${renter.lastName}</div>
    ${renter.businessName ? `<div class="sub">${renter.businessName}</div>` : ''}
    <div class="sub">${renter.email}</div>
  </div>

  <div class="section">
    <div class="section-label">Space</div>
    <div class="name">${booth.name}</div>
    <div class="sub">Period: ${receipt.periodStart} → ${receipt.periodEnd}</div>
  </div>

  <div class="section">
    <div class="section-label">Charges</div>
    <table>
      ${lines}
      <tr class="total-row">
        <td>Total</td>
        <td style="text-align:right">${formatCents(receipt.totalCents)}</td>
      </tr>
    </table>
  </div>

  <div class="tax-note">
    <strong>Tax deduction note:</strong> This receipt documents rent paid for
    business use of commercial space. It may be used as supporting documentation
    when claiming a business-expense deduction on your tax return. Keep this
    receipt for your records. Consult a qualified tax professional for advice
    specific to your situation.
  </div>

  <div class="footer">
    This is an official rent receipt issued by ${studioName}.
  </div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
}

// ─── Period options ───────────────────────────────────────────────────────────

function buildPeriodOptions() {
  const opts: { label: string; start: string; end: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    opts.push({
      label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
      start,
      end,
    });
  }
  return opts;
}

const PERIOD_OPTIONS = buildPeriodOptions();

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReceiptsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const studioName = selectedTenant?.name ?? 'Your Studio';

  const rentersRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId)) : null,
    [firestore, tenantId]
  );
  const boothsRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId)) : null,
    [firestore, tenantId]
  );
  const leasesRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId)) : null,
    [firestore, tenantId]
  );
  const receiptsRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId)) : null,
    [firestore, tenantId]
  );

  const { data: renters } = useCollection<Renter>(rentersRef);
  const { data: booths } = useCollection<Booth>(boothsRef);
  const { data: leases } = useCollection<Lease>(leasesRef);
  const { data: receipts, isLoading } = useCollection<Receipt>(receiptsRef);

  // Generate dialog state
  const [genOpen, setGenOpen] = useState(false);
  const [genRenterId, setGenRenterId] = useState('');
  const [genPeriodIdx, setGenPeriodIdx] = useState(0);
  const [genCustomItems, setGenCustomItems] = useState<{ description: string; amountCents: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const renterById = useMemo(() => {
    const m = new Map<string, Renter>();
    (renters ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [renters]);

  const boothById = useMemo(() => {
    const m = new Map<string, Booth>();
    (booths ?? []).forEach((b) => m.set(b.id, b));
    return m;
  }, [booths]);

  const activeLeaseByRenter = useMemo(() => {
    const m = new Map<string, Lease>();
    (leases ?? []).forEach((l) => {
      if (l.status === 'active' || l.status === 'on_leave') m.set(l.renterId, l);
    });
    return m;
  }, [leases]);

  const sortedReceipts = useMemo(
    () => [...(receipts ?? [])].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    [receipts]
  );

  const openGenDialog = () => {
    setGenRenterId('');
    setGenPeriodIdx(0);
    setGenCustomItems([]);
    setGenError(null);
    setGenOpen(true);
  };

  const genLease = genRenterId ? activeLeaseByRenter.get(genRenterId) : undefined;
  const genBooth = genLease ? boothById.get(genLease.boothId) : undefined;
  const period = PERIOD_OPTIONS[genPeriodIdx];

  const handleGenerate = async () => {
    if (!genRenterId || !genLease || !genBooth || !tenantId) return;
    setGenerating(true);
    setGenError(null);
    try {
      // Get receipt count for numbering
      const snap = await getDocs(
        query(
          collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId)),
          orderBy('createdAt', 'desc'),
          limit(1)
        )
      );
      const nextIndex = (receipts?.length ?? 0) + 1;
      const receiptNumber = generateReceiptNumber(nextIndex);

      // Build line items
      const lineItems = [
        {
          description: `Booth rent — ${genBooth.name} (${period.label})`,
          amountCents: genLease.rentAmountCents,
        },
        ...genCustomItems
          .filter((ci) => ci.description.trim() && parseFloat(ci.amountCents) > 0)
          .map((ci) => ({
            description: ci.description.trim(),
            amountCents: Math.round(parseFloat(ci.amountCents) * 100),
          })),
      ];

      if (genLease.perks?.length > 0) {
        genLease.perks
          .filter((p) => p.appliedAt && period.start <= p.appliedAt && p.appliedAt <= period.end)
          .forEach((p) => {
            lineItems.push({
              description: `Perk: ${p.label}`,
              amountCents: -(p.valueCents ?? 0),
            });
          });
      }

      const totalCents = lineItems.reduce((s, li) => s + li.amountCents, 0);
      const now = new Date().toISOString();

      const receiptDoc: Omit<Receipt, 'id'> = {
        receiptNumber,
        leaseId: genLease.id,
        renterId: genRenterId,
        boothId: genBooth.id,
        ledgerEntryIds: [],
        lineItems,
        totalCents,
        periodStart: period.start,
        periodEnd: period.end,
        issuedAt: now,
        pdfUrl: null,
        createdAt: now,
      };

      await addDoc(
        collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId)),
        receiptDoc
      );

      setGenOpen(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate receipt.');
    } finally {
      setGenerating(false);
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
            <ReceiptIcon className="h-6 w-6" />
            Receipts
          </h1>
          <p className="text-sm text-muted-foreground">
            Rent receipts your renters can use as business expense documentation.
          </p>
        </div>
        <Button onClick={openGenDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Generate receipt
        </Button>
      </div>

      {/* Empty state */}
      {!isLoading && sortedReceipts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <ReceiptIcon className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No receipts yet</p>
            <p className="text-sm text-muted-foreground">
              Generate a receipt for any active renter. They can print or save it
              as proof of a deductible business expense.
            </p>
            <Button onClick={openGenDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Generate first receipt
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Receipt list */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sortedReceipts.map((receipt) => {
          const renter = renterById.get(receipt.renterId);
          const booth = boothById.get(receipt.boothId);
          return (
            <Card key={receipt.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      {receipt.receiptNumber}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {receipt.issuedAt.slice(0, 10)}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {formatCents(receipt.totalCents)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    {renter
                      ? `${renter.firstName} ${renter.lastName}`
                      : 'Unknown renter'}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CircleDollarSign className="h-3.5 w-3.5" />
                    {booth?.name ?? 'Unknown booth'}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {receipt.periodStart} → {receipt.periodEnd}
                  </div>
                </div>

                <div className="pt-1 space-y-0.5">
                  {receipt.lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between text-xs text-muted-foreground">
                      <span className="truncate mr-2">{li.description}</span>
                      <span className="shrink-0">{formatCents(li.amountCents)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (renter && booth) printReceipt(receipt, renter, booth, studioName);
                    }}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1.5" />
                    Print / Save PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={(open) => { if (!open) setGenError(null); setGenOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate receipt</DialogTitle>
            <DialogDescription>
              Creates an official rent receipt the renter can use as a business
              expense record for tax purposes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Renter</Label>
              <Select value={genRenterId} onValueChange={setGenRenterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a renter" />
                </SelectTrigger>
                <SelectContent>
                  {(renters ?? [])
                    .filter((r) => activeLeaseByRenter.has(r.id))
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.firstName} {r.lastName}
                        {r.businessName ? ` — ${r.businessName}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Billing period</Label>
              <Select
                value={String(genPeriodIdx)}
                onValueChange={(v) => setGenPeriodIdx(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((opt, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Lease summary */}
            {genLease && genBooth && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-medium">{genBooth.name}</p>
                <p className="text-muted-foreground">
                  {formatCents(genLease.rentAmountCents)} /{' '}
                  {FREQUENCY_LABELS[genLease.frequency].toLowerCase()}
                </p>
              </div>
            )}

            {/* Extra line items */}
            <div className="space-y-2">
              <Label>Additional charges or credits (optional)</Label>
              {genCustomItems.map((ci, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Description"
                    value={ci.description}
                    onChange={(e) =>
                      setGenCustomItems((prev) =>
                        prev.map((p, j) => j === i ? { ...p, description: e.target.value } : p)
                      )
                    }
                    className="flex-1"
                  />
                  <Input
                    placeholder="$ amount"
                    type="number"
                    value={ci.amountCents}
                    onChange={(e) =>
                      setGenCustomItems((prev) =>
                        prev.map((p, j) => j === i ? { ...p, amountCents: e.target.value } : p)
                      )
                    }
                    className="w-28"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setGenCustomItems((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setGenCustomItems((prev) => [...prev, { description: '', amountCents: '' }])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add line item
              </Button>
            </div>

            {genError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {genError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generating || !genRenterId || !genLease}
            >
              {generating ? 'Generating…' : 'Generate receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
