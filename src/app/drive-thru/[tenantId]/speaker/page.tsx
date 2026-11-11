'use client';
// src/app/drive-thru/[tenantId]/speaker/page.tsx — THE SPEAKER (L21). A tablet wired to the drive-thru's speaker and
// microphone. When a car pulls up, the voice assistant greets it and takes the order (its tools: api/counter/assistant),
// and the order builds on the lane screen and the order board as it's said. The team can listen in or take over from
// the lane screen at any moment, on their own microphone; the order taken so far stays as it is.
//   A car arrives three ways: "A car pulled up" here, a car sensor that presses Enter (any button that types a key
//   works), or a car added on the lane screen (greeted on its own while "Greet cars added on the lane" is on).
//   The call itself goes through our server (lib/drive-thru-voice-client): this tablet never holds the service's key.
//   Set up once like the lane screen (api/kitchen 'pair', kind 'drive-thru').

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Mic } from 'lucide-react';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';
import { spoken, voiceClient } from '@/lib/drive-thru-voice-client';

const BG = '#16171a', CARD = '#1f2024', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.12)', GREEN = '#7fd1a4', AMBER = '#f0b46a';
const POLL_MS = 1500;
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
const keyName = (t: string) => `cf.drivethru.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const rid = () => { try { return crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 24); } catch { return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`; } };

type Car = { id: string; number: string; orderId: string | null; arrivedAt: string; voice: { status?: string; callId?: string; takenOverBy?: string } | null; items?: number };
type Line = { id: string; who: 'guest' | 'assistant'; text: string };

