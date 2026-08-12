'use client';

// ─── /shop/[tenantId]/pickup?spot=4 ──────────────────────────────────────────
// Where a scanned spot sign lands.
//
// The sign is public and identical for every customer, so it cannot know WHO
// scanned it. It knows only the bay. This page closes that gap using what the
// customer's own phone already has: the order link they were sent. If this
// browser has an order open (or has had one), we check them in with the spot
// filled in and nobody types anything. If not, we ask for the order link
// rather than pretending — a stranger scanning a sign in the car park must
// never be able to check in someone else's order.
//
// Deliberately simple and offline-tolerant: one bar of signal in a car park is
// the normal case, which is exactly where a GPS geofence gives up and a QR
// still works.

import { Car, Loader } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

const LAST_ORDER_KEY = (tenantId: string) => `clarityflow-last-order-${tenantId}`;

export default function PickupSpotPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = React.use(params);
  const [spot, setSpot] = useState('');
  const [state, setState] = useState<'working' | 'done' | 'need_order' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const s = (qs.get('spot') || '').trim().slice(0, 40);
    setSpot(s);

    let remembered: { orderId: string; token: string } | null = null;
    try {
      const raw = window.localStorage.getItem(LAST_ORDER_KEY(tenantId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.orderId && parsed?.token) remembered = parsed;
      }
    } catch { /* private mode, cleared storage — fall through to asking */ }

    if (!remembered) { setState('need_order'); return; }

    (async () => {
      try {
        const res = await fetch('/api/retail/arrive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            orderId: remembered!.orderId,
            qrToken: remembered!.token,
            spotOrVehicle: s ? `Spot ${s}` : '',
            source: 'sign_qr',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState('error');
          setMessage(data.error || 'We could not check you in from here.');
          return;
        }
        setState('done');
        setMessage(
          data.early
            ? 'Your order is still being finished — we know where you are and will bring it out.'
            : 'Someone is on their way out to you.',
        );
      } catch {
        setState('error');
        setMessage('That did not go through. Open your order link and tap “I’m here”.');
      }
    })();
  }, [tenantId]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-primary/30 bg-primary/5 text-primary">
        <Car className="h-7 w-7" aria-hidden="true" />
      </span>

      {spot && (
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          Spot {spot}
        </p>
      )}

      {state === 'working' && (
        <>
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Checking you in" />
          <p className="text-sm font-bold text-muted-foreground">Letting them know you&apos;re here…</p>
        </>
      )}

      {state === 'done' && (
        <>
          <h1 className="text-lg font-black uppercase tracking-tight">You&apos;re checked in</h1>
          <p className="text-sm font-bold text-muted-foreground">{message}</p>
        </>
      )}

      {state === 'need_order' && (
        <>
          <h1 className="text-lg font-black uppercase tracking-tight">Almost there</h1>
          <p className="text-sm font-bold text-muted-foreground">
            Open the order link from your confirmation email or text on this phone, then tap
            &ldquo;I&apos;m here&rdquo; — it&apos;ll already know you&apos;re in spot {spot || 'your spot'}.
          </p>
          <Link
            href={`/shop/${tenantId}/account`}
            className="mt-1 flex h-11 w-full items-center justify-center rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
          >
            Find my order
          </Link>
        </>
      )}

      {state === 'error' && (
        <>
          <h1 className="text-lg font-black uppercase tracking-tight">Hmm</h1>
          <p className="text-sm font-bold text-muted-foreground">{message}</p>
          <Link
            href={`/shop/${tenantId}/account`}
            className="mt-1 flex h-11 w-full items-center justify-center rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
          >
            Find my order
          </Link>
        </>
      )}
    </div>
  );
}
