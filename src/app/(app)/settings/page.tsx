'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign, Save, ListChecks, MessageSquare, Clock, Building, Edit, PlusCircle, MoreHorizontal, Globe, Check, LinkIcon, Calendar, Loader, FilePen, X, User, Briefcase, ListIcon, PercentIcon, FileText, Trash2, ChevronDown, Award, Percent, ShieldAlert, Ban, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where, updateDoc } from 'firebase/firestore';
import { type Tenant, type PricingTier } from '@/lib/data';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
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
import { buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';


const DayScheduleRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const hour = Math.floor(i / 2);
    const minute = i % 2 === 0 ? '00' : '30';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:${minute} ${period}`;
  });

  return (
    <div className="flex items-center gap-4 p-4 border-b last:border-b-0">
      <div className="flex items-center gap-3 w-32">
        <Switch
          id={`switch-${day}`}
          checked={dayData.enabled}
          onCheckedChange={(checked) => onDayChange('enabled', checked)}
          disabled={!isEditing}
        />
        <Label htmlFor={`switch-${day}`} className="font-semibold text-base capitalize">{day}</Label>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4">
        <Select
          value={dayData.start}
          onValueChange={(value) => onDayChange('start', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-start-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={dayData.end}
          onValueChange={(value) => onDayChange('end', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-end-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};


export default function SettingsPage() {
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { tenants, selectedTenant, setSelectedTenant, isLoading: isTenantContextLoading } = useTenant();
  const isMobile = useIsMobile();
  const tenantId = selectedTenant?.id;

  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [tempTenantName, setTempTenantName] = useState('');
  
  const handleUpdateBusinessName = async (tenantId: string, newName: string) => {
    if (!firestore || !newName.trim()) {
        toast({ variant: 'destructive', title: "Name cannot be empty" });
        return;
    }

    const tenantRef = doc(firestore, 'tenants', tenantId);
    try {
      updateDocumentNonBlocking(tenantRef, { name: newName.trim() });
      toast({ title: "Business Name Updated" });
      setEditingTenantId(null);
    } catch (error) {
      console.error("Error updating business name:", error);
      toast({ variant: 'destructive', title: "Update Failed" });
    }
  };
  
    const handleDeleteTenantClick = (tenant: Tenant) => {
        if (tenants.length <= 1) {
            toast({
                variant: "destructive",
                title: "Cannot Delete",
                description: "You cannot delete your only business location.",
            });
            return;
        }
        if (tenant.id === selectedTenant?.id) {
            toast({
                variant: "destructive",
                title: "Cannot Delete Active Location",
                description: "Please switch to a different location before deleting this one.",
            });
            return;
        }
        setTenantToDelete(tenant);
    };

    const confirmDeleteTenant = async () => {
        if (!tenantToDelete || !firestore) return;

        const tenantRef = doc(firestore, 'tenants', tenantToDelete.id);
        await deleteDocumentNonBlocking(tenantRef);
        
        toast({
            title: "Location Deleted",
            description: `"${tenantToDelete.name}" has been successfully deleted.`
        });

        setTenantToDelete(null);
    };

  const handleCreateNewLocation = () => {
    if (!firestore || !user) return;
    const newTenantId = nanoid();
    const newTenantData: Omit<Tenant, 'id'> = {
      name: `New Business #${(tenants?.length || 0) + 1}`,
      userId: user.uid,
      subscriptionStatus: "active",
      subscriptionTier: "pro",
    };
    const newTenantRef = doc(firestore, 'tenants', newTenantId);
    setDocumentNonBlocking(newTenantRef, { ...newTenantData, id: newTenantId }, {});
    toast({
      title: 'New Location Created!',
      description: 'You can switch to it from the header dropdown.',
    });
  };

  // Editing states for each card
  const [isScheduleEditing, setIsScheduleEditing] = useState(false);
  const [isPoliciesEditing, setIsPoliciesEditing] = useState(false);
  const [isQueueEditing, setIsQueueEditing] = useState(false);
  const [isSmsEditing, setIsSmsEditing] = useState(false);

  // Data states
  const [tenantData, setTenantData] = useState<Partial<Tenant>>({});
  const [scheduleProfiles, setScheduleProfiles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('profile');

  // Backup states for cancellation
  const [backupTenantData, setBackupTenantData] = useState<Partial<Tenant>>({});
  const [backupScheduleProfiles, setBackupScheduleProfiles] = useState<any[]>([]);

  const scheduleProfilesQuery = useMemoFirebase(() => {
    if (!selectedTenant || !firestore) return null;
    return collection(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`);
  }, [selectedTenant, firestore]);
  const { data: initialScheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);

  useEffect(() => {
    if (selectedTenant) {
      setTenantData(selectedTenant);
    }
  }, [selectedTenant]);

  useEffect(() => {
    if (initialScheduleProfiles) {
      setScheduleProfiles(initialScheduleProfiles);
    }
  }, [initialScheduleProfiles]);
  
  useEffect(() => {
      if (scheduleProfilesLoading || !firestore || !user || !tenantId) return;

      if (initialScheduleProfiles && initialScheduleProfiles.length === 0) {
          const defaultProfileId = nanoid();
          const defaultProfile = {
              id: defaultProfileId,
              name: 'Default Schedule',
              isActive: true,
              isPublic: true,
              bookingSlotInterval: 15,
              week: {
                  sunday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
                  monday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                  tuesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                  wednesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                  thursday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                  friday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                  saturday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
              },
              timeOff: {
                  vacationDays: 10,
                  holidays: 8,
              }
          };
          const profileDocRef = doc(firestore, `tenants/${tenantId}/scheduleProfiles/${defaultProfileId}`);
          setDocumentNonBlocking(profileDocRef, defaultProfile, {});
      } else if (initialScheduleProfiles && initialScheduleProfiles.length > 0) {
          const hasActiveProfile = initialScheduleProfiles.some(p => p.isActive);
          if (!hasActiveProfile) {
              const firstProfile = initialScheduleProfiles[0];
              const profileDocRef = doc(firestore, `tenants/${tenantId}/scheduleProfiles/${firstProfile.id}`);
              updateDocumentNonBlocking(profileDocRef, { isActive: true });
          }
      }
  }, [scheduleProfilesLoading, initialScheduleProfiles, firestore, user, tenantId]);

  const orderedDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const activeScheduleProfile = useMemo(() => scheduleProfiles.find(p => p.isActive), [scheduleProfiles]);

  const handleDayChange = useCallback((day: string, field: string, value: any) => {
    setScheduleProfiles((prev: any[]) =>
      prev.map(p =>
        p.isActive ? {
          ...p,
          week: {
            ...p.week,
            [day]: { ...p.week[day as keyof typeof p.week], [field]: value }
          }
        } : p
      )
    );
  }, [setScheduleProfiles]);

  const handleTimeOffChange = useCallback((field: string, value: number) => {
    setScheduleProfiles((prev: any[]) =>
      prev.map(p =>
        p.isActive ? {
          ...p,
          timeOff: { ...p.timeOff, [field]: value }
        } : p
      )
    );
  }, [setScheduleProfiles]);

  const handleBookingIntervalChange = useCallback((value: string) => {
    const interval = parseInt(value, 10);
    setScheduleProfiles((prev: any[]) =>
      prev.map(p =>
        p.isActive ? {
          ...p,
          bookingSlotInterval: interval
        } : p
      )
    );
  }, [setScheduleProfiles]);

  // --- Handlers for Schedule Card ---
  const handleScheduleEdit = () => {
    setBackupScheduleProfiles(JSON.parse(JSON.stringify(scheduleProfiles)));
    setIsScheduleEditing(true);
  };

  const handleScheduleCancel = () => {
    setScheduleProfiles(backupScheduleProfiles);
    setIsScheduleEditing(false);
  };

  const handleScheduleSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
      const batch = writeBatch(firestore);
      scheduleProfiles.forEach(profile => {
        const profileRef = doc(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`, profile.id);
        const { id, ...profileData } = profile;
        batch.update(profileRef, profileData);
      });
      await batch.commit();
      toast({ title: "Schedule Saved!" });
      setIsScheduleEditing(false);
    } catch (e) {
      console.error("Error saving schedule:", e);
      toast({ variant: "destructive", title: "Error", description: "Could not save schedule settings." });
    }
  };

  const createGenericHandlers = (
    isEditing: boolean,
    setIsEditing: React.Dispatch<React.SetStateAction<boolean>>,
    data: Partial<Tenant>,
    setData: React.Dispatch<React.SetStateAction<Partial<Tenant>>>,
    backupData: Partial<Tenant>,
    setBackupData: React.Dispatch<React.SetStateAction<Partial<Tenant>>>,
    fieldsToSave: (keyof Tenant)[]
  ) => {
    const handleEdit = () => {
      setBackupData(data);
      setIsEditing(true);
    };
    const handleCancel = () => {
      setData(backupData);
      setIsEditing(false);
    };
    const handleSave = async () => {
      if (!selectedTenant || !firestore) return;
      const dataToUpdate: Partial<Tenant> = {};
      fieldsToSave.forEach(field => {
        dataToUpdate[field] = data[field] as any;
      });
      try {
        const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
        updateDocumentNonBlocking(tenantRef, dataToUpdate);
        toast({ title: 'Settings Saved!' });
        setIsEditing(false);
      } catch (error) {
        console.error("Save error:", error);
        toast({ variant: 'destructive', title: 'Save Failed' });
      }
    };
    return { handleEdit, handleCancel, handleSave };
  };

  const policiesFields: (keyof Tenant)[] = ['lateArrivalGracePeriod', 'cancellationWindowHours', 'cancellationFee', 'noShowFee', 'autoCancelLateArrivals', 'allowDiscountStacking', 'cancellationPolicy', 'lateArrivalPolicy', 'noShowPolicy'];
  const queueFields: (keyof Tenant)[] = ['queueSkipTimeMinutes'];
  const smsFields: (keyof Tenant)[] = ['smsNotificationMessage', 'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber'];

  const { handleEdit: handlePoliciesEdit, handleCancel: handlePoliciesCancel, handleSave: handlePoliciesSave } = createGenericHandlers(isPoliciesEditing, setIsPoliciesEditing, tenantData, setTenantData, backupTenantData, setBackupTenantData, policiesFields);
  const { handleEdit: handleQueueEdit, handleCancel: handleQueueCancel, handleSave: handleQueueSave } = createGenericHandlers(isQueueEditing, setIsQueueEditing, tenantData, setTenantData, backupTenantData, setBackupTenantData, queueFields);
  const { handleEdit: handleSmsEdit, handleCancel: handleSmsCancel, handleSave: handleSmsSave } = createGenericHandlers(isSmsEditing, setIsSmsEditing, tenantData, setTenantData, backupTenantData, setBackupTenantData, smsFields);
  
  const generatePolicy = (type: 'cancellation' | 'noShow' | 'late') => {
    let policy = '';
    const fee = type === 'cancellation' ? tenantData.cancellationFee : tenantData.noShowFee;
    const window = tenantData.cancellationWindowHours;
    const grace = tenantData.lateArrivalGracePeriod;

    switch (type) {
        case 'cancellation':
            if (window != null && fee != null) {
                policy = `Cancellations made within ${window} hours of the scheduled appointment time will be subject to a fee of $${fee?.toFixed(2)}.`;
            }
            break;
        case 'noShow':
            if (fee != null) {
                policy = `Failure to show up for a scheduled appointment without notice will result in a no-show fee of $${fee?.toFixed(2)}.`;
            }
            break;
        case 'late':
            if (grace != null) {
                policy = `We offer a grace period of ${grace} minutes. Arriving later than this may require rescheduling and could be considered a no-show.`;
            }
            break;
    }
    return policy;
  }

  const isLoading = isTenantContextLoading || (selectedTenant && (scheduleProfilesLoading));
  
  const tabs = [
    { value: "profile", label: "Profile", icon: <Building /> },
    { value: "hours", label: "Hours", icon: <Clock /> },
    { value: "policies", label: "Policies", icon: <FileText /> },
    { value: "queue", label: "Queue", icon: <ListChecks /> },
    { value: "messaging", label: "Messaging", icon: <MessageSquare /> },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Settings" />
        <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
            <Loader className="w-8 h-8 animate-spin" />
        </main>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Settings" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold">Business Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage your application-wide settings and configurations.
            </p>
          </div>
          
           <Tabs defaultValue="profile" value={activeTab} onValueChange={setActiveTab} className="w-full">
             <div className="md:hidden">
              <Select onValueChange={setActiveTab} value={activeTab}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {tabs.map(tab => (
                    <SelectItem key={tab.value} value={tab.value}>
                        <div className="flex items-center gap-2">
                           {React.cloneElement(tab.icon, { className: "w-4 h-4" })}
                           <span>{tab.label}</span>
                        </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
             </div>
             <div className="hidden md:block">
                <ScrollArea>
                    <TabsList>
                        {tabs.map(tab => (
                        <TabsTrigger key={tab.value} value={tab.value}>
                            {React.cloneElement(tab.icon, { className: "w-4 h-4 mr-2" })}
                            {tab.label}
                        </TabsTrigger>
                        ))}
                    </TabsList>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
             </div>
            <TabsContent value="profile" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Building className="w-5 h-5 text-primary"/>Business Profile</CardTitle>
                        <CardDescription>Manage your business locations and branding.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {tenants.map(tenant => (
                            <div key={tenant.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                                {editingTenantId === tenant.id ? (
                                    <div className="flex-1 flex items-center gap-2">
                                        <Input
                                            value={tempTenantName}
                                            onChange={(e) => setTempTenantName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleUpdateBusinessName(tenant.id, tempTenantName)}
                                            autoFocus
                                        />
                                        <Button size="icon" className="h-9 w-9" onClick={() => handleUpdateBusinessName(tenant.id, tempTenantName)}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setEditingTenantId(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="font-medium">{tenant.name}</p>
                                        <div className="flex items-center gap-2">
                                            {tenant.id === selectedTenant?.id && <Badge>Active</Badge>}
                                            <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end">
                                                  <DropdownMenuItem onClick={() => { setEditingTenantId(tenant.id); setTempTenantName(tenant.name); }}>
                                                    <Edit className="w-4 h-4 mr-2" /> Rename
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteTenantClick(tenant)} disabled={tenants.length <= 1 || tenant.id === selectedTenant?.id}>
                                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                                  </DropdownMenuItem>
                                              </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                        <Button variant="outline" className="w-full" onClick={handleCreateNewLocation}><PlusCircle className="w-4 h-4 mr-2"/>Create New Location</Button>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="hours" className="mt-6">
                 <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="w-5 h-5 text-primary" />
                                Business Hours &amp; Availability
                            </CardTitle>
                            <CardDescription>
                                Set your schedules for financial calculations and public booking pages.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                        {isScheduleEditing ? (
                            <>
                                <Button variant="outline" onClick={handleScheduleCancel} className="flex-1 sm:w-auto">Cancel</Button>
                                <Button onClick={handleScheduleSave} className="flex-1 sm:w-auto"><Save className="mr-2 h-4 w-4" />Save</Button>
                            </>
                        ) : (
                            <Button onClick={handleScheduleEdit} className="w-full sm:w-auto"><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                    {activeScheduleProfile && (
                        <div>
                            {orderedDays.map((day) => {
                                const dayData = activeScheduleProfile.week[day];
                                if (!dayData) return null;
                                return (
                                    <DayScheduleRow 
                                        key={day} 
                                        day={day} 
                                        dayData={dayData} 
                                        onDayChange={(field: string, value: any) => handleDayChange(day, field, value)}
                                        isEditing={isScheduleEditing} 
                                    />
                                )
                            })}
                        </div>
                    )}
                    </CardContent>
                    {activeScheduleProfile && (
                        <CardFooter className="pt-6 grid md:grid-cols-3 gap-6">
                            <div className="space-y-2">
                                <Label>Vacation Days / Year</Label>
                                <Input 
                                    type="number" 
                                    value={activeScheduleProfile.timeOff?.vacationDays || ''}
                                    onChange={(e) => handleTimeOffChange('vacationDays', parseInt(e.target.value) || 0)} 
                                    disabled={!isScheduleEditing} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Statutory Holidays / Year</Label>
                                <Input 
                                    type="number" 
                                    value={activeScheduleProfile.timeOff?.holidays || ''}
                                    onChange={(e) => handleTimeOffChange('holidays', parseInt(e.target.value) || 0)} 
                                    disabled={!isScheduleEditing} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="slot-interval">Booking Slot Interval</Label>
                                <Select
                                    value={activeScheduleProfile.bookingSlotInterval?.toString() || '15'}
                                    onValueChange={handleBookingIntervalChange}
                                    disabled={!isScheduleEditing}
                                >
                                    <SelectTrigger id="slot-interval">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="15">Every 15 minutes</SelectItem>
                                        <SelectItem value="30">Every 30 minutes</SelectItem>
                                        <SelectItem value="60">On the hour</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardFooter>
                    )}
                </Card>
            </TabsContent>

            <TabsContent value="policies" className="mt-6 space-y-6">
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-primary" />
                            Business Policies
                            </CardTitle>
                            <CardDescription>
                            Define rules for cancellations, no-shows, and late arrivals.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                        {isPoliciesEditing ? (
                            <>
                                <Button variant="outline" onClick={handlePoliciesCancel} className="flex-1 sm:w-auto">Cancel</Button>
                                <Button onClick={handlePoliciesSave} className="flex-1 sm:w-auto"><Save className="mr-2 h-4 w-4" />Save Policies</Button>
                            </>
                        ) : (
                            <Button onClick={handlePoliciesEdit} className="w-full sm:w-auto"><Edit className="mr-2 h-4 w-4"/>Edit Policies</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        {/* Lateness Section */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Lateness & Grace Periods
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="late-grace-period">Arrival Grace Period (minutes)</Label>
                                    <Input id="late-grace-period" type="number" value={tenantData.lateArrivalGracePeriod || ''} onChange={(e) => setTenantData(prev => ({...prev, lateArrivalGracePeriod: Number(e.target.value)}))} placeholder="e.g., 15" disabled={!isPoliciesEditing}/>
                                    <p className="text-[10px] text-muted-foreground">The buffer time before an appointment is considered "Late".</p>
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="auto-cancel" className="font-bold flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-destructive" /> Auto-Cancel Rule</Label>
                                        <p className="text-[10px] text-muted-foreground uppercase font-black">Trigger cancellation after grace period</p>
                                    </div>
                                    <Switch id="auto-cancel" checked={tenantData.autoCancelLateArrivals} onCheckedChange={(checked) => setTenantData(prev => ({...prev, autoCancelLateArrivals: checked}))} disabled={!isPoliciesEditing} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="late-arrival-policy" className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">Late Arrival Policy Text</Label>
                                <div className="relative">
                                    <Textarea id="late-arrival-policy" value={tenantData.lateArrivalPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, lateArrivalPolicy: e.target.value}))} placeholder={generatePolicy('late') || 'Set rules above or write your own policy.'} rows={3} disabled={!isPoliciesEditing} />
                                    {isPoliciesEditing && <Button size="xs" variant="secondary" className="absolute top-2 right-2 h-6 text-[9px] uppercase font-black" onClick={() => setTenantData(prev => ({...prev, lateArrivalPolicy: generatePolicy('late')}))} type="button"><Sparkles className="w-3 h-3 mr-1" /> Regenerate</Button>}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        {/* Cancellations Section */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Ban className="w-4 h-4" /> Cancellation Window & Fees
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="cancellation-window">Policy Window (hours)</Label>
                                    <Input id="cancellation-window" type="number" value={tenantData.cancellationWindowHours || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationWindowHours: Number(e.target.value)}))} placeholder="e.g., 24" disabled={!isPoliciesEditing} />
                                    <p className="text-[10px] text-muted-foreground">The minimum notice required to avoid a late fee.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="cancellation-fee">Late Cancellation Fee</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="cancellation-fee" type="number" value={tenantData.cancellationFee?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationFee: Number(e.target.value)}))} placeholder="25.00" className="pl-8" disabled={!isPoliciesEditing}/>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">Standard fee for cancellations inside the window.</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cancellation-policy" className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">Cancellation Policy Text</Label>
                                <div className="relative">
                                    <Textarea id="cancellation-policy" value={tenantData.cancellationPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationPolicy: e.target.value}))} placeholder={generatePolicy('cancellation') || 'Set rules above or write your own policy.'} rows={3} disabled={!isPoliciesEditing} />
                                    {isPoliciesEditing && <Button size="xs" variant="secondary" className="absolute top-2 right-2 h-6 text-[9px] uppercase font-black" onClick={() => setTenantData(prev => ({...prev, cancellationPolicy: generatePolicy('cancellation')}))} type="button"><Sparkles className="w-3 h-3 mr-1" /> Regenerate</Button>}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        {/* No-Shows Section */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Users className="w-4 h-4" /> No-Show Enforcement
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="no-show-fee">No-Show Penalty Fee</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="no-show-fee" type="number" value={tenantData.noShowFee?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, noShowFee: Number(e.target.value)}))} placeholder="50.00" className="pl-8" disabled={!isPoliciesEditing} />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">Total penalty for failing to arrive without notice.</p>
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="discount-stacking" className="font-bold flex items-center gap-2"><Percent className="w-4 h-4" /> Allow Discount Stacking</Label>
                                        <p className="text-[10px] text-muted-foreground uppercase font-black">Allow multiple codes per sale</p>
                                    </div>
                                    <Switch id="discount-stacking" checked={tenantData.allowDiscountStacking} onCheckedChange={(checked) => setTenantData(prev => ({...prev, allowDiscountStacking: checked}))} disabled={!isPoliciesEditing} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="no-show-policy" className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">No-Show Policy Text</Label>
                                <div className="relative">
                                    <Textarea id="no-show-policy" value={tenantData.noShowPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, noShowPolicy: e.target.value}))} placeholder={generatePolicy('noShow') || 'Set rules above or write your own policy.'} rows={3} disabled={!isPoliciesEditing} />
                                    {isPoliciesEditing && <Button size="xs" variant="secondary" className="absolute top-2 right-2 h-6 text-[9px] uppercase font-black" onClick={() => setTenantData(prev => ({...prev, noShowPolicy: generatePolicy('noShow')}))} type="button"><Sparkles className="w-3 h-3 mr-1" /> Regenerate</Button>}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
            
            <TabsContent value="queue" className="mt-6">
                 <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" />Queue Settings</CardTitle>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                            {isQueueEditing ? (<><Button variant="outline" onClick={handleQueueCancel} className="flex-1 sm:w-auto">Cancel</Button><Button onClick={handleQueueSave} className="flex-1 sm:w-auto"><Save className="mr-2 h-4 w-4" />Save</Button></>) : (<Button onClick={handleQueueEdit} className="w-full sm:w-auto"><Edit className="mr-2 h-4 w-4"/>Edit</Button>)}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <Label htmlFor="skip-timer">Skip Timer (minutes)</Label>
                            <Input id="skip-timer" type="number" value={tenantData.queueSkipTimeMinutes || ''} onChange={(e) => setTenantData(prev => ({...prev, queueSkipTimeMinutes: Number(e.target.value)}))} placeholder="e.g., 5" disabled={!isQueueEditing} />
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="messaging" className="mt-6">
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" />Messaging &amp; Notifications</CardTitle>
                            <CardDescription>Configure your third-party messaging providers and templates.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">{isSmsEditing ? (<><Button variant="outline" onClick={handleSmsCancel} className="flex-1 sm:w-auto">Cancel</Button><Button onClick={handleSmsSave} className="flex-1 sm:w-auto"><Save className="mr-2 h-4 w-4" />Save</Button></>) : (<Button onClick={handleSmsEdit} className="w-full sm:w-auto"><Edit className="mr-2 h-4 w-4"/>Edit</Button>)}</div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2"><Label htmlFor="twilio-sid">Twilio Account SID</Label><Input id="twilio-sid" value={tenantData.twilioAccountSid || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAccountSid: e.target.value}))} placeholder="AC..." disabled={!isSmsEditing} /></div>
                        <div className="space-y-2"><Label htmlFor="twilio-token">Twilio Auth Token</Label><Input id="twilio-token" type="password" value={tenantData.twilioAuthToken || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAuthToken: e.target.value}))} placeholder="••••••••••••••••" disabled={!isSmsEditing}/></div>
                        <div className="space-y-2"><Label htmlFor="twilio-phone">Twilio Phone Number</Label><Input id="twilio-phone" value={tenantData.twilioPhoneNumber || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioPhoneNumber: e.target.value}))} placeholder="+15551234567" disabled={!isSmsEditing}/></div>
                        <div className="space-y-2 pt-4 border-t"><Label htmlFor="sms-message">Walk-in Notification Message</Label><Textarea id="sms-message" value={tenantData.smsNotificationMessage || ''} onChange={(e) => setTenantData(prev => ({...prev, smsNotificationMessage: e.target.value}))} placeholder="Enter your SMS message..." rows={4} disabled={!isSmsEditing}/><p className="text-xs text-muted-foreground">Use placeholders like "{'{clientName}'}" and "{'{businessName}'}".</p></div>
                    </CardContent>
                </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

        <AlertDialog open={!!tenantToDelete} onOpenChange={() => setTenantToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently delete the business location &quot;{tenantToDelete?.name}&quot; and all its associated data (services, clients, appointments, etc.). This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmDeleteTenant} className={buttonVariants({ variant: "destructive" })}>
                        Yes, Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
  );
}
