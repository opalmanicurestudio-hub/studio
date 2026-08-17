'use client';

// ─── /retail-orders/policies ──────────────────────────────────────────────────
// The policy engine's one screen. Every knob here is ENFORCED somewhere
// real — the server route, the resolution transaction, the claims engine —
// and each control says where, because a setting whose teeth you can't name
// is a placebo. Manager-only: policies are the owner's economics.
//
// Knobs and their enforcement:
//   returnsEnabled / returnWindowDays  → self-serve start_return refuses
//   deliveryIssueWindowDays            → claims route refuses late reports
//   claimAutoResolveMaxCents           → claims engine auto-approve ceiling
//   staffCreditCapCents                → depositCredits Firestore rule
//   policies.cancelAllowed/WindowHours → self-serve cancel refuses
//                                        (late ship-promise always overrides)
//   policies.restockingFeePct          → resolveReturn deducts, remorse only
//   policies.refundAutoBelowCents      → returns desk fires Stripe itself
//   policies.claimReviewAfter          → blocks auto-approve for repeaters
//   policies.claimPhotosRequired       → desk can't approve photo-less
//                                        damage/wrong-item claims

import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { ArrowLeft, Loader, Scale } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function RetailPoliciesPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const rs = ((selectedTenant as any)?.retailSettings || {}) as any;
  const pol = (rs.policies || {}) as any;
  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);

  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const initial = useMemo(() => ({
    returnWindowDays: String(Number(rs.returnWindowDays) || 0),
    deliveryIssueWindowDays: String(Number(rs.deliveryIssueWindowDays) || 0),
    claimAutoResolveMax: (Math.max(0, Number(rs.claimAutoResolveMaxCents) || 0) / 100).toFixed(2),
    staffCreditCap: (Math.max(0, Number(rs.staffCreditCapCents) || 2500) / 100).toFixed(2),
    cancelWindowHours: String(Number(pol.cancelWindowHours) || 0),
    restockingFeePct: String(Number(pol.restockingFeePct) || 0),
    refundAutoBelow: (Math.max(0, Number(pol.refundAutoBelowCents) || 0) / 100).toFixed(2),
    claimReviewAfter: String(Number(pol.claimReviewAfter) || 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tenantId]);
  const val = (k: keyof typeof initial) => (draft[k] !== undefined ? draft[k] : initial[k]);
  const setVal = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v.replace(/[^0-9.]/g, '') }));

  const save = async (key: string, field: string, value: any, label: string) => {
    if (!firestore || !tenantId || !isMgr || busy) return;
    setBusy(key);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value });
      toast({ title: `${label} saved` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: `Could not save ${label.toLowerCase()}`, description: e?.message });
    } finally { setBusy(null); }
  };

  const Toggle = ({ k, field, on, labelOn, labelOff, note }: { k: string; field: string; on: boolean; labelOn: string; labelOff: string; note: string }) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-black">{on ? labelOn : labelOff}</p>
        <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">{note}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} disabled={!isMgr || busy === k}
        onClick={() => void save(k, field, !on, on ? labelOff : labelOn)}
        className={cn('relative h-7 w-12 shrink-0 rounded-full border-2 transition-all',
          on ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full transition-all',
          on ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
      </button>
    </div>
  );

  const NumRow = ({ k, unit, label, note, onSave, zeroMeans }: { k: keyof typeof initial; unit: '$' | 'days' | 'hours' | '%' | 'claims'; label: string; note: string; onSave: (n: number) => void; zeroMeans: string }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">{label}</p>
        <span className="flex items-center gap-1.5">
          {unit === '$' && <span className="text-sm font-black">$</span>}
          <input inputMode="decimal" aria-label={label} value={val(k)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVal(k, e.target.value)}
            disabled={!isMgr}
            className="h-9 w-20 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60 disabled:opacity-50" />
          {unit !== '$' && <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{unit}</span>}
          <Button size="sm" variant="outline" disabled={!isMgr || busy === k || val(k) === initial[k]}
            onClick={() => onSave(Number(val(k)) || 0)}
            className="h-9 rounded-xl border-2 px-2.5 font-black uppercase text-[8px] tracking-widest">
            {busy === k ? <Loader className="h-3 w-3 animate-spin" /> : 'Set'}
          </Button>
        </span>
      </div>
      <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">{note} <span className="text-muted-foreground/70">0 = {zeroMeans}.</span></p>
    </div>
  );

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Shop policies</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Every knob names where it bites{isMgr ? '' : ' · view only — manager settings'}
            </p>
          </div>
          <Scale className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cancellation</p>
            <Toggle k="cancelAllowed" field="retailSettings.policies.cancelAllowed"
              on={pol.cancelAllowed !== false}
              labelOn="Customers can cancel online" labelOff="Cancellations go through you"
              note="Enforced by the self-serve route. A late ship-promise ALWAYS lets the customer cancel regardless — that's their right, not a courtesy." />
            <NumRow k="cancelWindowHours" unit="hours" label="Cancellation window"
              note="After this many hours from payment, online cancel closes (packing may have begun)."
              zeroMeans="open until packing starts"
              onSave={(n) => void save('cancelWindowHours', 'retailSettings.policies.cancelWindowHours', Math.max(0, Math.floor(n)), 'Cancellation window')} />
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Returns</p>
            <Toggle k="returnsEnabled" field="retailSettings.returnsEnabled"
              on={rs.returnsEnabled !== false}
              labelOn="Self-serve returns are on" labelOff="No self-serve returns"
              note="Enforced server-side on return start. Claims stay open either way — a shop can decline changed minds, never defects." />
            <NumRow k="returnWindowDays" unit="days" label="Return window"
              note="Days from delivery in which a return can be started."
              zeroMeans="no time limit"
              onSave={(n) => void save('returnWindowDays', 'retailSettings.returnWindowDays', Math.max(0, Math.floor(n)), 'Return window')} />
            <NumRow k="restockingFeePct" unit="%" label="Restocking fee"
              note="Deducted from REFUNDS only, and only when nothing on the return was your fault — damage, defects, and wrong items always waive it. Capped at 50%."
              zeroMeans="no fee"
              onSave={(n) => void save('restockingFeePct', 'retailSettings.policies.restockingFeePct', Math.min(50, Math.max(0, Math.floor(n))), 'Restocking fee')} />
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Claims</p>
            <NumRow k="deliveryIssueWindowDays" unit="days" label="Problem-report window"
              note="Days from delivery in which missing/damaged/wrong-item reports are accepted."
              zeroMeans="no time limit"
              onSave={(n) => void save('deliveryIssueWindowDays', 'retailSettings.deliveryIssueWindowDays', Math.max(0, Math.floor(n)), 'Report window')} />
            <NumRow k="claimAutoResolveMax" unit="$" label="Auto-approve claims up to"
              note="Low-risk claims at or under this value, where your own packing evidence concedes the point, refund themselves instantly."
              zeroMeans="every claim waits for you"
              onSave={(n) => void save('claimAutoResolveMax', 'retailSettings.claimAutoResolveMaxCents', Math.max(0, Math.round(n * 100)), 'Auto-approve ceiling')} />
            <NumRow k="claimReviewAfter" unit="claims" label="Manual review after"
              note="Once an email has this many prior claims, nothing auto-approves for them — every new claim waits for a human. The claim still files; only the shortcut is withdrawn."
              zeroMeans="off"
              onSave={(n) => void save('claimReviewAfter', 'retailSettings.policies.claimReviewAfter', Math.max(0, Math.floor(n)), 'Review threshold')} />
            <Toggle k="claimPhotosRequired" field="retailSettings.policies.claimPhotosRequired"
              on={pol.claimPhotosRequired === true}
              labelOn="Photo required for damage / wrong-item" labelOff="Photos optional on claims"
              note="When on, the desk cannot APPROVE a damage or wrong-item claim without a customer photo — request one first, or deny. Filing stays open; only approval is gated." />
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Refunds &amp; credit</p>
            <NumRow k="refundAutoBelow" unit="$" label="Auto-refund via Stripe below"
              note="A resolved return whose refund is at or under this fires Stripe immediately — no board tap. Larger refunds keep the deliberate tap."
              zeroMeans="every refund needs the tap"
              onSave={(n) => void save('refundAutoBelow', 'retailSettings.policies.refundAutoBelowCents', Math.max(0, Math.round(n * 100)), 'Auto-refund threshold')} />
            <NumRow k="staffCreditCap" unit="$" label="Staff store-credit cap"
              note="The most a non-manager can grant from the support inbox — enforced by the database itself, not just the interface."
              zeroMeans="staff can't grant discretionary credit at all"
              onSave={(n) => void save('staffCreditCap', 'retailSettings.staffCreditCapCents', Math.max(0, Math.round(n * 100)), 'Staff credit cap')} />
          </CardContent>
        </Card>

        <p className="px-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          Product-level rules live on the products themselves: final-sale flags, per-item return exclusions, and shipment-protection thresholds are in your shop settings and listings — this page holds the shop-wide economics.
        </p>
      </main>
    </div>
  );
}
