
'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    PlusCircle, 
    Search, 
    DollarSign, 
    Percent, 
    Repeat, 
    BarChart, 
    Star, 
    TicketIcon, 
    Gift, 
    Save, 
    Edit, 
    MoreHorizontal, 
    UserPlus, 
    TrendingUp, 
    Trash2,
    Wand2,
    Activity,
    SlidersHorizontal,
    Target,
    Filter,
    Loader,
    Box
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useInventory } from '@/context/InventoryContext';
import { AddDiscountDialog } from '@/components/discounts/AddDiscountDialog';
import { DiscountCard } from '@/components/discounts/DiscountCard';
import { type Discount, type Tenant } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const KpiCard = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-w-0 text-left bg-white/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-4 pb-1 md:pb-2">
            <CardTitle className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 truncate mr-1">
                {title}
            </CardTitle>
            <Icon className={cn("h-3 w-3 md:h-3.5 md:w-3.5 opacity-40", colorClass || "text-slate-900")} />
        </CardHeader>
        <CardContent className="p-3 md:p-4 pt-0">
            <div className={cn("text-lg md:text-3xl font-black tracking-tighter font-mono", colorClass || "text-slate-900")}>
                {value}
            </div>
            <p className="text-[8px] md:text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-40 truncate">{description}</p>
        </CardContent>
    </Card>
);

const AutomationCard = ({ icon: Icon, title, description, onSetup }: { icon: any, title: string, description: string, onSetup: () => void }) => (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden group h-full flex flex-col bg-white">
        <CardHeader className="p-6 md:p-8 flex-1 text-left">
            <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-4">
                <div className="p-5 rounded-2xl bg-primary/5 border-2 border-primary/10 shadow-inner group-hover:bg-primary transition-all duration-500">
                    <Icon className="w-8 h-8 text-primary group-hover:text-white transition-colors" />
                </div>
                <div className="space-y-1">
                    <CardTitle className="text-lg font-black uppercase tracking-tight text-slate-900">{title}</CardTitle>
                    <CardDescription className="text-xs font-medium text-slate-500 leading-relaxed uppercase tracking-tight">{description}</CardDescription>
                </div>
            </div>
        </CardHeader>
        <CardFooter className="p-4 bg-muted/5 border-t">
            <Button className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg" onClick={onSetup}>
                Initialize Logic
            </Button>
        </CardFooter>
    </Card>
);

