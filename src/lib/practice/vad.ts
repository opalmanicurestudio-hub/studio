// Practice a shift, talking out loud: the pure parts of listening.
// Hearing when you start and stop talking, packing your words into a small recording, and
// telling your own voice apart from the client's voice coming back through the speakers.

export const RATE = 16000; // what the listening service needs; small uploads, fast replies

/** Mix to mono and resample to 16 kHz (simple averaging; plenty for speech). */
export function downsample(input: Float32Array, fromRate: number, toRate = RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate; const n = Math.floor(input.length / ratio); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio)); let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = b > a ? sum / (b - a) : input[a] || 0;
  }
  return out;
}
export function rms(frame: Float32Array): number { let s = 0; for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i]; return frame.length ? Math.sqrt(s / frame.length) : 0; }

export type VadOpts = {
  /** How long a pause ends your turn. Shorter = snappier, longer = room to think mid-sentence. */
  endMs: number;
  /** How long sound must last to count as talking (ignores clicks and coughs). */
  startMs: number;
  /** Talking shorter than this is ignored. */
  minSpeechMs: number;
  /** A turn is cut off after this long. */
  maxMs: number;
  /** How far above the room's background noise counts as talking. */
  ratio: number;
  /** The quietest level that ever counts as talking. */
  floorMin: number;
  /** When the client is talking, you must be this much louder to cut in (their voice comes back through the speakers). */
  bargeRatio: number;
};
export const VAD_DEFAULTS: VadOpts = { endMs: 850, startMs: 140, minSpeechMs: 300, maxMs: 15000, ratio: 3, floorMin: 0.012, bargeRatio: 3.5 };

export type VadState = { phase: 'quiet' | 'maybe' | 'talking' | 'trailing'; noise: number; above: number; below: number; talked: number; total: number; peak: number; age: number };
export const newVad = (): VadState => ({ phase: 'quiet', noise: 0.004, above: 0, below: 0, talked: 0, total: 0, peak: 0, age: 0 });
const WARMUP_MS = 600;
export type VadEvent = 'start' | 'end' | 'drop' | null;

/**
 * One step of turn-taking. Feed the level of each small slice of sound.
 * 'start' = you began talking (keep the half second before it), 'end' = your turn is over (send it),
 * 'drop' = it was just a noise.
 */
export function vadStep(st: VadState, level: number, ms: number, o: VadOpts = VAD_DEFAULTS, clientTalking = false): VadEvent {
  // The first moment after the mic opens: just learn how loud the room is.
  if (st.age < WARMUP_MS) { st.age += ms; st.noise = st.age <= ms ? Math.min(level, 0.2) : st.noise * 0.7 + Math.min(level, 0.2) * 0.3; return null; }
  const gate = Math.max(o.floorMin, st.noise * o.ratio) * (clientTalking ? o.bargeRatio : 1);
  const startMs = clientTalking ? o.startMs * 2 : o.startMs;
  const loud = level > gate;
  if (st.phase === 'quiet' || st.phase === 'maybe') {
    // Learn the room: the background level drifts slowly toward what we hear when nobody is talking.
    if (!loud) st.noise = st.noise * 0.97 + Math.min(level, 0.2) * 0.03;
    if (loud) {
      st.above += ms; st.phase = 'maybe';
      if (st.above >= startMs) { st.phase = 'talking'; st.talked = st.above; st.total = st.above; st.below = 0; st.peak = level; return 'start'; }
    } else { st.above = 0; st.phase = 'quiet'; }
    return null;
  }
  st.total += ms; st.peak = Math.max(st.peak, level);
  // While you're mid-sentence, a softer level still counts (people trail off at the end of words).
  const keep = level > Math.max(o.floorMin * 0.7, st.noise * o.ratio * 0.6);
  if (keep) { st.talked += ms; st.below = 0; st.phase = 'talking'; } else { st.below += ms; st.phase = 'trailing'; }
  if (st.total >= o.maxMs || st.below >= o.endMs) {
    // Sound that never stops (music, a hair dryer) becomes the new background.
    if (st.total >= o.maxMs && st.below < o.endMs) st.noise = Math.max(st.noise, Math.min(level, 0.2) * 0.6);
    const enough = st.talked >= o.minSpeechMs; st.phase = 'quiet'; st.above = 0; st.below = 0; st.talked = 0; st.total = 0;
    return enough ? 'end' : 'drop';
  }
  return null;
}

/** 16-bit PCM WAV: a format every listening service accepts. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Uint8Array(buf);
}

/** Lift a quiet recording so soft speakers are still understood (never clips). */
export function normalize(samples: Float32Array, target = 0.6): Float32Array {
  let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4 || peak >= target) return samples;
  const g = Math.min(8, target / peak); const out = new Float32Array(samples.length); for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g; return out;
}

const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
/**
 * Did the mic just hear the client's own voice from the speakers? True when most of what was heard
 * is a run of the client's last line.
 */
export function isEcho(heard: string, clientLine: string | null | undefined): boolean {
  if (!clientLine) return false; const h = words(heard), c = words(clientLine); if (h.length < 2 || !c.length) return false;
  const pairs = (a: string[]) => new Set(a.slice(0, -1).map((x, i) => `${x} ${a[i + 1]}`));
  const hp = pairs(h), cp = pairs(c); let shared = 0; hp.forEach((p) => { if (cp.has(p)) shared++; });
  return hp.size > 0 && shared / hp.size >= 0.6;
}

/** What to tell someone when listening fails, in plain words. */
export function listenError(code: string): string | null {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': case 'NotAllowedError': case 'SecurityError':
      return 'The microphone is blocked. Click the lock icon by the address, allow the microphone, then try again.';
    case 'audio-capture': case 'NotFoundError': case 'OverconstrainedError':
      return 'No microphone found. Plug in your headset or pick another mic below.';
    case 'NotReadableError': return 'Another app is using the microphone. Close it, then try again.';
    case 'network': return 'This browser can’t turn speech into text on its own. Use Chrome or Safari, or ask your admin to connect real listening.';
    case 'no-speech': case 'aborted': return null;
    default: return 'Didn’t catch that. Try again, or type it.';
  }
}
