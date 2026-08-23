'use client';

/**
 * Public interview scheduling
 * Route: src/app/interview/[tenantId]/[token]/page.tsx
 *
 * Capability URL: the token is an unguessable doc id under
 * tenants/{tenantId}/interviewInvites. The doc holds only first name, role
 * title, and offered slots — never the application itself. The applicant
 * picks a slot, or counters with up to three windows of their own
 * availability; rules restrict the public update to exactly those fields,
 * exactly once, only while pending.
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { Loader, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const getDb = () => {
  if (getApps().length === 0) {
    initializeApp({
      apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getFirestore();
};

const safeWhen = (val: string, pattern: string): string => {
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '';
    return format(d, pattern);
  } catch {
    return '';
  }
};

export default function InterviewInvitePage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [businessName, setBusinessName] = useState('');
  const [picked, setPicked] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [countering, setCountering] = useState(false);
  const [mySlots, setMySlots] = useState<string[]>(['', '', '']);
  const [myNote, setMyNote] = useState('');

  useEffect(() => {
    if (!tenantId || !token) return;
    const load = async () => {
      try {
        const db = getDb();
        const [invSnap, tenantSnap] = await Promise.all([
          getDoc(doc(db, `tenants/${tenantId}/interviewInvites/${token}`)),
          getDoc(doc(db, `tenants/${tenantId}`)),
        ]);
        if (invSnap.exists()) setInvite({ id: invSnap.id, ...invSnap.data() });
        if (tenantSnap.exists()) setBusinessName((tenantSnap.data() as any)?.name || '');
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId, token]);

  const respond = async (status: 'accepted' | 'needs_new_times' | 'countered', chosenSlot: string, extra?: { proposedSlots?: string[]; applicantNote?: string }) => {
    setError('');
    setSubmitting(true);
    try {
      const db = getDb();
      const payload: any = {
        status,
        chosenSlot,
        respondedAt: new Date().toISOString(),
      };
      if (extra?.proposedSlots) payload.proposedSlots = extra.proposedSlots;
      if (extra?.applicantNote) payload.applicantNote = extra.applicantNote;
      await updateDoc(doc(db, `tenants/${tenantId}/interviewInvites/${token}`), payload);
      setInvite((prev: any) => ({ ...prev, ...payload }));
      window.scrollTo({ top: 0 });
    } catch (e) {
      console.error(e);
      setError('That didn\u2019t go through — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCounter = () => {
    const slots = mySlots.filter(Boolean).slice(0, 5);
    if (slots.length === 0) { setError('Add at least one day and time that works for you.'); return; }
    respond('countered', '', { proposedSlots: slots, applicantNote: myNote.trim().slice(0, 500) });
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-slate-900" aria-label="Loading" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-[2rem] border-2 bg-white p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-black uppercase tracking-tight text-slate-900">This invite isn&apos;t available</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">The link may be old or mistyped. Reply to the email you received and we&apos;ll sort it out.</p>
        </div>
      </div>
    );
  }

  const responded = invite.status === 'accepted' || invite.status === 'needs_new_times' || invite.status === 'countered';

  return (
    <div className="min-h-dvh bg-slate-50 pb-16">
      <header className="bg-slate-900 px-4 pb-12 pt-10 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">{businessName || 'Interview'}</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          {responded ? (invite.status === 'accepted' ? 'You\u2019re booked' : 'Got it') : `Hi ${invite.firstName || 'there'}`}
        </h1>
        {!responded && (
          <p className="mt-2 text-[12px] font-bold text-slate-400">
            Pick an interview time{invite.roleTitle ? ` — ${invite.roleTitle}` : ''}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-md px-4 -mt-6 space-y-4">
        {responded ? (
          <div className="rounded-[2rem] border-2 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
            {invite.status === 'accepted' ? (
              <>
                <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-900">Interview confirmed</p>
                <p className="mt-2 text-lg font-black text-slate-900">{safeWhen(invite.chosenSlot, 'EEEE, MMMM d')}</p>
                <p className="text-md font-bold text-slate-700">{safeWhen(invite.chosenSlot, 'h:mm a')}</p>
                <p className="mt-3 text-[12px] font-bold text-muted-foreground">{businessName} has been notified. If something comes up, reply to the email you received.</p>
              </>
            ) : invite.status === 'countered' ? (
              <>
                <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-900">Availability sent</p>
                <div className="mt-2 space-y-1">
                  {(invite.proposedSlots || []).map((sl: string, i: number) => (
                    <p key={i} className="text-[13px] font-black text-slate-900">{safeWhen(sl, 'EEE, MMM d') + ' \u00b7 ' + safeWhen(sl, 'h:mm a')}</p>
                  ))}
                </div>
                <p className="mt-3 text-[12px] font-bold text-muted-foreground">{businessName} will confirm one of your times or reply with alternatives — watch your email.</p>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-900">We&apos;ll offer new times</p>
                <p className="mt-2 text-[12px] font-bold text-muted-foreground">{businessName} can see none of these worked and will email you fresh options.</p>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-[2rem] border-2 bg-white p-5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Choose one</p>
            {(invite.slots || []).map((slot: string) => (
              <button
                key={slot}
                type="button"
                aria-pressed={picked === slot}
                onClick={() => setPicked(slot)}
                className={cn(
                  'flex h-16 w-full items-center justify-between rounded-2xl border-2 px-4 text-left transition-all',
                  picked === slot ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-900'
                )}
              >
                <span>
                  <span className="block text-[13px] font-black">{safeWhen(slot, 'EEEE, MMMM d')}</span>
                  <span className={cn('block text-[12px] font-bold', picked === slot ? 'text-slate-300' : 'text-slate-500')}>{safeWhen(slot, 'h:mm a')}</span>
                </span>
                <CalendarClock className="h-5 w-5 shrink-0 opacity-60" aria-hidden="true" />
              </button>
            ))}
            {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}
            <button
              type="button"
              disabled={!picked || submitting}
              onClick={() => respond('accepted', picked)}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-slate-900 text-[12px] font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              {submitting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Confirm this time'}
            </button>
            {countering ? (
              <div className="space-y-2 rounded-2xl border-2 border-dashed bg-white p-4">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">When works for you?</p>
                <p className="text-[12px] font-bold text-muted-foreground">Pick up to three days &amp; times — we&apos;ll confirm one or reply with alternatives.</p>
                {mySlots.map((v, i) => (
                  <div key={i}>
                    <label htmlFor={`my-slot-${i}`} className="sr-only">Availability option {i + 1}</label>
                    <input
                      id={`my-slot-${i}`}
                      type="datetime-local"
                      value={v}
                      onChange={e => setMySlots(prev => prev.map((x, xi) => xi === i ? e.target.value : x))}
                      className="h-12 w-full rounded-xl border-2 bg-white px-3 text-[13px] font-bold"
                    />
                  </div>
                ))}
                <label htmlFor="my-note" className="sr-only">Note</label>
                <textarea
                  id="my-note"
                  value={myNote}
                  onChange={e => setMyNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Anything we should know? (optional)"
                  className="w-full rounded-xl border-2 bg-white p-3 text-[13px] font-bold"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={submitCounter}
                  className="flex h-14 w-full items-center justify-center rounded-2xl bg-slate-900 text-[12px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  {submitting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send my availability'}
                </button>
                <button type="button" onClick={() => setCountering(false)} className="h-10 w-full rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Back to their times
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setCountering(true)}
                className="h-12 w-full rounded-xl border-2 border-dashed bg-white text-[11px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-50"
              >
                None of these work — share my availability
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
