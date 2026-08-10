'use client';

// ─── /shop/[tenantId]/library/[orderId] ──────────────────────────────────────
// The customer's private shelf for what they bought. Everything opens INSIDE
// the app: the file is fetched through a short-lived signed link the page
// requests per view, never a permanent address, and the buyer's name, email
// and order number sit watermarked across the frame the whole time.
//
// The honest limit, stated to the customer as well as in code: a screen can
// always be photographed. The watermark makes any leaked capture point back
// at the account that made it, which is the deterrent that actually works
// for a small shop. Everything else here — expiring links, no download
// button, ownership re-checked on every open — raises the effort of casual
// sharing rather than pretending piracy is solvable.

import { Loader, Lock } from 'lucide-react';
import React, { useEffect, useState } from 'react';

type Item = { productId: string; name: string; opened?: boolean };

export default function LibraryPage({ params }: { params: Promise<{ tenantId: string; orderId: string }> }) {
  const { tenantId, orderId } = React.use(params);
  const [token, setToken] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ url: string; name: string; watermark: string; kind: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    if (!t) { setErr('This link is missing its key \u2014 open your library from your order page.'); return; }
    setToken(t);
    (async () => {
      try {
        const res = await fetch(`/api/retail/order-status?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(t)}`);
        const d = await res.json();
        if (!res.ok) { setErr(d.error || 'This library could not be loaded.'); return; }
        const digital = (d.order?.lines || []).filter((l: any) => l.digital === true);
        if (digital.length === 0) setErr('There\u2019s nothing digital on this order.');
        setItems(digital.map((l: any) => ({ productId: l.productId, name: l.name })));
      } catch {
        setErr('This library could not be loaded \u2014 check your connection.');
      }
    })();
  }, [tenantId, orderId]);

  const open = async (it: Item) => {
    if (busy) return;
    setBusy(it.productId);
    try {
      const res = await fetch('/api/retail/digital-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken: token, productId: it.productId }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not open that.'); return; }
      if (d.kind === 'link') { window.open(d.url, '_blank', 'noopener,noreferrer'); return; }
      setViewing({ url: d.url, name: d.name, watermark: d.watermark, kind: d.kind });
    } catch {
      setErr('Could not open that \u2014 try again.');
    } finally {
      setBusy(null);
    }
  };

  if (viewing) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-black uppercase tracking-widest">{viewing.name}</p>
          <button
            onClick={() => setViewing(null)}
            className="h-9 rounded-xl border-2 px-3 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
          >
            Close
          </button>
        </div>
        <div className="relative overflow-hidden rounded-2xl border-2">
          <iframe src={viewing.url} title={viewing.name} className="h-[70vh] w-full bg-white" />
          <div className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-10 opacity-[0.14]">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <p key={i} className="rotate-[-24deg] text-xs font-black uppercase tracking-widest">{viewing.watermark}</p>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[11px] font-bold text-muted-foreground">
          Licensed to {viewing.watermark}. This copy is personal \u2014 please don\u2019t share or repost it.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-5">
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-4 w-4" aria-hidden="true" />
        <h1 className="text-[11px] font-black uppercase tracking-widest">Your library</h1>
      </div>

      {err && <p className="mb-4 text-sm font-bold text-muted-foreground">{err}</p>}

      {items.length === 0 && !err ? (
        <div className="flex justify-center py-10">
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading your library" />
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <button
              key={it.productId}
              onClick={() => open(it)}
              disabled={busy === it.productId}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-4 text-left hover:bg-muted"
            >
              <span className="text-sm font-bold">{it.name}</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {busy === it.productId ? 'Opening\u2026' : 'Open'}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] font-bold text-muted-foreground">
        These open here in the app and stay tied to your order \u2014 no expiring downloads to keep track of. Come back any time.
      </p>
    </div>
  );
}
