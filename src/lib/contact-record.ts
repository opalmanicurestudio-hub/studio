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

/** A plain, printable page. */
export function contactRecordHtml(o: { studio: string; clientName: string; visitWhen: string; service?: string; appointmentId: string; rows: RecordRow[]; printedBy?: string; tz?: string }) {
  const s = contactSummary(o.rows);
  const lines = o.rows.map((r) => `<tr class="${r.strength}"><td class="t">${esc(stamp(r.at, o.tz))}</td><td class="w">${esc(WHO[r.who])}</td><td><b>${esc(r.what)}</b>${r.detail ? `<div class="d">${esc(r.detail)}</div>` : ''}${r.body ? `<div class="b">${esc(r.body).replace(/\n/g, '<br>')}</div>` : ''}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact record · ${esc(o.clientName)}</title>
<style>body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#16171a;background:#fff;margin:0;padding:32px 24px;max-width:860px;margin:auto;letter-spacing:-.01em}h1{font-weight:300;font-size:26px;margin:0 0 4px}p{margin:0}.m{color:#6d7075;font-size:13px}.sum{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.sum div{border:1px solid #ececee;border-radius:12px;padding:10px 14px;min-width:120px}.sum b{display:block;font-size:20px;font-weight:400}table{width:100%;border-collapse:collapse;font-size:13px}td{border-top:1px solid #ececee;padding:10px 8px;vertical-align:top}.t{white-space:nowrap;color:#6d7075;width:210px}.w{white-space:nowrap;color:#6d7075;width:110px}.d{color:#6d7075;margin-top:2px}.b{margin-top:6px;padding:8px 10px;background:#f5f5f7;border-radius:8px;white-space:normal}tr.strong b{color:#1f7a4d}tr.problem b{color:#b45309}.note{margin-top:24px;font-size:12px;color:#6d7075;line-height:1.55}@media print{body{padding:0}button{display:none}}button{font:inherit;border:1px solid #16171a;background:#16171a;color:#fff;border-radius:999px;padding:8px 16px;cursor:pointer;margin-top:16px}@media(max-width:600px){.t,.w{width:auto;white-space:normal}}</style></head><body>
<p class="m">${esc(o.studio)}</p><h1>Contact record</h1><p class="m">${esc(o.clientName)} · ${esc(o.service || 'Visit')} · ${esc(o.visitWhen)}</p><p class="m">Visit reference ${esc(o.appointmentId)} · printed ${esc(stamp(new Date().toISOString(), o.tz))}${o.printedBy ? ` by ${esc(o.printedBy)}` : ''}</p>
<div class="sum"><div><b>${s.sent}</b>messages sent</div><div><b>${s.delivered}</b>delivered</div><div><b>${s.acted}</b>client actions</div>${s.problems ? `<div><b>${s.problems}</b>not delivered or held</div>` : ''}</div>
<table>${lines || '<tr><td>Nothing recorded for this visit yet.</td></tr>'}</table>
<p class="note">Times come from our system and from the text and email providers’ delivery reports. “Delivered” means the phone carrier or the receiving mail server accepted the message. “Email opened” means the email’s images loaded; some mail apps do this automatically and some block it, so it is shown as a hint only. Opening a link, signing, agreeing and paying are the client’s own actions on their private link.</p>
<button onclick="window.print()">Print or save as PDF</button></body></html>`;
}
