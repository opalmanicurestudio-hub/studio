

'use client';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { Clock, DollarSign } from 'lucide-react';
import { Service, Staff, PricingTier } from '@/lib/data';
import { useMemo, useState, useEffect } from 'react';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

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
            
            if (service.price > 0 && service.price < minPrice) {
                 return { priceText: `From $${service.price.toFixed(2)}`, durationText: `${service.duration} min` };
            }
            
            if (minPrice === Math.max(...prices)) {
                return { priceText: `$${minPrice.toFixed(2)}`, durationText: `${service.duration} min` };
            }

            return { priceText: `From $${minPrice.toFixed(2)}`, durationText: `${service.duration} min` };
        }
        
        return { priceText: `$${price.toFixed(2)}`, durationText: `${duration} min` };
    }, [service, staffMember]);

  if (service.imageUrl) {
    return (
      <div className="cursor-pointer group h-full" onClick={onSelect}>
        <Card className="overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full flex flex-col">
          <CardContent className="p-0 flex flex-col flex-1">
            <div className="relative aspect-[4/3] w-full bg-muted/30">
              <Image
                src={service.imageUrl}
                alt={service.name}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-110"
              />
            </div>
            <div className="p-4 space-y-2 flex flex-col flex-1">
              <h3 className="font-semibold truncate">{service.name}</h3>
              <div className="flex-grow min-h-[32px]">
                {service.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {service.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t mt-auto">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>{durationText}</span>
                </div>
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>{priceText}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Text-based card
  return (
    <div className="cursor-pointer group h-full" onClick={onSelect}>
      <Card className="transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full flex flex-col bg-muted/30">
        <CardContent className="p-4 flex flex-col flex-1">
          <div className="flex-grow">
            <h3 className="font-semibold text-lg mb-2">{service.name}</h3>
            {service.description && (
              <p className="text-xs text-muted-foreground line-clamp-3">
                {service.description}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t mt-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>{durationText}</span>
            </div>
            <div className="flex items-center gap-2 font-medium text-foreground">
                <DollarSign className="w-4 h-4" />
                <span>{priceText}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};


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

    const categories = useMemo(() => Object.keys(servicesByCategory).sort(), [servicesByCategory]);
    const [selectedCategory, setSelectedCategory] = useState('');

    useEffect(() => {
        if (categories.length > 0 && !categories.includes(selectedCategory)) {
            setSelectedCategory(categories[0]);
        }
    }, [categories, selectedCategory]);

    const servicesToShow = servicesByCategory[selectedCategory] || [];

    return (
        <section className="space-y-6">
            <h2 className="text-3xl font-bold text-center">Our Services</h2>
            
            {categories.length > 0 && (
                <div className="w-full max-w-sm mx-auto">
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map(category => (
                                <SelectItem key={category} value={category}>{category}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            
            {selectedCategory && (
                 <ScrollArea>
                    <Carousel
                        opts={{
                            align: "start",
                            dragFree: true,
                        }}
                        className="w-full"
                        >
                        <CarouselContent>
                            {servicesToShow.map((service) => (
                                <CarouselItem key={service.id} className="basis-4/5 sm:basis-1/2 md:basis-1/3">
                                    <ServiceCard service={service} onSelect={() => onServiceSelect(service)} staffMember={staffMember} />
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                        <CarouselPrevious className="hidden sm:flex" />
                        <CarouselNext className="hidden sm:flex" />
                    </Carousel>
                    <ScrollBar orientation="horizontal" className="md:hidden" />
                </ScrollArea>
            )}
        </section>
    );
};
