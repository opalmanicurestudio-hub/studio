'use client';
// "Say it when they sit down" (design canvas "Loyalty engine", board 6): before the visit, the provider and the desk see
// what makes this client feel known — a notable visit number, an anniversary, a birthday nearby, a reward that's ready,
// what they're saving for, their tier's perk, and a surprise that's due. Nothing shows when there's nothing to say.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

export function VisitCue({ tenantId, clientId, compact }: { tenantId: string; clientId: string | null | undefined; compact?: boolean }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { setD(null); if (!tenantId || !clientId || clientId === 'walk-in') return; payPost('/api/loyalty', { tenantId, action: 'client', clientId }).then((r) => setD(r?.ok && r.on ? r : null)); }, [tenantId, clientId]);
  if (!d) return null;
  const x = d.extras || {}; const unit = d.unit || 'points'; const ready = (d.ready || [])[0] || null; const tp = x.tierPerks;
  const lines: { t: string; tone?: 'mint' }[] = [];
  if (ready) lines.push({ t: `${ready.name} is ready${x.goal?.chosen && x.goal.toGo > 0 ? ` · saving for ${x.goal.name.toLowerCase()} (${x.goal.toGo} ${unit} to go)` : ''}`, tone: 'mint' });
  else if (x.goal && x.goal.toGo > 0) lines.push({ t: `${x.goal.chosen ? 'Saving for' : 'Next up'}: ${x.goal.name.toLowerCase()} (${x.goal.toGo} ${unit} to go)` });
  if (tp?.upgrade) lines.push({ t: `${tp.name}: ${tp.upgrade.fromName.toLowerCase()} becomes ${tp.upgrade.toName.toLowerCase()}, free` });
  if (x.surprise) lines.push({ t: `A surprise is due (${x.surprise.why.toLowerCase()}): ${x.surprise.name.toLowerCase()}. Add it at checkout.`, tone: 'mint' });
  const cues: string[] = x.cues || [];
  if (!cues.length && !lines.length) return null;
  return (
    <section aria-label="Before the visit" className={compact ? 'rounded-[16px] p-3' : 'rounded-[20px] p-4'} style={{ background: '#16171a', color: '#fff' }}>
      <p className="text-[12.5px]" style={{ color: '#c9cace' }}>{cues.length ? 'Say it when they sit down' : 'Rewards'}{d.tier ? ` · ${d.tier.name}` : ''}</p>
      {cues.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{cues.map((c) => <span key={c} className="rounded-full px-3 py-1.5 text-[13.5px]" style={{ background: '#2c2d31' }}>{c}</span>)}</div>}
      {lines.map((l, i) => <p key={i} className="mt-1.5 text-[13.5px]" style={{ color: l.tone === 'mint' ? '#7fd1a5' : '#fff' }}>{l.t}</p>)}
    </section>);
}
