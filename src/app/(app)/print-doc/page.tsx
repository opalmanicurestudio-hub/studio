'use client';

/**
 * Printable document view
 * Route: src/app/(app)/print-doc/page.tsx  (open as /print-doc?id={documentId})
 *
 * Replaces the old in-page print overlay, which hijacked the screen and
 * auto-fired the print dialog before anyone could read anything. This is a
 * real page in its own tab: fully viewable, scrollable, and printed only
 * when the person presses the button (or Cmd/Ctrl+P).
 *
 * The look is the app's own print look (lib/print-style): Plus Jakarta Sans,
 * a light title, sentence-case grey labels, thin lines, soft rounded panels
 * for steps and warnings and real empty checkboxes, the same as the
 * /print/document route, so a printed SOP reads like everything else the
 * shop prints. Print CSS isolates the sheet from the app chrome and keeps
 * the soft fills.
 */

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Loader, FileText, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PRINT, PRINT_CSS, PRINT_FONT_STACK } from '@/lib/print-style';

const CATEGORY_LABEL: Record<string, string> = { sop: 'SOP', handbook: 'Handbook', policy: 'Policy', other: 'Document' };

const DOC_CSS = `
${PRINT_CSS}
@page { margin: 0.6in; }
.doc-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; font-family: ${PRINT_FONT_STACK}; }
.doc-bar p { margin: 0; font-size: 12.5px; color: ${PRINT.muted}; }
.doc-bar button { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: ${PRINT.ink}; color: #fff; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.doc-sheet { background: #fff; border: 1px solid ${PRINT.line}; border-radius: 20px; padding: 32px 36px; }
.pp .doc-blocks { display: grid; gap: 12px; }
.pp .doc-block { break-inside: avoid; }
.pp .doc-h { font-size: 13.5px; font-weight: 600; margin: 0 0 3px; }
.pp .doc-body { font-size: 12.5px; line-height: 1.65; color: ${PRINT.body}; white-space: pre-wrap; margin: 0; }
.pp .doc-step { background: ${PRINT.soft}; border-radius: 14px; padding: 12px 14px; }
.pp .doc-step .lbl { margin-bottom: 2px; }
.pp .doc-list { border: 1px solid ${PRINT.line}; border-radius: 14px; padding: 12px 14px; }
.pp .doc-check { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; }
.pp .doc-check p { margin: 0; font-size: 12.5px; line-height: 1.6; color: ${PRINT.body}; }
.pp .doc-check .pill { margin-left: 6px; }
.pp .doc-ck { flex: none; width: 14px; height: 14px; margin-top: 2px; border: 1px solid ${PRINT.faint}; border-radius: 4px; }
.pp .doc-warn { display: flex; gap: 10px; align-items: flex-start; background: ${PRINT.amberSoft}; border-radius: 14px; padding: 12px 14px; }
.pp .doc-warn svg { flex: none; margin-top: 2px; color: ${PRINT.amber}; }
.pp .doc-warn .doc-h { color: ${PRINT.amber}; }
.pp .doc-tip { border: 1px dashed #c9cacd; border-radius: 14px; padding: 12px 14px; }
.pp .doc-tip .doc-body { color: ${PRINT.muted}; }
.pp .doc-sig { margin-top: 28px; padding-top: 16px; border-top: 1px solid ${PRINT.line}; break-inside: avoid; }
.pp .doc-sigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 28px; }
.pp .doc-sigline { min-height: 2.2rem; border-bottom: 1px solid ${PRINT.ink}; }
.pp .doc-sig .lbl { margin-top: 5px; }
@media (max-width: 640px) { .doc-sheet { padding: 22px 18px; } .pp .doc-sigrow { gap: 20px; } }
@media print {
  body * { visibility: hidden !important; }
  .doc-print-area, .doc-print-area * { visibility: visible !important; }
  .doc-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 100% !important; padding: 0 !important; }
  .doc-print-hide { display: none !important; }
  .doc-print-area * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .doc-sheet { border: 0; border-radius: 0; padding: 0; }
}
`;

const WarnIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4M12 17v.5" /></svg>
);

const PrintDocInner = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const params = useSearchParams();
  const docId = params?.get('id') || '';

  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    const tid = selectedTenant?.id;
    if (!tid || !docId) { setLoading(false); return; }
    getDoc(doc(firestore, `tenants/${tid}/documents/${docId}`))
      .then(snap => { if (snap.exists()) setD({ id: snap.id, ...snap.data() }); })
      .catch(err => console.error('print-doc load failed', err))
      .finally(() => setLoading(false));
  }, [firestore, selectedTenant?.id, docId]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader className="h-7 w-7 animate-spin text-slate-900" aria-label="Loading document" />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="mx-auto mt-16 w-full max-w-md rounded-[20px] border bg-white p-8 text-center">
        <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-[15px] font-[600] text-slate-900">Document not found</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Open the print view from a document card on the Documents page.</p>
      </div>
    );
  }

  let stepN = 0;

  return (
    <div className="doc-print-area mx-auto w-full max-w-2xl p-4 pb-24 md:p-8">
      <style>{DOC_CSS}</style>

      <div className="doc-print-hide doc-bar">
        <p>This is the print view: what you see is what prints.</p>
        <button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Print or save as PDF
        </button>
      </div>

      <div className="pp doc-sheet">
        <div className="head">
          <div>
            <p className="shop">{selectedTenant?.name || 'ClarityFlow'}</p>
            <h1>{d.title || 'Untitled document'}</h1>
            <p className="sub">{CATEGORY_LABEL[d.category] || 'Document'} · version {Number(d.version || 1)}</p>
          </div>
          <div className="meta"><div>Printed {format(new Date(), 'MMM d, yyyy')}</div></div>
        </div>

        <div className="doc-blocks">
          {(d.sections || []).map((sec: any) => {
            const type = sec.type || 'text';
            if (type === 'step') {
              stepN++;
              return (
                <div key={sec.id} className="doc-block doc-step">
                  <p className="lbl">Step {stepN}</p>
                  {sec.heading && <p className="doc-h">{sec.heading}</p>}
                  {sec.body && <p className="doc-body">{sec.body}</p>}
                </div>
              );
            }
            if (type === 'checklist') {
              const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
              return (
                <div key={sec.id} className="doc-block doc-list">
                  {sec.heading && <p className="doc-h">{sec.heading}</p>}
                  {items.map((item: string, i: number) => (
                    <div key={i} className="doc-check">
                      <span className="doc-ck" aria-hidden="true" />
                      <p>
                        {item}
                        {Array.isArray(sec.photoLines) && sec.photoLines.includes(i) && <span className="pill">Photo</span>}
                      </p>
                    </div>
                  ))}
                </div>
              );
            }
            if (type === 'warning') {
              return (
                <div key={sec.id} className="doc-block doc-warn">
                  <WarnIcon />
                  <div>
                    {sec.heading && <p className="doc-h">{sec.heading}</p>}
                    {sec.body && <p className="doc-body">{sec.body}</p>}
                  </div>
                </div>
              );
            }
            if (type === 'tip') {
              return (
                <div key={sec.id} className="doc-block doc-tip">
                  {sec.heading && <p className="doc-h">{sec.heading}</p>}
                  {sec.body && <p className="doc-body">{sec.body}</p>}
                </div>
              );
            }
            return (
              <div key={sec.id} className="doc-block">
                {sec.heading && <p className="doc-h">{sec.heading}</p>}
                {sec.body && <p className="doc-body">{sec.body}</p>}
              </div>
            );
          })}
        </div>

        <div className="doc-sig">
          <p className="doc-h">Read &amp; understood</p>
          <div className="doc-sigrow">
            <div>
              <div className="doc-sigline" />
              <p className="lbl">Signature</p>
            </div>
            <div>
              <div className="doc-sigline" />
              <p className="lbl">Name and date</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function PrintDocPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader className="h-7 w-7 animate-spin text-slate-900" aria-label="Loading" />
      </div>
    }>
      <PrintDocInner />
    </Suspense>
  );
}
