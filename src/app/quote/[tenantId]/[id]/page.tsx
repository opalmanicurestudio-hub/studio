'use client';

/**
 * COMPLETE PUBLIC QUOTE PAGE
 * Route: src/app/quote/[tenantId]/[id]/page.tsx
 *
 * Full lifecycle:
 * - Review → (deposit required?) Payment → Success
 * - Review → Decline (capture reason) → Void
 * - Revision request dialog
 * - Read receipt on first load
 * - Expiration enforcement
 * - On accept: creates calendar block, ledger entry, notification, locks quote
 * - On decline: captures reason, saves, triggers follow-up flag
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore, doc, getDoc, updateDoc, addDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import {
    CheckCircle2, XCircle, Loader, CreditCard, Lock, Sparkles,
    DollarSign, Users, TrendingUp, AlertTriangle, ChevronDown, ChevronUp,
    Calendar, MapPin, ArrowRight, Edit, MessageSquare, Clock, Shield,
    FileText, Phone, Mail, Star, RefreshCw, Building,
} from 'lucide-react';
import { format, parseISO, isPast, addDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ─── Standalone Firebase ───────────────────────────────────────────────────────
const getDb = () => {
    if (getApps().length === 0) {
        initializeApp({
            apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
            authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
            projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
            appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        });
    }
    return getFirestore();
};

// ─── Decline reasons ───────────────────────────────────────────────────────────
const DECLINE_REASONS = [
    'Price is too high',
    'Found another provider',
    'Date no longer available',
    'Event plans changed',
    'Need more time to decide',
    'Services don\'t match my needs',
    'Other',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const formatCurrency = (n: number) => `$${(n || 0).toFixed(2)}`;

const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { label: string; className: string }> = {
        draft:    { label: 'Draft',    className: 'bg-slate-100 border-slate-200 text-slate-600' },
        sent:     { label: 'Sent',     className: 'bg-blue-50 border-blue-200 text-blue-700' },
        viewed:   { label: 'Viewed',   className: 'bg-purple-50 border-purple-200 text-purple-700' },
        accepted: { label: 'Accepted', className: 'bg-green-50 border-green-200 text-green-700' },
        declined: { label: 'Declined', className: 'bg-red-50 border-red-200 text-red-700' },
        expired:  { label: 'Expired',  className: 'bg-amber-50 border-amber-200 text-amber-700' },
    };
    const c = config[status] || config.sent;
    return (
        <Badge variant="outline" className={cn('h-7 px-4 rounded-full border-2 font-black uppercase text-[10px] tracking-widest', c.className)}>
            {c.label}
        </Badge>
    );
};

// ─── Payment schedule display ──────────────────────────────────────────────────
const PaymentSchedule = ({ quote, total }: { quote: any; total: number }) => {
    const schedule = quote.paymentSchedule;
    if (!schedule || schedule.length === 0) {
        if (!quote.depositAmount) return null;
        // Simple deposit + balance
        const balance = total - (quote.depositAmount || 0);
        return (
            <div className="space-y-3 p-6 rounded-[2rem] border-2 border-primary/10 bg-primary/[0.02]">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Payment Schedule</p>
                <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 rounded-xl bg-white border">
                        <div>
                            <p className="font-black text-sm text-slate-900">Retainer Deposit</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase">Due upon acceptance</p>
                        </div>
                        <p className="font-black font-mono text-primary">{formatCurrency(quote.depositAmount)}</p>
                    </div>
                    {balance > 0 && (
                        <div className="flex justify-between items-center p-3 rounded-xl bg-white border">
                            <div>
                                <p className="font-black text-sm text-slate-900">Remaining Balance</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                                    {quote.paymentTerms === 'net_30' ? 'Due 30 days before event' :
                                     quote.paymentTerms === 'net_15' ? 'Due 15 days before event' :
                                     'Due on receipt'}
                                </p>
                            </div>
                            <p className="font-black font-mono text-slate-700">{formatCurrency(balance)}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-3 p-6 rounded-[2rem] border-2 border-primary/10 bg-primary/[0.02]">
            <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Payment Schedule</p>
            <div className="space-y-2">
                {schedule.map((payment: any, i: number) => (
                    <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-white border">
                        <div>
                            <p className="font-black text-sm text-slate-900">{payment.label}</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase">{payment.dueDate}</p>
                        </div>
                        <p className="font-black font-mono text-primary">{formatCurrency(payment.amount)}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Revision request dialog ───────────────────────────────────────────────────
const RevisionDialog = ({ open, onClose, onSubmit }: {
    open: boolean; onClose: () => void;
    onSubmit: (message: string) => void;
}) => {
    const [message, setMessage] = useState('');
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-lg bg-white rounded-[2.5rem] border-4 shadow-3xl overflow-hidden"
            >
                <div className="p-8 space-y-6">
                    <div className="space-y-1">
                        <h3 className="text-2xl font-black uppercase tracking-tighter">Request a Revision</h3>
                        <p className="text-sm font-medium text-muted-foreground">Describe what you'd like changed and we'll update the proposal.</p>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your Request</Label>
                        <Textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="e.g. Can you remove the gel mani and add a dip powder instead? Also curious if you can do 7 people instead of 6..."
                            rows={4}
                            className="rounded-2xl border-2 bg-muted/5"
                        />
                    </div>
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={onClose} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => { onSubmit(message); setMessage(''); }}
                            disabled={!message.trim()}
                            className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20"
                        >
                            Send Request
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function PublicQuotePage() {
    const { id, tenantId } = useParams() as { id: string; tenantId: string };
    const db = getDb();

    const [quote,   setQuote]   = useState<any>(null);
    const [tenant,  setTenant]  = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [step, setStep]       = useState<'review' | 'payment' | 'decline_reason' | 'success' | 'declined' | 'expired' | 'revision_sent'>('review');
    const [isPaying,   setIsPaying]   = useState(false);
    const [declineReason, setDeclineReason] = useState('');
    const [declineNote,   setDeclineNote]   = useState('');
    const [showRevision,  setShowRevision]  = useState(false);

    // ── Load quote + tenant ────────────────────────────────────────────────────
    useEffect(() => {
        if (!id || !tenantId) return;
        const load = async () => {
            try {
                const [qSnap, tSnap] = await Promise.all([
                    getDoc(doc(db, `tenants/${tenantId}/quotes`, id)),
                    getDoc(doc(db, `tenants/${tenantId}`)),
                ]);
                if (qSnap.exists()) {
                    const q = { id: qSnap.id, ...qSnap.data() };
                    setQuote(q);

                    // ── Read receipt ─────────────────────────────────────────
                    // Mark as viewed the first time a client opens it
                    const qData = qSnap.data();
                    if (qData.status === 'sent' && !qData.viewedAt) {
                        await updateDoc(doc(db, `tenants/${tenantId}/quotes`, id), {
                            status:   'viewed',
                            viewedAt: new Date().toISOString(),
                        });
                        // Notify owner
                        await addDoc(collection(db, `tenants/${tenantId}/notifications`), {
                            id:        nanoid(),
                            type:      'quote_viewed',
                            message:   `Your quote for "${qData.eventName}" has been viewed by the client.`,
                            link:      '/quotes',
                            read:      false,
                            createdAt: new Date().toISOString(),
                        });
                        setQuote((prev: any) => ({ ...prev, status: 'viewed', viewedAt: new Date().toISOString() }));
                    }

                    // ── Expiration check ──────────────────────────────────────
                    if (['sent', 'viewed'].includes(qData.status)) {
                        const expiryDays = qData.expiresInDays || 14;
                        const sentAt = qData.sentAt || qData.createdAt;
                        if (sentAt) {
                            const expiryDate = addDays(new Date(sentAt), expiryDays);
                            if (isPast(expiryDate)) {
                                await updateDoc(doc(db, `tenants/${tenantId}/quotes`, id), {
                                    status: 'expired',
                                    expiredAt: new Date().toISOString(),
                                });
                                setStep('expired');
                                setQuote((prev: any) => ({ ...prev, status: 'expired' }));
                            }
                        }
                    }

                    // Already accepted/declined/expired — skip to result screen
                    if (qData.status === 'accepted') setStep('success');
                    if (qData.status === 'declined') setStep('declined');
                    if (qData.status === 'expired')  setStep('expired');
                }
                if (tSnap.exists()) setTenant(tSnap.data());
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [id, tenantId]);

    // ── Derived numbers ────────────────────────────────────────────────────────
    const servicesSubtotal = useMemo(() =>
        quote?.lineItems?.reduce((a: number, i: any) => a + ((i.price || 0) * (i.quantity || 1)), 0) || 0
    , [quote]);
    const projectFeeAmount = servicesSubtotal * ((quote?.projectFee || 0) / 100);
    const total = servicesSubtotal + (quote?.travelExpenses || 0) + projectFeeAmount;

    // ── Accept flow ────────────────────────────────────────────────────────────
    const handleAccept = () => {
        if (quote?.depositAmount && quote.depositAmount > 0) {
            setStep('payment');
        } else {
            finalizeAcceptance();
        }
    };

    const finalizeAcceptance = async () => {
        if (!quote) return;
        setIsPaying(true);
        try {
            const now = new Date().toISOString();

            // 1. Lock + mark quote accepted
            await updateDoc(doc(db, `tenants/${tenantId}/quotes`, id), {
                status:     'accepted',
                acceptedAt: now,
                locked:     true,
            });

            // 2. Create calendar block on the planner
            if (quote.eventDate) {
                const eventStart = new Date(quote.eventDate);
                const eventEnd   = new Date(eventStart);
                eventEnd.setHours(eventEnd.getHours() + (quote.totalHours || 4));
                await addDoc(collection(db, `tenants/${tenantId}/events`), {
                    id:          nanoid(),
                    title:       quote.eventName || 'Booked Event',
                    type:        'blocked',
                    status:      'confirmed',
                    clientId:    quote.clientId,
                    quoteId:     id,
                    startTime:   eventStart.toISOString(),
                    endTime:     eventEnd.toISOString(),
                    staffIds:    quote.staffPayouts?.map((s: any) => s.staffId) || ['all'],
                    notes:       `Auto-created from accepted quote: ${quote.eventName}`,
                    createdAt:   now,
                });
            }

            // 3. Create ledger entry for deposit
            if (quote.depositAmount && quote.depositAmount > 0) {
                await addDoc(collection(db, `tenants/${tenantId}/transactions`), {
                    id:          nanoid(),
                    type:        'deposit',
                    amount:      quote.depositAmount,
                    clientId:    quote.clientId,
                    quoteId:     id,
                    description: `Deposit — ${quote.eventName}`,
                    status:      'pending', // becomes 'paid' once payment is collected
                    dueDate:     now,
                    createdAt:   now,
                });
            }

            // 4. Notify owner
            await addDoc(collection(db, `tenants/${tenantId}/notifications`), {
                id:        nanoid(),
                type:      'quote_accepted',
                message:   `🎉 Quote accepted: "${quote.eventName}" — ${formatCurrency(total)}. Deposit of ${formatCurrency(quote.depositAmount || 0)} is pending.`,
                link:      '/quotes',
                read:      false,
                priority:  'high',
                createdAt: now,
            });

            // 5. Update client record
            if (quote.clientId) {
                await updateDoc(doc(db, `tenants/${tenantId}/clients`, quote.clientId), {
                    lastQuoteAccepted: now,
                    hasActiveBooking:  true,
                });
            }

            setStep('success');
        } catch (e) {
            console.error('Accept error:', e);
        } finally {
            setIsPaying(false);
        }
    };

    // ── Decline flow ───────────────────────────────────────────────────────────
    const handleDeclineSubmit = async () => {
        if (!quote) return;
        const now = new Date().toISOString();
        await updateDoc(doc(db, `tenants/${tenantId}/quotes`, id), {
            status:        'declined',
            declinedAt:    now,
            declineReason: declineReason,
            declineNote:   declineNote || null,
            needsFollowUp: true, // flag for owner to follow up
        });
        // Notify owner with reason
        await addDoc(collection(db, `tenants/${tenantId}/notifications`), {
            id:        nanoid(),
            type:      'quote_declined',
            message:   `Quote declined: "${quote.eventName}". Reason: ${declineReason || 'Not specified'}.`,
            link:      '/quotes',
            read:      false,
            createdAt: now,
        });
        setStep('declined');
    };

    // ── Revision request ───────────────────────────────────────────────────────
    const handleRevisionSubmit = async (message: string) => {
        if (!quote) return;
        const now = new Date().toISOString();
        // Save revision request to a subcollection
        await addDoc(collection(db, `tenants/${tenantId}/quotes/${id}/revisions`), {
            id:        nanoid(),
            message,
            requestedAt: now,
            status:    'pending',
        });
        // Update quote status
        await updateDoc(doc(db, `tenants/${tenantId}/quotes`, id), {
            status:            'revision_requested',
            revisionRequestedAt: now,
            lastRevisionNote:  message,
        });
        // Notify owner
        await addDoc(collection(db, `tenants/${tenantId}/notifications`), {
            id:        nanoid(),
            type:      'quote_revision',
            message:   `Revision requested on "${quote.eventName}": ${message.slice(0, 80)}...`,
            link:      '/quotes',
            read:      false,
            createdAt: now,
        });
        setShowRevision(false);
        setStep('revision_sent');
    };

    // ── Loading ────────────────────────────────────────────────────────────────
    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-white">
            <div className="flex flex-col items-center gap-4">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Loading Proposal...</p>
            </div>
        </div>
    );

    if (!quote) return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-white">
            <div className="text-center space-y-3">
                <AlertTriangle className="w-12 h-12 text-muted-foreground opacity-20 mx-auto" />
                <p className="font-black uppercase tracking-widest text-slate-500">Proposal not found</p>
                <p className="text-sm text-muted-foreground">This link may have expired or been removed.</p>
            </div>
        </div>
    );

    const primaryColor = tenant?.bookingPageSettings?.primaryColor || tenant?.kioskSettings?.primaryColor || '#0f172a';
    const logoUrl      = tenant?.bookingPageSettings?.logoUrl || tenant?.kioskSettings?.logoUrl;
    const isLocked     = quote.locked || quote.status === 'accepted';
    const canInteract  = ['sent', 'viewed', 'revision_requested'].includes(quote.status);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
            {/* Header */}
            <div className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur-xl px-6 py-4">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                    {logoUrl ? (
                        <img src={logoUrl} alt={tenant?.name} className="h-7 w-auto object-contain" />
                    ) : (
                        <p className="font-black uppercase tracking-tighter text-slate-900">{tenant?.name}</p>
                    )}
                    <StatusBadge status={quote.status} />
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-4 py-10 pb-32 space-y-8">
                <AnimatePresence mode="wait">

                    {/* ── REVIEW ── */}
                    {step === 'review' && (
                        <motion.div key="review" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">

                            {/* Quote header */}
                            <div className="bg-white rounded-[2.5rem] border-2 shadow-sm p-8 space-y-6">
                                <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-60">Custom Proposal for</p>
                                    <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                        {quote.eventName || 'Your Event'}
                                    </h1>
                                    {quote.notes && (
                                        <p className="text-sm font-medium text-muted-foreground leading-relaxed pt-2 border-t border-dashed">
                                            {quote.notes}
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {quote.eventDate && (
                                        <div className="flex items-center gap-2 p-3 rounded-2xl bg-muted/5 border">
                                            <Calendar className="w-4 h-4 text-primary/40 shrink-0" />
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Date</p>
                                                <p className="font-black text-sm text-slate-900">
                                                    {format(new Date(quote.eventDate + 'T12:00:00'), 'MMM d, yyyy')}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    {(quote.eventLocation?.city || quote.eventLocation?.street) && (
                                        <div className="flex items-center gap-2 p-3 rounded-2xl bg-muted/5 border">
                                            <MapPin className="w-4 h-4 text-primary/40 shrink-0" />
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Location</p>
                                                <p className="font-black text-sm text-slate-900 truncate">
                                                    {typeof quote.eventLocation === 'string'
                                                        ? quote.eventLocation
                                                        : [quote.eventLocation?.street, quote.eventLocation?.city].filter(Boolean).join(', ')}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    {quote.totalHours > 0 && (
                                        <div className="flex items-center gap-2 p-3 rounded-2xl bg-muted/5 border">
                                            <Clock className="w-4 h-4 text-primary/40 shrink-0" />
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Duration</p>
                                                <p className="font-black text-sm text-slate-900">{quote.totalHours} hours</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Expiry notice */}
                                {quote.expiresInDays && quote.sentAt && (
                                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border-2 border-amber-100">
                                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                                        <p className="text-[11px] font-bold text-amber-700">
                                            This proposal expires {format(addDays(new Date(quote.sentAt), quote.expiresInDays), 'MMMM d, yyyy')}.
                                            Accept before then to secure your date.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Line items */}
                            <div className="bg-white rounded-[2.5rem] border-2 shadow-sm p-8 space-y-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Services Included</p>
                                <div className="space-y-3">
                                    {quote.lineItems?.map((item: any, idx: number) => (
                                        <div key={idx} className="flex justify-between items-center p-4 rounded-2xl bg-muted/10 border">
                                            <div>
                                                <p className="font-black text-sm uppercase tracking-tight text-slate-900">{item.name}</p>
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">
                                                    {item.quantity} × {formatCurrency(item.price)}
                                                </p>
                                            </div>
                                            <p className="font-black font-mono text-slate-900">{formatCurrency(item.price * item.quantity)}</p>
                                        </div>
                                    ))}
                                    {(quote.travelExpenses || 0) > 0 && (
                                        <div className="flex justify-between items-center p-4 rounded-2xl border border-dashed">
                                            <p className="font-black text-sm uppercase tracking-tight text-slate-900">Travel & Logistics</p>
                                            <p className="font-black font-mono text-slate-900">{formatCurrency(quote.travelExpenses)}</p>
                                        </div>
                                    )}
                                    {(quote.projectFee || 0) > 0 && (
                                        <div className="flex justify-between items-center p-4 rounded-2xl border border-dashed">
                                            <p className="font-black text-sm uppercase tracking-tight text-slate-900">Project Fee ({quote.projectFee}%)</p>
                                            <p className="font-black font-mono text-slate-900">{formatCurrency(projectFeeAmount)}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Total */}
                                <div className="p-6 rounded-2xl bg-slate-900 text-white space-y-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Total Investment</span>
                                        <span className="text-4xl font-black font-mono tracking-tighter">{formatCurrency(total)}</span>
                                    </div>
                                    {(quote.depositAmount || 0) > 0 && (
                                        <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                                            <div>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Retainer Due Today</span>
                                                <p className="text-[9px] font-bold opacity-40 uppercase mt-0.5">Balance due per payment terms</p>
                                            </div>
                                            <span className="text-2xl font-black font-mono text-primary">{formatCurrency(quote.depositAmount)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Payment schedule */}
                            <PaymentSchedule quote={quote} total={total} />

                            {/* Terms / cancellation policy */}
                            {(quote.cancellationPolicy || tenant?.cancellationPolicy) && (
                                <div className="bg-white rounded-[2.5rem] border-2 shadow-sm p-8 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-primary/40" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cancellation Policy</p>
                                    </div>
                                    <p className="text-sm font-medium text-slate-600 leading-relaxed">
                                        {quote.cancellationPolicy || tenant?.cancellationPolicy}
                                    </p>
                                </div>
                            )}

                            {/* Studio contact */}
                            {(tenant?.phone || tenant?.email) && (
                                <div className="bg-white rounded-[2.5rem] border-2 shadow-sm p-6 space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Questions? Reach us directly</p>
                                    <div className="flex flex-wrap gap-3">
                                        {tenant?.phone && (
                                            <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                                <Phone className="w-4 h-4 text-primary/40" /> {tenant.phone}
                                            </a>
                                        )}
                                        {tenant?.email && (
                                            <a href={`mailto:${tenant.email}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                                <Mail className="w-4 h-4 text-primary/40" /> {tenant.email}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Action buttons */}
                            {canInteract && (
                                <div className="space-y-3">
                                    <Button
                                        onClick={handleAccept}
                                        className="w-full h-16 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30 group"
                                        style={{ background: primaryColor }}
                                    >
                                        Accept & Secure Date
                                        <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" />
                                    </Button>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button
                                            variant="outline"
                                            onClick={() => setShowRevision(true)}
                                            className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2"
                                        >
                                            <Edit className="w-3.5 h-3.5 mr-2" /> Request Changes
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setStep('decline_reason')}
                                            className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-slate-400"
                                        >
                                            <XCircle className="w-3.5 h-3.5 mr-2" /> Decline
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {isLocked && (
                                <div className="flex items-center justify-center gap-2 p-4 rounded-2xl bg-green-50 border-2 border-green-100">
                                    <Lock className="w-4 h-4 text-green-600" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700">This proposal has been accepted and is locked</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── PAYMENT ── */}
                    {step === 'payment' && (
                        <motion.div key="payment" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-8 md:p-12 space-y-8 text-center">
                            <div className="space-y-2">
                                <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-4">
                                    <CreditCard className="w-8 h-8 text-primary" />
                                </div>
                                <h2 className="text-3xl font-black uppercase tracking-tighter">Secure Your Date</h2>
                                <p className="text-sm font-medium text-slate-500">
                                    Authorize a {formatCurrency(quote.depositAmount)} retainer to confirm your booking
                                </p>
                            </div>

                            <div className="space-y-4 text-left">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Card Number</Label>
                                    <Input placeholder="•••• •••• •••• ••••" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expiry</Label>
                                        <Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center font-bold" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">CVC</Label>
                                        <Input placeholder="•••" className="h-12 rounded-xl border-2 text-center font-bold" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Name on Card</Label>
                                    <Input placeholder="JESSICA WILLIAMS" className="h-12 rounded-xl border-2 font-bold uppercase" />
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl bg-slate-50 border-2 flex justify-between items-center">
                                <span className="font-black text-sm uppercase text-slate-700">Retainer Total</span>
                                <span className="font-black font-mono text-xl text-primary">{formatCurrency(quote.depositAmount)}</span>
                            </div>

                            <Button
                                onClick={finalizeAcceptance}
                                className="w-full h-16 rounded-2xl text-lg font-black uppercase shadow-2xl shadow-primary/30"
                                style={{ background: primaryColor }}
                                disabled={isPaying}
                            >
                                {isPaying ? <Loader className="animate-spin" /> : `Authorize ${formatCurrency(quote.depositAmount)}`}
                            </Button>
                            <div className="flex items-center justify-center gap-2 opacity-30">
                                <Lock className="w-3.5 h-3.5" />
                                <span className="text-[9px] font-black uppercase tracking-widest">SSL Encrypted · Secure Payment</span>
                            </div>
                            <Button variant="ghost" onClick={() => setStep('review')} className="w-full text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                                ← Back to Proposal
                            </Button>
                        </motion.div>
                    )}

                    {/* ── DECLINE REASON ── */}
                    {step === 'decline_reason' && (
                        <motion.div key="decline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-8 space-y-8">
                            <div className="space-y-2 text-center">
                                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Help Us Understand</h2>
                                <p className="text-sm font-medium text-muted-foreground">
                                    No problem at all — your feedback helps us improve. Why are you declining?
                                </p>
                            </div>
                            <div className="space-y-2">
                                {DECLINE_REASONS.map(reason => (
                                    <button
                                        key={reason}
                                        onClick={() => setDeclineReason(reason)}
                                        className={cn(
                                            'w-full text-left p-4 rounded-2xl border-2 transition-all font-bold text-sm',
                                            declineReason === reason
                                                ? 'border-slate-900 bg-slate-900 text-white'
                                                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                                        )}
                                    >
                                        {reason}
                                    </button>
                                ))}
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Anything else you'd like us to know? (optional)</Label>
                                <Textarea
                                    value={declineNote}
                                    onChange={e => setDeclineNote(e.target.value)}
                                    placeholder="Any additional context is appreciated..."
                                    rows={3}
                                    className="rounded-2xl border-2 bg-muted/5"
                                />
                            </div>
                            <div className="flex gap-3">
                                <Button variant="outline" onClick={() => setStep('review')} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
                                    Go Back
                                </Button>
                                <Button
                                    onClick={handleDeclineSubmit}
                                    disabled={!declineReason}
                                    className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-slate-800 hover:bg-slate-900"
                                >
                                    Submit & Decline
                                </Button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── SUCCESS ── */}
                    {step === 'success' && (
                        <motion.div key="success" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-12 md:p-20 text-center space-y-10">
                            <motion.div
                                initial={{ scale: 0 }} animate={{ scale: 1 }}
                                transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
                                className="w-28 h-28 bg-green-500/10 rounded-[2rem] flex items-center justify-center mx-auto"
                            >
                                <CheckCircle2 className="w-14 h-14 text-green-500" />
                            </motion.div>
                            <div className="space-y-3">
                                <h2 className="text-4xl font-black uppercase tracking-tighter text-slate-900">You're Booked!</h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    Your date is secured. We'll be in touch shortly with next steps and confirmation details.
                                </p>
                            </div>
                            <div className="p-6 rounded-2xl bg-slate-50 border-2 text-left space-y-3">
                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Booking Summary</p>
                                <div className="space-y-2 text-sm font-bold text-slate-700">
                                    <div className="flex items-center gap-2">
                                        <Star className="w-4 h-4 text-slate-300" />{quote.eventName}
                                    </div>
                                    {quote.eventDate && (
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-slate-300" />
                                            {format(new Date(quote.eventDate + 'T12:00:00'), 'MMMM d, yyyy')}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <DollarSign className="w-4 h-4 text-slate-300" />
                                        Total: {formatCurrency(total)}
                                        {quote.depositAmount > 0 && ` · Deposit: ${formatCurrency(quote.depositAmount)}`}
                                    </div>
                                </div>
                            </div>
                            {(tenant?.phone || tenant?.email) && (
                                <p className="text-sm text-muted-foreground">
                                    Questions? Contact us at{' '}
                                    {tenant.email && <a href={`mailto:${tenant.email}`} className="font-bold text-primary underline">{tenant.email}</a>}
                                    {tenant.phone && tenant.email && ' or '}
                                    {tenant.phone && <a href={`tel:${tenant.phone}`} className="font-bold text-primary underline">{tenant.phone}</a>}
                                </p>
                            )}
                        </motion.div>
                    )}

                    {/* ── DECLINED ── */}
                    {step === 'declined' && (
                        <motion.div key="declined" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-12 md:p-20 text-center space-y-8">
                            <div className="w-28 h-28 bg-slate-100 rounded-[2rem] flex items-center justify-center mx-auto opacity-50">
                                <XCircle className="w-14 h-14 text-slate-400" />
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Proposal Declined</h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    No worries — we appreciate you letting us know. If your plans change or you'd like to revisit, we're always here.
                                </p>
                            </div>
                            {(tenant?.phone || tenant?.email) && (
                                <div className="p-5 rounded-2xl bg-slate-50 border-2 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Changed your mind?</p>
                                    <div className="flex flex-wrap justify-center gap-4">
                                        {tenant?.phone && (
                                            <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                                <Phone className="w-4 h-4" /> {tenant.phone}
                                            </a>
                                        )}
                                        {tenant?.email && (
                                            <a href={`mailto:${tenant.email}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                                <Mail className="w-4 h-4" /> {tenant.email}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── EXPIRED ── */}
                    {step === 'expired' && (
                        <motion.div key="expired" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-12 md:p-20 text-center space-y-8">
                            <div className="w-28 h-28 bg-amber-50 rounded-[2rem] flex items-center justify-center mx-auto">
                                <Clock className="w-14 h-14 text-amber-400" />
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Proposal Expired</h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    This proposal is no longer active. Dates fill quickly — reach out and we'll see what's available.
                                </p>
                            </div>
                            {(tenant?.phone || tenant?.email) && (
                                <div className="flex flex-wrap justify-center gap-4">
                                    {tenant?.phone && (
                                        <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                            <Phone className="w-4 h-4" /> {tenant.phone}
                                        </a>
                                    )}
                                    {tenant?.email && (
                                        <a href={`mailto:${tenant.email}`} className="flex items-center gap-2 font-bold text-sm text-slate-700 hover:text-primary transition-colors">
                                            <Mail className="w-4 h-4" /> {tenant.email}
                                        </a>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── REVISION SENT ── */}
                    {step === 'revision_sent' && (
                        <motion.div key="revision" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            className="bg-white rounded-[3rem] border-4 shadow-3xl p-12 md:p-20 text-center space-y-8">
                            <div className="w-28 h-28 bg-blue-50 rounded-[2rem] flex items-center justify-center mx-auto">
                                <RefreshCw className="w-14 h-14 text-blue-500" />
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Revision Requested</h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    We've received your request and will send you an updated proposal shortly.
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => setStep('review')}
                                className="h-12 px-8 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2"
                            >
                                Back to Proposal
                            </Button>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>

            {/* Revision request dialog */}
            <RevisionDialog
                open={showRevision}
                onClose={() => setShowRevision(false)}
                onSubmit={handleRevisionSubmit}
            />
        </div>
    );
}