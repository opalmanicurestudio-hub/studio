'use client';
// The renter's W-9 in their portal (Space → Tax form). What's on file shows with the number masked; adding or
// updating it uses the same four-step form as the staff portal (components/shared/W9Form), sent through the portal's
// own session (action w9-save, lib/w9-record) so the number is encrypted at once and only its last 4 digits come back.
import React, { useCallback, useEffect, useState } from 'react';
import { W9Form } from '@/components/shared/W9Form';
import { SectionTitle } from '@/components/rent/shared';
import { api } from '@/components/rent/studio';
import { biz } from '@/components/rent/biz';

type W9 = { tinMasked: string; tinType: string; legalName: string; businessName: string; address: any; entityType: string; certifiedAt: string; collectedAt: string } | null;

export function RenterW9({ tenantId, token, renterId, onSaved }: { tenantId: string; token: string; renterId: string; onSaved?: () => void }) {
  const [w9, setW9] = useState<W9 | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'w9-status', tenantId, token });
    if (d?.ok) { setW9(d.w9 || null); setFailed(false); } else setFailed(true);
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);

  if (w9 === undefined) {
    return failed
      ? <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececee] bg-white px-4 py-3"><p className="text-[14px] text-[#b45309]">Your tax form couldn’t load.</p><button type="button" onClick={() => void load()} className="h-11 shrink-0 rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#16171a]">Try again</button></div>
      : <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] text-[#6d7075]">Loading…</p>;
  }
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

  return (
    <section className="space-y-3">
      <SectionTitle>Tax form (W-9)</SectionTitle>
      {w9 && !editing ? (
        <div className="space-y-3 rounded-2xl border border-[#ececee] bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-medium text-[#16171a]">W-9 on file</p>
            <span className="shrink-0 text-[13px] font-medium text-[#1f7a4d]">{w9.collectedAt ? `Added ${when(w9.collectedAt)}` : 'On file'}</span>
          </div>
          <p className="text-[14px] text-[#6d7075]">{w9.legalName}{w9.businessName ? ` · ${w9.businessName}` : ''} · {w9.tinType === 'ein' ? 'EIN' : 'SSN'} {w9.tinMasked}</p>
          {done && <p className="text-[14px] text-[#1f7a4d]">{done}</p>}
          <button type="button" onClick={() => { setEditing(true); setDone(''); }} className="h-11 w-full rounded-full border border-[#ececee] bg-white text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">Update it</button>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-[#ececee] bg-white p-4">
          <p className="text-[14px] leading-relaxed text-[#6d7075]">
            {biz(true)} uses this for year-end tax forms if they pay you anything, for example money taken at the front desk for your services. Your SSN or EIN is encrypted as soon as it’s sent; only its last 4 digits are ever shown again.
          </p>
          <W9Form
            tenantId={tenantId}
            renterId={renterId}
            existingW9={w9}
            submit={async (payload) => {
              const d = await api({ ...payload, action: 'w9-save', tenantId, token });
              if (d?.ok && d.w9) setW9(d.w9);
              return { ok: !!d?.ok, error: d?.error, tinMasked: d?.w9?.tinMasked };
            }}
            onComplete={() => { setEditing(false); setDone('Saved. Thank you.'); onSaved?.(); }}
          />
          {w9 && <button type="button" onClick={() => setEditing(false)} className="h-11 w-full rounded-full border border-[#ececee] bg-white text-[15px] font-medium text-[#6d7075]">Cancel</button>}
        </div>
      )}
    </section>
  );
}
