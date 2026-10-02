'use client';

import { moduleEnabled, MODULES, SETTINGS_TAB_MODULE } from '@/lib/modules';
import { Section, Row, Toggle, Choice, More, cfInput, cfInputStyle, toPicker, fromPicker } from '@/components/settings/settings-ui';
import { SettingsStyle } from '@/components/settings/settings-style';
import { useLocation } from '@/context/LocationContext';
import { ProtocolsCard } from '@/components/settings/ProtocolsCard';
import { KioskOptionsCard } from '@/components/settings/KioskOptionsCard';
import { VisitStagesCard } from '@/components/settings/VisitStagesCard';
import { ClientScreenCard } from '@/components/settings/ClientScreenCard';
import { TeamDiscountsCard } from '@/components/settings/TeamDiscountsCard';
import { VoidsApprovalsCard } from '@/components/settings/VoidsApprovalsCard';
import { CheckoutNudgesCard } from '@/components/settings/CheckoutNudgesCard';
import { SalesTaxCard } from '@/components/settings/SalesTaxCard';
import { PayLaterCard } from '@/components/settings/PayLaterCard';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Activity, AlertTriangle, ArrowRight, Ban, Bell, Box, Building, Calendar, CalendarCheck, Check, CheckCircle2, ChevronDown, Clock, Coffee, Coffee as BreakIcon, CreditCard, DollarSign, Edit, Eye, FileText, FileWarning, Fingerprint, Flame, Globe, HeartHandshake, ImageIcon, Landmark, LayoutGrid, Loader, Mail, Map as MapIcon, MapPin, Monitor, Palette, Percent, PlusCircle, Printer, QrCode, RefreshCw, Save, Scale, Scale as ScaleIcon, Search, Settings as SettingsIcon, Shield, ShieldAlert, ShieldCheck, Smartphone, Sparkles, Star, Tag, Target, Timer, Trash2, TrendingUp, Unlock, Users, Wallet, Wifi, Workflow, Zap, Route, SprayCan, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { useFirebase, updateDocumentNonBlocking, useMemoFirebase, useCollection } from '@/firebase';
import { doc, writeBatch, deleteField, getDocs, query, collection, where } from 'firebase/firestore';
import { type Tenant, type ScheduleProfile, type DayHours, type Service, type PricingTier, type Staff, type RecoveryPreset, nanoid } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { SettingsHome } from '@/components/settings/SettingsHome';
import Link from 'next/link';
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
import { TerminalSettings } from '@/components/pos/TerminalSettings';
import { LocationsSettingsTab } from '@/components/settings/LocationsSettingsTab';
import { TimezoneSettingCard } from '@/components/settings/TimezoneSettingCard';
import { releaseSentence } from '@/lib/booking-release';

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
  const { selectedTenant, isLoading: isTenantContextLoading, role } = useTenant() as any;
  const { scheduleProfiles, services, inventory, isLoading: isInventoryLoading } = useInventory();
  const searchParams   = useSearchParams();
  const tabParam       = searchParams.get('tab');

  const [activeTab,        setActiveTab]        = useState(tabParam || 'profile');
  // Settings save as you go (no Edit/Save mode). Kept as constants so every field stays enabled.
  const isEditing = true; const setIsEditing = (_v: boolean) => {};
  // Where staff can clock in now lives on each LOCATION (address, map pin, radius). The first time an owner or
  // manager opens the Time clock tab, any location missing those inherits the old studio-wide values once (server).
  const { locations: clockLocations } = useLocation() as any;
  React.useEffect(() => {
    if (activeTab !== 'timeclock' || !selectedTenant?.id || (selectedTenant as any)?.timeclockInheritedAt) return;
    (async () => { try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken();
      await fetch('/api/settings/timeclock-inherit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId: selectedTenant.id }) }); } catch { /* tries again next time */ } })();
  }, [activeTab, selectedTenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // What was edited here — so a save writes ONLY that (never stale copies of settings changed elsewhere).
  const dirty = React.useRef<{ sched: boolean; kiosk: boolean; svc: Set<string> }>({ sched: false, kiosk: false, svc: new Set() });
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
  const handleSave = async (silent = false) => {
    if (!selectedTenant || !firestore) return;
    const { bookingPageSettings: _pageBuilderOwned, ...cur } = tenantData as any;
    const base: any = selectedTenant || {};
    const changed: any = {};
    for (const k of Object.keys(cur)) if (k !== 'id' && JSON.stringify(cur[k] ?? null) !== JSON.stringify(base[k] ?? null)) changed[k] = cur[k];
    if (dirty.current.kiosk || changed.kioskSettings) changed.kioskSettings = { ...(tenantData.kioskSettings || {}), kioskSchedule: tenantData.kioskSettings?.useSpecificHours ? localKioskSchedule : null };
    const svcIds = Array.from(dirty.current.svc); const sched = dirty.current.sched && !!activeProfile && !!localSchedule;
    if (!Object.keys(changed).length && !svcIds.length && !sched) return;     // nothing new — nothing written
    setSaveState('saving');
    try {
      const batch = writeBatch(firestore);
      if (Object.keys(changed).length) batch.update(doc(firestore, 'tenants', selectedTenant.id), changed);
      if (sched) batch.update(doc(firestore, `tenants/${selectedTenant.id}/scheduleProfiles`, activeProfile!.id), { week: localSchedule, bookingSlotInterval: localInterval });
      for (const id of svcIds) {
        const p = servicePolicies[id]; if (!p) continue;
        const originalService = services.find(x => x.id === id);
        batch.update(doc(firestore, `tenants/${selectedTenant.id}/services`, id), {
          cancellationFeeMode:     p.mode,
          cancellationWindowHours: p.window || (deleteField() as any),
          customCancellationFee:   p.mode === 'flat' ? p.value : (p.mode === 'inherit' ? (deleteField() as any) : (originalService?.customCancellationFee || 0)),
          cancellationFeeValue:    p.value || (deleteField() as any),
        });
      }
      await batch.commit();
      dirty.current = { sched: false, kiosk: false, svc: new Set() };
      setSaveState('saved');
      if (!silent) toast({ title: 'Saved' });
    } catch { setSaveState('error'); toast({ variant: 'destructive', title: 'Couldn’t save that change', description: 'Check your connection — it will try again when you change something.' }); }
  };

  // Save as you go: a moment after any change here.
  useEffect(() => {
    if (!selectedTenant) return;
    const t = setTimeout(() => { void handleSave(true); }, 900);
    return () => clearTimeout(t);
  }, [tenantData, localSchedule, localInterval, servicePolicies, localKioskSchedule]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadStrategicTemplates = () => {
    setTenantData(prev => ({ ...prev, escalationPolicy: defaultEscalationPolicy, recoveryPresets: defaultRecoveryPresets, maxAutonomousRecoveryAmount: 50, maxAutonomousRecoveryPercent: 25 }));
    toast({ title: 'Strategic Templates Loaded' });
  };

  const handleScheduleChange      = (day: string, updates: Partial<DayHours>) => (dirty.current.sched = true, setLocalSchedule)((prev: any) => ({ ...prev, [day]: { ...prev[day], ...updates } }));
  const handleKioskScheduleChange = (day: string, updates: Partial<DayHours>) => (dirty.current.kiosk = true, setLocalKioskSchedule)((prev: any) => ({ ...prev, [day]: { ...(prev?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }), ...updates } }));
  const handlePolicyChange        = (id: string, updates: any) => (dirty.current.svc.add(id), setServicePolicies)(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  const handleAddPreset           = () => setTenantData(prev => ({ ...prev, recoveryPresets: [...(prev.recoveryPresets || []), { id: nanoid(), label: 'NEW PRESET', type: 'fixed', value: 0 }] }));
  const handleRemovePreset        = (id: string) => setTenantData(prev => ({ ...prev, recoveryPresets: prev.recoveryPresets?.filter(p => p.id !== id) }));
  const handleUpdatePreset        = (id: string, updates: Partial<RecoveryPreset>) => setTenantData(prev => ({ ...prev, recoveryPresets: prev.recoveryPresets?.map(p => p.id === id ? { ...p, ...updates } : p) }));

  const filteredServices = useMemo(() => {
    if (!services) return [];
    if (!serviceSearch.trim()) return services;
    const s = serviceSearch.toLowerCase();
    return services.filter(svc => svc.name.toLowerCase().includes(s) || (svc.category || '').toLowerCase().includes(s));
  }, [services, serviceSearch]);

  const depositOutcomeRules = [
    { key: 'onEarlyCancel',  label: 'Client cancels EARLY',  desc: 'Outside the refund window' },
    { key: 'onLateCancel',   label: 'Client cancels LATE',   desc: 'Inside the refund window'   },
    { key: 'onNoShow',       label: 'Client NO-SHOWS',       desc: 'Never arrives'              },
    { key: 'onStudioCancel', label: 'STUDIO cancels',        desc: 'Your side cancels'          },
  ];

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs = [
    // Your business
    { value: 'profile',     label: 'Your business',            icon: <Building className="w-4 h-4" />    },
    { value: 'hours',       label: 'Opening hours',            icon: <Clock className="w-4 h-4" />       },
    { value: 'locations',   label: 'Locations',                icon: <MapPin className="w-4 h-4" />      },
    // Payments
    { value: 'payments',    label: 'Payments & payouts',       icon: <DollarSign className="w-4 h-4" />  },
    { value: 'terminal',    label: 'Card reader',              icon: <Monitor className="w-4 h-4" />     },
    { value: 'policies',    label: 'Fees & credit',    icon: <ShieldCheck className="w-4 h-4" /> },
    // Front desk & visits
    { value: 'visits',      label: 'Visit stages',             icon: <Route className="w-4 h-4" />       },
    { value: 'kiosk',       label: 'Check-in kiosk',           icon: <Fingerprint className="w-4 h-4" /> },
    { value: 'experience',  label: 'Guest comforts & Wi-Fi',   icon: <Coffee className="w-4 h-4" />      },
    // Operations
    { value: 'operations',  label: 'Cleaning protocols',       icon: <SprayCan className="w-4 h-4" />    },
    // Team
    { value: 'timeclock',   label: 'Time clock',               icon: <Timer className="w-4 h-4" />       },
  ].filter((t) => !SETTINGS_TAB_MODULE[t.value] || moduleEnabled(selectedTenant, SETTINGS_TAB_MODULE[t.value]));   // only tools on this business's plan

  // Tabs that manage their own state — hide global save/cancel for these
  const selfManagedTabs = ['terminal', 'automations', 'locations'];

  if (isTenantContextLoading || isInventoryLoading) {
    return <div className="p-8 flex items-center justify-center h-full"><Loader className="animate-spin text-primary" /></div>;
  }

  return (
    <div className="cf-settings cf-legacy flex h-full w-full flex-col overflow-hidden">
      <SettingsStyle />
      <AppHeader title="Settings" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-8 md:space-y-10 px-4 py-6 md:px-10 md:py-10 pb-32">

          {/* Page header — back to Settings, this page's name, what it's for, and the pages that belong with it */}
          <header className="space-y-4 text-left">
            <Link href="/settings" className="inline-flex items-center gap-1 text-[14px] font-medium cf-muted hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />Settings</Link>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <h1 className="text-[32px] md:text-[38px] font-light tracking-tight leading-none">{tabs.find((t) => t.value === activeTab)?.label || (SETTINGS_TAB_MODULE[activeTab] ? MODULES[SETTINGS_TAB_MODULE[activeTab]]?.label : null) || 'Settings'}</h1>
                <p className="max-w-[60ch] text-[15px] cf-muted">{WHATS_HERE[activeTab] || 'Everything about how your business runs.'}</p>
              </div>
              {!selfManagedTabs.includes(activeTab) && (
                <p className="text-[13px] cf-muted" aria-live="polite">
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? <button type="button" className="underline" onClick={() => handleSave()}>Couldn’t save — try again</button> : null}
                </p>
              )}
            </div>
            {(() => { const sibs = (TAB_GROUPS.find((g) => g.includes(activeTab)) || []).filter((v) => tabs.some((t) => t.value === v));
              return sibs.length > 1 ? (
                <nav aria-label="Related settings" className="flex flex-wrap gap-2">
                  {sibs.map((v) => { const t = tabs.find((x) => x.value === v)!; const on = v === activeTab; return (
                    <button key={v} type="button" onClick={() => { setActiveTab(v); try { window.history.replaceState(null, '', `/settings?tab=${v}`); } catch { /* ignore */ } }} aria-current={on ? 'page' : undefined}
                      className="h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors" style={on ? { background: 'var(--ink)', color: 'var(--paper)' } : { background: 'var(--soft)', color: 'var(--ink)' }}>{t.label}</button>); })}
                </nav>) : null; })()}
          </header>

          {SETTINGS_TAB_MODULE[activeTab] && !moduleEnabled(selectedTenant, SETTINGS_TAB_MODULE[activeTab]) && (
            <div className="cf-sheet space-y-3 p-6">
              <p className="text-[16px] font-medium">This is part of {MODULES[SETTINGS_TAB_MODULE[activeTab]]?.label || 'a tool'}, which isn’t on your plan.</p>
              <div className="flex flex-wrap gap-3"><Link href="/subscriptions" className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>See plans</Link>
                <Link href="/settings" className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-medium" style={{ background: 'var(--soft)' }}>Back to Settings</Link></div>
            </div>)}
          {!(SETTINGS_TAB_MODULE[activeTab] && !moduleEnabled(selectedTenant, SETTINGS_TAB_MODULE[activeTab])) && <Tabs value={activeTab} className="w-full">

            {/* ── PROFILE ── */}
            <TabsContent value="profile" className="mt-0 space-y-10 text-left">
              <Section title="What clients see" help="Shown on your booking page, kiosk, receipts and messages.">
                <Row label="Business name"><input className={cfInput} style={cfInputStyle} value={tenantData.name || ''} onChange={(e) => setTenantData((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Opal Manicure Studio" autoComplete="organization" /></Row>
                <Row label="Logo" help="A square image works best."><ImageUpload label="Upload your logo" onImageUploaded={(url) => setTenantData((prev) => ({ ...prev, logoUrl: url } as any))} initialImage={(tenantData as any).logoUrl} /></Row>
                <Row label="Phone" help="So clients can call you.">
                  <input className={cfInput} style={cfInputStyle} type="tel" inputMode="tel" autoComplete="tel" value={(tenantData as any).phone || ''} placeholder="(555) 123-4567"
                    onChange={(e) => { const v = e.target.value; setTenantData((prev) => ({ ...prev, phone: v, contactPhone: v, businessPhone: v } as any)); }} />
                </Row>
                <Row label="Email" help="Where clients’ replies go.">
                  <input className={cfInput} style={cfInputStyle} type="email" inputMode="email" autoComplete="email" value={(tenantData as any).email || (tenantData as any).contactEmail || ''} placeholder="hello@yourstudio.com"
                    onChange={(e) => { const v = e.target.value.trim(); setTenantData((prev) => ({ ...prev, email: v, contactEmail: v, businessEmail: v } as any)); }} />
                </Row>
                <Row label="Address" help="Printed on receipts and messages. Each location keeps its own address for directions.">
                  <input className={cfInput} style={cfInputStyle} autoComplete="street-address" value={(tenantData as any).address || ''} placeholder="Street, city, state" onChange={(e) => setTenantData((prev) => ({ ...prev, address: e.target.value } as any))} />
                </Row>
              </Section>
              <More label="Time zone" help="Set when you signed up — change it only if you’ve moved.">
                <TimezoneSettingCard firestore={firestore} tenantId={tenantId || ''} tenant={selectedTenant} />
              </More>
            </TabsContent>

            {/* ── LOCATIONS ── */}
            <TabsContent value="locations" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              <LocationsSettingsTab />
            </TabsContent>

            {/* ── PAYMENTS ── */}
            <TabsContent value="payments" className="mt-0 space-y-10 text-left">
              <Section title="Get paid">
                <div className="p-5">
                  <StripeConnectSetup
                    tenantId={tenantId || ''}
                    stripeAccountId={(selectedTenant as any)?.stripeAccountId}
                    onDisconnect={async () => {
                      const res = await fetch('/api/stripe/disconnect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: tenantId }),
                      });
                      if (!res.ok) throw new Error('Failed to disconnect');
                    }}
                  />
                </div>
              </Section>
              {tenantId && <SalesTaxCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
              <More label="More checkout options" help="Pay later, tip prompts, refunds and voids, team discounts, and the screen clients see.">
                <PayLaterCard tenantId={tenantId || ''} />
                {tenantId && <CheckoutNudgesCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
                {tenantId && <VoidsApprovalsCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
                {tenantId && <TeamDiscountsCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
                {tenantId && <ClientScreenCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
              </More>
            </TabsContent>

            {/* ── TERMINAL READER ── */}
            <TabsContent value="terminal" className="mt-0 space-y-10 text-left">
              <Section title="Card reader" help="The card reader at your front desk. Connect it once and the desk uses it automatically.">
                <div className="p-5"><TerminalSettings /></div>
              </Section>
            </TabsContent>

            {/* ── AUTOMATIONS ── */}

            {/* ── HOURS ── */}
            <TabsContent value="hours" className="mt-0 space-y-10 text-left">
              <Section title="When are you open?" help="Clients can only book inside these hours.">
                {localSchedule ? dayOrder.map((day) => { const d = localSchedule[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }; const name = day[0].toUpperCase() + day.slice(1); return (
                  <div key={day} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
                    <div className="flex w-36 items-center gap-3"><Toggle checked={!!d.enabled} onChange={(v) => handleScheduleChange(day, { enabled: v })} label={`Open on ${name}`} /><span className="text-[15px] font-medium">{name}</span></div>
                    {d.enabled ? (
                      <div className="flex flex-1 items-center gap-2 min-w-[15rem]">
                        <input type="time" aria-label={`${name} opens`} className={cfInput} style={cfInputStyle} value={toPicker(d.start)} onChange={(e) => handleScheduleChange(day, { start: fromPicker(e.target.value) })} />
                        <span className="text-[14px] cf-muted">to</span>
                        <input type="time" aria-label={`${name} closes`} className={cfInput} style={cfInputStyle} value={toPicker(d.end)} onChange={(e) => handleScheduleChange(day, { end: fromPicker(e.target.value) })} />
                      </div>
                    ) : <span className="text-[14px] cf-muted">Closed</span>}
                  </div>); })
                : isInventoryLoading ? <div className="py-12 text-center"><Loader className="mx-auto h-6 w-6 animate-spin cf-muted" /></div>
                : <div className="space-y-3 px-5 py-6">
                    <p className="text-[15px]">You haven’t set your opening hours yet.</p>
                    <button type="button" className="h-11 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}
                      onClick={async () => { if (!firestore || !tenantId) return; const { doc: d, setDoc: sd, collection: c } = await import('firebase/firestore'); const ref = d(c(firestore, 'tenants', tenantId, 'scheduleProfiles'));
                        const day = (on: boolean) => ({ enabled: on, start: '09:00 AM', end: '05:00 PM' });
                        await sd(ref, { id: ref.id, name: 'Standard hours', isActive: true, isPublic: true, bookingSlotInterval: 15, week: { monday: day(true), tuesday: day(true), wednesday: day(true), thursday: day(true), friday: day(true), saturday: day(false), sunday: day(false) } }); }}>
                      Set your opening hours</button>
                    <p className="text-[13.5px] cf-muted">We’ll start you on Monday to Friday, 9 to 5 — change any day after.</p>
                  </div>}
                {localSchedule && (localSchedule.monday?.enabled) && (
                  <div className="px-5 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                    <button type="button" className="text-[14px] font-medium underline underline-offset-4" onClick={() => { const m = localSchedule.monday; dayOrder.forEach((day) => { if (day !== 'monday' && localSchedule[day]?.enabled) handleScheduleChange(day, { start: m.start, end: m.end }); }); }}>Copy Monday’s hours to every open day</button>
                  </div>)}
              </Section>
              <More help="Booking times, and limiting some days to certain clients.">
                <Section title="How often a booking can start" help="Every 15 minutes gives clients the most choice.">
                  <Row label="Clients can start a booking every" inline>
                    <Choice label="Booking times" value={localInterval} options={[{ value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 hour' }]} onChange={(v) => { dirty.current.sched = true; setLocalInterval(Number(v)); }} />
                  </Row>
                </Section>
                {localSchedule && <Section title="Only some clients on certain days" help="For example, keep Saturdays for returning clients.">
                  {dayOrder.filter((day) => localSchedule[day]?.enabled).map((day) => (
                    <Row key={day} label={day[0].toUpperCase() + day.slice(1)} inline>
                      <select className="h-10 rounded-xl border px-3 text-[14px]" style={cfInputStyle} value={localSchedule[day]?.accessTier || 'all'} onChange={(e) => handleScheduleChange(day, { accessTier: e.target.value as any })} aria-label={`Who can book on ${day}`}>
                        <option value="all">Everyone</option><option value="returning">Returning clients</option><option value="members">Members & package holders</option>
                      </select>
                    </Row>))}
                </Section>}
              </More>
            </TabsContent>

            {/* ── EXPERIENCE ── */}
            <TabsContent value="visits" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              {tenantId && <VisitStagesCard tenantId={tenantId} tenant={selectedTenant} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
            </TabsContent>

            <TabsContent value="operations" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
              {tenantId && <ProtocolsCard tenantId={tenantId} canEdit={['owner', 'admin', 'manager'].includes(String((role as any) || '').toLowerCase())} />}
            </TabsContent>

            <TabsContent value="experience" className="mt-0 space-y-10 text-left">
              <Section title="Wi-Fi for guests" help="Shown to clients when they check in, so nobody has to ask.">
                <Row label="Network name"><input className={cfInput} style={cfInputStyle} value={tenantData.wifiNetwork || ''} onChange={(e) => setTenantData((prev) => ({ ...prev, wifiNetwork: e.target.value }))} placeholder="e.g. Opal Guest" autoComplete="off" /></Row>
                <Row label="Password"><input className={cfInput} style={cfInputStyle} value={tenantData.wifiPassword || ''} onChange={(e) => setTenantData((prev) => ({ ...prev, wifiPassword: e.target.value }))} placeholder="Leave empty if there isn’t one" autoComplete="off" /></Row>
              </Section>
              <Section title="Guest extras">
                <Row label="Show the guest experience after check-in" help="Clients see the Wi-Fi and anything else you offer, on their phone." inline><Toggle checked={(tenantData as any).guestExperienceEnabled === true} onChange={(v) => setTenantData((prev) => ({ ...prev, guestExperienceEnabled: v } as any))} label="Show the guest experience after check-in" /></Row>
                {moduleEnabled(selectedTenant, 'hospitality') && <><Row label="Offer drinks and refreshments" help="Clients can order from your refreshment menu while they wait." inline><Toggle checked={!!tenantData.refreshmentServiceEnabled} onChange={(v) => setTenantData((prev) => ({ ...prev, refreshmentServiceEnabled: v }))} label="Offer drinks and refreshments" /></Row>
                {tenantData.refreshmentServiceEnabled && <Row label="Free items per visit" help="After this, extras are charged." inline>
                  <input type="number" min={0} max={10} value={tenantData.complimentaryAmenityLimit || 0} onChange={(e) => setTenantData((prev) => ({ ...prev, complimentaryAmenityLimit: parseInt(e.target.value) || 0 }))} className={`${cfInput} w-20 text-center`} style={cfInputStyle} aria-label="Free items per visit" />
                </Row>}</>}
              </Section>
            </TabsContent>

            {/* ── POLICIES ── */}
            <TabsContent value="policies" className="mt-0 space-y-10 text-left">
              {(() => { const Num = ({ field, prefix, suffix, step = 1, width = 'w-24', int = false }: { field: string; prefix?: string; suffix?: string; step?: number; width?: string; int?: boolean }) => (
                <span className="inline-flex items-center gap-2">{prefix && <span className="text-[14px] cf-muted">{prefix}</span>}<input type="number" inputMode="decimal" min={0} step={step} value={(tenantData as any)[field] ?? ''} placeholder="0"
                  onChange={(e) => { const v = e.target.value === '' ? undefined : (int ? parseInt(e.target.value) : parseFloat(e.target.value)); setTenantData((prev) => ({ ...prev, [field]: Number.isFinite(v as any) ? v : 0 } as any)); }} className={`${cfInput} ${width} text-center`} style={cfInputStyle} />{suffix && <span className="text-[14px] cf-muted">{suffix}</span>}</span>);
              const T = (field: string, label: string, help?: string, invert = false) => <Row key={field} label={label} help={help} inline><Toggle checked={invert ? (tenantData as any)[field] !== false : !!(tenantData as any)[field]} onChange={(v) => setTenantData((prev) => ({ ...prev, [field]: v } as any))} label={label} /></Row>;
              return (<>
              <Section title="Fees and credit" help="Missed-visit fees and store credit.">
                {T('allowGuestFeeDeferral', 'Let clients pay fees later', 'They can book again while a fee is still open.')}
                <a href="/settings/automations#sw:fee-collection" className="flex items-center justify-between gap-3 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
                  <span className="min-w-0"><span className="block text-[15px] font-medium">Collecting fees from the card on file: {(tenantData as any)?.automations?.feeCollection === true ? 'on' : 'off'}</span>
                    <span className="block text-[13.5px] cf-muted">Switched in Automations, with the other things the app does on its own.</span></span>
                  <span className="shrink-0 text-[14px] font-medium">Change →</span></a>
                <Row label="Store credit expires after" help="Leave at 0 to never expire." inline><Num field="storeCreditExpiryDays" suffix="days" int /></Row>
              </Section>
              <More help="Making things right when a visit goes wrong, and rules for specific services.">
                <Section title="Making things right" help="When a visit goes wrong — a late start, a fix that’s needed.">
                  <Row label="Staff can give up to" help="Discounts at checkout and store credit, without a manager. Over this, a manager approves with their PIN. $0 means a manager approves every one. The % is optional." inline>
                    <span className="inline-flex items-center gap-2"><Num field="maxAutonomousRecoveryAmount" prefix="$" width="w-24" /><span className="text-[14px] cf-muted">or</span><Num field="maxAutonomousRecoveryPercent" suffix="%" width="w-20" /></span>
                  </Row>
                  <Row label="Instructions for staff" help="What to do when something goes wrong.">
                    <textarea rows={4} value={tenantData.escalationPolicy || ''} onChange={(e) => setTenantData((prev) => ({ ...prev, escalationPolicy: e.target.value }))} className="w-full rounded-xl border p-3 text-[15px] outline-none focus:border-[var(--accent)]" style={cfInputStyle} placeholder="e.g. Apologise, offer a fix today, and tell a manager." />
                  </Row>
                  <Row label="Quick credits staff can pick">
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
                    <button type="button" onClick={handleAddPreset} className="mt-2 text-[14px] font-medium underline underline-offset-4">Add a quick credit</button>
                  </Row>
                </Section>
                <Section title="Rules for specific services" help="Override deposits and fees for a particular service.">
                  <div className="px-5 py-4">
                    <input placeholder="Search your services" value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} className={cfInput} style={cfInputStyle} aria-label="Search services" />
                    <div className="mt-4 grid grid-cols-1 gap-4">{filteredServices.map((service) => (
                      <ServicePolicyCard key={service.id} service={service} tmhr={tenantData.tmhr || 50} inventory={inventory} isEditing={isEditing} localPolicy={servicePolicies[service.id]} onPolicyChange={(updates) => handlePolicyChange(service.id, updates)} />))}</div>
                  </div>
                </Section>
              </More>
              </>); })()}
            </TabsContent>

            {/* ── BUILDER ── */}

            {/* ── KIOSK ── */}
            <TabsContent value="kiosk" className="mt-0 space-y-10 text-left">
              {tenantId && <KioskOptionsCard tenantId={tenantId} tenant={selectedTenant} canEdit={String((role as any) || '').toLowerCase() === 'owner'} />}
              <Section title="How it looks" help="On the kiosk and on your guest pages (events, quotes, inquiries, job applications).">
                <Row label="Logo" help="Your business logo is used unless you add a different one here.">
                  <ImageUpload label="Upload a different logo" onImageUploaded={(url) => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, logoUrl: url } }))} initialImage={tenantData.kioskSettings?.logoUrl} />
                  {tenantData.kioskSettings?.logoUrl && <button type="button" onClick={() => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, logoUrl: '' } } as any))} className="mt-2 text-[13.5px] underline underline-offset-4">Use my business logo instead</button>}
                </Row>
                <Row label="Show your business name" inline><Toggle checked={tenantData.kioskSettings?.showWordmark !== false} onChange={(v) => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, showWordmark: v } }))} label="Show your business name" /></Row>
                <Row label="Look" inline>
                  <Choice label="Kiosk look" value={(tenantData.kioskSettings?.theme as string) || 'light'} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'rose', label: 'Rose' }, { value: 'sage', label: 'Sage' }, { value: 'slate', label: 'Slate' }]} onChange={(v) => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, theme: v } } as any))} />
                </Row>
                <Row label="Button colour" help="Leave it to use your business colour." inline>
                  <span className="inline-flex items-center gap-2">
                    <input type="color" aria-label="Button colour" value={/^#[0-9a-fA-F]{6}$/.test(kioskCustomHex) ? kioskCustomHex : '#7c3aed'} onChange={(e) => { const hex = e.target.value; setKioskCustomHex(hex); setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: hex } } as any)); }} className="h-10 w-12 cursor-pointer rounded-lg border bg-transparent p-0.5" style={{ borderColor: 'var(--line)' }} />
                    {tenantData.kioskSettings?.primaryColor && <button type="button" onClick={() => { setKioskCustomHex(''); setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: undefined } } as any)); }} className="text-[13.5px] underline underline-offset-4">Use my colour</button>}
                  </span>
                </Row>
              </Section>
              <More help="A text logo, and kiosk hours that differ from your opening hours.">
                <Section title="Text logo" help="A wide image of your name, shown instead of plain text.">
                  <Row label="Wordmark"><ImageUpload label="Upload a text logo" onImageUploaded={(url) => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, wordmarkUrl: url } }))} initialImage={tenantData.kioskSettings?.wordmarkUrl} /></Row>
                </Section>
                <Section title="Kiosk hours" help="By default the kiosk takes walk-ins during your opening hours.">
                  <Row label="Use different hours for the kiosk" inline><Toggle checked={!!tenantData.kioskSettings?.useSpecificHours} onChange={(v) => setTenantData((prev) => ({ ...prev, kioskSettings: { ...prev.kioskSettings, useSpecificHours: v } }))} label="Use different hours for the kiosk" /></Row>
                  <div className="px-5 py-2">
                    {tenantData.kioskSettings?.useSpecificHours && dayOrder.map((day) => { const d = localKioskSchedule?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }; const name = day[0].toUpperCase() + day.slice(1); return (
                      <div key={`kiosk-${day}`} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
                        <div className="flex w-36 items-center gap-3"><Toggle checked={!!d.enabled} onChange={(v) => handleKioskScheduleChange(day, { enabled: v })} label={`Kiosk open on ${name}`} /><span className="text-[15px] font-medium">{name}</span></div>
                        {d.enabled ? (<div className="flex flex-1 items-center gap-2 min-w-[15rem]">
                          <input type="time" aria-label={`${name} kiosk opens`} className={cfInput} style={cfInputStyle} value={toPicker(d.start)} onChange={(e) => handleKioskScheduleChange(day, { start: fromPicker(e.target.value) })} />
                          <span className="text-[14px] cf-muted">to</span>
                          <input type="time" aria-label={`${name} kiosk closes`} className={cfInput} style={cfInputStyle} value={toPicker(d.end)} onChange={(e) => handleKioskScheduleChange(day, { end: fromPicker(e.target.value) })} />
                        </div>) : <span className="text-[14px] cf-muted">Closed</span>}
                      </div>); })}
                  </div>
                </Section>
              </More>
            </TabsContent>

            {/* ── TIME CLOCK ── */}
            <TabsContent value="timeclock" className="mt-0 space-y-10 text-left">
              {(() => { const Num = ({ field, suffix, min = 0, max = 999, step = 1, width = 'w-24' }: { field: string; suffix?: string; min?: number; max?: number; step?: number; width?: string }) => (
                <span className="inline-flex items-center gap-2"><input type="number" inputMode="decimal" min={min} max={max} step={step} value={(tenantData as any)[field] ?? ''} placeholder="0"
                  onChange={(e) => { const v = e.target.value === '' ? undefined : Number(e.target.value); setTenantData((prev) => ({ ...prev, [field]: v } as any)); }} className={`${cfInput} ${width} text-center`} style={cfInputStyle} aria-label={field} />{suffix && <span className="text-[14px] cf-muted">{suffix}</span>}</span>);
              const T = (field: string, label: string, help?: string) => <Row key={field} label={label} help={help} inline><Toggle checked={!!(tenantData as any)[field]} onChange={(v) => setTenantData((prev) => ({ ...prev, [field]: v } as any))} label={label} /></Row>;
              return (<>
              <Section title="Clocking in">
                {T('geoFenceEnabled', 'Staff must be at a location to clock in', 'Uses their phone’s location. Where counts is set on each location.')}
                {tenantData.geoFenceEnabled && (<>
                  <div className="px-5 py-4 [&+&]:border-t" style={{ borderTop: '1px solid var(--line)' }}>
                    <ul className="space-y-1.5">{(clockLocations || []).map((l: any) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]"><span className="font-medium">{l.name}</span>
                        <span className={l.coordinates ? 'cf-muted' : 'font-semibold text-amber-700'}>{l.coordinates ? `Within ${Number(l.geoFenceRadiusMeters) || Number(tenantData.geoFenceRadiusMeters) || 200} m` : 'No map pin yet'}</span></li>))}</ul>
                    <a href="/settings?tab=locations" className="mt-2 inline-block text-[14px] font-medium underline underline-offset-4">Edit in Locations</a>
                  </div>
                  <Row label="If their location can’t be checked" help="Phones sometimes can’t get a fix indoors." inline>
                    <Choice label="If location can’t be checked" value={(tenantData.geoFenceFailBehavior as string) || 'warn'} options={[{ value: 'warn', label: 'Let them in, flag it' }, { value: 'block', label: 'Don’t let them in' }]} onChange={(v) => setTenantData((prev) => ({ ...prev, geoFenceFailBehavior: v } as any))} />
                  </Row>
                </>)}
                <Row label="Staff can clock in early by" help="Before their shift starts. Earlier than this and the clock waits." inline><Num field="earlyClockInMinutes" suffix="minutes" max={120} /></Row>
              </Section>
              <More help="Stricter rules, overtime and breaks — most studios leave these as they are.">
                <Section title="Stricter rules">
                  {T('requireAppointmentToClockIn', 'Only clock in with an appointment that day')}
                  {T('blockClockInOnExpiredLicense', 'Block clock-in if their licence has expired')}
                  {T('requireManagerOverrideForLateClockIn', 'A manager must approve late clock-ins')}
                  <Row label="Shortest shift that counts" inline><Num field="minimumShiftMinutes" suffix="minutes" max={720} /></Row>
                </Section>
                <Section title="Overtime">
                  <Row label="Overtime after, in a day" inline><Num field="dailyOvertimeHours" suffix="hours" max={24} step={0.5} /></Row>
                  <Row label="Overtime after, in a week" inline><Num field="overtimeThresholdHours" suffix="hours" max={168} step={0.5} /></Row>
                  <Row label="Overtime pay rate" help="1.5 = time and a half." inline><Num field="overtimeMultiplier" suffix="× hourly" max={5} step={0.1} /></Row>
                  <Row label="Warn a manager when someone is this close to overtime" inline><Num field="overtimeAlertHours" suffix="hours" max={24} step={0.5} /></Row>
                  <Row label="Clock out automatically after" help="Catches forgotten clock-outs." inline><Num field="autoClockOutHours" suffix="hours" max={24} step={0.5} /></Row>
                </Section>
                <Section title="Breaks">
                  <Row label="Shortest break" inline><Num field="minimumBreakMinutes" suffix="minutes" max={120} /></Row>
                  <Row label="Longest break before a manager is told" inline><Num field="maximumBreakMinutes" suffix="minutes" max={240} /></Row>
                  <Row label="A break is required after" inline><Num field="requiredBreakAfterHours" suffix="hours" max={12} step={0.5} /></Row>
                  <Row label="Paid break time" help="Minutes of each break counted as paid." inline><Num field="paidBreakMinutes" suffix="minutes" max={120} /></Row>
                </Section>
              </More>
              </>); })()}
            </TabsContent>

          </Tabs>}
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

