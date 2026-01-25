

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
import { DollarSign, Gift, Save, ListChecks, MessageSquare, Clock, Building, Edit, PlusCircle, MoreHorizontal, Globe, Check, Link as LinkIcon, Calendar, Loader, FilePen } from 'lucide-react';
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
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';
import { nanoid } from 'nanoid';

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


const ScheduleProfileManager = ({ 
    profiles, 
    setProfiles, 
    isEditing 
}: {
    profiles: any[],
    setProfiles: React.Dispatch<React.SetStateAction<any[]>>,
    isEditing: boolean,
}) => {
    
    const orderedDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
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
    }, [setProfiles]);

    const handleTimeOffChange = useCallback((field: string, value: number) => {
        setProfiles((prev: any[]) => 
            prev.map(p => 
                p.isActive ? {
                    ...p,
                    timeOff: { ...p.timeOff, [field]: value }
                } : p
            )
        );
    }, [setProfiles]);
    
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
    }, [setProfiles]);

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
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [tenantData, setTenantData] = useState<Partial<Tenant>>({});
  const [backupTenantData, setBackupTenantData] = useState<Partial<Tenant>>({});
  
  const [scheduleProfiles, setScheduleProfiles] = useState<any[]>([]);
  const [backupScheduleProfiles, setBackupScheduleProfiles] = useState<any[]>([]);
  
  const hasInitialized = useRef(false);

  const tenantQuery = useMemoFirebase(() => {
      if (!user || !firestore) return null;
      return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: tenants, isLoading: tenantsLoading } = useCollection(tenantQuery);
  const initialTenantData = useMemo(() => tenants?.[0], [tenants]);

  const scheduleProfilesQuery = useMemoFirebase(() => {
    if (!tenantId || !firestore) return null;
    return collection(firestore, `tenants/${tenantId}/scheduleProfiles`);
  }, [tenantId, firestore]);
  const { data: initialScheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);

  useEffect(() => {
    if (initialTenantData && !tenantId) {
        setTenantId(initialTenantData.id);
    }
  }, [initialTenantData, tenantId]);

  useEffect(() => {
    if (initialTenantData) {
      setTenantData(initialTenantData);
    }
  }, [initialTenantData]);

  useEffect(() => {
    if (initialScheduleProfiles) {
      setScheduleProfiles(initialScheduleProfiles);
    }
  }, [initialScheduleProfiles]);

   useEffect(() => {
        if (!scheduleProfilesLoading && scheduleProfiles.length === 0 && firestore && user && tenantId && !hasInitialized.current) {
            hasInitialized.current = true;
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
    }, [scheduleProfilesLoading, scheduleProfiles, firestore, user, tenantId]);

  const handleEditClick = () => {
    setBackupTenantData(tenantData);
    setBackupScheduleProfiles(JSON.parse(JSON.stringify(scheduleProfiles)));
    setIsEditing(true);
  };
  
  const handleCancelClick = () => {
    setTenantData(backupTenantData);
    setScheduleProfiles(backupScheduleProfiles);
    setIsEditing(false);
  };

  const handleSaveSettings = () => {
    if (!tenantId || !firestore) return;

    const batch = writeBatch(firestore);

    // Save tenant settings
    const tenantRef = doc(firestore, 'tenants', tenantId);
    const updatedTenantFields = {
        ...tenantData,
        referrerReward: parseFloat(tenantData.referrerReward as any || '0'),
        newClientDiscount: parseFloat(tenantData.newClientDiscount as any || '0'),
        queueSkipTimeMinutes: Number(tenantData.queueSkipTimeMinutes || 0),
        lateArrivalGracePeriod: Number(tenantData.lateArrivalGracePeriod || 0),
        cancellationFee: parseFloat(tenantData.cancellationFee as any || '0'),
        noShowFee: parseFloat(tenantData.noShowFee as any || '0'),
        cancellationWindowHours: Number(tenantData.cancellationWindowHours || 0),
    };
    batch.update(tenantRef, updatedTenantFields);

    // Save schedule profile settings
    scheduleProfiles.forEach(profile => {
        const profileRef = doc(firestore, `tenants/${tenantId}/scheduleProfiles`, profile.id);
        batch.update(profileRef, profile);
    });

    batch.commit().then(() => {
        toast({
            title: `Settings Saved`,
            description: `Your settings have been updated.`,
        });
        setIsEditing(false);
    }).catch(error => {
        console.error("Error saving settings:", error);
        toast({
            variant: "destructive",
            title: "Error Saving",
            description: "There was a problem saving your settings."
        })
    });
  };

  const generatePolicy = (type: 'cancellation' | 'noShow' | 'late') => {
      let policy = '';
      switch (type) {
          case 'cancellation':
              if ((tenantData.cancellationWindowHours || 0) > 0 && (tenantData.cancellationFee || 0) > 0) {
                  policy = `Cancellations made within ${tenantData.cancellationWindowHours} hours of the scheduled appointment time will be subject to a fee of $${tenantData.cancellationFee?.toFixed(2)}.`;
              }
              break;
          case 'noShow':
              if ((tenantData.noShowFee || 0) > 0) {
                  policy = `Failure to show up for a scheduled appointment without notice will result in a no-show fee of $${tenantData.noShowFee?.toFixed(2)}.`;
              }
              break;
          case 'late':
              if ((tenantData.lateArrivalGracePeriod || 0) > 0) {
                  policy = `We offer a grace period of ${tenantData.lateArrivalGracePeriod} minutes. Arriving later than this may require rescheduling and could be considered a no-show.`;
              }
              break;
      }
      return policy;
  }

  const isLoading = tenantsLoading || scheduleProfilesLoading;

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
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold">Business Settings</h1>
              <p className="text-muted-foreground mt-1">
                Manage your application-wide settings and configurations.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isEditing ? (
                  <>
                      <Button variant="outline" onClick={handleCancelClick}>Cancel</Button>
                      <Button onClick={handleSaveSettings}><Save className="mr-2 h-4 w-4" />Save Settings</Button>
                  </>
              ) : (
                  <Button onClick={handleEditClick}><Edit className="mr-2 h-4 w-4"/>Edit Settings</Button>
              )}
            </div>
          </div>
          
          <ScheduleProfileManager profiles={scheduleProfiles} setProfiles={setScheduleProfiles} isEditing={isEditing} />

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
                            value={tenantData.lateArrivalGracePeriod || ''}
                            onChange={(e) => setTenantData(prev => ({...prev, lateArrivalGracePeriod: Number(e.target.value)}))}
                            placeholder="e.g., 15"
                            disabled={!isEditing}
                        />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="cancellation-window">Cancellation Window (hours)</Label>
                        <Input 
                            id="cancellation-window" 
                            type="number" 
                            value={tenantData.cancellationWindowHours || ''}
                            onChange={(e) => setTenantData(prev => ({...prev, cancellationWindowHours: Number(e.target.value)}))} 
                            placeholder="e.g., 24"
                            disabled={!isEditing}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="cancellation-fee">Late Cancellation Fee</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                            id="cancellation-fee"
                            type="number"
                             value={tenantData.cancellationFee?.toString() || ''}
                             onChange={(e) => setTenantData(prev => ({...prev, cancellationFee: parseFloat(e.target.value)}))}
                            placeholder="25.00"
                            className="pl-8"
                            disabled={!isEditing}
                            />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="no-show-fee">No-Show Fee</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                            id="no-show-fee"
                            type="number"
                             value={tenantData.noShowFee?.toString() || ''}
                             onChange={(e) => setTenantData(prev => ({...prev, noShowFee: parseFloat(e.target.value)}))}
                            placeholder="50.00"
                            className="pl-8"
                            disabled={!isEditing}
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2">
                        <div className="space-y-0.5">
                            <Label htmlFor="auto-cancel" className="font-semibold">Auto-Cancel Late Arrivals</Label>
                        </div>
                        <Switch
                            id="auto-cancel"
                             checked={tenantData.autoCancelLateArrivals}
                             onCheckedChange={(checked) => setTenantData(prev => ({...prev, autoCancelLateArrivals: checked}))}
                            disabled={!isEditing}
                        />
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="cancellation-policy">Cancellation Policy</Label>
                     <div className="relative">
                        <Textarea id="cancellation-policy" value={tenantData.cancellationPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationPolicy: e.target.value}))} placeholder="Auto-generated based on your rules." rows={3} disabled={!isEditing} />
                        {isEditing && <Button size="xs" variant="outline" className="absolute bottom-2 right-2" type="button" onClick={() => setTenantData(prev => ({...prev, cancellationPolicy: generatePolicy('cancellation')}))}>Auto-generate</Button>}
                     </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="late-arrival-policy">Late Arrival Policy</Label>
                    <div className="relative">
                        <Textarea id="late-arrival-policy" value={tenantData.lateArrivalPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, lateArrivalPolicy: e.target.value}))} placeholder="Auto-generated based on your rules." rows={3} disabled={!isEditing} />
                        {isEditing && <Button size="xs" variant="outline" className="absolute bottom-2 right-2" type="button" onClick={() => setTenantData(prev => ({...prev, lateArrivalPolicy: generatePolicy('late')}))}>Auto-generate</Button>}
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="no-show-policy">No-Show Policy</Label>
                     <div className="relative">
                        <Textarea id="no-show-policy" value={tenantData.noShowPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, noShowPolicy: e.target.value}))} placeholder="Auto-generated based on your rules." rows={3} disabled={!isEditing} />
                        {isEditing && <Button size="xs" variant="outline" className="absolute bottom-2 right-2" type="button" onClick={() => setTenantData(prev => ({...prev, noShowPolicy: generatePolicy('noShow')}))}>Auto-generate</Button>}
                    </div>
                </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-primary" />
                Referral Program
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="referrer-reward">Referrer Reward</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="referrer-reward"
                    type="number"
                    value={tenantData.referrerReward?.toString() || ''}
                    onChange={(e) => setTenantData(prev => ({...prev, referrerReward: parseFloat(e.target.value)}))}
                    placeholder="10.00"
                    className="pl-8"
                    disabled={!isEditing}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-client-discount">New Client Discount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-client-discount"
                    type="number"
                    value={tenantData.newClientDiscount?.toString() || ''}
                    onChange={(e) => setTenantData(prev => ({...prev, newClientDiscount: parseFloat(e.target.value)}))}
                    placeholder="15.00"
                    className="pl-8"
                    disabled={!isEditing}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          
           <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary" />
                Walk-in Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="skip-timer">Skip Timer (minutes)</Label>
                <Input
                  id="skip-timer"
                  type="number"
                  value={tenantData.queueSkipTimeMinutes || ''}
                  onChange={(e) => setTenantData(prev => ({...prev, queueSkipTimeMinutes: Number(e.target.value)}))}
                  placeholder="e.g., 5"
                  disabled={!isEditing}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                SMS Notifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="sms-message">Walk-in Notification Message</Label>
                <Textarea
                  id="sms-message"
                  value={tenantData.smsNotificationMessage || ''}
                  onChange={(e) => setTenantData(prev => ({...prev, smsNotificationMessage: e.target.value}))}
                  placeholder="Enter your SMS message..."
                  rows={4}
                  disabled={!isEditing}
                />
                <p className="text-xs text-muted-foreground">
                  Use placeholders like &quot;{'{clientName}'}&quot; and &quot;{'{businessName}'}&quot;.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
