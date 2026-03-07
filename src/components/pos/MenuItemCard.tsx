'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Scissors, Package, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { type InventoryItem, type Service } from '@/lib/data';
import { cn } from '@/lib/utils';

interface MenuItemCardProps {
  item: InventoryItem | Service;
  onAddToCart: (item: InventoryItem | Service) => void;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = ({ item, onAddToCart }) => {
  const imageUrl = 'imageUrl' in item ? item.imageUrl : undefined;
  const price = 'price' in item ? item.price : ('msrp' in item ? item.msrp || 0 : 0);
  const isService = 'duration' in item;

  return (
    <Card 
        className="overflow-hidden border-2 border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 cursor-pointer h-full flex flex-col rounded-[2rem] group bg-white shadow-sm" 
        onClick={() => onAddToCart(item)}
    >
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="relative aspect-square w-full bg-muted/20 overflow-hidden">
          {imageUrl ? (
            <Image src={imageUrl} alt={item.name} fill className="object-cover transition-transform duration-700 group-hover:scale-110" />
          ) : (
             <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                {isService ? <Scissors className="w-10 h-10" /> : <Package className="w-10 h-10" />}
            </div>
          )}
          <div className="absolute top-3 right-3">
            <Button 
                size="icon" 
                className="h-10 w-10 bg-white/90 hover:bg-primary backdrop-blur-md text-slate-900 hover:text-white rounded-2xl shadow-xl transition-all border-2 border-white/50"
            >
                <Plus className="w-5 h-5" />
            </Button>
          </div>
          {isService && (
              <div className="absolute bottom-3 left-3">
                  <span className="bg-black/60 backdrop-blur-md text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg">{(item as Service).duration}m</span>
              </div>
          )}
        </div>
        <div className="p-4 md:p-5 flex flex-col flex-1 justify-between gap-3 text-left">
          <div className="space-y-1">
            <h4 className="font-black text-xs md:text-sm leading-tight uppercase tracking-tight text-slate-900 line-clamp-2">{item.name}</h4>
            <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{'category' in item ? item.category : 'Service'}</p>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-dashed">
            <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Retail</span>
            <p className="font-black text-primary text-base md:text-lg tracking-tighter font-mono">${price?.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
