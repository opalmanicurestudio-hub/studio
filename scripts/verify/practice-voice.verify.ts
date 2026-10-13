// Practice a shift: hearing when you talk. Run: npx tsx scripts/verify/practice-voice.verify.ts
import * as V from '../../src/lib/practice/vad';
let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` (${JSON.stringify(info)})`}`); if (!ok) fails++; };
const STEP = 128; // ms per slice, like the mic
const run = (segs: [number, number][], client = false) => { const st = V.newVad(); const ev: { at: number; e: string }[] = []; let t = 0;
  for (const [level, ms] of segs) for (let x = 0; x < ms; x += STEP) { const e = V.vadStep(st, level, STEP, V.VAD_DEFAULTS, client); if (e) ev.push({ at: t, e }); t += STEP; }
  return ev; };

console.log('Hearing when you start and stop');
{ const ev = run([[0.003, 1500], [0.08, 1400], [0.004, 1200]]); check('a sentence = one start and one end', ev.map((x) => x.e).join() === 'start,end', ev);
  check('the end comes after a short pause, not instantly', ev[1] && ev[1].at - 2900 >= 700 && ev[1].at - 2900 <= 1100, ev); }
{ const ev = run([[0.003, 1500], [0.08, 900], [0.005, 400], [0.08, 900], [0.004, 1200]]); check('a short breath mid-sentence doesn’t end your turn', ev.map((x) => x.e).join() === 'start,end', ev); }
{ const ev = run([[0.003, 1500], [0.03, 2000], [0.004, 1200]]); check('a soft voice still counts', ev.map((x) => x.e).join() === 'start,end', ev); }
{ const ev = run([[0.003, 1500], [0.2, 100], [0.003, 1500]]); check('a click or tap is ignored', ev.length === 0, ev); }
{ const ev = run([[0.003, 1500], [0.08, 200], [0.003, 1500]]); check('a cough is dropped, not sent', ev.map((x) => x.e).join() === 'start,drop', ev); }
{ const ev = run([[0.02, 3000], [0.02, 3000]]); check('steady background noise (a fan, music) is learned and ignored', ev.length === 0, ev); }
{ const ev = run([[0.003, 1000], [0.08, 20000]]); check('a very long turn is cut off and sent', ev.some((x) => x.e === 'end'), ev); }
{ const ev = run([[0.003, 1000], [0.06, 45000]]); check('sound that never stops becomes background (no endless turns)', ev.filter((x) => x.e === 'start').length <= 2, ev); }

console.log('Cutting in while the client talks');
{ const ev = run([[0.003, 1500], [0.035, 2000], [0.003, 1000]], true); check('the client’s voice through the speakers doesn’t count as you', ev.length === 0, ev); }
{ const ev = run([[0.003, 1500], [0.15, 1200], [0.003, 1200]], true); check('you, clearly talking, cut in', ev[0]?.e === 'start', ev); }

console.log('Packing the recording');
{ const w = V.encodeWav(new Float32Array(16000)); check('one second of speech is a small WAV (32 KB)', w.length === 44 + 32000 && String.fromCharCode(...w.slice(0, 4)) === 'RIFF' && String.fromCharCode(...w.slice(8, 12)) === 'WAVE'); }
check('48 kHz becomes 16 kHz', V.downsample(new Float32Array(4800), 48000).length === 1600);
{ const n = V.normalize(Float32Array.from([0.05, -0.1, 0.02])); check('a quiet recording is lifted', Math.abs(Math.max(...n.map(Math.abs)) - 0.6) < 1e-6, Array.from(n)); }
check('a loud recording is left alone', V.normalize(Float32Array.from([0.9, -0.2]))[0] === Float32Array.from([0.9])[0]);

console.log('Telling your voice from the client’s');
check('hearing the client’s own line back is caught', V.isEcho('it was perfect thank you so much', 'Oh, it was perfect, thank you so much!'));
check('you repeating one word of theirs is fine', !V.isEcho('Perfect! Would you like to book your next visit?', 'Oh, it was perfect, thank you so much!'));
check('a normal reply is fine', !V.isEcho('Welcome back Rosa, how was your manicure?', 'Hi! Just this cuticle oil too, please.'));
check('no client line yet = never an echo', !V.isEcho('hello there', null));

console.log('Plain-word errors');
check('a blocked mic says how to allow it', /allow the microphone/.test(V.listenError('not-allowed') || ''));
check('a browser without speech-to-text says what to use', /Chrome or Safari/.test(V.listenError('network') || ''));
check('silence isn’t an error', V.listenError('no-speech') === null);

console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
