'use client';
// src/components/renters/WhatRentersGet.tsx — WHAT RENTERS GET, on the rent page. For each tool a renter can use in their
// portal, the owner chooses: off, included with the space, or an add-on renters can choose for a monthly price
// (lib/renter-offers, saved through api/renters/offers). Before saving, it shows the notice renters will get.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { OFFER_DEFS, offerChanges, money, PRICE_MIN_CENTS, type Offers, type OfferKey, type OfferMode, type CampaignPayer } from '@/lib/renter-offers';

const box = 'rounded-[22px] border border-[#ececee] bg-white p-5';
const btn = 'h-11 rounded-full border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-50';
const input = 'h-11 rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a] tabular-nums';
const MODE_LABEL: Record<OfferMode, string> = { off: 'Off', included: 'Included', addon: 'Add-on' };

type Loaded = { offers: Offers; added: Record<OfferKey, number>; renters: number; paymentsReady: boolean; businessName: string };
type Draft = { modes: Record<OfferKey, OfferMode>; prices: Record<OfferKey, string>; campaignPayer: CampaignPayer; monthlyTexts: string; perTextCents: string };

const draftOf = (o: Offers): Draft => ({
  modes: { ...o.modes },
  prices: Object.fromEntries(OFFER_DEFS.map((d) => [d.key, o.prices[d.key] ? (o.prices[d.key] / 100).toFixed(o.prices[d.key] % 100 ? 2 : 0) : ''])) as Record<OfferKey, string>,
  campaignPayer: o.campaignPayer, monthlyTexts: String(o.monthlyTexts), perTextCents: String(o.perTextCents),
});
const cents = (v: string) => { const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) ? n : 0; };
const offersOf = (d: Draft, base: Offers): Offers => ({
  ...base,
  modes: { ...d.modes },
  prices: Object.fromEntries(OFFER_DEFS.map((x) => [x.key, String(d.prices[x.key]).trim() === '' ? base.prices[x.key] : cents(d.prices[x.key])])) as Record<OfferKey, number>,
  campaignPayer: d.campaignPayer,
  monthlyTexts: Math.max(0, Math.min(5000, Math.round(Number(d.monthlyTexts) || 0))),
  perTextCents: Math.max(1, Math.min(50, Math.round(Number(d.perTextCents) || 1))),
});

