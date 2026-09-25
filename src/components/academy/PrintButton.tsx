'use client';
// src/components/academy/PrintButton.tsx — "Print or save as PDF".
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className="rounded-full bg-stone-900 px-5 py-2.5 text-sm text-white print:hidden">{label}</button>;
}
