// src/lib/contact-record.ts — THE CONTACT RECORD FOR ONE VISIT. Everything we sent the client about this visit, what the
// carrier or mail provider reported back, and everything the client did with it, in time order: "sent", "delivered",
// "opened the link", "signed the form", "agreed to the policy". It answers "I never got it" with dates and times, and
// prints as a plain page the business can save as a PDF.
//
// What each line proves, honestly:
//  - Sent: our system handed the message to the provider, with the exact words and the address or number used.
//  - Delivered: the carrier (text) or the receiving mail server (email) accepted it.
//  - Email opened: the email's images loaded. Some mail apps load them automatically, and some block them, so an open
//    is a hint, not proof either way.
//  - Opened the link / signed / agreed / paid: the client's own action on their private link. This is the strong kind.

import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from './print-style';

export type Who = 'studio' | 'carrier' | 'client';
export type Strength = 'strong' | 'good' | 'hint' | 'problem';
export type RecordRow = { at: string; who: Who; what: string; detail?: string; strength: Strength; body?: string };

const iso = (v: any): string => {
  if (!v) return ''; if (typeof v === 'string') return isNaN(Date.parse(v)) ? '' : v;
  const ms = v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : typeof v === 'number' ? v : 0;
  return ms ? new Date(ms).toISOString() : '';
};
const KIND_WORDS: Record<string, string> = {
  visit_request: 'request for items before the visit', visit_aftercare: 'aftercare', visit_review: 'how was your visit',
  visit_rebook: 'book your next visit', visit_visit_link: 'visit link', reminder: 'reminder', appointment_reminder: 'reminder',
  booking_confirmation: 'booking confirmation', confirmation: 'confirmation', cancellation: 'cancellation',
};
export const kindWords = (k: any) => KIND_WORDS[String(k || '')] || String(k || 'message').replace(/_/g, ' ');
const LINK_WORDS: Record<string, string> = { visit: 'visit link', before: '“Before your visit” page', aftercare: 'aftercare page', feedback: '“How was your visit?” page' };

