'use client';

// src/app/quote/[tenantId]/[id]/page.tsx — A CLIENT'S QUOTE, from the link the business sends (?k= is the quote's own
// key). What's quoted, the total and the deposit, when it runs out, and the business's terms; the client accepts it,
// asks for changes or declines it. Everything goes through api/quote: the page never reads or writes the business's
// records itself. No card is taken here: a deposit is asked for afterwards, with a payment link from the business.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const REASONS = [
  'The price is more than I planned',
  'I went with someone else',
  'The date doesn’t work anymore',
  'My plans changed',
  'I need more time to decide',
  'It isn’t what I’m looking for',
  'Something else',
];
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (d: string | null) => { if (!d) return ''; const x = new Date(`${d}T12:00:00Z`); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const hm = (t: string | null) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}`; };
const terms = (t: string | null) => t === 'net_30' ? 'The rest is due 30 days before the event.' : t === 'net_15' ? 'The rest is due 15 days before the event.' : t ? 'The rest is due as agreed.' : 'The rest is due as agreed with the business.';

type View = 'quote' | 'decline' | 'revise' | 'declined' | 'revised';

export default function PublicQuotePage() {
  const { id, tenantId } = useParams() as { id: string; tenantId: string };
  const k = useMemo(() => { try { return new URLSearchParams(window.location.search).get('k') || ''; } catch { return ''; } }, []);
  const [q, setQ] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [view, setView] = useState<View>('quote');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState('');

  const call = async (action: string, extra: any = {}) => {
    const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id, k, action, ...extra }) });
    return r.json().catch(() => ({ ok: false, error: 'That didn’t go through. Try again in a moment.' }));
  };

  useEffect(() => {
    if (!tenantId || !id) return;
    if (!k) { setState('denied'); setError('This link is missing part of itself. Open the link the business sent you.'); return; }
    const preview = (() => { try { return new URLSearchParams(window.location.search).get('p') === '1'; } catch { return false; } })();
    call('view', { preview }).then((d) => {
      if (d.ok) { setQ(d.quote); setState('ready'); }
      else { setState('denied'); setError(d.error || 'This link no longer opens a quote.'); }
    }).catch(() => { setState('denied'); setError('No connection. Check your signal and try again.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, id, k]);

  const act = async (action: string, extra: any, then: (d: any) => void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const d = await call(action, extra); if (d.ok) then(d); else { if (d.quote) setQ(d.quote); setError(d.error || 'That didn’t go through. Try again.'); } }
    catch { setError('No connection. Try again.'); }
    finally { setBusy(false); }
  };

  const btn = 'w-full min-h-[48px] rounded-full text-[15px] font-semibold transition active:scale-[.99] disabled:opacity-40 flex items-center justify-center px-5';
  const card = 'rounded-2xl p-5';
  const cardStyle = { background: '#fff', border: `1px solid ${LINE}` };
  const biz = q?.business || {};

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: SOFT, color: INK, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-xl mx-auto space-y-3">
        <div className="px-1 pb-2 flex items-center gap-3">
          {biz.logoUrl ? <img src={biz.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover" style={{ border: `1px solid ${LINE}` }} /> : null}
          <p className="text-[14px]" style={{ color: MUTED }}>{biz.name || 'Your quote'}</p>
        </div>

        {state === 'loading' && (
          <div className={`${card} flex justify-center p-10`} style={cardStyle}>
            <div className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading your quote" />
          </div>
        )}

        {state === 'denied' && (
          <div className={`${card} space-y-1`} style={cardStyle}>
            <p className="text-[16px] font-semibold">This link doesn’t open a quote</p>
            <p className="text-[14px]" style={{ color: MUTED }}>{error}</p>
          </div>
        )}

        {state === 'ready' && q && view === 'quote' && (
          <>
            <div className={`${card} space-y-1.5`} style={cardStyle}>
              <p className="text-[13px] font-medium" style={{ color: MUTED }}>Your quote</p>
              <h1 className="text-[26px] font-semibold tracking-tight leading-tight">{q.eventName}</h1>
              <p className="text-[15px]" style={{ color: MUTED }}>
                {[q.eventDay ? `${longDay(q.eventDay)}${q.startTime ? `, from ${hm(q.startTime)}` : ''}` : '', q.hours ? `${q.hours} hour${q.hours === 1 ? '' : 's'}` : '', q.place].filter(Boolean).join(' · ')}
              </p>
              {q.notes && <p className="text-[15px] pt-2 whitespace-pre-line" style={{ borderTop: `1px solid ${LINE}` }}>{q.notes}</p>}
            </div>

            {q.status === 'draft' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff', border: `1px solid ${LINE}` }}>A preview: this quote hasn’t been sent yet. It’s how your client will see it.</div>}
            {q.status === 'accepted' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#ecf6f0', color: GREEN, border: `1px solid ${LINE}` }}>You accepted this quote. {q.deposit > 0 ? `${biz.name || 'The business'} will send you a link to pay the ${usd(q.deposit)} deposit.` : `${biz.name || 'The business'} will be in touch with what’s next.`}</div>}
            {q.status === 'declined' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff', border: `1px solid ${LINE}` }}>You declined this quote.</div>}
            {q.status === 'expired' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: AMBER, border: `1px solid ${LINE}` }}>This quote has run out. Ask {biz.name || 'the business'} for a new one.</div>}
            {q.status === 'revision_requested' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: AMBER, border: `1px solid ${LINE}` }}>You asked for changes. {biz.name || 'The business'} will send you an updated quote.</div>}

            <div className={card} style={cardStyle}>
              <p className="text-[13px] font-medium" style={{ color: MUTED }}>What’s included</p>
              <div className="mt-2">
                {q.lines.map((l: any, i: number) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                    <span className="min-w-0">{l.name}{l.quantity > 1 ? <span style={{ color: MUTED }}> × {l.quantity}</span> : null}</span>
                    <span className="tabular-nums shrink-0">{usd(l.price * l.quantity)}</span>
                  </div>
                ))}
                {q.travel > 0 && <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]" style={{ borderTop: `1px solid ${LINE}` }}><span>Travel</span><span className="tabular-nums">{usd(q.travel)}</span></div>}
                {q.fee > 0 && <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]" style={{ borderTop: `1px solid ${LINE}` }}><span>Project fee ({q.feePercent}%)</span><span className="tabular-nums">{usd(q.fee)}</span></div>}
                <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 text-[18px] font-semibold" style={{ borderTop: `1px solid ${INK}` }}><span>Total</span><span className="tabular-nums">{usd(q.total)}</span></div>
                {q.deposit > 0 && (
                  <p className="text-[14px] mt-2" style={{ color: MUTED }}>A {usd(q.deposit)} deposit holds your date, paid after you accept with a link from {biz.name || 'the business'}. {terms(q.paymentTerms)}</p>
                )}
              </div>
            </div>

            {q.open && q.expiresAt && <p className="text-[13.5px] px-1" style={{ color: AMBER }}>Open until {new Date(q.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Accept by then to hold your date.</p>}

            {q.cancellationPolicy && (
              <div className={card} style={cardStyle}>
                <p className="text-[13px] font-medium" style={{ color: MUTED }}>If plans change</p>
                <p className="text-[14px] mt-1.5 whitespace-pre-line">{q.cancellationPolicy}</p>
              </div>
            )}

            {q.open && (
              <div className="space-y-2.5 pt-1">
                <button type="button" onClick={() => act('accept', { total: q.total }, (d) => setQ(d.quote))} disabled={busy} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Accepting…' : `Accept this quote, ${usd(q.total)}`}</button>
                <div className="grid grid-cols-2 gap-2.5">
                  <button type="button" onClick={() => { setView('revise'); setError(''); }} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Ask for changes</button>
                  <button type="button" onClick={() => { setView('decline'); setError(''); }} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Decline</button>
                </div>
              </div>
            )}
          </>
        )}

        {state === 'ready' && view === 'revise' && (
          <div className={`${card} space-y-3`} style={cardStyle}>
            <p className="text-[18px] font-semibold">What would you like changed?</p>
            <label className="block text-[13px]" style={{ color: MUTED }}>Your note to {biz.name || 'the business'}
              <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={4} maxLength={1000} className="mt-1 w-full rounded-xl px-3 py-2.5 text-[15px]" style={{ border: `1px solid ${LINE}`, color: INK }} placeholder="For example: one more person, or a later start" />
            </label>
            <button type="button" onClick={() => act('revise', { message: ask }, () => setView('revised'))} disabled={busy || ask.trim().length < 3} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Sending…' : 'Send'}</button>
            <button type="button" onClick={() => setView('quote')} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Back to the quote</button>
          </div>
        )}

        {state === 'ready' && view === 'decline' && (
          <div className={`${card} space-y-3`} style={cardStyle}>
            <p className="text-[18px] font-semibold">Decline this quote?</p>
            <p className="text-[14px]" style={{ color: MUTED }}>Telling {biz.name || 'the business'} why is optional, and helps them.</p>
            <div className="space-y-2" role="radiogroup" aria-label="Why you’re declining">
              {REASONS.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={reason === x} onClick={() => setReason(reason === x ? '' : x)}
                  className="w-full min-h-[44px] rounded-xl px-3.5 text-left text-[15px]" style={{ border: `1px solid ${reason === x ? INK : LINE}`, background: reason === x ? SOFT : '#fff', color: INK, fontWeight: reason === x ? 600 : 400 }}>{x}</button>
              ))}
            </div>
            <label className="block text-[13px]" style={{ color: MUTED }}>Anything else (optional)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-xl px-3 py-2.5 text-[15px]" style={{ border: `1px solid ${LINE}`, color: INK }} />
            </label>
            <button type="button" onClick={() => act('decline', { reason: reason || 'Something else', note }, () => setView('declined'))} disabled={busy} className={btn} style={{ background: RED, color: '#fff' }}>{busy ? 'Sending…' : 'Decline the quote'}</button>
            <button type="button" onClick={() => setView('quote')} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Back to the quote</button>
          </div>
        )}

        {state === 'ready' && (view === 'declined' || view === 'revised') && (
          <div className={`${card} space-y-1`} style={cardStyle}>
            <p className="text-[16px] font-semibold">{view === 'declined' ? 'You declined the quote' : 'Your note is on its way'}</p>
            <p className="text-[14px]" style={{ color: MUTED }}>{view === 'declined' ? `Thank you for letting ${biz.name || 'the business'} know. If your plans change, ask them for a new quote.` : `${biz.name || 'The business'} will send you an updated quote.`}</p>
          </div>
        )}

        {error && state === 'ready' && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: AMBER, border: `1px solid ${LINE}` }} role="alert">{error}</div>}

        {state === 'ready' && (biz.email || biz.phone) && (
          <p className="text-center text-[13px] pt-2" style={{ color: MUTED }}>
            Questions about it? {biz.email ? <a href={`mailto:${biz.email}`} className="underline underline-offset-2 inline-flex items-center min-h-[44px]" style={{ color: INK }}>{biz.email}</a> : null}{biz.email && biz.phone ? ' or ' : ''}{biz.phone ? <a href={`tel:${biz.phone}`} className="underline underline-offset-2 inline-flex items-center min-h-[44px]" style={{ color: INK }}>{biz.phone}</a> : null}
          </p>
        )}
      </div>
    </div>
  );
}
