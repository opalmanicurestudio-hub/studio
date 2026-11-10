'use client';
// What comes with your space (Space → the first row of papers). The business decides, tool by tool, what's included
// with the space, what a renter can add for a monthly price, and what isn't offered (lib/renter-offers, set in What
// renters get). Adding one is charged to their saved card from today, then each month on the same day, with a receipt;
// stopping one stops the charges, and time already paid for keeps working until it runs out (actions tools-get,
// addon-add and addon-stop on /api/portal/renter).
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SectionTitle, OpenScreenContext, fmtDate } from '@/components/rent/shared';
import { api } from '@/components/rent/studio';
import { biz } from '@/components/rent/biz';
import { money, type RenterOfferLine } from '@/lib/renter-offers';

type Data = { lines: RenterOfferLine[]; card: { brand: string | null; last4: string | null } | null; businessTakesCards: boolean; booksHere: boolean };

const btn = 'h-11 rounded-full border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-50';
const dark = 'h-11 rounded-full bg-[#16171a] px-4 text-[15px] font-medium text-white disabled:opacity-50';
const when = (iso?: string | null) => { const d = new Date(String(iso || '')); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export function RenterTools({ tenantId, token }: { tenantId: string; token: string }) {
  const openScreen = useContext(OpenScreenContext);
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<{ key: string; what: 'add' | 'stop' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ key: string; t: string } | null>(null);
  const [done, setDone] = useState<{ key: string; t: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api({ action: 'tools-get', tenantId, token });
    if (r?.ok) { setD(r); setFailed(false); } else setFailed(true);
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  // A question opened near the bottom would sit under the place bar: bring it into view.
  const askRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (asking) askRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [asking]);

  if (!d) {
    return failed
      ? <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececee] bg-white px-4 py-3"><p className="text-[14px] text-[#b45309]">This list couldn’t load.</p><button type="button" onClick={() => void load()} className={btn}>Try again</button></div>
      : <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] text-[#6d7075]">Loading…</p>;
  }

  const act = async (l: RenterOfferLine, what: 'add' | 'stop') => {
    setBusy(true); setErr(null); setDone(null);
    const r = await api({ action: what === 'add' ? 'addon-add' : 'addon-stop', tenantId, token, key: l.key, priceCents: l.priceCents });
    setBusy(false);
    if (r?.lines) setD(r);
    if (!r?.ok) { setErr({ key: l.key, t: r?.error || 'That didn’t go through. Try again.' }); setAsking(null); return; }
    setAsking(null);
    setDone({ key: l.key, t: what === 'add' ? 'Added. Your receipt comes by email.' : 'Stopped. It won’t be charged again.' });
  };

  const included = d.lines.filter((l) => l.state === 'included');
  const addOns = d.lines.filter((l) => l.state === 'addon' || l.state === 'added');
  const off = d.lines.filter((l) => l.state === 'off');
  const card = d.card ? `${d.card.brand ? d.card.brand.charAt(0).toUpperCase() + d.card.brand.slice(1) : 'Card'} ending ${d.card.last4 || '····'}` : null;
  const openBtn = (l: RenterOfferLine) => (l.view && openScreen && d.booksHere
    ? <button type="button" onClick={() => openScreen({ view: l.view })} className={`${btn} shrink-0`} aria-label={`Open ${l.title}`}>Open</button>
    : null);

  return (
    <section className="space-y-6">
      <SectionTitle>What comes with your space</SectionTitle>
      <p className="px-1 text-[14px] leading-relaxed text-[#6d7075]">{d.booksHere
        ? `What ${biz()} includes with your space, what you can add for a monthly price, and what isn’t offered here.`
        : 'You don’t take bookings here right now, so these tools aren’t in use. Here’s the add-on you still have, so you can stop it.'}</p>

      {d.booksHere && <div className="space-y-2">
        <h3 className="px-1 text-[14px] font-semibold text-[#6d7075]">Included with your space</h3>
        <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
          <li className="px-4 py-3.5">
            <p className="text-[15px] font-medium text-[#16171a]">Calendar, booking and client reminders</p>
            <p className="text-[13px] leading-snug text-[#6d7075]">Always part of your space.</p>
          </li>
          {included.map((l) => (
            <li key={l.key} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-[#16171a]">{l.title}</p>
                <p className="text-[13px] leading-snug text-[#6d7075]">{l.sub}</p>
              </div>
              {openBtn(l)}
            </li>
          ))}
        </ul>
      </div>}

      {addOns.length > 0 && (
        <div className="space-y-2">
          <h3 className="px-1 text-[14px] font-semibold text-[#6d7075]">Add-ons</h3>
          <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
            {addOns.map((l) => {
              const mine = l.state === 'added';
              const ask = asking?.key === l.key ? asking.what : null;
              return (
                <li key={l.key} className="space-y-3 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-[#16171a]">{l.title}</p>
                      <p className="text-[13px] leading-snug text-[#6d7075]">{l.sub}</p>
                      {mine && !l.stopped && <p className="text-[13px] text-[#1f7a4d]">Added {when(l.startedAt)}</p>}
                      {mine && l.stopped && <p className="text-[13px] text-[#6d7075]">Stopped. You can use it until {fmtDate(l.endsOn)}.</p>}
                    </div>
                    <p className="shrink-0 text-[15px] font-medium tabular-nums text-[#16171a]">{money(l.priceCents)}<span className="text-[13px] font-normal text-[#6d7075]"> a month</span></p>
                  </div>

                  {!ask && (
                    <div className="flex flex-wrap gap-2">
                      {(!mine || l.stopped) && <button type="button" onClick={() => { setAsking({ key: l.key, what: 'add' }); setErr(null); setDone(null); }} className={dark}>{mine ? 'Add it again' : 'Add'}</button>}
                      {mine && openBtn(l)}
                      {mine && !l.stopped && <button type="button" onClick={() => { setAsking({ key: l.key, what: 'stop' }); setErr(null); setDone(null); }} className="h-11 rounded-full border border-[#f1c7c2] bg-white px-4 text-[15px] font-medium text-[#b42318]">Stop</button>}
                    </div>
                  )}

                  {ask === 'add' && (
                    <div ref={askRef} className="scroll-mb-28 space-y-3 rounded-2xl bg-[#f5f5f7] p-3">
                      {card ? (
                        <>
                          <p className="text-[14px] leading-relaxed text-[#16171a]">
                            {l.stopped && l.endsOn
                              ? `It carries on from ${fmtDate(l.endsOn)}, when ${money(l.priceCents)} is charged to your ${card}, then on the same day each month.`
                              : `${money(l.priceCents)} is charged to your ${card} today, then on the same day each month.`} A receipt comes by email each time, and you can stop it here any time.
                          </p>
                          <div className="flex gap-2">
                            <button type="button" disabled={busy} onClick={() => void act(l, 'add')} className={`${dark} flex-1`}>{busy ? 'Adding…' : `Add for ${money(l.priceCents)} a month`}</button>
                            <button type="button" disabled={busy} onClick={() => setAsking(null)} className={btn}>Not now</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[14px] leading-relaxed text-[#16171a]">Add-ons are charged to your saved card each month. Save a card first, then come back here.</p>
                          <div className="flex gap-2">
                            {openScreen && <button type="button" onClick={() => openScreen({ tab: 'money' })} className={`${dark} flex-1`}>Save a card</button>}
                            <button type="button" onClick={() => setAsking(null)} className={btn}>Not now</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {ask === 'stop' && (
                    <div ref={askRef} className="scroll-mb-28 space-y-3 rounded-2xl bg-[#f5f5f7] p-3">
                      <p className="text-[14px] leading-relaxed text-[#16171a]">Stop this add-on? It won’t be charged again. Anything you’ve already paid for this month keeps working until it runs out.</p>
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void act(l, 'stop')} className="h-11 flex-1 rounded-full bg-[#b42318] px-4 text-[15px] font-medium text-white disabled:opacity-50">{busy ? 'Stopping…' : 'Stop it'}</button>
                        <button type="button" disabled={busy} onClick={() => setAsking(null)} className={btn}>Keep it</button>
                      </div>
                    </div>
                  )}

                  {err?.key === l.key && <p role="alert" className="text-[14px] text-[#b45309]">{err.t}</p>}
                  {done?.key === l.key && <p role="status" className="text-[14px] text-[#1f7a4d]">{done.t}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {off.length > 0 && (
        <div className="space-y-2">
          <h3 className="px-1 text-[14px] font-semibold text-[#6d7075]">Not offered here</h3>
          <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
            {off.map((l) => <li key={l.key} className="px-4 py-3.5 text-[15px] text-[#6d7075]">{l.title}</li>)}
          </ul>
        </div>
      )}

      <p className="px-1 text-[13px] leading-relaxed text-[#6d7075]">This list is part of your agreement with {biz()}. If it changes, you’ll get a notice in your portal and by email.</p>
    </section>
  );
}
