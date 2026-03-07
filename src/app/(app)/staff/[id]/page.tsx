'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, writeBatch, getDocs } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client, PricingTier } from '@/lib/data';
import { 
    Loader, 
    ArrowLeft, 
    Clock, 
    DollarSign, 
    Award, 
    Users, 
    Star, 
    Instagram, 
    Link as LinkIcon, 
    Facebook, 
    Twitter, 
    Film, 
    Youtube, 
    Sparkles, 
    MapPin, 
    Phone, 
    ShieldCheck, 
    CheckCircle2, 
    ArrowRight, 
    Activity,
    XCircle
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const StatTile = ({ label, value, icon: Icon, delay = 0 }: { label: string, value: string, icon: any, delay?: number }) => (
    <motion.div 
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        viewport={{ once: true }}
        className="flex-1 min-w-[80px]"
    >
        <Card className="border-2 shadow-sm rounded-2xl bg-white/50 backdrop-blur-sm overflow-hidden h-full">
            <CardContent className="p-3 flex flex-col items-center justify-center text-center gap-1">
                <div className="p-1.5 bg-primary/5 rounded-lg mb-0.5">
                    <Icon className="w-3.5 h-3.5 text-primary opacity-60" />
                </div>
                <p className="text-base sm:text-2xl font-black tracking-tighter text-slate-900 font-mono leading-none">{value}</p>
                <p className="text-[7px] sm:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{label}</p>
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
  const { toast } = useToast();
  
  const staffDocRef = useMemoFirebase(() => {
      if (!firestore || !staffId || !tenantId) return null;
      return doc(firestore, `tenants/${tenantId}/staff/${staffId}`);
  }, [firestore, tenantId, staffId]);
  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

  const { 
    services, 
    pricingTiers, 
    appointments, 
    events, 
    scheduleProfiles, 
    consentForms, 
    isLoading: inventoryLoading 
  } = useInventory();

  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  const handleBookNow = (service: Service) => {
    setSelectedService(service);
    setIsBookingSheetOpen(true);
  };

  const isLoadingTotal = isUserLoading || isTenantLoading || staffLoading || inventoryLoading;

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
        toast({ title: "Session Reserved", description: "Your appointment has been secured." });
        setBookingStep('confirmation');
    } catch (error) {
        console.error("Booking error:", error);
        toast({ variant: 'destructive', title: "Booking Failed", description: "There was a problem securing your slot." });
    }
  };

  if (isLoadingTotal) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
            <Loader className="h-10 w-10 animate-spin text-primary" />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Retrieving Portfolio...</p>
        </div>
      );
  }

  if (!staffMember) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center text-center p-8">
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-4">Dossier Missing</h1>
            <Button asChild variant="outline" className="rounded-2xl"><Link href="/staff"><ArrowLeft className="mr-2 h-4 w-4" />Return to Team</Link></Button>
        </div>
    );
  }
  
  const portfolioImages = staffMember.portfolioImageUrls && staffMember.portfolioImageUrls.length > 0 
    ? staffMember.portfolioImageUrls 
    : Array.from({ length: 5 }, (_, i) => `https://picsum.photos/seed/staff-portfolio-${staffId}-${i}/600/800`);

  return (
    <div className="min-h-screen w-full bg-slate-50/50 selection:bg-primary/20 overflow-x-hidden relative font-body">
        {/* Atmosphere blurred circles */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-5%] left-[-5%] w-[40%] h-[40%] bg-blue-200/20 blur-[100px] rounded-full" />
            <div className="absolute bottom-[-5%] right-[-5%] w-[40%] h-[40%] bg-purple-200/20 blur-[100px] rounded-full" />
        </div>

        <main className="relative z-10 max-w-5xl mx-auto py-6 md:py-10 px-4 md:px-10 space-y-10 md:space-y-24 pb-32">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" asChild className="rounded-xl sm:rounded-2xl bg-white/50 backdrop-blur-md shadow-sm border border-white/40 hover:bg-white transition-all active:scale-90 h-10 w-10 sm:h-12 sm:w-12">
                    <Link href="/staff">
                        <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 text-slate-900" />
                    </Link>
                </Button>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                    <span className="font-black uppercase tracking-tighter text-xs sm:text-base text-slate-900">Studio Dossier</span>
                </div>
            </div>

            {/* Hero Identity */}
            <section id="hero" className="flex flex-col items-center text-center gap-6 sm:gap-10">
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="relative"
                >
                    <Avatar className="w-28 h-28 sm:w-48 sm:h-48 text-2xl sm:text-4xl border-[4px] sm:border-[6px] border-white shadow-3xl rounded-[2.5rem] sm:rounded-[3.5rem] overflow-hidden">
                        <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} className="object-cover" />
                        <AvatarFallback className="font-black bg-primary/10 text-primary">{getInitials(staffMember.name)}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 bg-primary text-white p-1.5 sm:p-2 rounded-lg sm:rounded-xl shadow-2xl border-2 border-white">
                        <ShieldCheck className="w-4 h-4 sm:w-7 sm:h-7" />
                    </div>
                </motion.div>

                <div className="space-y-3 max-w-2xl px-2">
                    <div className="flex flex-wrap justify-center gap-1.5">
                        <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] uppercase tracking-widest h-5 px-2.5">
                            {pricingTiers?.find(pt => pt.id === staffMember.pricingTierId)?.name || 'Professional'}
                        </Badge>
                        {staffMember.specialties?.slice(0, 2).map(s => (
                            <Badge key={s} variant="outline" className="h-5 px-3 rounded-full border-2 font-black text-[8px] uppercase tracking-widest">{s}</Badge>
                        ))}
                    </div>
                    <h1 className="text-3xl sm:text-7xl font-black tracking-tighter uppercase text-slate-900 leading-none break-words w-full">
                        {staffMember.name}
                    </h1>
                    <div className="flex items-center justify-center gap-1.5 text-amber-500">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span className="text-[10px] font-black uppercase tracking-widest">4.9 Mastered Reviews</span>
                    </div>
                </div>
            </section>

            {/* Stats Matrix */}
            <div className="grid grid-cols-3 gap-3 md:gap-6 px-2 w-full max-w-2xl mx-auto">
                <StatTile label="Loyal Guests" value={`${staffMember.clientCount || 200}+`} icon={Users} delay={0.1} />
                <StatTile label="Years Tenure" value={`${staffMember.yearsOfExperience || 5}+`} icon={Award} delay={0.2} />
                <StatTile label="Session Rate" value="4.9" icon={Star} delay={0.3} />
            </div>

            {/* Dossier Content */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
                <div className="md:col-span-2 space-y-12">
                    <section id="narrative" className="space-y-6 text-left">
                        <div className="space-y-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Philosophy of Care</p>
                            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900">Record Narrative</h2>
                        </div>
                        <p className="text-sm sm:text-lg text-slate-600 font-medium leading-relaxed italic border-l-4 border-primary/20 pl-6">
                            "{staffMember.bio || 'Dedicated to technical precision and curative aesthetic care.'}"
                        </p>
                    </section>

                    <section id="services" className="space-y-8 scroll-mt-24 text-left">
                        <div className="space-y-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Treatment Menu</p>
                            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900">Access Portfolio</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <BookingServices services={staffServices} onServiceSelect={handleBookNow} staffMember={staffMember} showPrivateServices={false} />
                        </div>
                    </section>
                </div>

                <div className="md:col-span-1 space-y-8">
                    <Card className="rounded-[2rem] border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
                        <CardHeader className="p-6 pb-2 text-left">
                            <CardTitle className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Access Window
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-2">
                            <p className="text-[11px] font-bold text-slate-800 leading-relaxed uppercase tracking-tight">{formattedSchedule}</p>
                        </CardContent>
                    </Card>

                    <Card className="rounded-[2rem] border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
                        <CardHeader className="p-6 pb-2 text-left">
                            <CardTitle className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                <Activity className="w-4 h-4" /> Social Signatures
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
                                    <a key={i} href={social.url} target="_blank" rel="noopener noreferrer" className="p-3 bg-white border-2 rounded-2xl text-slate-400 hover:text-primary hover:border-primary transition-all shadow-sm active:scale-90">
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
                    <div className="space-y-1 text-left">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary opacity-60">Visual Registry</p>
                        <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900">Outcome Archive</h2>
                    </div>
                </div>
                <div className="relative w-full">
                    <div className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory scrollbar-hide px-2">
                        {portfolioImages.map((url, index) => (
                            <motion.div 
                                key={index} 
                                whileHover={{ y: -8 }}
                                className="relative aspect-[4/5] w-[260px] sm:w-[320px] shrink-0 rounded-[2rem] overflow-hidden group shadow-xl border-4 border-white snap-center"
                            >
                                <Image
                                    src={url}
                                    alt={`Outcome asset ${index + 1}`}
                                    fill
                                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col justify-end p-6">
                                    <p className="text-white font-black uppercase text-xs tracking-tight">View Full Record</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>
      </main>
      
        {/* Tactical Footer */}
        <footer className="fixed bottom-0 left-0 right-0 z-[60] p-4 md:p-8 flex justify-center pointer-events-none">
            <div className="w-full max-w-lg pointer-events-auto bg-white/80 backdrop-blur-2xl p-2 rounded-[2rem] border-2 border-white/50 shadow-3xl">
                <Button 
                    className="w-full h-14 sm:h-16 rounded-[1.5rem] text-sm sm:text-base font-black uppercase tracking-widest shadow-2xl bg-primary text-white hover:bg-primary/90 transition-all active:scale-95 group"
                    onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
                >
                    Initialize Booking
                    <ArrowRight className="ml-2 sm:ml-3 w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-1" />
                </Button>
            </div>
        </footer>

        {selectedService && (
            <BookingSheet 
                open={isBookingSheetOpen}
                onOpenChange={setIsBookingSheetOpen}
                service={selectedService}
                staff={staff || []}
                pricingTiers={pricingTiers || []}
                initialStaffId={staffId}
                consentForms={consentForms || []}
                tenant={selectedTenant || null}
                onConfirm={handleConfirmBooking}
                appointments={appointments || []}
                events={events || []}
                scheduleProfiles={scheduleProfiles || []}
                services={services || []}
            />
        )}
    </div>
  );
}
