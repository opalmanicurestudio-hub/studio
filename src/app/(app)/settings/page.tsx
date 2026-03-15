
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
import { 
  Building, 
  Clock, 
  FileText, 
  Edit, 
  Check, 
  Globe, 
  Palette, 
  ImageIcon, 
  CircleHelp, 
  Award, 
  Star, 
  Repeat, 
  Plus, 
  X, 
  MessageCircleQuestion, 
  ImagePlus, 
  Activity, 
  CheckCircle2, 
  Sparkles, 
  Zap, 
  ShieldAlert,
  Ban,
  Calculator,
  Users,
  Info,
  TrendingDown,
  Landmark,
  TrendingUp,
  MessageSquare,
  ListChecks,
  Loader,
  DollarSign,
  ShieldCheck,
  Target,
  Smartphone
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { type Tenant, type BookingPageSettings, type BookingFAQItem, type BookingGalleryItem, type Review, type Service, type PricingTier, type Staff } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { nanoid } from 'nanoid';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format, parseISO, isSameMonth } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { motion, AnimatePresence } from 'framer-motion';

const DayHoursRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const hour = Math.floor(i / 2);
    const minute = i % 2 === 0 ? '00' : '30';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:${minute} ${period}`;
  });

  return (
    <div className="flex items-center gap-4 p-4 border-b last:border-b-0 text-left">
      <div className="flex items-center gap-3 w-32 shrink-0">
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
          <SelectTrigger className="h-10 rounded-xl border-2 font-bold bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-2 shadow-2xl">
            {timeOptions.map(time => <SelectItem key={`${day}-start-${time}`} value={time} className="font-bold uppercase text-[10px] tracking-widest">{time}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={dayData.end}
          onValueChange={(value) => onDayChange('end', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger className="h-10 rounded-xl border-2 font-bold bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-2 shadow-2xl">
            {timeOptions.map(time => <SelectItem key={`${day}-end-${time}`} value={time} className="font-bold uppercase text-[10px] tracking-widest">{time}</SelectItem>)}
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
  const { services, inventory, staff, pricingTiers } = useInventory();
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
    const policiesFields: (keyof Tenant)[] = [
        'lateArrivalGracePeriod', 
        'lateInconveniencePremium', 
        'cancellationWindowHours', 
        'cancellationFee', 
        'noShowFee', 
        'autoCancelLateArrivals', 
        'allowDiscountStacking', 
        'requireTillWitness',
        'cancellationPolicy', 
        'lateArrivalPolicy', 
        'noShowPolicy',
        'defaultCancellationMode',
        'defaultRescheduleMode'
    ];
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

  const recoveryMatrixPreview = useMemo(() => {
      if (!services || !selectedTenant || !pricingTiers || !staff) return [];
      const tmhr = selectedTenant.tmhr || 50;
      const taxBurden = selectedTenant.employerTaxBurdenPct || 10;

      return services.slice(0, 5).map(s => {
          const houseFloor = (s.duration / 60) * tmhr + (s.cost || 0);
          
          // Use median pro or first pro for preview logic
          const seniorPro = staff.find(sm => pricingTiers.find(pt => pt.id === sm.pricingTierId)?.name.toLowerCase().includes('senior')) || staff[0];
          const seniorTier = s.serviceTiers?.find(t => t.tierId === seniorPro?.pricingTierId);
          const price = seniorTier ? seniorTier.price : s.price;
          
          let labor = 0;
          if (seniorPro?.payStructure === 'commission') labor = price * (seniorPro.commissionRate / 100);
          else if (seniorPro?.payStructure === 'hourly' && seniorPro.hourlyRate) labor = (s.duration / 60) * seniorPro.hourlyRate;
          
          const totalTarget = houseFloor + (labor * (1 + (taxBurden / 100)));

          return {
              name: s.name,
              houseFloor,
              totalTarget
          };
      });
  }, [services, selectedTenant, staff, pricingTiers]);

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

  const isLoadingTotal = isTenantContextLoading || (selectedTenant && scheduleProfilesLoading);
  
  const tabs = [
    { value: "profile", label: "Profile", icon: <Building className="w-4 h-4" /> },
    { value: "hours", label: "Hours", icon: <Clock className="w-4 h-4" /> },
    { value: "policies", label: "Policies", icon: <FileText className="w-4 h-4" /> },
    { value: "builder", label: "Page Builder", icon: <Globe className="w-4 h-4" /> },
    { value: "queue", label: "Queue", icon: <ListChecks className="w-4 h-4" /> },
    { value: "messaging", label: "Messaging", icon: <MessageSquare className="w-4 h-4" /> },
  ];

  if (isLoadingTotal) {
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
          <div className="text-left">
            <h1 className="text-3xl font-bold">Business Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage your application-wide settings and configurations.
            </p>
          </div>
          
           <Tabs defaultValue="profile" value={activeTab} onValueChange={setActiveTab} className="w-full">
             <div className="md:hidden">
              <Select onValueChange={setActiveTab} value={activeTab}>
                <SelectTrigger className="w-full h-12 rounded-xl border-2">
                    <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-2 shadow-2xl">
                  {tabs.map(tab => (
                    <SelectItem key={tab.value} value={tab.value} className="font-bold uppercase text-[10px] tracking-widest">
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
                    <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 shadow-inner">
                        {tabs.map(tab => (
                        <TabsTrigger key={tab.value} value={tab.value} className="rounded-xl font-black text-[10px] uppercase tracking-widest px-6 h-10 data-[state=active]:bg-white data-[state=active]:shadow-md">
                            {React.cloneElement(tab.icon as React.ReactElement, { className: "mr-2" })}
                            {tab.label}
                        </TabsTrigger>
                        ))}
                    </TabsList>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>
             </div>

            <TabsContent value="profile" className="mt-6 text-left">
                <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
                    <CardHeader className="bg-muted/5 border-b p-6 sm:p-8">
                        <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight"><Building className="w-5 h-5 text-primary"/>Business Profile</CardTitle>
                        <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Manage your business locations and branding.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 sm:p-8 space-y-2 text-left">
                        {tenants.map(tenant => (
                            <div key={tenant.id} className="flex items-center justify-between p-4 bg-muted/20 rounded-2xl border-2 border-transparent hover:border-primary/10 transition-all">
                                {editingTenantId === tenant.id ? (
                                    <div className="flex-1 flex items-center gap-2">
                                        <Input
                                            value={tempTenantName}
                                            onChange={(e) => setTempTenantName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && setEditingTenantId(null)}
                                            className="h-11 rounded-xl border-2 font-black uppercase"
                                            autoFocus
                                        />
                                        <Button size="icon" className="h-11 w-11 rounded-xl" onClick={() => setEditingTenantId(null)}>
                                            <Check className="h-5 w-5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <React.Fragment>
                                        <p className="font-black uppercase tracking-tight text-sm">{tenant.name}</p>
                                        <div className="flex items-center gap-2">
                                            {tenant.id === selectedTenant?.id && <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] uppercase tracking-widest h-5 px-2">Active</Badge>}
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => { setEditingTenantId(tenant.id); setTempTenantName(tenant.name); }}>
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

            <TabsContent value="hours" className="mt-6 text-left">
                 <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/5 border-b p-6 sm:p-8">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
                                <Clock className="w-5 h-5 text-primary" />
                                Business Hours
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Set your standard availability.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                        {isScheduleEditing ? (
                            <>
                                <Button variant="outline" onClick={handleScheduleCancel} className="h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                <Button onClick={handleScheduleSave} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Save Schedule</Button>
                            </>
                        ) : (
                            <Button onClick={handleScheduleEdit} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"><Edit className="mr-2 h-3.5 w-3.5"/>Modify</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                    {activeScheduleProfile && (
                        <div className="divide-y-2 divide-dashed divide-border/50">
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

            <TabsContent value="policies" className="mt-6 space-y-10 text-left">
                <Card className="border-2 shadow-sm rounded-3xl overflow-hidden text-left">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/5 border-b p-6 sm:p-8">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
                            <FileText className="w-5 h-5 text-primary" />
                            Policy & Recovery Manifest
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                            Configure how the studio recovers overhead from late moves.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                        {isPoliciesEditing ? (
                            <>
                                <Button variant="outline" onClick={handlePoliciesCancel} className="h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                <Button onClick={handlePoliciesSave} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Save Manifest</Button>
                            </>
                        ) : (
                            <Button onClick={handlePoliciesEdit} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"><Edit className="mr-2 h-3.5 w-3.5"/>Modify</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 sm:p-8 space-y-12">
                        <div className="space-y-8">
                            <div className="space-y-1">
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                    <Target className="w-4 h-4" /> Recovery Strategy Defaults
                                </h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60 ml-6">These protocols populate the planner when a move occurs.</p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner text-left">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Default Cancellation Protocol</Label>
                                    <RadioGroup 
                                        value={tenantData.defaultCancellationMode || 'matrix'} 
                                        onValueChange={(v: any) => setTenantData(prev => ({...prev, defaultCancellationMode: v}))}
                                        disabled={!isPoliciesEditing}
                                        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                                    >
                                        <label htmlFor="mode-c-matrix" className="cursor-pointer">
                                            <div className={cn("p-3 rounded-xl border-2 text-center transition-all h-full flex flex-col justify-center", tenantData.defaultCancellationMode === 'matrix' || !tenantData.defaultCancellationMode ? "border-primary bg-white shadow-md text-primary" : "border-transparent text-slate-400 opacity-60")}>
                                                <span className="text-[9px] font-black uppercase">Itemized Matrix</span>
                                                <RadioGroupItem value="matrix" id="mode-c-matrix" className="sr-only" />
                                            </div>
                                        </label>
                                        <label htmlFor="mode-c-flat" className="cursor-pointer">
                                            <div className={cn("p-3 rounded-xl border-2 text-center transition-all h-full flex flex-col justify-center", tenantData.defaultCancellationMode === 'flat' ? "border-primary bg-white shadow-md text-primary" : "border-transparent text-slate-400 opacity-60")}>
                                                <span className="text-[9px] font-black uppercase">Studio Flat Rate</span>
                                                <RadioGroupItem value="flat" id="mode-c-flat" className="sr-only" />
                                            </div>
                                        </label>
                                    </RadioGroup>
                                </div>

                                <div className="space-y-4 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner text-left">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Default Reschedule Protocol</Label>
                                    <RadioGroup 
                                        value={tenantData.defaultRescheduleMode || 'matrix'} 
                                        onValueChange={(v: any) => setTenantData(prev => ({...prev, defaultRescheduleMode: v}))}
                                        disabled={!isPoliciesEditing}
                                        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                                    >
                                        <label htmlFor="mode-r-matrix" className="cursor-pointer">
                                            <div className={cn("p-3 rounded-xl border-2 text-center transition-all h-full flex flex-col justify-center", tenantData.defaultRescheduleMode === 'matrix' || !tenantData.defaultRescheduleMode ? "border-primary bg-white shadow-md text-primary" : "border-transparent text-slate-400 opacity-60")}>
                                                <span className="text-[9px] font-black uppercase">Itemized Matrix</span>
                                                <RadioGroupItem value="matrix" id="mode-r-matrix" className="sr-only" />
                                            </div>
                                        </label>
                                        <label htmlFor="mode-r-flat" className="cursor-pointer">
                                            <div className={cn("p-3 rounded-xl border-2 text-center transition-all h-full flex flex-col justify-center", tenantData.defaultRescheduleMode === 'flat' ? "border-primary bg-white shadow-md text-primary" : "border-transparent text-slate-400 opacity-60")}>
                                                <span className="text-[9px] font-black uppercase">Studio Flat Rate</span>
                                                <RadioGroupItem value="flat" id="mode-r-flat" className="sr-only" />
                                            </div>
                                        </label>
                                    </RadioGroup>
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t-2 border-dashed">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Calculator className="w-3.5 h-3.5" /> Profitable Recovery Matrix (Live Preview)
                                </Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {recoveryMatrixPreview.map(item => (
                                        <div key={item.name} className="p-5 rounded-[2rem] bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all text-left space-y-3 shadow-inner">
                                            <p className="text-[10px] font-black uppercase text-slate-900 truncate">{item.name}</p>
                                            <div className="flex justify-between items-baseline">
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Matrix Target</span>
                                                    <span className="text-xl font-black font-mono tracking-tighter text-primary">${item.totalTarget.toFixed(2)}</span>
                                                </div>
                                                <div className="text-right flex flex-col">
                                                    <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Floor Cost</span>
                                                    <span className="text-xs font-black font-mono text-slate-600">${item.houseFloor.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-5 rounded-2xl border-2 border-dashed bg-primary/[0.02] flex items-start gap-4">
                                    <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
                                    <p className="text-[10px] font-bold uppercase text-slate-600 leading-relaxed tracking-tight text-left">
                                        Suggested targets calculate <strong>House Floor</strong> (Time @ TMHR + Materials) plus <strong>Provider Labor</strong> (Intended Commission/Wages). This ensures your studio stays profitable even during late notice moves.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Global Guardrails (Default Window)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-3">
                                    <Label htmlFor="cancel-window-glob" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Standard Window (Hours)</Label>
                                    <Input id="cancel-window-glob" type="number" value={tenantData.cancellationWindowHours || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationWindowHours: Number(e.target.value)}))} placeholder="e.g., 24" className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5" disabled={!isPoliciesEditing} />
                                </div>
                                <div className="space-y-3">
                                    <Label htmlFor="flat-fee-glob" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Standard Flat Fee Override ($)</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                        <Input id="flat-fee-glob" type="number" value={tenantData.cancellationFee || ''} onChange={(e) => setTenantData(prev => ({...prev, cancellationFee: Number(e.target.value)}))} placeholder="e.g., 25.00" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner bg-muted/5" disabled={!isPoliciesEditing}/>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="builder" className="mt-6 space-y-6 text-left">
                <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/5 border-b p-6 sm:p-8">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
                                <Globe className="w-5 h-5 text-primary" />
                                Page Builder
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Skin your guest experience.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {isBookingBuilderEditing ? (
                                <>
                                    <Button variant="outline" onClick={handleBookingBuilderCancel} className="h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                    <Button onClick={handleBookingBuilderSave} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Commit Design</Button>
                                </>
                            ) : (
                                <Button onClick={handleBookingBuilderEdit} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"><Edit className="mr-2 h-3.5 w-3.5"/>Edit Design</Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 sm:p-8 space-y-12">
                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><ImageIcon className="w-4 h-4"/> Landing Hook</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Custom Hero Banner</Label>
                                    <ImageUpload onImageUploaded={(url) => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroImageUrl: url}}))} initialImage={tenantData.bookingPageSettings?.heroImageUrl} />
                                </div>
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Hero Headline</Label>
                                        <Input value={tenantData.bookingPageSettings?.heroTitle || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroTitle: e.target.value}}))} placeholder="e.g., Welcome to Excellence" className="h-12 rounded-xl border-2 font-black uppercase tracking-tight" disabled={!isBookingBuilderEditing} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Sub-Headline</Label>
                                        <Input value={tenantData.bookingPageSettings?.heroSubtitle || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, heroSubtitle: e.target.value}}))} placeholder="e.g., Secure your transformation." className="h-12 rounded-xl border-2 font-bold" disabled={!isBookingBuilderEditing} />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Introductory Mission</Label>
                                <Textarea value={tenantData.bookingPageSettings?.welcomeMessage || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, welcomeMessage: e.target.value}}))} placeholder="Draft a personalized welcome for your community..." className="rounded-2xl border-2 bg-muted/5 font-medium leading-relaxed min-h-[120px]" disabled={!isBookingBuilderEditing} />
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><Palette className="w-4 h-4"/> Brand Signature</h3>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Primary Theme Color</Label>
                                <div className="flex items-center gap-6 p-6 rounded-[2.5rem] border-2 bg-muted/5 shadow-inner">
                                    <div className="w-20 h-20 rounded-[1.5rem] border-4 border-white shadow-2xl shrink-0" style={{ backgroundColor: tenantData.bookingPageSettings?.primaryColor || 'hsl(var(--primary))' }} />
                                    <div className="flex-1 space-y-2">
                                        <Input value={tenantData.bookingPageSettings?.primaryColor || ''} onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, primaryColor: e.target.value}}))} placeholder="HEX or HSL code..." disabled={!isBookingBuilderEditing} className="h-12 rounded-xl border-2 font-mono font-black tracking-widest" />
                                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">Controls buttons, links, and accents.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-8">
                            <div className="space-y-1 text-left">
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><ListChecks className="w-4 h-4"/> Visibility & Nomenclature</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60 ml-6">Toggle modules and customize terminology.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {[
                                    { key: 'Team', label: 'Technicians', icon: <Users className="w-4 h-4"/>, titleKey: 'teamSectionTitle', showKey: 'showTeam' },
                                    { key: 'Reviews', label: 'Sentiment', icon: <Star className="w-4 h-4"/>, titleKey: 'reviewsSectionTitle', showKey: 'showReviews' },
                                    { key: 'Gallery', label: 'Portfolio', icon: <ImageIcon className="w-4 h-4"/>, titleKey: 'gallerySectionTitle', showKey: 'showGallery' },
                                    { key: 'Faq', label: 'FAQ', icon: <CircleHelp className="w-4 h-4"/>, titleKey: 'faqSectionTitle', showKey: 'showFaq' },
                                    { key: 'Memberships', label: 'Access Clubs', icon: <Award className="w-4 h-4"/>, titleKey: 'membershipsSectionTitle', showKey: 'showMemberships' },
                                    { key: 'Packages', label: 'Secure Bundles', icon: <Repeat className="w-4 h-4"/>, titleKey: 'packagesSectionTitle', showKey: 'showPackages' }
                                ].map(section => (
                                    <div key={section.key} className="space-y-4 p-6 rounded-[2rem] border-2 bg-muted/10 shadow-inner group transition-all hover:bg-muted/20 text-left">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3 font-black uppercase tracking-tight text-xs text-slate-900">{section.icon}{section.label}</div>
                                            <Switch 
                                                checked={tenantData.bookingPageSettings?.[section.showKey as keyof BookingPageSettings] !== false} 
                                                onCheckedChange={(val) => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, [section.showKey]: val}}))}
                                                disabled={!isBookingBuilderEditing}
                                                className="scale-110"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[8px] uppercase font-black text-muted-foreground tracking-widest ml-1">Module Heading</Label>
                                            <Input 
                                                value={tenantData.bookingPageSettings?.[section.titleKey as keyof BookingPageSettings] as string || ''} 
                                                onChange={e => setTenantData(p => ({...p, bookingPageSettings: {...p.bookingPageSettings, [section.titleKey]: e.target.value}}))}
                                                placeholder={`e.g., ${section.label}`}
                                                disabled={!isBookingBuilderEditing}
                                                className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-tight bg-white"
                                            />
                                        </div>
                                        
                                        {section.key === 'Reviews' && tenantData.bookingPageSettings?.showReviews !== false && (
                                            <div className="pt-4 mt-2 border-t border-dashed border-primary/10 space-y-4">
                                                <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.2em] flex items-center gap-2 px-1">
                                                    <Sparkles className="w-3 h-3" /> Sentiment Curation
                                                </p>
                                                <ScrollArea className="h-[200px]">
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
                                                            <p className="text-[9px] font-black text-center text-muted-foreground py-10 uppercase tracking-widest opacity-40 border-2 border-dashed rounded-xl">Archive Idle</p>
                                                        )}
                                                    </div>
                                                </ScrollArea>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-8">
                            <div className="flex items-center justify-between px-1">
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                    <MessageCircleQuestion className="w-4 h-4"/> Intel Repository (FAQ)
                                </h3>
                                <Button variant="outline" size="sm" onClick={handleAddFaq} disabled={!isBookingBuilderEditing} className="h-10 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest bg-white">
                                    <Plus className="w-3.5 h-3.5 mr-2" /> Add Logic Entry
                                </Button>
                            </div>
                            <div className="space-y-4">
                                {(tenantData.bookingPageSettings?.faqs || []).map((faq) => (
                                    <div key={faq.id} className="p-6 rounded-[2rem] border-2 bg-muted/10 space-y-6 group relative transition-all hover:bg-muted/20">
                                        <div className="space-y-4">
                                            <div className="space-y-1.5">
                                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Question Protocol</Label>
                                                <Input 
                                                    value={faq.question} 
                                                    onChange={e => handleUpdateFaq(faq.id, 'question', e.target.value)} 
                                                    disabled={!isBookingBuilderEditing}
                                                    placeholder="ENTER QUERY..."
                                                    className="h-12 rounded-xl border-2 font-black uppercase text-xs bg-white"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Resolution Response</Label>
                                                <Textarea 
                                                    value={faq.answer} 
                                                    onChange={e => handleUpdateFaq(faq.id, 'answer', e.target.value)} 
                                                    disabled={!isBookingBuilderEditing}
                                                    placeholder="PROVIDE LOGIC..."
                                                    rows={3}
                                                    className="rounded-xl border-2 bg-white font-medium"
                                                />
                                            </div>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="absolute top-4 right-4 text-destructive h-8 w-8 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" 
                                            onClick={() => handleRemoveFaq(faq.id)}
                                            disabled={!isBookingBuilderEditing}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ))}
                                {(tenantData.bookingPageSettings?.faqs || []).length === 0 && (
                                    <div className="text-center py-20 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <MessageCircleQuestion className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Manual FAQs</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-8">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><ImagePlus className="w-4 h-4"/> Asset Gallery</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                                {(tenantData.bookingPageSettings?.gallery || []).map((item) => (
                                    <div key={item.id} className="relative group aspect-[4/5] rounded-[2rem] overflow-hidden border-4 border-white shadow-2xl bg-muted ring-1 ring-border/50">
                                        <img src={item.url} alt="Gallery item" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                                        <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-all duration-500 p-6 flex flex-col justify-between">
                                            <div className="flex justify-end">
                                                <Button 
                                                    variant="destructive" 
                                                    size="icon" 
                                                    className="h-10 w-10 rounded-2xl shadow-xl shadow-destructive/20 border-2 border-white/20" 
                                                    onClick={() => handleRemoveGalleryImage(item.id)}
                                                    disabled={!isBookingBuilderEditing}
                                                >
                                                    <X className="w-5 h-5" />
                                                </Button>
                                            </div>
                                            <Input 
                                                value={item.caption || ''} 
                                                onChange={e => handleUpdateGalleryCaption(item.id, e.target.value)} 
                                                placeholder="LABEL ASSET..."
                                                className="h-10 rounded-xl bg-white/20 border-none text-white font-black uppercase text-[10px] tracking-widest placeholder:text-white/60 backdrop-blur-md"
                                                disabled={!isBookingBuilderEditing}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {isBookingBuilderEditing && (
                                    <div className="aspect-[4/5] rounded-[2rem] border-4 border-dashed border-primary/20 bg-primary/[0.02] flex flex-col items-center justify-center p-8 text-center space-y-4 shadow-inner">
                                        <div className="p-4 bg-primary/10 rounded-full"><ImagePlus className="w-8 h-8 text-primary" /></div>
                                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Ingest Visual Assets</p>
                                        <ImageUpload onImageUploaded={handleAddGalleryImage} multiple={true} clearOnUpload={true} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="queue" className="mt-6 text-left">
                <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/5 border-b p-6 sm:p-8">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight"><ListChecks className="w-5 h-5 text-primary" />Queue Strategy</CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Manage your smart walk-in queue logic.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                        {isQueueEditing ? (
                            <>
                                <Button variant="outline" onClick={handleQueueCancel} className="h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                <Button onClick={handleQueueSave} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Save Protocol</Button>
                            </>
                        ) : (
                            <Button onClick={handleQueueEdit} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"><Edit className="mr-2 h-3.5 w-3.5"/>Modify</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 sm:p-8">
                        <div className="space-y-3 max-w-sm text-left">
                            <Label htmlFor="skip-timer" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Waitlist Skip Timer (Minutes)</Label>
                            <Input id="skip-timer" type="number" value={tenantData.queueSkipTimeMinutes || ''} onChange={(e) => setTenantData(prev => ({...prev, queueSkipTimeMinutes: Number(e.target.value)}))} placeholder="e.g., 5" disabled={!isQueueEditing} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                            <p className='text-[9px] font-bold text-muted-foreground uppercase opacity-60 ml-1'>Grace period before a guest is auto-skipped in the terminal.</p>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="messaging" className="mt-6 text-left">
                <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/5 border-b p-6 sm:p-8">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight"><MessageSquare className="w-5 h-5 text-primary" />Communications Archive</CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Configure your Twilio settings for secure SMS transmission.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                        {isSmsEditing ? (
                            <>
                                <Button variant="outline" onClick={handleSmsCancel} className="h-10 rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                <Button onClick={handleSmsSave} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Commit Auth</Button>
                            </>
                        ) : (
                            <Button onClick={handleSmsEdit} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"><Edit className="mr-2 h-3.5 w-3.5"/>Modify</Button>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 sm:p-8 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3 text-left"><Label htmlFor="twilio-sid" className="text-[10px] font-black uppercase tracking-widest ml-1">Twilio Account SID</Label><Input id="twilio-sid" value={tenantData.twilioAccountSid || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAccountSid: e.target.value}))} placeholder="AC..." disabled={!isSmsEditing} className="h-12 rounded-xl border-2 font-mono font-bold" /></div>
                            <div className="space-y-3 text-left"><Label htmlFor="twilio-token" className="text-[10px] font-black uppercase tracking-widest ml-1">Secure Auth Token</Label><Input id="twilio-token" type="password" value={tenantData.twilioAuthToken || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioAuthToken: e.target.value}))} placeholder="••••" disabled={!isSmsEditing} className="h-12 rounded-xl border-2" /></div>
                            <div className="space-y-3 md:col-span-2 text-left"><Label htmlFor="twilio-phone" className="text-[10px] font-black uppercase tracking-widest ml-1">Verified Sender Number</Label><Input id="twilio-phone" value={tenantData.twilioPhoneNumber || ''} onChange={(e) => setTenantData(prev => ({...prev, twilioPhoneNumber: e.target.value}))} placeholder="+15551234567" disabled={!isSmsEditing} className="h-14 rounded-2xl border-2 font-black text-xl tracking-widest shadow-inner bg-muted/5 text-center" /></div>
                        </div>
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
