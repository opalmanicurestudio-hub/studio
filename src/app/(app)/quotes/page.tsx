'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { type Quote, type Client } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';
import {
    PlusCircle, Search, FileText, Copy, Trash2, Eye, Send,
    CheckCircle2, XCircle, Clock, DollarSign, Calendar, MapPin,
    MoreHorizontal, Users, TrendingUp, Loader, Link as LinkIcon,
    ExternalLink,
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
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    draft:    { label: 'Draft',    color: 'bg-slate-100 border-slate-200 text-slate-600',   icon: <Clock className="w-3 h-3" /> },
    sent:     { label: 'Sent',     color: 'bg-blue-50 border-blue-100 text-blue-700',        icon: <Send className="w-3 h-3" /> },
    accepted: { label: 'Accepted', color: 'bg-green-50 border-green-100 text-green-700',     icon: <CheckCircle2 className="w-3 h-3" /> },
    declined: { label: 'Declined', color: 'bg-red-50 border-red-100 text-red-700',           icon: <XCircle className="w-3 h-3" /> },
    expired:  { label: 'Expired',  color: 'bg-amber-50 border-amber-100 text-amber-700',     icon: <Clock className="w-3 h-3" /> },
};

// ─── Quote Card ───────────────────────────────────────────────────────────────
const QuoteCard = ({
    quote, clients, tenantId,
    onCopyLink, onDelete, onDuplicate, onMarkSent,
}: {
    quote: Quote;
    clients: Client[];
    tenantId: string;
    onCopyLink: (q: Quote) => void;
    onDelete: (q: Quote) => void;
    onDuplicate: (q: Quote) => void;
    onMarkSent: (q: Quote) => void;
}) => {
    const client = clients.find(c => c.id === quote.clientId);
    const status = STATUS_CONFIG[quote.status || 'draft'] || STATUS_CONFIG.draft;
    const subtotal = quote.lineItems?.reduce((a, i) => a + (i.price || 0) * (i.quantity || 1), 0) || 0;
    const projectFee = subtotal * ((quote.projectFee || 0) / 100);
    const total = subtotal + (quote.travelExpenses || 0) + projectFee;

    return (
        <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white hover:shadow-md hover:border-primary/20 transition-all group">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 text-left min-w-0">
                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">
                            {quote.eventName || 'Untitled Quote'}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {client?.name || 'Unknown Client'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={cn('h-6 px-2 font-black text-[9px] uppercase tracking-widest border flex items-center gap-1', status.color)}>
                            {status.icon} {status.label}
                        </Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                                <DropdownMenuItem onClick={() => onCopyLink(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 px-3">
                                    <LinkIcon className="w-3.5 h-3.5 mr-2" /> Copy Client Link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => window.open(`/quote/${tenantId}/${quote.id}`, '_blank')} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 px-3">
                                    <ExternalLink className="w-3.5 h-3.5 mr-2" /> Preview Quote
                                </DropdownMenuItem>
                                {quote.status === 'draft' && (
                                    <DropdownMenuItem onClick={() => onMarkSent(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 px-3">
                                        <Send className="w-3.5 h-3.5 mr-2" /> Mark as Sent
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => onDuplicate(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 px-3">
                                    <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onDelete(quote)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-10 px-3 text-destructive">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <div className="space-y-1.5 text-left">
                    {quote.eventDate && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                            <Calendar className="w-3 h-3 opacity-40" />
                            {format(parseISO(quote.eventDate), 'MMM d, yyyy')}
                        </div>
                    )}
                    {quote.eventLocation && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase truncate">
                            <MapPin className="w-3 h-3 opacity-40 shrink-0" />
                            <span className="truncate">{typeof quote.eventLocation === 'string' ? quote.eventLocation : 'On-site'}</span>
                        </div>
                    )}
                    {quote.estimatedGuests && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                            <Users className="w-3 h-3 opacity-40" />
                            {quote.estimatedGuests} guests
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-dashed">
                    <div className="text-left">
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Total Value</p>
                        <p className="font-black font-mono text-lg text-primary">${total.toFixed(2)}</p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                        onClick={() => onCopyLink(quote)}
                    >
                        <LinkIcon className="w-3 h-3 mr-1.5" /> Share
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

// ─── New Quote Dialog ─────────────────────────────────────────────────────────
const NewQuoteDialog = ({
    open, onOpenChange, clients, onSave,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    clients: Client[];
    onSave: (data: Omit<Quote, 'id'>) => void;
}) => {
    const [clientId, setClientId]         = useState('');
    const [eventName, setEventName]       = useState('');
    const [eventDate, setEventDate]       = useState('');
    const [eventLocation, setEventLocation] = useState('');
    const [estimatedGuests, setEstimatedGuests] = useState('');
    const [depositAmount, setDepositAmount] = useState('');
    const [travelExpenses, setTravelExpenses] = useState('');
    const [projectFee, setProjectFee]     = useState('');
    const [notes, setNotes]               = useState('');
    const [items, setItems]               = useState([{ name: '', quantity: 1, price: 0 }]);

    const addItem = () => setItems(p => [...p, { name: '', quantity: 1, price: 0 }]);
    const updateItem = (i: number, k: string, v: any) =>
        setItems(p => p.map((item, idx) => idx === i ? { ...item, [k]: v } : item));
    const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));

    const subtotal = items.reduce((a, i) => a + (i.price || 0) * (i.quantity || 1), 0);
    const feeAmt   = subtotal * ((parseFloat(projectFee) || 0) / 100);
    const total    = subtotal + (parseFloat(travelExpenses) || 0) + feeAmt;

    const handleSave = () => {
        onSave({
            clientId,
            eventName,
            eventDate: eventDate || '',
            eventLocation,
            estimatedGuests: parseInt(estimatedGuests) || 0,
            depositAmount: parseFloat(depositAmount) || 0,
            travelExpenses: parseFloat(travelExpenses) || 0,
            projectFee: parseFloat(projectFee) || 0,
            notes,
            lineItems: items.filter(i => i.name.trim()),
            status: 'draft',
            createdAt: new Date().toISOString(),
        } as any);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl max-h-[90dvh] flex flex-col">
                <DialogHeader className="p-8 pb-0 text-left flex-shrink-0">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter">New Proposal</DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Build a client-facing quote</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 min-h-0">
                    <div className="p-8 space-y-6">
                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Client</Label>
                            <Select value={clientId} onValueChange={setClientId}>
                                <SelectTrigger className="h-12 rounded-2xl border-2 font-bold">
                                    <SelectValue placeholder="Select client..." />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-xl">
                                    {clients.map(c => (
                                        <SelectItem key={c.id} value={c.id} className="font-bold">{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Event Name</Label>
                            <Input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. Bridal Party — June Wedding" className="h-12 rounded-2xl border-2 font-bold" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Event Date</Label>
                                <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="h-12 rounded-2xl border-2 font-bold" />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Est. Guests</Label>
                                <Input type="number" value={estimatedGuests} onChange={e => setEstimatedGuests(e.target.value)} placeholder="0" className="h-12 rounded-2xl border-2 font-bold" />
                            </div>
                        </div>

                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Location</Label>
                            <Input value={eventLocation} onChange={e => setEventLocation(e.target.value)} placeholder="Venue or address" className="h-12 rounded-2xl border-2 font-bold" />
                        </div>

                        <div className="space-y-3 text-left">
                            <div className="flex items-center justify-between">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Line Items</Label>
                                <Button variant="outline" size="sm" onClick={addItem} className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                                    <PlusCircle className="w-3 h-3 mr-1" /> Add
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {items.map((item, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                                        <Input value={item.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="Service description" className="h-10 rounded-xl border-2 text-sm font-bold" />
                                        <Input type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)} className="h-10 rounded-xl border-2 w-16 text-center font-black" />
                                        <div className="relative w-24">
                                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                                            <Input type="number" value={item.price || ''} onChange={e => updateItem(i, 'price', parseFloat(e.target.value) || 0)} placeholder="0" className="h-10 pl-6 rounded-xl border-2 font-black font-mono text-right text-sm" />
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => removeItem(i)} className="h-10 w-10 rounded-xl text-destructive/40 hover:text-destructive">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Travel ($)</Label>
                                <Input type="number" value={travelExpenses} onChange={e => setTravelExpenses(e.target.value)} placeholder="0" className="h-10 rounded-xl border-2 font-black" />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Project Fee (%)</Label>
                                <Input type="number" value={projectFee} onChange={e => setProjectFee(e.target.value)} placeholder="0" className="h-10 rounded-xl border-2 font-black" />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Deposit ($)</Label>
                                <Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="0" className="h-10 rounded-xl border-2 font-black" />
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-900 text-white flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Total</span>
                            <span className="text-2xl font-black font-mono">${total.toFixed(2)}</span>
                        </div>

                        <div className="space-y-2 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Internal Notes</Label>
                            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes visible only to you..." className="rounded-2xl border-2 bg-muted/5" rows={3} />
                        </div>
                    </div>
                </ScrollArea>
                <DialogFooter className="p-8 pt-0 border-t bg-muted/5 flex-shrink-0">
                    <div className="flex gap-3 w-full">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 font-black uppercase tracking-widest text-[10px]">Cancel</Button>
                        <Button onClick={handleSave} disabled={!clientId || !eventName} className="flex-[2] h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20">
                            Save Draft
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function QuotesPage() {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const { clients } = useInventory();
    const { toast } = useToast();
    const tenantId = selectedTenant?.id;

    const quotesQ = useMemoFirebase(
        () => tenantId ? collection(firestore, `tenants/${tenantId}/quotes`) : null,
        [firestore, tenantId]
    );
    const { data: quotes, isLoading } = useCollection<Quote>(quotesQ);

    const [search, setSearch]             = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [isNewOpen, setIsNewOpen]       = useState(false);
    const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);

    const filtered = useMemo(() => {
        if (!quotes) return [];
        return quotes.filter(q => {
            const matchesSearch = !search ||
                (q.eventName || '').toLowerCase().includes(search.toLowerCase()) ||
                (clients.find(c => c.id === q.clientId)?.name || '').toLowerCase().includes(search.toLowerCase());
            const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
            return matchesSearch && matchesStatus;
        }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, [quotes, search, statusFilter, clients]);

    const stats = useMemo(() => {
        if (!quotes) return { total: 0, accepted: 0, pending: 0, value: 0 };
        const accepted = quotes.filter(q => q.status === 'accepted');
        const pending  = quotes.filter(q => q.status === 'sent');
        const value    = accepted.reduce((a, q) => {
            const sub = q.lineItems?.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0) || 0;
            return a + sub + (q.travelExpenses || 0) + sub * ((q.projectFee || 0) / 100);
        }, 0);
        return { total: quotes.length, accepted: accepted.length, pending: pending.length, value };
    }, [quotes]);

    const handleSaveQuote = (data: Omit<Quote, 'id'>) => {
        if (!firestore || !tenantId) return;
        const id = nanoid();
        const ref = doc(firestore, `tenants/${tenantId}/quotes`, id);
        addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/quotes`), { ...data, id });
        toast({ title: "Quote Created", description: "Draft saved. Share the link when ready." });
    };

    const handleCopyLink = (quote: Quote) => {
        const url = `${window.location.origin}/quote/${tenantId}/${quote.id}`;
        navigator.clipboard.writeText(url);
        toast({ title: "Link Copied", description: "Client link copied to clipboard." });
    };

    const handleDelete = (quote: Quote) => {
        if (!firestore || !tenantId) return;
        deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/quotes`, quote.id));
        setQuoteToDelete(null);
        toast({ title: "Quote Deleted" });
    };

    const handleDuplicate = (quote: Quote) => {
        if (!firestore || !tenantId) return;
        const { id, status, acceptedAt, declinedAt, ...rest } = quote as any;
        addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/quotes`), {
            ...rest,
            eventName: `${quote.eventName} (Copy)`,
            status: 'draft',
            createdAt: new Date().toISOString(),
        });
        toast({ title: "Quote Duplicated" });
    };

    const handleMarkSent = (quote: Quote) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/quotes`, quote.id), { status: 'sent', sentAt: new Date().toISOString() });
        toast({ title: "Marked as Sent" });
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
            <AppHeader title="Quotes" />
            <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto">

                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 text-left">
                    <div className="space-y-1">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Proposals</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Client quotes & event contracts</p>
                    </div>
                    <Button onClick={() => setIsNewOpen(true)} className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
                        <PlusCircle className="mr-2 h-4 w-4" /> New Proposal
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total Quotes',   value: stats.total,              mono: false },
                        { label: 'Accepted',        value: stats.accepted,           mono: false },
                        { label: 'Awaiting Reply',  value: stats.pending,            mono: false },
                        { label: 'Accepted Value',  value: `$${stats.value.toFixed(2)}`, mono: true },
                    ].map(s => (
                        <div key={s.label} className="p-5 rounded-[2rem] border-2 bg-white shadow-sm text-left">
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</p>
                            <p className={cn("text-2xl font-black mt-1 text-slate-900", s.mono && "font-mono text-primary")}>{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                        <Input
                            placeholder="SEARCH BY EVENT OR CLIENT..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-12 h-12 rounded-2xl border-2 font-black uppercase text-xs tracking-widest bg-white"
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full sm:w-44 bg-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-2 shadow-xl">
                            <SelectItem value="all" className="font-bold">All Statuses</SelectItem>
                            <SelectItem value="draft" className="font-bold">Draft</SelectItem>
                            <SelectItem value="sent" className="font-bold">Sent</SelectItem>
                            <SelectItem value="accepted" className="font-bold">Accepted</SelectItem>
                            <SelectItem value="declined" className="font-bold">Declined</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Grid */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <Loader className="w-8 h-8 animate-spin text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Loading Proposals...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-24 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                        <FileText className="w-16 h-16" />
                        <div className="space-y-2">
                            <p className="font-black uppercase tracking-widest text-sm">No Proposals Found</p>
                            <p className="text-xs font-bold uppercase tracking-widest">Create your first proposal to get started</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {filtered.map(q => (
                            <QuoteCard
                                key={q.id}
                                quote={q}
                                clients={clients || []}
                                tenantId={tenantId || ''}
                                onCopyLink={handleCopyLink}
                                onDelete={setQuoteToDelete}
                                onDuplicate={handleDuplicate}
                                onMarkSent={handleMarkSent}
                            />
                        ))}
                    </div>
                )}
            </main>

            <NewQuoteDialog
                open={isNewOpen}
                onOpenChange={setIsNewOpen}
                clients={clients || []}
                onSave={handleSaveQuote}
            />

            <AlertDialog open={!!quoteToDelete} onOpenChange={() => setQuoteToDelete(null)}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0">
                        <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Delete Proposal</AlertDialogTitle>
                        <AlertDialogDescription className="font-bold text-sm text-slate-600 uppercase">
                            Permanently delete &quot;{quoteToDelete?.eventName}&quot;? This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={() => quoteToDelete && handleDelete(quoteToDelete)} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90">
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