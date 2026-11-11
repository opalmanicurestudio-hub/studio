'use client';
// src/components/drive-thru/VoiceBar.tsx — THE VOICE ASSISTANT, as the lane screen sees it (L21). While the assistant
// takes a car's order at the speaker, whoever is on the lane can read along (when the transcript is on), listen in,
// take over on this tablet's microphone at any moment (the assistant stops; the order taken so far stays exactly as it
// is, and they carry on with the menu here), tell the assistant something it should know ("we're out of shakes"), or
// hang up. Everything goes through our server (lib/drive-thru-voice-client); this tablet never holds the service's key.
import { useEffect, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneOff } from 'lucide-react';
import { spoken, voiceClient } from '@/lib/drive-thru-voice-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const GREEN_TINT = '#ecf6f0', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;

export type CarVoice = { status?: string; callId?: string; takenOverBy?: string } | null;
type Line = { id: string; who: 'guest' | 'assistant'; text: string };

// The calls this tablet is connected to, kept for the page's whole life (not the bar's): looking at another car, or a
// new car arriving, never drops a call someone here has taken over. A call is let go only when it ends or is hung up.
type Live = { s: any; state: string; lines: Line[]; muted: boolean; subs: Set<() => void> };
const live = new Map<string, Live>();
const making = new Map<string, Promise<Live>>();
const ctxNow: { current: { tenantId: string; key: string | null; staffPass: string | null } } = { current: { tenantId: '', key: null, staffPass: null } };
// Anything on the page that shows which car someone here is on (the lane's cars, its banner) hears every change too.
const watchers = new Set<() => void>();
const tell_ = (id: string) => { live.get(id)?.subs.forEach((f) => f()); watchers.forEach((f) => f()); };
const drop = (id: string) => { const l = live.get(id); if (!l) return; try { l.s.disconnect?.(); } catch { /* */ } live.delete(id); l.subs.forEach((f) => f()); watchers.forEach((f) => f()); };
const anyTakenOver = () => Array.from(live.values()).some((l) => l.state === 'taken_over');
// Leaving the page while on the speaker would cut the guest off: the browser asks first.
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (e) => { if (anyTakenOver()) { e.preventDefault(); e.returnValue = ''; } });

function liveFor(callId: string, publicKey: string | null): Promise<Live> {
  const have = live.get(callId); if (have) return Promise.resolve(have);
  const pending = making.get(callId); if (pending) return pending;
  const p = (async () => {
    const client = await voiceClient(() => ctxNow.current, publicKey);
    const l: Live = { s: null, state: 'idle', lines: [], muted: false, subs: new Set() };
    l.s = client.monitorCall({ call_id: callId, transcript: !!publicKey, hooks: {
      onStatus: (st: string) => { l.state = st; tell_(callId); },
      onTranscript: (items: any[]) => { l.lines = spoken(items).slice(-5); tell_(callId); },
      onEnd: () => { l.state = 'ended'; live.delete(callId); l.subs.forEach((f) => f()); watchers.forEach((f) => f()); },
      onError: () => undefined,
    } });
    live.set(callId, l); return l;
  })().finally(() => making.delete(callId));
  making.set(callId, p); return p;
}

/** The calls someone at this tablet is on right now (taken over here), so the lane can show which car that is. */
export function useOnTheSpeakerHere(): string[] {
  const [, setTick] = useState(0);
  useEffect(() => { const f = () => setTick((n) => n + 1); watchers.add(f); return () => { watchers.delete(f); }; }, []);
  return Array.from(live.entries()).filter(([, l]) => l.state === 'taken_over').map(([id]) => id);
}

