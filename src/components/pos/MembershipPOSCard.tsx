

'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Award } from 'lucide-react';
import { type Membership } from '@/lib/data';

interface MembershipPOSCardProps {
  membership: Membership;
  onAddToCart: (item: Membership) => void;
}

export const MembershipPOSCard: React.FC<MembershipPOSCardProps> = ({ membership, onAddToCart }) => {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col" onClick={() => onAddToCart(membership)}>
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="relative aspect-[4/3] bg-indigo-500/10 flex items-center justify-center">
          <Award className="w-16 h-16 text-indigo-400" />
          <Button size="icon" className="absolute top-2 right-2 h-8 w-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white rounded-full">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-3">
          <h4 className="font-semibold text-sm leading-tight truncate">{membership.name}</h4>
          <p className="font-bold text-primary mt-1">${membership.price.toFixed(2)} / {membership.interval === 'monthly' ? 'mo' : 'yr'}</p>
        </div>
      </CardContent>
    </Card>
  );
};
