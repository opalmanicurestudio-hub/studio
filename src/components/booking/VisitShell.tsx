'use client';
// src/components/booking/VisitShell.tsx — the Studio look for every screen of
// a client's visit link (booked, on the day, cancelled, finished…): warm paper,
// the business's accent, white cards, calm type. Wording works for in-person,
// virtual and mobile appointments alike.
import React from 'react';
import { PublicFrame } from '@/components/public/kit';

export type VisitBrand = { accent: string; studioName?: string | null; bookHref?: string | null; phone?: string | null };

/** The business's look + contact, from its settings. */
export function brandOf(tenant: any, tenantId?: string | null, serviceId?: string | null): VisitBrand {
  const t = tenant || {};
  return {
    accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || '#7c3aed',
    studioName: t.name || t.businessName || null,
    bookHref: tenantId ? `/book/${tenantId}${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ''}` : null,
    phone: t.phone || t.twilioPhoneNumber || null,
  };
}

export function VisitShell({ brand, title, subtitle, children }: { brand: VisitBrand; title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <PublicFrame accent={brand.accent}>
      <main className="mx-auto max-w-md space-y-4 px-4 py-8 pub-safe-bottom">
        <header className="pub-rise space-y-1 px-1">
          {brand.studioName && <p className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--accent)' }}>{brand.studioName}</p>}
          <h1 className="text-4xl">{title}</h1>
          {subtitle && <p className="text-[15px]" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        </header>
        {children}
      </main>
    </PublicFrame>
  );
}

export const VisitCard = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' }) => (
  <section className="pub-card space-y-3 p-5" style={tone === 'warn' ? { boxShadow: 'inset 0 0 0 2px #f59e0b' } : tone === 'ok' ? { boxShadow: 'inset 0 0 0 2px #16a34a' } : undefined}>{children}</section>
);

export function VisitButton({ children, onClick, href, quiet, disabled }: { children: React.ReactNode; onClick?: () => void; href?: string | null; quiet?: boolean; disabled?: boolean }) {
  const cls = `inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] transition active:scale-[.98] disabled:opacity-60 ${quiet ? 'bg-white shadow-sm' : 'font-semibold text-white shadow-sm'}`;
  const style = quiet ? { border: '1px solid #e7e2dc' } : { background: 'var(--accent)' };
  return href ? <a href={href} className={cls} style={style}>{children}</a> : <button type="button" className={cls} style={style} onClick={onClick} disabled={disabled}>{children}</button>;
}

export const VisitMuted = ({ children }: { children: React.ReactNode }) => <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{children}</p>;

/** A calm section label (no all-caps micro-labels). */
export const VisitLabel = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] font-semibold">{children}</p>;

/** Choice pills — one of a few options. */
export function VisitChoice<T extends string | number>({ value, onChange, options, cols }: { value: T; onChange: (v: T) => void; options: [T, string][]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={`grid gap-2 ${cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`} role="radiogroup">
      {options.map(([v, l]) => {
        const on = v === value;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
          className="h-11 rounded-full px-3 text-[14px] transition active:scale-[.98]"
          style={on ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 } : { background: '#fff', border: '1px solid #e7e2dc' }}>{l}</button>;
      })}
    </div>
  );
}

/** A plain select in the Studio look. */
export function VisitSelect({ value, onChange, options, label }: { value: string | number; onChange: (v: string) => void; options: { value: string | number; label: string }[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full rounded-2xl bg-white px-4 text-[15px] outline-none" style={{ border: '1px solid #e7e2dc' }}>
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A text field / textarea in the Studio look. */
export function VisitInput({ value, onChange, placeholder, multiline, label }: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; label: string }) {
  const cls = 'w-full rounded-2xl bg-white px-4 text-[15px] outline-none';
  const style = { border: '1px solid #e7e2dc' };
  return multiline
    ? <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={`${cls} py-3`} style={style} />
    : <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${cls} h-12`} style={style} />;
}
