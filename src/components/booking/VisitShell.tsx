'use client';
// src/components/booking/VisitShell.tsx — the look of every screen of a client's visit link (before the day, on the
// day, checked in, finished, canceled…): the same header as the business's booking page (their logo or first letter,
// their name, and where the visit is up to), their color and mood (Soft, Crisp or Night), big calm type, and cards and
// rows in the booking page's style. Wording works for in-person, virtual and mobile appointments alike.
import React from 'react';
import { PublicFrame, type PublicMood } from '@/components/public/kit';
import { Calendar, Car, DoorOpen, MapPin, PlayCircle, XCircle } from 'lucide-react';
import { brandColor, studioPage, type VisitNotes } from '@/lib/studio-page';
import { hasTimeZone, tenantTimeZone } from '@/lib/tenant-time';

export type VisitBrand = { accent: string; mood?: PublicMood; logo?: string | null; studioName?: string | null; bookHref?: string | null; phone?: string | null;
  /** The business's time zone, when it has set one: the visit screens show their times in it (wallDate). */
  zone?: string | null };

/** The business's look + contact, from its settings: the same color and mood as its booking page. */
export function brandOf(tenant: any, tenantId?: string | null, serviceId?: string | null): VisitBrand {
  const t = tenant || {};
  return {
    accent: brandColor(t),
    mood: studioPage(t).mood,
    logo: typeof t.logoUrl === 'string' && t.logoUrl ? t.logoUrl : null,
    studioName: t.name || t.businessName || null,
    bookHref: tenantId ? `/book/${tenantId}${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ''}` : null,
    phone: t.phone || t.twilioPhoneNumber || null,
    zone: hasTimeZone(t) ? tenantTimeZone(t) : null,
  };
}

/** What sits at the foot of every visit screen ("Not you?", the way to the next booking): set once by the page. */
export const VisitFooter = React.createContext<React.ReactNode>(null);
/** What sits at the top of every visit screen, under its title (their total, waiting to be paid): set by the page. */
export const VisitTop = React.createContext<React.ReactNode>(null);

