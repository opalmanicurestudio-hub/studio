'use client';
// "Print a copy" on the client's aftercare page: the page prints cleanly as a card to keep (buttons and links hidden).
export function PrintCard() {
  return <button type="button" className="no-print" onClick={() => window.print()} style={{ alignSelf: 'center', height: 40, padding: '0 16px', borderRadius: 999, border: '1px solid #ececee', background: '#fff', color: '#16171a', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>Print a copy</button>;
}
