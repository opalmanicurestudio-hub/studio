'use client';

import React, { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff, getServicePrice } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, FlaskConical, TicketIcon, MoreHorizontal, Undo2 } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface CheckoutQueueCardProps {
  appointmentData: {
    id: string;
    appointment: Appointment;
    client: Client;
    service: Service;
    addOnServices: Service[];
    staff: Staff;
  };
  isSelected: boolean;
  onSelect: () => void;
  onRevertToService: () => void;
}

export const CheckoutQueueCard: React.FC<CheckoutQueueCardProps> = ({ 
    appointmentData, 
    isSelected, 
    onSelect,
    onRevertToService
}) => {
  if (!appointmentData || !appointmentData.appointment) return null;

  const { appointment: apt, client, service, addOnServices, staff } = appointmentData;
  const checkoutState = apt.checkoutState;

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

  const totalPrice = useMemo(() => {
    const mainPrice = getServicePrice(service, staff);
    const addOnsTotal = addOnServices.reduce((acc, s) => acc + getServicePrice(s, staff), 0);
    return mainPrice + addOnsTotal;
  }, [service, addOnServices, staff]);

  const ticketId = apt.id.slice(-6).toUpperCase();

  return (
    <div className="w-72 shrink-0">
        <Label
            htmlFor={`apt-checkout-${apt.id}`}
            className={cn(
                "block cursor-pointer rounded-lg border-2 bg-card text-card-foreground transition-all relative",
                isSelected ? "border-primary ring-2 ring-primary shadow-md" : "border-border hover:border-primary/50"
            )}
        >
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                    <Checkbox
                        id={`apt-checkout-${apt.id}`}
                        checked={isSelected}
                        onCheckedChange={onSelect}
                        className="mt-1"
                    />
                    <div className="flex-1 space-y-1 min-w-0">
                        <div className="font-semibold flex items-center gap-2 truncate text-sm">
                            {client?.name || 'Walk-in'}
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
                        </div>
                        <p className="text-[10px] md:text-xs text-muted-foreground">{apt.startTime ? format(new Date(apt.startTime), 'h:mm a') : 'Now'}</p>
                        <p className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded-md w-fit flex items-center gap-1 mt-1">
                            <TicketIcon className="w-2.5 h-2.5" />
                            {ticketId}
                        </p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                         <Avatar className="w-8 h-8 border shadow-sm">
                            <AvatarImage src={staff?.avatarUrl} className="object-cover" />
                            <AvatarFallback>{staff?.name?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 -mr-2" onClick={e => e.preventDefault()}>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.preventDefault(); onRevertToService(); }}>
                                    <Undo2 className="w-4 h-4 mr-2" />
                                    Revert to In Service
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                 <div className="flex items-end justify-between pt-3 border-t">
                    <p className="text-xs text-muted-foreground truncate max-w-[150px]">{staff?.name}</p>
                    <p className="text-xl font-black text-primary tracking-tighter">${totalPrice.toFixed(2)}</p>
                </div>
            </CardContent>
        </Label>
    </div>
  );
};
