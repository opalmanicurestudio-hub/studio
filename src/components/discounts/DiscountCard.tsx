'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MoreHorizontal, Percent, Tag, Trash2, Edit, Users, AlertTriangle, Wand, TrendingDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Discount } from '@/lib/data';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiscountCardProps {
  discount: Discount;
  onEdit: (discount: Discount) => void;
  onDelete: (discountId: string) => void;
  totalSavings?: number;
}

export const DiscountCard: React.FC<DiscountCardProps> = ({ discount, onEdit, onDelete, totalSavings = 0 }) => {
  const usagePercentage = discount.usageLimit > 0 ? (discount.usageCount / discount.usageLimit) * 100 : 0;
  const isUnlimited = discount.usageLimit === 0;

  const potentialLoss =
    discount.type === 'fixed' && discount.usageLimit > 0
      ? discount.value * discount.usageLimit
      : null;

  const automationTooltipText = useMemo(() => {
    if (!discount.automation || discount.automation.trigger === 'none') {
      return null;
    }
    switch (discount.automation.trigger) {
      case 'new_client':
        return "Triggers for new clients.";
      case 'loyalty':
        return `Triggers after ${discount.automation.appointmentThreshold || 'X'} appointments.`;
      case 're_engagement':
        return `Triggers after ${discount.automation.daysSinceLastVisit || 'X'} days of inactivity.`;
      case 'birthday':
        return "Triggers during client's birthday month.";
      default:
        return "Automated discount.";
    }
  }, [discount.automation]);

  return (
    <Card className={cn("flex flex-col", !discount.isActive && "opacity-70 grayscale-[0.5]")}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              {discount.code}
            </CardTitle>
            <CardDescription className="line-clamp-1">{discount.description || 'No description'}</CardDescription>
          </div>
           <div className="flex items-center gap-2">
                {automationTooltipText && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Wand className="h-4 w-4 text-purple-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{automationTooltipText}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 -mt-2 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onEdit(discount)}><Edit className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => onDelete(discount.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
           </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1">
        <div className="flex justify-between items-center bg-muted/50 p-3 rounded-lg">
          <span className="font-bold text-lg">
            {discount.type === 'percentage' ? `${discount.value}% Off` : `$${discount.value.toFixed(2)} Off`}
          </span>
          <div className="flex items-center gap-2">
            {discount.limitOnePerCustomer && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger><Users className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent><p>Limit one per customer</p></TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
            <Badge variant={discount.isActive ? 'default' : 'secondary'}>{discount.isActive ? 'Active' : 'Inactive'}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
            <div className="p-2 rounded-lg bg-primary/5 border border-primary/10">
                <p className="text-[10px] uppercase font-black text-muted-foreground tracking-widest mb-1">Total Savings</p>
                <p className="text-lg font-black text-primary">${totalSavings.toFixed(2)}</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50 border">
                <p className="text-[10px] uppercase font-black text-muted-foreground tracking-widest mb-1">Redemptions</p>
                <p className="text-lg font-black">{discount.usageCount}</p>
            </div>
        </div>

        {discount.applicableServiceIds && discount.applicableServiceIds.length > 0 && (
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Applies to {discount.applicableServiceIds.length} restricted services</p>
        )}

        {!isUnlimited && (
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase text-muted-foreground">
                    <span>Usage Progress</span>
                    <span>{discount.usageCount} / {discount.usageLimit}</span>
                </div>
                <Progress value={usagePercentage} className="h-1.5" />
            </div>
        )}
      </CardContent>
      {potentialLoss !== null && (
          <CardFooter className="p-3 pt-0 flex items-center gap-2 text-[10px] text-muted-foreground uppercase font-bold">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span>Max Exposure Risk:</span>
            <span className="text-destructive">-${potentialLoss.toFixed(2)}</span>
          </CardFooter>
        )}
    </Card>
  );
};
