'use client';

/**
 * QuotesPage.tsx
 *
 * FIXES APPLIED:
 * 1. Quote templates are no longer hardcoded to nail studios.
 *    Templates now load from Firestore tenants/{id}/quoteTemplates.
 *    On first visit, we seed a single generic starter template.
 *    Staff can create, edit, and delete their own templates that match their niche.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  useFirebase, useCollection, useMemoFirebase,
  addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking,
} from '@/firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, query, where,
} from 'firebase/firestore';
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
  ChevronUp, Check, X, CalendarCheck, Edit2, Save,
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

// ─── GENERIC SEED TEMPLATE ────────────────────────────────────────────────────
// This is only used on first visit when a tenant has no templates yet.
// It is intentionally generic — not tied to any specific service niche.
const SEED_TEMPLATE = {
  name: 'Standard Service Package',
  description: 'Customize this template for your service offering',
  lineItems: [
    { name: 'Service', quantity: 1, price: 0 },
  ],
  projectFee: 0,
  travelExpenses: 0,
};

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  draft:              { label: 'Draft',         color: 'bg-slate-100 border-slate-200 text-slate-600',   dot: 'bg-slate-400' },
  sent:               { label: 'Sent',           color: 'bg-blue-50 border-blue-100 text-blue-700',       dot: 'bg-blue-400' },
  viewed:             { label: 'Viewed',         color: 'bg-violet-50 border-violet-100 text-violet-700', dot: 'bg-violet-500 animate-pulse' },
  accepted:           { label: 'Accepted',       color: 'bg-green-50 border-green-100 text-green-700',    dot: 'bg-green-500' },
  declined:           { label: 'Declined',       color: 'bg-red-50 border-red-100 text-red-700',          dot: 'bg-red-400' },
  expired:            { label: 'Expired',        color: 'bg-amber-50 border-amber-100 text-amber-700',    dot: 'bg-amber-400' },
  revision_requested: { label: 'Revision Req.',  color: 'bg-orange-50 border-orange-100 text-orange-700', dot: 'bg-orange-400 animate-pulse' },
};

const calcTotal = (quote: any) => {
  const sub = quote.lineItems?.reduce((a: number, i: any) => a + ((i.price || 0) * (i.quantity || 1)), 0) || 0;
  const fee = sub * ((quote.projectFee || 0) / 100);
  return sub + (quote.travelExpenses || 0) + fee;
};

const getExpiryInfo = (quote: any) => {
  if (!['sent', 'viewed'].includes(quote.status)) return null;
  if (!quote.sentAt || !quote.expiresInDays) return null;
  const expiryDate = addDays(new Date(quote.sentAt), quote.expiresInDays);
  const msLeft = expiryDate.getTime() - Date.now();
  if (msLeft <= 0) return null;
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  if (daysLeft > 7) return null;
  return {
    daysLeft,
    label: daysLeft <= 0 ? 'Expires today' : daysLeft === 1 ? 'Expires tomorrow' : `${daysLeft}d left`,
    urgent: daysLeft <= 1,
  };
};

const ExpiryChip = ({ quote }: { quote: any }) => {
  const info = getExpiryInfo(quote);
  if (!info) return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
      info.urgent ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' : 'bg-amber-50 border-amber-200 text-amber-600',
    )}>
      <Clock className="w-2.5 h-2.5" /> {info.label}
    </span>
  );
};

// ─── QUOTE CARD ───────────────────────────────────────────────────────────────
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

        <div className="space-y-1">
          {quote.eventDate && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
              <Calendar className="w-3 h-3 opacity-40" />
              {format(new Date(quote.eventDate + 'T12:00:00'), 'MMM d, yyyy')}
            </div>
          )}
          {quote.viewedAt && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-violet-500 uppercase">
              <Eye className="w-3 h-3" /> Viewed {formatDistanceToNow(parseISO(quote.viewedAt), { addSuffix: true })}
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

        <div className="flex items-center justify-between pt-3 border-t border-dashed gap-2 flex-wrap">
          <p className="font-black font-mono text-lg text-primary">{formatCurrency(total)}</p>
          <div className="flex items-center gap-2">
            <ExpiryChip quote={quote} />
            {quote.status === 'accepted' && (
              <span className={cn(
                'text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                quote.depositPaid
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400',
              )}>
                {quote.depositPaid ? 'Dep. ✓' : 'No deposit'}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── QUOTE DETAIL SHEET ───────────────────────────────────────────────────────
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
  const client    = clients.find(c => c.id === quote.clientId);
  const total     = calcTotal(quote);
  const status    = STATUS_CONFIG[quote.status || 'draft'] || STATUS_CONFIG.draft;
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
                  className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  <CalendarCheck className="w-3 h-3" /> View Event <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8 space-y-8 text-left">

            {quote.status === 'accepted' && (
              <div className="p-5 rounded-2xl border-2 border-green-100 bg-green-50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Payment Status</p>
                  <button
                    onClick={() => setShowDepositForm(s => !s)}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-600 hover:text-green-800 transition-colors"
                  >
                    <CreditCard className="w-3 h-3" /> Record Payment {showDepositForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total',   value: formatCurrency(total),     color: 'text-slate-900' },
                    { label: 'Paid',    value: formatCurrency(totalPaid), color: 'text-green-700' },
                    { label: 'Balance', value: formatCurrency(balance),   color: balance > 0 ? 'text-amber-700' : 'text-green-700' },
                  ].map(s => (
                    <div key={s.label} className={cn('text-center p-3 rounded-xl bg-white border', balance > 0 && s.label === 'Balance' ? 'border-amber-200 bg-amber-50' : 'border-green-200')}>
                      <p className="text-[8px] font-black uppercase tracking-widest text-green-600 opacity-60">{s.label}</p>
                      <p className={cn('font-black font-mono text-sm', s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {showDepositForm && (
                  <div className="flex gap-2 pt-1">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">$</span>
                      <Input
                        type="number" min="0" step="0.01"
                        value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                        placeholder="Amount paid" className="pl-7 h-11 rounded-xl border-2 font-bold"
                      />
                    </div>
                    <Button
                      onClick={handleRecordDeposit} disabled={savingDeposit || !depositAmount}
                      className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-1.5"
                    >
                      {savingDeposit ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5" /> Save</>}
                    </Button>
                  </div>
                )}
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

            {quote.declineReason && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Decline Reason</p>
                <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-100">
                  <p className="font-black text-sm text-red-800">{quote.declineReason}</p>
                  {quote.declineNote && <p className="text-[11px] font-medium text-red-600 mt-1">{quote.declineNote}</p>}
                </div>
              </div>
            )}

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
                {quote.status === 'revision_requested' && (
                  <div className="space-y-2 p-4 rounded-2xl border-2 border-orange-200 bg-white">
                    <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">Reply & Re-send Quote</p>
                    <Textarea
                      value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Explain what you updated…"
                      className="min-h-[80px] rounded-xl border-2 text-sm font-medium resize-none"
                    />
                    <Button
                      onClick={handleSendRevisionReply} disabled={sendingReply || !replyText.trim()}
                      className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-orange-600 hover:bg-orange-700"
                    >
                      {sendingReply ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5" /> Re-send Updated Quote</>}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Separator className="border-dashed" />

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
                    <p className="font-black font-mono text-sm">
                      {formatCurrency((quote.lineItems?.reduce((a: number, i: any) => a + (i.price * i.quantity), 0) || 0) * (quote.projectFee / 100))}
                    </p>
                  </div>
                )}
                <div className="flex justify-between items-center p-4 rounded-xl bg-slate-900 text-white">
                  <span className="font-black text-[10px] uppercase tracking-widest opacity-40">Total</span>
                  <span className="font-black font-mono text-xl">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

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

        <div className="p-6 border-t bg-muted/5 flex-shrink-0 space-y-3">
          {quote.status === 'draft' && (
            <Button
              onClick={() => { onSend(quote); onOpenChange(false); }}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20"
            >
              <Send className="mr-2 h-3.5 w-3.5" /> Send to Client
            </Button>
          )}
          {quote.status === 'accepted' && !quote.convertedToEventId && (
            <Button
              onClick={() => { onConvert(quote); onOpenChange(false); }}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 gap-2"
            >
              <CalendarCheck className="h-4 w-4" /> Convert to Event →
            </Button>
          )}
          {quote.convertedToEventId && (
            <Button
              onClick={() => router.push(`/events/${quote.convertedToEventId}/manifest`)} variant="outline"
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 border-emerald-200 text-emerald-700 gap-2"
            >
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

// ─── SEND QUOTE DIALOG ────────────────────────────────────────────────────────
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
              <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-xs"><SelectValue /></SelectTrigger>
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

// ─── CONVERT TO EVENT DIALOG ──────────────────────────────────────────────────
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
      const lineItemSummary = (quote.lineItems || []).map((l: any) => `${l.name} (×${l.quantity})`).join(', ');
      const eventRef = await addDoc(collection(firestore, `tenants/${tenantId}/studioEvents`), {
        title: quote.eventName || 'Untitled Event', name: quote.eventName || 'Untitled Event',
        date: quote.eventDate || '', time: '19:00', venue: quote.venue || '',
        capacity: quote.partySize ? parseInt(quote.partySize) : null,
        description: lineItemSummary || null, status: 'upcoming', quoteId: quote.id,
        eventType: 'other', tenantId, courses: [], menuItems: [], createdAt: new Date().toISOString(),
      });
      if (client) {
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id: nanoid(), eventId: eventRef.id, tenantId,
          name: client.name, email: client.email || '', phone: client.phone || '',
          tableNumber: '', seatNumber: '', mealChoiceId: null, mealChoiceName: null,
          allergies: [], dietaryRestrictions: [], checkedIn: false,
          source: 'quote_conversion', clientId: client.id, submittedAt: new Date().toISOString(),
        });
      }
      await updateDoc(doc(firestore, `tenants/${tenantId}/quotes`, quote.id), {
        convertedToEventId: eventRef.id, convertedAt: new Date().toISOString(),
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
          <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 space-y-3">
            <div className="space-y-1.5">
              {[
                { label: 'Event Title', value: quote.eventName || 'Untitled' },
                quote.eventDate && { label: 'Date', value: format(new Date(quote.eventDate + 'T12:00:00'), 'MMM d, yyyy') },
                quote.venue && { label: 'Venue', value: quote.venue },
                client && { label: 'First Guest', value: client.name },
              ].filter(Boolean).map((row: any) => (
                <div key={row.label} className="flex justify-between items-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">{row.label}</p>
                  <p className="font-bold text-sm text-emerald-800">{row.value}</p>
                </div>
              ))}
              <div className="flex justify-between items-center border-t border-emerald-200 pt-2 mt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 opacity-70">Quoted Value</p>
                <p className="font-black font-mono text-emerald-700">{formatCurrency(total)}</p>
              </div>
            </div>
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

// ─── TEMPLATE EDITOR ──────────────────────────────────────────────────────────
// Inline editor for a single template's line items + fees.
// Used in both the "create new" and "edit existing" flows.
const TemplateEditor = ({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: any;
  onSave: (data: any) => void;
  onCancel: () => void;
  saving: boolean;
}) => {
  const [name,           setName]           = useState(initial.name || '');
  const [description,    setDescription]    = useState(initial.description || '');
  const [projectFee,     setProjectFee]     = useState(initial.projectFee ?? 0);
  const [travelExpenses, setTravelExpenses] = useState(initial.travelExpenses ?? 0);
  const [lineItems,      setLineItems]      = useState<any[]>(
    initial.lineItems?.length ? initial.lineItems : [{ name: '', quantity: 1, price: 0 }]
  );

  const subtotal = lineItems.reduce((a: number, li: any) => a + ((li.price || 0) * (li.quantity || 1)), 0);
  const total = subtotal + (travelExpenses || 0) + subtotal * ((projectFee || 0) / 100);

  const updateItem = (i: number, field: string, value: any) => {
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: value } : li));
  };

  const addItem = () => setLineItems(prev => [...prev, { name: '', quantity: 1, price: 0 }]);
  const removeItem = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), lineItems, projectFee, travelExpenses });
  };

  return (
    <div className="space-y-5 p-5 rounded-2xl border-2 border-primary/20 bg-primary/5">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Template Name *</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Photography Half-Day Package"
            className="h-11 rounded-xl border-2 font-bold"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Description</Label>
          <Input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of what this covers"
            className="h-10 rounded-xl border-2"
          />
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Line Items</Label>
        {lineItems.map((li: any, i: number) => (
          <div key={i} className="grid grid-cols-[1fr_60px_80px_32px] gap-2 items-center">
            <Input
              value={li.name}
              onChange={e => updateItem(i, 'name', e.target.value)}
              placeholder="Item name"
              className="h-9 rounded-lg border-2 text-sm font-bold"
            />
            <Input
              type="number" min="1"
              value={li.quantity}
              onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)}
              className="h-9 rounded-lg border-2 text-sm font-bold text-center"
            />
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
              <Input
                type="number" min="0" step="0.01"
                value={li.price}
                onChange={e => updateItem(i, 'price', parseFloat(e.target.value) || 0)}
                className="h-9 pl-5 rounded-lg border-2 text-sm font-bold font-mono"
              />
            </div>
            <button
              onClick={() => removeItem(i)}
              disabled={lineItems.length === 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-20"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={addItem}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
        >
          <PlusCircle className="w-3.5 h-3.5" /> Add Line Item
        </button>
      </div>

      {/* Fees */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service Fee %</Label>
          <Input
            type="number" min="0" max="100"
            value={projectFee}
            onChange={e => setProjectFee(parseFloat(e.target.value) || 0)}
            className="h-9 rounded-lg border-2 text-sm font-bold"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Travel Expenses $</Label>
          <Input
            type="number" min="0"
            value={travelExpenses}
            onChange={e => setTravelExpenses(parseFloat(e.target.value) || 0)}
            className="h-9 rounded-lg border-2 text-sm font-bold"
          />
        </div>
      </div>

      {/* Total preview */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white">
        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Estimated Total</span>
        <span className="font-black font-mono">{formatCurrency(total)}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-[2] h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-1.5"
        >
          {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><Save className="w-3.5 h-3.5" /> Save Template</>}
        </Button>
      </div>
    </div>
  );
};

