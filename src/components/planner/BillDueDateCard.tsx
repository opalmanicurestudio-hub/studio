'use client';

import React from 'react';
import { type Bill, type BillInstance } from '@/lib/financial-data';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Landmark, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';

interface BillDueDateCardProps {
  instance: BillInstance & { definition: Bill };
  onLogPaymentClick: (instance: BillInstance & { definition: Bill }) => void;
}

export const BillDueDateCard: React.FC<BillDueDateCardProps> = ({ instance, onLogPaymentClick }) => {
  const isOverdue = instance.status === 'overdue';
  const isPaid = instance.status === 'paid';

  return (
    <Card className={cn(
        "relative transition-all border-4 rounded-[2rem] overflow-hidden group",
        isOverdue ? "border-destructive/40 bg-destructive/[0.02] shadow-xl shadow-destructive/5 animate-in fade-in zoom-in-95" : "border-border/50 bg-white",
        isPaid && "opacity-60 grayscale-[0.5] border-green-500/20"
    )}>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className={cn(
                "p-3 rounded-2xl shadow-inner shrink-0", 
                isOverdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                isPaid && "bg-green-500/10 text-green-600"
            )}>
              {isPaid ? <CheckCircle2 className="w-6 h-6" /> : isOverdue ? <AlertTriangle className="w-6 h-6 animate-pulse" /> : <Landmark className="w-6 h-6" />}
            </div>
            <div className="min-w-0">
              <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate leading-tight mb-1">{instance.definition.name}</p>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn('text-[8px] h-4 px-1.5 font-black uppercase tracking-widest border-none', {
                    'bg-indigo-100 text-indigo-800': instance.definition.context === 'Business',
                    'bg-purple-100 text-purple-800': instance.definition.context === 'Personal',
                  })}
                >
                  {instance.definition.context}
                </Badge>
                {isOverdue && <Badge className="bg-destructive text-white border-none text-[8px] h-4 px-1.5 font-black uppercase tracking-widest animate-pulse">OVERDUE</Badge>}
                {isPaid && <Badge className="bg-green-500 text-white border-none text-[8px] h-4 px-1.5 font-black uppercase tracking-widest">PAID</Badge>}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-40 mb-0.5">Amount Due</p>
            <p className={cn(
                "font-black text-2xl tracking-tighter font-mono leading-none", 
                isPaid ? 'text-muted-foreground line-through opacity-40' : 'text-slate-900'
            )}>
                ${instance.definition.amount.toFixed(2)}
            </p>
          </div>
        </div>
      </CardContent>
      
      {!isPaid && (
          <div className="p-2 pt-0 border-t border-dashed bg-muted/5">
            <Button 
                variant="ghost" 
                className={cn(
                    "w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all hover:bg-primary hover:text-white group",
                    isOverdue && "text-destructive hover:bg-destructive hover:text-white"
                )}
                onClick={() => onLogPaymentClick(instance)}
            >
                Log Distribution
                <ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
      )}
    </Card>
  );
};
