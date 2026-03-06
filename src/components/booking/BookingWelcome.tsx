
'use client';

import { Tenant } from '@/lib/data';
import { motion } from 'framer-motion';
import { Sparkles, Star, ShieldCheck } from 'lucide-react';

export const BookingWelcome = ({ tenant }: { tenant: Tenant | null }) => {
  return (
    <section id="welcome" className="relative py-10 md:py-20 text-center flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
        viewport={{ once: true }}
        className="max-w-3xl space-y-8"
      >
        <div className="inline-flex items-center gap-3 bg-primary/5 px-6 py-2 rounded-full border-2 border-primary/10 shadow-sm mb-4">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Now Booking for {format(new Date(), 'MMMM')}</span>
        </div>
        
        <h2 className="text-5xl md:text-8xl font-black tracking-tighter text-slate-900 leading-[0.9] uppercase">
            Your journey to <span className="text-primary italic font-serif lowercase tracking-normal">clarity</span> starts here.
        </h2>
        
        <p className="text-lg md:text-xl text-muted-foreground font-medium leading-relaxed max-w-2xl mx-auto italic">
          "Expertise meets intuition. We are thrilled to welcome you to {tenant?.name || 'our studio'}, where every detail is designed for your ultimate transformation."
        </p>

        <div className="flex flex-wrap justify-center gap-8 md:gap-16 pt-8">
            <div className="flex flex-col items-center gap-2">
                <Star className="w-6 h-6 text-primary/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Certified Experts</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-primary/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Safe & Secure</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <Sparkles className="w-6 h-6 text-primary/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">High End Care</span>
            </div>
        </div>
      </motion.div>
    </section>
  );
};

const format = (date: Date, fmt: string) => {
    return date.toLocaleString('en-US', { month: 'long' });
}
