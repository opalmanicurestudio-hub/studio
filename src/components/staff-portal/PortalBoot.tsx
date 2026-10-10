'use client';
// src/components/staff-portal/PortalBoot.tsx — WHAT THE STAFF PORTAL SHOWS THE MOMENT IT OPENS (from the Home Screen
// icon or a link): the business's mark and the "day unfolding" bars, in the business's colour — instead of a blank
// "Loading…". Kept tiny (no database) so it can show before anything else loads; the business's name, colour and logo
// come from the last visit on this phone (rememberBrand), so it looks right from the first frame.
import * as React from 'react';

const INK = '#16171a';
type B = { name?: string; accent?: string; logoUrl?: string | null };
const KEY = (t: string) => `cf_portal_brand_${t}`;
export function rememberBrand(tenantId: string, b: B) { try { if (tenantId && b?.name) localStorage.setItem(KEY(tenantId), JSON.stringify({ name: b.name, accent: b.accent || INK, logoUrl: b.logoUrl || null })); } catch { /* private mode */ } }
export function savedBrand(tenantId: string): B { try { return JSON.parse(localStorage.getItem(KEY(tenantId)) || '{}') || {}; } catch { return {}; } }

export function PortalBoot({ tenantId, label }: { tenantId: string; label?: string }) {
  const [b, setB] = React.useState<B>({});
  React.useEffect(() => { setB(savedBrand(tenantId)); }, [tenantId]);
  const accent = b.accent || INK; const initials = String(b.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const bars = [1, 0.82, 0.4, 0.92, 0.66];
  return (
    <div role="status" aria-label={label || `Opening ${b.name || 'your portal'}`} className="fixed inset-0 z-[90] flex flex-col justify-center gap-[30px] bg-white px-7" style={{ color: INK }}>
      <style>{`
        @keyframes cfBootBar{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
        @keyframes cfBootIn{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
        @keyframes cfBootPulse{0%,100%{opacity:.35}50%{opacity:1}}
        .cf-boot-bar{transform-origin:left center;animation:cfBootBar .7s cubic-bezier(.65,0,.35,1) both}
        .cf-boot-in{animation:cfBootIn .45s ease-out both}
        .cf-boot-dot{animation:cfBootPulse 1s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.cf-boot-bar,.cf-boot-in,.cf-boot-dot{animation:none}}
      `}</style>
      <div className="cf-boot-in flex items-center gap-3">
        {b.logoUrl ? <img src={b.logoUrl} alt="" className="h-11 w-11 rounded-[14px] object-cover" />
          : <span className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[16px] font-extrabold text-white" style={{ background: accent }}>{initials || '·'}</span>}
        <span className="text-[15px] font-bold" style={{ color: '#55585e' }}>{b.name || ''}</span>
      </div>
      <div aria-hidden className="flex flex-col gap-2.5">
        {bars.map((w, i) => i === 2
          ? <div key={i} className="cf-boot-bar h-[14px] rounded-[4px] border-[1.5px] border-dashed" style={{ width: `${w * 100}%`, borderColor: '#c9cacf', animationDelay: `${i * 0.12}s` }} />
          : <div key={i} className="cf-boot-bar flex h-[14px] gap-[3px]" style={{ width: `${w * 100}%`, animationDelay: `${i * 0.12}s` }}>
              <div className="flex-1 rounded-[4px]" style={{ background: '#c7cad1' }} /><div className="rounded-[4px]" style={{ flex: 7, background: accent }} /><div className="flex-1 rounded-[4px]" style={{ background: '#c7cad1' }} />
            </div>)}
      </div>
      <div aria-hidden className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="cf-boot-dot h-1.5 w-1.5 rounded-full" style={{ background: accent, animationDelay: `${i * 0.15}s` }} />)}</div>
    </div>);
}
