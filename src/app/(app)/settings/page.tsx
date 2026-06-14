'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Building, Clock, FileText, Edit, Check, Globe, Palette, Wifi, Coffee,
  ShieldCheck, Zap, Fingerprint, Save, Loader, ShieldAlert, ArrowRight,
  Smartphone, Calendar, ImageIcon, CheckCircle2, AlertTriangle, Settings as SettingsIcon,
  Unlock, DollarSign, Scale, Percent, Target, Search, ChevronDown, Users, Box,
  Activity, Tag, Shield, Star, Landmark, PlusCircle, LayoutGrid, Sparkles,
  Flame, Workflow, Printer, QrCode, Scale as ScaleIcon, HeartHandshake, Trash2,
  FileWarning, MapPin, Timer, TrendingUp, Bell, Coffee as BreakIcon, Eye,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { useFirebase, updateDocumentNonBlocking, useMemoFirebase, useCollection } from '@/firebase';
import { doc, writeBatch, deleteField } from 'firebase/firestore';
import { type Tenant, type ScheduleProfile, type DayHours, type Service, type PricingTier, type Staff, type RecoveryPreset, nanoid } from '@/lib/data';
import { DEFAULT_DEPOSIT_POLICY } from '@/lib/deposit-policy';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, safeNumber, hexToHSLComponents } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useForm, Controller } from 'react-hook-form';
import { PrintStationCardsDialog } from '@/components/concierge/PrintStationCardsDialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { StripeConnectSetup } from '@/components/settings/StripeConnectSetup';

// ─── Constants ────────────────────────────────────────────────────────────────
const defaultRecoveryPresets: RecoveryPreset[] = [
  { id: 'wait-time',     label: 'WAIT TIME RECOVERY',  type: 'fixed',      value: 15  },
  { id: 'tech-adj',      label: 'TECHNICAL REVISION',  type: 'percentage', value: 20  },
  { id: 'hospitality',   label: 'HOSPITALITY LAPSE',   type: 'fixed',      value: 10  },
  { id: 'protocol-fail', label: 'PROTOCOL FAILURE',    type: 'percentage', value: 100 },
];

const defaultEscalationPolicy = "1. Autonomy: Staff are authorized to resolve minor hospitality or technical lapses up to their defined threshold. 2. Criteria: Use 'Recovery Presets' for delays > 15m or technical inconsistencies. 3. Immediate Escalation: Mandatory for medical reactions, property damage, or guest hostility. 4. Documentation: Always log specific reasoning in the Checkout Hub when applying adjustments.";

