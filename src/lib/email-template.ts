// src/lib/email-template.ts
//
// ONE SHELL FOR EVERY EMAIL (ClientEmails board 15G). Every email a business sends looks like its booking page: a line
// of the business's color across the top, its logo (or first letter) and name, a small label in its color ("Booking
// confirmed"), the one thing that matters in big type, a calm details panel when there are details, one button, quiet
// links under it, and a footer with the business's name. The shop's emails (lib/email-shell) are drawn by the same
// frame. Email clients ignore stylesheets, so everything is inline styles on tables, the one layout language Outlook,
// Gmail and Apple Mail all agree on. Server side only.
//
// The business's look: callers that know it pass `brand`. Most callers only know the business's name, so the shell
// marks the few places its color and logo go (data-cf attributes and <!--cf-…--> slots) and the sender
// (lib/notify sendNotification) fills them in from the business's settings with applyEmailBrand: the same color,
// logo and (when the business shows it) address as its booking page. An email sent any other way keeps the plain ink
// look, which reads fine on its own.

import { brandColor } from '@/lib/studio-page';
import { resolveAddressPolicy } from '@/lib/message-policy';
import { brandOf } from '@/lib/shop-site';

/** The business's look in an email. place: the line after its name in the footer (its address when it shares it, else
 *  its area). alsoNamed: the business's other name (name and businessName can differ), so an email headed with either
 *  counts as its own. */
export type EmailLook = { name: string; accent: string; logoUrl?: string | null; place?: string | null; show?: 'mark+name' | 'mark' | 'name'; alsoNamed?: string[] };

export interface BrandedEmailInput {
  studioName: string;
  title: string;                 // the big heading, e.g. "See you" or "Your sign-in code"
  titleBold?: string;            // the bold end of the heading: "See you" + "Saturday"
  eyebrow?: string;              // the small label above it, in the business's color: "Booking confirmed"
  preheader?: string;            // the line inbox lists show after the subject
  bodyLines?: string[];          // paragraphs, rendered in order
  details?: { big?: string; lines?: string[] } | null;   // a soft panel: the date in big type, then what and where
  amounts?: { label: string; value: string; strong?: boolean; muted?: boolean }[] | null;   // label and amount rows
  bigCode?: string;              // a large centered code (sign-in codes)
  codeLabel?: string;            // the line above it (default "Your code")
  codeNote?: string;             // a muted line under it ("Show it when you arrive to check in.")
  bodyHtml?: string;             // trusted pre-built HTML (caller escapes its own data), rendered after bodyLines
  cta?: { label: string; url: string } | null;
  secondaryCta?: { label: string; url: string } | null; // a quieter link under the button, e.g. "Add to calendar"
  links?: { label: string; url: string }[] | null;      // more quiet links in the same row
  smallPrint?: string;           // a muted line under the button ("Free changes until Fri at 3:30 PM.")
  notes?: { title?: string; lines: string[] } | null;  // "Good to know": the business's policies, in small type at the end
  afterCtaHtml?: string;         // trusted pre-built HTML (caller escapes its own data), small print under the button
  footerNote?: string;           // small print under the card
  brand?: EmailLook | null;      // the business's look, when the caller has it (otherwise the sender adds it)
}

export const EMAIL_FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#16171a', BODY = '#2c2d31', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
/** The plain look, before the sender adds the business's own. */
const PLAIN = INK;

// Quotes too, so no text in an email can spell out one of the marks below (data-cf="…").
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escAttr = esc;
const safeUrl = (u: any) => { const s = String(u || '').trim(); return /^(https?:\/\/|mailto:|tel:|\/(?![/\\]))/i.test(s) ? s : '#'; };
const hex6 = (c: any) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : null);

/** White or ink, whichever reads on a background. */
export function readableOn(bgHex: string): string {
  const h = (hex6(bgHex) || INK).slice(1);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(parseInt(h.slice(0, 2), 16) / 255) + 0.7152 * lin(parseInt(h.slice(2, 4), 16) / 255) + 0.0722 * lin(parseInt(h.slice(4, 6), 16) / 255);
  return L > 0.35 ? INK : '#ffffff';
}
/** The color for words in the business's color on white: its own when it reads, ink when it's too pale. */
const wordsIn = (accent: string) => (readableOn(accent) === '#ffffff' ? accent : INK);

