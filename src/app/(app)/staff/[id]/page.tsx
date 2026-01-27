
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ArrowLeft,
  DollarSign,
  Calendar,
  FileText,
  Instagram,
  Link as LinkIcon,
  Facebook,
  Twitter,
  Film,
  Pin,
  Youtube,
  Star,
  BookOpen,
  Users,
  Award,
} from 'lucide-react';
import { services as initialServices, type Service, Staff, DayHours, ActivityLog } from '@/lib/data';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { useFirebase, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { Loader } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ClientPhoto = {
  url: string;
  label: string;
};

const ServiceCard = ({ service, onBookNow }: { service: Service, onBookNow: (service: Service) => void }) => {
    return (
        <Card className="flex flex-col hover:shadow-lg transition-shadow h-full overflow-hidden">
            {service.imageUrl && (
                <div className="relative aspect-video w-full">
                    <Image
                        src={service.imageUrl}
                        alt={service.name}
                        fill
                        className="object-cover"
                    />
                </div>
            )}
            <CardHeader>
                <CardTitle className="text-lg">{service.name}</CardTitle>
                {service.description && (
                    <CardDescription className="line-clamp-2 h-10 pt-1">
                        {service.description}
                    </CardDescription>
                )}
            </CardHeader>
            <CardContent className="flex-1" />
            <CardFooter className="flex items-center justify-between p-4 bg-muted/50">
                <div className="flex items-center gap-4 text-sm font-medium">
                    <div className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-muted-foreground"/>{service.duration} min</div>
                    <div className="flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-muted-foreground"/>{service.price.toFixed(2)}</div>
                </div>
                <Button onClick={() => onBookNow(service)}><BookOpen className="w-4 h-4 mr-2"/>Book</Button>
            </CardFooter>
        </Card>
    );
}

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

  const servicesQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/services`) : null, [firestore, tenantId]);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);

  const activityLogsQuery = useMemoFirebase(() => {
      if (!firestore || !staffId) return null;
      return collection(firestore, `tenants/${tenantId}/activityLogs`);
  }, [firestore, tenantId, staffId]);
  const { data: allActivityLogs, isLoading: activityLogsLoading } = useCollection<ActivityLog>(activityLogsQuery);

  const staffActivityLogs = useMemo(() => {
      if (!allActivityLogs || !staffId) return [];
      return allActivityLogs.filter(log => log.staffId === staffId).sort((a,b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
  }, [allActivityLogs, staffId]);

  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [serviceToBook, setServiceToBook] = useState<Service | null>(null);

  const handleBookNow = (service: Service) => {
    setServiceToBook(service);
    setIsAddAppointmentOpen(true);
  }

  const handleAddAppointment = (newAppointment: any) => {
    // Logic to add appointment would go here
    setIsAddAppointmentOpen(false);
  };

  const isLoading = isUserLoading || staffLoading || servicesLoading || activityLogsLoading;

    const formattedSchedule = useMemo(() => {
        const availability = staffMember?.availability;
        if (!availability?.week) return 'Not available';

        const weekOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const groups: { startDay: string, endDay: string, start: string, end: string }[] = [];

        let currentGroup: { startDay: string, endDay: string, start: string, end: string } | null = null;

        for (const day of weekOrder) {
            const dayInfo = availability.week[day as keyof typeof availability.week];
            if (dayInfo && dayInfo.enabled) {
                if (currentGroup && currentGroup.start === dayInfo.start && currentGroup.end === dayInfo.end) {
                    currentGroup.endDay = day;
                } else {
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        startDay: day,
                        endDay: day,
                        start: dayInfo.start,
                        end: dayInfo.end
                    };
                }
            } else {
                if (currentGroup) {
                    groups.push(currentGroup);
                }
                currentGroup = null;
            }
        }
        if (currentGroup) {
            groups.push(currentGroup);
        }
        
        if (groups.length === 0) return 'Not available on weekdays.';

        return groups.map(group => {
            const startDay = group.startDay.slice(0, 3);
            const endDay = group.endDay.slice(0, 3);
            const dayRange = startDay === endDay ? startDay.charAt(0).toUpperCase() + startDay.slice(1) : `${startDay.charAt(0).toUpperCase() + startDay.slice(1)} - ${endDay.charAt(0).toUpperCase() + endDay.slice(1)}`;
            
            return `${dayRange} (${group.start} - ${group.end})`;
        }).join(' | ');
    }, [staffMember?.availability]);
  
  const staffServices = useMemo(() => {
      if (!staffMember?.services || !services) return [];
      return services.filter(s => staffMember.services?.includes(s.id));
  }, [staffMember, services]);

  if (isLoading) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-slate-50 dark:bg-slate-900">
            <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
              <Loader className="w-8 h-8 animate-spin" />
            </main>
          </div>
      )
  }

  if (!staffMember) {
    notFound();
  }
  
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
    <div className="flex min-h-screen w-full flex-col bg-slate-50 dark:bg-slate-900">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-background/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
            <Button variant="outline" size="icon" asChild>
                 <Link href="/staff">
                    <ArrowLeft className="h-4 w-4" />
                </Link>
            </Button>
        </header>

      <main className="flex-1 p-4 md:p-6 space-y-6 pb-24">
            <Tabs defaultValue="overview">
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
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="activity">Activity Log</TabsTrigger>
                    </TabsList>
                </div>
                <TabsContent value="overview" className="max-w-lg mx-auto space-y-6">
                    <div className="grid grid-cols-3 gap-2 md:gap-4 text-center">
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
                    
                    <Card>
                        <CardHeader><CardTitle>About {staffMember.name.split(' ')[0]}</CardTitle></CardHeader>
                        <CardContent><p className="text-muted-foreground">{staffMember.bio || 'A passionate professional dedicated to their craft and clients.'}</p></CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Working Time</CardTitle></CardHeader>
                        <CardContent><p className="text-muted-foreground">{formattedSchedule}</p></CardContent>
                    </Card>

                    <div id="services" className="space-y-4 pt-6">
                        <h2 className="text-2xl font-bold text-center">Services</h2>
                        {staffServices.map(service => (
                            <ServiceCard key={service.id} service={service} onBookNow={handleBookNow} />
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
                </TabsContent>
                <TabsContent value="activity" className="max-w-3xl mx-auto">
                    <Card>
                        <CardHeader>
                            <CardTitle>Activity Log</CardTitle>
                            <CardDescription>A record of clock-ins, clock-outs, and breaks.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date & Time</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead className="text-right">Duration</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {staffActivityLogs.map(log => (
                                        <TableRow key={log.id}>
                                            <TableCell>{format(parseISO(log.timestamp), 'PPP p')}</TableCell>
                                            <TableCell className="capitalize">{log.type.replace('_', ' ')}</TableCell>
                                            <TableCell className="text-right">
                                                {log.durationMinutes ? `${log.durationMinutes} min` : '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                             {staffActivityLogs.length === 0 && <p className="text-center text-muted-foreground py-10">No activity recorded yet.</p>}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
      </main>
      
        <footer className="sticky bottom-0 z-30 p-4 border-t bg-background/80 backdrop-blur-sm print:hidden">
            <div className="max-w-lg mx-auto">
                <Button asChild className="w-full h-12 text-lg">
                    <a href="#services">Book Appointment</a>
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
                clients={[]}
                services={services || []}
                staff={[]}
                appointments={[]}
                events={[]}
                scheduleProfiles={[]}
                onConfirm={handleAddAppointment}
                initialClientId={''}
                appointmentToRebook={{...{} as any, serviceId: serviceToBook.id, staffId: staffMember.id}}
            />
        )}
    </div>
  );

}
