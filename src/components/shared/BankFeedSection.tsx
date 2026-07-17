'use client';

/**
 * BankFeedSection — Plaid bank feed + reconciliation inbox
 * (src/components/shared/BankFeedSection.tsx)
 *
 * Drop into the Ledger page:
 *   <BankFeedSection tenantId={tenantId} firestore={firestore} />
 *
 * v61 upgrades:
 *  • Icon-button toolbar (connect / sync / accept-all / rules) — less space
 *  • Learned rules promoted from a buried bottom text-link to a header
 *    toggle with a count badge; rule rows use icon buttons; rule edits
 *    pick from the shared category library (custom still allowed)
 *  • Per-line category picker fed by src/lib/categories.ts, so booking a
 *    bank charge uses the same vocabulary as the rest of the app
 *  • Receipt capture on reconciliation: paperclip a receipt image to a
 *    bank line before booking it
 *
 * ⚠ SERVER NOTE — /api/plaid needs two small additions in the `resolve`
 *   action for the new features to persist:
 *     categoryOverride?: string  → use instead of suggestedCategory, and
 *                                  update the learned rule to match
 *     receiptUrl?: string        → set { receiptUrl, hasReceipt: true }
 *                                  on the transaction it creates
 */

import React, { useState, useEffect, useCallback } from 'react';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import {
  Landmark, RefreshCw, CheckCheck, BookMarked, Check, X, Paperclip,
  Briefcase, Pencil, Trash2, Loader,
} from 'lucide-react';
import { categoriesFor, CUSTOM_CATEGORY } from '@/lib/categories';
import { ImageUpload } from './ImageUpload';

declare global { interface Window { Plaid?: any } }

