'use client';
// src/components/orders/AddressCard.tsx — THE FULL SHIP-TO ADDRESS, and what the carrier address check said about it
// (lib/address-validation, run at checkout when the shop has address checks on). Shown where a label is bought, so the
// person buying it can see exactly where it's going and whether anything needs asking first.
import * as React from 'react';
import { C, muted } from './ui';

const VERDICT: Record<string, { tone: 'ok' | 'warn' | 'bad'; text: string }> = {
  valid: { tone: 'ok', text: 'Confirmed by the carrier address check.' },
  corrected: { tone: 'warn', text: 'The carrier address check suggests a slightly different address. Check with the customer before buying the label.' },
  unconfirmed: { tone: 'warn', text: 'The carrier address check couldn’t confirm this address. If an apartment or suite number looks missing, ask the customer first.' },
  undeliverable: { tone: 'bad', text: 'The carrier address check says this address doesn’t exist. Ask the customer for the right one before buying a label.' },
};

export function addressLines(a: any): string[] {
  if (!a) return [];
  return [a.name, a.line1, a.line2, [a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].map((x: any) => String(x || '').trim()).filter(Boolean);
}

export function AddressCard({ order, compact }: { order: any; compact?: boolean }) {
  const a = order?.shippingAddress; if (!a) return null;
  const check = order?.addressCheck; const v = check?.verdict ? VERDICT[String(check.verdict)] : null;
  const s = check?.suggestion || null;
  const tone = v ? { ok: { bg: C.okSoft, fg: C.ok }, warn: { bg: C.warnSoft, fg: C.warn }, bad: { bg: C.badSoft, fg: C.bad } }[v.tone] : null;
  return (
    <div className="rounded-2xl p-4" style={{ background: C.soft }}>
      <p className="m-0 text-[13px] font-semibold" style={muted}>Ship to</p>
      {addressLines(a).map((l, i) => <p key={i} className={`m-0 ${i ? 'text-[15px]' : 'mt-1 text-[16px] font-semibold'}`}>{l}</p>)}
      {!compact && v && tone && (
        <div className="mt-3 rounded-xl px-3 py-2 text-[14px]" style={{ background: tone.bg, color: tone.fg }}>
          {v.text}
          {s && <span className="mt-1 block" style={{ color: C.ink }}>Suggested: {[s.line1, s.line2, s.city, s.state, s.postalCode].filter(Boolean).join(', ')}</span>}
        </div>)}
    </div>);
}
