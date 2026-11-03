'use client';
// src/components/visit/VisitStages.tsx — the visit link's screens around the day itself (ClientVisit board): before the
// day ("See you Friday at 3:30"), checked in (a calm check, who'll be with them and when, the Wi-Fi), finished ("How
// was your visit?", book again, aftercare, their wallet), all set after finishing the booking, and the plain opening
// and not-found pages. The day itself is DayOfView. Everything sits in VisitShell: the booking page's own header, color
// and mood (Soft, Crisp or Night).
import * as React from 'react';
import { format, isSameDay, addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { Calendar, MessageSquare, Wifi, Phone, Heart } from 'lucide-react';
import type { ServicePlace } from '@/lib/service-place';
import type { VisitNotes } from '@/lib/studio-page';
import { PublicFrame } from '@/components/public/kit';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitRows, VisitCheck, VisitGettingHere, VisitChange, type VisitBrand } from '@/components/booking/VisitShell';
import { DisruptionCard } from '@/components/booking/DisruptionCard';
import { VisitTimeline } from '@/components/visit/VisitTimeline';
import { VisitRebook } from '@/components/visit/VisitRebook';
import { ReferralCard } from '@/components/visit/ReferralCard';
import { greeting } from '@/components/booking/VisitHero';
import { wallDate } from '@/lib/tenant-time';

export const safeDate = (val: any): Date => {
  try {
    const d = !val ? new Date() : val instanceof Date ? val : typeof val === 'string' ? parseISO(val) : typeof val === 'object' && 'seconds' in val ? new Date(val.seconds * 1000) : new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  } catch { return new Date(); }
};
const ico = (I: any) => <I className="h-[18px] w-[18px]" />;
const firstOf = (s: any) => String(s || '').trim().split(' ')[0] || '';

/** "today", "tomorrow", "Friday", or "Thu, Nov 19" — the day of a visit, said simply. */
export function dayWords(d: Date, now = new Date()): string {
  if (isSameDay(d, now)) return 'today';
  if (isSameDay(d, addDays(now, 1))) return 'tomorrow';
  const n = differenceInCalendarDays(d, now);
  return n > 1 && n < 7 ? format(d, 'EEEE') : format(d, 'EEE, MMM d');
}
/** "in 3 days", "in 2 weeks" — how far off, when it's more than a day away. */
const awayWords = (d: Date, now = new Date()) => { const n = differenceInCalendarDays(d, now); return n < 2 ? '' : n < 14 ? `in ${n} days` : n < 60 ? `in ${Math.round(n / 7)} weeks` : ''; };
/** The big line: "See you Friday at 3:30 PM". */
const SeeYou = ({ at, now }: { at: Date; now?: Date }) => <>See you <b>{dayWords(at, now)}</b> at <b>{format(at, 'h:mm')}</b><span className="text-[20px]"> {format(at, 'a')}</span></>;

// ── Opening, and a link that doesn't open anything ────────────────────────────
export function VisitLoading() {
  return (
    <PublicFrame accent="#16171a" mood="soft">
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center" role="status" aria-live="polite">
        <span className="pub-breathe" aria-hidden />
        <p className="text-[14.5px]" style={{ color: 'var(--muted)' }}>Opening your visit…</p>
      </div>
    </PublicFrame>
  );
}

export function VisitNotFound() {
  return (
    <VisitShell brand={{ accent: '#16171a' }} title={<>This link isn’t <b>working</b></>} subtitle="It may be from an older message, or part of it is missing.">
      <VisitCard>
        <p className="text-[15px]">Please open the latest message from the business and tap the link there. If it still doesn’t open, they can send you a new one.</p>
      </VisitCard>
    </VisitShell>
  );
}

