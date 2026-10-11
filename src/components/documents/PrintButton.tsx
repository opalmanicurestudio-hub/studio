'use client';
// A Print / Save as PDF button for the read-only proof pages (iOS ignores scripted printing, so it's a real button).
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className="no-print h-11 rounded-full px-5 text-[14px] font-semibold text-white" style={{ background: '#16171a' }}>{label}</button>;
}
