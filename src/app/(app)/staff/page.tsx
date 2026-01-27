
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
import { MoreHorizontal, PlusCircle, Users, Calendar as CalendarIcon, FlaskConical, AlertTriangle, List, TrendingUp, DollarSign, BarChart, Clock, Play, Square, Coffee } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';
import { type Staff, type Appointment, type Service, type Transaction, ActivityLog } from '@/lib/data';
import { AddStaffDialog } from '@/components/staff/AddStaffDialog';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { nanoid } from 'nanoid';
import { Separator } from '@/components/ui/separator';
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay, parseISO, isPast, differenceInDays, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StaffDetailsSheet } from '@/components/staff/StaffDetailsSheet';
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { EditStaffDialog } from '@/components/staff/EditStaffDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const StaffStatusCard = ({ member, onEdit, onStatusChange, onViewDetails }: { member: Staff & { stats: any }, onEdit: (member: Staff) => void, onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void, onViewDetails: (member: Staff & { stats: any }) => void }) => {
    const [licenseInfo, setLicenseInfo] = useState<{
        isExpired: boolean;
        isExpiringSoon: boolean;
        daysUntilExpiry: number | null;
        expiryDate: Date | null;
    } | null>(null);

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
    
    const renderActionButtons = () => {
        if (!member.active) {
            return <Button className="w-full" onClick={() => onStatusChange(member.id, 'clock_in')}><Clock className="mr-2 h-4 w-4"/>Clock In</Button>
        }
        if (member.onBreak) {
            return <Button className="w-full" variant="outline" onClick={() => onStatusChange(member.id, 'break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>
        }
        return (
            <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => onStatusChange(member.id, 'break_start')}><Coffee className="mr-2 h-4 w-4"/>Start Break</Button>
                <Button variant="destructive" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
            </div>
        )
    }

    return (
        <Card className="text-center flex flex-col">
            <CardHeader className="p-4">
                 <div className="flex justify-between items-start">
                    <Badge variant={member.active ? (member.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize", {
                        'bg-green-100 text-green-800 dark:bg-green-900/50': member.active && !member.onBreak,
                        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50': member.active && member.onBreak,
                    })}>
                        {member.active ? (member.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                    </Badge>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 -mt-2 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                             <DropdownMenuItem onClick={() => onViewDetails(member)}>View Details</DropdownMenuItem>
                             <DropdownMenuItem onClick={() => onEdit(member)}>Edit Profile</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex-1 flex flex-col items-center">
                <Avatar className="w-24 h-24 mx-auto mb-4">
                    <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" />
                    <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold">{member.name}</h3>
                <p className="text-sm text-muted-foreground capitalize">{member.role}</p>
                <Separator className="my-4" />
                <div className="w-full text-left space-y-3 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Total Sales</span><span className="font-semibold">${member.stats.totalSales.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Tips</span><span className="font-semibold">${member.stats.tips.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Consumption</span><span className="font-semibold">${member.stats.consumptionValue.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center font-bold"><span className="text-primary">Est. Take-home</span><span className="text-primary">${member.stats.earnings.toFixed(2)}</span></div>
                </div>

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
            <CardFooter className="p-4 border-t mt-auto">
                {renderActionButtons()}
            </CardFooter>
        </Card>
    )
};


export default function StaffPage() {
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [isEditStaffOpen, setIsEditStaffOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [selectedStaffMember, setSelectedStaffMember] = useState<(Staff & { stats: any }) | null>(null);
  const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);

  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc';
  
  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'staff');
  }, [firestore, user, tenantId]);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);

  const servicesQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'services');
  }, [firestore, user, tenantId]);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'transactions');
  }, [firestore, user, tenantId]);
  const { data: transactions } = useCollection<Transaction>(transactionsQuery);

  const appointmentsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'appointments');
  }, [firestore, user, tenantId]);
  const { data: appointments } = useCollection<Appointment>(appointmentsQuery);
  
  const activityLogsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'activityLogs');
  }, [firestore, user, tenantId]);
  const { data: activityLogs } = useCollection<ActivityLog>(activityLogsQuery);

  const stockCorrectionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'tenants', tenantId, 'stockCorrections');
  }, [firestore, user, tenantId]);
  const { data: stockCorrections } = useCollection<StockCorrection>(stockCorrectionsQuery);
  
  const { inventory } = useInventory();


  useEffect(() => {
    setDateRange({ from: subDays(new Date(), 29), to: new Date() });
  }, []);

  const staffWithStats = useMemo(() => {
    if (!staff || !transactions || !appointments || !stockCorrections || !activityLogs) return [];
    
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
            earnings = serviceRevenue * ((member.commissionRate || 0) / 100);
        } else if (member.payStructure === 'hourly' && member.hourlyRate) {
            const staffLogs = activityLogs.filter(log => {
                if (log.staffId !== member.id) return false;
                const logDate = parseISO(log.timestamp);
                if (fromDate && logDate < fromDate) return false;
                if (toDate && logDate > toDate) return false;
                return true;
            });

            let totalMinutesWorked = 0;
            const sortedLogs = staffLogs.sort((a, b) => parseISO(a.timestamp).getTime() - parseISO(b.timestamp).getTime());

            let clockInTime: Date | null = null;
            let breakStartTime: Date | null = null;
            let totalBreakMinutes = 0;
            
            for (const log of sortedLogs) {
                const logTime = parseISO(log.timestamp);
                if (log.type === 'clock_in') {
                    if (clockInTime) {
                        const sessionEnd = toDate && logTime > toDate ? toDate : logTime;
                        totalMinutesWorked += differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes;
                    }
                    clockInTime = logTime;
                    totalBreakMinutes = 0;
                } else if (log.type === 'clock_out' && clockInTime) {
                    let sessionEnd = logTime;
                    if (toDate && sessionEnd > toDate) sessionEnd = toDate;
                    totalMinutesWorked += differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes;
                    clockInTime = null;
                } else if (log.type === 'break_start') {
                    breakStartTime = logTime;
                } else if (log.type === 'break_end' && breakStartTime) {
                    totalBreakMinutes += differenceInMinutes(logTime, breakStartTime);
                    breakStartTime = null;
                }
            }
             // If still clocked in at the end of the range
            if(clockInTime) {
                const endOfRange = toDate || new Date();
                totalMinutesWorked += differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes;
            }


            const hoursWorked = totalMinutesWorked / 60;
            earnings = hoursWorked * member.hourlyRate;
        }

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
  }, [staff, transactions, dateRange, appointments, stockCorrections, inventory, activityLogs]);


  const transactionsForSelectedStaff = useMemo(() => {
    if (!selectedStaffMember || !transactions) return [];

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return transactions.filter(t => {
        if (t.staffId !== selectedStaffMember.id) return false;
        
        const transactionDate = new Date(t.date);
        if(fromDate && transactionDate < fromDate) return false;
        if(toDate && transactionDate > toDate) return false;

        return true;
    });
  }, [selectedStaffMember, transactions, dateRange]);
  
   const activityLogsForSelectedStaff = useMemo(() => {
    if (!selectedStaffMember || !activityLogs) return [];

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return activityLogs.filter(log => {
        if (log.staffId !== selectedStaffMember.id) return false;
        const logDate = parseISO(log.timestamp);
        if (fromDate && logDate < fromDate) return false;
        if (toDate && logDate > toDate) return false;
        return true;
    }).sort((a, b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
  }, [selectedStaffMember, activityLogs, dateRange]);


  const handleViewDetails = (member: Staff & { stats: any }) => {
    setSelectedStaffMember(member);
    setIsDetailsSheetOpen(true);
  };
  
  const handleEditClick = (member: Staff) => {
    setEditingStaff(member);
    setIsEditStaffOpen(true);
  };

  const handleAddStaff = (newStaffData: Omit<Staff, 'id' | 'avatarUrl'>) => {
    if (!firestore) return;

    const fullStaffObject: Staff = {
      ...newStaffData,
      id: `staff-${nanoid()}`,
      avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
      active: false,
      onBreak: false,
    };
    
    const sanitizedData = JSON.parse(JSON.stringify(fullStaffObject));

    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', fullStaffObject.id);
    setDocumentNonBlocking(staffDocRef, sanitizedData, {});
  };

  const handleUpdateStaff = (updatedStaffData: Staff) => {
    if (!firestore) return;
    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', updatedStaffData.id);
    const sanitizedData = JSON.parse(JSON.stringify(updatedStaffData));
    updateDocumentNonBlocking(staffDocRef, sanitizedData);
  };

  const handleStatusChangeWithConfirmation = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
      const staffMember = staff?.find(s => s.id === staffId);
      if (!staffMember) return;

      const titles = {
          clock_in: 'Confirm Clock In',
          clock_out: 'Confirm Clock Out',
          break_start: 'Confirm Start Break',
          break_end: 'Confirm End Break',
      };
       const descriptions = {
          clock_in: `Are you sure you want to clock in ${staffMember.name}?`,
          clock_out: `Are you sure you want to clock out ${staffMember.name}?`,
          break_start: `Are you sure you want to start a break for ${staffMember.name}?`,
          break_end: `Are you sure you want to end the break for ${staffMember.name}?`,
      };
      
      setConfirmation({
          isOpen: true,
          title: titles[action],
          description: descriptions[action],
          onConfirm: () => {
              handleStatusChange(staffId, action);
              setConfirmation(null);
          }
      });
  }

  const handleStatusChange = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
      if (!firestore || !staff) return;

      const staffMember = staff.find(s => s.id === staffId);
      if (!staffMember) return;
      
      const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
      const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
      const now = new Date().toISOString();

      let staffUpdate: Partial<Staff> = {};
      let logEntry: Omit<ActivityLog, 'id'> = { staffId, type: action, timestamp: now };

      switch (action) {
          case 'clock_in':
              staffUpdate = { active: true };
              break;
          case 'clock_out':
              staffUpdate = { active: false, onBreak: false, status: 'idle' };
              break;
          case 'break_start':
              staffUpdate = { onBreak: true, breakStartTime: now };
              break;
          case 'break_end':
              if(staffMember.breakStartTime) {
                  const duration = differenceInMinutes(parseISO(now), parseISO(staffMember.breakStartTime));
                  logEntry.durationMinutes = duration;
              }
              staffUpdate = { onBreak: false, breakStartTime: undefined };
              break;
      }
      
      addDocumentNonBlocking(activityLogsRef, logEntry);
      updateDocumentNonBlocking(staffDocRef, staffUpdate);
  }

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


        {(staff || []).length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {staffWithStats.map((member) => (
              <StaffStatusCard key={member.id} member={member} services={services || []} onViewDetails={handleViewDetails} onEdit={handleEditClick} onStatusChange={handleStatusChangeWithConfirmation} />
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
        services={services || []}
      />
      <EditStaffDialog 
        open={isEditStaffOpen} 
        onOpenChange={setIsEditStaffOpen} 
        onSave={handleUpdateStaff}
        staffMember={editingStaff}
        services={services || []}
      />
       <StaffDetailsSheet
        open={isDetailsSheetOpen}
        onOpenChange={setIsDetailsSheetOpen}
        staffMember={selectedStaffMember}
        transactions={transactionsForSelectedStaff}
        services={services || []}
        appointments={appointments || []}
        activityLogs={activityLogsForSelectedStaff}
      />
      
      {confirmation && (
          <AlertDialog open={confirmation.isOpen} onOpenChange={() => setConfirmation(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                    <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmation.onConfirm}>Confirm</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
      )}
    </div>
  );
}
