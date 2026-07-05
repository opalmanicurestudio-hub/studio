'use client';

/**
 * VoiceInboxPanel — v1
 *
 * Renders open items from tenants/{tenantId}/voiceInbox — the non-booking
 * calls the AI receptionist handled: cancellation requests, reschedules,
 * running-late notices, event/party inquiries, and messages. Designed to sit
 * directly beside (or above) the Pending Call-Backs list at QuickBookForm
 * step 1, or on the dashboard — same visual language: rounded-xl bordered
 * card, tinted header, divided rows, tiny uppercase labels.
 *
 * Booking-intent calls do NOT appear here — those land in callBackDrafts and
 * show in the existing Pending Call-Backs panel with Resume.
 *
 * Behavior notes:
 *   - Renders nothing when there are no open items (no empty-state clutter
 *     at the top of the booking flow).
 *   - "Running late" items were ALREADY applied to the appointment doc by
 *     the API route (lateNotice field) — the row exists as a visible record;
 *     the ✓ auto-noted chip tells staff no action is required beyond
 *     awareness. Done just acknowledges it.
 *   - Cancel / reschedule rows are requests, not executed actions. The Open
 *     button (shown when you pass onOpenAppointment) should route staff to
 *     AppointmentDetailsSheet, where the real cancellation/fee machinery
 *     lives. Done marks the item handled AFTER staff has executed it there.
 *   - Dismiss keeps the record (status: 'dismissed') rather than deleting.
 *
 * DEPLOYMENT NOTE (Firestore rules): the API routes write via the Admin SDK
 * (rules bypassed), but this panel READS client-side — staff need read/write
 * on tenants/{tenantId}/voiceInbox/{itemId} the same way they have it for
 * callBackDrafts, or the subscription fails with the familiar "Missing or
 * insufficient permissions".
 *
 * Usage:
 *   <VoiceInboxPanel
 *     firestore={firestore}
 *     tenantId={tenantId}
 *     currentStaffId={currentStaffId}
 *     onOpenAppointment={(aptId) => openAppointmentSheet(aptId)}
 *   />
 */

import React from 'react';
import {
  collection, query, where, onSnapshot, doc, setDoc,
} from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  XCircle, CalendarClock, Clock, PartyPopper, MessageSquare,
  Bot, Check, Trash2, ExternalLink, Loader, Phone,
} from 'lucide-react';

type VoiceInboxItem = {
  id: string;
  tenantId: string;
  createdAt: string;
  intent: 'cancel' | 'reschedule' | 'late' | 'event_quote' | 'message';
  callerName: string;
  callerPhone?: string;
  clientId?: string | null;
  appointmentId?: string;
  appointmentSpoken?: string;
  requestedSlotSpoken?: string;
  minutesLate?: number;
  autoApplied?: boolean;
  eventInquiry?: {
    eventDate?: string;
    headcount?: number;
    occasion?: string;
    servicesOfInterest?: string;
    budgetRange?: string;
    contactEmail?: string;
  };
  details?: string;
  callSummary?: string;
  status: 'open' | 'handled' | 'dismissed';
  source?: string;
};

const INTENT_CONFIG: Record<
  VoiceInboxItem['intent'],
  { label: string; icon: React.ElementType; chipClass: string }
