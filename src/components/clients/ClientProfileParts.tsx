'use client';
// src/components/clients/ClientProfileParts.tsx — THE CLIENT PROFILE'S FRAME.
//   ClientHeader   — photo, name, contact line (only for people allowed to see contact details), the main actions
//                    (Message · Take payment · Book · Edit), a one-paragraph summary written from the records, and flags.
//   NextVisitCard  — the next visit first, with anything blocking it (forms) and the fix.
//   ClientRail     — value (spent, visits, how often, cancellations / no-shows as counts, visits a month), money
//                    (owed, credit — amounts only for people who see money), preferences.
// The summary is built only from records — usual service and provider, how often, next visit, forms, money — never
// guesses; with nothing to say it says nothing.
import * as React from 'react';
import { format, differenceInYears, differenceInDays, isSameDay, subMonths, startOfMonth, isAfter } from 'date-fns';

const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const live = (a: any) => !['cancelled', 'declined', 'no_show'].includes(String(a.status));
const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const card = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' } as React.CSSProperties;

export function clientFacts(client: any, appointments: any[], services: any[], staff: any[]) {
  const now = new Date();
  const mine = appointments.filter((a) => a.clientId === client.id);
  const done = mine.filter((a) => a.status === 'completed').sort((x, y) => safe(y.startTime).getTime() - safe(x.startTime).getTime());
  const next = mine.filter((a) => live(a) && a.status !== 'completed' && safe(a.startTime) > now).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime())[0] || null;
  const here = mine.find((a) => isSameDay(safe(a.startTime), now) && (a.checkInStatus === 'arrived' || a.status === 'servicing')) || null;
  const mode = (xs: string[]) => { const m = new Map<string, number>(); xs.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); let best = '', n = 0; m.forEach((v, k) => { if (v > n) { best = k; n = v; } }); return n >= 2 ? best : ''; };
  const recent = done.slice(0, 8);
  const usualService = services.find((s) => s.id === mode(recent.map((a) => a.serviceId)))?.name || null;
  const usualProvider = staff.find((s) => s.id === mode(recent.map((a) => a.staffId)))?.name?.split(' ')[0] || null;
  const gaps = done.slice(0, 7).map((a, i, arr) => (i < arr.length - 1 ? differenceInDays(safe(a.startTime), safe(arr[i + 1].startTime)) : null)).filter((g): g is number => g !== null && g > 0);
  const everyWeeks = gaps.length >= 2 ? Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length / 7) * 10) / 10 : null;
  const formsDue = !!next && (() => { const svc = services.find((s) => s.id === next.serviceId); const need: string[] = [...(svc?.requiredFormIds || []), ...(next.requiredFormIds || [])]; const signed = new Set((next.signedForms || []).map((f: any) => f.formId)); return need.some((id) => !signed.has(id)); })();
  const first = done[done.length - 1] || null; const last = done[0] || null;
  const months = Array.from({ length: 7 }, (_, i) => startOfMonth(subMonths(now, 6 - i)));
  const perMonth = months.map((m, i) => done.filter((a) => { const d = safe(a.startTime); return d >= m && (i === 6 || d < months[i + 1]); }).length);
  const overdue = !next && last && everyWeeks ? differenceInDays(now, safe(last.startTime)) > everyWeeks * 7 * 1.5 : false;
  return { mine, done, next, here, usualService, usualProvider, everyWeeks, formsDue, first, last, perMonth, months, overdue };
}

export function clientSummary(client: any, f: ReturnType<typeof clientFacts>, opts: { showMoney: boolean; balance: number; credit: number }): string {
  const name = String(client.name || 'This client').split(' ')[0]; const parts: string[] = [];
  if (f.usualService) parts.push(`Usually ${/^[aeiou]/i.test(f.usualService) ? 'an' : 'a'} ${f.usualService.toLowerCase()}${f.usualProvider ? ` with ${f.usualProvider}` : ''}${f.everyWeeks ? ` every ${f.everyWeeks % 1 === 0 ? f.everyWeeks : f.everyWeeks.toFixed(1)} weeks` : ''}.`);
  else if (f.done.length === 1 && f.first) parts.push(`First visit ${format(safe(f.first.startTime), 'd MMMM')}.`);
  else if (f.done.length > 1 && f.first) parts.push(`${f.done.length} visits since ${format(safe(f.first.startTime), 'MMMM yyyy')}.`);
  if (f.here) parts.push(`${name} is here now${f.here.status === 'servicing' ? ', in the chair' : ''}.`);
  else if (f.next) parts.push(`Next visit ${format(safe(f.next.startTime), isAfter(safe(f.next.startTime), new Date(Date.now() + 6 * 86400000)) ? 'EEEE d MMMM' : 'EEEE')} at ${format(safe(f.next.startTime), 'h:mm a')}.`);
  else if (f.last) parts.push(`No visit booked — last seen ${format(safe(f.last.startTime), 'd MMMM')}${f.overdue ? ', past their usual gap' : ''}.`);
  if (f.formsDue) parts.push('A form still needs signing before then.');
  if (opts.showMoney && opts.balance > 0) parts.push(`${money(opts.balance)} is still owed.`);
  else if (!opts.showMoney && opts.balance > 0) parts.push('There’s a balance on the account.');
  if (opts.showMoney && opts.credit > 0) parts.push(`${money(opts.credit)} credit to use.`);
  return parts.join(' ');
}

