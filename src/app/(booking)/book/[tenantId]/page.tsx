'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client, Membership, Package, PricingTier } from '@/lib/data';
import { Loader, ArrowDown, Users, Sparkles, MapPin, Phone, Instagram, ArrowRight } from 'lucide-react';
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

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

/**
 * Recursively removes any keys with undefined values from an object.
 * Firestore does not support undefined values in payloads.
 */
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

export default function BookingPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [entered, setEntered] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [itemToPurchase, setItemToPurchase] = useState<Membership | Package | null>(null);
  const [purchaseType, setPurchaseType] = useState<'membership' | 'package' | null>(null);
  const [isPurchaseSheetOpen, setIsPurchaseSheetOpen] = useState(false);

  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)), [firestore, tenantId]);
  const allAppointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const allEventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const pricingTiersQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
  
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);
  const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(allEventsQuery);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(consentFormsQuery);
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(pricingTiersQuery);
  
  const membershipsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
  const packagesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`), [firestore, tenantId]);
  const { data: memberships, isLoading: membershipsLoading } = useCollection<Membership>(membershipsQuery);
  const { data: packages, isLoading: packagesLoading } = useCollection<Package>(packagesQuery);
  
  const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => ({
      ...apt,
      startTime: safeDate(apt.startTime),
      endTime: safeDate(apt.endTime),
    }));
  }, [appointmentsFromDB]);

  const events = useMemo(() => {
    if (!eventsFromDB) return [];
    return eventsFromDB.map(evt => ({
        ...evt,
        startTime: safeDate(evt.startTime),
        endTime: safeDate(evt.endTime),
    }));
  }, [eventsFromDB]);

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
        const q = query(clientsRef, where("email", "==", formData.clientEmail.toLowerCase()));
        const querySnapshot = await getDocs(q);

        let clientId: string;
        let clientName: string = formData.clientName;

        if (querySnapshot.empty) {
            const newClientRef = doc(clientsRef);
            clientId = newClientRef.id;
            const newClient: Omit<Client, 'id'> = {
                name: formData.clientName,
                email: formData.clientEmail,
                phone: formData.clientPhone || '',
                avatarUrl: `https://picsum.photos/seed/${clientId}/100/100`,
                lifetimeValue: 0,
                lastAppointment: new Date().toISOString(),
                status: 'active',
            };
            batch.set(newClientRef, sanitizeForFirestore({ ...newClient, id: clientId }));
        } else {
            const existingClientDoc = querySnapshot.docs[0];
            clientId = existingClientDoc.id;
            clientName = existingClientDoc.data().name;
        }

        const appointmentRef = doc(collection(firestore, `tenants/${tenantId}/appointments`));
        const newAppointmentId = appointmentRef.id;
        const checkInToken = nanoid(16);

        const newAppointment = {
            ...appointmentDetails,
            id: newAppointmentId,
            tenantId: tenantId,
            clientId: clientId,
            clientName: clientName,
            clientEmail: formData.clientEmail,
            clientPhone: formData.clientPhone,
            checkInToken: checkInToken,
        };

        batch.set(appointmentRef, sanitizeForFirestore(newAppointment));
        batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), sanitizeForFirestore(newAppointment));

        signedForms.forEach(form => {
            const consentDocRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
            batch.set(consentDocRef, sanitizeForFirestore({
                ...form,
                id: consentDocRef.id,
                clientId,
                signedAt: new Date().toISOString(),
            }));
        });

        if (newAppointment.staffId) {
            const notificationRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
            batch.set(notificationRef, sanitizeForFirestore({
                id: nanoid(),
                userId: newAppointment.staffId,
                type: 'new_appointment',
                message: `New booking: ${formData.clientName} for ${selectedService?.name} on ${format(parseISO(newAppointment.startTime), 'MMM d @ h:mm a')}`,
                link: '/planner',
                createdAt: new Date().toISOString(),
                read: false,
            }));
        }
        
        await batch.commit();
        toast({ title: 'Booking Confirmed!' });
        setBookingStep('confirmation');

    } catch (error) {
        console.error("Booking error:", error);
        toast({ variant: 'destructive', title: "Booking Failed" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const isLoading = tenantLoading || servicesLoading || staffLoading || scheduleProfilesLoading || appointmentsLoading || eventsLoading || consentFormsLoading || membershipsLoading || packagesLoading || pricingTiersLoading;

  if (isLoading) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
            <Loader className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Studio...</p>
        </div>
      )
  }

  const customPrimaryColor = tenant?.bookingPageSettings?.primaryColor;
  const primaryColorHSL = customPrimaryColor && customPrimaryColor.startsWith('#') 
    ? hexToHSLComponents(customPrimaryColor) 
    : customPrimaryColor;

  return (
    <div 
        className="relative min-h-screen w-full bg-background selection:bg-primary/20"
        style={primaryColorHSL ? { '--primary': primaryColorHSL } as React.CSSProperties : {}}
    >
        <AnimatePresence>
            {!entered && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background overflow-hidden"
                >
                    <div className="absolute inset-0 z-0">
                        <Image 
                            src={tenant?.bookingPageSettings?.heroImageUrl || "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop"}
                            alt="Salon backdrop"
                            fill
                            className="object-cover opacity-20 scale-110"
                            priority
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
                    </div>

                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-10 flex flex-col items-center text-center px-6 w-full"
                    >
                        <BookingHeader tenant={tenant} />
                        
                        <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full max-w-sm mx-auto">
                            <Button 
                                size="lg" 
                                onClick={() => setEntered(true)}
                                className="h-14 md:h-16 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 group"
                            >
                                View Service Menu
                                <ArrowDown className="ml-2 h-4 w-4 transition-transform group-hover:translate-y-1" />
                            </Button>
                            <Button 
                                size="lg" 
                                variant="outline" 
                                asChild
                                className="h-14 md:h-16 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border-2 bg-background/50 backdrop-blur-sm shadow-sm"
                            >
                                <Link href={`/kiosk/${tenantId}`}>
                                    <Users className="mr-2 h-4 w-4" />
                                    Join Queue
                                </Link>
                            </Button>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.5, duration: 1 }}
                        className="absolute bottom-12 flex flex-col items-center gap-2 text-muted-foreground"
                    >
                        <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-40">Discover Excellence</p>
                        <ArrowDown className="w-4 h-4 animate-bounce" />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        <main className={cn(
            "relative transition-all duration-1000",
            !entered ? "opacity-0 translate-y-10" : "opacity-100 translate-y-0"
        )}>
            {/* Sticky Header */}
            <div className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-xl px-4 md:px-8 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Sparkles className="w-6 h-6 text-primary" />
                    <span className="font-black uppercase tracking-tighter text-xl">{tenant?.name}</span>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" asChild className="hidden sm:flex font-bold uppercase text-[10px] tracking-widest">
                        <Link href="#services">Services</Link>
                    </Button>
                    <Button size="sm" onClick={() => {
                        const servicesEl = document.getElementById('services');
                        servicesEl?.scrollIntoView({ behavior: 'smooth' });
                    }} className="font-black uppercase text-[10px] tracking-widest rounded-full px-6 shadow-lg shadow-primary/20">
                        Book Now
                    </Button>
                </div>
            </div>

            <div className="space-y-32 py-20 px-4 md:px-8 max-w-6xl mx-auto">
                <BookingWelcome tenant={tenant} />
                
                <section id="services" className="scroll-mt-24">
                    <BookingServices services={services || []} onServiceSelect={handleServiceSelect} tenant={tenant} />
                </section>

                <BookingMemberships memberships={memberships || []} onPurchase={(item) => handlePurchase(item, 'membership')} tenant={tenant} />
                
                <BookingPackages packages={packages || []} services={services || []} onPurchase={(item) => handlePurchase(item, 'package')} tenant={tenant} />
                
                <BookingTeam tenantId={tenantId} staff={staff || []} tenant={tenant} />
                
                <div className="grid md:grid-cols-2 gap-20">
                    <BookingFAQ />
                    <BookingReviews />
                </div>

                <BookingGallery />
                
                <div className="grid md:grid-cols-2 gap-20 items-start">
                    <BookingPolicies tenant={tenant} />
                    <BookingContact tenant={tenant} />
                </div>
            </div>

            <footer className="border-t bg-muted/30 py-20 px-8 text-center mt-20">
                <div className="max-w-md mx-auto space-y-6">
                    <Sparkles className="w-10 h-10 text-primary mx-auto opacity-20" />
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
                        Handcrafted by {tenant?.name}
                    </p>
                    <div className="flex justify-center gap-6">
                        <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><Instagram className="w-5 h-5" /></Link>
                        <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><MapPin className="w-5 h-5" /></Link>
                        <Link href="#" className="text-muted-foreground hover:text-primary transition-colors"><Phone className="w-5 h-5" /></Link>
                    </div>
                    <p className="text-[10px] text-muted-foreground opacity-50 uppercase font-black">
                        &copy; {new Date().getFullYear()} ClarityFlow Booking Engine
                    </p>
                </div>
            </footer>
        </main>

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
    </div>
  );
}