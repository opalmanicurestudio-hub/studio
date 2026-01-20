
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
import { MoreHorizontal, PlusCircle, Users, Calendar as CalendarIcon, FlaskConical, AlertTriangle, List, TrendingUp, DollarSign } from 'lucide-react';
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
import { format, subDays, startOfDay, endOfDay, parseISO, isPast, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const StaffCard = ({ member, stats, services }: { member: Staff, stats: any, services: Service[] }) => {
    const [licenseInfo, setLicenseInfo] = useState<{
        isExpired: boolean;
        isExpiringSoon: boolean;
        daysUntilExpiry: number | null;
        expiryDate: Date | null;
    } | null>(null);

    const staffServices = useMemo(() => {
      if (!member.services) return [];
      return services.filter(s => member.services!.includes(s.id));
    }, [member.services, services]);

    useEffect(() => {
        if (!member.compliance?.licenseExpiry) return;
        const licenseExpiry = parseISO(member.compliance.licenseExpiry);
        if (licenseExpiry) {
            const daysUntil = differenceInDays(licenseExpiry, new Date());
            const expired = isPast(licenseExpiry);
            const expiringSoon = daysUntil <= 30 && !expired;

            setLicenseInfo({
                isExpired: expired,
                isExpiringSoon: expiringSoon,
                daysUntilExpiry: daysUntil,
                expiryDate: licenseExpiry,
            });
        }
    }, [member.compliance?.licenseExpiry]);
    
    return (
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

            {licenseInfo && (licenseInfo.isExpired || licenseInfo.isExpiringSoon) && (
                <div className="mt-4 text-left p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-semibold">{licenseInfo.isExpired ? 'License Expired' : 'License Expiring Soon'}</p>
                        <p>
                            {licenseInfo.isExpired 
                            ? `Expired on ${format(licenseInfo.expiryDate!, 'MMM d, yyyy')}.`
                            : `Expires in ${licenseInfo.daysUntilExpiry} days on ${format(licenseInfo.expiryDate!, 'MMM d, yyyy')}.`
                            }
                        </p>
                    </div>
                </div>
            )}
            </CardContent>
            <Separator />
            <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-center">
                     <div>
                        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><TrendingUp className="w-3 h-3"/>Total Sales</p>
                        <p className="text-xl font-bold">${stats.totalSales.toFixed(2)}</p>
                    </div>
                     <div>
                        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3"/>Total Tips</p>
                        <p className="text-xl font-bold">${stats.tips.toFixed(2)}</p>
                    </div>
                    <div className="col-span-2 border-t pt-4">
                        <p className="text-xs text-muted-foreground">Est. Take-home Pay</p>
                        <p className="text-lg font-semibold text-primary">${stats.earnings.toFixed(2)}</p>
                    </div>
                    <div className="col-span-2 border-t pt-4">
                        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><FlaskConical className="w-3 h-3"/>Product Consumption</p>
                        <p className="text-lg font-semibold">${stats.consumptionValue.toFixed(2)}</p>
                    </div>
                </div>
                {staffServices.length > 0 && (
                    <div className="text-left border-t pt-4">
                        <h4 className="font-semibold text-xs text-muted-foreground mb-2 flex items-center gap-2"><List className="w-4 h-4"/>Services Offered</h4>
                        <div className="flex flex-wrap gap-1">
                            {staffServices.map(s => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}
                        </div>
                    </div>
                )}
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
    )
};


export default function StaffPage() {
  const { staff, setStaff, appointments, services, transactions, stockCorrections, inventory } = useInventory();
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  useEffect(() => {
    // Set initial date range on client to avoid hydration mismatch
    setDateRange({ from: subDays(new Date(), 29), to: new Date() });
  }, []);

  const staffWithStats = useMemo(() => {
    if (!staff || !transactions) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(member => {
        const staffTransactions = transactions.filter(t => {
            if (t.staffId !== member.id) return false;
            
            const transactionDate = new Date(t.date);
            if(fromDate && transactionDate < fromDate) return false;
            if(toDate && transactionDate > toDate) return false;

            return true;
        });
        
        const serviceRevenue = staffTransactions
            .filter(t => t.category === 'Service Revenue')
            .reduce((acc, t) => acc + t.amount, 0);

        const retailSales = staffTransactions
            .filter(t => t.category === 'Retail')
            .reduce((acc, t) => acc + t.amount, 0);
        
        const totalSales = serviceRevenue + retailSales;

        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);

        let earnings = 0;
        if (member.payStructure === 'commission') {
            earnings = serviceRevenue * (member.commissionRate / 100);
        }
        // Simplified for now - assuming salary/hourly is handled separately
        earnings += tips; 
        
        let consumptionValue = 0;
        const staffAppointmentIds = new Set(
            (appointments || [])
                .filter(a => a.staffId === member.id)
                .map(a => a.id)
        );

        stockCorrections.forEach(sc => {
            const match = sc.reason.match(/Appointment #(\S+)/);
            if (match && staffAppointmentIds.has(match[1])) {
                const product = inventory.find(p => p.id === sc.productId);
                if (product && product.costPerUnit) {
                    let costPerBaseUnit = 0;
                    if (product.costingMethod === 'size' && product.size && product.size > 0) {
                        costPerBaseUnit = product.costPerUnit / product.size;
                    } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                        costPerBaseUnit = product.costPerUnit / product.estimatedUses;
                    } else if (!product.costingMethod) {
                        costPerBaseUnit = product.costPerUnit;
                    }
                    consumptionValue += Math.abs(sc.change) * costPerBaseUnit;
                }
            }
        });


        return {
            ...member,
            stats: {
                totalSales,
                tips,
                earnings,
                consumptionValue,
            }
        };
    });
  }, [staff, transactions, dateRange, appointments, stockCorrections, inventory]);

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
              <StaffCard key={member.id} member={member} stats={member.stats} services={services} />
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
        services={services}
      />
    </div>
  );
}
