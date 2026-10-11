'use client';
// src/components/documents/Certification.tsx — DOCUMENTS → CERTIFICATION (approved design, canvas row 23 "Certified for
// a service"). The business's choice for people who aren't certified (show a warning, or don't let them be booked);
// then each service: whether it needs certification, what it takes (documents to sign, a manager watching one, how
// long it lasts), who's certified, and where everyone else is up to — with sign-off, mark-as-certified, renew and remove.
// Everything goes through /api/certifications (lib/certification).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { isCurrent, renewSoon, certId, RENEW_CHOICES } from '@/lib/certification';
import { Ico, IC } from '@/components/documents/DocBlocks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const card = 'rounded-[18px] border bg-white';
const day = (iso?: string | null) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const RENEW_LABEL: Record<number, string> = { 0: 'Lasts for good', 6: 'Renew every 6 months', 12: 'Renew every year', 24: 'Renew every 2 years' };
const pill = (bg: string, fg: string) => ({ background: bg, color: fg });

export function Certification({ tenantId, docs, onOpenDoc }: { tenantId: string; docs: any[]; onOpenDoc: (id: string) => void }) {
  const [data, setData] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [open, setOpen] = React.useState('');
  const load = React.useCallback(async () => { const r = await payPost('/api/certifications', { tenantId, action: 'list' }); if (r.ok) setData(r); else setErr(r.error || 'That didn’t load.'); }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  const call = async (body: any) => { setErr(''); const r = await payPost('/api/certifications', { tenantId, ...body }); if (!r.ok) setErr(r.error || 'That didn’t work.'); await load(); return r; };
  if (!data) return <p className="text-[14px]" style={{ color: err ? RED : MUTED }}>{err || 'Loading…'}</p>;
  const published = docs.filter((d) => d.status === 'published').sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const needed = data.services.filter((s: any) => s.rule.required);
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className={`${card} flex flex-wrap items-center gap-4 p-4 md:p-5`} style={{ borderColor: LINE }}>
        <div className="min-w-[240px] flex-1"><p className="text-[15px] font-bold">When someone isn’t certified</p>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{data.mode === 'block' ? 'They’re left off the booking page, the desk and walk-ins for that service until they’re certified. Renters make their own choice.' : 'They can still be booked. The desk sees a warning when booking them.'}</p></div>
        <div className="flex w-full rounded-full p-1 sm:w-auto" style={{ background: SOFT }}>{([['warn', 'Show a warning'], ['block', 'Block booking']] as const).map(([m, l]) =>
          <button key={m} type="button" disabled={!data.canSettings} aria-pressed={data.mode === m} onClick={() => data.mode !== m && call({ action: 'mode', mode: m })} className="h-10 flex-1 whitespace-nowrap rounded-full px-4 text-[13.5px] font-semibold disabled:cursor-not-allowed" style={data.mode === m ? { background: INK, color: '#fff' } : { color: INK }}>{l}</button>)}</div>
        {!data.canSettings && <p className="w-full text-[12.5px]" style={{ color: MUTED }}>Only someone who can change business settings can switch this.</p>}
      </div>
      {err && <p className="text-[13.5px] font-medium" style={{ color: RED }}>{err}</p>}
      <div className={`${card} overflow-hidden`} style={{ borderColor: LINE }}>
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-5" style={{ borderColor: LINE }}><p className="text-[15px] font-bold">Services</p><p className="text-[13px]" style={{ color: MUTED }}>{needed.length} need certification</p></div>
        {!data.services.length ? <p className="p-5 text-[14px]" style={{ color: MUTED }}>Add services first.</p> : data.services.map((s: any, i: number) => {
          const certified = data.recs.filter((r: any) => r.serviceId === s.id && isCurrent(r, data.today)); const working = s.rule.required ? data.staff.length - certified.length : 0;
          return <div key={s.id} style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <button type="button" onClick={() => setOpen(open === s.id ? '' : s.id)} aria-expanded={open === s.id} className="flex w-full items-center gap-3 px-4 py-3.5 text-left md:px-5">
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{s.name}</span>
                <span className="block text-[12.5px]" style={{ color: MUTED }}>{s.rule.required ? `${certified.length} certified${working ? ` · ${working} not yet` : ''}${s.rule.renewMonths ? ` · ${RENEW_LABEL[s.rule.renewMonths].toLowerCase()}` : ''}` : 'Anyone on the team can do it'}</span></span>
              {s.rule.required ? <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={pill('#e9f3ed', GREEN)}>Needs certification</span> : <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px]" style={pill(SOFT, MUTED)}>Open to all</span>}
              <span className="text-[16px]" style={{ color: MUTED }}>{open === s.id ? '–' : '+'}</span></button>
            {open === s.id && <ServiceCert s={s} data={data} published={published} call={call} onOpenDoc={onOpenDoc} />}
          </div>; })}
      </div>
    </div>);
}

