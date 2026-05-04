'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Package, ShoppingCart, Hammer, Recycle, Coffee } from 'lucide-react';
import { cn } from '@/lib/utils';

const MENU_ITEMS = [
  {
    id: 'professional',
    label: 'Professional',
    sub: 'Backbar / formula',
    icon: Package,
    bg: 'bg-violet-600 hover:bg-violet-500',
    shadow: 'shadow-violet-500/25',
  },
  {
    id: 'retail',
    label: 'Retail',
    sub: 'Client-sale product',
    icon: ShoppingCart,
    bg: 'bg-blue-600 hover:bg-blue-500',
    shadow: 'shadow-blue-500/25',
  },
  {
    id: 'equipment',
    label: 'Equipment',
    sub: 'Tools & hardware',
    icon: Hammer,
    bg: 'bg-amber-500 hover:bg-amber-400',
    shadow: 'shadow-amber-500/25',
  },
  {
    id: 'overhead',
    label: 'Overhead Supply',
    sub: 'Consumables',
    icon: Recycle,
    bg: 'bg-emerald-600 hover:bg-emerald-500',
    shadow: 'shadow-emerald-500/25',
  },
  {
    id: 'refreshment',
    label: 'Concierge Amenity',
    sub: 'Hospitality items',
    icon: Coffee,
    bg: 'bg-rose-500 hover:bg-rose-400',
    shadow: 'shadow-rose-500/25',
  },
] as const;

type ItemId = (typeof MENU_ITEMS)[number]['id'];

type Props = {
  onAddProfessional: () => void;
  onAddRetail: () => void;
  onAddEquipment: () => void;
  onAddOverhead: () => void;
  onAddRefreshment: () => void;
};

export function FloatingInventoryFAB({
  onAddProfessional,
  onAddRetail,
  onAddEquipment,
  onAddOverhead,
  onAddRefreshment,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const handlers: Record<ItemId, () => void> = {
    professional: onAddProfessional,
    retail:       onAddRetail,
    equipment:    onAddEquipment,
    overhead:     onAddOverhead,
    refreshment:  onAddRefreshment,
  };

  const handleSelect = (id: ItemId) => {
    setOpen(false);
    setTimeout(() => handlers[id](), 80);
  };

  return (
    <div
      ref={ref}
      className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-end gap-4"
    >
      {/* ── FAB trigger button ── */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'w-16 h-16 md:w-[4.5rem] md:h-[4.5rem]',
          'rounded-2xl md:rounded-[1.25rem]',
          'flex items-center justify-center shrink-0',
          'shadow-2xl shadow-primary/30',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40',
          'transition-colors duration-200',
          open ? 'bg-slate-900 text-white' : 'bg-primary text-primary-foreground',
        )}
        aria-expanded={open}
        aria-label="Add inventory item"
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="flex items-center justify-center"
        >
          <Plus className="w-7 h-7 md:w-8 md:h-8" strokeWidth={2.5} />
        </motion.span>
      </motion.button>

      {/* ── Stacked menu items ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{   opacity: 0, y: 8,   scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col-reverse gap-3 items-end pb-1"
          >
            {MENU_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{   opacity: 0, x: 16 }}
                  transition={{ delay: i * 0.045, duration: 0.16, ease: 'easeOut' }}
                  onClick={() => handleSelect(item.id)}
                  className={cn(
                    // Height — matches the app's standard h-14 button, h-16 on desktop
                    'h-14 md:h-16',
                    // Horizontal padding — generous like the app's cards
                    'pl-3 pr-6 md:pl-4 md:pr-8',
                    // Width — never wraps text, desktop gets more room
                    'min-w-[200px] md:min-w-[256px]',
                    // Shape — app uses rounded-2xl throughout
                    'rounded-2xl',
                    item.bg,
                    'text-white',
                    'shadow-xl', item.shadow,
                    'active:scale-[0.97] transition-all duration-100',
                    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30',
                    'flex items-center gap-3 md:gap-4',
                  )}
                >
                  {/* Icon container — proportional, does not dominate */}
                  <span className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 md:w-[18px] md:h-[18px]" strokeWidth={2} />
                  </span>

                  {/* Text — matches app's font-black uppercase tracking-widest pattern */}
                  <span className="flex flex-col items-start leading-none gap-[3px] min-w-0">
                    <span className="text-xs md:text-[13px] font-black uppercase tracking-widest truncate">
                      {item.label}
                    </span>
                    <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest opacity-70">
                      {item.sub}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Backdrop scrim ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{   opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 -z-10 bg-black/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}