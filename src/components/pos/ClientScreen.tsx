'use client';
// src/components/pos/ClientScreen.tsx — the DESK side of the client screen (the iPad): which screen this desk uses,
// pairing, and a small connector the checkout uses to show the live ticket, ask for a tip or an approval, and hear back.
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';

async function call(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/client-screen', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
const keyFor = (tenantId: string) => `cf_desk_client_screen_${tenantId}`;
export function useClientScreen(tenantId?: string | null) {
  const { firestore } = useFirebase() as any;
  const [screenId, setScreenIdState] = React.useState<string | null>(null);
  const [screen, setScreen] = React.useState<any>(null);
  // Every part of the desk (header, checkout, counter) shares one answer to "which iPad?" — pairing in one place
  // updates the others at once (before this, checkout didn't know about a new pairing until the page was reloaded).
  React.useEffect(() => { if (!tenantId) return;
    const read = () => { try { setScreenIdState(localStorage.getItem(keyFor(tenantId))); } catch { /* */ } };
    read(); window.addEventListener('cf:client-screen-changed', read); window.addEventListener('storage', read);
    return () => { window.removeEventListener('cf:client-screen-changed', read); window.removeEventListener('storage', read); }; }, [tenantId]);
  React.useEffect(() => { if (!firestore || !screenId) { setScreen(null); return; } return onSnapshot(doc(firestore, 'clientScreens', screenId), (s) => setScreen(s.exists() ? s.data() : null), () => setScreen(null)); }, [firestore, screenId]);
  const setScreenId = (id: string | null) => { if (!tenantId) return; try { id ? localStorage.setItem(keyFor(tenantId), id) : localStorage.removeItem(keyFor(tenantId)); } catch { /* */ } setScreenIdState(id); window.dispatchEvent(new Event('cf:client-screen-changed')); };
  const online = !!screen?.tenantId && screen.tenantId === tenantId && !!screen.lastSeen && Date.now() - Date.parse(screen.lastSeen) < 150000;
  const connected = !!screen?.tenantId && screen.tenantId === tenantId;
  const push = React.useCallback((ticket: any) => (screenId && tenantId ? call({ tenantId, action: 'push', screenId, ticket }) : Promise.resolve(null)), [screenId, tenantId]);
  // The whole answer (why it was refused, too: a sale already paid says how, and what it was rung up with).
  const requestFull = React.useCallback(async (kind: string, extra: any = {}): Promise<any> => { if (!screenId || !tenantId) return null; const r: any = await call({ tenantId, action: 'request', screenId, kind, ...extra });
    if (r?.paymentClosed === 'paid') window.dispatchEvent(new CustomEvent('cf:screen-late-payment', { detail: r?.closedAnswer || null }));   // it had gone through before we moved on (the answer says for what)
    return r || null; }, [screenId, tenantId]);
  const request = React.useCallback(async (kind: string, extra: any = {}) => { const r: any = await requestFull(kind, extra); return r?.ok ? r.requestId : null; }, [requestFull]);
  const alive = React.useCallback(() => (screenId && tenantId ? call({ tenantId, action: 'alive', screenId }) : Promise.resolve(null)), [screenId, tenantId]);
  return { screenId, setScreenId, screen, connected, online, name: screen?.name || null, request: screen?.request || null, response: screen?.response || null, push, ask: request, askFull: requestFull, alive };
}

/** THE CLIENT'S OWN PHONE, through their visit link: a screen that belongs to one visit, opened on demand (no iPad and
 *  no pairing — a solo provider checking out on their phone uses it too). It speaks the same requests as the iPad
 *  (push the ticket, ask for a payment, hear the answer), so the checkout handles it the same way. */
export function useVisitScreen(tenantId?: string | null) {
  const { firestore } = useFirebase() as any;
  const [screenId, setScreenId] = React.useState<string | null>(null);
  const [screen, setScreen] = React.useState<any>(null);
  React.useEffect(() => { if (!firestore || !screenId) { setScreen(null); return; } return onSnapshot(doc(firestore, 'clientScreens', screenId), (s) => setScreen(s.exists() ? s.data() : null), () => setScreen(null)); }, [firestore, screenId]);
  /** This visit's screen (made the first time), ready for a request. */
  const open = React.useCallback(async (appointmentId: string): Promise<any> => { if (!tenantId) return null; const r: any = await call({ tenantId, action: 'visit_screen', appointmentId }); if (r?.ok && r.screenId) setScreenId(r.screenId); return r; }, [tenantId]);
  const requestFull = React.useCallback(async (kind: string, extra: any = {}, id?: string | null): Promise<any> => { const sid = id || screenId; if (!sid || !tenantId) return null;
    const r: any = await call({ tenantId, action: 'request', screenId: sid, kind, ...extra });
    if (r?.paymentClosed === 'paid') window.dispatchEvent(new CustomEvent('cf:screen-late-payment', { detail: r?.closedAnswer ? { ...r.closedAnswer, via: 'visit' } : { via: 'visit' } }));
    return r || null; }, [screenId, tenantId]);
  const request = React.useCallback(async (kind: string, extra: any = {}) => { const r: any = await requestFull(kind, extra); return r?.ok ? r.requestId : null; }, [requestFull]);
  const push = React.useCallback((ticket: any, id?: string | null) => { const sid = id || screenId; return sid && tenantId ? call({ tenantId, action: 'push', screenId: sid, ticket }) : Promise.resolve(null); }, [screenId, tenantId]);
  return { screenId, screen, open, name: screen?.name || 'their phone', request: screen?.request || null, response: screen?.response || null, connected: !!screenId, push, ask: request, askFull: requestFull };
}

/** Pair an iPad, choose which screen this desk uses, or disconnect. */
export function ClientScreenPanel({ tenantId }: { tenantId: string }) {
  const cs = useClientScreen(tenantId);
  const [code, setCode] = React.useState(''); const [name, setName] = React.useState('Front desk iPad'); const [msg, setMsg] = React.useState<string | null>(null);
  const [list, setList] = React.useState<any[]>([]); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const r: any = await call({ tenantId, action: 'list' }); if (r?.ok) setList(r.screens || []); }, [tenantId]);
  React.useEffect(() => { load(); }, [load]);
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties;
  const inp = 'h-12 w-full rounded-xl px-4 text-[18px] outline-none'; const inpS = { background: 'var(--paper)', border: '1px solid var(--line)' } as React.CSSProperties;
  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-3xl p-4" style={box}>
        <p className="text-[15px] font-semibold">This desk’s client screen</p>
        {cs.connected ? <p className="text-[14px]"><span aria-hidden style={{ color: cs.online ? 'var(--ok)' : 'var(--warn)' }}>●</span> {cs.name} — {cs.online ? 'online' : 'not seen in the last few minutes (is it open and awake?)'}</p>
          : <p className="text-[14px]" style={{ color: 'var(--muted)' }}>None yet — pair one below.</p>}
        {cs.connected && <button type="button" onClick={() => cs.setScreenId(null)} className="text-[13px] font-semibold underline underline-offset-4">Stop using it on this desk</button>}
      </section>
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        <p className="text-[15px] font-semibold">Pair a screen</p>
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>On the iPad, open <b>{typeof window !== 'undefined' ? window.location.origin : ''}/screen</b> in Safari (tip: Share → Add to Home Screen, and turn on Guided Access to keep it on this page). Enter the 6-digit code it shows.</p>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" aria-label="Pairing code" className={`${inp} tracking-[0.3em]`} style={inpS} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it (e.g. Front desk iPad)" aria-label="Screen name" className={inp} style={inpS} />
        <button type="button" disabled={busy || code.length !== 6} onClick={async () => { setBusy(true); const r: any = await call({ tenantId, action: 'pair_confirm', code, name }); setBusy(false);
          if (r?.ok) { cs.setScreenId(r.screenId); setMsg(`Paired — “${r.name}” is this desk’s client screen.`); setCode(''); load(); } else setMsg(r?.error || 'That didn’t pair.'); }}
          className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? 'Pairing…' : 'Pair'}</button>
        {msg && <p className="text-[14px] font-semibold">{msg}</p>}
      </section>
      {list.length > 0 && <section className="space-y-2 rounded-3xl p-4" style={box}>
        <p className="text-[15px] font-semibold">Your screens</p>
        {list.map((x) => <div key={x.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
          <span className="text-[14px]"><b>{x.name}</b> <span style={{ color: 'var(--muted)' }}>{x.lastSeen && Date.now() - Date.parse(x.lastSeen) < 150000 ? '· online' : '· offline'}</span></span>
          <span className="flex gap-2">{cs.screenId !== x.id && <button type="button" onClick={() => cs.setScreenId(x.id)} className="text-[13px] font-semibold underline underline-offset-4">Use on this desk</button>}
            <button type="button" onClick={async () => { await call({ tenantId, action: 'unpair', screenId: x.id }); if (cs.screenId === x.id) cs.setScreenId(null); load(); }} className="text-[13px] underline underline-offset-4" style={{ color: 'var(--muted)' }}>Unpair</button></span>
        </div>)}
      </section>}
    </div>
  );
}
