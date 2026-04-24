'use client';

/**
 * Public Quote Inquiry Form
 * Route: src/app/inquiry/[tenantId]/page.tsx
 *
 * Standalone Firebase — no auth required.
 * Writes to: tenants/{tenantId}/quoteRequests/{id}
 *
 * Collects everything the owner needs to pre-fill the quote builder:
 * - Contact info
 * - Event type, date, location, guest count
 * - Services of interest (pulled from tenant's service menu)
 * - Budget range
 * - Staffing needs
 * - Travel required
 * - Special requests / notes
 * - How they heard about you
 * - Preferred contact method + best time to reach
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import {
    ChevronRight, ChevronLeft, Check, Loader, AlertTriangle,
    User, Mail, Phone, Calendar, MapPin, Users, DollarSign,
    Scissors, Sparkles, Heart, Clock, MessageSquare, Star,
    CheckCircle2, ArrowRight, Building, Car, Plane,
    Camera, Music, Palette, Coffee, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// ─── Firebase ─────────────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'contact' | 'event' | 'services' | 'logistics' | 'budget' | 'final' | 'done';

const STEPS: Step[] = ['contact', 'event', 'services', 'logistics', 'budget', 'final'];

const STEP_META: Record<Step, { title: string; subtitle: string; icon: any }> = {
    contact:   { title: 'About You',        subtitle: 'How we reach you',          icon: User },
    event:     { title: 'Your Event',        subtitle: 'Tell us what you\'re planning', icon: Calendar },
    services:  { title: 'What You Need',     subtitle: 'Services of interest',      icon: Scissors },
    logistics: { title: 'Location & Travel', subtitle: 'Where and how',             icon: MapPin },
    budget:    { title: 'Investment',        subtitle: 'Budget & timeline',         icon: DollarSign },
    final:     { title: 'Final Details',     subtitle: 'Anything else we should know', icon: MessageSquare },
    done:      { title: 'Done!',             subtitle: '',                          icon: CheckCircle2 },
};

const EVENT_TYPES = [
    { id: 'wedding',     label: 'Wedding',          icon: Heart },
    { id: 'bridal',      label: 'Bridal Party',      icon: Sparkles },
    { id: 'birthday',    label: 'Birthday',          icon: Star },
    { id: 'corporate',   label: 'Corporate Event',   icon: Building },
    { id: 'photoshoot',  label: 'Photoshoot',        icon: Camera },
    { id: 'prom',        label: 'Prom / Formal',     icon: Music },
    { id: 'babyshower',  label: 'Baby Shower',       icon: Heart },
    { id: 'graduation',  label: 'Graduation',        icon: Star },
    { id: 'other',       label: 'Something Else',    icon: Palette },
];

const BUDGET_RANGES = [
    { id: 'under_500',    label: 'Under $500' },
    { id: '500_1000',     label: '$500 – $1,000' },
    { id: '1000_2500',    label: '$1,000 – $2,500' },
    { id: '2500_5000',    label: '$2,500 – $5,000' },
    { id: '5000_10000',   label: '$5,000 – $10,000' },
    { id: 'over_10000',   label: '$10,000+' },
    { id: 'flexible',     label: 'Flexible / Unsure' },
];

const CONTACT_METHODS = [
    { id: 'email',  label: 'Email' },
    { id: 'phone',  label: 'Phone Call' },
    { id: 'text',   label: 'Text / SMS' },
];

const REFERRAL_SOURCES = [
    'Instagram', 'Google', 'Referral from a friend', 'Wedding planner',
    'The Knot / WeddingWire', 'TikTok', 'Facebook', 'Pinterest', 'Other',
];

const TIMELINE_OPTIONS = [
    { id: 'asap',       label: 'ASAP' },
    { id: '1_month',    label: 'Within 1 month' },
    { id: '3_months',   label: '1–3 months' },
    { id: '6_months',   label: '3–6 months' },
    { id: '1_year',     label: '6–12 months' },
    { id: 'over_year',  label: '1+ year away' },
];

// ─── Progress bar ─────────────────────────────────────────────────────────────
const ProgressBar = ({ current, total }: { current: number; total: number }) => (
    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
        <motion.div
            className="h-full bg-white rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${((current + 1) / total) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
        />
    </div>
);

// ─── Choice pill ──────────────────────────────────────────────────────────────
const Pill = ({
    selected, onClick, children, className,
}: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }) => (
    <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        className={cn(
            'relative px-5 py-3 rounded-2xl border-2 text-left transition-all duration-150 font-bold text-sm',
            selected
                ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
            className
        )}
    >
        {selected && (
            <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                <Check className="w-2.5 h-2.5 text-slate-900" />
            </span>
        )}
        {children}
    </motion.button>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────
const Field = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
    <div className="space-y-2">
        <label className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{label}</label>
        {children}
        {error && <p className="text-[10px] font-bold text-red-500">{error}</p>}
    </div>
);

const FieldInput = ({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) => (
    <input
        {...props}
        className={cn(
            'w-full h-13 rounded-2xl border-2 px-4 py-3.5 text-sm font-bold text-slate-800 bg-white outline-none transition-all',
            'placeholder:text-slate-300 focus:border-slate-400',
            error ? 'border-red-300 bg-red-50' : 'border-slate-200',
            props.className
        )}
    />
);

const FieldTextarea = ({ error, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) => (
    <textarea
        {...props}
        className={cn(
            'w-full rounded-2xl border-2 px-4 py-3.5 text-sm font-bold text-slate-800 bg-white outline-none transition-all resize-none',
            'placeholder:text-slate-300 focus:border-slate-400',
            error ? 'border-red-300 bg-red-50' : 'border-slate-200',
            props.className
        )}
    />
);

// ─── Main page ────────────────────────────────────────────────────────────────
export default function QuoteInquiryPage() {
    const params   = useParams();
    const tenantId = params.tenantId as string;

    const [tenant,       setTenant]       = useState<any>(null);
    const [services,     setServices]     = useState<any[]>([]);
    const [dataLoading,  setDataLoading]  = useState(true);
    const [step,         setStep]         = useState<Step>('contact');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError,  setSubmitError]  = useState('');
    const [errors,       setErrors]       = useState<Record<string, string>>({});

    // ── Form state ────────────────────────────────────────────────────────────
    // Contact
    const [firstName,        setFirstName]        = useState('');
    const [lastName,         setLastName]         = useState('');
    const [email,            setEmail]            = useState('');
    const [phone,            setPhone]            = useState('');
    const [preferredContact, setPreferredContact] = useState('email');
    const [bestTime,         setBestTime]         = useState('');

    // Event
    const [eventType,    setEventType]    = useState('');
    const [eventDate,    setEventDate]    = useState('');
    const [eventDate2,   setEventDate2]   = useState(''); // alternate date
    const [eventName,    setEventName]    = useState('');
    const [guestCount,   setGuestCount]   = useState('');
    const [partySize,    setPartySize]    = useState(''); // # of people needing services

    // Services
    const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
    const [customServiceNote,  setCustomServiceNote]  = useState('');

    // Logistics
    const [venueType,        setVenueType]        = useState(''); // studio / on-site / destination
    const [venueName,        setVenueName]        = useState('');
    const [venueCity,        setVenueCity]        = useState('');
    const [venueState,       setVenueState]       = useState('');
    const [travelRequired,   setTravelRequired]   = useState(false);
    const [travelDetails,    setTravelDetails]    = useState('');
    const [startTime,        setStartTime]        = useState('');
    const [endTime,          setEndTime]          = useState('');

    // Budget
    const [budgetRange,  setBudgetRange]  = useState('');
    const [timeline,     setTimeline]     = useState('');
    const [hasDeposit,   setHasDeposit]   = useState<boolean | null>(null);

    // Final
    const [referralSource, setReferralSource] = useState('');
    const [specialRequests, setSpecialRequests] = useState('');
    const [hasInspo,       setHasInspo]       = useState(false);
    const [inspoLinks,     setInspoLinks]     = useState('');
    const [agreedToTerms,  setAgreedToTerms]  = useState(false);

    // ── Load tenant + services ────────────────────────────────────────────────
    useEffect(() => {
        if (!tenantId) return;
        const load = async () => {
            try {
                const db = getDb();
                const [tenantSnap, servicesSnap] = await Promise.all([
                    getDoc(doc(db, `tenants/${tenantId}`)),
                    // Load services so client can pick what they want
                    getDoc(doc(db, `tenants/${tenantId}`)).then(async () => {
                        const { getDocs } = await import('firebase/firestore');
                        return getDocs(collection(db, `tenants/${tenantId}/services`));
                    }),
                ]);
                if (tenantSnap.exists()) setTenant(tenantSnap.data());
                setServices(servicesSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter((s: any) => s.type !== 'addon') // only primary services
                );
            } catch (e) {
                console.error(e);
            } finally {
                setDataLoading(false);
            }
        };
        load();
    }, [tenantId]);

    const currentStepIndex = STEPS.indexOf(step);
    const primaryColor = tenant?.kioskSettings?.primaryColor || '#0f172a';
    const logoUrl      = tenant?.kioskSettings?.logoUrl;
    const studioName   = tenant?.name || 'Studio';

    // ── Validation per step ───────────────────────────────────────────────────
    const validateStep = (): boolean => {
        const e: Record<string, string> = {};
        if (step === 'contact') {
            if (!firstName.trim()) e.firstName = 'Required';
            if (!lastName.trim())  e.lastName  = 'Required';
            if (!email.trim())     e.email     = 'Required';
            if (email && !/^\S+@\S+\.\S+$/.test(email)) e.email = 'Invalid email';
            if (!phone.trim())     e.phone     = 'Required';
        }
        if (step === 'event') {
            if (!eventType)        e.eventType = 'Please select an event type';
            if (!eventDate)        e.eventDate = 'Required';
            if (!guestCount)       e.guestCount = 'Required';
        }
        if (step === 'services') {
            if (selectedServiceIds.length === 0 && !customServiceNote.trim())
                e.services = 'Please select at least one service or describe what you need';
        }
        if (step === 'budget') {
            if (!budgetRange)  e.budgetRange = 'Please select a budget range';
            if (!timeline)     e.timeline    = 'Please select a timeline';
        }
        if (step === 'final') {
            if (!agreedToTerms) e.terms = 'Please agree to be contacted';
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleNext = () => {
        if (!validateStep()) return;
        const idx = STEPS.indexOf(step);
        if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
    };

    const handleBack = () => {
        const idx = STEPS.indexOf(step);
        if (idx > 0) setStep(STEPS[idx - 1]);
    };

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!validateStep()) return;
        setIsSubmitting(true);
        setSubmitError('');
        try {
            const db = getDb();
            const id = nanoid();
            const selectedServiceDetails = services
                .filter(s => selectedServiceIds.includes(s.id))
                .map(s => ({ id: s.id, name: s.name, price: s.price || 0, duration: s.duration || 60 }));

            const requestData = {
                id,
                tenantId,
                status: 'new', // new | reviewing | quoted | converted | closed

                // Contact
                firstName:        firstName.trim(),
                lastName:         lastName.trim(),
                fullName:         `${firstName.trim()} ${lastName.trim()}`,
                email:            email.trim().toLowerCase(),
                phone:            phone.trim(),
                preferredContact,
                bestTime:         bestTime.trim(),

                // Event
                eventType,
                eventName:        eventName.trim() || `${firstName.trim()}'s ${EVENT_TYPES.find(e => e.id === eventType)?.label || 'Event'}`,
                eventDate:        eventDate,
                alternateDateA:   eventDate2 || null,
                guestCount:       parseInt(guestCount) || 0,
                partySize:        parseInt(partySize) || parseInt(guestCount) || 0,

                // Services
                interestedServiceIds:   selectedServiceIds,
                interestedServices:     selectedServiceDetails,
                customServiceNote:      customServiceNote.trim() || null,

                // Logistics
                venueType:        venueType || null,
                venueName:        venueName.trim() || null,
                venueCity:        venueCity.trim() || null,
                venueState:       venueState.trim() || null,
                eventLocation:    [venueName, venueCity, venueState].filter(Boolean).join(', ') || null,
                travelRequired,
                travelDetails:    travelDetails.trim() || null,
                startTime:        startTime || null,
                endTime:          endTime || null,

                // Estimate total hours from selected services
                estimatedHours: selectedServiceDetails.reduce((a, s) => a + (s.duration / 60), 0) || null,

                // Budget
                budgetRange,
                timeline,
                readyToDeposit:   hasDeposit,

                // Final
                referralSource:   referralSource || null,
                specialRequests:  specialRequests.trim() || null,
                inspirationLinks: inspoLinks.trim() || null,

                // Meta
                submittedAt: new Date().toISOString(),
                source:      'inquiry_form',
                viewed:      false,
                priority:    guestCount && parseInt(guestCount) >= 20 ? 'high' : 'normal',
            };

            await addDoc(collection(db, `tenants/${tenantId}/quoteRequests`), requestData);
            setStep('done');
        } catch (e) {
            console.error(e);
            setSubmitError('Something went wrong. Please try again or contact us directly.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Loading ───────────────────────────────────────────────────────────────
    if (dataLoading) return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: primaryColor }}>
            <Loader className="w-8 h-8 animate-spin text-white/40" />
        </div>
    );

    const isLastStep = step === 'final';

    return (
        <div className="min-h-screen" style={{ background: '#f8fafc' }}>
            {/* Header */}
            <div className="sticky top-0 z-20" style={{ background: primaryColor }}>
                <div className="max-w-xl mx-auto px-6 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                        {logoUrl ? (
                            <img src={logoUrl} alt={studioName} className="h-7 w-auto object-contain brightness-0 invert" />
                        ) : (
                            <p className="text-white font-black uppercase tracking-widest text-sm">{studioName}</p>
                        )}
                        {step !== 'done' && (
                            <p className="text-white/50 text-[10px] font-black uppercase tracking-widest">
                                Step {currentStepIndex + 1} of {STEPS.length}
                            </p>
                        )}
                    </div>
                    {step !== 'done' && <ProgressBar current={currentStepIndex} total={STEPS.length} />}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-xl mx-auto px-6 py-8">
                <AnimatePresence mode="wait">

                    {/* ── CONTACT ── */}
                    {step === 'contact' && (
                        <motion.div key="contact" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Let's get acquainted.</h1>
                                <p className="text-slate-500 font-medium">We'll use this to send your personalized quote.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Field label="First Name" error={errors.firstName}>
                                    <FieldInput value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jessica" error={errors.firstName} />
                                </Field>
                                <Field label="Last Name" error={errors.lastName}>
                                    <FieldInput value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Williams" error={errors.lastName} />
                                </Field>
                            </div>

                            <Field label="Email Address" error={errors.email}>
                                <FieldInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jessica@email.com" error={errors.email} />
                            </Field>

                            <Field label="Phone Number" error={errors.phone}>
                                <FieldInput type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" error={errors.phone} />
                            </Field>

                            <Field label="Preferred Contact Method">
                                <div className="flex gap-2">
                                    {CONTACT_METHODS.map(m => (
                                        <Pill key={m.id} selected={preferredContact === m.id} onClick={() => setPreferredContact(m.id)} className="flex-1 text-center text-xs">
                                            {m.label}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>

                            <Field label="Best Time to Reach You (optional)">
                                <FieldInput value={bestTime} onChange={e => setBestTime(e.target.value)} placeholder="e.g. Weekdays after 5pm, or anytime" />
                            </Field>
                        </motion.div>
                    )}

                    {/* ── EVENT ── */}
                    {step === 'event' && (
                        <motion.div key="event" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Tell us about your event.</h1>
                                <p className="text-slate-500 font-medium">The more detail, the more accurate your quote.</p>
                            </div>

                            <Field label="Event Type" error={errors.eventType}>
                                <div className="grid grid-cols-3 gap-2">
                                    {EVENT_TYPES.map(e => {
                                        const Icon = e.icon;
                                        return (
                                            <Pill key={e.id} selected={eventType === e.id} onClick={() => setEventType(e.id)} className="flex flex-col items-center gap-1.5 py-4 text-center text-[11px]">
                                                <Icon className="w-5 h-5" />
                                                {e.label}
                                            </Pill>
                                        );
                                    })}
                                </div>
                                {errors.eventType && <p className="text-[10px] font-bold text-red-500">{errors.eventType}</p>}
                            </Field>

                            <Field label="Event Name / Title (optional)">
                                <FieldInput value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. The Williams Wedding, Sarah's 30th Birthday" />
                            </Field>

                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Preferred Date" error={errors.eventDate}>
                                    <FieldInput type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} error={errors.eventDate} />
                                </Field>
                                <Field label="Alternate Date (optional)">
                                    <FieldInput type="date" value={eventDate2} onChange={e => setEventDate2(e.target.value)} />
                                </Field>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Total Guest Count" error={errors.guestCount}>
                                    <FieldInput type="number" value={guestCount} onChange={e => setGuestCount(e.target.value)} placeholder="e.g. 150" error={errors.guestCount} />
                                </Field>
                                <Field label="# Needing Services">
                                    <FieldInput type="number" value={partySize} onChange={e => setPartySize(e.target.value)} placeholder="e.g. 6 (bridal party)" />
                                </Field>
                            </div>
                        </motion.div>
                    )}

                    {/* ── SERVICES ── */}
                    {step === 'services' && (
                        <motion.div key="services" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">What services do you need?</h1>
                                <p className="text-slate-500 font-medium">Select everything that applies — we'll build from here.</p>
                            </div>

                            {services.length > 0 ? (
                                <Field label="Services" error={errors.services}>
                                    <div className="space-y-2">
                                        {services.map((svc: any) => {
                                            const selected = selectedServiceIds.includes(svc.id);
                                            return (
                                                <motion.button
                                                    key={svc.id}
                                                    whileTap={{ scale: 0.99 }}
                                                    onClick={() => setSelectedServiceIds(prev =>
                                                        prev.includes(svc.id)
                                                            ? prev.filter(id => id !== svc.id)
                                                            : [...prev, svc.id]
                                                    )}
                                                    className={cn(
                                                        'w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-4',
                                                        selected
                                                            ? 'border-slate-900 bg-slate-900 text-white'
                                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                                    )}
                                                >
                                                    <div className="min-w-0">
                                                        <p className={cn('font-black text-sm uppercase tracking-tight', selected ? 'text-white' : 'text-slate-900')}>
                                                            {svc.name}
                                                        </p>
                                                        {svc.description && (
                                                            <p className={cn('text-[11px] mt-0.5 truncate', selected ? 'text-white/60' : 'text-slate-400')}>
                                                                {svc.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        {svc.price && (
                                                            <span className={cn('font-black font-mono text-sm', selected ? 'text-white/80' : 'text-slate-500')}>
                                                                ${svc.price}
                                                            </span>
                                                        )}
                                                        <div className={cn(
                                                            'w-6 h-6 rounded-full border-2 flex items-center justify-center',
                                                            selected ? 'border-white bg-white' : 'border-slate-300'
                                                        )}>
                                                            {selected && <Check className="w-3.5 h-3.5 text-slate-900" />}
                                                        </div>
                                                    </div>
                                                </motion.button>
                                            );
                                        })}
                                    </div>
                                </Field>
                            ) : (
                                <div className="p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 text-center text-slate-400 text-sm font-bold">
                                    No services listed yet — describe what you need below.
                                </div>
                            )}

                            <Field label="Don't see what you need? Describe it here." error={errors.services}>
                                <FieldTextarea
                                    value={customServiceNote}
                                    onChange={e => setCustomServiceNote(e.target.value)}
                                    placeholder="e.g. Full glam for 8 bridesmaids, airbrush foundation, lashes included..."
                                    rows={3}
                                    error={errors.services}
                                />
                            </Field>
                        </motion.div>
                    )}

                    {/* ── LOGISTICS ── */}
                    {step === 'logistics' && (
                        <motion.div key="logistics" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Where and when?</h1>
                                <p className="text-slate-500 font-medium">This helps us calculate travel and timing.</p>
                            </div>

                            <Field label="Service Location">
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'studio',      label: 'At the Studio', icon: Building },
                                        { id: 'on_site',     label: 'On-Site',       icon: MapPin },
                                        { id: 'destination', label: 'Destination',   icon: Plane },
                                    ].map(opt => {
                                        const Icon = opt.icon;
                                        return (
                                            <Pill key={opt.id} selected={venueType === opt.id} onClick={() => setVenueType(opt.id)} className="flex flex-col items-center gap-1.5 py-4 text-center text-[11px]">
                                                <Icon className="w-4 h-4" />
                                                {opt.label}
                                            </Pill>
                                        );
                                    })}
                                </div>
                            </Field>

                            {(venueType === 'on_site' || venueType === 'destination') && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                                    <Field label="Venue / Hotel Name">
                                        <FieldInput value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="e.g. The Ritz-Carlton, Private Residence" />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Field label="City">
                                            <FieldInput value={venueCity} onChange={e => setVenueCity(e.target.value)} placeholder="Atlanta" />
                                        </Field>
                                        <Field label="State">
                                            <FieldInput value={venueState} onChange={e => setVenueState(e.target.value)} placeholder="GA" />
                                        </Field>
                                    </div>
                                </motion.div>
                            )}

                            {venueType === 'destination' && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                                    <Field label="Travel Details">
                                        <FieldTextarea
                                            value={travelDetails}
                                            onChange={e => setTravelDetails(e.target.value)}
                                            placeholder="e.g. Cancun, Mexico — all-inclusive resort, flights covered by couple"
                                            rows={2}
                                        />
                                    </Field>
                                </motion.div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Services Start Time">
                                    <FieldInput type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                                </Field>
                                <Field label="Must Be Done By">
                                    <FieldInput type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                                </Field>
                            </div>

                            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-100">
                                <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
                                    💡 Not sure about timing? That's okay — we'll work through it together when we follow up.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {/* ── BUDGET ── */}
                    {step === 'budget' && (
                        <motion.div key="budget" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Investment & timeline.</h1>
                                <p className="text-slate-500 font-medium">Helps us tailor the right proposal for you.</p>
                            </div>

                            <Field label="Budget Range" error={errors.budgetRange}>
                                <div className="grid grid-cols-2 gap-2">
                                    {BUDGET_RANGES.map(b => (
                                        <Pill key={b.id} selected={budgetRange === b.id} onClick={() => setBudgetRange(b.id)} className="text-sm py-3.5">
                                            {b.label}
                                        </Pill>
                                    ))}
                                </div>
                                {errors.budgetRange && <p className="text-[10px] font-bold text-red-500">{errors.budgetRange}</p>}
                            </Field>

                            <Field label="How soon do you need this?" error={errors.timeline}>
                                <div className="grid grid-cols-2 gap-2">
                                    {TIMELINE_OPTIONS.map(t => (
                                        <Pill key={t.id} selected={timeline === t.id} onClick={() => setTimeline(t.id)} className="text-sm py-3.5">
                                            {t.label}
                                        </Pill>
                                    ))}
                                </div>
                                {errors.timeline && <p className="text-[10px] font-bold text-red-500">{errors.timeline}</p>}
                            </Field>

                            <Field label="Are you prepared to make a deposit to secure your date?">
                                <div className="grid grid-cols-2 gap-3">
                                    <Pill selected={hasDeposit === true}  onClick={() => setHasDeposit(true)}  className="text-center py-4">Yes, I'm ready</Pill>
                                    <Pill selected={hasDeposit === false} onClick={() => setHasDeposit(false)} className="text-center py-4">Not yet / Need info</Pill>
                                </div>
                            </Field>
                        </motion.div>
                    )}

                    {/* ── FINAL ── */}
                    {step === 'final' && (
                        <motion.div key="final" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-7">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Almost done!</h1>
                                <p className="text-slate-500 font-medium">A few last things to make your quote perfect.</p>
                            </div>

                            <Field label="How did you hear about us?">
                                <div className="grid grid-cols-2 gap-2 flex-wrap">
                                    {REFERRAL_SOURCES.map(src => (
                                        <Pill key={src} selected={referralSource === src} onClick={() => setReferralSource(src)} className="text-[12px] py-3">
                                            {src}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>

                            <Field label="Special Requests or Notes">
                                <FieldTextarea
                                    value={specialRequests}
                                    onChange={e => setSpecialRequests(e.target.value)}
                                    placeholder="Allergies, mobility needs, must-haves, deal-breakers, anything you want us to know..."
                                    rows={4}
                                />
                            </Field>

                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <motion.button
                                        onClick={() => setHasInspo(!hasInspo)}
                                        className={cn(
                                            'w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0',
                                            hasInspo ? 'border-slate-900 bg-slate-900' : 'border-slate-300'
                                        )}
                                    >
                                        {hasInspo && <Check className="w-3.5 h-3.5 text-white" />}
                                    </motion.button>
                                    <span className="text-sm font-bold text-slate-700">I have inspiration photos or links to share</span>
                                </label>

                                {hasInspo && (
                                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                                        <Field label="Inspiration Links (Pinterest, Instagram, etc.)">
                                            <FieldTextarea
                                                value={inspoLinks}
                                                onChange={e => setInspoLinks(e.target.value)}
                                                placeholder="https://pin.it/... or @username or describe the vibe..."
                                                rows={2}
                                            />
                                        </Field>
                                    </motion.div>
                                )}
                            </div>

                            <label className="flex items-start gap-3 cursor-pointer">
                                <motion.button
                                    onClick={() => setAgreedToTerms(!agreedToTerms)}
                                    className={cn(
                                        'w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all mt-0.5 shrink-0',
                                        agreedToTerms ? 'border-slate-900 bg-slate-900' : 'border-slate-300',
                                        errors.terms && 'border-red-400'
                                    )}
                                >
                                    {agreedToTerms && <Check className="w-3.5 h-3.5 text-white" />}
                                </motion.button>
                                <span className="text-[12px] text-slate-500 font-bold leading-relaxed">
                                    I agree to be contacted by {studioName} regarding my inquiry. My information will only be used to prepare my quote.
                                </span>
                            </label>
                            {errors.terms && <p className="text-[10px] font-bold text-red-500">{errors.terms}</p>}

                            {submitError && (
                                <div className="flex items-center gap-2 p-4 rounded-2xl bg-red-50 border-2 border-red-100">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                    <p className="text-[11px] font-bold text-red-600">{submitError}</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── DONE ── */}
                    {step === 'done' && (
                        <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-12 text-center space-y-8">
                            <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
                                className="w-24 h-24 rounded-[2rem] mx-auto flex items-center justify-center shadow-2xl"
                                style={{ background: primaryColor }}
                            >
                                <CheckCircle2 className="w-12 h-12 text-white" />
                            </motion.div>

                            <div className="space-y-3">
                                <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                                    We've got your inquiry!
                                </h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    Thank you, {firstName}! We'll review your details and reach out within 24–48 hours with a custom quote.
                                </p>
                            </div>

                            <div className="p-6 rounded-3xl bg-white border-2 border-slate-100 shadow-sm text-left space-y-3">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Your Request Summary</p>
                                <div className="space-y-2 text-sm font-bold text-slate-700">
                                    {eventName || eventType ? (
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-slate-300 shrink-0" />
                                            {eventName || EVENT_TYPES.find(e => e.id === eventType)?.label}
                                            {eventDate && ` · ${new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                                        </div>
                                    ) : null}
                                    {(venueCity || venueName) && (
                                        <div className="flex items-center gap-2">
                                            <MapPin className="w-4 h-4 text-slate-300 shrink-0" />
                                            {[venueName, venueCity, venueState].filter(Boolean).join(', ')}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <Mail className="w-4 h-4 text-slate-300 shrink-0" />
                                        {email}
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] text-slate-400 font-bold">
                                Have questions in the meantime? Reach us directly at{' '}
                                {tenant?.email && <a href={`mailto:${tenant.email}`} className="underline">{tenant.email}</a>}
                            </p>
                        </motion.div>
                    )}

                </AnimatePresence>

                {/* Navigation */}
                {step !== 'done' && (
                    <div className="mt-10 flex gap-3">
                        {currentStepIndex > 0 && (
                            <button
                                onClick={handleBack}
                                className="h-14 px-6 rounded-2xl border-2 border-slate-200 font-black text-slate-500 flex items-center gap-2 hover:border-slate-300 transition-all"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        )}
                        <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={isLastStep ? handleSubmit : handleNext}
                            disabled={isSubmitting}
                            className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 text-white disabled:opacity-50"
                            style={{ background: primaryColor }}
                        >
                            {isSubmitting ? (
                                <Loader className="w-5 h-5 animate-spin" />
                            ) : isLastStep ? (
                                <>Submit Inquiry <ArrowRight className="w-4 h-4" /></>
                            ) : (
                                <>Continue <ChevronRight className="w-4 h-4" /></>
                            )}
                        </motion.button>
                    </div>
                )}

                {/* Step labels */}
                {step !== 'done' && (
                    <div className="mt-6 text-center space-y-0.5">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                            {STEP_META[step].title}
                        </p>
                        <p className="text-[10px] font-bold text-slate-300">
                            {STEP_META[step].subtitle}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}