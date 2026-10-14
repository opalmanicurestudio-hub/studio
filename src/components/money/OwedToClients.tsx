'use client';
// src/components/money/OwedToClients.tsx — Money: WHAT YOU STILL OWE CLIENTS. Unused store credit (referral rewards
// apart from refunds and goodwill) and gift card balances. It isn't income until it's spent. /api/money/owed.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d.toLocaleString('en-US', { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };

export function OwedToClients({ tenantId }: { tenantId?: string | null }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (tenantId) void payPost('/api/money/owed', { tenantId }).then(setD).catch(() => setD({ ok: false })); }, [tenantId]);
  if (!d?.ok || d.totalCents <= 0) return null;
  const line = (label: string, v: number, sub?: string) => v > 0 ? <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{label}{sub && <span className="block text-[12px]" style={{ color: MUTED }}>{sub}</span>}</span><span className="font-semibold">{money(v)}</span></div> : null;
  return (
    <section className="mb-6 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE, color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }} aria-label="What you still owe clients">
      <div className="flex flex-wrap items-end justify-between gap-2 pb-2"><div><p className="text-[12px] font-semibold" style={{ color: MUTED }}>What you still owe clients</p>
        <p className="text-[28px] font-light tracking-[-0.02em]">{money(d.totalCents)}</p></div>
        <p className="max-w-[360px] text-[12.5px]" style={{ color: MUTED }}>Credit and gift card balances clients can still spend. It isn’t income until it’s used.</p></div>
      {line('Referral rewards', d.credit.referralCents)}
      {line('Store credit', d.credit.otherCents, 'refunds and goodwill')}
      {line('Gift cards', d.gift.cents, `${d.gift.cards} card${d.gift.cards === 1 ? '' : 's'} with a balance`)}
      {d.credit.endingSoonCents > 0 && <p className="pt-2 text-[12.5px]" style={{ color: AMBER }}>{money(d.credit.endingSoonCents)} of credit ends in the next 30 days.</p>}
    </section>);
}
