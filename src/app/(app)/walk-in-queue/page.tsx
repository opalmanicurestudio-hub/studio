'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Clock, CheckCircle, Coffee, ShieldAlert } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useCollection, useFirebase, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { WalkIn, Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const StaffStatusCard = ({ staffMember, onStatusChange }: { staffMember: Staff, onStatusChange: (staffId: string, status: Partial<Staff>) => void }) => {
  const statusConfig = {
    idle: { label: 'Idle', color: 'bg-green-500' },
    busy: { label: 'Busy', color: 'bg-red-500' },
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <User className="h-10 w-10 text-muted-foreground" />
            <span className={`absolute bottom-0 right-0 block h-3 w-3 rounded-full ${statusConfig[staffMember.status || 'idle'].color} ring-2 ring-card`} />
          </div>
          <div>
            <p className="font-semibold">{staffMember.name}</p>
            <p className="text-sm text-muted-foreground capitalize">{staffMember.onBreak ? 'On Break' : statusConfig[staffMember.status || 'idle'].label}</p>
          </div>
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">Manage</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { onBreak: !staffMember.onBreak })}>
                    {staffMember.onBreak ? 'End Break' : 'Take Break'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={staffMember.status === 'busy'}>
                   Force Idle
                </DropdownMenuItem>
                 <DropdownMenuItem disabled={staffMember.status === 'idle'}>
                   Force Busy
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

const WaitingCustomerCard = ({ walkIn, services }: { walkIn: WalkIn, services: any[] }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground">Checked in {formatDistanceToNow(parseISO(walkIn.checkInTime), { addSuffix: true })}</p>
                    </div>
                     <Badge variant="secondary">{walkIn.status}</Badge>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                <div className="mt-4 border-t pt-4 flex justify-end">
                    <Button>Assign Staff</Button>
                </div>
            </CardContent>
        </Card>
    );
};


export default function WalkInQueuePage() {
  const { services } = useInventory();
  const { firestore } = useFirebase();
  const tenantId = 'tenant-abc';
  
  const staffQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'staff') : null, [firestore, tenantId]);
  const walkInQuery = useMemoFirebase(() => firestore ? collection(firestore, 'tenants', tenantId, 'walkIns') : null, [firestore, tenantId]);

  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(walkInQuery);

  const waitingQueue = useMemo(() => {
    return (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);

  const handleStaffStatusChange = (staffId: string, statusUpdate: Partial<Staff>) => {
    if (!firestore) return;
    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
    updateDocumentNonBlocking(staffDocRef, statusUpdate);
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Smart Walk-in Queue" />
      <main className="flex-1 p-4 md:p-8 space-y-8">
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="col-span-1 md:col-span-2 lg:col-span-3">
                <CardHeader>
                    <CardTitle>Team Status</CardTitle>
                    <CardDescription>Current availability of your staff members.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {staff?.map(member => (
                        <StaffStatusCard key={member.id} staffMember={member} onStatusChange={handleStaffStatusChange} />
                    ))}
                </CardContent>
            </Card>
        </div>
        
        <div className="grid grid-cols-1 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Waiting Queue ({waitingQueue.length})</CardTitle>
                    <CardDescription>Customers waiting to be assigned.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4">
                    {waitingQueue.length > 0 ? (
                        waitingQueue.map(walkIn => (
                            <WaitingCustomerCard key={walkIn.id} walkIn={walkIn} services={services} />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <CheckCircle className="w-12 h-12 mx-auto mb-4" />
                            <h3 className="font-semibold text-lg text-foreground">All Caught Up!</h3>
                            <p>There are no customers in the walk-in queue.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>

      </main>
    </div>
  );
}