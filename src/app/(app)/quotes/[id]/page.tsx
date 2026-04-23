'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { type Quote as QuoteType, type Service, type Staff } from '@/lib/data';
import {
    ArrowLeft,
    Edit,
    Eye,
    Save,
    Send,
    Loader,
    Sparkles,
    Calculator,
    Activity,
    Truck,
    Shield,
    DollarSign,
    Users,
    CheckCircle2,
    X,
    Plus,
    Trash2,
    Calendar as CalendarIcon
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';

const QuoteDocument = ({ quote, client }: { quote: QuoteType, client: any }) => {
    const servicesTotal = quote.lineItems.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 1)), 0);
    const fee = servicesTotal * (quote.projectFee / 100);
    const total = servicesTotal + quote.travelExpenses + fee;

    return (
        <div className="bg-white p-8 sm:p-12 rounded-[3rem] border-4 shadow-3xl space-y-12 text-left">
            <div className="flex justify-between items-start gap-6">
                <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Official Proposal</p>
                    <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900">{quote.eventName}</h2>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest opacity-60">Status: {quote.status}</p>
                </div>
                <div className="text-right">
                    <p className="text-[9px] font-black uppercase text-muted-foreground">Proposal ID</p>
                    <p className="font-mono font-black text-sm text-slate-900">#{quote.id.slice(-6).toUpperCase()}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-8 border-t-2 border-dashed">
                <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Engagement Detail</p>
                    <p className="text-xl font-black text-slate-900 uppercase tracking-tight">{client?.name || 'Guest'}</p>
                    <p className="text-sm font-medium text-slate-600">{client?.email}</p>
                </div>
                <div className="space-y-2 md:text-right">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Deployment Date</p>
                    <p className="text-xl font-black text-slate-900 uppercase tracking-tight">
                        {quote.eventDate ? format(parseISO(quote.eventDate), 'MMMM d, yyyy') : 'TBD'}
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                <p className="text-[9px] font-black uppercase tracking-widest text-primary">Protocol Manifest</p>
                <div className="space-y-3">
                    {quote.lineItems.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center p-5 rounded-2xl bg-muted/20 border-2 border-transparent">
                            <div>
                                <p className="font-black text-sm uppercase tracking-tight text-slate-900">{item.name}</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{item.quantity} Unit(s) @ ${item.price.toFixed(2)}</p>
                            </div>
                            <p className="font-black font-mono text-base text-slate-900">${(item.price * item.quantity).toFixed(2)}</p>
                        </div>
                    ))}
                    {quote.travelExpenses > 0 && (
                        <div className="flex justify-between items-center p-5 rounded-2xl border-2 border-dashed border-border/50">
                            <p className="font-black text-sm uppercase tracking-tight text-slate-900">Travel & Logistics</p>
                            <p className="font-black font-mono text-base text-slate-900">${quote.travelExpenses.toFixed(2)}</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white space-y-6 shadow-2xl">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Contract Total</span>
                    <span className="text-4xl font-black font-mono tracking-tighter">${total.toFixed(2)}</span>
                </div>
                {quote.depositAmount > 0 && (
                    <div className="pt-6 border-t border-white/10 flex justify-between items-center">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Retainer Required</span>
                            <p className="text-[9px] font-bold opacity-40 uppercase">DUE UPON ACCEPTANCE</p>
                        </div>
                        <span className="text-2xl font-black font-mono tracking-tighter text-primary">${quote.depositAmount.toFixed(2)}</span>
                    </div>
                )}
            </div>

            {quote.notes && (
                <div className="space-y-2 pt-8">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Governance & Terms</p>
                    <p className="text-sm font-medium text-slate-600 leading-relaxed italic border-l-4 border-primary/20 pl-6">"{quote.notes}"</p>
                </div>
            )}
        </div>
    );
}

