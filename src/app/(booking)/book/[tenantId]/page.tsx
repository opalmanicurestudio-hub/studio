'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client, Membership, Package, PricingTier } from '@/lib/data';
import { Loader, ArrowDown, Users, Sparkles, MapPin, Phone, Instagram, ArrowRight, FileText, Calendar, Star, ChevronRight, Palette } from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { isSameDay, parseISO, addMonths, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { BookingGallery } from '@/components/booking/BookingGallery';
import { BookingServices } from '@/components/booking/BookingServices';
import { BookingTeam } from '@/components/booking/BookingTeam';
import { BookingReviews } from '@/components/booking/BookingReviews';
import { BookingPolicies } from '@/components/booking/BookingPolicies';
import { Button } from '@/components/ui/button';
import { BookingFAQ } from '@/components/booking/BookingFAQ';
import { BookingContact } from '@/components/booking/BookingContact';
import { BookingWelcome } from '@/components/booking/BookingWelcome';
import { BookingMemberships } from '@/components/booking/BookingMemberships';
import { BookingPackages } from '@/components/booking/BookingPackages';
import { PurchaseSheet } from '@/components/booking/PurchaseSheet';
import Link from 'next/link';
import Image from 'next/image';

// ─── Safe helpers ─────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try { return parseISO(val); } catch { return new Date(val); }
    }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const sanitizeForFirestore = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
};

// ─── Theme system ─────────────────────────────────────────────────────────────
// Each theme is a set of CSS HSL variable values (no hsl() wrapper — matches shadcn convention)
// plus metadata for splash + typography tone.

export type BookingTheme = 'editorial' | 'soft_spa' | 'dark_glam' | 'bold_studio' | 'minimal_clean';

type ThemeConfig = {
    label:      string;
    description: string;
    vars:       Record<string, string>;
    splashMode: 'dark' | 'light'; // controls overlay and text color on splash
    heroOverlay: string;          // Tailwind class for hero image overlay
};

export const BOOKING_THEMES: Record<BookingTheme, ThemeConfig> = {
    editorial: {
        label:       'Editorial',
        description: 'Bold, high-contrast, luxury black & white',
        splashMode:  'dark',
        heroOverlay: 'bg-gradient-to-b from-white/60 via-white/20 to-white/80',
        vars: {
            '--primary':            '0 0% 9%',
            '--primary-foreground': '0 0% 100%',
            '--background':         '0 0% 100%',
            '--foreground':         '0 0% 9%',
            '--muted':              '0 0% 96%',
            '--muted-foreground':   '0 0% 45%',
            '--border':             '0 0% 89%',
            '--card':               '0 0% 100%',
            '--card-foreground':    '0 0% 9%',
            '--radius':             '1rem',
        },
    },
    soft_spa: {
        label:       'Soft Spa',
        description: 'Warm cream tones, calming & approachable',
        splashMode:  'light',
        heroOverlay: 'bg-gradient-to-b from-[#fdf6ef]/70 via-[#fdf6ef]/30 to-[#fdf6ef]/90',
        vars: {
            '--primary':            '340 28% 58%',
            '--primary-foreground': '0 0% 100%',
            '--background':         '35 28% 97%',
            '--foreground':         '20 20% 18%',
            '--muted':              '35 22% 92%',
            '--muted-foreground':   '20 12% 46%',
            '--border':             '35 22% 86%',
            '--card':               '35 28% 99%',
            '--card-foreground':    '20 20% 18%',
            '--radius':             '1.5rem',
        },
    },
    dark_glam: {
        label:       'Dark Glam',
        description: 'Deep black with gold accents, ultra premium',
        splashMode:  'dark',
        heroOverlay: 'bg-gradient-to-b from-[#090909]/80 via-[#090909]/40 to-[#090909]/90',
        vars: {
            '--primary':            '44 72% 52%',
            '--primary-foreground': '0 0% 5%',
            '--background':         '0 0% 6%',
            '--foreground':         '0 0% 93%',
            '--muted':              '0 0% 12%',
            '--muted-foreground':   '0 0% 58%',
            '--border':             '0 0% 18%',
            '--card':               '0 0% 9%',
            '--card-foreground':    '0 0% 93%',
            '--radius':             '0.75rem',
        },
    },
    bold_studio: {
        label:       'Bold Studio',
        description: 'Vibrant violet energy, Gen-Z forward',
        splashMode:  'light',
        heroOverlay: 'bg-gradient-to-b from-white/50 via-violet-50/20 to-white/80',
        vars: {
            '--primary':            '262 75% 58%',
            '--primary-foreground': '0 0% 100%',
            '--background':         '0 0% 100%',
            '--foreground':         '262 30% 10%',
            '--muted':              '262 18% 96%',
            '--muted-foreground':   '262 15% 44%',
            '--border':             '262 18% 88%',
            '--card':               '0 0% 100%',
            '--card-foreground':    '262 30% 10%',
            '--radius':             '2rem',
        },
    },
    minimal_clean: {
        label:       'Minimal Clean',
        description: 'Clinical white, trust-forward, spa-medical',
        splashMode:  'light',
        heroOverlay: 'bg-gradient-to-b from-white/60 via-white/20 to-white/85',
        vars: {
            '--primary':            '210 22% 32%',
            '--primary-foreground': '0 0% 100%',
            '--background':         '0 0% 99%',
            '--foreground':         '210 18% 14%',
            '--muted':              '210 12% 96%',
            '--muted-foreground':   '210 10% 48%',
            '--border':             '210 12% 91%',
            '--card':               '0 0% 100%',
            '--card-foreground':    '210 18% 14%',
            '--radius':             '0.375rem',
        },
    },
};

