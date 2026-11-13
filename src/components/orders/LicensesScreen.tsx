'use client';
// src/components/orders/LicensesScreen.tsx — LICENSES ON FILE (lib/pro-license): the licenses customers sent from the
// shop so they can buy products for licensed pros. Those waiting first; each opens a sheet with what they sent and the
// copy (managers only), to approve with the expiry read off the license, or decline with a reason they're told. An
// approved one can be taken off. A renewal sent while a license is good waits beside it, and is what the sheet shows to
// decide; the one on file keeps working until it's approved. Everyone on the team can see who has one; the server
// decides (api/retail/pro-licenses).
import * as React from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { stateName } from '@/lib/wholesale-tax';
import { Btn, C, Empty, Initials, LargeTitle, ListRow, Seg, Sheet, muted } from './ui';

type Sent = { name: string; phone: string; number: string; state: string; expiresOn: string; sentAt: string; fileUrl?: string; fileName?: string; hasFile?: boolean };
type Lic = Sent & { id: string; email: string; status: 'waiting' | 'approved' | 'declined' | 'revoked';
  note: string; decidedAt: string | null; decidedBy: string | null; valid: boolean; renewalOf: { number: string; expiresOn: string } | null; toCheck: boolean; pending: Sent | null };
const day = (d: string) => { const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : d; };
const sent = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const field = 'mt-1 block h-12 w-full rounded-2xl border px-4 text-[16px] font-normal';
const fieldStyle: React.CSSProperties = { borderColor: C.line, background: C.paper, color: C.ink };

function statusOf(l: Lic, today: string): { text: string; tone: 'ok' | 'warn' | 'plain' } {
  if (l.pending) return { text: 'Renewal to check', tone: 'warn' };
  if (l.status === 'waiting') return { text: l.renewalOf ? 'Renewal to check' : 'To check', tone: 'warn' };
  if (l.status === 'approved') return l.valid ? { text: `Good to ${day(l.expiresOn)}`, tone: 'ok' } : { text: `Expired ${day(l.expiresOn)}`, tone: 'warn' };
  if (l.status === 'declined') return { text: 'Declined', tone: 'plain' };
  void today; return { text: 'Taken off', tone: 'plain' };
}

