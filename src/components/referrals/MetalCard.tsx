'use client';
// src/components/referrals/MetalCard.tsx — a Circle member's card (design canvas RF16): light for Insider, graphite for
// Ambassador, deep green for Icon and Creators. A slow sheen passes once; still for anyone with Reduce Motion on.
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const LOOK: Record<string, { bg: string; fg: string; line: string }> = {
  insider: { bg: 'linear-gradient(135deg,#ffffff 0%,#eceef1 55%,#d9dce1 100%)', fg: '#16171a', line: 'rgba(22,23,26,.1)' },
  ambassador: { bg: 'linear-gradient(135deg,#4a4e57 0%,#2a2d33 45%,#1b1d21 100%)', fg: '#ffffff', line: 'rgba(255,255,255,.12)' },
  icon: { bg: 'linear-gradient(135deg,#1d3a2c 0%,#111816 50%,#050706 100%)', fg: '#ffffff', line: 'rgba(255,255,255,.12)' },
  creator: { bg: 'linear-gradient(135deg,#1d3a2c 0%,#111816 50%,#050706 100%)', fg: '#ffffff', line: 'rgba(255,255,255,.12)' },
  none: { bg: 'linear-gradient(135deg,#2b2e34 0%,#121315 55%,#000 100%)', fg: '#ffffff', line: 'rgba(255,255,255,.12)' },
};

export function MetalCard({ look, program, tier, name, sub, compact = false }: { look: 'insider' | 'ambassador' | 'icon' | 'creator' | 'none'; program: string; tier: string; name: string; sub?: string; compact?: boolean }) {
  const still = !!useReducedMotion(); const L = LOOK[look] || LOOK.none;
  return (
    <div className="relative w-full overflow-hidden rounded-[20px]" style={{ background: L.bg, color: L.fg, aspectRatio: compact ? '1.6 / 1' : '1.62 / 1', boxShadow: '0 26px 50px -24px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.18)' }}
      role="img" aria-label={`${program} card: ${tier}, ${name}`}>
      {!still && <motion.div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(115deg, transparent 35%, rgba(255,255,255,.18) 48%, transparent 60%)' }}
        initial={{ x: '-110%' }} animate={{ x: '110%' }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.4 }} />}
      <div aria-hidden="true" className="absolute inset-[10px] rounded-[14px]" style={{ border: `1px solid ${L.line}` }} />
      {!compact && <p className="absolute left-5 top-4 max-w-[55%] truncate text-[10.5px] uppercase tracking-[0.26em] opacity-80">{program}</p>}
      <p className={`absolute ${compact ? 'left-4 right-auto top-3.5 text-[9.5px]' : 'right-4 top-3.5 text-[10.5px]'} rounded-full px-2.5 py-0.5 uppercase tracking-[0.2em]`} style={{ border: `1px solid ${look === 'insider' ? 'rgba(22,23,26,.25)' : 'rgba(255,255,255,.35)'}` }}>{tier}</p>
      <div className="absolute bottom-4 left-5 right-5"><p className={`${compact ? 'text-[18px]' : 'text-[22px]'} truncate font-light tracking-[-0.02em]`}>{name}</p>{sub && <p className="truncate text-[11.5px] opacity-70">{sub}</p>}</div>
    </div>
  );
}
