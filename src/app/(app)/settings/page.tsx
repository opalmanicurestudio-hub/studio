
'use client';

import React, { useState, useEffect, Suspense } from 'react';
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
  Layout,
  Fingerprint,
  Save,
  Loader,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

function SettingsPageImpl() {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { selectedTenant, isLoading: isTenantContextLoading } = useTenant();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState(tabParam || 'profile');
  const [isEditing, setIsEditing] = useState(false);
  const [tenantData, setTenantData] = useState<Partial<Tenant>>({});

  useEffect(() => {
    if (selectedTenant) {
      setTenantData(selectedTenant);
    }
  }, [selectedTenant]);

  const handleSave = async () => {
    if (!selectedTenant || !firestore) return;
    try {
      const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
      updateDocumentNonBlocking(tenantRef, tenantData);
      toast({ title: 'Settings Synchronized', description: 'Operational parameters updated.' });
      setIsEditing(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save Failed' });
    }
  };

  const tabs = [
    { value: "profile", label: "Profile", icon: <Building className="w-4 h-4" /> },
    { value: "experience", label: "Experience", icon: <Coffee className="w-4 h-4" /> },
    { value: "hours", label: "Hours", icon: <Clock className="w-4 h-4" /> },
    { value: "policies", label: "Policies", icon: <FileText className="w-4 h-4" /> },
    { value: "builder", label: "Builder", icon: <Globe className="w-4 h-4" /> },
    { value: "integrations", label: "Integrations", icon: <Zap className="w-4 h-4" /> },
  ];

  if (isTenantContextLoading) return <div className="p-8 flex items-center justify-center h-full"><Loader className="animate-spin text-primary" /></div>;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Studio Configurations" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8 md:space-y-10 p-4 md:p-10 pb-32">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
            <div className="space-y-1">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Settings</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Studio Orchestration & Governance</p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
                {isEditing ? (
                    <>
                        <Button variant="ghost" onClick={() => setIsEditing(false)} className="flex-1 sm:flex-none h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                        <Button onClick={handleSave} className="flex-[2] sm:flex-none h-12 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Save className="mr-2 h-4 w-4" />Save Archive</Button>
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
                    <TabsTrigger key={tab.value} value={tab.value} className="rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest px-4 md:px-6 h-10 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md transition-all">
                        {React.cloneElement(tab.icon as React.ReactElement, { className: "mr-2 hidden sm:block" })}
                        {tab.label}
                    </TabsTrigger>
                    ))}
                </TabsList>
                <ScrollBar orientation="horizontal" className="hidden" />
             </ScrollArea>

            <TabsContent value="experience" className="mt-0 space-y-10 animate-in fade-in duration-500">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <Coffee className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Hospitality Protocol</span>
                        </div>
                        <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter">Hospitality Concierge</CardTitle>
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60">Configure the in-service refreshment and amenity module.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-10 text-left">
                        <div className="flex flex-col sm:flex-row items-center justify-between p-6 rounded-[2rem] border-2 bg-primary/5 shadow-inner border-primary/10 gap-6">
                            <div className="space-y-1 text-center sm:text-left">
                                <Label htmlFor="refreshment-toggle" className="text-base font-black uppercase tracking-tight text-slate-900">Activate Refreshment Menu</Label>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Allows guests to request in-stock items from their portal</p>
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
                            <div className="flex items-center gap-3 px-1">
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
                            <p className="text-[9px] font-bold text-muted-foreground uppercase leading-relaxed px-1 opacity-60 text-left italic">
                                Credentials will be displayed securely within the guest portal for active sessions only.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="profile" className="mt-0 space-y-10 animate-in fade-in duration-500">
                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <Building className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Identity Management</span>
                        </div>
                        <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter">Business Profile</CardTitle>
                        <CardDescription className="text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Registry identification and public branding.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-8">
                        <div className="space-y-3 text-left">
                            <Label htmlFor="studio-name-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Studio Label</Label>
                            <Input 
                                id="studio-name-edit"
                                value={tenantData.name || ''} 
                                onChange={e => setTenantData(prev => ({...prev, name: e.target.value}))}
                                disabled={!isEditing}
                                className="h-14 rounded-2xl border-2 font-black uppercase text-xl tracking-tighter bg-white shadow-inner"
                            />
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            {/* PLACEHOLDERS FOR OTHER TABS TO MAINTAIN SYSTEM STRUCTURE */}
            {['hours', 'policies', 'builder', 'integrations'].map(t => (
                <TabsContent key={t} value={t} className="mt-0">
                    <Card className="border-4 border-dashed rounded-[3rem] opacity-30">
                        <CardContent className="py-24 flex flex-col items-center justify-center text-center">
                            <ShieldAlert className="w-12 h-12 mb-4" />
                            <h3 className="text-xl font-black uppercase tracking-widest">Module in Development</h3>
                            <p className="text-[10px] font-bold uppercase tracking-tight mt-2">The {t} suite is being optimized for touch precision.</p>
                        </CardContent>
                    </Card>
                </TabsContent>
            ))}
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
