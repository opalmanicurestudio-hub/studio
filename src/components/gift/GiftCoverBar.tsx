'use client';
// src/components/gift/GiftCoverBar.tsx — on the booking page when they came from their gift card (lib/gift-visit): how
// much is on it and the services it covers in full, one tap to book. Shown, never applied — the desk or the deposit step
// takes the card itself.
import * as React from 'react';
import { giftMoney } from '@/lib/gift-visit';

export function GiftCoverBar({ cents, services, onPick, accent = '#16171a', studio = false }: { cents: number; services: any[]; onPick: (s: any) => void; accent?: string; studio?: boolean }) {
  if (!(cents > 0)) return null;
  const bal = cents / 100;
  const fits = services.filter((s) => Number(s.price) > 0 && Number(s.price) <= bal && !s.isPrivate).sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 8);
  return (
    <div className={studio ? 'rounded-[22px] bg-white p-4 shadow-sm' : 'rounded-[18px] border bg-white p-4'} style={{ borderColor: '#ececee', color: '#1c1917' }} role="status">
      <p className="text-[15px] font-semibold">You have {giftMoney(cents)} on your gift card</p>
      <p className="mt-0.5 text-[13.5px] text-stone-500">{fits.length ? 'These are fully covered — or choose anything, and use the card toward it.' : 'Choose any service — the card goes toward it at your visit.'}</p>
      {fits.length > 0 && <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">{fits.map((s) => (
        <button key={s.id} type="button" onClick={() => onPick(s)} className="shrink-0 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition hover:-translate-y-0.5" style={{ borderColor: '#e7e2dc' }}>
          {s.name} <span className="text-stone-500">· {giftMoney(Math.round(Number(s.price) * 100))}</span> <span aria-hidden style={{ color: accent }}>✓</span></button>))}</div>}
    </div>);
}
