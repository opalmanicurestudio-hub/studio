'use client';
// src/components/documents/SignFlow.tsx — SIGNING A DOCUMENT (design canvas, "quick check, then sign"). If the document
// has a quick check, they answer it first; a wrong answer shows which part to read again and they try once more. If it
// asks for a signature, they draw it. The sign-off (acks/{staffId}) records the version, when, the check's score and the
// signature picture — what the training record and proof-of-training PDF show.
import * as React from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { cleanQuiz, gradeQuiz } from '@/lib/doc-blocks';
import { uploadImageBlob, dataUrlToBlob } from '@/lib/upload-image';
import { Ico, IC } from '@/components/documents/DocBlocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', RED = '#b42318';

export function SignaturePad({ onChange, caption }: { onChange: (d: string | null) => void; caption: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null); const drawing = React.useRef(false); const drawn = React.useRef(false); const [has, setHas] = React.useState(false);
  React.useEffect(() => { const c = ref.current; if (!c) return; const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr; const x = c.getContext('2d') as CanvasRenderingContext2D; x.scale(dpr, dpr); x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = INK; }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const x = ref.current!.getContext('2d') as CanvasRenderingContext2D; const p = pos(e); x.beginPath(); x.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const x = ref.current!.getContext('2d') as CanvasRenderingContext2D; const p = pos(e); x.lineTo(p.x, p.y); x.stroke(); drawn.current = true; if (!has) setHas(true); };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (drawn.current) onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; (c.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, c.width, c.height); drawn.current = false; setHas(false); onChange(null); };
  return <div className="rounded-[16px] border border-dashed bg-[#fbfbfc] p-2" style={{ borderColor: 'hsl(var(--border))' }}>
    <canvas ref={ref} aria-label="Draw your signature" className="h-32 w-full touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    <div className="flex items-center justify-between border-t px-1 pt-2 text-[12.5px]" style={{ borderColor: LINE, color: MUTED }}><span>{caption}</span>{has && <button type="button" onClick={clear} className="underline underline-offset-2">Clear</button>}</div>
  </div>;
}

export function SignFlow({ firestore, tenantId, d, staff, onDone, onBack, accent = INK }: { firestore: any; tenantId: string; d: any; staff: { id: string; name: string }; onDone: () => void; onBack: () => void; accent?: string }) {
  const quiz = cleanQuiz(d.quiz); const version = Number(d.version || 1); const needSig = d.requireSignature === true;
  const [picks, setPicks] = React.useState<Record<string, number>>({}); const [checked, setChecked] = React.useState<ReturnType<typeof gradeQuiz> | null>(null);
  const [sig, setSig] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const passed = !quiz.length || checked?.passed;
  const allPicked = quiz.every((x) => picks[x.id] !== undefined);
  const sign = async () => {
    if (needSig && !sig) { setErr('Draw your signature first.'); return; }
    setBusy(true); setErr('');
    try {
      let signatureUrl: string | null = null;
      if (sig) signatureUrl = await uploadImageBlob(`tenants/${tenantId}/evidence/signatures/${d.id}/${staff.id}_v${version}.png`, dataUrlToBlob(sig));
      await setDoc(doc(firestore, `tenants/${tenantId}/documents/${d.id}/acks/${staff.id}`), {
        id: staff.id, staffId: staff.id, staffName: staff.name || 'Team member', version, acknowledgedAt: new Date().toISOString(),
        ...(signatureUrl ? { signatureUrl } : {}), ...(quiz.length && checked ? { quiz: { right: checked.right, total: checked.total } } : {}),
      }, { merge: true });
      // Signing may finish a certification for a service — the server checks (lib/certification-server).
      void import('@/components/pay/pay-client').then(({ payPost }) => payPost('/api/certifications', { tenantId, action: 'evaluate' })).catch(() => { /* checked again later */ });
      onDone();
    } catch { setErr('That didn’t save. Check your connection and try again.'); }
    setBusy(false);
  };
  return (
    <div className="space-y-5" style={{ color: INK }}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[14px]" style={{ color: MUTED }}><Ico d={IC.back} s={16} />Back to the document</button>
      {quiz.length > 0 && !passed && <div className="space-y-4">
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>before you sign</p><h2 className="text-[26px] font-normal tracking-[-0.03em]">A quick check</h2>
          <p className="text-[14px]" style={{ color: MUTED }}>{quiz.length} question{quiz.length === 1 ? '' : 's'}. Get one wrong and you can read that part again.</p></div>
        {quiz.map((x) => { const wrong = checked?.wrong.includes(x.id);
          return <fieldset key={x.id} className="space-y-2"><legend className="mb-2 text-[15.5px] font-semibold">{x.q}</legend>
            {x.options.map((o, i) => { const on = picks[x.id] === i; return <button key={i} type="button" aria-pressed={on} onClick={() => { setPicks((p) => ({ ...p, [x.id]: i })); setChecked(null); }}
              className="flex min-h-12 w-full items-center justify-between rounded-[14px] px-3.5 text-left text-[14.5px]" style={on ? { border: `1.5px solid ${wrong ? RED : accent}`, background: wrong ? '#fdecec' : '#fff' } : { border: `1px solid ${LINE}`, background: 'hsl(var(--card))' }}>{o}{on && !wrong && <Ico d={IC.check} s={18} c={accent} w={2.4} />}</button>; })}
            {wrong && <p className="text-[13px]" style={{ color: RED }}>Not quite — have another look at the document, then try again.</p>}</fieldset>; })}
        <button type="button" disabled={!allPicked} onClick={() => setChecked(gradeQuiz(quiz, picks))} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Check my answers</button>
      </div>}
      {passed && <div className="space-y-4">
        {quiz.length > 0 && <p className="flex items-center gap-2 rounded-[14px] px-3.5 py-3 text-[14px] font-medium" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }}><Ico d={IC.check} s={16} c={GREEN} w={2.4} />{quiz.length === 1 ? 'That’s right.' : `All ${quiz.length} right.`}</p>}
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>{String(d.title || 'this document').toLowerCase()} · version {version}</p><h2 className="text-[26px] font-normal tracking-[-0.03em]">{needSig ? 'Sign' : 'Confirm'}</h2></div>
        {needSig ? <SignaturePad onChange={setSig} caption={`${staff.name} · I’ve read version ${version} and will follow it.`} /> : <p className="rounded-[14px] px-3.5 py-3 text-[14.5px]" style={{ background: 'hsl(var(--secondary))' }}>I’ve read version {version} and will follow it.</p>}
        {err && <p className="text-[13.5px]" style={{ color: RED }}>{err}</p>}
        <button type="button" disabled={busy || (needSig && !sig)} onClick={sign} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : needSig ? `Sign version ${version}` : `Confirm version ${version}`}</button>
      </div>}
    </div>);
}
