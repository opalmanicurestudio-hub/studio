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
import { Button, buttonVariants } from '@/components/ui/button';
import { 
  MoreHorizontal, 
  PlusCircle, 
  Search, 
  FileDown, 
  UserPlus, 
  Merge, 
  Users, 
  ShieldPlus, 
  AlertTriangle, 
  Ear, 
  ShieldAlert, 
  BadgeInfo, 
  Ban, 
  FileText, 
  Package, 
  Loader, 
  Wallet,
  TrendingUp,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Filter,
  SlidersHorizontal,
  Check,
  RefreshCw,
  Database
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type Client, type Appointment } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { MergeClientsDialog } from '@/components/clients/MergeClientsDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, query, where, getDocs } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { ClientCard } from '@/components/clients/ClientCard';

const EmptyState = ({ onAddClient }: { onAddClient: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Users className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Rolodex is Empty</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
                Start building your client base to unlock automated loyalty tracking and custom formulas.
            </p>
        </div>
        <Button size="lg" onClick={onAddClient} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <UserPlus className="mr-2 h-5 w-5" />
            Add First Guest
        </Button>
    </div>
);

export default function ClientsPage() {
  const { firestore } = useFirebase();
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
  const [isReconciling, setIsReconciling] = useState(false);

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
    const firstName = (data.name || 'GUEST').split(' ')[0].toUpperCase();
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

  const handleBulkReconcile = async () => {
      if (!firestore || !tenantId || !clients || isReconciling) return;
      setIsReconciling(true);
      const batch = writeBatch(firestore);
      
      try {
          // Source of Truth: The full transaction ledger for this tenant
          const txnsRef = collection(firestore, `tenants/${tenantId}/transactions`);
          const txnsSnap = await getDocs(txnsRef);
          
          const incomeByClient: Record<string, number> = {};
          txnsSnap.docs.forEach(d => {
              const data = d.data();
              if (data.clientId) {
                  const amount = Number(data.amount) || 0;
                  // LTV = Sum(Income) - Sum(Reversals) - Sum(Discounts)
                  if (data.type === 'income') {
                      incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) + amount;
                  } else if (data.type === 'reversal') {
                      incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) - amount;
                  } else if (data.type === 'expense' && data.category === 'Discounts') {
                      incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) - amount;
                  }
              }
          });

          clients.forEach(client => {
              const realLtv = Math.max(0, incomeByClient[client.id] || 0);
              // Only update if discrepancy is found to save operations
              if (Math.abs(realLtv - (Number(client.lifetimeValue) || 0)) > 0.01) {
                  batch.update(doc(firestore, `tenants/${tenantId}/clients`, client.id), { lifetimeValue: realLtv });
              }
          });

          await batch.commit();
          toast({ title: "Ledgers Synchronized", description: "All client lifetime values have been verified against the transaction ledger." });
      } catch (e) {
          console.error(e);
          toast({ variant: 'destructive', title: "Sync Failed" });
      } finally {
          setIsReconciling(false);
      }
  };

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
  
  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    const batch = writeBatch(firestore);
    selectedItems.forEach(id => {
      const itemDoc = doc(firestore, `tenants/${tenantId}/clients`, id);
      batch.delete(itemDoc);
    });
    batch.commit();
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Clients Deleted",
        description: `${itemCount} client(s) have been removed.`,
    })
  }, [selectedItems, toast, firestore, tenantId]);
  
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

  const handleMergeClients = async (primaryId: string, secondaryClients: Client[]) => {
    if (!firestore || !tenantId) return;
    
    const batch = writeBatch(firestore);
    const primaryRef = doc(firestore, `tenants/${tenantId}/clients`, primaryId);
    
    let totalLtvGain = 0;
    let totalBalanceGain = 0;

    for (const secondary of secondaryClients) {
        totalLtvGain += Number(secondary.lifetimeValue || 0);
        totalBalanceGain += Number(secondary.outstandingBalance || 0);

        const aptsRef = collection(firestore, `tenants/${tenantId}/appointments`);
        const aptsQuery = query(aptsRef, where("clientId", "==", secondary.id));
        const aptsSnap = await getDocs(aptsQuery);
        
        aptsSnap.forEach(aptDoc => {
            batch.update(aptDoc.ref, { clientId: primaryId });
        });

        const txnsRef = collection(firestore, `tenants/${tenantId}/transactions`);
        const txnsQuery = query(txnsRef, where("clientId", "==", secondary.id));
        const txnsSnap = await getDocs(txnsQuery);
        
        txnsSnap.forEach(txnDoc => {
            batch.update(txnDoc.ref, { clientId: primaryId });
        });

        const secondaryRef = doc(firestore, `tenants/${tenantId}/clients`, secondary.id);
        batch.delete(secondaryRef);
    }

    batch.update(primaryRef, {
        lifetimeValue: increment(totalLtvGain),
        outstandingBalance: increment(totalBalanceGain)
    });

    try {
        await batch.commit();
        toast({
            title: "Merge Complete",
            description: "Dossiers consolidated and history re-attributed."
        });
    } catch (e) {
        console.error("Merge failure", e);
        toast({ variant: 'destructive', title: "Merge Failed", description: "Could not finalize record consolidation." });
    }
  };
  
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    let clientsToFilter = clients.filter(client => {
      if (showBanned) return client.status === 'banned';
      return showArchived ? client.status === 'archived' : client.status === 'active';
    });
    
    if (owesBalanceOnly) {
        clientsToFilter = clientsToFilter.filter(c => Number(c.outstandingBalance || 0) > 0);
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

  const handleExport = () => {
    const headers = ['Name', 'Email', 'Phone', 'Lifetime Value', 'Last Seen', 'Outstanding Balance'];
    const clientData = filteredClients.map(client => [
      client.name,
      client.email,
      client.phone,
      Number(client.lifetimeValue || 0).toString(),
      format(new Date(client.lastAppointment), 'yyyy-MM-dd'),
      Number(client.outstandingBalance || 0).toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...clientData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
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

        const totalRevenue = filteredClients.reduce((acc, c) => acc + (Number(c.lifetimeValue) || 0), 0);
        const totalPendingDebt = filteredClients.reduce((acc, c) => acc + (Number(c.outstandingBalance) || 0), 0);

        const serviceRevenue = relevantTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0);
        const retailRevenue = relevantTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + t.amount, 0);
        const tipRevenue = relevantTransactions.reduce((acc, t) => acc + (Number(t.tipAmount) || 0), 0);

        const completedApts = (appointments || []).filter(a => a.status === 'completed' && filteredClientIds.has(a.clientId));

        return {
            totalActiveClients: totalClients,
            retentionRate: totalClients > 0 ? (clientsWithMultipleAppointments / totalClients) * 100 : 0,
            avgSpend: completedApts.length > 0 ? totalRevenue / completedApts.length : 0,
            serviceRevenue,
            retailRevenue,
            tipRevenue,
            totalPendingDebt,
        };
    }, [filteredClients, appointments, transactions]);

    return (
        <div className="space-y-6 lg:sticky top-24">
            <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-6 opacity-5 transition-opacity group-hover:opacity-10">
                    <Sparkles className="w-24 h-24 text-primary" />
                </div>
                <CardHeader className="p-8 pb-4">
                    <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                        <BadgeInfo className="w-3 h-3" />
                        Intelligence Hub
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8 pt-0 text-left">
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Active Portfolio</p>
                    <p className="text-5xl font-black text-primary tracking-tighter font-mono leading-none">{stats.totalActiveClients}</p>
                    <div className="mt-6 space-y-4">
                        <div className="p-4 rounded-2xl bg-white/50 border border-primary/10 shadow-sm">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Retention</span>
                                <span className="text-sm font-black text-primary">{stats.retentionRate.toFixed(0)}%</span>
                            </div>
                            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${stats.retentionRate}%` }} />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden">
                <CardHeader className="bg-muted/5 border-b p-6">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="w-3 h-3" /> Financial Performance
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6 text-left">
                    <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/10 text-destructive space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Arrears Recovery</p>
                        <p className="text-2xl font-black font-mono tracking-tighter">${stats.totalPendingDebt.toFixed(2)}</p>
                    </div>
                    
                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                            <span>Services</span>
                            <span className="font-mono">${stats.serviceRevenue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                            <span>Retail</span>
                            <span className="font-mono">${stats.retailRevenue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                            <span>Tips</span>
                            <span className="font-mono">${stats.tipRevenue.toFixed(2)}</span>
                        </div>
                        <Separator className="bg-muted/50" />
                        <div className="flex justify-between items-center font-black">
                            <span className="text-[10px] uppercase tracking-widest text-slate-900">Avg. Ticket</span>
                            <span className="text-lg tracking-tighter font-mono text-primary">${stats.avgSpend.toFixed(2)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
  };
  
  if (isTenantLoading || role === 'staff') {
      return (
          <div className="flex min-h-screen w-full flex-col">
              <AppHeader title="Client Log" />
              <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
                  <Loader className="w-8 h-8 animate-spin text-primary" />
              </main>
          </div>
      );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Client Log" />
      <ClientOnly>
        <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">
          <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-10 items-start">
              <div className="lg:col-span-2 xl:col-span-3 space-y-8 min-w-0">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-2 text-left">
                      <div className="space-y-1">
                          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Rolodex</h1>
                          <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Complete guest record database</p>
                      </div>
                      <div className="flex items-center gap-3 w-full md:w-auto">
                          <Button variant="outline" onClick={handleExport} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white/50 backdrop-blur-sm"><FileDown className="mr-2 h-4 w-4" /> Export</Button>
                          <Button onClick={() => setIsAddClientOpen(true)} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20"><UserPlus className="mr-2 h-4 w-4" /> New Guest</Button>
                      </div>
                  </div>

                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                      <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-8 text-left">
                          <div className="flex flex-col md:flex-row items-center gap-4">
                              <div className="relative flex-1 w-full">
                                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                  <Input 
                                      placeholder="SEARCH BY NAME, EMAIL, OR PHONE..." 
                                      className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                                      value={searchTerm}
                                      onChange={(e) => setSearchTerm(e.target.value)}
                                  />
                              </div>
                              <div className="w-full md:w-auto">
                                  <Select value={lastSeenFilter} onValueChange={setLastSeenFilter}>
                                      <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full md:w-48 bg-white shadow-inner">
                                          <SelectValue placeholder="ACTIVITY WINDOW" />
                                      </SelectTrigger>
                                      <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                          <SelectItem value="all" className="font-bold">ALL TIME ACTIVITY</SelectItem>
                                          <SelectItem value="30" className="font-bold">OVER 30 DAYS AGO</SelectItem>
                                          <SelectItem value="90" className="font-bold">OVER 90 DAYS AGO</SelectItem>
                                          <SelectItem value="180" className="font-bold">OVER 180 DAYS AGO</SelectItem>
                                      </SelectContent>
                                  </Select>
                              </div>
                          </div>

                          <div className="p-4 md:p-6 bg-primary/[0.03] rounded-3xl border-2 border-dashed border-primary/20 flex flex-wrap items-center gap-x-6 md:gap-x-10 gap-y-4 md:gap-y-6">
                              <div className="flex items-center gap-3 w-full md:w-auto text-left">
                                  <div className="p-2 bg-primary/10 rounded-xl"><SlidersHorizontal className="w-4 h-4 text-primary" /></div>
                                  <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">Library Matrix</h4>
                              </div>
                              <div className="flex flex-wrap items-center gap-4 md:gap-8">
                                  <div className="flex items-center space-x-2">
                                      <Switch id="show-archived" checked={showArchived} onCheckedChange={(val) => { setShowArchived(val); if(val) setShowBanned(false); }} />
                                      <Label htmlFor="show-archived" className="text-[10px] font-black uppercase tracking-widest cursor-pointer text-slate-600">Archived</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                      <Switch id="show-banned" checked={showBanned} onCheckedChange={(val) => { setShowBanned(val); if(val) setShowArchived(false); }} />
                                      <Label htmlFor="show-banned" className="text-[10px] font-black uppercase tracking-widest text-destructive cursor-pointer">Banned</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                      <Switch id="owes-balance" checked={owesBalanceOnly} onCheckedChange={setOwesBalanceOnly} />
                                      <Label htmlFor="owes-balance" className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 cursor-pointer">
                                          <Wallet className="w-3 h-3 text-destructive" /> 
                                          Arrears Only
                                      </Label>
                                  </div>
                              </div>
                              <div className="flex flex-wrap gap-2 w-full md:w-auto md:ml-auto">
                                <Button variant="ghost" size="sm" className='h-9 font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5 rounded-xl border border-primary/10' onClick={handleBulkReconcile} disabled={isReconciling}>
                                    {isReconciling ? <Loader className="animate-spin h-3.5 w-3.5 mr-2"/> : <Database className="mr-2 h-3.5 w-3.5"/>}
                                    Sync All Ledgers
                                </Button>
                                <Button variant="ghost" size="sm" className='h-9 font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5 rounded-xl border border-primary/10' onClick={() => setIsMergeClientsOpen(true)}>
                                    <Merge className="mr-2 h-3.5 w-3.5"/>Merge Duplicate Profiles
                                </Button>
                              </div>
                          </div>
                      </CardHeader>
                      <CardContent className="p-6 md:p-8">
                          {selectedItems.size > 0 && (
                              <div className="mb-8 p-5 rounded-[2rem] bg-slate-900 text-white flex items-center justify-between shadow-2xl animate-in slide-in-from-top-4 duration-500">
                                  <div className="flex items-center gap-4 text-left">
                                      <div className="p-2 bg-white/10 rounded-xl"><Check className="w-5 h-5" /></div>
                                      <p className="text-xs font-black uppercase tracking-widest">{selectedItems.size} Selected</p>
                                  </div>
                                  <div className="flex gap-2">
                                      {showArchived || showBanned ? (
                                          <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkUnarchive}>Restore Access</Button>
                                      ) : (
                                          <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkArchive}>Archive</Button>
                                      )}
                                      <Button variant="destructive" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest" onClick={handleBulkDeleteClick}>Purge</Button>
                                  </div>
                              </div>
                          )}
                          {!hasClients ? (
                              <EmptyState onAddClient={() => setIsAddClientOpen(true)} />
                          ) : !hasFilteredClients ? (
                              <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                                  <Filter className="w-16 h-16" />
                                  <p className="font-black uppercase tracking-widest text-sm">No Matches Found</p>
                              </div>
                          ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                          <CardFooter className="p-8 pt-0 border-t bg-muted/5">
                              <div className="flex items-center justify-between w-full">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">
                                      Segment {currentPage} of {totalPages}
                                  </span>
                                  <div className="flex items-center gap-2">
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={handlePrevPage}
                                          disabled={currentPage === 1}
                                          className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                      >
                                          <ChevronLeft className="mr-2 h-4 w-4" /> Previous
                                      </Button>
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={handleNextPage}
                                          disabled={currentPage === totalPages}
                                          className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                      >
                                          Next <ChevronRight className="ml-2 h-4 w-4" />
                                      </Button>
                                  </div>
                              </div>
                          </CardFooter>
                      )}
                  </Card>
              </div>
              <div className="hidden lg:block lg:col-span-1">
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
          onMerge={handleMergeClients} 
        />
        
        <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
              <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                  <AlertDialogHeader className="p-6 pb-0 text-left">
                      <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">Confirm Purge</AlertDialogTitle>
                      <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase text-left">
                          You are about to permanently delete {selectedItems.size} guest records. This will wipe all associated dossiers, formulas, and history. <strong>This action is non-reversible.</strong>
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                      <Button onClick={handleBulkDeleteConfirm} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Records</Button>
                      <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Abort</AlertDialogCancel>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>
      </ClientOnly>
    </div>
  );
}