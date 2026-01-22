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
import { type Bill, type BillInstance } from '@/lib/financial-data';

interface BillsDueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billInstances: (BillInstance & { definition: Bill })[];
  isMobile: boolean;
  onLogPaymentClick: (instance: BillInstance & { definition: Bill }) => void;
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
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? "h-[70vh] flex flex-col p-0" : "sm:max-w-md"}>
        <SheetHeader className="p-6">
          <SheetTitle>Bills Due</SheetTitle>
          <SheetDescription>
            These are your bills that are due or overdue as of today.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="px-6 space-y-4">
            {billInstances.length > 0 ? (
              billInstances.map(instance => (
                <BillDueDateCard key={instance.id} instance={instance} onLogPaymentClick={onLogPaymentClick} />
              ))
            ) : (
              <p className="text-center text-muted-foreground py-10">No bills are due.</p>
            )}
          </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
          <Button onClick={() => onOpenChange(false)} className="w-full">Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
