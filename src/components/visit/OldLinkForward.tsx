'use client';
// src/components/visit/OldLinkForward.tsx — AN OLDER LINK, SENT ON TO THE VISIT LINK (ClientManage: "the older manage and
// cancel pages are retired"). Confirmations and reminders have pointed at the visit's own link (/check-in/{token}) for a
// while; a message sent before that still carries /appt/… ("manage my appointment") or /cancel/… . Both now open the
// visit link, which changes, cancels, says "running late" and shows the way there, in the business's look. The key in
// the old link is checked by the server first (api/appt visit_link: a manage link's key, or a cancel link's, which is the
// visit link's own), so a cut-off or wrong link never lands on a blank "not found". Anything else gets a calm page in
// the business's look that says what to do next, and a connection problem is never mistaken for a dead link.
import * as React from 'react';
import { VisitShell, VisitButton, VisitCard, VisitMuted, brandFromLook, useLook } from '@/components/booking/VisitShell';
import type { PublicLook } from '@/lib/public-look';

const TOKEN = /^[A-Za-z0-9_-]{16,120}$/;
type Said = { title: string; kind: 'gone' | 'no_page' | 'offline' | 'off' };

export function OldLinkForward({ tenantId, apptId, k, kind }: { tenantId: string; apptId: string; k: string; kind: 'manage' | 'cancel' }) {
  const [given, setGiven] = React.useState<PublicLook | null>(null);
  const [said, setSaid] = React.useState<Said | null>(null);
  const [tries, setTries] = React.useState(0);
  const { look, ready } = useLook(tenantId, given);
  React.useEffect(() => {
    if (!tenantId || !apptId || !TOKEN.test(k)) { setSaid({ title: 'This link is incomplete', kind: 'gone' }); return; }
    let live = true; setSaid(null);
    fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'visit_link', tenantId, apptId, k }) })
      .then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) })).catch(() => ({ status: 0, d: null as any })).then(({ status, d }) => {
        if (!live) return;
        if (d?.look) setGiven(d.look);
        if (d?.ok && d.token) { window.location.replace(`/check-in/${encodeURIComponent(d.token)}${kind === 'cancel' ? '?do=cancel' : ''}`); return; }
        // No answer, or the server had a problem: their link may be fine, so they're asked to try again.
        if (!d || status === 0 || status >= 500) { setSaid({ title: 'We couldn’t open your visit just now', kind: 'offline' }); return; }
        setSaid(d.ok ? { title: 'This visit doesn’t have its own page', kind: 'no_page' }
          : d.code === 'revoked' ? { title: 'This link has been turned off', kind: 'off' }
          : { title: d.code === 'expired' ? 'This link has expired' : 'This link is no longer valid', kind: 'gone' });
      });
    return () => { live = false; };
  }, [tenantId, apptId, k, kind, tries]);
  const brand = brandFromLook(look, tenantId);
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!said) return <VisitShell brand={brand} title="Taking you to your visit…" />;
  if (said.kind === 'offline') return (
    <VisitShell brand={brand} title={said.title} subtitle="Please check your connection and try again. Your link is still good.">
      <VisitButton onClick={() => setTries((n) => n + 1)}>Try again</VisitButton>
    </VisitShell>
  );
  // Turned off ("Not you?"): a resend would send the same link, so the business sends a new one.
  if (said.kind === 'off') return (
    <VisitShell brand={brand} title={said.title} subtitle="Reply to your confirmation message, and we’ll send you a new link.">
      <VisitButton quiet href={brand.bookHref}>Book a visit</VisitButton>
    </VisitShell>
  );
  if (said.kind === 'no_page') return (
    <VisitShell brand={brand} title={said.title} subtitle="Reply to your confirmation or reminder message, and we’ll help you change or cancel it.">
      <VisitButton quiet href={brand.bookHref}>Book a visit</VisitButton>
    </VisitShell>
  );
  return (
    <VisitShell brand={brand} title={said.title} subtitle="Your visit’s own link has everything: change or cancel, running late, and getting here. It’s in your latest confirmation or reminder.">
      <VisitCard><VisitMuted>Booked with us? Enter the phone number or email you booked with, and we’ll send you a link to each upcoming visit. Booked with one of the independent providers here? Reply to the message they sent you.</VisitMuted></VisitCard>
      <VisitButton href={`/book/${encodeURIComponent(tenantId)}/find`}>Find my booking</VisitButton>
      <VisitButton quiet href={brand.bookHref}>Book a visit</VisitButton>
    </VisitShell>
  );
}
