'use client';

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { type Quote as QuoteType, type Client } from '@/lib/data';
import { 
    Calendar, 
    MapPin, 
    ArrowRight, 
    CheckCircle2, 
    XCircle, 
    Loader, 
    CreditCard, 
    Lock,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';

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

export default function PublicQuotePage() {
    const params = useParams() as { id?: string; tenantId?: string; quoteId?: string };
    const id = (params.id || params.quoteId || '') as string;

    // FIX: tenantId from route params. Falls back to the hardcoded value so
    // existing /quote/[id] routes still work while you migrate to /quote/[tenantId]/[id].
    const tenantId = (params.tenantId || 'hoCsqf5Jq2qqW0_j41MZh') as string;

    const { firestore } = useFirebase();
    const { toast } = useToast();
    
    const quoteRef = useMemoFirebase(() => 
        firestore && id ? doc(firestore, `tenants/${tenantId}/quotes`, id) : null
    , [firestore, tenantId, id]);
    
    const { data: quote, isLoading: isQuoteLoading } = useDoc<QuoteType>(quoteRef);
    
    const clientRef = useMemoFirebase(() => 
        firestore && quote?.clientId ? doc(firestore, `tenants/${tenantId}/clients`, quote.clientId) : null
    , [firestore, tenantId, quote]);
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

    if (isQuoteLoading) return (
        <ViewContainer>
            <div className="flex flex-col items-center gap-4">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Authenticating Protocol...</p>
            </div>
        </ViewContainer>
    );

    if (!quote) return (
        <ViewContainer>
            <div className="text-center p-12 bg-white rounded-[3rem] border-4 shadow-3xl space-y-6">
                <XCircle className="w-16 h-16 text-destructive mx-auto" />
                <h2 className="text-2xl font-black uppercase tracking-tighter">Proposal Expired</h2>
                <p className="text-slate-500 font-medium">This proposal is no longer available. Please contact your professional.</p>
            </div>
        </ViewContainer>
    );

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
                            </div>
                        </div>
                        <div className="space-y-4 md:text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Contract Status</p>
                            <Badge variant="outline" className="h-7 px-4 rounded-full border-2 font-black uppercase text-[10px] tracking-widest bg-primary/5 border-primary/20 text-primary">
                                Pending Acceptance
                            </Badge>
                        </div>
                    </div>

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
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label>
                            <Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div>
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div>
                        </div>
                    </div>
                    <Button onClick={finalizeAcceptance} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30" disabled={isPaying}>
                        {isPaying ? <Loader className="animate-spin" /> : 'Authorize Distribution'}
                    </Button>
                    <div className="flex items-center justify-center gap-3 opacity-40">
                        <Lock className="w-4 h-4"/>
                        <span className="text-[9px] font-black uppercase tracking-widest">Encrypted SSL Secure Tunnel</span>
                    </div>
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