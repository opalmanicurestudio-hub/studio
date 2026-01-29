
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Search, DollarSign, Ticket, Award } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useInventory } from '@/context/InventoryContext';
import { AddDiscountDialog } from '@/components/discounts/AddDiscountDialog';
import { DiscountCard } from '@/components/discounts/DiscountCard';
import { type Discount } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';

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

export default function DiscountsPage() {
    const { discounts, isLoading } = useInventory();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();

    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const handleAdd = () => {
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
    
    const kpiData = useMemo(() => {
        if (!discounts || discounts.length === 0) {
        return {
            totalValue: 0,
            totalRedemptions: 0,
            mostPopularCode: 'N/A',
        };
        }

        let totalValue = 0;
        let totalRedemptions = 0;
        let mostPopularCode = 'N/A';
        let maxUsage = -1;

        discounts.forEach(discount => {
            totalRedemptions += discount.usageCount;

            if (discount.type === 'fixed') {
                totalValue += discount.value * discount.usageCount;
            }
            // Note: Percentage-based discount values are not included in this total for accuracy.
            
            if (discount.usageCount > maxUsage) {
                maxUsage = discount.usageCount;
                mostPopularCode = discount.code;
            }
        });

        return { totalValue, totalRedemptions, mostPopularCode };
    }, [discounts]);
    
    const filteredDiscounts = useMemo(() => {
        if (!discounts) return [];
        return discounts.filter(discount => 
            discount.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (discount.description || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [discounts, searchTerm]);

    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Discounts" />
            <main className="flex-1 p-4 md:p-8">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold">Discount Codes</h1>
                        <p className="text-muted-foreground mt-1">
                            Create and manage promotional codes for your services and products.
                        </p>
                    </div>
                    <Button onClick={handleAdd}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add New Discount
                    </Button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Discount Value</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">${kpiData.totalValue.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">Value of all fixed-amount discounts redeemed.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Redemptions</CardTitle>
                        <Ticket className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">{kpiData.totalRedemptions}</div>
                        <p className="text-xs text-muted-foreground">Total times any discount has been used.</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Most Popular Code</CardTitle>
                        <Award className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                        <div className="text-2xl font-bold">{kpiData.mostPopularCode}</div>
                        <p className="text-xs text-muted-foreground">The most frequently used promotion.</p>
                        </CardContent>
                    </Card>
                </div>

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
                                    <DiscountCard key={discount.id} discount={discount} onEdit={handleEdit} onDelete={handleDelete} />
                                ))}
                            </div>
                        ) : (
                            <EmptyState onAdd={handleAdd} />
                        )}
                    </CardContent>
                </Card>

                 <AddDiscountDialog
                    open={isAddDialogOpen}
                    onOpenChange={setIsAddDialogOpen}
                    onSave={handleSave}
                    discountToEdit={editingDiscount}
                />
            </main>
        </div>
    )
}
