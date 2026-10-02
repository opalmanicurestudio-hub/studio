'use client';
// src/components/settings/settings-ui.tsx — THE PIECES EVERY SETTINGS PAGE IS BUILT FROM (Studio look).
// The rule they encode: one plain question per row, one short line of help, the answer filled in with a sensible
// default — and anything most owners never touch tucked under "More options". Fewer decisions, less to read.
import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { AppHeader } from '@/components/shared/AppHeader';
import { SettingsStyle } from '@/components/settings/settings-style';

export const cfInput = 'h-12 w-full rounded-xl border px-4 text-[15px] outline-none transition-colors focus:border-[var(--accent)]';
export const cfInputStyle: React.CSSProperties = { background: 'var(--card)', borderColor: 'var(--line)', color: 'var(--ink)' };

/** A group of related settings: a plain heading, an optional line under it, and one calm sheet. */
export function Section({ title, help, children, id }: { title: string; help?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-8 space-y-3">
      <div className="space-y-1"><h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>{help && <p className="max-w-[62ch] text-[14.5px] cf-muted">{help}</p>}</div>
      <div className="cf-sheet">{children}</div>
    </section>
  );
}

/** One setting: the question, one line of help, and the control. Side-by-side when the control is small. */
export function Row({ label, help, children, inline }: { label: string; help?: React.ReactNode; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={`px-5 py-4 [&+&]:border-t ${inline ? 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2' : 'space-y-2.5'}`} style={{ borderColor: 'var(--line)' }}>
      <div className={inline ? 'min-w-[11rem] flex-1' : 'min-w-0'}><p className="text-[15px] font-medium">{label}</p>{help && <p className="mt-0.5 text-[13.5px] leading-snug cf-muted">{help}</p>}</div>
      <div className={inline ? 'shrink-0' : ''}>{children}</div>
    </div>
  );
}

/** An on/off switch in the business's colour. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40" style={{ background: checked ? 'var(--accent)' : 'var(--line)' }}>
      <span className="absolute top-1 h-5 w-5 rounded-full shadow transition-[left]" style={{ left: checked ? 24 : 4, background: '#fff' }} />
    </button>
  );
}

/** A small choice of 2–4 options, e.g. 15 / 30 / 60 minutes. */
export function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full p-1" style={{ background: 'var(--soft)' }}>
      {options.map((o) => { const on = o.value === value; return (
        <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
          className="h-9 rounded-full px-4 text-[14px] transition-colors" style={on ? { background: 'var(--card)', color: 'var(--ink)', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--muted)' }}>{o.label}</button>); })}
    </div>
  );
}

/** What most owners never need — closed until asked for. */
export function More({ label = 'More options', help, children }: { label?: string; help?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 rounded-2xl px-1 py-2 text-left">
        <span><span className="block text-[16px] font-semibold">{label}</span>{help && <span className="block text-[13.5px] cf-muted">{help}</span>}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 cf-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div className="space-y-6">{children}</div>}
    </section>
  );
}

/** "09:00 AM" ⇄ "09:00" (the phone's time picker) — opening hours keep their stored format. */
export function toPicker(v?: string): string {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/); if (!m) return '';
  let h = Number(m[1]); const ap = (m[3] || '').toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
export function fromPicker(v: string): string {
  const m = String(v || '').match(/^(\d{2}):(\d{2})$/); if (!m) return v;
  let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m[2]} ${ap}`;
}

/** The frame every settings screen uses — the header bar (search, notifications), "‹ Settings", the page's name and
 *  one line about it, on the Studio paper. Sub-pages (Booking, Messages, Automations…) look exactly like the tabs. */
export function SettingsPage({ title, help, actions, children }: { title: string; help?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="cf-settings cf-legacy min-h-full">
      <SettingsStyle />
      <AppHeader title="Settings" />
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 pb-32 md:space-y-10 md:px-10 md:py-10">
        <header className="space-y-4 text-left">
          <Link href="/settings" className="inline-flex items-center gap-1 text-[14px] font-medium cf-muted hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />Settings</Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1.5"><h1 className="text-[32px] font-light leading-none tracking-tight md:text-[38px]">{title}</h1>{help && <p className="max-w-[60ch] text-[15px] cf-muted">{help}</p>}</div>
            {actions}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
