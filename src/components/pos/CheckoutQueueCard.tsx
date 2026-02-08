

'use client';

import React, { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';

interface CheckoutQueueCardProps {
  appointment: Appointment & { 
    client?: Client, 
    service?: Service, 
    addOnServices: Service[], 
    staff?: Staff,
    groupInfo?: { name: string; id: string; } | null;
  };
  isSelected: boolean;
  onSelect: () => void;
}

export const CheckoutQueueCard: React.FC<CheckoutQueueCardProps> = ({ appointment, isSelected, onSelect }) => {
  const { client, service, addOnServices, staff, checkoutState, groupInfo } = appointment;

  if (!client || !service) {
    return null; // Or a skeleton/error state
  }

  const hasAdditionalCharges = useMemo(() => {
    if (!service || !checkoutState?.actualDuration) return false;
    const scheduledDuration = service.duration || 0;
    return checkoutState.actualDuration > scheduledDuration;
  }, [service, checkoutState]);

  const hasModifiedFormula = useMemo(() => {
    if (!service || !checkoutState?.formula) return false;
    if (!service.products) return checkoutState.formula.length > 0;
    if (service.products.length !== checkoutState.formula.length) return true;
    
    const serviceProductMap = new Map(service.products.map(p => [p.id, p.quantityUsed]));
    for (const formulaItem of checkoutState.formula) {
        if (!serviceProductMap.has(formulaItem.id) || serviceProductMap.get(formulaItem.id) !== formulaItem.quantity) {
            return true;
        }
    }
    return false;
  }, [service, checkoutState]);

  const totalPrice = (service.price || 0) + addOnServices.reduce((acc, s) => acc + s.price, 0);

  return (
    <div className="w-72 shrink-0">
        <Label
            htmlFor={`apt-checkout-${appointment.id}`}
            className={cn(
                "block cursor-pointer rounded-lg border-2 bg-card text-card-foreground transition-all",
                isSelected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
            )}
        >
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-4">
                    <Checkbox
                        id={`apt-checkout-${appointment.id}`}
                        checked={isSelected}
                        onCheckedChange={onSelect}
                        className="mt-1"
                    />
                    <div className="flex-1 space-y-1">
                        <p className="font-semibold flex items-center gap-2">
                            {client.name}
                            {groupInfo && (
                                <Badge variant="destructive" className="text-xs">
                                    {groupInfo.name}
                                </Badge>
                            )}
                            <TooltipProvider>
                                {hasAdditionalCharges && (
                                    <Tooltip>
                                        <TooltipTrigger><AlertTriangle className="h-4 w-4 text-orange-500" /></TooltipTrigger>
                                        <TooltipContent><p>Additional time charges may apply.</p></TooltipContent>
                                    </Tooltip>
                                )}
                                {hasModifiedFormula && (
                                    <Tooltip>
                                        <TooltipTrigger><FlaskConical className="h-4 w-4 text-blue-500" /></TooltipTrigger>
                                        <TooltipContent><p>Product formula was modified.</p></TooltipContent>
                                    </Tooltip>
                                )}
                            </TooltipProvider>
                        </p>
                        <p className="text-sm text-muted-foreground">{format(new Date(appointment.startTime), 'h:mm a')}</p>
                    </div>
                    <div className="text-right">
                         <Avatar className="w-8 h-8">
                            <AvatarImage src={staff?.avatarUrl} />
                            <AvatarFallback>{staff?.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                    </div>
                </div>
                 <div className="flex items-end justify-between pt-3 border-t">
                    <p className="text-xs text-muted-foreground">{staff?.name}</p>
                    <p className="text-xl font-bold text-primary">${totalPrice.toFixed(2)}</p>
                </div>
            </CardContent>
        </Label>
    </div>
  );
};
