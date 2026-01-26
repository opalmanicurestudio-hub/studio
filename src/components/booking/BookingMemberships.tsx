
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, CheckCircle, Percent } from 'lucide-react';
import { type Membership, type Service, type InventoryItem } from '@/lib/data';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ScrollArea, ScrollBar } from '../ui/scroll-area';

const MembershipPurchaseCard = ({ membership, onPurchase }: { membership: Membership, onPurchase: () => void }) => {
    return (
        <Card className="flex flex-col h-full">
            <CardHeader>
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-500/10 rounded-lg">
                        <Award className="w-6 h-6 text-indigo-500" />
                    </div>
                    <div>
                        <CardTitle>{membership.name}</CardTitle>
                        <CardDescription>${membership.price}/{membership.interval}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">{membership.description}</p>
                <div className="text-sm text-muted-foreground pt-2 border-t mt-1">
                    <p className="font-semibold text-foreground mb-2">Perks:</p>
                    <ul className="space-y-2">
                        {(membership.includedServices || []).map(s => (
                            <li key={s.id} className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <span className="truncate">1x {s.name}</span>
                            </li>
                        ))}
                        {(membership.includedAddOns || []).map(s => (
                            <li key={s.id} className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <span className="truncate">1x {s.name}</span>
                            </li>
                        ))}
                        {(membership.includedProducts || []).map(p => (
                            <li key={p.id} className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <span className="truncate">1x {p.name}</span>
                            </li>
                        ))}
                        {membership.retailDiscount && (
                                <li className="flex items-center gap-2">
                                <Percent className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                <span className="truncate">{membership.retailDiscount}% off retail</span>
                            </li>
                        )}
                    </ul>
                </div>
            </CardContent>
            <CardFooter>
                <Button className="w-full" onClick={onPurchase}>Purchase Membership</Button>
            </CardFooter>
        </Card>
    );
};

export const BookingMemberships = ({ memberships, onPurchase }: { memberships: Membership[], onPurchase: (membership: Membership) => void }) => {
    if (!memberships || memberships.length === 0) return null;

    const publicMemberships = memberships.filter(m => !m.isPrivate);

    if(publicMemberships.length === 0) return null;

    return (
        <section id="memberships" className="space-y-6 scroll-mt-20">
            <h2 className="text-3xl font-bold text-center">Memberships</h2>
            <ScrollArea>
                <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
                    <CarouselContent>
                        {publicMemberships.map((membership) => (
                            <CarouselItem key={membership.id} className="basis-4/5 sm:basis-1/2 md:basis-1/2">
                                <div className="p-1 h-full">
                                    <MembershipPurchaseCard membership={membership} onPurchase={() => onPurchase(membership)} />
                                </div>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex" />
                    <CarouselNext className="hidden sm:flex" />
                </Carousel>
                 <ScrollBar orientation="horizontal" className="md:hidden" />
            </ScrollArea>
        </section>
    );
};

