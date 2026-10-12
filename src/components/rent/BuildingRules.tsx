'use client';
// src/components/rent/BuildingRules.tsx — PART 6, the renter's side (design canvas row 26, "sign the building rules").
// The studio's rules for everyone in the building: what's new or changed comes first; open one to read it, answer the
// quick check if there is one, and sign (or confirm). Signed ones stay here to look back at. /api/portal/renter-rules.
import * as React from 'react';
import { DocBlocks, Ico, IC } from '@/components/documents/DocBlocks';
import { SignaturePad } from '@/components/documents/SignFlow';
import { cleanQuiz, gradeQuiz } from '@/lib/doc-blocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const post = (body: any) => fetch('/api/portal/renter-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
const day = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

export function BuildingRules({ tenantId, token, name }: { tenantId: string; token: string; name?: string | null }) {
  const [rules, setRules] = React.useState<any[] | null>(null); const [open, setOpen] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => post({ tenantId, token, action: 'list' }).then((r) => { if (r.ok) setRules(r.rules || []); else setErr(r.error || 'Couldn’t load the building rules.'); }), [tenantId, token]);
  React.useEffect(() => { void load(); }, [load]);
  if (rules === null) return err ? <p className="text-[13.5px]" style={{ color: RED }}>{err}</p> : null;
  if (!rules.length) return null;
  if (open) return <RuleView tenantId={tenantId} token={token} rule={open} name={name || ''} onBack={() => setOpen(null)} onSigned={() => { setOpen(null); void load(); }} />;
  const todo = rules.filter((r) => r.state !== 'signed').length;
  const chip = (r: any) => r.state === 'signed' ? { t: `Signed v${r.version}`, bg: '#e9f3ed', fg: GREEN } : r.state === 'resign' ? { t: `Sign v${r.version}`, bg: '#fdf3e6', fg: AMBER } : { t: 'To sign', bg: '#fdecec', fg: RED };
  return (
    <section className="space-y-3" style={{ color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }} aria-label="Building rules">
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>from the studio</p><h2 className="text-[24px] font-light tracking-[-0.02em]">Building rules{todo ? ` · ${todo} to sign` : ''}</h2></div>
      <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
        {rules.map((r, i) => { const c = chip(r); return (
          <button key={r.id} type="button" onClick={() => setOpen(r)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: '#f6e6ec' }}><Ico d={'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'} s={18} c="#a14d6b" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.title}</span>
              <span className="block text-[12.5px]" style={{ color: MUTED }}>{r.state === 'signed' ? `Signed ${day(r.signedAt)}` : r.state === 'resign' ? `Updated — you signed v${r.signedVersion}` : 'New'}{r.state !== 'signed' && r.signBy ? ` · sign by ${day(r.signBy)}` : ''}</span></span>
            <span className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: c.bg, color: c.fg }}>{c.t}</span>
          </button>); })}
      </div>
    </section>);
}

function RuleView({ tenantId, token, rule, name, onBack, onSigned }: { tenantId: string; token: string; rule: any; name: string; onBack: () => void; onSigned: () => void }) {
  const quiz = cleanQuiz(rule.quiz); const [picks, setPicks] = React.useState<Record<string, number>>({}); const [checked, setChecked] = React.useState<ReturnType<typeof gradeQuiz> | null>(null);
  const [agree, setAgree] = React.useState(false); const [sig, setSig] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const passed = !quiz.length || !!checked?.passed; const needSig = rule.requireSignature === true;
  const sign = async () => { setBusy(true); setErr(''); const r = await post({ tenantId, token, action: 'sign', documentId: rule.id, signature: sig, quiz: quiz.length && checked ? { right: checked.right, total: checked.total } : null }); setBusy(false); if (r.ok) onSigned(); else setErr(r.error || 'That didn’t save — try again.'); };
  return (
    <section className="space-y-4" style={{ color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }} aria-label={rule.title}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[14px]" style={{ color: MUTED }}><Ico d={IC.back} s={16} />Building rules</button>
      <div><p className="text-[13px]" style={{ color: MUTED }}>From the studio · version {rule.version}{rule.state === 'signed' ? ` · you signed ${day(rule.signedAt)}` : rule.signBy ? ` · sign by ${day(rule.signBy)}` : ''}</p>
        <h2 className="text-[26px] font-light leading-tight tracking-[-0.03em]">{rule.title}</h2></div>
      {rule.state === 'resign' && rule.changeNote && <div className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}><b>What changed in v{rule.version}:</b> {rule.changeNote}</div>}
      <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><DocBlocks sections={rule.sections} /></div>
      {rule.state !== 'signed' && <>
        {quiz.length > 0 && !passed && <div className="space-y-3">
          <p className="text-[17px] font-semibold">A quick check before you sign</p>
          {quiz.map((x) => { const wrong = checked?.wrong.includes(x.id); return <fieldset key={x.id} className="space-y-2"><legend className="mb-2 text-[15px] font-semibold">{x.q}</legend>
            {x.options.map((o, i) => { const on = picks[x.id] === i; return <button key={i} type="button" aria-pressed={on} onClick={() => { setPicks((p) => ({ ...p, [x.id]: i })); setChecked(null); }} className="flex min-h-12 w-full items-center rounded-[14px] px-3.5 text-left text-[14.5px]" style={on ? { border: `1.5px solid ${wrong ? RED : INK}`, background: wrong ? '#fdecec' : '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>{o}</button>; })}
            {wrong && <p className="text-[13px]" style={{ color: RED }}>Not quite — have another look above, then try again.</p>}</fieldset>; })}
          <button type="button" disabled={!quiz.every((x) => picks[x.id] !== undefined)} onClick={() => setChecked(gradeQuiz(quiz, picks))} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Check my answers</button>
        </div>}
        {passed && <div className="space-y-3">
          <label className="flex items-center gap-3 rounded-[14px] px-3.5 py-3 text-[14.5px]" style={{ background: SOFT }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-5 w-5" />I’ve read version {rule.version} and I agree to follow it</label>
          {needSig && <SignaturePad onChange={setSig} caption={`${name || 'Your signature'} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`} />}
          {err && <p className="text-[13.5px]" style={{ color: RED }}>{err}</p>}
          <button type="button" disabled={busy || !agree || (needSig && !sig)} onClick={sign} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : needSig ? 'Sign' : 'Confirm'}</button>
        </div>}
      </>}
      {rule.state === 'signed' && <p className="flex items-center gap-2 rounded-[14px] px-3.5 py-3 text-[14px]" style={{ background: '#e9f3ed', color: GREEN }}><Ico d={IC.check} s={16} c={GREEN} w={2.4} />You signed version {rule.version} on {day(rule.signedAt)}.</p>}
    </section>);
}
