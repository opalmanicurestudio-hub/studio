
'use client';

import {
  Card,
  CardContent,
} from '@/components/ui/card';
import Image from 'next/image';
import { Clock, DollarSign, ArrowRight, Sparkles } from 'lucide-react';
import { Service, Staff, PricingTier } from '@/lib/data';
import { useMemo, useState, useEffect } from 'react';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

const ServiceCard = ({ service, onSelect, staffMember }: { service: Service, onSelect: () => void, staffMember?: Staff }) => {
    const { priceText, durationText } = useMemo(() => {
        let price = service.price;
        let duration = service.duration;

        if (staffMember && staffMember.pricingTierId && service.serviceTiers) {
            const tierInfo = service.serviceTiers.find(t => t.tierId === staffMember.pricingTierId);
            if (tierInfo) {
                price = tierInfo.price;
                duration = tierInfo.durationMinutes;
                return { priceText: `$${price.toFixed(2)}`, durationText: `${duration} min` };
            }
        }

        if (service.serviceTiers && service.serviceTiers.length > 0) {
            const prices = service.serviceTiers.map(t => t.price);
            const minPrice = Math.min(...prices);
            return { priceText: `From $${minPrice.toFixed(2)}`, durationText: `${service.duration} min` };
        }
        
        return { priceText: `$${price.toFixed(2)}`, durationText: `${duration} min` };
    }, [service, staffMember]);

    return (
      <motion.div 
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={{ y: -8 }}
        className="cursor-pointer group h-full" 
        onClick={onSelect}
      >
        <Card className="overflow-hidden border-2 border-border/50 bg-card hover:border-primary/50 transition-all duration-500 shadow-sm hover:shadow-2xl hover:shadow-primary/10 h-full flex flex-col rounded-3xl">
          <CardContent className="p-0 flex flex-col flex-1">
            <div className="relative aspect-[4/3] w-full bg-muted overflow-hidden">
              {service.imageUrl ? (
                <Image
                  src={service.imageUrl}
                  alt={service.name}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-primary/5">
                    <Sparkles className="w-12 h-12 text-primary/20" />
                </div>
              )}
              <div className="absolute top-4 right-4">
                <Badge className="bg-background/80 backdrop-blur-md text-foreground border-none font-black text-[10px] uppercase tracking-widest px-3 py-1 shadow-sm">
                    {durationText}
                </Badge>
              </div>
            </div>
            <div className="p-6 space-y-4 flex flex-col flex-1">
              <div className="space-y-1">
                <h3 className="font-black uppercase tracking-tight text-lg line-clamp-1 group-hover:text-primary transition-colors">{service.name}</h3>
                {service.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed font-medium">
                    {service.description}
                  </p>
                )}
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-dashed mt-auto">
                <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Investment</span>
                    <span className="text-xl font-black text-primary tracking-tighter">{priceText}</span>
                </div>
                <Button size="sm" className="rounded-full font-black uppercase text-[10px] tracking-widest px-5 h-9 group-hover:shadow-lg group-hover:shadow-primary/30 transition-all">
                    Book <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
};

const Badge = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
        {children}
    </div>
);

export const BookingServices = ({ services, onServiceSelect, staffMember, showPrivateServices = false }: { services: Service[], onServiceSelect: (service: Service) => void, staffMember?: Staff, showPrivateServices?: boolean }) => {

    const servicesByCategory = useMemo(() => {
        if (!services) return {};
        return services
            .filter(s => (showPrivateServices || !s.isPrivate) && s.type !== 'addon')
            .reduce((acc, service) => {
                const category = service.category || 'Other Services';
                if (!acc[category]) {
                    acc[category] = [];
                }
                acc[category].push(service);
                return acc;
            }, {} as Record<string, Service[]>);
    }, [services, showPrivateServices]);

    const categories = useMemo(() => ['All', ...Object.keys(servicesByCategory).sort()], [servicesByCategory]);
    const [selectedCategory, setSelectedCategory] = useState('All');

    const filteredServices = useMemo(() => {
        if (selectedCategory === 'All') {
            return Object.values(servicesByCategory).flat();
        }
        return servicesByCategory[selectedCategory] || [];
    }, [selectedCategory, servicesByCategory]);

    return (
        <section className="space-y-12">
            <div className="text-center space-y-4">
                <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">The Menu</h2>
                <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">Curated treatments for your well-being</p>
            </div>
            
            <div className="w-full">
                <ScrollArea className="w-full pb-4">
                    <div className="flex justify-center gap-2 min-w-max px-4">
                        {categories.map(category => (
                            <Button 
                                key={category}
                                variant={selectedCategory === category ? 'default' : 'outline'}
                                onClick={() => setSelectedCategory(category)}
                                className={cn(
                                    "rounded-full h-10 px-6 font-black uppercase text-[10px] tracking-widest transition-all",
                                    selectedCategory === category ? "shadow-lg shadow-primary/20" : "bg-card border-2"
                                )}
                            >
                                {category}
                            </Button>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 px-4">
                <AnimatePresence mode="popLayout">
                    {filteredServices.map((service) => (
                        <ServiceCard key={service.id} service={service} onSelect={() => onServiceSelect(service)} staffMember={staffMember} />
                    ))}
                </AnimatePresence>
            </div>
        </section>
    );
};
