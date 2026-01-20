

'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';
import { type Staff, type Appointment, type Service } from '@/lib/data';
import { AddStaffDialog } from '@/components/staff/AddStaffDialog';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { nanoid } from 'nanoid';
import { Separator } from '@/components/ui/separator';

const StaffCard = ({ member, stats }: { member: Staff, stats: any }) => (
  <Card className="text-center flex flex-col">
    <CardContent className="p-6 pb-4">
      <Avatar className="w-24 h-24 mx-auto mb-4">
        <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" />
        <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
      </Avatar>
      <h3 className="text-lg font-semibold">{member.name}</h3>
      <p className="text-sm text-muted-foreground">{member.email}</p>
      <Badge variant={member.role === 'admin' ? 'default' : 'secondary'} className="mt-4 capitalize">
        {member.role}
      </Badge>
    </CardContent>
    <Separator />
     <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-4 text-center">
            <div>
                <p className="text-xs text-muted-foreground">Earnings (MTD)</p>
                <p className="text-xl font-bold">${stats.earnings.toFixed(2)}</p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">Tips (MTD)</p>
                <p className="text-xl font-bold">${stats.tips.toFixed(2)}</p>
            </div>
             <div className="col-span-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">Avg. Service Duration</p>
                <p className="text-lg font-semibold">{stats.avgDuration} min</p>
            </div>
        </div>
    </CardContent>
    <CardFooter className="p-2 border-t mt-auto">
      <ClientOnly>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full">
              <MoreHorizontal className="w-4 h-4 mr-2" />
              Manage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit Profile</DropdownMenuItem>
            <DropdownMenuItem>Change Role</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Remove from Team</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ClientOnly>
    </CardFooter>
  </Card>
);


export default function StaffPage() {
  const { staff, setStaff, appointments, services, transactions } = useInventory();
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);

  const staffWithStats = useMemo(() => {
    if (!staff || !appointments || !services) return [];

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return staff.map(member => {
        const staffAppointments = appointments.filter(a => a.staffId === member.id && a.status === 'completed' && a.startTime >= startOfMonth);
        
        const earnings = staffAppointments.reduce((acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            if (service && member.payStructure === 'commission') {
                return acc + (service.price * (member.commissionRate / 100));
            }
            return acc;
        }, 0);

        // This is mock data, as tip tracking is not yet fully implemented.
        const tips = staffAppointments.length * 15; 

        const totalDuration = staffAppointments.reduce((acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            return acc + (service?.duration || 0);
        }, 0);

        const avgDuration = staffAppointments.length > 0 ? Math.round(totalDuration / staffAppointments.length) : 0;

        return {
            ...member,
            stats: {
                earnings,
                tips,
                avgDuration,
            }
        };
    });
  }, [staff, appointments, services]);

  const handleAddStaff = (newStaffData: Omit<Staff, 'id' | 'avatarUrl'>) => {
    const newStaff: Staff = {
      ...newStaffData,
      id: `staff-${nanoid()}`,
      avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
    };
    setStaff(prev => [...prev, newStaff]);
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Staff Management" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Team</h1>
            <p className="text-muted-foreground">Add, edit, and manage your staff members.</p>
          </div>
          <Button onClick={() => setIsAddStaffOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Staff Member
          </Button>
        </div>

        {staff.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {staffWithStats.map((member) => (
              <StaffCard key={member.id} member={member} stats={member.stats} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
                <Users className="w-16 h-16 mb-4"/>
              <h3 className="text-xl font-semibold mb-2 text-foreground">No staff members yet</h3>
              <p className="mb-4">Click the button to add your first team member.</p>
            </CardContent>
          </Card>
        )}
      </main>
      <AddStaffDialog 
        open={isAddStaffOpen} 
        onOpenChange={setIsAddStaffOpen} 
        onSave={handleAddStaff} 
      />
    </div>
  );
}
