'use client';
// src/components/kitchen/ReadyToRun.tsx — "ORDER UP": what the kitchen has marked ready, for whoever carries it out.
// Shown on the front desk (Assist), the dashboard and the host stand, so food and drink never sit on the pass because
// nobody was looking at the kitchen screen. Each ticket says what, where to take it (table and seat, station, or what
// the guest is wearing) and any allergy, big. "I'll take it" puts a name on it (a lounge guest sees it's on its way);
// "Delivered" hands it over with the same server step as the kitchen screen (lib/kitchen-client), once. "Let someone
// else" frees a ticket whose carrier got pulled away.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { allergyFlags, ticketFrom, type KitchenTicket } from '@/lib/kitchen';
import { kitchenStep } from '@/lib/kitchen-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';

const where_ = (t: KitchenTicket) => {
  const seat = t.tableNumber ? `Table ${t.tableNumber}${t.seatNumber ? `, seat ${t.seatNumber}` : ''}` : t.station;
  return t.source === 'event' && t.eventTitle ? `${t.eventTitle}, ${seat}` : seat;
};
const ago = (iso: string | null, now: number) => { const s = Math.max(0, Math.round((now - Date.parse(String(iso || ''))) / 1000)); return !Number.isFinite(s) ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`; };

// One sound for the whole page, unlocked by the first tap anywhere (browsers allow sound only after one).
let audio: AudioContext | null = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => {
  try { if (!audio) audio = new AudioContext(); if (audio.state === 'suspended') audio.resume().catch(() => {}); } catch { /* no sound on this device */ }
}, { passive: true });
function chimeOnce() {
  const ctx = audio; if (!ctx || ctx.state !== 'running') return;
  for (const [f, at] of [[660, 0], [880, 0.14]] as const) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(f, ctx.currentTime + at); g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.35);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4);
  }
}

/** Everything marked ready in the last half day, oldest first, and a soft chime for each newly ready ticket (never
 *  for what was already up when the page opened). Called once by the page, which stays open, and handed to the list. */
export function useReadyToRun(firestore: any, tenantId: string | null, opts: { chime?: boolean } = {}): KitchenTicket[] {
  const kq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'kdsTickets'), where('status', '==', 'ready')) : null), [firestore, tenantId]);
  const lq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'refreshmentRequests'), where('status', '==', 'ready')) : null), [firestore, tenantId]);
  const { data: k } = useCollection<any>(kq); const { data: l } = useCollection<any>(lq);
  const loaded = !!k && !!l;
  const list = React.useMemo(() => {
    const since = Date.now() - 12 * 3600000;   // something never handed over doesn't stay on every screen for good
    return [...(l || []).map((d: any) => ticketFrom(d, 'refreshmentRequests')), ...(k || []).map((d: any) => ticketFrom(d, 'kdsTickets'))]
      .filter((t) => { const at = Date.parse(String(t.readyAt || t.at)); return !Number.isFinite(at) || at >= since; })
      .sort((a, b) => String(a.readyAt || a.at).localeCompare(String(b.readyAt || b.at)));
  }, [k, l]);
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!loaded) return;
    const ids = list.map((t) => `${t.col}/${t.id}`);
    if (seen.current && opts.chime !== false && ids.some((i) => !seen.current!.has(i))) chimeOnce();
    seen.current = new Set(ids);
  }, [list, loaded, opts.chime]);
  return list;
}

export function ReadyToRun({ tenantId, list, title = 'Ready to run' }: { tenantId: string; list: KitchenTicket[]; title?: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);

  const go = async (t: KitchenTicket, step: 'carry' | 'drop' | 'deliver') => {
    setBusy(`${t.id}${step}`); setMsg(null);
    const r = await kitchenStep(tenantId, t.col, t.id, step);
    setBusy(null);
    // A lounge guest is texted that it's on its way, as the desk's "Bringing it" does.
    if (r.ok && !r.already && step === 'carry' && t.col === 'refreshmentRequests') void fetch('/api/retail/lounge-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, requestId: t.id, moment: 'out' }), keepalive: true }).catch(() => undefined);
    if (!r.ok) setMsg(r.error || 'That didn’t go through.');
    else if (r.already) setMsg(step === 'carry' ? `Someone already has ${t.item} for ${t.name}.` : step === 'deliver' ? `${t.item} for ${t.name} was already handed over.` : null);
  };

  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: INK }}>{title}</h2>
        <span style={{ minWidth: 28, height: 28, padding: '0 8px', borderRadius: 999, background: list.length ? GREEN : '#fff', color: list.length ? '#fff' : MUTED, border: list.length ? 'none' : `1px solid ${LINE}`, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{list.length}</span>
      </div>
      {msg && <p role="status" style={{ margin: 0, fontSize: 13.5, color: AMBER }}>{msg}</p>}
      {list.length === 0 && <p style={{ margin: 0, padding: '14px 12px', borderRadius: 14, border: `1px dashed ${LINE}`, fontSize: 14, color: MUTED, textAlign: 'center' }}>Nothing waiting to go out.</p>}
      {list.map((t) => {
        const f = allergyFlags(t); const fresh = now - Date.parse(String(t.readyAt || t.at)) < 60000;
        return (
          <article key={`${t.col}/${t.id}`} style={{ background: '#fff', border: `${fresh ? 2 : 1}px solid ${fresh ? GREEN : LINE}`, borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: INK }}>{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}</p>
              <span style={{ fontSize: 13, fontWeight: 600, color: fresh ? GREEN : MUTED, fontVariantNumeric: 'tabular-nums' }}>{ago(t.readyAt || t.at, now)}</span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: '#4b4e54' }}>{where_(t)}, {t.name}{t.lookFor ? `, ${t.lookFor}` : ''}</p>
            {f.any && <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, borderRadius: 10, padding: '8px 10px', background: f.severe ? AMBER : AMBER_TINT, color: f.severe ? '#fff' : AMBER }}>
              {f.listed.length ? `${f.severe ? 'Severe allergy' : 'Allergy'}: ${f.listed.map((a) => a.name).join(', ')}` : `Allergy in their note: ${f.mentions[0]}`}
            </p>}
            {t.collect > 0 && <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: INK }}>Collect ${t.collect.toFixed(2)} when you hand it over</p>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {t.carriedBy
                ? <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13.5, fontWeight: 600, color: GREEN, background: GREEN_TINT, borderRadius: 10, padding: '4px 4px 4px 12px' }}>{t.carriedBy} is taking it
                    <button type="button" disabled={!!busy} onClick={() => go(t, 'drop')} style={{ minHeight: 36, padding: '0 10px', borderRadius: 8, border: 'none', background: 'transparent', color: GREEN, fontSize: 13, fontWeight: 600, textDecoration: 'underline' }}>Let someone else</button></span>
                : <button type="button" disabled={!!busy} onClick={() => go(t, 'carry')} style={{ flex: 1, minHeight: 44, borderRadius: 12, border: 'none', background: INK, color: '#fff', fontSize: 14, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>I’ll take it</button>}
              <button type="button" disabled={!!busy} onClick={() => go(t, 'deliver')} style={{ minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', color: INK, fontSize: 14, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>Delivered</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
