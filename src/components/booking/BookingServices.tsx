
'use client';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { Clock, DollarSign } from 'lucide-react';
import { Service } from '@/lib/data';
import { useMemo } from 'react';

const ServiceCard = ({ service, onSelect }: { service: Service, onSelect: () => void }) => {
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
                  <span>{service.duration} min</span>
                </div>
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>{service.price.toFixed(2)}</span>
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
              <span>{service.duration} min</span>
            </div>
            <div className="flex items-center gap-2 font-medium text-foreground">
              <DollarSign className="w-4 h-4" />
              <span>{service.price.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};


export const BookingServices = ({ services, onServiceSelect }: { services: Service[], onServiceSelect: (service: Service) => void }) => {

    const servicesByCategory = useMemo(() => {
        if (!services) return {};
        return services
            .filter(s => !s.isPrivate && s.type !== 'addon')
            .reduce((acc, service) => {
                const category = service.category || 'Other Services';
                if (!acc[category]) {
                    acc[category] = [];
                }
                acc[category].push(service);
                return acc;
            }, {} as Record<string, Service[]>);
    }, [services]);


  return (
    <section className="space-y-12">
        <h2 className="text-3xl font-bold text-center">Our Services</h2>
      {Object.keys(servicesByCategory).sort().map(category => (
        <div key={category}>
            <h3 className="text-2xl font-bold mb-4">{category}</h3>
             <Carousel
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                className="w-full"
                >
                <CarouselContent>
                    {servicesByCategory[category].map((service) => (
                    <CarouselItem key={service.id} className="basis-full sm:basis-1/2 md:basis-1/3">
                        <ServiceCard service={service} onSelect={() => onServiceSelect(service)} />
                    </CarouselItem>
                    ))}
                </CarouselContent>
                <CarouselPrevious className="hidden sm:flex" />
                <CarouselNext className="hidden sm:flex" />
            </Carousel>
        </div>
      ))}
    </section>
  );
};
