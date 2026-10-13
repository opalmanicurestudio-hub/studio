// Practice a shift, talking out loud: the microphone, in the browser.
// The mic stays open while talking practice is on, so the first word is never cut off: we always keep
// the last half second, and when you start talking it becomes the start of your recording.
// Hands-free: it hears when you start and stop. Hold to talk: you decide. Nothing is stored.
import { RATE, VAD_DEFAULTS, type VadOpts, downsample, encodeWav, newVad, normalize, rms, vadStep } from './vad';

export type MicHandlers = {
  /** About 20 times a second: how loud you are (0–1) and the level that counts as talking. */
  onLevel?: (level: number) => void;
  /** You started talking (hands-free), or cut in while the client was talking. */
  onStart?: (bargeIn: boolean) => void;
  /** Your turn is over: a small WAV recording and how long you spoke. */
  onUtterance?: (wav: Blob, seconds: number) => void;
  /** It was only a noise. */
  onDrop?: () => void;
};
const PREROLL_MS = 500;

export class Mic {
  handsFree = true;
  /** While the client is answering or thinking, new talking is ignored (except cutting in). */
  paused = false;
  /** The client's voice is playing: you need to be clearly louder to cut in. */
  clientTalking = false;
  /** Only report levels and cutting in, don't record (used when the browser does the listening). */
  levelOnly = false;
  opts: VadOpts = { ...VAD_DEFAULTS };
  private stream: MediaStream | null = null; private ctx: AudioContext | null = null; private proc: ScriptProcessorNode | null = null; private src: MediaStreamAudioSourceNode | null = null;
  private pre: Float32Array[] = []; private preLen = 0; private take: Float32Array[] | null = null; private pushing = false; private pushTalked = 0;
  private vad = newVad();
  deviceId: string | null = null;
  constructor(private h: () => MicHandlers) {}
  get open() { return !!this.stream; }

  async start(deviceId?: string | null) {
    if (this.stream && (deviceId ?? null) === this.deviceId) { await this.ctx?.resume().catch(() => {}); return; }
    this.stop();
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio }); this.deviceId = deviceId ?? null;
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC(); await this.ctx.resume().catch(() => {});
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    const silent = this.ctx.createGain(); silent.gain.value = 0;
    this.src.connect(this.proc); this.proc.connect(silent); silent.connect(this.ctx.destination);
    this.vad = newVad();
    this.proc.onaudioprocess = (e) => this.chunk(downsample(e.inputBuffer.getChannelData(0), this.ctx!.sampleRate));
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop());
  }
  stop() {
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch { /* already */ }
    this.stream?.getTracks().forEach((t) => t.stop()); this.ctx?.close().catch(() => {});
    this.stream = null; this.ctx = null; this.proc = null; this.src = null; this.take = null; this.pushing = false; this.pre = []; this.preLen = 0;
  }
  /** Hold to talk: start keeping what you say, including the half second before you pressed. */
  pushStart() { this.pushing = true; this.pushTalked = 0; this.take = [...this.pre]; }
  pushStop() {
    if (!this.pushing) return; this.pushing = false;
    if (this.pushTalked >= this.opts.minSpeechMs * 0.6) this.finish(); else { this.take = null; this.h().onDrop?.(); }
  }
  static async mics(): Promise<{ id: string; label: string }[]> {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })); } catch { return []; }
  }

  private chunk(x: Float32Array) {
    const ms = (x.length / RATE) * 1000; const level = rms(x); const h = this.h();
    h.onLevel?.(level);
    this.pre.push(x); this.preLen += ms; while (this.pre.length > 1 && this.preLen - (this.pre[0].length / RATE) * 1000 >= PREROLL_MS) { this.preLen -= (this.pre[0].length / RATE) * 1000; this.pre.shift(); }
    if (this.pushing) { this.take?.push(x); if (level > Math.max(this.opts.floorMin, this.vad.noise * this.opts.ratio)) this.pushTalked += ms; return; }
    if (!this.handsFree && !this.clientTalking) { vadStep(this.vad, level, ms, this.opts, false); return; } // keep learning the room
    const ev = vadStep(this.vad, level, ms, this.opts, this.clientTalking);
    if (ev === 'start') {
      const barge = this.clientTalking; h.onStart?.(barge);
      if (this.levelOnly || (this.paused && !barge) || !this.handsFree) { this.take = null; return; }
      this.take = [...this.pre]; return;
    }
    if (this.take && this.vad.phase !== 'quiet') { this.take.push(x); return; }
    if (ev === 'end' && this.take) this.finish(this.opts.endMs);
    else if (ev === 'drop') { this.take = null; h.onDrop?.(); }
  }
  private finish(trailingMs = 0) {
    const parts = this.take; this.take = null; if (!parts?.length) return;
    let n = 0; parts.forEach((p) => (n += p.length)); const all = new Float32Array(n); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
    const wav = encodeWav(normalize(all)); // Speaking time for the coach's pace check: without the lead-in we kept and the closing pause.
    this.h().onUtterance?.(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }), Math.max(0.3, n / RATE - PREROLL_MS / 1000 - trailingMs / 1000));
  }
}

/** The browser's own speech-to-text, kept running for hands-free talking. Used when real listening isn't connected. */
export class BrowserEars {
  private r: any = null; private want = false; private finals: string[] = []; private t0 = 0;
  constructor(private h: () => { onInterim?: (t: string) => void; onFinal?: (t: string, secs: number) => void; onError?: (code: string) => void }) {}
  static available() { return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition); }
  /** Hands-free: keep listening, one sentence at a time. */
  listen() { this.want = true; this.boot(); }
  /** Stop for now (the client is talking, or you're done). */
  pause() { this.want = false; try { this.r?.abort(); } catch { /* none */ } this.r = null; }
  /** Hold to talk: collect everything until release. */
  hold() { this.want = false; this.finals = []; this.boot(true); }
  release() { const r = this.r; if (!r) return; this.r = null; r.onend = () => { const t = this.finals.join(' ').trim(); this.finals = []; if (t) this.h().onFinal?.(t, (performance.now() - this.t0) / 1000); }; try { r.stop(); } catch { /* none */ } }
  private boot(holding = false) {
    if (this.r) return; const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return;
    const r = new SR(); this.r = r; r.lang = 'en-US'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1; this.t0 = performance.now();
    let last = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = String(e.results[i][0]?.transcript || '');
        if (e.results[i].isFinal) {
          if (holding) this.finals.push(t);
          else if (t.trim()) { this.h().onInterim?.(''); this.h().onFinal?.(t.trim(), (performance.now() - this.t0) / 1000); this.t0 = performance.now(); }
        } else interim += t;
      }
      if (interim !== last) { last = interim; if (interim && !holding) { /* restart the clock at the first sound */ } this.h().onInterim?.(holding ? [...this.finals, interim].join(' ') : interim); }
    };
    r.onerror = (e: any) => { const code = String(e?.error || ''); if (code !== 'no-speech' && code !== 'aborted') { this.want = false; this.h().onError?.(code); } };
    r.onend = () => { if (this.r === r) this.r = null; if (this.want) window.setTimeout(() => { if (this.want) this.boot(); }, 120); };
    try { r.start(); } catch { this.r = null; }
  }
}
