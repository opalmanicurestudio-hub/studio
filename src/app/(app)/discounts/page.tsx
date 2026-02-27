
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Search, DollarSign, Percent, Repeat, BarChart, Star, TicketIcon, Gift, Save, Edit, MoreHorizontal, UserPlus } from 'lucide-react';
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

const EmptyState = ({ onAdd }: { onAdd: () => void }) => (
    <div className="text-center py-20 px-6 border-2 border-dashed rounded-lg">
        <h3 className="text-2xl font-semibold">Create Your First Discount</h3>
        <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-6">
            Offer special deals to attract new clients or reward your loyal customers.
        </p>
        <Button onClick={onAdd}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add New Discount
        </Button>
    </div>
);

const AutomationCard = ({ icon, title, description, onSetup }: { icon: React.ReactNode, title: string, description: string, onSetup: () => void }) => (
    <Card>
        <CardHeader>
            <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">{icon}</div>
                <CardTitle>{title}</CardTitle>
            </div>
        </CardHeader>
        <CardContent>
            <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
        <CardFooter>
            <Button className="w-full" onClick={onSetup}>Set Up</Button>
        </CardFooter>
    </Card>
);

const ActiveAutomationCard = ({ discount, onEdit, onDelete }: { discount: Discount, onEdit: (discount: Discount) => void, onDelete: (discountId: string) => void }) => {
    const triggerText = {
        loyalty: `Triggers after ${discount.automation?.appointmentThreshold || 'N/A'} visits.`,
        re_engagement: `Triggers after ${discount.automation?.daysSinceLastVisit || 'N/A'} days of inactivity.`,
        birthday: "Triggers during a client's birthday month.",
        new_client: "Triggers for a new client's first visit.",
        none: ""
    };
    
    const Icon = {
        loyalty: Star,
        re_engagement: Repeat,
        birthday: Gift,
        new_client: UserPlus,
        none: Star // Default icon
    }[discount.automation?.trigger || 'none'];

    const title = {
         loyalty: 'Loyalty Program',
        re_engagement: 'Re-engagement Offer',
        birthday: 'Birthday Special',
        new_client: 'New Client Offer',
        none: 'Automated Discount'
    }[discount.automation?.trigger || 'none'];

    return (
        <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className="p-3 bg-primary/10 rounded-lg">
                           <Icon className="w-6 h-6 text-primary" />
                        </div>
                        <CardTitle>{title}</CardTitle>
                    </div>
                    <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4"/></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => onEdit(discount)}><Edit className="mr-2 h-4 w-4"/>Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(discount.id)}><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="font-semibold text-lg text-primary">
                    {discount.type === 'percentage' ? `${discount.value}% Off` : `$${discount.value.toFixed(2)} Off`}
                </p>
                <p className="text-sm text-muted-foreground">{triggerText[discount.automation?.trigger || 'none']}</p>
                <p className="text-xs text-muted-foreground pt-2 border-t">Associated code: <Badge variant="outline">{discount.code}</Badge></p>
            </CardContent>
        </Card>
    );
}

