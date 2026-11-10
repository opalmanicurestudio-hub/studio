'use client';
// components/renters/RentalPolicies.tsx — RENTAL POLICIES, IN ONE PLACE. Every rule a business's leases are written from,
// set on one page (app/(app)/rental-policies): the lease's own terms, late rent and reminders, time away, the charges
// allowed to a renter's card, and what comes with the space (WhatRentersGet). Repair promises and house rules are
// shown with a way to where they're set. Saved through api/renters/policies, one section at a time. A change applies to
// leases sent from now on; a signed lease keeps its own terms, or the kinder of the two.
import * as React from 'react';
import Link from 'next/link';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { WhatRentersGet } from '@/components/renters/WhatRentersGet';
import { LEAVE_TREATMENT_LABEL, LEAVE_TREATMENT_NOTE, type LeavePolicy, type LeaveTreatment } from '@/lib/leave-policy';
import type { CollectionsPolicy } from '@/lib/collections-policy';
import type { LeasePolicy } from '@/lib/lease-builder';

type Loaded = {
  lease: LeasePolicy; leave: LeavePolicy; collections: CollectionsPolicy; charges: { label: string; capCents: number }[]; chargesSaved: boolean;
  repairs: { label: string; respondHours: number; fixHours: number }[]; houseRules: string[]; businessName: string;
};

const card = 'space-y-1 rounded-[20px] border border-[#ececee] bg-white p-5 scroll-mt-24';
const h2 = 'text-[19px] font-bold leading-7 text-[#16171a]';
const hint = 'text-[13px] leading-snug text-[#6d7075]';
const input = 'h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]';
const btn = 'inline-flex h-11 items-center rounded-full border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-50';
const dark = 'h-11 rounded-full bg-[#16171a] px-5 text-[15px] font-medium text-white disabled:opacity-40';
const sub = 'pt-4 text-[13px] font-semibold text-[#16171a]';

