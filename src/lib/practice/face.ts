'use client';
// Practice a shift: a live, photo-real face for the client at the desk (face-to-face mode).
// The face service only renders: what the client says still comes from our client brain, and how it sounds
// still comes from the business's voice account. We stream that voice in, and the face lip-syncs to it.
// One session per client at the desk, closed when they leave, so only face-to-face minutes are used.

type Client = {
  streamToVideoElement: (id: string) => Promise<void>; stopStreaming: () => Promise<void>; interruptPersona: () => void;
  createAgentAudioInputStream: (c: { encoding: 'pcm_s16le'; sampleRate: number; channels: number }) => { sendAudioChunk: (d: Uint8Array) => void; endSequence: () => void };
  addListener: (e: string, cb: (...a: unknown[]) => void) => void;
};
export type FaceState = 'off' | 'connecting' | 'live' | 'error';
const RATE = 16000; // the voice is requested as 16-bit, 16 kHz mono PCM, which is what the face expects

export class LiveFace {
  state: FaceState = 'off'; who: string | null = null; error: string | null = null; lastUsed = 0; videoStarted = false;
  private client: Client | null = null; private input: ReturnType<Client['createAgentAudioInputStream']> | null = null; private reader: ReadableStreamDefaultReader<Uint8Array> | null = null; private gen = 0;
  constructor(private onChange: () => void) {}
  private set(s: FaceState, err: string | null = null) { this.state = s; this.error = err; this.onChange(); }

  /** Connect a face for this client. `token` comes from our server, so the face account's key never reaches the browser. */
  async start(who: string, videoId: string, getToken: () => Promise<{ ok: boolean; sessionToken?: string; error?: string }>) {
    if (this.who === who && (this.state === 'live' || this.state === 'connecting')) return;
    await this.stop(); const gen = ++this.gen; this.who = who; this.videoStarted = false; this.set('connecting');
    try {
      const t = await getToken(); if (gen !== this.gen) return;
      if (!t.ok || !t.sessionToken) { this.set('error', t.error || 'The live video didn’t start.'); return; }
      const sdk: any = await import('@anam-ai/js-sdk'); if (gen !== this.gen) return;
      const c: Client = sdk.createClient(t.sessionToken, { disableInputAudio: true });
      this.client = c;
      c.addListener('CONNECTION_CLOSED', () => { if (gen === this.gen && this.state !== 'off') { this.input = null; this.set('off'); } });
      c.addListener('VIDEO_PLAY_STARTED', () => { this.videoStarted = true; this.onChange(); });
      await c.streamToVideoElement(videoId); if (gen !== this.gen) { c.stopStreaming().catch(() => {}); return; }
      this.input = c.createAgentAudioInputStream({ encoding: 'pcm_s16le', sampleRate: RATE, channels: 1 });
      this.lastUsed = Date.now(); this.set('live');
    } catch (e: any) { if (gen === this.gen) this.set('error', String(e?.message || 'The live video didn’t connect.').slice(0, 160)); }
  }
  /** The client speaks: stream the voice in as it arrives. Resolves with how long the speech lasts (ms). */
  async say(body: ReadableStream<Uint8Array>): Promise<number> {
    const input = this.input; if (!input) return 0; this.lastUsed = Date.now();
    this.reader?.cancel().catch(() => {}); const reader = body.getReader(); this.reader = reader;
    let bytes = 0; let carry: Uint8Array | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break; if (!value?.length) continue;
        let chunk = value; if (carry) { const m = new Uint8Array(carry.length + value.length); m.set(carry); m.set(value, carry.length); chunk = m; carry = null; }
        // 16-bit samples: keep an odd trailing byte for the next chunk.
        if (chunk.length % 2) { carry = chunk.slice(chunk.length - 1); chunk = chunk.slice(0, chunk.length - 1); }
        if (chunk.length) { input.sendAudioChunk(chunk); bytes += chunk.length; }
      }
    } catch { /* interrupted */ }
    if (this.reader === reader) { this.reader = null; try { input.endSequence(); } catch { /* closed */ } }
    return (bytes / 2 / RATE) * 1000;
  }
  /** Stop talking right away (you cut in). */
  interrupt() { this.reader?.cancel().catch(() => {}); this.reader = null; try { this.input?.endSequence(); this.client?.interruptPersona(); } catch { /* closed */ } }
  async stop() {
    this.gen++; this.interrupt(); const c = this.client; this.client = null; this.input = null; this.who = null;
    if (c) await c.stopStreaming().catch(() => {});
    if (this.state !== 'off') this.set('off');
  }
}
