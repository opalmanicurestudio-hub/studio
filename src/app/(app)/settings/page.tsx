

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
import { DollarSign, Gift, Save, ListChecks, MessageSquare, Clock, Building, Edit, PlusCircle, MoreHorizontal, Globe, Check, Link as LinkIcon, Calendar, Loader } from 'lucide-react';
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
import { format } from 'date-fns';
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { nanoid } from 'nanoid';
import { type Tenant } from '@/lib/data';

const DayScheduleRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
  const timeOptions = Array.from({ length: (22 - 8) * 2 + 1 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = i % 2 === 0 ? '00' : '30';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
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


const ScheduleProfileManager = () => {
    const { firestore, user } = useFirebase();
    const tenantId = 'tenant-abc';
    const [isEditing, setIsEditing] = useState(false);
    const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);

    const scheduleProfilesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/scheduleProfiles`), [firestore, tenantId]);
    const { data: scheduleProfilesData, isLoading: profilesLoading } = useCollection(scheduleProfilesQuery);
    
    // Local state for profiles
    const [profiles, setProfiles] = useState<any[]>([]);
    const [backupProfiles, setBackupProfiles] = useState<any[]>([]);
    const hasInitialized = useRef(false);

    const orderedDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    // Effect to initialize and sync local state from Firestore
    useEffect(() => {
        if (scheduleProfilesData) {
            setProfiles(scheduleProfilesData);
        }
    }, [scheduleProfilesData]);

     useEffect(() => {
        if (!profilesLoading && profiles.length === 0 && firestore && user && !hasInitialized.current) {
            hasInitialized.current = true; // prevent re-running
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
        }
    }, [profilesLoading, profiles, firestore, user, tenantId]);

    const activeProfile = useMemo(() => profiles.find(p => p.isActive), [profiles]);

    const handleScheduleChange = useCallback((day: string, field: string, value: any) => {
        setProfiles((prev: any[]) => 
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
    }, []);

    const handleTimeOffChange = useCallback((field: string, value: number) => {
        setProfiles((prev: any[]) => 
            prev.map(p => 
                p.isActive ? {
                    ...p,
                    timeOff: { ...p.timeOff, [field]: value }
                } : p
            )
        );
    }, []);

    const handleBookingIntervalChange = useCallback((value: string) => {
        const interval = parseInt(value, 10);
        setProfiles((prev: any[]) => 
            prev.map(p => 
                p.isActive ? {
                    ...p,
                    bookingSlotInterval: interval
                } : p
            )
        );
    }, []);
    
    const handleEditToggle = () => {
        if (!isEditing) {
            setBackupProfiles(JSON.parse(JSON.stringify(profiles)));
            setIsEditing(true);
        } else {
            if (firestore) {
                 profiles.forEach((profile: any) => {
                    const profileRef = doc(firestore, `tenants/${tenantId}/scheduleProfiles/${profile.id}`);
                    updateDocumentNonBlocking(profileRef, profile);
                });
            }
            setIsEditing(false);
        }
    };
    
    const handleCancel = () => {
        setProfiles(backupProfiles);
        setIsEditing(false);
    };

    return (
        <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Building className="w-5 h-5 text-primary" />
                        Business Hours &amp; Availability
                    </CardTitle>
                    <CardDescription>
                        Set your schedules for financial calculations and public booking pages.
                    </CardDescription>
                </div>
                 <div className="flex items-center gap-2 flex-shrink-0">
                    {isEditing ? (
                        <>
                            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                            <Button onClick={handleEditToggle}><Save className="mr-2"/>Save Schedule</Button>
                        </>
                    ) : (
                        <Button onClick={handleEditToggle}><Edit className="mr-2"/>Edit Schedule</Button>
                    )}
                  </div>
            </CardHeader>
            <CardContent className="p-0">
               {activeProfile && (
                <div>
                     {orderedDays.map((day) => {
                        const dayData = activeProfile.week[day];
                        if (!dayData) return null;
                        return (
                            <DayScheduleRow 
                                key={day} 
                                day={day} 
                                dayData={dayData} 
                                onDayChange={(field: string, value: any) => handleScheduleChange(day, field, value)}
                                isEditing={isEditing} 
                            />
                        )
                    })}
                </div>
               )}
            </CardContent>
            {activeProfile && (
                <CardFooter className="pt-6 grid md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <Label>Vacation Days / Year</Label>
                        <Input 
                            type="number" 
                            value={activeProfile.timeOff?.vacationDays || ''}
                            onChange={(e) => handleTimeOffChange('vacationDays', parseInt(e.target.value) || 0)} 
                            disabled={!isEditing} 
                        />
                    </div>
                     <div className="space-y-2">
                        <Label>Statutory Holidays / Year</Label>
                        <Input 
                            type="number" 
                            value={activeProfile.timeOff?.holidays || ''}
                            onChange={(e) => handleTimeOffChange('holidays', parseInt(e.target.value) || 0)} 
                            disabled={!isEditing} 
                        />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="slot-interval">Booking Slot Interval</Label>
                        <Select
                            value={activeProfile.bookingSlotInterval?.toString() || '15'}
                            onValueChange={handleBookingIntervalChange}
                            disabled={!isEditing}
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
    );
};


export default function SettingsPage() {
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc'; // Using a consistent tenant ID

  const tenantDocRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return doc(firestore, 'tenants', tenantId);
  }, [firestore, user, tenantId]);

  const { data: tenantData, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);

  const [referrerReward, setReferrerReward] = useState('10.00');
  const [newClientDiscount, setNewClientDiscount] = useState('15.00');
  const [queueSkipTime, setQueueSkipTime] = useState(5);
  const [smsMessage, setSmsMessage] = useState(
    "Hi {clientName}, your spot at {businessName} is ready! Please head to the front desk."
  );

  const [lateGracePeriod, setLateGracePeriod] = useState(15);
  const [cancellationFee, setCancellationFee] = useState('25.00');
  const [noShowFee, setNoShowFee] = useState('50.00');
  const [cancellationWindow, setCancellationWindow] = useState(24);
  const [autoCancel, setAutoCancel] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState('');
  const [lateArrivalPolicy, setLateArrivalPolicy] = useState('');
  const [noShowPolicy, setNoShowPolicy] = useState('');

  useEffect(() => {
    if (tenantData) {
      setReferrerReward(tenantData.referrerReward?.toFixed(2) || '10.00');
      setNewClientDiscount(tenantData.newClientDiscount?.toFixed(2) || '15.00');
      setQueueSkipTime(tenantData.queueSkipTimeMinutes || 5);
      setSmsMessage(tenantData.smsNotificationMessage || "Hi {clientName}, your spot at {businessName} is ready! Please head to the front desk.");
      setLateGracePeriod(tenantData.lateArrivalGracePeriod || 15);
      setCancellationFee((tenantData.cancellationFee || 25).toFixed(2));
      setNoShowFee((tenantData.noShowFee || 50).toFixed(2));
      setCancellationWindow(tenantData.cancellationWindowHours || 24);
      setAutoCancel(tenantData.autoCancelLateArrivals || false);
      setCancellationPolicy(tenantData.cancellationPolicy || '');
      setLateArrivalPolicy(tenantData.lateArrivalPolicy || '');
      setNoShowPolicy(tenantData.noShowPolicy || '');
    }
  }, [tenantData]);

  const handleSaveSettings = (section: string) => {
    if (!tenantData) return;
    const tenantRef = doc(firestore, 'tenants', tenantId);
    let dataToUpdate: Partial<Tenant> = {};

    switch(section) {
        case 'Scheduling Policies':
            dataToUpdate = {
                lateArrivalGracePeriod: lateGracePeriod,
                cancellationFee: parseFloat(cancellationFee),
                noShowFee: parseFloat(noShowFee),
                cancellationWindowHours: cancellationWindow,
                autoCancelLateArrivals: autoCancel,
                cancellationPolicy: cancellationPolicy,
                lateArrivalPolicy: lateArrivalPolicy,
                noShowPolicy: noShowPolicy,
            };
            break;
        case 'Referral Program':
            dataToUpdate = {
                referrerReward: parseFloat(referrerReward),
                newClientDiscount: parseFloat(newClientDiscount)
            };
            break;
        case 'Walk-in Queue':
            dataToUpdate = { queueSkipTimeMinutes: queueSkipTime };
            break;
        case 'SMS Notifications':
            dataToUpdate = { smsNotificationMessage: smsMessage };
            break;
    }

    if (Object.keys(dataToUpdate).length > 0) {
        updateDocumentNonBlocking(tenantRef, dataToUpdate);
        toast({
          title: `${section} Settings Saved`,
          description: `Your ${section.toLowerCase()} settings have been updated.`,
        });
    }
  };

  if (tenantLoading) {
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
          
          <ScheduleProfileManager />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Scheduling Policies
              </CardTitle>
              <CardDescription>
                Define rules for appointments, cancellations, and late arrivals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <Label htmlFor="late-grace-period">Late Arrival Grace Period (minutes)</Label>
                        <Input
                            id="late-grace-period"
                            type="number"
                            value={lateGracePeriod}
                            onChange={(e) => setLateGracePeriod(Number(e.target.value))}
                            placeholder="e.g., 15"
                        />
                        <p className="text-xs text-muted-foreground">
                            Time after which a client is considered late.
                        </p>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="cancellation-window">Cancellation Window (hours)</Label>
                        <Input 
                            id="cancellation-window" 
                            type="number" 
                            value={cancellationWindow} 
                            onChange={(e) => setCancellationWindow(Number(e.target.value))} 
                            placeholder="e.g., 24"
                        />
                         <p className="text-xs text-muted-foreground">
                            Clients can cancel for free outside this window.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="cancellation-fee">Late Cancellation Fee</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                            id="cancellation-fee"
                            type="number"
                            value={cancellationFee}
                            onChange={(e) => setCancellationFee(e.target.value)}
                            placeholder="25.00"
                            className="pl-8"
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Fee for cancellations inside the window.
                        </p>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="no-show-fee">No-Show Fee</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                            id="no-show-fee"
                            type="number"
                            value={noShowFee}
                            onChange={(e) => setNoShowFee(e.target.value)}
                            placeholder="50.00"
                            className="pl-8"
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Fee charged when a client doesn't show up.
                        </p>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2">
                        <div className="space-y-0.5">
                            <Label htmlFor="auto-cancel" className="font-semibold">Auto-Cancel Late Arrivals</Label>
                            <p className="text-xs text-muted-foreground">
                                Automatically cancel appointments if the client is late beyond the grace period.
                            </p>
                        </div>
                        <Switch
                            id="auto-cancel"
                            checked={autoCancel}
                            onCheckedChange={setAutoCancel}
                        />
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="cancellation-policy">Cancellation Policy</Label>
                    <Textarea
                        id="cancellation-policy"
                        value={cancellationPolicy}
                        onChange={(e) => setCancellationPolicy(e.target.value)}
                        placeholder="e.g., Cancellations must be made 24 hours in advance..."
                        rows={3}
                    />
                    <p className="text-xs text-muted-foreground">Displayed to clients during booking.</p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="late-arrival-policy">Late Arrival Policy</Label>
                    <Textarea
                        id="late-arrival-policy"
                        value={lateArrivalPolicy}
                        onChange={(e) => setLateArrivalPolicy(e.target.value)}
                        placeholder="e.g., Arrivals later than 15 minutes may need to be rescheduled..."
                        rows={3}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="no-show-policy">No-Show Policy</Label>
                    <Textarea
                        id="no-show-policy"
                        value={noShowPolicy}
                        onChange={(e) => setNoShowPolicy(e.target.value)}
                        placeholder="e.g., No-shows will be charged the full service amount..."
                        rows={3}
                    />
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={() => handleSaveSettings('Scheduling Policies')}>
                <Save className="mr-2 h-4 w-4" />
                Save Policies
                </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-primary" />
                Referral Program
              </CardTitle>
              <CardDescription>
                Define the rewards for your client referral program.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="referrer-reward">Referrer Reward</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="referrer-reward"
                    type="number"
                    value={referrerReward}
                    onChange={(e) => setReferrerReward(e.target.value)}
                    placeholder="10.00"
                    className="pl-8"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Store credit given to the existing client for a successful referral.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-client-discount">New Client Discount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-client-discount"
                    type="number"
                    value={newClientDiscount}
                    onChange={(e) => setNewClientDiscount(e.target.value)}
                    placeholder="15.00"
                    className="pl-8"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Discount amount for the new client on their first service.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('Referral Program')}>
                <Save className="mr-2 h-4 w-4" />
                Save Referral Settings
              </Button>
            </CardFooter>
          </Card>
          
           <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary" />
                Walk-in Queue
              </CardTitle>
              <CardDescription>
                Configure the behavior of your smart walk-in queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="skip-timer">Skip Timer (minutes)</Label>
                <Input
                  id="skip-timer"
                  type="number"
                  value={queueSkipTime}
                  onChange={(e) => setQueueSkipTime(Number(e.target.value))}
                  placeholder="e.g., 5"
                />
                <p className="text-xs text-muted-foreground">
                  Time a client has to claim their spot after being notified before they are automatically skipped.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('Walk-in Queue')}>
                <Save className="mr-2 h-4 w-4" />
                Save Queue Settings
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                SMS Notifications
              </CardTitle>
              <CardDescription>
                Customize the SMS message sent to walk-in clients when it's their turn.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="sms-message">Walk-in Notification Message</Label>
                <Textarea
                  id="sms-message"
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  placeholder="Enter your SMS message..."
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Use placeholders like &quot;{'{clientName}'}&quot; and &quot;{'{businessName}'}&quot; which will be replaced automatically.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('SMS Notifications')}>
                <Save className="mr-2 h-4 w-4" />
                Save Message
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
