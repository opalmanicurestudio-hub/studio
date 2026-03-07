
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
import { 
  MoreHorizontal, 
  PlusCircle, 
  Users, 
  Calendar as CalendarIcon, 
  AlertTriangle, 
  Clock, 
  Coffee, 
  ShieldAlert, 
  Phone, 
  Mail, 
  Trash2, 
  KeyRound, 
  Loader, 
  RefreshCw,
  EyeOff,
  BarChart,
  Pencil
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';
import { type Staff, type Appointment, type Service, ActivityLog, type PricingTier } from '@/lib/data';
import { AddStaffDialog, type AddStaffFormData } from '@/components/staff/AddStaffDialog';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { nanoid } from 'nanoid';
import { Separator } from '@/components/ui/separator';
import { DateRange } from 'react-day-picker';
import { format, subDays, startOfDay, endOfDay, parseISO, isPast, differenceInDays, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { StaffDetailsSheet } from '@/components/staff/StaffDetailsSheet';
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, addDocumentNonBlocking, useCollection, useMemoFirebase, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, deleteField } from 'firebase/firestore';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { formatPhoneNumber } from 'react-phone-number-input';
import { useToast } from '@/hooks/use-toast';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Utility to safely convert potential strings, Timestamps or Date objects into valid Date instances.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

const StaffStatusCard = ({ member, onEdit, onStatusChange, onViewActivity, pricingTiers, onForceIdle, onDelete, canManage }: { member: Staff & { stats: any }, onEdit: (member: Staff) => void, onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void, onViewActivity: (member: Staff & { stats: any }) => void, pricingTiers: PricingTier[], onForceIdle: (id: string) => void, onDelete: (member: Staff) => void, canManage: boolean }) => {
    const [licenseInfo, setLicenseInfo] = useState<{
        isExpired: boolean;
        isExpiringSoon: boolean;
        daysUntilExpiry: number | null;
        expiryDate: Date | null;
    } | null>(null);

    useEffect(() => {
        if (!member.compliance?.licenseExpiry) return;
        const licenseExpiry = safeDate(member.compliance.licenseExpiry);
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
    
    const getInitials = (name?: string | null) => {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    const renderActionButtons = () => {
        if (!member.active) {
            return <Button className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg" onClick={() => onStatusChange(member.id, 'clock_in')}><Clock className="mr-2 h-4 w-4"/>Clock In</Button>
        }
        if (member.onBreak) {
            return <Button className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2" variant="outline" onClick={() => onStatusChange(member.id, 'break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>
        }
        return (
            <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" className="h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2" onClick={() => onStatusChange(member.id, 'break_start')}><Coffee className="mr-2 h-4 w-4"/>Start Break</Button>
                <Button variant="destructive" className="h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-destructive/20" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
            </div>
        )
    }

    return (
        <Card className={cn("text-center flex flex-col border-2 shadow-sm rounded-[2rem] overflow-hidden", !member.active && "opacity-60 grayscale-[0.5]")}>
            <CardHeader className="p-4 bg-muted/5 border-b">
                 <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Badge variant={member.active ? (member.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize font-black text-[9px] tracking-widest px-3 h-6 border-2", {
                            'bg-green-500 text-white border-none': member.active && !member.onBreak,
                            'bg-amber-500 text-white border-none': member.active && member.onBreak,
                        })}>
                            {member.active ? (member.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                        </Badge>
                        {member.showOnPublicPage === false && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="p-1 bg-muted rounded-full">
                                            <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Hidden from Public Booking</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/5 text-primary" onClick={() => onViewActivity(member)}>
                                        <BarChart className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Performance Activity</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/5 text-primary" onClick={() => onEdit(member)}>
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Modify Profile</TooltipContent>
                            </Tooltip>
                            {canManage && (
                                <>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-amber-50 text-amber-600" onClick={() => onForceIdle(member.id)}>
                                                <RefreshCw className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Force Idle</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-destructive/5 text-destructive" onClick={() => onDelete(member)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="font-black uppercase text-[10px] tracking-widest border-2">Terminate Profile</TooltipContent>
                                    </Tooltip>
                                </>
                            )}
                        </TooltipProvider>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6 flex-1 flex flex-col items-center">
                <Avatar className="w-24 h-24 mx-auto mb-4 border-4 border-background shadow-xl rounded-3xl">
                    <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" className="object-cover" />
                    <AvatarFallback className="font-black bg-primary/10 text-primary">{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">{member.name}</h3>
                <div className="flex items-center justify-center gap-2 mt-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{member.role}</p>
                    {member.pricingTierId && <Badge variant="secondary" className="h-5 px-2 text-[8px] font-black uppercase tracking-widest bg-primary/10 text-primary border-none">{pricingTiers.find(pt => pt.id === member.pricingTierId)?.name}</Badge>}
                </div>
                
                <Separator className="my-6" />
                
                <div className="w-full text-left space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center mb-2">Performance activity</p>
                    <div className="flex justify-between items-center"><span className="text-[10px] font-bold text-muted-foreground uppercase">Total Sales</span><span className="font-black text-sm text-slate-900 tracking-tighter font-mono">${member.stats.totalSales.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-[10px] font-bold text-muted-foreground uppercase">Tips Earned</span><span className="font-black text-sm text-green-600 tracking-tighter font-mono">${member.stats.tips.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center pt-2 border-t border-dashed border-border/50 font-black"><span className="text-[10px] uppercase text-primary">Est. Payout</span><span className="text-lg text-primary tracking-tighter font-mono">${member.stats.earnings.toFixed(2)}</span></div>
                </div>

                {licenseInfo && (licenseInfo.isExpired || licenseInfo.isExpiringSoon) && (
                    <div className={cn("mt-6 text-left p-4 rounded-2xl border-2 w-full flex items-start gap-3", licenseInfo.isExpired ? "bg-destructive/5 border-destructive/10 text-destructive" : "bg-amber-50 border-amber-100 text-amber-700")}>
                        <ShieldAlert className="h-5 w-5 shrink-0" />
                        <div className="space-y-0.5 min-w-0">
                            <p className="font-black uppercase tracking-tight text-[10px]">{licenseInfo.isExpired ? 'License Expired' : 'License Expiring'}</p>
                            <p className="text-[10px] font-medium leading-relaxed">
                                {licenseInfo.isExpired 
                                ? `Action required. Expired on ${format(licenseInfo.expiryDate!, 'MMM d')}.`
                                : `Renewal due. Expires in ${licenseInfo.daysUntilExpiry} days.`
                                }
                            </p>
                        </div>
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-4 border-t mt-auto flex flex-col gap-3 bg-muted/5">
                {renderActionButtons()}
                 <Button asChild variant="ghost" size="sm" className="text-[10px] font-black uppercase tracking-widest h-8 w-full hover:bg-primary/5 text-muted-foreground hover:text-primary">
                    <Link href={`/staff/${member.id}`}>Public Portfolio <MoreHorizontal className="ml-1 h-3 w-3" /></Link>
                </Button>
            </CardFooter>
        </Card>
    )
};


const PricingTierCard = ({
    onSave,
    onDelete,
    pricingTiers,
}: {
    onSave: (tiers: PricingTier[]) => void;
    onDelete: (tierId: string) => void;
    pricingTiers: PricingTier[];
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localTiers, setLocalTiers] = useState(pricingTiers);
    const [tierToDelete, setTierToDelete] = useState<PricingTier | null>(null);

    useEffect(() => {
        setLocalTiers(pricingTiers);
    }, [pricingTiers]);

    const handleTierChange = (index: number, field: 'name' | 'rank', value: string | number) => {
        const newTiers = [...localTiers];
        (newTiers[index] as any)[field] = value;
        setLocalTiers(newTiers);
    };

    const handleAddTier = () => {
        const newRank = localTiers.length > 0 ? Math.max(...localTiers.map(t => t.rank)) + 1 : 1;
        setLocalTiers([
            ...localTiers,
            { id: nanoid(), name: `New Tier ${localTiers.length + 1}`, rank: newRank }
        ]);
    };

    const handleDeleteClick = (tier: PricingTier) => {
        setTierToDelete(tier);
    }
    
    const confirmDeleteTier = () => {
        if (tierToDelete) {
            onDelete(tierToDelete.id);
            setLocalTiers(localTiers.filter(t => t.id !== tierToDelete.id));
            setTierToDelete(null);
        }
    }

    const handleSave = () => {
        onSave(localTiers);
        setIsEditing(false);
    };
    
    const handleCancel = () => {
        setLocalTiers(pricingTiers);
        setIsEditing(false);
    }

    return (
        <>
            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                <CardHeader className="bg-muted/5 border-b p-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <CardTitle className="text-sm font-black uppercase tracking-widest">Skill & Pricing Tiers</CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Studio expertise levels.</CardDescription>
                        </div>
                        {isEditing ? (
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button variant="outline" onClick={handleCancel} className="flex-1 h-9 rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</Button>
                                <Button onClick={handleSave} className="flex-1 h-9 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20">Save</Button>
                            </div>
                        ) : (
                            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border-2">Edit Tiers</Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                    {localTiers.sort((a,b) => a.rank - b.rank).map((tier, index) => (
                        <div key={tier.id} className="flex items-center gap-3">
                             <p className="text-[10px] font-black text-muted-foreground w-4">{index + 1}.</p>
                             <Input
                                value={tier.name}
                                onChange={(e) => handleTierChange(index, 'name', e.target.value)}
                                disabled={!isEditing}
                                className={cn(
                                    "h-11 rounded-xl font-bold uppercase tracking-tight border-2",
                                    !isEditing && "border-transparent bg-muted/20 px-4"
                                )}
                            />
                            {isEditing && (
                                <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-destructive hover:bg-destructive/5" onClick={() => handleDeleteClick(tier)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    ))}
                    {isEditing && (
                        <Button variant="outline" className="w-full h-12 rounded-xl border-dashed border-2 font-black uppercase text-[10px] tracking-widest mt-2" onClick={handleAddTier}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Experience Tier
                        </Button>
                    )}
                </CardContent>
            </Card>
            <AlertDialog open={!!tierToDelete} onOpenChange={() => setTierToDelete(null)}>
                <AlertDialogContent className="rounded-[3rem] border-4">
                    <AlertDialogHeader className="p-6 pb-0">
                        <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Confirm Deletion</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                            Tier: "{tierToDelete?.name}"
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="p-6">
                        <p className="text-sm font-medium text-slate-600 leading-relaxed">This will permanently delete the pricing tier. Staff members assigned to this tier will need to be reassigned to maintain accurate service pricing.</p>
                    </div>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={confirmDeleteTier} variant="destructive" className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-destructive/20">Delete Tier</Button>
                        <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};


export default function StaffPage() {
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [isEditStaffOpen, setIsEditStaffOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [selectedStaffMember, setSelectedStaffMember] = useState<(Staff & { stats: any }) | null>(null);
  const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
  const [authPin, setAuthPin] = useState('');
  const [pendingStatusAction, setPendingStatusAction] = useState<{ staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' } | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);

  const { firestore, user } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const canManage = role === 'owner' || role === 'admin';
  const { toast: uiToast } = useToast();
  
  const {
    services,
    transactions,
    appointments,
    activityLogs,
    stockCorrections,
    consentForms,
    inventory,
    isLoading,
  } = useInventory();
  
  const staffQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]);
  const pricingTiersQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/pricingTiers`) : null, [firestore, tenantId]);
  
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(pricingTiersQuery);

  useEffect(() => {
    setDateRange({ from: subDays(new Date(), 29), to: new Date() });
  }, []);

  const staffWithStats = useMemo(() => {
    if (!staff || !transactions || !appointments || !stockCorrections || !activityLogs || !services || !inventory) return [];
    
    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange?.to ? endOfDay(dateRange.to) : null;

    return staff.map(staffMember => {
        const filterByDate = (date: Date) => {
            const d = date;
            if (fromDate && d < fromDate) return false;
            if (toDate && d > toDate) return false;
            return true;
        };

        const staffAppointments = appointments.filter(apt => apt.staffId === staffMember.id && filterByDate(safeDate(apt.startTime)));
        const completedAppointments = staffAppointments.filter(apt => apt.status === 'completed');
        const completedAppointmentsCount = completedAppointments.length;
      
        let totalMinutesVariance = 0;
        let totalInServiceMinutes = 0;
        completedAppointments.forEach(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            if (apt.actualStartTime && apt.actualEndTime && service) {
                const actualDuration = differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime));
                totalMinutesVariance += actualDuration - service.duration;
                totalInServiceMinutes += actualDuration;
            } else if (service) {
                totalInServiceMinutes += service.duration;
            }
        });
        const avgVariance = completedAppointmentsCount > 0 ? totalMinutesVariance / completedAppointmentsCount : 0;


        const staffTransactions = transactions.filter(t => t.staffId === staffMember.id && filterByDate(safeDate(t.date)));
        
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


        const tips = staffTransactions.reduce((acc, t) => {
            if (t.category === 'Tips') return acc + t.amount;
            return acc + (t.tipAmount || 0);
        }, 0);

        let totalMinutesWorked = 0;
        const staffLogs = activityLogs.filter(log => log.staffId === staffMember.id && filterByDate(safeDate(log.timestamp)));
        const sortedLogs = staffLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        let clockInTime: Date | null = null;
        let totalBreakMinutes = 0;
        
        for (const log of sortedLogs) {
            const logTime = safeDate(log.timestamp);
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
                totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
                clockInTime = null;
            } else if (log.type === 'break_end' && log.durationMinutes) {
                totalBreakMinutes += log.durationMinutes;
            }
        }
        if(clockInTime) {
            const endOfRange = toDate && toDate < new Date() ? toDate : new Date();
            totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
        }

        const utilizationRate = totalMinutesWorked > 0 ? (totalInServiceMinutes / totalMinutesWorked) * 100 : 0;
        
        let earnings = 0;
        if (staffMember.payStructure === 'commission') {
            earnings = serviceRevenue * ((staffMember.commissionRate || 0) / 100);
        } else if (staffMember.payStructure === 'hourly' && staffMember.hourlyRate) {
            const hoursWorked = totalMinutesWorked / 60;
            earnings = hoursWorked * staffMember.hourlyRate;
        }
        
        const retailCommission = retailSales * ((staffMember.retailCommissionRate || 0) / 100);
        earnings += tips + retailCommission; 
        
        return {
            ...staffMember,
            stats: {
                totalServices: completedAppointmentsCount,
                avgActualServiceTime: 0, // Placeholder
                avgVariance,
                totalInServiceHours: totalInServiceMinutes / 60,
                utilizationRate,
                avgSalePerAppointment,
                retailAttachmentRate,
                earnings,
                totalSales,
                tips,
                totalHours: totalMinutesWorked / 60,
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

  const handleAddStaff = async (data: AddStaffFormData) => {
    if (!firestore || !tenantId || !user) return;

    const tempAppName = `temp-signup-app-${nanoid()}`;
    let tempApp: FirebaseApp | undefined;

    try {
      tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);

      const userCredential = await createUserWithEmailAndPassword(tempAuth, data.email, data.password);
      const newAuthUser = userCredential.user;
      
      const staffId = newAuthUser.uid;
      const { password, confirmPassword, ...staffDataForDb } = data;

      const fullStaffObject: Staff = {
        ...(staffDataForDb as Omit<AddStaffFormData, 'password' | 'confirmPassword'>),
        id: staffId,
        tenantId: tenantId,
        avatarUrl: data.avatarUrl || '',
        active: false,
        onBreak: false,
        status: 'idle',
        specialties: typeof data.specialties === 'string' ? data.specialties.split(',').map(s => s.trim()).filter(Boolean) : [],
        services: data.services || [],
        assignedFormIds: data.assignedFormIds || [],
        payStructure: data.payStructure || 'commission',
        commissionRate: data.commissionRate || 40,
        retailCommissionRate: data.retailCommissionRate || 10,
        hourlyRate: data.hourlyRate,
        pin: data.pin,
        showOnPublicPage: data.showOnPublicPage,
      };

      const sanitizedData = JSON.parse(JSON.stringify(fullStaffObject));

      const batch = writeBatch(firestore);
      const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
      const staffDirectoryRef = doc(firestore, 'staffDirectory', staffId);

      batch.set(staffDocRef, sanitizedData);
      batch.set(staffDirectoryRef, {
          tenantId: tenantId,
          role: sanitizedData.role
      });

      await batch.commit();
      
      uiToast({
        title: 'Staff Member Added',
        description: `${data.name} can now log in with their credentials.`,
      });
      
    } catch (error: any) {
      console.error("Error adding staff:", error);
      let description = 'An unexpected error occurred.';
      if (error.code === 'auth/email-already-in-use') {
        description = 'This email is already in use by another account.';
      }
      uiToast({ variant: 'destructive', title: 'Failed to Add Staff', description });
    } finally {
      if (tempApp) await deleteApp(tempApp);
    }
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
          case 'clock_in': staffUpdate = { active: true }; break;
          case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
          case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
          case 'break_end':
              if(staffMember.breakStartTime) {
                  const duration = differenceInMinutes(parseISO(now), parseISO(staffMember.breakStartTime));
                  logEntry.durationMinutes = duration;
              }
              staffUpdate = { onBreak: false, breakStartTime: deleteField() as any }; 
              break;
      }
      
      addDocumentNonBlocking(activityLogsRef, logEntry);
      setDocumentNonBlocking(staffDocRef, staffUpdate, { merge: true });
  };
  
  const handleStatusChangeWithAuth = (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
      setPendingStatusAction({ staffId, action });
      setIsPinAuthOpen(true);
  }

  const handleVerifyPin = () => {
    if (!pendingStatusAction || !staff) return;
    const targetStaff = staff.find(s => s.id === pendingStatusAction.staffId);
    
    if (targetStaff && targetStaff.pin === authPin) {
        handleStatusChange(pendingStatusAction.staffId, pendingStatusAction.action);
        setIsPinAuthOpen(false);
        setAuthPin('');
        setPendingStatusAction(null);
        uiToast({ title: "Authorized", description: "Status updated successfully." });
    } else {
        uiToast({ variant: "destructive", title: "Invalid PIN", description: "The PIN entered is incorrect." });
    }
  };

  const handleSaveTiers = (tiersToSave: PricingTier[]) => {
    if (!firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    tiersToSave.forEach(tier => {
        const tierRef = doc(firestore, `tenants/${tenantId}/pricingTiers`, tier.id);
        batch.set(tierRef, tier);
    });
    const tiersToSaveIds = new Set(tiersToSave.map(t => t.id));
    const originalTiers = pricingTiers || [];
    originalTiers.forEach(originalTier => {
        if (!tiersToSaveIds.has(originalTier.id)) {
            const tierRef = doc(firestore, `tenants/${tenantId}/pricingTiers`, originalTier.id);
            batch.delete(tierRef);
        }
    });
    batch.commit().then(() => { uiToast({ title: 'Pricing Tiers Saved!' }); }).catch((error) => { console.error("Error saving tiers:", error); uiToast({ variant: 'destructive', title: 'Error', description: 'Could not save pricing tiers.' }); });
  };
  
  const handleDeleteTier = (tierId: string) => {
    if (!firestore || !tenantId) return;
    const tierRef = doc(firestore, `tenants/${tenantId}/pricingTiers`, tierId);
    deleteDocumentNonBlocking(tierRef);
    uiToast({ title: 'Tier Deleted', variant: 'destructive' });
  };

  const handleForceIdle = (staffId: string) => {
    if (!firestore || !tenantId) return;
    const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
    setDocumentNonBlocking(staffRef, { status: 'idle' }, { merge: true });
    uiToast({ title: "Staff Reset", description: "Technician status has been forced to idle." });
  };

  const handleDeleteStaffClick = (member: Staff) => {
    setStaffToDelete(member);
  };

  const confirmDeleteStaff = async () => {
    if (!staffToDelete || !firestore || !tenantId) return;

    const batch = writeBatch(firestore);
    const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffToDelete.id);
    const directoryDocRef = doc(firestore, 'staffDirectory', staffToDelete.id);

    batch.delete(staffDocRef);
    batch.delete(directoryDocRef);

    try {
        await batch.commit();
        uiToast({ title: "Profile Deleted", description: `${staffToDelete.name} has been removed from the system.` });
    } catch (e) {
        console.error("Error deleting staff:", e);
        uiToast({ variant: 'destructive', title: "Error", description: "Failed to delete staff profile." });
    } finally {
        setStaffToDelete(null);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Staff Management" />
      <main className="flex-1 p-4 md:p-8">
        {isLoading || staffLoading || pricingTiersLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        ) : (
            <>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div className="space-y-1">
                    <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Your Team</h1>
                    <p className="text-sm text-muted-foreground font-black uppercase tracking-widest opacity-60">Add, edit, and manage your staff members.</p>
                </div>
                <Button onClick={() => setIsAddStaffOpen(true)} className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Staff Member
                </Button>
                </div>
                
                <div className="mb-8 p-4 bg-muted/30 rounded-[2rem] border-2 border-dashed border-border/50">
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="w-full space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Analyze From</Label>
                            <input 
                                type="date" 
                                value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''}
                                onChange={(e) => {
                                    const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                    setDateRange(prev => ({ from: d || prev?.from, to: prev?.to }));
                                }}
                                className="w-full h-12 rounded-2xl border-2 bg-background px-4 font-bold text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                            />
                        </div>
                        <div className="w-full space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Analyze To</Label>
                            <input 
                                type="date" 
                                value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''}
                                onChange={(e) => {
                                    const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                    setDateRange(prev => ({ from: prev?.from, to: d || prev?.to }));
                                }}
                                className="w-full h-12 rounded-2xl border-2 bg-background px-4 font-bold text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                            />
                        </div>
                    </div>
                </div>
                
                <div className="grid lg:grid-cols-3 gap-8 items-start">
                    <div className="lg:col-span-1 space-y-6">
                        <PricingTierCard 
                            pricingTiers={pricingTiers || []}
                            onSave={handleSaveTiers}
                            onDelete={handleDeleteTier}
                        />
                    </div>

                    <div className="lg:col-span-2">
                        {(staff || []).length > 0 ? (
                            <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
                                {staffWithStats.map((member) => (
                                <StaffStatusCard key={member.id} member={member} onViewActivity={handleViewActivity} onEdit={handleEditClick} onStatusChange={handleStatusChangeWithAuth} pricingTiers={pricingTiers || []} onForceIdle={handleForceIdle} onDelete={handleDeleteStaffClick} canManage={canManage} />
                                ))}
                            </div>
                            ) : (
                            <Card className="border-4 border-dashed rounded-[3rem] opacity-40">
                                <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
                                    <Users className="w-16 h-16 mb-4"/>
                                <h3 className="text-xl font-black uppercase tracking-widest">No staff members yet</h3>
                                <p className="mb-4 font-bold text-xs uppercase opacity-60">Click the button to add your first team member.</p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </>
        )}
      </main>
      <AddStaffDialog 
        open={isAddStaffOpen} 
        onOpenChange={setIsAddStaffOpen} 
        onSave={handleAddStaff}
        services={services || []}
        consentForms={consentForms || []}
        pricingTiers={pricingTiers || []}
        existingStaff={staff || []}
      />
      <EditStaffDialog 
        open={isEditStaffOpen} 
        onOpenChange={setIsEditStaffOpen} 
        onSave={handleUpdateStaff}
        staffMember={editingStaff}
        services={services || []}
        consentForms={consentForms || []}
        pricingTiers={pricingTiers || []}
        existingStaff={staff || []}
      />
       {selectedStaffMember && (
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
       )}
      
      <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4">
            <DialogHeader className="p-6 pb-0">
                <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter">
                    <KeyRound className="w-6 h-6 text-primary" />
                    Security Verify
                </DialogTitle>
                <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                    Authorize status transition with your unique 4-digit PIN.
                </DialogDescription>
            </DialogHeader>
            <div className="py-10 flex flex-col items-center space-y-6">
                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Verification PIN</Label>
                <div className="relative w-48">
                    <Input 
                        type="password" 
                        maxLength={4} 
                        className="text-center text-4xl font-black h-20 tracking-[0.5em] bg-muted/30 border-4 rounded-3xl focus-visible:ring-primary/20" 
                        value={authPin} 
                        onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                    />
                </div>
            </div>
            <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
                <Button onClick={handleVerifyPin} disabled={authPin.length < 4} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/20">Verify & Confirm</Button>
                <Button variant="ghost" onClick={() => setIsPinAuthOpen(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!staffToDelete} onOpenChange={() => setStaffToDelete(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
            <AlertDialogHeader className="p-6 pb-0">
                <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Profile</AlertDialogTitle>
                <AlertDialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                    Target: <strong>{staffToDelete?.name}</strong>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="p-6">
                <p className="text-sm font-medium text-slate-600 leading-relaxed">This will permanently delete the staff profile and directory entry. The associated authentication account will remain, but they will be prohibited from all studio access. <strong>This action is non-reversible.</strong></p>
            </div>
            <AlertDialogFooter className="p-6 pt-0 flex flex-col gap-3">
                <Button onClick={confirmDeleteStaff} variant="destructive" className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Purge Record</Button>
                <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
