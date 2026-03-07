'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Award, Sparkles } from 'lucide-react';
import { type Membership } from '@/lib/data';

interface MembershipPOSCardProps {
  membership: Membership;
  onAddToCart: (item: Membership) => void;
}

export const MembershipPOSCard: React.FC<MembershipPOSCardProps> = ({ membership, onAddToCart }) => {
  return (
    <Card 
        className="overflow-hidden border-4 border-indigo-500/20 bg-indigo-500/[0.02] hover:border-indigo-500/50 transition-all duration-500 hover:shadow-2xl hover:shadow-indigo-500/10 cursor-pointer h-full flex flex-col rounded-[2rem] group shadow-sm" 
        onClick={() => onAddToCart(membership)}
    >
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="relative aspect-square bg-indigo-100/50 flex items-center justify-center overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Award className="w-20 h-20 text-indigo-600" />
          </div>
          <Award className="w-16 h-16 text-indigo-500 group-hover:scale-110 transition-transform duration-700" />
          
          <div className="absolute top-3 right-3">
            <Button size="icon" className="h-10 w-10 bg-white/90 hover:bg-indigo-600 backdrop-blur-md text-indigo-600 hover:text-white rounded-2xl shadow-xl transition-all border-2 border-white/50">
              <Plus className="w-5 h-5" />
            </Button>
          </div>
          <div className="absolute bottom-3 left-3 flex gap-1">
              <span className="bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg">Club Access</span>
          </div>
        </div>
        <div className="p-4 md:p-5 flex flex-col flex-1 justify-between gap-3 text-left">
          <div className="space-y-1">
            <h4 className="font-black text-xs md:text-sm leading-tight uppercase tracking-tight text-slate-900 line-clamp-2">{membership.name}</h4>
            <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Recurring Membership</p>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-dashed border-indigo-500/10">
            <span className="text-[9px] font-black uppercase text-indigo-600/60 tracking-widest">Rate</span>
            <p className="font-black text-indigo-600 text-base md:text-lg tracking-tighter font-mono">
                ${membership.price.toFixed(2)}<span className="text-[9px] lowercase font-bold ml-0.5 opacity-60">/{membership.interval === 'monthly' ? 'mo' : 'yr'}</span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