export default function QuoteDetailPage() {
    const params = useParams();
    const quoteId = params.id as string;
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { clients, services, staff } = useInventory();
    const { toast } = useToast();
    const router = useRouter();

    const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
    const [isSaving, setIsSaving] = useState(false);
    const [isDispatching, setIsDispatching] = useState(false);

    const quoteRef = useMemoFirebase(() => 
        firestore && tenantId ? doc(firestore, `tenants/${tenantId}/quotes`, quoteId) : null
    , [firestore, tenantId, quoteId]);

    const { data: quote, isLoading } = useDoc<QuoteType>(quoteRef);

    if (isLoading) {
        return (
            <div className="flex h-screen w-full flex-col bg-slate-50/50">
                <AppHeader title="Protocol Management" />
                <main className="flex-1 p-10 flex flex-col items-center justify-center gap-4">
                    <Loader className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Syncing Protocol...</p>
                </main>
            </div>
        );
    }

    if (!quote) return notFound();

    const client = clients.find(c => c.id === quote.clientId);

    const handleUpdateStatus = (newStatus: QuoteType['status']) => {
        if (!quoteRef) return;
        setIsDispatching(true);
        updateDocumentNonBlocking(quoteRef, { status: newStatus, sentAt: newStatus === 'sent' ? new Date().toISOString() : undefined });
        toast({ title: "Status Synchronized", description: `Protocol transitioned to ${newStatus.toUpperCase()}.` });
        setIsDispatching(false);
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
            <AppHeader title="Edit Proposal" />
            <main className="flex-1 p-4 md:p-10 w-full max-w-5xl mx-auto min-w-0 space-y-10">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="space-y-1 text-left">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Protocol</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Status: {quote.status}</p>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <Button variant="outline" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm">
                            <Link href="/quotes"><ArrowLeft className="mr-2 h-4 w-4" />Return</Link>
                        </Button>
                        <Button 
                            variant="outline"
                            onClick={() => handleUpdateStatus('sent')}
                            disabled={isDispatching || quote.status !== 'draft'}
                            className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm"
                        >
                            {isDispatching ? <Loader className="animate-spin h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                            Dispatch via Email
                        </Button>
                    </div>
                </div>

                <div className="flex justify-center">
                    <div className="p-1.5 bg-muted/30 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5">
                        <Button 
                            variant={viewMode === 'edit' ? 'default' : 'ghost'} 
                            onClick={() => setViewMode('edit')}
                            className="h-10 px-8 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                        >
                            <Edit className="w-3.5 h-3.5 mr-2" /> Yield Engine
                        </Button>
                        <Button 
                            variant={viewMode === 'preview' ? 'default' : 'ghost'} 
                            onClick={() => setViewMode('preview')}
                            className="h-10 px-8 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                        >
                            <Eye className="w-3.5 h-3.5 mr-2" /> Client Preview
                        </Button>
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    {viewMode === 'edit' ? (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key="edit-mode" className="space-y-10 pb-20">
                            <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white">
                                <CardHeader className="p-10 border-b bg-muted/5"><CardTitle className="text-2xl font-black uppercase tracking-tighter">Operational Parameters</CardTitle></CardHeader>
                                <CardContent className="p-10 space-y-10">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                        <div className="space-y-3 text-left">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Assigned Client</Label>
                                            <div className="p-4 rounded-2xl border-2 bg-muted/5 flex items-center gap-4">
                                                <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                                                    <AvatarImage src={client?.avatarUrl} />
                                                    <AvatarFallback>{(client?.name || 'G').charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="font-black text-sm uppercase tracking-tight">{client?.name || 'Unknown'}</p>
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{client?.email}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-3 text-left">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Event Date</Label>
                                            <div className="p-4 h-14 rounded-2xl border-2 bg-muted/5 flex items-center gap-3 font-black uppercase text-sm">
                                                <CalendarIcon className="w-4 h-4 text-primary opacity-40" />
                                                {quote.eventDate ? format(parseISO(quote.eventDate), 'MMMM d, yyyy') : 'TBD'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Financial Components</Label>
                                        <div className="grid gap-3">
                                            {quote.lineItems.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center p-5 bg-muted/20 rounded-[1.5rem] border-2 border-transparent">
                                                    <div>
                                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">{item.name}</p>
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">{item.quantity}x @ ${item.price.toFixed(2)}</p>
                                                    </div>
                                                    <p className="font-black font-mono text-base text-primary tracking-tighter">${(item.price * item.quantity).toFixed(2)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ) : (
                        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} key="preview-mode">
                            <QuoteDocument quote={quote} client={client} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
}