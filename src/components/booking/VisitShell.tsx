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
