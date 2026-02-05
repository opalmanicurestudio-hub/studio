
'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { type InventoryItem, type Service } from '@/lib/data';
import { MenuItemCard } from './MenuItemCard';
import { cn } from '@/lib/utils';

interface RetailCatalogProps {
  inventory: InventoryItem[];
  services: Service[];
  onAddToCart: (item: InventoryItem | Service) => void;
}

export const RetailCatalog: React.FC<RetailCatalogProps> = ({ inventory, services, onAddToCart }) => {
  const [activeCategory, setActiveCategory] = useState('All');

  const categories = useMemo(() => {
    const invCategories = inventory.filter(i => i.type === 'retail').map(i => i.category);
    const serviceCategories = services.map(s => s.category);
    return ['All', ...Array.from(new Set([...invCategories, ...serviceCategories]))];
  }, [inventory, services]);

  const filteredItems = useMemo(() => {
    const allItems = [...inventory.filter(i => i.type === 'retail'), ...services.filter(s => !s.isPrivate)];
    if (activeCategory === 'All') {
      return allItems;
    }
    return allItems.filter(item => item.category === activeCategory);
  }, [inventory, services, activeCategory]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Menu</h2>
      <ScrollArea>
        <div className="flex space-x-2 pb-2">
          {categories.map(category => (
            <Button
              key={category}
              variant={activeCategory === category ? 'default' : 'outline'}
              className={cn("rounded-full", activeCategory !== category && "bg-card")}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredItems.map(item => (
          <MenuItemCard key={item.id} item={item} onAddToCart={onAddToCart} />
        ))}
      </div>
    </div>
  );
};
