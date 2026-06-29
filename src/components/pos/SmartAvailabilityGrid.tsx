'use client';

/**
 * SmartAvailabilityGrid — v2
 *
 * v2 — BUG FIX: the 7-day date strip in DateNavBar was hardcoded to always
 * build its window from `today`, completely ignoring the `date` prop except
 * to decide which chip (if any) got the "selected" highlight. Jumping the
 * date forward via QuickBookForm's date-jump control (+1 wk / +1 mo / direct
 * picker) moved the actual booking date just fine, but this strip kept
 * showing today-through-today+6 regardless — so the selected date routinely
 * fell outside the visible window entirely and nothing highlighted. Now the
 * window is built from (and centered on) the `date` prop, so the strip
 * always follows wherever the booking has been navigated to. A small dot
 * under today's chip distinguishes it when it happens to be in view.
 *
 * v1 — Replaces the raw date/time inputs in QuickBookForm step 2.
 * Uses useSmartAvailability to show only slots where the full service fits.
 * Surfaces add-on upsells that fit in the remaining gap after the selected slot.
 *
 * Usage:
 *   import { SmartAvailabilityGrid } from '@/components/pos/SmartAvailabilityGrid';
 *   import { useSmartAvailability } from '@/hooks/useSmartAvailability';
 *
 *   const { slots, addOnUpsells } = useSmartAvailability({ ... });
 *   <SmartAvailabilityGrid
 *     slots={slots}
 *     addOnUpsells={addOnUpsells}
 *     selectedTime={aptTime}
 *     onSelectTime={setAptTime}
 *     addOnIds={addOnIds}
 *     onToggleAddOn={toggleAddOn}
 *     date={aptDate}
 *     onDateChange={setAptDate}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { format, addDays, parseISO, isValid } from 'date-fns';
import { CheckCircle2, Clock, ChevronLeft, ChevronRight, Sparkles, Plus, Minus } from 'lucide-react';
import type { AvailableSlot, AddOnUpsell } from '@/hooks/useSmartAvailability';

type Props = {
  slots: AvailableSlot[];
  addOnUpsells: AddOnUpsell[];
  selectedTime: string;
  onSelectTime: (time: string, staffId: string) => void;
  addOnIds: string[];
  onToggleAddOn: (serviceId: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Maximum slots to show before a "show more" toggle. Default: 8 */
  maxVisible?: number;
};

function DateNavBar({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (d: string) => void;
}) {
  const todayIso = format(new Date(), 'yyyy-MM-dd');

  // v2 — anchor the window on the actual selected date, not always on
  // today. Falls back to today if `date` is momentarily empty/malformed
  // rather than crashing on an Invalid Date.
  const parsed = date ? parseISO(date) : null;
  const anchor = parsed && isValid(parsed) ? parsed : new Date(todayIso);

  // Centered 7-day strip: 3 days before the selected date, the date itself,
  // and 3 days after — so the selected day stays visible alongside nearby
  // days instead of always being the leftmost (or, per the bug above,
  // potentially off-strip entirely).
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(anchor, i - 3);
    return { iso: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE'), day: format(d, 'd') };
  });

  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">
        Date
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {days.map((d) => {
          const isSelected = date === d.iso;
          const isToday = d.iso === todayIso;
          return (
            <button
              key={d.iso}
              onClick={() => onDateChange(d.iso)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl border-2 text-center shrink-0 transition-all relative',
                isSelected
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-muted text-muted-foreground hover:border-primary/30',
              )}
            >
              <span className="text-[9px] font-black uppercase tracking-wide">{d.label}</span>
              <span className="text-[15px] font-black leading-none">{d.day}</span>
              {isToday && (
                <span className={cn(
                  'absolute bottom-1 w-1 h-1 rounded-full',
                  isSelected ? 'bg-primary' : 'bg-muted-foreground/50',
                )} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SmartAvailabilityGrid({
  slots,
  addOnUpsells,
  selectedTime,
  onSelectTime,
  addOnIds,
  onToggleAddOn,
  date,
  onDateChange,
  maxVisible = 8,
}: Props) {
  const [showAll, setShowAll] = React.useState(false);

  const availableSlots = slots.filter((s) => s.available);
  const visibleSlots = showAll ? availableSlots : availableSlots.slice(0, maxVisible);
  const hasMore = availableSlots.length > maxVisible;

  return (
    <div className="space-y-5">
      {/* Date strip */}
      <DateNavBar date={date} onDateChange={onDateChange} />

      {/* Slot grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Available times
          </p>
          {availableSlots.length > 0 && (
            <p className="text-[9px] font-bold text-muted-foreground">
              {availableSlots.length} open slot{availableSlots.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {availableSlots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-2xl border-2 border-dashed border-muted">
            <Clock className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              No available slots on this day
            </p>
            <p className="text-[10px] text-muted-foreground">Try a different date or provider</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {visibleSlots.map((slot) => {
                const isSelected =
                  selectedTime === slot.time;
                return (
                  <button
                    key={`${slot.staffId}-${slot.time}`}
                    onClick={() => onSelectTime(slot.time, slot.staffId)}
                    className={cn(
                      'flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl border-2 text-center transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-primary/30 hover:bg-muted/30',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[12px] font-black leading-tight',
                        isSelected ? 'text-primary' : 'text-slate-900',
                      )}
                    >
                      {slot.label}
                    </span>
                    <span className="text-[9px] font-bold text-muted-foreground truncate w-full text-center">
                      {slot.staffName.split(' ')[0]}
                    </span>
                    {isSelected && (
                      <CheckCircle2 className="w-3 h-3 text-primary mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {hasMore && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full mt-2 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1"
              >
                {showAll ? (
                  <>Show fewer <ChevronLeft className="w-3 h-3 rotate-90" /></>
                ) : (
                  <>Show {availableSlots.length - maxVisible} more <ChevronRight className="w-3 h-3 rotate-90" /></>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* Add-on upsells — only shown when a time is selected */}
      {selectedTime && addOnUpsells.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Add-ons that fit this slot
            </p>
          </div>
          <div className="space-y-2">
            {addOnUpsells.map((addon) => {
              const isAdded = addOnIds.includes(addon.serviceId);
              return (
                <div
                  key={addon.serviceId}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl border-2 transition-all',
                    isAdded
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-primary/20',
                  )}
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'text-[12px] font-black truncate',
                        isAdded ? 'text-primary' : 'text-slate-900',
                      )}
                    >
                      {addon.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      +{addon.duration}m · ${addon.price.toFixed(0)}
                    </p>
                  </div>
                  <button
                    onClick={() => onToggleAddOn(addon.serviceId)}
                    className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                      isAdded
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary',
                    )}
                  >
                    {isAdded ? (
                      <Minus className="w-3.5 h-3.5" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}