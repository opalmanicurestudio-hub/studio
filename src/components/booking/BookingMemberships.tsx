
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, CheckCircle, Percent, Sparkles, Star } from 'lucide-react';
import { type Membership, type Tenant } from '@/lib/data';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const MembershipPurchaseCard = ({ membership, onPurchase }: { membership: Membership, onPurchase: () => void }) => {
    return (
        <motion.div whileHover={{ y: -10 }} className="h-full">
            <Card className="flex flex-col h-full rounded-[2.5rem] border-2 border-indigo-500/20 bg-card overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-500">
                <CardHeader className="p-8 pb-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Award className="w-24 h-24 text-indigo-500" />
                    </div>
                    <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20 mb-4">
                            <Sparkles className="w-3 h-3 text-indigo-600" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Studio Pass</span>
                        </div>
                        <CardTitle className="text-3xl font-black uppercase tracking-tighter leading-none">{membership.name}</CardTitle>
                        <div className="flex items-baseline gap-1 pt-2">
                            <span className="text-2xl font-black text-indigo-600">${membership.price}</span>
                            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">/ {membership.interval === 'monthly' ? 'mo' : 'yr'}</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-6 px-8">
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed opacity-80">{membership.description}</p>
                    <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-indigo-700 tracking-widest flex items-center gap-2">
                            <Star className="w-3 h-3 fill-current" />
                            Benefits
                        </p>
                        <ul className="space-y-3">
                            {(membership.includedServices || []).map(s => (
                                <li key={s.id} className="flex items-center gap-3">
                                    <div className="p-1 bg-green-500/10 rounded-full text-green-600">
                                        <CheckCircle className="w-3 h-3" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{s.quantity}x {s.name}</span>
                                </li>
                            ))}
                            {membership.retailDiscount && (
                                    <li className="flex items-center gap-3">
                                    <div className="p-1 bg-blue-500/10 rounded-full text-blue-600">
                                        <Percent className="w-3 h-3" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{membership.retailDiscount}% Priority Discount</span>
                                </li>
                            )}
                        </ul>
                    </div>
                </CardContent>
                <CardFooter className="p-8 pt-0">
                    <Button 
                        onClick={onPurchase}
                        className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-indigo-500/20 transition-all active:scale-95"
                    >
                        Apply for Membership
                    </Button>
                </CardFooter>
            </Card>
        </motion.div>
    );
};

export const BookingMemberships = ({ memberships, onPurchase, tenant }: { memberships: Membership[], onPurchase: (membership: Membership) => void, tenant?: Tenant | null }) => {
    if (!memberships || memberships.length === 0 || tenant?.bookingPageSettings?.showMemberships === false) return null;

    const publicMemberships = memberships.filter(m => !m.isPrivate);

    if(publicMemberships.length === 0) return null;

    return (
        <section id="memberships" className="space-y-12 scroll-mt-24">
            <div className="text-center space-y-4">
                <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">{tenant?.bookingPageSettings?.membershipsSectionTitle || 'Access'}</h2>
                <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">Elevate your experience with exclusive tiers</p>
            </div>

            <ScrollArea className="w-full pb-8">
                <Carousel opts={{ align: "start", dragFree: true }} className="w-full px-4">
                    <CarouselContent className="-ml-6">
                        {publicMemberships.map((membership) => (
                            <CarouselItem key={membership.id} className="pl-6 basis-[85%] sm:basis-1/2 md:basis-1/2 lg:basis-1/3">
                                <MembershipPurchaseCard membership={membership} onPurchase={() => onPurchase(membership)} />
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex -left-4" />
                    <CarouselNext className="hidden sm:flex -right-4" />
                </Carousel>
                <ScrollBar orientation="horizontal" className="md:hidden" />
            </ScrollArea>
        </section>
    );
};
