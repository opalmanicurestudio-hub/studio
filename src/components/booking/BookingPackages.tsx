'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Repeat, CheckCircle, Clock, Sparkles } from 'lucide-react';
import { type Package, type Service } from '@/lib/data';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const PackagePurchaseCard = ({ pack, service, onPurchase }: { pack: Package, service?: Service, onPurchase: () => void }) => {
    return (
        <motion.div whileHover={{ y: -10 }} className="h-full">
            <Card className="flex flex-col h-full rounded-[2.5rem] border-2 border-teal-500/20 bg-card overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-teal-500/10 transition-all duration-500">
                <CardHeader className="p-8 pb-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Repeat className="w-24 h-24 text-teal-500" />
                    </div>
                    <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20 mb-4">
                            <Sparkles className="w-3 h-3 text-teal-600" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-teal-700">Studio Bundle</span>
                        </div>
                        <CardTitle className="text-3xl font-black uppercase tracking-tighter leading-none">{pack.name}</CardTitle>
                        <div className="flex items-baseline gap-1 pt-2">
                            <span className="text-2xl font-black text-teal-600">${pack.price}</span>
                            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Total</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-6 px-8">
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed opacity-80">Optimize your investment with a pre-paid bundle of sessions.</p>
                    <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-teal-700 tracking-widest flex items-center gap-2">
                            <CheckCircle className="w-3 h-3" />
                            Inclusions
                        </p>
                        <div className="p-4 bg-muted/30 rounded-2xl border border-border/50">
                            <p className="text-sm font-bold text-slate-800">{pack.sessions} Sessions</p>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">{service?.name || 'Service'}</p>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Expires in {pack.expiresInMonths} months</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-8 pt-0">
                    <Button 
                        onClick={onPurchase}
                        className="w-full h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-teal-500/20 transition-all active:scale-95"
                    >
                        Purchase Bundle
                    </Button>
                </CardFooter>
            </Card>
        </motion.div>
    );
};

export const BookingPackages = ({ packages, services, onPurchase }: { packages: Package[], services: Service[], onPurchase: (pack: Package) => void }) => {
    if (!packages || packages.length === 0) return null;

    const publicPackages = packages.filter(p => !p.isPrivate);

    if (publicPackages.length === 0) return null;

    return (
        <section id="packages" className="space-y-12 scroll-mt-24">
            <div className="text-center space-y-4">
                <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">Bundles</h2>
                <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">Secure your series of transformations</p>
            </div>

            <ScrollArea className="w-full pb-8">
                <Carousel opts={{ align: "start", dragFree: true }} className="w-full px-4">
                    <CarouselContent className="-ml-6">
                        {publicPackages.map((pack) => {
                            const service = services.find(s => s.id === pack.serviceId);
                            return (
                                <CarouselItem key={pack.id} className="pl-6 basis-[85%] sm:basis-1/2 md:basis-1/2 lg:basis-1/3">
                                    <PackagePurchaseCard pack={pack} service={service} onPurchase={() => onPurchase(pack)} />
                                </CarouselItem>
                            );
                        })}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex -left-4" />
                    <CarouselNext className="hidden sm:flex -right-4" />
                </Carousel>
                <ScrollBar orientation="horizontal" className="md:hidden" />
            </ScrollArea>
        </section>
    );
};
