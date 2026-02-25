

'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Repeat } from 'lucide-react';
import { type Package, type Service } from '@/lib/data';

interface PackagePOSCardProps {
  pack: Package;
  service?: Service;
  onAddToCart: (item: Package) => void;
}

export const PackagePOSCard: React.FC<PackagePOSCardProps> = ({ pack, service, onAddToCart }) => {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col" onClick={() => onAddToCart(pack)}>
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="relative aspect-[4/3] bg-teal-500/10 flex items-center justify-center">
            <Repeat className="w-16 h-16 text-teal-400" />
            <Button size="icon" className="absolute top-2 right-2 h-8 w-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white rounded-full">
                <Plus className="w-4 h-4" />
            </Button>
        </div>
        <div className="p-3">
          <h4 className="font-semibold text-sm leading-tight truncate">{pack.name}</h4>
          <p className="text-xs text-muted-foreground">{pack.sessions}x {service?.name || 'Service'}</p>
          <p className="font-bold text-primary mt-1">${pack.price.toFixed(2)}</p>
        </div>
      </CardContent>
    </Card>
  );
};
