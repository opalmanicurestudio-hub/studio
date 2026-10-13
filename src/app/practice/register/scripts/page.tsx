'use client';
// Printable phone scripts for the front desk and the classroom. The same scripts the practice game coaches from.
import * as R from '@/lib/practice/register';
import { INK, MUTED, LINE, SOFT } from '../parts';

export default function PhoneScripts() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", padding: '28px 32px', boxSizing: 'border-box' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap'); @media print { .noprint { display: none !important } @page { margin: 12mm } } @media (max-width: 600px) { .wrap { padding: 0 !important } }`}</style>
      <div className="noprint" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <a href="/practice/register" style={{ fontSize: 13, color: MUTED }}>← Back to the register</a><span style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={{ border: `1px solid ${INK}`, background: INK, color: '#fff', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Print the scripts</button>
      </div>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT · THE PHONE</div>
      <h1 style={{ fontSize: 28, fontWeight: 300, margin: '4px 0 6px', letterSpacing: '-0.02em' }}>Phone scripts</h1>
      <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 720, lineHeight: 1.5, marginBottom: 14 }}>What to say for every kind of call at the front desk. Make them your own words; keep the steps.</div>
      <div style={{ background: SOFT, borderRadius: 14, padding: '10px 14px', fontSize: 13, lineHeight: 1.6, marginBottom: 18, maxWidth: 900 }}>
        <b>House rules</b> · Answer within three rings · Ask before every hold · Never take a card number out loud (text a secure link) · Never give out anyone’s personal number · Don’t promise a callback time for someone else · Read details back before you hang up
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {R.SCRIPTS.map((x) => (
          <div key={x.title} style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: '14px 16px', breakInside: 'avoid', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontSize: 15 }}>{x.title}</b><div style={{ fontSize: 12, color: MUTED }}>{x.when}</div>
            {x.lines.map((l) => <div key={l} style={{ fontSize: 13, lineHeight: 1.5, display: 'flex', gap: 8 }}><span style={{ color: MUTED }}>•</span><span>{l}</span></div>)}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, fontSize: 12, color: MUTED }}>{R.SALON.name} · {R.SALON.address} · {R.SALON.hours}. Practice material: names, numbers and the address are made up.</div>
    </div>
  );
}