// ── "Come in sooner?" ─────────────────────────────────────────────────────────
// The same waitlist (lib/waitlist-server): if an earlier time opens with the same provider, they get a text; tapping
// it moves this booking (same deposit). Nothing changes unless they say yes.
export function ComeInSooner({ tenantId, token, on: on0 }: { tenantId: string; token: string; on: boolean }) {
  const [on, setOn] = React.useState(on0); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const flip = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'sooner', token, on: !on }) }).then((x) => x.json());
      if (r.ok) setOn(!!r.on); else setErr(r.error || 'That didn’t work. Please try again.');
    } catch { setErr('No connection. Please try again.'); }
    setBusy(false);
  };
  return (
    <VisitCard>
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[16px] font-semibold">Come in sooner?</p><VisitMuted>{on ? 'We’ll text you if an earlier time opens. Your time stays unless you say yes.' : 'If an earlier time opens, we’ll text you first.'}</VisitMuted></div>
        <button type="button" role="switch" aria-checked={on} aria-label="Come in sooner" disabled={busy} onClick={flip} className="v-switch relative inline-flex h-11 w-14 shrink-0 items-center justify-center disabled:opacity-50">
          <span className="relative block h-7 w-12 rounded-full transition-colors" style={{ background: on ? 'var(--accent)' : 'color-mix(in srgb, var(--muted) 38%, transparent)' }}>
            <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full shadow-sm transition-all" style={{ left: on ? 23 : 3, background: '#fff' }} /></span>
        </button>
      </div>
      {err && <p className="pt-1 text-[13px]" role="alert" style={{ color: 'var(--warn)' }}>{err}</p>}
    </VisitCard>
  );
}

// ── Before the day ────────────────────────────────────────────────────────────
export function TooEarlyView({ brand, first, startTime, serviceName, providerName, place, visit, address, freeUntil, onReschedule, onCancel, onMessage, calendarUrl, disruption, hasDeposit, onDisruptionCancel, sooner, notice, notify, stillToDo }: {
  brand: VisitBrand; first?: string | null; startTime: string; serviceName?: string | null; providerName?: string | null;
  place?: ServicePlace | null; visit?: VisitNotes | null; address?: string | null; freeUntil?: string;
  onReschedule?: () => void; onCancel?: () => void; onMessage?: () => void; calendarUrl?: string | null;
  disruption?: any; hasDeposit?: boolean; onDisruptionCancel?: (d: 'refund' | 'credit' | 'keep' | null, extra?: any) => Promise<any>;
  sooner?: { tenantId: string; token: string; on: boolean } | null; notice?: React.ReactNode; notify?: React.ReactNode;
  /** Something is still to do before the visit (a form): "You're all set" isn't said yet. */
  stillToDo?: boolean;
}) {
  // Shown on the business's own clock (when it has set its zone).
  const at = wallDate(safeDate(startTime), brand.zone); const now = wallDate(new Date(), brand.zone);
  const isStudio = !place || place.kind === 'studio';
  const where = place?.kind === 'online' ? 'Online' : place?.kind === 'phone' ? 'By phone' : place?.kind === 'client' ? 'At your place' : '';
  return (
    <VisitShell brand={brand} chip="Booked" kicker={first ? `${greeting()}, ${first}` : greeting()} title={<SeeYou at={at} now={now} />}
      subtitle={[serviceName, providerName ? `with ${providerName}` : '', where, awayWords(at, now)].filter(Boolean).join(' · ')}>
      {notice}
      {onDisruptionCancel && <DisruptionCard disruption={disruption} hasDeposit={!!hasDeposit} onReschedule={onReschedule} onCancel={onDisruptionCancel} />}
      {disruption?.status !== 'pending' && <p className="v-note">{stillToDo ? '' : 'You’re all set. '}{place?.kind === 'online' ? 'Your link to join will be here on the day.' : place?.kind === 'phone' || place?.kind === 'client' ? 'Everything about your visit is here on the day.' : 'Check in from this link on the day.'}</p>}
      <VisitRows rows={[
        calendarUrl && { key: 'cal', icon: ico(Calendar), text: 'Add to my calendar', href: calendarUrl },
        onMessage && { key: 'msg', icon: ico(MessageSquare), text: 'Message us', onClick: onMessage },
      ]} />
      {isStudio && <VisitGettingHere address={address} notes={visit} />}
      {sooner && <ComeInSooner tenantId={sooner.tenantId} token={sooner.token} on={sooner.on} />}
      {notify}
      <VisitChange freeUntil={freeUntil} onReschedule={onReschedule} onCancel={onCancel} />
    </VisitShell>
  );
}

