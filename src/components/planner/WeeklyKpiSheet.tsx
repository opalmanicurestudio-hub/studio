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
import { TrendingUp, DollarSign, Target, BarChart, Sparkles, PieChart, Landmark, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';

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
    <div className="space-y-8 pb-20">
      <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
        <div className="absolute top-0 right-0 p-6 opacity-5 transition-opacity group-hover:opacity-10">
            <BarChart className="w-24 h-24 text-primary" />
        </div>
        <CardHeader className="p-8 pb-2">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
            <Sparkles className="w-3 h-3" />
            Performance Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8 pt-0">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-widest mb-1">Weekly Gross</p>
            <p className="text-6xl font-black text-primary tracking-tighter font-mono">${kpis.weeklyRevenue.toFixed(2)}</p>
            <div className="mt-6 flex items-center gap-3 p-3 rounded-2xl bg-white/50 border border-primary/10">
                <div className="p-2 bg-primary/10 rounded-xl"><Target className="w-4 h-4 text-primary" /></div>
                <div className="space-y-0.5">
                    <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Projected Pipeline</p>
                    <p className="text-sm font-black uppercase text-slate-900">${kpis.projectedRevenue.toFixed(2)} Remaining</p>
                </div>
            </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-2">Yield Analysis</h3>
        <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden">
            <CardContent className="p-0">
                <div className="p-6 space-y-6">
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Overhead Threshold</p>
                            <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">${kpis.weeklyBreakEven.toFixed(2)}</p>
                        </div>
                        <div className="p-3 bg-muted rounded-2xl shadow-inner"><Landmark className="w-6 h-6 text-muted-foreground" /></div>
                    </div>
                    
                    <div className="flex justify-between items-center border-t border-dashed pt-6">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-destructive tracking-widest opacity-60">Absorbed Costs</p>
                            <p className="text-2xl font-black font-mono tracking-tighter text-destructive">-${kpis.absorbedCosts.toFixed(2)}</p>
                        </div>
                        <div className="p-3 bg-destructive/5 rounded-2xl border border-destructive/10"><PieChart className="w-6 h-6 text-destructive" /></div>
                    </div>
                </div>
                
                <div className={cn(
                    "p-8 text-center border-t-4 transition-colors",
                    kpis.weeklyNetProfit >= 0 ? "bg-green-500/5 border-green-500/20 text-green-700" : "bg-destructive/5 border-destructive/20 text-destructive"
                )}>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 opacity-60">Estimated Net Yield</p>
                    <p className="text-5xl font-black tracking-tighter font-mono">${kpis.weeklyNetProfit.toFixed(2)}</p>
                    <div className="mt-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest">
                        {kpis.weeklyNetProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingUp className="w-4 h-4 rotate-180" />}
                        {kpis.weeklyNetProfit >= 0 ? "Operating Profit" : "Operating Loss"}
                    </div>
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="p-6 rounded-[2rem] border-2 border-dashed bg-muted/10 flex items-start gap-4">
        <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed font-medium">
            This analysis is calculated in real-time based on your <strong>${(kpis.weeklyBreakEven / 7 / (160/30.44)).toFixed(2)}/hr TMHR</strong> and current completed sessions.
        </p>
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side={isMobile ? 'bottom' : 'right'} 
        className={cn(
            "p-0 border-none bg-background flex flex-col shadow-3xl",
            isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl"
        )}
      >
        <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Studio Intelligence</span>
          </div>
          <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Weekly Performance</SheetTitle>
          <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Live yield and overhead recovery tracking.</SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1">
            <div className="px-8 pt-8">
                {content}
            </div>
        </ScrollArea>
        
        <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <Button onClick={() => onOpenChange(false)} className="w-full h-16 rounded-2xl text-xl font-black uppercase tracking-tight shadow-2xl shadow-primary/20 transition-all active:scale-95">Close Dashboard</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
