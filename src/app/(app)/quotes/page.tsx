'use client';

/**

- QUOTES DASHBOARD — FULL LIFECYCLE
- src/app/(app)/quotes/page.tsx
  */

import React, { useState, useMemo, useEffect } from ‘react’;
import { AppHeader } from ‘@/components/shared/AppHeader’;
import {
useFirebase, useCollection, useMemoFirebase,
addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking,
} from ‘@/firebase’;
import { collection, doc, getDocs } from ‘firebase/firestore’;
import { useTenant } from ‘@/context/TenantContext’;
import { useInventory } from ‘@/context/InventoryContext’;
import { format, parseISO, formatDistanceToNow, addDays, isPast, isValid } from ‘date-fns’;
import {
PlusCircle, Search, FileText, Copy, Trash2, Send,
CheckCircle2, XCircle, Clock, Calendar,
MoreHorizontal, Loader, LinkIcon, ExternalLink,
RefreshCw, Eye, Flag,
BarChart2,
Mail, Phone,
} from ‘lucide-react’;
import { Button } from ‘@/components/ui/button’;
import { Input } from ‘@/components/ui/input’;
import { Badge } from ‘@/components/ui/badge’;
import { Card, CardContent } from ‘@/components/ui/card’;
import {
DropdownMenu, DropdownMenuContent, DropdownMenuItem,
DropdownMenuSeparator, DropdownMenuTrigger,
} from ‘@/components/ui/dropdown-menu’;
import {
Dialog, DialogContent, DialogHeader, DialogTitle,
DialogDescription, DialogFooter,
} from ‘@/components/ui/dialog’;
import {
AlertDialog, AlertDialogCancel, AlertDialogContent,
AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from ‘@/components/ui/alert-dialog’;
import {
Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from ‘@/components/ui/sheet’;
import { Label } from ‘@/components/ui/label’;
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from ‘@/components/ui/select’;
import { Tabs, TabsContent, TabsList, TabsTrigger } from ‘@/components/ui/tabs’;
import { Separator } from ‘@/components/ui/separator’;
import { ScrollArea } from ‘@/components/ui/scroll-area’;
import { cn } from ‘@/lib/utils’;
import { useToast } from ‘@/hooks/use-toast’;
import { InquiriesTab } from ‘@/components/quotes/InquiriesTab’;

// ─── Safe date helpers ─────────────────────────────────────────────────────────
const safeParseISO = (dateStr: string | undefined | null): Date | null => {
if (!dateStr) return null;
try {
const d = parseISO(dateStr);
return isValid(d) ? d : null;
} catch {
return null;
}
};

const safeFormat = (dateStr: string | undefined | null, fmt: string, fallback = ‘—’): string => {
const d = safeParseISO(dateStr);
if (!d) return fallback;
try { return format(d, fmt); } catch { return fallback; }
};

const safeFormatDistance = (dateStr: string | undefined | null, fallback = ‘’): string => {
const d = safeParseISO(dateStr);
if (!d) return fallback;
try { return formatDistanceToNow(d, { addSuffix: true }); } catch { return fallback; }
};

const formatCurrency = (n: number) => `$${(n || 0).toFixed(2)}`;

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
draft:               { label: ‘Draft’,            color: ‘bg-slate-100 border-slate-200 text-slate-600’,    dot: ‘bg-slate-400’ },
sent:                { label: ‘Sent’,              color: ‘bg-blue-50 border-blue-100 text-blue-700’,         dot: ‘bg-blue-400’ },
viewed:              { label: ‘Viewed’,            color: ‘bg-violet-50 border-violet-100 text-violet-700’,   dot: ‘bg-violet-500 animate-pulse’ },
accepted:            { label: ‘Accepted’,          color: ‘bg-green-50 border-green-100 text-green-700’,      dot: ‘bg-green-500’ },
declined:            { label: ‘Declined’,          color: ‘bg-red-50 border-red-100 text-red-700’,            dot: ‘bg-red-400’ },
expired:             { label: ‘Expired’,           color: ‘bg-amber-50 border-amber-100 text-amber-700’,      dot: ‘bg-amber-400’ },
revision_requested:  { label: ‘Revision Req.’,     color: ‘bg-orange-50 border-orange-100 text-orange-700’,   dot: ‘bg-orange-400 animate-pulse’ },
};

// ─── Quote value calculator ────────────────────────────────────────────────────
const calcTotal = (quote: any): number => {
if (!quote) return 0;
const sub = (quote.lineItems || []).reduce((a: number, i: any) => a + ((i?.price || 0) * (i?.quantity || 1)), 0);
const fee = sub * ((quote.projectFee || 0) / 100);
return sub + (quote.travelExpenses || 0) + fee;
};

// ─── Safe expiry helpers ───────────────────────────────────────────────────────
const getExpiryDate = (quote: any): Date | null => {
if (!quote?.sentAt || !quote?.expiresInDays) return null;
const sentDate = safeParseISO(quote.sentAt);
if (!sentDate) return null;
try { return addDays(sentDate, quote.expiresInDays); } catch { return null; }
};

const isQuoteExpired = (quote: any): boolean => {
const expiry = getExpiryDate(quote);
return expiry ? isPast(expiry) : false;
};

const isQuoteExpiringSoon = (quote: any): boolean => {
if (![‘sent’, ‘viewed’].includes(quote?.status)) return false;
const expiry = getExpiryDate(quote);
if (!expiry || isPast(expiry)) return false;
try {
const warnDate = addDays(expiry, -3);
return isPast(warnDate);
} catch { return false; }
};

// ─── Quote Card ────────────────────────────────────────────────────────────────
const QuoteCard = ({
quote, clients, tenantId,
onCopyLink, onDelete, onDuplicate, onSend, onOpen, onMarkFollowUp,
}: {
quote: any; clients: any[]; tenantId: string;
onCopyLink: (q: any) => void; onDelete: (q: any) => void;
onDuplicate: (q: any) => void; onSend: (q: any) => void;
onOpen: (q: any) => void; onMarkFollowUp: (q: any) => void;
}) => {
const safeClients = Array.isArray(clients) ? clients : [];
const client = safeClients.find(c => c?.id === quote?.clientId);
const status = STATUS_CONFIG[quote?.status || ‘draft’] || STATUS_CONFIG.draft;
const total  = calcTotal(quote);
const needsFollowUp  = quote?.needsFollowUp && quote?.status === ‘declined’;
const hasRevision    = quote?.status === ‘revision_requested’;
const expiringSoon   = isQuoteExpiringSoon(quote);

```
return (
    <Card
        className={cn(
            'border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white hover:shadow-md transition-all cursor-pointer group',
            hasRevision && 'border-orange-200 ring-2 ring-orange-100',
            needsFollowUp && 'border-red-100',
            expiringSoon && 'border-amber-200',
        )}
        onClick={() => onOpen(quote)}
    >
        <CardContent className="p-5 space-y-4">
            {/* Top row */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">
                            {quote?.eventName || 'Untitled'}
                        </p>
                        {hasRevision && <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />}
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
                        <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1 w-48">
                            <DropdownMenuItem onClick={() => onOpen(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                                <Eye className="w-3.5 h-3.5 mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onCopyLink(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                                <LinkIcon className="w-3.5 h-3.5 mr-2" /> Copy Client Link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => window.open(`/quote/${tenantId}/${quote?.id}`, '_blank')} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10">
                                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Preview
                            </DropdownMenuItem>
                            {quote?.status === 'draft' && (
                                <DropdownMenuItem onClick={() => onSend(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 text-primary">
                                    <Send className="w-3.5 h-3.5 mr-2" /> Send to Client
                                </DropdownMenuItem>
                            )}
                            {quote?.status === 'declined' && (
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
                {quote?.eventDate && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                        <Calendar className="w-3 h-3 opacity-40" />
                        {safeFormat(`${quote.eventDate}T12:00:00`, 'MMM d, yyyy')}
                    </div>
                )}
                {quote?.viewedAt && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-violet-500 uppercase">
                        <Eye className="w-3 h-3" />
                        Viewed {safeFormatDistance(quote.viewedAt)}
                    </div>
                )}
                {expiringSoon && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 uppercase">
                        <Clock className="w-3 h-3" /> Expiring soon
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
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-dashed">
                <p className="font-black font-mono text-lg text-primary">{formatCurrency(total)}</p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase">
                    {safeFormatDistance(quote?.createdAt)}
                </p>
            </div>
        </CardContent>
    </Card>
);
```

};

// ─── Quote detail sheet ────────────────────────────────────────────────────────
const QuoteDetailSheet = ({
quote, clients, tenantId, open, onOpenChange,
onSend, onCopyLink, onDuplicate, onDelete,
}: {
quote: any; clients: any[]; tenantId: string;
open: boolean; onOpenChange: (v: boolean) => void;
onSend: (q: any) => void; onCopyLink: (q: any) => void;
onDuplicate: (q: any) => void; onDelete: (q: any) => void;
}) => {
const [revisions,        setRevisions]       = useState<any[]>([]);
const [loadingRevisions, setLoadingRevisions] = useState(false);
const { firestore } = useFirebase();

```
useEffect(() => {
    if (!open || !quote?.id || !firestore || !tenantId) return;
    setLoadingRevisions(true);
    getDocs(collection(firestore, `tenants/${tenantId}/quotes/${quote.id}/revisions`))
        .then(snap => setRevisions(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
        .catch(err => { console.error('Failed to load revisions:', err); setRevisions([]); })
        .finally(() => setLoadingRevisions(false));
}, [open, quote?.id, firestore, tenantId]);

if (!quote) return null;

const safeClients = Array.isArray(clients) ? clients : [];
const client = safeClients.find(c => c?.id === quote?.clientId);
const total  = calcTotal(quote);
const status = STATUS_CONFIG[quote?.status || 'draft'] || STATUS_CONFIG.draft;

const timelineEvents = [
    { label: 'Created',    date: quote.createdAt,            icon: FileText },
    { label: 'Sent',       date: quote.sentAt,               icon: Send },
    { label: 'Viewed',     date: quote.viewedAt,             icon: Eye },
    { label: 'Revision',   date: quote.revisionRequestedAt,  icon: RefreshCw },
    { label: 'Accepted',   date: quote.acceptedAt,           icon: CheckCircle2 },
    { label: 'Declined',   date: quote.declinedAt,           icon: XCircle },
    { label: 'Expired',    date: quote.expiredAt,            icon: Clock },
].filter(e => !!safeParseISO(e.date));

return (
    <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col border-l-0 sm:border-l">
            <SheetHeader className="p-8 pb-5 border-b bg-muted/5 flex-shrink-0 text-left">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                        <SheetTitle className="text-2xl font-black uppercase tracking-tighter leading-none">
                            {quote?.eventName || 'Untitled Quote'}
                        </SheetTitle>
                        <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                            {client?.name || 'Unknown Client'}
                        </SheetDescription>
                    </div>
                    <Badge variant="outline" className={cn('h-7 px-3 font-black text-[9px] uppercase tracking-widest border flex items-center gap-1.5 shrink-0', status.color)}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                        {status.label}
                    </Badge>
                </div>
            </SheetHeader>

            <ScrollArea className="flex-1 min-h-0">
                <div className="p-8 space-y-8 text-left">

                    {/* Timeline */}
                    {timelineEvents.length > 0 && (
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Status Timeline</p>
                            <div className="space-y-2">
                                {timelineEvents.map((event, i) => {
                                    const Icon = event.icon;
                                    const parsed = safeParseISO(event.date)!;
                                    return (
                                        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted/5 border">
                                            <Icon className="w-4 h-4 text-primary/40 shrink-0" />
                                            <div className="flex-1">
                                                <p className="font-black text-xs uppercase tracking-widest text-slate-700">{event.label}</p>
                                            </div>
                                            <p className="text-[10px] font-bold text-muted-foreground">
                                                {format(parsed, 'MMM d, yyyy · h:mm a')}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <Separator className="border-dashed" />

                    {/* Decline reason */}
                    {quote?.declineReason && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Decline Reason</p>
                            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-100">
                                <p className="font-black text-sm text-red-800">{quote.declineReason}</p>
                                {quote?.declineNote && <p className="text-[11px] font-medium text-red-600 mt-1">{quote.declineNote}</p>}
                            </div>
                        </div>
                    )}

                    {/* Revision requests */}
                    {(revisions.length > 0 || loadingRevisions) && (
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Revision Requests</p>
                            {loadingRevisions ? (
                                <div className="flex justify-center p-4"><Loader className="w-5 h-5 animate-spin text-primary" /></div>
                            ) : revisions.map(rev => {
                                const revDate = safeParseISO(rev?.requestedAt);
                                return (
                                    <div key={rev.id} className="p-4 rounded-2xl border-2 border-orange-100 bg-orange-50 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                                                {revDate ? format(revDate, 'MMM d, yyyy · h:mm a') : '—'}
                                            </p>
                                            <Badge variant="outline" className="h-5 px-2 text-[8px] font-black border-orange-200 text-orange-600">
                                                {rev?.status || 'pending'}
                                            </Badge>
                                        </div>
                                        <p className="font-medium text-sm text-orange-900 leading-relaxed">{rev?.message}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <Separator className="border-dashed" />

                    {/* Line items */}
                    <div className="space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Services</p>
                        <div className="space-y-2">
                            {(quote?.lineItems || []).map((item: any, i: number) => (
                                <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-muted/5 border">
                                    <div>
                                        <p className="font-black text-sm uppercase text-slate-900">{item?.name || '—'}</p>
                                        <p className="text-[10px] font-bold text-muted-foreground">{item?.quantity || 1} × {formatCurrency(item?.price || 0)}</p>
                                    </div>
                                    <p className="font-black font-mono text-sm">{formatCurrency((item?.price || 0) * (item?.quantity || 1))}</p>
                                </div>
                            ))}
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
                                    {client?.email && (
                                        <a href={`mailto:${client.email}`} className="flex items-center gap-3 p-3 rounded-xl border bg-white hover:border-primary/20 transition-all">
                                            <Mail className="w-4 h-4 text-primary/40" />
                                            <span className="font-bold text-sm">{client.email}</span>
                                        </a>
                                    )}
                                    {client?.phone && (
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
                {quote?.status === 'draft' && (
                    <Button onClick={() => { onSend(quote); onOpenChange(false); }} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                        <Send className="mr-2 h-3.5 w-3.5" /> Send to Client
                    </Button>
                )}
                <div className="flex gap-3">
                    <Button variant="outline" onClick={() => onCopyLink(quote)} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                        <LinkIcon className="mr-1.5 h-3.5 w-3.5" /> Copy Link
                    </Button>
                    <Button variant="outline" onClick={() => window.open(`/quote/${tenantId}/${quote?.id}`, '_blank')} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Preview
                    </Button>
                </div>
            </div>
        </SheetContent>
    </Sheet>
);
```

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
Configure expiry and share the link with {quote?.eventName || ‘the client’}.
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
<p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Next steps</p>
<p className="text-[11px] font-bold text-blue-600 leading-relaxed">
After sending, copy the client link and share it via text, email, or DM.
You’ll be notified when they view and respond.
</p>
</div>
</div>
<DialogFooter className="px-8 pb-8 flex gap-3">
<Button variant=“ghost” onClick={() => onOpenChange(false)} className=“flex-1 h-12 font-black uppercase text-[10px] tracking-widest”>Cancel</Button>
<Button onClick={() => onConfirm(expiryDays)} className=“flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20”>
<Send className="mr-2 h-4 w-4" /> Mark as Sent
</Button>
</DialogFooter>
</DialogContent>
</Dialog>
);
};

