// src/components/public/kit.tsx
//
// THE PUBLIC DESIGN KIT — the look of the school website, landing page and
// the Studio booking page, in one place: warm paper and ink, the business's
// own accent, Plus Jakarta Sans, white rounded cards with soft shadows, a
// gentle rise-in (off for "reduce motion"), clear focus rings, and phone
// safe areas. Public pages wrap themselves in <PublicFrame>.
//
// .pub-flow re-themes the booking flow (BookingSheet), which takes its look
// from CSS variables — so it matches without touching any booking logic.

import type { ReactNode } from 'react';

export const PUBLIC_CSS = `
.pub{--ink:#1c1917;--muted:#57534e;--paper:#faf8f5;color:var(--ink);background:var(--paper);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.pub h1,.pub h2{letter-spacing:-.02em;font-weight:300}.pub h1 b,.pub h2 b{font-weight:650}
@keyframes pubRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.pub-rise{animation:pubRise .7s cubic-bezier(.2,.8,.2,1) both}
.pub-card{background:#fff;border-radius:1.5rem;box-shadow:0 1px 2px rgba(28,25,23,.04),0 12px 32px -18px rgba(28,25,23,.25)}
.pub a:focus-visible,.pub button:focus-visible,.pub input:focus-visible,.pub select:focus-visible,.pub textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.pub-safe-bottom{padding-bottom:calc(1rem + env(safe-area-inset-bottom,0px))}
@media (prefers-reduced-motion:reduce){.pub-rise{animation:none}}
.pub-flow{--background:36 33% 97%;--foreground:24 10% 10%;--card:0 0% 100%;--card-foreground:24 10% 10%;--muted:30 14% 93%;--muted-foreground:25 5% 38%;
  --border:30 12% 88%;--input:30 12% 88%;--radius:1rem;--booking-heading-font:'Plus Jakarta Sans',system-ui,sans-serif;--booking-body-font:'Plus Jakarta Sans',system-ui,sans-serif;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif}
`;
export const PUBLIC_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap';

/** Wraps a public page in the kit's look, with the business's accent. */
export function PublicFrame({ accent, children, className = '' }: { accent: string; children: ReactNode; className?: string }) {
  return (
    <div className={`pub min-h-dvh ${className}`} style={{ ['--accent' as any]: accent || '#7c3aed' }}>
      <style>{PUBLIC_CSS}</style>
      <link rel="stylesheet" href={PUBLIC_FONT_HREF} />
      {children}
    </div>
  );
}

export function Section({ id, eyebrow, title, children, className = '' }: { id?: string; eyebrow?: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-20 px-4 py-10 sm:py-14 ${className}`}>
      {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>{eyebrow}</p>}
      {title && <h2 className="mt-1 text-3xl sm:text-4xl">{title}</h2>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function PrimaryButton({ children, onClick, className = '', label }: { children: ReactNode; onClick?: () => void; className?: string; label?: string }) {
  return <button type="button" onClick={onClick} aria-label={label} className={`inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm transition active:scale-[.98] ${className}`} style={{ background: 'var(--accent)' }}>{children}</button>;
}
export function QuietButton({ children, onClick, href, className = '' }: { children: ReactNode; onClick?: () => void; href?: string; className?: string }) {
  const cls = `inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] shadow-sm transition active:scale-[.98] ${className}`;
  return href ? <a href={href} className={cls}>{children}</a> : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

export const money = (n: any) => { const v = Number(n); return isFinite(v) && v > 0 ? `$${v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : ''; };
export const minutes = (m: any) => { const v = Number(m) || 0; if (!v) return ''; const h = Math.floor(v / 60), r = v % 60; return h ? `${h} hr${r ? ` ${r} min` : ''}` : `${r} min`; };
