'use client';

/**
 * Public tour scheduling
 * Route: src/app/tour-invite/[tenantId]/[token]/page.tsx
 *
 * The rental-side twin of /interview/[tenantId]/[token]. Same trust model,
 * deliberately: the token is an unguessable doc id under
 * tenants/{tenantId}/tourInvites, and the doc holds only a first name, the
 * space's name and the offered times — never the application, never the
 * prospect's contact details. The prospect picks a time, or counters with up
 * to three windows of their own; rules restrict the public update to exactly
 * those fields, exactly once, only while the invite is pending.
 *
 * Nothing here writes to /tours. A prospect choosing a time is an ANSWER, not
 * a booking — the owner confirms it from the pipeline, which puts the tour
 * through the same scheduler (and the same clash check) as every other tour.
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

export default function TourInvitePage() {
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
          getDoc(doc(db, `tenants/${tenantId}/tourInvites/${token}`)),
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

  const respond = async (
    status: 'accepted' | 'needs_new_times' | 'countered',
    chosenSlot: string,
    extra?: { proposedSlots?: string[]; prospectNote?: string },
  ) => {
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
      if (extra?.prospectNote) payload.prospectNote = extra.prospectNote;
      await updateDoc(doc(db, `tenants/${tenantId}/tourInvites/${token}`), payload);
      setInvite((prev: any) => ({ ...prev, ...payload }));
    } catch (e) {
      console.error(e);
      setError('That did not go through. Please try again, or reply to the message we sent you.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCounter = async () => {
    const slots = mySlots
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const d = new Date(s);
        return isNaN(d.getTime()) ? '' : d.toISOString();
      })
      .filter(Boolean);
    if (slots.length === 0) {
      setError('Give us at least one time that works for you.');
      return;
    }
    await respond('countered', '', { proposedSlots: slots, prospectNote: myNote.trim() });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-sm text-center space-y-2">
          <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
          <h1 className="text-lg font-black tracking-tight">This link is no longer active</h1>
          <p className="text-sm text-slate-500">
            It may have expired or been replaced by a newer one. Reply to the message we sent you and we will send a fresh link.
          </p>
        </div>
      </div>
    );
  }

  const answered = invite.status && invite.status !== 'pending';
  const slots: string[] = Array.isArray(invite.slots) ? invite.slots : [];
  const spaceName = String(invite.spaceName || '').trim();

  if (answered) {
    const chosen = invite.chosenSlot ? safeWhen(invite.chosenSlot, "EEEE d MMMM 'at' h:mm a") : '';
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-sm text-center space-y-3">
          <CheckCircle2 className="h-7 w-7 text-emerald-500 mx-auto" />
          <h1 className="text-lg font-black tracking-tight">
            {invite.status === 'accepted' ? 'Thanks — that time is with us' : 'Thanks — we have your times'}
          </h1>
          {invite.status === 'accepted' && chosen && (
            <p className="text-sm font-bold text-slate-700">{chosen}</p>
          )}
          <p className="text-sm text-slate-500">
            {invite.status === 'accepted'
              ? `${businessName || 'We'} will confirm shortly. You will hear from us before the visit.`
              : `${businessName || 'We'} will look at what you sent and come back with a time.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <div className="space-y-1.5">
          <CalendarClock className="h-6 w-6 text-slate-400" />
          <h1 className="text-2xl font-black tracking-tight">
            {invite.firstName ? `Hi ${invite.firstName} — pick a time to visit` : 'Pick a time to visit'}
          </h1>
          <p className="text-sm text-slate-500">
            {spaceName
              ? `A look around ${spaceName}${businessName ? ` at ${businessName}` : ''}. Choose whichever works best.`
              : `${businessName || 'We'} would love to show you around. Choose whichever works best.`}
          </p>
        </div>

        {!countering && (
          <>
            <div className="space-y-2">
              {slots.map((s) => {
                const on = picked === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPicked(on ? '' : s)}
                    className={cn(
                      'w-full min-h-[3.5rem] px-4 rounded-2xl border-2 text-left transition-colors',
                      on ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700',
                    )}
                  >
                    <span className="block text-[10px] font-black uppercase tracking-[0.2em] opacity-60">
                      {safeWhen(s, 'EEEE')}
                    </span>
                    <span className="block text-sm font-black">
                      {safeWhen(s, "d MMMM 'at' h:mm a")}
                    </span>
                  </button>
                );
              })}
              {slots.length === 0 && (
                <p className="text-sm text-slate-500">No times were offered — tell us when you are free below.</p>
              )}
            </div>

            {error && <p className="text-xs font-bold text-red-600">{error}</p>}

            <div className="space-y-2">
              <button
                type="button"
                disabled={!picked || submitting}
                onClick={() => respond('accepted', picked)}
                className="w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
              >
                {submitting ? 'Sending…' : 'Book this time'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => { setCountering(true); setError(''); }}
                className="w-full h-12 rounded-2xl border-2 border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest"
              >
                None of these work
              </button>
            </div>
          </>
        )}

        {countering && (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              When are you free? Up to three.
            </p>
            {mySlots.map((val, i) => (
              <input
                key={i}
                type="datetime-local"
                value={val}
                onChange={(e) => setMySlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                aria-label={`Time you are free, option ${i + 1}`}
                className="w-full h-12 px-3 rounded-2xl border-2 border-slate-200 text-sm font-bold"
              />
            ))}
            <textarea
              value={myNote}
              onChange={(e) => setMyNote(e.target.value.slice(0, 500))}
              placeholder="Anything we should know? (optional)"
              aria-label="Anything we should know"
              className="w-full min-h-[5rem] p-3 rounded-2xl border-2 border-slate-200 text-sm"
            />
            {error && <p className="text-xs font-bold text-red-600">{error}</p>}
            <button
              type="button"
              disabled={submitting}
              onClick={submitCounter}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
            >
              {submitting ? 'Sending…' : 'Send my times'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setCountering(false); setError(''); }}
              className="w-full h-12 rounded-2xl border-2 border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest"
            >
              Back to the offered times
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
