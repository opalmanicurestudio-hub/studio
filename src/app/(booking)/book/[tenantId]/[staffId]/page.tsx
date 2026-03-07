
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client, PricingTier } from '@/lib/data';
import { Loader, ArrowLeft, Clock, DollarSign, BookOpen, Award, Users, Star, Instagram, Link as LinkIcon, Facebook, Twitter, Film, Pin, Youtube, Sparkles, MapPin, Phone, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { BookingSheet } from '@/components/booking/BookingSheet';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { BookingServices } from '@/components/booking/BookingServices';
import { motion, AnimatePresence } from 'framer-motion';

const StatTile = ({ label, value, icon: Icon, delay = 0 }: { label: string, value: string, icon: any, delay?: number }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.5 }}
        viewport={{ once: true }}
        className="flex-1 min-w-[100px]"
    >
        <Card className="border-2 shadow-sm rounded-3xl bg-white/50 backdrop-blur-sm overflow-hidden h-full">
            <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-1">
                <div className="p-2 bg-primary/5 rounded-xl mb-1">
                    <Icon className="w-4 h-4 text-primary opacity-60" />
                </div>
                <p className="text-xl md:text-2xl font-black tracking-tighter text-slate-900 font-mono leading-none">{value}</p>
                <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{label}</p>
            </CardContent>
        </Card>
    </motion.div>
);