export default function DiscountsPage() {
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
            // Update existing discount
            const discountRef = doc(firestore, 'tenants', tenantId, 'discounts', editingDiscount.id);
            updateDocumentNonBlocking(discountRef, data);
            toast({ title: 'Discount Updated' });
        } else {
            // Create new discount
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
            kpiData: { grossSales: 0, netSales: 0, discountsApplied: 0, promoEffectiveness: 0, mostPopularCode: 'N/A', totalRedemptions: 0 },
            savingsByCode: {} as Record<string, number>
          };
        }

        const incomeTransactions = transactions.filter(
          (t) => t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail' || t.category === 'Membership/Package Sales')
        );
    
        const discountTransactions = transactions.filter(t => t.type === 'expense' && t.category === 'Discounts');
        
        // Accurate total redemptions by summing usageCount from all discount docs
        const totalRedemptions = (discounts || []).reduce((sum, d) => sum + (d.usageCount || 0), 0);

        const netSales = incomeTransactions.reduce((acc, t) => acc + t.amount, 0);
        const discountsApplied = discountTransactions.reduce((acc, t) => acc + t.amount, 0);
        const grossSales = netSales + discountsApplied;
    
        // Calculate savings per code by parsing the discount transactions
        const codeSavings: Record<string, number> = {};
        const codeCounts: Record<string, number> = {};

        discountTransactions.forEach(t => {
            if (t.appliedDiscountCode) {
                const codes = t.appliedDiscountCode.split(',').map(c => c.trim());
                // Split the expense amount proportionally among codes used in that transaction
                const perCodeAmount = t.amount / codes.length;
                codes.forEach(c => {
                    if (c) {
                        codeSavings[c] = (codeSavings[c] || 0) + perCodeAmount;
                        codeCounts[c] = (codeCounts[c] || 0) + 1;
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
    
            if (hasSubsequentAppointment) {
                retainedClients++;
            }
        });
    
        const promoEffectiveness = uniqueDiscountedClientIds.size > 0 
          ? (retainedClients / uniqueDiscountedClientIds.size) * 100 
          : 0;
    
        const mostPopularCode = Object.keys(codeCounts).length > 0 
            ? Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0]
            : 'N/A';
    
        return {
          kpiData: {
            grossSales,
            netSales,
            discountsApplied,
            promoEffectiveness,
            mostPopularCode,
            totalRedemptions,
          },
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
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Discounts & Automations" />
            <main className="flex-1 p-4 md:p-8">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold">Discounts & Automations</h1>
                        <p className="text-muted-foreground mt-1">
                            Create promotional codes and set up automated marketing triggers.
                        </p>
                    </div>
                     <Button onClick={handleAdd}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add New Discount
                    </Button>
                </div>
                
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Gross Sales</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">${kpiData.grossSales.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">Revenue from discounted sales, before discount.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Discounts Applied</CardTitle>
                        <Percent className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold text-destructive">-${kpiData.discountsApplied.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">Total value of all discounts given.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Net Sales</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold text-primary">${kpiData.netSales.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">Actual revenue from discounted sales.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Redemptions</CardTitle>
                        <TicketIcon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">{kpiData.totalRedemptions}</div>
                        <p className="text-xs text-muted-foreground">Sum of usage counts from all active codes.</p>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Most Popular Code</CardTitle>
                        <Star className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">{kpiData.mostPopularCode}</div>
                        <p className="text-xs text-muted-foreground">The most frequently used code.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Promo Retention</CardTitle>
                        <Repeat className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">{kpiData.promoEffectiveness.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">% of discounted clients who returned.</p>
                        </CardContent>
                    </Card>
                </div>
                
                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList>
                        <TabsTrigger value="codes">Discount Codes</TabsTrigger>
                        <TabsTrigger value="automations">Automations</TabsTrigger>
                        <TabsTrigger value="referrals">Referrals</TabsTrigger>
                    </TabsList>
                    <TabsContent value="codes" className="mt-6">
                        <Card>
                            <CardHeader>
                                 <div className="relative w-full max-w-sm">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input 
                                        placeholder="Search by code or description..." 
                                        className="pl-9"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent>
                                {isLoading ? (
                                    <p>Loading...</p>
                                ) : filteredDiscounts.length > 0 ? (
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                                    <EmptyState onAdd={handleAdd} />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="automations" className="mt-6">
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {loyaltyAutomation ? (
                                <ActiveAutomationCard discount={loyaltyAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={<Star className="w-6 h-6 text-primary" />}
                                    title="Loyalty Program"
                                    description="Automatically reward clients after they complete a certain number of appointments."
                                    onSetup={() => handleSetupAutomation('loyalty')}
                                />
                            )}
                            {reEngagementAutomation ? (
                                <ActiveAutomationCard discount={reEngagementAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={<Repeat className="w-6 h-6 text-primary" />}
                                    title="Re-engagement"
                                    description="Win back clients who haven't visited in a while with a special offer."
                                    onSetup={() => handleSetupAutomation('re_engagement')}
                                />
                            )}
                            {birthdayAutomation ? (
                                <ActiveAutomationCard discount={birthdayAutomation} onEdit={handleEdit} onDelete={handleDelete} />
                            ) : (
                                <AutomationCard 
                                    icon={<Gift className="w-6 h-6 text-primary" />}
                                    title="Birthday Special"
                                    description="Delight clients by automatically sending them a birthday gift or discount."
                                    onSetup={() => handleSetupAutomation('birthday')}
                                />
                            )}
                        </div>
                    </TabsContent>
                     <TabsContent value="referrals" className="mt-6">
                        <Card>
                            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Gift className="w-5 h-5 text-primary" />
                                        Referral Program Settings
                                    </CardTitle>
                                    <CardDescription>Configure rewards for client referrals.</CardDescription>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                                {isReferralEditing ? (
                                    <>
                                        <Button variant="outline" onClick={handleReferralCancel} className="flex-1 sm:w-auto">Cancel</Button>
                                        <Button onClick={handleReferralSave} className="flex-1 sm:w-auto"><Save className="mr-2 h-4 w-4" />Save</Button>
                                    </>
                                ) : (
                                    <Button onClick={handleReferralEdit} className="w-full sm:w-auto"><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                                )}
                                </div>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="referrer-reward">Referrer Reward</Label>
                                    <p className="text-xs text-muted-foreground">Store credit given to the existing client for a successful referral.</p>
                                    <div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="referrer-reward" type="number" value={tenantData.referrerReward?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, referrerReward: Number(e.target.value)}))} placeholder="10.00" className="pl-8" disabled={!isReferralEditing}/></div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-client-discount">New Client Discount</Label>
                                    <p className="text-xs text-muted-foreground">Discount on first service for the new client who was referred.</p>
                                    <div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="new-client-discount" type="number" value={tenantData.newClientDiscount?.toString() || ''} onChange={(e) => setTenantData(prev => ({...prev, newClientDiscount: Number(e.target.value)}))} placeholder="15.00" className="pl-8" disabled={!isReferralEditing}/></div>
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
