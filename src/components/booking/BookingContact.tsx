
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Phone, Mail, MapPin, Navigation, MessageSquare, Clock } from 'lucide-react';
import { Tenant } from '@/lib/data';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const BookingContact = ({ tenant }: { tenant: Tenant | null }) => {
  return (
    <section id="contact" className="space-y-12 scroll-mt-24">
      <div className="space-y-4">
        <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">{tenant?.bookingPageSettings?.contactSectionTitle || 'Connect'}</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px]">Visit us in person</p>
      </div>

      <div className="relative">
        <div className="grid md:grid-cols-5 gap-8 items-stretch">
            <motion.div 
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="md:col-span-2 space-y-6"
            >
                <Card className="rounded-[2.5rem] border-2 shadow-2xl overflow-hidden bg-white/80 backdrop-blur-xl">
                    <CardContent className="p-8 space-y-8">
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase text-primary tracking-[0.2em]">Our Home</p>
                            <h3 className="text-2xl font-black uppercase tracking-tighter">{tenant?.name || 'Studio'}</h3>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="p-2.5 bg-primary/10 rounded-xl text-primary mt-1">
                                    <MapPin className="w-4 h-4" />
                                </div>
                                <div className="text-sm font-medium text-slate-600 leading-relaxed">
                                    123 Beauty Lane<br />
                                    Suite 100<br />
                                    Los Angeles, CA 90028
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                                    <Phone className="w-4 h-4" />
                                </div>
                                <a href={`tel:${tenant?.twilioPhoneNumber || '555-123-4567'}`} className="text-sm font-black uppercase tracking-tight hover:text-primary transition-colors">
                                    {tenant?.twilioPhoneNumber || '(555) 123-4567'}
                                </a>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                                    <Mail className="w-4 h-4" />
                                </div>
                                <a href="mailto:hello@clarityflow.app" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">
                                    hello@clarityflow.app
                                </a>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-dashed">
                            <Button className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20">
                                <Navigation className="w-3.5 h-3.5 mr-2" />
                                Get Directions
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            <motion.div 
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="md:col-span-3 relative min-h-[400px] rounded-[3rem] overflow-hidden border-2 shadow-inner"
            >
                <Image 
                    src="https://images.unsplash.com/photo-1569336415962-a42945097388?q=80&w=1287&auto=format&fit=crop"
                    alt="Map showing salon location"
                    fill
                    className="object-cover grayscale contrast-125 brightness-90 hover:grayscale-0 transition-all duration-1000"
                    data-ai-hint="map location"
                />
                <div className="absolute inset-0 bg-primary/10 pointer-events-none mix-blend-overlay" />
            </motion.div>
        </div>
      </div>
    </section>
  );
};

const Button = ({ children, className, variant, asChild, ...props }: any) => (
    <button className={cn("inline-flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-95", className)} {...props}>
        {children}
    </button>
);