const firstLetter = (name: string) => (Array.from(String(name || '').trim())[0] || '·').toUpperCase();
function markHtml(look: EmailLook): string {
  const name = esc(look.name || '');
  const logo = look.show !== 'name' && look.logoUrl && /^https:\/\//i.test(look.logoUrl) ? look.logoUrl : null;
  const markOnly = !!logo && look.show === 'mark';
  const mark = logo
    ? `<img src="${escAttr(logo)}" alt="${markOnly ? escAttr(look.name || '') : ''}" height="36" style="display:block;height:36px;width:auto;max-width:180px;border:0">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="36" height="36" align="center" style="width:36px;height:36px;border-radius:11px;background:${look.accent};color:${readableOn(look.accent)};font-family:${EMAIL_FONT};font-size:16px;font-weight:700;line-height:36px">${esc(firstLetter(look.name))}</td></tr></table>`;
  if (markOnly) return mark;
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px">${mark}</td><td style="font-family:${EMAIL_FONT};font-size:15px;font-weight:600;color:${INK}">${name}</td></tr></table>`;
}

/** A full-width pill button in the business's color. tagged: the sender recolors it. */
export function emailPill(url: string, label: string, accent: string, tagged = false): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr>
      <td ${tagged ? 'data-cf="btn" ' : ''}align="center" style="background:${accent};border-radius:999px">
        <a ${tagged ? 'data-cf="btn-fg" ' : ''}href="${escAttr(safeUrl(url))}" target="_blank" style="color:${readableOn(accent)};display:block;padding:15px 24px;font-family:${EMAIL_FONT};font-size:16px;font-weight:600;text-decoration:none;border-radius:999px">${esc(label)}</a>
      </td></tr></table>`;
}

/** The frame every email shares: color line, logo and name, label, heading, content, footer. eyebrowHtml and titleHtml
 *  are trusted markup (the caller escapes its own data); footerLines are plain text. */
export function emailFrame(o: { look: EmailLook; tagged?: boolean; preheader?: string; eyebrowHtml?: string; titleHtml?: string; contentHtml: string; footerLines?: string[] }): string {
  const t = !!o.tagged; const accent = o.look.accent;
  const eyebrow = o.eyebrowHtml ? `<p ${t ? 'data-cf="eyebrow" ' : ''}style="color:${wordsIn(accent)};margin:0 0 8px;font-family:${EMAIL_FONT};font-size:13px;font-weight:600">${o.eyebrowHtml}</p>` : '';
  const heading = o.titleHtml ? `<h1 style="margin:0 0 4px;font-family:${EMAIL_FONT};font-size:27px;line-height:1.2;font-weight:300;letter-spacing:-0.02em;color:${INK}">${o.titleHtml}</h1>` : '';
  // The inbox line, then blank space so the list doesn't run on into the email's first words.
  const pre = o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${o.preheader}${'&nbsp;&zwnj;'.repeat(60)}</div>` : '';
  const place = o.look.place ? ` · ${esc(o.look.place)}` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');</style></head>
