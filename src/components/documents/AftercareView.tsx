// src/components/documents/AftercareView.tsx — HOW A CLIENT'S AFTERCARE PAGE LOOKS (approved design, canvas row 23):
// the business, "After your {service} · from {provider}", the title, the aftercare blocks (or plain text), a
// "something not right?" box when the business uses Making it right, and Book your next visit. Used by
// /aftercare/{tenant}/{visit} (lib/aftercare). When the client has no next visit booked, the check-in (and the page)
// offers their follow-up service with real times (VisitRebook — the same as the visit link); if booked, it shows it.
import { DocBlocks } from '@/components/documents/DocBlocks';
import { AftercareCheckIn } from '@/components/documents/AftercareCheckIn';
import { VisitRebook } from '@/components/visit/VisitRebook';
import { PrintCard } from '@/components/documents/PrintCard';
import { CHAT_LANGUAGES } from '@/lib/chat-languages';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;

export function AftercareView({ name, logo, accent, service, from, when, doc, text, howHref, bookHref, bookLabel, note, used, checkIn, rebookToken, takeHome, photo, langBase, lang }: { name: string; logo?: string | null; accent?: string | null; service: string; from?: string; when?: string; doc: { title: string; sections: any[] } | null; text?: string | null; howHref?: string; bookHref?: string; bookLabel?: string;
  note?: { text: string; by?: string | null } | null; used?: string[]; checkIn?: { tenantId: string; appointmentId: string; k?: string; t?: string; answered?: string | null; reportHref?: string } | null;
  /** The visit's check-in token: shows "Book your next visit" with real times (their return service, provider, usual time) — or their booking if they already have one. */
  rebookToken?: string | null; takeHome?: { name: string; price: number; href: string; image?: string | null }[]; photo?: string | null; langBase?: string | null; lang?: string }) {
  const rebook = rebookToken ? <div style={{ ['--accent' as any]: accent || INK }}><VisitRebook token={rebookToken} bookHref={bookHref || null} /></div> : null;
  return <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}><div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>

    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {logo ? <img src={logo} alt="" style={{ width: 36, height: 36, borderRadius: 11, objectFit: 'cover' }} /> : <span style={{ width: 36, height: 36, borderRadius: 11, background: accent || INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</span>}
      <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span></div>
    {checkIn && <AftercareCheckIn {...checkIn} service={service} />}
    {checkIn && rebook}
    <div><div style={{ fontSize: 14, color: MUTED }}>After your {service.toLowerCase()}{when ? ` · ${when}` : ''}{from ? ` with ${from}` : ''}</div>
      <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{doc?.title || 'Caring for it at home'}</h1></div>
    {note?.text && <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 16, background: '#f5f5f7', fontSize: 14.5, lineHeight: 1.45 }}><span><b style={{ display: 'block' }}>A note from {note.by || from || 'us'}</b>{note.text}</span></div>}
    {used && used.length > 0 && <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '12px 14px' }}><div style={{ fontSize: 13, color: MUTED, paddingBottom: 6 }}>What we used</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{used.map((u) => <span key={u} style={{ fontSize: 13, fontWeight: 600, padding: '5px 10px', borderRadius: 999, background: '#f3f3f5' }}>{u}</span>)}</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Keep this if you ever react to a product — it helps us and your doctor.</div></div>}
    {photo && <img src={photo} alt={`Your ${service.toLowerCase()}`} style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 20 }} />}
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '20px 18px' }}>
      {doc ? <DocBlocks sections={doc.sections || []} />
        : text ? <p style={{ whiteSpace: 'pre-line', fontSize: 15.5, lineHeight: 1.6, margin: 0 }}>{text}</p>
        : <p style={{ color: MUTED, margin: 0 }}>There’s no aftercare for this visit. If you have a question, just reply to our message.</p>}
    </div>
    {takeHome && takeHome.length > 0 && <div className="no-print" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '12px 14px' }}><div style={{ fontSize: 13, color: MUTED, paddingBottom: 8 }}>To keep it looking its best at home</div>
      <div style={{ display: 'grid', gap: 8 }}>{takeHome.map((p) => <a key={p.href} href={p.href} style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK, textDecoration: 'none' }}>
        {p.image ? <img src={p.image} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} /> : <span style={{ width: 44, height: 44, borderRadius: 12, background: '#f3f3f5' }} />}
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{p.name}</span>{p.price > 0 && <span style={{ fontSize: 14, color: MUTED }}>${p.price.toFixed(2).replace(/\.00$/, '')}</span>}</a>)}</div></div>}
    {howHref && <a className="no-print" href={howHref} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 18px', borderRadius: 18, background: '#fdf3e6', color: '#7a3e05', textDecoration: 'none' }}>
      <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 15 }}>Something not quite right?</b><span style={{ fontSize: 14 }}>Tell us — we’ll make it right.</span></span><span style={{ fontSize: 14, fontWeight: 600 }}>Tell us ›</span></a>}
    {!checkIn && rebook}
    {!rebook && bookHref && <a className="no-print" href={bookHref} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 999, background: INK, color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>{bookLabel || 'Book your next visit'}</a>}
    {langBase && <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', fontSize: 13 }}><span style={{ color: MUTED, width: '100%', textAlign: 'center' }}>Read it in</span>
      {CHAT_LANGUAGES.map((l) => <a key={l.code} href={l.code === 'en' ? langBase : `${langBase}&lang=${l.code}`} style={{ padding: '5px 10px', borderRadius: 999, background: (lang || 'en') === l.code ? INK : '#f3f3f5', color: (lang || 'en') === l.code ? '#fff' : INK, textDecoration: 'none', fontWeight: 600 }}>{l.name}</a>)}</div>}
    <PrintCard />
    <style>{`@media print { .no-print { display: none !important } body { background: #fff } @page { margin: 0.5in } }`}</style>
  </div></div>;
}