export function VoiceBar({ tenantId, screenKey, staffPass, carNumber, voice, publicKey, onNotice }: {
  tenantId: string; screenKey: string | null; staffPass: string | null; carNumber: string; voice: CarVoice; publicKey: string | null; onNotice: (text: string, tone: 'good' | 'warn') => void;
}) {
  const callId = voice?.callId || null;
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [telling, setTelling] = useState(false); const [said, setSaid] = useState('');
  ctxNow.current = { tenantId, key: screenKey, staffPass };
  const l = callId ? live.get(callId) : undefined;
  const state = l?.state || 'idle'; const lines = l?.lines || []; const muted = !!l?.muted;

  // One monitor per call, made as soon as the bar shows (it costs nothing until it's used), so a tap on Listen or Take
  // over reaches the call straight away: a browser lets sound and the microphone start only close to a tap.
  useEffect(() => {
    setTelling(false); setSaid('');
    if (!callId) return;
    const rerender = () => setTick((n) => n + 1);
    let gone = false;
    if (voice?.status === 'live' || voice?.status === 'taken_over') void liveFor(callId, publicKey).then((x) => { if (!gone) { x.subs.add(rerender); rerender(); } }).catch(() => undefined);
    return () => { gone = true; live.get(callId)?.subs.delete(rerender); };
  }, [callId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The call ended elsewhere (the guest drove off, the speaker, the service, another tablet hung up): let go of it here
  // too, even if someone here was on it. (Taking over isn't an end: the service's word for that is never kept as one.)
  useEffect(() => { if (callId && voice?.status === 'ended') drop(callId); }, [callId, voice?.status]);

  const session = async () => { if (!callId) throw new Error('No call'); return (await liveFor(callId, publicKey)).s; };
  const run = async (k: string, fn: () => Promise<void>, fail: string) => { setBusy(k); try { await fn(); } catch (e: any) { onNotice(/denied|permission|NotAllowed/i.test(String(e?.message || e)) ? 'This tablet isn’t allowed to use its microphone. Allow it in the browser’s settings.' : fail, 'warn'); } finally { setBusy(null); } };
  const listen = () => run('listen', async () => { const s = l?.s || await session(); await s.listen(); }, 'Couldn’t listen in. Try again.');
  const stopListening = () => { try { l?.s?.stopListening?.(); } catch { /* */ } };
  // Taking over: the microphone first (if it's refused, the assistant carries on), then the assistant stops.
  const takeOver = () => run('take', async () => { const s = l?.s || await session(); await s.takeOver(); onNotice(`You’re on the speaker with car ${carNumber}. The order so far is kept. Stay on this page until you hang up.`, 'good'); }, 'Couldn’t take over. The assistant is still on the call.');
  const tell = () => run('tell', async () => {
    const text = said.trim(); if (!text) return;
    const s = l?.s || await session(); await s.update({ call_control: { additional_context: text, trigger_response: true } });
    setSaid(''); setTelling(false); onNotice('The assistant has it.', 'good');
  }, 'That didn’t reach the assistant. Try again.');
  const hangUp = () => run('end', async () => {
    if (!callId) return;
    const s = l?.s || await session();
    if (state === 'taken_over' || voice?.status === 'taken_over') {
      // After taking over, ending here also ends the call at the speaker.
      const r = await fetch('/api/counter/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key: screenKey, ...(staffPass ? { staffPass } : {}), action: 'op', op: 'stop-call', callId }) });
      if (!r.ok) throw new Error('stop');
      drop(callId);
    } else { await s.end(); drop(callId); }
  }, 'Couldn’t hang up. Try again.');
  const toggleMute = () => { if (!l?.s) return; if (l.muted) l.s.unmute(); else l.s.mute(); l.muted = !l.muted; setTick((n) => n + 1); };

  if (!callId || !voice || !(['live', 'taken_over'].includes(String(voice.status)) || state === 'taken_over')) return null;
  const takenHere = state === 'taken_over';
  const takenElsewhere = voice.status === 'taken_over' && !takenHere;
  return (
    <section aria-label="Voice assistant" className="space-y-3 rounded-2xl p-4" style={{ background: takenHere ? GREEN_TINT : takenElsewhere ? AMBER_TINT : '#fff', border: `1px solid ${takenHere ? '#cfe8da' : takenElsewhere ? '#f3d9b8' : LINE}` }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">{!takenElsewhere && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: takenHere ? GREEN : INK }} />}<span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: takenHere ? GREEN : takenElsewhere ? AMBER : INK }} /></span>
          <p className="text-[15.5px] font-semibold" style={{ color: takenHere ? GREEN : takenElsewhere ? AMBER : INK }}>
            {takenHere ? `You’re on the speaker with car ${carNumber}` : takenElsewhere ? `${voice.takenOverBy || 'Someone'} took over this order` : state === 'listening' ? 'Listening in' : 'The assistant is taking this order'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!takenHere && !takenElsewhere && (state === 'listening'
            ? <button type="button" onClick={stopListening} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}><Headphones className="h-4 w-4" aria-hidden />Stop listening</button>
            : <button type="button" onClick={listen} disabled={busy !== null} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}><Headphones className="h-4 w-4" aria-hidden />{busy === 'listen' ? 'Connecting…' : 'Listen'}</button>)}
          {!takenHere && !takenElsewhere && <button type="button" onClick={takeOver} disabled={busy !== null} className={btn} style={{ background: INK, color: '#fff' }}><Mic className="h-4 w-4" aria-hidden />{busy === 'take' ? 'Taking over…' : 'Take over'}</button>}
          {takenHere && <button type="button" onClick={toggleMute} aria-pressed={muted} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}{muted ? 'Unmute' : 'Mute'}</button>}
          {!takenElsewhere && <button type="button" onClick={hangUp} disabled={busy !== null} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: RED }}><PhoneOff className="h-4 w-4" aria-hidden />Hang up</button>}
        </div>
      </div>
      {lines.length > 0 && (
        <ul className="space-y-1.5 rounded-xl px-3 py-2.5" style={{ background: takenHere || takenElsewhere ? '#fff' : SOFT }} aria-live="polite">
          {lines.map((l) => <li key={l.id} className="text-[14.5px] leading-snug" style={{ color: INK }}><span className="mr-2 text-[12.5px] font-semibold" style={{ color: l.who === 'guest' ? AMBER : GREEN }}>{l.who === 'guest' ? 'Guest' : 'Assistant'}</span>{l.text}</li>)}
        </ul>
      )}
      {!takenHere && !takenElsewhere && (telling ? (
        <form onSubmit={(e) => { e.preventDefault(); void tell(); }} className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="tell-assistant">Tell the assistant</label>
          <input id="tell-assistant" autoFocus value={said} onChange={(e) => setSaid(e.target.value.slice(0, 300))} placeholder="We’re out of shakes tonight" className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-[#fff] px-3 text-[15px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
          <button type="submit" disabled={!said.trim() || busy !== null} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'tell' ? 'Sending…' : 'Tell it'}</button>
          <button type="button" onClick={() => { setTelling(false); setSaid(''); }} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Cancel</button>
        </form>
      ) : <button type="button" onClick={() => setTelling(true)} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Tell the assistant something</button>)}
      {takenHere && <p className="text-[13.5px]" style={{ color: MUTED }}>Keep taking the order with the menu here. When you’re done, send it to the kitchen as usual.</p>}
    </section>
  );
}