export function WhatRentersGet({ tenantId }: { tenantId: string }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const h = await staffAuthHeader();
      const res = await fetch(`/api/renters/offers?tenantId=${encodeURIComponent(tenantId)}`, { headers: h, cache: 'no-store' });
      if (res.status === 403) { setHidden(true); return; }   // not theirs to change (settings): the card isn't shown
      const r = await res.json();
      if (!r?.ok) throw new Error();
      setData(r); setDraft(draftOf(r.offers)); setFailed(false);
    } catch { setFailed(true); }
  }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);

  // Opened from a link to this card (gift card or win-back settings): bring it into view once it's here.
  React.useEffect(() => {
    if (!data || typeof window === 'undefined' || window.location.hash !== '#what-renters-get') return;
    document.getElementById('what-renters-get')?.scrollIntoView({ block: 'start' });
  }, [data]);

  if (hidden) return null;
  if (!data || !draft) {
    return (
      <section id="what-renters-get" className={box}>
        <h2 className="text-[17px] font-semibold text-[#16171a]">What renters get</h2>
        {failed
          ? <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[14px] text-[#b45309]">These couldn’t load.</p><button type="button" onClick={() => void load()} className={btn}>Try again</button></div>
          : <p className="mt-3 text-[14px] text-[#6d7075]">Loading…</p>}
      </section>
    );
  }

  const biz = data.businessName || 'your business';
  const next = offersOf(draft, data.offers);
  const changes = offerChanges(data.offers, next, data.businessName);
  const priceMissing = OFFER_DEFS.filter((d) => draft.modes[d.key] === 'addon' && !(cents(draft.prices[d.key]) >= PRICE_MIN_CENTS));
  const setMode = (k: OfferKey, m: OfferMode) => { setMsg(null); setDraft({ ...draft, modes: { ...draft.modes, [k]: m } }); };
  const setPrice = (k: OfferKey, v: string) => { setMsg(null); setDraft({ ...draft, prices: { ...draft.prices, [k]: v.replace(/[^0-9.]/g, '').slice(0, 8) } }); };

  const save = async () => {
    if (priceMissing.length) { setMsg({ ok: false, t: `${priceMissing[0].ownerTitle} needs a monthly price of at least ${money(PRICE_MIN_CENTS)}.` }); return; }
    setBusy(true); setMsg(null);
    try {
      const h = await staffAuthHeader();
      const r = await (await fetch('/api/renters/offers', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, version: data.offers.version, modes: next.modes, prices: next.prices, campaignPayer: next.campaignPayer, monthlyTexts: next.monthlyTexts, perTextCents: next.perTextCents }),
      })).json();
      if (!r?.ok) {
        if (r?.offers) { setData({ ...data, offers: r.offers }); setDraft(draftOf(r.offers)); }
        setMsg({ ok: false, t: r?.error || 'That didn’t save. Try again.' });
      } else {
        setData({ ...data, offers: r.offers, added: r.added || data.added }); setDraft(draftOf(r.offers));
        setMsg(r.stopFailed
          ? { ok: true, t: `Saved, and renters were told. ${r.stopFailed} renter${r.stopFailed === 1 ? '’s add-on still shows' : 's’ add-ons still show'} as running on their record, but an add-on is never charged once it isn’t offered as one.` }
          : { ok: true, t: r.changed?.length ? (r.told ? `Saved. ${r.told} renter${r.told === 1 ? ' was' : 's were'} told.` : 'Saved.') : 'Saved. Nothing changed.' });
      }
    } catch { setMsg({ ok: false, t: 'That didn’t save. Check your connection and try again.' }); }
    setBusy(false);
  };

  return (
    <section id="what-renters-get" className={`${box} scroll-mt-24 space-y-5`} aria-labelledby="what-renters-get-title">
      <div className="space-y-1">
        <h2 id="what-renters-get-title" className="text-[17px] font-semibold text-[#16171a]">What renters get</h2>
        <p className="text-[14px] leading-relaxed text-[#6d7075]">For each tool, choose whether it comes with the space, is a paid add-on renters can choose, or isn’t offered. Calendar, booking and client reminders always come with the space.</p>
      </div>

      <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee]">
        {OFFER_DEFS.map((d) => {
          const m = draft.modes[d.key];
          const has = data.added[d.key] || 0;
          return (
            <li key={d.key} className="space-y-3 px-4 py-4">
              <div>
                <p className="text-[15px] font-medium text-[#16171a]">{d.ownerTitle}</p>
                <p className="text-[13px] leading-snug text-[#6d7075]">{d.ownerSub}</p>
              </div>
              <div role="radiogroup" aria-label={d.ownerTitle} className="grid grid-cols-3 gap-1 rounded-full bg-[#f5f5f7] p-1">
                {(['off', 'included', 'addon'] as OfferMode[]).map((x) => {
                  const blocked = x === 'addon' && !data.paymentsReady && data.offers.modes[d.key] !== 'addon';
                  return (
                    <button key={x} type="button" role="radio" aria-checked={m === x} disabled={blocked} onClick={() => setMode(d.key, x)}
                      className={`h-11 rounded-full text-[14px] font-medium disabled:opacity-40 ${m === x ? 'bg-[#16171a] text-white' : 'text-[#16171a]'}`}>
                      {MODE_LABEL[x]}
                    </button>
                  );
                })}
              </div>
              {m === 'addon' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[14px] text-[#6d7075]">
                    <span className="text-[15px] text-[#16171a]">$</span>
                    <input inputMode="decimal" value={draft.prices[d.key]} onChange={(e) => setPrice(d.key, e.target.value)} placeholder="0" aria-label={`${d.ownerTitle}, price a month`} className={`${input} w-24`} />
                    a month
                  </label>
                  {has > 0 && <span className="text-[13px] text-[#6d7075]">{has} renter{has === 1 ? ' has' : 's have'} it</span>}
                  {!(cents(draft.prices[d.key]) >= PRICE_MIN_CENTS) && <span className="w-full text-[13px] text-[#b45309]">Enter a price of at least {money(PRICE_MIN_CENTS)}.</span>}
                </div>
              )}
              {d.key === 'campaigns' && m !== 'off' && (
                <div className="space-y-2 rounded-2xl bg-[#f5f5f7] p-3">
                  <p className="text-[14px] font-medium text-[#16171a]">Campaign texts</p>
                  <div role="radiogroup" aria-label="Who pays for campaign texts" className="grid grid-cols-2 gap-1 rounded-full bg-white p-1">
                    {([['renter_pays', 'They pay'], ['business_covers', 'You cover some']] as [CampaignPayer, string][]).map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={draft.campaignPayer === k} onClick={() => { setMsg(null); setDraft({ ...draft, campaignPayer: k }); }}
                        className={`h-11 rounded-full text-[14px] font-medium ${draft.campaignPayer === k ? 'bg-[#16171a] text-white' : 'text-[#16171a]'}`}>{l}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-[#6d7075]">
                    {draft.campaignPayer === 'business_covers' && (
                      <label className="flex items-center gap-2"><input inputMode="numeric" value={draft.monthlyTexts} onChange={(e) => { setMsg(null); setDraft({ ...draft, monthlyTexts: e.target.value.replace(/\D/g, '').slice(0, 4) }); }} aria-label="Texts you cover for each renter a month" className={`${input} w-20`} /> texts a month on you, per renter</label>
                    )}
                    <label className="flex items-center gap-2"><input inputMode="numeric" value={draft.perTextCents} onChange={(e) => { setMsg(null); setDraft({ ...draft, perTextCents: e.target.value.replace(/\D/g, '').slice(0, 2) }); }} aria-label="Price of each text to the renter, in cents" className={`${input} w-16`} /> ¢ each to them{draft.campaignPayer === 'business_covers' ? ' after that' : ''}</label>
                  </div>
                  <p className="text-[13px] text-[#6d7075]">Emails are always free.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!data.paymentsReady && <p className="text-[13px] leading-relaxed text-[#6d7075]">Add-ons are charged to renters’ saved cards, so they need card payments set up for {biz} first.</p>}
      <p className="text-[13px] leading-relaxed text-[#6d7075]">An add-on is charged to the renter’s saved card each month, with a receipt, and they can stop it any time. A new price applies to renters who add it after you change it.</p>

      {changes.length > 0 && !priceMissing.length && (
        <div className="space-y-2 rounded-2xl bg-[#f5f5f7] p-4">
          <p className="text-[14px] font-medium text-[#16171a]">{data.renters ? `Your ${data.renters} renter${data.renters === 1 ? '' : 's'} will get this notice, in their portal and by email:` : 'Renters will get this notice, in their portal and by email:'}</p>
          <ul className="space-y-1">{changes.map((c) => <li key={c} className="text-[14px] leading-relaxed text-[#6d7075]">{c}</li>)}</ul>
        </div>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-[14px] ${msg.ok ? 'text-[#1f7a4d]' : 'text-[#b45309]'}`}>{msg.t}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !changes.length} onClick={() => void save()} className="h-11 flex-1 rounded-full bg-[#16171a] px-4 text-[15px] font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : changes.length ? 'Save and tell renters' : 'No changes to save'}</button>
        {changes.length > 0 && <button type="button" disabled={busy} onClick={() => { setDraft(draftOf(data.offers)); setMsg(null); }} className={btn}>Undo</button>}
      </div>
    </section>
  );
}
