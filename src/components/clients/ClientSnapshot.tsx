'use client';
// src/components/clients/ClientSnapshot.tsx — "BEFORE YOU HELP THIS CLIENT": the few things anyone at the desk should
// know at a glance — who they are to the business right now (restricted, guest only, under 18, linked people), and
// what's live (here now, next visit, forms due, balance or credit, membership, open cases, follow-ups, accommodations).
// Money only for people allowed to see it.
import * as React from 'react';
import { format, differenceInYears, isSameDay } from 'date-fns';

const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
export function ClientSnapshot({ client, appointments, services, activeMembership, linkCount = 0, showMoney, onOpenVisit }: {
  client: any; appointments: any[]; services: any[]; activeMembership?: any; linkCount?: number; showMoney: boolean; onOpenVisit?: (a: any) => void;
}) {
  const now = new Date();
  const mine = appointments.filter((a) => a.clientId === client.id && !['cancelled', 'declined'].includes(String(a.status)));
  const here = mine.find((a) => isSameDay(safe(a.startTime), now) && (a.checkInStatus === 'arrived' || a.status === 'servicing'));
  const next = mine.filter((a) => safe(a.startTime) > now && a.status !== 'completed').sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime())[0];
  const formsDue = mine.filter((a) => safe(a.startTime) > new Date(now.getTime() - 86400000) && a.status !== 'completed').some((a) => { const svc = services.find((s) => s.id === a.serviceId); const need: string[] = [...(svc?.requiredFormIds || []), ...(a.requiredFormIds || [])]; const signed = new Set((a.signedForms || []).map((f: any) => f.formId)); return need.some((id) => !signed.has(id)); });
  const owed = Number(client.outstandingBalance) || 0; const credit = Number(client.storeCreditBalance ?? client.storeCredit) || 0;
  const openCases = (client.hasOpenDispute ? 1 : 0) + mine.filter((a) => a.issue?.status === 'open').length;
  const followUp = client.followUpDueAt && safe(client.followUpDueAt) < now;
  let age: number | null = null; try { if (client.dob || client.birthday || client.dateOfBirth) age = differenceInYears(now, safe(client.dob || client.birthday || client.dateOfBirth)); } catch { /* fine */ }
  const flags: [string, 'warn' | 'info'][] = [];
  if (client.status === 'banned' || client.status === 'restricted') flags.push([client.status === 'banned' ? 'Not to be booked' : 'Restricted', 'warn']);
  if (client.mergeSuggestedWith || client.duplicateUnderReview) flags.push(['Possible duplicate', 'warn']);
  if (client.guestOnly) flags.push(['Guest only (no contact details)', 'info']);
  if (age !== null && age < 18) flags.push([`Under 18 (${age})`, 'warn']);
  if (linkCount > 0) flags.push([`${linkCount} linked ${linkCount === 1 ? 'person' : 'people'}`, 'info']);
  const tile = (label: string, value: React.ReactNode, tone?: 'warn' | 'ok', onClick?: () => void) => (
    <button type="button" onClick={onClick} disabled={!onClick} className="min-w-0 rounded-2xl p-3 text-left disabled:cursor-default" style={{ background: tone === 'warn' ? 'color-mix(in srgb, var(--warn, #b45309) 10%, var(--card, #fff))' : tone === 'ok' ? 'color-mix(in srgb, var(--ok, #15803d) 10%, var(--card, #fff))' : 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }}>
      <span className="block text-[12px]" style={{ color: 'var(--muted, #6b635c)' }}>{label}</span><span className="block truncate text-[15px] font-semibold" style={tone === 'warn' ? { color: 'var(--warn, #b45309)' } : undefined}>{value}</span></button>);
  return (
    <section className="space-y-3" aria-label="Before you help this client">
      {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map(([l, t]) => <span key={l} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={t === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' } : { background: 'var(--soft, #efebe6)' }}>{l}</span>)}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {here ? tile('Right now', here.status === 'servicing' ? 'In the chair' : 'Here, waiting', 'ok', onOpenVisit ? () => onOpenVisit(here) : undefined)
          : tile('Next visit', next ? `${format(safe(next.startTime), 'EEE d MMM, h:mm a')}` : 'None booked', undefined, next && onOpenVisit ? () => onOpenVisit(next) : undefined)}
        {tile('Forms', formsDue ? 'Due before the visit' : 'Nothing due', formsDue ? 'warn' : undefined)}
        {showMoney ? tile(owed > 0 ? 'Owes' : 'Credit', owed > 0 ? money(owed) : credit > 0 ? money(credit) : 'Nothing owed', owed > 0 ? 'warn' : undefined) : tile('Account', owed > 0 ? 'Has a balance' : 'Up to date', owed > 0 ? 'warn' : undefined)}
        {tile('Membership', activeMembership?.name || activeMembership?.planName || (client.activeMembershipId ? 'Active' : 'None'))}
        {openCases > 0 && tile('Open cases', `${openCases}`, 'warn')}
        {followUp && tile('Follow-up', 'Overdue', 'warn')}
        {(client.accommodations || client.accessibilityNotes) && tile('Accommodations', String(client.accommodations || client.accessibilityNotes))}
      </div>
    </section>);
}
