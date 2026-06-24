'use client';

/**
 * GroupBookingPanel
 *
 * Multi-guest group booking builder. Renders inside QuickBookForm step 2
 * when "Group booking" is toggled on.
 *
 * Each guest gets their own service + staff selection. On commit, creates
 * one appointment per guest in a single Firestore batch, linked by a shared
 * groupBookingId.
 *
 * Usage in QuickBookForm step 2:
 *
 *   const [isGroup, setIsGroup] = useState(false);
 *   const [groupGuests, setGroupGuests] = useState<GroupGuest[]>([]);
 *
 *   {isGroup && (
 *     <GroupBookingPanel
 *       primaryClient={selectedClient}
 *       services={services}
 *       staff={staff}
 *       guests={groupGuests}
 *       onChange={setGroupGuests}
 *     />
 *   )}
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { UserPlus, Trash2, ChevronDown, CheckCircle2, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getServicePrice } from '@/lib/data';

export type GroupGuest = {
  id: string;
  name: string;
  phone?: string;
  serviceId: string;
  staffId: string; // 'any' is valid
};

type Props = {
  primaryClient: any | null;
  primaryServiceId?: string;
  primaryStaffId?: string;
  services: any[];
  staff: any[];
  guests: GroupGuest[];
  onChange: (guests: GroupGuest[]) => void;
  maxGuests?: number;
};

const GUEST_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-green-100 text-green-700',
  'bg-rose-100 text-rose-700',
];

function GuestRow({
  guest,
  index,
  services,
  staff,
  onChange,
  onRemove,
}: {
  guest: GroupGuest;
  index: number;
  services: any[];
  staff: any[];
  onChange: (updated: GroupGuest) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const selectedSvc = services.find((s: any) => s.id === guest.serviceId);
  const selectedStaff = staff.find((s: any) => s.id === guest.staffId);
  const price = selectedSvc
    ? getServicePrice(selectedSvc, selectedStaff)
    : 0;

  const colorClass = GUEST_COLORS[index % GUEST_COLORS.length];
  const activeStaff = staff.filter((s: any) => s.active);

  return (
    <div className="rounded-2xl border-2 overflow-hidden">
      {/* Row header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-muted/20 transition-colors text-left"
      >
        <div
          className={cn(
            'w-8 h-8 rounded-xl flex items-center justify-center text-[12px] font-black shrink-0',
            colorClass,
          )}
        >
          {guest.name ? guest.name.charAt(0).toUpperCase() : (index + 1)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-900 truncate">
            {guest.name || `Guest ${index + 1}`}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {selectedSvc?.name || 'No service'}{price > 0 ? ` · $${price.toFixed(0)}` : ''}
            {selectedStaff ? ` · ${selectedStaff.name.split(' ')[0]}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedSvc && (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <ChevronDown
            className={cn(
              'w-4 h-4 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Expanded form */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3 bg-muted/5">
          <Input
            placeholder="Guest name *"
            value={guest.name}
            onChange={(e) => onChange({ ...guest, name: e.target.value })}
            className="h-10 rounded-xl border-2 text-sm"
          />
          <Input
            placeholder="Phone (optional)"
            value={guest.phone || ''}
            onChange={(e) => onChange({ ...guest, phone: e.target.value })}
            className="h-10 rounded-xl border-2 text-sm"
            type="tel"
          />

          {/* Service */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service *</p>
            <div className="rounded-xl border-2 divide-y overflow-hidden max-h-36 overflow-y-auto">
              {services.filter((s: any) => s.type === 'service').map((s: any) => {
                const svcStaff = staff.find((st: any) => st.id === guest.staffId);
                const p = getServicePrice(s, svcStaff);
                return (
                  <button
                    key={s.id}
                    onClick={() => onChange({ ...guest, serviceId: s.id })}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-left text-[12px] transition-colors',
                      guest.serviceId === s.id
                        ? 'bg-primary/5 text-primary font-black'
                        : 'hover:bg-muted/30',
                    )}
                  >
                    <span>{s.name}</span>
                    <span className="font-bold">${p.toFixed(0)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Provider</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => onChange({ ...guest, staffId: 'any' })}
                className={cn(
                  'px-2.5 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase transition-all',
                  guest.staffId === 'any'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-muted text-muted-foreground',
                )}
              >
                Any
              </button>
              {activeStaff.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => onChange({ ...guest, staffId: s.id })}
                  className={cn(
                    'px-2.5 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase transition-all',
                    guest.staffId === s.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-muted text-muted-foreground',
                  )}
                >
                  {s.name.split(' ')[0]}
                  {(s.status === 'idle' || s.status === 'available') && (
                    <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function GroupBookingPanel({
  primaryClient,
  primaryServiceId,
  primaryStaffId,
  services,
  staff,
  guests,
  onChange,
  maxGuests = 6,
}: Props) {
  const addGuest = () => {
    if (guests.length >= maxGuests) return;
    onChange([
      ...guests,
      {
        id: Math.random().toString(36).slice(2),
        name: '',
        serviceId: primaryServiceId || '',
        staffId: 'any',
      },
    ]);
  };

  const updateGuest = (index: number, updated: GroupGuest) => {
    const next = [...guests];
    next[index] = updated;
    onChange(next);
  };

  const removeGuest = (index: number) => {
    onChange(guests.filter((_, i) => i !== index));
  };

  // Total price across all guests
  const totalPrice = guests.reduce((acc, g) => {
    const svc = services.find((s: any) => s.id === g.serviceId);
    const staffMember = staff.find((s: any) => s.id === g.staffId);
    return acc + (svc ? getServicePrice(svc, staffMember) : 0);
  }, 0);

  return (
    <div className="space-y-3">
      {/* Section label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Additional guests — {guests.length}/{maxGuests}
          </p>
        </div>
        {totalPrice > 0 && (
          <p className="text-[11px] font-black text-slate-900">
            Group total: ${totalPrice.toFixed(0)}
          </p>
        )}
      </div>

      {/* Guest rows */}
      <div className="space-y-2">
        {guests.map((guest, i) => (
          <GuestRow
            key={guest.id}
            guest={guest}
            index={i}
            services={services}
            staff={staff}
            onChange={(updated) => updateGuest(i, updated)}
            onRemove={() => removeGuest(i)}
          />
        ))}
      </div>

      {/* Add guest */}
      {guests.length < maxGuests && (
        <button
          onClick={addGuest}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 border-dashed border-muted hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
        >
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            Add another guest
          </p>
        </button>
      )}

      {/* Validation hint */}
      {guests.some((g) => !g.name.trim() || !g.serviceId) && (
        <p className="text-[10px] font-bold text-amber-600">
          All guests need a name and service before booking.
        </p>
      )}
    </div>
  );
}

/** Returns true if all guests in the group have required fields filled */
export function isGroupValid(guests: GroupGuest[]): boolean {
  return guests.every((g) => g.name.trim().length > 0 && g.serviceId.length > 0);
}