<body style="margin:0;padding:0;background:${SOFT};">${pre}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${EMAIL_FONT};">
        <tr><td style="background:#ffffff;border-radius:22px;border:1px solid ${LINE};overflow:hidden">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td ${t ? 'data-cf="bar" ' : ''}style="background:${accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
            <tr><td style="padding:22px 28px 0"><!--cf-mark-->${markHtml(o.look)}<!--/cf-mark--></td></tr>
            <tr><td style="padding:22px 28px 28px">${eyebrow}${heading}${o.contentHtml}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 12px 0;text-align:center">
          <p style="margin:0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${MUTED}"><!--cf-place-->${esc(o.look.name || '')}${place}<!--/cf-place--></p>
          ${(o.footerLines || []).filter(Boolean).map((l) => `<p style="margin:2px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${MUTED}">${esc(l)}</p>`).join('')}<!--cf-reply--><!--/cf-reply-->
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function brandedEmailHtml(i: BrandedEmailInput): string {
  const look: EmailLook = i.brand ? { ...i.brand, accent: hex6(i.brand.accent) || PLAIN, name: i.brand.name || i.studioName } : { name: i.studioName || '', accent: PLAIN };
  const tagged = !i.brand;   // the sender adds the business's look
  const accent = look.accent;
  const p = (l: string) => `<p style="margin:14px 0 0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:${BODY}">${esc(l)}</p>`;
  const paragraphs = (i.bodyLines || []).filter((l) => String(l || '').trim()).map(p).join('');
  const details = i.details && (i.details.big || (i.details.lines || []).length) ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="background:${SOFT};border-radius:16px;padding:16px 18px">
      ${i.details.big ? `<p style="margin:0;font-family:${EMAIL_FONT};font-size:21px;font-weight:600;color:${INK}">${esc(i.details.big)}</p>` : ''}
      ${(i.details.lines || []).filter(Boolean).map((l, n) => `<p style="margin:${n || i.details?.big ? 6 : 0}px 0 0;font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;color:${MUTED}">${esc(l)}</p>`).join('')}
    </td></tr></table>` : '';
  const amounts = (i.amounts || []).length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0">
      ${(i.amounts || []).map((a) => `<tr>
        <td style="padding:${a.strong ? '10px' : '5px'} 4px 0;${a.strong ? `border-top:1px solid ${LINE};` : ''}font-family:${EMAIL_FONT};font-size:14.5px;color:${a.muted ? MUTED : INK};font-weight:${a.strong ? 600 : 400}">${esc(a.label)}</td>
        <td align="right" style="padding:${a.strong ? '10px' : '5px'} 4px 0;${a.strong ? `border-top:1px solid ${LINE};` : ''}font-family:${EMAIL_FONT};font-size:14.5px;color:${a.muted ? MUTED : INK};font-weight:${a.strong ? 600 : 400};white-space:nowrap">${esc(a.value)}</td></tr>`).join('')}
    </table>` : '';
  const code = i.bigCode ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td align="center" style="background:${SOFT};border-radius:16px;padding:18px">
      <p style="margin:0 0 6px;font-family:${EMAIL_FONT};font-size:13px;font-weight:600;color:${MUTED}">${esc(i.codeLabel || 'Your code')}</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:.3em;color:${INK};font-family:ui-monospace,Menlo,Consolas,monospace">${esc(i.bigCode)}</p>
      ${i.codeNote ? `<p style="margin:8px 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${MUTED}">${esc(i.codeNote)}</p>` : ''}
    </td></tr></table>` : '';
  const cta = i.cta ? emailPill(i.cta.url, i.cta.label, accent, tagged) : '';
  const quiet = [...(i.secondaryCta ? [i.secondaryCta] : []), ...(i.links || [])].filter((l) => l && l.url && l.label);
  const links = quiet.length ? `<p style="margin:16px 0 0;text-align:center;font-family:${EMAIL_FONT};font-size:14px;font-weight:500">${quiet.map((l) =>
    `<a ${tagged ? 'data-cf="link" ' : ''}href="${escAttr(safeUrl(l.url))}" target="_blank" style="color:${wordsIn(accent)};text-decoration:none">${esc(l.label)}</a>`).join(`<span style="color:#c9cacd;padding:0 10px">·</span>`)}</p>` : '';
  const small = i.smallPrint ? `<p style="margin:16px 0 0;font-family:${EMAIL_FONT};font-size:12.5px;line-height:1.5;color:${MUTED};text-align:center">${esc(i.smallPrint)}</p>` : '';
  const titleHtml = `${esc(i.title || '')}${i.titleBold ? `${i.title ? ' ' : ''}<b style="font-weight:700">${esc(i.titleBold)}</b>` : ''}`;
  const noteLines = (i.notes?.lines || []).filter((l) => String(l || '').trim());
  const notes = noteLines.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0"><tr><td style="border-top:1px solid ${LINE};padding:18px 0 0">
      ${i.notes?.title ? `<p style="margin:0 0 6px;font-family:${EMAIL_FONT};font-size:13px;font-weight:600;color:${INK}">${esc(i.notes.title)}</p>` : ''}
      ${noteLines.map((l) => `<p style="margin:6px 0 0;font-family:${EMAIL_FONT};font-size:12.5px;line-height:1.55;color:${MUTED}">${esc(l)}</p>`).join('')}
    </td></tr></table>` : '';
  return emailFrame({ look, tagged, preheader: i.preheader ? esc(i.preheader) : '', eyebrowHtml: i.eyebrow ? esc(i.eyebrow) : '', titleHtml,
    contentHtml: `${paragraphs}${details}${amounts}${i.bodyHtml ? `<div style="margin:14px 0 0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:${BODY}">${i.bodyHtml}</div>` : ''}${code}${cta}${links}${small}${i.afterCtaHtml || ''}${notes}`,
    footerLines: [i.footerNote || `You’re receiving this because you have a booking or an account with ${i.studioName || 'us'}.`] });
}