> = {
  cancel: {
    label: 'Cancel request',
    icon: XCircle,
    chipClass: 'bg-red-50 text-red-600 border-red-200',
  },
  reschedule: {
    label: 'Reschedule',
    icon: CalendarClock,
    chipClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  late: {
    label: 'Running late',
    icon: Clock,
    chipClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  event_quote: {
    label: 'Event inquiry',
    icon: PartyPopper,
    chipClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  message: {
    label: 'Message',
    icon: MessageSquare,
    chipClass: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

// Same defensive pattern as QuickBookForm's safeRelativeTime — a malformed
// date string must never crash the panel.
const safeRelativeTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

function detailLine(item: VoiceInboxItem): string {
  if (item.intent === 'cancel') {
    return item.appointmentSpoken
      ? `Wants to cancel: ${item.appointmentSpoken}`
      : 'Wants to cancel an appointment';
  }
  if (item.intent === 'reschedule') {
    const from = item.appointmentSpoken || 'their appointment';
    return item.requestedSlotSpoken
      ? `Move ${from} → ${item.requestedSlotSpoken}`
      : `Wants to reschedule ${from}`;
  }
  if (item.intent === 'late') {
    return `${item.minutesLate ?? '?'} min behind${
      item.appointmentSpoken ? ` for ${item.appointmentSpoken}` : ''
    }`;
  }
  if (item.intent === 'event_quote') {
    const e = item.eventInquiry || {};
    const parts = [
      e.occasion,
      e.headcount ? `${e.headcount} guests` : null,
      e.eventDate,
      e.budgetRange,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Event quote requested';
  }
  return item.details || item.callSummary || 'Left a message';
}

export function VoiceInboxPanel({
  firestore,
  tenantId,
  currentStaffId,
  onOpenAppointment,
  className,
}: {
  firestore: any;
  tenantId: string;
  currentStaffId?: string;
  onOpenAppointment?: (appointmentId: string) => void;
  className?: string;
}) {
  const [items, setItems] = React.useState<VoiceInboxItem[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const inboxQuery = query(
      collection(firestore, `tenants/${tenantId}/voiceInbox`),
      where('status', '==', 'open'),
    );
    const unsubscribe = onSnapshot(
      inboxQuery,
      (snap: any) => {
        const list: VoiceInboxItem[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
        list.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setItems(list);
      },
      () => { /* non-fatal — inbox is a convenience, not core booking */ },
    );
    return () => unsubscribe();
  }, [firestore, tenantId]);

  const setStatus = async (id: string, status: 'handled' | 'dismissed') => {
    if (!firestore || !tenantId) return;
    setBusyId(id);
    try {
      await setDoc(
        doc(firestore, `tenants/${tenantId}/voiceInbox`, id),
        {
          status,
          handledAt: new Date().toISOString(),
          handledBy: currentStaffId || null,
        },
        { merge: true },
      );
    } catch {
      /* non-fatal — the row simply stays; staff can retry */
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className={cn('rounded-xl border border-indigo-200 bg-indigo-50/50 overflow-hidden', className)}>
      <div className="px-3.5 py-2 flex items-center gap-2 border-b border-indigo-200/60">
        <Bot className="w-3.5 h-3.5 text-indigo-600" />
        <p className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wide">
          AI receptionist · {items.length} to review
        </p>
      </div>
      <div className="divide-y divide-indigo-200/60">
        {items.map((item) => {
          const config = INTENT_CONFIG[item.intent] || INTENT_CONFIG.message;
          const Icon = config.icon;
          const isBusy = busyId === item.id;
          const isExpanded = expandedId === item.id;
          const hasMore = !!(item.callSummary || item.eventInquiry?.servicesOfInterest || item.eventInquiry?.contactEmail);
          return (
            <div key={item.id} className="px-3.5 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        'text-[10px] font-medium border px-2 py-0.5 rounded-full flex items-center gap-1',
                        config.chipClass,
                      )}
                    >
                      <Icon className="w-2.5 h-2.5" /> {config.label}
                    </span>
                    {item.autoApplied && (
                      <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" /> Auto-noted on appointment
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-900 truncate mt-1.5">
                    {item.callerName}
                    {item.callerPhone && (
                      <span className="font-normal text-slate-400 ml-1.5 inline-flex items-center gap-1">
                        <Phone className="w-2.5 h-2.5" /> {item.callerPhone}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">{detailLine(item)}</p>
                  {isExpanded && (
                    <div className="mt-1.5 space-y-1">
                      {item.eventInquiry?.servicesOfInterest && (
                        <p className="text-[11px] text-slate-500">
                          Interested in: {item.eventInquiry.servicesOfInterest}
                        </p>
                      )}
                      {item.eventInquiry?.contactEmail && (
                        <p className="text-[11px] text-slate-500">
                          Email: {item.eventInquiry.contactEmail}
                        </p>
                      )}
                      {item.callSummary && (
                        <p className="text-[11px] text-slate-500 italic">
                          "{item.callSummary}"
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] text-indigo-500">
                      {safeRelativeTime(item.createdAt)}
                    </p>
                    {hasMore && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        {isExpanded ? 'Less' : 'More'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {item.appointmentId && onOpenAppointment && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => onOpenAppointment(item.appointmentId!)}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" /> Open
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={isBusy}
                    onClick={() => setStatus(item.id, 'handled')}
                  >
                    {isBusy ? <Loader className="w-3 h-3 animate-spin" /> : 'Done'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setStatus(item.id, 'dismissed')}
                    disabled={isBusy}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    title="Dismiss"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
