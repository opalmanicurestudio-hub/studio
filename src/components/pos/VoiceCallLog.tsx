'use client';

/**
 * VoiceCallLog — v1
 *
 * The review surface for AI receptionist calls: every call recorded by the
 * platform, with inline audio playback, the AI summary, caller sentiment,
 * and the full transcript on expand. This is the "listen to a few weeks of
 * calls, then decide what to graduate" loop, in-app instead of in Retell's
 * dashboard — and for complaints, it's where the business hears exactly
 * what was said before deciding how to handle the callback.
 *
 * Reads tenants/{tenantId}/voiceCalls (written by /api/voice/call-events).
 * Single-field orderBy — auto-indexed, no composite index needed. Negative-
 * sentiment calls get a red chip; pair this next to VoiceInboxPanel on a
 * "Voice" tab or the dashboard.
 *
 * Audio: recordingUrl is Retell-hosted; the <audio> element streams it
 * directly. If a recording has aged out of Retell's retention window the
 * player will error — the row still shows transcript + summary.
 *
 * Usage:
 *   <VoiceCallLog firestore={firestore} tenantId={tenantId} />
 */

import React from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Phone, PhoneIncoming, ChevronDown, ChevronUp, FileText,
  Smile, Meh, Frown, Bot,
} from 'lucide-react';

type VoiceCall = {
  id: string;
  fromNumber?: string;
  toNumber?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcript?: string;
  summary?: string;
  sentiment?: string; // Positive | Neutral | Negative
  callSuccessful?: boolean;
  disconnectionReason?: string;
  status?: string;
};

const safeRelativeTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

const safeFormat = (iso: string | undefined, fmt: string): string => {
  if (!iso) return '';
  try {
    return format(new Date(iso), fmt);
  } catch {
    return '';
  }
};

const formatDuration = (secs?: number): string => {
  if (!secs || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

function SentimentChip({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  if (s === 'positive') {
    return (
      <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
        <Smile className="w-2.5 h-2.5" /> Positive
      </span>
    );
  }
  if (s === 'negative') {
    return (
      <span className="text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1">
        <Frown className="w-2.5 h-2.5" /> Negative — review
      </span>
    );
  }
  return (
    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
      <Meh className="w-2.5 h-2.5" /> Neutral
    </span>
  );
}

export function VoiceCallLog({
  firestore,
  tenantId,
  maxCalls = 50,
  className,
}: {
  firestore: any;
  tenantId: string;
  maxCalls?: number;
  className?: string;
}) {
  const [calls, setCalls] = React.useState<VoiceCall[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const callsQuery = query(
      collection(firestore, `tenants/${tenantId}/voiceCalls`),
      orderBy('startedAt', 'desc'),
      limit(maxCalls),
    );
    const unsubscribe = onSnapshot(
      callsQuery,
      (snap: any) => {
        const list: VoiceCall[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
        setCalls(list);
        setLoaded(true);
      },
      () => setLoaded(true), // non-fatal
    );
    return () => unsubscribe();
  }, [firestore, tenantId, maxCalls]);

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden shadow-sm', className)}>
      <div className="p-4 border-b flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">AI receptionist calls</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Recordings, transcripts, and summaries of every answered call.
          </p>
        </div>
        {calls.length > 0 && (
          <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
            {calls.length} recent
          </span>
        )}
      </div>

      {loaded && calls.length === 0 && (
        <div className="p-8 text-center">
          <Phone className="w-7 h-7 text-slate-200 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            No calls yet — they'll appear here as soon as the assistant answers its first one.
          </p>
        </div>
      )}

      <div className="divide-y">
        {calls.map((call) => {
          const isExpanded = expandedId === call.id;
          return (
            <div key={call.id} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : call.id)}
                className="w-full text-left group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <PhoneIncoming className="w-2.5 h-2.5" />
                        {call.fromNumber || 'Unknown number'}
                      </span>
                      {call.status === 'live' ? (
                        <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                          </span>
                          Live
                        </span>
                      ) : (
                        <SentimentChip sentiment={call.sentiment} />
                      )}
                      {call.durationSeconds ? (
                        <span className="text-[10px] text-slate-400">
                          {formatDuration(call.durationSeconds)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-700 mt-1.5 line-clamp-2">
                      {call.status === 'live' ? 'Call in progress…' : call.summary || 'Summary processing…'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {safeFormat(call.startedAt, 'EEE MMM d · h:mm a')} · {safeRelativeTime(call.startedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-slate-300 group-hover:text-slate-500 mt-1">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 space-y-3">
                  {call.recordingUrl && (
                    <audio
                      controls
                      preload="none"
                      src={call.recordingUrl}
                      className="w-full h-10"
                    />
                  )}
                  {call.transcript ? (
                    <div className="rounded-lg bg-slate-50 border p-3">
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                        <FileText className="w-3 h-3" /> Transcript
                      </p>
                      <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                        {call.transcript}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400">Transcript not available for this call.</p>
                  )}
                  {call.disconnectionReason && (
                    <p className="text-[10px] text-slate-400">
                      Ended: {call.disconnectionReason.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
