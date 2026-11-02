// src/components/public/kit.tsx
//
// THE PUBLIC DESIGN KIT — the look of the school website, landing page and
// the Studio booking page, in one place: warm paper and ink, the business's
// own accent, Plus Jakarta Sans, white rounded cards with soft shadows, clear
// focus rings, and phone safe areas. Public pages wrap themselves in <PublicFrame>.
//
// MOODS (the business chooses one in Settings › Booking page): Soft is warm paper
// and round corners; Crisp is white paper and tighter corners; Night is the same
// page with the lights down. A mood changes paper, corners and light, never the
// layout. Colors on the page come from the variables below, so every part follows.
//
// MOTION: calm, quick and always for a reason. Sections rise in once as they come
// into view (.pub-reveal, with .pub-stagger for the cards inside), a tap gives way
// slightly (.pub-press), panels slide up from the bottom (.pub-sheet), and a dot
// breathes beside a time that's today (.pub-breathe). When a phone asks for less
// motion, everything simply appears in place; printing shows everything too.
//
// .pub-ui carries the mood into the app's own form parts (a form's questions, a signature box) wherever a public page
// uses them: inside it, they take the page's paper, ink and lines, light or dark.

import type { ReactNode } from 'react';
import { lifted } from '@/lib/studio-page';
import { PublicMotion } from './PublicMotion';

export type PublicMood = 'soft' | 'crisp' | 'night';

