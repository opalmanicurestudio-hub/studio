'use client';
// What the business owes its clients but hasn't been spent yet: store credit (referral rewards, make-it-right credit,
// refunds as credit) and gift card balances. Neither is revenue until it's used at checkout.
import * as React from 'react';
import { useInventory } from '@/context/InventoryContext';
import { creditBalance, availableCredits } from '@/lib/store-credit';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SRC: Record<string, string> = { referral_reward: 'Referral rewards', service_recovery: 'Making it right', recovery: 'Making it right', refund: 'Refunds as credit', manual: 'Added by hand' };

export function OwedToClientsCard() {
  const { clients } = useInventory() as any;
  const s = React.useMemo(() => {
    let total = 0, people = 0; const by: Record<string, number> = {};
    for (const c of clients || []) { const b = creditBalance(c); if (b <= 0) continue; total += b; people++;
      for (const x of availableCredits(c)) { const k = SRC[String(x.source || '')] ? String(x.source) : 'other'; by[k] = (by[k] || 0) + (Number(x.amount) || 0); } }
    return { total: Math.round(total * 100) / 100, people, by };
  }, [clients]);
  if (!s.people) return null;
  return (
    <div className="mb-5 rounded-[18px] border bg-card p-4 md:mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[13px] text-muted-foreground">Owed to clients as store credit</p><p className="text-[28px] font-light tracking-tight">{money(s.total)}</p>
          <p className="text-[13px] text-muted-foreground">{s.people} client{s.people === 1 ? '' : 's'} · comes off by itself at their next checkout</p></div>
        <a href="/gift-cards" className="text-[13.5px] font-semibold underline underline-offset-4">Gift card balances</a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{Object.entries(s.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="rounded-full bg-secondary px-3 py-1 text-[12.5px]">{SRC[k] || 'Other credit'} · {money(v)}</span>)}</div>
    </div>);
}