// ─── Theme-aware CSS variables builder ───────────────────────────────────────
function buildThemeStyle(
    theme: BookingTheme,
    customPrimaryColor?: string
): React.CSSProperties {
    const config = BOOKING_THEMES[theme] ?? BOOKING_THEMES.editorial;
    const vars: Record<string, string> = { ...config.vars };

    // Tenant's custom primary color overrides the theme primary if set
    if (customPrimaryColor) {
        const hsl = customPrimaryColor.startsWith('#')
            ? hexToHSLComponents(customPrimaryColor)
            : customPrimaryColor;
        if (hsl) vars['--primary'] = hsl;
    }

    return vars as React.CSSProperties;
}

// ─── Quote Request Banner ─────────────────────────────────────────────────────
const QuoteRequestBanner = ({
    tenantId,
    theme,
}: {
    tenantId: string;
    theme: BookingTheme;
}) => {
    const isDark = theme === 'dark_glam';

    return (
        <motion.section
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative overflow-hidden rounded-[var(--radius)] border-2 border-primary/10 bg-gradient-to-br from-primary/5 via-background to-primary/[0.03] p-6 sm:p-10 md:p-14"
        >
            <div className="absolute top-0 right-0 w-48 md:w-64 h-48 md:h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-36 md:w-48 h-36 md:h-48 bg-primary/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 md:gap-12 lg:gap-16">
                {/* Icon cluster — hidden on smallest screens */}
                <div className="hidden sm:flex shrink-0 items-center justify-center">
                    <div className="relative w-20 h-20 md:w-24 md:h-24">
                        <div className="absolute inset-0 rounded-[2rem] bg-primary/10 border-2 border-primary/20 shadow-xl" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <FileText className="w-8 h-8 md:w-10 md:h-10 text-primary" />
                        </div>
                        <div className="absolute -top-3 -right-3 w-7 h-7 md:w-8 md:h-8 rounded-xl bg-card border-2 border-primary/20 shadow-md flex items-center justify-center">
                            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                        </div>
                        <div className="absolute -bottom-3 -left-3 w-7 h-7 md:w-8 md:h-8 rounded-xl bg-card border-2 border-primary/20 shadow-md flex items-center justify-center">
                            <Star className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                        </div>
                    </div>
                </div>

                {/* Copy */}
                <div className="flex-1 text-center md:text-left space-y-3 md:space-y-4">
                    <div className="space-y-1">
                        <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">
                            Custom Events & Special Occasions
                        </p>
                        <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black uppercase tracking-tighter leading-none">
                            Need Something Bigger?
                        </h2>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground leading-relaxed max-w-lg mx-auto md:mx-0">
                        Planning a wedding, bridal party, corporate event, or photoshoot?
                        Submit a request and we'll build a custom quote — staffing, timeline, travel, and all.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                        {['Bridal Parties', 'Corporate Events', 'Destination Services', 'Group Bookings', 'Custom Packages'].map(tag => (
                            <span key={tag} className="px-2.5 py-1 rounded-full border-2 border-primary/10 bg-primary/5 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary/70">
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <div className="shrink-0 flex flex-col gap-3 w-full sm:w-auto">
                    <Button asChild size="lg" className="h-12 md:h-14 lg:h-16 px-6 md:px-8 lg:px-10 rounded-[var(--radius)] text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 group w-full sm:w-auto">
                        <Link href={`/inquiry/${tenantId}`}>
                            Request a Quote
                            <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                    </Button>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center opacity-50">
                        We respond within 24–48 hours
                    </p>
                </div>
            </div>
        </motion.section>
    );
};

