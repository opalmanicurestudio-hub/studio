'use client';
// src/components/shop/OrderReviews.tsx — "HOW DID IT GO?" ON THE ORDER PAGE (mockup 9D, lib/reviews). Once the order has
// been picked up, delivered or shipped, the customer can review each thing on it: stars, a few words, signed with their
// first name and last initial. What they wrote shows here, and they can change it. Only someone holding the order can
// (api/retail/reviews checks the order's own code). Opened straight away from the review email (?review=1).
import * as React from 'react';

const ink = '#16171a'; const muted = '#6d7075'; const line = '#ececee'; const green = '#1f7a4d'; const amber = '#b45309';
const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z';

/** The customer's own review. Without their pass the order page gets only the stars (api/retail/order-status). */
export type Mine = { rating: number; title?: string; body?: string };

export function OrderReviews({ tenantId, orderId, token, items, mine, signedAs, shopReadsFirst, onSaved }: {
  tenantId: string; orderId: string; token: string; items: { productId: string; name: string }[];
  mine: Record<string, Mine>; signedAs: string; shopReadsFirst: boolean; onSaved: () => void;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [rating, setRating] = React.useState(0);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState<{ id: string; text: string; bad?: boolean } | null>(null);
  const [local, setLocal] = React.useState<Record<string, Mine>>({});
  const all = { ...mine, ...local };
  const focusSoon = (sel: string) => setTimeout(() => { try { document.querySelector<HTMLElement>(sel)?.focus(); } catch { /* fine */ } }, 30);
  const start = (id: string) => { const m = all[id]; setOpen(id); setRating(m?.rating || 0); setTitle(m?.title || ''); setBody(m?.body || ''); setSaid(null); focusSoon(`[data-rv-star="${CSS.escape(id)}"]`); };
  const close = (id: string) => { setOpen(null); focusSoon(`[data-rv-item="${CSS.escape(id)}"]`); };

  // From the review email: straight to the first thing they haven't reviewed yet.
  const arrived = React.useRef(false);
  React.useEffect(() => {
    if (arrived.current || !items.length) return;
    let ask = false; try { ask = new URLSearchParams(window.location.search).get('review') === '1' || window.location.hash === '#review'; } catch { /* not from the email */ }
    if (!ask) return;
    arrived.current = true;
    const next = items.find((i) => !all[i.productId]);
    if (next) start(next.productId);
    setTimeout(() => { try { document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* fine where it is */ } }, 150);
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (id: string) => {
    if (busy || rating < 1 || body.trim().length < 4) return;
    setBusy(true); setSaid(null);
    try {
      const res = await fetch('/api/retail/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, productId: id, qrToken: token, rating, title: title.trim(), body: body.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(d?.error || 'That didn’t post. Try again.');
      setLocal((m) => ({ ...m, [id]: { rating, title: title.trim(), body: body.trim() } }));
      setOpen(null); setSaid({ id, text: d.message || 'Thank you for your review.' }); focusSoon(`[data-rv-item="${CSS.escape(id)}"]`);
      onSaved();
    } catch (e: any) { setSaid({ id, text: e?.message || 'That didn’t post. Try again.', bad: true }); }
    finally { setBusy(false); }
  };

  if (!items.length) return null;
  return (
    <section id="review" aria-labelledby="review-h" className="scroll-mt-24 overflow-hidden rounded-[2rem] border-2 bg-white p-5 text-left" style={{ color: ink }}>
      <h2 id="review-h" className="m-0 text-[26px] font-light leading-tight tracking-[-0.02em]">How did it go?</h2>
      <p className="m-0 mt-1.5 text-[14px] leading-snug" style={{ color: muted }}>Tell other shoppers what you think. Only people who bought it can leave a review.</p>
      <div className="mt-4 space-y-3">
        {items.map((it) => {
          const m = all[it.productId]; const isOpen = open === it.productId;
          // What they wrote comes only with their pass; without it they see their stars, and can't write over words they can't see.
          const editable = !m || typeof m.body === 'string';
          if (!isOpen) return (
            <div key={it.productId} className="rounded-2xl p-4" style={{ border: `1px solid ${line}` }}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[15px] font-semibold">{it.name}</p>
                  {m && <p className="m-0 mt-0.5 text-[13px] font-semibold" style={{ color: green }}>You gave it {m.rating} star{m.rating === 1 ? '' : 's'}</p>}
                </div>
                {editable && <button type="button" data-rv-item={it.productId} onClick={() => start(it.productId)} disabled={busy} aria-label={m ? `Edit your review of ${it.name}` : `Write a review of ${it.name}`}
                  className="h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold" style={m ? { border: `1px solid ${line}`, background: '#fff', color: ink } : { background: ink, color: '#fff' }}>
                  {m ? 'Edit' : 'Write a review'}
                </button>}
              </div>
              {said?.id === it.productId && <p role={said.bad ? 'alert' : 'status'} className="m-0 mt-2 text-[13px]" style={{ color: said.bad ? amber : green }}>{said.text}</p>}
            </div>);
          return (
            <form key={it.productId} onSubmit={(e) => { e.preventDefault(); void post(it.productId); }} className="space-y-3 rounded-2xl p-[15px]" style={{ border: `2px solid ${ink}` }}>
              <p className="m-0 text-[15px] font-semibold">{it.name}</p>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-2 p-0 text-[13px] font-semibold" style={{ color: muted }}>Your rating</legend>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" {...(n === 1 ? { 'data-rv-star': it.productId } : {})} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={rating === n} onClick={() => setRating(n)}
                      className="grid h-12 w-12 place-items-center rounded-[14px]" style={n <= rating ? { background: ink, border: `1px solid ${ink}` } : { background: '#fff', border: `1px solid ${line}` }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d={STAR} fill={n <= rating ? '#fff' : '#d9dadd'} /></svg>
                    </button>))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: muted }}>Sum it up (optional)</span>
                <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="h-12 w-full rounded-[14px] px-3 text-[16px] outline-none" style={{ border: `1px solid ${line}` }} />
              </label>
              <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: muted }}>Your review</span>
                <textarea value={body} maxLength={1200} rows={3} onChange={(e) => setBody(e.target.value)} placeholder="What did you think?" className="w-full rounded-[14px] px-3 py-2.5 text-[16px] outline-none" style={{ border: `1px solid ${line}` }} />
              </label>
              <p className="m-0 text-[13px]" style={{ color: muted }}>{signedAs ? `Shows as ${signedAs}` : 'Shows with your first name and last initial'}</p>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || rating < 1 || body.trim().length < 4} className="h-12 flex-1 rounded-full px-5 text-[15px] font-semibold disabled:opacity-50" style={{ background: ink, color: '#fff' }}>{busy ? 'Posting…' : m ? 'Save changes' : 'Post review'}</button>
                <button type="button" disabled={busy} onClick={() => close(it.productId)} className="h-12 rounded-full px-5 text-[15px] font-semibold" style={{ border: `1px solid ${line}`, background: '#fff', color: ink }}>Cancel</button>
              </div>
              {(rating < 1 || body.trim().length < 4) && !busy && <p className="m-0 text-[13px]" style={{ color: muted }}>{rating < 1 ? 'Choose your stars and add a few words to post.' : 'Add a few words to post.'}</p>}
              {said?.id === it.productId && said.bad && <p role="alert" className="m-0 text-[13px]" style={{ color: amber }}>{said.text}</p>}
            </form>);
        })}
      </div>
      {shopReadsFirst && <p className="m-0 mt-3 text-[13px]" style={{ color: muted }}>The shop may read reviews before they show.</p>}
    </section>);
}
