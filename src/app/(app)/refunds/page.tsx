'use client';
// src/app/(app)/refunds/page.tsx — REFUNDS TO GIVE (lib/refund-payouts). The front desk's list for refunds on cash sales:
// today's pickups (print the envelope slip and note → take the cash from the till → a second person counts and seals →
// code + signature at handover), refunds to send by Venmo / Zelle / Cash App / Apple Cash, and ones still waiting on the
// client. "On the way" and live distance show on the pickup when the client shares them.
import * as React from 'react';
import { collection, query, orderBy, limit, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { settingsOf, PAY_APPS } from '@/lib/making-it-right';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', RED = '#b42318', GREEN = '#1f7a4d', AMBER = '#b45309';
const BG = { backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%)' };
const CARD: React.CSSProperties = { background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 20, boxShadow: '0 1px 2px rgba(22,23,26,0.04)' };
const LABEL = 'text-[12px] tracking-[0.1em]';
const btn = 'h-11 rounded-full px-5 text-[14.5px] font-medium disabled:opacity-40';
const money = (c: number) => `$${(Math.round(c || 0) / 100).toFixed(2)}`;
const tl = (t: string) => { const h = Number(t.slice(0, 2)); const m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; };
const wl = (w: any) => (w ? `${tl(w.start)}–${tl(w.end)}` : '');
const dl = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const LABELS: Record<string, string> = { pickup: 'Cash pickup', credit: 'Store credit', venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', applecash: 'Apple Cash' };
const ago = (iso?: string) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export default function RefundsPage() {
  const { firestore } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const allowed = ['owner', 'admin', 'manager', 'front_desk'].includes(String(role || '').toLowerCase());
  const tz = selectedTenant?.timezone || 'America/New_York'; const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const q = useMemoFirebase(() => (firestore && tenantId && allowed ? query(collection(firestore as Firestore, `tenants/${tenantId}/refundPayouts`), orderBy('updatedAt', 'desc'), limit(200)) : null), [firestore, tenantId, allowed]);
  const { data, isLoading } = useCollection<any>(q);
  const stQ = useMemoFirebase(() => (firestore && tenantId && allowed ? collection(firestore as Firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId, allowed]);
  const { data: staff } = useCollection<any>(stQ);
  const [pick, setPick] = React.useState(''); const [showDone, setShowDone] = React.useState(false);
  const [, tick] = React.useState(0); React.useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(t); }, []);
  React.useEffect(() => { const id = new URLSearchParams(window.location.search).get('id'); if (id) setPick(id); }, []);
  if (!allowed) return <div className="p-6"><AppHeader title="Refunds to give" /><p className="mt-6" style={{ color: MUTED }}>Refunds are handled by the front desk and managers.</p></div>;
  const all = data || [];
  const active = (x: any) => !['handed', 'sent', 'credited', 'cancelled'].includes(x.status);
  const todayPick = all.filter((x) => active(x) && ['scheduled', 'on_way'].includes(x.status) && x.pickup?.date === today).sort((a, b) => (a.status === 'on_way' ? -1 : 0) - (b.status === 'on_way' ? -1 : 0) || String(a.pickup?.start).localeCompare(String(b.pickup?.start)));
  const returns = all.filter((x) => x.needsReturn && !x.returnedLaterAt);
  const toSend = all.filter((x) => x.status === 'to_send');
  const later = all.filter((x) => active(x) && ['scheduled', 'on_way'].includes(x.status) && x.pickup?.date !== today).sort((a, b) => String(a.pickup?.startAt).localeCompare(String(b.pickup?.startAt)));
  const waiting = all.filter((x) => ['choose', 'pickup_time'].includes(x.status));
  const done = all.filter((x) => !active(x));
  const p = all.find((x) => x.id === pick) || null;

  return (
    <div className="flex min-h-screen flex-col" style={{ ...BG, color: INK, letterSpacing: '-0.01em' }}>
      <AppHeader title="Refunds to give" />
      <main className="grid flex-1 gap-0 md:grid-cols-[380px_1fr]">
        <aside className="space-y-3 p-4 md:p-6" aria-label="Refunds">
          <div><p className={LABEL} style={{ color: MUTED }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz }).toLowerCase()}</p><h1 className="text-[32px] font-normal tracking-[-0.03em]">Refunds today</h1></div>
          {isLoading && <p className="text-[14px]" style={{ color: MUTED }}>Loading…</p>}
          {!isLoading && !all.some(active) && <p className="text-[14.5px]" style={{ color: MUTED }}>Nothing to give back right now. Cash refunds start from a Making it right case, or from Money when the client isn’t there.</p>}
          <Group title={`cash pickups · ${todayPick.length}`} items={todayPick} pick={pick} onPick={setPick} />
          {returns.length > 0 && <Group title="cash to put back in the till" items={returns} pick={pick} onPick={setPick} />}
          <Group title={`to send by app · ${toSend.length}`} items={toSend} pick={pick} onPick={setPick} />
          <Group title="waiting on the client" items={waiting} pick={pick} onPick={setPick} />
          <Group title="later pickups" items={later} pick={pick} onPick={setPick} />
          {done.length > 0 && <button type="button" onClick={() => setShowDone(!showDone)} className="pt-2 text-[14px] underline underline-offset-2">{showDone ? 'Hide' : 'Show'} finished ({done.length})</button>}
          {showDone && <Group title="finished" items={done.slice(0, 40)} pick={pick} onPick={setPick} />}
        </aside>
        <section className="p-4 md:p-6">{p ? <Detail key={p.id} p={p} tenantId={tenantId} tenant={selectedTenant} staff={staff || []} /> : <div className="hidden p-6 md:block" style={CARD}><p className="text-[15px]" style={{ color: MUTED }}>Pick a refund to prepare, hand over or send.</p></div>}</section>
      </main>
    </div>);
}

