
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MoreHorizontal, Percent, Tag, Trash2, Edit, Users, AlertTriangle, Wand2, TrendingDown, Clock, Activity, Target } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Discount } from '@/lib/data';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';

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
        return "Welcome Reward (1st Visit)";
      case 'loyalty':
        return `Loyalty Reward (${discount.automation.appointmentThreshold || 'X'} visits)`;
      case 're_engagement':
        return `Win-Back Reward (${discount.automation.daysSinceLastVisit || 'X'} days inactivity)`;
      case 'birthday':
        return "Birthday Celebration Reward";
      default:
        return "Automated Protocol";
    }
  }, [discount.automation]);

  return (
    <Card className={cn(
        "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col",
        discount.isActive ? "border-primary/20 bg-white hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 shadow-sm" : "border-border/50 bg-muted/5 opacity-70 grayscale-[0.5]"
    )}>
      <CardHeader className="p-6 pb-2 text-left">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
                <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{discount.code}</p>
                {discount.automation && discount.automation.trigger !== 'none' && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1 bg-primary/10 rounded-lg shrink-0">
                                    <Wand2 className="h-3 w-3 text-primary" />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">{automationTooltipText}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">
                {discount.description || 'Manual Script Entry'}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 rounded-xl hover:bg-primary/10 transition-all"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                <DropdownMenuItem onClick={() => onEdit(discount)} className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                    <Edit className="mr-2 h-3.5 w-3.5 opacity-40" /> Edit Script
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5" onClick={() => onDelete(discount.id)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-2 space-y-6 flex-1 flex flex-col">
        <div className="p-5 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-primary/5 transition-all text-center space-y-1 shadow-inner">
            <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.2em]">Incentive Yield</p>
            <p className="text-3xl font-black text-primary tracking-tighter font-mono leading-none">
                {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value.toFixed(2)}`}<span className="text-xs ml-1 uppercase">Off</span>
            </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-background border shadow-sm text-left">
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1 flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5" /> Total Yield
                </p>
                <p className="font-black font-mono text-sm text-slate-900">${totalSavings.toFixed(0)}</p>
            </div>
            <div className="p-3 rounded-xl bg-background border shadow-sm text-left">
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1 flex items-center gap-1">
                    <Target className="w-2.5 h-2.5" /> Reach
                </p>
                <p className="font-black font-mono text-sm text-slate-900">{discount.usageCount}</p>
            </div>
        </div>

        {!isUnlimited && (
            <div className="space-y-2 mt-auto">
                <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                    <span>Protocol Progress</span>
                    <span>{discount.usageCount} / {discount.usageLimit}</span>
                </div>
                <Progress value={usagePercentage} className="h-1.5 rounded-full bg-muted" />
            </div>
        )}
      </CardContent>

      <CardFooter className="p-4 bg-muted/5 border-t">
        <div className="flex items-center justify-between w-full px-1">
            <Badge variant={discount.isActive ? 'default' : 'secondary'} className="h-5 px-2 font-black text-[8px] uppercase border-none shadow-sm">
                {discount.isActive ? 'Active' : 'Halted'}
            </Badge>
            {potentialLoss !== null && (
                <div className="flex items-center gap-1 text-[9px] font-black text-destructive/60 uppercase tracking-tight">
                    <AlertTriangle className="h-3 w-3" /> Max Exposure: ${potentialLoss.toFixed(0)}
                </div>
            )}
        </div>
      </CardFooter>
    </Card>
  );
};
