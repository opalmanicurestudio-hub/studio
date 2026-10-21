'use client';
// src/components/shop/AddressReview.tsx — "IS THIS ADDRESS RIGHT?" for customers, at checkout and on their order page.
// The address is checked with the carrier (api/retail/address-check) when they go to pay or save a change. Most of the
// time nothing shows and it goes straight through. Otherwise one question, then on:
//   suggest   the carrier's version differs in a way that matters: use it, or keep what they typed
//   unit      it looks like it needs an apartment or unit number: add it, or say there isn't one (asked once)
//   notfound  the carrier can't find it: edit it, or use it anyway (unless the shop turns those away)
// The signed check goes along with what they submit, so the carrier isn't asked twice.
import * as React from 'react';
import { Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { meaningfulChanges } from '@/lib/address-flow';

export type ReviewAddress = { name?: string; line1: string; line2: string; city: string; state: string; postalCode: string };
export type AddrReview = { kind: 'suggest' | 'unit' | 'notfound'; token: string; carrier?: any; refuse?: boolean; message?: string };
export type ReviewSubmit = (o: { token?: string; unitAnswer?: 'added' | 'none'; address: ReviewAddress }) => void;

export function useAddressReview(tenantId: string, submit: ReviewSubmit, onAddress?: (a: ReviewAddress) => void) {
  const [review, setReview] = React.useState<AddrReview | null>(null);
  const [pick, setPick] = React.useState<'carrier' | 'typed'>('carrier');
  const [unit, setUnit] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const [base, setBase] = React.useState<ReviewAddress | null>(null);

  const check = async (a: ReviewAddress): Promise<any | null> => {
    try {
      const res = await fetch('/api/retail/address-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, address: a }) });
      const d = await res.json().catch(() => ({}));
      return res.ok && d.ok ? d : null;
    } catch { return null; }
  };
  const route = (d: any, a: ReviewAddress, unitAnswer?: 'added' | 'none') => {
    setBase(a);
    if (d.verdict === 'corrected' && d.carrier) { setPick('carrier'); setReview({ kind: 'suggest', token: d.token, carrier: d.carrier }); return; }
    if (d.verdict === 'undeliverable') { setReview({ kind: 'notfound', token: d.token, refuse: d.refuse === true, message: d.message || '' }); return; }
    if (d.unitMissing && !unitAnswer) { setUnit(''); setReview({ kind: 'unit', token: d.token }); return; }
    setReview(null); submit({ token: d.token, unitAnswer, address: a });
  };
  /** Check this address; submits straight away when there's nothing to ask (or the check couldn't run). */
  const start = async (a: ReviewAddress) => {
    setChecking(true); const d = await check(a); setChecking(false);
    if (!d) { setReview(null); submit({ address: a }); return; }
    route(d, a);
  };
  const act = async (how: 'continue' | 'unit' | 'no_unit' | 'anyway') => {
    const r = review; const a = base; if (!r || !a) return;
    if (how === 'continue') {
      if (pick === 'carrier' && r.carrier) {
        const c: ReviewAddress = { ...a, line1: String(r.carrier.line1 || ''), line2: String(r.carrier.line2 || ''), city: String(r.carrier.city || ''), state: String(r.carrier.state || ''), postalCode: String(r.carrier.postalCode || '') };
        onAddress?.(c); setReview(null); submit({ token: r.token, address: c });
      } else { setReview(null); submit({ token: r.token, address: a }); }
      return;
    }
    if (how === 'unit') {
      const a2 = { ...a, line2: unit.trim() }; if (!a2.line2) return;
      onAddress?.(a2); setChecking(true); const d = await check(a2); setChecking(false);
      if (!d) { setReview(null); submit({ address: a2, unitAnswer: 'added' }); return; }
      // Asked once: if the carrier still can't confirm it, it goes through, and the shop sees that when they ship.
      route(d, a2, 'added');
      return;
    }
    if (how === 'no_unit') { setReview(null); submit({ token: r.token, unitAnswer: 'none', address: a }); return; }
    if (how === 'anyway' && r.kind === 'notfound' && !r.refuse) { setReview(null); submit({ token: r.token, address: a }); }
  };
  return { review, setReview, pick, setPick, unit, setUnit, checking, base, start, act };
}

export function AddressReviewPanel({ ar, busy, continueLabel, onEdit }: {
  ar: ReturnType<typeof useAddressReview>; busy?: boolean; continueLabel: string; onEdit: () => void;
}) {
  const r = ar.review; const a = ar.base; if (!r || !a) return null;
  const wait = busy || ar.checking;
  const spin = <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />;
  const btn = 'w-full h-12 rounded-2xl font-black uppercase text-xs tracking-widest';
  const link = 'w-full py-2 text-[11px] font-black uppercase tracking-widest underline underline-offset-4';
  return (
    <div className="space-y-3 rounded-2xl border-2 border-foreground/70 p-4" role="group" aria-labelledby="addr-review-title">
      {r.kind === 'suggest' && r.carrier && (() => {
        const ch = meaningfulChanges(a, r.carrier); const c = r.carrier;
        const hi = (on: boolean, t: string) => (on ? <span className="rounded bg-primary/10 px-0.5 text-primary">{t}</span> : t);
        const opt = (id: 'carrier' | 'typed', head: string, body: React.ReactNode) => (
          <button type="button" role="radio" aria-checked={ar.pick === id} onClick={() => ar.setPick(id)}
            className={cn('flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all', ar.pick === id ? 'border-primary bg-primary/5' : 'hover:border-primary/30')}>
            <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border-2', ar.pick === id ? 'border-[5px] border-primary' : 'border-muted-foreground/40')} aria-hidden="true" />
            <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest">{head}</span><span className="mt-1 block text-sm font-bold leading-snug">{body}</span></span>
          </button>);
        return (<>
          <p id="addr-review-title" className="text-[11px] font-black uppercase tracking-widest">Check your address</p>
          <p className="text-[12px] font-bold text-muted-foreground">The carrier has it a little differently. Using their version helps it arrive on time.</p>
          <div className="space-y-2" role="radiogroup" aria-label="Which address to use">
            {opt('carrier', 'Use the carrier’s version', <>{hi(ch.includes('street'), [c.line1, c.line2].filter(Boolean).join(', '))}<br />{hi(ch.includes('city'), c.city)}, {hi(ch.includes('state'), c.state)} {hi(ch.includes('postalCode'), c.postalCode)}</>)}
            {opt('typed', 'Keep what I typed', <>{[a.line1, a.line2].filter(Boolean).join(', ')}<br />{a.city}, {a.state} {a.postalCode}</>)}
          </div>
          <Button disabled={wait} onClick={() => void ar.act('continue')} className={btn}>{wait ? spin : continueLabel}</Button>
        </>);
      })()}
      {r.kind === 'unit' && (<>
        <p id="addr-review-title" className="text-[11px] font-black uppercase tracking-widest">Is there an apartment or unit number?</p>
        <p className="text-[12px] font-bold text-muted-foreground">This address looks like it has more than one unit. Without the number, the carrier may not be able to deliver it.</p>
        <Input autoFocus placeholder="Apt, suite or unit" aria-label="Apartment, suite or unit" autoComplete="address-line2" value={ar.unit}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => ar.setUnit(e.target.value)} onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void ar.act('unit'); }}
          className="h-12 rounded-xl border-2 font-bold text-sm" />
        <Button disabled={wait || !ar.unit.trim()} onClick={() => void ar.act('unit')} className={btn}>{wait ? spin : 'Add it and continue'}</Button>
        <button type="button" disabled={wait} onClick={() => void ar.act('no_unit')} className={link}>There isn’t one</button>
      </>)}
      {r.kind === 'notfound' && (<>
        <p id="addr-review-title" className="text-[11px] font-black uppercase tracking-widest">We couldn’t find this address</p>
        <p className="text-[12px] font-bold text-muted-foreground">{r.refuse ? (r.message || 'The carrier couldn’t find it. Check the street and ZIP code and try again.') : 'The carrier couldn’t find it. Check the street and ZIP code. If it’s a new building or a rural route, you can still use it.'}</p>
        <Button onClick={onEdit} className={btn}>Edit the address</Button>
        {!r.refuse && <button type="button" disabled={wait} onClick={() => void ar.act('anyway')} className={link}>{wait ? 'One moment…' : 'Use it anyway'}</button>}
      </>)}
      {r.kind !== 'notfound' && <button type="button" onClick={onEdit} className="w-full py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground underline underline-offset-4">Edit the address</button>}
    </div>);
}