export function VisitShell({ brand, title, subtitle, kicker, chip, children }: { brand: VisitBrand; title?: React.ReactNode; subtitle?: React.ReactNode; kicker?: React.ReactNode; chip?: string | null; children?: React.ReactNode }) {
  const footer = React.useContext(VisitFooter); const top = React.useContext(VisitTop);
  const name = String(brand.studioName || '').trim();
  return (
    <PublicFrame accent={brand.accent} mood={brand.mood || 'soft'}>
      <style>{VISIT_CSS}</style>
      <header className="pub-bar border-b" style={{ borderColor: 'var(--line)', paddingTop: 'env(safe-area-inset-top,0px)' }}>
        <div className="mx-auto flex h-[58px] max-w-md items-center gap-2.5 px-4">
          {brand.logo ? <img src={brand.logo} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" style={{ background: '#fff' }} />
            : <span className="v-mark" aria-hidden>{(Array.from(name)[0] || '·').toUpperCase()}</span>}
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{name || 'Your visit'}</p>
          {chip && <span className="v-chip">{chip}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-md space-y-4 px-4 pb-10 pt-6 pub-safe-bottom">
        {(kicker || title || subtitle) && <div className="pub-rise space-y-1 px-1">
          {kicker && <p className="text-[14.5px]" style={{ color: 'var(--muted)' }}>{kicker}</p>}
          {title && <h1 className="text-[31px] leading-[1.12]">{title}</h1>}
          {subtitle && <p className="pt-0.5 text-[14.5px] leading-snug" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        </div>}
        {top}
        {children}
        {footer}
      </main>
    </PublicFrame>
  );
}

export const VisitCard = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' }) => (
  <section className="pub-card space-y-3 p-5" style={tone === 'warn' ? { boxShadow: 'inset 0 0 0 2px var(--warn)' } : tone === 'ok' ? { boxShadow: 'inset 0 0 0 2px var(--good)' } : undefined}>{children}</section>
);

/** The visit link's buttons: the business color, `quiet` (card), `good` (green, for checking in), or `danger` (a quiet
 *  button in red, for the one destructive choice on a screen). */
export function VisitButton({ children, onClick, href, quiet, good, danger, disabled, target, expanded }: { children: React.ReactNode; onClick?: () => void; href?: string | null; quiet?: boolean; good?: boolean; danger?: boolean; disabled?: boolean; target?: string; expanded?: boolean }) {
  const cls = `v-btn pub-press ${danger ? 'v-btn-quiet v-danger' : quiet ? 'v-btn-quiet' : good ? 'v-btn-good' : ''}`;
  return href ? <a href={href} target={target} rel={target ? 'noreferrer' : undefined} className={cls}>{children}</a> : <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-expanded={expanded}>{children}</button>;
}

export const VisitMuted = ({ children }: { children: React.ReactNode }) => <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{children}</p>;

/** A calm section label (no all-caps micro-labels). */
export const VisitLabel = ({ children }: { children: React.ReactNode }) => <p className="px-1 pb-2 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{children}</p>;

export type VisitRow = { key?: string; icon?: React.ReactNode; text: React.ReactNode; right?: React.ReactNode; href?: string | null; target?: string; onClick?: () => void; danger?: boolean; chevron?: boolean };
/** A group of rows (Getting here, Change or cancel…), each a link or a button when it does something. */
export function VisitRows({ rows, label }: { rows: (VisitRow | false | null | undefined | '')[]; label?: string }) {
  const list = rows.filter(Boolean) as VisitRow[]; if (!list.length) return null;
  return (
    <section aria-label={label}>
      {label && <VisitLabel>{label}</VisitLabel>}
      <div className="v-grp">{list.map((r, i) => {
        const inner = <>{r.icon && <span className="v-ico" aria-hidden>{r.icon}</span>}<span className="min-w-0 flex-1 py-3">{r.text}</span>
          {r.right && <span className="shrink-0 text-right text-[13.5px]" style={{ color: 'var(--muted)' }}>{r.right}</span>}
          {(r.chevron ?? !!(r.href || r.onClick)) && <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', flexShrink: 0 }}><path d="m9 6 6 6-6 6" /></svg>}</>;
        const cls = `v-row ${r.href || r.onClick ? 'v-tap' : ''} ${r.danger ? 'v-danger' : ''}`; const style = undefined;
        return r.href ? <a key={r.key || i} href={r.href} target={r.target} rel={r.target ? 'noreferrer' : undefined} className={cls} style={style}>{inner}</a>
          : r.onClick ? <button key={r.key || i} type="button" onClick={r.onClick} className={`${cls} w-full text-left`} style={style}>{inner}</button>
            : <div key={r.key || i} className={cls} style={style}>{inner}</div>;
      })}</div>
    </section>
  );
}

const ico = (I: any) => <I className="h-[18px] w-[18px]" />;
/** Getting here, in the business's own words (Settings › Booking page › Visit us): the address with directions, parking,
 *  the way in, and a video of the way in. Nothing shows when none of it is set. */
export function VisitGettingHere({ address, notes }: { address?: string | null; notes?: VisitNotes | null }) {
  const n: VisitNotes = notes || {};
  return <VisitRows label="Getting here" rows={[
    address && { key: 'a', icon: ico(MapPin), text: address, href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`, target: '_blank' },
    n.parking && { key: 'p', icon: ico(Car), text: <span className="whitespace-pre-line">{n.parking}</span> },
    n.entrance && { key: 'e', icon: ico(DoorOpen), text: <span className="whitespace-pre-line">{n.entrance}</span> },
    typeof n.video === 'string' && /^https?:\/\//i.test(n.video) && { key: 'v', icon: ico(PlayCircle), text: 'Watch the way in', href: n.video, target: '_blank' },
  ]} />;
}

/** Change or cancel, with until when it's free ("free until Thu 3:30 PM"), or that it now counts as late. */
export function VisitChange({ freeUntil, onReschedule, onCancel }: { freeUntil?: string; onReschedule?: () => void; onCancel?: () => void }) {
  if (!onReschedule && !onCancel) return null;
  const free = freeUntil && freeUntil !== 'late' ? freeUntil : '';
  return (
    <section aria-label="Change or cancel">
      <VisitLabel>Change or cancel{free ? <span style={{ fontWeight: 400 }}> · {free}</span> : null}</VisitLabel>
      <VisitRows rows={[
        onReschedule && { key: 'r', icon: ico(Calendar), text: 'Change the time', onClick: onReschedule },
        onCancel && { key: 'c', icon: ico(XCircle), text: 'Cancel', onClick: onCancel, danger: true },
      ]} />
      {freeUntil === 'late' && <p className="px-1 pt-2 text-[13px]" style={{ color: 'var(--muted)' }}>It’s inside the cancellation window now, so a change or cancellation counts as late.</p>}
    </section>
  );
}

/** A tick box with its words, the whole row tappable (44px or more). */
export function VisitCheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[15px] leading-snug">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'var(--accent)' }} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** A plain line said back to the client: amber when something didn't go through, green-ish when it did. */
export const VisitSaid = ({ text, ok }: { text?: string | null; ok?: boolean }) => text
  ? <p className="px-1 text-[14px] leading-snug" role={ok ? 'status' : 'alert'} style={{ color: ok ? 'var(--good)' : 'var(--warn)' }}>{text}</p> : null;

/** Choice pills — one of a few options. */
export function VisitChoice<T extends string | number>({ value, onChange, options, cols }: { value: T; onChange: (v: T) => void; options: [T, string][]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={`grid gap-2 ${cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`} role="radiogroup">
      {options.map(([v, l]) => {
        const on = v === value;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)} className="v-pill pub-press">{l}</button>;
      })}
    </div>
  );
}

/** A plain select in the booking page's style. */
export function VisitSelect({ value, onChange, options, label }: { value: string | number; onChange: (v: string) => void; options: { value: string | number; label: string }[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="v-field h-12">
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A text field / textarea in the booking page's style. */
export function VisitInput({ value, onChange, placeholder, multiline, label }: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; label: string }) {
  return multiline
    ? <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="v-field py-3" />
    : <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="v-field h-12" />;
}

// Every color is the mood's (paper, card, ink, muted, line, soft), so Soft, Crisp and Night all follow; Crisp tightens
// the corners. 44px or more for everything tapped.
export const VISIT_CSS = String.raw`
.v-mark{width:36px;height:36px;border-radius:11px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;flex:none}
.v-chip{flex:none;border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600;background:var(--soft);color:var(--ink)}
.v-btn{display:inline-flex;width:100%;min-height:52px;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:0 22px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;text-align:center;box-shadow:0 10px 24px -16px rgba(0,0,0,.45)}
.v-btn:disabled{opacity:.45;box-shadow:none}
.v-btn-good{background:var(--good)}.pub[data-mood=night] .v-btn-good{color:#16171a}
.v-btn-quiet{min-height:50px;background:var(--card);color:var(--ink);font-weight:500;box-shadow:inset 0 0 0 1px var(--line),0 1px 2px rgba(28,25,23,.05)}
.pub[data-mood=crisp] :is(.v-btn,.v-pill){border-radius:12px}.pub[data-mood=crisp] .v-mark{border-radius:8px}
.pub[data-mood=night] :is(.v-btn:not(.v-btn-quiet),.v-pill[aria-checked=true],.v-pill[aria-pressed=true],.v-mark){box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.v-pill{min-height:44px;border-radius:999px;padding:0 14px;font-size:14.5px;font-weight:500;background:var(--card);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.v-pill[aria-checked=true],.v-pill[aria-pressed=true]{background:var(--accent);color:#fff;font-weight:600;box-shadow:none}
.v-field{width:100%;border-radius:16px;background:var(--card);color:var(--ink);padding-left:16px;padding-right:16px;font-size:16px;outline:none;box-shadow:inset 0 0 0 1px var(--line)}
.v-field::placeholder{color:var(--muted);opacity:.8}
.pub[data-mood=crisp] .v-field{border-radius:10px}
.v-grp{background:var(--card);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(28,25,23,.05),0 8px 24px -18px rgba(28,25,23,.25)}
.pub[data-mood=crisp] .v-grp{border-radius:12px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=night] .v-grp{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.v-row{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-top:1px solid var(--line);font-size:15.5px;color:var(--ink)}
.v-row:first-child{border-top:0}
.v-tap{transition:background .15s}.v-tap:active{background:var(--soft)}
.v-ico{flex:none;display:grid;place-items:center;width:22px;color:var(--muted)}
.v-soft{background:var(--soft)}
.v-note{background:var(--soft);border-radius:18px;padding:14px 16px;font-size:15px;line-height:1.45;color:var(--ink)}
.pub[data-mood=crisp] .v-note{border-radius:12px}
.v-danger,.v-btn-quiet.v-danger{color:#b42318}.pub[data-mood=night] .v-danger{color:#f4a39a}
@keyframes vPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes vDraw{to{stroke-dashoffset:0}}
.v-check{width:64px;height:64px;border-radius:50%;background:var(--good-soft);color:var(--good);display:inline-grid;place-items:center;animation:vPop .5s cubic-bezier(.2,.8,.2,1) both}
.v-check .v-draw{stroke-dasharray:24;stroke-dashoffset:24;animation:vDraw .55s .2s cubic-bezier(.65,0,.35,1) forwards}
@media (prefers-reduced-motion:reduce){.v-check{animation:none}.v-check .v-draw{animation:none;stroke-dashoffset:0}}
`;

/** A check that draws itself, in the good color of the mood. */
export const VisitCheck = ({ size = 30 }: { size?: number }) => (
  <span className="v-check" aria-hidden><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path className="v-draw" d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
);