// ── All set (just finished the booking's forms, deposit or card, on another day) ─
export function AllSetView({ brand, startTime, businessName }: { brand: VisitBrand; startTime?: string | null; businessName?: string | null }) {
  const at = startTime ? wallDate(safeDate(startTime), brand.zone) : null;
  return (
    <VisitShell brand={brand} chip="Booked" kicker={<VisitCheck />} title={<>You’re <b>all set</b></>}
      subtitle={at ? `${businessName ? `${businessName} · ` : ''}${format(at, 'EEEE, MMMM d')} at ${format(at, 'h:mm a')}` : undefined}>
      <p className="v-note">Your appointment is confirmed. This link brings you back on the day, to check in and see everything about your visit.</p>
    </VisitShell>
  );
}

// ── Checked in (when the business doesn't offer the waiting lounge) ───────────
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return <button type="button" aria-label={label} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* the password is on screen */ } }}
    className="v-pill pub-press" style={{ minHeight: 44 }}>{done ? 'Copied' : 'Copy'}</button>;
}

export function CheckedInView({ brand, first, inService, who, startTime, serviceName, businessName, phone, wifi, timeline, onMessage }: {
  brand: VisitBrand; first?: string | null; inService: boolean; who?: string | null; startTime?: string | null; serviceName?: string | null; businessName?: string | null; phone?: string | null;
  wifi?: { network?: string | null; password?: string | null } | null;
  timeline?: { items?: { at: string; text: string }[] | null; showTimes?: boolean } | null;
  onMessage?: () => void;
}) {
  const real = startTime ? safeDate(startTime) : null; const at = real ? wallDate(real, brand.zone) : null;
  const m = real ? Math.round((real.getTime() - Date.now()) / 60000) : 0;
  const when = m > 90 ? `at ${format(at!, 'h:mm a')}` : m > 1 ? `in about ${m} minutes` : 'shortly';
  const name = firstOf(who);
  const tel = String(phone || '').replace(/[^\d+]/g, '');
  return (
    <VisitShell brand={brand} chip={inService ? 'In progress' : 'Checked in'} kicker={<span className="mb-2 inline-block"><VisitCheck /></span>}
      title={inService ? <>You’re <b>all set</b></> : <>You’re <b>checked in</b></>}
      subtitle={inService ? `Enjoy your appointment${first ? `, ${first}` : ''}.` : `${name ? `${name} knows` : 'We know'} you’re here and will be with you ${when}.`}>
      <VisitRows label="Today" rows={[
        { key: 'v', text: <><span className="block font-semibold">{serviceName || 'Your appointment'}</span>{(name || businessName) && <span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>{name ? `with ${name}` : businessName}</span>}</>, right: at ? format(at, 'h:mm a') : undefined },
      ]} />
      {wifi?.network && <VisitRows label="Wi-Fi" rows={[
        { key: 'w', icon: ico(Wifi), text: <><span className="block font-semibold">{wifi.network}</span>{wifi.password && <span className="block text-[13.5px] break-all" style={{ color: 'var(--muted)' }}>Password: <span style={{ color: 'var(--ink)' }}>{wifi.password}</span></span>}</>,
          right: wifi.password ? <CopyButton text={wifi.password} label="Copy the Wi-Fi password" /> : undefined, chevron: false },
      ]} />}
      {timeline && <VisitTimeline items={timeline.items} showTimes={timeline.showTimes !== false} zone={brand.zone} />}
      <VisitRows label="Need something?" rows={[
        onMessage && { key: 'm', icon: ico(MessageSquare), text: 'Message us', onClick: onMessage },
        tel && { key: 'c', icon: ico(Phone), text: businessName ? `Call ${businessName}` : `Call ${phone}`, href: `tel:${tel}` },
      ]} />
    </VisitShell>
  );
}

// ── Finished: "How was your visit?" ───────────────────────────────────────────
const Star = ({ on }: { on: boolean }) => <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden style={{ color: on ? 'var(--accent-text, var(--accent))' : 'color-mix(in srgb, var(--muted) 40%, transparent)' }}>
  <path fill="currentColor" d="M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9z" /></svg>;

