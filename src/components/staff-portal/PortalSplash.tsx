'use client';
// src/components/staff-portal/PortalSplash.tsx — THE STAFF PORTAL'S OPENING: "your day unfolds". The business's mark,
// then today's visits slide in as bars (longer visit, longer bar) with a red "now" line sweeping to the current time,
// then "Hi Maya — 5 visits today · First up: Kim at 9:15". Plays once per sign-in session (about 2.6 s); a tap skips
// it; people who've asked their phone for less motion get a still version for a moment.
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075';
const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const OFF = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];

export function shouldShowSplash(key: string): boolean {
  try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, '1'); return true; } catch { return true; }
}

export function PortalSplash({ name, business, logo, accent = INK, visits, loading, isRenter, onDone }:
  { name: string; business: string; logo?: string | null; accent?: string; visits: any[]; loading?: boolean; isRenter?: boolean; onDone: () => void }) {
  const reduced = React.useMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }, []);
  const [leaving, setLeaving] = React.useState(false);
  const finish = React.useCallback(() => { setLeaving(true); setTimeout(onDone, 260); }, [onDone]);
  React.useEffect(() => { const t = setTimeout(finish, reduced ? 1200 : 2600); return () => clearTimeout(t); }, [finish, reduced]);

  const day = (visits || []).filter((a) => !OFF.includes(String(a?.status)) && Number.isFinite(ms(a?.startTime))).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const now = Date.now();
  const next = day.find((a) => ms(a.startTime) + (Number(a.duration) || 60) * 60000 > now) || null;
  const first = String(name || '').split(' ')[0] || 'there';
  const initials = String(business || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Bars: up to five visits, widths from their length (or a gentle placeholder pattern while the day loads / is empty).
  const longest = Math.max(60, ...day.map((a) => Number(a.duration) || 60));
  const bars = (day.length ? day.slice(0, 5).map((a) => Math.max(0.3, (Number(a.duration) || 60) / longest)) : [1, 0.82, 0.4, 0.92, 0.66]).map((w, i) => ({ w, gap: !day.length && i === 2 }));
  const span = day.length ? [ms(day[0].startTime), Math.max(...day.map((a) => ms(a.startTime) + (Number(a.duration) || 60) * 60000))] : null;
  const nowPct = span && now > span[0] ? Math.min(96, ((now - span[0]) / (span[1] - span[0])) * 100) : 38;
  const headline = isRenter ? `Hi ${first}` : loading && !day.length ? `Hi ${first}` : day.length ? `Hi ${first} — ${day.length} visit${day.length === 1 ? '' : 's'} today` : `Hi ${first} — no visits booked today`;
  const sub = isRenter ? 'Your booth, your business.' : next ? `${ms(next.startTime) <= now ? 'Now' : 'First up'}: ${String(next.clientName || 'Client').split(' ')[0]} at ${hm(ms(next.startTime))}${next.stationName ? ` · ${next.stationName}` : ''}` : loading ? 'Getting your day ready' : 'Anything new will show up here.';

  return (
    <div role="status" aria-label={`${headline}. ${sub}`} onClick={finish}
      className="fixed inset-0 z-[100] flex flex-col justify-center gap-[30px] bg-white px-7"
      style={{ color: INK, opacity: leaving ? 0 : 1, transition: 'opacity .26s ease', fontFamily: 'inherit' }}>
      <style>{`
        @keyframes cfSpBar{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
        @keyframes cfSpIn{0%{transform:translateY(12px);opacity:0}100%{transform:translateY(0);opacity:1}}
        @keyframes cfSpNow{0%{left:0;opacity:0}30%{opacity:1}100%{opacity:1}}
        .cf-sp-bar{transform-origin:left center;animation:cfSpBar .7s cubic-bezier(.65,0,.35,1) both}
        .cf-sp-in{animation:cfSpIn .5s ease-out both}
        .cf-sp-now{animation:cfSpNow 1s cubic-bezier(.65,0,.35,1) .45s both}
        @media (prefers-reduced-motion: reduce){.cf-sp-bar,.cf-sp-in,.cf-sp-now{animation:none}}
      `}</style>
      <div className="cf-sp-in flex items-center gap-3">
        {logo ? <img src={logo} alt="" className="h-11 w-11 rounded-[14px] object-cover" />
          : <span className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[16px] font-extrabold text-white" style={{ background: accent }}>{initials}</span>}
        <span className="text-[15px] font-bold" style={{ color: '#55585e' }}>{business}</span>
      </div>
      {!isRenter && (
        <div aria-hidden className="relative flex flex-col gap-2.5">
          {bars.map((b, i) => b.gap
            ? <div key={i} className="cf-sp-bar h-[14px] rounded-[4px] border-[1.5px] border-dashed" style={{ width: `${b.w * 100}%`, borderColor: '#c9cacf', animationDelay: `${i * 0.12}s` }} />
            : <div key={i} className="cf-sp-bar flex h-[14px] gap-[3px]" style={{ width: `${b.w * 100}%`, animationDelay: `${i * 0.12}s` }}>
                <div className="flex-1 rounded-[4px]" style={{ background: '#c7cad1' }} />
                <div className="rounded-[4px]" style={{ flex: 7, background: accent }} />
                <div className="flex-1 rounded-[4px]" style={{ background: '#c7cad1' }} />
              </div>)}
          <div className="cf-sp-now absolute -bottom-2.5 -top-2.5 w-[2px]" style={{ left: `${nowPct}%`, background: '#e5484d' }}>
            <span className="absolute -left-[3px] -top-1 h-2 w-2 rounded-full" style={{ background: '#e5484d' }} />
          </div>
        </div>)}
      <div className="flex flex-col gap-1.5">
        <p className="cf-sp-in text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ animationDelay: '.55s' }}>{headline}</p>
        <p className="cf-sp-in text-[15px]" style={{ color: MUTED, animationDelay: '.7s' }}>{sub}</p>
      </div>
    </div>);
}