/** Compact icon button used across the toolbar and inbox rows. */
const IconBtn = ({
  onClick, disabled, title, children, tone = 'ghost', badge,
}: {
  onClick: () => void; disabled?: boolean; title: string;
  children: React.ReactNode; tone?: 'ghost' | 'dark' | 'success' | 'danger'; badge?: number;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={[
      'relative h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-40',
      tone === 'dark'    ? 'bg-slate-900 text-white hover:bg-slate-700' :
      tone === 'success' ? 'bg-emerald-600 text-white hover:bg-emerald-500' :
      tone === 'danger'  ? 'border-2 border-red-200 text-red-500 hover:bg-red-50' :
                           'border-2 text-slate-600 hover:bg-slate-50',
    ].join(' ')}
  >
    {children}
    {badge !== undefined && badge > 0 && (
      <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 bg-amber-500 text-white text-[8px] font-black rounded-full flex items-center justify-center leading-none">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);

export function BankFeedSection({ tenantId, firestore }: { tenantId: string; firestore: Firestore }) {
  const [busy, setBusy] = useState<string>('');           // '' | 'connect' | 'sync' | 'all' | bankTxnId
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<{ pulled: number; matched: number; needsReview: number; autoBooked?: number } | null>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [editRule, setEditRule] = useState('');
  const [editRuleCustom, setEditRuleCustom] = useState(false);

  // Per-line reconciliation state
  const [catOverride, setCatOverride] = useState<Record<string, string>>({});
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [receiptOpenFor, setReceiptOpenFor] = useState('');

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

  const resolve = async (bt: any, mode: 'create' | 'ignore', contextOverride?: string) => {
    if (busy) return;
    setBusy(bt.id); setError('');
    try {
      const payload: any = { action: 'resolve', bankTxnId: bt.id, mode };
      if (contextOverride) payload.contextOverride = contextOverride;
      const chosen = catOverride[bt.id];
      if (mode === 'create' && chosen && chosen !== bt.suggestedCategory) payload.categoryOverride = chosen;
      if (mode === 'create' && receiptUrls[bt.id]) payload.receiptUrl = receiptUrls[bt.id];
      const d = await api(payload);
      if (!d.ok) setError(d.error || 'Could not save.');
      else {
        setCatOverride(({ [bt.id]: _drop, ...rest }) => rest);
        setReceiptUrls(({ [bt.id]: _drop, ...rest }) => rest);
        if (receiptOpenFor === bt.id) setReceiptOpenFor('');
      }
    } catch { setError('Could not save — try again.'); }
    finally { setBusy(''); }
  };

  const toggleRules = async () => {
    if (rulesOpen) { setRulesOpen(false); return; }
    const d = await api({ action: 'rules-list' });
    if (d.ok) { setRules(d.rules || []); setRulesOpen(true); }
  };

  const saveRule = async (rl: any) => {
    const sel = (document.getElementById(`rulesel-${rl.id}`) as HTMLSelectElement)?.value;
    const custom = (document.getElementById(`rulecat-${rl.id}`) as HTMLInputElement)?.value?.trim();
    const val = sel === CUSTOM_CATEGORY ? custom : sel;
    if (!val) return;
    const d = await api({ action: 'rules-update', ruleId: rl.id, category: val, fixPast: true });
    if (d.ok) {
      setRules(rs => rs.map(x => x.id === rl.id ? { ...x, category: val } : x));
      setEditRule(''); setEditRuleCustom(false);
    } else setError(d.error || 'Could not update rule.');
  };

  const lineCategories = (bt: any) => {
    const list = categoriesFor(bt.direction === 'out' ? 'expense' : 'income').map(c => c.name);
    if (bt.suggestedCategory && !list.includes(bt.suggestedCategory)) list.unshift(bt.suggestedCategory);
    return list;
  };

  const selectCls = 'h-8 rounded-lg border-2 bg-white px-2 text-[10px] font-black uppercase tracking-wide text-slate-700 outline-none focus:border-slate-900 max-w-[170px] truncate';

  return (
    <div className="space-y-3">
      {/* ── Toolbar — icon buttons, rules up top ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-black uppercase tracking-widest">Bank feed</h2>
        {inbox.length > 0 && (
          <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{inbox.length}</span>
        )}
        <div className="flex-1" />
        <IconBtn onClick={toggleRules} title={rulesOpen ? 'Hide learned rules' : 'View learned rules'}
          tone={rulesOpen ? 'dark' : 'ghost'}>
          <BookMarked className="w-4 h-4" />
        </IconBtn>
        <IconBtn onClick={() => setLabelPick(p => !p)} disabled={!!busy} title={connected ? 'Add another bank account' : 'Connect bank'}>
          {busy === 'connect' ? <Loader className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
        </IconBtn>
        <IconBtn onClick={sync} disabled={!!busy} title="Sync now" tone="dark">
          <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />
        </IconBtn>
        {inbox.length > 1 && (
          <IconBtn
            onClick={async () => {
              if (busy) return; setBusy('all'); setError('');
              try { const d = await api({ action: 'accept-all' }); if (!d.ok) setError(d.error || 'Batch failed.'); }
              catch { setError('Batch failed — try again.'); } finally { setBusy(''); }
            }}
            disabled={!!busy}
            title={`Accept all ${inbox.length} suggestions`}
            tone="success"
            badge={inbox.length}
          >
            {busy === 'all' ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
          </IconBtn>
        )}
      </div>

      {/* ── Learned rules — now right under the toolbar ── */}
      {rulesOpen && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-3 space-y-1.5 animate-in fade-in duration-150">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <BookMarked className="w-3.5 h-3.5" /> Learned rules — the feed's memory
          </p>
          {rules.length === 0
            ? <p className="text-[10px] font-bold text-muted-foreground">No rules yet — categorize a few lines and they'll appear here.</p>
            : rules.map(rl => (
              <div key={rl.id} className="rounded-lg border px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">{rl.context === 'Personal' ? '🏠' : '💼'}</span>
                  <p className="flex-1 min-w-0 text-[11px] font-bold truncate">{rl.merchant} <span className="text-slate-400">→ {rl.category}</span></p>
                  <IconBtn onClick={() => { setEditRule(editRule === rl.id ? '' : rl.id); setEditRuleCustom(false); }} title={editRule === rl.id ? 'Close editor' : 'Edit rule'}>
                    <Pencil className="w-3.5 h-3.5" />
                  </IconBtn>
                  <IconBtn tone="danger" title="Forget this rule" onClick={async () => {
                    const d = await api({ action: 'rules-delete', ruleId: rl.id });
                    if (d.ok) setRules(rs => rs.filter(x => x.id !== rl.id));
                  }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconBtn>
                </div>
                {editRule === rl.id && (
                  <div className="flex gap-1.5 flex-wrap animate-in fade-in duration-150">
                    <select
                      id={`rulesel-${rl.id}`}
                      defaultValue={categoriesFor().some(c => c.name === rl.category) ? rl.category : CUSTOM_CATEGORY}
                      onChange={e => setEditRuleCustom(e.target.value === CUSTOM_CATEGORY)}
                      className="flex-1 min-w-[140px] h-9 rounded-lg border-2 px-2 text-[11px] font-bold bg-white"
                    >
                      {categoriesFor().map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      <option value={CUSTOM_CATEGORY}>Custom…</option>
                    </select>
                    {(editRuleCustom || !categoriesFor().some(c => c.name === rl.category)) && (
                      <input defaultValue={categoriesFor().some(c => c.name === rl.category) ? '' : rl.category} id={`rulecat-${rl.id}`}
                        className="flex-1 min-w-[120px] h-9 rounded-lg border-2 px-3 text-[11px] font-bold" placeholder="Custom category" />
                    )}
                    <button onClick={() => saveRule(rl)} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                      Save + fix past
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

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

      {/* ── Review inbox — compact icon actions + category picker + receipt ── */}
      {inbox.length > 0 && (
        <div className="space-y-2">
          {inbox.map(bt => {
            const chosenCat = catOverride[bt.id] ?? bt.suggestedCategory;
            const hasReceipt = !!receiptUrls[bt.id];
            return (
              <div key={bt.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 space-y-2">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${bt.direction === 'out' ? 'bg-red-400' : 'bg-emerald-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate">{bt.merchant || bt.name}</p>
                    <p className="text-[10px] font-bold text-muted-foreground">{bt.date} · {bt.direction === 'out' ? '−' : '+'}${(bt.amountCents / 100).toFixed(2)}{bt.pending ? ' · pending' : ''}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 shrink-0 ${bt.context === 'Personal' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-white'}`}>{bt.context === 'Personal' ? '🏠' : '💼'}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Category — pulled from the shared library, editable pre-booking */}
                  <select
                    value={chosenCat}
                    onChange={e => setCatOverride(m => ({ ...m, [bt.id]: e.target.value }))}
                    disabled={busy === bt.id}
                    className={selectCls}
                    title="Category this line will be booked as"
                  >
                    {lineCategories(bt).map(name => <option key={name} value={name}>{name}</option>)}
                  </select>

                  <div className="flex-1" />

                  <IconBtn
                    onClick={() => setReceiptOpenFor(receiptOpenFor === bt.id ? '' : bt.id)}
                    disabled={busy === bt.id}
                    title={hasReceipt ? 'Receipt attached — click to change' : 'Attach a receipt to this charge'}
                    tone={hasReceipt ? 'success' : 'ghost'}
                  >
                    <Paperclip className="w-4 h-4" />
                  </IconBtn>

                  {bt.context === 'Personal' && (
                    <IconBtn onClick={() => resolve(bt, 'create', 'Business')} disabled={busy === bt.id} title="Book as Business instead">
                      <Briefcase className="w-4 h-4" />
                    </IconBtn>
                  )}

                  <IconBtn onClick={() => resolve(bt, 'create')} disabled={busy === bt.id} tone="dark"
                    title={`Book as ${chosenCat} — remembers for next time`}>
                    {busy === bt.id ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </IconBtn>

                  <IconBtn onClick={() => resolve(bt, 'ignore')} disabled={busy === bt.id} title="Ignore this line">
                    <X className="w-4 h-4" />
                  </IconBtn>
                </div>

                {/* Receipt capture — attach proof before booking */}
                {receiptOpenFor === bt.id && (
                  <div className="rounded-lg border-2 border-dashed p-3 space-y-2 animate-in fade-in duration-150">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <Paperclip className="w-3 h-3" /> Receipt for this charge
                    </p>
                    <ImageUpload onImageUploaded={(url: string) => {
                      setReceiptUrls(m => ({ ...m, [bt.id]: url }));
                      setReceiptOpenFor('');
                    }} />
                    {hasReceipt && <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">✓ Attached — will save with the transaction</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {connected && inbox.length === 0 && !error && (
        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">✓ Fully reconciled — nothing needs review</p>
      )}
    </div>
  );
}