export function CompletedView({ tenant, client, appointment, service, brand }: { brand: VisitBrand; tenant: any; client: any; appointment: any; service: any }) {
  const [rating, setRating] = React.useState(0);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [submitted, setSubmitted] = React.useState(!!appointment?.reviewSubmittedAt);
  const first = firstOf(client?.name || appointment?.clientName);
  const tok = appointment?.checkInToken ? String(appointment.checkInToken) : '';
  const send = async () => {
    // Saved on the server (the link is the proof of the visit).
    if (rating === 0 || sending) return;
    setSending(true); setErr('');
    try {
      const res = await fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review', token: tok || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : ''), rating, text, noticeShown: true }) });
      const d = await res.json().catch(() => ({}));
      if (!d?.ok) setErr(d?.error || 'Your review didn’t send. Please try again.'); else setSubmitted(true);
    } catch { setErr('Your review didn’t send. Please check your connection and try again.'); }
    setSending(false);
  };
  const mir = tenant?.makingItRight;
  const mirHref = mir && mir.channels?.visitLink !== false && tok && tenant?.id && appointment?.id ? `/how/${tenant.id}/${appointment.id}?t=${encodeURIComponent(tok)}&from=visit&start=report` : null;
  const unhappy = submitted && rating > 0 && rating <= 3;
  const care = (() => { if (appointment?.aftercareUrl || !mir) return ''; const sid = appointment?.serviceId; return String((sid && mir.aftercare?.byService?.[sid]) || mir.aftercare?.text || '').trim(); })();
  const at = appointment?.startTime ? wallDate(safeDate(appointment.startTime), brand.zone) : null;
  const staff = firstOf(appointment?.staffName);
  return (
    <VisitShell brand={brand} chip="Done" kicker={submitted ? 'Thank you' : first ? `Thanks for coming in, ${first}` : 'Thanks for coming in'}
      title={submitted ? (first ? <>Thanks, <b>{first}</b></> : <>Thank <b>you</b></>) : <>How was <b>your visit?</b></>}
      subtitle={[service?.name || appointment?.serviceName, at ? format(at, 'EEEE, MMMM d') : '', staff ? `with ${staff}` : ''].filter(Boolean).join(' · ')}>
      {!submitted ? (
        <VisitCard>
          <div className="flex justify-between" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)}
                className="pub-press inline-flex h-12 w-12 items-center justify-center rounded-full"><Star on={rating >= n} /></button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} aria-label="Your review (optional)" placeholder="Anything you’d like to tell us? (optional)" className="v-field py-3" />
          <VisitMuted>Your review may be shown publicly, with your first name and last initial.</VisitMuted>
          {err && <p className="text-[14px]" role="alert" style={{ color: 'var(--warn)' }}>{err}</p>}
          <VisitButton onClick={send} disabled={rating === 0 || sending}>{sending ? 'Sending…' : 'Send'}</VisitButton>
        </VisitCard>
      ) : <VisitCard tone="ok"><p className="text-[15px]" role="status">Thank you, we’ve received your review.</p></VisitCard>}
      {unhappy && mirHref && <VisitCard><p className="text-[15px] font-semibold">Sorry it wasn’t perfect.</p><VisitMuted>Tell us what happened and we’ll make it right.</VisitMuted><VisitButton href={mirHref}>Tell the team</VisitButton></VisitCard>}
      {tok ? <VisitRebook token={tok} bookHref={brand.bookHref || null} />
        : brand.bookHref && <VisitButton quiet={!submitted} href={brand.bookHref}>Book your next visit</VisitButton>}
      {appointment?.aftercareUrl
        ? <VisitRows label="Caring for it at home" rows={[{ key: 'a', icon: ico(Heart), text: <><span className="block font-semibold">Your aftercare</span><span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>What’s normal, what to watch for, and your provider’s note</span></>, href: appointment.aftercareUrl }]} />
        : care ? <section aria-label="Caring for it at home"><p className="px-1 pb-2 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Caring for it at home</p><div className="v-grp"><p className="whitespace-pre-line px-4 py-3.5 text-[14.5px] leading-relaxed">{care}</p></div></section> : null}
      {tenant?.visitTimelineForClients !== false && <VisitTimeline items={appointment?.timelinePublic} showTimes={appointment?.timelineShowTimes !== false} zone={brand.zone} />}
      {tok && !unhappy && <ReferralCard token={tok} />}
      {mirHref && !unhappy && <p className="px-1 text-center text-[14px]" style={{ color: 'var(--muted)' }}>Not quite right? <a href={mirHref} className="inline-flex min-h-11 items-center underline underline-offset-2">Tell us privately</a></p>}
    </VisitShell>
  );
}
