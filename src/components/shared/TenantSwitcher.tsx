'use client';

import { useTenant } from '@/context/TenantContext';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Building, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const TenantSwitcher = () => {
    const { tenants, selectedTenant, setSelectedTenant, isLoading } = useTenant();

    if (isLoading) {
        return <Skeleton className="h-10 w-full" />;
    }

    if (!selectedTenant || !tenants || tenants.length <= 1) {
        return (
            <div className="flex items-center gap-2 p-2">
                <Building className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold text-lg truncate max-w-[150px] md:max-w-none">{selectedTenant?.name || 'My Business'}</span>
            </div>
        );
    }
    
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Building className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <span className="font-semibold truncate">{selectedTenant.name}</span>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuLabel>Switch Location</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {tenants.map(tenant => (
                    <DropdownMenuItem key={tenant.id} onClick={() => setSelectedTenant(tenant)} disabled={selectedTenant.id === tenant.id}>
                       <div className="flex items-center justify-between w-full">
                         <span className={cn("mr-2", selectedTenant.id === tenant.id ? "font-bold" : "font-normal")}>
                            {tenant.name}
                        </span>
                         {selectedTenant.id === tenant.id && <Check className="h-4 w-4" />}
                       </div>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
