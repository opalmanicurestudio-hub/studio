

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
import { MoreHorizontal, PlusCircle, Users, Calendar as CalendarIcon, FlaskConical } from 'lucide-react';
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
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

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
                <p className="text-xs text-muted-foreground">Earnings</p>
                <p className="text-xl font-bold">${stats.earnings.toFixed(2)}</p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">Tips</p>
                <p className="text-xl font-bold">${stats.tips.toFixed(2)}</p>
            </div>
             <div className="col-span-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">Avg. Service Duration</p>
                <p className="text-lg font-semibold">{stats.avgDuration} min</p>
            </div>
             <div className="col-span-2 border-t pt-4">
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><FlaskConical className="w-3 h-3"/>Product Consumption</p>
                <p className="text-lg font-semibold">${stats.consumptionValue.toFixed(2)}</p>
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
  const { staff, setStaff, appointments, services, transactions, stockCorrections, inventory } = useInventory();
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const staffWithStats = useMemo(() => {
    if (!staff || !appointments || !services) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(member => {
        const staffAppointments = appointments.filter(a => {
            if (a.staffId !== member.id || a.status !== 'completed') return false;
            
            const appointmentDate = new Date(a.startTime);
            if(fromDate && appointmentDate < fromDate) return false;
            if(toDate && appointmentDate > toDate) return false;

            return true;
        });
        
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
        
        let consumptionValue = 0;
        const appointmentIds = new Set(staffAppointments.map(a => a.id));

        stockCorrections.forEach(sc => {
            const match = sc.reason.match(/Appointment #(\S+)/);
            if (match && appointmentIds.has(match[1])) {
                const product = inventory.find(p => p.id === sc.productId);
                if (product && product.costPerUnit) {
                    let costPerBaseUnit = 0;
                    if (product.costingMethod === 'size' && product.size && product.size > 0) {
                        costPerBaseUnit = product.costPerUnit / product.size;
                    } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                        costPerBaseUnit = product.costPerUnit / product.estimatedUses;
                    } else if (!product.costingMethod) { // Fallback for items tracked per unit
                        costPerBaseUnit = product.costPerUnit;
                    }
                    consumptionValue += Math.abs(sc.change) * costPerBaseUnit;
                }
            }
        });


        return {
            ...member,
            stats: {
                earnings,
                tips,
                avgDuration,
                consumptionValue,
            }
        };
    });
  }, [staff, appointments, services, dateRange, stockCorrections, inventory]);

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
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Team</h1>
            <p className="text-muted-foreground">Add, edit, and manage your staff members.</p>
          </div>
          <Button onClick={() => setIsAddStaffOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Staff Member
          </Button>
        </div>
        
        <div className="mb-6">
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                        "w-full md:w-[300px] justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (
                        dateRange.to ? (
                            <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(dateRange.from, "LLL dd, y")
                        )
                        ) : (
                        <span>Pick a date range</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                    />
                </PopoverContent>
            </Popover>
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
