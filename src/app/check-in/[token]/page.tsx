'use client';

/**
 * /check-in/[token] — v2
 *
 * v2 — UNIFICATION: this used to be one of TWO separate client-facing
 * links for the same appointment. QuickBookForm minted a second,
 * independent token for a "completion" link (forms, card-on-file,
 * deposit) that pointed at a completely different page
 * (/complete/[tenantId]/[token]) with its own visual style. Clients could
 * receive two different URLs about the same booking.
 *
 * Now there is exactly one token (checkInToken) and one link
 * (/check-in/{checkInToken}). This page gates on completion requirements
 * BEFORE the arrival flow: if the appointment has an associated
 * `bookingCompletions` record with outstanding requirements (unsigned
 * consent forms, no card on file, unpaid deposit, missing file uploads),
 * the client sees that first — restyled to match this page's existing
 * ViewContainer/ViewHeader visual language rather than pasted in from the
 * old page's different design. Once resolved (or if nothing was ever
 * required), the client falls straight into the existing arrival ->
 * concierge -> review flow, completely unchanged from v1.
 *
 * Render order:
 *   loading -> not found -> cancelled -> completed ->
 *   [NEW] completion pending -> arrived/servicing (concierge) ->
 *   day-of arrival (Hello + status buttons)
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
    Clock, 
    MapPin, 
    Check, 
    Loader, 
    CheckCircle2, 
    Sparkles, 
    Calendar as CalendarIcon, 
    Fingerprint, 
    Wifi, 
    Coffee,
    Activity,
    ArrowRight,
    Plus,
    Minus,
    Info,
    ChevronDown,
    ChevronUp,
    XCircle,
    Car,
    AlertTriangle,
    Users,
    Lock,
    Star,
    Zap,
    Award,
    Smartphone,
    Headphones,
    Moon,
    VolumeX,
    Ear,
    SunDim,
    Gamepad2,
    Trash2,
    MessageSquare,
    Heart,
    Undo2,
    ArrowLeft,
    Repeat,
    User,
    LayoutDashboard,
    Maximize2,
    Sofa,
    FileSignature,
    CreditCard,
    ShieldCheck,
    Upload,
    Image as ImageIcon,
    Ban,
    Phone,
    Camera,
    Bell,
} from 'lucide-react';
import { format, parseISO, subMonths, isAfter, subYears, isBefore, startOfMonth, differenceInHours, isSameDay, startOfDay, addMonths, isToday } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource, type Membership, type RefreshmentRequest, type Review } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, addDoc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Image from 'next/image';
import Link from 'next/link';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const ViewContainer = ({ children, className }: { children: React.ReactNode, className?: string }) => (
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

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string, subtitle: string, icon?: any }) => (
    <CardHeader className="p-6 md:p-10 pb-4 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-2">{subtitle}</CardDescription>
    </CardHeader>
);

const CancelledView = ({ reason }: { reason?: string }) => (
    <ViewContainer>
        <ViewHeader title="Session Void" subtitle="Protocol cancellation finalized" icon={XCircle} />
        <CardContent className="p-10 md:p-16 text-center space-y-8">
            <div className="w-24 h-24 bg-destructive/5 rounded-[2.5rem] flex items-center justify-center mx-auto opacity-40">
                <XCircle className="w-12 h-12 text-destructive" />
            </div>
            <div className="space-y-2 text-center">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">Record Voided</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    This appointment is no longer active. Reason: <strong>{reason?.replace('_', ' ') || 'Protocol Change'}</strong>.
                </p>
            </div>
            <Button asChild className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl">
                <Link href="/">Browse Availability</Link>
            </Button>
        </CardContent>
    </ViewContainer>
);

// v8 — NEW: lets a client control how and when they're notified. Seeded
// from client.notificationPreferences, defaulting to whatever the
// existing system-wide defaults are today (both channels for
// confirmations, voice for reminders — preserving current behavior for
// every client who hasn't touched this) so an unset preference is
// indistinguishable from "I'm fine with the defaults."
const REMINDER_HOUR_OPTIONS = [
    { value: 1, label: '1 hour before' },
    { value: 24, label: '24 hours before' },
    { value: 48, label: '48 hours before' },
    { value: 72, label: '72 hours before' },
];

const NotificationPreferencesView = ({
    tenantId,
    client,
    onBack,
}: {
    tenantId: string;
    client: Client;
    onBack: () => void;
}) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const prefs = client.notificationPreferences || {};
    const [confirmationChannel, setConfirmationChannel] = useState(prefs.confirmationChannel || 'both');
    const [reminderChannel, setReminderChannel] = useState(prefs.reminderChannel || 'voice');
    const [reminderHoursBefore, setReminderHoursBefore] = useState(prefs.reminderHoursBefore || 48);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = async () => {
        if (!firestore || !tenantId || !client.id) return;
        setSaving(true);
        try {
            await setDoc(
                doc(firestore, `tenants/${tenantId}/clients`, client.id),
                { notificationPreferences: { confirmationChannel, reminderChannel, reminderHoursBefore } },
                { merge: true },
            );
            setSaved(true);
            toast({ title: 'Preferences saved' });
            setTimeout(() => setSaved(false), 2000);
        } catch {
            toast({ variant: 'destructive', title: 'Could not save', description: 'Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    const channelOption = (value: string, label: string, current: string, onChange: (v: string) => void) => (
        <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cn(
                'flex-1 h-12 rounded-xl border-2 text-[10px] font-black uppercase tracking-wide transition-colors',
                current === value ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500',
            )}
        >
            {label}
        </button>
    );

    return (
        <ViewContainer>
            <ViewHeader title="Notification Settings" subtitle="How and when we reach you" icon={Bell} />
            <CardContent className="p-8 md:p-12 space-y-10 text-left">
                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Booking confirmations</Label>
                    <div className="flex gap-2 flex-wrap">
                        {channelOption('sms', 'Text', confirmationChannel, setConfirmationChannel)}
                        {channelOption('email', 'Email', confirmationChannel, setConfirmationChannel)}
                        {channelOption('both', 'Both', confirmationChannel, setConfirmationChannel)}
                        {channelOption('none', 'Off', confirmationChannel, setConfirmationChannel)}
                    </div>
                </div>

                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Appointment reminders</Label>
                    <div className="grid grid-cols-2 gap-2">
                        {channelOption('voice', 'Phone call', reminderChannel, setReminderChannel)}
                        {channelOption('sms', 'Text', reminderChannel, setReminderChannel)}
                        {channelOption('email', 'Email', reminderChannel, setReminderChannel)}
                        {channelOption('none', 'Off', reminderChannel, setReminderChannel)}
                    </div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60 px-1">
                        "Phone call" means a friendly reminder call — you can reschedule or cancel right there if plans change.
                    </p>
                </div>

                {reminderChannel !== 'none' && (
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Remind me</Label>
                        <select
                            value={reminderHoursBefore}
                            onChange={e => setReminderHoursBefore(Number(e.target.value))}
                            className="w-full h-12 rounded-xl border-2 px-4 text-sm font-bold bg-white shadow-inner"
                        >
                            {REMINDER_HOUR_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                )}

                <Button onClick={handleSave} disabled={saving} className="w-full h-14 rounded-2xl font-black uppercase text-sm tracking-widest shadow-xl shadow-primary/20">
                    {saving ? <Loader className="w-4 h-4 animate-spin" /> : saved ? <><Check className="w-4 h-4 mr-2" /> Saved</> : 'Save Preferences'}
                </Button>
                <Button variant="ghost" onClick={onBack} className="w-full text-slate-400">← Back</Button>
            </CardContent>
        </ViewContainer>
    );
};


// resolution — never checked in, never explicitly cancelled, never marked
// completed or no-show. Previously a stale link like this fell straight
// through to the normal arrival flow ("Hello! I Have Arrived / En Route /
// Running Late"), which is wrong and mildly harmful: tapping "I Have
// Arrived" on a week-old appointment would falsely flag it as arrived
// TODAY, corrupting whatever no-show/attendance reporting reads that
// field. This is a read-only, dead-end view — it doesn't write anything,
// just stops the client from taking an action that no longer makes sense.
const StaleAppointmentView = ({ tenantName, tenantPhone }: { tenantName?: string; tenantPhone?: string }) => (
    <ViewContainer>
        <ViewHeader title="Appointment Has Passed" subtitle="This link is no longer actionable" icon={Clock} />
        <CardContent className="p-10 md:p-16 text-center space-y-8">
            <div className="w-24 h-24 bg-muted/40 rounded-[2.5rem] flex items-center justify-center mx-auto opacity-60">
                <Clock className="w-12 h-12 text-muted-foreground" />
            </div>
            <div className="space-y-2 text-center">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">This appointment time has passed</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    If you still need this service, please book a new time{tenantName ? ` with ${tenantName}` : ''} or give us a call.
                </p>
            </div>
            <div className="space-y-3">
                <Button asChild className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl">
                    <Link href="/">Browse Availability</Link>
                </Button>
                {tenantPhone && (
                    <Button asChild variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                        <a href={`tel:${tenantPhone}`}><Phone className="w-4 h-4 mr-2" /> Call {tenantPhone}</a>
                    </Button>
                )}
            </div>
        </CardContent>
    </ViewContainer>
);

// v8 — NEW: the mirror image of StaleAppointmentView. Nothing previously
// stopped a client from tapping "I Have Arrived" days before their actual
// appointment date — the arrival buttons showed regardless of how far out
// the booking was. Same read-only, dead-end pattern: doesn't write
// anything, just replaces the arrival flow with a clear "come back on the
// day" message whenever the appointment isn't today. Same-day arrivals are
// never blocked here regardless of how many hours early — someone showing
// up 3 hours before a 2pm slot is normal and shouldn't be stopped.
const TooEarlyView = ({ startTime, serviceName }: { startTime: string; serviceName?: string }) => (
    <ViewContainer>
        <ViewHeader title="Not Quite Yet" subtitle="Check-in opens on the day of your visit" icon={CalendarIcon} />
        <CardContent className="p-10 md:p-16 text-center space-y-8">
            <div className="w-24 h-24 bg-primary/5 rounded-[2.5rem] flex items-center justify-center mx-auto">
                <CalendarIcon className="w-12 h-12 text-primary opacity-60" />
            </div>
            <div className="space-y-2 text-center">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">You're all set</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    {serviceName ? `${serviceName} is` : 'Your appointment is'} scheduled for{' '}
                    <strong className="text-slate-900">{format(safeDate(startTime), 'EEEE, MMMM d')}</strong>.
                    Come back to this link on the day to check in.
                </p>
            </div>
        </CardContent>
    </ViewContainer>
);

const CompletedView = ({ tenant, client, appointment, service }: { tenant: Tenant | null, client: Client | null, appointment: Appointment, service: Service | null, staff: Staff | null }) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [rating, setRating] = useState(0);
    const [reviewText, setReviewText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(!!appointment.reviewSubmittedAt);

    const handleReviewSubmit = async () => {
        if (rating === 0 || !firestore || !tenant || !client) return;
        setIsSubmitting(true);
        try {
            const reviewId = nanoid();
            const review: Review = {
                id: reviewId,
                tenantId: tenant.id,
                clientId: client.id,
                clientName: client.name,
                clientAvatarUrl: client.avatarUrl,
                staffId: appointment.staffId || '',
                serviceId: appointment.serviceId,
                serviceName: service?.name || 'Treatment',
                rating,
                text: reviewText,
                isPublic: false,
                isFeatured: false,
                createdAt: new Date().toISOString()
            };
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/reviews`, reviewId), review, {});
            // v7 — FIX: previously nothing recorded that a review had been
            // submitted anywhere the appointment itself could be checked —
            // `submitted` was pure local component state. Reopening the
            // same link later always re-showed the rating form, with no
            // guard against submitting a second (or third) review for the
            // same visit. This timestamp is checked on load below.
            try {
                await setDoc(
                    doc(firestore, `tenants/${tenant.id}/appointments/${appointment.id}`),
                    { reviewSubmittedAt: new Date().toISOString() },
                    { merge: true },
                );
            } catch { /* best-effort — the review doc above is the record of truth */ }
            toast({ title: "Feedback Archived", description: "Thank you for sharing your story." });
            setSubmitted(true);
        } catch (e) {
            toast({ variant: 'destructive', title: "Submission Failed" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ViewContainer>
            <ViewHeader title="Session Finalized" subtitle="Thank you for visiting us" icon={CheckCircle2} />
            <CardContent className="p-0">
                <AnimatePresence mode="wait">
                    {!submitted ? (
                        <motion.div key="review-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-8 md:p-12 space-y-10">
                            <div className="text-center space-y-4">
                                <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6">
                                    <Heart className="w-10 h-10 text-primary -rotate-6" />
                                </div>
                                <div className="space-y-1 text-center">
                                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">Rate your protocol</h3>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center">Your data helps us maintain excellence</p>
                                </div>
                            </div>

                            <div className="flex justify-center gap-2">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button 
                                        key={star} 
                                        onClick={() => setRating(star)}
                                        className={cn(
                                            "p-2 transition-all active:scale-90",
                                            rating >= star ? "text-amber-400" : "text-muted-foreground opacity-20 hover:opacity-40"
                                        )}
                                    >
                                        <Star className={cn("w-10 h-10 md:w-14 md:h-14", rating >= star && "fill-current")} />
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-3 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Session Narrative</Label>
                                <Textarea 
                                    placeholder="Briefly describe your experience..." 
                                    value={reviewText}
                                    onChange={e => setReviewText(e.target.value)}
                                    className="rounded-[2rem] border-2 bg-muted/5 p-6 font-medium leading-relaxed min-h-[120px] focus-visible:ring-primary/20"
                                />
                            </div>

                            <Button 
                                onClick={handleReviewSubmit} 
                                disabled={rating === 0 || isSubmitting}
                                className="w-full h-16 rounded-[2rem] text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 group"
                            >
                                {isSubmitting ? <Loader className="animate-spin" /> : <>Archive Feedback <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" /></>}
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-12 md:p-20 text-center space-y-8">
                            <div className="w-20 h-20 md:w-24 md:h-24 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl">
                                <CheckCircle2 className="w-12 h-12 text-green-500" />
                            </div>
                            <div className="space-y-2 text-center">
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-center leading-none">Feedback Certified</h3>
                                <p className="text-sm font-medium text-slate-500 uppercase tracking-tight max-w-xs mx-auto text-center leading-relaxed">Your story has been established in our archive. We look forward to your next visit.</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="p-8 bg-muted/5 border-t-2 border-dashed border-border/50 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Button asChild variant="outline" className="h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] bg-white shadow-sm">
                            <Link href={`/book/${tenant?.id}`}>
                                <Repeat className="w-4 h-4 mr-2" /> Book New Session
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] bg-white shadow-sm">
                            <Link href={`/portal/${tenant?.id}/${client?.id}`}>
                                <LayoutDashboard className="w-4 h-4 mr-2 opacity-40" />
                                Access Dashboard
                            </Link>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </ViewContainer>
    );
};

const RefreshmentCard = ({ 
    item, 
    qty, 
    onQtyChange, 
    onRequest, 
    isRequesting, 
    hasPendingRequest, 
    isMember, 
    activeMembership,
    remainingPerkUses
}: { 
    item: InventoryItem, 
    qty: number, 
    onQtyChange: (delta: number) => void, 
    onRequest: () => void, 
    isRequesting: boolean, 
    hasPendingRequest: boolean, 
    isMember: boolean,
    activeMembership: Membership | null,
    remainingPerkUses: number
}) => {
    const isSoldOut = safeNumber(item.totalStock) <= 0;
    const isPerkDefinition = !!activeMembership?.includedProducts?.some(p => p.id === item.id);
    const isPerkAvailableNow = isPerkDefinition && remainingPerkUses >= qty;

    const getDynamicIcon = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes('charger') || n.includes('stand') || n.includes('power')) return Smartphone;
        if (n.includes('headphone') || n.includes('noise')) return Headphones;
        if (n.includes('blanket') || n.includes('pillow')) return Moon;
        if (n.includes('quiet') || n.includes('silent')) return VolumeX;
        if (n.includes('light')) return SunDim;
        if (n.includes('game') || n.includes('tablet')) return Gamepad2;
        return Coffee;
    };

    const Icon = getDynamicIcon(item.name);

    return (
        <motion.div
            whileTap={{ scale: 0.98 }}
            className="shrink-0 w-[240px] md:w-72 h-full py-4 text-left"
        >
            <Card className={cn(
                "rounded-[2.5rem] border-2 transition-all h-full flex flex-col overflow-hidden bg-white shadow-lg",
                (isSoldOut || hasPendingRequest) ? "opacity-40" : "border-primary/5 hover:border-primary/30",
                isPerkAvailableNow && "border-indigo-500/20 ring-1 ring-indigo-500/10",
                item.isMembersOnly && "border-indigo-500/30"
            )}>
                <div className="relative aspect-square w-full bg-muted/20 flex items-center justify-center overflow-hidden border-b">
                    {item.imageUrl ? (
                        <div className="relative w-full h-full">
                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover transition-transform duration-700 hover:scale-110" />
                        </div>
                    ) : (
                        <Icon className="w-12 h-12 md:w-16 md:h-16 text-primary opacity-20" />
                    )}
                    
                    <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                        {item.isMembersOnly && (
                            <Badge className="bg-indigo-600 text-white border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl">
                                <Award className="w-3 md:w-3 mr-1" /> Club Only
                            </Badge>
                        )}
                        {isPerkDefinition && (
                            <Badge className={cn(
                                "border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl",
                                remainingPerkUses > 0 ? "bg-primary text-white" : "bg-muted text-muted-foreground opacity-60"
                            )}>
                                <Star className={cn("w-3 md:w-3 mr-1", remainingPerkUses > 0 && "fill-current")} /> 
                                {remainingPerkUses > 0 ? `Perk` : "Exhausted"}
                            </Badge>
                        )}
                    </div>

                    <div className="absolute bottom-4 right-4">
                        <div className="bg-white/90 backdrop-blur-md rounded-2xl p-2 px-3 shadow-xl border border-white/50">
                            {isPerkAvailableNow ? (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Included</p>
                            ) : safeNumber(item.price) > 0 ? (
                                <p className="text-sm font-black text-slate-900 font-mono tracking-tighter">${safeNumber(item.price).toFixed(2)}</p>
                            ) : (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Comp</p>
                            )}
                        </div>
                    </div>
                </div>

                <CardContent className="p-5 md:p-6 flex-1 flex flex-col justify-between space-y-4 text-left">
                    <div className="space-y-1.5">
                        <h4 className="font-black text-sm md:text-lg uppercase tracking-tight text-slate-900 leading-tight truncate">{item.name}</h4>
                        {item.description && (
                            <p className="text-[11px] font-medium text-slate-500 leading-relaxed line-clamp-2 italic">
                                "{item.description}"
                            </p>
                        )}
                    </div>

                    <div className="pt-4 border-t border-dashed space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-1 px-3 h-10 border shadow-inner">
                                <button onClick={() => onQtyChange(-1)} disabled={isSoldOut || hasPendingRequest} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Minus className="w-4 h-4" /></button>
                                <span className="font-black font-mono text-base w-6 text-center">{qty}</span>
                                <button onClick={() => onQtyChange(1)} disabled={isSoldOut || hasPendingRequest} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Plus className="w-4 h-4" /></button>
                            </div>
                            <Button 
                                size="sm" 
                                disabled={isRequesting || hasPendingRequest || isSoldOut}
                                onClick={onRequest}
                                className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95"
                            >
                                {hasPendingRequest ? 'Pending' : isSoldOut ? 'Void' : 'Request'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
};

const ConciergeExperienceView = ({ 
    tenant, 
    client, 
    inventory, 
    activeRequests, 
    appointment, 
    staff, 
    resources,
    memberships,
    isWaiting = false
}: { 
    tenant: Tenant | null, 
    client: Client | null, 
    inventory: InventoryItem[], 
    activeRequests: any[],
    appointment: Appointment | null,
    staff: Staff | null,
    resources: Resource[],
    memberships: Membership[],
    isWaiting?: boolean
}) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [isRequesting, setIsRequesting] = useState(false);
    const [quantities, setQuantities] = useState<Record<string, number>>({});

    const isMember = useMemo(() => {
        if (!client) return false;
        return !!(client.activeMembershipId && client.subscription?.status === 'active');
    }, [client]);

    const activeMembership = useMemo(() => {
        if (!isMember || !client?.activeMembershipId || !memberships) return null;
        return memberships.find(m => m.id === client.activeMembershipId);
    }, [isMember, client, memberships]);

    const getRemainingPerkUses = (itemId: string) => {
        if (!isMember || !activeMembership || !client?.subscription) return 0;
        
        const perkDef = activeMembership.includedProducts?.find(p => p.id === itemId);
        if (!perkDef) return 0;

        const limit = safeNumber(perkDef.quantity);
        const nextBilling = safeDate(client.subscription.nextBillingDate);
        const cycleStart = startOfMonth(activeMembership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1));

        const totalCycleUsage = activeRequests
            .filter(r => r.itemId === itemId && r.status !== 'cancelled' && isAfter(safeDate(r.requestedAt), cycleStart))
            .reduce((sum, r) => sum + safeNumber(r.quantity), 0);

        return Math.max(0, limit - totalCycleUsage);
    };

    const refreshments = useMemo(() => 
        inventory.filter(item => 
            item.type === 'refreshment' && 
            item.showInConcierge !== false && 
            safeNumber(item.totalStock) > 0 &&
            (!item.isMembersOnly || isMember)
        )
    , [inventory, isMember]);

    const refreshmentsByCategory = useMemo(() => {
        const grouped: Record<string, InventoryItem[]> = {};
        const exclusiveKey = 'Club Exclusive Selection';
        const comfortKey = 'Comfort & Environment';
        
        refreshments.forEach(item => {
            let cat = item.category || 'Standard Selection';
            if (item.isMembersOnly) {
                cat = exclusiveKey;
            } else if (cat.toLowerCase().includes('comfort') || cat.toLowerCase().includes('amenity')) {
                cat = comfortKey;
            }

            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        const orderedGrouped: Record<string, InventoryItem[]> = {};
        if (grouped[exclusiveKey]) orderedGrouped[exclusiveKey] = grouped[exclusiveKey];
        if (grouped[comfortKey]) orderedGrouped[comfortKey] = grouped[comfortKey];
        
        Object.keys(grouped).sort().forEach(key => {
            if (key !== exclusiveKey && key !== comfortKey) orderedGrouped[key] = grouped[key];
        });

        return orderedGrouped;
    }, [refreshments]);

    const stationName = useMemo(() => {
        if (isWaiting) return 'Lounge Area';
        if (!appointment?.requiredResourceIds?.length || !resources) return 'Station';
        const res = resources.find(r => r.id === appointment.requiredResourceIds![0]);
        return res?.name || 'Station';
    }, [appointment, resources, isWaiting]);

    const handleRequest = async (item: InventoryItem) => {
        if (!firestore || !tenant || !client || !appointment || isRequesting) return;
        const qty = quantities[item.id] || 1;
        
        const currentSessionPending = activeRequests.filter(r => r.appointmentId === appointment.id && r.status === 'pending');
        const totalSessionQty = currentSessionPending.reduce((sum, r) => sum + safeNumber(r.quantity || 1), 0);
        const limit = tenant.complimentaryAmenityLimit || 0;

        if (limit > 0 && totalSessionQty + qty > limit) {
            toast({ variant: 'destructive', title: 'Limit Reached', description: `Complimentary limit is ${limit} items per session.` });
            return;
        }

        const remainingPerks = getRemainingPerkUses(item.id);
        const isRedemption = remainingPerks >= qty;

        setIsRequesting(true);
        try {
            const requestId = nanoid();
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId), {
                id: requestId, 
                tenantId: tenant.id, 
                appointmentId: appointment.id, 
                clientId: client.id, 
                clientName: client.name, 
                itemId: item.id, 
                itemName: item.name, 
                quantity: qty, 
                status: 'pending', 
                requestedAt: new Date().toISOString(), 
                stationName, 
                staffName: staff?.name || 'Unassigned', 
                priceAtRequest: isRedemption ? 0 : safeNumber(item.price || 0),
                isRedemption
            }, {});
            toast({ title: isRedemption ? "Perk Redeemed!" : "Request Dispatched" });
            setQuantities(prev => ({ ...prev, [item.id]: 1 }));
        } catch (e) {
            toast({ variant: 'destructive', title: "Request Failed" });
        } finally {
            setIsRequesting(false);
        }
    };

    const handleCancelRequest = async (requestId: string) => {
        if (!firestore || !tenant || isRequesting) return;
        try {
            await updateDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId), {
                status: 'cancelled'
            });
            toast({ title: "Request Recalled" });
        } catch (e) {
            toast({ variant: 'destructive', title: "Recall Failed" });
        }
    };

    const pendingRequestsForThisSession = activeRequests.filter(r => r.appointmentId === appointment.id && r.status === 'pending');
    const hasActiveRequest = pendingRequestsForThisSession.length > 0;

    return (
        <ViewContainer className="max-w-4xl">
            <ViewHeader 
                title={isWaiting ? "Lounge Experience" : "Boutique Experience"} 
                subtitle={isWaiting ? "Please make yourself at home" : "Your session is live"} 
                icon={isWaiting ? Sofa : Clock} 
            />
            <CardContent className="p-0 space-y-12">
                <div className="p-8 md:p-12 text-center space-y-6 bg-primary/5 border-b-2 border-primary/10 shadow-inner relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Sparkles className="w-32 h-32 text-primary" /></div>
                    <div className="w-20 h-20 md:w-24 md:h-24 bg-white rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl border-2 border-primary/10 rotate-6 relative z-10">
                        {isWaiting ? <Sofa className="w-10 h-10 md:w-12 md:h-12 text-primary -rotate-6" /> : <Activity className="w-10 h-10 md:w-12 md:h-12 text-primary -rotate-6" />}
                    </div>
                    <div className="space-y-2 relative z-10">
                        <p className="font-black text-2xl md:text-4xl uppercase tracking-tighter text-slate-900 leading-none">
                            {isWaiting ? "Comfort First" : "In Service Flow"}
                        </p>
                        <p className="text-[10px] md:text-sm font-bold text-slate-500 leading-relaxed uppercase tracking-widest opacity-60">
                            {isWaiting 
                                ? "Select an amenity below and our concierge will bring it to you." 
                                : `Assigned to ${stationName}. Relax and enjoy your treatment.`
                            }
                        </p>
                    </div>
                </div>

                <div className="space-y-16 py-8">
                    {hasActiveRequest && (
                        <div className="px-8 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2">
                                <Activity className="w-3 h-3 animate-pulse" />
                                Current Orders
                            </h3>
                            <div className="grid gap-3">
                                {pendingRequestsForThisSession.map(req => (
                                    <div key={req.id} className="flex items-center justify-between p-4 rounded-[1.5rem] border-2 bg-primary/5 border-primary/10 shadow-sm">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 bg-white rounded-xl shadow-inner"><Loader className="w-4 h-4 text-primary animate-spin" /></div>
                                            <div className="text-left">
                                                <p className="text-xs font-black uppercase text-slate-900 leading-none mb-1">{req.itemName}</p>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[8px] font-bold text-primary/60 uppercase">Load: {safeNumber(req.quantity || 1)} unit</p>
                                                    {req.isRedemption && <Badge className="bg-primary text-white border-none text-[7px] h-4 px-1.5 font-black uppercase shadow-sm">Club Perk</Badge>}
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleCancelRequest(req.id)}
                                            className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/10 transition-all"
                                        >
                                            Recall
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {Object.entries(refreshmentsByCategory).map(([category, items], catIdx) => {
                        const isExclusive = category === 'Club Exclusive Selection';
                        const isComfort = category === 'Comfort & Environment';
                        
                        return (
                            <section key={category} className="space-y-6">
                                <div className="flex items-center justify-between px-8">
                                    <h3 className={cn(
                                        "text-[11px] md:text-sm font-black uppercase tracking-[0.3em]",
                                        isExclusive ? "text-indigo-600" : isComfort ? "text-primary" : "text-muted-foreground opacity-40"
                                    )}>
                                        {isExclusive && <Award className="inline-block w-4 h-4 mr-2 -mt-1" />}
                                        {isComfort && <Zap className="inline-block w-4 h-4 mr-2 -mt-1" />}
                                        {category}
                                    </h3>
                                </div>

                                <ScrollArea className="w-full">
                                    <div className="flex gap-6 px-8 pb-8">
                                        {items.map((item, idx) => {
                                            const hasPendingRequest = pendingRequestsForThisSession.some(r => r.itemId === item.id);
                                            return (
                                                <motion.div
                                                    key={item.id}
                                                    initial={{ opacity: 0, x: 20 }}
                                                    whileInView={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: (catIdx * 0.1) + (idx * 0.05) }}
                                                    viewport={{ once: true }}
                                                >
                                                    <RefreshmentCard 
                                                        item={item} 
                                                        qty={quantities[item.id] || 1}
                                                        onQtyChange={(delta) => {
                                                            const current = quantities[item.id] || 1;
                                                            setQuantities(p => ({...p, [item.id]: Math.max(1, Math.min(safeNumber(item.totalStock), current + delta))}));
                                                        }}
                                                        onRequest={() => handleRequest(item)}
                                                        isRequesting={isRequesting}
                                                        hasPendingRequest={hasPendingRequest} 
                                                        isMember={isMember}
                                                        activeMembership={activeMembership}
                                                        remainingPerkUses={getRemainingPerkUses(item.id)}
                                                    />
                                                </motion.div>
                                            )
                                        })}
                                    </div>
                                    <ScrollBar orientation="horizontal" className="hidden" />
                                </ScrollArea>
                            </section>
                        );
                    })}
                </div>

                <div className="p-8 md:p-12 bg-muted/5 border-t-2 border-dashed border-border/50 space-y-8">
                    {tenant?.wifiNetwork && (
                        <div className="p-6 rounded-[2.5rem] border-2 bg-white shadow-2xl flex items-center justify-between gap-6">
                            <div className="flex items-center gap-4 text-left">
                                <div className="p-3 bg-primary/10 rounded-xl text-primary shadow-inner shrink-0">
                                    <Wifi className="w-6 h-6" />
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-40">Private WiFi Network</p>
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate max-w-[150px] md:max-w-none">{tenant.wifiNetwork}</p>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <Badge variant="outline" className="font-mono font-black text-xs h-10 px-4 border-2 shadow-sm rounded-xl select-all">{tenant.wifiPassword}</Badge>
                            </div>
                        </div>
                    )}
                    <div className="pt-4 text-center">
                        <Button asChild variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase text-[10px] bg-white shadow-sm">
                            <Link href={`/portal/${tenant?.id}/${client?.id}`}>
                                <LayoutDashboard className="w-4 h-4 mr-2 opacity-40" />
                                Access Main Studio Portal
                            </Link>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </ViewContainer>
    );
};

// -- v2 -- NEW: CompletionGateView --------------------------------------
// Ported from the old standalone /complete/[tenantId]/[token] page, restyled
// to match this page's ViewContainer/ViewHeader visual language instead of
// the old page's separate plain-slate-50 style. Handles the same four
// scenarios: forms+card, forms only, card only, nothing (caller should not
// render this view at all in the "nothing" case -- see isCompletionPending
// in the main component below).
const CompletionGateView = ({
    tenant, tenantId, token, completion, forms, onDone,
}: {
    tenant: Tenant | null;
    tenantId: string;
    token: string;
    completion: any;
    forms: any[];
    onDone: (justCompletedToday: boolean) => void;
}) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();

    const [answers, setAnswers] = useState<Record<string, Record<string, any>>>({});
    const [uploads, setUploads] = useState<Record<string, any[]>>({});
    const [uploading, setUploading] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
    // v4 — guardian info per form that requires it (formId -> fields).
    // Kept separate from `answers` since it's not part of the form's own
    // field schema — it's a structural requirement (a second signer) that
    // applies on top of whatever the form itself asks.
    const [guardianInfo, setGuardianInfo] = useState<Record<string, { name: string; relationship: string; accepted: boolean }>>({});
    const [marketingConsent, setMarketingConsent] = useState<boolean | null>(null);
    const [emergencyContact, setEmergencyContact] = useState({ name: '', phone: '', relationship: '' });
    const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

    const stripePromise = useMemo(() => {
        const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!pk || !stripeAccountId) return null;
        return loadStripe(pk, { stripeAccount: stripeAccountId });
    }, [stripeAccountId]);

    const skipCardStep = completion?.skipCardStep === true;
    const depositDollars = (completion?.depositAmountCents || 0) / 100;
    const studioName = tenant?.name || 'the studio';

    const allConsentsComplete = forms.every((f: any) =>
        (f.fields || []).every((fld: any) => {
            if (fld.type === 'heading' || fld.type === 'paragraph') return true;
            const v = answers[f.id]?.[fld.id];
            return v !== undefined && v !== null && v !== '';
        })
    );

    // v4 — guardian consent: forms flagged `requiresGuardianSignature` need
    // a second signer's name + relationship + their own affirmation,
    // collected alongside (not instead of) the minor's own form answers.
    const guardianRequiredForms = forms.filter((f: any) => f.requiresGuardianSignature);
    const allGuardianComplete = guardianRequiredForms.every((f: any) => {
        const g = guardianInfo[f.id];
        return !!g?.name?.trim() && !!g?.relationship?.trim() && g?.accepted;
    });

    const acknowledgments: any[] = completion?.acknowledgments || [];
    const allAcknowledged = acknowledgments.every((a: any) => acknowledged[a.id]);

    const marketingConsentComplete = !completion?.requestMarketingConsent || marketingConsent !== null;
    const emergencyContactComplete = !completion?.requestEmergencyContact ||
        (!!emergencyContact.name.trim() && !!emergencyContact.phone.trim());

    const fileReqs: any[] = completion?.fileRequirements || [];
    const fileCfg = (fr: any) => fr.file || fr;
    const allFilesComplete = fileReqs.every((fr: any) => {
        if (fr.required === false) return true;
        const min = fileCfg(fr).minCount ?? 1;
        return (uploads[fr.id] || []).length >= min;
    });

    const handleFiles = async (reqId: string, fileList: FileList | null, cfg: any) => {
        if (!fileList || fileList.length === 0) return;
        const existing = uploads[reqId] || [];
        const max = cfg?.maxCount ?? 5;
        const picked = Array.from(fileList).slice(0, Math.max(0, max - existing.length));
        setError(null); setUploading(true);
        try {
            for (const file of picked) {
                if (file.size > 10 * 1024 * 1024) { setError(`${file.name} is over 10MB and was skipped.`); continue; }
                const fd = new FormData();
                fd.append('file', file); fd.append('tenantId', tenantId);
                fd.append('token', token); fd.append('reqId', reqId);
                const res = await fetch('/api/completion/upload-file', { method: 'POST', body: fd });
                const out = await res.json().catch(() => null);
                if (out?.url) {
                    setUploads(prev => ({ ...prev, [reqId]: [...(prev[reqId] || []), { name: file.name, url: out.url, uploadedAt: new Date().toISOString() }] }));
                } else {
                    setError(out?.error || `Couldn't upload ${file.name}.`);
                }
            }
        } catch (e: any) { setError(`Upload failed: ${e.message}`); }
        finally { setUploading(false); }
    };

    const removeUpload = (reqId: string, idx: number) =>
        setUploads(prev => ({ ...prev, [reqId]: (prev[reqId] || []).filter((_, i) => i !== idx) }));

    const handleSubmit = async () => {
        setError(null);
        if (!skipCardStep && !accepted) { setError('Please accept the policy and authorization to continue.'); return; }
        if (!allConsentsComplete) { setError('Please complete and sign all forms before continuing.'); return; }
        if (!allGuardianComplete) { setError('A parent or guardian needs to provide their name, relationship, and confirmation before continuing.'); return; }
        if (!allFilesComplete) { setError('Please add the requested photos/files before continuing.'); return; }
        if (!allAcknowledged) { setError('Please confirm you\'ve read everything before continuing.'); return; }
        if (!marketingConsentComplete) { setError('Please let us know your marketing preference before continuing.'); return; }
        if (!emergencyContactComplete) { setError('Please add an emergency contact before continuing.'); return; }
        if (uploading) { setError('Please wait for uploads to finish.'); return; }
        if (!firestore) { setError('Connection problem — please try again.'); return; }

        setSubmitting(true);
        try {
            const nowISO = new Date().toISOString();
            const signedForms = forms.map((f: any) => ({ formId: f.id, formTitle: f.title, formData: answers[f.id] || {} }));
            const fileSubmissions = fileReqs.map((fr: any) => ({
                requirementId: fr.id, label: fileCfg(fr).prompt || fr.label || 'Files', files: uploads[fr.id] || [],
            }));
            const policyAcceptance = {
                acceptedAt: nowISO,
                cardAuthorization: !skipCardStep,
                policyVersion: tenant?.depositPolicy?.version || 'v1',
                depositAmountCents: completion?.depositAmountCents || 0,
            };

            await addDoc(collection(firestore, `tenants/${tenantId}/completionSubmissions`), {
                token, tenantId,
                appointmentId: completion?.appointmentId || null,
                clientId: completion?.clientId || null,
                clientName: completion?.clientName || null,
                clientEmail: completion?.clientEmail || null,
                signedForms, fileSubmissions, policyAcceptance,
                submittedAt: nowISO,
                cardAlreadyOnFile: skipCardStep,
            });

            try {
                if (completion?.appointmentId) {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                        { signedForms, policyAcceptance, requirementFiles: fileSubmissions, completionConsentsAt: nowISO },
                        { merge: true },
                    );
                }
            } catch { /* public write may be restricted -- audit record is source of truth */ }

            // v3 — FIX: previously a signed form only ever got written onto
            // THIS appointment (signedForms above) and into the audit log —
            // never onto the client's permanent record. Since
            // AppointmentDetailsSheet's "already on file" check reads
            // exclusively from clients/{clientId}/signedConsents, a form
            // signed here could never satisfy the "sign once, valid
            // forever" rule at any FUTURE appointment — the client would be
            // asked to sign the exact same form again next time, every
            // time. This closes that gap. Keyed by formId so a later
            // re-sign (e.g. a requiresEveryAppointment form) simply
            // overwrites the prior record with the newer signature.
            if (completion?.clientId && forms.length > 0) {
                try {
                    await Promise.all(forms.map((f: any) => {
                        const guardian = f.requiresGuardianSignature ? guardianInfo[f.id] : null;
                        return setDoc(
                            doc(firestore, `tenants/${tenantId}/clients/${completion.clientId}/signedConsents`, f.id),
                            {
                                formId: f.id,
                                formTitle: f.title,
                                signedAt: nowISO,
                                formData: answers[f.id] || {},
                                source: 'client_self_service',
                                appointmentId: completion?.appointmentId || null,
                                // v4 — guardian consent, only present on forms flagged
                                // requiresGuardianSignature. A separate signer's name/
                                // relationship recorded alongside the minor's own answers,
                                // not instead of them.
                                ...(guardian ? {
                                    guardianName: guardian.name.trim(),
                                    guardianRelationship: guardian.relationship.trim(),
                                    guardianSignedAt: nowISO,
                                } : {}),
                            },
                            { merge: true },
                        );
                    }));
                } catch { /* best-effort -- the appointment-level record and audit log above are the fallback of record */ }
            }

            // v4 — persistToProfile files (e.g. Photo ID): in addition to the
            // per-appointment requirementFiles record above, save a durable
            // copy onto the client's own profile so it isn't re-requested at
            // a future visit. Files WITHOUT this flag (e.g. one-off
            // inspiration photos) intentionally stay scoped to this
            // appointment only — see fileCfg().persistToProfile on the
            // requirement definition, set by staff when requesting it.
            const persistentFileReqs = fileReqs.filter((fr: any) => fileCfg(fr).persistToProfile);
            if (completion?.clientId && persistentFileReqs.length > 0) {
                try {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/clients`, completion.clientId),
                        {
                            profileDocuments: persistentFileReqs.map((fr: any) => ({
                                requirementId: fr.id,
                                label: fileCfg(fr).prompt || fr.label || 'Document',
                                files: uploads[fr.id] || [],
                                uploadedAt: nowISO,
                            })),
                        },
                        { merge: true },
                    );
                } catch { /* best-effort -- appointment-level requirementFiles is the fallback of record */ }
            }

            // v4 — marketing/photo consent and emergency contact are
            // permanent CLIENT attributes, not per-appointment data — they
            // get written straight to the client doc, plus a timestamp on
            // the appointment purely so the activity timeline can show when
            // each was captured.
            if (completion?.clientId && completion?.requestMarketingConsent && marketingConsent !== null) {
                try {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/clients`, completion.clientId),
                        { marketingConsent: { consented: marketingConsent, consentedAt: nowISO, source: 'client_self_service' } },
                        { merge: true },
                    );
                    if (completion?.appointmentId) {
                        await setDoc(
                            doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                            { marketingConsentAnsweredAt: nowISO, marketingConsentAnswer: marketingConsent },
                            { merge: true },
                        );
                    }
                } catch { /* best-effort */ }
            }
            if (completion?.clientId && completion?.requestEmergencyContact && emergencyContactComplete) {
                try {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/clients`, completion.clientId),
                        { emergencyContact: { name: emergencyContact.name.trim(), phone: emergencyContact.phone.trim(), relationship: emergencyContact.relationship.trim() || null } },
                        { merge: true },
                    );
                    if (completion?.appointmentId) {
                        await setDoc(
                            doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                            { emergencyContactCapturedAt: nowISO },
                            { merge: true },
                        );
                    }
                } catch { /* best-effort */ }
            }

            // v4 — acknowledgments (e.g. "please arrive with clean, dry
            // hair") don't collect data — they're just a confirmed-read
            // checkbox. Recorded onto the appointment for the timeline;
            // nothing client-profile-level to persist here.
            if (completion?.appointmentId && acknowledgments.length > 0) {
                try {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                        { acknowledgedAt: nowISO, acknowledgedItems: acknowledgments.map((a: any) => a.text) },
                        { merge: true },
                    );
                } catch { /* best-effort */ }
            }

            if (skipCardStep) {
                try {
                    await setDoc(
                        doc(firestore, `tenants/${tenantId}/bookingCompletions`, token),
                        { status: 'complete', completedAt: nowISO, formsSignedAt: nowISO },
                        { merge: true },
                    );
                    // v5 — FIX: previously only bookingCompletions.status
                    // flipped to 'complete' — nothing on the APPOINTMENT
                    // itself (where staff actually look, via
                    // completionStatus / the activity timeline) ever
                    // updated. A completed request looked identical to a
                    // still-pending one anywhere staff checked the
                    // appointment record directly.
                    if (completion?.appointmentId) {
                        await setDoc(
                            doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                            { completionStatus: 'completed', requirementsCompletedAt: nowISO },
                            { merge: true },
                        );
                    }
                } catch { /* best-effort */ }
                setSubmitting(false);
                const startsToday = completion?.appointmentStartTime ? isToday(safeDate(completion.appointmentStartTime)) : false;
                onDone(startsToday);
                return;
            }

            const res = await fetch('/api/stripe/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId, completionToken: token,
                    appointmentId: completion?.appointmentId, clientId: completion?.clientId,
                    clientName: completion?.clientName, clientEmail: completion?.clientEmail,
                    depositAmount: depositDollars, serviceName: completion?.serviceName,
                }),
            });
            const out = await res.json().catch(() => null);
            if (out?.clientSecret) {
                setStripeAccountId(out.stripeAccountId || null);
                setClientSecret(out.clientSecret);
                setSubmitting(false);
                return;
            }
            setError(out?.error || 'Could not start checkout. Please contact the studio.');
            setSubmitting(false);
        } catch (e: any) {
            setError(e.message || 'Something went wrong. Please try again.');
            setSubmitting(false);
        }
    };

    // Stripe embedded checkout step
    if (clientSecret) {
        return (
            <ViewContainer>
                <ViewHeader title="Payment & Card" subtitle="Secured by Stripe" icon={CreditCard} />
                <CardContent className="p-6 md:p-10 space-y-5">
                    <p className="text-sm text-slate-500 text-center">
                        {depositDollars > 0 ? `Pay your $${depositDollars.toFixed(2)} deposit and save your card.` : 'Securely save your card to finish.'}
                    </p>
                    <div className="bg-white rounded-2xl border-2 shadow-sm p-2 sm:p-4 min-h-[300px]">
                        {stripePromise
                            ? <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete: () => {
                                // v5 — FIX: this path previously only wrote
                                // cardUpdatedViaLinkAt (for the timeline) —
                                // it never marked bookingCompletions.status
                                // or the appointment's completionStatus as
                                // done, unlike the skip-card-step branch
                                // above. A request fulfilled via card/deposit
                                // stayed looking "pending" forever anywhere
                                // staff checked. Fire-and-forget, same as the
                                // existing cardUpdatedViaLinkAt write —
                                // onDone() below navigates the client onward
                                // regardless of whether these land.
                                const nowISO2 = new Date().toISOString();
                                if (completion?.appointmentId) {
                                    setDoc(
                                        doc(firestore, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
                                        { cardUpdatedViaLinkAt: nowISO2, completionStatus: 'completed', requirementsCompletedAt: nowISO2 },
                                        { merge: true },
                                    ).catch(() => {});
                                }
                                setDoc(
                                    doc(firestore, `tenants/${tenantId}/bookingCompletions`, token),
                                    { status: 'complete', completedAt: nowISO2 },
                                    { merge: true },
                                ).catch(() => {});
                                onDone(completion?.appointmentStartTime ? isToday(safeDate(completion.appointmentStartTime)) : false);
                            } }}>
                                <EmbeddedCheckout />
                            </EmbeddedCheckoutProvider>
                            : <div className="p-8 text-center text-sm text-slate-500">Payment can't load right now — please contact {studioName}.</div>}
                    </div>
                    <p className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-400">
                        <Lock className="w-3 h-3" /> your card details never touch our servers
                    </p>
                </CardContent>
            </ViewContainer>
        );
    }

    return (
        <ViewContainer>
            <ViewHeader
                title={skipCardStep ? 'Sign Your Forms' : 'Finish Your Booking'}
                subtitle={skipCardStep ? 'Card already on file' : 'A couple of quick steps'}
                icon={FileSignature}
            />
            <CardContent className="p-6 md:p-10 space-y-6">
                {skipCardStep && (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border-2 border-green-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">Card on file — no payment needed</span>
                    </div>
                )}

                {!skipCardStep && depositDollars > 0 && (
                    <div className="bg-white rounded-2xl border-2 shadow-sm p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <CreditCard className="w-5 h-5 text-primary" />
                            <div>
                                <p className="text-sm font-bold text-slate-900">Deposit due today</p>
                                <p className="text-[11px] text-slate-400">{completion?.serviceName || 'Your appointment'}</p>
                            </div>
                        </div>
                        <p className="text-xl font-black text-slate-900">${depositDollars.toFixed(2)}</p>
                    </div>
                )}

                {forms.map((form: any) => (
                    <div key={form.id} className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-5">
                        <div className="flex items-center gap-2 pb-3 border-b">
                            <FileSignature className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">{form.title}</h2>
                            {form.requiresGuardianSignature && (
                                <span className="text-[9px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full ml-auto">Guardian signature required</span>
                            )}
                        </div>
                        <div className="space-y-6">
                            {(form.fields || []).map((field: any) => (
                                <FormFieldRenderer
                                    key={field.id}
                                    field={field}
                                    value={answers[form.id]?.[field.id]}
                                    onChange={(val: any) => setAnswers(prev => ({ ...prev, [form.id]: { ...(prev[form.id] || {}), [field.id]: val } }))}
                                />
                            ))}
                        </div>
                        {form.requiresGuardianSignature && (
                            <div className="pt-4 border-t border-dashed space-y-3 bg-amber-50/40 -mx-6 -mb-6 px-6 pb-6 rounded-b-2xl">
                                <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Parent / Guardian Information</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <input
                                        value={guardianInfo[form.id]?.name || ''}
                                        onChange={e => setGuardianInfo(prev => ({ ...prev, [form.id]: { name: e.target.value, relationship: prev[form.id]?.relationship || '', accepted: prev[form.id]?.accepted || false } }))}
                                        placeholder="Guardian full name"
                                        className="h-10 rounded-xl border-2 px-3 text-xs"
                                    />
                                    <input
                                        value={guardianInfo[form.id]?.relationship || ''}
                                        onChange={e => setGuardianInfo(prev => ({ ...prev, [form.id]: { name: prev[form.id]?.name || '', relationship: e.target.value, accepted: prev[form.id]?.accepted || false } }))}
                                        placeholder="Relationship to client"
                                        className="h-10 rounded-xl border-2 px-3 text-xs"
                                    />
                                </div>
                                <label className="flex items-start gap-2.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={!!guardianInfo[form.id]?.accepted}
                                        onChange={e => setGuardianInfo(prev => ({ ...prev, [form.id]: { name: prev[form.id]?.name || '', relationship: prev[form.id]?.relationship || '', accepted: e.target.checked } }))}
                                        className="mt-0.5 h-4 w-4 rounded border-2 shrink-0 accent-amber-600"
                                    />
                                    <span className="text-xs font-medium text-slate-700">I am this client's parent or legal guardian and I consent to this form on their behalf.</span>
                                </label>
                            </div>
                        )}
                    </div>
                ))}

                {fileReqs.map((fr: any) => {
                    const cfg = fileCfg(fr);
                    const got = uploads[fr.id] || [];
                    const min = cfg.minCount ?? 1;
                    const max = cfg.maxCount ?? 5;
                    return (
                        <div key={fr.id} className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-4">
                            <div className="flex items-center gap-2 pb-3 border-b">
                                <ImageIcon className="w-4 h-4 text-primary" />
                                <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">{cfg.prompt || fr.label || 'Share files'}</h2>
                            </div>
                            <p className="text-xs text-slate-500">
                                Add up to {max} {max > 1 ? 'files' : 'file'}{min > 0 ? ` (at least ${min})` : ''}. Images or PDFs, up to 10MB each.
                            </p>
                            {got.length > 0 && (
                                <div className="grid grid-cols-3 gap-2">
                                    {got.map((f: any, i: number) => (
                                        <div key={i} className="relative rounded-xl border-2 overflow-hidden bg-slate-50 aspect-square">
                                            {/\.(png|jpe?g|gif|webp)$/i.test(f.name)
                                                ? <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                                                : <div className="flex items-center justify-center h-full text-[10px] p-2 text-center text-slate-500 break-all">{f.name}</div>}
                                            <button onClick={() => removeUpload(fr.id, i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-sm leading-none flex items-center justify-center">×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {got.length < max && (
                                <label className="flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-dashed cursor-pointer text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                                    <Upload className="w-4 h-4" /> {uploading ? 'Uploading…' : got.length > 0 ? 'Add more' : 'Add photos'}
                                    <input
                                        type="file" multiple
                                        accept={(cfg.acceptedTypes || ['image/*']).join(',')}
                                        className="hidden"
                                        onChange={e => { handleFiles(fr.id, e.target.files, cfg); e.currentTarget.value = ''; }}
                                        disabled={uploading}
                                    />
                                </label>
                            )}
                        </div>
                    );
                })}

                {/* v4 — acknowledgments: lightweight "confirm you've read this"
                    items with no data collection, e.g. prep instructions.
                    Text is fully staff-configured — see the request panel
                    in AppointmentDetailsSheet. */}
                {acknowledgments.map((ack: any) => (
                    <div key={ack.id} className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-3">
                        <div className="flex items-center gap-2 pb-2 border-b">
                            <Info className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Please Confirm</h2>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">{ack.text}</p>
                        <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                            <input
                                type="checkbox"
                                checked={!!acknowledged[ack.id]}
                                onChange={e => setAcknowledged(prev => ({ ...prev, [ack.id]: e.target.checked }))}
                                className="mt-0.5 h-5 w-5 rounded border-2 shrink-0 accent-primary"
                            />
                            <span className="text-xs font-medium text-slate-700">I have read and understand this.</span>
                        </label>
                    </div>
                ))}

                {/* v4 — marketing/photo consent: a permanent client
                    preference, not a per-visit form. Two explicit buttons
                    rather than a checkbox so "no" is a real, equally
                    easy-to-select answer, not just an unchecked default. */}
                {completion?.requestMarketingConsent && (
                    <div className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b">
                            <Camera className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Photo & Marketing Consent</h2>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            Can {studioName} share before/after photos or mention your visit on social media or in marketing materials? You can change your answer anytime by asking the studio.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setMarketingConsent(true)}
                                className={cn('h-12 rounded-xl border-2 text-xs font-black uppercase tracking-wide transition-colors', marketingConsent === true ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500')}
                            >
                                Yes, that's fine
                            </button>
                            <button
                                type="button"
                                onClick={() => setMarketingConsent(false)}
                                className={cn('h-12 rounded-xl border-2 text-xs font-black uppercase tracking-wide transition-colors', marketingConsent === false ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500')}
                            >
                                No, please don't
                            </button>
                        </div>
                    </div>
                )}

                {/* v4 — emergency contact: a permanent client profile field,
                    not appointment-specific — captured once, then it's just
                    on file like phone/email. */}
                {completion?.requestEmergencyContact && (
                    <div className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b">
                            <Phone className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Emergency Contact</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                                value={emergencyContact.name}
                                onChange={e => setEmergencyContact(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Full name"
                                className="h-11 rounded-xl border-2 px-3 text-sm"
                            />
                            <input
                                value={emergencyContact.phone}
                                onChange={e => setEmergencyContact(prev => ({ ...prev, phone: e.target.value }))}
                                placeholder="Phone number"
                                className="h-11 rounded-xl border-2 px-3 text-sm"
                            />
                        </div>
                        <input
                            value={emergencyContact.relationship}
                            onChange={e => setEmergencyContact(prev => ({ ...prev, relationship: e.target.value }))}
                            placeholder="Relationship (optional)"
                            className="w-full h-11 rounded-xl border-2 px-3 text-sm"
                        />
                    </div>
                )}

                {!skipCardStep && (
                    <div className="bg-white rounded-2xl border-2 shadow-sm p-6 space-y-4">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Policy & Authorization</h2>
                        </div>
                        <div className="text-xs text-slate-500 leading-relaxed space-y-2 max-h-44 overflow-y-auto pr-1">
                            <p>{tenant?.cancellationPolicyText || `Deposits secure your appointment time. Cancellations made with adequate notice are handled per ${studioName}'s policy; late cancellations and no-shows may forfeit the deposit or incur a fee.`}</p>
                            <p>By continuing, you authorize {studioName} to keep your card on file and to charge it for late-cancellation or no-show fees in accordance with the policy above.</p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer pt-2 border-t">
                            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-2 shrink-0 accent-primary" />
                            <span className="text-xs font-medium text-slate-700 leading-relaxed">
                                I have read and agree to the policy, and I authorize {studioName} to securely store and charge my card for fees as described.
                            </span>
                        </label>
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border-2 border-red-200">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-xs font-medium text-red-700">{error}</p>
                    </div>
                )}

                <Button
                    onClick={handleSubmit}
                    disabled={submitting || uploading || !allGuardianComplete || !allAcknowledged || !marketingConsentComplete || !emergencyContactComplete}
                    className="w-full h-16 rounded-[2rem] text-sm md:text-lg font-black uppercase tracking-widest shadow-3xl shadow-primary/30"
                >
                    {submitting
                        ? <><Loader className="w-5 h-5 animate-spin mr-2" /> Securing…</>
                        : skipCardStep
                            ? <>Submit & confirm</>
                            : depositDollars > 0
                                ? <>Pay ${depositDollars.toFixed(2)} & save card</>
                                : <>Save card & finish</>}
                </Button>

                <p className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-400">
                    <Lock className="w-3 h-3" /> Your information is kept private and secure
                </p>
            </CardContent>
        </ViewContainer>
    );
};

