'use client';
// src/components/orders/SelectBar.tsx — THE BAR THAT APPEARS WHILE ORDERS ARE SELECTED. It shows only the actions that
// fit what's chosen: printing always, labels when packed ship orders are in the pick, shipping when they're labelled,
// hold and release for managers.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Actor } from '@/lib/retail-fulfill';
import { buyLabels, canMarkShipped, markAllShipped, needsLabel, printFor, printLabels, setHold } from './bulk';
import { Btn, C, Sheet, muted } from './ui';

export function SelectBar({ fs, tenantId, picked, actor, rs, perms, onDone, onToast }: {
  fs: Firestore; tenantId: string; picked: any[]; actor: Actor; rs: any; perms: { canShip?: boolean; canManage?: boolean };
  onDone: () => void; onToast: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState('');
  const [holding, setHolding] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const n = picked.length;
  const toLabel = picked.filter(needsLabel).length;
  const toShip = picked.filter(canMarkShipped).length;
  const labelled = picked.filter((o) => o.labelUrl).length;
  const held = picked.filter((o) => o.holdForReview).length;
  const run = async (key: string, fn: () => Promise<string | null>, clear = false) => {
    setBusy(key); const m = await fn(); setBusy('');
    if (m) onToast(m); if (clear) onDone();
  };
  const act = (key: string, label: string, fn: () => Promise<string | null>, opts: { clear?: boolean; kind?: 'soft' | 'primary' } = {}) => (
    <Btn key={key} kind={opts.kind || 'soft'} className="h-11 grow whitespace-nowrap px-4 text-[14px] lg:grow-0" disabled={!n || !!busy} onClick={() => void run(key, fn, opts.clear)}>{busy === key ? 'Working…' : label}</Btn>);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 lg:pointer-events-none lg:bottom-6 lg:flex lg:justify-center">
        <div className="cf-anim-rise border-t lg:pointer-events-auto lg:rounded-full lg:border lg:shadow-[0_10px_40px_rgba(0,0,0,.12)]" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 90%, transparent)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5 lg:flex-nowrap lg:px-2 lg:py-2">
            <span className="w-full shrink-0 pb-0.5 text-[15px] font-semibold lg:w-auto lg:pb-0 lg:pl-3 lg:pr-1">{n ? `${n} selected` : 'Pick orders'}</span>
            {act('picks', 'Pick list', () => printFor(tenantId, picked, 'picks'))}
            {act('slips', 'Packing slips', () => printFor(tenantId, picked, 'slips'))}
            {perms.canShip && toLabel > 0 && act('labels', `Buy ${toLabel} label${toLabel === 1 ? '' : 's'}`, async () => { const r = await buyLabels(tenantId, picked, rs); return r.ok ? `${r.message} Tap Print labels when you’re ready.` : r.message; }, { kind: 'primary' })}
            {perms.canShip && labelled > 0 && act('print-labels', 'Print labels', () => printLabels(tenantId, picked))}
            {perms.canShip && toShip > 0 && act('ship', `Mark ${toShip} shipped`, () => markAllShipped(fs, tenantId, picked, actor), { clear: true })}
            {perms.canManage && held > 0 && act('release', 'Release', () => setHold(fs, tenantId, picked, actor, false), { clear: true })}
            {perms.canManage && held < n && <Btn kind="soft" className="h-11 grow whitespace-nowrap px-4 text-[14px] lg:grow-0" disabled={!n || !!busy} onClick={() => setHolding(true)}>Hold</Btn>}
          </div>
        </div>
      </div>
      {holding && (
        <Sheet title={`Hold ${n === 1 ? 'this order' : `${n} orders`}?`} sub="Held orders stay out of the packing line until a manager releases them. The customer isn’t told." onClose={() => setHolding(false)}>
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>Why (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Address doesn’t match the card, for example" className="mt-1.5 h-12 w-full rounded-2xl border px-4 text-[15px] outline-none" style={{ borderColor: C.line, background: C.paper }} />
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!!busy} onClick={async () => { setBusy('hold'); const m = await setHold(fs, tenantId, picked, actor, true, reason.trim()); setBusy(''); setHolding(false); onToast(m); onDone(); }}>{busy === 'hold' ? 'Holding…' : 'Hold'}</Btn>
        </Sheet>)}
    </>);
}
