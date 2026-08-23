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
 * The aesthetic is deliberately the APP'S OWN — Plus Jakarta Sans, black
 * uppercase tracked micro-labels, rounded-2xl bordered blocks, the same
 * step/checklist/warning/tip treatments the team sees on screen — so a
 * printed SOP is recognizably the same artifact as the digital one.
 * Print CSS isolates the sheet from the app chrome and preserves colors.
 */

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Loader, FileText, AlertTriangle, Lightbulb, Square, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const CATEGORY_LABEL: Record<string, string> = { sop: 'SOP', handbook: 'Handbook', policy: 'Policy', other: 'Document' };

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
      <div className="mx-auto mt-16 w-full max-w-md rounded-[2rem] border-2 bg-white p-8 text-center">
        <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-sm font-black uppercase tracking-widest text-slate-900">Document not found</p>
        <p className="mt-1 text-[12px] font-bold text-muted-foreground">Open the print view from a document card on the Documents page.</p>
      </div>
    );
  }

  let stepN = 0;

  return (
    <div className="doc-print-area mx-auto w-full max-w-2xl space-y-4 p-4 pb-24 md:p-8">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .doc-print-area, .doc-print-area * { visibility: visible !important; }
          .doc-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 100% !important; padding: 0 !important; }
          .doc-print-hide { display: none !important; }
          .doc-print-area * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .break-guard { break-inside: avoid; }
        }
        @page { margin: 0.6in; }
      `}</style>

      <div className="doc-print-hide flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold text-muted-foreground">This is the print view — what you see is what prints.</p>
        <button type="button" onClick={() => window.print()} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-[11px] font-black uppercase tracking-widest text-white">
          <Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>

      <div className="break-guard rounded-[2rem] border-2 bg-slate-900 p-6 text-white">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{selectedTenant?.name || 'ClarityFlow'}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">{d.title || 'Untitled document'}</h1>
        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
          {CATEGORY_LABEL[d.category] || 'Document'} · v{Number(d.version || 1)} · {format(new Date(), 'MMM d, yyyy')}
        </p>
      </div>

      <div className="space-y-3">
        {(d.sections || []).map((sec: any) => {
          const type = sec.type || 'text';
          if (type === 'step') {
            stepN++;
            return (
              <div key={sec.id} className="break-guard rounded-2xl border-2 border-l-8 border-l-slate-900 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Step {stepN}</p>
                {sec.heading && <p className="mt-0.5 text-[14px] font-black tracking-tight text-slate-900">{sec.heading}</p>}
                {sec.body && <p className="mt-1 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{sec.body}</p>}
              </div>
            );
          }
          if (type === 'checklist') {
            const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
            return (
              <div key={sec.id} className="break-guard rounded-2xl border-2 bg-white p-4">
                {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-900">{sec.heading}</p>}
                <div className="mt-2 space-y-2">
                  {items.map((item: string, i: number) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <p className="text-[13px] font-bold leading-relaxed text-slate-700">
                        {item}
                        {Array.isArray(sec.photoLines) && sec.photoLines.includes(i) && (
                          <span className="ml-2 rounded-md border-2 border-slate-300 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">📷 photo</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (type === 'warning') {
            return (
              <div key={sec.id} className="break-guard rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <div>
                    {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-amber-900">{sec.heading}</p>}
                    {sec.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-amber-900">{sec.body}</p>}
                  </div>
                </div>
              </div>
            );
          }
          if (type === 'tip') {
            return (
              <div key={sec.id} className="break-guard rounded-2xl border-2 border-dashed bg-slate-50 p-4">
                <div className="flex items-start gap-2.5">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <div>
                    {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">{sec.heading}</p>}
                    {sec.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-600">{sec.body}</p>}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={sec.id} className="break-guard rounded-2xl border-2 bg-white p-4">
              {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-900">{sec.heading}</p>}
              {sec.body && <p className="mt-1 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{sec.body}</p>}
            </div>
          );
        })}
      </div>

      <div className="break-guard rounded-2xl border-2 border-dashed bg-white p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Read &amp; understood</p>
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div>
            <div className="border-b-2 border-slate-900" style={{ minHeight: '2.2rem' }} />
            <p className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Signature</p>
          </div>
          <div>
            <div className="border-b-2 border-slate-900" style={{ minHeight: '2.2rem' }} />
            <p className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Name &amp; date</p>
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
