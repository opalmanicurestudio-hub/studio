// ─── /print/document/[tenantId]/[documentId] ──────────────────────────────────
// A document (SOP, handbook, policy) as a real printable page. Replaces the
// in-page PrintableDocument overlay — that approach fought the app's own
// print CSS and portals; this route renders its OWN <html> exactly like the
// packing-slip and catalog routes, so nothing on screen can interfere.
//
// House typeface throughout (Plus Jakarta Sans, weights up to 800 — never
// 900, which synthesizes and blurs in print), ink palette, letterhead,
// typed-block rendering (numbered steps, real empty checkboxes, photo marks,
// boxed warnings, dotted tips), and a signature block at the bottom.
//
// Access model mirrors /print/wave and /print/slips: the documentId is the
// capability. iOS ignores scripted auto-print, so the screen-only toolbar
// carries an explicit Print / Save as PDF button; the toolbar disappears on
// paper.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-print-document';
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

const CATEGORY_LABEL: Record<string, string> = {
  sop: 'Standard operating procedure',
  handbook: 'Handbook',
  policy: 'Policy',
  other: 'Document',
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ tenantId: string; documentId: string }>;
}) {
  const { tenantId, documentId } = await params;
  const db = getAdminDb();

  const [tenantSnap, docSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection('tenants').doc(tenantId).collection('documents').doc(documentId).get(),
  ]);

  const businessName = String((tenantSnap.data() as any)?.name || 'ClarityFlow');
  const d = docSnap.exists ? (docSnap.data() as any) : null;

  if (!d) {
    return (
      <html>
        <head>
          <title>Document not found</title>
          <style>{`body { font-family: system-ui, sans-serif; color: #16171a; display: grid; place-items: center; min-height: 100vh; margin: 0; } p { font-weight: 700; }`}</style>
        </head>
        <body><p>This document link isn&apos;t valid anymore.</p></body>
      </html>
    );
  }

  const sections: any[] = Array.isArray(d.sections) ? d.sections : [];
  const version = Number(d.version || 1);
  const isDraft = d.status !== 'published';
  const meta = [
    CATEGORY_LABEL[d.category] || 'Document',
    isDraft ? 'Draft' : `Version ${version}`,
    fmtDate(new Date()),
  ].join(' · ');

  let stepN = 0;

  return (
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>{`${d.title || 'Document'} · ${businessName}`}</title>
        <style>{`
          @page { size: letter; margin: 0.6in; }
          * { box-sizing: border-box; }
          body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: #16171a; margin: 0; background: #f4f4f5; }
          .bar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f4f4f5; border-bottom: 1px solid #e2e8f0; }
          .bar button { font-family: inherit; font-size: 12px; font-weight: 700; padding: 10px 18px; border-radius: 12px; border: 1px solid #16171a; background: #16171a; color: #fff; cursor: pointer; }
          .bar p { font-size: 11px; font-weight: 700; color: #64748b; margin: 0; }
          .sheet { max-width: 7.5in; margin: 18px auto 60px; background: #fff; padding: 0.6in; border-radius: 18px; box-shadow: 0 1px 3px rgba(22,23,26,.12); }
          @media print {
            body { background: #fff; }
            .bar { display: none; }
            .sheet { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
          }
          .letterhead { border-bottom: 3px solid #16171a; padding-bottom: 16px; }
          .brand { font-size: 11px; font-weight: 800; letter-spacing: .28em; text-transform: uppercase; color: #64748b; margin: 0; }
          h1 { font-size: 30px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 4px; }
          .meta { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #64748b; margin: 0; }
          .content { margin-top: 26px; display: grid; gap: 20px; }
          .block { break-inside: avoid; }
          .h { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px; }
          .body { font-size: 13px; line-height: 1.7; font-weight: 500; white-space: pre-wrap; margin: 0; }
          .step { border-left: 4px solid #16171a; padding-left: 16px; }
          .step .kicker { font-size: 10px; font-weight: 800; letter-spacing: .28em; text-transform: uppercase; color: #64748b; margin: 0 0 2px; }
          .check { display: flex; align-items: flex-start; gap: 9px; margin: 7px 0; }
          .box { flex: none; width: 15px; height: 15px; border: 2px solid #16171a; border-radius: 4px; margin-top: 1px; }
          .check p { font-size: 13px; line-height: 1.6; font-weight: 500; margin: 0; }
          .cam { font-size: 11px; }
          .warning { border: 2px solid #16171a; border-radius: 12px; padding: 12px 14px; background: #fafafa; }
          .tip { border-left: 4px dotted #94a3b8; padding-left: 16px; }
          .tip .body { font-style: italic; }
          .sig { margin-top: 44px; border-top: 2px solid #cbd5e1; padding-top: 22px; break-inside: avoid; }
          .sigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
          .sigline { border-bottom: 2px solid #16171a; min-height: 2.1rem; }
          .siglabel { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #64748b; margin: 5px 0 0; }
          .foot { margin-top: 22px; font-size: 10px; font-weight: 600; color: #94a3b8; }
          @media (max-width: 640px) { .sheet { padding: 22px 18px; margin: 12px 10px 40px; } h1 { font-size: 24px; } .sigrow { gap: 22px; } }
        `}</style>
      </head>
      <body>
        <div className="bar">
          <p>{businessName} · {d.title || 'Document'}</p>
          <button id="printBtn" type="button">🖨 Print / Save as PDF</button>
        </div>
        <div className="sheet">
          <div className="letterhead">
            <p className="brand">{businessName}</p>
            <h1>{d.title || 'Untitled document'}</h1>
            <p className="meta">{meta}</p>
          </div>
          <div className="content">
            {sections.map((sec: any, si: number) => {
              const type = sec.type || 'text';
              if (type === 'step') {
                stepN++;
                return (
                  <div key={sec.id || si} className="block step">
                    <p className="kicker">Step {stepN}</p>
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {sec.body ? <p className="body">{sec.body}</p> : null}
                  </div>
                );
              }
              if (type === 'checklist') {
                const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
                return (
                  <div key={sec.id || si} className="block">
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {items.map((item: string, i: number) => (
                      <div key={i} className="check">
                        <span className="box" />
                        <p>{item}{Array.isArray(sec.photoLines) && sec.photoLines.includes(i) ? <span className="cam"> 📷</span> : null}</p>
                      </div>
                    ))}
                  </div>
                );
              }
              if (type === 'warning') {
                return (
                  <div key={sec.id || si} className="block warning">
                    <p className="h">⚠ {sec.heading || 'Warning'}</p>
                    {sec.body ? <p className="body">{sec.body}</p> : null}
                  </div>
                );
              }
              if (type === 'tip') {
                return (
                  <div key={sec.id || si} className="block tip">
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {sec.body ? <p className="body">{sec.body}</p> : null}
                  </div>
                );
              }
              return (
                <div key={sec.id || si} className="block">
                  {sec.heading ? <p className="h">{sec.heading}</p> : null}
                  {sec.body ? <p className="body">{sec.body}</p> : null}
                </div>
              );
            })}
          </div>
          <div className="sig">
            <p className="h">Read &amp; understood</p>
            <div className="sigrow">
              <div>
                <div className="sigline" />
                <p className="siglabel">Signature</p>
              </div>
              <div>
                <div className="sigline" />
                <p className="siglabel">Name &amp; date</p>
              </div>
            </div>
            <p className="foot">Printed from {businessName}&apos;s operating library{isDraft ? ' — draft copy, not yet published' : ` — version ${version}`}.</p>
          </div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });`,
          }}
        />
      </body>
    </html>
  );
}
