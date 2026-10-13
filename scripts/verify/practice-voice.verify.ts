// Practice a shift: hearing when you talk. Run: npx tsx scripts/verify/practice-voice.verify.ts
import * as V from '../../src/lib/practice/vad';
import * as P from '../../src/lib/practice/voices';
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

console.log('Choosing voices');
{ const vs: P.VoiceOpt[] = [
    { id: 'a', name: 'Ann', gender: 'female', age: 'young', accent: 'american', description: '', preview: null, src: 'eleven' },
    { id: 'b', name: 'Bea', gender: 'female', age: 'middle aged', accent: 'british', description: '', preview: null, src: 'eleven' },
    { id: 'c', name: 'Cat', gender: 'female', age: 'young', accent: 'australian', description: '', preview: null, src: 'eleven' },
    { id: 'd', name: 'Dev', gender: 'male', age: 'young', accent: 'indian', description: '', preview: null, src: 'eleven' },
    { id: 'e', name: 'Eli', gender: 'male', age: 'old', accent: 'american', description: '', preview: null, src: 'eleven' },
    { id: 'f', name: 'Fay', gender: 'female', age: 'old', accent: 'irish', description: '', preview: null, src: 'eleven' }];
  const people: P.Person[] = [{ id: 'rosa', name: 'Rosa', voiceHint: { gender: 'female', age: 'middle_aged' } }, { id: 'ava', name: 'Ava', voiceHint: { gender: 'female', age: 'young' } }, { id: 'tom', name: 'Tom', voiceHint: { gender: 'male', age: 'old' } }, { id: 'kim', name: 'Kim', voiceHint: { gender: 'female', age: 'young' } }];
  const m = P.autoPick(people, vs, 'matched'); check('matched: men get men’s voices, women get women’s', m.tom.id === 'e' || m.tom.id === 'd'); check('matched: nobody shares a voice when there are enough', new Set(Object.values(m).map((x) => x.id)).size === 4, m);
  const a = P.autoPick(people, vs, 'accents'); const acc = new Set(Object.values(a).map((x) => P.accentKey(vs.find((v) => v.id === x.id)!.accent))); check('mix of accents: four people, four accents', acc.size === 4, a);
  const ch = P.autoPick(people, vs, 'challenge'); check('challenge: most people talk fast', Object.values(ch).filter((x) => x.speed > 1).length >= 2, ch);
  const cl = P.autoPick(people, vs, 'clear'); check('clear and slow: a relaxed pace', Object.values(cl).every((x) => x.speed < 1)); }
{ const b = P.browserVoices([{ name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'g1' }, { name: 'Microsoft Ravi - English (India)', lang: 'en-IN', voiceURI: 'm1' }, { name: 'Thomas', lang: 'fr-FR', voiceURI: 'x' }]);
  check('the device’s voices are labeled by accent', b.length === 2 && b[0].accent === 'British' && b[1].accent === 'Indian' && b[1].gender === 'male', b); }

console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