// ─── Theme Preview Pill ───────────────────────────────────────────────────────
// Small floating indicator so clients can see which theme is active.
// Remove this in production — it's for demo/dev only.
const ThemePreviewPill = ({
    theme,
    onChange,
}: {
    theme: BookingTheme;
    onChange: (t: BookingTheme) => void;
}) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="fixed bottom-6 right-6 z-[200] flex flex-col items-end gap-2">
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="flex flex-col gap-1.5 p-3 rounded-2xl bg-card border-2 shadow-2xl"
                    >
                        {(Object.keys(BOOKING_THEMES) as BookingTheme[]).map(t => (
                            <button
                                key={t}
                                onClick={() => { onChange(t); setOpen(false); }}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all',
                                    t === theme ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                                )}
                            >
                                <span className="text-[10px] font-black uppercase tracking-widest">{BOOKING_THEMES[t].label}</span>
                                <span className="text-[9px] opacity-60 hidden sm:block">{BOOKING_THEMES[t].description}</span>
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-card border-2 shadow-xl text-[9px] font-black uppercase tracking-widest hover:bg-muted transition-all"
            >
                <Palette className="w-3.5 h-3.5 text-primary" />
                {BOOKING_THEMES[theme].label}
            </button>
        </div>
    );
};

// ─── Splash Screen ────────────────────────────────────────────────────────────
const SplashScreen = ({
    tenant,
    tenantId,
    theme,
    onEnter,
}: {
    tenant: Tenant | null | undefined;
    tenantId: string;
    theme: BookingTheme;
    onEnter: () => void;
}) => {
    const themeConfig = BOOKING_THEMES[theme];
    const isDark = theme === 'dark_glam';

    return (
        <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
        >
            {/* Hero image */}
            <div className="absolute inset-0 z-0">
                <Image
                    src={tenant?.bookingPageSettings?.heroImageUrl || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop'}
                    alt="Studio backdrop"
                    fill
                    className={cn('object-cover', isDark ? 'opacity-30' : 'opacity-25')}
                    priority
                />
                <div className={cn('absolute inset-0', themeConfig.heroOverlay)} />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="relative z-10 flex flex-col items-center text-center px-6 w-full max-w-lg mx-auto"
            >
                <BookingHeader tenant={tenant} />

                <div className="mt-6 sm:mt-8 flex flex-col gap-3 w-full max-w-xs mx-auto">
                    <Button
                        size="lg"
                        onClick={onEnter}
                        className="h-12 sm:h-14 md:h-16 rounded-[var(--radius)] text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 group w-full"
                    >
                        View Service Menu
                        <ArrowDown className="ml-2 h-4 w-4 transition-transform group-hover:translate-y-1" />
                    </Button>
                    <Button
                        size="lg"
                        variant="outline"
                        asChild
                        className="h-12 sm:h-14 md:h-16 rounded-[var(--radius)] text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] border-2 bg-background/50 backdrop-blur-sm shadow-sm w-full"
                    >
                        <Link href={`/kiosk/${tenantId}`}>
                            <Users className="mr-2 h-4 w-4" />
                            Join Queue
                        </Link>
                    </Button>
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2, duration: 0.6 }}
                    className="mt-4"
                >
                    <Link
                        href={`/inquiry/${tenantId}`}
                        className="inline-flex items-center gap-2 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-primary transition-colors"
                    >
                        <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        Planning an event? Request a custom quote
                        <ArrowRight className="w-3 h-3" />
                    </Link>
                </motion.div>
            </motion.div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 1 }}
                className="absolute bottom-8 sm:bottom-12 flex flex-col items-center gap-2 text-muted-foreground"
            >
                <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-40">Discover Excellence</p>
                <ArrowDown className="w-4 h-4 animate-bounce" />
            </motion.div>
        </motion.div>
    );
};

