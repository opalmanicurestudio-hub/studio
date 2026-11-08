// src/app/not-found.tsx — any address that doesn't exist: a plain page in the app's own look with one way out,
// instead of the framework's bare default.
import Link from 'next/link';

export const metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-8 text-center" style={{ color: '#16171a' }}>
      <p className="text-[22px] font-extrabold">This page isn’t here</p>
      <p className="max-w-xs text-[15px]" style={{ color: '#6d7075' }}>The link may be old or have a typo in it. If someone sent it to you, ask them for a fresh one.</p>
      <Link href="/" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: '#16171a' }}>Go to the home page</Link>
    </main>
  );
}
