// src/app/api/quote/route.ts — A CLIENT'S QUOTE, OPENED FROM THEIR LINK (app/quote/[tenantId]/[id]?k=). The link's
// key is the quote's own (its clientSecret); without it, nothing. The page could never read or answer a quote straight
// from the database (nobody outside the business may), so it all happens here:
//   'view'    → what they're quoted (a draft too, as the business previews it: nothing can be done with it) (lib/quote-public: never the team's pay or the business's costs). The first look
//               at a sent quote marks it viewed and tells the business, once; one past its date is marked expired.
//   'accept'  → accepted and locked, once; its day held on the calendar for the team on it (a block named after the
//               quote, so it's never made twice); the business is told, with the deposit to ask for.
//   'decline' → declined with their reason, for the business to follow up.
//   'revise'  → their request for changes, kept with the quote; the business is told.
// A paused or closed business takes no acceptance or changes (lib/tenant-open-server). Limited per visitor.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { closedReply } from '@/lib/tenant-open-server';
import { tenantTimeZone, dayKey, wallToUtc } from '@/lib/tenant-time';
import { publicQuote, quoteOpen, quoteDay, quoteTotals, DECLINE_REASONS } from '@/lib/quote-public';

const sameKey = (a: string, b: string) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && x.length >= 16 && timingSafeEqual(x, y);
};
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = String(body?.tenantId || ''), id = String(body?.id || ''), k = String(body?.k || ''), action = String(body?.action || 'view');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ ok: false, error: 'This link is incomplete.' }, { status: 400 });
    // Per visitor only: a business-wide count could be used up by someone trying links, locking real clients out.
    { const limited = await limitPublic(req, 'quote', tenantId, { perHour: 60, perDay: 1_000_000 }); if (limited) return limited; }
    const db = getAdminDb();
    const qRef = db.doc(`tenants/${tenantId}/quotes/${id}`);
    const [qSnap, tSnap] = await Promise.all([qRef.get(), db.doc(`tenants/${tenantId}`).get()]);
    const q: any = qSnap.exists ? qSnap.data() || {} : null;
    // The same answer for a quote that isn't there and a key that's wrong, so a link can't be guessed at.
    if (!q || !q.clientSecret || !sameKey(k, q.clientSecret)) return NextResponse.json({ ok: false, error: 'This link no longer opens a quote. Ask the business for a new one.' }, { status: 404 });
    const tenant: any = tSnap.data() || {};
    const tz = tenantTimeZone(tenant);
    const dayOf = (d: Date) => dayKey(d, tz);
    const now = new Date(); const nowIso = now.toISOString();
    const notify = async (type: string, message: string, priority?: string) => {
      try { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); await n.set({ id: n.id, type, message, link: '/quotes', read: false, createdAt: nowIso, ...(priority ? { priority } : {}) }); } catch { /* the bell is a bonus */ }
    };
    const name = String(q.eventName || 'your event');

    if (action === 'view') {
      // First look at a sent quote, or one past its date: recorded once, whoever asks first.
      // The business's own look (its Preview, ?p=1) isn't the client's first look.
      const preview = body?.preview === true;
      const changed: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(qRef)).data() || {};
        const pq = publicQuote(cur, tenant, dayOf, now.getTime());
        if (pq.status === 'expired' && cur.status !== 'expired') { tx.set(qRef, { status: 'expired', expiredAt: nowIso }, { merge: true }); return { expired: true }; }
        if (!preview && cur.status === 'sent' && !cur.viewedAt) { tx.set(qRef, { status: 'viewed', viewedAt: nowIso }, { merge: true }); return { viewed: true }; }
        return {};
      });
      if (changed.viewed) await notify('quote_viewed', `Your quote for “${name}” was opened by the client.`);
      const fresh: any = (await qRef.get()).data() || q;
      return NextResponse.json({ ok: true, quote: publicQuote(fresh, tenant, dayOf, now.getTime()) });
    }

    if (action === 'accept' || action === 'revise') { const closed = closedReply(tenant); if (closed) return closed; }

    if (action === 'accept') {
      const seen = Number(body?.total);
      const out: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(qRef)).data() || {};
        // Everything read before anything is written: the client, so a client that's gone isn't made again.
        const clientRef = cur.clientId ? db.doc(`tenants/${tenantId}/clients/${cur.clientId}`) : null;
        const clientThere = clientRef ? (await tx.get(clientRef)).exists : false;
        if (cur.status === 'accepted') return { already: true };
        if (!quoteOpen(cur, now.getTime())) return { error: cur.status === 'declined' ? 'This quote was declined. Ask the business for a new one.' : 'This quote can’t be accepted anymore. Ask the business for a new one.' };
        // Only the price they saw: a quote changed since it was opened is shown again first.
        if (!Number.isFinite(seen) || Math.round(seen * 100) !== Math.round(quoteTotals(cur).total * 100)) return { changed: true };
        tx.set(qRef, { status: 'accepted', acceptedAt: nowIso, locked: true, acceptedVia: 'client_link' }, { merge: true });
        // The day held on the calendar for the team on it (or everyone, when nobody's named): its hours when the quote
        // has a start time, else the whole day. Named after the quote, so accepting twice never holds it twice.
        const day = quoteDay(cur, dayOf);
        if (day) {
          const st = /^(\d{2}):(\d{2})$/.exec(String(cur.startTime || ''));
          const start = st ? wallToUtc(day, Number(st[1]), Number(st[2]), tz) : wallToUtc(day, 0, 0, tz);
          const hours = Number(cur.totalHours) > 0 ? Number(cur.totalHours) : 0;
          // A start time with no length holds the whole day, rather than guessing how long it runs.
          const timed = !!st && hours > 0;
          const end = timed ? new Date(start.getTime() + hours * 3600000) : wallToUtc(day, 23, 59, tz);
          const staffIds = (Array.isArray(cur.staffPayouts) ? cur.staffPayouts : []).map((s: any) => String(s?.staffId || '')).filter(Boolean);
          const bRef = db.doc(`tenants/${tenantId}/events/quote_${id}`);
          tx.set(bRef, { id: bRef.id, title: cur.eventName || 'Booked event', type: 'blocked', status: 'confirmed', clientId: cur.clientId || null, quoteId: id,
            startTime: (timed ? start : wallToUtc(day, 0, 0, tz)).toISOString(), endTime: end.toISOString(), allDay: !timed, staffIds: staffIds.length ? staffIds : ['all'],
            notes: `Held for the accepted quote “${cur.eventName || 'event'}”.`, createdAt: nowIso }, { merge: true });
        }
        if (clientRef && clientThere) tx.update(clientRef, { lastQuoteAccepted: nowIso, hasActiveBooking: true });
        return { ok: true, totals: quoteTotals(cur) };
      });
      if (out.changed) {
        const fresh: any = (await qRef.get()).data() || q;
        return NextResponse.json({ ok: false, changed: true, error: 'This quote was just updated. Look it over again before you accept.', quote: publicQuote(fresh, tenant, dayOf, now.getTime()) }, { status: 409 });
      }
      if (out.error) return NextResponse.json({ ok: false, error: out.error }, { status: 409 });
      if (!out.already) {
        const t = out.totals;
        await notify('quote_accepted', `Quote accepted: “${name}”, ${usd(t.total)}.${t.deposit > 0 ? ` Send them a payment link for the ${usd(t.deposit)} deposit.` : ''}`, 'high');
      }
      const fresh: any = (await qRef.get()).data() || q;
      return NextResponse.json({ ok: true, quote: publicQuote(fresh, tenant, dayOf, now.getTime()) });
    }

    if (action === 'decline') {
      const reason = DECLINE_REASONS.includes(body?.reason) ? String(body.reason) : 'Something else';
      const note = String(body?.note || '').trim().slice(0, 1000) || null;
      const out: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(qRef)).data() || {};
        if (cur.status === 'declined') return { already: true };
        if (!quoteOpen(cur, now.getTime())) return { error: 'This quote can’t be changed anymore.' };
        tx.set(qRef, { status: 'declined', declinedAt: nowIso, declineReason: reason, declineNote: note, needsFollowUp: true }, { merge: true });
        return { ok: true };
      });
      if (out.error) return NextResponse.json({ ok: false, error: out.error }, { status: 409 });
      if (!out.already) await notify('quote_declined', `Quote declined: “${name}”. Their reason: ${reason}.${note ? ` “${note.slice(0, 120)}”` : ''}`);
      return NextResponse.json({ ok: true });
    }

    if (action === 'revise') {
      const message = String(body?.message || '').trim().slice(0, 1000);
      if (message.length < 3) return NextResponse.json({ ok: false, error: 'Say what you’d like changed.' }, { status: 400 });
      const out: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(qRef)).data() || {};
        if (!quoteOpen(cur, now.getTime())) return { error: 'This quote can’t be changed anymore.' };
        const rRef = qRef.collection('revisions').doc();
        tx.set(rRef, { id: rRef.id, message, requestedAt: nowIso, status: 'pending' });
        tx.set(qRef, { status: 'revision_requested', revisionRequestedAt: nowIso, lastRevisionNote: message }, { merge: true });
        return { ok: true };
      });
      if (out.error) return NextResponse.json({ ok: false, error: out.error }, { status: 409 });
      await notify('quote_revision', `Changes asked for on “${name}”: ${message.slice(0, 120)}${message.length > 120 ? '…' : ''}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[quote] failed', err);
    return NextResponse.json({ ok: false, error: 'That didn’t go through. Please try again in a moment.' }, { status: 500 });
  }
}
