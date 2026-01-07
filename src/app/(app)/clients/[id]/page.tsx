
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
import { ArrowLeft, Edit, Mail, Phone, DollarSign, Calendar, Hash } from 'lucide-react';
import { clients, appointments, services } from '@/lib/data';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = clients.find((c) => c.id === params.id);

  if (!client) {
    notFound();
  }

  const clientAppointments = appointments.filter(apt => apt.clientId === client.id);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Client Details" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                <Link href="/clients">
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back</span>
                </Link>
            </Button>
            <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
                {client.name}
            </h1>
            <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                </Button>
            </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-1">
                <Card>
                    <CardHeader className="flex flex-col items-center text-center p-4">
                        <Avatar className="w-24 h-24 mb-4">
                            <AvatarImage src={client.avatarUrl} alt={client.name} />
                            <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        <CardTitle>{client.name}</CardTitle>
                        <CardDescription>Loyal Client</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2 p-4 pt-0">
                        <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <span>{client.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span>{client.phone}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div className="md:col-span-2 space-y-6">
                <Card>
                    <CardHeader className="p-4 pb-0">
                        <CardTitle>Client Stats</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
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
        </div>
        
        <Tabs defaultValue="history">
            <TabsList className='grid w-full grid-cols-2'>
                <TabsTrigger value="history">Appointment History</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="history">
                <Card>
                    <CardContent className="pt-6">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead className='hidden sm:table-cell'>Service</TableHead>
                                    <TableHead className='hidden sm:table-cell'>Status</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {clientAppointments.map(apt => {
                                    const service = services.find(s => s.id === apt.serviceId);
                                    return (
                                        <TableRow key={apt.id}>
                                            <TableCell>
                                                <div className='font-medium'>{format(apt.startTime, 'PP')}</div>
                                                <div className='text-muted-foreground sm:hidden'>{service?.name}</div>
                                            </TableCell>
                                            <TableCell className='hidden sm:table-cell'>{service?.name || 'N/A'}</TableCell>
                                            <TableCell className='hidden sm:table-cell'>{apt.status}</TableCell>
                                            <TableCell className="text-right">${service?.price.toFixed(2) || '0.00'}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="notes">
                <Card>
                    <CardHeader>
                        <CardTitle>Client Notes</CardTitle>
                        <CardDescription>Color formulas, preferences, and personal notes.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <Textarea placeholder="Add a new note..." defaultValue={client.notes || "Redken Shades EQ 1oz 9NB, 1oz 9G. Process for 20 minutes."}/>
                         <Button>Save Note</Button>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>

      </main>
    </div>
  );
}
