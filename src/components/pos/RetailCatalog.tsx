
'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { type InventoryItem, type Service, type Membership, type Package } from '@/lib/data';
import { MenuItemCard } from './MenuItemCard';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Search, QrCode } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { MembershipPOSCard } from './MembershipPOSCard';
import { PackagePOSCard } from './PackagePOSCard';

interface RetailCatalogProps {
  inventory: InventoryItem[];
  services: Service[];
  memberships: Membership[];
  packages: Package[];
  onAddToCart: (item: InventoryItem | Service | Membership | Package) => void;
  onScanClick: () => void;
}

export const RetailCatalog: React.FC<RetailCatalogProps> = ({ inventory, services, memberships, packages, onAddToCart, onScanClick }) => {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const categories = useMemo(() => {
    const invCategories = inventory.filter(i => i.type === 'retail').map(i => i.category);
    const serviceCategories = services.map(s => s.category);
    const specialCategories = [];
    if (memberships.length > 0) specialCategories.push('Memberships');
    if (packages.length > 0) specialCategories.push('Packages');
    return ['All', ...specialCategories, ...Array.from(new Set([...invCategories, ...serviceCategories]))];
  }, [inventory, services, memberships, packages]);

  const filteredItems = useMemo(() => {
    const allItems = [...inventory.filter(i => i.type === 'retail'), ...services.filter(s => !s.isPrivate)];
    
    let items: (InventoryItem | Service | Membership | Package)[] = allItems;
    
    if (activeCategory === 'Memberships') {
        items = memberships;
    } else if (activeCategory === 'Packages') {
        items = packages;
    } else if (activeCategory !== 'All') {
      items = items.filter(item => 'category' in item && item.category === activeCategory);
    }
    
    if (searchTerm) {
        items = items.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    return items;
  }, [inventory, services, memberships, packages, activeCategory, searchTerm]);

  return (
    <div className="space-y-4">
        <div className="flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search services and products..."
                    className="pl-9 h-11"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={onScanClick}>
                <QrCode className="h-5 w-5" />
            </Button>
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
        {filteredItems.map(item => {
          if ('interval' in item) { // Membership
            return <MembershipPOSCard key={item.id} membership={item} onAddToCart={onAddToCart} />
          }
          if ('sessions' in item) { // Package
            const service = services.find(s => s.id === item.serviceId);
            return <PackagePOSCard key={item.id} pack={item} service={service} onAddToCart={onAddToCart} />
          }
          // Product or Service
          return <MenuItemCard key={item.id} item={item} onAddToCart={onAddToCart} />
        })}
      </div>
    </div>
  );
};
