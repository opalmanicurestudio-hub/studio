
'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Award, Repeat } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MembershipCard } from '@/components/memberships/MembershipCard';
import { PackageCard } from '@/components/memberships/PackageCard';
import { memberships, packages, type Membership, type Package } from '@/lib/data';
import { AddMembershipDialog } from '@/components/memberships/AddMembershipDialog';
import { AddPackageDialog } from '@/components/memberships/AddPackageDialog';
import { ActiveUsersDialog } from '@/components/memberships/ActiveUsersDialog';

const EmptyState = ({ type, onAdd }: { type: 'membership' | 'package', onAdd: () => void }) => {
  const Icon = type === 'membership' ? Award : Repeat;
  return (
    <div className="text-center py-16 px-6 col-span-full border-2 border-dashed rounded-lg">
      <div className='flex justify-center mb-6'>
          <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center'>
              <Icon className='w-10 h-10 text-muted-foreground' />
          </div>
      </div>
      <h3 className="text-2xl font-semibold">Create Your First {type === 'membership' ? 'Membership' : 'Package'}</h3>
      <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-6">
        {type === 'membership' 
            ? 'Build predictable, recurring revenue by offering exclusive perks to loyal clients.' 
            : 'Boost cash flow and encourage client commitment with prepaid service bundles.'}
      </p>
      <Button onClick={onAdd}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add New {type === 'membership' ? 'Membership' : 'Package'}
      </Button>
    </div>
  )
};

const MembershipsPage = () => {
  const [activeTab, setActiveTab] = useState('memberships');
  const [allMemberships, setAllMemberships] = useState<Membership[]>(memberships);
  const [allPackages, setAllPackages] = useState<Package[]>(packages);
  
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

  const handleSaveMembership = (membership: Membership) => {
    if (editingMembership) {
      setAllMemberships(prev => prev.map(m => m.id === membership.id ? membership : m));
    } else {
      setAllMemberships(prev => [...prev, { ...membership, id: `mem-${Date.now()}` }]);
    }
  };

  const handleSavePackage = (pack: Package) => {
     if (editingPackage) {
      setAllPackages(prev => prev.map(p => p.id === pack.id ? pack : p));
    } else {
      setAllPackages(prev => [...prev, { ...pack, id: `pkg-${Date.now()}` }]);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Memberships & Packages" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Memberships & Packages</h1>
            <p className="text-muted-foreground mt-1">
              Create and manage your recurring memberships and prepaid packages.
            </p>
          </div>
          <Button onClick={handleAddNew}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add New {activeTab === 'memberships' ? 'Membership' : 'Package'}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="memberships">Memberships</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
          </TabsList>
          <TabsContent value="memberships" className="mt-6">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {allMemberships.length > 0 ? (
                allMemberships.map(membership => (
                  <MembershipCard 
                    key={membership.id} 
                    membership={membership} 
                    onEdit={handleEditMembership}
                    onViewUsers={setViewingUsersFor}
                  />
                ))
              ) : (
                <EmptyState type="membership" onAdd={handleAddNew} />
              )}
            </div>
          </TabsContent>
          <TabsContent value="packages" className="mt-6">
             <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {allPackages.length > 0 ? (
                allPackages.map(pack => (
                  <PackageCard 
                    key={pack.id} 
                    pack={pack} 
                    onEdit={handleEditPackage}
                    onViewUsers={setViewingUsersFor}
                  />
                ))
              ) : (
                <EmptyState type="package" onAdd={handleAddNew} />
              )}
            </div>
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
