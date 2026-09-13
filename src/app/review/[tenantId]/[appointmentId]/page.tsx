'use client';

// src/app/review/[tenantId]/[appointmentId]/page.tsx
//
// One screen, one question. Reached from the thank-you the renter sends the
// day after a visit. Possession of the link is the proof (the same model as
// /cancel); the API refuses anything that isn't a completed renter booking.

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function RenterReviewPage() {
  const params = useParams<{ tenantId: string; appointmentId: string }>();
  const tenantId = String(params?.tenantId || '');
  const appointmentId = String(params?.appointmentId || '');
  const [info, setInfo] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!tenantId || !appointmentId) return;
    fetch(`/api/booths/renter-review?tenantId=${encodeURIComponent(tenantId)}&appointmentId=${encodeURIComponent(appointmentId)}`)
      .then((r) => r.json()).then((d) => { if (d?.ok) { setInfo(d); setName(d.clientFirst || ''); } else setErr(d?.error || 'This link is not valid.'); })
      .catch(() => setErr('Could not load this link.'));
  }, [tenantId, appointmentId]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/booths/renter-review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, appointmentId, rating, text, name }) });
      const d = await res.json().catch(() => ({}));
      if (d?.ok) setDone(true); else setErr(d?.error || 'Could not send that.');
    } finally { setBusy(false); }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-slate-50 px-5 py-10" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto w-full max-w-sm rounded-[2rem] border-2 border-slate-100 bg-white p-6">{children}</div>
    </div>
  );

  if (err && !info) return shell(<p className="text-center text-sm font-bold text-slate-700">{err}</p>);
  if (!info) return shell(<p className="text-center text-sm font-bold text-slate-400">Loading…</p>);
  if (done || info.alreadyReviewed) return shell(
    <div className="space-y-2 text-center">
      <p className="text-2xl">✨</p>
      <p className="text-sm font-black uppercase tracking-widest text-slate-800">Thank you</p>
      <p className="text-sm font-medium text-slate-600">{done ? `${info.providerName} will see your review shortly.` : 'You have already left a review for this visit.'}</p>
    </div>,
  );

  return shell(
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">How was it?</p>
        <p className="mt-1 text-lg font-black text-slate-900">Your {info.serviceName} with {info.providerName}</p>
      </div>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)}
            className={`h-12 w-12 rounded-2xl border-2 text-2xl ${rating >= n ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-300'}`}>★</button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 600))} rows={4} aria-label="Your review" placeholder="What did you love? Anything they should know?"
        className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-3 text-sm" />
      <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} aria-label="Your name as it should appear" placeholder="Your name (first name is fine)"
        className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
      {err && <p className="text-xs font-bold text-red-600">{err}</p>}
      <button type="button" onClick={submit} disabled={busy || rating === 0}
        className="h-12 w-full rounded-2xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send review'}</button>
      <p className="text-center text-[10px] font-bold text-slate-400">{info.providerName} reads every review and chooses which appear on their page.</p>
    </div>,
  );
}