/** One plain sentence per tab — what you'll find (and change) here. */
const WHATS_HERE: Record<string, string> = {
  profile: 'Your business name, contact details and how you appear to clients.',
  locations: 'Where you work — addresses clients see and use for directions.',
  hours: 'The days and times clients can book.',
  experience: 'What guests are offered while they’re with you — drinks, Wi-Fi and other comforts.',
  policies: 'Fees clients owe, store credit, and making things right when a visit goes wrong.',
  payments: 'How clients pay you, and how money reaches your bank.',
  terminal: 'Your card reader for taking payments in person.',
  kiosk: 'The check-in kiosk clients use when they arrive.',
  timeclock: 'How your team clocks in and out — the rules for the whole business. Where they can clock in is set on each location.',
  visits: 'The steps every visit goes through, what you call them, and what clients see on their visit link.',
  operations: 'Your cleaning procedures. Attached to a service, they become its turnover checklist.',
};

// Settings pages that belong together — shown as quick links at the top of each page.
const TAB_GROUPS: string[][] = [['profile', 'hours', 'locations'], ['payments', 'terminal', 'policies'], ['visits', 'kiosk', 'experience'], ['operations'], ['timeclock']];

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader className="animate-spin h-10 w-10 text-primary" />
        <p className="ml-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Loading settings…</p>
      </div>
    }>
      <SettingsGate />
    </Suspense>
  );
}

/** /settings → the Settings home; /settings?tab=… → that tab of the full page. */
// Tabs that were duplicates of a full page now forward there (old links keep working).
const FORWARD_TABS: Record<string, string> = { automations: '/settings/automations', builder: '/settings/booking' };
function SettingsGate() {
  const tab = useSearchParams().get('tab');
  const router = useRouter();
  const { selectedTenant } = useTenant();
  React.useEffect(() => { if (tab && FORWARD_TABS[tab]) router.replace(FORWARD_TABS[tab]); }, [tab, router]);
  if (tab && FORWARD_TABS[tab]) return null;
  // Two old tabs became their own pages — send old links there.
  const moved: Record<string, string> = { automations: '/settings/automations', builder: '/settings/booking#design' };
  if (tab && moved[tab]) { if (typeof window !== 'undefined') window.location.replace(moved[tab]); return null; }
  if (!tab) return (<><AppHeader title="Settings" /><SettingsHome tenant={selectedTenant} /></>);
  return <SettingsPageImpl />;   // its own header has the way back ("‹ Settings")
}

// ── Reconnect tally: the last 30 days of the studio's own nudges ──────────
