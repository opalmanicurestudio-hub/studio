
'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { type InventoryItem, type Service } from '@/lib/data';
import { MenuItemCard } from './MenuItemCard';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface RetailCatalogProps {
  inventory: InventoryItem[];
  services: Service[];
  onAddToCart: (item: InventoryItem | Service) => void;
}

export const RetailCatalog: React.FC<RetailCatalogProps> = ({ inventory, services, onAddToCart }) => {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const categories = useMemo(() => {
    const invCategories = inventory.filter(i => i.type === 'retail').map(i => i.category);
    const serviceCategories = services.map(s => s.category);
    return ['All', ...Array.from(new Set([...invCategories, ...serviceCategories]))];
  }, [inventory, services]);

  const filteredItems = useMemo(() => {
    const allItems = [...inventory.filter(i => i.type === 'retail'), ...services.filter(s => !s.isPrivate)];
    
    let items = allItems;
    
    // Filter by category
    if (activeCategory !== 'All') {
      items = items.filter(item => item.category === activeCategory);
    }
    
    // Filter by search term
    if (searchTerm) {
        items = items.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    return items;
  }, [inventory, services, activeCategory, searchTerm]);

  return (
    <div className="space-y-4">
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
                placeholder="Search services and products..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
        
        <Carousel
            opts={{
                align: "start",
                dragFree: true,
            }}
            className="w-full"
        >
            <CarouselContent>
                {categories.map((category) => (
                <CarouselItem key={category} className="basis-auto">
                    <Button
                        variant={activeCategory === category ? 'default' : 'outline'}
                        className={cn("rounded-full", activeCategory !== category && "bg-card")}
                        onClick={() => setActiveCategory(category)}
                        >
                        {category}
                    </Button>
                </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselPrevious className="hidden sm:flex" />
            <CarouselNext className="hidden sm:flex" />
        </Carousel>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredItems.map(item => (
          <MenuItemCard key={item.id} item={item} onAddToCart={onAddToCart} />
        ))}
      </div>
    </div>
  );
};
