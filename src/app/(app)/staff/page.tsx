

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
import { Button, buttonVariants } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Users, Calendar as CalendarIcon, FlaskConical, AlertTriangle, List, TrendingUp, DollarSign, BarChart, Clock, Play, Square, Coffee, ShieldAlert, Phone, Mail } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';
import { type Staff, type Appointment, type Service, type Transaction, ActivityLog, ConsentForm } from '@/lib/data';
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
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
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
} from "@/components/ui/alert-dialog"
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { formatPhoneNumber } from 'react-phone-number-input';

const StaffStatusCard = ({ member, onEdit, onStatusChange, onViewActivity }: { member: Staff & { stats: any }, onEdit: (member: Staff) => void, onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void, onViewActivity: (member: Staff & { stats: any }) => void }) => {
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
            <div className="grid grid-cols-2 gap-2 w-full">
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
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex-1 flex flex-col items-center">
                <Avatar className="w-24 h-24 mx-auto mb-4">
                    <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" />
                    <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold">{member.name}</h3>
                <div className="flex items-center justify-center gap-2">
                    <p className="text-sm text-muted-foreground capitalize">{member.role}</p>
                    {member.skillLevel && <Badge variant="outline" className="capitalize">{member.skillLevel}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-2 space-y-1 text-center">
                    {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center justify-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                            <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{member.email}</span>
                        </a>
                    )}
                    {member.phone && (
                        <a href={`tel:${member.phone}`} className="flex items-center justify-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{formatPhoneNumber(member.phone)}</span>
                        </a>
                    )}
                </div>
                <Separator className="my-4" />
                <div className="w-full text-left space-y-3 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Total Sales</span><span className="font-semibold">${member.stats.totalSales.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Tips</span><span className="font-semibold">${member.stats.tips.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Consumption</span><span className="font-semibold">${member.stats.consumptionValue.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center font-bold"><span className="text-primary">Est. Take-home</span><span className="text-primary">${member.stats.earnings.toFixed(2)}</span></div>
                </div>

                {licenseInfo && (licenseInfo.isExpired || licenseInfo.isExpiringSoon) && (
                    <div className="mt-4 text-left p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                        <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
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
            <CardFooter className="p-2 border-t mt-auto flex flex-col gap-2">
                {renderActionButtons()}
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="secondary" size="sm" onClick={() => onViewActivity(member)}>
                        Dashboard
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onEdit(member)}>
                        Edit Profile
                    </Button>
                </div>
                 <Button asChild variant="link" size="sm" className="text-xs h-auto py-1 w-full">
                    <Link href={`/staff/${member.id}`}>View Public Profile</Link>
                </Button>
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
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const {
      staff,
      services,
      transactions: rawTransactions,
      appointments: rawAppointments,
      activityLogs: rawActivityLogs,
      stockCorrections,
      consentForms,
      inventory,
      isLoading,
  } = useInventory();

  // Normalize all date-like fields into Date objects
  const transactions = useMemo(() => {
    if (!rawTransactions) return [];
    return rawTransactions.map(t => ({...t, date: (t.date as any)?.toDate ? (t.date as any).toDate() : parseISO(t.date as any) }));
  }, [rawTransactions]);

  const appointments = useMemo(() => {
    if (!rawAppointments) return [];
    return rawAppointments.map(apt => ({
      ...apt,
      startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
      endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
      actualStartTime: apt.actualStartTime ? ((apt.actualStartTime as any)?.toDate ? (apt.actualStartTime as any).toDate() : parseISO(apt.actualStartTime)) : undefined,
      actualEndTime: apt.actualEndTime ? ((apt.actualEndTime as any)?.toDate ? (apt.actualEndTime as any).toDate() : parseISO(apt.actualEndTime)) : undefined,
    }));
  }, [rawAppointments]);

  const activityLogs = useMemo(() => {
    if (!rawActivityLogs) return [];
    return rawActivityLogs.map(log => ({...log, timestamp: (log.timestamp as any)?.toDate ? (log.timestamp as any).toDate() : parseISO(log.timestamp)}));
  }, [rawActivityLogs]);


  useEffect(() => {
    setDateRange({ from: subDays(new Date(), 29), to: new Date() });
  }, []);

  const staffWithStats = useMemo(() => {
    if (!staff || !transactions || !appointments || !stockCorrections || !activityLogs || !services || !inventory) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(member => {
        const filterByDate = (date: Date) => {
            if (fromDate && date < fromDate) return false;
            if (toDate && date > toDate) return false;
            return true;
        };

        const staffAppointments = appointments.filter(apt => apt.staffId === member.id && filterByDate(apt.startTime));
        const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
        const completedAppointmentsCount = completedAppointments.length;
        
        let totalMinutesVariance = 0;
        let totalInServiceMinutes = 0;
        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (apt.actualStartTime && apt.actualEndTime && service) {
                const actualDuration = differenceInMinutes(apt.actualEndTime, apt.actualStartTime);
                totalMinutesVariance += actualDuration - service.duration;
                totalInServiceMinutes += actualDuration;
            } else if (service) {
                totalInServiceMinutes += service.duration;
            }
        });
        const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;


        const staffTransactions = transactions.filter(t => t.staffId === member.id && filterByDate(t.date));
        
        const serviceRevenue = staffTransactions
            .filter(t => t.category === 'Service Revenue')
            .reduce((acc, t) => acc + t.amount, 0);

        const retailSales = staffTransactions
            .filter(t => t.category === 'Retail')
            .reduce((acc, t) => acc + t.amount, 0);
        
        const totalSales = serviceRevenue + retailSales;
        const avgSalePerAppointment = completedAppointmentsCount > 0 ? totalSales / completedAppointmentsCount : 0;

        const retailTransactionsWithAppointment = staffTransactions.filter(t => t.category === 'Retail' && t.appointmentId);
        const retailAttachmentRate = completedAppointmentsCount > 0 ? (new Set(retailTransactionsWithAppointment.map(t => t.appointmentId)).size / completedAppointmentsCount) * 100 : 0;


        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);

        let totalMinutesWorked = 0;
        const staffLogs = activityLogs.filter(log => log.staffId === member.id && filterByDate(log.timestamp));
        const sortedLogs = staffLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        
        for (const log of sortedLogs) {
            const logTime = log.timestamp;
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
            } else if (log.type === 'break_end' && log.durationMinutes) {
                totalBreakMinutes += log.durationMinutes;
            }
        }
        if(clockInTime) {
            const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
            totalMinutesWorked += differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes;
        }

        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        
        let earnings = 0;
        if (member.payStructure === 'commission') {
            earnings = serviceRevenue * ((member.commissionRate || 0) / 100);
        } else if (member.payStructure === 'hourly' && member.hourlyRate) {
            const hoursWorked = totalMinutesWorked / 60;
            earnings = hoursWorked * member.hourlyRate;
        }
        
        const retailCommission = retailSales * ((member.retailCommissionRate || 0) / 100);
        earnings += tips + retailCommission; 
        
        let consumptionValue = 0;
        const staffAppointmentIds = new Set(
            completedAppointments.map(a => a.id)
        );

        stockCorrections.forEach(sc => {
            if (!sc.reason) return;
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
                totalHours: totalMinutesWorked / 60,
                utilizationRate,
                avgSalePerAppointment,
                retailAttachmentRate,
                avgVariance,
            }
        };
    });
  }, [staff, transactions, dateRange, appointments, stockCorrections, inventory, activityLogs, services]);


  const handleViewActivity = (member: Staff & { stats: any }) => {
    setSelectedStaffMember(member);
    setIsDetailsSheetOpen(true);
  };
  
  const handleEditClick = (member: Staff) => {
    setEditingStaff(member);
    setIsEditStaffOpen(true);
  };

  const handleAddStaff = (newStaffData: Omit<Staff, 'id' | 'avatarUrl'>) => {
    if (!firestore || !tenantId) return;

    const fullStaffObject: Omit<Staff, 'id' | 'avatarUrl'> & { id: string, avatarUrl: string, tenantId: string, active: boolean, onBreak: boolean } = {
      ...newStaffData,
      id: `staff-${nanoid()}`,
      tenantId: tenantId,
      avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
      active: false,
      onBreak: false,
    };
    
    const sanitizedData = JSON.parse(JSON.stringify(fullStaffObject));

    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', fullStaffObject.id);
    setDocumentNonBlocking(staffDocRef, sanitizedData, {});
  };

  const handleUpdateStaff = (updatedStaffData: Staff) => {
    if (!firestore || !tenantId) return;
    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', updatedStaffData.id);
    const sanitizedData = JSON.parse(JSON.stringify(updatedStaffData));
    updateDocumentNonBlocking(staffDocRef, sanitizedData);
  };
  
  const handleStatusChange = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
      if (!firestore || !staff || !tenantId) return;

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
                  const duration = differenceInMinutes(new Date(now), parseISO(staffMember.breakStartTime));
                  logEntry.durationMinutes = duration;
              }
              staffUpdate = { onBreak: false, breakStartTime: undefined }; 
              break;
      }
      
      addDocumentNonBlocking(activityLogsRef, logEntry);
      updateDocumentNonBlocking(staffDocRef, staffUpdate);
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
                            {format(dateRange.from, "LLL dd, yyyy")} -{" "}
                            {format(dateRange.to, "LLL dd, yyyy")}
                            </>
                        ) : (
                            format(dateRange.from, "LLL dd, yyyy")
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
              <StaffStatusCard key={member.id} member={member} onViewActivity={handleViewActivity} onEdit={handleEditClick} onStatusChange={handleStatusChangeWithConfirmation} />
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
        consentForms={consentForms || []}
      />
      <EditStaffDialog 
        open={isEditStaffOpen} 
        onOpenChange={setIsEditStaffOpen} 
        onSave={handleUpdateStaff}
        staffMember={editingStaff}
        services={services || []}
        consentForms={consentForms || []}
      />
       <StaffDetailsSheet
        open={isDetailsSheetOpen}
        onOpenChange={setIsDetailsSheetOpen}
        staffMember={selectedStaffMember}
        dateRange={dateRange}
        transactions={transactions || []}
        services={services || []}
        appointments={appointments || []}
        activityLogs={activityLogs || []}
        consentForms={consentForms || []}
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
