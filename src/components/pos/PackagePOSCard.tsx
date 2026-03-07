'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Repeat, Sparkles } from 'lucide-react';
import { type Package, type Service } from '@/lib/data';

interface PackagePOSCardProps {
  pack: Package;
  service?: Service;
  onAddToCart: (item: Package) => void;
}

export const PackagePOSCard: React.FC<PackagePOSCardProps> = ({ pack, service, onAddToCart }) => {
  return (
    <Card 
        className="overflow-hidden border-4 border-teal-500/20 bg-teal-500/[0.02] hover:border-teal-500/50 transition-all duration-500 hover:shadow-2xl hover:shadow-teal-500/10 cursor-pointer h-full flex flex-col rounded-[2rem] group shadow-sm" 
        onClick={() => onAddToCart(pack)}
    >
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="relative aspect-square bg-teal-100/50 flex items-center justify-center overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Repeat className="w-20 h-20 text-teal-600" />
          </div>
          <Repeat className="w-16 h-16 text-teal-500 group-hover:scale-110 transition-transform duration-700" />
          
          <div className="absolute top-3 right-3">
            <Button size="icon" className="h-10 w-10 bg-white/90 hover:bg-teal-600 backdrop-blur-md text-teal-600 hover:text-white rounded-2xl shadow-xl transition-all border-2 border-white/50">
                <Plus className="w-5 h-5" />
            </Button>
          </div>
          <div className="absolute bottom-3 left-3">
              <span className="bg-teal-600 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg">{pack.sessions} Sessions</span>
          </div>
        </div>
        <div className="p-4 md:p-5 flex flex-col flex-1 justify-between gap-3 text-left">
          <div className="space-y-1">
            <h4 className="font-black text-xs md:text-sm leading-tight uppercase tracking-tight text-slate-900 line-clamp-2">{pack.name}</h4>
            <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{service?.name || 'Prepaid Bundle'}</p>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-dashed border-teal-500/10">
            <span className="text-[9px] font-black uppercase text-teal-600/60 tracking-widest">Bundle</span>
            <p className="font-black text-teal-600 text-base md:text-lg tracking-tighter font-mono">${pack.price.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
