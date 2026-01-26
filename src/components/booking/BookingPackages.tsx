
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Repeat } from 'lucide-react';
import { type Package, type Service } from '@/lib/data';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ScrollArea, ScrollBar } from '../ui/scroll-area';

const PackagePurchaseCard = ({ pack, service, onPurchase }: { pack: Package, service?: Service, onPurchase: () => void }) => {
    return (
        <Card className="flex flex-col h-full">
            <CardHeader>
                 <div className="flex items-center gap-3">
                    <div className="p-3 bg-teal-500/10 rounded-lg">
                        <Repeat className="w-6 h-6 text-teal-500" />
                    </div>
                    <div>
                        <CardTitle>{pack.name}</CardTitle>
                        <CardDescription>${pack.price}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">Purchase a bundle of services at a discounted rate.</p>
                 <div className="text-sm text-muted-foreground pt-2 border-t mt-1">
                    <p className="font-semibold text-foreground mb-2">Includes:</p>
                    <p>{pack.sessions}x {service?.name || 'Service'}</p>
                </div>
                 <div className="text-xs text-muted-foreground pt-2 border-t mt-1">
                    <p>Expires in {pack.expiresInMonths} months.</p>
                </div>
            </CardContent>
             <CardFooter>
                <Button className="w-full" onClick={onPurchase}>Purchase Package</Button>
            </CardFooter>
        </Card>
    );
};

export const BookingPackages = ({ packages, services, onPurchase }: { packages: Package[], services: Service[], onPurchase: (pack: Package) => void }) => {
    if (!packages || packages.length === 0) return null;

    const publicPackages = packages.filter(p => !p.isPrivate);

    if (publicPackages.length === 0) return null;

    return (
        <section id="packages" className="space-y-6 scroll-mt-20">
            <h2 className="text-3xl font-bold text-center">Service Packages</h2>
             <ScrollArea>
                <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
                    <CarouselContent>
                        {publicPackages.map((pack) => {
                            const service = services.find(s => s.id === pack.serviceId);
                            return (
                                <CarouselItem key={pack.id} className="basis-4/5 sm:basis-1/2 md:basis-1/2">
                                <div className="p-1 h-full">
                                        <PackagePurchaseCard pack={pack} service={service} onPurchase={() => onPurchase(pack)} />
                                    </div>
                                </CarouselItem>
                            );
                        })}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex" />
                    <CarouselNext className="hidden sm:flex" />
                </Carousel>
                <ScrollBar orientation="horizontal" className="md:hidden" />
            </ScrollArea>
        </section>
    );
};
