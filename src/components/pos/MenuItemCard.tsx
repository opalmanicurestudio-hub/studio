
'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Image from 'next/image';
import { type InventoryItem, type Service } from '@/lib/data';

interface MenuItemCardProps {
  item: InventoryItem | Service;
  onAddToCart: (item: InventoryItem | Service) => void;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = ({ item, onAddToCart }) => {
  const imageUrl = 'imageUrl' in item ? item.imageUrl : undefined;
  const price = 'price' in item ? item.price : ('msrp' in item ? item.msrp || 0 : 0);

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer" onClick={() => onAddToCart(item)}>
      <CardContent className="p-0">
        <div className="relative aspect-square bg-muted">
          {imageUrl ? (
            <Image src={imageUrl} alt={item.name} fill className="object-cover" />
          ) : (
             <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {/* Placeholder based on type */}
                {'price' in item ? 'Service' : 'Product'}
            </div>
          )}
           <Button size="icon" className="absolute top-2 right-2 h-8 w-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white rounded-full">
              <Plus className="w-4 h-4" />
            </Button>
        </div>
        <div className="p-3">
          <h4 className="font-semibold text-sm leading-tight truncate">{item.name}</h4>
          <p className="font-bold text-primary mt-1">${price?.toFixed(2)}</p>
        </div>
      </CardContent>
    </Card>
  );
};