export default function StaffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;
  const staffId = params.staffId as string;
  
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch data
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);

  const staffDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/staff/${staffId}`), [firestore, tenantId, staffId]);
  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const { data: allServices, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(consentFormsQuery);

  const allStaffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const { data: staff, isLoading: allStaffLoading } = useCollection<Staff>(allStaffQuery);

  const pricingTiersQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(pricingTiersQuery);

  const allAppointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);

  const allEventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(allEventsQuery);

  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);

  const staffServices = useMemo(() => {
    if (!staffMember || !allServices) return [];
    return allServices.filter(service => staffMember.services?.includes(service.id) && !service.isPrivate);
  }, [staffMember, allServices]);

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service);
    setIsSheetOpen(true);
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
            batch.set(newClientRef, { ...newClient, id: clientId });
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

        batch.set(appointmentRef, newAppointment);
        batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), newAppointment);

        signedForms.forEach(form => {
            const consentDocRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
            batch.set(consentDocRef, { ...form, id: consentDocRef.id, clientId, signedAt: new Date().toISOString() });
        });

        if (newAppointment.staffId) {
            const notificationRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
            batch.set(notificationRef, { userId: newAppointment.staffId, type: 'new_appointment', message: `New booking: ${formData.clientName} for ${selectedService?.name} on ${format(parseISO(newAppointment.startTime), 'MMM d @ h:mm a')}`, link: '/planner', createdAt: new Date().toISOString(), read: false });
        }
        
        await batch.commit();
        toast({ title: 'Booking Confirmed!' });
        setBookingStep('confirmation');
    } catch (error) {
        console.error(error);
        toast({ variant: 'destructive', title: "Booking Failed" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const isLoading = staffLoading || servicesLoading || consentFormsLoading || tenantLoading || allStaffLoading || pricingTiersLoading || appointmentsLoading || eventsLoading || scheduleProfilesLoading;

  const formattedSchedule = useMemo(() => {
    const availability = staffMember?.availability;
    if (!availability?.week) return 'Not available';
    const weekOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const groups: any[] = [];
    let currentGroup: any = null;

    for (const day of weekOrder) {
        const dayInfo = availability.week[day as keyof typeof availability.week];
        if (dayInfo && dayInfo.enabled) {
            if (currentGroup && currentGroup.start === dayInfo.start && currentGroup.end === dayInfo.end) {
                currentGroup.endDay = day;
            } else {
                if (currentGroup) groups.push(currentGroup);
                currentGroup = { startDay: day, endDay: day, start: dayInfo.start, end: dayInfo.end };
            }
        } else {
            if (currentGroup) groups.push(currentGroup);
            currentGroup = null;
        }
    }
    if (currentGroup) groups.push(currentGroup);
    if (groups.length === 0) return 'Not available on weekdays.';
    return groups.map(group => {
        const startDay = group.startDay.slice(0, 3);
        const endDay = group.endDay.slice(0, 3);
        const dayRange = startDay === endDay ? startDay.charAt(0).toUpperCase() + startDay.slice(1) : `${startDay.charAt(0).toUpperCase() + startDay.slice(1)} - ${endDay.charAt(0).toUpperCase() + endDay.slice(1)}`;
        return `${dayRange} (${group.start} - ${group.end})`;
    }).join(' | ');
  }, [staffMember?.availability]);

  if (isLoading) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
            <Loader className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Retrieving Profile...</p>
        </div>
      );
  }

  if (!staffMember || staffMember.showOnPublicPage === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background">
        <div className="p-6 bg-muted/50 rounded-full mb-6 shadow-inner"><XCircle className="w-16 h-16 text-muted-foreground/40" /></div>
        <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Profile Hidden</h2>
        <p className="text-muted-foreground mt-2 max-w-sm mx-auto font-medium uppercase text-xs tracking-widest opacity-60 leading-relaxed">This professional dossier is not available for public review at this time.</p>
        <Button asChild className="mt-8 h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">
            <Link href={`/book/${tenantId}`}><ArrowLeft className="mr-2 h-4 w-4" /> Studio Directory</Link>
        </Button>
      </div>
    );
  }

  const portfolioImages = staffMember.portfolioImageUrls && staffMember.portfolioImageUrls.length > 0 
    ? staffMember.portfolioImageUrls 
    : Array.from({ length: 5 }, (_, i) => `https://picsum.photos/seed/staff-portfolio-${staffId}-${i}/600/800`);

  return (
    <div className="min-h-screen w-full bg-slate-50/50 selection:bg-primary/20 overflow-x-hidden">
        <header className="sticky top-0 z-50 flex h-16 items-center justify-between bg-white/80 backdrop-blur-xl px-4 md:px-8 border-b transition-all">
            <Button variant="ghost" size="icon" asChild className="rounded-xl hover:bg-primary/5">
                 <Link href={`/book/${tenantId}`}>
                    <ArrowLeft className="h-5 w-5 text-slate-900" />
                </Link>
            </Button>
            <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-black uppercase tracking-tighter text-lg">{tenant?.name}</span>
            </div>
            <Button size="sm" className="hidden sm:flex rounded-full font-black uppercase text-[10px] tracking-widest h-9 px-6" onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}>
                Book Now
            </Button>
        </header>

      <main className="max-w-6xl mx-auto space-y-24 py-16 px-4 md:px-8">
            <section id="hero" className="flex flex-col items-center text-center gap-8">
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="relative"
                >
                    <Avatar className="w-32 h-32 md:w-56 md:h-56 text-4xl border-[6px] border-white shadow-3xl rounded-[2.5rem] md:rounded-[4rem] overflow-hidden">
                        <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} className="object-cover" />
                        <AvatarFallback className="font-black bg-primary/10 text-primary text-2xl">{(staffMember.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-2 -right-2 bg-primary text-white p-3 rounded-2xl shadow-2xl border-4 border-white">
                        <ShieldCheck className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                </motion.div>

                <div className="space-y-4 max-w-2xl">
                    <div className="flex flex-wrap justify-center gap-2">
                        <Badge className="bg-primary/10 text-primary border-none font-black text-[9px] uppercase tracking-widest h-6 px-3">{pricingTiers?.find(pt => pt.id === staffMember.pricingTierId)?.name || 'Professional'}</Badge>
                        {staffMember.specialties?.map(s => (
                            <Badge key={s} variant="outline" className="h-6 px-3 rounded-full border-2 font-black text-[9px] uppercase tracking-widest">{s}</Badge>
                        ))}
                    </div>
                    <h1 className="text-4xl md:text-8xl font-black tracking-tighter uppercase text-slate-900 leading-none">{staffMember.name}</h1>
                    <div className="flex items-center justify-center gap-6 pt-4">
                        {[
                            { icon: Instagram, url: staffMember.instagramUrl },
                            { icon: Facebook, url: staffMember.facebookUrl },
                            { icon: Twitter, url: staffMember.twitterUrl },
                            { icon: Film, url: staffMember.tiktokUrl },
                            { icon: Youtube, url: staffMember.youtubeUrl },
                            { icon: LinkIcon, url: staffMember.portfolioUrl }
                        ].filter(social => social.url).map((social, i) => (
                            <motion.a 
                                key={i}
                                whileHover={{ scale: 1.2, rotate: 5 }}
                                href={social.url} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-slate-400 hover:text-primary transition-colors"
                            >
                                <social.icon className="w-6 h-6" />
                            </motion.a>
                        ))}
                    </div>
                </div>
            </section>

            <div className="flex flex-wrap justify-center gap-4 md:gap-8">
                <StatTile label="Active Clients" value={`${staffMember.clientCount || 200}+`} icon={Users} delay={0.1} />
                <StatTile label="Years Tenure" value={`${staffMember.yearsOfExperience || 5}+`} icon={Award} delay={0.2} />
                <StatTile label="Mastery Rating" value="4.9" icon={Star} delay={0.3} />
            </div>

            <section id="bio" className="grid md:grid-cols-2 gap-12 items-center">
                <div className="space-y-6 text-left">
                    <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">The Narrative</p>
                        <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900">Philosophy of Care</h2>
                    </div>
                    <p className="text-lg text-slate-600 font-medium leading-relaxed italic border-l-4 border-primary/20 pl-8">
                        "{staffMember.bio || 'Dedicated to transforming your personal style with precision, intuition, and an unwavering commitment to excellence.'}"
                    </p>
                    <div className="p-6 rounded-[2rem] border-2 bg-white/50 space-y-4 shadow-sm">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2"><Clock className="w-3 h-3" /> Access window</p>
                        <p className="text-sm font-bold text-slate-800 leading-relaxed uppercase tracking-tight">{formattedSchedule}</p>
                    </div>
                </div>
                <div className="relative aspect-square rounded-[3rem] overflow-hidden border-4 border-white shadow-3xl">
                    <Image 
                        src={staffMember.avatarUrl || "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=1287&auto=format&fit=crop"}
                        alt="Profile candid"
                        fill
                        className="object-cover grayscale brightness-90 hover:grayscale-0 transition-all duration-1000"
                    />
                </div>
            </section>

            <section id="services" className="space-y-12 scroll-mt-24">
                <div className="text-center space-y-4">
                    <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">Treatment Menu</h2>
                    <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">Curated experiences delivered by {(staffMember.name || 'Staff').split(' ')[0]}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    <BookingServices services={staffServices} onServiceSelect={handleServiceSelect} staffMember={staffMember} showPrivateServices={false} />
                </div>
            </section>

            <section id="gallery" className="space-y-12">
                <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                    <div className="space-y-2 text-left">
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Asset Proof</p>
                        <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900">The Visual Record</h2>
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 md:text-right max-w-xs">A curated collection of transformations and technical precision.</p>
                </div>
                <ScrollArea className="w-full pb-8">
                    <div className="flex space-x-6 px-4">
                        {portfolioImages.map((url, index) => (
                            <motion.div 
                                key={index} 
                                whileHover={{ y: -10 }}
                                className="relative aspect-[4/5] w-[300px] md:w-[400px] shrink-0 rounded-[2.5rem] overflow-hidden group shadow-2xl border-4 border-white"
                            >
                                <Image
                                    src={url}
                                    alt={`Portfolio acquisition ${index + 1}`}
                                    fill
                                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col justify-end p-8">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Dossier Asset</p>
                                    <p className="text-white font-black uppercase text-xl tracking-tighter">View Outcome</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>
            </section>
      </main>
      
        <footer className="sticky bottom-0 z-50 p-4 border-t bg-white/80 backdrop-blur-xl sm:hidden">
            <div className="max-w-lg mx-auto">
                <Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30" onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}>
                    Secure Session
                </Button>
            </div>
        </footer>

        {selectedService && (
            <BookingSheet 
                open={isSheetOpen}
                onOpenChange={setIsSheetOpen}
                service={selectedService}
                staff={staff || []}
                pricingTiers={pricingTiers || []}
                initialStaffId={staffId}
                consentForms={consentForms || []}
                tenant={tenant || null}
                onConfirm={handleConfirmBooking}
                appointments={appointmentsFromDB || []}
                events={eventsFromDB || []}
                scheduleProfiles={scheduleProfiles || []}
                services={allServices || []}
            />
        )}
    </div>
  );
}