/** The business's full address, one line. */
export function fullAddressOf(t: any): string {
  const a = t?.address;
  if (!a) return String(t?.studioAddress || '').trim();
  if (typeof a === 'string') return a.trim();
  const stateZip = [a.state, a.zip || a.postalCode].filter(Boolean).join(' ');
  return [a.street || a.line1, a.line2, a.city, stateZip].filter(Boolean).join(', ') || String(a.formatted || '').trim();
}

/** The business's look for its emails, from its settings: the booking page's color, its logo as it shows it (logo and
 *  name, logo only, or name only), and the line after its name in the footer: its full address only when the business
 *  has said to share it in every message, otherwise its area (the city, or the area it named), never the street. */
export function emailLookOf(t: any): EmailLook {
  const d = t || {};
  let logo: string | null = null; let show: EmailLook['show'] = 'mark+name';
  try { const b = brandOf(d); logo = b.logoUrl || null; show = b.show; } catch { /* the letter */ }
  if (logo && !/^https:\/\/[^\s"'<>]+$/i.test(logo)) logo = null;
  let place: string | null = null;
  try {
    const pol = resolveAddressPolicy(d);
    place = (d.addressPolicy?.mode === 'always' ? fullAddressOf(d) : pol.areaLabel) || null;
  } catch { /* cosmetic */ }
  const names = [d.name, d.businessName].map((x) => String(x || '').trim()).filter(Boolean);
  return { name: names[0] || '', accent: brandColor(d), logoUrl: logo, show, place, alsoNamed: names.slice(1) };
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const same = (a: string) => a.replace(/\s+/g, ' ').trim().toLowerCase();
/** The names the shell falls back to when a sender didn't have the business's name. */
const FALLBACK_NAMES = ['your studio', 'the studio', 'studio', 'our studio', 'your business', 'our team', 'us', 'our shop', 'your shop'];

/** Puts the business's look into an email the shell drew without it (see the top of this file): its color in the
 *  marked places, its logo by its name, the line after its name (o.place false leaves it off), and "reply to reach us"
 *  when replies reach the business. Only for an email in the business's own name: one in another name (a renter's, or
 *  the app's own notes to the owner) keeps its plain look. Nothing else in the email changes: the marks are matched
 *  only at the start of the shell's own tags, which no escaped text can spell out. */
export function applyEmailBrand(html: string, look: EmailLook, o: { replies?: boolean; place?: boolean } = {}): string {
  if (!html || !html.includes('<td data-cf="bar" ') || !look || !look.name) return html;
  const m = /<!--cf-place-->([\s\S]*?)<!--\/cf-place-->/.exec(html);
  const named = m ? same(unesc(m[1])) : '';
  const ours = [look.name, ...(look.alsoNamed || [])].map(same).filter(Boolean);
  if (named && !ours.includes(named) && !FALLBACK_NAMES.includes(named)) return html;
  const accent = hex6(look.accent) || PLAIN; const fg = readableOn(accent); const words = wordsIn(accent);
  const as: EmailLook = { ...look, accent, place: o.place === false ? null : look.place };
  let out = html
    .replace(/(<td data-cf="(?:bar|btn)" [^>]*?style="background:)#[0-9a-fA-F]{6}/g, `$1${accent}`)
    .replace(/(<a data-cf="btn-fg" [^>]*?style="color:)#[0-9a-fA-F]{6}/g, `$1${fg}`)
    .replace(/(<(?:p|a) data-cf="(?:eyebrow|link)" [^>]*?style="color:)#[0-9a-fA-F]{6}/g, `$1${words}`)
    .replace(/<!--cf-mark-->[\s\S]*?<!--\/cf-mark-->/, () => `<!--cf-mark-->${markHtml(as)}<!--/cf-mark-->`)
    .replace(/<!--cf-place-->[\s\S]*?<!--\/cf-place-->/, () => `<!--cf-place-->${esc(as.name)}${as.place ? ` · ${esc(as.place)}` : ''}<!--/cf-place-->`);
  if (o.replies) out = out.replace('<!--cf-reply--><!--/cf-reply-->', () => `<!--cf-reply--><p style="margin:2px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${MUTED}">Reply to this email to reach ${esc(as.name)}.</p><!--/cf-reply-->`);
  return out;
}
