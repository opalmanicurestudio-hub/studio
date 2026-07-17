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
  const [lastSync, setLastSync] = useState<{ pulled: number; matched: number; needsReview: number; autoBooked?: number } | null>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [editRule, setEditRule] = useState('');

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

  const [labelPick, setLabelPick] = useState(false);
  const connect = async (label: 'Business' | 'Personal') => {
    if (busy) return;
    setLabelPick(false);
    setBusy('connect'); setError('');
    try {
      const lt = await api({ action: 'link-token' });
      if (!lt.ok) { setError(lt.error || 'Could not start bank connect.'); return; }
      await loadPlaidScript();
      const handler = window.Plaid.create({
        token: lt.linkToken,
        onSuccess: async (publicToken: string, metadata: any) => {
          const ex = await api({ action: 'exchange', publicToken, institution: metadata?.institution?.name || null, label });
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
      setLastSync({ pulled: d.pulled, matched: d.matched, needsReview: d.needsReview, autoBooked: d.autoBooked || 0 });
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
        <button onClick={() => setLabelPick(p => !p)} disabled={!!busy}
          className="h-9 px-3.5 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40">
          {busy === 'connect' ? 'Opening…' : connected ? '+ Add account' : '🏦 Connect bank'}
        </button>
        <button onClick={sync} disabled={!!busy}
          className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40">
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
        {inbox.length > 1 && (
          <button onClick={async () => {
            if (busy) return; setBusy('all'); setError('');
            try { const d = await api({ action: 'accept-all' }); if (!d.ok) setError(d.error || 'Batch failed.'); }
            catch { setError('Batch failed — try again.'); } finally { setBusy(''); }
          }} disabled={!!busy}
            className="h-9 px-3.5 rounded-xl bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40">
            {busy === 'all' ? 'Booking…' : `✓ Accept all (${inbox.length})`}
          </button>
        )}
      </div>

      {labelPick && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-3 space-y-2 animate-in fade-in duration-150">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">What kind of account is this?</p>
          <div className="flex gap-2">
            <button onClick={() => connect('Business')} className="flex-1 h-10 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">💼 Business</button>
            <button onClick={() => connect('Personal')} className="flex-1 h-10 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest text-slate-600">🏠 Personal</button>
          </div>
          <p className="text-[9px] font-bold text-muted-foreground">Everything from this account is categorized under the label you pick. Business expenses paid from a personal card can still be promoted line-by-line.</p>
        </div>
      )}

      {error && <p className="text-[10px] font-black uppercase text-amber-600 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">⚠ {error}</p>}
      {lastSync && !error && (
        <p className="text-[10px] font-bold text-muted-foreground">
          Pulled {lastSync.pulled} · matched {lastSync.matched}{(lastSync as any).autoBooked > 0 ? ` · auto-booked ${(lastSync as any).autoBooked} from your rules` : ''} · {lastSync.needsReview} for review
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
                <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 shrink-0 ${bt.context === 'Personal' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-white'}`}>{bt.context === 'Personal' ? '🏠' : '💼'}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">→ {bt.suggestedCategory}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => resolve(bt, 'create')} disabled={busy === bt.id}
                  className="flex-1 h-8 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                  {busy === bt.id ? 'Saving…' : `Add as ${bt.suggestedCategory} · remembers`}
                </button>
                {bt.context === 'Personal' && (
                  <button onClick={async () => {
                    if (busy) return; setBusy(bt.id); setError('');
                    try { const d = await api({ action: 'resolve', bankTxnId: bt.id, mode: 'create', contextOverride: 'Business' }); if (!d.ok) setError(d.error || 'Could not save.'); }
                    catch { setError('Could not save.'); } finally { setBusy(''); }
                  }} disabled={busy === bt.id}
                    className="h-8 px-3 rounded-lg border-2 border-slate-900 font-black uppercase text-[9px] tracking-widest text-slate-900 disabled:opacity-40">
                    💼 Book as Business
                  </button>
                )}
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

      {/* Learned rules — see and prune the system's memory */}
      <div>
        <button onClick={async () => {
          if (rulesOpen) { setRulesOpen(false); return; }
          const d = await api({ action: 'rules-list' });
          if (d.ok) { setRules(d.rules || []); setRulesOpen(true); }
        }} className="text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2">
          {rulesOpen ? 'Hide' : 'View'} learned rules{rules.length > 0 && rulesOpen ? ` (${rules.length})` : ''}
        </button>
        {rulesOpen && (
          <div className="mt-2 space-y-1.5">
            {rules.length === 0 ? <p className="text-[10px] font-bold text-muted-foreground">No rules yet — categorize a few lines and they'll appear here.</p>
            : rules.map(rl => (
              <div key={rl.id} className="rounded-lg border px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">{rl.context === 'Personal' ? '🏠' : '💼'}</span>
                  <p className="flex-1 min-w-0 text-[11px] font-bold truncate">{rl.merchant} <span className="text-slate-400">→ {rl.category}</span></p>
                  <button onClick={() => setEditRule(editRule === rl.id ? '' : rl.id)} className="text-[9px] font-black uppercase text-indigo-600">{editRule === rl.id ? 'Close' : 'Edit'}</button>
                  <button onClick={async () => {
                    const d = await api({ action: 'rules-delete', ruleId: rl.id });
                    if (d.ok) setRules(rs => rs.filter(x => x.id !== rl.id));
                  }} className="text-[9px] font-black uppercase text-red-500">Forget</button>
                </div>
                {editRule === rl.id && (
                  <div className="flex gap-1.5 animate-in fade-in duration-150">
                    <input defaultValue={rl.category} id={`rulecat-${rl.id}`}
                      className="flex-1 h-9 rounded-lg border-2 px-3 text-[11px] font-bold" placeholder="Category" />
                    <button onClick={async () => {
                      const val = (document.getElementById(`rulecat-${rl.id}`) as HTMLInputElement)?.value?.trim();
                      if (!val) return;
                      const d = await api({ action: 'rules-update', ruleId: rl.id, category: val, fixPast: true });
                      if (d.ok) {
                        setRules(rs => rs.map(x => x.id === rl.id ? { ...x, category: val } : x));
                        setEditRule('');
                        if (d.fixed > 0) setLastSync(s => s ? { ...s } : s);
                      } else setError(d.error || 'Could not update rule.');
                    }} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                      Save + fix past
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
