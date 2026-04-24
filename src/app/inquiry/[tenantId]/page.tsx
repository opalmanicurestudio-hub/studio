'use client';

/**
 * Public Quote Inquiry Form
 * Route: src/app/inquiry/[tenantId]/page.tsx
 *
 * Standalone Firebase — no auth required.
 * Writes to: tenants/{tenantId}/quoteRequests/{id}
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore, doc, getDoc, collection, addDoc, getDocs,
    query, where,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import {
    ChevronRight, ChevronLeft, Check, Loader, AlertTriangle,
    User, Mail, Phone, Calendar, MapPin, Users, DollarSign,
    Scissors, Sparkles, Heart, Clock, MessageSquare, Star,
    CheckCircle2, ArrowRight, Building, Car, Plane, Upload,
    Camera, Music, Palette, Coffee, X, Gift, Image as ImageIcon,
    Home, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

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

const getStorageInstance = () => {
    getDb(); // ensure app initialized
    return getStorage();
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'contact' | 'event' | 'services' | 'logistics' | 'budget' | 'final' | 'done';
const STEPS: Step[] = ['contact', 'event', 'services', 'logistics', 'budget', 'final'];

const STEP_META: Record<Step, { title: string; subtitle: string }> = {
    contact:   { title: 'About You',         subtitle: 'How we reach you' },
    event:     { title: 'Your Event',         subtitle: 'Tell us what you\'re planning' },
    services:  { title: 'What You Need',      subtitle: 'Services of interest' },
    logistics: { title: 'Location & Travel',  subtitle: 'Where and how' },
    budget:    { title: 'Investment',         subtitle: 'Budget & timeline' },
    final:     { title: 'Final Details',      subtitle: 'Anything else we should know' },
    done:      { title: 'Submitted!',         subtitle: '' },
};

const EVENT_TYPES = [
    { id: 'wedding',     label: 'Wedding',        icon: Heart },
    { id: 'bridal',      label: 'Bridal Party',   icon: Sparkles },
    { id: 'birthday',    label: 'Birthday',       icon: Star },
    { id: 'corporate',   label: 'Corporate',      icon: Building },
    { id: 'photoshoot',  label: 'Photoshoot',     icon: Camera },
    { id: 'prom',        label: 'Prom / Formal',  icon: Music },
    { id: 'babyshower',  label: 'Baby Shower',    icon: Heart },
    { id: 'graduation',  label: 'Graduation',     icon: Star },
    { id: 'other',       label: 'Something Else', icon: Palette },
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
    { id: 'email', label: 'Email' },
    { id: 'phone', label: 'Phone Call' },
    { id: 'text',  label: 'Text / SMS' },
];

const REFERRAL_SOURCES = [
    'Instagram', 'Google', 'Referral from a friend', 'Wedding planner',
    'The Knot / WeddingWire', 'TikTok', 'Facebook', 'Pinterest', 'Other',
];

const TIMELINE_OPTIONS = [
    { id: 'asap',      label: 'ASAP' },
    { id: '1_month',   label: 'Within 1 month' },
    { id: '3_months',  label: '1–3 months' },
    { id: '6_months',  label: '3–6 months' },
    { id: '1_year',    label: '6–12 months' },
    { id: 'over_year', label: '1+ year away' },
];

// FIX: Pre-filled day/time options for "best time to reach"
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['Morning (9am–12pm)', 'Afternoon (12pm–5pm)', 'Evening (5pm–8pm)', 'Anytime'];

// ─── Mileage calculator ───────────────────────────────────────────────────────
const COST_PER_MILE = 0.67; // IRS standard rate

async function calculateMileage(origin: string, destination: string): Promise<{ miles: number; cost: number; duration: string } | null> {
    try {
        // Use Nominatim to geocode both addresses, then calculate haversine distance
        const geocode = async (addr: string) => {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`);
            const data = await res.json();
            if (!data.length) return null;
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        };

        const [from, to] = await Promise.all([geocode(origin), geocode(destination)]);
        if (!from || !to) return null;

        // Haversine formula
        const R = 3958.8; // miles
        const dLat = (to.lat - from.lat) * Math.PI / 180;
        const dLon = (to.lon - from.lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        const straightLineMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        // Road distance is typically ~20–30% more than straight line
        const estimatedRoadMiles = straightLineMiles * 1.25;
        const roundTripMiles = estimatedRoadMiles * 2;
        const cost = roundTripMiles * COST_PER_MILE;
        const hours = Math.round((estimatedRoadMiles / 50) * 10) / 10; // assume 50mph avg
        const duration = hours < 1 ? `${Math.round(hours * 60)}m` : `~${hours.toFixed(1)}h`;

        return { miles: Math.round(roundTripMiles), cost: Math.round(cost * 100) / 100, duration };
    } catch {
        return null;
    }
}

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
const Pill = ({ selected, onClick, children, className }: {
    selected: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) => (
    <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        type="button"
        className={cn(
            'relative px-4 py-3 rounded-2xl border-2 text-left transition-all duration-150 font-bold text-sm',
            selected
                ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
            className
        )}
    >
        {selected && (
            <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-white flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5 text-slate-900" />
            </span>
        )}
        {children}
    </motion.button>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────
const Field = ({ label, error, hint, children }: {
    label: string; error?: string; hint?: string; children: React.ReactNode;
}) => (
    <div className="space-y-2">
        <label className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{label}</label>
        {children}
        {hint && !error && <p className="text-[9px] font-bold text-slate-400">{hint}</p>}
        {error && <p className="text-[9px] font-bold text-red-500">{error}</p>}
    </div>
);

const FieldInput = ({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) => (
    <input
        {...props}
        className={cn(
            'w-full rounded-2xl border-2 px-4 py-3.5 text-sm font-bold text-slate-800 bg-white outline-none transition-all',
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

// ─── Image uploader ───────────────────────────────────────────────────────────
const ImageUploader = ({ tenantId, onUploaded }: { tenantId: string; onUploaded: (urls: string[]) => void }) => {
    const [uploading, setUploading] = useState(false);
    const [uploaded, setUploaded] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            const storage = getStorageInstance();
            const urls: string[] = [];
            for (const file of Array.from(files)) {
                if (!file.type.startsWith('image/')) continue;
                const path = `tenants/${tenantId}/inquiryInspo/${nanoid()}_${file.name}`;
                const sRef = storageRef(storage, path);
                await uploadBytes(sRef, file);
                const url = await getDownloadURL(sRef);
                urls.push(url);
            }
            const newUploaded = [...uploaded, ...urls];
            setUploaded(newUploaded);
            onUploaded(newUploaded);
        } catch (e) {
            console.error('Upload error:', e);
        } finally {
            setUploading(false);
        }
    };

    const removeImage = (url: string) => {
        const updated = uploaded.filter(u => u !== url);
        setUploaded(updated);
        onUploaded(updated);
    };

    return (
        <div className="space-y-3">
            <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
                onDragOver={e => e.preventDefault()}
                className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-all"
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={e => handleFiles(e.target.files)}
                />
                {uploading ? (
                    <div className="flex flex-col items-center gap-2">
                        <Loader className="w-6 h-6 animate-spin text-slate-400" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Uploading...</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <Upload className="w-6 h-6 text-slate-300" />
                        <p className="text-xs font-bold text-slate-500">Tap to upload or drag & drop</p>
                        <p className="text-[9px] font-bold text-slate-300 uppercase">PNG, JPG, WEBP — multiple allowed</p>
                    </div>
                )}
            </div>
            {uploaded.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    {uploaded.map((url, i) => (
                        <div key={i} className="relative aspect-square rounded-xl overflow-hidden border-2 border-slate-200 group">
                            <img src={url} alt="" className="w-full h-full object-cover" />
                            <button
                                type="button"
                                onClick={() => removeImage(url)}
                                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function QuoteInquiryPage() {
    const params   = useParams();
    const router   = useRouter();
    const tenantId = params.tenantId as string;

    const [tenant,      setTenant]      = useState<any>(null);
    const [services,    setServices]    = useState<any[]>([]);
    const [studioAddress, setStudioAddress] = useState('');
    const [dataLoading, setDataLoading] = useState(true);
    const [step,        setStep]        = useState<Step>('contact');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [errors,      setErrors]      = useState<Record<string, string>>({});

    // ── Contact ────────────────────────────────────────────────────────────────
    const [firstName,        setFirstName]        = useState('');
    const [lastName,         setLastName]         = useState('');
    const [email,            setEmail]            = useState('');
    const [phone,            setPhone]            = useState('');
    const [preferredContact, setPreferredContact] = useState('email');
    // FIX: structured best-time selection
    const [bestDays,         setBestDays]         = useState<string[]>([]);
    const [bestTimeSlot,     setBestTimeSlot]     = useState('');

    // ── Event ──────────────────────────────────────────────────────────────────
    const [eventType,  setEventType]  = useState('');
    const [eventDate,  setEventDate]  = useState('');
    const [eventDate2, setEventDate2] = useState('');
    const [eventName,  setEventName]  = useState('');
    const [guestCount, setGuestCount] = useState('');
    const [partySize,  setPartySize]  = useState('');

    // ── Services ───────────────────────────────────────────────────────────────
    const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
    const [customServiceNote,  setCustomServiceNote]  = useState('');

    // ── Logistics ─────────────────────────────────────────────────────────────
    const [venueType,    setVenueType]    = useState('');
    const [venueName,    setVenueName]    = useState('');
    const [venueStreet,  setVenueStreet]  = useState('');
    const [venueCity,    setVenueCity]    = useState('');
    const [venueState,   setVenueState]   = useState('');
    const [venueZip,     setVenueZip]     = useState('');
    const [startTime,    setStartTime]    = useState('');
    const [endTime,      setEndTime]      = useState('');
    // FIX: mileage calculation
    const [mileageInfo, setMileageInfo]   = useState<{ miles: number; cost: number; duration: string } | null>(null);
    const [calcingMiles, setCalcingMiles] = useState(false);

    // ── Budget ─────────────────────────────────────────────────────────────────
    const [budgetRange, setBudgetRange] = useState('');
    const [timeline,    setTimeline]    = useState('');
    const [hasDeposit,  setHasDeposit]  = useState<boolean | null>(null);

    // ── Final ──────────────────────────────────────────────────────────────────
    const [referralSource,  setReferralSource]  = useState('');
    const [referralCode,    setReferralCode]    = useState('');
    const [showReferralCode, setShowReferralCode] = useState(false);
    const [specialRequests, setSpecialRequests] = useState('');
    const [inspoImageUrls,  setInspoImageUrls]  = useState<string[]>([]);
    const [agreedToTerms,   setAgreedToTerms]   = useState(false);

    // ── Load tenant + services ─────────────────────────────────────────────────
    useEffect(() => {
        if (!tenantId) return;
        const load = async () => {
            try {
                const db = getDb();
                const tenantSnap = await getDoc(doc(db, `tenants/${tenantId}`));
                if (tenantSnap.exists()) {
                    const t = tenantSnap.data();
                    setTenant(t);
                    // Store studio address for mileage calculation
                    const addr = t.studioAddress ||
                        [t.studioAddressParts?.street, t.studioAddressParts?.city, t.studioAddressParts?.state]
                            .filter(Boolean).join(', ');
                    setStudioAddress(addr || '');
                }
                // FIX: Load services from the proper subcollection
                const servicesSnap = await getDocs(collection(db, `tenants/${tenantId}/services`));
                const svcList = servicesSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter((s: any) => s.type !== 'addon' && s.status !== 'archived')
                    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
                setServices(svcList);
            } catch (e) {
                console.error(e);
            } finally {
                setDataLoading(false);
            }
        };
        load();
    }, [tenantId]);

    // FIX: Auto-calculate mileage when venue address is complete and venue type is on_site/destination
    useEffect(() => {
        if (venueType !== 'on_site' && venueType !== 'destination') {
            setMileageInfo(null);
            return;
        }
        const dest = [venueStreet, venueCity, venueState, venueZip].filter(Boolean).join(', ');
        if (!dest || dest.length < 10 || !studioAddress) return;

        const timer = setTimeout(async () => {
            setCalcingMiles(true);
            const result = await calculateMileage(studioAddress, dest);
            setMileageInfo(result);
            setCalcingMiles(false);
        }, 1200); // debounce

        return () => clearTimeout(timer);
    }, [venueStreet, venueCity, venueState, venueZip, venueType, studioAddress]);

    const currentStepIndex = STEPS.indexOf(step);
    const primaryColor = tenant?.kioskSettings?.primaryColor || '#0f172a';
    const logoUrl      = tenant?.kioskSettings?.logoUrl;
    const studioName   = tenant?.name || 'Studio';

    // ── Validation ─────────────────────────────────────────────────────────────
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
            if (!eventType)   e.eventType  = 'Please select an event type';
            if (!eventDate)   e.eventDate  = 'Required';
            if (!guestCount)  e.guestCount = 'Required';
        }
        if (step === 'services') {
            if (selectedServiceIds.length === 0 && !customServiceNote.trim())
                e.services = 'Please select at least one service or describe what you need';
        }
        if (step === 'budget') {
            if (!budgetRange) e.budgetRange = 'Please select a budget range';
            if (!timeline)    e.timeline   = 'Please select a timeline';
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

    // ── Submit ─────────────────────────────────────────────────────────────────
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

            const venueAddress = [venueStreet, venueCity, venueState, venueZip].filter(Boolean).join(', ');

            const requestData = {
                id,
                tenantId,
                status: 'new',

                // Contact
                firstName:        firstName.trim(),
                lastName:         lastName.trim(),
                fullName:         `${firstName.trim()} ${lastName.trim()}`,
                email:            email.trim().toLowerCase(),
                phone:            phone.trim(),
                preferredContact,
                bestDays:         bestDays.length > 0 ? bestDays : null,
                bestTimeSlot:     bestTimeSlot || null,

                // Event
                eventType,
                eventName:        eventName.trim() ||
                    `${firstName.trim()}'s ${EVENT_TYPES.find(e => e.id === eventType)?.label || 'Event'}`,
                eventDate,
                alternateDateA:   eventDate2 || null,
                guestCount:       parseInt(guestCount) || 0,
                partySize:        parseInt(partySize) || parseInt(guestCount) || 0,

                // Services — FIX: storing full service details from library
                interestedServiceIds:  selectedServiceIds,
                interestedServices:    selectedServiceDetails,
                customServiceNote:     customServiceNote.trim() || null,
                estimatedHours:        selectedServiceDetails.reduce((a, s) => a + (s.duration / 60), 0) || null,

                // Logistics
                venueType:        venueType || null,
                venueName:        venueName.trim() || null,
                venueStreet:      venueStreet.trim() || null,
                venueCity:        venueCity.trim() || null,
                venueState:       venueState.trim() || null,
                venueZip:         venueZip.trim() || null,
                eventLocation:    venueAddress || null,
                startTime:        startTime || null,
                endTime:          endTime || null,
                // FIX: mileage data pre-calculated
                estimatedMiles:   mileageInfo?.miles || null,
                estimatedTravelCost: mileageInfo?.cost || null,
                estimatedDriveTime:  mileageInfo?.duration || null,

                // Budget
                budgetRange,
                timeline,
                readyToDeposit:   hasDeposit,

                // Final
                referralSource:     referralSource || null,
                referralCode:       referralCode.trim().toUpperCase() || null,
                specialRequests:    specialRequests.trim() || null,
                inspirationImages:  inspoImageUrls.length > 0 ? inspoImageUrls : null,

                // Meta
                submittedAt: new Date().toISOString(),
                source:      'inquiry_form',
                viewed:      false,
                priority:    parseInt(guestCount) >= 20 ? 'high' : 'normal',
            };

            // FIX: write to quoteRequests at the correct path the InquiriesTab reads
            await addDoc(collection(db, `tenants/${tenantId}/quoteRequests`), requestData);
            setStep('done');
        } catch (e) {
            console.error(e);
            setSubmitError('Something went wrong. Please try again or contact us directly.');
        } finally {
            setIsSubmitting(false);
        }
    };

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
                        {/* FIX: logo with transparent background support — use img not next/image for external URLs */}
                        {logoUrl ? (
                            <img
                                src={logoUrl}
                                alt={studioName}
                                className="h-8 w-auto object-contain"
                                style={{ filter: 'brightness(0) invert(1)' }}
                            />
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
            <div className="max-w-xl mx-auto px-6 py-8 pb-32">
                <AnimatePresence mode="wait">

                    {/* ── CONTACT ── */}
                    {step === 'contact' && (
                        <motion.div key="contact" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Let's get acquainted.</h1>
                                <p className="text-slate-500 font-medium">We'll use this to send your personalized quote.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
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
                                        <Pill key={m.id} selected={preferredContact === m.id} onClick={() => setPreferredContact(m.id)} className="flex-1 text-center text-xs py-3">
                                            {m.label}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>

                            {/* FIX: structured best time — day chips + time slot */}
                            <Field label="Best Days to Reach You (optional)">
                                <div className="flex flex-wrap gap-2">
                                    {DAYS_OF_WEEK.map(d => (
                                        <Pill
                                            key={d}
                                            selected={bestDays.includes(d)}
                                            onClick={() => setBestDays(prev =>
                                                prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
                                            )}
                                            className="text-xs py-2 px-3"
                                        >
                                            {d.slice(0, 3)}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>

                            <Field label="Best Time of Day">
                                <div className="grid grid-cols-2 gap-2">
                                    {TIME_SLOTS.map(t => (
                                        <Pill key={t} selected={bestTimeSlot === t} onClick={() => setBestTimeSlot(t)} className="text-xs py-3 text-center">
                                            {t}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>
                        </motion.div>
                    )}

                    {/* ── EVENT ── */}
                    {step === 'event' && (
                        <motion.div key="event" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
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
                                {errors.eventType && <p className="text-[9px] font-bold text-red-500">{errors.eventType}</p>}
                            </Field>

                            <Field label="Event Name / Title (optional)">
                                <FieldInput value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. The Williams Wedding, Sarah's 30th" />
                            </Field>

                            {/* FIX: dates stacked on mobile to prevent clash */}
                            <div className="space-y-3">
                                <Field label="Preferred Date" error={errors.eventDate}>
                                    <FieldInput type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} error={errors.eventDate} className="w-full" />
                                </Field>
                                <Field label="Alternate Date (optional)" hint="If your first choice isn't available">
                                    <FieldInput type="date" value={eventDate2} onChange={e => setEventDate2(e.target.value)} className="w-full" />
                                </Field>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Total Guest Count" error={errors.guestCount}>
                                    <FieldInput type="number" value={guestCount} onChange={e => setGuestCount(e.target.value)} placeholder="e.g. 150" error={errors.guestCount} />
                                </Field>
                                <Field label="# Needing Services" hint="e.g. bridal party of 6">
                                    <FieldInput type="number" value={partySize} onChange={e => setPartySize(e.target.value)} placeholder="e.g. 6" />
                                </Field>
                            </div>
                        </motion.div>
                    )}

                    {/* ── SERVICES ── FIX: pull from library efficiently ── */}
                    {step === 'services' && (
                        <motion.div key="services" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">What services do you need?</h1>
                                <p className="text-slate-500 font-medium">Select everything that applies — we'll build from here.</p>
                            </div>

                            {services.length > 0 ? (
                                <Field label={`Services (${services.length} available)`} error={errors.services}>
                                    {/* Group by category for efficiency */}
                                    {(() => {
                                        const byCategory: Record<string, any[]> = {};
                                        services.forEach(s => {
                                            const cat = s.category || 'Other';
                                            if (!byCategory[cat]) byCategory[cat] = [];
                                            byCategory[cat].push(s);
                                        });
                                        return Object.entries(byCategory).map(([cat, svcs]) => (
                                            <div key={cat} className="space-y-2 mb-4">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">{cat}</p>
                                                <div className="space-y-2">
                                                    {svcs.map((svc: any) => {
                                                        const selected = selectedServiceIds.includes(svc.id);
                                                        return (
                                                            <motion.button
                                                                key={svc.id}
                                                                type="button"
                                                                whileTap={{ scale: 0.99 }}
                                                                onClick={() => setSelectedServiceIds(prev =>
                                                                    prev.includes(svc.id)
                                                                        ? prev.filter(id => id !== svc.id)
                                                                        : [...prev, svc.id]
                                                                )}
                                                                className={cn(
                                                                    'w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3',
                                                                    selected
                                                                        ? 'border-slate-900 bg-slate-900 text-white'
                                                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                                                )}
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <p className={cn('font-black text-sm uppercase tracking-tight', selected ? 'text-white' : 'text-slate-900')}>
                                                                        {svc.name}
                                                                    </p>
                                                                    <div className="flex items-center gap-3 mt-0.5">
                                                                        {svc.duration && (
                                                                            <span className={cn('text-[10px] font-bold', selected ? 'text-white/60' : 'text-slate-400')}>
                                                                                {svc.duration}m
                                                                            </span>
                                                                        )}
                                                                        {svc.description && (
                                                                            <span className={cn('text-[10px] font-medium truncate', selected ? 'text-white/60' : 'text-slate-400')}>
                                                                                {svc.description}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    {svc.price > 0 && (
                                                                        <span className={cn('font-black font-mono text-sm', selected ? 'text-white/80' : 'text-slate-500')}>
                                                                            ${svc.price}
                                                                        </span>
                                                                    )}
                                                                    <div className={cn(
                                                                        'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                                                                        selected ? 'border-white bg-white' : 'border-slate-300'
                                                                    )}>
                                                                        {selected && <Check className="w-3 h-3 text-slate-900" />}
                                                                    </div>
                                                                </div>
                                                            </motion.button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ));
                                    })()}
                                </Field>
                            ) : (
                                <div className="p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 text-center text-slate-400 text-sm font-bold">
                                    No services found — describe what you need below.
                                </div>
                            )}

                            <Field label="Don't see what you need? Describe it." error={errors.services}>
                                <FieldTextarea
                                    value={customServiceNote}
                                    onChange={e => setCustomServiceNote(e.target.value)}
                                    placeholder="e.g. Full glam for 8 bridesmaids, airbrush foundation, lashes..."
                                    rows={3}
                                />
                            </Field>

                            {selectedServiceIds.length > 0 && (
                                <div className="p-4 rounded-2xl bg-slate-900 text-white text-center">
                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Selected</p>
                                    <p className="text-2xl font-black">{selectedServiceIds.length} service{selectedServiceIds.length !== 1 ? 's' : ''}</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── LOGISTICS ── FIX: full address + mileage calc ── */}
                    {step === 'logistics' && (
                        <motion.div key="logistics" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Where and when?</h1>
                                <p className="text-slate-500 font-medium">This helps us calculate travel and timing.</p>
                            </div>

                            <Field label="Service Location">
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'studio',      label: 'At Studio',    icon: Building },
                                        { id: 'on_site',     label: 'On-Site',      icon: MapPin },
                                        { id: 'destination', label: 'Destination',  icon: Plane },
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
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                                    {/* FIX: complete address fields */}
                                    <Field label="Venue / Hotel Name">
                                        <FieldInput value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="e.g. The Ritz-Carlton" />
                                    </Field>
                                    <Field label="Street Address">
                                        <FieldInput value={venueStreet} onChange={e => setVenueStreet(e.target.value)} placeholder="123 Main Street" />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="City">
                                            <FieldInput value={venueCity} onChange={e => setVenueCity(e.target.value)} placeholder="Atlanta" />
                                        </Field>
                                        <Field label="State">
                                            <FieldInput value={venueState} onChange={e => setVenueState(e.target.value)} placeholder="GA" />
                                        </Field>
                                    </div>
                                    <Field label="ZIP Code">
                                        <FieldInput value={venueZip} onChange={e => setVenueZip(e.target.value)} placeholder="30301" />
                                    </Field>

                                    {/* FIX: mileage calculation result */}
                                    {calcingMiles && (
                                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-blue-50 border-2 border-blue-100">
                                            <Loader className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Calculating travel distance...</p>
                                        </div>
                                    )}
                                    {mileageInfo && !calcingMiles && (
                                        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                                            className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Estimated Travel</p>
                                            <div className="grid grid-cols-3 gap-3 text-center">
                                                <div>
                                                    <p className="text-xl font-black font-mono">{mileageInfo.miles}</p>
                                                    <p className="text-[8px] font-black uppercase opacity-40">mi round trip</p>
                                                </div>
                                                <div>
                                                    <p className="text-xl font-black font-mono">{mileageInfo.duration}</p>
                                                    <p className="text-[8px] font-black uppercase opacity-40">drive time</p>
                                                </div>
                                                <div>
                                                    <p className="text-xl font-black font-mono text-primary">${mileageInfo.cost}</p>
                                                    <p className="text-[8px] font-black uppercase opacity-40">est. mileage</p>
                                                </div>
                                            </div>
                                            <p className="text-[8px] font-bold opacity-30 text-center">Based on IRS standard rate · Straight-line estimate</p>
                                        </motion.div>
                                    )}
                                </motion.div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Services Start Time">
                                    <FieldInput type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                                </Field>
                                <Field label="Must Be Done By">
                                    <FieldInput type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                                </Field>
                            </div>
                        </motion.div>
                    )}

                    {/* ── BUDGET ── */}
                    {step === 'budget' && (
                        <motion.div key="budget" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
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
                                {errors.budgetRange && <p className="text-[9px] font-bold text-red-500">{errors.budgetRange}</p>}
                            </Field>

                            <Field label="How soon do you need this?" error={errors.timeline}>
                                <div className="grid grid-cols-2 gap-2">
                                    {TIMELINE_OPTIONS.map(t => (
                                        <Pill key={t.id} selected={timeline === t.id} onClick={() => setTimeline(t.id)} className="text-sm py-3.5">
                                            {t.label}
                                        </Pill>
                                    ))}
                                </div>
                                {errors.timeline && <p className="text-[9px] font-bold text-red-500">{errors.timeline}</p>}
                            </Field>

                            <Field label="Ready to make a deposit to secure your date?">
                                <div className="grid grid-cols-2 gap-3">
                                    <Pill selected={hasDeposit === true}  onClick={() => setHasDeposit(true)}  className="text-center py-4">Yes, I'm ready</Pill>
                                    <Pill selected={hasDeposit === false} onClick={() => setHasDeposit(false)} className="text-center py-4">Need more info</Pill>
                                </div>
                            </Field>
                        </motion.div>
                    )}

                    {/* ── FINAL ── */}
                    {step === 'final' && (
                        <motion.div key="final" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                            <div className="space-y-1.5">
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Almost done!</h1>
                                <p className="text-slate-500 font-medium">A few last things to make your quote perfect.</p>
                            </div>

                            <Field label="How did you hear about us?">
                                <div className="grid grid-cols-2 gap-2">
                                    {REFERRAL_SOURCES.map(src => (
                                        <Pill key={src} selected={referralSource === src} onClick={() => {
                                            setReferralSource(src);
                                            setShowReferralCode(src === 'Referral from a friend');
                                        }} className="text-xs py-3">
                                            {src}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>

                            {/* FIX: referral code input when referred by friend */}
                            <AnimatePresence>
                                {(showReferralCode || referralSource === 'Referral from a friend') && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                                        <Field label="Referral Code" hint="Your friend's referral code — they'll receive their perk when you book">
                                            <div className="relative">
                                                <Gift className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <FieldInput
                                                    value={referralCode}
                                                    onChange={e => setReferralCode(e.target.value.toUpperCase())}
                                                    placeholder="e.g. JESSICA2024"
                                                    className="pl-12 font-mono tracking-widest"
                                                />
                                            </div>
                                        </Field>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <Field label="Special Requests or Notes">
                                <FieldTextarea
                                    value={specialRequests}
                                    onChange={e => setSpecialRequests(e.target.value)}
                                    placeholder="Allergies, mobility needs, must-haves, deal-breakers..."
                                    rows={3}
                                />
                            </Field>

                            {/* FIX: image upload instead of just links */}
                            <Field label="Inspiration Photos (optional)" hint="Upload images directly — Pinterest screenshots, saved looks, etc.">
                                <ImageUploader tenantId={tenantId} onUploaded={setInspoImageUrls} />
                            </Field>

                            <label className="flex items-start gap-3 cursor-pointer">
                                <motion.button
                                    type="button"
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
                                    I agree to be contacted by {studioName} regarding my inquiry.
                                </span>
                            </label>
                            {errors.terms && <p className="text-[9px] font-bold text-red-500">{errors.terms}</p>}

                            {submitError && (
                                <div className="flex items-center gap-2 p-4 rounded-2xl bg-red-50 border-2 border-red-100">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                    <p className="text-[11px] font-bold text-red-600">{submitError}</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── DONE ── FIX: contact info + back to booking page ── */}
                    {step === 'done' && (
                        <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center space-y-8">
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
                                    Inquiry submitted!
                                </h2>
                                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                                    Thank you, {firstName}! We'll review your details and reach out with a custom quote within 24–48 hours.
                                </p>
                            </div>

                            {/* Summary card */}
                            <div className="p-6 rounded-3xl bg-white border-2 border-slate-100 shadow-sm text-left space-y-3">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Your Request Summary</p>
                                <div className="space-y-2 text-sm font-bold text-slate-700">
                                    {eventName || eventType ? (
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-slate-300 shrink-0" />
                                            <span>{eventName || EVENT_TYPES.find(e => e.id === eventType)?.label}
                                                {eventDate && ` · ${new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                                            </span>
                                        </div>
                                    ) : null}
                                    {selectedServiceIds.length > 0 && (
                                        <div className="flex items-start gap-2">
                                            <Scissors className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                                            <span>{selectedServiceIds.length} service{selectedServiceIds.length !== 1 ? 's' : ''} requested</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <Mail className="w-4 h-4 text-slate-300 shrink-0" />
                                        {email}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-slate-300 shrink-0" />
                                        {phone}
                                    </div>
                                </div>
                            </div>

                            {/* FIX: studio contact info on confirmation */}
                            {(tenant?.phone || tenant?.email || tenant?.address) && (
                                <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-3">
                                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Contact {studioName} Directly</p>
                                    <div className="space-y-2 text-sm font-bold text-slate-700">
                                        {tenant?.phone && (
                                            <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                                                <Phone className="w-4 h-4 text-slate-300 shrink-0" />
                                                {tenant.phone}
                                            </a>
                                        )}
                                        {tenant?.email && (
                                            <a href={`mailto:${tenant.email}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                                                <Mail className="w-4 h-4 text-slate-300 shrink-0" />
                                                {tenant.email}
                                            </a>
                                        )}
                                        {tenant?.studioAddress && (
                                            <div className="flex items-start gap-2">
                                                <MapPin className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                                                <span>{tenant.studioAddress}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* FIX: back to booking page */}
                            <div className="flex flex-col gap-3">
                                <Link
                                    href={`/book/${tenantId}`}
                                    className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 text-white"
                                    style={{ background: primaryColor }}
                                >
                                    <Home className="w-4 h-4" />
                                    Back to Booking Page
                                </Link>
                                <p className="text-[9px] font-bold text-slate-400 text-center">
                                    Browse services or book an appointment while you wait
                                </p>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>

                {/* Navigation */}
                {step !== 'done' && (
                    <div className="fixed bottom-0 left-0 right-0 px-6 pb-8 pt-4 bg-gradient-to-t from-[#f8fafc] via-[#f8fafc] to-transparent">
                        <div className="max-w-xl mx-auto flex gap-3">
                            {currentStepIndex > 0 && (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    className="h-14 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500 flex items-center gap-1 hover:border-slate-300 transition-all bg-white"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                            )}
                            <motion.button
                                type="button"
                                whileTap={{ scale: 0.98 }}
                                onClick={isLastStep ? handleSubmit : handleNext}
                                disabled={isSubmitting}
                                className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 text-white disabled:opacity-50 shadow-lg"
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
                    </div>
                )}

                {/* Step label */}
                {step !== 'done' && (
                    <div className="mt-6 text-center space-y-0.5 pb-24">
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