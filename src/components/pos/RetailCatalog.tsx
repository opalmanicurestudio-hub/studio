'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { type InventoryItem, type Service, type Membership, type Package } from '@/lib/data';
import { MenuItemCard } from './MenuItemCard';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Search, QrCode, Sparkles, ShoppingBag, Scissors, PlusCircle, Award, Box } from 'lucide-react';
import { MembershipPOSCard } from './MembershipPOSCard';
import { PackagePOSCard } from './PackagePOSCard';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface RetailCatalogProps {
  inventory: InventoryItem[];
  services: Service[];
  memberships: Membership[];
  packages: Package[];
  onAddToCart: (item: InventoryItem | Service | Membership | Package) => void;
  onScanClick: () => void;
}

type Department = 'ALL' | 'SERVICES' | 'ADD-ONS' | 'RETAIL' | 'CLUBS';

export const RetailCatalog: React.FC<RetailCatalogProps> = ({ inventory, services, memberships, packages, onAddToCart, onScanClick }) => {
  const [activeDept, setActiveDept] = useState<Department>('ALL');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Group items by their department
  const catalogData = useMemo(() => {
    return {
      SERVICES: services.filter(s => s.type === 'service' && !s.isPrivate),
      'ADD-ONS': services.filter(s => s.type === 'addon' && !s.isPrivate),
      RETAIL: inventory.filter(i => i.type === 'retail' && i.status !== 'archived'),
      CLUBS: [...memberships.filter(m => !m.isPrivate), ...packages.filter(p => !p.isPrivate)],
    };
  }, [inventory, services, memberships, packages]);

  // 2. Calculate sub-categories for the active department
  const subCategories = useMemo(() => {
    let itemsToScan: any[] = [];
    if (activeDept === 'ALL') {
        itemsToScan = [...catalogData.SERVICES, ...catalogData['ADD-ONS'], ...catalogData.RETAIL, ...catalogData.CLUBS];
    } else {
        itemsToScan = catalogData[activeDept] || [];
    }

    const cats = itemsToScan
        .map(item => {
            if ('category' in item) return item.category;
            if ('interval' in item) return 'Memberships';
            if ('sessions' in item) return 'Packages';
            return 'Other';
        })
        .filter(Boolean);

    return ['All', ...Array.from(new Set(cats)).sort()];
  }, [activeDept, catalogData]);

  // Reset sub-category when department changes
  const handleDeptChange = (dept: Department) => {
    setActiveDept(dept);
    setActiveCategory('All');
  };

  // 3. Filtered items for display
  const filteredItems = useMemo(() => {
    let items: any[] = [];
    if (activeDept === 'ALL') {
        items = [...catalogData.SERVICES, ...catalogData['ADD-ONS'], ...catalogData.RETAIL, ...catalogData.CLUBS];
    } else {
        items = catalogData[activeDept] || [];
    }
    
    if (activeCategory !== 'All') {
      items = items.filter(item => {
          if (activeCategory === 'Memberships') return 'interval' in item;
          if (activeCategory === 'Packages') return 'sessions' in item;
          return 'category' in item && item.category === activeCategory;
      });
    }
    
    if (searchTerm) {
        const search = searchTerm.toLowerCase();
        items = items.filter(item => item.name.toLowerCase().includes(search));
    }

    return items;
  }, [catalogData, activeDept, activeCategory, searchTerm]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
        <div className="space-y-6">
            {/* Header Actions */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input 
                        placeholder="SEARCH CATALOG..."
                        className="pl-12 h-12 md:h-14 rounded-2xl border-2 font-black uppercase text-[10px] md:text-xs tracking-widest focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button variant="outline" size="icon" className="h-12 w-12 md:h-14 md:w-14 rounded-2xl border-2 shadow-sm shrink-0" onClick={onScanClick}>
                    <QrCode className="h-6 w-6" />
                </Button>
            </div>

            {/* Department Switcher (High-level grouping) */}
            <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-1 opacity-60">Departments</Label>
                <div className="p-1.5 md:p-2 bg-muted/30 rounded-2xl md:rounded-3xl border-2 border-muted shadow-inner flex overflow-x-auto scrollbar-hide gap-1.5 md:gap-2">
                    {(['ALL', 'SERVICES', 'ADD-ONS', 'RETAIL', 'CLUBS'] as Department[]).map((dept) => (
                        <Button
                            key={dept}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeptChange(dept)}
                            className={cn(
                                "flex-1 min-w-[100px] h-9 md:h-11 rounded-xl md:rounded-2xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all",
                                activeDept === dept 
                                    ? "bg-white text-primary shadow-md" 
                                    : "text-muted-foreground hover:bg-white/50"
                            )}
                        >
                            {dept === 'SERVICES' && <Scissors className="w-3 h-3 mr-2 opacity-40" />}
                            {dept === 'ADD-ONS' && <PlusCircle className="w-3 h-3 mr-2 opacity-40" />}
                            {dept === 'RETAIL' && <ShoppingBag className="w-3 h-3 mr-2 opacity-40" />}
                            {dept === 'CLUBS' && <Award className="w-3 h-3 mr-2 opacity-40" />}
                            {dept}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Sub-Category Chips */}
            {subCategories.length > 1 && (
                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-1 opacity-60">Categories</Label>
                    <ScrollArea className="w-full">
                        <div className="flex gap-2 pb-2">
                            {subCategories.map((category) => (
                                <Button
                                    key={category}
                                    variant={activeCategory === category ? 'default' : 'outline'}
                                    className={cn(
                                        "rounded-full h-8 px-4 font-black uppercase text-[9px] tracking-widest transition-all",
                                        activeCategory === category ? "shadow-lg shadow-primary/20" : "bg-card border-2"
                                    )}
                                    onClick={() => setActiveCategory(category)}
                                >
                                    {category}
                                </Button>
                            ))}
                        </div>
                        <ScrollBar orientation="horizontal" className="hidden" />
                    </ScrollArea>
                </div>
            )}
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
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
            {filteredItems.length === 0 && (
                <div className="col-span-full py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                    <Box className="w-12 h-12" />
                    <p className="text-xs font-black uppercase tracking-widest">No entries in this folder</p>
                </div>
            )}
        </div>
    </div>
  );
};