// ── v3 — NEW: CancelGateView ──────────────────────────────────────────────
// Folds the standalone /cancel/[tenantId]/[appointmentId] page's flow into
// the unified check-in link. Reuses the exact same /api/appointments/
// self-cancel route (GET for fee preview, POST to actually cancel) — no
// server-side changes needed, just a client-side entry point that doesn't
// require a separate URL/token. tenantId and appointmentId are both already
// resolved on this page by the time a client reaches the arrival screen
// (appointmentData.id is the appointmentId — it's on every appointment doc,
// including the mirrored appointmentCheckIns copy this page reads from).
const CLIENT_REASON_OPTIONS = [
    { value: 'schedule_conflict', label: 'Schedule Conflict' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'found_alternative', label: 'Found Alternative' },
    { value: 'price_concern', label: 'Price Concern' },
    { value: 'health_or_childcare', label: 'Health / Childcare' },
    { value: 'other', label: 'Other' },
];

const CancelGateView = ({
    tenantId,
    appointmentId,
    onBack,
}: {
    tenantId: string;
    appointmentId: string;
    onBack: () => void;
}) => {
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
            <ViewContainer>
                <div className="p-16 flex flex-col items-center justify-center gap-4">
                    <Loader className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60">Loading your appointment…</p>
                </div>
            </ViewContainer>
        );
    }

    if (error && !result) {
        return (
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
                    <Button variant="ghost" onClick={onBack} className="w-full text-slate-400">← Back</Button>
                </CardContent>
            </ViewContainer>
        );
    }

    if (result) {
        return (
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
        );
    }

    return (
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

                <Button variant="ghost" onClick={onBack} className="w-full text-slate-400">← Never mind, keep my appointment</Button>

                {details?.studioPhone && (
                    <p className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Prefer to talk to someone? <a href={`tel:${details.studioPhone}`} className="text-primary">{details.studioPhone}</a>
                    </p>
                )}
            </CardContent>
        </ViewContainer>
    );
};