const ActiveAutomationCard = ({ discount, onEdit, onDelete }: { discount: Discount, onEdit: (discount: Discount) => void, onDelete: (discountId: string) => void }) => {
    const triggerText = {
        loyalty: `Triggers after ${discount.automation?.appointmentThreshold || 'N/A'} visits.`,
        re_engagement: `Triggers after ${discount.automation?.daysSinceLastVisit || 'N/A'} days away.`,
        birthday: "Triggers during birthday month.",
        new_client: "Triggers for first visit.",
        none: ""
    };
    
    const Icon = {
        loyalty: Star,
        re_engagement: Repeat,
        birthday: Gift,
        new_client: UserPlus,
        none: Target
    }[discount.automation?.trigger || 'none'];

    const title = {
        loyalty: 'Loyalty Protocol',
        re_engagement: 'Win-Back Logic',
        birthday: 'Birthday Special',
        new_client: 'Welcome Reward',
        none: 'Automated Logic'
    }[discount.automation?.trigger || 'none'];

    return (
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2rem] overflow-hidden shadow-2xl shadow-primary/5 flex flex-col h-full">
            <CardHeader className="p-6 md:p-8">
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-2xl shadow-inner border border-primary/10">
                           <Icon className="w-6 h-6 text-primary" />
                        </div>
                        <div className="text-left min-w-0">
                            <CardTitle className="text-sm md:text-lg font-black uppercase tracking-tight text-slate-900 truncate">{title}</CardTitle>
                            <p className="text-[10px] font-black text-primary/60 uppercase tracking-widest leading-none mt-1">Status: Active</p>
                        </div>
                    </div>
                    <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10"><MoreHorizontal className="h-4 w-4 text-primary"/></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                            <DropdownMenuItem onClick={() => onEdit(discount)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Edit className="mr-2 h-3.5 w-3.5 opacity-40"/>Modify</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5" onClick={() => onDelete(discount.id)}><Trash2 className="mr-2 h-3.5 w-3.5 opacity-40"/>Terminate</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="px-6 md:px-8 pb-6 flex-1 text-left space-y-4">
                <div className="p-5 rounded-2xl bg-white border-2 border-primary/10 shadow-inner text-center">
                    <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.2em]">Incentive Yield</p>
                    <p className="text-3xl font-black text-primary tracking-tighter font-mono">
                        {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value.toFixed(2)}`}<span className="text-xs ml-1 uppercase">Off</span>
                    </p>
                </div>
                <p className="text-[10px] font-bold text-slate-600 uppercase leading-relaxed tracking-tight text-center">{triggerText[discount.automation?.trigger || 'none']}</p>
            </CardContent>
            <CardFooter className="p-4 border-t border-primary/10 bg-primary/[0.02] mt-auto">
                <div className="flex justify-between items-center w-full px-1">
                    <span className="text-[9px] font-black uppercase text-primary/40 tracking-widest">Protocol Code</span>
                    <Badge variant="secondary" className="bg-white border-2 border-primary/10 text-primary font-mono font-black text-[10px] h-6 px-3">{discount.code}</Badge>
                </div>
            </CardFooter>
        </Card>
    );
}

function DiscountsContent() {
    const { discounts, isLoading, transactions, appointments } = useInventory();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();

    const defaultTab = searchParams.get('tab') || 'codes';

    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [initialAutomationTrigger, setInitialAutomationTrigger] = useState<'none' | 'new_client' | 'loyalty' | 're_engagement' | 'birthday'>('none');
    
    const [isReferralEditing, setIsReferralEditing] = useState(false);
    const [tenantData, setTenantData] = useState<Partial<Tenant>>(selectedTenant || {});
    const [backupTenantData, setBackupTenantData] = useState<Partial<Tenant>>({});
    
    const loyaltyAutomation = useMemo(() => discounts?.find(d => d.automation?.trigger === 'loyalty'), [discounts]);
    const reEngagementAutomation = useMemo(() => discounts?.find(d => d.automation?.trigger === 're_engagement'), [discounts]);
    const birthdayAutomation = useMemo(() => discounts?.find(d => d.automation?.trigger === 'birthday'), [discounts]);

    useEffect(() => {
      if (selectedTenant) {
        setTenantData(selectedTenant);
      }
    }, [selectedTenant]);
    
    const handleReferralEdit = () => {
        setBackupTenantData(tenantData);
        setIsReferralEditing(true);
    };

    const handleReferralCancel = () => {
        setTenantData(backupTenantData);
        setIsReferralEditing(false);
    };

    const handleReferralSave = async () => {
        if (!selectedTenant || !firestore) return;
        const referralFields: (keyof Tenant)[] = ['referrerReward', 'newClientDiscount'];
        const dataToUpdate: Partial<Tenant> = {};
        referralFields.forEach(field => {
            dataToUpdate[field] = tenantData[field] as any;
        });

        try {
            const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
            await updateDocumentNonBlocking(tenantRef, dataToUpdate);
            toast({ title: 'Referral Settings Saved!' });
            setIsReferralEditing(false);
        } catch (error) {
            console.error("Save error:", error);
            toast({ variant: 'destructive', title: 'Save Failed' });
        }
    };


    const handleTabChange = (value: string) => {
        setActiveTab(value);
        router.push(`/discounts?tab=${value}`, { scroll: false });
    };

    const handleAdd = () => {
        setEditingDiscount(null);
        setIsAddDialogOpen(true);
    };
    
    const handleSetupAutomation = (trigger: 'loyalty' | 're_engagement' | 'birthday') => {
        setInitialAutomationTrigger(trigger);
        setEditingDiscount(null);
        setIsAddDialogOpen(true);
    };

    const handleEdit = (discount: Discount) => {
        setEditingDiscount(discount);
        setIsAddDialogOpen(true);
    };

    const handleDelete = (discountId: string) => {
        if (!firestore || !tenantId) return;
        const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', discountId);
        deleteDocumentNonBlocking(discountRef);
        toast({
            title: 'Discount Deleted',
            description: 'The discount code has been removed.',
        });
    };

    const handleSave = (data: Partial<Discount>) => {
        if (!firestore || !tenantId) return;
        if (editingDiscount) {
            const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', editingDiscount.id);
            updateDocumentNonBlocking(discountRef, data);
            toast({ title: 'Discount Updated' });
        } else {
            const newDiscount = {
                ...data,
                id: nanoid(),
                usageCount: 0,
            } as Discount;
            const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', newDiscount.id);
            setDocumentNonBlocking(discountRef, newDiscount, {});
            toast({ title: 'Discount Created' });
        }
    };
    
    const { kpiData, savingsByCode } = useMemo(() => {
        if (!transactions || !discounts || !appointments) {
          return {
            kpiData: { totalGrossDiscountsValue: 0, promoRetentionRate: 0, mostPopularCode: 'N/A', totalRedemptions: 0 },
            savingsByCode: {} as Record<string, number>
          };
        }

        const discountTransactions = transactions.filter(t => t.type === 'expense' && t.category === 'Discounts');
        const totalRedemptions = (discounts || []).reduce((sum, d) => sum + (d.usageCount || 0), 0);
        const totalDiscountsValue = discountTransactions.reduce((acc, t) => acc + t.amount, 0);
    
        const codeSavings: Record<string, number> = {};
        const codeCounts: Record<string, number> = {};

        discountTransactions.forEach(t => {
            if (t.appliedDiscountCode) {
                const codes = t.appliedDiscountCode.split(',').map(c => c.trim());
                const perCodeAmount = t.amount / (codes.length || 1);
                codes.forEach(c => {
                    if (c) {
                        const upperC = c.toUpperCase();
                        codeSavings[upperC] = (codeSavings[upperC] || 0) + perCodeAmount;
                        codeCounts[upperC] = (codeCounts[upperC] || 0) + 1;
                    }
                });
            }
        });

        const uniqueDiscountedClientIds = new Set(discountTransactions.map(t => t.clientId).filter((id): id is string => !!id));
        
        let retainedClients = 0;
        uniqueDiscountedClientIds.forEach(clientId => {
            const clientDiscountTransactions = discountTransactions.filter(t => t.clientId === clientId);
            if (clientDiscountTransactions.length === 0) return;
            const lastDiscountedTx = clientDiscountTransactions.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
            const hasSubsequentAppointment = appointments.some(apt => 
                apt.clientId === clientId && 
                new Date(apt.startTime) > new Date(lastDiscountedTx.date)
            );
            if (hasSubsequentAppointment) retainedClients++;
        });
    
        const promoRetentionRate = uniqueDiscountedClientIds.size > 0 
          ? (retainedClients / uniqueDiscountedClientIds.size) * 100 
          : 0;
    
        const mostPopularCode = Object.keys(codeCounts).length > 0 
            ? Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0]
            : 'N/A';
    
        return {
          kpiData: { totalGrossDiscountsValue: totalDiscountsValue, promoRetentionRate, mostPopularCode, totalRedemptions },
          savingsByCode: codeSavings
        };
      }, [transactions, discounts, appointments]);
    
    const filteredDiscounts = useMemo(() => {
        if (!discounts) return [];
        return discounts.filter(discount => 
            discount.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (discount.description || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [discounts, searchTerm]);

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
            <AppHeader title="Incentive Hub" />
            <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
                    <div className="space-y-1">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Incentives</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
                            Retention matrix & logic control
                        </p>
                    </div>
                     <Button onClick={handleAdd} className="h-12 md:h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
                        <PlusCircle className="mr-2 h-4 w-4" /> New Protocol
                    </Button>
                </div>
                
                 <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6">
                    <KpiCard title="Total Redemptions" value={kpiData.totalRedemptions.toString()} icon={TicketIcon} description="Across all campaigns" />
                    <KpiCard title="Marketing Expense" value={`-$${kpiData.totalGrossDiscountsValue.toFixed(0)}`} icon={Percent} description="Total direct savings" colorClass="text-destructive" />
                    <KpiCard title="Promo Retention" value={`${kpiData.promoRetentionRate.toFixed(1)}%`} icon={Repeat} description="Repeat rate %" colorClass="text-teal-600" />
                    <KpiCard title="Dominant Script" value={kpiData.mostPopularCode} icon={Star} description="Top performing" colorClass="text-primary" />
                </div>
                
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <ScrollArea className="w-full">
                        <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 w-max mx-auto sm:mx-0">
                            <TabsTrigger value="codes" className="px-6 sm:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Script Ledger</TabsTrigger>
                            <TabsTrigger value="automations" className="px-6 sm:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Logic Flows</TabsTrigger>
                            <TabsTrigger value="referrals" className="px-6 sm:px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Referral Engine</TabsTrigger>
                        </TabsList>
                        <ScrollBar orientation="horizontal" className="hidden" />
                    </ScrollArea>
                    
                    <TabsContent value="codes" className="mt-0">
                        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                            <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-6 text-left">
                                <div className="space-y-1">
                                    <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Campaign Manifest</CardTitle>
                                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Manually triggered promotion codes.</CardDescription>
                                </div>
                                <div className="relative w-full max-w-sm">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                    <Input 
                                        placeholder="SEARCH SCRIPTS..." 
                                        className="pl-12 h-12 rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 md:p-8">
                                {isLoading ? (
                                    <div className="flex flex-col items-center justify-center p-24 gap-4">
                                        <Loader className="animate-spin h-8 w-8 text-primary" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Archives...</p>
                                    </div>
                                ) : filteredDiscounts.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {filteredDiscounts.map(discount => (
                                            <DiscountCard 
                                                key={discount.id} 
                                                discount={discount} 
                                                onEdit={handleEdit} 
                                                onDelete={handleDelete}
                                                totalSavings={savingsByCode[discount.code.toUpperCase()] || 0}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                                        <Filter className="w-16 h-16" />
                                        <p className="text-sm font-black uppercase tracking-widest">No Scripts Found</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="automations" className="mt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {loyaltyAutomation ? (
                                <ActiveAutomationCard discount={loyaltyAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={Star}
                                    title="Loyalty Protocol"
                                    description="Automatically reward guests after they complete a specified session volume."
                                    onSetup={() => handleSetupAutomation('loyalty')}
                                />
                            )}
                            {reEngagementAutomation ? (
                                <ActiveAutomationCard discount={reEngagementAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={Repeat}
                                    title="Win-Back Flow"
                                    description="Re-acquire guests who haven't visited in a target window with a specialized offer."
                                    onSetup={() => handleSetupAutomation('re_engagement')}
                                />
                            )}
                            {birthdayAutomation ? (
                                <ActiveAutomationCard discount={birthdayAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={Gift}
                                    title="Birthday Special"
                                    description="Automatically dispatch a celebration script during a guest's birthday month."
                                    onSetup={() => handleSetupAutomation('birthday')}
                                />
                            )}
                        </div>
                    </TabsContent>

                     <TabsContent value="referrals" className="mt-0">
                        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                            <CardHeader className="bg-muted/5 border-b p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
                                <div className="space-y-1">
                                    <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight flex items-center gap-3">
                                        <Gift className="w-5 h-5 text-primary" />
                                        Viral Yield Engine
                                    </CardTitle>
                                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Configure rewards for verified client referrals.</CardDescription>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0 w-full sm:w-auto">
                                {isReferralEditing ? (
                                    <>
                                        <Button variant="ghost" onClick={handleReferralCancel} className="flex-1 sm:w-auto h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                                        <Button onClick={handleReferralSave} className="flex-1 sm:w-auto h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"><Save className="mr-2 h-4 w-4" />Save Protocol</Button>
                                    </>
                                ) : (
                                    <Button onClick={handleReferralEdit} className="w-full sm:w-auto h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"><Edit className="mr-2 h-4 w-4"/>Edit Architecture</Button>
                                )}
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-10 text-left">
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <Label htmlFor="referrer-reward" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Referrer Incentive</Label>
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed mb-3">Store credit assigned to the advocate upon successful conversion.</p>
                                    </div>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                        <Input id="referrer-reward" type="number" value={tenantData.referrerReward?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, referrerReward: Number(e.target.value)}))} placeholder="10.00" className="pl-12 h-14 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner bg-muted/5" disabled={!isReferralEditing}/>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <Label htmlFor="new-client-discount" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Acquisition Incentive</Label>
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed mb-3">One-time discount assigned to the new guest for their first treatment.</p>
                                    </div>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                        <Input id="new-client-discount" type="number" value={tenantData.newClientDiscount?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, newClientDiscount: Number(e.target.value)}))} placeholder="15.00" className="pl-12 h-14 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner bg-muted/5" disabled={!isReferralEditing}/>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
                 <AddDiscountDialog
                    open={isAddDialogOpen}
                    onOpenChange={(isOpen) => {
                        setIsAddDialogOpen(isOpen);
                        if (!isOpen) {
                            setInitialAutomationTrigger('none');
                        }
                    }}
                    onSave={handleSave}
                    discountToEdit={editingDiscount}
                    initialTrigger={initialAutomationTrigger}
                />
            </main>
        </div>
    )
}

export default function DiscountsPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen w-full flex-col bg-slate-50/50 justify-center items-center"><Loader className="animate-spin text-primary h-8 w-8" /></div>}>
            <DiscountsContent />
        </Suspense>
    );
}