function Group({ title, items, pick, onPick }: { title: string; items: any[]; pick: string; onPick: (id: string) => void }) {
  if (!items.length) return null;
  return <div className="space-y-2 pt-2"><p className={`${LABEL} pl-0.5`} style={{ color: MUTED }}>{title}</p>{items.map((x) => <Card key={x.id} x={x} on={pick === x.id} onPick={() => onPick(x.id)} />)}</div>;
}

function Card({ x, on, onPick }: { x: any; on: boolean; onPick: () => void }) {
  const edge = x.needsReturn ? RED : x.status === 'to_send' || x.status === 'choose' || x.status === 'pickup_time' ? INK : x.prep?.sealedAt ? GREEN : ['handed', 'sent', 'credited', 'cancelled'].includes(x.status) ? '#c7cad1' : AMBER;
  const sub = x.method === 'pickup' && x.pickup ? `${x.number || 'Refund'} · ${dl(x.pickup.date).split(',')[0]} ${wl(x.pickup)}` : `${x.number || 'Refund'} · ${x.method ? LABELS[x.method] : 'Choosing how'}`;
  return <button type="button" onClick={onPick} className="block w-full rounded-2xl border bg-white p-3.5 text-left" style={{ borderColor: on ? INK : LINE, borderLeft: `3px solid ${edge}`, boxShadow: on ? `0 0 0 1px ${INK}` : undefined }}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[16px] font-medium">{x.clientName}</p><p className="truncate text-[13px]" style={{ color: MUTED }}>{sub}</p></div><p className="text-[19px] font-bold tabular-nums">{money(x.amountCents)}</p></div>
    {(x.status === 'on_way' || x.prep?.printedAt || x.prep?.sealedAt) && <div className="mt-2 flex flex-wrap gap-1.5">
      {x.status === 'on_way' && <Chip dark>{x.trip?.etaMin != null && x.trip?.live ? `On the way · ${x.trip.etaMin} min` : `On the way${x.trip?.etaMin ? ` · ~${x.trip.etaMin} min` : ''}`}</Chip>}
      {x.prep?.sealedAt ? <Chip ok>Sealed</Chip> : x.prep?.tillAt ? <Chip ok>Cash out</Chip> : x.prep?.printedAt ? <Chip ok>Printed</Chip> : null}</div>}
  </button>;
}
const Chip = ({ children, ok, dark }: { children: React.ReactNode; ok?: boolean; dark?: boolean }) => <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium" style={dark ? { background: INK, color: '#fff' } : ok ? { background: '#e9f3ed', color: GREEN } : { background: '#f3f3f5', color: MUTED }}>{children}</span>;

