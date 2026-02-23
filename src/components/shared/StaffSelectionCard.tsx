
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { type Staff, type PricingTier } from '@/lib/data';
import { Users } from 'lucide-react';

export const StaffSelectionCard = ({ staff, pricingTiers }: { staff: Staff | { id: string, name: string, avatarUrl: string }, pricingTiers: PricingTier[] }) => {
    const isAnyStaff = staff.id === 'any';
    const tier = !isAnyStaff ? pricingTiers.find(t => t.id === (staff as Staff).pricingTierId) : null;

    return (
        <div>
            <RadioGroupItem value={staff.id} id={`staff-select-card-${staff.id}`} className="peer sr-only" />
            <Label
                htmlFor={`staff-select-card-${staff.id}`}
                className="block cursor-pointer rounded-lg border-2 border-muted bg-popover p-4 transition-all hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:ring-2 peer-data-[state=checked]:ring-primary h-full"
            >
                <div className="flex flex-col items-center justify-between gap-3 h-full">
                    <Avatar className="w-16 h-16">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} alt={staff.name}/> : null}
                        <AvatarFallback className="text-muted-foreground">
                            {isAnyStaff ? <Users className="w-8 h-8"/> : staff.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="text-center">
                        <p className="font-semibold text-sm">{staff.name}</p>
                        {tier && <Badge variant="outline" className="capitalize text-xs">{tier.name}</Badge>}
                    </div>
                </div>
            </Label>
        </div>
    );
};