export function LicensesScreen() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const [list, setList] = React.useState<Lic[] | null>(null);
  const [today, setToday] = React.useState('');
  const [canDecide, setCanDecide] = React.useState(false);
  const [view, setView] = React.useState<'waiting' | 'all'>('waiting');
  const [open, setOpen] = React.useState<Lic | null>(null);
  const [exp, setExp] = React.useState(''); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');

  const call = React.useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/retail/pro-licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const load = React.useCallback(async () => {
    const d = await call({ action: 'list' });
    if (d.ok) { setList(d.licenses || []); setToday(String(d.today || '')); setCanDecide(!!d.canDecide); } else setErr(d.error || 'The licenses couldn’t be read.');
  }, [call]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);

  const pick = (l: Lic) => { setOpen(l); setExp((l.pending || l).expiresOn || ''); setNote(''); setErr(''); };
  const decide = async (decision: 'approve' | 'decline' | 'revoke') => {
    if (!open) return; setBusy(true); setErr('');
    // (The one looked at: sent again since, and the server asks for a fresh look.)
    const d = await call({ action: 'decide', id: open.id, decision, sentAt: (open.pending || open).sentAt, expiresOn: exp, note });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    setOpen(null); await load();
  };

  const waiting = (list || []).filter((l) => l.toCheck);
  const shown = view === 'waiting' ? waiting : (list || []);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6" style={{ color: C.ink }}>
      <LargeTitle title="Licenses" sub="Customers send their license once to buy products for licensed pros. Check each one against the state’s lookup before you approve it." />
      <div className="mt-5 max-w-xs"><Seg value={view} onChange={setView} options={[{ id: 'waiting', label: `To check${waiting.length ? ` (${waiting.length})` : ''}` }, { id: 'all', label: 'Everyone' }]} /></div>
      {err && !open && <p role="alert" className="m-0 mt-4 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      {!list ? <p className="m-0 mt-6 text-[15px]" style={muted}>Loading…</p>
        : !shown.length ? <Empty title={view === 'waiting' ? 'Nothing to check' : 'No licenses yet'} sub={view === 'waiting' ? 'New licenses show here when a customer sends one.' : 'Mark a product Pros only in its online listing, and customers are asked for a license at checkout.'} />
        : (
          <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: C.soft }}>
            {shown.map((l) => { const st = statusOf(l, today); return (
              <ListRow key={l.id} onClick={() => pick(l)} lead={<Initials name={l.name} />} title={l.name}
                detail={`${stateName((l.pending || l).state) || (l.pending || l).state} ${(l.pending || l).number}, sent ${sent((l.pending || l).sentAt)}`}
                trail={<span className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold" style={st.tone === 'ok' ? { background: C.okSoft, color: C.ok } : st.tone === 'warn' ? { background: C.warnSoft, color: C.warn } : { background: C.paper, color: C.muted }}>{st.text}</span>} />
            ); })}
          </div>
        )}

      {open && (
        <Sheet title={open.name} sub={open.email} onClose={() => setOpen(null)} closeLabel="Close">
          {open.pending && <p className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>They sent a renewal {sent(open.pending.sentAt)}. The license on file keeps working until you approve this one.</p>}
          {(() => { const v: Sent = open.pending || open; return (
          <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            {open.pending && open.pending.name !== open.name && <><dt style={muted}>Name on it</dt><dd className="m-0">{open.pending.name}</dd></>}
            <dt style={muted}>License</dt><dd className="m-0 tabular-nums">{v.number}</dd>
            <dt style={muted}>State</dt><dd className="m-0">{stateName(v.state) || v.state}</dd>
            <dt style={muted}>Expires</dt><dd className="m-0">{v.expiresOn ? day(v.expiresOn) : 'Not given'}</dd>
            {v.phone && <><dt style={muted}>Phone</dt><dd className="m-0">{v.phone}</dd></>}
            {open.pending ? <><dt style={muted}>On file now</dt><dd className="m-0">{open.number}, {open.status === 'approved' ? `good to ${day(open.expiresOn)}` : 'taken off'}</dd></>
              : open.renewalOf && <><dt style={muted}>Before</dt><dd className="m-0">{open.renewalOf.number}, good to {day(open.renewalOf.expiresOn)}</dd></>}
            <dt style={muted}>Copy</dt><dd className="m-0">{v.fileUrl ? <a href={v.fileUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">View their license</a> : v.hasFile ? 'A manager can open it' : 'None sent'}</dd>
            {open.decidedAt && <><dt style={muted}>Decided</dt><dd className="m-0">{sent(open.decidedAt)}{open.decidedBy ? `, by ${open.decidedBy}` : ''}{open.note ? `: ${open.note}` : ''}</dd></>}
          </dl>); })()}
          {canDecide ? (
            <div className="mt-5 space-y-3">
              {(open.pending || open.status !== 'approved') && (
                <label className="block text-[13px] font-semibold" style={muted}>Expires, as printed on the license
                  <input type="date" value={exp} min={today || undefined} onChange={(e) => setExp(e.target.value)} className={field} style={fieldStyle} /></label>
              )}
              {(() => { const taking = open.status === 'approved' && !open.pending; return (
              <label className="block text-[13px] font-semibold" style={muted}>{taking ? 'Why it’s being taken off (they’re told)' : 'If you decline: why (they’re told)'}
                <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder={taking ? 'Optional' : 'For example: the photo is too blurry to read'} className={field} style={fieldStyle} /></label>); })()}
              {err && <p role="alert" className="m-0 text-[15px]" style={{ color: C.warn }}>{err}</p>}
              <div className="flex flex-wrap gap-2">
                {(open.pending || open.status !== 'approved') && <Btn kind="primary" disabled={busy || !exp} onClick={() => void decide('approve')}>{busy ? 'Saving…' : open.pending ? 'Approve the renewal' : 'Approve'}</Btn>}
                {(open.pending || open.status === 'waiting') && <Btn disabled={busy || !note.trim()} onClick={() => void decide('decline')}>Decline</Btn>}
                {open.status === 'approved' && !open.pending && <Btn kind="danger" disabled={busy} onClick={() => void decide('revoke')}>Take it off</Btn>}
              </div>
              <p className="m-0 text-[13px]" style={muted}>They get an email either way.</p>
            </div>
          ) : <p className="m-0 mt-5 text-[14px]" style={muted}>A manager approves or declines licenses.</p>}
        </Sheet>
      )}
      <p className="m-0 mt-8 text-[13px]" style={muted}>Customers send theirs from your shop’s license page: <Link href={`/shop/${tenantId}/pro`} target="_blank" className="underline underline-offset-4">open it</Link>.</p>
    </div>);
}
