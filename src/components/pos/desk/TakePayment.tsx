'use client';
// src/components/pos/desk/TakePayment.tsx — TAKE A PAYMENT: search anyone (client, renter, student), see everything they
// owe in one list, choose what they're paying, and put it on the bill. The normal checkout does the rest — cash / card
// / split, the receipt to the right person, the autopay offer, overpayments as credit (never a tip), voids.
// One person, many hats: a renter who is also a client (same phone / email / linked record) shows ONCE.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

const money = (c: number) => `$${(Math.max(0, Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => { if (!iso) return ''; try { return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? { timeZone: 'UTC' } : {}) }); } catch { return ''; } };
const digits = (p: any) => String(p || '').replace(/\D/g, '').slice(-10);
async function post(url: string, body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' })); }

type Pick = { on: boolean; cents: number; apply?: 'ahead' | 'paydown' };
/** One line in the list — outside the sheet so typing an amount never loses focus. */
function Row({ p, onSet, title, sub, cents, editable = true, children }: { p: Pick; onSet: (x: Partial<Pick>) => void; title: string; sub?: string; cents: number; editable?: boolean; children?: React.ReactNode }) {
  const [text, setText] = React.useState((p.cents / 100).toFixed(2));
  React.useEffect(() => { setText((p.cents / 100).toFixed(2)); }, [p.cents]);
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  return (<div className="space-y-2 rounded-2xl p-3" style={box}>
    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={!!p.on} onChange={(ev) => onSet({ on: ev.target.checked })} />
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{title}</span>{sub && <span className="block text-[13px]" style={muted}>{sub}</span>}</span>
      {editable ? <span className="flex items-center gap-1 text-[15px] font-semibold">$<input inputMode="decimal" aria-label={`${title} amount`} value={text}
          onChange={(ev) => setText(ev.target.value)} onBlur={() => onSet({ cents: Math.max(0, Math.round((Number(text) || 0) * 100)), on: true })}
          className="h-9 w-24 rounded-xl border px-2 text-right" style={{ borderColor: 'var(--line)' }} /></span>
        : <span className="text-[15px] font-semibold">{money(cents)}</span>}</label>
    {children}</div>);
}

type Person = { key: string; name: string; hint: string; clientIds: string[]; renterIds: string[]; planIds: string[]; tags: string[] };

export function TakePayment({ e, onDone }: { e: any; onDone: () => void }) {
  const tenantId = e.tenantId;
  const [dir, setDir] = React.useState<any>(null); const [q, setQ] = React.useState(''); const [who, setWho] = React.useState<Person | null>(null);
  const [acc, setAcc] = React.useState<any>(null); const [pick, setPick] = React.useState<Record<string, Pick>>({});
  const [err, setErr] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { void post('/api/desk/accounts', { tenantId, action: 'directory' }).then((r) => (r.ok ? setDir(r) : (setDir({ renters: [], students: [] }), setErr(r.error)))); }, [tenantId]);

  // Everyone, merged: the same person across clients / renters / students becomes one row.
  const people: Person[] = React.useMemo(() => {
    const m = new Map<string, Person>(); const keyFor = (x: { email?: any; phone?: any; clientId?: any }, fallback: string) => (x.clientId ? `c:${x.clientId}` : '') || (x.email ? `e:${String(x.email).toLowerCase()}` : '') || (digits(x.phone) ? `p:${digits(x.phone)}` : '') || fallback;
    const alias = new Map<string, string>();   // email / phone → the row they belong to
    const add = (k: string, name: string, hint: string, tag: string, ids: { c?: string | null; r?: string; p?: string }, contacts: string[]) => {
      const existing = contacts.map((c) => alias.get(c)).find(Boolean) || (ids.c ? alias.get(`c:${ids.c}`) : undefined);
      const key = existing || k; const row = m.get(key) || { key, name, hint, clientIds: [], renterIds: [], planIds: [], tags: [] };
      if (ids.c && !row.clientIds.includes(ids.c)) row.clientIds.push(ids.c); if (ids.r) row.renterIds.push(ids.r); if (ids.p) row.planIds.push(ids.p); if (!row.tags.includes(tag)) row.tags.push(tag);
      if (!row.hint && hint) row.hint = hint; m.set(key, row); for (const c of contacts) if (c) alias.set(c, key); if (ids.c) alias.set(`c:${ids.c}`, key);
    };
    for (const c of (e.clients || []) as any[]) { const em = c.email ? `e:${String(c.email).toLowerCase()}` : ''; const ph = digits(c.phone) ? `p:${digits(c.phone)}` : '';
      const owes = (Array.isArray(c.unpaidFees) && c.unpaidFees.length) || Number(c.outstandingBalance) > 0;
      add(keyFor({ clientId: c.id }, `c:${c.id}`), c.name || 'Client', digits(c.phone) ? `•••${digits(c.phone).slice(-4)}` : c.email || '', owes ? 'Owes fees' : 'Client', { c: c.id }, [em, ph]); }
    for (const r of (dir?.renters || []) as any[]) add(keyFor({ email: r.email, phone: r.phoneKey }, `r:${r.renterId}`), r.name, r.phone4 ? `•••${r.phone4}` : r.email || '', 'Renter', { c: r.clientId, r: r.renterId }, [r.email ? `e:${r.email}` : '', r.phoneKey ? `p:${r.phoneKey}` : '']);
    for (const s of (dir?.students || []) as any[]) add(keyFor({ email: s.email, phone: s.phoneKey }, `s:${s.planId}`), s.name, s.phone4 ? `•••${s.phone4}` : s.email || '', 'Student', { c: s.clientId, p: s.planId }, [s.email ? `e:${s.email}` : '', s.phoneKey ? `p:${s.phoneKey}` : '']);
    return [...m.values()];
  }, [e.clients, dir]);
  const shown = React.useMemo(() => { const t = q.trim().toLowerCase(); const d = digits(q); if (t.length < 2) return [];
    return people.filter((p) => p.name.toLowerCase().includes(t) || (d.length >= 3 && p.hint.includes(d.slice(-4)))).slice(0, 12); }, [people, q]);

  const open = async (p: Person) => {
    setWho(p); setAcc(null); setErr(null);
    const r = await post('/api/desk/accounts', { tenantId, action: 'person', clientIds: p.clientIds, renterIds: p.renterIds, planIds: p.planIds });
    if (!r.ok) { setErr(r.error || 'Couldn’t load their accounts.'); return; }
    setAcc(r); setPick(dueNow(r));
  };
  // "What's due now": rent owed now, tuition that's past due or due within a week, every unpaid fee. Deposits are chosen.
  const dueNow = (r: any) => { const out: typeof pick = {}; const week = Date.now() + 7 * 86400000;
    for (const x of r.rent) out[`rent:${x.renterId}`] = { on: x.owedNowCents > 0, cents: x.owedNowCents > 0 ? x.owedNowCents : x.nextAfterCreditsCents };
    for (const x of r.tuition) out[`tuition:${x.planId}`] = { on: x.pastDue || (x.nextDue && Date.parse(x.nextDue) <= week), cents: x.nextCents || x.balanceCents, apply: 'ahead' };
    for (const x of r.fees) out[`fee:${x.feeId}`] = { on: true, cents: x.cents };
    for (const x of r.deposits) out[`dep:${x.appointmentId}`] = { on: false, cents: x.cents };
    return out; };
  const everything = () => { if (!acc) return; const out = dueNow(acc);
    for (const x of acc.rent) if (x.owedNowCents > 0) out[`rent:${x.renterId}`] = { on: true, cents: x.owedNowCents };
    for (const x of acc.tuition) out[`tuition:${x.planId}`] = { on: true, cents: x.balanceCents, apply: 'paydown' };
    for (const x of acc.deposits) out[`dep:${x.appointmentId}`] = { on: true, cents: x.cents };
    setPick(out); };
  const set = (k: string, patch: Partial<{ on: boolean; cents: number; apply: 'ahead' | 'paydown' }>) => setPick((m) => ({ ...m, [k]: { ...m[k], ...patch } }));
  const total = Object.values(pick).filter((x) => x.on).reduce((n, x) => n + (x.cents || 0), 0);

  const addToBill = async () => {
    if (!who || !acc || total <= 0) return; setErr(null);
    // One bill, one person: don't mix someone else's sale into this one.
    const busyBill = (e.retailItems || []).length > 0 || (e.selectedAppointmentIds?.size || 0) > 0;
    let clientId: string | null = who.clientIds[0] || null;
    if (!clientId) { setBusy(true);
      const r = who.renterIds[0] ? await post('/api/rent-desk', { tenantId, action: 'payer', renterId: who.renterIds[0] }) : await post('/api/tuition-desk', { tenantId, action: 'payer', planId: who.planIds[0] });
      setBusy(false); if (!r.ok) { setErr(r.error || 'Couldn’t set up the payer.'); return; } clientId = r.clientId; }
    if (busyBill && e.selectedClientId && e.selectedClientId !== clientId) { setErr('The bill already has someone else’s items — finish or clear that sale first.'); return; }
    e.setSelectedClientId?.(clientId);
    for (const x of acc.rent) { const p = pick[`rent:${x.renterId}`]; if (p?.on && p.cents > 0) e.addRentToCart?.({ renterId: x.renterId, name: x.name, amount: p.cents / 100 }); }
    for (const x of acc.tuition) { const p = pick[`tuition:${x.planId}`]; if (p?.on && p.cents > 0) e.addTuitionToCart?.({ planId: x.planId, name: x.name, program: x.program, amount: p.cents / 100, apply: p.apply || 'ahead' }); }
    const deps = acc.deposits.filter((x: any) => pick[`dep:${x.appointmentId}`]?.on);
    if (deps.length) e.setRetailItems?.((prev: any[]) => [...(prev || []).filter((i: any) => !deps.some((x: any) => i.id === `deposit-${x.appointmentId}`)),
      ...deps.map((x: any) => ({ id: `deposit-${x.appointmentId}`, name: `Deposit — ${x.service} · ${day(x.startTime)}`, quantity: 1, price: x.cents / 100, type: 'deposit', depositForAppointmentId: x.appointmentId }))]);
    // Fees: exactly the ones chosen (selecting the client pre-ticks all of theirs — settle that after it happens).
    setTimeout(() => { for (const f of acc.fees) e.onApplyAdjustmentToggle?.(f.feeId, !!pick[`fee:${f.feeId}`]?.on); }, 60);
    onDone();
  };

  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;

  if (!who) return (
    <div className="space-y-3">
      <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Name or phone — client, renter or student" aria-label="Find someone" className="h-12 w-full rounded-2xl border px-4 text-[16px]" style={{ borderColor: 'var(--line)' }} />
      {!dir && <p className="text-[14px]" style={muted}>Loading…</p>}
      {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
      {q.trim().length >= 2 && shown.length === 0 && dir && <p className="text-[14px]" style={muted}>Nobody matches “{q.trim()}”.</p>}
      <div className="space-y-2">{shown.map((p) => (
        <button key={p.key} type="button" onClick={() => void open(p)} className="flex w-full items-center justify-between gap-3 rounded-2xl p-3 text-left" style={box}>
          <span><span className="block text-[15px] font-semibold">{p.name}</span><span className="block text-[13px]" style={muted}>{p.hint}</span></span>
          <span className="flex flex-wrap justify-end gap-1">{p.tags.map((t) => <span key={t} className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={soft}>{t}</span>)}</span>
        </button>))}</div>
    </div>);

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => { setWho(null); setAcc(null); }} className="text-[14px] font-medium underline underline-offset-4" style={muted}>‹ Someone else</button>
      <p className="text-[18px] font-semibold">{who.name}</p>
      {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
      {!acc && !err && <p className="text-[14px]" style={muted}>Looking up everything they owe…</p>}
      {acc && (<>
        <div className="flex gap-2"><button type="button" onClick={() => setPick(dueNow(acc))} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={soft}>What’s due now</button>
          <button type="button" onClick={everything} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={soft}>Everything</button></div>
        {acc.rent.map((x: any) => <Row key={x.renterId} p={pick[`rent:${x.renterId}`] || { on: false, cents: 0 }} onSet={(v) => set(`rent:${x.renterId}`, v)} title={`Rent${x.booth ? ` — ${x.booth}` : ''}`} cents={x.owedNowCents}
          sub={[x.owedNowCents > 0 ? `Owed now ${money(x.owedNowCents)}${x.lateFeeCents ? ` (incl. ${money(x.lateFeeCents)} late fee)` : ''}` : 'Nothing owed now — pay toward the next rent',
            x.creditCents > 0 ? `${money(x.creditCents)} credit waiting` : '', x.nextDue ? `Next rent ${money(x.nextAfterCreditsCents)} on ${day(x.nextDue)}${x.autopayOn ? ' (autopay)' : ''}` : ''].filter(Boolean).join(' · ')} />)}
        {acc.tuition.map((x: any) => { const k = `tuition:${x.planId}`; const p = pick[k]; return (
          <Row key={x.planId} p={pick[k] || { on: false, cents: 0 }} onSet={(v) => set(k, v)} title={`Tuition — ${x.program}`} cents={x.nextCents}
            sub={`${x.pastDue ? 'Past due · ' : ''}Next instalment ${money(x.nextCents)}${x.nextDue ? ` on ${day(x.nextDue)}` : ''}${x.prepaidCents ? ` (${money(x.prepaidCents)} paid ahead)` : ''} · balance ${money(x.balanceCents)}${x.autopayOn ? ' · autopay' : ''}`}>
            {p?.on && p.cents > x.balanceCents && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>That’s more than the whole balance ({money(x.balanceCents)}) — lower it.</p>}
            {p?.on && x.installmentCents > 0 && p.cents > x.nextCents && p.cents < x.balanceCents && (
              <div className="flex flex-wrap gap-2 text-[13px]">The extra {money(p.cents - x.nextCents)}:
                {([['ahead', 'covers the next instalments'], ['paydown', 'pays down the balance']] as const).map(([v, t]) => <button key={v} type="button" aria-pressed={p.apply === v} onClick={() => set(k, { apply: v })} className="rounded-full px-3 py-1 font-semibold" style={p.apply === v ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : soft}>{t}</button>)}
              </div>)}
          </Row>); })}
        {acc.fees.map((x: any) => <Row key={x.feeId} p={pick[`fee:${x.feeId}`] || { on: false, cents: 0 }} onSet={(v) => set(`fee:${x.feeId}`, v)} title={x.reason || 'Fee'} sub={x.date ? `From ${day(x.date)}` : undefined} cents={x.cents} editable={false} />)}
        {acc.deposits.map((x: any) => <Row key={x.appointmentId} p={pick[`dep:${x.appointmentId}`] || { on: false, cents: 0 }} onSet={(v) => set(`dep:${x.appointmentId}`, v)} title={`Deposit — ${x.service}`} sub={`For ${day(x.startTime)}${x.holdUntil ? ` · held until ${new Date(x.holdUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`} cents={x.cents} editable={false} />)}
        {acc.owedToThem.map((x: any) => <p key={x.renterId} className="rounded-2xl p-3 text-[13px]" style={{ background: 'color-mix(in srgb, var(--ok) 10%, transparent)' }}>The studio owes {x.name.split(' ')[0]} {money(x.cents)} from front-desk collections — settled from the Rent page, not here.</p>)}
        {!acc.rent.length && !acc.tuition.length && !acc.fees.length && !acc.deposits.length && <p className="text-[15px]">Nothing owed — {who.name.split(' ')[0]} is all paid up.</p>}
        {(acc.rent.length > 0 || acc.tuition.length > 0 || acc.fees.length > 0 || acc.deposits.length > 0) && (
          <button type="button" disabled={busy || total <= 0 || acc.tuition.some((x: any) => pick[`tuition:${x.planId}`]?.on && pick[`tuition:${x.planId}`].cents > x.balanceCents)} onClick={() => void addToBill()}
            className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? 'One moment…' : `Add ${money(total)} to the bill`}</button>)}
      </>)}
    </div>);
}
