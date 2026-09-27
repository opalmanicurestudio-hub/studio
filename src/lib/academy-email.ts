// src/lib/academy-email.ts
//
// ONE LOOK FOR EVERY ACADEMY EMAIL — the school's logo, name and colour, like
// its website. Callers keep writing plain text; this turns it into a designed
// email:
//   • a line that is only a link becomes a BUTTON with a clear label
//     ("Open my application", "Change or cancel my visit", …)
//   • "# Heading", "- bullet" and **bold** are formatted
//   • the footer carries the school's address, phone and licence number
//   • official letters (decisions, scholarship letters, student letters) add
//     the director's signature and the school seal
// A plain-text copy always goes with it for mail apps that prefer text.

import { getAdminDb } from '@/lib/firebase-admin';
import { getIdentity } from '@/lib/school-identity';
import { linkOrigin } from '@/lib/app-origin';

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const URL_ONLY = /^\s*(https?:\/\/\S+)\s*$/;

/** A clear label for a link, from where it goes. */
export function buttonLabel(url: string, subject = '') {
  const u = url.toLowerCase();
  if (/\/application\//.test(u)) return 'Open my application';
  if (/\/tour-manage\//.test(u)) return 'Change or cancel my visit';
  if (/\/interview\//.test(u)) return 'Choose an interview time';
  if (/sign-?in|login|token=/.test(u) || /sign-in/i.test(subject)) return 'Sign in';
  if (/\/verify\//.test(u)) return 'View certificate';
  if (/\/portfolio\//.test(u)) return 'View portfolio';
  if (/\/learn\/[^/]+\/my/.test(u)) return 'Open my student portal';
  if (/\/learn\/[^/]+\/[^/?]+\/[^/?]+/.test(u)) return 'Continue learning';
  if (/\/learn\/[^/]+\/[^/?]+/.test(u)) return 'Open the course';
  if (/\/academy/.test(u)) return 'Open in ClarityFlow';
  if (/\/school\//.test(u)) return 'Visit our website';
  if (/\/book\//.test(u)) return 'Book now';
  return 'Open';
}

function inline(s: string, accent: string) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" style="color:${accent};word-break:break-all">${m}</a>`);
}

/** Plain text → the designed body (paragraphs, headings, bullets, buttons). */
export function bodyHtml(text: string, accent: string, subject = '') {
  const out: string[] = []; let list: string[] = [];
  const flush = () => { if (list.length) { out.push(`<ul style="margin:0 0 14px;padding-left:20px;color:#44403c;font-size:15px;line-height:1.6">${list.map((l) => `<li style="margin:0 0 4px">${inline(l, accent)}</li>`).join('')}</ul>`); list = []; } };
  for (const block of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]; const t = raw.trim();
      const m = t.match(URL_ONLY);
      if (m) { flush(); out.push(`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 18px"><tr><td style="border-radius:999px;background:${accent}"><a href="${esc(m[1])}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(buttonLabel(m[1], subject))}</a></td></tr></table>`); continue; }
      if (/^#\s+/.test(t)) { flush(); out.push(`<h2 style="margin:18px 0 8px;font-size:17px;font-weight:600;color:#1c1917">${inline(t.replace(/^#\s+/, ''), accent)}</h2>`); continue; }
      if (/^[-•]\s+/.test(t)) { list.push(t.replace(/^[-•]\s+/, '')); continue; }
      flush();
      // Lines inside one block stay together (e.g. "Warm regards,\nOur school").
      const para = [t]; while (i + 1 < lines.length && !URL_ONLY.test(lines[i + 1]) && !/^#\s+|^[-•]\s+/.test(lines[i + 1].trim())) para.push(lines[++i].trim());
      out.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#44403c">${para.map((p) => inline(p, accent)).join('<br>')}</p>`);
    }
    flush();
  }
  return out.join('');
}

export interface AcademyEmailOpts { official?: boolean; preheader?: string }

/** Everything the email needs to look like the school. */
export async function schoolLook(tenantId: string) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const id = await getIdentity(tenantId, t).catch(() => null);
  const origin = linkOrigin(t);
  const abs = (u?: string | null) => (u ? (u.startsWith('/') ? `${origin}${u}` : u) : null);
  return {
    name: id?.displayName || t.name || 'Your academy', legal: id?.legalName || '', accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.bookingPageSettings?.primaryColor || '#7c3aed',
    logo: abs(id?.logoUrl), seal: abs(id?.sealUrl), signature: abs(id?.signatureUrl), signer: [id?.signerName, id?.signerTitle].filter(Boolean).join(', '),
    address: id?.address || '', phone: id?.phone || '', email: id?.email || '', licence: id?.licenseNumber ? `${id.licensingBoard ? `${id.licensingBoard} · ` : ''}School licence #${id.licenseNumber}` : '',
  };
}

export function academyEmailHtml(look: Awaited<ReturnType<typeof schoolLook>>, subject: string, text: string, opts: AcademyEmailOpts = {}) {
  const a = look.accent;
  const official = opts.official ? `<table role="presentation" width="100%" style="margin-top:22px"><tr><td valign="bottom">${look.signature ? `<img src="${esc(look.signature)}" alt="Signature" height="52" style="display:block;height:52px;max-width:220px">` : ''}<div style="border-top:1px solid #1c1917;padding-top:6px;font-size:12px;color:#57534e;max-width:260px">${esc(look.signer || 'Authorised school official')}<br>${esc(look.legal || look.name)}</div></td>${look.seal ? `<td align="right" valign="bottom"><img src="${esc(look.seal)}" alt="School seal" width="96" height="96" style="display:block;width:96px;height:96px"></td>` : ''}</tr></table>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f5f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="height:5px;background:${a}"></td></tr>
<tr><td style="padding:22px 26px 6px">${look.logo ? `<img src="${esc(look.logo)}" alt="${esc(look.name)}" height="40" style="display:block;height:40px;max-width:180px;margin-bottom:8px">` : ''}<div style="font-size:16px;font-weight:600;color:#1c1917">${esc(look.name)}</div></td></tr>
<tr><td style="padding:10px 26px 22px">${bodyHtml(text, a, subject)}${official}</td></tr>
<tr><td style="padding:16px 26px 22px;border-top:1px solid #eeecea;font-size:12px;line-height:1.6;color:#78716c">${[look.legal && look.legal !== look.name ? look.legal : look.name, look.address, [look.phone, look.email].filter(Boolean).join(' · '), look.licence].filter(Boolean).map(esc).join('<br>')}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Send a branded academy email. Returns whether the provider accepted it. */
export async function sendAcademyEmail(tenantId: string, to: string, subject: string, text: string, opts: AcademyEmailOpts = {}) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  const look = await schoolLook(tenantId).catch(() => null);
  const { resolveFromAddress } = await import('@/lib/notify');
  const base = resolveFromAddress(); const addr = (base.match(/<([^>]+)>/) || [, base])[1];
  const from = look ? `${look.name.replace(/[<>"]/g, '')} <${addr}>` : base;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#\s+/gm, ''), ...(look ? { html: academyEmailHtml(look, subject, text, opts) } : {}) }) });
    return r.ok;
  } catch { return false; }
}
