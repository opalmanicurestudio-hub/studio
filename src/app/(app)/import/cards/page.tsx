'use client';
// src/app/(app)/import/cards/page.tsx — MOVING IN → CARDS ON FILE (lib/card-save). Card details can't be moved between
// apps, so members add theirs here with their own private link. Who has, who's been sent the link, whose charge is
// coming up — and one button to send the links. Reminders go out by themselves 3 days and 1 day before a charge, and a
// charge with no card yet waits instead of failing (lib/memberships/renewals).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const card = { background: 'hsl(var(--card))', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const $ = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const DAY = 864e5;

export default function CardsOnFilePage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [list, setList] = React.useState<any[] | null>(null); const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);
  const load = React.useCallback(() => { if (tenantId && isManager) payPost('/api/cards', { tenantId, action: 'members' }).then((r) => setList(r.ok ? r.members : [])); }, [tenantId, isManager]);
  React.useEffect(() => { load(); }, [load]);
  const send = async (ids: string[], key: string) => { setBusy(key); setMsg(null); const r = await payPost('/api/cards', { tenantId, action: 'send', clientIds: ids }); setBusy(null);
    setMsg({ ok: !!r.ok && !r.failed?.length, t: r.ok ? `Sent ${r.sent} link${r.sent === 1 ? '' : 's'}.${r.failed?.length ? ` ${r.failed.length} couldn’t be sent — no phone or email, or it didn’t go through.` : ''}` : r.error || 'That didn’t send.' }); load(); };
  if (!isManager) return <div className="p-6"><AppHeader title="Cards on file" /><p className="mt-6" style={{ color: MUTED }}>This is for managers.</p></div>;
  const members = list || []; const withCard = members.filter((m) => m.card); const without = members.filter((m) => !m.card);
  const soon = without.filter((m) => m.nextCharge && Date.parse(m.nextCharge) - Date.now() < 7 * DAY);
  const waitingMonthly = without.reduce((s, m) => s + (m.interval === 'yearly' ? m.price / 12 : m.price), 0);
  const toSend = without.filter((m) => (m.canText || m.canEmail) && (!m.link?.sentAt || Date.now() - Date.parse(m.link.sentAt) > 2 * DAY));
  const status = (m: any): [string, string] => {
    if (m.card) return [`Added ${day(m.card.savedAt || m.link?.savedAt)} ✓`, GREEN];
    if (m.waiting) return [`Charge waiting since ${day(m.waiting)}`, AMBER];
    if (!m.canText && !m.canEmail) return ['No phone or email', RED];
    if (!m.link?.sentAt) return ['Not sent yet', MUTED];
    const nextRem = m.nextCharge ? [3, 1].map((d) => Date.parse(m.nextCharge) - d * DAY).find((t) => t > Date.now()) : null;
    return [`${m.link.count > 1 ? `Reminded ${m.link.count === 2 ? 'twice' : `${m.link.count} times`}` : `Link sent ${day(m.link.sentAt)}`}${nextRem ? ` — next ${day(new Date(nextRem).toISOString())}` : ''}`, m.nextCharge && Date.parse(m.nextCharge) - Date.now() < 7 * DAY ? AMBER : MUTED];
  };
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: 'hsl(var(--background))', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%)' }}>
      <AppHeader title="Cards on file" />
      <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[13px]" style={{ color: MUTED }}><a href="/import" className="underline-offset-4 hover:underline">Moving in</a> › Cards on file</p>
            <h1 className="text-[36px] font-normal tracking-[-0.03em]">Cards on file</h1>
            <p className="max-w-2xl text-[14.5px]" style={{ color: MUTED }}>Card details can’t be moved between apps — no app is allowed to hand them over. Members add theirs here with one tap from a private link.</p></div>
          {toSend.length > 0 && <button type="button" disabled={!!busy} onClick={() => send(toSend.map((m) => m.clientId), 'all')} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-background disabled:opacity-50" style={{ background: INK }}>{busy === 'all' ? 'Sending…' : `Send ${toSend.length} link${toSend.length === 1 ? '' : 's'}`}</button>}
        </div>
        {msg && <p className="text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : RED }} role="status">{msg.t}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[[`${withCard.length} of ${members.length}`, 'members have added a card', INK], [String(soon.length), 'next charge in the next 7 days, no card yet', soon.length ? AMBER : INK], [$(Math.round(waitingMonthly)), 'monthly charges waiting on a card', INK]].map(([n, l, c]) => (
            <div key={l} className="p-4" style={card}><p className="text-[30px] font-normal tracking-[-0.03em]" style={{ color: c }}>{n}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>))}
        </div>
        <div className="overflow-x-auto" style={card}>
          {list === null ? <p className="p-5" style={{ color: MUTED }}>Loading…</p> : members.length === 0 ? <p className="p-5" style={{ color: MUTED }}>No members yet. When memberships come over from your old app (or you enroll people here), they show up here.</p> :
            <table className="w-full min-w-[760px] text-[14.5px]"><thead><tr className="text-left text-[12.5px]" style={{ color: MUTED }}>{['Member', 'Plan', 'Next charge', 'Card', ''].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr></thead>
              <tbody>{members.map((m) => { const [s, c] = status(m); const near = !m.card && m.nextCharge && Date.parse(m.nextCharge) - Date.now() < 7 * DAY; return (
                <tr key={m.clientId} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="px-4 py-3 font-semibold"><a href={`/clients/${m.clientId}`} className="hover:underline">{m.name}</a></td>
                  <td className="px-4 py-3">{m.plan} · {$(m.price)}{m.interval === 'yearly' ? '/yr' : ''}</td>
                  <td className="px-4 py-3" style={{ color: near ? AMBER : INK }}>{day(m.nextCharge)}</td>
                  <td className="px-4 py-3" style={{ color: c }}>{m.card ? `${s.replace(' ✓', '')} · ${m.card.brand} ••${m.card.last4} ✓` : s}</td>
                  <td className="px-4 py-3 text-right">{!m.card && (m.canText || m.canEmail) && <button type="button" disabled={!!busy} onClick={() => send([m.clientId], m.clientId)} className="h-9 rounded-full border px-3.5 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: LINE }}>{busy === m.clientId ? 'Sending…' : m.link?.sentAt ? 'Send again' : 'Send link'}</button>}</td>
                </tr>); })}</tbody></table>}
        </div>
        <p className="text-[12.5px]" style={{ color: MUTED }}>Once a link has gone out, it’s sent again 3 days and 1 day before their next charge. If there’s still no card, the charge waits — nothing fails, the membership carries on, and you’re told. It’s charged the day after they add their card.</p>
      </main>
    </div>);
}