export function ClientHeader({ client, facts, showMoney, canSeeContact, balance, credit, linkCount, avatar, onBook, onMessage, onPay, onEdit, summaryOn = true }: {
  client: any; facts: ReturnType<typeof clientFacts>; showMoney: boolean; canSeeContact: boolean; balance: number; credit: number; linkCount: number; avatar: React.ReactNode;
  onBook: () => void; onMessage?: () => void; onPay?: () => void; onEdit?: () => void; summaryOn?: boolean;
}) {
  let age: number | null = null; try { const dob = client.dob || client.birthday || client.dateOfBirth; if (dob) age = differenceInYears(new Date(), safe(dob)); } catch { /* fine */ }
  const flags: [string, 'warn' | 'info'][] = [];
  if (client.status === 'banned' || client.status === 'restricted') flags.push([client.status === 'banned' ? 'Not to be booked' : 'Restricted', 'warn']);
  if (client.mergeSuggestedWith || client.duplicateUnderReview) flags.push(['Possible duplicate', 'warn']);
  if (age !== null && age < 18) flags.push([`Under 18 (${age})`, 'warn']);
  if (facts.formsDue) flags.push(['Form due', 'warn']);
  if (facts.overdue) flags.push(['Past their usual gap', 'warn']);
  if (client.guestOnly) flags.push(['Guest only', 'info']);
  if (linkCount > 0) flags.push([`${linkCount} linked ${linkCount === 1 ? 'person' : 'people'}`, 'info']);
  if (client.accommodations || client.accessibilityNotes) flags.push([String(client.accommodations || client.accessibilityNotes).slice(0, 40), 'info']);
  if (client.allergies) flags.push([`Allergy: ${String(client.allergies).slice(0, 30)}`, 'warn']);
  const contact = [canSeeContact && client.phone ? String(client.phone) : null, canSeeContact && client.email ? String(client.email) : null, client.preferredContact ? `${String(client.preferredContact)} preferred` : null, facts.first ? `client since ${format(safe(facts.first.startTime), 'MMMM yyyy')}` : null].filter(Boolean).join(' · ');
  const summary = summaryOn ? clientSummary(client, facts, { showMoney, balance, credit }) : '';
  const btn = 'h-10 rounded-full px-4 text-[14px] font-semibold';
  return (
    <header className="space-y-3 rounded-3xl p-5 sm:p-6" style={{ background: 'linear-gradient(color-mix(in srgb, var(--accent, #2e6f6a) 7%, var(--paper, #faf8f5)), var(--paper, #faf8f5))', border: '1px solid var(--line, #e7e2dc)' }}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="shrink-0">{avatar}</div>
        <div className="min-w-0 flex-1"><h1 className="truncate text-[30px] font-light leading-tight sm:text-[36px]">{client.name || 'Client'}</h1>{contact && <p className="mt-1 text-[14px]" style={muted}>{contact}</p>}</div>
        <div className="flex flex-wrap gap-2">
          {onMessage && <button type="button" onClick={onMessage} className={btn} style={{ background: 'var(--soft, #efebe6)' }}>Message</button>}
          {onPay && balance > 0 && <button type="button" onClick={onPay} className={btn} style={{ background: 'var(--soft, #efebe6)' }}>Take payment</button>}
          {client.status !== 'banned' && <button type="button" onClick={onBook} className={btn} style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Book {String(client.name || '').split(' ')[0] || 'them'}</button>}
          {onEdit && <button type="button" onClick={onEdit} className={btn} style={{ background: 'var(--soft, #efebe6)' }}>Edit</button>}
        </div>
      </div>
      {summary && <p className="max-w-[900px] text-[16px] leading-relaxed">{summary}</p>}
      {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map(([l, t]) => <span key={l} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={t === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' } : { background: 'var(--soft, #efebe6)' }}>{l}</span>)}</div>}
    </header>);
}

export function NextVisitCard({ facts, services, staff, onOpenVisit, onBook }: { facts: ReturnType<typeof clientFacts>; services: any[]; staff: any[]; onOpenVisit: (a: any) => void; onBook: () => void }) {
  const a = facts.here || facts.next;
  if (!a) return (<section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl p-5" style={card}><div><p className="text-[12px] font-semibold" style={muted}>NEXT VISIT</p><p className="mt-1 text-[16px]">Nothing booked{facts.last ? ` — last seen ${format(safe(facts.last.startTime), 'd MMMM')}` : ''}.</p></div><button type="button" onClick={onBook} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Book</button></section>);
  const svc = services.find((s) => s.id === a.serviceId); const who = staff.find((s) => s.id === a.staffId);
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl p-5" style={{ ...card, borderColor: 'var(--ink, #1c1917)' }} aria-label="Next visit">
      <div className="min-w-0"><p className="text-[12px] font-semibold" style={muted}>{facts.here ? 'HERE NOW' : 'NEXT VISIT'}</p>
        <p className="mt-1 text-[17px]"><b>{format(safe(a.startTime), 'EEE d MMM · h:mm a')}</b> · {svc?.name || a.serviceName || 'Service'}{who ? ` · ${who.name}` : ''}{svc?.duration ? ` · ${svc.duration} min` : ''}</p>
        {facts.formsDue && <p className="mt-1 text-[13px]" style={{ color: 'var(--warn, #b45309)' }}>A required form isn’t signed yet.</p>}</div>
      <button type="button" onClick={() => onOpenVisit(a)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>Open visit</button>
    </section>);
}

export function ClientRail({ client, facts, showMoney, ltv, balance, credit, cancels, noShows, reschedules, children }: {
  client: any; facts: ReturnType<typeof clientFacts>; showMoney: boolean; ltv: number; balance: number; credit: number; cancels: number; noShows: number; reschedules: number; children?: React.ReactNode;
}) {
  const max = Math.max(1, ...facts.perMonth);
  const row = (l: string, v: React.ReactNode, warn?: boolean) => <p className="flex justify-between gap-3 py-1 text-[14px]"><span style={muted}>{l}</span><b style={warn ? { color: 'var(--warn, #b45309)' } : undefined}>{v}</b></p>;
  const prefs = [client.preferredContact ? `${client.preferredContact}` : null, client.marketingOptIn === false || client.marketingConsent === false ? 'no marketing' : null, client.quietVisits ? 'quiet visits' : null, client.preferences && typeof client.preferences === 'string' ? client.preferences : null].filter(Boolean);
  return (
    <aside className="space-y-3" aria-label="About this client">
      <section className="rounded-3xl p-4" style={card}><p className="mb-1 text-[12px] font-semibold" style={muted}>THEIR VALUE</p>
        {showMoney && row('Spent so far', money(ltv))}{row('Visits', facts.done.length)}{facts.everyWeeks && row('Comes every', `${facts.everyWeeks} weeks`)}
        {facts.last && row('Last visit', format(safe(facts.last.startTime), 'd MMM yyyy'))}{row('Cancelled · no-show', `${cancels} · ${noShows}`, noShows > 1)}{reschedules > 0 && row('Moved', reschedules)}
        <div className="mt-2 flex h-9 items-end gap-1" aria-label={`Visits a month: ${facts.perMonth.join(', ')}`}>{facts.perMonth.map((n, i) => <i key={i} className="flex-1 rounded-[3px]" style={{ height: `${Math.max(6, (n / max) * 100)}%`, background: n ? 'color-mix(in srgb, var(--accent, #2e6f6a) 55%, transparent)' : 'var(--line, #e7e2dc)' }} title={`${format(facts.months[i], 'MMM')}: ${n}`} />)}</div>
        <p className="mt-1 text-[12px]" style={muted}>visits a month, {format(facts.months[0], 'MMM')}–{format(facts.months[6], 'MMM')}</p></section>
      <section className="rounded-3xl p-4" style={card}><p className="mb-1 text-[12px] font-semibold" style={muted}>MONEY</p>
        {showMoney ? <>{row('Owes', balance > 0 ? money(balance) : 'Nothing', balance > 0)}{row('Credit', credit > 0 ? money(credit) : 'None')}{client.cardBrand && client.cardLast4 && row('Card on file', `${client.cardBrand} ·· ${client.cardLast4}`)}</>
          : row('Account', balance > 0 ? 'Has a balance' : 'Up to date', balance > 0)}</section>
      {children}
      {prefs.length > 0 && <section className="rounded-3xl p-4" style={card}><p className="mb-1 text-[12px] font-semibold" style={muted}>PREFERENCES</p><p className="text-[14px]">{prefs.join(' · ')}</p></section>}
    </aside>);
}
