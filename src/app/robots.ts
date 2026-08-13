import type { MetadataRoute } from 'next';

// ─── /robots.txt ─────────────────────────────────────────────────────────────
// Without this file a crawler guesses, and guessing goes both ways: it may
// never look at the shop, or it may wander into a customer's order page.
//
// The rule here is not "block bots" — it is "only offer what a stranger is
// meant to see". Shop and booking pages are public by design. An order page,
// a digital library, an invoice, a pickup check-in, and anything under the
// staff app are addressed to ONE person and must never be indexed, even
// though each is already token-guarded. Defence in depth: the token stops
// access, this stops the link ever appearing.
//
// AI crawlers are deliberately NOT blocked. An assistant that can read the
// service menu and the booking link can answer "who does gel near me and can
// I book Saturday?" — which is a customer the shop would otherwise never
// meet. The same openness that earns a search result earns that answer.

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/shop/', '/book/'],
        disallow: [
          '/api/',
          '/print/',
          '/shop/*/order/',
          '/shop/*/library/',
          '/shop/*/invoice/',
          '/shop/*/account',
          '/shop/*/checkout',
          '/shop/*/pickup',
          '/complete/',
          '/maintain/',
          '/portal/',
          '/stay/',
          '/reservation/',
          '/appt/',
          '/kiosk/',
          '/card-setup/',
        ],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
