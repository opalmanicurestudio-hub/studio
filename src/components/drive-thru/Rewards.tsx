// src/components/drive-thru/Rewards.tsx — REWARDS ON AN ORDER, at the drive-thru lane and the counter (design boards
// "Rewards at the drive-thru" and "Rewards at the counter"; lib/counter-points, api/counter 'rewardsCode', 'points',
// 'rewards' and 'reward'). The sheet that finds the guest (their changing rewards code, which can spend, or a phone
// number, which only earns), and the order's rewards row: who it's for, a reward to use once the order is sent and
// before it's paid, and taking it off. Both screens use these, so they work alike. (Colors set inline, so the counter's
// black look, lib/app-theme, takes them over.)
'use client';
import { useEffect, useRef, useState } from 'react';
import { USUAL_SHOW, usualWords, type UsualEntry } from '@/lib/counter-usual';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] px-4 rounded-xl text-[15px] font-semibold disabled:opacity-50 transition-colors ${RING}`;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;

/** The member on an order (api/counter 'rewards'): their name, balance and the rewards they can use now. */
export type RewardMember = { orderId: string; name: string; balance: number; unit: string; ready: { id: string; name: string; points: number; cents?: number }[];
  /** What they usually get (lib/counter-usual): for staff only. */ usual?: UsualEntry[] };
export type RewardOrder = { id: string; status: string; paidAt: string | null; points?: { phone: string | null; earned: number; verified?: boolean } | null; reward?: { name: string; cents: number } | null };
/** The member from an answer (or none). */
export const memberFrom = (orderId: string, m: any): RewardMember | null => (m ? { orderId, name: String(m.name || ''), balance: Number(m.balance) || 0, unit: String(m.unit || 'points'), ready: Array.isArray(m.ready) ? m.ready : [], usual: Array.isArray(m.usual) ? m.usual : [] } : null);

/** The order's rewards row: who it's for and what it earned; with their code, a reward to use once it's sent (and before
 *  it's paid), or the one in use and Take it off; with neither, Add rewards (paid already, it earns at once). */
export function RewardsRow({ order, member, codes, busy, onAdd, onUse, usualOk, onUsual }: { order: RewardOrder; member: RewardMember | null; codes: boolean; busy: boolean; onAdd: () => void; onUse: (rewardId: string | null) => void;
  /** Their usual, while the order is being taken: whether each can be added now (on the menu, not sold out), and adding it. */
  usualOk?: (u: UsualEntry) => boolean; onUsual?: (u: UsualEntry) => void }) {
  const earns = order.points?.earned ? <span style={{ color: GREEN }}>, earned {order.points.earned}</span> : order.paidAt ? '' : ', earns when paid';
  if (order.points && order.points.verified && member?.orderId === order.id) return (
    <div className="w-full space-y-2">
      <p className="text-[14px]" style={{ color: MUTED }}>Rewards: <b className="font-semibold" style={{ color: INK }}>{member.name}</b>, {member.balance} {member.unit}{earns}</p>
      {order.status === 'building' && onUsual && (() => { const list = (member.usual || []).filter((u) => !usualOk || usualOk(u)).slice(0, USUAL_SHOW); return list.length ? (
        <div role="group" aria-labelledby={`usual-${order.id}`} className="space-y-1.5"><p id={`usual-${order.id}`} className="text-[13px] font-semibold" style={{ color: MUTED }}>Their usual</p>
          {list.map((u) => <button key={`${u.itemId}-${u.choicesText || ''}`} type="button" disabled={busy} onClick={() => onUsual(u)} aria-label={`Add their usual: ${usualWords(u)}, ordered ${u.n} times`} className={`${btn} flex w-full items-center justify-between gap-3 px-3 text-left text-[14px] font-medium`} style={quiet}>
            <span className="min-w-0"><b className="font-semibold">{u.name}</b>{u.choicesText ? `, ${u.choicesText}` : ''}</span><span className="shrink-0 text-[13px]" style={{ color: MUTED }}>{u.n} times</span></button>)}
        </div>) : null; })()}
      {order.reward ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-semibold" style={{ color: GREEN }}>Using {order.reward.name}</p>
          {!order.paidAt && <button type="button" disabled={busy} onClick={() => onUse(null)} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Take it off</button>}
        </div>
      ) : !order.paidAt && member.ready.length > 0 ? (order.status === 'sent'
        ? <div role="group" aria-labelledby={`use-reward-${order.id}`}><p id={`use-reward-${order.id}`} className="pb-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>Use a reward</p>
          <div className="flex flex-wrap gap-2">{member.ready.map((r) => <button key={r.id} type="button" disabled={busy} onClick={() => onUse(r.id)} aria-label={`Use ${r.name}, ${r.points} ${member.unit}`} className={`${btn} px-3 text-[14px]`} style={quiet}>{r.name} ({r.points})</button>)}</div></div>
        : <p className="text-[13.5px]" style={{ color: MUTED }}>{member.ready.length === 1 ? 'A reward is' : `${member.ready.length} rewards are`} ready to use once the order is sent.</p>) : null}
    </div>);
  if (order.points) return <p className="text-[14px]" style={{ color: MUTED }}>Rewards: {order.points.phone ? <>phone ending <b className="font-semibold tabular-nums" style={{ color: INK }}>{order.points.phone}</b></> : 'added'}{earns}</p>;
  return <button type="button" onClick={onAdd} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>{codes ? 'Add rewards (their code or phone number)' : 'Add rewards (their phone number)'}</button>;
}

/** Rewards: their rewards code first (it can spend), or their phone number (it only earns), and joining when they say yes. */
export function PointsSheet({ name, busy, codes, onCode, onLink, onClose }: { name: string; busy: boolean; codes: boolean; onCode: (code: string) => Promise<string | null>; onLink: (phone: string, join: boolean, name: string) => Promise<string | null>; onClose: () => void }) {
  const [phone, setPhone] = useState(''); const [ask, setAsk] = useState<'' | 'not_found' | 'not_member'>(''); const [who, setWho] = useState(name); const [err, setErr] = useState('');
  // Their rewards code first (it can use a reward); a phone number only earns.
  const [byCode, setByCode] = useState(codes); const [code, setCode] = useState('');
  const sixDigits = code.replace(/\D/g, '').slice(0, 6);
  const goCode = async () => { setErr(''); const r = await onCode(sixDigits); if (r) setErr(r); };
  const box = useRef<HTMLDivElement | null>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); prev?.focus?.(); };
  }, []);
  const digits = phone.replace(/\D/g, '').slice(-10);
  const go = async (join: boolean) => {
    setErr(''); const r = await onLink(digits, join, who.trim());
    if (r === 'not_found' || r === 'not_member') setAsk(r); else if (r) setErr(r);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="points-title" className="max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK }} onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 id="points-title" className="text-[20px] font-semibold tracking-tight">Rewards</h2>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{byCode ? 'Ask for the rewards code on their rewards page. The order earns points in their name, and they can use a reward on it.' : 'Ask for their phone number. The order earns points in their name once it’s paid.'}</p>
        </div>
        {byCode ? <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (sixDigits.length === 6) void goCode(); }}>
            <label className="sr-only" htmlFor="points-code">Rewards code</label>
            <input id="points-code" value={code} onChange={(e) => { setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7)); setErr(''); }} inputMode="numeric" autoComplete="off" placeholder="6-digit code" className={`h-14 min-w-0 flex-1 rounded-2xl px-4 text-[22px] font-semibold tracking-[0.08em] tabular-nums ${RING}`} style={{ border: `1px solid ${LINE}` }} />
            <button type="submit" disabled={busy || sixDigits.length !== 6} className={`${btn} min-h-[56px] shrink-0 px-5`} style={{ background: INK, color: '#fff' }}>{busy ? 'Finding…' : 'Find them'}</button>
          </form>
          <button type="button" onClick={() => { setByCode(false); setErr(''); }} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>No code? Their phone number (earns points only)</button>
        </> : <>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (digits.length === 10) void go(false); }}>
          <label className="sr-only" htmlFor="points-phone">Phone number</label>
          <input id="points-phone" value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d()\-+ .]/g, '').slice(0, 18)); setAsk(''); }} inputMode="tel" autoComplete="off" placeholder="Phone number" className={`h-14 min-w-0 flex-1 rounded-2xl px-4 text-[20px] font-semibold tabular-nums ${RING}`} style={{ border: `1px solid ${LINE}` }} />
          <button type="submit" disabled={busy || digits.length !== 10} className={`${btn} min-h-[56px] shrink-0 px-5`} style={{ background: INK, color: '#fff' }}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
        {ask && (
          <div className="space-y-3 rounded-2xl p-4" style={{ background: SOFT }}>
            <p className="text-[15px] font-semibold">{ask === 'not_found' ? 'No one in the program has that number.' : 'They haven’t joined the rewards program yet.'} Would they like to join?</p>
            {ask === 'not_found' && <label className="block"><span className="text-[14px]" style={{ color: MUTED }}>Their first name</span>
              <input value={who} onChange={(e) => setWho(e.target.value.slice(0, 24))} className={`mt-1 h-12 w-full rounded-xl px-3 text-[16px] ${RING}`} style={{ background: '#fff', border: `1px solid ${LINE}` }} placeholder="First name" /></label>}
            <button type="button" disabled={busy} onClick={() => void go(true)} className={`${btn} min-h-[52px] w-full`} style={{ background: GREEN, color: '#fff' }}>Yes, they want to join</button>
          </div>)}
        {codes && <button type="button" onClick={() => { setByCode(true); setErr(''); setAsk(''); }} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>They have a rewards code</button>}
        </>}
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        <button type="button" onClick={onClose} className={`${btn} w-full`} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Close</button>
      </div>
    </div>
  );
}
