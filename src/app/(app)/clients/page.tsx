
'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { MoreHorizontal, PlusCircle, Search, FileDown, UserPlus, Merge, Users, ShieldPlus, AlertTriangle, Ear, ShieldAlert, BadgeInfo, Ban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { appointments, type Client } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, subDays } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { MergeClientsDialog } from '@/components/clients/MergeClientsDialog';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useInventory } from '@/context/InventoryContext';


const ClientCard = ({ client }: { client: Client }) => {
    const { clients } = useInventory();
    const lastAppointment = useMemo(() => {
        if (!client.lastAppointment) return null;
        return new Date(client.lastAppointment);
    }, [client.lastAppointment]);

    return (
      <ClientOnly>
        <Card className="transition-all hover:shadow-lg hover:-translate-y-1">
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
                        {lastAppointment && (
                            <p className="text-sm text-muted-foreground">Last seen: {formatDistanceToNow(lastAppointment, { addSuffix: true })}</p>
                        )}
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
                                <Link href={`/clients/${client.id}`}>View/Edit Details</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem>Book Appointment</DropdownMenuItem>
                            <DropdownMenuItem>Generate Report</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <span className='text-muted-foreground'>Lifetime Value</span>
                    <Badge variant="outline" className="font-mono text-base">${client.lifetimeValue.toFixed(2)}</Badge>
                </div>
                <div className="flex items-center gap-2 border-t pt-3">
                    <TooltipProvider>
                         {client.medicalNotes && (
                            <Tooltip>
                                <TooltipTrigger><ShieldPlus className="w-5 h-5 text-red-500" /></TooltipTrigger>
                                <TooltipContent><p>Medical Alert</p></TooltipContent>
                            </Tooltip>
                         )}
                         {client.allergyNotes && (
                             <Tooltip>
                                <TooltipTrigger><AlertTriangle className="w-5 h-5 text-orange-500" /></TooltipTrigger>
                                <TooltipContent><p>Allergy Alert</p></TooltipContent>
                            </Tooltip>
                         )}
                          {client.sensoryNeeds && (
                             <Tooltip>
                                <TooltipTrigger><Ear className="w-5 h-5 text-blue-500" /></TooltipTrigger>
                                <TooltipContent><p>Sensory Needs</p></TooltipContent>
                            </Tooltip>
                         )}
                         {/* Placeholder for future features */}
                         {/* <Tooltip>
                            <TooltipTrigger><ShieldAlert className="w-5 h-5 text-purple-500" /></TooltipTrigger>
                            <TooltipContent><p>Incident History</p></TooltipContent>
                         </Tooltip>
                         <Tooltip>
                            <TooltipTrigger><Ban className="w-5 h-5 text-destructive" /></TooltipTrigger>
                            <TooltipContent><p>Banned Client</p></TooltipContent>
                         </Tooltip> */}
                    </TooltipProvider>

                    <div className="flex-1 flex flex-wrap gap-1 justify-end">
                        {client.isMember && <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">Member</Badge>}
                        <Badge variant="secondary">VIP</Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
        </ClientOnly>
    )
}

const EmptyState = ({ onAddClient }: { onAddClient: () => void }) => (
    <div className="text-center py-20 px-6 col-span-full border-2 border-dashed rounded-lg">
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
  const { clients, setClients } = useInventory();
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isMergeClientsOpen, setIsMergeClientsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastSeenFilter, setLastSeenFilter] = useState('all');
  
  const filteredClients = useMemo(() => {
    let clientsToFilter = clients;
    
    if (lastSeenFilter !== 'all') {
      const days = parseInt(lastSeenFilter);
      const cutoffDate = subDays(new Date(), days);
      clientsToFilter = clientsToFilter.filter(client => new Date(client.lastAppointment) < cutoffDate);
    }
    
    if (searchTerm) {
        clientsToFilter = clientsToFilter.filter(client => 
            client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            client.email.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    return clientsToFilter.sort((a,b) => new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime());
  }, [clients, searchTerm, lastSeenFilter]);
  
  const hasClients = clients.length > 0;
  const hasFilteredClients = filteredClients.length > 0;

  const handleMergeConfirm = (primaryClientId: string, clientIdsToDelete: string[]) => {
    setClients(prevClients => {
        // Find the primary client
        const primaryClient = prevClients.find(c => c.id === primaryClientId);
        if (!primaryClient) return prevClients;

        // Collect all data to be merged
        let appointmentsToReassign: string[] = [];
        let mergedNotes = primaryClient.notes ? [primaryClient.notes] : [];
        let mergedFormulas = primaryClient.customFormulas || [];

        clientIdsToDelete.forEach(id => {
            const clientToDelete = prevClients.find(c => c.id === id);
            if (clientToDelete) {
                // Collect appointment IDs
                appointments.filter(a => a.clientId === id).forEach(a => appointmentsToReassign.push(a.id));
                // Merge notes
                if (clientToDelete.notes) mergedNotes.push(`Merged note from ${clientToDelete.name}: ${clientToDelete.notes}`);
                // Merge formulas (simple concat, could be smarter)
                if (clientToDelete.customFormulas) mergedFormulas = [...mergedFormulas, ...clientToDelete.customFormulas];
            }
        });
        
        // This is a mock update. In a real app, this would be a Firestore transaction
        // Re-assigning appointments isn't done here because `appointments` is a separate mock data source
        // but the principle is shown.
        console.log("Reassigning appointments:", appointmentsToReassign, "to client", primaryClientId);

        // Update the primary client
        const updatedPrimaryClient = {
            ...primaryClient,
            notes: mergedNotes.join('\n\n'),
            customFormulas: mergedFormulas
        };

        // Filter out deleted clients and update the primary one
        return prevClients
            .filter(c => !clientIdsToDelete.includes(c.id))
            .map(c => c.id === primaryClientId ? updatedPrimaryClient : c);
    });
  };

  const ClientStatsSidebar = () => {
    return (
        <Card className="lg:sticky top-24">
            <CardHeader>
                <CardTitle>Client Stats</CardTitle>
                <CardDescription>Metrics for the current client view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Total Active Clients</div>
                    <div className="text-2xl font-bold">{clients.length}</div>
                </div>
                 <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Client Retention Rate</div>
                    <div className="text-2xl font-bold">87%</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Avg. Spend / Appointment</div>
                    <div className="text-2xl font-bold">$125.50</div>
                </div>
                <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Revenue Breakdown</h4>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span>Services:</span> <span className="font-mono">$12,345.00</span></div>
                        <div className="flex justify-between"><span>Retail:</span> <span className="font-mono">$2,876.50</span></div>
                        <div className="flex justify-between"><span>Tips:</span> <span className="font-mono">$1,102.00</span></div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Client Log" />
      <main className="flex-1 p-4 md:p-8">
        <div className="grid lg:grid-cols-[1fr,300px] gap-8 items-start">
            <div className="space-y-6">
                 <div>
                    <h1 className="text-3xl font-bold">Client Rolodex</h1>
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
                             <div className="flex-1 w-full sm:w-auto">
                                <select
                                    value={lastSeenFilter}
                                    onChange={(e) => setLastSeenFilter(e.target.value)}
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                >
                                    <option value="all">Filter by last seen...</option>
                                    <option value="30">Over 30 days ago</option>
                                    <option value="90">Over 90 days ago</option>
                                    <option value="180">Over 180 days ago</option>
                                </select>
                            </div>
                            <div className="ml-auto flex w-full flex-col sm:flex-row sm:w-auto items-center gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className='w-full sm:w-auto'>
                                            <MoreHorizontal className="mr-2 h-4 w-4" /> More
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onClick={() => setIsMergeClientsOpen(true)}><Merge className="mr-2 h-4 w-4"/>Merge Duplicates</DropdownMenuItem>
                                        <DropdownMenuItem><FileDown className="mr-2 h-4 w-4"/>Export List</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Button className='w-full sm:w-auto' onClick={() => setIsAddClientOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> New Client</Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {!hasClients ? (
                            <EmptyState onAddClient={() => setIsAddClientOpen(true)} />
                        ) : !hasFilteredClients ? (
                            <div className="text-center py-20 px-6">
                                <p className="text-muted-foreground">No clients found matching your filters.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {filteredClients.map((client) => (
                                    <ClientCard key={client.id} client={client} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            <div className="hidden lg:block">
                <ClientStatsSidebar />
            </div>
        </div>

      </main>

      <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients} />
      <MergeClientsDialog 
        open={isMergeClientsOpen} 
        onOpenChange={setIsMergeClientsOpen} 
        allClients={clients} 
        allAppointments={appointments}
        onMerge={handleMergeConfirm}
      />

    </div>
  );
}
