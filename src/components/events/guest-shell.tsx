'use client';
// src/components/events/guest-shell.tsx — THE FRAME OF AN EVENT'S GUEST PAGES (the event page, the meal order page, a
// seat's QR code). All of them read and write through /api/public/event (lib/event-guest-link), never the database.
import * as React from 'react';

export const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
export const CARD: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20 };
export const INPUT = 'mt-1.5 h-[52px] w-full rounded-2xl border bg-white px-3.5 text-[17px] text-[#16171a] outline-none focus:border-[#16171a]';
export const LABEL = 'block text-[13px] font-medium';

/** "Saturday, November 21" from the event's own date (no time zone shift). */
export const dayLabel = (d: string | null) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
/** "7pm", "7:30pm" from "19:00". */
export const timeLabel = (t: string | null) => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
  const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`;
};
export const whenLabel = (e: { date: string | null; time: string | null; endTime?: string | null }) =>
  [dayLabel(e.date), e.time ? `${timeLabel(e.time)}${e.endTime ? `–${timeLabel(e.endTime)}` : ''}` : ''].filter(Boolean).join(' · ');

/** Asks the event's server. Network trouble comes back as a plain message, like any other refusal. */
export async function askEvent(body: Record<string, any>): Promise<any> {
  try {
    const r = await fetch('/api/public/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false, error: 'Check your connection and try again.' }; }
}

/** The PIN a guest typed for a private event, kept for this visit so the meal order page doesn't ask again. */
const pinKey = (t: string, e: string) => `event-pin:${t}:${e}`;
export const savedPin = (t: string, e: string) => { try { return sessionStorage.getItem(pinKey(t, e)) || ''; } catch { return ''; } };
export const savePin = (t: string, e: string, pin: string) => { try { sessionStorage.setItem(pinKey(t, e), pin); } catch { /* private window */ } };

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[100dvh] text-[#16171a]" style={{ background: SOFT, letterSpacing: '-0.01em' }}>
    <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 pb-12 pt-6">{children}</div>
  </main>;
}

export function BusinessHead({ business }: { business: { name: string; logoUrl: string | null; color: string } | null }) {
  if (!business) return null;
  return <div className="flex items-center gap-2.5">
    {business.logoUrl
      ? <img src={business.logoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
      : <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-bold text-white" style={{ background: business.color || INK }}>{(business.name || '·').slice(0, 1)}</span>}
    <span className="text-[14px] font-medium">{business.name}</span>
  </div>;
}

export function Note({ tone = 'plain', children }: { tone?: 'plain' | 'warn' | 'good'; children: React.ReactNode }) {
  const dot = tone === 'warn' ? AMBER : tone === 'good' ? GREEN : MUTED;
  return <div className="flex gap-2.5 p-4 text-[15px] leading-snug" style={CARD}><span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} /><span>{children}</span></div>;
}

export function Button({ children, color, disabled, onClick, type = 'button' }: { children: React.ReactNode; color: string; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) {
  return <button type={type} disabled={disabled} onClick={onClick} className="h-[54px] w-full rounded-full text-[16px] font-medium text-white disabled:opacity-40" style={{ background: color || INK }}>{children}</button>;
}

/** A private event's PIN step. */
export function PinForm({ color, error, busy, onSubmit }: { color: string; error: string | null; busy: boolean; onSubmit: (pin: string) => void }) {
  const [pin, setPin] = React.useState('');
  return <form className="space-y-4 p-5" style={CARD} onSubmit={(e) => { e.preventDefault(); if (pin) onSubmit(pin); }}>
    <div><p className="text-[18px] font-semibold">This is a private event</p><p className="mt-1 text-[14.5px]" style={{ color: MUTED }}>Enter the PIN from your invitation to continue.</p></div>
    <label className={LABEL}>PIN
      <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-invalid={!!error}
        className={`${INPUT} text-center tracking-[0.4em]`} style={{ borderColor: error ? AMBER : LINE }} />
    </label>
    {error && <p className="text-[14px] font-medium" style={{ color: AMBER }} role="alert">{error}</p>}
    <Button type="submit" color={color} disabled={!pin || busy}>{busy ? 'Checking…' : 'Continue'}</Button>
  </form>;
}

/** A calendar file for the event, at the business's own local time (no time zone shift). */
export function calendarHref(e: { title: string; date: string | null; time: string | null; endTime?: string | null; venue?: string | null }, businessName: string) {
  if (!e.date) return null;
  const d = e.date.replace(/-/g, ''); const t = (x: string) => `${x.replace(':', '')}00`;
  const start = e.time ? `DTSTART:${d}T${t(e.time)}` : `DTSTART;VALUE=DATE:${d}`;
  const endTime = e.endTime || (e.time ? `${String((Number(e.time.slice(0, 2)) + 2) % 24).padStart(2, '0')}${e.time.slice(2)}` : null);
  const end = e.time && endTime && endTime > e.time ? `DTEND:${d}T${t(endTime)}` : null;
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, ' ');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Event//EN', 'BEGIN:VEVENT', `UID:${d}-${encodeURIComponent(e.title).slice(0, 40)}@event`, `DTSTAMP:${stamp}`, start, ...(end ? [end] : []),
    `SUMMARY:${esc(e.title)}${businessName ? ` (${esc(businessName)})` : ''}`, ...(e.venue ? [`LOCATION:${esc(e.venue)}`] : []), 'END:VEVENT', 'END:VCALENDAR'];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}
