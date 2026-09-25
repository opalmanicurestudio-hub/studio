// src/app/verify/[code]/page.tsx
//
// CERTIFICATE + VERIFICATION — public. Anyone given the code (an employer, a
// state inspector) can confirm it's genuine; the student prints it here.
// Reads platformCertificates/{code} on the server.

import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import { PrintButton } from '@/components/academy/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Certificate verification', robots: { index: false } };

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const code = String((await params).code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  const c = code ? (((await getAdminDb().doc(`platformCertificates/${code}`).get()).data() as any) || null) : null;
  const date = c ? new Date(c.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  return (
    <div className="min-h-dvh bg-[#f7f5f2] px-5 py-10 text-stone-900 print:bg-white print:p-0">
      {!c ? (
        <div className="mx-auto max-w-md rounded-[2rem] bg-white p-8 text-center shadow-sm"><p className="text-3xl">✕</p><p className="mt-2 text-xl font-semibold">No certificate with code {code || '—'}</p><p className="mt-1 text-stone-600">Check the code and try again.</p></div>
      ) : (
        <>
          <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between print:hidden">
            <p className={`rounded-full px-4 py-2 text-sm font-semibold ${c.status === 'valid' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{c.status === 'valid' ? '✓ Verified — this certificate is genuine' : '✕ This certificate has been revoked'}</p>
            <PrintButton />
          </div>
          <div className="mx-auto max-w-3xl rounded-[2rem] border-[10px] border-double border-stone-300 bg-white px-8 py-14 text-center shadow-sm print:shadow-none">
            <p className="text-[11px] uppercase tracking-[0.4em] text-stone-400">Certificate of completion</p>
            <p className="mt-8 text-stone-500">This certifies that</p>
            <p className="mt-2 text-4xl font-light tracking-tight sm:text-5xl">{c.studentName}</p>
            <p className="mt-6 text-stone-500">has successfully completed</p>
            <p className="mt-2 text-2xl font-semibold">{c.courseTitle}</p>
            <p className="mt-1 text-stone-600">with {c.tenantName}</p>
            {(c.requiredOnlineHours || c.onlineHours) ? <p className="mt-4 text-sm text-stone-600">Verified online learning: {c.onlineHours} hours{c.requiredInPersonHours ? ` · in-person hours requirement met (${c.requiredInPersonHours} h)` : ''}</p> : null}
            <p className="mt-10 text-sm text-stone-500">Issued {date}</p>
            <p className="mt-6 font-mono text-[12px] tracking-widest text-stone-500">Verification code {c.code}</p>
            <p className="text-[11px] text-stone-400">Verify at /verify/{c.code}</p>
          </div>
        </>
      )}
    </div>
  );
}
