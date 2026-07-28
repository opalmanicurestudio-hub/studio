'use client';

// src/components/planner/WaitlistSheet.tsx
//
// v1 — THE READER THE WAITLIST NEVER HAD.
//
// Until now `tenants/{id}/waitlist` was write-only in practice: QuickBookForm
// dropped a row in whenever a requested slot was taken, toasted "will be
// notified when a slot opens" — and then nothing in the entire app ever read
// that collection back. Nobody was ever notified, because nothing could see
// who was waiting.
//
// This is the other half. It lists everyone waiting, in the order they've been
// waiting, and gives the desk three one-tap answers:
//
//   · Text/email them  → POST /api/waitlist {action:'notify'} — the server
//     resolves their number (from the row, or from their client profile),
//     sends through the studio's own Twilio/Resend, logs it to messageLog,
//     and stamps the row. It reports honestly when nothing was sent.
//   · Booked           → closes the row with outcome 'booked'.
//   · Remove           → closes it with outcome 'closed'.
//
// It renders BOTH shapes of row, because two different surfaces write them:
//   · Front desk (QuickBookForm): clientId + clientName + serviceId + staffId
//   · Walk-in kiosk (/api/waitlist): name + phone + serviceName, clientId null
//
// Everything goes through the API route rather than a direct Firestore write so
// the status vocabulary ('waiting' | 'notified' | 'booked' | 'closed') lives in
// exactly one place.

import React, { useMemo, useState } from 'react';
import { format, parseISO, formatDistanceToNowStrict } from 'date-fns';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Hourglass, Send, Check, X, Phone, Mail, Loader, CalendarDays,
  Store, Monitor, StickyNote, BellRing, UserRound, Inbox,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// There is no shared safeDate in @/lib/utils; every file that needs one defines
