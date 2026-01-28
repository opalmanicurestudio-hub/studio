
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase, setDocumentNonBlocking } from '@/firebase';
import { doc, collection, query, where, getDocs } from 'firebase/firestore';
import type { Staff, Service, Appointment, Event, ConsentForm, Tenant, Client } from '@/lib/data';
import { Loader, ArrowLeft, Clock, DollarSign, BookOpen, Award, Users, Star, Instagram, Link as LinkIcon, Facebook, Twitter, Film, Pin, Youtube } from 'lucide-react';
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
import { format, parseISO, getDay } from 'date-fns';

const ServiceCard = ({ service, onBookNow }: { service: Service, onBookNow: (service: Service) => void }) => {
    if (service.imageUrl) {
        return (
        <div className="cursor-pointer group h-full" onClick={onBookNow}>
            <Card className="overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full flex flex-col">
            <CardContent className="p-0 flex flex-col flex-1">
                <div className="relative aspect-[4/3] w-full bg-muted/30">
                <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-110"
                />
                </div>
                <div className="p-4 space-y-2 flex flex-col flex-1">
                <h3 className="font-semibold truncate">{service.name}</h3>
                <div className="flex-grow min-h-[32px]">
                    {service.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                        {service.description}
                    </p>
                    )}
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t mt-auto">
                    <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{service.duration} min</span>
                    </div>
                    <div className="flex items-center gap-2 font-medium text-foreground">
                    <DollarSign className="w-4 h-4" />
                    <span>{service.price.toFixed(2)}</span>
                    </div>
                </div>
                </div>
            </CardContent>
            </Card>
        </div>
        );
    }

    // Text-based card
    return (
        <div className="cursor-pointer group h-full" onClick={onBookNow}>
        <Card className="transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full flex flex-col bg-muted/30">
            <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex-grow">
                <h3 className="font-semibold text-lg mb-2">{service.name}</h3>
                {service.description && (
                <p className="text-xs text-muted-foreground line-clamp-3">
                    {service.description}
                </p>
                )}
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t mt-4">
                <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>{service.duration} min</span>
                </div>
                <div className="flex items-center gap-2 font-medium text-foreground">
                <DollarSign className="w-4 h-4" />
                <span>{service.price.toFixed(2)}</span>
                </div>
            </div>
            </CardContent>
        </Card>
        </div>
    );
};

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

  // Fetch staff member
  const staffDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/staff/${staffId}`), [firestore, tenantId, staffId]);
  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

  // Fetch all services
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const { data: allServices, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  
  // Other data needed for BookingSheet
  const appointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const eventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]);
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);

  const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);
  const { data: events, isLoading: eventsLoading } = useCollection<Event>(eventsQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(consentFormsQuery);
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const allStaffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const { data: staff, isLoading: allStaffLoading } = useCollection<Staff>(allStaffQuery);


  // Filter services offered by this staff member
  const staffServices = useMemo(() => {
    if (!staffMember || !allServices) return [];
    const staffSkillLevel = staffMember.skillLevel || 'senior';
    return allServices
        .filter(service => staffMember.services?.includes(service.id) && !service.isPrivate)
        .map(service => {
            const tierPrice = service.pricingTiers?.find(t => t.level === staffSkillLevel)?.price;
            return {
                ...service,
                price: tierPrice || service.price 
            };
        });
  }, [staffMember, allServices]);

  const weekOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service);
    setIsSheetOpen(true);
  };
  
  const handleConfirmBooking = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
    setBookingStep: (step: string) => void
  ) => {
    if (!firestore) return;
    setIsSubmitting(true);
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
            await setDocumentNonBlocking(newClientRef, { ...newClient, id: clientId });
            toast({ title: "Welcome!", description: "A new client profile has been created for you." });
        } else {
            const existingClientDoc = querySnapshot.docs[0];
            clientId = existingClientDoc.id;
            clientName = existingClientDoc.data().name;
        }

        const appointmentRef = collection(firestore, `tenants/${tenantId}/appointments`);
        const newAppointmentId = nanoid();
        const checkInToken = nanoid(16);

        const newAppointment = {
            ...appointmentDetails,
            id: newAppointmentId,
            clientId: clientId,
            clientName: clientName,
            clientEmail: formData.clientEmail,
            clientPhone: formData.clientPhone,
            checkInToken: checkInToken,
        };

        await setDocumentNonBlocking(doc(appointmentRef, newAppointmentId), newAppointment);

        const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
        await setDocumentNonBlocking(checkInDocRef, newAppointment);
        
        toast({
          title: 'Booking Confirmed!',
          description: `Your appointment is all set.`,
        });
        setBookingStep('confirmation');

    } catch (error) {
        console.error("Booking error:", error);
        toast({ variant: 'destructive', title: "Booking Failed", description: "Could not save your appointment. Please try again." });
    } finally {
        setIsSubmitting(false);
    }
  };

  const isLoading = staffLoading || servicesLoading || appointmentsLoading || eventsLoading || scheduleProfilesLoading || consentFormsLoading || tenantLoading || allStaffLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader className="h-8 w-8 animate-spin" />
        <p className="text-muted-foreground">Loading staff profile...</p>
      </div>
    );
  }

  if (!staffMember) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Staff Member Not Found</h2>
        <p className="text-muted-foreground mt-2">The profile you're looking for doesn't exist.</p>
        <Button asChild className="mt-6">
            <Link href={`/book/${tenantId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Booking
            </Link>
        </Button>
      </div>
    );
  }

  // Mock portfolio images if not present
  const portfolioImages = staffMember.portfolioImageUrls && staffMember.portfolioImageUrls.length > 0 
    ? staffMember.portfolioImageUrls 
    : [
        'https://picsum.photos/seed/p1/600/600',
        'https://picsum.photos/seed/p2/600/600',
        'https://picsum.photos/seed/p3/600/600',
        'https://picsum.photos/seed/p4/600/600',
        'https://picsum.photos/seed/p5/600/600',
    ];


  return (
    <div className="w-full">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-muted/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
            <Button variant="outline" size="icon" asChild>
                 <Link href={`/book/${tenantId}`}>
                    <ArrowLeft className="h-4 w-4" />
                </Link>
            </Button>
        </header>

      <main className="flex-1 p-4 md:p-6 space-y-6">
           <div className="text-center space-y-4">
                <Avatar className="w-28 h-28 text-4xl border-4 border-background mx-auto shadow-lg">
                    <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} />
                    <AvatarFallback>{staffMember.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div>
                    <h1 className="text-3xl font-bold">{staffMember.name}</h1>
                    <p className="text-lg text-muted-foreground">{staffMember.specialties?.join(', ')}</p>
                    <p className="text-sm flex items-center justify-center gap-1 mt-1 text-muted-foreground"><Star className="w-4 h-4 text-amber-400 fill-amber-400" /> 4.9 (462 reviews)</p>
                </div>
                 <div className="flex items-center justify-center gap-2">
                    {staffMember.instagramUrl && <a href={staffMember.instagramUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Instagram className="h-5 w-5" /></a>}
                    {staffMember.facebookUrl && <a href={staffMember.facebookUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Facebook className="h-5 w-5" /></a>}
                    {staffMember.twitterUrl && <a href={staffMember.twitterUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Twitter className="h-5 w-5" /></a>}
                    {staffMember.tiktokUrl && <a href={staffMember.tiktokUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Film className="h-5 w-5" /></a>}
                    {staffMember.pinterestUrl && <a href={staffMember.pinterestUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Pin className="h-5 w-5" /></a>}
                    {staffMember.youtubeUrl && <a href={staffMember.youtubeUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><Youtube className="h-5 w-5" /></a>}
                    {staffMember.portfolioUrl && <a href={staffMember.portfolioUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}><LinkIcon className="h-5 w-5" /></a>}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 md:gap-4 max-w-lg mx-auto text-center">
                <Card>
                    <CardContent className="p-3 space-y-1">
                        <Users className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-lg font-bold">{staffMember.clientCount || 200}+</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Clients</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 space-y-1">
                        <Award className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-lg font-bold">{staffMember.yearsOfExperience || 5}+</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Years Exp.</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 space-y-1">
                        <Star className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-lg font-bold">4.9</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Rating</p>
                    </CardContent>
                </Card>
            </div>
            
            <div className="max-w-lg mx-auto space-y-6">
                <Card>
                    <CardHeader><CardTitle>About {staffMember.name.split(' ')[0]}</CardTitle></CardHeader>
                    <CardContent><p className="text-muted-foreground">{staffMember.bio || 'A passionate professional dedicated to their craft and clients.'}</p></CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Working Time</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {staffMember?.availability?.week ? (
                            weekOrder.map(day => {
                                const hours = staffMember.availability.week[day as keyof typeof staffMember.availability.week];
                                if (!hours) return null;
                                return (
                                    <div key={day} className="flex justify-between items-center text-sm">
                                        <span className="capitalize font-medium">{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            {hours.enabled ? (
                                                <>
                                                    <Clock className="w-4 h-4" />
                                                    <span>{hours.start} - {hours.end}</span>
                                                </>
                                            ) : (
                                                'Closed'
                                            )}
                                        </span>
                                    </div>
                                )
                            })
                        ) : (
                            <p className="text-muted-foreground">Not available</p>
                        )}
                    </CardContent>
                </Card>

                 <div id="services" className="space-y-4 pt-6">
                    <h2 className="text-2xl font-bold text-center">Services</h2>
                    {staffServices.map(service => (
                        <ServiceCard key={service.id} service={service} onBookNow={handleServiceSelect} />
                    ))}
                 </div>

                 <div className="space-y-4 pt-6">
                    <h2 className="text-2xl font-bold text-center">Portfolio</h2>
                    <ScrollArea>
                        <div className="flex space-x-4 pb-4">
                            {portfolioImages.map((url, index) => (
                            <div key={index} className="relative aspect-square w-64 h-64 md:w-80 md:h-80 flex-shrink-0 rounded-xl overflow-hidden group">
                                <Image
                                src={url}
                                alt={`Portfolio image ${index + 1}`}
                                fill
                                className="object-cover transition-transform duration-300 group-hover:scale-110"
                                />
                            </div>
                            ))}
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                 </div>
            </div>
      </main>
      
        <footer className="sticky bottom-0 z-30 p-4 border-t bg-background/80 backdrop-blur-sm print:hidden">
            <div className="max-w-lg mx-auto">
                <Button asChild className="w-full h-12 text-lg">
                    <a href="#services">Book Appointment</a>
                </Button>
            </div>
        </footer>

        {selectedService && staff && (
            <BookingSheet 
                open={isSheetOpen}
                onOpenChange={setIsSheetOpen}
                service={selectedService}
                staff={staff}
                initialStaffId={staffId}
                appointments={appointments || []}
                events={events || []}
                scheduleProfiles={scheduleProfiles || []}
                services={allServices || []}
                consentForms={consentForms || []}
                tenant={tenant || null}
                onConfirm={handleConfirmBooking}
            />
        )}
    </div>
  );

}
