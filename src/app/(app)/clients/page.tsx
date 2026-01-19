

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Search, FileDown, UserPlus, Merge, Users, ShieldPlus, AlertTriangle, Ear, ShieldAlert, BadgeInfo, Ban, FileText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { appointments as initialAppointments, type Client, type Appointment } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { MergeClientsDialog } from '@/components/clients/MergeClientsDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { ClientOnly } from '@/components/shared/ClientOnly';


const ClientCard = ({ client, isSelected, onSelect }: { client: Client, isSelected: boolean, onSelect: () => void }) => {
    const { clients } = useInventory();
    const lastAppointment = useMemo(() => {
        if (!client.lastAppointment) return null;
        return new Date(client.lastAppointment);
    }, [client.lastAppointment]);

    return (
        <Card className={cn(
            "transition-all duration-200 hover:shadow-lg hover:-translate-y-1",
            isSelected && "border-primary ring-2 ring-primary"
        )}>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="flex items-center pt-1">
                        <Checkbox
                            id={`select-${client.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            aria-label={`Select ${client.name}`}
                        />
                    </div>
                     <Avatar className="w-16 h-16 border">
                        <AvatarImage src={client.avatarUrl} alt={client.name} data-ai-hint="person portrait" />
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <Link href={`/clients/${client.id}`} className="group">
                            <p className="font-semibold text-lg group-hover:underline truncate">{client.name}</p>
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
                            <DropdownMenuItem asChild>
                                <Link href={`/clients/${client.id}/report`}><FileText className="mr-2 h-4 w-4"/>Generate Report</Link>
                            </DropdownMenuItem>
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
                        {!!client.activeMembershipId && <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">Member</Badge>}
                        <Badge variant="secondary">VIP</Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
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
  const { clients, setClients, appointments } = useInventory();
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isMergeClientsOpen, setIsMergeClientsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastSeenFilter, setLastSeenFilter] = useState('all');
  const { toast } = useToast();
  
  const [showArchived, setShowArchived] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
  const handleAddClient = (data: ClientFormData) => {
    const { referringClientId } = data;
    
    const newClient: Client = {
      id: `cli-${nanoid()}`,
      name: data.name,
      email: data.email || '',
      phone: data.phone || '',
      avatarUrl: data.avatarUrl || '',
      lifetimeValue: 0,
      lastAppointment: new Date().toISOString(),
      status: 'active',
      notes: data.notes,
      birthday: data.birthday ? data.birthday.toISOString() : undefined,
      address: data.address,
      emergencyContact: data.emergencyContact,
      medicalNotes: [
          ...(data.intel?.medical?.flags || []),
          data.intel?.medical?.notes || ''
      ].filter(Boolean).join(', '),
      allergyNotes: [
          ...(data.intel?.allergies?.flags || []),
          data.intel?.allergies?.notes || ''
      ].filter(Boolean).join(', '),
      sensoryNeeds: [
          ...(data.intel?.sensory?.flags || []),
          data.intel?.sensory?.notes || ''
      ].filter(Boolean).join(', '),
      intel: {
        referralSource: data.intel?.referralSource
      }
    };
    
    setClients(prevClients => {
        let updatedClients = [...prevClients];
        
        if (referringClientId) {
            const referrerIndex = updatedClients.findIndex(c => c.id === referringClientId);
            if (referrerIndex !== -1) {
                const referrer = { ...updatedClients[referrerIndex] };
                
                // Set who referred the new client
                newClient.referredBy = referrer.name;

                // Update the referrer's profile
                referrer.successfulReferrals = [...(referrer.successfulReferrals || []), newClient.name];
                
                updatedClients[referrerIndex] = referrer;
            }
        }
        
        // Add the new client
        updatedClients.push(newClient);
        
        return updatedClients;
    });

    toast({
      title: "Client Added",
      description: `${newClient.name} has been added to your client list.`,
    })
  }

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(itemId)) {
            newSelection.delete(itemId);
        } else {
            newSelection.add(itemId);
        }
        return newSelection;
    });
  }, []);

  const handleBulkDeleteClick = () => {
    setIsBulkDeleteConfirmOpen(true);
  };
  
  const handleBulkArchive = useCallback(() => {
    setClients(prev =>
        prev.map(item =>
            selectedItems.has(item.id) ? { ...item, status: 'archived' } : item
        )
    );
    toast({ title: `${selectedItems.size} client(s) have been archived.` });
    setSelectedItems(new Set());
  }, [selectedItems, setClients, toast]);

  const handleBulkUnarchive = useCallback(() => {
      setClients(prev =>
          prev.map(item =>
              selectedItems.has(item.id) ? { ...item, status: 'active' } : item
          )
      );
      toast({ title: `${selectedItems.size} client(s) have been restored.` });
      setSelectedItems(new Set());
  }, [selectedItems, setClients, toast]);

  const handleBulkDeleteConfirm = useCallback(() => {
    const itemCount = selectedItems.size;
    setClients(prev => prev.filter(item => !selectedItems.has(item.id)));
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Clients Deleted",
        description: `${itemCount} client(s) have been removed.`,
    })
  }, [selectedItems, setClients, toast]);
  
  const filteredClients = useMemo(() => {
    let clientsToFilter = clients.filter(client => {
      return showArchived ? client.status === 'archived' : client.status !== 'archived';
    });
    
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
  }, [clients, searchTerm, lastSeenFilter, showArchived]);
  
  const totalPages = Math.ceil(filteredClients.length / ITEMS_PER_PAGE);
  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredClients.slice(startIndex, endIndex);
  }, [filteredClients, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

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
                (initialAppointments as Appointment[]).filter(a => a.clientId === id).forEach(a => appointmentsToReassign.push(a.id));
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

  const handleExport = () => {
    const headers = ['Name', 'Email', 'Phone', 'Lifetime Value', 'Last Seen'];
    const clientData = filteredClients.map(client => [
      client.name,
      client.email,
      client.phone,
      client.lifetimeValue.toString(),
      format(new Date(client.lastAppointment), 'yyyy-MM-dd')
    ]);

    const csvContent = [
      headers.join(','),
      ...clientData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.href) {
      URL.revokeObjectURL(link.href);
    }
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', `clients_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const ClientStatsSidebar = () => {
    const stats = useMemo(() => {
        const totalClients = filteredClients.length;
        if (totalClients === 0) {
            return {
                totalActiveClients: 0,
                retentionRate: 0,
                avgSpend: 0,
                serviceRevenue: 0,
                retailRevenue: 0,
                tipRevenue: 0,
            };
        }

        const clientsWithMultipleAppointments = filteredClients.filter(c => {
            return (appointments || []).filter(apt => apt.clientId === c.id && apt.status === 'completed').length > 1;
        }).length;

        const allCompletedAppointments = filteredClients.flatMap(c => 
            (appointments || []).filter(apt => apt.clientId === c.id && apt.status === 'completed')
        );

        const totalRevenue = filteredClients.reduce((acc, c) => acc + c.lifetimeValue, 0);

        return {
            totalActiveClients: totalClients,
            retentionRate: (clientsWithMultipleAppointments / totalClients) * 100,
            avgSpend: allCompletedAppointments.length > 0 ? totalRevenue / allCompletedAppointments.length : 0,
            serviceRevenue: totalRevenue * 0.8, // Mock data
            retailRevenue: totalRevenue * 0.15, // Mock data
            tipRevenue: totalRevenue * 0.05, // Mock data
        };
    }, [filteredClients, appointments]);

    return (
        <Card className="lg:sticky top-24">
            <CardHeader>
                <CardTitle>Client Stats</CardTitle>
                <CardDescription>Metrics for the current client view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Total Active Clients</div>
                    <div className="text-2xl font-bold">{stats.totalActiveClients}</div>
                </div>
                 <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Client Retention Rate</div>
                    <div className="text-2xl font-bold">{stats.retentionRate.toFixed(0)}%</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Avg. Spend / Appointment</div>
                    <div className="text-2xl font-bold">${stats.avgSpend.toFixed(2)}</div>
                </div>
                <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Revenue Breakdown</h4>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span>Services:</span> <span className="font-mono">${stats.serviceRevenue.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Retail:</span> <span className="font-mono">${stats.retailRevenue.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Tips:</span> <span className="font-mono">${stats.tipRevenue.toFixed(2)}</span></div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
  };

  return (
    <ClientOnly>
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Client Log" />
        <main className="flex-1 p-4 md:p-8">
          <div className="grid lg:grid-cols-[1fr,300px] gap-8 items-start">
              <div className="space-y-6">
                  <div>
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
                                          <DropdownMenuItem asChild>
                                              <Link href="/clients/report"><FileText className="mr-2 h-4 w-4"/>View Full Report</Link>
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => setIsMergeClientsOpen(true)}><Merge className="mr-2 h-4 w-4"/>Merge Duplicates</DropdownMenuItem>
                                          <DropdownMenuItem onClick={handleExport}><FileDown className="mr-2 h-4 w-4"/>Export List</DropdownMenuItem>
                                      </DropdownMenuContent>
                                  </DropdownMenu>
                                  <Button className='w-full sm:w-auto' onClick={() => setIsAddClientOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> New Client</Button>
                              </div>
                          </div>
                          <div className="flex items-center space-x-2 pt-4">
                              <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                              <Label htmlFor="show-archived">{showArchived ? "Viewing Archived" : "Show Archived"}</Label>
                          </div>
                      </CardHeader>
                      <CardContent>
                          {selectedItems.size > 0 && (
                              <div className="mb-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                                  <p className="text-sm font-medium">{selectedItems.size} client(s) selected</p>
                                  <div className="flex gap-2">
                                      {showArchived ? (
                                          <Button variant="outline" size="sm" onClick={handleBulkUnarchive}>Unarchive</Button>
                                      ) : (
                                          <Button variant="outline" size="sm" onClick={handleBulkArchive}>Archive</Button>
                                      )}
                                      <Button variant="destructive" size="sm" onClick={handleBulkDeleteClick}>Delete</Button>
                                  </div>
                              </div>
                          )}
                          {!hasClients ? (
                              <EmptyState onAddClient={() => setIsAddClientOpen(true)} />
                          ) : !hasFilteredClients ? (
                              <div className="text-center py-20 px-6">
                                  <p className="text-muted-foreground">No clients found matching your filters.</p>
                              </div>
                          ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
                                  {paginatedClients.map((client) => (
                                      <ClientCard 
                                          key={client.id} 
                                          client={client}
                                          isSelected={selectedItems.has(client.id)}
                                          onSelect={() => handleItemSelect(client.id)}
                                      />
                                  ))}
                              </div>
                          )}
                      </CardContent>
                      {totalPages > 1 && (
                          <CardFooter>
                              <div className="flex items-center justify-between w-full">
                                  <span className="text-sm text-muted-foreground">
                                      Page {currentPage} of {totalPages}
                                  </span>
                                  <div className="flex items-center gap-2">
                                      <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={handlePrevPage}
                                          disabled={currentPage === 1}
                                      >
                                          Previous
                                      </Button>
                                      <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={handleNextPage}
                                          disabled={currentPage === totalPages}
                                      >
                                          Next
                                      </Button>
                                  </div>
                              </div>
                          </CardFooter>
                      )}
                  </Card>
              </div>
              <div className="hidden lg:block">
                  <ClientStatsSidebar />
              </div>
          </div>

        </main>

        <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients} onSave={handleAddClient} />
        <MergeClientsDialog 
          open={isMergeClientsOpen} 
          onOpenChange={setIsMergeClientsOpen} 
          allClients={clients} 
          allAppointments={initialAppointments}
          onMerge={handleMergeConfirm}
        />
        
        <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                          This will permanently delete {selectedItems.size} client(s) and all their associated data. This action cannot be undone.
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleBulkDeleteConfirm} className={buttonVariants({ variant: "destructive" })}>
                          Delete
                      </AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>

      </div>
    </ClientOnly>
  );
}
