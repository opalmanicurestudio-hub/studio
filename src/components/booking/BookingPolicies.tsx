
'use client';

import { ShieldCheck, Clock, Ban, AlertCircle } from 'lucide-react';
import { Tenant } from '@/lib/data';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const BookingPolicies = ({ tenant }: { tenant: Tenant | null }) => {
  if (!tenant) return null;
  const hasPolicies = tenant.cancellationPolicy || tenant.lateArrivalPolicy || tenant.noShowPolicy;

  if (!hasPolicies) return null;

  const policyItems = [
    {
      title: 'Cancellations',
      text: tenant.cancellationPolicy,
      icon: <Ban className="w-5 h-5" />,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/5',
    },
    {
      title: 'Late Arrivals',
      text: tenant.lateArrivalPolicy,
      icon: <Clock className="w-5 h-5" />,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/5',
    },
    {
      title: 'No-Show Policy',
      text: tenant.noShowPolicy,
      icon: <AlertCircle className="w-5 h-5" />,
      color: 'text-destructive',
      bgColor: 'bg-destructive/5',
    },
  ].filter(item => item.text);

  return (
    <section id="policies" className="space-y-12 scroll-mt-24">
      <div className="space-y-4">
        <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">{tenant?.bookingPageSettings?.policiesSectionTitle || 'The Standard'}</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px]">Studio guidelines & expectations</p>
      </div>

      <div className="grid gap-6">
        {policyItems.map((item, idx) => (
          <motion.div 
            key={item.title}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            viewport={{ once: true }}
            className="group flex flex-col md:flex-row md:items-center gap-6 p-8 rounded-[2rem] border-2 border-border/50 bg-card hover:border-primary/30 transition-all"
          >
            <div className={cn("p-4 rounded-2xl shrink-0 self-start md:self-center shadow-inner", item.bgColor, item.color)}>
              {item.icon}
            </div>
            <div className="space-y-2">
              <h4 className="font-black uppercase tracking-tight text-sm text-slate-900">{item.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed font-medium">
                {item.text}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
};
