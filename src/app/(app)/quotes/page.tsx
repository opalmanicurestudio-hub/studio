'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  useFirebase, useCollection, useMemoFirebase,
  addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking,
} from '@/firebase';
import { collection, doc, getDocs, addDoc, updateDoc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { format, parseISO, formatDistanceToNow, addDays, isPast } from 'date-fns';
import {
  PlusCircle, Search, FileText, Copy, Trash2, Send,
  CheckCircle2, XCircle, Clock, DollarSign, Calendar,
  MoreHorizontal, Loader, LinkIcon, ExternalLink,
  RefreshCw, Eye, Flag, Phone, Mail, ArrowRight,
  CreditCard, TrendingUp, BookOpen, Zap, ChevronDown,
  ChevronUp, Check, X, CalendarCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { InquiriesTab } from '@/components/quotes/InquiriesTab';

const formatCurrency = (n: number) => `$${(n || 0).toFixed(2)}`;

// ─── Quote templates ───────────────────────────────────────────────────────────
const QUOTE_TEMPLATES = [
  {
    id: 't1', name: 'Studio Nail Event', description: 'Standard in-studio nail art event',
    lineItems: [
      { name: 'Nail Artist (per hour)', quantity: 3, price: 150 },
      { name: 'Product & Setup', quantity: 1, price: 120 },
    ],
    projectFee: 15, travelExpenses: 0,
  },
  {
    id: 't2', name: 'Bridal Party', description: 'Bride + bridal party full package',
    lineItems: [
      { name: 'Bridal Manicure & Pedicure', quantity: 1, price: 200 },
      { name: 'Bridesmaid Manicure', quantity: 4, price: 85 },
      { name: 'Nail Art Add-on', quantity: 5, price: 40 },
    ],
    projectFee: 20, travelExpenses: 0,
  },
  {
    id: 't3', name: 'Corporate Wellness', description: 'On-site corporate event with multiple artists',
    lineItems: [
      { name: 'Artist Staffing (per artist)', quantity: 2, price: 400 },
      { name: 'Travel & Setup', quantity: 1, price: 150 },
      { name: 'Supplies (per guest)', quantity: 20, price: 25 },
    ],
    projectFee: 10, travelExpenses: 100,
  },
  {
    id: 't4', name: 'Private Party', description: 'Private home or venue nail party',
    lineItems: [
      { name: 'Nail Artist', quantity: 1, price: 350 },
      { name: 'Travel Fee', quantity: 1, price: 75 },
      { name: 'Supplies', quantity: 10, price: 30 },
    ],
    projectFee: 15, travelExpenses: 75,
  },
];

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  draft:              { label: 'Draft',          color: 'bg-slate-100 border-slate-200 text-slate-600',  dot: 'bg-slate-400' },
  sent:               { label: 'Sent',            color: 'bg-blue-50 border-blue-100 text-blue-700',      dot: 'bg-blue-400' },
  viewed:             { label: 'Viewed',          color: 'bg-violet-50 border-violet-100 text-violet-700',dot: 'bg-violet-500 animate-pulse' },
  accepted:           { label: 'Accepted',        color: 'bg-green-50 border-green-100 text-green-700',   dot: 'bg-green-500' },
  declined:           { label: 'Declined',        color: 'bg-red-50 border-red-100 text-red-700',         dot: 'bg-red-400' },
  expired:            { label: 'Expired',         color: 'bg-amber-50 border-amber-100 text-amber-700',   dot: 'bg-amber-400' },
  revision_requested: { label: 'Revision Req.',   color: 'bg-orange-50 border-orange-100 text-orange-700',dot: 'bg-orange-400 animate-pulse' },
};

const calcTotal = (quote: any) => {
  const sub = quote.lineItems?.reduce((a: number, i: any) => a + ((i.price || 0) * (i.quantity || 1)), 0) || 0;
  const fee = sub * ((quote.projectFee || 0) / 100);
  return sub + (quote.travelExpenses || 0) + fee;
};

// Returns expiry info for a live quote, or null if not applicable
const getExpiryInfo = (quote: any) => {
  if (!['sent', 'viewed'].includes(quote.status)) return null;
  if (!quote.sentAt || !quote.expiresInDays) return null;
  const expiryDate = addDays(new Date(quote.sentAt), quote.expiresInDays);
  const msLeft = expiryDate.getTime() - Date.now();
  if (msLeft <= 0) return null; // will be auto-expired
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  if (daysLeft > 7) return null;
  return {
    daysLeft,
    label: daysLeft <= 0 ? 'Expires today' : daysLeft === 1 ? 'Expires tomorrow' : `${daysLeft}d left`,
    urgent: daysLeft <= 1,
  };
};

// ─── Expiry Countdown Chip ─────────────────────────────────────────────────────
const ExpiryChip = ({ quote }: { quote: any }) => {
  const info = getExpiryInfo(quote);
  if (!info) return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
      info.urgent
        ? 'bg-red-50 border-red-200 text-red-600 animate-pulse'
        : 'bg-amber-50 border-amber-200 text-amber-600',
    )}>
      <Clock className="w-2.5 h-2.5" /> {info.label}
    </span>
  );
};

