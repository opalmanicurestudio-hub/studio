'use client';

/**
 * EventQuotePanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this inside the Event Manifest page to connect a quote to an event,
 * build out the cost structure, and calculate breakeven + ticket pricing.
 *
 * Props:
 *   eventId     — studioEvent Firestore ID
 *   tenantId    — tenant ID
 *   event       — the studioEvent document
 *   firestore   — Firestore instance
 *
 * Writes back to:
 *   tenants/{tenantId}/studioEvents/{eventId}
 *     .linkedQuoteId
 *     .eventCosts          — array of cost line items
 *     .estimatedGuests
 *     .ticketPrice         — suggested ticket price for breakeven
 *
 *   tenants/{tenantId}/quotes/{quoteId}
 *     .linkedEventId
 *     .eventCosts          — synced back to quote
 *     .estimatedGuests
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
    TrendingUp, TrendingDown, DollarSign, Users, AlertTriangle, Plus, Trash2,
    Link as LinkIcon, CheckCircle2, Calculator, ChevronDown, ChevronUp,
    Briefcase, MapPin, Utensils, Truck, Clock, MoreHorizontal, Zap, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where, getDocs } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

// ─── TYPES ────────────────────────────────────────────────────────────────────
export type EventCostItem = {
    id: string;
    label: string;
    category: 'staff' | 'venue' | 'food' | 'transport' | 'marketing' | 'equipment' | 'other';
    amount: number;
    notes?: string;
};

const COST_CATEGORIES = [
    { value: 'staff',     label: 'Staff / Labor',    icon: Briefcase },
    { value: 'venue',     label: 'Venue / Space',    icon: MapPin },
    { value: 'food',      label: 'Food & Beverage',  icon: Utensils },
    { value: 'transport', label: 'Transport',        icon: Truck },
    { value: 'marketing', label: 'Marketing',        icon: Zap },
    { value: 'equipment', label: 'Equipment',        icon: MoreHorizontal },
    { value: 'other',     label: 'Other',            icon: MoreHorizontal },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
    staff:     'bg-blue-50 border-blue-100 text-blue-700',
    venue:     'bg-purple-50 border-purple-100 text-purple-700',
    food:      'bg-orange-50 border-orange-100 text-orange-700',
    transport: 'bg-cyan-50 border-cyan-100 text-cyan-700',
    marketing: 'bg-pink-50 border-pink-100 text-pink-700',
    equipment: 'bg-amber-50 border-amber-100 text-amber-700',
    other:     'bg-slate-50 border-slate-100 text-slate-600',
};

// ─── COST LINE ITEM ────────────────────────────────────────────────────────────
const CostLineItem = ({
    item,
    onUpdate,
    onDelete,
}: {
    item: EventCostItem;
    onUpdate: (id: string, updates: Partial<EventCostItem>) => void;
    onDelete: (id: string) => void;
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center p-3 rounded-2xl border-2 bg-white shadow-sm"
        >
            <Input
                value={item.label}
                onChange={e => onUpdate(item.id, { label: e.target.value })}
                placeholder="Cost description..."
                className="h-10 rounded-xl border-2 font-bold text-sm"
            />
            <Select value={item.category} onValueChange={v => onUpdate(item.id, { category: v as EventCostItem['category'] })}>
                <SelectTrigger className="h-10 rounded-xl border-2 w-36 font-bold text-[10px] uppercase tracking-widest">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-xl">
                    {COST_CATEGORIES.map(cat => (
                        <SelectItem key={cat.value} value={cat.value} className="font-bold text-[10px] uppercase tracking-widest">{cat.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="relative w-28">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                    type="number"
                    value={item.amount || ''}
                    onChange={e => onUpdate(item.id, { amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="h-10 pl-7 rounded-xl border-2 font-black font-mono text-right text-sm"
                />
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-xl text-destructive/40 hover:text-destructive hover:bg-destructive/5"
                onClick={() => onDelete(item.id)}
            >
                <Trash2 className="w-4 h-4" />
            </Button>
        </motion.div>
    );
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
interface EventQuotePanelProps {
    eventId: string;
    tenantId: string;
    event: any;
    firestore: any;
}

export const EventQuotePanel: React.FC<EventQuotePanelProps> = ({
    eventId,
    tenantId,
    event,
    firestore,
}) => {
    const { toast } = useToast();

    // ── State ─────────────────────────────────────────────────────────────────
    const [costs, setCosts] = useState<EventCostItem[]>(event?.eventCosts || []);
    const [estimatedGuests, setEstimatedGuests] = useState<number>(event?.estimatedGuests || 0);
    const [linkedQuoteId, setLinkedQuoteId] = useState<string>(event?.linkedQuoteId || '');
    const [isSaving, setIsSaving] = useState(false);
    const [showLinkPanel, setShowLinkPanel] = useState(false);
    const [quoteSearch, setQuoteSearch] = useState('');
    const [availableQuotes, setAvailableQuotes] = useState<any[]>([]);
    const [quotesLoading, setQuotesLoading] = useState(false);

    // Keep local state in sync if event doc changes
    useEffect(() => {
        setCosts(event?.eventCosts || []);
        setEstimatedGuests(event?.estimatedGuests || 0);
        setLinkedQuoteId(event?.linkedQuoteId || '');
    }, [event?.eventCosts, event?.estimatedGuests, event?.linkedQuoteId]);

    // ── Quote search ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!showLinkPanel || !firestore || !tenantId) return;
        setQuotesLoading(true);
        getDocs(collection(firestore, `tenants/${tenantId}/quotes`))
            .then(snap => {
                setAvailableQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            })
            .finally(() => setQuotesLoading(false));
    }, [showLinkPanel, firestore, tenantId]);

    const filteredQuotes = useMemo(() => {
        if (!quoteSearch) return availableQuotes;
        const q = quoteSearch.toLowerCase();
        return availableQuotes.filter(quote =>
            (quote.eventName || '').toLowerCase().includes(q) ||
            (quote.clientName || '').toLowerCase().includes(q)
        );
    }, [availableQuotes, quoteSearch]);

    // ── Cost calculations ─────────────────────────────────────────────────────
    const economics = useMemo(() => {
        const totalCosts = costs.reduce((a, c) => a + (c.amount || 0), 0);

        // Revenue: from linked quote, or from ticket sales estimate
        const quoteRevenue = event?.linkedQuoteRevenue || 0;
        const ticketRevenue = estimatedGuests > 0 && event?.ticketingConfig?.price
            ? estimatedGuests * event.ticketingConfig.price
            : 0;
        const revenue = quoteRevenue || ticketRevenue;

        const profit = revenue - totalCosts;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        const breakevenTicketPrice = estimatedGuests > 0 ? totalCosts / estimatedGuests : 0;
        const profitPerPerson = estimatedGuests > 0 ? profit / estimatedGuests : 0;

        const byCategory = COST_CATEGORIES.map(cat => ({
            ...cat,
            total: costs.filter(c => c.category === cat.value).reduce((a, c) => a + (c.amount || 0), 0),
        })).filter(c => c.total > 0);

        return { totalCosts, revenue, profit, margin, breakevenTicketPrice, profitPerPerson, byCategory };
    }, [costs, estimatedGuests, event?.linkedQuoteRevenue, event?.ticketingConfig?.price]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const addCostItem = () => {
        setCosts(prev => [...prev, {
            id: nanoid(),
            label: '',
            category: 'other',
            amount: 0,
        }]);
    };

    const updateCostItem = (id: string, updates: Partial<EventCostItem>) => {
        setCosts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    };

    const deleteCostItem = (id: string) => {
        setCosts(prev => prev.filter(c => c.id !== id));
    };

    const handleSave = async () => {
        if (!firestore || !tenantId) return;
        setIsSaving(true);
        try {
            const eventRef = doc(firestore, `tenants/${tenantId}/studioEvents`, eventId);
            await updateDocumentNonBlocking(eventRef, {
                eventCosts: costs,
                estimatedGuests,
                linkedQuoteId: linkedQuoteId || null,
            });

            // Sync costs back to the linked quote if one exists
            if (linkedQuoteId) {
                const quoteRef = doc(firestore, `tenants/${tenantId}/quotes`, linkedQuoteId);
                await updateDocumentNonBlocking(quoteRef, {
                    eventCosts: costs,
                    estimatedGuests,
                    linkedEventId: eventId,
                });
            }

            toast({ title: "Event Economics Saved", description: "Costs synced to event and linked quote." });
        } catch (e) {
            toast({ variant: 'destructive', title: "Save Failed" });
        } finally {
            setIsSaving(false);
        }
    };

    const handleLinkQuote = async (quote: any) => {
        setLinkedQuoteId(quote.id);
        setShowLinkPanel(false);
        // Pre-fill guest count from quote if available
        if (quote.estimatedGuests) setEstimatedGuests(quote.estimatedGuests);
        // Pre-fill costs from quote if it already has them
        if (quote.eventCosts?.length) setCosts(quote.eventCosts);
        toast({ title: "Quote Linked", description: `"${quote.eventName}" is now connected to this event.` });
    };

    const handleUnlinkQuote = () => {
        setLinkedQuoteId('');
        toast({ title: "Quote Unlinked" });
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="space-y-0.5 text-left">
                    <h3 className="text-lg font-black uppercase tracking-tighter text-slate-900">Event Economics</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Cost builder · Breakeven · Profitability</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"
                        onClick={() => setShowLinkPanel(v => !v)}
                    >
                        <LinkIcon className="mr-1.5 w-3.5 h-3.5" />
                        {linkedQuoteId ? 'Quote Linked' : 'Link Quote'}
                    </Button>
                    <Button
                        size="sm"
                        className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                    </Button>
                </div>
            </div>

            {/* Linked Quote Badge */}
            <AnimatePresence>
                {linkedQuoteId && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-3 p-3 rounded-2xl border-2 border-green-100 bg-green-50">
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        <div className="flex-1 text-left">
                            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Quote Linked</p>
                            <p className="text-[9px] font-bold text-green-600 opacity-70">
                                {availableQuotes.find(q => q.id === linkedQuoteId)?.eventName || linkedQuoteId.slice(-8).toUpperCase()}
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-[9px] font-black uppercase text-green-600 hover:text-destructive" onClick={handleUnlinkQuote}>
                            Unlink
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Quote link panel */}
            <AnimatePresence>
                {showLinkPanel && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden rounded-2xl border-2 bg-white shadow-sm">
                        <div className="p-4 space-y-3">
                            <Input
                                placeholder="Search quotes by event name or client..."
                                value={quoteSearch}
                                onChange={e => setQuoteSearch(e.target.value)}
                                className="h-10 rounded-xl border-2 text-sm"
                            />
                            {quotesLoading ? (
                                <div className="py-4 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Loading quotes...</div>
                            ) : filteredQuotes.length === 0 ? (
                                <div className="py-4 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-40">No quotes found</div>
                            ) : (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {filteredQuotes.map(quote => (
                                        <button
                                            key={quote.id}
                                            onClick={() => handleLinkQuote(quote)}
                                            className="w-full text-left p-3 rounded-xl border-2 border-transparent hover:border-primary/20 hover:bg-primary/[0.02] transition-all"
                                        >
                                            <p className="font-black text-sm text-slate-900 uppercase tracking-tight">{quote.eventName || 'Unnamed Quote'}</p>
                                            <p className="text-[10px] font-bold text-muted-foreground opacity-60 uppercase">
                                                {quote.clientName || 'Unknown Client'} · #{quote.id.slice(-6).toUpperCase()}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Guest count */}
            <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5">
                <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Estimated Guests</Label>
                    <p className="text-[9px] font-bold text-muted-foreground opacity-60 mt-0.5">Used to calculate per-person breakeven</p>
                </div>
                <Input
                    type="number"
                    value={estimatedGuests || ''}
                    onChange={e => setEstimatedGuests(parseInt(e.target.value) || 0)}
                    className="w-24 h-10 rounded-xl border-2 font-black text-right text-sm"
                    placeholder="0"
                />
            </div>

            {/* Cost items */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cost Line Items</Label>
                    <Button variant="outline" size="sm" className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest border-2" onClick={addCostItem}>
                        <Plus className="w-3 h-3 mr-1" /> Add Cost
                    </Button>
                </div>

                <AnimatePresence mode="popLayout">
                    {costs.length === 0 ? (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="py-8 text-center border-4 border-dashed rounded-2xl opacity-30">
                            <Calculator className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">No costs added yet</p>
                        </motion.div>
                    ) : (
                        costs.map(item => (
                            <CostLineItem
                                key={item.id}
                                item={item}
                                onUpdate={updateCostItem}
                                onDelete={deleteCostItem}
                            />
                        ))
                    )}
                </AnimatePresence>

                {costs.length > 0 && (
                    <div className="flex justify-between items-center px-3 pt-2 border-t-2 border-dashed">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Costs</span>
                        <span className="font-black font-mono text-destructive text-lg">-${economics.totalCosts.toFixed(2)}</span>
                    </div>
                )}
            </div>

            {/* Category breakdown */}
            {economics.byCategory.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {economics.byCategory.map(cat => (
                        <div key={cat.value} className={cn("p-3 rounded-2xl border-2 text-left", CATEGORY_COLORS[cat.value] || CATEGORY_COLORS.other)}>
                            <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{cat.label}</p>
                            <p className="font-black font-mono text-base mt-0.5">${cat.total.toFixed(2)}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Economics summary */}
            {economics.totalCosts > 0 && (
                <div className="p-6 rounded-[2rem] bg-slate-900 text-white space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Profitability Summary</p>

                    {economics.revenue > 0 && (
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="opacity-60 font-bold">Revenue</span>
                                <span className="font-black font-mono text-green-400">+${economics.revenue.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="opacity-60 font-bold">Total Costs</span>
                                <span className="font-black font-mono text-red-400">-${economics.totalCosts.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-white/10">
                                <span className="font-black uppercase text-[11px] tracking-widest">Net Profit</span>
                                <span className={cn("font-black font-mono text-lg", economics.profit >= 0 ? "text-green-400" : "text-red-400")}>
                                    {economics.profit >= 0 ? '+' : ''}${economics.profit.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    )}

                    {estimatedGuests > 0 && (
                        <div className="pt-4 border-t border-white/10 grid grid-cols-2 gap-4">
                            <div className="text-center space-y-1">
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-400">Breakeven/Ticket</p>
                                <p className="text-2xl font-black font-mono">${economics.breakevenTicketPrice.toFixed(2)}</p>
                                <p className="text-[8px] font-bold opacity-40">minimum to break even</p>
                            </div>
                            {economics.revenue > 0 && (
                                <div className="text-center space-y-1">
                                    <p className={cn("text-[9px] font-black uppercase tracking-widest", economics.profitPerPerson >= 0 ? "text-green-400" : "text-red-400")}>Profit/Person</p>
                                    <p className="text-2xl font-black font-mono">
                                        {economics.profitPerPerson >= 0 ? '+' : ''}${economics.profitPerPerson.toFixed(2)}
                                    </p>
                                    <p className="text-[8px] font-bold opacity-40">{estimatedGuests} guests</p>
                                </div>
                            )}
                        </div>
                    )}

                    {economics.totalCosts > 0 && estimatedGuests > 0 && economics.revenue === 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-[9px] font-bold text-amber-300 leading-relaxed">
                                Set ticket price to at least <strong>${economics.breakevenTicketPrice.toFixed(2)}</strong> per person to break even across {estimatedGuests} guests.
                            </p>
                        </div>
                    )}

                    {economics.profit < 0 && economics.revenue > 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-[9px] font-bold text-red-300 leading-relaxed">
                                Projected loss of ${Math.abs(economics.profit).toFixed(2)}. Increase ticket price or reduce costs before accepting this event.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default EventQuotePanel;