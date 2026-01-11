'use client';

import React from 'react';
import { type Bill } from '@/lib/financial-data';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Landmark } from 'lucide-react';

interface BillDueDateCardProps {
  bill: Bill;
}

export const BillDueDateCard: React.FC<BillDueDateCardProps> = ({ bill }) => {
  return (
    <Card className="mb-2">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted/50 rounded-md">
              <Landmark className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-sm">{bill.name}</p>
              <div className="flex items-center gap-2">
                <Badge
                  variant={bill.context === 'Business' ? 'secondary' : 'outline'}
                  className={cn('text-xs', {
                    'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': bill.context === 'Business',
                    'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': bill.context === 'Personal',
                  })}
                >
                  {bill.context}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-base text-destructive">-${bill.amount.toFixed(2)}</p>
            <Button variant="outline" size="xs" className="mt-1">Log Payment</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
