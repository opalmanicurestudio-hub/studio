
'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Award, Repeat, Sparkles, Activity, Loader } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MembershipCard } from '@/components/memberships/MembershipCard';
import { PackageCard } from '@/components/memberships/PackageCard';
import { type Membership, type Package, type Client } from '@/lib/data';
import { AddMembershipDialog } from '@/components/memberships/AddMembershipDialog';
import { AddPackageDialog } from '@/components/memberships/AddPackageDialog';
import { ActiveUsersDialog } from '@/components/memberships/ActiveUsersDialog';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const EmptyState = ({ type, onAdd }: { type: 'membership' | 'package', onAdd: () => void }) => {
  const Icon = type === 'membership' ? Award : Repeat;
  return (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Icon className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Archive Idle</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
                {type === 'membership' 
                    ? 'Build predictable, recurring revenue by offering exclusive perks to loyal clients.' 
                    : 'Boost cash flow and encourage client commitment with prepaid service bundles.'}
            </p>
        </div>
        <Button size="lg" onClick={onAdd} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Create First {type === 'membership' ? 'Tier' : 'Bundle'}
        </Button>
    </div>
  )
};

const MembershipsPage = () => {
  const [activeTab, setActiveTab] = useState('memberships');
  const { services, memberships: allMemberships, packages: allPackages, clients, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;
  
  const [isAddMembershipOpen, setIsAddMembershipOpen] = useState(false);
  const [isAddPackageOpen, setIsAddPackageOpen] = useState(false);

  const [editingMembership, setEditingMembership] = useState<Membership | null>(null);
  const [editingPackage, setEditingPackage] = useState<Package | null>(null);

  const [viewingUsersFor, setViewingUsersFor] = useState<Membership | Package | null>(null);
  
  const handleAddNew = () => {
    if (activeTab === 'memberships') {
      setEditingMembership(null);
      setIsAddMembershipOpen(true);
    } else {
      setEditingPackage(null);
      setIsAddPackageOpen(true);
    }
  };

  const handleEditMembership = (membership: Membership) => {
    setEditingMembership(membership);
    setIsAddMembershipOpen(true);
  };

  const handleEditPackage = (pack: Package) => {
    setEditingPackage(pack);
    setIsAddPackageOpen(true);
  };
  
  const handleDeleteMembership = (id: string) => {
    if (!firestore || !tenantId) return;
    const membershipRef = doc(firestore, 'tenants', tenantId, 'memberships', id);
    deleteDocumentNonBlocking(membershipRef);
    toast({
        variant: "destructive",
        title: "Membership Terminated",
    });
  };
  
  const handleDeletePackage = (id: string) => {
    if (!firestore || !tenantId) return;
    const packageRef = doc(firestore, 'tenants', tenantId, 'packages', id);
    deleteDocumentNonBlocking(packageRef);
    toast({
        variant: "destructive",
        title: "Bundle Terminated",
    });
  };

  const handleSaveMembership = (membership: Membership) => {
    if (!firestore || !tenantId) return;
    if (editingMembership) {
        const membershipRef = doc(firestore, 'tenants', tenantId, 'memberships', membership.id);
        updateDocumentNonBlocking(membershipRef, membership);
        toast({ title: 'Protocol Updated' });
    } else {
      const newMembership = { ...membership, id: `mem-${nanoid()}` };
      const membershipRef = doc(firestore, 'tenants', tenantId, 'memberships', newMembership.id);
      setDocumentNonBlocking(membershipRef, newMembership, {});
      toast({ title: 'Tier Registered' });
    }
  };

  const handleSavePackage = (pack: Package) => {
    if (!firestore || !tenantId) return;
    if (editingPackage) {
        const packageRef = doc(firestore, 'tenants', tenantId, 'packages', pack.id);
        updateDocumentNonBlocking(packageRef, pack);
        toast({ title: 'Protocol Updated' });
    } else {
      const newPackage = { ...pack, id: `pkg-${nanoid()}` };
      const packageRef = doc(firestore, 'tenants', tenantId, 'packages', newPackage.id);
      setDocumentNonBlocking(packageRef, newPackage, {});
      toast({ title: 'Bundle Registered' });
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Club Access" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Clubhouse</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Retention engine & recurring yield
            </p>
          </div>
          <Button onClick={handleAddNew} className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <PlusCircle className="mr-2 h-4 w-4" /> Add New {activeTab === 'memberships' ? 'Tier' : 'Bundle'}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 w-fit mx-auto sm:mx-0">
            <TabsTrigger value="memberships" className="px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Tiers (MRR)</TabsTrigger>
            <TabsTrigger value="packages" className="px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Bundles (LTV)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="memberships" className="mt-0">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Syncing Archives...</p>
                </div>
            ) : (allMemberships && allMemberships.length > 0) ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {allMemberships.map(membership => (
                    <MembershipCard 
                        key={membership.id} 
                        membership={membership}
                        clients={clients || []}
                        onEdit={handleEditMembership}
                        onViewUsers={setViewingUsersFor}
                        onDelete={handleDeleteMembership}
                    />
                    ))}
                </div>
            ) : (
                <EmptyState type="membership" onAdd={handleAddNew} />
            )}
          </TabsContent>
          
          <TabsContent value="packages" className="mt-0">
             {isLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Syncing Archives...</p>
                </div>
            ) : (allPackages && allPackages.length > 0) ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {allPackages.map(pack => (
                    <PackageCard 
                        key={pack.id} 
                        pack={pack} 
                        services={services} 
                        clients={clients || []}
                        onEdit={handleEditPackage}
                        onViewUsers={setViewingUsersFor}
                        onDelete={handleDeletePackage}
                    />
                    ))}
                </div>
            ) : (
                <EmptyState type="package" onAdd={handleAddNew} />
            )}
          </TabsContent>
        </Tabs>
      </main>

      <AddMembershipDialog 
        open={isAddMembershipOpen}
        onOpenChange={setIsAddMembershipOpen}
        onSave={handleSaveMembership}
        membershipToEdit={editingMembership}
      />
      <AddPackageDialog
        open={isAddPackageOpen}
        onOpenChange={setIsAddPackageOpen}
        onSave={handleSavePackage}
        packageToEdit={editingPackage}
      />
      
      {viewingUsersFor && (
        <ActiveUsersDialog
          open={!!viewingUsersFor}
          onOpenChange={() => setViewingUsersFor(null)}
          offering={viewingUsersFor}
        />
      )}
    </div>
  );
};

export default MembershipsPage;