function Detail({ p, tenantId, tenant, staff }: { p: any; tenantId: string; tenant: any; staff: any[] }) {
  const C = settingsOf(tenant).cashRefund; const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [ok, setOk] = React.useState('');
  const act = async (action: string, extra: any = {}, done = 'Saved.') => { setBusy(true); setErr(''); setOk(''); const r = await payPost('/api/refund-payouts', { tenantId, id: p.id, action, ...extra }); setBusy(false); if (r.ok) { setOk(done); return r; } setErr(r.error || 'That didn’t work.'); return null; };
  const isDone = ['handed', 'sent', 'credited', 'cancelled'].includes(p.status);
  return <div className="mx-auto max-w-[620px] space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className={LABEL} style={{ color: MUTED }}>{(p.number ? `case ${p.number}` : 'refund').toLowerCase()} · {p.method ? LABELS[p.method].toLowerCase() : 'choosing how'}</p><h2 className="text-[30px] font-normal tracking-[-0.03em]">{p.clientName} · <b className="font-bold tabular-nums">{money(p.amountCents)}</b></h2></div>
      {p.caseId && <a href={`/cases?id=${p.caseId}`} className="text-[14px] underline underline-offset-2">Open the case</a>}</div>
    {err && <p className="rounded-2xl p-3 text-[14px] font-medium" style={{ background: '#fdecec', color: RED }}>{err}</p>}
    {ok && <p className="rounded-2xl p-3 text-[14px] font-medium" style={{ background: '#e9f3ed', color: GREEN }}>{ok}</p>}

    {p.status === 'on_way' && <OnWayCard p={p} />}
    {p.needsReturn && !p.returnedLaterAt && <div className="p-4" style={CARD}><p className="text-[15px]"><b>{money(p.amountCents)} is out of a closed till.</b> Put it back in today’s drawer and note it.</p>
      <button type="button" disabled={busy} onClick={() => act('returned_later', {}, 'Noted — it’s back in the drawer.')} className={`${btn} mt-3`} style={{ background: INK, color: '#fff' }}>It’s back in the drawer</button></div>}

    {p.method === 'pickup' && ['scheduled', 'on_way'].includes(p.status) && <Pickup p={p} C={C} staff={staff} busy={busy} act={act} tenantId={tenantId} />}
    {p.status === 'to_send' && <SendApp p={p} C={C} busy={busy} act={act} />}
    {['choose', 'pickup_time'].includes(p.status) && <Waiting p={p} busy={busy} act={act} tenantId={tenantId} />}
    {isDone && <div className="space-y-1 p-4" style={CARD}><p className="text-[16px] font-medium">{p.status === 'handed' ? `Handed over ${p.handedAt ? new Date(p.handedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''} by ${p.handedBy}` : p.status === 'sent' ? `Sent by ${LABELS[p.method]} — ${p.app?.sentBy}${p.app?.ref ? ` · ref ${p.app.ref}` : ''}` : p.status === 'credited' ? 'Added as store credit' : 'Cancelled'}</p>
      {p.signatureUrl && <img src={p.signatureUrl} alt="Client signature" className="mt-2 h-24 rounded-xl border bg-white object-contain" style={{ borderColor: LINE }} />}
      {p.app?.proofUrl && <a href={p.app.proofUrl} target="_blank" rel="noreferrer" className="text-[14px] underline underline-offset-2">Payment screenshot</a>}</div>}

    <details className="p-4" style={CARD}><summary className="cursor-pointer text-[14.5px] font-medium">What happened</summary>
      <ul className="mt-3 space-y-1.5">{[...(p.timeline || [])].reverse().map((t: any, i: number) => <li key={i} className="text-[13.5px]"><span style={{ color: MUTED }}>{new Date(t.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {t.by}</span> — {t.text}</li>)}</ul></details>
    {!isDone && !p.prep?.tillAt && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Cancel this refund set-up? The case keeps the refund fix.')) act('cancel', {}, 'Cancelled.'); }} className="text-[14px] underline underline-offset-2" style={{ color: MUTED }}>Cancel this refund</button>}
  </div>;
}

function OnWayCard({ p }: { p: any }) {
  const t = p.trip || {}; const live = !!t.live && t.distanceMi != null;
  return <div className="space-y-2.5 p-4" style={{ ...CARD, background: '#fff' }}>
    <div className="flex items-center justify-between"><p className="text-[16px] font-medium">{p.clientFirst} is on the way</p>{t.live && <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-white" style={{ background: INK }}><span className="h-[7px] w-[7px] rounded-full" style={{ background: '#6ee7a8' }} />Live</span>}</div>
    <div className="flex items-baseline gap-2"><span className="text-[30px] font-bold tabular-nums tracking-[-0.02em]">{t.etaMin != null ? `${t.etaMin} min` : '—'}</span><span className="text-[13.5px]" style={{ color: MUTED }}>{live ? `${t.distanceMi} mi away · updated ${ago(t.updatedAt)}` : `they said about ${t.etaMin} min · ${ago(t.at)}`}</span></div>
    {!p.prep?.sealedAt && <p className="text-[13.5px] font-medium" style={{ color: AMBER }}>Envelope isn’t ready yet.</p>}
  </div>;
}

function Pickup({ p, C, staff, busy, act, tenantId }: { p: any; C: any; staff: any[]; busy: boolean; act: any; tenantId: string }) {
  const [note, setNote] = React.useState(p.noteText || ''); const [counter, setCounter] = React.useState(''); const [code, setCode] = React.useState(''); const [sig, setSig] = React.useState<string | null>(null);
  const prep = p.prep || {}; const others = staff.filter((s) => s.archived !== true && s.name && s.name !== prep.preparedBy);
  const step = (done: boolean, label: string) => <div className="flex items-center gap-2.5 text-[14.5px]">{done ? <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full" style={{ background: GREEN }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg></span> : <span className="h-[22px] w-[22px] rounded-full border-[1.5px]" style={{ borderColor: '#c7cad1' }} />}{label}</div>;
  return <>
    <div className="space-y-3 p-4" style={CARD}>
      <div className="flex items-baseline justify-between"><p className={LABEL} style={{ color: MUTED }}>pickup</p><p className="text-[15px] font-medium">{dl(p.pickup.date)} · {wl(p.pickup)}</p></div>
      <div className="space-y-2">{step(!!prep.printedAt, 'Slip and note printed')}{step(!!prep.tillAt, prep.tillAt ? `Cash out — ${prep.fromSafe ? 'from the safe' : 'from the till'} by ${prep.preparedBy}` : 'Cash taken from the till')}{C.twoPerson && step(!!prep.countedBy, prep.countedBy ? `Counted by ${prep.countedBy} and sealed` : 'Counted by a second person and sealed')}</div>
    </div>

    <div className="space-y-3 p-4" style={CARD}>
      <p className="text-[15px] font-medium">1 · The note inside</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={6} className="w-full rounded-2xl border bg-white p-3 text-[14.5px] leading-relaxed" style={{ borderColor: LINE }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={async () => { await act('note', { text: note }, 'Note saved.'); window.open(`/refunds/print/${p.id}`, '_blank'); }} className={btn} style={{ background: INK, color: '#fff' }}>{prep.printedAt ? 'Print again' : 'Print slip and note'}</button>
        {note !== (p.noteText || '') && <button type="button" disabled={busy} onClick={() => act('note', { text: note }, 'Note saved.')} className={`${btn} border bg-white`} style={{ borderColor: LINE }}>Save note</button>}
      </div>
    </div>

    <div className="space-y-3 p-4" style={CARD}>
      <p className="text-[15px] font-medium">2 · Prepare the envelope</p>
      <div className="flex flex-wrap gap-1.5">{bills(p.amountCents).map((b) => <span key={b.label} className="rounded-xl border bg-white px-3 py-1.5 text-[14px]" style={{ borderColor: LINE }}><b className="tabular-nums">{b.count}</b> × {b.label}</span>)}</div>
      {!prep.tillAt ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={async () => { const r = await act('till', {}, 'Taken from the till.'); if (!r && window.confirm('No till is open. Take it from the safe instead?')) await act('till', { fromSafe: true }, 'Taken from the safe.'); }} className={btn} style={{ background: INK, color: '#fff' }}>Take {money(p.amountCents)} from the till</button></div>
        : !prep.countedBy && C.twoPerson ? <div className="flex flex-wrap items-center gap-2">
          <select value={counter} onChange={(e) => setCounter(e.target.value)} aria-label="Who counted it" className="h-11 rounded-full border bg-white px-4 text-[14.5px]" style={{ borderColor: LINE }}><option value="">Who counted it?</option>{others.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
          <button type="button" disabled={busy || !counter} onClick={() => act('counted', { countedBy: counter }, 'Counted and sealed.')} className={btn} style={{ background: INK, color: '#fff' }}>Counted and sealed</button>
          <button type="button" disabled={busy} onClick={() => act('return_till', {}, 'Back in the till.')} className="text-[14px] underline underline-offset-2">Put it back</button></div>
        : <div className="flex flex-wrap items-center gap-3"><Chip ok>Ready</Chip>{!C.twoPerson && !prep.countedBy && <button type="button" disabled={busy} onClick={() => act('counted', {}, 'Sealed.')} className={`${btn} border bg-white`} style={{ borderColor: LINE }}>Mark sealed</button>}<button type="button" disabled={busy} onClick={() => act('return_till', {}, 'Back in the till.')} className="text-[14px] underline underline-offset-2">Put it back in the till</button></div>}
    </div>

    <div className="space-y-3 p-4" style={CARD}>
      <p className="text-[15px] font-medium">3 · Hand it over</p>
      <label className={`block ${LABEL}`} style={{ color: MUTED }}>their pickup code<input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" className="mt-1.5 block h-16 w-48 rounded-2xl border bg-white text-center text-[30px] font-bold tracking-[0.3em] text-[#16171a]" style={{ borderColor: code.length === 4 ? INK : LINE }} /></label>
      <p className={LABEL} style={{ color: MUTED }}>they count it and sign</p>
      <SignaturePad onChange={setSig} caption={`I received ${money(p.amountCents)} in cash · ${p.clientName}`} />
      <button type="button" disabled={busy || code.length !== 4 || !sig || !prep.tillAt} onClick={() => act('handover', { code, signature: sig }, 'Handed over. The refund is in Money and on the case.')} className={`${btn} w-full`} style={{ background: INK, color: '#fff', height: 52 }}>Handed over, close the refund</button>
      {!prep.tillAt && <p className="text-[13px]" style={{ color: MUTED }}>Prepare the envelope first.</p>}
    </div>
    <div className="flex flex-wrap gap-4 text-[14px]">
      <button type="button" disabled={busy} onClick={async () => { const r = await act('resend', {}, 'Texted them a reminder.'); if (r?.link && !r.sent) { await navigator.clipboard?.writeText(`${window.location.origin}${r.link}`).catch(() => {}); } }} className="underline underline-offset-2">Text them a reminder</button>
      <button type="button" disabled={busy} onClick={() => { if (window.confirm('Mark as missed? Any cash goes back in the till and they’re asked to pick a new time.')) act('missed', {}, 'Marked missed — we’ve asked them for a new time.'); }} className="underline underline-offset-2" style={{ color: MUTED }}>They didn’t come</button>
    </div>
  </>;
}

function bills(cents: number) {
  let left = Math.round(cents); const out: { label: string; count: number }[] = [];
  for (const [v, label] of [[10000, '$100'], [5000, '$50'], [2000, '$20'], [1000, '$10'], [500, '$5'], [100, '$1'], [25, '25¢'], [10, '10¢'], [5, '5¢'], [1, '1¢']] as [number, string][]) { const n = Math.floor(left / v); if (n > 0) { out.push({ label, count: n }); left -= n * v; } }
  return out;
}

function SendApp({ p, C, busy, act }: { p: any; C: any; busy: boolean; act: any }) {
  const [ref, setRef] = React.useState(''); const [proof, setProof] = React.useState<string | null>(null); const app = PAY_APPS[p.method as keyof typeof PAY_APPS]; const from = C.apps[p.method]?.from;
  const amt = (p.amountCents / 100).toFixed(2); const noteTxt = `Refund${p.number ? ` · ${p.number}` : ''}`; const h = String(p.app?.handle || '');
  const link = p.method === 'venmo' ? `https://venmo.com/${h.replace(/^@/, '')}?txn=pay&amount=${amt}&note=${encodeURIComponent(noteTxt)}` : p.method === 'cashapp' ? `https://cash.app/${h.startsWith('$') ? h : `$${h}`}/${amt}` : null;
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  const pickProof = (f?: File | null) => { if (!f) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1400 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = img.width * s; cv.height = img.height * s; (cv.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, cv.width, cv.height); setProof(cv.toDataURL('image/jpeg', 0.8)); }; img.src = String(r.result); }; r.readAsDataURL(f); };
  return <>
    <div className="space-y-2.5 p-4" style={{ ...CARD, background: '#fff' }}>
      <p className="text-[34px] font-bold tabular-nums tracking-[-0.02em]">{money(p.amountCents)}</p>
      <Line k="To" v={`${h}${p.app?.accountName ? ` · ${p.app.accountName}` : ''}`} />{from && <Line k="From" v={from} />}<Line k="Note" v={noteTxt} />
      {p.app?.confirmedAt && <Chip ok>{p.clientFirst} confirmed this account</Chip>}
    </div>
    <div className="space-y-3 p-4" style={CARD}>
      <p className="text-[14.5px]"><b>1 ·</b> {link ? `Open ${app.label}. The amount and note are filled in — check the name before you pay.` : `Open ${app.label === 'Zelle' ? 'the business bank app' : 'Messages on the business iPhone'} and send ${money(p.amountCents)} to ${h}.`}</p>
      <div className="flex flex-wrap gap-2">{link ? <a href={link} target="_blank" rel="noreferrer" className={`${btn} inline-flex items-center border bg-white`} style={{ borderColor: INK }}>Open {app.label}</a> : null}
        <button type="button" onClick={() => copy(h)} className={`${btn} border bg-white`} style={{ borderColor: LINE }}>Copy {app.label === 'Apple Cash' ? 'number' : 'handle'}</button><button type="button" onClick={() => copy(amt)} className={`${btn} border bg-white`} style={{ borderColor: LINE }}>Copy amount</button></div>
      <p className="pt-1 text-[14.5px]"><b>2 ·</b> Come back and add the payment ID or a screenshot.</p>
      <div className="flex flex-wrap gap-2"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Payment ID" aria-label="Payment ID" className="h-11 min-w-0 flex-1 rounded-2xl border bg-white px-3 text-[14.5px]" style={{ borderColor: LINE }} />
        <label className={`${btn} inline-flex cursor-pointer items-center border bg-white`} style={{ borderColor: LINE }}>{proof ? 'Screenshot added' : 'Add screenshot'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => pickProof(e.target.files?.[0])} /></label></div>
      <button type="button" disabled={busy || (!ref && !proof)} onClick={() => act('sent', { ref, proof }, `Recorded. We’ve texted ${p.clientFirst}.`)} className={`${btn} w-full`} style={{ background: INK, color: '#fff', height: 52 }}>I sent it, text {p.clientFirst}</button>
      {C.sendRole === 'manager' && <p className="text-[12.5px]" style={{ color: MUTED }}>Only a manager can mark app refunds sent.</p>}
    </div>
  </>;
}

function Waiting({ p, busy, act, tenantId }: { p: any; busy: boolean; act: any; tenantId: string }) {
  const [opts, setOpts] = React.useState<any>(null); const [m, setM] = React.useState(''); const [w, setW] = React.useState<any>(null); const [handle, setHandle] = React.useState(''); const [name, setName] = React.useState('');
  React.useEffect(() => { payPost('/api/refund-payouts', { tenantId, action: 'windows' }).then(setOpts); }, [tenantId]);
  const M = opts?.methods?.find((x: any) => x.id === m);
  return <div className="space-y-3 p-4" style={CARD}>
    <p className="text-[15.5px]">{p.status === 'pickup_time' ? `${p.clientFirst} is picking a pickup time.` : `${p.clientFirst} is choosing how to get it back.`}{p.missed ? ` Missed ${p.missed} pickup${p.missed === 1 ? '' : 's'}.` : ''}</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={async () => { const r = await act('resend', {}, 'Texted them the link again.'); if (r?.link) await navigator.clipboard?.writeText(`${window.location.origin}${r.link}`).catch(() => {}); }} className={btn} style={{ background: INK, color: '#fff' }}>Text the link again</button></div>
    <details><summary className="cursor-pointer text-[14px] underline underline-offset-2">Choose for them (they called or are here)</summary>
      {opts && <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">{opts.methods.filter((x: any) => !(x.id === 'pickup' && p.pickupBlocked)).map((x: any) => <button key={x.id} type="button" onClick={() => setM(x.id)} className="h-10 rounded-full border px-4 text-[14px]" style={m === x.id ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{x.label}</button>)}</div>
        {m === 'pickup' && <div className="flex flex-wrap gap-2">{opts.windows.slice(0, 12).map((x: any) => { const on = w && w.date === x.date && w.start === x.start; return <button key={x.date + x.start} type="button" onClick={() => setW(x)} className="h-10 rounded-full border px-3.5 text-[13.5px]" style={on ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{x.dayLabel} {wl(x)}</button>; })}</div>}
        {M?.ask && <div className="grid gap-2 sm:grid-cols-2"><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={M.placeholder || M.ask} aria-label={M.ask} className="h-11 rounded-2xl border bg-white px-3 text-[14.5px]" style={{ borderColor: LINE }} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on the account" aria-label="Name on the account" className="h-11 rounded-2xl border bg-white px-3 text-[14.5px]" style={{ borderColor: LINE }} /></div>}
        {m && <button type="button" disabled={busy || (m === 'pickup' && !w) || (!!M?.ask && !handle)} onClick={() => act('choose', { method: m, pickup: w, handle, accountName: name }, 'Saved — we’ve texted them.')} className={btn} style={{ background: INK, color: '#fff' }}>Save</button>}
      </div>}</details>
  </div>;
}

const Line = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-4 text-[14.5px]"><span style={{ color: MUTED }}>{k}</span><span className="text-right font-medium">{v}</span></div>;

function SignaturePad({ onChange, caption }: { onChange: (d: string | null) => void; caption: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null); const drawing = React.useRef(false); const drawn = React.useRef(false); const [has, setHas] = React.useState(false);
  React.useEffect(() => { const c = ref.current; if (!c) return; const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr; const x = c.getContext('2d') as CanvasRenderingContext2D; x.scale(dpr, dpr); x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = INK; }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const x = ref.current!.getContext('2d') as CanvasRenderingContext2D; const p = pos(e); x.beginPath(); x.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const x = ref.current!.getContext('2d') as CanvasRenderingContext2D; const p = pos(e); x.lineTo(p.x, p.y); x.stroke(); drawn.current = true; if (!has) setHas(true); };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (drawn.current) onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; (c.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, c.width, c.height); drawn.current = false; setHas(false); onChange(null); };
  return <div className="rounded-2xl border bg-white p-3" style={{ borderColor: LINE }}>
    <canvas ref={ref} aria-label="Signature" className="h-36 w-full touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    <div className="flex items-center justify-between border-t pt-2 text-[12.5px]" style={{ borderColor: LINE, color: MUTED }}><span>{caption}</span>{has && <button type="button" onClick={clear} className="underline underline-offset-2">Clear</button>}</div>
  </div>;
}
