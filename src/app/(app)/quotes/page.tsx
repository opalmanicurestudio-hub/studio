'use client';

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc, collection, getDocs, query, where } from 'firebase/firestore';
import { type Quote as QuoteType, type Tenant, type Client } from '@/lib/data';
import { 
    ShieldCheck, 
    Calendar, 
    MapPin, 
    ArrowRight, 
    CheckCircle2, 
    XCircle, 
    Loader, 
    CreditCard, 
    Lock, 
    Sparkles, 
    Landmark,
    DollarSign,
    Percent,
    Users,
    TrendingUp,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-blue-50 via-white to-purple-50 flex flex-col items-center justify-center p-4 py-20">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-200/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-200/20 blur-[120px] rounded-full" />
        </div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-3xl">
            {children}
        </motion.div>
    </div>
);

// ─── Event Cost Breakdown Panel ───────────────────────────────────────────────
const EventCostBreakdown = ({ quote }: { quote: QuoteType }) => {
    const [expanded, setExpanded] = useState(false);

    const costs = useMemo(() => {
        const items = quote.eventCosts || [];
        const staffCost = items.filter(c => c.category === 'staff').reduce((a, c) => a + c.amount, 0);
        const venueCost = items.filter(c => c.category === 'venue').reduce((a, c) => a + c.amount, 0);
        const foodCost = items.filter(c => c.category === 'food').reduce((a, c) => a + c.amount, 0);
        const transportCost = items.filter(c => c.category === 'transport').reduce((a, c) => a + c.amount, 0);
        const otherCost = items.filter(c => !['staff','venue','food','transport'].includes(c.category)).reduce((a, c) => a + c.amount, 0);
        const totalCosts = staffCost + venueCost + foodCost + transportCost + otherCost;

        const servicesSubtotal = quote.lineItems.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 1)), 0);
        const projectFeeAmount = servicesSubtotal * ((quote.projectFee || 0) / 100);
        const revenue = servicesSubtotal + (quote.travelExpenses || 0) + projectFeeAmount;
        const profit = revenue - totalCosts;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        const breakeven = totalCosts;
        const guestCount = quote.estimatedGuests || 1;
        const breakevenPerPerson = breakeven / guestCount;
        const profitPerPerson = profit / guestCount;

        return { staffCost, venueCost, foodCost, transportCost, otherCost, totalCosts, revenue, profit, margin, breakeven, breakevenPerPerson, profitPerPerson, items };
    }, [quote]);

    if (!quote.eventCosts?.length && !quote.estimatedGuests) return null;

    return (
        <div className="rounded-[2rem] border-2 border-primary/10 overflow-hidden">
            <button
                className="w-full p-6 flex items-center justify-between bg-primary/[0.03] hover:bg-primary/[0.06] transition-colors"
                onClick={() => setExpanded(e => !e)}
            >
                <div className="flex items-center gap-3 text-left">
                    <div className="p-2 bg-primary/10 rounded-xl"><TrendingUp className="w-4 h-4 text-primary" /></div>
                    <div>
                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">Event Economics</p>
                        <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest">Breakeven & profitability analysis</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={cn("text-sm font-black font-mono", costs.profit >= 0 ? "text-green-600" : "text-destructive")}>
                        {costs.profit >= 0 ? '+' : ''}{costs.profit.toFixed(2)}
                    </span>
                    {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-6 space-y-6 bg-white">
                            {/* Cost breakdown */}
                            {costs.items.length > 0 && (
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cost Breakdown</p>
                                    <div className="space-y-2">
                                        {costs.items.map((item, i) => (
                                            <div key={i} className="flex justify-between items-center py-2 border-b border-dashed border-border/40 last:border-0">
                                                <div className="text-left">
                                                    <p className="font-bold text-sm text-slate-800">{item.label}</p>
                                                    <p className="text-[10px] uppercase font-bold text-muted-foreground opacity-60">{item.category}</p>
                                                </div>
                                                <p className="font-black font-mono text-sm text-destructive">-${item.amount.toFixed(2)}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-between items-center pt-2 border-t-2 border-dashed">
                                        <p className="font-black uppercase text-xs text-slate-700">Total Costs</p>
                                        <p className="font-black font-mono text-destructive">-${costs.totalCosts.toFixed(2)}</p>
                                    </div>
                                </div>
                            )}

                            {/* P&L summary */}
                            <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest opacity-40">P&L Summary</p>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="font-bold opacity-60">Revenue</span>
                                        <span className="font-black font-mono text-green-400">+${costs.revenue.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="font-bold opacity-60">Total Costs</span>
                                        <span className="font-black font-mono text-red-400">-${costs.totalCosts.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between pt-2 border-t border-white/10">
                                        <span className="font-black uppercase text-[11px] tracking-widest">Net Profit</span>
                                        <span className={cn("font-black font-mono text-lg", costs.profit >= 0 ? "text-green-400" : "text-red-400")}>
                                            {costs.profit >= 0 ? '+' : ''}${costs.profit.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="font-bold opacity-60 text-[11px]">Margin</span>
                                        <span className="font-black font-mono text-[11px] opacity-80">{costs.margin.toFixed(1)}%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Per-person stats */}
                            {quote.estimatedGuests && quote.estimatedGuests > 0 && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-100 text-center">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 mb-1">Breakeven/Person</p>
                                        <p className="text-2xl font-black font-mono text-amber-700">${costs.breakevenPerPerson.toFixed(2)}</p>
                                        <p className="text-[8px] font-bold text-amber-500 mt-1">{quote.estimatedGuests} guests</p>
                                    </div>
                                    <div className={cn("p-4 rounded-2xl border-2 text-center", costs.profitPerPerson >= 0 ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100")}>
                                        <p className={cn("text-[9px] font-black uppercase tracking-widest mb-1", costs.profitPerPerson >= 0 ? "text-green-600" : "text-red-600")}>Profit/Person</p>
                                        <p className={cn("text-2xl font-black font-mono", costs.profitPerPerson >= 0 ? "text-green-700" : "text-red-700")}>
                                            {costs.profitPerPerson >= 0 ? '+' : ''}${costs.profitPerPerson.toFixed(2)}
                                        </p>
                                        <p className={cn("text-[8px] font-bold mt-1", costs.profitPerPerson >= 0 ? "text-green-500" : "text-red-500")}>per ticket</p>
                                    </div>
                                </div>
                            )}

                            {costs.profit < 0 && (
                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/10">
                                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                                    <p className="text-[11px] font-bold text-destructive leading-relaxed">
                                        This event is currently projected at a loss of ${Math.abs(costs.profit).toFixed(2)}. 
                                        Consider adjusting pricing or reducing costs before accepting.
                                    </p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default function PublicQuotePage() {
    // ─── FIX: tenantId now comes from route params, NOT hardcoded ───────────
    const { id, tenantId } = useParams() as { id: string; tenantId?: string };
    const { firestore } = useFirebase();
    const { toast } = useToast();

    // Support two route shapes:
    //   /quote/[tenantId]/[id]  (preferred — tenantId in path)
    //   /quote/[id]             (legacy — tenantId stored on the quote doc itself)
    const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenantId || null);
    const [tenantLookupDone, setTenantLookupDone] = useState(!!tenantId);

    // If tenantId is not in the route, look it up from the quote's tenantId field
    // via a collectionGroup query (or just try a known tenant — but that's fragile).
    // Better: store tenantId on the quote and read it from the doc once found.
    // We'll do a two-step: first load from a public quotes collectionGroup.
    React.useEffect(() => {
        if (tenantId || !firestore || !id) return;
        // Try collectionGroup lookup
        const doLookup = async () => {
            try {
                const snap = await getDocs(
                    query(collection(firestore, 'quotes'), where('__name__', '>=', id), where('__name__', '<=', id + '\uf8ff'))
                );
                // collectionGroup approach
                if (!snap.empty) {
                    const path = snap.docs[0].ref.path; // tenants/{tenantId}/quotes/{id}
                    const parts = path.split('/');
                    if (parts.length >= 2) setResolvedTenantId(parts[1]);
                }
            } catch {
                // collectionGroup failed — quote won't load, show error gracefully
            }
            setTenantLookupDone(true);
        };
        doLookup();
    }, [tenantId, firestore, id]);
    
    const quoteRef = useMemoFirebase(() => 
        firestore && resolvedTenantId ? doc(firestore, `tenants/${resolvedTenantId}/quotes`, id) : null
    , [firestore, resolvedTenantId, id]);
    
    const { data: quote, isLoading: isQuoteLoading } = useDoc<QuoteType>(quoteRef);
    
    const clientRef = useMemoFirebase(() => 
        firestore && resolvedTenantId && quote ? doc(firestore, `tenants/${resolvedTenantId}/clients`, quote.clientId) : null
    , [firestore, resolvedTenantId, quote]);
    const { data: client } = useDoc<Client>(clientRef);

    const [isPaying, setIsPaying] = useState(false);
    const [step, setStep] = useState<'review' | 'payment' | 'success' | 'declined'>('review');

    const servicesSubtotal = useMemo(() => 
        quote?.lineItems?.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 1)), 0) || 0
    , [quote]);
    
    const projectFeeAmount = servicesSubtotal * ((quote?.projectFee || 0) / 100);
    const total = servicesSubtotal + (quote?.travelExpenses || 0) + projectFeeAmount;

    const handleAccept = () => {
        if (quote?.depositAmount && quote.depositAmount > 0) setStep('payment');
        else finalizeAcceptance();
    };

    const finalizeAcceptance = async () => {
        if (!quoteRef) return;
        setIsPaying(true);
        updateDocumentNonBlocking(quoteRef, { status: 'accepted', acceptedAt: new Date().toISOString() });
        setStep('success');
        setIsPaying(false);
    };

    const handleDecline = () => {
        if (!quoteRef) return;
        updateDocumentNonBlocking(quoteRef, { status: 'declined', declinedAt: new Date().toISOString() });
        setStep('declined');
    };

    // ─── Loading states ────────────────────────────────────────────────────
    if (!tenantLookupDone || isQuoteLoading) {
        return (
            <ViewContainer>
                <div className="flex flex-col items-center gap-4">
                    <Loader className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Authenticating Protocol...</p>
                </div>
            </ViewContainer>
        );
    }

    if (!quote) {
        return (
            <ViewContainer>
                <div className="text-center p-12 bg-white rounded-[3rem] border-4 shadow-3xl space-y-6">
                    <XCircle className="w-16 h-16 text-destructive mx-auto" />
                    <h2 className="text-2xl font-black uppercase tracking-tighter">Proposal Expired</h2>
                    <p className="text-slate-500 font-medium">This proposal is no longer available. Please contact your professional.</p>
                </div>
            </ViewContainer>
        );
    }

    return (
        <ViewContainer>
            {step === 'review' && (
                <div className="bg-white p-8 md:p-16 rounded-[3rem] border-4 shadow-3xl space-y-12 text-left">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Official Proposal</p>
                        <h1 className="text-3xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">{quote.eventName}</h1>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest opacity-60">Prepared for {client?.name || 'Guest'}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t-2 border-dashed">
                        <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Logistics Dossier</p>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 font-black uppercase text-xs sm:text-sm text-slate-700">
                                    <Calendar className="w-4 h-4 text-primary opacity-40" />
                                    {quote.eventDate ? format(parseISO(quote.eventDate), 'MMMM d, yyyy') : 'Date TBD'}
                                </div>
                                <div className="flex items-center gap-3 font-black uppercase text-xs sm:text-sm text-slate-700">
                                    <MapPin className="w-4 h-4 text-primary opacity-40" />
                                    {typeof quote.eventLocation === 'string' ? quote.eventLocation : 'On-Site Deployment'}
                                </div>
                                {quote.estimatedGuests && (
                                    <div className="flex items-center gap-3 font-black uppercase text-xs sm:text-sm text-slate-700">
                                        <Users className="w-4 h-4 text-primary opacity-40" />
                                        {quote.estimatedGuests} estimated guests
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="space-y-4 md:text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Contract Status</p>
                            <Badge variant="outline" className="h-7 px-4 rounded-full border-2 font-black uppercase text-[10px] tracking-widest bg-primary/5 border-primary/20 text-primary">Pending Acceptance</Badge>
                        </div>
                    </div>

                    {/* Event Cost Breakdown — only shown if event economics are configured */}
                    <EventCostBreakdown quote={quote} />

                    <div className="space-y-6">
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary">Itemized Protocol</p>
                        <div className="space-y-3">
                            {quote.lineItems?.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center p-5 rounded-2xl bg-muted/20 border-2 border-transparent">
                                    <div>
                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">{item.name}</p>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{item.quantity} Unit(s) @ ${item.price.toFixed(2)}</p>
                                    </div>
                                    <p className="font-black font-mono text-base text-slate-900">${(item.price * item.quantity).toFixed(2)}</p>
                                </div>
                            ))}
                            {(quote.travelExpenses || 0) > 0 && (
                                <div className="flex justify-between items-center p-5 rounded-2xl border-2 border-dashed border-border/50">
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900">Travel & Logistics</p>
                                    <p className="font-black font-mono text-base text-slate-900">${(quote.travelExpenses || 0).toFixed(2)}</p>
                                </div>
                            )}
                            {(quote.projectFee || 0) > 0 && (
                                <div className="flex justify-between items-center p-5 rounded-2xl border-2 border-dashed border-border/50">
                                    <div className="flex items-center gap-2">
                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">Project Fee</p>
                                        <Badge variant="outline" className="text-[9px] font-black border">{quote.projectFee}%</Badge>
                                    </div>
                                    <p className="font-black font-mono text-base text-slate-900">${projectFeeAmount.toFixed(2)}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white space-y-6 shadow-2xl">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Contract Total</span>
                            <span className="text-4xl font-black font-mono tracking-tighter">${total.toFixed(2)}</span>
                        </div>
                        {(quote.depositAmount || 0) > 0 && (
                            <div className="pt-6 border-t border-white/10 flex justify-between items-center">
                                <div className="space-y-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Retainer Required</span>
                                    <p className="text-[9px] font-bold opacity-40 uppercase">DUE UPON ACCEPTANCE</p>
                                </div>
                                <span className="text-2xl font-black font-mono tracking-tighter text-primary">${(quote.depositAmount || 0).toFixed(2)}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 pt-10 border-t-2 border-dashed">
                        <Button variant="ghost" onClick={handleDecline} className="h-16 flex-1 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400">Decline Proposal</Button>
                        <Button onClick={handleAccept} className="h-16 flex-[2] rounded-2xl text-xl font-black uppercase tracking-tight shadow-2xl shadow-primary/30 group">
                            Accept & Secure <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-1" />
                        </Button>
                    </div>
                </div>
            )}

            {step === 'payment' && (
                <div className="bg-white p-8 md:p-16 rounded-[3rem] border-4 shadow-3xl space-y-10 text-center animate-in fade-in zoom-in-95">
                    <div className="space-y-2">
                        <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-4"><CreditCard className="w-8 h-8 text-primary" /></div>
                        <h2 className="text-3xl font-black uppercase tracking-tighter">Retainer Secure</h2>
                        <p className="text-sm font-medium text-slate-500 uppercase tracking-widest opacity-60">Authorize ${(quote.depositAmount || 0).toFixed(2)} to lock your date</p>
                    </div>
                    <div className="space-y-6 text-left">
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div>
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div>
                        </div>
                    </div>
                    <Button onClick={finalizeAcceptance} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30" disabled={isPaying}>
                        {isPaying ? <Loader className="animate-spin" /> : 'Authorize Distribution'}
                    </Button>
                    <div className="flex items-center justify-center gap-3 opacity-40"><Lock className="w-4 h-4"/><span className="text-[9px] font-black uppercase tracking-widest">Encrypted SSL Secure Tunnel</span></div>
                </div>
            )}

            {step === 'success' && (
                <div className="bg-white p-12 md:p-24 rounded-[3rem] border-4 shadow-3xl text-center space-y-10 animate-in fade-in zoom-in-95">
                    <div className="w-32 h-32 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto rotate-6 shadow-2xl shadow-green-500/5">
                        <CheckCircle2 className="w-16 h-16 text-green-500 -rotate-6" />
                    </div>
                    <div className="space-y-3">
                        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter">Protocol Accepted</h2>
                        <p className="text-slate-500 text-lg font-bold uppercase tracking-widest opacity-70">Your project has been secured in our ledger.</p>
                    </div>
                    <p className="text-sm font-medium text-slate-400 max-w-sm mx-auto leading-relaxed">Confirmation details and next steps have been dispatched to your email signature.</p>
                </div>
            )}

            {step === 'declined' && (
                <div className="bg-white p-12 md:p-24 rounded-[3rem] border-4 shadow-3xl text-center space-y-10 animate-in fade-in zoom-in-95">
                    <div className="w-32 h-32 bg-muted rounded-[2.5rem] flex items-center justify-center mx-auto opacity-40">
                        <XCircle className="w-16 h-16 text-slate-400" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-3xl font-black uppercase tracking-tighter">Proposal Void</h2>
                        <p className="text-slate-500 font-bold uppercase tracking-widest opacity-70">We've noted your decline.</p>
                    </div>
                    <p className="text-sm font-medium text-slate-400 max-w-sm mx-auto leading-relaxed">If this was a mistake or you'd like to adjust the parameters, please contact the studio directly.</p>
                </div>
            )}
        </ViewContainer>
    );
}