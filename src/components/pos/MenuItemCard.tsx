'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Minus } from 'lucide-react';
import Image from 'next/image';
import { type InventoryItem, type Service } from '@/lib/data';

interface MenuItemCardProps {
  item: InventoryItem | Service;
  onAddToCart: (item: InventoryItem | Service) => void;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = ({ item, onAddToCart }) => {
  const imageUrl = 'imageUrl' in item ? item.imageUrl : undefined;
  const price = 'price' in item ? item.price : ('msrp' in item ? item.msrp : 0);

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="relative aspect-square mb-2 rounded-md overflow-hidden bg-muted">
          {imageUrl && <Image src={imageUrl} alt={item.name} fill className="object-cover" />}
        </div>
        <div className="space-y-2">
          <h4 className="font-semibold text-sm leading-tight truncate">{item.name}</h4>
          <div className="flex justify-between items-center">
            <p className="font-bold text-primary">${price?.toFixed(2)}</p>
            <Button size="icon" className="h-8 w-8" onClick={() => onAddToCart(item)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
