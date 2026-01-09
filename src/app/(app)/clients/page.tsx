
'use client';

import React, { useState, useMemo } from 'react';
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
import { MoreHorizontal, PlusCircle, Search, FileDown, UserPlus, Merge, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { clients, appointments } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { MergeClientsDialog } from '@/components/clients/MergeClientsDialog';

const ClientCard = ({ client }: { client: any }) => {
    return (
        <Card>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                     <Avatar className="w-16 h-16 border">
                        <AvatarImage src={client.avatarUrl} alt={client.name} data-ai-hint="person portrait" />
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                        <Link href={`/clients/${client.id}`} className="group">
                            <p className="font-semibold text-lg group-hover:underline">{client.name}</p>
                        </Link>
                        <p className="text-sm text-muted-foreground">Last seen: {formatDistanceToNow(new Date(client.lastAppointment), { addSuffix: true })}</p>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="-mt-1 h-8 w-8 flex-shrink-0">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                             <DropdownMenuItem asChild>
                                <Link href={`/clients/${client.id}`}>View Details</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem>Book Appointment</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                 <div className="flex items-center justify-between text-sm">
                    <span className='text-muted-foreground'>Lifetime Value</span>
                    <Badge variant="outline" className="font-mono text-base">${client.lifetimeValue.toFixed(2)}</Badge>
                </div>
            </CardContent>
        </Card>
    )
}

const EmptyState = ({ onAddClient }: { onAddClient: () => void }) => (
    <div className="text-center py-20 px-6">
        <div className='flex justify-center mb-6'>
            <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
                <Users className='w-10 h-10 text-muted-foreground' />
            </div>
        </div>
        <h3 className="text-2xl font-semibold">Start Building Your Client List</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-6">
            Your client log is where you'll manage your entire rolodex. Add your first client to get started.
        </p>
        <Button onClick={onAddClient}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add New Client
        </Button>
    </div>
);


export default function ClientsPage() {
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isMergeClientsOpen, setIsMergeClientsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredClients = useMemo(() => {
    return clients
      .filter(client => 
        client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.email.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a,b) => new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime());
  }, [searchTerm]);
  
  const hasClients = clients.length > 0;
  const hasFilteredClients = filteredClients.length > 0;

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Clients" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div>
            <h1 className="text-3xl font-bold">Client Log</h1>
            <p className="text-muted-foreground">A scannable rolodex of your entire client base.</p>
        </div>

        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative w-full sm:max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Search by name or email..." 
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                         />
                    </div>
                    <div className="ml-auto flex w-full flex-col sm:flex-row sm:w-auto items-center gap-2">
                        <Button variant="outline" className='w-full sm:w-auto'><FileDown className="mr-2 h-4 w-4" /> Export</Button>
                        <Button variant="outline" className='w-full sm:w-auto' onClick={() => setIsMergeClientsOpen(true)}><Merge className="mr-2 h-4 w-4" /> Merge</Button>
                        <Button className='w-full sm:w-auto' onClick={() => setIsAddClientOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> New Client</Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                 {!hasClients ? (
                    <EmptyState onAddClient={() => setIsAddClientOpen(true)} />
                 ) : !hasFilteredClients ? (
                    <div className="text-center py-20 px-6">
                        <p className="text-muted-foreground">No clients found for &quot;{searchTerm}&quot;.</p>
                    </div>
                 ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredClients.map((client) => (
                            <ClientCard key={client.id} client={client} />
                        ))}
                    </div>
                 )}
            </CardContent>
        </Card>

      </main>

      <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients} />
      <MergeClientsDialog open={isMergeClientsOpen} onOpenChange={setIsMergeClientsOpen} allClients={clients} allAppointments={appointments} />

    </div>
  );
}
