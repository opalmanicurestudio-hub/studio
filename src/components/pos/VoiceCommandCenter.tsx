'use client';

/**
 * VoiceCommandCenter — v1
 *
 * The one screen where a business sees EVERYTHING the AI receptionist did,
 * so nothing goes unnoticed:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Calls today · Bookings captured · Needs review · Neg.   │  ← stats
 *   ├─────────────────────────────┬────────────────────────────┤
 *   │  Action queue               │  Call log                  │
 *   │  · VoiceInboxPanel          │  · VoiceCallLog            │
 *   │    (complaints pinned,      │    (playback, transcripts, │
 *   │     recordings inline)      │     sentiment)             │
 *   │  · AI booking drafts        │                            │
 *   │    (resume in Quick Book)   │                            │
 *   └─────────────────────────────┴────────────────────────────┘
 *
 * The linkage that makes decisions fast: inbox items carry retellCallId,
 * this component subscribes to voiceCalls and hands VoiceInboxPanel a
 * callsById map — so a complaint expands with ITS OWN recording right
 * there. Listen → decide → call back, one surface.
 *
 * Booking drafts from the AI live in callBackDrafts (so QuickBookForm's
 * Resume keeps working); this screen surfaces them read-only with a
 * "Resume in Quick Book" hand-off via the onOpenQuickBook prop.
 *
 * Mount as a "Voice" tab/page:
 *   <VoiceCommandCenter
 *     firestore={firestore}
 *     tenantId={tenantId}
 *     currentStaffId={currentStaffId}
 *     onOpenAppointment={(id) => openAppointmentSheet(id)}
 *     onOpenQuickBook={() => router.push('/studio/pos')}
 *   />
 */

import React from 'react';
import {
  collection, query, where, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  PhoneIncoming, CalendarCheck, AlertTriangle, Frown, Bot, ArrowRight,
} from 'lucide-react';
import { VoiceInboxPanel } from '@/components/pos/VoiceInboxPanel';
import { VoiceCallLog } from '@/components/pos/VoiceCallLog';
import { VoiceBookingApprovalsPanel } from '@/components/pos/VoiceBookingApprovalsPanel';

const safeRelativeTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

function StatTile({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  accent?: 'red' | 'amber';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white px-3.5 py-3 flex items-center gap-3',
        accent === 'red' && value > 0 && 'border-red-200 bg-red-50/50',
        accent === 'amber' && value > 0 && 'border-amber-200 bg-amber-50/50',
      )}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          accent === 'red' && value > 0
            ? 'bg-red-100 text-red-600'
            : accent === 'amber' && value > 0
              ? 'bg-amber-100 text-amber-600'
              : 'bg-indigo-50 text-indigo-600',
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-lg font-semibold text-slate-900 leading-none">{value}</p>
        <p className="text-[10px] text-slate-400 mt-1">{label}</p>
      </div>
    </div>
  );
}

export function VoiceCommandCenter({
  firestore,
  tenantId,
  tenant,
  currentStaffId,
  onOpenAppointment,
  onOpenQuickBook,
  className,
}: {
  firestore: any;
  tenantId: string;
  tenant?: any;
  currentStaffId?: string;
  onOpenAppointment?: (appointmentId: string) => void;
  onOpenQuickBook?: () => void;
  className?: string;
}) {
  const [calls, setCalls] = React.useState<any[]>([]);
  const [openInboxItems, setOpenInboxItems] = React.useState<any[]>([]);
  const [aiDrafts, setAiDrafts] = React.useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = React.useState<number>(0);

  // Approval-mode bookings awaiting review — count feeds the stat tile;
  // the panel below manages its own rows.
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('voiceApproval', '==', 'pending'),
    );
    const unsub = onSnapshot(
      q,
      (snap: any) => {
        let n = 0;
        snap.forEach((d: any) => { if ((d.data() as any)?.status !== 'cancelled') n += 1; });
        setPendingApprovals(n);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  // voiceCalls — feeds stats AND the callsById linkage for the inbox
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const callsQuery = query(
      collection(firestore, `tenants/${tenantId}/voiceCalls`),
      orderBy('startedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      callsQuery,
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
        setCalls(list);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  // open inbox items — for the "needs review" stat (panel subscribes itself)
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const inboxQuery = query(
      collection(firestore, `tenants/${tenantId}/voiceInbox`),
      where('status', '==', 'open'),
    );
    const unsub = onSnapshot(
      inboxQuery,
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
        setOpenInboxItems(list);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  // AI-sourced booking drafts — read-only surfacing; Resume happens in Quick Book
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const draftsQuery = query(
      collection(firestore, `tenants/${tenantId}/callBackDrafts`),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(
      draftsQuery,
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => {
          const data = { id: d.id, ...(d.data() as any) };
          if (data.source === 'ai_receptionist') list.push(data);
        });
        list.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setAiDrafts(list);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  const callsById = React.useMemo(() => {
    const map: Record<string, { recordingUrl?: string; transcript?: string }> = {};
    calls.forEach((c) => {
      map[c.id] = { recordingUrl: c.recordingUrl, transcript: c.transcript };
    });
    return map;
  }, [calls]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const callsToday = calls.filter(
    (c) => typeof c.startedAt === 'string' && c.startedAt.startsWith(todayStr),
  ).length;
  const openComplaints = openInboxItems.filter((i) => i.intent === 'complaint').length;
  const negativeCalls = calls.filter(
    (c) => (c.sentiment || '').toLowerCase() === 'negative',
  ).length;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={PhoneIncoming} value={callsToday} label="Calls today" />
        <StatTile icon={CalendarCheck} value={pendingApprovals + aiDrafts.length} label="Bookings to confirm" accent="amber" />
        <StatTile icon={AlertTriangle} value={openComplaints} label="Complaints to review" accent="red" />
        <StatTile icon={Frown} value={negativeCalls} label="Negative-sentiment calls" accent="red" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <VoiceBookingApprovalsPanel
            firestore={firestore}
            tenantId={tenantId}
            tenant={tenant}
            currentStaffId={currentStaffId}
            callsById={callsById}
          />

          <VoiceInboxPanel
            firestore={firestore}
            tenantId={tenantId}
            currentStaffId={currentStaffId}
            onOpenAppointment={onOpenAppointment}
            callsById={callsById}
          />

          {aiDrafts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
              <div className="px-3.5 py-2 flex items-center gap-2 border-b border-amber-200/60">
                <Bot className="w-3.5 h-3.5 text-amber-600" />
                <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                  Bookings the assistant captured · {aiDrafts.length}
                </p>
              </div>
              <div className="divide-y divide-amber-200/60">
                {aiDrafts.map((d) => (
                  <div key={d.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">
                        {d.callerName || 'Unknown caller'}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {d.callerPhone || '—'}
                        {d.note ? ` · ${d.note}` : ''}
                      </p>
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        {safeRelativeTime(d.createdAt)}
                      </p>
                    </div>
                    {d.retellCallId && callsById[d.retellCallId]?.recordingUrl ? (
                      <audio
                        controls
                        preload="none"
                        src={callsById[d.retellCallId].recordingUrl}
                        className="h-8 max-w-[180px] shrink-0"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {onOpenQuickBook && (
                <div className="px-3.5 py-2.5 border-t border-amber-200/60">
                  <Button size="sm" variant="outline" className="h-8 text-xs w-full" onClick={onOpenQuickBook}>
                    Resume &amp; confirm in Quick Book <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <VoiceCallLog firestore={firestore} tenantId={tenantId} />
      </div>
    </div>
  );
}
