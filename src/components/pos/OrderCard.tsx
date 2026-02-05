
'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { type Appointment } from '@/lib/data';

interface OrderCardProps {
  order: Appointment;
  isSelected: boolean;
  onSelect: () => void;
}

export const OrderCard: React.FC<OrderCardProps> = ({ order, isSelected, onSelect }) => {
  const statusStyles = {
    waiting: 'bg-red-100 text-red-800',
    servicing: 'bg-blue-100 text-blue-800',
    ready_for_checkout: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
    confirmed: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-red-100 text-red-800',
    deposit_pending: 'bg-yellow-100 text-yellow-800',
  };

  const statusText: { [key: string]: string } = {
    waiting: 'Waiting',
    servicing: 'In Progress',
    ready_for_checkout: 'Ready',
    completed: 'Served',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    deposit_pending: 'Pending',
  }

  const status = statusStyles[order.status as keyof typeof statusStyles] || 'bg-gray-100 text-gray-800';
  const text = statusText[order.status] || 'Unknown';
  
  return (
    <Card
      className={cn(
        "w-60 shrink-0 cursor-pointer transition-colors",
        isSelected ? 'border-primary ring-2 ring-primary' : 'hover:border-gray-300'
      )}
      onClick={onSelect}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex justify-between items-center">
          <p className="font-bold">{order.clientName}</p>
          <p className="text-sm font-medium">Table 03</p>
        </div>
        <p className="text-sm text-muted-foreground">Items: { (order.addOnIds?.length || 0) + 1}</p>
        <div className="flex justify-between items-center text-xs">
          <p className="text-muted-foreground">{formatDistanceToNow(parseISO(order.startTime as string), { addSuffix: true })}</p>
          <Badge className={status}>{text}</Badge>
        </div>
      </CardContent>
    </Card>
  );
};
