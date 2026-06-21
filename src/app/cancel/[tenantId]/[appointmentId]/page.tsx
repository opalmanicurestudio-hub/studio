'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader, CheckCircle2, AlertTriangle, Calendar as CalendarIcon, Ban, Phone, Sparkles, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// ── Shared public-page chrome — mirrors the pattern used across every other
// client-facing studio page (check-in, completion links, etc.) so this page
// doesn't feel like a different product. ───────────────────────────────────
const ViewContainer = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={cn("w-full max-w-2xl px-2 sm:px-0 text-left", className)}
    >
        <Card className="border-4 rounded-[2.5rem] md:rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl">
            {children}
        </Card>
    </motion.div>
);

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon?: any }) => (
    <CardHeader className="p-6 md:p-10 pb-4 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-2">{subtitle}</CardDescription>
    </CardHeader>
);

const CLIENT_REASON_OPTIONS = [
    { value: 'schedule_conflict', label: 'Schedule Conflict' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'found_alternative', label: 'Found Alternative' },
    { value: 'price_concern', label: 'Price Concern' },
    { value: 'health_or_childcare', label: 'Health / Childcare' },
    { value: 'other', label: 'Other' },
];

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
    return new Date(val);
};

export default function SelfCancelPage() {
    const params = useParams<{ tenantId: string; appointmentId: string }>();
    const { tenantId, appointmentId } = params;

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [details, setDetails] = useState<any>(null);
    const [reason, setReason] = useState('schedule_conflict');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);

    useEffect(() => {
        if (!tenantId || !appointmentId) return;
        fetch(`/api/appointments/self-cancel?tenantId=${tenantId}&appointmentId=${appointmentId}`)
            .then(res => res.json())
            .then(data => {
                if (!data.ok) { setError(data.error || 'This appointment could not be found.'); setDetails(data); return; }
                setDetails(data);
            })
            .catch(() => setError('Something went wrong loading your appointment.'))
            .finally(() => setIsLoading(false));
    }, [tenantId, appointmentId]);

    const handleCancel = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/appointments/self-cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, appointmentId, clientReason: reason }),
            });
            const data = await res.json();
            if (!data.ok) { setError(data.error || 'Could not cancel this appointment.'); return; }
            setResult(data);
        } catch {
            setError('Something went wrong. Please call the studio directly.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-background text-center">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60 mt-4">Loading Your Appointment...</p>
            </div>
        );
    }

    if (error && !result) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
                <ViewContainer>
                    <ViewHeader title="Can't Cancel Online" subtitle="This link is no longer actionable" icon={AlertTriangle} />
                    <CardContent className="p-10 md:p-16 text-center space-y-8">
                        <div className="w-24 h-24 bg-destructive/5 rounded-[2.5rem] flex items-center justify-center mx-auto opacity-40">
                            <AlertTriangle className="w-12 h-12 text-destructive" />
                        </div>
                        <div className="space-y-2 text-center">
                            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{error}</h3>
                        </div>
                        {details?.studioPhone && (
                            <Button asChild className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl">
                                <a href={`tel:${details.studioPhone}`}><Phone className="w-4 h-4 mr-2" /> Call {details.studioPhone}</a>
                            </Button>
                        )}
                    </CardContent>
                </ViewContainer>
            </div>
        );
    }

    if (result) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
                <ViewContainer>
                    <ViewHeader title={result.alreadyCancelled ? 'Already Cancelled' : 'Session Voided'} subtitle="Cancellation confirmed" icon={CheckCircle2} />
                    <CardContent className="p-10 md:p-16 text-center space-y-8">
                        <div className="w-24 h-24 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl">
                            <CheckCircle2 className="w-12 h-12 text-green-500" />
                        </div>
                        <div className="space-y-2 text-center">
                            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Appointment Cancelled</h3>
                            {!result.alreadyCancelled && (
                                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-sm mx-auto">
                                    {result.feeCharged
                                        ? `Since this is within the studio's ${details?.windowHours}-hour cancellation window, a $${Number(result.feeAmount).toFixed(2)} cancellation fee applies.`
                                        : "No cancellation fee applies — thanks for the advance notice."}
                                </p>
                            )}
                        </div>
                    </CardContent>
                </ViewContainer>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
            <ViewContainer>
                <ViewHeader title="Cancel Appointment" subtitle="Confirm your cancellation below" icon={Ban} />
                <CardContent className="p-8 md:p-12 space-y-10 text-left">
                    <div className="p-8 rounded-[3rem] bg-primary/5 border-2 border-primary/10 shadow-inner space-y-6">
                        <CalendarIcon className="w-12 h-12 text-primary mx-auto opacity-40" />
                        <div className="space-y-1.5 text-center">
                            <p className="text-[10px] font-black uppercase text-primary tracking-[0.3em]">{details?.studioName}</p>
                            <h3 className="text-2xl font-black uppercase text-slate-900 leading-tight">{details?.appointment?.serviceName}</h3>
                            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                {details?.appointment?.startTime ? format(safeDate(details.appointment.startTime), 'EEEE, MMM d @ h:mm a') : ''}
                            </p>
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {details?.isLate ? (
                            <motion.div key="late" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 rounded-[2rem] border-2 border-amber-200 bg-amber-50 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs font-bold text-amber-700 uppercase tracking-tight leading-relaxed">
                                    This is within the {details.windowHours}-hour cancellation window. A <span className="font-mono">${Number(details.estimatedFee).toFixed(2)}</span> cancellation fee will apply.
                                </p>
                            </motion.div>
                        ) : (
                            <motion.div key="ontime" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 rounded-[2rem] border-2 border-green-200 bg-green-50">
                                <p className="text-xs font-bold text-green-700 uppercase tracking-tight">No cancellation fee — thanks for the advance notice.</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {details?.cancellationPolicyText && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed italic px-2">{details.cancellationPolicyText}</p>
                    )}

                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Reason (optional)</Label>
                        <select
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            className="w-full h-14 rounded-2xl border-2 px-4 text-sm font-bold bg-white shadow-inner"
                        >
                            {CLIENT_REASON_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {error && <p className="text-xs font-bold text-destructive text-center">{error}</p>}

                    <Button
                        onClick={handleCancel}
                        disabled={isSubmitting}
                        variant="destructive"
                        className="w-full h-16 rounded-[2rem] text-lg font-black uppercase tracking-widest shadow-2xl shadow-destructive/20 group"
                    >
                        {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : (
                            <>Confirm Cancellation <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" /></>
                        )}
                    </Button>

                    {details?.studioPhone && (
                        <p className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            Prefer to talk to someone? <a href={`tel:${details.studioPhone}`} className="text-primary">{details.studioPhone}</a>
                        </p>
                    )}
                </CardContent>
            </ViewContainer>
        </div>
    );
}