// it. date-fns `format` throws a RangeError on an Invalid Date, and a waitlist
// row can carry anything the writer put in it.
const safeDate = (val: any): Date | null => {
  if (!val) return null;
  let d: Date;
  if (val instanceof Date) d = val;
  else if (typeof val === 'string') { try { d = parseISO(val); } catch { d = new Date(val); } }
  else if (typeof val === 'object' && 'seconds' in val) d = new Date((val as any).seconds * 1000);
  else d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmt = (val: any, pattern: string, fallback = ''): string => {
  const d = safeDate(val);
  return d ? format(d, pattern) : fallback;
};

const waitedFor = (val: any): string => {
  const d = safeDate(val);
  if (!d) return '';
  try { return formatDistanceToNowStrict(d, { addSuffix: false }); } catch { return ''; }
};

const CLOSED_STATUSES = ['booked', 'closed', 'cancelled', 'expired', 'declined', 'converted', 'done'];
const isOpenEntry = (e: any): boolean => !CLOSED_STATUSES.includes(String(e?.status || 'waiting'));

const initials = (n: string): string =>
  String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WaitlistSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  /** Raw docs from tenants/{tenantId}/waitlist. */
  entries: any[];
  /** From useInventory() — used to fill in names/contact for front-desk rows. */
  clients?: any[];
  services?: any[];
  staff?: any[];
  isMobile: boolean;
  /**
   * Optional. Called with the resolved client record when the desk wants to
   * book someone who already has a profile. Only offered when a real client
   * record exists — a kiosk walk-up has no profile to hand over.
   */
  onBookClient?: (client: any, entry: any) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WaitlistSheet({
  open, onOpenChange, tenantId, entries, clients, services, staff, isMobile, onBookClient,
}: WaitlistSheetProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  // Rows the server has confirmed a change on, so the list reacts instantly
  // even before the Firestore snapshot catches up.
  const [optimistic, setOptimistic] = useState<Record<string, any>>({});

  const rows = useMemo(() => {
    const clientById = new Map((clients || []).map((c: any) => [c.id, c]));
    const serviceById = new Map((services || []).map((s: any) => [s.id, s]));
    const staffById = new Map((staff || []).map((s: any) => [s.id, s]));

    return (entries || [])
      .map((raw: any) => {
        const e = { ...raw, ...(optimistic[raw.id] || {}) };
        const client = e.clientId ? clientById.get(e.clientId) : null;
        const service = e.serviceId ? serviceById.get(e.serviceId) : null;
        const withStaff = e.staffId ? staffById.get(e.staffId) : null;
        return {
          e,
          id: e.id,
          name: e.clientName || e.name || client?.name || 'Guest',
          phone: e.phone || client?.phone || '',
          email: e.email || client?.email || '',
          client,
          serviceName: e.serviceName || service?.name || '',
          staffName: withStaff?.name || '',
          status: String(e.status || 'waiting'),
          fromKiosk: String(e.source || '') === 'walkin-kiosk',
          isOpen: isOpenEntry(e),
        };
      })
      .sort((a, b) => {
        // Longest wait first — that is the only fair order for a queue.
        const at = safeDate(a.e.createdAt)?.getTime() ?? 0;
        const bt = safeDate(b.e.createdAt)?.getTime() ?? 0;
        return at - bt;
      });
  }, [entries, clients, services, staff, optimistic]);

  const openRows = rows.filter((r) => r.isOpen);
  const closedRows = rows.filter((r) => !r.isOpen).reverse().slice(0, 25);
  const notifiedCount = openRows.filter((r) => r.status === 'notified').length;

  // ── Server actions ──────────────────────────────────────────────────────────

  const call = async (body: any) => {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data } as { res: Response; data: any };
  };

  const handleNotify = async (row: any) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const { res, data } = await call({ action: 'notify', entryId: row.id });
      if (data?.ok) {
        // The route answers { ok: true, sent: ['sms'] | ['email'] | both }.
        const sent: string[] = Array.isArray(data.sent) ? data.sent : [];
        const label = sent
          .map((c) => (c === 'sms' ? 'text' : c))
          .join(' and ');
        setOptimistic((p) => ({
          ...p,
          [row.id]: {
            status: 'notified',
            notifiedAt: new Date().toISOString(),
            lastNotifyOk: true,
            notifyCount: Number(row.e.notifyCount || 0) + 1,
          },
        }));
        toast({
          title: `${row.name} has been told`,
          description: label ? `Sent by ${label}.` : 'The message is on its way.',
        });
      } else {
        // A 502 means the send was attempted and did not land — the server
        // records that attempt and deliberately leaves the row un-badged, so
        // it still reads as someone still waiting. Any other error (no number
        // on file, already handled) means nothing was attempted at all, so
        // nothing is stamped here either.
        if (res.status === 502) {
          setOptimistic((p) => ({
            ...p,
            [row.id]: {
              notifiedAt: new Date().toISOString(),
              lastNotifyOk: false,
              notifyCount: Number(row.e.notifyCount || 0) + 1,
            },
          }));
        }
        toast({
          variant: 'destructive',
          title: 'Nothing was sent',
          description: data?.error || 'Give them a call instead.',
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Nothing was sent', description: 'Check your connection and try again.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleClose = async (row: any, outcome: 'booked' | 'closed') => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const { data } = await call({ action: 'close', entryId: row.id, outcome });
      if (data?.ok) {
        setOptimistic((p) => ({ ...p, [row.id]: { status: outcome } }));
        toast({ title: outcome === 'booked' ? `${row.name} marked as booked` : `${row.name} removed from the list` });
      } else {
        toast({ variant: 'destructive', title: 'That did not save', description: data?.error || 'Please try again.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'That did not save', description: 'Check your connection and try again.' });
    } finally {
      setBusyId(null);
    }
  };

  // ── Row ─────────────────────────────────────────────────────────────────────

  const Row = ({ row }: { row: any }) => {
    const busy = busyId === row.id;
    const e = row.e;
    const waited = waitedFor(e.createdAt);
    const reachable = Boolean(row.phone || row.email);

    return (
      <div
        className={cn(
          'rounded-[1.25rem] border-2 p-4 space-y-3 transition-colors',
          row.isOpen ? 'bg-background' : 'bg-muted/40 opacity-70',
          row.status === 'notified' && 'border-amber-300/70 bg-amber-50/40',
        )}
      >
        {/* Identity */}
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 shrink-0 rounded-[0.9rem] border-2 bg-muted flex items-center justify-center">
            <span className="text-xs font-black tracking-tight">{initials(row.name)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black tracking-tight truncate">{row.name}</p>
              {row.status === 'notified' && (
                <Badge variant="outline" className="h-5 border-amber-400 text-amber-700 text-[9px] font-black uppercase tracking-[0.15em]">
                  Told
                </Badge>
              )}
              {row.status === 'booked' && (
                <Badge variant="outline" className="h-5 border-emerald-400 text-emerald-700 text-[9px] font-black uppercase tracking-[0.15em]">
                  Booked
                </Badge>
              )}
              {!row.isOpen && row.status !== 'booked' && (
                <Badge variant="outline" className="h-5 text-[9px] font-black uppercase tracking-[0.15em]">Closed</Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {row.serviceName && <span className="font-semibold text-foreground/70">{row.serviceName}</span>}
              {row.staffName && <span>with {row.staffName}</span>}
              {e.requestedDate && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {fmt(e.requestedDate, 'EEE MMM d', String(e.requestedDate))}
                </span>
              )}
              {waited && (
                <span className="inline-flex items-center gap-1">
                  <Hourglass className="h-3 w-3" />
                  waiting {waited}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                {row.fromKiosk ? <Monitor className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                {row.fromKiosk ? 'Walk-in kiosk' : 'Front desk'}
              </span>
            </div>
          </div>
        </div>

        {/* Contact + note */}
        {/* `row.client` matters here on its own: a front-desk row carries no
            phone or email of its own, so without it the block would collapse
            and the desk would see a name with no way to reach it. */}
        {(reachable || e.note || row.client) && (
          <div className="space-y-1.5 pl-14">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {row.phone && (
                <a href={`tel:${String(row.phone).replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {row.phone}
                </a>
              )}
              {row.email && (
                <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1.5 font-semibold hover:underline truncate max-w-full">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{row.email}</span>
                </a>
              )}
              {!reachable && row.client && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" /> Contact details on their profile
                </span>
              )}
            </div>
            {e.note && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="min-w-0">{String(e.note)}</span>
              </p>
            )}
          </div>
        )}

        {/* What happened last time we reached out */}
        {row.isOpen && e.notifiedAt && (
          <p className={cn('pl-14 text-[11px]', e.lastNotifyOk === false ? 'text-destructive' : 'text-amber-700')}>
            {e.lastNotifyOk === false
              ? `Tried to reach them ${fmt(e.notifiedAt, 'MMM d, h:mm a')} — that did not go through`
              : `Told ${fmt(e.notifiedAt, 'MMM d, h:mm a')}`}
            {Number(e.notifyCount) > 1 ? ` · ${e.notifyCount} attempts` : ''}
          </p>
        )}

        {/* Actions */}
        {row.isOpen && (
          <div className="flex flex-wrap gap-2 pl-14">
            <Button
              size="sm"
              onClick={() => handleNotify(row)}
              disabled={busy}
              className="h-9 min-h-[36px] rounded-xl font-bold"
            >
              {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{row.status === 'notified' ? 'Tell them again' : 'Tell them'}</span>
            </Button>
            {onBookClient && row.client && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBookClient(row.client, e)}
                disabled={busy}
                className="h-9 min-h-[36px] rounded-xl border-2 font-bold"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="ml-1.5">Book</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleClose(row, 'booked')}
              disabled={busy}
              className="h-9 min-h-[36px] rounded-xl border-2 font-bold"
            >
              <Check className="h-3.5 w-3.5" />
              <span className="ml-1.5">Booked</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleClose(row, 'closed')}
              disabled={busy}
              className="h-9 min-h-[36px] rounded-xl font-bold text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
              <span className="ml-1.5">Remove</span>
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ── Sheet ───────────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'flex flex-col p-0 border-none bg-background shadow-2xl overflow-hidden',
          isMobile ? 'h-[94dvh] rounded-t-[2.5rem] w-full' : 'sm:max-w-lg md:max-w-xl',
        )}
      >
        <SheetHeader className="px-6 pt-6 pb-4 text-left space-y-1">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-[0.9rem] border-2 flex items-center justify-center">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-2xl font-black uppercase tracking-tighter">Waiting list</SheetTitle>
              <SheetDescription className="text-[11px] font-semibold">
                {openRows.length === 0
                  ? 'Nobody is waiting right now'
                  : `${openRows.length} ${openRows.length === 1 ? 'person is' : 'people are'} waiting` +
                    (notifiedCount > 0 ? ` · ${notifiedCount} already told` : '')}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-3">
            {openRows.length === 0 && (
              <div className="rounded-[1.5rem] border-2 border-dashed py-14 text-center space-y-2">
                <Inbox className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-bold">The list is empty</p>
                <p className="text-xs text-muted-foreground px-8">
                  People land here when the front desk adds them, or when a walk-in
                  arrives and every chair is full.
                </p>
              </div>
            )}

            {openRows.map((row) => <Row key={row.id} row={row} />)}

            {closedRows.length > 0 && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => setShowClosed((v) => !v)}
                  className="w-full text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground py-3"
                >
                  {showClosed ? 'Hide' : 'Show'} handled ({closedRows.length})
                </button>
                {showClosed && (
                  <div className="space-y-3">
                    {closedRows.map((row) => <Row key={row.id} row={row} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export default WaitlistSheet;
