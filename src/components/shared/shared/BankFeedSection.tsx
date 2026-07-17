'use client';

/**
 * BankFeedSection — Plaid bank feed + reconciliation inbox
 * (src/components/shared/BankFeedSection.tsx)
 *
 * Drop into the Ledger page:
 *   <BankFeedSection tenantId={tenantId} firestore={firestore} />
 *
 * Connect bank → Plaid Link popup → daily-syncable feed. Auto-matched
 * lines reconcile silently; the rest land here for one-tap resolution:
 * accept the suggested category, match to an existing entry, or ignore.
 * Plaid Link's script loads from Plaid's CDN on demand — no new deps.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';

declare global { interface Window { Plaid?: any } }

export function BankFeedSection({ tenantId, firestore }: { tenantId: string; firestore: Firestore }) {
  const [busy, setBusy] = useState<string>('');           // '' | 'connect' | 'sync' | bankTxnId
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<{ pulled: number; matched: number; needsReview: number } | null>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);

  // Review inbox: unmatched bank lines, live
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(collection(firestore, 'tenants', tenantId, 'bankTransactions'), where('status', '==', 'unmatched'));
    const unsub = onSnapshot(q,
      snap => { setInbox(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (b.date || '').localeCompare(a.date || ''))); if (connected === null) setConnected(true); },
      () => setInbox([]));
    return () => unsub();
  }, [firestore, tenantId]);

  const api = useCallback(async (payload: any) => {
    const res = await fetch('/api/plaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...payload }),
    });
    return res.json();
  }, [tenantId]);

  const loadPlaidScript = () => new Promise<void>((resolve, reject) => {
    if (window.Plaid) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the bank connector.'));
    document.head.appendChild(s);
  });

  const connect = async () => {
    if (busy) return;
    setBusy('connect'); setError('');
    try {
      const lt = await api({ action: 'link-token' });
      if (!lt.ok) { setError(lt.error || 'Could not start bank connect.'); return; }
      await loadPlaidScript();
      const handler = window.Plaid.create({
        token: lt.linkToken,
        onSuccess: async (publicToken: string, metadata: any) => {
          const ex = await api({ action: 'exchange', publicToken, institution: metadata?.institution?.name || null });
          if (!ex.ok) { setError(ex.error || 'Could not finish connecting.'); return; }
          setConnected(true);
          await sync();
        },
        onExit: () => { /* user closed — fine */ },
      });
      handler.open();
    } catch (e: any) { setError(e?.message || 'Bank connect failed.'); }
    finally { setBusy(''); }
  };

  const sync = async () => {
    if (busy) return;
    setBusy('sync'); setError('');
    try {
      const d = await api({ action: 'sync' });
      if (!d.ok) { setError(d.error || 'Sync failed.'); return; }
      setConnected(true);
      setLastSync({ pulled: d.pulled, matched: d.matched, needsReview: d.needsReview });
    } catch { setError('Sync failed — try again.'); }
    finally { setBusy(''); }
  };

  const resolve = async (bt: any, mode: 'create' | 'ignore') => {
    if (busy) return;
    setBusy(bt.id); setError('');
    try {
      const d = await api({ action: 'resolve', bankTxnId: bt.id, mode });
      if (!d.ok) setError(d.error || 'Could not save.');
    } catch { setError('Could not save — try again.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-black uppercase tracking-widest">Bank feed</h2>
        {inbox.length > 0 && (
          <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{inbox.length}</span>
        )}
        <div className="flex-1" />
        <button onClick={connect} disabled={!!busy}
          className="h-9 px-3.5 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40">
          {busy === 'connect' ? 'Opening…' : connected ? 'Reconnect bank' : '🏦 Connect bank'}
        </button>
        <button onClick={sync} disabled={!!busy}
          className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40">
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {error && <p className="text-[10px] font-black uppercase text-amber-600 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">⚠ {error}</p>}
      {lastSync && !error && (
        <p className="text-[10px] font-bold text-muted-foreground">
          Pulled {lastSync.pulled} · auto-matched {lastSync.matched} · {lastSync.needsReview} for review
        </p>
      )}

      {inbox.length > 0 && (
        <div className="space-y-2">
          {inbox.map(bt => (
            <div key={bt.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${bt.direction === 'out' ? 'bg-red-400' : 'bg-emerald-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black truncate">{bt.merchant || bt.name}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">{bt.date} · {bt.direction === 'out' ? '−' : '+'}${(bt.amountCents / 100).toFixed(2)}{bt.pending ? ' · pending' : ''}</p>
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">→ {bt.suggestedCategory}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => resolve(bt, 'create')} disabled={busy === bt.id}
                  className="flex-1 h-8 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                  {busy === bt.id ? 'Saving…' : `Add as ${bt.suggestedCategory}`}
                </button>
                <button onClick={() => resolve(bt, 'ignore')} disabled={busy === bt.id}
                  className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-500 disabled:opacity-40">
                  Ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {connected && inbox.length === 0 && !error && (
        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">✓ Fully reconciled — nothing needs review</p>
      )}
    </div>
  );
}
