'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  DollarSign,
  Calendar,
  FileText,
  FlaskConical,
  PlusCircle,
  ShieldPlus,
  AlertTriangle,
  Ear,
  Upload,
  Eye,
  ShieldAlert,
  BadgeInfo,
  Ban,
  MessageSquare,
  Home,
  User as UserIcon,
  Gift,
  Copy,
  Save,
  Award,
  Repeat,
  CheckCircle,
  Percent,
  Loader,
  Instagram,
  Facebook,
  Twitter,
  Film,
  Pin,
  Youtube,
  Link as LinkIcon,
  Star,
  Clock,
  BookOpen,
  Users,
} from 'lucide-react';
import { appointments as initialAppointments, services as initialServices, inventory, type CustomFormula, Client, type Incident, type Appointment, type Service, Staff, DayHours } from '@/lib/data';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ImageUpload } from '@/components/shared/ImageUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogIncidentDialog } from '@/components/incidents/LogIncidentDialog';
import { IncidentFormData } from '@/components/incidents/LogIncidentForm';
import Image from 'next/image';
import { EditClientDialog } from '@/components/clients/EditClientDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInventory } from '@/context/InventoryContext';
import { formatPhoneNumber } from 'react-phone-number-input';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { nanoid } from 'nanoid';
import { useFirebase, useCollection, useDoc, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, arrayUnion } from 'firebase/firestore';
import { buttonVariants } from '@/components/ui/button';


type ClientPhoto = {
  url: string;
  label: string;
};

const ServiceCard = ({ service, onBookNow }: { service: Service, onBookNow: (service: Service) => void }) => {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 space-y-1">
                    <h4 className="font-semibold">{service.name}</h4>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/>{service.duration} min</span>
                        <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4"/>{service.price.toFixed(2)}</span>
                    </div>
                </div>
                <Button onClick={() => onBookNow(service)}><BookOpen className="w-4 h-4 mr-2"/>Book</Button>
            </CardContent>
        </Card>
    )
}

const getFormattedSchedule = (availability?: { week: { [key: string]: DayHours } }) => {
    if (!availability?.week) return 'Not Available';

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const activeDays: { [key: string]: { start: string, end: string, days: string[] } } = {};
    let lastRangeKey: string | null = null;
    let currentDayIndex = -1;
    let dayAbbr = '';

    days.forEach(day => {
        const dayInfo = availability.week[day];
        if (dayInfo && dayInfo.enabled) {
            const rangeKey = `\'\'\'${dayInfo.start}\'\'\'-\'\'\'${dayInfo.end}\'\'\'`;
            if (rangeKey === lastRangeKey && (days.indexOf(day) === currentDayIndex + 1)) {
                activeDays[rangeKey].days[activeDays[rangeKey].days.length - 1] = `\'\'\'${dayAbbr}\'\'\'-\'\'\'${day.substring(0,3)}\'\'\'`;
            } else {
                 if(!activeDays[rangeKey]) {
                    activeDays[rangeKey] = { start: dayInfo.start, end: dayInfo.end, days: [] };
                 }
                dayAbbr = day.substring(0,3);
                activeDays[rangeKey].days.push(dayAbbr);
            }
            lastRangeKey = rangeKey;
            currentDayIndex = days.indexOf(day);
        } else {
            lastRangeKey = null;
        }
    });

    return Object.values(activeDays).map(group => `\'\'\'${group.days.join(', ')}\'\'\': \'\'\'${group.start}\'\'\'-\'\'\'${group.end}\'\'\'`).join(' | ');
};



