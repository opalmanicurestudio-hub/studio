// ─── /print/document/[tenantId]/[documentId] ──────────────────────────────────
// A document (SOP, handbook, policy) as a real printable page. Replaces the
// in-page PrintableDocument overlay — that approach fought the app's own
// print CSS and portals; this route renders its OWN <html> exactly like the
// packing-slip and catalog routes, so nothing on screen can interfere.
//
// The app's print look (lib/print-style): Plus Jakarta Sans at weights 300 to
// 600, a light title under the business name, sentence-case grey labels, thin
// lines, and typed-block rendering (steps on soft panels, real empty
// checkboxes, photo marks, amber warnings, dashed tips), with a signature
// block at the bottom. The in-app print view (/print-doc) draws the same way.
//
// Access model mirrors /print/wave and /print/slips: the documentId is the
// capability. iOS ignores scripted auto-print, so the screen-only toolbar
// carries an explicit Print or save as PDF button; the toolbar disappears on
// paper.

import { PRINT, PRINT_CSS, PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

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

const DOC_CSS = `
@page { size: letter; margin: 0.6in; }
* { box-sizing: border-box; }
body { margin: 0; background: ${PRINT.soft}; color: ${PRINT.ink}; font-family: ${PRINT_FONT_STACK}; }
@media print { body { background: #fff; } }
${PRINT_CSS}
.bar { position: sticky; top: 0; z-index: 1; display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 12px 16px; background: ${PRINT.soft}; border-bottom: 1px solid ${PRINT.line}; font-family: ${PRINT_FONT_STACK}; }
.bar p { margin: 0; font-size: 12.5px; color: ${PRINT.muted}; }
.bar button { flex-shrink: 0; font-family: inherit; font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 999px; border: 0; background: ${PRINT.ink}; color: #fff; cursor: pointer; }
.pp .blocks { display: grid; gap: 12px; }
.pp .block { break-inside: avoid; }
.pp .h { font-size: 13.5px; font-weight: 600; margin: 0 0 3px; }
.pp .body { font-size: 12.5px; line-height: 1.65; color: ${PRINT.body}; white-space: pre-wrap; margin: 0; }
.pp .body + .body { margin-top: 6px; }
.pp .step { background: ${PRINT.soft}; border-radius: 14px; padding: 12px 14px; }
.pp .step .lbl { margin-bottom: 2px; }
.pp .list { border: 1px solid ${PRINT.line}; border-radius: 14px; padding: 12px 14px; }
.pp .check { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; }
.pp .check p { margin: 0; font-size: 12.5px; line-height: 1.6; color: ${PRINT.body}; }
.pp .check .pill { margin-left: 6px; }
.pp .ck { flex: none; width: 14px; height: 14px; margin-top: 2px; border: 1px solid ${PRINT.faint}; border-radius: 4px; }
.pp .imgs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.pp .imgs img { width: 100%; height: 1.6in; object-fit: cover; border-radius: 10px; }
.pp .photo { display: block; width: 100%; max-height: 3.4in; object-fit: cover; border-radius: 12px; }
.pp .cap { font-size: 11.5px; color: ${PRINT.muted}; margin-top: 4px; }
.pp .warning { display: flex; gap: 10px; align-items: flex-start; background: ${PRINT.amberSoft}; border-radius: 14px; padding: 12px 14px; }
.pp .warning svg { flex: none; margin-top: 2px; color: ${PRINT.amber}; }
.pp .warning .h { color: ${PRINT.amber}; }
.pp .tip { border: 1px dashed #c9cacd; border-radius: 14px; padding: 12px 14px; }
.pp .tip .body { color: ${PRINT.muted}; }
.pp .sig { margin-top: 28px; padding-top: 16px; border-top: 1px solid ${PRINT.line}; break-inside: avoid; }
.pp .sigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 28px; }
.pp .sigline { min-height: 2.2rem; border-bottom: 1px solid ${PRINT.ink}; }
.pp .sig .lbl { margin-top: 5px; }
@media (max-width: 640px) { .pp.page { padding: 22px 18px; margin: 12px 10px 40px; } .pp h1 { font-size: 23px; } .pp .sigrow { gap: 20px; } }
`;

const WarnIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4M12 17v.5" /></svg>
);

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
  // Only published documents print from a link — a draft could be half-written or not meant for anyone yet.
  const raw = docSnap.exists ? (docSnap.data() as any) : null;
  const d = raw && raw.status === 'published' ? raw : null;

  if (!d) {
    return (
      <html lang="en">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link href={PRINT_FONT_HREF} rel="stylesheet" />
          <title>Document not found</title>
          <style>{`body { font-family: ${PRINT_FONT_STACK}; color: ${PRINT.ink}; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fff; } p { font-size: 15px; font-weight: 400; color: ${PRINT.body}; }`}</style>
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
  ].join(' · ');

  let stepN = 0;

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>{`${d.title || 'Document'} · ${businessName}`}</title>
        <style>{DOC_CSS}</style>
      </head>
      <body>
        <div className="bar no-print">
          <p>{businessName} · {d.title || 'Document'}</p>
          <button id="printBtn" type="button">Print or save as PDF</button>
        </div>
        <div className="pp page">
          <div className="head">
            <div>
              <p className="shop">{businessName}</p>
              <h1>{d.title || 'Untitled document'}</h1>
              <p className="sub">{meta}</p>
            </div>
            <div className="meta"><div>Printed {fmtDate(new Date())}</div></div>
          </div>
          <div className="blocks">
            {sections.map((sec: any, si: number) => {
              const type = sec.type || 'text';
              if (type === 'step') {
                stepN++;
                return (
                  <div key={sec.id || si} className="block step">
                    <p className="lbl">Step {stepN}</p>
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {sec.body ? <p className="body">{sec.body}</p> : null}
                    {Array.isArray(sec.images) && sec.images.length ? <div className="imgs">{sec.images.map((u: string) => <img key={u} src={u} alt="" />)}</div> : null}
                    {sec.timerMin ? <p className="body"><b>Timer: {sec.timerMin} minutes</b></p> : null}
                  </div>
                );
              }
              // Pictures print; a video prints as its link (the staff app plays it).
              if (type === 'photo') {
                return (
                  <div key={sec.id || si} className="block">
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {Array.isArray(sec.images) && sec.images[0] ? <img className="photo" src={sec.images[0]} alt="" /> : null}
                    {sec.body ? <p className="body cap">{sec.body}</p> : null}
                  </div>
                );
              }
              if (type === 'video') {
                return (
                  <div key={sec.id || si} className="block">
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    <p className="body">Video: {sec.url || ''}{sec.body ? ` — ${sec.body}` : ''}</p>
                  </div>
                );
              }
              if (type === 'checklist') {
                const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
                return (
                  <div key={sec.id || si} className="block list">
                    {sec.heading ? <p className="h">{sec.heading}</p> : null}
                    {items.map((item: string, i: number) => (
                      <div key={i} className="check">
                        <span className="ck" />
                        <p>{item}{(Array.isArray(sec.photoIds) && Array.isArray(sec.itemIds) ? sec.photoIds.includes(sec.itemIds[i]) : Array.isArray(sec.photoLines) && sec.photoLines.includes(i)) ? <span className="pill">Photo</span> : null}</p>
                      </div>
                    ))}
                  </div>
                );
              }
              if (type === 'warning') {
                return (
                  <div key={sec.id || si} className="block warning">
                    <WarnIcon />
                    <div>
                      <p className="h">{sec.heading || 'Warning'}</p>
                      {sec.body ? <p className="body">{sec.body}</p> : null}
                    </div>
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
                <p className="lbl">Signature</p>
              </div>
              <div>
                <div className="sigline" />
                <p className="lbl">Name and date</p>
              </div>
            </div>
          </div>
          <div className="foot"><span>Printed from {businessName}&apos;s operating library{isDraft ? ', a draft copy, not yet published' : `, version ${version}`}.</span></div>
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