// ─── Sticky Nav ───────────────────────────────────────────────────────────────
const StickyNav = ({
    tenant,
    tenantId,
}: {
    tenant: Tenant | null | undefined;
    tenantId: string;
}) => (
    <div className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-xl px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
            <span className="font-black uppercase tracking-tighter text-base sm:text-xl truncate">{tenant?.name}</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Button variant="ghost" size="sm" asChild className="hidden md:flex font-bold uppercase text-[10px] tracking-widest">
                <Link href="#services">Services</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild className="hidden sm:flex font-bold uppercase text-[10px] tracking-widest text-primary">
                <Link href={`/inquiry/${tenantId}`}>
                    <FileText className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:block">Get a Quote</span>
                </Link>
            </Button>
            <Button
                size="sm"
                onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-black uppercase text-[9px] sm:text-[10px] tracking-widest rounded-full px-4 sm:px-6 shadow-lg shadow-primary/20 h-8 sm:h-9"
            >
                Book Now
            </Button>
        </div>
    </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BookingPage() {
    const params   = useParams();
    const tenantId = params.tenantId as string;
    const { firestore } = useFirebase();
    const { toast }     = useToast();

    const [entered, setEntered]               = useState(false);
    const [selectedService, setSelectedService] = useState<Service | null>(null);
    const [isSheetOpen, setIsSheetOpen]       = useState(false);
    const [isSubmitting, setIsSubmitting]     = useState(false);
    const [itemToPurchase, setItemToPurchase] = useState<Membership | Package | null>(null);
    const [purchaseType, setPurchaseType]     = useState<'membership' | 'package' | null>(null);
    const [isPurchaseSheetOpen, setIsPurchaseSheetOpen] = useState(false);

    // Local theme preview state — in production this is driven solely by tenant.bookingPageSettings.theme
    const [previewTheme, setPreviewTheme] = useState<BookingTheme | null>(null);

    // ── Data ──────────────────────────────────────────────────────────────────
    const tenantDocRef            = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const servicesQuery           = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
    const staffQuery              = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
    const scheduleProfilesQuery   = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)), [firestore, tenantId]);
    const allAppointmentsQuery    = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
    const allEventsQuery          = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
    const consentFormsQuery       = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
    const pricingTiersQuery       = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
    const membershipsQuery        = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const packagesQuery           = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`), [firestore, tenantId]);

    const { data: tenant,           isLoading: tenantLoading           } = useDoc<Tenant>(tenantDocRef);
    const { data: services,         isLoading: servicesLoading         } = useCollection<Service>(servicesQuery);
    const { data: staff,            isLoading: staffLoading            } = useCollection<Staff>(staffQuery);
    const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
    const { data: appointmentsFromDB, isLoading: appointmentsLoading   } = useCollection<Appointment>(allAppointmentsQuery);
    const { data: eventsFromDB,     isLoading: eventsLoading           } = useCollection<Event>(allEventsQuery);
    const { data: consentForms,     isLoading: consentFormsLoading     } = useCollection<ConsentForm>(consentFormsQuery);
    const { data: pricingTiers,     isLoading: pricingTiersLoading     } = useCollection<PricingTier>(pricingTiersQuery);
    const { data: memberships,      isLoading: membershipsLoading      } = useCollection<Membership>(membershipsQuery);
    const { data: packages,         isLoading: packagesLoading         } = useCollection<Package>(packagesQuery);

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
            ...apt,
            startTime: safeDate(apt.startTime),
            endTime:   safeDate(apt.endTime),
        }));
    }, [appointmentsFromDB]);

    const events = useMemo(() => {
        if (!eventsFromDB) return [];
        return eventsFromDB.map(evt => ({
            ...evt,
            startTime: safeDate(evt.startTime),
            endTime:   safeDate(evt.endTime),
        }));
    }, [eventsFromDB]);

    // ── Resolve active theme ──────────────────────────────────────────────────
    // Priority: local preview > tenant setting > default
    const activeTheme: BookingTheme = previewTheme
        ?? ((tenant?.bookingPageSettings?.theme as BookingTheme) || 'editorial');

    const themeStyle = buildThemeStyle(
        activeTheme,
        tenant?.bookingPageSettings?.primaryColor
    );

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleServiceSelect = (service: Service) => {
        setSelectedService(service);
        setIsSheetOpen(true);
    };

    const handlePurchase = (item: Membership | Package, type: 'membership' | 'package') => {
        setItemToPurchase(item);
        setPurchaseType(type);
        setIsPurchaseSheetOpen(true);
    };

    const handleConfirmBooking = async (
        formData: { clientName: string; clientEmail: string; clientPhone?: string },
        appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
        signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
        setBookingStep: (step: string) => void
    ) => {
        if (!firestore) return;
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        try {
            const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
            const q = query(clientsRef, where('email', '==', formData.clientEmail.toLowerCase()));
            const querySnapshot = await getDocs(q);

            let clientId: string;
            let clientName: string = formData.clientName;

            if (querySnapshot.empty) {
                const newClientRef = doc(clientsRef);
                clientId = newClientRef.id;
                const newClient: Omit<Client, 'id'> = {
                    name:             formData.clientName,
                    email:            formData.clientEmail,
                    phone:            formData.clientPhone || '',
                    avatarUrl:        `https://picsum.photos/seed/${clientId}/100/100`,
                    lifetimeValue:    0,
                    lastAppointment:  new Date().toISOString(),
                    status:           'active',
                };
                batch.set(newClientRef, sanitizeForFirestore({ ...newClient, id: clientId }));
            } else {
                const existingClientDoc = querySnapshot.docs[0];
                clientId   = existingClientDoc.id;
                clientName = existingClientDoc.data().name;
            }

            const appointmentRef  = doc(collection(firestore, `tenants/${tenantId}/appointments`));
            const newAppointmentId = appointmentRef.id;
            const checkInToken    = nanoid(16);

            const newAppointment = {
                ...appointmentDetails,
                id:           newAppointmentId,
                tenantId,
                clientId,
                clientName,
                clientEmail:  formData.clientEmail,
                clientPhone:  formData.clientPhone,
                checkInToken,
            };

            batch.set(appointmentRef, sanitizeForFirestore(newAppointment));
            batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), sanitizeForFirestore(newAppointment));

            signedForms.forEach(form => {
                const consentDocRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
                batch.set(consentDocRef, sanitizeForFirestore({
                    ...form,
                    id:        consentDocRef.id,
                    clientId,
                    signedAt:  new Date().toISOString(),
                }));
            });

            if (newAppointment.staffId) {
                const notificationRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
                batch.set(notificationRef, sanitizeForFirestore({
                    id:        nanoid(),
                    userId:    newAppointment.staffId,
                    type:      'new_appointment',
                    message:   `New booking: ${formData.clientName} for ${selectedService?.name} on ${format(parseISO(newAppointment.startTime), 'MMM d @ h:mm a')}`,
                    link:      '/planner',
                    createdAt: new Date().toISOString(),
                    read:      false,
                }));
            }

            await batch.commit();
            toast({ title: 'Booking Confirmed!' });
            setBookingStep('confirmation');
        } catch (error) {
            console.error('Booking error:', error);
            toast({ variant: 'destructive', title: 'Booking Failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLoading =
        tenantLoading || servicesLoading || staffLoading ||
        scheduleProfilesLoading || appointmentsLoading || eventsLoading ||
        consentFormsLoading || membershipsLoading || packagesLoading || pricingTiersLoading;

    if (isLoading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
                <Loader className="h-8 w-8 sm:h-10 sm:w-10 animate-spin text-primary" />
                <p className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Studio...</p>
            </div>
        );
    }

    return (
        <div
            className="relative min-h-screen w-full bg-background selection:bg-primary/20"
            style={themeStyle}
        >
            {/* Splash */}
            <AnimatePresence>
                {!entered && (
                    <SplashScreen
                        tenant={tenant}
                        tenantId={tenantId}
                        theme={activeTheme}
                        onEnter={() => setEntered(true)}
                    />
                )}
            </AnimatePresence>

            {/* Main content */}
            <main className={cn(
                'relative transition-all duration-1000',
                !entered ? 'opacity-0 translate-y-10 pointer-events-none' : 'opacity-100 translate-y-0'
            )}>
                <StickyNav tenant={tenant} tenantId={tenantId} />

                <div className="space-y-12 sm:space-y-20 md:space-y-28 lg:space-y-32 py-10 sm:py-14 md:py-20 px-4 md:px-8 max-w-6xl mx-auto">

                    <BookingWelcome tenant={tenant} />

                    <section id="services" className="scroll-mt-20 sm:scroll-mt-24">
                        <BookingServices
                            services={services || []}
                            onServiceSelect={handleServiceSelect}
                            tenant={tenant}
                        />
                    </section>

                    <QuoteRequestBanner tenantId={tenantId} theme={activeTheme} />

                    <BookingMemberships
                        memberships={memberships || []}
                        onPurchase={item => handlePurchase(item, 'membership')}
                        tenant={tenant}
                    />

                    <BookingPackages
                        packages={packages || []}
                        services={services || []}
                        onPurchase={item => handlePurchase(item, 'package')}
                        tenant={tenant}
                    />

                    <BookingTeam tenantId={tenantId} staff={staff || []} tenant={tenant} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 lg:gap-20">
                        <BookingFAQ />
                        <BookingReviews />
                    </div>

                    <BookingGallery />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 lg:gap-20 items-start">
                        <BookingPolicies tenant={tenant} />
                        <BookingContact tenant={tenant} />
                    </div>
                </div>

                {/* Footer */}
                <footer className="border-t bg-muted/30 py-12 sm:py-16 md:py-20 px-4 md:px-8 text-center mt-10 sm:mt-16 md:mt-20">
                    <div className="max-w-md mx-auto space-y-5 sm:space-y-6">
                        <Sparkles className="w-8 h-8 sm:w-10 sm:h-10 text-primary mx-auto opacity-20" />
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-widest">
                            Handcrafted by {tenant?.name}
                        </p>
                        <div className="flex justify-center gap-5 sm:gap-6">
                            <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><Instagram className="w-5 h-5" /></Link>
                            <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><MapPin className="w-5 h-5" /></Link>
                            <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><Phone className="w-5 h-5" /></Link>
                        </div>
                        <div className="pt-4 border-t border-border/40">
                            <Link
                                href={`/inquiry/${tenantId}`}
                                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:opacity-70 transition-opacity"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                Request a Custom Quote
                                <ArrowRight className="w-3 h-3" />
                            </Link>
                        </div>
                        <p className="text-[10px] text-muted-foreground opacity-50 uppercase font-black">
                            &copy; {new Date().getFullYear()} ClarityFlow Booking Engine
                        </p>
                    </div>
                </footer>
            </main>

            {/* Booking sheet */}
            {selectedService && (
                <BookingSheet
                    open={isSheetOpen}
                    onOpenChange={setIsSheetOpen}
                    service={selectedService}
                    staff={staff || []}
                    pricingTiers={pricingTiers || []}
                    appointments={appointments || []}
                    events={events || []}
                    scheduleProfiles={scheduleProfiles || []}
                    services={services || []}
                    consentForms={consentForms || []}
                    tenant={tenant || null}
                    onConfirm={handleConfirmBooking}
                />
            )}

            {/* Purchase sheet */}
            {itemToPurchase && purchaseType && (
                <PurchaseSheet
                    open={isPurchaseSheetOpen}
                    onOpenChange={setIsPurchaseSheetOpen}
                    item={itemToPurchase}
                    type={purchaseType}
                    tenant={tenant}
                    onConfirm={async (f, i, t) => {}}
                />
            )}

            {/* Theme preview pill — remove in production or gate behind admin flag */}
            <ThemePreviewPill theme={activeTheme} onChange={setPreviewTheme} />
        </div>
    );
}
