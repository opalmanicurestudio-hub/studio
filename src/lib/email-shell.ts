// ─── src/lib/email-shell.ts ──────────────────────────────────────────────────
// ONE branded shell for every customer email ClarityFlow sends on a tenant's
// behalf — receipt, cart recovery, claim decisions, return labels, and
// whatever comes next. The point is multi-tenancy done properly:
//
//   · The brand is THE TENANT'S, resolved per send from their own document —
//     shop name from businessName, header/button color from their storefront
//     theme. Never ClarityFlow's brand, never a cached other tenant's.
//   · Button/header text color is COMPUTED from the brand color's luminance,
//     so a shop with a pale-lemon brand doesn't send white-on-yellow email.
//   · Email clients are hostile terrain: table-free simple divs, inline
//     styles only, system font stack (webfonts don't load reliably in mail
//     clients — matching the app's tone beats half-loading its typeface),
//     560px column, colors that survive dark-mode inversion reasonably.
//
// Senders build only their BODY html and hand it here. One place to change
// the look; zero drift between senders.

export type EmailBrand = { shopName: string; brandColor: string };

/** Per-send tenant brand lookup. Fallbacks keep emails sending when a tenant
 *  has no theme: ink header, honest name. */
export async function getEmailBrand(db: any, tenantId: string): Promise<EmailBrand> {
  let shopName = 'Your shop';
  let brandColor = '#16171a';
  try {
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (snap.exists) {
      const t = snap.data() || {};
      shopName = String(t.businessName || t.name || shopName);
      const c = t?.retailSettings?.shopTheme?.brand;
      if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim())) brandColor = c.trim();
    }
  } catch {
    // brand lookup is never allowed to block an email
  }
  return { shopName, brandColor };
}

/** White or ink, whichever actually reads on the given background. */
export function readableTextOn(bgHex: string): string {
  try {
    const h = bgHex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.35 ? '#16171a' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

export function emailButton(href: string, label: string, brand: EmailBrand): string {
  const fg = readableTextOn(brand.brandColor);
  return `<p style="text-align:center;margin:26px 0">
    <a href="${href}" style="background:${brand.brandColor};color:${fg};padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:13px;display:inline-block">${label}</a>
  </p>`;
}

/**
 * The shell. bodyHtml is trusted internal markup from our own senders —
 * customer-entered text must be escaped by the CALLER before interpolation
 * (the claim-decision sender already does).
 */
export function brandedEmail(brand: EmailBrand, bodyHtml: string, opts?: { preheader?: string }): string {
  const headerFg = readableTextOn(brand.brandColor);
  const pre = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${opts.preheader}</div>`
    : '';
  return `${pre}<div style="background:#f4f4f5;padding:24px 12px">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:${brand.brandColor};color:${headerFg};border-radius:16px 16px 0 0;padding:18px 24px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
      <span style="font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase">${brand.shopName}</span>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:26px 24px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
      ${bodyHtml}
    </div>
    <p style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:11px;color:#94a3b8;text-align:center;margin:14px 0 0">
      Sent by ${brand.shopName}
    </p>
  </div>
</div>`;
}
