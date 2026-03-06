'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { type Staff, type PricingTier } from '@/lib/data';
import { Users, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const StaffSelectionCard = ({ 
    staff, 
    pricingTiers, 
    isSelected = false, 
    disabled = false 
}: { 
    staff: Staff | { id: string, name: string, avatarUrl: string }, 
    pricingTiers: PricingTier[],
    isSelected?: boolean,
    disabled?: boolean
}) => {
    const isAnyStaff = staff.id === 'any';
    const tier = !isAnyStaff ? pricingTiers.find(t => t.id === (staff as Staff).pricingTierId) : null;

    return (
        <div className="h-full">
            <RadioGroupItem value={staff.id} id={`staff-select-card-${staff.id}`} className="peer sr-only" disabled={disabled} />
            <Label
                htmlFor={`staff-select-card-${staff.id}`}
                className={cn(
                    "relative block h-full cursor-pointer rounded-2xl border-2 transition-all duration-300 overflow-hidden",
                    disabled ? "opacity-40 grayscale-[0.5] cursor-not-allowed border-dashed" : "hover:shadow-2xl hover:border-primary/50",
                    "peer-data-[state=checked]:border-primary peer-data-[state=checked]:ring-4 peer-data-[state=checked]:ring-primary/10 peer-data-[state=checked]:bg-primary/[0.02] peer-data-[state=checked]:shadow-xl"
                )}
            >
                <div className="flex flex-col items-center justify-between gap-4 p-5 h-full">
                    <div className="relative">
                        <Avatar className={cn(
                            "w-16 h-16 md:w-20 md:h-20 border-4 transition-all duration-500",
                            "peer-data-[state=checked]:border-primary peer-data-[state=checked]:scale-110",
                            !isSelected && "border-background"
                        )}>
                            {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} alt={staff.name} className="object-cover" /> : null}
                            <AvatarFallback className="text-muted-foreground bg-muted">
                                {isAnyStaff ? <Users className="w-8 h-8 md:w-10 md:h-10"/> : staff.name.charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                        
                        <div className={cn(
                            "absolute -top-1 -right-1 bg-primary text-white rounded-full p-1 shadow-lg transition-all scale-0",
                            "peer-data-[state=checked]:scale-100"
                        )}>
                            <Check className="w-3 h-3 md:w-4 md:h-4" strokeWidth={4} />
                        </div>
                    </div>

                    <div className="text-center space-y-1.5 flex-1 flex flex-col justify-center">
                        <p className="font-black uppercase tracking-tight text-[10px] md:text-xs leading-none">
                            {staff.name}
                        </p>
                        {tier && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[8px] md:text-[9px] font-black uppercase tracking-widest border-primary/20 text-primary">
                                {tier.name}
                            </Badge>
                        )}
                        {isAnyStaff && (
                            <p className="text-[8px] md:text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                                Smart Rotation
                            </p>
                        )}
                    </div>
                </div>
            </Label>
        </div>
    );
};
