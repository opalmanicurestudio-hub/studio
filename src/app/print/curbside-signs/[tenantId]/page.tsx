import QRCode from 'qrcode';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

// ─── /print/curbside-signs/[tenantId]?spots=1,2,3  (or ?count=6) ──────────────
// Numbered signs for the pickup bays. Each QR opens the shop's arrival page
// with THAT spot already filled in.
//
// Why this beats every clever alternative: the customer can only scan the sign
// they are parked at, so a wrong spot number stops being possible rather than
// merely unlikely — no typo, no "which one is 3 again?", no phone call. It
// needs no app, no permission prompt, no battery, and it works in a car park
// with one bar of signal, which is exactly where GPS gives up.
//
// The QR carries no order and no customer: it points at the shop's find-my-
// order page with ?spot=N, and the customer's own order link does the rest.
// A sign photographed and posted online reveals nothing but a bay number.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-curbside-print';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

export default async function CurbsideSignsPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ spots?: string; count?: string }>;
}) {
  const { tenantId } = await params;
  const { spots, count } = await searchParams;

  // Either an explicit list ("A,B,Loading bay") or a simple count (1..N).
  let list = String(spots || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (list.length === 0) {
    const n = Math.max(1, Math.min(40, Math.floor(Number(count) || 0)));
    list = Array.from({ length: n || 6 }, (_, i) => String(i + 1));
  }

  const db = getAdminDb();
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tSnap.exists ? (tSnap.data() as any) : {};
  const shopName = String(tenant.businessName || tenant.name || 'Curbside pickup');
  const origin =
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    '';

  const signs = await Promise.all(
    list.map(async (spot) => ({
      spot,
      qr: await QRCode.toDataURL(
        `${origin}/shop/${tenantId}/pickup?spot=${encodeURIComponent(spot)}`,
        { width: 600, margin: 0 },
      ),
    })),
  );

  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>Curbside spot signs</title>
        <style>{`
          @page { size: letter portrait; margin: 0.35in; }
          * { box-sizing: border-box; }
          body { font-family: ${PRINT_FONT_STACK}; font-weight: 400; color: #16171a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sign {
            width: 7.8in; height: 10.3in;
            border: 1px solid #ececee; border-radius: 28px;
            padding: 0.5in 0.45in;
            display: flex; flex-direction: column; align-items: center; text-align: center;
            page-break-after: always;
          }
          .sign:last-child { page-break-after: auto; }
          .shop { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
          .kicker { margin-top: 4px; font-size: 18px; color: #6d7075; }
          .num {
            margin: 0.22in 0 0.1in;
            font-size: 240px; line-height: 0.9; font-weight: 300;
            font-variant-numeric: tabular-nums; letter-spacing: -0.04em;
          }
          .num.small { font-size: 130px; letter-spacing: -0.03em; }
          .qrwrap { margin-top: 0.15in; padding: 18px; border: 1px solid #ececee; border-radius: 24px; }
          .qrwrap img { width: 3.1in; height: 3.1in; display: block; }
          .how { margin-top: 0.22in; font-size: 28px; font-weight: 300; letter-spacing: -0.015em; }
          .how b { font-weight: 600; }
          .sub { margin-top: 8px; font-size: 16px; color: #45474c; line-height: 1.5; max-width: 5.6in; }
          .foot { margin-top: auto; font-size: 13px; color: #9a9ca1; }
        `}</style>
      </head>
      <body>
        {signs.map((s) => (
          <div className="sign" key={s.spot}>
            <div className="shop">{shopName}</div>
            <div className="kicker">Curbside pickup</div>
            <div className={`num${s.spot.length > 2 ? ' small' : ''}`}>{s.spot}</div>
            <div className="qrwrap">
              <img src={s.qr} alt={`Check in from spot ${s.spot}`} />
            </div>
            <div className="how"><b>Scan</b> to tell us you&apos;re here</div>
            <div className="sub">
              Point your phone camera at the code. We&apos;ll know you&apos;re in spot {s.spot} and
              bring your order straight out — no need to type anything.
            </div>
            <div className="foot">Spot {s.spot}</div>
          </div>
        ))}
      </body>
    </html>
  );
}
