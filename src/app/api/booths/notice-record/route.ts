// src/app/api/booths/notice-record/route.ts — THE PRINTED NOTICE RECORD for one renter (lib/notice-record).
//
// Every email, text and conversation message the business sent them, word for word, with each copy's address, when it
// was sent, delivered, opened or seen in their portal, or why it didn't arrive, and a fingerprint of the exact words.
// One notice (id=…) or the whole record. Opens only from a short-lived signed link (lib/print-link): the business's
// managers, or the renter for their own copy (view=renter, which shows what their portal shows them).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { printLinkValid, printLinkExpired } from '@/lib/print-link';
import { printPage, esc } from '@/lib/print-style';
import { tenantTimeZone } from '@/lib/tenant-time';
import { loadRenterNotices } from '@/lib/notice-record-server';
import { forRenter, plainLinks, CATEGORY_LABEL, type NoticeItem, type NoticeCopy } from '@/lib/notice-record';
import { wordsFingerprint, shortFingerprint } from '@/lib/notice-fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE: Record<NoticeCopy['state'], string> = {
  opened: 'Opened', delivered: 'Delivered', sent: 'Sent', held: 'Held until quiet hours ended', bounced: 'Bounced', failed: 'Didn’t go', not_sent: 'Not sent',
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!printLinkValid('/api/booths/notice-record', sp)) return printLinkExpired();
  const tenantId = String(sp.get('tenantId') || '').trim();
  const renterId = String(sp.get('renterId') || '').trim();
  const only = String(sp.get('id') || '').trim();
  const renterView = sp.get('view') === 'renter';
  if (!tenantId || !renterId) return new NextResponse('Missing tenantId or renterId', { status: 400 });

  const db = getAdminDb();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const rSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
  if (!rSnap.exists) return new NextResponse('Renter not found', { status: 404 });
  const renter: any = rSnap.data() || {};
  const { items: all } = await loadRenterNotices(db, tenantId, renterId, renter);
  const pool = renterView ? forRenter(all) : all;
  const items = only ? pool.filter((i) => i.id === only) : pool;
  if (only && items.length === 0) return new NextResponse('That notice isn’t on this record.', { status: 404 });

  const tz = tenantTimeZone(tenant);
  const when = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const business = String(tenant.name || tenant.businessName || 'The business');
  const name = `${String(renter.firstName || '').trim()} ${String(renter.lastName || '').trim()}`.trim() || 'Renter';
  const fp = (c: { subject: string | null; body: string; fingerprint: string | null }) => c.fingerprint || wordsFingerprint(c.subject, c.body);

  const copyRow = (c: NoticeCopy) => {
    const times = [
      `Sent ${when(c.sentAt)}`,
      c.deliveredAt ? `delivered ${when(c.deliveredAt)}` : '',
      c.openedAt ? `opened ${when(c.openedAt)}` : '',
      c.bouncedAt ? `bounced ${when(c.bouncedAt)}` : '',
    ].filter(Boolean).join(' · ');
    const tone = ['bounced', 'failed', 'not_sent'].includes(c.state) ? 'warn' : c.state === 'held' ? '' : 'ok';
    return `<tr><td class="nowrap">${c.channel === 'sms' ? 'Text' : 'Email'}</td><td>${esc(c.to || '—')}</td><td><span class="pill ${tone}">${STATE[c.state]}</span><div class="note">${esc(times)}${c.why ? ` · ${esc(c.why)}` : ''}</div></td></tr>`;
  };
  const words = (label: string, subject: string | null, body: string, f: string) => `
    <div class="box keep" style="margin-top:8px">
      <p class="lbl">${esc(label)}</p>
      ${subject ? `<p style="margin-top:4px"><b>${esc(subject)}</b></p>` : ''}
      <p style="margin-top:6px;white-space:pre-wrap">${esc((renterView ? plainLinks(body) : body) || '(no words)')}</p>
      <p class="note" style="margin-top:8px">Fingerprint ${esc(shortFingerprint(f))}${renterView && plainLinks(body) !== body ? ', of the copy on file, where your portal link’s sign-in is hidden' : ''}</p>
    </div>`;

  const block = (i: NoticeItem, n: number) => {
    const head = `${i.formal ? 'Written notice' : CATEGORY_LABEL[i.category]}${i.direction === 'in' ? ` · from ${esc(i.sentBy || name)}` : i.sentBy ? ` · ${i.sentBy === 'automatic' ? 'sent automatically' : `sent by ${esc(i.sentBy)}`}` : ''}`;
    const emailCopy = i.copies.find((c) => c.channel === 'email');
    const textCopy = i.copies.find((c) => c.channel === 'sms');
    const sameWords = !!emailCopy && !!textCopy && emailCopy.body.trim() === textCopy.body.trim();
    const wordBlocks = i.threadId
      ? words(i.direction === 'in' ? 'What they wrote' : 'What was written', null, i.body, wordsFingerprint(null, i.body))
        + i.copies.filter((c) => c.body && c.body.trim() !== i.body.trim()).map((c) => words(c.channel === 'sms' ? 'The text said' : 'The email said', c.subject, c.body, fp(c))).join('')
      : (emailCopy ? words(sameWords ? 'Exactly what was sent' : 'The email said', emailCopy.subject, emailCopy.body, fp(emailCopy)) : '')
        + (textCopy && !sameWords ? words('The text said', null, textCopy.body, fp(textCopy)) : '');
    return `<section class="keep" style="margin-top:${n > 0 ? 26 : 0}px">
      <div class="line" style="border-bottom:none;padding:0"><h2 style="margin:0">${esc((renterView ? plainLinks(i.title) : i.title) || 'Message')}</h2><span class="muted">${esc(when(i.at))}</span></div>
      <p class="muted" style="margin-top:2px">${head}</p>
      ${i.copies.length ? `<table style="margin-top:10px"><thead><tr><th>How</th><th>To</th><th>What happened</th></tr></thead><tbody>${i.copies.map(copyRow).join('')}</tbody></table>`
        : `<p class="note" style="margin-top:8px">${i.threadId && i.direction === 'in' ? 'Written in their portal.' : 'Kept in their portal. There was no email or phone to send it to.'}</p>`}
      ${!i.threadId ? `<p class="note" style="margin-top:6px">${i.portalSeenAt ? `Seen in their portal ${esc(when(i.portalSeenAt))}.` : i.formal ? 'Shown in their portal; not opened there yet.' : ''}</p>` : ''}
      ${wordBlocks}
    </section>`;
  };

  const body = items.length
    ? items.map(block).join('')
    : '<p class="muted">Nothing has been sent to this renter yet.</p>';
  const html = printPage({
    title: only ? `Notice record — ${name}` : `Messages and notices — ${name}`,
    heading: only ? `Notice <b>record</b>` : `Messages and <b>notices</b>`,
    subtitle: `${esc(name)}${renter.email ? ` · ${esc(renter.email)}` : ''}${renter.phone ? ` · ${esc(renter.phone)}` : ''}`,
    shopName: business,
    meta: [only ? '1 item' : `${items.length} item${items.length === 1 ? '' : 's'}`, `Times in ${esc(tz)}`],
    body,
    footNote: 'Each copy is kept exactly as it was sent and can’t be edited. A fingerprint is worked out from the exact words: the same words always give the same fingerprint.',
    autoPrint: false,
    css: '.pp .actions { margin-top: 18px; } .pp .btn { height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid #ececee; background: #fff; font: inherit; font-size: 14px; cursor: pointer; }',
  }).replace(/(<div class="foot">)/, '<div class="no-print actions"><button class="btn" onclick="window.print()">Print or save as PDF</button></div>$1');
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