export default function Speaker() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false); const [stopped, setStopped] = useState('');
  const [cfg, setCfg] = useState<{ on: boolean; publicKey: string | null; setUp: boolean } | null>(null);
  const [armed, setArmed] = useState(false);
  const [auto, setAuto] = useState(true);
  const [car, setCar] = useState<Car | null>(null);
  const [talking, setTalking] = useState<{ car: Car; status: string; callId: string | null } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState('');
  const session = useRef<any>(null);
  const greeted = useRef<Set<string>>(new Set());
  const carFor = useRef<string | null>(null);
  const starting = useRef(false);

  useEffect(() => { setKey(read(keyName(tenantId))); setAuto(read('cf.drivethru.speaker.auto') !== 'off'); setReady(true); }, [tenantId]);
  const call = useCallback(async (url: string, body: any) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, ...body }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setStopped(d.error || 'This screen was stopped. A manager can set it up again.'); }
    return { status: r.status, d };
  }, [tenantId, key]);
  // Read again every minute, so switching the assistant on or off on the Menu page reaches this tablet on its own.
  useEffect(() => {
    if (!key) return;
    const get = () => void call('/api/counter/voice', { action: 'config' }).then(({ d }) => { if (d.ok) setCfg({ on: !!d.on, publicKey: d.publicKey || null, setUp: !!d.setUp }); }, () => undefined);
    get(); const i = setInterval(get, 60000); return () => clearInterval(i);
  }, [key, call]);

  const reset = useCallback(() => { session.current = null; carFor.current = null; setTalking(null); }, []);

  // A call for this car: made through our server, then this tablet's speaker and microphone are the guest's line.
  const greet = useCallback(async (c: Car) => {
    if (!cfg?.on || session.current || starting.current) return;
    starting.current = true; greeted.current.add(c.id); carFor.current = c.id; setLines([]); setNotice('');
    setTalking({ car: c, status: 'connecting', callId: null });
    try {
      const client = await voiceClient(() => ({ tenantId, key, carId: carFor.current }), cfg.publicKey);
      const s = client.createWebCall({ agent_id: 'set-by-server', transcript: !!cfg.publicKey, hooks: {
        onStatus: (st: string) => setTalking((t) => (t ? { ...t, status: st, callId: s.callId || t.callId } : t)),
        onTranscript: (items: any[]) => setLines(spoken(items).slice(-6)),
        onEnd: () => { const id = s.callId; if (id) void call('/api/counter/voice', { action: 'ended', callId: id }); reset(); },
        onError: (e: Error) => { setNotice(/denied|permission/i.test(String(e?.message)) ? 'This tablet isn’t allowed to use its microphone. Allow it in the browser’s settings.' : 'The call dropped. Take this order on the lane screen.'); },
      } } as any);
      // A team member taking over ends only the assistant's side, and the transcript says so ('call_take_over'). The
      // guest's line goes on, now with the team member: only the transcript stops here, never the call.
      const ownEnd = (s as any).monitorEnded;
      if (typeof ownEnd === 'function') (s as any).monitorEnded = (ev: any) => (ev?.disconnection_reason === 'call_take_over' ? (s as any).closeMonitor?.() : ownEnd.call(s, ev));
      session.current = s;
      await s.ready.catch(() => undefined);
      // Sound on, from the tap that turned the speaker on (a browser that still holds it back is asked again here).
      await s.startAudioPlayback?.().catch?.(() => undefined);
      if (s.status === 'ended') reset();
    } catch {
      setNotice('The assistant didn’t answer. Take this order on the lane screen.'); reset();
    } finally { starting.current = false; }
  }, [cfg, tenantId, key, call, reset]);

  // Watching the speaker: a car added on the lane screen is greeted on its own (once), while that's switched on.
  useEffect(() => {
    if (!key || !armed) return;
    let stop = false;
    const tick = async () => {
      try {
        const { d } = await call('/api/counter/voice', { action: 'speaker' });
        if (stop || !d.ok) return;
        const c: Car | null = d.car;
        setCar(c);
        // (Two minutes by the server's clock, not this tablet's.)
        const nowMs = Number.isFinite(Date.parse(d.now)) ? Date.parse(d.now) : Date.now();
        if (c && auto && !session.current && !greeted.current.has(c.id) && !c.voice && nowMs - Date.parse(c.arrivedAt) < 120000) void greet(c);
      } catch { /* keeps trying */ }
    };
    tick(); const i = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(i); };
  }, [key, armed, auto, call, greet]);

  // "A car pulled up": a new car on the lane, greeted straight away.
  // One car per pull-up: a held key, a double tap or a sensor that chatters never makes a second car.
  const pulling = useRef(false);
  const pulledUpNow = async () => {
    const { d } = await call('/api/counter', { action: 'car', carKey: rid() });
    if (!d.ok) { setNotice(d.error || 'That didn’t go through. Try again.'); return; }
    await greet({ id: d.carId, number: d.number, orderId: d.orderId, arrivedAt: new Date().toISOString(), voice: null });
  };
  const latestPull = useRef(pulledUpNow); latestPull.current = pulledUpNow;
  const pulledUp = useCallback(async () => {
    if (session.current || starting.current || pulling.current) return;
    pulling.current = true;   // taken before anything is awaited
    try { await latestPull.current(); } finally { setTimeout(() => { pulling.current = false; }, 1500); }
  }, []);
  useEffect(() => {
    if (!armed) return;
    const k = (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !(e.target as HTMLElement)?.closest?.('button, input')) { e.preventDefault(); void pulledUp(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [armed, pulledUp]);
  useEffect(() => () => { try { session.current?.disconnect?.(); } catch { /* */ } }, []);

  // One tap first: a browser only lets a page use the speaker and microphone after someone has touched it.
  const arm = async () => {
    // Sound unlocked with this tap too, so the assistant can be heard when a car pulls up later with nobody touching it.
    try { const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; if (AC) { const a = new AC(); await a.resume().catch(() => undefined); a.close?.(); } } catch { /* */ }
    try { const m = await navigator.mediaDevices.getUserMedia({ audio: true }); m.getTracks().forEach((t) => t.stop()); setArmed(true); setNotice(''); }
    catch { setNotice('This tablet isn’t allowed to use its microphone. Allow it in the browser’s settings, then try again.'); }
  };
  const hangUp = async () => { try { await session.current?.end?.(); } catch { /* */ } reset(); };
  const toggleAuto = () => { const v = !auto; setAuto(v); write('cf.drivethru.speaker.auto', v ? 'on' : 'off'); };

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;

  // A car at the speaker can be greeted: never greeted, or a call that dropped before anything was ordered.
  const greetable = !!car && (!car.voice || (['failed', 'ended'].includes(String(car.voice.status)) && !car.items));
  const takenOver = !!talking && car?.id === talking.car.id && car?.voice?.status === 'taken_over';
  const status = talking ? (talking.status === 'connecting' ? 'Connecting…' : talking.status === 'ended' ? 'Call ended' : takenOver ? `${String(car?.voice?.takenOverBy || 'The team').split(' ')[0]} is on with car ${talking.car.number}` : `Taking car ${talking.car.number}’s order`) : null;
  return (
    <main className="flex min-h-dvh flex-col" style={{ background: BG, color: TEXT }}>
      <header className="flex items-center justify-between gap-4 px-6 py-5" style={{ borderBottom: `1px solid ${RULE}` }}>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: CARD }}><Mic className="h-5 w-5" aria-hidden /></span>
          <div><h1 className="text-[20px] font-semibold">Speaker</h1><p className="text-[14px]" style={{ color: SUB }}>{cfg?.on ? 'The voice assistant takes each car’s order' : 'Drive-thru'}</p></div>
        </div>
        {armed && cfg?.on && <button type="button" onClick={toggleAuto} aria-pressed={auto} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold ${RING}`} style={{ background: CARD, color: TEXT }}>{auto ? 'Greeting cars added on the lane' : 'Only cars added here'}</button>}
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center" aria-live="polite">
        {!cfg ? <div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: RULE, borderTopColor: TEXT }} role="status" aria-label="Loading" />
          : !cfg.on ? (
            <div className="max-w-md space-y-3">
              <p className="text-[28px] font-semibold leading-tight">The voice assistant isn’t on</p>
              <p className="text-[16px] leading-relaxed" style={{ color: SUB }}>{cfg.setUp ? 'A manager switched it off for now. Orders are taken on the lane screen.' : 'It needs setting up first. Until then, orders are taken on the lane screen.'}</p>
            </div>
          ) : !armed ? (
            <div className="max-w-md space-y-5">
              <p className="text-[30px] font-semibold leading-tight">Turn on the speaker</p>
              <p className="text-[16px] leading-relaxed" style={{ color: SUB }}>One tap lets this tablet use its speaker and microphone. After that it greets each car on its own.</p>
              <button type="button" onClick={arm} className={`min-h-[64px] w-full rounded-2xl px-6 text-[18px] font-semibold ${RING}`} style={{ background: TEXT, color: BG }}>Turn on the speaker</button>
            </div>
          ) : talking ? (
            <div className="w-full max-w-2xl space-y-6">
              <div className="flex items-center justify-center gap-3">
                <span className="relative flex h-4 w-4"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: takenOver ? AMBER : GREEN }} /><span className="relative inline-flex h-4 w-4 rounded-full" style={{ background: takenOver ? AMBER : GREEN }} /></span>
                <p className="text-[28px] font-semibold leading-tight">{status}</p>
              </div>
              {lines.length > 0 && (
                <ul className="space-y-2.5 rounded-3xl p-5 text-left" style={{ background: CARD }}>
                  {lines.map((l) => <li key={l.id} className="text-[17px] leading-snug"><span className="mr-2 text-[13px] font-semibold" style={{ color: l.who === 'guest' ? AMBER : GREEN }}>{l.who === 'guest' ? 'Guest' : 'Assistant'}</span>{l.text}</li>)}
                </ul>
              )}
              <button type="button" onClick={hangUp} className={`min-h-[52px] rounded-2xl px-6 text-[16px] font-semibold ${RING}`} style={{ background: CARD, color: TEXT, border: `1px solid ${RULE}` }}>End the call</button>
            </div>
          ) : (
            <div className="w-full max-w-md space-y-5">
              <p className="text-[30px] font-semibold leading-tight">Waiting for the next car</p>
              <p className="text-[16px] leading-relaxed" style={{ color: SUB }}>{greetable ? `Car ${car!.number} is at the speaker.` : 'Tap below when a car pulls up, or press Enter. A car sensor that presses a key works too.'}</p>
              <button type="button" onClick={() => (greetable ? greet(car!) : pulledUp())} className={`min-h-[72px] w-full rounded-2xl px-6 text-[20px] font-semibold ${RING}`} style={{ background: TEXT, color: BG }}>{greetable ? (car!.voice ? `Greet car ${car!.number} again` : `Greet car ${car!.number}`) : 'A car pulled up'}</button>
            </div>
          )}
        {notice && <p role="alert" className="max-w-md rounded-2xl px-4 py-3 text-[15px]" style={{ background: CARD, color: AMBER }}>{notice}</p>}
      </section>
    </main>
  );
}
