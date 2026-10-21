'use client';
// src/components/orders/AddressCard.tsx — THE FULL SHIP-TO ADDRESS, and what the carrier address check said about it
// (lib/address-validation, at checkout and whenever the address changes). Shown where a label is bought and on the order,
// so the person buying it can see exactly where it's going and whether anything needs asking first.
//   "Ask Dana to confirm" texts (or emails) her order page, where she taps "Yes, ship it here" or fixes it
//   (api/retail/address). Nothing waits on her: the label can still be bought. Her answer shows here as it lands.
//   "New address" marks an address that changed after packing started, so the box gets the right label.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { addressLinesOf, oneLine } from '@/lib/address-flow';
import { C, muted } from './ui';

const VERDICT: Record<string, { tone: 'ok' | 'warn' | 'bad'; text: string }> = {
  valid: { tone: 'ok', text: 'Confirmed by the carrier address check.' },
  corrected: { tone: 'warn', text: 'The carrier address check suggests a slightly different address. Check with the customer before buying the label.' },
  unconfirmed: { tone: 'warn', text: 'The carrier address check couldn’t confirm this address. If an apartment or suite number looks missing, ask the customer first.' },
  undeliverable: { tone: 'bad', text: 'The carrier address check says this address doesn’t exist. Ask the customer for the right one before buying a label.' },
};

export const addressLines = addressLinesOf;

const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || 'the customer';
const time = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };

export function AddressCard({ order, compact, tenantId, onToast }: { order: any; compact?: boolean; tenantId?: string; onToast?: (m: string) => void }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const a = order?.shippingAddress; if (!a) return null;
  const check = order?.addressCheck; const v = check?.verdict ? VERDICT[String(check.verdict)] : null;
  const unitMissing = check?.unitMissing === true && check?.unitAnswer !== 'added';
  const tone = (t: 'ok' | 'warn' | 'bad') => ({ ok: { bg: C.okSoft, fg: C.ok }, warn: { bg: C.warnSoft, fg: C.warn }, bad: { bg: C.badSoft, fg: C.bad } }[t]);
  const who = first(order.customerName);
  const conf = order.addressConfirm || null;
  const changed = order.addressChanged && ['picking', 'packed', 'label'].includes(String(order.addressChanged.after)) ? order.addressChanged : null;
  const preShip = ['paid', 'picking', 'packed'].includes(String(order.stage));
  const flagged = (v && v.tone !== 'ok') || unitMissing;
  // A "yes" given before the address changed is about the old address.
  const confirmedNow = conf?.status === 'confirmed' && !(changed && Date.parse(String(changed.at || '')) > Date.parse(String(conf.answeredAt || '')));
  const canAsk = !compact && !!tenantId && preShip && conf?.status !== 'waiting' && !confirmedNow && order.addressRequest?.status !== 'waiting' && (order.customerEmail || order.customerPhone);

  const ask = async () => {
    if (!tenantId || busy) return; setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/address', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, action: 'ask_confirm' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) setErr(d.error || 'That didn’t go through. Try again.'); else onToast?.(d.message || `${who} has been asked.`);
    } catch { setErr('That didn’t go through. Try again.'); }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: C.soft }}>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold" style={muted}>Ship to</p>
        {changed && <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>New address</span>}
      </div>
      {addressLines(a).map((l, i) => <p key={i} className={`m-0 ${i ? 'text-[15px]' : 'mt-1 text-[16px] font-semibold'}`}>{l}</p>)}
      {!compact && changed && (
        <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>
          {changed.by === 'staff' ? 'Changed' : `${who} changed it`} {time(changed.at)}{changed.after === 'label' ? ', after the label was bought' : ', after packing started'}. It was {oneLine(changed.from) || 'a different address'}.
        </p>)}
      {!compact && v && (
        <div className="mt-3 rounded-xl px-3 py-2 text-[14px]" style={{ background: tone(v.tone).bg, color: tone(v.tone).fg }}>
          {v.text}
          {check?.carrier ? <span className="mt-1 block" style={{ color: C.ink }}>Suggested: {oneLine(check.carrier)}</span>
            : check?.suggestion ? <span className="mt-1 block" style={{ color: C.ink }}>Suggested: {[check.suggestion.line1, check.suggestion.line2, check.suggestion.city, check.suggestion.state, check.suggestion.postalCode].filter(Boolean).join(', ')}</span> : null}
        </div>)}
      {!compact && unitMissing && check?.verdict !== 'unconfirmed' && (
        <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>No apartment or unit number, and it looks like one may be needed.</p>)}
      {!compact && check?.unitAnswer === 'none' && <p className="m-0 mt-2 text-[14px]" style={muted}>{who} said there’s no apartment or unit number.</p>}
      {!compact && check?.choice === 'suggested' && <p className="m-0 mt-2 text-[14px]" style={muted}>{who} chose the carrier’s version of the address.</p>}
      {!compact && check?.choice === 'typed' && check?.verdict === 'corrected' && <p className="m-0 mt-2 text-[14px]" style={muted}>{who} was shown the carrier’s version and kept their own.</p>}
      {!compact && conf?.status === 'waiting' && (
        <p className="m-0 mt-3 text-[14px] font-semibold" style={{ color: C.warn }}>Waiting for {who} to confirm{conf.askedAt ? ` · asked ${time(conf.askedAt)}` : ''}<span className="block font-normal" style={muted}>If you’re sure, you can still ship it.</span></p>)}
      {!compact && confirmedNow && <p className="m-0 mt-3 text-[14px] font-semibold" style={{ color: C.ok }}>{who} confirmed this address{conf.answeredAt ? ` · ${time(conf.answeredAt)}` : ''}</p>}
      {!compact && conf?.status === 'fixed' && <p className="m-0 mt-3 text-[14px] font-semibold" style={{ color: C.ok }}>{who} answered with a new address{conf.answeredAt ? ` · ${time(conf.answeredAt)}` : ''}</p>}
      {canAsk && (
        <button type="button" disabled={busy} onClick={() => void ask()}
          className="cf-press mt-3 h-11 w-full rounded-full text-[15px] font-semibold disabled:opacity-50"
          style={flagged ? { border: `2px solid ${C.ink}`, color: C.ink, background: 'transparent' } : { color: C.muted, background: 'transparent' }}>
          {busy ? 'Asking…' : `Ask ${who} to confirm`}
        </button>)}
      {err && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err}</p>}
    </div>);
}