const SECTIONS: [string, string][] = [['lease', 'Lease terms'], ['late', 'Late rent'], ['away', 'Time away'], ['charges', 'Charges to their card'], ['what-renters-get', 'What renters get'], ['repairs', 'Repairs'], ['rules', 'House rules']];
const STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const dateOf = (iso: string) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const hours = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`);

function Toggle({ on, onChange, label, note }: { on: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#ececee] py-3">
      <div className="min-w-0"><p className="text-[15px] font-medium text-[#16171a]">{label}</p>{note && <p className={hint}>{note}</p>}</div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="grid h-11 w-[60px] shrink-0 place-items-center">
        <span className={`relative block h-[30px] w-[52px] rounded-full ${on ? 'bg-[#1f7a4d]' : 'bg-[#d9d9de]'}`}><span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white ${on ? 'left-[25px]' : 'left-[3px]'}`} /></span>
      </button>
    </div>
  );
}
function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ececee] py-3"><div className="min-w-0 flex-1"><p className="text-[15px] font-medium text-[#16171a]">{label}</p>{note && <p className={hint}>{note}</p>}</div><div className="w-full sm:w-56">{children}</div></div>;
}
/** A whole number of days (or any unit), typed freely and kept within its range. */
function Num({ value, onChange, min, max, unit, label }: { value: number; onChange: (n: number) => void; min: number; max: number; unit: string; label: string }) {
  const [raw, setRaw] = React.useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <input inputMode="numeric" aria-label={label} className={`${input} text-right`} value={raw ?? String(value)}
        onFocus={() => setRaw(String(value))} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6); setRaw(v); const n = Number(v); if (v !== '' && n >= min && n <= max) onChange(n); }}
        onBlur={() => setRaw(null)} />
      <span className="shrink-0 text-[14px] text-[#6d7075]">{unit}</span>
    </div>
  );
}
/** Dollars, typed as typed and kept in cents. */
function Money({ cents, onChange, label, placeholder }: { cents: number; onChange: (c: number) => void; label: string; placeholder?: string }) {
  const [raw, setRaw] = React.useState<string | null>(null);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[#6d7075]">$</span>
      <input inputMode="decimal" aria-label={label} placeholder={placeholder} className={`${input} pl-7`} value={raw ?? (cents ? (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')}
        onFocus={() => setRaw(cents ? String(cents / 100) : '')} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setRaw(v); onChange(Math.round((Number(v) || 0) * 100)); }}
        onBlur={() => setRaw(null)} />
    </div>
  );
}
function SaveBar({ dirty, busy, msg, onSave, onReset, label, canUndo = dirty }: { dirty: boolean; busy: boolean; msg: { ok: boolean; t: string } | null; onSave: () => void; onReset: () => void; label: string; canUndo?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#ececee] pt-4">
      <button type="button" className={dark} disabled={!dirty || busy} onClick={onSave}>{busy ? 'Saving…' : label}</button>
      {canUndo && !busy && <button type="button" className={btn} onClick={onReset}>Undo changes</button>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-[14px] ${msg.ok ? 'text-[#1f7a4d]' : 'text-[#b45309]'}`}>{msg.t}</p>}
    </div>
  );
}

export function RentalPolicies({ tenantId }: { tenantId: string }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState('');
  const [lease, setLease] = React.useState<LeasePolicy | null>(null);
  const [late, setLate] = React.useState<CollectionsPolicy | null>(null);
  const [away, setAway] = React.useState<LeavePolicy | null>(null);
  const [charges, setCharges] = React.useState<{ label: string; capCents: number }[]>([]);
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState<Record<string, { ok: boolean; t: string } | null>>({});

  // A save refreshes only its own section: what's being changed in another isn't lost.
  const take = (r: Loaded, only?: string) => {
    setData(r);
    if (!only || only === 'lease') setLease(r.lease);
    if (!only || only === 'collections') setLate(r.collections);
    if (!only || only === 'leave') setAway(r.leave);
    if (!only || only === 'charges') setCharges(r.charges);
  };
  const load = React.useCallback(async () => {
    setFailed('');
    try {
      const h = await staffAuthHeader();
      const res = await fetch(`/api/renters/policies?tenantId=${encodeURIComponent(tenantId)}`, { headers: h });
      const r = await res.json().catch(() => null);
      if (res.status === 403) { setFailed('Only someone who can change settings can see these.'); return; }
      if (!r?.ok) { setFailed('These didn’t load.'); return; }
      take(r);
    } catch { setFailed('These didn’t load. Check your connection.'); }
  }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  // A link to a section (#late, #away…) lands on it once the page has loaded.
  const loaded = !!data;
  React.useEffect(() => {
    if (!loaded) return;
    const go = () => { const id = window.location.hash.slice(1); if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' }); };
    go(); window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [loaded]);

  const save = async (section: 'lease' | 'collections' | 'leave' | 'charges', values: any, done: string) => {
    setBusy(section); setMsg((m) => ({ ...m, [section]: null }));
    try {
      const h = await staffAuthHeader();
      const r = await (await fetch('/api/renters/policies', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, section, values }) })).json();
      if (!r?.ok) setMsg((m) => ({ ...m, [section]: { ok: false, t: r?.error || 'That didn’t save. Try again.' } }));
      else { take(r, section); setMsg((m) => ({ ...m, [section]: { ok: true, t: r.unchanged ? 'Nothing changed.' : done } })); }
    } catch { setMsg((m) => ({ ...m, [section]: { ok: false, t: 'That didn’t save. Check your connection and try again.' } })); }
    setBusy('');
  };

  if (failed) return (
    <div className={card}><p className="text-[15px] text-[#16171a]">{failed}</p><button type="button" className={btn} onClick={() => void load()}>Try again</button></div>
  );
  if (!data || !lease || !late || !away) return <div className={card} aria-busy="true"><p className={hint}>Loading your rental policies…</p></div>;

  const L = lease; const setL = (patch: Partial<LeasePolicy>) => setLease({ ...L, ...patch });
  const ins = L.insurance; const setIns = (patch: Partial<LeasePolicy['insurance']>) => setL({ insurance: { ...ins, ...patch } });
  const leaseDirty = JSON.stringify(L) !== JSON.stringify(data.lease);
  const lateDirty = JSON.stringify(late) !== JSON.stringify(data.collections);
  const awayDirty = JSON.stringify(away) !== JSON.stringify(data.leave);
  const chargesDirty = JSON.stringify(charges) !== JSON.stringify(data.charges);
  // The usual days, and any other saved one, so each can be turned off.
  const DUNNING = [...new Set([3, 7, 14, 21, 30, 45, 60, ...late.dunningDays])].sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      <nav aria-label="Rental policies" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="inline-flex h-11 items-center whitespace-nowrap rounded-full border border-[#ececee] bg-white px-4 text-[14px] font-medium text-[#16171a]">{label}</a></li>)}</ul>
      </nav>

      <section id="lease" className={card} aria-labelledby="rp-lease">
        <h2 id="rp-lease" className={h2}>Lease terms</h2>
        <p className={hint}>What each new lease says before you change it for one renter. Leases you send from now on use these; a signed lease keeps its own. Version {data.lease.version}{data.lease.attorneyReview ? `, reviewed by ${data.lease.attorneyReview.by || 'an attorney'} on ${dateOf(data.lease.attorneyReview.at)}` : ''}.</p>

        <p className={sub}>Ending and staying on</p>
        <Row label="Notice to end" note="Written notice either side gives to end the lease"><Num label="Notice to end" value={L.noticeDays} onChange={(n) => setL({ noticeDays: n })} min={0} max={365} unit="days" /></Row>
        <Row label="Leaving early without that notice" note="What the renter owes on top of rent to the day they leave">
          <select aria-label="Leaving early" className={input} value={L.earlyEndFee} onChange={(e) => setL({ earlyEndFee: e.target.value as any })}><option value="none">Nothing more</option><option value="one_period">One period’s rent</option></select>
        </Row>
        <Row label="Staying past the end without renewing" note="What you may charge for each period they stay">
          <select aria-label="Staying past the end" className={input} value={L.holdover} onChange={(e) => setL({ holdover: e.target.value as any })}><option value="same">The same rent</option><option value="plus10">Rent plus 10%</option></select>
        </Row>

        <p className={sub}>Rent and money</p>
        <Row label="Notice before rent changes"><Num label="Notice before rent changes" value={L.rentChangeNoticeDays} onChange={(n) => setL({ rentChangeNoticeDays: n })} min={0} max={365} unit="days" /></Row>
        <Row label="Deposit back within" note="After they leave, less anything they owe, with a list"><Num label="Deposit back within" value={L.depositReturnDays} onChange={(n) => setL({ depositReturnDays: n })} min={1} max={90} unit="days" /></Row>
        <Row label="Declined payment fee" note="You may add it when a card or bank payment is declined or returned. Leave it empty for none."><Money label="Declined payment fee" cents={L.declinedFeeCents} placeholder="None" onChange={(c) => setL({ declinedFeeCents: Math.min(100000, c) })} /></Row>
        <Toggle label="Pay by card" on={L.payByCard} onChange={(v) => setL({ payByCard: v })} />
        <Toggle label="Autopay" note="Only once the renter turns it on and signs their OK in their portal" on={L.payByAutopay} onChange={(v) => setL({ payByAutopay: v })} />
        <Toggle label="Cash or check" note="Recorded by you when it’s paid" on={L.payOffline} onChange={(v) => setL({ payOffline: v })} />

        <p className={sub}>Getting in</p>
        <Row label="Hours they can use the space" note="Leave it empty to say they can use it when the business is open"><input aria-label="Hours they can use the space" className={input} value={L.accessHours} placeholder="When the business is open" onChange={(e) => setL({ accessHours: e.target.value.slice(0, 120) })} /></Row>

        <p className={sub}>Insurance and licenses</p>
        <Toggle label="Insurance required" note="They upload a current certificate in their portal" on={ins.required} onChange={(v) => setIns({ required: v })} />
        {ins.required && <>
          <Row label="Least per claim" note="Leave it empty to ask for none"><Money label="Least per claim" cents={ins.perClaimCents} onChange={(c) => setIns({ perClaimCents: c })} placeholder="No minimum" /></Row>
          <Row label="Least per year"><Money label="Least per year" cents={ins.perYearCents} onChange={(c) => setIns({ perYearCents: c })} placeholder="No minimum" /></Row>
          <Toggle label="Name the business on their policy" note="As an additional insured" on={ins.additionalInsured} onChange={(v) => setIns({ additionalInsured: v })} />
          <Row label="Written notice before pausing bookings" note="When their coverage lapses"><Num label="Notice before pausing bookings" value={ins.lapseNoticeDays} onChange={(n) => setIns({ lapseNoticeDays: n })} min={0} max={90} unit="days" /></Row>
        </>}
        <Toggle label="A current license required" note="For work that needs one where you are" on={L.licenseRequired} onChange={(v) => setL({ licenseRequired: v })} />

        <p className={sub}>Care and conduct</p>
        <Toggle label="Changes to the space need your OK" on={L.changesNeedOk} onChange={(v) => setL({ changesNeedOk: v })} />
        <Toggle label="They pay for damage they cause" note="Beyond normal wear" on={L.damageByRenter} onChange={(v) => setL({ damageByRenter: v })} />
        <Toggle label="Their own things are their responsibility" on={L.propertyClause} onChange={(v) => setL({ propertyClause: v })} />
        <Toggle label="No taking the business’s clients" note="Only where your state allows it; many limit these" on={L.noPoach} onChange={(v) => setL({ noPoach: v })} />
        <Row label="You answer a concern within"><Num label="You answer a concern within" value={L.concernReplyDays} onChange={(n) => setL({ concernReplyDays: n })} min={1} max={30} unit="days" /></Row>
        <Row label="Time to fix a broken rule" note="After written notice"><Num label="Time to fix a broken rule" value={L.fixItDays} onChange={(n) => setL({ fixItDays: n })} min={1} max={60} unit="days" /></Row>
        <Row label="Repeated breaks" note="The same rule broken this many times…"><Num label="Repeated breaks" value={L.repeatCount} onChange={(n) => setL({ repeatCount: n })} min={2} max={10} unit="times" /></Row>
        <Row label="…within"><Num label="Within months" value={L.repeatMonths} onChange={(n) => setL({ repeatMonths: n })} min={1} max={24} unit="months" /></Row>
        <Row label="Notice to end the lease for cause"><Num label="Notice to end for cause" value={L.endForCauseDays} onChange={(n) => setL({ endForCauseDays: n })} min={0} max={90} unit="days" /></Row>

        <p className={sub}>If the business changes</p>
        <Row label="Notice if the business closes, moves or is sold"><Num label="Notice if the business changes" value={L.businessChangeNoticeDays} onChange={(n) => setL({ businessChangeNoticeDays: n })} min={0} max={365} unit="days" /></Row>

        <p className={sub}>Disagreements and the law</p>
        <Row label="Talk it through first, for up to"><Num label="Talk it through first" value={L.disputeTalkDays} onChange={(n) => setL({ disputeTalkDays: n })} min={0} max={90} unit="days" /></Row>
        <Toggle label="Then try mediation before court" on={L.mediation} onChange={(v) => setL({ mediation: v })} />
        <Row label="Business’s legal name" note="As it appears on your registration"><input aria-label="Business’s legal name" className={input} value={L.legalName} onChange={(e) => setL({ legalName: e.target.value.slice(0, 120) })} /></Row>
        <Row label="Which state’s law" note="Usually where the space is">
          <select aria-label="Which state’s law" className={input} value={L.governingState.toUpperCase()} onChange={(e) => setL({ governingState: e.target.value })}>
            <option value="">Choose a state</option>{STATE_CODES.map((s) => <option key={s} value={s}>{s}</option>)}
            {[L.governingState, data.lease.governingState].filter((x, i, a) => x && !STATE_CODES.includes(x.toUpperCase()) && a.indexOf(x) === i).map((x) => <option key={x} value={x.toUpperCase()}>{x}</option>)}
          </select>
        </Row>
        <Row label="County, for any court case"><input aria-label="County" className={input} value={L.county} placeholder="County" onChange={(e) => setL({ county: e.target.value.slice(0, 60) })} /></Row>

        <p className={sub}>Attorney review</p>
        <p className={hint}>These leases are a starting point. Have an attorney where you are review them, and record it here; each lease notes the review it was written under.</p>
        {L.attorneyReview ? (
          <div className="space-y-2 border-t border-[#ececee] py-3">
            <Row label="Reviewed on" note={L.attorneyReview.at ? undefined : 'Add the date it was reviewed to save it'}><input type="date" aria-label="Reviewed on" className={input} value={L.attorneyReview.at.slice(0, 10)} onChange={(e) => setL({ attorneyReview: { ...L.attorneyReview!, at: e.target.value } })} /></Row>
            <Row label="By"><input aria-label="Reviewed by" className={input} value={L.attorneyReview.by} placeholder="Attorney or firm" onChange={(e) => setL({ attorneyReview: { ...L.attorneyReview!, by: e.target.value.slice(0, 120) } })} /></Row>
            <Row label="Note"><input aria-label="Review note" className={input} value={L.attorneyReview.note} placeholder="Optional" onChange={(e) => setL({ attorneyReview: { ...L.attorneyReview!, note: e.target.value.slice(0, 300) } })} /></Row>
            <button type="button" className={btn} onClick={() => setL({ attorneyReview: null })}>Remove the review</button>
          </div>
        ) : <div className="border-t border-[#ececee] py-3"><button type="button" className={btn} onClick={() => setL({ attorneyReview: { at: new Date().toISOString().slice(0, 10), by: '', note: '' } })}>Record a review</button></div>}

        <SaveBar label="Save lease terms" dirty={leaseDirty && !(L.attorneyReview && !L.attorneyReview.at)} canUndo={leaseDirty} busy={busy === 'lease'} msg={msg.lease || null} onReset={() => setLease(data.lease)}
          onSave={() => void save('lease', L, 'Saved. Leases you send from now on use these.')} />
      </section>

      <section id="late" className={card} aria-labelledby="rp-late">
        <h2 id="rp-late" className={h2}>Late rent</h2>
        <p className={hint}>What happens when rent is late. Nothing here acts on its own unless you turn it on. A renter whose signed lease gives a later pause keeps it.</p>
        <p className={sub}>Reminders after it’s late</p>
        <div className="flex flex-wrap gap-2 py-2" role="group" aria-label="Reminders after it’s late">
          {DUNNING.map((dd) => { const on = late.dunningDays.includes(dd); return (
            <button key={dd} type="button" aria-pressed={on} onClick={() => setLate({ ...late, dunningDays: on ? late.dunningDays.filter((x) => x !== dd) : [...late.dunningDays, dd].sort((a, b) => a - b) })}
              className={`h-11 rounded-full border px-4 text-[14px] font-medium ${on ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white text-[#16171a]'}`}>{dd} days</button>
          ); })}
        </div>
        <p className={hint}>{late.dunningDays.length ? `A reminder goes out ${late.dunningDays.join(', ')} days after the due date.` : 'Only the one late notice goes out.'}</p>
        <Toggle label="Pause their bookings when rent is late" on={late.autoBarAfterDaysLate !== null} onChange={(v) => setLate({ ...late, autoBarAfterDaysLate: v ? 30 : null })} note="Until it’s paid. Off: pausing stays your call." />
        {late.autoBarAfterDaysLate !== null && <Row label="After"><Num label="Pause bookings after" value={late.autoBarAfterDaysLate} onChange={(n) => setLate({ ...late, autoBarAfterDaysLate: n })} min={1} max={180} unit="days late" /></Row>}
        <Toggle label="Pause bookings when a lease ends owing" on={late.autoBarOnLeaseEndOwing} onChange={(v) => setLate({ ...late, autoBarOnLeaseEndOwing: v })} />
        <Toggle label="Tell them when their bookings pause" note="With the amount and a way to pay" on={late.notifyOnBar} onChange={(v) => setLate({ ...late, notifyOnBar: v })} />
        <Row label="What they see when they try to book" note="While their bookings are paused"><textarea aria-label="What they see when they try to book" rows={3} className="w-full rounded-xl border border-[#ececee] p-3 text-[15px]" value={late.wallMessage} onChange={(e) => setLate({ ...late, wallMessage: e.target.value.slice(0, 300) })} /></Row>
        <Row label="Checks payable to" note="On their statement. Empty: your business name."><input aria-label="Checks payable to" className={input} value={late.payableTo || ''} onChange={(e) => setLate({ ...late, payableTo: e.target.value.slice(0, 120) })} /></Row>
        <Row label="Send payments to" note="On their statement. Empty: your address."><input aria-label="Send payments to" className={input} value={late.remitAddress || ''} onChange={(e) => setLate({ ...late, remitAddress: e.target.value.slice(0, 200) })} /></Row>
        <SaveBar label="Save late rent" dirty={lateDirty} busy={busy === 'collections'} msg={msg.collections || null} onReset={() => setLate(data.collections)} onSave={() => void save('collections', late, 'Saved.')} />
      </section>

      <section id="away" className={card} aria-labelledby="rp-away">
        <h2 id="rp-away" className={h2}>Time away</h2>
        <p className={hint}>The ways a renter can ask for time away in their portal. You approve each request. A renter whose signed lease offers more keeps it.</p>
        {(['pause', 'reduced', 'bank', 'sublet'] as LeaveTreatment[]).map((t) => (
          <Toggle key={t} label={LEAVE_TREATMENT_LABEL[t]} note={LEAVE_TREATMENT_NOTE[t]} on={away.offered.includes(t)} onChange={(v) => setAway({ ...away, offered: v ? [...away.offered, t] : away.offered.filter((x) => x !== t) })} />
        ))}
        {!away.offered.length && <p className="py-2 text-[14px] text-[#b45309]">With none on, renters can’t ask for time away in their portal.</p>}
        {away.offered.includes('reduced') && <Row label="Holding rate" note="Of rent, while they’re away"><Num label="Holding rate" value={away.reducedPercent} onChange={(n) => setAway({ ...away, reducedPercent: n })} min={0} max={100} unit="%" /></Row>}
        {away.offered.includes('bank') && <Row label="Days banked for each week away"><Num label="Days banked each week" value={away.bankDaysPerWeek} onChange={(n) => setAway({ ...away, bankDaysPerWeek: n })} min={0} max={7} unit="days" /></Row>}
        <Row label="Longest time away" note="A guide; you can approve longer"><Num label="Longest time away" value={away.maxWeeks} onChange={(n) => setAway({ ...away, maxWeeks: n })} min={1} max={104} unit="weeks" /></Row>
        <Row label="Notice you ask for"><Num label="Notice you ask for" value={away.noticeDays} onChange={(n) => setAway({ ...away, noticeDays: n })} min={0} max={90} unit="days" /></Row>
        <Toggle label="Rent goes back to normal on their return date" note="Off: you end each one yourself" on={away.autoEnd} onChange={(v) => setAway({ ...away, autoEnd: v })} />
        <SaveBar label="Save time away" dirty={awayDirty} busy={busy === 'leave'} msg={msg.leave || null} onReset={() => setAway(data.leave)} onSave={() => void save('leave', away, 'Saved.')} />
      </section>

      <section id="charges" className={card} aria-labelledby="rp-charges">
        <h2 id="rp-charges" className={h2}>Charges to their card</h2>
        <p className={hint}>The only charges you can make to a renter’s saved card besides rent, each with the most it can be and a written reason sent to them. A signed lease lists these; a renter on one can only be charged what it lists.{data.chargesSaved ? '' : ' These are the starting list; save to make them yours.'}</p>
        <ul className="divide-y divide-[#ececee] border-t border-[#ececee]">
          {charges.map((c, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 py-3 sm:grid-cols-[1fr_9rem_auto]">
              <input aria-label={`Charge ${i + 1}`} className={`${input} col-span-2 sm:col-span-1`} value={c.label} placeholder="What it’s for" onChange={(e) => setCharges(charges.map((x, k) => (k === i ? { ...x, label: e.target.value.slice(0, 60) } : x)))} />
              <Money label={`Most for charge ${i + 1}`} cents={c.capCents} placeholder="Most" onChange={(v) => setCharges(charges.map((x, k) => (k === i ? { ...x, capCents: v } : x)))} />
              <button type="button" className={btn} aria-label={`Remove ${c.label || 'this charge'}`} onClick={() => setCharges(charges.filter((_, k) => k !== i))}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="py-2"><button type="button" className={btn} disabled={charges.length >= 30} onClick={() => setCharges([...charges, { label: '', capCents: 0 }])}>Add a charge</button></div>
        <SaveBar label="Save charges" dirty={chargesDirty || !data.chargesSaved} canUndo={chargesDirty} busy={busy === 'charges'} msg={msg.charges || null} onReset={() => setCharges(data.charges)} onSave={() => void save('charges', { charges }, 'Saved. Leases you send from now on list these.')} />
      </section>

      <WhatRentersGet tenantId={tenantId} />

      <section id="repairs" className={card} aria-labelledby="rp-repairs">
        <h2 id="rp-repairs" className={h2}>Repairs</h2>
        <p className={hint}>What your leases promise when a renter reports something broken.</p>
        <ul className="divide-y divide-[#ececee] border-t border-[#ececee]">{data.repairs.map((x) => <li key={x.label} className="flex flex-wrap justify-between gap-2 py-3 text-[15px]"><span className="text-[#16171a]">{x.label}</span><span className="text-[#6d7075]">A reply within {hours(x.respondHours)}, fixed within {hours(x.fixHours)}</span></li>)}</ul>
        <div className="pt-2"><Link href="/maintenance" className={btn}>Change these in Maintenance</Link></div>
      </section>

      <section id="rules" className={card} aria-labelledby="rp-rules">
        <h2 id="rp-rules" className={h2}>House rules</h2>
        <p className={hint}>Published documents for renters can be attached to a lease as its house rules.</p>
        {data.houseRules.length ? <ul className="divide-y divide-[#ececee] border-t border-[#ececee]">{data.houseRules.map((x) => <li key={x} className="py-3 text-[15px] text-[#16171a]">{x}</li>)}</ul>
          : <p className="border-t border-[#ececee] py-3 text-[15px] text-[#16171a]">None yet. Write them in Documents, publish them and choose renters as who they’re for.</p>}
        <div className="pt-2"><Link href="/documents" className={btn}>Open Documents</Link></div>
      </section>
    </div>
  );
}