export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const { id: staffId } = params;

  const { firestore, isUserLoading } = useFirebase();
  const tenantId = 'tenant-abc';
  
  const staffDocRef = useMemoFirebase(() => {
      if (!firestore || !staffId) return null;
      return doc(firestore, `tenants/${tenantId}/staff/${staffId}`);
  }, [firestore, tenantId, staffId]);

  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);
  
  const clientsQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/clients`) : null, [firestore, tenantId]);
  const { data: allClients, isLoading: allClientsLoading } = useCollection<Client>(clientsQuery);
  const appointmentsQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/appointments`) : null, [firestore, tenantId]);
  const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

  const { services, staff } = useInventory();

  const { toast } = useToast();
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [serviceToBook, setServiceToBook] = useState<Service | null>(null);

  const handleBookNow = (service: Service) => {
    setServiceToBook(service);
    setIsAddAppointmentOpen(true);
  }

  const handleAddAppointment = (newAppointment: Omit<Appointment, 'id'>) => {
    // Logic to add appointment to Firestore
  };

  const isLoading = isUserLoading || staffLoading || allClientsLoading || appointmentsLoading;
  
  const staffServices = useMemo(() => {
      if (!staffMember?.services) return [];
      return services.filter(s => staffMember.services?.includes(s.id));
  }, [staffMember, services]);

  if (isLoading) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-muted/40">
            <AppHeader title="Staff Profile" />
            <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
              <Loader className="w-8 h-8 animate-spin" />
            </main>
          </div>
      )
  }

  if (!staffMember) {
    notFound();
  }
  
  const formattedSchedule = getFormattedSchedule(staffMember.availability);

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
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
            <Button variant="outline" size="icon" asChild>
                 <Link href="/staff">
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
                        <Award className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-lg font-bold">{staffMember.yearsOfExperience || 5}+</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Years Exp.</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 space-y-1">
                        <Users className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-lg font-bold">{staffMember.clientCount || 200}+</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Clients</p>
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
            
            <Tabs defaultValue="about" className="max-w-lg mx-auto">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="about">About</TabsTrigger>
                    <TabsTrigger value="services">Services</TabsTrigger>
                    <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                </TabsList>
                <TabsContent value="about" className="space-y-6 pt-6">
                    <Card>
                        <CardHeader><CardTitle>About {staffMember.name.split(' ')[0]}</CardTitle></CardHeader>
                        <CardContent><p className="text-muted-foreground">{staffMember.bio || 'A passionate professional dedicated to their craft and clients.'}</p></CardContent>
                    </Card>
                     <Card>
                        <CardHeader><CardTitle>Schedule</CardTitle></CardHeader>
                        <CardContent><p className="text-muted-foreground">{formattedSchedule}</p></CardContent>
                    </Card>
                </TabsContent>
                 <TabsContent value="services" className="space-y-4 pt-6">
                    {staffServices.map(service => (
                        <ServiceCard key={service.id} service={service} onBookNow={handleBookNow} />
                    ))}
                 </TabsContent>
                  <TabsContent value="portfolio" className="pt-6">
                       <ScrollArea>
                        <div className="flex space-x-4 pb-4">
                            {portfolioImages.map((url, index) => (
                            <div key={index} className="relative aspect-square w-64 h-64 md:w-80 md:h-80 flex-shrink-0 rounded-xl overflow-hidden group">
                                <Image
                                src={url}
                                alt={`Portfolio image \'\'\'${index + 1}\'\'\'`}
                                fill
                                className="object-cover transition-transform duration-300 group-hover:scale-110"
                                />
                            </div>
                            ))}
                        </div>
                        <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                  </TabsContent>
            </Tabs>
      </main>
      
        <footer className="sticky bottom-0 z-30 p-4 border-t bg-background/80 backdrop-blur-sm print:hidden">
            <div className="max-w-lg mx-auto">
                <Button className="w-full h-12 text-lg" onClick={() => {
                    const servicesTab = document.querySelector('[data-radix-collection-item][value="services"]');
                    if (servicesTab) (servicesTab as HTMLElement).click();
                }}>
                    Book Appointment
                </Button>
            </div>
        </footer>

        {serviceToBook && (
            <AddAppointmentDialog 
                open={isAddAppointmentOpen}
                onOpenChange={(isOpen) => {
                    if (!isOpen) setServiceToBook(null);
                    setIsAddAppointmentOpen(isOpen);
                }}
                clients={allClients || []}
                services={services}
                staff={staff || []}
                appointments={appointments || []}
                events={[]}
                scheduleProfiles={[]}
                onConfirm={handleAddAppointment}
                initialClientId={''}
                appointmentToRebook={{...{} as Appointment, serviceId: serviceToBook.id, staffId: staffMember.id}}
            />
        )}
    </div>
  );

}
