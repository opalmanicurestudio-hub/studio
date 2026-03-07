'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Staff, Tenant } from '@/lib/data';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Instagram, Star, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

const ImageWrapper = ({ src, alt, fill, className }: any) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn(className, fill ? "absolute inset-0 w-full h-full" : "")} />
);

export const BookingTeam = ({ tenantId, staff, tenant }: { tenantId: string; staff: Staff[]; tenant: Tenant | null }) => {
  const visibleStaff = useMemo(() => {
    if (!staff) return [];
    return staff.filter(member => member.showOnPublicPage !== false);
  }, [staff]);

  if (visibleStaff.length === 0 || tenant?.bookingPageSettings?.showTeam === false) {
    return null;
  }

  return (
    <section id="team" className="space-y-12 scroll-mt-24">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">The Pro Ledger</span>
        </div>
        <h2 className="text-4xl md:text-7xl font-black tracking-tighter uppercase text-slate-900 leading-none">
            {tenant?.bookingPageSettings?.teamSectionTitle || 'The Experts'}
        </h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px] max-w-sm mx-auto opacity-60">
            Dedicated technicians committed to technical precision and aesthetic care.
        </p>
      </div>

      <ScrollArea className="w-full pb-10">
        <div className="flex space-x-8 px-4 py-4">
          {visibleStaff.map((member, idx) => (
            <motion.div 
                key={member.id}
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ 
                    delay: idx * 0.1,
                    duration: 0.8,
                    ease: [0.16, 1, 0.3, 1]
                }}
                viewport={{ once: true, margin: "-50px" }}
                whileHover={{ y: -12 }}
                className="w-[280px] md:w-[320px] shrink-0"
            >
                <div className="block h-full">
                    <Card className="border-4 border-white bg-white transition-all duration-500 shadow-2xl rounded-[3rem] overflow-hidden flex flex-col h-full ring-1 ring-border/50">
                        <div className="relative aspect-[4/5] w-full grayscale contrast-125 brightness-90 overflow-hidden group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-700">
                            <ImageWrapper
                                src={member.avatarUrl || `https://picsum.photos/seed/staff${member.id}/600/800`}
                                alt={member.name || 'Staff'}
                                fill
                                className="object-cover transition-transform duration-1000 group-hover:scale-110"
                                data-ai-hint="person portrait"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-80" />
                            
                            <div className="absolute bottom-8 left-8 right-8 flex flex-col gap-2 text-white">
                                <div className="space-y-1">
                                    <p className="font-black text-2xl md:text-3xl uppercase tracking-tighter leading-[0.85]">
                                        {(member.name || 'Staff').split(' ')[0]}<br/>
                                        {(member.name || '').split(' ').slice(1).join(' ') || ''}
                                    </p>
                                    <div className="flex items-center gap-2 pt-2">
                                        <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase tracking-[0.2em] h-5 px-2.5">Certified</Badge>
                                        <div className="flex items-center gap-1 text-[9px] font-black text-white/60 uppercase tracking-widest">
                                            <Star className="w-2.5 h-2.5 fill-current text-amber-400" /> 
                                            <span>4.9 Mastery</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <CardContent className="p-8 flex-1 flex flex-col justify-between gap-6 text-left">
                            <div className="relative">
                                <p className="text-xs text-slate-600 font-medium leading-relaxed line-clamp-4 italic opacity-80 pl-4 border-l-2 border-primary/20">
                                    "{member.bio || 'Dedicated to technical precision and curated aesthetic care for the modern guest.'}"
                                </p>
                            </div>
                            <div className="flex items-center justify-between pt-6 border-t-2 border-dashed border-border/50">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 tracking-widest">Focus</p>
                                    <span className="text-[10px] font-black uppercase text-primary tracking-[0.15em]">
                                        {member.specialties?.[0] || 'Technical Expert'}
                                    </span>
                                </div>
                                <div className="p-2.5 bg-muted/50 rounded-xl shadow-inner text-muted-foreground/40">
                                    <Instagram className="w-4 h-4" />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </motion.div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="hidden" />
      </ScrollArea>
    </section>
  );
};