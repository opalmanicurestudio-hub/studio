'use client';

/**
 * StoreCreditHistory
 *
 * Surface 3: Client Profile — Credits tab/card
 *
 * Full history: issued, used, expired. Shows source appointment,
 * amount, status, expiry. Owners/admins can manually issue credit here.
 */

import React, { useState } from 'react';
import {
  Wallet, CheckCircle2, Clock, XCircle, Plus, Loader,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStoreCredit, formatCreditExpiry, type StoreCredit } from '@/hooks/useStoreCredit';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { doc, arrayUnion, increment } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase';
import { nanoid } from 'nanoid';
import type { Client } from '@/lib/data';

interface Props {
  client: Client;
  isOwnerOrAdmin: boolean;
}

const STATUS_CONFIG = {
  available: { label: 'Available', icon: CheckCircle2, color: 'bg-green-500 text-white' },
  used:      { label: 'Used',      icon: CheckCircle2, color: 'bg-slate-400 text-white' },
  expired:   { label: 'Expired',   icon: XCircle,      color: 'bg-red-400 text-white'   },
} as const;

export const StoreCreditHistory: React.FC<Props> = ({ client, isOwnerOrAdmin }) => {
  const { credits, availableCredits, totalAvailable } = useStoreCredit(client);
  const { toast }    = useToast();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [isIssuing,    setIsIssuing]    = useState(false);
  const [issueAmount,  setIssueAmount]  = useState('');
  const [issueReason,  setIssueReason]  = useState('');
  const [isSaving,     setIsSaving]     = useState(false);

  const handleIssueCredit = async () => {
    if (!firestore || !tenantId || !client.id) return;
    const amount = parseFloat(issueAmount);
    if (isNaN(amount) || amount <= 0) { toast({ variant: 'destructive', title: 'Enter a valid amount' }); return; }
    if (!issueReason.trim()) { toast({ variant: 'destructive', title: 'Reason required' }); return; }

    setIsSaving(true);
    const now = new Date().toISOString();
    const creditEntry: StoreCredit = {
      id:                    `credit_manual_${nanoid()}`,
      tenantId,
      clientId:              client.id,
      appointmentId:         'manual',
      amount,
      amountCents:           Math.round(amount * 100),
      reason:                issueReason.trim(),
      expiresAt:             selectedTenant?.storeCreditExpiryDays
        ? new Date(Date.now() + selectedTenant.storeCreditExpiryDays * 24 * 3600 * 1000).toISOString()
        : null,
      createdAt:             now,
      usedAt:                null,
      usedOnAppointmentId:   null,
      status:                'available',
    };

    try {
      await updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/clients`, client.id),
        {
          storeCredits:     arrayUnion(creditEntry),
          totalStoreCredit: increment(amount),
        },
      );
      toast({ title: 'Credit Issued', description: `$${amount.toFixed(2)} added to ${client.name}'s account.` });
      setIsIssuing(false);
      setIssueAmount('');
      setIssueReason('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to issue credit', description: e?.message });
    } finally {
      setIsSaving(false);
    }
  };

  const safeDate = (val: any) => {
    if (!val) return new Date();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
  };

  return (
    <div className="space-y-6">

      {/* ── Summary banner ── */}
      <div className="flex items-center justify-between p-5 rounded-[2rem] border-2 border-green-200 bg-green-50 shadow-inner">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-green-500 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Available Balance</p>
            <p className="text-[9px] font-bold text-green-600 uppercase opacity-70">
              {availableCredits.length} active credit{availableCredits.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <p className="text-3xl font-black font-mono text-green-700 tracking-tighter">
          ${totalAvailable.toFixed(2)}
        </p>
      </div>

      {/* ── Manual issue (admin/owner only) ── */}
      {isOwnerOrAdmin && (
        <div className="space-y-3">
          {!isIssuing ? (
            <Button
              variant="outline"
              onClick={() => setIsIssuing(true)}
              className="w-full h-11 rounded-2xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/10"
            >
              <Plus className="w-3.5 h-3.5 mr-2" /> Issue Manual Credit
            </Button>
          ) : (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 p-4 rounded-2xl border-2 border-primary/20 bg-primary/5"
              >
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">Issue Store Credit</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Amount ($)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-primary opacity-40">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={issueAmount}
                        onChange={e => setIssueAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-10 pl-6 rounded-xl border-2 font-black text-center bg-white"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
                    <Input
                      value={issueReason}
                      onChange={e => setIssueReason(e.target.value)}
                      placeholder="e.g. Service recovery"
                      className="h-10 rounded-xl border-2 bg-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setIsIssuing(false)} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px]">Cancel</Button>
                  <Button
                    onClick={handleIssueCredit}
                    disabled={isSaving || !issueAmount || !issueReason.trim()}
                    className="flex-[2] h-10 rounded-xl font-black uppercase text-[9px] shadow-lg shadow-primary/20"
                  >
                    {isSaving ? <Loader className="w-4 h-4 animate-spin" /> : 'Issue Credit'}
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      )}

      {/* ── Credit history list ── */}
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 ml-1">
          Credit History
        </p>

        {credits.length === 0 && (
          <div className="py-8 text-center">
            <Wallet className="w-8 h-8 text-muted-foreground opacity-20 mx-auto mb-2" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-40">No credits on record</p>
          </div>
        )}

        {[...credits]
          .sort((a, b) => safeDate(b.createdAt).getTime() - safeDate(a.createdAt).getTime())
          .map(credit => {
            const now = new Date();
            const isExpired = credit.expiresAt && new Date(credit.expiresAt) < now;
            const status = credit.usedAt ? 'used' : isExpired ? 'expired' : 'available';
            const cfg    = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available;
            const Icon   = cfg.icon;
            const expiringSoon = !credit.usedAt && !isExpired && isCreditExpiringSoon(credit.expiresAt ?? null, 14);

            return (
              <div
                key={credit.id}
                className={cn(
                  'p-4 rounded-2xl border-2 space-y-2 transition-all',
                  status === 'available' && !expiringSoon ? 'bg-white border-border'         : '',
                  status === 'available' && expiringSoon   ? 'bg-amber-50 border-amber-200'  : '',
                  status === 'used'                        ? 'bg-muted/20 border-muted/30 opacity-60' : '',
                  status === 'expired'                     ? 'bg-red-50/30 border-red-100 opacity-40' : '',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">
                      {credit.reason}
                    </p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                      {format(safeDate(credit.createdAt), 'MMM d, yyyy')}
                      {credit.usedAt && ` · Used ${format(safeDate(credit.usedAt), 'MMM d')}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className={cn(
                      'font-black font-mono text-sm',
                      status === 'available' ? (expiringSoon ? 'text-amber-700' : 'text-green-700') : 'text-muted-foreground',
                    )}>
                      ${credit.amount.toFixed(2)}
                    </p>
                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[7px] font-black uppercase', cfg.color)}>
                      <Icon className="w-2 h-2" /> {cfg.label}
                    </span>
                  </div>
                </div>

                {status === 'available' && credit.expiresAt && (
                  <p className={cn(
                    'text-[8px] font-bold uppercase tracking-widest flex items-center gap-1',
                    expiringSoon ? 'text-amber-600' : 'text-muted-foreground opacity-50',
                  )}>
                    <Clock className="w-2.5 h-2.5" />
                    {formatCreditExpiry(credit.expiresAt)}
                  </p>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};