// ─── Analytics tab ─────────────────────────────────────────────────────────────
const AnalyticsTab = ({ quotes, clients }: { quotes: any[]; clients: any[] }) => {
const safeQuotes = Array.isArray(quotes) ? quotes : [];

```
const stats = useMemo(() => {
    const total      = safeQuotes.length;
    const accepted   = safeQuotes.filter(q => q?.status === 'accepted');
    const declined   = safeQuotes.filter(q => q?.status === 'declined');
    const sent       = safeQuotes.filter(q => ['sent', 'viewed', 'accepted', 'declined', 'expired'].includes(q?.status));
    const acceptRate = sent.length > 0 ? (accepted.length / sent.length) * 100 : 0;
    const avgValue   = accepted.length > 0
        ? accepted.reduce((a, q) => a + calcTotal(q), 0) / accepted.length : 0;
    const totalRevenue   = accepted.reduce((a, q) => a + calcTotal(q), 0);
    const viewedCount    = safeQuotes.filter(q => !!q?.viewedAt).length;
    const viewedRate     = sent.length > 0 ? (viewedCount / sent.length) * 100 : 0;

    const reasons: Record<string, number> = {};
    declined.forEach(q => {
        const r = q?.declineReason || 'Not specified';
        reasons[r] = (reasons[r] || 0) + 1;
    });

    const acceptTimes = accepted
        .filter(q => q?.sentAt && q?.acceptedAt)
        .map(q => {
            const sent = safeParseISO(q.sentAt);
            const acc  = safeParseISO(q.acceptedAt);
            if (!sent || !acc) return null;
            return (acc.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
        })
        .filter((n): n is number => n !== null);

    const avgDaysToAccept = acceptTimes.length > 0
        ? acceptTimes.reduce((a, b) => a + b, 0) / acceptTimes.length : 0;

    return { total, acceptRate, avgValue, totalRevenue, viewedRate, reasons, avgDaysToAccept, acceptedCount: accepted.length, declinedCount: declined.length };
}, [safeQuotes]);

const sentCount = safeQuotes.filter(q => q?.status !== 'draft').length;

return (
    <div className="space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
                { label: 'Total Quotes',    value: stats.total,                           color: '' },
                { label: 'Acceptance Rate', value: `${stats.acceptRate.toFixed(0)}%`,     color: stats.acceptRate >= 50 ? 'text-green-600' : 'text-amber-600' },
                { label: 'Avg Quote Value', value: `$${stats.avgValue.toFixed(0)}`,       color: 'text-primary' },
                { label: 'Total Revenue',   value: `$${stats.totalRevenue.toFixed(0)}`,   color: 'text-green-600' },
            ].map(s => (
                <div key={s.label} className="p-5 rounded-[2rem] border-2 bg-white shadow-sm text-left">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</p>
                    <p className={cn('text-2xl font-black mt-1', s.color || 'text-slate-900')}>{s.value}</p>
                </div>
            ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Funnel */}
            <div className="p-6 rounded-[2rem] border-2 bg-white shadow-sm space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Proposal Funnel</p>
                <div className="space-y-3">
                    {[
                        { label: 'Total Sent', value: sentCount,                                     color: 'bg-blue-400',   pct: 100 },
                        { label: 'Viewed',     value: safeQuotes.filter(q => q?.viewedAt).length,   color: 'bg-violet-400', pct: stats.viewedRate },
                        { label: 'Accepted',   value: stats.acceptedCount,                           color: 'bg-green-400',  pct: stats.acceptRate },
                        { label: 'Declined',   value: stats.declinedCount,                           color: 'bg-red-300',    pct: sentCount > 0 ? (stats.declinedCount / sentCount) * 100 : 0 },
                    ].map(row => (
                        <div key={row.label} className="space-y-1">
                            <div className="flex justify-between text-[10px] font-black uppercase text-slate-600">
                                <span>{row.label}</span>
                                <span className="font-mono">{row.value}</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div className={cn('h-full rounded-full transition-all', row.color)} style={{ width: `${Math.min(Math.max(row.pct, 0), 100)}%` }} />
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
```

};

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function QuotesPage() {
const { firestore } = useFirebase();
const { selectedTenant } = useTenant();
const { clients } = useInventory();
const { toast } = useToast();
const tenantId = selectedTenant?.id;

```
const safeClients = Array.isArray(clients) ? clients : [];

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
const newInquiryCount = (quoteRequests || []).filter(r => r?.status === 'new' || !r?.viewed).length;

const [search,        setSearch]        = useState('');
const [statusFilter,  setStatusFilter]  = useState('all');
const [activeTab,     setActiveTab]     = useState('quotes');
const [selectedQuote, setSelectedQuote] = useState<any>(null);
const [sheetOpen,     setSheetOpen]     = useState(false);
const [quoteToDelete, setQuoteToDelete] = useState<any>(null);
const [quoteToSend,   setQuoteToSend]   = useState<any>(null);

// ── Auto-expire on load ────────────────────────────────────────────────────
useEffect(() => {
    if (!quotes || !firestore || !tenantId) return;
    quotes.forEach(q => {
        if (!q?.id) return;
        if (!['sent', 'viewed'].includes(q?.status)) return;
        if (!q?.expiresInDays || !q?.sentAt) return;
        if (isQuoteExpired(q)) {
            updateDocumentNonBlocking(
                doc(firestore, `tenants/${tenantId}/quotes`, q.id),
                { status: 'expired', expiredAt: new Date().toISOString() }
            );
        }
    });
}, [quotes, firestore, tenantId]);

const safeQuotes = Array.isArray(quotes) ? quotes : [];

const filtered = useMemo(() => {
    return safeQuotes
        .filter(q => {
            if (!q) return false;
            const clientName = safeClients.find(c => c?.id === q?.clientId)?.name || '';
            const matchSearch = !search ||
                (q?.eventName || '').toLowerCase().includes(search.toLowerCase()) ||
                clientName.toLowerCase().includes(search.toLowerCase());
            const matchStatus = statusFilter === 'all' || q?.status === statusFilter;
            return matchSearch && matchStatus;
        })
        .sort((a, b) => ((b?.createdAt || '').localeCompare(a?.createdAt || '')));
}, [safeQuotes, search, statusFilter, safeClients]);

const stats = useMemo(() => {
    return {
        total:          safeQuotes.length,
        accepted:       safeQuotes.filter(q => q?.status === 'accepted').length,
        pending:        safeQuotes.filter(q => ['sent', 'viewed'].includes(q?.status)).length,
        value:          safeQuotes.filter(q => q?.status === 'accepted').reduce((a, q) => a + calcTotal(q), 0),
        needsAttention: safeQuotes.filter(q => q?.status === 'revision_requested' || (q?.needsFollowUp && q?.status === 'declined')).length,
    };
}, [safeQuotes]);

const handleSendConfirm = (expiryDays: number) => {
    if (!quoteToSend?.id || !firestore || !tenantId) return;
    updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/quotes`, quoteToSend.id),
        { status: 'sent', sentAt: new Date().toISOString(), expiresInDays: expiryDays }
    );
    const link = `${window.location.origin}/quote/${tenantId}/${quoteToSend.id}`;
    navigator.clipboard.writeText(link).catch(console.error);
    setQuoteToSend(null);
    toast({ title: 'Quote Sent', description: 'Link copied to clipboard.' });
};

