
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Clock, CheckCircle, Coffee, ShieldAlert, Link as LinkIcon, MoreHorizontal, Printer } from 'lucide-react';
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
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PrintWalkInTicket, WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';

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
                <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { status: 'idle' })} disabled={staffMember.status === 'idle'}>
                   Force Idle
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => onStatusChange(staffMember.id, { status: 'busy' })} disabled={staffMember.status === 'busy'}>
                   Force Busy
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

const WaitingCustomerCard = ({ walkIn, services, onPrintTicket }: { walkIn: WalkIn, services: any[], onPrintTicket: (data: WalkIn) => void }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground">Checked in {formatDistanceToNow(parseISO(walkIn.checkInTime), { addSuffix: true })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary">{walkIn.status}</Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => onPrintTicket(walkIn)}>
                                    <Printer className="mr-2 h-4 w-4"/>Print Ticket
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
};

const ServicingCustomerCard = ({ walkIn, services, staff, onStatusChange, onPrintTicket }: { walkIn: WalkIn, services: any[], staff: Staff[], onStatusChange: (walkInId: string, staffId: string, status: WalkIn['status']) => void, onPrintTicket: (data: WalkIn) => void }) => {
    const walkInServices = services.filter(s => walkIn.serviceIds.includes(s.id));
    const assignedStaff = staff.find(s => s.id === walkIn.assignedStaffId);
    
    return (
        <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-bold text-xl">{walkIn.customerName}</p>
                        <p className="text-sm text-primary">Assigned to: {assignedStaff?.name || 'N/A'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground capitalize">{walkIn.status}</Badge>
                         <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => onPrintTicket(walkIn)}>
                                    <Printer className="mr-2 h-4 w-4"/>Print Ticket
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <p className="font-semibold text-sm">Services:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {walkInServices.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                </div>
                 <div className="mt-4 border-t pt-4 flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onStatusChange(walkIn.id, assignedStaff?.id || '', 'skipped')}>Mark as Skipped</Button>
                    <Button size="sm" onClick={() => onStatusChange(walkIn.id, assignedStaff?.id || '', 'completed')}>Mark as Completed</Button>
                </div>
            </CardContent>
        </Card>
    )
}


export default function WalkInQueuePage() {
  const { services } = useInventory();
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc';
  const [ticketToPrint, setTicketToPrint] = useState<WalkIn | null>(null);
  
  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'staff');
  }, [firestore, user, tenantId]);
  
  const walkInQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'walkIns');
  }, [firestore, user, tenantId]);

  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(walkInQuery);

  const waitingQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'waiting').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);
  
  const servicingQueue = useMemo(() => {
    if (!walkIns) return [];
    return (walkIns || []).filter(w => w.status === 'assigned' || w.status === 'servicing').sort((a,b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
  }, [walkIns]);

  const handleStaffStatusChange = (staffId: string, statusUpdate: Partial<Staff>) => {
    if (!firestore) return;
    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
    updateDocumentNonBlocking(staffDocRef, statusUpdate);
  }
  
  const handleWalkInStatusChange = (walkInId: string, staffId: string, status: WalkIn['status']) => {
    if (!firestore) return;
    const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
    updateDocumentNonBlocking(walkInDocRef, { status });

    // If completed or skipped, make staff idle again
    if ((status === 'completed' || status === 'skipped') && staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
        updateDocumentNonBlocking(staffDocRef, { 
            status: 'idle',
            lastServedTimestamp: new Date().toISOString(),
        });
    }
  }

    // Smart Assignment Logic
    useEffect(() => {
        if (staffLoading || walkInsLoading || !staff || !walkIns || !firestore) {
            return;
        }

        const idleStaff = staff.filter(s => s.status === 'idle' && !s.onBreak);
        if (idleStaff.length === 0) {
            return; // No one is available to take a client.
        }

        const waitingCustomers = walkIns.filter(w => w.status === 'waiting').sort((a, b) => parseISO(a.checkInTime).getTime() - parseISO(b.checkInTime).getTime());
        if (waitingCustomers.length === 0) {
            return; // No customers waiting.
        }

        // Attempt to assign the first customer who can be served.
        for (const customer of waitingCustomers) {
            let assignedStaff: Staff | undefined;

            // Find staff who have ALL the required skills for this customer's services
            const eligibleStaff = idleStaff.filter(s => 
                (customer.requiredSkills || []).every(skill => (s.skillSet || []).includes(skill))
            );

            if (eligibleStaff.length > 0) {
                // Check if customer has a preferred staff member and if they are eligible
                if (customer.preferredStaffId) {
                    const preferred = eligibleStaff.find(s => s.id === customer.preferredStaffId);
                    if (preferred) {
                        assignedStaff = preferred; // Assign the preferred staff member
                    }
                }

                // If no preferred staff was assigned, fall back to the fairest turn rotation
                if (!assignedStaff) {
                    // "Best" is defined as the one who has been idle the longest (oldest lastServedTimestamp).
                    assignedStaff = eligibleStaff.sort((a, b) =>
                        (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) -
                        (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0)
                    )[0];
                }
                
                // If we found a staff member to assign (either preferred or by rotation)
                if (assignedStaff) {
                    const walkInDocRef = doc(firestore, 'tenants', tenantId, 'walkIns', customer.id);
                    updateDocumentNonBlocking(walkInDocRef, {
                        status: 'assigned',
                        assignedStaffId: assignedStaff.id,
                    });

                    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', assignedStaff.id);
                    updateDocumentNonBlocking(staffDocRef, {
                        status: 'busy',
                    });

                    // We've made an assignment, so we break the loop to process one assignment at a time.
                    break;
                }
            }
        }

  }, [staff, walkIns, staffLoading, walkInsLoading, firestore, tenantId]);

  const ticketData: WalkInTicketData | null = ticketToPrint ? {
    id: ticketToPrint.id,
    name: ticketToPrint.customerName,
    services: services.filter(s => ticketToPrint.serviceIds.includes(s.id)),
    queuePosition: (waitingQueue.findIndex(w => w.id === ticketToPrint.id) + 1) || 1, // Mock if not in waiting
    checkInTime: ticketToPrint.checkInTime,
  } : null;


  return (
    <>
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Smart Walk-in Queue" />
      <main className="flex-1 p-4 md:p-8 space-y-8">
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="col-span-1 md:col-span-2 lg:col-span-3">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Team Status</CardTitle>
                    <CardDescription>Current availability of your staff members.</CardDescription>
                  </div>
                  <Button asChild variant="outline">
                    <Link href="/walk-in" target="_blank">
                      <LinkIcon className="mr-2 h-4 w-4" />
                      Public Check-in
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {staff?.map(member => (
                        <StaffStatusCard key={member.id} staffMember={member} onStatusChange={handleStaffStatusChange} />
                    ))}
                </CardContent>
            </Card>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <Card>
                <CardHeader>
                    <CardTitle>Waiting Queue ({waitingQueue.length})</CardTitle>
                    <CardDescription>Customers waiting to be assigned.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4">
                    {waitingQueue.length > 0 ? (
                        waitingQueue.map((walkIn, index) => (
                            <WaitingCustomerCard key={walkIn.id} walkIn={{...walkIn, queuePosition: index + 1}} services={services} onPrintTicket={setTicketToPrint} />
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
             <Card>
                <CardHeader>
                    <CardTitle>Assigned & In-Progress ({servicingQueue.length})</CardTitle>
                    <CardDescription>Customers currently being serviced.</CardDescription>
                </CardHeader>
                 <CardContent className="space-y-4">
                    {servicingQueue.length > 0 ? (
                        servicingQueue.map(walkIn => (
                            <ServicingCustomerCard 
                                key={walkIn.id} 
                                walkIn={walkIn} 
                                services={services} 
                                staff={staff || []}
                                onStatusChange={handleWalkInStatusChange}
                                onPrintTicket={setTicketToPrint}
                            />
                        ))
                    ) : (
                        <div className="text-center py-16 px-6 text-muted-foreground">
                            <Coffee className="w-12 h-12 mx-auto mb-4" />
                            <h3 className="font-semibold text-lg text-foreground">No Active Clients</h3>
                            <p>All staff members are currently available.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>

      </main>
    </div>
    <Dialog open={!!ticketToPrint} onOpenChange={() => setTicketToPrint(null)}>
      <DialogContent className="max-w-sm print-content">
        <DialogHeader className="print:hidden">
          <DialogTitle>Print Ticket</DialogTitle>
        </DialogHeader>
        <div id="ticket-area">
          {ticketData && <PrintWalkInTicket data={ticketData} />}
        </div>
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={() => setTicketToPrint(null)}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
     <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #ticket-area, #ticket-area * {
            visibility: visible;
          }
          #ticket-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
