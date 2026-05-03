'use client';

/**
 * FloatingInventoryFAB
 *
 * A floating action button fixed to the bottom-right corner of the viewport.
 * Opens a radial / stacked menu of inventory type options when clicked.
 *
 * Usage — drop into the inventory page instead of the header dropdown:
 *
 *   <FloatingInventoryFAB
 *     onAddProfessional={() => handleOpenAddProductDialog('professional')}
 *     onAddRetail={() => handleOpenAddProductDialog('retail')}
 *     onAddEquipment={() => setIsAddEquipmentDialogOpen(true)}
 *     onAddOverhead={() => setIsAddOverheadDialogOpen(true)}
 *     onAddRefreshment={() => setIsAddRefreshmentDialogOpen(true)}
 *   />
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, X, Package, ShoppingCart, Hammer, Recycle, Coffee,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MENU_ITEMS = [
  {
    id: 'professional',
    label: 'Professional',
    sub: 'Backbar / formula',
    icon: Package,
    color: 'bg-violet-600 hover:bg-violet-500',
    ring: 'ring-violet-200',
  },
  {
    id: 'retail',
    label: 'Retail',
    sub: 'Client-sale product',
    icon: ShoppingCart,
    color: 'bg-blue-600 hover:bg-blue-500',
    ring: 'ring-blue-200',
  },
  {
    id: 'equipment',
    label: 'Equipment',
    sub: 'Tools & hardware',
    icon: Hammer,
    color: 'bg-amber-500 hover:bg-amber-400',
    ring: 'ring-amber-200',
  },
  {
    id: 'overhead',
    label: 'Overhead Supply',
    sub: 'Consumables',
    icon: Recycle,
    color: 'bg-emerald-600 hover:bg-emerald-500',
    ring: 'ring-emerald-200',
  },
  {
    id: 'refreshment',
    label: 'Concierge Amenity',
    sub: 'Hospitality items',
    icon: Coffee,
    color: 'bg-rose-500 hover:bg-rose-400',
    ring: 'ring-rose-200',
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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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
    // Small delay so the FAB closes before the dialog opens (prevents focus
    // competition between two Radix portals)
    setTimeout(() => handlers[id](), 80);
  };

  return (
    // Positioned relative to viewport, above any sheet/dialog z-layers but
    // below modals (z-40 < z-50 used by Radix dialogs)
    <div
      ref={ref}
      className="fixed bottom-6 right-6 z-40 flex flex-col-reverse items-end gap-3"
      aria-label="Add inventory item"
    >
      {/* ── FAB trigger ── */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        whileTap={{ scale: 0.92 }}
        className={cn(
          'w-16 h-16 rounded-2xl shadow-2xl shadow-primary/30 flex items-center justify-center transition-colors duration-200',
          open
            ? 'bg-slate-900 text-white rotate-45'
            : 'bg-primary text-primary-foreground',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
        )}
        style={{ transition: 'transform 200ms, background-color 200ms' }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-center justify-center"
        >
          <Plus className="w-7 h-7" />
        </motion.span>
      </motion.button>

      {/* ── Menu items (stacked above FAB) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: 8,  scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex flex-col-reverse gap-2 items-end"
          >
            {MENU_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ delay: i * 0.04, duration: 0.15 }}
                  onClick={() => handleSelect(item.id)}
                  className={cn(
                    'flex items-center gap-3 h-13 pl-3 pr-4 rounded-2xl shadow-lg',
                    'text-white transition-all active:scale-95',
                    'focus-visible:outline-none focus-visible:ring-4',
                    item.color,
                    item.ring,
                  )}
                >
                  {/* Icon bubble */}
                  <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  {/* Labels */}
                  <span className="flex flex-col items-start leading-none">
                    <span className="text-[11px] font-black uppercase tracking-widest">{item.label}</span>
                    <span className="text-[9px] font-bold opacity-70 mt-0.5 uppercase tracking-wide">{item.sub}</span>
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop scrim (subtle) */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 -z-10 bg-black/10 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}