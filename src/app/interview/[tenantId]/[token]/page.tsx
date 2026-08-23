'use client';

/**
 * Public interview scheduling
 * Route: src/app/interview/[tenantId]/[token]/page.tsx
 *
 * Capability URL: the token is an unguessable doc id under
 * tenants/{tenantId}/interviewInvites. The doc holds only first name, role
 * title, and offered slots — never the application itself. The applicant
 * picks a slot (or asks for new times); rules restrict the public update to
 * exactly that.
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

  const respond = async (status: 'accepted' | 'needs_new_times', chosenSlot: string) => {
    setError('');
    setSubmitting(true);
    try {
      const db = getDb();
      await updateDoc(doc(db, `tenants/${tenantId}/interviewInvites/${token}`), {
        status,
        chosenSlot,
        respondedAt: new Date().toISOString(),
      });
      setInvite((prev: any) => ({ ...prev, status, chosenSlot }));
      window.scrollTo({ top: 0 });
    } catch (e) {
      console.error(e);
      setError('That didn\u2019t go through — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
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

  const responded = invite.status === 'accepted' || invite.status === 'needs_new_times';

  return (
    <div className="min-h-dvh bg-slate-50 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="bg-slate-950 px-6 pb-12 pt-12 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{businessName || 'Interview'}</p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white">
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
                <p className="mt-2 text-lg font-black text-slate-900">{invite.chosenSlot ? format(new Date(invite.chosenSlot), 'EEEE, MMMM d') : ''}</p>
                <p className="text-md font-bold text-slate-700">{invite.chosenSlot ? format(new Date(invite.chosenSlot), 'h:mm a') : ''}</p>
                <p className="mt-3 text-[12px] font-bold text-muted-foreground">{businessName} has been notified. If something comes up, reply to the email you received.</p>
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
                  'flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left',
                  picked === slot ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-900'
                )}
              >
                <CalendarClock className={cn('h-5 w-5 shrink-0', picked === slot ? 'text-white' : 'text-slate-400')} aria-hidden="true" />
                <span>
                  <span className="block text-[14px] font-black">{format(new Date(slot), 'EEEE, MMMM d')}</span>
                  <span className={cn('block text-[12px] font-bold', picked === slot ? 'text-slate-300' : 'text-muted-foreground')}>{format(new Date(slot), 'h:mm a')}</span>
                </span>
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
            <button
              type="button"
              disabled={submitting}
              onClick={() => respond('needs_new_times', '')}
              className="h-12 w-full rounded-xl border-2 border-dashed bg-white text-[11px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-50"
            >
              None of these work for me
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
