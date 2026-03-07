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
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BillDueDateCard } from './BillDueDateCard';
import { type BillDefinition, type BillInstance } from '@/lib/financial-data';
import { Sparkles, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BillsDueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billInstances: (BillInstance & { definition: BillDefinition })[];
  isMobile: boolean;
  onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void;
}

export const BillsDueSheet: React.FC<BillsDueSheetProps> = ({
  open,
  onOpenChange,
  billInstances,
  isMobile,
  onLogPaymentClick,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side={isMobile ? 'bottom' : 'right'} 
        className={cn(
            "p-0 border-none bg-background flex flex-col shadow-3xl",
            isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl"
        )}
      >
        <SheetHeader className="p-6 sm:p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Planning Studio</span>
          </div>
          <SheetTitle className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Bills & Obligations</SheetTitle>
          <SheetDescription className="text-[10px] sm:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
            Reconcile recurring expenses due in the next 7 days.
          </SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1">
          <div className="p-6 sm:p-8 space-y-6 pb-20">
            {billInstances.length > 0 ? (
              <div className="grid gap-4">
                {billInstances.map(instance => (
                    <BillDueDateCard key={instance.id} instance={instance} onLogPaymentClick={onLogPaymentClick} />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                <CreditCard className="w-12 h-12" />
                <p className="text-[10px] font-black uppercase tracking-widest">No immediate obligations</p>
              </div>
            )}
          </div>
        </ScrollArea>
        
        <SheetFooter className="p-6 sm:p-8 pt-4 border-t bg-background flex-shrink-0">
          <Button onClick={() => onOpenChange(false)} className="w-full h-16 rounded-2xl text-xl font-black uppercase tracking-tight shadow-2xl shadow-primary/20 transition-all active:scale-95">Close Summary</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
