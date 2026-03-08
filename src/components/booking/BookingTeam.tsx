
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Staff, type Tenant } from '@/lib/data';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Instagram, Star, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

export const BookingTeam = ({ staff, tenant }: { tenantId: string; staff: Staff[]; tenant: Tenant | null }) => {
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
                        <div className="relative aspect-[4/5] w-full overflow-hidden">
                            <img
                                src={member.avatarUrl || `https://picsum.photos/seed/staff${member.id}/600/800`}
                                alt={member.name || 'Staff'}
                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                            />
                        </div>
                        <CardContent className="p-8 flex-1 flex flex-col justify-between gap-6 text-left">
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <p className="font-black text-2xl md:text-3xl uppercase tracking-tighter text-slate-900 leading-none">
                                        {(member.name || 'Staff').split(' ')[0]}<br/>
                                        {(member.name || '').split(' ').slice(1).join(' ') || ''}
                                    </p>
                                    <div className="flex items-center gap-2 pt-2">
                                        <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase tracking-[0.2em] h-5 px-2.5">Certified</Badge>
                                    </div>
                                </div>
                                <div className="relative">
                                    <p className="text-xs text-slate-600 font-medium leading-relaxed line-clamp-4 italic opacity-80 pl-4 border-l-2 border-primary/20">
                                        "{member.bio || 'Dedicated to technical precision and curated aesthetic care for the modern guest.'}"
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-6 border-t-2 border-dashed border-border/50">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 tracking-widest">Expertise</p>
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
