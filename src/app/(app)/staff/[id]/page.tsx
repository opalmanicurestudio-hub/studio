'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client, PricingTier } from '@/lib/data';
import { Loader, ArrowLeft, Clock, DollarSign, BookOpen, Award, Users, Star, Instagram, Link as LinkIcon, Facebook, Twitter, Film, Pin, Youtube, Sparkles, MapPin, Phone, ShieldCheck, CheckCircle2, ArrowRight, Activity } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        viewport={{ once: true }}
        className="flex-1 min-w-[80px]"
    >
        <Card className="border-2 shadow-sm rounded-2xl bg-white/50 backdrop-blur-sm overflow-hidden h-full">
            <CardContent className="p-3 flex flex-col items-center justify-center text-center gap-0.5">
                <div className="p-1.5 bg-primary/5 rounded-lg mb-1">
                    <Icon className="w-3 h-3 text-primary opacity-60" />
                </div>
                <p className="text-base md:text-xl font-black tracking-tighter text-slate-900 font-mono leading-none">{value}</p>
                <p className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{label}</p>
            </CardContent>
        </Card>
    </motion.div>
);

const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length > 1) {
        return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const { id: staffId } = params;

  const { firestore, isUserLoading } = useFirebase();
  const { selectedTenant, isLoading: isTenantLoading } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const staffDocRef = useMemoFirebase(() => {
      if (!firestore || !staffId || !tenantId) return null;
      return doc(firestore, `tenants/${tenantId}/staff/${staffId}`);
  }, [firestore, tenantId, staffId]);
  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

  const { services, pricingTiers, isLoading: inventoryLoading, memberships } = useInventory();

  const activityLogsQuery = useMemoFirebase(() => {
      if (!firestore || !staffId || !tenantId) return null;
      return collection(firestore, `tenants/${tenantId}/activityLogs`);
  }, [firestore, tenantId, staffId]);
  const { data: allActivityLogs, isLoading: activityLogsLoading } = useCollection<ActivityLog>(activityLogsQuery);

  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [serviceToBook, setServiceToBook] = useState<Service | null>(null);

  const { data: scheduleProfiles } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)), [firestore, tenantId]));
  const { data: appointmentsFromDB } = useCollection<Appointment>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]));
  const { data: eventsFromDB } = useCollection<Event>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]));
  const { data: consentForms } = useCollection<ConsentForm>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]));

  const handleBookNow = (service: Service) => {
    setServiceToBook(service);
    setIsAddAppointmentOpen(true);
  }

  const isLoading = isUserLoading || isTenantLoading || staffLoading || inventoryLoading || activityLogsLoading;

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
  
  const staffServices = useMemo(() => {
    if (!staffMember?.services || !services || !pricingTiers) return [];
    const staffPricingTierId = staffMember.pricingTierId;
    return services
      .filter(s => staffMember.services?.includes(s.id) && !s.isPrivate)
      .map(service => {
        let finalPrice = service.price;
        let finalDuration = service.duration;
        if (staffPricingTierId && service.serviceTiers) {
            const tierInfo = service.serviceTiers.find(t => t.tierId === staffPricingTierId);
            if (tierInfo) {
                finalPrice = tierInfo.price;
                finalDuration = tierInfo.durationMinutes;
            }
        }
        return { ...service, price: finalPrice, duration: finalDuration };
      });
  }, [staffMember, services, pricingTiers]);

  const handleConfirmBooking = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
    signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
    setBookingStep: (step: string) => void
  ) => {
    if (!firestore || !tenantId) return;
    try {
        const appointmentRef = doc(collection(firestore, `tenants/${tenantId}/appointments`));
        const newAppointmentId = appointmentRef.id;
        const checkInToken = nanoid(16);

        const newAppointment = {
            ...appointmentDetails,
            id: newAppointmentId,
            tenantId: tenantId,
            clientName: formData.clientName,
            clientEmail: formData.clientEmail,
            clientPhone: formData.clientPhone,
            checkInToken: checkInToken,
        };

        const batch = writeBatch(firestore);
        batch.set(appointmentRef, newAppointment);
        batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), newAppointment);
        
        await batch.commit();
        setBookingStep('confirmation');
    } catch (error) {
        console.error("Booking error:", error);
    }
  };

  if (isLoading) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
            <Loader className="h-10 w-10 animate-spin text-primary" />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Retrieving Portfolio...</p>
        </div>
      );
  }

  if (!staffMember) {
    notFound();
  }
  
  const portfolioImages = staffMember.portfolioImageUrls && staffMember.portfolioImageUrls.length > 0 
    ? staffMember.portfolioImageUrls 
    : Array.from({ length: 5 }, (_, i) => `https://picsum.photos/seed/staff-portfolio-${staffId}-${i}/600/800`);

  return (
    <div className="min-h-screen w-full bg-slate-50/50 selection:bg-primary/20 overflow-x-hidden relative font-body">
        {/* Atmosphere blurred circles */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-5%] left-[-5%] w-[30%] h-[30%] bg-blue-200/20 blur-[100px] rounded-full" />
            <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-purple-200/20 blur-[100px] rounded-full" />
        </div>

        <main className="relative z-10 max-w-5xl mx-auto py-10 px-4 md:px-10 space-y-16 md:space-y-24 pb-32">
            {/* Header / Nav */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" asChild className="rounded-2xl bg-white/50 backdrop-blur-md shadow-sm border border-white/40 hover:bg-white transition-all active:scale-90">
                    <Link href="/staff">
                        <ArrowLeft className="h-5 w-5 text-slate-900" />
                    </Link>
                </Button>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="font-black uppercase tracking-tighter text-sm md:text-base">Studio Dossier</span>
                </div>
            </div>

            {/* Identity Hero */}
            <section id="hero" className="flex flex-col items-center text-center gap-6 md:gap-8">
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="relative"
                >
                    <Avatar className="w-28 h-28 md:w-48 md:h-48 text-4xl border-[6px] border-white shadow-3xl rounded-[2.5rem] md:rounded-[3.5rem] overflow-hidden">
                        <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} className="object-cover" />
                        <AvatarFallback className="font-black bg-primary/10 text-primary text-2xl">{getInitials(staffMember.name)}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 bg-primary text-white p-2 rounded-xl shadow-2xl border-2 border-white">
                        <ShieldCheck className="w-5 h-5 md:w-7 md:h-7" />
                    </div>
                </motion.div>

                <div className="space-y-3 max-w-2xl px-2">
                    <div className="flex flex-wrap justify-center gap-1.5">
                        <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] uppercase tracking-widest h-5 px-2.5">
                            {pricingTiers?.find(pt => pt.id === staffMember.pricingTierId)?.name || 'Professional'}
                        </Badge>
                        {staffMember.specialties?.slice(0, 2).map(s => (
                            <Badge key={s} variant="outline" className="h-5 px-2.5 rounded-full border-2 font-black text-[8px] uppercase tracking-widest">{s}</Badge>
                        ))}
                    </div>
                    <h1 className="text-3xl md:text-7xl font-black tracking-tighter uppercase text-slate-900 leading-[0.9] break-words w-full">
                        {staffMember.name}
                    </h1>
                    <div className="flex items-center justify-center gap-1 mt-1 text-amber-500">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span className="text-[10px] font-black uppercase tracking-widest">4.9 Mastery</span>
                    </div>
                </div>
            </section>

            {/* Mastery Matrix */}
            <div className="flex flex-wrap justify-center gap-3 md:gap-6 px-2">
                <StatTile label="Loyal Guests" value={`${staffMember.clientCount || 200}+`} icon={Users} delay={0.1} />
                <StatTile label="Years Tenure" value={`${staffMember.yearsOfExperience || 5}+`} icon={Award} delay={0.2} />
                <StatTile label="Session Rate" value="4.9" icon={Star} delay={0.3} />
            </div>

            {/* Content Dossier */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 items-start">
                <div className="md:col-span-2 space-y-12">
                    <section id="narrative" className="space-y-6">
                        <div className="space-y-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Philosophy of Care</p>
                            <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900">Professional Record</h2>
                        </div>
                        <p className="text-sm md:text-lg text-slate-600 font-medium leading-relaxed italic border-l-4 border-primary/20 pl-6 py-1">
                            "{staffMember.bio || 'Dedicated to technical precision and curative care.'}"
                        </p>
                    </section>

                    <section id="services" className="space-y-8 scroll-mt-24 text-left">
                        <div className="space-y-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Access Portfolio</p>
                            <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900">Treatment Menu</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <BookingServices services={staffServices} onServiceSelect={handleBookNow} staffMember={staffMember} showPrivateServices={false} />
                        </div>
                    </section>
                </div>

                <div className="md:col-span-1 space-y-8">
                    <Card className="rounded-[2.5rem] border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
                        <CardHeader className="p-6 pb-2 text-left">
                            <CardTitle className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5" /> Access Window
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-2">
                            <p className="text-xs font-bold text-slate-800 leading-relaxed uppercase tracking-tight">{formattedSchedule}</p>
                        </CardContent>
                    </Card>

                    <Card className="rounded-[2.5rem] border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
                        <CardHeader className="p-6 pb-2 text-left">
                            <CardTitle className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                <Activity className="w-3.5 h-3.5" /> Social Signatures
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-2">
                            <div className="flex flex-wrap gap-3">
                                {[
                                    { icon: Instagram, url: staffMember.instagramUrl },
                                    { icon: Facebook, url: staffMember.facebookUrl },
                                    { icon: Twitter, url: staffMember.twitterUrl },
                                    { icon: Film, url: staffMember.tiktokUrl },
                                    { icon: Youtube, url: staffMember.youtubeUrl },
                                    { icon: LinkIcon, url: staffMember.portfolioUrl }
                                ].filter(social => social.url).map((social, i) => (
                                    <a key={i} href={social.url} target="_blank" rel="noopener noreferrer" className="p-3 bg-white border-2 rounded-2xl text-slate-400 hover:text-primary hover:border-primary transition-all shadow-sm">
                                        <social.icon className="w-5 h-5" />
                                    </a>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Asset Gallery */}
            <section id="gallery" className="space-y-10">
                <div className="flex justify-between items-end gap-4 px-2">
                    <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Visual Registry</p>
                        <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900">Outcome Archive</h2>
                    </div>
                </div>
                <ScrollArea className="w-full pb-6">
                    <div className="flex space-x-6 px-2">
                        {portfolioImages.map((url, index) => (
                            <motion.div 
                                key={index} 
                                whileHover={{ y: -8 }}
                                className="relative aspect-[4/5] w-[260px] md:w-[320px] shrink-0 rounded-[2rem] overflow-hidden group shadow-xl border-4 border-white"
                            >
                                <Image
                                    src={url}
                                    alt={`Archive asset ${index + 1}`}
                                    fill
                                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col justify-end p-6">
                                    <p className="text-white font-black uppercase text-sm tracking-tight">View Outcome</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>
            </section>
      </main>
      
        {/* Sticky Tactical Action */}
        <footer className="fixed bottom-0 left-0 right-0 z-[60] p-4 md:p-6 flex justify-center pointer-events-none">
            <div className="w-full max-w-lg pointer-events-auto">
                <Button 
                    className="w-full h-14 md:h-16 rounded-[2rem] text-sm md:text-base font-black uppercase tracking-widest shadow-[0_20px_50px_rgba(8,_112,_184,_0.3)] transition-all active:scale-95 group"
                    onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
                >
                    Initialize Booking
                    <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" />
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
                services={services || []}
            />
        )}
    </div>
  );
}