export default function CheckInPage() {
    const params = useParams();
    const token = params.token as string;
    const { toast } = useToast();
    const { firestore } = useFirebase();

    const [entered, setEntered] = useState(false);
    const [showCancelFlow, setShowCancelFlow] = useState(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState(false);
    // v2 -- once the completion gate is submitted, we don't want the
    // still-cached-in-memory `completion` doc (which may not have refreshed
    // yet) to flash the gate again before Firestore's snapshot updates.
    const [completionJustDone, setCompletionJustDone] = useState<null | boolean>(null);

    const appointmentCheckInRef = useMemoFirebase(() => !firestore || !token ? null : doc(firestore, 'appointmentCheckIns', token), [firestore, token]);
    const { data: appointmentData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const tenantId = appointmentData?.tenantId;
    const clientId = appointmentData?.clientId;

    const tenantDocRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    
    const inventoryQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const membershipsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const resourcesQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/resources`), [firestore, tenantId]);
    const { data: resources } = useCollection<Resource>(resourcesQuery);

    const allClientRequestsQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId || !clientId) return null;
        return query(
            collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
            where('clientId', '==', clientId)
        );
    }, [firestore, tenantId, clientId]);
    const { data: clientRequests } = useCollection(allClientRequestsQuery);

    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, clientId), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);
    
    const serviceDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.serviceId ? null : doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId), [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);
    
    const staffDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.staffId ? null : doc(firestore, `tenants/${tenantId}/staff`, appointmentData.staffId), [firestore, tenantId, appointmentData?.staffId]);
    const { data: assignedStaff, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

    // v2 -- NEW: completion record + its required consent forms, looked up
    // by the SAME token as everything else on this page. Both queries are
    // no-ops (return null) until tenantId resolves, same pattern as every
    // other query on this page.
    const completionRef = useMemoFirebase(() => !firestore || !tenantId || !token ? null : doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), [firestore, tenantId, token]);
    const { data: completion, isLoading: completionLoading } = useDoc<any>(completionRef);

    const allConsentFormsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
    const { data: allConsentForms } = useCollection<any>(allConsentFormsQuery);

    const requiredForms = useMemo(() => {
        const ids: string[] = completion?.requiredConsentFormIds || [];
        if (!ids.length || !allConsentForms) return [];
        return allConsentForms.filter((f: any) => ids.includes(f.id));
    }, [completion, allConsentForms]);

    // Same computation CompletionContent used for its "nothingToDo" check,
    // just inverted and named for clarity at this call site.
    const isCompletionPending = useMemo(() => {
        if (!completion) return false;
        if (completion.status === 'complete') return false;
        const skipCardStep = completion.skipCardStep === true;
        const hasForms = requiredForms.length > 0;
        const hasFileReqs = (completion.fileRequirements || []).length > 0;
        return !(skipCardStep && !hasForms && !hasFileReqs);
    }, [completion, requiredForms]);

    // v4 — one-time "client opened the link" tracking, purely for the
    // activity timeline. Guarded on the appointment doc's own field so it
    // only ever writes once, no matter how many times the client re-opens
    // the same link. Fires unconditionally on mount (before any early
    // return) — same Rules-of-Hooks discipline as every other hook here.
    useEffect(() => {
        if (!firestore || !tenantId || !appointmentData?.id) return;
        if (appointmentData.completionLinkFirstViewedAt) return; // already recorded
        setDoc(
            doc(firestore, `tenants/${tenantId}/appointments/${appointmentData.id}`),
            { completionLinkFirstViewedAt: new Date().toISOString() },
            { merge: true },
        ).catch(() => {}); // best-effort — never block the client's experience on this
    }, [firestore, tenantId, appointmentData?.id, appointmentData?.completionLinkFirstViewedAt]);

    const updateStatus = async (status: string, lateMinutes?: number) => {
        if (!firestore || !token || !appointmentData) return;
        const updateRef = doc(firestore, 'appointmentCheckIns', token);
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        
        try {
            await updateDocumentNonBlocking(updateRef, updates);
            toast({ title: "Status Updated", description: "Studio technical team notified." });
        } catch (e) {
            toast({ variant: 'destructive', title: "Update Failed" });
        }
    };

    if (appointmentLoading || clientLoading || serviceLoading || tenantLoading || staffLoading || completionLoading) {
        return (
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-background text-center text-left">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60 mt-4">Initializing Studio Pulse...</p>
            </div>
        );
    }

    if (!appointmentData) {
        return (
            <ViewContainer>
                <div className="p-16 text-center space-y-8">
                    <XCircle className="w-20 h-20 text-destructive mx-auto opacity-40" />
                    <div className="space-y-2">
                        <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Record Expired</h2>
                        <p className="text-sm font-medium text-slate-500 uppercase tracking-tight leading-relaxed text-center px-8">
                            This digital key is no longer valid or could not be verified in our manifest.
                        </p>
                    </div>
                    <Button asChild className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl">
                        <Link href="/">Back to Studio</Link>
                    </Button>
                </div>
            </ViewContainer>
        );
    }

    if (appointmentData?.status === 'completed') {
        return (
            <CompletedView 
                tenant={tenant || null} 
                client={client || null} 
                appointment={appointmentData} 
                service={service || null}
                staff={assignedStaff || null}
            />
        );
    }

    if (appointmentData?.status === 'cancelled') {
        return (
            <CancelledView reason={appointmentData.cancellationReason} />
        );
    }

    // v2 -- NEW: completion gate. Sits before the arrival flow. If the
    // client just submitted it this session, `completionJustDone` short-
    // circuits so we don't flash the gate again while Firestore's snapshot
    // catches up -- and if the appointment isn't today, we show a distinct
    // "you're all set, see you on {date}" success card instead of jumping
    // into the day-of arrival screen.
    if (completionJustDone === null && isCompletionPending) {
        return (
            <CompletionGateView
                tenant={tenant || null}
                tenantId={tenantId!}
                token={token}
                completion={{ ...completion, appointmentStartTime: appointmentData.startTime }}
                forms={requiredForms}
                onDone={(startsToday) => setCompletionJustDone(startsToday)}
            />
        );
    }

    if (completionJustDone === false) {
        return (
            <ViewContainer>
                <ViewHeader title="You're All Set" subtitle="Booking secured" icon={CheckCircle2} />
                <CardContent className="p-10 md:p-16 text-center space-y-6">
                    <div className="w-20 h-20 bg-green-50 rounded-[2rem] flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-10 h-10 text-green-500" />
                    </div>
                    <p className="text-sm font-medium text-slate-500 leading-relaxed max-w-sm mx-auto">
                        Your appointment with {tenant?.name || 'the studio'} on{' '}
                        <strong className="text-slate-900">{format(safeDate(appointmentData.startTime), 'EEEE, MMM d')}</strong>{' '}
                        is confirmed. We'll see you then — this link will bring you back to check in on the day of your visit.
                    </p>
                </CardContent>
            </ViewContainer>
        );
    }
    
    // v3 — NEW: cancellation flow. Reachable via a "Can't make it?" link on
    // the arrival screen further down. Uses the appointmentId + tenantId
    // already resolved on this page — no separate URL/token needed.
    if (showCancelFlow && tenantId && appointmentData?.id) {
        return (
            <CancelGateView
                tenantId={tenantId}
                appointmentId={appointmentData.id}
                onBack={() => setShowCancelFlow(false)}
            />
        );
    }

    if (showNotificationSettings && tenantId && client) {
        return (
            <NotificationPreferencesView
                tenantId={tenantId}
                client={client}
                onBack={() => setShowNotificationSettings(false)}
            />
        );
    }

    // IMMERSIVE TRANSITION CHECK
    const isArrivedOrServicing = appointmentData?.checkInStatus === 'arrived' || appointmentData?.status === 'servicing';

    if (isArrivedOrServicing) {
        return (
            <ConciergeExperienceView 
                tenant={tenant || null} 
                client={client || null} 
                inventory={inventory || []} 
                activeRequests={clientRequests || []}
                appointment={appointmentData}
                staff={assignedStaff || null}
                resources={resources || []}
                memberships={memberships || []}
                isWaiting={appointmentData?.status !== 'servicing'}
            />
        );
    }

    // v7 — NEW: stale/past-due appointment check. Only reached if none of
    // the above matched — status isn't cancelled/completed, and the client
    // never checked in or started service. If the appointment's own end
    // time (or start time, if end time is missing) is more than 3 hours in
    // the past, treat this as a dead link rather than showing the normal
    // arrival flow. The 3-hour buffer intentionally still allows the
    // legitimate "running very late same-day" case to tap "I Have Arrived"
    // — this only catches genuinely stale appointments (yesterday, last
    // week, etc.) that nothing ever explicitly resolved.
    const referenceEnd = appointmentData?.endTime || appointmentData?.startTime;
    const isStaleUnresolved = referenceEnd
        ? (Date.now() - safeDate(referenceEnd).getTime()) > 3 * 60 * 60 * 1000
        : false;

    if (isStaleUnresolved) {
        return <StaleAppointmentView tenantName={tenant?.name} tenantPhone={tenant?.twilioPhoneNumber} />;
    }

    // v8 — NEW: the mirror check. isSameDay rather than an hours-based
    // threshold deliberately — someone arriving 3 hours before a 2pm slot
    // is completely normal and shouldn't be blocked, but any DIFFERENT
    // calendar day (a week out, tomorrow, whenever) should not show live
    // arrival buttons at all.
    const isTooEarly = appointmentData?.startTime
        ? !isSameDay(safeDate(appointmentData.startTime), new Date())
            && safeDate(appointmentData.startTime).getTime() > Date.now()
        : false;

    if (isTooEarly) {
        return <TooEarlyView startTime={appointmentData!.startTime} serviceName={service?.name} />;
    }

    return (
        <AnimatePresence mode="wait">
            {!entered ? (
                <motion.div 
                    key="entry"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background px-6 text-center"
                >
                    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
                        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
                    </div>

                    <motion.div
                        initial={{ scale: 0.9, y: 20, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-10 space-y-12 max-w-sm w-full"
                    >
                        <div className="flex flex-col items-center gap-8">
                            <div className="p-6 bg-white rounded-[2.5rem] shadow-3xl border-4 border-primary/5">
                                <ClarityFlowLogo className="w-16 h-16" />
                            </div>
                            <div className="space-y-3">
                                <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">Hello,<br/><span className="text-primary italic font-serif lowercase tracking-normal">{client?.name.split(' ')[0]}</span></h1>
                                <p className="text-sm font-bold text-muted-foreground uppercase tracking-[0.3em] opacity-60">Verified Identity</p>
                            </div>
                        </div>

                        <Button 
                            size="lg" 
                            onClick={() => setEntered(true)}
                            className="w-full h-20 rounded-[2.5rem] text-xl font-black uppercase tracking-widest shadow-3xl shadow-primary/30 group active:scale-95 transition-all"
                        >
                            Enter Studio <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-2" />
                        </Button>
                    </motion.div>
                </motion.div>
            ) : (
                <ViewContainer key="options">
                    <ViewHeader title="Portal Active" subtitle="Certify your arrival protocol" icon={Fingerprint} />
                    <CardContent className="p-8 md:p-12 text-center space-y-10">
                        <div className="p-8 rounded-[3rem] bg-primary/5 border-2 border-primary/10 shadow-inner space-y-6">
                            <CalendarIcon className="w-12 h-12 text-primary mx-auto opacity-40" />
                            <div className="space-y-1.5">
                                <p className="text-[10px] font-black uppercase text-primary tracking-[0.3em]">Technical Agenda</p>
                                <h3 className="text-2xl font-black uppercase text-slate-900 leading-tight">{service?.name}</h3>
                                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{format(safeDate(appointmentData?.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                            </div>
                        </div>

                        <div className="space-y-8">
                            <p className="text-sm md:text-lg font-medium text-slate-500 leading-relaxed px-6">Ready for your transformation? Please certify your status below to begin the concierge sequence.</p>
                            
                            <div className="grid gap-4">
                                <Button 
                                    onClick={() => updateStatus('arrived')} 
                                    className="w-full h-16 md:h-20 rounded-[2rem] text-lg md:text-2xl font-black uppercase tracking-tight shadow-3xl shadow-primary/30 group"
                                >
                                    I Have Arrived <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-1" />
                                </Button>
                                <div className="grid grid-cols-2 gap-4">
                                    <Button 
                                        variant="outline" 
                                        onClick={() => updateStatus('on_my_way')} 
                                        className="h-14 md:h-16 rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-widest bg-white shadow-sm"
                                    >
                                        <Car className="w-5 h-5 mr-2 text-primary" /> En Route
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        onClick={() => updateStatus('running_late', 15)} 
                                        className="h-14 md:h-16 rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-widest bg-white shadow-sm"
                                    >
                                        <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" /> Late
                                    </Button>
                                </div>
                            </div>

                            {assignedStaff && (
                                <div className="flex items-center gap-5 p-5 rounded-[2rem] border-2 bg-muted/5 shadow-inner text-left">
                                    <Avatar className="h-14 w-14 border-4 border-background shadow-xl rounded-[1.5rem] shrink-0">
                                        <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-sm bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div className="text-left flex-1 min-w-0">
                                        <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1 text-left">Professional Mastery</p>
                                        <p className="font-black text-sm md:text-lg uppercase text-slate-800 leading-none truncate text-left">{assignedStaff.name}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div className="pt-6 border-t border-dashed space-y-3">
                            <Button asChild variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase text-[10px] bg-white shadow-sm">
                                <Link href={`/portal/${tenantId}/${clientId}`}>
                                    <LayoutDashboard className="w-4 h-4 mr-3 opacity-40" />
                                    Access Private Dashboard
                                </Link>
                            </Button>
                            <button
                                type="button"
                                onClick={() => setShowCancelFlow(true)}
                                className="w-full text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:text-destructive transition-colors"
                            >
                                Can't make it? Cancel appointment
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowNotificationSettings(true)}
                                className="w-full text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:text-primary transition-colors"
                            >
                                Notification settings
                            </button>
                        </div>
                    </CardContent>
                </ViewContainer>
            )}
        </AnimatePresence>
    );
}