const handleDelete = (quote: any) => {
    if (!quote?.id || !firestore || !tenantId) return;
    deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/quotes`, quote.id));
    setQuoteToDelete(null);
    toast({ title: 'Quote Deleted' });
};

const handleCopyLink = (quote: any) => {
    if (!quote?.id || !tenantId) return;
    navigator.clipboard.writeText(`${window.location.origin}/quote/${tenantId}/${quote.id}`)
        .catch(console.error);
    toast({ title: 'Link Copied', description: 'Paste it anywhere to share with the client.' });
};

const handleDuplicate = (quote: any) => {
    if (!quote || !firestore || !tenantId) return;
    const { id, status, sentAt, viewedAt, acceptedAt, declinedAt, expiredAt, locked, ...rest } = quote;
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/quotes`), {
        ...rest,
        eventName: `${quote?.eventName || 'Untitled'} (Copy)`,
        status:    'draft',
        createdAt: new Date().toISOString(),
    });
    toast({ title: 'Duplicated' });
};

const handleMarkFollowUp = (quote: any) => {
    if (!quote?.id || !firestore || !tenantId) return;
    updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/quotes`, quote.id),
        { followUpScheduled: new Date().toISOString() }
    );
    toast({ title: 'Follow-up Flagged', description: 'Marked for outreach.' });
};

const handleOpen = (quote: any) => {
    if (!quote) return;
    setSelectedQuote(quote);
    setSheetOpen(true);
};

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
                <Button
                    onClick={() => window.location.href = '/quotes/new'}
                    className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto"
                >
                    <PlusCircle className="mr-2 h-4 w-4" /> New Proposal
                </Button>
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
                            {(tab.badge ?? 0) > 0 && (
                                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-violet-500 text-white text-[9px] font-black flex items-center justify-center">
                                    {tab.badge}
                                </span>
                            )}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {/* ── Quotes ── */}
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
                                    key={q?.id || Math.random()}
                                    quote={q}
                                    clients={safeClients}
                                    tenantId={tenantId || ''}
                                    onCopyLink={handleCopyLink}
                                    onDelete={setQuoteToDelete}
                                    onDuplicate={handleDuplicate}
                                    onSend={q => setQuoteToSend(q)}
                                    onOpen={handleOpen}
                                    onMarkFollowUp={handleMarkFollowUp}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── Inquiries ── */}
                <TabsContent value="inquiries" className="mt-0">
                    {tenantId ? <InquiriesTab tenantId={tenantId} /> : <Loader className="animate-spin" />}
                </TabsContent>

                {/* ── Analytics ── */}
                <TabsContent value="analytics" className="mt-0">
                    <AnalyticsTab quotes={safeQuotes} clients={safeClients} />
                </TabsContent>
            </Tabs>
        </main>

        {/* Detail sheet */}
        <QuoteDetailSheet
            quote={selectedQuote}
            clients={safeClients}
            tenantId={tenantId || ''}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            onSend={q => setQuoteToSend(q)}
            onCopyLink={handleCopyLink}
            onDuplicate={handleDuplicate}
            onDelete={setQuoteToDelete}
        />

        {/* Send dialog */}
        <SendQuoteDialog
            open={!!quoteToSend}
            onOpenChange={open => { if (!open) setQuoteToSend(null); }}
            quote={quoteToSend}
            onConfirm={handleSendConfirm}
        />

        {/* Delete confirmation */}
        <AlertDialog open={!!quoteToDelete} onOpenChange={() => setQuoteToDelete(null)}>
            <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                <AlertDialogHeader className="p-8 pb-4">
                    <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Delete Proposal</AlertDialogTitle>
                    <AlertDialogDescription className="font-bold text-sm text-slate-600">
                        Permanently delete &quot;{quoteToDelete?.eventName}&quot;? This cannot be undone.
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
```

}