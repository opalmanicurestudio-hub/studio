'use client';

/**
 * GroupBookingPanel — v2
 *
 * v2 — guest data + duplicate-client detection (Quick Book redesign #6):
 *   - Each guest now captures phone (proper international format via
 *     PhoneInput, matching the rest of the app instead of a plain tel
 *     input), email, birthday, relationship to the booking owner, and a
 *     marketing-consent toggle — closer to "every guest treated as their
 *     own client" instead of name + service only.
 *   - NEW: optional `clients` prop. If a guest's phone or email matches an
 *     existing client record, a "Matches an existing client" suggestion
 *     appears with a one-tap "Use this client" action that fills the
 *     guest's name/contact info from the match and tags the guest with
 *     `linkedClientId` — so QuickBookForm's handleBook can link to the real
 *     client doc instead of creating a duplicate. (handleBook needs a small
 *     update to honor `linkedClientId` when present — see note below.)
 *
 * v1 — multi-guest group booking builder. Renders inside QuickBookForm step 2
 * when "Group booking" is toggled on. Each guest gets their own service +
 * staff selection. On commit, creates one appointment per guest in a single
 * Firestore batch, linked by a shared groupBookingId.
 *
 * NOTE FOR QuickBookForm: pass `clients={clients}` into this panel, and in
 * the group-guest creation loop inside handleBook, check
 * `guest.linkedClientId` first — if set, reuse that client id (and skip
 * creating a new client doc) instead of always minting a fresh `gClientId`.
 */

import React, { useState } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { cn } from '@/lib/utils';
import { UserPlus, Trash2, ChevronDown, CheckCircle2, Users, Link2, Mail, Cake, Heart, Megaphone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getServicePrice } from '@/lib/data';

export type GroupGuest = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  birthday?: string; // ISO date string, optional
  relationship?: string; // e.g. "Friend", "Sister" — optional, free text
  marketingConsent?: boolean;
  serviceId: string;
  staffId: string; // 'any' is valid
  // v2 — set when the guest's contact info matched an existing client and
  // staff confirmed the link. When present, QuickBookForm should reuse this
  // client id instead of minting a new one.
  linkedClientId?: string | null;
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
  // v2 — optional, enables duplicate-client detection by phone/email.
  clients?: any[];
};

const GUEST_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-green-100 text-green-700',
  'bg-rose-100 text-rose-700',
];

function findClientMatch(guest: GroupGuest, clients: any[]): any | null {
  if (!clients?.length) return null;
  const phone = guest.phone?.trim();
  const email = guest.email?.trim().toLowerCase();
  if (!phone && !email) return null;
  return (
    clients.find(
      (c: any) =>
        (phone && c.phone === phone) ||
        (email && c.email?.toLowerCase() === email),
    ) || null
  );
}

function GuestRow({
  guest,
  index,
  services,
  staff,
  clients,
  onChange,
  onRemove,
}: {
  guest: GroupGuest;
  index: number;
  services: any[];
  staff: any[];
  clients?: any[];
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

  // Only worth checking once there's something to match on, and only
  // surfaced if not already linked (or if contact info changed since the
  // last link, which clears linkedClientId — see the phone/email onChange).
  const match = !guest.linkedClientId ? findClientMatch(guest, clients || []) : null;

  const linkToMatch = () => {
    if (!match) return;
    onChange({
      ...guest,
      name: match.name || guest.name,
      phone: match.phone || guest.phone,
      email: match.email || guest.email,
      linkedClientId: match.id,
    });
  };

  // Editing contact info after a link was made should re-open the
  // possibility of a different match, not silently keep the stale link.
  const updateAndUnlink = (patch: Partial<GroupGuest>) => {
    onChange({ ...guest, ...patch, linkedClientId: null });
  };

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
          <p className="text-[12px] font-black text-slate-900 truncate flex items-center gap-1.5">
            {guest.name || `Guest ${index + 1}`}
            {guest.linkedClientId && (
              <Link2 className="w-3 h-3 text-blue-500 shrink-0" />
            )}
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
            onChange={(e) => updateAndUnlink({ name: e.target.value })}
            className="h-10 rounded-xl border-2 text-sm"
          />

          <div className="h-10 rounded-xl border-2 bg-white px-3 flex items-center [&_input]:border-none [&_input]:bg-transparent [&_input]:outline-none [&_input]:h-full [&_input]:w-full [&_input]:text-sm [&_.PhoneInputCountry]:mr-2">
            <PhoneInput
              international
              defaultCountry="US"
              placeholder="Phone (optional)"
              value={guest.phone || ''}
              onChange={(v) => updateAndUnlink({ phone: v || '' })}
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Email (optional)"
              value={guest.email || ''}
              onChange={(e) => updateAndUnlink({ email: e.target.value })}
              className="h-10 rounded-xl border-2 text-sm pl-9"
              type="email"
            />
          </div>

          {/* v2 — duplicate-client suggestion */}
          {match && (
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-blue-50 border-2 border-blue-200">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase text-blue-700 flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Matches an existing client
                </p>
                <p className="text-[10px] text-blue-700/70 truncate">{match.name}</p>
              </div>
              <button
                type="button"
                onClick={linkToMatch}
                className="text-[10px] font-black uppercase text-blue-700 bg-white border-2 border-blue-300 px-2.5 py-1.5 rounded-lg shrink-0 hover:bg-blue-100 transition-colors"
              >
                Use this client
              </button>
            </div>
          )}
          {guest.linkedClientId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
              <p className="text-[10px] font-bold text-green-700">Linked to existing client record</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Cake className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Birthday (optional)"
                value={guest.birthday || ''}
                onChange={(e) => onChange({ ...guest, birthday: e.target.value })}
                className="h-10 rounded-xl border-2 text-sm pl-9"
                type="date"
              />
            </div>
            <div className="relative">
              <Heart className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Relationship (optional)"
                value={guest.relationship || ''}
                onChange={(e) => onChange({ ...guest, relationship: e.target.value })}
                className="h-10 rounded-xl border-2 text-sm pl-9"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => onChange({ ...guest, marketingConsent: !guest.marketingConsent })}
            className={cn(
              'w-full flex items-center justify-between p-2.5 rounded-xl border-2 text-left transition-all',
              guest.marketingConsent ? 'border-primary bg-primary/5' : 'border-muted',
            )}
          >
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Megaphone className="w-3.5 h-3.5" /> OK to send marketing texts/emails
            </span>
            <div className={cn('w-9 h-5 rounded-full relative transition-colors shrink-0', guest.marketingConsent ? 'bg-primary' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', guest.marketingConsent ? 'left-[18px]' : 'left-0.5')} />
            </div>
          </button>

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
  clients,
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
        linkedClientId: null,
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
            clients={clients}
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