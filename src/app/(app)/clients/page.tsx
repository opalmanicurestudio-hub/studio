'use client';

import { ClientsList } from '@/components/clients/ClientsList';
import { SettingsStyle } from '@/components/settings/settings-style';
import { StaffBookSheet } from '@/components/pos/desk/StaffBookSheet';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { 
  MoreHorizontal, PlusCircle, Search, FileDown, UserPlus, Merge, Users, ShieldPlus,
  AlertTriangle, Ear, ShieldAlert, BadgeInfo, Ban, FileText, Package, Loader, Wallet,
  TrendingUp, Sparkles, ChevronLeft, ChevronRight, Filter, SlidersHorizontal, Check,
  RefreshCw, Database, Phone
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
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
import { cn, safeNumber } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, query, where, getDocs, arrayUnion } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { canSeeFinancials, canSeeClientContact, canMessageClients } from '@/lib/privacy';
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
            <UserPlus className="mr-2 h-5 w-5" />Add First Guest
        </Button>
    </div>
);

export default function ClientsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role, roleId, can, isLoading: isTenantLoading } = useTenant();
  // v43 — single source of truth: lib/privacy.ts + tenant.staffPrivacy.
  const showFinancials = canSeeFinancials(selectedTenant, roleId || role);
  const showContact = canSeeClientContact(selectedTenant, roleId || role);
  const router = useRouter();
  const tenantId = selectedTenant?.id;
  const inv = useInventory();
  const { clients, appointments, transactions } = inv;
  const [bookFor, setBookFor] = useState<string | null>(null);

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
      if (!isTenantLoading && role === 'staff') router.replace('/dashboard');
  }, [role, isTenantLoading, router]);

  const handleAddClient = (data: ClientFormData) => {
    if (!firestore || !tenantId) return;
    const { referringClientId, ...clientData } = data;
    const firstName = (data.name || 'GUEST').split(' ')[0].toUpperCase();
    const referralCode = `${firstName}${nanoid(4)}`;
    const newClient: Omit<Client, 'id'> = {
      name: data.name, email: data.email || '', phone: data.phone || '',
      avatarUrl: data.avatarUrl || '', lifetimeValue: 0,
      lastAppointment: new Date().toISOString(), status: 'active',
      notes: data.notes, referralCode,
      birthday: data.birthday ? data.birthday.toISOString() : undefined,
      address: data.address, emergencyContact: data.emergencyContact,
      intel: { referralSource: data.intel?.referralSource }
    };
    const clientsCollection = collection(firestore, `tenants/${tenantId}/clients`);
    addDocumentNonBlocking(clientsCollection, JSON.parse(JSON.stringify(newClient)));
    if (referringClientId && clients) {
        const referrer = clients.find(c => c.id === referringClientId);
        if (referrer) {
            updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients/${referringClientId}`), { successfulReferrals: [...(referrer.successfulReferrals || []), newClient.name] });
        }
    }
    toast({ title: "Client Added", description: `${data.name} has been added to your client list.` });
  };

  const handleBulkReconcile = async () => {
      if (!firestore || !tenantId || !clients || isReconciling) return;
      setIsReconciling(true);
      const batch = writeBatch(firestore);
      try {
          const txnsSnap = await getDocs(collection(firestore, `tenants/${tenantId}/transactions`));
          const incomeByClient: Record<string, number> = {};
          txnsSnap.docs.forEach(d => {
              const data = d.data();
              if (data.clientId) {
                  const amount = safeNumber(data.amount);
                  if (data.type === 'income') incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) + amount;
                  else if (data.type === 'reversal') incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) - amount;
                  else if (data.type === 'expense' && data.category === 'Discounts') incomeByClient[data.clientId] = (incomeByClient[data.clientId] || 0) - amount;
              }
          });
          clients.forEach(client => {
              const realLtv = Math.max(0, incomeByClient[client.id] || 0);
              if (Math.abs(realLtv - safeNumber(client.lifetimeValue)) > 0.01) {
                  batch.update(doc(firestore, `tenants/${tenantId}/clients`, client.id), { lifetimeValue: realLtv });
              }
          });
          await batch.commit();
          toast({ title: "Ledgers Synchronized", description: "All client lifetime values have been verified against the transaction ledger." });
      } catch (e) {
          toast({ variant: 'destructive', title: "Sync Failed" });
      } finally {
          setIsReconciling(false);
      }
  };

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
        const newSelection = new Set(prev);
        newSelection.has(itemId) ? newSelection.delete(itemId) : newSelection.add(itemId);
        return newSelection;
    });
  }, []);

  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    const batch = writeBatch(firestore);
    selectedItems.forEach(id => batch.delete(doc(firestore, `tenants/${tenantId}/clients`, id)));
    batch.commit();
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({ title: "Clients Deleted", description: `${itemCount} client(s) have been removed.` });
  }, [selectedItems, toast, firestore, tenantId]);
  
  const handleBulkArchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, id), { status: 'archived' }));
    toast({ title: `${selectedItems.size} client(s) have been archived.` });
    setSelectedItems(new Set());
  }, [selectedItems, toast, firestore, tenantId]);

  const handleBulkUnarchive = useCallback(() => {
    if (!firestore || !tenantId) return;
    selectedItems.forEach(id => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, id), { status: 'active' }));
    toast({ title: `${selectedItems.size} client(s) have been restored.` });
    setSelectedItems(new Set());
  }, [selectedItems, toast, firestore, tenantId]);

  const handleMergeClients = async (primaryId: string, secondaryClients: Client[]) => {
    if (!firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    const primaryRef = doc(firestore, `tenants/${tenantId}/clients`, primaryId);
    let totalLtvGain = 0, totalBalanceGain = 0;
    for (const secondary of secondaryClients) {
        totalLtvGain += safeNumber(secondary.lifetimeValue);
        totalBalanceGain += safeNumber(secondary.outstandingBalance);
        const aptsSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/appointments`), where("clientId", "==", secondary.id)));
        aptsSnap.forEach(aptDoc => batch.update(aptDoc.ref, { clientId: primaryId }));
        const txnsSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/transactions`), where("clientId", "==", secondary.id)));
        txnsSnap.forEach(txnDoc => batch.update(txnDoc.ref, { clientId: primaryId }));
        batch.delete(doc(firestore, `tenants/${tenantId}/clients`, secondary.id));
    }
    batch.update(primaryRef, { lifetimeValue: increment(totalLtvGain), outstandingBalance: increment(totalBalanceGain) });
    try {
        await batch.commit();
        toast({ title: "Merge Complete", description: "Dossiers consolidated and history re-attributed." });
    } catch (e) {
        toast({ variant: 'destructive', title: "Merge Failed" });
    }
  };
  
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    let clientsToFilter = clients.filter(client => {
      if (showBanned) return client.status === 'banned';
      return showArchived ? client.status === 'archived' : client.status === 'active';
    });
    if (owesBalanceOnly) clientsToFilter = clientsToFilter.filter(c => safeNumber(c.outstandingBalance) > 0);
    if (lastSeenFilter !== 'all') {
      const cutoffDate = subDays(new Date(), parseInt(lastSeenFilter));
      clientsToFilter = clientsToFilter.filter(client => new Date(client.lastAppointment) < cutoffDate);
    }
    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        // Strip all non-digits from the search term for phone matching
        const numericSearch = searchTerm.replace(/\D/g, '');

        clientsToFilter = clientsToFilter.filter(client => {
            const nameMatch = client.name.toLowerCase().includes(lower);
            const emailMatch = client.email && client.email.toLowerCase().includes(lower);

            // Phone match: compare numeric digits only, match any substring
            let phoneMatch = false;
            if (numericSearch.length >= 3 && client.phone) {
                const numericPhone = client.phone.replace(/\D/g, '');
                phoneMatch = numericPhone.includes(numericSearch);
            }

            return nameMatch || emailMatch || phoneMatch;
        });
    }
    return clientsToFilter.sort((a, b) => new Date(b.lastAppointment).getTime() - new Date(a.lastAppointment).getTime());
  }, [clients, searchTerm, lastSeenFilter, showArchived, showBanned, owesBalanceOnly]);
  
  const totalPages = Math.ceil(filteredClients.length / ITEMS_PER_PAGE);
  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredClients.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredClients, currentPage]);

  const ClientStatsSidebar = () => {
    const stats = useMemo(() => {
        const totalClients = filteredClients.length;
        if (totalClients === 0 || !appointments || !transactions) return { totalActiveClients: 0, retentionRate: 0, avgSpend: 0, serviceRevenue: 0, retailRevenue: 0, tipRevenue: 0, totalPendingDebt: 0 };
        const filteredClientIds = new Set(filteredClients.map(c => c.id));
        const relevantTransactions = transactions.filter(t => t.clientId && filteredClientIds.has(t.clientId));
        const clientsWithMultipleAppointments = filteredClients.filter(c => (appointments || []).filter(apt => apt.clientId === c.id && apt.status === 'completed').length > 1).length;
        const totalRevenue = filteredClients.reduce((acc, c) => acc + safeNumber(c.lifetimeValue), 0);
        const totalPendingDebt = filteredClients.reduce((acc, c) => acc + safeNumber(c.outstandingBalance), 0);
        const serviceRevenue = relevantTransactions.filter(t => t.category === 'Service Revenue').reduce((acc, t) => acc + safeNumber(t.amount), 0);
        const retailRevenue = relevantTransactions.filter(t => t.category === 'Retail').reduce((acc, t) => acc + safeNumber(t.amount), 0);
        const tipRevenue = relevantTransactions.reduce((acc, t) => acc + safeNumber(t.tipAmount || 0), 0);
        const completedApts = (appointments || []).filter(a => a.status === 'completed' && filteredClientIds.has(a.clientId));
        return { totalActiveClients: totalClients, retentionRate: totalClients > 0 ? (clientsWithMultipleAppointments / totalClients) * 100 : 0, avgSpend: completedApts.length > 0 ? totalRevenue / completedApts.length : 0, serviceRevenue, retailRevenue, tipRevenue, totalPendingDebt };
    }, [filteredClients, appointments, transactions]);

    return (
        <div className="space-y-6 lg:sticky top-24">
            <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Sparkles className="w-24 h-24 text-primary" /></div>
                <CardHeader className="p-8 pb-4"><CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2"><BadgeInfo className="w-3 h-3" />Intelligence Hub</CardTitle></CardHeader>
                <CardContent className="p-8 pt-0 text-left">
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Active Portfolio</p>
                    <p className="text-5xl font-black text-primary tracking-tighter font-mono leading-none">{stats.totalActiveClients}</p>
                    <div className="mt-6 space-y-4">
                        <div className="p-4 rounded-2xl bg-white/50 border border-primary/10 shadow-sm">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Retention</span>
                                <span className="text-sm font-black text-primary">{stats.retentionRate.toFixed(0)}%</span>
                            </div>
                            <div className="h-1 w-full bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${stats.retentionRate}%` }} /></div>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden">
                <CardHeader className="bg-muted/5 border-b p-6"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><TrendingUp className="w-3 h-3" /> Financial Performance</CardTitle></CardHeader>
                <CardContent className="p-6 space-y-6 text-left">
                    <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/10 text-destructive space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Arrears Recovery</p>
                        <p className="text-2xl font-black font-mono tracking-tighter">{showFinancials ? `$${stats.totalPendingDebt.toFixed(2)}` : '••••'}</p>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60"><span>Services</span><span className="font-mono">{showFinancials ? `$${stats.serviceRevenue.toFixed(2)}` : '••••'}</span></div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60"><span>Retail</span><span className="font-mono">{showFinancials ? `$${stats.retailRevenue.toFixed(2)}` : '••••'}</span></div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60"><span>Tips</span><span className="font-mono">{showFinancials ? `$${stats.tipRevenue.toFixed(2)}` : '••••'}</span></div>
                        <Separator className="bg-muted/50" />
                        <div className="flex justify-between items-center font-black"><span className="text-[10px] uppercase tracking-widest text-slate-900">Avg. Ticket</span><span className="text-lg tracking-tighter font-mono text-primary">{showFinancials ? `$${stats.avgSpend.toFixed(2)}` : '••••'}</span></div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
  };
  
  if (isTenantLoading || role === 'staff') {
      return <div className="flex min-h-screen w-full flex-col"><AppHeader title="Client Log" /><main className="flex-1 p-4 md:p-8 flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-primary" /></main></div>;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Client Log" />
      <ClientOnly>
        <main className="cf-settings cf-legacy flex-1 w-full max-w-7xl mx-auto min-w-0 p-4 pb-28 md:p-8">
          <SettingsStyle />
          <ClientsList tenantId={tenantId || ''} clients={clients || []} appointments={appointments || []} services={(inv as any).services || []} staff={(inv as any).staff || []}
            showMoney={!!showFinancials} showContact={!!showContact} canMessage={canMessageClients(selectedTenant, roleId || role)} canManage={can('clients.delete')}
            onOpen={(id: string) => router.push(`/clients/${id}`)} onBook={(id: string) => setBookFor(id)} onAdd={() => setIsAddClientOpen(true)} onFindDuplicates={() => setIsMergeClientsOpen(true)}
            onArchive={(ids: string[]) => { if (!firestore || !tenantId) return; ids.forEach((id) => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, id), { status: 'archived' })); toast({ title: `${ids.length} archived` }); }}
            onUnarchive={(ids: string[]) => { if (!firestore || !tenantId) return; ids.forEach((id) => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, id), { status: 'active' })); toast({ title: `${ids.length} restored` }); }}
            onDelete={role === 'owner' ? (ids: string[]) => { setSelectedItems(new Set(ids)); setIsBulkDeleteConfirmOpen(true); } : undefined}
            onTag={(ids: string[], tag: string) => { if (!firestore || !tenantId) return; ids.forEach((id) => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, id), { tags: arrayUnion(tag) } as any)); toast({ title: `Tagged ${ids.length} “${tag}”` }); }} />
          {tenantId && <StaffBookSheet open={!!bookFor} onClose={() => setBookFor(null)} tenantId={tenantId} tenant={selectedTenant} clients={clients || []} services={(inv as any).services || []} staff={((inv as any).staff || []).filter((st: any) => st.role !== 'renter' && st.active !== false)}
            appointments={appointments || []} role={role} uid={null} prefill={bookFor ? { clientId: bookFor } : null} />}
        </main>

        <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={handleAddClient} />
        <MergeClientsDialog open={isMergeClientsOpen} onOpenChange={setIsMergeClientsOpen} allClients={clients || []} allAppointments={appointments || []} onMerge={handleMergeClients} />
        <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
              <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                  <AlertDialogHeader className="p-6 pb-0 text-left">
                      <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">Delete for good?</AlertDialogTitle>
                      <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase text-left">You are about to permanently delete {selectedItems.size} client records. <strong>This action is non-reversible.</strong></AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                      <Button onClick={handleBulkDeleteConfirm} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Records</Button>
                      <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>
      </ClientOnly>
    </div>
  );
}