const KIOSK_COLOR_LIBRARY = [
  { hex: '#0f172a', name: 'Midnight' },    { hex: '#1e293b', name: 'Slate 800' },
  { hex: '#334155', name: 'Slate 700' },   { hex: '#64748b', name: 'Slate 500' },
  { hex: '#e2e8f0', name: 'Slate 200' },   { hex: '#7c3aed', name: 'Violet' },
  { hex: '#6d28d9', name: 'Purple' },      { hex: '#a78bfa', name: 'Lavender' },
  { hex: '#c4b5fd', name: 'Soft Violet' }, { hex: '#ddd6fe', name: 'Pale Lavender' },
  { hex: '#f43f5e', name: 'Rose' },        { hex: '#e11d48', name: 'Deep Rose' },
  { hex: '#fb7185', name: 'Pink' },        { hex: '#fda4af', name: 'Soft Pink' },
  { hex: '#fce7f3', name: 'Blush' },       { hex: '#059669', name: 'Emerald' },
  { hex: '#10b981', name: 'Green' },       { hex: '#34d399', name: 'Mint' },
  { hex: '#6ee7b7', name: 'Sage' },        { hex: '#d1fae5', name: 'Pale Mint' },
  { hex: '#2563eb', name: 'Blue' },        { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#38bdf8', name: 'Light Blue' },  { hex: '#7dd3fc', name: 'Powder' },
  { hex: '#bae6fd', name: 'Pale Blue' },   { hex: '#d97706', name: 'Amber' },
  { hex: '#f59e0b', name: 'Gold' },        { hex: '#fbbf24', name: 'Yellow' },
  { hex: '#fcd34d', name: 'Butter' },      { hex: '#fef3c7', name: 'Cream' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
const SectionHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
  <div className="flex items-center gap-3 mb-6 text-left">
    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
      <Icon className="w-4 h-4" />
    </div>
    <div className="space-y-0.5 text-left">
      <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module Operational</p>
      <h3 className="text-sm md:text-base font-black uppercase tracking-tighter text-slate-900">{title}</h3>
    </div>
  </div>
);

const SettingRow = ({ icon: Icon, color = 'primary', title, description, children }: {
  icon: any; color?: string; title: string; description: string; children: React.ReactNode;
}) => {
  const colorMap: Record<string, string> = {
    primary: 'border-primary/20 bg-primary/5',
    amber:   'border-amber-500/20 bg-amber-500/5',
    green:   'border-green-500/20 bg-green-500/5',
    red:     'border-red-500/20 bg-red-500/5',
    blue:    'border-blue-500/20 bg-blue-500/5',
    slate:   'border-slate-200 bg-slate-50',
  };
  const textMap: Record<string, string> = {
    primary: 'text-primary',
    amber:   'text-amber-700',
    green:   'text-green-700',
    red:     'text-red-700',
    blue:    'text-blue-700',
    slate:   'text-slate-700',
  };
  return (
    <div className={cn('flex items-center justify-between p-5 rounded-[2rem] border-2 gap-6', colorMap[color] || colorMap.primary)}>
      <div className="flex items-start gap-4 min-w-0">
        <div className={cn('p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0 mt-0.5', colorMap[color])}>
          <Icon className={cn('w-4 h-4', textMap[color] || textMap.primary)} />
        </div>
        <div className="space-y-0.5 min-w-0">
          <p className={cn('text-sm font-black uppercase tracking-tight', textMap[color] || textMap.primary)}>{title}</p>
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
};

const NumberInput = ({ value, onChange, disabled, suffix, prefix, min, max, step, placeholder }: any) => (
  <div className="relative flex items-center">
    {prefix && <span className="absolute left-4 text-[10px] font-black uppercase text-muted-foreground opacity-40">{prefix}</span>}
    <Input
      type="number"
      value={value || ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      disabled={disabled}
      min={min} max={max} step={step || 1}
      placeholder={placeholder || '0'}
      className={cn('h-12 rounded-2xl border-2 font-black text-center shadow-inner bg-white', prefix && 'pl-8', suffix && 'pr-8')}
    />
    {suffix && <span className="absolute right-4 text-[10px] font-black uppercase text-muted-foreground opacity-40">{suffix}</span>}
  </div>
);

const DayHoursRow = ({ day, data, onChange, disabled }: {
  day: string; data: DayHours;
  onChange: (day: string, updates: Partial<DayHours>) => void;
  disabled?: boolean;
}) => (
  <div className={cn('flex flex-col items-stretch p-4 md:p-5 rounded-[2rem] border-2 transition-all gap-4', data.enabled ? 'bg-white border-border shadow-sm' : 'bg-muted/30 border-transparent opacity-60')}>
    <div className="flex items-center gap-4 text-left">
      <Switch checked={data.enabled} onCheckedChange={(val) => onChange(day, { enabled: val })} disabled={disabled} />
      <span className="text-xs font-black uppercase tracking-widest w-24 text-left">{day}</span>
    </div>
    {data.enabled && (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative flex-1 text-left">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-40" />
            <Input type="text" value={data.start} onChange={e => onChange(day, { start: e.target.value })} disabled={disabled} placeholder="09:00 AM" className="h-10 pl-8 pr-2 rounded-xl border-2 font-black text-center text-xs bg-background shadow-inner" />
          </div>
          <span className="text-muted-foreground opacity-40 font-black text-[9px] uppercase tracking-tighter shrink-0">to</span>
          <div className="relative flex-1 text-left">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-40" />
            <Input type="text" value={data.end} onChange={e => onChange(day, { end: e.target.value })} disabled={disabled} placeholder="05:00 PM" className="h-10 pl-8 pr-2 rounded-xl border-2 font-black text-center text-xs bg-background shadow-inner" />
          </div>
        </div>
        <div className="space-y-1 text-left">
          <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Priority Access Tier</Label>
          <Select value={data.accessTier || 'all'} onValueChange={(v: any) => onChange(day, { accessTier: v })} disabled={disabled}>
            <SelectTrigger className="h-10 rounded-xl border-2 font-black uppercase text-[9px] bg-primary/[0.02] border-primary/10 text-primary"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              <SelectItem value="all"       className="font-bold uppercase text-[9px] tracking-widest">ALL GUESTS</SelectItem>
              <SelectItem value="returning" className="font-bold uppercase text-[9px] tracking-widest">RETURNING ONLY</SelectItem>
              <SelectItem value="members"   className="font-bold uppercase text-[9px] tracking-widest">MEMBERS & PACKS</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    )}
    {!data.enabled && <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-40 text-left">Closed for Bookings</p>}
  </div>
);

const ServicePolicyCard = ({ service, tmhr, inventory, isEditing, localPolicy, onPolicyChange }: {
  service: Service; tmhr: number; inventory: any[]; isEditing: boolean; localPolicy?: any; onPolicyChange: (updates: any) => void;
}) => {
  const floor = useMemo(() => {
    const duration = safeNumber(service.duration);
    const totalDuration = (duration / 60) + ((service.padBefore || 0) + (service.padAfter || 0)) / 60;
    const timeCost = totalDuration * tmhr;
    const matCost = (service.products || []).reduce((acc, p) => {
      const item = inventory.find((i: any) => i.id === p.id);
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

  const policy = localPolicy || { mode: 'inherit', window: undefined, value: undefined };

  return (
    <Card className={cn('transition-all border-2 rounded-[2rem] overflow-hidden shadow-sm', policy.mode !== 'inherit' ? 'border-primary/20 bg-primary/[0.01]' : 'bg-white')}>
      <CardHeader className="p-4 border-b bg-muted/5 flex flex-row items-center justify-between gap-4 text-left">
        <div className="flex items-center gap-3 min-w-0 text-left">
          <div className="p-2 rounded-lg bg-background border shadow-sm"><Star className="w-3.5 h-3.5 text-primary opacity-40" /></div>
          <div className="min-w-0 text-left">
            <CardTitle className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate text-left">{service.name}</CardTitle>
            <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">ID: {service.id.slice(-6).toUpperCase()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-black uppercase text-muted-foreground hidden sm:block">Custom Logic</span>
          <Switch checked={policy.mode !== 'inherit'} onCheckedChange={(checked) => onPolicyChange({ mode: checked ? 'matrix' : 'inherit' })} disabled={!isEditing} />
        </div>
      </CardHeader>
      <AnimatePresence>
        {policy.mode !== 'inherit' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <CardContent className="p-4 space-y-6 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2 text-left">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Override Window (h)</Label>
                  <Input type="number" value={policy.window || ''} onChange={e => onPolicyChange({ window: parseInt(e.target.value) || 0 })} disabled={!isEditing} placeholder="Studio Default" className="h-10 rounded-xl border-2 font-black text-center bg-background shadow-inner" />
                </div>
                <div className="space-y-2 text-left">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Recovery Mode</Label>
                  <Select value={policy.mode} onValueChange={(v: any) => onPolicyChange({ mode: v })} disabled={!isEditing}>
                    <SelectTrigger className="h-10 rounded-xl border-2 font-black uppercase text-[9px] bg-background shadow-inner"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                      <SelectItem value="matrix"     className="font-bold">HOUSE FLOOR (MATRIX)</SelectItem>
                      <SelectItem value="flat"       className="font-bold">FLAT RATE ($)</SelectItem>
                      <SelectItem value="percentage" className="font-bold">PERCENTAGE (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {policy.mode !== 'matrix' && (
                <div className="space-y-2 animate-in slide-in-from-top-2 text-left">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-primary ml-1">Fixed Protocol Value</Label>
                  <div className="relative">
                    {policy.mode === 'flat'
                      ? <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                      : <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />}
                    <Input type="number" value={policy.value || ''} onChange={e => onPolicyChange({ value: parseFloat(e.target.value) || 0 })} disabled={!isEditing} className={cn('h-12 rounded-xl border-2 font-black text-lg bg-background shadow-inner', policy.mode === 'flat' ? 'pl-8' : 'pr-8')} />
                  </div>
                </div>
              )}
              <div className="p-4 rounded-xl border-2 border-dashed bg-muted/20 flex justify-between items-center shadow-inner text-left">
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
};

const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// ─── Main Page ────────────────────────────────────────────────────────────────
function SettingsPageImpl() {
  const { toast }      = useToast();
  const { firestore }  = useFirebase();
  const { selectedTenant, isLoading: isTenantContextLoading } = useTenant();
  const { scheduleProfiles, services, inventory, isLoading: isInventoryLoading } = useInventory();
  const searchParams   = useSearchParams();
  const tabParam       = searchParams.get('tab');

  const [activeTab,        setActiveTab]        = useState(tabParam || 'profile');
  const [isEditing,        setIsEditing]        = useState(false);
  const [tenantData,       setTenantData]       = useState<Partial<Tenant>>({});
  const [serviceSearch,    setServiceSearch]    = useState('');
  const [servicePolicies,  setServicePolicies]  = useState<Record<string, any>>({});
  const [isPrintStationsOpen, setIsPrintStationsOpen] = useState(false);
  const [geoStreet,        setGeoStreet]        = useState('');
  const [geoCity,          setGeoCity]          = useState('');
  const [geoState,         setGeoState]         = useState('');
  const [geoZip,           setGeoZip]           = useState('');
  const [isGeoLookingUp,   setIsGeoLookingUp]   = useState(false);
  const [kioskCustomHex,   setKioskCustomHex]   = useState('');
  const [geoInitialized,   setGeoInitialized]   = useState(false);

  const { control } = useForm();
  const activeProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);
  const [localSchedule,       setLocalSchedule]       = useState<any>(null);
  const [localInterval,       setLocalInterval]       = useState<number>(15);
  const [localKioskSchedule,  setLocalKioskSchedule]  = useState<any>(null);
  const tenantId = selectedTenant?.id;

  useEffect(() => {
    if (selectedTenant) {
      setTenantData(selectedTenant);
      if (selectedTenant.kioskSettings?.kioskSchedule) setLocalKioskSchedule(selectedTenant.kioskSettings.kioskSchedule);
      setKioskCustomHex(selectedTenant.kioskSettings?.primaryColor || '');
      if (!geoInitialized) {
        if (selectedTenant.studioAddressParts) {
          setGeoStreet(selectedTenant.studioAddressParts.street || '');
          setGeoCity(selectedTenant.studioAddressParts.city   || '');
          setGeoState(selectedTenant.studioAddressParts.state || '');
          setGeoZip(selectedTenant.studioAddressParts.zip     || '');
        }
        setGeoInitialized(true);
      }
    }
    if (activeProfile) { setLocalSchedule(activeProfile.week); setLocalInterval(activeProfile.bookingSlotInterval || 15); }
    if (services) {
      const policies: Record<string, any> = {};
      services.forEach(s => { policies[s.id] = { mode: s.cancellationFeeMode || 'inherit', window: s.cancellationWindowHours, value: s.cancellationFeeValue || s.customCancellationFee }; });
      setServicePolicies(policies);
    }
  }, [selectedTenant, activeProfile, services]);

  const handleGeoLookup = async () => {
    const parts = [geoStreet, geoCity, geoState, geoZip].filter(Boolean);
    if (parts.length < 2) { toast({ variant: 'destructive', title: 'Address Incomplete', description: 'Enter at least a street and city.' }); return; }
    setIsGeoLookingUp(true);
    try {
      const encoded = encodeURIComponent(parts.join(', '));
      const res     = await fetch(`https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&addressdetails=1`);
      const data    = await res.json();
      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        setTenantData(prev => ({ ...prev, studioAddress: display_name, studioAddressParts: { street: geoStreet, city: geoCity, state: geoState, zip: geoZip }, studioLocation: { lat: parseFloat(lat), lng: parseFloat(lon) } }));
        toast({ title: 'Location Confirmed', description: display_name });
      } else {
        toast({ variant: 'destructive', title: 'Address Not Found', description: 'Try adding more detail or use GPS instead.' });
      }
    } catch { toast({ variant: 'destructive', title: 'Lookup Failed' }); }
    finally { setIsGeoLookingUp(false); }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) { toast({ variant: 'destructive', title: 'GPS Not Supported' }); return; }
    setIsGeoLookingUp(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
          const data = await res.json();
          const addr = data.address || {};
          const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
          const city   = addr.city || addr.town || addr.village || addr.suburb || '';
          const state  = addr.state || '';
          const zip    = addr.postcode || '';
          setGeoStreet(street); setGeoCity(city); setGeoState(state); setGeoZip(zip);
          setTenantData(prev => ({ ...prev, studioAddress: data.display_name, studioAddressParts: { street, city, state, zip }, studioLocation: { lat: latitude, lng: longitude } }));
          toast({ title: 'GPS Location Set', description: data.display_name });
        } catch {
          setTenantData(prev => ({ ...prev, studioAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`, studioLocation: { lat: latitude, lng: longitude } }));
          toast({ title: 'GPS Coordinates Set' });
        } finally { setIsGeoLookingUp(false); }
      },
      (err) => {
        setIsGeoLookingUp(false);
        toast({ variant: 'destructive', title: 'GPS Failed', description: err.code === 1 ? 'Location access denied.' : 'Could not get your location.' });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  // ─── SAVE ─────────────────────────────────────────────────────────────────
  // bookingPageSettings is intentionally excluded — it's owned by the Page Builder.
  // Writing it here would overwrite cfPageConfig that the builder saved.
  const handleSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
      const batch     = writeBatch(firestore);
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);

      // Strip bookingPageSettings so we never clobber the page builder's cfPageConfig
      const { bookingPageSettings: _pageBuilderOwned, ...tenantDataToSave } = tenantData as any;

      const finalData = {
        ...tenantDataToSave,
        kioskSettings: {
          ...tenantData.kioskSettings,
          kioskSchedule: tenantData.kioskSettings?.useSpecificHours ? localKioskSchedule : null,
        },
      };
      batch.update(tenantRef, finalData);

      if (activeProfile && localSchedule) {
        const profileRef = doc(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`, activeProfile.id);
        batch.update(profileRef, { week: localSchedule, bookingSlotInterval: localInterval });
      }

      Object.entries(servicePolicies).forEach(([id, p]) => {
        const svcRef          = doc(firestore, `tenants/${selectedTenant.id}/services`, id);
        const originalService = services.find(s => s.id === id);
        batch.update(svcRef, {
          cancellationFeeMode:     p.mode,
          cancellationWindowHours: p.window || (deleteField() as any),
          customCancellationFee:   p.mode === 'flat' ? p.value : (p.mode === 'inherit' ? (deleteField() as any) : (originalService?.customCancellationFee || 0)),
          cancellationFeeValue:    p.value || (deleteField() as any),
        });
      });

      await batch.commit();
      toast({ title: 'Settings Synchronized', description: 'Studio operational parameters updated.' });
      setIsEditing(false);
    } catch { toast({ variant: 'destructive', title: 'Save Failed' }); }
  };

  const handleLoadStrategicTemplates = () => {
    setTenantData(prev => ({ ...prev, escalationPolicy: defaultEscalationPolicy, recoveryPresets: defaultRecoveryPresets, maxAutonomousRecoveryAmount: 50, maxAutonomousRecoveryPercent: 25 }));
    toast({ title: 'Strategic Templates Loaded' });
  };

  const handleScheduleChange      = (day: string, updates: Partial<DayHours>) => setLocalSchedule((prev: any) => ({ ...prev, [day]: { ...prev[day], ...updates } }));
  const handleKioskScheduleChange = (day: string, updates: Partial<DayHours>) => setLocalKioskSchedule((prev: any) => ({ ...prev, [day]: { ...(prev?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }), ...updates } }));
  const handlePolicyChange        = (id: string, updates: any) => setServicePolicies(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  // Deposit policy lives on the tenant doc under `depositPolicy`; the rules engine
  // (src/lib/deposit-policy.ts) reads it and falls back to DEFAULT_DEPOSIT_POLICY.
  const handleDepositPolicyChange = (updates: any) => setTenantData(prev => ({ ...prev, depositPolicy: { ...(((prev as any).depositPolicy) || {}), ...updates } } as any));
  const handleAddPreset           = () => setTenantData(prev => ({ ...prev, recoveryPresets: [...(prev.recoveryPresets || []), { id: nanoid(), label: 'NEW PRESET', type: 'fixed', value: 0 }] }));
  const handleRemovePreset        = (id: string) => setTenantData(prev => ({ ...prev, recoveryPresets: prev.recoveryPresets?.filter(p => p.id !== id) }));
  const handleUpdatePreset        = (id: string, updates: Partial<RecoveryPreset>) => setTenantData(prev => ({ ...prev, recoveryPresets: prev.recoveryPresets?.map(p => p.id === id ? { ...p, ...updates } : p) }));

  const filteredServices = useMemo(() => {
    if (!services) return [];
    if (!serviceSearch.trim()) return services;
    const s = serviceSearch.toLowerCase();
    return services.filter(svc => svc.name.toLowerCase().includes(s) || (svc.category || '').toLowerCase().includes(s));
  }, [services, serviceSearch]);

  // Active deposit policy for display — saved values over engine defaults.
  const depositPolicy: any = { ...DEFAULT_DEPOSIT_POLICY, ...(((tenantData as any).depositPolicy) || {}) };
  const depositOutcomeRules = [
    { key: 'onEarlyCancel',  label: 'Client cancels EARLY',  desc: 'Outside the refund window' },
    { key: 'onLateCancel',   label: 'Client cancels LATE',   desc: 'Inside the refund window'   },
    { key: 'onNoShow',       label: 'Client NO-SHOWS',       desc: 'Never arrives'              },
    { key: 'onStudioCancel', label: 'STUDIO cancels',        desc: 'Your side cancels'          },
  ];

  const tabs = [
    { value: 'profile',    label: 'Studio Identity',            icon: <Building className="w-4 h-4" />    },
    { value: 'hours',      label: 'Operating Window',           icon: <Clock className="w-4 h-4" />       },
    { value: 'experience', label: 'Hospitality & Connectivity', icon: <Coffee className="w-4 h-4" />      },
    { value: 'policies',   label: 'Operational Protocols',      icon: <ShieldCheck className="w-4 h-4" /> },
    { value: 'payments',   label: 'Payments & Payouts',         icon: <DollarSign className="w-4 h-4" />  },
    { value: 'builder',    label: 'Booking Architecture',       icon: <Globe className="w-4 h-4" />       },
    { value: 'kiosk',      label: 'Kiosk Orchestration',        icon: <Fingerprint className="w-4 h-4" /> },
    { value: 'timeclock',  label: 'Time Clock',                 icon: <Timer className="w-4 h-4" />       },
  ];

  if (isTenantContextLoading || isInventoryLoading) {
    return <div className="p-8 flex items-center justify-center h-full"><Loader className="animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Studio OS Settings" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8 md:space-y-10 p-4 md:p-10 pb-32">

          {/* Page header */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
            <div className="space-y-1 text-left">
              <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Settings</h1>
              <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Studio Orchestration & Governance</p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {isEditing ? (
                <>
                  <Button variant="ghost" onClick={() => { setIsEditing(false); setGeoInitialized(false); }} className="flex-1 sm:w-auto h-12 font-black uppercase text-[9px] sm:text-[10px] tracking-widest text-slate-400">Cancel</Button>
                  <Button onClick={handleSave} className="flex-[2] sm:w-auto h-12 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Save className="mr-2 h-4 w-4" />Save Archive</Button>
                </>
              ) : (
                <Button onClick={() => setIsEditing(true)} className="w-full sm:w-auto h-12 px-8 rounded-2xl border-2 border-primary/20 bg-primary text-white font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-primary/90 transition-all active:scale-95"><Edit className="mr-2 h-4 w-4" />Modify Logic</Button>
              )}
            </div>
          </div>

          {/* Module selector */}
          <div className="space-y-4 mb-10 text-left">
            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-1 opacity-60">Configuration Module</Label>
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-white"><SelectValue placeholder="Select Module" /></SelectTrigger>
              <SelectContent className="rounded-xl border-2 shadow-2xl">
                {tabs.map(tab => (
                  <SelectItem key={tab.value} value={tab.value} className="font-bold uppercase text-[10px] tracking-widest py-3">
                    <div className="flex items-center gap-2">{tab.icon}{tab.label}</div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={activeTab} className="w-full">

            {/* ── PROFILE ── */}
            <TabsContent value="profile" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                  <SectionHeader icon={Building} title="Studio Identity" />
                  <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Registry identification and internal labeling.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-8 text-left">
                  <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Business Label</Label>
                    <Input value={tenantData.name || ''} onChange={e => setTenantData(prev => ({ ...prev, name: e.target.value }))} disabled={!isEditing} placeholder="ENTER STUDIO NAME" className="h-14 rounded-2xl border-2 font-black uppercase text-lg md:text-xl tracking-tighter bg-white shadow-inner" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── PAYMENTS ── */}
            <TabsContent value="payments" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={DollarSign} title="Payments & Payouts" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
                    Connect your Stripe account to collect deposits and fees. Funds are paid directly to your bank.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8">
                  <StripeConnectSetup
                    tenantId={tenantId || ''}
                    stripeAccountId={(selectedTenant as any)?.stripeAccountId}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── HOURS ── */}
            <TabsContent value="hours" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                  <SectionHeader icon={Clock} title="Operating Window" />
                  <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Configure your weekly studio availability and access tiers.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-10 text-left">
                  <div className="space-y-4 max-w-sm text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Booking Precision (Interval)</Label>
                    <Select value={String(localInterval)} onValueChange={(v) => setLocalInterval(parseInt(v))} disabled={!isEditing}>
                      <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                      <SelectContent className="rounded-xl border-2 shadow-2xl">
                        <SelectItem value="15" className="font-bold uppercase text-[9px] tracking-widest">15 MINUTE SLOTS</SelectItem>
                        <SelectItem value="30" className="font-bold uppercase text-[9px] tracking-widest">30 MINUTE SLOTS</SelectItem>
                        <SelectItem value="60" className="font-bold uppercase text-[9px] tracking-widest">60 MINUTE SLOTS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator className="border-dashed" />
                  {localSchedule ? (
                    <div className="space-y-3">
                      {dayOrder.map(day => (
                        <DayHoursRow key={day} day={day} data={localSchedule[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }} onChange={handleScheduleChange} disabled={!isEditing} />
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center opacity-30"><Loader className="animate-spin h-8 w-8 mx-auto" /></div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── EXPERIENCE ── */}
            <TabsContent value="experience" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Coffee} title="Hospitality Concierge" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Configure the in-service refreshment and amenity module.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-10 text-left">
                  <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/5 shadow-inner border-primary/10 gap-6">
                    <div className="space-y-1">
                      <Label className="text-base font-black uppercase tracking-tight text-slate-900">Activate Refreshment Menu</Label>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Allows guests to request in-stock items from their portal</p>
                    </div>
                    <Switch checked={!!tenantData.refreshmentServiceEnabled} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, refreshmentServiceEnabled: val }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                  </div>
                  <div className="space-y-4">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Complimentary Amenity Limit</Label>
                    <Input type="number" value={tenantData.complimentaryAmenityLimit || 0} onChange={e => setTenantData(prev => ({ ...prev, complimentaryAmenityLimit: parseInt(e.target.value) || 0 }))} disabled={!isEditing} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 w-full sm:w-48 text-center" />
                  </div>
                  <Separator className="border-dashed" />
                  <div className="space-y-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
                      <div className="space-y-1">
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" />Station Identity Protocol</h3>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Generate physical place-cards for autonomous ordering.</p>
                      </div>
                      <Button onClick={() => setIsPrintStationsOpen(true)} className="h-12 px-8 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20 w-full md:w-auto">Generate Cards</Button>
                    </div>
                  </div>
                  <Separator className="border-dashed" />
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 px-1"><Wifi className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Studio Connectivity</h3></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">WiFi Network SSID</Label>
                        <Input value={tenantData.wifiNetwork || ''} onChange={e => setTenantData(prev => ({ ...prev, wifiNetwork: e.target.value }))} placeholder="e.g., STUDIO_GUEST_5G" disabled={!isEditing} className="h-12 rounded-xl border-2 font-bold bg-white" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Access Password</Label>
                        <Input value={tenantData.wifiPassword || ''} onChange={e => setTenantData(prev => ({ ...prev, wifiPassword: e.target.value }))} placeholder="password" disabled={!isEditing} className="h-12 rounded-xl border-2 font-bold bg-white" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── POLICIES ── */}
            <TabsContent value="policies" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <div className="flex justify-end mb-4">
                {isEditing && (
                  <Button variant="outline" size="sm" onClick={handleLoadStrategicTemplates} className="h-9 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest shadow-sm hover:bg-primary/10">
                    <Sparkles className="w-3.5 h-3.5 mr-2" />Load Studio Best Practices
                  </Button>
                )}
              </div>
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={ShieldCheck} title="Global Studio Governance" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Define studio-wide defaults for late shifts and cancellations.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-10 text-left">
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 px-1"><ScaleIcon className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Recovery Governance</h3></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4 p-6 rounded-[2.5rem] border-2 bg-primary/5 border-primary/10 shadow-inner">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Autonomous Comp Limit</Label>
                        <div className="flex gap-3">
                          <div className="relative flex-1"><DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" /><Input type="number" value={tenantData.maxAutonomousRecoveryAmount || ''} onChange={e => setTenantData(prev => ({ ...prev, maxAutonomousRecoveryAmount: parseFloat(e.target.value) || 0 }))} disabled={!isEditing} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-white" /></div>
                          <div className="relative w-24"><Percent className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" /><Input type="number" value={tenantData.maxAutonomousRecoveryPercent || ''} onChange={e => setTenantData(prev => ({ ...prev, maxAutonomousRecoveryPercent: parseFloat(e.target.value) || 0 }))} disabled={!isEditing} className="h-14 pr-10 rounded-2xl border-2 font-black text-xl shadow-inner bg-white text-center" /></div>
                        </div>
                        <p className="text-[9px] font-bold text-slate-500 leading-relaxed uppercase tracking-tight">Max credit or discount staff can apply without manager authorization.</p>
                      </div>
                      <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Standing Escalation Orders</Label>
                        <Textarea value={tenantData.escalationPolicy || ''} onChange={e => setTenantData(prev => ({ ...prev, escalationPolicy: e.target.value }))} placeholder="e.g., Try the $25 Recovery Protocol first..." disabled={!isEditing} className="rounded-2xl border-2 bg-muted/5 min-h-[140px] font-medium" />
                      </div>
                    </div>
                    <div className="space-y-6 pt-4 border-t border-dashed">
                      <div className="flex items-center justify-between px-1">
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-primary">Tactical Recovery Presets</h4>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">One-tap recovery options for the POS terminal.</p>
                        </div>
                        {isEditing && (
                          <Button variant="ghost" size="sm" onClick={handleAddPreset} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Append Preset
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {tenantData.recoveryPresets?.map(preset => (
                          <div key={preset.id} className="p-4 rounded-2xl border-2 bg-white shadow-sm flex flex-col gap-4 group">
                            <div className="flex items-center justify-between gap-4">
                              <Input value={preset.label} onChange={e => handleUpdatePreset(preset.id, { label: e.target.value.toUpperCase() })} disabled={!isEditing} className="h-9 border-none bg-transparent font-black uppercase tracking-tight text-xs p-0 focus-visible:ring-0" />
                              {isEditing && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemovePreset(preset.id)}><Trash2 className="w-4 h-4" /></Button>}
                            </div>
                            <div className="flex gap-2">
                              <Select value={preset.type} onValueChange={(v: any) => handleUpdatePreset(preset.id, { type: v })} disabled={!isEditing}>
                                <SelectTrigger className="h-9 w-24 rounded-lg border-2 font-bold text-[9px] uppercase"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl"><SelectItem value="fixed" className="font-bold text-[9px] uppercase">FLAT $</SelectItem><SelectItem value="percentage" className="font-bold text-[9px] uppercase">PERC %</SelectItem></SelectContent>
                              </Select>
                              <div className="relative flex-1">
                                {preset.type === 'fixed' ? <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" /> : <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />}
                                <Input type="number" value={preset.value || ''} onChange={e => handleUpdatePreset(preset.id, { value: parseFloat(e.target.value) || 0 })} disabled={!isEditing} className={cn('h-9 rounded-lg border-2 font-black font-mono text-sm bg-muted/5', preset.type === 'fixed' ? 'pl-6' : 'pr-6')} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Separator className="border-dashed" />
                  <div className="space-y-4">
                    {[
                      { id: 'guardianProtocolEnabled', color: 'primary', icon: ShieldCheck, label: 'Guardian Revenue Shield',     desc: 'Forced deposit enforcement for high-risk behavioral profiles' },
                      { id: 'morningAnchorEnabled',    color: 'blue',    icon: Clock,       label: 'Morning Anchor Protocol',      desc: 'The first appointment of an empty day must start at business opening time' },
                      { id: 'tightSchedulingEnabled',  color: 'primary', icon: Workflow,    label: 'Zero-Gap Adjacency Protocol',  desc: 'Force client bookings to be flush against existing blocks' },
                      { id: 'flashYieldEnabled',       color: 'amber',   icon: Flame,       label: 'Flash Yield Protocol',         desc: 'Flag 48h cancellations as magnetic slots that bypass standard restrictions' },
                    ].map(item => (
                      <SettingRow key={item.id} icon={item.icon} color={item.color} title={item.label} description={item.desc}>
                        <Switch checked={!!(tenantData as any)[item.id]} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, [item.id]: val }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                      </SettingRow>
                    ))}
                  </div>
                  <Separator className="border-dashed" />
                  <div className="space-y-6">
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary ml-1">Default Recovery Strategy</Label>
                    <RadioGroup onValueChange={(v: any) => setTenantData(p => ({ ...p, defaultCancellationMode: v }))} value={tenantData.defaultCancellationMode || 'matrix'} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {[{ v: 'matrix', icon: ScaleIcon, label: 'Recovery Matrix', sub: 'Time + Materials' }, { v: 'percentage', icon: Percent, label: 'Service Percentage', sub: 'Price Pro-Rata' }, { v: 'flat', icon: DollarSign, label: 'Fixed Rate', sub: 'Uniform Fee' }].map(opt => (
                        <label key={opt.v} className="cursor-pointer h-full">
                          <div className={cn('flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all h-full text-center', (tenantData.defaultCancellationMode || 'matrix') === opt.v ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-background hover:border-primary/20')}>
                            <opt.icon className={cn('mb-2 h-8 w-8', (tenantData.defaultCancellationMode || 'matrix') === opt.v ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                            <span className="text-[10px] font-black uppercase tracking-widest leading-tight">{opt.label}</span>
                            <p className="text-[8px] font-bold opacity-40 mt-1 uppercase">{opt.sub}</p>
                            <RadioGroupItem value={opt.v} className="sr-only" disabled={!isEditing} />
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-dashed">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Cancellation Window (Hours)</Label>
                      <Input type="number" value={tenantData.cancellationWindowHours || 0} onChange={e => setTenantData(prev => ({ ...prev, cancellationWindowHours: parseInt(e.target.value) || 0 }))} disabled={!isEditing} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Fixed Flat Fee ($)</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input type="number" value={tenantData.cancellationFee || 0} onChange={e => setTenantData(prev => ({ ...prev, cancellationFee: parseFloat(e.target.value) || 0 }))} disabled={!isEditing || tenantData.defaultCancellationMode !== 'flat'} className={cn('h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-primary', tenantData.defaultCancellationMode !== 'flat' && 'opacity-40')} />
                      </div>
                    </div>
                  </div>
                  <SettingRow icon={Zap} title="Guest Autonomy: Fee Deferral" description="Allow guests to add rescheduling fees to their session bill">
                    <Switch checked={!!tenantData.allowGuestFeeDeferral} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, allowGuestFeeDeferral: val }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                  </SettingRow>
                </CardContent>
              </Card>

              {/* ── DEPOSIT GOVERNANCE ── */}
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Landmark} title="Deposit Governance" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Automate what happens to a deposit when a booking is cancelled or missed — set once, applied consistently.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-8 text-left">
                  <SettingRow icon={ShieldCheck} color="green" title="Collect Deposits (Live)" description="Master switch. While off, no deposits are charged anywhere — safe to leave off until you've tested end to end.">
                    <Switch checked={!!(tenantData as any).depositsLive} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, depositsLive: val } as any))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-green-600" />
                  </SettingRow>

                  <Separator className="border-dashed" />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Refund Window (Hours)</Label>
                      <Input type="number" value={(tenantData as any).depositPolicy?.refundWindowHours ?? ''} onChange={e => handleDepositPolicyChange({ refundWindowHours: parseInt(e.target.value) || 0 })} disabled={!isEditing} placeholder={String(DEFAULT_DEPOSIT_POLICY.refundWindowHours)} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 ml-1 leading-relaxed">Cancellations earlier than this count as "early". Inside it counts as "late".</p>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Rollover Expires After (Days)</Label>
                      <Input type="number" value={(tenantData as any).depositPolicy?.rolloverExpiryDays ?? ''} onChange={e => handleDepositPolicyChange({ rolloverExpiryDays: parseInt(e.target.value) || 0 })} disabled={!isEditing} placeholder={String(DEFAULT_DEPOSIT_POLICY.rolloverExpiryDays)} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5 text-center" />
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 ml-1 leading-relaxed">How long a rolled-over deposit stays usable on the client's next visit.</p>
                    </div>
                  </div>

                  <Separator className="border-dashed" />

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-1"><Scale className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Automatic Outcomes</h3></div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 ml-1 leading-relaxed">Applied automatically so you're not deciding case by case. You can still override any single one at the moment of cancellation.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {depositOutcomeRules.map(rule => (
                        <div key={rule.key} className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-3">
                          <div className="space-y-0.5">
                            <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{rule.label}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{rule.desc}</p>
                          </div>
                          <Select value={depositPolicy[rule.key]} onValueChange={(v: any) => handleDepositPolicyChange({ [rule.key]: v })} disabled={!isEditing}>
                            <SelectTrigger className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"><SelectValue /></SelectTrigger>
                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                              <SelectItem value="rollover" className="font-bold uppercase text-[10px] tracking-widest">Roll over to next visit</SelectItem>
                              <SelectItem value="forfeit"  className="font-bold uppercase text-[10px] tracking-widest">Studio keeps it</SelectItem>
                              <SelectItem value="refund"   className="font-bold uppercase text-[10px] tracking-widest">Refund to client</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 rounded-2xl border-2 border-dashed bg-amber-50 border-amber-200 flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-[9px] font-bold text-amber-700 uppercase tracking-widest leading-relaxed">Refunds send money back through Stripe and can't be undone — that outcome asks for a one-tap confirmation before it runs. Rollover and forfeit move no money and run silently.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service-specific policies */}
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 px-1">
                  <div className="space-y-1">
                    <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">Service-Specific Protocols</h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Custom logic guards per treatment unit.</p>
                  </div>
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input placeholder="SEARCH MENU..." value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} className="pl-9 h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredServices.map(service => (
                    <ServicePolicyCard key={service.id} service={service} tmhr={tenantData.tmhr || 50} inventory={inventory} isEditing={isEditing} localPolicy={servicePolicies[service.id]} onPolicyChange={(updates) => handlePolicyChange(service.id, updates)} />
                  ))}
                </div>
              </div>

              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8"><SectionHeader icon={Shield} title="Public Accountability Policies" /></CardHeader>
                <CardContent className="p-6 md:p-8 space-y-6 text-left">
                  {[
                    { id: 'cancellationPolicy', label: 'Cancellation Policy (Public)', placeholder: 'Describe your requirements for cancelling a session...' },
                    { id: 'lateArrivalPolicy',  label: 'Late Arrival Policy (Public)',  placeholder: 'Describe grace periods and potential penalties...'    },
                    { id: 'noShowPolicy',        label: 'No-Show Policy (Public)',       placeholder: 'Describe the consequence of missing an appointment...' },
                  ].map(policy => (
                    <div key={policy.id} className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{policy.label}</Label>
                      <Textarea value={(tenantData as any)[policy.id] || ''} onChange={e => setTenantData(prev => ({ ...prev, [policy.id]: e.target.value }))} disabled={!isEditing} placeholder={policy.placeholder} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] font-medium" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── BUILDER ── */}
            <TabsContent value="builder" className="mt-0 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Globe} title="Booking Architecture" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
                    Design and publish your guest-facing booking page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-6">
                  {/* Primary CTA */}
                  <div className="flex flex-col sm:flex-row items-center gap-6 p-8 rounded-[2rem] border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/[0.02] shadow-inner">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0">
                      <Sparkles className="w-7 h-7 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1.5 text-center sm:text-left">
                      <p className="text-base font-black uppercase tracking-tight text-slate-900">Page Builder</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-70 leading-relaxed">
                        Drag sections, choose fonts and colors, upload images, and configure every block of your
                        public booking page — all in one visual editor.
                      </p>
                    </div>
                    <a
                      href="/studio/page-builder"
                      className="shrink-0 flex items-center gap-2 h-12 px-8 rounded-2xl bg-primary text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 whitespace-nowrap"
                    >
                      Open Builder
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>

                  {/* What the builder controls */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Palette,     label: 'Brand kit & colors'     },
                      { icon: FileText,    label: 'Fonts & typography'     },
                      { icon: LayoutGrid,  label: 'Section order & layout' },
                      { icon: ImageIcon,   label: 'Hero & gallery images'  },
                      { icon: Star,        label: 'Reviews & team'         },
                      { icon: Globe,       label: 'Social & contact'       },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-3 p-3.5 rounded-2xl border-2 border-border bg-muted/5">
                        <item.icon className="w-4 h-4 text-primary opacity-60 shrink-0" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 leading-tight">{item.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Live page URL */}
                  {selectedTenant && (
                    <div className="flex items-center justify-between gap-4 p-5 rounded-[2rem] border-2 border-dashed border-border bg-muted/5">
                      <div className="space-y-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Your live booking page</p>
                        <p className="text-xs font-black text-slate-700 truncate font-mono">/book/{selectedTenant.id}</p>
                      </div>
                      <a
                        href={`/book/${selectedTenant.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1.5 h-9 px-4 rounded-xl border-2 border-border bg-white font-black uppercase text-[9px] tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Live
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── KIOSK ── */}
            <TabsContent value="kiosk" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Fingerprint} title="Kiosk Orchestration" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Manage the check-in terminal experience.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-10 text-left">
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 px-1"><ImageIcon className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Brand Identity</h3></div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Kiosk Logo</Label>
                      <ImageUpload onImageUploaded={(url) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, logoUrl: url } }))} initialImage={tenantData.kioskSettings?.logoUrl} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Wordmark / Text Logo (optional)</Label>
                      <ImageUpload onImageUploaded={(url) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, wordmarkUrl: url } }))} initialImage={tenantData.kioskSettings?.wordmarkUrl} />
                      <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1">Upload a horizontal text logo if you want the full name displayed</p>
                    </div>
                    <SettingRow icon={ImageIcon} title="Show Studio Name" description="Display wordmark or text name on the splash screen">
                      <Switch checked={tenantData.kioskSettings?.showWordmark !== false} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, showWordmark: val } }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                    </SettingRow>
                  </div>
                  <Separator className="border-dashed" />
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 px-1"><Palette className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Kiosk Theme & Color</h3></div>
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Base Theme</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                          { key: 'light', label: 'Light', preview: 'bg-white border-slate-200',                     dot: 'bg-slate-900' },
                          { key: 'dark',  label: 'Dark',  preview: 'bg-slate-900 border-slate-700',                 dot: 'bg-white'    },
                          { key: 'rose',  label: 'Rose',  preview: 'bg-gradient-to-br from-rose-50 to-white',       dot: 'bg-rose-500'  },
                          { key: 'sage',  label: 'Sage',  preview: 'bg-gradient-to-br from-emerald-50 to-white',    dot: 'bg-emerald-600'},
                          { key: 'slate', label: 'Slate', preview: 'bg-gradient-to-br from-slate-700 to-slate-900', dot: 'bg-white'    },
                        ].map(theme => (
                          <button key={theme.key} onClick={() => isEditing && setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, theme: theme.key } }))} disabled={!isEditing}
                            className={cn('relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center', theme.preview, tenantData.kioskSettings?.theme === theme.key || (!tenantData.kioskSettings?.theme && theme.key === 'light') ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-border hover:border-primary/30', !isEditing && 'opacity-60 cursor-not-allowed')}>
                            {(tenantData.kioskSettings?.theme === theme.key || (!tenantData.kioskSettings?.theme && theme.key === 'light')) && (
                              <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center"><Check className="w-2.5 h-2.5" /></div>
                            )}
                            <div className={cn('w-8 h-8 rounded-xl border-2 border-white/30 shadow-sm', theme.dot)} />
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">{theme.label}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Accent Color</Label>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1 opacity-60">Overrides button and highlight colors. Leave unset to use theme default.</p>
                      <div className="grid grid-cols-10 gap-2 p-4 rounded-2xl border-2 border-border bg-muted/5">
                        {KIOSK_COLOR_LIBRARY.map(color => (
                          <button key={color.hex} title={color.name} onClick={() => { if (!isEditing) return; setKioskCustomHex(color.hex); setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: color.hex } })); }} disabled={!isEditing}
                            className={cn('w-8 h-8 rounded-lg border-2 transition-all hover:scale-110', tenantData.kioskSettings?.primaryColor === color.hex ? 'border-slate-900 scale-110 shadow-lg' : 'border-transparent', !isEditing && 'cursor-not-allowed')}
                            style={{ backgroundColor: color.hex }} />
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl border-2 shadow-inner shrink-0" style={{ backgroundColor: tenantData.kioskSettings?.primaryColor || '#0f172a' }} />
                        <div className="flex-1 space-y-1">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Custom Color (Hex)</Label>
                          <div className="flex gap-2">
                            <Input value={kioskCustomHex} onChange={e => setKioskCustomHex(e.target.value)} onBlur={() => { if (/^#[0-9a-fA-F]{6}$/.test(kioskCustomHex)) setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: kioskCustomHex } })); }} placeholder="#7c3aed" disabled={!isEditing} className="h-10 rounded-xl border-2 font-mono font-black flex-1" />
                            {tenantData.kioskSettings?.primaryColor && isEditing && (
                              <Button variant="ghost" size="sm" onClick={() => { setKioskCustomHex(''); setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: undefined } })); }} className="h-10 px-3 rounded-xl text-[9px] font-black uppercase text-muted-foreground hover:text-destructive">Clear</Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl border-2 border-dashed bg-primary/5 border-primary/20 flex items-center gap-3">
                      <Eye className="w-5 h-5 text-primary shrink-0" />
                      <p className="text-[9px] font-bold text-primary uppercase tracking-widest leading-relaxed">
                        Changes appear live on your kiosk at <span className="font-black">/walk-in/{selectedTenant?.id}</span>. Save settings to lock them in.
                      </p>
                    </div>
                  </div>
                  <Separator className="border-dashed" />
                  <SettingRow icon={Clock} title="Specific Kiosk Hours" description="Close walk-ins earlier than business hours">
                    <Switch checked={!!tenantData.kioskSettings?.useSpecificHours} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, useSpecificHours: val } }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                  </SettingRow>
                  <AnimatePresence>
                    {tenantData.kioskSettings?.useSpecificHours && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pt-4 border-t border-dashed">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Walk-in Window Schedule</Label>
                        <div className="space-y-3">
                          {dayOrder.map(day => (
                            <DayHoursRow key={`kiosk-${day}`} day={day} data={localKioskSchedule?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }} onChange={handleKioskScheduleChange} disabled={!isEditing} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── TIME CLOCK ── */}
            <TabsContent value="timeclock" className="mt-0 space-y-8 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Clock} title="Clock-In Restrictions" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Control when and how staff are permitted to start their shift.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-5 text-left">
                  <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><Clock className="w-4 h-4 text-primary" /></div>
                      <div className="flex-1 space-y-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Early Clock-In Window</p><p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">How many minutes before their first appointment staff can clock in</p></div>
                    </div>
                    <div className="flex items-center gap-4 pl-12">
                      <NumberInput value={tenantData.earlyClockInMinutes} onChange={(v: number) => setTenantData(prev => ({ ...prev, earlyClockInMinutes: v }))} disabled={!isEditing} suffix="min" min={0} max={120} placeholder="15" />
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">before first appointment</p>
                    </div>
                  </div>
                  <SettingRow icon={Calendar}    color="blue"  title="Require Active Appointment"  description="Staff can only clock in if they have an appointment scheduled today">
                    <Switch checked={!!tenantData.requireAppointmentToClockIn}    onCheckedChange={(val) => setTenantData(prev => ({ ...prev, requireAppointmentToClockIn: val }))}    disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                  </SettingRow>
                  <SettingRow icon={ShieldAlert} color="red"   title="Block Expired License"        description="Staff with an expired compliance license cannot clock in">
                    <Switch checked={!!tenantData.blockClockInOnExpiredLicense}   onCheckedChange={(val) => setTenantData(prev => ({ ...prev, blockClockInOnExpiredLicense: val }))}   disabled={!isEditing} className="scale-125 data-[state=checked]:bg-destructive" />
                  </SettingRow>
                  <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><Timer className="w-4 h-4 text-amber-600" /></div>
                      <div className="flex-1 space-y-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Minimum Shift Length</p><p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Staff must work at least this many minutes before they can clock out</p></div>
                    </div>
                    <div className="flex items-center gap-4 pl-12">
                      <NumberInput value={tenantData.minimumShiftMinutes} onChange={(v: number) => setTenantData(prev => ({ ...prev, minimumShiftMinutes: v }))} disabled={!isEditing} suffix="min" min={0} max={480} placeholder="0" />
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">minimum shift</p>
                    </div>
                  </div>
                  <SettingRow icon={Shield} color="amber" title="Manager Override for Late Clock-In" description="Require manager PIN authorization when staff clock in after their early window">
                    <Switch checked={!!tenantData.requireManagerOverrideForLateClockIn} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, requireManagerOverrideForLateClockIn: val }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-primary" />
                  </SettingRow>
                </CardContent>
              </Card>

              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={MapPin} title="Geo-Fence Configuration" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Restrict clock-ins to your physical studio location.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-6 text-left">
                  <SettingRow icon={MapPin} color="green" title="Enable Geo-Fencing" description="Staff must be at the studio location to clock in">
                    <Switch checked={!!tenantData.geoFenceEnabled} onCheckedChange={(val) => setTenantData(prev => ({ ...prev, geoFenceEnabled: val }))} disabled={!isEditing} className="scale-125 data-[state=checked]:bg-green-600" />
                  </SettingRow>
                  <AnimatePresence>
                    {tenantData.geoFenceEnabled && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-5 pt-2">
                        <div className="p-5 rounded-[2rem] border-2 bg-green-50 border-green-200 space-y-5">
                          <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><Building className="w-4 h-4 text-green-700" /></div>
                            <div className="space-y-1"><p className="text-sm font-black uppercase tracking-tight text-green-800">Studio Address</p><p className="text-[9px] font-bold text-green-700/60 uppercase tracking-widest">Enter your full address or use your device GPS to set coordinates</p></div>
                          </div>
                          <div className="space-y-3">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-green-800/60 ml-1">Street Address</Label><Input value={geoStreet} onChange={e => setGeoStreet(e.target.value)} disabled={!isEditing} placeholder="123 Main Street, Suite 100" className="h-12 rounded-2xl border-2 font-bold bg-white border-green-200 focus:border-green-400" /></div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-green-800/60 ml-1">City</Label><Input value={geoCity}  onChange={e => setGeoCity(e.target.value)}  disabled={!isEditing} placeholder="Greensboro"   className="h-12 rounded-2xl border-2 font-bold bg-white border-green-200 focus:border-green-400" /></div>
                              <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-green-800/60 ml-1">State</Label><Input value={geoState} onChange={e => setGeoState(e.target.value)} disabled={!isEditing} placeholder="NC"            className="h-12 rounded-2xl border-2 font-bold bg-white border-green-200 focus:border-green-400" /></div>
                            </div>
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-green-800/60 ml-1">ZIP Code</Label><Input value={geoZip} onChange={e => setGeoZip(e.target.value)} disabled={!isEditing} placeholder="27401" className="h-12 rounded-2xl border-2 font-bold bg-white border-green-200 focus:border-green-400" /></div>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <Button onClick={handleGeoLookup} disabled={!isEditing || isGeoLookingUp || (!geoStreet && !geoCity)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-green-500/20 bg-green-600 hover:bg-green-700">
                              {isGeoLookingUp ? <Loader className="animate-spin w-4 h-4" /> : <><MapPin className="w-4 h-4 mr-2" />Locate Address</>}
                            </Button>
                            <Button onClick={handleUseMyLocation} disabled={!isEditing || isGeoLookingUp} variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 border-green-300 text-green-700 hover:bg-green-100 bg-white">
                              {isGeoLookingUp ? <Loader className="animate-spin w-4 h-4" /> : <><Target className="w-4 h-4 mr-2" />Use My Location</>}
                            </Button>
                          </div>
                          {tenantData.studioLocation && (
                            <div className="p-4 rounded-2xl bg-white border-2 border-green-200 space-y-2">
                              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-green-700"><CheckCircle2 className="w-4 h-4" /> Location Confirmed</div>
                              {tenantData.studioAddress && <p className="text-[10px] font-bold text-slate-600 ml-6">{tenantData.studioAddress}</p>}
                              <p className="text-[9px] font-mono text-slate-400 ml-6">{tenantData.studioLocation.lat.toFixed(6)}, {tenantData.studioLocation.lng.toFixed(6)}</p>
                              <a href={`https://www.google.com/maps?q=${tenantData.studioLocation.lat},${tenantData.studioLocation.lng}`} target="_blank" rel="noopener noreferrer" className="ml-6 text-[9px] font-black uppercase text-green-600 underline underline-offset-2 hover:text-green-800">Verify on Google Maps →</a>
                            </div>
                          )}
                        </div>
                        <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
                          <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><Target className="w-4 h-4 text-primary" /></div>
                            <div className="space-y-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Clock-In Radius</p><p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">How far from studio center staff can be to clock in</p></div>
                          </div>
                          <div className="flex items-center gap-4 pl-12">
                            <NumberInput value={tenantData.geoFenceRadiusMeters} onChange={(v: number) => setTenantData(prev => ({ ...prev, geoFenceRadiusMeters: v }))} disabled={!isEditing} suffix="m" min={10} max={2000} placeholder="200" />
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">meters ({((tenantData.geoFenceRadiusMeters || 200) * 3.281).toFixed(0)} ft)</p>
                          </div>
                        </div>
                        <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
                          <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><BreakIcon className="w-4 h-4 text-amber-600" /></div>
                            <div className="space-y-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Break-End Radius</p><p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Separate (usually larger) radius allowed when ending a break</p></div>
                          </div>
                          <div className="flex items-center gap-4 pl-12">
                            <NumberInput value={tenantData.geoFenceBreakRadiusMeters} onChange={(v: number) => setTenantData(prev => ({ ...prev, geoFenceBreakRadiusMeters: v }))} disabled={!isEditing} suffix="m" min={10} max={5000} placeholder="500" />
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">meters ({((tenantData.geoFenceBreakRadiusMeters || 500) * 3.281).toFixed(0)} ft)</p>
                          </div>
                        </div>
                        <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
                          <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><AlertTriangle className="w-4 h-4 text-red-500" /></div>
                            <div className="space-y-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900">Geo Failure Behavior</p><p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">What happens when a staff member is outside the geo-fence</p></div>
                          </div>
                          <Select value={tenantData.geoFenceFailBehavior || 'warn'} onValueChange={(v: any) => setTenantData(prev => ({ ...prev, geoFenceFailBehavior: v }))} disabled={!isEditing}>
                            <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"><SelectValue /></SelectTrigger>
                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                              <SelectItem value="warn"  className="font-bold uppercase text-[10px] tracking-widest py-3"><div className="space-y-0.5"><p>Warn Only</p><p className="text-[8px] opacity-40">Show warning but allow clock-in to proceed</p></div></SelectItem>
                              <SelectItem value="block" className="font-bold uppercase text-[10px] tracking-widest py-3"><div className="space-y-0.5"><p>Hard Block</p><p className="text-[8px] opacity-40">Prevent clock-in entirely until inside zone</p></div></SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>

              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={TrendingUp} title="Overtime & Hours Policy" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Define thresholds for overtime, auto clock-out, and break enforcement.</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-5 text-left">
                  {[
                    { field: 'dailyOvertimeHours',     icon: Clock,         iconColor: 'text-amber-600', label: 'Daily Overtime Threshold',   desc: 'Hours worked in a single day before overtime kicks in',                          suffix: 'hrs', min: 1,   max: 24,  step: 0.5, placeholder: '8'   },
                    { field: 'overtimeThresholdHours', icon: TrendingUp,    iconColor: 'text-primary',   label: 'Weekly Overtime Threshold',  desc: 'Total hours in a week before overtime rates apply',                              suffix: 'hrs', min: 1,   max: 60,  step: 0.5, placeholder: '40'  },
                    { field: 'overtimeMultiplier',     icon: DollarSign,    iconColor: 'text-green-600', label: 'Overtime Pay Multiplier',    desc: 'Rate multiplied by hourly rate for overtime hours (e.g. 1.5 = time and a half)', prefix: 'x',   min: 1,   max: 3,   step: 0.25,placeholder: '1.5' },
                    { field: 'autoClockOutHours',      icon: AlertTriangle, iconColor: 'text-amber-600', label: 'Auto Clock-Out',             desc: 'Automatically clock out staff after this many hours of inactivity',              suffix: 'hrs', min: 1,   max: 24,  step: 1,   placeholder: '10', amber: true },
                    { field: 'overtimeAlertHours',     icon: Bell,          iconColor: 'text-primary',   label: 'Overtime Approach Alert',    desc: 'Alert manager when a staff member is this many hours away from overtime',       suffix: 'hrs', min: 0.5, max: 8,   step: 0.5, placeholder: '2'   },
                  ].map(item => (
                    <div key={item.field} className={cn('p-5 rounded-[2rem] border-2 space-y-4', (item as any).amber ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200')}>
                      <div className="flex items-start gap-4">
                        <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0"><item.icon className={cn('w-4 h-4', item.iconColor)} /></div>
                        <div className="space-y-1">
                          <p className={cn('text-sm font-black uppercase tracking-tight', (item as any).amber ? 'text-amber-800' : 'text-slate-900')}>{item.label}</p>
                          <p className={cn('text-[9px] font-bold uppercase tracking-widest opacity-60', (item as any).amber ? 'text-amber-700/60' : 'text-muted-foreground')}>{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 pl-12">
                        <NumberInput value={(tenantData as any)[item.field]} onChange={(v: number) => setTenantData(prev => ({ ...prev, [item.field]: v }))} disabled={!isEditing} suffix={item.suffix} prefix={item.prefix} min={item.min} max={item.max} step={item.step} placeholder={item.placeholder} />
                      </div>
                    </div>
                  ))}
                  <Separator className="border-dashed" />
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-1"><BreakIcon className="w-5 h-5 text-primary" /><h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Break Policy</h3></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        { field: 'minimumBreakMinutes',     label: 'Minimum Break Duration', suffix: 'min', min: 0, max: 120, placeholder: '10', desc: 'Shortest allowed break'           },
                        { field: 'maximumBreakMinutes',     label: 'Maximum Break Duration', suffix: 'min', min: 0, max: 240, placeholder: '60', desc: 'Alert fires if exceeded'          },
                        { field: 'requiredBreakAfterHours', label: 'Required Break After',   suffix: 'hrs', min: 0, max: 12,  placeholder: '4',  desc: 'Hours before break is mandated', step: 0.5 },
                        { field: 'paidBreakMinutes',        label: 'Paid Break Limit',       suffix: 'min', min: 0, max: 120, placeholder: '15', desc: 'Minutes counted as paid time'    },
                      ].map(item => (
                        <div key={item.field} className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</p>
                          <NumberInput value={(tenantData as any)[item.field]} onChange={(v: number) => setTenantData(prev => ({ ...prev, [item.field]: v }))} disabled={!isEditing} suffix={item.suffix} min={item.min} max={item.max} step={item.step} placeholder={item.placeholder} />
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </main>

      {tenantId && (
        <PrintStationCardsDialog
          open={isPrintStationsOpen}
          onOpenChange={setIsPrintStationsOpen}
          tenantId={tenantId}
          tenantName={tenantData.name || 'Studio'}
          logoUrl={tenantData.bookingPageSettings?.logoUrl}
        />
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader className="animate-spin h-10 w-10 text-primary" />
        <p className="ml-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Configuring Terminal...</p>
      </div>
    }>
      <SettingsPageImpl />
    </Suspense>
  );
}
