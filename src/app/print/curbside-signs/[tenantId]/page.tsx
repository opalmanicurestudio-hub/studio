import QRCode from 'qrcode';

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
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>Curbside spot signs</title>
        <style>{`
          @page { size: letter portrait; margin: 0.35in; }
          * { box-sizing: border-box; }
          body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: #0f172a; margin: 0; }
          .sign {
            width: 7.8in; height: 10.3in;
            border: 6px solid #0f172a; border-radius: 28px;
            padding: 0.5in 0.45in;
            display: flex; flex-direction: column; align-items: center; text-align: center;
            page-break-after: always;
          }
          .sign:last-child { page-break-after: auto; }
          .shop { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 3px; }
          .kicker { margin-top: 4px; font-size: 15px; font-weight: 700; color: #475569; }
          .num {
            margin: 0.22in 0 0.1in;
            font-size: 210px; line-height: 0.9; font-weight: 800;
            font-variant-numeric: tabular-nums; letter-spacing: -6px;
          }
          .num.small { font-size: 120px; letter-spacing: -3px; }
          .qrwrap { margin-top: 0.15in; padding: 14px; border: 4px solid #0f172a; border-radius: 20px; }
          .qrwrap img { width: 3.1in; height: 3.1in; display: block; }
          .how { margin-top: 0.22in; font-size: 22px; font-weight: 800; }
          .sub { margin-top: 8px; font-size: 15px; font-weight: 600; color: #475569; line-height: 1.45; max-width: 5.6in; }
          .foot { margin-top: auto; font-size: 12px; font-weight: 700; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; }
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
            <div className="how">Scan to tell us you&apos;re here</div>
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
