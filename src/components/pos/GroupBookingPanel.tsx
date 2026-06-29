'use client';

/**
 * GroupBookingPanel — v3
 *
 * v3:
 *   - REMOVED: the "Relationship" field. Low value for a beauty-service
 *     booking (more useful in event/medical contexts), and it was eating
 *     half the birthday row for little payoff. Birthday now gets the full
 *     row, with an explicit label above it instead of relying on iOS's
 *     placeholder-less empty date-input rendering (which is what made it
 *     look like "just an icon" with no visible field).
 *   - NEW: per-guest add-ons. Previously a guest could only pick ONE
 *     service — there was no way to add e.g. nail art on top of a guest's
 *     manicure in a group booking. `GroupGuest.addOnIds` now exists, with a
 *     toggle list scoped to whatever add-ons are compatible with the
 *     guest's selected service (same `compatibleAddOnIds` field the rest of
 *     the app already uses).
 *   - NEW: linked-client visibility. If a guest is linked to an existing
 *     client record (via the v2 duplicate-match flow), their birthday,
 *     active membership, and active packages now surface as small badges —
 *     informational only. Redeeming a package/membership for a GROUP GUEST
 *     is not wired up yet (only the primary client can redeem a package,
 *     in QuickBookForm step 3) — flagging this honestly rather than
 *     pretending it's covered.
 *
 * v2 — guest data + duplicate-client detection (Quick Book redesign #6):
 *   - Each guest now captures phone (proper international format via
 *     PhoneInput, matching the rest of the app instead of a plain tel
 *     input), email, birthday, and a marketing-consent toggle — closer to
 *     "every guest treated as their own client" instead of name + service
 *     only.
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
 * Also pass each guest's `addOnIds` through into their appointment doc.
 */

import React, { useState } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { cn } from '@/lib/utils';
import { UserPlus, Trash2, ChevronDown, CheckCircle2, Users, Link2, Mail, Cake, Megaphone, Sparkles, Award, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getServicePrice } from '@/lib/data';

export type GroupGuest = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  birthday?: string; // ISO date string, optional
  marketingConsent?: boolean;
  serviceId: string;
  addOnIds?: string[]; // v3 — add-ons compatible with this guest's serviceId
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

// True if an ISO birthday string falls on today's month/day, regardless of
// year. Used purely as an in-the-moment "hey, it's their birthday" nudge —
// not validated beyond a basic parse, since a malformed value should never
// crash this row.
function isBirthdayToday(iso?: string): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const today = new Date();
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  } catch {
    return false;
  }
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
  const addOnTotal = (guest.addOnIds || []).reduce((acc, id) => {
    const addOnSvc = services.find((s: any) => s.id === id);
    return acc + (addOnSvc ? getServicePrice(addOnSvc, selectedStaff) : 0);
  }, 0);
  const price = (selectedSvc
    ? getServicePrice(selectedSvc, selectedStaff)
    : 0) + addOnTotal;

  const colorClass = GUEST_COLORS[index % GUEST_COLORS.length];
  const activeStaff = staff.filter((s: any) => s.active);

  // Only worth checking once there's something to match on, and only
  // surfaced if not already linked (or if contact info changed since the
  // last link, which clears linkedClientId — see the phone/email onChange).
  const match = !guest.linkedClientId ? findClientMatch(guest, clients || []) : null;

  // v3 — once a guest IS linked, pull their real record so birthday/
  // membership/package status can surface as badges. Falls back to the
  // guest's own typed-in birthday if there's no link (or no match found).
  const linkedClient = guest.linkedClientId
    ? (clients || []).find((c: any) => c.id === guest.linkedClientId) || null
    : null;
  const effectiveBirthday = linkedClient?.birthday || guest.birthday;
  const linkedActivePackages: any[] = (linkedClient?.activePackages || []).filter(
    (p: any) => p.sessionsRemaining > 0,
  );

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
            {(guest.addOnIds || []).length > 0 ? ` · +${guest.addOnIds!.length} add-on${guest.addOnIds!.length > 1 ? 's' : ''}` : ''}
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
          {/* v3 — linked-client status: birthday/membership/package badges,
              informational only. Package/membership REDEMPTION for a group
              guest isn't wired up yet — only the primary client can redeem
              a package today, in QuickBookForm step 3. */}
          {guest.linkedClientId && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                <p className="text-[10px] font-bold text-green-700">Linked to existing client record</p>
              </div>
              {(isBirthdayToday(effectiveBirthday) || linkedClient?.activeMembershipId || linkedActivePackages.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {isBirthdayToday(effectiveBirthday) && (
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Cake className="w-2.5 h-2.5" /> Birthday today
                    </span>
                  )}
                  {linkedClient?.activeMembershipId && (
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Award className="w-2.5 h-2.5" /> Member
                    </span>
                  )}
                  {linkedActivePackages.length > 0 && (
                    <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Package className="w-2.5 h-2.5" /> Has package — redeem from their own booking
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* v3 — birthday gets the full row now that Relationship is gone.
              An explicit label sits above the field rather than relying on
              the placeholder, since iOS renders an empty type="date" input
              as just a small calendar control with no visible "mm/dd/yyyy"
              until tapped — that's what made it look like "just an icon." */}
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Birthday (optional)</p>
            <div className="relative">
              <Cake className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground z-10 pointer-events-none" />
              <Input
                value={guest.birthday || ''}
                onChange={(e) => onChange({ ...guest, birthday: e.target.value })}
                className="h-10 rounded-xl border-2 text-sm pl-9 w-full"
                type="date"
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

          {/* v3 — per-guest add-ons. Scoped to whatever's compatible with
              the guest's currently-selected service, same field
              (compatibleAddOnIds) the rest of the app already uses. */}
          {selectedSvc && (selectedSvc.compatibleAddOnIds || []).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Add-ons
              </p>
              <div className="flex flex-wrap gap-1.5">
                {services
                  .filter((s: any) => s.type === 'addon' && (selectedSvc.compatibleAddOnIds || []).includes(s.id))
                  .map((s: any) => {
                    const isOn = (guest.addOnIds || []).includes(s.id);
                    const p = getServicePrice(s, selectedStaff);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          const current = guest.addOnIds || [];
                          onChange({
                            ...guest,
                            addOnIds: isOn ? current.filter((id) => id !== s.id) : [...current, s.id],
                          });
                        }}
                        className={cn(
                          'px-2.5 py-1.5 rounded-xl border-2 text-[10px] font-black transition-all',
                          isOn ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground',
                        )}
                      >
                        {s.name}{p > 0 ? ` · $${p.toFixed(0)}` : ''}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

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
        addOnIds: [],
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

  // Total price across all guests, including each guest's add-ons
  const totalPrice = guests.reduce((acc, g) => {
    const svc = services.find((s: any) => s.id === g.serviceId);
    const staffMember = staff.find((s: any) => s.id === g.staffId);
    const base = svc ? getServicePrice(svc, staffMember) : 0;
    const addOns = (g.addOnIds || []).reduce((a, id) => {
      const addOnSvc = services.find((s: any) => s.id === id);
      return a + (addOnSvc ? getServicePrice(addOnSvc, staffMember) : 0);
    }, 0);
    return acc + base + addOns;
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