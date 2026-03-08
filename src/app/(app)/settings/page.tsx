
'use client';

import React, { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { 
  DollarSign, 
  Save, 
  ListChecks, 
  MessageSquare, 
  Clock, 
  Building, 
  Edit, 
  PlusCircle, 
  MoreHorizontal, 
  Check, 
  Link as LinkIcon, 
  FileText, 
  Trash2, 
  Users, 
  Info,
  Ban,
  ShieldAlert,
  Calculator,
  Loader,
  Globe,
  Palette,
  Eye,
  EyeOff,
  ImageIcon,
  CircleHelp,
  Award,
  Star,
  Repeat,
  Plus,
  X,
  MessageCircleQuestion,
  ImagePlus,
  Grip,
  Activity,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
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
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { type Tenant, type BookingPageSettings, type BookingFAQItem, type BookingGalleryItem, type Review } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDistanceToNow, parseISO } from 'date-fns';

const DayHoursRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
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

const SentimentCurationItem = ({ review, onTogglePublic, onToggleFeatured }: { review: Review, onTogglePublic: (id: string, isPublic: boolean) => void, onToggleFeatured: (id: string, isFeatured: boolean) => void }) => {
    return (
        <div className={cn(
            "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all",
            review.isPublic ? "border-primary/20 bg-primary/[0.02]" : "border-border/50 bg-white opacity-60"
        )}>
            <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl shrink-0">
                <AvatarImage src={review.clientAvatarUrl} className="object-cover" />
                <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(review.clientName || 'C')[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 text-left">
                <div className='flex items-center gap-2'>
                    <p className="font-black uppercase tracking-tight text-[11px] text-slate-900 truncate">{review.clientName}</p>
                    {review.isFeatured && <Badge className="bg-primary text-white border-none text-[7px] h-4 font-black uppercase">Spotlight</Badge>}
                </div>
                <p className="text-[9px] font-medium text-slate-500 line-clamp-1 italic">"{review.text}"</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className={cn("h-8 w-8 rounded-xl border-2 transition-all", review.isFeatured ? "bg-primary/10 border-primary text-primary" : "border-transparent text-slate-300")}
                    onClick={() => onToggleFeatured(review.id, !review.isFeatured)}
                >
                    <Star className={cn("h-4 w-4", review.isFeatured && "fill-current")} />
                </Button>
                <Switch 
                    checked={review.isPublic} 
                    onCheckedChange={(val) => onTogglePublic(review.id, val)}
                    className="data-[state=checked]:bg-primary"
                />
            </div>
        </div>
    );
};

function SettingsContent() {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { tenants, selectedTenant, isLoading: isTenantContextLoading } = useTenant();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [tempTenantName, setTempTenantName] = useState('');
  
  const [isScheduleEditing, setIsScheduleEditing] = useState(false);
  const [isPoliciesEditing, setIsPoliciesEditing] = useState(false);
  const [isQueueEditing, setIsQueueEditing] = useState(false);
  const [isSmsEditing, setIsSmsEditing] = useState(false);
  const [isBookingBuilderEditing, setIsBookingBuilderEditing] = useState(false);

  const [tenantData, setTenantData] = useState<Partial<Tenant>>({});
  const [scheduleProfiles, setScheduleProfiles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState(tabParam || 'profile');

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const [backupTenantData, setBackupTenantData] = useState<Partial<Tenant>>({});
  const [backupScheduleProfiles, setBackupScheduleProfiles] = useState<any[]>([]);

  const scheduleProfilesQuery = useMemoFirebase(() => {
    if (!selectedTenant || !firestore) return null;
    return collection(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`);
  }, [selectedTenant, firestore]);
  const { data: initialScheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);

  const reviewsQuery = useMemoFirebase(() => {
    if (!selectedTenant || !firestore) return null;
    return collection(firestore, `tenants/${selectedTenant.id}/reviews`);
  }, [selectedTenant, firestore]);
  const { data: reviews } = useCollection<Review>(reviewsQuery);

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
  }, []);

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

  const handlePoliciesEdit = () => {
    setBackupTenantData(tenantData);
    setIsPoliciesEditing(true);
  };

  const handlePoliciesCancel = () => {
    setTenantData(backupTenantData);
    setIsPoliciesEditing(false);
  };

  const handlePoliciesSave = async () => {
    if (!selectedTenant || !firestore) return;
    const policiesFields: (keyof Tenant)[] = ['lateArrivalGracePeriod', 'cancellationWindowHours', 'cancellationFee', 'noShowFee', 'autoCancelLateArrivals', 'allowDiscountStacking', 'cancellationPolicy', 'lateArrivalPolicy', 'noShowPolicy'];
    const dataToUpdate: Partial<Tenant> = {};
    policiesFields.forEach(field => {
      dataToUpdate[field] = tenantData[field] as any;
    });
    try {
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
      updateDocumentNonBlocking(tenantRef, dataToUpdate);
      toast({ title: 'Policies Saved!' });
      setIsPoliciesEditing(false);
    } catch (error) {
      console.error("Save error:", error);
      toast({ variant: 'destructive', title: 'Save Failed' });
    }
  };

  const handleBookingBuilderEdit = () => {
    setBackupTenantData(tenantData);
    setIsBookingBuilderEditing(true);
  }

  const handleBookingBuilderCancel = () => {
    setTenantData(backupTenantData);
    setIsBookingBuilderEditing(false);
  }

  const handleBookingBuilderSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
        const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
        updateDocumentNonBlocking(tenantRef, { bookingPageSettings: tenantData.bookingPageSettings });
        toast({ title: 'Booking Page Settings Saved!' });
        setIsBookingBuilderEditing(false);
    } catch (error) {
        toast({ variant: 'destructive', title: 'Save Failed' });
    }
  }

  const handleAddFaq = () => {
    const newFaq: BookingFAQItem = { id: nanoid(), question: '', answer: '' };
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            faqs: [...(prev.bookingPageSettings?.faqs || []), newFaq]
        }
    }));
  };

  const handleRemoveFaq = (id: string) => {
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            faqs: (prev.bookingPageSettings?.faqs || []).filter(f => f.id !== id)
        }
    }));
  };

  const handleUpdateFaq = (id: string, field: keyof BookingFAQItem, value: string) => {
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            faqs: (prev.bookingPageSettings?.faqs || []).map(f => f.id === id ? { ...f, [field]: value } : f)
        }
    }));
  };

  const handleAddGalleryImage = (url: string) => {
    const newItem: BookingGalleryItem = { id: nanoid(), url, caption: '' };
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            gallery: [...(prev.bookingPageSettings?.gallery || []), newItem]
        }
    }));
  };

  const handleRemoveGalleryImage = (id: string) => {
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            gallery: (prev.bookingPageSettings?.gallery || []).filter(g => g.id !== id)
        }
    }));
  };

  const handleUpdateGalleryCaption = (id: string, caption: string) => {
    setTenantData(prev => ({
        ...prev,
        bookingPageSettings: {
            ...prev.bookingPageSettings,
            gallery: (prev.bookingPageSettings?.gallery || []).map(g => g.id === id ? { ...g, caption } : g)
        }
    }));
  };

  const handleQueueEdit = () => {
    setBackupTenantData(tenantData);
    setIsQueueEditing(true);
  };

  const handleQueueCancel = () => {
    setTenantData(backupTenantData);
    setIsQueueEditing(false);
  };

  const handleQueueSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
      updateDocumentNonBlocking(tenantRef, { queueSkipTimeMinutes: tenantData.queueSkipTimeMinutes });
      toast({ title: 'Queue Settings Saved!' });
      setIsQueueEditing(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save Failed' });
    }
  };

  const handleSmsEdit = () => {
    setBackupTenantData(tenantData);
    setIsSmsEditing(true);
  };

  const handleSmsCancel = () => {
    setTenantData(backupTenantData);
    setIsSmsEditing(false);
  };

  const handleSmsSave = async () => {
    if (!selectedTenant || !firestore) return;
    const smsFields: (keyof Tenant)[] = ['twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber'];
    const dataToUpdate: Partial<Tenant> = {};
    smsFields.forEach(field => {
      dataToUpdate[field] = tenantData[field] as any;
    });
    try {
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
      updateDocumentNonBlocking(tenantRef, dataToUpdate);
      toast({ title: 'SMS Settings Saved!' });
      setIsSmsEditing(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save Failed' });
    }
  };

  const handleToggleReviewPublic = (id: string, isPublic: boolean) => {
      if (!firestore || !selectedTenant) return;
      const reviewRef = doc(firestore, `tenants/${selectedTenant.id}/reviews`, id);
      updateDocumentNonBlocking(reviewRef, { isPublic });
  }

  const handleToggleReviewFeatured = (id: string, isFeatured: boolean) => {
      if (!firestore || !selectedTenant) return;
      const reviewRef = doc(firestore, `tenants/${selectedTenant.id}/reviews`, id);
      updateDocumentNonBlocking(reviewRef, { isFeatured });
  }

  const generatePolicy = (type: 'cancellation' | 'noShow' | 'late') => {
    const grace = tenantData.lateArrivalGracePeriod || 15;
    const window = tenantData.cancellationWindowHours || 24;
    const tmhr = selectedTenant?.tmhr || 50;

    switch (type) {
        case 'cancellation':
            return `Appointments cancelled within ${window} hours of the scheduled time are subject to an overhead recovery fee calculated based on the reserved duration ($${tmhr.toFixed(2)}/hr).`;
        case 'noShow':
            return `Failure to show up for an appointment without prior notice will result in a penalty fee of 100% of the scheduled service price.`;
        case 'late':
            return `We offer a ${grace}-minute grace period. Beyond this, your appointment may be auto-cancelled to protect the schedules of other clients.`;
        default: return '';
    }
  };

  const isLoading = isTenantContextLoading || (selectedTenant && scheduleProfilesLoading);
  
  const tabs = [
    { value: "profile", label: "Profile", icon: <Building className="w-4 h-4" /> },
    { value: "hours", label: "Hours", icon: <Clock className="w-4 h-4" /> },
    { value: "policies", label: "Policies", icon: <FileText className="w-4 h-4" /> },
    { value: "builder", label: "Page Builder", icon: <Globe className="w-4 h-4" /> },
    { value: "queue", label: "Queue", icon: <ListChecks className="w-4 h-4" /> },
    { value: "messaging", label: "Messaging", icon: <MessageSquare className="w-4 h-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader title="Settings" />
        <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
            <Loader className="h-8 w-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }
  
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <AppHeader title="Business Settings" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8 p-4 md:p-8 pb-20">
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
                           {tab.icon}
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
                            {React.cloneElement(tab.icon as React.ReactElement, { className: "mr-2" })}
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
                                            onKeyDown={(e) => e.key === 'Enter' && setEditingTenantId(null)}
                                            autoFocus
                                        />
                                        <Button size="icon" className="h-9 w-9" onClick={() => setEditingTenantId(null)}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <React.Fragment>
                                        <p className="font-medium">{tenant.name}</p>
                                        <div className="flex items-center gap-2">
                                            {tenant.id === selectedTenant?.id && <Badge>Active</Badge>}
                                            <Button variant="ghost" size="icon" onClick={() => { setEditingTenantId(tenant.id); setTempTenantName(tenant.name); }}>
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </React.Fragment>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="hours" className="mt-6">
                 <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="w-5 h-5 text-primary" />
                                Business Hours
                            </CardTitle>
                            <CardDescription>Set your standard availability.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                        {isScheduleEditing ? (
                            <>
                                <Button variant="outline" onClick={handleScheduleCancel}>Cancel</Button>
                                <Button onClick={handleScheduleSave}>Save</Button>
                            </>
                        ) : (
                            <Button onClick={handleScheduleEdit}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                    {activeScheduleProfile && (
                        <div>
                            {orderedDays.map((day) => (
                                <DayHoursRow 
                                    key={day} 
                                    day={day} 
                                    dayData={activeScheduleProfile.week[day]} 
                                    onDayChange={(field: string, value: any) => handleDayChange(day, field, value)}
                                    isEditing={isScheduleEditing} 
                                />
                            ))}
                        </div>
                    )}
                    </CardContent>
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
                            Define rules for cancellations and late arrivals.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                        {isPoliciesEditing ? (
                            <>
                                <Button variant="outline" onClick={handlePoliciesCancel}>Cancel</Button>
                                <Button onClick={handlePoliciesSave}>Save</Button>
                            </>
                        ) : (
                            <Button onClick={handlePoliciesEdit}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Lateness & Grace Periods
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="late-grace-period">Arrival Grace Period (minutes)</Label>
                                    <Input id="late-grace-period" type="number" value={tenantData.lateArrivalGracePeriod || ''} onChange={(e) => setTenantData(prev => ({...prev, lateArrivalGracePeriod: Number(e.target.value)}))} placeholder="e.g., 15" disabled={!isPoliciesEditing}/>
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                                    <Label htmlFor="auto-cancel" className="font-bold flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-destructive" /> Auto-Cancel Rule</Label>
                                    <Switch id="auto-cancel" checked={tenantData.autoCancelLateArrivals} onCheckedChange={(checked) => setTenantData(prev => ({...prev, autoCancelLateArrivals: checked}))} disabled={!isPoliciesEditing} />
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Ban className="w-4 h-4" /> Dynamic Cancellation Recovery
                                </h3>
                                <div className="bg-primary/10 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-black text-primary border border-primary/20">
                                    <Calculator className="w-3 h-3" />
                                    STRATEGY: RECOVER OVERHEAD
                                </div>
                            </div>
                            
                            <Alert className="bg-primary/5 border-primary/20">
                                <Info className="h-4 w-4 text-primary" />
                                <AlertDescription className="text-xs">
                                    Fees are calculated dynamically during cancellation based on the service duration and your current <strong>TMHR (${selectedTenant?.tmhr?.toFixed(2)})</strong>. This ensures you recover fixed costs like rent and utilities even for empty time slots.
                                </AlertDescription>
                            </Alert>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="cancellation-window">Notice Window (hours)</Label>
                                    <Input id="cancellation-window" type="number" value={tenantData.cancellationWindowHours || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationWindowHours: Number(e.target.value)}))} placeholder="e.g., 24" disabled={!isPoliciesEditing} />
                                </div>
                                <div className="space-y-2">
                                    <Label className="font-bold">Cancellation Fee Logic</Label>
                                    <div className="p-3 rounded-lg border bg-muted/20 text-xs">
                                        Fees are based on Reserved Duration × TMHR (${(selectedTenant?.tmhr || 50).toFixed(2)}/hr).
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cancellation-policy" className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">Cancellation Policy Text</Label>
                                <div className="relative">
                                    <Textarea id="cancellation-policy" value={tenantData.cancellationPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationPolicy: e.target.value}))} placeholder="Enter policy text..." rows={3} disabled={!isPoliciesEditing} />
                                    {isPoliciesEditing && <Button size="xs" variant="secondary" className="absolute top-2 right-2 h-6 text-[9px]" onClick={() => setTenantData(prev => ({...prev, cancellationPolicy: generatePolicy('cancellation')}))} type="button">Regenerate</Button>}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Users className="w-4 h-4" /> No-Show Enforcement
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label className="font-bold">No-Show Penalty</Label>
                                    <div className="p-4 rounded-xl border-2 bg-destructive/5 border-destructive/10">
                                        <p className="text-sm font-medium">Policy: 100% of Scheduled Service Price</p>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="no-show-policy" className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">No-Show Policy Text</Label>
                                <div className="relative">
                                    <Textarea id="no-show-policy" value={tenantData.noShowPolicy || ''} onChange={(e) => setTenantData(prev => ({...prev, noShowPolicy: e.target.value}))} placeholder="Enter policy text..." rows={3} disabled={!isPoliciesEditing} />
                                    {isPoliciesEditing && <Button size="xs" variant="secondary" className="absolute top-2 right-2 h-6 text-[9px]" onClick={() => setTenantData(prev => ({...prev, noShowPolicy: generatePolicy('noShow')}))} type="button">Regenerate</Button>}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="builder" className="mt-6 space-y-6">
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Globe className="w-5 h-5 text-primary" />
                                Booking Page Builder
                            </CardTitle>
                            <CardDescription>Skin your booking experience and customize section headers.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {isBookingBuilderEditing ? (
                                <>
                                    <Button variant="outline" onClick={handleBookingBuilderCancel}>Cancel</Button>
                                    <Button onClick={handleBookingBuilderSave}>Save Layout</Button>
                                </>
                            ) : (
                                <Button onClick={handleBookingBuilderEdit}><Edit className="mr-2 h-4 w-4"/>Edit Design</Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-10">
                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2"><ImageIcon className="w-4 h-4"/> Landing Hook</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label>Custom Hero Image</Label>
                                    <ImageUpload onImageUploaded={(url) => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroImageUrl: url}}))} initialImage={tenantData.bookingPageSettings?.heroImageUrl} />
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Hero Headline</Label>
                                        <Input value={tenantData.bookingPageSettings?.heroTitle || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroTitle: e.target.value}}))} placeholder="e.g., Welcome to Excellence" disabled={!isBookingBuilderEditing} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Welcome Text (Hero)</Label>
                                        <Input value={tenantData.bookingPageSettings?.heroSubtitle || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroSubtitle: e.target.value}}))} placeholder="e.g., Your transformation starts here." disabled={!isBookingBuilderEditing} />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Welcome Quote (Intro Section)</Label>
                                <Textarea value={tenantData.bookingPageSettings?.welcomeMessage || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, welcomeMessage: e.target.value}}))} placeholder="A personalized welcome note for your clients..." disabled={!isBookingBuilderEditing} />
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2"><Palette className="w-4 h-4"/> Brand Theme</h3>
                            <div className="space-y-2">
                                <Label>Primary Brand Color</Label>
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl border shadow-sm" style={{ backgroundColor: tenantData.bookingPageSettings?.primaryColor || 'hsl(var(--primary))' }} />
                                    <Input value={tenantData.bookingPageSettings?.primaryColor || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, primaryColor: e.target.value}}))} placeholder="e.g., #000000 or hsl(210, 40%, 55%)" disabled={!isBookingBuilderEditing} className="font-mono" />
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2"><ListChecks className="w-4 h-4"/> Visibility & Copy</h3>
                            <p className="text-xs text-muted-foreground">Toggle sections on/off and customize the terminology used.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                {[
                                    { key: 'Team', label: 'Pro Team', icon: <Users className="w-4 h-4"/>, titleKey: 'teamSectionTitle', showKey: 'showTeam' },
                                    { key: 'Reviews', label: 'Reviews', icon: <Star className="w-4 h-4"/>, titleKey: 'reviewsSectionTitle', showKey: 'showReviews' },
                                    { key: 'Gallery', label: 'Portfolio/Gallery', icon: <ImageIcon className="w-4 h-4"/>, titleKey: 'gallerySectionTitle', showKey: 'showGallery' },
                                    { key: 'Faq', label: 'FAQ', icon: <CircleHelp className="w-4 h-4"/>, titleKey: 'faqSectionTitle', showKey: 'showFaq' },
                                    { key: 'Memberships', label: 'Memberships', icon: <Award className="w-4 h-4"/>, titleKey: 'membershipsSectionTitle', showKey: 'showMemberships' },
                                    { key: 'Packages', label: 'Packages', icon: <Repeat className="w-4 h-4"/>, titleKey: 'packagesSectionTitle', showKey: 'showPackages' }
                                ].map(section => (
                                    <div key={section.key} className="space-y-3 p-4 rounded-xl border bg-muted/10">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 font-bold text-sm">{section.icon}{section.label}</div>
                                            <Switch 
                                                checked={tenantData.bookingPageSettings?.[section.showKey as keyof BookingPageSettings] !== false} 
                                                onCheckedChange={(val) => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, [section.showKey]: val}}))}
                                                disabled={!isBookingBuilderEditing}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase font-black text-muted-foreground">Display Title</Label>
                                            <Input 
                                                value={tenantData.bookingPageSettings?.[section.titleKey as keyof BookingPageSettings] as string || ''} 
                                                onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, [section.titleKey]: e.target.value}}))}
                                                placeholder={`e.g., ${section.label}`}
                                                disabled={!isBookingBuilderEditing}
                                                className="h-8 text-xs"
                                            />
                                        </div>
                                        
                                        {/* EXPANDED REVIEWS CURATION */}
                                        {section.key === 'Reviews' && tenantData.bookingPageSettings?.showReviews !== false && (
                                            <div className="pt-4 mt-2 border-t border-dashed space-y-4">
                                                <p className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                                                    <Sparkles className="w-3 h-3" /> Sentiment Curation
                                                </p>
                                                <ScrollArea className="h-[200px] -mx-2 px-2">
                                                    <div className="space-y-2 pr-4">
                                                        {reviews && reviews.length > 0 ? (
                                                            reviews.sort((a,b) => (a.isFeatured ? -1 : 1)).map(review => (
                                                                <SentimentCurationItem 
                                                                    key={review.id} 
                                                                    review={review} 
                                                                    onTogglePublic={handleToggleReviewPublic} 
                                                                    onToggleFeatured={handleToggleReviewFeatured} 
                                                                />
                                                            ))
                                                        ) : (
                                                            <p className="text-[9px] font-bold text-center text-muted-foreground py-10 uppercase tracking-widest opacity-40">Archive Idle</p>
                                                        )}
                                                    </div>
                                                </ScrollArea>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <MessageCircleQuestion className="w-4 h-4"/> FAQ Management
                                </h3>
                                <Button variant="outline" size="sm" onClick={handleAddFaq} disabled={!isBookingBuilderEditing}>
                                    <Plus className="w-4 h-4 mr-2" /> Add Question
                                </Button>
                            </div>
                            <div className="space-y-4">
                                {(tenantData.bookingPageSettings?.faqs || []).map((faq) => (
                                    <div key={faq.id} className="p-4 rounded-xl border-2 bg-muted/10 space-y-4 group">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1 space-y-4">
                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Question</Label>
                                                    <Input 
                                                        value={faq.question} 
                                                        onChange={e => handleUpdateFaq(faq.id, 'question', e.target.value)} 
                                                        disabled={!isBookingBuilderEditing}
                                                        placeholder="e.g., What is your cancellation policy?"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Answer</Label>
                                                    <Textarea 
                                                        value={faq.answer} 
                                                        onChange={e => handleUpdateFaq(faq.id, 'answer', e.target.value)} 
                                                        disabled={!isBookingBuilderEditing}
                                                        placeholder="Enter answer details..."
                                                        rows={2}
                                                    />
                                                </div>
                                            </div>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="text-destructive h-8 w-8" 
                                                onClick={() => handleRemoveFaq(faq.id)}
                                                disabled={!isBookingBuilderEditing}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {(tenantData.bookingPageSettings?.faqs || []).length === 0 && (
                                    <p className="text-xs text-center text-muted-foreground py-10 border-2 border-dashed rounded-xl">No custom FAQs added. We'll show the defaults.</p>
                                )}
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <ImagePlus className="w-4 h-4"/> Gallery Management
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {(tenantData.bookingPageSettings?.gallery || []).map((item) => (
                                    <div key={item.id} className="relative group aspect-square rounded-2xl overflow-hidden border-2 bg-muted">
                                        <img src={item.url} alt="Gallery item" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-between">
                                            <div className="flex justify-end">
                                                <Button 
                                                    variant="destructive" 
                                                    size="icon" 
                                                    className="h-8 w-8 rounded-full" 
                                                    onClick={() => handleRemoveGalleryImage(item.id)}
                                                    disabled={!isBookingBuilderEditing}
                                                >
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                            <Input 
                                                value={item.caption || ''} 
                                                onChange={e => handleUpdateGalleryCaption(item.id, e.target.value)} 
                                                placeholder="Add caption..."
                                                className="h-8 text-[10px] bg-white/20 border-none text-white placeholder:text-white/60"
                                                disabled={!isBookingBuilderEditing}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {isBookingBuilderEditing && (
                                    <div className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-4 text-center">
                                        <ImagePlus className="w-8 h-8 text-muted-foreground mb-2" />
                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-4">Add Images</p>
                                        <ImageUpload onImageUploaded={handleAddGalleryImage} multiple={true} clearOnUpload={true} />
                                    </div>
                                )}
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
                            <CardDescription>Manage your smart walk-in queue logic.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                        {isQueueEditing ? (
                            <>
                                <Button variant="outline" onClick={handleQueueCancel}>Cancel</Button>
                                <Button onClick={handleQueueSave}>Save</Button>
                            </>
                        ) : (
                            <Button onClick={handleQueueEdit}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                        )}
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
                            <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" />Messaging & Notifications</CardTitle>
                            <CardDescription>Configure your Twilio settings for SMS updates.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                        {isSmsEditing ? (
                            <>
                                <Button variant="outline" onClick={handleSmsCancel}>Cancel</Button>
                                <Button onClick={handleSmsSave}>Save</Button>
                            </>
                        ) : (
                            <Button onClick={handleSmsEdit}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2"><Label htmlFor="twilio-sid">Twilio Account SID</Label><Input id="twilio-sid" value={tenantData.twilioAccountSid || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAccountSid: e.target.value}))} placeholder="AC..." disabled={!isSmsEditing} /></div>
                        <div className="space-y-2"><Label htmlFor="twilio-token">Twilio Auth Token</Label><Input id="twilio-token" type="password" value={tenantData.twilioAuthToken || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAuthToken: e.target.value}))} placeholder="••••" disabled={!isSmsEditing}/></div>
                        <div className="space-y-2"><Label htmlFor="twilio-phone">Twilio Phone Number</Label><Input id="twilio-phone" value={tenantData.twilioPhoneNumber || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioPhoneNumber: e.target.value}))} placeholder="+15551234567" disabled={!isSmsEditing}/></div>
                    </CardContent>
                </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader className="animate-spin" /></div>}>
      <SettingsContent />
    </Suspense>
  )
}