function ServiceCert({ s, data, published, call, onOpenDoc }: { s: any; data: any; published: any[]; call: (b: any) => Promise<any>; onOpenDoc: (id: string) => void }) {
  const [rule, setRule] = React.useState<any>(s.rule); const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setRule(s.rule), [s.rule]);
  const dirty = JSON.stringify(rule) !== JSON.stringify(s.rule);
  const [already, setAlready] = React.useState<string[]>([]); const [watching, setWatching] = React.useState(''); const [note, setNote] = React.useState(''); const [busy, setBusy] = React.useState('');
  const save = async () => { setSaving(true); await call({ action: 'rule', serviceId: s.id, rule }); setSaving(false); };
  const act = async (key: string, body: any) => { setBusy(key); await call({ serviceId: s.id, ...body }); setBusy(''); };
  const recOf = (pid: string) => data.recs.find((r: any) => r.serviceId === s.id && r.staffId === pid) || null;
  const people = [...data.staff].sort((a: any, b: any) => Number(isCurrent(recOf(b.id), data.today)) - Number(isCurrent(recOf(a.id), data.today)) || a.name.localeCompare(b.name));
  const uncertified = people.filter((p: any) => !isCurrent(recOf(p.id), data.today));
  return (
    <div className="grid gap-4 border-t px-4 pb-5 pt-4 md:grid-cols-[1fr_330px] md:px-5" style={{ borderColor: LINE, background: 'rgba(250,250,251,.7)' }}>
      <div className="min-w-0 space-y-2">
        {!s.rule.required ? <p className="rounded-[14px] p-4 text-[14px]" style={{ background: SOFT, color: MUTED }}>Turn on “Needs certification” and save to see who’s certified and who isn’t.</p> : <>
          <p className="text-[13px] font-semibold" style={{ color: MUTED }}>The team</p>
          <div className={`${card} overflow-hidden`} style={{ borderColor: LINE }}>{people.map((p: any, i: number) => { const rec = recOf(p.id); const cur = isCurrent(rec, data.today); const soon = renewSoon(rec, data.today);
            const steps: any[] = data.progress[certId(p.id, s.id)] || []; const done = steps.filter((x) => x.done).length; const lapsed = rec?.status === 'lapsed' || (rec?.status === 'certified' && !cur);
            return <div key={p.id} className="space-y-2 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold">{p.name}</span>
                  <span className="block text-[12.5px]" style={{ color: MUTED }}>{cur ? `Certified ${day(rec.certifiedAt)}${rec.how === 'already' ? ' · already doing it' : rec.how === 'renewed' ? ' · renewed' : rec.by ? ` · signed off by ${String(rec.by).split(' ')[0]}` : ''}${rec.renewBy ? ` · renew by ${day(rec.renewBy)}` : ''}`
                    : lapsed ? `Ran out ${day(rec.renewBy)} — renew it` : rec?.status === 'removed' ? 'Taken away' : steps.length ? `${done} of ${steps.length} done` : 'A manager certifies them'}</span></span>
                {cur ? <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={soon ? pill('#fdf3e6', AMBER) : pill('#e9f3ed', GREEN)}>{soon ? 'Renew soon' : 'Certified'}</span>
                  : lapsed ? <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={pill('#fdecec', RED)}>Lapsed</span> : null}
              </div>
              {!cur && !lapsed && steps.length > 0 && rec?.status !== 'removed' && <div className="space-y-1">{steps.map((st: any) => <div key={st.key} className="flex items-start gap-2 text-[13px]">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={st.done ? { background: GREEN } : { border: '2px solid #c9cacf' }}>{st.done && <Ico d={IC.check} s={11} c="#fff" w={3} />}</span>
                <span className="min-w-0 flex-1">{st.kind === 'doc' ? <button type="button" onClick={() => onOpenDoc(st.key.slice(4))} className="text-left underline-offset-2 hover:underline">{st.label}</button> : st.label}<span className="block text-[12px]" style={{ color: MUTED }}>{st.detail}</span></span></div>)}</div>}
              <div className="flex flex-wrap gap-1.5">
                {!cur && !lapsed && s.rule.watched && !(steps.find((x: any) => x.kind === 'watched')?.done) && <button type="button" onClick={() => { setWatching(watching === p.id ? '' : p.id); setNote(''); }} className="h-9 rounded-full px-3.5 text-[13px] font-semibold text-white" style={{ background: INK }}>Watched — sign off</button>}
                {(lapsed || (cur && soon)) && <button type="button" disabled={!!busy} onClick={() => (s.rule.watched ? (setWatching(p.id), setNote('')) : act(`r${p.id}`, { action: 'grant', staffIds: [p.id], how: 'renewed' }))} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT }}>{busy === `r${p.id}` ? 'Renewing…' : s.rule.watched ? 'Renew — watch one' : 'Renew'}</button>}
                {!cur && !lapsed && <button type="button" disabled={!!busy} onClick={() => act(`g${p.id}`, { action: 'grant', staffIds: [p.id], how: 'already' })} className="h-9 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}>{busy === `g${p.id}` ? 'Saving…' : 'Mark as certified'}</button>}
                {cur && <button type="button" disabled={!!busy} onClick={() => act(`x${p.id}`, { action: 'remove', staffId: p.id })} className="h-9 rounded-full px-3.5 text-[13px]" style={{ background: SOFT, color: RED }}>{busy === `x${p.id}` ? '…' : 'Take it away'}</button>}
              </div>
              {watching === p.id && <div className="flex flex-wrap gap-2 rounded-[14px] bg-white p-2.5" style={{ border: `1px solid ${LINE}` }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="How it went (optional)" aria-label="How it went" className="h-10 min-w-[180px] flex-1 rounded-full border px-3.5 text-[13.5px]" style={{ borderColor: LINE }} />
                <button type="button" disabled={!!busy} onClick={async () => { await act(`w${p.id}`, { action: 'watch', staffId: p.id, note }); setWatching(''); }} className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: GREEN }}>{busy === `w${p.id}` ? 'Signing off…' : 'Sign it off'}</button></div>}
            </div>; })}</div>
          {uncertified.length > 1 && <details className="text-[13.5px]"><summary className="cursor-pointer underline underline-offset-2" style={{ color: MUTED }}>Already doing this service? Mark several as certified</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">{uncertified.map((p: any) => { const on = already.includes(p.id); return <button key={p.id} type="button" aria-pressed={on} onClick={() => setAlready((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))} className="h-9 rounded-full px-3.5 text-[13px]" style={on ? { background: INK, color: '#fff' } : { background: SOFT }}>{p.name}</button>; })}</div>
            {already.length > 0 && <button type="button" disabled={!!busy} onClick={async () => { await act('many', { action: 'grant', staffIds: already, how: 'already' }); setAlready([]); }} className="mt-2 h-10 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>{busy === 'many' ? 'Saving…' : `Mark ${already.length} as certified`}</button>}</details>}
        </>}
      </div>
      <div className={`${card} space-y-3 p-4`} style={{ borderColor: LINE }}>
        <label className="flex items-center justify-between gap-2 text-[14.5px] font-semibold"><span>Needs certification</span><input type="checkbox" checked={rule.required} onChange={(e) => setRule({ ...rule, required: e.target.checked })} className="h-5 w-5" style={{ accentColor: INK }} /></label>
        {rule.required && <>
          <div className="space-y-1.5"><p className="text-[12.5px]" style={{ color: MUTED }}>Documents to read and sign</p>
            {published.length ? <div className="flex flex-wrap gap-1.5">{published.map((d) => { const on = rule.docIds.includes(d.id); return <button key={d.id} type="button" aria-pressed={on} disabled={!on && rule.docIds.length >= 6} onClick={() => setRule({ ...rule, docIds: on ? rule.docIds.filter((x: string) => x !== d.id) : [...rule.docIds, d.id] })} className="h-8 max-w-full truncate rounded-full px-3 text-[12.5px] disabled:opacity-40" style={on ? { background: INK, color: '#fff' } : { background: SOFT }}>{d.title || 'Document'}</button>; })}</div>
              : <p className="text-[13px]" style={{ color: MUTED }}>Publish the SOP for this service first.</p>}</div>
          <label className="flex items-center justify-between gap-2 text-[14px]"><span>A manager watches one and signs it off</span><input type="checkbox" checked={rule.watched} onChange={(e) => setRule({ ...rule, watched: e.target.checked })} className="h-5 w-5" style={{ accentColor: INK }} /></label>
          <select value={rule.renewMonths} onChange={(e) => setRule({ ...rule, renewMonths: Number(e.target.value) })} aria-label="How long it lasts" className="h-10 w-full rounded-[12px] border bg-white px-2.5 text-[14px]" style={{ borderColor: LINE }}>{RENEW_CHOICES.map((m) => <option key={m} value={m}>{RENEW_LABEL[m]}</option>)}</select>
          {!rule.docIds.length && !rule.watched && <p className="text-[12.5px]" style={{ color: AMBER }}>With nothing to do, a manager marks each person as certified.</p>}
          {data.mode === 'block' && !s.rule.required && <p className="text-[12.5px]" style={{ color: AMBER }}>Your business doesn’t let uncertified people be booked — once this is on, only certified people (and renters) can be booked for {s.name}. Mark who already does it right after.</p>}
        </>}
        <button type="button" disabled={!dirty || saving} onClick={save} className="h-10 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>);
}
