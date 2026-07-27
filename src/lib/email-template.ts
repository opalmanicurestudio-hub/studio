// src/lib/email-template.ts
//
// BRANDED EMAIL — one renderer so every email the platform sends looks
// like the app: slate-900 masthead, small-caps studio name, rounded card,
// bold CTA button. Email clients ignore stylesheets, so everything is
// inline styles on tables — the only layout language Outlook/Gmail/Apple
// Mail all agree on. Server-side only.

export interface BrandedEmailInput {
  studioName: string;
  title: string;                 // big heading, e.g. "Your sign-in code"
  bodyLines?: string[];          // paragraphs, rendered in order
  bigCode?: string;              // renders a large centered code block (OTPs)
  cta?: { label: string; url: string } | null;
  footerNote?: string;           // small print under the card
}

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function brandedEmailHtml(i: BrandedEmailInput): string {
  const brand = esc(i.studioName || 'Studio');
  const paragraphs = (i.bodyLines || []).map((l) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">${esc(l)}</p>`).join('');
  const code = i.bigCode ? `
    <div style="margin:18px 0;padding:18px;background:#f8fafc;border:2px solid #e2e8f0;border-radius:14px;text-align:center;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#94a3b8;">Your code</p>
      <p style="margin:0;font-size:34px;font-weight:800;letter-spacing:.35em;color:#0f172a;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(i.bigCode)}</p>
    </div>` : '';
  const cta = i.cta ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto 4px;">
      <tr><td style="border-radius:12px;background:#0f172a;">
        <a href="${esc(i.cta.url)}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:12px;">
          ${esc(i.cta.label)}</a>
      </td></tr>
    </table>
    <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;">
      Button not working? Copy this link: ${esc(i.cta.url)}</p>` : '';

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <!-- Masthead -->
        <tr><td style="background:#0f172a;border-radius:20px 20px 0 0;padding:22px 28px;">
          <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;color:#94a3b8;">${brand}</p>
          <p style="margin:6px 0 0;font-size:22px;font-weight:800;letter-spacing:-.02em;color:#ffffff;">${esc(i.title)}</p>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:26px 28px;border:1px solid #e2e8f0;border-top:none;">
          ${paragraphs}
          ${code}
          ${cta}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 10px 0;text-align:center;">
          <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
            ${esc(i.footerNote || `You're receiving this because you have an account or booking with ${i.studioName || 'the studio'}.`)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