export const PUBLIC_CSS = String.raw`
.pub{--ink:#1c1917;--muted:#57534e;--paper:#faf8f5;--card:#fff;--line:#e7e5e4;--soft:#f1ece6;--good:#1f7a4d;--good-soft:#e9f3ed;--warn:#b45309;--warn-soft:#fdf3e7;--r-card:1.5rem;color:var(--ink);background:var(--paper);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.pub h1,.pub h2{letter-spacing:-.02em;font-weight:300}.pub h1 b,.pub h2 b{font-weight:650}
.pub-accent-text{color:var(--accent-text,var(--accent))}
.pub-bar{background:var(--paper)}
@supports (background:color-mix(in srgb,red 50%,transparent)){.pub-bar{background:color-mix(in srgb,var(--paper) 92%,transparent)}}
@keyframes pubRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.pub-rise{animation:pubRise .7s cubic-bezier(.2,.8,.2,1) both}
.pub-card{background:var(--card);border-radius:var(--r-card);box-shadow:0 1px 2px rgba(28,25,23,.04),0 12px 32px -18px rgba(28,25,23,.25)}
.pub a:focus-visible,.pub button:focus-visible,.pub input:focus-visible,.pub select:focus-visible,.pub textarea:focus-visible{outline:3px solid var(--accent-text,var(--accent));outline-offset:2px}
.pub-safe-bottom{padding-bottom:calc(1rem + env(safe-area-inset-bottom,0px))}
.pub-js .pub-reveal{opacity:0;transform:translateY(16px);transition:opacity .7s cubic-bezier(.2,.8,.2,1),transform .7s cubic-bezier(.2,.8,.2,1)}
.pub-js .pub-reveal.is-in{opacity:1;transform:none}
.pub-js .pub-reveal:not(.is-in) .pub-stagger{opacity:0}
.pub-js .pub-reveal.is-in .pub-stagger{animation:pubRise .7s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(min(var(--i,0),8) * 60ms)}
.pub-press{transition:transform .18s cubic-bezier(.2,.8,.2,1),background-color .2s,color .2s}
.pub-press:active{transform:scale(.97);transition-duration:.12s}
@keyframes pubSheet{from{transform:translateY(100%)}to{transform:none}}
@keyframes pubPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes pubFade{from{opacity:0}to{opacity:1}}
.pub-sheet{animation:pubSheet .32s cubic-bezier(.32,.72,0,1) both}
.pub-scrim{animation:pubFade .24s ease-out both}
@media (min-width:640px){.pub-sheet{animation:pubPop .22s cubic-bezier(.2,.8,.2,1) both}}
@keyframes pubBreathe{0%,100%{opacity:1}50%{opacity:.35}}
.pub-breathe{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--good);animation:pubBreathe 2s ease-in-out infinite;flex-shrink:0}
@media (prefers-reduced-motion:reduce){.pub-rise,.pub-sheet,.pub-scrim,.pub-breathe{animation:none}.pub-press,.pub-press:active{transform:none;transition:none}
  .pub-js .pub-reveal,.pub-js .pub-reveal .pub-stagger{opacity:1!important;transform:none!important;transition:none!important;animation:none!important}}
@media print{.pub-js .pub-reveal,.pub-js .pub-reveal .pub-stagger{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}}
.pub[data-mood=crisp]{--paper:#fff;--line:#ececee;--soft:#f3f3f5;--r-card:.75rem}
.pub[data-mood=crisp] .pub-card{box-shadow:0 1px 2px rgba(22,23,26,.04);border:1px solid var(--line)}
.pub[data-mood=crisp] .bg-white.shadow-sm{box-shadow:inset 0 0 0 1px var(--line),0 1px 2px rgba(22,23,26,.04)}
.pub[data-mood=crisp] :is(button,a,span).rounded-full:not(.pub-round){border-radius:.625rem}
.pub[data-mood=crisp] .rounded-3xl,.pub[data-mood=crisp] .rounded-\[1\.75rem\]{border-radius:.875rem}
.pub[data-mood=crisp] .rounded-2xl{border-radius:.625rem}
.pub[data-mood=crisp] .rounded-xl{border-radius:.5rem}
.pub[data-mood=crisp] .rounded-t-\[1\.75rem\]{border-top-left-radius:.875rem;border-top-right-radius:.875rem}
@media (min-width:640px){.pub[data-mood=crisp] .sm\:rounded-\[1\.75rem\]{border-radius:.875rem}}
.pub[data-mood=night]{--ink:#f5f5f7;--muted:#a1a1aa;--paper:#16171a;--card:#222326;--line:#2e2f34;--soft:#2a2b2f;--good:#7fd1a5;--good-soft:rgba(127,209,165,.14);--warn:#f5c08a;--warn-soft:rgba(180,83,9,.2);color-scheme:dark}
.pub[data-mood=night] .pub-card{box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.pub[data-mood=night] .bg-white{background-color:var(--card)}
.pub[data-mood=night] .bg-white\/90{background-color:rgba(34,35,38,.9)}
.pub[data-mood=night] .bg-stone-100,.pub[data-mood=night] .hover\:bg-stone-100:hover{background-color:#2a2b2f}
.pub[data-mood=night] .text-stone-400{color:#8b8b93}
.pub[data-mood=night] .text-stone-500{color:#a1a1aa}
.pub[data-mood=night] .text-stone-600{color:#b6b6bd}
.pub[data-mood=night] .text-stone-700{color:#d4d4d8}
.pub[data-mood=night] .text-stone-800{color:#e7e7ea}
.pub[data-mood=night] .border-stone-200,.pub[data-mood=night] .border-stone-200\/70,.pub[data-mood=night] .border-stone-200\/60{border-color:var(--line)}
.pub[data-mood=night] .divide-stone-200>:not([hidden])~:not([hidden]){border-color:var(--line)}
.pub[data-mood=night] .shadow-sm,.pub[data-mood=night] .shadow-xl{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.pub[data-mood=night] :is(input,select,textarea){color:var(--ink)}
.pub[data-mood=night] .bg-stone-900\/40{background-color:rgba(0,0,0,.6)}
.pub[data-mood=night] :is([style*="background: var(--accent)"],[style*="background:var(--accent)"],[style*="background: var(--accent,"],[style*="background:var(--accent,"]):not(.cf-splash){box-shadow:inset 0 0 0 1px rgb(255 255 255/.28)}
.pub[data-mood=night] .pub-plate{background:#fff;color:#1c1917;border-radius:var(--r-card);color-scheme:light}
.pub[data-mood=night] .pub-plate .bg-white{background-color:#fff}
.pub[data-mood=night] .pub-plate :is(input,select,textarea){color:#1c1917}
.pub[data-mood=night] .pub-plate .text-stone-400{color:#a8a29e}.pub[data-mood=night] .pub-plate .text-stone-500{color:#78716c}.pub[data-mood=night] .pub-plate .text-stone-600{color:#57534e}
.pub[data-mood=night] .pub-plate .text-stone-700{color:#44403c}.pub[data-mood=night] .pub-plate .text-stone-800{color:#292524}
.pub[data-mood=night] .pub-plate .shadow-sm{box-shadow:0 1px 2px 0 rgb(0 0 0/.05)}
.pub[data-mood=night] .gcs-cta{box-shadow:inset 0 0 0 1px rgb(255 255 255/.28)!important}
.pub-ui{--background:36 33% 97%;--foreground:24 10% 10%;--card:0 0% 100%;--card-foreground:24 10% 10%;--popover:0 0% 100%;--popover-foreground:24 10% 10%;--muted:30 14% 93%;--muted-foreground:25 5% 38%;
  --border:30 12% 88%;--input:30 12% 88%;--primary:var(--accent-hsl,24 10% 10%);--primary-foreground:0 0% 100%;--ring:var(--accent-hsl,24 10% 10%);--radius:1rem;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:hsl(var(--foreground))}
.pub[data-mood=crisp] .pub-ui{--background:0 0% 100%;--border:240 5% 93%;--input:240 5% 90%;--radius:.625rem}
.pub[data-mood=night] .pub-ui{--glass-surface:34 35 38;--background:228 8% 9%;--foreground:240 5% 96%;--card:225 6% 14%;--card-foreground:240 5% 96%;--popover:225 6% 14%;--popover-foreground:240 5% 96%;
  --muted:228 6% 18%;--muted-foreground:240 4% 65%;--border:228 6% 21%;--input:228 6% 26%}
`;
export const PUBLIC_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap';

