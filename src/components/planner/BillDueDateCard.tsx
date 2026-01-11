
'use client';

import React from 'react';
import { type Bill, type BillInstance } from '@/lib/financial-data';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Landmark, AlertTriangle } from 'lucide-react';

interface BillDueDateCardProps {
  instance: BillInstance & { definition: Bill };
}

export const BillDueDateCard: React.FC<BillDueDateCardProps> = ({ instance }) => {
  const isOverdue = instance.status === 'overdue';

  return (
    <Card className={cn("mb-2", isOverdue && "border-destructive/50 bg-destructive/5")}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 bg-muted/50 rounded-md", isOverdue && "bg-destructive/10")}>
              {isOverdue ? (
                <AlertTriangle className="w-5 h-5 text-destructive" />
              ) : (
                <Landmark className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="font-semibold text-sm">{instance.definition.name}</p>
              <div className="flex items-center gap-2">
                <Badge
                  variant={instance.definition.context === 'Business' ? 'secondary' : 'outline'}
                  className={cn('text-xs', {
                    'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': instance.definition.context === 'Business',
                    'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': instance.definition.context === 'Personal',
                  })}
                >
                  {instance.definition.context}
                </Badge>
                {isOverdue && <Badge variant="destructive">Overdue</Badge>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-base text-destructive">-${instance.amountDue.toFixed(2)}</p>
            <Button variant="outline" size="xs" className="mt-1">Log Payment</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
