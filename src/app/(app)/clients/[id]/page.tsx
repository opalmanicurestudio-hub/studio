

import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit, Mail, Phone, DollarSign, Calendar, Hash, FileText } from 'lucide-react';
import { clients, appointments, services } from '@/lib/data';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = clients.find((c) => c.id === params.id);

  if (!client) {
    notFound();
  }

  const clientAppointments = appointments.filter(apt => apt.clientId === client.id);
  const upcomingAppointments = clientAppointments.filter(apt => apt.startTime > new Date() && apt.status !== 'canceled');
  const pastAppointments = clientAppointments.filter(apt => apt.startTime <= new Date()).sort((a,b) => b.startTime.getTime() - a.startTime.getTime());


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Client Profile" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-4 w-full">
                <Button variant="outline" size="icon" className="h-7 w-7 flex-shrink-0" asChild>
                    <Link href="/clients">
                        <ArrowLeft className="h-4 w-4" />
                        <span className="sr-only">Back</span>
                    </Link>
                </Button>
                <Avatar className="w-12 h-12">
                    <AvatarImage src={client.avatarUrl} alt={client.name} />
                    <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div className='flex-1'>
                    <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">
                        {client.name}
                    </h1>
                     <div className="text-xs sm:text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:gap-4">
                        <span>{client.email}</span>
                        <span>{client.phone}</span>
                    </div>
                </div>
            </div>

            <div className="w-full sm:w-auto sm:ml-auto">
                <Button variant="outline" className="w-full">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Profile
                </Button>
            </div>
        </div>
        
        <Tabs defaultValue="overview">
            <ScrollArea className="w-full">
              <TabsList className="inline-grid w-max grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="photos">Photos</TabsTrigger>
                <TabsTrigger value="referrals">Referrals</TabsTrigger>
                <TabsTrigger value="incidents">Incidents</TabsTrigger>
              </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            <TabsContent value="overview" className="mt-6">
                <div className="grid gap-6 md:grid-cols-3">
                    <div className="md:col-span-2 space-y-6">
                        <Card>
                             <CardHeader>
                                <CardTitle>Client Stats</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="p-4 rounded-lg bg-muted/50">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" /> Lifetime Value</div>
                                    <div className="text-2xl font-bold">${client.lifetimeValue.toFixed(2)}</div>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4" /> Last Visit</div>
                                    <div className="text-xl font-bold">{format(new Date(client.lastAppointment), "MMM d, yyyy")}</div>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2"><Hash className="w-4 h-4" /> Total Appointments</div>
                                    <div className="text-2xl font-bold">{clientAppointments.length}</div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                     <div className="md:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Notes</CardTitle>
                                <CardDescription>Color formulas, preferences, etc.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea placeholder="Add a new note..." defaultValue={client.notes || "Redken Shades EQ 1oz 9NB, 1oz 9G. Process for 20 minutes."}/>
                                <Button>Save Note</Button>
                            </CardContent>
                        </Card>
                     </div>
                </div>

            </TabsContent>
            <TabsContent value="history" className="mt-6 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Upcoming Appointments</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {upcomingAppointments.length > 0 ? (
                             <div className="space-y-4">
                                {upcomingAppointments.map((apt, index) => {
                                    const service = services.find(s => s.id === apt.serviceId);
                                    return (
                                        <div key={apt.id} className="relative flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                    <Calendar className="h-4 w-4" />
                                                </div>
                                                {index < upcomingAppointments.length - 1 && (
                                                    <div className="h-full w-px bg-border -mt-1"></div>
                                                )}
                                            </div>
                                            <div className="flex-1 pb-8">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <p className="font-medium">{service?.name || 'N/A'}</p>
                                                        <p className="text-sm text-muted-foreground">{format(apt.startTime, 'EEEE, MMMM d @ h:mm a')}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="capitalize">{apt.status}</Badge>
                                                        <Button variant="ghost" size="sm">Cancel</Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">No upcoming appointments.</p>
                        )}
                    </CardContent>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle>Past Appointments</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {pastAppointments.length > 0 ? (
                           <div className="space-y-4">
                                {pastAppointments.map((apt, index) => {
                                    const service = services.find(s => s.id === apt.serviceId);
                                    return (
                                        <div key={apt.id} className="relative flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className={cn(
                                                    "flex h-8 w-8 items-center justify-center rounded-full",
                                                    apt.status === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                                                    )}>
                                                    <DollarSign className="h-4 w-4" />
                                                </div>
                                                {index < pastAppointments.length - 1 && (
                                                    <div className="h-full w-px bg-border -mt-1"></div>
                                                )}
                                            </div>
                                            <div className="flex-1 pb-8">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <p className="font-medium">{service?.name || 'N/A'}</p>
                                                        <p className="text-sm text-muted-foreground">{format(apt.startTime, 'MMMM d, yyyy')}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={apt.status === 'completed' ? 'default' : 'secondary'} className={cn(
                                                            'capitalize',
                                                            apt.status === 'completed' && 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                                                        )}>{apt.status}</Badge>
                                                        <p className="font-semibold text-lg">${service?.price.toFixed(2) || '0.00'}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                             <p className="text-sm text-muted-foreground text-center py-4">No past appointments.</p>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="photos" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Photo Gallery</CardTitle>
                        <CardDescription>Inspiration and before/after photos.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground text-center py-12">Photo gallery functionality coming soon.</p>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="referrals" className="mt-6">
                 <Card>
                    <CardHeader>
                        <CardTitle>Referrals</CardTitle>
                        <CardDescription>Track clients referred by {client.name}.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground text-center py-12">Referral tracking functionality coming soon.</p>
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="incidents" className="mt-6">
                 <Card>
                    <CardHeader>
                        <CardTitle>Incident Log</CardTitle>
                        <CardDescription>Record of any incidents for this client.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground text-center py-12">Incident logging functionality coming soon.</p>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>

      </main>
    </div>
  );
}
