'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, DollarSign, Target, BarChart } from 'lucide-react';

interface WeeklyKpiSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpis: {
    weeklyRevenue: number;
    projectedRevenue: number;
    weeklyBreakEven: number;
    weeklyNetProfit: number;
    absorbedCosts: number;
  };
  isMobile: boolean;
}

export const WeeklyKpiSheet: React.FC<WeeklyKpiSheetProps> = ({ open, onOpenChange, kpis, isMobile }) => {
  const content = (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="text-primary"/>This Week's Revenue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
            <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Actual Revenue</span>
                <span className="text-2xl font-bold">${kpis.weeklyRevenue.toFixed(2)}</span>
            </div>
             <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Projected Revenue</span>
                <span className="text-lg font-semibold">${kpis.projectedRevenue.toFixed(2)}</span>
            </div>
        </CardContent>
      </Card>
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="text-primary"/>Profitability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
            <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Break-Even Point</span>
                <span className="text-lg font-semibold">${kpis.weeklyBreakEven.toFixed(2)}</span>
            </div>
             <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Absorbed Costs</span>
                <span className="text-lg font-semibold text-destructive">${kpis.absorbedCosts.toFixed(2)}</span>
            </div>
             <div className="flex justify-between items-baseline font-bold text-lg border-t pt-2 mt-2">
                <span>Net Profit</span>
                <span className={kpis.weeklyNetProfit > 0 ? 'text-primary' : 'text-destructive'}>${kpis.weeklyNetProfit.toFixed(2)}</span>
            </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? "h-[60vh]" : ""}>
        <SheetHeader>
          <SheetTitle>Weekly KPIs</SheetTitle>
          <SheetDescription>Your key performance indicators for the current week.</SheetDescription>
        </SheetHeader>
        {content}
         <SheetFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
