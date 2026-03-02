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
  RefreshCcw 
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
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

const StaffStatusCard = ({ member, onEdit, onStatusChange, onViewActivity, pricingTiers, onForceIdle, canManage }: { member: Staff & { stats: any }, onEdit: (member: Staff) => void, onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void, onViewActivity: (member: Staff & { stats: any }) => void, pricingTiers: PricingTier[], onForceIdle: (id: string) => void, canManage: boolean }) => {
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
    
    const getInitials = (name: string) => {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

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
                        'bg-yellow-100 text-yellow-800 dark:bg-green-900/50': member.active && member.onBreak,
                    })}>
                        {member.active ? (member.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-1">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onViewActivity(member)}>Dashboard</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEdit(member)}>Edit Profile</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {canManage && (
                                <DropdownMenuItem onClick={() => onForceIdle(member.id)} className="text-amber-600">
                                    <RefreshCcw className="w-4 h-4 mr-2" />
                                    Force Idle
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex-1 flex flex-col items-center">
                <Avatar className="w-24 h-24 mx-auto mb-4">
                    <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" className="object-cover" />
                    <AvatarFallback>{getInitials(member.name || '')}</AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold">{member.name}</h3>
                <div className="flex items-center justify-center gap-2">
                    <p className="text-sm text-muted-foreground capitalize">{member.role}</p>
                    {member.pricingTierId && <Badge variant="outline" className="capitalize">{pricingTiers.find(pt => pt.id === member.pricingTierId)?.name}</Badge>}
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
                 <Button asChild variant="link" size="sm" className="text-xs h-auto py-1 w-full">
                    <Link href={`/staff/${member.id}`}>View Public Profile</Link>
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
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <CardTitle>Pricing Tiers</CardTitle>
                            <CardDescription>Define the pricing levels for your staff.</CardDescription>
                        </div>
                        {isEditing ? (
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button variant="outline" onClick={handleCancel} className="flex-1">Cancel</Button>
                                <Button onClick={handleSave} className="flex-1">Save Tiers</Button>
                            </div>
                        ) : (
                            <Button onClick={() => setIsEditing(true)}>Edit Tiers</Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {localTiers.sort((a,b) => a.rank - b.rank).map((tier, index) => (
                        <div key={tier.id} className="flex items-center gap-2">
                             {isEditing && <p className="text-muted-foreground font-bold">{index + 1}.</p>}
                             <Input
                                value={tier.name}
                                onChange={(e) => handleTierChange(index, 'name', e.target.value)}
                                disabled={!isEditing}
                                className={cn(!isEditing && "border-none text-base font-medium p-0 h-auto focus-visible:ring-0")}
                            />
                            {isEditing && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteClick(tier)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    ))}
                    {isEditing && (
                        <Button variant="outline" className="w-full border-dashed" onClick={handleAddTier}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Tier
                        </Button>
                    )}
                </CardContent>
            </Card>
            <AlertDialog open={!!tierToDelete} onOpenChange={() => setTierToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the &quot;{tierToDelete?.name}&quot; tier. Staff members assigned to this tier will need to be reassigned. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDeleteTier} className={buttonVariants({ variant: "destructive" })}>Delete Tier</AlertDialogAction>
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


        const tips = staffTransactions.reduce((acc, t) => acc + (t.tipAmount || 0), 0);

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
        
        let consumptionValue = 0;
        const staffAppointmentIds = new Set(
            completedAppointments.map(a => a.id)
        );

        stockCorrections.forEach(sc => {
            if (!sc.reason) return;
            const match = sc.reason.match(/#([A-Z0-9]{6})/);
            if (match && staffAppointmentIds.has(match[1])) {
                const product = inventory.find(p => p.id === sc.productId);
                if (product && product.costPerUnit) {
                    let costPerUse = 0;
                    if (product.costingMethod === 'size' && product.size && product.size > 0) {
                        costPerUse = product.costPerUnit / product.size;
                    } else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) {
                        costPerUse = product.costPerUnit / product.estimatedUses;
                    } else if (!product.costingMethod) {
                        costPerUse = product.costPerUnit;
                    }
                    consumptionValue += Math.abs(sc.change) * costPerUse;
                }
            }
        });

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

  const isLoadingTotal = staffLoading || pricingTiersLoading || isLoading;

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Staff Management" />
      <main className="flex-1 p-4 md:p-8">
        {isLoadingTotal ? (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        ) : (
            <>
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
                                <StaffStatusCard key={member.id} member={member} onViewActivity={handleViewActivity} onEdit={handleEditClick} onStatusChange={handleStatusChangeWithAuth} pricingTiers={pricingTiers || []} onForceIdle={handleForceIdle} canManage={canManage} />
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
      
      <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-primary" />
                    Authorize Action
                </DialogTitle>
                <DialogDescription>
                    Enter your unique 4-digit PIN to verify this status change.
                </DialogDescription>
            </DialogHeader>
            <div className="py-6 flex flex-col items-center space-y-4">
                <Label className="text-sm font-black uppercase tracking-widest text-muted-foreground">Verification PIN</Label>
                <div className="relative w-48">
                    <Input 
                        type="password" 
                        maxLength={4} 
                        className="text-center text-3xl font-black h-16 tracking-[0.5em] bg-muted/50 border-2" 
                        value={authPin} 
                        onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsPinAuthOpen(false)}>Cancel</Button>
                <Button onClick={handleVerifyPin} disabled={authPin.length < 4}>Verify & Confirm</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
