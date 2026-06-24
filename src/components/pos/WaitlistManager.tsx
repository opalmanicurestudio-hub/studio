'use client';

/**
 * WaitlistManager
 *
 * Drop into POSPage alongside WalkInQueue:
 *
 *   import { WaitlistManager } from '@/components/pos/WaitlistManager';
 *   import { useWaitlist } from '@/hooks/useWaitlist';
 *
 *   const waitlist = useWaitlist({ tenantId, firestore, walkIns, ... });
 *
 *   <WaitlistManager
 *     {...waitlist}
 *     services={services}
 *     staff={staff}
 *     appointments={appointmentsFromInventory}
 *     onBook={(entry) => setIsQuickBookOpen(true)}
 *   />
 *
 * Or use the built-in book modal (isBookDialogOpen state inside this component).
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import {
  Clock,
  Bell,
  Calendar,
  XCircle,
  ChevronRight,
  Users,
  Plus,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn as classMerge } from '@/lib/utils';
import type { WaitlistEntry, AddToWaitlistInput } from '@/hooks/useWaitlist';

type Props = {
  waitlistClients: WaitlistEntry[];
  addToWaitlist: (input: AddToWaitlistInput) => Promise<string | null>;
  notifyWaitlistClient: (entry: WaitlistEntry, slotDate: string, slotTime: string) => Promise<void>;
  bookFromWaitlist: (
    entry: WaitlistEntry,
    params: { staffId: string; date: string; time: string },
  ) => Promise<string | undefined>;
  removeFromWaitlist: (entryId: string) => Promise<void>;
  services: any[];
  staff: any[];
  appointments: any[];
  className?: string;
};

function WaitlistRow({
  entry,
  services,
  staff,
  onNotify,
  onBook,
  onRemove,
}: {
  entry: WaitlistEntry;
  services: any[];
  staff: any[];
  onNotify: (entry: WaitlistEntry) => void;
  onBook: (entry: WaitlistEntry) => void;
  onRemove: (entry: WaitlistEntry) => void;
}) {
  const svcNames = entry.serviceIds
    .map((id) => services.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const preferredStaffName = entry.preferredStaffId
    ? staff.find((s) => s.id === entry.preferredStaffId)?.name?.split(' ')[0]
    : null;

  const waitMins = differenceInMinutes(new Date(), parseISO(entry.addedAt));
  const waitLabel =
    waitMins < 60
      ? `${waitMins}m`
      : `${Math.floor(waitMins / 60)}h ${waitMins % 60}m`;

  const isNotified = entry.status === 'notified';
  const holdExpired =
    isNotified && entry.holdExpiresAt
      ? new Date() > parseISO(entry.holdExpiresAt)
      : false;

  return (
    <div
      className={cn(
        'rounded-2xl border-2 overflow-hidden transition-all',
        isNotified && !holdExpired
          ? 'border-primary/30 bg-primary/5'
          : holdExpired
          ? 'border-amber-200 bg-amber-50'
          : 'border-muted bg-white',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 text-[13px] font-black text-slate-500">
          {entry.clientName.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-black text-slate-900 truncate">
              {entry.clientName}
            </p>
            {isNotified && !holdExpired && (
              <span className="text-[9px] font-black uppercase text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                Notified · waiting
              </span>
            )}
            {holdExpired && (
              <span className="text-[9px] font-black uppercase text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Hold expired
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">
            {svcNames || '—'}
            {preferredStaffName && ` · Prefers ${preferredStaffName}`}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[9px] font-bold text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> Waiting {waitLabel}
            </span>
            {entry.preferredTimeOfDay && entry.preferredTimeOfDay !== 'any' && (
              <span className="text-[9px] font-bold text-muted-foreground capitalize">
                {entry.preferredTimeOfDay} pref
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onNotify(entry)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-muted bg-white hover:bg-primary/5 hover:border-primary/30 transition-all text-[10px] font-black uppercase text-muted-foreground"
            title="Notify client"
          >
            <Bell className="w-3 h-3" />
          </button>
          <button
            onClick={() => onBook(entry)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-all text-[10px] font-black uppercase shadow-sm shadow-primary/20"
            title="Book now"
          >
            <Calendar className="w-3 h-3" />
            Book
          </button>
          <button
            onClick={() => onRemove(entry)}
            className="flex items-center justify-center w-7 h-7 rounded-lg border border-muted bg-white hover:bg-red-50 hover:border-red-200 transition-all text-muted-foreground hover:text-red-400"
            title="Remove from waitlist"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function WaitlistManager({
  waitlistClients,
  addToWaitlist,
  notifyWaitlistClient,
  bookFromWaitlist,
  removeFromWaitlist,
  services,
  staff,
  appointments,
  className,
}: Props) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isNotifyOpen, setIsNotifyOpen] = useState(false);
  const [isBookOpen, setIsBookOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<WaitlistEntry | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newServiceId, setNewServiceId] = useState('');
  const [newTimeOfDay, setNewTimeOfDay] = useState<'morning' | 'afternoon' | 'evening' | 'any'>('any');
  const [isAdding, setIsAdding] = useState(false);

  // Notify form state
  const [notifyDate, setNotifyDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notifyTime, setNotifyTime] = useState('10:00');

  // Book form state
  const [bookStaffId, setBookStaffId] = useState('any');
  const [bookDate, setBookDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bookTime, setBookTime] = useState('10:00');
  const [isBooking, setIsBooking] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim() || !newServiceId) return;
    setIsAdding(true);
    await addToWaitlist({
      clientName: newName.trim(),
      clientPhone: newPhone.trim() || undefined,
      clientEmail: newEmail.trim() || undefined,
      serviceIds: [newServiceId],
      preferredTimeOfDay: newTimeOfDay,
    });
    setNewName(''); setNewPhone(''); setNewEmail(''); setNewServiceId(''); setNewTimeOfDay('any');
    setIsAdding(false);
    setIsAddOpen(false);
  };

  const handleNotify = async () => {
    if (!activeEntry) return;
    await notifyWaitlistClient(activeEntry, notifyDate, notifyTime);
    setIsNotifyOpen(false);
    setActiveEntry(null);
  };

  const handleBook = async () => {
    if (!activeEntry) return;
    setIsBooking(true);
    const resolvedStaffId =
      bookStaffId === 'any'
        ? (staff.find((s: any) => s.active)?.id || '')
        : bookStaffId;
    await bookFromWaitlist(activeEntry, {
      staffId: resolvedStaffId,
      date: bookDate,
      time: bookTime,
    });
    setIsBooking(false);
    setIsBookOpen(false);
    setActiveEntry(null);
  };

  const activeStaff = staff.filter((s: any) => s.active);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Waitlist
          {waitlistClients.length > 0 && (
            <span className="ml-1 text-[10px] font-black text-white bg-primary px-2 py-0.5 rounded-full">
              {waitlistClients.length}
            </span>
          )}
        </h3>
        <Button
          onClick={() => setIsAddOpen(true)}
          variant="outline"
          className="h-8 px-3 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      {/* List */}
      {waitlistClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-2xl border-2 border-dashed border-muted">
          <Sparkles className="w-5 h-5 text-muted-foreground/40" />
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            No one on the waitlist
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {waitlistClients.map((entry) => (
            <WaitlistRow
              key={entry.id}
              entry={entry}
              services={services}
              staff={staff}
              onNotify={(e) => { setActiveEntry(e); setIsNotifyOpen(true); }}
              onBook={(e) => { setActiveEntry(e); setIsBookOpen(true); }}
              onRemove={(e) => removeFromWaitlist(e.id)}
            />
          ))}
        </div>
      )}

      {/* ── Add to waitlist dialog ─────────────────────────────────────────── */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Add to Waitlist
            </DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
              Client will be notified when a slot opens.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <Input
              autoFocus
              placeholder="Client name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-11 rounded-xl border-2"
            />
            <Input
              placeholder="Phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              type="tel"
              className="h-11 rounded-xl border-2"
            />
            <Input
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              className="h-11 rounded-xl border-2"
            />
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service *</p>
              <div className="rounded-xl border-2 divide-y overflow-hidden max-h-40 overflow-y-auto">
                {services.filter((s: any) => s.type === 'service').map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => setNewServiceId(s.id)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors text-[12px]',
                      newServiceId === s.id ? 'bg-primary/5 text-primary font-black' : 'hover:bg-muted/30',
                    )}
                  >
                    {s.name}
                    {newServiceId === s.id && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Preferred time</p>
              <div className="flex gap-2">
                {(['any', 'morning', 'afternoon', 'evening'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewTimeOfDay(t)}
                    className={cn(
                      'flex-1 py-2 rounded-xl border-2 text-[10px] font-black uppercase capitalize transition-all',
                      newTimeOfDay === t ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={handleAdd}
              disabled={!newName.trim() || !newServiceId || isAdding}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"
            >
              Add to Waitlist
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Notify dialog ──────────────────────────────────────────────────── */}
      <Dialog open={isNotifyOpen} onOpenChange={setIsNotifyOpen}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" /> Notify {activeEntry?.clientName}
            </DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
              Client will receive an SMS/email with a {15}-minute hold window.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Date</p>
                <input
                  type="date"
                  value={notifyDate}
                  onChange={(e) => setNotifyDate(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 px-3 font-bold text-sm bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Time</p>
                <input
                  type="time"
                  value={notifyTime}
                  onChange={(e) => setNotifyTime(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 px-3 font-bold text-sm bg-white"
                />
              </div>
            </div>
            <Button
              onClick={handleNotify}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"
            >
              Send Notification
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Book dialog ────────────────────────────────────────────────────── */}
      <Dialog open={isBookOpen} onOpenChange={setIsBookOpen}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" /> Book {activeEntry?.clientName}
            </DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
              Creates a confirmed appointment from waitlist.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Provider</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setBookStaffId('any')}
                  className={cn(
                    'px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase transition-all',
                    bookStaffId === 'any' ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground',
                  )}
                >
                  Any
                </button>
                {activeStaff.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => setBookStaffId(s.id)}
                    className={cn(
                      'px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase transition-all',
                      bookStaffId === s.id ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground',
                    )}
                  >
                    {s.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Date</p>
                <input
                  type="date"
                  value={bookDate}
                  onChange={(e) => setBookDate(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 px-3 font-bold text-sm bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Time</p>
                <input
                  type="time"
                  value={bookTime}
                  onChange={(e) => setBookTime(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 px-3 font-bold text-sm bg-white"
                />
              </div>
            </div>
            <Button
              onClick={handleBook}
              disabled={isBooking}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"
            >
              {isBooking ? 'Booking…' : 'Confirm Booking'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
