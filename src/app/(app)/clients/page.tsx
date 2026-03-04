'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
import { MoreHorizontal, PlusCircle, Search, FileDown, UserPlus, Merge, Users, ShieldPlus, AlertTriangle, Ear, ShieldAlert, BadgeInfo, Ban, FileText, Package, Loader, Wallet } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Client, type Appointment } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { MergeClientsDialog } from '@/components/clients/MergeClientsDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { type Transaction } from '@/lib/financial-data';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { ClientCard } from '@/components/clients/ClientCard';


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
  const { firestore, user } = useFirebase();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const router = useRouter();
  const tenantId = selectedTenant?.id;

  const { clients, appointments, transactions } = useInventory();

  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isMergeClientsOpen, setIsMergeClientsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastSeenFilter, setLastSeenFilter] = useState('all');
  const [owesBalanceOnly, setOwesBalanceOnly] = useState(false);
  const { toast } = useToast();
  
  const [showArchived, setShowArchived] = useState(false);
  const [showBanned, setShowBanned] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
    useEffect(() => {
        if (!isTenantLoading && role === 'staff') {
            router.replace('/dashboard');
        }
    }, [role, isTenantLoading, router]);

  const handleAddClient = (data: ClientFormData) => {
    if (!firestore || !tenantId) return;

    const { referringClientId, ...clientData } = data;
    const firstName = data.name.split(' ')[0].toUpperCase();
    const referralCode = `${firstName}${nanoid(4)}`;

    const newClient: Omit<Client, 'id'> = {
      name: data.name,
      email: data.email || '',
      phone: data.phone || '',
      avatarUrl: data.avatarUrl || '',
      lifetimeValue: 0,
      lastAppointment: new Date().toISOString(),
      status: 'active',
      notes: data.notes,
      referralCode: referralCode,
      birthday: data.birthday ? data.birthday.toISOString() : undefined,
      address: data.address,
      emergencyContact: data.emergencyContact,
      intel: {
        referralSource: data.intel?.referralSource
      }
    };
    
    const clientsCollection = collection(firestore, `tenants/${tenantId}/clients`);
    const sanitizedData = JSON.parse(JSON.stringify(newClient));
    addDocumentNonBlocking(clientsCollection, sanitizedData);

    if (referringClientId && clients) {
        const referrer = clients.find(c => c.id === referringClientId);
        if (referrer) {
            const referrerDocRef = doc(firestore, `tenants/${tenantId}/clients/${referringClientId}`);
            const updatedReferrals = [...(referrer.successfulReferrals || []), newClient.name];
            updateDocumentNonBlocking(referrerDocRef, { successfulReferrals: updatedReferrals });
        }
    }

    toast({
      title: "Client Added",
      description: `${data.name} has been added to your client list.`,
    });
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
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => {
      const clientDoc = doc(firestore, `tenants/${tenantId}/clients`, id);
      updateDocumentNonBlocking(clientDoc, { status: 'archived' });
    });
    toast({ title: `${selectedItems.size} client(s) have been archived.` });
    setSelectedItems(new Set());
  }, [selectedItems, toast, firestore, tenantId]);

  const handleBulkUnarchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => {
      const clientDoc = doc(firestore, `tenants/${tenantId}/clients`, id);
      updateDocumentNonBlocking(clientDoc, { status: 'active' });
    });
    toast({ title: `${selectedItems.size} client(s) have been restored.` });
    setSelectedItems(new Set());
  }, [selectedItems, toast, firestore, tenantId]);

  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    selectedItems.forEach(id => {
      const clientDoc = doc(firestore, `tenants/${tenantId}/clients`, id);
      deleteDocumentNonBlocking(clientDoc);
    });
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Clients Deleted",
        description: `${itemCount} client(s) have been removed.`,
    })
  }, [selectedItems, toast, firestore, tenantId]);
  
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    let clientsToFilter = clients.filter(client => {
      if (showBanned) return client.status === 'banned';
      return showArchived ? client.status === 'archived' : client.status === 'active';
    });
    
    if (owesBalanceOnly) {
        clientsToFilter = clientsToFilter.filter(c => (c.outstandingBalance || 0) > 0);
    }

    if (lastSeenFilter !== 'all') {
      const days = parseInt(lastSeenFilter);
      const cutoffDate = subDays(new Date(), days);
      clientsToFilter = clientsToFilter.filter(client => new Date(client.lastAppointment) < cutoffDate);
    }
    
    if (searchTerm) {
        const lowercasedSearchTerm = searchTerm.toLowerCase();
        const isFourDigitNumber = /^\d{4}$/.test(searchTerm);

        clientsToFilter = clientsToFilter.filter(client => {
            const nameMatch = client.name.toLowerCase().includes(lowercasedSearchTerm);
            const emailMatch = client.email && client.email.toLowerCase().includes(lowercasedSearchTerm);
            
            let phoneMatch = false;
            if (isFourDigitNumber && client.phone) {
                const numericPhone = client.phone.replace(/\D/g, '');
                phoneMatch = numericPhone.endsWith(searchTerm);
            }

            return nameMatch || emailMatch || phoneMatch;
        });
    }

    return clientsToFilter.sort((a,b) => new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime());
  }, [clients, searchTerm, lastSeenFilter, showArchived, showBanned, owesBalanceOnly]);
  
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

  const hasClients = clients && clients.length > 0;
  const hasFilteredClients = filteredClients.length > 0;

  const handleMergeConfirm = (primaryClientId: string, clientIdsToDelete: string[]) => {
    // Firestore logic needed here
  };

  const handleExport = () => {
    const headers = ['Name', 'Email', 'Phone', 'Lifetime Value', 'Last Seen', 'Outstanding Balance'];
    const clientData = filteredClients.map(client => [
      client.name,
      client.email,
      client.phone,
      (client.lifetimeValue || 0).toString(),
      format(new Date(client.lastAppointment), 'yyyy-MM-dd'),
      (client.outstandingBalance || 0).toFixed(2)
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
        if (totalClients === 0 || !appointments || !transactions) {
            return {
                totalActiveClients: 0,
                retentionRate: 0,
                avgSpend: 0,
                serviceRevenue: 0,
                retailRevenue: 0,
                tipRevenue: 0,
                totalPendingDebt: 0,
            };
        }

        const filteredClientIds = new Set(filteredClients.map(c => c.id));
        const relevantTransactions = transactions.filter(t => t.clientId && filteredClientIds.has(t.clientId));
        
        const clientsWithMultipleAppointments = filteredClients.filter(c => {
            return (appointments || []).filter(apt => apt.clientId === c.id && apt.status === 'completed').length > 1;
        }).length;

        const allCompletedAppointments = filteredClients.flatMap(c => 
            (appointments || []).filter(apt => apt.clientId === c.id && apt.status === 'completed')
        );

        const totalRevenue = filteredClients.reduce((acc, c) => acc + (c.lifetimeValue || 0), 0);
        const totalPendingDebt = filteredClients.reduce((acc, c) => acc + (c.outstandingBalance || 0), 0);

        const serviceRevenue = relevantTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailRevenue = relevantTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const tipRevenue = relevantTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);

        return {
            totalActiveClients: totalClients,
            retentionRate: totalClients > 0 ? (clientsWithMultipleAppointments / totalClients) * 100 : 0,
            avgSpend: allCompletedAppointments.length > 0 ? totalRevenue / allCompletedAppointments.length : 0,
            serviceRevenue,
            retailRevenue,
            tipRevenue,
            totalPendingDebt,
        };
    }, [filteredClients, appointments, transactions]);

    return (
        <Card className="lg:sticky top-24">
            <CardHeader>
                <CardTitle>Client Stats</CardTitle>
                <CardDescription>Metrics for the current client view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground">Total Displayed Clients</div>
                    <div className="text-2xl font-bold">{stats.totalActiveClients}</div>
                </div>
                 <div className="p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                    <div className="text-sm font-bold flex items-center gap-2 uppercase tracking-tighter"><Wallet className="w-4 h-4"/> Outstanding Balances</div>
                    <div className="text-2xl font-black">${stats.totalPendingDebt.toFixed(2)}</div>
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
  
    if (isTenantLoading || role === 'staff') {
        return (
            <div className="flex min-h-screen w-full flex-col">
                <AppHeader title="Client Log" />
                <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
                    <Loader className="w-8 h-8 animate-spin" />
                </main>
            </div>
        );
    }


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Client Log" />
      <ClientOnly>
        <main className="flex-1 p-4 md:p-8">
          <div className="grid lg:grid-cols-[1fr,300px] gap-8 items-start">
              <div className="space-y-6">
                  <Card>
                      <CardHeader className="space-y-6">
                          {/* Row 1: Search & Filter */}
                          <div className="flex flex-col md:flex-row items-center gap-4">
                              <div className="relative w-full sm:max-w-xs">
                                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input 
                                      placeholder="Search by name, email, or last 4 of phone..." 
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
                          </div>

                          {/* Row 2: Actions */}
                          <div className="flex flex-wrap items-center gap-2">
                              <Button variant="outline" size="sm" className='flex-1 sm:flex-none' onClick={() => setIsMergeClientsOpen(true)}>
                                  <Merge className="mr-2 h-4 w-4"/>Merge Duplicates
                              </Button>
                              <Button variant="outline" size="sm" className='flex-1 sm:flex-none' onClick={handleExport}>
                                  <FileDown className="mr-2 h-4 w-4"/>Export List
                              </Button>
                              <Button size="sm" className='w-full sm:w-auto ml-auto' onClick={() => setIsAddClientOpen(true)}>
                                  <UserPlus className="mr-2 h-4 w-4" /> New Client
                              </Button>
                          </div>

                          <Separator />

                          {/* Row 3: Reorganized Toggles */}
                          <div className="p-4 bg-muted/30 rounded-xl border-2 border-dashed border-border/50 flex flex-wrap items-center gap-x-8 gap-y-4">
                              <div className="flex items-center space-x-3">
                                  <Switch id="show-archived" checked={showArchived} onCheckedChange={(val) => { setShowArchived(val); if(val) setShowBanned(false); }} />
                                  <Label htmlFor="show-archived" className="text-xs font-bold uppercase tracking-tight cursor-pointer">Archived</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                  <Switch id="show-banned" checked={showBanned} onCheckedChange={(val) => { setShowBanned(val); if(val) setShowArchived(false); }} />
                                  <Label htmlFor="show-banned" className="text-xs font-bold uppercase tracking-tight text-destructive cursor-pointer">Banned</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                  <Switch id="owes-balance" checked={owesBalanceOnly} onCheckedChange={setOwesBalanceOnly} />
                                  <Label htmlFor="owes-balance" className="flex items-center gap-2 text-xs font-bold uppercase tracking-tight cursor-pointer">
                                      <Wallet className="w-3.5 h-3.5 text-destructive" /> 
                                      Debt Only
                                  </Label>
                              </div>
                          </div>
                      </CardHeader>
                      <CardContent>
                          {selectedItems.size > 0 && (
                              <div className="mb-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                                  <p className="text-sm font-medium">{selectedItems.size} client(s) selected</p>
                                  <div className="flex gap-2">
                                      {showArchived || showBanned ? (
                                          <Button variant="outline" size="sm" onClick={handleBulkUnarchive}>Restore Access</Button>
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

        <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={handleAddClient} />
        <MergeClientsDialog 
          open={isMergeClientsOpen} 
          onOpenChange={setIsMergeClientsOpen} 
          allClients={clients || []} 
          allAppointments={appointments || []}
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
      </ClientOnly>
    </div>
  );
}
