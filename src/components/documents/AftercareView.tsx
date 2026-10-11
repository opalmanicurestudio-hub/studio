// src/components/documents/AftercareView.tsx — HOW A CLIENT'S AFTERCARE PAGE LOOKS (approved design, canvas row 23):
// the business, "After your {service} · from {provider}", the title, the aftercare blocks (or plain text), a
// "something not right?" box when the business uses Making it right, and Book your next visit. Used by
// /aftercare/{tenant}/{visit} (lib/aftercare).
import { DocBlocks } from '@/components/documents/DocBlocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;

export function AftercareView({ name, logo, accent, service, from, doc, text, howHref, bookHref }: { name: string; logo?: string | null; accent?: string | null; service: string; from?: string; doc: { title: string; sections: any[] } | null; text?: string | null; howHref?: string; bookHref?: string }) {
  return <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}><div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>

    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt="" style={{ width: 36, height: 36, borderRadius: 11, objectFit: 'cover' }} /> : <span style={{ width: 36, height: 36, borderRadius: 11, background: accent || INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</span>}
      <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span></div>
    <div><div style={{ fontSize: 14, color: MUTED }}>After your {service.toLowerCase()}{from ? ` · from ${from}` : ''}</div>
      <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{doc?.title || 'Caring for it at home'}</h1></div>
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '20px 18px' }}>
      {doc ? <DocBlocks sections={doc.sections || []} />
        : text ? <p style={{ whiteSpace: 'pre-line', fontSize: 15.5, lineHeight: 1.6, margin: 0 }}>{text}</p>
        : <p style={{ color: MUTED, margin: 0 }}>There’s no aftercare for this visit. If you have a question, just reply to our message.</p>}
    </div>
    {howHref && <a href={howHref} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 18px', borderRadius: 18, background: '#fdf3e6', color: '#7a3e05', textDecoration: 'none' }}>
      <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 15 }}>Something not quite right?</b><span style={{ fontSize: 14 }}>Tell us — we’ll make it right.</span></span><span style={{ fontSize: 14, fontWeight: 600 }}>Tell us ›</span></a>}
    {bookHref && <a href={bookHref} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 999, background: INK, color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>Book your next visit</a>}
  </div></div>;
}
