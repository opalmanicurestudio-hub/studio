'use client';
// /ref/[tenantId]/[code] — A FRIEND'S WELCOME, in the layout the business chose (Referrals → Settings → Welcome page):
// Invitation, Editorial, Postcard, Stories or Simple (components/referrals/WelcomeLayouts). Every layout is built
// only from real details, in the business's own section order, with the gift already applied. The settings preview
// can try a layout before saving with ?layout=…&sections=…&motion=0; that changes only how this page looks.
// /api/referrals/public (welcome).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { useWelcome, LAYOUT_VIEW, INK, MUTED, FONT, type Welcome } from '@/components/referrals/WelcomeLayouts';

const LAYOUTS = Object.keys(LAYOUT_VIEW);
const SECTION_KEYS = ['favorite', 'provider', 'visit', 'photos', 'good', 'proof'];

function View({ d, tenantId, code, still }: { d: Welcome; tenantId: string; code: string; still: boolean }) {
  const c = useWelcome(d, tenantId, code, still); const L = LAYOUT_VIEW[d.layout] || LAYOUT_VIEW.invitation;
  return <div style={{ color: INK, fontFamily: FONT }}><L c={c} /></div>;
}

export default function ReferralWelcome() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const code = String(p?.code || '');
  const reduced = !!useReducedMotion();
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'welcome', tenantId, code }) })
      .then((r) => r.json()).then((r) => {
        if (r?.ok) {
          const lay = q.get('layout'); if (lay && LAYOUTS.includes(lay)) r.layout = lay;
          const sec = q.get('sections'); if (sec != null) r.sections = sec.split(',').filter((x) => SECTION_KEYS.includes(x));
          if (q.get('motion') === '0') r.motion = false; if (q.get('motion') === '1') r.motion = true;
          r.providers = r.providers || []; r.anyTimes = r.anyTimes || r.times || []; r.photos = r.photos || []; r.steps = r.steps || []; r.sections = r.sections || SECTION_KEYS;
        }
        setD(r);
      }).catch(() => setD({ ok: false, error: 'This page couldn’t load. Please try again.' }));
  }, [tenantId, code]);
  const shell = { color: INK, fontFamily: FONT, background: '#fff' } as React.CSSProperties;
  if (!d) return <main className="flex min-h-screen items-center justify-center" style={shell}><p style={{ color: MUTED }}>One moment…</p></main>;
  if (!d.ok) return <main className="mx-auto min-h-screen max-w-[480px] space-y-3 px-5 py-12" style={shell}><h1 className="text-[28px] font-light tracking-[-0.02em]">This offer isn’t available</h1><p style={{ color: MUTED }}>{d.error}</p>
    <a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-flex h-12 items-center rounded-full px-6 font-semibold text-white" style={{ background: INK }}>See services</a></main>;
  return <View d={d} tenantId={tenantId} code={code} still={reduced || d.motion === false} />;
}