/** Wraps a public page in the kit's look, with the business's accent and mood. */
/** The accent colors a public surface paints with, for its mood: buttons keep the accent itself (with a light edge on
 *  Night so their shape shows), and text in the accent (links, eyebrows) is lifted on a dark page so it stays readable
 *  on its cards too. --accent-hsl carries the accent into the app's own form parts (inside .pub-ui). What PublicFrame
 *  uses, and anything that sits outside it (a panel opened over the page). */
export function moodStyle(accent: string, mood: PublicMood = 'soft'): Record<string, string> {
  const paint = accent || '#7c3aed';
  return { '--accent': paint, '--accent-text': mood === 'night' ? lifted(paint, '#222326') : paint, '--accent-hsl': hslOf(paint) };
}

/** '#8b5e57' as the 'h s% l%' the app's form parts read. */
function hslOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return '24 10% 10%';
  const n = parseInt(m[1], 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `${Math.round(((h * 60) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function PublicFrame({ accent, children, className = '', app = false, mood = 'soft' }: { accent: string; children: ReactNode; className?: string; app?: boolean; mood?: PublicMood }) {
  // app: the app's own neutral palette (soft grey paper, ink, muted) — the client's visit link uses it.
  const palette = app ? { ['--paper' as any]: '#f3f3f5', ['--ink' as any]: '#16171a', ['--muted' as any]: '#6d7075' } : {};
  const night = !app && mood === 'night';
  return (
    <div className={`pub min-h-dvh ${className}`} data-mood={app ? undefined : mood} style={{ ...moodStyle(accent, app ? 'soft' : mood), ...palette } as any}>
      <style>{PUBLIC_CSS}</style>
      <link rel="stylesheet" href={PUBLIC_FONT_HREF} />
      <PublicMotion reveal={!app} night={night} />
      {children}
    </div>
  );
}

export function Section({ id, eyebrow, title, children, className = '' }: { id?: string; eyebrow?: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`pub-reveal mx-auto max-w-6xl scroll-mt-20 px-4 py-10 sm:py-14 ${className}`}>
      {eyebrow && <p className="pub-accent-text text-[12px] font-semibold tracking-[0.2em]" style={{ textTransform: 'uppercase' }}>{eyebrow}</p>}
      {title && <h2 className="mt-1 text-3xl sm:text-4xl">{title}</h2>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function PrimaryButton({ children, onClick, className = '', label }: { children: ReactNode; onClick?: () => void; className?: string; label?: string }) {
  return <button type="button" onClick={onClick} aria-label={label} className={`pub-press inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm ${className}`} style={{ background: 'var(--accent)' }}>{children}</button>;
}
export function QuietButton({ children, onClick, href, className = '' }: { children: ReactNode; onClick?: () => void; href?: string; className?: string }) {
  const cls = `pub-press inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] shadow-sm ${className}`;
  return href ? <a href={href} className={cls}>{children}</a> : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

export const money = (n: any) => { const v = Number(n); return isFinite(v) && v > 0 ? `$${v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : ''; };
export const minutes = (m: any) => { const v = Number(m) || 0; if (!v) return ''; const h = Math.floor(v / 60), r = v % 60; return h ? `${h} hr${r ? ` ${r} min` : ''}` : `${r} min`; };