// ─── Quote Card ────────────────────────────────────────────────────────────────
const QuoteCard = ({
  quote, clients, tenantId,
  onCopyLink, onDelete, onDuplicate, onSend, onOpen, onMarkFollowUp, onConvert,
}: {
  quote: any; clients: any[]; tenantId: string;
  onCopyLink: (q: any) => void; onDelete: (q: any) => void;
  onDuplicate: (q: any) => void; onSend: (q: any) => void;
  onOpen: (q: any) => void; onMarkFollowUp: (q: any) => void;
  onConvert: (q: any) => void;
}) => {
  const client        = clients.find(c => c.id === quote.clientId);
  const status        = STATUS_CONFIG[quote.status || 'draft'] || STATUS_CONFIG.draft;
  const total         = calcTotal(quote);
  const needsFollowUp = quote.needsFollowUp && quote.status === 'declined';
  const hasRevision   = quote.status === 'revision_requested';
  const isConverted   = !!quote.convertedToEventId;
  const expiryInfo    = getExpiryInfo(quote);

  return (
    <Card
      className={cn(
        'border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white hover:shadow-md transition-all cursor-pointer group',
        hasRevision && 'border-orange-200 ring-2 ring-orange-100',
        needsFollowUp && 'border-red-100',
        expiryInfo?.urgent && 'border-red-200',
        isConverted && 'border-green-100',
      )}
      onClick={() => onOpen(quote)}
    >
      <CardContent className="p-5 space-y-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">
                {quote.eventName || 'Untitled'}
              </p>
              {hasRevision   && <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />}
              {needsFollowUp && <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{client?.name || '—'}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            <Badge variant="outline" className={cn('h-6 px-2 font-black text-[8px] uppercase tracking-widest border flex items-center gap-1', status.color)}>
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', status.dot)} />
              {status.label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1 w-52">
                <DropdownMenuItem onClick={() => onOpen(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                  <Eye className="w-3.5 h-3.5 mr-2" /> View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCopyLink(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                  <LinkIcon className="w-3.5 h-3.5 mr-2" /> Copy Client Link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/quote/${tenantId}/${quote.id}`, '_blank')} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                  <ExternalLink className="w-3.5 h-3.5 mr-2" /> Preview
                </DropdownMenuItem>
                {quote.status === 'draft' && (
                  <DropdownMenuItem onClick={() => onSend(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 text-primary">
                    <Send className="w-3.5 h-3.5 mr-2" /> Send to Client
                  </DropdownMenuItem>
                )}
                {quote.status === 'accepted' && !isConverted && (
                  <DropdownMenuItem onClick={() => onConvert(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 text-emerald-700">
                    <CalendarCheck className="w-3.5 h-3.5 mr-2" /> Convert to Event
                  </DropdownMenuItem>
                )}
                {quote.status === 'declined' && (
                  <DropdownMenuItem onClick={() => onMarkFollowUp(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 text-amber-700">
                    <Flag className="w-3.5 h-3.5 mr-2" /> Flag Follow-Up
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onDuplicate(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                  <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Meta */}
        <div className="space-y-1">
          {quote.eventDate && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
              <Calendar className="w-3 h-3 opacity-40" />
              {format(new Date(quote.eventDate + 'T12:00:00'), 'MMM d, yyyy')}
            </div>
          )}
          {quote.viewedAt && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-violet-500 uppercase">
              <Eye className="w-3 h-3" />
              Viewed {formatDistanceToNow(parseISO(quote.viewedAt), { addSuffix: true })}
            </div>
          )}
          {hasRevision && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-orange-600 uppercase">
              <RefreshCw className="w-3 h-3" /> Revision requested
            </div>
          )}
          {needsFollowUp && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-red-500 uppercase">
              <Flag className="w-3 h-3" /> Needs follow-up
            </div>
          )}
          {isConverted && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase">
              <CalendarCheck className="w-3 h-3" /> Event created
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-dashed gap-2 flex-wrap">
          <p className="font-black font-mono text-lg text-primary">{formatCurrency(total)}</p>
          <div className="flex items-center gap-2">
            <ExpiryChip quote={quote} />
            {/* Deposit status */}
            {quote.status === 'accepted' && (
              <span className={cn(
                'text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                quote.depositPaid
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400',
              )}>
                {quote.depositPaid ? `Dep. ✓` : 'No deposit'}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Quote Detail Sheet ────────────────────────────────────────────────────────
const QuoteDetailSheet = ({
  quote, clients, tenantId, open, onOpenChange,
  onSend, onCopyLink, onDuplicate, onDelete, onConvert, firestore,
}: {
  quote: any; clients: any[]; tenantId: string;
  open: boolean; onOpenChange: (v: boolean) => void;
  onSend: (q: any) => void; onCopyLink: (q: any) => void;
  onDuplicate: (q: any) => void; onDelete: (q: any) => void;
  onConvert: (q: any) => void; firestore: any;
}) => {
  const { toast } = useToast();
  const router = useRouter();
  const [revisions,        setRevisions]        = useState<any[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [replyText,        setReplyText]        = useState('');
  const [sendingReply,     setSendingReply]      = useState(false);
  const [depositAmount,    setDepositAmount]     = useState('');
  const [savingDeposit,    setSavingDeposit]     = useState(false);
  const [showDepositForm,  setShowDepositForm]   = useState(false);

  useEffect(() => {
    if (!open || !quote || !firestore || !tenantId) return;
    setLoadingRevisions(true);
    getDocs(collection(firestore, `tenants/${tenantId}/quotes/${quote.id}/revisions`))
      .then(snap => setRevisions(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(console.error)
      .finally(() => setLoadingRevisions(false));
  }, [open, quote?.id, firestore, tenantId]);

  const handleSendRevisionReply = async () => {
    if (!replyText.trim() || !firestore || !tenantId || !quote) return;
    setSendingReply(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/quotes`, quote.id), {
        status: 'sent',
        revisionReplyNote: replyText.trim(),
        revisionRepliedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
      });
      setReplyText('');
      toast({ title: 'Reply sent — quote re-sent to client' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Send failed' });
    } finally {
      setSendingReply(false);
    }
  };

  const handleRecordDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || !firestore || !tenantId || !quote) return;
    setSavingDeposit(true);
    try {
      const existing = quote.payments || [];
      await updateDoc(doc(firestore, `tenants/${tenantId}/quotes`, quote.id), {
        payments: [...existing, { id: nanoid(), amount, date: new Date().toISOString(), type: 'deposit', recordedBy: 'staff' }],
        depositPaid: true,
        depositAmount: amount,
        depositPaidAt: new Date().toISOString(),
      });
      setDepositAmount('');
      setShowDepositForm(false);
      toast({ title: `${formatCurrency(amount)} deposit recorded` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to record deposit' });
    } finally {
      setSavingDeposit(false);
    }
  };

  if (!quote) return null;
  const client = clients.find(c => c.id === quote.clientId);
  const total  = calcTotal(quote);
  const status = STATUS_CONFIG[quote.status || 'draft'] || STATUS_CONFIG.draft;
  const totalPaid = (quote.payments || []).reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const balance   = total - totalPaid;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col border-l-0 sm:border-l">
        <SheetHeader className="p-8 pb-5 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <SheetTitle className="text-2xl font-black uppercase tracking-tighter leading-none">
                {quote.eventName || 'Untitled Quote'}
              </SheetTitle>
              <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                {client?.name || 'Unknown Client'}
              </SheetDescription>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Badge variant="outline" className={cn('h-7 px-3 font-black text-[9px] uppercase tracking-widest border flex items-center gap-1.5', status.color)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                {status.label}
              </Badge>
              {quote.convertedToEventId && (
                <button
                  onClick={() => router.push(`/events/${quote.convertedToEventId}/manifest`)}
                  className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
                  <CalendarCheck className="w-3 h-3" /> View Event <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8 space-y-8 text-left">

            {/* Payment summary (accepted quotes) */}
            {quote.status === 'accepted' && (
              <div className="p-5 rounded-2xl border-2 border-green-100 bg-green-50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Payment Status</p>
                  <button onClick={() => setShowDepositForm(s => !s)}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-600 hover:text-green-800 transition-colors">
                    <CreditCard className="w-3 h-3" /> Record Payment {showDepositForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 rounded-xl bg-white border border-green-200">
                    <p className="text-[8px] font-black uppercase tracking-widest text-green-600 opacity-60">Total</p>
                    <p className="font-black font-mono text-sm text-slate-900">{formatCurrency(total)}</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-white border border-green-200">
                    <p className="text-[8px] font-black uppercase tracking-widest text-green-600 opacity-60">Paid</p>
                    <p className="font-black font-mono text-sm text-green-700">{formatCurrency(totalPaid)}</p>
                  </div>
                  <div className={cn('text-center p-3 rounded-xl border', balance > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-green-200')}>
                    <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Balance</p>
                    <p className={cn('font-black font-mono text-sm', balance > 0 ? 'text-amber-700' : 'text-green-700')}>{formatCurrency(balance)}</p>
                  </div>
                </div>
                {showDepositForm && (
                  <div className="flex gap-2 pt-1">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">$</span>
                      <Input type="number" min="0" step="0.01"
                        value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                        placeholder="Amount paid" className="pl-7 h-11 rounded-xl border-2 font-bold" />
                    </div>
                    <Button onClick={handleRecordDeposit} disabled={savingDeposit || !depositAmount}
                      className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-1.5">
                      {savingDeposit ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5" /> Save</>}
                    </Button>
                  </div>
                )}
                {/* Payment history */}
                {(quote.payments || []).length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {(quote.payments || []).map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-[10px] font-bold text-green-700">
                        <span className="uppercase">{p.type} · {format(parseISO(p.date), 'MMM d, yyyy')}</span>
                        <span className="font-mono font-black">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Status Timeline</p>
              <div className="space-y-2">
                {[
                  { label: 'Created',  date: quote.createdAt,           icon: FileText },
                  { label: 'Sent',     date: quote.sentAt,              icon: Send },
                  { label: 'Viewed',   date: quote.viewedAt,            icon: Eye },
                  { label: 'Revision', date: quote.revisionRequestedAt, icon: RefreshCw },
                  { label: 'Accepted', date: quote.acceptedAt,          icon: CheckCircle2 },
                  { label: 'Declined', date: quote.declinedAt,          icon: XCircle },
                  { label: 'Expired',  date: quote.expiredAt,           icon: Clock },
                ].filter(e => e.date).map((event, i) => {
                  const Icon = event.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted/5 border">
                      <Icon className="w-4 h-4 text-primary/40 shrink-0" />
                      <p className="flex-1 font-black text-xs uppercase tracking-widest text-slate-700">{event.label}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">
                        {format(parseISO(event.date), 'MMM d, yyyy · h:mm a')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator className="border-dashed" />

            {/* Decline reason */}
            {quote.declineReason && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Decline Reason</p>
                <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-100">
                  <p className="font-black text-sm text-red-800">{quote.declineReason}</p>
                  {quote.declineNote && <p className="text-[11px] font-medium text-red-600 mt-1">{quote.declineNote}</p>}
                </div>
              </div>
            )}

            {/* Revision requests + reply */}
            {(revisions.length > 0 || loadingRevisions || quote.status === 'revision_requested') && (
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Revision Requests</p>
                {loadingRevisions ? (
                  <div className="flex justify-center p-4"><Loader className="w-5 h-5 animate-spin text-primary" /></div>
                ) : revisions.map(rev => (
                  <div key={rev.id} className="p-4 rounded-2xl border-2 border-orange-100 bg-orange-50 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                        {rev.requestedAt ? format(parseISO(rev.requestedAt), 'MMM d, yyyy · h:mm a') : 'Unknown date'}
                      </p>
                      <Badge variant="outline" className="h-5 px-2 text-[8px] font-black border-orange-200 text-orange-600">{rev.status}</Badge>
                    </div>
                    <p className="font-medium text-sm text-orange-900 leading-relaxed">{rev.message}</p>
                  </div>
                ))}
                {/* Reply box — only when revision is open */}
                {quote.status === 'revision_requested' && (
                  <div className="space-y-2 p-4 rounded-2xl border-2 border-orange-200 bg-white">
                    <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">Reply & Re-send Quote</p>
                    <Textarea
                      value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Explain what you updated (e.g. 'Removed setup fee, adjusted artist count')…"
                      className="min-h-[80px] rounded-xl border-2 text-sm font-medium resize-none" />
                    <Button onClick={handleSendRevisionReply} disabled={sendingReply || !replyText.trim()}
                      className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-orange-600 hover:bg-orange-700">
                      {sendingReply ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5" /> Re-send Updated Quote</>}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Separator className="border-dashed" />

            {/* Line items */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Services</p>
              <div className="space-y-2">
                {quote.lineItems?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-muted/5 border">
                    <div>
                      <p className="font-black text-sm uppercase text-slate-900">{item.name}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{item.quantity} × {formatCurrency(item.price)}</p>
                    </div>
                    <p className="font-black font-mono text-sm">{formatCurrency(item.price * item.quantity)}</p>
                  </div>
                ))}
                {quote.travelExpenses > 0 && (
                  <div className="flex justify-between items-center p-3 rounded-xl bg-muted/5 border">
                    <p className="font-black text-sm uppercase text-slate-900">Travel Expenses</p>
                    <p className="font-black font-mono text-sm">{formatCurrency(quote.travelExpenses)}</p>
                  </div>
                )}
                {quote.projectFee > 0 && (
                  <div className="flex justify-between items-center p-3 rounded-xl bg-muted/5 border">
                    <p className="font-black text-sm uppercase text-slate-900">Service Fee ({quote.projectFee}%)</p>
                    <p className="font-black font-mono text-sm">{formatCurrency((quote.lineItems?.reduce((a: number, i: any) => a + (i.price * i.quantity), 0) || 0) * (quote.projectFee / 100))}</p>
                  </div>
                )}
                <div className="flex justify-between items-center p-4 rounded-xl bg-slate-900 text-white">
                  <span className="font-black text-[10px] uppercase tracking-widest opacity-40">Total</span>
                  <span className="font-black font-mono text-xl">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {/* Client contact */}
            {client && (
              <>
                <Separator className="border-dashed" />
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Client</p>
                  <div className="space-y-2">
                    {client.email && (
                      <a href={`mailto:${client.email}`} className="flex items-center gap-3 p-3 rounded-xl border bg-white hover:border-primary/20 transition-all">
                        <Mail className="w-4 h-4 text-primary/40" />
                        <span className="font-bold text-sm">{client.email}</span>
                      </a>
                    )}
                    {client.phone && (
                      <a href={`tel:${client.phone}`} className="flex items-center gap-3 p-3 rounded-xl border bg-white hover:border-primary/20 transition-all">
                        <Phone className="w-4 h-4 text-primary/40" />
                        <span className="font-bold text-sm">{client.phone}</span>
                      </a>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <div className="p-6 border-t bg-muted/5 flex-shrink-0 space-y-3">
          {quote.status === 'draft' && (
            <Button onClick={() => { onSend(quote); onOpenChange(false); }} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
              <Send className="mr-2 h-3.5 w-3.5" /> Send to Client
            </Button>
          )}
          {quote.status === 'accepted' && !quote.convertedToEventId && (
            <Button onClick={() => { onConvert(quote); onOpenChange(false); }}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 gap-2">
              <CalendarCheck className="h-4 w-4" /> Convert to Event →
            </Button>
          )}
          {quote.convertedToEventId && (
            <Button onClick={() => router.push(`/events/${quote.convertedToEventId}/manifest`)} variant="outline"
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 border-emerald-200 text-emerald-700 gap-2">
              <CalendarCheck className="h-4 w-4" /> View Linked Event →
            </Button>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onCopyLink(quote)} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
              <LinkIcon className="mr-1.5 h-3.5 w-3.5" /> Copy Link
            </Button>
            <Button variant="outline" onClick={() => window.open(`/quote/${tenantId}/${quote.id}`, '_blank')} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Preview
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

// ─── Send Quote Dialog ─────────────────────────────────────────────────────────
const SendQuoteDialog = ({ open, onOpenChange, quote, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  quote: any; onConfirm: (expiryDays: number) => void;
}) => {
  const [expiryDays, setExpiryDays] = useState(14);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[3rem] border-4 shadow-3xl max-w-md">
        <DialogHeader className="p-8 pb-4 text-left">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Send Proposal</DialogTitle>
          <DialogDescription className="font-bold text-sm text-slate-600 uppercase tracking-widest opacity-60">
            Configure expiry and share the link with {quote?.eventName || 'the client'}.
          </DialogDescription>
        </DialogHeader>
        <div className="px-8 pb-4 space-y-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quote expires in</Label>
            <Select value={String(expiryDays)} onValueChange={v => setExpiryDays(parseInt(v))}>
              <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-2">
                <SelectItem value="7"  className="font-bold">7 days</SelectItem>
                <SelectItem value="14" className="font-bold">14 days (recommended)</SelectItem>
                <SelectItem value="30" className="font-bold">30 days</SelectItem>
                <SelectItem value="60" className="font-bold">60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-100 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">What happens next</p>
            <p className="text-[11px] font-bold text-blue-600 leading-relaxed">
              The client link is auto-copied to your clipboard. Paste it into a text, email, or DM.
              You'll see when they view and respond — right here.
            </p>
          </div>
        </div>
        <DialogFooter className="px-8 pb-8 flex gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 font-black uppercase text-[10px] tracking-widest">Cancel</Button>
          <Button onClick={() => onConfirm(expiryDays)} className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
            <Send className="mr-2 h-4 w-4" /> Mark as Sent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Convert to Event Dialog ───────────────────────────────────────────────────
const ConvertToEventDialog = ({ open, onOpenChange, quote, clients, tenantId, firestore }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  quote: any; clients: any[]; tenantId: string; firestore: any;
}) => {
  const router    = useRouter();
  const { toast } = useToast();
  const [converting, setConverting] = useState(false);
  const client = clients.find(c => c.id === quote?.clientId);

  const handleConvert = async () => {
    if (!firestore || !tenantId || !quote) return;
    setConverting(true);
    try {
      // Build line items → course hints for the event description
      const lineItemSummary = (quote.lineItems || []).map((l: any) => `${l.name} (×${l.quantity})`).join(', ');

      // Create the studioEvent
      const eventRef = await addDoc(collection(firestore, `tenants/${tenantId}/studioEvents`), {
        title:         quote.eventName || 'Untitled Event',
        name:          quote.eventName || 'Untitled Event',
        date:          quote.eventDate || '',
        time:          '19:00',
        venue:         quote.venue || '',
        capacity:      quote.partySize ? parseInt(quote.partySize) : null,
        description:   lineItemSummary || null,
        status:        'upcoming',
        quoteId:       quote.id,
        eventType:     'other',
        tenantId,
        courses:       [],
        menuItems:     [],
        createdAt:     new Date().toISOString(),
      });

      // Add client as the first guest
      if (client) {
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id:                   nanoid(),
          eventId:              eventRef.id,
          tenantId,
          name:                 client.name,
          email:                client.email || '',
          phone:                client.phone || '',
          tableNumber:          '',
          seatNumber:           '',
          mealChoiceId:         null,
          mealChoiceName:       null,
          allergies:            [],
          dietaryRestrictions:  [],
          checkedIn:            false,
          source:               'quote_conversion',
          clientId:             client.id,
          submittedAt:          new Date().toISOString(),
        });
      }

      // Mark the quote as converted
      await updateDoc(doc(firestore, `tenants/${tenantId}/quotes`, quote.id), {
        convertedToEventId: eventRef.id,
        convertedAt:        new Date().toISOString(),
      });

      toast({ title: 'Event created!', description: 'Redirecting to manifest…' });
      onOpenChange(false);
      router.push(`/events/${eventRef.id}/manifest`);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Conversion failed — please try again' });
    } finally {
      setConverting(false);
    }
  };

  if (!quote) return null;
  const total = calcTotal(quote);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[3rem] border-4 shadow-2xl max-w-md">
        <DialogHeader className="p-8 pb-4 text-left">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-emerald-600" /> Convert to Event
          </DialogTitle>
          <DialogDescription className="font-bold text-sm text-slate-600 uppercase tracking-widest opacity-60">
            Creates a new event pre-filled from this accepted quote.
          </DialogDescription>
        </DialogHeader>
        <div className="px-8 pb-4 space-y-4">
          {/* Preview of what will be created */}
          <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">Event Title</p>
                <p className="font-black text-sm text-emerald-900">{quote.eventName || 'Untitled'}</p>
              </div>
              {quote.eventDate && (
                <div className="flex justify-between items-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">Date</p>
                  <p className="font-bold text-sm text-emerald-800">{format(new Date(quote.eventDate + 'T12:00:00'), 'MMM d, yyyy')}</p>
                </div>
              )}
              {quote.venue && (
                <div className="flex justify-between items-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">Venue</p>
                  <p className="font-bold text-sm text-emerald-800">{quote.venue}</p>
                </div>
              )}
              {client && (
                <div className="flex justify-between items-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">First Guest</p>
                  <p className="font-bold text-sm text-emerald-800">{client.name}</p>
                </div>
              )}
              <div className="flex justify-between items-center border-t border-emerald-200 pt-2 mt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">Quoted Value</p>
                <p className="font-black font-mono text-emerald-700">{formatCurrency(total)}</p>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
              The event manifest opens immediately. Add menu items, staff, and remaining guests there. The quote stays linked for reference.
            </p>
          </div>
        </div>
        <DialogFooter className="px-8 pb-8 flex gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 font-black uppercase text-[10px] tracking-widest">Cancel</Button>
          <Button onClick={handleConvert} disabled={converting}
            className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200 gap-2">
            {converting ? <Loader className="w-4 h-4 animate-spin" /> : <><CalendarCheck className="w-4 h-4" /> Create Event →</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Quote Templates Sheet ─────────────────────────────────────────────────────
const QuoteTemplatesSheet = ({ open, onOpenChange, tenantId, firestore, clients }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  tenantId: string; firestore: any; clients: any[];
}) => {
  const router    = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');

  const handleUseTemplate = async (template: typeof QUOTE_TEMPLATES[0]) => {
    if (!firestore || !tenantId) return;
    setCreating(template.id);
    try {
      const ref = await addDoc(collection(firestore, `tenants/${tenantId}/quotes`), {
        eventName:       `${template.name}`,
        clientId:        clientId || null,
        status:          'draft',
        lineItems:       template.lineItems,
        projectFee:      template.projectFee,
        travelExpenses:  template.travelExpenses,
        createdAt:       new Date().toISOString(),
        fromTemplate:    template.id,
      });
      toast({ title: 'Draft created from template', description: 'Opening quote editor…' });
      onOpenChange(false);
      router.push(`/quotes/${ref.id}/edit`);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to create from template' });
    } finally {
      setCreating(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-8 pb-5 border-b text-left">
          <SheetTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> Quote Templates
          </SheetTitle>
          <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
            Start from a pre-built package
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Assign to Client (optional)</Label>
            <Select value={clientId || '**none**'} onValueChange={v => setClientId(v === '**none**' ? '' : v)}>
              <SelectTrigger className="h-11 rounded-xl border-2 font-bold text-sm">
                <SelectValue placeholder="Select client…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="**none**" className="font-bold">No client yet</SelectItem>
                {(clients || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id} className="font-bold">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {QUOTE_TEMPLATES.map(t => {
            const subtotal = t.lineItems.reduce((a, i) => a + i.price * i.quantity, 0);
            const total    = subtotal + t.travelExpenses + subtotal * (t.projectFee / 100);
            return (
              <div key={t.id} className="rounded-2xl border-2 border-slate-200 bg-white overflow-hidden hover:border-primary/30 transition-all">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-black text-sm text-slate-900">{t.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">{t.description}</p>
                    </div>
                    <p className="font-black font-mono text-primary shrink-0">{formatCurrency(total)}</p>
                  </div>
                  <div className="space-y-1 mb-3">
                    {t.lineItems.map((li, i) => (
                      <div key={i} className="flex justify-between text-[10px] font-bold text-slate-500">
                        <span>{li.name} ×{li.quantity}</span>
                        <span className="font-mono">{formatCurrency(li.price * li.quantity)}</span>
                      </div>
                    ))}
                  </div>
                  <Button onClick={() => handleUseTemplate(t)} disabled={!!creating}
                    className="w-full h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-2">
                    {creating === t.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Zap className="w-3.5 h-3.5" /> Use This Template</>}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// ─── Analytics Tab ─────────────────────────────────────────────────────────────
const AnalyticsTab = ({ quotes, clients }: { quotes: any[]; clients: any[] }) => {
  const stats = useMemo(() => {
    const total      = quotes.length;
    const accepted   = quotes.filter(q => q.status === 'accepted');
    const declined   = quotes.filter(q => q.status === 'declined');
    const sent       = quotes.filter(q => ['sent', 'viewed', 'accepted', 'declined', 'expired'].includes(q.status));
    const acceptRate = sent.length > 0 ? (accepted.length / sent.length) * 100 : 0;
    const avgValue   = accepted.length > 0
      ? accepted.reduce((a, q) => a + calcTotal(q), 0) / accepted.length : 0;
    const totalRevenue  = accepted.reduce((a, q) => a + calcTotal(q), 0);
    const viewedRate    = sent.length > 0 ? (quotes.filter(q => q.viewedAt).length / sent.length) * 100 : 0;
    const reasons: Record<string, number> = {};
    declined.forEach(q => { const r = q.declineReason || 'Not specified'; reasons[r] = (reasons[r] || 0) + 1; });
    const acceptTimes   = accepted.filter(q => q.sentAt && q.acceptedAt).map(q => (new Date(q.acceptedAt).getTime() - new Date(q.sentAt).getTime()) / (1000 * 60 * 60 * 24));
    const avgDaysToAccept = acceptTimes.length > 0 ? acceptTimes.reduce((a, b) => a + b, 0) / acceptTimes.length : 0;
    return { total, acceptRate, avgValue, totalRevenue, viewedRate, reasons, avgDaysToAccept, acceptedCount: accepted.length, declinedCount: declined.length };
  }, [quotes]);

  // Monthly trend — last 6 months
  const monthlyData = useMemo(() => {
    const map: Record<string, { label: string; sent: number; accepted: number; revenue: number }> = {};
    quotes.forEach(q => {
      if (!q.createdAt) return;
      const key   = format(parseISO(q.createdAt), 'yyyy-MM');
      const label = format(parseISO(q.createdAt), 'MMM');
      if (!map[key]) map[key] = { label, sent: 0, accepted: 0, revenue: 0 };
      if (q.status !== 'draft') map[key].sent++;
      if (q.status === 'accepted') { map[key].accepted++; map[key].revenue += calcTotal(q); }
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([, v]) => v);
  }, [quotes]);

  const maxRevenue = Math.max(...monthlyData.map(m => m.revenue), 1);

  return (
    <div className="space-y-8">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Quotes',    value: stats.total,                        color: '' },
          { label: 'Acceptance Rate', value: `${stats.acceptRate.toFixed(0)}%`,  color: stats.acceptRate >= 50 ? 'text-green-600' : 'text-amber-600' },
          { label: 'Avg Quote Value', value: `$${stats.avgValue.toFixed(0)}`,    color: 'text-primary' },
          { label: 'Total Revenue',   value: `$${stats.totalRevenue.toFixed(0)}`,color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="p-5 rounded-[2rem] border-2 bg-white shadow-sm text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</p>
            <p className={cn('text-2xl font-black mt-1', s.color || 'text-slate-900')}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly revenue trend */}
      {monthlyData.length > 0 && (
        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Monthly Revenue Trend</p>
          </div>
          <div className="flex items-end gap-3 h-28">
            {monthlyData.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <p className="text-[8px] font-black text-slate-400 font-mono">${(m.revenue / 1000).toFixed(1)}k</p>
                <div className="w-full relative rounded-t-lg overflow-hidden bg-slate-100" style={{ height: '60px' }}>
                  <div
                    className="absolute bottom-0 w-full bg-primary/80 rounded-t-lg transition-all"
                    style={{ height: `${(m.revenue / maxRevenue) * 100}%` }}
                  />
                  {m.accepted > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[7px] font-black text-white opacity-80">{m.accepted}</span>
                    </div>
                  )}
                </div>
                <p className="text-[9px] font-black uppercase text-slate-500">{m.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 pt-1">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary/80" /><span className="text-[9px] font-bold text-slate-500 uppercase">Revenue (bar height)</span></div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-white border border-slate-200 text-[6px] flex items-center justify-center font-black text-slate-500">n</span><span className="text-[9px] font-bold text-slate-500 uppercase">Accepted count</span></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Funnel */}
        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Proposal Funnel</p>
          <div className="space-y-3">
            {[
              { label: 'Total Sent',  value: quotes.filter(q => q.status !== 'draft').length, color: 'bg-blue-400', pct: 100 },
              { label: 'Viewed',      value: quotes.filter(q => q.viewedAt).length,            color: 'bg-violet-400', pct: stats.viewedRate },
              { label: 'Accepted',   value: stats.acceptedCount,                               color: 'bg-green-400', pct: stats.acceptRate },
              { label: 'Declined',   value: stats.declinedCount,                               color: 'bg-red-300',   pct: quotes.filter(q => q.status !== 'draft').length > 0 ? (stats.declinedCount / quotes.filter(q => q.status !== 'draft').length) * 100 : 0 },
            ].map(row => (
              <div key={row.label} className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase text-slate-600">
                  <span>{row.label}</span>
                  <span className="font-mono">{row.value}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', row.color)} style={{ width: `${Math.min(row.pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Decline reasons */}
        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Why Clients Decline</p>
          {Object.keys(stats.reasons).length === 0 ? (
            <p className="text-sm font-bold text-muted-foreground opacity-40 text-center py-6">No declines yet</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                <div key={reason} className="flex justify-between items-center p-3 rounded-xl bg-muted/5 border">
                  <p className="font-bold text-sm text-slate-700 truncate">{reason}</p>
                  <Badge variant="outline" className="font-black font-mono shrink-0 ml-2">{count}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timing stats */}
        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4 md:col-span-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Response Timing</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-2xl bg-muted/5 border">
              <p className="text-2xl font-black font-mono text-primary">{stats.viewedRate.toFixed(0)}%</p>
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mt-1">View Rate</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-muted/5 border">
              <p className="text-2xl font-black font-mono text-slate-900">{stats.avgDaysToAccept.toFixed(1)}</p>
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mt-1">Avg Days to Accept</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-muted/5 border">
              <p className="text-2xl font-black font-mono text-green-600">{stats.acceptRate.toFixed(0)}%</p>
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mt-1">Close Rate</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function QuotesPage() {
  const router = useRouter();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { clients } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const quotesQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/quotes`) : null,
    [firestore, tenantId]
  );
  const { data: quotes, isLoading } = useCollection<any>(quotesQ);

  const requestsQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/quoteRequests`) : null,
    [firestore, tenantId]
  );
  const { data: quoteRequests } = useCollection<any>(requestsQ);
  const newInquiryCount = quoteRequests?.filter((r: any) => r.status === 'new' || !r.viewed).length || 0;

  const [search,             setSearch]             = useState('');
  const [statusFilter,       setStatusFilter]       = useState('all');
  const [activeTab,          setActiveTab]          = useState('quotes');
  const [selectedQuote,      setSelectedQuote]      = useState<any>(null);
  const [sheetOpen,          setSheetOpen]          = useState(false);
  const [quoteToDelete,      setQuoteToDelete]      = useState<any>(null);
  const [quoteToSend,        setQuoteToSend]        = useState<any>(null);
  const [convertDialogQuote, setConvertDialogQuote] = useState<any>(null);
  const [templatesSheetOpen, setTemplatesSheetOpen] = useState(false);

  // Auto-expire sent/viewed quotes past their expiry date
  useEffect(() => {
    if (!quotes || !firestore || !tenantId) return;
    quotes.forEach(q => {
      if (!['sent', 'viewed'].includes(q.status)) return;
      if (!q.expiresInDays || !q.sentAt) return;
      if (isPast(addDays(new Date(q.sentAt), q.expiresInDays))) {
        updateDocumentNonBlocking(
          doc(firestore, `tenants/${tenantId}/quotes`, q.id),
          { status: 'expired', expiredAt: new Date().toISOString() }
        );
      }
    });
  }, [quotes, firestore, tenantId]);

  const filtered = useMemo(() => {
    if (!quotes) return [];
    return quotes
      .filter(q => {
        const matchSearch = !search ||
          (q.eventName || '').toLowerCase().includes(search.toLowerCase()) ||
          ((clients || []).find((c: any) => c.id === q.clientId)?.name || '').toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || q.status === statusFilter;
        return matchSearch && matchStatus;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [quotes, search, statusFilter, clients]);

  const stats = useMemo(() => {
    if (!quotes) return { total: 0, accepted: 0, pending: 0, value: 0, needsAttention: 0 };
    return {
      total:          quotes.length,
      accepted:       quotes.filter(q => q.status === 'accepted').length,
      pending:        quotes.filter(q => ['sent', 'viewed'].includes(q.status)).length,
      value:          quotes.filter(q => q.status === 'accepted').reduce((a, q) => a + calcTotal(q), 0),
      needsAttention: quotes.filter(q => q.status === 'revision_requested' || (q.needsFollowUp && q.status === 'declined')).length,
    };
  }, [quotes]);

  const handleSendConfirm = (expiryDays: number) => {
    if (!quoteToSend || !firestore || !tenantId) return;
    updateDocumentNonBlocking(
      doc(firestore, `tenants/${tenantId}/quotes`, quoteToSend.id),
      { status: 'sent', sentAt: new Date().toISOString(), expiresInDays: expiryDays }
    );
    // Copy link + notify
    const link = `${window.location.origin}/quote/${tenantId}/${quoteToSend.id}`;
    navigator.clipboard.writeText(link).then(() => {
      toast({ title: 'Quote Sent ✓', description: 'Client link copied — paste it in your message to them.' });
    }).catch(() => {
      toast({ title: 'Quote Sent ✓', description: `Share this link: ${link}` });
    });
    setQuoteToSend(null);
  };

  const handleDelete = (quote: any) => {
    if (!firestore || !tenantId) return;
    deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/quotes`, quote.id));
    setQuoteToDelete(null);
    if (selectedQuote?.id === quote.id) { setSheetOpen(false); setSelectedQuote(null); }
    toast({ title: 'Quote Deleted' });
  };

  const handleCopyLink = (quote: any) => {
    navigator.clipboard.writeText(`${window.location.origin}/quote/${tenantId}/${quote.id}`);
    toast({ title: 'Link Copied', description: 'Paste it anywhere to share with the client.' });
  };

  const handleDuplicate = (quote: any) => {
    if (!firestore || !tenantId) return;
    const { id, status, sentAt, viewedAt, acceptedAt, declinedAt, expiredAt, locked, convertedToEventId, convertedAt, ...rest } = quote;
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/quotes`), {
      ...rest, eventName: `${quote.eventName} (Copy)`, status: 'draft', createdAt: new Date().toISOString(),
    });
    toast({ title: 'Duplicated' });
  };

  // FIX: was only setting followUpScheduled — needsFollowUp boolean was never written,
  // so the card's `needsFollowUp` check always returned false.
  const handleMarkFollowUp = (quote: any) => {
    if (!firestore || !tenantId) return;
    updateDocumentNonBlocking(
      doc(firestore, `tenants/${tenantId}/quotes`, quote.id),
      { needsFollowUp: true, followUpScheduled: new Date().toISOString() }
    );
    toast({ title: 'Follow-up Flagged', description: 'Marked for outreach.' });
  };

  const handleOpen = (quote: any) => { setSelectedQuote(quote); setSheetOpen(true); };

  if (!tenantId) return (
    <div className="flex h-screen items-center justify-center">
      <Loader className="animate-spin h-8 w-8 text-primary" />
    </div>
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Quotes" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 text-left">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Proposals</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Client quotes & event contracts</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button variant="outline" onClick={() => setTemplatesSheetOpen(true)}
              className="h-14 px-5 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] gap-2">
              <BookOpen className="w-4 h-4" /> Templates
            </Button>
            <Button onClick={() => router.push('/quotes/new')}
              className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 flex-1 md:flex-none gap-2">
              <PlusCircle className="h-4 w-4" /> New Proposal
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {[
            { label: 'Total',         value: stats.total,                  color: '' },
            { label: 'Accepted',      value: stats.accepted,               color: 'text-green-600' },
            { label: 'Awaiting',      value: stats.pending,                color: 'text-blue-600' },
            { label: 'Revenue',       value: `$${stats.value.toFixed(0)}`, color: 'text-primary' },
            { label: 'Action Needed', value: stats.needsAttention,         color: stats.needsAttention > 0 ? 'text-orange-600' : '' },
          ].map(s => (
            <div key={s.label} className={cn('p-4 rounded-[2rem] border-2 bg-white shadow-sm text-left', s.label === 'Action Needed' && stats.needsAttention > 0 && 'border-orange-200 bg-orange-50')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</p>
              <p className={cn('text-2xl font-black mt-0.5', s.color || 'text-slate-900')}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner mb-8 inline-flex">
            {[
              { value: 'quotes',    label: 'Quotes' },
              { value: 'inquiries', label: 'Inquiries', badge: newInquiryCount },
              { value: 'analytics', label: 'Analytics' },
            ].map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-10 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md relative">
                {tab.label}
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-violet-500 text-white text-[9px] font-black flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Quotes tab */}
          <TabsContent value="quotes" className="mt-0">
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                <Input placeholder="Search by event or client..." value={search} onChange={e => setSearch(e.target.value)} className="pl-12 h-12 rounded-2xl border-2 font-bold bg-white" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full sm:w-52 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-xl">
                  <SelectItem value="all"                className="font-bold">All Statuses</SelectItem>
                  <SelectItem value="draft"              className="font-bold">Draft</SelectItem>
                  <SelectItem value="sent"               className="font-bold">Sent</SelectItem>
                  <SelectItem value="viewed"             className="font-bold">Viewed</SelectItem>
                  <SelectItem value="revision_requested" className="font-bold">Revision Requested</SelectItem>
                  <SelectItem value="accepted"           className="font-bold">Accepted</SelectItem>
                  <SelectItem value="declined"           className="font-bold">Declined</SelectItem>
                  <SelectItem value="expired"            className="font-bold">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <Loader className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-24 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                <FileText className="w-16 h-16" />
                <p className="font-black uppercase tracking-widest text-sm">No proposals found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(q => (
                  <QuoteCard
                    key={q.id} quote={q} clients={clients || []} tenantId={tenantId || ''}
                    onCopyLink={handleCopyLink} onDelete={setQuoteToDelete}
                    onDuplicate={handleDuplicate} onSend={q => setQuoteToSend(q)}
                    onOpen={handleOpen} onMarkFollowUp={handleMarkFollowUp}
                    onConvert={q => setConvertDialogQuote(q)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Inquiries tab */}
          <TabsContent value="inquiries" className="mt-0">
            {tenantId ? <InquiriesTab tenantId={tenantId} /> : <Loader className="animate-spin" />}
          </TabsContent>

          {/* Analytics tab */}
          <TabsContent value="analytics" className="mt-0">
            <AnalyticsTab quotes={quotes || []} clients={clients || []} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Detail sheet */}
      <QuoteDetailSheet
        quote={selectedQuote}
        clients={clients || []}
        tenantId={tenantId || ''}
        firestore={firestore}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSend={q => setQuoteToSend(q)}
        onCopyLink={handleCopyLink}
        onDuplicate={handleDuplicate}
        onDelete={setQuoteToDelete}
        onConvert={q => setConvertDialogQuote(q)}
      />

      {/* Send dialog */}
      <SendQuoteDialog
        open={!!quoteToSend}
        onOpenChange={open => !open && setQuoteToSend(null)}
        quote={quoteToSend}
        onConfirm={handleSendConfirm}
      />

      {/* Convert to event dialog */}
      <ConvertToEventDialog
        open={!!convertDialogQuote}
        onOpenChange={open => !open && setConvertDialogQuote(null)}
        quote={convertDialogQuote}
        clients={clients || []}
        tenantId={tenantId || ''}
        firestore={firestore}
      />

      {/* Templates sheet */}
      <QuoteTemplatesSheet
        open={templatesSheetOpen}
        onOpenChange={setTemplatesSheetOpen}
        tenantId={tenantId || ''}
        firestore={firestore}
        clients={clients || []}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!quoteToDelete} onOpenChange={() => setQuoteToDelete(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
          <AlertDialogHeader className="p-8 pb-4">
            <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Delete Proposal</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600">
              Permanently delete "{quoteToDelete?.eventName}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="p-8 pt-0 flex flex-col gap-3">
            <Button onClick={() => quoteToDelete && handleDelete(quoteToDelete)} className="w-full h-12 rounded-2xl font-black uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </Button>
            <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}