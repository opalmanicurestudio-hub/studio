
'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { ArrowLeft, Edit, Mail, Phone, DollarSign, Calendar, FileText, FlaskConical, PlusCircle, ShieldPlus, AlertTriangle, Ear, ShieldAlert, Upload, Eye } from 'lucide-react';
import { clients as initialClients, appointments, services, inventory, type CustomFormula, Client, type Incident } from '@/lib/data';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AddFormulaDialog } from '@/components/clients/AddFormulaDialog';
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


type ClientPhoto = {
  url: string;
  label: string;
};

const FormulaCard = ({ formula }: { formula: CustomFormula }) => (
    <AccordionItem value={formula.name} className="border-b-0">
        <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline text-base">
            <div className="flex items-center gap-3">
                <FlaskConical className="w-5 h-5 text-primary" />
                <span className="font-semibold">{formula.name}</span>
            </div>
        </AccordionTrigger>
        <AccordionContent className="pt-4 space-y-3">
            {formula.items.map((item, index) => (
                <div key={index} className="p-3 rounded-md bg-background border text-sm">
                    <p className="font-medium">{item.quantityUsed}{item.unit} {item.productName}</p>
                    {item.note && <p className="text-xs text-muted-foreground pl-4">&ndash; {item.note}</p>}
                </div>
            ))}
             <Button variant="outline" size="sm" className="mt-2"><Edit className="w-3 h-3 mr-2"/>Edit Formula</Button>
        </AccordionContent>
    </AccordionItem>
)

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const client = clients.find((c) => c.id === params.id);
  const { toast } = useToast();
  const [isAddFormulaOpen, setIsAddFormulaOpen] = useState(false);
  const [isLogIncidentOpen, setIsLogIncidentOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<ClientPhoto | null>(null);

  useEffect(() => {
    setIsClient(true);
    if (client) {
        const collectedPhotos: ClientPhoto[] = [];
        if (client.inspirationPhotoUrl) {
            collectedPhotos.push({ url: client.inspirationPhotoUrl, label: 'Client Inspiration' });
        }
        
        appointments.forEach(apt => {
            if (apt.clientId === client.id && apt.inspirationPhotoUrl) {
                collectedPhotos.push({ url: apt.inspirationPhotoUrl, label: `Inspo for ${format(apt.startTime, 'MMM d, yyyy')}`});
            }
        });
        setPhotos(collectedPhotos);
    }
  }, [client]);

  if (!client) {
    notFound();
  }

  const clientAppointments = appointments.filter(apt => apt.clientId === client.id);
  const upcomingAppointments = clientAppointments.filter(apt => apt.startTime > new Date() && apt.status !== 'cancelled');
  const pastAppointments = clientAppointments.filter(apt => apt.startTime <= new Date()).sort((a,b) => b.startTime.getTime() - a.startTime.getTime());

  const handleSaveFormula = (newFormula: CustomFormula) => {
    setClients(prevClients => 
      prevClients.map(c => {
        if (c.id === client.id) {
          return {
            ...c,
            customFormulas: [...(c.customFormulas || []), newFormula]
          };
        }
        return c;
      })
    );
    toast({
      title: 'Formula Saved!',
      description: `"${newFormula.name}" has been added to ${client.name}'s profile.`,
    });
  };

  const handleNewPhotoUpload = (url: string) => {
      if (url) {
          const newPhoto: ClientPhoto = { url, label: `Uploaded on ${format(new Date(), 'MMM d, yyyy')}` };
          setPhotos(prev => [newPhoto, ...prev]);
          toast({
              title: "Photo Uploaded!",
              description: "The new image has been added to the client's gallery."
          })
      }
  }
  
   const handleIncidentLogged = (incidentData: IncidentFormData) => {
    setClients(prevClients =>
      prevClients.map(c => {
        if (c.id === client.id) {
          const newIncident: Incident = {
            ...incidentData,
            id: `inc-${Date.now()}`,
            date: new Date().toISOString(),
          };
          const existingIncidents = c.intel?.incidents || [];
          return {
            ...c,
            intel: {
              ...c.intel,
              hasIncidents: true,
              incidents: [...existingIncidents, newIncident],
            },
          };
        }
        return c;
      })
    );
    toast({
      title: "Incident Logged",
      description: `A new incident has been recorded for ${client.name}.`,
    });
  };

  if (!isClient) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Client Profile" />
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <Skeleton className="h-7 w-7" />
                    <Skeleton className="w-12 h-12 rounded-full" />
                    <div className='flex-1 space-y-2'>
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-64" />
                    </div>
                    <Skeleton className="h-10 w-28" />
                </div>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-96 w-full" />
            </main>
        </div>
    );
  }

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
                <div className='flex-1 min-w-0'>
                    <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">
                        {client.name}
                    </h1>
                     <div className="text-xs sm:text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:gap-4 break-words">
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
                <TabsTrigger value="incidents">Incidents</TabsTrigger>
                <TabsTrigger value="consents">Consents</TabsTrigger>
              </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            <TabsContent value="overview" className="mt-6">
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Client Details</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1 break-words">
                                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                                    <p>{client.email}</p>
                                </div>
                                <div className="space-y-1 break-words">
                                    <p className="text-sm font-medium text-muted-foreground">Phone</p>
                                    <p>{client.phone}</p>
                                </div>
                                 <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Birthday</p>
                                    <p>October 26</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Referral Source</p>
                                    <p>Client Referral</p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                             <CardHeader>
                                <CardTitle>Client Wallet</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-lg bg-muted/50">
                                    <div className="text-sm text-muted-foreground">Store Credit</div>
                                    <div className="text-2xl font-bold">$0.00</div>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                    <div className="text-sm text-muted-foreground">Gift Card Balance</div>
                                    <div className="text-2xl font-bold">$50.00</div>
                                </div>
                            </CardContent>
                        </Card>
                         <Card>
                             <CardHeader>
                                <CardTitle>Active Offers</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-center text-muted-foreground py-8">No active memberships or packages.</p>
                            </CardContent>
                        </Card>
                    </div>
                     <div className="lg:col-span-1 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Client Intel</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {client.medicalNotes && <div className="flex items-start gap-3 p-3 rounded-md bg-red-500/5"><ShieldPlus className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" /><p className="text-sm">{client.medicalNotes}</p></div>}
                                {client.allergyNotes && <div className="flex items-start gap-3 p-3 rounded-md bg-orange-500/5"><AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" /><p className="text-sm">{client.allergyNotes}</p></div>}
                                {client.sensoryNeeds && <div className="flex items-start gap-3 p-3 rounded-md bg-blue-500/5"><Ear className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" /><p className="text-sm">{client.sensoryNeeds}</p></div>}
                                {(!client.medicalNotes && !client.allergyNotes && !client.sensoryNeeds) && <p className="text-xs text-muted-foreground text-center">No special intel recorded.</p>}
                            </CardContent>
                        </Card>

                        <Card>
                            <Tabs defaultValue="formulas" className="w-full">
                                <CardHeader className="p-4">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="formulas">Formulas</TabsTrigger>
                                        <TabsTrigger value="notes">Notes</TabsTrigger>
                                    </TabsList>
                                </CardHeader>
                                <TabsContent value="formulas" className="m-0">
                                    <CardContent className="p-4 pt-0 space-y-4">
                                        {client.customFormulas && client.customFormulas.length > 0 ? (
                                            <Accordion type="multiple" className="w-full space-y-4">
                                                {client.customFormulas.map(formula => (
                                                    <FormulaCard key={formula.name} formula={formula} />
                                                ))}
                                            </Accordion>
                                        ) : (
                                            <div className="text-center text-sm text-muted-foreground py-8">
                                                <p>No custom formulas saved for {client.name}.</p>
                                            </div>
                                        )}
                                        <Button variant="outline" className="w-full" onClick={() => setIsAddFormulaOpen(true)}>
                                            <PlusCircle className="w-4 h-4 mr-2" /> Add New Formula
                                        </Button>
                                    </CardContent>
                                </TabsContent>
                                <TabsContent value="notes" className="m-0">
                                    <CardContent className="p-4 pt-0 space-y-4">
                                        <Textarea placeholder="General client notes, preferences, etc." defaultValue={client.notes || ""}/>
                                        <Button>Save Note</Button>
                                    </CardContent>
                                </TabsContent>
                            </Tabs>
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
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <CardTitle>Photo Gallery</CardTitle>
                                <CardDescription>Inspiration and before/after photos.</CardDescription>
                            </div>
                            <ImageUpload onImageUploaded={handleNewPhotoUpload} />
                        </div>
                    </CardHeader>
                    <CardContent>
                        {photos.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {photos.map((photo, index) => (
                                    <div key={index} className="group relative aspect-square" onClick={() => setSelectedPhoto(photo)}>
                                        <Image
                                            src={photo.url}
                                            alt={photo.label}
                                            fill
                                            className="object-cover rounded-md transition-transform group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Eye className="w-8 h-8 text-white" />
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-md">
                                            <p className="text-white text-xs truncate">{photo.label}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-16 px-6 border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">No photos have been added for {client.name} yet.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="incidents" className="mt-6">
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Incident Log</CardTitle>
                            <CardDescription>A secure log of any incidents or issues.</CardDescription>
                        </div>
                        <Button variant="outline" onClick={() => setIsLogIncidentOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Log New Incident</Button>
                    </CardHeader>
                    <CardContent>
                       {client.intel?.incidents && client.intel.incidents.length > 0 ? (
                           <div className="space-y-4">
                               {client.intel.incidents.map(incident => (
                                   <div key={incident.id} className="p-4 rounded-lg border bg-muted/50">
                                       <div className="flex justify-between items-start">
                                           <div>
                                               <p className="font-semibold">{incident.type}</p>
                                                <p className="text-sm text-muted-foreground">{format(new Date(incident.date), 'MMM d, yyyy h:mm a')}</p>
                                           </div>
                                           <Badge variant={incident.severity === 'Severe' ? 'destructive' : 'secondary'}>{incident.severity}</Badge>
                                       </div>
                                       <p className="text-sm mt-2">{incident.description}</p>
                                        {incident.actionsTaken && <p className="text-xs mt-2 text-muted-foreground border-t pt-2">Actions Taken: {incident.actionsTaken}</p>}
                                   </div>
                               ))}
                           </div>
                       ) : (
                           <div className="border-2 border-dashed rounded-lg p-12 text-center">
                                <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
                                <h3 className="font-semibold text-lg">No Incidents Logged</h3>
                                <p className="text-sm text-muted-foreground">This client has a clean record.</p>
                           </div>
                       )}
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="consents" className="mt-6">
                 <Card>
                    <CardHeader>
                         <div>
                            <CardTitle>Signed Forms</CardTitle>
                            <CardDescription>All consent forms signed by {client.name}.</CardDescription>
                         </div>
                    </CardHeader>
                    <CardContent>
                       <div className="border-2 border-dashed rounded-lg p-12 text-center">
                            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
                            <h3 className="font-semibold text-lg">No Forms on File</h3>
                            <p className="text-sm text-muted-foreground">The ability to send and track forms is coming soon.</p>
                       </div>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
        
        <AddFormulaDialog 
            open={isAddFormulaOpen}
            onOpenChange={setIsAddFormulaOpen}
            onSave={handleSaveFormula}
        />

        <LogIncidentDialog 
            open={isLogIncidentOpen}
            onOpenChange={setIsLogIncidentOpen}
            client={client}
            onIncidentLogged={handleIncidentLogged}
        />

        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{selectedPhoto?.label}</DialogTitle>
                </DialogHeader>
                {selectedPhoto && (
                    <div className="relative aspect-video">
                        <Image src={selectedPhoto.url} alt={selectedPhoto.label} fill className="object-contain rounded-md" />
                    </div>
                )}
            </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

    

    

    