

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MoreHorizontal, Percent, Tag, Trash2, Edit, Users, AlertTriangle, Wand } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Discount } from '@/lib/data';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useMemo } from 'react';

interface DiscountCardProps {
  discount: Discount;
  onEdit: (discount: Discount) => void;
  onDelete: (discountId: string) => void;
}

export const DiscountCard: React.FC<DiscountCardProps> = ({ discount, onEdit, onDelete }) => {
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
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              {discount.code}
            </CardTitle>
            <CardDescription>{discount.description || 'No description'}</CardDescription>
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
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center bg-muted/50 p-3 rounded-lg">
          <span className="font-semibold text-lg">
            {discount.type === 'percentage' ? `${discount.value}% Off` : `$${discount.value.toFixed(2)} Off`}
          </span>
          <div className="flex items-center gap-2">
            {discount.limitOnePerCustomer && <Badge variant="outline"><Users className="w-3 h-3 mr-1"/>1/Customer</Badge>}
            <Badge variant={discount.isActive ? 'default' : 'secondary'}>{discount.isActive ? 'Active' : 'Inactive'}</Badge>
          </div>
        </div>
        {discount.applicableServiceIds && discount.applicableServiceIds.length > 0 && (
          <Badge variant="outline">Applies to {discount.applicableServiceIds.length} service(s)</Badge>
        )}
        <div>
          <div className="flex justify-between text-xs mb-1 text-muted-foreground">
            <span>Usage</span>
            <span>
              {discount.usageCount} / {isUnlimited ? '∞' : discount.usageLimit}
            </span>
          </div>
          <Progress value={isUnlimited ? 0 : usagePercentage} />
        </div>
         {potentialLoss !== null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span>Potential Loss:</span>
            <span className="font-semibold text-destructive">${potentialLoss.toFixed(2)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
