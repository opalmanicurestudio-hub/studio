
'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
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
  Wifi, 
  Coffee,
  ShieldCheck,
  Zap,
  Fingerprint,
  Save,
  Loader,
  ShieldAlert,
  ArrowRight,
  Smartphone,
  Calendar,
  ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Settings as SettingsIcon,
  Unlock,
  DollarSign,
  Scale,
  Percent,
  Target,
  Search,
  ChevronDown,
  Users,
  Box,
  Activity,
  Tag,
  Shield,
  Star,
  Landmark,
  PlusCircle,
  LayoutGrid,
  Sparkles,
  Flame
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '../ui/switch';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc, writeBatch, deleteField } from 'firebase/firestore';
import { type Tenant, type ScheduleProfile, type DayHours, type Service, type PricingTier, type Staff } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '../ui/textarea';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useForm, Controller } from 'react-hook-form';

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-3 mb-6 text-left">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-4 h-4" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Operational Module</p>
            <h3 className="text-sm md:text-base font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const DayHoursRow = ({ day, data, onChange, disabled }: { day: string, data: DayHours, onChange: (day: string, updates: Partial<DayHours>) => void, disabled?: boolean }) => {
    return (
        <div className={cn(
            "flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl border-2 transition-all gap-4",
            data.enabled ? "bg-white border-border" : "bg-muted/30 border-transparent opacity-60"
        )}>
            <div className="flex items-center gap-4 w-full sm:w-auto text-left">
                <Switch 
                    checked={data.enabled} 
                    onCheckedChange={(val) => onChange(day, { enabled: val })} 
                    disabled={disabled}
                />
                <span className="text-xs font-black uppercase tracking-widest w-24 text-left">{day}</span>
            </div>
            
            {data.enabled && (
                <div className="flex items-center gap-6 w-full sm:w-auto">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 sm:w-32 text-left">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-40" />
                            <Input 
                                type="text" 
                                value={data.start} 
                                onChange={e => onChange(day, { start: e.target.value })}
                                disabled={disabled}
                                placeholder="09:00 AM"
                                className="h-10 pl-8 rounded-xl border-2 font-black text-center text-[10px] sm:text-xs"
                            />
                        </div>
                        <span className="text-muted-foreground opacity-40 font-black text-[10px]">TO</span>
                        <div className="relative flex-1 sm:w-32 text-left">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-40" />
                            <Input 
                                type="text" 
                                value={data.end} 
                                onChange={e => onChange(day, { end: e.target.value })}
                                disabled={disabled}
                                placeholder="05:00 PM"
                                className="h-10 pl-8 rounded-xl border-2 font-black text-center text-[10px] sm:text-xs"
                            />
                        </div>
                    </div>
                    <div className="w-px h-8 bg-border hidden sm:block" />
                    <div className="flex-1 sm:w-48">
                        <Select 
                            value={data.accessTier || 'all'} 
                            onValueChange={(v: any) => onChange(day, { accessTier: v })}
                            disabled={disabled}
                        >
                            <SelectTrigger className="h-10 rounded-xl border-2 font-black uppercase text-[9px] bg-primary/[0.02] border-primary/10 text-primary">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                <SelectItem value="all" className="font-bold">ALL GUESTS</SelectItem>
                                <SelectItem value="returning" className="font-bold">RETURNING ONLY</SelectItem>
                                <SelectItem value="members" className="font-bold">MEMBERS ONLY</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}
            {!data.enabled && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Closed</p>
            )}
        </div>
    );
};