/** All rows for one visit, oldest first. */
export function contactRecord(apt: any, messages: any[] = []): RecordRow[] {
  const rows: RecordRow[] = [];
  const add = (at: any, who: Who, what: string, strength: Strength, detail?: string, body?: string) => { const t = iso(at); if (t) rows.push({ at: t, who, what, strength, ...(detail ? { detail } : {}), ...(body ? { body } : {}) }); };
  for (const m of messages) {
    const ch = m.channel === 'sms' ? 'Text' : 'Email'; const kind = kindWords(m.kind); const to = String(m.to || '');
    if (m.status === 'sent' || (!m.status && m.sentAt)) add(m.sentAt, 'studio', `${ch} sent: ${kind}`, 'good', [to, m.subject].filter(Boolean).join(' · '), m.body || m.preview || undefined);
    else if (m.status === 'failed') add(m.sentAt, 'studio', `${ch} not sent: ${kind}`, 'problem', m.error || undefined);
    else if (String(m.status || '').startsWith('skipped')) add(m.sentAt, 'studio', `${ch} held back: ${kind}`, 'problem', m.error || undefined);
    if (m.deliveredAt) add(m.deliveredAt, 'carrier', `${ch} delivered`, 'good', to || undefined);
    if (m.firstOpenedAt || m.openedAt) add(m.firstOpenedAt || m.openedAt, 'client', 'Email opened', 'hint', Number(m.openCount) > 1 ? `${m.openCount} times` : undefined);
    if (m.firstClickedAt || m.clickedAt) add(m.firstClickedAt || m.clickedAt, 'client', 'Tapped the link in the email', 'strong', m.clickedUrl ? String(m.clickedUrl).split('?')[0] : undefined);
    if (m.bouncedAt) add(m.bouncedAt, 'carrier', `${ch} not delivered`, 'problem', m.failureDetail || undefined);
  }
  const a = apt || {};
  if (a.clientConfirmedAt) add(a.clientConfirmedAt, 'client', 'Confirmed the visit', 'strong', a.clientConfirmedVia ? `by ${a.clientConfirmedVia === 'sms' ? 'text reply' : a.clientConfirmedVia}` : undefined);
  const views = a.linkViews || {};
  for (const k of Object.keys(views)) { const v = views[k] || {}; const n = Number(v.count) || 0;
    add(v.first, 'client', `Opened their ${LINK_WORDS[k] || 'link'}`, 'strong', n > 1 ? `${n} times, last ${new Date(iso(v.last) || v.first).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : undefined); }
  if (a.completionLinkFirstViewedAt && !views.visit) add(a.completionLinkFirstViewedAt, 'client', 'Opened their visit link', 'strong');
  for (const f of Array.isArray(a.signedForms) ? a.signedForms : []) add(f?.signedAt || a.completionConsentsAt, 'client', `Signed ${f?.formTitle ? `“${f.formTitle}”` : 'a form'}`, 'strong');
  if (a.policyAcceptance?.acceptedAt) add(a.policyAcceptance.acceptedAt, 'client', 'Agreed to the booking policy', 'strong', [a.policyAcceptance.policyVersion ? `version ${a.policyAcceptance.policyVersion}` : '', a.policyAcceptance.cardAuthorization ? 'card authorized' : ''].filter(Boolean).join(' · ') || undefined);
  if (a.acknowledgedAt) add(a.acknowledgedAt, 'client', 'Confirmed the instructions before the visit', 'strong', (a.acknowledgedItems || []).join(' · ') || undefined);
  if (a.prep?.answeredAt && a.prep?.by !== 'desk') add(a.prep.answeredAt, 'client', 'Answered the questions before the visit', 'strong');
  if (a.prep?.agreedAt) add(a.prep.agreedAt, 'client', 'Agreed to the visit as updated', 'strong', a.prep.agreedVia === 'phone' ? 'taken by phone' : undefined);
  if (a.cardUpdatedViaLinkAt) add(a.cardUpdatedViaLinkAt, 'client', 'Saved a card', 'strong');
  if (a.requirementsCompletedAt) add(a.requirementsCompletedAt, 'client', 'Finished everything asked for', 'strong');
  if (a.reviewSubmittedAt) add(a.reviewSubmittedAt, 'client', 'Left feedback', 'strong');
  return rows.sort((x, y) => x.at.localeCompare(y.at));
}

/** The short answer for the top of the record. */
export function contactSummary(rows: RecordRow[]) {
  const sent = rows.filter((r) => r.who === 'studio' && r.strength === 'good').length;
  const delivered = rows.filter((r) => r.who === 'carrier' && r.strength === 'good').length;
  const acted = rows.filter((r) => r.who === 'client' && r.strength === 'strong');
  const problems = rows.filter((r) => r.strength === 'problem').length;
  return { sent, delivered, acted: acted.length, firstAction: acted[0] || null, problems };
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = (t: string, tz?: string) => { try { return new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) }); } catch { return t; } };
const WHO: Record<Who, string> = { studio: 'Sent by us', carrier: 'Provider report', client: 'Client' };

/** A plain, printable page in the app's print look (lib/print-style). */
export function contactRecordHtml(o: { studio: string; clientName: string; visitWhen: string; service?: string; appointmentId: string; rows: RecordRow[]; printedBy?: string; tz?: string }) {
  const s = contactSummary(o.rows);
  const lines = o.rows.map((r) => `<tr class="${r.strength}"><td class="t">${esc(stamp(r.at, o.tz))}</td><td class="w">${esc(WHO[r.who])}</td><td><b>${esc(r.what)}</b>${r.detail ? `<div class="d">${esc(r.detail)}</div>` : ''}${r.body ? `<div class="b">${esc(r.body).replace(/\n/g, '<br>')}</div>` : ''}</td></tr>`).join('');
  const tile = (n: number, label: string) => `<div class="panel stat"><div class="v">${n}</div><div class="l">${label}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact record · ${esc(o.clientName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="${PRINT_FONT_HREF}" rel="stylesheet">
<style>@page{margin:0.55in}${PRINT_CSS}
.pp .sum{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px}.pp .sum .panel{min-width:130px}
.pp td{font-size:12.5px}.pp td.t{white-space:nowrap;color:${PRINT.muted};width:210px}.pp td.w{white-space:nowrap;color:${PRINT.muted};width:110px}
.pp tr.strong td b{color:${PRINT.green}}.pp tr.problem td b{color:${PRINT.amber}}
.pp .d{color:${PRINT.muted};margin-top:2px}.pp .b{margin-top:6px;padding:8px 10px;background:${PRINT.soft};border-radius:10px;color:${PRINT.body}}
.pp .print{font:inherit;font-size:13px;font-weight:600;border:1px solid ${PRINT.ink};background:${PRINT.ink};color:#fff;border-radius:999px;padding:9px 18px;cursor:pointer;margin-top:18px}
@media(max-width:600px){.pp td.t,.pp td.w{width:auto;white-space:normal}}</style></head>
<body class="pp-screen"><div class="pp page">
<div class="head"><div><p class="shop">${esc(o.studio)}</p><h1>Contact <b>record</b></h1><p class="sub">${esc(o.clientName)} · ${esc(o.service || 'Visit')} · ${esc(o.visitWhen)}</p></div>
<div class="meta"><div>Visit reference ${esc(o.appointmentId)}</div><div>Printed ${esc(stamp(new Date().toISOString(), o.tz))}${o.printedBy ? ` by ${esc(o.printedBy)}` : ''}</div></div></div>
<div class="sum">${tile(s.sent, 'Messages sent')}${tile(s.delivered, 'Delivered')}${tile(s.acted, 'Client actions')}${s.problems ? tile(s.problems, 'Not delivered or held') : ''}</div>
<table><tbody>${lines || '<tr><td class="faint">Nothing recorded for this visit yet.</td></tr>'}</tbody></table>
<p class="note" style="margin-top:22px">Times come from our system and from the text and email providers’ delivery reports. “Delivered” means the phone carrier or the receiving mail server accepted the message. “Email opened” means the email’s images loaded; some mail apps do this automatically and some block it, so it is shown as a hint only. Opening a link, signing, agreeing and paying are the client’s own actions on their private link.</p>
<button type="button" class="print no-print" onclick="window.print()">Print or save as PDF</button>
</div></body></html>`;
}
