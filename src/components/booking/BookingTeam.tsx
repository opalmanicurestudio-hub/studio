
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Staff } from '@/lib/data';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Instagram, Star, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export const BookingTeam = ({ tenantId, staff }: { tenantId: string; staff: Staff[] }) => {
  if (!staff || staff.length === 0) {
    return null;
  }

  const getInitials = (name?: string | null) => {
    if (!name || name.length < 2) return '??';
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <section id="team" className="space-y-12 scroll-mt-24">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">The Experts</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">A team dedicated to your vision</p>
      </div>

      <ScrollArea className="w-full pb-8">
        <div className="flex space-x-8 px-4">
          {staff.map((member, idx) => (
            <motion.div 
                key={member.id}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="w-[280px] md:w-[320px] shrink-0"
            >
                <Link href={`/book/${tenantId}/${member.id}`} className="block group h-full">
                    <Card className="border-2 border-border/50 bg-card hover:border-primary/50 transition-all duration-500 shadow-sm hover:shadow-2xl hover:shadow-primary/10 rounded-[2.5rem] overflow-hidden flex flex-col h-full">
                        <div className="relative aspect-[4/5] w-full grayscale group-hover:grayscale-0 transition-all duration-700 overflow-hidden">
                            <Image
                                src={member.avatarUrl || `https://picsum.photos/seed/staff${member.id}/600/800`}
                                alt={member.name || 'Staff'}
                                fill
                                className="object-cover transition-transform duration-700 group-hover:scale-105"
                                data-ai-hint="person portrait"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                            
                            <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end text-white">
                                <div className="space-y-1">
                                    <p className="font-black text-xl md:text-2xl uppercase tracking-tighter leading-none">{member.name?.split(' ')[0]}<br/>{member.name?.split(' ')[1]}</p>
                                    <div className="flex items-center gap-1 text-[10px] font-black text-primary-foreground/80 uppercase tracking-widest">
                                        <Star className="w-3 h-3 fill-current text-primary" /> 
                                        <span>4.9 Mastery</span>
                                    </div>
                                </div>
                                <div className="p-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
                                    <ArrowRight className="w-5 h-5 text-white transition-transform group-hover:translate-x-1" />
                                </div>
                            </div>
                        </div>
                        <CardContent className="p-6 flex-1 flex flex-col justify-between gap-4">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest leading-relaxed line-clamp-3 italic opacity-80">
                                "{member.bio || 'Dedicated to transforming your personal style with precision and care.'}"
                            </p>
                            <div className="flex items-center justify-between pt-4 border-t border-dashed">
                                <span className="text-[10px] font-black uppercase text-primary tracking-widest">
                                    {member.specialties?.[0] || 'Professional'}
                                </span>
                                <Instagram className="w-4 h-4 text-muted-foreground hover:text-primary transition-colors" />
                            </div>
                        </CardContent>
                    </Card>
                </Link>
            </motion.div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="hidden" />
      </ScrollArea>
    </section>
  );
};

const Image = ({ src, alt, fill, className }: any) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn(className, fill ? "absolute inset-0 w-full h-full" : "")} />
);