// ─── QUOTE TEMPLATES SHEET ────────────────────────────────────────────────────
// FIX: templates now load from Firestore tenants/{id}/quoteTemplates.
// Staff can create templates that match their actual business type (photography,
// catering, florals, beauty, etc.) rather than being stuck with hardcoded
// nail-studio presets that make no sense for other niches.
const QuoteTemplatesSheet = ({ open, onOpenChange, tenantId, firestore, clients }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  tenantId: string; firestore: any; clients: any[];
}) => {
  const router    = useRouter();
  const { toast } = useToast();
  const [templates,      setTemplates]      = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [creating,       setCreating]       = useState<string | null>(null);
  const [clientId,       setClientId]       = useState('');
  const [showNewForm,    setShowNewForm]     = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingId,     setDeletingId]     = useState<string | null>(null);

  // Load templates from Firestore on open
  useEffect(() => {
    if (!open || !firestore || !tenantId) return;
    setLoading(true);
    getDocs(collection(firestore, `tenants/${tenantId}/quoteTemplates`))
      .then(async snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // FIX: seed with a single generic template on first visit
        if (docs.length === 0) {
          const seedRef = doc(collection(firestore, `tenants/${tenantId}/quoteTemplates`));
          await setDoc(seedRef, { ...SEED_TEMPLATE, createdAt: new Date().toISOString() });
          setTemplates([{ id: seedRef.id, ...SEED_TEMPLATE }]);
        } else {
          setTemplates(docs);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, firestore, tenantId]);

  const handleUseTemplate = async (template: any) => {
    if (!firestore || !tenantId) return;
    setCreating(template.id);
    try {
      const ref = await addDoc(collection(firestore, `tenants/${tenantId}/quotes`), {
        eventName:      template.name,
        clientId:       clientId || null,
        status:         'draft',
        lineItems:      template.lineItems,
        projectFee:     template.projectFee,
        travelExpenses: template.travelExpenses,
        createdAt:      new Date().toISOString(),
        fromTemplate:   template.id,
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

  const handleSaveTemplate = async (data: any, existingId?: string) => {
    if (!firestore || !tenantId) return;
    setSavingTemplate(true);
    try {
      if (existingId) {
        await updateDoc(doc(firestore, `tenants/${tenantId}/quoteTemplates`, existingId), {
          ...data, updatedAt: new Date().toISOString(),
        });
        setTemplates(prev => prev.map(t => t.id === existingId ? { ...t, ...data } : t));
        toast({ title: 'Template updated' });
        setEditingId(null);
      } else {
        const ref = await addDoc(collection(firestore, `tenants/${tenantId}/quoteTemplates`), {
          ...data, createdAt: new Date().toISOString(),
        });
        setTemplates(prev => [...prev, { id: ref.id, ...data }]);
        toast({ title: 'Template created' });
        setShowNewForm(false);
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to save template' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!firestore || !tenantId) return;
    setDeletingId(templateId);
    try {
      await deleteDoc(doc(firestore, `tenants/${tenantId}/quoteTemplates`, templateId));
      setTemplates(prev => prev.filter(t => t.id !== templateId));
      toast({ title: 'Template deleted' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to delete template' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-8 pb-5 border-b text-left">
          <SheetTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> Quote Templates
          </SheetTitle>
          <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
            Your saved service packages — tailored to your business
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-5">

            {/* Client assignment */}
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

            {/* New template form */}
            {showNewForm ? (
              <TemplateEditor
                initial={SEED_TEMPLATE}
                onSave={(data) => handleSaveTemplate(data)}
                onCancel={() => setShowNewForm(false)}
                saving={savingTemplate}
              />
            ) : (
              <button
                onClick={() => setShowNewForm(true)}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl border-2 border-dashed border-primary/30 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/5 transition-colors"
              >
                <PlusCircle className="w-4 h-4" /> Create New Template
              </button>
            )}

            {/* Template list */}
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-10 border-4 border-dashed rounded-[2.5rem] opacity-30">
                <BookOpen className="w-8 h-8 mx-auto mb-2" />
                <p className="text-[10px] font-black uppercase tracking-widest">No templates yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map(t => {
                  const subtotal = t.lineItems?.reduce((a: number, i: any) => a + (i.price * i.quantity), 0) || 0;
                  const total = subtotal + (t.travelExpenses || 0) + subtotal * ((t.projectFee || 0) / 100);

                  if (editingId === t.id) {
                    return (
                      <TemplateEditor
                        key={t.id}
                        initial={t}
                        onSave={(data) => handleSaveTemplate(data, t.id)}
                        onCancel={() => setEditingId(null)}
                        saving={savingTemplate}
                      />
                    );
                  }

                  return (
                    <div key={t.id} className="rounded-2xl border-2 border-slate-200 bg-white overflow-hidden hover:border-primary/30 transition-all">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <p className="font-black text-sm text-slate-900 truncate">{t.name}</p>
                            {t.description && (
                              <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">{t.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <p className="font-black font-mono text-primary text-sm">{formatCurrency(total)}</p>
                            <button
                              onClick={() => setEditingId(t.id)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              disabled={deletingId === t.id}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                            >
                              {deletingId === t.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1 mb-3">
                          {t.lineItems?.map((li: any, i: number) => (
                            <div key={i} className="flex justify-between text-[10px] font-bold text-slate-500">
                              <span className="truncate">{li.name} ×{li.quantity}</span>
                              <span className="font-mono ml-2 shrink-0">{formatCurrency(li.price * li.quantity)}</span>
                            </div>
                          ))}
                        </div>
                        <Button
                          onClick={() => handleUseTemplate(t)}
                          disabled={!!creating}
                          className="w-full h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-2"
                        >
                          {creating === t.id
                            ? <Loader className="w-3.5 h-3.5 animate-spin" />
                            : <><Zap className="w-3.5 h-3.5" /> Use This Template</>
                          }
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

// ─── ANALYTICS TAB ────────────────────────────────────────────────────────────
const AnalyticsTab = ({ quotes, clients }: { quotes: any[]; clients: any[] }) => {
  const stats = useMemo(() => {
    const total    = quotes.length;
    const accepted = quotes.filter(q => q.status === 'accepted');
    const declined = quotes.filter(q => q.status === 'declined');
    const sent     = quotes.filter(q => ['sent', 'viewed', 'accepted', 'declined', 'expired'].includes(q.status));
    const acceptRate  = sent.length > 0 ? (accepted.length / sent.length) * 100 : 0;
    const avgValue    = accepted.length > 0 ? accepted.reduce((a, q) => a + calcTotal(q), 0) / accepted.length : 0;
    const totalRevenue = accepted.reduce((a, q) => a + calcTotal(q), 0);
    const viewedRate  = sent.length > 0 ? (quotes.filter(q => q.viewedAt).length / sent.length) * 100 : 0;
    const reasons: Record<string, number> = {};
    declined.forEach(q => { const r = q.declineReason || 'Not specified'; reasons[r] = (reasons[r] || 0) + 1; });
    const acceptTimes = accepted.filter(q => q.sentAt && q.acceptedAt)
      .map(q => (new Date(q.acceptedAt).getTime() - new Date(q.sentAt).getTime()) / (1000 * 60 * 60 * 24));
    const avgDaysToAccept = acceptTimes.length > 0 ? acceptTimes.reduce((a, b) => a + b, 0) / acceptTimes.length : 0;
    return { total, acceptRate, avgValue, totalRevenue, viewedRate, reasons, avgDaysToAccept, acceptedCount: accepted.length, declinedCount: declined.length };
  }, [quotes]);

  const monthlyData = useMemo(() => {
    const map: Record<string, { label: string; sent: number; accepted: number; revenue: number }> = {};
    quotes.forEach(q => {
      if (!q.createdAt) return;
      const key = format(parseISO(q.createdAt), 'yyyy-MM');
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
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Proposal Funnel</p>
          <div className="space-y-3">
            {[
              { label: 'Total Sent', value: quotes.filter(q => q.status !== 'draft').length, color: 'bg-blue-400',    pct: 100 },
              { label: 'Viewed',     value: quotes.filter(q => q.viewedAt).length,            color: 'bg-violet-400', pct: stats.viewedRate },
              { label: 'Accepted',   value: stats.acceptedCount,                               color: 'bg-green-400', pct: stats.acceptRate },
              { label: 'Declined',   value: stats.declinedCount,                               color: 'bg-red-300',   pct: quotes.filter(q => q.status !== 'draft').length > 0 ? (stats.declinedCount / quotes.filter(q => q.status !== 'draft').length) * 100 : 0 },
            ].map(row => (
              <div key={row.label} className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase text-slate-600">
                  <span>{row.label}</span><span className="font-mono">{row.value}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', row.color)} style={{ width: `${Math.min(row.pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

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

        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4 md:col-span-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Response Timing</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'View Rate',         value: `${stats.viewedRate.toFixed(0)}%`,       color: 'text-primary' },
              { label: 'Avg Days to Accept',value: stats.avgDaysToAccept.toFixed(1),        color: 'text-slate-900' },
              { label: 'Close Rate',        value: `${stats.acceptRate.toFixed(0)}%`,       color: 'text-green-600' },
            ].map(s => (
              <div key={s.label} className="text-center p-4 rounded-2xl bg-muted/5 border">
                <p className={cn('text-2xl font-black font-mono', s.color)}>{s.value}</p>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
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

  // FIX was in original: needsFollowUp boolean now correctly written
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

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 text-left">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Proposals</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Client quotes & event contracts</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button
              variant="outline"
              onClick={() => setTemplatesSheetOpen(true)}
              className="h-14 px-5 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] gap-2"
            >
              <BookOpen className="w-4 h-4" /> Templates
            </Button>
            <Button
              onClick={() => router.push('/quotes/new')}
              className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 flex-1 md:flex-none gap-2"
            >
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
            <div key={s.label} className={cn(
              'p-4 rounded-[2rem] border-2 bg-white shadow-sm text-left',
              s.label === 'Action Needed' && stats.needsAttention > 0 && 'border-orange-200 bg-orange-50'
            )}>
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
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-10 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md relative"
              >
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
                <Input
                  placeholder="Search by event or client..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-12 h-12 rounded-2xl border-2 font-bold bg-white"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full sm:w-52 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-xl">
                  {[
                    ['all',                'All Statuses'],
                    ['draft',              'Draft'],
                    ['sent',               'Sent'],
                    ['viewed',             'Viewed'],
                    ['revision_requested', 'Revision Requested'],
                    ['accepted',           'Accepted'],
                    ['declined',           'Declined'],
                    ['expired',            'Expired'],
                  ].map(([v, l]) => (
                    <SelectItem key={v} value={v} className="font-bold">{l}</SelectItem>
                  ))}
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

          <TabsContent value="inquiries" className="mt-0">
            {tenantId ? <InquiriesTab tenantId={tenantId} /> : <Loader className="animate-spin" />}
          </TabsContent>

          <TabsContent value="analytics" className="mt-0">
            <AnalyticsTab quotes={quotes || []} clients={clients || []} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Detail sheet */}
      <QuoteDetailSheet
        quote={selectedQuote} clients={clients || []} tenantId={tenantId || ''}
        firestore={firestore} open={sheetOpen} onOpenChange={setSheetOpen}
        onSend={q => setQuoteToSend(q)} onCopyLink={handleCopyLink}
        onDuplicate={handleDuplicate} onDelete={setQuoteToDelete}
        onConvert={q => setConvertDialogQuote(q)}
      />

      <SendQuoteDialog
        open={!!quoteToSend} onOpenChange={open => !open && setQuoteToSend(null)}
        quote={quoteToSend} onConfirm={handleSendConfirm}
      />

      <ConvertToEventDialog
        open={!!convertDialogQuote} onOpenChange={open => !open && setConvertDialogQuote(null)}
        quote={convertDialogQuote} clients={clients || []} tenantId={tenantId || ''} firestore={firestore}
      />

      {/* FIX: QuoteTemplatesSheet now loads from Firestore, not a hardcoded array */}
      <QuoteTemplatesSheet
        open={templatesSheetOpen} onOpenChange={setTemplatesSheetOpen}
        tenantId={tenantId || ''} firestore={firestore} clients={clients || []}
      />

      <AlertDialog open={!!quoteToDelete} onOpenChange={() => setQuoteToDelete(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
          <AlertDialogHeader className="p-8 pb-4">
            <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Delete Proposal</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600">
              Permanently delete "{quoteToDelete?.eventName}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="p-8 pt-0 flex flex-col gap-3">
            <Button
              onClick={() => quoteToDelete && handleDelete(quoteToDelete)}
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
            <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}