const ServicePolicyCard = ({ 
    service, 
    tmhr, 
    inventory, 
    isEditing, 
    localPolicy, 
    onPolicyChange 
}: { 
    service: Service, 
    tmhr: number, 
    inventory: any[], 
    isEditing: boolean, 
    localPolicy?: any, 
    onPolicyChange: (updates: any) => void 
}) => {
    const floor = useMemo(() => {
        const totalDuration = (service.duration / 60) + ((service.padBefore || 0) + (service.padAfter || 0)) / 60;
        const timeCost = totalDuration * tmhr;
        const matCost = (service.products || []).reduce((acc, p) => {
            const item = inventory.find(i => i.id === p.id);
            let cpu = 0;
            if (item) {
                if (item.costingMethod === 'size' && item.size) cpu = (item.costPerUnit || 0) / item.size;
                else if (item.costingMethod === 'uses' && item.estimatedUses) cpu = (item.costPerUnit || 0) / item.estimatedUses;
                else cpu = item.costPerUnit || 0;
            }
            return acc + (cpu * (p.quantityUsed || 1));
        }, 0);
        return timeCost + matCost;
    }, [service, tmhr, inventory]);

    const policy = localPolicy || {
        mode: 'inherit',
        window: undefined,
        value: undefined
    };

    return (
        <Card className={cn(
            "transition-all border-2 rounded-2xl overflow-hidden shadow-sm",
            policy.mode !== 'inherit' ? "border-primary/20 bg-primary/[0.01]" : "bg-white"
        )}>
            <CardHeader className="p-4 border-b bg-muted/5 flex flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 text-left">
                    <div className="p-2 rounded-lg bg-background border shadow-sm">
                        <Star className="w-3.5 h-3.5 text-primary opacity-40" />
                    </div>
                    <div className="min-w-0 text-left">
                        <CardTitle className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate">{service.name}</CardTitle>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">ID: {service.id.slice(-6).toUpperCase()}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-black uppercase text-muted-foreground hidden sm:block">Custom Logic</span>
                    <Switch 
                        checked={policy.mode !== 'inherit'} 
                        onCheckedChange={(checked) => onPolicyChange({ mode: checked ? 'matrix' : 'inherit' })}
                        disabled={!isEditing}
                    />
                </div>
            </CardHeader>
            <AnimatePresence>
                {policy.mode !== 'inherit' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <CardContent className="p-4 space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-2 text-left">
                                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Override Window (h)</Label>
                                    <Input 
                                        type="number" 
                                        value={policy.window || ''} 
                                        onChange={e => onPolicyChange({ window: parseInt(e.target.value) || 0 })}
                                        disabled={!isEditing}
                                        placeholder="Studio Default"
                                        className="h-10 rounded-xl border-2 font-black text-center"
                                    />
                                </div>
                                <div className="space-y-2 text-left">
                                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Recovery Mode</Label>
                                    <Select 
                                        value={policy.mode} 
                                        onValueChange={(v: any) => onPolicyChange({ mode: v })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-2 font-black uppercase text-[9px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            <SelectItem value="matrix" className="font-bold">HOUSE FLOOR (MATRIX)</SelectItem>
                                            <SelectItem value="flat" className="font-bold">FLAT RATE ($)</SelectItem>
                                            <SelectItem value="percentage" className="font-bold">PERCENTAGE (%)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {policy.mode !== 'matrix' && (
                                <div className="space-y-2 animate-in slide-in-from-top-2 text-left">
                                    <Label className="text-[9px] font-black uppercase tracking-widest text-primary ml-1">Fixed Protocol Value</Label>
                                    <div className="relative">
                                        {policy.mode === 'flat' ? <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" /> : <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />}
                                        <Input 
                                            type="number" 
                                            value={policy.value || ''} 
                                            onChange={e => onPolicyChange({ value: parseFloat(e.target.value) || 0 })}
                                            disabled={!isEditing}
                                            className={cn("h-12 rounded-xl border-2 font-black text-lg", policy.mode === 'flat' ? "pl-8" : "pr-8")}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="p-4 rounded-xl bg-muted/20 border-2 border-dashed flex justify-between items-center shadow-inner">
                                <div className="flex items-center gap-2 text-left">
                                    <Landmark className="w-3.5 h-3.5 text-primary opacity-40" />
                                    <span className="text-[9px] font-black uppercase text-muted-foreground">House Floor Minimum</span>
                                    <span className="font-black font-mono text-sm text-slate-900">${floor.toFixed(2)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}

function SettingsPageImpl() {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { selectedTenant, isLoading: isTenantContextLoading } = useTenant();
  const { scheduleProfiles, services, inventory, isLoading: isInventoryLoading } = useInventory();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState(tabParam || 'profile');
  const [isEditing, setIsEditing] = useState(false);
  const [tenantData, setTenantData] = useState<Partial<Tenant>>({});
  
  const [serviceSearch, setServiceSearch] = useState('');
  const [servicePolicies, setServicePolicies] = useState<Record<string, any>>({});

  const { control } = useForm();

  const activeProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);
  const [localSchedule, setLocalSchedule] = useState<any>(null);
  const [localInterval, setLocalInterval] = useState<number>(15);
  const [localKioskSchedule, setLocalKioskSchedule] = useState<any>(null);

  useEffect(() => {
    if (selectedTenant) {
      setTenantData(selectedTenant);
      if (selectedTenant.kioskSettings?.kioskSchedule) {
          setLocalKioskSchedule(selectedTenant.kioskSettings.kioskSchedule);
      }
    }
    if (activeProfile) {
        setLocalSchedule(activeProfile.week);
        setLocalInterval(activeProfile.bookingSlotInterval || 15);
    }
    if (services) {
        const policies: Record<string, any> = {};
        services.forEach(s => {
            policies[s.id] = {
                mode: s.cancellationFeeMode || 'inherit',
                window: s.cancellationWindowHours,
                value: s.customCancellationFee || s.cancellationFeeValue
            };
        });
        setServicePolicies(policies);
    }
  }, [selectedTenant, activeProfile, services]);

  const handleSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
      const batch = writeBatch(firestore);
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
      
      const finalTenantData = {
          ...tenantData,
          kioskSettings: {
              ...tenantData.kioskSettings,
              kioskSchedule: tenantData.kioskSettings?.useSpecificHours ? localKioskSchedule : null
          }
      };
      batch.update(tenantRef, finalTenantData);

      if (activeProfile && localSchedule) {
          const profileRef = doc(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`, activeProfile.id);
          batch.update(profileRef, { 
              week: localSchedule, 
              bookingSlotInterval: localInterval 
          });
      }

      // Sync Service Specific Policies
      Object.entries(servicePolicies).forEach(([id, p]) => {
          const svcRef = doc(firestore, `tenants/${selectedTenant.id}/services`, id);
          const originalService = services.find(s => s.id === id);
          batch.update(svcRef, {
              cancellationFeeMode: p.mode,
              cancellationWindowHours: p.window || (deleteField() as any),
              customCancellationFee: p.mode === 'flat' ? p.value : (p.mode === 'inherit' ? (deleteField() as any) : (originalService?.customCancellationFee || 0)),
              cancellationFeeValue: p.value || (deleteField() as any)
          });
      });

      await batch.commit();
      toast({ title: 'Settings Synchronized', description: 'Studio operational parameters updated.' });
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Save Failed' });
    }
  };

  const handleScheduleChange = (day: string, updates: Partial<DayHours>) => {
      setLocalSchedule((prev: any) => ({
          ...prev,
          [day]: { ...prev[day], ...updates }
      }));
  };

  const handleKioskScheduleChange = (day: string, updates: Partial<DayHours>) => {
      setLocalKioskSchedule((prev: any) => ({
          ...prev,
          [day]: { ...(prev?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }), ...updates }
      }));
  };

  const handlePolicyChange = (id: string, updates: any) => {
      setServicePolicies(prev => ({
          ...prev,
          [id]: { ...prev[id], ...updates }
      }));
  };

  const filteredServices = useMemo(() => {
      if (!services) return [];
      if (!serviceSearch.trim()) return services;
      const s = serviceSearch.toLowerCase();
      return services.filter(svc => svc.name.toLowerCase().includes(s) || (svc.category || '').toLowerCase().includes(s));
  }, [services, serviceSearch]);

  const tabs = [
    { value: "profile", label: "Profile", icon: <Building className="w-4 h-4" /> },
    { value: "hours", label: "Hours", icon: <Clock className="w-4 h-4" /> },
    { value: "experience", label: "Experience", icon: <Coffee className="w-4 h-4" /> },
    { value: "policies", label: "Policies", icon: <FileText className="w-4 h-4" /> },
    { value: "builder", label: "Builder", icon: <Globe className="w-4 h-4" /> },
    { value: "kiosk", label: "Kiosk", icon: <Fingerprint className="w-4 h-4" /> },
  ];

  if (isTenantContextLoading || isInventoryLoading) return <div className="p-8 flex items-center justify-center h-full"><Loader className="animate-spin text-primary" /></div>;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Studio OS Settings" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8 md:space-y-10 p-4 md:p-10 pb-32">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
            <div className="space-y-1 text-left">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Settings</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Studio Orchestration & Governance</p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
                {isEditing ? (
                    <>
                        <Button variant="ghost" onClick={() => setIsEditing(false)} className="flex-1 sm:w-auto h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                        <Button onClick={handleSave} className="flex-[2] sm:w-auto h-12 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Save className="mr-2 h-4 w-4" />Save Archive</Button>
                    </>
                ) : (
                    <Button onClick={() => setIsEditing(true)} className="w-full sm:w-auto h-12 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"><Edit className="mr-2 h-4 w-4" />Modify Logic</Button>
                )}
            </div>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
             <ScrollArea className="w-full">
                <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner mb-8 flex w-max gap-1.5">
                    {tabs.map(tab => (
                    <TabsTrigger key={tab.value} value={tab.value} className="rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest px-4 md:px-6 h-10 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md transition-all text-left">
                        {React.cloneElement(tab.icon as React.ReactElement, { className: "mr-2 hidden sm:block" })}
                        {tab.label}
                    </TabsTrigger>
                    ))}
                </TabsList>
                <ScrollBar orientation="horizontal" className="hidden" />
             </ScrollArea>

            <TabsContent value="profile" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Building} title="Studio Identity" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Registry identification and internal labeling.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-8 text-left">
                        <div className="space-y-3 text-left">
                            <Label htmlFor="studio-name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Business Label</Label>
                            <Input 
                                id="studio-name-edit"
                                value={tenantData.name || ''} 
                                onChange={e => setTenantData(prev => ({...prev, name: e.target.value}))}
                                disabled={!isEditing}
                                placeholder="ENTER STUDIO NAME"
                                className="h-14 rounded-2xl border-2 font-black uppercase text-lg md:text-xl tracking-tighter bg-white shadow-inner"
                            />
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="hours" className="mt-0 space-y-10 animate-in fade-in duration-500">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Clock} title="Operating Window" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Configure your weekly studio availability and access tiers.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10">
                        <div className="space-y-4 max-w-sm text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2 text-left">
                                <Sparkles className="w-3.5 h-3.5" /> Booking Precision (Interval)
                            </Label>
                            <Select 
                                value={String(localInterval)} 
                                onValueChange={(v) => setLocalInterval(parseInt(v))}
                                disabled={!isEditing}
                            >
                                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    <SelectItem value="15" className="font-bold">15 MINUTE SLOTS</SelectItem>
                                    <SelectItem value="30" className="font-bold">30 MINUTE SLOTS</SelectItem>
                                    <SelectItem value="60" className="font-bold">60 MINUTE SLOTS</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase leading-relaxed ml-1 opacity-60 text-left">
                                This determines the time gaps between available sessions on your booking page.
                            </p>
                        </div>

                        <Separator className="border-dashed" />

                        {localSchedule ? (
                            <div className="space-y-3">
                                {Object.entries(localSchedule).map(([day, hours]: [any, any]) => (
                                    <DayHoursRow 
                                        key={day} 
                                        day={day} 
                                        data={hours} 
                                        onChange={handleScheduleChange} 
                                        disabled={!isEditing} 
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="py-12 text-center opacity-30 text-left">
                                <Loader className="animate-spin h-8 w-8 mx-auto" />
                                <p className="text-[10px] font-black uppercase mt-4 tracking-widest text-center">Loading Schedule...</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="experience" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Coffee} title="Hospitality Concierge" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Configure the in-service refreshment and amenity module.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10 text-left">
                        <div className="flex flex-col sm:flex-row items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/5 shadow-inner border-primary/10 gap-6">
                            <div className="space-y-1 text-center sm:text-left">
                                <Label htmlFor="refreshment-toggle" className="text-base font-black uppercase tracking-tight text-slate-900">Activate Refreshment Menu</Label>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Allows guests to request in-stock items from their portal</p>
                            </div>
                            <Switch 
                                id="refreshment-toggle" 
                                checked={!!tenantData.refreshmentServiceEnabled} 
                                onCheckedChange={(val) => setTenantData(prev => ({...prev, refreshmentServiceEnabled: val}))}
                                disabled={!isEditing}
                                className="scale-125 data-[state=checked]:bg-primary"
                            />
                        </div>

                        <div className="space-y-4">
                            <Label htmlFor="amenity-limit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Complimentary Amenity Limit</Label>
                            <div className="space-y-3">
                                <Input 
                                    id="amenity-limit"
                                    type="number"
                                    value={tenantData.complimentaryAmenityLimit || 0}
                                    onChange={e => setTenantData(prev => ({...prev, complimentaryAmenityLimit: parseInt(e.target.value) || 0}))}
                                    disabled={!isEditing}
                                    className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 w-full sm:w-48 text-center"
                                />
                                <p className="text-[9px] font-bold text-muted-foreground uppercase leading-relaxed ml-1 opacity-60 text-left">
                                    Total items allowed per session before caps apply.
                                </p>
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6">
                            <div className="flex items-center gap-3 px-1 text-left">
                                <Wifi className="w-5 h-5 text-primary" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Studio Connectivity</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8">
                                <div className="space-y-2 text-left">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">WiFi Network SSID</Label>
                                    <Input 
                                        value={tenantData.wifiNetwork || ''} 
                                        onChange={e => setTenantData(prev => ({...prev, wifiNetwork: e.target.value}))}
                                        placeholder="e.g., STUDIO_GUEST_5G"
                                        disabled={!isEditing}
                                        className="h-12 rounded-xl border-2 font-bold bg-white"
                                    />
                                </div>
                                <div className="space-y-2 text-left">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Access Password</Label>
                                    <Input 
                                        value={tenantData.wifiPassword || ''} 
                                        onChange={e => setTenantData(prev => ({...prev, wifiPassword: e.target.value}))}
                                        placeholder="••••••••"
                                        disabled={!isEditing}
                                        className="h-12 rounded-xl border-2 font-bold bg-white"
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="policies" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={ShieldCheck} title="Global Studio Governance" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Define studio-wide defaults for late shifts and cancellations.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10 text-left">
                        <div className="space-y-6 text-left">
                            <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-primary/20 bg-primary/5 shadow-xl shadow-primary/5 transition-all">
                                <div className='space-y-1 text-left'>
                                    <Label htmlFor="tight-scheduling-toggle" className="text-base font-black uppercase tracking-tight text-primary flex items-center gap-2">
                                        <LayoutGrid className="w-4 h-4" /> Zero-Gap Protocol
                                    </Label>
                                    <p className='text-[10px] font-bold text-primary/60 uppercase tracking-widest opacity-60 text-left'>Minimize wasted downtime by anchoring guest choice to existing blocks</p>
                                </div>
                                <Switch 
                                    id="tight-scheduling-toggle" 
                                    checked={!!tenantData.tightSchedulingEnabled} 
                                    onCheckedChange={(val) => setTenantData(prev => ({...prev, tightSchedulingEnabled: val}))}
                                    disabled={!isEditing}
                                    className="scale-125 data-[state=checked]:bg-primary"
                                />
                            </div>

                            <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-indigo-500/20 bg-indigo-500/5 shadow-xl shadow-indigo-500/5 transition-all">
                                <div className='space-y-1 text-left'>
                                    <Label htmlFor="morning-anchor-toggle" className="text-base font-black uppercase tracking-tight text-indigo-700 flex items-center gap-2">
                                        <Clock className="w-4 h-4" /> Morning Anchor Protocol
                                    </Label>
                                    <p className='text-[10px] font-bold text-indigo-600/60 uppercase tracking-widest opacity-60 text-left'>The first appointment of an empty day must start at business opening time</p>
                                </div>
                                <Switch 
                                    id="morning-anchor-toggle" 
                                    checked={!!tenantData.morningAnchorEnabled} 
                                    onCheckedChange={(val) => setTenantData(prev => ({...prev, morningAnchorEnabled: val}))}
                                    disabled={!isEditing}
                                    className="scale-125 data-[state=checked]:bg-indigo-600"
                                />
                            </div>

                            <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-amber-500/20 bg-amber-500/5 shadow-xl shadow-amber-500/5 transition-all">
                                <div className='space-y-1 text-left'>
                                    <Label htmlFor="flash-yield-toggle" className="text-base font-black uppercase tracking-tight text-amber-700 flex items-center gap-2">
                                        <Flame className="w-4 h-4" /> Flash Yield Protocol
                                    </Label>
                                    <p className='text-[10px] font-bold text-amber-600/60 uppercase tracking-widest opacity-60 text-left'>Flag 48h cancellations as "magnetic" slots that bypass Zero-Gap restrictions</p>
                                </div>
                                <Switch 
                                    id="flash-yield-toggle" 
                                    checked={!!tenantData.flashYieldEnabled} 
                                    onCheckedChange={(val) => setTenantData(prev => ({...prev, flashYieldEnabled: val}))}
                                    disabled={!isEditing}
                                    className="scale-125 data-[state=checked]:bg-amber-600"
                                />
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-6">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary ml-1 text-left">Default Recovery Strategy</Label>
                            <Controller
                                name="defaultCancellationMode"
                                control={control}
                                defaultValue={tenantData.defaultCancellationMode || 'matrix'}
                                render={({ field }) => (
                                    <RadioGroup onValueChange={(v: any) => setTenantData(p => ({...p, defaultCancellationMode: v}))} value={tenantData.defaultCancellationMode || 'matrix'} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <label htmlFor="mode-matrix" className="cursor-pointer h-full">
                                            <div className={cn(
                                                "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full text-center",
                                                (tenantData.defaultCancellationMode || 'matrix') === 'matrix' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                            )}>
                                                <Scale className={cn("mb-2 h-8 w-8", (tenantData.defaultCancellationMode || 'matrix') === 'matrix' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest leading-tight">Recovery Matrix</span>
                                                <p className="text-[8px] font-bold opacity-40 mt-1 uppercase">Time + Materials</p>
                                                <RadioGroupItem value="matrix" id="mode-matrix" className="sr-only" disabled={!isEditing} />
                                            </div>
                                        </label>
                                        <label htmlFor="mode-percent" className="cursor-pointer h-full">
                                            <div className={cn(
                                                "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full text-center",
                                                tenantData.defaultCancellationMode === 'percentage' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                            )}>
                                                <Percent className={cn("mb-2 h-8 w-8", tenantData.defaultCancellationMode === 'percentage' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest leading-tight">Service Percentage</span>
                                                <p className="text-[8px] font-bold opacity-40 mt-1 uppercase">Price Pro-Rata</p>
                                                <RadioGroupItem value="percentage" id="mode-percent" className="sr-only" disabled={!isEditing} />
                                            </div>
                                        </label>
                                        <label htmlFor="mode-flat" className="cursor-pointer h-full">
                                            <div className={cn(
                                                "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full text-center",
                                                tenantData.defaultCancellationMode === 'flat' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-background hover:border-primary/20"
                                            )}>
                                                <DollarSign className={cn("mb-2 h-8 w-8", tenantData.defaultCancellationMode === 'flat' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest leading-tight">Fixed Rate</span>
                                                <p className="text-[8px] font-bold opacity-40 mt-1 uppercase">Uniform Fee</p>
                                                <RadioGroupItem value="flat" id="mode-flat" className="sr-only" disabled={!isEditing} />
                                            </div>
                                        </label>
                                    </RadioGroup>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-dashed">
                            <div className="space-y-3">
                                <Label htmlFor="cancel-window" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Cancellation Window (Hours)</Label>
                                <Input 
                                    id="cancel-window"
                                    type="number"
                                    value={tenantData.cancellationWindowHours || 0}
                                    onChange={e => setTenantData(prev => ({...prev, cancellationWindowHours: parseInt(e.target.value) || 0}))}
                                    disabled={!isEditing}
                                    className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center"
                                />
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="cancel-fee" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Fixed Flat Fee ($)</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                    <Input 
                                        id="cancel-fee"
                                        type="number"
                                        value={tenantData.cancellationFee || 0}
                                        onChange={e => setTenantData(prev => ({...prev, cancellationFee: parseFloat(e.target.value) || 0}))}
                                        disabled={!isEditing || tenantData.defaultCancellationMode !== 'flat'}
                                        className={cn("h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-primary", tenantData.defaultCancellationMode !== 'flat' && "opacity-40")}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 border-dashed bg-muted/5 shadow-inner">
                            <div className="space-y-1 text-left">
                                <Label htmlFor="allow-deferral" className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                                    <Zap className="w-4 h-4 text-primary" /> Guest Autonomy: Fee Deferral
                                </Label>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Allow guests to add rescheduling fees to their session bill</p>
                            </div>
                            <Switch 
                                id="allow-deferral" 
                                checked={!!tenantData.allowGuestFeeDeferral} 
                                onCheckedChange={(val) => setTenantData(prev => ({...prev, allowGuestFeeDeferral: val}))}
                                disabled={!isEditing}
                                className="scale-125 data-[state=checked]:bg-primary"
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-8">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 px-1 text-left">
                        <div className="space-y-1 text-left">
                            <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">Service-Specific Protocols</h2>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Custom logic guards per treatment unit.</p>
                        </div>
                        <div className="relative w-full md:w-64 text-left">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                            <Input 
                                placeholder="SEARCH MENU..." 
                                value={serviceSearch} 
                                onChange={e => setServiceSearch(e.target.value)}
                                className="pl-9 h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {filteredServices.map(service => (
                            <ServicePolicyCard 
                                key={service.id} 
                                service={service} 
                                tmhr={tenantData.tmhr || 50} 
                                inventory={inventory} 
                                isEditing={isEditing}
                                localPolicy={servicePolicies[service.id]}
                                onPolicyChange={(updates) => handlePolicyChange(service.id, updates)}
                            />
                        ))}
                        {filteredServices.length === 0 && (
                            <div className="col-span-full py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4 text-left">
                                <Activity className="w-12 h-12" />
                                <p className="text-xs font-black uppercase tracking-widest">No matching treatments found</p>
                            </div>
                        )}
                    </div>
                </div>

                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Shield} title="Public Accountability Policies" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Define the narrative for your guest-facing agreements.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-6 text-left">
                        {[
                            { id: 'cancellationPolicy', label: 'Cancellation Policy (Public)', placeholder: 'Describe your requirements for cancelling a session...' },
                            { id: 'lateArrivalPolicy', label: 'Late Arrival Policy (Public)', placeholder: 'Describe grace periods and potential penalties...' },
                            { id: 'noShowPolicy', label: 'No-Show Policy (Public)', placeholder: 'Describe the consequence of missing an appointment...' }
                        ].map(policy => (
                            <div key={policy.id} className="space-y-2">
                                <Label htmlFor={policy.id} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{policy.label}</Label>
                                <Textarea 
                                    id={policy.id}
                                    value={(tenantData as any)[policy.id] || ''}
                                    onChange={e => setTenantData(prev => ({...prev, [policy.id]: e.target.value}))}
                                    disabled={!isEditing}
                                    placeholder={policy.placeholder}
                                    className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20 font-medium"
                                />
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="builder" className="mt-0 space-y-10 animate-in fade-in duration-500">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Globe} title="Booking Page Architecture" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Configure your guest-facing digital presence.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10 text-left">
                        <div className="space-y-8">
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Brand Signature (Logo)</Label>
                                <ImageUpload 
                                    onImageUploaded={(url) => setTenantData(prev => ({...prev, bookingPageSettings: {...prev.bookingPageSettings, logoUrl: url}}))}
                                    initialImage={tenantData.bookingPageSettings?.logoUrl}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Hero Title</Label>
                                    <Input 
                                        value={tenantData.bookingPageSettings?.heroTitle || ''} 
                                        onChange={e => setTenantData(prev => ({...prev, bookingPageSettings: {...prev.bookingPageSettings, heroTitle: e.target.value}}))}
                                        disabled={!isEditing}
                                        className="h-12 rounded-xl border-2 font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Primary Color (Hex)</Label>
                                    <div className="flex gap-2">
                                        <div className="w-12 h-12 rounded-xl border-2 shrink-0 shadow-inner" style={{ backgroundColor: tenantData.bookingPageSettings?.primaryColor || '#7955c4' }} />
                                        <Input 
                                            value={tenantData.bookingPageSettings?.primaryColor || ''} 
                                            onChange={e => setTenantData(prev => ({...prev, bookingPageSettings: {...prev.bookingPageSettings, primaryColor: e.target.value}}))}
                                            disabled={!isEditing}
                                            className="h-12 rounded-xl border-2 font-mono font-black"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Welcome Narrative</Label>
                                <Textarea 
                                    value={tenantData.bookingPageSettings?.welcomeMessage || ''} 
                                    onChange={e => setTenantData(prev => ({...prev, bookingPageSettings: {...prev.bookingPageSettings, welcomeMessage: e.target.value}}))}
                                    disabled={!isEditing}
                                    className="rounded-xl border-2 bg-muted/5 min-h-[100px]"
                                />
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Visibility Protocol</Label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                                {[
                                    { key: 'showTeam', label: 'Pro Team Section' },
                                    { key: 'showReviews', label: 'Guest Feedback' },
                                    { key: 'showFaq', label: 'FAQ Intel' },
                                    { key: 'showGallery', label: 'Portfolio Gallery' },
                                    { key: 'showMemberships', label: 'Club Access' },
                                    { key: 'showPackages', label: 'Prepaid Bundles' },
                                ].map(toggle => (
                                    <div key={toggle.key} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5 shadow-inner">
                                        <span className="text-xs font-black uppercase tracking-tight">{toggle.label}</span>
                                        <Switch 
                                            checked={(tenantData.bookingPageSettings as any)?.[toggle.key] !== false}
                                            onCheckedChange={(val) => setTenantData(prev => ({...prev, bookingPageSettings: {...prev.bookingPageSettings, [toggle.key]: val}}))}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="kiosk" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <SectionHeader icon={Fingerprint} title="Kiosk Orchestration" />
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Manage the check-in terminal experience.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10 text-left">
                        <div className="space-y-8">
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Kiosk Identity (Logo)</Label>
                                <ImageUpload 
                                    onImageUploaded={(url) => setTenantData(prev => ({...prev, kioskSettings: {...prev.kioskSettings, logoUrl: url}}))}
                                    initialImage={tenantData.kioskSettings?.logoUrl}
                                />
                            </div>
                            <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/5 shadow-inner border-primary/10 transition-all">
                                <div className="space-y-1 text-left">
                                    <Label htmlFor="kiosk-hours-toggle" className="text-base font-black uppercase tracking-tight text-primary">Specific Kiosk Hours</Label>
                                    <p className="text-[10px] font-bold text-primary/60 uppercase tracking-widest opacity-60 text-left">Close walk-ins earlier than business hours</p>
                                </div>
                                <Switch 
                                    id="kiosk-hours-toggle" 
                                    checked={!!tenantData.kioskSettings?.useSpecificHours} 
                                    onCheckedChange={(val) => setTenantData(prev => ({...prev, kioskSettings: {...prev.kioskSettings, useSpecificHours: val}}))}
                                    disabled={!isEditing}
                                    className="scale-125 data-[state=checked]:bg-primary"
                                />
                            </div>

                            <AnimatePresence>
                                {tenantData.kioskSettings?.useSpecificHours && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pt-4 border-t border-dashed text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Walk-in Window Schedule</Label>
                                        <div className="space-y-3">
                                            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                                                <DayHoursRow 
                                                    key={`kiosk-${day}`} 
                                                    day={day} 
                                                    data={localKioskSchedule?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }} 
                                                    onChange={handleKioskScheduleChange} 
                                                    disabled={!isEditing} 
                                                />
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
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
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><Loader className="animate-spin h-10 w-10 text-primary" /><p className="ml-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Configuring Terminal...</p></div>}>
      <SettingsPageImpl />
    </Suspense>
  )
}
