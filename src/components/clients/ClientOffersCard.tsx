'use client';
// src/components/clients/ClientOffersCard.tsx
//
// The client's offer wallet on their profile: every offer they were sent in
// a campaign — available, used (when, and on what), or expired.

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Gift } from 'lucide-react';
import { walletStatus } from '@/lib/offers';
import { cn } from '@/lib/utils';

const fmt = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export function ClientOffersCard({ firestore, tenantId, clientId }: { firestore: any; tenantId: string; clientId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    getDocs(query(collection(firestore, `tenants/${tenantId}/clientOffers`), where('clientId', '==', clientId)))
      .then((snap) => { if (alive) setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => !x.ownerRenterId).sort((a: any, b: any) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [firestore, tenantId, clientId]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="space-y-3 pt-6 border-t border-dashed text-left">
      <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 px-1"><Gift className="w-5 h-5" />Offers</h3>
      <div className="space-y-2">
        {rows.map((w) => {
          const st = walletStatus(w);
          return (
            <div key={w.id} className={cn('rounded-2xl border-2 px-4 py-3', st === 'available' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black">{w.line}</p>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest', st === 'available' ? 'bg-emerald-600 text-white' : st === 'redeemed' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-600')}>{st === 'available' ? 'Available' : st === 'redeemed' ? 'Used' : 'Expired'}</span>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground mt-1">
                Sent {fmt(w.sentAt)}{w.campaignName ? ` in “${w.campaignName}”` : ''}{st === 'redeemed' ? ` · used ${fmt(w.redeemedAt)}${w.saleTotal ? ` on a $${Number(w.saleTotal).toFixed(0)} visit` : ''}` : w.expiresAt ? ` · ${st === 'expired' ? 'ended' : 'ends'} ${fmt(w.expiresAt)}` : ''}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
