'use client';
// Printable practice barcodes for the register game. Real UPC-A codes, so any
// USB or Bluetooth barcode scanner reads them. Only the practice game knows them.
import * as R from '@/lib/practice/register';
import { Barcode, INK, MUTED, LINE } from '../parts';

export default function PracticeSheet() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", padding: '28px 32px', boxSizing: 'border-box' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap'); @media print { .noprint { display: none !important } @page { margin: 12mm } }`}</style>
      <div className="noprint" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <a href="/practice/register" style={{ fontSize: 13, color: MUTED }}>← Back to the register</a><span style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={{ border: `1px solid ${INK}`, background: INK, color: '#fff', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Print this sheet</button>
      </div>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT · REGISTER</div>
      <h1 style={{ fontSize: 28, fontWeight: 300, margin: '4px 0 6px', letterSpacing: '-0.02em' }}>Practice barcodes</h1>
      <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 720, lineHeight: 1.5, marginBottom: 20 }}>
        Print this page, plug in your barcode scanner (USB or Bluetooth), open the register game and scan. Most scanners work straight away because they type the number and press Enter. These codes are for practice only and don’t match any real product.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
        {R.SKUS.map((s) => (
          <div key={s.key} style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, breakInside: 'avoid' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'stretch' }}>
              <span style={{ width: 12, height: 20, borderRadius: 3, background: s.color }} />
              <b style={{ fontSize: 14, flex: 1 }}>{R.skuLabel(s)}</b><span style={{ fontSize: 14, fontWeight: 700 }}>${s.price}</span>
            </div>
            <Barcode code={s.code} h={64} unit={2} />
          </div>
        ))}
      </div>
    </div>
  );
}
